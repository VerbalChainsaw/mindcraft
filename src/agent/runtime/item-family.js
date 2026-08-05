export const SUPPORTED_ITEM_FAMILIES = Object.freeze([
  'logs',
  'planks',
  'food',
  'ores',
  'building_blocks',
]);

export const UNSAFE_FOOD_ITEMS = new Set([
  'chicken',
  'poisonous_potato',
  'pufferfish',
  'rotten_flesh',
  'spider_eye',
  'suspicious_stew',
]);

export const COOKABLE_FOOD = Object.freeze({
  raw_beef: 'steak',
  raw_chicken: 'cooked_chicken',
  raw_cod: 'cooked_cod',
  raw_mutton: 'cooked_mutton',
  raw_porkchop: 'cooked_porkchop',
  raw_rabbit: 'cooked_rabbit',
  raw_salmon: 'cooked_salmon',
  potato: 'baked_potato',
});

export function itemMatchesFamily(bot, item, family) {
  const name = String(item?.name || '');
  if (family === 'logs') return /_(?:log|stem)$/.test(name);
  if (family === 'planks') return name.endsWith('_planks');
  if (family === 'food') {
    return Boolean(
      bot?.registry?.foodsByName?.[name]
      && !UNSAFE_FOOD_ITEMS.has(name)
      && !Object.prototype.hasOwnProperty.call(COOKABLE_FOOD, name)
    );
  }
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
