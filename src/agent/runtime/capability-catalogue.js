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
  }),
  preconditions: (snapshot, args) => preconditionReport([
    { requirement: `registered craft output ${args.item}`, satisfied: validName(args.item) && snapshot.hasItem(args.item) },
    { requirement: 'positive craft batch count', satisfied: args.batches >= 1 },
  ]),
  expectedEffects: (_snapshot, args) => [inventoryEffect(args.item, args.expectedIncrease)],
  bind: (_context, args, _signal) => immutable({
    ok: true,
    commandName: '!craftRecipe',
    command: `!craftRecipe(${commandString(args.item)}, ${args.batches})`,
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
    command: `!smeltItem(${commandString(args.input)}, ${args.count})`,
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

export function getCapabilityDefinition(id) {
  return DEFINITIONS.get(String(id || '')) || null;
}

export function createCapabilityPlanAction(id, argumentsValue, metadata = {}, {
  bot,
  inventory = null,
} = {}) {
  const definition = getCapabilityDefinition(id);
  if (!definition) throw new TypeError(`Unknown capability '${id}'.`);
  const args = definition.normalizeArguments(argumentsValue);
  const snapshot = captureCapabilitySnapshot(bot, { inventory });
  const preconditions = definition.preconditions(snapshot, args);
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
  return String(capability?.binding?.commandName || '');
}

function capabilityFailure(code, detail) {
  return Object.freeze({
    actionId: `capability-${Date.now()}`,
    phase: 'failed',
    code,
    detail: String(detail || '').slice(0, 360),
    retryable: true,
    evidence: Object.freeze({ capability: { code } }),
  });
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
    return { result: capabilityFailure(CAPABILITY_OUTCOME_CODES.BINDING, `Unknown capability '${capability?.id || ''}'.`) };
  }
  const args = definition.normalizeArguments(capability.arguments);
  const before = captureCapabilitySnapshot(agent?.bot);
  const preconditions = definition.preconditions(before, args);
  if (!preconditions.ok) {
    return { result: capabilityFailure(CAPABILITY_OUTCOME_CODES.PRECONDITION, preconditions.detail) };
  }
  const expectedEffects = immutable(definition.expectedEffects(before, args));
  const binding = definition.bind({ agent, bot: agent?.bot, snapshot: before }, args, signal);
  if (!binding?.ok) {
    return { result: capabilityFailure(CAPABILITY_OUTCOME_CODES.BINDING, binding?.detail || 'Capability binding failed.') };
  }
  try {
    const value = await definition.execute({ ...binding, expectedEffects }, {
      agent,
      executeCommand,
      owner,
      routeOrigin,
      signal,
    });
    const after = captureCapabilitySnapshot(agent?.bot);
    return {
      value,
      binding,
      verification: definition.verify(before, after, { ...binding, expectedEffects }),
    };
  } catch (error) {
    return {
      result: capabilityFailure(
        CAPABILITY_OUTCOME_CODES.EXECUTION,
        error?.message || error || 'Capability execution failed.',
      ),
    };
  }
}
