import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { writeJsonAtomicSync } from '../../utils/atomic-file.js';
import { normalizeWorkstationConstraint } from './goal-contract.js';

// An agenda is an ordered plan the player states once and the bot works through
// on its own. Both executors are single-slot — goal_director holds one goal and
// job_director one work order, and each rejects anything else as busy — so
// without a queue "get iron, then build a shelter, then find me" was three
// separate orders the player had to time by hand.
//
// Entries are strictly typed. This file is persisted and replayed after a
// restart, so it deliberately cannot carry a free-form command string: a store
// that round-trips arbitrary commands is a code-injection surface, and the
// language model writes into it.
const STORE_VERSION = 1;
const MAX_STORE_BYTES = 256 * 1024;
const SAFE_AGENT_NAME = /^[A-Za-z0-9_]{3,16}$/;
const SAFE_PLAYER = /^[A-Za-z0-9_]{1,16}$/;
const CANONICAL_NAME = /^[a-z0-9_]{1,64}$/;
const MAX_ENTRIES = 24;
const MAX_QUANTITY = 2304;
const MAX_NOTE = 160;
const ACQUIRE_COMPLETIONS = new Set(['inventory', 'main_hand', 'off_hand']);
const SAFE_ENTRY_ID = /^[A-Za-z0-9_.:-]{1,96}$/;

export const AGENDA_KINDS = Object.freeze({
  acquire: Object.freeze({ executor: 'goal', needsTarget: true, needsQuantity: true }),
  deliver: Object.freeze({ executor: 'goal', needsTarget: true, needsQuantity: true, needsRecipient: true }),
  mine: Object.freeze({ executor: 'job', needsTarget: true, needsQuantity: true }),
  harvest: Object.freeze({ executor: 'job', needsTarget: true, needsQuantity: true }),
  stockpile: Object.freeze({ executor: 'job', needsTarget: true, needsQuantity: true }),
  shelter: Object.freeze({ executor: 'job', needsTarget: false, needsQuantity: false }),
  // The model compiles custom geometry, but the persisted entry stores only a
  // typed barrier. AgendaDirector binds it to the exact accepted Builder order
  // id before any dependent step may run.
  construction: Object.freeze({ executor: 'job', needsTarget: false, needsQuantity: false }),
  // 'direct' runs a single bounded command the dispatcher builds in code from a
  // validated player name. The command text is never stored or replayed.
  goto: Object.freeze({ executor: 'direct', needsTarget: false, needsQuantity: false, needsRecipient: true }),
  // A standing follow is unbounded and cannot safely sit ahead of later work.
  // This bounded form keeps native GoalFollow active until both companions are
  // settled beside a named world capability, then yields to the next step.
  follow_until: Object.freeze({ executor: 'direct', needsTarget: true, needsQuantity: false, needsRecipient: true, needsRadius: true }),
  // Crafting and smelting are the middle of most real plans -- "get the iron,
  // smelt it, then make a pickaxe" -- and without them a chain had to stop at
  // the gathering step. The target is a canonical registry name validated on the
  // way in, so the dispatcher builds the command from a known-safe token.
  craft: Object.freeze({ executor: 'direct', needsTarget: true, needsQuantity: true }),
  smelt: Object.freeze({ executor: 'direct', needsTarget: true, needsQuantity: true }),
  farm_visit: Object.freeze({ executor: 'direct', needsTarget: false, needsQuantity: false }),
  maintain_farm: Object.freeze({ executor: 'direct', needsTarget: false, needsQuantity: false }),
  deposit: Object.freeze({ executor: 'direct', needsTarget: true, needsQuantity: true }),
  sleep: Object.freeze({ executor: 'direct', needsTarget: false, needsQuantity: false }),
  // Coordinates are validated numbers, never text, so a patrol step cannot
  // smuggle anything executable through the store.
  visit: Object.freeze({ executor: 'direct', needsTarget: false, needsQuantity: false, needsPoint: true }),
});

const TERMINAL_STATES = new Set(['complete', 'failed', 'cancelled', 'skipped']);
const ENTRY_STATES = new Set(['pending', 'active', ...TERMINAL_STATES]);

export function isTerminalAgendaState(state) {
  return TERMINAL_STATES.has(String(state || ''));
}

function boundedText(value, maximum = MAX_NOTE) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex -- Strip wire/control bytes before text reaches chat, prompts, and telemetry.
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function canonical(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^minecraft:/, '')
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 64);
}

/**
 * True when canonicalization only reshaped separators. "Iron Ingot" is a
 * legitimate way to say iron_ingot; "../../etc/passwd" is not a way to say
 * etcpasswd, and quietly scrubbing it into a plausible name would hand the
 * player a confusing "no acquisition path" error instead of the real problem.
 */
function isNameFaithful(value, canonicalized) {
  const relaxed = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^minecraft:/, '')
    .replace(/[\s-]+/g, '_')
    .slice(0, 64);
  return relaxed === canonicalized;
}

function finiteInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(number)));
}

/**
 * Validate and canonicalize one agenda entry. Throws with a specific reason so
 * a rejected request can tell the player exactly what was wrong.
 */
export function normalizeAgendaEntry(raw, { now = Date.now, sequence = null } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Agenda entry must be an object.');
  }
  const kind = canonical(raw.kind);
  const spec = AGENDA_KINDS[kind];
  if (!spec) {
    throw new TypeError(`Agenda kind '${kind || 'unknown'}' is not supported.`);
  }

  const target = spec.needsTarget ? canonical(raw.target) : '';
  if (spec.needsTarget && (!CANONICAL_NAME.test(target) || !isNameFaithful(raw.target, target))) {
    throw new TypeError(`Agenda ${kind} needs a canonical target name.`);
  }

  const recipient = boundedText(raw.recipient, 16);
  if (spec.needsRecipient && !SAFE_PLAYER.test(recipient)) {
    throw new TypeError(`Agenda ${kind} needs a valid player name.`);
  }

  const requester = boundedText(raw.requester, 16);
  if (requester && !SAFE_PLAYER.test(requester)) {
    throw new TypeError('Agenda requester is invalid.');
  }

  const point = spec.needsPoint
    ? { x: finiteInteger(raw.x, NaN, -30e6, 30e6), y: finiteInteger(raw.y, NaN, -256, 512), z: finiteInteger(raw.z, NaN, -30e6, 30e6) }
    : null;
  if (spec.needsPoint && [point.x, point.y, point.z].some((value) => !Number.isFinite(value))) {
    throw new TypeError('A visit step needs finite coordinates.');
  }
  const state = ENTRY_STATES.has(String(raw.state)) ? String(raw.state) : 'pending';
  const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : now();
  const completion = kind === 'deliver'
    ? 'delivery'
    : kind === 'acquire'
      ? canonical(raw.completion || 'inventory')
      : '';
  if (kind === 'acquire' && !ACQUIRE_COMPLETIONS.has(completion)) {
    throw new TypeError('Agenda acquire completion must be inventory, main_hand, or off_hand.');
  }
  if (kind === 'acquire' && completion !== 'inventory' && finiteInteger(raw.quantity, 1, 1, MAX_QUANTITY) !== 1) {
    throw new TypeError('An agenda hand-equipment step must request exactly one item.');
  }
  const rawWorkstation = kind === 'smelt' ? raw.workstationConstraint : null;
  const normalizedWorkstation = normalizeWorkstationConstraint(rawWorkstation);
  if (rawWorkstation != null && !normalizedWorkstation) {
    throw new TypeError('An agenda smelt workstation constraint is invalid.');
  }
  const sourceEntryId = boundedText(rawWorkstation?.sourceEntryId, 96);
  if (sourceEntryId && !SAFE_ENTRY_ID.test(sourceEntryId)) {
    throw new TypeError('An agenda workstation source entry id is invalid.');
  }

  // Ids must never collide. A timestamp alone is not enough: the model emits
  // several !addToAgenda calls in one reply, those land inside the same
  // millisecond, and two entries sharing an id means patching one silently
  // patches the rest of the plan out of existence.
  const identity = boundedText(raw.id, 64)
    || `agenda-${createdAt}-${Number.isFinite(sequence) ? sequence : Math.floor(Math.random() * 1e9)}`;

  return Object.freeze({
    id: identity,
    kind,
    executor: spec.executor,
    target,
    quantity: spec.needsQuantity ? finiteInteger(raw.quantity, 1, 1, MAX_QUANTITY) : 0,
    completion,
    recipient: spec.needsRecipient ? recipient : '',
    requester,
    radius: spec.needsRadius ? finiteInteger(raw.radius, 8, 2, 32) : 0,
    x: point ? point.x : 0,
    y: point ? point.y : 0,
    z: point ? point.z : 0,
    workstationConstraint: normalizedWorkstation
      ? Object.freeze({ ...normalizedWorkstation, sourceEntryId })
      : null,
    note: boundedText(raw.note),
    state,
    // Correlates a durable agenda entry with the exact GoalDirector or
    // JobDirector outcome it launched. Older stores do not contain this field;
    // AgendaDirector has a strict contract fallback for that one migration
    // case, then every newly dispatched executor records its id here.
    executorId: boundedText(raw.executorId, 96),
    createdAt,
    startedAt: Number.isFinite(raw.startedAt) ? raw.startedAt : null,
    finishedAt: Number.isFinite(raw.finishedAt) ? raw.finishedAt : null,
    attempts: finiteInteger(raw.attempts, 0, 0, 16),
    evidence: Object.freeze({
      code: boundedText(raw.evidence?.code, 64),
      detail: boundedText(raw.evidence?.detail, 240),
    }),
  });
}

/** Human-readable one-liner used in chat and telemetry. */
export function describeAgendaEntry(entry) {
  if (!entry) return '';
  const readable = String(entry.target || '').replace(/_/g, ' ');
  switch (entry.kind) {
    case 'acquire': return entry.completion === 'inventory'
      ? `get ${entry.quantity} ${readable}`
      : `get and equip ${readable} in the ${entry.completion === 'main_hand' ? 'main hand' : 'offhand'}`;
    case 'deliver': return `deliver ${entry.quantity} ${readable} to ${entry.recipient}`;
    case 'mine': return `mine ${entry.quantity} ${readable}`;
    case 'harvest': return `harvest ${entry.quantity} ${readable}`;
    case 'stockpile': return `stockpile ${entry.quantity} ${readable}`;
    case 'craft': return `craft ${entry.quantity} ${readable}`;
    case 'smelt': return `smelt ${entry.quantity} ${readable}`;
    case 'farm_visit': return 'go to the remembered farm';
    case 'maintain_farm': return 'harvest and replant the remembered farm';
    case 'deposit': return `put up to ${entry.quantity} ${readable} in the nearest existing chest`;
    case 'shelter': return 'build a shelter';
    case 'construction': return 'build the requested structure';
    case 'sleep': return 'go inside and sleep';
    case 'goto': return `go to ${entry.recipient}`;
    case 'follow_until': return `follow ${entry.recipient} until both are near ${readable}`;
    case 'visit': return `patrol to ${entry.x}, ${entry.y}, ${entry.z}`;
    default: return entry.kind;
  }
}

export class AgendaStore {
  constructor(agentName, { root = './bots' } = {}) {
    if (!SAFE_AGENT_NAME.test(String(agentName || ''))) {
      throw new TypeError('Agenda bot name is invalid.');
    }
    this.directory = path.resolve(root, agentName);
    this.filePath = path.join(this.directory, 'agenda.json');
    this.lastError = null;
    mkdirSync(this.directory, { recursive: true });
  }

  load() {
    this.lastError = null;
    if (!existsSync(this.filePath)) return [];
    try {
      if (statSync(this.filePath).size > MAX_STORE_BYTES) {
        throw new TypeError('Agenda file exceeds the size limit.');
      }
      const document = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (document?.version !== STORE_VERSION) {
        throw new TypeError(`Unsupported agenda version '${document?.version}'.`);
      }
      if (!Array.isArray(document.entries)) return [];
      const restored = [];
      for (const raw of document.entries.slice(0, MAX_ENTRIES)) {
        try {
          const entry = normalizeAgendaEntry(raw);
          // Preserve an active entry so AgendaDirector can reconcile it with
          // GoalDirector/JobDirector's independently persisted executor state.
          // Blindly returning it to pending loses a terminal result that landed
          // just before a process interruption and can repeat delivered work.
          restored.push(entry);
        } catch {
          // One malformed entry must not discard an otherwise valid plan.
        }
      }
      return restored;
    } catch (error) {
      this.lastError = boundedText(error?.message || error, 280);
      return [];
    }
  }

  save(entries) {
    try {
      writeJsonAtomicSync(this.filePath, {
        version: STORE_VERSION,
        entries: (Array.isArray(entries) ? entries : []).slice(0, MAX_ENTRIES),
        savedAt: Date.now(),
      });
      this.lastError = null;
      return true;
    } catch (error) {
      this.lastError = boundedText(error?.message || error, 280);
      return false;
    }
  }
}

export const AGENDA_LIMITS = Object.freeze({ maxEntries: MAX_ENTRIES, maxQuantity: MAX_QUANTITY });
