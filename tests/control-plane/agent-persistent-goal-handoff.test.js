import assert from 'node:assert/strict';
import test from 'node:test';

import { Agent } from '../../src/agent/agent.js';

test('explicit player item goal yields the body before cancelling a stale work order', async () => {
  const calls = [];
  const agent = {
    self_prompter: {
      interruptForManualCommand() { calls.push('interrupt'); },
    },
    actions: {
      cancelResume() { calls.push('cancel-resume'); },
      stop() {
        calls.push('stop');
        return Promise.resolve({ stopped: true });
      },
    },
    job_director: {
      cancel(reason) {
        calls.push(`cancel-job:${reason}`);
        return true;
      },
    },
    takePersistentJobControl: Agent.prototype.takePersistentJobControl,
  };

  const result = await Agent.prototype.takePersistentGoalControl.call(agent);

  assert.deepEqual(result, { ready: true, detail: '' });
  assert.deepEqual(calls, [
    'interrupt',
    'cancel-resume',
    'stop',
    'cancel-job:Superseded by an explicit player item goal.',
  ]);
});

test('failed body handoff preserves the work order and refuses the player item goal', async () => {
  const calls = [];
  const agent = {
    self_prompter: {
      interruptForManualCommand() { calls.push('interrupt'); },
    },
    actions: {
      currentActionLabel: 'action:placeBlockAt',
      cancelResume() { calls.push('cancel-resume'); },
      stop() {
        calls.push('stop');
        return Promise.resolve({ stopped: false });
      },
    },
    job_director: {
      cancel() { calls.push('cancel-job'); },
    },
    holdPosition(reason) { calls.push(`hold:${reason}`); },
    takePersistentJobControl: Agent.prototype.takePersistentJobControl,
  };

  const result = await Agent.prototype.takePersistentGoalControl.call(agent);

  assert.equal(result.ready, false);
  assert.match(result.detail, /action:placeBlockAt/);
  assert.deepEqual(calls, [
    'interrupt',
    'cancel-resume',
    'stop',
    'hold:persistent job handoff failed',
  ]);
});

test('Operator Stop holds the body without cancelling durable player work', () => {
  const calls = [];
  const agent = {
    operator_hold: false,
    operator_hold_generation: 0,
    operator_control: { hold(reason) { calls.push(`persist:${reason}`); } },
    companion_context: { clearControl() { calls.push('clear-control'); } },
    actions: { cancelResume() { calls.push('cancel-resume'); } },
    goal_director: { cancel() { calls.push('cancel-goal'); } },
    job_director: { cancel() { calls.push('cancel-job'); } },
    prompter: { cancelPendingModelGeneration() { calls.push('cancel-model'); } },
    self_prompter: { stop() { calls.push('stop-prompter'); } },
    requestInterrupt() { calls.push('interrupt-body'); },
    history: { save() { calls.push('save-history'); } },
  };

  const generation = Agent.prototype.holdPosition.call(
    agent,
    'operator stop command',
    { preserveDurableWork: true },
  );

  assert.equal(generation, 1);
  assert.equal(agent.operator_hold, true);
  assert.equal(calls.includes('cancel-goal'), false);
  assert.equal(calls.includes('cancel-job'), false);
  assert.deepEqual(calls, [
    'persist:operator stop command',
    'clear-control',
    'cancel-resume',
    'cancel-model',
    'stop-prompter',
    'interrupt-body',
    'save-history',
  ]);
});

test('releasing Operator Hold clears its surface stance before later player authority', () => {
  const calls = [];
  const agent = {
    operator_hold: true,
    operator_hold_generation: 4,
    behavior_arbiter: {
      releaseHeldSurfaceStance(reason) { calls.push(`surface:${reason}`); },
    },
    operator_control: { release(reason) { calls.push(`persist:${reason}`); } },
    history: { save() { calls.push('save-history'); } },
  };

  const released = Agent.prototype.releaseOperatorHold.call(agent, 'player command');

  assert.equal(released, true);
  assert.equal(agent.operator_hold, false);
  assert.equal(agent.operator_hold_generation, 5);
  assert.deepEqual(calls, [
    'surface:operator_hold_released',
    'persist:player command',
    'save-history',
  ]);
});
