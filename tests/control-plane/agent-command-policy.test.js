import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveBlockedActions } from '../../src/agent/command-policy.js';

test('Given normal bot settings, when command policy is resolved, then process restart and insecure code generation are unavailable', () => {
  const blocked = resolveBlockedActions({
    configured: ['!setMode', '!setMode', null],
    task: ['!goal', 42],
    allowInsecureCoding: false,
  });

  assert.deepEqual(blocked, ['!setMode', '!goal', '!restart', '!newAction']);
});

test('Given explicitly enabled insecure coding, when command policy is resolved, then newAction is allowed but self-restart remains operator-only', () => {
  const blocked = resolveBlockedActions({
    configured: [],
    task: [],
    allowInsecureCoding: true,
  });

  assert.deepEqual(blocked, ['!restart']);
});
