import assert from 'node:assert/strict';
import test from 'node:test';

import { mayBindExactWorkstation } from '../../src/agent/commands/workstation-command-policy.js';

test('model-selected actions cannot bind guessed exact workstation coordinates', () => {
  assert.equal(mayBindExactWorkstation({ routeOrigin: 'model-selected' }), false);
  assert.equal(mayBindExactWorkstation({ routeOrigin: 'goal-director' }), true);
  assert.equal(mayBindExactWorkstation({ routeOrigin: 'deterministic-nl' }), true);
});
