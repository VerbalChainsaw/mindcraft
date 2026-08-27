import { normalizeInteractionStanceReceipt } from './interaction-stance.js';
import { normalizeActionReceiptValue } from './action-receipt-ledger.js';

const MAX_DETAIL_LENGTH = 1_200;
const ACTION_PHASES = new Set(['succeeded', 'requested', 'failed', 'blocked', 'interrupted', 'cancelled']);
export const ACTION_CONTINUATION_KINDS = Object.freeze([
  'resume_same',
  'replan_current',
  'retry_after_material_change',
  'disengage_then_resume',
  'terminal',
]);
const ACTION_CONTINUATIONS = new Set(ACTION_CONTINUATION_KINDS);

function text(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_DETAIL_LENGTH);
}

function safeTarget(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const target = {};
  for (const key of [
    'name',
    'type',
    'requestedName',
    'canonicalName',
    'presence',
    'x',
    'y',
    'z',
    'distance',
    'entityId',
    'observedAt',
    'lastSeenAt',
    'lineOfSightObservedAt',
    'lineOfSightAge',
    'age',
  ]) {
    if (typeof value[key] === 'string') target[key] = text(value[key]);
    if (Number.isFinite(value[key])) target[key] = value[key];
  }
  if (typeof value.lineOfSight === 'boolean' || value.lineOfSight === null) {
    target.lineOfSight = value.lineOfSight;
  }
  return Object.keys(target).length ? target : null;
}

function actionReceiptTelemetry(value) {
  if (value?.receiptSchemaVersion !== 1 || typeof value?.source !== 'string') return null;
  const children = {};
  if (value.children && typeof value.children === 'object' && !Array.isArray(value.children)) {
    for (const relationship of Object.keys(value.children).slice(0, 9)) {
      const receipts = Array.isArray(value.children[relationship])
        ? value.children[relationship].slice(0, 16)
        : [];
      if (receipts.length === 0) continue;
      children[relationship] = receipts.map(receipt => normalizeActionReceiptValue({
        sequence: receipt?.sequence,
        relationship: receipt?.relationship,
        stage: receipt?.stage,
        kind: receipt?.kind,
        outcome: receipt?.outcome,
        code: receipt?.code,
        target: safeTarget(receipt?.target),
        progressed: receipt?.progressed,
        segmentCount: Array.isArray(receipt?.segments) ? receipt.segments.length : undefined,
        summarized: receipt?.summarized === true,
        originalByteCount: receipt?.originalByteCount,
      }));
    }
  }
  return normalizeActionReceiptValue({
    receiptSchemaVersion: 1,
    actionId: value.actionId,
    source: value.source,
    contract: value.contract,
    overflow: value.overflow,
    children,
  });
}

function normalizeContinuation(value, { phase, code, retryable }) {
  let kind = ACTION_CONTINUATIONS.has(value?.kind) ? value.kind : null;

  // Physical verification is authoritative over any pre-verification failure
  // suggestion carried by a copied result. This is why capability reconciliation
  // can safely spread a failed executor result and promote it to success.
  if (phase === 'succeeded' || phase === 'requested') kind = 'replan_current';
  else if (phase === 'interrupted' || phase === 'cancelled') kind = 'resume_same';
  else if (code === 'action_pattern_detected') kind = 'retry_after_material_change';
  else if (['activity_unsettled', 'previous_action_unresponsive'].includes(code)) kind = 'terminal';
  else if (!kind) kind = retryable === true ? 'replan_current' : 'terminal';

  const incidentId = text(value?.incidentId).slice(0, 96);
  const preemptorActivityId = text(value?.preemptorActivityId).slice(0, 128);
  return Object.freeze({
    kind,
    ...(incidentId ? { incidentId } : {}),
    ...(preemptorActivityId ? { preemptorActivityId } : {}),
  });
}

export function createActionResult({
  actionId = null,
  label = '',
  phase = 'failed',
  code = 'unknown',
  detail = '',
  target = null,
  evidence = null,
  retryable = false,
  continuation = null,
  startedAt = null,
  finishedAt = Date.now(),
} = {}) {
  const normalizedPhase = ACTION_PHASES.has(phase) ? phase : 'failed';
  const normalizedCode = text(code, 'unknown').slice(0, 80);
  const normalizedRetryable = retryable === true;
  return Object.freeze({
    actionId: typeof actionId === 'string' ? actionId.slice(0, 80) : null,
    label: text(label),
    phase: normalizedPhase,
    code: normalizedCode,
    detail: text(detail),
    target: normalizeActionReceiptValue(safeTarget(target)),
    evidence: evidence && typeof evidence === 'object' && !Array.isArray(evidence)
      ? normalizeActionReceiptValue(evidence)
      : null,
    retryable: normalizedRetryable,
    continuation: normalizeContinuation(continuation, {
      phase: normalizedPhase,
      code: normalizedCode,
      retryable: normalizedRetryable,
    }),
    startedAt: Number.isFinite(startedAt) ? startedAt : null,
    finishedAt: Number.isFinite(finishedAt) ? finishedAt : Date.now(),
  });
}

export function actionResultFromError(error, context = {}) {
  const message = text(error?.message || error || 'Action failed.');
  const interrupted = context.interrupted === true || /interrupted|stopped|cancelled/i.test(message);
  return createActionResult({
    ...context,
    phase: interrupted ? 'interrupted' : 'failed',
    code: interrupted ? 'interrupted' : 'runtime_error',
    detail: [context.detail, message].filter(Boolean).join('\n'),
    retryable: interrupted || context.retryable === true,
  });
}

// A higher-priority lane taking ActionManager is not the work failing. Every
// executor that folds a result back into its own plan needs to tell those two
// apart, so the distinction lives with the result contract rather than being
// re-derived in each director.
const PREEMPTION_CODE = /^(?:action_)?interrupted$/;

const CENSORED_OUTCOME_CODES = new Set([
  'action_cancelled',
  'action_owner_replaced',
  'cancelled',
  'goal_cancelled',
  'higher_priority_action_active',
  'interrupted',
  'operator_hold',
  'owner_replaced',
  'previous_action_unresponsive',
  'stop_requested',
]);

const NON_METHOD_FAILURE_CODES = new Set([
  'skill_source_access_pending',
  'skill_source_spawn_pending',
]);

const TARGET_LOCAL_FAILURE_CODE = /(?:action_deadline|collect_blocked|goal_not_reached|no_path|no_safe_stance|not_broken|not_collected|path_stalled|path_timeout|stance_unverified|target_unloaded|timeout|unreachable)/;

function concreteFailureTarget(value, fallbackKind = 'action', fallbackOutcome = 'unknown') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!value.name || ![value.x, value.y, value.z].every(Number.isFinite)) return null;
  return {
    kind: text(value.kind || fallbackKind).slice(0, 32) || 'action',
    name: text(value.name).slice(0, 80),
    x: Math.floor(value.x),
    y: Math.floor(value.y),
    z: Math.floor(value.z),
    outcome: text(value.outcome || value.code || fallbackOutcome).slice(0, 80) || 'unknown',
    targetLocal: true,
  };
}

/**
 * Return only failures that independently establish a bad physical target.
 * A prerequisite by itself must never poison a coordinate. Skills can make the
 * distinction explicit with `failedTargets[].targetLocal`; older single-target
 * results retain a conservative fallback only when no prerequisite coexists.
 */
export function actionResultTargetFailures(result) {
  if (!result || result.phase === 'succeeded') return [];
  const skill = result.evidence?.skill && typeof result.evidence.skill === 'object'
    ? result.evidence.skill
    : null;
  const hasExplicitFailures = Array.isArray(skill?.failedTargets);
  const explicit = hasExplicitFailures
    ? skill.failedTargets
      .filter(target => target?.targetLocal === true)
      .map(target => concreteFailureTarget(target, skill?.kind, skill?.outcome))
      .filter(Boolean)
    : [];
  const candidates = hasExplicitFailures
    ? explicit
    : (
        skill?.toolRequirement
        || skill?.workstationRequirement
        || skill?.accessRequirement
        || !TARGET_LOCAL_FAILURE_CODE.test(`${result.code || ''} ${skill?.outcome || ''}`)
      )
      ? []
      : [skill?.target, result.target]
        .map(target => concreteFailureTarget(target, skill?.kind, skill?.outcome || result.code))
        .filter(Boolean)
        .slice(0, 1);
  const distinct = new Map();
  for (const target of candidates) {
    distinct.set(`${target.kind}:${target.name}:${target.x}:${target.y}:${target.z}`, target);
  }
  return [...distinct.values()].slice(-24);
}

export function isPreemption(result) {
  return result?.phase === 'interrupted' || PREEMPTION_CODE.test(text(result?.code));
}

/**
 * Classify whether a completed action is evidence about the attempted method.
 * Ownership changes and cancellation censor the sample: they are neither a
 * success nor a method failure and must not update learned preferences.
 */
export function classifyMethodOutcome(result) {
  if (result?.phase === 'succeeded') return 'success';
  const phase = text(result?.phase);
  const code = text(result?.code).toLowerCase();
  if (
    phase === 'requested'
    || phase === 'interrupted'
    || phase === 'cancelled'
    || isPreemption(result)
    || CENSORED_OUTCOME_CODES.has(code)
    || NON_METHOD_FAILURE_CODES.has(code)
  ) return 'censored';
  return 'method_failure';
}

export function actionResultToMessage(result) {
  if (!result) return 'Action did not return a result.';
  const prefix = result.phase === 'succeeded'
    ? 'Completed'
    : result.phase === 'requested'
      ? 'Requested'
      : result.phase === 'blocked'
        ? 'Blocked'
        : 'Failed';
  return `${prefix} (${result.code}): ${result.detail || result.label || 'no additional detail'}`;
}

// The dashboard must never need raw skill logs to explain an outcome. Keep this
// intentionally smaller than the stored result: tool evidence can be useful to
// the bot, but can contain noisy implementation details that do not belong in a
// browser state stream.
/**
 * Bounded request correlation for live telemetry.
 *
 * `action_manager` already records which request produced an action at
 * `result.evidence.request` (requestId, routeOrigin, selectedSkill, args), but
 * the telemetry projection never exposed it, so nothing observing live state
 * could tie an action back to the request that caused it.
 *
 * That gap made `request-correlation` unsatisfiable for any Scenario Lab run
 * declaring `instrumentationMode: off`: the only other source is the arbiter
 * decision trace, which that mode explicitly requires to be absent. The August
 * 2026 baseline only passed because the trace leaked through before that
 * enforcement existed -- so the evidence was never actually proven under the
 * declared configuration.
 *
 * This is deliberately small and bounded: identity of the request, not its
 * contents.
 */
function actionRequestTelemetry(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return null;
  const requestId = text(request.requestId).slice(0, 80);
  if (!requestId) return null;
  const missionId = text(request.missionId).slice(0, 96);
  const activityId = text(request.activityId).slice(0, 128);
  return {
    requestId,
    routeOrigin: text(request.routeOrigin).slice(0, 40) || 'internal',
    selectedSkill: text(request.selectedSkill).slice(0, 80),
    args: (Array.isArray(request.args) ? request.args : [])
      .slice(0, 8)
      .map(argument => {
        if (argument === null || typeof argument === 'boolean') return argument;
        if (typeof argument === 'number') return Number.isFinite(argument) ? argument : null;
        if (typeof argument === 'string') return text(argument).slice(0, 120);
        return null;
      }),
    ...(missionId ? { missionId } : {}),
    ...(activityId ? { activityId } : {}),
  };
}

function actionActivityTelemetry(activity, request) {
  if (!activity || typeof activity !== 'object' || Array.isArray(activity)) return null;
  if (!request?.missionId || !request?.activityId) return null;
  const missionId = text(activity.missionId).slice(0, 96);
  const activityId = text(activity.activityId).slice(0, 128);
  const lifecycle = text(activity.lifecycle).slice(0, 40);
  if (!missionId || !activityId || !lifecycle) return null;
  return { missionId, activityId, lifecycle };
}

export function actionResultToTelemetry(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const phase = ACTION_PHASES.has(result.phase)
    ? result.phase
    : 'failed';
  const interactionStance = normalizeInteractionStanceReceipt(
    result.evidence?.skill?.interactionStance,
  );
  const receipt = actionReceiptTelemetry(result.evidence?.skill);
  const request = actionRequestTelemetry(result.evidence?.request);
  const activity = actionActivityTelemetry(result.evidence?.activity, request);
  return {
    actionId: typeof result.actionId === 'string' ? result.actionId.slice(0, 80) : null,
    phase,
    code: text(result.code, 'unknown').slice(0, 80),
    label: text(result.label).slice(0, 120),
    detail: text(result.detail).slice(0, 280),
    target: safeTarget(result.target),
    retryable: result.retryable === true,
    continuation: normalizeContinuation(result.continuation, {
      phase,
      code: text(result.code, 'unknown').slice(0, 80),
      retryable: result.retryable === true,
    }),
    durationMs: Number.isFinite(result.startedAt) && Number.isFinite(result.finishedAt)
      ? Math.max(0, result.finishedAt - result.startedAt)
      : null,
    startedAt: Number.isFinite(result.startedAt) ? result.startedAt : null,
    finishedAt: Number.isFinite(result.finishedAt) ? result.finishedAt : null,
    ...(interactionStance ? { interactionStance } : {}),
    ...(receipt ? { receipt } : {}),
    // Projected as `evidence.request` so a live observer can correlate an
    // action to its originating request without the decision trace.
    ...(request ? { evidence: { request, ...(activity ? { activity } : {}) } } : {}),
  };
}
