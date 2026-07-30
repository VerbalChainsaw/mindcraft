import assert from 'node:assert/strict';
import test from 'node:test';

import { getSurvivalDirectorState } from '../../src/agent/library/full_state.js';

test('Given a survival director snapshot, telemetry is bounded and contains no mutable internal state', () => {
  const state = getSurvivalDirectorState({
    survival_director: {
      snapshot: () => ({
        name: 'survival',
        phase: 'acting',
        code: `eat_${'x'.repeat(120)}`,
        target: { name: 'bread', x: 1, internal: { secret: true } },
        detail: 'recover '.repeat(100),
        retryable: true,
        nextEligibleAt: 1234,
        privateQueue: ['do not expose'],
      }),
    },
  });

  assert.equal(state.name, 'survival');
  assert.equal(state.phase, 'acting');
  assert.equal(state.code.length, 80);
  assert.deepEqual(state.target, { name: 'bread', x: 1 });
  assert.equal(state.detail.length, 280);
  assert.equal(state.retryable, true);
  assert.equal(state.nextEligibleAt, 1234);
  assert.equal('privateQueue' in state, false);
});
