import assert from 'node:assert/strict';
import test from 'node:test';

import { consume } from '../../src/agent/library/skills.js';

test('Given a held job tool, verified consumption restores the tool and records bodily postconditions', async () => {
  const bread = { name: 'bread', count: 2, type: 1 };
  const pickaxe = { name: 'wooden_pickaxe', count: 1, type: 2 };
  const slots = [bread, pickaxe];
  const equipCalls = [];
  const bot = {
    food: 8,
    heldItem: pickaxe,
    interrupt_code: false,
    inventory: {
      slots,
      items: () => slots.filter(Boolean),
      findInventoryItem(name) {
        return slots.find(item => item?.name === name) || null;
      },
    },
    equip(item, destination) {
      equipCalls.push([item.name, destination]);
      this.heldItem = item;
    },
    consume() {
      bread.count -= 1;
      this.food = 13;
    },
  };

  const result = await consume(bot, 'bread');

  assert.equal(result, true);
  assert.deepEqual(equipCalls, [
    ['bread', 'hand'],
    ['wooden_pickaxe', 'hand'],
  ]);
  assert.equal(bot.heldItem.name, 'wooden_pickaxe');
  assert.deepEqual(
    { ...bot.lastActionEvidence, recordedAt: undefined },
    {
    kind: 'consume',
    outcome: 'consumed',
    target: { name: 'bread' },
    beforeCount: 2,
    afterCount: 1,
    beforeFood: 8,
    afterFood: 13,
    previousHeldItem: 'wooden_pickaxe',
    restoredHeldItem: true,
    retryable: false,
    recordedAt: undefined,
  });
  assert.equal(Number.isFinite(bot.lastActionEvidence.recordedAt), true);
});
