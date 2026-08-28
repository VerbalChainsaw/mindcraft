import test from 'node:test';
import assert from 'node:assert/strict';

import { selectDisposableWorkingSlotStack } from '../src/agent/library/skills.js';

function botWith(items) {
  return {
    inventory: { items: () => items },
    registry: { foodsByName: {} },
  };
}

test('working-slot release selects only unprotected zero-reserve clutter', () => {
  const bot = botWith([
    { name: 'leaf_litter', count: 57, slot: 12 },
    { name: 'rotten_flesh', count: 1, slot: 13 },
    { name: 'iron_ingot', count: 6, slot: 14 },
    { name: 'stone_pickaxe', count: 1, slot: 15 },
  ]);

  assert.equal(selectDisposableWorkingSlotStack(bot)?.name, 'rotten_flesh');
  assert.equal(
    selectDisposableWorkingSlotStack(bot, new Set(['rotten_flesh']))?.name,
    'leaf_litter',
  );
  assert.equal(
    selectDisposableWorkingSlotStack(bot, new Set(['rotten_flesh', 'leaf_litter'])),
    null,
  );
});

test('working-slot release fails closed for strategic resources', () => {
  const bot = botWith([
    { name: 'raw_iron', count: 3, slot: 10 },
    { name: 'deepslate_iron_ore', count: 2, slot: 11 },
    { name: 'iron_nugget', count: 7, slot: 12 },
    { name: 'iron_ingot', count: 6, slot: 13 },
    { name: 'diamond', count: 1, slot: 14 },
    { name: 'redstone', count: 16, slot: 15 },
    { name: 'arrow', count: 8, slot: 16 },
  ]);

  assert.equal(selectDisposableWorkingSlotStack(bot), null);
});
