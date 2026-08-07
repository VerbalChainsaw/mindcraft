import assert from 'node:assert/strict';
import test from 'node:test';

import { collectionPositionExcluded } from '../../src/agent/library/skills.js';
import { builderWorksiteCollectionExclusion } from '../../src/agent/runtime/jobs/builder-plan.js';

test('active Builder footprint augments failed-target exclusions without protecting the surrounding world', () => {
  const failedTarget = { x: 2, y: 63, z: 4, radius: 1 };
  const order = {
    id: 'builder-test-outpost',
    role: 'builder',
    kind: 'build',
    phase: 'acquire',
    target: { x: 10, y: 64, z: 20 },
    blueprint: {
      cells: [
        { x: -1, y: 0, z: 0, material: 'acacia_log' },
        { x: 3, y: 2, z: 4, material: 'glass' },
      ],
    },
  };
  const exclusions = [
    failedTarget,
    builderWorksiteCollectionExclusion(order),
  ];
  assert.equal(exclusions.length, 2);
  assert.equal(exclusions[0], failedTarget, 'existing GoalDirector recovery memory is preserved');
  assert.deepEqual(exclusions[1], {
    minX: 9,
    maxX: 13,
    minY: 64,
    maxY: 66,
    minZ: 20,
    maxZ: 24,
    reason: 'active_builder_worksite',
    orderId: 'builder-test-outpost',
  });

  assert.equal(collectionPositionExcluded({ x: 10, y: 64, z: 20 }, exclusions), true);
  assert.equal(collectionPositionExcluded({ x: 12, y: 65, z: 22 }, exclusions), true);
  assert.equal(collectionPositionExcluded({ x: 14, y: 65, z: 22 }, exclusions), false);
  assert.equal(collectionPositionExcluded({ x: 3, y: 64, z: 4 }, exclusions), true);
});

test('inactive or unrelated jobs do not claim a collection region', () => {
  const order = {
    role: 'miner',
    kind: 'mine',
    phase: 'execute',
    target: { x: 10, y: 64, z: 20 },
    blueprint: { cells: [{ x: 0, y: 0, z: 0, material: 'stone' }] },
  };

  assert.equal(builderWorksiteCollectionExclusion(order), null);
});
