import { executeCommand as executeAgentCommand } from '../commands/index.js';
import {
  assessShelterInPlace,
  findShelterInPlaceStances,
  occupiesDefensiveShelter,
  occupiesUsableSurfaceStance,
  probeSafeNavigationStances,
} from '../library/skills.js';
import { hasLineOfSightToEntity } from '../library/world.js';
import * as mc from '../../utils/mcdata.js';
import { BehaviorDirector } from './behavior-director.js';
import {
  EMERGENCY_SHELTER_BLUEPRINT,
  validateEmergencyShelterBlueprint,
} from './emergency-shelter.js';
import {
  chooseSurvivalIntent,
  isNightTime,
  rankFoodCandidates,
} from './survival-policy.js';
import { isDrinkableHealingPotion, potionIdentity } from './brewing-plan.js';
import { minecraftWeather } from './weather-state.js';
import {
  createMaterialChangeBlocker,
  evaluateMaterialChange,
} from './obligation-settlement.js';

const SUCCESS_COOLDOWN_MS = 2_000;
const FAILURE_COOLDOWN_MS = 10_000;
const BLOCKED_COOLDOWN_MS = 15_000;
const SURVIVAL_ENVIRONMENT_TTL_MS = 1_000;
const FOOD_RECOVERY_REGION_CHANGE_DISTANCE = 8;
const FOOD_SOURCE_OBSERVATION_RADIUS = 24;
const FOOD_SEARCH_INITIAL_RADIUS = 24;
const FOOD_SEARCH_MAX_RADIUS = 128;
const SAFETY_INCIDENT_CALM_MS = 4_000;
const SAFETY_CONTAINMENT_STABLE_MS = 2_000;
const SAFETY_GUARD_BREACH_DISTANCE = 3.5;
const SAFETY_SEPARATION_CLOSING_TOLERANCE = 0.5;
const SAFETY_REPEAT_SOURCE_WINDOW_MS = 120_000;
const SAFETY_RENDEZVOUS_DISTANCE = 4;
const SURVIVAL_DECISION_SCHEMA_VERSION = 1;
const BED_SELECTION_RADIUS = 24;
const BED_PACKAGE_SCAN_RADIUS = 48;
const BED_RAW_RESULT_LIMIT = 64;
const survivalEnvironmentCache = new WeakMap();
const MINECRAFT_USERNAME = /^[A-Za-z0-9_]{3,16}$/;
const UNSAFE_DROP_FOOD = new Set([
  'chicken',
  'poisonous_potato',
  'pufferfish',
  'rotten_flesh',
  'spider_eye',
  'suspicious_stew',
]);
const GENERIC_FOOD_RECOVERY_INTENTS = new Set([
  'acquire_food',
  'eat',
  'return_to_player',
  'return_to_surface',
  'return_home',
  'wait',
]);
const REFLEX_ACTION_LABELS = new Set([
  'mode:self_preservation',
  'mode:self_defense',
  'mode:cowardice',
]);
const SAFETY_WAIT_CODES = new Set([
  'safety_help_unavailable',
  'safety_waiting_for_intent_clarification',
  'safety_cover_unavailable',
  'safety_threat_contained',
  'safety_containment_stabilizing',
  'safety_disengagement_stabilizing',
  'safety_containment_verification',
]);

function dimensionName(value) {
  const name = String(value || '').toLowerCase();
  if (name.endsWith('overworld')) return 'overworld';
  if (name.endsWith('the_nether') || name.endsWith('nether')) return 'nether';
  if (name.endsWith('the_end') || name.endsWith('end')) return 'end';
  return name;
}

function physicalPosition(value) {
  if (!value || ![value.x, value.y, value.z].every(Number.isFinite)) return null;
  return {
    x: Number(value.x),
    y: Number(value.y),
    z: Number(value.z),
  };
}

function distanceBetween(left, right) {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function boundedDecisionText(value, maximum = 80) {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex -- telemetry fields must remain display-safe.
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function agendaFoodRemedy(agent, situation = {}) {
  if (situation.held === true || situation.urgentDanger === true) return null;
  const agenda = agent.agenda_director;
  const pending = agenda?.pending?.() || [];
  const entry = agenda?.activeEntry?.() || pending[0] || null;
  const target = String(entry?.target || '');
  if (
    !entry
    || !target
    || !agent.bot?.registry?.foodsByName?.[target]
    || UNSAFE_DROP_FOOD.has(target)
  ) return null;
  if (entry.kind === 'consume_item') return entry;
  if (entry.kind !== 'pickup_item') return null;
  const dependent = pending.find(candidate => (
    candidate?.kind === 'consume_item'
    && candidate.target === target
    && candidate.dependsOnEntryId === entry.id
    && candidate.dependencyPolicy === 'requires_success'
  ));
  return dependent ? entry : null;
}

function survivalDecisionReceipt({
  evaluatedAt,
  gate,
  situation = null,
  policy = null,
  intent = null,
  jobFoodUpkeep = null,
  durablePlayerWorkActive = null,
  outcomeCode,
  scheduled = false,
} = {}) {
  const normalizedGate = Object.freeze({
    allowed: gate?.allowed === true,
    code: boundedDecisionText(gate?.code, 48) || 'unknown',
    allowBusy: gate?.allowBusy === true,
    inFlight: gate?.inFlight === true,
    cooldownActive: gate?.cooldownActive === true,
    nextEligibleAt: finiteOrNull(gate?.nextEligibleAt),
    botAvailable: gate?.botAvailable === true,
    held: gate?.held === true,
    idle: gate?.idle === true,
  });
  const normalizedSituation = Object.freeze({
    health: finiteOrNull(situation?.health),
    hunger: finiteOrNull(situation?.hunger),
    held: typeof situation?.held === 'boolean' ? situation.held : null,
    urgentDanger: typeof situation?.urgentDanger === 'boolean' ? situation.urgentDanger : null,
    idle: typeof situation?.idle === 'boolean' ? situation.idle : null,
    canShelterInPlace: typeof situation?.canShelterInPlace === 'boolean'
      ? situation.canShelterInPlace
      : null,
    shelterInPlaceCode: boundedDecisionText(
      situation?.shelterInPlaceFeasibility?.code,
      64,
    ) || null,
  });
  const normalizedPolicy = Object.freeze({
    mode: boundedDecisionText(policy?.mode, 32) || 'missing',
    criticalFood: finiteOrNull(policy?.criticalFood),
    eatAt: finiteOrNull(policy?.eatAt),
    autonomy: boundedDecisionText(policy?.autonomy, 32) || 'unknown',
  });
  const selectedIntent = intent && typeof intent === 'object'
    ? Object.freeze({
        kind: boundedDecisionText(intent.kind, 48) || 'unknown',
        reason: boundedDecisionText(intent.reason, 80) || 'unknown',
        preempt: intent.preempt === true,
      })
    : null;
  return Object.freeze({
    schemaVersion: SURVIVAL_DECISION_SCHEMA_VERSION,
    evaluatedAt: finiteOrNull(evaluatedAt) || Date.now(),
    gate: normalizedGate,
    situation: normalizedSituation,
    policy: normalizedPolicy,
    selectedIntent,
    jobFoodUpkeep: jobFoodUpkeep && typeof jobFoodUpkeep === 'object'
      ? Object.freeze({
          workOrderId: boundedDecisionText(jobFoodUpkeep.workOrderId, 96),
          requester: boundedDecisionText(jobFoodUpkeep.requester, 32),
          targetFoodPoints: finiteOrNull(jobFoodUpkeep.targetFoodPoints),
        })
      : null,
    durablePlayerWorkActive: typeof durablePlayerWorkActive === 'boolean'
      ? durablePlayerWorkActive
      : null,
    outcomeCode: boundedDecisionText(outcomeCode, 80) || 'unknown',
    scheduled: scheduled === true,
  });
}

function activePlayerRequester(agent) {
  const agendaEntry = agent.agenda_director?.activeEntry?.()
    || agent.agenda_director?.pending?.()?.[0]
    || null;
  let requester = String(
    agent.goal_director?.activeGoal?.requester
    || agendaEntry?.requester
    || '',
  ).trim();
  if (!requester) {
    const companion = agent.companion_context?.snapshot?.() || null;
    const damage = agent.bot?.lastDamageSource;
    const damageAge = Date.now() - Number(damage?.observedAt);
    const companionCausedFreshDamage = damage?.kind === 'requester_player'
      && Number.isFinite(damageAge)
      && damageAge >= 0
      && damageAge < 4_000;
    if (companion?.presence === 'present' && !companionCausedFreshDamage) {
      requester = String(companion.canonicalUsername || '').trim();
    }
  }
  const self = String(agent.bot?.username || agent.name || '').toLowerCase();
  return MINECRAFT_USERNAME.test(requester) && requester.toLowerCase() !== self
    ? requester
    : null;
}

function damageSourceSnapshot(receipt) {
  if (!receipt || receipt.matchesSelf !== true) return null;
  const observedAt = Number(receipt.observedAt);
  const sourceId = Number(receipt.source?.id);
  return Object.freeze({
    kind: boundedDecisionText(receipt.kind, 32) || 'unknown',
    id: Number.isFinite(sourceId) ? Math.floor(sourceId) : null,
    name: boundedDecisionText(receipt.source?.name, 64) || null,
    username: boundedDecisionText(receipt.source?.username, 32) || null,
    type: boundedDecisionText(receipt.source?.type, 32) || null,
    observedAt: Number.isFinite(observedAt) ? observedAt : Date.now(),
  });
}

function sameSource(left, right) {
  if (!left || !right) return false;
  if (left.id !== null && right.id !== null) return left.id === right.id;
  if (left.username && right.username) {
    return left.username.toLowerCase() === right.username.toLowerCase();
  }
  return Boolean(left.name && right.name && left.name === right.name);
}

function safetyPlayerTarget(agent, incident) {
  const name = activePlayerRequester(agent);
  if (!name) return null;
  const attacker = String(incident?.source?.username || '').toLowerCase();
  return attacker && name.toLowerCase() === attacker ? null : name;
}

function safetyPlayerPresenceConfirmed(agent, playerName) {
  const companion = agent.companion_context?.snapshot?.() || null;
  return Boolean(
    companion?.presence === 'present'
    && String(companion.canonicalUsername || '').toLowerCase() === String(playerName || '').toLowerCase()
    && physicalPosition(companion.position)
  );
}

function safetyPlayerDistance(agent, playerName) {
  const companion = agent.companion_context?.snapshot?.() || null;
  if (
    companion?.presence !== 'present'
    || String(companion.canonicalUsername || '').toLowerCase() !== String(playerName || '').toLowerCase()
  ) return Number.POSITIVE_INFINITY;
  return distanceBetween(
    physicalPosition(agent.bot?.entity?.position),
    physicalPosition(companion.position),
  );
}

function loadedSafetySource(agent, source) {
  const id = Number(source?.id);
  if (!Number.isFinite(id)) return null;
  const entity = agent.bot?.entities?.[Math.floor(id)] || null;
  if (!entity?.position) return null;
  const expectedUsername = String(source.username || '').toLowerCase();
  const actualUsername = String(entity.username || '').toLowerCase();
  if (expectedUsername && expectedUsername !== actualUsername) return null;
  const expectedName = String(source.name || '').toLowerCase();
  const actualName = String(entity.name || '').toLowerCase();
  if (!expectedUsername && expectedName && expectedName !== actualName) return null;
  return entity;
}

function incidentSources(incident) {
  const sources = Array.isArray(incident?.sources) && incident.sources.length > 0
    ? incident.sources
    : incident?.source
      ? [incident.source]
      : [];
  return sources.filter(Boolean);
}

function loadedIncidentThreats(agent, incident) {
  const seen = new Set();
  const threats = [];
  for (const source of incidentSources(incident)) {
    const entity = loadedSafetySource(agent, source);
    if (!entity || seen.has(entity.id)) continue;
    seen.add(entity.id);
    threats.push(entity);
  }
  return threats;
}

function loadedIncidentThreat(agent, incident) {
  const current = loadedSafetySource(agent, incident?.source);
  return current || loadedIncidentThreats(agent, incident)[0] || null;
}

function rememberedHome(agent, currentDimension) {
  const home = agent.home_state?.snapshot?.().home;
  const position = physicalPosition(home);
  if (!position || dimensionName(home?.dimension) !== currentDimension) return null;
  return {
    name: 'remembered_home',
    ...position,
  };
}

function foodInventory(bot) {
  const foodData = bot.registry?.foodsByName || {};
  const carried = Array.isArray(bot.inventory?.slots)
    ? bot.inventory.slots.filter(Boolean)
    : (bot.inventory?.items?.() || []);
  return carried
    .filter(item => item?.name && foodData[item.name])
    .map(item => ({
      name: item.name,
      count: item.count,
      foodPoints: foodData[item.name].foodPoints,
      saturation: foodData[item.name].saturation,
    }));
}

function healingConsumableInventory(bot) {
  return (bot.inventory?.items?.() || [])
    .filter(item => isDrinkableHealingPotion(item, bot.version))
    .map(item => {
      const effect = potionIdentity(item, bot.version);
      return {
        item: 'healing_potion',
        inventoryName: item.name,
        effect,
        count: Math.max(0, Number(item.count) || 0),
        potency: effect === 'strong_healing' ? 2 : 1,
      };
    });
}

const ARMOR_SLOTS = Object.freeze([
  { index: 5, slot: 'head' },
  { index: 6, slot: 'torso' },
  { index: 7, slot: 'legs' },
  { index: 8, slot: 'feet' },
]);
const ARMOR_MATERIAL_SCORE = Object.freeze({
  leather: 1,
  golden: 2,
  turtle: 2,
  chainmail: 3,
  iron: 4,
  diamond: 5,
  netherite: 6,
});

function armorDescriptor(name) {
  if (typeof name !== 'string') return null;
  const slot = name.endsWith('_helmet')
    ? 'head'
    : name.endsWith('_chestplate')
      ? 'torso'
      : name.endsWith('_leggings')
        ? 'legs'
        : name.endsWith('_boots')
          ? 'feet'
          : null;
  if (!slot) return null;
  const material = name.split('_')[0];
  const score = ARMOR_MATERIAL_SCORE[material];
  return score ? { name, slot, score } : null;
}

function armorDurability(bot, item) {
  const max = Number(
    item?.maxDurability
    ?? bot.registry?.items?.[item?.type]?.maxDurability
    ?? bot.registry?.itemsByName?.[item?.name]?.maxDurability,
  );
  if (!Number.isFinite(max) || max <= 0) {
    return { durabilityRemaining: null, durabilityMax: null, worn: false };
  }
  const remaining = Math.max(0, max - Math.max(0, Number(item?.durabilityUsed) || 0));
  return {
    durabilityRemaining: remaining,
    durabilityMax: max,
    worn: remaining <= Math.max(16, Math.ceil(max * 0.1)),
  };
}

function armorInventory(bot) {
  const equipped = ARMOR_SLOTS
    .map(({ index, slot }) => {
      const item = bot.inventory?.slots?.[index];
      const descriptor = armorDescriptor(item?.name);
      const durability = armorDurability(bot, item);
      return descriptor && descriptor.slot === slot
        ? {
            ...descriptor,
            score: durability.worn ? 0 : descriptor.score,
            ...durability,
            equipped: true,
          }
        : null;
    })
    .filter(Boolean);
  const equippedItems = new Set(ARMOR_SLOTS.map(({ index }) => bot.inventory?.slots?.[index]).filter(Boolean));
  const carried = (bot.inventory?.items?.() || [])
    .filter(item => !equippedItems.has(item))
    .map(item => {
      const descriptor = armorDescriptor(item?.name);
      const durability = armorDurability(bot, item);
      return descriptor ? {
        ...descriptor,
        score: durability.worn ? 0 : descriptor.score,
        ...durability,
        equipped: false,
      } : null;
    })
    .filter(Boolean);
  return [...equipped, ...carried];
}

function usefulDropCandidates(bot) {
  const candidates = [];
  for (const entity of Object.values(bot.entities || {})) {
    if (entity?.name !== 'item' || !entity.position || !bot.entity?.position) continue;
    const distance = bot.entity.position.distanceTo(entity.position);
    if (distance > 12) continue;
    let item;
    try {
      item = entity.getDroppedItem?.();
    } catch {
      continue;
    }
    const name = String(item?.name || '');
    const useful = Boolean(
      (bot.registry?.foodsByName?.[name] && !UNSAFE_DROP_FOOD.has(name))
      || /_(?:pickaxe|axe|shovel|hoe|sword|helmet|chestplate|leggings|boots|log|stem|planks|sapling|seeds)$/.test(name)
      || name.startsWith('raw_')
      || /_(?:ore|ingot|nugget)$/.test(name)
      || ['coal', 'charcoal', 'diamond', 'emerald', 'torch', 'crafting_table', 'furnace', 'bucket', 'shield'].includes(name)
    );
    if (useful) candidates.push({
      name,
      distance,
      id: entity.id,
      x: entity.position.x,
      y: entity.position.y,
      z: entity.position.z,
    });
  }
  return candidates.sort((left, right) => left.distance - right.distance);
}

function huntableFoodSourceSignature(bot, radius = FOOD_SOURCE_OBSERVATION_RADIUS) {
  const origin = bot.entity?.position;
  if (!origin) return '';
  return Object.values(bot.entities || {})
    .filter(entity => (
      entity?.position
      && mc.isHuntable(entity)
      && origin.distanceTo(entity.position) <= radius
    ))
    .map(entity => `${Number(entity.id) || 0}:${String(entity.name || '')}`)
    .sort()
    .join('|');
}

function usefulDropInventorySignature(bot) {
  const slots = Array.isArray(bot.inventory?.slots) ? bot.inventory.slots : [];
  return slots.map((item, slot) => (
    item?.name
      ? `${slot}:${item.name}:${Math.max(0, Number(item.count) || 0)}`
      : `${slot}:-`
  )).join('|');
}

function offset(position, x, y, z) {
  if (typeof position?.offset === 'function') return position.offset(x, y, z);
  return { x: position.x + x, y: position.y + y, z: position.z + z };
}

function solidCover(block) {
  return Boolean(
    block
    && block.boundingBox === 'block'
    && !['water', 'lava'].includes(block.name),
  );
}

// Two blockAt probes. Cheap enough to run on every survival sample, and it is
// the only part of the shelter read that the policy consults unconditionally.
function isSheltered(bot) {
  if (!bot.entity?.position || typeof bot.blockAt !== 'function') return false;
  const origin = bot.entity.position;
  return [2, 3].some(height => solidCover(bot.blockAt(offset(origin, 0, height, 0))));
}

function candidateBlocksThreat(bot, feet, threat) {
  if (!threat?.position) return true;
  if (!bot.world?.raycast || typeof threat.position.offset !== 'function') return null;
  const eye = offset(feet, 0, Number(bot.entity?.eyeHeight) || 1.62, 0);
  if (typeof eye?.minus !== 'function') return null;
  const height = Math.max(0.6, Number(threat.height) || Number(threat.eyeHeight) || 1.8);
  for (const ratio of [0.2, 0.55, 0.9]) {
    const sample = threat.position.offset(0, height * ratio, 0);
    const direction = sample.minus(eye);
    const distance = direction.norm?.();
    if (!Number.isFinite(distance) || distance <= 0.25) return false;
    if (!bot.world.raycast(eye, direction.scaled(1 / distance), distance)) return false;
  }
  return true;
}

function shelterSituation(bot) {
  if (!bot.entity?.position || typeof bot.blockAt !== 'function') {
    return { sheltered: false, shelters: [] };
  }
  const origin = bot.entity.position;
  const sheltered = isSheltered(bot);
  if (sheltered || typeof bot.findBlocks !== 'function') return { sheltered, shelters: [] };
  let roofs = [];
  try {
    roofs = bot.findBlocks({
      matching: block => solidCover(block),
      maxDistance: 16,
      count: 16,
    });
  } catch {
    return { sheltered: false, shelters: [] };
  }
  const hostile = bot.nearestEntity?.(entity => mc.isHostile(entity));
  const legalCover = roofs
    .map(roof => {
      const feet = offset(roof, 0, -2, 0);
      const feetBlock = bot.blockAt(feet);
      const headBlock = bot.blockAt(offset(feet, 0, 1, 0));
      const floor = bot.blockAt(offset(feet, 0, -1, 0));
      if (
        feetBlock?.boundingBox !== 'empty'
        || headBlock?.boundingBox !== 'empty'
        || !solidCover(floor)
      ) return null;
      const threatCover = candidateBlocksThreat(bot, feet, hostile);
      if (threatCover !== true) return null;
      return {
        name: 'covered_space',
        x: feet.x,
        y: feet.y,
        z: feet.z,
        distance: origin.distanceTo(feet),
        coverStatus: hostile ? 'blocked_threat_line_of_sight' : 'overhead_cover',
      };
    })
    .filter(Boolean);
  if (legalCover.length === 0) return { sheltered: false, shelters: [] };
  const route = probeSafeNavigationStances(bot, legalCover, 1_000);
  if (!route.reachable || !route.terminalPosition) {
    // An unfinished search is not proof there is nowhere to shelter. Report the
    // probe status so a caller can retry or say honestly that it ran out of
    // search time, rather than acting on a manufactured "no shelters exist".
    return {
      sheltered: false,
      shelters: [],
      inconclusive: route.conclusive === false,
      routeStatus: route.status,
    };
  }
  const selected = legalCover.find(candidate => (
    Math.floor(candidate.x) === Math.floor(route.terminalPosition.x)
    && Math.floor(candidate.y) === Math.floor(route.terminalPosition.y)
    && Math.floor(candidate.z) === Math.floor(route.terminalPosition.z)
  ));
  if (!selected) return { sheltered: false, shelters: [] };
  return {
    sheltered: false,
    shelters: [{
      ...selected,
      reachable: true,
      safe: true,
      pathStatus: route.status,
      pathLength: route.pathLength,
    }],
  };
}

function bedCandidates(bot) {
  if (typeof bot.findBlocks !== 'function' || typeof bot.blockAt !== 'function') return [];
  let locations;
  try {
    locations = bot.findBlocks({
      matching: block => block?.name?.endsWith('_bed'),
      // Mineflayer owns loaded-world discovery, but its section iterator uses
      // an octahedral envelope. At a chunk corner that envelope can omit a
      // block inside the exact product radius. Widen only the delegated scan,
      // then enforce Kevin's Euclidean selection radius below.
      maxDistance: BED_PACKAGE_SCAN_RADIUS,
      count: BED_RAW_RESULT_LIMIT,
    });
  } catch {
    return [];
  }
  const hostile = bot.nearestEntity?.(entity => mc.isHostile(entity));
  const threatDistance = hostile?.position && bot.entity?.position
    ? hostile.position.distanceTo(bot.entity.position)
    : Infinity;
  const candidates = locations
    .map(location => {
      const block = bot.blockAt(location);
      if (!block?.name?.endsWith('_bed')) return null;
      // Mineflayer returns both the head and foot because both are bed blocks.
      // They are one interaction target in Minecraft, so normalize every
      // candidate to the foot before selection and blocker identity. Without
      // this, rejecting the foot merely made the head eligible ten seconds
      // later, recreating the unchanged occupied-bed loop under a new
      // coordinate.
      let position = block.position || location;
      try {
        const metadata = bot.parseBedMetadata?.(block);
        const offset = metadata?.headOffset;
        if (
          metadata?.part === true
          && [offset?.x, offset?.y, offset?.z].every(Number.isFinite)
        ) {
          // Keep Mineflayer's Vec3. bot.blockAt calls floored() on this value;
          // replacing it with a coordinate-shaped object makes the entire
          // survival situation unavailable before selection can run.
          if (typeof position.offset !== 'function') return null;
          position = position.offset(-Number(offset.x), -Number(offset.y), -Number(offset.z));
        }
      } catch {
        // A missing package receipt cannot justify guessing an adjacent block.
        return null;
      }
      const canonicalBlock = bot.blockAt(position);
      if (!canonicalBlock?.name?.endsWith('_bed')) return null;
      let canonicalMetadata;
      try {
        canonicalMetadata = bot.parseBedMetadata?.(canonicalBlock);
      } catch {
        return null;
      }
      const distance = bot.entity?.position?.distanceTo?.(position);
      if (!Number.isFinite(distance) || distance > BED_SELECTION_RADIUS) return null;
      return {
        name: canonicalBlock.name,
        x: position.x,
        y: position.y,
        z: position.z,
        distance,
        reachable: true,
        safe: threatDistance > 12,
        occupied: typeof canonicalMetadata?.occupied === 'boolean'
          ? canonicalMetadata.occupied
          : null,
      };
    })
    .filter(Boolean);
  return [...new Map(candidates.map(candidate => (
    [`${candidate.x}:${candidate.y}:${candidate.z}`, candidate]
  ))).values()];
}

function environmentalSituation(bot, now, needs = {}) {
  const wantBeds = needs.beds === true;
  const wantShelters = needs.shelters === true;
  const position = bot.entity?.position;
  const dimension = dimensionName(bot.game?.dimension);
  const cached = survivalEnvironmentCache.get(bot);
  const moved = !cached
    || !position
    || Math.hypot(
      Number(position.x) - cached.x,
      Number(position.y) - cached.y,
      Number(position.z) - cached.z,
    ) > 2;
  if (
    cached
    && !moved
    && cached.dimension === dimension
    && now < cached.nextRefreshAt
    // A cheap sample must never satisfy a later read that needs the sweep.
    && (!wantBeds || cached.scannedBeds)
    && (!wantShelters || cached.scannedShelters)
  ) {
    return cached.value;
  }
  const shelter = wantShelters
    ? shelterSituation(bot)
    : { sheltered: isSheltered(bot), shelters: [] };
  const value = {
    beds: wantBeds ? bedCandidates(bot) : [],
    usefulDrops: usefulDropCandidates(bot),
    ...shelter,
  };
  survivalEnvironmentCache.set(bot, {
    x: Number(position?.x) || 0,
    y: Number(position?.y) || 0,
    z: Number(position?.z) || 0,
    dimension,
    nextRefreshAt: now + SURVIVAL_ENVIRONMENT_TTL_MS,
    scannedBeds: wantBeds,
    scannedShelters: wantShelters,
    value,
  });
  return value;
}

export function clearSurvivalSituationCache(bot) {
  if (bot && typeof bot === 'object') survivalEnvironmentCache.delete(bot);
}

export function summarizeSurvivalSituation(agent, { now = Date.now() } = {}) {
  const bot = agent.bot;
  const modeStatus = bot.modes?.getStatus?.() || [];
  const urgentDanger = modeStatus.some(mode => (
    mode.active === true
    && ['self_preservation', 'cowardice', 'self_defense'].includes(mode.name)
  ));
  const held = agent.isOperatorHeld?.() === true;
  const idle = agent.isIdle?.() === true;
  const health = Number(bot.health);
  const recentDamage = Date.now() - Number(bot.lastDamageTime || 0) < 4_000;
  const timeOfDay = Number(bot.time?.timeOfDay || 0);
  const dimension = dimensionName(bot.game?.dimension);
  const difficulty = String(bot.game?.difficulty || '').toLowerCase();
  const weather = minecraftWeather(bot);

  // chooseSurvivalIntent reaches bed and shelter candidates through a fixed
  // waterfall, so the conditions below are exactly the ones that can read them:
  // survival mode 'full', not held, no urgent danger, and idle. Beds then need
  // a safe-sleep night in the overworld; shelters need either injury recovery
  // or an unsheltered night/storm. Outside those windows the sweeps produced
  // candidates that nothing could ever consult.
  const policy = agent.runtime?.survival || {};
  const night = isNightTime(timeOfDay);
  const unsafeNight = night && difficulty !== 'peaceful';
  const eligible = policy.mode === 'full' && !held && !urgentDanger && idle;
  const safetyRecoveryActive = agent.survival_director?.safetyIncident?.active === true;
  const needs = {
    beds: eligible && policy.sleep === 'safe' && night && dimension === 'overworld',
    shelters: eligible && (
      safetyRecoveryActive
      ||
      (Number.isFinite(health) && health <= 14 && recentDamage)
      || (policy.shelter !== 'off' && (unsafeNight || weather === 'Thunderstorm'))
    ),
  };

  const environment = environmentalSituation(bot, now, needs);
  const defensiveShelter = occupiesDefensiveShelter(bot);
  const shouldAssessShelterInPlace = eligible
    && policy.shelter !== 'off'
    && Number.isFinite(health)
    && health <= 8
    && defensiveShelter !== true
    && (safetyRecoveryActive || recentDamage || unsafeNight);
  const shelterInPlaceFeasibility = shouldAssessShelterInPlace
    ? assessShelterInPlace(bot)
    : Object.freeze({ feasible: false, code: 'not_required' });
  const shelterInPlaceStances = shouldAssessShelterInPlace
    && shelterInPlaceFeasibility.feasible !== true
    ? findShelterInPlaceStances(bot)
    : [];

  return {
    held,
    idle,
    health,
    hunger: Number(bot.food),
    recentDamage,
    urgentDanger,
    food: foodInventory(bot),
    healingConsumables: healingConsumableInventory(bot),
    timeOfDay,
    dimension,
    difficulty,
    weather,
    armor: armorInventory(bot),
    ...environment,
    defensiveShelter,
    canShelterInPlace: shelterInPlaceFeasibility.feasible === true,
    shelterInPlaceFeasibility,
    shelterInPlaceStances,
  };
}

// Backstop for a sleep blocker whose world predicates may never change.
export const SLEEP_RETRY_HOLD_MS = 60_000;

export class SurvivalDirector extends BehaviorDirector {
  constructor(agent, {
    now = Date.now,
    getSituation = summarizeSurvivalSituation,
    executeCommand = executeAgentCommand,
    requestWorkOrder,
    isAtSurface = occupiesUsableSurfaceStance,
    assessDefensiveShelter = assessShelterInPlace,
  } = {}) {
    super(agent, { name: 'survival' });
    this.getSituation = getSituation;
    this.now = now;
    this.executeCommand = executeCommand;
    this.isAtSurface = isAtSurface;
    this.assessDefensiveShelter = assessDefensiveShelter;
    this.requestWorkOrder = requestWorkOrder || (order => (
      this.agent.job_director?.requestWorkOrder?.(order)
      || { accepted: false, code: 'job_director_unavailable' }
    ));
    this.foodSourceBlocker = null;
    this.usefulDropBlockers = new Map();
    this.sleepBlockers = new Map();
    this.sleepExhaustionAnnouncedFor = null;
    this.sleepBlocker = null;
    this.jobFoodUpkeep = null;
    this.lastDecision = null;
    this.safetyIncident = null;
    this.lastSafetyIncident = null;
    this.containedThreatGuard = null;
    this.unavailableSafetyPlayer = null;
  }

  inspectSleepBeds() {
    return Object.freeze(bedCandidates(this.agent.bot).map(candidate => Object.freeze({
      name: candidate.name,
      x: candidate.x,
      y: candidate.y,
      z: candidate.z,
      distance: candidate.distance,
      safe: candidate.safe,
      occupied: candidate.occupied,
    })));
  }

  usefulDropBlockerReleased(blocker, candidates = []) {
    if (!blocker) return true;
    const current = candidates.find(candidate => Number(candidate?.id) === blocker.id);
    if (!current || current.name !== blocker.name) return true;
    const botPosition = physicalPosition(this.agent.bot?.entity?.position);
    if (!botPosition) return false;
    if (usefulDropInventorySignature(this.agent.bot) !== blocker.inventorySignature) return true;
    if (Math.hypot(
      botPosition.x - blocker.botPosition.x,
      botPosition.y - blocker.botPosition.y,
      botPosition.z - blocker.botPosition.z,
    ) >= 4) return true;
    return Math.hypot(
      Number(current.x) - blocker.dropPosition.x,
      Number(current.y) - blocker.dropPosition.y,
      Number(current.z) - blocker.dropPosition.z,
    ) >= 1;
  }

  eligibleUsefulDrops(situation = {}) {
    const candidates = Array.isArray(situation.usefulDrops) ? situation.usefulDrops : [];
    for (const [id, blocker] of this.usefulDropBlockers) {
      if (this.usefulDropBlockerReleased(blocker, candidates)) this.usefulDropBlockers.delete(id);
    }
    if (this.usefulDropBlockers.size === 0) return candidates;
    return candidates.filter(candidate => !this.usefulDropBlockers.has(Number(candidate?.id)));
  }

  settleUsefulDrops(intent, result, situation = {}) {
    if (intent?.kind !== 'collect_useful_drop') return;
    if (result?.phase === 'interrupted' || result?.code === 'interrupted') return;
    if (result?.phase === 'succeeded') {
      this.usefulDropBlockers.delete(Number(intent.target?.id));
      return;
    }
    if (
      result?.phase !== 'failed'
      || (
        result?.code !== 'skill_no_reachable_items'
        && result?.evidence?.skill?.outcome !== 'no_reachable_items'
      )
    ) return;
    const botPosition = physicalPosition(this.agent.bot?.entity?.position);
    if (!botPosition) return;
    const inventorySignature = usefulDropInventorySignature(this.agent.bot);
    for (const candidate of Array.isArray(situation.usefulDrops) ? situation.usefulDrops : []) {
      if (
        !Number.isFinite(Number(candidate?.id))
        || ![candidate?.x, candidate?.y, candidate?.z].every(Number.isFinite)
      ) continue;
      this.usefulDropBlockers.set(Number(candidate.id), Object.freeze({
        id: Number(candidate.id),
        name: String(candidate.name || ''),
        botPosition,
        dropPosition: Object.freeze({
          x: Number(candidate.x),
          y: Number(candidate.y),
          z: Number(candidate.z),
        }),
        inventorySignature,
      }));
    }
  }

  recordDecision(context, outcomeCode, { scheduled = false } = {}) {
    this.lastDecision = survivalDecisionReceipt({
      ...context,
      outcomeCode,
      scheduled,
    });
    return this.lastDecision;
  }

  snapshot() {
    return {
      ...super.snapshot(),
      decision: this.lastDecision,
      safetyIncident: this.safetyIncident || this.lastSafetyIncident,
      containedThreatGuard: this.containedThreatGuard,
    };
  }

  replaceSafetyIncident(patch = {}) {
    if (!this.safetyIncident) return null;
    this.safetyIncident = Object.freeze({
      ...this.safetyIncident,
      ...patch,
      active: true,
      updatedAt: this.now(),
    });
    return this.safetyIncident;
  }

  tacticalObjectiveForThreat(threat) {
    const incident = this.safetyIncident;
    if (!incident?.active || !incident.failedResponse) return null;
    const threatId = Number(threat?.id);
    const sourceId = Number(incident.source?.id);
    if (!Number.isFinite(threatId) || !Number.isFinite(sourceId) || threatId !== sourceId) return null;
    const expectedUuid = boundedDecisionText(incident.failedResponse.entityUuid, 80) || null;
    if (expectedUuid && boundedDecisionText(threat?.uuid, 80) !== expectedUuid) return null;
    return ['melee', 'shield_melee'].includes(incident.failedResponse.response)
      ? 'disengage'
      : null;
  }

  ownsSafetyRecoveryForThreat(threat) {
    const incident = this.safetyIncident;
    if (!incident?.active) {
      const guard = this.containedThreatGuard;
      if (!guard || !incidentSources(guard).some(source => sameSource(source, threat))) return false;
      if (guard.kind === 'stable_disengagement') {
        const distance = this.agent.bot?.entity?.position?.distanceTo?.(threat?.position);
        const source = incidentSources(guard).find(candidate => sameSource(candidate, threat));
        const guardedMinimum = Number(guard.minimumDistances?.[String(source?.id)]);
        const separated = Number.isFinite(distance)
          && distance >= (Number.isFinite(guardedMinimum)
            ? guardedMinimum
            : Number(guard.minimumDistance || SAFETY_GUARD_BREACH_DISTANCE))
          && hasLineOfSightToEntity(this.agent.bot, threat) === false;
        if (!separated) this.containedThreatGuard = null;
        return separated;
      }
      if (!occupiesDefensiveShelter(this.agent.bot)) {
        this.containedThreatGuard = null;
        return false;
      }
      return hasLineOfSightToEntity(this.agent.bot, threat) === false;
    }
    if (incident.stage === 'under_cover') return true;
    if (this.dispatchLease?.metadata?.intent?.kind === 'shelter_in_place') return true;
    if (![
      'disengaged',
      'disengaging',
      'response_blocked',
      'recovery_blocked',
      'shelter_relocated',
    ].includes(incident.stage)) {
      return false;
    }
    if (!incidentSources(incident).some(source => sameSource(source, threat))) {
      const threatId = Number(threat?.id);
      if (Number.isFinite(threatId) && threat?.position) {
        const source = Object.freeze({
          kind: 'hostile',
          id: Math.floor(threatId),
          name: boundedDecisionText(threat.name || threat.username, 64).toLowerCase() || null,
          username: null,
          type: boundedDecisionText(threat.type, 32) || null,
          observedAt: this.now(),
        });
        const sources = [
          ...incidentSources(incident).filter(candidate => !sameSource(candidate, source)),
          source,
        ].slice(-8);
        this.replaceSafetyIncident({
          sources: Object.freeze(sources),
          lastThreatSeenAt: this.now(),
          disengagementStartedAt: null,
          disengagementDistances: null,
        });
      }
    }
    // After one tactical response hands off, Safety owns the whole hostile
    // band. New attackers are enrolled above and evaluated together; they do
    // not each launch another lower combat leaf while the original work is
    // already suspended.
    return true;
  }

  observeSafetySource(source) {
    if (!source) return false;
    const now = this.now();
    this.containedThreatGuard = null;
    if (this.safetyIncident) {
      const sameThreat = sameSource(this.safetyIncident.source, source);
      const priorSources = Array.isArray(this.safetyIncident.sources)
        ? this.safetyIncident.sources
        : [this.safetyIncident.source];
      const sources = sameThreat
        ? priorSources.map(candidate => sameSource(candidate, source) ? source : candidate)
        : [...priorSources.filter(candidate => !sameSource(candidate, source)), source].slice(-8);
      this.replaceSafetyIncident({
        source,
        sources: Object.freeze(sources),
        stage: 'threat_response',
        containmentStartedAt: null,
        disengagementStartedAt: null,
        lastDamageAt: source.observedAt,
        ...(source.kind === 'hostile' ? { lastThreatSeenAt: source.observedAt } : {}),
        health: finiteOrNull(this.agent.bot?.health),
        ...(!sameThreat
          ? {
              encounterCount: Math.max(1, Number(this.safetyIncident.encounterCount) || 1) + 1,
              failedResponse: null,
            }
          : {}),
      });
    } else {
      const previousIncident = this.lastSafetyIncident;
      const repeatsRecentSource = Boolean(
        previousIncident
        && sameSource(previousIncident.source, source)
        && now - Number(previousIncident.resolvedAt || previousIncident.updatedAt || 0)
          <= SAFETY_REPEAT_SOURCE_WINDOW_MS
      );
      const position = physicalPosition(this.agent.bot?.entity?.position);
      this.safetyIncident = Object.freeze({
        id: `safety-${Math.floor(source.observedAt)}-${source.id ?? source.kind}`.slice(0, 96),
        active: true,
        stage: 'threat_response',
        source,
        sources: Object.freeze([source]),
        startedAt: source.observedAt,
        updatedAt: now,
        lastDamageAt: source.observedAt,
        lastThreatSeenAt: source.kind === 'hostile' ? source.observedAt : null,
        health: finiteOrNull(this.agent.bot?.health),
        origin: position ? Object.freeze(position) : null,
        lastAction: null,
        announcedCode: null,
        failedPlayerTarget: null,
        failedCoverTarget: null,
        encounterCount: repeatsRecentSource
          ? Math.max(1, Number(previousIncident.encounterCount) || 1) + 1
          : 1,
      });
      this.lastSafetyIncident = null;
    }
    this.nextEligibleAt = 0;
    this.agent.behavior_arbiter?.beginSafetySuspension?.(this.safetyIncident);
    this.agent.behavior_arbiter?.wake?.('survival_incident_observed');
    return true;
  }

  observeDamageSource(receipt) {
    return this.observeSafetySource(damageSourceSnapshot(receipt));
  }

  observeAttributedThreat(threat) {
    if (!['self_damage', 'protected_player'].includes(threat?.attribution)) return false;
    const entityId = Number(threat?.entityId);
    if (!Number.isFinite(entityId)) return false;
    const id = Math.floor(entityId);
    const entity = this.agent.bot?.entities?.[id] || null;
    if (!entity?.position || !mc.isCombatSafeHostile(entity)) return false;

    const expectedUuid = boundedDecisionText(threat?.entityUuid, 80) || null;
    const actualUuid = boundedDecisionText(entity.uuid, 80) || null;
    if (expectedUuid && actualUuid !== expectedUuid) return false;
    const expectedName = boundedDecisionText(threat?.name, 64).toLowerCase();
    const actualName = boundedDecisionText(entity.name || entity.username, 64).toLowerCase();
    if (!expectedUuid && expectedName && expectedName !== actualName) return false;

    return this.observeSafetySource(Object.freeze({
      kind: 'hostile',
      id,
      name: actualName || expectedName || null,
      username: null,
      type: boundedDecisionText(entity.type, 32) || null,
      observedAt: Date.now(),
    }));
  }

  closeSafetyIncident({ phase = 'succeeded', code, detail = '' } = {}) {
    if (!this.safetyIncident) return false;
    const closed = Object.freeze({
      ...this.safetyIncident,
      active: false,
      stage: phase === 'succeeded' ? 'resolved' : 'failed',
      resolutionCode: boundedDecisionText(code, 80) || 'survival_incident_resolved',
      resolvedAt: this.now(),
      updatedAt: this.now(),
    });
    this.lastSafetyIncident = closed;
    this.agent.behavior_arbiter?.releaseSafetySuspension?.(closed, closed.resolutionCode);
    this.safetyIncident = null;
    this.finish({
      phase,
      code: closed.resolutionCode,
      detail: boundedDecisionText(detail, 280),
      retryable: false,
    });
    return true;
  }

  announceSafetyIncident(code, message) {
    if (!this.safetyIncident || this.safetyIncident.announcedCode === code) return false;
    this.replaceSafetyIncident({ announcedCode: code });
    if (typeof this.agent.openChat === 'function') {
      void Promise.resolve(this.agent.openChat(message)).catch(error => {
        console.warn(`[survival] Could not announce safety status: ${boundedDecisionText(error?.message || error, 160)}`);
      });
    }
    return true;
  }

  observeActionResult(result) {
    if (!result || !REFLEX_ACTION_LABELS.has(result.label)) return false;
    if (!this.safetyIncident) this.observeDamageSource(this.agent.bot?.lastDamageSource);
    if (!this.safetyIncident) return false;
    const skill = result.evidence?.skill && typeof result.evidence.skill === 'object'
      ? result.evidence.skill
      : null;
    const outcome = boundedDecisionText(skill?.outcome || result.code, 80) || 'unknown';
    const lastAction = Object.freeze({
      actionId: boundedDecisionText(result.actionId, 80) || null,
      phase: boundedDecisionText(result.phase, 24) || 'unknown',
      code: boundedDecisionText(result.code, 80) || 'unknown',
      outcome,
      finishedAt: finiteOrNull(result.finishedAt) || Date.now(),
    });
    const tacticalDecision = Array.isArray(skill?.decisions) ? skill.decisions.at(-1) : null;
    const failedMelee = result.phase === 'failed'
      && result.retryable === true
      && skill?.kind === 'tactical_combat'
      && ['melee', 'shield_melee'].includes(tacticalDecision?.response);
    if (result.phase === 'interrupted' || result.phase === 'cancelled' || result.code === 'interrupted') {
      this.replaceSafetyIncident({ stage: 'threat_response', lastAction });
    } else if (skill?.kind === 'tactical_combat' && outcome === 'secured') {
      this.replaceSafetyIncident({ lastAction });
      this.closeSafetyIncident({
        code: 'attributed_threat_cleared',
        detail: 'The attributed hostile is no longer an active loaded threat after verified combat.',
      });
    } else if (skill?.kind === 'tactical_combat' && ['retreated', 'area_already_secure'].includes(outcome)) {
      const safetyDetourBound = outcome === 'retreated'
        && Number(this.safetyIncident.encounterCount) >= 2
        && this.safetyIncident.safetyDetourBound !== true
        && this.agent.job_director?.routeAroundRepeatedSafetySource?.({
          source: this.safetyIncident.source,
          incidentId: this.safetyIncident.id,
        }) === true;
      this.replaceSafetyIncident({
        stage: outcome === 'retreated' ? 'disengaged' : 'assessing',
        lastAction,
        ...(outcome === 'retreated' ? { failedResponse: null } : {}),
        ...(safetyDetourBound ? { safetyDetourBound: true } : {}),
      });
    } else if (result.phase === 'succeeded') {
      this.replaceSafetyIncident({ stage: 'disengaged', lastAction });
    } else {
      this.replaceSafetyIncident({
        stage: 'response_blocked',
        lastAction,
        ...(failedMelee
          ? {
              failedResponse: Object.freeze({
                actionId: lastAction.actionId,
                response: tacticalDecision.response,
                entityId: this.safetyIncident.source?.id ?? null,
                entityUuid: boundedDecisionText(
                  this.agent.bot?.entities?.[Number(this.safetyIncident.source?.id)]?.uuid,
                  80,
                ) || null,
                observedAt: Date.now(),
              }),
            }
          : {}),
      });
    }
    this.nextEligibleAt = 0;
    this.agent.behavior_arbiter?.wake?.('survival_incident_action_settled');
    return true;
  }

  observePlayerOrder(source, commandName) {
    if (!this.safetyIncident || this.safetyIncident.source.kind !== 'requester_player') return false;
    const attacker = String(this.safetyIncident.source.username || '').toLowerCase();
    if (!attacker || String(source || '').toLowerCase() !== attacker) return false;
    return this.closeSafetyIncident({
      code: 'player_intent_clarified',
      detail: `A new explicit ${boundedDecisionText(commandName, 48) || 'player'} order supplied fresh authority after the player-caused hit.`,
    });
  }

  reconcileDeath() {
    return this.closeSafetyIncident({
      phase: 'failed',
      code: 'survival_incident_ended_by_death',
      detail: 'The unresolved survival incident ended when the bot died.',
    });
  }

  requestJobFoodUpkeep({ workOrderId, requester = '', targetFoodPoints = 24 } = {}) {
    const normalizedId = boundedDecisionText(workOrderId, 96);
    if (!normalizedId) return false;
    this.jobFoodUpkeep = Object.freeze({
      workOrderId: normalizedId,
      requester: boundedDecisionText(requester, 32),
      targetFoodPoints: Math.max(1, Math.min(64, Math.floor(Number(targetFoodPoints) || 24))),
    });
    this.nextEligibleAt = 0;
    this.agent.behavior_arbiter?.wake?.('job_food_upkeep_requested');
    return true;
  }

  clearJobFoodUpkeep(workOrderId) {
    if (!this.jobFoodUpkeep || this.jobFoodUpkeep.workOrderId !== workOrderId) return false;
    this.jobFoodUpkeep = null;
    if (this.foodSourceBlocker?.workOrderId === workOrderId) this.foodSourceBlocker = null;
    return true;
  }

  jobFoodUpkeepOutcome(workOrderId) {
    if (!this.jobFoodUpkeep || this.jobFoodUpkeep.workOrderId !== workOrderId) return null;
    if (
      this.foodSourceBlocker?.workOrderId === workOrderId
      && this.status.phase === 'waiting'
      && this.status.code === 'recovery_food_sources_exhausted'
    ) {
      return Object.freeze({
        phase: 'failed',
        code: 'food_resupply_unavailable',
        detail: 'Bounded survival food acquisition and return recovery found no safe source.',
      });
    }
    return Object.freeze({ phase: 'pending', code: 'food_resupply_pending' });
  }

  blocksLowerPriority() {
    if (this.inFlight || this.status.phase === 'acting') return true;
    // An unresolved Safety incident owns the body. A future Agenda entry may
    // happen to name the same player, but it is still suspended player work;
    // Survival dispatches its own bounded rendezvous and releases this gate
    // only when the incident itself reaches a terminal safe settlement.
    if (this.safetyIncident) return true;
    let criticalNeed = false;
    let situation;
    try {
      situation = this.getSituation(this.agent);
      const policy = this.agent.runtime?.survival || {};
      criticalNeed = Number(situation.health) <= 8
        || Number(situation.hunger) <= Number(policy.criticalFood ?? 6);
    } catch {
      // Unknown survival state must not seize player control indefinitely.
      return false;
    }
    if (!criticalNeed) return false;
    // A typed player Agenda can already own the exact safe remedy. Let its
    // verified pickup/consume chain run instead of repeatedly inventing a
    // generic acquisition route and starving the queued work. Immediate
    // danger and any in-flight survival action retain their existing priority.
    if (agendaFoodRemedy(this.agent, situation)) return false;
    if (
      Date.now() < this.nextEligibleAt
      && ['succeeded', 'failed', 'blocked', 'interrupted', 'recovering'].includes(this.status.phase)
    ) {
      // An action-settlement cooldown rate-limits the next survival action; it
      // is not a lease for lower-priority work to restart while the same bodily
      // need is still critical. Acquisition success must flow directly into
      // consumption before a player job can reclaim the body.
      return true;
    }
    // Critical bodily state itself owns the priority boundary. Restricting
    // this hold to a handful of waiting codes left a race after an eat,
    // shelter, or retreat action settled: the player Goal could reacquire the
    // body at one health before SurvivalDirector selected its next remedy.
    return true;
  }

  permitsIdleEmbodiment() {
    return !this.inFlight
      && this.status.phase === 'waiting'
      && (
        this.status.code === 'recovery_food_sources_exhausted'
        || SAFETY_WAIT_CODES.has(this.status.code)
      );
  }

  finish(result = {}) {
    const previousPhase = this.status?.phase;
    const previousCode = this.status?.code;
    super.finish(result);
    if (previousPhase !== this.status.phase || previousCode !== this.status.code) {
      this.agent.publishBehaviorEvent?.({
        type: 'survival.changed',
        target: this.status.target,
        evidence: {
          code: this.status.code,
          phase: this.status.phase,
        },
        salience: ['failed', 'blocked', 'interrupted'].includes(this.status.phase) ? 4 : 2,
      });
    }
  }

  captureFoodSourceBlocker(intent = {}, result = null) {
    const position = physicalPosition(this.agent.bot?.entity?.position);
    if (!position) return;
    const continuesRecovery = ['food_search_expanded', 'food_access_restored'].includes(intent.reason);
    const prior = continuesRecovery ? this.foodSourceBlocker : null;
    const observedAccessRequirement = result?.evidence?.skill?.accessRequirement || null;
    const observedSurfaceRequirement = ['surface', 'food_region'].includes(
      observedAccessRequirement?.kind,
    );
    const consumedSurfaceAccess = intent.reason === 'food_access_restored';
    // A generic covered-surface arrival can be valid for ordinary locomotion
    // and still be insufficient for a concrete crop or animal above the body.
    // If that stronger evidence arrives after a successful generic surface
    // attempt, reopen exactly one open-surface recovery instead of preserving
    // the stale "surface already attempted" bit forever.
    const reopenSurfaceRecovery = Boolean(
      observedSurfaceRequirement
      && !consumedSurfaceAccess
      && prior?.surfaceAttempted === true
      && prior?.surfaceSucceeded === true
    );
    const searchRadius = Math.max(
      FOOD_SEARCH_INITIAL_RADIUS,
      Math.min(FOOD_SEARCH_MAX_RADIUS, Math.floor(Number(intent.searchRadius) || FOOD_SEARCH_INITIAL_RADIUS)),
    );
    this.foodSourceBlocker = {
      position,
      dimension: dimensionName(this.agent.bot?.game?.dimension),
      requester: prior?.requester || activePlayerRequester(this.agent),
      workOrderId: boundedDecisionText(intent.workOrderId || prior?.workOrderId, 96),
      targetFoodPoints: Math.max(1, Math.floor(Number(intent.targetFoodPoints || prior?.targetFoodPoints) || 1)),
      searchRadius,
      returnAttempted: prior?.returnAttempted === true,
      returnSucceeded: prior?.returnSucceeded === true,
      surfaceAttempted: reopenSurfaceRecovery ? false : prior?.surfaceAttempted === true,
      surfaceSucceeded: reopenSurfaceRecovery ? false : prior?.surfaceSucceeded === true,
      surfaceAccessResolved: reopenSurfaceRecovery || consumedSurfaceAccess
        ? false
        : prior?.surfaceAccessResolved === true,
      homeAttempted: prior?.homeAttempted === true,
      homeSucceeded: prior?.homeSucceeded === true,
      surfaceAccessRequired: prior?.surfaceAccessRequired === true
        || observedSurfaceRequirement,
      huntableFoodSourceSignature: huntableFoodSourceSignature(this.agent.bot),
    };
  }

  // A settled sleep rejection is evidence about one exact bed, not a licence to
  // ask the same bed again every cooldown. The 2026-08-14 night produced 35
  // identical `skill_bed_occupied` attempts on one bed with zero displacement,
  // because the receipt carried a static `retryable: true`. Failing to rest is
  // also what accumulates the insomnia that spawns phantoms, so an unchanged
  // retry here is not merely noise.
  captureSleepBlocker(intent = {}, result = {}) {
    const position = physicalPosition(this.agent.bot?.entity?.position);
    // Block the bed that was physically attempted, not the one that was
    // intended. If an executor ever substitutes a different bed, recording the
    // intended one would leave the real failure unblocked and let the blocker
    // alternate between the two forever.
    const attempted = result?.target;
    const bed = [attempted?.x, attempted?.y, attempted?.z].every(Number.isFinite)
      ? attempted
      : intent?.target;
    if (!position || !bed || ![bed.x, bed.y, bed.z].every(Number.isFinite)) return;
    const bedIdentity = `${Number(bed.x)}:${Number(bed.y)}:${Number(bed.z)}`;
    const code = boundedDecisionText(result?.code, 64) || 'sleep_rejected';
    const night = isNightTime(Number(this.agent.bot?.time?.timeOfDay || 0));
    const materialChangeBlocker = createMaterialChangeBlocker({
      owner: 'survival',
      obligationId: `sleep:${bedIdentity}`,
      code,
      checkpoint: {
        position,
        dimension: dimensionName(this.agent.bot?.game?.dimension),
        targetSignature: code === 'skill_bed_occupied'
          ? `${bedIdentity}:occupied`
          : null,
        cycleSignature: night ? 'night' : null,
      },
      releasePredicates: [
        'dimension',
        ...(code === 'skill_bed_occupied' ? ['target_signature'] : []),
        ...(night ? ['cycle_signature'] : []),
      ],
      // Backstop. The cycle predicate releases this at dawn, but only when the
      // blocker was created at night; a daytime rejection would otherwise wait
      // on dimension or bed occupancy alone and could park indefinitely.
      holdMs: SLEEP_RETRY_HOLD_MS,
      createdAt: Date.now(),
    });
    if (!materialChangeBlocker) return;
    const blocker = Object.freeze({
      bed: Object.freeze({
        name: boundedDecisionText(bed.name, 48) || 'bed',
        x: Number(bed.x),
        y: Number(bed.y),
        z: Number(bed.z),
      }),
      position,
      dimension: dimensionName(this.agent.bot?.game?.dimension),
      code,
      night,
      materialChangeBlocker,
    });
    const key = bedIdentity;
    this.sleepBlockers.set(key, blocker);
    this.sleepBlocker = blocker;
  }

  // Release requires evidence that the rejected interaction itself changed.
  // Walking to another fallback bed is ordinary execution, not evidence that
  // an earlier occupied bed became usable. Elapsed time and cooldowns likewise
  // release nothing.
  sleepBlockerReleased(blocker, situation = {}) {
    if (!blocker) return true;
    const position = physicalPosition(this.agent.bot?.entity?.position);
    const dimension = dimensionName(this.agent.bot?.game?.dimension);
    // Unknown is not material change. Without authoritative position evidence
    // there is no proof anything moved, so the blocker must be retained.
    if (!position) return false;
    const bedIdentity = `${blocker.bed.x}:${blocker.bed.y}:${blocker.bed.z}`;
    const current = (Array.isArray(situation.beds) ? situation.beds : []).find(candidate => (
      Number(candidate?.x) === blocker.bed.x
      && Number(candidate?.y) === blocker.bed.y
      && Number(candidate?.z) === blocker.bed.z
    ));
    const observation = {
      position,
      dimension,
      targetSignature: blocker.code === 'skill_bed_occupied' && typeof current?.occupied === 'boolean'
        ? `${bedIdentity}:${current.occupied ? 'occupied' : 'available'}`
        : null,
      cycleSignature: blocker.night
        ? isNightTime(Number(situation.timeOfDay || 0)) ? 'night' : 'day'
        : null,
    };
    return evaluateMaterialChange(blocker.materialChangeBlocker, observation).materialChanged === true;
  }

  // Every rejected physical bed from this night is withheld. Other reachable
  // safe beds remain selectable, so fallback progresses instead of alternating
  // between two occupied beds forever.
  eligibleSleepBeds(situation = {}) {
    const beds = Array.isArray(situation.beds) ? situation.beds : [];
    if (this.sleepBlockers.size === 0) return beds;
    for (const [key, blocker] of this.sleepBlockers) {
      if (this.sleepBlockerReleased(blocker, situation)) this.sleepBlockers.delete(key);
    }
    this.sleepBlocker = [...this.sleepBlockers.values()].at(-1) || null;
    if (this.sleepBlockers.size === 0) return beds;
    const eligible = beds.filter(candidate => !this.sleepBlockers.has(
      `${Number(candidate?.x)}:${Number(candidate?.y)}:${Number(candidate?.z)}`,
    ));
    // Exhausting every reachable bed is the end of this rung, not silence. The
    // fallback contract requires one concise receipt-grounded statement, and
    // reporting a single bed name reads as one arbitrary failure rather than
    // "there is nowhere here to sleep". Announced once per exhausted set.
    if (beds.length > 0 && eligible.length === 0) this.announceSleepExhausted(beds.length);
    else this.sleepExhaustionAnnouncedFor = null;
    return eligible;
  }

  announceSleepExhausted(blockedCount) {
    const count = Math.max(1, Math.floor(Number(blockedCount) || 1));
    if (this.sleepExhaustionAnnouncedFor === count) return false;
    this.sleepExhaustionAnnouncedFor = count;
    if (typeof this.agent.openChat !== 'function') return false;
    const reasons = [...new Set(
      [...this.sleepBlockers.values()].map(blocker => boundedDecisionText(blocker.code, 48)).filter(Boolean),
    )];
    const cause = reasons.length === 1 && reasons[0] === 'skill_bed_occupied'
      ? 'they are all occupied'
      : `of ${reasons.join(', ') || 'an unresolved bed failure'}`;
    const message = count === 1
      ? `I cannot sleep here: the only bed I can reach is unusable because ${cause}. I am not going to keep asking it.`
      : `I cannot sleep here: all ${count} beds I can reach are unusable because ${cause}. I am not going to keep asking them.`;
    void Promise.resolve(this.agent.openChat(message)).catch(error => {
      console.warn(`[survival] Could not announce sleep exhaustion: ${boundedDecisionText(error?.message || error, 160)}`);
    });
    return true;
  }

  settleSleep(intent, result) {
    if (intent?.kind !== 'sleep') return;
    if (result?.phase === 'interrupted' || result?.code === 'interrupted') return;
    if (result?.phase === 'succeeded') {
      this.sleepBlockers.clear();
      this.sleepBlocker = null;
      return;
    }
    if (result?.phase === 'failed') this.captureSleepBlocker(intent, result);
  }

  safetyIncidentIntent(situation, policy = this.agent.runtime?.survival || {}) {
    const incident = this.safetyIncident;
    if (!incident) return null;
    if (situation.held) {
      return { kind: 'wait', reason: 'safety_help_unavailable', incidentId: incident.id };
    }
    if (situation.urgentDanger) return { kind: 'defer_to_reflex', incidentId: incident.id };

    const threats = loadedIncidentThreats(this.agent, incident);
    const threat = loadedIncidentThreat(this.agent, incident);
    if (threats.length > 0) {
      const now = this.now();
      const sightBlocked = threats.every(candidate => (
        hasLineOfSightToEntity(this.agent.bot, candidate) === false
      ));
      const contained = occupiesDefensiveShelter(this.agent.bot) && sightBlocked;
      const threatDistances = Object.fromEntries(threats
        .map(candidate => [
          String(candidate.id),
          this.agent.bot?.entity?.position?.distanceTo?.(candidate.position),
        ])
        .filter(([, distance]) => Number.isFinite(distance)));
      const priorDistances = incident.disengagementDistances || null;
      const distanceBandComplete = Object.keys(threatDistances).length === threats.length;
      const separationNotClosing = Boolean(
        distanceBandComplete
        && priorDistances
        && Object.entries(threatDistances).every(([id, distance]) => (
          Number.isFinite(Number(priorDistances[id]))
          && distance >= Number(priorDistances[id]) - SAFETY_SEPARATION_CLOSING_TOLERANCE
        )),
      );
      const separationCandidate = !contained
        && sightBlocked
        && distanceBandComplete
        && now - Number(incident.lastDamageAt || incident.startedAt || now) >= SAFETY_INCIDENT_CALM_MS;
      const disengagementStartedAt = separationCandidate && separationNotClosing
        ? Number(incident.disengagementStartedAt) || now
        : now;
      this.replaceSafetyIncident({
        lastThreatSeenAt: now,
        ...(!contained ? { containmentStartedAt: null } : {}),
        ...(!contained && separationCandidate
          ? {
              disengagementStartedAt,
              disengagementDistances: Object.freeze({ ...threatDistances }),
            }
          : {
              disengagementStartedAt: null,
              disengagementDistances: null,
            }),
      });
      if (contained) {
        const containmentStartedAt = Number(incident.containmentStartedAt) || now;
        if (now - containmentStartedAt >= SAFETY_CONTAINMENT_STABLE_MS) {
          this.containedThreatGuard = Object.freeze({
            incidentId: incident.id,
            source: incident.source,
            sources: Object.freeze([...incidentSources(incident)]),
            containedAt: now,
          });
          this.closeSafetyIncident({
            code: 'safety_structurally_contained',
            detail: `A complete refuge blocked line of sight from all ${threats.length} loaded incident threat${threats.length === 1 ? '' : 's'} through the bounded stability window.`,
          });
          return null;
        }
        this.replaceSafetyIncident({ stage: 'under_cover', containmentStartedAt });
        return {
          kind: 'wait',
          reason: 'safety_containment_stabilizing',
          retryable: true,
          incidentId: incident.id,
        };
      }
      if (separationCandidate) {
        if (
          separationNotClosing
          && now - disengagementStartedAt >= SAFETY_CONTAINMENT_STABLE_MS
        ) {
          const minimumDistances = Object.freeze(Object.fromEntries(
            Object.entries(threatDistances).map(([id, distance]) => [
              id,
              Math.max(SAFETY_GUARD_BREACH_DISTANCE, distance - 2),
            ]),
          ));
          this.containedThreatGuard = Object.freeze({
            kind: 'stable_disengagement',
            incidentId: incident.id,
            source: incident.source,
            sources: Object.freeze([...incidentSources(incident)]),
            minimumDistance: SAFETY_GUARD_BREACH_DISTANCE,
            minimumDistances,
            disengagedAt: now,
          });
          this.closeSafetyIncident({
            code: 'safety_stably_disengaged',
            detail: `All ${threats.length} loaded incident threat${threats.length === 1 ? '' : 's'} remained behind blocked sight without renewed damage or closing separation through the bounded stability window.`,
          });
          return null;
        }
        this.replaceSafetyIncident({ stage: 'disengaging', disengagementStartedAt });
        return {
          kind: 'wait',
          reason: 'safety_disengagement_stabilizing',
          retryable: true,
          incidentId: incident.id,
        };
      }
    } else if (
      incidentSources(incident).some(source => ['hostile', 'other_entity', 'unknown'].includes(source.kind))
      && this.now() - Math.max(
        Number(incident.lastDamageAt) || 0,
        Number(incident.lastThreatSeenAt) || 0,
      ) >= SAFETY_INCIDENT_CALM_MS
    ) {
      this.closeSafetyIncident({
        code: incident.source.kind === 'hostile'
          ? 'attributed_threat_disengaged'
          : 'damage_source_no_longer_active',
        detail: 'The attributed source is no longer loaded and no further damage arrived during the bounded calm window.',
      });
      return null;
    }

    if (
      !threat
      && incident.stage === 'under_cover'
      && occupiesDefensiveShelter(this.agent.bot)
    ) {
      return {
        kind: 'wait',
        reason: 'safety_containment_verification',
        retryable: true,
        incidentId: incident.id,
      };
    }

    let player = safetyPlayerTarget(this.agent, incident);
    if (
      player
      && String(this.unavailableSafetyPlayer?.name || '').toLowerCase() === player.toLowerCase()
    ) {
      if (safetyPlayerPresenceConfirmed(this.agent, player)) {
        this.unavailableSafetyPlayer = null;
      } else {
        player = null;
      }
    }
    if (player) {
      if (safetyPlayerDistance(this.agent, player) <= SAFETY_RENDEZVOUS_DISTANCE) {
        this.closeSafetyIncident({
          code: 'safety_rendezvous_reached',
          detail: `Reached ${player} after the safety reflex instead of treating spacing as completion.`,
        });
        return null;
      }
      if (String(incident.failedPlayerTarget || '').toLowerCase() !== player.toLowerCase()) {
        return {
          kind: 'return_to_player',
          target: { name: player },
          reason: 'survival_incident_seeking_player_help',
          incidentId: incident.id,
          preempt: true,
        };
      }
    }

    const cover = (Array.isArray(situation.shelters) ? situation.shelters : [])
      .filter(candidate => (
        candidate?.reachable === true
        && candidate?.safe === true
        && ['success', 'already_at_stance'].includes(candidate?.pathStatus)
        && ['blocked_threat_line_of_sight', 'overhead_cover'].includes(candidate?.coverStatus)
        && `${Math.floor(candidate.x)},${Math.floor(candidate.y)},${Math.floor(candidate.z)}`
          !== incident.failedCoverTarget
      ))
      .sort((left, right) => Number(left.distance) - Number(right.distance))[0];
    if (cover) {
      return {
        kind: 'seek_shelter',
        target: {
          name: cover.name || 'covered_space',
          x: cover.x,
          y: cover.y,
          z: cover.z,
          distance: cover.distance,
        },
        reason: 'survival_incident_verified_cover',
        incidentId: incident.id,
        preempt: true,
      };
    }

    if (situation.canShelterInPlace === true) {
      return {
        kind: 'shelter_in_place',
        reason: 'survival_incident_seal_ready',
        incidentId: incident.id,
        preempt: true,
      };
    }

    const shelterRelocation = (Array.isArray(situation.shelterInPlaceStances)
      ? situation.shelterInPlaceStances
      : [])
      .filter(candidate => (
        `${Math.floor(candidate.x)},${Math.floor(candidate.y)},${Math.floor(candidate.z)}`
          !== incident.failedShelterTarget
      ))[0];
    if (shelterRelocation) {
      return {
        kind: 'relocate_for_shelter',
        target: shelterRelocation,
        reason: 'survival_incident_relocating_for_seal',
        incidentId: incident.id,
        preempt: true,
      };
    }

    // A settled tactical reflex is not allowed to turn "no helper/route" into
    // an indefinite wait while a deterministic bodily action remains locally
    // executable. Reuse the same survival ladder and correlate the action to
    // this incident; do not create a second food or shelter policy here.
    const localRecovery = chooseSurvivalIntent(situation, policy);
    if (['heal', 'eat', 'shelter_in_place'].includes(localRecovery?.kind)) {
      return {
        ...localRecovery,
        incidentId: incident.id,
      };
    }

    if (incident.source.kind === 'requester_player') {
      return {
        kind: 'wait',
        reason: 'safety_waiting_for_intent_clarification',
        retryable: true,
        incidentId: incident.id,
      };
    }
    return {
      kind: 'wait',
      reason: threat ? 'safety_cover_unavailable' : 'safety_help_unavailable',
      retryable: true,
      incidentId: incident.id,
      shelterBlocker: boundedDecisionText(situation.shelterInPlaceFeasibility?.code, 80) || null,
      shelterCandidates: Array.isArray(situation.shelterInPlaceStances)
        ? situation.shelterInPlaceStances.length
        : 0,
    };
  }

  settleSafetyIncident(intent, result) {
    if (!intent?.incidentId || !this.safetyIncident || intent.incidentId !== this.safetyIncident.id) {
      return false;
    }
    if (result?.phase === 'interrupted' || result?.phase === 'cancelled' || result?.code === 'interrupted') {
      this.replaceSafetyIncident({ stage: 'disengaged' });
      return false;
    }
    if (result?.phase !== 'succeeded') {
      if (
        intent.kind === 'return_to_player'
        && result?.code === 'skill_target_offline'
        && result?.retryable !== true
      ) {
        this.unavailableSafetyPlayer = Object.freeze({
          name: boundedDecisionText(intent.target?.name, 32),
          code: result.code,
          observedAt: this.now(),
        });
      }
      this.replaceSafetyIncident({
        stage: 'recovery_blocked',
        ...(intent.kind === 'return_to_player'
          ? { failedPlayerTarget: intent.target?.name || null }
          : intent.kind === 'seek_shelter'
            ? { failedCoverTarget: `${Math.floor(intent.target.x)},${Math.floor(intent.target.y)},${Math.floor(intent.target.z)}` }
            : intent.kind === 'relocate_for_shelter'
              ? { failedShelterTarget: `${Math.floor(intent.target.x)},${Math.floor(intent.target.y)},${Math.floor(intent.target.z)}` }
            : {}),
      });
      return false;
    }
    if (intent.kind === 'return_to_player') {
      if (
        String(this.unavailableSafetyPlayer?.name || '').toLowerCase()
          === String(intent.target?.name || '').toLowerCase()
      ) {
        this.unavailableSafetyPlayer = null;
      }
      this.announceSafetyIncident(
        'safety_rendezvous_reached',
        `I made it to ${intent.target.name}. I need help with the ${this.safetyIncident.source.name || 'thing that hit me'}.`,
      );
      return this.closeSafetyIncident({
        code: 'safety_rendezvous_reached',
        detail: `Reached ${intent.target.name} after the safety reflex.`,
      });
    }
    if (intent.kind === 'relocate_for_shelter') {
      this.replaceSafetyIncident({
        stage: 'shelter_relocated',
        failedShelterTarget: null,
      });
      return false;
    }
    if (intent.kind === 'seek_shelter' || intent.kind === 'shelter_in_place') {
      const threat = loadedIncidentThreat(this.agent, this.safetyIncident);
      const coverVerified = occupiesDefensiveShelter(this.agent.bot)
        && (!threat || hasLineOfSightToEntity(this.agent.bot, threat) === false);
      if (!coverVerified) {
        this.replaceSafetyIncident({ stage: 'cover_unverified' });
        return false;
      }
      if (this.safetyIncident.source.kind === 'requester_player') {
        this.replaceSafetyIncident({ stage: 'under_cover' });
        return false;
      }
      this.announceSafetyIncident(
        'verified_threat_cover_reached',
        `I'm under cover from the ${this.safetyIncident.source.name || 'thing that hit me'}.`,
      );
      this.replaceSafetyIncident({
        stage: 'under_cover',
        ...(threat ? { lastThreatSeenAt: Date.now() } : {}),
      });
      return false;
    }
    return false;
  }

  foodRecoveryIntent(situation, policy) {
    const blocker = this.foodSourceBlocker;
    if (!blocker) return null;
    if (blocker.surfaceAccessResolved === true) {
      return {
        kind: 'acquire_food',
        targetFoodPoints: Math.max(1, Math.floor(Number(blocker.targetFoodPoints) || 1)),
        searchRadius: Math.max(
          FOOD_SEARCH_INITIAL_RADIUS,
          Math.min(FOOD_SEARCH_MAX_RADIUS, Math.floor(Number(blocker.searchRadius) || FOOD_SEARCH_INITIAL_RADIUS)),
        ),
        reason: 'food_access_restored',
        preempt: true,
      };
    }
    const currentPosition = physicalPosition(this.agent.bot?.entity?.position);
    const currentDimension = dimensionName(this.agent.bot?.game?.dimension);
    const safeFoodAvailable = rankFoodCandidates(situation.food, situation, policy).length > 0;
    const healingAvailable = (Array.isArray(situation.healingConsumables)
      ? situation.healingConsumables
      : []).some(candidate => candidate?.item === 'healing_potion' && Number(candidate.count) > 0);
    const requester = activePlayerRequester(this.agent);
    const currentHuntableFoodSources = huntableFoodSourceSignature(this.agent.bot);
    if (!blocker.requester && requester) blocker.requester = requester;
    const materialChange = (
      !currentPosition
      || currentDimension !== blocker.dimension
      || (
        blocker.returnSucceeded === true
        && distanceBetween(currentPosition, blocker.position) >= FOOD_RECOVERY_REGION_CHANGE_DISTANCE
      )
      || (
        blocker.surfaceSucceeded === true
        && distanceBetween(currentPosition, blocker.position) >= FOOD_RECOVERY_REGION_CHANGE_DISTANCE
      )
      || (
        blocker.homeSucceeded === true
        && distanceBetween(currentPosition, blocker.position) >= FOOD_RECOVERY_REGION_CHANGE_DISTANCE
      )
      || (
        Number(situation.health) > 14
        && Number(situation.hunger) >= 18
      )
      || safeFoodAvailable
      || healingAvailable
      || Boolean(
        currentHuntableFoodSources
        && currentHuntableFoodSources !== String(blocker.huntableFoodSourceSignature || '')
      )
      || Boolean(requester && requester !== blocker.requester)
    );
    if (materialChange) {
      this.foodSourceBlocker = null;
      return null;
    }
    if (situation.held || situation.urgentDanger) return null;
    if (!blocker.returnAttempted && blocker.requester) {
      return {
        kind: 'return_to_player',
        target: { name: blocker.requester },
        reason: 'food_sources_exhausted_returning_to_requester',
      };
    }
    let atUsableSurface = false;
    try {
      atUsableSurface = this.isAtSurface(this.agent.bot) === true;
    } catch {
      // Unknown surface state is not authority to skip the bounded surface
      // command; that command owns the full physical verification.
    }
    if ((blocker.surfaceAccessRequired || !atUsableSurface) && !blocker.surfaceAttempted) {
      return {
        kind: 'return_to_surface',
        target: { name: 'usable_surface' },
        reason: 'food_sources_exhausted_returning_to_surface',
      };
    }
    const home = rememberedHome(this.agent, currentDimension);
    if (
      !blocker.homeAttempted
      && home
      && distanceBetween(currentPosition, home) > 3
    ) {
      return {
        kind: 'return_home',
        target: home,
        reason: 'food_sources_exhausted_returning_home',
      };
    }
    const priorSearchRadius = Math.max(
      FOOD_SEARCH_INITIAL_RADIUS,
      Math.floor(Number(blocker.searchRadius) || FOOD_SEARCH_INITIAL_RADIUS),
    );
    if (priorSearchRadius < FOOD_SEARCH_MAX_RADIUS) {
      const searchRadius = Math.min(FOOD_SEARCH_MAX_RADIUS, priorSearchRadius * 2);
      return {
        kind: 'acquire_food',
        targetFoodPoints: Math.max(1, Math.floor(Number(blocker.targetFoodPoints) || 1)),
        searchRadius,
        reason: 'food_search_expanded',
        ...(Number(situation.health) <= 8 || Number(situation.hunger) <= Number(policy.criticalFood ?? 6)
          ? { preempt: true }
          : {}),
      };
    }
    return {
      kind: 'wait',
      reason: 'recovery_food_sources_exhausted',
      retryable: true,
    };
  }

  settleFoodRecovery(intent, result) {
    if (intent?.kind === 'acquire_food') {
      if (['skill_no_food_sources', 'skill_source_access_required'].includes(result?.code)) {
        this.captureFoodSourceBlocker(intent, result);
      }
      else if (result?.phase === 'succeeded') this.foodSourceBlocker = null;
      return;
    }
    if (result?.phase === 'interrupted' || result?.code === 'interrupted') return;
    if (intent?.kind === 'return_to_player' && this.foodSourceBlocker) {
      this.foodSourceBlocker.returnAttempted = true;
      this.foodSourceBlocker.returnSucceeded = result?.phase === 'succeeded';
      return;
    }
    if (intent?.kind === 'return_to_surface' && this.foodSourceBlocker) {
      this.foodSourceBlocker.surfaceAttempted = true;
      this.foodSourceBlocker.surfaceSucceeded = result?.phase === 'succeeded';
      this.foodSourceBlocker.surfaceAccessResolved = Boolean(
        result?.phase === 'succeeded'
        && this.foodSourceBlocker.surfaceAccessRequired === true
      );
      return;
    }
    if (intent?.kind === 'return_home' && this.foodSourceBlocker) {
      this.foodSourceBlocker.homeAttempted = true;
      this.foodSourceBlocker.homeSucceeded = result?.phase === 'succeeded';
    }
  }

  settleDispatch(lease, result) {
    if (!this.claimDispatchSettlement(lease)) return false;
    const intent = lease.metadata?.intent || null;
    const situation = lease.metadata?.situation || {};
    if (!result?.actionId) {
      this.fail('missing_action_result', 'Survival action returned without a new structured result.', true);
      this.nextEligibleAt = Date.now() + FAILURE_COOLDOWN_MS;
      return true;
    }
    const safetySettled = this.settleSafetyIncident(intent, result);
    this.settleFoodRecovery(intent, result);
    this.settleSleep(intent, result);
    this.settleUsefulDrops(intent, result, situation);
    if (!safetySettled) this.finish(result);
    this.nextEligibleAt = Date.now() + (
      result.phase === 'succeeded' ? SUCCESS_COOLDOWN_MS : FAILURE_COOLDOWN_MS
    );
    return true;
  }

  reconcileDispatch() {
    const reconciliation = this.reconcileDispatchLease();
    if (reconciliation.state === 'terminal') {
      this.settleDispatch(reconciliation.lease, reconciliation.result);
      return true;
    }
    if (reconciliation.state !== 'orphaned') return false;
    return this.settleDispatch(reconciliation.lease, {
      actionId: `${reconciliation.lease.id}:orphaned`,
      phase: 'failed',
      code: 'survival_dispatch_orphaned',
      detail: `Survival released an idle body after ${Math.round(reconciliation.elapsedMs)}ms without a correlated ActionManager activity or terminal result.`,
      retryable: true,
    });
  }

  update() {
    // The physical actuator is authoritative over a director's logical lease.
    // Adopt a terminal result that outlived its command Promise, or fail open
    // when no matching action ever started; never let stale inFlight state hold
    // every lower lane indefinitely.
    this.reconcileDispatch();
    const evaluatedAt = Date.now();
    const policy = this.agent.runtime?.survival;
    const gate = this.scheduleGate({ allowBusy: true, now: evaluatedAt });
    const context = {
      evaluatedAt,
      gate,
      policy: {
        mode: policy?.mode,
        criticalFood: policy?.criticalFood,
        eatAt: policy?.eatAt,
        autonomy: this.agent.runtime?.autonomy,
      },
      situation: {
        health: this.agent.bot?.health,
        hunger: this.agent.bot?.food,
        held: gate.held,
        urgentDanger: null,
        idle: gate.idle,
      },
      intent: null,
      jobFoodUpkeep: this.jobFoodUpkeep,
      durablePlayerWorkActive: null,
    };
    if (!policy) {
      this.recordDecision(context, 'policy_missing');
      return;
    }
    if (policy.mode === 'off') {
      this.recordDecision(context, 'policy_off');
      return;
    }
    if (!gate.allowed) {
      this.recordDecision(context, `schedule_${gate.code}`);
      return;
    }

    let situation;
    let intent;
    try {
      situation = this.getSituation(this.agent);
      // Withhold only a bed that already failed against evidence that has not
      // changed. The policy stays pure: it still picks the nearest reachable
      // safe bed from whatever remains, and its existing
      // `no_safe_reachable_bed` wait covers an empty list.
      situation = {
        ...situation,
        beds: this.eligibleSleepBeds(situation),
        usefulDrops: this.eligibleUsefulDrops(situation),
      };
      // Command autonomy already suppresses the idle item-collecting mode. Keep
      // the same authority boundary for world-changing night shelters: nearby
      // drops and optional construction are upkeep, not bodily emergencies that
      // may invent movement or blocks after player work ends. Explicit shelter
      // orders and critical health/hunger responses remain unaffected.
      const effectivePolicy = this.agent.runtime?.autonomy === 'command'
        ? { ...policy, usefulDrops: 'ignore', shelter: 'off' }
        : policy;
      const activeJobId = this.agent.job_director?.activeOrder?.id;
      if (this.jobFoodUpkeep && activeJobId !== this.jobFoodUpkeep.workOrderId) {
        this.clearJobFoodUpkeep(this.jobFoodUpkeep.workOrderId);
      }
      const cooperativeUpkeep = this.jobFoodUpkeep;
      const immediateBodilyIntent = chooseSurvivalIntent(situation, effectivePolicy);
      // Failed food routing is memory for the next food acquisition; it is not
      // a higher survival policy. A stale food blocker must never mask a newly
      // available heal, meal, or protective shelter posture.
      const recoveryFoodIntent = this.foodRecoveryIntent(situation, effectivePolicy);
      // A successful open-surface access action is a causal prerequisite, not
      // ordinary idle movement. Give its exact food continuation the next body
      // turn before generic exposed-body shelter policy can immediately dig the
      // bot underground again. A fresh Safety incident/urgent danger still
      // outranks this branch above and inside Safety's own supervisor.
      const restoredFoodContinuation = recoveryFoodIntent?.reason === 'food_access_restored'
        && situation.urgentDanger !== true;
      const routedFoodIntent = restoredFoodContinuation
        ? recoveryFoodIntent
        : immediateBodilyIntent?.kind === 'acquire_food'
          ? recoveryFoodIntent || immediateBodilyIntent
          : immediateBodilyIntent || recoveryFoodIntent;
      intent = this.safetyIncidentIntent(situation, effectivePolicy)
        || routedFoodIntent
        || (cooperativeUpkeep ? {
          kind: 'acquire_food',
          targetFoodPoints: cooperativeUpkeep.targetFoodPoints,
          reason: 'durable_job_food_resupply',
          workOrderId: cooperativeUpkeep.workOrderId,
        } : null);
      if (intent?.kind === 'acquire_food' && !Number.isFinite(Number(intent.searchRadius))) {
        intent = {
          ...intent,
          searchRadius: Number(situation.health) <= 8
            || Number(situation.hunger) <= Number(policy.criticalFood ?? 6)
            ? FOOD_SEARCH_INITIAL_RADIUS
            : 64,
        };
      }
      context.jobFoodUpkeep = cooperativeUpkeep;
      context.situation = situation;
      context.intent = intent;
    } catch (error) {
      this.recordDecision(context, 'situation_unavailable');
      this.fail('situation_unavailable', error?.message || error, true);
      this.nextEligibleAt = Date.now() + FAILURE_COOLDOWN_MS;
      return;
    }
    if (!intent) {
      this.recordDecision(context, 'no_intent');
      return;
    }
    if (intent.kind === 'defer_to_reflex') {
      this.recordDecision(context, 'safety_reflex_retains_control');
      return;
    }
    const durablePlayerWorkActive = Boolean(
      this.agent.goal_director?.activeGoal
      || this.agent.agenda_director?.hasUnfinished?.()
      || this.agent.job_director?.activeOrder?.source === 'player'
      || this.agent.job_director?.activeOrder?.source === 'restart'
    );
    context.durablePlayerWorkActive = durablePlayerWorkActive;
    const criticalSurvivalNeed = Number(situation.health) <= 8
      || Number(situation.hunger) <= Number(policy.criticalFood ?? 6);
    const queuedFoodRemedy = GENERIC_FOOD_RECOVERY_INTENTS.has(intent.kind)
      ? agendaFoodRemedy(this.agent, situation)
      : null;
    if (durablePlayerWorkActive && queuedFoodRemedy) {
      // Agenda owns selection and durable ordering; SurvivalDirector only
      // yields this tick. AgendaDirector will dispatch the ordinary package-
      // backed skill and settle it through the normal structured result path.
      this.recordDecision(context, 'durable_agenda_food_remedy');
      return;
    }
    const cooperativeJobFoodRecovery = Boolean(
      this.jobFoodUpkeep
      && this.agent.job_director?.activeOrder?.id === this.jobFoodUpkeep.workOrderId
      && (
        intent.workOrderId === this.jobFoodUpkeep.workOrderId
        || this.foodSourceBlocker?.workOrderId === this.jobFoodUpkeep.workOrderId
      )
    );
    const safetyIncidentRecovery = Boolean(
      intent.incidentId
      && this.safetyIncident?.id === intent.incidentId
    );
    if (
      durablePlayerWorkActive
      && intent.preempt !== true
      && !criticalSurvivalNeed
      && !cooperativeJobFoodRecovery
      && !safetyIncidentRecovery
    ) {
      // The arbiter evaluates survival before player goals so genuine bodily
      // emergencies can preempt them. Routine upkeep must not exploit brief
      // idle gaps while any durable player agenda, goal, or job reassesses.
      this.recordDecision(context, 'durable_player_work_noncritical');
      return;
    }
    const allowBusy = intent.preempt === true || safetyIncidentRecovery;
    if (situation.idle !== true && !allowBusy) {
      this.recordDecision(context, 'busy_nonpreemptive');
      return;
    }
    if (intent.kind === 'wait') {
      if (intent.incidentId && this.safetyIncident?.id === intent.incidentId) {
        const source = this.safetyIncident.source;
        const message = intent.reason === 'safety_waiting_for_intent_clarification'
          ? 'You hit me. I am staying clear until you tell me whether that was intentional.'
          : intent.reason === 'safety_cover_unavailable'
            ? `I got away from the ${source.name || 'thing that hit me'}, but I cannot verify cover or a safe route. I need help.`
            : intent.reason === 'safety_threat_contained'
              ? `I'm under cover from the ${source.name || 'thing that hit me'} and staying here until it is actually gone.`
              : intent.reason === 'safety_containment_verification'
                ? `The ${source.name || 'thing that hit me'} is out of sight. I'm verifying it stays gone before I resume.`
            : 'I got clear, but I cannot identify a safe helper or verified cover. I need help.';
        this.announceSafetyIncident(intent.reason, message);
      }
      this.finish({
        phase: 'waiting',
        code: intent.reason,
        detail: intent.reason === 'missing_safe_food'
          ? 'Hunger is low, but no safe food is available.'
          : intent.reason === 'recovery_food_sources_exhausted'
            ? 'No safe food source was found and the bounded return strategy is settled; waiting for material new evidence.'
          : intent.reason === 'safety_waiting_for_intent_clarification'
            ? 'The exact player attacker is known, but motive is not observable; waiting for a fresh explicit order.'
          : intent.reason === 'safety_threat_contained'
            ? 'Verified cover contains the loaded attributed threat; Safety retains body ownership until the source is durably gone.'
          : intent.reason === 'safety_containment_verification'
            ? 'The attributed threat is unloaded; Safety retains body ownership through the bounded calm window before resuming lower work.'
          : intent.reason === 'safety_cover_unavailable' && intent.shelterBlocker
            ? `No helper, defensive cover, or reachable seal stance is available; current seal admission is ${intent.shelterBlocker} and the bounded local scan found ${intent.shelterCandidates} candidate(s).`
          : SAFETY_WAIT_CODES.has(intent.reason)
            ? 'The immediate reflex settled, but no verified cover or non-attacking helper is currently available.'
          : 'Survival upkeep is waiting for a safe prerequisite.',
        retryable: intent.retryable === true,
      });
      this.nextEligibleAt = Date.now() + (
        ['safety_threat_contained', 'safety_containment_verification', 'safety_disengagement_stabilizing'].includes(intent.reason)
          ? SUCCESS_COOLDOWN_MS
          : BLOCKED_COOLDOWN_MS
      );
      this.recordDecision(context, 'wait_selected');
      return;
    }

    if (intent.kind === 'shelter_work_order') {
      if (!validateEmergencyShelterBlueprint()) {
        this.recordDecision(context, 'invalid_emergency_blueprint');
        this.fail('invalid_emergency_blueprint', 'Emergency shelter blueprint failed validation.', false);
        return;
      }
      if (!this.begin('shelter_work_order', null, intent.reason, { allowBusy })) {
        this.recordDecision(context, 'begin_rejected');
        return;
      }
      let result;
      try {
        result = this.requestWorkOrder({
          kind: 'emergency_shelter',
          source: 'survival',
          reason: intent.reason,
          blueprint: EMERGENCY_SHELTER_BLUEPRINT,
        });
      } catch (error) {
        this.recordDecision(context, 'work_order_dispatch_error');
        this.fail('work_order_dispatch_error', error?.message || error, true);
        this.nextEligibleAt = Date.now() + FAILURE_COOLDOWN_MS;
        return;
      }
      if (result?.accepted !== true) {
        this.finish({
          phase: 'waiting',
          code: result?.code || 'shelter_work_order_rejected',
          detail: 'Emergency shelter work is waiting for an available job director.',
          retryable: true,
        });
        this.nextEligibleAt = Date.now() + BLOCKED_COOLDOWN_MS;
        this.recordDecision(context, 'shelter_work_order_rejected');
        return;
      }
      this.finish({
        phase: 'requested',
        code: 'emergency_shelter_requested',
        target: { name: result.id || 'emergency_3x3' },
        detail: 'Validated emergency shelter work order accepted.',
        retryable: false,
      });
      this.nextEligibleAt = Date.now() + BLOCKED_COOLDOWN_MS;
      this.recordDecision(context, 'shelter_work_order_requested', { scheduled: true });
      return;
    }

    const command = intent.kind === 'eat'
      ? `!consume(${JSON.stringify(intent.item)})`
      : intent.kind === 'heal'
        ? `!consume(${JSON.stringify(intent.item)})`
      : intent.kind === 'acquire_food'
        ? `!prepareFood(${Math.max(1, Math.floor(Number(intent.targetFoodPoints) || 24))}, ${Math.max(16, Math.min(128, Math.floor(Number(intent.searchRadius) || (criticalSurvivalNeed ? FOOD_SEARCH_INITIAL_RADIUS : 64))))})`
      : intent.kind === 'return_to_player'
        ? `!goToPlayer(${JSON.stringify(intent.target.name)}, 3, true)`
      : intent.kind === 'return_to_surface'
        ? '!goToSurface(true)'
      : intent.kind === 'return_home'
        ? `!goToCoordinates(${intent.target.x}, ${intent.target.y}, ${intent.target.z}, 2, true)`
      : intent.kind === 'relocate_for_shelter'
        ? `!goToCoordinates(${intent.target.x}, ${intent.target.y}, ${intent.target.z}, 0, true)`
      : intent.kind === 'collect_useful_drop'
        ? '!pickupUsefulItems(12)'
      : intent.kind === 'equip'
        ? `!equip(${JSON.stringify(intent.item)})`
      : intent.kind === 'sleep'
        // Bind the exact selected bed. Generic `!goToBed` performs its own
        // 64-block search and takes the nearest, so a blocked near bed would be
        // attempted again even after the policy chose a farther available one.
        ? `!goToBedAt(${intent.target.x}, ${intent.target.y}, ${intent.target.z}, ${JSON.stringify(String(intent.target.dimension || 'overworld'))})`
        : intent.kind === 'seek_shelter'
          ? `!goToCoordinates(${intent.target.x}, ${intent.target.y}, ${intent.target.z}, 1)`
        : intent.kind === 'shelter_in_place'
          ? '!shelterInPlace'
        : null;
    if (!command) {
      this.recordDecision(context, 'unsupported_intent');
      this.fail('unsupported_intent', `Survival intent '${intent.kind}' has no verified command path.`, false);
      return;
    }
    const target = ['eat', 'heal', 'equip'].includes(intent.kind)
      ? { name: intent.item }
      : intent.kind === 'acquire_food'
        ? { name: 'safe_food', foodPoints: intent.targetFoodPoints }
        : intent.kind === 'return_to_player'
          ? intent.target
        : intent.kind === 'return_to_surface'
          ? intent.target
        : intent.kind === 'return_home'
          ? intent.target
        : intent.kind === 'relocate_for_shelter'
          ? intent.target
        : intent.kind === 'collect_useful_drop'
          ? intent.target
        : intent.kind === 'shelter_in_place'
          ? { name: 'shelter_in_place' }
        : intent.target;
    if (!this.begin(intent.kind, target, intent.reason, { allowBusy })) {
      this.recordDecision(context, 'begin_rejected');
      return;
    }
    const incident = this.safetyIncident;
    const missionId = incident?.id || `survival:${intent.kind}`;
    const activityId = intent.kind;
    const dispatchLease = this.beginDispatchLease({
      owner: 'survival',
      missionId,
      activityId,
      metadata: { intent, situation },
    });
    this.recordDecision(context, 'action_dispatched', { scheduled: true });
    void Promise.resolve(this.executeCommand(this.agent, command, {
      owner: 'survival',
      routeOrigin: 'internal',
      missionId,
      activityId,
      materialToken: JSON.stringify([
        incident?.stage || null,
        incident?.source?.id || incident?.source?.uuid || null,
        incident?.failedResponse?.actionId || null,
        target || null,
      ]),
      returnExecution: true,
    }))
      .then(execution => {
        if (!this.ownsDispatchLease(dispatchLease)) return;
        const hasExecutionEnvelope = execution
          && typeof execution === 'object'
          && Object.hasOwn(execution, 'value')
          && Object.hasOwn(execution, 'result');
        const result = hasExecutionEnvelope ? execution.result || null : null;
        this.settleDispatch(dispatchLease, result);
      })
      .catch(error => {
        if (!this.claimDispatchSettlement(dispatchLease)) return;
        this.fail('dispatch_error', error?.message || error, true);
        this.nextEligibleAt = Date.now() + FAILURE_COOLDOWN_MS;
      });
  }
}
