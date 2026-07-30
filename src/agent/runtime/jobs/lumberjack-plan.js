const LOG_PATTERN = /^(?<family>[a-z0-9]+(?:_[a-z0-9]+)*)_(?:log|stem)$/;

export function canonicalLogFamily(name) {
  if (typeof name !== 'string') return null;
  return name.match(LOG_PATTERN)?.groups?.family || null;
}

function inventoryCount(snapshot, name) {
  return Math.max(0, Number(snapshot?.inventory?.[name]) || 0);
}

function deliveryStep(order, snapshot, amount) {
  const delivered = Math.max(0, Number(order.checkpoint?.delivered) || 0);
  const item = order.target.name;
  const carried = item === 'logs'
    ? Object.entries(snapshot?.inventory || {}).reduce(
      (total, [name, count]) => canonicalLogFamily(name)
        ? total + Math.max(0, Number(count) || 0)
        : total,
      0,
    )
    : inventoryCount(snapshot, item);
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
    return {
      command: item === 'logs'
        ? `!giveFamilyToPlayer("logs", ${JSON.stringify(snapshot.deposit.leader)}, ${deliverable})`
        : `!givePlayer(${JSON.stringify(item)}, ${JSON.stringify(snapshot.deposit.leader)}, ${deliverable})`,
      nextPhase,
      checkpointOnSuccess,
    };
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
  return { complete: true, code: 'log_quota_retained' };
}

export function nextLumberjackStep(order, snapshot = {}) {
  const log = order.target?.name;
  const constraints = order.constraints || {};
  const family = log === 'logs' ? 'any' : canonicalLogFamily(log);
  if (!family) return { terminal: true, code: 'invalid_log_target', retryable: false };
  const current = log === 'logs'
    ? Object.entries(snapshot?.inventory || {}).reduce(
      (total, [name, amount]) => (
        canonicalLogFamily(name) ? total + Math.max(0, Number(amount) || 0) : total
      ),
      0,
    )
    : inventoryCount(snapshot, log);
  const delivered = Math.max(0, Number(order.checkpoint?.delivered) || 0);
  const progress = current + delivered;
  if (order.phase !== 'verify' && order.phase !== 'deliver' && progress >= order.quota) {
    return { phase: 'verify', code: 'log_quota_met' };
  }
  if (order.phase === 'deliver') {
    return deliveryStep(order, snapshot, Math.min(current, Math.max(0, order.quota - delivered)));
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
  if ((Number(snapshot.tools?.axeTier) || 0) < 3) {
    return {
      phase: 'prepare',
      command: '!prepareTool("stone_axe")',
      nextPhase: 'assess',
      code: 'axe_required',
    };
  }
  if (Number(snapshot.freeSlots) <= Number(constraints.reserveSlots ?? 1)) {
    if (current > 0) return { phase: 'deliver', code: 'inventory_reserve_reached' };
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
  if (['assess', 'prepare'].includes(order.phase)) {
    return { phase: 'execute', code: 'harvest_ready' };
  }
  if (order.phase === 'execute') {
    const remaining = Math.max(1, Math.min(32, order.quota - progress));
    const range = Math.max(16, Math.min(512, Number(constraints.maxDistance) || 64));
    return {
      command: log === 'logs'
        ? `!collectWoodInRange(${remaining}, ${range})`
        : `!collectBlocksInRange(${JSON.stringify(log)}, ${remaining}, ${range})`,
      nextPhase: 'verify',
      target: { name: log },
    };
  }
  return { terminal: true, code: 'unsupported_lumberjack_phase', retryable: false };
}
