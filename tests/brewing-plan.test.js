import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isWaterPotion,
  potionFingerprint,
  resolveBrewingPlan,
} from '../src/agent/runtime/brewing-plan.js';
import { latestMessageRequestsAction } from '../src/models/prompter.js';

test('brewing plan resolves base, modified, splash, and lingering potion stages', () => {
  assert.deepEqual(resolveBrewingPlan('strength'), {
    target: 'strength',
    effect: 'strength',
    modifier: 'normal',
    delivery: 'drinkable',
    outputItem: 'potion',
    ingredients: ['nether_wart', 'blaze_powder'],
  });
  assert.deepEqual(resolveBrewingPlan('long_fire_resistance'), {
    target: 'long_fire_resistance',
    effect: 'fire_resistance',
    modifier: 'long',
    delivery: 'drinkable',
    outputItem: 'potion',
    ingredients: ['nether_wart', 'magma_cream', 'redstone'],
  });
  assert.deepEqual(resolveBrewingPlan('splash_strong_healing'), {
    target: 'splash_strong_healing',
    effect: 'healing',
    modifier: 'strong',
    delivery: 'splash',
    outputItem: 'splash_potion',
    ingredients: ['nether_wart', 'glistering_melon_slice', 'glowstone_dust', 'gunpowder'],
  });
  assert.deepEqual(resolveBrewingPlan('lingering_poison'), {
    target: 'lingering_poison',
    effect: 'poison',
    modifier: 'normal',
    delivery: 'lingering',
    outputItem: 'lingering_potion',
    ingredients: ['nether_wart', 'spider_eye', 'gunpowder', 'dragon_breath'],
  });
});

test('brewing plan rejects impossible vanilla modifiers and unknown effects', () => {
  assert.equal(resolveBrewingPlan('strong_fire_resistance'), null);
  assert.equal(resolveBrewingPlan('long_healing'), null);
  assert.equal(resolveBrewingPlan('haste'), null);
});

test('water bottles and potion state changes are identified through modern components', () => {
  const water = {
    name: 'potion',
    type: 100,
    components: [{ type: 'potion_contents', data: { potionId: 0, customEffects: [] } }],
    componentMap: new Map([
      ['potion_contents', { type: 'potion_contents', data: { potionId: 0, customEffects: [] } }],
    ]),
  };
  const awkward = {
    ...water,
    components: [{ type: 'potion_contents', data: { potionId: 3, customEffects: [] } }],
    componentMap: new Map([
      ['potion_contents', { type: 'potion_contents', data: { potionId: 3, customEffects: [] } }],
    ]),
  };

  assert.equal(isWaterPotion(water), true);
  assert.equal(isWaterPotion(awkward), false);
  assert.notEqual(potionFingerprint(water), potionFingerprint(awkward));
});

test('completed natural-language actions do not force a duplicate command', () => {
  const request = { role: 'user', content: 'ADMIN: Brew one swiftness potion.' };

  assert.equal(latestMessageRequestsAction([request]), true);
  assert.equal(latestMessageRequestsAction([
    request,
    { role: 'assistant', content: 'Brewing it. !brewPotion("swiftness", 1)' },
    { role: 'system', content: 'Action output:\nBrewed 1 swiftness potion.' },
  ]), false);
  assert.equal(latestMessageRequestsAction([
    request,
    { role: 'assistant', content: 'Trying it. !notACommand()' },
    { role: 'system', content: 'Command !notACommand does not exist.' },
  ]), true);
});
