import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { getCommand, executeCommand as executeAgentCommand } from '../commands/index.js';
import { resolvePlayerTarget } from '../player-target.js';
import { writeJsonAtomicSync } from '../../utils/atomic-file.js';
import { isPreemption } from './action-result.js';
import {
  goalContractDescription,
  inventoryCountForGoalTarget,
  normalizeGoalContract,
} from './goal-contract.js';
import { buildPrerequisitePlan, plannedInventoryCount } from './prerequisite-planner.js';
import { isSafeProcedureCommand, ProcedureStore } from './procedure-store.js';

const STORE_VERSION = 1;
const MAX_STORE_BYTES = 512 * 1024;
const SAFE_AGENT_NAME = /^[A-Za-z0-9_]{3,16}$/;
const SUCCESS_DELAY_MS = 500;
const RETRY_DELAY_MS = 2_500;
const PLAYER_WAIT_MS = 5_000;
const FAILED_TARGET_COOLDOWN_MS = 90_000;
const FAILED_TARGET_RETENTION_MS = 10 * 60_000;
const MAX_FAILED_TARGETS = 24;
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

function actionResultEvidence(result) {
  return result?.evidence?.skill && typeof result.evidence.skill === 'object'
    ? result.evidence.skill
    : null;
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
    if (!existsSync(this.filePath)) return { activeGoal: null, lastGoal: null };
    try {
      if (statSync(this.filePath).size > MAX_STORE_BYTES) {
        throw new TypeError('Goal-state file exceeds the size limit.');
      }
      const document = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (document?.version !== STORE_VERSION) {
        throw new TypeError(`Unsupported goal-state version '${document?.version}'.`);
      }
      return {
        activeGoal: document.activeGoal ? normalizeGoalContract(document.activeGoal) : null,
        lastGoal: document.lastGoal ? normalizeGoalContract(document.lastGoal) : null,
      };
    } catch (error) {
      this.lastError = boundedText(error?.message || error);
      return { activeGoal: null, lastGoal: null };
    }
  }

  save(activeGoal, lastGoal) {
    const normalizedActive = activeGoal ? normalizeGoalContract(activeGoal) : null;
    const normalizedLast = lastGoal ? normalizeGoalContract(lastGoal) : null;
    writeJsonAtomicSync(this.filePath, {
      version: STORE_VERSION,
      activeGoal: normalizedActive,
      lastGoal: normalizedLast,
      savedAt: Date.now(),
    });
    this.lastError = null;
  }
}

function restoredGoal(goal) {
  if (!goal || TERMINAL_PHASES.has(goal.phase)) return null;
  const now = Date.now();
  return normalizeGoalContract({
    ...goal,
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
      detail: 'Restored goal requires fresh Minecraft-state verification.',
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

function deliveryCommand(goal, remaining, procedure) {
  const preferred = preferredProcedureCommand(procedure, 'deliver');
  if (goal.target.family) {
    const selected = preferred === '!giveFamilyToPlayer' ? preferred : '!giveFamilyToPlayer';
    return `${selected}(${JSON.stringify(goal.target.family)}, ${JSON.stringify(goal.destination.player)}, ${remaining})`;
  }
  const selected = preferred === '!givePlayer' ? preferred : '!givePlayer';
  return `${selected}(${JSON.stringify(goal.destination.player)}, ${JSON.stringify(goal.target.inventoryName)}, ${remaining})`;
}

function recoveryCommand(goal) {
  const code = String(goal.evidence?.code || '');
  if (
    /(?:not_found|no_safe|unreachable|search|resource|no_path|path_|stuck)/.test(code)
    && !/(?:missing_material|missing_item|missing_tool|invalid_|table_unreachable|furnace_unreachable)/.test(code)
  ) return '!moveAway(32)';
  return null;
}

function plannedDisengagementCommand(goal) {
  const code = String(goal.evidence?.code || '');
  if (
    goal.subgoals.at(-1)?.kind === 'plan'
    && /(?:path_stalled|path_timeout|unreachable|no_path|not_collected|not_broken)/.test(code)
  ) return '!moveAway(4)';
  return null;
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
    if (this.activeGoal) {
      this.store.save(this.activeGoal, this.lastGoal);
      this.setStatus('assess', 'restart_revalidation', 'Restored typed goal is waiting for fresh Minecraft state.', true);
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
      nextAttemptAt: this.nextAttemptAt,
      plan: this.lastPlan,
      goal: goal ? {
        id: goal.id,
        kind: goal.kind,
        requester: goal.requester,
        target: goal.target,
        quantity: goal.quantity,
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
    this.store.save(this.activeGoal, this.lastGoal);
    return this.activeGoal;
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
      this.lastPlan = null;
      this.planRevision = 0;
      this.lastPlanSignature = '';
      this.nextAttemptAt = 0;
      this.store.save(goal, null);
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
    const cancelled = normalizeGoalContract({
      ...this.activeGoal,
      phase: 'cancelled',
      evidence: {
        actionId: this.activeGoal.evidence?.actionId || '',
        phase: 'cancelled',
        code: 'goal_cancelled',
        detail: reason,
        verified: false,
        at: this.now(),
      },
      updatedAt: this.now(),
    });
    this.lastGoal = cancelled;
    this.activeGoal = null;
    this.store.save(null, cancelled);
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
    const complete = current >= goal.checkpoint.targetInventory;
    return {
      complete,
      code: complete ? 'inventory_goal_verified' : 'inventory_goal_incomplete',
      detail: complete
        ? `Inventory contains ${current}; required post-goal count was ${goal.checkpoint.targetInventory}.`
        : `Inventory contains ${current}; required post-goal count is ${goal.checkpoint.targetInventory}.`,
    };
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
    this.store.save(null, completed);
    this.setStatus('complete', verification.code, verification.detail, false);
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
    void Promise.resolve(this.agent.openChat?.(`Completed: ${goalContractDescription(completed)}. ${verification.detail}`))
      .catch(error => console.warn(`[goal] Could not report completion: ${boundedText(error?.message || error)}`));
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
    this.store.save(null, failed);
    this.setStatus('failed', code, detail, false);
    this.agent.publishBehaviorEvent?.({
      type: 'goal.changed',
      target: { name: failed.target.family || failed.target.canonicalName },
      evidence: { goalId: failed.id, code, phase: 'failed' },
      salience: 3,
    });
    void Promise.resolve(this.agent.openChat?.(`Goal stopped without completion: ${detail}`))
      .catch(error => console.warn(`[goal] Could not report failure: ${boundedText(error?.message || error)}`));
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
      subgoals: [...this.activeGoal.subgoals, subgoal],
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
        this.agent.memory_bank?.rememberOutcome?.(current.learningKey, {
          success: result.phase === 'succeeded',
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
    if (!/(?:path_stalled|path_timeout|unreachable|no_path)/.test(code)) return this.activeGoal;
    const skill = actionResultEvidence(result);
    const target = result?.target || skill?.target;
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

  collectionExclusions() {
    const now = this.now();
    return (this.activeGoal?.memory?.failedTargets || [])
      .filter(entry => entry.kind === 'collect' && entry.avoidUntil > now)
      .map(entry => ({ ...entry.position }));
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
    this.finishLatestSubgoal(effectiveResult);
    this.rememberFailedTarget(effectiveResult);
    const goal = this.activeGoal;
    const skill = actionResultEvidence(effectiveResult);
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
    const madeProgress = transferredProgress(skill)
      || (kind === 'acquire' && effectiveResult.phase === 'succeeded');

    if (delivered) {
      this.persist({ ...goal, checkpoint, phase: 'verify_complete', updatedAt: this.now() });
      this.nextAttemptAt = this.now() + SUCCESS_DELAY_MS;
      return;
    }
    if (effectiveResult.phase === 'succeeded' || madeProgress) {
      this.persist({
        ...goal,
        checkpoint,
        attempts: effectiveResult.phase === 'succeeded' ? 0 : goal.attempts,
        phase: acquired ? (goal.kind === 'deliver' ? 'deliver' : 'verify_complete') : 'assess',
        updatedAt: this.now(),
      });
      this.nextAttemptAt = this.now() + SUCCESS_DELAY_MS;
      this.setStatus('assess', effectiveResult.code || 'subgoal_succeeded', effectiveResult.detail || 'Verified subgoal completed.', true);
      return;
    }

    const preemptionRecovery = isPreemption(effectiveResult);
    // Being outranked is not an attempt at the goal. Charging one meant a few
    // fights on the way to the iron drained the same budget a genuinely
    // unreachable target does, and the goal gave up on work that was fine.
    const attempts = preemptionRecovery ? goal.attempts : goal.attempts + 1;
    const deliveryRecovery = kind === 'deliver'
      && /(?:lost_target|not_received|delivery_unverified)/.test(String(effectiveResult.code || ''));
    if (
      (effectiveResult.retryable === true || deliveryRecovery || preemptionRecovery)
      && attempts <= goal.maxAttempts
      && goal.subgoals.length < goal.maxSubgoals
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
    if (this.activeGoal.subgoals.length >= this.activeGoal.maxSubgoals) {
      this.fail('subgoal_budget_exhausted', `Goal reached its ${this.activeGoal.maxSubgoals}-subgoal safety limit.`);
      return false;
    }
    const selectedName = commandName(command);
    if (!selectedName || !isSafeProcedureCommand(selectedName) || !getCommand(selectedName)) {
      this.fail('unsafe_goal_command', `Goal attempted unavailable or unsafe command '${selectedName || 'unknown'}'.`);
      return false;
    }
    if (this.agent.blocked_actions?.includes(selectedName)) {
      this.fail('blocked_goal_command', `Goal command ${selectedName} is disabled for this bot.`);
      return false;
    }

    const previousActionId = this.agent.last_action_result?.actionId || null;
    this.appendActingSubgoal(kind, command, step);
    this.inFlight = true;
    this.setStatus('acting', `goal_${kind}`, `Executing ${selectedName} through the deterministic command path.`, true);
    void Promise.resolve(this.executeGoalCommand(this.agent, command, { owner: 'player' }))
      .then(() => {
        if (!this.activeGoal) return;
        let result = this.agent.last_action_result;
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

      if (goal.phase === 'assess' || goal.phase === 'verify_acquired') {
        if (goal.kind === 'deliver' && current >= remainingDelivery) {
          this.persist({ ...goal, phase: 'deliver', updatedAt: this.now() });
        } else if (goal.kind === 'acquire' && current >= goal.checkpoint.targetInventory) {
          this.persist({ ...goal, phase: 'verify_complete', updatedAt: this.now() });
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
          const disengagement = plannedDisengagementCommand(goal);
          if (disengagement) {
            this.persist({ ...goal, phase: 'assess', updatedAt: this.now() });
            this.dispatch('recover', disengagement);
            return;
          }
          this.persist({ ...goal, phase: 'assess', updatedAt: this.now() });
          this.nextAttemptAt = this.now() + RETRY_DELAY_MS;
          this.setStatus(
            'waiting',
            'causal_replan',
            `The last prerequisite changed or failed (${goal.evidence?.code || 'unknown'}); live inventory, world state, and failed-target memory will be planned again.`,
            true,
          );
          return;
        }
        const command = recoveryCommand(goal);
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
            range: 64,
            experience: learningKey => this.agent.memory_bank?.outcomePreference?.(learningKey) || 0,
          });
          const planSignature = JSON.stringify(
            (plan.actions || []).map(action => [action.command, action.learningKey]),
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
          this.dispatch('plan', plan.nextStep.command, plan.nextStep);
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
        this.dispatch('deliver', deliveryCommand(goal, amount, procedure));
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
