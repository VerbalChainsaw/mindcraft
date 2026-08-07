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

function unloadedWorksiteApproach(order, snapshot) {
  const target = order.target;
  const blueprint = order.blueprint;
  if (
    ![target?.x, target?.y, target?.z, snapshot.x, snapshot.y, snapshot.z].every(Number.isFinite)
    || !Number.isInteger(blueprint?.width)
    || !Number.isInteger(blueprint?.depth)
  ) return null;

  const centerX = target.x + (blueprint.width / 2);
  const centerZ = target.z + (blueprint.depth / 2);
  const approachRange = Math.max(
    4,
    Math.ceil(Math.hypot(blueprint.width, blueprint.depth) / 2) + 2,
  );
  const distance = Math.hypot(
    snapshot.x - centerX,
    snapshot.y - target.y,
    snapshot.z - centerZ,
  );
  if (distance <= approachRange + 2) return null;

  return {
    command: `!goToCoordinates(${centerX}, ${target.y}, ${centerZ}, ${approachRange})`,
    nextPhase: order.phase,
    code: 'worksite_approach_required',
    keepAnchor: true,
    target: { name: 'worksite', x: centerX, y: target.y, z: centerZ },
    reason: 'Approach the authorized worksite so its complete blueprint can be audited from fresh loaded blocks.',
  };
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

function orderedSupportedMissing(missing = []) {
  return missing
    .filter(candidate => candidate.supported !== false)
    .slice()
    .sort((left, right) => (
      (left.stage ?? 0) - (right.stage ?? 0)
      || left.y - right.y
      || (left.index ?? 0) - (right.index ?? 0)
    ));
}

function carriedCellInCurrentStage(missing, snapshot) {
  const ordered = orderedSupportedMissing(missing);
  if (ordered.length === 0) return null;
  const stage = ordered[0].stage ?? 0;
  return ordered.find(cell => (
    (cell.stage ?? 0) === stage
    && count(snapshot, resolvedMaterial(cell, snapshot)) > 0
  )) || null;
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

/**
 * Describe the active blueprint as one compact no-collection region. Builder
 * placement and clearance remain authoritative inside this box; generic
 * resource gathering must look elsewhere.
 */
export function builderWorksiteCollectionExclusion(order) {
  const cells = order?.blueprint?.cells;
  const anchor = order?.target;
  if (
    order?.role !== 'builder'
    || !['build', 'emergency_shelter'].includes(order?.kind)
    || ['complete', 'failed', 'cancelled'].includes(order?.phase)
    || !Array.isArray(cells)
    || cells.length === 0
    || ![anchor?.x, anchor?.y, anchor?.z].every(Number.isFinite)
  ) return null;

  const absolute = cells.map(cell => ({
    x: anchor.x + cell.x,
    y: anchor.y + cell.y,
    z: anchor.z + cell.z,
  }));
  return Object.freeze({
    minX: Math.min(...absolute.map(position => position.x)),
    maxX: Math.max(...absolute.map(position => position.x)),
    minY: Math.min(...absolute.map(position => position.y)),
    maxY: Math.max(...absolute.map(position => position.y)),
    minZ: Math.min(...absolute.map(position => position.z)),
    maxZ: Math.max(...absolute.map(position => position.z)),
    reason: 'active_builder_worksite',
    orderId: order.id,
  });
}

function toolPrerequisiteStep(order, snapshot, priorSkill, planItem) {
  const requirement = order.checkpoint?.toolRequirement;
  if (!requirement?.name) return null;
  if (typeof planItem !== 'function') {
    return {
      terminal: true,
      code: 'tool_planner_unavailable',
      detail: `No prerequisite planner is available for ${requirement.name}.`,
      retryable: false,
    };
  }
  const surfaceReached = priorSkill?.kind === 'surface_navigation'
    && priorSkill?.outcome === 'surface_reached';
  const accessRequirement = surfaceReached
    ? null
    : priorSkill?.accessRequirement || order.checkpoint?.accessRequirement || null;
  const plan = planItem({
    target: requirement.name,
    quantity: 1,
    completion: 'inventory',
    range: order.constraints?.maxDistance,
    toolRequirement: requirement,
    accessRequirement,
    excludedMethods: order.checkpoint?.failedMethods || [],
    allowEntityAlternatives: false,
  });
  if (plan?.status === 'complete') {
    return {
      phase: order.resumePhase || 'execute',
      code: 'tool_prerequisite_ready',
      checkpoint: {
        ...order.checkpoint,
        toolRequirement: null,
        accessRequirement: null,
      },
    };
  }
  if (plan?.status !== 'ready' || !plan.nextStep?.capability) {
    return {
      terminal: true,
      code: plan?.code || 'tool_plan_blocked',
      detail: plan?.detail || `No deterministic prerequisite plan exists for ${requirement.name}.`,
      retryable: false,
    };
  }
  return {
    capability: plan.nextStep.capability,
    methodKey: plan.nextStep.learningKey || null,
    nextPhase: 'recover',
    code: 'tool_prerequisite_planned',
    target: { name: requirement.name },
    reason: plan.nextStep.reason,
    checkpoint: {
      ...order.checkpoint,
      toolRequirement: requirement,
      accessRequirement,
    },
  };
}

function materialAcquisitionStep(order, snapshot, priorSkill, requirement, planItem) {
  if (typeof planItem !== 'function') {
    return {
      terminal: true,
      code: 'material_planner_unavailable',
      detail: `No prerequisite planner is available for ${requirement.target}.`,
      retryable: false,
    };
  }
  const toolRequirement = priorSkill?.toolRequirement
    || order.checkpoint?.toolRequirement
    || null;
  const workstationRequirement = priorSkill?.workstationRequirement
    || order.checkpoint?.workstationRequirement
    || null;
  const surfaceReached = priorSkill?.kind === 'surface_navigation'
    && priorSkill?.outcome === 'surface_reached';
  const accessRequirement = surfaceReached
    ? null
    : priorSkill?.accessRequirement || order.checkpoint?.accessRequirement || null;
  const plan = planItem({
    target: requirement.target,
    quantity: requirement.quantity,
    completion: 'inventory',
    range: order.constraints?.maxDistance,
    toolRequirement,
    workstationRequirement,
    accessRequirement,
    excludedMethods: order.checkpoint?.failedMethods || [],
    allowEntityAlternatives: order.checkpoint?.acquisitionVariantCommitted !== true,
  });
  if (plan?.status === 'complete') {
    return {
      phase: 'execute',
      code: 'materials_ready',
      checkpoint: {
        ...order.checkpoint,
        acquisitionRequirement: null,
        acquisitionVariantCommitted: null,
      },
    };
  }
  if (plan?.status !== 'ready' || !plan.nextStep?.capability) {
    return {
      terminal: true,
      code: plan?.code || 'material_plan_blocked',
      detail: plan?.detail || `No deterministic prerequisite plan exists for ${requirement.target}.`,
      retryable: false,
    };
  }
  return {
    capability: plan.nextStep.capability,
    methodKey: plan.nextStep.learningKey || null,
    nextPhase: 'acquire',
    code: 'material_prerequisite_planned',
    target: { name: requirement.target },
    reason: plan.nextStep.reason,
    checkpoint: {
      ...order.checkpoint,
      acquisitionRequirement: requirement,
      ...(toolRequirement ? { toolRequirement } : {}),
      ...(workstationRequirement ? { workstationRequirement } : {}),
      accessRequirement,
    },
  };
}

export function nextBuilderStep(order, snapshot = {}, lastResult = null, { planItem = null } = {}) {
  if (order.kind === 'build' && order.source !== 'player') {
    return { terminal: true, code: 'construction_not_authorized', retryable: false };
  }
  if (order.kind === 'emergency_shelter' && order.source !== 'survival') {
    return { terminal: true, code: 'emergency_construction_not_authorized', retryable: false };
  }
  const reserveSlots = Number(order.constraints?.reserveSlots ?? 1);
  const priorSkill = lastResult?.evidence?.skill || null;
  const verifiedAcquisitionProgress = Boolean(
    order.phase === 'acquire'
    && priorSkill?.progress?.verified === true
    && typeof priorSkill.progress.kind === 'string'
    && [
      priorSkill.progress.position?.x,
      priorSkill.progress.position?.y,
      priorSkill.progress.position?.z,
    ].every(Number.isFinite),
  );
  const carriedBuildCell = order.kind === 'build'
    ? carriedCellInCurrentStage(snapshot.blueprintAudit?.missing, snapshot)
    : null;
  const acquisitionRequirement = order.checkpoint?.acquisitionRequirement;
  const toolStep = toolPrerequisiteStep(order, snapshot, priorSkill, planItem);
  if (toolStep) return toolStep;
  if (
    ['acquire', 'recover'].includes(order.phase)
    && acquisitionRequirement
    && snapshot.blueprintAudit?.code === 'unloaded'
  ) {
    if (count(snapshot, acquisitionRequirement.target) >= acquisitionRequirement.quantity) {
      return {
        phase: 'execute',
        code: 'remote_materials_ready',
        checkpoint: {
          ...order.checkpoint,
          acquisitionRequirement: null,
          acquisitionVariantCommitted: null,
        },
      };
    }
    return materialAcquisitionStep(
      order,
      snapshot,
      priorSkill,
      acquisitionRequirement,
      planItem,
    );
  }
  if (
    Number(snapshot.freeSlots) <= reserveSlots
    && order.kind === 'stockpile'
    && !carriedBuildCell
    && !verifiedAcquisitionProgress
  ) {
    const protectedMaterial = order.kind === 'stockpile'
      ? order.target?.name || 'planks'
      : [...new Set((order.blueprint?.cells || [])
        .map(cell => resolvedMaterial(cell, snapshot))
        .filter(Boolean))].join(',');
    if (snapshot.deposit?.mode !== 'assigned') {
      return {
        command: `!releaseInventoryWorkingSlots(${JSON.stringify(protectedMaterial)}, ${Math.max(2, reserveSlots)})`,
        nextPhase: order.phase,
        code: 'inventory_capacity_release_required',
        target: { name: 'working_inventory' },
      };
    }
    const deposit = snapshot.deposit?.target;
    if (![deposit?.x, deposit?.y, deposit?.z].every(Number.isFinite)) {
      return { blocked: true, code: 'assigned_deposit_missing', retryable: true };
    }
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
    if (audit?.code === 'unloaded') {
      const approach = unloadedWorksiteApproach(order, snapshot);
      if (approach) return approach;
    }
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
    // The complete footprint is one authorization decision. Never clear an
    // apparently natural cell first and discover a player-built obstruction
    // later in the same blueprint; mixed sites fail before any mutation.
    const protectedCell = incorrect.find(cell => !cell.clearable);
    if (protectedCell) {
      return {
        terminal: true,
        code: 'blueprint_incorrect_block',
        detail: `${protectedCell.observed} at ${protectedCell.x}, ${protectedCell.y}, ${protectedCell.z} is in the way and is not safe natural terrain to clear. Move the site or clear it yourself.`,
        retryable: false,
      };
    }
    const clearable = incorrect[0];
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

  if (
    order.phase === 'acquire'
    && Number(snapshot.freeSlots) <= reserveSlots
    && !carriedBuildCell
    && !verifiedAcquisitionProgress
  ) {
    const protectedMaterials = [...new Set((order.blueprint?.cells || [])
      .map(cell => resolvedMaterial(cell, snapshot))
      .filter(Boolean))].join(',');
    return {
      command: `!releaseInventoryWorkingSlots(${JSON.stringify(protectedMaterials)}, ${Math.max(2, reserveSlots)})`,
      nextPhase: order.phase,
      code: 'inventory_capacity_release_required',
      target: { name: 'working_inventory' },
    };
  }

  if (order.phase === 'assess' || order.phase === 'recover') {
    return carriedCellInCurrentStage(missing, snapshot)
      ? {
        phase: 'execute',
        code: 'worksite_verified',
        checkpoint: {
          ...order.checkpoint,
          acquisitionRequirement: null,
          acquisitionVariantCommitted: null,
        },
      }
      : { phase: 'acquire', code: 'materials_required' };
  }
  if (order.phase === 'acquire') {
    if (carriedBuildCell) {
      return {
        phase: 'execute',
        code: 'carried_material_ready',
        checkpoint: {
          ...order.checkpoint,
          acquisitionRequirement: null,
          acquisitionVariantCommitted: null,
        },
      };
    }
    const requirements = new Map();
    for (const cell of missing) {
      const material = resolvedMaterial(cell, snapshot);
      requirements.set(material, (requirements.get(material) || 0) + 1);
    }
    const needed = [...requirements.entries()]
      .map(([material, required]) => ({ material, missing: Math.max(0, required - count(snapshot, material)) }))
      .find(entry => entry.missing > 0);
    if (!needed) {
      return {
        phase: 'execute',
        code: 'materials_ready',
        checkpoint: {
          ...order.checkpoint,
          acquisitionRequirement: null,
          acquisitionVariantCommitted: null,
        },
      };
    }
    const desired = count(snapshot, needed.material) + needed.missing;
    return materialAcquisitionStep(
      order,
      snapshot,
      priorSkill,
      { target: needed.material, quantity: desired },
      planItem,
    );
  }
  if (order.phase === 'execute') {
    const ordered = orderedSupportedMissing(missing);
    const cell = carriedCellInCurrentStage(missing, snapshot) || ordered[0];
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
      command: cell.fixture
        ? `!placeFixtureAt(${JSON.stringify(material)}, ${cell.x}, ${cell.y}, ${cell.z}, ${JSON.stringify(cell.fixture.kind)}, ${JSON.stringify(cell.fixture.facing)})`
        : `!placeBlockAt(${JSON.stringify(material)}, ${cell.x}, ${cell.y}, ${cell.z})`,
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
