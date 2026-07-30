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
    nextEligibleAt: null,
  });
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
