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
