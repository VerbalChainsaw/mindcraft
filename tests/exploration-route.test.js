import assert from 'node:assert/strict';
import test from 'node:test';

import { chooseExplorationRoute } from '../src/agent/runtime/exploration-route.js';

test('selects a deterministic short route through distinct landmark types', () => {
  const route = chooseExplorationRoute({
    origin: { x: 0, y: 64, z: 0 },
    landmarkCount: 3,
    candidates: [
      { name: 'diamond_block', position: { x: 20, y: 64, z: 0 } },
      { name: 'gold_block', position: { x: 4, y: 64, z: 0 } },
      { name: 'emerald_block', position: { x: 8, y: 64, z: 0 } },
      { name: 'gold_block', position: { x: 40, y: 64, z: 0 } },
    ],
  });

  assert.equal(route.outcome, 'route_selected');
  assert.deepEqual(route.selected.map(entry => entry.name), [
    'gold_block',
    'emerald_block',
    'diamond_block',
  ]);
  assert.equal(route.distinctTypes, 3);
});

test('does not count repeated blocks of one type as distinct landmarks', () => {
  const route = chooseExplorationRoute({
    origin: { x: 0, y: 64, z: 0 },
    landmarkCount: 2,
    candidates: [
      { name: 'gold_block', position: { x: 2, y: 64, z: 0 } },
      { name: 'gold_block', position: { x: 3, y: 64, z: 0 } },
    ],
  });

  assert.equal(route.outcome, 'insufficient_landmarks');
  assert.equal(route.selected.length, 1);
  assert.equal(route.distinctTypes, 1);
});

test('rejects an origin without finite coordinates', () => {
  const route = chooseExplorationRoute({
    origin: { x: Number.NaN, y: 64, z: 0 },
    candidates: [{ name: 'gold_block', position: { x: 2, y: 64, z: 0 } }],
  });

  assert.equal(route.outcome, 'invalid_origin');
  assert.deepEqual(route.selected, []);
});
