export const FOLLOW_FIELD_EVIDENCE = Object.freeze([
  'request-correlation',
  'instrumentation-mode-confirmed',
  'follow-action-lifecycle',
  'doorway-crossing-confirmed',
  'corridor-progress-confirmed',
  'terminal-quiescence-confirmed',
]);

const EXPECTED_ROUTE = Object.freeze({
  direct: 'explicit-command',
  'natural-language': 'deterministic-nl',
});

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

function requestCorrelated(attempt, expectedRoute) {
  const actionId = attempt?.terminal?.actionId;
  return Boolean(actionId && requestCandidates(attempt).some((candidate) => (
    candidate?.actionId === actionId
    && typeof candidate?.requestId === 'string'
    && candidate.requestId.length > 0
    && candidate?.routeOrigin === expectedRoute
    && candidate?.selectedSkill === '!followPlayer'
    && String(candidate?.args?.[0] || '') === 'FollowTarget'
    && candidate?.args?.[1] === 3
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
    && terminal?.label === 'action:followPlayer'
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
  return physical?.course === 'doorway-corridor'
    && physical?.corridorCompleted === true
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
  const correlated = Boolean(expectedRoute && requestCorrelated(attempt, expectedRoute));
  const instrumentationConfirmed = instrumentationModeConfirmed(report, instrumentationMode);
  const checks = {
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
      ? 'doorway-corridor-follow-verified'
      : String(report?.error || attempt?.terminal?.code || 'follow-field-failed').slice(0, 240),
    elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : 0,
    actionId: attempt?.terminal?.actionId || null,
    routeOrigin: expectedRoute,
    instrumentationMode,
    routeCorrelated: correlated,
    checks,
  };
}

export function aggregateFollowFieldObservations(plan, observations) {
  const observedEvidence = [];
  for (const evidenceId of FOLLOW_FIELD_EVIDENCE) {
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
