import assert from 'node:assert/strict';
import test from 'node:test';

import { selectSmeltingFuelPlan } from '../src/agent/library/skills.js';
import {
  smeltingInputsForOutput,
  smeltingOutputForInput,
} from '../src/utils/smelting-catalogue.js';

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

test('the repository smelting catalogue gives planning and execution the same transform', () => {
  assert.deepEqual(smeltingInputsForOutput('stone'), ['cobblestone']);
  assert.equal(smeltingOutputForInput('cobblestone'), 'stone');
  assert.equal(smeltingOutputForInput('black_terracotta'), 'black_glazed_terracotta');
});
