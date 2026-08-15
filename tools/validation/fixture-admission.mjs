const SCHEMA = 'fixture_admission.v1';
const STATUSES = new Set(['confirmed', 'failed', 'unknown']);
const MAX_CHECKS = 32;
const MAX_TEXT = 500;

function boundedText(value, maximum = MAX_TEXT) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function normalizedId(value, field) {
  const normalized = boundedText(value, 64).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(normalized)) {
    throw new TypeError(`${field} must be a bounded lowercase identifier.`);
  }
  return normalized;
}

function normalizedStatus(value) {
  const status = boundedText(value, 16).toLowerCase() || 'unknown';
  if (!STATUSES.has(status)) {
    throw new TypeError(`Unsupported fixture check status '${status}'.`);
  }
  return status;
}

function normalizeCheck(check, index) {
  if (!check || typeof check !== 'object' || Array.isArray(check)) {
    throw new TypeError(`Fixture check ${index} must be an object.`);
  }
  const status = normalizedStatus(check.status);
  return Object.freeze({
    id: normalizedId(check.id, `Fixture check ${index} id`),
    status,
    required: check.required !== false,
    code: boundedText(check.code, 80) || (
      status === 'confirmed' ? 'confirmed' : status === 'failed' ? 'fixture_invalid' : 'evidence_unknown'
    ),
    detail: boundedText(check.detail),
    source: boundedText(check.source, 120) || 'harness',
    observed: boundedText(check.observed),
  });
}

function requestChecks(request) {
  const present = request && typeof request === 'object' && !Array.isArray(request);
  const message = present && typeof request.message === 'string' ? request.message : '';
  const maximumLength = Number.isSafeInteger(request?.maximumLength)
    && request.maximumLength >= 1
    && request.maximumLength <= 4_096
    ? request.maximumLength
    : 256;
  const singleAuthorityUnit = present ? request.singleAuthorityUnit : undefined;
  const length = message.length;
  return {
    summary: Object.freeze({
      length,
      maximumLength,
      singleAuthorityUnit: singleAuthorityUnit === true,
    }),
    checks: [
      {
        id: 'request.present',
        status: !present ? 'unknown' : message.trim() ? 'confirmed' : 'failed',
        code: !present ? 'request_evidence_missing' : message.trim() ? 'request_present' : 'request_empty',
        detail: !present ? 'No request evidence was supplied.' : message.trim() ? 'The intended request is present.' : 'The intended request is empty.',
        source: 'request dispatch',
        observed: `length=${length}`,
      },
      {
        id: 'request.within_limit',
        status: !present ? 'unknown' : length <= maximumLength ? 'confirmed' : 'failed',
        code: !present ? 'request_evidence_missing' : length <= maximumLength ? 'request_within_limit' : 'request_too_large',
        detail: !present
          ? 'Request length is unknown.'
          : length <= maximumLength
            ? 'The request fits the declared transport boundary.'
            : 'The request exceeds the declared transport boundary.',
        source: 'request dispatch',
        observed: `length=${length} maximum=${maximumLength}`,
      },
      {
        id: 'request.single_authority_unit',
        status: !present || typeof singleAuthorityUnit !== 'boolean'
          ? 'unknown'
          : singleAuthorityUnit ? 'confirmed' : 'failed',
        code: !present || typeof singleAuthorityUnit !== 'boolean'
          ? 'request_authority_unknown'
          : singleAuthorityUnit ? 'single_authority_unit' : 'request_fragmented',
        detail: !present || typeof singleAuthorityUnit !== 'boolean'
          ? 'Request authority-unit evidence is missing.'
          : singleAuthorityUnit
            ? 'The request will be delivered as one authority unit.'
            : 'The request would be split across authority units.',
        source: 'request dispatch',
        observed: typeof singleAuthorityUnit === 'boolean' ? String(singleAuthorityUnit) : 'unknown',
      },
    ],
  };
}

export function fixtureCheckStatus(value) {
  return value === true ? 'confirmed' : value === false ? 'failed' : 'unknown';
}

/**
 * Lifecycle callbacks are advisory. The authoritative managed state may prove
 * that the requested setup effect occurred even when its callback was delayed
 * or lost. Callers must still bound the authoritative reconciliation window;
 * an unresolved result remains unknown and therefore fails fixture admission.
 */
export function reconcileAdvisorySetupAcknowledgement(acknowledgement, authoritativeReady) {
  const acknowledged = acknowledgement?.success === true;
  const rejected = acknowledgement?.success === false;
  if (authoritativeReady === true) {
    return Object.freeze({
      status: 'confirmed',
      code: acknowledged ? 'setup_acknowledged' : 'setup_authoritatively_reconciled',
      acknowledgement: acknowledged ? 'confirmed' : rejected ? 'rejected' : 'missing',
      authoritativeState: 'confirmed',
    });
  }
  if (rejected || authoritativeReady === false) {
    return Object.freeze({
      status: 'failed',
      code: rejected ? 'setup_explicitly_rejected' : 'setup_authoritatively_failed',
      acknowledgement: rejected ? 'rejected' : acknowledged ? 'confirmed' : 'missing',
      authoritativeState: authoritativeReady === false ? 'failed' : 'unknown',
    });
  }
  return Object.freeze({
    status: 'unknown',
    code: 'setup_reconciliation_unknown',
    acknowledgement: acknowledged ? 'confirmed' : 'missing',
    authoritativeState: 'unknown',
  });
}

export function createFixtureAdmissionReceipt({
  id = 'fixture',
  observedAt = Date.now(),
  request = null,
  checks = [],
} = {}) {
  if (!Array.isArray(checks)) throw new TypeError('Fixture checks must be an array.');
  const requestEvidence = requestChecks(request);
  const combined = [...checks, ...requestEvidence.checks];
  if (combined.length > MAX_CHECKS) {
    throw new RangeError(`Fixture admission accepts at most ${MAX_CHECKS} checks.`);
  }
  const normalizedChecks = combined.map(normalizeCheck);
  const seen = new Set();
  for (const check of normalizedChecks) {
    if (seen.has(check.id)) throw new TypeError(`Duplicate fixture check '${check.id}'.`);
    seen.add(check.id);
  }

  const required = normalizedChecks.filter(check => check.required);
  const failedCheckIds = required.filter(check => check.status === 'failed').map(check => check.id);
  const unknownCheckIds = required.filter(check => check.status === 'unknown').map(check => check.id);
  const admitted = failedCheckIds.length === 0 && unknownCheckIds.length === 0;
  const outcome = admitted
    ? 'admitted'
    : failedCheckIds.length > 0 ? 'fixture_invalid' : 'fixture_unknown';

  return Object.freeze({
    schema: SCHEMA,
    id: normalizedId(id, 'Fixture id'),
    observedAt: Number.isFinite(Number(observedAt)) ? Math.floor(Number(observedAt)) : 0,
    outcome,
    admitted,
    request: requestEvidence.summary,
    checks: Object.freeze(normalizedChecks),
    failedCheckIds: Object.freeze(failedCheckIds),
    unknownCheckIds: Object.freeze(unknownCheckIds),
  });
}

export class FixtureAdmissionError extends Error {
  constructor(receipt) {
    const blocking = [...receipt.failedCheckIds, ...receipt.unknownCheckIds];
    super(`Fixture admission ${receipt.outcome}: ${blocking.join(', ') || 'no confirmed checks'}.`);
    this.name = 'FixtureAdmissionError';
    this.code = receipt.outcome;
    this.receipt = receipt;
  }
}

export function requireFixtureAdmission(receipt) {
  if (!receipt || receipt.schema !== SCHEMA || !Object.isFrozen(receipt)) {
    throw new TypeError('Fixture admission requires a normalized immutable receipt.');
  }
  if (!receipt.admitted) throw new FixtureAdmissionError(receipt);
  return receipt;
}
