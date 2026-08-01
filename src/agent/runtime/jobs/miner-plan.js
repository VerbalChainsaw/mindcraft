const MINING_TARGETS = Object.freeze({
  cobblestone: 'stone',
  stone: 'stone',
});
const MINING_OUTPUTS = Object.freeze({
  cobblestone: 'cobblestone',
  stone: 'cobblestone',
  deepslate: 'cobbled_deepslate',
  coal_ore: 'coal',
  deepslate_coal_ore: 'coal',
  iron_ore: 'raw_iron',
  deepslate_iron_ore: 'raw_iron',
  copper_ore: 'raw_copper',
  deepslate_copper_ore: 'raw_copper',
  gold_ore: 'raw_gold',
  deepslate_gold_ore: 'raw_gold',
  redstone_ore: 'redstone',
  deepslate_redstone_ore: 'redstone',
  lapis_ore: 'lapis_lazuli',
  deepslate_lapis_ore: 'lapis_lazuli',
  diamond_ore: 'diamond',
  deepslate_diamond_ore: 'diamond',
  emerald_ore: 'emerald',
  deepslate_emerald_ore: 'emerald',
  nether_quartz_ore: 'quartz',
  nether_gold_ore: 'gold_nugget',
});

const REQUIRED_PICKAXE_TIER = Object.freeze({
  iron_ore: 3,
  deepslate_iron_ore: 3,
  copper_ore: 3,
  deepslate_copper_ore: 3,
  lapis_ore: 3,
  deepslate_lapis_ore: 3,
  gold_ore: 4,
  deepslate_gold_ore: 4,
  redstone_ore: 4,
  deepslate_redstone_ore: 4,
  diamond_ore: 4,
  deepslate_diamond_ore: 4,
  emerald_ore: 4,
  deepslate_emerald_ore: 4,
  ancient_debris: 5,
  obsidian: 5,
});
const PICKAXE_FOR_TIER = Object.freeze({
  1: 'wooden_pickaxe',
  3: 'stone_pickaxe',
  4: 'iron_pickaxe',
  5: 'diamond_pickaxe',
});
const MINING_KNOWLEDGE = Object.freeze({
  coal_ore: Object.freeze({ dimension: 'overworld', targetY: 96 }),
  deepslate_coal_ore: Object.freeze({ dimension: 'overworld', targetY: 0 }),
  iron_ore: Object.freeze({ dimension: 'overworld', targetY: 16 }),
  deepslate_iron_ore: Object.freeze({ dimension: 'overworld', targetY: -16 }),
  copper_ore: Object.freeze({ dimension: 'overworld', targetY: 48 }),
  deepslate_copper_ore: Object.freeze({ dimension: 'overworld', targetY: -8 }),
  gold_ore: Object.freeze({ dimension: 'overworld', targetY: -16 }),
  deepslate_gold_ore: Object.freeze({ dimension: 'overworld', targetY: -48 }),
  redstone_ore: Object.freeze({ dimension: 'overworld', targetY: -58 }),
  deepslate_redstone_ore: Object.freeze({ dimension: 'overworld', targetY: -58 }),
  lapis_ore: Object.freeze({ dimension: 'overworld', targetY: 0 }),
  deepslate_lapis_ore: Object.freeze({ dimension: 'overworld', targetY: -32 }),
  diamond_ore: Object.freeze({ dimension: 'overworld', targetY: -58 }),
  deepslate_diamond_ore: Object.freeze({ dimension: 'overworld', targetY: -58 }),
  emerald_ore: Object.freeze({ dimension: 'overworld', targetY: 96 }),
  deepslate_emerald_ore: Object.freeze({ dimension: 'overworld', targetY: 0 }),
  nether_quartz_ore: Object.freeze({ dimension: 'nether', targetY: 64 }),
  nether_gold_ore: Object.freeze({ dimension: 'nether', targetY: 64 }),
  ancient_debris: Object.freeze({ dimension: 'nether', targetY: 15 }),
  obsidian: Object.freeze({ dimension: 'overworld', targetY: 10 }),
});

export function canonicalMiningTarget(name) {
  if (typeof name !== 'string' || !/^[a-z0-9_]{1,64}$/.test(name)) return null;
  return MINING_TARGETS[name] || name;
}

export function miningOutputName(name) {
  return MINING_OUTPUTS[name] || name;
}

export function miningKnowledge(name) {
  return MINING_KNOWLEDGE[canonicalMiningTarget(name)] || null;
}

function inventoryCount(snapshot, name) {
  return Math.max(0, Number(snapshot?.inventory?.[name]) || 0);
}

function deliveryStep(order, snapshot, amount) {
  const item = miningOutputName(order.target.name);
  const delivered = Math.max(0, Number(order.checkpoint?.delivered) || 0);
  const deliverable = Math.min(
    Math.max(0, Number(amount) || 0),
    inventoryCount(snapshot, item),
    Math.max(0, order.quota - delivered),
  );
  if (deliverable < 1 && delivered >= order.quota) {
    return { complete: true, code: 'mining_quota_delivered' };
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
      command: `!givePlayer(${JSON.stringify(item)}, ${JSON.stringify(snapshot.deposit.leader)}, ${deliverable})`,
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
      command: `!putInChestAt(${JSON.stringify(item)}, ${deliverable}, ${target.x}, ${target.y}, ${target.z})`,
      nextPhase,
      checkpointOnSuccess,
    };
  }
  return { complete: true, code: 'mining_quota_retained' };
}

export function nextMinerStep(order, snapshot = {}) {
  const requested = order.target?.name;
  const naturalTarget = canonicalMiningTarget(requested);
  if (!naturalTarget) return { terminal: true, code: 'invalid_mining_target', retryable: false };
  const knowledge = miningKnowledge(naturalTarget);
  const constraints = order.constraints || {};
  if (knowledge?.dimension && snapshot.dimension && snapshot.dimension !== knowledge.dimension) {
    return {
      terminal: true,
      code: `wrong_dimension_${knowledge.dimension}`,
      retryable: false,
    };
  }
  const output = miningOutputName(requested);
  const current = inventoryCount(snapshot, output);
  const delivered = Math.max(0, Number(order.checkpoint?.delivered) || 0);
  const progress = current + delivered;
  if (order.phase !== 'deliver' && progress >= order.quota) {
    return { phase: 'deliver', code: 'mining_quota_met' };
  }
  if (order.phase === 'deliver') {
    return deliveryStep(order, snapshot, Math.min(current, Math.max(0, order.quota - delivered)));
  }
  if (order.phase === 'recover') {
    if (
      knowledge
      && Number.isFinite(snapshot.y)
      && Math.abs(snapshot.y - knowledge.targetY) > 10
    ) {
      return {
        command: `!goToMiningDepth(${knowledge.targetY}, 64)`,
        nextPhase: 'assess',
        code: 'mining_depth_relocation',
        target: { name: naturalTarget, y: knowledge.targetY },
      };
    }
    return {
      command: `!mineSearchTunnel(${JSON.stringify(naturalTarget)}, 12)`,
      nextPhase: 'assess',
      code: 'mining_search_tunnel',
    };
  }
  if (snapshot.escapeRoute === false) return { blocked: true, code: 'no_escape_route', retryable: true };
  if (snapshot.safeSelectedBlocks === false) return { blocked: true, code: 'unsafe_selected_blocks', retryable: true };
  if (
    Number(snapshot.foodPoints) < Number(constraints.minFoodPoints ?? 12)
    && Number(snapshot.hunger) < Number(constraints.minHunger ?? 16)
  ) {
    return {
      phase: 'prepare',
      command: `!prepareFood(${Math.max(24, Number(constraints.minFoodPoints) || 12)}, ${Math.max(16, Math.min(128, Number(constraints.maxDistance) || 64))})`,
      nextPhase: 'assess',
      code: 'food_resupply_required',
      target: { name: 'safe_food' },
    };
  }
  if (
    constraints.requireLight !== false
    && !['stone', 'cobblestone'].includes(requested)
    && Number(snapshot.lightCount) < 4
  ) {
    return {
      phase: 'prepare',
      command: `!prepareMaterial("torch", ${Math.max(4, 16 - Number(snapshot.lightCount || 0))}, ${Math.max(16, Math.min(512, Number(constraints.maxDistance) || 64))})`,
      nextPhase: 'assess',
      code: 'light_supplies_required',
      target: { name: 'torch' },
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
        command: `!depositInventoryOverflowAt("miner", ${JSON.stringify(output)}, ${Math.max(2, Number(constraints.reserveSlots) || 1)}, ${target.x}, ${target.y}, ${target.z})`,
        nextPhase: 'assess',
        code: 'inventory_consolidation_required',
        target: { name: 'inventory_overflow' },
      };
    }
    return { blocked: true, code: 'inventory_full_no_deposit', retryable: true };
  }

  const requiredTier = REQUIRED_PICKAXE_TIER[naturalTarget] || 1;
  if ((Number(snapshot.tools?.pickaxeTier) || 0) < requiredTier) {
    const requiredPickaxe = PICKAXE_FOR_TIER[requiredTier] || 'wooden_pickaxe';
    return {
      phase: 'prepare',
      command: `!prepareTool(${JSON.stringify(requiredPickaxe)})`,
      nextPhase: 'assess',
      code: 'pickaxe_required',
      target: { name: requiredPickaxe },
    };
  }
  if (order.phase === 'verify') {
    return progress >= order.quota
      ? { phase: 'deliver', code: 'mining_quota_met' }
      : { phase: 'execute', code: 'mining_continue' };
  }
  if (['assess', 'prepare'].includes(order.phase)) {
    if (
      snapshot.resourceFound === false
      && knowledge
      && Number.isFinite(snapshot.y)
      && Math.abs(snapshot.y - knowledge.targetY) > 10
    ) {
      return {
        command: `!goToMiningDepth(${knowledge.targetY}, 64)`,
        nextPhase: 'assess',
        code: 'seeking_productive_depth',
        target: { name: naturalTarget, y: knowledge.targetY },
      };
    }
    if (snapshot.resourceFound === false) {
      return {
        command: `!mineSearchTunnel(${JSON.stringify(naturalTarget)}, 12)`,
        nextPhase: 'assess',
        code: 'seeking_resource_tunnel',
        target: { name: naturalTarget },
      };
    }
    return { phase: 'execute', code: 'mining_ready' };
  }
  if (order.phase === 'execute') {
    const remaining = Math.max(1, Math.min(32, order.quota - progress));
    const range = Math.max(16, Math.min(512, Number(constraints.maxDistance) || 64));
    return {
      command: `!collectBlocksInRange(${JSON.stringify(requested)}, ${remaining}, ${range})`,
      nextPhase: 'verify',
      target: { name: naturalTarget, output },
    };
  }
  return { terminal: true, code: 'unsupported_miner_phase', retryable: false };
}
