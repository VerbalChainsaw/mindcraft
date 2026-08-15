import { createCapabilityRequest } from '../capability-catalogue.js';

const LOG_PATTERN = /^(?<family>[a-z0-9]+(?:_[a-z0-9]+)*)_(?:log|stem)$/;
const HAND_HARVEST_LOG_LIMIT = 8;
const WOODEN_AXE_BOOTSTRAP_LOGS = 3;

export function canonicalLogFamily(name) {
  if (typeof name !== 'string') return null;
  return name.match(LOG_PATTERN)?.groups?.family || null;
}

function inventoryCount(snapshot, name) {
  return Math.max(0, Number(snapshot?.inventory?.[name]) || 0);
}

export function logInventoryCount(inventory, requestedName = 'logs') {
  const entries = Array.isArray(inventory)
    ? inventory.map(item => [item?.name, item?.count])
    : Object.entries(inventory || {});
  return entries.reduce((total, [name, amount]) => {
    const matches = requestedName === 'logs'
      ? canonicalLogFamily(name) !== null
      : name === requestedName;
    return matches ? total + Math.max(0, Number(amount) || 0) : total;
  }, 0);
}

function acquisitionBaseline(order) {
  if (order.source !== 'player') return 0;
  const baseline = Number(order.checkpoint?.baselineInventory);
  const target = Number(order.checkpoint?.targetInventory);
  return Number.isFinite(baseline)
    && Number.isFinite(target)
    && target === baseline + order.quota
    ? Math.max(0, baseline)
    : 0;
}

function collectionCommand(log, amount, range) {
  return log === 'logs'
    ? `!collectWoodInRange(${amount}, ${range}, false, true)`
    : `!collectBlocksInRange(${JSON.stringify(log)}, ${amount}, ${range}, false, true)`;
}

function deliveryStep(order, snapshot, amount) {
  const delivered = Math.max(0, Number(order.checkpoint?.delivered) || 0);
  const item = order.target.name;
  const baseline = acquisitionBaseline(order);
  const carried = Math.max(0, logInventoryCount(snapshot?.inventory, item) - baseline);
  const deliverable = Math.min(amount, carried, Math.max(0, order.quota - delivered));
  if (deliverable < 1 && delivered >= order.quota) {
    return { complete: true, code: 'log_quota_delivered' };
  }
  if (deliverable < 1) return { blocked: true, code: 'delivery_target_missing', retryable: true };
  const checkpointOnSuccess = {
    ...order.checkpoint,
    delivered: delivered + deliverable,
  };
  const nextPhase = checkpointOnSuccess.delivered >= order.quota ? 'complete' : 'assess';
  if (snapshot.deposit?.mode === 'leader') {
    if (!snapshot.deposit.leader) return { blocked: true, code: 'delivery_leader_missing', retryable: true };
    if (item !== 'logs') {
      return createCapabilityRequest('deliver_exact_item', {
        player: snapshot.deposit.leader,
        item,
        quantity: deliverable,
      }, {
        nextPhase,
        checkpointOnSuccess,
      });
    }
    return createCapabilityRequest('deliver_item_family', {
      player: snapshot.deposit.leader,
      family: 'logs',
      quantity: deliverable,
    }, {
      nextPhase,
      checkpointOnSuccess,
      checkpointOnVerifiedTransfer: {
        field: 'delivered',
        baseline: delivered,
        maximum: order.quota,
      },
    });
  }
  if (snapshot.deposit?.mode === 'assigned') {
    const target = snapshot.deposit?.target;
    if (![target?.x, target?.y, target?.z].every(Number.isFinite)) {
      return { blocked: true, code: 'assigned_deposit_missing', retryable: true };
    }
    return {
      command: item === 'logs'
        ? `!putFamilyInChestAt("logs", ${deliverable}, ${target.x}, ${target.y}, ${target.z})`
        : `!putInChestAt(${JSON.stringify(item)}, ${deliverable}, ${target.x}, ${target.y}, ${target.z})`,
      nextPhase,
      checkpointOnSuccess,
    };
  }
  return carried + delivered >= order.quota
    ? { complete: true, code: 'log_quota_retained' }
    : { phase: 'assess', code: 'log_quota_revalidation_required' };
}

export function nextLumberjackStep(order, snapshot = {}) {
  const log = order.target?.name;
  const constraints = order.constraints || {};
  const family = log === 'logs' ? 'any' : canonicalLogFamily(log);
  if (!family) return { terminal: true, code: 'invalid_log_target', retryable: false };
  const current = logInventoryCount(snapshot?.inventory, log);
  const retained = Math.max(0, current - acquisitionBaseline(order));
  const delivered = Math.max(0, Number(order.checkpoint?.delivered) || 0);
  const progress = retained + delivered;
  if (order.phase !== 'verify' && order.phase !== 'deliver' && progress >= order.quota) {
    return { phase: 'verify', code: 'log_quota_met' };
  }
  if (order.phase === 'deliver') {
    return deliveryStep(order, snapshot, Math.min(retained, Math.max(0, order.quota - delivered)));
  }
  if (order.phase === 'recover') {
    return {
      command: '!moveAway(32)',
      nextPhase: 'assess',
      code: 'harvest_search_relocation',
    };
  }
  if (order.phase === 'verify') {
    if (progress < order.quota) return { phase: 'execute', code: 'log_quota_incomplete' };
    const replant = snapshot.replant;
    if (
      constraints.replant !== false
      && replant?.enabled === true
      && typeof replant.sapling === 'string'
      && inventoryCount(snapshot, replant.sapling) > 0
      && replant.soil === true
      && replant.clearance === true
      && replant.reachable === true
      && [replant.x, replant.y, replant.z].every(Number.isFinite)
    ) {
      return {
        command: `!placeBlockAt(${JSON.stringify(replant.sapling)}, ${Math.floor(replant.x)}, ${Math.floor(replant.y)}, ${Math.floor(replant.z)})`,
        nextPhase: 'deliver',
        code: 'replant_verified',
      };
    }
    return { phase: 'deliver', code: 'replant_not_safe' };
  }
  if (Number(snapshot.freeSlots) <= Number(constraints.reserveSlots ?? 1)) {
    if (retained > 0) return { phase: 'deliver', code: 'inventory_reserve_reached' };
    if (snapshot.deposit?.mode === 'assigned') {
      const target = snapshot.deposit?.target;
      if (![target?.x, target?.y, target?.z].every(Number.isFinite)) {
        return { blocked: true, code: 'assigned_deposit_missing', retryable: true };
      }
      return {
        command: `!depositInventoryOverflowAt("lumberjack", ${JSON.stringify(log)}, ${Math.max(2, Number(constraints.reserveSlots) || 1)}, ${target.x}, ${target.y}, ${target.z})`,
        nextPhase: 'assess',
        code: 'inventory_consolidation_required',
        target: { name: 'inventory_overflow' },
      };
    }
    return { blocked: true, code: 'inventory_full_no_deposit', retryable: true };
  }
  if (snapshot.safeTrunks === false) {
    return { blocked: true, code: 'no_safe_reachable_trunk', retryable: true };
  }
  const remaining = Math.max(1, Math.min(32, order.quota - progress));
  const range = Math.max(16, Math.min(512, Number(constraints.maxDistance) || 64));
  if ((Number(snapshot.tools?.axeTier) || 0) < 1) {
    // A small family wood chore is faster and safer to finish by hand than to
    // launch a separate stone-mining expedition. Larger jobs first harvest one
    // complete natural tree under the lumberjack stewardship contract, then
    // craft a wooden axe from those carried logs. `prepareTool` therefore has
    // no reason to start or mutilate another tree while satisfying its recipe.
    if (order.quota - progress <= HAND_HARVEST_LOG_LIMIT || current < WOODEN_AXE_BOOTSTRAP_LOGS) {
      const amount = order.quota - progress <= HAND_HARVEST_LOG_LIMIT
        ? remaining
        : Math.min(WOODEN_AXE_BOOTSTRAP_LOGS, remaining);
      return {
        phase: 'execute',
        command: collectionCommand(log, amount, range),
        nextPhase: order.quota - progress <= HAND_HARVEST_LOG_LIMIT ? 'verify' : 'assess',
        code: order.quota - progress <= HAND_HARVEST_LOG_LIMIT
          ? 'hand_harvest_ready'
          : 'wooden_axe_material_bootstrap',
        target: { name: log },
      };
    }
    return {
      phase: 'prepare',
      command: '!prepareTool("wooden_axe")',
      nextPhase: 'assess',
      code: 'axe_required',
    };
  }
  if (['assess', 'prepare'].includes(order.phase)) {
    return { phase: 'execute', code: 'harvest_ready' };
  }
  if (order.phase === 'execute') {
    return {
      command: collectionCommand(log, remaining, range),
      nextPhase: 'verify',
      target: { name: log },
    };
  }
  return { terminal: true, code: 'unsupported_lumberjack_phase', retryable: false };
}
