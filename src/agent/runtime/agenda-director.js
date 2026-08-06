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

  /** Append one validated step. Returns a player-facing result. */
  add(raw) {
    if (this.entries.filter(entry => !isTerminalAgendaState(entry.state)).length >= AGENDA_LIMITS.maxEntries) {
      return { accepted: false, code: 'agenda_full', detail: `The agenda already holds ${AGENDA_LIMITS.maxEntries} unfinished steps.` };
    }
    let entry;
    try {
      this.sequence += 1;
      entry = normalizeAgendaEntry(
        { ...raw, id: '', createdAt: this.now() },
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
    this.entries = this.entries.map(entry => (
      isTerminalAgendaState(entry.state)
        ? entry
        : normalizeAgendaEntry({ ...entry, state: 'cancelled', finishedAt: this.now(), evidence: { code: 'agenda_cleared', detail: reason } })
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
    this.replace(entry.id, { state: 'skipped', finishedAt: this.now(), evidence: { code: 'agenda_skipped', detail: reason } });
    this.nextEligibleAt = 0;
    return { skipped: describeAgendaEntry(entry) };
  }

  replace(id, patch) {
    this.entries = this.entries.map(entry => (
      entry.id === id ? normalizeAgendaEntry({ ...entry, ...patch }) : entry
    ));
    this.persist();
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
      };
    }
    const result = this.agent.last_action_result;
    return {
      state: result?.phase === 'succeeded' ? 'complete' : 'failed',
      code: result?.code || 'action_ended',
      detail: result?.detail || '',
    };
  }

  commitSettlement(active, settled) {
    const attempts = active.attempts + 1;
    const retryable = settled.state === 'failed'
      && settled.retryable !== false
      && attempts < MAX_ENTRY_ATTEMPTS;
    this.replace(active.id, retryable
      ? { state: 'pending', startedAt: null, executorId: '', attempts, evidence: settled }
      : { state: settled.state, finishedAt: this.now(), attempts, evidence: settled });
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
      smelt: () => `!smeltItem("${entry.target}", ${entry.quantity})`,
      goto: () => `!goToPlayer("${entry.recipient}", 3)`,
    };
    const command = (DIRECT_COMMANDS[entry.kind] || DIRECT_COMMANDS.goto)();
    this.dispatching = true;
    void Promise.resolve(this.executeAgendaCommand(this.agent, command, { owner: 'player' }))
      .catch(error => {
        console.warn(`[agenda] Direct step failed: ${boundedText(error?.message || error)}`);
      })
      .finally(() => {
        this.dispatching = false;
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
      const settled = this.settleActive(active);
      this.commitSettlement(active, settled);
      return;
    }

    if (this.now() < this.nextEligibleAt || !this.executorsIdle()) return;
    const next = this.pending()[0];
    if (!next) {
      if (this.status.code !== 'agenda_complete' && this.entries.length) {
        this.setStatus('idle', 'agenda_complete', 'Every queued agenda step is finished.');
      }
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
