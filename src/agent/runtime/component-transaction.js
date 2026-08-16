const COMPONENT_TRANSACTION_SCHEMA_VERSION = 1;

function boundedText(value, maximum = 96) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex -- Receipts cross persistence and telemetry boundaries.
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function count(value) {
  return Math.max(0, Math.min(4096, Math.floor(Number(value) || 0)));
}

/**
 * One bounded world-component transaction. Selection, physical yield, custody,
 * temporary-state cleanup, and final terrain settlement are independent facts;
 * none may stand in for another.
 */
export function createComponentTransactionReceipt({
  kind,
  componentId,
  requestedQuantity = 0,
  selectedQuantity = 0,
  acquiredQuantity = 0,
  remainingComponentCount = 0,
  componentCompletionRequired = false,
  accessOutcome = 'unknown',
  temporaryCreated = 0,
  temporaryReconciled = 0,
  temporaryRemaining = 0,
  terrainSettled = null,
  terrainOutcome = 'unknown',
  interrupted = false,
} = {}) {
  const requested = count(requestedQuantity);
  const selected = count(selectedQuantity);
  const acquired = count(acquiredQuantity);
  const remaining = count(remainingComponentCount);
  const created = count(temporaryCreated);
  const reconciled = count(temporaryReconciled);
  const temporaryOutstanding = count(temporaryRemaining);
  const selectionVerified = Boolean(boundedText(componentId)) && selected > 0;
  const custodyVerified = acquired > 0;
  const quantitySatisfied = requested === 0 || acquired >= requested;
  const componentSatisfied = componentCompletionRequired !== true || remaining === 0;
  const cleanupComplete = temporaryOutstanding === 0 && reconciled >= created;
  const terrainVerified = terrainSettled === true;
  const complete = interrupted !== true
    && selectionVerified
    && custodyVerified
    && quantitySatisfied
    && componentSatisfied
    && cleanupComplete
    && terrainVerified;
  const materialChanged = acquired > 0 || created > 0 || reconciled > 0;

  return Object.freeze({
    schemaVersion: COMPONENT_TRANSACTION_SCHEMA_VERSION,
    kind: boundedText(kind, 48) || 'world_component',
    componentId: boundedText(componentId, 120) || null,
    outcome: interrupted === true ? 'censored' : complete ? 'complete' : 'incomplete',
    materialChanged,
    selection: Object.freeze({ verified: selectionVerified, selectedQuantity: selected }),
    access: Object.freeze({ outcome: boundedText(accessOutcome, 80) || 'unknown' }),
    yield: Object.freeze({ requestedQuantity: requested, acquiredQuantity: acquired, quantitySatisfied }),
    custody: Object.freeze({ verified: custodyVerified, acquiredQuantity: acquired }),
    component: Object.freeze({ completionRequired: componentCompletionRequired === true, remainingCount: remaining, complete: componentSatisfied }),
    temporaryState: Object.freeze({ created, reconciled, remaining: temporaryOutstanding }),
    cleanup: Object.freeze({ complete: cleanupComplete }),
    terrain: Object.freeze({ settled: terrainSettled === true ? true : terrainSettled === false ? false : null, outcome: boundedText(terrainOutcome, 80) || 'unknown' }),
  });
}

export const COMPONENT_TRANSACTION_VERSION = COMPONENT_TRANSACTION_SCHEMA_VERSION;
