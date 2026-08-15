import { normalizeInteractionStanceReceipt } from './interaction-stance.js';

const MAX_DETAIL_LENGTH = 1_200;
const ACTION_PHASES = new Set(['succeeded', 'requested', 'failed', 'blocked', 'interrupted', 'cancelled']);

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

export function createActionResult({
  actionId = null,
  label = '',
  phase = 'failed',
  code = 'unknown',
  detail = '',
  target = null,
  evidence = null,
  retryable = false,
  startedAt = null,
  finishedAt = Date.now(),
} = {}) {
  return Object.freeze({
    actionId: typeof actionId === 'string' ? actionId.slice(0, 80) : null,
    label: text(label),
    phase: ACTION_PHASES.has(phase) ? phase : 'failed',
    code: text(code, 'unknown').slice(0, 80),
    detail: text(detail),
    target: safeTarget(target),
    evidence: evidence && typeof evidence === 'object' && !Array.isArray(evidence) ? structuredClone(evidence) : null,
    retryable: retryable === true,
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
export function actionResultToTelemetry(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const phase = ACTION_PHASES.has(result.phase)
    ? result.phase
    : 'failed';
  const interactionStance = normalizeInteractionStanceReceipt(
    result.evidence?.skill?.interactionStance,
  );
  return {
    actionId: typeof result.actionId === 'string' ? result.actionId.slice(0, 80) : null,
    phase,
    code: text(result.code, 'unknown').slice(0, 80),
    label: text(result.label).slice(0, 120),
    detail: text(result.detail).slice(0, 280),
    target: safeTarget(result.target),
    retryable: result.retryable === true,
    durationMs: Number.isFinite(result.startedAt) && Number.isFinite(result.finishedAt)
      ? Math.max(0, result.finishedAt - result.startedAt)
      : null,
    startedAt: Number.isFinite(result.startedAt) ? result.startedAt : null,
    finishedAt: Number.isFinite(result.finishedAt) ? result.finishedAt : null,
    ...(interactionStance ? { interactionStance } : {}),
  };
}
