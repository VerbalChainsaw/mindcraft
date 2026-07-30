import Vec3 from 'vec3';

import { executeCommand as executeAgentCommand } from '../commands/index.js';
import { sendSquadRadio } from '../mindserver_proxy.js';
import { RoleDirector } from './role-director.js';
import { JobStateStore } from './job-state-store.js';
import {
  advanceWorkOrder,
  createWorkOrder,
  normalizeWorkOrder,
  reconcileWorkOrder,
} from './work-order.js';
import {
  createBuilderStockpileOrder,
  nextBuilderStep,
} from './jobs/builder-plan.js';
import { canonicalMiningTarget, miningKnowledge, nextMinerStep } from './jobs/miner-plan.js';
import { canonicalLogFamily, nextLumberjackStep } from './jobs/lumberjack-plan.js';
import {
  isProtectedGameplayBlock,
  isReplaceableGameplayBlock,
} from './gameplay-safety.js';

const JOB_ROLES = new Set(['builder', 'miner', 'lumberjack']);
const TERMINAL_PHASES = new Set(['complete', 'failed', 'cancelled']);
const JOB_RETRY_MS = 5_000;
const JOB_SUCCESS_MS = 1_000;
const MANUAL_COMMAND_GRACE_MS = 120_000;
const TOOL_TIER = Object.freeze({
  wooden: 1,
  golden: 2,
  stone: 3,
  copper: 3.5,
  iron: 4,
  diamond: 5,
  netherite: 6,
});
const UNSAFE_FOOD_ITEMS = new Set([
  'chicken',
  'poisonous_potato',
  'pufferfish',
  'rotten_flesh',
  'spider_eye',
  'suspicious_stew',
]);
const COOKABLE_RAW_FOOD = new Set([
  'raw_beef',
  'raw_chicken',
  'raw_cod',
  'raw_mutton',
  'raw_porkchop',
  'raw_rabbit',
  'raw_salmon',
  'potato',
]);

function dimensionName(value) {
  const name = String(value || '').toLowerCase();
  if (name.endsWith('overworld')) return 'overworld';
  if (name.endsWith('the_nether') || name.endsWith('nether')) return 'nether';
  if (name.endsWith('the_end') || name.endsWith('end')) return 'end';
  return name;
}

function inventoryCounts(bot) {
  const counts = {};
  for (const item of bot.inventory?.items?.() || []) {
    if (!item?.name) continue;
    counts[item.name] = (counts[item.name] || 0) + Math.max(0, Number(item.count) || 0);
  }
  return counts;
}

function itemHasWorkingDurability(bot, item) {
  const max = Number(
    item?.maxDurability
    ?? bot.registry?.items?.[item?.type]?.maxDurability
    ?? bot.registry?.itemsByName?.[item?.name]?.maxDurability,
  );
  if (!Number.isFinite(max) || max <= 0) return true;
  const remaining = Math.max(0, max - (Math.max(0, Number(item?.durabilityUsed) || 0)));
  return remaining > Math.max(16, Math.ceil(max * 0.1));
}

function bestToolTier(bot, items, family) {
  let tier = 0;
  for (const item of items) {
    if (!item?.name?.endsWith(`_${family}`) || !itemHasWorkingDurability(bot, item)) continue;
    tier = Math.max(tier, TOOL_TIER[item.name.split('_')[0]] || 0);
  }
  return tier;
}

function freeInventorySlots(bot) {
  if (typeof bot.inventory?.emptySlotCount === 'function') return bot.inventory.emptySlotCount();
  const slots = bot.inventory?.slots || [];
  return slots.slice(9, 45).filter(slot => !slot).length;
}

function totalFoodPoints(bot, inventory) {
  const foods = bot.registry?.foodsByName || {};
  return Object.entries(inventory).reduce(
    (total, [name, count]) => (
      UNSAFE_FOOD_ITEMS.has(name) || COOKABLE_RAW_FOOD.has(name)
        ? total
        : total + ((foods[name]?.foodPoints || 0) * count)
    ),
    0,
  );
}

function nextJobUpkeepStep(order, snapshot) {
  const minimumFood = Number(order.constraints?.minFoodPoints ?? 12);
  const minimumHunger = Number(order.constraints?.minHunger ?? 16);
  if (
    Number(snapshot.foodPoints) < minimumFood
    && Number(snapshot.hunger) < minimumHunger
  ) {
    const target = Math.max(24, minimumFood);
    const range = Math.max(16, Math.min(128, Number(order.constraints?.maxDistance) || 64));
    return {
      command: `!prepareFood(${target}, ${range})`,
      nextPhase: order.phase,
      code: 'food_resupply_required',
      target: { name: 'safe_food' },
    };
  }
  return null;
}

function blockAt(bot, x, y, z) {
  try {
    return bot.blockAt(new Vec3(Math.floor(x), Math.floor(y), Math.floor(z)));
  } catch {
    return null;
  }
}

function blockIsSolid(block) {
  return Boolean(block && block.boundingBox === 'block' && !['water', 'lava'].includes(block.name));
}

function selectedResourceSafety(bot, order) {
  if (typeof bot.findBlocks !== 'function' || typeof bot.blockAt !== 'function') return undefined;
  const requested = order.target?.name;
  const natural = order.role === 'miner' ? canonicalMiningTarget(requested) : requested;
  let positions;
  try {
    positions = bot.findBlocks({
      matching: block => {
        if (!block?.name) return false;
        if (order.role === 'lumberjack') {
          return requested === 'logs'
            ? canonicalLogFamily(block.name) !== null
            : block.name === requested;
        }
        return block.name === natural
          || (natural === 'stone' && ['stone', 'deepslate', 'tuff'].includes(block.name));
      },
      maxDistance: order.constraints?.maxDistance || 64,
      count: 12,
    });
  } catch {
    return undefined;
  }
  if (!Array.isArray(positions) || positions.length === 0) return undefined;
  const falling = /(?:sand|gravel|concrete_powder|anvil)$/;
  return positions.some(position => {
    const target = bot.blockAt(position);
    if (!target || isProtectedGameplayBlock(target)) return false;
    const above = bot.blockAt(position.offset?.(0, 1, 0) || new Vec3(position.x, position.y + 1, position.z));
    if (above?.name && falling.test(above.name)) return false;
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const adjacent = bot.blockAt(position.offset?.(dx, dy, dz) || new Vec3(position.x + dx, position.y + dy, position.z + dz));
      if (['water', 'lava'].includes(adjacent?.name)) return false;
    }
    return true;
  });
}

function selectedResourcePresence(bot, order) {
  if (typeof bot.findBlocks !== 'function' || !order?.target?.name) return undefined;
  const requested = order.target.name;
  const natural = order.role === 'miner' ? canonicalMiningTarget(requested) : requested;
  try {
    const positions = bot.findBlocks({
      matching: block => {
        if (!block?.name) return false;
        if (order.role === 'lumberjack') {
          return requested === 'logs'
            ? canonicalLogFamily(block.name) !== null
            : block.name === requested;
        }
        return block.name === natural
          || (natural === 'stone' && ['stone', 'deepslate', 'tuff'].includes(block.name));
      },
      maxDistance: order.constraints?.maxDistance || 64,
      count: 1,
    });
    return Array.isArray(positions) && positions.length > 0;
  } catch {
    return undefined;
  }
}

function replantSituation(agent, order, inventory) {
  if (order.role !== 'lumberjack') return undefined;
  const target = agent.last_action_result?.evidence?.skill?.target;
  if (![target?.x, target?.y, target?.z].every(Number.isFinite)) return { enabled: false };
  const family = canonicalLogFamily(target?.name) || canonicalLogFamily(order.target?.name);
  if (!family || ['crimson', 'warped'].includes(family)) return { enabled: false };
  const sapling = `${family}_sapling`;
  if (!inventory[sapling]) return { enabled: false };
  const bot = agent.bot;
  const x = Math.floor(target.x);
  const y = Math.floor(target.y);
  const z = Math.floor(target.z);
  const destination = blockAt(bot, x, y, z);
  const head = blockAt(bot, x, y + 1, z);
  const soil = blockAt(bot, x, y - 1, z);
  const distance = bot.entity?.position?.distanceTo?.(new Vec3(x, y, z)) ?? Infinity;
  return {
    enabled: true,
    sapling,
    soil: ['dirt', 'grass_block', 'podzol', 'coarse_dirt'].includes(soil?.name),
    clearance: isReplaceableGameplayBlock(destination) && isReplaceableGameplayBlock(head),
    reachable: distance <= 16,
    x,
    y,
    z,
  };
}

function entityOccupies(bot, x, y, z) {
  return Object.values(bot.entities || {}).some(entity => {
    if (entity?.id === bot.entity?.id) return false;
    const position = entity?.position;
    return position
      && Math.floor(position.x) === x
      && Math.floor(position.y) === y
      && Math.floor(position.z) === z;
  });
}

function auditBlueprint(bot, order, inventory) {
  if (!order.blueprint || !order.target) return { valid: false, code: 'not_audited', missing: [], incorrect: [] };
  const anchor = order.target;
  const blueprintPositions = new Set(order.blueprint.cells.map(cell => `${cell.x}:${cell.y}:${cell.z}`));
  const missing = [];
  const incorrect = [];
  let correct = 0;
  for (let index = 0; index < order.blueprint.cells.length; index += 1) {
    const cell = order.blueprint.cells[index];
    const x = anchor.x + cell.x;
    const y = anchor.y + cell.y;
    const z = anchor.z + cell.z;
    const expected = cell.material === 'survival_building_block'
      ? Object.keys(inventory).find(name => (
        (name.endsWith('_planks') || ['cobblestone', 'stone', 'dirt'].includes(name))
        && inventory[name] > 0
      )) || 'cobblestone'
      : cell.material;
    const current = blockAt(bot, x, y, z);
    if (!current) return { valid: false, code: 'unloaded', missing: [], incorrect: [] };
    if (current.name === expected || (expected === 'dirt' && current.name === 'grass_block')) {
      correct += 1;
      continue;
    }
    if (['water', 'lava'].includes(current.name)) {
      return { valid: false, code: 'liquid', missing: [], incorrect: [] };
    }
    if (isProtectedGameplayBlock(current)) {
      return { valid: false, code: 'protected', missing: [], incorrect: [] };
    }
    if (entityOccupies(bot, x, y, z)) {
      return { valid: false, code: 'occupied', missing: [], incorrect: [] };
    }
    if (!isReplaceableGameplayBlock(current)) {
      incorrect.push({ x, y, z, expected, observed: current.name, index });
      continue;
    }
    const relativeBelow = `${cell.x}:${cell.y - 1}:${cell.z}`;
    const supported = blockIsSolid(blockAt(bot, x, y - 1, z))
      || [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 0, 1],
        [0, 0, -1],
      ].some(([dx, dy, dz]) => blockIsSolid(blockAt(bot, x + dx, y + dy, z + dz)));
    const plannedSupport = (
      (cell.y > 0 && blueprintPositions.has(relativeBelow))
      || [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 0, 1],
        [0, 0, -1],
      ].some(([dx, dy, dz]) => blueprintPositions.has(`${cell.x + dx}:${cell.y + dy}:${cell.z + dz}`))
    );
    if (!supported && !plannedSupport) {
      return { valid: false, code: 'unsupported', missing: [], incorrect: [] };
    }
    missing.push({
      x,
      y,
      z,
      material: expected,
      index,
      supported,
      stage: cell.stage,
      function: cell.function || null,
    });
  }
  const botX = Math.floor(bot.entity?.position?.x ?? Infinity);
  const botY = Math.floor(bot.entity?.position?.y ?? Infinity);
  const botZ = Math.floor(bot.entity?.position?.z ?? Infinity);
  const insideFootprint = (
    botX >= anchor.x
    && botX < anchor.x + order.blueprint.width
    && botZ >= anchor.z
    && botZ < anchor.z + order.blueprint.depth
    && botY >= anchor.y
    && botY < anchor.y + order.blueprint.height
  );
  if (order.kind === 'emergency_shelter') {
    for (const yOffset of [0, 1]) {
      const door = blockAt(bot, anchor.x, anchor.y + yOffset, anchor.z - 1);
      if (!door || !isReplaceableGameplayBlock(door)) {
        return { valid: false, code: 'trapped_exit', missing: [], incorrect: [] };
      }
    }
  } else if (insideFootprint) {
    const escape = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].some(([dx, dz]) => {
      const feet = blockAt(bot, botX + dx, botY, botZ + dz);
      const head = blockAt(bot, botX + dx, botY + 1, botZ + dz);
      const floor = blockAt(bot, botX + dx, botY - 1, botZ + dz);
      return isReplaceableGameplayBlock(feet)
        && isReplaceableGameplayBlock(head)
        && blockIsSolid(floor);
    });
    if (!escape) return { valid: false, code: 'trapped_exit', missing: [], incorrect: [] };
  }
  if (missing.length > 0 && correct === 0 && !missing.some(cell => cell.supported === true)) {
    return { valid: false, code: 'no_support_anchor', missing: [], incorrect: [] };
  }
  return {
    valid: true,
    missing,
    incorrect,
    correct,
  };
}

export function summarizeJobSituation(agent, order) {
  const bot = agent.bot;
  const items = bot.inventory?.items?.() || [];
  const inventory = inventoryCounts(bot);
  const depositMode = agent.runtime?.jobs?.deposit || 'inventory';
  const leader = agent.runtime?.assignment?.leader || '';
  const assignedDeposit = agent.runtime?.assignment?.deposit || null;
  const snapshot = {
    inventory,
    tools: {
      pickaxeTier: bestToolTier(bot, items, 'pickaxe'),
      axeTier: bestToolTier(bot, items, 'axe'),
      shovelTier: bestToolTier(bot, items, 'shovel'),
      hoeTier: bestToolTier(bot, items, 'hoe'),
      swordTier: bestToolTier(bot, items, 'sword'),
    },
    foodPoints: totalFoodPoints(bot, inventory),
    hunger: Number(bot.food),
    lightCount: (inventory.torch || 0) + (inventory.soul_torch || 0),
    freeSlots: freeInventorySlots(bot),
    escapeRoute: Boolean(
      bot.entity?.position
      && blockIsSolid(blockAt(bot, bot.entity.position.x, bot.entity.position.y - 1, bot.entity.position.z)),
    ),
    deposit: { mode: depositMode, leader, target: assignedDeposit },
    dimension: dimensionName(bot.game?.dimension),
    y: Number(bot.entity?.position?.y),
  };
  const resourceFound = selectedResourcePresence(bot, order);
  if (resourceFound !== undefined) snapshot.resourceFound = resourceFound;
  if (order?.role === 'miner') snapshot.miningKnowledge = miningKnowledge(order.target?.name);
  const resourceSafety = selectedResourceSafety(bot, order);
  if (order?.role === 'miner' && resourceSafety !== undefined) snapshot.safeSelectedBlocks = resourceSafety;
  if (order?.role === 'lumberjack' && resourceSafety !== undefined) snapshot.safeTrunks = resourceSafety;
  const replant = replantSituation(agent, order, inventory);
  if (replant) snapshot.replant = replant;
  if (order?.role === 'builder') {
    snapshot.blueprintAudit = auditBlueprint(bot, order, inventory);
    snapshot.selectedMaterial = Object.keys(inventory).find(name => (
      (name.endsWith('_planks') || ['cobblestone', 'stone', 'dirt'].includes(name))
      && inventory[name] > 0
    )) || 'cobblestone';
  }
  return snapshot;
}

export function constructionTaskOrder(agent, completedOrderIds = new Set()) {
  if (agent.runtime?.role !== 'builder' || agent.task?.task_type !== 'construction') return null;
  const levels = agent.task?.blueprint?.data?.levels;
  if (!Array.isArray(levels) || levels.length === 0) return null;
  const orderId = `task-${String(agent.task?.data?.task_id || 'construction')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .slice(0, 80)}`;
  if (completedOrderIds.has(orderId)) return null;
  const populated = [];
  for (const level of levels) {
    const [startX, startY, startZ] = level?.coordinates || [];
    if (![startX, startY, startZ].every(Number.isFinite) || !Array.isArray(level?.placement)) return null;
    for (let z = 0; z < level.placement.length; z += 1) {
      const row = level.placement[z];
      if (!Array.isArray(row)) return null;
      for (let x = 0; x < row.length; x += 1) {
        const material = row[x];
        if (material && material !== 'air') {
          populated.push({
            worldX: Math.floor(startX + x),
            worldY: Math.floor(startY),
            worldZ: Math.floor(startZ + z),
            material,
          });
        }
      }
    }
  }
  if (populated.length === 0) return null;
  const minX = Math.min(...populated.map(cell => cell.worldX));
  const minY = Math.min(...populated.map(cell => cell.worldY));
  const minZ = Math.min(...populated.map(cell => cell.worldZ));
  const maxX = Math.max(...populated.map(cell => cell.worldX));
  const maxY = Math.max(...populated.map(cell => cell.worldY));
  const maxZ = Math.max(...populated.map(cell => cell.worldZ));
  return createWorkOrder({
    id: orderId,
    role: 'builder',
    kind: 'build',
    source: 'player',
    requester: 'task',
    target: { name: 'worksite', x: minX, y: minY, z: minZ },
    quota: populated.length,
    blueprint: {
      id: orderId.replace(/^task-/, '').slice(0, 64) || 'construction',
      width: maxX - minX + 1,
      depth: maxZ - minZ + 1,
      height: maxY - minY + 1,
      cells: populated.map(cell => ({
        x: cell.worldX - minX,
        y: cell.worldY - minY,
        z: cell.worldZ - minZ,
        material: cell.material,
      })),
    },
  });
}

function inventoryFamilyCount(inventory, predicate) {
  return Object.entries(inventory).reduce(
    (total, [name, amount]) => predicate(name)
      ? total + Math.max(0, Number(amount) || 0)
      : total,
    0,
  );
}

function defaultOrderFor(agent, completedOrderIds) {
  const role = agent.runtime?.role;
  const limit = Math.max(16, Math.min(2304, Number(agent.runtime?.jobs?.stockpileLimit) || 128));
  const taskOrder = constructionTaskOrder(agent, completedOrderIds);
  if (taskOrder) return taskOrder;
  const inventory = inventoryCounts(agent.bot);
  if (role === 'builder') {
    const materialTarget = Math.max(8, Math.ceil(limit / 2));
    const carriedPlanks = inventoryFamilyCount(
      inventory,
      name => name.endsWith('_planks'),
    );
    if (carriedPlanks < materialTarget) {
      return createBuilderStockpileOrder({ quota: materialTarget, material: 'planks' });
    }
    if (Math.max(0, Number(inventory.cobblestone) || 0) < materialTarget) {
      return createBuilderStockpileOrder({ quota: materialTarget, material: 'cobblestone' });
    }
    return null;
  }
  if (role === 'miner') {
    if (Math.max(0, Number(inventory.cobblestone) || 0) >= limit) return null;
    return createWorkOrder({
      role: 'miner',
      kind: 'mine',
      source: 'role',
      target: { name: 'cobblestone' },
      quota: limit,
    });
  }
  if (role === 'lumberjack') {
    const carriedLogs = inventoryFamilyCount(
      inventory,
      name => canonicalLogFamily(name) !== null,
    );
    if (carriedLogs >= limit) return null;
    return createWorkOrder({
      role: 'lumberjack',
      kind: 'harvest',
      source: 'role',
      target: { name: 'logs' },
      quota: limit,
    });
  }
  return null;
}

function reducerFor(order) {
  if (order.role === 'builder') return nextBuilderStep;
  if (order.role === 'miner') return nextMinerStep;
  if (order.role === 'lumberjack') return nextLumberjackStep;
  return null;
}

export class JobDirector extends RoleDirector {
  constructor(agent, {
    executeCommand = executeAgentCommand,
    getSnapshot = summarizeJobSituation,
    store = null,
    now = Date.now,
  } = {}) {
    super(agent);
    this.executeJobCommand = executeCommand;
    this.getJobSnapshot = getSnapshot;
    this.now = now;
    this.store = store || new JobStateStore(agent.name);
    this.activeOrder = null;
    this.lastOrder = null;
    this.completedOrderIds = new Set();
    try {
      const persisted = this.store.load();
      if (this.store.lastError) {
        this.setStatus('failed', 'job_state_load_failed', null, this.store.lastError, false);
      } else if (persisted && !TERMINAL_PHASES.has(persisted.phase)) {
        const automaticSuppressed = (
          this.agent.runtime?.autonomy === 'command'
          && persisted.source === 'role'
        );
        if (automaticSuppressed) {
          this.store.save(null);
        } else {
          this.activeOrder = reconcileWorkOrder(
            persisted,
            this.getJobSnapshot(this.agent, persisted),
            this.now(),
          );
          this.store.save(this.activeOrder);
        }
      }
    } catch (error) {
      this.setStatus('failed', 'job_state_load_failed', null, error?.message || error, true);
    }
  }

  snapshot() {
    const order = this.activeOrder || this.lastOrder;
    return {
      ...this.status,
      nextAttemptAt: this.nextAttemptAt,
      workOrder: order ? {
        id: order.id,
        role: order.role,
        kind: order.kind,
        phase: order.phase,
        target: order.target,
        attempts: order.attempts,
        maxAttempts: order.maxAttempts,
        checkpoint: order.checkpoint,
        evidence: order.evidence,
      } : null,
    };
  }

  submit(raw) {
    if (this.activeOrder && !TERMINAL_PHASES.has(this.activeOrder.phase)) {
      return { accepted: false, code: 'job_busy', id: this.activeOrder.id };
    }
    try {
      const order = normalizeWorkOrder(raw);
      if (TERMINAL_PHASES.has(order.phase)) return { accepted: false, code: 'job_already_terminal' };
      this.activeOrder = order;
      this.lastOrder = null;
      this.store.save(order);
      this.nextAttemptAt = 0;
      this.setStatus('waiting', 'job_accepted', order.target?.name || null, `Accepted work order ${order.id}.`, true);
      return { accepted: true, id: order.id };
    } catch (error) {
      return { accepted: false, code: 'invalid_work_order', detail: String(error?.message || error).slice(0, 180) };
    }
  }

  requestWorkOrder(request = {}) {
    if (request.kind !== 'emergency_shelter') return this.submit(request);
    const position = this.agent.bot?.entity?.position;
    if (!position) return { accepted: false, code: 'spawn_state_unavailable' };
    if (this.activeOrder && !TERMINAL_PHASES.has(this.activeOrder.phase)) {
      if (this.activeOrder.source !== 'role') {
        return { accepted: false, code: 'explicit_job_active', id: this.activeOrder.id };
      }
      this.finishOrder(
        'cancelled',
        'preempted_by_survival',
        'Automatic role work yielded to an emergency shelter order.',
        true,
      );
    }
    return this.submit(createWorkOrder({
      role: 'builder',
      kind: 'emergency_shelter',
      source: 'survival',
      requester: this.agent.name,
      target: {
        name: 'worksite',
        x: Math.floor(position.x),
        y: Math.floor(position.y),
        z: Math.floor(position.z),
      },
      quota: request.blueprint?.cells?.length || 1,
      blueprint: request.blueprint,
      constraints: request.constraints,
    }));
  }

  cancel(reason = 'cancelled') {
    if (!this.activeOrder) return false;
    const cancelled = normalizeWorkOrder({
      ...this.activeOrder,
      phase: 'cancelled',
      evidence: { code: 'cancelled', detail: reason, actionId: '' },
      updatedAt: this.now(),
    });
    this.lastOrder = cancelled;
    this.activeOrder = null;
    this.store.save(null);
    this.setStatus('cancelled', 'job_cancelled', cancelled.target?.name || null, reason, false);
    return true;
  }

  deferForManualCommand(reason = 'manual command') {
    this.nextAttemptAt = Math.max(this.nextAttemptAt, this.now() + MANUAL_COMMAND_GRACE_MS);
    this.setStatus('suppressed', 'manual_command', null, reason, true);
  }

  persist(order) {
    const previousPhase = this.activeOrder?.phase;
    this.activeOrder = normalizeWorkOrder(order);
    this.store.save(this.activeOrder);
    if (previousPhase && previousPhase !== this.activeOrder.phase) {
      this.agent.publishBehaviorEvent?.({
        type: 'job.changed',
        target: this.activeOrder.target,
        evidence: {
          workOrderId: this.activeOrder.id,
          code: this.activeOrder.evidence?.code || 'phase_changed',
          phase: this.activeOrder.phase,
        },
        salience: this.activeOrder.phase === 'recover' ? 3 : 1,
      });
    }
  }

  finishOrder(phase, code, detail = '', retryable = false) {
    const terminal = normalizeWorkOrder({
      ...this.activeOrder,
      phase,
      evidence: { code, detail, actionId: this.activeOrder?.evidence?.actionId || '' },
      updatedAt: this.now(),
    });
    this.lastOrder = terminal;
    if (phase === 'complete') this.completedOrderIds.add(terminal.id);
    this.activeOrder = null;
    this.store.save(null);
    this.nextAttemptAt = this.now() + JOB_RETRY_MS;
    this.setStatus(phase, code, terminal.target?.name || null, detail || code, retryable);
    this.agent.publishBehaviorEvent?.({
      type: phase === 'complete' ? 'job.completed' : 'job.changed',
      target: terminal.target,
      evidence: {
        workOrderId: terminal.id,
        code,
        phase,
      },
      salience: phase === 'complete' ? 4 : 3,
    });
    const radioKind = phase === 'complete' ? 'completion' : phase === 'failed' ? 'warning' : null;
    if (radioKind) {
      const message = phase === 'complete'
        ? `${terminal.role} work order ${terminal.id} completed.`
        : `${terminal.role} work order ${terminal.id} stopped: ${code}.`;
      void sendSquadRadio(message, radioKind).catch(error => {
        console.warn(`[job-radio] Could not relay ${terminal.id}: ${String(error?.message || error).slice(0, 180)}`);
      });
    }
  }

  update() {
    const role = this.agent.runtime?.role || 'companion';
    if (!JOB_ROLES.has(role) && !this.activeOrder) {
      super.update();
      return;
    }
    if (this.agent.isOperatorHeld?.()) {
      this.setStatus('suppressed', 'operator_hold', null, this.agent.operator_hold_reason || 'Operator Stop is active.', false);
      return;
    }
    if (
      (
        this.agent.runtime?.jobs?.mode === 'off'
        && this.activeOrder?.source !== 'survival'
      )
      || (
        this.agent.runtime?.autonomy === 'command'
        && (!this.activeOrder || this.activeOrder.source === 'role')
      )
    ) {
      this.setStatus('suppressed', 'command_autonomy', null, 'Automatic job work is disabled for this profile.', false);
      return;
    }
    if (this.inFlight || !this.agent.isIdle() || !this.agent.self_prompter?.isStopped?.()) return;
    if (this.now() < this.nextAttemptAt) return;

    if (!this.activeOrder) {
      let automatic;
      try {
        automatic = defaultOrderFor(this.agent, this.completedOrderIds);
      } catch (error) {
        this.setStatus('failed', 'automatic_job_invalid', null, error?.message || error, false);
        this.nextAttemptAt = this.now() + JOB_RETRY_MS;
        return;
      }
      if (!automatic) return;
      const accepted = this.submit(automatic);
      if (!accepted.accepted) return;
    }

    let transitions = 0;
    while (this.activeOrder && transitions < 6) {
      transitions += 1;
      const reducer = reducerFor(this.activeOrder);
      if (!reducer) {
        this.finishOrder('failed', 'unsupported_job_role', 'No job plan exists for this work order.', false);
        return;
      }
      let snapshot;
      let step;
      try {
        snapshot = this.getJobSnapshot(this.agent, this.activeOrder);
        step = nextJobUpkeepStep(this.activeOrder, snapshot)
          || reducer(this.activeOrder, snapshot, this.agent.last_action_result);
      } catch (error) {
        this.setStatus('failed', 'job_snapshot_failed', this.activeOrder.target?.name, error?.message || error, true);
        this.nextAttemptAt = this.now() + JOB_RETRY_MS;
        return;
      }
      if (step.complete) {
        if (step.checkpoint) {
          this.persist({
            ...this.activeOrder,
            checkpoint: {
              ...this.activeOrder.checkpoint,
              ...step.checkpoint,
            },
            updatedAt: this.now(),
          });
        }
        this.finishOrder('complete', step.code || 'job_complete', step.detail || 'Work order completed.', false);
        return;
      }
      if (step.terminal) {
        this.finishOrder('failed', step.code || 'job_failed', step.detail || 'Work order cannot continue safely.', step.retryable === true);
        return;
      }
      if (step.blocked) {
        this.setStatus('waiting', step.code || 'job_blocked', this.activeOrder.target?.name, step.detail || 'Waiting for a safe job prerequisite.', true);
        this.nextAttemptAt = this.now() + JOB_RETRY_MS;
        return;
      }
      if (step.phase && step.phase !== this.activeOrder.phase) {
        this.persist({
          ...this.activeOrder,
          phase: step.phase,
          resumePhase: null,
          evidence: { code: step.code || 'phase_advanced', detail: step.detail || '', actionId: '' },
          updatedAt: this.now(),
        });
      }
      if (!step.command) continue;

      if (step.checkpoint) {
        this.persist({ ...this.activeOrder, checkpoint: step.checkpoint, updatedAt: this.now() });
      }
      this.inFlight = true;
      const orderAtDispatch = this.activeOrder;
      const previousActionId = this.agent.last_action_result?.actionId || null;
      this.setStatus(
        'acting',
        `job_${orderAtDispatch.phase}`,
        step.target?.name || orderAtDispatch.target?.name,
        `Executing ${orderAtDispatch.role} ${orderAtDispatch.phase} phase.`,
        true,
      );
      void Promise.resolve(this.executeJobCommand(this.agent, step.command, { owner: 'job' }))
        .then(() => {
          let result = this.agent.last_action_result;
          if (!result?.actionId || result.actionId === previousActionId) {
            result = {
              actionId: `missing-${this.now()}`,
              phase: 'failed',
              code: 'missing_action_result',
              detail: 'Job command returned without a new structured action result.',
              retryable: true,
            };
          }
          const verifiedOrder = result.phase === 'succeeded' && step.checkpointOnSuccess
            ? {
              ...orderAtDispatch,
              checkpoint: {
                ...orderAtDispatch.checkpoint,
                ...step.checkpointOnSuccess,
              },
            }
            : orderAtDispatch;
          const advanced = advanceWorkOrder(verifiedOrder, result, {
            previousActionId,
            nextPhase: step.nextPhase,
            now: this.now(),
          });
          this.persist(advanced);
          if (advanced.phase === 'complete') {
            this.finishOrder(
              'complete',
              result?.code || step.code || 'job_complete',
              result?.detail || 'Verified delivery completed the work order.',
              false,
            );
            return;
          }
          if (advanced.phase === 'failed' || advanced.phase === 'cancelled') {
            this.finishOrder(
              advanced.phase,
              result?.code || 'job_attempts_exhausted',
              result?.detail || 'The work order exhausted its bounded recovery budget.',
              false,
            );
            return;
          }
          const succeeded = advanced.phase === step.nextPhase && result?.phase === 'succeeded';
          this.setStatus(
            succeeded ? 'succeeded' : advanced.phase === 'recover' ? 'recovering' : 'failed',
            result?.code || (succeeded ? 'job_phase_succeeded' : 'job_phase_failed'),
            step.target?.name || advanced.target?.name,
            result?.detail || (succeeded ? 'Verified job phase completed.' : 'Job phase did not verify.'),
            advanced.phase === 'recover',
          );
          this.nextAttemptAt = this.now() + (succeeded ? JOB_SUCCESS_MS : JOB_RETRY_MS);
        })
        .catch(error => {
          const failed = advanceWorkOrder(orderAtDispatch, {
            actionId: `dispatch-${this.now()}`,
            phase: 'failed',
            code: 'job_dispatch_error',
            detail: error?.message || error,
            retryable: true,
          }, {
            previousActionId,
            now: this.now(),
          });
          this.persist(failed);
          if (failed.phase === 'failed') {
            this.finishOrder(
              'failed',
              'job_dispatch_error',
              error?.message || error,
              false,
            );
            return;
          }
          this.setStatus('recovering', 'job_dispatch_error', failed.target?.name, error?.message || error, true);
          this.nextAttemptAt = this.now() + JOB_RETRY_MS;
        })
        .finally(() => {
          this.inFlight = false;
        });
      return;
    }
  }
}
