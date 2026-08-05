import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { ActionManager } from '../../src/agent/action_manager.js';
import { BehaviorArbiter } from '../../src/agent/runtime/behavior-arbiter.js';
import {
  DecisionTraceRecorder,
  extractDecisionTraces,
  formatDecisionTrace,
} from '../../src/agent/runtime/decision-trace.js';

function fakeAgent({ emergency = false, held = false, survival = null, job = null } = {}) {
  const calls = [];
  const modes = {
    beginUpdateCycle() { calls.push('modes:begin'); },
    endUpdateCycle() { calls.push('modes:end'); },
    updateBand(names) {
      calls.push(`modes:${names.join(',')}`);
      if (emergency && names.includes('self_preservation')) {
        return { active: true, mode: 'self_preservation', code: 'danger_detected' };
      }
      return { active: false, scheduled: false, code: 'inactive' };
    },
  };
  return {
    agent: {
      name: 'TraceBot',
      runtime: { autonomy: 'balanced' },
      bot: { health: 20, food: 20, oxygenLevel: 20, modes },
      actions: { executing: false, currentActionLabel: '', currentActionOwner: '' },
      environment_observer: {
        nextSampleAt: 0,
        update() { calls.push('perception:update'); },
      },
      ...(survival ? { survival_director: survival } : {}),
      ...(job ? { job_director: job } : {}),
      isOperatorHeld() { calls.push('operator:check'); return held; },
      checkTaskDone() { calls.push('task:check'); },
    },
    calls,
  };
}

test('trace enablement preserves the emergency selection and side-effect order', async () => {
  const traced = fakeAgent({ emergency: true });
  const untraced = fakeAgent({ emergency: true });
  const tracedArbiter = new BehaviorArbiter(traced.agent, { trace: { enabled: true, retention: 8 } });
  const untracedArbiter = new BehaviorArbiter(untraced.agent, { trace: { enabled: false } });

  const tracedStatus = await tracedArbiter.update(25);
  const untracedStatus = await untracedArbiter.update(25);

  assert.equal(tracedStatus.selectedLane, 'emergency_self_preservation');
  assert.equal(untracedStatus.selectedLane, tracedStatus.selectedLane);
  assert.equal(untracedStatus.code, tracedStatus.code);
  assert.deepEqual(untraced.calls, traced.calls);
  assert.equal(untracedArbiter.snapshot().decisionTrace, null);

  const trace = tracedArbiter.snapshot().decisionTrace.recent[0];
  assert.equal(trace.winner.lane, 'emergency_self_preservation');
  assert.equal(trace.lanes.find(lane => lane.lane === 'emergency_self_preservation').status, 'eligible');
  assert.equal(trace.lanes.find(lane => lane.lane === 'operator_hold').status, 'not_evaluated');
  assert.equal(trace.lanes.find(lane => lane.lane === 'attributed_protection').status, 'not_evaluated');
});

test('a safe operator-held bot selects the hold gate after checking only emergency self-preservation', async () => {
  const { agent, calls } = fakeAgent({ held: true });
  agent.operator_hold_reason = 'Operator stop is active.';
  const arbiter = new BehaviorArbiter(agent, { trace: { enabled: true, retention: 4 } });

  const status = await arbiter.update(25);

  assert.equal(status.selectedLane, 'operator_hold');
  assert.equal(status.code, 'operator_hold_safe');
  assert.match(status.reason, /No immediate self-preservation response is required/);
  assert.equal(calls.indexOf('modes:self_preservation') < calls.indexOf('operator:check'), true);
  assert.equal(calls.some(call => call === 'modes:self_defense,cowardice'), false);
  const trace = arbiter.snapshot().decisionTrace.recent[0];
  assert.equal(trace.lanes.find(lane => lane.lane === 'emergency_self_preservation').status, 'ineligible');
  assert.equal(trace.lanes.find(lane => lane.lane === 'operator_hold').status, 'eligible');
  assert.equal(trace.lanes.find(lane => lane.lane === 'basic_survival').status, 'not_evaluated');
});

test('an operator-held bot admits only the bounded self-preservation reflex and returns to hold', async () => {
  let danger = true;
  let held = true;
  let reflexRuns = 0;
  const recorded = [];
  const agent = {
    name: 'HeldBot',
    runtime: { autonomy: 'command' },
    operator_hold_reason: 'Operator stop is active.',
    bot: {
      health: 8,
      food: 20,
      oxygenLevel: 20,
      interrupt_code: false,
      output: '',
      lastActionEvidence: null,
      emit() {},
    },
    clearBotLogs() { this.bot.output = ''; },
    isOperatorHeld() { return held; },
    checkTaskDone() {},
    recordActionResult(result) {
      recorded.push(result);
      this.behavior_arbiter?.recordOutcome?.(result);
    },
    environment_observer: { nextSampleAt: 0, update() {} },
  };
  agent.actions = new ActionManager(agent);
  agent.bot.modes = {
    beginUpdateCycle() {},
    endUpdateCycle() {},
    async updateBand(names) {
      if (!names.includes('self_preservation') || !danger) {
        return { active: false, scheduled: false, code: 'inactive' };
      }
      const outcome = await agent.actions.runAction('mode:self_preservation', () => {
        reflexRuns += 1;
        assert.equal(held, true);
        agent.bot.lastActionEvidence = { outcome: 'retreated' };
        return true;
      }, { owner: 'reflex' });
      return {
        active: false,
        scheduled: outcome.success,
        mode: 'self_preservation',
        code: outcome.success ? 'mode_scheduled' : outcome.result?.code,
      };
    },
  };
  const arbiter = new BehaviorArbiter(agent, { trace: { enabled: true, retention: 4 } });
  agent.behavior_arbiter = arbiter;

  const ordinary = await agent.actions.runAction('action:consume', () => true, { owner: 'survival' });
  assert.equal(ordinary.result.code, 'operator_hold');
  assert.equal(reflexRuns, 0);

  const dangerStatus = await arbiter.update(25);
  assert.equal(dangerStatus.selectedLane, 'emergency_self_preservation');
  assert.equal(reflexRuns, 1);
  assert.equal(held, true);
  assert.equal(agent.actions.executing, false);
  assert.equal(recorded.at(-1).code, 'skill_retreated');

  danger = false;
  const heldStatus = await arbiter.update(25);
  assert.equal(heldStatus.selectedLane, 'operator_hold');
  assert.equal(heldStatus.code, 'operator_hold_safe');
  assert.equal(held, true);
  const heldTrace = arbiter.snapshot().decisionTrace.recent.at(-1);
  assert.equal(heldTrace.lanes.find(lane => lane.lane === 'emergency_self_preservation').status, 'ineligible');
  assert.equal(heldTrace.lanes.find(lane => lane.lane === 'operator_hold').status, 'eligible');

  held = false;
});

test('hunger survival ownership hands off to the persisted survival-job lane', async () => {
  let hungerPending = true;
  const survival = {
    inFlight: false,
    status: { code: 'idle' },
    update() {
      if (!hungerPending) return;
      this.inFlight = true;
      this.status = { code: 'skill_consuming' };
    },
    blocksLowerPriority() { return this.inFlight; },
  };
  const job = {
    activeOrder: { id: 'survival-shelter', source: 'survival', phase: 'assess' },
    status: { code: 'job_accepted' },
    updates: 0,
    update() {
      this.updates += 1;
      this.status = { code: 'job_assess' };
    },
  };
  const { agent } = fakeAgent({ survival, job });
  const arbiter = new BehaviorArbiter(agent, { trace: { enabled: true, retention: 4 } });

  const hungerStatus = await arbiter.update(25);
  assert.equal(hungerStatus.selectedLane, 'basic_survival');
  assert.equal(job.updates, 0);

  hungerPending = false;
  survival.inFlight = false;
  survival.status = { code: 'skill_consumed' };
  const jobStatus = await arbiter.update(25);
  assert.equal(jobStatus.selectedLane, 'basic_survival');
  assert.equal(jobStatus.code, 'job_assess');
  assert.equal(job.updates, 1);
  const trace = arbiter.snapshot().decisionTrace.recent.at(-1);
  assert.equal(trace.lanes.find(lane => lane.lane === 'basic_survival').status, 'ineligible');
  assert.equal(trace.lanes.find(lane => lane.lane === 'survival_job').status, 'eligible');
});

test('decision trace retention remains bounded and later short-circuited lanes stay explicit', async () => {
  const { agent } = fakeAgent({ emergency: true });
  const arbiter = new BehaviorArbiter(agent, { trace: { enabled: true, retention: 2 } });

  await arbiter.update(25);
  await arbiter.update(25);
  await arbiter.update(25);

  const snapshot = arbiter.snapshot().decisionTrace;
  assert.equal(snapshot.retained, 2);
  assert.equal(snapshot.retentionLimit, 2);
  assert.equal(snapshot.recent.every(trace => (
    trace.lanes.find(lane => lane.lane === 'player_goal').status === 'not_evaluated'
  )), true);
});

test('a typed goal terminal transition retains the player-goal lane for the whole arbiter tick', async () => {
  const { agent } = fakeAgent();
  let progressionUpdates = 0;
  let protectedCompletion = false;
  agent.goal_director = {
    activeGoal: { id: 'goal-terminal-handoff' },
    inFlight: false,
    status: { code: 'goal_acting' },
    update() {
      this.activeGoal = null;
      this.status = { code: 'inventory_goal_verified' };
      protectedCompletion = true;
    },
    hasProtectedCompletion: () => protectedCompletion,
  };
  agent.progression_director = {
    permitted: () => true,
    update() {
      progressionUpdates += 1;
      this.inFlight = true;
    },
    inFlight: false,
  };
  const arbiter = new BehaviorArbiter(agent, { trace: { enabled: true, retention: 4 } });

  const status = await arbiter.update(25);

  assert.equal(status.selectedLane, 'player_goal');
  assert.equal(status.code, 'inventory_goal_verified');
  assert.equal(progressionUpdates, 0);
  const trace = arbiter.snapshot().decisionTrace.recent.at(-1);
  assert.equal(trace.lanes.find(lane => lane.lane === 'player_goal').status, 'eligible');
  assert.equal(trace.lanes.find(lane => lane.lane === 'self_progression').status, 'not_evaluated');

  const protectedStatus = await arbiter.update(25);
  assert.equal(protectedStatus.selectedLane, 'player_goal');
  assert.equal(protectedStatus.code, 'player_goal_output_reserved');
  assert.equal(progressionUpdates, 0);

  protectedCompletion = false;
  arbiter.releaseTerminalHandoff('The protected completion was released.', false);
  const releasedStatus = await arbiter.update(25);
  assert.equal(releasedStatus.selectedLane, 'self_progression');
  assert.equal(progressionUpdates, 1);
});

test('bounded terminal handoff suppresses autonomy but yields to every higher companion owner', async () => {
  let now = 10_000;
  let progressionUpdates = 0;
  let standingOrderUpdates = 0;
  let agendaUpdates = 0;
  let settleReport;
  const report = new Promise(resolve => { settleReport = resolve; });
  const { agent } = fakeAgent();
  agent.rule_engine = { update() { standingOrderUpdates += 1; } };
  agent.agenda_director = { update() { agendaUpdates += 1; } };
  agent.progression_director = {
    permitted: () => true,
    update() {
      progressionUpdates += 1;
      this.inFlight = true;
    },
    inFlight: false,
  };
  agent.goal_director = {
    activeGoal: { id: 'goal-failed-handoff' },
    lastGoal: null,
    inFlight: false,
    status: { code: 'goal_acting' },
    update() {
      this.activeGoal = null;
      this.lastGoal = { id: 'goal-failed-handoff', phase: 'failed' };
      this.status = { code: 'skill_target_unreachable' };
      agent.behavior_arbiter.beginTerminalHandoff({
        goalId: this.lastGoal.id,
        phase: this.lastGoal.phase,
        code: this.status.code,
        reportPromise: report,
      });
    },
    hasProtectedCompletion: () => false,
  };
  const arbiter = new BehaviorArbiter(agent, {
    now: () => now,
    trace: { enabled: true, retention: 16 },
  });
  agent.behavior_arbiter = arbiter;

  const terminal = await arbiter.update(25);
  assert.equal(terminal.selectedLane, 'player_goal');
  assert.equal(progressionUpdates, 0);
  const standingOrdersAtTerminal = standingOrderUpdates;
  const agendaAtTerminal = agendaUpdates;

  now += 500;
  const pending = await arbiter.update(25);
  assert.equal(pending.code, 'player_goal_terminal_handoff');
  assert.equal(pending.terminalHandoff.reportPending, true);
  assert.equal(standingOrderUpdates, standingOrdersAtTerminal);
  assert.equal(agendaUpdates, agendaAtTerminal);
  assert.equal(progressionUpdates, 0);

  settleReport(true);
  await Promise.resolve();
  now += 400;
  assert.equal((await arbiter.update(25)).code, 'player_goal_terminal_handoff');
  now += 200;
  const released = await arbiter.update(25);
  assert.equal(released.selectedLane, 'self_progression');
  assert.equal(progressionUpdates, 1);

  progressionUpdates = 0;
  agent.progression_director.inFlight = false;
  const neverSettles = new Promise(() => {});
  arbiter.beginTerminalHandoff({
    goalId: 'goal-priority-handoff',
    phase: 'failed',
    code: 'failed',
    reportPromise: neverSettles,
  });

  agent.isOperatorHeld = () => true;
  assert.equal((await arbiter.update(25)).selectedLane, 'operator_hold');
  assert.equal(progressionUpdates, 0);
  agent.isOperatorHeld = () => false;

  agent.survival_director = {
    inFlight: false,
    update() { this.inFlight = true; },
    blocksLowerPriority() { return this.inFlight; },
  };
  assert.equal((await arbiter.update(25)).selectedLane, 'basic_survival');
  assert.equal(progressionUpdates, 0);
  agent.survival_director = null;

  agent.companion_context = { snapshot: () => ({ directive: { kind: 'follow' } }) };
  agent.actions = {
    executing: true,
    currentActionId: 'follow-action',
    currentActionLabel: 'action:follow',
    currentActionOwner: 'player',
  };
  assert.equal((await arbiter.update(25)).selectedLane, 'player_directive');
  assert.equal(arbiter.snapshot().terminalHandoff, null);
  assert.equal(progressionUpdates, 0);

  agent.actions = { executing: false, currentActionLabel: '', currentActionOwner: '' };
  agent.companion_context = null;
  arbiter.beginTerminalHandoff({
    goalId: 'goal-before-new-command',
    phase: 'failed',
    code: 'failed',
    reportPromise: neverSettles,
  });
  agent.goal_director.activeGoal = { id: 'goal-new-player-command' };
  agent.goal_director.update = function update() {
    this.status = { code: 'goal_assess' };
  };
  assert.equal((await arbiter.update(25)).selectedLane, 'player_goal');
  assert.equal(arbiter.snapshot().terminalHandoff, null);
  assert.equal(progressionUpdates, 0);

  agent.goal_director.activeGoal = null;
  arbiter.beginTerminalHandoff({
    outcomeId: 'job-complete-handoff',
    owner: 'player_job',
    phase: 'complete',
    code: 'delivery_verified',
  });
  const playerJobHandoff = await arbiter.update(25);
  assert.equal(playerJobHandoff.selectedLane, 'player_job');
  assert.equal(playerJobHandoff.code, 'player_job_terminal_handoff');
  assert.equal(playerJobHandoff.terminalHandoff.outcomeId, 'job-complete-handoff');
  assert.equal(progressionUpdates, 0);
});

test('scheduled wakes record prior-period overrun while event-driven early wakes do not', async () => {
  const { agent } = fakeAgent({ emergency: true });
  const arbiter = new BehaviorArbiter(agent, { trace: { enabled: true, retention: 4 } });

  await arbiter.update(350);
  arbiter.lastWakeReason = 'entity_hurt';
  await arbiter.update(900);
  assert.equal(
    arbiter.snapshot().decisionTrace.recent.at(-1).trigger.code,
    'entity_hurt',
  );
  await arbiter.update(100);

  const delay = arbiter.snapshot().decisionTrace.diagnostics.scheduledLoopDelayMs;
  assert.deepEqual(delay, {
    samples: 2,
    retentionLimit: 4,
    p50: 20,
    p95: 50,
    p99: 50,
    max: 50,
  });
});

test('nearest-rank timing summaries are deterministic, bounded, and null when empty', () => {
  let monotonic = 0;
  const recorder = new DecisionTraceRecorder({
    retention: 4,
    now: () => 1_000,
    monotonicNow: () => monotonic,
  });
  for (const [evaluation, cleanup] of [[1, 9], [2, 8], [3, 7], [4, 6], [100, 5]]) {
    const started = monotonic;
    recorder.begin();
    monotonic += evaluation + cleanup;
    recorder.finalize({ evaluationFinishedMs: started + evaluation });
  }
  for (const overrun of [1, 2, 3, 4, 100]) {
    recorder.recordScheduledLoopDelay(300 + overrun, 300);
  }

  const diagnostics = recorder.snapshot().diagnostics;
  assert.deepEqual(diagnostics.timing.evaluationMs, {
    samples: 4,
    retentionLimit: 4,
    p50: 3,
    p95: 100,
    p99: 100,
    max: 100,
  });
  assert.deepEqual(diagnostics.timing.cleanupMs, {
    samples: 4,
    retentionLimit: 4,
    p50: 6,
    p95: 8,
    p99: 8,
    max: 8,
  });
  assert.deepEqual(diagnostics.timing.totalMs, {
    samples: 4,
    retentionLimit: 4,
    p50: 10,
    p95: 105,
    p99: 105,
    max: 105,
  });
  assert.deepEqual(diagnostics.scheduledLoopDelayMs, {
    samples: 4,
    retentionLimit: 4,
    p50: 3,
    p95: 100,
    p99: 100,
    max: 100,
  });

  const empty = new DecisionTraceRecorder({ retention: 4 }).snapshot().diagnostics;
  const emptySummary = {
    samples: 0,
    retentionLimit: 4,
    p50: null,
    p95: null,
    p99: null,
    max: null,
  };
  for (const summary of [
    empty.timing.evaluationMs,
    empty.timing.cleanupMs,
    empty.timing.totalMs,
    empty.scheduledLoopDelayMs,
  ]) assert.deepEqual(summary, emptySummary);
  assert.equal(empty.actionLifecycles.durationMs.samples, 0);
  assert.equal(empty.actionLifecycles.durationMs.p50, null);
  assert.equal(empty.actionLifecycles.durationMs.p95, null);
  assert.equal(empty.actionLifecycles.durationMs.p99, null);
  assert.equal(empty.actionLifecycles.durationMs.max, null);
});

test('action acquisition, release, and outcome link exactly once to the selecting decision', () => {
  let monotonic = 10;
  const recorder = new DecisionTraceRecorder({
    agent: 'TraceBot',
    now: () => 1_000,
    monotonicNow: () => monotonic += 1,
  });
  recorder.begin({ tick: 1, trigger: { code: 'scheduled_tick', deltaMs: 25 } });
  recorder.startLane('player_goal');
  recorder.select({ lane: 'player_goal', reasonCode: 'player_goal_selected', lowerLanesSuppressed: true });
  recorder.finalize({ evaluationFinishedMs: monotonic });
  assert.equal(recorder.linkAction({
    actionId: 'TraceBot-1-1000',
    owner: 'player',
    ownerPriority: 30,
    label: '!collect',
    acquiredAt: 1_001,
    startedAt: 1_000,
  }), true);
  assert.equal(recorder.linkRelease({
    actionId: 'TraceBot-1-1000',
    owner: 'player',
    ownerPriority: 30,
    releasedAt: 1_024,
  }), true);
  assert.equal(recorder.linkRelease({
    actionId: 'TraceBot-1-1000',
    owner: 'player',
    ownerPriority: 30,
    releasedAt: 1_999,
  }), false);
  assert.equal(recorder.linkOutcome({
    actionId: 'TraceBot-1-1000',
    phase: 'succeeded',
    code: 'skill_collected',
    startedAt: 1_000,
    finishedAt: 1_025,
  }), true);
  assert.equal(recorder.linkAction({
    actionId: 'TraceBot-1-1000',
    acquiredAt: 2_000,
    startedAt: 2_000,
  }), false);
  assert.equal(recorder.linkOutcome({
    actionId: 'TraceBot-1-1000',
    phase: 'failed',
    code: 'duplicate',
    startedAt: 1_000,
    finishedAt: 1_999,
  }), false);

  const trace = recorder.snapshot(1).recent[0];
  assert.deepEqual(trace.actionLifecycle.acquisition, {
    actionId: 'TraceBot-1-1000',
    owner: 'player',
    ownerPriority: 30,
    acquiredAt: 1_001,
    startedAt: 1_000,
    source: 'linked_action_start',
  });
  assert.deepEqual(trace.actionLifecycle.release, {
    actionId: 'TraceBot-1-1000',
    owner: 'player',
    ownerPriority: 30,
    releasedAt: 1_024,
    phase: 'succeeded',
    code: 'skill_collected',
  });
  assert.equal(trace.correlation.outcomeLinked, true);
  assert.equal(trace.outcome.code, 'skill_collected');
  assert.equal(trace.outcome.durationMs, 25);
  const lifecycle = recorder.snapshot(1).diagnostics.actionLifecycles.recent[0];
  assert.equal(lifecycle.durationMs, 24);
  assert.equal(lifecycle.outcome.code, 'skill_collected');
  assert.equal(recorder.snapshot(1).diagnostics.actionLifecycles.retained, 1);

  trace.actionLifecycle.release.code = 'mutated';
  assert.equal(recorder.snapshot(1).recent[0].actionLifecycle.release.code, 'skill_collected');

  const fallback = new DecisionTraceRecorder();
  assert.equal(fallback.linkAction({
    actionId: 'fallback-action',
    acquiredAt: 2_000,
  }), true);
  assert.equal(fallback.linkRelease({
    actionId: 'fallback-action',
    releasedAt: 2_010,
  }), true);
  assert.equal(
    fallback.snapshot(1).diagnostics.actionLifecycles.recent[0].durationMs,
    10,
  );
});

test('action lifecycle survives selecting trace eviction and records release once', () => {
  const recorder = new DecisionTraceRecorder({ retention: 1, now: () => 1_000 });
  recorder.begin({ tick: 1 });
  recorder.select({ lane: 'player_goal', reasonCode: 'selected', lowerLanesSuppressed: true });
  recorder.finalize();
  recorder.linkAction({ actionId: 'evicted-action', owner: 'player', acquiredAt: 10, startedAt: 10 });

  recorder.begin({ tick: 2 });
  recorder.finalize();
  assert.equal(recorder.snapshot().recent[0].correlation.actionId, null);
  assert.equal(recorder.linkRelease({ actionId: 'evicted-action', owner: 'player', releasedAt: 35 }), true);
  assert.equal(recorder.linkRelease({ actionId: 'evicted-action', owner: 'player', releasedAt: 99 }), false);
  assert.equal(recorder.linkOutcome({
    actionId: 'evicted-action',
    phase: 'succeeded',
    code: 'completed',
    startedAt: 10,
    finishedAt: 36,
  }), true);

  const lifecycles = recorder.snapshot().diagnostics.actionLifecycles;
  assert.equal(lifecycles.retained, 1);
  assert.equal(lifecycles.recent[0].durationMs, 25);
  assert.equal(lifecycles.recent[0].release.code, 'completed');
  assert.equal(lifecycles.recent[0].outcome.code, 'completed');
});

test('action lifecycle retention is bounded independently of trace retention', () => {
  const recorder = new DecisionTraceRecorder({ retention: 1 });
  const lifecycleRetention = recorder.snapshot().diagnostics.actionLifecycles.retentionLimit;
  assert.equal(lifecycleRetention > recorder.retention, true);

  for (let index = 0; index <= lifecycleRetention; index += 1) {
    const actionId = `bounded-${index}`;
    assert.equal(recorder.linkAction({
      actionId,
      startedAt: index * 10,
    }), true);
    assert.equal(recorder.linkRelease({
      actionId,
      releasedAt: index * 10 + 5,
    }), true);
  }

  const diagnostics = recorder.snapshot().diagnostics.actionLifecycles;
  assert.equal(recorder.snapshot().retained, 0);
  assert.equal(diagnostics.retained, lifecycleRetention);
  assert.equal(diagnostics.durationMs.samples, lifecycleRetention);
  assert.equal(diagnostics.durationMs.p50, 5);
  assert.equal(diagnostics.durationMs.p95, 5);
  assert.equal(diagnostics.durationMs.p99, 5);
  assert.equal(diagnostics.durationMs.max, 5);
  assert.equal(diagnostics.recent.at(-1).actionId, `bounded-${lifecycleRetention}`);
});

test('active action snapshots carry bounded provenance and owner priority', async () => {
  const { agent } = fakeAgent({ emergency: true });
  agent.actions = {
    executing: true,
    currentActionId: `active-${'x'.repeat(100)}`,
    currentActionOwner: 'job',
    currentActionLabel: '!build',
    currentActionStartedAt: 900,
    ownerPriority: () => 20,
  };
  const arbiter = new BehaviorArbiter(agent, {
    trace: { enabled: true, retention: 1 },
    now: () => 1_000,
  });

  await arbiter.update(25);

  const acquisition = arbiter.snapshot().decisionTrace.recent[0].actionLifecycle.acquisition;
  assert.equal(acquisition.actionId.length, 80);
  assert.equal(acquisition.owner, 'job');
  assert.equal(acquisition.ownerPriority, 20);
  assert.equal(acquisition.acquiredAt, 900);
  assert.equal(acquisition.startedAt, 900);
  assert.equal(acquisition.source, 'active_snapshot');
});

test('disabled lifecycle recorder methods are no-ops', () => {
  const recorder = new DecisionTraceRecorder({ enabled: false });
  assert.equal(recorder.recordScheduledLoopDelay(500, 300, true), false);
  assert.equal(recorder.linkAction({ actionId: 'disabled' }), false);
  assert.equal(recorder.linkRelease({ actionId: 'disabled', releasedAt: 1 }), false);
  assert.equal(recorder.linkOutcome({ actionId: 'disabled', phase: 'succeeded', code: 'completed' }), false);
  assert.equal(recorder.snapshot(), null);
});

test('the compact reporter formats the representative v1 fixture', () => {
  const fixtureUrl = new URL('../fixtures/decision-trace.v1.json', import.meta.url);
  const fixture = JSON.parse(fs.readFileSync(fixtureUrl, 'utf8'));
  const traces = extractDecisionTraces(fixture);
  const report = formatDecisionTrace(traces[0]);

  assert.equal(traces.length, 1);
  assert.match(report, /winner=attributed_protection reason=damage_attributed control=acquired/);
  assert.match(report, /attributed_protection: eligible/);
  assert.match(report, /preemption=player:!collect->attributed_protection/);
  assert.match(report, /outcome=interrupted:interrupted action=TraceBot-41-1785520800000/);
});
