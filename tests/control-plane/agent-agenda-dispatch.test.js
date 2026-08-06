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
