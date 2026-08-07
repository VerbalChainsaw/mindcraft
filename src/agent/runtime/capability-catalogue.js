import { createActionResult } from './action-result.js';
import { resolvePlayerTarget } from '../player-target.js';
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
  if (family === 'logs') {
    return [...counts.entries()].reduce((total, [name, count]) => (
      /_(?:log|stem)$/.test(name) ? total + count : total
    ), 0);
  }
  if (family === 'planks') {
    return [...counts.entries()].reduce((total, [name, count]) => (
      name.endsWith('_planks') ? total + count : total
    ), 0);
  }
  return 0;
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
  return Object.freeze({
    inventory: counts,
    mainHand: equipmentName(bot, 'main_hand'),
    offHand: equipmentName(bot, 'off_hand'),
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
} = {}) {
  if (!agent || typeof executeCommand !== 'function') {
    throw new TypeError('Capability execution requires the active agent and deterministic command executor.');
  }
  return executeCommand(agent, binding.command, { owner, routeOrigin });
}

const DEFINITIONS = new Map();

function defineCapability(definition) {
  const frozen = Object.freeze({ ...definition, parameters: immutable(definition.parameters) });
  DEFINITIONS.set(frozen.id, frozen);
}

defineCapability({
  id: 'collect_wood',
  parameters: {
    count: { type: 'integer', minimum: 1, maximum: 64 },
    range: { type: 'integer', minimum: 16, maximum: 512 },
    expectedIncrease: { type: 'integer', minimum: 1 },
  },
  normalizeArguments: args => immutable({
    count: boundedInteger(args?.count, 1, 1, 64),
    range: boundedInteger(args?.range, 64, 16, 512),
    expectedIncrease: boundedInteger(args?.expectedIncrease ?? args?.count, 1, 1, 64),
  }),
  preconditions: (_snapshot, args) => preconditionReport([
    { requirement: 'positive bounded wood count', satisfied: args.count >= 1 && args.count <= 64 },
    { requirement: 'positive bounded search range', satisfied: args.range >= 16 && args.range <= 512 },
  ]),
  expectedEffects: (_snapshot, args) => [inventoryEffect('logs', args.expectedIncrease, 'logs')],
  bind: (_context, args, _signal) => immutable({
    ok: true,
    commandName: '!collectWoodInRange',
    command: `!collectWoodInRange(${args.count}, ${args.range})`,
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
    method: { type: 'enum', values: ['shear'] },
    count: { type: 'integer', minimum: 1, maximum: 64 },
    range: { type: 'integer', minimum: 16, maximum: 512 },
    allowAlternative: { type: 'boolean' },
    expectedIncrease: { type: 'integer', minimum: 1 },
  },
  normalizeArguments: args => immutable({
    source: canonicalName(args?.source),
    output: canonicalName(args?.output),
    method: canonicalName(args?.method),
    count: boundedInteger(args?.count, 1, 1, 64),
    range: boundedInteger(args?.range, 64, 16, 512),
    allowAlternative: args?.allowAlternative === true,
    expectedIncrease: boundedInteger(args?.expectedIncrease ?? args?.count, 1, 1, 64),
  }),
  preconditions: (snapshot, args) => preconditionReport([
    { requirement: `registered source entity ${args.source}`, satisfied: validName(args.source) && snapshot.hasEntity(args.source) },
    { requirement: `registered output item ${args.output}`, satisfied: validName(args.output) && snapshot.hasItem(args.output) },
    { requirement: 'supported entity harvest method', satisfied: args.method === 'shear' },
    { requirement: 'positive bounded harvest count', satisfied: args.count >= 1 && args.count <= 64 },
  ]),
  expectedEffects: (_snapshot, args) => [inventoryEffect(args.output, args.expectedIncrease)],
  bind: (_context, args, _signal) => immutable({
    ok: true,
    commandName: '!harvestEntityDrop',
    command: `!harvestEntityDrop(${commandString(args.source)}, ${commandString(args.output)}, ${commandString(args.method)}, ${args.count}, ${args.range}${args.allowAlternative ? ', true' : ''})`,
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
  return immutable(evidence);
}

function bindingReport(binding) {
  if (!binding) return null;
  return immutable({
    ok: binding.ok === true,
    code: binding.code || (binding.ok === true ? 'binding_satisfied' : CAPABILITY_OUTCOME_CODES.BINDING),
    detail: binding.detail || (binding.ok === true ? 'Capability binding is satisfied.' : 'Capability binding failed.'),
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
  const verifiedPartialProgress = verifiedMiningProgress
    || verifiedSurfaceProgress
    || verifiedEntityHarvestProgress;

  if (!verification.ok && verifiedPartialProgress && result.phase === 'failed') {
    const progressDetail = verifiedEntityHarvestProgress
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
  if (verification.ok && ['failed', 'requested'].includes(result.phase)) {
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
        CAPABILITY_OUTCOME_CODES.BINDING,
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
    });
    const after = captureCapabilitySnapshot(agent?.bot);
    const executorResult = agent?.last_action_result;
    const verification = definition.verify(before, after, { ...binding, expectedEffects }, {
      agent,
      value,
      result: executorResult,
    });
    const result = executorResult?.actionId && executorResult.actionId !== previousActionId
      ? reconcileCapabilityResult(executorResult, verification, identity, preconditions, binding)
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
