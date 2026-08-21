import test from 'node:test';
import assert from 'node:assert/strict';

import { selectCollectionExecutionOwner } from '../src/agent/library/skills.js';

test('a target at an already-verified mining stance is mined directly', () => {
  assert.equal(selectCollectionExecutionOwner(true), 'bound_target_direct');
  assert.equal(selectCollectionExecutionOwner(false), 'collectblock');
  assert.equal(selectCollectionExecutionOwner(undefined), 'collectblock');
});
