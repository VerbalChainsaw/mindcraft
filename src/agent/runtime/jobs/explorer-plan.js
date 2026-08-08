import { createCapabilityRequest } from '../capability-catalogue.js';
import { familyEntriesFromCounts } from '../item-family.js';

const PREPARED_TORCHES = 8;
const PICKAXE_DURABILITY_RESERVE = 48;
const CAVE_SEARCH_RELOCATION_DISTANCE = 48;
const CAVE_SEARCH_DIRECTIONS = Object.freeze([
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
  [1, 1],
  [1, -1],
  [-1, -1],
  [-1, 1],
]);

function familyCounts(snapshot) {
  return Object.fromEntries(
    familyEntriesFromCounts(snapshot?.inventory || {}, 'ores')
      .map(entry => [entry.name, entry.count]),
  );
}

function familyTotal(counts) {
  return Object.values(counts || {}).reduce(
    (total, count) => total + Math.max(0, Number(count) || 0),
    0,
  );
}

function collectedManifest(snapshot, checkpoint) {
  const baseline = checkpoint?.baselineFamilyCounts || {};
  return familyEntriesFromCounts(snapshot?.inventory || {}, 'ores')
    .map(entry => ({
      item: entry.name,
      quantity: Math.max(0, entry.count - (Number(baseline[entry.name]) || 0)),
    }))
    .filter(entry => entry.quantity > 0);
}

function distanceToHome(order, snapshot) {
  if (![order.target?.x, order.target?.y, order.target?.z, snapshot?.x, snapshot?.y, snapshot?.z]
    .every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  return Math.hypot(
    snapshot.x - order.target.x,
    snapshot.y - order.target.y,
    snapshot.z - order.target.z,
  );
}

function prerequisiteStep(order, planItem) {
  if (typeof planItem !== 'function') {
    return {
      terminal: true,
      code: 'expedition_planner_unavailable',
      detail: 'No prerequisite planner is available for expedition supplies.',
      retryable: false,
    };
  }
  const toolPlan = planItem({
    target: 'stone_pickaxe',
    quantity: 1,
    completion: 'inventory',
    range: order.constraints?.maxDistance,
    toolRequirement: {
      name: 'stone_pickaxe',
      minimumUsableDurability: PICKAXE_DURABILITY_RESERVE,
    },
    excludedMethods: order.checkpoint?.failedMethods || [],
    allowEntityAlternatives: false,
  });
  if (toolPlan?.status === 'ready' && toolPlan.nextStep?.capability) {
    return {
      capability: toolPlan.nextStep.capability,
      methodKey: toolPlan.nextStep.learningKey || null,
      nextPhase: 'prepare',
      code: 'expedition_tool_prerequisite',
      target: { name: 'stone_pickaxe' },
      keepAnchor: true,
    };
  }
  if (toolPlan?.status !== 'complete') {
    return {
      terminal: true,
      code: toolPlan?.code || 'expedition_tool_unavailable',
      detail: toolPlan?.detail || 'No deterministic plan can prepare a usable pickaxe.',
      retryable: false,
    };
  }
  if (order.checkpoint?.caveLightingComplete === true) return null;

  const torchPlan = planItem({
    target: 'torch',
    quantity: PREPARED_TORCHES,
    completion: 'inventory',
    range: order.constraints?.maxDistance,
    excludedMethods: order.checkpoint?.failedMethods || [],
    allowEntityAlternatives: false,
  });
  if (torchPlan?.status === 'ready' && torchPlan.nextStep?.capability) {
    return {
      capability: torchPlan.nextStep.capability,
      methodKey: torchPlan.nextStep.learningKey || null,
      nextPhase: 'prepare',
      code: 'expedition_light_prerequisite',
      target: { name: 'torch' },
      keepAnchor: true,
    };
  }
  if (torchPlan?.status !== 'complete') {
    return {
      terminal: true,
      code: torchPlan?.code || 'expedition_lighting_unavailable',
      detail: torchPlan?.detail || 'No deterministic plan can prepare cave lighting.',
      retryable: false,
    };
  }
  return null;
}

function caveSurveyStep(order) {
  return createCapabilityRequest('survey_nearby_cave', {
    home: order.target,
    range: order.constraints?.maxDistance,
    excludedTargets: order.checkpoint?.failedTargets || [],
  }, {
    methodKey: 'collect:cave_region->ores',
    nextPhase: 'execute',
    code: 'nearby_cave_survey',
    target: { name: 'cave_region' },
    keepAnchor: true,
    checkpointOnSuccess: {
      ...order.checkpoint,
      caveLit: true,
      caveLightingComplete: true,
    },
  });
}

function caveSearchRelocationStep(order) {
  const completed = Math.max(0, Number(order.checkpoint?.caveSearchRelocations) || 0);
  if (completed >= CAVE_SEARCH_DIRECTIONS.length) {
    return {
      terminal: true,
      code: 'cave_search_exhausted',
      detail: 'No safe cave stance was observed after the bounded home-region waypoint search.',
      retryable: false,
    };
  }
  const [directionX, directionZ] = CAVE_SEARCH_DIRECTIONS[completed];
  const directionLength = Math.hypot(directionX, directionZ);
  const x = Math.round(order.target.x + (
    (CAVE_SEARCH_RELOCATION_DISTANCE * directionX) / directionLength
  ));
  const z = Math.round(order.target.z + (
    (CAVE_SEARCH_RELOCATION_DISTANCE * directionZ) / directionLength
  ));
  return createCapabilityRequest('navigate_exact', {
    x,
    y: order.target.y,
    z,
    closeness: 8,
    dimension: order.checkpoint.homeDimension,
  }, {
    nextPhase: 'execute',
    code: 'cave_search_waypoint',
    target: { name: 'cave_search_region', x, y: order.target.y, z },
    keepAnchor: true,
    recoveryAction: true,
    checkpointOnSuccess: {
      ...order.checkpoint,
      caveSearchRelocations: completed + 1,
    },
  });
}

function collectionStep(order) {
  return createCapabilityRequest('collect_exposed_ore', {
    home: order.target,
    range: Math.min(48, order.constraints?.maxDistance || 48),
    excludedTargets: order.checkpoint?.failedTargets || [],
  }, {
    methodKey: 'collect:exposed_ore->ores',
    nextPhase: 'execute',
    code: 'exposed_ore_collection',
    target: { name: 'ores' },
  });
}

function executionStep(order, snapshot, planItem) {
  const checkpoint = order.checkpoint || {};
  if (!checkpoint.caveLit) {
    // Cave-lighting can consume its last torch before a bounded failure. A
    // resumed order must prove its supplies again instead of blindly replaying
    // the physical capability with a now-false precondition.
    const prerequisite = prerequisiteStep(order, planItem);
    return prerequisite || caveSurveyStep(order);
  }
  const manifest = collectedManifest(snapshot, checkpoint);
  if (familyTotal(Object.fromEntries(manifest.map(entry => [entry.item, entry.quantity]))) >= order.quota) {
    return {
      phase: 'deliver',
      code: 'expedition_collection_quota_met',
      checkpoint: {
        ...checkpoint,
        collectedManifest: manifest,
        deliveryIndex: 0,
        deliveryOffset: 0,
      },
    };
  }
  return collectionStep(order);
}

function deliveryStep(order, snapshot) {
  const checkpoint = order.checkpoint || {};
  if (snapshot.dimension !== checkpoint.homeDimension) {
    return {
      terminal: true,
      code: 'expedition_wrong_dimension',
      detail: `The home base is in ${checkpoint.homeDimension}; the bot is in ${snapshot.dimension || 'an unknown dimension'}.`,
      retryable: false,
    };
  }
  if (distanceToHome(order, snapshot) > 3) {
    return createCapabilityRequest('navigate_exact', {
      x: order.target.x,
      y: order.target.y,
      z: order.target.z,
      closeness: 2,
      dimension: checkpoint.homeDimension,
    }, {
      nextPhase: 'deliver',
      code: 'expedition_return_home',
      target: { name: 'home_base', x: order.target.x, y: order.target.y, z: order.target.z },
      keepAnchor: true,
    });
  }

  const manifest = checkpoint.collectedManifest || [];
  const index = Math.max(0, Number(checkpoint.deliveryIndex) || 0);
  const offset = Math.max(0, Number(checkpoint.deliveryOffset) || 0);
  const selected = manifest[index];
  if (!selected) {
    return {
      complete: true,
      code: 'expedition_stored_at_home',
      checkpoint: {
        ...checkpoint,
        collected: manifest.reduce((total, entry) => total + entry.quantity, 0),
      },
    };
  }
  if (offset >= selected.quantity) {
    return {
      phase: 'deliver',
      code: 'expedition_manifest_item_stored',
      checkpoint: {
        ...checkpoint,
        deliveryIndex: index + 1,
        deliveryOffset: 0,
      },
    };
  }
  const quantity = selected.quantity - offset;
  return createCapabilityRequest('store_exact_item', {
    item: selected.item,
    quantity,
    container: {
      name: checkpoint.containerName,
      x: checkpoint.containerX,
      y: checkpoint.containerY,
      z: checkpoint.containerZ,
      dimension: checkpoint.containerDimension,
    },
  }, {
    nextPhase: 'deliver',
    code: 'expedition_store_result',
    target: {
      name: selected.item,
      x: checkpoint.containerX,
      y: checkpoint.containerY,
      z: checkpoint.containerZ,
    },
    keepAnchor: true,
    checkpointOnVerifiedTransfer: {
      field: 'deliveryOffset',
      baseline: offset,
      maximum: selected.quantity,
    },
  });
}

export function nextExplorerStep(order, snapshot = {}, _lastResult = null, { planItem = null } = {}) {
  if (order.role !== 'miner' || order.kind !== 'explore' || order.target?.name !== 'ores') {
    return { terminal: true, code: 'invalid_expedition_order', retryable: false };
  }
  const checkpoint = order.checkpoint || {};
  if (!checkpoint.homeDimension || !checkpoint.containerName) {
    return {
      terminal: true,
      code: 'expedition_home_binding_missing',
      detail: 'The expedition has no exact durable home-container binding.',
      retryable: false,
    };
  }
  if (!checkpoint.baselineFamilyCounts) {
    return {
      phase: 'prepare',
      code: 'expedition_baseline_recorded',
      checkpoint: {
        ...checkpoint,
        baselineFamilyCounts: familyCounts(snapshot),
      },
    };
  }

  if (order.phase === 'deliver' || order.phase === 'verify') {
    return deliveryStep(order, snapshot);
  }
  if (order.phase === 'recover') {
    if (order.resumePhase === 'deliver' || order.resumePhase === 'verify') {
      return deliveryStep({ ...order, phase: 'deliver' }, snapshot);
    }
    if (['assess', 'prepare', 'acquire'].includes(order.resumePhase)) {
      const prerequisite = prerequisiteStep(order, planItem);
      return prerequisite || { phase: 'execute', code: 'expedition_supplies_recovered' };
    }
    if (order.resumePhase === 'execute') {
      if (checkpoint.caveLit && order.evidence?.code === 'resource_not_found') {
        // The selected cave was physically reached and lit but yielded no
        // exposed ore. Preserve that failed region, clear only the cave
        // selection, and let the ordinary survey/search path bind a different
        // cave instead of rescanning the same empty one.
        return {
          phase: 'execute',
          code: 'cave_region_exhausted',
          checkpoint: {
            ...checkpoint,
            caveLit: false,
          },
        };
      }
      if (!checkpoint.caveLit && order.evidence?.code === 'source_not_found') {
        const manifest = collectedManifest(snapshot, checkpoint);
        const collected = manifest.reduce((total, entry) => total + entry.quantity, 0);
        if (checkpoint.bestEffort === true && collected > 0) {
          return {
            phase: 'deliver',
            code: 'expedition_best_effort_collection_complete',
            checkpoint: {
              ...checkpoint,
              collectedManifest: manifest,
              deliveryIndex: 0,
              deliveryOffset: 0,
            },
          };
        }
        return caveSearchRelocationStep(order);
      }
      return executionStep({ ...order, phase: 'execute' }, snapshot, planItem);
    }
    return caveSurveyStep(order);
  }

  if (['assess', 'prepare', 'acquire'].includes(order.phase)) {
    const prerequisite = prerequisiteStep(order, planItem);
    if (prerequisite) return prerequisite;
    return { phase: 'execute', code: 'expedition_supplies_ready' };
  }

  if (order.phase === 'execute') {
    return executionStep(order, snapshot, planItem);
  }

  return { terminal: true, code: 'unsupported_expedition_phase', retryable: false };
}
