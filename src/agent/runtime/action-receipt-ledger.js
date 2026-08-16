import { Buffer } from 'node:buffer';

const RECEIPT_RELATIONSHIPS = Object.freeze([
  'selection',
  'feasibility',
  'planning',
  'navigation',
  'interaction',
  'collection',
  'combat',
  'cleanup',
  'reconciliation',
]);

const RECEIPT_RELATIONSHIP_SET = new Set(RECEIPT_RELATIONSHIPS);
const MAX_RELATIONSHIP_RECEIPTS = 16;
const RETAIN_RELATIONSHIP_EDGE = 8;
const MAX_CHILD_RECEIPTS = 48;
const RETAIN_GLOBAL_EDGE = 24;
const MAX_VALUE_DEPTH = 8;
const MAX_OBJECT_KEYS = 96;
const MAX_ARRAY_ITEMS = 96;
const MAX_STRING_LENGTH = 1_200;
const MAX_COMPOSED_RECEIPT_BYTES = 128 * 1024;
const MAX_VIOLATIONS = 16;
const OMIT = Symbol('omit-action-receipt-value');

function sanitizedText(value) {
  return String(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_STRING_LENGTH);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeValue(value, depth, ancestors, inArray = false) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return sanitizedText(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : (inArray ? null : OMIT);
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    return inArray ? null : OMIT;
  }
  if (depth >= MAX_VALUE_DEPTH || ancestors.has(value)) return inArray ? null : OMIT;

  if (Array.isArray(value)) {
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(value);
    const result = value.slice(0, MAX_ARRAY_ITEMS).map(item => {
      const normalized = normalizeValue(item, depth + 1, nextAncestors, true);
      return normalized === OMIT ? null : normalized;
    });
    return Object.freeze(result);
  }

  if (!isPlainObject(value)) return inArray ? null : OMIT;
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  const result = {};
  for (const key of Object.keys(value).slice(0, MAX_OBJECT_KEYS)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue;
    const normalized = normalizeValue(value[key], depth + 1, nextAncestors, false);
    if (normalized !== OMIT) result[sanitizedText(key)] = normalized;
  }
  return Object.freeze(result);
}

export function normalizeActionReceiptValue(value) {
  const normalized = normalizeValue(value, 0, new Set(), false);
  return normalized === OMIT ? null : normalized;
}

export function deepFreezeActionValue(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreezeActionValue(child, seen);
  return Object.freeze(value);
}

export function createLegacyActionReceiptEnvelope(actionId, evidence) {
  const normalized = normalizeActionReceiptValue(evidence);
  if (!isPlainObject(normalized)) return null;
  return normalizeActionReceiptValue({
    ...normalized,
    receiptSchemaVersion: 1,
    actionId: sanitizedText(actionId).slice(0, 80),
    source: 'legacy_fallback',
    children: {},
    overflow: null,
    contract: {
      valid: null,
      code: 'legacy_receipt_unmigrated',
      violations: [],
    },
  });
}

function serializedBytes(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function boundedCore(value) {
  const target = isPlainObject(value?.target)
    ? normalizeActionReceiptValue({
      name: value.target.name,
      type: value.target.type,
      x: value.target.x,
      y: value.target.y,
      z: value.target.z,
      entityId: value.target.entityId,
    })
    : null;
  return normalizeActionReceiptValue({
    kind: value?.kind,
    outcome: value?.outcome,
    code: value?.code,
    ...(target ? { target } : {}),
  }) || Object.freeze({});
}

function receiptSummary(receipt) {
  return normalizeActionReceiptValue({
    relationship: receipt.relationship,
    sequence: receipt.sequence,
    ...boundedCore(receipt),
    summarized: true,
    originalByteCount: serializedBytes(receipt),
  });
}

function updateDroppedRange(summary, sequence) {
  summary.firstDroppedSequence = summary.firstDroppedSequence === null
    ? sequence
    : Math.min(summary.firstDroppedSequence, sequence);
  summary.lastDroppedSequence = summary.lastDroppedSequence === null
    ? sequence
    : Math.max(summary.lastDroppedSequence, sequence);
}

function contractFailureReceipt(actionId, code, details = {}) {
  return normalizeActionReceiptValue({
    kind: 'action_receipt',
    outcome: code,
    retryable: false,
    ...details,
    receiptSchemaVersion: 1,
    actionId,
    source: 'action_context',
    children: {},
    overflow: null,
    contract: {
      valid: false,
      code,
      violations: [code],
    },
  });
}

export function createActionReceiptLedger(actionId, { mode = 'legacy' } = {}) {
  const boundedActionId = sanitizedText(actionId).slice(0, 80);
  const receiptMode = mode === 'composed' ? 'composed' : 'legacy';
  let lifecycle = 'open';
  let terminal = null;
  let sequence = 0;
  let childTotal = 0;
  let sealedReceipt = null;
  const violations = [];
  const relationshipState = new Map(RECEIPT_RELATIONSHIPS.map(relationship => [relationship, {
    total: 0,
    retained: [],
    firstDroppedSequence: null,
    lastDroppedSequence: null,
  }]));

  const rejectStale = () => Object.freeze({
    accepted: false,
    code: 'stale_action_receipt_rejected',
    snapshot: null,
  });

  const addViolation = (code) => {
    if (violations.length < MAX_VIOLATIONS) violations.push(code);
    return Object.freeze({ accepted: false, code, snapshot: null });
  };

  const requireOpenGeneration = expectedActionId => (
    lifecycle === 'open' && expectedActionId === boundedActionId
  );

  function recordChild(expectedActionId, relationship, evidence) {
    if (!requireOpenGeneration(expectedActionId)) return rejectStale();
    if (terminal) return addViolation('action_receipt_contract_violation');
    if (!RECEIPT_RELATIONSHIP_SET.has(relationship)) {
      return addViolation('action_receipt_relationship_invalid');
    }
    const normalized = normalizeActionReceiptValue(evidence);
    if (!isPlainObject(normalized)) return addViolation('action_receipt_child_invalid');

    sequence += 1;
    childTotal += 1;
    const snapshot = normalizeActionReceiptValue({
      ...normalized,
      relationship,
      sequence,
    });
    const state = relationshipState.get(relationship);
    state.total += 1;
    state.retained.push(snapshot);
    if (state.retained.length > MAX_RELATIONSHIP_RECEIPTS) {
      const [dropped] = state.retained.splice(RETAIN_RELATIONSHIP_EDGE, 1);
      updateDroppedRange(state, dropped.sequence);
    }
    return Object.freeze({ accepted: true, code: 'action_child_receipt_recorded', snapshot });
  }

  function recordTerminal(expectedActionId, evidence) {
    if (!requireOpenGeneration(expectedActionId)) return rejectStale();
    if (terminal) return addViolation('action_receipt_contract_violation');
    const normalized = normalizeActionReceiptValue(evidence);
    if (!isPlainObject(normalized)) return addViolation('action_receipt_terminal_invalid');
    terminal = normalized;
    return Object.freeze({ accepted: true, code: 'action_terminal_receipt_recorded', snapshot: terminal });
  }

  function composeReceipt(mirrorEvidence) {
    const terminalMissing = !terminal;
    let terminalReceipt = terminal || normalizeActionReceiptValue({
      kind: 'action_receipt',
      outcome: 'action_terminal_receipt_missing',
      retryable: false,
    });
    if (!terminalMissing && mirrorEvidence !== terminal) violations.push('action_evidence_mirror_mismatch');

    const originalTerminalBytes = serializedBytes(terminalReceipt);
    const terminalOversized = originalTerminalBytes >= MAX_COMPOSED_RECEIPT_BYTES;
    if (terminalOversized) {
      terminalReceipt = normalizeActionReceiptValue({
        kind: 'action_receipt',
        outcome: 'terminal_receipt_oversized',
        retryable: false,
        terminal: boundedCore(terminalReceipt),
        originalByteCount: originalTerminalBytes,
      });
    }

    const retainedByRelationship = new Map();
    const union = [];
    for (const relationship of RECEIPT_RELATIONSHIPS) {
      for (const receipt of relationshipState.get(relationship).retained) union.push(receipt);
    }
    union.sort((left, right) => left.sequence - right.sequence);
    const globallyRetained = union.length <= MAX_CHILD_RECEIPTS
      ? union
      : [...union.slice(0, RETAIN_GLOBAL_EDGE), ...union.slice(-RETAIN_GLOBAL_EDGE)];
    const globallyRetainedSequences = new Set(globallyRetained.map(receipt => receipt.sequence));
    const globalDropped = union.filter(receipt => !globallyRetainedSequences.has(receipt.sequence));

    for (const relationship of RECEIPT_RELATIONSHIPS) retainedByRelationship.set(relationship, []);
    for (const receipt of globallyRetained) retainedByRelationship.get(receipt.relationship).push(receipt);

    const globalDropCount = childTotal - globallyRetained.length;
    const perRelationshipOverflow = {};
    for (const relationship of RECEIPT_RELATIONSHIPS) {
      const state = relationshipState.get(relationship);
      const retained = retainedByRelationship.get(relationship);
      const additionallyDropped = state.retained.filter(receipt => !globallyRetainedSequences.has(receipt.sequence));
      let firstDroppedSequence = state.firstDroppedSequence;
      let lastDroppedSequence = state.lastDroppedSequence;
      for (const receipt of additionallyDropped) {
        firstDroppedSequence = firstDroppedSequence === null
          ? receipt.sequence
          : Math.min(firstDroppedSequence, receipt.sequence);
        lastDroppedSequence = lastDroppedSequence === null
          ? receipt.sequence
          : Math.max(lastDroppedSequence, receipt.sequence);
      }
      const dropped = state.total - retained.length;
      if (dropped > 0) {
        perRelationshipOverflow[relationship] = {
          total: state.total,
          retained: retained.length,
          dropped,
          firstDroppedSequence,
          lastDroppedSequence,
        };
      }
    }
    const globalFirstDropped = [
      ...globalDropped.map(receipt => receipt.sequence),
      ...Object.values(perRelationshipOverflow).map(value => value.firstDroppedSequence),
    ].filter(Number.isFinite).sort((a, b) => a - b)[0] ?? null;
    const globalLastDropped = [
      ...globalDropped.map(receipt => receipt.sequence),
      ...Object.values(perRelationshipOverflow).map(value => value.lastDroppedSequence),
    ].filter(Number.isFinite).sort((a, b) => b - a)[0] ?? null;
    const overflow = globalDropCount > 0
      ? normalizeActionReceiptValue({
        code: 'receipt_evidence_truncated',
        global: {
          total: childTotal,
          retained: globallyRetained.length,
          dropped: globalDropCount,
          firstDroppedSequence: globalFirstDropped,
          lastDroppedSequence: globalLastDropped,
        },
        relationships: perRelationshipOverflow,
      })
      : null;

    const children = {};
    for (const relationship of RECEIPT_RELATIONSHIPS) {
      const receipts = retainedByRelationship.get(relationship);
      if (receipts.length > 0) children[relationship] = receipts.slice();
    }
    const contract = terminalOversized
      ? {
        valid: false,
        code: 'terminal_receipt_oversized',
        violations: ['terminal_receipt_oversized'],
      }
      : terminalMissing
      ? {
        valid: false,
        code: 'action_terminal_receipt_missing',
        violations: ['action_terminal_receipt_missing', ...new Set(violations)]
          .slice(0, MAX_VIOLATIONS),
      }
      : violations.length > 0
      ? {
        valid: false,
        code: 'action_receipt_contract_violation',
        violations: [...new Set(violations)].slice(0, MAX_VIOLATIONS),
      }
      : { valid: true, code: 'action_receipt_contract_valid', violations: [] };

    const build = () => normalizeActionReceiptValue({
      ...terminalReceipt,
      receiptSchemaVersion: 1,
      actionId: boundedActionId,
      source: 'action_context',
      children,
      overflow,
      contract,
    });
    let composed = build();
    if (serializedBytes(composed) > MAX_COMPOSED_RECEIPT_BYTES) {
      const candidates = Object.values(children)
        .flatMap(receipts => receipts.map((receipt, index) => ({
          relationship: receipt.relationship,
          index,
          sequence: receipt.sequence,
          bytes: serializedBytes(receipt),
        })))
        .sort((left, right) => right.bytes - left.bytes || right.sequence - left.sequence);
      for (const candidate of candidates) {
        if (serializedBytes(composed) <= MAX_COMPOSED_RECEIPT_BYTES) break;
        children[candidate.relationship][candidate.index] = receiptSummary(
          children[candidate.relationship][candidate.index],
        );
        composed = build();
      }
    }
    if (serializedBytes(composed) > MAX_COMPOSED_RECEIPT_BYTES) {
      return contractFailureReceipt(boundedActionId, 'terminal_receipt_oversized', {
        terminal: boundedCore(terminalReceipt),
        originalByteCount: originalTerminalBytes,
      });
    }
    return composed;
  }

  function seal({ reason = 'resolved', mirrorEvidence = null } = {}) {
    if (lifecycle === 'sealed') {
      return Object.freeze({
        accepted: false,
        code: 'stale_action_receipt_rejected',
        receipt: sealedReceipt,
      });
    }
    lifecycle = 'sealed';
    sealedReceipt = receiptMode === 'composed'
      ? composeReceipt(mirrorEvidence)
      : null;
    return Object.freeze({
      accepted: true,
      code: 'action_receipt_ledger_sealed',
      reason: sanitizedText(reason).slice(0, 80),
      receipt: sealedReceipt,
    });
  }

  return Object.freeze({
    actionId: boundedActionId,
    mode: receiptMode,
    get lifecycle() { return lifecycle; },
    recordChild,
    recordTerminal,
    seal,
  });
}

export const ACTION_RECEIPT_LIMITS = Object.freeze({
  relationships: RECEIPT_RELATIONSHIPS,
  maxRelationshipReceipts: MAX_RELATIONSHIP_RECEIPTS,
  maxChildReceipts: MAX_CHILD_RECEIPTS,
  maxValueDepth: MAX_VALUE_DEPTH,
  maxObjectKeys: MAX_OBJECT_KEYS,
  maxArrayItems: MAX_ARRAY_ITEMS,
  maxStringLength: MAX_STRING_LENGTH,
  maxComposedReceiptBytes: MAX_COMPOSED_RECEIPT_BYTES,
});
