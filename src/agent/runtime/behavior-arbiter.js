import { comportmentPauseMs, normalizeComportment } from './comportment.js';
import settings from '../settings.js';
import { DecisionTraceRecorder } from './decision-trace.js';
import { chooseCompanionAction } from './companion-action-policy.js';
import {
  createMaterialChangeBlocker,
  evaluateMaterialChange,
} from './obligation-settlement.js';

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
const AUTHORITATIVE_PLAYER_REFRESH_MS = 5_000;
const IDLE_AUTHORITATIVE_PLAYER_REFRESH_MS = 30_000;
const IDLE_EMBODIMENT_MODES = Object.freeze(['elbow_room', 'idle_staring']);
const PLAYER_JOB_SOURCES = new Set(['player', 'restart']);
// Automatic role work also owns a live order. Without this set the role lane
// only ran while `activeOrder` was null, so a dispatched role order advanced
// exactly once and then stalled with no lane willing to tick it again.
const ROLE_JOB_SOURCES = new Set(['role']);
const EXPLICIT_GOAL_SOURCES = new Set(['explicit', 'restored']);
const MAX_STATUS_TEXT = 240;
// Terminal narration normally settles inside one chat-throttle interval. Keep
// a short companion handoff after it settles, but fail the lease open after a
// bounded ceiling so a broken translation/output promise cannot become an
// idle lock.
const TERMINAL_HANDOFF_MIN_MS = 1_000;
const TERMINAL_HANDOFF_MAX_MS = 5_000;
// A held bot has no ordinary survival authority. Once every human has left,
// keeping that body loaded only preserves exposure, not companionship. Ten
// seconds absorbs tab-list/reconnect churn without leaving an unattended body
// in the world for a meaningful part of a hostile night.
export const HELD_NO_HUMAN_UNLOAD_GRACE_MS = 10_000;
const SAFE_UNLOAD_HOLD_REASON = /^(?:operator stop(?: command| restored after restart)?|companion wait requested by\s)/i;
const STANDING_DIRECTIVE_ACTIONS = new Set([
  'action:follow',
  'action:followPlayer',
  'action:guardPlayer',
]);
const DIRECTIVE_NO_PROGRESS_OUTCOMES = new Set([
  'waiting_for_material_change',
]);
// How long an explicit follow/guard may sit parked after a no-progress result
// before it is retried regardless of the world. Without this the companion
// waited for the player to move eight blocks, change dimension, or change the
// world signature -- so a failed route left it standing still indefinitely
// while it had already announced it was following. A player directive is a
// promise to keep trying; see ARCHITECTURE.md.
export const DIRECTIVE_RETRY_HOLD_MS = 6_000;

// Per-lane base tick period. Reflex lanes re-evaluate quickly so a threat is
// answered in one frame rather than one third of a second; cosmetic and idle
// lanes back off so a full squad does not burn CPU doing nothing.
const LANE_TICK_MS = Object.freeze({
  emergency_self_preservation: 80,
  attributed_protection: 100,
  bounded_recovery: 150,
  basic_survival: 180,
  player_directive: 220,
  player_mission: 225,
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
  internal_control: 300,
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

export function authoritativePlayerRefreshMs(agent, companion) {
  if (agent?.isOperatorHeld?.()) return null;
  const activeGoal = agent?.goal_director?.activeGoal;
  const ownsDelivery = activeGoal?.phase === 'deliver'
    && activeGoal?.destination?.kind === 'player';
  const directive = String(companion?.directive || '').toLowerCase();
  const ownsCompanionMovement = directive === 'follow' || directive === 'guard';
  return ownsDelivery || ownsCompanionMovement
    ? AUTHORITATIVE_PLAYER_REFRESH_MS
    : IDLE_AUTHORITATIVE_PLAYER_REFRESH_MS;
}

function boundedText(value, fallback = '') {
  return String(value || fallback)
    .replace(/[\u0000-\u001f\u007f]/g, ' ') // eslint-disable-line no-control-regex
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_STATUS_TEXT);
}

function identityKey(value) {
  return String(value || '').trim().toLowerCase();
}

function directiveIdentity(value) {
  const directive = String(value?.directive || '').trim().toLowerCase();
  const username = identityKey(value?.canonicalUsername);
  const authorizedAt = value?.authorizedAt ?? value?.directiveAuthorizedAt;
  if (!['follow', 'guard'].includes(directive) || !username || !Number.isFinite(authorizedAt)) return null;
  return `${directive}:${username}:${authorizedAt}`;
}

function directiveTargetSignature(companion) {
  const username = identityKey(companion?.canonicalUsername);
  if (!username || !Number.isFinite(companion?.entityEpoch)) return null;
  return `${username}:${companion.entityEpoch}`;
}

function directiveTargetWorldSignature(agent, companion) {
  if (companion?.presence !== 'present') return null;
  const bot = agent?.bot;
  const player = bot?.entities?.[companion.entityId]
    || bot?.players?.[companion.canonicalUsername]?.entity;
  const origin = player?.position?.floored?.();
  const bodyOrigin = bot?.entity?.position?.floored?.();
  if (!origin?.offset || !bodyOrigin?.offset || typeof bot?.blockAt !== 'function') return null;
  const offsets = [
    [0, -1, 0], [0, 0, 0], [0, 1, 0],
    [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
    [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1],
  ];
  try {
    const blocks = offsets.map(([x, y, z]) => (
      String(bot.blockAt(origin.offset(x, y, z))?.name || 'unloaded').slice(0, 48)
    ));
    const bodyBlocks = offsets.map(([x, y, z]) => (
      String(bot.blockAt(bodyOrigin.offset(x, y, z))?.name || 'unloaded').slice(0, 48)
    ));
    const liquid = player?.isInWater === true
      || player?.isInLava === true
      || blocks.slice(1, 3).some(name => name === 'water' || name === 'lava');
    return `${liquid ? 'liquid' : 'non_liquid'}:${blocks.join(',')}|body:${bodyBlocks.join(',')}`;
  } catch {
    return null;
  }
}

function resultSkillOutcome(result) {
  return String(result?.evidence?.skill?.outcome || '').trim().toLowerCase();
}

/**
 * A completed drowning reflex is a settlement boundary, not authority for the
 * interrupted standing directive to retake the body. This semantic family
 * deliberately includes stable, open-water, and unconfirmed receipts so a
 * failed or partial escape cannot become an unchanged immediate retry. An
 * interrupted action is censored before this predicate is consulted.
 */
/**
 * True when the player is waiting on the companion: a standing directive, a
 * deferred player action, or an explicit resume request.
 *
 * Exported and pure so the ordering rule it guards can be tested without
 * mocking perception, modes and seven directors. A persona hesitation must
 * never delay someone who just gave an order.
 */
export function playerAwaitsResponse(agent, { directiveResumeRequested = false } = {}) {
  return Boolean(
    agent?.companion_context?.snapshot?.()?.directive
    || agent?.actions?.hasDeferredPlayerAction?.() === true
    || directiveResumeRequested,
  );
}

export function isDirectiveHazardSettlementEvidence(result) {
  return result?.phase !== 'interrupted'
    && result?.code !== 'interrupted'
    && result?.label === 'mode:self_preservation'
    && resultSkillOutcome(result).startsWith('drowning_escape_');
}

/**
 * Full tab-roster human presence. An entity-only scan would miss a distant
 * player and could unload a companion that is still sharing their world.
 * Missing roster evidence stays unknown instead of becoming zero humans.
 */
export function onlineHumanPlayerNames(agent) {
  const players = agent?.bot?.players;
  if (!players || typeof players !== 'object' || Array.isArray(players)) return null;
  const knownAgentNames = agent?.getKnownAgentNames?.();
  const botNames = new Set([
    agent?.name,
    ...(Array.isArray(knownAgentNames) ? knownAgentNames : []),
  ].map(identityKey).filter(Boolean));
  const humans = new Set();
  for (const [key, player] of Object.entries(players)) {
    const aliases = [key, player?.username, player?.entity?.username]
      .map(value => String(value || '').trim())
      .filter(Boolean);
    if (!aliases.length || aliases.some(alias => botNames.has(identityKey(alias)))) continue;
    humans.add(aliases[0]);
  }
  return [...humans].sort((left, right) => left.localeCompare(right));
}

export class BehaviorArbiter {
  constructor(agent, {
    now = Date.now,
    random = Math.random,
    monotonicNow = () => performance.now(),
    trace = null,
    heldNoHumanUnloadGraceMs = HELD_NO_HUMAN_UNLOAD_GRACE_MS,
    commitmentProviders = [],
  } = {}) {
    this.agent = agent;
    this.now = now;
    this.random = typeof random === 'function' ? random : Math.random;
    this.stopped = false;
    this.updating = false;
    this.directiveResumeRequested = false;
    this.directiveResumeRequest = null;
    this.directiveMaterialChangeBlocker = null;
    // Survival incidents transfer control of the body; they do not replace the
    // player's durable obligation. The arbiter owns that transfer so Goal,
    // Job, Mission, and standing-directive loops do not each invent their own
    // attack/recovery protocol.
    this.controlSuspension = null;
    this.lastControlSuspension = null;
    this.controlCommitmentProviders = [];
    for (const provider of commitmentProviders) this.registerControlCommitmentProvider(provider);
    this.terminalHandoff = null;
    this.terminalHandoffGeneration = 0;
    this.tick = 0;
    this.lastObservedAt = null;
    this.nextTickDelayMs = DEFAULT_TICK_MS;
    this.urgency = 'calm';
    this.traceEvaluationLane = null;
    this.heldNoHumanSince = null;
    this.heldUnloadRequested = false;
    this.heldSurfaceStance = {
      active: false,
      code: 'inactive',
      updatedAt: null,
    };
    // A negative grace disables the safe unload entirely and keeps a held bot
    // loaded. Used by unattended measurement, where the Hold is a required
    // precondition rather than an idle state. The Operator Hold is untouched.
    const configuredGraceMs = Number(heldNoHumanUnloadGraceMs);
    this.heldNoHumanUnloadGraceMs = Number.isFinite(configuredGraceMs) && configuredGraceMs < 0
      ? -1
      : Math.max(0, configuredGraceMs || 0);
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
    this.directiveResumeRequest = null;
    this.directiveMaterialChangeBlocker = null;
    this.controlSuspension = null;
    this.terminalHandoff = null;
    this.comportmentPauseUntil = 0;
    this.wasActing = false;
    this.pendingWake = null;
    this.heldNoHumanSince = null;
    this.releaseHeldSurfaceStance('arbiter_stopped', { force: true });
    // Release a parked loop immediately so teardown never waits out a sleep.
    if (this.wakeResolve) this.wakeResolve('stopped');
    this.select('stopped', 'arbiter_stopped', 'Behavior arbitration stopped during teardown.', true);
    return true;
  }

  requestDirectiveResume(interruptedDirective = null) {
    if (this.stopped) return false;
    this.releaseTerminalHandoff('An explicit companion directive resumed.', false);
    const current = interruptedDirective || this.agent.companion_context?.snapshot?.() || null;
    const directive = String(current?.directive || '').toLowerCase();
    this.directiveResumeRequest = directive === 'follow' || directive === 'guard'
      ? Object.freeze({
          directive,
          canonicalUsername: boundedText(current?.canonicalUsername, ''),
          authorizedAt: current?.authorizedAt ?? current?.directiveAuthorizedAt ?? null,
        })
      : null;
    this.directiveResumeRequested = true;
    this.wake('directive_resume');
    return true;
  }

  directiveObservation(companion = this.agent.companion_context?.snapshot?.()) {
    return {
      position: companion?.position || null,
      dimension: companion?.dimension || null,
      targetSignature: directiveTargetSignature(companion),
      worldSignature: directiveTargetWorldSignature(this.agent, companion),
    };
  }

  directiveSettlement(companion = this.agent.companion_context?.snapshot?.()) {
    const blocker = this.directiveMaterialChangeBlocker;
    if (!blocker) return Object.freeze({ active: false, state: 'changed', code: null });
    const obligationId = directiveIdentity(companion);
    if (!obligationId || blocker.obligationId !== obligationId) {
      this.directiveMaterialChangeBlocker = null;
      return Object.freeze({ active: false, state: 'changed', code: 'directive_authority_changed' });
    }
    const materialChange = evaluateMaterialChange(
      blocker,
      this.directiveObservation(companion),
      { now: this.now() },
    );
    if (materialChange.state === 'changed') {
      this.directiveMaterialChangeBlocker = null;
      return Object.freeze({
        active: false,
        state: 'changed',
        code: blocker.code,
        changedBy: materialChange.changedBy,
      });
    }
    return Object.freeze({
      active: true,
      state: materialChange.state,
      code: blocker.code,
      changedBy: materialChange.changedBy,
      unknownPredicates: materialChange.unknownPredicates,
    });
  }

  observeDirectiveOutcome(result) {
    if (!result || result.phase === 'interrupted' || result.code === 'interrupted') return false;
    const companion = this.agent.companion_context?.snapshot?.();
    const obligationId = directiveIdentity(companion);
    if (!obligationId) return false;
    const outcome = resultSkillOutcome(result);
    const observation = this.directiveObservation(companion);
    let code = null;
    let releasePredicates = null;
    if (
      isDirectiveHazardSettlementEvidence(result)
      && String(observation.worldSignature || '').startsWith('liquid:')
    ) {
      code = 'directive_hazard_unchanged';
      releasePredicates = ['dimension', 'target_signature', 'world_signature'];
    } else if (
      STANDING_DIRECTIVE_ACTIONS.has(result.label)
      && DIRECTIVE_NO_PROGRESS_OUTCOMES.has(outcome)
    ) {
      code = 'directive_route_unchanged';
      releasePredicates = ['dimension', 'position_region', 'target_signature', 'world_signature'];
    }
    if (!releasePredicates) return false;
    const blocker = createMaterialChangeBlocker({
      owner: 'player_directive',
      obligationId,
      code,
      checkpoint: observation,
      releasePredicates,
      positionRegionDistance: 8,
      holdMs: DIRECTIVE_RETRY_HOLD_MS,
      createdAt: this.now(),
    });
    if (!blocker) return false;
    this.directiveMaterialChangeBlocker = blocker;
    this.wake('directive_material_change_blocked');
    return true;
  }

  beginTerminalHandoff({
    outcomeId = '',
    owner = 'player_goal',
    // Backward-compatible input for persisted dashboard clients and any
    // extension that still identifies a typed goal by the old field name.
    goalId = '',
    phase = 'terminal',
    code = '',
    reportPromise = null,
  } = {}) {
    if (this.stopped) return null;
    const now = this.now();
    const normalizedOutcomeId = boundedText(outcomeId || goalId, 'unknown-outcome');
    const normalizedOwner = owner === 'player_job' ? 'player_job' : 'player_goal';
    const normalizedPhase = boundedText(phase, 'terminal');
    const current = this.currentTerminalHandoff();
    if (
      current
      && current.outcomeId === normalizedOutcomeId
      && current.owner === normalizedOwner
      && current.phase === normalizedPhase
    ) return current;

    const generation = ++this.terminalHandoffGeneration;
    const tracksReport = Boolean(reportPromise && typeof reportPromise.then === 'function');
    this.terminalHandoff = {
      generation,
      owner: normalizedOwner,
      outcomeId: normalizedOutcomeId,
      // Retain the additive compatibility field for existing typed-goal state
      // consumers while making the shared ownership primitive explicit.
      ...(normalizedOwner === 'player_goal' ? { goalId: normalizedOutcomeId } : {}),
      phase: normalizedPhase,
      code: boundedText(code, 'goal_terminal'),
      startedAt: now,
      minimumUntil: now + TERMINAL_HANDOFF_MIN_MS,
      expiresAt: now + TERMINAL_HANDOFF_MAX_MS,
      reportPending: tracksReport,
      reportSettledAt: tracksReport ? null : now,
    };

    if (tracksReport) {
      void Promise.resolve(reportPromise).then(
        () => this.settleTerminalReport(generation),
        () => this.settleTerminalReport(generation),
      );
    }
    return this.currentTerminalHandoff();
  }

  settleTerminalReport(generation) {
    if (!this.terminalHandoff || this.terminalHandoff.generation !== generation) return false;
    this.terminalHandoff.reportPending = false;
    this.terminalHandoff.reportSettledAt = this.now();
    this.wake('terminal_report_settled');
    return true;
  }

  releaseTerminalHandoff(_reason = 'Terminal companion handoff released.', wake = true) {
    if (!this.terminalHandoff) return false;
    this.terminalHandoff = null;
    if (wake) this.wake('terminal_handoff_released');
    return true;
  }

  currentTerminalHandoff() {
    const handoff = this.terminalHandoff;
    if (!handoff) return null;
    const now = this.now();
    if (
      now >= handoff.expiresAt
      || (!handoff.reportPending && now >= handoff.minimumUntil)
    ) {
      this.terminalHandoff = null;
      return null;
    }
    return {
      ...handoff,
      remainingMs: Math.max(0, handoff.expiresAt - now),
    };
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

  playerCommitment(action = this.actionState()) {
    let fallback = null;
    for (const provider of this.controlCommitmentProviders) {
      let candidate;
      try {
        candidate = typeof provider === 'function'
          ? provider(action)
          : provider?.currentControlCommitment?.(action);
      } catch (error) {
        console.warn(`[arbiter] Control commitment provider failed safely: ${boundedText(error?.message || error)}`);
        continue;
      }
      const obligationId = boundedText(candidate?.obligationId);
      const owner = boundedText(candidate?.owner);
      if (!obligationId || !owner) continue;
      const commitment = {
        owner,
        obligationId,
        phase: boundedText(candidate.phase) || null,
        ownsCurrentAction: candidate.ownsCurrentAction === true,
      };
      if (commitment.ownsCurrentAction) return commitment;
      if (!fallback) fallback = commitment;
    }
    return fallback;
  }

  registerControlCommitmentProvider(provider) {
    if (
      !provider
      || (
        typeof provider !== 'function'
        && typeof provider.currentControlCommitment !== 'function'
      )
      || this.controlCommitmentProviders.includes(provider)
    ) return false;
    this.controlCommitmentProviders.push(provider);
    return true;
  }

  beginSafetySuspension(incident = this.agent?.survival_director?.safetyIncident) {
    const incidentId = boundedText(incident?.id);
    if (this.stopped || incident?.active !== true || !incidentId) return null;
    if (this.controlSuspension?.incidentId === incidentId) {
      return { ...this.controlSuspension };
    }

    const action = this.actionState();
    const commitment = this.playerCommitment(action);
    if (!commitment?.obligationId) return null;
    const now = this.now();
    if (this.controlSuspension) {
      this.lastControlSuspension = Object.freeze({
        ...this.controlSuspension,
        state: 'superseded',
        releaseCode: 'new_safety_incident',
        releasedAt: now,
      });
    }
    this.controlSuspension = Object.freeze({
      id: `suspension:${incidentId}`.slice(0, 128),
      incidentId,
      owner: commitment.owner,
      obligationId: commitment.obligationId,
      phase: commitment.phase,
      actionId: commitment.ownsCurrentAction ? action.actionId : null,
      actionLabel: commitment.ownsCurrentAction ? action.label : null,
      state: 'suspended',
      startedAt: now,
    });
    return { ...this.controlSuspension };
  }

  matchesControlSuspension({ owner, obligationId, actionId = null } = {}) {
    const normalizedObligationId = boundedText(obligationId);
    const settledActionId = boundedText(actionId);
    const active = this.controlSuspension;
    if (
      active?.state === 'suspended'
      && active.owner === owner
      && active.obligationId === normalizedObligationId
    ) {
      const expectedActionId = boundedText(active.actionId);
      return !expectedActionId || !settledActionId || expectedActionId === settledActionId;
    }
    // The survival remedy can settle and release in the same event turn as
    // the interrupted player's Promise. Preserve correlation to that exact
    // old action across the release edge, but never let a later action from the
    // same obligation inherit the old suspension.
    const released = this.lastControlSuspension;
    const releasedActionId = boundedText(released?.actionId);
    return Boolean(
      released?.state === 'released'
      && released.owner === owner
      && released.obligationId === normalizedObligationId
      && releasedActionId
      && settledActionId
      && releasedActionId === settledActionId
    );
  }

  releaseSafetySuspension(incident, code = null) {
    const suspension = this.controlSuspension;
    if (!suspension) return false;
    const incidentId = boundedText(incident?.id || incident);
    if (incidentId && suspension.incidentId !== incidentId) return false;
    const now = this.now();
    this.lastControlSuspension = Object.freeze({
      ...suspension,
      state: 'released',
      releaseCode: boundedText(code || incident?.resolutionCode, 'survival_incident_resolved'),
      releasedAt: now,
    });
    this.controlSuspension = null;
    this.wake('safety_suspension_released');
    return true;
  }

  currentControlSuspension() {
    return this.controlSuspension ? { ...this.controlSuspension } : null;
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
    // Usually SurvivalDirector captures the transfer synchronously when it
    // creates the incident. This closes the event-ordering seam for adapters
    // that register an incident immediately before starting the reflex.
    this.beginSafetySuspension();
    return this.traceRecorder.linkAction(action);
  }

  recordActionRelease(action) {
    return this.traceRecorder.linkRelease(action);
  }

  recordOutcome(result) {
    this.observeDirectiveOutcome(result);
    return this.traceRecorder.linkOutcome(result);
  }

  observeHeldPresence() {
    if (this.agent?.isOperatorHeld?.() !== true) {
      this.heldNoHumanSince = null;
      this.heldUnloadRequested = false;
      return Object.freeze({ code: 'operator_not_held', humans: null, elapsedMs: 0, due: false });
    }
    if (!SAFE_UNLOAD_HOLD_REASON.test(String(this.agent?.operator_hold_reason || ''))) {
      // Assignment-compilation and handoff-failure Holds can protect already
      // authorized durable work. Human absence must not convert that temporary
      // physical gate into an implicit cancellation of the player's request.
      this.heldNoHumanSince = null;
      this.heldUnloadRequested = false;
      return Object.freeze({ code: 'hold_disposition_not_terminal', humans: null, elapsedMs: 0, due: false });
    }
    const humans = onlineHumanPlayerNames(this.agent);
    if (humans === null) {
      this.heldNoHumanSince = null;
      this.heldUnloadRequested = false;
      return Object.freeze({ code: 'player_roster_unknown', humans: null, elapsedMs: 0, due: false });
    }
    if (humans.length) {
      this.heldNoHumanSince = null;
      this.heldUnloadRequested = false;
      return Object.freeze({ code: 'human_player_online', humans, elapsedMs: 0, due: false });
    }
    if (this.heldNoHumanUnloadGraceMs < 0) {
      this.heldNoHumanSince = null;
      this.heldUnloadRequested = false;
      return Object.freeze({ code: 'held_unload_disabled', humans, elapsedMs: 0, due: false });
    }
    const now = this.now();
    if (!Number.isFinite(this.heldNoHumanSince)) this.heldNoHumanSince = now;
    const elapsedMs = Math.max(0, now - this.heldNoHumanSince);
    return Object.freeze({
      code: elapsedMs >= this.heldNoHumanUnloadGraceMs
        ? 'held_unload_due'
        : 'held_unload_grace',
      humans,
      elapsedMs,
      due: elapsedMs >= this.heldNoHumanUnloadGraceMs,
    });
  }

  releaseHeldSurfaceStance(reason = 'surface_stance_released', { force = false } = {}) {
    const wasActive = this.heldSurfaceStance.active === true;
    this.heldSurfaceStance = {
      active: false,
      code: boundedText(reason, 'surface_stance_released'),
      updatedAt: this.now(),
    };
    if (!wasActive) return false;

    // A drowning reflex may inherit the same native ascent control. Releasing
    // Hold must not pull jump away from that higher-priority action; the skill
    // owns its own bounded cleanup. Teardown is the exception and clears every
    // control regardless of the active label.
    const activeAction = this.actionState();
    if (!force && activeAction.label === 'mode:self_preservation') return true;
    try { this.agent?.bot?.setControlState?.('jump', false); } catch { /* disconnected body */ }
    return true;
  }

  updateHeldSurfaceStance(heldPresence) {
    const bot = this.agent?.bot;
    const entity = bot?.entity;
    let feet = null;
    try {
      const feetPosition = entity?.position?.floored?.();
      if (feetPosition) feet = bot?.blockAt?.(feetPosition) || null;
    } catch { /* unloaded body stays in ordinary Hold */ }
    const openWater = entity?.onGround !== true
      && (entity?.isInWater === true || feet?.name === 'water');
    const shouldMaintain = heldPresence?.code === 'human_player_online'
      && openWater
      && this.agent?.isOperatorHeld?.() === true;

    if (!shouldMaintain) {
      this.releaseHeldSurfaceStance(
        heldPresence?.code === 'human_player_online'
          ? 'surface_stance_not_required'
          : boundedText(heldPresence?.code, 'surface_stance_ineligible'),
      );
      return { ...this.heldSurfaceStance };
    }

    try {
      bot.setControlState('jump', true);
      this.heldSurfaceStance = {
        active: true,
        code: 'maintaining_breathable_surface',
        updatedAt: this.now(),
      };
    } catch {
      this.heldSurfaceStance = {
        active: false,
        code: 'surface_control_unavailable',
        updatedAt: this.now(),
      };
    }
    return { ...this.heldSurfaceStance };
  }

  requestHeldSafeUnload() {
    if (this.heldUnloadRequested) return false;
    this.heldUnloadRequested = true;
    Promise.resolve().then(async () => {
      // Reconcile the authority and roster at the actual lifecycle edge. A
      // player joining in the scheduling microtask must keep the companion in
      // game, and missing roster evidence never authorizes departure.
      const humans = onlineHumanPlayerNames(this.agent);
      if (this.agent?.isOperatorHeld?.() !== true || humans === null || humans.length) {
        this.heldUnloadRequested = false;
        this.heldNoHumanSince = null;
        return;
      }
      if (typeof this.agent?.teardownAndExit !== 'function') {
        this.heldUnloadRequested = false;
        console.warn('[behavior-arbiter] Held safe-unload is unavailable; retaining Operator Hold.');
        return;
      }
      await this.agent.teardownAndExit(
        `Operator Hold safely unloaded after ${Math.ceil(this.heldNoHumanUnloadGraceMs / 1_000)} seconds with no human players online.`,
        0,
      );
    }).catch(error => {
      this.heldUnloadRequested = false;
      console.warn(`[behavior-arbiter] Held safe-unload failed: ${boundedText(error?.message || error)}`);
    });
    return true;
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
    const criticalFood = Number(this.agent?.runtime?.survival?.criticalFood ?? 6);
    const lastDamageTime = Number(bot.lastDamageTime);
    const sinceDamage = Number.isFinite(lastDamageTime) && lastDamageTime > 0
      ? this.now() - lastDamageTime
      : Infinity;
    if (
      (Number.isFinite(health) && health <= 10)
      || (Number.isFinite(food) && food <= criticalFood)
      || (Number.isFinite(oxygen) && oxygen <= 12)
      || sinceDamage <= 2_000
    ) return 'critical';
    if (
      (Number.isFinite(health) && health <= 16)
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
        const companion = context.snapshot?.();
        const authoritativeRefreshMs = authoritativePlayerRefreshMs(this.agent, companion);
        if (
          !resolution.entity
          && typeof this.agent.locatePlayerPosition === 'function'
          && authoritativeRefreshMs !== null
          && (
            companion?.authoritativeCheckAge === null
            || companion?.authoritativeCheckAge >= authoritativeRefreshMs
          )
        ) {
          void this.agent.locatePlayerPosition(requested)
            .then(() => this.wake('authoritative_player_position'))
            .catch(() => {});
        }
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

  async evaluateModeBand(lane, names, perception, options = {}) {
    this.traceRecorder.startLane(lane);
    try {
      const result = await this.agent.bot?.modes?.updateBand?.(names, options);
      if (result?.active || result?.scheduled || result?.blocking) {
        this.traceRecorder.finishLane(lane, {
          status: 'eligible',
          reasonCode: result.code || 'mode_scheduled',
          targetRef: result.mode ? `mode:${result.mode}` : null,
          evidenceRefs: [`perception-${this.tick}`],
        });
        return this.select(
          lane,
          result.code || 'mode_scheduled',
          result.blocking
            ? `${result.mode || lane} is waiting for material safety evidence before lower physical work may run.`
            : `${result.mode || lane} owns the selected mode band.`,
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
    if (action.owner === 'player' && this.agent.charcoal_mission?.hasActiveMission?.()) {
      return this.select('player_mission', 'player_mission_action_active', 'A charcoal Mission Activity owns ActionManager.', true, perception);
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
    // Everything below runs inside the try so the finally's `this.updating =
    // false` covers the whole body. A throw in this preamble used to leave the
    // flag set for the lifetime of the agent, and because a wedged arbiter then
    // returns a snapshot instead of throwing, the agent update loop's
    // consecutive-failure watchdog reset to zero every tick and never restarted
    // it. `modes` and `modeCycleStarted` stay outside because the finally reads
    // them; both are non-throwing declarations.
    const modes = this.agent.bot?.modes;
    let modeCycleStarted = false;
    // `perception` is read by the outer catch, which is a sibling scope to the
    // try, so it must be declared out here rather than inside it.
    let perception = null;
    try {
      this.lastTickStartedAt = this.now();
      this.tick += 1;
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
      perception = await this.refreshPerception();
      this.traceRecorder.finishStage('perception_refresh');
      this.traceRecorder.addEvidence({
        id: `perception-${this.tick}`,
        source: 'environment_observer',
        observedAt: perception.observedAt,
        summary: perception.error || perception.freshness,
      });
      try {
        modes?.beginUpdateCycle?.();
        modeCycleStarted = true;
      } catch (error) {
        return this.select('degraded', 'mode_cycle_failed', `Mode cycle failed safely: ${boundedText(error?.message || error)}`, true, perception);
      }
      // Operator Stop is authoritative over every ordinary lane, but it is not
      // a suicide switch. modes.js admits only self-preservation plus
      // recent-damage self-defense while held, and ActionManager admits those
      // same exact reflex labels. Evaluate both bands before the hold gate so
      // mortal danger can settle without releasing Hold or authorizing ambient
      // combat.
      let accompanimentProposal = null;
      try {
        accompanimentProposal = modes?.proposeAttributedAccompaniment?.() || null;
      } catch (error) {
        return this.select(
          'degraded',
          'accompaniment_proposal_failed',
          `Companion decision facts failed safely: ${boundedText(error?.message || error)}`,
          true,
          perception,
        );
      }
      const sharedAccompanimentOwnsThreat = accompanimentProposal?.applicable === true;
      const migratedModeOptions = { skipAttributedAccompaniment: sharedAccompanimentOwnsThreat };
      let selected = await this.evaluateModeBand(
        'emergency_self_preservation',
        EMERGENCY_MODES,
        perception,
        migratedModeOptions,
      );
      if (selected) return selected;

      if (sharedAccompanimentOwnsThreat) {
        this.traceRecorder.startLane('attributed_protection');
        const companionDecision = chooseCompanionAction({
          ...accompanimentProposal,
          operatorHeld: this.agent.isOperatorHeld?.() === true,
          runtimeStopped: this.stopped,
        });
        if (companionDecision.intent === 'retreat' || companionDecision.intent === 'protect') {
          const dispatch = modes?.dispatchAttributedAccompaniment?.(
            companionDecision.intent,
            accompanimentProposal,
          );
          if (dispatch?.active || dispatch?.scheduled) {
            return this.select(
              'attributed_protection',
              companionDecision.code,
              companionDecision.reason,
              true,
              perception,
            );
          }
          this.traceRecorder.finishLane('attributed_protection', {
            status: 'ineligible',
            reasonCode: dispatch?.code || 'selected_capability_unavailable',
          });
        } else if (companionDecision.intent === 'wait_material_change') {
          return this.select(
            'attributed_protection',
            companionDecision.code,
            companionDecision.reason,
            true,
            perception,
          );
        } else {
          this.traceRecorder.finishLane('attributed_protection', {
            status: 'ineligible',
            reasonCode: companionDecision.code,
          });
        }
      } else {
        selected = await this.evaluateModeBand('attributed_protection', PROTECTION_MODES, perception);
        if (selected) return selected;
      }

      const survival = this.agent.survival_director;
      let survivalEvaluated = false;

      // Safety suspension is a control-plane gate, not a hint from one leaf.
      // Once an attributed incident has suspended durable player work, only
      // reflexes above this boundary and Survival itself may move the body.
      // The gate disappears only when Survival closes the same incident.
      if (this.currentControlSuspension()) {
        survivalEvaluated = true;
        this.traceRecorder.startLane('basic_survival');
        try {
          survival?.update?.();
        } catch (error) {
          return this.select('basic_survival', 'safety_suspension_update_failed', `Safety recovery failed safely: ${boundedText(error?.message || error)}`, true, perception);
        }
        if (this.currentControlSuspension()) {
          return this.select(
            'basic_survival',
            survival?.status?.code || 'safety_suspension_active',
            'An unresolved Safety incident exclusively owns the body until safe settlement.',
            true,
            perception,
          );
        }
        this.traceRecorder.finishLane('basic_survival', {
          status: 'observed',
          reasonCode: 'safety_suspension_released',
        });
      }

      const heldPresence = this.observeHeldPresence();
      const heldSurfaceStance = this.updateHeldSurfaceStance(heldPresence);
      this.traceRecorder.startLane('operator_hold');
      if (this.agent.isOperatorHeld?.()) {
        this.directiveResumeRequested = false;
        this.directiveResumeRequest = null;
        if (heldPresence.due) {
          this.requestHeldSafeUnload();
          return this.select(
            'operator_hold',
            'operator_hold_unloading',
            'Operator Hold remains persisted; no human players are online, so the unattended body is unloading safely.',
            true,
            perception,
          );
        }
        if (heldPresence.code === 'held_unload_grace') {
          const remainingSeconds = Math.max(
            1,
            Math.ceil((this.heldNoHumanUnloadGraceMs - heldPresence.elapsedMs) / 1_000),
          );
          return this.select(
            'operator_hold',
            'operator_hold_unload_grace',
            `Operator Hold remains active; no human players are online. Safe unload is due in ${remainingSeconds} second(s) if absence continues.`,
            true,
            perception,
          );
        }
        if (heldPresence.code === 'player_roster_unknown') {
          return this.select(
            'operator_hold',
            'operator_hold_roster_unknown',
            'Operator Hold remains active; player-presence evidence is unavailable, so safe unload is not authorized.',
            true,
            perception,
          );
        }
        if (heldSurfaceStance.code === 'surface_control_unavailable') {
          return this.select(
            'operator_hold',
            'operator_hold_surface_control_unavailable',
            'Operator Hold remains active, but Mineflayer could not maintain the open-water surface stance.',
            true,
            perception,
          );
        }
        if (heldSurfaceStance.active) {
          return this.select(
            'operator_hold',
            'operator_hold_surface_stance',
            'Operator Hold remains active while Mineflayer maintains a breathable open-water surface stance beside the family.',
            true,
            perception,
          );
        }
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

      this.traceRecorder.startLane('internal_control');
      const internalControl = this.agent.currentInternalControlBlock?.() || null;
      if (internalControl?.blocksBody) {
        this.directiveResumeRequested = false;
        this.directiveResumeRequest = null;
        return this.select(
          'internal_control',
          internalControl.kind === 'quarantine'
            ? 'internal_body_quarantined'
            : 'internal_assignment_wait',
          internalControl.reason || 'An internal control boundary is waiting to settle.',
          true,
          perception,
        );
      }
      this.traceRecorder.finishLane('internal_control', { status: 'ineligible', reasonCode: 'internal_control_clear' });

      // Player and job actions already own a serialized ActionManager turn.
      // Release any stale terminal handoff as soon as fresh player-authorized
      // work owns the body. Critical bodily survival is the one ordinary lane
      // allowed to challenge that ownership before it is retained: its
      // deterministic skill is dispatched as the higher-priority `survival`
      // ActionManager owner, which performs the actual bounded interruption.
      const activeBeforeSelection = this.actionState();
      const activeJobSource = this.agent.job_director?.activeOrder?.source;
      if (
        activeBeforeSelection.owner === 'player'
        || (activeBeforeSelection.owner === 'job' && PLAYER_JOB_SOURCES.has(activeJobSource))
      ) {
        this.releaseTerminalHandoff('Fresh player-authorized action owns the body.', false);
      }

      if (this.urgency === 'critical' && !survivalEvaluated) {
        survivalEvaluated = true;
        this.traceRecorder.startLane('basic_survival');
        if (survival?.update) {
          try {
            survival.update();
          } catch (error) {
            return this.select('basic_survival', 'survival_update_failed', `Survival policy failed safely: ${boundedText(error?.message || error)}`, true, perception);
          }
          if (
            survival.inFlight
            || survival.blocksLowerPriority?.()
            || this.actionState().owner === 'survival'
          ) {
            if (
              survival.permitsIdleEmbodiment?.()
              && this.agent.isIdle?.()
              && this.comportment().idleEmbodiment
            ) {
              selected = await this.evaluateModeBand('idle_embodiment', ['idle_staring'], perception);
              if (selected) return selected;
            }
            return this.select('basic_survival', survival.status?.code || 'survival_selected', 'Critical bodily survival preempted lower-priority serialized work.', true, perception);
          }
        }
        this.traceRecorder.finishLane('basic_survival', { status: 'ineligible', reasonCode: 'critical_survival_not_selected' });
      }

      // Classify live player/job ownership before asking recovery modes to
      // inspect the world; otherwise unstuck can see the first motionless
      // frames of a new command and preempt it before Pathfinder can move.
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

      // A model-interpreted Mission is durable in memory across conversation
      // turns, but it never owns a second executor. It proposes at most one
      // causal Activity here and that Activity acquires the existing
      // ActionManager lease. Critical survival and bounded recovery have
      // already had first refusal; ordinary survival and optional work remain
      // below the accepted player promise.
      const mission = this.agent.charcoal_mission;
      if (mission?.hasActiveMission?.()) {
        this.traceRecorder.startLane('player_mission');
        try {
          mission.update();
        } catch (error) {
          return this.select('player_mission', 'player_mission_update_failed', `Charcoal Mission failed safely: ${boundedText(error?.message || error)}`, true, perception);
        }
        if (mission.ownsBodyLane?.()) {
          return this.select(
            'player_mission',
            mission.status?.code || 'player_mission_selected',
            mission.status?.detail || 'The current charcoal Mission retained the tick.',
            true,
            perception,
          );
        }
        this.traceRecorder.finishLane('player_mission', {
          status: 'observed',
          reasonCode: mission.status?.code || 'player_mission_shadow_observed',
        });
      } else {
        this.traceRecorder.startLane('player_mission');
        this.traceRecorder.finishLane('player_mission', { status: 'ineligible', reasonCode: 'no_player_mission' });
      }

      // A persona hesitation is for work the companion chose to do. It must
      // never sit in front of the player: this lane is evaluated above
      // player_directive, so a casual comportment could delay an explicit
      // "follow me" by its full pause. Waiting on someone who just spoke to you
      // is the opposite of feeling like a companion. Autonomous work below
      // still paces normally. See ARCHITECTURE.md -- a player command is never
      // deferred, queued behind, or paced by anything.
      const playerIsWaiting = playerAwaitsResponse(this.agent, {
        directiveResumeRequested: this.directiveResumeRequested,
      });
      if (this.urgency === 'critical' || playerIsWaiting) {
        this.comportmentPauseUntil = 0;
        this.traceRecorder.startLane('comportment_pause');
        this.traceRecorder.finishLane('comportment_pause', {
          status: 'ineligible',
          reasonCode: this.urgency === 'critical'
            ? 'critical_urgency_override'
            : 'player_directive_outranks_comportment',
        });
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
      const deferredPlayerAction = this.agent.actions?.hasDeferredPlayerAction?.() === true;
      if (!companion?.directive && !deferredPlayerAction) {
        this.directiveResumeRequested = false;
        this.directiveResumeRequest = null;
        this.directiveMaterialChangeBlocker = null;
      }
      this.traceRecorder.startLane('player_directive');
      if (deferredPlayerAction && this.agent.isIdle?.()) {
        const operation = this.agent.actions.resumeDeferredPlayerAction();
        void Promise.resolve(operation).catch(error => {
          console.error(`[behavior-arbiter] Deferred player action failed: ${boundedText(error?.message || error)}`);
        });
        return this.select(
          'player_directive',
          'deferred_player_action_resumed',
          'The critical safety reflex released control; resuming the accepted finite player action once.',
          true,
          perception,
        );
      }
      const safetyIncident = survival?.safetyIncident || survival?.snapshot?.()?.safetyIncident;
      const standingResumeAvailable = Boolean(
        companion?.directive
        && (this.agent.actions?.resume_func || this.directiveResumeRequested)
      );
      const directiveSettlement = standingResumeAvailable
        ? this.directiveSettlement(companion)
        : Object.freeze({ active: false, state: 'changed', code: null });
      const directiveResumeDecision = standingResumeAvailable
        ? chooseCompanionAction({
            directive: companion,
            resumeRequested: true,
            resumeRequest: this.directiveResumeRequest || companion,
            bodyIdle: this.agent.isIdle?.() === true,
            safetyIncidentActive: safetyIncident?.active === true,
            directiveSettlement,
            operatorHeld: this.agent.isOperatorHeld?.() === true,
            runtimeStopped: this.stopped,
          })
        : null;
      if (directiveResumeDecision?.intent === 'cancel_stale_resume'
        || directiveResumeDecision?.intent === 'hold') {
        this.directiveResumeRequested = false;
        this.directiveResumeRequest = null;
      }
      const exactDirectiveResume = directiveResumeDecision?.intent === 'resume_directive';
      const directiveWaitDecision = directiveResumeDecision?.intent === 'wait_material_change'
        ? directiveResumeDecision
        : null;
      if (
        companion?.directive
        && companion.presence === 'present'
        && (this.agent.actions?.resume_func || this.directiveResumeRequested)
        && this.agent.isIdle?.()
        && (this.directiveResumeRequested || !this.agent.self_prompter?.isActive?.())
        && exactDirectiveResume
      ) {
        const resumedExistingAction = Boolean(this.agent.actions?.resume_func && !this.directiveResumeRequested);
        const operation = resumedExistingAction
          ? this.agent.actions.resumeAction()
          : this.agent.resumeCompanionDirective?.();
        this.directiveResumeRequested = false;
        this.directiveResumeRequest = null;
        if (operation === false) {
          this.traceRecorder.finishLane('player_directive', {
            status: 'ineligible',
            reasonCode: resumedExistingAction ? 'continuation_rejected' : 'directive_resume_rejected',
          });
        } else {
          void Promise.resolve(operation).catch(error => {
            console.error(`[behavior-arbiter] Companion continuation failed: ${boundedText(error?.message || error)}`);
          });
          return this.select(
            'player_directive',
            resumedExistingAction ? 'continuation_resumed' : 'exact_directive_resumed',
            'Resuming the existing explicit follow or guard action.',
            true,
            perception,
          );
        }
      }
      this.traceRecorder.finishLane('player_directive', {
        status: directiveWaitDecision ? 'deferred' : 'ineligible',
        reasonCode: directiveWaitDecision?.code || 'directive_not_resumable',
      });

      if (!survivalEvaluated) {
        this.traceRecorder.startLane('basic_survival');
        if (survival?.update) {
          try {
            survival.update();
          } catch (error) {
            return this.select('basic_survival', 'survival_update_failed', `Survival policy failed safely: ${boundedText(error?.message || error)}`, true, perception);
          }
          if (survival.inFlight || survival.blocksLowerPriority?.() || this.agent.actions?.executing) {
            if (
              survival.permitsIdleEmbodiment?.()
              && this.agent.isIdle?.()
              && this.comportment().idleEmbodiment
            ) {
              selected = await this.evaluateModeBand('idle_embodiment', ['idle_staring'], perception);
              if (selected) return selected;
            }
            return this.select('basic_survival', survival.status?.code || 'survival_selected', 'Basic survival maintenance selected the tick.', true, perception);
          }
        }
        this.traceRecorder.finishLane('basic_survival', { status: 'ineligible', reasonCode: 'survival_not_selected' });
      }

      if (directiveWaitDecision) {
        this.traceRecorder.startLane('player_directive');
        return this.select(
          'player_directive',
          directiveWaitDecision.code,
          directiveWaitDecision.reason,
          true,
          perception,
        );
      }

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

      const goal = this.agent.goal_director;
      const agenda = this.agent.agenda_director;
      const explicitPlayerJob = Boolean(
        job?.activeOrder && PLAYER_JOB_SOURCES.has(job.activeOrder.source)
      );
      if (goal?.activeGoal || explicitPlayerJob) {
        this.releaseTerminalHandoff('Fresh player-authorized work superseded the terminal handoff.', false);
      } else if (goal?.hasProtectedCompletion?.()) {
        this.traceRecorder.startLane('player_goal');
        const agendaSettlement = agenda?.settleProtectedGoalCompletion?.();
        if (agendaSettlement?.settled) {
          return this.select(
            'player_goal',
            'agenda_goal_completion_consumed',
            'The matching player agenda step persisted the verified goal result; lower-priority work remains suppressed during handoff.',
            true,
            perception,
          );
        }
        return this.select(
          'player_goal',
          'player_goal_output_reserved',
          'A verified player-goal result remains reserved until later player-authorized work releases it.',
          true,
          perception,
        );
      } else {
        const terminalHandoff = this.currentTerminalHandoff();
        if (terminalHandoff) {
          const handoffLane = terminalHandoff.owner === 'player_job' ? 'player_job' : 'player_goal';
          this.traceRecorder.startLane(handoffLane);
          return this.select(
            handoffLane,
            `${handoffLane}_terminal_handoff`,
            'The player-authorized outcome is settling its bounded companion handoff; unrelated autonomous work remains suppressed.',
            true,
            perception,
          );
        }
      }

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

      // A completed bounded agenda may release an explicitly preserved Follow
      // continuation. Hold this tick for that player-authorized handoff; the
      // next tick resumes the directive through the normal ActionManager path.
      if (this.directiveResumeRequested && companion?.directive) {
        this.traceRecorder.startLane('player_directive');
        return this.select(
          'player_directive',
          'agenda_continuation_pending',
          'The completed player agenda is handing control back to the standing companion directive.',
          true,
          perception,
        );
      }

      // A queued player plan retains authority between executor steps. This
      // covers the short persisted settlement/cooldown window without letting
      // opportunity, role, progression, reactions, or idle embodiment steal a
      // tick before the next already-authorized step can dispatch.
      if (
        agenda?.hasUnfinished?.()
        && !goal?.activeGoal
        && !job?.activeOrder
        && !this.agent.actions?.executing
      ) {
        this.traceRecorder.startLane('player_goal');
        return this.select(
          'player_goal',
          'agenda_handoff_pending',
          'The existing player agenda is settling or waiting to dispatch its next authorized step.',
          true,
          perception,
        );
      }

      this.traceRecorder.startLane('player_goal');
      const goalActiveAtTickEntry = Boolean(goal?.activeGoal);
      if (goalActiveAtTickEntry) {
        try {
          goal.update();
        } catch (error) {
          return this.select('player_goal', 'player_goal_update_failed', `Typed player goal failed safely: ${boundedText(error?.message || error)}`, true, perception);
        }
        const terminalTransition = !goal.activeGoal && !goal.inFlight && !this.agent.actions?.executing;
        if (terminalTransition) {
          this.beginTerminalHandoff({
            outcomeId: goal.lastGoal?.id,
            owner: 'player_goal',
            phase: goal.lastGoal?.phase || goal.status?.phase || 'terminal',
            code: goal.status?.code,
          });
        }
        return this.select(
          'player_goal',
          goal.status?.code || (terminalTransition ? 'player_goal_terminal_handoff' : 'player_goal_selected'),
          terminalTransition
            ? 'The typed player goal reached a terminal transition; lower-priority lanes remain suppressed for this tick.'
            : 'A typed player goal selected the tick.',
          true,
          perception,
        );
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
      terminalHandoff: this.currentTerminalHandoff(),
      controlSuspension: this.currentControlSuspension(),
      lastControlSuspension: this.lastControlSuspension ? { ...this.lastControlSuspension } : null,
      heldSurfaceStance: { ...this.heldSurfaceStance },
      decisionTrace: this.traceRecorder.snapshot(16),
    };
  }
}
