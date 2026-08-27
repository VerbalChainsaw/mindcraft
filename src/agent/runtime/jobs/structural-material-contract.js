// The canonical material supplied for a Builder structure is deliberately
// narrower than a generic placeable block. Fences, gates, doors, and other
// fixtures have their own blueprint roles; they must not become a foundation,
// wall, roof, bridge, or other primary construction palette merely because
// Mineflayer reports a non-empty collision box.
const BASIC_PRIMARY_CONSTRUCTION_MATERIALS = new Set(['cobblestone', 'dirt', 'stone']);

export function isApprovedPrimaryConstructionMaterial(value) {
  const material = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return BASIC_PRIMARY_CONSTRUCTION_MATERIALS.has(material) || material.endsWith('_planks');
}
