export const STONE_RECOVERY_CORE_EVIDENCE = Object.freeze([
  'no-safe-stance-observed',
  'bounded-recovery-selected',
  'wood-stage-verified',
  'stone-stage-verified',
]);

const EXPECTED_ROUTE = Object.freeze({
  direct: 'explicit-command',
  'natural-language': 'deterministic-nl',
});

function tracesFromSamples(samples) {
  const traces = [];
  for (const sample of Array.isArray(samples) ? samples : []) {
    const recent = sample?.action?.behaviorArbiter?.decisionTrace?.recent;
    if (Array.isArray(recent)) traces.push(...recent);
  }
  return traces;
}

function matchingCorrelation(samples, actionId, routeOrigin) {
  return tracesFromSamples(samples).some((trace) => {
    for (const candidate of [trace?.correlation, trace?.activeAction]) {
      if (
        candidate?.actionId === actionId
        && candidate?.requestId
        && candidate?.routeOrigin === routeOrigin
        && candidate?.selectedSkill === '!prepareTool'
        && candidate?.args?.[0] === 'stone_pickaxe'
      ) return true;
    }
    return false;
  });
}

function count(value, key) {
  return Number(value?.[key]) || 0;
}

function hasCleanRestoration(cleanup) {
  return cleanup?.configuration_restored === true
    && cleanup?.properties_restored === true
    && cleanup?.pre_run_memory_restored === true
    && Array.isArray(cleanup?.remaining_managed_java)
    && cleanup.remaining_managed_java.length === 0
    && Array.isArray(cleanup?.errors)
    && cleanup.errors.length === 0;
}

export function observeStoneRecoveryRun(report, samples, timeoutMs = 600000) {
  const form = report?.request_form;
  const expectedRoute = EXPECTED_ROUTE[form] || null;
  const terminal = report?.verdict?.terminal_result;
  const detail = String(terminal?.detail || '');
  const beforeCounts = report?.before?.inventory || {};
  const finalCounts = report?.final?.inventory || {};
  const routeCorrelated = Boolean(
    expectedRoute
    && terminal?.actionId
    && matchingCorrelation(samples, terminal.actionId, expectedRoute)
  );
  const checks = {
    'no-safe-stance-observed': /no_safe_stance/i.test(detail),
    'bounded-recovery-selected': /opening a bounded mining route/i.test(detail),
    'wood-stage-verified': count(beforeCounts, 'wooden_pickaxe') >= 1
      && count(beforeCounts, 'stone_pickaxe') === 0,
    'stone-stage-verified': count(finalCounts, 'stone_pickaxe') >= 1
      && report?.final?.main_hand === 'stone_pickaxe',
  };
  const observedEvidence = Object.entries(checks)
    .filter(([, verified]) => verified)
    .map(([id]) => id);
  if (form === 'direct' && routeCorrelated) observedEvidence.push('direct-request-correlated');
  if (form === 'natural-language' && routeCorrelated) {
    observedEvidence.push('deterministic-nl-request-correlated');
  }

  const elapsedMs = Number(report?.verdict?.duration_ms);
  const finalHealth = Number(report?.final?.health);
  const falseSuccess = report?.verdict?.false_success_observed === true;
  const cleanupSafe = hasCleanRestoration(report?.cleanup);
  const safetyInvariantViolations = [];
  if (report?.fixture_authorized !== true) {
    safetyInvariantViolations.push('authorized-active-world-required');
  }
  if (!routeCorrelated) safetyInvariantViolations.push('deterministic-local-request-route');
  if (!Number.isFinite(elapsedMs) || elapsedMs > timeoutMs) {
    safetyInvariantViolations.push('bounded-timeout');
  }
  if (falseSuccess) safetyInvariantViolations.push('no-false-success');
  if (!cleanupSafe) safetyInvariantViolations.push('runtime-restoration-required');

  const complete = report?.status === 'passed'
    && report?.verdict?.passed === true
    && terminal?.phase === 'succeeded'
    && terminal?.code === 'skill_prepared'
    && terminal?.label === 'action:prepareTool'
    && Object.values(checks).every(Boolean)
    && routeCorrelated
    && Number.isFinite(finalHealth)
    && finalHealth > 0
    && cleanupSafe
    && !falseSuccess;

  return {
    form,
    completed: Boolean(report?.finished_utc && report?.cleanup),
    success: complete,
    observedEvidence: [...new Set(observedEvidence)].sort(),
    safetyInvariantViolations: [...new Set(safetyInvariantViolations)].sort(),
    unsafe: safetyInvariantViolations.length > 0,
    death: Number.isFinite(finalHealth) && finalHealth <= 0,
    conflict: report?.conflict === true,
    timeout: !Number.isFinite(elapsedMs) || elapsedMs > timeoutMs,
    retryCount: Number.isInteger(report?.verdict?.external_retry_count)
      ? report.verdict.external_retry_count
      : 0,
    terminalReason: complete
      ? 'stone-pickaxe-verified'
      : String(report?.error || terminal?.code || 'stone-recovery-failed').slice(0, 240),
    elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : 0,
    actionId: terminal?.actionId || null,
    routeOrigin: expectedRoute,
    routeCorrelated,
    checks,
  };
}

export function aggregateStoneRecoveryObservations(plan, observations) {
  const byForm = new Map(observations.map((observation) => [observation.form, observation]));
  const observedEvidence = [];

  for (const evidenceId of STONE_RECOVERY_CORE_EVIDENCE) {
    if (observations.length === plan.invocations.length
      && observations.every((observation) => observation.observedEvidence.includes(evidenceId))) {
      observedEvidence.push(evidenceId);
    }
  }
  if (byForm.get('direct')?.observedEvidence.includes('direct-request-correlated')) {
    observedEvidence.push('direct-request-correlated');
  }
  if (byForm.get('natural-language')?.observedEvidence.includes('deterministic-nl-request-correlated')) {
    observedEvidence.push('deterministic-nl-request-correlated');
  }
  if (observations.length === plan.invocations.length && observations.every(({ completed }) => completed)) {
    observedEvidence.push('canonical-outcome-envelope');
  }

  const elapsedMs = observations.reduce((total, observation) => total + observation.elapsedMs, 0);
  const safetyInvariantViolations = [...new Set(
    observations.flatMap((observation) => observation.safetyInvariantViolations),
  )].sort();
  const completeCount = observations.filter(({ completed }) => completed).length;
  const success = observations.length === plan.invocations.length
    && observations.every((observation) => observation.success);

  return {
    executed: observations.length > 0,
    completedInvocationCount: completeCount,
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
    elapsedMs,
  };
}
