import assert from 'node:assert/strict';
import test from 'node:test';

import BinaryHeapOpenSet from '../packages/minecraft-runtime/mineflayer-pathfinder/lib/heap.js';

test('Pathfinder open set preserves ascending priority when the right child is the final heap entry', () => {
  const openSet = new BinaryHeapOpenSet();

  for (const f of [1, 4, 2, 5]) {
    openSet.push({ f });
  }

  const priorities = [];
  while (!openSet.isEmpty()) {
    priorities.push(openSet.pop().f);
  }

  assert.deepEqual(priorities, [1, 2, 4, 5]);
});
