const SCHEMA_VERSION = 1;
const DEFAULT_RETENTION = 128;
const MAX_RETENTION = 512;
const MAX_TEXT = 240;

export const DECISION_TRACE_LANES = Object.freeze([
  'operator_hold',
  'emergency_self_preservation',
  'attributed_protection',
  'active_action_retention',
  'bounded_recovery',
  'comportment_pause',
  'player_directive',
  'basic_survival',
  'survival_job',
  'player_goal',
  'player_job',
  'command_policy_guard',
  'factual_reaction',
  'role_work',
  'self_progression',
  'opportunity',
  'idle_embodiment',
  'self_prompt',
  'idle',
]);

function text(value, fallback = '') {
  return String(value || fallback)
    .replace(/[\u0000-\u001f\u007f]/g, ' ') // eslint-disable-line no-control-regex
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);
}

function nullableText(value) {
  const normalized = text(value);
  return normalized || null;
}

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function duration(value) {
  const number = finite(value);
  return number === null ? null : Number(Math.max(0, number).toFixed(3));
}

function clampRetention(value) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return DEFAULT_RETENTION;
  return Math.min(MAX_RETENTION, Math.max(1, parsed));
}

function normalizeCommitment(value = {}) {
  return {
    resumeAction: nullableText(value.resumeAction),
    goalId: nullableText(value.goalId),
    goalPhase: nullableText(value.goalPhase),
    workOrderId: nullableText(value.workOrderId),
    workOrderPhase: nullableText(value.workOrderPhase),
  };
}

function normalizeAction(value = {}) {
  return {
    actionId: nullableText(value.actionId),
    owner: nullableText(value.owner),
    label: nullableText(value.label),
    intent: nullableText(value.intent),
    startedAt: finite(value.startedAt),
    commitment: normalizeCommitment(value.commitment),
  };
}

function normalizeEvidence(value, index, wallClockTimestamp) {
  const observedAt = finite(value?.observedAt);
  return {
    id: text(value?.id, `evidence-${index + 1}`).slice(0, 80),
    source: text(value?.source, 'unknown').slice(0, 80),
    observedAt,
    ageMs: observedAt === null ? null : Math.max(0, wallClockTimestamp - observedAt),
    summary: nullableText(value?.summary),
  };
}

function laneTemplate(lane, order) {
  return {
    order,
    lane,
    status: 'not_evaluated',
    reasonCode: 'short_circuit',
    targetRef: null,
    evidenceRefs: [],
    durationMs: null,
  };
}

function normalizeOutcome(result) {
  if (!result?.actionId) return null;
  return {
    actionId: text(result.actionId).slice(0, 80),
    phase: text(result.phase, 'failed').slice(0, 40),
    code: text(result.code, 'unknown').slice(0, 80),
    finishedAt: finite(result.finishedAt),
    durationMs: Number.isFinite(result.startedAt) && Number.isFinite(result.finishedAt)
      ? duration(result.finishedAt - result.startedAt)
      : finite(result.durationMs),
  };
}

/**
 * Bounded, diagnostic-only recorder for the existing arbiter cascade. It owns
 * no timers, gameplay events, disk writes, or control decisions.
 */
export class DecisionTraceRecorder {
  constructor({
    enabled = true,
    retention = DEFAULT_RETENTION,
    now = Date.now,
    monotonicNow = () => performance.now(),
    agent = 'bot',
  } = {}) {
    this.enabled = enabled === true;
    this.retention = clampRetention(retention);
    this.now = typeof now === 'function' ? now : Date.now;
    this.monotonicNow = typeof monotonicNow === 'function' ? monotonicNow : () => performance.now();
    this.agent = text(agent, 'bot').slice(0, 80);
    this.sequence = 0;
    this.current = null;
    this.recent = [];
    this.laneStarted = new Map();
    this.stageStarted = new Map();
  }

  begin({ tick = 0, trigger = {}, activeAction = {}, evidence = [] } = {}) {
    if (!this.enabled) return null;
    if (this.current) this.finalize();
    const wallClockTimestamp = this.now();
    const monotonicStartedMs = this.monotonicNow();
    this.sequence += 1;
    this.laneStarted.clear();
    this.stageStarted.clear();
    this.current = {
      schemaVersion: SCHEMA_VERSION,
      decisionId: `${this.agent}-${Math.max(0, Math.floor(Number(tick) || 0))}-${wallClockTimestamp}-${this.sequence}`.slice(0, 160),
      agent: this.agent,
      wallClockTimestamp,
      monotonicStartedMs: duration(monotonicStartedMs) ?? 0,
      trigger: {
        code: text(trigger.code, 'scheduled_tick').slice(0, 80),
        deltaMs: finite(trigger.deltaMs),
      },
      activeAction: normalizeAction(activeAction),
      evidence: (Array.isArray(evidence) ? evidence : [])
        .slice(0, 16)
        .map((item, index) => normalizeEvidence(item, index, wallClockTimestamp)),
      lanes: DECISION_TRACE_LANES.map(laneTemplate),
      winner: {
        lane: 'idle',
        reasonCode: 'not_selected',
        control: 'none',
        controlReason: 'No lane selected yet.',
        hardGate: null,
        preemption: {
          involved: false,
          fromOwner: null,
          fromAction: null,
          toLane: null,
        },
      },
      stages: [],
      timing: { evaluationMs: 0, cleanupMs: 0, totalMs: 0 },
      correlation: { actionId: normalizeAction(activeAction).actionId, outcomeLinked: false },
      outcome: null,
    };
    return this.current.decisionId;
  }

  addEvidence(value = {}) {
    if (!this.current || this.current.evidence.length >= 16) return false;
    this.current.evidence.push(normalizeEvidence(value, this.current.evidence.length, this.current.wallClockTimestamp));
    return true;
  }

  startLane(lane) {
    if (!this.current || !DECISION_TRACE_LANES.includes(lane)) return false;
    const entry = this.current.lanes.find(candidate => candidate.lane === lane);
    if (!entry || entry.status !== 'not_evaluated') return false;
    if (!this.laneStarted.has(lane)) this.laneStarted.set(lane, this.monotonicNow());
    return true;
  }

  finishLane(lane, {
    status = 'ineligible',
    reasonCode = 'not_selected',
    targetRef = null,
    evidenceRefs = [],
  } = {}) {
    if (!this.current || !DECISION_TRACE_LANES.includes(lane)) return false;
    const entry = this.current.lanes.find(candidate => candidate.lane === lane);
    if (!entry || entry.status !== 'not_evaluated') return false;
    const allowedStatus = ['eligible', 'ineligible', 'error'].includes(status) ? status : 'ineligible';
    const startedAt = this.laneStarted.get(lane);
    entry.status = allowedStatus;
    entry.reasonCode = text(reasonCode, 'not_selected').slice(0, 80);
    entry.targetRef = nullableText(targetRef);
    entry.evidenceRefs = (Array.isArray(evidenceRefs) ? evidenceRefs : [])
      .map(value => text(value).slice(0, 80))
      .filter(Boolean)
      .slice(0, 8);
    entry.durationMs = duration(startedAt === undefined ? 0 : this.monotonicNow() - startedAt);
    this.laneStarted.delete(lane);
    return true;
  }

  startStage(stage) {
    if (!this.current) return false;
    const normalized = text(stage).slice(0, 80);
    if (!normalized || this.stageStarted.has(normalized)) return false;
    this.stageStarted.set(normalized, this.monotonicNow());
    return true;
  }

  finishStage(stage) {
    if (!this.current || this.current.stages.length >= 24) return false;
    const normalized = text(stage).slice(0, 80);
    const startedAt = this.stageStarted.get(normalized);
    if (startedAt === undefined) return false;
    this.current.stages.push({ stage: normalized, durationMs: duration(this.monotonicNow() - startedAt) ?? 0 });
    this.stageStarted.delete(normalized);
    return true;
  }

  select({ lane, evaluatedLane = lane, reasonCode, lowerLanesSuppressed = false } = {}) {
    if (!this.current) return false;
    const normalizedLane = text(lane, 'idle').slice(0, 80);
    const normalizedEvaluationLane = DECISION_TRACE_LANES.includes(evaluatedLane)
      ? evaluatedLane
      : DECISION_TRACE_LANES.includes(normalizedLane)
        ? normalizedLane
        : null;
    const status = /failed$/.test(String(reasonCode || '')) ? 'error' : 'eligible';
    if (normalizedEvaluationLane) this.finishLane(normalizedEvaluationLane, { status, reasonCode });
    const active = this.current.activeAction;
    const preemptingLane = ['emergency_self_preservation', 'attributed_protection'].includes(normalizedLane);
    const preemptionInvolved = Boolean(active.actionId && preemptingLane && active.owner !== 'reflex');
    const retains = Boolean(active.actionId && !preemptionInvolved);
    this.current.winner = {
      lane: normalizedLane,
      reasonCode: text(reasonCode, 'selected').slice(0, 80),
      control: retains ? 'retained' : lowerLanesSuppressed ? 'acquired' : 'none',
      controlReason: retains
        ? 'The existing serialized action retained ownership.'
        : lowerLanesSuppressed
          ? 'The selected lane suppressed lower-priority lanes.'
          : 'No serialized action ownership was required.',
      hardGate: ['operator_hold', 'comportment_pause', 'degraded'].includes(normalizedLane)
        ? normalizedLane
        : null,
      preemption: {
        involved: preemptionInvolved,
        fromOwner: preemptionInvolved ? active.owner : null,
        fromAction: preemptionInvolved ? active.label : null,
        toLane: preemptionInvolved ? normalizedLane : null,
      },
    };
    return true;
  }

  finalize({ evaluationFinishedMs = null } = {}) {
    if (!this.current) return null;
    const finished = this.monotonicNow();
    const started = this.current.monotonicStartedMs;
    const evaluationEnd = Number.isFinite(evaluationFinishedMs) ? evaluationFinishedMs : finished;
    this.current.timing = {
      evaluationMs: duration(evaluationEnd - started) ?? 0,
      cleanupMs: duration(finished - evaluationEnd) ?? 0,
      totalMs: duration(finished - started) ?? 0,
    };
    const completed = this.current;
    this.current = null;
    this.laneStarted.clear();
    this.stageStarted.clear();
    this.recent.push(completed);
    if (this.recent.length > this.retention) {
      this.recent.splice(0, this.recent.length - this.retention);
    }
    return completed;
  }

  linkAction({ actionId, owner = null, label = null, startedAt = null } = {}) {
    if (!this.enabled || !actionId) return false;
    const trace = this.current || [...this.recent].reverse().find(candidate => (
      !candidate.correlation.actionId && candidate.winner.control !== 'none'
    ));
    if (!trace) return false;
    trace.correlation.actionId = text(actionId).slice(0, 80);
    trace.activeAction = normalizeAction({
      ...trace.activeAction,
      actionId,
      owner: owner || trace.activeAction.owner,
      label: label || trace.activeAction.label,
      startedAt: startedAt ?? trace.activeAction.startedAt,
    });
    return true;
  }

  linkOutcome(result) {
    if (!this.enabled || !result?.actionId) return false;
    const candidates = this.current ? [...this.recent, this.current] : this.recent;
    const trace = [...candidates].reverse().find(candidate => candidate.correlation.actionId === result.actionId);
    if (!trace) return false;
    trace.outcome = normalizeOutcome(result);
    trace.correlation.outcomeLinked = trace.outcome !== null;
    return trace.correlation.outcomeLinked;
  }

  snapshot(recentLimit = 4) {
    if (!this.enabled) return null;
    const limit = Math.max(0, Math.min(16, Math.floor(Number(recentLimit) || 0)));
    return {
      schemaVersion: SCHEMA_VERSION,
      retained: this.recent.length,
      retentionLimit: this.retention,
      recent: this.recent.slice(-limit).map(trace => structuredClone(trace)),
    };
  }
}

export function extractDecisionTraces(value) {
  if (Array.isArray(value)) return value.filter(trace => trace?.schemaVersion === SCHEMA_VERSION);
  if (value?.schemaVersion === SCHEMA_VERSION && Array.isArray(value?.lanes)) return [value];
  const candidates = [
    value?.recent,
    value?.decisionTrace?.recent,
    value?.behaviorArbiter?.decisionTrace?.recent,
    value?.action?.behaviorArbiter?.decisionTrace?.recent,
  ];
  return candidates.find(Array.isArray)?.filter(trace => trace?.schemaVersion === SCHEMA_VERSION) || [];
}

export function formatDecisionTrace(trace) {
  if (!trace || trace.schemaVersion !== SCHEMA_VERSION) {
    throw new TypeError('Expected a DecisionTraceV1 record.');
  }
  const active = trace.activeAction?.actionId
    ? `${trace.activeAction.owner || 'unknown'}:${trace.activeAction.label || trace.activeAction.actionId}`
    : 'none';
  const lines = [
    `decision ${trace.decisionId} @ ${trace.wallClockTimestamp}`,
    `trigger=${trace.trigger?.code || 'unknown'} active=${active}`,
    `winner=${trace.winner?.lane || 'none'} reason=${trace.winner?.reasonCode || 'unknown'} control=${trace.winner?.control || 'none'}`,
  ];
  for (const lane of trace.lanes || []) {
    const timing = lane.durationMs === null ? '-' : `${lane.durationMs}ms`;
    lines.push(`${String(lane.order).padStart(2, '0')} ${lane.lane}: ${lane.status} (${lane.reasonCode}) ${timing}`);
  }
  const evidence = (trace.evidence || [])
    .map(item => `${item.id}:${item.source}:${item.ageMs === null ? 'unknown' : `${item.ageMs}ms`}`)
    .join(', ') || 'none';
  lines.push(`evidence=${evidence}`);
  const preemption = trace.winner?.preemption;
  lines.push(`preemption=${preemption?.involved ? `${preemption.fromOwner || 'unknown'}:${preemption.fromAction || 'unknown'}->${preemption.toLane}` : 'none'}`);
  lines.push(`timing evaluation=${trace.timing?.evaluationMs ?? 0}ms cleanup=${trace.timing?.cleanupMs ?? 0}ms total=${trace.timing?.totalMs ?? 0}ms`);
  lines.push(trace.outcome
    ? `outcome=${trace.outcome.phase}:${trace.outcome.code} action=${trace.outcome.actionId}`
    : `outcome=${trace.correlation?.actionId ? 'pending' : 'unlinked'}`);
  return lines.join('\n');
}
