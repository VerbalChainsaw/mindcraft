function canonicalDimension(value) {
  return String(value || '').trim().toLowerCase().replace(/^minecraft:/, '');
}

function isFenceBoundary(block) {
  const name = String(block?.name || '');
  return name.endsWith('_fence') || name.endsWith('_fence_gate');
}

function enclosureComponent(bot, gatePosition) {
  const queue = [gatePosition];
  const visited = new Map();
  while (queue.length > 0 && visited.size < 256) {
    const position = queue.shift();
    const key = `${position.x},${position.y},${position.z}`;
    if (visited.has(key)) continue;
    const block = bot.blockAt(position);
    if (!isFenceBoundary(block)) continue;
    visited.set(key, { block, position });
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      queue.push(position.offset(x, 0, z));
    }
  }
  return [...visited.values()];
}

/**
 * Bind the settlement skill to one physically observed, closed fence
 * enclosure. The result is data only; this module never opens the gate or
 * moves an entity.
 */
export function penConstraintForGate(bot, gatePosition, animal, origin = gatePosition) {
  if (!bot?.blockAt || !gatePosition) return null;
  const component = enclosureComponent(bot, gatePosition);
  if (component.length < 8) return null;
  const xs = component.map(entry => entry.position.x);
  const zs = component.map(entry => entry.position.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const y = gatePosition.y;
  const width = maxX - minX + 1;
  const depth = maxZ - minZ + 1;
  if (width < 3 || width > 16 || depth < 3 || depth > 16) return null;

  for (let x = minX; x <= maxX; x += 1) {
    for (const z of [minZ, maxZ]) {
      if (!isFenceBoundary(bot.blockAt(gatePosition.offset(x - gatePosition.x, 0, z - gatePosition.z)))) return null;
    }
  }
  for (let z = minZ; z <= maxZ; z += 1) {
    for (const x of [minX, maxX]) {
      if (!isFenceBoundary(bot.blockAt(gatePosition.offset(x - gatePosition.x, 0, z - gatePosition.z)))) return null;
    }
  }

  let outside;
  if (gatePosition.x === minX) outside = { x: gatePosition.x - 1, y, z: gatePosition.z };
  else if (gatePosition.x === maxX) outside = { x: gatePosition.x + 1, y, z: gatePosition.z };
  else if (gatePosition.z === minZ) outside = { x: gatePosition.x, y, z: gatePosition.z - 1 };
  else if (gatePosition.z === maxZ) outside = { x: gatePosition.x, y, z: gatePosition.z + 1 };
  else return null;

  const inside = {
    x: Math.floor((minX + maxX) / 2),
    y,
    z: Math.floor((minZ + maxZ) / 2),
  };
  const insideFeet = bot.blockAt(gatePosition.offset(
    inside.x - gatePosition.x,
    0,
    inside.z - gatePosition.z,
  ));
  const insideHead = bot.blockAt(gatePosition.offset(
    inside.x - gatePosition.x,
    1,
    inside.z - gatePosition.z,
  ));
  const support = bot.blockAt(gatePosition.offset(
    inside.x - gatePosition.x,
    -1,
    inside.z - gatePosition.z,
  ));
  if (insideFeet?.boundingBox !== 'empty' || insideHead?.boundingBox !== 'empty' || support?.boundingBox !== 'block') return null;

  const baselineAnimals = Object.values(bot.entities || {}).filter(entity => (
    entity?.name === animal
    && entity.position
    && entity.position.x > minX
    && entity.position.x < maxX + 1
    && entity.position.z > minZ
    && entity.position.z < maxZ + 1
    && entity.position.y >= y - 1
    && entity.position.y <= y + 2
  )).length;
  return {
    gate: { x: gatePosition.x, y, z: gatePosition.z },
    inside,
    outside,
    bounds: { minX, maxX, minZ, maxZ, y },
    dimension: canonicalDimension(bot.game?.dimension),
    baselineAnimals,
    distance: Math.hypot(
      gatePosition.x - origin.x,
      gatePosition.y - origin.y,
      gatePosition.z - origin.z,
    ),
  };
}

export function currentAnimalPenConstraint(bot, animal, origin) {
  if (!origin || typeof bot?.findBlocks !== 'function' || typeof bot?.blockAt !== 'function') return null;
  const gates = bot.findBlocks({
    matching: block => String(block?.name || '').endsWith('_fence_gate'),
    maxDistance: 128,
    count: 32,
  });
  return gates
    .map(position => penConstraintForGate(bot, position, animal, origin))
    .filter(candidate => candidate && candidate.distance <= 32)
    .sort((left, right) => left.distance - right.distance)[0] || null;
}

/**
 * Recover the exact pen produced by the durable Builder order rather than
 * choosing whichever enclosure happens to be nearest after intervening work.
 */
export function animalPenConstraintFromOrder(bot, order, animal, expectedDimension) {
  const dimension = canonicalDimension(bot?.game?.dimension);
  if (
    !bot?.blockAt
    || !order
    || order.role !== 'builder'
    || order.kind !== 'build'
    || order.phase !== 'complete'
    || !String(order.blueprint?.id || '').startsWith('animal_pen_')
    || !Array.isArray(order.blueprint?.cells)
    || ![order.target?.x, order.target?.y, order.target?.z].every(Number.isFinite)
    || !dimension
    || (expectedDimension && canonicalDimension(expectedDimension) !== dimension)
  ) return null;
  const gateCells = order.blueprint.cells.filter(cell => (
    cell?.function === 'access'
    && String(cell.material || '').endsWith('_fence_gate')
    && [cell.x, cell.y, cell.z].every(Number.isFinite)
  ));
  for (const gateCell of gateCells) {
    const gatePosition = bot.blockAt(new Vec3(
      order.target.x + gateCell.x,
      order.target.y + gateCell.y,
      order.target.z + gateCell.z,
    ))?.position;
    if (!gatePosition) continue;
    const constraint = penConstraintForGate(bot, gatePosition, animal, order.target);
    if (constraint) return constraint;
  }
  return null;
}

export { canonicalDimension as canonicalLivestockDimension };
import Vec3 from 'vec3';
