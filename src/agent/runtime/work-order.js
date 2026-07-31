import { randomUUID } from 'node:crypto';

const ROLES = new Set(['builder', 'miner', 'lumberjack']);
const KINDS = new Set(['stockpile', 'build', 'emergency_shelter', 'mine', 'harvest']);
const SOURCES = new Set(['player', 'role', 'survival', 'restart']);
const PHASES = new Set([
  'assess',
  'acquire',
  'prepare',
  'execute',
  'verify',
  'deliver',
  'recover',
  'complete',
  'failed',
  'cancelled',
]);
const CANONICAL_NAME = /^[a-z0-9_]{1,64}$/;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,96}$/;
const SAFE_REQUESTER = /^[A-Za-z0-9_ -]{0,32}$/;
const MAX_BLUEPRINT_CELLS = 4096;
// A higher-priority lane taking ActionManager is not the work order failing.
// The bot was mid-swing when a creeper arrived: nothing about the order became
// wrong, and the same step is still the right next step. Folding a preemption
// in as a retryable failure burned an attempt, so three interruptions killed a
// job permanently, and it routed the order through `recover` -- which for the
// miner and lumberjack means `!moveAway(32)`, walking the bot away from the
// very trees or ore it was working.
const PREEMPTION_CODE = /^(?:action_)?interrupted$/;
// Preemption still needs a ceiling. A bot pinned by something it cannot escape
// would otherwise re-derive the same step forever with no failure to report.
const MAX_PREEMPTIONS = 24;

/** True when a result means "something outranked us", not "this did not work". */
export function isPreemption(result) {
  return result?.phase === 'interrupted'
    || PREEMPTION_CODE.test(String(result?.code || ''));
}

function finiteInteger(value, fallback, minimum, maximum) {
  const number = Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function boundedText(value, maximum) {
  const text = String(value || '');
  // eslint-disable-next-line no-control-regex -- Persisted work-order text must be display and storage safe.
  if (/[\u0000-\u001f\u007f]/.test(text)) throw new TypeError('Text contains control characters.');
  return text.trim().slice(0, maximum);
}

function normalizeTarget(target) {
  if (target == null) return null;
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    throw new TypeError('Work-order target must be an object.');
  }
  const normalized = {};
  if (target.name !== undefined) {
    const name = boundedText(target.name, 64);
    if (!CANONICAL_NAME.test(name)) throw new TypeError('Target name must be canonical.');
    normalized.name = name;
  }
  for (const coordinate of ['x', 'y', 'z']) {
    if (target[coordinate] !== undefined) {
      if (!Number.isFinite(target[coordinate])) throw new TypeError(`Target ${coordinate} must be finite.`);
      normalized[coordinate] = Math.floor(target[coordinate]);
    }
  }
  return Object.freeze(normalized);
}

function normalizeBlueprint(blueprint) {
  if (blueprint == null) return null;
  if (!blueprint || typeof blueprint !== 'object' || Array.isArray(blueprint)) {
    throw new TypeError('Blueprint must be an object.');
  }
  const id = boundedText(blueprint.id, 64);
  if (!CANONICAL_NAME.test(id)) throw new TypeError('Blueprint id must be canonical.');
  const width = finiteInteger(blueprint.width, 0, 1, 32);
  const depth = finiteInteger(blueprint.depth, 0, 1, 32);
  const height = finiteInteger(blueprint.height, 0, 1, 32);
  if (
    width !== blueprint.width
    || depth !== blueprint.depth
    || height !== blueprint.height
  ) throw new TypeError('Blueprint dimensions are invalid or excessive.');
  if (!Array.isArray(blueprint.cells) || blueprint.cells.length > MAX_BLUEPRINT_CELLS) {
    throw new TypeError('Blueprint cell count is invalid or excessive.');
  }
  const occupied = new Set();
  const cells = blueprint.cells.map(cell => {
    if (
      !cell
      || !Number.isInteger(cell.x)
      || !Number.isInteger(cell.y)
      || !Number.isInteger(cell.z)
      || Math.abs(cell.x) > 31
      || cell.y < 0
      || cell.y > 31
      || Math.abs(cell.z) > 31
    ) throw new TypeError('Blueprint cell coordinates are invalid.');
    const material = boundedText(cell.material, 64);
    if (!CANONICAL_NAME.test(material)) throw new TypeError('Blueprint material must be canonical.');
    const hasStage = Number.isFinite(cell.stage);
    const stage = finiteInteger(cell.stage, 0, 0, 16);
    const cellFunction = cell.function == null ? '' : boundedText(cell.function, 64);
    if (cellFunction && !CANONICAL_NAME.test(cellFunction)) {
      throw new TypeError('Blueprint cell function must be canonical.');
    }
    const key = `${cell.x}:${cell.y}:${cell.z}`;
    if (occupied.has(key)) throw new TypeError('Blueprint contains a duplicate cell.');
    occupied.add(key);
    return Object.freeze({
      x: cell.x,
      y: cell.y,
      z: cell.z,
      material,
      ...(hasStage ? { stage } : {}),
      ...(cellFunction ? { function: cellFunction } : {}),
    });
  });
  return Object.freeze({ id, width, depth, height, cells: Object.freeze(cells) });
}

/**
 * Where the bot was standing when it last dispatched work. A fight can drag it
 * a long way from its own worksite, and without this the order resumes from
 * wherever the chase ended instead of from where the work is.
 */
function normalizeAnchor(anchor) {
  if (anchor == null) return null;
  if (typeof anchor !== 'object' || Array.isArray(anchor)) {
    throw new TypeError('Work-order anchor must be an object.');
  }
  if (!['x', 'y', 'z'].every(axis => Number.isFinite(anchor[axis]))) return null;
  return Object.freeze({
    x: Math.floor(anchor.x),
    y: Math.floor(anchor.y),
    z: Math.floor(anchor.z),
  });
}

function normalizeCheckpoint(checkpoint) {
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) return Object.freeze({});
  const normalized = {};
  for (const key of ['verifiedCount', 'nextCell', 'collected', 'delivered']) {
    if (Number.isFinite(checkpoint[key])) normalized[key] = finiteInteger(checkpoint[key], 0, 0, 4096);
  }
  if (Array.isArray(checkpoint.verifiedCells)) {
    normalized.verifiedCells = Object.freeze(checkpoint.verifiedCells
      .slice(0, MAX_BLUEPRINT_CELLS)
      .filter(value => typeof value === 'string' && value.length <= 32));
  }
  return Object.freeze(normalized);
}

function normalizeConstraints(constraints) {
  const source = constraints && typeof constraints === 'object' && !Array.isArray(constraints)
    ? constraints
    : {};
  return Object.freeze({
    maxDistance: finiteInteger(source.maxDistance, 64, 16, 512),
    minHunger: finiteInteger(source.minHunger, 16, 0, 20),
    minFoodPoints: finiteInteger(source.minFoodPoints, 12, 0, 2304),
    reserveSlots: finiteInteger(source.reserveSlots, 1, 0, 36),
    requireLight: source.requireLight !== false,
    replant: source.replant !== false,
  });
}

function normalizeEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
  return Object.freeze({
    code: boundedText(evidence.code, 80),
    detail: boundedText(evidence.detail, 280),
    actionId: boundedText(evidence.actionId, 96),
  });
}

export function normalizeWorkOrder(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Work order must be an object.');
  }
  let requester;
  try {
    requester = boundedText(raw.requester, 32);
  } catch {
    throw new TypeError('Work-order requester is invalid.');
  }
  if (!SAFE_REQUESTER.test(requester)) throw new TypeError('Work-order requester is invalid.');
  const id = boundedText(raw.id, 96);
  if (!SAFE_ID.test(id)) throw new TypeError('Work-order id is invalid.');
  const role = boundedText(raw.role, 24);
  if (!ROLES.has(role)) throw new TypeError('Work-order role is invalid.');
  const kind = boundedText(raw.kind, 32);
  if (!KINDS.has(kind)) throw new TypeError('Work-order kind is invalid.');
  const source = boundedText(raw.source || 'role', 24);
  if (!SOURCES.has(source)) throw new TypeError('Work-order source is invalid.');
  const phase = boundedText(raw.phase || 'assess', 24);
  if (!PHASES.has(phase)) throw new TypeError('Work-order phase is invalid.');
  const resumePhase = raw.resumePhase == null ? null : boundedText(raw.resumePhase, 24);
  if (resumePhase !== null && !PHASES.has(resumePhase)) throw new TypeError('Resume phase is invalid.');
  const quota = finiteInteger(raw.quota, 1, 1, 2304);
  const attempts = finiteInteger(raw.attempts, 0, 0, 32);
  const maxAttempts = finiteInteger(raw.maxAttempts, 3, 1, 8);
  const preemptions = finiteInteger(raw.preemptions, 0, 0, MAX_PREEMPTIONS);
  const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now();
  const updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt;
  return Object.freeze({
    id,
    role,
    kind,
    source,
    requester,
    target: normalizeTarget(raw.target),
    constraints: normalizeConstraints(raw.constraints),
    quota,
    blueprint: normalizeBlueprint(raw.blueprint),
    phase,
    resumePhase,
    attempts,
    maxAttempts,
    preemptions,
    anchor: normalizeAnchor(raw.anchor),
    checkpoint: normalizeCheckpoint(raw.checkpoint),
    evidence: normalizeEvidence(raw.evidence),
    createdAt,
    updatedAt,
  });
}

export function createWorkOrder(input = {}) {
  return normalizeWorkOrder({
    id: input.id || `${input.role || 'job'}-${randomUUID()}`,
    phase: 'assess',
    attempts: 0,
    maxAttempts: 3,
    source: 'role',
    requester: '',
    checkpoint: {},
    ...input,
  });
}

export function advanceWorkOrder(order, result, {
  previousActionId = null,
  nextPhase = null,
  now = Date.now(),
} = {}) {
  const current = normalizeWorkOrder(order);
  if (!result?.actionId || result.actionId === previousActionId) return current;
  if (result.phase === 'succeeded' && nextPhase && PHASES.has(nextPhase)) {
    return normalizeWorkOrder({
      ...current,
      phase: nextPhase,
      resumePhase: null,
      // Verified progress clears the preemption budget. A long job should not
      // be killed by interruptions accumulated across work it already finished.
      preemptions: 0,
      evidence: { code: result.code, detail: result.detail, actionId: result.actionId },
      updatedAt: now,
    });
  }
  if (isPreemption(result) && current.preemptions < MAX_PREEMPTIONS) {
    // Hold the phase and the attempt budget. The next tick re-derives the same
    // step against fresh world state, which is what "resume what I was doing"
    // actually means.
    return normalizeWorkOrder({
      ...current,
      preemptions: current.preemptions + 1,
      evidence: {
        code: 'preempted',
        detail: result.detail || 'A higher-priority lane took ownership; the work order is unchanged.',
        actionId: result.actionId,
      },
      updatedAt: now,
    });
  }
  if (result.retryable === true && current.attempts < current.maxAttempts) {
    return normalizeWorkOrder({
      ...current,
      phase: 'recover',
      resumePhase: current.phase,
      attempts: current.attempts + 1,
      evidence: { code: result.code, detail: result.detail, actionId: result.actionId },
      updatedAt: now,
    });
  }
  return normalizeWorkOrder({
    ...current,
    phase: 'failed',
    resumePhase: null,
    evidence: { code: result.code, detail: result.detail, actionId: result.actionId },
    updatedAt: now,
  });
}

export function reconcileWorkOrder(order, currentSnapshot = {}, now = Date.now()) {
  const current = normalizeWorkOrder(order);
  if (['complete', 'failed', 'cancelled'].includes(current.phase)) return current;
  const detail = `Restart revalidation required at ${boundedText(JSON.stringify({
    inventory: currentSnapshot.inventory || {},
    position: currentSnapshot.position || null,
  }), 180)}`;
  return normalizeWorkOrder({
    ...current,
    phase: 'assess',
    resumePhase: current.phase === 'assess' ? current.resumePhase : current.phase,
    evidence: { code: 'restart_revalidation', detail, actionId: '' },
    updatedAt: now,
  });
}
