import assert from 'node:assert/strict';
import test from 'node:test';

import { deliveryDropSpacingNeedsRetreat } from '../src/agent/library/skills.js';

test('delivery retreats from the failed close toss stance but preserves a proven receiving stance', () => {
  const player = { x: 1028.5, y: 100, z: 1006.5 };

  assert.equal(deliveryDropSpacingNeedsRetreat(
    { x: 1029.51, y: 100, z: 1007.41 },
    player,
  ), true);
  assert.equal(deliveryDropSpacingNeedsRetreat(
    { x: 1029.5, y: 100, z: 1007.96 },
    player,
  ), false);
});
