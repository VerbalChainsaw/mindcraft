import assert from 'node:assert/strict';
import test from 'node:test';
import minecraftData from 'minecraft-data';

import { selectSmeltingFuelPlan } from '../src/agent/library/skills.js';
import { buildPrerequisitePlan } from '../src/agent/runtime/prerequisite-planner.js';

function charcoalPlannerBot(logCount) {
  const registry = minecraftData('1.21.11');
  const carried = [
    { ...registry.itemsByName.oak_log, count: logCount, slot: 9 },
    { ...registry.itemsByName.furnace, count: 1, slot: 10 },
  ];
  return {
    entity: {
      position: {
        x: 0,
        y: 100,
        z: 0,
        distanceTo() { return 0; },
      },
    },
    inventory: { slots: carried, items: () => carried },
    findBlock() { return null; },
    registry,
  };
}

test('fuel planning never spends the promised smelting input', () => {
  const inputOnly = selectSmeltingFuelPlan([
    { name: 'oak_log', type: 1, count: 8, slot: 9 },
  ], 8, { oak_log: 8 });

  assert.equal(inputOnly.ok, false);
  assert.equal(inputOnly.availableSmelts, 0);
  assert.deepEqual(inputOnly.entries, []);

  const withSurplus = selectSmeltingFuelPlan([
    { name: 'oak_log', type: 1, count: 14, slot: 9 },
  ], 8, { oak_log: 8 });

  assert.equal(withSurplus.ok, true);
  assert.deepEqual(withSurplus.entries.map(({ name, count }) => ({ name, count })), [
    { name: 'oak_log', count: 6 },
  ]);
});

test('charcoal planning acquires fuel after reserving eight logs as input', () => {
  const missingFuel = buildPrerequisitePlan(charcoalPlannerBot(8), {
    target: 'charcoal',
    quantity: 8,
    range: 64,
    allowUnobservedSelfDropRoot: false,
  });

  assert.equal(missingFuel.status, 'ready');
  assert.equal(missingFuel.nextStep.kind, 'collect_fuel');
  assert.equal(missingFuel.nextStep.capability.id, 'collect_wood');
  assert.equal(missingFuel.nextStep.capability.arguments.count, 6);

  const sufficient = buildPrerequisitePlan(charcoalPlannerBot(14), {
    target: 'charcoal',
    quantity: 8,
    range: 64,
    allowUnobservedSelfDropRoot: false,
  });

  assert.equal(sufficient.status, 'ready');
  assert.equal(sufficient.nextStep.kind, 'smelt');
  assert.equal(sufficient.nextStep.capability.binding.command, '!smeltItem("oak_log", 8)');
});
