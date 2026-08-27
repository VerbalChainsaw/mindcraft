const WORKSTATION_TRANSACTION_SCHEMA_VERSION = 1;
const KINDS = new Set(['craft', 'smelt']);

function boundedText(value, maximum = 96) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex -- Durable receipts cross storage and telemetry boundaries.
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function quantity(value, maximum = 4096) {
  return Math.max(0, Math.min(maximum, Math.floor(Number(value) || 0)));
}

function canonicalName(value) {
  const normalized = boundedText(value, 64).toLowerCase();
  return /^[a-z0-9_]{1,64}$/.test(normalized) ? normalized : null;
}

function normalizePosition(value) {
  if (!value || ![value.x, value.y, value.z].every(Number.isFinite)) return null;
  return Object.freeze({
    x: Math.floor(value.x),
    y: Math.floor(value.y),
    z: Math.floor(value.z),
  });
}

function normalizeWorkstation(value, expectedName = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const name = canonicalName(value.name);
  const position = normalizePosition(value.position || value);
  const dimension = canonicalName(
    String(value.dimension || '')
      .replace(/^minecraft:/i, '')
      .replace(/^the_nether$/i, 'nether')
      .replace(/^the_end$/i, 'end'),
  );
  if (!name || !position || !dimension || (expectedName && name !== expectedName)) return null;
  return Object.freeze({ name, position, dimension });
}

function normalizeSlot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const name = canonicalName(value.name);
  const count = quantity(value.count, 64);
  if (!name || count < 1) return null;
  return Object.freeze({ name, count });
}

function normalizeFurnaceState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = normalizeSlot(value.input);
  const fuel = normalizeSlot(value.fuel);
  const output = normalizeSlot(value.output);
  const progress = Number(value.progress);
  const fuelRemaining = Number(value.fuelRemaining);
  return Object.freeze({
    input,
    fuel,
    output,
    progress: Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : null,
    fuelRemaining: Number.isFinite(fuelRemaining)
      ? Math.max(0, Math.min(1, fuelRemaining))
      : null,
  });
}

export function createWorkstationTransactionReceipt({
  kind,
  transactionId,
  target,
  output,
  requestedQuantity,
  completedQuantity = 0,
  outputPerOperation = 1,
  beforeOutputCount = 0,
  afterOutputCount = 0,
  workstation = null,
  furnaceState = null,
  materialChanged = false,
  interrupted = false,
} = {}) {
  const normalizedKind = KINDS.has(kind) ? kind : null;
  if (!normalizedKind) throw new TypeError('A workstation transaction must be craft or smelt.');
  const normalizedTarget = canonicalName(target);
  const normalizedOutput = canonicalName(output);
  if (!normalizedTarget || !normalizedOutput) {
    throw new TypeError('A workstation transaction needs canonical target and output names.');
  }
  const requested = quantity(requestedQuantity);
  const completed = Math.min(requested, quantity(completedQuantity));
  const remaining = Math.max(0, requested - completed);
  const perOperation = Math.max(1, quantity(outputPerOperation, 64));
  const before = quantity(beforeOutputCount, 2304);
  const after = quantity(afterOutputCount, 2304);
  const expectedWorkstation = normalizedKind === 'craft' ? 'crafting_table' : 'furnace';
  const normalizedWorkstation = normalizeWorkstation(workstation, expectedWorkstation);
  const normalizedFurnaceState = normalizedKind === 'smelt'
    ? normalizeFurnaceState(furnaceState)
    : null;
  const changed = materialChanged === true
    || completed > 0
    || after > before;

  return Object.freeze({
    schemaVersion: WORKSTATION_TRANSACTION_SCHEMA_VERSION,
    kind: normalizedKind,
    transactionId: boundedText(transactionId, 96) || null,
    target: normalizedTarget,
    output: normalizedOutput,
    requestedQuantity: requested,
    completedQuantity: completed,
    remainingQuantity: remaining,
    outputPerOperation: perOperation,
    inventory: Object.freeze({
      beforeOutputCount: before,
      afterOutputCount: after,
      outputDelta: Math.max(0, after - before),
    }),
    workstation: normalizedWorkstation,
    furnaceState: normalizedFurnaceState,
    materialChanged: changed,
    interrupted: interrupted === true,
    complete: interrupted !== true && requested > 0 && remaining === 0,
  });
}

export function normalizeWorkstationTransactionReceipt(value) {
  if (value?.schemaVersion !== WORKSTATION_TRANSACTION_SCHEMA_VERSION) return null;
  try {
    return createWorkstationTransactionReceipt({
      ...value,
      beforeOutputCount: value.inventory?.beforeOutputCount,
      afterOutputCount: value.inventory?.afterOutputCount,
    });
  } catch {
    return null;
  }
}

export function normalizeWorkstationTransactionCheckpoint(value, {
  kind,
  target,
  requestedQuantity,
  workstation = null,
} = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const normalizedKind = KINDS.has(kind) ? kind : null;
  const normalizedTarget = canonicalName(target);
  const requested = quantity(requestedQuantity);
  const completed = Math.min(requested, quantity(value.completedQuantity));
  if (
    value.schemaVersion !== WORKSTATION_TRANSACTION_SCHEMA_VERSION
    || value.kind !== normalizedKind
    || value.target !== normalizedTarget
    || value.requestedQuantity !== requested
  ) return null;
  const expectedWorkstation = normalizedKind === 'craft' ? 'crafting_table' : 'furnace';
  const normalizedWorkstation = normalizeWorkstation(value.workstation, expectedWorkstation)
    || normalizeWorkstation(workstation, expectedWorkstation);
  const output = canonicalName(value.output);
  if (!output) return null;
  return Object.freeze({
    schemaVersion: WORKSTATION_TRANSACTION_SCHEMA_VERSION,
    kind: normalizedKind,
    target: normalizedTarget,
    output,
    requestedQuantity: requested,
    completedQuantity: completed,
    remainingQuantity: Math.max(0, requested - completed),
    workstation: normalizedWorkstation,
    furnaceState: normalizedKind === 'smelt'
      ? normalizeFurnaceState(value.furnaceState)
      : null,
    updatedAt: Number.isFinite(Number(value.updatedAt))
      ? Math.max(0, Math.floor(Number(value.updatedAt)))
      : null,
  });
}

export function advanceWorkstationTransactionCheckpoint(current, receipt, {
  kind,
  target,
  requestedQuantity,
  workstation = null,
  now = Date.now(),
} = {}) {
  const normalizedReceipt = normalizeWorkstationTransactionReceipt(receipt);
  if (!normalizedReceipt || normalizedReceipt.kind !== kind || normalizedReceipt.target !== target) return null;
  const prior = normalizeWorkstationTransactionCheckpoint(current, {
    kind,
    target,
    requestedQuantity,
    workstation,
  });
  if (current != null && !prior) return null;
  const requested = quantity(requestedQuantity);
  const priorCompleted = prior?.completedQuantity || 0;
  if (
    normalizedReceipt.requestedQuantity !== Math.max(0, requested - priorCompleted)
    || (prior?.output && prior.output !== normalizedReceipt.output)
  ) return null;
  const completed = Math.min(requested, priorCompleted + normalizedReceipt.completedQuantity);
  return Object.freeze({
    schemaVersion: WORKSTATION_TRANSACTION_SCHEMA_VERSION,
    kind,
    target,
    output: normalizedReceipt.output,
    requestedQuantity: requested,
    completedQuantity: completed,
    remainingQuantity: Math.max(0, requested - completed),
    workstation: normalizedReceipt.workstation || prior?.workstation || normalizeWorkstation(
      workstation,
      kind === 'craft' ? 'crafting_table' : 'furnace',
    ),
    furnaceState: kind === 'smelt' ? normalizedReceipt.furnaceState : null,
    updatedAt: Math.max(0, Math.floor(Number(now) || Date.now())),
  });
}

export const WORKSTATION_TRANSACTION_VERSION = WORKSTATION_TRANSACTION_SCHEMA_VERSION;
