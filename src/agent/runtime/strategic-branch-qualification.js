import { createHash } from 'node:crypto';

const MAX_IDENTITY_LENGTH = 2_048;
const MAX_METHOD_ID_LENGTH = 160;
const MAX_BLOCKER_CLASS_LENGTH = 80;
const MAX_CANDIDATES = 64;
export const STRATEGIC_METHOD_ID_PATTERN = /^planner_method:v1:[a-f0-9]{64}$/;
const STRATEGIC_FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const MODEL_ELIGIBLE_BLOCKER_CLASSES = new Set(['terminal', 'capability_gap']);

function hasControlCharacters(value) {
  return [...value].some(character => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function strictBoundedString(value, maximum, pattern = null) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (
    !normalized
    || normalized !== value
    || normalized.length > maximum
    || hasControlCharacters(normalized)
    || (pattern && !pattern.test(normalized))
  ) return null;
  return normalized;
}

function immutableReceipt(fields) {
  return Object.freeze({
    schemaVersion: 2,
    ...fields,
    feasibleMethodIds: Object.freeze(fields.feasibleMethodIds || []),
  });
}

function normalizeCandidate(raw) {
  return Object.freeze({
    methodId: strictBoundedString(
      raw?.methodId,
      MAX_METHOD_ID_LENGTH,
      STRATEGIC_METHOD_ID_PATTERN,
    ),
    completionIdentity: strictBoundedString(raw?.completionIdentity, MAX_IDENTITY_LENGTH),
    feasible: typeof raw?.feasible === 'boolean' ? raw.feasible : null,
    planFingerprint: strictBoundedString(
      raw?.proof?.planFingerprint,
      64,
      STRATEGIC_FINGERPRINT_PATTERN,
    ),
  });
}

function normalizedFrontierEvidence({
  completionIdentity,
  enumerationComplete,
  candidates,
  rankingStatus,
  selectedMethodId,
} = {}) {
  const identity = strictBoundedString(completionIdentity, MAX_IDENTITY_LENGTH);
  if (!identity || typeof enumerationComplete !== 'boolean' || !Array.isArray(candidates)) return null;
  if (candidates.length > MAX_CANDIDATES) return null;
  const ranking = ['resolved', 'unresolved', 'unknown'].includes(rankingStatus)
    ? rankingStatus
    : null;
  if (!ranking) return null;
  const selected = selectedMethodId === null || selectedMethodId === undefined
    ? null
    : strictBoundedString(selectedMethodId, MAX_METHOD_ID_LENGTH, STRATEGIC_METHOD_ID_PATTERN);
  if (selectedMethodId !== null && selectedMethodId !== undefined && !selected) return null;
  const methods = candidates.map(normalizeCandidate);
  if (methods.some(method => (
    !method.methodId
    || !method.completionIdentity
    || method.completionIdentity !== identity
    || method.feasible === null
    || !method.planFingerprint
  ))) return null;
  return [
    'planner-method-frontier-v2',
    identity,
    enumerationComplete,
    ranking,
    selected,
    methods
      .map(method => [
        method.methodId,
        method.completionIdentity,
        method.feasible,
        method.planFingerprint,
      ])
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  ];
}

/**
 * Stable identity for the exact planner evidence consumed by BQ0.
 *
 * Method IDs intentionally describe material completion mechanisms. The
 * candidate proof fingerprint separately binds the executable plan for this
 * completion contract; this frontier fingerprint binds the whole candidate
 * set and ranking receipt without making candidate order authoritative.
 */
export function strategicFrontierFingerprint(evidence = {}) {
  const normalized = normalizedFrontierEvidence(evidence);
  if (!normalized) return null;
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

/**
 * Classify a planner-supplied method frontier without granting new authority.
 *
 * This function never enumerates methods and never infers completeness. The
 * planner must explicitly prove that deterministic recovery is exhausted, the
 * frontier is complete, every candidate preserves one completion identity,
 * and feasibility is known. Any missing proof fails closed.
 */
export function qualifyStrategicBranch({
  blockerClass,
  completionIdentity,
  deterministicRecoveryExhausted = false,
  enumerationComplete = false,
  candidates = [],
  frontierFingerprint = null,
  rankingStatus = 'unknown',
  selectedMethodId = null,
} = {}) {
  const identity = strictBoundedString(completionIdentity, MAX_IDENTITY_LENGTH);
  const normalizedBlockerClass = strictBoundedString(blockerClass, MAX_BLOCKER_CLASS_LENGTH);
  const normalizedFrontierFingerprint = strictBoundedString(
    frontierFingerprint,
    64,
    STRATEGIC_FINGERPRINT_PATTERN,
  );
  const normalizedRanking = ['resolved', 'unresolved'].includes(rankingStatus)
    ? rankingStatus
    : 'unknown';
  const methods = (Array.isArray(candidates) ? candidates : [])
    .slice(0, MAX_CANDIDATES)
    .map(normalizeCandidate);
  const receipt = (status, reasonCode, {
    strategicBranchEstablished = false,
    feasibleMethodIds = [],
    selected = null,
  } = {}) => immutableReceipt({
    status,
    reasonCode,
    strategicBranchEstablished,
    blockerClass: normalizedBlockerClass,
    completionIdentity: identity || null,
    frontierFingerprint: normalizedFrontierFingerprint,
    deterministicRecoveryExhausted: deterministicRecoveryExhausted === true,
    enumerationComplete: enumerationComplete === true,
    rankingStatus: normalizedRanking,
    candidateCount: methods.length,
    feasibleMethodCount: feasibleMethodIds.length,
    feasibleMethodIds,
    selectedMethodId: selected,
  });

  if (!identity) {
    return receipt('not_qualified', 'completion_identity_invalid');
  }
  if (!MODEL_ELIGIBLE_BLOCKER_CLASSES.has(normalizedBlockerClass)) {
    return receipt('not_qualified', 'blocker_class_ineligible');
  }
  if (deterministicRecoveryExhausted !== true) {
    return receipt('not_qualified', 'deterministic_recovery_not_exhausted');
  }
  if (enumerationComplete !== true) {
    return receipt('not_qualified', 'method_enumeration_incomplete');
  }
  if (!Array.isArray(candidates) || candidates.length > MAX_CANDIDATES) {
    return receipt('not_qualified', 'candidate_set_invalid');
  }
  if (methods.some(method => !method.methodId || !method.completionIdentity)) {
    return receipt('not_qualified', 'candidate_identity_invalid');
  }
  if (methods.some(method => method.completionIdentity !== identity)) {
    return receipt('not_qualified', 'completion_identity_mismatch');
  }
  if (methods.some(method => method.feasible === null)) {
    return receipt('not_qualified', 'candidate_feasibility_unknown');
  }
  if (methods.some(method => !method.planFingerprint)) {
    return receipt('not_qualified', 'candidate_proof_invalid');
  }
  const expectedFrontierFingerprint = strategicFrontierFingerprint({
    completionIdentity: identity,
    enumerationComplete: true,
    candidates,
    rankingStatus: normalizedRanking,
    selectedMethodId,
  });
  if (!normalizedFrontierFingerprint || !expectedFrontierFingerprint) {
    return receipt('not_qualified', 'frontier_fingerprint_invalid');
  }
  if (normalizedFrontierFingerprint !== expectedFrontierFingerprint) {
    return receipt('not_qualified', 'frontier_fingerprint_mismatch');
  }

  const feasibilityByMethod = new Map();
  const proofByMethod = new Map();
  for (const method of methods) {
    const prior = feasibilityByMethod.get(method.methodId);
    if (prior !== undefined && prior !== method.feasible) {
      return receipt('not_qualified', 'candidate_feasibility_conflict');
    }
    const priorProof = proofByMethod.get(method.methodId);
    if (priorProof !== undefined && priorProof !== method.planFingerprint) {
      return receipt('not_qualified', 'candidate_proof_conflict');
    }
    feasibilityByMethod.set(method.methodId, method.feasible);
    proofByMethod.set(method.methodId, method.planFingerprint);
  }
  const feasibleMethodIds = [...feasibilityByMethod]
    .filter(([, feasible]) => feasible)
    .map(([methodId]) => methodId)
    .sort();

  if (feasibleMethodIds.length === 0) {
    return receipt('capability_gap', 'no_feasible_method', { feasibleMethodIds });
  }
  if (feasibleMethodIds.length === 1) {
    return receipt('deterministic_method_available', 'one_feasible_method', {
      feasibleMethodIds,
      selected: feasibleMethodIds[0],
    });
  }
  if (normalizedRanking === 'resolved') {
    const selected = strictBoundedString(
      selectedMethodId,
      MAX_METHOD_ID_LENGTH,
      STRATEGIC_METHOD_ID_PATTERN,
    );
    if (!selected || !feasibleMethodIds.includes(selected)) {
      return receipt('not_qualified', 'deterministic_ranking_selection_invalid', {
        feasibleMethodIds,
      });
    }
    return receipt('deterministic_method_available', 'deterministic_ranking_resolved', {
      feasibleMethodIds,
      selected,
    });
  }
  if (normalizedRanking !== 'unresolved') {
    return receipt('not_qualified', 'deterministic_ranking_unknown', {
      feasibleMethodIds,
    });
  }
  return receipt('strategic_branch', 'multiple_feasible_methods_ranking_unresolved', {
    strategicBranchEstablished: true,
    feasibleMethodIds,
  });
}
