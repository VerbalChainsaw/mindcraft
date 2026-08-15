import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BehaviorEventBus,
  normalizeBehaviorEvent,
} from '../../src/agent/runtime/behavior-event.js';

test('Given factual behavior data, normalization returns a bounded immutable event', () => {
  const event = normalizeBehaviorEvent({
    id: 'job-1',
    type: 'job.completed',
    actor: 'Timber',
    target: { name: 'oak_log', x: 4, y: 64, z: -2, distance: 6 },
    evidence: { workOrderId: 'logs-1', actionId: 'a-1', code: 'quota_met' },
    salience: 4,
    timestamp: 1000,
    witnesses: ['Builder', 'Miner'],
  });

  assert.deepEqual(event, {
    id: 'job-1',
    type: 'job.completed',
    actor: 'Timber',
    target: { name: 'oak_log', x: 4, y: 64, z: -2, distance: 6 },
    evidence: { workOrderId: 'logs-1', actionId: 'a-1', code: 'quota_met' },
    salience: 4,
    timestamp: 1000,
    witnesses: ['Builder', 'Miner'],
  });
  assert.equal(Object.isFrozen(event), true);

  const goalEvent = normalizeBehaviorEvent({
    id: 'goal-1-complete',
    type: 'goal.completed',
    actor: 'Timber',
    target: { name: 'oak_logs' },
    evidence: {
      goalId: 'goal-1',
      procedureId: 'procedure-1',
      code: 'inventory_goal_verified',
      phase: 'complete',
    },
    salience: 4,
    timestamp: 1001,
  });
  assert.equal(goalEvent.evidence.goalId, 'goal-1');
  assert.equal(goalEvent.evidence.procedureId, 'procedure-1');

  const deathEvent = normalizeBehaviorEvent({
    id: 'kevin-death-1',
    type: 'self.died',
    actor: 'Kevin',
    target: { name: 'death', x: 12, y: 64, z: -4 },
    evidence: {
      amount: 7,
      code: 'death_recorded',
      phase: 'stored',
    },
    salience: 5,
  });
  assert.deepEqual(deathEvent.evidence, {
    code: 'death_recorded',
    phase: 'stored',
    amount: 7,
  });
});

test('Given unknown types or unsafe raw metadata, normalization rejects rather than leaking prose or secrets', () => {
  assert.throws(() => normalizeBehaviorEvent({ type: 'unknown.event' }), /type/i);
  assert.throws(
    () => normalizeBehaviorEvent({
      type: 'action.failed',
      actor: 'Bot',
      evidence: { rawLog: 'api_key=secret' },
    }),
    /evidence/i,
  );
  assert.throws(
    () => normalizeBehaviorEvent({
      type: 'threat.detected',
      actor: 'Bot',
      target: { name: 'zombie', x: Infinity },
    }),
    /coordinate/i,
  );
});

test('Given duplicate or excessive events, the per-agent bus deduplicates and remains bounded', () => {
  const bus = new BehaviorEventBus('Bot', { maxQueue: 3 });
  assert.equal(bus.publish({ id: 'same', type: 'time.sunrise', salience: 2 }), true);
  assert.equal(bus.publish({ id: 'same', type: 'time.sunrise', salience: 2 }), false);
  for (const id of ['two', 'three', 'four']) {
    bus.publish({ id, type: 'time.sunset', salience: 2 });
  }
  assert.deepEqual(bus.drain(10).map(event => event.id), ['two', 'three', 'four']);

  bus.publish({
    id: 'goal-action-1',
    type: 'action.failed',
    evidence: { actionId: 'goal-action-1', code: 'timeout', phase: 'failed' },
    salience: 3,
  });
  bus.publish({
    id: 'unrelated-action-1',
    type: 'action.failed',
    evidence: { actionId: 'unrelated-action-1', code: 'timeout', phase: 'failed' },
    salience: 3,
  });
  assert.equal(bus.supersedeActionFailures(['goal-action-1']), 1);
  assert.deepEqual(bus.drain(10).map(event => event.id), ['unrelated-action-1']);
});
