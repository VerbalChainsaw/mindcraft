const BASE_RECIPES = Object.freeze({
  awkward: Object.freeze(['nether_wart']),
  fire_resistance: Object.freeze(['nether_wart', 'magma_cream']),
  healing: Object.freeze(['nether_wart', 'glistering_melon_slice']),
  leaping: Object.freeze(['nether_wart', 'rabbit_foot']),
  night_vision: Object.freeze(['nether_wart', 'golden_carrot']),
  poison: Object.freeze(['nether_wart', 'spider_eye']),
  regeneration: Object.freeze(['nether_wart', 'ghast_tear']),
  slow_falling: Object.freeze(['nether_wart', 'phantom_membrane']),
  strength: Object.freeze(['nether_wart', 'blaze_powder']),
  swiftness: Object.freeze(['nether_wart', 'sugar']),
  turtle_master: Object.freeze(['nether_wart', 'turtle_helmet']),
  water_breathing: Object.freeze(['nether_wart', 'pufferfish']),
  weakness: Object.freeze(['fermented_spider_eye']),
});

const EXTENDABLE = new Set([
  'fire_resistance',
  'leaping',
  'night_vision',
  'poison',
  'regeneration',
  'slow_falling',
  'strength',
  'swiftness',
  'turtle_master',
  'water_breathing',
  'weakness',
]);

const STRENGTHENABLE = new Set([
  'healing',
  'leaping',
  'poison',
  'regeneration',
  'strength',
  'swiftness',
  'turtle_master',
]);

function canonical(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^minecraft:/, '')
    .replace(/\s+/g, '_')
    .replace(/_potion$/, '');
}

export function resolveBrewingPlan(requestedTarget) {
  let target = canonical(requestedTarget);
  if (!target) return null;

  let delivery = 'drinkable';
  if (target.startsWith('lingering_')) {
    delivery = 'lingering';
    target = target.slice('lingering_'.length);
  } else if (target.startsWith('splash_')) {
    delivery = 'splash';
    target = target.slice('splash_'.length);
  }

  let modifier = 'normal';
  if (target.startsWith('long_')) {
    modifier = 'long';
    target = target.slice('long_'.length);
  } else if (target.startsWith('strong_')) {
    modifier = 'strong';
    target = target.slice('strong_'.length);
  }

  const baseStages = BASE_RECIPES[target];
  if (!baseStages) return null;
  if (modifier === 'long' && !EXTENDABLE.has(target)) return null;
  if (modifier === 'strong' && !STRENGTHENABLE.has(target)) return null;

  const ingredients = [...baseStages];
  if (modifier === 'long') ingredients.push('redstone');
  if (modifier === 'strong') ingredients.push('glowstone_dust');
  if (delivery === 'splash' || delivery === 'lingering') ingredients.push('gunpowder');
  if (delivery === 'lingering') ingredients.push('dragon_breath');

  const canonicalTarget = [
    delivery === 'drinkable' ? '' : `${delivery}_`,
    modifier === 'normal' ? '' : `${modifier}_`,
    target,
  ].join('');

  return Object.freeze({
    target: canonicalTarget,
    effect: target,
    modifier,
    delivery,
    outputItem: delivery === 'lingering'
      ? 'lingering_potion'
      : delivery === 'splash'
        ? 'splash_potion'
        : 'potion',
    ingredients: Object.freeze(ingredients),
  });
}

function potionComponent(item) {
  const fromMap = item?.componentMap?.get?.('potion_contents')?.data;
  if (fromMap && typeof fromMap === 'object') return fromMap;
  const fromArray = item?.components?.find?.(component => component?.type === 'potion_contents')?.data;
  return fromArray && typeof fromArray === 'object' ? fromArray : null;
}

export function potionIdentity(item) {
  const legacy = item?.nbt?.value?.Potion?.value;
  if (typeof legacy === 'string' && legacy) return legacy.replace(/^minecraft:/, '');
  const component = potionComponent(item);
  if (Number.isInteger(component?.potionId)) return `registry:${component.potionId}`;
  if (typeof component?.potion === 'string') return component.potion.replace(/^minecraft:/, '');
  return null;
}

export function isWaterPotion(item) {
  if (item?.name !== 'potion') return false;
  const identity = potionIdentity(item);
  // The vanilla potion registry keeps water at id 0. Named/NBT forms are
  // retained for older protocol adapters.
  return identity === 'water'
    || identity === 'registry:0'
    || String(item?.displayName || '').toLowerCase() === 'water bottle';
}

export function potionFingerprint(item) {
  if (!item) return 'empty';
  return JSON.stringify({
    name: item.name || null,
    type: item.type ?? null,
    metadata: item.metadata ?? null,
    potion: potionIdentity(item),
    components: item.components || null,
    nbt: item.nbt || null,
  });
}

export const BREWABLE_POTION_TARGETS = Object.freeze(Object.keys(BASE_RECIPES));
