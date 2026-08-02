import assert from 'node:assert/strict';
import test from 'node:test';

import { getJobDirectorState } from '../../src/agent/library/full_state.js';

test('Given an active work order, job telemetry exposes bounded progress without blueprint or queue internals', () => {
  const state = getJobDirectorState({
    job_director: {
      snapshot: () => ({
        phase: 'acting',
        code: 'job_execute',
        retryable: true,
        nextAttemptAt: 123,
        workOrder: {
          id: 'build-1',
          role: 'builder',
          kind: 'build',
          source: 'survival',
          requester: 'TestBot',
          phase: 'execute',
          target: { name: 'worksite', x: 1, y: 64, z: 2 },
          attempts: 1,
          maxAttempts: 3,
          checkpoint: { verifiedCount: 12, nextCell: 13, privateCells: ['hidden'] },
          evidence: { code: 'cell_verified', detail: 'ok', actionId: 'a-1', raw: 'hidden' },
        },
        queue: ['hidden'],
      }),
    },
  });

  assert.deepEqual(state, {
    phase: 'acting',
    code: 'job_execute',
    retryable: true,
    nextAttemptAt: 123,
    workOrder: {
      id: 'build-1',
      role: 'builder',
      kind: 'build',
      source: 'survival',
      requester: 'TestBot',
      phase: 'execute',
      target: { name: 'worksite', x: 1, y: 64, z: 2 },
      attempts: 1,
      maxAttempts: 3,
      checkpoint: { verifiedCount: 12, nextCell: 13 },
      evidence: { code: 'cell_verified', detail: 'ok', actionId: 'a-1' },
    },
  });
});
