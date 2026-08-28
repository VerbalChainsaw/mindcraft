import assert from 'node:assert/strict';
import test from 'node:test';

import { BehaviorDirector } from '../../src/agent/runtime/behavior-director.js';

function createAgent() {
  return {
    bot: { entity: { id: 1 } },
    isIdle: () => true,
    isOperatorHeld: () => false,
  };
}

test('Given an eligible agent, a director acquires one in-flight action and publishes its terminal result', () => {
  const director = new BehaviorDirector(createAgent(), { name: 'survival' });

  assert.equal(director.canSchedule(), true);
  assert.equal(director.begin('eating', { name: 'bread' }, 'Low hunger.'), true);
  assert.equal(director.canSchedule(), false);
  assert.equal(director.begin('sleeping', { name: 'bed' }), false);

  director.finish({
    phase: 'succeeded',
    code: 'consumed',
    detail: 'Ate bread.',
    target: { name: 'bread' },
    retryable: false,
  });

  assert.equal(director.canSchedule(), true);
  assert.deepEqual(director.snapshot(), {
    name: 'survival',
    phase: 'succeeded',
    code: 'consumed',
    target: { name: 'bread' },
    detail: 'Ate bread.',
    retryable: false,
    inFlight: false,
    dispatchLease: null,
    nextEligibleAt: null,
  });
});

test('a director dispatch lease adopts terminal actuator truth and fails open when orphaned', () => {
  const agent = createAgent();
  agent.actions = {
    executing: true,
    currentActionLabel: 'action:test',
    currentActivity: null,
    lastActivity: null,
    lastResult: null,
  };
  const director = new BehaviorDirector(agent, { name: 'survival' });
  assert.equal(director.begin('recovering'), true);
  const lease = director.beginDispatchLease({
    owner: 'survival',
    missionId: 'survival:return_home',
    activityId: 'return_home',
    now: 1_000,
  });
  agent.actions.currentActivity = {
    missionId: lease.missionId,
    activityId: lease.activityId,
    actionId: 'action-1',
    startedAt: 1_001,
  };
  assert.equal(director.reconcileDispatchLease({ now: 1_100 }).state, 'active');

  agent.actions.executing = false;
  agent.actions.currentActionLabel = '';
  agent.actions.lastActivity = { ...agent.actions.currentActivity };
  agent.actions.currentActivity = null;
  agent.actions.lastResult = {
    actionId: 'action-1',
    phase: 'succeeded',
    code: 'skill_arrived',
  };
  const terminal = director.reconcileDispatchLease({ now: 1_200 });
  assert.equal(terminal.state, 'terminal');
  assert.equal(terminal.result, agent.actions.lastResult);
  assert.equal(director.claimDispatchSettlement(lease), true);
  director.finish(terminal.result);

  assert.equal(director.begin('recovering'), true);
  const orphan = director.beginDispatchLease({
    owner: 'survival',
    missionId: 'survival:return_home',
    activityId: 'return_home',
    now: 2_000,
  });
  agent.actions.lastActivity = null;
  agent.actions.lastResult = null;
  const orphaned = director.reconcileDispatchLease({ now: 3_501 });
  assert.equal(orphaned.state, 'orphaned');
  assert.equal(orphaned.elapsedMs, 1_501);
  assert.equal(director.claimDispatchSettlement(orphan), true);
  director.fail('dispatch_orphaned', 'No actuator activity started.', true);
  assert.equal(director.inFlight, false);
  assert.equal(director.canSchedule(), true);
});

test('Given malformed terminal status, a director fails closed and bounds public fields', () => {
  const director = new BehaviorDirector(createAgent(), { name: 'job' });
  assert.equal(director.begin('working'), true);

  director.finish({
    phase: 'invented-success',
    code: `bad\u0000code${'x'.repeat(100)}`,
    detail: `unsafe\u0000detail ${'y'.repeat(400)}`,
    target: { name: `oak\u0000log${'z'.repeat(120)}`, secret: 'do-not-project' },
    retryable: true,
  });

  const status = director.snapshot();
  assert.equal(status.phase, 'failed');
  assert.equal(status.code.length <= 80, true);
  assert.equal(status.detail.length <= 280, true);
  assert.equal(status.target.name.length <= 96, true);
  assert.equal(status.code.includes('\u0000'), false);
  assert.equal(status.detail.includes('\u0000'), false);
  assert.equal('secret' in status.target, false);
});
