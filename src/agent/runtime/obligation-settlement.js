const SETTLEMENT_SCHEMA_VERSION = 1;
const BLOCKER_SCHEMA_VERSION = 1;
const SAMPLE_CLASSES = new Set(['success', 'method_failure', 'censored', 'unknown']);
const RELEASE_PREDICATES = new Set([
  'dimension',
  'position_region',
  'target_signature',
  'inventory_signature',
  'world_signature',
  'cycle_signature',
]);

function boundedText(value, maximum = 96) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex -- Durable settlement fields must remain wire-safe.
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function finitePosition(value) {
  if (!value || ![value.x, value.y, value.z].every(Number.isFinite)) return null;
  return Object.freeze({
    x: Number(value.x),
    y: Number(value.y),
    z: Number(value.z),
  });
}

function optionalSignature(value) {
  const normalized = boundedText(value, 160);
  return normalized || null;
}

function optionalBoolean(value) {
  return typeof value === 'boolean' ? value : null;
}

function distance(left, right) {
  if (!left || !right) return null;
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

export function classifyObligationSettlement({
  sampleClass = 'unknown',
  externalWait = false,
  methodRetryable = null,
  retryAuthority = null,
  materialChanged = null,
  budgetAvailable = null,
  supportedAlternative = false,
} = {}) {
  const normalizedSample = SAMPLE_CLASSES.has(sampleClass) ? sampleClass : 'unknown';
  const facts = Object.freeze({
    sampleClass: normalizedSample,
    methodRetryable: optionalBoolean(methodRetryable),
    retryAuthority: optionalBoolean(retryAuthority),
    materialChanged: optionalBoolean(materialChanged),
    budgetAvailable: optionalBoolean(budgetAvailable),
  });
  const result = (state, {
    chargeAttempt = false,
    preserveObligation = true,
    redispatch = false,
  } = {}) => Object.freeze({
    schemaVersion: SETTLEMENT_SCHEMA_VERSION,
    state,
    chargeAttempt,
    preserveObligation,
    redispatch,
    facts,
  });

  if (normalizedSample === 'success') {
    return result('complete', { preserveObligation: false });
  }
  if (normalizedSample === 'censored') {
    return result('censored');
  }
  if (externalWait === true) {
    return result('waiting');
  }
  if (normalizedSample === 'unknown') {
    return result('waiting');
  }
  if (supportedAlternative === true) {
    return result('supported_alternative', { chargeAttempt: true });
  }
  if (
    facts.methodRetryable === false
    || facts.retryAuthority === false
    || facts.budgetAvailable === false
  ) {
    return result('terminal_failure', {
      chargeAttempt: true,
      preserveObligation: false,
    });
  }
  if (
    facts.methodRetryable === null
    || facts.retryAuthority === null
    || facts.budgetAvailable === null
  ) {
    return result('waiting', { chargeAttempt: true });
  }
  if (facts.materialChanged !== true) {
    return result('waiting_for_material_change', { chargeAttempt: true });
  }
  return result('retry_authorized', {
    chargeAttempt: true,
    redispatch: true,
  });
}

export function createMaterialChangeBlocker({
  owner,
  obligationId,
  code,
  checkpoint = {},
  releasePredicates = [],
  positionRegionDistance = 8,
  // A blocker with no time bound releases only when the world changes, which
  // can be never: a companion that failed to path to its player would stand
  // still until the player walked eight blocks away. `holdMs` bounds the wait
  // so an explicit directive always gets retried. 0 keeps the original
  // world-only behaviour for owners that genuinely want it.
  holdMs = 0,
  createdAt = null,
} = {}) {
  const predicates = [...new Set((Array.isArray(releasePredicates) ? releasePredicates : [])
    .map(value => boundedText(value, 40))
    .filter(value => RELEASE_PREDICATES.has(value)))]
    .slice(0, RELEASE_PREDICATES.size);
  if (predicates.length === 0) return null;
  const normalizedCheckpoint = Object.freeze({
    position: finitePosition(checkpoint.position),
    dimension: optionalSignature(checkpoint.dimension),
    targetSignature: optionalSignature(checkpoint.targetSignature),
    inventorySignature: optionalSignature(checkpoint.inventorySignature),
    worldSignature: optionalSignature(checkpoint.worldSignature),
    cycleSignature: optionalSignature(checkpoint.cycleSignature),
  });
  const boundedHoldMs = Math.max(0, Math.min(600_000, Number(holdMs) || 0));
  const numericCreatedAt = Number(createdAt);
  return Object.freeze({
    schemaVersion: BLOCKER_SCHEMA_VERSION,
    owner: boundedText(owner, 48) || 'unknown',
    obligationId: boundedText(obligationId, 96) || 'unknown',
    code: boundedText(code, 80) || 'method_failure',
    checkpoint: normalizedCheckpoint,
    releasePredicates: Object.freeze(predicates),
    positionRegionDistance: Math.max(1, Math.min(64, Number(positionRegionDistance) || 8)),
    holdMs: boundedHoldMs,
    createdAt: Number.isFinite(numericCreatedAt) ? numericCreatedAt : null,
  });
}

export function normalizeMaterialChangeBlocker(value) {
  if (value?.schemaVersion !== BLOCKER_SCHEMA_VERSION) return null;
  return createMaterialChangeBlocker({
    owner: value.owner,
    obligationId: value.obligationId,
    code: value.code,
    checkpoint: value.checkpoint,
    releasePredicates: value.releasePredicates,
    positionRegionDistance: value.positionRegionDistance,
    holdMs: value.holdMs,
    createdAt: value.createdAt,
  });
}

export function evaluateMaterialChange(blockerValue, observation = {}, { now = null } = {}) {
  const blocker = normalizeMaterialChangeBlocker(blockerValue);
  if (!blocker) {
    return Object.freeze({
      schemaVersion: BLOCKER_SCHEMA_VERSION,
      state: 'unknown',
      materialChanged: null,
      changedBy: Object.freeze([]),
      unknownPredicates: Object.freeze(['blocker']),
    });
  }
  const current = {
    position: finitePosition(observation.position),
    dimension: optionalSignature(observation.dimension),
    targetSignature: optionalSignature(observation.targetSignature),
    inventorySignature: optionalSignature(observation.inventorySignature),
    worldSignature: optionalSignature(observation.worldSignature),
    cycleSignature: optionalSignature(observation.cycleSignature),
  };
  const changedBy = [];
  const unknownPredicates = [];
  for (const predicate of blocker.releasePredicates) {
    if (predicate === 'position_region') {
      const moved = distance(blocker.checkpoint.position, current.position);
      if (moved === null) unknownPredicates.push(predicate);
      else if (moved >= blocker.positionRegionDistance) changedBy.push(predicate);
      continue;
    }
    const key = {
      dimension: 'dimension',
      target_signature: 'targetSignature',
      inventory_signature: 'inventorySignature',
      world_signature: 'worldSignature',
      cycle_signature: 'cycleSignature',
    }[predicate];
    const before = blocker.checkpoint[key];
    const after = current[key];
    if (before === null || after === null) unknownPredicates.push(predicate);
    else if (before !== after) changedBy.push(predicate);
  }
  // A bounded hold releases on its own. Kept out of `changedBy`, which names
  // world predicates, so existing consumers keep their exact meaning.
  let holdExpired = false;
  if (blocker.holdMs > 0 && blocker.createdAt !== null) {
    const numericNow = now === null || now === undefined
      ? Number.NaN
      : Number(now);
    const currentTime = Number.isFinite(numericNow) ? numericNow : Date.now();
    holdExpired = currentTime - blocker.createdAt >= blocker.holdMs;
  }
  const state = changedBy.length > 0 || holdExpired
    ? 'changed'
    : unknownPredicates.length > 0
      ? 'unknown'
      : 'unchanged';
  return Object.freeze({
    schemaVersion: BLOCKER_SCHEMA_VERSION,
    state,
    materialChanged: state === 'changed' ? true : state === 'unchanged' ? false : null,
    changedBy: Object.freeze(changedBy),
    unknownPredicates: Object.freeze(unknownPredicates),
    holdExpired,
  });
}

export function receiptShowsMaterialProgress(receipt) {
  if (!receipt || typeof receipt !== 'object') return null;
  if (receipt.materialChanged === true) return true;
  if (Number(receipt.progressed) > 0 || Number(receipt.progress) > 0) return true;
  const children = receipt.children && typeof receipt.children === 'object'
    ? Object.values(receipt.children).flatMap(value => Array.isArray(value) ? value : [])
    : [];
  if (children.some(child => (
    child?.materialChanged === true
    || Number(child?.progressed) > 0
    || Number(child?.progress) > 0
    || ['progress_verified', 'detour_verified'].includes(child?.outcome)
  ))) return true;
  if (receipt.receiptSchemaVersion === 1 && receipt.source === 'action_context') return false;
  return null;
}

export const OBLIGATION_SETTLEMENT_VERSION = SETTLEMENT_SCHEMA_VERSION;
