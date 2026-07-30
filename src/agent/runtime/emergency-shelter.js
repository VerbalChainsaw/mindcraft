const cells = [];
for (let y = 0; y <= 1; y += 1) {
  for (let x = -1; x <= 1; x += 1) {
    for (let z = -1; z <= 1; z += 1) {
      const perimeter = Math.abs(x) === 1 || Math.abs(z) === 1;
      const doorway = x === 0 && z === -1;
      if (perimeter && !doorway) {
        cells.push(Object.freeze({ x, y, z, material: 'survival_building_block' }));
      }
    }
  }
}
for (let x = -1; x <= 1; x += 1) {
  for (let z = -1; z <= 1; z += 1) {
    cells.push(Object.freeze({ x, y: 2, z, material: 'survival_building_block' }));
  }
}

export const EMERGENCY_SHELTER_BLUEPRINT = Object.freeze({
  id: 'emergency_3x3',
  version: 1,
  width: 3,
  depth: 3,
  height: 3,
  entrance: Object.freeze({ x: 0, y: 0, z: -1, width: 1, height: 2 }),
  cells: Object.freeze(cells),
});

export function validateEmergencyShelterBlueprint(blueprint = EMERGENCY_SHELTER_BLUEPRINT) {
  if (
    blueprint?.id !== 'emergency_3x3'
    || blueprint.width !== 3
    || blueprint.depth !== 3
    || blueprint.height !== 3
    || !Array.isArray(blueprint.cells)
    || blueprint.cells.length !== 23
  ) return false;
  const occupied = new Set();
  for (const cell of blueprint.cells) {
    if (
      !Number.isInteger(cell?.x)
      || !Number.isInteger(cell?.y)
      || !Number.isInteger(cell?.z)
      || cell.material !== 'survival_building_block'
      || Math.abs(cell.x) > 1
      || cell.y < 0
      || cell.y > 2
      || Math.abs(cell.z) > 1
    ) return false;
    const key = `${cell.x}:${cell.y}:${cell.z}`;
    if (occupied.has(key)) return false;
    occupied.add(key);
  }
  return !occupied.has('0:0:-1') && !occupied.has('0:1:-1');
}
