import { smeltingOutputForInput } from './smelting-catalogue.js';

// Entity loot is not exposed by minecraft-data. Keep this small versioned fact
// table beside the generated cooking catalogue, and fail closed against the
// connected registry when item names change.
const FOOD_DROP_BY_ANIMAL = Object.freeze({
  chicken: 'chicken',
  cod: 'cod',
  cow: 'beef',
  pig: 'porkchop',
  rabbit: 'rabbit',
  salmon: 'salmon',
  sheep: 'mutton',
});

const FOOD_ANIMAL_BY_DROP = Object.freeze(Object.fromEntries(
  Object.entries(FOOD_DROP_BY_ANIMAL).map(([animal, drop]) => [drop, animal]),
));

function canonicalName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^minecraft:/, '')
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

export function cookingOutputForFood(registry, itemName) {
  const input = canonicalName(itemName);
  if (
    !input
    || !registry?.itemsByName?.[input]
    || !registry?.foodsByName?.[input]
  ) return null;
  const output = smeltingOutputForInput(input, registry);
  if (!output || !registry.foodsByName[output]) return null;
  return output;
}

export function isCookableFood(registry, itemName) {
  return Boolean(cookingOutputForFood(registry, itemName));
}

export function foodDropForAnimal(registry, animalName) {
  const drop = FOOD_DROP_BY_ANIMAL[canonicalName(animalName)] || null;
  if (!drop || (registry?.itemsByName && !registry.itemsByName[drop])) return null;
  return drop;
}

export function foodAnimalSource(registry, itemName) {
  const item = canonicalName(itemName);
  const animal = FOOD_ANIMAL_BY_DROP[item] || null;
  if (!animal || (registry?.itemsByName && !registry.itemsByName[item])) return null;
  return animal;
}
