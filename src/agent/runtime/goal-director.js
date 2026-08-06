import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { getCommand, executeCommand as executeAgentCommand } from '../commands/index.js';
import { resolvePlayerTarget } from '../player-target.js';
import { writeJsonAtomicSync } from '../../utils/atomic-file.js';
import { classifyMethodOutcome, isPreemption } from './action-result.js';
import {
  capabilityCommand,
  capabilityCommandName,
  createCapabilityRequest,
  executeCapabilityAction,
} from './capability-catalogue.js';
import {
  completionRequirementSatisfied,
  goalContractDescription,
  inventoryCountForGoalTarget,
  normalizeGoalContract,
} from './goal-contract.js';
import { buildPrerequisitePlan, plannedInventoryCount } from './prerequisite-planner.js';
import { isSafeProcedureCommand, ProcedureStore } from './procedure-store.js';

const STORE_VERSION = 1;
const MAX_STORE_BYTES = 512 * 1024;
const SAFE_AGENT_NAME = /^[A-Za-z0-9_]{3,16}$/;
const SUCCESS_DELAY_MS = 100;
const RETRY_DELAY_MS = 750;
const PREEMPTION_RESUME_MS = 0;
const PLAYER_WAIT_MS = 5_000;
const FAILED_TARGET_COOLDOWN_MS = 90_000;
const FAILED_TARGET_RETENTION_MS = 10 * 60_000;
const MAX_FAILED_TARGETS = 24;
const FAILED_TARGET_EXCLUSION_RADIUS = 4;
// Collection binds candidates inside a 64-block physical scan. A 32-block
// retreat leaves most of that candidate field unchanged, so repeated failures
// can spend the goal budget on the same contaminated region. Move one complete
// scan radius before rebinding; owned Pathfinder still enforces the action
// deadline, recent-region exclusions, and non-destructive movement policy.
const ACQUISITION_REGION_RELOCATION_DISTANCE = 64;
const UNDERGROUND_SURFACE_RECOVERY_Y = 48;
const SURFACE_ACCESS_TARGET_Y = 56;
const SURFACE_ACCESS_MIN_VERTICAL_GAP = 12;
// A concrete acquisition failure already excludes that source. Trying a
// second source with the same failure signature in the same search region
// spends productive budget without changing strategy; relocate once and let
// the next plan bind a genuinely different region instead.
const MAX_LOCAL_CONCRETE_TARGET_FAILURES = 1;
const TERMINAL_PHASES = new Set(['complete', 'failed', 'cancelled']);

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

function budgetedSubgoalCount(goal) {
  return (goal?.subgoals || []).filter(subgoal => subgoal.kind !== 'recover').length;
}

function actionResultEvidence(result) {
  return result?.evidence?.skill && typeof result.evidence.skill === 'object'
    ? result.evidence.skill
    : null;
}

function verifiedMiningRouteProgress(kind, skill) {
  return Boolean(
    kind === 'plan'
    && skill?.kind === 'mining_search'
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
  );
}

function verifiedSurfaceRecoveryProgress(kind, skill) {
  return Boolean(
    kind === 'recover'
    && skill?.kind === 'surface_navigation'
    && skill?.supported === true
    && Number(skill?.verticalProgress) >= 1
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

class GoalStateStore {
  constructor(agentName, { root = './bots' } = {}) {
    if (!SAFE_AGENT_NAME.test(String(agentName || ''))) {
      throw new TypeError('Goal-state bot name is invalid.');
    }
    this.directory = path.resolve(root, agentName);
    this.filePath = path.join(this.directory, 'goal-state.json');
    this.lastError = null;
    mkdirSync(this.directory, { recursive: true });
  }

  load() {
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
      const activeGoal = document.activeGoal ? normalizeGoalContract(document.activeGoal) : null;
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
  const resumePhase = interrupted?.kind === 'recover' ? 'recover' : 'assess';
  return normalizeGoalContract({
    ...goal,
    // Fresh Minecraft state must always be verified after restart. A recovery
    // action is different from an opaque productive action, though: its last
    // productive failure still selects the strategy. Preserve that lifecycle
    // phase so restart resumes deterministic recovery instead of replaying the
    // acquisition that already proved it was inaccessible from this region.
    phase: resumePhase,
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
      detail: interrupted?.kind === 'recover'
        ? 'Restored goal requires fresh Minecraft-state verification before resuming deterministic recovery.'
        : 'Restored goal requires fresh Minecraft-state verification.',
      verified: false,
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
  );
  const latestPlan = latestFailedPlanSubgoal(goal);
  const code = `${goal?.evidence?.code || ''} ${latestPlan?.code || ''}`;
  const failedTarget = latestPlanFailedTarget(goal);
  const targetY = Number(failedTarget?.position?.y);
  const failedAboveGroundAccess = (
    /(?:unreachable|no_path|path_|stuck)/.test(code)
    && Number.isFinite(targetY)
    && targetY >= SURFACE_ACCESS_TARGET_Y
    && targetY - y >= SURFACE_ACCESS_MIN_VERTICAL_GAP
  );
  return dimension === 'overworld'
    && Number.isFinite(y)
    && (
      surfaceRecoveryLatched
      ||
      (
        y < UNDERGROUND_SURFACE_RECOVERY_Y
        && /(?:resource_not_found|search_exhausted)/.test(code)
      )
      || failedAboveGroundAccess
    );
}

function recoveryCommand(goal, bot) {
  const code = String(goal.evidence?.code || '');
  if (needsSurfaceRecovery(goal, bot)) return '!goToSurface';
  if (
    /(?:not_found|no_safe|unreachable|search|resource|no_path|path_|stuck)/.test(code)
    && !/(?:missing_material|missing_item|missing_tool|invalid_|table_unreachable|furnace_unreachable)/.test(code)
  ) return `!moveAway(${ACQUISITION_REGION_RELOCATION_DISTANCE})`;
  return null;
}

function plannedDisengagementCommand(goal, bot) {
  const code = String(goal.evidence?.code || '');
  if (needsSurfaceRecovery(goal, bot)) return '!goToSurface';
  if (
    goal.subgoals.at(-1)?.kind === 'plan'
    && /(?:resource_not_found|search_exhausted)/.test(code)
  ) return `!moveAway(${ACQUISITION_REGION_RELOCATION_DISTANCE})`;
  if (
    goal.subgoals.at(-1)?.kind === 'plan'
    && /(?:path_stalled|path_timeout|unreachable|no_path|not_collected|not_broken|timeout|action_deadline)/.test(code)
  ) return `!moveAway(${ACQUISITION_REGION_RELOCATION_DISTANCE})`;
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
    this.nextAttemptAt = 0;
    this.status = {
      phase: 'idle',
      code: 'no_goal',
      detail: 'No typed gameplay goal is active.',
      retryable: false,
      at: this.now(),
    };

    const persisted = this.store.load();
    this.activeGoal = restoredGoal(persisted.activeGoal);
    this.lastGoal = persisted.lastGoal;
    this.protectedGoalId = persisted.protectedGoalId === this.lastGoal?.id
      ? persisted.protectedGoalId
      : null;
    if (this.activeGoal) {
      this.store.save(this.activeGoal, this.lastGoal, this.protectedGoalId);
      this.setStatus(
        this.activeGoal.phase,
        'restart_revalidation',
        this.activeGoal.phase === 'recover'
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
    this.store.save(null, cancelled, null);
    this.setStatus('cancelled', 'goal_cancelled', reason, false);
    return true;
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
    if (goal.kind === 'deliver') {
      const complete = goal.checkpoint.delivered >= goal.quantity;
      return {
        complete,
        code: complete ? 'delivery_verified' : 'delivery_incomplete',
        detail: complete
          ? `Minecraft confirmed ${goal.checkpoint.delivered} ${goal.target.family || goal.target.inventoryName} received by ${goal.destination.player}.`
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
    const complete = inventoryComplete && equipmentComplete;
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
      code: complete ? `${codePrefix}_verified` : `${codePrefix}_incomplete`,
      detail: complete
        ? goal.completion.kind === 'inventory'
          ? `Inventory contains ${current}; required post-goal count was ${goal.checkpoint.targetInventory}.`
          : `Minecraft confirms ${goal.target.inventoryName} in the ${completionLabel}.`
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

  fail(code, detail) {
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
      },
      updatedAt: this.now(),
    });
    this.lastGoal = failed;
    this.activeGoal = null;
    this.protectedGoalId = null;
    this.store.save(null, failed, null);
    this.setStatus('failed', code, detail, false);
    this.supersedeSubgoalFailureSpeech(failed);
    // A failed player-owned goal returns control to the player, not to the
    // autonomous agenda. Persist the existing operator-hold gate before the
    // next arbiter tick can select old or newly generated background work.
    // The next explicit player command releases this hold through the normal
    // command/directive path.
    if (failed.source === 'player') {
      this.agent.holdPosition?.('Player goal failed; awaiting explicit player direction.');
    }
    this.agent.publishBehaviorEvent?.({
      type: 'goal.changed',
      target: { name: failed.target.family || failed.target.canonicalName },
      evidence: { goalId: failed.id, code, phase: 'failed' },
      salience: 3,
    });
    const report = Promise.resolve(this.agent.openChat?.(`Goal stopped without completion: ${detail}`));
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

  rememberFailedTarget(result) {
    if (!this.activeGoal || result?.phase === 'succeeded') return this.activeGoal;
    const code = String(result?.code || '');
    if (!/(?:path_stalled|path_timeout|unreachable|no_path|timeout|action_deadline)/.test(code)) return this.activeGoal;
    const skill = actionResultEvidence(result);
    // A worn tool is a capability prerequisite, not evidence that the selected
    // world target is bad. Preserve the target and let the causal planner
    // replace the tool before retrying the same physical source.
    if (skill?.toolRequirement || skill?.workstationRequirement) return this.activeGoal;
    const resultTarget = result?.target;
    const skillTarget = skill?.target;
    // Capability results often carry only the requested inventory identity at
    // the outer layer. Prefer whichever target preserves the executor's exact
    // world coordinate so a failed vein cannot be rebound immediately as if
    // it were new evidence.
    const target = [resultTarget, skillTarget].find(candidate => (
      candidate?.name
      && [candidate.x, candidate.y, candidate.z].every(Number.isFinite)
    )) || resultTarget || skillTarget;
    if (
      !target?.name
      || ![target.x, target.y, target.z].every(Number.isFinite)
    ) return this.activeGoal;

    const now = this.now();
    const position = {
      x: Math.floor(target.x),
      y: Math.floor(target.y),
      z: Math.floor(target.z),
    };
    const kind = boundedText(skill?.kind || 'action', 32, 'action');
    const name = boundedText(target.name, 80);
    const retained = (this.activeGoal.memory?.failedTargets || []).filter(entry => (
      now - entry.lastFailedAt <= FAILED_TARGET_RETENTION_MS
      && !(
        entry.kind === kind
        && entry.name === name
        && entry.position.x === position.x
        && entry.position.y === position.y
        && entry.position.z === position.z
      )
    ));
    const prior = (this.activeGoal.memory?.failedTargets || []).find(entry => (
      entry.kind === kind
      && entry.name === name
      && entry.position.x === position.x
      && entry.position.y === position.y
      && entry.position.z === position.z
    ));
    const failures = Math.min(8, (prior?.failures || 0) + 1);
    const failedTarget = {
      kind,
      name,
      position,
      code: boundedText(code, 80),
      failures,
      firstFailedAt: prior?.firstFailedAt || now,
      lastFailedAt: now,
      avoidUntil: now + FAILED_TARGET_COOLDOWN_MS,
    };
    return this.persist({
      ...this.activeGoal,
      memory: {
        ...this.activeGoal.memory,
        failedTargets: [...retained, failedTarget].slice(-MAX_FAILED_TARGETS),
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
    return this.persist({
      ...this.activeGoal,
      memory: {
        ...this.activeGoal.memory,
        toolRequirement: {
          name,
          minimumUsableDurability,
          observedAt: this.now(),
          target: exactTarget,
        },
        ...(exactTarget ? {
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

    if (miningRouteProgress && exactTarget) {
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
    const now = this.now();
    return (this.activeGoal?.memory?.failedTargets || [])
      .filter(entry => entry.kind === 'collect' && entry.avoidUntil > now)
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
    } else if (
      result.phase === 'succeeded'
      && kind === 'plan'
      && actingSubgoal?.targetName
      && plannedTargetAfter <= Math.max(0, Number(actingSubgoal.targetInventoryBefore) || 0)
    ) {
      effectiveResult = {
        ...result,
        phase: 'failed',
        code: 'planned_effect_unverified',
        detail: result.detail
          ? `${result.detail} The causal planner did not observe the expected ${actingSubgoal.targetName} inventory increase.`
          : `The action resolved without the expected ${actingSubgoal.targetName} inventory increase.`,
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
    ) || miningRouteProgress;
    if (verifiedStepProgress && effectiveResult.phase === 'failed') {
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
    this.finishLatestSubgoal(effectiveResult);
    this.rememberOperationalProgress(effectiveResult, miningRouteProgress);
    this.rememberToolRequirement(effectiveResult);
    this.rememberWorkstationRequirement(effectiveResult);
    // A bounded multi-item action may make verified material progress before
    // its remaining work times out. Replan from that real inventory delta
    // instead of blacklisting the productive target and walking away from it.
    if (!verifiedStepProgress) this.rememberFailedTarget(effectiveResult);
    const goal = this.activeGoal;
    const skill = actionResultEvidence(effectiveResult);
    const surfaceRecoveryProgress = verifiedSurfaceRecoveryProgress(kind, skill);
    const prerequisiteBlocked = Boolean(
      skill?.toolRequirement || skill?.workstationRequirement,
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
    const madeProgress = verifiedStepProgress
      || surfaceRecoveryProgress
      || transferredProgress(skill)
      || (
        ['acquire', 'plan'].includes(kind)
        && effectiveResult.phase === 'succeeded'
      );

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
          ? `Surface recovery advanced ${Math.round(Number(skill.verticalProgress) * 10) / 10} vertical blocks on safe support; continuing toward the bound surface stance.`
          : effectiveResult.detail || 'Verified subgoal completed.',
        true,
      );
      return;
    }

    const preemptionRecovery = isPreemption(effectiveResult);
    const relocationFailure = kind === 'recover';
    // Being outranked is not an attempt at the goal. Charging one meant a few
    // fights on the way to the iron drained the same budget a genuinely
    // unreachable target does, and the goal gave up on work that was fine.
    const attempts = (preemptionRecovery || relocationFailure || prerequisiteBlocked)
      ? goal.attempts
      : goal.attempts + 1;
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
          : 'tool_replacement_required',
        skill.workstationRequirement
          ? `The unreachable ${skill.workstationRequirement.name} must be replaced by a carried local workstation.`
          : `Mining requires a replacement ${skill.toolRequirement.name} with at least ${skill.toolRequirement.minimumUsableDurability} usable durability.`,
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
      && /(?:lost_target|not_received|delivery_unverified)/.test(String(effectiveResult.code || ''));
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
    if (!selectedName || !isSafeProcedureCommand(selectedName) || !getCommand(selectedName)) {
      this.fail('unsafe_goal_command', `Goal attempted unavailable or unsafe command '${selectedName || 'unknown'}'.`);
      return false;
    }
    if (this.agent.blocked_actions?.includes(selectedName)) {
      this.fail('blocked_goal_command', `Goal command ${selectedName} is disabled for this bot.`);
      return false;
    }

    const previousActionId = this.agent.last_action_result?.actionId || null;
    this.appendActingSubgoal(kind, capabilityCommand(capability) || command, step);
    this.inFlight = true;
    this.setStatus('acting', `goal_${kind}`, `Executing ${selectedName} through the deterministic command path.`, true);
    const execution = capability
      ? executeCapabilityAction(capability, {
        agent: this.agent,
        executeCommand: this.executeGoalCommand,
        owner: 'player',
        routeOrigin: 'goal-director',
      })
      : Promise.resolve(this.executeGoalCommand(this.agent, command, {
        owner: 'player',
        routeOrigin: 'goal-director',
      }))
        .then(value => ({ value, verification: null, result: null }));
    void Promise.resolve(execution)
      .then(outcome => {
        if (!this.activeGoal) return;
        let result = outcome?.result || this.agent.last_action_result;
        if (!result?.actionId || result.actionId === previousActionId) {
          result = {
            actionId: `missing-${this.now()}`,
            phase: 'failed',
            code: 'missing_action_result',
            detail: `${selectedName} returned without a new structured action result.`,
            retryable: true,
            evidence: null,
          };
        }
        if (result.phase === 'succeeded' && outcome?.verification?.ok === false) {
          result = {
            ...result,
            phase: 'failed',
            code: outcome.verification.code || 'verification_failed',
            detail: outcome.verification.detail || 'The capability effects were not verified in Minecraft.',
            retryable: true,
          };
        }
        this.handleResult(kind, result);
      })
      .catch(error => {
        if (!this.activeGoal) return;
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
        this.inFlight = false;
      });
    return true;
  }

  waitForPlayer(goal) {
    const resolution = resolvePlayerTarget(this.agent.bot, goal.destination.player, {
      knownBotNames: this.agent.getKnownAgentNames?.() || [],
    });
    if (resolution.entity && resolution.canonical) return true;
    const attempts = goal.attempts + 1;
    if (attempts > goal.maxAttempts) {
      this.fail(
        resolution.ambiguous ? 'delivery_player_ambiguous' : 'delivery_player_absent',
        resolution.ambiguous
          ? `Delivery target '${goal.destination.player}' is ambiguous.`
          : `Delivery target '${goal.destination.player}' did not become physically available within the bounded wait budget.`,
      );
      return false;
    }
    this.persist({
      ...goal,
      attempts,
      evidence: {
        actionId: '',
        phase: 'blocked',
        code: resolution.ambiguous ? 'delivery_player_ambiguous' : 'delivery_player_absent',
        detail: `Waiting for ${goal.destination.player} to be physically present for verified pickup.`,
        verified: false,
        at: this.now(),
      },
      updatedAt: this.now(),
    });
    this.nextAttemptAt = this.now() + PLAYER_WAIT_MS;
    this.setStatus('waiting', 'delivery_player_absent', `Waiting for ${goal.destination.player} to return.`, true);
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
        const command = recoveryCommand(goal, this.agent.bot);
        if (command) {
          this.persist({ ...goal, phase: 'assess', updatedAt: this.now() });
          this.dispatch('recover', command);
          return;
        }
        if (/^(?:action_)?interrupted$/.test(String(goal.evidence?.code || ''))) {
          this.persist({ ...goal, phase: 'assess', updatedAt: this.now() });
          this.nextAttemptAt = this.now() + RETRY_DELAY_MS;
          this.setStatus('waiting', 'preemption_cleared', 'Deterministic goal will resume after the higher-priority action releases ownership.', true);
          return;
        }
        if (/delivery_player_(?:absent|ambiguous)|skill_(?:lost_target|missing_item|family_missing)|delivery_unverified/.test(String(goal.evidence?.code || ''))) {
          this.persist({ ...goal, phase: 'deliver', updatedAt: this.now() });
          this.nextAttemptAt = this.now() + PLAYER_WAIT_MS;
          return;
        }
        this.fail(
          'no_deterministic_recovery',
          `No safe deterministic recovery exists for ${goal.evidence?.code || 'the last failure'}: ${goal.evidence?.detail || 'no detail'}`,
        );
        return;
      }

      if (goal.phase === 'acquire') {
        if (!goal.target.family) {
          const plan = buildPrerequisitePlan(this.agent.bot, {
            target: goal.target.inventoryName,
            quantity: required,
            completion: goal.completion,
            range: 64,
            experience: learningKey => this.agent.memory_bank?.outcomePreference?.(learningKey) || 0,
            toolRequirement: goal.memory?.toolRequirement,
            workstationRequirement: goal.memory?.workstationRequirement,
          });
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
            this.fail(
              plan.code || 'causal_plan_blocked',
              `${plan.detail || `No causal plan exists for ${goal.target.inventoryName}.`}${plan.blocker ? ` Blocking prerequisite: ${plan.blocker}.` : ''}`,
            );
            return;
          }
          this.setStatus(
            'planning',
            plan.code || 'causal_plan_ready',
            `${plan.detail} ${plan.nextStep.reason}`.slice(0, 280),
            true,
          );
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
