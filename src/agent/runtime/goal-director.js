import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';

import { isStaleActivityState, staleActivityReason } from './activity-freshness.js';
import path from 'node:path';

import * as mc from '../../utils/mcdata.js';
import { getCommand, executeCommand as executeAgentCommand } from '../commands/index.js';
import { resolvePlayerTarget } from '../player-target.js';
import { writeJsonAtomicSync } from '../../utils/atomic-file.js';
import {
  actionResultTargetFailures,
  classifyMethodOutcome,
  isPreemption,
} from './action-result.js';
import {
  capabilityCommand,
  capabilityCommandName,
  createCapabilityPlanAction,
  createCapabilityRequest,
  executeCapabilityAction,
} from './capability-catalogue.js';
import {
  completionRequirementSatisfied,
  goalContractDescription,
  inventoryCountForGoalTarget,
  normalizeGoalContract,
} from './goal-contract.js';
import {
  buildPrerequisiteMethodFrontier,
  buildPrerequisitePlan,
  plannedInventoryCount,
} from './prerequisite-planner.js';
import { miningKnowledge } from './jobs/miner-plan.js';
import { loopEraseMiningRouteCells } from './mining-corridor-planner.js';
import { isSafeProcedureCommand, ProcedureStore } from './procedure-store.js';
import { qualifyStrategicBranch } from './strategic-branch-qualification.js';
import { isNightTime } from './survival-policy.js';
import {
  deliberateEntityHarvestCombatEnvironment,
  deliberateEntityHarvestTargetQualification,
  occupiesUsableSurfaceStance,
} from '../library/skills.js';
import { normalizeWorkstationTransactionReceipt } from './workstation-transaction.js';

const STORE_VERSION = 1;
const MAX_STORE_BYTES = 512 * 1024;
const SAFE_AGENT_NAME = /^[A-Za-z0-9_]{3,16}$/;
const SUCCESS_DELAY_MS = 100;
const RETRY_DELAY_MS = 750;
const PREEMPTION_RESUME_MS = 0;
const PLAYER_WAIT_MS = 5_000;
const TEMPORAL_FEASIBILITY_RECHECK_MS = 5_000;
const PLAYER_ANCHOR_MAX_AGE_MS = 15_000;
const DELIVERY_REACQUIRE_DISTANCE = 16;
const ENVIRONMENTAL_WAIT_COMPANION_DISTANCE = 6;
const ENVIRONMENTAL_WAIT_REQUESTER_THREAT_DISTANCE = 16;
const FAILED_TARGET_COOLDOWN_MS = 90_000;
const FAILED_TARGET_RETENTION_MS = 10 * 60_000;
const MAX_FAILED_TARGETS = 24;
const FAILED_TARGET_EXCLUSION_RADIUS = 4;
const MAX_MINING_RETURN_SEGMENT_CELLS = 16;
const SOURCE_ACCESS_RECHECK_DISTANCE = 2;
// Collection binds candidates inside a 64-block physical scan. A 32-block
// retreat leaves most of that candidate field unchanged, so repeated failures
// can spend the goal budget on the same contaminated region. Move one complete
// scan radius before rebinding; owned Pathfinder still enforces the action
// deadline, recent-region exclusions, and non-destructive movement policy.
const ACQUISITION_REGION_RELOCATION_DISTANCE = 32;
// How far a death may displace the companion before its goal stops being
// achievable from where it now stands.
//
// Anchored to what the goal will already travel of its own accord: it relocates
// ACQUISITION_REGION_RELOCATION_DISTANCE per hop, up to three hops, so ~96
// blocks is the furthest it ever voluntarily goes to do a job. Beyond that the
// journey has become the task. 128 leaves headroom over the distance it would
// choose while staying well inside "this is now its own expedition".
//
// Live 2026-08-16: the companion died mid-goal, respawned ~1,400 blocks away at
// world spawn, and resumed -- collecting near spawn and then attempting to walk
// back to the recipient across open ocean until it timed out and drowned. A
// player would have said "I died and I'm back at spawn", not set off silently.
const DEATH_RESUME_MAX_DISPLACEMENT = 128;
const UNDERGROUND_SURFACE_RECOVERY_Y = 48;
const SURFACE_ACCESS_TARGET_Y = 56;
// A failed target above ordinary block-interaction reach is not another local
// collection attempt. It is evidence that the current standing region cannot
// access the target and must first hand off to the shared surface capability.
// The old 12-block altitude cutoff stranded the bot 11 blocks below known
// trees and spent the whole productive budget repeating the same fuel action.
const MAX_LOCAL_VERTICAL_INTERACTION_REACH = 4.5;
// A concrete acquisition failure already excludes that source. Trying a
// second source with the same failure signature in the same search region
// spends productive budget without changing strategy; relocate once and let
// the next plan bind a genuinely different region instead.
const MAX_LOCAL_CONCRETE_TARGET_FAILURES = 1;
const MAX_LOCAL_MINING_TARGET_FAILURES = 4;
const MAX_MINING_RETURN_CELLS = 512;
const MINING_ROUTE_REJOIN_MAX_DISTANCE = 64;
const MINING_ROUTE_REJOIN_INDEX_SEPARATION = 8;
const TERMINAL_FRONTIER_SEARCHES = 12;
const TERMINAL_PHASES = new Set(['complete', 'failed', 'cancelled']);
const GOAL_ONLY_RECOVERY_COMMANDS = new Set(['!recoverDeathItems', '!goToPlayer']);
const INVALID_MINING_RETURN_CODES = new Set([
  'skill_return_route_support_changed',
  'skill_return_route_support_repair_failed',
  'skill_return_route_changed',
  'skill_return_route_liquid_risk',
  'skill_return_route_settlement_changed',
  'skill_route_step_not_reached',
  'skill_protected_block_in_route',
]);
const INVALID_MINING_RETURN_OUTCOMES = new Set([
  'return_route_support_changed',
  'return_route_support_repair_failed',
  'return_route_changed',
  'return_route_liquid_risk',
  'return_route_settlement_changed',
  'route_step_not_reached',
  'protected_block_in_route',
  'hazardous_block_in_route',
  'return_route_block_not_diggable',
  'return_route_geometry_limit',
  'return_route_repair_stance_missing',
  'return_route_geometry_not_cleared',
  'return_route_debris_unsettled',
  'return_route_debris_limit',
  'return_route_debris_not_cleared',
]);

function boundedText(value, maximum = 280, fallback = '') {
  return Array.from(String(value ?? fallback), character => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? ' ' : character;
  }).join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function commandName(command) {
  return String(command || '').match(/^![A-Za-z0-9_]+/)?.[0] || '';
}

function normalizedDimension(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^minecraft:/, '');
}

function normalizedPlayerName(value) {
  return String(value || '').trim().toLowerCase().replace(/^\./, '');
}

function playerNamesMatch(left, right) {
  const first = normalizedPlayerName(left);
  const second = normalizedPlayerName(right);
  return Boolean(first && second && first === second);
}

function physicalPosition(value) {
  if (!value || ![value.x, value.y, value.z].every(Number.isFinite)) return null;
  return { x: Number(value.x), y: Number(value.y), z: Number(value.z) };
}

function distanceBetween(left, right) {
  const first = physicalPosition(left);
  const second = physicalPosition(right);
  if (!first || !second) return Infinity;
  return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z);
}

function budgetedSubgoalCount(goal) {
  return (goal?.subgoals || []).filter(subgoal => subgoal.kind !== 'recover').length;
}

function actionResultEvidence(result) {
  return result?.evidence?.skill && typeof result.evidence.skill === 'object'
    ? result.evidence.skill
    : null;
}

function sameMiningRouteCell(left, right) {
  return Boolean(left && right && ['x', 'y', 'z'].every(axis => (
    Number.isFinite(left?.[axis])
    && Number.isFinite(right?.[axis])
    && Math.floor(left[axis]) === Math.floor(right[axis])
  )));
}

function checkpointWithVerifiedMiningRoute(checkpoint, result, bot) {
  const skill = actionResultEvidence(result);
  if (
    !['succeeded', 'failed', 'interrupted'].includes(result?.phase)
    || skill?.routeDigging !== true
    || skill?.returnable !== true
    || !Array.isArray(skill.returnRoute)
    || skill.returnRoute.length < 1
  ) return checkpoint;

  const incoming = loopEraseMiningRouteCells(
    skill.returnRoute,
    { limit: MAX_MINING_RETURN_CELLS },
  );
  if (incoming.length < 1) return checkpoint;

  const prior = Array.isArray(checkpoint?.miningReturnRoute)
    && Number(checkpoint?.miningReturnIndex) >= 0
    ? loopEraseMiningRouteCells(
        checkpoint.miningReturnRoute.slice(
          0,
          Math.min(
            checkpoint.miningReturnRoute.length,
            Math.floor(Number(checkpoint.miningReturnIndex)) + 1,
          ),
        ),
        { limit: MAX_MINING_RETURN_CELLS },
      )
    : [];
  // The return spine is a path, not a travel log. Revisiting any earlier cell
  // closes a loop, so erase that cycle before persisting the new frontier.
  // This retains the original exit and current endpoint without allowing
  // harmless backtracking to consume the entire bounded checkpoint.
  const combined = loopEraseMiningRouteCells(
    [...prior, ...incoming],
    { limit: MAX_MINING_RETURN_CELLS },
  );
  if (combined.length < 1) return checkpoint;
  const dimension = normalizedDimension(bot?.game?.dimension);
  return {
    ...checkpoint,
    miningReturnRoute: combined,
    miningReturnIndex: combined.length - 1,
    ...(dimension ? { miningReturnDimension: dimension } : {}),
  };
}

function checkpointAfterMiningReturnStep(checkpoint, result, actingSubgoal) {
  if (
    actingSubgoal?.kind !== 'recover'
    || result?.phase !== 'succeeded'
  ) return checkpoint;
  const route = checkpoint?.miningReturnRoute || [];
  const index = Number.isFinite(checkpoint?.miningReturnIndex)
    ? Math.min(route.length - 1, Math.floor(checkpoint.miningReturnIndex))
    : route.length - 1;
  if (index < 0) return checkpoint;
  if (
    actingSubgoal.commandName === '!goToCoordinates'
    && /^mining-route-rejoin:(?:[^:]+:)?\d+$/.test(String(actingSubgoal.learningKey || ''))
  ) {
    // Rejoining an earlier route cell during acquisition relocates the body;
    // it does not erase the still-valid forward suffix. Keep the endpoint
    // cursor so the next mining action traverses that known spine before
    // excavating again. A completed goal rewinds the cursor from live occupied
    // route state in update(), where return direction is known.
    return checkpoint;
  }
  if (actingSubgoal.commandName !== '!traverseMiningRouteCell') return checkpoint;
  const target = actionResultEvidence(result)?.target;
  const targetIndex = route.findLastIndex((cell, candidateIndex) => (
    candidateIndex <= index && sameMiningRouteCell(cell, target)
  ));
  if (targetIndex < 0) return checkpoint;
  return {
    ...checkpoint,
    miningReturnIndex: targetIndex - 1,
  };
}

function miningRouteIdentity(route, index) {
  const origin = route?.[0];
  const endpoint = route?.[index];
  if (
    !origin
    || !endpoint
    || ![origin.x, origin.y, origin.z, endpoint.x, endpoint.y, endpoint.z].every(Number.isFinite)
  ) return '';
  return `${index + 1}@${origin.x},${origin.y},${origin.z}@${endpoint.x},${endpoint.y},${endpoint.z}`;
}

function pendingMiningReturn(goal) {
  const route = goal?.checkpoint?.miningReturnRoute || [];
  const index = Number.isFinite(goal?.checkpoint?.miningReturnIndex)
    ? Math.min(route.length - 1, Math.floor(goal.checkpoint.miningReturnIndex))
    : route.length - 1;
  if (index < 0 || !route[index]) return null;
  const segmentEndIndex = Math.max(0, index - MAX_MINING_RETURN_SEGMENT_CELLS + 1);
  return {
    cell: route[segmentEndIndex],
    index: segmentEndIndex,
    startIndex: index,
    cells: index - segmentEndIndex + 1,
  };
}

function miningRouteRejoinDecision(goal, bot) {
  const route = goal?.checkpoint?.miningReturnRoute || [];
  const index = Number.isFinite(goal?.checkpoint?.miningReturnIndex)
    ? Math.min(route.length - 1, Math.floor(goal.checkpoint.miningReturnIndex))
    : route.length - 1;
  const position = physicalPosition(bot?.entity?.position);
  if (index < 0 || !position || route.length < 1) return null;
  const routeDimension = normalizedDimension(goal.checkpoint?.miningReturnDimension);
  const currentDimension = normalizedDimension(bot?.game?.dimension);
  if (routeDimension && currentDimension && routeDimension !== currentDimension) {
    return { state: 'dimension_changed', routeDimension, currentDimension };
  }
  const candidates = route
    .slice(0, index + 1)
    .map((cell, candidateIndex) => ({
      cell,
      index: candidateIndex,
      distance: distanceBetween(position, physicalPosition(cell)),
    }))
    .filter(candidate => Number.isFinite(candidate.distance))
    .sort((left, right) => left.distance - right.distance || right.index - left.index);
  const nearest = candidates[0];
  const occupied = candidates.find(candidate => sameMiningRouteCell(position, candidate.cell));
  if (occupied && occupied.index < index) {
    return { state: 'occupied', ...occupied };
  }
  if (!nearest || nearest.distance <= 4) return null;
  if (nearest.distance > MINING_ROUTE_REJOIN_MAX_DISTANCE) {
    return { state: 'out_of_range', distance: nearest.distance };
  }
  const routeIdentity = miningRouteIdentity(route, index);
  const learningKeyPrefix = routeIdentity
    ? `mining-route-rejoin:${routeIdentity}:`
    : '';
  const failedIndexes = (goal.subgoals || [])
    .filter(subgoal => (
      subgoal.kind === 'recover'
      && subgoal.commandName === '!goToCoordinates'
      && subgoal.state === 'failed'
      && learningKeyPrefix
      && String(subgoal.learningKey || '').startsWith(learningKeyPrefix)
    ))
    .map(subgoal => Number(String(subgoal.learningKey).split(':').at(-1)))
    .filter(Number.isFinite);
  const candidate = candidates.find(entry => (
    failedIndexes.every(failedIndex => (
      Math.abs(entry.index - failedIndex) >= MINING_ROUTE_REJOIN_INDEX_SEPARATION
    ))
  ));
  return candidate
    ? { state: 'ready', ...candidate }
    : { state: 'exhausted', distance: nearest.distance };
}

function capabilityRequiresSurface(step) {
  return step?.capability?.access?.requiresSurface === true;
}

function surfaceAccessConfirmedAfterMiningReturn(goal) {
  let lastReturnAt = 0;
  let lastSurfaceAt = 0;
  for (const subgoal of goal?.subgoals || []) {
    if (subgoal.state !== 'succeeded') continue;
    const finishedAt = Number(subgoal.finishedAt) || 0;
    if (subgoal.commandName === '!traverseMiningRouteCell') {
      lastReturnAt = Math.max(lastReturnAt, finishedAt);
    }
    if (
      subgoal.commandName === '!goToSurface'
      && ['skill_surface_reached', 'capability_effects_verified'].includes(subgoal.code)
    ) {
      lastSurfaceAt = Math.max(lastSurfaceAt, finishedAt);
    }
  }
  return lastSurfaceAt > lastReturnAt;
}

function repeatsRejectedDepthCapability(goal, step) {
  if (step?.capability?.id !== 'reach_mining_depth') return false;
  const latest = goal?.subgoals?.at(-1);
  return Boolean(
    latest?.kind === 'plan'
    && latest.state === 'failed'
    && latest.commandName === '!goToMiningDepth'
    && [
      'skill_no_safe_depth_corridor',
      'skill_no_stable_staging_cell',
      'skill_staging_unreachable',
      'skill_origin_support_unsafe',
    ].includes(latest.code)
  );
}

function goalOutputReadyForHandoff(bot, goal) {
  if (!goal) return false;
  if (goal.kind === 'deliver') {
    const delivered = Math.max(0, Number(goal.checkpoint?.delivered) || 0);
    if (delivered >= goal.quantity) return true;
    return inventoryCountForGoalTarget(bot, goal.target) >= Math.max(0, goal.quantity - delivered);
  }
  return inventoryCountForGoalTarget(bot, goal.target) >= goal.checkpoint.targetInventory
    && completionRequirementSatisfied(bot, goal.target, goal.completion);
}

function verifiedMiningRouteProgress(kind, skill) {
  return Boolean(
    kind === 'plan'
    && (
      (
        skill?.kind === 'mining_search'
        && skill?.outcome === 'search_advanced'
        && skill?.routeDigging === true
        && skill?.returnable === true
        && Number(skill?.routeSteps) > 0
        && [
          skill?.target?.x,
          skill?.target?.y,
          skill?.target?.z,
          skill?.observedPosition?.x,
          skill?.observedPosition?.y,
          skill?.observedPosition?.z,
        ].every(Number.isFinite)
      )
      || (
        skill?.kind === 'mining_relocation'
        && skill?.outcome === 'no_safe_depth_corridor'
        && skill?.routeDigging === true
        && skill?.geometryChanged === true
        && skill?.returnable === true
        && Number(skill?.excavated) > 0
      )
    )
  );
}

function verifiedSurfaceRecoveryProgress(kind, skill) {
  return Boolean(
    kind === 'recover'
    && skill?.kind === 'surface_navigation'
    && skill?.supported === true
    && (
      Number(skill?.verticalProgress) >= 1
      || (
        skill?.routeDigging === true
        && Number(skill?.excavated) > 0
      )
    )
  );
}

function collectionSourceMatches(requestedName, targetName) {
  const normalized = value => String(value || '').trim().toLowerCase();
  const base = value => normalized(value).replace(/^deepslate_/, '');
  const requested = normalized(requestedName);
  const target = normalized(targetName);
  return Boolean(requested && target && (
    requested === target
    || base(requested) === base(target)
  ));
}

function concreteCollectionTargetsMatch(left, right) {
  if (!left || !right || !collectionSourceMatches(left.name, right.name)) return false;
  const leftPosition = left.position || left;
  const rightPosition = right.position || right;
  return ['x', 'y', 'z'].every(axis => (
    Number.isFinite(leftPosition?.[axis])
    && Number.isFinite(rightPosition?.[axis])
    && Math.floor(leftPosition[axis]) === Math.floor(rightPosition[axis])
  ));
}

function resultRejectsCollectionTarget(result, target) {
  return actionResultTargetFailures(result).some(failure => (
    concreteCollectionTargetsMatch(failure, target)
  ));
}

export class GoalStateStore {
  constructor(agentName, { root = './bots' } = {}) {
    if (!SAFE_AGENT_NAME.test(String(agentName || ''))) {
      throw new TypeError('Goal-state bot name is invalid.');
    }
    this.directory = path.resolve(root, agentName);
    this.filePath = path.join(this.directory, 'goal-state.json');
    this.lastError = null;
    mkdirSync(this.directory, { recursive: true });
  }

  load({ allowStaleActiveGoal = false } = {}) {
    this.lastError = null;
    if (!existsSync(this.filePath)) return { activeGoal: null, lastGoal: null, protectedGoalId: null };
    try {
      if (statSync(this.filePath).size > MAX_STORE_BYTES) {
        throw new TypeError('Goal-state file exceeds the size limit.');
      }
      const document = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (document?.version !== STORE_VERSION) {
        throw new TypeError(`Unsupported goal-state version '${document?.version}'.`);
      }
      // An active goal is in-flight activity and expires with the session;
      // lastGoal / protectedGoalId are completion history and are preserved.
      const activeGoalStale = document.activeGoal && isStaleActivityState(document.savedAt);
      const lifecycleResumeAuthorized = Boolean(
        activeGoalStale
        && allowStaleActiveGoal === true
        && Number.isFinite(Number(document.savedAt))
        && Number(document.savedAt) > 0
      );
      if (activeGoalStale && !lifecycleResumeAuthorized) {
        this.lastError = staleActivityReason('goal state', document.savedAt);
      }
      const activeGoal = document.activeGoal && (!activeGoalStale || lifecycleResumeAuthorized)
        ? normalizeGoalContract(document.activeGoal)
        : null;
      const lastGoal = document.lastGoal ? normalizeGoalContract(document.lastGoal) : null;
      const protectedGoalId = boundedText(document.protectedGoalId, 96) || null;
      return {
        activeGoal,
        lastGoal,
        protectedGoalId: lastGoal?.phase === 'complete' && protectedGoalId === lastGoal.id
          ? protectedGoalId
          : null,
      };
    } catch (error) {
      this.lastError = boundedText(error?.message || error);
      return { activeGoal: null, lastGoal: null, protectedGoalId: null };
    }
  }

  save(activeGoal, lastGoal, protectedGoalId = null) {
    const normalizedActive = activeGoal ? normalizeGoalContract(activeGoal) : null;
    const normalizedLast = lastGoal ? normalizeGoalContract(lastGoal) : null;
    const normalizedProtectedGoalId = normalizedLast?.phase === 'complete'
      && boundedText(protectedGoalId, 96) === normalizedLast.id
      ? normalizedLast.id
      : null;
    writeJsonAtomicSync(this.filePath, {
      version: STORE_VERSION,
      activeGoal: normalizedActive,
      lastGoal: normalizedLast,
      protectedGoalId: normalizedProtectedGoalId,
      savedAt: Date.now(),
    });
    this.lastError = null;
  }
}

function restoredGoal(goal) {
  if (!goal || TERMINAL_PHASES.has(goal.phase)) return null;
  const now = Date.now();
  const interrupted = [...goal.subgoals]
    .reverse()
    .find(subgoal => subgoal.state === 'acting') || null;
  return normalizeGoalContract({
    ...goal,
    // Fresh Minecraft state must always be verified after restart. A recovery
    // subgoal is historical evidence, not a command to replay. Re-enter the
    // causal assessment owner for every ordinary restored goal; it can inspect
    // the last productive failure, current inventory, the preserved mining
    // route, and live world state before selecting either recovery or work.
    phase: 'assess',
    subgoals: goal.subgoals.map(subgoal => (
      subgoal.state === 'acting'
        ? {
          ...subgoal,
          state: 'cancelled',
          code: 'restart_revalidation',
          detail: 'In-flight subgoal was cancelled by restart and will be revalidated.',
          finishedAt: now,
        }
        : subgoal
    )),
    evidence: {
      actionId: '',
      phase: 'assess',
      code: 'restart_revalidation',
      detail: 'Restored goal requires fresh Minecraft-state verification before causal replanning.',
      verified: false,
      at: now,
    },
    updatedAt: now,
  });
}

function recoverMisclassifiedSurfacePreemption(goal, now = Date.now()) {
  if (
    goal?.phase !== 'failed'
    || goal.evidence?.code !== 'mining_region_surface_staging_failed'
    || Number(goal.attempts) >= Number(goal.maxAttempts)
  ) return null;
  const interruptedSurface = [...(goal.subgoals || [])].reverse().find(subgoal => (
    subgoal.kind === 'recover'
    && subgoal.commandName === '!goToSurface'
    && String(subgoal.learningKey || '').startsWith('mining-region-surface:')
  ));
  if (
    interruptedSurface?.state !== 'failed'
    || !isPreemption({ phase: 'failed', code: interruptedSurface.code })
  ) return null;
  return normalizeGoalContract({
    ...goal,
    phase: 'recover',
    evidence: {
      actionId: interruptedSurface.actionId || '',
      phase: 'recover',
      code: 'restart_preemption_recovered',
      detail: 'The prior surface staging was interrupted by higher-priority control, not terminally failed; resuming the exact Goal from fresh Minecraft state.',
      verified: false,
      retryable: true,
      at: now,
    },
    updatedAt: now,
  });
}

function preferredProcedureCommand(procedure, kind) {
  return procedure?.steps?.find(step => step.kind === kind && isSafeProcedureCommand(step.commandName))?.commandName || null;
}

function acquisitionCommand(goal, remaining, procedure) {
  const target = goal.target;
  const preferred = preferredProcedureCommand(procedure, 'acquire');
  const count = Math.max(1, Math.min(64, remaining));
  const range = 64;
  if (target.acquisitionKind === 'collect_family') {
    const selected = preferred === '!collectWoodInRange' ? preferred : '!collectWoodInRange';
    return `${selected}(${count}, ${range})`;
  }
  if (target.acquisitionKind === 'collect_block') {
    const selected = preferred === '!collectBlocksInRange' ? preferred : '!collectBlocksInRange';
    return `${selected}(${JSON.stringify(target.acquisitionName)}, ${count}, ${range})`;
  }
  if (target.acquisitionKind === 'prepare_material') {
    const selected = preferred === '!prepareMaterial' ? preferred : '!prepareMaterial';
    return `${selected}(${JSON.stringify(target.family || target.acquisitionName)}, ${remaining}, ${range})`;
  }
  if (target.acquisitionKind === 'prepare_tool') {
    const selected = preferred === '!prepareTool' ? preferred : '!prepareTool';
    return `${selected}(${JSON.stringify(target.acquisitionName)})`;
  }
  if (target.acquisitionKind === 'craft') {
    const selected = preferred === '!craftRecipe' ? preferred : '!craftRecipe';
    return `${selected}(${JSON.stringify(target.acquisitionName)}, ${remaining})`;
  }
  return null;
}

function deliveryAction(goal, remaining) {
  if (goal.target.family) {
    return createCapabilityRequest('deliver_item_family', {
      player: goal.destination.player,
      family: goal.target.family,
      quantity: remaining,
    });
  }
  return createCapabilityRequest('deliver_exact_item', {
    player: goal.destination.player,
    item: goal.target.inventoryName,
    quantity: remaining,
  });
}

function needsSurfaceRecovery(goal, bot) {
  const dimension = String(bot?.game?.dimension || '').replace(/^minecraft:/, '');
  const y = Number(bot?.entity?.position?.y);
  const latestSubgoal = goal?.subgoals?.at(-1);
  const latestPlan = latestFailedPlanSubgoal(goal);
  const hasVerifiedMiningReturn = Boolean(pendingMiningReturn(goal));
  const miningReturnRoute = goal?.checkpoint?.miningReturnRoute;
  const exhaustedVerifiedMiningReturn = Boolean(
    Array.isArray(miningReturnRoute)
    && miningReturnRoute.length > 0
    && Number(goal?.checkpoint?.miningReturnIndex) === -1
  );
  const undergroundResourceMissOnVerifiedRoute = Boolean(
    hasVerifiedMiningReturn
    && /(?:resource_not_found|search_exhausted)/.test(String(latestPlan?.code || ''))
  );
  // Once a concrete acquisition failure has handed control to surface
  // recovery, the persisted recovery subgoal is the durable latch. Altitude
  // heuristics may start that recovery, but only Minecraft-verified arrival at
  // a literal surface stance may release it. Recomputing the original vertical
  // gap after each safe stair step used to resume collection a few blocks below
  // the tree and let its ordinary route dive back through the mine.
  const surfaceRecoveryLatched = Boolean(
    latestSubgoal?.kind === 'recover'
    && latestSubgoal.commandName === '!goToSurface'
    && latestSubgoal.code !== 'skill_surface_reached'
    && !undergroundResourceMissOnVerifiedRoute
  );
  const code = `${goal?.evidence?.code || ''} ${latestPlan?.code || ''}`;
  const treeTerrainSettlementPending = /tree_terrain_settlement_unverified/.test(code);
  const failedTarget = latestPlanFailedTarget(goal);
  const targetY = Number(failedTarget?.position?.y);
  const targetAboveLocalInteraction = (
    Number.isFinite(targetY)
    && targetY - y > MAX_LOCAL_VERTICAL_INTERACTION_REACH
  );
  const failedAboveGroundAccess = (
    /(?:unreachable|no_path|path_|stuck)/.test(code)
    && Number.isFinite(targetY)
    && targetY >= SURFACE_ACCESS_TARGET_Y
    && targetAboveLocalInteraction
  );
  const undergroundDeliveryRouteBlocked = Boolean(
    goal?.kind === 'deliver'
    && y < UNDERGROUND_SURFACE_RECOVERY_Y
    && /(?:unreachable|no_path|path_|stuck)/.test(code)
  );
  const invalidatedMiningReturn = /mining_return_route_invalidated/.test(code);
  return dimension === 'overworld'
    && Number.isFinite(y)
    && (
      surfaceRecoveryLatched
      || treeTerrainSettlementPending
      ||
      (
        y < UNDERGROUND_SURFACE_RECOVERY_Y
        && /(?:resource_not_found|search_exhausted)/.test(code)
        && !hasVerifiedMiningReturn
      )
      || (y < UNDERGROUND_SURFACE_RECOVERY_Y && exhaustedVerifiedMiningReturn)
      || invalidatedMiningReturn
      || failedAboveGroundAccess
      || undergroundDeliveryRouteBlocked
    );
}

function hasPendingDeathItems(memoryBank, recordedAt) {
  if (!Number.isSafeInteger(recordedAt) || recordedAt < 1) return false;
  const death = memoryBank?.recallDeath?.(recordedAt);
  if (!death || death.recoveredAt) return false;
  return Object.values(death.inventory || {}).some(count => Number(count) > 0);
}

/**
 * Where the goal has to end up: the recipient for a delivery, otherwise the
 * requester. Returns null when no anchor can be observed -- an unknown anchor
 * must not be read as "too far", or a goal would be abandoned on missing
 * evidence rather than on distance.
 */
function goalAnchorPosition(goal, bot) {
  const name = goal?.destination?.kind === 'player'
    ? goal.destination.player
    : goal?.requester;
  if (!name) return null;
  const entity = bot?.players?.[name]?.entity;
  const position = entity?.position;
  if (!position || ![position.x, position.y, position.z].every(Number.isFinite)) return null;
  return position;
}

/**
 * After a death, is the goal still achievable from where the companion now
 * stands? Only ever answers true when both positions are observed: an unknown
 * distance leaves the goal alone.
 */
export function deathDisplacedGoalBeyondReach(goal, bot, maxDisplacement = DEATH_RESUME_MAX_DISPLACEMENT) {
  if (String(goal?.evidence?.code || '') !== 'goal_owner_died') return false;
  const anchor = goalAnchorPosition(goal, bot);
  const here = bot?.entity?.position;
  if (!anchor || !here || ![here.x, here.y, here.z].every(Number.isFinite)) return false;
  const displacement = Math.hypot(here.x - anchor.x, here.y - anchor.y, here.z - anchor.z);
  return Number.isFinite(displacement) && displacement > maxDisplacement;
}

function recoveryCommand(goal, bot, memoryBank = null) {
  const code = String(goal.evidence?.code || '');
  const deathRecordedAt = Number(goal.memory?.deathRecovery?.recordedAt);
  if (code === 'goal_owner_died' && hasPendingDeathItems(memoryBank, deathRecordedAt)) {
    return `!recoverDeathItems(${deathRecordedAt})`;
  }
  if (needsSurfaceRecovery(goal, bot)) return '!goToSurface';
  if (
    /(?:not_found|no_safe|unreachable|search|resource|no_path|path_|stuck)/.test(code)
    && !/(?:missing_material|missing_item|missing_tool|invalid_|table_unreachable|furnace_unreachable)/.test(code)
  ) {
    return `!moveAway(${ACQUISITION_REGION_RELOCATION_DISTANCE}, true)`;
  }
  return null;
}

function plannedDisengagementCommand(goal, bot) {
  const code = String(goal.evidence?.code || '');
  if (needsSurfaceRecovery(goal, bot)) return '!goToSurface';
  // A verified mining-return route means the body is already inside one
  // bounded, recoverable acquisition region. `moveAway(..., true)` searches
  // for a distinct loaded surface region; issuing it from the corridor turns
  // one rejected ore body into an unrelated and usually impossible locomotion
  // problem. Failed-target memory already excludes the exact source, so keep
  // the body on its proven route and let assessment bind another source from
  // live underground state.
  if (pendingMiningReturn(goal)) return null;
  // A failed natural-ore coordinate is a mining-strategy signal, not evidence
  // that the whole acquisition region is bad. Keep the body underground and
  // let the exclusion-aware prerequisite planner hand off to the depth/corridor
  // spine once local exact candidates are exhausted. Surface relocation here
  // discarded the useful descent and recreated the same ore search elsewhere.
  const failedMiningTarget = latestPlanFailedTarget(goal);
  if (failedMiningTarget?.name && miningKnowledge(failedMiningTarget.name)) return null;
  if (
    goal.subgoals.at(-1)?.kind === 'plan'
    && /(?:source_not_found|resource_not_found|search_exhausted)/.test(code)
  ) return `!moveAway(${ACQUISITION_REGION_RELOCATION_DISTANCE}, true)`;
  if (
    goal.subgoals.at(-1)?.kind === 'plan'
    && /(?:path_stalled|path_timeout|unreachable|no_path|not_collected|not_broken|timeout|action_deadline)/.test(code)
  ) return `!moveAway(${ACQUISITION_REGION_RELOCATION_DISTANCE}, true)`;
  return null;
}

function latestFailedPlanSubgoal(goal) {
  return [...(goal?.subgoals || [])]
    .reverse()
    .find(subgoal => subgoal.kind === 'plan' && subgoal.state === 'failed') || null;
}

function latestPlanFailedTarget(goal) {
  const subgoal = latestFailedPlanSubgoal(goal);
  if (!subgoal) return null;
  return (goal.memory?.failedTargets || [])
    .filter(target => (
      target.kind === 'collect'
      && target.lastFailedAt >= Math.max(0, Number(subgoal.finishedAt) || 0)
    ))
    .sort((left, right) => right.lastFailedAt - left.lastFailedAt)[0] || null;
}

function latestPlanFailureHasConcreteTarget(goal) {
  return Boolean(latestPlanFailedTarget(goal));
}

function consecutiveLocalPlanFailures(goal) {
  const subgoals = goal?.subgoals || [];
  const latest = subgoals.at(-1);
  if (latest?.kind !== 'plan' || latest.state !== 'failed' || !latest.targetName) return 0;

  let failures = 0;
  for (let index = subgoals.length - 1; index >= 0; index -= 1) {
    const subgoal = subgoals[index];
    // Any bounded relocation is the boundary between search regions. A failed
    // relocation is also a boundary so the same movement cannot be issued
    // repeatedly without fresh productive evidence.
    if (subgoal.kind === 'recover') break;
    if (subgoal.kind !== 'plan' || subgoal.targetName !== latest.targetName) break;
    if (subgoal.state !== 'failed') break;
    failures += 1;
  }
  return failures;
}

function plannerFailureScope(result) {
  if (classifyMethodOutcome(result) !== 'method_failure') return null;
  if (actionResultTargetFailures(result).length > 0) return 'target';
  const skill = actionResultEvidence(result);
  if (skill?.toolRequirement || skill?.workstationRequirement || skill?.accessRequirement) {
    return 'prerequisite';
  }
  if (skill?.outcome === 'tree_terrain_settlement_unverified') return 'region';
  if (skill?.kind === 'mining_relocation') return 'region';
  return 'method';
}

function legacyPlannerFailureScope(goal, subgoal, index) {
  if (subgoal.failureScope) return subgoal.failureScope;
  if (
    subgoal.commandName === '!goToMiningDepth'
    && /(?:no_safe_depth_corridor|no_stable_staging_cell|staging_unreachable|origin_support_unsafe)/
      .test(String(subgoal.code || ''))
  ) return 'region';
  const finishedAt = Number(subgoal.finishedAt);
  const nextStartedAt = Number(goal?.subgoals?.[index + 1]?.startedAt);
  if (
    Number.isFinite(finishedAt)
    && (goal?.memory?.failedTargets || []).some(target => (
      Number(target.lastFailedAt) >= finishedAt
      && (!Number.isFinite(nextStartedAt) || Number(target.lastFailedAt) <= nextStartedAt)
    ))
  ) return 'target';
  return 'method';
}

function pendingMiningRegionRecovery(goal) {
  const subgoals = goal?.subgoals || [];
  const lastRelocationIndex = subgoals.findLastIndex(subgoal => (
    subgoal.kind === 'recover'
    && String(subgoal.learningKey || '').startsWith('mining-region-relocation:')
  ));
  const lastRelocation = subgoals[lastRelocationIndex] || null;
  if (lastRelocation?.state === 'failed') {
    return { state: 'failed', failure: lastRelocation };
  }
  const regionStartIndex = lastRelocationIndex + 1;
  const lastSurfaceStaging = subgoals.findLast(subgoal => (
    subgoal.kind === 'recover'
    && String(subgoal.learningKey || '').startsWith('mining-region-surface:')
  ));
  if (
    lastSurfaceStaging?.state === 'failed'
    && !isPreemption({ phase: 'failed', code: lastSurfaceStaging.code })
  ) {
    return { state: 'surface_failed', failure: lastSurfaceStaging };
  }
  let regionalFailureIndex = -1;
  let localMiningFailures = 0;
  for (let index = subgoals.length - 1; index >= regionStartIndex; index -= 1) {
    const subgoal = subgoals[index];
    if (
      subgoal.kind === 'plan'
      && subgoal.state === 'failed'
      && subgoal.commandName === '!goToMiningDepth'
      && legacyPlannerFailureScope(goal, subgoal, index) === 'region'
    ) {
      regionalFailureIndex = index;
      break;
    }
    if (subgoal.kind !== 'plan' || subgoal.state === 'cancelled') continue;
    if (subgoal.state === 'succeeded') break;
    const collection = /^collect:([^>]+)->[a-z0-9_]+$/.exec(String(subgoal.learningKey || ''));
    if (
      subgoal.state === 'failed'
      && legacyPlannerFailureScope(goal, subgoal, index) === 'target'
      && collection
      && miningKnowledge(collection[1])
    ) {
      localMiningFailures += 1;
      if (localMiningFailures >= MAX_LOCAL_MINING_TARGET_FAILURES) {
        regionalFailureIndex = index;
        break;
      }
      continue;
    }
    break;
  }
  if (regionalFailureIndex < 0) return null;
  return {
    state: goal.attempts >= goal.maxAttempts ? 'exhausted' : 'pending',
    failure: subgoals[regionalFailureIndex],
  };
}

export function failedPlannerMethodExclusions(goal, threshold = 2) {
  const signatures = new Map();
  const excluded = new Set();
  const clearMethod = learningKey => {
    for (const signature of [...signatures.keys()]) {
      if (signature.startsWith(`${learningKey}\u0000`)) signatures.delete(signature);
    }
    excluded.delete(learningKey);
  };
  const clearAcquisitionForTarget = targetName => {
    const target = String(targetName || '').trim().toLowerCase();
    if (!target) return;
    const ownsTarget = learningKey => (
      /^(collect|harvest):/.test(learningKey)
      && learningKey.endsWith(`->${target}`)
    );
    for (const signature of [...signatures.keys()]) {
      const separator = signature.indexOf('\u0000');
      const learningKey = separator >= 0 ? signature.slice(0, separator) : signature;
      if (ownsTarget(learningKey)) signatures.delete(signature);
    }
    for (const learningKey of [...excluded]) {
      if (ownsTarget(learningKey)) excluded.delete(learningKey);
    }
  };
  for (const [index, subgoal] of (goal?.subgoals || []).entries()) {
    if (
      subgoal.kind === 'plan'
      && subgoal.state === 'succeeded'
      && subgoal.learningKey
    ) {
      // A succeeded plan action has already passed its capability verifier;
      // inventory is only one possible material effect. World construction,
      // returnable access, and source creation must clear the same method's
      // earlier no-progress streak too.
      clearMethod(subgoal.learningKey);
      if (/^skill_[a-z0-9_]+_source_created$/.test(String(subgoal.code || ''))) {
        // Production changes the premise of earlier "resource not found"
        // failures. Re-enable collection for that target immediately so a
        // producer/collector composition cannot suppress its own second half.
        clearAcquisitionForTarget(subgoal.targetName);
      }
      continue;
    }
    if (
      subgoal.kind !== 'plan'
      || subgoal.state !== 'failed'
      || !subgoal.learningKey
      || subgoal.targetInventoryAfter > subgoal.targetInventoryBefore
      || isPreemption({ phase: 'failed', code: subgoal.code })
      || classifyMethodOutcome({ phase: 'failed', code: subgoal.code }) !== 'method_failure'
      || legacyPlannerFailureScope(goal, subgoal, index) !== 'method'
    ) continue;
    const signature = `${subgoal.learningKey}\u0000${subgoal.code || 'unknown'}`;
    const failures = (signatures.get(signature) || 0) + 1;
    signatures.set(signature, failures);
    if (failures >= threshold) excluded.add(subgoal.learningKey);
  }
  return [...excluded];
}

function sourceHarvestReplayDescriptor(goal) {
  const pending = goal?.memory?.sourceAccessPending || goal?.memory?.sourceSearchPending;
  if (!pending) return null;
  if (pending.replay) return pending.replay;

  // Compatibility for access receipts written before replay metadata existed.
  // The persisted subgoal still owns the method/output identity; only the
  // historical bounded range falls back to the GoalDirector's standard 64.
  const subgoal = [...(goal?.subgoals || [])]
    .reverse()
    .find(entry => (
      entry.kind === 'plan'
      && entry.state === 'failed'
      && entry.code === 'skill_source_access_pending'
      && entry.learningKey
    ));
  const match = /^harvest:(kill|shear):([a-z0-9_]+)->([a-z0-9_]+)$/.exec(
    String(subgoal?.learningKey || ''),
  );
  if (!match || match[2] !== pending.source) return null;
  const expectedIncrease = Math.max(1, Math.min(64, Math.floor(Number(subgoal.expectedIncrease) || 1)));
  return Object.freeze({
    source: match[2],
    output: match[3],
    method: match[1],
    count: expectedIncrease,
    range: 64,
    allowAlternative: false,
    expectedIncrease,
    learningKey: subgoal.learningKey,
    reason: subgoal.reason || `${match[2]} is the persisted source for ${match[3]}.`,
  });
}

function sourceHarvestReplayStep(bot, goal, targetEntityId = null) {
  const replay = sourceHarvestReplayDescriptor(goal);
  if (!replay) return null;
  try {
    return createCapabilityPlanAction('harvest_entity_drop', {
      source: replay.source,
      output: replay.output,
      method: replay.method,
      count: replay.count,
      range: replay.range,
      allowAlternative: replay.allowAlternative,
      targetEntityId,
      expectedIncrease: replay.expectedIncrease,
    }, {
      kind: 'harvest_entity',
      target: replay.output,
      expectedName: replay.output,
      expectedIncrease: replay.expectedIncrease,
      reason: replay.reason,
      learningKey: replay.learningKey,
    }, { bot });
  } catch {
    return null;
  }
}

function sourceHarvestReplayFromSettlement(result, actingSubgoal, skill) {
  const requestArgs = Array.isArray(result?.evidence?.request?.args)
    ? result.evidence.request.args
    : [];
  const expectedIncrease = Math.max(
    1,
    Math.min(64, Math.floor(Number(actingSubgoal?.expectedIncrease) || 1)),
  );
  return Object.freeze({
    source: skill?.target?.source || skill?.sourceAccess?.source || requestArgs[0],
    output: skill?.target?.output || actingSubgoal?.targetName || requestArgs[1],
    method: skill?.target?.method || requestArgs[2],
    count: requestArgs[3] ?? expectedIncrease,
    range: requestArgs[4] ?? 64,
    allowAlternative: requestArgs[5] === true,
    expectedIncrease,
    learningKey: actingSubgoal?.learningKey || '',
    reason: actingSubgoal?.reason || '',
  });
}

function terminalBlockerClassification(boundary, goal, plan = null) {
  const evidenceCode = boundedText(goal?.evidence?.code, 80, 'unknown');
  const blockerCode = boundedText(
    boundary === 'causal_plan_blocked' ? plan?.code || evidenceCode : evidenceCode,
    80,
    'unknown',
  );
  const combinedCode = `${blockerCode} ${evidenceCode}`;
  const memory = goal?.memory || {};
  const failedTargets = memory.failedTargets || [];
  const hasRegisteredPrerequisite = Boolean(
    memory.toolRequirement
    || memory.workstationRequirement
    || memory.accessRequirement
  );

  if (/(?:ambiguous|clarification|permission|substitut|player_absent)/.test(combinedCode)) {
    return { blockerClass: 'clarification_required', basis: 'player_contract_is_materially_ambiguous' };
  }
  if (boundary === 'causal_plan_blocked') {
    if (/(?:planner_(?:action|depth|node)_budget|planner_cycle)/.test(blockerCode)) {
      return { blockerClass: 'terminal', basis: 'deterministic_planner_budget_or_cycle_exhausted' };
    }
    // The current planner exposes one selected causal chain, not a complete
    // feasible strategy frontier. A blocked chain therefore proves only that
    // no registered capability in that chain can satisfy the prerequisite.
    return { blockerClass: 'capability_gap', basis: 'registered_causal_plan_has_no_executable_next_step' };
  }
  if (hasRegisteredPrerequisite) {
    return { blockerClass: 'known_recovery', basis: 'structured_registered_prerequisite_remains' };
  }
  if (
    !goal?.evidence?.actionId
    || (/(?:state|stance|target)_unverified/.test(combinedCode) && failedTargets.length < 1)
  ) {
    return { blockerClass: 'state_reconciliation', basis: 'settled_action_identity_or_target_evidence_is_incomplete' };
  }
  if (/(?:equip_(?:blocked|unverified)|not_broken|not_collected|runtime_error)/.test(combinedCode)) {
    return { blockerClass: 'mechanical_defect', basis: 'settled_mechanical_contract_failed' };
  }
  return { blockerClass: 'terminal', basis: 'bounded_deterministic_recovery_is_exhausted' };
}

function goalCompletionIdentity(goal) {
  return JSON.stringify([
    'goal-completion-v1',
    goal?.kind || null,
    goal?.target || null,
    goal?.quantity ?? null,
    goal?.quantityMode || null,
    goal?.completion || null,
    goal?.destination || null,
  ]);
}

function prerequisitePlannerOptions(agent, goal, quantity) {
  const miningReturnRoute = Array.isArray(goal.checkpoint?.miningReturnRoute)
    ? goal.checkpoint.miningReturnRoute
    : [];
  const miningReturnIndex = Number.isFinite(Number(goal.checkpoint?.miningReturnIndex))
    ? Math.min(miningReturnRoute.length - 1, Math.floor(Number(goal.checkpoint.miningReturnIndex)))
    : miningReturnRoute.length - 1;
  return {
    target: goal.target.inventoryName,
    quantity,
    completion: goal.completion,
    range: 64,
    experience: learningKey => agent.memory_bank?.outcomePreference?.(learningKey) || 0,
    toolRequirement: goal.memory?.toolRequirement,
    workstationRequirement: goal.memory?.workstationRequirement,
    accessRequirement: goal.memory?.accessRequirement,
    workstationConstraint: goal.workstationConstraint,
    workstationTransaction: goal.checkpoint?.workstationTransaction,
    miningReturnRoute: miningReturnIndex >= 0
      ? miningReturnRoute.slice(0, miningReturnIndex + 1)
      : [],
    miningExcludedTargets: (goal.memory?.failedTargets || [])
      .filter(target => target.kind === 'collect')
      .map(target => ({
        name: target.name,
        ...target.position,
        radius: FAILED_TARGET_EXCLUSION_RADIUS,
      })),
    // One retry after a region change is useful evidence. Repeating the same
    // no-progress method after that is not: temporarily exclude it for this
    // goal so the catalogue must bind a genuinely different method or report
    // that none exists.
    excludedMethods: failedPlannerMethodExclusions(goal),
  };
}

function goalMaterialToken(goal, kind, step) {
  const materialState = JSON.stringify([
    goal.phase || null,
    kind,
    goal.checkpoint || null,
    step?.checkpoint || null,
    step?.target || goal.target || null,
    budgetedSubgoalCount(goal),
  ]);
  return `goal:v1:${createHash('sha256').update(materialState).digest('hex')}`;
}

function unavailableMethodFrontier(reasonCode, blockerCodes = []) {
  return Object.freeze({
    schemaVersion: 2,
    status: 'incomplete',
    reasonCode,
    enumerationComplete: false,
    enumerationScope: 'planner_whole_goal_methods_v1',
    rankingStatus: 'unknown',
    selectedMethodId: null,
    candidates: Object.freeze([]),
    candidateCount: 0,
    queryCount: 0,
    frontierFingerprint: null,
    blockerCodes: Object.freeze(blockerCodes),
  });
}

/**
 * Time is a physical prerequisite, not a reason to burn search regions. A
 * loaded source is always actionable; otherwise the connected string method
 * waits for the shared hostile-spawn window before leaving the family base.
 */
export function acquisitionTemporalFeasibility(bot, nextStep, goal = null) {
  const capabilityId = String(nextStep?.capability?.id || '');
  const args = nextStep?.capability?.arguments || {};
  if (capabilityId === 'harvest_entity_drop' && args.method === 'kill') {
    const health = Number(bot?.health);
    if (!Number.isFinite(health)) {
      return Object.freeze({
        ready: false,
        code: 'combat_health_unknown',
        health: null,
        detail: 'Current health is unknown; optional hostile acquisition will not start without combat-readiness evidence.',
      });
    }
    if (health <= 8) {
      return Object.freeze({
        ready: false,
        code: 'waiting_for_combat_recovery',
        health,
        detail: `Health is ${Math.max(0, Math.round(health * 10) / 10)}/20; waiting for verified recovery before optional hostile acquisition.`,
      });
    }
  }
  if (
    capabilityId !== 'harvest_entity_drop'
    || args.method !== 'kill'
    || args.source !== 'spider'
    || args.output !== 'string'
  ) {
    return Object.freeze({ ready: true, code: 'not_time_gated' });
  }

  const observedSources = Object.values(bot?.entities || {})
    .filter(entity => entity?.name === 'spider' && entity?.position)
    .filter(entity => deliberateEntityHarvestTargetQualification(bot, {
      entity: 'spider',
      output: 'string',
      method: 'kill',
    }, entity).qualified)
    .sort((left, right) => {
      const origin = bot?.entity?.position;
      if (!origin?.distanceTo) return Number(left.id) - Number(right.id);
      return origin.distanceTo(left.position) - origin.distanceTo(right.position)
        || Number(left.id) - Number(right.id);
    });
  if (observedSources.length > 0) {
    const pendingAccess = goal?.memory?.sourceAccessPending;
    const changedSources = pendingAccess
      ? observedSources.filter(entity => (
          Number(entity.id) !== Number(pendingAccess.entityId)
          || distanceBetween(entity.position, pendingAccess.position) >= SOURCE_ACCESS_RECHECK_DISTANCE
        ))
      : observedSources;
    if (pendingAccess && changedSources.length < 1) {
      return Object.freeze({
        ready: false,
        code: 'waiting_for_hostile_source_access_change',
        sourceAccess: pendingAccess,
        detail: 'The same qualified spider remains at the pursuit position Pathfinder rejected; waiting for new entity or movement evidence before retrying.',
      });
    }
    const selectedSource = changedSources[0];
    const combatEnvironment = deliberateEntityHarvestCombatEnvironment(
      bot,
      selectedSource.id,
      16,
    );
    if (!combatEnvironment.ready) {
      const nearest = combatEnvironment.threats[0];
      return Object.freeze({
        ready: false,
        code: 'waiting_for_safe_combat_environment',
        combatEnvironment,
        detail: nearest
          ? `A loaded spider is present, but ${nearest.name} is ${nearest.distance} blocks away; waiting before optional hostile acquisition.`
          : 'A loaded spider is present, but the combat environment is not yet verified safe.',
      });
    }
    return Object.freeze({
      ready: true,
      code: 'source_observed',
      targetEntityId: Number(selectedSource.id),
    });
  }
  const timeOfDay = Number(bot?.time?.timeOfDay);
  if (!isNightTime(timeOfDay)) {
    return Object.freeze({
      ready: false,
      code: 'waiting_for_hostile_spawn_window',
      timeOfDay: Number.isFinite(timeOfDay) ? timeOfDay : null,
      detail: 'No loaded spider is present; waiting at the current stance for night before starting the bounded string search.',
    });
  }
  if (goal?.memory?.sourceSearchPending) {
    return Object.freeze({
      ready: false,
      code: 'waiting_for_hostile_source_change',
      timeOfDay,
      detail: 'One bounded night search already settled without a usable spider; waiting for a newly qualified loaded source instead of repeating unchanged work.',
    });
  }
  const latestSubgoal = goal?.subgoals?.at(-1);
  if (
    latestSubgoal?.kind === 'plan'
    && latestSubgoal.commandName === '!harvestEntityDrop'
    && latestSubgoal.state === 'failed'
    && [
      'skill_source_spawn_pending',
      'skill_source_search_advanced',
    ].includes(latestSubgoal.code)
  ) {
    return Object.freeze({
      ready: false,
      code: 'waiting_for_hostile_source_change',
      timeOfDay,
      detail: latestSubgoal.code === 'skill_source_search_advanced'
        ? 'One bounded night settlement and native region move found no usable local spider; waiting for a newly qualified loaded source instead of walking through another unchanged region.'
        : 'One bounded night settlement and search found no usable local spider; waiting for a qualified loaded source instead of repeating unchanged work.',
    });
  }
  if (goal?.memory?.sourceAccessPending) {
    return Object.freeze({
      ready: true,
      code: 'hostile_source_search_window_open',
      timeOfDay,
      sourceAccess: goal.memory.sourceAccessPending,
      targetEntityId: null,
      detail: 'The previously selected spider is no longer loaded during the natural spawn window; the existing bounded harvest search may settle and move to one new region without reusing that stale identity.',
    });
  }
  return Object.freeze({ ready: true, code: 'hostile_spawn_window_open', timeOfDay });
}

function loadedRequesterThreats(agent, requesterPosition) {
  return Object.values(agent?.bot?.entities || {})
    .filter(entity => (
      entity?.position
      && mc.isHostile(entity)
      && distanceBetween(entity.position, requesterPosition)
        <= ENVIRONMENTAL_WAIT_REQUESTER_THREAT_DISTANCE
    ))
    .map(entity => ({
      id: Number.isFinite(Number(entity.id)) ? Number(entity.id) : null,
      name: boundedText(entity.name, 64, 'hostile'),
      distance: Math.round(distanceBetween(entity.position, requesterPosition) * 10) / 10,
    }))
    .sort((left, right) => left.distance - right.distance
      || Number(left.id || 0) - Number(right.id || 0))
    .slice(0, 4);
}

function environmentalWaitReturnDecision(agent, goal, temporalFeasibility) {
  const none = { command: null, blocker: null };
  if (![
    'waiting_for_hostile_spawn_window',
    'waiting_for_hostile_source_change',
  ].includes(temporalFeasibility?.code)) return none;
  const latestSubgoal = goal?.subgoals?.at(-1);
  if (
    latestSubgoal?.kind === 'recover'
    && latestSubgoal.commandName === '!goToPlayer'
    && latestSubgoal.state === 'failed'
    && !isPreemption({ phase: 'failed', code: latestSubgoal.code })
  ) {
    // One failed native route is physical evidence. Do not fill the durable
    // subgoal history with the same return attempt while daylight and both
    // endpoints are unchanged. A later acquisition action becomes new
    // evidence and naturally releases this latch.
    return none;
  }
  const resolution = resolvePlayerTarget(agent?.bot, goal?.requester, {
    knownBotNames: agent?.getKnownAgentNames?.() || [],
  });
  const botPosition = physicalPosition(agent?.bot?.entity?.position);
  const requesterPosition = physicalPosition(resolution.entity?.position);
  if (
    !resolution.entity
    || !resolution.canonical
    || !botPosition
    || !requesterPosition
    || distanceBetween(botPosition, requesterPosition) <= ENVIRONMENTAL_WAIT_COMPANION_DISTANCE
  ) return none;
  const health = Number(agent?.bot?.health);
  const threats = Number.isFinite(health) && health < 20
    ? loadedRequesterThreats(agent, requesterPosition)
    : [];
  if (threats.length > 0) {
    const nearest = threats[0];
    return {
      command: null,
      blocker: {
        code: 'waiting_for_safe_requester_return',
        detail: `${goal.requester}'s loaded region still contains ${nearest.name} ${nearest.distance} blocks away while health is ${Math.round(health * 10) / 10}; preserving the successful safety retreat before returning.`,
      },
    };
  }
  return {
    command: `!goToPlayer(${JSON.stringify(goal.requester)}, 3)`,
    blocker: null,
  };
}

function hostileSourceSurfaceStaging(goal, temporalFeasibility) {
  const pending = goal?.memory?.sourceSearchPending;
  if (
    !pending
    || ![
      'waiting_for_hostile_spawn_window',
      'waiting_for_hostile_source_change',
    ].includes(temporalFeasibility?.code)
  ) return null;

  const observedAt = Number(pending.observedAt);
  const staging = [...(goal.subgoals || [])]
    .reverse()
    .find(subgoal => (
      subgoal.kind === 'recover'
      && subgoal.commandName === '!goToSurface'
      && (!Number.isFinite(observedAt) || Number(subgoal.startedAt) >= observedAt)
    ));
  if (!staging || (
    staging.state === 'failed'
    && isPreemption({ phase: 'failed', code: staging.code })
  )) {
    return Object.freeze({ state: 'required', command: '!goToSurface' });
  }
  if (
    staging.state === 'succeeded'
    && staging.code === 'skill_surface_reached'
  ) return Object.freeze({ state: 'verified' });
  if (staging.state === 'acting') return Object.freeze({ state: 'acting' });
  return Object.freeze({
    state: 'blocked',
    code: boundedText(staging.code, 80, 'surface_staging_failed'),
    detail: boundedText(
      staging.detail,
      280,
      'The shared surface capability did not verify a supported surface stance.',
    ),
  });
}

export class GoalDirector {
  constructor(agent, {
    executeCommand = executeAgentCommand,
    now = Date.now,
    store = null,
    procedures = null,
  } = {}) {
    this.agent = agent;
    this.executeGoalCommand = executeCommand;
    this.now = now;
    this.store = store || new GoalStateStore(agent.name);
    this.procedures = procedures || new ProcedureStore(agent.name);
    this.activeGoal = null;
    this.lastGoal = null;
    this.protectedGoalId = null;
    this.lastPlan = null;
    this.planRevision = 0;
    this.lastPlanSignature = '';
    this.inFlight = false;
    this.dispatchGeneration = 0;
    this.activeDispatch = null;
    this.nextAttemptAt = 0;
    this.status = {
      phase: 'idle',
      code: 'no_goal',
      detail: 'No typed gameplay goal is active.',
      retryable: false,
      at: this.now(),
    };

    const persisted = this.store.load({
      // Fresh starts still reject old activity. Only AgentProcess' explicit
      // lifecycle-restart marker may revive the exact active Goal; Agenda then
      // requires that same executor id before its stale queue can follow.
      allowStaleActiveGoal: this.agent.lifecycle_restart === true,
    });
    const recoveredSurfacePreemption = this.agent.lifecycle_restart === true
      && !persisted.activeGoal
      ? recoverMisclassifiedSurfacePreemption(persisted.lastGoal, this.now())
      : null;
    this.activeGoal = restoredGoal(persisted.activeGoal) || recoveredSurfacePreemption;
    this.lastGoal = recoveredSurfacePreemption ? null : persisted.lastGoal;
    this.protectedGoalId = persisted.protectedGoalId === this.lastGoal?.id
      ? persisted.protectedGoalId
      : null;
    if (this.activeGoal) {
      this.store.save(this.activeGoal, this.lastGoal, this.protectedGoalId);
      this.setStatus(
        this.activeGoal.phase,
        recoveredSurfacePreemption ? 'restart_preemption_recovered' : 'restart_revalidation',
        recoveredSurfacePreemption
          ? 'Restored the exact typed Goal after correcting a misclassified higher-priority surface-staging interruption.'
          : this.activeGoal.phase === 'recover'
          ? 'Restored typed goal is resuming its deterministic recovery from fresh Minecraft state.'
          : 'Restored typed goal is waiting for fresh Minecraft state.',
        true,
      );
    } else if (this.store.lastError) {
      this.setStatus('failed', 'goal_state_load_failed', this.store.lastError, false);
    }
  }

  setStatus(phase, code, detail, retryable = false) {
    this.status = {
      phase: boundedText(phase, 24, 'idle'),
      code: boundedText(code, 80, 'unknown'),
      detail: boundedText(detail, 280),
      retryable: retryable === true,
      at: this.now(),
    };
  }

  currentControlCommitment(action = {}) {
    const goal = this.activeGoal;
    if (!goal?.id) return null;
    return {
      owner: 'player_goal',
      obligationId: goal.id,
      phase: goal.phase || null,
      ownsCurrentAction: action.owner === 'player',
    };
  }

  snapshot() {
    const goal = this.activeGoal || this.lastGoal;
    return {
      ...this.status,
      inFlight: this.inFlight,
      protectedGoalId: this.protectedGoalId,
      nextAttemptAt: this.nextAttemptAt,
      plan: this.lastPlan,
      goal: goal ? {
        id: goal.id,
        kind: goal.kind,
        requester: goal.requester,
        target: goal.target,
        quantity: goal.quantity,
        completion: goal.completion,
        destination: goal.destination,
        phase: goal.phase,
        attempts: goal.attempts,
        maxAttempts: goal.maxAttempts,
        checkpoint: goal.checkpoint,
        memory: goal.memory,
        evidence: goal.evidence,
        procedureId: goal.procedureId,
        subgoals: goal.subgoals.slice(-12),
      } : null,
    };
  }

  persist(raw) {
    this.activeGoal = normalizeGoalContract(raw);
    this.store.save(this.activeGoal, this.lastGoal, this.protectedGoalId);
    return this.activeGoal;
  }

  adoptMiningContinuationCheckpoint(checkpoint, reason = 'Reconciled a persisted mining route.') {
    if (
      !this.activeGoal
      || this.inFlight
      || (this.activeGoal.checkpoint?.miningReturnRoute?.length || 0) > 0
    ) return false;
    const candidate = normalizeGoalContract({
      ...this.activeGoal,
      phase: 'assess',
      checkpoint: {
        ...this.activeGoal.checkpoint,
        ...(checkpoint || {}),
      },
      evidence: {
        actionId: '',
        phase: 'assess',
        code: 'mining_return_checkpoint_reconciled',
        detail: boundedText(reason, 280, 'Reconciled a persisted mining route.'),
        verified: false,
        at: this.now(),
      },
      updatedAt: this.now(),
    });
    if ((candidate.checkpoint?.miningReturnRoute?.length || 0) < 1) return false;
    this.persist(candidate);
    this.nextAttemptAt = 0;
    this.setStatus(
      'planning',
      'mining_return_checkpoint_reconciled',
      'The active Goal recovered its exact Agenda-owned mining spine and will rejoin it from live position.',
      true,
    );
    return true;
  }

  hasProtectedCompletion() {
    return Boolean(
      this.protectedGoalId
      && this.lastGoal?.phase === 'complete'
      && this.lastGoal.id === this.protectedGoalId
    );
  }

  releaseProtectedCompletion(
    _reason = 'Released by later player-authorized work.',
    { preserveTerminalHandoff = false } = {},
  ) {
    if (!preserveTerminalHandoff) {
      this.agent.behavior_arbiter?.releaseTerminalHandoff?.(_reason);
    }
    if (!this.hasProtectedCompletion()) return false;
    this.protectedGoalId = null;
    this.store.save(this.activeGoal, this.lastGoal, null);
    return true;
  }

  submit(raw) {
    if (this.activeGoal && !TERMINAL_PHASES.has(this.activeGoal.phase)) {
      return { accepted: false, code: 'goal_busy', id: this.activeGoal.id };
    }
    if (this.agent.job_director?.activeOrder) {
      return {
        accepted: false,
        code: 'job_busy',
        detail: `Work order ${this.agent.job_director.activeOrder.id} is already active.`,
      };
    }
    try {
      this.invalidateDispatch();
      let goal = normalizeGoalContract(raw);
      const procedure = this.procedures.find(goal);
      if (procedure) goal = normalizeGoalContract({ ...goal, procedureId: procedure.id });
      this.activeGoal = goal;
      this.lastGoal = null;
      this.protectedGoalId = null;
      this.lastPlan = null;
      this.planRevision = 0;
      this.lastPlanSignature = '';
      this.nextAttemptAt = 0;
      this.store.save(goal, null, null);
      this.setStatus('assess', 'goal_accepted', `Accepted typed goal: ${goalContractDescription(goal)}.`, true);
      this.agent.publishBehaviorEvent?.({
        type: 'goal.changed',
        target: { name: goal.target.family || goal.target.canonicalName },
        evidence: { goalId: goal.id, code: 'goal_accepted', phase: goal.phase },
        salience: 3,
      });
      return { accepted: true, id: goal.id, procedureId: goal.procedureId };
    } catch (error) {
      return {
        accepted: false,
        code: 'invalid_goal',
        detail: boundedText(error?.message || error),
      };
    }
  }

  cancel(reason = 'Cancelled by player.') {
    if (!this.activeGoal) return false;
    const cancelledAt = this.now();
    const subgoals = this.activeGoal.subgoals.map(subgoal => (
      subgoal.state === 'acting'
        ? {
            ...subgoal,
            state: 'cancelled',
            code: 'goal_cancelled',
            detail: boundedText(reason),
            finishedAt: cancelledAt,
          }
        : subgoal
    ));
    const cancelled = normalizeGoalContract({
      ...this.activeGoal,
      phase: 'cancelled',
      subgoals,
      evidence: {
        actionId: this.activeGoal.evidence?.actionId || '',
        phase: 'cancelled',
        code: 'goal_cancelled',
        detail: reason,
        verified: false,
        at: cancelledAt,
      },
      updatedAt: cancelledAt,
    });
    this.lastGoal = cancelled;
    this.activeGoal = null;
    this.protectedGoalId = null;
    this.invalidateDispatch();
    this.store.save(null, cancelled, null);
    this.setStatus('cancelled', 'goal_cancelled', reason, false);
    return true;
  }

  resumeLastCancelled(goalId, reason = 'Explicit player authority resumed the cancelled Goal.') {
    const cancelled = this.lastGoal;
    if (
      this.activeGoal
      || cancelled?.phase !== 'cancelled'
      || cancelled.id !== boundedText(goalId, 96)
      || Number(cancelled.attempts) >= Number(cancelled.maxAttempts)
    ) return { resumed: false, id: null };
    const latestSubgoal = cancelled.subgoals.at(-1);
    const phase = latestSubgoal?.kind === 'recover' ? 'recover' : 'assess';
    const resumed = normalizeGoalContract({
      ...cancelled,
      phase,
      evidence: {
        actionId: '',
        phase,
        code: 'explicit_goal_resume',
        detail: boundedText(reason, 280),
        verified: false,
        retryable: true,
        at: this.now(),
      },
      updatedAt: this.now(),
    });
    this.activeGoal = resumed;
    this.lastGoal = null;
    this.protectedGoalId = null;
    this.nextAttemptAt = 0;
    this.lastPlan = null;
    this.lastPlanSignature = '';
    this.invalidateDispatch();
    this.store.save(resumed, null, null);
    this.setStatus(
      phase,
      'explicit_goal_resume',
      'Resumed the exact cancelled Goal identity from fresh Minecraft state.',
      true,
    );
    return { resumed: true, id: resumed.id };
  }

  reconcileDeath({
    position = null,
    dimension = null,
    recoverableItems = 0,
    deathRecord = null,
    deathPersistenceCode = '',
  } = {}) {
    if (!this.activeGoal) return false;
    let goal = this.activeGoal;
    const actingSubgoal = goal.subgoals.at(-1)?.state === 'acting'
      ? goal.subgoals.at(-1)
      : null;
    const observedRecoverableItems = Math.max(0, Math.floor(Number(recoverableItems) || 0));
    const recordedAt = Number(deathRecord?.recordedAt);
    const persistedRecoverableDeath = observedRecoverableItems < 1 || (
      Number.isSafeInteger(recordedAt)
      && recordedAt > 0
      && Object.values(deathRecord?.inventory || {}).some(count => Number(count) > 0)
    );
    const resultCode = persistedRecoverableDeath
      ? 'goal_owner_died'
      : 'death_recovery_persistence_failed';
    const detail = !persistedRecoverableDeath
      ? `The bot died during this goal and lost ${observedRecoverableItems} carried item${observedRecoverableItems === 1 ? '' : 's'}, but the current death record was not persisted (${boundedText(deathPersistenceCode, 80, 'persistence_rejected')}); stale recovery is forbidden.`
      : observedRecoverableItems > 0
      ? `The bot died during this goal and lost ${observedRecoverableItems} carried item${observedRecoverableItems === 1 ? '' : 's'}; reconcile the recorded death inventory before replanning.`
      : 'The bot died during this goal; revalidate inventory and strategy before replanning.';
    const result = {
      actionId: `death-${this.now()}`,
      phase: 'failed',
      code: resultCode,
      detail,
      retryable: persistedRecoverableDeath,
      evidence: {
        skill: {
          kind: 'death_reconciliation',
          outcome: persistedRecoverableDeath ? 'owner_died' : 'persistence_failed',
          target: position && [position.x, position.y, position.z].every(Number.isFinite)
            ? { name: 'last_death_position', x: position.x, y: position.y, z: position.z }
            : { name: 'last_death_position' },
          dimension: boundedText(dimension, 64) || null,
          recoverableItems: observedRecoverableItems,
          persistenceCode: boundedText(deathPersistenceCode, 80) || null,
          recordedAt: persistedRecoverableDeath && observedRecoverableItems > 0
            ? recordedAt
            : null,
          retryable: persistedRecoverableDeath,
        },
      },
    };

    // Death is a material world-state transition, not a harmless ownership
    // preemption. Revoke the old dispatch token first so the action's later
    // interrupted result cannot overwrite this durable settlement.
    this.invalidateDispatch();
    this.persist({
      ...goal,
      memory: {
        ...goal.memory,
        deathRecovery: persistedRecoverableDeath && observedRecoverableItems > 0
          ? { recordedAt }
          : null,
      },
      updatedAt: this.now(),
    });
    goal = this.activeGoal;
    if (actingSubgoal) {
      this.handleResult(actingSubgoal.kind, result);
      return true;
    }

    // A persisted inventory-bearing death is not yet a failed productive
    // attempt. The post-respawn recovery action owns that verdict; charging
    // here can terminalize the Goal before its deliberately delayed inventory
    // observation establishes that the carried work survived.
    const pendingDeathRecovery = persistedRecoverableDeath && observedRecoverableItems > 0;
    const attempts = pendingDeathRecovery ? goal.attempts : goal.attempts + 1;
    this.persist({
      ...goal,
      attempts,
      phase: pendingDeathRecovery || attempts < goal.maxAttempts ? 'recover' : goal.phase,
      evidence: {
        actionId: result.actionId,
        phase: result.phase,
        code: result.code,
        detail: result.detail,
        verified: false,
        at: this.now(),
      },
      updatedAt: this.now(),
    });
    if (!persistedRecoverableDeath) {
      this.fail(resultCode, detail, { retryable: false });
      return true;
    }
    if (pendingDeathRecovery) {
      this.nextAttemptAt = this.now() + RETRY_DELAY_MS;
      this.setStatus('recover', 'goal_owner_died', detail, true);
      return true;
    }
    if (attempts >= goal.maxAttempts) {
      this.fail(
        'goal_attempts_exhausted',
        `${detail} The goal exhausted its ${goal.maxAttempts} bounded attempts.`,
      );
      return true;
    }
    this.nextAttemptAt = this.now() + RETRY_DELAY_MS;
    this.setStatus('recover', 'goal_owner_died', detail, true);
    return true;
  }

  invalidateDispatch() {
    this.dispatchGeneration += 1;
    this.activeDispatch = null;
    this.inFlight = false;
  }

  ownsDispatch(token) {
    return Boolean(
      token
      && this.activeDispatch === token
      && token.generation === this.dispatchGeneration
    );
  }

  canSettleDispatch(token) {
    return this.ownsDispatch(token) && this.activeGoal?.id === token.goalId;
  }

  currentInventory(goal = this.activeGoal) {
    return goal ? inventoryCountForGoalTarget(this.agent.bot, goal.target) : 0;
  }

  requiredInventory(goal = this.activeGoal) {
    if (!goal) return 0;
    if (goal.kind === 'deliver') {
      return Math.max(0, goal.quantity - goal.checkpoint.delivered);
    }
    return goal.checkpoint.targetInventory;
  }

  verify(goal = this.activeGoal) {
    if (!goal) return { complete: false, code: 'no_goal', detail: 'No typed goal is active.' };
    const miningReturn = pendingMiningReturn(goal);
    if (goal.kind === 'deliver') {
      const delivered = goal.checkpoint.delivered >= goal.quantity;
      const complete = delivered && !miningReturn;
      return {
        complete,
        code: complete
          ? 'delivery_verified'
          : delivered && miningReturn
            ? 'mining_return_pending'
            : 'delivery_incomplete',
        detail: complete
          ? `Minecraft confirmed ${goal.checkpoint.delivered} ${goal.target.family || goal.target.inventoryName} received by ${goal.destination.player}.`
          : delivered && miningReturn
            ? `The requested delivery is physically verified, but the bot must still return through ${miningReturn.index + 1} preserved mining-route cell${miningReturn.index === 0 ? '' : 's'} before releasing the goal.`
          : `Minecraft has confirmed ${goal.checkpoint.delivered} of ${goal.quantity} delivered.`,
      };
    }
    const current = this.currentInventory(goal);
    const inventoryComplete = current >= goal.checkpoint.targetInventory;
    const equipmentComplete = completionRequirementSatisfied(
      this.agent.bot,
      goal.target,
      goal.completion,
    );
    const complete = inventoryComplete && equipmentComplete && !miningReturn;
    const completionLabel = goal.completion.kind === 'main_hand'
      ? 'main hand'
      : goal.completion.kind === 'off_hand'
        ? 'offhand'
        : 'inventory';
    const codePrefix = goal.completion.kind === 'inventory'
      ? 'inventory_goal'
      : `${goal.completion.kind}_goal`;
    return {
      complete,
      code: complete
        ? `${codePrefix}_verified`
        : inventoryComplete && equipmentComplete && miningReturn
          ? 'mining_return_pending'
          : `${codePrefix}_incomplete`,
      detail: complete
        ? goal.completion.kind === 'inventory'
          ? `Inventory contains ${current}; required post-goal count was ${goal.checkpoint.targetInventory}.`
          : `Minecraft confirms ${goal.target.inventoryName} in the ${completionLabel}.`
        : inventoryComplete && equipmentComplete && miningReturn
          ? `Minecraft confirms the requested output, but the bot must still return through ${miningReturn.index + 1} preserved mining-route cell${miningReturn.index === 0 ? '' : 's'} before completion.`
          : !inventoryComplete
          ? `Inventory contains ${current}; required count is ${goal.checkpoint.targetInventory} before ${completionLabel} completion.`
          : `Inventory contains ${current}, but Minecraft does not confirm ${goal.target.inventoryName} in the ${completionLabel}.`,
    };
  }

  supersedeSubgoalFailureSpeech(goal) {
    const actionIds = (goal?.subgoals || [])
      .map(subgoal => subgoal.actionId)
      .filter(Boolean);
    return this.agent.behavior_events?.supersedeActionFailures?.(actionIds) || 0;
  }

  complete(verification) {
    const goal = normalizeGoalContract({
      ...this.activeGoal,
      phase: 'complete',
      evidence: {
        actionId: this.activeGoal.evidence?.actionId || '',
        phase: 'complete',
        code: verification.code,
        detail: verification.detail,
        verified: true,
        at: this.now(),
      },
      updatedAt: this.now(),
    });
    let procedure = null;
    try {
      procedure = this.procedures.record(goal);
    } catch (error) {
      console.warn(`[goal-procedure] Completed goal was not persisted as a procedure: ${boundedText(error?.message || error)}`);
    }
    const completed = procedure
      ? normalizeGoalContract({ ...goal, procedureId: procedure.id })
      : goal;
    this.lastGoal = completed;
    this.activeGoal = null;
    this.protectedGoalId = completed.id;
    this.invalidateDispatch();
    this.store.save(null, completed, this.protectedGoalId);
    this.setStatus('complete', verification.code, verification.detail, false);
    this.supersedeSubgoalFailureSpeech(completed);
    this.agent.publishBehaviorEvent?.({
      type: 'goal.completed',
      target: { name: completed.target.family || completed.target.canonicalName },
      evidence: {
        goalId: completed.id,
        code: verification.code,
        phase: 'complete',
        procedureId: completed.procedureId,
      },
      salience: 4,
    });
    const report = Promise.resolve(this.agent.openChat?.(`Completed: ${goalContractDescription(completed)}. ${verification.detail}`));
    this.agent.behavior_arbiter?.beginTerminalHandoff?.({
      outcomeId: completed.id,
      owner: 'player_goal',
      phase: 'complete',
      code: verification.code,
      reportPromise: report,
    });
    void report.catch(error => console.warn(`[goal] Could not report completion: ${boundedText(error?.message || error)}`));
    return completed;
  }

  recordTerminalBoundary(boundary, { code, detail, plan = null } = {}) {
    const goal = this.activeGoal;
    if (!goal) return false;
    try {
      const planner = plan || this.lastPlan;
      const classification = terminalBlockerClassification(boundary, goal, plan);
      const latestSubgoal = goal.subgoals.at(-1) || null;
      const skill = this.agent.bot?.lastActionEvidence;
      const selected = this.agent.bot?.heldItem;
      const completionIdentity = goalCompletionIdentity(goal);
      let methodFrontier = unavailableMethodFrontier(
        'family_goal_not_owned_by_prerequisite_planner',
      );
      if (!goal.target.family) {
        try {
          methodFrontier = buildPrerequisiteMethodFrontier(this.agent.bot, {
            ...prerequisitePlannerOptions(this.agent, goal, this.requiredInventory(goal)),
            completionIdentity,
            frontierMaxSearches: TERMINAL_FRONTIER_SEARCHES,
          });
        } catch (error) {
          console.warn(`[goal-telemetry] Planner frontier failed closed: ${boundedText(error?.message || error)}`);
          methodFrontier = unavailableMethodFrontier(
            'frontier_runtime_error',
            ['frontier_runtime_error'],
          );
        }
      }
      const branchQualification = qualifyStrategicBranch({
        blockerClass: classification.blockerClass,
        completionIdentity,
        deterministicRecoveryExhausted: true,
        enumerationComplete: methodFrontier.enumerationComplete,
        candidates: methodFrontier.candidates,
        frontierFingerprint: methodFrontier.frontierFingerprint,
        rankingStatus: methodFrontier.rankingStatus,
        selectedMethodId: methodFrontier.selectedMethodId,
      });
      return this.agent.flight_recorder?.recordRuntimeEvent?.('goal.terminal_boundary', {
        schemaVersion: 2,
        boundary,
        terminalCode: boundedText(code, 80, boundary),
        blockerClass: classification.blockerClass,
        classificationBasis: classification.basis,
        blocker: {
          code: boundedText(plan?.code || goal.evidence?.code, 80, 'unknown'),
          detail: boundedText(detail || plan?.detail || goal.evidence?.detail, 360),
          target: boundedText(plan?.blocker, 80) || null,
          trail: Array.isArray(plan?.trail) ? plan.trail.slice(0, 24) : [],
          exploredNodes: Number.isFinite(plan?.exploredNodes) ? plan.exploredNodes : null,
        },
        goal: {
          id: goal.id,
          kind: goal.kind,
          phase: goal.phase,
          target: goal.target,
          completion: goal.completion,
          attempts: goal.attempts,
          maxAttempts: goal.maxAttempts,
          targetInventory: this.currentInventory(goal),
          requiredInventory: this.requiredInventory(goal),
        },
        prerequisites: {
          tool: goal.memory?.toolRequirement || null,
          workstation: goal.memory?.workstationRequirement || null,
          access: goal.memory?.accessRequirement || null,
        },
        failedTargets: (goal.memory?.failedTargets || []).slice(-MAX_FAILED_TARGETS),
        methods: {
          enumerationComplete: branchQualification.enumerationComplete,
          enumerationScope: methodFrontier.enumerationScope,
          strategicBranchEstablished: branchQualification.strategicBranchEstablished,
          qualification: branchQualification,
          frontier: {
            schemaVersion: methodFrontier.schemaVersion,
            status: methodFrontier.status,
            reasonCode: methodFrontier.reasonCode,
            candidateCount: methodFrontier.candidateCount,
            queryCount: methodFrontier.queryCount,
            selectedMethodId: methodFrontier.selectedMethodId,
            frontierFingerprint: methodFrontier.frontierFingerprint,
            blockerCodes: methodFrontier.blockerCodes,
            candidates: methodFrontier.candidates.map(candidate => ({
              methodId: candidate.methodId,
              completionIdentity: candidate.completionIdentity,
              feasible: candidate.feasible,
              proof: {
                plannerStatus: candidate.proof.plannerStatus,
                plannerCode: candidate.proof.plannerCode,
                actionCount: candidate.proof.actionCount,
                exploredNodes: candidate.proof.exploredNodes,
                planFingerprint: candidate.proof.planFingerprint,
                rootMethodKey: candidate.proof.rootMethodKey,
                decisionKeys: candidate.proof.decisionKeys.slice(0, 12),
                capabilityIds: candidate.proof.capabilityIds.slice(0, 12),
              },
            })),
          },
          observed: (planner?.actions || []).slice(0, 12).map(action => ({
            methodKey: boundedText(action?.learningKey, 160) || null,
            capability: boundedText(action?.capability?.id, 80) || null,
            target: boundedText(action?.target, 80) || null,
          })),
          selected: planner?.nextStep ? {
            methodKey: boundedText(planner.nextStep.learningKey, 160) || null,
            capability: boundedText(planner.nextStep.capability?.id, 80) || null,
            target: boundedText(planner.nextStep.target, 80) || null,
          } : null,
          excluded: failedPlannerMethodExclusions(goal),
          planRevision: this.planRevision,
        },
        lastAction: latestSubgoal ? {
          actionId: latestSubgoal.actionId,
          kind: latestSubgoal.kind,
          commandName: latestSubgoal.commandName,
          state: latestSubgoal.state,
          code: latestSubgoal.code,
          targetName: latestSubgoal.targetName,
          learningKey: latestSubgoal.learningKey,
        } : null,
        freshState: {
          observedAt: this.now(),
          selectedItem: selected?.name ? {
            name: selected.name,
            count: Math.max(0, Number(selected.count) || 0),
            inventorySlot: Number.isInteger(selected.slot) ? selected.slot : null,
            hotbarSlot: Number.isInteger(this.agent.bot?.quickBarSlot)
              ? this.agent.bot.quickBarSlot
              : null,
          } : null,
          skillEvidence: skill && typeof skill === 'object' ? {
            kind: skill.kind || null,
            outcome: skill.outcome || null,
            target: skill.target || null,
            failedTargets: skill.failedTargets || [],
            toolRequirement: skill.toolRequirement || null,
            workstationRequirement: skill.workstationRequirement || null,
            accessRequirement: skill.accessRequirement || null,
            toolState: skill.toolState || null,
            inventoryState: skill.inventoryState || null,
            recordedAt: skill.recordedAt || null,
          } : null,
        },
      }) === true;
    } catch (error) {
      console.warn(`[goal-telemetry] Could not record terminal boundary: ${boundedText(error?.message || error)}`);
      return false;
    }
  }

  fail(code, detail, { retryable = null, completionBlocked = false } = {}) {
    const failed = normalizeGoalContract({
      ...this.activeGoal,
      phase: 'failed',
      evidence: {
        actionId: this.activeGoal.evidence?.actionId || '',
        phase: 'failed',
        code,
        detail,
        verified: false,
        at: this.now(),
        ...(typeof retryable === 'boolean' ? { retryable } : {}),
        ...(completionBlocked === true ? { completionBlocked: true } : {}),
      },
      updatedAt: this.now(),
    });
    this.lastGoal = failed;
    this.activeGoal = null;
    this.protectedGoalId = null;
    this.invalidateDispatch();
    this.store.save(null, failed, null);
    this.setStatus('failed', code, detail, false);
    this.supersedeSubgoalFailureSpeech(failed);
    const agendaOwnsFailedGoal = this.agent.agenda_director?.ownsGoalExecutor?.(failed.id) === true;
    // A failed player-owned goal returns control to the player, not to the
    // autonomous lanes. A matching durable Agenda is different: it owns the
    // larger player request and must receive this correlated terminal result
    // so it can apply its own bounded retry/dependency policy without waiting
    // for another player message.
    if (failed.source === 'player' && !agendaOwnsFailedGoal) {
      this.agent.holdPosition?.('Player goal failed; awaiting explicit player direction.');
    }
    this.agent.publishBehaviorEvent?.({
      type: 'goal.changed',
      target: { name: failed.target.family || failed.target.canonicalName },
      evidence: { goalId: failed.id, code, phase: 'failed' },
      salience: 3,
    });
    // An Agenda-owned failure is an internal step result, not yet the outcome
    // of the player's whole request. Reporting it here produces stale failure
    // narration immediately before Agenda retries the exact typed step.
    const report = agendaOwnsFailedGoal
      ? Promise.resolve()
      : Promise.resolve(this.agent.openChat?.(`Goal stopped without completion: ${detail}`));
    this.agent.behavior_arbiter?.beginTerminalHandoff?.({
      outcomeId: failed.id,
      owner: 'player_goal',
      phase: 'failed',
      code,
      reportPromise: report,
    });
    void report.catch(error => console.warn(`[goal] Could not report failure: ${boundedText(error?.message || error)}`));
    return failed;
  }

  requestCompletion() {
    if (!this.activeGoal) return { handled: false, complete: false, message: null };
    const verification = this.verify();
    if (!verification.complete) {
      this.setStatus(this.activeGoal.phase, verification.code, verification.detail, true);
      return {
        handled: true,
        complete: false,
        message: `Goal is not complete: ${verification.detail}`,
      };
    }
    this.complete(verification);
    return {
      handled: true,
      complete: true,
      message: verification.detail,
    };
  }

  appendActingSubgoal(kind, command, step = null) {
    const now = this.now();
    const retainedSubgoals = [...this.activeGoal.subgoals];
    if (retainedSubgoals.length >= this.activeGoal.maxSubgoals) {
      const oldestRecovery = retainedSubgoals.findIndex(subgoal => subgoal.kind === 'recover');
      if (oldestRecovery >= 0) retainedSubgoals.splice(oldestRecovery, 1);
    }
    const targetInventory = step?.expectedName
      ? plannedInventoryCount(this.agent.bot, step.expectedName, step.expectedFamily)
      : 0;
    const subgoal = {
      id: `${this.activeGoal.id}:subgoal-${this.activeGoal.subgoals.length + 1}`,
      kind,
      state: 'acting',
      commandName: commandName(command),
      attempt: this.activeGoal.attempts + 1,
      actionId: null,
      code: null,
      detail: '',
      targetName: step?.expectedName || null,
      targetFamily: step?.expectedFamily || null,
      expectedIncrease: step?.expectedIncrease || 0,
      targetInventoryBefore: targetInventory,
      targetInventoryAfter: targetInventory,
      learningKey: step?.learningKey || null,
      reason: step?.reason || '',
      inventoryBefore: this.currentInventory(),
      inventoryAfter: this.currentInventory(),
      startedAt: now,
      finishedAt: null,
    };
    return this.persist({
      ...this.activeGoal,
      subgoals: [...retainedSubgoals, subgoal],
      updatedAt: now,
    });
  }

  finishLatestSubgoal(result) {
    const subgoals = [...this.activeGoal.subgoals];
    const index = subgoals.length - 1;
    if (index < 0) return this.activeGoal;
    const current = subgoals[index];
    const targetInventoryAfter = current.targetName
      ? plannedInventoryCount(this.agent.bot, current.targetName, current.targetFamily)
      : current.targetInventoryAfter;
    const finishedAt = this.now();
    const yieldCount = Math.max(0, targetInventoryAfter - current.targetInventoryBefore);
    subgoals[index] = {
      ...current,
      state: result.phase === 'succeeded' ? 'succeeded' : 'failed',
      actionId: result.actionId || null,
      code: result.code || 'unknown',
      failureScope: current.kind === 'plan' && result.phase !== 'succeeded'
        ? plannerFailureScope(result)
        : null,
      detail: result.detail || '',
      targetInventoryAfter,
      inventoryAfter: this.currentInventory(),
      finishedAt,
    };
    const persisted = this.persist({
      ...this.activeGoal,
      subgoals,
      evidence: {
        actionId: result.actionId || '',
        phase: result.phase || 'failed',
        code: result.code || 'unknown',
        detail: result.detail || '',
        verified: result.phase === 'succeeded',
        at: this.now(),
      },
      updatedAt: finishedAt,
    });
    if (current.learningKey) {
      try {
        const classification = classifyMethodOutcome(result);
        this.agent.memory_bank?.rememberOutcome?.(current.learningKey, {
          success: result.phase === 'succeeded',
          classification,
          durationMs: Number(result.durationMs) || (
            Number.isFinite(current.startedAt)
              ? Math.max(0, finishedAt - current.startedAt)
              : 0
          ),
          yieldCount,
          code: result.code || 'unknown',
        });
      } catch (error) {
        console.warn(`[goal-learning] Could not remember ${current.learningKey}: ${boundedText(error?.message || error)}`);
      }
    }
    return persisted;
  }

  suspendLatestSubgoal(result) {
    const subgoals = [...this.activeGoal.subgoals];
    const index = subgoals.length - 1;
    if (index < 0) return this.activeGoal;
    const current = subgoals[index];
    const finishedAt = this.now();
    subgoals[index] = {
      ...current,
      state: 'cancelled',
      actionId: result.actionId || null,
      code: 'safety_suspended',
      detail: result.detail || 'Survival took exclusive control of the body.',
      targetInventoryAfter: current.targetName
        ? plannedInventoryCount(this.agent.bot, current.targetName, current.targetFamily)
        : current.targetInventoryAfter,
      inventoryAfter: this.currentInventory(),
      finishedAt,
    };
    const persisted = this.persist({
      ...this.activeGoal,
      subgoals,
      evidence: {
        actionId: result.actionId || '',
        phase: 'interrupted',
        code: 'safety_suspended',
        detail: result.detail || 'Survival took exclusive control; the goal remains at its current phase.',
        verified: false,
        at: finishedAt,
      },
      // Preserve phase, attempts, checkpoint, and learned method state. When
      // Survival closes the incident the arbiter wakes this same goal, which
      // re-derives its next action from the live world exactly once.
      updatedAt: finishedAt,
    });
    this.nextAttemptAt = 0;
    this.setStatus(
      'waiting',
      'safety_suspended',
      'Survival owns the body until the active safety incident settles; this goal will then resume from current world state.',
      true,
    );
    return persisted;
  }

  rememberFailedTarget(result) {
    if (!this.activeGoal || result?.phase === 'succeeded') return this.activeGoal;
    const skill = actionResultEvidence(result);
    const targets = actionResultTargetFailures(result);
    if (targets.length < 1) return this.activeGoal;

    const now = this.now();
    const previous = this.activeGoal.memory?.failedTargets || [];
    let retained = previous.filter(entry => now - entry.lastFailedAt <= FAILED_TARGET_RETENTION_MS);
    for (const target of targets) {
      const position = { x: target.x, y: target.y, z: target.z };
      const kind = boundedText(target.kind || skill?.kind || 'action', 32, 'action');
      const name = boundedText(target.name, 80);
      const sameTarget = entry => (
        entry.kind === kind
        && entry.name === name
        && entry.position.x === position.x
        && entry.position.y === position.y
        && entry.position.z === position.z
      );
      const prior = previous.find(sameTarget);
      retained = retained.filter(entry => !sameTarget(entry));
      retained.push({
        kind,
        name,
        position,
        code: boundedText(target.outcome || result?.code, 80),
        failures: Math.min(8, (prior?.failures || 0) + 1),
        firstFailedAt: prior?.firstFailedAt || now,
        lastFailedAt: now,
        avoidUntil: now + FAILED_TARGET_COOLDOWN_MS,
      });
    }
    return this.persist({
      ...this.activeGoal,
      memory: {
        ...this.activeGoal.memory,
        failedTargets: retained.slice(-MAX_FAILED_TARGETS),
      },
      updatedAt: now,
    });
  }

  rememberToolRequirement(result) {
    if (!this.activeGoal || result?.phase === 'succeeded') return this.activeGoal;
    const skill = actionResultEvidence(result);
    const requirement = skill?.toolRequirement;
    const name = boundedText(requirement?.name, 80);
    const minimumUsableDurability = Math.max(
      1,
      Math.min(10_000, Math.floor(Number(requirement?.minimumUsableDurability) || 0)),
    );
    if (!name || !/^[a-z0-9_]+$/.test(name)) return this.activeGoal;
    const exactTarget = skill?.target
      && skill.target.name
      && [skill.target.x, skill.target.y, skill.target.z].every(Number.isFinite)
      ? {
          name: boundedText(skill.target.name, 80),
          position: {
            x: Math.floor(skill.target.x),
            y: Math.floor(skill.target.y),
            z: Math.floor(skill.target.z),
          },
        }
      : null;
    const targetFailedLocally = exactTarget && resultRejectsCollectionTarget(result, exactTarget);
    const requirementTarget = targetFailedLocally ? null : exactTarget;
    return this.persist({
      ...this.activeGoal,
      memory: {
        ...this.activeGoal.memory,
        toolRequirement: {
          name,
          minimumUsableDurability,
          observedAt: this.now(),
          target: requirementTarget,
        },
        ...(targetFailedLocally ? {
          activeCollectionTarget: null,
        } : exactTarget ? {
          activeCollectionTarget: {
            ...exactTarget,
            remainingRouteLowerBound: Math.max(
              0,
              Math.floor(Number(skill?.boundary?.remainingRouteLowerBound) || 0),
            ),
            observedAt: this.now(),
          },
        } : {}),
      },
      updatedAt: this.now(),
    });
  }

  rememberWorkstationRequirement(result) {
    if (!this.activeGoal || result?.phase === 'succeeded') return this.activeGoal;
    const requirement = actionResultEvidence(result)?.workstationRequirement;
    const name = boundedText(requirement?.name, 80);
    if (!name || !/^[a-z0-9_]+$/.test(name) || requirement?.carried !== true) {
      return this.activeGoal;
    }
    return this.persist({
      ...this.activeGoal,
      memory: {
        ...this.activeGoal.memory,
        workstationRequirement: {
          name,
          carried: true,
          observedAt: this.now(),
        },
      },
      updatedAt: this.now(),
    });
  }

  rememberAccessRequirement(result) {
    if (!this.activeGoal) return this.activeGoal;
    const skill = actionResultEvidence(result);
    const reachedSurface = skill?.kind === 'surface_navigation'
      && skill?.outcome === 'surface_reached';
    const requestedSurface = result?.phase !== 'succeeded'
      && skill?.accessRequirement?.kind === 'surface';
    if (!reachedSurface && !requestedSurface) return this.activeGoal;
    return this.persist({
      ...this.activeGoal,
      memory: {
        ...this.activeGoal.memory,
        accessRequirement: requestedSurface ? { kind: 'surface' } : null,
      },
      updatedAt: this.now(),
    });
  }

  rememberOperationalProgress(result, miningRouteProgress = false) {
    if (!this.activeGoal) return this.activeGoal;
    const skill = actionResultEvidence(result);
    const memory = this.activeGoal.memory || {};
    const activeTarget = memory.activeCollectionTarget || null;
    const exactTarget = skill?.target
      && skill.target.name
      && [skill.target.x, skill.target.y, skill.target.z].every(Number.isFinite)
      ? {
          name: boundedText(skill.target.name, 80),
          position: {
            x: Math.floor(skill.target.x),
            y: Math.floor(skill.target.y),
            z: Math.floor(skill.target.z),
          },
        }
      : null;
    let nextActiveTarget = activeTarget;
    let nextToolRequirement = memory.toolRequirement || null;
    const activeTargetFailedLocally = activeTarget
      && resultRejectsCollectionTarget(result, activeTarget);

    if (activeTargetFailedLocally) {
      // A prerequisite can coexist with independent geometry evidence. Keep the
      // prerequisite, but release the rejected coordinate so the replacement
      // tool or workstation does not force the next plan back to a bad stance.
      nextActiveTarget = null;
      if (
        nextToolRequirement?.target
        && concreteCollectionTargetsMatch(activeTarget, nextToolRequirement.target)
      ) nextToolRequirement = { ...nextToolRequirement, target: null };
    } else if (miningRouteProgress && exactTarget) {
      const advancesActiveTarget = !activeTarget
        || concreteCollectionTargetsMatch(exactTarget, activeTarget);
      if (advancesActiveTarget) {
        nextActiveTarget = {
          ...exactTarget,
          remainingRouteLowerBound: Math.max(
            0,
            Math.floor(Number(skill?.boundary?.remainingRouteLowerBound) || 0),
          ),
          observedAt: this.now(),
        };
      }
      const paysToolRequirement = !nextToolRequirement?.target
        || concreteCollectionTargetsMatch(exactTarget, nextToolRequirement.target);
      if (paysToolRequirement) {
        // Only progress on the source that raised the requirement pays it.
        // A nested iron or wood acquisition may use a different tool without
        // satisfying the retained redstone/diamond target's causal preflight.
        nextToolRequirement = null;
      }
    } else if (
      activeTarget
      && collectionSourceMatches(skill?.target?.name, activeTarget.name)
      && !skill?.toolRequirement
      && !skill?.workstationRequirement
      && ['collect', 'mining_search'].includes(String(skill?.kind || ''))
    ) {
      // A terminal result about the retained source either collected it or
      // invalidated it. Do not carry that coordinate into another strategy.
      nextActiveTarget = null;
      if (
        nextToolRequirement?.target
        && concreteCollectionTargetsMatch(activeTarget, nextToolRequirement.target)
      ) nextToolRequirement = null;
    }

    if (
      nextActiveTarget === activeTarget
      && nextToolRequirement === memory.toolRequirement
    ) return this.activeGoal;
    return this.persist({
      ...this.activeGoal,
      memory: {
        ...memory,
        activeCollectionTarget: nextActiveTarget,
        toolRequirement: nextToolRequirement,
      },
      updatedAt: this.now(),
    });
  }

  collectionPreferredTarget(requestedName) {
    const target = this.activeGoal?.memory?.activeCollectionTarget;
    if (!target || !collectionSourceMatches(requestedName, target.name)) return null;
    return { ...target.position };
  }

  collectionExclusions() {
    return (this.activeGoal?.memory?.failedTargets || [])
      // A clock tick is not material evidence that an unchanged block became
      // reachable. Failed collection coordinates remain excluded for this goal;
      // a new goal or verified physical progress supplies the changed context.
      .filter(entry => entry.kind === 'collect')
      // A failed block inside a vein or tree is evidence about that local
      // source, not merely one coordinate. Exclude the compact source region
      // so replanning cannot select an adjacent block in the same candidate.
      .map(entry => ({ ...entry.position, radius: FAILED_TARGET_EXCLUSION_RADIUS }));
  }

  handleResult(kind, result) {
    if (!this.activeGoal) return;
    const actingSubgoal = this.activeGoal.subgoals.at(-1);
    const inventoryAfter = this.currentInventory(this.activeGoal);
    const plannedTargetAfter = actingSubgoal?.targetName
      ? plannedInventoryCount(this.agent.bot, actingSubgoal.targetName, actingSubgoal.targetFamily)
      : 0;
    const skillBeforeFinish = actionResultEvidence(result);
    const workstationTransaction = normalizeWorkstationTransactionReceipt(
      skillBeforeFinish?.transaction,
    );
    const transferredBeforeFinish = Math.max(0, Math.floor(Number(skillBeforeFinish?.transferred) || 0));
    let effectiveResult = result;
    if (
      result.phase === 'succeeded'
      && kind === 'acquire'
      && inventoryAfter <= Math.max(0, Number(actingSubgoal?.inventoryBefore) || 0)
    ) {
      effectiveResult = {
        ...result,
        phase: 'failed',
        code: 'no_inventory_progress',
        detail: result.detail
          ? `${result.detail} The typed goal observed no required inventory increase.`
          : 'The command resolved but the typed goal observed no required inventory increase.',
        retryable: true,
      };
    } else if (result.phase === 'succeeded' && kind === 'deliver' && transferredBeforeFinish < 1) {
      effectiveResult = {
        ...result,
        phase: 'failed',
        code: 'delivery_unverified',
        detail: result.detail || 'The delivery command resolved without verified recipient pickup.',
        retryable: true,
      };
    }
    const miningRouteProgress = verifiedMiningRouteProgress(
      kind,
      actionResultEvidence(effectiveResult),
    );
    const verifiedStepProgress = (
      kind === 'acquire'
      && inventoryAfter > Math.max(0, Number(actingSubgoal?.inventoryBefore) || 0)
    ) || (
      kind === 'plan'
      && actingSubgoal?.targetName
      && plannedTargetAfter > Math.max(0, Number(actingSubgoal.targetInventoryBefore) || 0)
    ) || (
      kind === 'deliver'
      && transferredBeforeFinish > 0
    ) || miningRouteProgress
      || workstationTransaction?.materialChanged === true;
    const completionBlocked = actionResultEvidence(effectiveResult)?.completionBlocked === true;
    if (verifiedStepProgress && effectiveResult.phase === 'failed' && !completionBlocked) {
      // A bounded adapter can produce only part of its requested inventory
      // effect, or advance a returnable corridor without producing the item
      // yet. Both are successful planner operations even though the original
      // executor result is incomplete. Normalize before finishing the subgoal
      // so lifecycle state and method learning follow verified Minecraft
      // progress while the Director replans the remaining work.
      effectiveResult = {
        ...effectiveResult,
        phase: 'succeeded',
        code: miningRouteProgress
          ? effectiveResult.code
          : 'verified_partial_progress',
        detail: miningRouteProgress
          ? effectiveResult.detail
          : `${effectiveResult.detail || 'The bounded action ended before its full effect.'} GoalDirector verified partial target-state progress and will replan the remainder.`,
        retryable: false,
      };
    }
    let durableActionCheckpoint = checkpointWithVerifiedMiningRoute(
      this.activeGoal.checkpoint,
      effectiveResult,
      this.agent.bot,
    );
    durableActionCheckpoint = checkpointAfterMiningReturnStep(
      durableActionCheckpoint,
      effectiveResult,
      actingSubgoal,
    );
    if (workstationTransaction) {
      const { workstationTransaction: _previousTransaction, ...checkpointWithoutTransaction } = durableActionCheckpoint;
      durableActionCheckpoint = {
        ...checkpointWithoutTransaction,
        ...(workstationTransaction.remainingQuantity > 0
          ? { workstationTransaction }
          : {}),
      };
    }
    if (durableActionCheckpoint !== this.activeGoal.checkpoint) {
      // Persist the route or its completed cell before ActionManager releases
      // the physical action. A restart may re-verify the world, but it must
      // never forget the only proven way out of a corridor it just created.
      this.persist({
        ...this.activeGoal,
        checkpoint: durableActionCheckpoint,
        updatedAt: this.now(),
      });
    }
    const safetySuspended = effectiveResult.phase !== 'succeeded'
      && isPreemption(effectiveResult)
      && this.agent.behavior_arbiter?.matchesControlSuspension?.({
        owner: 'player_goal',
        obligationId: this.activeGoal.id,
        actionId: effectiveResult.actionId,
      }) === true;
    if (safetySuspended) {
      this.suspendLatestSubgoal(effectiveResult);
      return;
    }
    this.finishLatestSubgoal(effectiveResult);
    const finishedSkill = actionResultEvidence(effectiveResult);
    const pendingDeathRecovery = Boolean(
      effectiveResult.code === 'goal_owner_died'
      && finishedSkill?.kind === 'death_reconciliation'
      && Number(finishedSkill.recoverableItems) > 0
      && Number.isSafeInteger(Number(finishedSkill.recordedAt))
      && Number(finishedSkill.recordedAt) > 0
    );
    if (pendingDeathRecovery) {
      const goal = this.activeGoal;
      this.persist({
        ...goal,
        checkpoint: durableActionCheckpoint,
        phase: 'recover',
        // The recovery action, not the death notification, settles whether
        // this productive attempt was actually lost.
        attempts: goal.attempts,
        updatedAt: this.now(),
      });
      this.nextAttemptAt = this.now() + RETRY_DELAY_MS;
      this.setStatus(
        'recover',
        'goal_owner_died',
        effectiveResult.detail || 'The bot died with a persisted recoverable inventory; recovery owns the pending attempt verdict.',
        true,
      );
      return;
    }
    if (
      kind === 'plan'
      && finishedSkill?.kind === 'entity_harvest'
      && finishedSkill?.outcome === 'source_access_pending'
      && (
        finishedSkill.sourceAccess
        || finishedSkill.targetIdentity?.stage === 'physical_address_stale'
      )
    ) {
      const goal = this.activeGoal;
      const replay = sourceHarvestReplayFromSettlement(
        effectiveResult,
        actingSubgoal,
        finishedSkill,
      );
      this.persist({
        ...goal,
        checkpoint: durableActionCheckpoint,
        memory: {
          ...goal.memory,
          sourceAccessPending: finishedSkill.sourceAccess ? {
            ...finishedSkill.sourceAccess,
            replay,
          } : goal.memory.sourceAccessPending,
          sourceSearchPending: null,
        },
        phase: 'assess',
        updatedAt: this.now(),
      });
      this.nextAttemptAt = this.now() + TEMPORAL_FEASIBILITY_RECHECK_MS;
      this.setStatus(
        'waiting',
        'waiting_for_hostile_source_access_change',
        'A qualified hostile source is loaded but its current pursuit failed; waiting for new entity or movement evidence without consuming a productive attempt.',
        true,
      );
      return;
    }
    if (
      kind === 'plan'
      && finishedSkill?.kind === 'entity_harvest'
      && [
        'source_spawn_pending',
        'source_search_advanced',
      ].includes(finishedSkill?.outcome)
    ) {
      const goal = this.activeGoal;
      const replay = sourceHarvestReplayFromSettlement(
        effectiveResult,
        actingSubgoal,
        finishedSkill,
      );
      this.persist({
        ...goal,
        checkpoint: durableActionCheckpoint,
        memory: {
          ...goal.memory,
          sourceAccessPending: null,
          sourceSearchPending: {
            outcome: finishedSkill.outcome,
            replay,
            observedAt: this.now(),
          },
        },
        phase: 'assess',
        updatedAt: this.now(),
      });
      this.nextAttemptAt = this.now() + TEMPORAL_FEASIBILITY_RECHECK_MS;
      this.setStatus(
        'waiting',
        'waiting_for_hostile_source_change',
        finishedSkill.outcome === 'source_search_advanced'
          ? 'The bounded night search physically reached one new region but found no usable Spider; waiting for new live source evidence without consuming a productive attempt.'
          : 'The bounded night search produced no usable local Spider; waiting for new live source evidence without consuming a productive attempt.',
        true,
      );
      return;
    }
    if (
      kind === 'plan'
      && finishedSkill?.kind === 'entity_harvest'
      && (
        this.activeGoal?.memory?.sourceAccessPending
        || this.activeGoal?.memory?.sourceSearchPending
      )
    ) {
      // The in-flight replay retained the latch across a possible restart.
      // Any other structured settlement consumes that retry authority; another
      // access receipt above replaces it with the new entity/position instead.
      const goal = this.activeGoal;
      this.persist({
        ...goal,
        memory: {
          ...goal.memory,
          sourceAccessPending: null,
          sourceSearchPending: null,
        },
        updatedAt: this.now(),
      });
    }
    this.rememberOperationalProgress(effectiveResult, miningRouteProgress);
    this.rememberToolRequirement(effectiveResult);
    this.rememberWorkstationRequirement(effectiveResult);
    this.rememberAccessRequirement(effectiveResult);
    // A bounded multi-item action may make verified material progress before
    // its remaining work times out. Replan from that real inventory delta
    // instead of blacklisting the productive target and walking away from it.
    if (!verifiedStepProgress) this.rememberFailedTarget(effectiveResult);
    const goal = this.activeGoal;
    const skill = actionResultEvidence(effectiveResult);
    const surfaceRecoveryProgress = verifiedSurfaceRecoveryProgress(kind, skill);
    const capacityBlocked = skill?.outcome === 'inventory_full'
      || effectiveResult.code === 'skill_inventory_full';
    const prerequisiteBlocked = Boolean(
      skill?.toolRequirement || skill?.workstationRequirement || skill?.accessRequirement,
    );
    let checkpoint = goal.checkpoint;

    if (kind === 'deliver') {
      const transferred = Math.max(0, Math.floor(Number(skill?.transferred) || 0));
      if (transferred > 0) {
        checkpoint = {
          ...checkpoint,
          delivered: Math.min(goal.quantity, checkpoint.delivered + transferred),
        };
      }
    }

    const currentInventory = this.currentInventory(goal);
    const acquired = goal.kind === 'deliver'
      ? currentInventory >= Math.max(0, goal.quantity - checkpoint.delivered)
      : currentInventory >= checkpoint.targetInventory;
    const delivered = goal.kind === 'deliver' && checkpoint.delivered >= goal.quantity;
    // Player navigation emits this result only after native Pathfinder has
    // consumed a best-frontier path and strictly improved the goal metric. It
    // is productive Mission progress, not a failed handoff and not a reason to
    // relocate away from the bound recipient. Re-dispatch delivery from the new
    // physical stance; a later no-progress result remains an ordinary failure.
    const partialDeliveryRouteProgress = Boolean(
      kind === 'deliver'
      && effectiveResult.phase === 'failed'
      && effectiveResult.retryable === true
      && effectiveResult.code === 'skill_closest_explored'
    );
    const madeProgress = verifiedStepProgress
      || surfaceRecoveryProgress
      || transferredProgress(skill)
      || partialDeliveryRouteProgress
      || (
        ['acquire', 'plan'].includes(kind)
        && effectiveResult.phase === 'succeeded'
      );

    if (completionBlocked) {
      // Inventory progress cannot erase a physical postcondition owned by the
      // capability. A tree transaction that left connected logs, temporary
      // scaffolding, or an unsafe body stance is not complete merely because
      // the requested item floor happened to be reached.
      const recoverableTreeTerrain = skill?.kind === 'collect'
        && skill?.outcome === 'tree_terrain_settlement_unverified';
      if (recoverableTreeTerrain) {
        this.persist({
          ...goal,
          checkpoint,
          phase: 'recover',
          evidence: {
            ...goal.evidence,
            completionBlocked: true,
          },
          updatedAt: this.now(),
        });
        this.nextAttemptAt = this.now() + PREEMPTION_RESUME_MS;
        this.setStatus(
          'recover',
          effectiveResult.code || 'tree_terrain_settlement_unverified',
          'The tree transaction remains incomplete until surface recovery verifies a usable nearby terrain stance.',
          true,
        );
        return;
      }
      this.persist({
        ...goal,
        checkpoint,
        updatedAt: this.now(),
      });
      this.fail(
        effectiveResult.code || 'capability_postcondition_blocked',
        effectiveResult.detail || 'The capability produced items but did not satisfy its required physical postcondition.',
        { retryable: false, completionBlocked: true },
      );
      return;
    }

    if (delivered) {
      this.persist({ ...goal, checkpoint, phase: 'verify_complete', updatedAt: this.now() });
      this.nextAttemptAt = this.now() + SUCCESS_DELAY_MS;
      return;
    }
    if (effectiveResult.phase === 'succeeded' || madeProgress) {
      const continueSurfaceRecovery = surfaceRecoveryProgress
        && needsSurfaceRecovery(goal, this.agent.bot);
      this.persist({
        ...goal,
        checkpoint,
        memory: surfaceRecoveryProgress
          ? { ...goal.memory, surfaceRecoveryFailure: null }
          : goal.memory,
        // A successful relocation changes the search area, not the goal's
        // material state. Preserve the failure budget until acquisition or
        // delivery makes verified progress, otherwise recovery can loop forever.
        attempts: madeProgress && !surfaceRecoveryProgress ? 0 : goal.attempts,
        phase: continueSurfaceRecovery
          ? 'recover'
          : acquired
            ? (goal.kind === 'deliver' ? 'deliver' : 'verify_complete')
            : 'assess',
        updatedAt: this.now(),
      });
      this.nextAttemptAt = this.now() + SUCCESS_DELAY_MS;
      this.setStatus(
        continueSurfaceRecovery ? 'recover' : 'assess',
        continueSurfaceRecovery ? 'verified_surface_progress' : effectiveResult.code || 'subgoal_succeeded',
        continueSurfaceRecovery
          ? Number(skill.verticalProgress) >= 1
            ? `Surface recovery advanced ${Math.round(Number(skill.verticalProgress) * 10) / 10} vertical blocks on safe support; continuing toward the bound surface stance.`
            : `Surface recovery opened ${Math.max(1, Math.floor(Number(skill.excavated) || 0))} verified corridor block${Number(skill.excavated) === 1 ? '' : 's'} while retaining safe support; continuing the same escape.`
          : effectiveResult.detail || 'Verified subgoal completed.',
        true,
      );
      return;
    }

    const preemptionRecovery = isPreemption(effectiveResult);
    const miningReturnFailure = kind === 'recover'
      && actingSubgoal?.commandName === '!traverseMiningRouteCell';
    const miningReturnRejoin = miningReturnFailure
      ? miningRouteRejoinDecision({ ...goal, checkpoint }, this.agent.bot)
      : null;
    const surfaceRecoveryFailure = kind === 'recover'
      && actingSubgoal?.commandName === '!goToSurface'
      && needsSurfaceRecovery(goal, this.agent.bot);
    const surfaceFailureSkill = surfaceRecoveryFailure
      ? actionResultEvidence(effectiveResult)
      : null;
    const observedSurfaceFailureCell = surfaceFailureSkill?.observed
      && [
        surfaceFailureSkill.observed.x,
        surfaceFailureSkill.observed.y,
        surfaceFailureSkill.observed.z,
      ].every(Number.isFinite)
      ? {
          x: Math.floor(surfaceFailureSkill.observed.x),
          y: Math.floor(surfaceFailureSkill.observed.y),
          z: Math.floor(surfaceFailureSkill.observed.z),
        }
      : null;
    const previousSurfaceFailure = goal.memory?.surfaceRecoveryFailure || null;
    const repeatedUnchangedSurfaceFailure = Boolean(
      surfaceRecoveryFailure
      && previousSurfaceFailure
      && previousSurfaceFailure.code === (effectiveResult.code || 'surface_recovery_leg_failed')
      && previousSurfaceFailure.detail === (effectiveResult.detail || '')
      && previousSurfaceFailure.cell
      && observedSurfaceFailureCell
      && previousSurfaceFailure.cell.x === observedSurfaceFailureCell.x
      && previousSurfaceFailure.cell.y === observedSurfaceFailureCell.y
      && previousSurfaceFailure.cell.z === observedSurfaceFailureCell.z
    );
    const miningReturnFailureOutcome = skill?.failureOutcome || skill?.outcome || '';
    const invalidMiningReturnFailure = miningReturnFailure
      && (
        INVALID_MINING_RETURN_CODES.has(effectiveResult.code)
        || INVALID_MINING_RETURN_OUTCOMES.has(miningReturnFailureOutcome)
      );
    const deathRecoveryFailure = kind === 'recover'
      && actingSubgoal?.commandName === '!recoverDeathItems';
    const deathRecoveryProgress = Boolean(
      deathRecoveryFailure
      && skill?.kind === 'death_recovery'
      && skill?.outcome === 'items_partially_recovered'
      && Number.isFinite(Number(skill.recovered))
      && Number(skill.recovered) > Number(goal.memory?.deathRecovery?.recovered || 0)
    );
    const relocationFailure = kind === 'recover' && !deathRecoveryFailure;
    // Being outranked is not an attempt at the goal. Charging one meant a few
    // fights on the way to the iron drained the same budget a genuinely
    // unreachable target does, and the goal gave up on work that was fine.
    const deathFailure = effectiveResult.code === 'death_recovery_persistence_failed';
    const targetScopedPlanFailure = kind === 'plan'
      && this.activeGoal?.subgoals?.at(-1)?.failureScope === 'target';
    if (deathRecoveryProgress) {
      const recovered = Math.max(0, Math.floor(Number(skill.recovered) || 0));
      const missing = Math.max(0, Math.floor(Number(skill.missing) || 0));
      this.persist({
        ...goal,
        checkpoint,
        memory: {
          ...goal.memory,
          deathRecovery: {
            ...goal.memory?.deathRecovery,
            recovered,
            missing,
          },
        },
        // A strictly larger cumulative manifest is real progress on the
        // pending death obligation. Preserve the productive Goal attempt; an
        // unchanged later recovery result still spends the bounded budget.
        attempts: goal.attempts,
        phase: 'recover',
        updatedAt: this.now(),
      });
      this.nextAttemptAt = this.now() + RETRY_DELAY_MS;
      this.setStatus(
        'recover',
        'death_recovery_progress',
        `Recovered ${recovered} recorded item${recovered === 1 ? '' : 's'}; ${missing} remain on the bound death manifest.`,
        true,
      );
      return;
    }
    const attempts = deathFailure || deathRecoveryFailure
      ? goal.attempts + 1
      : (
          preemptionRecovery
          || relocationFailure
          || prerequisiteBlocked
          || capacityBlocked
          || targetScopedPlanFailure
        )
        ? goal.attempts
        : goal.attempts + 1;
    if (deathRecoveryFailure) {
      this.persist({
        ...goal,
        checkpoint,
        attempts,
        phase: attempts < goal.maxAttempts && effectiveResult.retryable === true
          ? 'recover'
          : goal.phase,
        updatedAt: this.now(),
      });
      if (attempts < goal.maxAttempts && effectiveResult.retryable === true) {
        this.nextAttemptAt = this.now() + RETRY_DELAY_MS;
        this.setStatus(
          'recover',
          effectiveResult.code || 'death_recovery_failed',
          effectiveResult.detail || 'The recorded death inventory was not recovered; retrying within the bounded Goal budget.',
          true,
        );
        return;
      }
      const exhausted = attempts >= goal.maxAttempts;
      this.fail(
        exhausted ? 'goal_attempts_exhausted' : effectiveResult.code || 'death_recovery_failed',
        exhausted
          ? `${effectiveResult.detail || 'The recorded death inventory was not recovered.'} The goal exhausted its ${goal.maxAttempts} bounded attempts.`
          : effectiveResult.detail || 'The recorded death inventory could not be recovered.',
        { retryable: false },
      );
      return;
    }
    if (capacityBlocked) {
      // The collection primitive has already exhausted its bounded safe release
      // policy. Inventory capacity is a physical precondition, not a failed ore
      // target and not a reason to relocate four times. Fail truthfully without
      // charging productive attempts; a later request can resume after storage
      // or inventory policy creates room.
      this.persist({
        ...goal,
        checkpoint,
        attempts,
        updatedAt: this.now(),
      });
      this.fail(
        'inventory_capacity_blocked',
        effectiveResult.detail || 'The goal cannot reserve safe working inventory slots.',
      );
      return;
    }
    if (
      prerequisiteBlocked
      && budgetedSubgoalCount(goal) < goal.maxSubgoals
    ) {
      this.persist({
        ...goal,
        checkpoint,
        attempts,
        phase: 'assess',
        updatedAt: this.now(),
      });
      this.nextAttemptAt = this.now() + PREEMPTION_RESUME_MS;
      this.setStatus(
        'planning',
        skill.workstationRequirement
          ? 'carried_workstation_required'
          : skill.accessRequirement
            ? 'source_access_required'
            : 'tool_replacement_required',
        skill.workstationRequirement
          ? `The unreachable ${skill.workstationRequirement.name} must be replaced by a carried local workstation.`
          : skill.accessRequirement
            ? 'The selected physical source requires a verified supported surface stance before acquisition can continue.'
            : `The selected capability requires ${skill.toolRequirement.name} with at least ${skill.toolRequirement.minimumUsableDurability} usable durability.`,
        true,
      );
      return;
    }
    if (
      preemptionRecovery
      && budgetedSubgoalCount(goal) < goal.maxSubgoals
    ) {
      this.persist({
        ...goal,
        checkpoint,
        attempts,
        // A reflex may interrupt recovery without invalidating the productive
        // failure that selected it. Resume the same deterministic recovery
        // before rebuilding the material plan, otherwise every combat or
        // hazard check inserts another identical acquisition failure.
        phase: kind === 'recover' ? 'recover' : 'assess',
        updatedAt: this.now(),
      });
      this.nextAttemptAt = this.now() + PREEMPTION_RESUME_MS;
      this.setStatus(
        'waiting',
        'preemption_cleared',
        'The higher-priority action released control; reassessing the same goal immediately.',
        true,
      );
      return;
    }
    if (
      miningReturnFailure
      && !invalidMiningReturnFailure
      && ['ready', 'occupied'].includes(miningReturnRejoin?.state)
    ) {
      const rejoinCheckpoint = miningReturnRejoin.state === 'occupied'
        ? {
            ...checkpoint,
            miningReturnIndex: miningReturnRejoin.index,
          }
        : checkpoint;
      const detail = miningReturnRejoin.state === 'occupied'
        ? `The interrupted return settled on preserved route cell ${miningReturnRejoin.index + 1}; continuing from that verified cursor instead of replaying the failed segment.`
        : `The interrupted return displaced the body from its retained spine; scheduling another bounded route rejoin before continuing the same expedition.`;
      const continuationPhase = miningReturnRejoin.state === 'occupied'
        ? 'assess'
        : 'recover';
      this.persist({
        ...goal,
        checkpoint: rejoinCheckpoint,
        attempts,
        phase: continuationPhase,
        evidence: {
          actionId: effectiveResult.actionId || '',
          phase: continuationPhase,
          code: miningReturnRejoin.state === 'occupied'
            ? 'mining_route_rebound'
            : 'mining_route_rejoin_required',
          detail,
          verified: miningReturnRejoin.state === 'occupied',
          at: this.now(),
        },
        updatedAt: this.now(),
      });
      this.nextAttemptAt = this.now() + PREEMPTION_RESUME_MS;
      this.setStatus(
        miningReturnRejoin.state === 'occupied' ? 'planning' : 'recover',
        miningReturnRejoin.state === 'occupied'
          ? 'mining_route_rebound'
          : 'mining_route_rejoin_required',
        detail,
        true,
      );
      return;
    }
    if (invalidMiningReturnFailure) {
      // The exact mined corridor is evidence, not a prison. Once its live
      // geometry changes and the cell-level repair cannot restore it, discard
      // only that stale route. Delivery returns to its player-bound action;
      // productive work underground hands to live surface recovery before the
      // same Goal is reassessed. Neither path replays the invalid cell or
      // spends a productive attempt.
      const rerouteCheckpoint = {
        ...checkpoint,
        miningReturnRoute: [],
        miningReturnIndex: -1,
        miningReturnDimension: null,
        miningReturnInvalidation: {
          code: effectiveResult.code,
          target: effectiveResult.target || null,
          at: this.now(),
        },
      };
      const rerouteEvidence = {
        actionId: effectiveResult.actionId || '',
        phase: 'assess',
        code: goal.kind === 'deliver'
          ? 'mining_return_dynamic_reroute'
          : 'mining_return_route_invalidated',
        detail: effectiveResult.detail
          || 'The preserved mining route changed; continuing the same Goal from live position.',
        verified: false,
        at: this.now(),
      };
      const continuationPhase = goal.kind === 'deliver'
        ? 'deliver'
        : needsSurfaceRecovery({
            ...goal,
            checkpoint: rerouteCheckpoint,
            evidence: rerouteEvidence,
          }, this.agent.bot)
          ? 'recover'
          : 'assess';
      this.persist({
        ...goal,
        checkpoint: rerouteCheckpoint,
        attempts,
        phase: continuationPhase,
        evidence: {
          ...rerouteEvidence,
          phase: continuationPhase,
        },
        updatedAt: this.now(),
      });
      this.nextAttemptAt = this.now() + PREEMPTION_RESUME_MS;
      this.setStatus(
        continuationPhase,
        rerouteEvidence.code,
        goal.kind === 'deliver'
          ? 'The exact return cell changed; continuing the same delivery through a fresh live route.'
          : continuationPhase === 'recover'
            ? 'The exact return cell changed underground; handing the same Goal to live surface recovery.'
            : 'The exact return cell changed; reassessing the same Goal from live state.',
        true,
      );
      return;
    }
    if (miningReturnFailure) {
      // Route traversal already performs bounded debris settlement and exact
      // stance verification. Reissuing the identical blocked cell would be a
      // recovery loop, not a new strategy, and must not consume productive
      // attempts or quietly release the completed inventory goal underground.
      this.persist({
        ...goal,
        checkpoint,
        attempts,
        updatedAt: this.now(),
      });
      this.fail(
        'mining_return_failed',
        effectiveResult.detail || 'The preserved mining return route could not be traversed safely.',
      );
      return;
    }
    if (surfaceRecoveryFailure) {
      if (repeatedUnchangedSurfaceFailure) {
        // A second identical settlement from the same physical cell is not a
        // new surface leg. End the method instead of manufacturing an infinite
        // retry budget around one unchanged corridor failure.
        const detail = effectiveResult.detail
          || 'The same surface-recovery method failed twice from the same occupied cell without physical progress.';
        this.persist({
          ...goal,
          checkpoint,
          attempts,
          updatedAt: this.now(),
        });
        this.recordTerminalBoundary('surface_recovery_method_exhausted', {
          code: 'surface_recovery_method_exhausted',
          detail,
        });
        this.fail('surface_recovery_method_exhausted', detail, { retryable: false });
        return;
      }
      // Surface escape is a multi-leg body objective. A retryable leg can end
      // after settling or changing corridor geometry without gaining height.
      // Returning to delivery here drives the body into the same blocked edge.
      this.persist({
        ...goal,
        checkpoint,
        attempts,
        phase: 'recover',
        memory: {
          ...goal.memory,
          surfaceRecoveryFailure: {
            code: effectiveResult.code || 'surface_recovery_leg_failed',
            detail: effectiveResult.detail || '',
            cell: observedSurfaceFailureCell,
            at: this.now(),
          },
        },
        updatedAt: this.now(),
      });
      this.nextAttemptAt = this.now() + RETRY_DELAY_MS;
      this.setStatus(
        'recover',
        effectiveResult.code || 'surface_recovery_leg_failed',
        effectiveResult.detail || 'The current surface leg did not settle; rebinding the next escape leg from live position.',
        true,
      );
      return;
    }
    const failedDeliveryRelocation = relocationFailure
      && goal.kind === 'deliver'
      && actingSubgoal?.commandName === '!moveAway';
    if (failedDeliveryRelocation) {
      // Delivery has one bound recipient and one unchanged handoff objective.
      // If its bounded relocation made no verified progress, replaying the
      // same delivery cannot reveal a different route or target. Finish with a
      // non-retryable structured boundary so Agenda cannot clone the same Goal
      // with a fresh budget against materially identical world evidence.
      const detail = effectiveResult.detail
        || 'The bounded delivery relocation made no verified progress; no different deterministic handoff route was established.';
      this.persist({
        ...goal,
        checkpoint,
        attempts,
        updatedAt: this.now(),
      });
      this.recordTerminalBoundary('no_deterministic_recovery', {
        code: 'no_deterministic_recovery',
        detail,
      });
      this.fail('no_deterministic_recovery', detail, { retryable: false });
      return;
    }
    if (
      relocationFailure
      && attempts < goal.maxAttempts
      && budgetedSubgoalCount(goal) < goal.maxSubgoals
    ) {
      // Relocation is the one bounded response to an acquisition failure; it
      // is not another acquisition attempt. If it also stalls, immediately
      // rebuild the plan from failed-target memory instead of issuing the same
      // movement again until the whole goal budget is gone.
      this.persist({
        ...goal,
        checkpoint,
        attempts,
        phase: 'assess',
        updatedAt: this.now(),
      });
      this.nextAttemptAt = this.now() + PREEMPTION_RESUME_MS;
      this.setStatus(
        'waiting',
        'relocation_failed_replan',
        'The bounded relocation made no verified progress; changing target or strategy from live state now.',
        true,
      );
      return;
    }
    const deliveryRecovery = kind === 'deliver'
      && /(?:lost_target|not_received|pickup_unverified|delivery_unverified)/.test(String(effectiveResult.code || ''));
    if (
      (effectiveResult.retryable === true || deliveryRecovery || preemptionRecovery)
      && attempts < goal.maxAttempts
      && budgetedSubgoalCount(goal) < goal.maxSubgoals
    ) {
      this.persist({
        ...goal,
        checkpoint,
        attempts,
        phase: 'recover',
        updatedAt: this.now(),
      });
      this.nextAttemptAt = this.now() + RETRY_DELAY_MS;
      this.setStatus('recover', effectiveResult.code || 'subgoal_failed', effectiveResult.detail || 'Subgoal failed and may be retried.', true);
      return;
    }
    // The terminal failure is still a completed physical attempt. Persist its
    // charge and any checkpoint change before fail() snapshots the durable
    // goal; otherwise the final action exists in subgoals but not in attempts.
    this.persist({
      ...goal,
      checkpoint,
      attempts,
      updatedAt: this.now(),
    });
    this.fail(
      effectiveResult.code || 'goal_attempts_exhausted',
      effectiveResult.detail || `Goal exhausted its bounded recovery budget after ${attempts} failed attempts.`,
    );
  }

  dispatch(kind, command, step = null) {
    if (!this.activeGoal || this.inFlight) return false;
    if (budgetedSubgoalCount(this.activeGoal) >= this.activeGoal.maxSubgoals) {
      this.fail('subgoal_budget_exhausted', `Goal reached its ${this.activeGoal.maxSubgoals}-subgoal safety limit.`);
      return false;
    }
    const capability = step?.capability || null;
    const selectedName = capability
      ? capabilityCommandName(capability)
      : commandName(command);
    const safeGoalCommand = isSafeProcedureCommand(selectedName)
      || (kind === 'recover' && GOAL_ONLY_RECOVERY_COMMANDS.has(selectedName));
    if (!selectedName || !safeGoalCommand || !getCommand(selectedName)) {
      this.fail('unsafe_goal_command', `Goal attempted unavailable or unsafe command '${selectedName || 'unknown'}'.`);
      return false;
    }
    if (this.agent.blocked_actions?.includes(selectedName)) {
      this.fail('blocked_goal_command', `Goal command ${selectedName} is disabled for this bot.`);
      return false;
    }

    this.appendActingSubgoal(kind, capabilityCommand(capability) || command, step);
    const goalAtDispatch = this.activeGoal;
    const dispatchToken = Object.freeze({
      generation: this.dispatchGeneration + 1,
      goalId: goalAtDispatch.id,
    });
    this.dispatchGeneration = dispatchToken.generation;
    this.activeDispatch = dispatchToken;
    this.inFlight = true;
    this.setStatus('acting', `goal_${kind}`, `Executing ${selectedName} through the deterministic command path.`, true);
    const materialToken = goalMaterialToken(goalAtDispatch, kind, step);
    const execution = capability
      ? executeCapabilityAction(capability, {
        agent: this.agent,
        executeCommand: this.executeGoalCommand,
        owner: 'player',
        routeOrigin: 'goal-director',
        missionId: goalAtDispatch.id,
        activityId: `${kind}:${selectedName}`,
        materialToken,
      })
      : Promise.resolve(this.executeGoalCommand(this.agent, command, {
        owner: 'player',
        routeOrigin: 'goal-director',
        missionId: goalAtDispatch.id,
        activityId: `${kind}:${selectedName}`,
        materialToken,
        returnExecution: true,
      })).then(commandExecution => {
        const hasExecutionEnvelope = commandExecution
          && typeof commandExecution === 'object'
          && Object.hasOwn(commandExecution, 'value')
          && Object.hasOwn(commandExecution, 'result');
        return {
          value: hasExecutionEnvelope ? commandExecution.value : commandExecution,
          verification: null,
          result: hasExecutionEnvelope ? commandExecution.result || null : null,
        };
      });
    void Promise.resolve(execution)
      .then(outcome => {
        if (!this.canSettleDispatch(dispatchToken)) return;
        let result = outcome?.result || null;
        if (!result?.actionId) {
          result = {
            actionId: `missing-${this.now()}`,
            phase: 'failed',
            code: 'missing_action_result',
            detail: `${selectedName} returned without a new structured action result.`,
            retryable: true,
            evidence: null,
          };
        }
        this.handleResult(kind, result);
      })
      .catch(error => {
        if (!this.canSettleDispatch(dispatchToken)) return;
        this.handleResult(kind, {
          actionId: `dispatch-${this.now()}`,
          phase: 'failed',
          code: 'goal_dispatch_error',
          detail: boundedText(error?.message || error),
          retryable: true,
          evidence: null,
        });
      })
      .finally(() => {
        if (!this.ownsDispatch(dispatchToken)) return;
        this.activeDispatch = null;
        this.inFlight = false;
      });
    return true;
  }

  rememberDeliveryTarget(goalId, observation) {
    if (!this.activeGoal || this.activeGoal.id !== goalId) return null;
    const position = physicalPosition(observation?.position);
    const player = boundedText(observation?.player || this.activeGoal.destination?.player, 64);
    const dimension = boundedText(observation?.dimension, 64) || null;
    if (!position || !player || !dimension) return null;
    const goal = this.activeGoal;
    return this.persist({
      ...goal,
      memory: {
        ...goal.memory,
        deliveryTarget: {
          player,
          position,
          dimension,
          source: boundedText(observation?.source, 32) || 'last_seen',
          observedAt: Number.isFinite(observation?.observedAt)
            ? observation.observedAt
            : this.now(),
        },
      },
      updatedAt: this.now(),
    }).memory.deliveryTarget;
  }

  companionDeliveryTarget(goal) {
    const context = this.agent.companion_context?.snapshot?.();
    if (!context?.lastSeenPosition || !context?.lastSeenDimension) return null;
    const observedName = context.canonicalUsername || context.requestedName || context.alias;
    if (!playerNamesMatch(goal.destination.player, observedName)) return null;
    return {
      player: observedName,
      position: context.lastSeenPosition,
      dimension: context.lastSeenDimension,
      source: context.lastSeenSource || 'mineflayer_last_seen',
      observedAt: Number.isFinite(context.lastSeenAt) ? context.lastSeenAt : this.now(),
    };
  }

  waitForPlayer(goal) {
    const resolution = resolvePlayerTarget(this.agent.bot, goal.destination.player, {
      knownBotNames: this.agent.getKnownAgentNames?.() || [],
    });
    if (resolution.entity && resolution.canonical) {
      this.rememberDeliveryTarget(goal.id, {
        player: resolution.canonical,
        position: resolution.entity.position,
        dimension: this.agent.bot?.game?.dimension,
        source: 'mineflayer_entity',
        observedAt: this.now(),
      });
      return true;
    }

    const companion = this.agent.companion_context?.snapshot?.();
    const lookupMatches = playerNamesMatch(
      companion?.authoritativePlayer,
      goal.destination.player,
    );
    const persistedTarget = this.activeGoal?.memory?.deliveryTarget || goal.memory?.deliveryTarget || null;
    const persistedMatches = playerNamesMatch(persistedTarget?.player, goal.destination.player)
      && physicalPosition(persistedTarget?.position)
      && persistedTarget?.dimension
      && Number.isFinite(persistedTarget?.observedAt);
    const sharedTarget = this.companionDeliveryTarget(goal);
    let anchor = persistedMatches ? persistedTarget : null;
    if (
      sharedTarget
      && (!anchor || sharedTarget.observedAt > anchor.observedAt)
    ) {
      anchor = this.rememberDeliveryTarget(goal.id, sharedTarget) || sharedTarget;
    }
    const rememberedTargetFresh = playerNamesMatch(anchor?.player, goal.destination.player)
      && anchor?.source === 'managed_paper'
      && this.now() - anchor.observedAt < PLAYER_WAIT_MS;
    const lookupStale = !rememberedTargetFresh && (
      !lookupMatches
      || companion?.authoritativeCheckAge === null
      || companion?.authoritativeCheckAge >= PLAYER_WAIT_MS
    );
    if (lookupStale && typeof this.agent.locatePlayerPosition === 'function') {
      const goalId = goal.id;
      void this.agent.locatePlayerPosition(goal.destination.player)
        .then(observation => {
          if (!this.activeGoal || this.activeGoal.id !== goalId) return;
          if (observation?.success === true && observation?.found === true) {
            this.rememberDeliveryTarget(goalId, observation);
          }
          this.nextAttemptAt = 0;
          this.agent.behavior_arbiter?.wake?.('delivery_position_resolved');
        })
        .catch(() => {});
      this.persist({
        ...this.activeGoal,
        evidence: {
          actionId: '',
          phase: 'blocked',
          code: 'delivery_player_locating',
          detail: `Resolving ${goal.destination.player}'s authoritative Paper position before return.`,
          verified: false,
          at: this.now(),
        },
        updatedAt: this.now(),
      });
      this.nextAttemptAt = this.now() + 1_000;
      this.setStatus('waiting', 'delivery_player_locating', `Locating ${goal.destination.player} through the managed server.`, true);
      return false;
    }

    if (lookupMatches && companion?.authoritativeFound === false) {
      this.persist({
        ...this.activeGoal,
        evidence: {
          actionId: '',
          phase: 'blocked',
          code: 'delivery_player_offline',
          detail: `The managed server explicitly confirmed that ${goal.destination.player} is offline.`,
          verified: false,
          at: this.now(),
        },
        updatedAt: this.now(),
      });
      this.nextAttemptAt = this.now() + PLAYER_WAIT_MS;
      this.setStatus('waiting', 'delivery_player_offline', `Waiting for ${goal.destination.player} to join the managed server.`, true);
      return false;
    }

    const recentTechnicalFailure = lookupMatches
      && Number.isFinite(companion?.authoritativeCheckedAt)
      && companion?.authoritativeFound === null
      && Number.isFinite(companion?.authoritativeCheckAge)
      && companion.authoritativeCheckAge < PLAYER_WAIT_MS;
    if (recentTechnicalFailure) {
      this.persist({
        ...this.activeGoal,
        evidence: {
          actionId: '',
          phase: 'blocked',
          code: 'delivery_locator_unavailable',
          detail: `The managed server could not produce a complete current position for ${goal.destination.player}; waiting without using historical coordinates.`,
          verified: false,
          at: this.now(),
        },
        updatedAt: this.now(),
      });
      this.nextAttemptAt = this.now() + PLAYER_WAIT_MS;
      this.setStatus('waiting', 'delivery_locator_unavailable', `Waiting for a complete current location for ${goal.destination.player}.`, true);
      return false;
    }
    const botPosition = physicalPosition(this.agent.bot?.entity?.position);
    const anchorPosition = physicalPosition(anchor?.position);
    const botDimension = boundedText(this.agent.bot?.game?.dimension, 64) || null;
    const anchorComplete = Boolean(anchorPosition && anchor?.dimension && Number.isFinite(anchor?.observedAt));
    const anchorFresh = anchorComplete && this.now() - anchor.observedAt <= PLAYER_ANCHOR_MAX_AGE_MS;
    const sameDimension = anchorComplete
      && botDimension
      && normalizedDimension(anchor.dimension) === normalizedDimension(botDimension);
    if (anchorFresh && botPosition && sameDimension) {
      const distance = distanceBetween(botPosition, anchorPosition);
      if (distance > DELIVERY_REACQUIRE_DISTANCE) {
        const ageSeconds = Math.max(0, Math.round((this.now() - anchor.observedAt) / 1_000));
        this.persist({
          ...this.activeGoal,
          evidence: {
            actionId: '',
            phase: 'acting',
            code: 'delivery_returning_to_player_anchor',
            detail: `Returning through native Pathfinder to ${goal.destination.player}'s ${anchor.source} position (${ageSeconds}s old).`,
            verified: false,
            at: this.now(),
          },
          updatedAt: this.now(),
        });
        this.dispatch(
          'recover',
          `!goToCoordinates(${anchorPosition.x}, ${anchorPosition.y}, ${anchorPosition.z}, ${DELIVERY_REACQUIRE_DISTANCE})`,
        );
        return false;
      }
    }
    // Player presence is an external delivery precondition, not a productive
    // action or recovery failure. Charging this wait to `attempts` made a fully
    // crafted output terminally fail after four five-second presence checks.
    // Keep the typed goal durably in its delivery phase until the exact player
    // returns, Operator Stop cancels it, or a later player command supersedes it.
    this.persist({
      ...this.activeGoal,
      evidence: {
        actionId: '',
        phase: 'blocked',
        code: resolution.ambiguous
          ? 'delivery_player_ambiguous'
          : anchorComplete && !sameDimension
            ? 'delivery_player_other_dimension'
            : anchorComplete && !anchorFresh
              ? 'delivery_player_anchor_stale'
              : 'delivery_player_absent',
        detail: anchorFresh && anchorPosition
          ? `Waiting near ${goal.destination.player}'s last authoritative position for exact entity pickup verification.`
          : anchorComplete && !sameDimension
            ? `Waiting for ${goal.destination.player} to return to ${botDimension || 'the bot dimension'} before navigation.`
            : anchorComplete && !anchorFresh
              ? `Waiting for a fresh authoritative position for ${goal.destination.player}; historical coordinates are not movement authority.`
          : `Waiting for ${goal.destination.player} to be physically present for verified pickup.`,
        verified: false,
        at: this.now(),
      },
      updatedAt: this.now(),
    });
    this.nextAttemptAt = this.now() + PLAYER_WAIT_MS;
    this.setStatus(
      'waiting',
      this.activeGoal.evidence.code,
      `Waiting for ${goal.destination.player} to return.`,
      true,
    );
    return false;
  }

  update() {
    if (!this.activeGoal || this.inFlight || this.agent.isOperatorHeld?.()) return;
    if (!this.agent.isIdle?.() || !this.agent.self_prompter?.isStopped?.()) return;
    if (this.agent.job_director?.activeOrder) {
      this.setStatus('waiting', 'job_busy', 'Typed goal is waiting for the active work order to end.', true);
      return;
    }
    if (this.now() < this.nextAttemptAt) return;

    const pendingDeathRecordedAt = Number(this.activeGoal.memory?.deathRecovery?.recordedAt);
    const pendingDeathRecovery = hasPendingDeathItems(
      this.agent.memory_bank,
      pendingDeathRecordedAt,
    );
    if (
      pendingDeathRecovery
      && (
        this.activeGoal.phase !== 'recover'
        || this.activeGoal.evidence?.code !== 'goal_owner_died'
      )
    ) {
      this.persist({
        ...this.activeGoal,
        phase: 'recover',
        evidence: {
          actionId: '',
          phase: 'recover',
          code: 'goal_owner_died',
          detail: `The persisted death inventory ${pendingDeathRecordedAt} is still pending; recover it before replanning the active goal.`,
          verified: false,
          at: this.now(),
        },
        updatedAt: this.now(),
      });
    }
    const miningRegionRecovery = pendingMiningRegionRecovery(this.activeGoal);
    if (miningRegionRecovery?.state === 'failed') {
      this.fail(
        'mining_region_relocation_failed',
        miningRegionRecovery.failure.detail
          || 'The bounded region relocation could not establish a different safe mining region.',
        { retryable: false },
      );
      return;
    }
    if (miningRegionRecovery?.state === 'surface_failed') {
      this.fail(
        'mining_region_surface_staging_failed',
        miningRegionRecovery.failure.detail
          || 'The companion could not establish a usable surface stance before changing mining region.',
        { retryable: false },
      );
      return;
    }
    if (miningRegionRecovery?.state === 'exhausted') {
      this.fail(
        'mining_region_attempts_exhausted',
        `The local mining corridor was unsafe and the goal exhausted its ${this.activeGoal.maxAttempts} bounded productive attempts.`,
        { retryable: false },
      );
      return;
    }
    // A recorded death owns the next body action. Route geometry belongs to
    // the pre-death body and must not overwrite the persisted recovery before
    // the dropped inventory has been reconciled at its exact death identity.
    const routeRejoin = pendingDeathRecovery
      ? null
      : miningRouteRejoinDecision(this.activeGoal, this.agent.bot);
    if (
      routeRejoin?.state === 'occupied'
      && (
        goalOutputReadyForHandoff(this.agent.bot, this.activeGoal)
        || miningRegionRecovery?.state === 'pending'
      )
    ) {
      const { index, distance } = routeRejoin;
      const detail = `The body already occupies preserved mining route cell ${index + 1}; rewinding the return cursor to that verified cell before continuing the expedition.`;
      this.persist({
        ...this.activeGoal,
        phase: 'assess',
        checkpoint: {
          ...this.activeGoal.checkpoint,
          miningReturnIndex: index,
        },
        evidence: {
          actionId: '',
          phase: 'assess',
          code: 'mining_route_rebound',
          detail,
          verified: distance === 0,
          at: this.now(),
        },
        updatedAt: this.now(),
      });
      this.nextAttemptAt = this.now() + PREEMPTION_RESUME_MS;
      this.setStatus('planning', 'mining_route_rebound', detail, true);
      return;
    }
    if (routeRejoin?.state === 'dimension_changed') {
      this.fail(
        'mining_route_rejoin_dimension_changed',
        `The preserved mining spine is in ${routeRejoin.routeDimension}, but Kevin is in ${routeRejoin.currentDimension}; refusing a cross-dimension rejoin guess.`,
      );
      return;
    }
    if (['out_of_range', 'exhausted'].includes(routeRejoin?.state)) {
      this.persist({
        ...this.activeGoal,
        phase: 'assess',
        checkpoint: {
          ...this.activeGoal.checkpoint,
          miningReturnRoute: [],
          miningReturnIndex: -1,
          miningReturnDimension: null,
        },
        evidence: {
          actionId: '',
          phase: 'assess',
          code: routeRejoin.state === 'out_of_range'
            ? 'mining_route_rejoin_out_of_range'
            : 'mining_route_rejoin_exhausted',
          detail: routeRejoin.state === 'out_of_range'
            ? `The body is ${Math.round(routeRejoin.distance * 10) / 10} blocks from the nearest preserved route cell, outside the bounded ${MINING_ROUTE_REJOIN_MAX_DISTANCE}-block rejoin range; releasing that disconnected spine before surface recovery.`
            : 'Every separated native route-rejoin target failed; releasing the disconnected spine before surface recovery.',
          verified: false,
          at: this.now(),
        },
        updatedAt: this.now(),
      });
      this.nextAttemptAt = this.now() + PREEMPTION_RESUME_MS;
      this.setStatus(
        'planning',
        this.activeGoal.evidence.code,
        this.activeGoal.evidence.detail,
        true,
      );
      return;
    }
    if (routeRejoin?.state === 'ready') {
      const { cell, index, distance } = routeRejoin;
      const route = this.activeGoal.checkpoint?.miningReturnRoute || [];
      const routeCursor = Number.isFinite(this.activeGoal.checkpoint?.miningReturnIndex)
        ? Math.min(route.length - 1, Math.floor(this.activeGoal.checkpoint.miningReturnIndex))
        : route.length - 1;
      const routeIdentity = miningRouteIdentity(route, routeCursor);
      this.persist({
        ...this.activeGoal,
        phase: 'recover',
        evidence: {
          actionId: '',
          phase: 'recover',
          code: 'mining_route_rejoin_pending',
          detail: `Combat displaced the body ${Math.round(distance * 10) / 10} blocks from the retained spine; rebinding route cell ${index + 1} before continuing the same expedition.`,
          verified: false,
          at: this.now(),
        },
        updatedAt: this.now(),
      });
      this.dispatch(
        'recover',
        `!goToCoordinates(${cell.x}, ${cell.y}, ${cell.z}, 1)`,
        {
          learningKey: `mining-route-rejoin:${routeIdentity}:${index}`,
          reason: `Rejoin preserved mining route cell ${index + 1} after bounded hostile displacement.`,
        },
      );
      return;
    }

    const returnStep = pendingMiningReturn(this.activeGoal);
    if (
      returnStep
      && (
        goalOutputReadyForHandoff(this.agent.bot, this.activeGoal)
        || miningRegionRecovery?.state === 'pending'
      )
    ) {
      const routeDimension = normalizedDimension(this.activeGoal.checkpoint.miningReturnDimension);
      const currentDimension = normalizedDimension(this.agent.bot?.game?.dimension);
      if (routeDimension && currentDimension && routeDimension !== currentDimension) {
        this.fail(
          'mining_return_dimension_changed',
          `The preserved mining route is in ${routeDimension}, but the bot is now in ${currentDimension}; refusing to guess a cross-dimension return.`,
        );
        return;
      }
      const route = createCapabilityRequest('traverse_mining_route_cell', {
        ...returnStep.cell,
        dimension: routeDimension || currentDimension,
      }, {
        reason: miningRegionRecovery?.state === 'pending'
          ? 'Return through the exact verified mining route before changing the failed mining region.'
          : 'Exit the exact verified mining route before releasing the completed player outcome.',
      });
      this.persist({
        ...this.activeGoal,
        phase: 'recover',
        evidence: {
          actionId: '',
          phase: 'recover',
          code: miningRegionRecovery?.state === 'pending'
            ? 'mining_region_return_pending'
            : 'mining_return_pending',
          detail: miningRegionRecovery?.state === 'pending'
            ? `The local depth corridor failed; returning through preserved mining cell ${returnStep.index + 1} of ${this.activeGoal.checkpoint.miningReturnRoute.length} before changing region.`
            : `Returning through preserved mining cell ${returnStep.index + 1} of ${this.activeGoal.checkpoint.miningReturnRoute.length}.`,
          verified: false,
          at: this.now(),
        },
        updatedAt: this.now(),
      });
      this.dispatch('recover', route.command || null, route);
      return;
    }
    if (miningRegionRecovery?.state === 'pending') {
      const failedAt = Number(miningRegionRecovery.failure.finishedAt) || this.now();
      let atUsableSurface = false;
      try {
        atUsableSurface = occupiesUsableSurfaceStance(this.agent.bot);
      } catch {
        atUsableSurface = false;
      }
      if (!atUsableSurface) {
        this.persist({
          ...this.activeGoal,
          phase: 'recover',
          evidence: {
            actionId: '',
            phase: 'recover',
            code: 'mining_region_surface_pending',
            detail: 'The failed mining corridor is unwound, but region relocation requires a verified usable surface stance first.',
            verified: false,
            at: this.now(),
          },
          updatedAt: this.now(),
        });
        this.dispatch(
          'recover',
          '!goToSurface',
          {
            learningKey: `mining-region-surface:${failedAt}`,
            reason: 'Establish a verified usable surface stance before changing mining region.',
          },
        );
        return;
      }
      this.persist({
        ...this.activeGoal,
        phase: 'recover',
        evidence: {
          actionId: '',
          phase: 'recover',
          code: 'mining_region_relocation_pending',
          detail: 'The local mining region has been unwound; changing to a bounded different search region before retrying the same valid acquisition method.',
          verified: false,
          at: this.now(),
        },
        updatedAt: this.now(),
      });
      this.dispatch(
        'recover',
        `!moveAway(${ACQUISITION_REGION_RELOCATION_DISTANCE}, true)`,
        {
          learningKey: `mining-region-relocation:${failedAt}`,
          reason: 'Change physical mining region after a region-scoped depth-corridor failure.',
        },
      );
      return;
    }

    const verification = this.verify();
    if (verification.complete) {
      this.complete(verification);
      return;
    }

    let transitions = 0;
    while (this.activeGoal && !this.inFlight && transitions < 6) {
      transitions += 1;
      const goal = this.activeGoal;
      const procedure = goal.procedureId ? this.procedures.find(goal) : null;
      const current = this.currentInventory(goal);
      const remainingDelivery = goal.kind === 'deliver'
        ? Math.max(0, goal.quantity - goal.checkpoint.delivered)
        : 0;
      const required = goal.kind === 'deliver'
        ? remainingDelivery
        : goal.checkpoint.targetInventory;

      if (
        goal.attempts >= goal.maxAttempts
        && ['acquire', 'recover'].includes(goal.phase)
      ) {
        this.fail(
          'goal_attempts_exhausted',
          `Goal exhausted its ${goal.maxAttempts} productive-action attempts without verified completion.`,
        );
        return;
      }

      if (goal.phase === 'assess' || goal.phase === 'verify_acquired') {
        if (goal.kind === 'deliver' && current >= remainingDelivery) {
          this.persist({ ...goal, phase: 'deliver', updatedAt: this.now() });
        } else if (goal.kind === 'acquire') {
          this.persist({
            ...goal,
            phase: this.verify(goal).complete ? 'verify_complete' : 'acquire',
            updatedAt: this.now(),
          });
        } else {
          this.persist({ ...goal, phase: 'acquire', updatedAt: this.now() });
        }
        continue;
      }

      if (goal.phase === 'verify_complete') {
        const finalVerification = this.verify(goal);
        if (finalVerification.complete) this.complete(finalVerification);
        else this.persist({ ...goal, phase: 'assess', updatedAt: this.now() });
        continue;
      }

      if (goal.phase === 'recover') {
        if (goal.evidence?.code === 'goal_owner_died') {
          const command = recoveryCommand(
            goal,
            this.agent.bot,
            this.agent.memory_bank,
          );
          this.persist({ ...goal, phase: 'assess', updatedAt: this.now() });
          if (command) {
            this.dispatch('recover', command);
            return;
          }
          this.nextAttemptAt = this.now() + RETRY_DELAY_MS;
          this.setStatus(
            'waiting',
            'death_reconciled',
            'Death was charged to the bounded goal budget; no recoverable item manifest remains, so live inventory and strategy will be replanned.',
            true,
          );
          return;
        }
        if (goal.subgoals.at(-1)?.kind === 'plan') {
          if (latestPlanFailureHasConcreteTarget(goal)) {
            const localFailures = consecutiveLocalPlanFailures(goal);
            const disengagement = localFailures >= MAX_LOCAL_CONCRETE_TARGET_FAILURES
              ? plannedDisengagementCommand(goal, this.agent.bot)
              : null;
            if (disengagement) {
              this.persist({ ...goal, phase: 'assess', updatedAt: this.now() });
              this.dispatch('recover', disengagement);
              return;
            }
            this.persist({ ...goal, phase: 'assess', updatedAt: this.now() });
            this.nextAttemptAt = this.now() + PREEMPTION_RESUME_MS;
            this.setStatus(
              'planning',
              'concrete_target_excluded',
              `The failed physical source is excluded; selecting another target in this region (${localFailures}/${MAX_LOCAL_CONCRETE_TARGET_FAILURES}) before bounded relocation.`,
              true,
            );
            return;
          }
          const disengagement = plannedDisengagementCommand(goal, this.agent.bot);
          if (disengagement) {
            this.persist({ ...goal, phase: 'assess', updatedAt: this.now() });
            this.dispatch('recover', disengagement);
            return;
          }
          this.persist({ ...goal, phase: 'assess', updatedAt: this.now() });
          this.nextAttemptAt = this.now() + PREEMPTION_RESUME_MS;
          this.setStatus(
            'waiting',
            'causal_replan',
            `The last prerequisite changed or failed (${goal.evidence?.code || 'unknown'}); live inventory, world state, and failed-target memory will be planned again.`,
            true,
          );
          return;
        }
        // `giveToPlayer` already rebinds the live recipient and replans its
        // local stance twice before reporting `skill_drop_stance_unreachable`.
        // Replaying the same Activity here has no changed input and previously
        // burned the complete Goal budget in four identical attempts. Let the
        // normal deterministic-recovery decision below settle that unchanged
        // geometry truthfully instead.
        // A death can move the companion further than the goal would ever
        // travel of its own accord. Resuming from there turns "get me some
        // wood" into a cross-country march to a recipient it cannot reach --
        // observed live as a walk back across open ocean that timed out and
        // drowned. Settle truthfully and say so instead; the player can ask
        // again now that the situation has changed.
        if (deathDisplacedGoalBeyondReach(goal, this.agent.bot)) {
          const anchor = goalAnchorPosition(goal, this.agent.bot);
          const here = this.agent.bot?.entity?.position;
          const blocks = anchor && here
            ? Math.round(Math.hypot(here.x - anchor.x, here.y - anchor.y, here.z - anchor.z))
            : null;
          this.fail(
            'death_displaced_beyond_reach',
            blocks === null
              ? 'I died and respawned too far away to finish that. Ask again if you still want it.'
              : `I died and respawned about ${blocks} blocks away, which is too far to finish that from here. Ask again if you still want it.`,
            { retryable: false },
          );
          return;
        }
        const command = recoveryCommand(goal, this.agent.bot, this.agent.memory_bank);
        if (command) {
          this.persist({ ...goal, phase: 'assess', updatedAt: this.now() });
          this.dispatch('recover', command);
          return;
        }
        if (/^(?:(?:action_)?interrupted|safety_suspended)$/.test(String(goal.evidence?.code || ''))) {
          this.persist({ ...goal, phase: 'assess', updatedAt: this.now() });
          this.nextAttemptAt = this.now() + RETRY_DELAY_MS;
          this.setStatus(
            'waiting',
            'preemption_cleared',
            'Deterministic goal recovery will be reassessed from live state after the higher-priority action releases ownership.',
            true,
          );
          return;
        }
        if (/delivery_player_(?:absent|ambiguous)|skill_(?:lost_target|missing_item|family_missing|pickup_unverified)|delivery_unverified/.test(String(goal.evidence?.code || ''))) {
          this.persist({ ...goal, phase: 'deliver', updatedAt: this.now() });
          this.nextAttemptAt = this.now() + PLAYER_WAIT_MS;
          return;
        }
        const terminalDetail = `No safe deterministic recovery exists for ${goal.evidence?.code || 'the last failure'}: ${goal.evidence?.detail || 'no detail'}`;
        this.recordTerminalBoundary('no_deterministic_recovery', {
          code: 'no_deterministic_recovery',
          detail: terminalDetail,
        });
        this.fail(
          'no_deterministic_recovery',
          terminalDetail,
        );
        return;
      }

      if (goal.phase === 'acquire') {
        if (!goal.target.family) {
          if (goal.memory?.sourceAccessPending || goal.memory?.sourceSearchPending) {
            const replayStep = sourceHarvestReplayStep(this.agent.bot, goal);
            if (!replayStep) {
              this.nextAttemptAt = this.now() + TEMPORAL_FEASIBILITY_RECHECK_MS;
              this.setStatus(
                'waiting',
                'source_harvest_replay_unavailable',
                'The persisted source-harvest receipt lacks a valid normalized replay capability; waiting without selecting an unrelated acquisition method.',
                true,
              );
              return;
            }
            const temporalFeasibility = acquisitionTemporalFeasibility(
              this.agent.bot,
              replayStep,
              goal,
            );
            if (!temporalFeasibility.ready) {
              const surfaceStaging = hostileSourceSurfaceStaging(
                goal,
                temporalFeasibility,
              );
              if (surfaceStaging?.state === 'required') {
                this.persist({
                  ...goal,
                  evidence: {
                    actionId: '',
                    phase: 'acting',
                    code: 'hostile_source_surface_staging',
                    detail: 'The settled hostile-source search has no newly qualified source; establishing one verified supported surface stance before waiting.',
                    verified: false,
                    at: this.now(),
                  },
                  updatedAt: this.now(),
                });
                this.dispatch('recover', surfaceStaging.command);
                return;
              }
              if (surfaceStaging?.state === 'blocked') {
                this.nextAttemptAt = this.now() + TEMPORAL_FEASIBILITY_RECHECK_MS;
                this.setStatus(
                  'waiting',
                  'hostile_source_surface_staging_blocked',
                  `No supported surface wait stance was verified (${surfaceStaging.code}): ${surfaceStaging.detail}`,
                  true,
                );
                return;
              }
              const returnDecision = environmentalWaitReturnDecision(
                this.agent,
                goal,
                temporalFeasibility,
              );
              if (returnDecision.command) {
                this.persist({
                  ...goal,
                  evidence: {
                    actionId: '',
                    phase: 'acting',
                    code: 'environmental_wait_returning_to_requester',
                    detail: `The bounded hostile-source wait began away from ${goal.requester}; returning through native Pathfinder before waiting.`,
                    verified: false,
                    at: this.now(),
                  },
                  updatedAt: this.now(),
                });
                this.dispatch('recover', returnDecision.command);
                return;
              }
              if (returnDecision.blocker) {
                this.nextAttemptAt = this.now() + TEMPORAL_FEASIBILITY_RECHECK_MS;
                this.setStatus(
                  'waiting',
                  returnDecision.blocker.code,
                  returnDecision.blocker.detail,
                  true,
                );
                return;
              }
              this.nextAttemptAt = this.now() + TEMPORAL_FEASIBILITY_RECHECK_MS;
              this.setStatus(
                'waiting',
                temporalFeasibility.code,
                temporalFeasibility.detail,
                true,
              );
              return;
            }
            this.setStatus(
              'planning',
              'source_harvest_replay_authorized',
              Number.isInteger(Number(temporalFeasibility.targetEntityId))
                ? 'New source identity or movement evidence authorizes one replay of the same normalized entity-harvest capability.'
                : 'The stale source disappeared during the natural spawn window; authorizing the existing bounded entity-harvest search without binding the stale identity.',
              true,
            );
            const boundReplayStep = sourceHarvestReplayStep(
              this.agent.bot,
              goal,
              temporalFeasibility.targetEntityId,
            );
            if (!boundReplayStep) {
              this.nextAttemptAt = this.now() + TEMPORAL_FEASIBILITY_RECHECK_MS;
              this.setStatus(
                'waiting',
                'source_harvest_replay_unavailable',
                'The newly qualified source identity could not be bound into the normalized replay capability; waiting without dispatch.',
                true,
              );
              return;
            }
            this.dispatch('plan', null, boundReplayStep);
            return;
          }
          const plan = buildPrerequisitePlan(
            this.agent.bot,
            prerequisitePlannerOptions(this.agent, goal, required),
          );
          const planSignature = JSON.stringify(
            (plan.actions || []).map(action => [
              action.capability?.id,
              action.capability?.arguments,
              action.learningKey,
            ]),
          );
          if (planSignature !== this.lastPlanSignature) {
            this.planRevision += 1;
            this.lastPlanSignature = planSignature;
          }
          this.lastPlan = {
            ...plan,
            actions: (plan.actions || []).slice(0, 12),
            plannedAt: this.now(),
            revision: this.planRevision,
            remainingActions: (plan.actions || []).length,
            experienceApplied: (plan.actions || []).some(action => action.learnedPreference !== 0),
          };
          if (plan.status === 'complete') {
            this.persist({
              ...goal,
              phase: goal.kind === 'deliver' ? 'deliver' : 'verify_complete',
              updatedAt: this.now(),
            });
            continue;
          }
          if (plan.status === 'blocked' || !plan.nextStep) {
            const terminalCode = plan.code || 'causal_plan_blocked';
            const terminalDetail = `${plan.detail || `No causal plan exists for ${goal.target.inventoryName}.`}${plan.blocker ? ` Blocking prerequisite: ${plan.blocker}.` : ''}`;
            this.recordTerminalBoundary('causal_plan_blocked', {
              code: terminalCode,
              detail: terminalDetail,
              plan,
            });
            this.fail(
              terminalCode,
              terminalDetail,
            );
            return;
          }
          if (repeatsRejectedDepthCapability(goal, plan.nextStep)) {
            const detail = 'The unchanged mining-depth capability already rejected this body position without physical progress; an ore alias does not authorize the same geometry again.';
            this.recordTerminalBoundary('causal_plan_blocked', {
              code: 'mining_depth_method_exhausted',
              detail,
              plan,
            });
            this.fail('mining_depth_method_exhausted', detail);
            return;
          }
          this.setStatus(
            'planning',
            plan.code || 'causal_plan_ready',
            `${plan.detail} ${plan.nextStep.reason}`.slice(0, 280),
            true,
          );
          const temporalFeasibility = acquisitionTemporalFeasibility(
            this.agent.bot,
            plan.nextStep,
            goal,
          );
          if (!temporalFeasibility.ready) {
            const returnDecision = environmentalWaitReturnDecision(
              this.agent,
              goal,
              temporalFeasibility,
            );
            if (returnDecision.command) {
              this.persist({
                ...goal,
                evidence: {
                  actionId: '',
                  phase: 'acting',
                  code: 'environmental_wait_returning_to_requester',
                  detail: `The bounded hostile-source wait began away from ${goal.requester}; returning through native Pathfinder before waiting.`,
                  verified: false,
                  at: this.now(),
                },
                updatedAt: this.now(),
              });
              this.dispatch('recover', returnDecision.command);
              return;
            }
            if (returnDecision.blocker) {
              this.nextAttemptAt = this.now() + TEMPORAL_FEASIBILITY_RECHECK_MS;
              this.setStatus(
                'waiting',
                returnDecision.blocker.code,
                returnDecision.blocker.detail,
                true,
              );
              return;
            }
            this.nextAttemptAt = this.now() + TEMPORAL_FEASIBILITY_RECHECK_MS;
            this.setStatus(
              'waiting',
              temporalFeasibility.code,
              temporalFeasibility.detail,
              true,
            );
            return;
          }
          if (capabilityRequiresSurface(plan.nextStep)) {
            const route = goal.checkpoint?.miningReturnRoute || [];
            const atUsableSurface = occupiesUsableSurfaceStance(this.agent.bot);
            if (atUsableSurface && route.length > 0) {
              // Current Minecraft state outranks historical locomotion. A
              // surface-bound prerequisite that is already standing on proven
              // usable terrain must not walk backward into an old mine merely
              // because the earlier acquisition retained an exit route.
              this.persist({
                ...goal,
                checkpoint: {
                  ...goal.checkpoint,
                  miningReturnRoute: [],
                  miningReturnIndex: -1,
                  miningReturnDimension: null,
                },
                evidence: {
                  actionId: '',
                  phase: 'assess',
                  code: 'mining_return_superseded_by_surface_state',
                  detail: `Current Minecraft state already proves a usable surface stance; releasing the obsolete mining return before ${plan.nextStep.capability.id}.`,
                  verified: true,
                  at: this.now(),
                },
                updatedAt: this.now(),
              });
            }
            const returnStep = atUsableSurface ? null : pendingMiningReturn(goal);
            if (returnStep) {
              const routeDimension = normalizedDimension(goal.checkpoint.miningReturnDimension);
              const currentDimension = normalizedDimension(this.agent.bot?.game?.dimension);
              if (routeDimension && currentDimension && routeDimension !== currentDimension) {
                this.fail(
                  'mining_return_dimension_changed',
                  `The preserved mining route is in ${routeDimension}, but the bot is now in ${currentDimension}; refusing to guess a cross-dimension surface transition.`,
                );
                return;
              }
              const traversal = createCapabilityRequest('traverse_mining_route_cell', {
                ...returnStep.cell,
                dimension: routeDimension || currentDimension,
              }, {
                reason: 'Exit the verified mining corridor before dispatching a surface-bound prerequisite.',
              });
              this.persist({
                ...goal,
                phase: 'recover',
                evidence: {
                  actionId: '',
                  phase: 'recover',
                  code: 'mining_surface_prerequisite_return',
                  detail: `Returning through mining cell ${returnStep.index + 1} of ${route.length} before ${plan.nextStep.capability.id}.`,
                  verified: false,
                  at: this.now(),
                },
                updatedAt: this.now(),
              });
              this.dispatch('recover', traversal.command || null, traversal);
              return;
            }
            if (
              !atUsableSurface
              &&
              route.length > 0
              && !surfaceAccessConfirmedAfterMiningReturn(goal)
              && goal.memory?.accessRequirement?.kind !== 'surface'
            ) {
              this.persist({
                ...goal,
                phase: 'assess',
                memory: {
                  ...goal.memory,
                  accessRequirement: { kind: 'surface' },
                },
                evidence: {
                  actionId: '',
                  phase: 'assess',
                  code: 'surface_access_required_after_mining_return',
                  detail: `The preserved mining route is exhausted; establishing a supported surface stance before ${plan.nextStep.capability.id}.`,
                  verified: false,
                  at: this.now(),
                },
                updatedAt: this.now(),
              });
              continue;
            }
          }
          this.dispatch('plan', null, plan.nextStep);
          return;
        }
        const shortage = Math.max(1, required - current);
        const command = acquisitionCommand(goal, shortage, procedure);
        if (!command) {
          this.fail('unsupported_acquisition', `No deterministic acquisition command exists for ${goal.target.requestedName}.`);
          return;
        }
        this.dispatch('acquire', command);
        return;
      }

      if (goal.phase === 'deliver') {
        if (!this.waitForPlayer(goal)) return;
        if (current < 1 || remainingDelivery < 1) {
          this.persist({ ...goal, phase: 'acquire', updatedAt: this.now() });
          continue;
        }
        const amount = Math.min(current, remainingDelivery);
        const delivery = deliveryAction(goal, amount, procedure);
        this.dispatch('deliver', delivery.command || null, delivery);
        return;
      }

      this.fail('unsupported_goal_phase', `Typed goal entered unsupported phase '${goal.phase}'.`);
      return;
    }
  }
}

function transferredProgress(skill) {
  return Math.max(0, Math.floor(Number(skill?.transferred) || 0)) > 0;
}
