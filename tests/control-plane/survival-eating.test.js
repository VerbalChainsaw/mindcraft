import assert from 'node:assert/strict';
import test from 'node:test';
import Vec3 from 'vec3';

import {
  consume,
  permitsSupervisedEmergencyHunt,
  prepareFood,
  foodSourceRequiresOpenSurface,
  foodSourceRegionApproachRequired,
  miningRouteSupportReturnConflict,
} from '../../src/agent/library/skills.js';

test('supervised emergency hunting opens only for immediate supply above the mortal floor', () => {
  assert.equal(permitsSupervisedEmergencyHunt({ immediateSupply: true, health: 6 }), true);
  assert.equal(permitsSupervisedEmergencyHunt({ immediateSupply: true, health: 4 }), false);
  assert.equal(permitsSupervisedEmergencyHunt({ immediateSupply: false, health: 20 }), false);
  assert.equal(permitsSupervisedEmergencyHunt({ immediateSupply: true, health: null }), false);
});

test('elevated food source preflight requires open-surface access before combat or harvesting', () => {
  assert.equal(foodSourceRequiresOpenSurface({
    bodyY: 59,
    sourceY: 67,
    occupiesOpenSurface: false,
  }), true);
  assert.equal(foodSourceRequiresOpenSurface({
    bodyY: 59,
    sourceY: 67,
    occupiesOpenSurface: true,
  }), false);
  assert.equal(foodSourceRequiresOpenSurface({
    bodyY: 64,
    sourceY: 66,
    sourceDistance: 12,
    occupiesOpenSurface: false,
  }), true);
  assert.equal(foodSourceRequiresOpenSurface({
    bodyY: 64,
    sourceY: 64,
    sourceDistance: 3,
    occupiesOpenSurface: false,
  }), false);
});

test('folded surface routes cannot place later support inside an earlier return body cell', () => {
  const origin = new Vec3(719, 62, -777);
  const conflict = miningRouteSupportReturnConflict(origin, [
    { position: new Vec3(719, 62, -776) },
    { position: new Vec3(719, 62, -775) },
    { position: new Vec3(719, 63, -776) },
    { position: new Vec3(718, 64, -776) },
  ]);

  assert.equal(conflict.routeIndex, 2);
  assert.equal(conflict.returnRouteIndex, 0);
  assert.deepEqual(
    { x: conflict.support.x, y: conflict.support.y, z: conflict.support.z },
    { x: 719, y: 62, z: -776 },
  );
  assert.equal(miningRouteSupportReturnConflict(origin, [
    { position: new Vec3(720, 62, -777) },
    { position: new Vec3(721, 63, -777) },
  ]), null);
});

test('remote crop regions route before final interaction while nearby crops do not', () => {
  assert.equal(foodSourceRegionApproachRequired({ distance: 23 }), true);
  assert.equal(foodSourceRegionApproachRequired({ distance: 9 }), true);
  assert.equal(foodSourceRegionApproachRequired({ distance: 4 }), false);
  assert.equal(foodSourceRegionApproachRequired({ distance: null }), false);
});

test('best_food selects the strongest safe carried food and delegates native consumption', async () => {
  const apple = { name: 'apple', count: 1, type: 1 };
  const bread = { name: 'bread', count: 1, type: 2 };
  const rotten = { name: 'rotten_flesh', count: 1, type: 3 };
  const slots = [apple, bread, rotten];
  const bot = {
    food: 7,
    interrupt_code: false,
    registry: {
      foodsByName: {
        apple: { foodPoints: 4, saturation: 2.4 },
        bread: { foodPoints: 5, saturation: 6 },
        rotten_flesh: { foodPoints: 4, saturation: 0.8 },
      },
    },
    inventory: {
      slots,
      items: () => slots.filter(item => item?.count > 0),
      findInventoryItem: name => slots.find(item => item.name === name && item.count > 0) || null,
    },
    async equip(item) { this.heldItem = item; },
    async consume() {
      assert.equal(this.heldItem, bread);
      bread.count -= 1;
      this.food = 12;
    },
  };

  assert.equal(await consume(bot, 'best_food'), true);
  assert.equal(bot.lastActionEvidence.outcome, 'consumed');
  assert.deepEqual(bot.lastActionEvidence.target, {
    name: 'bread',
    selector: 'best_food',
  });
});

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

test('Given a healing request, consume selects the exact drinkable potion and proves restored health', async () => {
  const healingPotion = {
    name: 'potion',
    count: 1,
    type: 3,
    componentMap: new Map([
      ['potion_contents', { data: { potion: 'minecraft:healing' } }],
    ]),
  };
  const waterPotion = {
    name: 'potion',
    count: 1,
    type: 3,
    componentMap: new Map([
      ['potion_contents', { data: { potion: 'minecraft:water' } }],
    ]),
  };
  const sword = { name: 'wooden_sword', count: 1, type: 4 };
  const slots = [waterPotion, healingPotion, sword];
  const equipCalls = [];
  const bot = {
    version: '1.21.11',
    food: 20,
    health: 2,
    heldItem: sword,
    interrupt_code: false,
    inventory: {
      slots,
      items: () => slots.filter(item => item && item.count > 0),
      findInventoryItem(name) {
        return slots.find(item => item?.name === name && item.count > 0) || null;
      },
    },
    equip(item, destination) {
      equipCalls.push([item === healingPotion ? 'healing' : item.name, destination]);
      this.heldItem = item;
    },
    consume() {
      assert.equal(this.heldItem, healingPotion);
      healingPotion.count -= 1;
      this.health = 10;
    },
  };

  const result = await consume(bot, 'healing_potion');

  assert.equal(result, true);
  assert.deepEqual(equipCalls, [
    ['healing', 'hand'],
    ['wooden_sword', 'hand'],
  ]);
  assert.equal(bot.heldItem, sword);
  assert.deepEqual(
    { ...bot.lastActionEvidence, recordedAt: undefined },
    {
      kind: 'consume',
      outcome: 'consumed',
      target: { name: 'healing_potion', inventoryName: 'potion', effect: 'healing' },
      beforeCount: 2,
      afterCount: 1,
      beforeFood: 20,
      afterFood: 20,
      beforeHealth: 2,
      afterHealth: 10,
      healingConfirmed: true,
      previousHeldItem: 'wooden_sword',
      restoredHeldItem: true,
      retryable: false,
      recordedAt: undefined,
    },
  );
});

test('Given a transiently missing heldItem, healing restores the authoritative selected hotbar item', async () => {
  const healingPotion = {
    name: 'potion',
    count: 1,
    type: 3,
    componentMap: new Map([
      ['potion_contents', { data: { potionId: 24, customEffects: [] } }],
    ]),
  };
  const sword = { name: 'wooden_sword', count: 1, type: 4 };
  const slots = Array(46).fill(null);
  slots[36] = sword;
  slots[37] = healingPotion;
  const equipCalls = [];
  const bot = {
    version: '1.21.11',
    food: 20,
    health: 8,
    heldItem: null,
    quickBarSlot: 0,
    interrupt_code: false,
    inventory: {
      slots,
      items: () => slots.filter(item => item && item.count > 0),
      findInventoryItem(name) {
        return slots.find(item => item?.name === name && item.count > 0) || null;
      },
    },
    equip(item, destination) {
      equipCalls.push([item === healingPotion ? 'healing' : item.name, destination]);
      this.heldItem = item;
      this.quickBarSlot = item === healingPotion ? 1 : 0;
    },
    consume() {
      assert.equal(this.heldItem, healingPotion);
      setTimeout(() => {
        healingPotion.count -= 1;
        this.health = 16;
      }, 25);
    },
  };

  const result = await consume(bot, 'healing_potion');

  assert.equal(result, true);
  assert.deepEqual(equipCalls, [
    ['healing', 'hand'],
    ['wooden_sword', 'hand'],
  ]);
  assert.equal(bot.heldItem, sword);
  assert.equal(bot.lastActionEvidence.previousHeldItem, 'wooden_sword');
  assert.equal(bot.lastActionEvidence.restoredHeldItem, true);
});

test('Given critical health and no carried food, preparation does not build hunting equipment it cannot safely use', async () => {
  const bot = {
    health: 3,
    food: 16,
    heldItem: null,
    interrupt_code: false,
    entity: {
      position: {
        x: 0,
        y: 64,
        z: 0,
        distanceTo: () => 0,
      },
    },
    inventory: {
      slots: [],
      items: () => [],
      findInventoryItem: () => null,
    },
    registry: {
      foodsByName: {},
      blocksByName: {},
      itemsByName: {},
    },
    findBlocks: () => [],
    blockAt: () => null,
    nearestEntity: () => null,
  };

  const prepared = await prepareFood(bot, 24, 64);

  assert.equal(prepared, false);
  assert.equal(bot.lastActionEvidence.outcome, 'no_food_sources');
  assert.equal(bot.lastActionEvidence.huntingDeferredReason, 'critical_health');
  assert.equal(bot.lastActionEvidence.animalsHunted, 0);
  assert.deepEqual(bot.inventory.items(), []);
});

test('Given an immediate food request, safe raw beef satisfies bodily acquisition without furnace bootstrap', async () => {
  const beef = { name: 'beef', count: 1, type: 1 };
  const bot = {
    health: 20,
    food: 1,
    heldItem: null,
    interrupt_code: false,
    entity: {
      position: {
        x: 0,
        y: 64,
        z: 0,
        distanceTo: () => 0,
      },
    },
    inventory: {
      slots: [beef],
      items: () => [beef],
      findInventoryItem: name => name === 'beef' ? beef : null,
    },
    registry: {
      foodsByName: { beef: { foodPoints: 3 } },
      blocksByName: {},
      itemsByName: { beef: { id: 1 } },
    },
    nearestEntity: () => null,
  };

  const prepared = await prepareFood(bot, 1, 24);

  assert.equal(prepared, true);
  assert.equal(bot.lastActionEvidence.outcome, 'already_stocked');
  assert.equal(bot.lastActionEvidence.afterFoodPoints, 3);
  assert.equal(bot.lastActionEvidence.foodPointPolicy, 'immediate_edible');
  assert.equal(bot.lastActionEvidence.itemsCooked, 0);
});
