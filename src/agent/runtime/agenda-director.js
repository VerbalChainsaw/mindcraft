import { executeCommand as executeAgentCommand } from '../commands/index.js';
import { classifyMethodOutcome, isPreemption } from './action-result.js';
import { createWorkOrder } from './work-order.js';
import { createBuilderShelterOrder } from './jobs/builder-plan.js';
import { createAccessRepairWorkOrder } from './access-repair.js';
import { miningOutputName } from './jobs/miner-plan.js';
import { logInventoryCount } from './jobs/lumberjack-plan.js';
import {
  createItemGoalContract,
  inventoryCountForGoalTarget,
  normalizeGoalContract,
  resolveItemGoalTarget,
} from './goal-contract.js';
import {
  AGENDA_LIMITS,
  AgendaStore,
  describeAgendaEntry,
  isTerminalAgendaState,
  normalizeAgendaEntry,
} from './agenda.js';
import { familyFoodPoints } from './item-family.js';
import {
  classifyObligationSettlement,
  createMaterialChangeBlocker,
  evaluateMaterialChange,
  receiptShowsMaterialProgress,
} from './obligation-settlement.js';

// The agenda deliberately does not act. It decides what comes next and hands it
// to goal_director or job_director, which already own dispatch, verification,
// recovery budgets, and restart reconciliation. Re-implementing any of that here
// would mean two things could drive the bot, which is the failure this whole
// runtime is built to avoid.
const DISPATCH_COOLDOWN_MS = 750;
const REJECTED_COOLDOWN_MS = 5_000;
const MAX_ENTRY_ATTEMPTS = 2;
const MAX_ENTRY_PREEMPTIONS = 24;
const MAX_INVENTORY_RECONCILIATIONS = 12;
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
  repair_access: 'builder',
  explore: 'miner',
  scout: 'scout',
});
const JOB_ORDER_KIND = Object.freeze({
  mine: 'mine',
  harvest: 'harvest',
  stockpile: 'stockpile',
  explore: 'explore',
  scout: 'scout',
});

function boundedText(value, maximum = 240) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex -- Strip wire/control bytes before text reaches chat, prompts, and telemetry.
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function isResumableSafetyPreemption(result) {
  return isPreemption(result)
    && /^(?:action_)?interrupted$/.test(String(result?.code || ''));
}

function inventoryItemCount(bot, name) {
  return (bot?.inventory?.slots || []).reduce((total, item) => (
    item?.name === name ? total + Math.max(0, Number(item.count) || 0) : total
  ), 0);
}

function encodeBaselineInventory(entries) {
  return Array.isArray(entries) && entries.length > 0
    ? entries.map(item => `${item.name}:${item.count}`).join('|')
    : 'none';
}

function acquisitionRetryCheckpoint(entry, goal) {
  const route = goal?.checkpoint?.miningReturnRoute;
  const index = Number(goal?.checkpoint?.miningReturnIndex);
  if (
    entry?.kind !== 'acquire'
    || entry.completion !== 'inventory'
    || !Array.isArray(route)
    || route.length < 1
    || !Number.isFinite(index)
    || index < 0
  ) return null;
  return {
    baselineInventory: entry.acquisitionCheckpoint?.baselineInventory
      ?? goal.checkpoint?.baselineInventory,
    targetInventory: entry.acquisitionCheckpoint?.targetInventory
      ?? goal.checkpoint?.targetInventory,
    miningReturnRoute: route,
    miningReturnIndex: index,
    ...(goal.checkpoint.miningReturnDimension
      ? { miningReturnDimension: goal.checkpoint.miningReturnDimension }
      : {}),
  };
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

function agendaDimension(bot) {
  return String(bot?.game?.dimension || '')
    .trim()
    .toLowerCase()
    .replace(/^minecraft:/, '')
    .replace(/^the_nether$/, 'nether')
    .replace(/^the_end$/, 'end') || null;
}

function observedPosition(value) {
  if (!value || ![value.x, value.y, value.z].every(Number.isFinite)) return null;
  return { x: Number(value.x), y: Number(value.y), z: Number(value.z) };
}

function agendaParticipantPosition(bot, requestedName) {
  const requested = String(requestedName || '').trim().toLowerCase();
  if (!requested) return null;
  const entry = Object.values(bot?.players || {}).find(candidate => (
    String(candidate?.username || '').trim().toLowerCase() === requested
  ));
  return observedPosition(entry?.entity?.position);
}

function agendaTargetSignature(bot, entry) {
  const target = agendaParticipantPosition(bot, entry?.recipient);
  if (!target) return null;
  return `${Math.floor(target.x)}:${Math.floor(target.y)}:${Math.floor(target.z)}`;
}

function agendaMaterialObservation(agent, entry) {
  return {
    position: observedPosition(agent?.bot?.entity?.position),
    dimension: agendaDimension(agent?.bot),
    targetSignature: agendaTargetSignature(agent?.bot, entry),
  };
}

// How long an agenda entry may sit parked after a no-progress result before it
// is retried regardless of the world. The agenda carries explicit player
// requests, so an unbounded blocker means "get me some wood" silently stalls
// until the player happens to walk eight blocks or change dimension. Longer
// than the directive bound because agenda work is coarser-grained and retrying
// it is more expensive. See behavior-arbiter DIRECTIVE_RETRY_HOLD_MS.
export const AGENDA_RETRY_HOLD_MS = 30_000;

function agendaMaterialBlocker(agent, entry, settled) {
  const checkpoint = agendaMaterialObservation(agent, entry);
  return createMaterialChangeBlocker({
    owner: 'agenda',
    obligationId: entry?.id,
    code: settled?.code,
    checkpoint,
    releasePredicates: [
      'dimension',
      'position_region',
      ...(checkpoint.targetSignature ? ['target_signature'] : []),
    ],
    positionRegionDistance: 8,
    holdMs: AGENDA_RETRY_HOLD_MS,
    createdAt: Date.now(),
  });
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
      // Older cave expeditions incorrectly made their explicit return home
      // conditional on finding every requested resource. Re-arm only a return
      // step that was never attempted because its failed Explorer predecessor
      // settled; a cancelled expedition remains cancelled by player authority.
      const settlementRepairById = new Map(this.entries.map(entry => [entry.id, entry]));
      let repairedSettlementContinuation = false;
      this.entries = this.entries.map(entry => {
        const predecessor = settlementRepairById.get(entry.dependsOnEntryId);
        if (
          entry.kind !== 'goto'
          || entry.state !== 'failed'
          || entry.evidence?.code !== 'agenda_dependency_failed'
          || entry.dependencyPolicy !== 'requires_success'
          || predecessor?.kind !== 'explore'
          || predecessor?.state !== 'failed'
        ) return entry;
        repairedSettlementContinuation = true;
        return normalizeAgendaEntry({
          ...entry,
          dependencyPolicy: 'after_settlement',
          state: 'pending',
          startedAt: null,
          finishedAt: null,
          executorId: '',
          evidence: {
            code: 'agenda_settlement_continuation_repaired',
            detail: 'The expedition settled; resuming its explicit return-to-player continuation.',
          },
        });
      });
      if (repairedSettlementContinuation) this.store.save(this.entries);
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

  /**
   * Normalize a complete bounded plan without mutating Agenda state. Natural
   * player plans use this receipt before surrendering the currently owned
   * action; addMany repeats the same deterministic gate immediately before its
   * one durable commit.
   */
  /**
   * The authoritative tab roster, lowercased, or null when it cannot be read.
   * Null means unknown, so entry admission keeps its shape-only check rather
   * than inventing a rejection from absent evidence.
   */
  knownPlayerNames() {
    const players = this.agent?.bot?.players;
    if (!players || typeof players !== 'object' || Array.isArray(players)) return null;
    const names = new Set();
    for (const [key, player] of Object.entries(players)) {
      for (const alias of [key, player?.username, player?.entity?.username]) {
        const name = String(alias || '').trim().toLowerCase();
        if (name) names.add(name);
      }
    }
    return names.size > 0 ? names : null;
  }

  stageMany(rawEntries, { replaceUnfinished = false } = {}) {
    if (!Array.isArray(rawEntries) || rawEntries.length < 1) {
      return { accepted: false, code: 'invalid_agenda_plan', detail: 'An agenda plan needs at least one typed step.' };
    }
    const replacing = replaceUnfinished === true;
    const liveEntries = replacing
      ? []
      : this.entries.filter(entry => !isTerminalAgendaState(entry.state));
    if (liveEntries.length + rawEntries.length > AGENDA_LIMITS.maxEntries) {
      return { accepted: false, code: 'agenda_full', detail: `The agenda can hold at most ${AGENDA_LIMITS.maxEntries} unfinished steps.` };
    }

    const staged = [];
    let stagedSequence = this.sequence;
    let previous = replacing ? null : this.entries.at(-1) || null;
    let previousStaged = null;
    try {
      for (const raw of rawEntries) {
        stagedSequence += 1;
        const dependsOnPrevious = raw?.dependsOnPrevious === true;
        if (dependsOnPrevious && !previousStaged) {
          return {
            accepted: false,
            code: 'invalid_agenda_dependency',
            detail: 'A plan-local dependency needs an earlier step in the same plan.',
          };
        }
        const linked = dependsOnPrevious
          ? {
            ...raw,
            dependsOnEntryId: previousStaged.id,
            dependencyPolicy: raw.dependencyPolicy || 'requires_success',
          }
          : raw;
        const inferred = inferredLegacyDependency(previous, linked);
        const entry = normalizeAgendaEntry(
          { ...linked, ...inferred, id: '', createdAt: this.now() },
          { now: this.now, sequence: stagedSequence, knownPlayers: this.knownPlayerNames() },
        );
        if (
          this.entries.some(existing => existing.id === entry.id)
          || staged.some(existing => existing.id === entry.id)
        ) {
          return { accepted: false, code: 'duplicate_agenda_id', detail: 'That plan could not be given unique step ids.' };
        }
        staged.push(entry);
        previous = entry;
        previousStaged = entry;
      }
    } catch (error) {
      return { accepted: false, code: 'invalid_agenda_entry', detail: boundedText(error?.message || error) };
    }

    return {
      accepted: true,
      replacing,
      liveEntries,
      staged,
      stagedSequence,
    };
  }

  validateMany(rawEntries, options = {}) {
    const staged = this.stageMany(rawEntries, options);
    if (staged.accepted !== true) return staged;
    return {
      accepted: true,
      entries: staged.staged.map(entry => ({
        id: entry.id,
        description: describeAgendaEntry(entry),
      })),
    };
  }

  /**
   * Append several validated steps as one durable queue mutation.
   *
   * Model-compiled plans must not start with a valid first step and discover
   * afterward that a later step was malformed. Stage the complete bounded
   * list, then publish and persist it once. The Agenda still only sequences;
   * GoalDirector, JobDirector, and ActionManager retain physical ownership.
   */
  addMany(rawEntries, {
    replaceUnfinished = false,
    reason = 'Superseded by a new player plan.',
  } = {}) {
    const prepared = this.stageMany(rawEntries, { replaceUnfinished });
    if (prepared.accepted !== true) return prepared;
    const {
      replacing,
      liveEntries,
      staged,
      stagedSequence,
    } = prepared;

    this.sequence = stagedSequence;
    let replaced = 0;
    if (replacing) {
      const unfinished = this.entries.filter(entry => !isTerminalAgendaState(entry.state));
      replaced = unfinished.length;
      if (replaced > 0) {
        try { this.agent.goal_director?.cancel?.(reason); } catch { /* executor may be absent */ }
        try { this.agent.job_director?.cancel?.(reason); } catch { /* executor may be absent */ }
        this.directDispatchGeneration += 1;
        this.dispatching = false;
      }
      const cancelled = unfinished.map(entry => normalizeAgendaEntry({
        ...entry,
        state: 'cancelled',
        ...(entry.kind === 'construction' ? { assignmentState: 'cancelled' } : {}),
        finishedAt: this.now(),
        evidence: { code: 'agenda_replaced', detail: reason },
      }));
      const historyLimit = Math.max(0, AGENDA_LIMITS.maxEntries - staged.length);
      const cancelledHistory = historyLimit > 0 ? cancelled.slice(-historyLimit) : [];
      this.entries = [...cancelledHistory, ...staged];
    } else {
      // Keep the queue bounded by discarding finished history, never live work.
      this.entries = [...liveEntries, ...staged];
    }
    this.nextEligibleAt = 0;
    this.persist();
    this.setStatus(
      'waiting',
      replacing ? 'agenda_plan_replaced' : 'agenda_plan_added',
      replacing
        ? `Replaced ${replaced} unfinished step${replaced === 1 ? '' : 's'} with ${staged.length} new step${staged.length === 1 ? '' : 's'}.`
        : `Queued ${staged.length} step${staged.length === 1 ? '' : 's'} as one plan.`,
    );
    const firstPosition = liveEntries.length + 1;
    return {
      accepted: true,
      replaced,
      entries: staged.map((entry, index) => ({
        id: entry.id,
        description: describeAgendaEntry(entry),
        position: firstPosition + index,
      })),
    };
  }

  /** Append one validated step. Returns a player-facing result. */
  add(raw) {
    const result = this.addMany([raw]);
    if (result.accepted !== true) return result;
    const added = result.entries[0];
    this.setStatus('waiting', 'agenda_step_added', `Queued: ${added.description}.`);
    return { accepted: true, ...added };
  }

  /**
   * Death replaces the body that owned carried inventory. If the first
   * unfinished step depends directly on a completed inventory acquisition,
   * that historical completion is no longer execution authority. Re-arm the
   * exact prerequisite and censor any callback from the dead body's direct
   * action before ordinary Agenda dispatch can resume.
   */
  reconcileDeath() {
    const dependent = this.activeEntry() || this.pending()[0] || null;
    const prerequisite = dependent?.dependsOnEntryId
      && dependent.dependencyPolicy === 'requires_success'
      ? this.entries.find(entry => entry.id === dependent.dependsOnEntryId) || null
      : null;
    if (
      !prerequisite
      || prerequisite.kind !== 'acquire'
      || prerequisite.completion !== 'inventory'
      || prerequisite.state !== 'complete'
    ) {
      return Object.freeze({
        reconciled: false,
        code: 'agenda_death_no_inventory_revalidation',
      });
    }

    this.directDispatchGeneration += 1;
    this.dispatching = false;
    const code = 'agenda_death_inventory_revalidation_required';
    this.entries = this.entries.map(entry => {
      if (entry.id === prerequisite.id) {
        return normalizeAgendaEntry({
          ...entry,
          state: 'pending',
          startedAt: null,
          finishedAt: null,
          executorId: '',
          evidence: {
            code,
            detail: 'Death invalidated current-body inventory custody; revalidating this prerequisite before dependent work.',
            retryable: true,
          },
        });
      }
      if (entry.id === dependent.id) {
        return normalizeAgendaEntry({
          ...entry,
          state: 'pending',
          startedAt: null,
          finishedAt: null,
          executorId: '',
          evidence: {
            code: 'agenda_dependency_revalidation_pending',
            detail: 'Waiting for the death-invalidated inventory prerequisite to be verified again.',
            retryable: true,
          },
        });
      }
      return entry;
    });

    const persisted = this.store?.save(this.entries) === true && !this.store?.lastError;
    if (!persisted) {
      // Keep the in-memory queue fail-closed. Without the atomic store write, a
      // restart could restore the stale completion and authorize the dependent.
      this.nextEligibleAt = Number.POSITIVE_INFINITY;
      this.setStatus(
        'failed',
        'agenda_death_revalidation_persist_failed',
        this.store?.lastError || 'The death revalidation could not be saved durably.',
        prerequisite.id,
      );
      return Object.freeze({
        reconciled: false,
        code: 'agenda_death_revalidation_persist_failed',
        prerequisiteId: prerequisite.id,
        dependentId: dependent.id,
      });
    }

    this.nextEligibleAt = Math.max(this.nextEligibleAt, this.now() + REJECTED_COOLDOWN_MS);
    this.setStatus(
      'recovering',
      code,
      `Revalidating ${describeAgendaEntry(prerequisite)} before ${describeAgendaEntry(dependent)} after death.`,
      prerequisite.id,
    );
    return Object.freeze({
      reconciled: true,
      code,
      prerequisiteId: prerequisite.id,
      dependentId: dependent.id,
    });
  }

  clear(reason = 'Cleared by the player.') {
    const cleared = this.entries.filter(entry => !isTerminalAgendaState(entry.state)).length;
    if (!cleared) return { cleared: 0, persisted: true };
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
    const persisted = this.store?.save(this.entries) === true && !this.store?.lastError;
    if (!persisted) {
      // Cancellation may be trusted only after the atomic Agenda write. Keep
      // the in-memory entries terminal and report failure so the caller can
      // retain Operator Hold; a restart may still restore the old queue, but
      // it cannot regain physical authority while that Hold remains durable.
      this.nextEligibleAt = Number.POSITIVE_INFINITY;
      this.setStatus(
        'failed',
        'agenda_clear_persist_failed',
        this.store?.lastError || 'The Agenda cancellation could not be saved durably.',
      );
      return { cleared, persisted: false };
    }
    this.setStatus('cancelled', 'agenda_cleared', reason);
    return { cleared, persisted: true };
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

    // Inventory checklists were introduced with mandatory executor
    // correlation. They may dispatch an acquire goal, but an uncorrelated old
    // result must never settle the aggregate promise.
    if (entry.kind === 'inventory_checklist') return false;

    // Compatibility for agenda entries written before executorId existed.
    // Match the complete typed contract, not merely the item name, so an old
    // unrelated GoalDirector result cannot settle newly queued work.
    const target = goal.target?.requestedName || goal.target?.canonicalName || '';
    const completion = goal.completion?.kind || goal.completion || '';
    const destination = goal.destination?.player || '';
    return goal.kind === entry.kind
      && target === entry.target
      && goal.quantity === entry.quantity
      && (goal.quantityMode || 'additional') === (entry.quantityMode || 'additional')
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
      const retryCheckpoint = !succeeded
        ? acquisitionRetryCheckpoint(entry, last)
        : null;
      if (entry.kind === 'inventory_checklist' && succeeded) {
        return {
          state: 'recheck',
          code: last?.evidence?.code || 'inventory_reconciliation_complete',
          detail: last?.evidence?.detail || '',
        };
      }
      return {
        state: succeeded ? 'complete' : 'failed',
        code: last?.evidence?.code || 'goal_ended',
        detail: last?.evidence?.detail || '',
        // GoalDirector already owns the goal's complete bounded recovery
        // budget. Agenda may continue it only when the correlated terminal
        // receipt explicitly grants retry authority (for example, a durable
        // acquisition checkpoint after material progress). Absence is unknown,
        // never permission to clone the goal with a fresh ID and budget.
        retryable: last?.evidence?.retryable === true,
        completionBlocked: last?.evidence?.completionBlocked === true,
        ...(retryCheckpoint ? { acquisitionCheckpoint: retryCheckpoint } : {}),
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
        // JobDirector already owns the complete productive/recovery budget and
        // its terminal order contains the durable checkpoint it exhausted.
        // Re-queuing here creates a new order ID, a second fresh budget, and
        // discards its explored regions and failed targets. A new player
        // request may start new work; one terminal job may not clone itself.
        retryable: false,
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

  inventoryChecklistState(entry) {
    const counts = [];
    try {
      for (const requirement of entry.inventoryRequirements || []) {
        const target = this.resolveTarget(this.agent.bot, requirement.target);
        if (!target || target.acquisitionKind === 'unsupported') {
          return {
            valid: false,
            code: 'inventory_checklist_target_unsupported',
            detail: `${requirement.target} no longer has a deterministic acquisition path.`,
          };
        }
        const count = inventoryCountForGoalTarget(this.agent.bot, target);
        counts.push({ ...requirement, targetContract: target, count });
      }
    } catch (error) {
      return {
        valid: false,
        code: 'inventory_checklist_lookup_failed',
        detail: boundedText(error?.message || error),
      };
    }
    return {
      valid: true,
      counts,
      unmet: counts.filter(requirement => requirement.count < requirement.quantity),
    };
  }

  inventoryChecklistPhysicalBlocker(entry) {
    const requirements = new Set((entry.inventoryRequirements || []).map(requirement => requirement.target));
    return this.entries.find(candidate => (
      candidate.kind === 'acquire'
      && candidate.requester === entry.requester
      && candidate.state === 'failed'
      && candidate.evidence?.completionBlocked === true
      && requirements.has(candidate.target)
      && candidate.createdAt <= entry.createdAt
      && Number.isFinite(candidate.finishedAt)
      && candidate.finishedAt >= entry.createdAt
    )) || null;
  }

  dispatchInventoryChecklistCorrection(entry, requirement) {
    const requester = entry.requester || this.agent.name;
    let goal;
    try {
      goal = createItemGoalContract({
        kind: 'acquire',
        requester,
        target: requirement.targetContract,
        quantity: requirement.quantity,
        quantityMode: 'minimum',
        request: `reconcile final item plan: at least ${requirement.quantity} ${requirement.target}`,
        baselineInventory: requirement.count,
        completion: 'inventory',
      });
    } catch (error) {
      return { accepted: false, code: 'invalid_goal', detail: boundedText(error?.message || error) };
    }
    const result = this.agent.goal_director?.submit?.(goal);
    return result?.accepted
      ? { accepted: true, executorId: result.id || goal.id }
      : {
          accepted: false,
          code: result?.code || 'goal_director_unavailable',
          detail: result?.detail || '',
        };
  }

  recheckInventoryChecklist(active, settled) {
    this.replace(active.id, {
      state: 'pending',
      startedAt: null,
      finishedAt: null,
      executorId: '',
      reconciliationTarget: '',
      evidence: {
        code: 'inventory_reconciliation_progress',
        detail: settled.detail || 'A missing final inventory floor was restored; rechecking the complete plan.',
      },
    });
    this.nextEligibleAt = this.now() + DISPATCH_COOLDOWN_MS;
    this.setStatus(
      'verifying',
      'inventory_checklist_recheck',
      'Rechecking every promised inventory floor from fresh Minecraft state.',
      active.id,
    );
    return { settled: true, state: 'recheck', retryable: true, code: settled.code };
  }

  directSettlement(result, entry = null) {
    const skillReceipt = result?.evidence?.skill;
    const composed = skillReceipt?.receiptSchemaVersion === 1
      && skillReceipt?.source === 'action_context';
    const sharedSettlement = composed
      ? {
          settlementSchemaVersion: 1,
          sampleClass: classifyMethodOutcome(result),
          materialChanged: receiptShowsMaterialProgress(skillReceipt),
        }
      : {};
    if (result?.phase !== 'succeeded' && WAITABLE_DIRECT_OUTCOMES.has(result?.code)) {
      return {
        state: 'waiting',
        code: result.code,
        detail: result.detail || '',
        retryable: true,
        ...sharedSettlement,
      };
    }
    if (
      result?.phase !== 'succeeded'
      && entry?.kind === 'prepare_food'
      && entry.bestEffort === true
      && entry.attempts + 1 >= MAX_ENTRY_ATTEMPTS
      && ['skill_partial_supply', 'skill_no_food_sources'].includes(result?.code)
    ) {
      const gainedFoodPoints = Math.max(
        0,
        familyFoodPoints(this.agent.bot) - entry.baselineFoodPoints,
      );
      const usefulMinimum = Math.min(12, entry.quantity);
      if (gainedFoodPoints >= usefulMinimum) {
        return {
          state: 'complete',
          code: 'food_stocking_useful_partial',
          detail: `Prepared ${gainedFoodPoints} additional safe food points after bounded sustainable gathering; continuing with the verified output.`,
          retryable: false,
        };
      }
    }
    if (result?.phase === 'succeeded' && entry?.kind === 'inspect_container') {
      const skill = result?.evidence?.skill;
      const expected = entry.containerConstraint;
      const observed = skill?.target;
      const exactTarget = skill?.kind === 'chest_view'
        && skill?.outcome === 'viewed'
        && observed?.name === expected?.name
        && observed?.x === expected?.position?.x
        && observed?.y === expected?.position?.y
        && observed?.z === expected?.position?.z;
      const manifest = Array.isArray(skill?.manifest)
        ? skill.manifest
          .slice(0, 54)
          .map(item => ({
            name: String(item?.name || '').trim().toLowerCase(),
            count: Math.floor(Number(item?.count) || 0),
          }))
          .filter(item => /^[a-z0-9_]{1,64}$/.test(item.name) && item.count > 0 && item.count <= 3456)
        : null;
      if (!exactTarget || !manifest || manifest.length !== skill.manifest.length) {
        return {
          state: 'failed',
          code: 'container_observation_receipt_invalid',
          detail: 'The container opened, but its exact identity or bounded contents receipt was not verified.',
          retryable: false,
        };
      }
      const report = manifest.length === 0
        ? `The selected ${expected.name.replace(/_/g, ' ')} is empty.`
        : `The selected ${expected.name.replace(/_/g, ' ')} contains: ${manifest.map(item => `${item.count} ${item.name.replace(/_/g, ' ')}`).join(', ')}.`;
      return {
        state: 'complete',
        code: result.code || 'skill_viewed',
        detail: result.detail || '',
        report: boundedText(report, 1_200),
        retryable: false,
        ...sharedSettlement,
      };
    }
    return {
      state: result?.phase === 'succeeded' ? 'complete' : 'failed',
      code: result?.code || 'action_ended',
      detail: result?.detail || '',
      retryable: result?.retryable === true,
      // Stop, death, and owner replacement are censored too, but they do not
      // authorize automatic continuation. Only the shared structured code for
      // a higher-priority lane borrowing ActionManager is resumable here.
      preempted: isResumableSafetyPreemption(result),
      ...sharedSettlement,
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
      : this.directSettlement(result, active);
    this.commitSettlement(active, settlement, {
      dependentEntryId: bindingConstraint ? dependent.id : '',
      bindingConstraint,
    });
    return true;
  }

  applyTerminalDisposition(entry) {
    const appliesTerminalHold = Boolean(
      entry.terminalDisposition === 'hold_position'
      && entry.terminalDispositionApplied !== true
    );
    if (appliesTerminalHold) {
      this.agent.holdPosition?.(
        `companion wait requested by ${entry.requester || 'player'}`,
        { preserveDurableWork: true },
      );
    }
    return appliesTerminalHold;
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
    if (settled.preempted === true && active.preemptions < MAX_ENTRY_PREEMPTIONS) {
      const preemptions = active.preemptions + 1;
      this.entries = this.entries.map(entry => (
        entry.id === active.id
          ? normalizeAgendaEntry({
              ...entry,
              state: 'pending',
              startedAt: null,
              executorId: '',
              preemptions,
              evidence: {
                code: 'preempted',
                detail: settled.detail || 'A higher-priority safety action took ownership; the player obligation is unchanged.',
                retryable: true,
              },
            })
          : entry
      ));
      this.persist();
      this.setStatus(
        'recovering',
        'preempted',
        `${describeAgendaEntry(active)}: resuming after higher-priority safety action (${preemptions}/${MAX_ENTRY_PREEMPTIONS}).`,
        active.id,
      );
      const interruption = boundedText(settled.detail, 160);
      const preemptionMessage = `I had to pause ${describeAgendaEntry(active)} for a higher-priority safety response${interruption ? `: ${interruption}` : '.'} It is still queued and will resume when that response settles (${preemptions}/${MAX_ENTRY_PREEMPTIONS}).`;
      void Promise.resolve(this.agent.openChat?.(preemptionMessage))
        .catch(() => { /* chat is best effort */ });
      this.nextEligibleAt = this.now() + REJECTED_COOLDOWN_MS;
      return { settled: true, state: 'preempted', retryable: true, code: 'preempted' };
    }
    const preemptionExhausted = settled.preempted === true;
    if (preemptionExhausted) {
      settled = {
        state: 'failed',
        code: 'agenda_preemption_exhausted',
        detail: `The player obligation was interrupted by ${MAX_ENTRY_PREEMPTIONS + 1} consecutive higher-priority actions without verified progress.`,
        retryable: false,
      };
    }
    const obligationDecision = settled.settlementSchemaVersion === 1
      ? classifyObligationSettlement({
          sampleClass: settled.sampleClass,
          externalWait: settled.state === 'waiting',
          methodRetryable: settled.retryable,
          retryAuthority: true,
          materialChanged: settled.materialChanged,
          budgetAvailable: active.attempts + 1 < MAX_ENTRY_ATTEMPTS,
        })
      : null;
    // `attempts` is the bounded method-failure budget, not a count of ownership
    // changes. A censored sample says nothing about the attempted method and
    // therefore cannot consume that budget. Successful legacy settlements keep
    // their historical accounting until the metrics schema is split explicitly.
    const attempts = active.attempts + (
      preemptionExhausted || obligationDecision?.state === 'censored' ? 0 : 1
    );
    const censored = obligationDecision?.state === 'censored';
    const waitingForMaterialChange = obligationDecision?.state === 'waiting_for_material_change';
    const retryable = obligationDecision
      ? obligationDecision.state === 'retry_authorized'
      : settled.state === 'failed'
        && settled.retryable === true
        && attempts < MAX_ENTRY_ATTEMPTS;
    const materialChangeBlocker = waitingForMaterialChange
      ? agendaMaterialBlocker(this.agent, active, settled)
      : null;
    const assignmentPatch = settled.assignmentState ? { assignmentState: settled.assignmentState } : {};
    const appliesTerminalHold = settled.state === 'complete'
      && this.applyTerminalDisposition(active);
    const activePatch = censored
      ? {
          state: 'pending',
          startedAt: null,
          executorId: '',
          attempts,
          evidence: {
            ...settled,
            code: 'censored',
            detail: settled.detail || 'Action ownership changed before the method could be evaluated.',
            retryable: true,
          },
        }
      : retryable
      ? {
          state: 'pending',
          startedAt: null,
          executorId: '',
          attempts,
          preemptions: 0,
          evidence: settled,
          ...assignmentPatch,
          ...(settled.acquisitionCheckpoint
            ? { acquisitionCheckpoint: settled.acquisitionCheckpoint }
            : {}),
        }
      : waitingForMaterialChange && materialChangeBlocker
        ? {
            state: 'pending',
            startedAt: null,
            executorId: '',
            attempts,
            preemptions: 0,
            materialChangeBlocker,
            evidence: {
              ...settled,
              code: 'waiting_for_material_change',
              detail: settled.detail || settled.code,
              retryable: true,
            },
          }
      : {
          state: settled.state,
          finishedAt: this.now(),
          attempts,
          preemptions: 0,
          evidence: settled,
          ...assignmentPatch,
          ...(appliesTerminalHold ? { terminalDispositionApplied: true } : {}),
        };
    // Persist the terminal step and its dependent exact-workstation handoff in
    // one store write. A restart can therefore never observe arrival complete
    // while the following smelt remains free to select a different furnace.
    // A retryable failure returns the parent to pending. Its dependents must
    // remain pending too; only the committed terminal parent state can make a
    // requires-success dependency impossible.
    const parentTerminallyFailed = !censored
      && !retryable
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
      settled.state === 'complete'
        ? 'succeeded'
        : censored
          ? 'waiting'
        : waitingForMaterialChange
          ? 'waiting'
          : retryable ? 'recovering' : 'failed',
      censored ? 'censored' : waitingForMaterialChange ? 'waiting_for_material_change' : settled.code,
      `${describeAgendaEntry(active)}: ${settled.state === 'complete' ? 'done' : settled.detail || settled.code}`,
    );
    this.nextEligibleAt = this.now() + (settled.state === 'complete' ? DISPATCH_COOLDOWN_MS : REJECTED_COOLDOWN_MS);
    if (censored) {
      const censoredMessage = `I had to pause ${describeAgendaEntry(active)} before its method could be evaluated. The obligation is still queued and its failure budget is unchanged.`;
      void Promise.resolve(this.agent.openChat?.(censoredMessage))
        .catch(() => { /* chat is best effort */ });
    } else if (waitingForMaterialChange) {
      const waitingMessage = `I did not finish ${describeAgendaEntry(active)}. Blocker: ${settled.detail || settled.code}. I am keeping the same obligation queued, but I will not repeat it until the position, target, or dimension materially changes.`;
      void Promise.resolve(this.agent.openChat?.(waitingMessage))
        .catch(() => { /* chat is best effort */ });
    } else if (retryable) {
      const blocker = settled.code === 'skill_died'
        ? 'I died before the step completed.'
        : `Blocker: ${settled.detail || settled.code}.`;
      const retryMessage = `I did not finish ${describeAgendaEntry(active)}. ${blocker} It remains queued for one bounded retry after the world settles (${attempts}/${MAX_ENTRY_ATTEMPTS}).`;
      void Promise.resolve(this.agent.openChat?.(retryMessage))
        .catch(() => { /* chat is best effort */ });
    } else if (settled.state === 'complete') {
      const ordinaryCompletion = appliesTerminalHold
        ? `Agenda step done: ${describeAgendaEntry(active)}. I'll wait here until you give me another order.`
        : `Agenda step done: ${describeAgendaEntry(active)}.`;
      const completionMessage = settled.report
        ? `${settled.report} ${ordinaryCompletion}`
        : ordinaryCompletion;
      void Promise.resolve(this.agent.openChat?.(completionMessage))
        .catch(() => { /* chat is best effort */ });
    } else if (settled.state === 'failed' && !retryable) {
      const authorizedContinuations = this.pending().length;
      if (authorizedContinuations === 0) {
        this.agent.holdPosition?.(
          'agenda terminal fallback awaiting player direction',
          { preserveDurableWork: true },
        );
      }
      const consequence = authorizedContinuations > 0
        ? `I did not retry without new evidence. I am continuing ${authorizedContinuations} already-authorized remaining step${authorizedContinuations === 1 ? '' : 's'}.`
        : 'I did not retry without new evidence. I am holding position.';
      const failureMessage = `I could not complete ${describeAgendaEntry(active)}. Blocker: ${settled.detail || settled.code} ${consequence}`;
      void Promise.resolve(this.agent.openChat?.(failureMessage))
        .catch(() => { /* chat is best effort */ });
    }
    return {
      settled: true,
      state: censored ? 'censored' : waitingForMaterialChange ? 'waiting_for_material_change' : settled.state,
      retryable,
      code: censored ? 'censored' : waitingForMaterialChange ? 'waiting_for_material_change' : settled.code,
    };
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

    const settled = this.settleActive(active);
    const result = settled.state === 'recheck'
      ? this.recheckInventoryChecklist(active, settled)
      : this.commitSettlement(active, settled);
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
      let dispatchEntry = entry;
      if (
        entry.kind === 'acquire'
        && entry.completion === 'inventory'
        && !entry.acquisitionCheckpoint
      ) {
        const baselineInventory = inventoryCountForGoalTarget(this.agent.bot, target);
        const targetInventory = entry.quantityMode === 'minimum'
          ? entry.quantity
          : baselineInventory + entry.quantity;
        this.replace(entry.id, {
          acquisitionCheckpoint: { baselineInventory, targetInventory },
        });
        if (this.store?.lastError) {
          return {
            accepted: false,
            code: 'agenda_quantity_checkpoint_persist_failed',
            detail: this.store.lastError,
          };
        }
        dispatchEntry = this.entries.find(candidate => candidate.id === entry.id) || entry;
      }
      const requester = entry.requester || entry.recipient || this.agent.name;
      let goal;
      try {
        const baselineInventory = dispatchEntry.acquisitionCheckpoint?.baselineInventory
          ?? inventoryCountForGoalTarget(this.agent.bot, target);
        goal = createItemGoalContract({
          kind: dispatchEntry.kind,
          requester,
          target,
          quantity: dispatchEntry.quantity,
          quantityMode: dispatchEntry.quantityMode || 'additional',
          destinationPlayer: dispatchEntry.kind === 'deliver' ? dispatchEntry.recipient : null,
          request: describeAgendaEntry(dispatchEntry),
          baselineInventory,
          completion: dispatchEntry.completion || (dispatchEntry.kind === 'deliver' ? 'delivery' : 'inventory'),
        });
        if (dispatchEntry.acquisitionCheckpoint?.miningReturnRoute?.length > 0) {
          goal = normalizeGoalContract({
            ...goal,
            checkpoint: {
              ...goal.checkpoint,
              ...dispatchEntry.acquisitionCheckpoint,
            },
          });
        }
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
        } else if (entry.kind === 'repair_access') {
          order = createAccessRepairWorkOrder(entry);
        } else {
          const miningBaseline = entry.kind === 'mine'
            ? inventoryItemCount(this.agent.bot, miningOutputName(entry.target))
            : 0;
          const harvestBaseline = entry.kind === 'harvest'
            ? logInventoryCount(this.agent.bot?.inventory?.slots || [], entry.target)
            : 0;
          const rememberedScout = entry.kind === 'scout' ? entry.rememberedFinding : null;
          const rememberedScoutPrefix = rememberedScout?.finding === 'animal'
            ? 'scoutAnimal'
            : rememberedScout?.finding === 'village'
              ? 'scoutVillage'
              : rememberedScout?.finding === 'cave'
                ? 'scoutCave'
                : '';
          const workQuota = entry.kind === 'mine'
            ? miningBaseline + entry.quantity
            : entry.quantity;
          order = createWorkOrder({
            role: JOB_ROLE_FOR_KIND[entry.kind],
            kind: JOB_ORDER_KIND[entry.kind],
            source: 'player',
            requester: entry.requester || 'player',
            target: ['explore', 'scout'].includes(entry.kind)
              ? {
                  name: entry.kind === 'scout' ? 'scout_region' : entry.target,
                  x: entry.x,
                  y: entry.y,
                  z: entry.z,
                }
              : { name: entry.target },
            quota: workQuota,
            ...(entry.kind === 'mine' ? {
              checkpoint: {
                baselineInventory: miningBaseline,
                targetInventory: workQuota,
              },
            } : {}),
            ...(entry.kind === 'harvest' ? {
              checkpoint: {
                baselineInventory: harvestBaseline,
                targetInventory: harvestBaseline + entry.quantity,
              },
            } : {}),
            ...(entry.kind === 'scout' ? {
              constraints: { maxDistance: entry.radius },
              checkpoint: {
                homeDimension: entry.homeDimension,
                scoutFindings: entry.findings,
                scoutGuideFinding: entry.guideFinding,
                ...(entry.searchLimit ? { scoutSearchLimit: entry.searchLimit } : {}),
                ...(rememberedScoutPrefix ? {
                  [`${rememberedScoutPrefix}X`]: rememberedScout.x,
                  [`${rememberedScoutPrefix}Y`]: rememberedScout.y,
                  [`${rememberedScoutPrefix}Z`]: rememberedScout.z,
                } : {}),
              },
            } : {}),
            ...(entry.kind === 'explore' ? {
              checkpoint: {
                homeDimension: entry.homeDimension,
                ...(entry.containerConstraint ? {
                  containerName: entry.containerConstraint.name,
                  containerX: entry.containerConstraint.position.x,
                  containerY: entry.containerConstraint.position.y,
                  containerZ: entry.containerConstraint.position.z,
                  containerDimension: entry.containerConstraint.dimension,
                } : {}),
                ...(entry.bestEffort === true ? { bestEffort: true } : {}),
                ...(entry.retainResults === true ? { retainResults: true } : {}),
                ...(entry.requiredOutputs?.length > 0 ? { requiredOutputs: entry.requiredOutputs } : {}),
              },
            } : {}),
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

    // A recipient accepted at admission can still be a phantom by the time it
    // dispatches. Entries restored from disk never saw a roster, because restore
    // runs before login, so a stale obligation toward somebody who has never
    // been in the world survives a restart untouched. Walking toward them can
    // only fail, and on 2026-08-15 it instead reported arrival. The roster is
    // authoritative here, unlike at restore, so check it once before executing.
    const dispatchRoster = this.knownPlayerNames();
    if (
      entry.recipient
      && dispatchRoster
      && !dispatchRoster.has(String(entry.recipient).toLowerCase())
    ) {
      return {
        accepted: false,
        code: 'unknown_recipient',
        detail: `${entry.recipient} is not a player I can see.`,
      };
    }

    // Direct steps build their command in code from already-validated fields.
    // Every interpolated value has passed `normalizeAgendaEntry`: coordinates are
    // numbers, names match the canonical pattern. No stored text is executed.
    const DIRECT_COMMANDS = {
      pickup_item: () => `!pickupItem(${JSON.stringify(entry.target)}, ${entry.quantity}, 12, ${entry.acquisitionCheckpoint.baselineInventory})`,
      consume_item: () => `!consume(${JSON.stringify(entry.target)})`,
      equip_item: () => `!equip(${JSON.stringify(entry.target)})`,
      visit: () => `!goToCoordinates(${entry.x}, ${entry.y}, ${entry.z}, 2)`,
      verify_access: () => `!goToCoordinates(${entry.x}, ${entry.y}, ${entry.z}, 0.75)`,
      craft: () => entry.workstationConstraint
        ? `!craftRecipe("${entry.target}", ${entry.quantity}, ${entry.workstationConstraint.position.x}, ${entry.workstationConstraint.position.y}, ${entry.workstationConstraint.position.z}, ${JSON.stringify(entry.workstationConstraint.dimension)})`
        : `!craftRecipe("${entry.target}", ${entry.quantity})`,
      smelt: () => entry.workstationConstraint
        ? `!smeltItem("${entry.target}", ${entry.quantity}, ${entry.workstationConstraint.position.x}, ${entry.workstationConstraint.position.y}, ${entry.workstationConstraint.position.z}, ${JSON.stringify(entry.workstationConstraint.dimension)})`
        : `!smeltItem("${entry.target}", ${entry.quantity})`,
      goto: () => `!goToPlayer("${entry.recipient}", 3)`,
      follow_until: () => `!followPlayerUntilNearBlock("${entry.recipient}", "${entry.target}", ${entry.radius})`,
      farm_visit: () => '!goToFarm',
      maintain_farm: () => '!maintainFarm',
      recover_death: () => '!recoverDeathItems',
      inspect_container: () => `!viewChestAt(${entry.containerConstraint.position.x}, ${entry.containerConstraint.position.y}, ${entry.containerConstraint.position.z}, ${JSON.stringify(entry.containerConstraint.dimension)})`,
      prepare_food: () => `!prepareFood(${entry.quantity}, 64, ${entry.workstationConstraint.position.x}, ${entry.workstationConstraint.position.y}, ${entry.workstationConstraint.position.z}, ${JSON.stringify(entry.workstationConstraint.dimension)}, ${entry.baselineFoodPoints})`,
      catch_fish: () => `!fish(${entry.quantity}, ${JSON.stringify(encodeBaselineInventory(entry.baselineInventory))})`,
      cook_fish: () => `!cookCaughtFish(${entry.quantity}, ${entry.workstationConstraint.position.x}, ${entry.workstationConstraint.position.y}, ${entry.workstationConstraint.position.z}, ${JSON.stringify(entry.workstationConstraint.dimension)}, ${JSON.stringify(encodeBaselineInventory(entry.baselineInventory))}, ${JSON.stringify(encodeBaselineInventory(entry.baselineOutputInventory))})`,
      deliver_family: () => `!giveFamilyToPlayer(${JSON.stringify(entry.target)}, ${JSON.stringify(entry.recipient)}, ${entry.quantity}, ${JSON.stringify(encodeBaselineInventory(entry.baselineInventory))})`,
      deposit: () => entry.containerConstraint
        ? `!putInChestAt("${entry.target}", ${entry.quantity}, ${entry.containerConstraint.position.x}, ${entry.containerConstraint.position.y}, ${entry.containerConstraint.position.z}, ${JSON.stringify(entry.containerConstraint.dimension)})`
        : `!putInChest("${entry.target}", ${entry.quantity})`,
      storage_plan: () => {
        const encoded = entry.storageRequirements
          .map(requirement => `${requirement.target}:${requirement.retain}`)
          .join('|');
        return `!storeInventoryPlanAt(${JSON.stringify(encoded)}, ${entry.containerConstraint.position.x}, ${entry.containerConstraint.position.y}, ${entry.containerConstraint.position.z}, ${JSON.stringify(entry.containerConstraint.dimension)})`;
      },
      deposit_family: () => {
        const baselineManifest = encodeBaselineInventory(entry.baselineInventory);
        return `!putFamilyInChestAt("${entry.target}", ${entry.quantity}, ${entry.containerConstraint.position.x}, ${entry.containerConstraint.position.y}, ${entry.containerConstraint.position.z}, ${JSON.stringify(entry.containerConstraint.dimension)}, ${JSON.stringify(baselineManifest)})`;
      },
      settle_livestock: () => `!settleLivestockAtPen(${JSON.stringify(entry.target)}, ${entry.quantity}, ${entry.breedingPairs}, ${entry.x}, ${entry.y}, ${entry.z}, ${entry.penConstraint.gate.x}, ${entry.penConstraint.gate.y}, ${entry.penConstraint.gate.z}, ${entry.penConstraint.inside.x}, ${entry.penConstraint.inside.y}, ${entry.penConstraint.inside.z}, ${entry.penConstraint.outside.x}, ${entry.penConstraint.outside.y}, ${entry.penConstraint.outside.z}, ${entry.penConstraint.bounds.minX}, ${entry.penConstraint.bounds.maxX}, ${entry.penConstraint.bounds.minZ}, ${entry.penConstraint.bounds.maxZ}, ${entry.penConstraint.bounds.y}, ${JSON.stringify(entry.penConstraint.dimension)}, ${entry.penConstraint.baselineAnimals})`,
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
      if (settled.state === 'recheck') {
        this.recheckInventoryChecklist(active, settled);
        return;
      }
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
    let next = this.pending()[0];
    if (!next) {
      if (this.status.code !== 'agenda_complete' && this.entries.length) {
        this.setStatus('idle', 'agenda_complete', 'Every queued agenda step is finished.');
        if (this.agent.companion_context?.snapshot?.().directive) {
          this.agent.behavior_arbiter?.requestDirectiveResume?.();
        }
      }
      return;
    }

    if (next.materialChangeBlocker) {
      const materialChange = evaluateMaterialChange(
        next.materialChangeBlocker,
        agendaMaterialObservation(this.agent, next),
      );
      if (materialChange.materialChanged !== true) {
        this.nextEligibleAt = this.now() + REJECTED_COOLDOWN_MS;
        this.setStatus(
          'waiting',
          'waiting_for_material_change',
          `${describeAgendaEntry(next)} remains queued; its failed position, target, and dimension are materially unchanged.`,
          next.id,
        );
        return;
      }
      this.replace(next.id, {
        materialChangeBlocker: null,
        evidence: {
          code: 'material_change_observed',
          detail: `Retry authority released by: ${materialChange.changedBy.join(', ')}.`,
          retryable: true,
        },
      });
      next = this.entries.find(entry => entry.id === next.id);
      this.nextEligibleAt = 0;
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
      if (
        next.dependencyPolicy === 'after_settlement'
        && !isTerminalAgendaState(predecessor.state)
      ) {
        this.setStatus('waiting', 'agenda_dependency_pending', `Waiting for: ${describeAgendaEntry(predecessor)}.`, next.id);
        return;
      }
      if (
        next.dependencyPolicy === 'requires_success'
        && predecessor.state !== 'complete'
      ) {
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

    if (next.kind === 'inventory_checklist') {
      const physicalBlocker = this.inventoryChecklistPhysicalBlocker(next);
      if (physicalBlocker) {
        const detail = `${physicalBlocker.target} reached a blocked physical postcondition (${physicalBlocker.evidence.code || 'capability_postcondition_blocked'}); inventory from another source cannot certify this plan.`;
        this.replace(next.id, {
          state: 'failed',
          finishedAt: this.now(),
          evidence: {
            code: 'inventory_checklist_physical_postcondition_blocked',
            detail,
            retryable: false,
            completionBlocked: true,
          },
        });
        this.setStatus('failed', 'inventory_checklist_physical_postcondition_blocked', detail, next.id);
        return;
      }
      const checklist = this.inventoryChecklistState(next);
      if (!checklist.valid) {
        this.replace(next.id, {
          state: 'failed',
          finishedAt: this.now(),
          evidence: { code: checklist.code, detail: checklist.detail },
        });
        this.setStatus('failed', checklist.code, checklist.detail, next.id);
        return;
      }
      if (checklist.unmet.length === 0) {
        const detail = `Verified ${checklist.counts.length} final inventory floor${checklist.counts.length === 1 ? '' : 's'} from current Minecraft state.`;
        const appliesTerminalHold = this.applyTerminalDisposition(next);
        this.replace(next.id, {
          state: 'complete',
          finishedAt: this.now(),
          evidence: { code: 'inventory_checklist_verified', detail },
          ...(appliesTerminalHold ? { terminalDispositionApplied: true } : {}),
        });
        this.nextEligibleAt = this.now() + DISPATCH_COOLDOWN_MS;
        this.setStatus('succeeded', 'inventory_checklist_verified', detail, next.id);
        const completionMessage = appliesTerminalHold
          ? `Agenda step done: ${describeAgendaEntry(next)}. I'll wait here until you give me another order.`
          : `Agenda step done: ${describeAgendaEntry(next)}.`;
        void Promise.resolve(this.agent.openChat?.(completionMessage))
          .catch(() => { /* chat is best effort */ });
        return;
      }
      if (next.reconciliations >= MAX_INVENTORY_RECONCILIATIONS) {
        const missing = checklist.unmet.map(item => `${item.target} ${item.count}/${item.quantity}`).join(', ');
        const detail = `The final inventory plan did not converge after ${next.reconciliations} bounded corrections. Still missing: ${missing}.`;
        this.replace(next.id, {
          state: 'failed',
          finishedAt: this.now(),
          evidence: { code: 'inventory_checklist_nonconvergent', detail },
        });
        this.setStatus('failed', 'inventory_checklist_nonconvergent', detail, next.id);
        return;
      }
      const requirement = checklist.unmet[0];
      const outcome = this.dispatchInventoryChecklistCorrection(next, requirement);
      if (!outcome.accepted) {
        const detail = outcome.detail || `Could not restore the ${requirement.target} inventory floor.`;
        this.replace(next.id, {
          state: 'failed',
          finishedAt: this.now(),
          evidence: { code: outcome.code, detail },
        });
        this.setStatus('failed', outcome.code, detail, next.id);
        return;
      }
      this.replace(next.id, {
        state: 'active',
        startedAt: this.now(),
        executorId: outcome.executorId,
        reconciliationTarget: requirement.target,
        reconciliations: next.reconciliations + 1,
        evidence: {
          code: 'inventory_reconciliation_started',
          detail: `Restoring ${requirement.target} from ${requirement.count} to the promised floor of ${requirement.quantity}.`,
        },
      });
      this.setStatus(
        'acting',
        'inventory_reconciliation_started',
        `Restoring final inventory floor: ${requirement.target} ${requirement.count}/${requirement.quantity}.`,
        next.id,
      );
      return;
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
      // An absent recipient is terminal, not transient. Retrying cannot put a
      // player in the world, so burning the attempt budget against unchanged
      // evidence would be the same unchanged-retry loop this contract bans.
      // Fail truthfully instead; the player can ask again once they are here.
      const terminalCodes = ['unsupported_target', 'unknown_recipient'];
      const retryable = attempts < MAX_ENTRY_ATTEMPTS && !terminalCodes.includes(outcome.code);
      this.replace(next.id, retryable
        ? { attempts, evidence: { code: outcome.code, detail: outcome.detail } }
        : { state: 'failed', finishedAt: this.now(), attempts, evidence: { code: outcome.code, detail: outcome.detail } });
      this.nextEligibleAt = this.now() + REJECTED_COOLDOWN_MS;
      this.setStatus('failed', outcome.code, `${describeAgendaEntry(next)}: ${outcome.detail || outcome.code}`);
      return;
    }
    this.replace(next.id, { state: 'active', startedAt: this.now(), executorId: outcome.executorId || '' });
    this.setStatus('acting', 'agenda_step_started', `Starting: ${describeAgendaEntry(next)}.`, next.id);
    if (next.preemptions > 0 || next.attempts > 0) {
      const resumeMessage = next.preemptions > 0
        ? `The safety response settled. I am resuming ${describeAgendaEntry(next)} now (${next.preemptions}/${MAX_ENTRY_PREEMPTIONS} safety interruption${next.preemptions === 1 ? '' : 's'} so far).`
        : `The world has settled. I am retrying ${describeAgendaEntry(next)} now (${next.attempts + 1}/${MAX_ENTRY_ATTEMPTS}).`;
      void Promise.resolve(this.agent.openChat?.(resumeMessage))
        .catch(() => { /* chat is best effort */ });
    }
  }
}
