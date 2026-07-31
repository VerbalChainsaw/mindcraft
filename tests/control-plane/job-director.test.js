import assert from 'node:assert/strict';
import test from 'node:test';

import {
  JobDirector,
  constructionTaskOrder,
} from '../../src/agent/runtime/job-director.js';
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
