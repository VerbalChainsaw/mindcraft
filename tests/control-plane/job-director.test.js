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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function familyDeliveryAgent() {
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
  return agent;
}

function familyDeliverySnapshot(agent) {
  const inventory = Object.fromEntries(
    agent.bot.inventory.items().map(item => [item.name, item.count]),
  );
  return {
    inventory,
    tools: { axeTier: 3 },
    freeSlots: 20,
    safeTrunks: true,
    deposit: { mode: 'leader', leader: 'Director' },
  };
}

function familyDeliveryResult({ actionId, complete = false }) {
  const deliveries = [{
    item: 'birch_log',
    requested: 2,
    transferred: 2,
    outcome: 'delivered',
    target: { canonicalName: 'Director', entityId: 42 },
    droppedEntityId: 101,
    deliveryAttempts: 1,
  }];
  if (complete) {
    deliveries.push({
      item: 'oak_log',
      requested: 1,
      transferred: 1,
      outcome: 'delivered',
      target: { canonicalName: 'Director', entityId: 42 },
      droppedEntityId: 102,
      deliveryAttempts: 1,
    });
  }
  return {
    actionId,
    phase: complete ? 'succeeded' : 'interrupted',
    code: complete ? 'skill_delivered' : 'stop_requested',
    detail: complete
      ? 'All concrete family transfers were verified.'
      : 'Stop interrupted the family transfer after the first verified receipt.',
    evidence: {
      skill: {
        kind: 'family_give',
        outcome: complete ? 'delivered' : 'partial',
        family: 'logs',
        target: { canonicalName: 'Director', entityId: 42 },
        requested: 3,
        transferred: complete ? 3 : 2,
        manifest: [
          { item: 'birch_log', quantity: 2 },
          { item: 'oak_log', quantity: 1 },
        ],
        deliveries,
      },
    },
    retryable: !complete,
  };
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
  director.persist({
    ...director.activeOrder,
    phase: 'acquire',
    checkpoint: { collected: 5 },
  });
  const same = director.submit(createWorkOrder({
    id: 'one',
    role: 'builder',
    kind: 'stockpile',
    target: { name: 'oak_log' },
    quota: 16,
  }));
  const conflict = director.submit(createWorkOrder({
    id: 'one',
    role: 'builder',
    kind: 'stockpile',
    target: { name: 'stone' },
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
  assert.deepEqual(same, { accepted: true, code: 'already_active', id: 'one' });
  assert.deepEqual(conflict, { accepted: false, code: 'order_id_conflict', id: 'one' });
  assert.deepEqual(second, { accepted: false, code: 'job_busy', id: 'one' });
  assert.equal(director.snapshot().workOrder.id, 'one');
  assert.equal(director.activeOrder.phase, 'acquire');
  assert.equal(director.activeOrder.checkpoint.collected, 5);
});

test('Accepting a new work order atomically clears an older terminal receipt', () => {
  const completed = {
    ...createWorkOrder({
      id: 'completed-order',
      role: 'builder',
      kind: 'stockpile',
      target: { name: 'oak_log' },
      quota: 4,
    }),
    phase: 'complete',
  };
  const store = {
    terminalReceipt: {
      orderId: completed.id,
      phase: completed.phase,
      code: 'job_complete',
      order: completed,
    },
    saved: [],
    load: () => null,
    save(order, receipt = store.terminalReceipt) {
      store.terminalReceipt = receipt;
      store.saved.push({ order, receipt });
      return order;
    },
  };
  const director = new JobDirector(createAgent('builder'), { store });

  const accepted = director.submit(createWorkOrder({
    id: 'new-order',
    role: 'builder',
    kind: 'stockpile',
    target: { name: 'stone' },
    quota: 8,
  }));

  assert.deepEqual(accepted, { accepted: true, id: 'new-order' });
  assert.equal(director.activeOrder.id, 'new-order');
  assert.equal(director.lastOrder, null);
  assert.equal(director.lastReceipt, null);
  assert.equal(store.terminalReceipt, null);
  assert.equal(store.saved.at(-1).receipt, null);
});

test('A failed player job blocks autonomous shelter substitution until new direction arrives', () => {
  const agent = createAgent('builder');
  const director = new JobDirector(agent, {
    store: memoryStore(),
    getSnapshot: () => ({ inventory: {} }),
    now: () => 10_000,
  });
  director.submit(createWorkOrder({
    id: 'player-build',
    role: 'builder',
    kind: 'build',
    source: 'player',
    requester: 'Director',
    target: { name: 'construction_site', x: 4, y: 64, z: 4 },
    quota: 1,
    blueprint: {
      id: 'small_build',
      width: 1,
      depth: 1,
      height: 1,
      cells: [{ x: 0, y: 0, z: 0, material: 'cobblestone' }],
    },
  }));
  director.finishOrder('failed', 'material_unavailable', 'Waiting for player direction.', false);

  assert.deepEqual(director.requestWorkOrder({ kind: 'emergency_shelter' }), {
    accepted: false,
    code: 'player_job_failed_awaiting_direction',
    id: 'player-build',
  });
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

test('Given a queued player agenda, automatic survival work yields before agenda dispatch', () => {
  const agent = createAgent('builder');
  agent.agenda_director = { hasUnfinished: () => true };
  const director = new JobDirector(agent, {
    store: memoryStore(),
    getSnapshot: () => ({ inventory: {} }),
    now: () => 10_000,
  });

  assert.deepEqual(director.requestWorkOrder({ kind: 'emergency_shelter' }), {
    accepted: false,
    code: 'player_agenda_active',
  });

  const restoredAutomatic = director.submit(createWorkOrder({
    id: 'restored-survival-order',
    role: 'builder',
    kind: 'emergency_shelter',
    source: 'survival',
    requester: 'TestMiner',
    target: { name: 'worksite', x: 0, y: 64, z: 0 },
    quota: 1,
    blueprint: EMERGENCY_SHELTER_BLUEPRINT,
  }));
  assert.equal(restoredAutomatic.accepted, true);

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

test('Given Stop during an asynchronous family handoff, its late settlement cannot revive the cancelled order', async () => {
  const agent = familyDeliveryAgent();
  const store = memoryStore();
  const execution = deferred();
  const handoffs = [];
  agent.behavior_arbiter = {
    beginTerminalHandoff(value) {
      handoffs.push(value);
      return value;
    },
  };
  const director = new JobDirector(agent, {
    store,
    getSnapshot: () => familyDeliverySnapshot(agent),
    now: () => 10_000,
    executeCommand: () => execution.promise,
  });
  director.submit(createWorkOrder({
    id: 'family-cancelled-order',
    role: 'lumberjack',
    kind: 'harvest',
    source: 'player',
    requester: 'Director',
    target: { name: 'logs' },
    quota: 3,
  }));
  director.activeOrder = { ...director.activeOrder, phase: 'deliver' };

  director.update();
  await settle();
  assert.equal(director.inFlight, true);

  assert.equal(director.cancel('operator stop command'), true);
  agent.bot.inventory.slots = [{ name: 'oak_log', count: 2 }];
  agent.last_action_result = familyDeliveryResult({ actionId: 'family-cancelled-action' });
  execution.resolve(false);
  await settle();
  await settle();

  assert.equal(director.activeOrder, null);
  assert.equal(director.lastOrder.phase, 'cancelled');
  assert.equal(director.lastOrder.checkpoint.delivered, 2);
  assert.equal(director.lastOrder.evidence.code, 'cancelled_after_verified_transfer');
  assert.equal(director.snapshot().code, 'job_cancelled');
  assert.equal(director.inFlight, false);
  assert.equal(director.activeDispatch, null);
  assert.equal(director.nextAttemptAt, 0);
  assert.equal(store.saved.at(-1), null);
  assert.deepEqual(handoffs, [{
    outcomeId: 'family-cancelled-order',
    owner: 'player_job',
    phase: 'cancelled',
    code: 'job_cancelled',
  }]);
});

test('Given a legacy Operator Stop receipt, the exact player work order re-arms without losing its checkpoint or budgets', () => {
  const agent = createAgent('builder');
  const store = memoryStore();
  const director = new JobDirector(agent, { store, now: () => 20_000 });
  const accepted = director.submit(createWorkOrder({
    id: 'operator-stopped-builder',
    role: 'builder',
    kind: 'stockpile',
    source: 'player',
    requester: 'Director',
    target: { name: 'cobblestone' },
    quota: 16,
  }));
  assert.equal(accepted.accepted, true);
  director.activeOrder = {
    ...director.activeOrder,
    phase: 'acquire',
    attempts: 2,
    recoveries: 1,
    checkpoint: { ...director.activeOrder.checkpoint, collected: 7 },
  };

  assert.equal(director.cancel('operator stop command'), true);
  const resumed = director.resumeOperatorStoppedOrder('operator-stopped-builder');

  assert.deepEqual(resumed, {
    accepted: true,
    code: 'operator_stop_resumed',
    id: 'operator-stopped-builder',
  });
  assert.equal(director.activeOrder.phase, 'assess');
  assert.equal(director.activeOrder.attempts, 2);
  assert.equal(director.activeOrder.recoveries, 1);
  assert.equal(director.activeOrder.checkpoint.collected, 7);
  assert.equal(director.activeOrder.evidence.code, 'operator_stop_resumed');
  assert.equal(director.lastReceipt, null);
  assert.equal(store.saved.at(-1).id, 'operator-stopped-builder');
});

test('Given replacement order B, late settlement from cancelled order A cannot mutate or release B', async () => {
  const agent = familyDeliveryAgent();
  const store = memoryStore();
  const executionA = deferred();
  const executionB = deferred();
  let dispatchCount = 0;
  const director = new JobDirector(agent, {
    store,
    getSnapshot: () => familyDeliverySnapshot(agent),
    now: () => 10_000,
    executeCommand: () => {
      dispatchCount += 1;
      return dispatchCount === 1 ? executionA.promise : executionB.promise;
    },
  });
  const submitDeliveryOrder = id => {
    director.submit(createWorkOrder({
      id,
      role: 'lumberjack',
      kind: 'harvest',
      source: 'player',
      requester: 'Director',
      target: { name: 'logs' },
      quota: 3,
    }));
    director.activeOrder = { ...director.activeOrder, phase: 'deliver' };
  };

  submitDeliveryOrder('family-order-a');
  director.update();
  await settle();
  assert.equal(director.activeDispatch.orderId, 'family-order-a');

  director.cancel('replace order A');
  submitDeliveryOrder('family-order-b');
  director.update();
  await settle();
  const dispatchB = director.activeDispatch;
  assert.equal(dispatchB.orderId, 'family-order-b');
  assert.equal(director.inFlight, true);

  agent.bot.inventory.slots = [{ name: 'oak_log', count: 2 }];
  agent.last_action_result = familyDeliveryResult({ actionId: 'family-order-a-action' });
  executionA.resolve(false);
  await settle();
  await settle();

  assert.equal(director.activeOrder.id, 'family-order-b');
  assert.equal(director.activeOrder.phase, 'deliver');
  assert.equal(director.activeDispatch, dispatchB);
  assert.equal(director.inFlight, true);
  assert.equal(store.saved.at(-1).id, 'family-order-b');

  agent.bot.inventory.slots = [{ name: 'oak_log', count: 1 }];
  agent.last_action_result = familyDeliveryResult({
    actionId: 'family-order-b-action',
    complete: true,
  });
  executionB.resolve(true);
  await settle();
  await settle();

  assert.equal(director.activeOrder, null);
  assert.equal(director.lastOrder.id, 'family-order-b');
  assert.equal(director.lastOrder.phase, 'complete');
  assert.equal(store.saved.at(-1), null);
  assert.equal(director.inFlight, false);
  assert.equal(director.activeDispatch, null);
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

test('A verified accessory alternative rebinds the durable structure without spending an attempt', () => {
  const agent = createAgent('builder');
  agent.bot.registry = {
    itemsByName: {
      brown_bed: { id: 1, name: 'brown_bed' },
      brown_wool: { id: 2, name: 'brown_wool' },
      oak_planks: { id: 3, name: 'oak_planks' },
      white_bed: { id: 4, name: 'white_bed' },
      white_wool: { id: 5, name: 'white_wool' },
    },
    items: {
      1: { id: 1, name: 'brown_bed' },
      2: { id: 2, name: 'brown_wool' },
      3: { id: 3, name: 'oak_planks' },
      4: { id: 4, name: 'white_bed' },
      5: { id: 5, name: 'white_wool' },
    },
    blocksByName: {
      brown_bed: { id: 10, name: 'brown_bed' },
      white_bed: { id: 11, name: 'white_bed' },
    },
    recipes: {
      1: [{ inShape: [[2, 2, 2], [3, 3, 3]], result: { id: 1, count: 1 } }],
      4: [{ inShape: [[5, 5, 5], [3, 3, 3]], result: { id: 4, count: 1 } }],
    },
  };
  const remembered = [];
  agent.home_state = { rememberStructure: order => remembered.push(order) };
  const director = new JobDirector(agent, {
    store: memoryStore(),
    getSnapshot: () => ({ inventory: {} }),
    now: () => 10_000,
  });
  director.submit(createWorkOrder({
    id: 'alternative-bed',
    role: 'builder',
    kind: 'build',
    source: 'player',
    requester: 'Director',
    phase: 'acquire',
    target: { name: 'construction_site', x: 0, y: 64, z: 0 },
    quota: 1,
    checkpoint: { acquisitionRequirement: { target: 'white_bed', quantity: 1 } },
    blueprint: {
      id: 'alternative_bed',
      width: 1,
      depth: 1,
      height: 1,
      cells: [{
        x: 0,
        y: 0,
        z: 0,
        material: 'white_bed',
        materialFamily: 'bed',
      }],
    },
  }));

  const accepted = director.acceptStructureMaterialAlternative(director.activeOrder, {
    actionId: 'harvest-alternative-1',
    phase: 'failed',
    code: 'skill_alternative_source_observed',
    retryable: false,
    evidence: {
      skill: {
        kind: 'entity_harvest',
        outcome: 'alternative_source_observed',
        alternativeOutput: 'brown_wool',
      },
    },
  }, { reassess: true });

  assert.equal(accepted, true);
  assert.equal(director.activeOrder.phase, 'acquire');
  assert.equal(director.activeOrder.attempts, 0);
  assert.equal(director.activeOrder.blueprint.cells[0].material, 'brown_bed');
  assert.deepEqual(director.activeOrder.checkpoint.acquisitionRequirement, {
    target: 'brown_bed',
    quantity: 1,
  });
  assert.equal(director.activeOrder.evidence.code, 'material_alternative_bound');
  assert.equal(remembered.at(-1).blueprint.cells[0].material, 'brown_bed');

  agent.bot.inventory.items = () => [{ name: 'brown_wool', count: 2 }];
  const deferred = director.acceptStructureMaterialAlternative(director.activeOrder, {
    actionId: 'harvest-alternative-2',
    phase: 'failed',
    code: 'skill_alternative_source_observed',
    retryable: false,
    evidence: {
      skill: {
        kind: 'entity_harvest',
        outcome: 'alternative_source_observed',
        alternativeOutput: 'white_wool',
      },
    },
  }, { reassess: true });
  assert.equal(deferred, true);
  assert.equal(director.activeOrder.phase, 'acquire');
  assert.equal(director.activeOrder.blueprint.cells[0].material, 'brown_bed');
  assert.deepEqual(director.activeOrder.checkpoint.acquisitionRequirement, {
    target: 'brown_bed',
    quantity: 1,
  });
  assert.equal(director.activeOrder.evidence.code, 'material_alternative_deferred');
  assert.equal(director.activeOrder.checkpoint.acquisitionVariantCommitted, true);

  director.persist({
    ...director.activeOrder,
    phase: 'recover',
    checkpoint: {
      ...director.activeOrder.checkpoint,
      failedMethods: ['collect:closed_eyeblossom->closed_eyeblossom'],
    },
  });
  assert.equal(remembered.at(-1).phase, 'recover');
  assert.deepEqual(
    remembered.at(-1).checkpoint.failedMethods,
    ['collect:closed_eyeblossom->closed_eyeblossom'],
  );
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

test('Given a satisfied state-only prerequisite, JobDirector persists it before selecting the next physical step', () => {
  const agent = createAgent('builder');
  const director = new JobDirector(agent, {
    store: memoryStore(),
    getSnapshot: () => ({
      x: 10,
      y: 70,
      z: -20,
      inventory: {},
      foodPoints: 20,
      hunger: 20,
      freeSlots: 20,
      blueprintAudit: { valid: true, correct: 1, missing: [], incorrect: [] },
    }),
    now: () => 10_000,
  });
  director.submit(createWorkOrder({
    id: 'state-only-transition',
    role: 'builder',
    kind: 'build',
    source: 'player',
    requester: 'Director',
    phase: 'execute',
    target: { name: 'construction_site', x: 10, y: 70, z: -20 },
    blueprint: {
      id: 'single_block',
      width: 1,
      depth: 1,
      height: 1,
      cells: [{ x: 0, y: 0, z: 0, material: 'stone' }],
    },
    checkpoint: { accessRequirement: { kind: 'surface' } },
    evidence: { code: 'skill_surface_reached', detail: '', actionId: 'surface-1' },
  }));

  director.update();

  assert.equal(director.activeOrder, null);
  assert.equal(director.lastOrder.phase, 'complete');
  assert.equal(director.lastOrder.checkpoint.accessRequirement, undefined);
});
