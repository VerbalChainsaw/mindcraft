function blockRecord(registry, value) {
  if (value && typeof value === 'object' && typeof value.name === 'string') return value;
  return registry?.blocksByName?.[String(value || '').trim().toLowerCase()] || null;
}

export function blockCanSupportPlacement(registry, material) {
  return blockRecord(registry, material)?.boundingBox === 'block';
}

export function blockMatchesPlacement(registry, expectedName, observed) {
  const expected = String(expectedName || '').trim().toLowerCase();
  const current = blockRecord(registry, observed);
  if (!expected || !current) return false;
  if (current.name === expected) return true;
  if (expected === 'dirt' && current.name === 'grass_block') return true;

  // Mineflayer exposes one inventory item as different world blocks when the
  // server selects an attachment state: torch/wall_torch, sign/wall_sign, and
  // similar forms. Only empty-bounding-box blocks with the exact same single
  // drop are equivalent. Requiring both conditions prevents stone/cobblestone
  // and other transformed drops from becoming false blueprint matches.
  const expectedBlock = blockRecord(registry, expected);
  if (
    expectedBlock?.boundingBox !== 'empty'
    || current.boundingBox !== 'empty'
  ) return false;
  const expectedDrops = Array.isArray(expectedBlock.drops) ? expectedBlock.drops : [];
  const currentDrops = Array.isArray(current.drops) ? current.drops : [];
  return expectedDrops.length === 1
    && currentDrops.length === 1
    && expectedDrops[0] === currentDrops[0];
}
