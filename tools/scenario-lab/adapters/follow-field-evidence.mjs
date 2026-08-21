import { canonicalJson, sha256 } from '../../a0/aggregate.mjs';

export const FOLLOW_FIELD_EVIDENCE = Object.freeze([
  'request-correlation',
  'instrumentation-mode-confirmed',
  'follow-action-lifecycle',
  'doorway-crossing-confirmed',
  'corridor-progress-confirmed',
  'terminal-quiescence-confirmed',
]);

// Delivery courses prove a correlated acquisition-and-handover chain, not a
// follow. The legacy evidence ID remains shared by both the typed goal and the
// Phase 3 Mission so the manifest schema does not need a parallel evidence set.
export const DELIVER_FIELD_EVIDENCE = Object.freeze([
  'request-correlation',
  'instrumentation-mode-confirmed',
  'goal-action-lifecycle',
  'dry-land-fixture-confirmed',
  'item-delivered-to-recipient',
  'terminal-quiescence-confirmed',
]);

export const ROUTE_PROBE_EVIDENCE = Object.freeze([
  'request-correlation',
  'instrumentation-mode-confirmed',
  'route-probe-lifecycle',
  'route-probe-inconclusive-confirmed',
  'no-unproven-movement-confirmed',
  'terrain-preserved-confirmed',
  'terminal-quiescence-confirmed',
]);

const EXPECTED_ROUTE = Object.freeze({
  direct: 'explicit-command',
  'natural-language': 'deterministic-nl',
});
const SHA256 = /^[a-f0-9]{64}$/;
const VARIANCE_EXECUTION_MODES = new Set(['recorded-trace', 'frozen-model']);
const VARIANCE_OBSERVER_MODES = new Set(['off', 'on']);
const VARIANCE_ID = /^[a-z0-9][a-z0-9._:-]*$/;
const PREFLIGHT_RESULT_KEYS = new Set([
  'owner',
  'operation',
  'status',
  'code',
  'conclusive',
  'retryable',
  'resultFingerprint',
]);

export function latestCompleteModelMeasurement(attempt) {
  const measurements = Array.isArray(attempt?.modelMeasurements)
    ? attempt.modelMeasurements
    : [];
  const issuedAt = Number(attempt?.issuedAt);
  for (let index = measurements.length - 1; index >= 0; index -= 1) {
    const measurement = measurements[index];
    if (
      Number.isFinite(issuedAt)
      && (!Number.isFinite(measurement?.sampledAt) || measurement.sampledAt < issuedAt)
    ) continue;
    if (
      !SHA256.test(measurement?.modelConfigFingerprint || '')
      || !SHA256.test(measurement?.inputFingerprint || '')
      || !SHA256.test(measurement?.outputFingerprint || '')
      || !SHA256.test(measurement?.modelRouteFingerprint || '')
    ) continue;
    const attempts = Array.isArray(measurement.attempts)
      ? measurement.attempts.map(entry => ({
          attempt: Number.isSafeInteger(entry?.attempt) ? entry.attempt : null,
          inputFingerprint: SHA256.test(entry?.inputFingerprint || '') ? entry.inputFingerprint : null,
          outputFingerprint: SHA256.test(entry?.outputFingerprint || '') ? entry.outputFingerprint : null,
          modelRouteFingerprint: SHA256.test(entry?.modelRouteFingerprint || '')
            ? entry.modelRouteFingerprint
            : null,
          outcome: typeof entry?.outcome === 'string' ? entry.outcome : null,
        }))
      : [];
    return {
      modelConfigFingerprint: measurement.modelConfigFingerprint,
      inputFingerprint: measurement.inputFingerprint,
      outputFingerprint: measurement.outputFingerprint,
      modelRouteFingerprint: measurement.modelRouteFingerprint,
      sampledAt: Number.isFinite(measurement.sampledAt) ? measurement.sampledAt : null,
      outcome: typeof measurement.outcome === 'string' ? measurement.outcome : null,
      attempt: Number.isSafeInteger(measurement.attempt) ? measurement.attempt : null,
      initialInputFingerprint: attempts.find(entry => entry.inputFingerprint)?.inputFingerprint
        || measurement.inputFingerprint,
      attempts,
    };
  }
  return null;
}

function failVariance(message) {
  throw new TypeError(`Cannot create variance observation: ${message}`);
}

function requireVarianceId(value, field) {
  if (typeof value !== 'string' || !VARIANCE_ID.test(value)) {
    failVariance(`${field} must be a lowercase Scenario Lab identifier.`);
  }
  return value;
}

function requireFingerprint(value, field) {
  if (!SHA256.test(value || '')) failVariance(`${field} must be a SHA-256 fingerprint.`);
  return value;
}

function requireMode(value, field, allowed) {
  if (!allowed.has(value)) failVariance(`${field} must be one of ${[...allowed].join(', ')}.`);
  return value;
}

function varianceFingerprint(value) {
  return sha256(Buffer.from(canonicalJson(value), 'utf8'));
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function scalarOrNull(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  return Number.isFinite(value) ? value : null;
}

function stableArgument(value) {
  if (Array.isArray(value)) return value.map(stableArgument);
  if (plain(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, stableArgument(value[key])]),
    );
  }
  return scalarOrNull(value);
}

function normalizedRequest(value) {
  if (!plain(value)) return null;
  const routeOrigin = typeof value.routeOrigin === 'string' ? value.routeOrigin : null;
  const selectedSkill = typeof value.selectedSkill === 'string' ? value.selectedSkill : null;
  const args = Array.isArray(value.args) ? value.args.map(stableArgument) : [];
  return routeOrigin || selectedSkill || args.length
    ? { routeOrigin, selectedSkill, args }
    : null;
}

function orderedAttemptResults(attempt) {
  const entries = plain(attempt?.results) ? Object.values(attempt.results) : [];
  const terminal = plain(attempt?.terminal) ? attempt.terminal : null;
  if (terminal && !entries.some(result => (
    result === terminal
    || (result?.actionId && result.actionId === terminal.actionId)
  ))) entries.push(terminal);
  return entries
    .filter(plain)
    .sort((left, right) => (
      (Number(left.startedAt) || 0) - (Number(right.startedAt) || 0)
      || (Number(left.finishedAt) || 0) - (Number(right.finishedAt) || 0)
      || String(left.label || '').localeCompare(String(right.label || ''))
    ));
}

function normalizedDecisionEvidence(attempt) {
  return {
    actions: orderedAttemptResults(attempt).map(result => ({
      label: typeof result.label === 'string' ? result.label : null,
      request: normalizedRequest(result?.evidence?.request),
    })),
  };
}

function normalizedLifecycleEvidence(attempt) {
  if (!Array.isArray(attempt?.traces)) failVariance('telemetry-on evidence has no trace collection.');
  const targetActionIds = new Set(orderedAttemptResults(attempt)
    .map(result => result?.actionId)
    .filter(value => typeof value === 'string' && value.length > 0));
  const records = new Map();
  const orderedTraces = [...attempt.traces].sort((left, right) => (
    (Number(left?.wallClockTimestamp) || 0) - (Number(right?.wallClockTimestamp) || 0)
    || String(left?.decisionId || '').localeCompare(String(right?.decisionId || ''))
  ));

  for (const trace of orderedTraces) {
    const actionId = trace?.correlation?.actionId
      || trace?.actionLifecycle?.acquisition?.actionId
      || trace?.actionLifecycle?.release?.actionId
      || trace?.activeAction?.actionId
      || null;
    if (!actionId || (targetActionIds.size > 0 && !targetActionIds.has(actionId))) continue;
    if (!records.has(actionId)) {
      records.set(actionId, {
        label: null,
        owner: null,
        ownerPriority: null,
        intent: null,
        routeOrigin: null,
        selectedSkill: null,
        args: [],
        acquisition: null,
        release: null,
        outcome: null,
        outcomeLinked: false,
      });
    }
    const record = records.get(actionId);
    const active = trace?.activeAction;
    const correlation = trace?.correlation;
    const acquisition = trace?.actionLifecycle?.acquisition;
    const release = trace?.actionLifecycle?.release;
    const outcome = trace?.outcome;
    if (typeof active?.label === 'string') record.label = active.label;
    if (typeof active?.owner === 'string') record.owner = active.owner;
    if (Number.isFinite(active?.ownerPriority)) record.ownerPriority = active.ownerPriority;
    if (typeof active?.intent === 'string') record.intent = active.intent;
    if (typeof correlation?.routeOrigin === 'string') record.routeOrigin = correlation.routeOrigin;
    if (typeof correlation?.selectedSkill === 'string') record.selectedSkill = correlation.selectedSkill;
    if (Array.isArray(correlation?.args)) record.args = correlation.args.map(stableArgument);
    if (plain(acquisition)) {
      record.acquisition = {
        owner: typeof acquisition.owner === 'string' ? acquisition.owner : null,
        ownerPriority: Number.isFinite(acquisition.ownerPriority) ? acquisition.ownerPriority : null,
        source: typeof acquisition.source === 'string' ? acquisition.source : null,
      };
    }
    if (plain(release)) {
      record.release = {
        owner: typeof release.owner === 'string' ? release.owner : null,
        ownerPriority: Number.isFinite(release.ownerPriority) ? release.ownerPriority : null,
        phase: typeof release.phase === 'string' ? release.phase : null,
        code: typeof release.code === 'string' ? release.code : null,
      };
    }
    if (plain(outcome)) {
      record.outcome = {
        phase: typeof outcome.phase === 'string' ? outcome.phase : null,
        code: typeof outcome.code === 'string' ? outcome.code : null,
      };
    }
    record.outcomeLinked ||= correlation?.outcomeLinked === true;
  }
  return { actions: [...records.values()] };
}

function normalizedPreflightEvidence(value) {
  if (!Array.isArray(value) || value.length === 0) {
    failVariance('preflight-on evidence must contain at least one structured result.');
  }
  return value.map((entry, index) => {
    if (!plain(entry)) failVariance(`preflight result ${index + 1} must be an object.`);
    const extra = Object.keys(entry).find(key => !PREFLIGHT_RESULT_KEYS.has(key));
    if (extra) failVariance(`preflight result ${index + 1} contains volatile or unknown field ${extra}.`);
    for (const field of ['owner', 'operation', 'status']) {
      if (typeof entry[field] !== 'string' || !entry[field].trim()) {
        failVariance(`preflight result ${index + 1} requires ${field}.`);
      }
    }
    for (const field of ['conclusive', 'retryable']) {
      if (entry[field] !== undefined && entry[field] !== null && typeof entry[field] !== 'boolean') {
        failVariance(`preflight result ${index + 1} ${field} must be boolean or null.`);
      }
    }
    if (
      entry.resultFingerprint !== undefined
      && entry.resultFingerprint !== null
      && !SHA256.test(entry.resultFingerprint)
    ) failVariance(`preflight result ${index + 1} resultFingerprint must be SHA-256 or null.`);
    return {
      owner: entry.owner,
      operation: entry.operation,
      status: entry.status,
      code: typeof entry.code === 'string' ? entry.code : null,
      conclusive: typeof entry.conclusive === 'boolean' ? entry.conclusive : null,
      retryable: typeof entry.retryable === 'boolean' ? entry.retryable : null,
      resultFingerprint: entry.resultFingerprint || null,
    };
  });
}

const OUTCOME_VOLATILE_KEY = /(?:at|utc|timestamp|duration|elapsed|latency|position|distance|travel|sample|waypoint|output|detail|message|path)$/i;

function normalizedAcceptanceValue(value, key = '') {
  if (OUTCOME_VOLATILE_KEY.test(key)) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const items = value
      .map(item => normalizedAcceptanceValue(item))
      .filter(item => item !== undefined);
    return items.length ? items : undefined;
  }
  if (!plain(value)) return undefined;
  const entries = Object.keys(value).sort().flatMap((childKey) => {
    const normalized = normalizedAcceptanceValue(value[childKey], childKey);
    return normalized === undefined ? [] : [[childKey, normalized]];
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function normalizedOutcomeResult(result) {
  if (!plain(result)) return null;
  return {
    label: typeof result.label === 'string' ? result.label : null,
    phase: typeof result.phase === 'string' ? result.phase : null,
    code: typeof result.code === 'string' ? result.code : null,
    retryable: result.retryable === true,
  };
}

function normalizedOutcomeEvidence(attempt, passed) {
  return {
    passed,
    terminal: normalizedOutcomeResult(attempt?.terminal),
    actions: orderedAttemptResults(attempt).map(normalizedOutcomeResult),
    physicalAcceptance: normalizedAcceptanceValue(attempt?.physicalAcceptance) || null,
  };
}

function postIssueMeasurements(attempt) {
  const issuedAt = Number(attempt?.issuedAt);
  return (Array.isArray(attempt?.modelMeasurements) ? attempt.modelMeasurements : [])
    .filter(measurement => (
      !Number.isFinite(issuedAt)
      || !Number.isFinite(measurement?.sampledAt)
      || measurement.sampledAt >= issuedAt
    ));
}

function settledAfterAttempt(attempt) {
  const samples = attempt?.stop?.stableSamples;
  return Number.isFinite(attempt?.stop?.settledAt)
    && attempt?.stop?.stableForTenSeconds === true
    && Array.isArray(samples)
    && samples.length > 0
    && samples.every(sample => (
      sample?.held === true
      && sample?.idle === true
      && !sample?.pathfinding
      && sample?.stopTimedOutAt === null
    ));
}

function observedFixtureFingerprints(report, explicit) {
  return [...new Set([
    explicit,
    report?.fixture_metadata_sha256,
    report?.source_archive_sha256,
  ].filter(value => SHA256.test(value || '')))];
}

function verifiedRecordedTrace({
  report,
  caseId,
  expectedDriverFingerprint,
  observedDriverFingerprint,
  measurements,
  measurement,
}) {
  const evidence = report?.recorded_trace;
  if (!plain(evidence) || evidence.schemaVersion !== 'scenario-lab.recorded-trace-provider.v1') {
    failVariance('recorded-trace mode has no compatible local-provider evidence.');
  }
  if (evidence.caseId !== caseId || evidence.complete !== true) {
    failVariance('the local recorded provider did not complete the declared case.');
  }
  if (
    evidence.driverFingerprint !== expectedDriverFingerprint
    || (observedDriverFingerprint !== null && observedDriverFingerprint !== evidence.driverFingerprint)
  ) {
    failVariance('the local recorded provider does not match the declared trace driver.');
  }
  if (
    evidence.endpoint?.host !== '127.0.0.1'
    || report?.recorded_trace_profile?.api !== 'openai_compatible'
    || report?.recorded_trace_profile?.url !== evidence.endpoint?.baseUrl
  ) {
    failVariance('recorded-trace mode was not confined to the declared loopback compatible endpoint.');
  }
  const completeMeasurements = measurements.filter(entry => (
    SHA256.test(entry?.modelConfigFingerprint || '')
    && SHA256.test(entry?.inputFingerprint || '')
    && SHA256.test(entry?.outputFingerprint || '')
    && SHA256.test(entry?.modelRouteFingerprint || '')
  ));
  if (completeMeasurements.length !== 1 || !measurement) {
    failVariance('recorded-trace mode must produce exactly one complete prompt measurement.');
  }
  const requests = Array.isArray(evidence.requests) ? evidence.requests : [];
  const request = requests.length === 1 ? requests[0] : null;
  if (
    !plain(request)
    || request.accepted !== true
    || request.matchedCaseRequest !== true
    || request.inputFingerprint !== measurement.initialInputFingerprint
    || request.responseFingerprint !== measurement.outputFingerprint
    || evidence.expectedResponseFingerprint !== measurement.outputFingerprint
  ) {
    failVariance('the recorded provider request or response disagrees with runtime model telemetry.');
  }
  if (
    evidence.modelConfigFingerprint !== measurement.modelConfigFingerprint
    || evidence.modelRouteFingerprint !== measurement.modelRouteFingerprint
  ) {
    failVariance('the recorded provider profile or selected route disagrees with runtime model telemetry.');
  }
  return {
    driverFingerprint: evidence.driverFingerprint,
    inputFingerprint: measurement.initialInputFingerprint,
  };
}

/** Convert one isolated, completed harness report into the canonical Phase 5
 *  matrix cell. Generated identifiers and timing measurements are used only to
 *  order or validate evidence; they never enter the behavior fingerprints. */
export function createVarianceObservation({
  varianceCase,
  runId,
  trial,
  executionMode,
  telemetryMode,
  preflightMode,
  resetId,
  report,
  observedFixtureFingerprint = null,
  observedInputFingerprint = null,
  observedDriverFingerprint = null,
  settledBefore = false,
  preflightEvidence = undefined,
} = {}) {
  if (!plain(varianceCase)) failVariance('varianceCase is required.');
  const caseId = requireVarianceId(varianceCase.id, 'varianceCase.id');
  for (const field of [
    'fixtureFingerprint',
    'inputFingerprint',
    'recordedTraceFingerprint',
    'frozenModelFingerprint',
  ]) requireFingerprint(varianceCase[field], `varianceCase.${field}`);
  requireVarianceId(runId, 'runId');
  requireVarianceId(resetId, 'resetId');
  if (!Number.isSafeInteger(trial) || trial < 1) failVariance('trial must be a positive integer.');
  requireMode(executionMode, 'executionMode', VARIANCE_EXECUTION_MODES);
  requireMode(telemetryMode, 'telemetryMode', VARIANCE_OBSERVER_MODES);
  requireMode(preflightMode, 'preflightMode', VARIANCE_OBSERVER_MODES);
  if (!plain(report)) failVariance('a completed harness report is required.');
  const harness = report.harness_evidence;
  const attempts = Array.isArray(harness?.attempts) ? harness.attempts : [];
  if (attempts.length !== 1) failVariance('the isolated report must contain exactly one attempt.');
  const attempt = attempts[0];
  if (!plain(attempt) || attempt.incomplete === true) failVariance('the isolated attempt is incomplete.');
  if (!instrumentationModeConfirmed(report, telemetryMode)) {
    failVariance(`runtime instrumentation did not prove telemetry mode ${telemetryMode}.`);
  }
  if (!harnessCleanupSafe(harness) || !runtimeCleanupSafe(report.cleanup)) {
    failVariance('fixture or runtime cleanup was not proven complete.');
  }
  if (settledBefore !== true) failVariance('the pre-run physical boundary was not settled.');
  if (!settledAfterAttempt(attempt)) failVariance('the post-run physical boundary was not settled.');
  if (!observedFixtureFingerprints(report, observedFixtureFingerprint)
    .includes(varianceCase.fixtureFingerprint)) {
    failVariance('the observed fixture does not match the declared case fixture.');
  }

  const modelMeasurements = postIssueMeasurements(attempt);
  const modelMeasurement = latestCompleteModelMeasurement(attempt);
  let driverFingerprint;
  let modelOutputFingerprint = null;
  let modelRouteFingerprint = null;
  let inputFingerprint = observedInputFingerprint;
  if (executionMode === 'recorded-trace') {
    const recorded = verifiedRecordedTrace({
      report,
      caseId,
      expectedDriverFingerprint: varianceCase.recordedTraceFingerprint,
      observedDriverFingerprint,
      measurements: modelMeasurements,
      measurement: modelMeasurement,
    });
    driverFingerprint = recorded.driverFingerprint;
    if (inputFingerprint !== null && inputFingerprint !== recorded.inputFingerprint) {
      failVariance('the supplied input fingerprint disagrees with recorded-provider telemetry.');
    }
    inputFingerprint = recorded.inputFingerprint;
  } else {
    if (!modelMeasurement) failVariance('frozen-model mode has no complete post-request model measurement.');
    if (
      observedInputFingerprint !== null
      && observedInputFingerprint !== modelMeasurement.initialInputFingerprint
    ) failVariance('the supplied input fingerprint disagrees with model telemetry.');
    if (
      observedDriverFingerprint !== null
      && observedDriverFingerprint !== modelMeasurement.modelConfigFingerprint
    ) failVariance('the supplied driver fingerprint disagrees with model telemetry.');
    inputFingerprint = modelMeasurement.initialInputFingerprint;
    driverFingerprint = modelMeasurement.modelConfigFingerprint;
    modelOutputFingerprint = modelMeasurement.outputFingerprint;
    modelRouteFingerprint = modelMeasurement.modelRouteFingerprint;
  }
  if (inputFingerprint !== varianceCase.inputFingerprint) {
    failVariance('the observed input does not match the declared clean-t0 input.');
  }
  const expectedDriver = executionMode === 'recorded-trace'
    ? varianceCase.recordedTraceFingerprint
    : varianceCase.frozenModelFingerprint;
  if (driverFingerprint !== expectedDriver) {
    failVariance('the observed execution driver does not match the declared case driver.');
  }

  if (telemetryMode === 'off' && Array.isArray(attempt.traces) && attempt.traces.length > 0) {
    failVariance('telemetry-off mode contains decision traces.');
  }
  const lifecycleFingerprint = telemetryMode === 'on'
    ? varianceFingerprint(normalizedLifecycleEvidence(attempt))
    : null;
  const effectivePreflightEvidence = preflightEvidence === undefined
    ? attempt?.preflightEvidence ?? null
    : preflightEvidence;
  if (preflightMode === 'off' && effectivePreflightEvidence !== null) {
    failVariance('preflight-off mode contains preflight evidence.');
  }
  const preflightFingerprint = preflightMode === 'on'
    ? varianceFingerprint(normalizedPreflightEvidence(effectivePreflightEvidence))
    : null;
  const passed = attempt.passed === true
    && harness?.passed === true
    && report.status === 'passed';
  const elapsedMs = Number(attempt?.performance?.durationMs ?? report?.verdict?.duration_ms);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    failVariance('elapsed time is missing or invalid.');
  }

  return {
    runId,
    caseId,
    trial,
    executionMode,
    telemetryMode,
    preflightMode,
    resetId,
    fixtureFingerprint: varianceCase.fixtureFingerprint,
    inputFingerprint,
    driverFingerprint,
    modelOutputFingerprint,
    modelRouteFingerprint,
    decisionFingerprint: varianceFingerprint(normalizedDecisionEvidence(attempt)),
    preflightFingerprint,
    lifecycleFingerprint,
    outcomeFingerprint: varianceFingerprint(normalizedOutcomeEvidence(attempt, passed)),
    passed,
    settledBefore: true,
    settledAfter: true,
    elapsedMs,
  };
}

export function classifyTerminalProviderFailure(value, { configuredProvider = null } = {}) {
  const text = String(value || '');
  const provider = configuredProvider === 'openai'
    ? 'openai-api'
    : (configuredProvider || 'configured-model-provider');
  if (/credit_balance_exhausted|insufficient_quota|no credits remaining/i.test(text)) {
    return {
      provider: 'openai-api',
      code: 'credit_balance_exhausted',
      detail: 'The configured OpenAI API project has no usable credit or spend allowance.',
    };
  }
  if (/Codex quota or rate limit was reached|\bQUOTA\b/i.test(text)) {
    return {
      provider: 'codex',
      code: 'codex_quota',
      detail: 'The logged-in ChatGPT account reached its Codex quota or rate limit.',
    };
  }
  if (/Codex ChatGPT login is unavailable|\bAUTH_REQUIRED\b/i.test(text)) {
    return {
      provider: 'codex',
      code: 'codex_auth_required',
      detail: 'Codex ChatGPT authentication is unavailable; run codex login and verify the active account.',
    };
  }
  if (/rate_limit_exceeded|too many requests|\b429\b/i.test(text)) {
    return {
      provider,
      code: 'provider_rate_limit',
      detail: 'The configured model provider rejected the request because its rate limit was reached.',
    };
  }
  if (/billing|payment required|\b402\b/i.test(text)) {
    return {
      provider,
      code: 'provider_billing_required',
      detail: 'The configured model provider rejected the request because billing is unavailable or requires attention.',
    };
  }
  if (
    /invalid_api_key|incorrect api key|authentication_error/i.test(text)
    || (configuredProvider && /not authenticated|unauthorized|\b401\b/i.test(text))
  ) {
    return {
      provider,
      code: 'provider_auth_required',
      detail: 'The configured model provider rejected its current authentication.',
    };
  }
  if (/all model routes failed|no usable model route|unsupported model provider|provider routing failed/i.test(text)) {
    return {
      provider,
      code: 'model_route_failed',
      detail: 'The configured model route could not produce a response.',
    };
  }
  return null;
}

const DELIVER_TERMINAL_SKILL = '!givePlayer';
const DELIVER_ACQUISITION_LABEL = 'action:collectBlocksInRange';
const DELIVER_RECIPIENT = 'FollowTarget';
const ROUTE_PROBE_SKILL = '!goToCoordinates';
const ROUTE_PROBE_ARGS = Object.freeze([1038, 100, 1013, 0, true]);

function deliveryContract(course) {
  return course === 'orchestrate-charcoal'
    ? Object.freeze({ routeOrigin: 'mission-director', item: 'charcoal', quantity: 8, mission: true })
    : Object.freeze({ routeOrigin: 'goal-director', item: 'dirt', quantity: 1, mission: false });
}

/** Which course a report describes. Reads the fixture block first because it
 *  survives an attempt that failed before physicalAcceptance was assembled. */
function courseOf(report) {
  const harness = report?.harness_evidence;
  return harness?.fixture?.courseVariant
    || harness?.attempts?.[0]?.physicalAcceptance?.course
    || null;
}

function deliverRequestCorrelated(attempt, course) {
  const contract = deliveryContract(course);
  const actionId = attempt?.terminal?.actionId;
  const request = attempt?.terminal?.evidence?.request;
  const activity = attempt?.terminal?.evidence?.activity;
  const args = Array.isArray(request?.args) ? request.args : [];
  const requestMatches = Boolean(
    actionId
    && typeof request?.requestId === 'string'
    && request.requestId.length > 0
    && request?.routeOrigin === contract.routeOrigin
    && request?.selectedSkill === DELIVER_TERMINAL_SKILL
    && String(args[0] || '') === DELIVER_RECIPIENT
    && String(args[1] || '') === contract.item
    && Number(args[2]) === contract.quantity
  );
  if (!requestMatches || !contract.mission) return requestMatches;
  return typeof request?.missionId === 'string'
    && request.missionId.length > 0
    && typeof request?.activityId === 'string'
    && request.activityId.length > 0
    && activity?.missionId === request.missionId
    && activity?.activityId === request.activityId;
}

// The goal is a chain, so the lifecycle has to show both links: the acquisition
// actually succeeded, and the hand-over is the terminal act. Accepting the
// hand-over alone would pass a run where the companion gave away dirt it was
// already carrying.
function deliverLifecycleComplete(attempt, course) {
  const contract = deliveryContract(course);
  const terminal = attempt?.terminal;
  const acquisition = attempt?.results?.[DELIVER_ACQUISITION_LABEL];
  const issuedAt = attempt?.issuedAt;
  const activeAt = attempt?.activeAt;
  const startedAt = terminal?.startedAt;
  const finishedAt = terminal?.finishedAt;
  return attempt?.commandAck?.success === true
    && [issuedAt, activeAt, startedAt, finishedAt].every(Number.isFinite)
    && activeAt >= issuedAt
    && typeof terminal?.actionId === 'string'
    && terminal.actionId.length > 0
    && terminal?.label === 'action:givePlayer'
    && startedAt >= issuedAt
    && finishedAt >= startedAt
    && terminal?.phase === 'succeeded'
    && (contract.mission
      ? terminal?.evidence?.activity?.lifecycle === 'SUCCEEDED'
      : acquisition?.phase === 'succeeded' && Number(acquisition?.startedAt) >= issuedAt);
}

// The fixture premise. On the captured follow world every one of these is false
// and the run reports an ambiguous 'unreachable' instead; that is the whole
// reason this course could not pass before.
function deliverFixtureDry(attempt) {
  const physical = attempt?.physicalAcceptance;
  const probes = Array.isArray(physical?.deliveryDryLandProbes)
    ? physical.deliveryDryLandProbes
    : [];
  // orchestrate-charcoal places no source block on purpose: finding the wood is
  // the thing being measured. Requiring a placed source there would demand
  // evidence the course is designed not to produce.
  const sourceRequired = physical?.course === 'deliver-item';
  // The orchestration course lays no geometry at all, so wall and platform
  // evidence does not exist for it by design.

  return physical?.deliveryGroundPresent === true
    && physical?.deliveryDryLandVerified === true
    && (sourceRequired ? physical?.deliverySourcePresent === true : true)
    && physical?.fixtureVerified === true
    && probes.length === 4
    && probes.every((probe) => probe?.verified === true);
}

// The acceptance itself: the recipient physically holds more than it started
// with. A null baseline is a read failure, never zero -- treating it as zero
// would let the wait satisfy instantly on stock the recipient already had.
function deliverItemHandedOver(attempt, course) {
  const contract = deliveryContract(course);
  const physical = attempt?.physicalAcceptance;
  const baseline = physical?.deliveryBaseline;
  const final = physical?.deliveryFinal;
  return physical?.deliveryVerified === true
    && Number.isFinite(baseline)
    && Number.isFinite(final)
    && final >= baseline + contract.quantity
    && Number.isFinite(physical?.deliveryObservedAt);
}

function routeProbeStatus(terminal) {
  if (terminal?.code !== 'skill_route_unproven') return null;
  const match = String(terminal?.detail || '').match(
    /without a conclusive answer \((partial|timeout)\)/i,
  );
  return match ? match[1].toLowerCase() : null;
}

function routeProbeRequestCorrelated(attempt) {
  const actionId = attempt?.terminal?.actionId;
  const request = attempt?.terminal?.evidence?.request;
  const args = Array.isArray(request?.args) ? request.args : [];
  return Boolean(
    typeof actionId === 'string'
    && actionId.length > 0
    && typeof request?.requestId === 'string'
    && request.requestId.length > 0
    && request?.routeOrigin === 'explicit-command'
    && request?.selectedSkill === ROUTE_PROBE_SKILL
    && args.length === ROUTE_PROBE_ARGS.length
    && args.every((value, index) => value === ROUTE_PROBE_ARGS[index])
  );
}

function routeProbeLifecycleComplete(attempt) {
  const terminal = attempt?.terminal;
  const issuedAt = attempt?.issuedAt;
  const activeAt = attempt?.activeAt;
  const startedAt = terminal?.startedAt;
  const finishedAt = terminal?.finishedAt;
  return attempt?.commandAck?.success === true
    && [issuedAt, activeAt, startedAt, finishedAt].every(Number.isFinite)
    && activeAt >= issuedAt
    && activeAt <= finishedAt
    && startedAt >= issuedAt
    && finishedAt >= startedAt
    && terminal?.label === 'action:goToCoordinates'
    && terminal?.phase === 'failed'
    && terminal?.code === 'skill_route_unproven'
    && terminal?.retryable === true;
}

function routeProbeInconclusive(attempt) {
  const physical = attempt?.physicalAcceptance;
  const status = routeProbeStatus(attempt?.terminal);
  return (status === 'partial' || status === 'timeout')
    && physical?.routeProbeStatus === status
    && physical?.routeProbeConclusive === false
    && !/path_not_found|without finding a safe route/i.test(String(attempt?.terminal?.detail || ''));
}

function routeProbeDidNotMove(attempt) {
  const physical = attempt?.physicalAcceptance;
  const start = physical?.routeStartPosition;
  const final = physical?.routeFinalPosition;
  const botTravel = attempt?.performance?.botTrajectoryDistance;
  const settledDistance = [start?.x, start?.y, start?.z, final?.x, final?.y, final?.z]
    .every(Number.isFinite)
    ? Math.hypot(final.x - start.x, final.y - start.y, final.z - start.z)
    : Number.POSITIVE_INFINITY;
  return physical?.routeMovementAttempted === false
    && Number.isFinite(botTravel)
    && botTravel <= 0.1
    && settledDistance <= 0.1;
}

function routeProbeTerrainPreserved(attempt) {
  const physical = attempt?.physicalAcceptance;
  return physical?.fixtureVerified === true
    && physical?.routeTerrainIntact === true;
}

function requestCandidates(attempt) {
  const candidates = [];
  const terminalRequest = attempt?.terminal?.evidence?.request;
  if (terminalRequest && typeof terminalRequest === 'object') {
    candidates.push({
      ...terminalRequest,
      actionId: attempt?.terminal?.actionId,
    });
  }
  for (const trace of Array.isArray(attempt?.traces) ? attempt.traces : []) {
    if (trace?.correlation) candidates.push(trace.correlation);
    if (trace?.activeAction) candidates.push(trace.activeAction);
  }
  return candidates;
}

// Correlation proves the action came from THIS request. It deliberately does not
// assert which command the model chose, or which route it arrived by.
//
// It used to require selectedSkill '!followPlayer', args ['FollowTarget', 3] and
// routeOrigin 'deterministic-nl'. All three describe a deterministic regex table
// that model-first removes on purpose, and four registered commands legitimately
// serve "follow me". Asserting the name made this evidence unsatisfiable by
// construction the moment the architecture changed -- the same failure recorded
// in FIXTURES.md for August, where the scenario demanded evidence its own
// configuration forbade producing.
//
// This is not weaker. A command name proves an intention; doorway crossing,
// corridor progress, botTravel >= 7, targetTravel >= 12 and finalDistance <= 4.5
// prove the deed, they are asserted separately, and they cannot co-occur by
// accident. The accepted doorway and obstruction aggregates are indexed in
// docs/CAMPAIGN-RECORD.md.
function requestCorrelated(attempt) {
  const actionId = attempt?.terminal?.actionId;
  return Boolean(actionId && requestCandidates(attempt).some((candidate) => (
    candidate?.actionId === actionId
    && typeof candidate?.requestId === 'string'
    && candidate.requestId.length > 0
  )));
}

function instrumentationModeConfirmed(report, expectedMode) {
  if (expectedMode !== 'off' && expectedMode !== 'on') return false;
  const instrumentation = report?.instrumentation;
  const traceExpected = expectedMode === 'on';
  const schemaValid = traceExpected
    ? instrumentation?.observed_schema_version === 1
    : instrumentation?.observed_schema_version === null;
  return instrumentation?.requested_mode === expectedMode
    && instrumentation?.decision_trace_enabled === traceExpected
    && instrumentation?.observed_decision_trace_present === traceExpected
    && instrumentation?.verified === true
    && schemaValid;
}

function harnessCleanupSafe(harness) {
  return harness?.cleanup?.fixtureRestored === true
    && harness?.cleanup?.botHeld === true
    && harness?.cleanup?.targetDisconnected === true
    && harness?.fixture?.mobSpawning?.restored === true
    && harness?.cleanup?.success !== false;
}

function runtimeCleanupSafe(cleanup) {
  return cleanup?.configuration_restored === true
    && cleanup?.properties_restored === true
    && cleanup?.pre_run_memory_restored === true
    && Array.isArray(cleanup?.remaining_managed_java)
    && cleanup.remaining_managed_java.length === 0
    && cleanup?.remaining_recorded_trace_process !== true
    && Array.isArray(cleanup?.errors)
    && cleanup.errors.length === 0;
}

function sampleHealths(attempt) {
  const healths = [];
  for (const collection of [attempt?.samples, attempt?.stop?.stableSamples]) {
    for (const sample of Array.isArray(collection) ? collection : []) {
      const health = sample?.health;
      if (Number.isFinite(health)) healths.push(health);
    }
  }
  return healths;
}

function lifecycleComplete(attempt) {
  const terminal = attempt?.terminal;
  const issuedAt = attempt?.issuedAt;
  const activeAt = attempt?.activeAt;
  const startedAt = terminal?.startedAt;
  const finishedAt = terminal?.finishedAt;
  return attempt?.commandAck?.success === true
    && [issuedAt, activeAt, startedAt, finishedAt].every(Number.isFinite)
    && activeAt >= issuedAt
    && typeof terminal?.actionId === 'string'
    && terminal.actionId.length > 0
    && typeof terminal?.label === 'string'
    && terminal.label.startsWith('action:')
    && terminal?.phase === 'interrupted'
    && terminal?.code === 'interrupted'
    && startedAt >= issuedAt
    && finishedAt >= startedAt
    && activeAt <= finishedAt;
}

function doorwayComplete(attempt) {
  const position = attempt?.physicalAcceptance?.doorwayObservation?.position;
  return attempt?.physicalAcceptance?.fixtureVerified === true
    && attempt?.physicalAcceptance?.doorwayCrossed === true
    && [position?.x, position?.y, position?.z].every(Number.isFinite);
}

function corridorComplete(attempt) {
  const physical = attempt?.physicalAcceptance;
  const botTravel = attempt?.performance?.botTrajectoryDistance;
  const targetTravel = attempt?.performance?.targetTrajectoryDistance;
  const finalDistance = physical?.finalDistanceToTarget;
  // Both follow courses run the same corridor geometry and the same distance
  // thresholds. The obstruction course additionally requires proof that the
  // companion broke through the sealed doorway, so it is strictly stronger --
  // reaching the far waypoint without digging cannot satisfy it.
  const course = physical?.course;
  if (course !== 'doorway-corridor' && course !== 'obstruction-follow') return false;
  if (course === 'obstruction-follow' && physical?.obstructionDugThrough !== true) return false;
  return physical?.corridorCompleted === true
    && physical?.finalWaypointReached === true
    && [botTravel, targetTravel, finalDistance].every(Number.isFinite)
    && botTravel >= 7
    && targetTravel >= 12
    && finalDistance >= 0
    && finalDistance <= 4.5;
}

function terminalQuiescent(attempt, harness) {
  const quiescenceMs = attempt?.stop?.quiescenceMs;
  return Number.isFinite(quiescenceMs)
    && quiescenceMs >= 0
    && quiescenceMs <= 2000
    && attempt?.stop?.stableForTenSeconds === true
    && harnessCleanupSafe(harness);
}

export function observeFollowFieldRun(report, timeoutMs = 180000, instrumentationMode = 'off') {
  const form = report?.request_form;
  const expectedRoute = EXPECTED_ROUTE[form] || null;
  const harness = report?.harness_evidence;
  const attempts = Array.isArray(harness?.attempts) ? harness.attempts : [];
  const attempt = attempts.length === 1 ? attempts[0] : null;
  const course = courseOf(report);
  const deliverCourse = course === 'deliver-item' || course === 'orchestrate-charcoal';
  const routeProbeCourse = course === 'route-probe-inconclusive';
  const correlated = routeProbeCourse
    ? routeProbeRequestCorrelated(attempt)
    : deliverCourse
    ? deliverRequestCorrelated(attempt, course)
    : Boolean(expectedRoute && requestCorrelated(attempt));
  const instrumentationConfirmed = instrumentationModeConfirmed(report, instrumentationMode);
  const checks = routeProbeCourse
    ? {
        'request-correlation': correlated,
        'instrumentation-mode-confirmed': instrumentationConfirmed,
        'route-probe-lifecycle': routeProbeLifecycleComplete(attempt),
        'route-probe-inconclusive-confirmed': routeProbeInconclusive(attempt),
        'no-unproven-movement-confirmed': routeProbeDidNotMove(attempt),
        'terrain-preserved-confirmed': routeProbeTerrainPreserved(attempt),
        'terminal-quiescence-confirmed': terminalQuiescent(attempt, harness),
      }
    : deliverCourse
    ? {
        'request-correlation': correlated,
        'instrumentation-mode-confirmed': instrumentationConfirmed,
        'goal-action-lifecycle': deliverLifecycleComplete(attempt, course),
        'dry-land-fixture-confirmed': deliverFixtureDry(attempt),
        'item-delivered-to-recipient': deliverItemHandedOver(attempt, course),
        'terminal-quiescence-confirmed': terminalQuiescent(attempt, harness),
      }
    : {
        'request-correlation': correlated,
        'instrumentation-mode-confirmed': instrumentationConfirmed,
        'follow-action-lifecycle': lifecycleComplete(attempt),
        'doorway-crossing-confirmed': doorwayComplete(attempt),
        'corridor-progress-confirmed': corridorComplete(attempt),
        'terminal-quiescence-confirmed': terminalQuiescent(attempt, harness),
      };
  const observedEvidence = Object.entries(checks)
    .filter(([, verified]) => verified)
    .map(([id]) => id);

  const elapsedMs = report?.verdict?.duration_ms ?? harness?.durationMs;
  const elapsedValid = Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs <= timeoutMs;
  const healths = sampleHealths(attempt);
  const healthObserved = healths.length > 0;
  const death = healths.some((health) => health <= 0);
  const cleanupSafe = runtimeCleanupSafe(report?.cleanup);
  const claimedSuccess = report?.status === 'passed' || harness?.passed === true;
  const physicalAndAttributionComplete = Object.values(checks).every(Boolean);
  const verifiedOutcome = physicalAndAttributionComplete && healthObserved && !death;
  const falseSuccess = report?.verdict?.false_success_observed === true
    || (claimedSuccess && !verifiedOutcome);
  const safetyInvariantViolations = [];

  if (report?.fixture_authorized !== true) {
    safetyInvariantViolations.push('authorized-active-world-required');
  }
  if (report?.endpoints_local_only !== true) {
    safetyInvariantViolations.push('fixture-endpoints-local-only');
  }
  if (!instrumentationConfirmed) {
    safetyInvariantViolations.push('declared-instrumentation-mode-required');
  }
  if (!correlated) {
    safetyInvariantViolations.push('deterministic-local-request-route');
  }
  if (!elapsedValid) {
    safetyInvariantViolations.push('bounded-timeout');
  }
  if (falseSuccess) safetyInvariantViolations.push('no-false-success');
  if (!cleanupSafe) safetyInvariantViolations.push('runtime-restoration-required');

  const success = report?.status === 'passed'
    && report?.verdict?.passed === true
    && harness?.passed === true
    && attempt?.passed === true
    && attempts.length === 1
    && verifiedOutcome
    && cleanupSafe
    && !falseSuccess
    && !death;

  return {
    form,
    completed: Boolean(report?.finished_utc && report?.cleanup && harness?.finishedAt),
    success,
    observedEvidence: [...new Set(observedEvidence)].sort(),
    safetyInvariantViolations: [...new Set(safetyInvariantViolations)].sort(),
    unsafe: safetyInvariantViolations.length > 0,
    death,
    conflict: report?.conflict === true,
    timeout: !elapsedValid,
    retryCount: Number.isInteger(report?.verdict?.external_retry_count)
      ? report.verdict.external_retry_count
      : 0,
    terminalReason: success
      ? (routeProbeCourse
          ? 'route-probe-inconclusive-verified'
          : deliverCourse ? 'deliver-item-goal-verified' : 'doorway-corridor-follow-verified')
      : String(report?.error || attempt?.terminal?.code || 'follow-field-failed').slice(0, 240),
    // Which evidence contract this observation was judged against. The aggregate
    // reads it rather than assuming the follow set, so a deliver run is never
    // marked incomplete for missing doorway evidence it could not produce.
    evidenceSet: routeProbeCourse
      ? ROUTE_PROBE_EVIDENCE
      : deliverCourse ? DELIVER_FIELD_EVIDENCE : FOLLOW_FIELD_EVIDENCE,
    elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : 0,
    actionId: attempt?.terminal?.actionId || null,
    routeOrigin: routeProbeCourse ? 'explicit-command' : expectedRoute,
    // Which command the model actually chose, recorded for review rather than
    // asserted. A change here is worth a human look; it is not a failure.
    selectedSkill: attempt?.terminal?.evidence?.request?.selectedSkill || null,
    observedRouteOrigin: attempt?.terminal?.evidence?.request?.routeOrigin || null,
    instrumentationMode,
    routeCorrelated: correlated,
    checks,
  };
}

export function aggregateFollowFieldObservations(plan, observations) {
  const observedEvidence = [];
  const expectedEvidence = observations.find(({ evidenceSet }) => Array.isArray(evidenceSet))
    ?.evidenceSet
    || FOLLOW_FIELD_EVIDENCE;
  for (const evidenceId of expectedEvidence) {
    if (
      observations.length === plan.invocations.length
      && observations.every((observation) => observation.observedEvidence.includes(evidenceId))
    ) {
      observedEvidence.push(evidenceId);
    }
  }
  if (
    observations.length === plan.invocations.length
    && observations.every(({ completed }) => completed)
  ) {
    observedEvidence.push('canonical-outcome-envelope');
  }

  const safetyInvariantViolations = [...new Set(
    observations.flatMap((observation) => observation.safetyInvariantViolations),
  )].sort();
  const success = observations.length === plan.invocations.length
    && observations.every((observation) => observation.success);

  return {
    executed: observations.length > 0,
    completedInvocationCount: observations.filter(({ completed }) => completed).length,
    observedEvidence: [...new Set(observedEvidence)].sort(),
    safetyInvariantViolations,
    success,
    unsafe: observations.some(({ unsafe }) => unsafe),
    death: observations.some(({ death }) => death),
    conflict: observations.some(({ conflict }) => conflict),
    timeout: observations.some(({ timeout }) => timeout),
    retryCount: observations.reduce((total, observation) => total + observation.retryCount, 0),
    terminalReason: success
      ? 'all-request-forms-verified'
      : observations.find(({ success: passed }) => !passed)?.terminalReason || 'execution-incomplete',
    elapsedMs: observations.reduce((total, observation) => total + observation.elapsedMs, 0),
  };
}
