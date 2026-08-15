import assert from 'node:assert/strict';
import test from 'node:test';

import { collectionPositionExcluded } from '../../src/agent/library/skills.js';
import { requesterTerrainCollectionExclusion } from '../../src/agent/runtime/collection-candidate-selector.js';
import { builderWorksiteCollectionExclusion } from '../../src/agent/runtime/jobs/builder-plan.js';
import {
  advanceWorkOrder,
  createWorkOrder,
  workOrderCollectionExclusions,
  workOrderProtectedRegionExclusion,
} from '../../src/agent/runtime/work-order.js';

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

test('terrain extraction excludes the active requester area without blocking non-terrain collection', () => {
  const exclusion = requesterTerrainCollectionExclusion('stone', {
    x: 8106.5,
    y: 64,
    z: 7949.5,
  });

  assert.deepEqual(exclusion, {
    x: 8106.5,
    y: 64,
    z: 7949.5,
    radius: 8,
    reason: 'active_requester_shared_area',
  });
  assert.equal(collectionPositionExcluded({ x: 8110, y: 63, z: 7949 }, [exclusion]), true);
  assert.equal(collectionPositionExcluded({ x: 8115, y: 63, z: 7949 }, [exclusion]), false);
  assert.equal(requesterTerrainCollectionExclusion('spruce_log', { x: 8106.5, y: 64, z: 7949.5 }), null);
  assert.equal(requesterTerrainCollectionExclusion('stone', null), null);
});

test('an active expedition protects its bound home base from prerequisite collection', () => {
  const order = createWorkOrder({
    id: 'protected-expedition-home',
    role: 'miner',
    kind: 'explore',
    source: 'player',
    target: { name: 'ores', x: 80, y: 64, z: 90 },
  });
  assert.deepEqual(workOrderProtectedRegionExclusion(order), {
    x: 80,
    y: 64,
    z: 90,
    radius: 12,
  });
  assert.equal(workOrderProtectedRegionExclusion({ ...order, phase: 'complete' }), null);
});

test('a failed concrete acquisition target survives restart normalization and excludes only its local source region', () => {
  const order = createWorkOrder({
    id: 'builder-stone-recovery',
    role: 'builder',
    kind: 'build',
    phase: 'acquire',
    target: { name: 'worksite', x: 80, y: 64, z: 80 },
    blueprint: {
      id: 'stone_recovery',
      width: 1,
      depth: 1,
      height: 1,
      cells: [{ x: 0, y: 0, z: 0, material: 'cobblestone' }],
    },
  });
  const recovered = advanceWorkOrder(order, {
    actionId: 'unsafe-stone',
    phase: 'failed',
    code: 'skill_unreachable',
    retryable: true,
  }, {
    failedMethod: 'collect:stone->cobblestone',
    failedTarget: { name: 'stone', x: 12, y: 61, z: -7 },
  });
  const persisted = JSON.parse(JSON.stringify(recovered));
  const exclusions = workOrderCollectionExclusions(persisted, 'stone');

  assert.equal(recovered.attempts, 0);
  assert.equal(recovered.recoveries, 1);
  assert.equal(recovered.checkpoint.failedMethods, undefined);
  assert.deepEqual(recovered.checkpoint.failedTargets, [
    { name: 'stone', x: 12, y: 61, z: -7 },
  ]);
  assert.equal(collectionPositionExcluded({ x: 14, y: 61, z: -7 }, exclusions), true);
  assert.equal(collectionPositionExcluded({ x: 17, y: 61, z: -7 }, exclusions), false);

  const second = advanceWorkOrder(recovered, {
    actionId: 'second-unsafe-stone',
    phase: 'failed',
    code: 'skill_unreachable',
    retryable: true,
  }, {
    failedMethod: 'collect:stone->cobblestone',
    failedTarget: { name: 'stone', x: 18, y: 59, z: -7 },
  });
  const expanded = workOrderCollectionExclusions(second, 'stone');
  assert.equal(second.attempts, 0);
  assert.equal(second.recoveries, 2);
  assert.equal(second.resumePhase, 'acquire');
  assert.deepEqual(second.checkpoint.failedMethods, ['collect:*->cobblestone']);
  assert.equal(collectionPositionExcluded({ x: 27, y: 59, z: -7 }, expanded), true);
  assert.equal(collectionPositionExcluded({ x: 35, y: 59, z: -7 }, expanded), false);

  const separated = createWorkOrder({
    ...order,
    id: 'builder-separated-target-recovery',
    checkpoint: {
      failedTargets: [
        { name: 'stone', x: 0, y: 60, z: 0 },
        { name: 'stone', x: 40, y: 60, z: 0 },
      ],
    },
  });
  const separatedExclusions = workOrderCollectionExclusions(separated, 'stone');
  assert.equal(collectionPositionExcluded({ x: 12, y: 60, z: 0 }, separatedExclusions), false);
  assert.equal(collectionPositionExcluded({ x: 28, y: 60, z: 0 }, separatedExclusions), false);

  let exhausted = second;
  for (let index = second.recoveries; index <= second.maxRecoveries; index += 1) {
    exhausted = advanceWorkOrder(exhausted, {
      actionId: `bounded-target-${index}`,
      phase: 'failed',
      code: 'skill_unreachable',
      retryable: true,
    }, {
      failedMethod: 'collect:stone->cobblestone',
      failedTarget: { name: 'stone', x: 40 + index, y: 58, z: -7 },
    });
  }
  assert.equal(exhausted.phase, 'failed');
  assert.equal(exhausted.attempts, 0);
  assert.equal(exhausted.recoveries, exhausted.maxRecoveries);
  assert.equal(exhausted.evidence.code, 'target_recovery_exhausted');
});
