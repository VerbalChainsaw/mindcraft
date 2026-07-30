import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeRuntimeBehavior,
  runtimeBehaviorToProfile,
} from '../../src/agent/runtime/behavior-config.js';

test('Given explicit behavior policies, normalization preserves bounded survival, job, and reaction contracts', () => {
  const runtime = normalizeRuntimeBehavior({
    name: 'PolicyBot',
    runtime: {
      survival: {
        mode: 'full',
        eatAt: 14,
        criticalFood: 5,
        reserveFoodPoints: 12,
        sleep: 'safe',
        shelter: 'emergency',
        armor: 'upgrade',
        usefulDrops: 'collect',
      },
      jobs: {
        mode: 'resumable',
        stockpileLimit: 128,
        deposit: 'leader',
      },
      reactions: {
        mode: 'natural',
        maxSpeechPerMinute: 4,
        maxGesturesPerMinute: 8,
      },
      assignment: {
        leader: 'Director',
        deposit: { name: 'ore_barrel', x: 12.8, y: 64, z: -7.1 },
      },
    },
  });

  assert.deepEqual(runtime.survival, {
    mode: 'full',
    eatAt: 14,
    criticalFood: 5,
    reserveFoodPoints: 12,
    sleep: 'safe',
    shelter: 'emergency',
    armor: 'upgrade',
    usefulDrops: 'collect',
  });
  assert.deepEqual(runtime.jobs, {
    mode: 'resumable',
    stockpileLimit: 128,
    deposit: 'leader',
  });
  assert.deepEqual(runtime.reactions, {
    mode: 'natural',
    maxSpeechPerMinute: 4,
    maxGesturesPerMinute: 8,
  });
  assert.equal(Object.isFrozen(runtime.survival), true);
  assert.equal(Object.isFrozen(runtime.jobs), true);
  assert.equal(Object.isFrozen(runtime.reactions), true);
  assert.deepEqual(runtime.assignment.deposit, {
    name: 'ore_barrel',
    x: 12,
    y: 64,
    z: -8,
  });

  const persisted = runtimeBehaviorToProfile(runtime);
  assert.deepEqual(persisted.survival, runtime.survival);
  assert.deepEqual(persisted.jobs, runtime.jobs);
  assert.deepEqual(persisted.reactions, runtime.reactions);
  assert.deepEqual(persisted.assignment.deposit, runtime.assignment.deposit);
});

test('Given a legacy profile without runtime behavior, normalization preserves conservative compatibility defaults', () => {
  const runtime = normalizeRuntimeBehavior({ name: 'LegacyBot' });

  assert.equal(runtime.survival.mode, 'basic');
  assert.equal(runtime.jobs.mode, 'simple');
  assert.equal(runtime.reactions.mode, 'minimal');
});
