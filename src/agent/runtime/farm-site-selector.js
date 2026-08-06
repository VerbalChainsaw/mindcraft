import Vec3 from 'vec3';

import {
  isFallingGameplayBlock,
  isHazardousGameplayBlock,
  isLiquidGameplayBlock,
  isProtectedGameplayBlock,
  isReplaceableGameplayBlock,
  isSafeGameplaySupport,
} from './gameplay-safety.js';

const TILLABLE_SOIL = new Set(['dirt', 'grass_block', 'farmland']);
const MAX_BOUND_SITES = 16;

function blockAt(bot, x, y, z) {
  try {
    return bot.blockAt(new Vec3(x, y, z));
  } catch {
    return null;
  }
}

function cellOccupied(bot, x, y, z) {
  const center = new Vec3(x + 0.5, y, z + 0.5);
  return Object.values(bot.entities || {}).some(entity => (
    entity?.position
    && entity.id !== bot.entity?.id
    && Math.abs(entity.position.y - center.y) < 1.8
    && Math.hypot(entity.position.x - center.x, entity.position.z - center.z) < 0.8
  ));
}

function canStandAt(bot, x, feetY, z) {
  const support = blockAt(bot, x, feetY - 1, z);
  const feet = blockAt(bot, x, feetY, z);
  const head = blockAt(bot, x, feetY + 1, z);
  return Boolean(
    isSafeGameplaySupport(support)
    && feet
    && head
    && feet.boundingBox === 'empty'
    && head.boundingBox === 'empty'
    && !isLiquidGameplayBlock(feet)
    && !isLiquidGameplayBlock(head)
    && !isHazardousGameplayBlock(support)
    && !isHazardousGameplayBlock(feet)
    && !isHazardousGameplayBlock(head)
    && !cellOccupied(bot, x, feetY, z)
  );
}

function usableFarmCell(bot, cell, crop) {
  const soil = blockAt(bot, cell.x, cell.y, cell.z);
  const above = blockAt(bot, cell.x, cell.y + 1, cell.z);
  if (!soil || !above || !TILLABLE_SOIL.has(soil.name)) return false;
  if (isProtectedGameplayBlock(soil) || isProtectedGameplayBlock(above)) return false;
  if (isLiquidGameplayBlock(above) || isHazardousGameplayBlock(above) || isFallingGameplayBlock(above)) return false;
  if (!['air', crop].includes(above.name) && !isReplaceableGameplayBlock(above)) return false;
  return !cellOccupied(bot, cell.x, cell.y + 1, cell.z);
}

function hydratedBy(water, cell) {
  return Math.abs(water.x - cell.x) <= 4
    && Math.abs(water.z - cell.z) <= 4
    && (water.y === cell.y || water.y === cell.y + 1);
}

function rectangleCells(origin, width, depth) {
  const cells = [];
  for (let dx = 0; dx < width; dx += 1) {
    for (let dz = 0; dz < depth; dz += 1) {
      cells.push({ x: origin.x + dx, y: origin.y, z: origin.z + dz });
    }
  }
  return cells;
}

function serviceStances(bot, origin, width, depth) {
  const positions = [];
  const add = (x, z) => {
    const feetY = origin.y + 1;
    if (canStandAt(bot, x, feetY, z)) positions.push({ x, y: feetY, z });
  };
  for (let x = origin.x - 1; x <= origin.x + width; x += 1) {
    add(x, origin.z - 1);
    add(x, origin.z + depth);
  }
  for (let z = origin.z; z < origin.z + depth; z += 1) {
    add(origin.x - 1, z);
    add(origin.x + width, z);
  }
  return positions;
}

/**
 * Bind safe perimeter stances for an already remembered farm footprint.
 * Unlike site selection, this never proposes new soil or construction; it only
 * answers where native Pathfinder may stand to service the existing cells.
 */
export function selectRememberedFarmStances(bot, cells) {
  const normalized = (Array.isArray(cells) ? cells : [])
    .filter(cell => [cell?.x, cell?.y, cell?.z].every(Number.isFinite))
    .map(cell => ({ x: Math.floor(cell.x), y: Math.floor(cell.y), z: Math.floor(cell.z) }));
  if (normalized.length === 0 || normalized.length !== cells.length) return [];
  const y = normalized[0].y;
  if (normalized.some(cell => cell.y !== y)) return [];
  const xs = normalized.map(cell => cell.x);
  const zs = normalized.map(cell => cell.z);
  const origin = { x: Math.min(...xs), y, z: Math.min(...zs) };
  return serviceStances(
    bot,
    origin,
    Math.max(...xs) - origin.x + 1,
    Math.max(...zs) - origin.z + 1,
  );
}

function waterPosition(block) {
  const position = block?.position;
  if (!position || block?.name !== 'water') return null;
  if (![position.x, position.y, position.z].every(Number.isFinite)) return null;
  return {
    x: Math.floor(position.x),
    y: Math.floor(position.y),
    z: Math.floor(position.z),
  };
}

/**
 * Bind complete farm footprints before the executor changes terrain.
 *
 * Paper's FarmBlock checks water within four blocks horizontally at the soil
 * level or one block above it. The selector mirrors that contract, rejects
 * incomplete rectangles, and returns perimeter stances for native no-dig
 * route probing. It does not invent irrigation or authorize construction.
 */
export function selectFarmSites(bot, waterBlocks, {
  crop = 'wheat',
  width = 3,
  depth = 3,
  limit = MAX_BOUND_SITES,
} = {}) {
  const waters = (Array.isArray(waterBlocks) ? waterBlocks : [])
    .map(waterPosition)
    .filter(Boolean);
  const origins = new Map();

  for (const water of waters) {
    for (const soilY of [water.y, water.y - 1]) {
      for (let x = water.x - 4; x <= water.x + 4; x += 1) {
        for (let z = water.z - 4; z <= water.z + 4; z += 1) {
          const key = `${x},${soilY},${z}`;
          const entry = origins.get(key) || { origin: { x, y: soilY, z }, waters: [] };
          entry.waters.push(water);
          origins.set(key, entry);
        }
      }
    }
  }

  const requested = width * depth;
  let bestAvailable = 0;
  const sites = [];
  for (const entry of origins.values()) {
    const cells = rectangleCells(entry.origin, width, depth);
    const water = entry.waters.find(candidate => cells.every(cell => hydratedBy(candidate, cell)));
    if (!water) continue;
    const available = cells.filter(cell => usableFarmCell(bot, cell, crop)).length;
    bestAvailable = Math.max(bestAvailable, available);
    if (available !== requested) continue;
    const stances = serviceStances(bot, entry.origin, width, depth);
    if (stances.length === 0) continue;
    const distance = Math.min(...stances.map(stance => (
      bot.entity.position.distanceTo(new Vec3(stance.x, stance.y, stance.z))
    )));
    const verticalDelta = Math.abs(bot.entity.position.y - (entry.origin.y + 1));
    const existingPlots = cells.filter(cell => (
      blockAt(bot, cell.x, cell.y, cell.z)?.name === 'farmland'
      && blockAt(bot, cell.x, cell.y + 1, cell.z)?.name === crop
    )).length;
    const clearanceChanges = cells.filter(cell => {
      const above = blockAt(bot, cell.x, cell.y + 1, cell.z);
      return above?.name !== 'air' && above?.name !== crop;
    }).length;
    sites.push({
      origin: entry.origin,
      water,
      cells,
      stances,
      distance,
      verticalDelta,
      existingPlots,
      clearanceChanges,
    });
  }

  sites.sort((left, right) => (
    left.verticalDelta - right.verticalDelta
    || right.existingPlots - left.existingPlots
    || left.clearanceChanges - right.clearanceChanges
    || left.distance - right.distance
    || left.origin.y - right.origin.y
    || left.origin.x - right.origin.x
    || left.origin.z - right.origin.z
  ));
  return {
    sites: sites.slice(0, Math.max(1, Math.floor(Number(limit) || MAX_BOUND_SITES))),
    waterCount: waters.length,
    requested,
    bestAvailable,
  };
}
