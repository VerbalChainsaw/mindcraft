import assert from 'node:assert/strict';
import test from 'node:test';

import { Agent } from '../../src/agent/agent.js';
import { getCommand } from '../../src/agent/commands/index.js';
import { AgendaDirector } from '../../src/agent/runtime/agenda-director.js';

test('an ordered item plan is validated and persisted atomically before execution', () => {
  let saved = [];
  let wakes = 0;
  let submittedGoal = null;
  const store = {
    lastError: null,
    load: () => [],
    save(entries) { saved = entries.map(entry => ({ ...entry })); },
  };
  const agent = {
    name: 'TestBot',
    bot: { inventory: { slots: [{ name: 'oak_log', count: 12 }] } },
    behavior_arbiter: { wake() { wakes += 1; } },
    goal_director: {
      submit(goal) {
        submittedGoal = goal;
        return { accepted: true, id: goal.id };
      },
    },
  };
  const director = new AgendaDirector(agent, { store, now: () => 9_000 });
  agent.agenda_director = director;

  const command = getCommand('!queueItemPlan');
  const accepted = command.perform(agent, 'logs:8|planks:16', 'Gabriel', true);
  assert.match(accepted, /durable 4-step item plan/i);
  assert.deepEqual(director.entries.map(entry => [entry.kind, entry.target, entry.quantity, entry.recipient]), [
    ['acquire', 'logs', 8, ''],
    ['acquire', 'planks', 16, ''],
    ['inventory_checklist', '', 0, ''],
    ['goto', '', 0, 'Gabriel'],
  ]);
  assert.deepEqual(director.entries[2].inventoryRequirements, [
    { target: 'logs', quantity: 8 },
    { target: 'planks', quantity: 16 },
  ]);
  assert.deepEqual(director.entries.slice(0, 2).map(entry => entry.quantityMode), ['minimum', 'minimum']);
  assert.equal(director.dispatch(director.entries[0]).accepted, true);
  assert.equal(submittedGoal.quantityMode, 'minimum');
  assert.equal(submittedGoal.checkpoint.baselineInventory, 12);
  assert.equal(submittedGoal.checkpoint.targetInventory, 8, 'fresh inventory satisfies a compiled floor without requesting eight more');
  assert.equal(saved.length, 4);
  assert.equal(wakes, 1);
  assert.deepEqual(agent.last_agenda_plan_submission, {
    generation: 1,
    requestId: null,
    selectedSkill: null,
    accepted: true,
    code: 'item_plan_accepted',
    entryIds: director.entries.map(entry => entry.id),
  });

  const before = JSON.stringify(director.entries);
  const rejected = director.addMany([
    { kind: 'acquire', requester: 'Gabriel', target: 'logs', quantity: 1 },
    { kind: 'not_real', requester: 'Gabriel', target: 'stone', quantity: 1 },
  ]);
  assert.equal(rejected.accepted, false);
  assert.equal(JSON.stringify(director.entries), before, 'a malformed later step must not publish a partial plan');
});

test('a final inventory checklist repairs a floor consumed by a later step and re-verifies the aggregate', () => {
  let now = 20_000;
  let saved = [];
  let submittedGoal = null;
  const bot = {
    inventory: { slots: [{ name: 'coal', count: 4 }, { name: 'torch', count: 16 }] },
  };
  const goalDirector = {
    activeGoal: null,
    lastGoal: null,
    submit(goal) {
      submittedGoal = goal;
      this.activeGoal = goal;
      return { accepted: true, id: goal.id };
    },
  };
  const agent = {
    name: 'TestBot',
    bot,
    actions: { executing: false },
    job_director: { activeOrder: null },
    goal_director: goalDirector,
    isOperatorHeld: () => false,
  };
  const director = new AgendaDirector(agent, {
    now: () => now,
    resolveTarget: (_bot, name) => ({
      requestedName: name,
      canonicalName: name,
      inventoryName: name,
      acquisitionName: name,
      acquisitionKind: 'planned',
    }),
    store: {
      lastError: null,
      load: () => [],
      save(entries) { saved = entries.map(entry => ({ ...entry })); },
    },
  });
  director.add({
    kind: 'inventory_checklist',
    requester: 'Gabriel',
    inventoryRequirements: [
      { target: 'coal', quantity: 8 },
      { target: 'torch', quantity: 16 },
    ],
  });

  director.update();
  assert.equal(director.activeEntry()?.kind, 'inventory_checklist');
  assert.equal(director.activeEntry()?.reconciliationTarget, 'coal');
  assert.equal(director.activeEntry()?.reconciliations, 1);
  assert.equal(submittedGoal.quantityMode, 'minimum');
  assert.equal(submittedGoal.quantity, 8);
  assert.equal(submittedGoal.checkpoint.baselineInventory, 4);
  assert.equal(submittedGoal.checkpoint.targetInventory, 8);

  bot.inventory.slots[0].count = 8;
  goalDirector.activeGoal = null;
  goalDirector.lastGoal = {
    ...submittedGoal,
    phase: 'complete',
    evidence: { code: 'inventory_verified', detail: 'Coal floor restored.' },
  };
  director.update();
  assert.equal(director.entries[0].state, 'pending', 'a correction completion rechecks rather than declaring the aggregate done');

  now += 1_000;
  director.update();
  assert.equal(director.entries[0].state, 'complete');
  assert.equal(director.entries[0].evidence.code, 'inventory_checklist_verified');
  assert.equal(saved.at(-1).state, 'complete');
});

// Drive Agent.dispatchPlayerAgenda against a minimal fake `this`, so the
// append / interrupt / takeover branching is verified without spinning a bot.
// The real directive resolver runs; the messages used resolve without a bot
// registry (mining, harvest, come-here).
function makeFakeAgent({ remaining = 0, stopResult = { stopped: true } } = {}) {
  const calls = {
    added: [],
    cleared: 0,
    cancelResume: 0,
    goalCancel: 0,
    jobCancel: 0,
    directiveCleared: 0,
    selfPromptInterrupt: 0,
    roleDefer: 0,
    stop: 0,
    operatorHoldReleased: 0,
    operatorHoldSet: 0,
    responses: [],
  };
  const agent = {
    name: 'TestBot',
    runtime: { role: 'companion' },
    bot: {},
    agenda_director: {
      add(entry) {
        calls.added.push(entry);
        return {
          accepted: true,
          id: `agenda-test-${calls.added.length}`,
          description: `${entry.kind} ${entry.target || entry.recipient || ''}`.trim(),
        };
      },
      clear() { calls.cleared += 1; return { cleared: remaining }; },
      snapshot() { return { remaining }; },
    },
    history: { add() {}, save() {} },
    actions: { cancelResume() { calls.cancelResume += 1; }, async stop() { calls.stop += 1; return stopResult; } },
    goal_director: { cancel() { calls.goalCancel += 1; } },
    job_director: { cancel() { calls.jobCancel += 1; } },
    companion_context: { setDirective() { calls.directiveCleared += 1; } },
    self_prompter: { interruptForManualCommand() { calls.selfPromptInterrupt += 1; } },
    role_director: { deferForManualCommand() { calls.roleDefer += 1; } },
    releaseOperatorHold() { calls.operatorHoldReleased += 1; },
    holdPosition() { calls.operatorHoldSet += 1; },
    routeResponse(_source, message) { calls.responses.push(message); },
  };
  return { agent, calls };
}

test('dispatchPlayerAgenda queues a fresh multi-step plan and takes over the body', async () => {
  const { agent, calls } = makeFakeAgent({ remaining: 0 });
  const handled = await Agent.prototype.dispatchPlayerAgenda.call(agent, 'Gabriel', 'Gabriel', 'mine 10 iron then come here');
  assert.equal(handled, true);
  assert.equal(calls.added.length, 2);
  // Fresh plan => takeover frees the body for the agenda.
  assert.equal(calls.cancelResume, 1);
  assert.equal(calls.directiveCleared, 1);
  assert.equal(calls.stop, 1);
  assert.equal(calls.cleared, 0, 'append must not clear the queue');
  assert.match(calls.responses[0], /Queued 2 steps/);
});

test('dispatchPlayerAgenda rejects the whole plan when the prior action does not settle', async () => {
  const { agent, calls } = makeFakeAgent({
    remaining: 0,
    stopResult: { stopped: false, timedOut: true },
  });
  const handled = await Agent.prototype.dispatchPlayerAgenda.call(
    agent,
    'Gabriel',
    'Gabriel',
    'mine 10 iron then come here',
  );
  assert.equal(handled, true);
  assert.equal(calls.added.length, 0);
  assert.equal(calls.operatorHoldSet, 1);
  assert.match(calls.responses[0], /did not queue or start/i);
});

test('dispatchPlayerAgenda interrupt clears the queue and preempts', async () => {
  const { agent, calls } = makeFakeAgent({ remaining: 2 });
  const handled = await Agent.prototype.dispatchPlayerAgenda.call(agent, 'Gabriel', 'Gabriel', 'stop, mine 10 iron then come here');
  assert.equal(handled, true);
  assert.equal(calls.cleared, 1, 'interrupt clears the existing queue');
  assert.equal(calls.stop, 1, 'interrupt preempts the current action');
  assert.equal(calls.added.length, 2);
  assert.match(calls.responses[0], /new plan/i);
});

test('dispatchPlayerAgenda appends onto a running agenda without preempting it', async () => {
  const { agent, calls } = makeFakeAgent({ remaining: 1 });
  const handled = await Agent.prototype.dispatchPlayerAgenda.call(agent, 'Gabriel', 'Gabriel', 'also mine 5 coal');
  assert.equal(handled, true);
  assert.equal(calls.added.length, 1);
  // Running agenda => no takeover, no preemption, no clear.
  assert.equal(calls.stop, 0);
  assert.equal(calls.cancelResume, 0);
  assert.equal(calls.cleared, 0);
});

test('dispatchPlayerAgenda ignores an ordinary lone task but retains a construction contract', async () => {
  const { agent, calls } = makeFakeAgent({ remaining: 0 });
  const handled = await Agent.prototype.dispatchPlayerAgenda.call(agent, 'Gabriel', 'Gabriel', 'mine 10 iron');
  assert.equal(handled, false, 'a single task with no chain stays on the single-directive path');
  assert.equal(calls.added.length, 0);
  assert.equal(calls.stop, 0);

  const construction = makeFakeAgent({ remaining: 0 });
  const outcome = await Agent.prototype.dispatchPlayerAgenda.call(
    construction.agent,
    'Gabriel',
    'Gabriel',
    'Build a fenced animal pen with a working gate and lighting.',
  );
  assert.equal(construction.calls.added.length, 1);
  assert.deepEqual(construction.calls.added[0].constructionIntent.requiredFunctions, [
    'access',
    'containment',
    'interior_light',
  ]);
  assert.equal(outcome.deferredConstruction.entryId, 'agenda-test-1');
});

test('dispatchPlayerAgenda queues a construction barrier and returns it for model binding', async () => {
  const { agent, calls } = makeFakeAgent({ remaining: 0 });
  const outcome = await Agent.prototype.dispatchPlayerAgenda.call(
    agent,
    'Gabriel',
    'Gabriel',
    'Build a small safe overnight outpost with windows and a bed, then go inside and sleep.',
  );

  assert.deepEqual(calls.added.map(entry => entry.kind), ['construction', 'sleep']);
  assert.equal(outcome.deferredConstruction.entryId, 'agenda-test-1');
  assert.match(outcome.deferredConstruction.modelInstruction, /bounded blueprint/i);
  assert.match(outcome.deferredConstruction.modelInstruction, /bed occupies its anchor plus one block/i);
  assert.equal(calls.operatorHoldReleased, 0, 'Stop remains held until the exact Builder order is bound');
});

test('a bound construction barrier releases sleep only after the exact Builder completion', async () => {
  let now = 60_000;
  let persisted = [];
  const commands = [];
  const order = {
    id: 'builder-outpost-1',
    phase: 'acquire',
    evidence: { code: 'materials_required', detail: '' },
  };
  const agent = {
    name: 'TestBot',
    last_action_result: null,
    actions: { executing: false },
    goal_director: { activeGoal: null },
    job_director: { activeOrder: order, lastOrder: null },
  };
  const store = {
    lastError: null,
    load: () => JSON.parse(JSON.stringify(persisted)),
    save(entries) { persisted = JSON.parse(JSON.stringify(entries)); },
  };
  const executeCommand = (_agent, command, options) => {
    commands.push(command);
    agent.last_action_result = {
      actionId: 'sleep-complete',
      phase: 'succeeded',
      code: 'skill_slept',
      detail: 'Slept in the verified bed.',
      retryable: false,
      evidence: { request: { routeOrigin: options.routeOrigin } },
    };
    return Promise.resolve();
  };
  let director = new AgendaDirector(agent, { store, executeCommand, now: () => now });
  const construction = director.add({ kind: 'construction', requester: 'Gabriel' });
  const sleep = director.add({ kind: 'sleep', requester: 'Gabriel' });

  assert.equal(director.bindConstruction(construction.id, order.id).accepted, true);
  assert.equal(director.entries.find(entry => entry.id === construction.id).executorId, order.id);
  assert.equal(commands.length, 0);

  director = new AgendaDirector(agent, { store, executeCommand, now: () => now });
  assert.equal(director.entries.find(entry => entry.id === construction.id).state, 'active');
  assert.equal(director.entries.find(entry => entry.id === construction.id).executorId, order.id);
  assert.equal(director.entries.find(entry => entry.id === sleep.id).state, 'pending');

  agent.job_director.activeOrder = null;
  agent.job_director.lastOrder = {
    ...order,
    phase: 'complete',
    evidence: { code: 'blueprint_complete', detail: 'Outpost verified.' },
  };
  agent.job_director.lastReceipt = {
    orderId: order.id,
    dimension: 'overworld',
    structure: {
      fixtures: [{
        id: 'bed_1',
        function: 'rest',
        material: 'red_bed',
        facing: 'south',
        position: { x: 10, y: 64, z: 20 },
      }],
    },
  };
  director.update();
  assert.equal(director.entries.find(entry => entry.id === construction.id).state, 'complete');
  assert.equal(director.entries.find(entry => entry.id === sleep.id).state, 'pending');

  now += 1_000;
  director.update();
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(commands, ['!goToBedAt(10, 64, 20, "overworld")']);
  assert.equal(director.entries.find(entry => entry.id === sleep.id).state, 'complete');
});

test('daylight keeps an exact sleep step waiting without spending attempts, including legacy restart repair', async () => {
  let now = 100_000;
  let dispatches = 0;
  const agent = {
    name: 'TestBot',
    bot: { time: { timeOfDay: 6_000 }, isRaining: false, thunderState: 0 },
    last_action_result: null,
    actions: { executing: false },
    goal_director: { activeGoal: null },
    job_director: { activeOrder: null, lastOrder: null },
  };
  const store = { lastError: null, load: () => [], save() {} };
  const executeCommand = (_agent, _command, options) => {
    dispatches += 1;
    agent.last_action_result = dispatches === 1
      ? {
          actionId: 'sleep-daylight',
          phase: 'failed',
          code: 'skill_not_sleep_time',
          detail: 'It is not night and not a thunderstorm.',
          retryable: true,
          evidence: { request: { routeOrigin: options.routeOrigin } },
        }
      : {
          actionId: 'sleep-night',
          phase: 'succeeded',
          code: 'skill_slept',
          detail: 'Slept in the verified bed.',
          retryable: false,
          evidence: { request: { routeOrigin: options.routeOrigin } },
        };
    return Promise.resolve();
  };
  const director = new AgendaDirector(agent, { store, executeCommand, now: () => now });
  const added = director.add({ kind: 'sleep', requester: 'Gabriel' });

  director.update();
  await new Promise(resolve => setImmediate(resolve));

  let sleep = director.entries.find(entry => entry.id === added.id);
  assert.equal(sleep.state, 'pending');
  assert.equal(sleep.attempts, 0, 'daylight is not a productive sleep attempt');
  assert.equal(sleep.evidence.code, 'skill_not_sleep_time');

  now += 6_000;
  director.update();
  assert.equal(dispatches, 1, 'daylight must not repeatedly touch the bed');
  assert.equal(director.status.code, 'agenda_world_condition_pending');

  agent.bot.time.timeOfDay = 13_000;
  now += 6_000;
  director.update();
  await new Promise(resolve => setImmediate(resolve));
  sleep = director.entries.find(entry => entry.id === added.id);
  assert.equal(dispatches, 2);
  assert.equal(sleep.state, 'complete');
  assert.equal(sleep.attempts, 1);

  let repaired = null;
  const legacyStore = {
    lastError: null,
    load: () => [{
      id: 'agenda-legacy-sleep',
      kind: 'sleep',
      requester: 'Gabriel',
      state: 'failed',
      attempts: 2,
      finishedAt: 90_000,
      dependsOnEntryId: 'agenda-legacy-construction',
      dependencyPolicy: 'requires_success',
      bindingRequest: { kind: 'structure_fixture', function: 'rest' },
      bindingConstraint: {
        kind: 'structure_fixture',
        function: 'rest',
        fixtureId: 'bed_1',
        structureOrderId: 'builder-legacy-outpost',
        position: { x: 10, y: 64, z: 20 },
        dimension: 'overworld',
        material: 'red_bed',
        facing: 'south',
        sourceEntryId: 'agenda-legacy-construction',
      },
      evidence: { code: 'skill_not_sleep_time', detail: 'Daylight.' },
    }, {
      id: 'agenda-legacy-unconfirmed-sleep',
      kind: 'sleep',
      requester: 'Gabriel',
      state: 'failed',
      attempts: 1,
      finishedAt: 95_000,
      dependsOnEntryId: 'agenda-legacy-construction',
      dependencyPolicy: 'requires_success',
      bindingRequest: { kind: 'structure_fixture', function: 'rest' },
      bindingConstraint: {
        kind: 'structure_fixture',
        function: 'rest',
        fixtureId: 'bed_1',
        structureOrderId: 'builder-legacy-outpost',
        position: { x: 10, y: 64, z: 20 },
        dimension: 'overworld',
        material: 'red_bed',
        facing: 'south',
        sourceEntryId: 'agenda-legacy-construction',
      },
      evidence: { code: 'skill_sleep_not_confirmed', detail: 'The old primitive missed instant dawn.' },
    }],
    save(entries) { repaired = JSON.parse(JSON.stringify(entries)); },
  };
  const legacy = new AgendaDirector(agent, { store: legacyStore, now: () => now });
  const rearmed = legacy.entries[0];
  assert.equal(rearmed.state, 'pending');
  assert.equal(rearmed.attempts, 0);
  assert.equal(rearmed.bindingConstraint.structureOrderId, 'builder-legacy-outpost');
  assert.equal(repaired[0].state, 'pending', 'legacy repair must be durable before redispatch');
  const rearmedUnconfirmed = legacy.entries[1];
  assert.equal(rearmedUnconfirmed.state, 'pending');
  assert.equal(rearmedUnconfirmed.attempts, 1, 'ambiguous activation keeps its productive attempt');
  assert.equal(rearmedUnconfirmed.bindingConstraint.structureOrderId, 'builder-legacy-outpost');
});

test('a restored active construction re-arms only its exact legacy Operator-stopped executor', () => {
  let persisted = [];
  const store = {
    lastError: null,
    load: () => JSON.parse(JSON.stringify(persisted)),
    save(entries) { persisted = JSON.parse(JSON.stringify(entries)); },
  };
  const order = { id: 'builder-operator-stopped', phase: 'acquire', evidence: {} };
  const agent = {
    name: 'TestBot',
    operator_hold_reason: '',
    actions: { executing: false },
    goal_director: { activeGoal: null },
    job_director: { activeOrder: order, lastOrder: null },
    isOperatorHeld: () => false,
  };
  let director = new AgendaDirector(agent, { store, now: () => 65_000 });
  const construction = director.add({ kind: 'construction', requester: 'Gabriel' });
  assert.equal(director.bindConstruction(construction.id, order.id).accepted, true);

  const resumeCalls = [];
  agent.operator_hold_reason = 'operator stop command';
  agent.isOperatorHeld = () => true;
  agent.job_director = {
    activeOrder: null,
    lastOrder: { ...order, phase: 'cancelled' },
    resumeOperatorStoppedOrder(orderId) {
      resumeCalls.push(orderId);
      this.activeOrder = { ...order, phase: 'assess' };
      return { accepted: true, code: 'operator_stop_resumed', id: orderId };
    },
  };

  director = new AgendaDirector(agent, { store, now: () => 66_000 });

  assert.deepEqual(resumeCalls, ['builder-operator-stopped']);
  assert.equal(agent.job_director.activeOrder.id, 'builder-operator-stopped');
  assert.equal(director.activeEntry().executorId, 'builder-operator-stopped');
});

test('a failed construction barrier blocks its dependent sleep step', () => {
  const order = { id: 'builder-outpost-failed', phase: 'acquire', evidence: {} };
  const agent = {
    name: 'TestBot',
    actions: { executing: false },
    goal_director: { activeGoal: null },
    job_director: { activeOrder: order, lastOrder: null },
  };
  const director = new AgendaDirector(agent, {
    store: { lastError: null, load: () => [], save() {} },
    now: () => 70_000,
  });
  const construction = director.add({ kind: 'construction', requester: 'Gabriel' });
  const sleep = director.add({ kind: 'sleep', requester: 'Gabriel' });
  director.bindConstruction(construction.id, order.id);
  agent.job_director.activeOrder = null;
  agent.job_director.lastOrder = {
    ...order,
    phase: 'failed',
    evidence: { code: 'material_unavailable', detail: 'Could not finish.' },
  };

  director.update();

  assert.equal(director.entries.find(entry => entry.id === construction.id).state, 'failed');
  assert.equal(director.entries.find(entry => entry.id === sleep.id).state, 'failed');
  assert.equal(
    director.entries.find(entry => entry.id === sleep.id).evidence.code,
    'agenda_dependency_failed',
  );

  agent.job_director.activeOrder = { ...order, phase: 'assess' };
  agent.job_director.lastOrder = null;
  const resumed = director.resumeConstructionContinuation(order.id);

  assert.deepEqual(resumed, {
    resumed: true,
    code: 'construction_resumed',
    id: construction.id,
    executorId: order.id,
  });
  assert.equal(director.entries.find(entry => entry.id === construction.id).state, 'active');
  assert.equal(director.entries.find(entry => entry.id === construction.id).executorId, order.id);
  assert.equal(director.entries.find(entry => entry.id === sleep.id).state, 'pending');
  assert.equal(
    director.entries.find(entry => entry.id === sleep.id).evidence.code,
    'agenda_dependency_resumed',
  );
});

test('a restart fails closed when construction compilation never bound a durable Builder order', () => {
  let persisted = [];
  const store = {
    lastError: null,
    load: () => JSON.parse(JSON.stringify(persisted)),
    save(entries) { persisted = JSON.parse(JSON.stringify(entries)); },
  };
  const agent = {
    name: 'TestBot',
    actions: { executing: false },
    goal_director: { activeGoal: null },
    job_director: { activeOrder: null, lastOrder: null },
  };
  let director = new AgendaDirector(agent, { store, now: () => 80_000 });
  const construction = director.add({
    kind: 'construction',
    requester: 'Gabriel',
    constructionIntent: { requiredFunctions: ['enclosure', 'weather_cover', 'rest'] },
  });
  const sleep = director.add({ kind: 'sleep', requester: 'Gabriel' });
  assert.equal(director.beginConstructionCompilation(construction.id).accepted, true);

  director = new AgendaDirector(agent, { store, now: () => 81_000 });
  assert.equal(director.entries.find(entry => entry.id === construction.id).state, 'failed');
  assert.equal(director.entries.find(entry => entry.id === construction.id).assignmentState, 'interrupted');
  assert.equal(director.entries.find(entry => entry.id === sleep.id).state, 'failed');
  assert.equal(
    director.entries.find(entry => entry.id === sleep.id).evidence.code,
    'agenda_dependency_failed',
  );
});

test('a new sleep request does not inherit a completed legacy construction job', () => {
  const agent = {
    name: 'TestBot',
    actions: { executing: false },
    goal_director: { activeGoal: null },
    job_director: { activeOrder: null, lastOrder: null },
  };
  const director = new AgendaDirector(agent, {
    store: { lastError: null, load: () => [], save() {} },
    now: () => 90_000,
  });
  const construction = director.add({ kind: 'construction', requester: 'Gabriel' });
  director.replace(construction.id, {
    state: 'complete',
    assignmentState: 'accepted_and_bound',
    executorId: 'builder-old-outpost',
    finishedAt: 89_000,
  });

  const sleep = director.add({ kind: 'sleep', requester: 'Gabriel' });
  const entry = director.entries.find(candidate => candidate.id === sleep.id);
  assert.equal(entry.dependsOnEntryId, '');
  assert.equal(entry.bindingRequest, null);
});

test('agenda acquire snapshots current family inventory for each dispatched step', () => {
  let submittedGoal = null;
  const target = Object.freeze({
    requestedName: 'logs',
    canonicalName: 'oak_log',
    inventoryName: 'oak_log',
    acquisitionName: 'oak_log',
    family: 'logs',
    acquisitionKind: 'collect_family',
  });
  const agent = {
    name: 'TestBot',
    bot: {
      inventory: {
        slots: [
          { name: 'oak_log', count: 2 },
          { name: 'spruce_log', count: 3 },
          { name: 'cobblestone', count: 12 },
        ],
      },
    },
    goal_director: {
      submit(goal) {
        submittedGoal = goal;
        return { accepted: true };
      },
    },
  };
  const store = {
    lastError: null,
    load: () => [],
    save() {},
  };
  const director = new AgendaDirector(agent, { store, resolveTarget: () => target });
  const added = director.add({ kind: 'acquire', requester: 'Gabriel', target: 'logs', quantity: 2 });

  assert.equal(added.accepted, true);
  assert.deepEqual(director.dispatch(director.pending()[0]), { accepted: true });
  assert.equal(submittedGoal.checkpoint.baselineInventory, 5);
  assert.equal(submittedGoal.checkpoint.targetInventory, 7);
});

test('a stale unrelated job result cannot settle a correlated active agenda job', () => {
  const saved = [];
  const agent = {
    name: 'TestBot',
    actions: { executing: false },
    goal_director: { activeGoal: null },
    job_director: {
      activeOrder: null,
      lastOrder: {
        id: 'job-stale-unrelated',
        phase: 'complete',
        evidence: { code: 'job_verified', detail: 'A different order completed.' },
      },
    },
  };
  const store = {
    lastError: null,
    load: () => [],
    save(entries) { saved.push(entries.map(entry => ({ ...entry }))); },
  };
  const director = new AgendaDirector(agent, { store, now: () => 42_000 });
  const added = director.add({ kind: 'mine', requester: 'Gabriel', target: 'iron_ore', quantity: 10 });
  director.replace(added.id, {
    state: 'active',
    startedAt: 41_000,
    executorId: 'job-current-agenda-entry',
  });

  director.update();

  const settled = director.entries.find(entry => entry.id === added.id);
  assert.equal(settled.state, 'failed');
  assert.equal(settled.attempts, 1);
  assert.equal(settled.evidence.code, 'agenda_job_result_mismatch');
  assert.equal(director.pending().length, 0, 'stale evidence must not trigger a retry');
  assert.equal(saved.at(-1).find(entry => entry.id === added.id)?.state, 'failed');
});

test('a terminal job cannot be replayed, but its after-settlement return still runs', async () => {
  const submitted = [];
  const directCommands = [];
  let acknowledged = null;
  let now = 43_000;
  const terminalOrder = {
    id: 'miner-terminal-expedition',
    phase: 'failed',
    evidence: {
      code: 'action_pattern_detected',
      detail: 'The bounded work order stopped after repeated no-progress actions.',
    },
  };
  const agent = {
    name: 'TestBot',
    last_action_result: { actionId: 'before', phase: 'succeeded', code: 'old_result' },
    actions: { executing: false },
    goal_director: { activeGoal: null },
    job_director: {
      activeOrder: null,
      lastOrder: terminalOrder,
      submit(order) {
        submitted.push(order);
        return { accepted: true, id: order.id };
      },
      acknowledgeTerminalReceipt(orderId) { acknowledged = orderId; },
    },
  };
  const store = { lastError: null, load: () => [], save() {} };
  const director = new AgendaDirector(agent, {
    store,
    now: () => now,
    executeCommand(_agent, command) {
      directCommands.push(command);
      agent.last_action_result = {
        actionId: 'return-after-failed-expedition',
        phase: 'succeeded',
        code: 'skill_arrived',
        detail: 'Returned to Gabriel after the expedition settled.',
        retryable: false,
        evidence: { request: { routeOrigin: 'agenda-director' } },
      };
      return Promise.resolve();
    },
  });
  const added = director.add({
    kind: 'explore',
    requester: 'Gabriel',
    target: 'ores',
    quantity: 8,
    x: 12,
    y: 70,
    z: 12,
    containerConstraint: {
      name: 'chest',
      position: { x: 14, y: 70, z: 12 },
      dimension: 'overworld',
    },
  });
  director.replace(added.id, {
    state: 'active',
    startedAt: 42_000,
    executorId: terminalOrder.id,
  });
  const returnStep = director.add({
    kind: 'goto',
    requester: 'Gabriel',
    recipient: 'Gabriel',
    dependsOnEntryId: added.id,
    dependencyPolicy: 'after_settlement',
  });

  director.update();
  now += 6_000;
  director.update();
  await new Promise(resolve => setImmediate(resolve));

  const settled = director.entries.find(entry => entry.id === added.id);
  assert.equal(settled.state, 'failed');
  assert.equal(settled.evidence.code, 'action_pattern_detected');
  assert.equal(settled.attempts, 1);
  assert.equal(submitted.length, 0, 'Agenda must not manufacture a second job ID or fresh attempt budget');
  assert.equal(acknowledged, terminalOrder.id);
  assert.deepEqual(directCommands, ['!goToPlayer("Gabriel", 3)']);
  assert.equal(director.entries.find(entry => entry.id === returnStep.id).state, 'complete');
});

test('an unrelated later action cannot replace the direct result captured for an agenda step', async () => {
  const agent = {
    name: 'TestBot',
    last_action_result: { actionId: 'before', phase: 'succeeded', code: 'old_result' },
    actions: { executing: false },
    goal_director: { activeGoal: null },
    job_director: { activeOrder: null },
  };
  const store = { lastError: null, load: () => [], save() {} };
  const executeCommand = (_agent, _command, options) => {
    assert.equal(options.routeOrigin, 'agenda-director');
    agent.last_action_result = {
      actionId: 'agenda-return',
      phase: 'failed',
      code: 'skill_player_unreachable',
      detail: 'The requested player could not be reached.',
      retryable: false,
      evidence: { request: { routeOrigin: 'agenda-director' } },
    };
    return Promise.resolve();
  };
  const director = new AgendaDirector(agent, { store, executeCommand });
  const added = director.add({ kind: 'goto', requester: 'Gabriel', recipient: 'Gabriel' });

  director.update();
  await new Promise(resolve => setImmediate(resolve));
  agent.last_action_result = {
    actionId: 'later-survival-reflex',
    phase: 'succeeded',
    code: 'skill_fall_landed',
  };
  director.update();

  const settled = director.entries.find(entry => entry.id === added.id);
  assert.equal(settled.state, 'failed');
  assert.equal(settled.evidence.code, 'skill_player_unreachable');
  assert.notEqual(settled.evidence.code, 'skill_fall_landed');
});

test('a direct Agenda result persists while Stop is held and is not repeated after restart', async () => {
  let held = false;
  let dispatches = 0;
  let persisted = [];
  let director = null;
  let terminalSavedWhileDispatching = false;
  const store = {
    lastError: null,
    load: () => persisted.map(entry => ({ ...entry })),
    save(entries) {
      persisted = entries.map(entry => ({ ...entry, evidence: { ...entry.evidence } }));
      if (persisted.some(entry => entry.state === 'complete')) {
        terminalSavedWhileDispatching = director?.dispatching === true;
      }
      return true;
    },
  };
  const agent = {
    name: 'TestBot',
    last_action_result: { actionId: 'before', phase: 'succeeded', code: 'old_result' },
    actions: { executing: false },
    goal_director: { activeGoal: null },
    job_director: { activeOrder: null },
    isOperatorHeld: () => held,
  };
  const executeCommand = () => {
    dispatches += 1;
    agent.last_action_result = {
      actionId: 'agenda-deposit-terminal',
      phase: 'succeeded',
      code: 'skill_deposited',
      detail: 'The exact deposit completed.',
      retryable: false,
      evidence: { request: { routeOrigin: 'agenda-director' } },
    };
    held = true;
    return Promise.resolve();
  };

  director = new AgendaDirector(agent, { store, executeCommand });
  director.add({ kind: 'deposit', requester: 'Gabriel', target: 'wheat', quantity: 12 });
  director.update();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(dispatches, 1);
  assert.equal(terminalSavedWhileDispatching, true, 'terminal state must be durable before dispatch ownership is released');
  assert.equal(persisted[0].state, 'complete');
  assert.equal(persisted[0].evidence.code, 'skill_deposited');

  held = false;
  director = new AgendaDirector(agent, {
    store,
    executeCommand: () => {
      dispatches += 1;
      throw new Error('A terminal direct step must not be replayed after restart.');
    },
  });
  director.update();

  assert.equal(dispatches, 1);
  assert.equal(director.entries[0].state, 'complete');
  assert.equal(director.entries[0].attempts, 1);
});

test('a retryable parent failure preserves its dependent and restart repairs the old contradiction', () => {
  let persisted = [];
  const store = {
    lastError: null,
    load: () => JSON.parse(JSON.stringify(persisted)),
    save(entries) {
      persisted = JSON.parse(JSON.stringify(entries));
      return true;
    },
  };
  const agent = {
    name: 'TestBot',
    actions: { executing: false },
    goal_director: { activeGoal: null },
    job_director: { activeOrder: null },
  };
  let director = new AgendaDirector(agent, { store, now: () => 45_000 });
  const parent = director.add({ kind: 'deposit', requester: 'Gabriel', target: 'iron_pickaxe', quantity: 1 });
  const dependent = director.add({
    kind: 'deposit',
    requester: 'Gabriel',
    target: 'iron_axe',
    quantity: 1,
    dependsOnEntryId: parent.id,
    dependencyPolicy: 'requires_success',
  });
  const laterDependent = director.add({
    kind: 'deposit',
    requester: 'Gabriel',
    target: 'iron_shovel',
    quantity: 1,
    dependsOnEntryId: dependent.id,
    dependencyPolicy: 'requires_success',
  });
  director.replace(parent.id, { state: 'active', startedAt: 44_000 });
  director.commitSettlement(
    director.entries.find(entry => entry.id === parent.id),
    {
      state: 'failed',
      code: 'skill_container_unreachable',
      detail: 'The first bounded approach failed.',
      retryable: true,
    },
  );

  assert.equal(director.entries.find(entry => entry.id === parent.id).state, 'pending');
  assert.equal(director.entries.find(entry => entry.id === dependent.id).state, 'pending');

  persisted = director.entries.map(entry => entry.id === parent.id
    ? { ...entry, state: 'complete', finishedAt: 45_100 }
    : entry.id === dependent.id || entry.id === laterDependent.id
      ? {
          ...entry,
          state: 'failed',
          finishedAt: 45_050,
          evidence: { code: 'agenda_dependency_failed', detail: 'Old contradictory settlement.' },
        }
      : entry);
  director = new AgendaDirector(agent, { store, now: () => 46_000 });

  const repaired = director.entries.find(entry => entry.id === dependent.id);
  const repairedLater = director.entries.find(entry => entry.id === laterDependent.id);
  assert.equal(repaired.state, 'pending');
  assert.equal(repaired.evidence.code, 'agenda_dependency_resumed');
  assert.equal(repairedLater.state, 'pending');
  assert.equal(repairedLater.evidence.code, 'agenda_dependency_resumed');
  assert.equal(persisted.find(entry => entry.id === dependent.id).state, 'pending');
  assert.equal(persisted.find(entry => entry.id === laterDependent.id).state, 'pending');
});

test('follow-until durably binds the designated furnace before a dependent smelt dispatch', async () => {
  let persisted = [];
  let director = null;
  let now = 50_000;
  let bindingSavedWhileDispatching = false;
  const commands = [];
  const designated = { x: -659, y: 71, z: -459 };
  const closerDecoy = { x: -658, y: 71, z: -459 };
  const store = {
    lastError: null,
    load: () => JSON.parse(JSON.stringify(persisted)),
    save(entries) {
      persisted = JSON.parse(JSON.stringify(entries));
      if (persisted[1]?.workstationConstraint) {
        bindingSavedWhileDispatching = director?.dispatching === true;
      }
      return true;
    },
  };
  const agent = {
    name: 'TestBot',
    last_action_result: { actionId: 'before', phase: 'succeeded', code: 'old_result' },
    actions: { executing: false },
    goal_director: { activeGoal: null },
    job_director: { activeOrder: null },
  };
  const executeCommand = (_agent, command) => {
    commands.push(command);
    if (command.startsWith('!followPlayerUntilNearBlock')) {
      agent.last_action_result = {
        actionId: 'follow-arrived-at-designated-furnace',
        phase: 'succeeded',
        code: 'skill_condition_reached',
        detail: 'Reached the player-designated furnace.',
        retryable: false,
        evidence: {
          request: { routeOrigin: 'agenda-director' },
          skill: {
            kind: 'follow',
            outcome: 'condition_reached',
            completion: {
              kind: 'shared_world_block',
              name: 'furnace',
              position: designated,
              dimension: 'minecraft:overworld',
            },
          },
        },
      };
    } else {
      assert.equal(
        command,
        `!smeltItem("raw_iron", 1, ${designated.x}, ${designated.y}, ${designated.z}, "minecraft:overworld")`,
        `the closer decoy at ${closerDecoy.x}, ${closerDecoy.y}, ${closerDecoy.z} must not replace the designated furnace`,
      );
      agent.last_action_result = {
        actionId: 'designated-furnace-changed',
        phase: 'failed',
        code: 'skill_exact_furnace_changed',
        detail: 'The designated furnace changed; no substitute was used.',
        retryable: false,
        evidence: { request: { routeOrigin: 'agenda-director' } },
      };
    }
    return Promise.resolve();
  };

  director = new AgendaDirector(agent, { store, executeCommand, now: () => now });
  const follow = director.add({
    kind: 'follow_until',
    requester: 'Gabriel',
    recipient: 'Gabriel',
    target: 'furnace',
    radius: 8,
  });
  director.add({ kind: 'smelt', requester: 'Gabriel', target: 'raw_iron', quantity: 1 });
  director.update();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(persisted[0].id, follow.id);
  assert.equal(persisted[0].state, 'complete');
  assert.deepEqual(persisted[1].workstationConstraint, {
    name: 'furnace',
    position: designated,
    dimension: 'minecraft:overworld',
    source: 'agenda_follow_until',
    observedAt: now,
    sourceEntryId: follow.id,
  });
  assert.equal(bindingSavedWhileDispatching, true, 'binding must be durable before direct ownership releases');

  now += 1_000;
  director = new AgendaDirector(agent, { store, executeCommand, now: () => now });
  director.update();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(commands.length, 2, 'a failed exact furnace must not trigger a nearest-furnace fallback');
  assert.equal(persisted[1].state, 'failed');
  assert.equal(persisted[1].evidence.code, 'skill_exact_furnace_changed');
});
