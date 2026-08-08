import { executeCommand as executeAgentCommand } from '../commands/index.js';
import { createWorkOrder } from './work-order.js';
import { createBuilderShelterOrder } from './jobs/builder-plan.js';
import {
  createItemGoalContract,
  inventoryCountForGoalTarget,
  resolveItemGoalTarget,
} from './goal-contract.js';
import {
  AGENDA_LIMITS,
  AgendaStore,
  describeAgendaEntry,
  isTerminalAgendaState,
  normalizeAgendaEntry,
} from './agenda.js';

// The agenda deliberately does not act. It decides what comes next and hands it
// to goal_director or job_director, which already own dispatch, verification,
// recovery budgets, and restart reconciliation. Re-implementing any of that here
// would mean two things could drive the bot, which is the failure this whole
// runtime is built to avoid.
const DISPATCH_COOLDOWN_MS = 750;
const REJECTED_COOLDOWN_MS = 5_000;
const MAX_ENTRY_ATTEMPTS = 2;
const WAITABLE_DIRECT_OUTCOMES = new Set(['skill_not_sleep_time']);
const LEGACY_REARMABLE_SLEEP_OUTCOMES = new Set([
  ...WAITABLE_DIRECT_OUTCOMES,
  'skill_sleep_not_confirmed',
]);
const JOB_ROLE_FOR_KIND = Object.freeze({
  mine: 'miner',
  harvest: 'lumberjack',
  stockpile: 'builder',
  shelter: 'builder',
});
const JOB_ORDER_KIND = Object.freeze({
  mine: 'mine',
  harvest: 'harvest',
  stockpile: 'stockpile',
});

function boundedText(value, maximum = 240) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex -- Strip wire/control bytes before text reaches chat, prompts, and telemetry.
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function inferredLegacyDependency(previous, entry) {
  // This is a restart migration for an unfinished legacy chain, not a rule
  // that makes a new request depend on whatever happened most recently.
  if (
    !previous
    || !entry
    || entry.dependsOnEntryId
    || isTerminalAgendaState(previous.state)
  ) return null;
  if (previous.kind === 'construction' && entry.kind === 'sleep') {
    return {
      dependsOnEntryId: previous.id,
      dependencyPolicy: 'requires_success',
      bindingRequest: { kind: 'structure_fixture', function: 'rest' },
    };
  }
  if (previous.kind === 'follow_until' && entry.kind === 'smelt') {
    return {
      dependsOnEntryId: previous.id,
      dependencyPolicy: 'requires_success',
      bindingRequest: { kind: 'world_block', name: previous.target },
    };
  }
  return null;
}

function sleepIsCurrentlyAllowed(bot) {
  const timeOfDay = Number(bot?.time?.timeOfDay);
  const isNight = Number.isFinite(timeOfDay) && timeOfDay >= 12541 && timeOfDay <= 23458;
  const isThunderstorm = bot?.isRaining === true && Number(bot?.thunderState) > 0;
  return isNight || isThunderstorm;
}

export class AgendaDirector {
  constructor(agent, {
    store = null,
    executeCommand = executeAgentCommand,
    resolveTarget = resolveItemGoalTarget,
    now = Date.now,
  } = {}) {
    this.agent = agent;
    this.now = now;
    this.executeAgendaCommand = executeCommand;
    this.resolveTarget = resolveTarget;
    this.entries = [];
    this.nextEligibleAt = 0;
    this.dispatching = false;
    this.directDispatchGeneration = 0;
    this.sequence = 0;
    this.status = {
      phase: 'idle',
      code: 'no_agenda',
      detail: 'No agenda is queued.',
      activeId: null,
    };
    try {
      this.store = store || new AgendaStore(agent.name);
      this.entries = this.store.load();
      this.entries = this.entries.map((entry, index, entries) => {
        const inferred = inferredLegacyDependency(entries[index - 1], entry);
        return inferred ? normalizeAgendaEntry({ ...entry, ...inferred }) : entry;
      });
      // Older versions treated daylight as a failed sleep action and could
      // persist an otherwise valid bound step as terminal. Re-arm only that
      // exact legacy outcomes. Its predecessor and bed binding stay intact.
      // Daylight charges are removed; an ambiguous activation keeps its one
      // productive attempt and receives only the remaining bounded attempt.
      let repairedLegacyWait = false;
      this.entries = this.entries.map(entry => {
        if (
          entry.kind !== 'sleep'
          || entry.state !== 'failed'
          || !LEGACY_REARMABLE_SLEEP_OUTCOMES.has(entry.evidence?.code)
        ) return entry;
        repairedLegacyWait = true;
        return normalizeAgendaEntry({
          ...entry,
          state: 'pending',
          startedAt: null,
          finishedAt: null,
          executorId: '',
          attempts: WAITABLE_DIRECT_OUTCOMES.has(entry.evidence?.code) ? 0 : entry.attempts,
        });
      });
      if (repairedLegacyWait) this.store.save(this.entries);
      // Older settlement code could mark a dependent failed when its parent
      // merely entered a retry. If the durable parent later completed, that
      // dependency failure is contradictory: the required-success predicate
      // is now satisfied and the dependent was never attempted. Re-arm only
      // that exact persisted contradiction.
      let repairedSatisfiedDependency = false;
      let repairedAnotherDependency = true;
      while (repairedAnotherDependency) {
        repairedAnotherDependency = false;
        const restoredById = new Map(this.entries.map(entry => [entry.id, entry]));
        this.entries = this.entries.map(entry => {
          if (
            entry.state !== 'failed'
            || entry.evidence?.code !== 'agenda_dependency_failed'
            || entry.dependencyPolicy !== 'requires_success'
          ) return entry;
          const predecessor = restoredById.get(entry.dependsOnEntryId);
          const predecessorCanStillSucceed = predecessor?.state === 'complete'
            || (
              predecessor?.state === 'pending'
              && predecessor.evidence?.code === 'agenda_dependency_resumed'
            );
          if (!predecessorCanStillSucceed) return entry;
          repairedSatisfiedDependency = true;
          repairedAnotherDependency = true;
          return normalizeAgendaEntry({
            ...entry,
            state: 'pending',
            startedAt: null,
            finishedAt: null,
            executorId: '',
            evidence: {
              code: 'agenda_dependency_resumed',
              detail: 'The required predecessor is complete or resumable; resuming work that was never attempted.',
            },
          });
        });
      }
      if (repairedSatisfiedDependency) this.store.save(this.entries);
      const orphanedConstructionIds = new Set(this.entries.filter(entry => (
        entry.kind === 'construction'
        && !isTerminalAgendaState(entry.state)
        && !entry.executorId
      )).map(entry => entry.id));
      if (orphanedConstructionIds.size > 0) {
        this.entries = this.entries.map(entry => {
          if (orphanedConstructionIds.has(entry.id)) {
            return normalizeAgendaEntry({
              ...entry,
              state: 'failed',
              assignmentState: 'interrupted',
              finishedAt: this.now(),
              evidence: {
                code: 'construction_compilation_interrupted',
                detail: 'The process restarted before the bounded construction assignment was accepted.',
              },
            });
          }
          if (orphanedConstructionIds.has(entry.dependsOnEntryId)) {
            return normalizeAgendaEntry({
              ...entry,
              state: 'failed',
              finishedAt: this.now(),
              evidence: {
                code: 'agenda_dependency_failed',
                detail: 'The required construction assignment did not survive compilation.',
              },
            });
          }
          return entry;
        });
        this.store.save(this.entries);
      }
      const stoppedJobEntry = this.entries.find(entry => (
        entry.state === 'active'
        && entry.executor === 'job'
        && entry.executorId
      ));
      if (
        stoppedJobEntry
        && this.agent.isOperatorHeld?.()
        && /operator stop/i.test(this.agent.operator_hold_reason || '')
        && !this.agent.job_director?.activeOrder
      ) {
        this.agent.job_director?.resumeOperatorStoppedOrder?.(stoppedJobEntry.executorId);
      }
      // Restored ids must not collide with ids minted this session.
      this.sequence = this.entries.length;
      if (this.store.lastError) {
        this.setStatus('failed', 'agenda_load_failed', this.store.lastError);
      } else if (this.entries.length) {
        this.setStatus('waiting', 'agenda_restored', `Restored ${this.pending().length} queued step(s) after restart.`);
      }
    } catch (error) {
      // A broken store must never stop a bot from spawning; it simply means no
      // durable agenda this session.
      this.store = null;
      this.setStatus('failed', 'agenda_store_unavailable', boundedText(error?.message || error));
    }
  }

  setStatus(phase, code, detail, activeId = null) {
    this.status = {
      phase: boundedText(phase, 24),
      code: boundedText(code, 64),
      detail: boundedText(detail),
      activeId: activeId || null,
    };
  }

  persist() {
    if (!this.store) return;
    this.store.save(this.entries);
  }

  pending() {
    return this.entries.filter(entry => entry.state === 'pending');
  }

  hasUnfinished() {
    return this.entries.some(entry => !isTerminalAgendaState(entry.state));
  }

  activeEntry() {
    return this.entries.find(entry => entry.state === 'active') || null;
  }

  ownsGoalExecutor(goalId) {
    const active = this.activeEntry();
    return Boolean(
      goalId
      && active?.executor === 'goal'
      && active.executorId === goalId
    );
  }

  /** Append one validated step. Returns a player-facing result. */
  add(raw) {
    if (this.entries.filter(entry => !isTerminalAgendaState(entry.state)).length >= AGENDA_LIMITS.maxEntries) {
      return { accepted: false, code: 'agenda_full', detail: `The agenda already holds ${AGENDA_LIMITS.maxEntries} unfinished steps.` };
    }
    let entry;
    try {
      this.sequence += 1;
      const previous = this.entries.at(-1) || null;
      const inferred = inferredLegacyDependency(previous, raw);
      entry = normalizeAgendaEntry(
        { ...raw, ...inferred, id: '', createdAt: this.now() },
        { now: this.now, sequence: this.sequence },
      );
    } catch (error) {
      return { accepted: false, code: 'invalid_agenda_entry', detail: boundedText(error?.message || error) };
    }
    if (this.entries.some(existing => existing.id === entry.id)) {
      return { accepted: false, code: 'duplicate_agenda_id', detail: 'That step could not be given a unique id.' };
    }
    // Keep the queue bounded by discarding finished history, never live work.
    this.entries = [...this.entries.filter(item => !isTerminalAgendaState(item.state)), entry];
    this.nextEligibleAt = 0;
    this.persist();
    this.setStatus('waiting', 'agenda_step_added', `Queued: ${describeAgendaEntry(entry)}.`);
    // Count every unfinished step, not just the waiting ones. Reporting
    // pending() called the second step "1" again once the first had started,
    // which reads as if the plan were being overwritten.
    const position = this.entries.filter(item => !isTerminalAgendaState(item.state)).length;
    return { accepted: true, id: entry.id, description: describeAgendaEntry(entry), position };
  }

  clear(reason = 'Cleared by the player.') {
    const cleared = this.entries.filter(entry => !isTerminalAgendaState(entry.state)).length;
    if (!cleared) return { cleared: 0 };
    const active = this.activeEntry();
    if (active) {
      try { this.agent.goal_director?.cancel?.(reason); } catch { /* executor may be absent */ }
      try { this.agent.job_director?.cancel?.(reason); } catch { /* executor may be absent */ }
    }
    this.directDispatchGeneration += 1;
    this.dispatching = false;
    this.entries = this.entries.map(entry => (
      isTerminalAgendaState(entry.state)
        ? entry
        : normalizeAgendaEntry({
            ...entry,
            state: 'cancelled',
            ...(entry.kind === 'construction' ? { assignmentState: 'cancelled' } : {}),
            finishedAt: this.now(),
            evidence: { code: 'agenda_cleared', detail: reason },
          })
    ));
    this.persist();
    this.setStatus('cancelled', 'agenda_cleared', reason);
    return { cleared };
  }

  skipCurrent(reason = 'Skipped by the player.') {
    const entry = this.activeEntry() || this.pending()[0];
    if (!entry) return { skipped: null };
    if (entry.state === 'active') {
      try { this.agent.goal_director?.cancel?.(reason); } catch { /* executor may be absent */ }
      try { this.agent.job_director?.cancel?.(reason); } catch { /* executor may be absent */ }
    }
    this.directDispatchGeneration += 1;
    this.dispatching = false;
    this.replace(entry.id, {
      state: 'skipped',
      ...(entry.kind === 'construction' ? { assignmentState: 'cancelled' } : {}),
      finishedAt: this.now(),
      evidence: { code: 'agenda_skipped', detail: reason },
    });
    this.nextEligibleAt = 0;
    return { skipped: describeAgendaEntry(entry) };
  }

  replace(id, patch) {
    this.entries = this.entries.map(entry => (
      entry.id === id ? normalizeAgendaEntry({ ...entry, ...patch }) : entry
    ));
    this.persist();
  }

  beginConstructionCompilation(entryId) {
    const entry = this.entries.find(candidate => candidate.id === entryId);
    if (!entry || entry.kind !== 'construction' || isTerminalAgendaState(entry.state)) {
      return { accepted: false, code: 'construction_barrier_missing' };
    }
    if (entry.executorId) return { accepted: false, code: 'construction_already_bound' };
    this.replace(entry.id, {
      assignmentState: 'compiling',
      evidence: { code: 'construction_compiling', detail: 'Compiling a bounded blueprint while physical work remains held.' },
    });
    this.setStatus('waiting', 'construction_compiling', 'Compiling the requested bounded structure.', entry.id);
    return { accepted: true, id: entry.id };
  }

  activeConstructionIntent() {
    return this.entries.find(entry => (
      entry.kind === 'construction'
      && !isTerminalAgendaState(entry.state)
      && entry.assignmentState === 'compiling'
      && !entry.executorId
    )) || null;
  }

  validateConstructionSubmission(order) {
    const entry = this.activeConstructionIntent();
    if (!entry) return { accepted: true, code: 'no_pending_construction_intent' };
    const observed = new Set((order?.blueprint?.cells || [])
      .map(cell => cell?.function)
      .filter(Boolean));
    const missing = (entry.constructionIntent?.requiredFunctions || [])
      .filter(required => !observed.has(required));
    return missing.length === 0
      ? { accepted: true, code: 'construction_intent_satisfied', entryId: entry.id }
      : {
          accepted: false,
          code: 'construction_intent_incomplete',
          entryId: entry.id,
          detail: `The bounded design is missing required function(s): ${missing.join(', ')}.`,
          missing,
        };
  }

  failConstructionAssignment(entryId, assignmentState, code, detail) {
    const entry = this.entries.find(candidate => candidate.id === entryId);
    if (!entry || entry.kind !== 'construction' || isTerminalAgendaState(entry.state)) {
      return { settled: false, code: 'construction_barrier_missing' };
    }
    const settled = {
      state: 'failed',
      code,
      detail,
      retryable: false,
      assignmentState,
    };
    return this.commitSettlement(entry, settled);
  }

  bindConstruction(entryId, orderId) {
    const entry = this.entries.find(candidate => candidate.id === entryId);
    const order = this.agent.job_director?.activeOrder;
    if (!entry || entry.kind !== 'construction' || isTerminalAgendaState(entry.state)) {
      return { accepted: false, code: 'construction_barrier_missing' };
    }
    if (!orderId || order?.id !== orderId) {
      return { accepted: false, code: 'construction_order_mismatch' };
    }
    if (entry.executorId && entry.executorId !== orderId) {
      return { accepted: false, code: 'construction_barrier_conflict' };
    }
    this.replace(entry.id, {
      state: 'active',
      startedAt: entry.startedAt || this.now(),
      executorId: orderId,
      assignmentState: 'accepted_and_bound',
      evidence: { code: 'construction_bound', detail: `Bound to Builder work order ${orderId}.` },
    });
    this.nextEligibleAt = 0;
    this.setStatus('acting', 'construction_bound', `Building through work order ${orderId}.`, entry.id);
    return { accepted: true, id: entry.id, executorId: orderId };
  }

  resumeConstructionContinuation(orderId) {
    const order = this.agent.job_director?.activeOrder;
    if (!orderId || order?.id !== orderId) {
      return { resumed: false, code: 'construction_order_mismatch' };
    }
    const construction = this.entries.find(entry => (
      entry.kind === 'construction'
      && entry.executorId === orderId
    ));
    if (!construction) return { resumed: false, code: 'construction_barrier_missing' };
    if (construction.state === 'active') {
      return { resumed: false, code: 'construction_already_active', id: construction.id };
    }
    if (construction.state !== 'failed') {
      return { resumed: false, code: 'construction_not_resumable', id: construction.id };
    }

    this.entries = this.entries.map(entry => {
      if (entry.id === construction.id) {
        return normalizeAgendaEntry({
          ...entry,
          state: 'active',
          finishedAt: null,
          assignmentState: 'accepted_and_bound',
          evidence: {
            code: 'construction_resumed',
            detail: `Resumed exact Builder work order ${orderId}.`,
          },
        });
      }
      if (
        entry.dependsOnEntryId === construction.id
        && entry.state === 'failed'
        && entry.evidence?.code === 'agenda_dependency_failed'
      ) {
        return normalizeAgendaEntry({
          ...entry,
          state: 'pending',
          finishedAt: null,
          evidence: {
            code: 'agenda_dependency_resumed',
            detail: 'Waiting for the resumed construction to complete.',
          },
        });
      }
      return entry;
    });
    this.persist();
    this.nextEligibleAt = 0;
    this.setStatus(
      'acting',
      'construction_resumed',
      `Continuing through work order ${orderId}.`,
      construction.id,
    );
    return { resumed: true, code: 'construction_resumed', id: construction.id, executorId: orderId };
  }

  snapshot() {
    const active = this.activeEntry();
    return {
      ...this.status,
      remaining: this.entries.filter(entry => !isTerminalAgendaState(entry.state)).length,
      active: active ? { id: active.id, kind: active.kind, description: describeAgendaEntry(active), attempts: active.attempts } : null,
      queue: this.pending().slice(0, 8).map(entry => ({
        id: entry.id,
        kind: entry.kind,
        description: describeAgendaEntry(entry),
      })),
      recent: this.entries
        .filter(entry => isTerminalAgendaState(entry.state))
        .slice(-4)
        .map(entry => ({
          id: entry.id,
          description: describeAgendaEntry(entry),
          state: entry.state,
          code: entry.evidence?.code || '',
        })),
      error: this.store?.lastError || null,
    };
  }

  executorsIdle() {
    return Boolean(
      !this.agent.goal_director?.activeGoal
      && !this.agent.job_director?.activeOrder
      && !this.agent.actions?.executing,
    );
  }

  goalResultMatches(entry, goal) {
    if (!entry || entry.executor !== 'goal' || !goal) return false;
    if (entry.executorId) return goal.id === entry.executorId;

    // Compatibility for agenda entries written before executorId existed.
    // Match the complete typed contract, not merely the item name, so an old
    // unrelated GoalDirector result cannot settle newly queued work.
    const target = goal.target?.requestedName || goal.target?.canonicalName || '';
    const completion = goal.completion?.kind || goal.completion || '';
    const destination = goal.destination?.player || '';
    return goal.kind === entry.kind
      && target === entry.target
      && goal.quantity === entry.quantity
      && goal.requester === entry.requester
      && completion === entry.completion
      && (entry.kind !== 'deliver' || destination === entry.recipient);
  }

  jobResultMatches(entry, order) {
    // There is no live pre-executorId job migration to recover. Without an
    // exact persisted ID, an idle lastOrder is not authoritative for this
    // agenda entry and must fail closed rather than repeat or misreport work.
    return Boolean(
      entry
      && entry.executor === 'job'
      && entry.executorId
      && order
      && order.id === entry.executorId
    );
  }

  /** Resolve a finished step from whichever executor was carrying it. */
  settleActive(entry) {
    if (entry.executor === 'goal') {
      const last = this.agent.goal_director?.lastGoal;
      if (!this.goalResultMatches(entry, last)) {
        return {
          state: 'failed',
          code: 'agenda_goal_result_mismatch',
          detail: 'The idle GoalDirector result did not match this agenda step.',
          retryable: false,
        };
      }
      const succeeded = last?.phase === 'complete';
      return {
        state: succeeded ? 'complete' : 'failed',
        code: last?.evidence?.code || 'goal_ended',
        detail: last?.evidence?.detail || '',
      };
    }
    if (entry.executor === 'job') {
      const last = this.agent.job_director?.lastOrder;
      if (!this.jobResultMatches(entry, last)) {
        return {
          state: 'failed',
          code: 'agenda_job_result_mismatch',
          detail: 'The idle JobDirector result did not match this agenda step.',
          retryable: false,
        };
      }
      const succeeded = last?.phase === 'complete';
      return {
        state: succeeded ? 'complete' : 'failed',
        code: last?.evidence?.code || 'job_ended',
        detail: last?.evidence?.detail || '',
        ...(entry.kind === 'construction' && !succeeded ? { retryable: false } : {}),
      };
    }
    return {
      state: 'failed',
      code: 'agenda_action_result_missing',
      detail: 'The restored direct agenda step has no durable terminal result and cannot be assumed complete.',
      retryable: true,
    };
  }

  directSettlement(result) {
    if (result?.phase !== 'succeeded' && WAITABLE_DIRECT_OUTCOMES.has(result?.code)) {
      return {
        state: 'waiting',
        code: result.code,
        detail: result.detail || '',
        retryable: true,
      };
    }
    return {
      state: result?.phase === 'succeeded' ? 'complete' : 'failed',
      code: result?.code || 'action_ended',
      detail: result?.detail || '',
      retryable: result?.retryable === true,
    };
  }

  nextPendingAfter(entry) {
    const activeIndex = this.entries.findIndex(candidate => candidate.id === entry?.id);
    if (activeIndex < 0) return null;
    return this.entries.slice(activeIndex + 1).find(candidate => candidate.state === 'pending') || null;
  }

  dependentBinding(entry, next, result, terminalReceipt = null) {
    if (
      !next?.bindingRequest
      || next.dependsOnEntryId !== entry?.id
      || next.dependencyPolicy !== 'requires_success'
    ) return null;
    if (next.bindingRequest.kind === 'world_block') {
      if (result?.phase !== 'succeeded') return null;
      const skill = result.evidence?.skill;
      const completion = skill?.completion;
      const position = completion?.position;
      const dimension = boundedText(completion?.dimension, 64).toLowerCase();
      if (
        skill?.kind !== 'follow'
        || completion?.kind !== 'shared_world_block'
        || completion?.name !== next.bindingRequest.name
        || !position
        || ![position.x, position.y, position.z].every(Number.isFinite)
        || !dimension
      ) return null;
      return {
        kind: 'world_block',
        name: completion.name,
        position: {
          x: Math.floor(position.x),
          y: Math.floor(position.y),
          z: Math.floor(position.z),
        },
        dimension,
        sourceEntryId: entry.id,
      };
    }
    if (next.bindingRequest.kind === 'structure_fixture') {
      const fixture = terminalReceipt?.structure?.fixtures?.find(candidate => (
        candidate?.function === next.bindingRequest.function
      ));
      if (!fixture) return null;
      return {
        kind: 'structure_fixture',
        function: fixture.function,
        fixtureId: fixture.id,
        structureOrderId: terminalReceipt.orderId,
        position: fixture.position,
        dimension: terminalReceipt.dimension,
        material: fixture.material,
        facing: fixture.facing,
        sourceEntryId: entry.id,
      };
    }
    return null;
  }

  commitDirectResult(entry, dispatchGeneration, result) {
    if (this.directDispatchGeneration !== dispatchGeneration) return false;
    const active = this.activeEntry();
    if (!active || active.id !== entry.id || active.executor !== 'direct') return false;
    // This synchronous store write is the durable executor handoff. It occurs
    // inside the terminal callback, before `dispatching` is released, and is
    // allowed while Operator Stop is held because it records an effect already
    // produced; it never starts another action.
    const dependent = this.nextPendingAfter(active);
    const needsBinding = result?.phase === 'succeeded'
      && dependent?.dependsOnEntryId === active.id
      && Boolean(dependent.bindingRequest);
    const bindingConstraint = this.dependentBinding(active, dependent, result);
    const settlement = needsBinding && !bindingConstraint
      ? {
        state: 'failed',
        code: 'agenda_binding_missing',
        detail: 'The exact world binding required by the dependent step was unavailable, so dependent work was not started.',
        retryable: false,
      }
      : this.directSettlement(result);
    this.commitSettlement(active, settlement, {
      dependentEntryId: bindingConstraint ? dependent.id : '',
      bindingConstraint,
    });
    return true;
  }

  commitSettlement(active, settled, { dependentEntryId = '', bindingConstraint = null } = {}) {
    if (settled.state === 'waiting') {
      this.entries = this.entries.map(entry => (
        entry.id === active.id
          ? normalizeAgendaEntry({
              ...entry,
              state: 'pending',
              startedAt: null,
              finishedAt: null,
              executorId: '',
              evidence: settled,
            })
          : entry
      ));
      this.persist();
      this.setStatus(
        'waiting',
        settled.code,
        `${describeAgendaEntry(active)}: ${settled.detail || 'Waiting for the world condition to change.'}`,
        active.id,
      );
      this.nextEligibleAt = this.now() + REJECTED_COOLDOWN_MS;
      return { settled: true, state: 'waiting', retryable: true, code: settled.code };
    }
    const attempts = active.attempts + 1;
    const retryable = settled.state === 'failed'
      && settled.retryable !== false
      && attempts < MAX_ENTRY_ATTEMPTS;
    const assignmentPatch = settled.assignmentState ? { assignmentState: settled.assignmentState } : {};
    const activePatch = retryable
      ? { state: 'pending', startedAt: null, executorId: '', attempts, evidence: settled, ...assignmentPatch }
      : { state: settled.state, finishedAt: this.now(), attempts, evidence: settled, ...assignmentPatch };
    // Persist the terminal step and its dependent exact-workstation handoff in
    // one store write. A restart can therefore never observe arrival complete
    // while the following smelt remains free to select a different furnace.
    // A retryable failure returns the parent to pending. Its dependents must
    // remain pending too; only the committed terminal parent state can make a
    // requires-success dependency impossible.
    const parentTerminallyFailed = !retryable
      && activePatch.state !== 'complete'
      && isTerminalAgendaState(activePatch.state);
    const blockedDependents = parentTerminallyFailed
      ? new Set(this.entries.filter(entry => (
        entry.state === 'pending'
        && entry.dependsOnEntryId === active.id
        && entry.dependencyPolicy === 'requires_success'
      )).map(entry => entry.id))
      : new Set();
    this.entries = this.entries.map(entry => {
      if (entry.id === active.id) return normalizeAgendaEntry({ ...entry, ...activePatch });
      if (blockedDependents.has(entry.id)) {
        return normalizeAgendaEntry({
          ...entry,
          state: 'failed',
          finishedAt: this.now(),
          evidence: {
            code: 'agenda_dependency_failed',
            detail: `Dependent work was not attempted because ${describeAgendaEntry(active)} did not complete.`,
          },
        });
      }
      if (bindingConstraint && entry.id === dependentEntryId) {
        return normalizeAgendaEntry({
          ...entry,
          bindingConstraint,
          ...(bindingConstraint.kind === 'world_block'
            ? {
                workstationConstraint: {
                  name: bindingConstraint.name,
                  position: bindingConstraint.position,
                  dimension: bindingConstraint.dimension,
                  source: active.kind === 'follow_until'
                    ? 'agenda_follow_until'
                    : 'agenda_typed_binding',
                  observedAt: this.now(),
                  sourceEntryId: active.id,
                },
              }
            : {}),
        });
      }
      return entry;
    });
    this.persist();
    this.setStatus(
      settled.state === 'complete' ? 'succeeded' : retryable ? 'recovering' : 'failed',
      settled.code,
      `${describeAgendaEntry(active)}: ${settled.state === 'complete' ? 'done' : settled.detail || settled.code}`,
    );
    this.nextEligibleAt = this.now() + (settled.state === 'complete' ? DISPATCH_COOLDOWN_MS : REJECTED_COOLDOWN_MS);
    if (settled.state === 'complete') {
      void Promise.resolve(this.agent.openChat?.(`Agenda step done: ${describeAgendaEntry(active)}.`))
        .catch(() => { /* chat is best effort */ });
    }
    return { settled: true, state: settled.state, retryable, code: settled.code };
  }

  /**
   * Consume a protected GoalDirector completion only when it belongs to the
   * active player agenda step. This is called from the arbiter before its
   * protected-output gate, and deliberately settles/persists before releasing
   * the reservation. The bounded conversational handoff remains intact.
   */
  settleProtectedGoalCompletion() {
    const active = this.activeEntry();
    const goal = this.agent.goal_director;
    if (
      !active
      || active.executor !== 'goal'
      || !goal?.hasProtectedCompletion?.()
      || !this.executorsIdle()
      || !this.goalResultMatches(active, goal.lastGoal)
      || goal.lastGoal?.phase !== 'complete'
    ) return { settled: false };

    const result = this.commitSettlement(active, this.settleActive(active));
    const released = goal.releaseProtectedCompletion?.(
      'Consumed by the matching player agenda continuation.',
      { preserveTerminalHandoff: true },
    );
    return { ...result, released: Boolean(released), entryId: active.id };
  }

  dispatch(entry) {
    if (entry.executor === 'goal') {
      let target;
      try {
        // Target resolution reaches into the connected registry and can throw
        // when that registry is unavailable. A dispatch attempt must never take
        // the behavior tick down with it.
        target = this.resolveTarget(this.agent.bot, entry.target);
      } catch (error) {
        return { accepted: false, code: 'target_lookup_failed', detail: boundedText(error?.message || error) };
      }
      if (!target || target.acquisitionKind === 'unsupported') {
        return { accepted: false, code: 'unsupported_target', detail: `${entry.target} has no deterministic acquisition path.` };
      }
      const requester = entry.requester || entry.recipient || this.agent.name;
      let goal;
      try {
        const baselineInventory = inventoryCountForGoalTarget(this.agent.bot, target);
        goal = createItemGoalContract({
          kind: entry.kind,
          requester,
          target,
          quantity: entry.quantity,
          destinationPlayer: entry.kind === 'deliver' ? entry.recipient : null,
          request: describeAgendaEntry(entry),
          baselineInventory,
          completion: entry.completion || (entry.kind === 'deliver' ? 'delivery' : 'inventory'),
        });
      } catch (error) {
        return { accepted: false, code: 'invalid_goal', detail: boundedText(error?.message || error) };
      }
      const result = this.agent.goal_director?.submit?.(goal);
      return result?.accepted
        ? { accepted: true, ...(result.id ? { executorId: result.id } : {}) }
        : { accepted: false, code: result?.code || 'goal_director_unavailable', detail: result?.detail || '' };
    }

    if (entry.executor === 'job') {
      let order;
      try {
        if (entry.kind === 'shelter') {
          // A shelter is a blueprint anchored to where the bot stands, so it
          // uses the same builder the explicit command does rather than a bare
          // work order.
          const position = this.agent.bot?.entity?.position;
          if (!position) {
            return { accepted: false, code: 'spawn_state_unavailable', detail: 'Minecraft position is not available yet.' };
          }
          order = createBuilderShelterOrder({
            x: Math.floor(position.x) - 1,
            y: Math.floor(position.y),
            z: Math.floor(position.z) - 1,
            requester: entry.requester || 'player',
          });
        } else {
          order = createWorkOrder({
            role: JOB_ROLE_FOR_KIND[entry.kind],
            kind: JOB_ORDER_KIND[entry.kind],
            source: 'player',
            requester: entry.requester || 'player',
            target: { name: entry.target },
            quota: entry.quantity,
          });
        }
      } catch (error) {
        return { accepted: false, code: 'invalid_work_order', detail: boundedText(error?.message || error) };
      }
      const result = this.agent.job_director?.submit?.(order);
      return result?.accepted
        ? { accepted: true, ...(result.id ? { executorId: result.id } : {}) }
        : { accepted: false, code: result?.code || 'job_director_unavailable', detail: result?.detail || '' };
    }

    // Direct steps build their command in code from already-validated fields.
    // Every interpolated value has passed `normalizeAgendaEntry`: coordinates are
    // numbers, names match the canonical pattern. No stored text is executed.
    const DIRECT_COMMANDS = {
      visit: () => `!goToCoordinates(${entry.x}, ${entry.y}, ${entry.z}, 2)`,
      craft: () => `!craftRecipe("${entry.target}", ${entry.quantity})`,
      smelt: () => entry.workstationConstraint
        ? `!smeltItem("${entry.target}", ${entry.quantity}, ${entry.workstationConstraint.position.x}, ${entry.workstationConstraint.position.y}, ${entry.workstationConstraint.position.z}, ${JSON.stringify(entry.workstationConstraint.dimension)})`
        : `!smeltItem("${entry.target}", ${entry.quantity})`,
      goto: () => `!goToPlayer("${entry.recipient}", 3)`,
      follow_until: () => `!followPlayerUntilNearBlock("${entry.recipient}", "${entry.target}", ${entry.radius})`,
      farm_visit: () => '!goToFarm',
      maintain_farm: () => '!maintainFarm',
      deposit: () => entry.containerConstraint
        ? `!putInChestAt("${entry.target}", ${entry.quantity}, ${entry.containerConstraint.position.x}, ${entry.containerConstraint.position.y}, ${entry.containerConstraint.position.z}, ${JSON.stringify(entry.containerConstraint.dimension)})`
        : `!putInChest("${entry.target}", ${entry.quantity})`,
      sleep: () => entry.bindingConstraint?.kind === 'structure_fixture'
        ? `!goToBedAt(${entry.bindingConstraint.position.x}, ${entry.bindingConstraint.position.y}, ${entry.bindingConstraint.position.z}, ${JSON.stringify(entry.bindingConstraint.dimension)})`
        : '!goToBed',
    };
    const commandBuilder = DIRECT_COMMANDS[entry.kind];
    if (!commandBuilder) {
      return {
        accepted: false,
        code: 'unsupported_direct_agenda_kind',
        detail: `No bounded direct dispatcher exists for agenda kind ${entry.kind}.`,
      };
    }
    const command = commandBuilder();
    const previousActionId = this.agent.last_action_result?.actionId || null;
    const dispatchGeneration = this.directDispatchGeneration + 1;
    this.directDispatchGeneration = dispatchGeneration;
    this.dispatching = true;
    void Promise.resolve(this.executeAgendaCommand(this.agent, command, {
      owner: 'player',
      routeOrigin: 'agenda-director',
    }))
      .then(() => {
        if (this.directDispatchGeneration !== dispatchGeneration) return;
        let result = this.agent.last_action_result;
        if (
          !result?.actionId
          || result.actionId === previousActionId
          || result.evidence?.request?.routeOrigin !== 'agenda-director'
        ) {
          result = {
            actionId: `missing-${this.now()}`,
            phase: 'failed',
            code: 'missing_action_result',
            detail: 'Agenda command returned without its own new structured action result.',
            retryable: true,
          };
        }
        this.commitDirectResult(entry, dispatchGeneration, result);
      })
      .catch(error => {
        console.warn(`[agenda] Direct step failed: ${boundedText(error?.message || error)}`);
        if (this.directDispatchGeneration !== dispatchGeneration) return;
        this.commitDirectResult(entry, dispatchGeneration, {
          actionId: `error-${this.now()}`,
          phase: 'failed',
          code: 'agenda_command_error',
          detail: boundedText(error?.message || error),
          retryable: true,
        });
      })
      .finally(() => {
        if (this.directDispatchGeneration === dispatchGeneration) {
          this.dispatching = false;
        }
      });
    return { accepted: true };
  }

  update() {
    if (!this.entries.length || this.dispatching) return;
    if (this.agent.isOperatorHeld?.()) {
      this.setStatus('suppressed', 'operator_hold', this.agent.operator_hold_reason || 'Operator Stop is active.');
      return;
    }

    const active = this.activeEntry();
    if (active) {
      // A step is only finished once the executor carrying it has let go.
      if (!this.executorsIdle()) {
        this.setStatus('acting', 'agenda_step_running', describeAgendaEntry(active), active.id);
        return;
      }
      let settled = this.settleActive(active);
      const dependent = this.nextPendingAfter(active);
      const needsBinding = settled.state === 'complete'
        && dependent?.dependsOnEntryId === active.id
        && Boolean(dependent.bindingRequest);
      const bindingConstraint = needsBinding
        ? this.dependentBinding(
            active,
            dependent,
            null,
            this.agent.job_director?.lastReceipt,
          )
        : null;
      if (needsBinding && !bindingConstraint) {
        settled = {
          state: 'failed',
          code: 'agenda_binding_missing',
          detail: 'The completed executor did not provide the exact world binding required by dependent work.',
          retryable: false,
        };
      }
      this.commitSettlement(active, settled, {
        dependentEntryId: bindingConstraint ? dependent.id : '',
        bindingConstraint,
      });
      if (active.executor === 'job') {
        this.agent.job_director?.acknowledgeTerminalReceipt?.(active.executorId);
      }
      return;
    }

    if (this.now() < this.nextEligibleAt || !this.executorsIdle()) return;
    const next = this.pending()[0];
    if (!next) {
      if (this.status.code !== 'agenda_complete' && this.entries.length) {
        this.setStatus('idle', 'agenda_complete', 'Every queued agenda step is finished.');
        if (this.agent.companion_context?.snapshot?.().directive) {
          this.agent.behavior_arbiter?.requestDirectiveResume?.();
        }
      }
      return;
    }

    if (next.dependsOnEntryId) {
      const predecessor = this.entries.find(entry => entry.id === next.dependsOnEntryId);
      if (!predecessor) {
        this.replace(next.id, {
          state: 'failed',
          finishedAt: this.now(),
          evidence: { code: 'agenda_dependency_missing', detail: 'The required predecessor entry is unavailable.' },
        });
        return;
      }
      if (predecessor.state !== 'complete') {
        if (isTerminalAgendaState(predecessor.state)) {
          this.replace(next.id, {
            state: 'failed',
            finishedAt: this.now(),
            evidence: { code: 'agenda_dependency_failed', detail: 'The required predecessor did not complete.' },
          });
        } else {
          this.setStatus('waiting', 'agenda_dependency_pending', `Waiting for: ${describeAgendaEntry(predecessor)}.`, next.id);
        }
        return;
      }
      if (next.bindingRequest && !next.bindingConstraint) {
        this.replace(next.id, {
          state: 'failed',
          finishedAt: this.now(),
          evidence: { code: 'agenda_binding_missing', detail: 'The predecessor completed without the exact requested binding.' },
        });
        return;
      }
    }

    if (
      next.kind === 'sleep'
      && WAITABLE_DIRECT_OUTCOMES.has(next.evidence?.code)
      && !sleepIsCurrentlyAllowed(this.agent.bot)
    ) {
      this.nextEligibleAt = this.now() + REJECTED_COOLDOWN_MS;
      this.setStatus(
        'waiting',
        'agenda_world_condition_pending',
        'The exact bed is bound; waiting for night or a thunderstorm before trying to sleep again.',
        next.id,
      );
      return;
    }

    if (next.kind === 'construction' && !next.executorId) {
      this.setStatus(
        'waiting',
        'construction_assignment_pending',
        'Waiting for the bounded construction blueprint to be accepted.',
        next.id,
      );
      return;
    }

    const outcome = this.dispatch(next);
    if (!outcome.accepted) {
      const attempts = next.attempts + 1;
      const retryable = attempts < MAX_ENTRY_ATTEMPTS && outcome.code !== 'unsupported_target';
      this.replace(next.id, retryable
        ? { attempts, evidence: { code: outcome.code, detail: outcome.detail } }
        : { state: 'failed', finishedAt: this.now(), attempts, evidence: { code: outcome.code, detail: outcome.detail } });
      this.nextEligibleAt = this.now() + REJECTED_COOLDOWN_MS;
      this.setStatus('failed', outcome.code, `${describeAgendaEntry(next)}: ${outcome.detail || outcome.code}`);
      return;
    }
    this.replace(next.id, { state: 'active', startedAt: this.now(), executorId: outcome.executorId || '' });
    this.setStatus('acting', 'agenda_step_started', `Starting: ${describeAgendaEntry(next)}.`, next.id);
  }
}
