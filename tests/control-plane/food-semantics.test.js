import test from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';

import {
  cookingOutputForFood,
  foodAnimalSource,
  foodDropForAnimal,
  isCookableFood,
} from '../../src/utils/food-semantics.js';
import { itemMatchesFamily } from '../../src/agent/runtime/item-family.js';

const registry = minecraftData('1.21.11');

test('food cooking semantics use current registry names and generated recipes', () => {
  assert.equal(cookingOutputForFood(registry, 'beef'), 'cooked_beef');
  assert.equal(cookingOutputForFood(registry, 'chicken'), 'cooked_chicken');
  assert.equal(cookingOutputForFood(registry, 'porkchop'), 'cooked_porkchop');
  assert.equal(cookingOutputForFood(registry, 'potato'), 'baked_potato');
  assert.equal(cookingOutputForFood(registry, 'raw_beef'), null);
  assert.equal(cookingOutputForFood(registry, 'steak'), null);
  assert.equal(isCookableFood(registry, 'beef'), true);
  assert.equal(isCookableFood(registry, 'cooked_beef'), false);
  assert.equal(itemMatchesFamily({ registry }, { name: 'beef' }, 'food'), false);
  assert.equal(itemMatchesFamily({ registry }, { name: 'cooked_beef' }, 'food'), true);
});

test('animal food drops and reverse lookup share canonical item identities', () => {
  assert.equal(foodDropForAnimal(registry, 'cow'), 'beef');
  assert.equal(foodAnimalSource(registry, 'beef'), 'cow');
  assert.equal(foodAnimalSource(registry, 'raw_beef'), null);
  assert.equal(foodDropForAnimal(registry, 'salmon'), 'salmon');
});
