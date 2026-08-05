import assert from 'node:assert/strict';
import test from 'node:test';

import {
  JobDirector,
  constructionTaskOrder,
} from '../../src/agent/runtime/job-director.js';
import { EMERGENCY_SHELTER_BLUEPRINT } from '../../src/agent/runtime/emergency-shelter.js';
import { createWorkOrder } from '../../src/agent/runtime/work-order.js';

function memoryStore(loaded = null) {
  return {
    saved: [],
    load: () => loaded,
    save(order) {
      this.saved.push(order);
      return order;
    },
  };
}

function createAgent(role = 'miner') {
  return {
    name: 'TestMiner',
    bot: {
      entity: { position: { x: 0, y: 64, z: 0 } },
      inventory: { items: () => [], slots: [] },
    },
    runtime: {
      role,
      autonomy: 'autonomous',
      jobs: { mode: 'resumable', stockpileLimit: 128, deposit: 'inventory' },
      limits: { maxRecoveryAttempts: 2 },
      assignment: {},
    },
    self_prompter: { isStopped: () => true },
    last_action_result: null,
    isIdle: () => true,
    isOperatorHeld: () => false,
  };
}

function safeMiningSnapshot(inventory = {}) {
  return {
    inventory,
    tools: { pickaxeTier: 1 },
    foodPoints: 24,
    lightCount: 8,
    freeSlots: 20,
    escapeRoute: true,
    safeSelectedBlocks: true,
    deposit: { mode: 'inventory' },
  };
}

function settle() {
  return new Promise(resolve => setImmediate(resolve));
}

test('Given work-order submissions, JobDirector owns exactly one active order', () => {
  const director = new JobDirector(createAgent('builder'), {
    store: memoryStore(),
    getSnapshot: () => ({ inventory: {} }),
    now: () => 10_000,
  });
  const first = director.submit(createWorkOrder({
    id: 'one',
    role: 'builder',
    kind: 'stockpile',
    target: { name: 'oak_log' },
    quota: 16,
  }));
  const second = director.submit(createWorkOrder({
    id: 'two',
    role: 'builder',
    kind: 'stockpile',
    target: { name: 'stone' },
    quota: 16,
  }));

  assert.deepEqual(first, { accepted: true, id: 'one' });
  assert.deepEqual(second, { accepted: false, code: 'job_busy', id: 'one' });
  assert.equal(director.snapshot().workOrder.id, 'one');
});

test('Given an active typed player goal, survival shelter cannot seize persistent job ownership', () => {
  const agent = createAgent('builder');
  agent.goal_director = { activeGoal: { id: 'goal-player-1' } };
  const director = new JobDirector(agent, {
    store: memoryStore(),
    getSnapshot: () => ({ inventory: {} }),
    now: () => 10_000,
  });

  assert.deepEqual(director.requestWorkOrder({ kind: 'emergency_shelter' }), {
    accepted: false,
    code: 'player_goal_active',
    id: 'goal-player-1',
  });
  assert.equal(director.activeOrder, null);

  const automatic = director.submit(createWorkOrder({
    id: 'automatic-role-order',
    role: 'builder',
    kind: 'stockpile',
    source: 'role',
    target: { name: 'cobblestone' },
    quota: 8,
  }));
  assert.equal(automatic.accepted, true);
  director.update();
  assert.equal(director.activeOrder, null);
  assert.equal(director.snapshot().code, 'job_cancelled');
});

test('Given an emergency shelter, its concrete material remains bound across inventory changes and restart', () => {
  const agent = createAgent('builder');
  agent.bot.inventory.items = () => [
    { name: 'dirt', count: 64 },
    { name: 'cobblestone', count: 64 },
  ];
  const store = memoryStore();
  const director = new JobDirector(agent, { store });

  const accepted = director.requestWorkOrder({
    kind: 'emergency_shelter',
    blueprint: EMERGENCY_SHELTER_BLUEPRINT,
  });

  assert.equal(accepted.accepted, true);
  assert.deepEqual(new Set(director.activeOrder.blueprint.cells.map(cell => cell.material)), new Set(['dirt']));

  agent.bot.inventory.items = () => [
    { name: 'cobblestone', count: 64 },
    { name: 'dirt', count: 63 },
  ];
  const restored = new JobDirector(agent, {
    store: memoryStore(store.saved.at(-1)),
    getSnapshot: () => ({ inventory: {}, position: { x: 0, y: 64, z: 0 } }),
    now: () => 10_000,
  });
  assert.deepEqual(new Set(restored.activeOrder.blueprint.cells.map(cell => cell.material)), new Set(['dirt']));
});

test('Given an explicit construction task, Builder converts it into an exact player-authorized work order', () => {
  const agent = createAgent('builder');
  agent.task = {
    task_type: 'construction',
    data: { task_id: 'safe_hut' },
    blueprint: {
      data: {
        levels: [
          {
            coordinates: [10, 64, -2],
            placement: [
              ['stone', 'air'],
              ['oak_planks', 'stone'],
            ],
          },
        ],
      },
    },
  };

  const order = constructionTaskOrder(agent);

  assert.equal(order.id, 'task-safe_hut');
  assert.equal(order.source, 'player');
  assert.equal(order.kind, 'build');
  assert.deepEqual(order.target, { name: 'worksite', x: 10, y: 64, z: -2 });
  assert.deepEqual(order.blueprint.cells, [
    { x: 0, y: 0, z: 0, material: 'stone' },
    { x: 0, y: 0, z: 1, material: 'oak_planks' },
    { x: 1, y: 0, z: 1, material: 'stone' },
  ]);
});

test('Given a resumable mining order, JobDirector dispatches one phase action and advances only on changed success', async () => {
  const agent = createAgent();
  const commands = [];
  const director = new JobDirector(agent, {
    store: memoryStore(),
    getSnapshot: () => safeMiningSnapshot({ cobblestone: 0 }),
    now: () => 10_000,
    executeCommand: (_agent, command) => {
      commands.push(command);
      agent.last_action_result = {
        actionId: 'mine-action-1',
        phase: 'succeeded',
        code: 'skill_collected',
        retryable: false,
      };
    },
  });
  director.submit(createWorkOrder({
    id: 'mine-one',
    role: 'miner',
    kind: 'mine',
    target: { name: 'cobblestone' },
    quota: 6,
  }));

  director.nextAttemptAt = 0;
  director.update();
  await settle();

  assert.deepEqual(commands, ['!collectBlocksInRange("cobblestone", 6, 64)']);
  assert.equal(director.activeOrder.phase, 'verify');
  assert.equal(director.snapshot().phase, 'succeeded');
});

test('Given a partial mixed-family handoff, JobDirector checkpoints only verified transfers', async () => {
  const agent = createAgent('lumberjack');
  const recipient = {
    id: 42,
    type: 'player',
    username: 'Director',
    position: { x: 2, y: 64, z: 0 },
  };
  agent.bot.inventory.slots = [
    { name: 'oak_log', count: 2 },
    { name: 'birch_log', count: 2 },
  ];
  agent.bot.inventory.items = () => agent.bot.inventory.slots;
  agent.bot.players = { Director: { username: 'Director', entity: recipient } };
  agent.bot.entities = { 42: recipient };
  agent.getKnownAgentNames = () => ['TestMiner'];
  const commands = [];
  const director = new JobDirector(agent, {
    store: memoryStore(),
    getSnapshot: () => ({
      inventory: { oak_log: 2, birch_log: 2 },
      tools: { axeTier: 3 },
      freeSlots: 20,
      safeTrunks: true,
      deposit: { mode: 'leader', leader: 'Director' },
    }),
    now: () => 10_000,
    executeCommand: (_agent, command) => {
      commands.push(command);
      agent.bot.inventory.slots = [{ name: 'oak_log', count: 2 }];
      agent.last_action_result = {
        actionId: 'family-partial-1',
        phase: 'failed',
        code: 'skill_delivery_partial',
        detail: 'One concrete species was delivered before the second failed.',
        evidence: {
          skill: {
            kind: 'family_give',
            outcome: 'partial',
            family: 'logs',
            target: { canonicalName: 'Director', entityId: 42 },
            requested: 3,
            transferred: 2,
            manifest: [
              { item: 'birch_log', quantity: 2 },
              { item: 'oak_log', quantity: 1 },
            ],
            deliveries: [{
              item: 'birch_log',
              requested: 2,
              transferred: 2,
              outcome: 'delivered',
              target: { canonicalName: 'Director', entityId: 42 },
              droppedEntityId: 101,
              deliveryAttempts: 1,
            }],
          },
        },
        retryable: true,
      };
      return false;
    },
  });
  director.submit(createWorkOrder({
    id: 'family-partial-order',
    role: 'lumberjack',
    kind: 'harvest',
    source: 'player',
    requester: 'Director',
    target: { name: 'logs' },
    quota: 3,
  }));
  director.activeOrder = { ...director.activeOrder, phase: 'deliver' };

  director.nextAttemptAt = 0;
  director.update();
  await settle();

  assert.deepEqual(commands, ['!giveFamilyToPlayer("logs", "Director", 3)']);
  assert.equal(director.activeOrder.phase, 'recover');
  assert.equal(director.activeOrder.checkpoint.delivered, 2);
  assert.equal(director.activeOrder.attempts, 1);
});

test('Given a terminal player work order, JobDirector retains the shared player handoff before autonomy', () => {
  const agent = createAgent();
  const handoffs = [];
  agent.behavior_arbiter = {
    beginTerminalHandoff(value) {
      handoffs.push(value);
      return value;
    },
  };
  const director = new JobDirector(agent, {
    store: memoryStore(),
    getSnapshot: () => safeMiningSnapshot({ cobblestone: 1 }),
    now: () => 10_000,
  });
  director.submit(createWorkOrder({
    id: 'player-mine-complete',
    role: 'miner',
    kind: 'mine',
    source: 'player',
    requester: 'Director',
    target: { name: 'cobblestone' },
    quota: 1,
  }));

  director.update();

  assert.equal(director.activeOrder, null);
  assert.equal(director.lastOrder.phase, 'complete');
  assert.deepEqual(handoffs, [{
    outcomeId: 'player-mine-complete',
    owner: 'player_job',
    phase: 'complete',
    code: 'mining_quota_retained',
  }]);
});

test('Given retryable failure, JobDirector persists bounded recovery instead of falsely advancing', async () => {
  const agent = createAgent();
  const store = memoryStore();
  const director = new JobDirector(agent, {
    store,
    getSnapshot: () => safeMiningSnapshot({}),
    now: () => 10_000,
    executeCommand: () => {
      agent.last_action_result = {
        actionId: 'mine-fail-1',
        phase: 'failed',
        code: 'skill_unreachable',
        retryable: true,
      };
    },
  });
  director.submit(createWorkOrder({
    id: 'mine-fail',
    role: 'miner',
    kind: 'mine',
    target: { name: 'cobblestone' },
    quota: 6,
  }));

  director.nextAttemptAt = 0;
  director.update();
  await settle();

  assert.equal(director.activeOrder.phase, 'recover');
  assert.equal(director.activeOrder.attempts, 1);
  assert.equal(store.saved.at(-1).phase, 'recover');
});

test('Given a command without a changed structured result, JobDirector enters recovery instead of advancing', async () => {
  const agent = createAgent();
  agent.last_action_result = { actionId: 'old', phase: 'succeeded' };
  const director = new JobDirector(agent, {
    store: memoryStore(),
    getSnapshot: () => safeMiningSnapshot({}),
    now: () => 10_000,
    executeCommand: () => {},
  });
  director.submit(createWorkOrder({
    id: 'mine-missing-result',
    role: 'miner',
    kind: 'mine',
    target: { name: 'cobblestone' },
    quota: 6,
  }));

  director.nextAttemptAt = 0;
  director.update();
  await settle();

  assert.equal(director.activeOrder.phase, 'recover');
  assert.equal(director.activeOrder.evidence.code, 'missing_action_result');
  assert.equal(director.activeOrder.attempts, 1);
});

test('Given persisted in-flight state, JobDirector reconciles it to assessment before any resumed command', () => {
  const persisted = {
    ...createWorkOrder({
      id: 'persisted',
      role: 'miner',
      kind: 'mine',
      target: { name: 'cobblestone' },
      quota: 6,
    }),
    phase: 'execute',
    checkpoint: { collected: 2 },
  };
  const director = new JobDirector(createAgent(), {
    store: memoryStore(persisted),
    getSnapshot: () => safeMiningSnapshot({ cobblestone: 2 }),
    now: () => 10_000,
  });

  assert.equal(director.activeOrder.phase, 'assess');
  assert.equal(director.activeOrder.resumePhase, 'execute');
  assert.equal(director.activeOrder.evidence.code, 'restart_revalidation');
});

test('Given command autonomy and a persisted player order, JobDirector restores it for restart revalidation', () => {
  const agent = createAgent('builder');
  agent.runtime.autonomy = 'command';
  const persisted = {
    ...createWorkOrder({
      id: 'player-restart',
      role: 'builder',
      kind: 'build',
      source: 'player',
      requester: 'player',
      target: { name: 'worksite', x: 1, y: 64, z: 1 },
      blueprint: {
        id: 'restart_block',
        width: 1,
        depth: 1,
        height: 1,
        cells: [{ x: 0, y: 0, z: 0, material: 'stone' }],
      },
    }),
    phase: 'execute',
  };
  const store = memoryStore(persisted);

  const director = new JobDirector(agent, {
    store,
    getSnapshot: () => ({ inventory: {}, position: { x: 1, y: 64, z: 1 } }),
    now: () => 10_000,
  });

  assert.equal(director.activeOrder.id, 'player-restart');
  assert.equal(director.activeOrder.phase, 'assess');
  assert.equal(store.saved.at(-1).evidence.code, 'restart_revalidation');
});

test('Given command autonomy and a persisted automatic role order, JobDirector clears only that suppressed order', () => {
  const agent = createAgent('builder');
  agent.runtime.autonomy = 'command';
  const persisted = createWorkOrder({
    id: 'automatic-restart',
    role: 'builder',
    kind: 'stockpile',
    source: 'role',
    target: { name: 'planks' },
    quota: 16,
  });
  const store = memoryStore(persisted);

  const director = new JobDirector(agent, { store });

  assert.equal(director.activeOrder, null);
  assert.equal(store.saved.at(-1), null);
});

test('Given command autonomy and a persisted survival order, JobDirector restores it with ownership intact', () => {
  const agent = createAgent('builder');
  agent.runtime.autonomy = 'command';
  const persisted = {
    ...createWorkOrder({
      id: 'survival-restart',
      role: 'builder',
      kind: 'emergency_shelter',
      source: 'survival',
      requester: 'TestMiner',
      target: { name: 'worksite', x: 0, y: 64, z: 0 },
      blueprint: {
        id: 'survival_restart_block',
        width: 1,
        depth: 1,
        height: 1,
        cells: [{ x: 0, y: 0, z: 0, material: 'stone' }],
      },
    }),
    phase: 'execute',
  };
  const store = memoryStore(persisted);

  const director = new JobDirector(agent, {
    store,
    getSnapshot: () => ({ inventory: {}, position: { x: 0, y: 64, z: 0 } }),
    now: () => 10_000,
  });

  assert.equal(director.activeOrder.id, 'survival-restart');
  assert.equal(director.activeOrder.source, 'survival');
  assert.equal(director.activeOrder.requester, 'TestMiner');
  assert.equal(director.activeOrder.phase, 'assess');
  assert.equal(store.saved.at(-1).evidence.code, 'restart_revalidation');
  assert.deepEqual(director.snapshot().workOrder, {
    id: 'survival-restart',
    role: 'builder',
    kind: 'emergency_shelter',
    source: 'survival',
    requester: 'TestMiner',
    phase: 'assess',
    target: { name: 'worksite', x: 0, y: 64, z: 0 },
    attempts: 0,
    maxAttempts: 3,
    checkpoint: {},
    evidence: {
      code: 'restart_revalidation',
      detail: 'Restart revalidation required at {"inventory":{},"position":{"x":0,"y":64,"z":0}}',
      actionId: '',
    },
  });
});

test('Given corrupt persisted job state, JobDirector surfaces the load error without overwriting evidence', () => {
  const store = {
    lastError: 'invalid persisted JSON',
    saved: [],
    load: () => null,
    save(order) {
      this.saved.push(order);
      return order;
    },
  };

  const director = new JobDirector(createAgent(), { store });

  assert.equal(director.snapshot().code, 'job_state_load_failed');
  assert.deepEqual(store.saved, []);
});

test('Given manual command grace, JobDirector suppresses job scheduling', () => {
  const agent = createAgent();
  const commands = [];
  const director = new JobDirector(agent, {
    store: memoryStore(),
    getSnapshot: () => safeMiningSnapshot({}),
    now: () => 10_000,
    executeCommand: (_agent, command) => commands.push(command),
  });
  director.deferForManualCommand('player directed movement');
  director.update();

  assert.deepEqual(commands, []);
  assert.equal(director.snapshot().code, 'manual_command');
});

test('Given a fight that dragged the bot off its worksite, the job walks back before resuming', async () => {
  const agent = createAgent('miner');
  const commands = [];
  let position = { x: 0, y: 12, z: 0 };
  const director = new JobDirector(agent, {
    store: memoryStore(),
    getSnapshot: () => ({
      ...safeMiningSnapshot({ iron_pickaxe: 1 }),
      ...position,
      resourceFound: true,
    }),
    now: () => 10_000,
    executeCommand: (_agent, command) => {
      commands.push(command);
      return Promise.resolve();
    },
  });
  director.submit(createWorkOrder({
    id: 'mine-anchor',
    role: 'miner',
    kind: 'mine',
    source: 'player',
    requester: 'Gabriel',
    target: { name: 'iron_ore' },
    quota: 8,
  }));

  // First dispatch anchors the order to where the work is happening.
  director.update();
  await settle();
  assert.ok(commands.length > 0, 'the miner should dispatch a first step');
  assert.deepEqual(director.activeOrder.anchor, { x: 0, y: 12, z: 0 });

  // A reflex takes ownership and the chase ends 40 blocks away.
  agent.last_action_result = {
    actionId: 'reflex-1',
    phase: 'interrupted',
    code: 'interrupted',
    retryable: true,
  };
  director.activeOrder = { ...director.activeOrder, evidence: { code: 'preempted', detail: '', actionId: 'reflex-1' } };
  position = { x: 40, y: 20, z: 12 };
  director.nextAttemptAt = 0;
  commands.length = 0;

  director.update();
  await settle();
  assert.equal(commands[0], '!goToCoordinates(0, 12, 0, 2)');
  // The return step must not reanchor the order to where the fight ended.
  assert.deepEqual(director.activeOrder.anchor, { x: 0, y: 12, z: 0 });
});
