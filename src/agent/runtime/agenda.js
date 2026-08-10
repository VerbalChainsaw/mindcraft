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
const MAX_INVENTORY_REQUIREMENTS = 12;
const MAX_STORAGE_REQUIREMENTS = 12;
const MAX_EXPLORATION_OUTPUTS = 12;
const MAX_INVENTORY_RECONCILIATIONS = 12;
const MAX_NOTE = 160;
const ACQUIRE_COMPLETIONS = new Set(['inventory', 'main_hand', 'off_hand']);
const ACQUIRE_QUANTITY_MODES = new Set(['additional', 'minimum']);
const SAFE_ENTRY_ID = /^[A-Za-z0-9_.:-]{1,96}$/;
const CONSTRUCTION_ASSIGNMENT_STATES = new Set([
  'queued',
  'compiling',
  'accepted_and_bound',
  'rejected',
  'interrupted',
  'cancelled',
  'compilation_exhausted',
]);
const CONSTRUCTION_FUNCTIONS = new Set([
  'access',
  'crafting',
  'daylight',
  'containment',
  'enclosure',
  'interior_light',
  'rest',
  'smelting',
  'storage',
  'weather_cover',
]);
const DEPENDENCY_POLICIES = new Set(['requires_success', 'after_settlement']);
const BINDING_KINDS = new Set(['world_block', 'structure_fixture']);
const CONTAINER_NAMES = new Set(['chest', 'trapped_chest', 'barrel']);
const HORIZONTAL_FACINGS = new Set(['north', 'south', 'east', 'west']);
const SCOUT_FINDINGS = new Set(['cave', 'animal']);

export const AGENDA_KINDS = Object.freeze({
  acquire: Object.freeze({ executor: 'goal', needsTarget: true, needsQuantity: true }),
  // A model-compiled inventory plan is one aggregate promise, not a bag of
  // independently terminal item goals. This typed barrier performs no physical
  // work itself. AgendaDirector reads fresh inventory and, when necessary,
  // sequences one ordinary GoalDirector acquisition before checking the whole
  // promise again.
  inventory_checklist: Object.freeze({ executor: 'goal', needsTarget: false, needsQuantity: false }),
  deliver: Object.freeze({ executor: 'goal', needsTarget: true, needsQuantity: true, needsRecipient: true }),
  mine: Object.freeze({ executor: 'job', needsTarget: true, needsQuantity: true }),
  harvest: Object.freeze({ executor: 'job', needsTarget: true, needsQuantity: true }),
  stockpile: Object.freeze({ executor: 'job', needsTarget: true, needsQuantity: true }),
  explore: Object.freeze({ executor: 'job', needsTarget: true, needsQuantity: true, needsPoint: true }),
  // Scouting is one durable player outcome: observe requested world facts,
  // remember their exact verified positions, return to the requester, then
  // lead them to the requested finding. The job owns the whole route so live
  // coordinates never have to leak through several independently settling
  // agenda entries.
  scout: Object.freeze({ executor: 'job', needsTarget: false, needsQuantity: false, needsPoint: true, needsRadius: true }),
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
  // A storage cleanup is one atomic, restart-safe retained-inventory contract.
  // The model may choose the concrete carried items, but the persisted plan
  // contains only canonical names, retained counts, and one exact container.
  storage_plan: Object.freeze({ executor: 'direct', needsTarget: false, needsQuantity: false }),
  // Food stocking is two ordinary bounded mechanics joined by the durable
  // queue: prepare additional safe food at one exact furnace, then deposit
  // only that new output in one exact container.
  prepare_food: Object.freeze({ executor: 'direct', needsTarget: false, needsQuantity: true }),
  deposit_family: Object.freeze({ executor: 'direct', needsTarget: true, needsQuantity: true }),
  // One owned livestock action keeps attraction, gate state, breeding, and
  // final enclosure verification inside the same cancellation lease.
  settle_livestock: Object.freeze({ executor: 'direct', needsTarget: true, needsQuantity: true, needsPoint: true, needsPen: true }),
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

function normalizeBindingRequest(raw) {
  if (raw == null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Agenda binding request must be an object.');
  }
  const kind = canonical(raw.kind);
  if (!BINDING_KINDS.has(kind)) throw new TypeError('Agenda binding request kind is unsupported.');
  if (kind === 'world_block') {
    const name = canonical(raw.name);
    if (!CANONICAL_NAME.test(name) || !isNameFaithful(raw.name, name)) {
      throw new TypeError('World-block binding needs a canonical block name.');
    }
    return Object.freeze({ kind, name });
  }
  const fixtureFunction = canonical(raw.function);
  if (!CONSTRUCTION_FUNCTIONS.has(fixtureFunction)) {
    throw new TypeError('Structure-fixture binding needs a supported function.');
  }
  return Object.freeze({ kind, function: fixtureFunction });
}

function normalizeBindingConstraint(raw) {
  if (raw == null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Agenda binding constraint must be an object.');
  }
  const kind = canonical(raw.kind);
  if (!BINDING_KINDS.has(kind)) throw new TypeError('Agenda binding constraint kind is unsupported.');
  const position = {
    x: finiteInteger(raw.position?.x, NaN, -30e6, 30e6),
    y: finiteInteger(raw.position?.y, NaN, -256, 512),
    z: finiteInteger(raw.position?.z, NaN, -30e6, 30e6),
  };
  if (Object.values(position).some(value => !Number.isFinite(value))) {
    throw new TypeError('Agenda binding constraint needs finite coordinates.');
  }
  const dimension = canonical(raw.dimension);
  const sourceEntryId = boundedText(raw.sourceEntryId, 96);
  if (!CANONICAL_NAME.test(dimension) || !SAFE_ENTRY_ID.test(sourceEntryId)) {
    throw new TypeError('Agenda binding constraint identity is invalid.');
  }
  if (kind === 'world_block') {
    const name = canonical(raw.name);
    if (!CANONICAL_NAME.test(name)) throw new TypeError('World-block binding name is invalid.');
    return Object.freeze({ kind, name, position: Object.freeze(position), dimension, sourceEntryId });
  }
  const fixtureFunction = canonical(raw.function);
  const material = canonical(raw.material);
  const facing = canonical(raw.facing);
  const structureOrderId = boundedText(raw.structureOrderId, 96);
  const fixtureId = canonical(raw.fixtureId);
  if (
    !CONSTRUCTION_FUNCTIONS.has(fixtureFunction)
    || !CANONICAL_NAME.test(material)
    || !CANONICAL_NAME.test(fixtureId)
    || !SAFE_ENTRY_ID.test(structureOrderId)
    || !HORIZONTAL_FACINGS.has(facing)
  ) throw new TypeError('Structure-fixture binding identity is invalid.');
  return Object.freeze({
    kind,
    function: fixtureFunction,
    fixtureId,
    structureOrderId,
    position: Object.freeze(position),
    dimension,
    material,
    facing,
    sourceEntryId,
  });
}

function normalizeContainerConstraint(raw) {
  if (raw == null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Agenda container constraint must be an object.');
  }
  const name = canonical(raw.name);
  const position = {
    x: finiteInteger(raw.position?.x, NaN, -30e6, 30e6),
    y: finiteInteger(raw.position?.y, NaN, -256, 512),
    z: finiteInteger(raw.position?.z, NaN, -30e6, 30e6),
  };
  const dimension = canonical(raw.dimension);
  if (
    !CONTAINER_NAMES.has(name)
    || Object.values(position).some(value => !Number.isFinite(value))
    || !CANONICAL_NAME.test(dimension)
  ) throw new TypeError('Agenda container constraint must identify one exact chest or barrel.');
  return Object.freeze({
    name,
    position: Object.freeze(position),
    dimension,
    source: boundedText(raw.source, 48) || 'player_context_here',
    observedAt: Number.isFinite(raw.observedAt) ? raw.observedAt : Date.now(),
  });
}

function normalizePenConstraint(raw) {
  if (raw == null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Agenda pen constraint must be an object.');
  }
  const normalizePoint = (point, label) => {
    const normalized = {
      x: finiteInteger(point?.x, NaN, -30e6, 30e6),
      y: finiteInteger(point?.y, NaN, -256, 512),
      z: finiteInteger(point?.z, NaN, -30e6, 30e6),
    };
    if (Object.values(normalized).some(value => !Number.isFinite(value))) {
      throw new TypeError(`Agenda pen ${label} needs finite coordinates.`);
    }
    return Object.freeze(normalized);
  };
  const gate = normalizePoint(raw.gate, 'gate');
  const inside = normalizePoint(raw.inside, 'inside stance');
  const outside = normalizePoint(raw.outside, 'outside stance');
  const bounds = {
    minX: finiteInteger(raw.bounds?.minX, NaN, -30e6, 30e6),
    maxX: finiteInteger(raw.bounds?.maxX, NaN, -30e6, 30e6),
    minZ: finiteInteger(raw.bounds?.minZ, NaN, -30e6, 30e6),
    maxZ: finiteInteger(raw.bounds?.maxZ, NaN, -30e6, 30e6),
    y: finiteInteger(raw.bounds?.y, NaN, -256, 512),
  };
  const dimension = canonical(raw.dimension);
  if (
    Object.values(bounds).some(value => !Number.isFinite(value))
    || bounds.minX >= bounds.maxX
    || bounds.minZ >= bounds.maxZ
    || !CANONICAL_NAME.test(dimension)
    || gate.y !== bounds.y
    || inside.x <= bounds.minX
    || inside.x >= bounds.maxX
    || inside.z <= bounds.minZ
    || inside.z >= bounds.maxZ
  ) throw new TypeError('Agenda pen constraint must identify one exact bounded enclosure.');
  return Object.freeze({
    gate,
    inside,
    outside,
    bounds: Object.freeze(bounds),
    dimension,
    baselineAnimals: finiteInteger(raw.baselineAnimals, 0, 0, MAX_QUANTITY),
  });
}

function normalizeBaselineInventory(raw) {
  if (!Array.isArray(raw)) {
    throw new TypeError('An agenda family deposit needs a typed baseline inventory.');
  }
  const counts = new Map();
  for (const item of raw.slice(0, 36)) {
    const name = canonical(item?.name);
    const count = finiteInteger(item?.count, 0, 0, MAX_QUANTITY);
    if (!CANONICAL_NAME.test(name) || !isNameFaithful(item?.name, name)) {
      throw new TypeError('An agenda baseline inventory item name is invalid.');
    }
    if (count > 0) counts.set(name, Math.min(MAX_QUANTITY, (counts.get(name) || 0) + count));
  }
  return Object.freeze([...counts.entries()]
    .map(([name, count]) => Object.freeze({ name, count }))
    .sort((left, right) => left.name.localeCompare(right.name)));
}

function normalizeInventoryRequirements(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_INVENTORY_REQUIREMENTS) {
    throw new TypeError(`An inventory checklist needs 1-${MAX_INVENTORY_REQUIREMENTS} typed requirements.`);
  }
  const seen = new Set();
  return Object.freeze(raw.map(requirement => {
    if (!requirement || typeof requirement !== 'object' || Array.isArray(requirement)) {
      throw new TypeError('An inventory checklist requirement must be an object.');
    }
    const target = canonical(requirement.target);
    if (!CANONICAL_NAME.test(target) || !isNameFaithful(requirement.target, target)) {
      throw new TypeError('An inventory checklist requirement needs a canonical target name.');
    }
    if (seen.has(target)) throw new TypeError(`Inventory checklist target '${target}' is duplicated.`);
    seen.add(target);
    return Object.freeze({
      target,
      quantity: finiteInteger(requirement.quantity, 1, 1, MAX_QUANTITY),
    });
  }));
}

function normalizeStorageRequirements(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_STORAGE_REQUIREMENTS) {
    throw new TypeError(`A storage plan needs 1-${MAX_STORAGE_REQUIREMENTS} typed requirements.`);
  }
  const seen = new Set();
  return Object.freeze(raw.map(requirement => {
    if (!requirement || typeof requirement !== 'object' || Array.isArray(requirement)) {
      throw new TypeError('A storage requirement must be an object.');
    }
    const target = canonical(requirement.target);
    if (!CANONICAL_NAME.test(target) || !isNameFaithful(requirement.target, target)) {
      throw new TypeError('A storage requirement needs a canonical target name.');
    }
    if (seen.has(target)) throw new TypeError(`Storage target '${target}' is duplicated.`);
    seen.add(target);
    return Object.freeze({
      target,
      retain: finiteInteger(requirement.retain, 0, 0, MAX_QUANTITY),
    });
  }));
}

function normalizeExplorationOutputs(raw) {
  if (raw == null) return Object.freeze([]);
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_EXPLORATION_OUTPUTS) {
    throw new TypeError(`An exploration request needs 1-${MAX_EXPLORATION_OUTPUTS} typed outputs.`);
  }
  const seen = new Set();
  return Object.freeze(raw.map(requirement => {
    if (!requirement || typeof requirement !== 'object' || Array.isArray(requirement)) {
      throw new TypeError('An exploration output must be an object.');
    }
    const source = canonical(requirement.source);
    const item = canonical(requirement.item);
    if (
      !CANONICAL_NAME.test(source)
      || !CANONICAL_NAME.test(item)
      || !isNameFaithful(requirement.source, source)
      || !isNameFaithful(requirement.item, item)
    ) throw new TypeError('An exploration output needs canonical source and item names.');
    if (seen.has(item)) throw new TypeError(`Exploration output '${item}' is duplicated.`);
    seen.add(item);
    return Object.freeze({
      source,
      item,
      quantity: finiteInteger(requirement.quantity, 1, 1, MAX_QUANTITY),
    });
  }));
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
  const quantityMode = kind === 'acquire'
    ? canonical(raw.quantityMode || 'additional')
    : '';
  if (kind === 'acquire' && !ACQUIRE_QUANTITY_MODES.has(quantityMode)) {
    throw new TypeError('Agenda acquire quantity mode must be additional or minimum.');
  }
  if (kind === 'acquire' && quantityMode === 'minimum' && completion !== 'inventory') {
    throw new TypeError('Minimum quantity mode is only valid for inventory acquisition.');
  }
  if (kind === 'acquire' && completion !== 'inventory' && finiteInteger(raw.quantity, 1, 1, MAX_QUANTITY) !== 1) {
    throw new TypeError('An agenda hand-equipment step must request exactly one item.');
  }
  const rawWorkstation = ['smelt', 'prepare_food'].includes(kind)
    ? raw.workstationConstraint
    : null;
  const normalizedWorkstation = normalizeWorkstationConstraint(rawWorkstation);
  if (rawWorkstation != null && !normalizedWorkstation) {
    throw new TypeError('An agenda workstation constraint is invalid.');
  }
  if (kind === 'prepare_food' && !normalizedWorkstation) {
    throw new TypeError('A food preparation step needs one exact furnace.');
  }
  const containerConstraint = ['deposit', 'deposit_family', 'storage_plan', 'explore'].includes(kind)
    ? normalizeContainerConstraint(raw.containerConstraint)
    : null;
  const penConstraint = kind === 'settle_livestock'
    ? normalizePenConstraint(raw.penConstraint)
    : null;
  if (kind === 'settle_livestock' && !penConstraint) {
    throw new TypeError('A livestock settlement step needs one exact pen.');
  }
  if (kind === 'explore' && !containerConstraint && raw.retainResults !== true) {
    throw new TypeError('An exploration step needs one exact home container.');
  }
  const homeDimension = ['explore', 'scout'].includes(kind)
    ? canonical(raw.homeDimension || containerConstraint?.dimension)
    : '';
  if (['explore', 'scout'].includes(kind) && !CANONICAL_NAME.test(homeDimension)) {
    throw new TypeError('An exploration or scout step needs one exact home dimension.');
  }
  if (kind === 'explore' && containerConstraint && containerConstraint.dimension !== homeDimension) {
    throw new TypeError('An exploration home dimension must match its selected container.');
  }
  if (kind === 'deposit_family' && !containerConstraint) {
    throw new TypeError('A family deposit step needs one exact chest or barrel.');
  }
  if (kind === 'storage_plan' && !containerConstraint) {
    throw new TypeError('A storage plan needs one exact chest or barrel.');
  }
  const baselineInventory = kind === 'deposit_family'
    ? normalizeBaselineInventory(raw.baselineInventory)
    : null;
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
  const dependsOnEntryId = boundedText(raw.dependsOnEntryId, 96);
  if (dependsOnEntryId && (!SAFE_ENTRY_ID.test(dependsOnEntryId) || dependsOnEntryId === identity)) {
    throw new TypeError('Agenda dependency identity is invalid.');
  }
  const dependencyPolicy = dependsOnEntryId
    ? canonical(raw.dependencyPolicy || 'requires_success')
    : '';
  if (dependencyPolicy && !DEPENDENCY_POLICIES.has(dependencyPolicy)) {
    throw new TypeError('Agenda dependency policy is unsupported.');
  }
  const bindingRequest = normalizeBindingRequest(raw.bindingRequest);
  const bindingConstraint = normalizeBindingConstraint(raw.bindingConstraint);
  if ((bindingRequest || bindingConstraint) && !dependsOnEntryId) {
    throw new TypeError('Agenda binding requires an exact predecessor entry.');
  }
  if (bindingRequest && bindingConstraint && bindingRequest.kind !== bindingConstraint.kind) {
    throw new TypeError('Agenda binding request and constraint kinds do not match.');
  }
  if ((bindingRequest || bindingConstraint) && dependencyPolicy !== 'requires_success') {
    throw new TypeError('Agenda bindings require a successful predecessor.');
  }
  const requiredFunctions = kind === 'construction'
    ? [...new Set((Array.isArray(raw.constructionIntent?.requiredFunctions)
      ? raw.constructionIntent.requiredFunctions
      : [])
      .map(canonical)
      .filter(value => CONSTRUCTION_FUNCTIONS.has(value)))]
    : [];
  const assignmentState = kind === 'construction'
    ? (CONSTRUCTION_ASSIGNMENT_STATES.has(canonical(raw.assignmentState))
      ? canonical(raw.assignmentState)
      : 'queued')
    : '';
  const inventoryRequirements = kind === 'inventory_checklist'
    ? normalizeInventoryRequirements(raw.inventoryRequirements)
    : null;
  const storageRequirements = kind === 'storage_plan'
    ? normalizeStorageRequirements(raw.storageRequirements)
    : null;
  const requiredOutputs = kind === 'explore'
    ? normalizeExplorationOutputs(raw.requiredOutputs)
    : Object.freeze([]);
  const scoutFindings = kind === 'scout'
    ? Object.freeze([...new Set((Array.isArray(raw.findings) ? raw.findings : [])
      .map(canonical)
      .filter(value => SCOUT_FINDINGS.has(value)))])
    : Object.freeze([]);
  if (kind === 'scout' && scoutFindings.length === 0) {
    throw new TypeError('A scout step needs at least one supported finding.');
  }
  const scoutGuideFinding = kind === 'scout' ? canonical(raw.guideFinding) : '';
  if (scoutGuideFinding && !scoutFindings.includes(scoutGuideFinding)) {
    throw new TypeError('A scout guide target must belong to its requested findings.');
  }
  const reconciliationTarget = kind === 'inventory_checklist'
    ? canonical(raw.reconciliationTarget)
    : '';
  if (
    reconciliationTarget
    && !inventoryRequirements.some(requirement => requirement.target === reconciliationTarget)
  ) throw new TypeError('An inventory checklist correction target must belong to its requirements.');

  return Object.freeze({
    id: identity,
    kind,
    executor: spec.executor,
    target,
    quantity: spec.needsQuantity ? finiteInteger(raw.quantity, 1, 1, MAX_QUANTITY) : 0,
    ...(kind === 'settle_livestock' ? {
      breedingPairs: finiteInteger(raw.breedingPairs, 1, 1, 4),
    } : {}),
    ...(kind === 'acquire' ? { quantityMode } : {}),
    ...(baselineInventory ? { baselineInventory } : {}),
    ...(kind === 'prepare_food'
      ? { baselineFoodPoints: finiteInteger(raw.baselineFoodPoints, 0, 0, MAX_QUANTITY) }
      : {}),
    ...(['explore', 'prepare_food'].includes(kind) && raw.bestEffort === true ? { bestEffort: true } : {}),
    ...(kind === 'explore' && raw.retainResults === true ? { retainResults: true } : {}),
    ...(requiredOutputs.length > 0 ? { requiredOutputs } : {}),
    ...(scoutFindings.length > 0 ? { findings: scoutFindings } : {}),
    ...(scoutGuideFinding ? { guideFinding: scoutGuideFinding } : {}),
    completion,
    recipient: spec.needsRecipient ? recipient : '',
    requester,
    radius: spec.needsRadius
      ? finiteInteger(raw.radius, kind === 'scout' ? 64 : 8, 2, kind === 'scout' ? 128 : 32)
      : 0,
    x: point ? point.x : 0,
    y: point ? point.y : 0,
    z: point ? point.z : 0,
    ...(['explore', 'scout'].includes(kind) ? { homeDimension } : {}),
    workstationConstraint: normalizedWorkstation
      ? Object.freeze({ ...normalizedWorkstation, sourceEntryId })
      : null,
    ...(containerConstraint ? { containerConstraint } : {}),
    ...(penConstraint ? { penConstraint } : {}),
    dependsOnEntryId,
    dependencyPolicy,
    bindingRequest,
    bindingConstraint,
    constructionIntent: kind === 'construction'
      ? Object.freeze({ requiredFunctions: Object.freeze(requiredFunctions) })
      : null,
    assignmentState,
    ...(inventoryRequirements ? {
      inventoryRequirements,
      reconciliationTarget,
      reconciliations: finiteInteger(
        raw.reconciliations,
        0,
        0,
        MAX_INVENTORY_RECONCILIATIONS,
      ),
    } : {}),
    ...(storageRequirements ? { storageRequirements } : {}),
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
      ? entry.quantityMode === 'minimum'
        ? `ensure at least ${entry.quantity} ${readable}`
        : `get ${entry.quantity} additional ${readable}`
      : `get and equip ${readable} in the ${entry.completion === 'main_hand' ? 'main hand' : 'offhand'}`;
    case 'inventory_checklist': return `verify ${entry.inventoryRequirements.length} final inventory floor${entry.inventoryRequirements.length === 1 ? '' : 's'}`;
    case 'deliver': return `deliver ${entry.quantity} ${readable} to ${entry.recipient}`;
    case 'mine': return `mine ${entry.quantity} ${readable}`;
    case 'harvest': return `harvest ${entry.quantity} ${readable}`;
    case 'stockpile': return `stockpile ${entry.quantity} ${readable}`;
    case 'explore': return entry.retainResults
      ? `explore a cave, collect a useful ${entry.quantity}-${readable} batch containing ${entry.requiredOutputs.map(requirement => requirement.item.replace(/_/g, ' ')).join(' and ')}, and retain it`
      : `explore and light a cave, collect ${entry.quantity} ${readable}, return, and store the result`;
    case 'scout': return `scout for ${entry.findings.join(' and ')}, remember the verified locations, return, and guide ${entry.requester} to ${entry.guideFinding || entry.findings[0]}`;
    case 'settle_livestock': return `bring ${entry.quantity} ${readable} to the selected pen, breed ${entry.breedingPairs} pair, and close the gate`;
    case 'craft': return `craft ${entry.quantity} ${readable}`;
    case 'smelt': return `smelt ${entry.quantity} ${readable}`;
    case 'farm_visit': return 'go to the remembered farm';
    case 'maintain_farm': return 'harvest and replant the remembered farm';
    case 'deposit': return entry.containerConstraint
      ? `put up to ${entry.quantity} ${readable} in the selected ${entry.containerConstraint.name.replace(/_/g, ' ')}`
      : `put up to ${entry.quantity} ${readable} in the nearest existing chest`;
    case 'storage_plan': return `store ${entry.storageRequirements.length} authorized inventory group${entry.storageRequirements.length === 1 ? '' : 's'} in the selected ${entry.containerConstraint.name.replace(/_/g, ' ')}`;
    case 'prepare_food': return `prepare ${entry.quantity} additional safe food points at the selected furnace`;
    case 'deposit_family': return `put the newly prepared ${readable} in the selected ${entry.containerConstraint.name.replace(/_/g, ' ')}`;
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
