import { randomUUID } from 'node:crypto';

import { inspectGameObject } from '../library/game_knowledge.js';
import * as mc from '../../utils/mcdata.js';

const GOAL_KINDS = new Set(['acquire', 'deliver']);
const COMPLETION_KINDS = new Set(['inventory', 'main_hand', 'off_hand', 'delivery']);
const GOAL_PHASES = new Set([
  'assess',
  'acquire',
  'verify_acquired',
  'deliver',
  'verify_complete',
  'recover',
  'complete',
  'failed',
  'cancelled',
]);
const SUBGOAL_STATES = new Set(['pending', 'acting', 'succeeded', 'failed', 'cancelled']);
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,96}$/;
const SAFE_PLAYER = /^[A-Za-z0-9_. -]{1,64}$/;
const CANONICAL_NAME = /^[a-z0-9_]{1,80}$/;
// Buried targets are bound within a 64-block collection radius, while the
// deterministic corridor contract permits vertical distance + 32 bounded
// dogleg steps + 2. Leave room for that 98-step physical route plus generic
// tool, fuel, workstation, smelt, craft, and equip prerequisites. This remains
// a hard finite ceiling; productive failures retain their separate four-attempt
// limit and every physical action retains its own time/destruction budget.
const MAX_SUBGOALS = 128;
const MAX_QUANTITY = 2304;
const MAX_FAILED_TARGETS = 24;

const SMALL_NUMBERS = Object.freeze({
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
});
const TENS = Object.freeze({
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
});
const NUMBER_WORDS = new Set([
  ...Object.keys(SMALL_NUMBERS),
  ...Object.keys(TENS),
  'hundred',
  'thousand',
  'and',
]);

const FAMILY_ALIASES = Object.freeze({
  logs: new Set(['log', 'logs', 'wood', 'woods', 'tree wood']),
  planks: new Set(['plank', 'planks', 'wood plank', 'wood planks']),
});

function boundedText(value, maximum, fallback = '') {
  return Array.from(String(value ?? fallback), character => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? ' ' : character;
  }).join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function finiteInteger(value, fallback, minimum, maximum) {
  const number = Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function canonicalName(value) {
  return boundedText(value, 80)
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function normalizeCompletion(raw, kind, quantity) {
  const fallback = kind === 'deliver' ? 'delivery' : 'inventory';
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw.kind
    : raw;
  const completionKind = source == null || source === ''
    ? fallback
    : canonicalName(source);
  if (!COMPLETION_KINDS.has(completionKind)) {
    throw new TypeError('Goal completion must be inventory, main_hand, off_hand, or delivery.');
  }
  if (kind === 'deliver' && completionKind !== 'delivery') {
    throw new TypeError('Delivery goals require verified delivery completion.');
  }
  if (kind === 'acquire' && completionKind === 'delivery') {
    throw new TypeError('Acquire goals cannot use delivery completion.');
  }
  if (['main_hand', 'off_hand'].includes(completionKind) && quantity !== 1) {
    throw new TypeError('A hand-equipment goal must request exactly one item.');
  }
  return Object.freeze({ kind: completionKind });
}

function hasBlockDropSource(bot, name) {
  const itemId = bot?.registry?.itemsByName?.[name]?.id;
  if (!Number.isInteger(itemId)) return false;
  return Object.values(bot?.registry?.blocks || {}).some(block => (
    block?.diggable === true
    && Array.isArray(block.drops)
    && block.drops.includes(itemId)
  ));
}

function normalizeMessage(value) {
  return boundedText(value, 500)
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function aliasForms(name, displayName = '') {
  const forms = new Set([
    String(name || '').replaceAll('_', ' ').toLowerCase(),
    String(displayName || '').toLowerCase(),
  ]);
  for (const form of [...forms]) {
    if (!form) continue;
    const words = form.split(/\s+/);
    const last = words.at(-1);
    if (last && !last.endsWith('s')) {
      forms.add([...words.slice(0, -1), `${last}s`].join(' '));
    }
  }
  return [...forms].filter(Boolean);
}

function registryMention(bot, normalizedMessage) {
  const entries = new Map();
  for (const [name, item] of Object.entries(bot?.registry?.itemsByName || {})) {
    entries.set(name, { name, displayName: item?.displayName || '' });
  }
  for (const [name, block] of Object.entries(bot?.registry?.blocksByName || {})) {
    const current = entries.get(name);
    entries.set(name, {
      name,
      displayName: current?.displayName || block?.displayName || '',
    });
  }

  let best = null;
  for (const entry of entries.values()) {
    for (const alias of aliasForms(entry.name, entry.displayName)) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`).test(normalizedMessage)) continue;
      if (!best || alias.length > best.alias.length) best = { ...entry, alias };
    }
  }
  return best;
}

function familyMention(normalizedMessage) {
  let best = null;
  for (const [family, aliases] of Object.entries(FAMILY_ALIASES)) {
    for (const alias of aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`).test(normalizedMessage)) continue;
      if (!best || alias.length > best.alias.length) best = { family, alias };
    }
  }
  return best;
}

function parseNumberWordSequence(words) {
  let total = 0;
  let current = 0;
  let consumed = false;
  for (const word of words) {
    if (word === 'and') continue;
    if (Object.hasOwn(SMALL_NUMBERS, word)) {
      current += SMALL_NUMBERS[word];
      consumed = true;
      continue;
    }
    if (Object.hasOwn(TENS, word)) {
      current += TENS[word];
      consumed = true;
      continue;
    }
    if (word === 'hundred') {
      current = Math.max(1, current) * 100;
      consumed = true;
      continue;
    }
    if (word === 'thousand') {
      total += Math.max(1, current) * 1000;
      current = 0;
      consumed = true;
      continue;
    }
    break;
  }
  return consumed ? total + current : null;
}

export function requestedQuantity(message) {
  const normalized = normalizeMessage(message);
  const digit = normalized.match(/(?:^|\s)(\d{1,4})(?=\s|$)/);
  if (digit) return finiteInteger(Number.parseInt(digit[1], 10), 1, 1, MAX_QUANTITY);

  const words = normalized.split(/\s+/);
  for (let start = 0; start < words.length; start += 1) {
    if (!NUMBER_WORDS.has(words[start])) continue;
    const sequence = [];
    for (let index = start; index < words.length && NUMBER_WORDS.has(words[index]); index += 1) {
      sequence.push(words[index]);
    }
    const parsed = parseNumberWordSequence(sequence);
    if (Number.isFinite(parsed) && parsed > 0) {
      return finiteInteger(parsed, 1, 1, MAX_QUANTITY);
    }
  }
  if (/(?:^|\s)(?:a|an)(?=\s)/.test(normalized)) return 1;
  return null;
}

export function resolveItemGoalTarget(bot, requestedName) {
  const requested = canonicalName(requestedName);
  if (!requested) return null;

  for (const [family, aliases] of Object.entries(FAMILY_ALIASES)) {
    if (family === requested || aliases.has(requested.replaceAll('_', ' '))) {
      return Object.freeze({
        requestedName: requested,
        canonicalName: family,
        inventoryName: family,
        acquisitionName: family,
        family,
        acquisitionKind: family === 'logs' ? 'collect_family' : 'prepare_material',
      });
    }
  }

  const knowledge = inspectGameObject(bot, requested);
  if (!knowledge?.found) return null;
  const canonical = canonicalName(knowledge.canonicalName);
  const isTool = knowledge.capabilities?.includes('tool');
  const isCollectibleBlock = Boolean(
    knowledge.block?.diggable
    && (
      knowledge.block.drops?.length === 0
      || knowledge.block.drops.includes(canonical)
    )
  );
  let acquisitionKind = 'unsupported';
  if (isTool) acquisitionKind = 'prepare_tool';
  else if (['cobblestone', 'dirt', 'torch'].includes(canonical) || canonical.endsWith('_planks')) {
    acquisitionKind = 'prepare_material';
  } else if (isCollectibleBlock) acquisitionKind = 'collect_block';
  else if (knowledge.recipes?.length > 0) acquisitionKind = 'craft';
  else if (mc.getItemSmeltingIngredient(canonical) || hasBlockDropSource(bot, canonical)) {
    acquisitionKind = 'planned';
  }

  return Object.freeze({
    requestedName: requested,
    canonicalName: canonical,
    inventoryName: canonical,
    acquisitionName: canonical,
    family: null,
    acquisitionKind,
  });
}

function normalizeTarget(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Goal target must be an object.');
  }
  const target = {
    requestedName: canonicalName(raw.requestedName),
    canonicalName: canonicalName(raw.canonicalName),
    inventoryName: canonicalName(raw.inventoryName),
    acquisitionName: canonicalName(raw.acquisitionName),
    family: raw.family == null ? null : canonicalName(raw.family),
    acquisitionKind: boundedText(raw.acquisitionKind, 32),
  };
  if (
    !CANONICAL_NAME.test(target.requestedName)
    || !CANONICAL_NAME.test(target.canonicalName)
    || !CANONICAL_NAME.test(target.inventoryName)
    || !CANONICAL_NAME.test(target.acquisitionName)
  ) throw new TypeError('Goal target names must be canonical.');
  if (target.family !== null && !Object.hasOwn(FAMILY_ALIASES, target.family)) {
    throw new TypeError('Goal target family is unsupported.');
  }
  if (!['collect_family', 'collect_block', 'prepare_tool', 'prepare_material', 'craft', 'planned'].includes(target.acquisitionKind)) {
    throw new TypeError('Goal target does not have a deterministic acquisition path.');
  }
  return Object.freeze(target);
}

function normalizeEvidence(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return Object.freeze({
    actionId: boundedText(raw.actionId, 96),
    phase: boundedText(raw.phase, 24),
    code: boundedText(raw.code, 80),
    detail: boundedText(raw.detail, 360),
    verified: raw.verified === true,
    at: Number.isFinite(raw.at) ? raw.at : Date.now(),
  });
}

function normalizeFailedTarget(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const position = raw.position && typeof raw.position === 'object' && !Array.isArray(raw.position)
    ? raw.position
    : raw;
  const coordinates = ['x', 'y', 'z'].map(axis => Number(position[axis]));
  if (!coordinates.every(Number.isFinite)) return null;
  const name = canonicalName(raw.name);
  if (!name) return null;
  const firstFailedAt = Number.isFinite(raw.firstFailedAt) ? raw.firstFailedAt : Date.now();
  const lastFailedAt = Number.isFinite(raw.lastFailedAt) ? raw.lastFailedAt : firstFailedAt;
  return Object.freeze({
    kind: boundedText(raw.kind || 'action', 32),
    name,
    position: Object.freeze({
      x: Math.floor(coordinates[0]),
      y: Math.floor(coordinates[1]),
      z: Math.floor(coordinates[2]),
    }),
    code: boundedText(raw.code, 80),
    failures: finiteInteger(raw.failures, 1, 1, 8),
    firstFailedAt,
    lastFailedAt,
    avoidUntil: Number.isFinite(raw.avoidUntil) ? raw.avoidUntil : lastFailedAt,
  });
}

function normalizeToolRequirement(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const name = canonicalName(raw.name);
  if (!name) return null;
  const targetPosition = raw.target?.position && typeof raw.target.position === 'object'
    ? raw.target.position
    : raw.target;
  const targetName = canonicalName(raw.target?.name);
  const targetCoordinates = targetPosition
    ? ['x', 'y', 'z'].map(axis => Number(targetPosition[axis]))
    : [];
  const target = targetName && targetCoordinates.every(Number.isFinite)
    ? Object.freeze({
        name: targetName,
        position: Object.freeze({
          x: Math.floor(targetCoordinates[0]),
          y: Math.floor(targetCoordinates[1]),
          z: Math.floor(targetCoordinates[2]),
        }),
      })
    : null;
  return Object.freeze({
    name,
    minimumUsableDurability: finiteInteger(
      raw.minimumUsableDurability,
      1,
      1,
      10_000,
    ),
    observedAt: Number.isFinite(raw.observedAt) ? raw.observedAt : Date.now(),
    target,
  });
}

function normalizeWorkstationRequirement(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const name = canonicalName(raw.name);
  if (!name) return null;
  return Object.freeze({
    name,
    carried: raw.carried === true,
    observedAt: Number.isFinite(raw.observedAt) ? raw.observedAt : Date.now(),
  });
}

function normalizeActiveCollectionTarget(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const name = canonicalName(raw.name);
  const position = raw.position && typeof raw.position === 'object'
    ? {
        x: Number(raw.position.x),
        y: Number(raw.position.y),
        z: Number(raw.position.z),
      }
    : null;
  if (!name || !position || ![position.x, position.y, position.z].every(Number.isFinite)) {
    return null;
  }
  return Object.freeze({
    name,
    position: Object.freeze({
      x: Math.floor(position.x),
      y: Math.floor(position.y),
      z: Math.floor(position.z),
    }),
    remainingRouteLowerBound: finiteInteger(
      raw.remainingRouteLowerBound,
      0,
      0,
      10_000,
    ),
    observedAt: Number.isFinite(raw.observedAt) ? raw.observedAt : Date.now(),
  });
}

function normalizeDeliveryTarget(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const player = boundedText(raw.player, 64);
  const position = raw.position && typeof raw.position === 'object'
    ? {
        x: Number(raw.position.x),
        y: Number(raw.position.y),
        z: Number(raw.position.z),
      }
    : null;
  if (!player || !position || ![position.x, position.y, position.z].every(Number.isFinite)) {
    return null;
  }
  return Object.freeze({
    player,
    position: Object.freeze(position),
    dimension: boundedText(raw.dimension, 64) || null,
    source: boundedText(raw.source, 32) || 'last_seen',
    observedAt: Number.isFinite(raw.observedAt) ? raw.observedAt : Date.now(),
  });
}

function normalizeOperationalMemory(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const failedTargets = Array.isArray(source.failedTargets)
    ? source.failedTargets
      .slice(-MAX_FAILED_TARGETS)
      .map(normalizeFailedTarget)
      .filter(Boolean)
    : [];
  return Object.freeze({
    failedTargets: Object.freeze(failedTargets),
    toolRequirement: normalizeToolRequirement(source.toolRequirement),
    workstationRequirement: normalizeWorkstationRequirement(source.workstationRequirement),
    activeCollectionTarget: normalizeActiveCollectionTarget(source.activeCollectionTarget),
    deliveryTarget: normalizeDeliveryTarget(source.deliveryTarget),
  });
}

function normalizeSubgoal(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Goal subgoal must be an object.');
  }
  const state = boundedText(raw.state || 'pending', 24);
  if (!SUBGOAL_STATES.has(state)) throw new TypeError('Goal subgoal state is invalid.');
  const commandName = boundedText(raw.commandName, 80);
  if (commandName && !/^![A-Za-z0-9_]+$/.test(commandName)) {
    throw new TypeError('Goal subgoal command is invalid.');
  }
  return Object.freeze({
    id: boundedText(raw.id || `subgoal-${index + 1}`, 96),
    kind: boundedText(raw.kind, 32),
    state,
    commandName: commandName || null,
    attempt: finiteInteger(raw.attempt, 0, 0, 64),
    actionId: boundedText(raw.actionId, 96) || null,
    code: boundedText(raw.code, 80) || null,
    detail: boundedText(raw.detail, 280),
    targetName: canonicalName(raw.targetName) || null,
    targetFamily: ['logs', 'planks'].includes(canonicalName(raw.targetFamily))
      ? canonicalName(raw.targetFamily)
      : null,
    expectedIncrease: finiteInteger(raw.expectedIncrease, 0, 0, 100_000),
    targetInventoryBefore: finiteInteger(raw.targetInventoryBefore, 0, 0, 100_000),
    targetInventoryAfter: finiteInteger(raw.targetInventoryAfter, 0, 0, 100_000),
    learningKey: boundedText(raw.learningKey, 160) || null,
    reason: boundedText(raw.reason, 280),
    inventoryBefore: finiteInteger(raw.inventoryBefore, 0, 0, 100_000),
    inventoryAfter: finiteInteger(raw.inventoryAfter, 0, 0, 100_000),
    startedAt: Number.isFinite(raw.startedAt) ? raw.startedAt : null,
    finishedAt: Number.isFinite(raw.finishedAt) ? raw.finishedAt : null,
  });
}

export function normalizeGoalContract(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Goal contract must be an object.');
  }
  const id = boundedText(raw.id, 96);
  if (!SAFE_ID.test(id)) throw new TypeError('Goal id is invalid.');
  const kind = boundedText(raw.kind, 24);
  if (!GOAL_KINDS.has(kind)) throw new TypeError('Goal kind is invalid.');
  const phase = boundedText(raw.phase || 'assess', 24);
  if (!GOAL_PHASES.has(phase)) throw new TypeError('Goal phase is invalid.');
  const requester = boundedText(raw.requester, 64);
  if (!SAFE_PLAYER.test(requester)) throw new TypeError('Goal requester is invalid.');
  const destinationPlayer = raw.destination?.kind === 'player'
    ? boundedText(raw.destination.player, 64)
    : null;
  if (kind === 'deliver' && (!destinationPlayer || !SAFE_PLAYER.test(destinationPlayer))) {
    throw new TypeError('Delivery goal requires a canonical player destination.');
  }
  const quantity = finiteInteger(raw.quantity, 1, 1, MAX_QUANTITY);
  const completion = normalizeCompletion(raw.completion, kind, quantity);
  const attempts = finiteInteger(raw.attempts, 0, 0, 32);
  const maxAttempts = finiteInteger(raw.maxAttempts, 4, 1, 8);
  const maxSubgoals = finiteInteger(raw.maxSubgoals, 16, 4, MAX_SUBGOALS);
  const subgoals = Array.isArray(raw.subgoals)
    ? raw.subgoals.slice(0, maxSubgoals).map(normalizeSubgoal)
    : [];
  const checkpointSource = raw.checkpoint && typeof raw.checkpoint === 'object' && !Array.isArray(raw.checkpoint)
    ? raw.checkpoint
    : {};
  const checkpoint = Object.freeze({
    baselineInventory: finiteInteger(checkpointSource.baselineInventory, 0, 0, 100_000),
    targetInventory: finiteInteger(checkpointSource.targetInventory, quantity, 0, 100_000),
    delivered: finiteInteger(checkpointSource.delivered, 0, 0, quantity),
  });
  const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now();
  return Object.freeze({
    id,
    kind,
    source: boundedText(raw.source || 'player', 24),
    requester,
    request: boundedText(raw.request, 500),
    target: normalizeTarget(raw.target),
    quantity,
    completion,
    destination: Object.freeze(kind === 'deliver'
      ? { kind: 'player', player: destinationPlayer }
      : { kind: 'inventory', player: null }),
    phase,
    attempts,
    maxAttempts,
    maxSubgoals,
    subgoals: Object.freeze(subgoals),
    checkpoint,
    memory: normalizeOperationalMemory(raw.memory),
    evidence: normalizeEvidence(raw.evidence),
    procedureId: boundedText(raw.procedureId, 96) || null,
    createdAt,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt,
  });
}

export function createItemGoalContract({
  kind,
  requester,
  target,
  quantity,
  destinationPlayer = null,
  request = '',
  source = 'player',
  baselineInventory = 0,
  completion = 'inventory',
} = {}) {
  const numericQuantity = finiteInteger(quantity, 1, 1, MAX_QUANTITY);
  const completionKind = normalizeCompletion(completion, kind, numericQuantity).kind;
  return normalizeGoalContract({
    id: `goal-${randomUUID()}`,
    kind,
    source,
    requester,
    request,
    target,
    quantity: numericQuantity,
    completion: { kind: completionKind },
    destination: kind === 'deliver'
      ? { kind: 'player', player: destinationPlayer || requester }
      : { kind: 'inventory' },
    phase: 'assess',
    attempts: 0,
    maxAttempts: 4,
    // A valid dependency graph can cross 32 productive operations while it
    // establishes workstations, tool tiers, and transformed materials.
    // Failed productive attempts retain their separate four-attempt ceiling;
    // use the existing hard cap so successful prerequisites cannot terminate
    // a still-converging player goal.
    maxSubgoals: MAX_SUBGOALS,
    subgoals: [],
    memory: { failedTargets: [] },
    checkpoint: {
      baselineInventory,
      targetInventory: kind === 'acquire'
        ? ['main_hand', 'off_hand'].includes(completionKind)
          ? numericQuantity
          : baselineInventory + numericQuantity
        : baselineInventory,
      delivered: 0,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

export function parseItemGoalRequest(requester, message, bot) {
  const normalized = normalizeMessage(message);
  if (!requester || !normalized || normalized.includes('!')) return null;
  const quantity = requestedQuantity(normalized);
  if (!quantity) return null;

  const delivery = /\b(?:bring|deliver|fetch)\b/.test(normalized)
    || /\bgive\s+(?:me|us)\b/.test(normalized)
    || /\bbring\b.{0,120}\bto\s+(?:me|us)\b/.test(normalized);
  const acquisition = /\b(?:collect|gather|harvest|chop|craft|make|prepare|get|mine|secure|stockpile)\b/.test(normalized);
  if (!delivery && !acquisition) return null;

  const registry = registryMention(bot, normalized);
  const family = familyMention(normalized);
  const selected = registry && (!family || registry.alias.length >= family.alias.length)
    ? registry.name
    : family?.family;
  if (!selected) return null;
  const target = resolveItemGoalTarget(bot, selected);
  if (!target || target.acquisitionKind === 'unsupported') return null;

  return Object.freeze({
    kind: delivery ? 'deliver' : 'acquire',
    requester: boundedText(requester, 64),
    destinationPlayer: delivery ? boundedText(requester, 64) : null,
    target,
    quantity,
    completion: Object.freeze({
      kind: delivery
        ? 'delivery'
        : /\b(?:equip|wield|hold)\b/.test(normalized)
          ? ['shield', 'totem_of_undying'].includes(target.canonicalName) ? 'off_hand' : 'main_hand'
          : 'inventory',
    }),
    request: boundedText(message, 500),
  });
}

export function completionRequirementSatisfied(bot, target, completion) {
  const kind = completion?.kind || completion || 'inventory';
  if (kind === 'inventory') return true;
  if (!['main_hand', 'off_hand'].includes(kind)) return false;
  const destination = kind === 'main_hand' ? 'hand' : 'off-hand';
  try {
    const slot = bot?.getEquipmentDestSlot?.(destination);
    return Number.isInteger(slot)
      && bot?.inventory?.slots?.[slot]?.name === target?.inventoryName;
  } catch {
    return false;
  }
}

export function inventoryCountForGoalTarget(bot, target) {
  const items = Array.isArray(bot?.inventory?.slots)
    ? bot.inventory.slots.filter(Boolean)
    : bot?.inventory?.items?.() || [];
  if (target?.family === 'logs') {
    return items.reduce((total, item) => (
      /_(?:log|stem)$/.test(String(item?.name || ''))
        ? total + Math.max(0, Number(item.count) || 0)
        : total
    ), 0);
  }
  if (target?.family === 'planks') {
    return items.reduce((total, item) => (
      String(item?.name || '').endsWith('_planks')
        ? total + Math.max(0, Number(item.count) || 0)
        : total
    ), 0);
  }
  return items.reduce((total, item) => (
    item?.name === target?.inventoryName
      ? total + Math.max(0, Number(item.count) || 0)
      : total
  ), 0);
}

export function goalContractDescription(goal) {
  const target = goal.target.family || goal.target.canonicalName;
  if (goal.kind === 'deliver') {
    return `deliver ${goal.quantity} ${target} to ${goal.destination.player}`;
  }
  if (goal.completion.kind === 'main_hand') return `acquire and equip ${target} in the main hand`;
  if (goal.completion.kind === 'off_hand') return `acquire and equip ${target} in the offhand`;
  return `acquire ${goal.quantity} additional ${target}`;
}
