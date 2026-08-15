import assert from 'node:assert/strict';
import test from 'node:test';
import Vec3 from 'vec3';

import {
  deliberateEntityHarvestCombatCloseout,
  cookCaughtFish,
  deliberateEntityHarvestCombatEnvironment,
  deliberateEntityHarvestCombatRequirement,
  deliberateEntityHarvestTargetQualification,
  fishForItems,
  shouldRelocateEntityHarvestSearch,
  shouldWaitForEntityHarvestSpawn,
} from '../../src/agent/library/skills.js';
import { acquisitionTemporalFeasibility } from '../../src/agent/runtime/goal-director.js';
import {
  entityHarvestOutput,
  entityHarvestSources,
  entityMatchesHarvestSource,
} from '../../src/utils/entity-harvest-semantics.js';

function inventoryBot(initial) {
  const counts = new Map(Object.entries(initial));
  const items = () => [...counts.entries()]
    .filter(([, count]) => count > 0)
    .map(([name, count]) => ({ name, count }));
  return {
    interrupt_code: false,
    inventory: {
      items,
      get slots() { return items(); },
    },
    counts,
  };
}

test('string exposes a bounded spider-combat source in the connected registry', () => {
  const registry = {
    itemsByName: { string: { id: 1, name: 'string' } },
    entitiesByName: { spider: { id: 2, name: 'spider' } },
  };
  const [source] = entityHarvestSources(registry, 'string');

  assert.deepEqual(source, {
    entity: 'spider',
    output: 'string',
    method: 'kill',
    requiredItem: null,
    minimumYield: 0,
    naturalFrequency: 0.25,
    searchRange: 64,
  });
  assert.equal(entityMatchesHarvestSource({ name: 'spider' }, source), true);
  assert.equal(entityMatchesHarvestSource({ name: 'cave_spider' }, source), false);
  assert.equal(entityHarvestOutput({ name: 'spider' }, 'kill'), 'string');
});

test('daylight string acquisition waits in place unless a spider is already loaded', () => {
  const nextStep = {
    capability: {
      id: 'harvest_entity_drop',
      arguments: { source: 'spider', output: 'string', method: 'kill' },
    },
  };

  assert.deepEqual(acquisitionTemporalFeasibility({
    health: 20,
    time: { timeOfDay: 8_000 },
    entities: {},
  }, nextStep), {
    ready: false,
    code: 'waiting_for_hostile_spawn_window',
    timeOfDay: 8_000,
    detail: 'No loaded spider is present; waiting at the current stance for night before starting the bounded string search.',
  });

  assert.equal(acquisitionTemporalFeasibility({
    health: 20,
    time: { timeOfDay: 8_000 },
    entity: { position: new Vec3(0, 64, 0) },
    entities: { 12: { id: 12, name: 'spider', position: new Vec3(2, 64, 0) } },
  }, nextStep).code, 'source_observed');
  assert.equal(acquisitionTemporalFeasibility({
    health: 20,
    time: { timeOfDay: 14_000 },
    entities: {},
  }, nextStep).code, 'hostile_spawn_window_open');
});

test('a loaded spider waits without dispatch when another hostile contaminates the combat envelope', () => {
  const nextStep = {
    capability: {
      id: 'harvest_entity_drop',
      arguments: { source: 'spider', output: 'string', method: 'kill' },
    },
  };
  const result = acquisitionTemporalFeasibility({
    health: 20,
    time: { timeOfDay: 14_000 },
    entity: { position: new Vec3(0, 64, 0) },
    entities: {
      12: { id: 12, name: 'spider', position: new Vec3(2, 64, 0) },
      13: { id: 13, name: 'skeleton', position: new Vec3(13, 64, 0) },
    },
  }, nextStep);

  assert.equal(result.ready, false);
  assert.equal(result.code, 'waiting_for_safe_combat_environment');
  assert.equal(result.combatEnvironment.code, 'combat_environment_unsafe');
  assert.equal(result.combatEnvironment.threats[0].name, 'skeleton');
});

test('daylight string acquisition ignores cave and distant spiders instead of leaving the companion stance', () => {
  const nextStep = {
    capability: {
      id: 'harvest_entity_drop',
      arguments: { source: 'spider', output: 'string', method: 'kill' },
    },
  };
  const bot = {
    health: 20,
    time: { timeOfDay: 8_000 },
    entity: { position: new Vec3(0, 68, 0) },
    entities: {
      12: { id: 12, name: 'spider', position: new Vec3(8, 40, 0) },
      13: { id: 13, name: 'spider', position: new Vec3(40, 68, 0) },
    },
  };

  assert.equal(acquisitionTemporalFeasibility(bot, nextStep).code, 'waiting_for_hostile_spawn_window');
  assert.equal(shouldRelocateEntityHarvestSearch(bot, {
    entity: 'spider', output: 'string', method: 'kill',
  }), false);
});

test('deliberate hostile target qualification keeps optional pursuit local', () => {
  const source = { entity: 'spider', output: 'string', method: 'kill' };
  const bot = { entity: { position: new Vec3(0, 68, 0) } };

  assert.equal(deliberateEntityHarvestTargetQualification(
    bot, source, { id: 1, name: 'spider', position: new Vec3(10, 68, 0) },
  ).qualified, true);
  assert.equal(deliberateEntityHarvestTargetQualification(
    bot, source, { id: 2, name: 'spider', position: new Vec3(8, 40, 0) },
  ).code, 'target_outside_deliberate_vertical_range');
  assert.equal(deliberateEntityHarvestTargetQualification(
    bot, source, { id: 3, name: 'spider', position: new Vec3(30, 68, 0) },
  ).code, 'target_outside_deliberate_pursuit_range');
});

test('optional hostile harvesting waits without spending an action while health is critical', () => {
  const nextStep = {
    capability: {
      id: 'harvest_entity_drop',
      arguments: { source: 'spider', output: 'string', method: 'kill' },
    },
  };

  assert.deepEqual(acquisitionTemporalFeasibility({
    health: 8,
    time: { timeOfDay: 18_000 },
    entities: { 12: { name: 'spider' } },
  }, nextStep), {
    ready: false,
    code: 'waiting_for_combat_recovery',
    health: 8,
    detail: 'Health is 8/20; waiting for verified recovery before optional hostile acquisition.',
  });
});

test('a relocated night spider search waits for spawning only while no source is loaded', () => {
  const source = { entity: 'spider', output: 'string', method: 'kill' };
  const bot = {
    time: { timeOfDay: 18_000 },
    entity: { position: new Vec3(0, 64, 0) },
    entities: {},
  };

  assert.equal(shouldWaitForEntityHarvestSpawn(bot, source), true);
  bot.entities[9] = { id: 9, name: 'spider', position: new Vec3(20, 64, 0) };
  assert.equal(shouldWaitForEntityHarvestSpawn(bot, source), false);
  bot.entities = {};
  bot.time.timeOfDay = 8_000;
  assert.equal(shouldWaitForEntityHarvestSpawn(bot, source), false);
});

test('deliberate hostile harvesting requires a usable melee tool before pursuit', () => {
  const source = { entity: 'spider', output: 'string', method: 'kill' };
  const barehanded = inventoryBot({ stick: 4 });
  barehanded.getEquipmentDestSlot = () => -1;

  assert.deepEqual(deliberateEntityHarvestCombatRequirement(barehanded, source), {
    name: 'wooden_sword',
    minimumUsableDurability: 8,
  });

  const armed = inventoryBot({ wooden_sword: 1 });
  armed.getEquipmentDestSlot = () => -1;
  assert.equal(deliberateEntityHarvestCombatRequirement(armed, source), null);
  assert.equal(deliberateEntityHarvestCombatRequirement(barehanded, {
    entity: 'sheep',
    output: 'white_wool',
    method: 'shear',
  }), null);
});

test('deliberate hostile harvesting rejects a second hostile in the tactical envelope', () => {
  const bot = inventoryBot({ wooden_sword: 1 });
  bot.entity = { position: new Vec3(0, 64, 0) };
  bot.entities = {
    12: { id: 12, name: 'spider', type: 'hostile', position: new Vec3(2, 64, 0) },
    13: { id: 13, name: 'skeleton', type: 'hostile', position: new Vec3(3, 64, 0) },
  };

  assert.deepEqual(deliberateEntityHarvestCombatEnvironment(bot, 12, 16), {
    ready: false,
    code: 'combat_environment_unsafe',
    range: 16,
    threats: [{
      id: 13,
      name: 'skeleton',
      distance: 3,
      disposition: 'combat_safe',
    }],
  });

  delete bot.entities[13];
  bot.entities[14] = {
    id: 14,
    name: 'skeleton',
    type: 'hostile',
    position: new Vec3(2, 48, 0),
  };
  assert.deepEqual(deliberateEntityHarvestCombatEnvironment(bot, 12, 16), {
    ready: true,
    code: 'combat_environment_ready',
    range: 16,
    threats: [],
  });
});

test('deliberate hostile harvest closeout delegates retreat and proves the whole envelope clear', async () => {
  const bot = inventoryBot({ wooden_sword: 1, string: 2 });
  bot.entity = { position: new Vec3(0, 64, 0) };
  bot.entities = {
    13: { id: 13, name: 'zombie', type: 'hostile', position: new Vec3(7, 64, 0) },
  };
  let requestedRange = null;

  const closeout = await deliberateEntityHarvestCombatCloseout(bot, 16, async (_bot, range) => {
    requestedRange = range;
    bot.entities = {};
    bot.lastActionEvidence = {
      kind: 'reflex',
      outcome: 'safe',
      attempts: 1,
      retryable: true,
    };
    return true;
  });

  assert.equal(requestedRange, 16);
  assert.equal(closeout.ready, true);
  assert.equal(closeout.code, 'combat_environment_cleared');
  assert.equal(closeout.before.code, 'combat_environment_unsafe');
  assert.equal(closeout.after.code, 'combat_environment_ready');
  assert.deepEqual(closeout.retreat, {
    kind: 'reflex',
    outcome: 'safe',
    attempts: 1,
    retryable: true,
  });
});

test('fishForItems counts only newly caught cod and salmon, not junk loot', async () => {
  const bot = inventoryBot({ fishing_rod: 1 });
  const catches = ['bowl', 'cod', 'leather', 'salmon', 'cod'];
  bot.entity = { position: new Vec3(0.5, 65, 2.5) };
  bot.findBlock = () => ({ name: 'water', position: new Vec3(0, 64, 0) });
  bot.lookAt = () => Promise.resolve();
  bot.activateItem = () => {};
  bot.fish = () => {
    const item = catches.shift() || 'stick';
    bot.counts.set(item, (bot.counts.get(item) || 0) + 1);
    return Promise.resolve();
  };

  const result = await fishForItems(bot, 3, {
    castTimeoutMs: 1_000,
    equipItem: () => Promise.resolve(true),
    navigate: () => Promise.resolve(true),
  });

  assert.equal(result, true);
  assert.equal(bot.lastActionEvidence.outcome, 'catches_verified');
  assert.equal(bot.lastActionEvidence.caught, 3);
  assert.deepEqual(bot.lastActionEvidence.manifest, [
    { item: 'cod', quantity: 2 },
    { item: 'salmon', quantity: 1 },
  ]);
  assert.equal(bot.counts.get('bowl'), 1, 'junk remains real inventory but cannot satisfy breakfast');
  assert.equal(bot.counts.get('leather'), 1);
});

test('fishForItems fails truthfully when bounded casts produce only a partial edible catch', async () => {
  const bot = inventoryBot({ fishing_rod: 1 });
  let casts = 0;
  bot.entity = { position: new Vec3(0.5, 65, 2.5) };
  bot.findBlock = () => ({ name: 'water', position: new Vec3(0, 64, 0) });
  bot.lookAt = () => Promise.resolve();
  bot.activateItem = () => {};
  bot.fish = () => {
    casts += 1;
    const item = casts === 1 ? 'cod' : 'bowl';
    bot.counts.set(item, (bot.counts.get(item) || 0) + 1);
    return Promise.resolve();
  };

  const result = await fishForItems(bot, 2, {
    castTimeoutMs: 1_000,
    equipItem: () => Promise.resolve(true),
    navigate: () => Promise.resolve(true),
  });

  assert.equal(result, false);
  assert.equal(casts, 8);
  assert.equal(bot.lastActionEvidence.outcome, 'partial_catch');
  assert.equal(bot.lastActionEvidence.caught, 1);
});

test('fishForItems resumes from fish already verified above a durable baseline', async () => {
  const bot = inventoryBot({ fishing_rod: 1, cod: 2, salmon: 1 });
  const result = await fishForItems(bot, 3, {
    baselineManifest: 'none',
    equipItem: () => Promise.resolve(true),
  });

  assert.equal(result, true);
  assert.equal(bot.lastActionEvidence.outcome, 'catches_verified');
  assert.equal(bot.lastActionEvidence.caught, 3);
  assert.deepEqual(bot.lastActionEvidence.manifest, [
    { item: 'cod', quantity: 2 },
    { item: 'salmon', quantity: 1 },
  ]);
});

test('cookCaughtFish transforms only raw fish above the durable baseline at the exact furnace', async () => {
  const bot = inventoryBot({ cod: 3, salmon: 2, cooked_cod: 2 });
  const calls = [];
  const smelt = (_bot, input, amount, workstation) => {
    calls.push({ input, amount, workstation });
    bot.counts.set(input, bot.counts.get(input) - amount);
    const output = input === 'cod' ? 'cooked_cod' : 'cooked_salmon';
    bot.counts.set(output, (bot.counts.get(output) || 0) + amount);
    return Promise.resolve(true);
  };

  const result = await cookCaughtFish(
    bot,
    3,
    8102,
    70,
    7938,
    'minecraft:overworld',
    'cod:1|salmon:1',
    'cooked_cod:2',
    { smelt },
  );

  assert.equal(result, true);
  assert.deepEqual(calls.map(({ input, amount }) => ({ input, amount })), [
    { input: 'cod', amount: 2 },
    { input: 'salmon', amount: 1 },
  ]);
  assert.ok(calls.every(call => (
    call.workstation.position.x === 8102
    && call.workstation.position.y === 70
    && call.workstation.position.z === 7938
    && call.workstation.dimension === 'overworld'
  )));
  assert.equal(bot.lastActionEvidence.outcome, 'cooked');
  assert.equal(bot.lastActionEvidence.cooked, 3);
});

test('cookCaughtFish resumes after a previously verified partial cook', async () => {
  const bot = inventoryBot({ cod: 2, cooked_cod: 1 });
  const calls = [];
  const result = await cookCaughtFish(
    bot,
    3,
    1,
    64,
    2,
    'overworld',
    'none',
    'none',
    {
      smelt: (_bot, input, amount) => {
        calls.push({ input, amount });
        bot.counts.set(input, bot.counts.get(input) - amount);
        bot.counts.set('cooked_cod', bot.counts.get('cooked_cod') + amount);
        return Promise.resolve(true);
      },
    },
  );

  assert.equal(result, true);
  assert.deepEqual(calls, [{ input: 'cod', amount: 2 }]);
  assert.equal(bot.lastActionEvidence.cooked, 3);
});
