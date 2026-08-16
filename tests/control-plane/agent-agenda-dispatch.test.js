import assert from 'node:assert/strict';
import test from 'node:test';

import { Agent } from '../../src/agent/agent.js';
import { getCommand } from '../../src/agent/commands/index.js';
import { resolvePlayerDirective } from '../../src/agent/player-directives.js';
import { AgendaDirector } from '../../src/agent/runtime/agenda-director.js';

test('the central interrupt asks Mineflayer to wake a sleeping body', async () => {
  let wakeCalls = 0;
  const bot = {
    interrupt_code: false,
    isSleeping: true,
    wake() {
      wakeCalls += 1;
      return Promise.resolve();
    },
    pathfinder: { setGoal() {} },
    pvp: { stop() {} },
    clearControlStates() {},
  };

  Agent.prototype.requestInterrupt.call({ bot });
  await Promise.resolve();

  assert.equal(bot.interrupt_code, true);
  assert.equal(wakeCalls, 1);
});

test('typed access repair dispatches one ordinary exact Builder work order', () => {
  let submitted = null;
  const store = { lastError: null, load: () => [], save: () => true };
  const agent = {
    name: 'TestBot',
    bot: {},
    job_director: {
      submit(order) {
        submitted = order;
        return { accepted: true, id: order.id };
      },
    },
  };
  const director = new AgendaDirector(agent, { store, now: () => 10_000 });
  const accepted = director.add({
    kind: 'repair_access',
    requester: 'DadPlayer',
    target: 'cobblestone',
    quantity: 2,
    accessRepairConstraint: {
      kind: 'existing_access_surface',
      door: { x: 8105, y: 69, z: 7937 },
      facing: 'north',
      dimension: 'overworld',
      cells: [
        { x: 8105, y: 68, z: 7936 },
        { x: 8105, y: 68, z: 7935 },
      ],
      interiorStance: { x: 8105, y: 69, z: 7938 },
      exteriorStance: { x: 8105, y: 68, z: 7934 },
    },
  });

  assert.equal(accepted.accepted, true);
  const outcome = director.dispatch(director.entries[0]);
  assert.equal(outcome.accepted, true);
  assert.equal(submitted.role, 'builder');
  assert.equal(submitted.kind, 'build');
  assert.deepEqual(submitted.target, { name: 'access_repair', x: 8105, y: 68, z: 7935 });
  assert.equal(submitted.blueprint.cells.length, 2);
});

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
  const preflight = director.validateMany([
    { kind: 'mine', requester: 'DadPlayer', target: 'coal_ore', quantity: 4 },
    { kind: 'not_real', requester: 'DadPlayer', dependsOnPrevious: true },
  ]);
  assert.equal(preflight.accepted, false);
  assert.equal(JSON.stringify(director.entries), before, 'preflight is pure');
  assert.equal(saved.length, 4);
  const rejected = director.addMany([
    { kind: 'acquire', requester: 'Gabriel', target: 'logs', quantity: 1 },
    { kind: 'not_real', requester: 'Gabriel', target: 'stone', quantity: 1 },
  ]);
  assert.equal(rejected.accepted, false);
  assert.equal(JSON.stringify(director.entries), before, 'a malformed later step must not publish a partial plan');
});

test('an interrupting model-compiled item plan replaces the whole unfinished agenda atomically', () => {
  const cancellations = [];
  const agent = {
    name: 'TestBot',
    bot: { inventory: { slots: [] } },
    actions: {
      currentRequestContext: () => ({
        requestId: 'replacement-request',
        selectedSkill: '!queueItemPlan',
        agendaDisposition: 'interrupt',
      }),
    },
    behavior_arbiter: { wake() {} },
    goal_director: { cancel(reason) { cancellations.push(['goal', reason]); } },
    job_director: { cancel(reason) { cancellations.push(['job', reason]); } },
  };
  const director = new AgendaDirector(agent, {
    store: { lastError: null, load: () => [], save() {} },
    now: () => 9_500,
  });
  agent.agenda_director = director;
  director.addMany([
    { kind: 'acquire', requester: 'OldPlayer', target: 'cobblestone', quantity: 75 },
    {
      kind: 'inventory_checklist',
      requester: 'OldPlayer',
      inventoryRequirements: [{ target: 'cobblestone', quantity: 75 }],
    },
    { kind: 'goto', requester: 'OldPlayer', recipient: 'OldPlayer' },
  ]);
  director.replace(director.entries[0].id, {
    state: 'active',
    startedAt: 9_500,
    executorId: 'old-goal',
  });

  const result = getCommand('!queueItemPlan').perform(
    agent,
    'logs:144|planks:75',
    'FieldWitness',
    true,
  );

  assert.match(result, /durable 4-step item plan/i);
  assert.equal(director.entries.filter(entry => entry.state === 'cancelled').length, 3);
  assert.deepEqual(
    director.entries.filter(entry => entry.state === 'pending').map(entry => entry.requester),
    ['FieldWitness', 'FieldWitness', 'FieldWitness', 'FieldWitness'],
  );
  assert.deepEqual(cancellations.map(([owner]) => owner), ['goal', 'job']);
  assert.equal(director.status.code, 'agenda_plan_replaced');
});

test('one atomic Agenda batch resolves plan-local dependencies and rejects an invalid later step without publication', () => {
  const saved = [];
  const director = new AgendaDirector({ name: 'TestBot' }, {
    store: { lastError: null, load: () => [], save: entries => saved.push(entries) },
    now: () => 9_750,
  });
  const accepted = director.addMany([
    { kind: 'mine', requester: 'DadPlayer', target: 'iron_ore', quantity: 8 },
    {
      kind: 'goto',
      requester: 'DadPlayer',
      recipient: 'DadPlayer',
      dependsOnPrevious: true,
      dependencyPolicy: 'requires_success',
    },
  ]);
  assert.equal(accepted.accepted, true);
  assert.equal(director.entries[1].dependsOnEntryId, director.entries[0].id);
  assert.equal(saved.length, 1, 'the complete linked plan is persisted once');

  const before = JSON.stringify(director.entries);
  const rejected = director.addMany([
    { kind: 'mine', requester: 'DadPlayer', target: 'coal_ore', quantity: 4 },
    { kind: 'not_real', requester: 'DadPlayer', dependsOnPrevious: true },
  ]);
  assert.equal(rejected.accepted, false);
  assert.equal(JSON.stringify(director.entries), before);
  assert.equal(saved.length, 1, 'a malformed later effect publishes none of its plan');
});

test('natural cleanup compiles one durable retained-inventory storage plan', () => {
  const inventory = [
    { name: 'raw_iron', count: 67 },
    ...Array.from({ length: 11 }, (_, index) => ({ name: 'stone_pickaxe', count: 1, durabilityUsed: 90 + index })),
    { name: 'stone_sword', count: 1 },
  ];
  const position = (x, y, z) => ({
    x, y, z,
    offset: (dx, dy, dz) => position(x + dx, y + dy, z + dz),
  });
  const blockedChest = { name: 'chest', position: position(8, 64, 12) };
  const usableChest = { name: 'chest', position: position(10, 64, 12) };
  const bot = {
    game: { dimension: 'minecraft:overworld' },
    registry: {
      itemsByName: {
        raw_iron: { id: 1 },
        stone_pickaxe: { id: 2 },
        stone_sword: { id: 3 },
      },
      blocksByName: {
        chest: { id: 10 },
        trapped_chest: { id: 11 },
        barrel: { id: 12 },
      },
    },
    inventory: { items: () => inventory },
    blockAt(point) {
      if (point.x === 8 && point.y === 64 && point.z === 12) return blockedChest;
      if (point.x === 10 && point.y === 64 && point.z === 12) return usableChest;
      if (point.x === 8 && point.y === 65 && point.z === 12) {
        return { name: 'cobblestone', boundingBox: 'block' };
      }
      return { name: 'air', boundingBox: 'empty' };
    },
    findBlocks: () => [blockedChest.position, usableChest.position],
  };
  const request = 'Clean up after mining: put the ore and worn extra tools in this chest, but keep one good pickaxe and combat gear, then come back to me.';
  const directive = resolvePlayerDirective('Gabriel', request, { bot });
  assert.equal(directive?.assignmentKind, 'storage_plan');
  assert.equal(directive?.deferToModel, true);
  assert.match(directive?.modelInstruction || '', /!queueStoragePlan/);

  const agent = { name: 'TestBot', bot, behavior_arbiter: { wake() {} } };
  const director = new AgendaDirector(agent, {
    store: { lastError: null, load: () => [], save() {} },
    now: () => 10_000,
  });
  agent.agenda_director = director;
  const accepted = getCommand('!queueStoragePlan').perform(
    agent,
    'raw_iron:0|stone_pickaxe:1',
    'Gabriel',
    true,
  );
  assert.match(accepted, /durable 2-step storage plan/i);
  assert.deepEqual(director.entries.map(entry => entry.kind), ['storage_plan', 'goto']);
  assert.deepEqual(director.entries[0].storageRequirements, [
    { target: 'raw_iron', retain: 0 },
    { target: 'stone_pickaxe', retain: 1 },
  ]);
  assert.deepEqual(director.entries[0].containerConstraint.position, { x: 10, y: 64, z: 12 });
  assert.equal(director.entries[1].recipient, 'Gabriel');
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

test('a synchronously verified final inventory checklist applies its durable terminal wait', () => {
  const holds = [];
  const messages = [];
  let saved = [];
  const agent = {
    name: 'TestBot',
    bot: { inventory: { slots: [{ name: 'oak_boat', count: 1 }] } },
    actions: { executing: false },
    goal_director: { activeGoal: null },
    job_director: { activeOrder: null },
    isOperatorHeld: () => false,
    holdPosition(reason, options) { holds.push({ reason, options }); },
    openChat(message) { messages.push(message); },
  };
  const director = new AgendaDirector(agent, {
    now: () => 24_000,
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
    requester: 'DadPlayer',
    inventoryRequirements: [{ target: 'oak_boat', quantity: 1 }],
    terminalDisposition: 'hold_position',
  });

  director.update();

  assert.equal(director.entries[0].state, 'complete');
  assert.equal(director.entries[0].evidence.code, 'inventory_checklist_verified');
  assert.equal(director.entries[0].terminalDispositionApplied, true);
  assert.equal(saved[0].terminalDispositionApplied, true);
  assert.deepEqual(holds, [{
    reason: 'companion wait requested by DadPlayer',
    options: { preserveDurableWork: true },
  }]);
  assert.match(messages.at(-1), /wait here until you give me another order/i);
});

test('a final inventory checklist cannot erase an acquire step physical postcondition failure', () => {
  let now = 25_000;
  let submittedGoal = null;
  let submissions = 0;
  const bot = {
    // The inventory floor is deliberately satisfied. The unfinished physical
    // transaction, not item arithmetic, must keep the plan from passing.
    inventory: { slots: [{ name: 'spruce_log', count: 182 }] },
  };
  const goalDirector = {
    activeGoal: null,
    lastGoal: null,
    submit(goal) {
      submissions += 1;
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
    store: { lastError: null, load: () => [], save() {} },
  });
  director.addMany([
    { kind: 'acquire', requester: 'Gabriel', target: 'spruce_log', quantity: 182, quantityMode: 'minimum' },
    {
      kind: 'inventory_checklist',
      requester: 'Gabriel',
      inventoryRequirements: [{ target: 'spruce_log', quantity: 182 }],
    },
  ]);

  director.update();
  goalDirector.activeGoal = null;
  goalDirector.lastGoal = {
    ...submittedGoal,
    phase: 'failed',
    evidence: {
      code: 'skill_tree_incomplete',
      detail: 'Five connected logs remain.',
      retryable: false,
      completionBlocked: true,
    },
  };
  now += 1;
  director.update();
  assert.equal(director.entries[0].state, 'failed');
  assert.equal(director.entries[0].evidence.completionBlocked, true);

  now += 6_000;
  director.update();
  assert.equal(director.entries[1].state, 'failed');
  assert.equal(director.entries[1].evidence.code, 'inventory_checklist_physical_postcondition_blocked');
  assert.equal(director.entries[1].evidence.completionBlocked, true);
  assert.equal(submissions, 1, 'the checklist must not launch a fresh acquisition that forgets the unfinished site');
});

// Drive Agent.dispatchPlayerAgenda against a minimal fake `this`, so the
// append / interrupt / takeover branching is verified without spinning a bot.
// The real directive resolver runs; the messages used resolve without a bot
// registry (mining, harvest, come-here).
function makeFakeAgent({
  remaining = 0,
  held = false,
  stopResult = { stopped: true },
  companion = null,
} = {}) {
  const calls = {
    added: [],
    cleared: 0,
    replaced: 0,
    cancelResume: 0,
    goalCancel: 0,
    jobCancel: 0,
    directiveCleared: 0,
    selfPromptInterrupt: 0,
    roleDefer: 0,
    modelCancel: 0,
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
      validateMany(entries) {
        return {
          accepted: Array.isArray(entries) && entries.length > 0,
          entries: entries.map((entry, index) => ({
            id: `agenda-validation-${index + 1}`,
            description: entry.kind,
          })),
        };
      },
      addMany(entries, { replaceUnfinished = false } = {}) {
        const ids = entries.map((_, index) => `agenda-test-${calls.added.length + index + 1}`);
        const staged = entries.map((entry, index) => {
          if (entry.dependsOnPrevious !== true) return entry;
          const { dependsOnPrevious, ...rest } = entry;
          return {
            ...rest,
            dependsOnEntryId: ids[index - 1],
          };
        });
        calls.added.push(...staged);
        if (replaceUnfinished) calls.replaced += 1;
        return {
          accepted: true,
          replaced: replaceUnfinished ? remaining : 0,
          entries: staged.map((entry, index) => ({
            id: ids[index],
            description: `${entry.kind} ${entry.target || entry.recipient || ''}`.trim(),
          })),
        };
      },
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
    actions: { cancelResume() { calls.cancelResume += 1; }, stop() { calls.stop += 1; return stopResult; } },
    goal_director: { cancel() { calls.goalCancel += 1; } },
    job_director: { cancel() { calls.jobCancel += 1; } },
    companion_context: {
      snapshot() { return companion; },
      setDirective() { calls.directiveCleared += 1; },
    },
    self_prompter: { interruptForManualCommand() { calls.selfPromptInterrupt += 1; } },
    prompter: { cancelPendingModelGeneration() { calls.modelCancel += 1; return 1; } },
    role_director: { deferForManualCommand() { calls.roleDefer += 1; } },
    isOperatorHeld() { return held; },
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
  assert.equal(calls.modelCancel, 1, 'fresh durable player authority invalidates an older model turn');
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

test('dispatchPlayerAgenda asks for an unresolved clause before takeover or partial installation', async () => {
  const { agent, calls } = makeFakeAgent({ remaining: 0 });
  const handled = await Agent.prototype.dispatchPlayerAgenda.call(
    agent,
    'DadPlayer',
    'DadPlayer',
    'mine 8 iron then sing our family song then come back to me',
  );
  assert.equal(handled, true);
  assert.equal(calls.added.length, 0);
  assert.equal(calls.stop, 0);
  assert.equal(calls.cancelResume, 0);
  assert.match(calls.responses[0], /did not start only part/i);
  assert.match(calls.responses[0], /sing our family song/i);
});

test('dispatchPlayerAgenda rejects a malformed complete effect list before physical takeover', async () => {
  const { agent, calls } = makeFakeAgent({ remaining: 0 });
  agent.agenda_director.validateMany = () => ({
    accepted: false,
    code: 'invalid_agenda_entry',
    detail: 'later effect is invalid',
  });
  const handled = await Agent.prototype.dispatchPlayerAgenda.call(
    agent,
    'DadPlayer',
    'DadPlayer',
    'mine 8 iron then come back to me',
  );
  assert.equal(handled, true);
  assert.equal(calls.added.length, 0);
  assert.equal(calls.stop, 0);
  assert.equal(calls.cancelResume, 0);
  assert.match(calls.responses[0], /complete effect list was rejected/i);
});

test('dispatchPlayerAgenda interrupt clears the queue and preempts', async () => {
  const { agent, calls } = makeFakeAgent({ remaining: 2 });
  const handled = await Agent.prototype.dispatchPlayerAgenda.call(agent, 'Gabriel', 'Gabriel', 'stop, mine 10 iron then come here');
  assert.equal(handled, true);
  assert.equal(calls.replaced, 1, 'interrupt replaces the existing queue in the atomic install');
  assert.equal(calls.cleared, 0, 'the old queue is not cleared before the replacement validates');
  assert.equal(calls.stop, 1, 'interrupt preempts the current action');
  assert.equal(calls.added.length, 2);
  assert.match(calls.responses[0], /new plan/i);
});

test('dispatchPlayerAgenda appends onto a running agenda without preempting it', async () => {
  const { agent, calls } = makeFakeAgent({ remaining: 1 });
  const handled = await Agent.prototype.dispatchPlayerAgenda.call(agent, 'Gabriel', 'Gabriel', 'also mine 5 coal');
  assert.equal(handled, true);
  assert.equal(calls.added.length, 1);
  assert.equal(calls.modelCancel, 0, 'ordinary FIFO append must not cancel the active construction compiler');
  // Running agenda => no takeover, no preemption, no clear.
  assert.equal(calls.stop, 0);
  assert.equal(calls.cancelResume, 0);
  assert.equal(calls.cleared, 0);
});

test('a construction continuation appends through its compilation hold without cancelling the barrier', async () => {
  const { agent, calls } = makeFakeAgent({ remaining: 1, held: true });
  agent.agenda_director.activeConstructionIntent = () => ({
    id: 'agenda-construction-compiling',
    kind: 'construction',
    assignmentState: 'compiling',
  });

  const handled = await Agent.prototype.dispatchPlayerAgenda.call(
    agent,
    'DadPlayer',
    'DadPlayer',
    ', then come back to me and wait with us.',
  );

  assert.equal(handled, true);
  assert.equal(calls.stop, 0);
  assert.equal(calls.cancelResume, 0);
  assert.equal(calls.cleared, 0);
  assert.deepEqual(calls.added, [{
    kind: 'goto',
    requester: 'DadPlayer',
    recipient: 'DadPlayer',
    terminalDisposition: 'hold_position',
  }]);
  assert.match(calls.responses[0], /^Queued 1 step:/);
});

test('a new player plan replaces unfinished agenda work preserved under Operator Stop', async () => {
  const { agent, calls } = makeFakeAgent({ remaining: 2, held: true });
  const handled = await Agent.prototype.dispatchPlayerAgenda.call(
    agent,
    'DadPlayer',
    'DadPlayer',
    'mine 8 iron then come here',
  );
  assert.equal(handled, true);
  assert.equal(calls.replaced, 1, 'held unfinished work is replaced in the same atomic queue mutation');
  assert.equal(calls.cleared, 0, 'the held queue is not erased before the replacement validates');
  assert.equal(calls.stop, 1, 'the new authority takes control through the normal physical handoff');
  assert.equal(calls.added.length, 2);
  assert.equal(calls.operatorHoldReleased, 1);
  assert.match(calls.responses[0], /new plan/i);
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

test('dispatchPlayerAgenda persists a lone rendezvous so reflex preemption cannot erase it', async () => {
  const { agent, calls } = makeFakeAgent({ remaining: 0 });
  const handled = await Agent.prototype.dispatchPlayerAgenda.call(
    agent,
    'Gabriel',
    'Gabriel',
    'come to me',
  );

  assert.equal(handled, true);
  assert.deepEqual(calls.added, [{
    kind: 'goto',
    requester: 'Gabriel',
    recipient: 'Gabriel',
  }]);
  assert.equal(calls.stop, 1);
  assert.match(calls.responses[0], /Queued 1 step/);
});

test('dispatchPlayerAgenda does not downgrade a same-player standing follow into a finite rendezvous', async () => {
  const { agent, calls } = makeFakeAgent({
    remaining: 0,
    companion: {
      directive: 'follow',
      requestedName: 'Gabriel',
      canonicalUsername: 'Gabriel',
      alias: 'Gabriel',
    },
  });
  const handled = await Agent.prototype.dispatchPlayerAgenda.call(
    agent,
    'Gabriel',
    'Gabriel',
    'come to me',
  );

  assert.equal(handled, false, 'the standing command must continue to the direct command path');
  assert.equal(calls.added.length, 0);
  assert.equal(calls.stop, 0);
  assert.equal(calls.directiveCleared, 0);
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

test('agenda acquisition retry preserves its first absolute inventory target across restart', () => {
  let now = 42_000;
  let persisted = [];
  const submitted = [];
  const bot = { inventory: { slots: [] } };
  const goalDirector = {
    activeGoal: null,
    lastGoal: null,
    submit(goal) {
      const expectedCheckpoint = submitted.length === 0
        ? { baselineInventory: 0, targetInventory: 8 }
        : {
            baselineInventory: 0,
            targetInventory: 8,
            miningReturnRoute: [
              { x: 2, y: 32, z: 8 },
              { x: 3, y: 31, z: 8 },
            ],
            miningReturnIndex: 1,
            miningReturnDimension: 'overworld',
          };
      assert.deepEqual(
        persisted[0]?.acquisitionCheckpoint,
        expectedCheckpoint,
        'the acquisition continuation checkpoint must be durable before GoalDirector receives physical ownership',
      );
      submitted.push(goal);
      this.activeGoal = goal;
      return { accepted: true, id: goal.id };
    },
  };
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
    bot,
    actions: { executing: false },
    goal_director: goalDirector,
    job_director: { activeOrder: null },
    isOperatorHeld: () => false,
  };
  const options = {
    store,
    now: () => now,
    resolveTarget: () => ({
      requestedName: 'raw_iron',
      canonicalName: 'raw_iron',
      inventoryName: 'raw_iron',
      acquisitionName: 'raw_iron',
      acquisitionKind: 'planned',
    }),
  };
  let director = new AgendaDirector(agent, options);
  director.add({
    kind: 'acquire',
    requester: 'DadPlayer',
    target: 'raw_iron',
    quantity: 8,
  });

  director.update();
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].checkpoint.baselineInventory, 0);
  assert.equal(submitted[0].checkpoint.targetInventory, 8);

  bot.inventory.slots = [{ name: 'raw_iron', count: 5 }];
  goalDirector.activeGoal = null;
  goalDirector.lastGoal = {
    ...submitted[0],
    phase: 'failed',
    checkpoint: {
      ...submitted[0].checkpoint,
      miningReturnRoute: [
        { x: 2, y: 32, z: 8 },
        { x: 3, y: 31, z: 8 },
      ],
      miningReturnIndex: 1,
      miningReturnDimension: 'minecraft:overworld',
    },
    evidence: {
      code: 'unsupported_acquisition_leaf',
      detail: 'The current source alternatives were exhausted.',
      retryable: true,
    },
  };
  director.update();
  assert.equal(persisted[0].state, 'pending');
  assert.deepEqual(persisted[0].acquisitionCheckpoint, {
    baselineInventory: 0,
    targetInventory: 8,
    miningReturnRoute: [
      { x: 2, y: 32, z: 8 },
      { x: 3, y: 31, z: 8 },
    ],
    miningReturnIndex: 1,
    miningReturnDimension: 'overworld',
  });

  now += 6_000;
  director = new AgendaDirector(agent, options);
  director.update();

  assert.equal(submitted.length, 2);
  assert.equal(submitted[1].quantityMode, 'additional');
  assert.equal(submitted[1].quantity, 8);
  assert.equal(submitted[1].checkpoint.baselineInventory, 0);
  assert.equal(submitted[1].checkpoint.targetInventory, 8);
  assert.deepEqual(submitted[1].checkpoint.miningReturnRoute, [
    { x: 2, y: 32, z: 8 },
    { x: 3, y: 31, z: 8 },
  ]);
  assert.equal(submitted[1].checkpoint.miningReturnIndex, 1);
  assert.equal(submitted[1].checkpoint.miningReturnDimension, 'overworld');
});

test('an exhausted GoalDirector result cannot gain fresh Agenda retry authority by omission', () => {
  let now = 84_000;
  let persisted = [];
  const submitted = [];
  const goalDirector = {
    activeGoal: null,
    lastGoal: null,
    submit(goal) {
      submitted.push(goal);
      this.activeGoal = goal;
      return { accepted: true, id: goal.id };
    },
  };
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
    bot: { inventory: { slots: [] } },
    actions: { executing: false },
    goal_director: goalDirector,
    job_director: { activeOrder: null },
    isOperatorHeld: () => false,
    openChat() {},
  };
  const director = new AgendaDirector(agent, {
    store,
    now: () => now,
    resolveTarget: () => ({
      requestedName: 'cobblestone',
      canonicalName: 'cobblestone',
      inventoryName: 'cobblestone',
      acquisitionName: 'cobblestone',
      acquisitionKind: 'planned',
    }),
  });
  director.add({
    kind: 'acquire',
    requester: 'DadPlayer',
    target: 'cobblestone',
    quantity: 8,
  });

  director.update();
  assert.equal(submitted.length, 1);
  goalDirector.activeGoal = null;
  goalDirector.lastGoal = {
    ...submitted[0],
    phase: 'failed',
    evidence: {
      code: 'goal_attempts_exhausted',
      detail: 'GoalDirector exhausted its bounded recovery without material progress.',
    },
  };

  director.update();
  assert.equal(persisted[0].state, 'failed');
  assert.equal(persisted[0].evidence.retryable, false);
  assert.equal(persisted[0].attempts, 1);

  now += 6_000;
  director.update();
  assert.equal(submitted.length, 1, 'Agenda must not manufacture a new Goal ID or fresh recovery budget');
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

test('an Agenda mining job treats its quantity as fresh output above dispatch inventory', () => {
  let submitted = null;
  const agent = {
    name: 'TestBot',
    bot: {
      inventory: {
        slots: [{ name: 'raw_iron', count: 9 }],
      },
    },
    job_director: {
      submit(order) {
        submitted = order;
        return { accepted: true, id: order.id };
      },
    },
  };
  const director = new AgendaDirector(agent, {
    store: { lastError: null, load: () => [], save() {} },
    now: () => 42_500,
  });
  const added = director.add({
    kind: 'mine',
    requester: 'DadPlayer',
    target: 'iron_ore',
    quantity: 8,
  });
  const entry = director.entries.find(candidate => candidate.id === added.id);

  const result = director.dispatch(entry);

  assert.equal(result.accepted, true);
  assert.equal(submitted.quota, 17);
  assert.equal(submitted.checkpoint.baselineInventory, 9);
  assert.equal(submitted.checkpoint.targetInventory, 17);
});

test('an Agenda harvest persists fresh-output accounting and the exact requester', () => {
  let submitted = null;
  const agent = {
    name: 'TestBot',
    bot: {
      inventory: {
        slots: [{ name: 'spruce_log', count: 7 }],
      },
    },
    job_director: {
      submit(order) {
        submitted = order;
        return { accepted: true, id: order.id };
      },
    },
  };
  const director = new AgendaDirector(agent, {
    store: { lastError: null, load: () => [], save() {} },
    now: () => 42_750,
  });
  const added = director.add({
    kind: 'harvest',
    requester: 'DadPlayer',
    target: 'logs',
    quantity: 6,
  });
  const entry = director.entries.find(candidate => candidate.id === added.id);

  const result = director.dispatch(entry);

  assert.equal(result.accepted, true);
  assert.equal(submitted.requester, 'DadPlayer');
  assert.equal(submitted.quota, 6);
  assert.equal(submitted.checkpoint.baselineInventory, 7);
  assert.equal(submitted.checkpoint.targetInventory, 13);
});

test('the direct harvest command uses the same fresh-output and requester contract', async () => {
  let submitted = null;
  const director = {
    activeOrder: null,
    submit(order) {
      submitted = order;
      this.activeOrder = order;
      return { accepted: true, id: order.id, code: 'job_accepted' };
    },
  };
  const agent = {
    bot: {
      inventory: {
        items: () => [{ name: 'spruce_log', count: 7 }],
      },
    },
    runtime: { role: 'companion' },
    job_director: director,
    actions: { currentRequestContext: () => null },
    companion_context: {
      snapshot: () => ({ canonicalUsername: 'DadPlayer' }),
    },
  };

  const response = await getCommand('!assignHarvestJob').perform(agent, 'logs', 6, 'DadPlayer');

  assert.match(response, /Accepted resumable lumberjack work order/);
  assert.equal(submitted.requester, 'DadPlayer');
  assert.equal(submitted.quota, 6);
  assert.equal(submitted.checkpoint.baselineInventory, 7);
  assert.equal(submitted.checkpoint.targetInventory, 13);
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

test('exact container inspection dispatches one bound action and reports its structured manifest', async () => {
  const commands = [];
  const chat = [];
  let now = 50_000;
  const agent = {
    name: 'TestBot',
    bot: {},
    last_action_result: { actionId: 'before', phase: 'succeeded', code: 'old_result' },
    actions: { executing: false },
    goal_director: { activeGoal: null },
    job_director: { activeOrder: null },
    isOperatorHeld: () => false,
    openChat(message) { chat.push(message); },
  };
  const director = new AgendaDirector(agent, {
    store: { lastError: null, load: () => [], save() {} },
    now: () => now,
    executeCommand(_agent, command) {
      commands.push(command);
      agent.last_action_result = {
        actionId: 'inspect-result',
        phase: 'succeeded',
        code: 'skill_viewed',
        detail: 'Action output: inspected exact chest.',
        retryable: false,
        evidence: {
          request: { routeOrigin: 'agenda-director' },
          skill: {
            kind: 'chest_view',
            outcome: 'viewed',
            target: { name: 'chest', x: 8104, y: 69, z: 7940 },
            manifest: [
              { name: 'iron_axe', count: 1 },
              { name: 'iron_pickaxe', count: 2 },
            ],
          },
        },
      };
      return Promise.resolve();
    },
  });
  director.add({
    kind: 'inspect_container',
    requester: 'DadPlayer',
    containerConstraint: {
      name: 'chest',
      position: { x: 8104, y: 69, z: 7940 },
      dimension: 'overworld',
    },
  });

  director.update();
  await new Promise(resolve => setImmediate(resolve));
  now += 1_000;

  assert.deepEqual(commands, ['!viewChestAt(8104, 69, 7940, "overworld")']);
  assert.equal(director.entries[0].state, 'complete');
  assert.equal(director.entries[0].evidence.code, 'skill_viewed');
  assert.match(chat.join(' '), /2 iron pickaxe/);
  assert.match(chat.join(' '), /1 iron axe/);
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

test('direct agenda work resumes after reflex preemption without spending its failure budget', async () => {
  let now = 50_000;
  let persisted = [];
  const messages = [];
  const results = [
    {
      actionId: 'return-preempted-1',
      phase: 'interrupted',
      code: 'interrupted',
      detail: 'Self-defense took ownership for a nearby Skeleton.',
      retryable: true,
    },
    {
      actionId: 'return-preempted-2',
      phase: 'interrupted',
      code: 'interrupted',
      detail: 'Self-defense took ownership for a nearby Skeleton.',
      retryable: true,
    },
    {
      actionId: 'return-complete',
      phase: 'succeeded',
      code: 'skill_arrived',
      detail: 'Reached DadPlayer.',
      retryable: false,
    },
  ];
  const agent = {
    name: 'TestBot',
    last_action_result: { actionId: 'before', phase: 'succeeded', code: 'old_result' },
    actions: { executing: false },
    goal_director: { activeGoal: null },
    job_director: { activeOrder: null },
    openChat(message) { messages.push(message); },
  };
  const store = {
    lastError: null,
    load: () => JSON.parse(JSON.stringify(persisted)),
    save(entries) {
      persisted = JSON.parse(JSON.stringify(entries));
      return true;
    },
  };
  const options = {
    store,
    now: () => now,
    executeCommand(_agent, _command, options) {
      agent.last_action_result = {
        ...results.shift(),
        evidence: { request: { routeOrigin: options.routeOrigin } },
      };
      return Promise.resolve();
    },
  };
  let director = new AgendaDirector(agent, options);
  const added = director.add({ kind: 'goto', requester: 'DadPlayer', recipient: 'DadPlayer' });
  assert.equal(director.directSettlement({
    phase: 'interrupted',
    code: 'stop_requested',
    retryable: true,
  }).preempted, false, 'Operator Stop is censored but never automatic resume authority');

  director.update();
  await new Promise(resolve => setImmediate(resolve));
  let entry = director.entries.find(candidate => candidate.id === added.id);
  assert.equal(entry.state, 'pending');
  assert.equal(entry.attempts, 0);
  assert.equal(entry.preemptions, 1);
  assert.equal(entry.evidence.code, 'preempted');
  assert.match(messages.at(-1), /still queued and will resume/i);

  director = new AgendaDirector(agent, options);
  now += 6_000;
  director.update();
  await new Promise(resolve => setImmediate(resolve));
  entry = director.entries.find(candidate => candidate.id === added.id);
  assert.equal(entry.state, 'pending');
  assert.equal(entry.attempts, 0);
  assert.equal(entry.preemptions, 2);
  assert.ok(messages.some(message => /safety response settled.*resuming go to DadPlayer/i.test(message)));

  now += 6_000;
  director.update();
  await new Promise(resolve => setImmediate(resolve));
  entry = director.entries.find(candidate => candidate.id === added.id);
  assert.equal(entry.state, 'complete');
  assert.equal(entry.attempts, 1);
  assert.equal(entry.preemptions, 0);
  assert.equal(entry.evidence.code, 'skill_arrived');
});

test('a retryable death tells the player that the agenda remains queued and announces the retry', async () => {
  let now = 80_000;
  const messages = [];
  const results = [
    {
      actionId: 'return-died',
      phase: 'failed',
      code: 'skill_died',
      detail: 'The skill reported that it could not complete.',
      retryable: true,
    },
    {
      actionId: 'return-after-respawn',
      phase: 'succeeded',
      code: 'skill_arrived',
      detail: 'Reached DadPlayer.',
      retryable: false,
    },
  ];
  const agent = {
    name: 'TestBot',
    last_action_result: null,
    actions: { executing: false },
    goal_director: { activeGoal: null },
    job_director: { activeOrder: null },
    openChat(message) { messages.push(message); },
  };
  const director = new AgendaDirector(agent, {
    now: () => now,
    store: { lastError: null, load: () => [], save: () => true },
    executeCommand(_agent, _command, options) {
      agent.last_action_result = {
        ...results.shift(),
        evidence: { request: { routeOrigin: options.routeOrigin } },
      };
      return Promise.resolve();
    },
  });
  const added = director.add({ kind: 'goto', requester: 'DadPlayer', recipient: 'DadPlayer' });

  director.update();
  await new Promise(resolve => setImmediate(resolve));
  let entry = director.entries.find(candidate => candidate.id === added.id);
  assert.equal(entry.state, 'pending');
  assert.equal(entry.attempts, 1);
  assert.match(messages.at(-1), /died before the step completed.*remains queued/i);

  now += 6_000;
  director.update();
  await new Promise(resolve => setImmediate(resolve));
  entry = director.entries.find(candidate => candidate.id === added.id);
  assert.equal(entry.state, 'complete');
  assert.ok(messages.some(message => /retrying go to DadPlayer now \(2\/2\)/i.test(message)));
});

test('a composed no-progress failure waits durably for material change before redispatch', async () => {
  let now = 90_000;
  let dispatches = 0;
  let persisted = [];
  const playerPosition = { x: 20, y: 64, z: 20 };
  const botPosition = { x: 0, y: 64, z: 0 };
  const agent = {
    name: 'TestBot',
    bot: {
      entity: { position: botPosition },
      game: { dimension: 'minecraft:overworld' },
      players: {
        DadPlayer: {
          username: 'DadPlayer',
          entity: { position: playerPosition },
        },
      },
    },
    last_action_result: null,
    actions: { executing: false },
    goal_director: { activeGoal: null },
    job_director: { activeOrder: null },
    isOperatorHeld: () => false,
    openChat() {},
  };
  const store = {
    lastError: null,
    load: () => JSON.parse(JSON.stringify(persisted)),
    save(entries) {
      persisted = JSON.parse(JSON.stringify(entries));
      return true;
    },
  };
  const director = new AgendaDirector(agent, {
    now: () => now,
    store,
    executeCommand(_agent, _command, options) {
      dispatches += 1;
      agent.last_action_result = dispatches === 1
        ? {
            actionId: 'composed-no-progress',
            phase: 'failed',
            code: 'path_stalled',
            detail: 'No traversable segment made progress.',
            retryable: true,
            evidence: {
              request: { routeOrigin: options.routeOrigin },
              skill: {
                receiptSchemaVersion: 1,
                source: 'action_context',
                actionId: 'composed-no-progress',
                children: {
                  navigation: [{ outcome: 'no_progress', progressed: 0 }],
                },
              },
            },
          }
        : {
            actionId: 'composed-after-change',
            phase: 'succeeded',
            code: 'skill_arrived',
            detail: 'Reached DadPlayer.',
            retryable: false,
            evidence: {
              request: { routeOrigin: options.routeOrigin },
              skill: {
                receiptSchemaVersion: 1,
                source: 'action_context',
                actionId: 'composed-after-change',
                children: {},
              },
            },
          };
      return Promise.resolve();
    },
  });
  const added = director.add({ kind: 'goto', requester: 'DadPlayer', recipient: 'DadPlayer' });

  director.update();
  await new Promise(resolve => setImmediate(resolve));
  let entry = director.entries.find(candidate => candidate.id === added.id);
  assert.equal(dispatches, 1);
  assert.equal(entry.state, 'pending');
  assert.equal(entry.attempts, 1);
  assert.equal(entry.evidence.code, 'waiting_for_material_change');
  assert.equal(entry.materialChangeBlocker?.schemaVersion, 1);

  now += 6_000;
  director.update();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dispatches, 1, 'elapsed time alone must not redispatch the failed method');

  botPosition.x = 8;
  now += 6_000;
  director.update();
  await new Promise(resolve => setImmediate(resolve));
  entry = director.entries.find(candidate => candidate.id === added.id);
  assert.equal(dispatches, 2, 'a real position-region change releases the same queued obligation');
  assert.equal(entry.state, 'complete');
  assert.equal(entry.materialChangeBlocker, undefined);
});

test('a composed censored sample preserves the obligation without spending its failure budget', () => {
  const director = new AgendaDirector({
    actions: { executing: false },
    goal_director: { activeGoal: null },
    job_director: { activeOrder: null },
    openChat() {},
  }, {
    now: () => 91_000,
    store: { lastError: null, load: () => [], save: () => true },
  });
  const added = director.add({ kind: 'goto', requester: 'DadPlayer', recipient: 'DadPlayer' });
  director.replace(added.id, { state: 'active', executorId: 'direct:test' });
  const active = director.entries.find(entry => entry.id === added.id);

  const result = director.commitSettlement(active, director.directSettlement({
    phase: 'cancelled',
    code: 'owner_replaced',
    detail: 'A higher-priority owner took the action slot.',
    retryable: true,
    evidence: {
      skill: {
        receiptSchemaVersion: 1,
        source: 'action_context',
        actionId: 'cancelled-composed-action',
        children: {},
      },
    },
  }));

  const entry = director.entries.find(candidate => candidate.id === added.id);
  assert.equal(result.state, 'censored');
  assert.equal(entry.state, 'pending');
  assert.equal(entry.attempts, 0);
  assert.equal(entry.evidence.code, 'censored');
});

test('a successful terminal return enters the durable companion wait hold', async () => {
  const holds = [];
  const messages = [];
  const agent = {
    name: 'TestBot',
    last_action_result: null,
    actions: { executing: false },
    goal_director: { activeGoal: null },
    job_director: { activeOrder: null },
    holdPosition(reason, options) { holds.push({ reason, options }); },
    openChat(message) { messages.push(message); },
  };
  const director = new AgendaDirector(agent, {
    store: { lastError: null, load: () => [], save() {} },
    executeCommand(_agent, _command, options) {
      agent.last_action_result = {
        actionId: 'terminal-return',
        phase: 'succeeded',
        code: 'skill_arrived',
        retryable: false,
        evidence: { request: { routeOrigin: options.routeOrigin } },
      };
      return Promise.resolve();
    },
  });
  const added = director.add({
    kind: 'goto',
    requester: 'DadPlayer',
    recipient: 'DadPlayer',
    terminalDisposition: 'hold_position',
  });

  director.update();
  await new Promise(resolve => setImmediate(resolve));

  const settled = director.entries.find(entry => entry.id === added.id);
  assert.equal(settled.state, 'complete');
  assert.equal(settled.terminalDispositionApplied, true);
  assert.deepEqual(holds, [{
    reason: 'companion wait requested by DadPlayer',
    options: { preserveDurableWork: true },
  }]);
  assert.match(messages.at(-1), /wait here until you give me another order/i);
});

test('offered gear dispatches additive pickup before verified equip and terminal Hold', async () => {
  const commands = [];
  const holds = [];
  const messages = [];
  let now = 61_000;
  const agent = {
    name: 'TestBot',
    bot: { inventory: { slots: [] } },
    last_action_result: null,
    actions: { executing: false },
    goal_director: { activeGoal: null },
    job_director: { activeOrder: null },
    isOperatorHeld: () => false,
    holdPosition(reason, options) { holds.push({ reason, options }); },
    openChat(message) { messages.push(message); },
  };
  const director = new AgendaDirector(agent, {
    store: { lastError: null, load: () => [], save: () => true },
    now: () => now,
    executeCommand(_agent, command, options) {
      commands.push(command);
      agent.last_action_result = {
        actionId: `offered-gear-${commands.length}`,
        phase: 'succeeded',
        code: command.startsWith('!pickupItem') ? 'skill_picked_up' : 'skill_equipped',
        detail: command.startsWith('!pickupItem')
          ? 'Minecraft confirmed one additional stone_pickaxe.'
          : 'Minecraft confirmed stone_pickaxe in the main hand.',
        retryable: false,
        evidence: { request: { routeOrigin: options.routeOrigin } },
      };
      return Promise.resolve();
    },
  });
  const pickup = director.add({
    kind: 'pickup_item',
    requester: 'KidPlayer',
    target: 'stone_pickaxe',
    quantity: 1,
    acquisitionCheckpoint: { baselineInventory: 0, targetInventory: 1 },
  });
  director.add({
    kind: 'equip_item',
    requester: 'KidPlayer',
    target: 'stone_pickaxe',
    dependsOnEntryId: pickup.id,
    dependencyPolicy: 'requires_success',
    terminalDisposition: 'hold_position',
  });

  director.update();
  await new Promise(resolve => setImmediate(resolve));
  now += 1_000;
  director.update();
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(commands, [
    '!pickupItem("stone_pickaxe", 1, 12, 0)',
    '!equip("stone_pickaxe")',
  ]);
  assert.deepEqual(director.entries.map(entry => entry.state), ['complete', 'complete']);
  assert.deepEqual(holds, [{
    reason: 'companion wait requested by KidPlayer',
    options: { preserveDurableWork: true },
  }]);
  assert.match(messages.at(-1), /equip the carried stone pickaxe/i);
  assert.match(messages.at(-1), /wait here until you give me another order/i);
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

test('a terminal Agenda failure tells the player once after durable settlement', async () => {
  const messages = [];
  const holds = [];
  const agent = {
    name: 'TestBot',
    actions: { executing: false },
    goal_director: { activeGoal: null },
    job_director: { activeOrder: null },
    holdPosition(reason, options) { holds.push({ reason, options }); },
    openChat(message) { messages.push(message); },
  };
  const director = new AgendaDirector(agent, {
    store: { lastError: null, load: () => [], save: () => true },
    now: () => 47_000,
  });
  const added = director.add({
    kind: 'goto',
    requester: 'DadPlayer',
    recipient: 'DadPlayer',
  });
  director.replace(added.id, { state: 'active', startedAt: 46_000 });

  director.commitSettlement(
    director.entries.find(entry => entry.id === added.id),
    {
      state: 'failed',
      code: 'skill_path_not_found',
      detail: 'I could not find a complete route to DadPlayer.',
      retryable: false,
    },
  );
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(director.entries.find(entry => entry.id === added.id).state, 'failed');
  assert.deepEqual(messages, [
    'I could not complete go to DadPlayer. Blocker: I could not find a complete route to DadPlayer. I did not retry without new evidence. I am holding position.',
  ]);
  assert.deepEqual(holds, [
    {
      reason: 'agenda terminal fallback awaiting player direction',
      options: { preserveDurableWork: true },
    },
  ]);
});

test('a failed Agenda step does not Hold ahead of an already-authorized continuation', async () => {
  const messages = [];
  const holds = [];
  const agent = {
    name: 'TestBot',
    actions: { executing: false },
    goal_director: { activeGoal: null },
    job_director: { activeOrder: null },
    holdPosition(reason, options) { holds.push({ reason, options }); },
    openChat(message) { messages.push(message); },
  };
  const director = new AgendaDirector(agent, {
    store: { lastError: null, load: () => [], save: () => true },
    now: () => 48_000,
  });
  const failed = director.add({ kind: 'goto', requester: 'DadPlayer', recipient: 'DadPlayer' });
  const continuation = director.add({
    kind: 'goto',
    requester: 'DadPlayer',
    recipient: 'KidPlayer',
    dependsOnEntryId: failed.id,
    dependencyPolicy: 'after_settlement',
  });
  director.replace(failed.id, { state: 'active', startedAt: 47_000 });

  director.commitSettlement(
    director.entries.find(entry => entry.id === failed.id),
    {
      state: 'failed',
      code: 'skill_path_not_found',
      detail: 'The route to DadPlayer was unavailable.',
      retryable: false,
    },
  );
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(director.entries.find(entry => entry.id === continuation.id).state, 'pending');
  assert.deepEqual(holds, []);
  assert.deepEqual(messages, [
    'I could not complete go to DadPlayer. Blocker: The route to DadPlayer was unavailable. I did not retry without new evidence. I am continuing 1 already-authorized remaining step.',
  ]);
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

test('fishing breakfast direct phases dispatch only typed fresh-output commands', () => {
  const commands = [];
  const agent = {
    name: 'TestBot',
    actions: { executing: false },
    goal_director: { activeGoal: null },
    job_director: { activeOrder: null },
    last_action_result: null,
  };
  const director = new AgendaDirector(agent, {
    store: { lastError: null, load: () => [], save: () => true },
    executeCommand(_agent, command) {
      commands.push(command);
      return new Promise(() => {});
    },
    now: () => 60_000,
  });
  const workstationConstraint = {
    name: 'furnace',
    position: { x: 8102, y: 70, z: 7938 },
    dimension: 'overworld',
    source: 'player_context_here',
    observedAt: 59_000,
  };

  const caught = director.add({
    kind: 'catch_fish',
    requester: 'DadPlayer',
    quantity: 3,
    baselineInventory: [{ name: 'cod', count: 1 }],
  });
  const cooked = director.add({
    kind: 'cook_fish',
    requester: 'DadPlayer',
    quantity: 3,
    baselineInventory: [{ name: 'cod', count: 1 }],
    baselineOutputInventory: [{ name: 'cooked_cod', count: 2 }],
    workstationConstraint,
  });
  const delivered = director.add({
    kind: 'deliver_family',
    requester: 'DadPlayer',
    recipient: 'DadPlayer',
    target: 'cooked_fish',
    quantity: 3,
    baselineInventory: [{ name: 'cooked_cod', count: 2 }],
  });

  assert.equal(director.dispatch(director.entries.find(entry => entry.id === caught.id)).accepted, true);
  assert.equal(director.dispatch(director.entries.find(entry => entry.id === cooked.id)).accepted, true);
  assert.equal(director.dispatch(director.entries.find(entry => entry.id === delivered.id)).accepted, true);
  assert.deepEqual(commands, [
    '!fish(3, "cod:1")',
    '!cookCaughtFish(3, 8102, 70, 7938, "overworld", "cod:1", "cooked_cod:2")',
    '!giveFamilyToPlayer("cooked_fish", "DadPlayer", 3, "cooked_cod:2")',
  ]);
});

test('craft dispatch preserves the exact normalized crafting-table constraint', () => {
  const commands = [];
  const agent = {
    name: 'TestBot',
    actions: { executing: false },
    goal_director: { activeGoal: null },
    job_director: { activeOrder: null },
    last_action_result: null,
  };
  const director = new AgendaDirector(agent, {
    store: { lastError: null, load: () => [], save: () => true },
    executeCommand(_agent, command) {
      commands.push(command);
      return new Promise(() => {});
    },
    now: () => 61_000,
  });
  const added = director.add({
    kind: 'craft',
    requester: 'DadPlayer',
    target: 'iron_pickaxe',
    quantity: 1,
    workstationConstraint: {
      name: 'crafting_table',
      position: { x: -392, y: 67, z: -42 },
      dimension: 'overworld',
      source: 'player_context_here',
      observedAt: 60_500,
    },
  });
  const entry = director.entries.find(candidate => candidate.id === added.id);

  assert.equal(director.dispatch(entry).accepted, true);
  assert.deepEqual(commands, ['!craftRecipe("iron_pickaxe", 1, -392, 67, -42, "overworld")']);
});

test('death durably rearms the immediate inventory prerequisite and censors its active dependent callback', async () => {
  let persisted = [];
  let finishDirect;
  let now = 70_000;
  const commands = [];
  const store = {
    lastError: null,
    load: () => JSON.parse(JSON.stringify(persisted)),
    save(entries) {
      persisted = JSON.parse(JSON.stringify(entries));
      return true;
    },
  };
  const bot = {
    inventory: { slots: [{ name: 'fishing_rod', count: 1 }] },
  };
  const agent = {
    name: 'TestBot',
    bot,
    actions: { executing: false },
    goal_director: { activeGoal: null },
    job_director: { activeOrder: null },
    isOperatorHeld: () => false,
    last_action_result: { actionId: 'before-death', phase: 'succeeded', code: 'old_result' },
  };
  let director = new AgendaDirector(agent, {
    store,
    now: () => now,
    executeCommand(_agent, command) {
      commands.push(command);
      return new Promise(resolve => { finishDirect = resolve; });
    },
  });
  const acquire = director.add({
    kind: 'acquire',
    requester: 'DadPlayer',
    target: 'fishing_rod',
    quantity: 1,
    quantityMode: 'minimum',
  });
  const catchFish = director.add({
    kind: 'catch_fish',
    requester: 'DadPlayer',
    quantity: 3,
    baselineInventory: [],
    dependsOnEntryId: acquire.id,
    dependencyPolicy: 'requires_success',
  });
  director.replace(acquire.id, {
    state: 'complete',
    finishedAt: now,
    executorId: 'goal-fishing-rod',
    attempts: 1,
    acquisitionCheckpoint: { baselineInventory: 0, targetInventory: 1 },
    evidence: { code: 'inventory_goal_verified', detail: 'Fishing Rod verified.' },
  });

  director.update();
  assert.deepEqual(commands, ['!fish(3, "none")']);
  assert.equal(director.entries.find(entry => entry.id === catchFish.id).state, 'active');

  bot.inventory.slots = [];
  now += 100;
  const reconciled = director.reconcileDeath({
    position: { x: 20, y: 64, z: 20 },
    dimension: 'overworld',
  });
  assert.deepEqual(reconciled, {
    reconciled: true,
    code: 'agenda_death_inventory_revalidation_required',
    prerequisiteId: acquire.id,
    dependentId: catchFish.id,
  });

  const rearmedAcquire = director.entries.find(entry => entry.id === acquire.id);
  const rearmedCatch = director.entries.find(entry => entry.id === catchFish.id);
  assert.equal(rearmedAcquire.state, 'pending');
  assert.equal(rearmedAcquire.attempts, 1, 'death revalidation is not another productive attempt');
  assert.deepEqual(rearmedAcquire.acquisitionCheckpoint, { baselineInventory: 0, targetInventory: 1 });
  assert.equal(rearmedAcquire.evidence.code, 'agenda_death_inventory_revalidation_required');
  assert.equal(rearmedCatch.state, 'pending');
  assert.equal(rearmedCatch.evidence.code, 'agenda_dependency_revalidation_pending');
  assert.equal(persisted.find(entry => entry.id === acquire.id).state, 'pending');
  assert.equal(persisted.find(entry => entry.id === catchFish.id).state, 'pending');

  agent.last_action_result = {
    actionId: 'stale-fish-result',
    phase: 'succeeded',
    code: 'skill_catches_verified',
    evidence: { request: { routeOrigin: 'agenda-director' } },
  };
  finishDirect();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(director.entries.find(entry => entry.id === catchFish.id).state, 'pending');

  director = new AgendaDirector(agent, { store, now: () => now });
  assert.equal(director.entries.find(entry => entry.id === acquire.id).state, 'pending');
  assert.equal(director.entries.find(entry => entry.id === catchFish.id).state, 'pending');
});

// Live seam campaign 2026-08-15. Agenda entries restored from disk never see a
// player roster, because restore runs before login. A goto bound to "RouteGuide"
// therefore survived a restart and reported skill_arrived with zero players
// online. Admission cannot catch that; dispatch can, because the roster is
// authoritative by then.
function rosterAgent(players) {
  return {
    name: 'Kevin',
    bot: { players },
    job_director: { submit: () => ({ accepted: true, id: 'job-1' }) },
  };
}

const emptyStore = () => ({ lastError: null, load: () => [], save: () => true });

test('a restored goto toward a player who is not on the roster is refused at dispatch', () => {
  const executed = [];
  const agent = rosterAgent({ Bubby: { username: 'Bubby' } });
  const director = new AgendaDirector(agent, {
    store: emptyStore(),
    now: () => 10_000,
    executeCommand: (_agent, command) => { executed.push(command); },
  });

  // Bypass admission the way a disk restore does, so only the dispatch guard
  // stands between a phantom identity and a real command.
  director.entries = [{
    id: 'agenda-restored-1',
    kind: 'goto',
    executor: 'direct',
    target: '',
    recipient: 'RouteGuide',
    requester: 'RouteGuide',
    quantity: 0,
    state: 'pending',
    createdAt: 1,
  }];

  const outcome = director.dispatch(director.entries[0]);

  assert.equal(outcome?.accepted, false);
  assert.equal(outcome?.code, 'unknown_recipient');
  assert.match(String(outcome?.detail), /RouteGuide/);
  assert.deepEqual(executed, []);
});

test('a goto toward a player who is on the roster still dispatches', () => {
  const agent = rosterAgent({ Bubby: { username: 'Bubby' } });
  const director = new AgendaDirector(agent, {
    store: emptyStore(),
    now: () => 10_000,
    executeCommand: () => {},
  });

  director.entries = [{
    id: 'agenda-restored-2',
    kind: 'goto',
    executor: 'direct',
    target: '',
    recipient: 'Bubby',
    requester: 'Bubby',
    quantity: 0,
    state: 'pending',
    createdAt: 1,
  }];

  const outcome = director.dispatch(director.entries[0]);

  assert.notEqual(outcome?.code, 'unknown_recipient');
});

test('an absent recipient fails once rather than burning the retry budget', () => {
  const agent = rosterAgent({ Bubby: { username: 'Bubby' } });
  const director = new AgendaDirector(agent, {
    store: emptyStore(),
    now: () => 10_000,
    executeCommand: () => {},
  });
  director.entries = [{
    id: 'agenda-restored-3',
    kind: 'goto',
    executor: 'direct',
    target: '',
    recipient: 'RouteGuide',
    requester: 'RouteGuide',
    quantity: 0,
    attempts: 0,
    preemptions: 0,
    state: 'pending',
    createdAt: 1,
  }];

  director.nextEligibleAt = 0;
  director.update();

  // Retrying cannot put a player in the world, so this must settle terminally
  // instead of repeating against identical evidence.
  const settled = director.entries[0];
  assert.equal(settled.state, 'failed');
  assert.equal(settled.evidence.code, 'unknown_recipient');
});
