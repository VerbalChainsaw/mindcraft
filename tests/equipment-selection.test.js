import assert from 'node:assert/strict';
import test from 'node:test';

import { equip } from '../src/agent/library/skills.js';

test('explicit equipment selects the healthiest matching carried instance', async () => {
  const worn = {
    name: 'stone_pickaxe',
    type: 1,
    slot: 10,
    maxDurability: 131,
    durabilityUsed: 126,
  };
  const healthy = {
    name: 'stone_pickaxe',
    type: 1,
    slot: 11,
    maxDurability: 131,
    durabilityUsed: 7,
  };
  let selected = null;
  const slots = [null, worn, healthy];
  const bot = {
    game: { gameMode: 'survival' },
    registry: {
      items: { 1: { maxDurability: 131 } },
      itemsByName: { stone_pickaxe: { id: 1, maxDurability: 131 } },
    },
    inventory: {
      slots,
      firstEmptyInventorySlot: () => 20,
    },
    getEquipmentDestSlot: () => 0,
    async equip(item) {
      selected = item;
      slots[0] = item;
      this.heldItem = item;
    },
  };

  const equipped = await equip(bot, 'stone_pickaxe');

  assert.equal(equipped, true);
  assert.equal(selected, healthy);
  assert.equal(bot.lastActionEvidence.outcome, 'equipped');
  assert.equal(bot.lastActionEvidence.selectedInventorySlot, 11);
  assert.deepEqual(bot.lastActionEvidence.durability, { remaining: 124, maximum: 131 });
});
