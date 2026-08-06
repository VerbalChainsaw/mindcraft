import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

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

test('The causal planner prefers the nearest physical source behind equivalent recipe ingredients', () => {
  const plan = buildPrerequisitePlan(nearbyRecipeBot(), {
    target: 'test_tool',
    quantity: 1,
    range: 64,
  });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.nextStep.capability.binding.command, '!collectBlocksInRange("birch_log", 1, 64)');
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
