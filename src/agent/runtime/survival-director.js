import { executeCommand as executeAgentCommand } from '../commands/index.js';
import * as mc from '../../utils/mcdata.js';
import { BehaviorDirector } from './behavior-director.js';
import {
  EMERGENCY_SHELTER_BLUEPRINT,
  validateEmergencyShelterBlueprint,
} from './emergency-shelter.js';
import { chooseSurvivalIntent } from './survival-policy.js';

const SUCCESS_COOLDOWN_MS = 2_000;
const FAILURE_COOLDOWN_MS = 10_000;
const BLOCKED_COOLDOWN_MS = 15_000;
const SURVIVAL_ENVIRONMENT_TTL_MS = 1_000;
const survivalEnvironmentCache = new WeakMap();
const UNSAFE_DROP_FOOD = new Set([
  'chicken',
  'poisonous_potato',
  'pufferfish',
  'rotten_flesh',
  'spider_eye',
  'suspicious_stew',
]);

function dimensionName(value) {
  const name = String(value || '').toLowerCase();
  if (name.endsWith('overworld')) return 'overworld';
  if (name.endsWith('the_nether') || name.endsWith('nether')) return 'nether';
  if (name.endsWith('the_end') || name.endsWith('end')) return 'end';
  return name;
}

function foodInventory(bot) {
  const foodData = bot.registry?.foodsByName || {};
  return (bot.inventory?.items?.() || [])
    .filter(item => item?.name && foodData[item.name])
    .map(item => ({
      name: item.name,
      count: item.count,
      foodPoints: foodData[item.name].foodPoints,
      saturation: foodData[item.name].saturation,
    }));
}

const ARMOR_SLOTS = Object.freeze([
  { index: 5, slot: 'head' },
  { index: 6, slot: 'torso' },
  { index: 7, slot: 'legs' },
  { index: 8, slot: 'feet' },
]);
const ARMOR_MATERIAL_SCORE = Object.freeze({
  leather: 1,
  golden: 2,
  turtle: 2,
  chainmail: 3,
  iron: 4,
  diamond: 5,
  netherite: 6,
});

function armorDescriptor(name) {
  if (typeof name !== 'string') return null;
  const slot = name.endsWith('_helmet')
    ? 'head'
    : name.endsWith('_chestplate')
      ? 'torso'
      : name.endsWith('_leggings')
        ? 'legs'
        : name.endsWith('_boots')
          ? 'feet'
          : null;
  if (!slot) return null;
  const material = name.split('_')[0];
  const score = ARMOR_MATERIAL_SCORE[material];
  return score ? { name, slot, score } : null;
}

function armorInventory(bot) {
  const equipped = ARMOR_SLOTS
    .map(({ index, slot }) => {
      const item = bot.inventory?.slots?.[index];
      const descriptor = armorDescriptor(item?.name);
      return descriptor && descriptor.slot === slot
        ? { ...descriptor, equipped: true }
        : null;
    })
    .filter(Boolean);
  const equippedItems = new Set(ARMOR_SLOTS.map(({ index }) => bot.inventory?.slots?.[index]).filter(Boolean));
  const carried = (bot.inventory?.items?.() || [])
    .filter(item => !equippedItems.has(item))
    .map(item => {
      const descriptor = armorDescriptor(item?.name);
      return descriptor ? { ...descriptor, equipped: false } : null;
    })
    .filter(Boolean);
  return [...equipped, ...carried];
}

function usefulDropCandidates(bot) {
  const candidates = [];
  for (const entity of Object.values(bot.entities || {})) {
    if (entity?.name !== 'item' || !entity.position || !bot.entity?.position) continue;
    const distance = bot.entity.position.distanceTo(entity.position);
    if (distance > 12) continue;
    let item;
    try {
      item = entity.getDroppedItem?.();
    } catch {
      continue;
    }
    const name = String(item?.name || '');
    const useful = Boolean(
      (bot.registry?.foodsByName?.[name] && !UNSAFE_DROP_FOOD.has(name))
      || /_(?:pickaxe|axe|shovel|hoe|sword|helmet|chestplate|leggings|boots|log|stem|planks|sapling|seeds)$/.test(name)
      || name.startsWith('raw_')
      || /_(?:ore|ingot|nugget)$/.test(name)
      || ['coal', 'charcoal', 'diamond', 'emerald', 'torch', 'crafting_table', 'furnace', 'bucket', 'shield'].includes(name)
    );
    if (useful) candidates.push({ name, distance, id: entity.id });
  }
  return candidates.sort((left, right) => left.distance - right.distance);
}

function offset(position, x, y, z) {
  if (typeof position?.offset === 'function') return position.offset(x, y, z);
  return { x: position.x + x, y: position.y + y, z: position.z + z };
}

function solidCover(block) {
  return Boolean(
    block
    && block.boundingBox === 'block'
    && !['water', 'lava'].includes(block.name),
  );
}

function shelterSituation(bot) {
  if (!bot.entity?.position || typeof bot.blockAt !== 'function') {
    return { sheltered: false, shelters: [] };
  }
  const origin = bot.entity.position;
  const sheltered = [2, 3].some(height => solidCover(bot.blockAt(offset(origin, 0, height, 0))));
  if (sheltered || typeof bot.findBlocks !== 'function') return { sheltered, shelters: [] };
  let roofs = [];
  try {
    roofs = bot.findBlocks({
      matching: block => solidCover(block),
      maxDistance: 16,
      count: 16,
    });
  } catch {
    return { sheltered: false, shelters: [] };
  }
  const hostile = bot.nearestEntity?.(entity => mc.isHostile(entity));
  const threatDistance = hostile?.position
    ? hostile.position.distanceTo(origin)
    : Infinity;
  const shelters = roofs
    .map(roof => {
      const feet = offset(roof, 0, -2, 0);
      const feetBlock = bot.blockAt(feet);
      const headBlock = bot.blockAt(offset(feet, 0, 1, 0));
      const floor = bot.blockAt(offset(feet, 0, -1, 0));
      if (
        feetBlock?.boundingBox !== 'empty'
        || headBlock?.boundingBox !== 'empty'
        || !solidCover(floor)
      ) return null;
      return {
        name: 'covered_space',
        x: feet.x,
        y: feet.y,
        z: feet.z,
        distance: origin.distanceTo(feet),
        reachable: true,
        safe: threatDistance > 12,
      };
    })
    .filter(Boolean);
  return { sheltered: false, shelters };
}

function bedCandidates(bot) {
  if (typeof bot.findBlocks !== 'function' || typeof bot.blockAt !== 'function') return [];
  let locations;
  try {
    locations = bot.findBlocks({
      matching: block => block?.name?.endsWith('_bed'),
      maxDistance: 24,
      count: 4,
    });
  } catch {
    return [];
  }
  const hostile = bot.nearestEntity?.(entity => mc.isHostile(entity));
  const threatDistance = hostile?.position && bot.entity?.position
    ? hostile.position.distanceTo(bot.entity.position)
    : Infinity;
  return locations
    .map(location => {
      const block = bot.blockAt(location);
      if (!block?.name?.endsWith('_bed')) return null;
      return {
        name: block.name,
        x: block.position.x,
        y: block.position.y,
        z: block.position.z,
        distance: bot.entity.position.distanceTo(block.position),
        reachable: true,
        safe: threatDistance > 12,
      };
    })
    .filter(Boolean);
}

function environmentalSituation(bot, now) {
  const position = bot.entity?.position;
  const dimension = dimensionName(bot.game?.dimension);
  const cached = survivalEnvironmentCache.get(bot);
  const moved = !cached
    || !position
    || Math.hypot(
      Number(position.x) - cached.x,
      Number(position.y) - cached.y,
      Number(position.z) - cached.z,
    ) > 2;
  if (
    cached
    && !moved
    && cached.dimension === dimension
    && now < cached.nextRefreshAt
  ) {
    return cached.value;
  }
  const value = {
    beds: bedCandidates(bot),
    usefulDrops: usefulDropCandidates(bot),
    ...shelterSituation(bot),
  };
  survivalEnvironmentCache.set(bot, {
    x: Number(position?.x) || 0,
    y: Number(position?.y) || 0,
    z: Number(position?.z) || 0,
    dimension,
    nextRefreshAt: now + SURVIVAL_ENVIRONMENT_TTL_MS,
    value,
  });
  return value;
}

export function clearSurvivalSituationCache(bot) {
  if (bot && typeof bot === 'object') survivalEnvironmentCache.delete(bot);
}

export function summarizeSurvivalSituation(agent, { now = Date.now() } = {}) {
  const bot = agent.bot;
  const modeStatus = bot.modes?.getStatus?.() || [];
  const urgentDanger = modeStatus.some(mode => (
    mode.active === true
    && ['self_preservation', 'cowardice', 'self_defense'].includes(mode.name)
  ));
  return {
    held: agent.isOperatorHeld?.() === true,
    idle: agent.isIdle?.() === true,
    health: Number(bot.health),
    hunger: Number(bot.food),
    recentDamage: Date.now() - Number(bot.lastDamageTime || 0) < 4_000,
    urgentDanger,
    food: foodInventory(bot),
    timeOfDay: Number(bot.time?.timeOfDay || 0),
    dimension: dimensionName(bot.game?.dimension),
    weather: bot.thunderState > 0 ? 'Thunderstorm' : bot.rainState > 0 ? 'Rain' : 'Clear',
    armor: armorInventory(bot),
    ...environmentalSituation(bot, now),
  };
}

export class SurvivalDirector extends BehaviorDirector {
  constructor(agent, {
    getSituation = summarizeSurvivalSituation,
    executeCommand = executeAgentCommand,
    requestWorkOrder,
  } = {}) {
    super(agent, { name: 'survival' });
    this.getSituation = getSituation;
    this.executeCommand = executeCommand;
    this.requestWorkOrder = requestWorkOrder || (order => (
      this.agent.job_director?.requestWorkOrder?.(order)
      || { accepted: false, code: 'job_director_unavailable' }
    ));
  }

  blocksLowerPriority() {
    if (this.inFlight || this.status.phase === 'acting') return true;
    if (this.status.phase !== 'waiting' || !new Set([
      'missing_safe_food',
      'recovery_missing_food',
      'regenerating_health',
      'preserving_food_reserve',
      'no_safe_storm_shelter',
      'no_safe_night_shelter',
    ]).has(this.status.code)) return false;
    try {
      const situation = this.getSituation(this.agent);
      const policy = this.agent.runtime?.survival || {};
      return Number(situation.health) <= 8
        || Number(situation.hunger) <= Number(policy.criticalFood ?? 6);
    } catch {
      // Unknown survival state must not seize player control indefinitely.
      return false;
    }
  }

  finish(result = {}) {
    const previousPhase = this.status?.phase;
    const previousCode = this.status?.code;
    super.finish(result);
    if (previousPhase !== this.status.phase || previousCode !== this.status.code) {
      this.agent.publishBehaviorEvent?.({
        type: 'survival.changed',
        target: this.status.target,
        evidence: {
          code: this.status.code,
          phase: this.status.phase,
        },
        salience: ['failed', 'blocked', 'interrupted'].includes(this.status.phase) ? 4 : 2,
      });
    }
  }

  update() {
    const policy = this.agent.runtime?.survival;
    if (!policy || policy.mode === 'off' || !this.canSchedule({ allowBusy: true })) return;

    let situation;
    let intent;
    try {
      situation = this.getSituation(this.agent);
      intent = chooseSurvivalIntent(situation, policy);
    } catch (error) {
      this.fail('situation_unavailable', error?.message || error, true);
      this.nextEligibleAt = Date.now() + FAILURE_COOLDOWN_MS;
      return;
    }
    if (!intent) return;
    const allowBusy = intent.preempt === true;
    if (situation.idle !== true && !allowBusy) return;
    if (intent.kind === 'wait') {
      this.finish({
        phase: 'waiting',
        code: intent.reason,
        detail: intent.reason === 'missing_safe_food'
          ? 'Hunger is low, but no safe food is available.'
          : 'Survival upkeep is waiting for a safe prerequisite.',
        retryable: intent.retryable === true,
      });
      this.nextEligibleAt = Date.now() + BLOCKED_COOLDOWN_MS;
      return;
    }

    if (intent.kind === 'shelter_work_order') {
      if (!validateEmergencyShelterBlueprint()) {
        this.fail('invalid_emergency_blueprint', 'Emergency shelter blueprint failed validation.', false);
        return;
      }
      if (!this.begin('shelter_work_order', null, intent.reason, { allowBusy })) return;
      let result;
      try {
        result = this.requestWorkOrder({
          kind: 'emergency_shelter',
          source: 'survival',
          reason: intent.reason,
          blueprint: EMERGENCY_SHELTER_BLUEPRINT,
        });
      } catch (error) {
        this.fail('work_order_dispatch_error', error?.message || error, true);
        this.nextEligibleAt = Date.now() + FAILURE_COOLDOWN_MS;
        return;
      }
      if (result?.accepted !== true) {
        this.finish({
          phase: 'waiting',
          code: result?.code || 'shelter_work_order_rejected',
          detail: 'Emergency shelter work is waiting for an available job director.',
          retryable: true,
        });
        this.nextEligibleAt = Date.now() + BLOCKED_COOLDOWN_MS;
        return;
      }
      this.finish({
        phase: 'requested',
        code: 'emergency_shelter_requested',
        target: { name: result.id || 'emergency_3x3' },
        detail: 'Validated emergency shelter work order accepted.',
        retryable: false,
      });
      this.nextEligibleAt = Date.now() + BLOCKED_COOLDOWN_MS;
      return;
    }

    const command = intent.kind === 'eat'
      ? `!consume(${JSON.stringify(intent.item)})`
      : intent.kind === 'acquire_food'
        ? `!prepareFood(${Math.max(6, Math.floor(Number(intent.targetFoodPoints) || 24))}, 64)`
      : intent.kind === 'collect_useful_drop'
        ? '!pickupUsefulItems(12)'
      : intent.kind === 'equip'
        ? `!equip(${JSON.stringify(intent.item)})`
      : intent.kind === 'sleep'
        ? '!goToBed'
        : intent.kind === 'seek_shelter'
          ? `!goToCoordinates(${intent.target.x}, ${intent.target.y}, ${intent.target.z}, 1)`
        : null;
    if (!command) {
      this.fail('unsupported_intent', `Survival intent '${intent.kind}' has no verified command path.`, false);
      return;
    }
    const target = ['eat', 'equip'].includes(intent.kind)
      ? { name: intent.item }
      : intent.kind === 'acquire_food'
        ? { name: 'safe_food', foodPoints: intent.targetFoodPoints }
        : intent.kind === 'collect_useful_drop'
          ? intent.target
        : intent.target;
    if (!this.begin(intent.kind, target, intent.reason, { allowBusy })) return;
    const previousActionId = this.agent.last_action_result?.actionId || null;

    void Promise.resolve(this.executeCommand(this.agent, command, { owner: 'survival' }))
      .then(() => {
        const result = this.agent.last_action_result;
        if (!result?.actionId || result.actionId === previousActionId) {
          this.fail('missing_action_result', 'Survival action returned without a new structured result.', true);
          this.nextEligibleAt = Date.now() + FAILURE_COOLDOWN_MS;
          return;
        }
        this.finish(result);
        this.nextEligibleAt = Date.now() + (
          result.phase === 'succeeded' ? SUCCESS_COOLDOWN_MS : FAILURE_COOLDOWN_MS
        );
      })
      .catch(error => {
        this.fail('dispatch_error', error?.message || error, true);
        this.nextEligibleAt = Date.now() + FAILURE_COOLDOWN_MS;
      });
  }
}
