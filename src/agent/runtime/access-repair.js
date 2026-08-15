import Vec3 from 'vec3';

import {
  isHazardousGameplayBlock,
  isLiquidGameplayBlock,
  isProtectedGameplayBlock,
  isReplaceableGameplayBlock,
  isSafeGameplaySupport,
} from './gameplay-safety.js';
import { createWorkOrder } from './work-order.js';

const ACCESS_REPAIR_CUE = /\b(?:fix|repair|patch|bridge|cover|fill)\b[\s\S]{0,120}\b(?:gap|hole|chasm|walkway|path|approach)\b|\b(?:gap|hole|chasm)\b[\s\S]{0,120}\b(?:fix|repair|patch|bridge|cover|fill)\b/i;
const EXISTING_ACCESS_CUE = /\b(?:front\s+)?(?:door|doorway|entrance|entry|gate)\b/i;
const HORIZONTAL = Object.freeze({
  north: Object.freeze({ x: 0, z: -1 }),
  south: Object.freeze({ x: 0, z: 1 }),
  east: Object.freeze({ x: 1, z: 0 }),
  west: Object.freeze({ x: -1, z: 0 }),
});
const MAX_GAP_CELLS = 8;

function canonicalDimension(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^minecraft:/, '')
    .replace(/^the_nether$/, 'nether')
    .replace(/^the_end$/, 'end')
    .replace(/[^a-z0-9_]/g, '');
}

function blockAt(bot, point) {
  try {
    return bot.blockAt(new Vec3(point.x, point.y, point.z));
  } catch {
    return null;
  }
}

function clearBodyCell(block) {
  return Boolean(
    block
    && isReplaceableGameplayBlock(block)
    && !isLiquidGameplayBlock(block)
    && !isHazardousGameplayBlock(block)
    && !isProtectedGameplayBlock(block)
  );
}

function fullBlockMaterial(bot, raw) {
  const name = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^(?:these|this|the|our|my|your|supplied|carried|some)\s+/, '')
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
  const block = bot?.registry?.blocksByName?.[name];
  const item = bot?.registry?.itemsByName?.[name];
  return block?.boundingBox === 'block' && item ? name : '';
}

function requestedMaterial(bot, message) {
  const text = String(message || '').toLowerCase();
  const clause = /\b(?:use|using|with|from)\s+((?:(?:only|these|this|the|our|my|your|supplied|carried|some)\s+){0,2}[a-z][a-z _-]{1,40}?)(?=\s+(?:to|for|on|at|in|that|which|from|and)\b|[,.;]|$)/i.exec(text);
  const bound = fullBlockMaterial(bot, clause?.[1]);
  if (bound) return bound;
  const candidates = Object.keys(bot?.registry?.blocksByName || {})
    .filter(name => bot.registry.itemsByName?.[name] && bot.registry.blocksByName[name]?.boundingBox === 'block')
    .sort((left, right) => right.length - left.length);
  return candidates.find(name => new RegExp(`\\b${name.replaceAll('_', '[ _-]+')}\\b`, 'i').test(text)) || '';
}

function distanceSquared(point, origin) {
  return ((point.x + 0.5) - origin.x) ** 2
    + ((point.y + 0.5) - origin.y) ** 2
    + ((point.z + 0.5) - origin.z) ** 2;
}

function loadedLowerDoors(bot, origin) {
  if (typeof bot?.findBlocks !== 'function') return [];
  let positions;
  try {
    positions = bot.findBlocks({
      matching: block => (
        String(block?.name || '').endsWith('_door')
        && block.getProperties?.().half === 'lower'
      ),
      maxDistance: 16,
      count: 24,
    });
  } catch {
    return [];
  }
  return (positions || [])
    .map(position => ({ x: Math.floor(position.x), y: Math.floor(position.y), z: Math.floor(position.z) }))
    .sort((left, right) => distanceSquared(left, origin) - distanceSquared(right, origin));
}

/**
 * Select one already-loaded access fixture and the exact unsupported surface
 * cells between it and the first safe exterior stance. This owns judgment only:
 * Builder still owns placement and Pathfinder later proves the finished route.
 */
export function selectExistingAccessRepair(bot, message, requesterPosition = null) {
  const text = String(message || '');
  if (!ACCESS_REPAIR_CUE.test(text) || !EXISTING_ACCESS_CUE.test(text)) return null;
  const material = requestedMaterial(bot, text);
  if (!material) {
    return { rejection: 'Tell me which carried full block to use for the access repair, so I do not choose or gather a different material.' };
  }
  const origin = requesterPosition || bot?.entity?.position;
  if (!origin || ![origin.x, origin.y, origin.z].every(Number.isFinite)) {
    return { rejection: 'I cannot bind the access repair because the requester position is not loaded.' };
  }
  const doors = loadedLowerDoors(bot, origin);
  if (doors.length === 0) {
    return { rejection: 'I cannot identify a loaded existing doorway near you, so I will not build at a guessed site.' };
  }
  if (doors.length > 1 && distanceSquared(doors[1], origin) - distanceSquared(doors[0], origin) < 4) {
    return { rejection: 'I can see more than one equally near doorway. Tell me which one to repair.' };
  }
  const door = doors[0];
  const doorBlock = blockAt(bot, door);
  const facing = String(doorBlock?.getProperties?.().facing || '').toLowerCase();
  const outward = HORIZONTAL[facing];
  const dimension = canonicalDimension(bot?.game?.dimension);
  if (!outward || !dimension) {
    return { rejection: 'The selected doorway has no verified horizontal facing or dimension, so I will not guess its approach.' };
  }

  const surfaceY = door.y - 1;
  const cells = [];
  let exteriorStance = null;
  for (let distance = 1; distance <= MAX_GAP_CELLS + 1; distance += 1) {
    const point = {
      x: door.x + (outward.x * distance),
      y: surfaceY,
      z: door.z + (outward.z * distance),
    };
    const surface = blockAt(bot, point);
    const below = blockAt(bot, { ...point, y: point.y - 1 });
    const feet = blockAt(bot, { ...point, y: point.y + 1 });
    const head = blockAt(bot, { ...point, y: point.y + 2 });
    if (!clearBodyCell(feet) || !clearBodyCell(head)) {
      return { rejection: 'The existing doorway approach is obstructed, so a surface patch alone would not make it safely walkable.' };
    }
    if (isSafeGameplaySupport(surface)) {
      exteriorStance = { x: point.x, y: point.y + 1, z: point.z };
      break;
    }
    if (!clearBodyCell(surface)) {
      return { rejection: 'The existing doorway approach contains a protected or non-replaceable block, so I will not alter it.' };
    }
    if (isSafeGameplaySupport(below)) {
      exteriorStance = { x: point.x, y: point.y, z: point.z };
      break;
    }
    if (cells.length >= MAX_GAP_CELLS) {
      return { rejection: 'The doorway gap is larger than the bounded eight-block access repair limit.' };
    }
    cells.push(point);
  }
  if (cells.length === 0) {
    return { rejection: 'The selected doorway already has a supported exterior approach; no gap repair is needed.' };
  }
  if (!exteriorStance) {
    return { rejection: 'I cannot prove a supported exterior endpoint for this doorway repair.' };
  }

  const inward = { x: -outward.x, z: -outward.z };
  const lateral = { x: -outward.z, z: outward.x };
  const interiorStance = [0, -1, 1]
    .map(side => ({
      x: door.x + inward.x + (lateral.x * side),
      y: door.y,
      z: door.z + inward.z + (lateral.z * side),
    }))
    .find(candidate => (
      isSafeGameplaySupport(blockAt(bot, { ...candidate, y: candidate.y - 1 }))
      && clearBodyCell(blockAt(bot, candidate))
      && clearBodyCell(blockAt(bot, { ...candidate, y: candidate.y + 1 }))
    ));
  if (!interiorStance) {
    return { rejection: 'The selected doorway has no clear supported interior verification stance.' };
  }

  return {
    material,
    constraint: {
      kind: 'existing_access_surface',
      door,
      facing,
      dimension,
      cells,
      interiorStance,
      exteriorStance,
    },
  };
}

export function createAccessRepairWorkOrder(entry) {
  const repair = entry?.accessRepairConstraint;
  const cells = Array.isArray(repair?.cells) ? repair.cells : [];
  if (entry?.kind !== 'repair_access' || cells.length < 1 || cells.length > MAX_GAP_CELLS) {
    throw new TypeError('An access repair needs one bounded exact surface gap.');
  }
  const minX = Math.min(...cells.map(cell => cell.x));
  const minY = Math.min(...cells.map(cell => cell.y));
  const minZ = Math.min(...cells.map(cell => cell.z));
  const maxX = Math.max(...cells.map(cell => cell.x));
  const maxY = Math.max(...cells.map(cell => cell.y));
  const maxZ = Math.max(...cells.map(cell => cell.z));
  const blueprint = {
    id: `access_repair_${entry.target}`.slice(0, 64),
    version: 1,
    width: maxX - minX + 1,
    depth: maxZ - minZ + 1,
    height: maxY - minY + 1,
    // Preserve near-door-to-yard order so the first placement has the existing
    // porch as a real horizontal support and later cells extend that chain.
    cells: cells.map(cell => ({
      x: cell.x - minX,
      y: cell.y - minY,
      z: cell.z - minZ,
      material: entry.target,
      stage: 0,
      function: 'supported_surface',
    })),
  };
  return createWorkOrder({
    role: 'builder',
    kind: 'build',
    source: 'player',
    requester: entry.requester || 'player',
    target: { name: 'access_repair', x: minX, y: minY, z: minZ },
    quota: cells.length,
    blueprint,
  });
}
