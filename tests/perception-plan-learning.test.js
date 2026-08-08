import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import minecraftData from 'minecraft-data';

import {
  classifyEntityMotion,
  scoreEntityThreat,
} from '../src/agent/library/full_state.js';
import {
  createItemGoalContract,
  normalizeGoalContract,
} from '../src/agent/runtime/goal-contract.js';
import { PersonalMemory } from '../src/agent/runtime/personal-memory.js';
import { classifyMethodOutcome } from '../src/agent/runtime/action-result.js';
import {
  capabilityCommand,
  createCapabilityPlanAction,
  createCapabilityRequest,
  executeCapabilityAction,
  getCapabilityDefinition,
} from '../src/agent/runtime/capability-catalogue.js';
import { buildPrerequisitePlan } from '../src/agent/runtime/prerequisite-planner.js';
import { ProcedureStore } from '../src/agent/runtime/procedure-store.js';

function plannerBot() {
  return {
    inventory: {
      slots: [],
      items: () => [],
    },
    registry: {
      items: {
        1: { id: 1, name: 'test_gem' },
      },
      itemsByName: {
        test_gem: { id: 1, name: 'test_gem' },
      },
      blocks: {
        10: { id: 10, name: 'alpha_ore', diggable: true, drops: [1], harvestTools: {} },
        11: { id: 11, name: 'beta_ore', diggable: true, drops: [1], harvestTools: {} },
      },
      recipes: {},
    },
  };
}

function nearbyRecipeBot() {
  const items = {
    1: { id: 1, name: 'test_tool' },
    2: { id: 2, name: 'oak_planks' },
    3: { id: 3, name: 'birch_planks' },
    4: { id: 4, name: 'oak_log' },
    5: { id: 5, name: 'birch_log' },
  };
  const blocks = {
    10: { id: 10, name: 'oak_log', diggable: true, drops: [4], harvestTools: {} },
    11: { id: 11, name: 'birch_log', diggable: true, drops: [5], harvestTools: {} },
  };
  return {
    entity: {
      position: {
        x: 0,
        y: 64,
        z: 0,
        distanceTo(position) {
          return Math.hypot(position.x - this.x, position.y - this.y, position.z - this.z);
        },
      },
    },
    inventory: {
      slots: [],
      items: () => [],
    },
    findBlock({ matching }) {
      if (matching === 10) return { position: { x: 56, y: 64, z: 0 } };
      if (matching === 11) return { position: { x: 4, y: 64, z: 0 } };
      return null;
    },
    registry: {
      items,
      itemsByName: Object.fromEntries(Object.values(items).map(item => [item.name, item])),
      blocks,
      blocksByName: Object.fromEntries(Object.values(blocks).map(block => [block.name, block])),
      recipes: {
        1: [
          { ingredients: [{ id: 2, count: 1 }], result: { id: 1, count: 1 } },
          { ingredients: [{ id: 3, count: 1 }], result: { id: 1, count: 1 } },
        ],
        2: [{ ingredients: [{ id: 4, count: 1 }], result: { id: 2, count: 4 } }],
        3: [{ ingredients: [{ id: 5, count: 1 }], result: { id: 3, count: 4 } }],
      },
    },
  };
}

function carriedStoneBrickBot() {
  const items = {
    1: { id: 1, name: 'stone' },
    2: { id: 2, name: 'cobblestone' },
    3: { id: 3, name: 'stone_bricks' },
    4: { id: 4, name: 'furnace' },
  };
  const carried = [
    { name: 'cobblestone', type: 2, count: 429 },
    { name: 'furnace', type: 4, count: 1 },
  ];
  return {
    inventory: {
      slots: carried,
      items: () => carried,
    },
    registry: {
      items,
      itemsByName: Object.fromEntries(Object.values(items).map(item => [item.name, item])),
      blocks: {},
      blocksByName: {},
      recipes: {
        3: [{
          inShape: [[1, 1], [1, 1]],
          result: { id: 3, count: 4 },
        }],
      },
    },
  };
}

function remoteTableRecipeBot() {
  const items = {
    1: { id: 1, name: 'test_machine' },
    2: { id: 2, name: 'test_gem' },
    3: { id: 3, name: 'crafting_table' },
    4: { id: 4, name: 'oak_planks' },
    5: { id: 5, name: 'oak_log' },
  };
  const blocks = {
    10: { id: 10, name: 'test_gem_ore', diggable: true, drops: [2], harvestTools: {} },
    11: { id: 11, name: 'oak_log', diggable: true, drops: [5], harvestTools: {} },
    12: { id: 12, name: 'crafting_table', diggable: true, drops: [3], harvestTools: {} },
  };
  return {
    entity: { position: { x: 0, y: 64, z: 0 } },
    inventory: { slots: [], items: () => [] },
    findBlock() { return null; },
    registry: {
      items,
      itemsByName: Object.fromEntries(Object.values(items).map(item => [item.name, item])),
      blocks,
      blocksByName: Object.fromEntries(Object.values(blocks).map(block => [block.name, block])),
      recipes: {
        1: [{
          ingredients: Array.from({ length: 5 }, () => ({ id: 2, count: 1 })),
          result: { id: 1, count: 1 },
        }],
        3: [{
          inShape: [[{ id: 4, count: 1 }, { id: 4, count: 1 }], [{ id: 4, count: 1 }, { id: 4, count: 1 }]],
          result: { id: 3, count: 1 },
        }],
        4: [{ ingredients: [{ id: 5, count: 1 }], result: { id: 4, count: 4 } }],
      },
    },
  };
}

function renewableWoolRecipeBot() {
  const items = {
    1: { id: 1, name: 'white_bed' },
    2: { id: 2, name: 'white_wool' },
    3: { id: 3, name: 'birch_planks' },
    4: { id: 4, name: 'shears', maxDurability: 238 },
    5: { id: 5, name: 'crafting_table' },
  };
  const carried = [
    { name: 'shears', type: 4, count: 1 },
    { name: 'birch_planks', type: 3, count: 3 },
    { name: 'crafting_table', type: 5, count: 1 },
  ];
  return {
    inventory: { slots: carried, items: () => carried },
    registry: {
      items,
      itemsByName: Object.fromEntries(Object.values(items).map(item => [item.name, item])),
      blocks: {},
      blocksByName: {},
      entitiesByName: { sheep: { id: 111, name: 'sheep' } },
      recipes: {
        1: [{
          inShape: [[2, 2, 2], [3, 3, 3]],
          result: { id: 1, count: 1 },
        }],
      },
    },
  };
}

function recursivePlacedBlockBot({ observed = false } = {}) {
  const items = {
    1: { id: 1, name: 'white_dye' },
    2: { id: 2, name: 'bone_meal' },
    3: { id: 3, name: 'bone_block' },
    4: { id: 4, name: 'bone' },
  };
  const blocks = {
    10: { id: 10, name: 'bone_block', diggable: true, drops: [3], harvestTools: {} },
  };
  return {
    entity: { position: { x: 0, y: 64, z: 0 } },
    entities: {},
    inventory: { slots: [], items: () => [] },
    findBlock({ matching }) {
      return observed && matching === 10
        ? { name: 'bone_block', position: { x: 4, y: 64, z: 0 } }
        : null;
    },
    registry: {
      items,
      itemsByName: Object.fromEntries(Object.values(items).map(item => [item.name, item])),
      blocks,
      blocksByName: Object.fromEntries(Object.values(blocks).map(block => [block.name, block])),
      entitiesByName: {},
      recipes: {
        1: [{ ingredients: [{ id: 2, count: 1 }], result: { id: 1, count: 1 } }],
        2: [
          { ingredients: [{ id: 4, count: 1 }], result: { id: 2, count: 3 } },
          { ingredients: [{ id: 3, count: 1 }], result: { id: 2, count: 9 } },
        ],
        3: [{
          inShape: [
            [2, 2, 2],
            [2, 2, 2],
            [2, 2, 2],
          ],
          result: { id: 3, count: 1 },
        }],
      },
    },
  };
}

test('Perception classifies closing motion and prioritizes visible approaching explosive threats', () => {
  const bot = {
    entity: {
      position: { x: 0, y: 64, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
    },
  };
  const motion = classifyEntityMotion(bot, {
    position: { x: 0, y: 64, z: 8 },
    velocity: { x: 0, y: 0, z: -0.2 },
  });
  assert.equal(motion.state, 'approaching');
  assert.ok(motion.closingSpeed > 0);

  const approaching = scoreEntityThreat({
    name: 'creeper',
    distance: 8,
    hostile: true,
    disposition: 'avoid',
    visible: true,
    motion: 'approaching',
  });
  const retreating = scoreEntityThreat({
    name: 'creeper',
    distance: 8,
    hostile: true,
    disposition: 'avoid',
    visible: false,
    motion: 'retreating',
  });
  assert.ok(approaching > retreating);
  assert.equal(scoreEntityThreat({ name: 'cow', distance: 2, hostile: false }), 0);
});

test('Verified outcome history persists and remains a bounded ranking hint', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'mindcraft-learning-'));
  try {
    const memory = new PersonalMemory('TestBot', { rootDir });
    memory.load();
    for (let index = 0; index < 4; index += 1) {
      memory.rememberOutcome('collect:beta_ore->test_gem', {
        success: true,
        durationMs: 1200,
        yieldCount: 1,
        code: 'skill_collected',
      });
      memory.rememberOutcome('collect:alpha_ore->test_gem', {
        success: false,
        durationMs: 3000,
        code: 'skill_path_stalled',
      });
    }

    const restored = new PersonalMemory('TestBot', { rootDir });
    restored.load();
    assert.ok(restored.outcomePreference('collect:beta_ore->test_gem') > 0);
    assert.ok(restored.outcomePreference('collect:alpha_ore->test_gem') < 0);
    assert.equal(restored.getOutcomeSummary(1).length, 1);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('ownership preemption is censored and does not poison method learning', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'mindcraft-censored-learning-'));
  try {
    const memory = new PersonalMemory('TestBot', { rootDir });
    memory.load();
    const interrupted = { phase: 'interrupted', code: 'interrupted' };
    const classification = classifyMethodOutcome(interrupted);

    assert.equal(classification, 'censored');
    assert.equal(memory.rememberOutcome('collect:stone->cobblestone', {
      classification,
      success: false,
      durationMs: 500,
      code: interrupted.code,
    }), false);
    assert.deepEqual(memory.getOutcomeSummary(6), []);
    assert.equal(classifyMethodOutcome({ phase: 'failed', code: 'path_stalled' }), 'method_failure');
    assert.equal(classifyMethodOutcome({ phase: 'succeeded', code: 'collected' }), 'success');
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('The causal planner uses learned outcomes only to rank otherwise viable methods', () => {
  const baseline = buildPrerequisitePlan(plannerBot(), {
    target: 'test_gem',
    quantity: 1,
  });
  assert.match(baseline.nextStep.capability.binding.command, /alpha_ore/);

  const learned = buildPrerequisitePlan(plannerBot(), {
    target: 'test_gem',
    quantity: 1,
    experience: key => key.includes('beta_ore') ? 8 : key.includes('alpha_ore') ? -8 : 0,
  });
  assert.match(learned.nextStep.capability.binding.command, /beta_ore/);
  assert.equal(learned.nextStep.learningKey, 'collect:beta_ore->test_gem');
  assert.equal(learned.nextStep.learnedPreference, 8);
});

test('A lone observed log does not suppress generic natural-tree collection for interchangeable recipes', () => {
  const bot = nearbyRecipeBot();
  const probes = [];
  const findBlock = bot.findBlock.bind(bot);
  bot.findBlock = options => {
    probes.push(options);
    return findBlock(options);
  };
  const plan = buildPrerequisitePlan(bot, {
    target: 'test_tool',
    quantity: 1,
    range: 64,
  });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.nextStep.capability.binding.command, '!collectWoodInRange(1, 64)');
  assert.equal(probes.every(probe => probe.maxDistance <= 16), true);
  assert.equal(
    new Set(probes.map(probe => `${probe.matching}:${probe.maxDistance}`)).size,
    probes.length,
  );
});

test('Equivalent plank recipes collect generic wood before binding an unobserved species', () => {
  const bot = nearbyRecipeBot();
  bot.findBlock = () => null;

  const plan = buildPrerequisitePlan(bot, {
    target: 'test_tool',
    quantity: 1,
    range: 64,
  });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.nextStep.capability.id, 'collect_wood');
  assert.equal(plan.nextStep.capability.binding.command, '!collectWoodInRange(1, 64)');
});

test('The causal planner prefers a carried transform source over a dead partial recipe alternative', () => {
  const bot = nearbyRecipeBot();
  bot.inventory.items = () => [
    { name: 'birch_planks', type: 3, count: 1 },
    { name: 'oak_log', type: 4, count: 1 },
  ];
  bot.inventory.slots = bot.inventory.items();
  bot.findBlock = () => null;
  bot.registry.recipes[1] = [
    { ingredients: [{ id: 2, count: 2 }], result: { id: 1, count: 1 } },
    { ingredients: [{ id: 3, count: 2 }], result: { id: 1, count: 1 } },
  ];

  const plan = buildPrerequisitePlan(bot, {
    target: 'test_tool',
    quantity: 1,
    range: 64,
  });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.nextStep.capability.binding.command, '!craftRecipe("oak_planks", 1)');
});

test('The causal planner uses carried smelting inputs before scavenging a placed output block', () => {
  const plan = buildPrerequisitePlan(carriedStoneBrickBot(), {
    target: 'stone_bricks',
    quantity: 16,
    range: 64,
  });

  assert.equal(plan.status, 'ready');
  assert.deepEqual(
    plan.actions.map(action => action.capability.id),
    ['collect_wood', 'smelt', 'craft'],
  );
  assert.equal(plan.actions[1].capability.binding.command, '!smeltItem("cobblestone", 16)');
  assert.equal(plan.actions[2].capability.binding.command, '!craftRecipe("stone_bricks", 4)');
  assert.equal(
    plan.actions.some(action => action.capability.binding.command.includes('collectBlocksInRange("stone_bricks"')),
    false,
  );
});

test('The causal planner derives renewable entity harvests instead of searching for placed drops', () => {
  const plan = buildPrerequisitePlan(renewableWoolRecipeBot(), {
    target: 'white_bed',
    quantity: 1,
    range: 64,
  });

  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.actions.map(action => action.capability.id), ['harvest_entity_drop', 'craft']);
  assert.equal(
    plan.actions[0].capability.binding.command,
    '!harvestEntityDrop("sheep", "white_wool", "shear", 3, 192)',
  );
  assert.equal(plan.actions[0].expectedIncrease, 3);

  const builderPlan = buildPrerequisitePlan(renewableWoolRecipeBot(), {
    target: 'white_bed',
    quantity: 1,
    range: 64,
    allowEntityAlternatives: true,
  });
  assert.equal(
    builderPlan.actions[0].capability.binding.command,
    '!harvestEntityDrop("sheep", "white_wool", "shear", 3, 192, true)',
  );
});

test('Nested recipes never treat an observed crafted self-drop block as demolition authority', () => {
  const absent = buildPrerequisitePlan(recursivePlacedBlockBot(), {
    target: 'white_dye',
    quantity: 1,
    range: 64,
  });
  assert.equal(absent.status, 'blocked');
  assert.equal(
    absent.actions.some(action => action.capability.binding.command.includes('"bone_block"')),
    false,
  );

  const observed = buildPrerequisitePlan(recursivePlacedBlockBot({ observed: true }), {
    target: 'white_dye',
    quantity: 1,
    range: 64,
  });
  assert.equal(observed.status, 'blocked');
  assert.equal(
    observed.actions.some(action => action.capability.binding.command.includes('"bone_block"')),
    false,
  );
  const excludedObserved = buildPrerequisitePlan(recursivePlacedBlockBot({ observed: true }), {
    target: 'white_dye',
    quantity: 1,
    range: 64,
    excludedMethods: ['collect:bone_block->bone_block'],
  });
  assert.equal(excludedObserved.status, 'blocked');
  assert.equal(
    excludedObserved.actions.some(action => action.learningKey === 'collect:bone_block->bone_block'),
    false,
  );

  const explicitWorldSearch = buildPrerequisitePlan(recursivePlacedBlockBot(), {
    target: 'bone_block',
    quantity: 1,
    range: 64,
  });
  assert.equal(explicitWorldSearch.status, 'ready');
  assert.equal(
    explicitWorldSearch.nextStep.capability.binding.command,
    '!collectBlocksInRange("bone_block", 1, 64)',
  );
});

test('The causal planner transforms common renewable wool instead of searching for a rare colour', () => {
  const bot = renewableWoolRecipeBot();
  Object.assign(bot.registry.items, {
    6: { id: 6, name: 'brown_bed' },
    7: { id: 7, name: 'brown_wool' },
    8: { id: 8, name: 'brown_dye' },
    9: { id: 9, name: 'cocoa_beans' },
    10: { id: 10, name: 'black_wool' },
  });
  Object.assign(bot.registry.itemsByName, Object.fromEntries(
    Object.values(bot.registry.items).map(item => [item.name, item]),
  ));
  const carried = [
    ...bot.inventory.items(),
    { name: 'brown_dye', type: 8, count: 1 },
    { name: 'cocoa_beans', type: 9, count: 2 },
  ];
  bot.inventory.items = () => carried;
  bot.inventory.slots = carried;
  Object.assign(bot.registry.recipes, {
    6: [{ inShape: [[7, 7, 7], [3, 3, 3]], result: { id: 6, count: 1 } }],
    // minecraft-data exposes one representative member for the vanilla wool
    // tag. The planner must expand and rank the whole connected family.
    7: [{ ingredients: [8, 10], result: { id: 7, count: 1 } }],
    8: [{ ingredients: [9], result: { id: 8, count: 1 } }],
  });

  const plan = buildPrerequisitePlan(bot, {
    target: 'brown_bed',
    quantity: 1,
    range: 64,
  });

  assert.equal(plan.status, 'ready');
  assert.equal(
    plan.actions.some(action => (
      action.capability.id === 'harvest_entity_drop'
      && action.capability.binding.command.includes('"brown_wool"')
    )),
    false,
  );
  assert.equal(
    plan.actions.some(action => (
      action.capability.id === 'harvest_entity_drop'
      && action.capability.binding.command.includes('"white_wool"')
    )),
    true,
  );
  assert.equal(plan.actions.at(-1).capability.binding.command, '!craftRecipe("brown_bed", 1)');

  bot.entity = { position: { x: 0, y: 64, z: 0 } };
  bot.entities = {
    42: {
      id: 42,
      name: 'sheep',
      metadata: { 16: 0, 17: 12 },
      position: { x: 8, y: 64, z: 4 },
    },
  };
  const observedPlan = buildPrerequisitePlan(bot, {
    target: 'brown_bed',
    quantity: 1,
    range: 64,
  });
  assert.equal(
    observedPlan.actions[0].capability.binding.command,
    '!harvestEntityDrop("sheep", "brown_wool", "shear", 3, 192)',
  );
});

test('An explicit workstation survives restart and binds only the matching planner action', () => {
  const workstationConstraint = {
    name: 'furnace',
    position: { x: -659, y: 71, z: -459 },
    dimension: 'minecraft:overworld',
    source: 'player_explicit_here',
    observedAt: 1_786_010_000_000,
  };
  const originalRequest = 'Bring me 16 stone bricks and use the furnace here.';
  const goal = createItemGoalContract({
    kind: 'deliver',
    requester: 'WorksitePlayer',
    target: {
      requestedName: 'stone_bricks',
      canonicalName: 'stone_bricks',
      inventoryName: 'stone_bricks',
      acquisitionName: 'stone_bricks',
      family: null,
      acquisitionKind: 'craft',
    },
    quantity: 16,
    request: originalRequest,
    completion: 'delivery',
    workstationConstraint,
  });
  const restored = normalizeGoalContract(JSON.parse(JSON.stringify(goal)));

  assert.equal(restored.request, originalRequest);
  assert.deepEqual(restored.workstationConstraint, workstationConstraint);

  const plan = buildPrerequisitePlan(carriedStoneBrickBot(), {
    target: 'stone_bricks',
    quantity: 16,
    workstationConstraint: restored.workstationConstraint,
  });
  assert.equal(plan.status, 'ready');
  const smelt = plan.actions.find(action => action.capability.id === 'smelt');
  const craft = plan.actions.find(action => action.capability.id === 'craft');
  assert.equal(
    smelt.capability.binding.command,
    '!smeltItem("cobblestone", 16, -659, 71, -459, "minecraft:overworld")',
  );
  assert.deepEqual(smelt.capability.binding.workstation, workstationConstraint);
  assert.equal(craft.capability.binding.command, '!craftRecipe("stone_bricks", 4)');
  assert.equal(
    plan.actions.filter(action => action.capability.id !== 'smelt')
      .some(action => action.capability.binding.command.includes('-659')),
    false,
  );
});

test('The causal planner acquires remote recipe ingredients before provisioning the final workstation', () => {
  const plan = buildPrerequisitePlan(remoteTableRecipeBot(), {
    target: 'test_machine',
    quantity: 1,
    range: 64,
  });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.nextStep.capability.id, 'collect_block');
  assert.equal(plan.nextStep.capability.binding.command, '!collectBlocksInRange("test_gem_ore", 5, 64)');

  const staged = remoteTableRecipeBot();
  staged.inventory.items = () => [{ name: 'test_gem', type: 2, count: 5 }];
  staged.findBlock = ({ matching }) => matching === 12
    ? { name: 'crafting_table', position: { x: 6, y: 64, z: 0 } }
    : null;
  const readyToCraft = buildPrerequisitePlan(staged, {
    target: 'test_machine',
    quantity: 1,
    range: 64,
  });
  assert.equal(readyToCraft.status, 'ready');
  assert.equal(readyToCraft.nextStep.capability.id, 'craft');
  assert.equal(readyToCraft.nextStep.capability.binding.command, '!craftRecipe("test_machine", 1)');
});

test('The causal planner uses mixed carried planks before searching for another exact log species', () => {
  const items = {
    1: { id: 1, name: 'crafting_table' },
    2: { id: 2, name: 'oak_planks' },
    3: { id: 3, name: 'jungle_planks' },
    4: { id: 4, name: 'oak_log' },
    5: { id: 5, name: 'jungle_log' },
  };
  const carried = [
    { name: 'oak_planks', type: 2, count: 3 },
    { name: 'jungle_planks', type: 3, count: 1 },
  ];
  const bot = {
    inventory: { slots: carried, items: () => carried },
    registry: {
      items,
      itemsByName: Object.fromEntries(Object.values(items).map(item => [item.name, item])),
      blocks: {
        10: { id: 10, name: 'oak_log', diggable: true, drops: [4], harvestTools: {} },
        11: { id: 11, name: 'jungle_log', diggable: true, drops: [5], harvestTools: {} },
      },
      blocksByName: {},
      recipes: {
        1: [
          { inShape: [[2, 2], [2, 2]], result: { id: 1, count: 1 } },
          { inShape: [[3, 3], [3, 3]], result: { id: 1, count: 1 } },
        ],
        2: [{ ingredients: [4], result: { id: 2, count: 4 } }],
        3: [{ ingredients: [5], result: { id: 3, count: 4 } }],
      },
    },
    findBlock() { return null; },
  };

  const plan = buildPrerequisitePlan(bot, {
    target: 'crafting_table',
    quantity: 1,
    range: 64,
  });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.nextStep.capability.id, 'craft');
  assert.equal(plan.nextStep.capability.binding.command, '!craftRecipe("crafting_table", 1)');
  assert.equal(plan.actions.some(action => action.capability.id === 'collect_block'), false);
  assert.match(plan.nextStep.learningKey, /4xplanks/);
});

test('The causal planner compares carried bamboo transforms before generic wood search', () => {
  const registry = minecraftData('1.21.11');
  const carried = [
    { name: 'bamboo', type: registry.itemsByName.bamboo.id, count: 83 },
    { name: 'jungle_planks', type: registry.itemsByName.jungle_planks.id, count: 1 },
    { name: 'stick', type: registry.itemsByName.stick.id, count: 3 },
    { name: 'crafting_table', type: registry.itemsByName.crafting_table.id, count: 1 },
    { name: 'shears', type: registry.itemsByName.shears.id, count: 1 },
    {
      name: 'wooden_pickaxe',
      type: registry.itemsByName.wooden_pickaxe.id,
      count: 1,
      durabilityUsed: 51,
    },
    {
      name: 'wooden_pickaxe',
      type: registry.itemsByName.wooden_pickaxe.id,
      count: 1,
      durabilityUsed: 58,
    },
  ];
  const bot = {
    entity: { position: { x: 0, y: 64, z: 0 } },
    entities: {},
    inventory: { slots: carried, items: () => carried },
    registry,
    findBlock() { return null; },
  };

  const plan = buildPrerequisitePlan(bot, {
    target: 'cobblestone',
    quantity: 8,
    range: 64,
    toolRequirement: {
      name: 'wooden_pickaxe',
      minimumUsableDurability: 1,
    },
    allowUnobservedSelfDropRoot: false,
  });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.nextStep.capability.id, 'craft');
  assert.match(plan.nextStep.capability.binding.command, /bamboo_block|bamboo_planks/);
  assert.equal(plan.actions.some(action => action.capability.id === 'collect_wood'), false);

  const wornToolReplacement = buildPrerequisitePlan(bot, {
    target: 'wooden_pickaxe',
    quantity: 1,
    toolRequirement: {
      name: 'wooden_pickaxe',
      minimumUsableDurability: 1,
    },
    allowUnobservedSelfDropRoot: false,
  });
  assert.equal(wornToolReplacement.status, 'ready');
  assert.equal(wornToolReplacement.nextStep.capability.id, 'craft');
  assert.ok(wornToolReplacement.actions.some(action => (
    action.capability.binding.command === '!craftRecipe("wooden_pickaxe", 1)'
  )), 'the two worn carried pickaxes must not satisfy the usable-durability prerequisite');

  const carriedBuilderMaterials = [
    { name: 'oak_planks', type: registry.itemsByName.oak_planks.id, count: 2 },
    { name: 'bamboo', type: registry.itemsByName.bamboo.id, count: 50 },
    { name: 'bamboo_block', type: registry.itemsByName.bamboo_block.id, count: 1 },
    { name: 'cobblestone', type: registry.itemsByName.cobblestone.id, count: 47 },
  ];
  const implicitMiningToolPlan = buildPrerequisitePlan({
    entity: { position: { x: 0, y: 34, z: 0 } },
    entities: {},
    inventory: { slots: carriedBuilderMaterials, items: () => carriedBuilderMaterials },
    registry,
    findBlock({ matching }) {
      return matching === registry.blocksByName.granite.id
        ? { name: 'granite', position: { x: 1, y: 34, z: 0 } }
        : null;
    },
  }, {
    target: 'granite',
    quantity: 8,
    range: 64,
    allowUnobservedSelfDropRoot: false,
  });
  assert.equal(implicitMiningToolPlan.status, 'ready');
  assert.ok(implicitMiningToolPlan.exploredNodes < 384);
  assert.ok(implicitMiningToolPlan.actions.some(action => (
    action.capability.binding.command === '!craftRecipe("stone_pickaxe", 1)'
  )));
  assert.equal(implicitMiningToolPlan.actions.some(action => (
    /_log/.test(action.capability.binding.command)
    || action.capability.id === 'collect_wood'
  )), false);

  const bedPlan = buildPrerequisitePlan(bot, {
    target: 'red_bed',
    quantity: 1,
    range: 64,
    allowEntityAlternatives: true,
    allowUnobservedSelfDropRoot: false,
  });
  assert.equal(bedPlan.status, 'ready');
  assert.ok(bedPlan.exploredNodes < 384);
  assert.equal(bedPlan.nextStep.capability.id, 'harvest_entity_drop');
  assert.match(bedPlan.nextStep.capability.binding.command, /"sheep".*"red_wool".*true/);

  carried.push(
    { name: 'gray_wool', type: registry.itemsByName.gray_wool.id, count: 2 },
    { name: 'black_wool', type: registry.itemsByName.black_wool.id, count: 2 },
  );
  const committedBedPlan = buildPrerequisitePlan(bot, {
    target: 'gray_bed',
    quantity: 1,
    range: 64,
    allowEntityAlternatives: false,
    allowUnobservedSelfDropRoot: false,
  });
  assert.equal(committedBedPlan.status, 'ready');
  assert.ok(committedBedPlan.exploredNodes < 384);
  assert.equal(
    committedBedPlan.actions.some(action => /!harvestEntityDrop\([^)]*true\)/.test(
      action.capability.binding.command,
    )),
    false,
  );

  const planAfterMissingNaturalFlower = buildPrerequisitePlan(bot, {
    target: 'gray_bed',
    quantity: 1,
    range: 64,
    allowEntityAlternatives: false,
    allowUnobservedSelfDropRoot: false,
    excludedMethods: ['collect:closed_eyeblossom->closed_eyeblossom'],
  });
  assert.equal(planAfterMissingNaturalFlower.status, 'ready');
  assert.equal(planAfterMissingNaturalFlower.nextStep.capability.id, 'harvest_entity_drop');
  assert.doesNotMatch(
    planAfterMissingNaturalFlower.nextStep.capability.binding.command,
    /potted_/,
  );
});

test('Job-planned materials manufacture craftable blocks instead of searching for unobserved placed copies', () => {
  const bot = nearbyRecipeBot();
  bot.findBlock = () => null;

  const plan = buildPrerequisitePlan(bot, {
    target: 'oak_planks',
    quantity: 4,
    range: 64,
    allowUnobservedSelfDropRoot: false,
  });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.nextStep.capability.id, 'collect_block');
  assert.equal(plan.nextStep.capability.binding.command, '!collectBlocksInRange("oak_log", 1, 64)');
  assert.equal(
    plan.actions.some(action => action.learningKey === 'collect:oak_planks->oak_planks'),
    false,
  );
});

test('Job-planned prerequisites do not dismantle observed placed block aliases', () => {
  const registry = minecraftData('1.21.11');
  const carried = [
    { ...registry.itemsByName.stone_pickaxe, count: 1, durabilityUsed: 0 },
    { ...registry.itemsByName.stick, count: 2 },
  ];
  const wallTorch = registry.blocksByName.wall_torch;
  const bot = {
    entity: { position: { x: 0, y: 64, z: 0 } },
    inventory: { slots: carried, items: () => carried },
    findBlock({ matching }) {
      return matching === wallTorch.id
        ? { name: wallTorch.name, position: { x: 2, y: 65, z: 0 } }
        : null;
    },
    registry,
  };

  const plan = buildPrerequisitePlan(bot, {
    target: 'torch',
    quantity: 8,
    range: 64,
    allowUnobservedSelfDropRoot: false,
  });

  assert.equal(plan.status, 'ready');
  assert.equal(
    plan.actions.some(action => action.learningKey === 'collect:wall_torch->torch'),
    false,
  );
  assert.equal(plan.actions.at(-1).capability.binding.command, '!craftRecipe("torch", 2)');

  const alternateStrategy = buildPrerequisitePlan(bot, {
    target: 'torch',
    quantity: 8,
    range: 64,
    allowUnobservedSelfDropRoot: false,
    excludedMethods: ['collect:*->coal'],
  });
  assert.equal(alternateStrategy.status, 'ready');
  assert.equal(
    alternateStrategy.actions.some(action => /coal_ore/.test(action.learningKey || '')),
    false,
  );
  assert.equal(alternateStrategy.nextStep.capability.id, 'collect_wood');
  assert.equal(alternateStrategy.nextStep.learningKey, 'collect:logs->logs');
  assert.equal(
    alternateStrategy.actions.some(action => /^smelt:[a-z_]+_log->charcoal$/.test(action.learningKey || '')),
    true,
  );
});

test('The causal planner keeps a hand-equipment completion open until Minecraft reports the item equipped', () => {
  const bot = plannerBot();
  bot.inventory.slots = Array(46).fill(null);
  bot.inventory.slots[9] = { name: 'test_gem', count: 1 };
  bot.getEquipmentDestSlot = destination => destination === 'hand' ? 36 : 45;

  const pending = buildPrerequisitePlan(bot, {
    target: 'test_gem',
    quantity: 1,
    completion: { kind: 'main_hand' },
  });
  assert.equal(pending.status, 'ready');
  assert.equal(pending.nextStep.capability.binding.command, '!equip("test_gem", "main_hand")');

  bot.inventory.slots[9] = null;
  bot.inventory.slots[36] = { name: 'test_gem', count: 1 };
  const complete = buildPrerequisitePlan(bot, {
    target: 'test_gem',
    quantity: 1,
    completion: { kind: 'main_hand' },
  });
  assert.equal(complete.status, 'complete');
});

test('Planner capabilities expose and enforce the typed execution contract', async () => {
  const bot = plannerBot();
  const plan = buildPrerequisitePlan(bot, { target: 'test_gem', quantity: 1 });
  const capability = plan.nextStep.capability;
  const definition = getCapabilityDefinition(capability.id);

  assert.equal(capability.id, 'collect_block');
  assert.equal(capability.preconditions.ok, true);
  assert.deepEqual(capability.expectedEffects, [{
    kind: 'inventory_increase',
    name: 'test_gem',
    family: null,
    minimumIncrease: 1,
  }]);
  for (const member of ['parameters', 'preconditions', 'expectedEffects', 'bind', 'execute', 'verify', 'cost']) {
    assert.ok(definition[member], `capability definition is missing ${member}`);
  }

  const agent = { bot, last_action_result: null };
  const outcome = await executeCapabilityAction(capability, {
    agent,
    executeCommand: (_agent, command, options) => {
      assert.equal(command, '!collectBlocksInRange("alpha_ore", 1, 64)');
      assert.equal(options.owner, 'player');
      bot.inventory.slots = [{ name: 'test_gem', count: 1 }];
      return 'collected';
    },
  });
  assert.equal(outcome.verification.ok, true);
});

test('Verified capability effects supersede a stale executor failure', async () => {
  const bot = plannerBot();
  const plan = buildPrerequisitePlan(bot, { target: 'test_gem', quantity: 1 });
  const agent = { bot, last_action_result: null };

  const outcome = await executeCapabilityAction(plan.nextStep.capability, {
    agent,
    executeCommand: () => {
      bot.inventory.slots = [{ name: 'test_gem', count: 1 }];
      agent.last_action_result = {
        actionId: 'stale-collection-failure',
        label: 'action:collectBlocksInRange',
        phase: 'failed',
        code: 'skill_unreachable',
        detail: 'The final route candidate was unreachable after collection.',
        target: { name: 'alpha_ore', x: 4, y: 12, z: 8 },
        evidence: { skill: { outcome: 'unreachable' } },
        retryable: true,
        startedAt: 1,
        finishedAt: 2,
      };
      return false;
    },
  });

  assert.equal(outcome.verification.ok, true);
  assert.equal(outcome.result.phase, 'succeeded');
  assert.equal(outcome.result.code, 'capability_effects_verified');
  assert.equal(outcome.result.retryable, false);
  assert.equal(outcome.result.evidence.capability.executorResult.code, 'skill_unreachable');
});

test('Verified partial inventory acquisition advances without spending a productive attempt', async () => {
  const bot = plannerBot();
  const plan = buildPrerequisitePlan(bot, { target: 'test_gem', quantity: 4 });
  const agent = { bot, last_action_result: null };

  const outcome = await executeCapabilityAction(plan.nextStep.capability, {
    agent,
    executeCommand: () => {
      bot.inventory.slots = [{ name: 'test_gem', count: 2 }];
      agent.last_action_result = {
        actionId: 'bounded-partial-collection',
        phase: 'failed',
        code: 'timeout',
        detail: 'The bounded collection lease ended after making physical progress.',
        retryable: true,
        evidence: { skill: { kind: 'collect', outcome: 'interrupted', count: 2 } },
      };
      return false;
    },
  });

  assert.equal(outcome.verification.ok, false);
  assert.equal(outcome.verification.observedIncrease, 2);
  assert.equal(outcome.result.phase, 'succeeded');
  assert.equal(outcome.result.code, 'capability_verified_partial_progress');
  assert.equal(outcome.result.retryable, false);
});

test('Verified returnable mining progress advances a capability before its inventory effect', async () => {
  const bot = plannerBot();
  const plan = buildPrerequisitePlan(bot, { target: 'test_gem', quantity: 1 });
  const agent = { bot, last_action_result: null };

  const outcome = await executeCapabilityAction(plan.nextStep.capability, {
    agent,
    executeCommand: () => {
      agent.last_action_result = {
        actionId: 'mining-route-progress',
        phase: 'failed',
        code: 'skill_search_advanced',
        detail: 'Advanced a bounded mining route.',
        retryable: false,
        evidence: {
          skill: {
            kind: 'mining_search',
            outcome: 'search_advanced',
            routeDigging: true,
            returnable: true,
            routeSteps: 4,
            target: { name: 'alpha_ore', x: 4, y: 20, z: 8 },
            observedPosition: { x: 1, y: 22, z: 4 },
          },
        },
      };
      return false;
    },
  });

  assert.equal(outcome.verification.ok, false);
  assert.equal(outcome.result.phase, 'succeeded');
  assert.equal(outcome.result.code, 'capability_verified_partial_progress');
  assert.equal(outcome.result.retryable, false);
});

test('Verified supported surface progress advances without spending a productive attempt', async () => {
  const bot = plannerBot();
  const capability = createCapabilityPlanAction('reach_surface', {}, {}, { bot }).capability;
  const agent = { bot, last_action_result: null };

  const outcome = await executeCapabilityAction(capability, {
    agent,
    executeCommand: () => {
      agent.last_action_result = {
        actionId: 'surface-progress',
        phase: 'failed',
        code: 'skill_surface_progress_incomplete',
        detail: 'Advanced upward through a bounded surface corridor.',
        retryable: true,
        evidence: {
          skill: {
            kind: 'surface_navigation',
            outcome: 'surface_progress_incomplete',
            target: { x: 8, y: 70, z: 4 },
            observed: { x: 3, y: 42, z: 1 },
            supported: true,
            verticalProgress: 24,
          },
        },
      };
      return false;
    },
  });

  assert.equal(outcome.verification.ok, false);
  assert.equal(outcome.result.phase, 'succeeded');
  assert.equal(outcome.result.code, 'capability_verified_partial_progress');
  assert.equal(outcome.result.retryable, false);
});

test('Verified entity-search relocation advances without spending a productive attempt', async () => {
  const bot = renewableWoolRecipeBot();
  const plan = buildPrerequisitePlan(bot, { target: 'white_bed', quantity: 1, range: 64 });
  const capability = plan.actions[0].capability;
  const agent = { bot, last_action_result: null };

  const outcome = await executeCapabilityAction(capability, {
    agent,
    executeCommand: () => {
      agent.last_action_result = {
        actionId: 'entity-search-progress',
        phase: 'failed',
        code: 'skill_source_search_advanced',
        detail: 'Advanced into a distinct sheep-search region.',
        retryable: true,
        evidence: {
          skill: {
            kind: 'entity_harvest',
            outcome: 'source_search_advanced',
            searchAdvanced: true,
            collected: 0,
            relocationDistance: 90,
            origin: { x: 0, y: 64, z: 0 },
            observedPosition: { x: 64, y: 64, z: 64 },
          },
        },
      };
      return false;
    },
  });

  assert.equal(outcome.verification.ok, false);
  assert.equal(outcome.result.phase, 'succeeded');
  assert.equal(outcome.result.code, 'capability_verified_partial_progress');
  assert.equal(outcome.result.retryable, false);
});

test('An observed entity alternative remains failed until a durable binder accepts it', async () => {
  const bot = renewableWoolRecipeBot();
  const capability = createCapabilityPlanAction('harvest_entity_drop', {
    source: 'sheep',
    output: 'white_wool',
    method: 'shear',
    count: 3,
    range: 192,
    expectedIncrease: 3,
  }, {}, { bot }).capability;
  const agent = { bot, last_action_result: null };

  const outcome = await executeCapabilityAction(capability, {
    agent,
    executeCommand: () => {
      agent.last_action_result = {
        actionId: 'alternative-observed',
        phase: 'failed',
        code: 'skill_alternative_source_observed',
        detail: 'Observed brown wool nearby.',
        retryable: false,
        evidence: {
          skill: {
            kind: 'entity_harvest',
            outcome: 'alternative_source_observed',
            alternativeOutput: 'brown_wool',
            entityId: 42,
            observedPosition: { x: 2, y: 64, z: 3 },
          },
        },
      };
      return false;
    },
  });

  assert.equal(outcome.result.phase, 'failed');
  assert.equal(outcome.result.code, 'skill_alternative_source_observed');
});

test('The causal planner schedules a verified source-access capability before nested acquisition', () => {
  const bot = plannerBot();
  const plan = buildPrerequisitePlan(bot, {
    target: 'test_gem',
    quantity: 1,
    accessRequirement: { kind: 'surface' },
  });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.nextStep.capability.id, 'reach_surface');
  assert.equal(plan.nextStep.capability.binding.command, '!goToSurface');
  assert.equal(plan.nextStep.expectedName, null);
  assert.equal(plan.nextStep.expectedIncrease, 0);
});

test('Empty-inventory planning does not treat reversible compression recipes as acquisition sources', () => {
  const registry = minecraftData('1.21.11');
  const bot = {
    entity: { position: { x: 0, y: 69, z: 0 } },
    entities: {},
    inventory: { slots: [], items: () => [] },
    registry,
    findBlock() { return null; },
  };

  const plan = buildPrerequisitePlan(bot, {
    target: 'iron_pickaxe',
    quantity: 1,
    range: 64,
    allowUnobservedSelfDropRoot: false,
  });

  assert.notEqual(plan.code, 'planner_node_budget');
  assert.ok(plan.exploredNodes < 384);
  assert.notEqual(plan.blocker, 'iron_block');
  assert.notEqual(plan.blocker, 'iron_nugget');

  const cherryLogId = registry.blocksByName.cherry_log.id;
  const observedTreePlan = buildPrerequisitePlan({
    ...bot,
    findBlock({ matching }) {
      return matching === cherryLogId
        ? { name: 'cherry_log', position: { x: 6, y: 69, z: 0 } }
        : null;
    },
  }, {
    target: 'iron_pickaxe',
    quantity: 1,
    range: 64,
  });
  assert.equal(observedTreePlan.status, 'ready');
  assert.ok(observedTreePlan.exploredNodes < 1024);
  assert.equal(observedTreePlan.nextStep.capability.id, 'collect_wood');
  assert.equal(observedTreePlan.nextStep.target, 'logs');
});

test('Exact-item delivery binds one recipient and trusts only authoritative pickup evidence', async () => {
  const recipient = {
    id: 41,
    type: 'player',
    username: 'Director',
    position: { x: 2, y: 64, z: 0 },
  };
  const bot = {
    username: 'TestBot',
    inventory: { slots: [{ name: 'chest', count: 1 }] },
    players: { Director: { username: 'Director', entity: recipient } },
    entities: { 41: recipient },
    registry: { itemsByName: { chest: { id: 1, name: 'chest' } } },
  };
  const agent = {
    bot,
    last_action_result: null,
    getKnownAgentNames: () => ['TestBot'],
  };
  const request = createCapabilityRequest('deliver_exact_item', {
    player: 'Director',
    item: 'chest',
    quantity: 1,
  }).capability;

  assert.equal(capabilityCommand(request), '!givePlayer("Director", "chest", 1)');
  const delivered = await executeCapabilityAction(request, {
    agent,
    owner: 'player',
    routeOrigin: 'goal-director',
    executeCommand: (_agent, command, options) => {
      assert.equal(command, '!givePlayer("Director", "chest", 1)');
      assert.deepEqual(options, { owner: 'player', routeOrigin: 'goal-director' });
      bot.inventory.slots = [];
      agent.last_action_result = {
        actionId: 'delivery-1',
        label: 'action:givePlayer',
        phase: 'succeeded',
        code: 'skill_delivered',
        detail: 'Minecraft confirmed the pickup.',
        evidence: {
          skill: {
            kind: 'give',
            outcome: 'delivered',
            target: { canonicalName: 'Director', entityId: 41 },
            item: 'chest',
            requested: 1,
            transferred: 1,
          },
        },
        retryable: false,
        startedAt: 1,
        finishedAt: 2,
      };
      return true;
    },
  });

  assert.equal(delivered.verification.ok, true);
  assert.equal(delivered.result.evidence.capability.id, 'deliver_exact_item');
  assert.deepEqual(delivered.result.evidence.capability.binding, {
    commandName: '!givePlayer',
    recipient: 'Director',
    recipientEntityId: 41,
    item: 'chest',
    requestedQuantity: 1,
  });
  assert.equal(delivered.result.evidence.capability.verification.transferred, 1);

  bot.inventory.slots = [{ name: 'chest', count: 1 }];
  const interrupted = await executeCapabilityAction(request, {
    agent,
    executeCommand: () => {
      agent.last_action_result = {
        actionId: 'delivery-2',
        label: 'action:givePlayer',
        phase: 'interrupted',
        code: 'stop_requested',
        detail: 'Delivery was stopped before pickup.',
        evidence: { skill: { kind: 'give', outcome: 'interrupted', transferred: 0 } },
        retryable: true,
        startedAt: 3,
        finishedAt: 4,
      };
      return false;
    },
  });
  assert.equal(interrupted.result.phase, 'interrupted');
  assert.equal(interrupted.result.code, 'stop_requested');
  assert.equal(interrupted.verification.ok, false);
  assert.equal(classifyMethodOutcome(interrupted.result), 'censored');

  bot.players = {};
  bot.entities = {};
  const absent = await executeCapabilityAction(request, {
    agent,
    executeCommand: () => assert.fail('An absent recipient must fail before physical execution.'),
  });
  assert.equal(absent.result.code, 'precondition_missing');
});

test('Family delivery binds a concrete mixed manifest, retains partial evidence, and censors Stop', async () => {
  const recipient = {
    id: 42,
    type: 'player',
    username: 'Director',
    position: { x: 2, y: 64, z: 0 },
  };
  const carried = () => [
    { name: 'oak_log', count: 2 },
    { name: 'birch_log', count: 2 },
  ];
  const manifest = [
    { item: 'birch_log', quantity: 2 },
    { item: 'oak_log', quantity: 1 },
  ];
  const delivery = (item, quantity, droppedEntityId) => ({
    item,
    requested: quantity,
    transferred: quantity,
    outcome: 'delivered',
    target: { canonicalName: 'Director', entityId: 42 },
    droppedEntityId,
    deliveryAttempts: 1,
  });
  const bot = {
    username: 'TestBot',
    inventory: { slots: carried() },
    players: { Director: { username: 'Director', entity: recipient } },
    entities: { 42: recipient },
    registry: { itemsByName: { oak_log: {}, birch_log: {} } },
  };
  const agent = {
    bot,
    last_action_result: null,
    getKnownAgentNames: () => ['TestBot'],
  };
  const request = createCapabilityRequest('deliver_item_family', {
    player: 'Director',
    family: 'logs',
    quantity: 3,
  }).capability;

  assert.equal(capabilityCommand(request), '!giveFamilyToPlayer("logs", "Director", 3)');
  const delivered = await executeCapabilityAction(request, {
    agent,
    executeCommand: (_agent, command) => {
      assert.equal(command, '!giveFamilyToPlayer("logs", "Director", 3)');
      bot.inventory.slots = [{ name: 'oak_log', count: 1 }];
      agent.last_action_result = {
        actionId: 'family-delivery-1',
        phase: 'succeeded',
        code: 'skill_delivered',
        detail: 'Minecraft confirmed both exact pickups.',
        evidence: {
          skill: {
            kind: 'family_give',
            outcome: 'delivered',
            family: 'logs',
            target: { canonicalName: 'Director', entityId: 42 },
            requested: 3,
            transferred: 3,
            manifest,
            deliveries: [delivery('birch_log', 2, 101), delivery('oak_log', 1, 102)],
          },
        },
        retryable: false,
      };
      return true;
    },
  });

  assert.equal(delivered.verification.ok, true);
  assert.deepEqual(delivered.binding.manifest, manifest);
  assert.deepEqual(delivered.result.evidence.capability.binding.manifest, manifest);
  assert.equal(delivered.result.evidence.capability.verification.transferred, 3);

  bot.inventory.slots = carried();
  const partial = await executeCapabilityAction(request, {
    agent,
    executeCommand: () => {
      bot.inventory.slots = [{ name: 'oak_log', count: 2 }];
      agent.last_action_result = {
        actionId: 'family-delivery-2',
        phase: 'failed',
        code: 'skill_delivery_partial',
        detail: 'The second exact stack was not received.',
        evidence: {
          skill: {
            kind: 'family_give',
            outcome: 'partial',
            family: 'logs',
            target: { canonicalName: 'Director', entityId: 42 },
            requested: 3,
            transferred: 2,
            manifest,
            deliveries: [delivery('birch_log', 2, 103)],
          },
        },
        retryable: true,
      };
      return false;
    },
  });
  assert.equal(partial.result.phase, 'failed');
  assert.equal(partial.verification.ok, false);
  assert.equal(partial.verification.transferred, 2);
  assert.equal(partial.verification.remaining, 1);

  bot.inventory.slots = carried();
  const stopped = await executeCapabilityAction(request, {
    agent,
    executeCommand: () => {
      bot.inventory.slots = [{ name: 'oak_log', count: 2 }];
      agent.last_action_result = {
        actionId: 'family-delivery-3',
        phase: 'interrupted',
        code: 'stop_requested',
        detail: 'Operator Stop interrupted the family handoff.',
        evidence: {
          skill: {
            kind: 'family_give',
            outcome: 'interrupted',
            family: 'logs',
            target: { canonicalName: 'Director', entityId: 42 },
            requested: 3,
            transferred: 2,
            manifest,
            deliveries: [delivery('birch_log', 2, 104)],
          },
        },
        retryable: true,
      };
      return false;
    },
  });
  assert.equal(stopped.result.phase, 'interrupted');
  assert.equal(stopped.verification.transferred, 2);
  assert.equal(classifyMethodOutcome(stopped.result), 'censored');

  bot.inventory.slots = carried();
  bot.players = {};
  bot.entities = {};
  const absent = await executeCapabilityAction(request, {
    agent,
    executeCommand: () => assert.fail('Precondition failure must not execute a physical command.'),
  });
  assert.equal(absent.result.code, 'precondition_missing');
  assert.equal(absent.result.evidence.capability.id, 'deliver_item_family');
  assert.deepEqual(absent.result.evidence.capability.arguments, {
    player: 'Director',
    family: 'logs',
    quantity: 3,
  });
  assert.equal(absent.result.evidence.capability.preconditions.ok, false);
  assert.equal(absent.result.evidence.capability.binding, null);

  bot.players = { Director: { username: 'Director', entity: recipient } };
  bot.entities = { 42: recipient };
  let inventoryReads = 0;
  bot.inventory = {
    items: () => {
      inventoryReads += 1;
      return inventoryReads === 1 ? carried() : [];
    },
  };
  const unbound = await executeCapabilityAction(request, {
    agent,
    executeCommand: () => assert.fail('Binding failure must not execute a physical command.'),
  });
  assert.equal(unbound.result.code, 'binding_failed');
  assert.equal(unbound.result.evidence.capability.id, 'deliver_item_family');
  assert.equal(unbound.result.evidence.capability.preconditions.ok, true);
  assert.equal(unbound.result.evidence.capability.binding, null);
  assert.equal(unbound.result.evidence.capability.bindingReport.ok, false);
});

test('A persisted goal preserves the learning identity of its active plan step', () => {
  const goal = createItemGoalContract({
    kind: 'acquire',
    requester: 'Player',
    target: {
      requestedName: 'test_gem',
      canonicalName: 'test_gem',
      inventoryName: 'test_gem',
      acquisitionName: 'test_gem',
      family: null,
      acquisitionKind: 'planned',
    },
    quantity: 1,
  });
  const normalized = normalizeGoalContract({
    ...goal,
    subgoals: [{
      id: `${goal.id}:subgoal-1`,
      kind: 'plan',
      state: 'acting',
      commandName: '!collectBlocksInRange',
      learningKey: 'collect:beta_ore->test_gem',
    }],
  });
  assert.equal(normalized.subgoals[0].learningKey, 'collect:beta_ore->test_gem');
});

test('Verified procedures never cross target identities', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mindcraft-procedure-'));
  try {
    const store = new ProcedureStore('TestBot', { root });
    const target = name => ({
      requestedName: name,
      canonicalName: name,
      inventoryName: name,
      acquisitionName: name,
      family: null,
      acquisitionKind: 'planned',
    });
    const completed = normalizeGoalContract({
      ...createItemGoalContract({
        kind: 'acquire',
        requester: 'Player',
        target: target('oak_log'),
        quantity: 1,
      }),
      phase: 'complete',
      evidence: {
        phase: 'succeeded',
        code: 'inventory_goal_verified',
        detail: 'Verified.',
        verified: true,
      },
      subgoals: [{
        kind: 'plan',
        state: 'succeeded',
        commandName: '!collectBlocksInRange',
        code: 'skill_collected',
      }],
    });
    const recorded = store.record(completed);
    assert.equal(recorded.targetKey, 'oak_log');

    const otherTarget = createItemGoalContract({
      kind: 'acquire',
      requester: 'Player',
      target: target('cobblestone'),
      quantity: 1,
    });
    assert.equal(store.find(otherTarget), null);
    assert.equal(store.find(completed)?.id, recorded.id);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
