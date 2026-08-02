import { createWorkOrder } from '../work-order.js';
import { EMERGENCY_SHELTER_BLUEPRINT } from '../emergency-shelter.js';

const PLAYER_SHELTER_BLUEPRINT = Object.freeze({
  id: 'player_shelter_3x3',
  version: 1,
  width: EMERGENCY_SHELTER_BLUEPRINT.width,
  depth: EMERGENCY_SHELTER_BLUEPRINT.depth,
  height: EMERGENCY_SHELTER_BLUEPRINT.height,
  cells: Object.freeze(EMERGENCY_SHELTER_BLUEPRINT.cells.map(cell => Object.freeze({
    ...cell,
    x: cell.x + 1,
    z: cell.z + 1,
  }))),
});

function canonicalBuildingMaterial(value) {
  const material = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!/^[a-z0-9_]{1,64}$/.test(material)) {
    throw new TypeError('Building material must be a canonical block name.');
  }
  return material;
}

function boundedDimension(value, label, { minimum = 1, maximum = 16 } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new TypeError(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return number;
}

export function createConstructionBlueprint({
  shape,
  width,
  depth,
  height,
  material,
} = {}) {
  const normalizedShape = String(shape || '').trim().toLowerCase();
  if (!['platform', 'wall', 'room', 'bridge', 'column'].includes(normalizedShape)) {
    throw new TypeError('Construction shape must be platform, wall, room, bridge, or column.');
  }
  const block = canonicalBuildingMaterial(material);
  const resolvedWidth = normalizedShape === 'column'
    ? 1
    : boundedDimension(width, 'Construction width');
  const resolvedDepth = ['wall', 'bridge', 'column'].includes(normalizedShape)
    ? 1
    : boundedDimension(depth, 'Construction depth');
  const resolvedHeight = ['platform', 'bridge'].includes(normalizedShape)
    ? 1
    : boundedDimension(height, 'Construction height', { maximum: 4 });
  if (normalizedShape === 'room' && (
    resolvedWidth < 3
    || resolvedDepth < 3
    || resolvedHeight < 3
  )) throw new TypeError('A room must be at least 3x3x3.');

  const cells = [];
  const add = (x, y, z, stage, cellFunction) => {
    cells.push({ x, y, z, material: block, stage, function: cellFunction });
  };
  if (['platform', 'bridge'].includes(normalizedShape)) {
    for (let x = 0; x < resolvedWidth; x += 1) {
      for (let z = 0; z < resolvedDepth; z += 1) add(x, 0, z, 0, 'supported_surface');
    }
  } else if (normalizedShape === 'wall') {
    for (let y = 0; y < resolvedHeight; y += 1) {
      for (let x = 0; x < resolvedWidth; x += 1) add(x, y, 0, y, 'wall');
    }
  } else if (normalizedShape === 'column') {
    for (let y = 0; y < resolvedHeight; y += 1) add(0, y, 0, y, 'column');
  } else {
    const doorZ = Math.floor(resolvedDepth / 2);
    for (let x = 0; x < resolvedWidth; x += 1) {
      for (let z = 0; z < resolvedDepth; z += 1) add(x, 0, z, 0, 'foundation');
    }
    for (let y = 1; y < resolvedHeight - 1; y += 1) {
      for (let x = 0; x < resolvedWidth; x += 1) {
        for (let z = 0; z < resolvedDepth; z += 1) {
          const perimeter = x === 0 || x === resolvedWidth - 1 || z === 0 || z === resolvedDepth - 1;
          const doorway = x === 0 && z === doorZ && y <= 2;
          if (perimeter && !doorway) add(x, y, z, y, 'enclosure');
        }
      }
    }
    for (let x = 0; x < resolvedWidth; x += 1) {
      for (let z = 0; z < resolvedDepth; z += 1) {
        add(x, resolvedHeight - 1, z, resolvedHeight, 'weather_cover');
      }
    }
  }
  if (cells.length > 4096) throw new TypeError('Construction exceeds the safe 4096-cell limit.');
  return Object.freeze({
    id: `${normalizedShape}_${resolvedWidth}x${resolvedDepth}x${resolvedHeight}_${block}`.slice(0, 64),
    version: 1,
    width: resolvedWidth,
    depth: resolvedDepth,
    height: resolvedHeight,
    cells: Object.freeze(cells.map(cell => Object.freeze(cell))),
  });
}

function createFunctionalShelterBlueprint(material) {
  const wallMaterial = canonicalBuildingMaterial(material);
  const width = 5;
  const depth = 5;
  const height = 4;
  const doorZ = Math.floor(depth / 2);
  const cells = [];

  // Foundation first: every later component has known support.
  for (let x = 0; x < width; x += 1) {
    for (let z = 0; z < depth; z += 1) {
      cells.push({ x, y: 0, z, material: wallMaterial, stage: 0, function: 'foundation' });
    }
  }
  // Two-block-high perimeter with a two-block doorway on the west side.
  for (let y = 1; y <= 2; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let z = 0; z < depth; z += 1) {
        const perimeter = x === 0 || x === width - 1 || z === 0 || z === depth - 1;
        const doorway = x === 0 && z === doorZ;
        if (perimeter && !doorway) {
          cells.push({ x, y, z, material: wallMaterial, stage: y, function: 'enclosure' });
        }
      }
    }
  }
  // Access and utilities are world predicates, not narration.
  cells.push({ x: 0, y: 1, z: doorZ, material: 'oak_door', stage: 3, function: 'access' });
  // Roof last so the builder retains an open vertical escape during assembly.
  for (let x = 0; x < width; x += 1) {
    for (let z = 0; z < depth; z += 1) {
      cells.push({ x, y: 3, z, material: wallMaterial, stage: 4, function: 'weather_cover' });
    }
  }
  cells.push({ x: width - 2, y: 1, z: 1, material: 'chest', stage: 5, function: 'storage' });
  cells.push({ x: width - 2, y: 1, z: depth - 2, material: 'furnace', stage: 5, function: 'smelting' });
  cells.push({ x: width - 2, y: 1, z: doorZ, material: 'crafting_table', stage: 5, function: 'crafting' });
  cells.push({ x: 1, y: 1, z: doorZ, material: 'torch', stage: 5, function: 'interior_light' });

  return Object.freeze({
    id: `functional_shelter_${wallMaterial}`.slice(0, 64),
    version: 1,
    width,
    depth,
    height,
    entrance: Object.freeze({ x: 0, y: 1, z: doorZ, width: 1, height: 2 }),
    functions: Object.freeze([
      'supported_foundation',
      'enclosure',
      'usable_access',
      'weather_cover',
      'interior_light',
      'storage',
      'crafting',
      'smelting',
    ]),
    cells: Object.freeze(cells.map(cell => Object.freeze(cell))),
  });
}

function count(snapshot, name) {
  if (name === 'planks') {
    return Object.entries(snapshot?.inventory || {}).reduce(
      (total, [item, amount]) => (
        item.endsWith('_planks')
          ? total + Math.max(0, Number(amount) || 0)
          : total
      ),
      0,
    );
  }
  if (name === 'logs') {
    return Object.entries(snapshot?.inventory || {}).reduce(
      (total, [item, amount]) => (
        item.endsWith('_log') || item.endsWith('_stem')
          ? total + Math.max(0, Number(amount) || 0)
          : total
      ),
      0,
    );
  }
  return Math.max(0, Number(snapshot?.inventory?.[name]) || 0);
}

function resolvedMaterial(cell, snapshot) {
  if (cell.material !== 'survival_building_block') return cell.material;
  return snapshot.selectedMaterial || 'cobblestone';
}

function collectCommand(material, amount, range=64) {
  const bounded = Math.max(1, Math.min(64, Math.floor(amount)));
  const boundedRange = Math.max(16, Math.min(512, Math.floor(Number(range) || 64)));
  return `!prepareMaterial(${JSON.stringify(material)}, ${bounded}, ${boundedRange})`;
}

export function createBuilderStockpileOrder({
  quota = 64,
  material = 'planks',
  constraints,
  source = 'role',
  requester = '',
} = {}) {
  return createWorkOrder({
    role: 'builder',
    kind: 'stockpile',
    source,
    requester,
    target: { name: material },
    quota,
    constraints,
  });
}

export function createBuilderShelterOrder({
  x,
  y,
  z,
  requester = 'player',
  constraints,
} = {}) {
  return createWorkOrder({
    role: 'builder',
    kind: 'build',
    source: 'player',
    requester,
    target: {
      name: 'worksite',
      x,
      y,
      z,
    },
    quota: PLAYER_SHELTER_BLUEPRINT.cells.length,
    blueprint: PLAYER_SHELTER_BLUEPRINT,
    constraints,
  });
}

export function createBuilderFunctionalShelterOrder({
  x,
  y,
  z,
  material = 'cobblestone',
  requester = 'player',
  constraints,
} = {}) {
  const blueprint = createFunctionalShelterBlueprint(material);
  return createWorkOrder({
    role: 'builder',
    kind: 'build',
    source: 'player',
    requester,
    target: {
      name: 'functional_shelter',
      x,
      y,
      z,
    },
    quota: blueprint.cells.length,
    blueprint,
    constraints,
  });
}

export function createBuilderConstructionOrder({
  x,
  y,
  z,
  shape,
  width,
  depth,
  height,
  material,
  requester = 'player',
  constraints,
} = {}) {
  const blueprint = createConstructionBlueprint({
    shape,
    width,
    depth,
    height,
    material,
  });
  return createWorkOrder({
    role: 'builder',
    kind: 'build',
    source: 'player',
    requester,
    target: {
      name: 'construction_site',
      x,
      y,
      z,
    },
    quota: blueprint.cells.length,
    blueprint,
    constraints,
  });
}

export function nextBuilderStep(order, snapshot = {}) {
  if (order.kind === 'build' && order.source !== 'player') {
    return { terminal: true, code: 'construction_not_authorized', retryable: false };
  }
  if (order.kind === 'emergency_shelter' && order.source !== 'survival') {
    return { terminal: true, code: 'emergency_construction_not_authorized', retryable: false };
  }
  const reserveSlots = Number(order.constraints?.reserveSlots ?? 1);
  if (
    Number(snapshot.freeSlots) <= reserveSlots
    && (order.kind === 'stockpile' || order.phase === 'acquire')
  ) {
    if (snapshot.deposit?.mode !== 'assigned') {
      return { blocked: true, code: 'inventory_full_no_deposit', retryable: true };
    }
    const deposit = snapshot.deposit?.target;
    if (![deposit?.x, deposit?.y, deposit?.z].every(Number.isFinite)) {
      return { blocked: true, code: 'assigned_deposit_missing', retryable: true };
    }
    const protectedMaterial = order.kind === 'stockpile'
      ? order.target?.name || 'planks'
      : snapshot.selectedMaterial || 'building_blocks';
    return {
      command: `!depositInventoryOverflowAt("builder", ${JSON.stringify(protectedMaterial)}, ${Math.max(2, reserveSlots)}, ${deposit.x}, ${deposit.y}, ${deposit.z})`,
      nextPhase: order.phase,
      code: 'inventory_consolidation_required',
      target: { name: 'inventory_overflow' },
    };
  }

  if (order.kind === 'stockpile') {
    const material = order.target?.name || 'planks';
    const current = count(snapshot, material);
    if (current >= order.quota) return { complete: true, code: 'stockpile_complete' };
    if (order.phase === 'deliver') return { complete: true, code: 'stockpile_retained' };
    if (order.phase === 'verify') {
      return current >= order.quota
        ? { phase: 'deliver', code: 'stockpile_quota_met' }
        : { phase: 'acquire', code: 'stockpile_incomplete' };
    }
    if (order.phase === 'recover') {
      return {
        command: '!moveAway(32)',
        nextPhase: 'assess',
        code: 'stockpile_search_relocation',
      };
    }
    return {
      phase: 'acquire',
      command: collectCommand(material, order.quota - current, order.constraints?.maxDistance),
      nextPhase: 'verify',
      target: { name: material },
    };
  }

  const audit = snapshot.blueprintAudit;
  if (!audit || audit.valid !== true) {
    if (audit?.code === 'occupied') {
      return {
        blocked: true,
        code: 'blueprint_occupied',
        detail: 'A world entity occupies an unfinished blueprint cell; waiting for it to clear.',
        retryable: true,
      };
    }
    return {
      terminal: true,
      code: `unsafe_blueprint_${audit?.code || 'not_audited'}`,
      retryable: false,
    };
  }
  const missing = Array.isArray(audit.missing) ? audit.missing : [];
  const incorrect = Array.isArray(audit.incorrect) ? audit.incorrect : [];
  if (incorrect.length > 0) {
    // A boulder or a tree in the footprint used to kill the whole order, so
    // building anywhere but bare flat ground meant clearing the site by hand
    // first. The bot clears safe natural terrain itself now. Anything outside that
    // narrow safety predicate remains untouched and produces an exact blocker.
    const clearable = incorrect.find(cell => cell.clearable);
    if (!clearable) {
      return {
        terminal: true,
        code: 'blueprint_incorrect_block',
        detail: `${incorrect[0].observed} at ${incorrect[0].x}, ${incorrect[0].y}, ${incorrect[0].z} is in the way and is not safe natural terrain to clear. Move the site or clear it yourself.`,
        retryable: false,
      };
    }
    return {
      command: `!breakBlock(${clearable.x}, ${clearable.y}, ${clearable.z})`,
      nextPhase: order.phase,
      code: 'worksite_clearing',
      target: { name: 'obstruction', x: clearable.x, y: clearable.y, z: clearable.z },
      reason: `Clear the ${clearable.observed} standing where the ${clearable.expected} goes.`,
    };
  }
  if (missing.length === 0 && incorrect.length === 0) {
    if (order.kind === 'emergency_shelter') {
      const occupied = Math.floor(Number(snapshot.x)) === Math.floor(Number(order.target?.x))
        && Math.floor(Number(snapshot.y)) === Math.floor(Number(order.target?.y))
        && Math.floor(Number(snapshot.z)) === Math.floor(Number(order.target?.z));
      if (!occupied) {
        const x = Math.floor(Number(order.target.x)) + 0.5;
        const y = Math.floor(Number(order.target.y));
        const z = Math.floor(Number(order.target.z)) + 0.5;
        return {
          command: `!goToCoordinates(${x}, ${y}, ${z}, 0.5)`,
          nextPhase: 'deliver',
          code: 'shelter_occupancy_required',
          target: { name: 'shelter_interior', x, y, z },
          checkpoint: {
            verifiedCount: Math.max(0, Number(audit.correct) || 0),
            nextCell: Math.max(0, Number(audit.correct) || 0),
          },
          reason: 'Enter the verified shelter before declaring emergency protection complete.',
        };
      }
    }
    return {
      complete: true,
      code: 'blueprint_complete',
      checkpoint: {
        verifiedCount: Math.max(0, Number(audit.correct) || 0),
        nextCell: Math.max(0, Number(audit.correct) || 0),
      },
    };
  }

  if (order.phase === 'assess' || order.phase === 'recover') {
    const next = missing[0];
    const material = resolvedMaterial(next, snapshot);
    return count(snapshot, material) > 0
      ? { phase: 'execute', code: 'worksite_verified' }
      : { phase: 'acquire', code: 'materials_required' };
  }
  if (order.phase === 'acquire') {
    const requirements = new Map();
    for (const cell of missing) {
      const material = resolvedMaterial(cell, snapshot);
      requirements.set(material, (requirements.get(material) || 0) + 1);
    }
    const needed = [...requirements.entries()]
      .map(([material, required]) => ({ material, missing: Math.max(0, required - count(snapshot, material)) }))
      .find(entry => entry.missing > 0);
    if (!needed) return { phase: 'execute', code: 'materials_ready' };
    return {
      command: collectCommand(needed.material, needed.missing, order.constraints?.maxDistance),
      nextPhase: 'assess',
      target: { name: needed.material },
    };
  }
  if (order.phase === 'execute') {
    const cell = missing
      .filter(candidate => candidate.supported !== false)
      .slice()
      .sort((left, right) => (
        (left.stage ?? 0) - (right.stage ?? 0)
        || left.y - right.y
        || (left.index ?? 0) - (right.index ?? 0)
      ))[0];
    if (!cell) {
      return {
        terminal: true,
        code: 'blueprint_support_chain_blocked',
        retryable: false,
      };
    }
    const material = resolvedMaterial(cell, snapshot);
    if (count(snapshot, material) <= 0) return { phase: 'acquire', code: 'material_exhausted' };
    return {
      command: `!placeBlockAt(${JSON.stringify(material)}, ${cell.x}, ${cell.y}, ${cell.z})`,
      nextPhase: 'verify',
      target: { name: material, x: cell.x, y: cell.y, z: cell.z },
      checkpoint: {
        verifiedCount: Math.max(0, Number(audit.correct) || 0),
        nextCell: Math.max(0, Number(cell.index) || 0),
      },
      reason: cell.function
        ? `Place ${cell.function.replaceAll('_', ' ')} after its prerequisite stages are supported.`
        : 'Place the next supported blueprint cell.',
    };
  }
  if (order.phase === 'verify') {
    return { phase: 'execute', code: 'cell_verified' };
  }
  if (order.phase === 'deliver') {
    return {
      complete: true,
      code: 'blueprint_complete',
      checkpoint: {
        verifiedCount: Math.max(0, Number(audit.correct) || 0),
        nextCell: Math.max(0, Number(audit.correct) || 0),
      },
    };
  }
  return { terminal: true, code: 'unsupported_builder_phase', retryable: false };
}
