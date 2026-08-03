import { comportmentPauseMs, normalizeComportment } from './comportment.js';
import settings from '../settings.js';
import { DecisionTraceRecorder } from './decision-trace.js';

// Fallback for bots whose runtime config predates comportment. Neutral is the
// exact pre-comportment pacing, so an unconfigured bot behaves as it always did.
const NEUTRAL_COMPORTMENT = normalizeComportment();

const EMERGENCY_MODES = Object.freeze(['self_preservation']);
const PROTECTION_MODES = Object.freeze(['self_defense', 'cowardice']);
const RECOVERY_MODES = Object.freeze(['unstuck']);
// These three shipped enabled but belonged to no band, so nothing ever
// evaluated them: the bot never picked up a drop it walked past, never lit a
// dark room, and never hunted. They are the difference between a bot that
// executes orders and a player who notices things.
const OPPORTUNITY_MODES = Object.freeze(['item_collecting', 'torch_placing', 'hunting']);
const IDLE_EMBODIMENT_MODES = Object.freeze(['elbow_room', 'idle_staring']);
const PLAYER_JOB_SOURCES = new Set(['player', 'restart']);
// Automatic role work also owns a live order. Without this set the role lane
// only ran while `activeOrder` was null, so a dispatched role order advanced
// exactly once and then stalled with no lane willing to tick it again.
const ROLE_JOB_SOURCES = new Set(['role']);
const EXPLICIT_GOAL_SOURCES = new Set(['explicit', 'restored']);
const MAX_STATUS_TEXT = 240;

// Per-lane base tick period. Reflex lanes re-evaluate quickly so a threat is
// answered in one frame rather than one third of a second; cosmetic and idle
// lanes back off so a full squad does not burn CPU doing nothing.
const LANE_TICK_MS = Object.freeze({
  emergency_self_preservation: 80,
  attributed_protection: 100,
  bounded_recovery: 150,
  basic_survival: 180,
  player_directive: 220,
  player_goal: 240,
  player_job: 240,
  role_work: 280,
  self_progression: 320,
  opportunity: 350,
  factual_reaction: 300,
  active_action: 240,
  idle_embodiment: 400,
  self_prompt: 400,
  comportment_pause: 120,
  degraded: 500,
  idle: 500,
  operator_hold: 600,
  stopped: 600,
  initializing: 300,
});
const DEFAULT_TICK_MS = 300;
const MIN_TICK_MS = 60;
const MAX_TICK_MS = 1_000;
// A burst of world events must not turn the loop into a spin. Early wake-ups
// coalesce onto this floor, so a mob swarm produces one prompt evaluation
// rather than one evaluation per packet.
const WAKE_FLOOR_MS = 50;
// Urgency is authoritative over comportment: a bot never dawdles while it is
// drowning, starving, or being hit, no matter how casual its persona is.
const URGENCY_TICK_CAP = Object.freeze({
  critical: 80,
  elevated: 160,
  calm: MAX_TICK_MS,
});

/**
 * Pure cadence selection. Exported so pacing can be reasoned about and tested
 * without spinning a bot.
 */
export function tickDelayForStatus(status, {
  urgency = 'calm',
  cadenceScale = 1,
  pauseRemainingMs = 0,
} = {}) {
  const remaining = Number(pauseRemainingMs);
  if (Number.isFinite(remaining) && remaining > 0) {
    return Math.min(MAX_TICK_MS, Math.max(MIN_TICK_MS, Math.round(remaining)));
  }
  const base = LANE_TICK_MS[String(status?.selectedLane || '')] ?? DEFAULT_TICK_MS;
  const scale = Number.isFinite(Number(cadenceScale))
    ? Math.min(3, Math.max(0.5, Number(cadenceScale)))
    : 1;
  const cap = URGENCY_TICK_CAP[urgency] ?? MAX_TICK_MS;
  const scaled = urgency === 'calm' ? base * scale : base;
  return Math.min(MAX_TICK_MS, Math.max(MIN_TICK_MS, Math.round(Math.min(scaled, cap))));
}

function boundedText(value, fallback = '') {
  return String(value || fallback)
    .replace(/[\u0000-\u001f\u007f]/g, ' ') // eslint-disable-line no-control-regex
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_STATUS_TEXT);
}

export class BehaviorArbiter {
  constructor(agent, {
    now = Date.now,
    random = Math.random,
    monotonicNow = () => performance.now(),
    trace = null,
  } = {}) {
    this.agent = agent;
    this.now = now;
    this.random = typeof random === 'function' ? random : Math.random;
    this.stopped = false;
    this.updating = false;
    this.directiveResumeRequested = false;
    this.tick = 0;
    this.lastObservedAt = null;
    this.nextTickDelayMs = DEFAULT_TICK_MS;
    this.urgency = 'calm';
    this.traceEvaluationLane = null;
    // Wake channel. Perception was previously sampled purely on a schedule, so
    // a hostile that loaded right after a tick went unnoticed for the whole
    // selected period, and an idle lane had selected a period of half a second.
    this.wakeResolve = null;
    this.wakeTimer = null;
    this.wakeDeadline = 0;
    this.pendingWake = null;
    this.lastTickStartedAt = 0;
    // Why the loop resumed, carried into the decision trace so an early
    // evaluation is distinguishable from a scheduled one in recorded evidence.
    this.lastWakeReason = null;
    const traceConfig = trace && typeof trace === 'object'
      ? trace
      : settings.decision_trace && typeof settings.decision_trace === 'object'
        ? settings.decision_trace
        : {};
    this.traceRecorder = new DecisionTraceRecorder({
      enabled: traceConfig.enabled !== false,
      retention: traceConfig.retention,
      now,
      monotonicNow,
      agent: agent?.name || 'bot',
    });
    // Comportment pacing state: `wasActing` remembers whether the previous tick
    // owned an action so the hesitation can be armed exactly once on release.
    this.wasActing = false;
    this.comportmentPauseUntil = 0;
    this.status = {
      selectedLane: 'initializing',
      code: 'not_started',
      reason: 'Waiting for the first coordinated behavior tick.',
      observedAt: null,
      perceptionFreshness: 'unknown',
      perceptionAge: null,
      perceptionError: null,
      activeActionOwner: null,
      activeActionLabel: null,
      lowerLanesSuppressed: false,
      tick: 0,
      updatedAt: null,
    };
  }

  stop() {
    if (this.stopped) return false;
    this.stopped = true;
    this.directiveResumeRequested = false;
    this.comportmentPauseUntil = 0;
    this.wasActing = false;
    this.pendingWake = null;
    // Release a parked loop immediately so teardown never waits out a sleep.
    if (this.wakeResolve) this.wakeResolve('stopped');
    this.select('stopped', 'arbiter_stopped', 'Behavior arbitration stopped during teardown.', true);
    return true;
  }

  requestDirectiveResume() {
    if (this.stopped) return false;
    this.directiveResumeRequested = true;
    this.wake('directive_resume');
    return true;
  }

  /**
   * Wait for the next evaluation. Resolves on the scheduled deadline, or early
   * when `wake` reports a world edge that could change which lane should own
   * the body. The returned reason is informational.
   */
  sleep(delayMs) {
    if (this.stopped) return Promise.resolve('stopped');
    const bounded = Math.max(0, Math.min(MAX_TICK_MS, Number(delayMs) || 0));
    const now = this.now();
    const floorRemaining = Math.max(0, this.lastTickStartedAt + WAKE_FLOOR_MS - now);
    let wait = bounded;
    let latched = null;
    if (this.pendingWake) {
      latched = this.pendingWake;
      this.pendingWake = null;
      // The floor applies to an edge latched during evaluation too. Events
      // arrive while update() is awaiting, so without this a steady stream of
      // them would drive the loop back to back with no delay whatsoever.
      wait = Math.min(bounded, floorRemaining);
    }
    if (wait <= 0) {
      this.lastWakeReason = latched || 'immediate';
      return Promise.resolve(this.lastWakeReason);
    }
    return new Promise(resolve => {
      const settle = reason => {
        if (this.wakeTimer) clearTimeout(this.wakeTimer);
        this.wakeTimer = null;
        this.wakeResolve = null;
        this.wakeDeadline = 0;
        this.lastWakeReason = reason;
        resolve(reason);
      };
      this.wakeResolve = settle;
      this.wakeDeadline = now + wait;
      this.wakeTimer = setTimeout(() => settle(latched || 'scheduled'), wait);
    });
  }

  /**
   * Ask for an evaluation sooner than the scheduled one. Safe to call from any
   * event handler and at any rate: while the loop is already evaluating the
   * request is latched rather than lost, and bursts coalesce onto WAKE_FLOOR_MS
   * so this can never schedule work faster than the loop can retire it.
   */
  wake(reason = 'world_event') {
    if (this.stopped) return false;
    const label = boundedText(reason, 'world_event');
    if (!this.wakeResolve) {
      // Mid-evaluation: remember the edge so the next sleep is skipped instead
      // of the loop settling back down as though nothing had happened.
      this.pendingWake = label;
      return true;
    }
    const now = this.now();
    const target = Math.max(now, this.lastTickStartedAt + WAKE_FLOOR_MS);
    if (target >= this.wakeDeadline) return false;
    const settle = this.wakeResolve;
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeDeadline = target;
    this.wakeTimer = setTimeout(() => settle(label), Math.max(0, target - now));
    return true;
  }

  actionState() {
    const actions = this.agent?.actions;
    // `_executeResume` publishes the label a moment before `executing` flips, so
    // gating purely on `executing` left a one-tick window where a resuming
    // action looked idle and a lower lane could claim ownership underneath it.
    const active = Boolean(actions?.executing) || Boolean(actions?.currentActionLabel);
    return {
      actionId: active ? boundedText(actions.currentActionId) || null : null,
      owner: active ? boundedText(actions.currentActionOwner, 'unknown') : null,
      ownerPriority: active && typeof actions?.ownerPriority === 'function'
        ? actions.ownerPriority(actions.currentActionOwner)
        : null,
      label: active ? boundedText(actions.currentActionLabel, 'unknown') : null,
      intent: active ? boundedText(actions.currentActionLabel, 'unknown') : null,
      acquiredAt: active && Number.isFinite(actions.currentActionStartedAt)
        ? actions.currentActionStartedAt
        : null,
      startedAt: active && Number.isFinite(actions.currentActionStartedAt)
        ? actions.currentActionStartedAt
        : null,
      commitment: {
        resumeAction: boundedText(actions?.resume_name) || null,
        goalId: boundedText(this.agent?.goal_director?.activeGoal?.id) || null,
        goalPhase: boundedText(this.agent?.goal_director?.activeGoal?.phase) || null,
        workOrderId: boundedText(
          this.agent?.job_director?.activeOrder?.id
          || this.agent?.job_director?.activeOrder?.orderId,
        ) || null,
        workOrderPhase: boundedText(this.agent?.job_director?.activeOrder?.phase) || null,
      },
    };
  }

  select(selectedLane, code, reason, lowerLanesSuppressed = false, perception = null) {
    const action = this.actionState();
    const observedAt = perception?.observedAt ?? this.status.observedAt;
    const now = this.now();
    this.status = {
      selectedLane: boundedText(selectedLane, 'idle'),
      code: boundedText(code, 'idle'),
      reason: boundedText(reason),
      observedAt: Number.isFinite(observedAt) ? observedAt : null,
      perceptionFreshness: perception?.freshness || this.status.perceptionFreshness || 'unknown',
      perceptionAge: Number.isFinite(observedAt) ? Math.max(0, now - observedAt) : null,
      perceptionError: perception?.error || null,
      activeActionOwner: action.owner,
      activeActionLabel: action.label,
      lowerLanesSuppressed: lowerLanesSuppressed === true,
      tick: this.tick,
      updatedAt: now,
    };
    this.nextTickDelayMs = tickDelayForStatus(this.status, {
      urgency: this.urgency,
      cadenceScale: this.comportment().cadenceScale,
      pauseRemainingMs: this.comportmentPauseUntil - now,
    });
    this.traceRecorder.select({
      lane: selectedLane,
      evaluatedLane: this.traceEvaluationLane || selectedLane,
      reasonCode: code,
      lowerLanesSuppressed,
    });
    return this.snapshot();
  }

  selectFrom(traceLane, ...selection) {
    this.traceEvaluationLane = traceLane;
    try {
      return this.select(...selection);
    } finally {
      this.traceEvaluationLane = null;
    }
  }

  recordActionStart(action) {
    return this.traceRecorder.linkAction(action);
  }

  recordActionRelease(action) {
    return this.traceRecorder.linkRelease(action);
  }

  recordOutcome(result) {
    return this.traceRecorder.linkOutcome(result);
  }

  comportment() {
    return this.agent?.runtime?.comportment || NEUTRAL_COMPORTMENT;
  }

  /**
   * Cheap urgency read from state the bot already holds. Deliberately performs
   * no world scan so it can run on every tick without costing frame time.
   */
  urgencyOf() {
    const bot = this.agent?.bot;
    if (!bot) return 'calm';
    const health = Number(bot.health);
    const food = Number(bot.food);
    const oxygen = Number(bot.oxygenLevel);
    const lastDamageTime = Number(bot.lastDamageTime);
    const sinceDamage = Number.isFinite(lastDamageTime) && lastDamageTime > 0
      ? this.now() - lastDamageTime
      : Infinity;
    if (
      (Number.isFinite(health) && health <= 10)
      || (Number.isFinite(oxygen) && oxygen <= 12)
      || sinceDamage <= 2_000
    ) return 'critical';
    if (
      (Number.isFinite(health) && health <= 16)
      || (Number.isFinite(food) && food <= 6)
      || sinceDamage <= 6_000
    ) return 'elevated';
    return 'calm';
  }

  /**
   * Human personas hesitate after finishing something before claiming the next
   * piece of work. Emergency, protection, and recovery lanes sit above this and
   * are never delayed; a critical urgency reading clears the pause outright.
   */
  observeActionRelease(acting) {
    if (acting) {
      this.wasActing = true;
      this.comportmentPauseUntil = 0;
      return;
    }
    if (!this.wasActing) return;
    this.wasActing = false;
    const pause = comportmentPauseMs(this.comportment(), {
      afterAction: true,
      random: this.random,
    });
    this.comportmentPauseUntil = pause > 0 ? this.now() + pause : 0;
  }

  async refreshPerception() {
    const observer = this.agent?.environment_observer;
    const now = this.now();
    if (!observer?.update) {
      return { observedAt: this.lastObservedAt, freshness: this.lastObservedAt ? 'stale' : 'unknown', error: 'observer_unavailable' };
    }
    const wasDue = !Number.isFinite(observer.nextSampleAt) || now >= observer.nextSampleAt;
    try {
      await Promise.resolve(observer.update());
      const context = this.agent.companion_context;
      const requested = context?.requestedName || context?.canonicalUsername || context?.chatAlias;
      if (requested && context?.resolve && context?.observeResolution) {
        const resolution = context.resolve(requested);
        context.observeResolution(requested, resolution, {
          dimension: this.agent.bot?.game?.dimension,
        });
      }
      if (wasDue) this.lastObservedAt = now;
      const age = this.lastObservedAt === null ? Infinity : now - this.lastObservedAt;
      return {
        observedAt: this.lastObservedAt,
        freshness: this.lastObservedAt === null ? 'unknown' : age <= 1_500 ? 'fresh' : 'stale',
        error: null,
      };
    } catch (error) {
      return {
        observedAt: this.lastObservedAt,
        freshness: this.lastObservedAt === null ? 'unknown' : 'stale',
        error: boundedText(error?.message || error, 'observer_failed'),
      };
    }
  }

  async evaluateModeBand(lane, names, perception) {
    this.traceRecorder.startLane(lane);
    try {
      const result = await this.agent.bot?.modes?.updateBand?.(names);
      if (result?.active || result?.scheduled) {
        this.traceRecorder.finishLane(lane, {
          status: 'eligible',
          reasonCode: result.code || 'mode_scheduled',
          targetRef: result.mode ? `mode:${result.mode}` : null,
          evidenceRefs: [`perception-${this.tick}`],
        });
        return this.select(
          lane,
          result.code || 'mode_scheduled',
          `${result.mode || lane} owns the selected mode band.`,
          true,
          perception,
        );
      }
      this.traceRecorder.finishLane(lane, {
        status: 'ineligible',
        reasonCode: result?.code || 'mode_band_inactive',
      });
      return null;
    } catch (error) {
      return this.select(
        lane,
        'mode_band_failed',
        `Mode band failed safely: ${boundedText(error?.message || error)}`,
        true,
        perception,
      );
    }
  }

  classifyActiveAction(perception) {
    const action = this.actionState();
    if (!action.label) return null;
    if (action.label === 'mode:self_preservation') {
      return this.select('emergency_self_preservation', 'emergency_action_active', 'Emergency self-preservation owns ActionManager.', true, perception);
    }
    if (action.label === 'mode:self_defense' || action.owner === 'reflex') {
      return this.select('attributed_protection', 'reflex_action_active', 'A bounded protection or self-defense reflex owns ActionManager.', true, perception);
    }
    if (action.owner === 'survival') {
      return this.select('basic_survival', 'survival_action_active', 'Basic survival maintenance owns ActionManager.', true, perception);
    }
    if (action.owner === 'job') {
      const source = this.agent.job_director?.activeOrder?.source;
        return PLAYER_JOB_SOURCES.has(source)
            ? this.select('player_job', 'player_job_action_active', 'An explicit resumable job owns ActionManager.', true, perception)
            : this.select('role_work', 'role_action_active', 'Existing non-command role work owns ActionManager.', true, perception);
    }
    if (action.owner === 'player' && this.agent.goal_director?.activeGoal) {
      return this.select('player_goal', 'player_goal_action_active', 'A typed player goal subgoal owns ActionManager.', true, perception);
    }
    if (action.owner === 'background') {
      return this.select('factual_reaction', 'background_action_active', 'A bounded background reaction owns ActionManager.', true, perception);
    }
    const directive = this.agent.companion_context?.snapshot?.().directive;
    return this.select(
      directive ? 'player_directive' : 'active_action',
      directive ? 'player_continuation_active' : 'action_active',
      `${action.owner || 'current'} action ${action.label} retains serialized ownership.`,
      true,
      perception,
    );
  }

  selfPromptPermitted() {
    if (this.agent.runtime?.autonomy !== 'command') return true;
    return EXPLICIT_GOAL_SOURCES.has(this.agent.self_prompter?.goal_source);
  }

  async update(delta = 0) {
    if (this.stopped) return this.snapshot();
    if (this.updating) return this.snapshot();
    this.updating = true;
    this.lastTickStartedAt = this.now();
    this.tick += 1;
    const modes = this.agent.bot?.modes;
    this.urgency = this.urgencyOf();
    // A tick that a world edge asked for is recorded as that edge. Without this
    // every evaluation looked scheduled, and the one thing worth measuring --
    // whether a threat actually shortened the wait -- left no evidence behind.
    const wakeReason = this.lastWakeReason;
    this.lastWakeReason = null;
    const scheduledWake = !wakeReason || wakeReason === 'scheduled' || wakeReason === 'immediate';
    // `delta` spans behavior-loop starts and `nextTickDelayMs` is the period
    // requested by the prior decision. Their positive difference is scheduled
    // loop delay/overrun, not a general measurement of Node event-loop lag.
    this.traceRecorder.recordScheduledLoopDelay(delta, this.nextTickDelayMs, scheduledWake);
    this.traceRecorder.begin({
      tick: this.tick,
      trigger: {
        code: this.directiveResumeRequested
          ? 'directive_resume'
          : scheduledWake ? 'scheduled_tick' : wakeReason,
        deltaMs: Number.isFinite(Number(delta)) ? Number(delta) : null,
      },
      activeAction: this.actionState(),
    });
    this.traceRecorder.startStage('perception_refresh');
    const perception = await this.refreshPerception();
    this.traceRecorder.finishStage('perception_refresh');
    this.traceRecorder.addEvidence({
      id: `perception-${this.tick}`,
      source: 'environment_observer',
      observedAt: perception.observedAt,
      summary: perception.error || perception.freshness,
    });
    let modeCycleStarted = false;
    try {
      try {
        modes?.beginUpdateCycle?.();
        modeCycleStarted = true;
      } catch (error) {
        return this.select('degraded', 'mode_cycle_failed', `Mode cycle failed safely: ${boundedText(error?.message || error)}`, true, perception);
      }
      // Operator Stop is authoritative over every ordinary lane, but it is not
      // a suicide switch. modes.js and ActionManager both expose one exact,
      // bounded exception for `reflex + mode:self_preservation`; evaluate that
      // exception before the hold gate so drowning, burning, falling, or a
      // severe low-health hit can use it without releasing the hold.
      let selected = await this.evaluateModeBand('emergency_self_preservation', EMERGENCY_MODES, perception);
      if (selected) return selected;

      this.traceRecorder.startLane('operator_hold');
      if (this.agent.isOperatorHeld?.()) {
        this.directiveResumeRequested = false;
        return this.select(
          'operator_hold',
          'operator_hold_safe',
          this.agent.operator_hold_reason
            ? `${this.agent.operator_hold_reason} No immediate self-preservation response is required.`
            : 'Operator Stop remains active; no immediate self-preservation response is required.',
          true,
          perception,
        );
      }
      this.traceRecorder.finishLane('operator_hold', { status: 'ineligible', reasonCode: 'operator_not_held' });

      selected = await this.evaluateModeBand('attributed_protection', PROTECTION_MODES, perception);
      if (selected) return selected;

      // Player and job actions already own a serialized ActionManager turn.
      // Classify that ownership before asking recovery modes to inspect the
      // world; otherwise unstuck can see the first motionless frames of a new
      // command and preempt it before the pathfinder has had a chance to move.
      const activeBeforeSelection = this.actionState();
      if (['player', 'job'].includes(activeBeforeSelection.owner)) {
        try {
          // Reactions may speak while accompanying or working for the player.
          // ReactionDirector already refuses gestures unless the agent is idle,
          // so this cannot steal movement/combat/tool ownership.
          this.agent.reaction_director?.update?.();
        } catch (error) {
          console.warn(`[behavior-arbiter] Concurrent factual reaction failed safely: ${boundedText(error?.message || error)}`);
        }
      }
      this.traceRecorder.startLane('active_action_retention');
      this.traceEvaluationLane = 'active_action_retention';
      try {
        selected = this.classifyActiveAction(perception);
      } finally {
        this.traceEvaluationLane = null;
      }
      this.observeActionRelease(Boolean(selected));
      if (selected) return selected;
      this.traceRecorder.finishLane('active_action_retention', { status: 'ineligible', reasonCode: 'no_active_action' });

      // Recovery remains above survival and all autonomous work, but only when
      // no live player/job action owns the body. `unstuck` itself measures an
      // objective movement failure window before it takes control.
      selected = await this.evaluateModeBand('bounded_recovery', RECOVERY_MODES, perception);
      if (selected) return selected;

      if (this.urgency === 'critical') {
        this.comportmentPauseUntil = 0;
        this.traceRecorder.startLane('comportment_pause');
        this.traceRecorder.finishLane('comportment_pause', { status: 'ineligible', reasonCode: 'critical_urgency_override' });
      } else if (this.comportmentPauseUntil > this.now()) {
        this.traceRecorder.startLane('comportment_pause');
        return this.select(
          'comportment_pause',
          'comportment_pause',
          `${this.comportment().label} persona is pausing briefly before taking new work.`,
          true,
          perception,
        );
      } else {
        this.traceRecorder.startLane('comportment_pause');
        this.traceRecorder.finishLane('comportment_pause', { status: 'ineligible', reasonCode: 'no_comportment_pause' });
      }

      const companion = this.agent.companion_context?.snapshot?.();
      if (!companion?.directive) this.directiveResumeRequested = false;
      this.traceRecorder.startLane('player_directive');
      if (
        companion?.directive
        && companion.presence === 'present'
        && (this.agent.actions?.resume_func || this.directiveResumeRequested)
        && this.agent.isIdle?.()
        && (this.directiveResumeRequested || !this.agent.self_prompter?.isActive?.())
      ) {
        const resumedExistingAction = Boolean(this.agent.actions?.resume_func && !this.directiveResumeRequested);
        const operation = resumedExistingAction
          ? this.agent.actions.resumeAction()
          : this.agent.resumeCompanionDirective?.();
        this.directiveResumeRequested = false;
        void Promise.resolve(operation).catch(error => {
          console.error(`[behavior-arbiter] Companion continuation failed: ${boundedText(error?.message || error)}`);
        });
        return this.select(
          'player_directive',
          resumedExistingAction ? 'continuation_resumed' : 'directive_reappeared',
          'Resuming the existing explicit follow or guard action.',
          true,
          perception,
        );
      }
      this.traceRecorder.finishLane('player_directive', { status: 'ineligible', reasonCode: 'directive_not_resumable' });

      const survival = this.agent.survival_director;
      this.traceRecorder.startLane('basic_survival');
      if (survival?.update) {
        try {
          survival.update();
        } catch (error) {
          return this.select('basic_survival', 'survival_update_failed', `Survival policy failed safely: ${boundedText(error?.message || error)}`, true, perception);
        }
        if (survival.inFlight || survival.blocksLowerPriority?.() || this.agent.actions?.executing) {
          return this.select('basic_survival', survival.status?.code || 'survival_selected', 'Basic survival maintenance selected the tick.', true, perception);
        }
      }
      this.traceRecorder.finishLane('basic_survival', { status: 'ineligible', reasonCode: 'survival_not_selected' });

      const job = this.agent.job_director;
      this.traceRecorder.startLane('survival_job');
      if (job?.activeOrder?.source === 'survival') {
        try {
          job.update();
        } catch (error) {
          return this.select('basic_survival', 'survival_job_update_failed', `Survival recovery work failed safely: ${boundedText(error?.message || error)}`, true, perception);
        }
        return this.selectFrom('survival_job', 'basic_survival', job.status?.code || 'survival_job_selected', 'A survival recovery work order selected the tick.', true, perception);
      }
      this.traceRecorder.finishLane('survival_job', { status: 'ineligible', reasonCode: 'no_survival_job' });
      // The agenda decides what comes next and hands it to an executor; it
      // never acts itself. Running it before the goal and job lanes means a
      // step it dispatches is picked up by those lanes on this same tick.
      // Scheduled standing orders have no event to react to, so the tick drives
      // them. They only ever queue agenda steps, never act directly.
      const rules = this.agent.rule_engine;
      if (rules?.update) {
        this.traceRecorder.startStage('standing_orders');
        try {
          rules.update();
        } catch (error) {
          console.warn(`[behavior-arbiter] Standing orders failed safely: ${boundedText(error?.message || error)}`);
        } finally {
          this.traceRecorder.finishStage('standing_orders');
        }
      }

      const agenda = this.agent.agenda_director;
      if (agenda?.update) {
        this.traceRecorder.startStage('agenda_dispatch');
        try {
          agenda.update();
        } catch (error) {
          return this.select('player_goal', 'agenda_update_failed', `Agenda dispatch failed safely: ${boundedText(error?.message || error)}`, true, perception);
        } finally {
          this.traceRecorder.finishStage('agenda_dispatch');
        }
      }

      const goal = this.agent.goal_director;
      this.traceRecorder.startLane('player_goal');
      if (goal?.activeGoal) {
        try {
          goal.update();
        } catch (error) {
          return this.select('player_goal', 'player_goal_update_failed', `Typed player goal failed safely: ${boundedText(error?.message || error)}`, true, perception);
        }
        if (goal.inFlight || this.agent.actions?.executing || goal.activeGoal) {
          return this.select('player_goal', goal.status?.code || 'player_goal_selected', 'A typed player goal selected the tick.', true, perception);
        }
      }
      this.traceRecorder.finishLane('player_goal', { status: 'ineligible', reasonCode: 'no_player_goal' });
      this.traceRecorder.startLane('player_job');
      if (job?.activeOrder && PLAYER_JOB_SOURCES.has(job.activeOrder.source)) {
        try {
          job.update();
        } catch (error) {
          return this.select('player_job', 'player_job_update_failed', `Player job failed safely: ${boundedText(error?.message || error)}`, true, perception);
        }
        if (job.inFlight || this.agent.actions?.executing || job.activeOrder) {
          return this.select('player_job', job.status?.code || 'player_job_selected', 'Explicit resumable player work selected the tick.', true, perception);
        }
      }
      this.traceRecorder.finishLane('player_job', { status: 'ineligible', reasonCode: 'no_player_job' });
      this.traceRecorder.startLane('command_policy_guard');
      if (this.agent.runtime?.autonomy === 'command' && job?.update) {
        try {
          job.update();
        } catch (error) {
          return this.select('degraded', 'command_policy_update_failed', `Command-autonomy policy failed safely: ${boundedText(error?.message || error)}`, true, perception);
        }
        if (this.agent.actions?.executing) {
          return this.selectFrom('command_policy_guard', 'degraded', 'unauthorized_role_action', 'Command autonomy blocked lower lanes after unexpected role action ownership.', true, perception);
        }
      }
      this.traceRecorder.finishLane('command_policy_guard', { status: 'ineligible', reasonCode: 'command_policy_clear' });

      const reaction = this.agent.reaction_director;
      this.traceRecorder.startLane('factual_reaction');
      if (reaction?.update) {
        try {
          reaction.update();
        } catch (error) {
          return this.select('factual_reaction', 'reaction_update_failed', `Reaction policy failed safely: ${boundedText(error?.message || error)}`, true, perception);
        }
        // Reaction speech is advisory and may be delivered asynchronously. It
        // does not own movement or decision scheduling; only a gesture that
        // actually acquired ActionManager may retain this lane.
        if (this.agent.actions?.executing) {
          return this.select('factual_reaction', reaction.status?.code || 'reaction_selected', 'A bounded factual reaction selected the tick.', true, perception);
        }
      }
      this.traceRecorder.finishLane('factual_reaction', { status: 'ineligible', reasonCode: 'reaction_not_selected' });

      // Authorized work outranks cosmetic embodiment. Idle staring used to be
      // evaluated first and could consume the tick that role work needed.
      if (
        this.agent.runtime?.autonomy !== 'command'
        && job?.update
        && (!job.activeOrder || ROLE_JOB_SOURCES.has(job.activeOrder.source))
      ) {
        this.traceRecorder.startLane('role_work');
        try {
          job.update();
        } catch (error) {
          return this.select('role_work', 'role_update_failed', `Role policy failed safely: ${boundedText(error?.message || error)}`, true, perception);
        }
        if (job.inFlight || this.agent.actions?.executing || job.activeOrder) {
          return this.select('role_work', job.status?.code || 'role_work_selected', 'Existing role policy selected authorized work.', true, perception);
        }
      } else {
        this.traceRecorder.startLane('role_work');
      }
      this.traceRecorder.finishLane('role_work', { status: 'ineligible', reasonCode: 'role_work_not_selected' });

      // With no player work and no role order outstanding, an autonomous bot
      // pursues its own survival ladder instead of standing still.
      const progression = this.agent.progression_director;
      this.traceRecorder.startLane('self_progression');
      if (progression?.update && progression.permitted?.()) {
        try {
          progression.update();
        } catch (error) {
          return this.select('self_progression', 'progression_update_failed', `Self-directed progression failed safely: ${boundedText(error?.message || error)}`, true, perception);
        }
        if (progression.inFlight || this.agent.actions?.executing) {
          return this.select('self_progression', progression.status?.code || 'progression_selected', 'Self-directed survival progression selected the tick.', true, perception);
        }
      }
      this.traceRecorder.finishLane('self_progression', { status: 'ineligible', reasonCode: 'progression_not_selected' });

      // Noticing things outranks standing around, and sits below every form of
      // assigned work so it can never steal a job.
      selected = await this.evaluateModeBand('opportunity', OPPORTUNITY_MODES, perception);
      if (selected) return selected;

      if (this.comportment().idleEmbodiment) {
        selected = await this.evaluateModeBand('idle_embodiment', IDLE_EMBODIMENT_MODES, perception);
        if (selected) return selected;
      } else {
        this.traceRecorder.startLane('idle_embodiment');
        this.traceRecorder.finishLane('idle_embodiment', { status: 'ineligible', reasonCode: 'idle_embodiment_disabled' });
      }

      this.traceRecorder.startLane('self_prompt');
      if (this.selfPromptPermitted()) {
        try {
          this.agent.self_prompter?.update?.(delta);
        } catch (error) {
          return this.select('self_prompt', 'self_prompt_update_failed', `Self-prompt policy failed safely: ${boundedText(error?.message || error)}`, true, perception);
        }
        if (this.agent.self_prompter?.isActive?.()) {
          return this.select('self_prompt', 'self_prompt_active', 'No higher authorized lane owns work; self-prompt policy may proceed.', false, perception);
        }
      } else {
        this.traceRecorder.finishLane('self_prompt', { status: 'ineligible', reasonCode: 'self_prompt_not_permitted' });
      }
      this.traceRecorder.finishLane('self_prompt', { status: 'ineligible', reasonCode: 'self_prompt_inactive' });

      this.traceRecorder.startLane('idle');
      return this.select('idle', 'no_authorized_work', 'Fresh perception found no authorized behavior requiring ownership.', false, perception);
    } catch (error) {
      return this.select('degraded', 'arbiter_tick_failed', `Behavior tick degraded safely: ${boundedText(error?.message || error)}`, true, perception);
    } finally {
      const evaluationFinishedMs = this.traceRecorder.monotonicNow();
      if (modeCycleStarted) {
        try { modes?.endUpdateCycle?.(); } catch { /* cycle cleanup is best effort */ }
      }
      try {
        this.traceRecorder.startStage('task_completion_check');
        await this.agent.checkTaskDone?.();
      } catch (error) {
        console.error(`[behavior-arbiter] Task completion check failed: ${boundedText(error?.message || error)}`);
      } finally {
        this.traceRecorder.finishStage('task_completion_check');
      }
      this.updating = false;
      this.traceRecorder.finalize({ evaluationFinishedMs });
    }
  }

  snapshot() {
    return {
      ...this.status,
      urgency: this.urgency,
      nextTickDelayMs: this.nextTickDelayMs,
      comportment: this.comportment().preset,
      decisionTrace: this.traceRecorder.snapshot(16),
    };
  }
}
