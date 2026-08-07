const SHEEP_WOOL_COLORS = Object.freeze([
  'white',
  'orange',
  'magenta',
  'light_blue',
  'yellow',
  'lime',
  'pink',
  'gray',
  'light_gray',
  'cyan',
  'purple',
  'blue',
  'brown',
  'green',
  'red',
  'black',
]);

// Java Edition natural adult-sheep colour frequencies. Colours absent here do
// not naturally spawn and should rank behind a dye transform unless a matching
// sheep is physically observed.
const NATURAL_SHEEP_COLOR_FREQUENCY = Object.freeze({
  white: 0.81736,
  black: 0.05,
  gray: 0.05,
  light_gray: 0.05,
  brown: 0.03,
  pink: 0.00164,
});

function canonicalName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^minecraft:/, '')
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function sheepWoolState(entity) {
  if (entity?.name !== 'sheep') return null;
  const encoded = Number(entity.metadata?.[17]);
  if (!Number.isFinite(encoded)) return null;
  const color = SHEEP_WOOL_COLORS[encoded & 0x0f];
  if (!color) return null;
  return {
    color,
    item: `${color}_wool`,
    sheared: (encoded & 0x10) !== 0,
    baby: Boolean(entity.metadata?.[16]),
  };
}

/**
 * Versioned entity mechanics that are absent from minecraft-data. Keep this
 * catalogue about harvest mechanics; planners decide whether and when to use
 * them, while the physical adapter verifies the resulting inventory change.
 */
export function entityHarvestSources(registry, itemName) {
  const output = canonicalName(itemName);
  const color = output.endsWith('_wool') ? output.slice(0, -'_wool'.length) : null;
  if (
    !SHEEP_WOOL_COLORS.includes(color)
    || !registry?.itemsByName?.[output]
    || !registry?.itemsByName?.shears
    || !registry?.entitiesByName?.sheep
  ) return [];
  return [{
    entity: 'sheep',
    output,
    method: 'shear',
    requiredItem: 'shears',
    minimumYield: 1,
    naturalFrequency: NATURAL_SHEEP_COLOR_FREQUENCY[color] || 0,
  }];
}

export function entityMatchesHarvestSource(entity, source) {
  if (!entity || !source || entity.name !== source.entity) return false;
  if (source.method === 'shear' && source.entity === 'sheep') {
    const state = sheepWoolState(entity);
    return Boolean(state && !state.baby && !state.sheared && state.item === source.output);
  }
  return false;
}

export function entityHarvestOutput(entity, method='shear') {
  if (method !== 'shear') return null;
  const state = sheepWoolState(entity);
  return state && !state.baby && !state.sheared ? state.item : null;
}

export function entityHarvestSearchCost(source) {
  const frequency = Math.max(0, Math.min(1, Number(source?.naturalFrequency) || 0));
  return frequency > 0 ? Math.max(1, Math.ceil(1 / frequency)) : 1_000;
}
