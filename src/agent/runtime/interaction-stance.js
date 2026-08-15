const SCHEMA_VERSION = 2;
const MAX_TEXT = 120;

export const INTERACTION_STANCE_FAILURE_STAGES = Object.freeze({
  NO_LEGAL_STANCE: 'no_legal_stance',
  PATH_NOT_FOUND: 'path_not_found',
  PATH_EXECUTION_FAILED: 'path_execution_failed',
  INTERACTION_REJECTED: 'interaction_rejected',
});

const FAILURE_STAGES = new Set(Object.values(INTERACTION_STANCE_FAILURE_STAGES));
const STATUSES = new Set(['ready', 'failed', 'confirmed', 'interrupted']);
const FUNCTIONAL_POSTCONDITION_STATUSES = new Set(['not_evaluated', 'confirmed', 'failed', 'unknown']);

function boundedText(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

function boundedInteger(value, fallback = 0, maximum = 4096) {
  return Number.isFinite(value)
    ? Math.max(0, Math.min(maximum, Math.floor(value)))
    : fallback;
}

function coordinate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (![value.x, value.y, value.z].every(Number.isFinite)) return null;
  return Object.freeze({
    x: Math.floor(value.x),
    y: Math.floor(value.y),
    z: Math.floor(value.z),
  });
}

function target(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const normalized = {
    ...(boundedText(value.name) ? { name: boundedText(value.name) } : {}),
    ...(boundedText(value.type) ? { type: boundedText(value.type) } : {}),
    ...(coordinate(value) || {}),
  };
  return Object.keys(normalized).length ? Object.freeze(normalized) : null;
}

function stage(status, code) {
  return Object.freeze({ status, code: boundedText(code, 'unknown') });
}

function functionalPostcondition(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const status = FUNCTIONAL_POSTCONDITION_STATUSES.has(source.status)
    ? source.status
    : 'not_evaluated';
  return Object.freeze({
    status,
    code: boundedText(source.code, status === 'not_evaluated' ? 'not_evaluated' : 'unknown'),
    target: target(source.target),
    expectedCount: boundedInteger(source.expectedCount),
    observedCount: boundedInteger(source.observedCount),
  });
}

function contractStages(receipt, postcondition) {
  const selected = receipt.target != null;
  const hasLegalStance = receipt.candidateCount > 0;
  const planned = ['already_at_stance', 'success'].includes(receipt.path.status)
    || receipt.failureStage === INTERACTION_STANCE_FAILURE_STAGES.PATH_EXECUTION_FAILED
    || receipt.failureStage === INTERACTION_STANCE_FAILURE_STAGES.INTERACTION_REJECTED
    || ['ready', 'confirmed'].includes(receipt.status);
  const executed = receipt.interaction.confirmed
    || ['ready', 'confirmed'].includes(receipt.status)
    || receipt.failureStage === INTERACTION_STANCE_FAILURE_STAGES.INTERACTION_REJECTED;
  return Object.freeze({
    selection: selected
      ? stage('confirmed', 'target_selected')
      : stage('unknown', 'target_unknown'),
    feasibility: receipt.failureStage === INTERACTION_STANCE_FAILURE_STAGES.NO_LEGAL_STANCE
      ? stage('failed', receipt.code)
      : hasLegalStance
        ? stage('confirmed', 'legal_stance_confirmed')
        : stage('unknown', 'legal_stance_unknown'),
    planning: receipt.failureStage === INTERACTION_STANCE_FAILURE_STAGES.PATH_NOT_FOUND
      ? stage('failed', receipt.code)
      : receipt.failureStage === INTERACTION_STANCE_FAILURE_STAGES.NO_LEGAL_STANCE
        ? stage('not_attempted', 'feasibility_failed')
        : planned
          ? stage('confirmed', receipt.path.status)
          : receipt.status === 'interrupted'
            ? stage('interrupted', 'interrupted')
            : stage('unknown', receipt.path.status),
    execution: receipt.failureStage === INTERACTION_STANCE_FAILURE_STAGES.PATH_EXECUTION_FAILED
      ? stage('failed', receipt.code)
      : [
          INTERACTION_STANCE_FAILURE_STAGES.NO_LEGAL_STANCE,
          INTERACTION_STANCE_FAILURE_STAGES.PATH_NOT_FOUND,
        ].includes(receipt.failureStage)
        ? stage('not_attempted', 'planning_not_confirmed')
        : executed
          ? stage('confirmed', 'stance_reached')
          : receipt.status === 'interrupted'
            ? stage('interrupted', 'interrupted')
            : stage('unknown', 'execution_unknown'),
    acknowledgement: receipt.interaction.confirmed
      ? stage('confirmed', 'interaction_confirmed')
      : receipt.failureStage === INTERACTION_STANCE_FAILURE_STAGES.INTERACTION_REJECTED
        ? stage('failed', receipt.code)
        : receipt.status === 'ready'
          ? stage('pending', 'interaction_pending')
          : receipt.status === 'interrupted'
            ? stage('interrupted', 'interrupted')
            : stage('not_attempted', 'interaction_not_attempted'),
    functionalPostcondition: postcondition,
  });
}

/**
 * A project-owned attribution receipt for one Minecraft interaction stance.
 * Mechanics remain delegated: this records what project validation,
 * Pathfinder, and Mineflayer/Paper each proved without inferring from prose.
 */
export function createInteractionStanceReceipt({
  kind = 'interaction',
  target: targetValue = null,
  status = 'failed',
  failureStage = null,
  code = 'unknown',
  candidateCount = 0,
  selectedStance = null,
  pathStatus = null,
  pathLength = 0,
  interactionAttempted = false,
  interactionConfirmed = false,
  functionalPostcondition: functionalPostconditionValue = null,
} = {}) {
  const normalizedStatus = STATUSES.has(status) ? status : 'failed';
  const normalizedFailureStage = normalizedStatus === 'failed' && FAILURE_STAGES.has(failureStage)
    ? failureStage
    : null;
  const postcondition = functionalPostcondition(functionalPostconditionValue);
  const receipt = {
    schemaVersion: SCHEMA_VERSION,
    kind: boundedText(kind, 'interaction'),
    target: target(targetValue),
    status: normalizedStatus,
    failureStage: normalizedFailureStage,
    code: boundedText(code, 'unknown'),
    candidateCount: boundedInteger(candidateCount),
    selectedStance: coordinate(selectedStance),
    path: Object.freeze({
      status: boundedText(pathStatus, 'not_attempted'),
      length: boundedInteger(pathLength, 0, 65_536),
    }),
    interaction: Object.freeze({
      attempted: interactionAttempted === true,
      confirmed: interactionConfirmed === true,
    }),
    functionalPostcondition: postcondition,
  };
  receipt.stages = contractStages(receipt, postcondition);
  return Object.freeze(receipt);
}

export function normalizeInteractionStanceReceipt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return createInteractionStanceReceipt({
    kind: value.kind,
    target: value.target,
    status: value.status,
    failureStage: value.failureStage,
    code: value.code,
    candidateCount: value.candidateCount,
    selectedStance: value.selectedStance,
    pathStatus: value.path?.status,
    pathLength: value.path?.length,
    interactionAttempted: value.interaction?.attempted,
    interactionConfirmed: value.interaction?.confirmed,
    functionalPostcondition: value.functionalPostcondition || value.stages?.functionalPostcondition,
  });
}

export function interactionStanceFailure(stage, detail = {}) {
  return createInteractionStanceReceipt({
    ...detail,
    status: 'failed',
    failureStage: stage,
    interactionAttempted: stage === INTERACTION_STANCE_FAILURE_STAGES.INTERACTION_REJECTED,
    interactionConfirmed: false,
  });
}

export function interactionStanceReady(detail = {}) {
  return createInteractionStanceReceipt({
    ...detail,
    status: 'ready',
    failureStage: null,
  });
}

export function interactionStanceConfirmed(receipt, detail = {}) {
  const current = normalizeInteractionStanceReceipt(receipt) || createInteractionStanceReceipt(detail);
  return createInteractionStanceReceipt({
    kind: detail.kind || current.kind,
    target: detail.target || current.target,
    status: 'confirmed',
    code: detail.code || 'interaction_confirmed',
    candidateCount: current.candidateCount,
    selectedStance: current.selectedStance,
    pathStatus: current.path.status,
    pathLength: current.path.length,
    interactionAttempted: true,
    interactionConfirmed: true,
    functionalPostcondition: detail.functionalPostcondition || current.functionalPostcondition,
  });
}

export function interactionStancePostconditionFailed(receipt, detail = {}) {
  const current = normalizeInteractionStanceReceipt(receipt) || createInteractionStanceReceipt(detail);
  return createInteractionStanceReceipt({
    kind: detail.kind || current.kind,
    target: detail.target || current.target,
    status: 'failed',
    failureStage: null,
    code: detail.code || 'functional_postcondition_failed',
    candidateCount: current.candidateCount,
    selectedStance: current.selectedStance,
    pathStatus: current.path.status,
    pathLength: current.path.length,
    interactionAttempted: true,
    interactionConfirmed: true,
    functionalPostcondition: detail.functionalPostcondition || {
      status: 'failed',
      code: detail.code || 'functional_postcondition_failed',
    },
  });
}

export function interactionStanceRejected(receipt, code = 'interaction_rejected') {
  const current = normalizeInteractionStanceReceipt(receipt) || createInteractionStanceReceipt();
  return interactionStanceFailure(INTERACTION_STANCE_FAILURE_STAGES.INTERACTION_REJECTED, {
    kind: current.kind,
    target: current.target,
    code,
    candidateCount: current.candidateCount,
    selectedStance: current.selectedStance,
    pathStatus: current.path.status,
    pathLength: current.path.length,
  });
}
