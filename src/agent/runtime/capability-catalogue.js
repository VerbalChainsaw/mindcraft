import { createActionResult } from './action-result.js';
import { isHuntable } from '../../utils/mcdata.js';
import { resolvePlayerTarget } from '../player-target.js';
import Vec3 from 'vec3';
import {
  assessStableMiningCollectionTarget,
  isMiningTargetExposed,
  probeSafeNavigationStances,
  probeSafeRoundTripNavigationStances,
} from '../library/skills.js';
import {
  isHazardousGameplayBlock,
  isLiquidGameplayBlock,
  isProtectedGameplayBlock,
  isSafeCaveStance,
  isSafeGameplaySupport,
} from './gameplay-safety.js';
import {
  familyEntriesFromCounts,
  familyTransferManifest,
  SUPPORTED_ITEM_FAMILIES,
} from './item-family.js';

const CAPABILITY_OUTCOME_CODES = Object.freeze({
  PRECONDITION: 'precondition_missing',
  BINDING: 'binding_failed',
  EXECUTION: 'execution_failed',
  VERIFICATION: 'verification_failed',
});

function canonicalName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 80);
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number.isFinite(Number(value)) ? Math.floor(Number(value)) : fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function optionalBoundedInteger(value, minimum, maximum) {
  if (value === null || value === undefined || value === '') return null;
  if (!Number.isFinite(Number(value))) return null;
  return Math.max(minimum, Math.min(maximum, Math.floor(Number(value))));
}

function commandString(value) {
  return JSON.stringify(String(value || ''));
}

function normalizeWorkstationConstraint(value, expectedName) {
  if (!value || typeof value !== 'object' || !value.position) return null;
  const name = canonicalName(value.name);
  const coordinates = ['x', 'y', 'z'].map(axis => Number(value.position[axis]));
  const dimension = String(value.dimension || '').trim().slice(0, 64);
  if (name !== expectedName || !coordinates.every(Number.isFinite) || !dimension) return null;
  return immutable({
    name,
    position: {
      x: Math.floor(coordinates[0]),
      y: Math.floor(coordinates[1]),
      z: Math.floor(coordinates[2]),
    },
    dimension,
    source: String(value.source || 'player_explicit_here').slice(0, 48),
    observedAt: Number.isFinite(value.observedAt) ? value.observedAt : null,
  });
}

function workstationCommandSuffix(workstation) {
  if (!workstation) return '';
  const { x, y, z } = workstation.position;
  return `, ${x}, ${y}, ${z}, ${commandString(workstation.dimension)}`;
}

function playerIdentity(value) {
  return String(value || '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 64);
}

function immutable(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(immutable));
  if (!value || typeof value !== 'object') return value;
  return Object.freeze(Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, immutable(entry)]),
  ));
}

function inventoryEntries(bot) {
  if (Array.isArray(bot?.inventory?.slots)) return bot.inventory.slots.filter(Boolean);
  return bot?.inventory?.items?.() || [];
}

function inventoryCounts(bot, override = null) {
  if (override instanceof Map) return new Map(override);
  if (override && typeof override === 'object' && !Array.isArray(override)) {
    return new Map(Object.entries(override));
  }
  const counts = new Map();
  for (const item of inventoryEntries(bot)) {
    const name = canonicalName(item?.name);
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + Math.max(0, Number(item.count) || 0));
  }
  return counts;
}

function familyCount(counts, family) {
  return familyEntriesFromCounts(counts, family)
    .reduce((total, entry) => total + entry.count, 0);
}

function equipmentName(bot, destination) {
  const mineflayerDestination = destination === 'main_hand' ? 'hand' : 'off-hand';
  const slot = bot?.getEquipmentDestSlot?.(mineflayerDestination);
  if (Number.isInteger(slot) && Array.isArray(bot?.inventory?.slots)) {
    return canonicalName(bot.inventory.slots[slot]?.name);
  }
  if (destination === 'main_hand') return canonicalName(bot?.heldItem?.name);
  return '';
}

export function captureCapabilitySnapshot(bot, { inventory = null } = {}) {
  const counts = inventoryCounts(bot, inventory);
  const position = bot?.entity?.position;
  return Object.freeze({
    inventory: counts,
    mainHand: equipmentName(bot, 'main_hand'),
    offHand: equipmentName(bot, 'off_hand'),
    position: position && [position.x, position.y, position.z].every(Number.isFinite)
      ? Object.freeze({ x: position.x, y: position.y, z: position.z })
      : null,
    dimension: String(bot?.game?.dimension || '').toLowerCase().replace(/^minecraft:/, ''),
    hasItem: name => Boolean(bot?.registry?.itemsByName?.[canonicalName(name)]),
    hasBlock: name => Boolean(bot?.registry?.blocksByName?.[canonicalName(name)]
      || Object.values(bot?.registry?.blocks || {}).some(block => block?.name === canonicalName(name))),
    hasEntity: name => Boolean(bot?.registry?.entitiesByName?.[canonicalName(name)]),
  });
}

function inventoryEffect(name, minimumIncrease, family = null) {
  return immutable({
    kind: 'inventory_increase',
    name: family ? null : canonicalName(name),
    family,
    minimumIncrease: Math.max(1, Math.floor(Number(minimumIncrease) || 1)),
  });
}

function inventoryIncrease(before, after, effect) {
  const previous = effect.family
    ? familyCount(before.inventory, effect.family)
    : Math.max(0, Number(before.inventory.get(effect.name)) || 0);
  const current = effect.family
    ? familyCount(after.inventory, effect.family)
    : Math.max(0, Number(after.inventory.get(effect.name)) || 0);
  return current - previous;
}

function verifyEffects(before, after, binding) {
  for (const effect of binding.expectedEffects) {
    if (effect.kind === 'inventory_increase') {
      const increase = inventoryIncrease(before, after, effect);
      if (increase < effect.minimumIncrease) {
        return immutable({
          ok: false,
          code: CAPABILITY_OUTCOME_CODES.VERIFICATION,
          detail: `Expected ${effect.minimumIncrease} additional ${effect.family || effect.name}; observed ${Math.max(0, increase)}.`,
          observedIncrease: Math.max(0, increase),
        });
      }
    } else if (effect.kind === 'equipment') {
      const equipped = effect.destination === 'main_hand' ? after.mainHand : after.offHand;
      if (equipped !== effect.name) {
        return immutable({
          ok: false,
          code: CAPABILITY_OUTCOME_CODES.VERIFICATION,
          detail: `Expected ${effect.name} in ${effect.destination}; observed ${equipped || 'empty'}.`,
        });
      }
    }
  }
  return immutable({
    ok: true,
    code: 'effects_verified',
    detail: 'Minecraft state satisfies the capability effects.',
  });
}

function validName(value) {
  return /^[a-z0-9_]+$/.test(canonicalName(value));
}

function preconditionReport(checks) {
  const missing = checks.filter(check => check.satisfied !== true);
  return immutable({
    ok: missing.length === 0,
    code: missing.length === 0 ? 'preconditions_satisfied' : CAPABILITY_OUTCOME_CODES.PRECONDITION,
    requirements: checks,
    detail: missing.length === 0
      ? 'Capability preconditions are satisfied.'
      : `Missing capability precondition: ${missing.map(check => check.requirement).join(', ')}.`,
  });
}

function resolveCapabilityPlayer(context, player) {
  const agent = context?.agent;
  return resolvePlayerTarget(context?.bot, player, {
    knownBotNames: agent?.getKnownAgentNames?.() || [],
  });
}

function executeBoundCommand(binding, {
  agent,
  executeCommand,
  owner = 'player',
  routeOrigin = 'internal',
  missionId = null,
  activityId = null,
} = {}) {
  if (!agent || typeof executeCommand !== 'function') {
    throw new TypeError('Capability execution requires the active agent and deterministic command executor.');
  }
  return executeCommand(agent, binding.command, { owner, routeOrigin, missionId, activityId });
}

const DEFINITIONS = new Map();

function defineCapability(definition) {
  const frozen = Object.freeze({ ...definition, parameters: immutable(definition.parameters) });
  DEFINITIONS.set(frozen.id, frozen);
}

function normalizePoint(value) {
  const source = value && typeof value === 'object' ? value : {};
  return immutable({
    x: Number(source.x),
    y: Number(source.y),
    z: Number(source.z),
  });
}

function normalizeExcludedTargets(value) {
  return immutable((Array.isArray(value) ? value : [])
    .slice(-24)
    .map(target => ({
      name: canonicalName(target?.name),
      x: Number(target?.x),
      y: Number(target?.y),
      z: Number(target?.z),
      radius: Math.max(0, Math.min(16, Math.floor(Number(target?.radius) || 0))),
    }))
    .filter(target => [target.x, target.y, target.z].every(Number.isFinite)));
}

function normalizeMiningReturnRoute(value) {
  return immutable((Array.isArray(value) ? value : [])
    .slice(-512)
    .map(cell => ({
      x: Math.floor(Number(cell?.x)),
      y: Math.floor(Number(cell?.y)),
      z: Math.floor(Number(cell?.z)),
    }))
    .filter(cell => [cell.x, cell.y, cell.z].every(Number.isFinite)));
}

function normalizeCanonicalTargets(value) {
  return immutable([...new Set((Array.isArray(value) ? value : [])
    .slice(0, 24)
    .map(canonicalName)
    .filter(Boolean))]);
}

function targetExcluded(position, exclusions) {
  return exclusions.some(target => {
    const radius = target.name === 'cave_region' ? 16 : 4;
    return Math.max(
      Math.abs(position.x - target.x),
      Math.abs(position.y - target.y),
      Math.abs(position.z - target.z),
    ) <= radius;
  });
}

function bindNearbyCave(context, args) {
  const bot = context?.bot;
  const origin = context?.snapshot?.position;
  const fallbackTarget = {
    name: 'cave_region',
    x: Math.floor(origin?.x ?? args.home.x),
    y: Math.floor(origin?.y ?? args.home.y),
    z: Math.floor(origin?.z ?? args.home.z),
  };
  if (!bot?.findBlocks || !bot?.blockAt || !origin) {
    return immutable({
      ok: false,
      code: 'source_not_found',
      detail: 'Loaded cave observations are unavailable.',
      target: fallbackTarget,
    });
  }
  let positions = [];
  try {
    positions = bot.findBlocks({
      // Natural cave entrances are not consistently labelled `cave_air`.
      // Skylight plus support distinguishes sheltered underground air from
      // ordinary surface air without inventing a second terrain model.
      matching: block => (
        ['air', 'cave_air'].includes(block?.name)
        && Number(block?.skyLight) === 0
      ),
      maxDistance: args.range,
      count: 1024,
    }) || [];
  } catch {
    positions = [];
  }
  const candidates = positions
    .filter(position => (
      position
      && Math.hypot(position.x - args.home.x, position.z - args.home.z) >= 12
      && Math.hypot(position.x - args.home.x, position.z - args.home.z) <= args.range
      && position.y <= args.home.y - 6
      && !targetExcluded(position, args.excludedTargets)
      && isSafeCaveStance(bot, position)
    ))
    .sort((left, right) => origin
      ? Math.hypot(left.x - origin.x, left.y - origin.y, left.z - origin.z)
        - Math.hypot(right.x - origin.x, right.y - origin.y, right.z - origin.z)
      : 0);
  const route = probeSafeRoundTripNavigationStances(
    bot,
    candidates,
    args.home,
    2_000,
  );
  if (route.reachable && route.terminalPosition) {
    const position = candidates.find(candidate => (
      candidate.x === route.terminalPosition.x
      && candidate.y === route.terminalPosition.y
      && candidate.z === route.terminalPosition.z
    ));
    if (position) {
      const target = { name: 'cave_region', x: position.x, y: position.y, z: position.z };
      return immutable({
        ok: true,
        commandName: args.light ? '!lightCaveAt' : '!goToCoordinates',
        command: args.light
          ? `!lightCaveAt(${position.x}, ${position.y}, ${position.z})`
          : `!goToCoordinates(${position.x}, ${position.y}, ${position.z}, 2)`,
        light: args.light,
        target,
        x: position.x,
        y: position.y,
        z: position.z,
        closeness: 2,
        dimension: context.snapshot?.dimension || '',
        routeStatus: route.status,
        pathLength: route.pathLength,
        returnRouteStatus: route.returnStatus,
        returnPathLength: route.returnPathLength,
      });
    }
  }
  const routeInconclusive = candidates.length > 0 && route.conclusive === false;
  return immutable({
    ok: false,
    code: 'source_not_found',
    inconclusive: routeInconclusive,
    routeStatus: route.status,
    returnRouteStatus: route.returnStatus || null,
    detail: candidates.length > 0
      ? routeInconclusive
        ? `Observed ${candidates.length} safe cave stance(s), but the round-trip route search did not finish (${route.status || 'unknown'}).`
        : route.status === 'return_route_unreachable'
        ? 'Observed cave stances had no verified non-destructive route back to home.'
        : 'Observed cave stances had no non-destructive native route.'
      : 'No safe untried cave stance was observed in the bounded region.',
    target: fallbackTarget,
  });
}

function bindUsefulAnimal(context, args) {
  const bot = context?.bot;
  const origin = context?.snapshot?.position;
  const candidates = Object.values(bot?.entities || {})
    .filter(entity => (
      isHuntable(entity)
      && entity?.position
      && [entity.position.x, entity.position.y, entity.position.z].every(Number.isFinite)
      && Math.hypot(
        entity.position.x - args.home.x,
        entity.position.y - args.home.y,
        entity.position.z - args.home.z,
      ) <= args.range
    ))
    .sort((left, right) => (
      Math.hypot(
        left.position.x - origin.x,
        left.position.y - origin.y,
        left.position.z - origin.z,
      ) - Math.hypot(
        right.position.x - origin.x,
        right.position.y - origin.y,
        right.position.z - origin.z,
      )
    ));
  const entity = candidates[0];
  if (!entity) {
    return immutable({
      ok: false,
      code: 'source_not_found',
      detail: 'No useful adult animal is currently observed in the bounded scout region.',
      target: { name: 'useful_animal' },
    });
  }
  const target = {
    name: canonicalName(entity.name),
    id: Number.isFinite(entity.id) ? entity.id : null,
    x: entity.position.x,
    y: entity.position.y,
    z: entity.position.z,
  };
  return immutable({
    ok: true,
    commandName: '!searchForEntity',
    command: `!searchForEntity(${commandString(target.name)}, ${args.range})`,
    target,
  });
}

function bindVillage(context, args) {
  const bot = context?.bot;
  const origin = context?.snapshot?.position;
  if (!bot?.findBlock || !origin) {
    return immutable({
      ok: false,
      code: 'source_not_found',
      detail: 'Loaded village-marker observations are unavailable.',
      target: { name: 'village' },
    });
  }
  let bell = null;
  try {
    bell = bot.findBlock({
      matching: block => (
        block?.name === 'bell'
        && (
          !Number.isFinite(args.searchLimit)
          || Math.hypot(block.position.x - args.home.x, block.position.z - args.home.z) <= args.searchLimit
        )
      ),
      maxDistance: args.range,
    });
  } catch {
    bell = null;
  }
  let associatedVillager = null;
  let associatedBed = null;
  if (bell?.position) {
    associatedVillager = Object.values(bot.entities || {}).find(entity => (
      ['villager', 'zombie_villager'].includes(canonicalName(entity?.name))
      && entity?.position
      && Math.hypot(
        entity.position.x - bell.position.x,
        entity.position.y - bell.position.y,
        entity.position.z - bell.position.z,
      ) <= 48
    )) || null;
    try {
      associatedBed = bot.findBlock({
        matching: block => (
          block?.name?.endsWith('_bed')
          && Math.hypot(
            block.position.x - bell.position.x,
            block.position.y - bell.position.y,
            block.position.z - bell.position.z,
          ) <= 48
        ),
        maxDistance: args.range,
      });
    } catch {
      associatedBed = null;
    }
  }
  if (!bell?.position || (!associatedVillager && !associatedBed?.position)) {
    return immutable({
      ok: false,
      code: 'source_not_found',
      detail: Number.isFinite(args.searchLimit)
        ? `No village bell with an associated villager or bed is currently observed inside the ${args.searchLimit}-block search radius.`
        : 'No village bell with an associated villager or bed is currently observed in this loaded search region.',
      target: { name: 'village' },
    });
  }
  const target = {
    name: 'village',
    marker: 'bell',
    x: bell.position.x,
    y: bell.position.y,
    z: bell.position.z,
  };
  return immutable({
    ok: true,
    commandName: '!goToCoordinates',
    command: `!goToCoordinates(${target.x}, ${target.y}, ${target.z}, 3)`,
    target,
    closeness: 3,
    dimension: context.snapshot?.dimension || '',
  });
}

function bindExposedOre(context, args) {
  const bot = context?.bot;
  const origin = context?.snapshot?.position;
  const regionTarget = {
    name: 'cave_region',
    x: Math.floor(origin?.x ?? args.home.x),
    y: Math.floor(origin?.y ?? args.home.y),
    z: Math.floor(origin?.z ?? args.home.z),
  };
  if (!bot?.findBlocks || !bot?.blockAt || !origin) {
    return immutable({ ok: false, code: 'resource_not_found', detail: 'Loaded ore observations are unavailable.', target: regionTarget });
  }
  let positions = [];
  try {
    positions = bot.findBlocks({
      matching: block => /^(?:deepslate_)?[a-z0-9_]+_ore$/.test(String(block?.name || '')),
      maxDistance: args.range,
      count: 96,
    }) || [];
  } catch {
    positions = [];
  }
  const candidates = positions
    .map(position => bot.blockAt(position))
    .filter(block => (
      block?.position
      && (args.targets.length === 0 || args.targets.includes(block.name))
      && !isProtectedGameplayBlock(block)
      && isMiningTargetExposed(bot, block)
      && Math.hypot(block.position.x - args.home.x, block.position.z - args.home.z) >= 12
      && !targetExcluded(block.position, args.excludedTargets)
    ))
    .sort((left, right) => (
      Math.hypot(
        left.position.x - origin.x,
        left.position.y - origin.y,
        left.position.z - origin.z,
      )
      - Math.hypot(
        right.position.x - origin.x,
        right.position.y - origin.y,
        right.position.z - origin.z,
      )
    ));
  let inconclusiveSkips = 0;
  for (const block of candidates.slice(0, 12)) {
    const assessment = assessStableMiningCollectionTarget(bot, block);
    if (!assessment.safe) continue;
    const route = probeSafeRoundTripNavigationStances(
      bot,
      assessment.stances,
      args.home,
      700,
    );
    if (!route.reachable) {
      // Skipping is fine; pretending we looked is not. A 700ms round-trip probe
      // that expired has not shown this ore is unusable, and twelve of those
      // adding up to "resource_not_found" is how an unfinished search became a
      // missing resource.
      if (route.conclusive === false) inconclusiveSkips += 1;
      continue;
    }
    const target = {
      name: block.name,
      x: block.position.x,
      y: block.position.y,
      z: block.position.z,
    };
    return immutable({
      ok: true,
      commandName: '!collectExposedOreAt',
      command: `!collectExposedOreAt(${commandString(block.name)}, ${target.x}, ${target.y}, ${target.z}, ${route.terminalPosition.x}, ${route.terminalPosition.y}, ${route.terminalPosition.z})`,
      target,
      returnStance: route.terminalPosition,
      routeStatus: route.status,
      pathLength: route.pathLength,
      returnRouteStatus: route.returnStatus,
      returnPathLength: route.returnPathLength,
    });
  }
  // The code stays 'resource_not_found' because goal-director matches on it and
  // a new code changes recovery behaviour unpredictably. The truth rides
  // alongside instead: inconclusive says the search did not finish, so a caller
  // can retry or report honestly rather than concluding the ore is not there.
  return immutable({
    ok: false,
    code: 'resource_not_found',
    inconclusive: inconclusiveSkips > 0,
    inconclusiveSkips,
    detail: candidates.length === 0
      ? 'No untried exposed ore was observed in this cave region.'
      : inconclusiveSkips > 0
        ? `Observed ${candidates.length} exposed ore, but ${inconclusiveSkips} round-trip probe(s) ran out of search time before proving an approach.`
        : 'Observed exposed ore had no stable non-destructive native approach.',
    target: regionTarget,
  });
}

function verifyReturnableExposedOreCollection(before, after, binding, { result } = {}) {
  const effect = binding.expectedEffects.find(candidate => candidate.kind === 'inventory_increase');
  const increase = effect ? inventoryIncrease(before, after, effect) : 0;
  const skill = result?.evidence?.skill;
  const targetMatches = ['name', 'x', 'y', 'z'].every(key => (
    key === 'name'
      ? skill?.target?.[key] === binding.target?.[key]
      : Number(skill?.target?.[key]) === Number(binding.target?.[key])
  ));
  const stanceMatches = ['x', 'y', 'z'].every(axis => (
    Number(skill?.returnStance?.[axis]) === Number(binding.returnStance?.[axis])
  ));
  const returnable = Boolean(
    skill?.kind === 'collect'
    && skill?.outcome === 'collected_returnable'
    && skill?.returnStanceVerified === true
    && targetMatches
    && stanceMatches
  );
  const verified = returnable && effect && increase >= effect.minimumIncrease;
  return immutable({
    ok: verified,
    code: verified ? 'returnable_ore_collection_verified' : CAPABILITY_OUTCOME_CODES.VERIFICATION,
    detail: verified
      ? `Minecraft confirmed the exposed ore drop and settlement on its home-returnable stance.`
      : `Minecraft did not confirm both the exposed ore drop and settlement on its home-returnable stance.`,
    // Do not let generic partial-inventory reconciliation turn a failed
    // returnability postcondition into capability success.
    observedIncrease: returnable ? Math.max(0, increase) : 0,
    inventoryIncrease: Math.max(0, increase),
    returnStanceVerified: returnable,
  });
}

function verifyCaveSurvey(_before, after, binding, { result } = {}) {
  const skill = result?.evidence?.skill;
  const arrived = Boolean(
    after?.position
    && Math.hypot(
      after.position.x - binding.target.x,
      after.position.y - binding.target.y,
      after.position.z - binding.target.z,
    ) <= binding.closeness + 0.75
  );
  const verified = binding.light === false
    ? arrived
    : Boolean(
      skill?.kind === 'cave_survey'
      && ['cave_lit', 'already_lit'].includes(skill.outcome)
      && skill?.target?.name === 'cave_region'
      && ['x', 'y', 'z'].every(axis => Number(skill.target?.[axis]) === Number(binding.target?.[axis]))
    );
  return immutable({
    ok: verified,
    code: verified
      ? binding.light === false ? 'cave_observation_verified' : 'cave_survey_verified'
      : CAPABILITY_OUTCOME_CODES.VERIFICATION,
    detail: verified
      ? binding.light === false
        ? 'Minecraft confirmed arrival at the selected safe, returnable cave stance.'
        : 'Minecraft confirmed the selected cave stance was reached and lit.'
      : binding.light === false
        ? 'Minecraft did not confirm arrival at the selected cave stance.'
        : 'Minecraft did not confirm lighting at the selected cave stance.',
    target: binding.target,
    torchesPlaced: Math.max(0, Number(skill?.torchesPlaced) || 0),
  });
}

function verifyUsefulAnimal(_before, _after, binding, { agent, result } = {}) {
  const skill = result?.evidence?.skill;
  const observed = agent?.bot?.entities?.[binding.target?.id];
  const target = observed?.position
    ? {
        name: canonicalName(observed.name),
        id: observed.id,
        x: observed.position.x,
        y: observed.position.y,
        z: observed.position.z,
      }
    : binding.target;
  const verified = Boolean(
    observed?.position
    && isHuntable(observed)
    && skill?.kind === 'movement'
    && ['arrived', 'already_at_target'].includes(skill.outcome)
    && Number(skill?.target?.id) === Number(binding.target?.id)
    && [target.x, target.y, target.z].every(Number.isFinite)
  );
  return immutable({
    ok: verified,
    code: verified ? 'useful_animal_observation_verified' : CAPABILITY_OUTCOME_CODES.VERIFICATION,
    detail: verified
      ? `Minecraft confirmed the observed ${target.name} and its current location.`
      : 'Minecraft did not confirm the bound useful animal at settlement.',
    target,
  });
}

function verifyVillageObservation(_before, after, binding, { agent } = {}) {
  const bot = agent?.bot;
  const observed = bot?.blockAt?.(new Vec3(binding.target.x, binding.target.y, binding.target.z));
  const associatedVillager = Object.values(bot?.entities || {}).find(entity => (
    ['villager', 'zombie_villager'].includes(canonicalName(entity?.name))
    && entity?.position
    && Math.hypot(
      entity.position.x - binding.target.x,
      entity.position.y - binding.target.y,
      entity.position.z - binding.target.z,
    ) <= 48
  ));
  let associatedBed = null;
  try {
    associatedBed = bot?.findBlock?.({
      matching: block => (
        block?.name?.endsWith('_bed')
        && Math.hypot(
          block.position.x - binding.target.x,
          block.position.y - binding.target.y,
          block.position.z - binding.target.z,
        ) <= 48
      ),
      maxDistance: 64,
    });
  } catch {
    associatedBed = null;
  }
  const distance = after?.position
    ? Math.hypot(
        after.position.x - binding.target.x,
        after.position.y - binding.target.y,
        after.position.z - binding.target.z,
      )
    : Number.POSITIVE_INFINITY;
  const verified = Boolean(
    observed?.name === 'bell'
    && (associatedVillager || associatedBed?.position)
    && distance <= binding.closeness + 0.75
    && (!binding.dimension || after.dimension === binding.dimension)
  );
  return immutable({
    ok: verified,
    code: verified ? 'village_observation_verified' : CAPABILITY_OUTCOME_CODES.VERIFICATION,
    detail: verified
      ? 'Minecraft confirmed the village bell, an associated villager or bed, and Kevin\'s arrival at the exact saved location.'
      : 'Minecraft did not confirm the village bell, an associated villager or bed, and arrival together.',
    target: binding.target,
    distance: Number.isFinite(distance) ? distance : null,
  });
}

function verifyNavigation(_before, after, binding) {
  const position = after?.position;
  const distance = position
    ? Math.hypot(position.x - binding.x, position.y - binding.y, position.z - binding.z)
    : Number.POSITIVE_INFINITY;
  const verified = Boolean(
    position
    && distance <= binding.closeness + 0.75
    && (!binding.dimension || after.dimension === binding.dimension)
  );
  return immutable({
    ok: verified,
    code: verified ? 'navigation_verified' : CAPABILITY_OUTCOME_CODES.VERIFICATION,
    detail: verified
      ? `Minecraft confirmed arrival within ${distance.toFixed(2)} blocks.`
      : 'Minecraft did not confirm arrival at the bound destination.',
    distance: Number.isFinite(distance) ? distance : null,
  });
}

function verifyGuidedNavigation(_before, after, binding, { agent } = {}) {
  const resolution = resolveCapabilityPlayer({ agent, bot: agent?.bot }, binding.player);
  const player = resolution.entity;
  const botDistance = after?.position
    ? Math.hypot(after.position.x - binding.x, after.position.y - binding.y, after.position.z - binding.z)
    : Number.POSITIVE_INFINITY;
  const playerDistance = player?.position
    ? Math.hypot(player.position.x - binding.x, player.position.y - binding.y, player.position.z - binding.z)
    : Number.POSITIVE_INFINITY;
  const verified = Boolean(
    botDistance <= binding.closeness + 0.75
    && playerDistance <= binding.playerCloseness
    && (!binding.dimension || after.dimension === binding.dimension)
  );
  return immutable({
    ok: verified,
    code: verified ? 'guided_navigation_verified' : CAPABILITY_OUTCOME_CODES.VERIFICATION,
    detail: verified
      ? `Minecraft confirmed Kevin and ${binding.player} arrived together at the saved destination.`
      : `Minecraft did not confirm both Kevin and ${binding.player} at the saved destination.`,
    botDistance: Number.isFinite(botDistance) ? botDistance : null,
    playerDistance: Number.isFinite(playerDistance) ? playerDistance : null,
  });
}

function verifyMiningRouteCell(_before, after, binding, { result } = {}) {
  const position = after?.position;
  const skill = result?.evidence?.skill;
  const exactPosition = Boolean(
    position
    && Math.floor(position.x) === binding.x
    && Math.floor(position.y) === binding.y
    && Math.floor(position.z) === binding.z
  );
  const exactEvidence = Boolean(
    skill?.kind === 'mining_return'
    && skill?.outcome === 'route_cell_returned'
    && skill?.returnable === true
    && Number(skill?.target?.x) === binding.x
    && Number(skill?.target?.y) === binding.y
    && Number(skill?.target?.z) === binding.z
  );
  const verified = Boolean(
    exactPosition
    && exactEvidence
    && (!binding.dimension || after.dimension === binding.dimension)
  );
  return immutable({
    ok: verified,
    code: verified ? 'mining_route_cell_verified' : CAPABILITY_OUTCOME_CODES.VERIFICATION,
    detail: verified
      ? `Minecraft confirmed the exact returnable mining cell ${binding.x}, ${binding.y}, ${binding.z}.`
      : `Minecraft did not confirm the exact returnable mining cell ${binding.x}, ${binding.y}, ${binding.z}.`,
  });
}

function verifySearchRegionRelocation(before, after, binding) {
  const origin = before?.position;
  const position = after?.position;
  const targetDistance = position
    ? Math.hypot(position.x - binding.x, position.y - binding.y, position.z - binding.z)
    : Number.POSITIVE_INFINITY;
  const horizontalDisplacement = origin && position
    ? Math.hypot(position.x - origin.x, position.z - origin.z)
    : 0;
  const sameDimension = Boolean(
    origin
    && position
    && (!binding.dimension || after.dimension === binding.dimension)
  );
  const reachedTarget = targetDistance <= binding.closeness + 0.75;
  const changedRegion = horizontalDisplacement >= binding.minimumDisplacement;
  const verified = sameDimension && (reachedTarget || changedRegion);
  return immutable({
    ok: verified,
    code: verified ? 'search_region_relocation_verified' : CAPABILITY_OUTCOME_CODES.VERIFICATION,
    detail: verified
      ? reachedTarget
        ? `Minecraft confirmed arrival in the requested search region (${targetDistance.toFixed(2)} blocks from its center).`
        : `Minecraft confirmed a ${horizontalDisplacement.toFixed(2)}-block move into a distinct search region.`
      : `Minecraft did not confirm the required ${binding.minimumDisplacement}-block search-region change.`,
    targetDistance: Number.isFinite(targetDistance) ? targetDistance : null,
    horizontalDisplacement,
    reachedTarget,
    changedRegion,
  });
}

function verifyExactStorage(_before, _after, binding, { result } = {}) {
  const skill = result?.evidence?.skill;
  const transferred = Math.max(0, Math.min(
    Number(skill?.inventoryTransferred) || Number(skill?.transferred) || 0,
    Number(skill?.containerTransferred) || Number(skill?.transferred) || 0,
  ));
  const targetMatches = Boolean(
    skill?.target
    && ['x', 'y', 'z'].every(axis => Number(skill.target[axis]) === Number(binding.container[axis]))
  );
  const verified = Boolean(
    skill?.kind === 'chest_transfer'
    && skill?.outcome === 'deposited'
    && skill?.item === binding.item
    && targetMatches
    && transferred === binding.quantity
    && skill?.unrelatedPreserved === true
  );
  return immutable({
    ok: verified,
    code: verified ? 'storage_verified' : CAPABILITY_OUTCOME_CODES.VERIFICATION,
    detail: verified
      ? `Minecraft confirmed ${transferred} ${binding.item} in the exact container.`
      : `Minecraft confirmed ${transferred} of ${binding.quantity} ${binding.item} transferred to the exact container.`,
    item: binding.item,
    requestedQuantity: binding.quantity,
    transferred,
  });
}

defineCapability({
  id: 'collect_wood',
  parameters: {
    count: { type: 'integer', minimum: 1, maximum: 64 },
    range: { type: 'integer', minimum: 16, maximum: 512 },
    expectedIncrease: { type: 'integer', minimum: 1 },
    completeStartedTree: { type: 'boolean' },
  },
  normalizeArguments: args => immutable({
    count: boundedInteger(args?.count, 1, 1, 64),
    range: boundedInteger(args?.range, 64, 16, 512),
    expectedIncrease: boundedInteger(args?.expectedIncrease ?? args?.count, 1, 1, 64),
    // Natural trees are a world-stewardship unit. Once an ordinary collection
    // action starts a bounded connected tree, leaving its upper half floating
    // is worse than carrying a few logs beyond the requested minimum.
    completeStartedTree: args?.completeStartedTree !== false,
  }),
  preconditions: (_snapshot, args) => preconditionReport([
    { requirement: 'positive bounded wood count', satisfied: args.count >= 1 && args.count <= 64 },
    { requirement: 'positive bounded search range', satisfied: args.range >= 16 && args.range <= 512 },
  ]),
  expectedEffects: (_snapshot, args) => [inventoryEffect('logs', args.expectedIncrease, 'logs')],
  bind: (_context, args, _signal) => immutable({
    ok: true,
    commandName: '!collectWoodInRange',
    // GoalDirector owns region changes between productive planner actions.
    // Keeping this action to one region prevents the physical skill from
    // spending several hidden relocations before the Director can replan.
    command: `!collectWoodInRange(${args.count}, ${args.range}, false, ${args.completeStartedTree})`,
  }),
  execute: executeBoundCommand,
  verify: verifyEffects,
  cost: (_snapshot, args) => args.count * Math.max(1, Math.ceil(args.range / 16)),
});

function verifySurfaceAccess(_before, _after, _binding, { result } = {}) {
  const skill = result?.evidence?.skill;
  const verified = Boolean(
    skill?.kind === 'surface_navigation'
    && skill?.outcome === 'surface_reached'
    && [skill?.target?.x, skill?.target?.y, skill?.target?.z].every(Number.isFinite)
  );
  return immutable({
    ok: verified,
    code: verified ? 'surface_access_verified' : CAPABILITY_OUTCOME_CODES.VERIFICATION,
    detail: verified
      ? `Minecraft confirmed a supported surface stance at ${skill.target.x}, ${skill.target.y}, ${skill.target.z}.`
      : 'Minecraft did not confirm a supported surface stance.',
  });
}

function verifyMiningDepth(_before, after, binding, { result } = {}) {
  const skill = result?.evidence?.skill;
  const targetY = Number(binding.targetY);
  const observedY = Number(after?.position?.y ?? skill?.observedY);
  const reached = Boolean(
    Number.isFinite(observedY)
    && Math.abs(observedY - targetY) <= 8
    && ['already_at_depth', 'productive_depth_reached', 'staircase_depth_reached'].includes(skill?.outcome)
  );
  const advanced = Boolean(
    skill?.kind === 'mining_relocation'
    && skill?.outcome === 'mining_depth_advanced'
    && skill?.routeDigging === true
    && skill?.returnable === true
    && Number(skill?.verticalProgress) >= 1
    && [skill?.observedPosition?.x, skill?.observedPosition?.y, skill?.observedPosition?.z]
      .every(Number.isFinite)
  );
  const verified = Boolean(skill?.kind === 'mining_relocation' && (reached || advanced));
  return immutable({
    ok: verified,
    code: reached
      ? 'mining_depth_verified'
      : advanced
        ? 'mining_depth_progress_verified'
        : CAPABILITY_OUTCOME_CODES.VERIFICATION,
    detail: reached
      ? `Minecraft confirmed the productive y=${targetY} mining band.`
      : advanced
        ? `Minecraft confirmed ${skill.verticalProgress} returnable vertical block(s) of mining-depth progress.`
        : `Minecraft did not confirm returnable progress toward the y=${targetY} mining band.`,
    targetReached: reached,
    verticalProgress: advanced ? Number(skill.verticalProgress) : 0,
  });
}

function equivalentMiningSource(left, right) {
  const base = value => canonicalName(value).replace(/^deepslate_/, '');
  return Boolean(base(left) && base(left) === base(right));
}

function verifyMiningCorridor(before, after, binding, { result } = {}) {
  const skill = result?.evidence?.skill;
  const sourceMatches = equivalentMiningSource(skill?.target?.name, binding.source);
  const previous = Math.max(0, Number(before?.inventory?.get(binding.output)) || 0);
  const current = Math.max(0, Number(after?.inventory?.get(binding.output)) || 0);
  const observedIncrease = Math.max(0, current - previous);
  const resourceCollected = Boolean(
    skill?.kind === 'mining_search'
    && skill?.outcome === 'resource_collected'
    && sourceMatches
    && observedIncrease >= 1
  );
  const corridorAdvanced = Boolean(
    skill?.kind === 'mining_search'
    && skill?.outcome === 'search_advanced'
    && sourceMatches
    && skill?.routeDigging === true
    && skill?.returnable === true
    && Number(skill?.routeSteps) >= 1
    && [skill?.observedPosition?.x, skill?.observedPosition?.y, skill?.observedPosition?.z]
      .every(Number.isFinite)
  );
  const verified = resourceCollected || corridorAdvanced;
  return immutable({
    ok: verified,
    code: resourceCollected
      ? 'mining_corridor_resource_verified'
      : corridorAdvanced
        ? 'mining_corridor_progress_verified'
        : CAPABILITY_OUTCOME_CODES.VERIFICATION,
    detail: resourceCollected
      ? `Minecraft confirmed ${observedIncrease} additional ${binding.output} from the mining corridor.`
      : corridorAdvanced
        ? `Minecraft confirmed a returnable ${skill.routeSteps}-step mining-corridor advance.`
        : 'Minecraft did not confirm either requested resource output or returnable corridor progress.',
    observedIncrease,
    corridorAdvanced,
    resourceCollected,
  });
}

defineCapability({
  id: 'reach_surface',
  parameters: {},
  normalizeArguments: () => immutable({}),
  preconditions: () => preconditionReport([
    { requirement: 'connected surface navigation primitive', satisfied: true },
  ]),
  expectedEffects: () => [immutable({ kind: 'surface_access' })],
  bind: () => immutable({
    ok: true,
    commandName: '!goToSurface',
    command: '!goToSurface',
  }),
  execute: executeBoundCommand,
  verify: verifySurfaceAccess,
  cost: () => 4,
});

defineCapability({
  id: 'reach_mining_depth',
  parameters: {
    targetY: { type: 'integer', minimum: -60, maximum: 300 },
    range: { type: 'integer', minimum: 16, maximum: 128 },
    preservedReturnRoute: { type: 'point_list', maximum: 512 },
  },
  normalizeArguments: args => immutable({
    targetY: boundedInteger(args?.targetY, 16, -60, 300),
    range: boundedInteger(args?.range, 64, 16, 128),
    preservedReturnRoute: normalizeMiningReturnRoute(args?.preservedReturnRoute),
  }),
  preconditions: snapshot => preconditionReport([
    { requirement: 'connected supported mining stance', satisfied: Boolean(snapshot.position) },
  ]),
  expectedEffects: (_snapshot, args) => [immutable({
    kind: 'mining_depth_progress',
    targetY: args.targetY,
  })],
  bind: (_context, args) => immutable({
    ok: true,
    commandName: '!goToMiningDepth',
    command: `!goToMiningDepth(${args.targetY}, ${args.range}, ${args.preservedReturnRoute.length})`,
    targetY: args.targetY,
    preservedReturnRouteCells: args.preservedReturnRoute.length,
  }),
  execute: executeBoundCommand,
  verify: verifyMiningDepth,
  cost: (_snapshot, args) => Math.max(2, Math.ceil(args.range / 16)),
});

defineCapability({
  id: 'advance_mining_corridor',
  parameters: {
    source: { type: 'block_name' },
    output: { type: 'item_name' },
    length: { type: 'integer', minimum: 4, maximum: 32 },
    preservedReturnRoute: { type: 'point_list', maximum: 512 },
    excludedTargets: { type: 'target_list', maximum: 24 },
  },
  normalizeArguments: args => immutable({
    source: canonicalName(args?.source),
    output: canonicalName(args?.output),
    length: boundedInteger(args?.length, 8, 4, 32),
    preservedReturnRoute: normalizeMiningReturnRoute(args?.preservedReturnRoute),
    excludedTargets: normalizeExcludedTargets(args?.excludedTargets),
  }),
  preconditions: (snapshot, args) => preconditionReport([
    { requirement: `registered mining source ${args.source}`, satisfied: validName(args.source) && snapshot.hasBlock(args.source) },
    { requirement: `registered mining output ${args.output}`, satisfied: validName(args.output) && snapshot.hasItem(args.output) },
    { requirement: 'connected supported mining stance', satisfied: Boolean(snapshot.position) },
  ]),
  expectedEffects: (_snapshot, args) => [immutable({
    kind: 'mining_corridor_progress',
    source: args.source,
    output: args.output,
  })],
  bind: (_context, args) => immutable({
    ok: true,
    commandName: '!mineSearchTunnel',
    command: `!mineSearchTunnel(${commandString(args.source)}, ${args.length}, ${args.preservedReturnRoute.length})`,
    source: args.source,
    output: args.output,
    preservedReturnRouteCells: args.preservedReturnRoute.length,
    excludedTargets: args.excludedTargets,
    target: { name: args.source },
  }),
  execute: executeBoundCommand,
  verify: verifyMiningCorridor,
  cost: (_snapshot, args) => args.length,
});

defineCapability({
  id: 'survey_nearby_cave',
  parameters: {
    home: { type: 'point' },
    range: { type: 'integer', minimum: 16, maximum: 128 },
    excludedTargets: { type: 'target_list', maximum: 24 },
    light: { type: 'boolean' },
  },
  normalizeArguments: args => immutable({
    home: normalizePoint(args?.home),
    range: boundedInteger(args?.range, 64, 16, 128),
    excludedTargets: normalizeExcludedTargets(args?.excludedTargets),
    light: args?.light !== false,
  }),
  preconditions: (snapshot, args) => preconditionReport([
    { requirement: 'finite home-base position', satisfied: [args.home.x, args.home.y, args.home.z].every(Number.isFinite) },
    { requirement: 'connected cave observations', satisfied: Boolean(snapshot.position) },
    { requirement: 'carried torch when lighting is requested', satisfied: !args.light || (Number(snapshot.inventory.get('torch')) || 0) > 0 },
  ]),
  expectedEffects: (_snapshot, args) => [immutable({
    kind: args.light ? 'cave_route_lit' : 'cave_route_observed',
  })],
  bind: bindNearbyCave,
  execute: executeBoundCommand,
  verify: verifyCaveSurvey,
  cost: (_snapshot, args) => Math.max(4, Math.ceil(args.range / 8)),
});

defineCapability({
  id: 'observe_useful_animal',
  parameters: {
    home: { type: 'point' },
    range: { type: 'integer', minimum: 16, maximum: 128 },
  },
  normalizeArguments: args => immutable({
    home: normalizePoint(args?.home),
    range: boundedInteger(args?.range, 64, 16, 128),
  }),
  preconditions: (snapshot, args) => preconditionReport([
    { requirement: 'finite scout origin', satisfied: [args.home.x, args.home.y, args.home.z].every(Number.isFinite) },
    { requirement: 'connected entity observations', satisfied: Boolean(snapshot.position) },
  ]),
  expectedEffects: () => [immutable({ kind: 'useful_animal_observed' })],
  bind: bindUsefulAnimal,
  execute: executeBoundCommand,
  verify: verifyUsefulAnimal,
  cost: () => 2,
});

defineCapability({
  id: 'observe_village',
  parameters: {
    home: { type: 'point' },
    range: { type: 'integer', minimum: 16, maximum: 128 },
    searchLimit: { type: 'number', optional: true },
  },
  normalizeArguments: args => immutable({
    home: normalizePoint(args?.home),
    range: boundedInteger(args?.range, 64, 16, 128),
    searchLimit: Number.isSafeInteger(Number(args?.searchLimit)) && Number(args.searchLimit) > 0
      ? Number(args.searchLimit)
      : null,
  }),
  preconditions: (snapshot, args) => preconditionReport([
    { requirement: 'finite scout origin', satisfied: [args.home.x, args.home.y, args.home.z].every(Number.isFinite) },
    { requirement: 'connected block observations', satisfied: Boolean(snapshot.position) },
    { requirement: 'registered village bell', satisfied: snapshot.hasBlock('bell') },
  ]),
  expectedEffects: () => [immutable({ kind: 'village_observed' })],
  bind: bindVillage,
  execute: executeBoundCommand,
  verify: verifyVillageObservation,
  cost: () => 2,
});

defineCapability({
  id: 'collect_exposed_ore',
  parameters: {
    home: { type: 'point' },
    range: { type: 'integer', minimum: 8, maximum: 64 },
    excludedTargets: { type: 'target_list', maximum: 24 },
    targets: { type: 'canonical_list', maximum: 24 },
  },
  normalizeArguments: args => immutable({
    home: normalizePoint(args?.home),
    range: boundedInteger(args?.range, 32, 8, 64),
    excludedTargets: normalizeExcludedTargets(args?.excludedTargets),
    targets: normalizeCanonicalTargets(args?.targets),
  }),
  preconditions: (snapshot, args) => preconditionReport([
    { requirement: 'finite protected home-base position', satisfied: [args.home.x, args.home.y, args.home.z].every(Number.isFinite) },
    { requirement: 'connected ore observations', satisfied: Boolean(snapshot.position) },
  ]),
  expectedEffects: () => [inventoryEffect('ores', 1, 'ores')],
  bind: bindExposedOre,
  execute: executeBoundCommand,
  verify: verifyReturnableExposedOreCollection,
  cost: (_snapshot, args) => Math.max(2, Math.ceil(args.range / 8)),
});

defineCapability({
  id: 'navigate_exact',
  parameters: {
    x: { type: 'number' },
    y: { type: 'number' },
    z: { type: 'number' },
    closeness: { type: 'number', minimum: 0, maximum: 16 },
    dimension: { type: 'dimension' },
  },
  normalizeArguments: args => immutable({
    x: Number(args?.x),
    y: Number(args?.y),
    z: Number(args?.z),
    closeness: Math.max(0, Math.min(16, Number(args?.closeness) || 2)),
    dimension: canonicalName(args?.dimension),
  }),
  preconditions: (snapshot, args) => preconditionReport([
    { requirement: 'finite destination', satisfied: [args.x, args.y, args.z].every(Number.isFinite) },
    { requirement: `current dimension ${args.dimension}`, satisfied: !args.dimension || snapshot.dimension === args.dimension },
  ]),
  expectedEffects: (_snapshot, args) => [immutable({
    kind: 'position',
    x: args.x,
    y: args.y,
    z: args.z,
    closeness: args.closeness,
  })],
  bind: (_context, args) => immutable({
    ok: true,
    commandName: '!goToCoordinates',
    command: `!goToCoordinates(${args.x}, ${args.y}, ${args.z}, ${args.closeness})`,
    x: args.x,
    y: args.y,
    z: args.z,
    closeness: args.closeness,
    dimension: args.dimension,
  }),
  execute: executeBoundCommand,
  verify: verifyNavigation,
  cost: () => 2,
});

defineCapability({
  id: 'guide_player_exact',
  parameters: {
    player: { type: 'player_name' },
    x: { type: 'number' },
    y: { type: 'number' },
    z: { type: 'number' },
    closeness: { type: 'number', minimum: 0 },
    leashDistance: { type: 'number', minimum: 4 },
    dimension: { type: 'dimension' },
  },
  normalizeArguments: args => immutable({
    player: playerIdentity(args?.player),
    x: Number(args?.x),
    y: Number(args?.y),
    z: Number(args?.z),
    closeness: Math.max(0, Number(args?.closeness) || 2),
    leashDistance: Math.max(4, Number(args?.leashDistance) || 12),
    dimension: canonicalName(args?.dimension),
  }),
  preconditions: (snapshot, args) => preconditionReport([
    { requirement: 'named player to guide', satisfied: Boolean(args.player) },
    { requirement: 'finite destination', satisfied: [args.x, args.y, args.z].every(Number.isFinite) },
    { requirement: `current dimension ${args.dimension}`, satisfied: !args.dimension || snapshot.dimension === args.dimension },
  ]),
  expectedEffects: (_snapshot, args) => [immutable({
    kind: 'guided_position',
    player: args.player,
    x: args.x,
    y: args.y,
    z: args.z,
  })],
  bind: (context, args) => {
    const resolution = resolveCapabilityPlayer(context, args.player);
    if (!resolution.entity) {
      return immutable({
        ok: false,
        code: 'source_not_found',
        detail: `${args.player} is not physically loaded beside Kevin for the guide route.`,
      });
    }
    const player = resolution.canonical || args.player;
    return immutable({
      ok: true,
      commandName: '!guidePlayerToCoordinates',
      command: `!guidePlayerToCoordinates(${commandString(player)}, ${args.x}, ${args.y}, ${args.z}, ${args.closeness}, ${args.leashDistance})`,
      player,
      playerEntityId: Number.isFinite(resolution.entity.id) ? resolution.entity.id : null,
      x: args.x,
      y: args.y,
      z: args.z,
      closeness: args.closeness,
      playerCloseness: args.closeness + 4,
      leashDistance: args.leashDistance,
      dimension: args.dimension,
      target: { name: 'guided_destination', x: args.x, y: args.y, z: args.z },
    });
  },
  execute: executeBoundCommand,
  verify: verifyGuidedNavigation,
  cost: () => 3,
});

defineCapability({
  id: 'traverse_mining_route_cell',
  commandName: '!traverseMiningRouteCell',
  parameters: {
    x: { type: 'number' },
    y: { type: 'number' },
    z: { type: 'number' },
    dimension: { type: 'dimension' },
  },
  normalizeArguments: args => immutable({
    x: Math.floor(Number(args?.x)),
    y: Math.floor(Number(args?.y)),
    z: Math.floor(Number(args?.z)),
    dimension: canonicalName(args?.dimension),
  }),
  preconditions: (snapshot, args) => preconditionReport([
    { requirement: 'finite preserved mining-route cell', satisfied: [args.x, args.y, args.z].every(Number.isFinite) },
    { requirement: `current dimension ${args.dimension}`, satisfied: !args.dimension || snapshot.dimension === args.dimension },
  ]),
  expectedEffects: (_snapshot, args) => [immutable({
    kind: 'position',
    x: args.x,
    y: args.y,
    z: args.z,
    closeness: 0.75,
  })],
  command: args => `!traverseMiningRouteCell(${args.x}, ${args.y}, ${args.z})`,
  bind: (_context, args) => immutable({
    ok: true,
    commandName: '!traverseMiningRouteCell',
    command: `!traverseMiningRouteCell(${args.x}, ${args.y}, ${args.z})`,
    x: args.x,
    y: args.y,
    z: args.z,
    closeness: 0.75,
    dimension: args.dimension,
  }),
  execute: executeBoundCommand,
  verify: verifyMiningRouteCell,
  cost: () => 1,
});

defineCapability({
  id: 'relocate_search_region',
  parameters: {
    x: { type: 'number' },
    y: { type: 'number' },
    z: { type: 'number' },
    closeness: { type: 'number', minimum: 0, maximum: 16 },
    minimumDisplacement: { type: 'number', minimum: 8, maximum: 32 },
    dimension: { type: 'dimension' },
  },
  normalizeArguments: args => immutable({
    x: Number(args?.x),
    y: Number(args?.y),
    z: Number(args?.z),
    closeness: Math.max(0, Math.min(16, Number(args?.closeness) || 8)),
    minimumDisplacement: Math.max(8, Math.min(32, Number(args?.minimumDisplacement) || 16)),
    dimension: canonicalName(args?.dimension),
  }),
  preconditions: (snapshot, args) => preconditionReport([
    { requirement: 'finite current position', satisfied: Boolean(snapshot.position) },
    { requirement: 'finite search-region destination', satisfied: [args.x, args.y, args.z].every(Number.isFinite) },
    { requirement: `current dimension ${args.dimension}`, satisfied: !args.dimension || snapshot.dimension === args.dimension },
  ]),
  expectedEffects: (_snapshot, args) => [immutable({
    kind: 'search_region_change',
    minimumDisplacement: args.minimumDisplacement,
  })],
  bind: (_context, args) => immutable({
    ok: true,
    commandName: '!goToCoordinates',
    command: `!goToCoordinates(${args.x}, ${args.y}, ${args.z}, ${args.closeness})`,
    x: args.x,
    y: args.y,
    z: args.z,
    closeness: args.closeness,
    minimumDisplacement: args.minimumDisplacement,
    dimension: args.dimension,
  }),
  execute: executeBoundCommand,
  verify: verifySearchRegionRelocation,
  cost: () => 2,
});

defineCapability({
  id: 'store_exact_item',
  parameters: {
    item: { type: 'item_name' },
    quantity: { type: 'integer', minimum: 1, maximum: 2304 },
    container: { type: 'exact_container' },
  },
  normalizeArguments: args => immutable({
    item: canonicalName(args?.item),
    quantity: boundedInteger(args?.quantity, 1, 1, 2304),
    container: {
      name: canonicalName(args?.container?.name),
      x: Number(args?.container?.x),
      y: Number(args?.container?.y),
      z: Number(args?.container?.z),
      dimension: canonicalName(args?.container?.dimension),
    },
  }),
  preconditions: (snapshot, args) => preconditionReport([
    { requirement: `registered carried item ${args.item}`, satisfied: snapshot.hasItem(args.item) && (Number(snapshot.inventory.get(args.item)) || 0) >= args.quantity },
    { requirement: 'exact chest or barrel binding', satisfied: ['chest', 'trapped_chest', 'barrel'].includes(args.container.name) && [args.container.x, args.container.y, args.container.z].every(Number.isFinite) },
    { requirement: `current dimension ${args.container.dimension}`, satisfied: snapshot.dimension === args.container.dimension },
  ]),
  expectedEffects: (_snapshot, args) => [immutable({
    kind: 'verified_storage',
    item: args.item,
    quantity: args.quantity,
    container: args.container,
  })],
  bind: (_context, args) => immutable({
    ok: true,
    commandName: '!putInChestAt',
    command: `!putInChestAt(${commandString(args.item)}, ${args.quantity}, ${args.container.x}, ${args.container.y}, ${args.container.z}, ${commandString(args.container.dimension)})`,
    item: args.item,
    quantity: args.quantity,
    container: args.container,
  }),
  execute: executeBoundCommand,
  verify: verifyExactStorage,
  cost: (_snapshot, args) => args.quantity,
});

defineCapability({
  id: 'harvest_mature_crop',
  parameters: {
    crop: { type: 'block_name' },
    output: { type: 'item_name' },
    count: { type: 'integer', minimum: 1, maximum: 64 },
    range: { type: 'integer', minimum: 16, maximum: 512 },
    expectedIncrease: { type: 'integer', minimum: 1 },
  },
  normalizeArguments: args => immutable({
    crop: canonicalName(args?.crop),
    output: canonicalName(args?.output),
    count: boundedInteger(args?.count, 1, 1, 64),
    range: boundedInteger(args?.range, 64, 16, 512),
    expectedIncrease: boundedInteger(args?.expectedIncrease ?? args?.count, 1, 1, 64),
  }),
  preconditions: (snapshot, args) => preconditionReport([
    { requirement: `registered crop block ${args.crop}`, satisfied: validName(args.crop) && snapshot.hasBlock(args.crop) },
    { requirement: `registered crop output ${args.output}`, satisfied: validName(args.output) && snapshot.hasItem(args.output) },
    { requirement: 'positive bounded harvest count', satisfied: args.count >= 1 && args.count <= 64 },
  ]),
  expectedEffects: (_snapshot, args) => [inventoryEffect(args.output, args.expectedIncrease)],
  bind: (_context, args) => immutable({
    ok: true,
    commandName: '!harvestMatureCrop',
    command: `!harvestMatureCrop(${commandString(args.crop)}, ${commandString(args.output)}, ${args.count}, ${args.range})`,
  }),
  execute: executeBoundCommand,
  verify: verifyEffects,
  cost: (_snapshot, args) => args.count * Math.max(1, Math.ceil(args.range / 16)),
});

defineCapability({
  id: 'collect_block',
  parameters: {
    source: { type: 'block_name' },
    output: { type: 'item_name' },
    count: { type: 'integer', minimum: 1, maximum: 2304 },
    range: { type: 'integer', minimum: 16, maximum: 512 },
    expectedIncrease: { type: 'integer', minimum: 1 },
  },
  normalizeArguments: args => immutable({
    source: canonicalName(args?.source),
    output: canonicalName(args?.output),
    count: boundedInteger(args?.count, 1, 1, 2304),
    range: boundedInteger(args?.range, 64, 16, 512),
    expectedIncrease: boundedInteger(args?.expectedIncrease ?? args?.count, 1, 1, 2304),
  }),
  preconditions: (snapshot, args) => preconditionReport([
    { requirement: `registered source block ${args.source}`, satisfied: validName(args.source) && snapshot.hasBlock(args.source) },
    { requirement: `registered output item ${args.output}`, satisfied: validName(args.output) && snapshot.hasItem(args.output) },
    { requirement: 'positive bounded collection count', satisfied: args.count >= 1 && args.count <= 2304 },
  ]),
  expectedEffects: (_snapshot, args) => [inventoryEffect(args.output, args.expectedIncrease)],
  bind: (_context, args, _signal) => immutable({
    ok: true,
    commandName: '!collectBlocksInRange',
    // Recovery is a Director transition, not part of a productive capability
    // attempt. The bounded collector scans and acts in exactly one region.
    command: `!collectBlocksInRange(${commandString(args.source)}, ${args.count}, ${args.range})`,
  }),
  execute: executeBoundCommand,
  verify: verifyEffects,
  cost: (_snapshot, args) => args.count * Math.max(1, Math.ceil(args.range / 16)),
});

defineCapability({
  id: 'harvest_entity_drop',
  parameters: {
    source: { type: 'entity_name' },
    output: { type: 'item_name' },
    method: { type: 'enum', values: ['shear', 'kill'] },
    count: { type: 'integer', minimum: 1, maximum: 64 },
    range: { type: 'integer', minimum: 16, maximum: 512 },
    allowAlternative: { type: 'boolean' },
    targetEntityId: { type: 'integer', minimum: 1, maximum: 2_147_483_647 },
    expectedIncrease: { type: 'integer', minimum: 1 },
  },
  normalizeArguments: args => immutable({
    source: canonicalName(args?.source),
    output: canonicalName(args?.output),
    method: canonicalName(args?.method),
    count: boundedInteger(args?.count, 1, 1, 64),
    range: boundedInteger(args?.range, 64, 16, 512),
    allowAlternative: args?.allowAlternative === true,
    targetEntityId: optionalBoundedInteger(args?.targetEntityId, 1, 2_147_483_647),
    expectedIncrease: boundedInteger(args?.expectedIncrease ?? args?.count, 1, 1, 64),
  }),
  preconditions: (snapshot, args) => preconditionReport([
    { requirement: `registered source entity ${args.source}`, satisfied: validName(args.source) && snapshot.hasEntity(args.source) },
    { requirement: `registered output item ${args.output}`, satisfied: validName(args.output) && snapshot.hasItem(args.output) },
    { requirement: 'supported entity harvest method', satisfied: ['shear', 'kill'].includes(args.method) },
    { requirement: 'positive bounded harvest count', satisfied: args.count >= 1 && args.count <= 64 },
    { requirement: 'valid optional entity identity', satisfied: args.targetEntityId === null || Number.isInteger(args.targetEntityId) },
  ]),
  expectedEffects: (_snapshot, args) => [inventoryEffect(args.output, args.expectedIncrease)],
  bind: (_context, args, _signal) => immutable({
    ok: true,
    commandName: '!harvestEntityDrop',
    command: `!harvestEntityDrop(${commandString(args.source)}, ${commandString(args.output)}, ${commandString(args.method)}, ${args.count}, ${args.range}${args.targetEntityId !== null ? `, ${args.allowAlternative}, ${args.targetEntityId}` : args.allowAlternative ? ', true' : ''})`,
    targetEntityId: args.targetEntityId,
  }),
  execute: executeBoundCommand,
  verify: verifyEffects,
  cost: (_snapshot, args) => args.count * Math.max(2, Math.ceil(args.range / 16)),
});

defineCapability({
  id: 'craft',
  parameters: {
    item: { type: 'item_name' },
    batches: { type: 'integer', minimum: 1 },
    expectedIncrease: { type: 'integer', minimum: 1 },
  },
  normalizeArguments: args => immutable({
    item: canonicalName(args?.item),
    batches: boundedInteger(args?.batches, 1, 1, 100_000),
    expectedIncrease: boundedInteger(args?.expectedIncrease, 1, 1, 100_000),
    workstation: normalizeWorkstationConstraint(args?.workstation, 'crafting_table'),
  }),
  preconditions: (snapshot, args) => preconditionReport([
    { requirement: `registered craft output ${args.item}`, satisfied: validName(args.item) && snapshot.hasItem(args.item) },
    { requirement: 'positive craft batch count', satisfied: args.batches >= 1 },
  ]),
  expectedEffects: (_snapshot, args) => [inventoryEffect(args.item, args.expectedIncrease)],
  bind: (_context, args, _signal) => immutable({
    ok: true,
    commandName: '!craftRecipe',
    command: `!craftRecipe(${commandString(args.item)}, ${args.batches}${workstationCommandSuffix(args.workstation)})`,
    workstation: args.workstation,
  }),
  execute: executeBoundCommand,
  verify: verifyEffects,
  cost: (_snapshot, args) => args.batches,
});

defineCapability({
  id: 'smelt',
  parameters: {
    input: { type: 'item_name' },
    output: { type: 'item_name' },
    count: { type: 'integer', minimum: 1 },
    expectedIncrease: { type: 'integer', minimum: 1 },
  },
  normalizeArguments: args => immutable({
    input: canonicalName(args?.input),
    output: canonicalName(args?.output),
    count: boundedInteger(args?.count, 1, 1, 100_000),
    expectedIncrease: boundedInteger(args?.expectedIncrease ?? args?.count, 1, 1, 100_000),
    workstation: normalizeWorkstationConstraint(args?.workstation, 'furnace'),
  }),
  preconditions: (snapshot, args) => preconditionReport([
    { requirement: `registered smelting input ${args.input}`, satisfied: validName(args.input) && snapshot.hasItem(args.input) },
    { requirement: `registered smelting output ${args.output}`, satisfied: validName(args.output) && snapshot.hasItem(args.output) },
    { requirement: 'positive smelting count', satisfied: args.count >= 1 },
  ]),
  expectedEffects: (_snapshot, args) => [inventoryEffect(args.output, args.expectedIncrease)],
  bind: (_context, args, _signal) => immutable({
    ok: true,
    commandName: '!smeltItem',
    command: `!smeltItem(${commandString(args.input)}, ${args.count}${workstationCommandSuffix(args.workstation)})`,
    workstation: args.workstation,
  }),
  execute: executeBoundCommand,
  verify: verifyEffects,
  cost: (_snapshot, args) => args.count * 10,
});

defineCapability({
  id: 'equip',
  parameters: {
    item: { type: 'item_name' },
    destination: { type: 'enum', values: ['main_hand', 'off_hand'] },
  },
  normalizeArguments: args => immutable({
    item: canonicalName(args?.item),
    destination: args?.destination === 'off_hand' ? 'off_hand' : 'main_hand',
  }),
  preconditions: (snapshot, args) => preconditionReport([
    { requirement: `carried item ${args.item}`, satisfied: (Number(snapshot.inventory.get(args.item)) || 0) > 0 },
    { requirement: 'supported equipment destination', satisfied: ['main_hand', 'off_hand'].includes(args.destination) },
  ]),
  expectedEffects: (_snapshot, args) => [immutable({
    kind: 'equipment',
    name: args.item,
    destination: args.destination,
  })],
  bind: (_context, args, _signal) => immutable({
    ok: true,
    commandName: '!equip',
    command: `!equip(${commandString(args.item)}, ${commandString(args.destination)})`,
  }),
  execute: executeBoundCommand,
  verify: verifyEffects,
  cost: () => 1,
});

function verifyExactDelivery(_before, _after, binding, { result } = {}) {
  const skill = result?.evidence?.skill;
  const transferred = Math.max(0, Math.floor(Number(skill?.transferred) || 0));
  const verified = Boolean(
    skill?.kind === 'give'
    && skill?.outcome === 'delivered'
    && skill?.item === binding.item
    && skill?.target?.canonicalName === binding.recipient
    && Number(skill?.requested) === binding.quantity
    && transferred === binding.quantity
  );
  return immutable({
    ok: verified,
    code: verified ? 'delivery_verified' : CAPABILITY_OUTCOME_CODES.VERIFICATION,
    detail: verified
      ? `Minecraft confirmed ${binding.recipient} received ${transferred} ${binding.item}.`
      : `Minecraft did not confirm that ${binding.recipient} received exactly ${binding.quantity} ${binding.item}.`,
    recipient: binding.recipient,
    item: binding.item,
    requestedQuantity: binding.quantity,
    transferred,
  });
}

function manifestsMatch(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((entry, index) => (
    entry?.item === right[index]?.item
    && Number(entry?.quantity) === Number(right[index]?.quantity)
  ));
}

function verifyFamilyDelivery(_before, _after, binding, { result } = {}) {
  const skill = result?.evidence?.skill;
  const deliveries = Array.isArray(skill?.deliveries) ? skill.deliveries : [];
  const manifest = Array.isArray(skill?.manifest) ? skill.manifest : [];
  const envelopeMatches = Boolean(
    skill?.kind === 'family_give'
    && skill?.family === binding.family
    && skill?.target?.canonicalName === binding.recipient
    && Number(skill?.requested) === binding.quantity
    && manifestsMatch(manifest, binding.manifest)
  );
  const verifiedDeliveries = envelopeMatches ? deliveries.filter((delivery, index) => {
    const expected = binding.manifest[index];
    return Boolean(
      expected
      && delivery?.item === expected.item
      && Number(delivery?.requested) === expected.quantity
      && Number(delivery?.transferred) === expected.quantity
      && delivery?.outcome === 'delivered'
      && delivery?.target?.canonicalName === binding.recipient
      && Number.isFinite(delivery?.droppedEntityId)
    );
  }) : [];
  const receiptTotal = verifiedDeliveries.reduce(
    (total, delivery) => total + Math.max(0, Math.floor(Number(delivery.transferred) || 0)),
    0,
  );
  const transferred = Number(skill?.transferred) === receiptTotal ? receiptTotal : 0;
  const verified = Boolean(
    envelopeMatches
    && skill?.outcome === 'delivered'
    && Number(skill?.transferred) === binding.quantity
    && transferred === binding.quantity
    && verifiedDeliveries.length === binding.manifest.length
  );
  return immutable({
    ok: verified,
    code: verified ? 'delivery_verified' : CAPABILITY_OUTCOME_CODES.VERIFICATION,
    detail: verified
      ? `Minecraft confirmed ${binding.recipient} received ${transferred} ${binding.family}.`
      : `Minecraft confirmed ${transferred} of ${binding.quantity} ${binding.family} for ${binding.recipient}.`,
    recipient: binding.recipient,
    family: binding.family,
    requestedQuantity: binding.quantity,
    transferred,
    remaining: Math.max(0, binding.quantity - transferred),
    manifest: binding.manifest,
    deliveries,
  });
}

defineCapability({
  id: 'deliver_exact_item',
  commandName: '!givePlayer',
  parameters: {
    player: { type: 'player_name' },
    item: { type: 'item_name' },
    quantity: { type: 'integer', minimum: 1, maximum: 2304 },
  },
  normalizeArguments: args => immutable({
    player: playerIdentity(args?.player),
    item: canonicalName(args?.item),
    quantity: boundedInteger(args?.quantity, 1, 1, 2304),
  }),
  preconditions: (snapshot, args, context) => {
    const resolution = resolveCapabilityPlayer(context, args.player);
    return preconditionReport([
      {
        requirement: `carried quantity ${args.quantity} ${args.item}`,
        satisfied: validName(args.item) && (Number(snapshot.inventory.get(args.item)) || 0) >= args.quantity,
      },
      {
        requirement: `present unambiguous player ${args.player}`,
        satisfied: Boolean(args.player && resolution.entity && resolution.canonical && !resolution.ambiguous),
      },
    ]);
  },
  expectedEffects: (_snapshot, args) => [immutable({
    kind: 'verified_delivery',
    player: args.player,
    item: args.item,
    quantity: args.quantity,
  })],
  command: args => `!givePlayer(${commandString(args.player)}, ${commandString(args.item)}, ${args.quantity})`,
  bind: (context, args, _signal) => {
    const resolution = resolveCapabilityPlayer(context, args.player);
    if (!resolution.entity || !resolution.canonical || resolution.ambiguous) {
      return immutable({
        ok: false,
        code: CAPABILITY_OUTCOME_CODES.BINDING,
        detail: `Delivery player '${args.player}' is absent or ambiguous.`,
      });
    }
    return immutable({
      ok: true,
      commandName: '!givePlayer',
      command: `!givePlayer(${commandString(resolution.canonical)}, ${commandString(args.item)}, ${args.quantity})`,
      recipient: resolution.canonical,
      recipientEntityId: Number.isFinite(resolution.entity.id) ? resolution.entity.id : null,
      item: args.item,
      quantity: args.quantity,
    });
  },
  execute: executeBoundCommand,
  verify: verifyExactDelivery,
  cost: () => 1,
});

defineCapability({
  id: 'deliver_item_family',
  commandName: '!giveFamilyToPlayer',
  parameters: {
    player: { type: 'player_name' },
    family: { type: 'item_family', values: SUPPORTED_ITEM_FAMILIES },
    quantity: { type: 'integer', minimum: 1, maximum: 2304 },
  },
  normalizeArguments: args => immutable({
    player: playerIdentity(args?.player),
    family: canonicalName(args?.family),
    quantity: boundedInteger(args?.quantity, 1, 1, 2304),
  }),
  preconditions: (snapshot, args, context) => {
    const resolution = resolveCapabilityPlayer(context, args.player);
    const carried = familyEntriesFromCounts(snapshot.inventory, args.family, context?.bot)
      .reduce((total, entry) => total + entry.count, 0);
    return preconditionReport([
      {
        requirement: `supported item family ${args.family}`,
        satisfied: SUPPORTED_ITEM_FAMILIES.includes(args.family),
      },
      {
        requirement: `carried quantity ${args.quantity} ${args.family}`,
        satisfied: carried >= args.quantity,
      },
      {
        requirement: `present unambiguous player ${args.player}`,
        satisfied: Boolean(args.player && resolution.entity && resolution.canonical && !resolution.ambiguous),
      },
    ]);
  },
  expectedEffects: (_snapshot, args) => [immutable({
    kind: 'verified_family_delivery',
    player: args.player,
    family: args.family,
    quantity: args.quantity,
  })],
  command: args => `!giveFamilyToPlayer(${commandString(args.family)}, ${commandString(args.player)}, ${args.quantity})`,
  bind: (context, args, _signal) => {
    const resolution = resolveCapabilityPlayer(context, args.player);
    if (!resolution.entity || !resolution.canonical || resolution.ambiguous) {
      return immutable({
        ok: false,
        code: CAPABILITY_OUTCOME_CODES.BINDING,
        detail: `Delivery player '${args.player}' is absent or ambiguous.`,
      });
    }
    const manifest = familyTransferManifest(context.bot, args.family, args.quantity);
    const boundQuantity = manifest.reduce((total, entry) => total + entry.quantity, 0);
    if (boundQuantity !== args.quantity) {
      return immutable({
        ok: false,
        code: CAPABILITY_OUTCOME_CODES.BINDING,
        detail: `Could not bind ${args.quantity} carried ${args.family} to concrete item stacks.`,
      });
    }
    return immutable({
      ok: true,
      commandName: '!giveFamilyToPlayer',
      command: `!giveFamilyToPlayer(${commandString(args.family)}, ${commandString(resolution.canonical)}, ${args.quantity})`,
      recipient: resolution.canonical,
      recipientEntityId: Number.isFinite(resolution.entity.id) ? resolution.entity.id : null,
      family: args.family,
      quantity: args.quantity,
      manifest,
    });
  },
  execute: executeBoundCommand,
  verify: verifyFamilyDelivery,
  cost: (_snapshot, args) => args.quantity,
});

export function getCapabilityDefinition(id) {
  return DEFINITIONS.get(String(id || '')) || null;
}

export function createCapabilityRequest(id, argumentsValue, metadata = {}) {
  const definition = getCapabilityDefinition(id);
  if (!definition) throw new TypeError(`Unknown capability '${id}'.`);
  return Object.freeze({
    ...metadata,
    capability: immutable({
      id: definition.id,
      arguments: definition.normalizeArguments(argumentsValue),
    }),
  });
}

export function createCapabilityPlanAction(id, argumentsValue, metadata = {}, {
  bot,
  inventory = null,
} = {}) {
  const definition = getCapabilityDefinition(id);
  if (!definition) throw new TypeError(`Unknown capability '${id}'.`);
  const args = definition.normalizeArguments(argumentsValue);
  const snapshot = captureCapabilitySnapshot(bot, { inventory });
  const preconditions = definition.preconditions(snapshot, args, { bot });
  if (!preconditions.ok) throw new TypeError(preconditions.detail);
  const expectedEffects = immutable(definition.expectedEffects(snapshot, args));
  const binding = definition.bind({ bot, snapshot }, args, null);
  if (!binding?.ok) throw new TypeError(binding?.detail || `Could not bind capability '${id}'.`);
  return Object.freeze({
    ...metadata,
    capability: immutable({
      id: definition.id,
      arguments: args,
      preconditions,
      expectedEffects,
      binding: { ...binding, expectedEffects },
      cost: definition.cost(snapshot, args),
    }),
  });
}

export function capabilityCommandName(capability) {
  const definition = getCapabilityDefinition(capability?.id);
  return String(capability?.binding?.commandName || definition?.commandName || '');
}

export function capabilityCommand(capability) {
  if (capability?.binding?.command) return String(capability.binding.command);
  const definition = getCapabilityDefinition(capability?.id);
  if (!definition || typeof definition.command !== 'function') return '';
  return String(definition.command(definition.normalizeArguments(capability?.arguments)) || '');
}

function bindingEvidence(binding) {
  if (!binding?.ok) return null;
  const evidence = {
    commandName: binding.commandName || null,
    recipient: binding.recipient || null,
    recipientEntityId: binding.recipientEntityId ?? null,
  };
  if (Object.prototype.hasOwnProperty.call(binding, 'item')) evidence.item = binding.item || null;
  if (Object.prototype.hasOwnProperty.call(binding, 'family')) evidence.family = binding.family || null;
  evidence.requestedQuantity = binding.quantity ?? null;
  if (Array.isArray(binding.manifest)) evidence.manifest = binding.manifest;
  if (binding.workstation) evidence.workstation = binding.workstation;
  if (binding.target) evidence.target = binding.target;
  if (binding.container) evidence.container = binding.container;
  return immutable(evidence);
}

function bindingReport(binding) {
  if (!binding) return null;
  return immutable({
    ok: binding.ok === true,
    code: binding.code || (binding.ok === true ? 'binding_satisfied' : CAPABILITY_OUTCOME_CODES.BINDING),
    detail: binding.detail || (binding.ok === true ? 'Capability binding is satisfied.' : 'Capability binding failed.'),
    ...(binding.inconclusive === true ? { inconclusive: true } : {}),
    ...(binding.routeStatus ? { routeStatus: binding.routeStatus } : {}),
    ...(binding.returnRouteStatus ? { returnRouteStatus: binding.returnRouteStatus } : {}),
  });
}

function capabilityFailure(code, detail, {
  capability = null,
  preconditions = null,
  binding = null,
  retryable = true,
} = {}) {
  return Object.freeze({
    actionId: `capability-${Date.now()}`,
    phase: 'failed',
    code,
    detail: String(detail || '').slice(0, 360),
    retryable,
    ...(binding?.inconclusive === true ? { inconclusive: true } : {}),
    ...(binding?.target ? { target: immutable(binding.target) } : {}),
    evidence: immutable({
      capability: {
        id: capability?.id || null,
        arguments: capability?.arguments || null,
        code,
        preconditions,
        binding: bindingEvidence(binding),
        bindingReport: bindingReport(binding),
      },
    }),
  });
}

function reconcileCapabilityResult(result, verification, capability, preconditions, binding) {
  if (!result || !verification) return result || null;
  const evidence = {
    ...(result.evidence || {}),
    capability: {
      id: capability?.id || null,
      arguments: capability?.arguments || null,
      preconditions,
      binding: bindingEvidence(binding),
      bindingReport: bindingReport(binding),
      verification,
      executorResult: {
        phase: result.phase,
        code: result.code,
        detail: result.detail,
        retryable: result.retryable === true,
      },
    },
  };

  const skill = result.evidence?.skill;
  const completionBlocked = skill?.completionBlocked === true;
  const verifiedMiningProgress = Boolean(
    skill?.kind === 'mining_search'
    && skill?.outcome === 'search_advanced'
    && skill?.routeDigging === true
    && skill?.returnable === true
    && Number(skill?.routeSteps) > 0
    && [
      skill?.target?.x,
      skill?.target?.y,
      skill?.target?.z,
      skill?.observedPosition?.x,
      skill?.observedPosition?.y,
      skill?.observedPosition?.z,
    ].every(Number.isFinite)
  );
  const verifiedSurfaceProgress = Boolean(
    skill?.kind === 'surface_navigation'
    && skill?.outcome === 'surface_progress_incomplete'
    && skill?.supported === true
    && Number(skill?.verticalProgress) > 0
    && [
      skill?.target?.x,
      skill?.target?.y,
      skill?.target?.z,
      skill?.observed?.x,
      skill?.observed?.y,
      skill?.observed?.z,
    ].every(Number.isFinite)
  );
  const verifiedEntityHarvestProgress = Boolean(
    skill?.kind === 'entity_harvest'
    && (
      (skill?.outcome === 'partial_drop_collected' && Number(skill?.collected) > 0)
      || (
        skill?.outcome === 'source_search_advanced'
        && skill?.searchAdvanced === true
        && Number(skill?.relocationDistance) >= 8
      )
    )
    && [
      skill?.origin?.x,
      skill?.origin?.y,
      skill?.origin?.z,
      skill?.observedPosition?.x,
      skill?.observedPosition?.y,
      skill?.observedPosition?.z,
    ].every(Number.isFinite)
  );
  const verifiedInventoryProgress = Boolean(
    Number(verification?.observedIncrease) > 0
    && binding?.expectedEffects?.some(effect => effect.kind === 'inventory_increase')
  );
  const verifiedStorageProgress = Boolean(
    Number(verification?.transferred) > 0
    && binding?.expectedEffects?.some(effect => effect.kind === 'verified_storage')
  );
  const verifiedPartialProgress = verifiedMiningProgress
    || verifiedSurfaceProgress
    || verifiedEntityHarvestProgress
    || verifiedInventoryProgress
    || verifiedStorageProgress;

  if (!completionBlocked && !verification.ok && verifiedPartialProgress && result.phase === 'failed') {
    const progressDetail = verifiedStorageProgress
      ? `Minecraft verified a partial exact-container transfer of ${verification.transferred}`
      : verifiedInventoryProgress
      ? `Minecraft verified a partial inventory increase of ${verification.observedIncrease}`
      : verifiedEntityHarvestProgress
      ? Number(skill?.collected) > 0
        ? 'Minecraft verified a partial entity-harvest inventory increase'
        : 'Minecraft verified movement into a distinct entity-search region'
      : verifiedSurfaceProgress
        ? 'Minecraft verified a supported upward surface advance'
        : 'Minecraft verified a returnable mining-route advance';
    return createActionResult({
      ...result,
      phase: 'succeeded',
      code: 'capability_verified_partial_progress',
      detail: `${result.detail || 'The bounded action ended before its final effect.'} ${progressDetail}; replanning may continue from that physical progress.`,
      evidence,
      retryable: false,
    });
  }

  // A bounded adapter may finish its requested effect and then report a stale
  // route or cleanup failure. Minecraft state is authoritative for the
  // capability outcome once the complete expected effect is present. Blocked,
  // interrupted, and cancelled actions remain censored ownership outcomes;
  // unrelated inventory movement must not turn them into method successes.
  if (!completionBlocked && verification.ok && ['failed', 'requested'].includes(result.phase)) {
    return createActionResult({
      ...result,
      phase: 'succeeded',
      code: 'capability_effects_verified',
      detail: `${verification.detail} Executor reported ${result.code || result.phase} after the effect was already present.`,
      evidence,
      retryable: false,
    });
  }

  if (!verification.ok && result.phase === 'succeeded') {
    return createActionResult({
      ...result,
      phase: 'failed',
      code: verification.code || CAPABILITY_OUTCOME_CODES.VERIFICATION,
      detail: verification.detail || 'The capability effects were not verified in Minecraft.',
      evidence,
      retryable: true,
    });
  }
  return createActionResult({ ...result, evidence });
}

export async function executeCapabilityAction(capability, {
  agent,
  executeCommand,
  owner = 'player',
  routeOrigin = 'internal',
  signal = null,
  missionId = null,
  activityId = null,
} = {}) {
  const definition = getCapabilityDefinition(capability?.id);
  if (!definition) {
    return {
      result: capabilityFailure(
        CAPABILITY_OUTCOME_CODES.BINDING,
        `Unknown capability '${capability?.id || ''}'.`,
        {
          capability: { id: capability?.id || null, arguments: capability?.arguments || null },
          retryable: false,
        },
      ),
    };
  }
  const args = definition.normalizeArguments(capability.arguments);
  const identity = { id: definition.id, arguments: args };
  const before = captureCapabilitySnapshot(agent?.bot);
  const preconditions = definition.preconditions(before, args, { agent, bot: agent?.bot });
  if (!preconditions.ok) {
    return {
      result: capabilityFailure(
        CAPABILITY_OUTCOME_CODES.PRECONDITION,
        preconditions.detail,
        { capability: identity, preconditions },
      ),
    };
  }
  const expectedEffects = immutable(definition.expectedEffects(before, args));
  const binding = definition.bind({ agent, bot: agent?.bot, snapshot: before }, args, signal);
  if (!binding?.ok) {
    return {
      result: capabilityFailure(
        binding?.code || CAPABILITY_OUTCOME_CODES.BINDING,
        binding?.detail || 'Capability binding failed.',
        { capability: identity, preconditions, binding },
      ),
    };
  }
  try {
    const previousActionId = agent?.last_action_result?.actionId || null;
    const value = await definition.execute({ ...binding, expectedEffects }, {
      agent,
      executeCommand,
      owner,
      routeOrigin,
      signal,
      missionId,
      activityId,
    });
    const after = captureCapabilitySnapshot(agent?.bot);
    const executorResult = agent?.last_action_result;
    const verification = definition.verify(before, after, { ...binding, expectedEffects }, {
      agent,
      value,
      result: executorResult,
    });
    const result = executorResult?.actionId && executorResult.actionId !== previousActionId
      ? reconcileCapabilityResult(
        executorResult,
        verification,
        identity,
        preconditions,
        { ...binding, expectedEffects },
      )
      : null;
    return {
      value,
      binding,
      verification,
      result,
    };
  } catch (error) {
    return {
      result: capabilityFailure(
        CAPABILITY_OUTCOME_CODES.EXECUTION,
        error?.message || error || 'Capability execution failed.',
        { capability: identity, preconditions, binding },
      ),
    };
  }
}
