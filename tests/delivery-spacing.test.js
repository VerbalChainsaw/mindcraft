import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deliveryDropSpacingNeedsRetreat,
  deliveryDropStances,
  deliveryDropStanceIsExclusive,
} from '../src/agent/library/skills.js';
import { Vec3 } from 'vec3';

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

test('delivery requires an axis-aligned 3D stance that excludes the thrower from the recipient pickup boundary', () => {
  const player = { x: 1028.5, y: 100, z: 1006.5 };

  assert.equal(deliveryDropStanceIsExclusive(
    { x: 1030.5, y: 100, z: 1006.5 },
    player,
  ), true);
  assert.equal(deliveryDropStanceIsExclusive(
    { x: 1030.42, y: 100, z: 1008.41 },
    player,
  ), false);
  assert.equal(deliveryDropStanceIsExclusive(
    { x: 1029.51, y: 100, z: 1007.41 },
    player,
  ), false);
  assert.equal(deliveryDropStanceIsExclusive(
    { x: 1028.76, y: 102.17, z: 1008.64 },
    player,
  ), true);
});

test('delivery selects a supported upper-terrace stance beside a lower recipient', () => {
  const stance = new Vec3(1026, 101, 1006);
  const bot = {
    entity: { position: new Vec3(1028.5, 101, 1006.5) },
    blockAt(position) {
      if (position.equals(stance) || position.equals(stance.offset(0, 1, 0))) {
        return { name: 'air', boundingBox: 'empty' };
      }
      if (position.equals(stance.offset(0, -1, 0))) {
        return { name: 'grass_block', boundingBox: 'block' };
      }
      return { name: 'stone', boundingBox: 'block' };
    },
  };
  const player = { position: new Vec3(1028.5, 100, 1006.5) };

  assert.deepEqual(deliveryDropStances(bot, player), [stance]);
});
