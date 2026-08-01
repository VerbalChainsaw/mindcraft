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
