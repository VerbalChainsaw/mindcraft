import Vec3 from 'vec3';

import { isCookableFood } from '../../utils/food-semantics.js';
import { executeCommand as executeAgentCommand } from '../commands/index.js';
import { sendSquadRadio } from '../mindserver_proxy.js';
import { isPreemption } from './action-result.js';
import {
  capabilityCommand,
  executeCapabilityAction,
} from './capability-catalogue.js';
import { buildPrerequisitePlan } from './prerequisite-planner.js';
import { RoleDirector } from './role-director.js';
import { JobStateStore } from './job-state-store.js';
import {
  advanceWorkOrder,
  createWorkOrder,
  normalizeWorkOrder,
  reconcileWorkOrder,
} from './work-order.js';
import {
  createBuilderStockpileOrder,
  nextBuilderStep,
} from './jobs/builder-plan.js';
import { bindStructureAccessoryMaterials } from './jobs/structure-material-binder.js';
import { canonicalMiningTarget, miningKnowledge, nextMinerStep } from './jobs/miner-plan.js';
import { canonicalLogFamily, nextLumberjackStep } from './jobs/lumberjack-plan.js';
import {
  isProtectedGameplayBlock,
  isReplaceableGameplayBlock,
  isSafeGameplaySupport,
} from './gameplay-safety.js';
import {
  isClearableWorksiteBlock,
  probeSafeNavigationStances,
} from '../library/skills.js';
import {
  blockCanSupportPlacement,
  blockMatchesPlacement,
} from './block-placement-contract.js';

const JOB_ROLES = new Set(['builder', 'miner', 'lumberjack']);
const TERMINAL_PHASES = new Set(['complete', 'failed', 'cancelled']);
const PLAYER_JOB_SOURCES = new Set(['player', 'restart']);
const JOB_RETRY_MS = 1_000;
const JOB_SUCCESS_MS = 100;
const JOB_PREEMPTION_MS = 0;
const SURVIVAL_BUILDING_MATERIALS = new Set(['cobblestone', 'stone', 'dirt']);
const ACQUISITION_METHOD_FAILURE = /(?:resource_not_found|not_collected|unreachable|target_unloaded|path_(?:stalled|timeout)|no_path)/;
// How far a preemption may drag the bot before resuming means walking back
// first. A fight can pull it a long way from its own worksite, and resuming
// from wherever the chase ended is how a bot loses the thread of its work.
const WORKSITE_RETURN_DISTANCE = 16;
const BUILDER_EXECUTION_RETURN_DISTANCE = 4;
const BUILDER_SURFACE_RETURN_DEPTH = 2;
// After a manual command, hold off resuming autonomous job work briefly so the
// two do not fight over the body. Two minutes was long enough that a paused
// miner looked broken -- the player gave one order and the bot then stood inert
// for the rest of the window. A short grace still separates the two without
// making the bot look dead.
const MANUAL_COMMAND_GRACE_MS = 15_000;
const TOOL_TIER = Object.freeze({
  wooden: 1,
  golden: 2,
  stone: 3,
  copper: 3.5,
  iron: 4,
  diamond: 5,
  netherite: 6,
});
const UNSAFE_FOOD_ITEMS = new Set([
  'chicken',
  'poisonous_potato',
  'pufferfish',
  'rotten_flesh',
  'spider_eye',
  'suspicious_stew',
]);
function dimensionName(value) {
  const name = String(value || '').toLowerCase();
  if (name.endsWith('overworld')) return 'overworld';
  if (name.endsWith('the_nether') || name.endsWith('nether')) return 'nether';
  if (name.endsWith('the_end') || name.endsWith('end')) return 'end';
  return name;
}

function failedAcquisitionMethod(step, result) {
  const method = String(step?.methodKey || '');
  if (!/^(?:collect|harvest):/.test(method)) return null;
  if (result?.retryable !== true || !ACQUISITION_METHOD_FAILURE.test(String(result?.code || ''))) return null;
  return method;
}

function inventoryCounts(bot) {
  const counts = {};
  for (const item of bot.inventory?.items?.() || []) {
    if (!item?.name) continue;
    counts[item.name] = (counts[item.name] || 0) + Math.max(0, Number(item.count) || 0);
  }
  return counts;
}

function isSurvivalBuildingMaterial(name) {
  return SURVIVAL_BUILDING_MATERIALS.has(name) || String(name || '').endsWith('_planks');
}

function selectedBuilderMaterial(inventory) {
  return Object.keys(inventory || {}).find(name => (
    isSurvivalBuildingMaterial(name) && Number(inventory[name]) > 0
  )) || 'cobblestone';
}

function bindEmergencyShelterMaterial(order, bot) {
  if (
    order?.kind !== 'emergency_shelter'
    || !Array.isArray(order?.blueprint?.cells)
    || !order.blueprint.cells.some(cell => cell?.material === 'survival_building_block')
  ) return order;
  const material = selectedBuilderMaterial(inventoryCounts(bot));
  return {
    ...order,
    blueprint: {
      ...order.blueprint,
      cells: order.blueprint.cells.map(cell => (
        cell.material === 'survival_building_block'
          ? { ...cell, material }
          : cell
      )),
    },
  };
}

function itemHasWorkingDurability(bot, item) {
  const max = Number(
    item?.maxDurability
    ?? bot.registry?.items?.[item?.type]?.maxDurability
    ?? bot.registry?.itemsByName?.[item?.name]?.maxDurability,
  );
  if (!Number.isFinite(max) || max <= 0) return true;
  const remaining = Math.max(0, max - (Math.max(0, Number(item?.durabilityUsed) || 0)));
  return remaining > Math.max(16, Math.ceil(max * 0.1));
}

function bestToolTier(bot, items, family) {
  let tier = 0;
  for (const item of items) {
    if (!item?.name?.endsWith(`_${family}`) || !itemHasWorkingDurability(bot, item)) continue;
    tier = Math.max(tier, TOOL_TIER[item.name.split('_')[0]] || 0);
  }
  return tier;
}

function freeInventorySlots(bot) {
  if (typeof bot.inventory?.emptySlotCount === 'function') return bot.inventory.emptySlotCount();
  const slots = bot.inventory?.slots || [];
  return slots.slice(9, 45).filter(slot => !slot).length;
}

function totalFoodPoints(bot, inventory) {
  const foods = bot.registry?.foodsByName || {};
  return Object.entries(inventory).reduce(
    (total, [name, count]) => (
      UNSAFE_FOOD_ITEMS.has(name) || isCookableFood(bot.registry, name)
        ? total
        : total + ((foods[name]?.foodPoints || 0) * count)
    ),
    0,
  );
}

function nextJobUpkeepStep(order, snapshot) {
  const minimumFood = Number(order.constraints?.minFoodPoints ?? 12);
  const minimumHunger = Number(order.constraints?.minHunger ?? 16);
  if (
    Number(snapshot.foodPoints) < minimumFood
    && Number(snapshot.hunger) < minimumHunger
  ) {
    const target = Math.max(24, minimumFood);
    const range = Math.max(16, Math.min(128, Number(order.constraints?.maxDistance) || 64));
    return {
      command: `!prepareFood(${target}, ${range})`,
      nextPhase: order.phase,
      code: 'food_resupply_required',
      target: { name: 'safe_food' },
    };
  }
  return null;
}

/**
 * Walk back to where physical work is authorized before continuing it.
 * Preempted jobs return to their explicit anchor; Builder also returns after
 * remote prerequisite acquisition before it may execute blueprint cells.
 * `keepAnchor` stops the return step from overwriting the destination.
 */
export function nextWorksiteReturnStep(order, snapshot) {
  const builderExecution = order.role === 'builder'
    && order.kind !== 'stockpile'
    && ['execute', 'deliver', 'verify'].includes(order.phase);
  const preempted = order.evidence?.code === 'preempted';
  if (!builderExecution && !preempted) return null;
  const pendingCells = Array.isArray(snapshot.blueprintAudit?.missing)
    ? snapshot.blueprintAudit.missing
    : [];
  const pendingCell = builderExecution
    ? pendingCells.find(cell => cell.index === order.checkpoint?.nextCell) || pendingCells[0]
    : null;
  const anchor = builderExecution
    ? {
      x: Number.isFinite(pendingCell?.x) ? pendingCell.x : order.target?.x,
      y: order.target?.y,
      z: Number.isFinite(pendingCell?.z) ? pendingCell.z : order.target?.z,
    }
    : order.anchor;
  if (!anchor || ![anchor.x, anchor.y, anchor.z].every(Number.isFinite)) return null;
  if (![snapshot.x, snapshot.y, snapshot.z].every(Number.isFinite)) return null;
  const surfaceAccessRequired = order.checkpoint?.accessRequirement?.kind === 'surface';
  const surfaceAccessSatisfied = order.evidence?.code === 'skill_surface_reached';
  if (builderExecution && surfaceAccessSatisfied && surfaceAccessRequired) {
    return {
      phase: order.phase,
      checkpoint: { ...order.checkpoint, accessRequirement: null },
      code: 'worksite_surface_access_satisfied',
      keepAnchor: true,
    };
  }
  if (
    builderExecution
    && (
      surfaceAccessRequired
      || Number(order.target?.y) - snapshot.y > BUILDER_SURFACE_RETURN_DEPTH
    )
  ) {
    return {
      capability: { id: 'reach_surface', arguments: {} },
      nextPhase: order.phase,
      code: 'worksite_surface_access_required',
      keepAnchor: true,
      target: { name: 'surface_access' },
      checkpoint: {
        ...order.checkpoint,
        accessRequirement: { kind: 'surface' },
      },
    };
  }
  const distance = builderExecution
    ? Math.hypot(snapshot.x - anchor.x, snapshot.z - anchor.z)
    : Math.hypot(snapshot.x - anchor.x, snapshot.y - anchor.y, snapshot.z - anchor.z);
  const returnDistance = builderExecution
    ? BUILDER_EXECUTION_RETURN_DISTANCE
    : WORKSITE_RETURN_DISTANCE;
  if (distance <= returnDistance) return null;
  return {
    command: `!goToCoordinates(${anchor.x}, ${anchor.y}, ${anchor.z}, 2)`,
    nextPhase: order.phase,
    code: 'worksite_return_required',
    keepAnchor: true,
    target: { name: 'worksite', x: anchor.x, y: anchor.y, z: anchor.z },
  };
}

function blockAt(bot, x, y, z) {
  try {
    return bot.blockAt(new Vec3(Math.floor(x), Math.floor(y), Math.floor(z)));
  } catch {
    return null;
  }
}

function blockIsSolid(block) {
  return Boolean(block && block.boundingBox === 'block' && !['water', 'lava'].includes(block.name));
}

function selectedResourceSafety(bot, order) {
  if (typeof bot.findBlocks !== 'function' || typeof bot.blockAt !== 'function') return undefined;
  const requested = order.target?.name;
  const natural = order.role === 'miner' ? canonicalMiningTarget(requested) : requested;
  let positions;
  try {
    positions = bot.findBlocks({
      matching: block => {
        if (!block?.name) return false;
        if (order.role === 'lumberjack') {
          return requested === 'logs'
            ? canonicalLogFamily(block.name) !== null
            : block.name === requested;
        }
        return block.name === natural
          || (natural === 'stone' && ['stone', 'deepslate', 'tuff'].includes(block.name));
      },
      maxDistance: order.constraints?.maxDistance || 64,
      count: 12,
    });
  } catch {
    return undefined;
  }
  if (!Array.isArray(positions) || positions.length === 0) return undefined;
  const falling = /(?:sand|gravel|concrete_powder|anvil)$/;
  return positions.some(position => {
    const target = bot.blockAt(position);
    if (!target || isProtectedGameplayBlock(target)) return false;
    const above = bot.blockAt(position.offset?.(0, 1, 0) || new Vec3(position.x, position.y + 1, position.z));
    if (above?.name && falling.test(above.name)) return false;
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const adjacent = bot.blockAt(position.offset?.(dx, dy, dz) || new Vec3(position.x + dx, position.y + dy, position.z + dz));
      if (['water', 'lava'].includes(adjacent?.name)) return false;
    }
    return true;
  });
}

function selectedResourcePresence(bot, order) {
  if (typeof bot.findBlocks !== 'function' || !order?.target?.name) return undefined;
  const requested = order.target.name;
  const natural = order.role === 'miner' ? canonicalMiningTarget(requested) : requested;
  try {
    const positions = bot.findBlocks({
      matching: block => {
        if (!block?.name) return false;
        if (order.role === 'lumberjack') {
          return requested === 'logs'
            ? canonicalLogFamily(block.name) !== null
            : block.name === requested;
        }
        return block.name === natural
          || (natural === 'stone' && ['stone', 'deepslate', 'tuff'].includes(block.name));
      },
      maxDistance: order.constraints?.maxDistance || 64,
      count: 1,
    });
    return Array.isArray(positions) && positions.length > 0;
  } catch {
    return undefined;
  }
}

function replantSituation(agent, order, inventory) {
  if (order.role !== 'lumberjack') return undefined;
  const target = agent.last_action_result?.evidence?.skill?.target;
  if (![target?.x, target?.y, target?.z].every(Number.isFinite)) return { enabled: false };
  const family = canonicalLogFamily(target?.name) || canonicalLogFamily(order.target?.name);
  if (!family || ['crimson', 'warped'].includes(family)) return { enabled: false };
  const sapling = `${family}_sapling`;
  if (!inventory[sapling]) return { enabled: false };
  const bot = agent.bot;
  const x = Math.floor(target.x);
  const y = Math.floor(target.y);
  const z = Math.floor(target.z);
  const destination = blockAt(bot, x, y, z);
  const head = blockAt(bot, x, y + 1, z);
  const soil = blockAt(bot, x, y - 1, z);
  const distance = bot.entity?.position?.distanceTo?.(new Vec3(x, y, z)) ?? Infinity;
  return {
    enabled: true,
    sapling,
    soil: ['dirt', 'grass_block', 'podzol', 'coarse_dirt'].includes(soil?.name),
    clearance: isReplaceableGameplayBlock(destination) && isReplaceableGameplayBlock(head),
    reachable: distance <= 16,
    x,
    y,
    z,
  };
}

function entityOccupies(bot, x, y, z) {
  return Object.values(bot.entities || {}).some(entity => {
    if (entity?.id === bot.entity?.id) return false;
    // Dropped stacks and experience orbs do not reserve block space in
    // Minecraft. Treating them like players or mobs makes a builder wait on
    // the very drop produced by safely clearing its authorized footprint.
    if (entity?.name === 'item' || entity?.name === 'experience_orb') return false;
    const position = entity?.position;
    return position
      && Math.floor(position.x) === x
      && Math.floor(position.y) === y
      && Math.floor(position.z) === z;
  });
}

/**
 * Candidate standing cells immediately outside a construction footprint.
 * Policy owns which cells are safe; native Pathfinder owns whether ordinary
 * locomotion can reach any of them. Including one-block descents and ascents
 * avoids treating a platform edge as a prison merely because its surrounding
 * terrain is not at the exact same elevation.
 */
export function blueprintEscapeStances(bot, order) {
  const anchor = order?.target;
  const blueprint = order?.blueprint;
  const originY = Math.floor(bot?.entity?.position?.y ?? Infinity);
  if (
    ![anchor?.x, anchor?.y, anchor?.z, originY].every(Number.isFinite)
    || !Number.isInteger(blueprint?.width)
    || !Number.isInteger(blueprint?.depth)
  ) return [];

  const minX = Math.floor(anchor.x);
  const maxX = minX + blueprint.width - 1;
  const minZ = Math.floor(anchor.z);
  const maxZ = minZ + blueprint.depth - 1;
  const perimeter = [];
  for (let x = minX; x <= maxX; x += 1) {
    perimeter.push([x, minZ - 1], [x, maxZ + 1]);
  }
  for (let z = minZ; z <= maxZ; z += 1) {
    perimeter.push([minX - 1, z], [maxX + 1, z]);
  }

  const stances = [];
  const seen = new Set();
  for (const [x, z] of perimeter) {
    for (const y of [originY, originY - 1, originY + 1]) {
      const key = `${x}:${y}:${z}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const feet = blockAt(bot, x, y, z);
      const head = blockAt(bot, x, y + 1, z);
      const support = blockAt(bot, x, y - 1, z);
      if (!isReplaceableGameplayBlock(feet) || !isReplaceableGameplayBlock(head)) continue;
      if (!isSafeGameplaySupport(support)) continue;
      stances.push(new Vec3(x, y, z));
    }
  }
  return stances;
}

function auditBlueprint(bot, order, inventory) {
  if (!order.blueprint || !order.target) return { valid: false, code: 'not_audited', missing: [], incorrect: [] };
  const anchor = order.target;
  const blueprintPositions = new Map(order.blueprint.cells.map(cell => [`${cell.x}:${cell.y}:${cell.z}`, cell]));
  const fixturesById = new Map((order.blueprint.fixtures || []).map(fixture => [fixture.id, fixture]));
  const missing = [];
  const incorrect = [];
  let correct = 0;
  const materialFor = cell => cell.material === 'survival_building_block'
    ? Object.keys(inventory).find(name => (
      (name.endsWith('_planks') || ['cobblestone', 'stone', 'dirt'].includes(name))
      && inventory[name] > 0
    )) || 'cobblestone'
    : cell.material;
  for (const fixture of fixturesById.values()) {
    for (const offset of fixture.occupiedOffsets || []) {
      if (offset.x === 0 && offset.y === 0 && offset.z === 0) continue;
      const x = anchor.x + fixture.anchor.x + offset.x;
      const y = anchor.y + fixture.anchor.y + offset.y;
      const z = anchor.z + fixture.anchor.z + offset.z;
      const current = blockAt(bot, x, y, z);
      if (!current) return { valid: false, code: 'unloaded', missing: [], incorrect: [] };
      if (blockMatchesPlacement(bot.registry, fixture.material, current)) continue;
      if (['water', 'lava'].includes(current.name)) {
        return { valid: false, code: 'liquid', missing: [], incorrect: [] };
      }
      if (isProtectedGameplayBlock(current)) {
        return { valid: false, code: 'protected', missing: [], incorrect: [] };
      }
      if (entityOccupies(bot, x, y, z)) {
        return { valid: false, code: 'occupied', missing: [], incorrect: [] };
      }
      if (!isReplaceableGameplayBlock(current)) {
        incorrect.push({
          x,
          y,
          z,
          expected: fixture.material,
          observed: current.name,
          index: -1,
          clearable: isClearableWorksiteBlock(bot, current),
        });
      }
    }
  }
  for (let index = 0; index < order.blueprint.cells.length; index += 1) {
    const cell = order.blueprint.cells[index];
    const x = anchor.x + cell.x;
    const y = anchor.y + cell.y;
    const z = anchor.z + cell.z;
    const expected = materialFor(cell);
    const fixture = cell.fixtureId ? fixturesById.get(cell.fixtureId) : null;
    const current = blockAt(bot, x, y, z);
    if (!current) return { valid: false, code: 'unloaded', missing: [], incorrect: [] };
    if (blockMatchesPlacement(bot.registry, expected, current)) {
      if (fixture) {
        const fixtureValid = fixture.occupiedOffsets.every(offset => {
          const part = blockAt(bot, x + offset.x, y + offset.y, z + offset.z);
          if (!blockMatchesPlacement(bot.registry, fixture.material, part)) return false;
          const properties = part.getProperties?.() || {};
          const observedPart = fixture.kind === 'door' ? properties.half : properties.part;
          return observedPart === offset.part && properties.facing === fixture.facing;
        });
        if (!fixtureValid) {
          return { valid: false, code: 'fixture_state_invalid', missing: [], incorrect: [] };
        }
      }
      correct += 1;
      continue;
    }
    if (['water', 'lava'].includes(current.name)) {
      return { valid: false, code: 'liquid', missing: [], incorrect: [] };
    }
    if (isProtectedGameplayBlock(current)) {
      return { valid: false, code: 'protected', missing: [], incorrect: [] };
    }
    if (entityOccupies(bot, x, y, z)) {
      return { valid: false, code: 'occupied', missing: [], incorrect: [] };
    }
    if (!isReplaceableGameplayBlock(current)) {
      // Something solid is standing where a cell goes. Whether the build can
      // continue depends entirely on what it is. Only safe natural terrain
      // may be cleared; protected, hazardous, structural, liquid-adjacent, and
      // falling-block sites remain untouched. This is the same predicate
      // traversal digging uses, so "may I break this" has one answer across
      // the whole runtime.
      incorrect.push({
        x,
        y,
        z,
        expected,
        observed: current.name,
        index,
        clearable: isClearableWorksiteBlock(bot, current),
      });
      continue;
    }
    const relativeBelow = `${cell.x}:${cell.y - 1}:${cell.z}`;
    const plannedCellCanSupport = key => {
      const support = blueprintPositions.get(key);
      if (!support) return false;
      return blockCanSupportPlacement(bot.registry, materialFor(support));
    };
    const supported = blockIsSolid(blockAt(bot, x, y - 1, z))
      || [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 0, 1],
        [0, 0, -1],
      ].some(([dx, dy, dz]) => blockIsSolid(blockAt(bot, x + dx, y + dy, z + dz)));
    const plannedSupport = (
      (cell.y > 0 && plannedCellCanSupport(relativeBelow))
      || [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 0, 1],
        [0, 0, -1],
      ].some(([dx, dy, dz]) => plannedCellCanSupport(`${cell.x + dx}:${cell.y + dy}:${cell.z + dz}`))
    );
    if (!supported && !plannedSupport) {
      return { valid: false, code: 'unsupported', missing: [], incorrect: [] };
    }
    missing.push({
      x,
      y,
      z,
      material: expected,
      index,
      supported,
      stage: cell.stage,
      function: cell.function || null,
      ...(fixture ? { fixture } : {}),
    });
  }
  const botX = Math.floor(bot.entity?.position?.x ?? Infinity);
  const botY = Math.floor(bot.entity?.position?.y ?? Infinity);
  const botZ = Math.floor(bot.entity?.position?.z ?? Infinity);
  const insideFootprint = (
    botX >= anchor.x
    && botX < anchor.x + order.blueprint.width
    && botZ >= anchor.z
    && botZ < anchor.z + order.blueprint.depth
    && botY >= anchor.y
    && botY < anchor.y + order.blueprint.height
  );
  if (order.kind === 'emergency_shelter') {
    for (const yOffset of [0, 1]) {
      const door = blockAt(bot, anchor.x, anchor.y + yOffset, anchor.z - 1);
      if (!door || !isReplaceableGameplayBlock(door)) {
        return { valid: false, code: 'trapped_exit', missing: [], incorrect: [] };
      }
    }
  } else if (insideFootprint) {
    const escape = probeSafeNavigationStances(bot, blueprintEscapeStances(bot, order), 500);
    if (!escape.reachable) {
      return {
        valid: false,
        code: 'trapped_exit',
        missing: [],
        incorrect: [],
        routeStatus: escape.status,
      };
    }
  }
  if (missing.length > 0 && correct === 0 && !missing.some(cell => cell.supported === true)) {
    return { valid: false, code: 'no_support_anchor', missing: [], incorrect: [] };
  }
  return {
    valid: true,
    missing,
    incorrect,
    correct,
  };
}

export function summarizeJobSituation(agent, order) {
  const bot = agent.bot;
  const items = bot.inventory?.items?.() || [];
  const inventory = inventoryCounts(bot);
  const depositMode = agent.runtime?.jobs?.deposit || 'inventory';
  const leader = agent.runtime?.assignment?.leader || '';
  const assignedDeposit = agent.runtime?.assignment?.deposit || null;
  const snapshot = {
    inventory,
    tools: {
      pickaxeTier: bestToolTier(bot, items, 'pickaxe'),
      axeTier: bestToolTier(bot, items, 'axe'),
      shovelTier: bestToolTier(bot, items, 'shovel'),
      hoeTier: bestToolTier(bot, items, 'hoe'),
      swordTier: bestToolTier(bot, items, 'sword'),
    },
    foodPoints: totalFoodPoints(bot, inventory),
    hunger: Number(bot.food),
    lightCount: (inventory.torch || 0) + (inventory.soul_torch || 0),
    freeSlots: freeInventorySlots(bot),
    escapeRoute: Boolean(
      bot.entity?.position
      && blockIsSolid(blockAt(bot, bot.entity.position.x, bot.entity.position.y - 1, bot.entity.position.z)),
    ),
    deposit: { mode: depositMode, leader, target: assignedDeposit },
    dimension: dimensionName(bot.game?.dimension),
    x: Number(bot.entity?.position?.x),
    y: Number(bot.entity?.position?.y),
    z: Number(bot.entity?.position?.z),
  };
  // Both helpers sweep a radius-64 volume, and the safety sample adds up to
  // twelve eight-way blockAt probes on top. Only miner-plan reads
  // `resourceFound`, and only miner/lumberjack read the safety sample, so every
  // other role was paying for two full scans and discarding both results.
  const role = order?.role;
  if (role === 'miner') {
    const resourceFound = selectedResourcePresence(bot, order);
    if (resourceFound !== undefined) snapshot.resourceFound = resourceFound;
    snapshot.miningKnowledge = miningKnowledge(order.target?.name);
  }
  if (role === 'miner' || role === 'lumberjack') {
    const resourceSafety = selectedResourceSafety(bot, order);
    if (resourceSafety !== undefined) {
      if (role === 'miner') snapshot.safeSelectedBlocks = resourceSafety;
      else snapshot.safeTrunks = resourceSafety;
    }
  }
  const replant = replantSituation(agent, order, inventory);
  if (replant) snapshot.replant = replant;
  if (order?.role === 'builder') {
    snapshot.blueprintAudit = auditBlueprint(bot, order, inventory);
    snapshot.selectedMaterial = selectedBuilderMaterial(inventory);
  }
  return snapshot;
}

export function constructionTaskOrder(agent, completedOrderIds = new Set()) {
  if (agent.runtime?.role !== 'builder' || agent.task?.task_type !== 'construction') return null;
  const levels = agent.task?.blueprint?.data?.levels;
  if (!Array.isArray(levels) || levels.length === 0) return null;
  const orderId = `task-${String(agent.task?.data?.task_id || 'construction')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .slice(0, 80)}`;
  if (completedOrderIds.has(orderId)) return null;
  const populated = [];
  for (const level of levels) {
    const [startX, startY, startZ] = level?.coordinates || [];
    if (![startX, startY, startZ].every(Number.isFinite) || !Array.isArray(level?.placement)) return null;
    for (let z = 0; z < level.placement.length; z += 1) {
      const row = level.placement[z];
      if (!Array.isArray(row)) return null;
      for (let x = 0; x < row.length; x += 1) {
        const material = row[x];
        if (material && material !== 'air') {
          populated.push({
            worldX: Math.floor(startX + x),
            worldY: Math.floor(startY),
            worldZ: Math.floor(startZ + z),
            material,
          });
        }
      }
    }
  }
  if (populated.length === 0) return null;
  const minX = Math.min(...populated.map(cell => cell.worldX));
  const minY = Math.min(...populated.map(cell => cell.worldY));
  const minZ = Math.min(...populated.map(cell => cell.worldZ));
  const maxX = Math.max(...populated.map(cell => cell.worldX));
  const maxY = Math.max(...populated.map(cell => cell.worldY));
  const maxZ = Math.max(...populated.map(cell => cell.worldZ));
  return createWorkOrder({
    id: orderId,
    role: 'builder',
    kind: 'build',
    source: 'player',
    requester: 'task',
    target: { name: 'worksite', x: minX, y: minY, z: minZ },
    quota: populated.length,
    blueprint: {
      id: orderId.replace(/^task-/, '').slice(0, 64) || 'construction',
      width: maxX - minX + 1,
      depth: maxZ - minZ + 1,
      height: maxY - minY + 1,
      cells: populated.map(cell => ({
        x: cell.worldX - minX,
        y: cell.worldY - minY,
        z: cell.worldZ - minZ,
        material: cell.material,
      })),
    },
  });
}

function inventoryFamilyCount(inventory, predicate) {
  return Object.entries(inventory).reduce(
    (total, [name, amount]) => predicate(name)
      ? total + Math.max(0, Number(amount) || 0)
      : total,
    0,
  );
}

function defaultOrderFor(agent, completedOrderIds) {
  const role = agent.runtime?.role;
  const limit = Math.max(16, Math.min(2304, Number(agent.runtime?.jobs?.stockpileLimit) || 128));
  const taskOrder = constructionTaskOrder(agent, completedOrderIds);
  if (taskOrder) return taskOrder;
  const inventory = inventoryCounts(agent.bot);
  if (role === 'builder') {
    const materialTarget = Math.max(8, Math.ceil(limit / 2));
    const carriedPlanks = inventoryFamilyCount(
      inventory,
      name => name.endsWith('_planks'),
    );
    if (carriedPlanks < materialTarget) {
      return createBuilderStockpileOrder({ quota: materialTarget, material: 'planks' });
    }
    if (Math.max(0, Number(inventory.cobblestone) || 0) < materialTarget) {
      return createBuilderStockpileOrder({ quota: materialTarget, material: 'cobblestone' });
    }
    return null;
  }
  if (role === 'miner') {
    if (Math.max(0, Number(inventory.cobblestone) || 0) >= limit) return null;
    return createWorkOrder({
      role: 'miner',
      kind: 'mine',
      source: 'role',
      target: { name: 'cobblestone' },
      quota: limit,
    });
  }
  if (role === 'lumberjack') {
    const carriedLogs = inventoryFamilyCount(
      inventory,
      name => canonicalLogFamily(name) !== null,
    );
    if (carriedLogs >= limit) return null;
    return createWorkOrder({
      role: 'lumberjack',
      kind: 'harvest',
      source: 'role',
      target: { name: 'logs' },
      quota: limit,
    });
  }
  return null;
}

function reducerFor(order) {
  if (order.role === 'builder') return nextBuilderStep;
  if (order.role === 'miner') return nextMinerStep;
  if (order.role === 'lumberjack') return nextLumberjackStep;
  return null;
}

function immutableOrderPayload(order) {
  return JSON.stringify({
    id: order.id,
    role: order.role,
    kind: order.kind,
    source: order.source,
    requester: order.requester,
    target: order.target,
    constraints: order.constraints,
    quota: order.quota,
    blueprint: order.blueprint,
    maxAttempts: order.maxAttempts,
  });
}

function terminalReceiptFor(agent, order, code, finishedAt) {
  const fixtures = (order?.blueprint?.fixtures || []).map(fixture => ({
    id: fixture.id,
    function: fixture.function,
    material: fixture.material,
    facing: fixture.facing,
    position: {
      x: order.target.x + fixture.anchor.x,
      y: order.target.y + fixture.anchor.y,
      z: order.target.z + fixture.anchor.z,
    },
  }));
  const functions = new Set((order?.blueprint?.cells || []).map(cell => cell.function));
  return {
    orderId: order.id,
    phase: order.phase,
    code,
    dimension: dimensionName(agent.bot?.game?.dimension),
    order,
    structure: order.role === 'builder' && order.kind === 'build'
      ? {
          habitable: functions.has('enclosure')
            && functions.has('weather_cover')
            && fixtures.some(fixture => fixture.function === 'access')
            && fixtures.some(fixture => fixture.function === 'rest'),
          fixtures,
        }
      : null,
    finishedAt,
  };
}

export class JobDirector extends RoleDirector {
  constructor(agent, {
    executeCommand = executeAgentCommand,
    getSnapshot = summarizeJobSituation,
    store = null,
    now = Date.now,
  } = {}) {
    super(agent);
    this.executeJobCommand = executeCommand;
    this.getJobSnapshot = getSnapshot;
    this.now = now;
    this.store = store || new JobStateStore(agent.name);
    this.activeOrder = null;
    this.lastOrder = null;
    this.lastReceipt = null;
    this.completedOrderIds = new Set();
    this.dispatchGeneration = 0;
    this.activeDispatch = null;
    try {
      const persisted = this.store.load();
      this.lastReceipt = this.store.terminalReceipt || null;
      this.lastOrder = this.lastReceipt?.order || null;
      if (this.store.lastError) {
        this.setStatus('failed', 'job_state_load_failed', null, this.store.lastError, false);
      } else if (persisted && !TERMINAL_PHASES.has(persisted.phase)) {
        const automaticSuppressed = (
          this.agent.runtime?.autonomy === 'command'
          && persisted.source === 'role'
        );
        if (automaticSuppressed) {
          this.store.save(null);
        } else {
          const boundOrder = bindEmergencyShelterMaterial(persisted, this.agent.bot);
          this.activeOrder = reconcileWorkOrder(
            boundOrder,
            this.getJobSnapshot(this.agent, boundOrder),
            this.now(),
          );
          this.store.save(this.activeOrder);
        }
      }
    } catch (error) {
      this.setStatus('failed', 'job_state_load_failed', null, error?.message || error, true);
    }
  }

  snapshot() {
    const order = this.activeOrder || this.lastOrder;
    return {
      ...this.status,
      nextAttemptAt: this.nextAttemptAt,
      workOrder: order ? {
        id: order.id,
        role: order.role,
        kind: order.kind,
        source: order.source,
        requester: order.requester,
        phase: order.phase,
        target: order.target,
        attempts: order.attempts,
        maxAttempts: order.maxAttempts,
        checkpoint: order.checkpoint,
        evidence: order.evidence,
      } : null,
    };
  }

  submit(raw) {
    try {
      const order = normalizeWorkOrder(bindEmergencyShelterMaterial(raw, this.agent.bot));
      if (TERMINAL_PHASES.has(order.phase)) return { accepted: false, code: 'job_already_terminal' };
      if (this.activeOrder && !TERMINAL_PHASES.has(this.activeOrder.phase)) {
        if (this.activeOrder.id !== order.id) {
          return { accepted: false, code: 'job_busy', id: this.activeOrder.id };
        }
        if (immutableOrderPayload(this.activeOrder) !== immutableOrderPayload(order)) {
          return { accepted: false, code: 'order_id_conflict', id: order.id };
        }
        this.nextAttemptAt = 0;
        this.setStatus(
          'waiting',
          'already_active',
          this.activeOrder.target?.name || null,
          `Work order ${order.id} is already active; continuing from verified Minecraft state.`,
          true,
        );
        this.agent.behavior_arbiter?.wake?.('job_resubmitted');
        return { accepted: true, code: 'already_active', id: order.id };
      }
      this.activeOrder = order;
      this.lastOrder = null;
      this.store.save(order);
      this.nextAttemptAt = 0;
      this.setStatus('waiting', 'job_accepted', order.target?.name || null, `Accepted work order ${order.id}.`, true);
      return { accepted: true, id: order.id };
    } catch (error) {
      return { accepted: false, code: 'invalid_work_order', detail: String(error?.message || error).slice(0, 180) };
    }
  }

  requestWorkOrder(request = {}) {
    if (request.kind !== 'emergency_shelter') return this.submit(request);
    const position = this.agent.bot?.entity?.position;
    if (!position) return { accepted: false, code: 'spawn_state_unavailable' };
    if (this.agent.goal_director?.activeGoal) {
      return {
        accepted: false,
        code: 'player_goal_active',
        id: this.agent.goal_director.activeGoal.id,
      };
    }
    if (this.agent.agenda_director?.hasUnfinished?.()) {
      return {
        accepted: false,
        code: 'player_agenda_active',
      };
    }
    if (
      this.lastOrder?.phase === 'failed'
      && PLAYER_JOB_SOURCES.has(this.lastOrder.source)
    ) {
      return {
        accepted: false,
        code: 'player_job_failed_awaiting_direction',
        id: this.lastOrder.id,
      };
    }
    if (this.activeOrder && !TERMINAL_PHASES.has(this.activeOrder.phase)) {
      if (this.activeOrder.source !== 'role') {
        return { accepted: false, code: 'explicit_job_active', id: this.activeOrder.id };
      }
      this.finishOrder(
        'cancelled',
        'preempted_by_survival',
        'Automatic role work yielded to an emergency shelter order.',
        true,
      );
    }
    return this.submit(createWorkOrder({
      role: 'builder',
      kind: 'emergency_shelter',
      source: 'survival',
      requester: this.agent.name,
      target: {
        name: 'worksite',
        x: Math.floor(position.x),
        y: Math.floor(position.y),
        z: Math.floor(position.z),
      },
      quota: request.blueprint?.cells?.length || 1,
      blueprint: request.blueprint,
      constraints: request.constraints,
    }));
  }

  cancel(reason = 'cancelled') {
    if (!this.activeOrder) return false;
    const cancelled = normalizeWorkOrder({
      ...this.activeOrder,
      phase: 'cancelled',
      evidence: { code: 'cancelled', detail: reason, actionId: '' },
      updatedAt: this.now(),
    });
    this.lastOrder = cancelled;
    this.lastReceipt = terminalReceiptFor(this.agent, cancelled, 'job_cancelled', this.now());
    this.activeOrder = null;
    this.invalidateDispatch();
    this.store.save(null, this.lastReceipt);
    this.setStatus('cancelled', 'job_cancelled', cancelled.target?.name || null, reason, false);
    this.beginTerminalHandoff(cancelled, 'job_cancelled');
    return true;
  }

  invalidateDispatch() {
    this.dispatchGeneration += 1;
    this.activeDispatch = null;
    this.inFlight = false;
  }

  acknowledgeTerminalReceipt(orderId) {
    if (!orderId || this.lastReceipt?.orderId !== orderId) return false;
    this.lastReceipt = null;
    this.store.save(this.activeOrder, null);
    return true;
  }

  ownsDispatch(token) {
    return Boolean(
      token
      && this.activeDispatch === token
      && token.generation === this.dispatchGeneration
    );
  }

  canSettleDispatch(token) {
    return this.ownsDispatch(token) && this.activeOrder?.id === token.orderId;
  }

  retainCancelledTransfer(orderAtDispatch, step, outcome, result) {
    const transferCheckpoint = step?.checkpointOnVerifiedTransfer;
    const transferred = Math.max(0, Math.floor(Number(outcome?.verification?.transferred) || 0));
    if (
      transferred < 1
      || !transferCheckpoint?.field
      || this.lastOrder?.id !== orderAtDispatch?.id
      || this.lastOrder.phase !== 'cancelled'
    ) return false;
    const maximum = Math.max(0, Number(transferCheckpoint.maximum) || 0);
    const verifiedValue = Math.min(
      maximum,
      Math.max(0, Number(transferCheckpoint.baseline) || 0) + transferred,
    );
    const retainedValue = Math.max(
      Math.max(0, Number(this.lastOrder.checkpoint?.[transferCheckpoint.field]) || 0),
      verifiedValue,
    );
    this.lastOrder = normalizeWorkOrder({
      ...this.lastOrder,
      checkpoint: {
        ...this.lastOrder.checkpoint,
        [transferCheckpoint.field]: retainedValue,
      },
      evidence: {
        code: 'cancelled_after_verified_transfer',
        detail: `Cancellation remained terminal after ${transferred} transfer(s) were physically verified.`,
        actionId: result?.actionId || this.lastOrder.evidence?.actionId || '',
      },
      updatedAt: this.now(),
    });
    return true;
  }

  deferForManualCommand(reason = 'manual command') {
    this.nextAttemptAt = Math.max(this.nextAttemptAt, this.now() + MANUAL_COMMAND_GRACE_MS);
    this.setStatus('suppressed', 'manual_command', null, reason, true);
  }

  persist(order) {
    const previousPhase = this.activeOrder?.phase;
    this.activeOrder = normalizeWorkOrder(order);
    this.store.save(this.activeOrder);
    if (previousPhase && previousPhase !== this.activeOrder.phase) {
      this.agent.publishBehaviorEvent?.({
        type: 'job.changed',
        target: this.activeOrder.target,
        evidence: {
          workOrderId: this.activeOrder.id,
          code: this.activeOrder.evidence?.code || 'phase_changed',
          phase: this.activeOrder.phase,
        },
        salience: this.activeOrder.phase === 'recover' ? 3 : 1,
      });
    }
  }

  acceptStructureMaterialAlternative(order, result, { reassess = false } = {}) {
    if (order?.role !== 'builder' || order.kind === 'stockpile') return false;
    const harvestEvidence = result?.evidence?.skill;
    const alternativeOutput = harvestEvidence?.outcome === 'alternative_source_observed'
      ? harvestEvidence.alternativeOutput
      : null;
    if (!alternativeOutput) return false;
    const rebound = bindStructureAccessoryMaterials(order, this.agent.bot, { alternativeOutput });
    if (rebound === order) return false;
    const persisted = {
      ...rebound,
      ...(reassess ? { phase: 'assess', resumePhase: null } : {}),
      evidence: {
        code: 'material_alternative_bound',
        detail: `Bound the structure accessory to verified ${alternativeOutput}.`,
        actionId: result?.actionId || '',
      },
      updatedAt: this.now(),
    };
    this.persist(persisted);
    if (PLAYER_JOB_SOURCES.has(persisted.source)) {
      try {
        this.agent.home_state?.rememberStructure?.(this.activeOrder);
      } catch (error) {
        console.warn(`[builder-binding] Could not persist ${persisted.id}: ${String(error?.message || error).slice(0, 180)}`);
      }
    }
    return true;
  }

  beginTerminalHandoff(order, code) {
    if (!order || !PLAYER_JOB_SOURCES.has(order.source)) return null;
    return this.agent.behavior_arbiter?.beginTerminalHandoff?.({
      outcomeId: order.id,
      owner: 'player_job',
      phase: order.phase,
      code,
    }) || null;
  }

  finishOrder(phase, code, detail = '', retryable = false) {
    const terminal = normalizeWorkOrder({
      ...this.activeOrder,
      phase,
      evidence: { code, detail, actionId: this.activeOrder?.evidence?.actionId || '' },
      updatedAt: this.now(),
    });
    this.lastOrder = terminal;
    this.lastReceipt = terminalReceiptFor(this.agent, terminal, code, this.now());
    if (phase === 'complete') this.completedOrderIds.add(terminal.id);
    this.activeOrder = null;
    this.invalidateDispatch();
    this.store.save(null, this.lastReceipt);
    this.nextAttemptAt = this.now() + JOB_RETRY_MS;
    this.setStatus(phase, code, terminal.target?.name || null, detail || code, retryable);
    this.agent.publishBehaviorEvent?.({
      type: phase === 'complete' ? 'job.completed' : 'job.changed',
      target: terminal.target,
      evidence: {
        workOrderId: terminal.id,
        code,
        phase,
      },
      salience: phase === 'complete' ? 4 : 3,
    });
    this.beginTerminalHandoff(terminal, code);
    const radioKind = phase === 'complete' ? 'completion' : phase === 'failed' ? 'warning' : null;
    if (radioKind) {
      const message = phase === 'complete'
        ? `${terminal.role} work order ${terminal.id} completed.`
        : `${terminal.role} work order ${terminal.id} stopped: ${code}.`;
      void sendSquadRadio(message, radioKind).catch(error => {
        console.warn(`[job-radio] Could not relay ${terminal.id}: ${String(error?.message || error).slice(0, 180)}`);
      });
    }
  }

  update() {
    const role = this.agent.runtime?.role || 'companion';
    if (!JOB_ROLES.has(role) && !this.activeOrder) {
      super.update();
      return;
    }
    if (this.agent.isOperatorHeld?.()) {
      this.setStatus('suppressed', 'operator_hold', null, this.agent.operator_hold_reason || 'Operator Stop is active.', false);
      return;
    }
    const playerWorkActive = Boolean(
      this.agent.goal_director?.activeGoal
      || this.agent.agenda_director?.hasUnfinished?.()
    );
    if (
      playerWorkActive
      && this.activeOrder
      && ['role', 'survival'].includes(this.activeOrder.source)
    ) {
      this.cancel('Automatic work yielded to active player-authorized work.');
      return;
    }
    if (
      (
        this.agent.runtime?.jobs?.mode === 'off'
        && this.activeOrder?.source !== 'survival'
      )
      || (
        this.agent.runtime?.autonomy === 'command'
        && (!this.activeOrder || this.activeOrder.source === 'role')
      )
    ) {
      this.setStatus('suppressed', 'command_autonomy', null, 'Automatic job work is disabled for this profile.', false);
      return;
    }
    if (this.inFlight || !this.agent.isIdle() || !this.agent.self_prompter?.isStopped?.()) return;
    if (this.now() < this.nextAttemptAt) return;

    if (!this.activeOrder) {
      let automatic;
      try {
        automatic = defaultOrderFor(this.agent, this.completedOrderIds);
      } catch (error) {
        this.setStatus('failed', 'automatic_job_invalid', null, error?.message || error, false);
        this.nextAttemptAt = this.now() + JOB_RETRY_MS;
        return;
      }
      if (!automatic) return;
      const accepted = this.submit(automatic);
      if (!accepted.accepted) return;
    }

    let transitions = 0;
    let materialBindingSupersededResult = false;
    while (this.activeOrder && transitions < 6) {
      transitions += 1;
      if (this.activeOrder.role === 'builder' && this.activeOrder.kind !== 'stockpile') {
        if (this.acceptStructureMaterialAlternative(this.activeOrder, this.agent.last_action_result)) {
          materialBindingSupersededResult = true;
        }
      }
      const reducer = reducerFor(this.activeOrder);
      if (!reducer) {
        this.finishOrder('failed', 'unsupported_job_role', 'No job plan exists for this work order.', false);
        return;
      }
      let snapshot;
      let step;
      try {
        snapshot = this.getJobSnapshot(this.agent, this.activeOrder);
        const reducerResult = materialBindingSupersededResult
          ? null
          : this.agent.last_action_result;
        step = nextJobUpkeepStep(this.activeOrder, snapshot)
          || nextWorksiteReturnStep(this.activeOrder, snapshot)
          || reducer(this.activeOrder, snapshot, reducerResult, {
            planItem: ({
              target,
              quantity,
              completion,
              range,
              toolRequirement,
              workstationRequirement,
              accessRequirement,
              excludedMethods,
            }) => buildPrerequisitePlan(
              this.agent.bot,
              {
                target,
                quantity,
                completion,
                range: Number(range) || 64,
                experience: learningKey => this.agent.memory_bank?.outcomePreference?.(learningKey) || 0,
                toolRequirement,
                workstationRequirement,
                accessRequirement,
                excludedMethods,
                allowEntityAlternatives: this.activeOrder?.role === 'builder'
                  && this.activeOrder?.kind !== 'stockpile',
              },
            ),
          });
      } catch (error) {
        this.setStatus('failed', 'job_snapshot_failed', this.activeOrder.target?.name, error?.message || error, true);
        this.nextAttemptAt = this.now() + JOB_RETRY_MS;
        return;
      }
      if (step.complete) {
        if (step.checkpoint) {
          this.persist({
            ...this.activeOrder,
            checkpoint: {
              ...this.activeOrder.checkpoint,
              ...step.checkpoint,
            },
            updatedAt: this.now(),
          });
        }
        this.finishOrder('complete', step.code || 'job_complete', step.detail || 'Work order completed.', false);
        return;
      }
      if (step.terminal) {
        this.finishOrder('failed', step.code || 'job_failed', step.detail || 'Work order cannot continue safely.', step.retryable === true);
        return;
      }
      if (step.blocked) {
        this.setStatus('waiting', step.code || 'job_blocked', this.activeOrder.target?.name, step.detail || 'Waiting for a safe job prerequisite.', true);
        this.nextAttemptAt = this.now() + JOB_RETRY_MS;
        return;
      }
      if (step.phase && step.phase !== this.activeOrder.phase) {
        this.persist({
          ...this.activeOrder,
          phase: step.phase,
          resumePhase: null,
          evidence: { code: step.code || 'phase_advanced', detail: step.detail || '', actionId: '' },
          updatedAt: this.now(),
        });
      }
      if (step.checkpoint) {
        this.persist({ ...this.activeOrder, checkpoint: step.checkpoint, updatedAt: this.now() });
      }
      // Some planning edges change only durable job state. Commit those
      // declarative transitions before deciding whether the executor has any
      // physical work to own; otherwise the same satisfied precondition is
      // selected forever (for example, surface access after returning from a
      // mine).
      if (!step.command && !step.capability) continue;

      // Remember where this step is being worked from, so a preemption that
      // drags the bot away has somewhere to come back to.
      if (!step.keepAnchor && Number.isFinite(snapshot.x) && Number.isFinite(snapshot.z)) {
        this.persist({
          ...this.activeOrder,
          anchor: { x: snapshot.x, y: snapshot.y, z: snapshot.z },
          updatedAt: this.now(),
        });
      }
      const orderAtDispatch = this.activeOrder;
      const dispatchToken = Object.freeze({
        generation: this.dispatchGeneration + 1,
        orderId: orderAtDispatch.id,
      });
      this.dispatchGeneration = dispatchToken.generation;
      this.activeDispatch = dispatchToken;
      this.inFlight = true;
      const previousActionId = this.agent.last_action_result?.actionId || null;
      const selectedCommand = step.capability ? capabilityCommand(step.capability) : step.command;
      this.setStatus(
        'acting',
        `job_${orderAtDispatch.phase}`,
        step.target?.name || orderAtDispatch.target?.name,
        `Executing ${orderAtDispatch.role} ${orderAtDispatch.phase} phase.`,
        true,
      );
      const execution = step.capability
        ? executeCapabilityAction(step.capability, {
          agent: this.agent,
          executeCommand: this.executeJobCommand,
          owner: 'job',
          routeOrigin: 'job-director',
        })
        : Promise.resolve(this.executeJobCommand(this.agent, selectedCommand, { owner: 'job' }))
          .then(value => ({ value, verification: null, result: null }));
      void Promise.resolve(execution)
        .then(outcome => {
          let result = outcome?.result || this.agent.last_action_result;
          if (!result?.actionId || result.actionId === previousActionId) {
            result = {
              actionId: `missing-${this.now()}`,
              phase: 'failed',
              code: 'missing_action_result',
              detail: 'Job command returned without a new structured action result.',
              retryable: true,
            };
          }
          if (!this.canSettleDispatch(dispatchToken)) {
            this.retainCancelledTransfer(orderAtDispatch, step, outcome, result);
            return;
          }
          if (this.acceptStructureMaterialAlternative(orderAtDispatch, result, { reassess: true })) {
            this.setStatus(
              'waiting',
              'material_alternative_bound',
              step.target?.name || orderAtDispatch.target?.name,
              'A verified material-family alternative was bound; reassessing the same structure.',
              true,
            );
            this.nextAttemptAt = this.now();
            return;
          }
          const preempted = isPreemption(result);
          const transferred = Math.max(0, Math.floor(Number(outcome?.verification?.transferred) || 0));
          const transferCheckpoint = step.checkpointOnVerifiedTransfer;
          const verifiedOrder = transferCheckpoint && transferred > 0
            ? {
              ...orderAtDispatch,
              checkpoint: {
                ...orderAtDispatch.checkpoint,
                [transferCheckpoint.field]: Math.min(
                  Math.max(0, Number(transferCheckpoint.maximum) || 0),
                  Math.max(0, Number(transferCheckpoint.baseline) || 0) + transferred,
                ),
              },
            }
            : result.phase === 'succeeded' && step.checkpointOnSuccess
              ? {
                ...orderAtDispatch,
                checkpoint: {
                  ...orderAtDispatch.checkpoint,
                  ...step.checkpointOnSuccess,
                },
              }
              : orderAtDispatch;
          const advanced = advanceWorkOrder(verifiedOrder, result, {
            previousActionId,
            nextPhase: step.nextPhase,
            failedMethod: failedAcquisitionMethod(step, result),
            now: this.now(),
          });
          this.persist(advanced);
          if (advanced.phase === 'complete') {
            this.finishOrder(
              'complete',
              result?.code || step.code || 'job_complete',
              result?.detail || 'Verified delivery completed the work order.',
              false,
            );
            return;
          }
          if (advanced.phase === 'failed' || advanced.phase === 'cancelled') {
            this.finishOrder(
              advanced.phase,
              result?.code || 'job_attempts_exhausted',
              result?.detail || 'The work order exhausted its bounded recovery budget.',
              false,
            );
            return;
          }
          const succeeded = advanced.phase === step.nextPhase && result?.phase === 'succeeded';
          this.setStatus(
            succeeded ? 'succeeded' : advanced.phase === 'recover' ? 'recovering' : 'failed',
            result?.code || (succeeded ? 'job_phase_succeeded' : 'job_phase_failed'),
            step.target?.name || advanced.target?.name,
            result?.detail || (succeeded ? 'Verified job phase completed.' : 'Job phase did not verify.'),
            advanced.phase === 'recover',
          );
          this.nextAttemptAt = this.now() + (
            preempted
              ? JOB_PREEMPTION_MS
              : succeeded
                ? JOB_SUCCESS_MS
                : JOB_RETRY_MS
          );
        })
        .catch(error => {
          if (!this.canSettleDispatch(dispatchToken)) return;
          const failed = advanceWorkOrder(orderAtDispatch, {
            actionId: `dispatch-${this.now()}`,
            phase: 'failed',
            code: 'job_dispatch_error',
            detail: error?.message || error,
            retryable: true,
          }, {
            previousActionId,
            now: this.now(),
          });
          this.persist(failed);
          if (failed.phase === 'failed') {
            this.finishOrder(
              'failed',
              'job_dispatch_error',
              error?.message || error,
              false,
            );
            return;
          }
          this.setStatus('recovering', 'job_dispatch_error', failed.target?.name, error?.message || error, true);
          this.nextAttemptAt = this.now() + JOB_RETRY_MS;
        })
        .finally(() => {
          if (!this.ownsDispatch(dispatchToken)) return;
          this.activeDispatch = null;
          this.inFlight = false;
        });
      return;
    }
  }
}
