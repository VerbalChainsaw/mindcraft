import Vec3 from 'vec3';

import {
  isHazardousGameplayBlock,
  isLiquidGameplayBlock,
  isProtectedGameplayBlock,
  isReplaceableGameplayBlock,
  isSafeGameplaySupport,
} from '../gameplay-safety.js';

const DEFAULT_SEARCH_RADIUS = 12;
const DEFAULT_VERTICAL_RADIUS = 12;
const DEFAULT_SITE_LIMIT = 16;
const MIN_CLEARANCE_LIMIT = 4;
const MAX_CLEARANCE_LIMIT = 32;
const CLEARANCE_FRACTION = 0.1;

function blockAt(bot, x, y, z) {
  try {
    return bot.blockAt(new Vec3(x, y, z));
  } catch {
    return null;
  }
}

// Dropped items, experience orbs, and loose projectiles have no collision and
// do not obstruct block placement, so they must not veto a site. They are also
// the normal by-product of the mining and harvesting that precedes a build,
// which made site rejection intermittent: items despawn and orbs drift, so the
// same anchor could pass or fail across attempts. Players and mobs still count.
const NON_OBSTRUCTING_ENTITY_NAMES = new Set(['item', 'experience_orb', 'arrow']);

function entityOccupies(bot, x, y, z) {
  const center = new Vec3(x + 0.5, y, z + 0.5);
  return Object.values(bot.entities || {}).some(entity => (
    entity?.id !== bot.entity?.id
    && entity?.position
    && !NON_OBSTRUCTING_ENTITY_NAMES.has(entity?.name)
    && Math.abs(entity.position.y - center.y) < 1.8
    && Math.hypot(entity.position.x - center.x, entity.position.z - center.z) < 0.8
  ));
}

function clearConstructionCell(block) {
  return Boolean(
    block
    && isReplaceableGameplayBlock(block)
    && !isLiquidGameplayBlock(block)
    && !isHazardousGameplayBlock(block)
    && !isProtectedGameplayBlock(block)
  );
}

function constructionCellDisposition(block, isNaturalTerrain) {
  if (clearConstructionCell(block)) return 'clear';
  if (block && isNaturalTerrain(block)) return 'clearable_natural';
  return null;
}

function naturalSupport(block, isNaturalTerrain) {
  return Boolean(
    isSafeGameplaySupport(block)
    && !String(block?.name || '').endsWith('_leaves')
    && isNaturalTerrain(block)
  );
}

function serviceStances(bot, anchor, blueprint, isNaturalTerrain) {
  const stances = [];
  const add = (x, z) => {
    const feet = blockAt(bot, x, anchor.y, z);
    const head = blockAt(bot, x, anchor.y + 1, z);
    const support = blockAt(bot, x, anchor.y - 1, z);
    if (
      clearConstructionCell(feet)
      && clearConstructionCell(head)
      && naturalSupport(support, isNaturalTerrain)
      && !entityOccupies(bot, x, anchor.y, z)
    ) stances.push({ x, y: anchor.y, z });
  };
  for (let x = anchor.x - 1; x <= anchor.x + blueprint.width; x += 1) {
    add(x, anchor.z - 1);
    add(x, anchor.z + blueprint.depth);
  }
  for (let z = anchor.z; z < anchor.z + blueprint.depth; z += 1) {
    add(anchor.x - 1, z);
    add(anchor.x + blueprint.width, z);
  }
  return stances;
}

function inspectSite(bot, blueprint, anchor, isNaturalTerrain, clearanceLimit) {
  const minY = Math.min(...blueprint.cells.map(cell => cell.y));
  const baseCells = blueprint.cells.filter(cell => cell.y === minY);
  let supportedBaseCells = 0;
  let clearanceCount = 0;
  for (const cell of blueprint.cells) {
    const x = anchor.x + cell.x;
    const y = anchor.y + cell.y;
    const z = anchor.z + cell.z;
    const disposition = constructionCellDisposition(
      blockAt(bot, x, y, z),
      isNaturalTerrain,
    );
    if (!disposition) return null;
    if (disposition === 'clearable_natural') {
      clearanceCount += 1;
      // Natural terrain is admissible only as bounded site preparation. A
      // completely buried volume is technically clearable, but it is not a
      // sensible construction site and must never win merely because every
      // floor cell has support.
      if (clearanceCount > clearanceLimit) return null;
    }
    if (entityOccupies(bot, x, y, z)) return null;
    if (cell.y === minY && naturalSupport(blockAt(bot, x, y - 1, z), isNaturalTerrain)) {
      supportedBaseCells += 1;
    }
  }
  if (supportedBaseCells === 0) return null;

  const botPosition = bot.entity?.position;
  if (
    botPosition
    && Math.floor(botPosition.x) >= anchor.x
    && Math.floor(botPosition.x) < anchor.x + blueprint.width
    && Math.floor(botPosition.z) >= anchor.z
    && Math.floor(botPosition.z) < anchor.z + blueprint.depth
    && Math.floor(botPosition.y) >= anchor.y
    && Math.floor(botPosition.y) < anchor.y + blueprint.height
  ) return null;

  const stances = serviceStances(bot, anchor, blueprint, isNaturalTerrain);
  if (stances.length === 0) return null;
  const distance = botPosition
    ? Math.min(...stances.map(stance => botPosition.distanceTo(new Vec3(stance.x, stance.y, stance.z))))
    : Number.POSITIVE_INFINITY;
  const unsupportedBaseCells = baseCells.length - supportedBaseCells;
  return {
    origin: anchor,
    stances,
    supportedBaseCells,
    baseCellCount: baseCells.length,
    supportRatio: supportedBaseCells / baseCells.length,
    clearanceCount,
    terrainFitCost: clearanceCount + unsupportedBaseCells,
    verticalDelta: botPosition ? Math.abs(botPosition.y - anchor.y) : 0,
    distance,
  };
}

function horizontalOffsets(radius) {
  const offsets = [];
  for (let x = -radius; x <= radius; x += 1) {
    for (let z = -radius; z <= radius; z += 1) {
      const distance = Math.hypot(x, z);
      if (distance >= 2 && distance <= radius) offsets.push({ x, z, distance });
    }
  }
  return offsets.sort((left, right) => (
    left.distance - right.distance
    || left.x - right.x
    || left.z - right.z
  ));
}

function verticalOffsets(radius) {
  const offsets = [0];
  for (let distance = 1; distance <= radius; distance += 1) {
    offsets.push(distance, -distance);
  }
  return offsets;
}

/**
 * Bind new construction only to clear, naturally supported loaded terrain.
 * This selector is read-only: it authorizes no clearing and performs no
 * locomotion. Builder remains responsible for exact placement and verification.
 */
export function selectConstructionSites(bot, blueprint, {
  origin = bot?.entity?.position,
  radius = DEFAULT_SEARCH_RADIUS,
  verticalRadius = DEFAULT_VERTICAL_RADIUS,
  limit = DEFAULT_SITE_LIMIT,
  isNaturalTerrain = () => false,
} = {}) {
  if (
    !bot?.entity?.position
    || !origin
    || !Array.isArray(blueprint?.cells)
    || blueprint.cells.length === 0
    || ![blueprint?.width, blueprint?.height, blueprint?.depth].every(Number.isInteger)
  ) return { sites: [], inspected: 0 };

  const base = {
    x: Math.floor(origin.x),
    y: Math.floor(origin.y),
    z: Math.floor(origin.z),
  };
  const sites = [];
  let inspected = 0;
  const boundedRadius = Math.max(4, Math.min(24, Math.floor(Number(radius) || DEFAULT_SEARCH_RADIUS)));
  const boundedVertical = Math.max(2, Math.min(16, Math.floor(Number(verticalRadius) || DEFAULT_VERTICAL_RADIUS)));
  const boundedLimit = Math.max(1, Math.min(32, Math.floor(Number(limit) || DEFAULT_SITE_LIMIT)));
  const clearanceLimit = Math.max(
    MIN_CLEARANCE_LIMIT,
    Math.min(MAX_CLEARANCE_LIMIT, Math.ceil(blueprint.cells.length * CLEARANCE_FRACTION)),
  );

  for (const horizontal of horizontalOffsets(boundedRadius)) {
    for (const yOffset of verticalOffsets(boundedVertical)) {
      inspected += 1;
      const site = inspectSite(bot, blueprint, {
        x: base.x + horizontal.x,
        y: base.y + yOffset,
        z: base.z + horizontal.z,
      }, isNaturalTerrain, clearanceLimit);
      if (site) sites.push(site);
    }
    if (sites.length >= boundedLimit) break;
  }

  sites.sort((left, right) => (
    left.terrainFitCost - right.terrainFitCost
    || left.clearanceCount - right.clearanceCount
    || right.supportRatio - left.supportRatio
    || left.verticalDelta - right.verticalDelta
    || left.distance - right.distance
    || left.origin.y - right.origin.y
    || left.origin.x - right.origin.x
    || left.origin.z - right.origin.z
  ));
  return { sites: sites.slice(0, boundedLimit), inspected };
}
