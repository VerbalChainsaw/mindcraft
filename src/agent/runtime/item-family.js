import { isCookableFood } from '../../utils/food-semantics.js';

export const SUPPORTED_ITEM_FAMILIES = Object.freeze([
  'logs',
  'planks',
  'food',
  'raw_fish',
  'cooked_fish',
  'ores',
  'building_blocks',
]);

const RAW_FISH_ITEMS = new Set(['cod', 'salmon']);
const COOKED_FISH_ITEMS = new Set(['cooked_cod', 'cooked_salmon']);

export const UNSAFE_FOOD_ITEMS = new Set([
  'chicken',
  'poisonous_potato',
  'pufferfish',
  'rotten_flesh',
  'spider_eye',
  'suspicious_stew',
]);

// Desperation tiers. These stay unsafe for ordinary upkeep and must only be
// consulted once bodily need is already critical, where the alternative is
// dying with edible items in the inventory.
//
// Tier A inflicts Hunger and never damages health, so eating it at low health
// is strictly better than starving. Tier B inflicts Poison, which in Java
// cannot reduce health below 1 HP, so it is survivable but wasteful.
//
// pufferfish (Poison II for 60s, 1 food point) and suspicious_stew (effect
// depends on the crafting flower) are deliberately excluded from both tiers.
export const EMERGENCY_FOOD_TIER_A = new Set(['rotten_flesh', 'chicken']);
export const EMERGENCY_FOOD_TIER_B = new Set(['spider_eye', 'poisonous_potato']);
export const EMERGENCY_FOOD_ITEMS = new Set([
  ...EMERGENCY_FOOD_TIER_A,
  ...EMERGENCY_FOOD_TIER_B,
]);

export function itemMatchesFamily(bot, item, family) {
  const name = String(item?.name || '');
  if (family === 'logs') return /_(?:log|stem)$/.test(name);
  if (family === 'planks') return name.endsWith('_planks');
  if (family === 'food') {
    return Boolean(
      bot?.registry?.foodsByName?.[name]
      && !UNSAFE_FOOD_ITEMS.has(name)
      && !isCookableFood(bot?.registry, name)
    );
  }
  if (family === 'raw_fish') return RAW_FISH_ITEMS.has(name);
  if (family === 'cooked_fish') return COOKED_FISH_ITEMS.has(name);
  if (family === 'ores') {
    return name.startsWith('raw_')
      || /_(?:ore|ingot|nugget)$/.test(name)
      || ['coal', 'charcoal', 'diamond', 'emerald', 'redstone', 'lapis_lazuli', 'quartz'].includes(name);
  }
  if (family === 'building_blocks') {
    return name.endsWith('_planks')
      || ['cobblestone', 'cobbled_deepslate', 'stone', 'dirt', 'glass'].includes(name);
  }
  return false;
}

function inventoryItems(bot) {
  if (typeof bot?.inventory?.items === 'function') return bot.inventory.items();
  if (Array.isArray(bot?.inventory?.slots)) return bot.inventory.slots.filter(Boolean);
  return [];
}

export function familyEntriesFromCounts(counts, family, bot = null) {
  const entries = counts instanceof Map ? [...counts.entries()] : Object.entries(counts || {});
  return entries
    .filter(([name]) => itemMatchesFamily(bot, { name }, family))
    .map(([name, count]) => Object.freeze({
      name,
      count: Math.max(0, Math.floor(Number(count) || 0)),
    }))
    .filter(entry => entry.count > 0)
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

export function familyInventoryEntries(bot, family) {
  const counts = new Map();
  for (const item of inventoryItems(bot)) {
    if (!itemMatchesFamily(bot, item, family)) continue;
    const count = Math.max(0, Math.floor(Number(item.count) || 0));
    if (count < 1) continue;
    counts.set(item.name, (counts.get(item.name) || 0) + count);
  }
  return familyEntriesFromCounts(counts, family, bot);
}

export function familyInventoryCount(bot, family) {
  return familyInventoryEntries(bot, family).reduce((total, entry) => total + entry.count, 0);
}

export function familyFoodPoints(bot) {
  const foods = bot?.registry?.foodsByName || {};
  return familyInventoryEntries(bot, 'food').reduce((total, entry) => (
    total + (entry.count * Math.max(0, Number(foods[entry.name]?.foodPoints) || 0))
  ), 0);
}

export function familyTransferManifest(bot, family, quantity) {
  let remaining = Math.max(0, Math.min(2304, Math.floor(Number(quantity) || 0)));
  const manifest = [];
  for (const entry of familyInventoryEntries(bot, family)) {
    if (remaining < 1) break;
    const selected = Math.min(remaining, entry.count);
    manifest.push(Object.freeze({ item: entry.name, quantity: selected }));
    remaining -= selected;
  }
  return Object.freeze(manifest);
}
