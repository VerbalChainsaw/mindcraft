import Vec3 from 'vec3';

import { blockCanSupportPlacement } from '../block-placement-contract.js';
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
const HORIZONTAL_FACING_OFFSETS = Object.freeze({
  north: Object.freeze({ x: 0, z: -1 }),
  south: Object.freeze({ x: 0, z: 1 }),
  east: Object.freeze({ x: 1, z: 0 }),
  west: Object.freeze({ x: -1, z: 0 }),
});
const MAX_LANDMARK_FOOTPRINT_CELLS = 64;

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

function boundedLandmarkFootprint(bot, position, isNaturalTerrain) {
  const y = Math.floor(position.y) - 1;
  const start = { x: Math.floor(position.x), y, z: Math.floor(position.z) };
  const startBlock = blockAt(bot, start.x, start.y, start.z);
  if (!isSafeGameplaySupport(startBlock) || isNaturalTerrain(startBlock)) return null;
  const material = startBlock.name;
  const queue = [start];
  const visited = new Set();
  const cells = [];
  while (queue.length > 0) {
    const current = queue.shift();
    const key = `${current.x}:${current.z}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const block = blockAt(bot, current.x, y, current.z);
    if (
      block?.name !== material
      || !isSafeGameplaySupport(block)
      || isNaturalTerrain(block)
    ) continue;
    cells.push(current);
    if (cells.length > MAX_LANDMARK_FOOTPRINT_CELLS) return null;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      queue.push({ x: current.x + dx, y, z: current.z + dz });
    }
  }
  if (cells.length === 0) return null;
  return {
    material,
    y,
    minX: Math.min(...cells.map(cell => cell.x)),
    maxX: Math.max(...cells.map(cell => cell.x)),
    minZ: Math.min(...cells.map(cell => cell.z)),
    maxZ: Math.max(...cells.map(cell => cell.z)),
    cellCount: cells.length,
  };
}

function oppositeStairBlueprint(blueprint, axis, separation) {
  const fixtures = Array.isArray(blueprint?.fixtures) ? blueprint.fixtures : [];
  if (
    blueprint?.cells?.length !== 2
    || fixtures.length !== 2
    || fixtures.some(fixture => fixture?.kind !== 'stair' || fixture?.anchor?.y !== 0)
    || blueprint.cells.some(cell => cell?.y !== 0 || !cell.fixtureId)
  ) return null;
  const placements = axis === 'x'
    ? [{ x: 0, z: 0, facing: 'west' }, { x: separation, z: 0, facing: 'east' }]
    : [{ x: 0, z: 0, facing: 'north' }, { x: 0, z: separation, facing: 'south' }];
  const sourceCells = new Map(blueprint.cells.map(cell => [cell.fixtureId, cell]));
  const transformedFixtures = fixtures.map((fixture, index) => ({
    ...fixture,
    facing: placements[index].facing,
    anchor: { ...fixture.anchor, x: placements[index].x, z: placements[index].z },
  }));
  const transformedCells = transformedFixtures.map((fixture, index) => ({
    ...sourceCells.get(fixture.id),
    x: placements[index].x,
    z: placements[index].z,
    facing: placements[index].facing,
  }));
  if (transformedCells.some(cell => !cell.material)) return null;
  return {
    ...blueprint,
    width: axis === 'x' ? separation + 1 : 1,
    depth: axis === 'z' ? separation + 1 : 1,
    height: 1,
    cells: transformedCells,
    fixtures: transformedFixtures,
  };
}

function oppositeLayoutCellIsUsable(bot, position) {
  return Boolean(
    clearConstructionCell(blockAt(bot, position.x, position.y, position.z))
    && isSafeGameplaySupport(blockAt(bot, position.x, position.y - 1, position.z))
    && !entityOccupies(bot, position.x, position.y, position.z)
  );
}

/**
 * Bind a two-fixture promise to opposite edges of one loaded, bounded,
 * player-made landmark. This is sparse relational site judgment, not route
 * planning: callers still require native Pathfinder proofs to the exact
 * orientation stances before accepting the transformed ordinary blueprint.
 */
export function selectOppositeLandmarkLayoutSites(bot, blueprint, {
  landmark,
  clearance = 0,
  isNaturalTerrain = () => false,
} = {}) {
  if (!bot?.entity?.position || !landmark) return { sites: [], inspected: 0, code: 'landmark_unloaded' };
  const footprint = boundedLandmarkFootprint(bot, landmark, isNaturalTerrain);
  if (!footprint) return { sites: [], inspected: 0, code: 'landmark_footprint_unproven' };
  const gap = Math.max(0, Math.min(4, Math.floor(Number(clearance) || 0))) + 1;
  const centerX = Math.floor((footprint.minX + footprint.maxX) / 2);
  const centerZ = Math.floor((footprint.minZ + footprint.maxZ) / 2);
  const candidates = [
    {
      axis: 'x',
      origin: { x: footprint.minX - gap, y: footprint.y, z: centerZ },
      separation: footprint.maxX - footprint.minX + (2 * gap),
    },
    {
      axis: 'z',
      origin: { x: centerX, y: footprint.y, z: footprint.minZ - gap },
      separation: footprint.maxZ - footprint.minZ + (2 * gap),
    },
  ];
  const sites = [];
  for (const candidate of candidates) {
    const transformed = oppositeStairBlueprint(blueprint, candidate.axis, candidate.separation);
    if (!transformed) return { sites: [], inspected: 0, code: 'opposite_layout_design_mismatch' };
    const positions = transformed.fixtures.map(fixture => ({
      x: candidate.origin.x + fixture.anchor.x,
      y: candidate.origin.y + fixture.anchor.y,
      z: candidate.origin.z + fixture.anchor.z,
    }));
    if (!positions.every(position => oppositeLayoutCellIsUsable(bot, position))) continue;
    sites.push({
      origin: candidate.origin,
      blueprint: transformed,
      axis: candidate.axis,
      footprint,
      fixturePositions: positions,
      distance: Math.min(...positions.map(position => bot.entity.position.distanceTo(new Vec3(
        position.x,
        position.y,
        position.z,
      )))),
    });
  }
  sites.sort((left, right) => left.distance - right.distance || left.axis.localeCompare(right.axis));
  return { sites, inspected: candidates.length, code: sites.length > 0 ? 'layout_sites_found' : 'no_legal_layout' };
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

function serviceRingSize(blueprint) {
  return 2 * blueprint.width + 2 * blueprint.depth + 4;
}

function accessApproaches(bot, anchor, blueprint, isNaturalTerrain) {
  const fixtures = (Array.isArray(blueprint.fixtures) ? blueprint.fixtures : [])
    .filter(fixture => fixture?.kind === 'door' && fixture?.function === 'access');
  if (fixtures.length === 0) return [];

  const approaches = [];
  for (const fixture of fixtures) {
    const inward = HORIZONTAL_FACING_OFFSETS[fixture.facing];
    if (!inward || !fixture.anchor) return null;
    const door = {
      x: anchor.x + fixture.anchor.x,
      y: anchor.y + fixture.anchor.y,
      z: anchor.z + fixture.anchor.z,
    };
    // Structure-design facings point into the building. Reserve two body-clear
    // exterior cells in the opposite direction so the promised entrance is
    // both placeable from its orientation-correct side and actually usable by
    // a player. This is deliberately site-selection judgment; Pathfinder
    // still owns locomotion to the accepted stance.
    const exterior = { x: -inward.x, z: -inward.z };
    const approachY = [door.y - 1, door.y].find(y => [1, 2].every(distance => {
      const x = door.x + exterior.x * distance;
      const z = door.z + exterior.z * distance;
      return (
        clearConstructionCell(blockAt(bot, x, y, z))
        && clearConstructionCell(blockAt(bot, x, y + 1, z))
        && naturalSupport(blockAt(bot, x, y - 1, z), isNaturalTerrain)
        && !entityOccupies(bot, x, y, z)
      );
    }));
    if (approachY == null) return null;
    approaches.push({
      x: door.x + exterior.x * 2,
      y: approachY,
      z: door.z + exterior.z * 2,
      fixtureId: fixture.id,
    });
  }
  return approaches;
}

function inspectSite(bot, blueprint, anchor, isNaturalTerrain, clearanceLimit) {
  const minY = Math.min(...blueprint.cells.map(cell => cell.y));
  const baseCells = blueprint.cells.filter(cell => cell.y === minY);
  const baseByPosition = new Map(baseCells.map(cell => [`${cell.x}:${cell.z}`, cell]));
  const plannedBaseSupport = cell => [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ].some(([dx, dz]) => {
    const support = baseByPosition.get(`${cell.x + dx}:${cell.z + dz}`);
    return support && blockCanSupportPlacement(bot.registry, support.material);
  });
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
    if (cell.y === minY) {
      const naturallySupported = naturalSupport(blockAt(bot, x, y - 1, z), isNaturalTerrain);
      if (naturallySupported) supportedBaseCells += 1;
      // Match Builder's execution audit: a connected foundation course may
      // bridge from neighbouring planned full blocks, but an isolated base
      // cell must have real ground beneath it. Selecting anything looser only
      // delays the same rejection until after the order is accepted.
      if (!naturallySupported && !plannedBaseSupport(cell)) return null;
    }
  }
  if (supportedBaseCells === 0) return null;

  const access = accessApproaches(bot, anchor, blueprint, isNaturalTerrain);
  if (access == null) return null;

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
  // Builder delegates locomotion to no-dig, no-scaffold Pathfinder. Accepting
  // one good edge while another hangs over a drop lets construction seal the
  // bot inside and leaves later wall/roof faces physically unreachable. Match
  // site judgment to that capability: preserve a connected one-cell work ring
  // around the complete footprint.
  if (stances.length !== serviceRingSize(blueprint)) return null;
  const distance = botPosition
    ? Math.min(...stances.map(stance => botPosition.distanceTo(new Vec3(stance.x, stance.y, stance.z))))
    : Number.POSITIVE_INFINITY;
  const unsupportedBaseCells = baseCells.length - supportedBaseCells;
  return {
    origin: anchor,
    stances,
    accessApproaches: access,
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
