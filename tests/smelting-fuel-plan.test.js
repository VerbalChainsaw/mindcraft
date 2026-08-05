import assert from 'node:assert/strict';
import test from 'node:test';

import { selectSmeltingFuelPlan } from '../src/agent/library/skills.js';

test('smelting fuel planning combines individually insufficient compatible stacks', () => {
  const plan = selectSmeltingFuelPlan([
    { name: 'acacia_planks', type: 10, count: 1, slot: 9 },
    { name: 'oak_log', type: 11, count: 1, slot: 18 },
  ], 3);

  assert.equal(plan.ok, true);
  assert.equal(plan.availableSmelts, 3);
  assert.deepEqual(plan.entries.map(({ name, count }) => ({ name, count })), [
    { name: 'acacia_planks', count: 1 },
    { name: 'oak_log', count: 1 },
  ]);
});
