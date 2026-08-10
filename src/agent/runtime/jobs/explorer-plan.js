import { createCapabilityRequest } from '../capability-catalogue.js';
import { familyEntriesFromCounts } from '../item-family.js';
import { workOrderCollectionExclusions } from '../work-order.js';
import {
  downwardMiningDepthTarget,
  miningKnowledge,
  miningOutputName,
} from './miner-plan.js';

const PREPARED_TORCHES = 8;
const PICKAXE_DURABILITY_RESERVE = 48;
const CAVE_SEARCH_RELOCATION_DISTANCE = 48;
const RETAINED_CAVE_SEARCH_RELOCATIONS = 2;
const MAX_MINING_REGION_RELOCATIONS = 2;
const MINING_CORRIDOR_LENGTH = 8;
const MAX_MINING_CORRIDOR_LEGS = 8;
const PICKAXE_TIER = Object.freeze({
  wooden_pickaxe: 1,
  golden_pickaxe: 2,
  stone_pickaxe: 3,
  copper_pickaxe: 3.5,
  iron_pickaxe: 4,
  diamond_pickaxe: 5,
  netherite_pickaxe: 6,
});
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

function requirementProgress(snapshot, checkpoint, requirement) {
  const baseline = Number(checkpoint?.baselineFamilyCounts?.[requirement.item]) || 0;
  return Math.max(0, (Number(snapshot?.inventory?.[requirement.item]) || 0) - baseline);
}

function requiredOutputsSatisfied(snapshot, checkpoint) {
  return (checkpoint?.requiredOutputs || []).every(requirement => (
    requirementProgress(snapshot, checkpoint, requirement) >= requirement.quantity
  ));
}

function bestEffortDelivery(order, snapshot, code = 'expedition_best_effort_collection_complete') {
  const checkpoint = order.checkpoint || {};
  const manifest = collectedManifest(snapshot, checkpoint);
  const collected = manifest.reduce((total, entry) => total + entry.quantity, 0);
  if (
    checkpoint.bestEffort !== true
    || collected < 1
    || !requiredOutputsSatisfied(snapshot, checkpoint)
  ) return null;
  return {
    phase: 'deliver',
    code,
    checkpoint: {
      ...checkpoint,
      collectedManifest: manifest,
      deliveryIndex: 0,
      deliveryOffset: 0,
    },
  };
}

function outstandingOreSources(snapshot, checkpoint) {
  return (checkpoint?.requiredOutputs || [])
    .filter(requirement => requirementProgress(snapshot, checkpoint, requirement) < requirement.quantity)
    .flatMap(requirement => requirement.source.startsWith('deepslate_')
      ? [requirement.source]
      : [requirement.source, `deepslate_${requirement.source}`]);
}

function outstandingRequirements(snapshot, checkpoint) {
  return (checkpoint?.requiredOutputs || [])
    .filter(requirement => requirementProgress(snapshot, checkpoint, requirement) < requirement.quantity);
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

function expeditionToolRequirement(discovered) {
  const baseline = {
    name: 'stone_pickaxe',
    minimumUsableDurability: PICKAXE_DURABILITY_RESERVE,
  };
  if (!discovered?.name || !(discovered.name in PICKAXE_TIER)) return baseline;
  const name = PICKAXE_TIER[discovered.name] > PICKAXE_TIER[baseline.name]
    ? discovered.name
    : baseline.name;
  return {
    name,
    minimumUsableDurability: Math.max(
      PICKAXE_DURABILITY_RESERVE,
      Number(discovered.minimumUsableDurability) || 0,
    ),
  };
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
  const requiredTool = expeditionToolRequirement(order.checkpoint?.toolRequirement);
  const toolPlan = planItem({
    target: requiredTool.name,
    quantity: 1,
    completion: 'inventory',
    range: order.constraints?.maxDistance,
    toolRequirement: {
      name: requiredTool.name,
      minimumUsableDurability: requiredTool.minimumUsableDurability,
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
      target: { name: requiredTool.name },
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

function caveSearchRelocationStep(order, snapshot) {
  const completed = Math.max(0, Number(order.checkpoint?.caveSearchRelocations) || 0);
  const retainedRequirements = order.checkpoint?.requiredOutputs || [];
  const relocationLimit = retainedRequirements.length > 0
    ? RETAINED_CAVE_SEARCH_RELOCATIONS
    : CAVE_SEARCH_DIRECTIONS.length;
  if (completed >= relocationLimit) {
    if (retainedRequirements.length > 0) {
      const requirement = outstandingRequirements(snapshot, order.checkpoint)[0] || null;
      return {
        phase: 'execute',
        code: 'expedition_strategy_changed',
        detail: 'Exposed-cave search settled without every named output; switching to a bounded deterministic mining corridor.',
        checkpoint: {
          ...order.checkpoint,
          caveLit: false,
          acquisitionStrategy: 'mining_corridor',
          corridorSearchLegs: 0,
          ...(requirement ? {
            corridorRequirementItem: requirement.item,
            corridorRequirementProgress: requirementProgress(
              snapshot,
              order.checkpoint,
              requirement,
            ),
          } : {}),
        },
        target: {
          name: 'mining_corridor',
          x: Number.isFinite(snapshot?.x) ? Math.floor(snapshot.x) : order.target.x,
          y: Number.isFinite(snapshot?.y) ? Math.floor(snapshot.y) : order.target.y,
          z: Number.isFinite(snapshot?.z) ? Math.floor(snapshot.z) : order.target.z,
        },
      };
    }
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
  return createCapabilityRequest('relocate_search_region', {
    x,
    y: order.target.y,
    z,
    closeness: 8,
    minimumDisplacement: 16,
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

function miningRegionRelocationStep(order) {
  const checkpoint = order.checkpoint || {};
  const completed = Math.max(0, Number(checkpoint.miningRegionRelocations) || 0);
  if (completed >= MAX_MINING_REGION_RELOCATIONS) {
    return {
      terminal: true,
      code: 'mining_strategy_exhausted',
      detail: order.evidence?.detail || 'No safe deterministic mining corridor was available in the bounded alternative regions.',
      retryable: false,
    };
  }

  // Continue the same deterministic region sequence used by cave search so a
  // failed depth corridor cannot send the bot back to a region it just ruled
  // out. Relocation remains an existing bounded recovery capability; it does
  // not move navigation or excavation policy into Explorer.
  const priorRegions = Math.max(0, Number(checkpoint.caveSearchRelocations) || 0);
  const [directionX, directionZ] = CAVE_SEARCH_DIRECTIONS[
    (priorRegions + completed) % CAVE_SEARCH_DIRECTIONS.length
  ];
  const directionLength = Math.hypot(directionX, directionZ);
  const x = Math.round(order.target.x + (
    (CAVE_SEARCH_RELOCATION_DISTANCE * directionX) / directionLength
  ));
  const z = Math.round(order.target.z + (
    (CAVE_SEARCH_RELOCATION_DISTANCE * directionZ) / directionLength
  ));
  return createCapabilityRequest('relocate_search_region', {
    x,
    y: order.target.y,
    z,
    closeness: 8,
    minimumDisplacement: 16,
    dimension: checkpoint.homeDimension,
  }, {
    nextPhase: 'execute',
    code: 'mining_region_relocation',
    target: { name: 'mining_search_region', x, y: order.target.y, z },
    keepAnchor: true,
    recoveryAction: true,
    checkpointOnSuccess: {
      ...checkpoint,
      miningRegionRelocations: completed + 1,
      miningRelocationPending: false,
      corridorSearchLegs: 0,
      miningReturnRoute: [],
    },
  });
}

function collectionStep(order, snapshot) {
  return createCapabilityRequest('collect_exposed_ore', {
    home: order.target,
    range: Math.min(48, order.constraints?.maxDistance || 48),
    excludedTargets: order.checkpoint?.failedTargets || [],
    targets: outstandingOreSources(snapshot, order.checkpoint),
  }, {
    methodKey: 'collect:exposed_ore->ores',
    nextPhase: 'execute',
    code: 'exposed_ore_collection',
    target: { name: 'ores' },
  });
}

function miningCorridorStep(order, snapshot) {
  const manifest = collectedManifest(snapshot, order.checkpoint);
  const collected = familyTotal(Object.fromEntries(
    manifest.map(entry => [entry.item, entry.quantity]),
  ));
  const missingRequirements = outstandingRequirements(snapshot, order.checkpoint);
  if (missingRequirements.length === 0 && collected >= order.quota) {
    return {
      phase: 'deliver',
      code: 'expedition_required_outputs_met',
      checkpoint: {
        ...order.checkpoint,
        collectedManifest: manifest,
        deliveryIndex: 0,
        deliveryOffset: 0,
      },
    };
  }
  const requirement = missingRequirements[0] || order.checkpoint.requiredOutputs?.[0];
  if (!requirement) {
    return {
      terminal: true,
      code: 'mining_strategy_unavailable',
      detail: 'The corridor strategy has no typed resource requirement to pursue.',
      retryable: false,
    };
  }
  const knowledge = miningKnowledge(requirement.source);
  if (!knowledge || knowledge.dimension !== order.checkpoint.homeDimension) {
    return {
      terminal: true,
      code: 'mining_strategy_unavailable',
      detail: `No deterministic mining-depth strategy is registered for ${requirement.source}.`,
      retryable: false,
    };
  }
  const currentRequirementProgress = requirementProgress(
    snapshot,
    order.checkpoint,
    requirement,
  );
  if (
    order.checkpoint?.corridorRequirementItem !== requirement.item
    || currentRequirementProgress > (
      Number(order.checkpoint?.corridorRequirementProgress) || 0
    )
  ) {
    return {
      phase: 'execute',
      code: order.checkpoint?.corridorRequirementItem === requirement.item
        ? 'expedition_corridor_output_progressed'
        : 'expedition_corridor_requirement_changed',
      checkpoint: {
        ...order.checkpoint,
        corridorRequirementItem: requirement.item,
        corridorRequirementProgress: currentRequirementProgress,
        corridorSearchLegs: 0,
      },
    };
  }
  const depthTarget = downwardMiningDepthTarget(knowledge, snapshot.y, 8);
  if (depthTarget !== null) {
    return createCapabilityRequest('reach_mining_depth', {
      targetY: depthTarget,
      range: Math.min(128, order.constraints?.maxDistance || 64),
      preservedReturnRoute: order.checkpoint?.miningReturnRoute || [],
    }, {
      methodKey: `navigate:mining_depth->${requirement.source}`,
      nextPhase: 'execute',
      code: 'expedition_mining_depth',
      target: { name: requirement.source, y: depthTarget },
      keepAnchor: true,
    });
  }
  const completedLegs = Math.max(0, Number(order.checkpoint?.corridorSearchLegs) || 0);
  if (completedLegs >= MAX_MINING_CORRIDOR_LEGS) {
    const partial = bestEffortDelivery(
      order,
      snapshot,
      'expedition_best_effort_corridor_complete',
    );
    if (partial) return partial;
    return {
      terminal: true,
      code: 'mining_corridor_exhausted',
      detail: `The bounded deterministic corridor produced no ${requirement.item} after ${completedLegs} verified legs.`,
      retryable: false,
    };
  }
  return createCapabilityRequest('advance_mining_corridor', {
    source: requirement.source,
    output: miningOutputName(requirement.source),
    length: MINING_CORRIDOR_LENGTH,
    preservedReturnRoute: order.checkpoint?.miningReturnRoute || [],
    excludedTargets: workOrderCollectionExclusions(order),
  }, {
    methodKey: `collect:mining_corridor->${requirement.item}`,
    nextPhase: 'execute',
    code: 'expedition_mining_corridor',
    target: { name: requirement.source },
    keepAnchor: true,
    checkpointOnSuccess: {
      ...order.checkpoint,
      corridorSearchLegs: completedLegs + 1,
      corridorRequirementItem: requirement.item,
      corridorRequirementProgress: currentRequirementProgress,
    },
  });
}

function executionStep(order, snapshot, planItem) {
  const checkpoint = order.checkpoint || {};
  if (checkpoint.acquisitionStrategy === 'mining_corridor') {
    return miningCorridorStep(order, snapshot);
  }
  if (!checkpoint.caveLit) {
    // Cave-lighting can consume its last torch before a bounded failure. A
    // resumed order must prove its supplies again instead of blindly replaying
    // the physical capability with a now-false precondition.
    const prerequisite = prerequisiteStep(order, planItem);
    return prerequisite || caveSurveyStep(order);
  }
  const manifest = collectedManifest(snapshot, checkpoint);
  if (
    familyTotal(Object.fromEntries(manifest.map(entry => [entry.item, entry.quantity]))) >= order.quota
    && requiredOutputsSatisfied(snapshot, checkpoint)
  ) {
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
  return collectionStep(order, snapshot);
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
  const returnRoute = checkpoint.miningReturnRoute || [];
  const returnIndex = Number.isFinite(checkpoint.miningReturnIndex)
    ? Math.min(returnRoute.length - 1, Math.floor(checkpoint.miningReturnIndex))
    : returnRoute.length - 1;
  if (distanceToHome(order, snapshot) > 3 && returnIndex >= 0) {
    const cell = returnRoute[returnIndex];
    return createCapabilityRequest('traverse_mining_route_cell', {
      x: cell.x,
      y: cell.y,
      z: cell.z,
      dimension: checkpoint.homeDimension,
    }, {
      nextPhase: 'deliver',
      code: 'expedition_return_mining_route',
      target: { name: 'mining_return_cell', x: cell.x, y: cell.y, z: cell.z },
      keepAnchor: true,
      recoveryAction: true,
      checkpointOnSuccess: {
        ...checkpoint,
        miningReturnIndex: returnIndex - 1,
      },
    });
  }

  // A retained expedition is followed by its own durable player-relative
  // Agenda step. Once any destructive mining route has been retraced, that
  // step is the sole owner of finding the live requester. Do not make the
  // Explorer first chase a stale coordinate and then repeat the same trip to
  // the player.
  if (checkpoint.retainResults === true) {
    return {
      complete: true,
      code: 'expedition_results_retained',
      checkpoint: {
        ...checkpoint,
        collected: (checkpoint.collectedManifest || []).reduce((total, entry) => total + entry.quantity, 0),
      },
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
      recoveryAction: true,
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
  if (!checkpoint.homeDimension || (!checkpoint.containerName && checkpoint.retainResults !== true)) {
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
      if (checkpoint.acquisitionStrategy === 'mining_corridor') {
        const prerequisite = prerequisiteStep(order, planItem);
        if (prerequisite) return prerequisite;
        if (checkpoint.miningRelocationPending === true) {
          return miningRegionRelocationStep(order);
        }
        if (
          checkpoint.lastFailedTargetActionId
          && checkpoint.lastFailedTargetActionId === order.evidence?.actionId
        ) {
          // The physical adapter safely settled after rejecting one exact ore
          // approach. Its coordinate is already in failedTargets, so rebind a
          // different target instead of declaring the whole mining strategy
          // exhausted or relocating away from otherwise productive terrain.
          return executionStep({ ...order, phase: 'execute' }, snapshot, planItem);
        }
        const corridorFailure = /(?:corridor_search_exhausted|no_safe_depth_corridor|return_route_failed|stance_unverified|inventory_full|non_convergent_depth_route|preserved_route_endpoint_unreachable|open_route_settlement_failed)/
          .test(String(order.evidence?.code || ''));
        if (corridorFailure) {
          const partial = bestEffortDelivery(
            order,
            snapshot,
            'expedition_best_effort_corridor_complete',
          );
          if (partial) return partial;
        }
        if (/(?:corridor_search_exhausted|no_safe_depth_corridor)/.test(String(order.evidence?.code || ''))) {
          const completedRelocations = Math.max(
            0,
            Number(checkpoint.miningRegionRelocations) || 0,
          );
          if (completedRelocations < MAX_MINING_REGION_RELOCATIONS) {
            return {
              phase: 'recover',
              code: 'mining_region_change_planned',
              detail: 'The local mining corridor is unsafe or exhausted; returning through settled geometry and binding a different region.',
              checkpoint: {
                ...checkpoint,
                miningRelocationPending: true,
              },
            };
          }
          return {
            terminal: true,
            code: 'mining_strategy_exhausted',
            detail: order.evidence?.detail || 'The deterministic mining-corridor strategy cannot make safe progress from this region.',
            retryable: false,
          };
        }
        if (/(?:return_route_failed|stance_unverified|inventory_full|non_convergent_depth_route|preserved_route_endpoint_unreachable|open_route_settlement_failed)/.test(String(order.evidence?.code || ''))) {
          return {
            terminal: true,
            code: 'mining_strategy_exhausted',
            detail: order.evidence?.detail || 'The deterministic mining-corridor strategy cannot settle safely.',
            retryable: false,
          };
        }
        return executionStep({ ...order, phase: 'execute' }, snapshot, planItem);
      }
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
        const partial = bestEffortDelivery(order, snapshot);
        if (partial) return partial;
        return caveSearchRelocationStep(order, snapshot);
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
