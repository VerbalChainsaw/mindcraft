import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { BehaviorArbiter } from '../../src/agent/runtime/behavior-arbiter.js';
import {
  DecisionTraceRecorder,
  extractDecisionTraces,
  formatDecisionTrace,
} from '../../src/agent/runtime/decision-trace.js';

function fakeAgent({ emergency = false } = {}) {
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
      isOperatorHeld() { calls.push('operator:check'); return false; },
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
  assert.equal(trace.lanes.find(lane => lane.lane === 'operator_hold').status, 'ineligible');
  assert.equal(trace.lanes.find(lane => lane.lane === 'emergency_self_preservation').status, 'eligible');
  assert.equal(trace.lanes.find(lane => lane.lane === 'attributed_protection').status, 'not_evaluated');
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

test('action start and outcome link to the selecting decision by action id', () => {
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
  recorder.linkAction({ actionId: 'TraceBot-1-1000', owner: 'player', label: '!collect', startedAt: 1_000 });
  recorder.linkOutcome({
    actionId: 'TraceBot-1-1000',
    phase: 'succeeded',
    code: 'skill_collected',
    startedAt: 1_000,
    finishedAt: 1_025,
  });

  const trace = recorder.snapshot(1).recent[0];
  assert.equal(trace.correlation.outcomeLinked, true);
  assert.equal(trace.outcome.code, 'skill_collected');
  assert.equal(trace.outcome.durationMs, 25);
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
