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

test('Given critical health and a verified healing potion, survival preempts optional work to heal', () => {
  const intent = chooseSurvivalIntent({
    held: false,
    idle: false,
    health: 4,
    hunger: 20,
    urgentDanger: false,
    healingConsumables: [
      { item: 'healing_potion', effect: 'healing', count: 1, potency: 1 },
    ],
  }, POLICY);

  assert.deepEqual(intent, {
    kind: 'heal',
    item: 'healing_potion',
    reason: 'critical_health_healing',
    preempt: true,
  });
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

// Behaviour change 2026-08-15: this case previously asserted `acquire_food`,
// i.e. forage while carrying edible food. That contributed to the Phantom
// death, where the bot answered `acquire_food` every tick with four rotten
// flesh in its inventory. Below the sprint threshold and one event from
// starvation, eating the desperation food first is strictly better, and the
// policy can still forage on the next tick.
test('Given critical hunger and only desperation food, survival eats it instead of foraging', () => {
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
    kind: 'eat',
    item: 'rotten_flesh',
    reason: 'critical_hunger',
  });
});

test('Given critical hunger and nothing edible at all, full survival policy still acquires one immediate unit', () => {
  const intent = chooseSurvivalIntent({
    held: false,
    idle: true,
    health: 12,
    hunger: 4,
    recentDamage: false,
    urgentDanger: false,
    hostiles: [],
    food: [
      { name: 'pufferfish', count: 2, foodPoints: 1, saturation: 0.4 },
    ],
    timeOfDay: 6000,
    weather: 'Clear',
  }, POLICY);

  assert.deepEqual(intent, {
    kind: 'acquire_food',
    targetFoodPoints: 1,
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
    // The dimension is part of the target so the executor can bind this exact
    // bed instead of re-searching for the nearest one.
    target: { name: 'white_bed', x: 10, y: 64, z: -2, distance: 6, dimension: 'overworld' },
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

// Reproduces the 2026-08-15 death exactly. Kevin sat at critical health, sky
// exposed, for 37m52s and was killed by a Phantom. The hunger branch answered
// every tick with `acquire_food` because rotten flesh was filtered out and the
// shelter rungs sat below a branch that always returned.
const KEVIN_DEATH_STATE = Object.freeze({
  held: false,
  idle: true,
  health: 3,
  hunger: 12,
  recentDamage: true,
  urgentDanger: false,
  healingConsumables: [],
  food: [{ name: 'rotten_flesh', count: 4, foodPoints: 4, saturation: 6.4 }],
  armor: [],
  timeOfDay: 18000,
  dimension: 'overworld',
  difficulty: 'normal',
  weather: 'Rain',
  sheltered: false,
  shelters: [],
  beds: [],
});

test('Given critical health and an admitted local shelter fixture, survival seals in place instead of foraging forever', () => {
  const intent = chooseSurvivalIntent({
    ...KEVIN_DEATH_STATE,
    canShelterInPlace: true,
  }, POLICY);

  assert.equal(intent.kind, 'shelter_in_place');
  assert.equal(intent.reason, 'critical_health_exposed');
});

test('Given critical exposure and a complete safe route, survival uses routed cover before destructive local shelter', () => {
  const intent = chooseSurvivalIntent({
    ...KEVIN_DEATH_STATE,
    canShelterInPlace: true,
    shelters: [{
      name: 'covered_space',
      x: 4,
      y: 64,
      z: 2,
      distance: 5,
      reachable: true,
      safe: true,
      pathStatus: 'success',
    }],
  }, POLICY);

  assert.deepEqual(intent, {
    kind: 'seek_shelter',
    target: {
      name: 'covered_space',
      x: 4,
      y: 64,
      z: 2,
      distance: 5,
    },
    reason: 'critical_health_exposed',
  });
});

test('Given Kevin death state without a physical shelter receipt, survival eats carried emergency food instead of inventing terrain authority', () => {
  const intent = chooseSurvivalIntent(KEVIN_DEATH_STATE, POLICY);

  assert.deepEqual(intent, {
    kind: 'eat',
    item: 'rotten_flesh',
    reason: 'critical_hunger',
  });
});

test('Given shelter policy disabled, an otherwise feasible shaft is not authorized', () => {
  const intent = chooseSurvivalIntent({
    ...KEVIN_DEATH_STATE,
    canShelterInPlace: true,
  }, { ...POLICY, shelter: 'off' });

  assert.deepEqual(intent, {
    kind: 'eat',
    item: 'rotten_flesh',
    reason: 'critical_hunger',
  });
});

test('Given the same critical state under cover, survival stops sheltering and eats its emergency food', () => {
  const intent = chooseSurvivalIntent(
    { ...KEVIN_DEATH_STATE, sheltered: true },
    POLICY,
  );

  assert.deepEqual(intent, {
    kind: 'eat',
    item: 'rotten_flesh',
    reason: 'critical_hunger',
  });
});

test('Given an ordinary safe food beside a desperation food, critical survival still prefers the safe one', () => {
  const intent = chooseSurvivalIntent({
    ...KEVIN_DEATH_STATE,
    sheltered: true,
    food: [
      { name: 'rotten_flesh', count: 4, foodPoints: 4, saturation: 6.4 },
      { name: 'melon_slice', count: 1, foodPoints: 2, saturation: 1.2 },
    ],
  }, POLICY);

  assert.equal(intent.kind, 'eat');
  assert.equal(intent.item, 'melon_slice');
});

test('Given noncritical hunger, desperation food stays rejected exactly as before', () => {
  const intent = chooseSurvivalIntent({
    ...KEVIN_DEATH_STATE,
    health: 20,
    hunger: 12,
    recentDamage: false,
    sheltered: true,
  }, POLICY);

  assert.notEqual(intent?.kind, 'eat');
});
