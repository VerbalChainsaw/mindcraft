import assert from 'node:assert/strict';
import test from 'node:test';

import { Agent } from '../../src/agent/agent.js';
import { AgendaDirector } from '../../src/agent/runtime/agenda-director.js';

// Drive Agent.dispatchPlayerAgenda against a minimal fake `this`, so the
// append / interrupt / takeover branching is verified without spinning a bot.
// The real directive resolver runs; the messages used resolve without a bot
// registry (mining, harvest, come-here).
function makeFakeAgent({ remaining = 0 } = {}) {
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
    responses: [],
  };
  const agent = {
    name: 'TestBot',
    runtime: { role: 'companion' },
    bot: {},
    agenda_director: {
      add(entry) { calls.added.push(entry); return { accepted: true, description: `${entry.kind} ${entry.target || entry.recipient || ''}`.trim() }; },
      clear() { calls.cleared += 1; return { cleared: remaining }; },
      snapshot() { return { remaining }; },
    },
    history: { add() {}, save() {} },
    actions: { cancelResume() { calls.cancelResume += 1; }, async stop() { calls.stop += 1; return { stopped: true }; } },
    goal_director: { cancel() { calls.goalCancel += 1; } },
    job_director: { cancel() { calls.jobCancel += 1; } },
    companion_context: { setDirective() { calls.directiveCleared += 1; } },
    self_prompter: { interruptForManualCommand() { calls.selfPromptInterrupt += 1; } },
    role_director: { deferForManualCommand() { calls.roleDefer += 1; } },
    releaseOperatorHold() { calls.operatorHoldReleased += 1; },
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

test('dispatchPlayerAgenda ignores a lone task so the fast path handles it', async () => {
  const { agent, calls } = makeFakeAgent({ remaining: 0 });
  const handled = await Agent.prototype.dispatchPlayerAgenda.call(agent, 'Gabriel', 'Gabriel', 'mine 10 iron');
  assert.equal(handled, false, 'a single task with no chain stays on the single-directive path');
  assert.equal(calls.added.length, 0);
  assert.equal(calls.stop, 0);
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
