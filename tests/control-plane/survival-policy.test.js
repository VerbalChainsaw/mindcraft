import assert from 'node:assert/strict';
import test from 'node:test';

import { chooseSurvivalIntent } from '../../src/agent/runtime/survival-policy.js';

const POLICY = Object.freeze({
  mode: 'full',
  eatAt: 14,
  criticalFood: 6,
  reserveFoodPoints: 12,
  sleep: 'safe',
  shelter: 'seek',
});

test('Given low hunger and safe food, survival policy chooses the strongest ordinary food without inventing an action result', () => {
  const intent = chooseSurvivalIntent({
    held: false,
    idle: true,
    health: 18,
    hunger: 8,
    recentDamage: false,
    urgentDanger: false,
    hostiles: [],
    food: [
      { name: 'apple', count: 2, foodPoints: 4, saturation: 2.4 },
      { name: 'bread', count: 4, foodPoints: 5, saturation: 6 },
    ],
    timeOfDay: 6000,
    weather: 'Clear',
  }, POLICY);

  assert.deepEqual(intent, {
    kind: 'eat',
    item: 'bread',
    reason: 'low_hunger',
  });
});

test('Given only an emergency food reserve, noncritical hunger replenishes before consuming the reserve', () => {
  const intent = chooseSurvivalIntent({
    held: false,
    idle: true,
    health: 18,
    hunger: 12,
    recentDamage: false,
    urgentDanger: false,
    food: [{ name: 'bread', count: 2, foodPoints: 5, saturation: 6 }],
    timeOfDay: 6000,
    weather: 'Clear',
  }, POLICY);

  assert.deepEqual(intent, {
    kind: 'acquire_food',
    targetFoodPoints: 24,
    reason: 'food_reserve_low',
  });
});

test('Given critical hunger without safe food, full survival policy actively acquires a safe reserve', () => {
  const intent = chooseSurvivalIntent({
    held: false,
    idle: true,
    health: 12,
    hunger: 4,
    recentDamage: false,
    urgentDanger: false,
    hostiles: [],
    food: [
      { name: 'rotten_flesh', count: 3, foodPoints: 4, saturation: 0.8 },
    ],
    timeOfDay: 6000,
    weather: 'Clear',
  }, POLICY);

  assert.deepEqual(intent, {
    kind: 'acquire_food',
    targetFoodPoints: 24,
    reason: 'missing_safe_food',
  });
});

test('Given critical hunger while busy, survival policy explicitly preempts lower-priority work', () => {
  const intent = chooseSurvivalIntent({
    held: false,
    idle: false,
    health: 12,
    hunger: 4,
    recentDamage: false,
    urgentDanger: false,
    hostiles: [],
    food: [{ name: 'bread', count: 1, foodPoints: 5, saturation: 6 }],
    timeOfDay: 6000,
    weather: 'Clear',
  }, POLICY);

  assert.deepEqual(intent, {
    kind: 'eat',
    item: 'bread',
    reason: 'critical_hunger',
    preempt: true,
  });
});

test('Given a safe reachable bed at night, full survival policy chooses sleep after bodily needs are satisfied', () => {
  const intent = chooseSurvivalIntent({
    held: false,
    idle: true,
    health: 20,
    hunger: 20,
    recentDamage: false,
    urgentDanger: false,
    hostiles: [],
    food: [],
    timeOfDay: 14000,
    dimension: 'overworld',
    weather: 'Clear',
    beds: [
      { name: 'white_bed', x: 10, y: 64, z: -2, distance: 6, reachable: true, safe: true },
    ],
  }, POLICY);

  assert.deepEqual(intent, {
    kind: 'sleep',
    target: { name: 'white_bed', x: 10, y: 64, z: -2, distance: 6 },
    reason: 'safe_night',
  });
});

test('Given recoverable injury, survival policy eats to restore regeneration before optional equipment work', () => {
  const intent = chooseSurvivalIntent({
    held: false,
    idle: true,
    health: 11,
    hunger: 17,
    recentDamage: true,
    urgentDanger: false,
    food: [{ name: 'cooked_beef', count: 1, foodPoints: 8, saturation: 12.8 }],
    armor: [{ name: 'iron_chestplate', slot: 'torso', score: 4 }],
    timeOfDay: 6000,
    weather: 'Clear',
  }, POLICY);

  assert.deepEqual(intent, {
    kind: 'eat',
    item: 'cooked_beef',
    reason: 'injury_recovery',
  });
});

test('Given a stronger unequipped armor piece, full survival policy equips it while idle', () => {
  const intent = chooseSurvivalIntent({
    held: false,
    idle: true,
    health: 20,
    hunger: 20,
    recentDamage: false,
    urgentDanger: false,
    food: [],
    armor: [
      { name: 'leather_boots', slot: 'feet', score: 1, equipped: true },
      { name: 'iron_boots', slot: 'feet', score: 4, equipped: false },
    ],
    timeOfDay: 6000,
    weather: 'Clear',
  }, POLICY);

  assert.deepEqual(intent, {
    kind: 'equip',
    item: 'iron_boots',
    reason: 'armor_upgrade',
  });
});

test('Given armor and drop upkeep disabled, survival policy leaves those optional actions alone', () => {
  const intent = chooseSurvivalIntent({
    held: false,
    idle: true,
    health: 20,
    hunger: 20,
    recentDamage: false,
    urgentDanger: false,
    food: [],
    armor: [{ name: 'iron_boots', slot: 'feet', score: 4, equipped: false }],
    usefulDrops: [{ name: 'diamond', id: 7, distance: 2 }],
    timeOfDay: 6000,
    dimension: 'overworld',
    weather: 'Clear',
  }, {
    ...POLICY,
    armor: 'off',
    usefulDrops: 'ignore',
  });

  assert.equal(intent, null);
});

test('Given dangerous weather without a safe shelter, emergency policy emits a bounded shelter work order intent', () => {
  const intent = chooseSurvivalIntent({
    held: false,
    idle: true,
    health: 20,
    hunger: 20,
    recentDamage: false,
    urgentDanger: false,
    food: [],
    armor: [],
    timeOfDay: 6000,
    dimension: 'overworld',
    weather: 'Thunderstorm',
    sheltered: false,
    shelters: [],
  }, { ...POLICY, shelter: 'emergency' });

  assert.deepEqual(intent, {
    kind: 'shelter_work_order',
    blueprint: 'emergency_3x3',
    reason: 'dangerous_weather',
  });

  const peacefulNight = chooseSurvivalIntent({
    held: false,
    idle: true,
    health: 20,
    hunger: 20,
    recentDamage: false,
    urgentDanger: false,
    food: [],
    armor: [],
    timeOfDay: 14000,
    dimension: 'overworld',
    difficulty: 'peaceful',
    weather: 'Clear',
    sheltered: false,
    shelters: [],
  }, { ...POLICY, shelter: 'emergency' });

  assert.equal(peacefulNight, null);
});
