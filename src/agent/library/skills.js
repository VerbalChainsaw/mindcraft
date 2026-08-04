import * as mc from "../../utils/mcdata.js";
import * as world from "./world.js";
import pf from '../../../packages/minecraft-runtime/mineflayer-pathfinder/index.js';
import Vec3 from 'vec3';
import settings from "../../../settings.js";
import { currentActionExecutionContext } from '../action_manager.js';
import {
    isFallingGameplayBlock,
    isHazardousGameplayBlock,
    isLiquidGameplayBlock,
    isProtectedGameplayBlock,
    isReplaceableGameplayBlock,
    isSafeGameplaySupport,
} from '../runtime/gameplay-safety.js';
import { collectorMatchesPlayerTarget, resolvePlayerTarget } from '../player-target.js';
import { companionContextFor, normalizePlayerDistance } from '../runtime/companion-context.js';
import { rankCollectionCandidates } from '../runtime/collection-candidate-selector.js';
import { chooseTacticalCombatDecision } from '../runtime/combat-decision.js';
import { observeCombatDamage } from '../runtime/combat-attribution.js';
import { chooseExplorationRoute } from '../runtime/exploration-route.js';
import { interruptibleDelay } from '../runtime/interruptible-delay.js';
import {
    isWaterPotion,
    potionFingerprint,
    resolveBrewingPlan,
} from '../runtime/brewing-plan.js';
import {
    entityRequiresSaddle,
    isRideableEntityName,
    matchesRideableEntity,
    rideableEntityKnowledge,
    steeringItemForEntity,
} from './game_knowledge.js';

const blockPlaceDelay = settings.block_place_delay == null ? 0 : settings.block_place_delay;
const useDelay = blockPlaceDelay > 0;
const doorIntervals = new WeakMap();
const FOLLOW_SAMPLE_MS = 200;
const FOLLOW_STUCK_AFTER_MS = 3_000;
const MAX_FOLLOW_RECOVERY_ATTEMPTS = 2;
const FOLLOW_RECOVERY_COOLDOWN_MS = 3_000;
const FOLLOW_REPLAN_DISTANCE = 1.25;
const MAX_AVOID_RETREAT_ATTEMPTS = 3;
const MIN_MOVEMENT_PROGRESS = 0.1;
const MAX_DEFENSE_SWINGS = 14;
const MAX_DEFENSE_FAILURES = 2;
const DEFENSE_SWING_INTERVAL_MS = 550;
const MAX_PVP_ENGAGEMENT_MS = 30_000;
const MAX_BOT_OUTPUT_CHARS = 2_048;
const MAX_MELEE_REACH = 3.2;
const TACTICAL_MELEE_REACH_MARGIN = 0.25;
const TACTICAL_MELEE_STANCE_RADIUS = 3;
const MAX_TACTICAL_MELEE_STANCES = 24;
const MAX_TACTICAL_MELEE_REPLANS = 2;
const TACTICAL_MELEE_REPLAN_DISTANCE = 0.75;
const ATTACK_CONFIRM_TIMEOUT_MS = 900;
const ATTACK_INTERRUPT_POLL_MS = 50;
const MAX_TACTICAL_COMBAT_STEPS = 24;
const TACTICAL_COMBAT_RANGE = 16;
const TACTICAL_BOW_CHARGE_MS = 900;
const TACTICAL_SHOT_CONFIRM_MS = 1_500;
const TACTICAL_SHIELD_WINDOW_MS = 450;
const TABLE_DROP_SEARCH_RADIUS = 4;
const TABLE_DROP_APPEAR_TIMEOUT_MS = 1_500;
const TABLE_PICKUP_TIMEOUT_MS = 1_500;
const INVENTORY_POLL_MS = 100;
const COLLECTION_DROP_TIMEOUT_MS = 4_000;
const COLLECTION_OPERATION_TIMEOUT_MS = 15_000;
const COLLECTION_SETTLEMENT_TIMEOUT_MS = 2_000;
const PICKUP_NAVIGATION_STALL_TIMEOUT_MS = 4_000;
const DOOR_SEARCH_RADIUS = 16;
const DOOR_INTERACTION_REACH = 4.5;
const DOOR_STATE_SETTLE_MS = 150;
const DOOR_TRAVERSE_TIMEOUT_MS = 1_200;
const DOOR_TRAVERSE_POLL_MS = 50;
const MIN_DOOR_TRAVERSE_PROGRESS = 0.75;
const INTERACTION_CONFIRM_TIMEOUT_MS = 750;
const INTERACTION_CONFIRM_POLL_MS = 50;
const NAVIGATION_PROGRESS_POLL_MS = 500;
const NAVIGATION_STALL_TIMEOUT_MS = 3_000;
const NAVIGATION_RECOVERY_STALL_TIMEOUT_MS = 1_500;
const NAVIGATION_PROGRESS_DISTANCE = 0.75;
const NAVIGATION_GOAL_PROGRESS_DELTA = 0.25;
const NAVIGATION_RECOVERY_DISTANCE = 1;
const NAVIGATION_RECOVERY_RADIUS = 4;
const MAX_NAVIGATION_RECOVERY_ATTEMPTS = 1;
const GROUND_SETTLE_TIMEOUT_MS = 800;
const SHALLOW_WATER_EXIT_TIMEOUT_MS = 2_500;
const SHALLOW_WATER_SHORE_SCAN_RADIUS = 32;
const DROWNING_RECOVERY_OXYGEN = 20;
const DELIVERY_MIN_DROP_HORIZONTAL_DISTANCE = 1.6;
const DELIVERY_MAX_DROP_HORIZONTAL_DISTANCE = 2.6;
const DELIVERY_MAX_DROP_LATERAL_OFFSET = 0.65;
const DELIVERY_PICKUP_TIMEOUT_MS = 3_250;
const MAX_DELIVERY_DROP_ATTEMPTS = 3;
const MOUNT_INTERACTION_RANGE = 4.5;
const MOUNT_CONFIRM_TIMEOUT_MS = 2_500;
const MOUNT_STABILITY_MS = 400;
const RIDE_CONTROL_POLL_MS = 150;
const BOAT_CONTROL_POLL_MS = 50;
const BOAT_TRAVEL_PER_TICK = 0.2;
const ANIMAL_TRAVEL_PER_TICK = 0.14;
const RIDE_STALL_TIMEOUT_MS = 8_000;
const RIDE_MAX_DURATION_MS = 120_000;
const RIDE_PROGRESS_DISTANCE = 0.35;
const MAX_COLLECTION_CANDIDATES = 12;
const MAX_COLLECTION_SCAN_CANDIDATES = 48;
const MAX_COLLECTION_SAFE_SCAN_CANDIDATES = 768;
const MAX_COLLECTION_STANCES = 24;
const MAX_COLLECTION_DROP_DEPTH = 2;
const COLLECTION_ROUTE_PROBE_TIMEOUT_MS = 75;
const COLLECTION_ROUTE_PROBE_TICK_MS = 15;
const MAX_COLLECTION_ROUTE_SLICES = 8;
const MAX_COLLECTION_SEARCH_RELOCATIONS = 3;
const MIN_COLLECTION_SEARCH_STEP = 24;
const MAX_COLLECTION_SEARCH_STEP = 40;
const MIN_COLLECTION_RESCAN_PROGRESS = 4;
const MAX_COLLECTION_TARGET_FAILURES = 1;
const MAX_COLLECTION_ACCESS_RECOVERIES = 2;
const COLLECTION_ACCESS_PROGRESS_DISTANCE = 1;
const MINING_TUNNEL_LENGTH = 12;
const MAX_MINING_ROUTE_HEADINGS = 3;
const MINING_ROUTE_STALL_TIMEOUT_MS = 5_000;
const MINING_ROUTE_STEP_TIMEOUT_MS = 2_000;
const MINING_ROUTE_STEP_ESTIMATE_MS = 450;
const MINING_ROUTE_DEADLINE_RESERVE_MS = 3_500;
const MAX_MINING_EXCAVATION_BLOCKS = 96;
const MAX_MINING_ROUTE_SEARCH_NODES = 8_192;
const MINING_STAGING_SCAN_RADIUS = 12;
const MAX_MINING_STAGING_ATTEMPTS = 2;
const DEFAULT_MAX_DROP_DOWN = 4;
const MAX_SURVIVABLE_DROP_DOWN = 12;
const SAFE_DROP_HEALTH_RESERVE = 10;
const RETRYABLE_COLLECTION_TARGET_OUTCOMES = new Set([
    'unreachable',
    'path_timeout',
    'path_stalled',
    'goal_not_reached',
    'not_broken',
    'target_unloaded',
    'collect_blocked',
    'not_collected',
]);

class ResponsiveFollowGoal extends pf.goals.GoalFollow {
    constructor(entity, range) {
        super(entity, range);
        this.replanDistanceSq = FOLLOW_REPLAN_DISTANCE * FOLLOW_REPLAN_DISTANCE;
    }

    hasChanged() {
        const position = this.entity?.position?.floored?.();
        if (!position) return false;
        const dx = this.x - position.x;
        const dy = this.y - position.y;
        const dz = this.z - position.z;
        if ((dx * dx + dy * dy + dz * dz) <= this.replanDistanceSq) return false;
        this.x = position.x;
        this.y = position.y;
        this.z = position.z;
        return true;
    }
}
const PORTAL_ACTIVATION_TIMEOUT_MS = 3_000;
const PORTAL_SEARCH_MIN_DISTANCE = 4;
const PORTAL_TRANSITION_TIMEOUT_MS = 30_000;
const PORTAL_DESTINATION_SETTLE_MS = 5_000;
const PORTAL_EXIT_TIMEOUT_MS = 5_000;
const EXPLORATION_STALL_TIMEOUT_MS = 20_000;
const EXPLORATION_LEG_TIMEOUT_MS = 90_000;
const BREW_STAGE_TIMEOUT_MS = 28_000;
const BREW_POLL_MS = 100;
const EXPLORATION_LANDMARK_BLOCKS = Object.freeze([
    'gold_block',
    'emerald_block',
    'diamond_block',
    'beacon',
    'lodestone',
]);
const EXPLORATION_CONTAINER_BLOCKS = Object.freeze(['chest', 'trapped_chest', 'barrel']);

function actionCancellationSignal() {
    return currentActionExecutionContext()?.signal || null;
}

function remainingActionTimeMs(fallbackMs = Number.POSITIVE_INFINITY) {
    const rawDeadline = currentActionExecutionContext()?.deadlineAt;
    if (rawDeadline === null || rawDeadline === undefined) return fallbackMs;
    const deadlineAt = Number(rawDeadline);
    if (!Number.isFinite(deadlineAt)) return fallbackMs;
    return Math.max(0, Math.min(fallbackMs, deadlineAt - Date.now()));
}

function playerTargetEvidence(resolution, extras = {}) {
    return {
        name: resolution?.requested || 'player',
        requestedName: resolution?.requested || '',
        canonicalName: resolution?.canonical || null,
        entityId: Number.isFinite(resolution?.entity?.id) ? resolution.entity.id : null,
        observedAt: resolution?.entity ? Date.now() : null,
        age: resolution?.entity ? 0 : null,
        lineOfSight: null,
        ...(!resolution?.canonical && resolution?.aliasesTried?.length
            ? { aliasesTried: [...resolution.aliasesTried] }
            : {}),
        ...extras,
    };
}

function resolvePhysicalPlayer(bot, requestedName) {
    const resolution = resolvePlayerTarget(bot, requestedName);
    companionContextFor(bot)?.observeResolution?.(requestedName, resolution, {
        dimension: bot.game?.dimension,
    });
    return resolution;
}
const WOOD_TO_PLANKS = Object.freeze({
    oak_log: 'oak_planks',
    spruce_log: 'spruce_planks',
    birch_log: 'birch_planks',
    jungle_log: 'jungle_planks',
    acacia_log: 'acacia_planks',
    dark_oak_log: 'dark_oak_planks',
    mangrove_log: 'mangrove_planks',
    cherry_log: 'cherry_planks',
    pale_oak_log: 'pale_oak_planks',
    crimson_stem: 'crimson_planks',
    warped_stem: 'warped_planks',
});
const TOOL_PREPARATION_SPECS = Object.freeze({
    wooden_pickaxe: Object.freeze({ family: 'pickaxe', tier: 1, material: 'planks', materialCount: 3 }),
    wooden_axe: Object.freeze({ family: 'axe', tier: 1, material: 'planks', materialCount: 3 }),
    wooden_shovel: Object.freeze({ family: 'shovel', tier: 1, material: 'planks', materialCount: 1 }),
    wooden_hoe: Object.freeze({ family: 'hoe', tier: 1, material: 'planks', materialCount: 2 }),
    wooden_sword: Object.freeze({ family: 'sword', tier: 1, material: 'planks', materialCount: 2 }),
    stone_pickaxe: Object.freeze({ family: 'pickaxe', tier: 3, material: 'cobblestone', materialCount: 3 }),
    stone_axe: Object.freeze({ family: 'axe', tier: 3, material: 'cobblestone', materialCount: 3 }),
    stone_shovel: Object.freeze({ family: 'shovel', tier: 3, material: 'cobblestone', materialCount: 1 }),
    stone_hoe: Object.freeze({ family: 'hoe', tier: 3, material: 'cobblestone', materialCount: 2 }),
    stone_sword: Object.freeze({ family: 'sword', tier: 3, material: 'cobblestone', materialCount: 2 }),
    iron_pickaxe: Object.freeze({ family: 'pickaxe', tier: 4, material: 'iron_ingot', materialCount: 3 }),
    iron_axe: Object.freeze({ family: 'axe', tier: 4, material: 'iron_ingot', materialCount: 3 }),
    iron_shovel: Object.freeze({ family: 'shovel', tier: 4, material: 'iron_ingot', materialCount: 1 }),
    iron_hoe: Object.freeze({ family: 'hoe', tier: 4, material: 'iron_ingot', materialCount: 2 }),
    iron_sword: Object.freeze({ family: 'sword', tier: 4, material: 'iron_ingot', materialCount: 2 }),
    diamond_pickaxe: Object.freeze({ family: 'pickaxe', tier: 5, material: 'diamond', materialCount: 3 }),
    diamond_axe: Object.freeze({ family: 'axe', tier: 5, material: 'diamond', materialCount: 3 }),
    diamond_shovel: Object.freeze({ family: 'shovel', tier: 5, material: 'diamond', materialCount: 1 }),
    diamond_hoe: Object.freeze({ family: 'hoe', tier: 5, material: 'diamond', materialCount: 2 }),
    diamond_sword: Object.freeze({ family: 'sword', tier: 5, material: 'diamond', materialCount: 2 }),
});
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
const COOKABLE_FOOD = Object.freeze({
    raw_beef: 'steak',
    raw_chicken: 'cooked_chicken',
    raw_cod: 'cooked_cod',
    raw_mutton: 'cooked_mutton',
    raw_porkchop: 'cooked_porkchop',
    raw_rabbit: 'cooked_rabbit',
    raw_salmon: 'cooked_salmon',
    potato: 'baked_potato',
});
const SMELTING_OUTPUT = Object.freeze({
    ...COOKABLE_FOOD,
    raw_iron: 'iron_ingot',
    raw_gold: 'gold_ingot',
    raw_copper: 'copper_ingot',
    kelp: 'dried_kelp',
    sand: 'glass',
    cobblestone: 'stone',
    clay_ball: 'brick',
});
const CROP_FOOD_SPECS = Object.freeze({
    carrots: Object.freeze({ harvest: 'carrot', seed: 'carrot', maxAge: 7 }),
    potatoes: Object.freeze({ harvest: 'potato', seed: 'potato', maxAge: 7 }),
    beetroots: Object.freeze({ harvest: 'beetroot', seed: 'beetroot_seeds', maxAge: 3 }),
    wheat: Object.freeze({ harvest: 'wheat', seed: 'wheat_seeds', maxAge: 7 }),
});
const HUNT_FOOD_SPECS = Object.freeze({
    cow: 'raw_beef',
    chicken: 'raw_chicken',
    pig: 'raw_porkchop',
    sheep: 'raw_mutton',
    rabbit: 'raw_rabbit',
});

function setActionEvidence(bot, evidence) {
    bot.lastActionEvidence = { ...evidence, recordedAt: Date.now() };
}

function collectionErrorOutcome(error) {
    const name = String(error?.name || '').toLowerCase();
    const message = String(error?.message || error || '').toLowerCase();
    if (
        name.includes('nopath')
        || name.includes('pathstopped')
        || message.includes('no path')
        || message.includes('path was stopped')
        || message.includes('path stopped')
    ) return 'unreachable';
    if (
        name.includes('timeout')
        || message.includes('timed out')
        || message.includes('timeout')
    ) return 'path_timeout';
    if (
        name.includes('tool')
        || message.includes('tool')
        || message.includes('harvest')
    ) return 'missing_tool';
    return 'collect_blocked';
}

function pathfinderErrorOutcome(error, interrupted = false) {
    if (interrupted) return 'interrupted';
    const name = String(error?.name || '').toLowerCase();
    if (name === 'nopath') return 'unreachable';
    if (name === 'timeout') return 'path_timeout';
    if (name === 'goalchanged') return 'goal_changed';
    if (name === 'pathstopped') return 'path_stopped';
    return 'path_error';
}

function inventoryCount(bot, itemName) {
    const count = world.getInventoryCounts(bot)?.[itemName];
    return Number.isFinite(count) ? count : 0;
}

function safeFoodPoints(bot) {
    const foods = bot.registry?.foodsByName || {};
    return bot.inventory.items().reduce((total, item) => {
        const food = foods[item.name];
        if (
            !food
            || UNSAFE_FOOD_ITEMS.has(item.name)
            || Object.prototype.hasOwnProperty.call(COOKABLE_FOOD, item.name)
        ) return total;
        return total + (Math.max(0, Number(item.count) || 0) * Math.max(0, Number(food.foodPoints) || 0));
    }, 0);
}

function cropAge(block) {
    try {
        const age = Number(block?.getProperties?.()?.age);
        if (Number.isFinite(age)) return age;
    } catch {
        // Older protocol adapters expose crop age through metadata.
    }
    const metadata = Number(block?.metadata);
    return Number.isFinite(metadata) ? metadata : -1;
}

function matureFoodCrop(block) {
    const spec = CROP_FOOD_SPECS[block?.name];
    return Boolean(spec && cropAge(block) >= spec.maxAge);
}

async function waitForInventoryCount(bot, itemName, expectedCount, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (inventoryCount(bot, itemName) < expectedCount && Date.now() < deadline) {
        if (bot.interrupt_code) break;
        await interruptibleDelay(bot, INVENTORY_POLL_MS);
    }
    return inventoryCount(bot, itemName) >= expectedCount;
}

async function waitForWorldCondition(bot, predicate, timeoutMs, pollMs=50) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !bot.interrupt_code) {
        if (predicate()) return true;
        await interruptibleDelay(bot, pollMs);
    }
    return !bot.interrupt_code && Boolean(predicate());
}

function findDroppedItemNear(bot, itemName, position, maxDistance=TABLE_DROP_SEARCH_RADIUS) {
    const matches = [];
    for (const entity of Object.values(bot.entities || {})) {
        if (entity?.name !== 'item' || !entity.position) continue;
        const distance = entity.position.distanceTo(position);
        if (distance > maxDistance) continue;
        try {
            if (entity.getDroppedItem?.()?.name === itemName) {
                matches.push({ entity, distance });
            }
        } catch (error) {
            console.warn(`[craft] Could not inspect dropped item ${entity.id}: ${String(error?.message || error).slice(0, 240)}`);
        }
    }
    matches.sort((left, right) => left.distance - right.distance);
    return matches[0]?.entity || null;
}

async function approachDroppedItem(bot, entity, timeoutMs=PICKUP_NAVIGATION_STALL_TIMEOUT_MS) {
    if (!entity?.position || !bot.entity?.position || bot.interrupt_code) return false;
    const entityId = entity.id;
    const position = entity.position.clone();
    const target = {
        name: entity.displayName || 'item',
        id: entityId,
        x: position.x,
        y: position.y,
        z: position.z,
    };

    // Collect Block already owns moving to item entities and confirming their
    // disappearance. Keep our action deadline, movement policy, and final
    // inventory verification around that physical executor.
    try {
        bot.collectBlock.movements = safeMovements(bot);
        await runBoundedCollectionOperation(
            bot,
            () => bot.collectBlock.collect(entity),
            () => bot.collectBlock.cancelTask(),
            timeoutMs,
        );
    } catch (error) {
        if (bot.interrupt_code) return false;
        setActionEvidence(bot, {
            kind: 'movement',
            outcome: error?.name === 'Timeout' ? 'path_stalled' : 'unreachable',
            target,
            error: String(error?.message || error).slice(0, 240),
            retryable: true,
        });
        return false;
    } finally {
        const movements = safeMovements(bot);
        bot.collectBlock.movements = movements;
        bot.pathfinder.setMovements(movements);
    }
    return !bot.entities?.[entityId] && !bot.interrupt_code;
}

async function placeLocalCraftingTable(bot) {
    const inventoryBeforePlacement = inventoryCount(bot, 'crafting_table');
    if (inventoryBeforePlacement < 1) {
        return { ok: false, outcome: 'missing_crafting_table' };
    }
    const placement = world.getNearestFreeSpace(bot, 1, 6);
    if (!placement) {
        return { ok: false, outcome: 'no_table_space' };
    }
    const position = new Vec3(
        Math.floor(placement.x),
        Math.floor(placement.y),
        Math.floor(placement.z),
    );
    if (!await placeBlock(bot, 'crafting_table', position.x, position.y, position.z)) {
        return { ok: false, outcome: 'table_not_placed' };
    }
    const block = bot.blockAt(position);
    if (block?.name !== 'crafting_table') {
        return { ok: false, outcome: 'table_unavailable' };
    }
    return { ok: true, block, position, inventoryBeforePlacement };
}

function directlyUsableWorkstation(bot, block, range = 4.5) {
    if (!block?.position || !bot.entity?.position) return false;
    if (bot.entity.position.distanceTo(block.position) > range) return false;
    try {
        return typeof bot.canSeeBlock !== 'function' || bot.canSeeBlock(block);
    } catch {
        return false;
    }
}

async function recoverLocalCraftingTable(bot, temporaryTable) {
    const { position, inventoryBeforePlacement } = temporaryTable;
    const target = { name: 'crafting_table', x: position.x, y: position.y, z: position.z };
    if (inventoryCount(bot, 'crafting_table') >= inventoryBeforePlacement) {
        return { outcome: 'already_recovered', target, retryable: false };
    }

    const placedTable = bot.blockAt(position);
    if (placedTable?.name === 'crafting_table') {
        const distance = bot.entity.position.distanceTo(placedTable.position);
        if (distance > 4.5) {
            return { outcome: 'table_left_in_world', target, distance, retryable: true };
        }
        try {
            await bot.dig(placedTable);
        } catch (error) {
            return {
                outcome: 'table_cleanup_blocked',
                target,
                error: String(error?.message || error).slice(0, 240),
                retryable: true,
            };
        }
        if (bot.blockAt(position)?.name === 'crafting_table') {
            return { outcome: 'table_not_broken', target, retryable: true };
        }
    }

    if (await waitForInventoryCount(
        bot,
        'crafting_table',
        inventoryBeforePlacement,
        INVENTORY_POLL_MS * 2,
    )) {
        return { outcome: 'recovered', target, retryable: false };
    }
    if (bot.interrupt_code) {
        return { outcome: 'recovery_interrupted', target, retryable: false };
    }

    const dropDeadline = Date.now() + TABLE_DROP_APPEAR_TIMEOUT_MS;
    let droppedTable = null;
    while (!droppedTable && Date.now() < dropDeadline && !bot.interrupt_code) {
        droppedTable = findDroppedItemNear(bot, 'crafting_table', position);
        if (!droppedTable) {
            await interruptibleDelay(bot, INVENTORY_POLL_MS);
        }
    }
    if (!droppedTable) {
        return {
            outcome: bot.interrupt_code ? 'recovery_interrupted' : 'table_drop_unobserved',
            target,
            retryable: !bot.interrupt_code,
        };
    }

    const reached = await approachDroppedItem(bot, droppedTable, TABLE_PICKUP_TIMEOUT_MS);
    if (!reached) {
        return {
            outcome: bot.interrupt_code ? 'recovery_interrupted' : 'table_drop_unreachable',
            target: { ...target, entityId: droppedTable.id },
            retryable: !bot.interrupt_code,
        };
    }
    const recovered = await waitForInventoryCount(
        bot,
        'crafting_table',
        inventoryBeforePlacement,
        TABLE_PICKUP_TIMEOUT_MS,
    );
    return {
        outcome: recovered
            ? 'recovered'
            : bot.interrupt_code
                ? 'recovery_interrupted'
                : 'table_drop_not_collected',
        target: { ...target, entityId: droppedTable.id },
        retryable: !recovered && !bot.interrupt_code,
    };
}

function inventoryCountByTypes(bot, itemTypes) {
    if (!(itemTypes instanceof Set) || itemTypes.size === 0) return 0;
    return bot.inventory.items().reduce(
        (total, item) => total + (itemTypes.has(item.type) ? item.count : 0),
        0,
    );
}

async function waitForExpectedDropPickup(bot, itemTypes, beforeCount, timeoutMs=COLLECTION_DROP_TIMEOUT_MS) {
    const deadline = Date.now() + remainingActionTimeMs(timeoutMs);
    const signal = actionCancellationSignal();
    while (Date.now() < deadline && !bot.interrupt_code && !signal?.aborted) {
        if (inventoryCountByTypes(bot, itemTypes) > beforeCount) return true;
        const expectedDrop = Object.values(bot.entities || {}).find(entity => {
            if (entity?.name !== 'item' || !entity.position) return false;
            if (bot.entity.position.distanceTo(entity.position) > 8) return false;
            try {
                return itemTypes.has(entity.getDroppedItem?.()?.type);
            } catch {
                return false;
            }
        });
        if (expectedDrop) {
            const remaining = Math.max(100, deadline - Date.now());
            await approachDroppedItem(bot, expectedDrop, remaining);
            if (inventoryCountByTypes(bot, itemTypes) > beforeCount) return true;
        }
        await interruptibleDelay(bot, INVENTORY_POLL_MS);
    }
    return inventoryCountByTypes(bot, itemTypes) > beforeCount;
}

function collectionOperationIsSettled(bot) {
    const controls = bot?.controlState || {};
    return bot?.pathfinder?.isMoving?.() !== true
        && !bot?.targetDigBlock
        && !Object.values(controls).some(Boolean);
}

async function waitForCollectionOperationSettlement(bot, timeoutMs=COLLECTION_SETTLEMENT_TIMEOUT_MS) {
    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
    while (!collectionOperationIsSettled(bot) && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    return collectionOperationIsSettled(bot);
}

async function cancelCollectionOperationAndSettle(bot, cancel) {
    try { await Promise.resolve().then(() => cancel?.()); } catch { /* physical settlement below is authoritative */ }
    while (!collectionOperationIsSettled(bot)) {
        stopNavigationGoal(bot);
        try { await bot.stopDigging?.(); } catch { /* no active dig */ }
        try { bot.clearControlStates?.(); } catch { /* disconnected body */ }
        if (await waitForCollectionOperationSettlement(bot)) return;
        console.warn('[collect] Cancellation is still settling; ActionManager ownership remains held.');
    }
}

async function runBoundedCollectionOperation(bot, operation, cancel, requestedTimeoutMs=null) {
    const timedOut = Symbol('collection-timeout');
    const signal = actionCancellationSignal();
    const actionContext = currentActionExecutionContext();
    const actionTimeoutMs = actionContext?.deadlineAt !== null
        && actionContext?.deadlineAt !== undefined
        && Number.isFinite(Number(actionContext.deadlineAt))
        ? remainingActionTimeMs()
        : COLLECTION_OPERATION_TIMEOUT_MS;
    const requested = requestedTimeoutMs === null || requestedTimeoutMs === undefined
        ? Number.NaN
        : Number(requestedTimeoutMs);
    const timeoutMs = Number.isFinite(requested) && requested >= 0
        ? Math.min(actionTimeoutMs, requested)
        : actionTimeoutMs;
    let timeout = null;
    let onAbort = null;
    const operationPromise = Promise.resolve().then(operation);
    const settledOperation = operationPromise.then(
        value => ({ kind: 'resolved', value }),
        error => ({ kind: 'rejected', error }),
    );
    const deadline = new Promise(resolve => {
        const finish = () => resolve(timedOut);
        if (signal?.aborted || timeoutMs <= 0) {
            finish();
            return;
        }
        timeout = setTimeout(finish, timeoutMs);
        if (signal?.addEventListener) {
            onAbort = finish;
            signal.addEventListener('abort', onAbort, { once: true });
        }
    });
    const result = await Promise.race([
        settledOperation,
        deadline,
    ]);
    if (timeout) clearTimeout(timeout);
    if (onAbort) signal?.removeEventListener?.('abort', onAbort);
    if (result !== timedOut) {
        if (result.kind === 'rejected') throw result.error;
        if (!await waitForCollectionOperationSettlement(bot)) {
            await cancelCollectionOperationAndSettle(bot, cancel);
        }
        return result.value;
    }

    // Cancellation returning is not enough: collectblock and dig promises can
    // otherwise keep moving after ActionManager appears idle. Keep ownership
    // until both the cancellation request and the original operation settle.
    await cancelCollectionOperationAndSettle(bot, cancel);
    await settledOperation;
    await cancelCollectionOperationAndSettle(bot, cancel);
    const error = new Error(`Collection operation exceeded its action deadline after ${Math.round(timeoutMs)}ms.`);
    error.name = 'Timeout';
    throw error;
}

function hasInventoryRoomFor(bot, itemName) {
    if (bot.inventory.emptySlotCount() > 0) return true;
    return bot.inventory.items().some(item => (
        item.name === itemName
        && Number.isFinite(item.stackSize)
        && item.count < item.stackSize
    ));
}

async function closeContainerQuietly(container) {
    if (!container?.close) return;
    try {
        await container.close();
    } catch (error) {
        console.warn(`[inventory] Failed to close container: ${String(error?.message || error).slice(0, 240)}`);
    }
}

// Blocks a route may tunnel through when the profile permits it. This is an
// allow-list of unambiguously natural fill, never a deny-list: anything a
// player could have built — planks, bricks, glass, wool, concrete, sandstone,
// terracotta, beds, doors, torches — is absent, so a digging bot cannot chew
// through someone's house. Ores are absent too; breaking those is collection,
// which is authorized separately and explicitly.
const NATURAL_FILL_BLOCKS = new Set([
    'dirt', 'coarse_dirt', 'rooted_dirt', 'grass_block', 'podzol', 'mycelium', 'mud',
    'clay', 'gravel', 'sand', 'red_sand', 'snow_block', 'moss_block',
    'stone', 'cobblestone', 'deepslate', 'cobbled_deepslate', 'tuff',
    'andesite', 'diorite', 'granite', 'calcite', 'dripstone_block',
    'netherrack', 'soul_sand', 'soul_soil', 'basalt', 'blackstone',
    'end_stone',
]);
const TRAVERSAL_POLICIES = new Set(['preserve', 'careful', 'full']);

function traversalPolicy(bot) {
    const policy = String(bot?.traversalPolicy || '').trim().toLowerCase();
    // Anything unrecognized falls back to the non-destructive policy.
    return TRAVERSAL_POLICIES.has(policy) ? policy : 'preserve';
}

function isEnvironmentallySafeToClear(bot, block) {
    if (isProtectedGameplayBlock(block) || isHazardousGameplayBlock(block)) return false;
    const position = block.position;
    if (!position?.offset) return true;
    // Never open a face onto liquid: a single wrong block floods a tunnel.
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        let neighbour;
        try {
            neighbour = bot.blockAt(position.offset(dx, dy, dz));
        } catch {
            return false;
        }
        if (!neighbour) return false;
        if (isLiquidGameplayBlock(neighbour)) return false;
        if (dy === 1 && isFallingGameplayBlock(neighbour)) return false;
    }
    return true;
}

export function isNaturalFillBlock(bot, block) {
    if (!block?.name || !NATURAL_FILL_BLOCKS.has(block.name)) return false;
    return isEnvironmentallySafeToClear(bot, block);
}

/**
 * Natural material a player-authorized build may remove from its exact
 * footprint. Foliage belongs here but not in traversal: a builder must be able
 * to clear a tree canopy from a worksite, while an ordinary pathfinder should
 * not chew through decorative hedges just to shorten a route.
 */
export function isClearableWorksiteBlock(bot, block) {
    const name = String(block?.name || '');
    if (!NATURAL_FILL_BLOCKS.has(name) && !name.endsWith('_leaves')) return false;
    return isEnvironmentallySafeToClear(bot, block);
}

function safeMovements(bot) {
    const movements = new pf.Movements(bot);
    const defaultSafeToBreak = movements.safeToBreak.bind(movements);
    // Natural traversal is allowed; destructive escape behaviors are not.
    movements.canDig = false;
    movements.allow1by1towers = false;
    movements.allowParkour = false;
    movements.allowSprinting = true;
    movements.canOpenDoors = true;
    movements.entitiesToAvoid.add('player');
    movements.dontMineUnderFallingBlock = true;
    movements.dontCreateFlow = true;
    movements.placeCost = 8;
    movements.digCost = 10;
    for (const block of ['glass', 'glass_pane']) movements.blocksCantBreak.add(mc.getBlockId(block));

    const policy = traversalPolicy(bot);
    if (policy !== 'preserve') {
        // The destructive surface is identical for 'careful' and 'full': natural
        // fill only. 'full' widens mobility, never what may be broken.
        movements.canDig = true;
        movements.safeToBreak = candidate => (
            defaultSafeToBreak(candidate) && isNaturalFillBlock(bot, candidate)
        );
        if (policy === 'full') {
            movements.allow1by1towers = true;
            movements.allowParkour = true;
        }
    }
    // Collection restores this to authorize an explicitly selected resource,
    // which is deliberately not ordinary terrain.
    movements.defaultSafeToBreak = defaultSafeToBreak;
    return guardExecutableDiagonalCorners(movements);
}

export function guardExecutableDiagonalCorners(movements) {
    if (!movements || typeof movements.getBlock !== 'function'
        || typeof movements.getMoveDiagonal !== 'function') {
        return movements;
    }
    const getMoveDiagonal = movements.getMoveDiagonal.bind(movements);
    movements.getMoveDiagonal = (node, direction, neighbours) => {
        const landing = movements.getBlock(node, direction.x, 0, direction.z);
        const yOffset = landing?.physical ? 1 : 0;
        // Pathfinder drives directly at its next node. A raised diagonal makes
        // that line intersect the landing block's outer corner, so the graph
        // must align on a cardinal cell before asking the executor to jump.
        if (yOffset > 0) return;
        const sideOffsets = [
            [0, yOffset, direction.z],
            [0, yOffset + 1, direction.z],
            [direction.x, yOffset, 0],
            [direction.x, yOffset + 1, 0],
        ];
        const sideCorridorsOpen = sideOffsets.every(([dx, dy, dz]) => {
            const block = movements.getBlock(node, dx, dy, dz);
            return block?.safe === true;
        });
        if (!sideCorridorsOpen) return;
        return getMoveDiagonal(node, direction, neighbours);
    };
    return movements;
}

function miningMovements(bot) {
    const movements = safeMovements(bot);
    const defaultSafeToBreak = movements.defaultSafeToBreak;
    movements.canDig = true;
    movements.allow1by1towers = false;
    movements.allowParkour = false;
    movements.digCost = 2;
    movements.safeToBreak = candidate => (
        defaultSafeToBreak(candidate) && isNaturalFillBlock(bot, candidate)
    );
    return movements;
}

function isLocalNavigationFoliage(bot, block, origin) {
    const position = block?.position;
    if (!position || !String(block.name || '').endsWith('_leaves')) return false;
    const dx = Math.abs(position.x - origin.x);
    const dy = position.y - origin.y;
    const dz = Math.abs(position.z - origin.z);
    return dx <= NAVIGATION_RECOVERY_RADIUS
        && dz <= NAVIGATION_RECOVERY_RADIUS
        && dy >= 0
        && dy <= NAVIGATION_RECOVERY_RADIUS
        && isEnvironmentallySafeToClear(bot, block);
}

function localNavigationRecoveryMovements(bot, origin) {
    const movements = safeMovements(bot);
    let foliageCount = 0;
    for (let dx = -NAVIGATION_RECOVERY_RADIUS; dx <= NAVIGATION_RECOVERY_RADIUS; dx++) {
        for (let dy = 0; dy <= NAVIGATION_RECOVERY_RADIUS; dy++) {
            for (let dz = -NAVIGATION_RECOVERY_RADIUS; dz <= NAVIGATION_RECOVERY_RADIUS; dz++) {
                let block;
                try {
                    block = bot.blockAt(origin.offset(dx, dy, dz));
                } catch {
                    continue;
                }
                if (isLocalNavigationFoliage(bot, block, origin)) foliageCount += 1;
            }
        }
    }
    if (foliageCount === 0) return { movements, foliageCount };

    const defaultSafeToBreak = movements.defaultSafeToBreak;
    movements.canDig = true;
    // Prefer every available no-dig sidestep. Leaf clearance is a last resort
    // and is limited to the immediate canopy surrounding the stuck bot.
    movements.digCost = Math.max(50, movements.digCost);
    movements.safeToBreak = candidate => (
        defaultSafeToBreak(candidate)
        && isLocalNavigationFoliage(bot, candidate, origin)
    );
    return { movements, foliageCount };
}

function survivableDropDistance(bot) {
    const health = Number(bot?.health);
    if (!Number.isFinite(health)) return DEFAULT_MAX_DROP_DOWN;
    // Vanilla fall damage starts after three blocks. Keep five hearts in
    // reserve and widen the cap only when the bot's current health can pay
    // for the fall. Normal routing remains damage-free; this is fallback only.
    const damageBudget = Math.max(0, Math.floor(health - SAFE_DROP_HEALTH_RESERVE));
    return Math.max(
        DEFAULT_MAX_DROP_DOWN,
        Math.min(MAX_SURVIVABLE_DROP_DOWN, 3 + damageBudget),
    );
}

function safeDescentMovements(bot) {
    const movements = safeMovements(bot);
    movements.maxDropDown = Math.max(
        Number(movements.maxDropDown) || DEFAULT_MAX_DROP_DOWN,
        survivableDropDistance(bot),
    );
    return movements;
}

function collectionSafetyMovements(bot) {
    const movements = safeMovements(bot);
    // This instance evaluates whether an explicitly selected resource may be
    // broken. It is never used as the ordinary route policy, so the traversal
    // allow-list must not be allowed to veto the chosen target.
    movements.canDig = true;
    movements.safeToBreak = movements.defaultSafeToBreak;
    return movements;
}

function isCollectionStandingCellClear(block) {
    return Boolean(
        block
        && block.boundingBox === 'empty'
        && !isLiquidGameplayBlock(block)
        && !isHazardousGameplayBlock(block)
    );
}

function physicallyOccupiesStandingCell(bot, expected) {
    const position = bot.entity?.position;
    if (!position || !expected) return false;
    // Minecraft can report a supported player's Y a tiny fraction below the
    // integer feet coordinate. floor() then names the support cell while
    // Pathfinder correctly resolves the intended GoalBlock one cell above.
    // Verify the actual body volume and support instead of trusting the
    // transient onGround bit or raw flooring alone.
    if (
        Math.floor(position.x) !== expected.x
        || Math.floor(position.z) !== expected.z
        || Math.abs(position.y - expected.y) > 0.2
    ) return false;
    return Boolean(
        isCollectionStandingCellClear(bot.blockAt(expected))
        && isCollectionStandingCellClear(bot.blockAt(expected.offset(0, 1, 0)))
        && isSafeGameplaySupport(bot.blockAt(expected.offset(0, -1, 0)))
    );
}

function observedSupportedStandingCell(bot) {
    const floored = bot.entity?.position?.floored?.();
    if (!floored) return null;
    return [floored, floored.offset(0, 1, 0)]
        .find(candidate => physicallyOccupiesStandingCell(bot, candidate)) || null;
}

function collectionDropSupport(bot, targetPosition) {
    for (let depth = 1; depth <= MAX_COLLECTION_DROP_DEPTH + 1; depth += 1) {
        const position = targetPosition.offset(0, -depth, 0);
        const block = bot.blockAt(position);
        if (!block) return { safe: false, code: 'target_unloaded', dropDepth: null };
        if (isLiquidGameplayBlock(block) || isHazardousGameplayBlock(block)) {
            return { safe: false, code: 'unsafe_drop_support', dropDepth: null };
        }
        if (block.boundingBox === 'empty') continue;
        return isSafeGameplaySupport(block)
            ? { safe: true, code: 'stable_drop_support', dropDepth: depth - 1 }
            : { safe: false, code: 'unsafe_drop_support', dropDepth: null };
    }
    return { safe: false, code: 'unsafe_drop_support', dropDepth: null };
}

function collectionStandingPositions(bot, targetBlock) {
    const target = targetBlock.position;
    const lookGoal = new pf.goals.GoalLookAtBlock(target, bot.world, {
        reach: 4.5,
        entityHeight: Number(bot.entity?.eyeHeight) || 1.6,
    });
    const positions = [];
    for (let y = target.y - 2; y <= target.y + 3; y += 1) {
        for (let x = target.x - 4; x <= target.x + 4; x += 1) {
            for (let z = target.z - 4; z <= target.z + 4; z += 1) {
                const feet = new Vec3(x, y, z);
                const supportPosition = feet.offset(0, -1, 0);
                if (
                    supportPosition.x === target.x
                    && supportPosition.y === target.y
                    && supportPosition.z === target.z
                ) continue;
                if (!isCollectionStandingCellClear(bot.blockAt(feet))) continue;
                if (!isCollectionStandingCellClear(bot.blockAt(feet.offset(0, 1, 0)))) continue;
                if (!isSafeGameplaySupport(bot.blockAt(supportPosition))) continue;
                if (!lookGoal.isEnd(feet)) continue;
                positions.push(feet);
            }
        }
    }
    const origin = bot.entity?.position;
    positions.sort((left, right) => (
        (origin?.distanceTo(left) ?? Number.POSITIVE_INFINITY)
            - (origin?.distanceTo(right) ?? Number.POSITIVE_INFINITY)
        || left.y - right.y
        || left.x - right.x
        || left.z - right.z
    ));
    return positions.slice(0, MAX_COLLECTION_STANCES);
}

export function assessStableMiningCollectionTarget(bot, block) {
    const target = block?.position;
    if (!target?.offset) {
        return { safe: false, code: 'target_unloaded', dropDepth: null, stances: [] };
    }
    const dropSupport = collectionDropSupport(bot, target);
    if (!dropSupport.safe) return { ...dropSupport, stances: [] };
    const stances = collectionStandingPositions(bot, block);
    if (stances.length === 0) {
        return {
            safe: false,
            code: 'no_safe_stance',
            dropDepth: dropSupport.dropDepth,
            stances: [],
        };
    }
    return {
        safe: true,
        code: 'safe_stance_available',
        dropDepth: dropSupport.dropDepth,
        stances,
    };
}

export function findStableMiningCollectionCandidates(bot, predicate, range, count = MAX_COLLECTION_CANDIDATES) {
    let scanCount = Math.max(count, MAX_COLLECTION_SCAN_CANDIDATES);
    let fallback = [];
    while (true) {
        const scanned = world.getNearestBlocksWhere(bot, predicate, range, scanCount)
            .filter(block => block?.position);
        if (fallback.length === 0) fallback = scanned.slice(0, count);
        const supported = scanned
            .filter(block => collectionDropSupport(bot, block.position).safe)
            .slice(0, count);
        if (supported.length > 0) return supported;
        if (scanned.length < scanCount || scanCount >= MAX_COLLECTION_SAFE_SCAN_CANDIDATES) break;
        scanCount = Math.min(MAX_COLLECTION_SAFE_SCAN_CANDIDATES, scanCount * 4);
    }

    // Preserve truthful failure evidence when every bounded, hydrated target
    // is unsafe. Candidate assessment will attach the exact rejection code.
    return fallback;
}

function collectionApproachGoal(stances) {
    if (!Array.isArray(stances) || stances.length === 0) return null;
    return new pf.goals.GoalCompositeAny(
        stances.map(position => new pf.goals.GoalBlock(position.x, position.y, position.z)),
    );
}

function isAtCollectionStance(bot, stances) {
    return Boolean(stances?.some(position => physicallyOccupiesStandingCell(bot, position)));
}

function collectionApproachMovements(bot) {
    // Route probing and execution must answer the same question: can native
    // Pathfinder reach an already-clear mining stance without excavating?
    // When it cannot, deterministic mining binds and authorizes the exact
    // corridor. Letting A* dig here creates a second excavation planner and
    // makes a successful probe meaningless to the actual safety contract.
    return clearedMiningMovements(bot);
}

function targetScopedCollectionMovements(bot, targetBlock, {
    allowPillars = false,
    allowNaturalRouteDigging = false,
} = {}) {
    const target = {
        type: targetBlock?.type,
        x: targetBlock?.position?.x,
        y: targetBlock?.position?.y,
        z: targetBlock?.position?.z,
    };
    const safetyGuard = collectionSafetyMovements(bot);
    const movements = collectionSafetyMovements(bot);
    // collectblock mutates its Movements instance before starting. Keep the
    // authoritative safety checks on a separate instance and expose only the
    // exact selected block to pathfinder; every incidental route block stays
    // unbreakable.
    movements.safeToBreak = (candidate) => {
        const selectedTarget = (
            candidate?.type === target.type
            && candidate?.position?.x === target.x
            && candidate?.position?.y === target.y
            && candidate?.position?.z === target.z
            && safetyGuard.safeToBreak(candidate)
        );
        return selectedTarget || (
            allowNaturalRouteDigging
            && safetyGuard.defaultSafeToBreak(candidate)
            && isNaturalFillBlock(bot, candidate)
        );
    };
    // A whole-tree harvest may need one temporary pillar to reach the crown.
    // This is never enabled for generic collection or ordinary navigation.
    movements.allow1by1towers = allowPillars === true;
    return movements;
}

function sameBlockPosition(left, right) {
    return Boolean(
        left?.position
        && right?.position
        && left.position.x === right.position.x
        && left.position.y === right.position.y
        && left.position.z === right.position.z
    );
}

function collectionHazardObservation(bot, targetBlock) {
    const hazards = new Set();
    let score = 0;
    for (let x = -2; x <= 2; x++) {
        for (let y = -1; y <= 2; y++) {
            for (let z = -2; z <= 2; z++) {
                if (x === 0 && y === 0 && z === 0) continue;
                const nearby = bot.blockAt(targetBlock.position.offset(x, y, z));
                if (!isHazardousGameplayBlock(nearby)) continue;
                hazards.add(nearby.name);
                score += Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) <= 1 ? 3 : 1;
            }
        }
    }
    return {
        score,
        blocks: [...hazards].sort(),
    };
}

function collectionBreakTime(bot, block) {
    try {
        const tool = bot.pathfinder.bestHarvestTool?.(block);
        // Break-time feeds route scoring. Passing an empty enchantment list made
        // every estimate wrong for enchanted gear, so an Efficiency V pickaxe
        // was costed as if it were plain.
        const enchantments = [...itemEnchantments(bot, tool).entries()]
            .map(([name, lvl]) => ({ name, lvl }));
        const digTime = block.digTime(
            tool?.type ?? null,
            false,
            false,
            false,
            enchantments,
            bot.entity?.effects || {},
        );
        return Number.isFinite(digTime) ? digTime : 0;
    } catch {
        return 0;
    }
}

function probeCollectionRoute(bot, block, movements, targetAssessment = null) {
    const distance = bot.entity.position.distanceTo(block.position);
    const signal = actionCancellationSignal();
    const remainingMs = remainingActionTimeMs(COLLECTION_ROUTE_PROBE_TIMEOUT_MS);
    if (signal?.aborted || remainingMs <= 0) {
        return {
            routeStatus: 'action_deadline',
            routeCost: 0,
            routeLength: 0,
            routeTimeMs: 0,
        };
    }
    if (
        distance <= 4.5
        && bot.canSeeBlock?.(block)
        && (!targetAssessment || isAtCollectionStance(bot, targetAssessment.stances))
    ) {
        return {
            routeStatus: 'direct',
            routeCost: 0,
            routeLength: 0,
            routeTimeMs: 0,
        };
    }

    try {
        const goal = targetAssessment
            ? collectionApproachGoal(targetAssessment.stances)
            : new pf.goals.GoalLookAtBlock(
                block.position,
                bot.world,
                {
                    reach: 4.5,
                    entityHeight: Number(bot.entity?.eyeHeight) || 1.6,
                },
            );
        if (!goal) return {
            routeStatus: targetAssessment?.code || 'no_safe_stance',
            routeCost: 0,
            routeLength: 0,
            routeTimeMs: 0,
        };
        const generator = bot.pathfinder.getPathFromTo(
            movements,
            bot.entity.position,
            goal,
            {
                timeout: Math.max(1, remainingMs),
                tickTimeout: Math.max(1, Math.min(COLLECTION_ROUTE_PROBE_TICK_MS, remainingMs)),
                searchRadius: Math.max(8, Math.ceil(distance) + 8),
            },
        );
        let result = null;
        for (let slice = 0; slice < MAX_COLLECTION_ROUTE_SLICES; slice++) {
            if (signal?.aborted || remainingActionTimeMs() <= 0) break;
            const next = generator.next();
            result = next?.value?.result || result;
            if (next.done || result?.status !== 'partial') break;
        }
        return {
            routeStatus: result?.status || 'unknown',
            routeCost: Number.isFinite(result?.cost) ? result.cost : 0,
            routeLength: Array.isArray(result?.path) ? result.path.length : 0,
            routeTimeMs: Number.isFinite(result?.time) ? result.time : 0,
            approachPosition: Array.isArray(result?.path) && result.path.length > 0
                ? {
                    x: result.path.at(-1).x,
                    y: result.path.at(-1).y,
                    z: result.path.at(-1).z,
                }
                : null,
        };
    } catch (error) {
        return {
            routeStatus: 'probe_error',
            routeCost: 0,
            routeLength: 0,
            routeTimeMs: 0,
            routeError: String(error?.message || error).slice(0, 160),
        };
    }
}

function collectionCandidateObservations(
    bot,
    blocks,
    movements,
    descentFallback = false,
    { stableMiningStance = false } = {},
) {
    return blocks.map(block => {
        const hazard = collectionHazardObservation(bot, block);
        const targetAssessment = stableMiningStance
            ? assessStableMiningCollectionTarget(bot, block)
            : null;
        const route = targetAssessment && !targetAssessment.safe
            ? {
                routeStatus: targetAssessment.code,
                routeCost: 0,
                routeLength: 0,
                routeTimeMs: 0,
            }
            : probeCollectionRoute(
                bot,
                block,
                targetAssessment ? collectionApproachMovements(bot) : movements,
                targetAssessment,
            );
        return {
            block,
            position: block.position,
            distance: bot.entity.position.distanceTo(block.position),
            verticalDelta: Math.abs(bot.entity.position.y - block.position.y),
            hazardScore: hazard.score,
            hazards: hazard.blocks,
            breakTimeMs: collectionBreakTime(bot, block),
            descentFallback,
            dropDepth: targetAssessment?.dropDepth ?? null,
            safeStances: targetAssessment?.stances || null,
            ...route,
        };
    });
}

function selectCollectionCandidate(
    bot,
    blocks,
    routeMovements = safeMovements(bot),
    options = {},
) {
    const observations = collectionCandidateObservations(
        bot,
        blocks,
        routeMovements,
        false,
        options,
    );
    const ranked = rankCollectionCandidates(observations);
    const selected = ranked.find(candidate => candidate.reachable) || null;
    if (selected) return { selected, ranked, descentFallback: null };

    const maxDropDown = survivableDropDistance(bot);
    const currentY = Number(bot.entity?.position?.y);
    const hasLowerCandidate = Number.isFinite(currentY) && blocks.some(block => (
        Number.isFinite(block?.position?.y)
        && block.position.y < currentY - DEFAULT_MAX_DROP_DOWN
    ));
    if (maxDropDown <= DEFAULT_MAX_DROP_DOWN || !hasLowerCandidate) {
        return { selected: null, ranked, descentFallback: null };
    }

    // Do not use a damaging fall as a shortcut. It becomes eligible only
    // after every ordinary candidate route has been rejected.
    const descentRanked = rankCollectionCandidates(
        collectionCandidateObservations(
            bot,
            blocks,
            safeDescentMovements(bot),
            true,
            options,
        ),
    );
    const descentSelected = descentRanked.find(candidate => candidate.reachable) || null;
    return {
        selected: descentSelected,
        ranked: descentRanked,
        descentFallback: descentSelected ? { maxDropDown } : null,
    };
}

function collectionDecisionEvidence(selection) {
    const selected = selection?.selected;
    const routeStatuses = {};
    for (const candidate of selection?.ranked || []) {
        const status = String(candidate?.routeStatus || 'unknown').slice(0, 48);
        routeStatuses[status] = (routeStatuses[status] || 0) + 1;
    }
    return {
        considered: selection?.ranked?.length || 0,
        unreachable: selection?.ranked?.filter(candidate => !candidate.reachable).length || 0,
        routeStatuses,
        routeStatus: selected?.routeStatus || null,
        routeCost: Number.isFinite(selected?.routeCost)
            ? Math.round(selected.routeCost * 100) / 100
            : null,
        distance: Number.isFinite(selected?.distance)
            ? Math.round(selected.distance * 100) / 100
            : null,
        verticalDelta: Number.isFinite(selected?.verticalDelta)
            ? Math.round(selected.verticalDelta * 100) / 100
            : null,
        dropDepth: Number.isFinite(selected?.dropDepth) ? selected.dropDepth : null,
        stanceCount: Array.isArray(selected?.safeStances) ? selected.safeStances.length : null,
        approachPosition: selected?.approachPosition || null,
        hazards: selected?.hazards || [],
        score: Number.isFinite(selected?.score) ? selected.score : null,
        scoreBreakdown: selected?.scoreBreakdown || null,
        descentFallback: selection?.descentFallback || null,
    };
}

function collectionRejectionSummary(selection) {
    const statuses = collectionDecisionEvidence(selection).routeStatuses;
    return Object.entries(statuses)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([status, count]) => `${status}:${count}`)
        .join(', ');
}

function createCollectionSearch(bot, scanRange, options = {}) {
    const relocationEnabled = options?.relocate === true;
    const requestedRelocations = Number(options?.maxRelocations);
    const requestedStep = Number(options?.relocationDistance);
    const origin = bot.entity?.position;
    return {
        scanRange,
        relocationEnabled,
        maxRelocations: relocationEnabled
            ? Number.isFinite(requestedRelocations)
                ? Math.max(0, Math.min(MAX_COLLECTION_SEARCH_RELOCATIONS, Math.floor(requestedRelocations)))
                : MAX_COLLECTION_SEARCH_RELOCATIONS
            : 0,
        relocationDistance: Number.isFinite(requestedStep)
            ? Math.max(MIN_COLLECTION_SEARCH_STEP, Math.min(MAX_COLLECTION_SEARCH_STEP, Math.floor(requestedStep)))
            : Math.max(MIN_COLLECTION_SEARCH_STEP, Math.min(MAX_COLLECTION_SEARCH_STEP, scanRange)),
        attempts: 0,
        relocations: 0,
        distanceMoved: 0,
        candidateFailures: 0,
        accessRecoveryAttempts: 0,
        accessRecoveries: 0,
        accessRecoveryTargets: [],
        lastAccessRecoveryTarget: null,
        origin: origin
            ? { x: origin.x, y: origin.y, z: origin.z }
            : null,
        lastMovementOutcome: null,
    };
}

function collectionSearchEvidence(bot, search) {
    const position = bot.entity?.position;
    return {
        scanRange: search.scanRange,
        relocationEnabled: search.relocationEnabled,
        attempts: search.attempts,
        relocations: search.relocations,
        maxRelocations: search.maxRelocations,
        distanceMoved: Math.round(search.distanceMoved * 10) / 10,
        origin: search.origin,
        candidateFailures: search.candidateFailures || 0,
        accessRecoveryAttempts: search.accessRecoveryAttempts || 0,
        accessRecoveries: search.accessRecoveries || 0,
        lastPosition: position
            ? { x: position.x, y: position.y, z: position.z }
            : null,
        lastMovementOutcome: search.lastMovementOutcome,
    };
}

async function recoverCollectionAccess(bot, resourceName, selection, search, {
    allowNaturalRouteDigging = false,
} = {}) {
    if (bot.interrupt_code || !bot.entity?.position) return false;
    const attemptedTargets = new Set(search.accessRecoveryTargets || []);

    while (search.accessRecoveryAttempts < MAX_COLLECTION_ACCESS_RECOVERIES) {
        const candidateEntry = selection?.ranked
            ?.find(entry => {
                if (['unsafe_drop_support', 'target_unloaded'].includes(entry?.routeStatus)) {
                    return false;
                }
                if (entry?.routeStatus === 'no_safe_stance' && !allowNaturalRouteDigging) {
                    return false;
                }
                const block = entry?.block;
                const position = block?.position;
                if (
                    entry?.routeStatus === 'no_safe_stance'
                    && prospectiveMiningStandingPositions(bot, block).length === 0
                ) return false;
                return position && !attemptedTargets.has(`${position.x}:${position.y}:${position.z}`);
            });
        const candidate = candidateEntry?.block;
        if (!candidate) return false;

        const targetKey = `${candidate.position.x}:${candidate.position.y}:${candidate.position.z}`;
        attemptedTargets.add(targetKey);
        search.accessRecoveryTargets = [...attemptedTargets];
        search.lastAccessRecoveryTarget = {
            name: candidate.name,
            x: candidate.position.x,
            y: candidate.position.y,
            z: candidate.position.z,
        };
        search.accessRecoveryAttempts += 1;
        const start = bot.entity.position.clone();
        const startDistance = start.distanceTo(candidate.position);

        // Buried registry targets have no pre-existing standing cell by
        // definition. Reuse the bounded supported mining route to create one;
        // ordinary resources still use the non-digging local recovery below.
        const requiresDeterministicMiningAccess = allowNaturalRouteDigging && (
            candidateEntry.routeStatus === 'no_safe_stance'
            || candidateEntry.reachable === false
        );
        if (requiresDeterministicMiningAccess) {
            const opened = await mineSearchTunnel(
                bot,
                candidate.name,
                MINING_TUNNEL_LENGTH,
                candidate,
            );
            const end = bot.entity?.position;
            const moved = end?.distanceTo(start) || 0;
            search.distanceMoved += moved;
            search.lastMovementOutcome = bot.lastActionEvidence?.outcome || (opened ? 'mining_route_opened' : 'mining_route_blocked');
            // Preserve a causal prerequisite blocker discovered inside the
            // mining route. Replacing it with generic "unreachable" makes the
            // goal walk away instead of planning a usable replacement tool.
            if (!opened && bot.lastActionEvidence?.outcome === 'missing_tool') return false;
            // One bounded tunnel owns one concrete target. Return its failure
            // so GoalDirector can exclude that coordinate before trying a
            // different vein instead of spending this action on another long
            // tunnel whose identity would overwrite the first.
            if (!opened || bot.interrupt_code) return false;
            search.accessRecoveries += 1;
            return true;
        }

        const origin = start.floored();
        const local = localNavigationRecoveryMovements(bot, origin);
        // Access recovery may clear nearby leaves, but it must not turn a
        // harvest request into a damaging plunge toward an unreachable block.
        local.movements.maxDropDown = Math.min(
            Number(local.movements.maxDropDown) || DEFAULT_MAX_DROP_DOWN,
            DEFAULT_MAX_DROP_DOWN,
        );
        const goal = collectionApproachGoal(candidateEntry.safeStances)
            || new pf.goals.GoalLookAtBlock(candidate.position, bot.world, {
                reach: 4.5,
                entityHeight: Number(bot.entity?.eyeHeight) || 1.6,
            });
        let outcome;
        try {
            outcome = await runNavigationAttempt(
                bot,
                goal,
                local.movements,
                NAVIGATION_RECOVERY_STALL_TIMEOUT_MS,
            );
        } finally {
            bot.pathfinder.setMovements(safeMovements(bot));
        }
        const end = bot.entity?.position;
        const moved = end?.distanceTo(start) || 0;
        const targetProgress = end ? startDistance - end.distanceTo(candidate.position) : 0;
        const reached = outcome?.state === 'resolved'
            && Boolean(goal.isEnd?.(end?.floored?.()));
        const recovered = !bot.interrupt_code
            && (reached || targetProgress >= COLLECTION_ACCESS_PROGRESS_DISTANCE);
        search.lastMovementOutcome = navigationOutcomeName(outcome, bot);
        search.distanceMoved += moved;
        if (!recovered) continue;

        search.accessRecoveries += 1;
        log(
            bot,
            `Made ${targetProgress.toFixed(1)} blocks of verified progress toward ${resourceName} `
            + `(${search.accessRecoveryAttempts}/${MAX_COLLECTION_ACCESS_RECOVERIES}); rescanning.`,
        );
        return true;
    }
    return false;
}

async function relocateCollectionSearch(bot, resourceName, search) {
    if (
        bot.interrupt_code
        || !search.relocationEnabled
        || search.attempts >= search.maxRelocations
        || !bot.entity?.position
    ) return false;

    search.attempts += 1;
    const before = bot.entity.position.clone();
    log(
        bot,
        `No safe reachable ${resourceName} found within ${search.scanRange} blocks here. `
        + `Searching a new area (${search.attempts}/${search.maxRelocations}).`,
    );
    const distances = [];
    for (
        let distance = search.relocationDistance;
        distance >= MIN_COLLECTION_RESCAN_PROGRESS;
        distance = Math.floor(distance / 2)
    ) {
        distances.push(distance);
        if (distance === MIN_COLLECTION_RESCAN_PROGRESS) break;
        if (Math.floor(distance / 2) < MIN_COLLECTION_RESCAN_PROGRESS) {
            distances.push(MIN_COLLECTION_RESCAN_PROGRESS);
            break;
        }
    }

    for (const distance of [...new Set(distances)]) {
        const legStart = bot.entity.position.clone();
        const relocated = await moveAway(bot, distance);
        const movementEvidence = bot.lastActionEvidence;
        search.lastMovementOutcome = movementEvidence?.outcome || (relocated ? 'moved' : 'blocked');
        if (bot.interrupt_code) return false;

        if (relocated && movementEvidence?.completion === 'requested') {
            await waitForWorldCondition(
                bot,
                () => bot.entity?.position?.distanceTo(legStart) >= distance - 0.5,
                2_500,
                50,
            );
        }
        const legMoved = bot.entity?.position?.distanceTo(legStart) || 0;
        const moved = bot.entity?.position?.distanceTo(before) || 0;
        const legVerified = !relocated || legMoved + 0.5 >= distance;
        if (moved + 0.5 >= MIN_COLLECTION_RESCAN_PROGRESS && legVerified) {
            search.relocations += 1;
            search.distanceMoved += moved;
            log(
                bot,
                `${relocated ? 'Reached' : 'Made verified progress toward'} a new search area after ${moved.toFixed(1)} blocks; `
                + `rescanning for ${resourceName}.`,
            );
            return true;
        }
        if (distance > MIN_COLLECTION_RESCAN_PROGRESS) {
            log(bot, `The ${distance}-block search route was blocked; trying a shorter safe leg.`);
        }
    }

    const moved = bot.entity?.position?.distanceTo(before) || 0;
    search.lastMovementOutcome = 'relocation_unverified';
    log(bot, `The resource-search relocation made only ${moved.toFixed(1)} blocks of verified progress.`);
    return false;
}

export function log(bot, message) {
    const next = `${String(bot?.output || '')}${String(message || '')}\n`;
    bot.output = next.length <= MAX_BOT_OUTPUT_CHARS
        ? next
        : `[action output capped]\n${next.slice(-(MAX_BOT_OUTPUT_CHARS - 22))}`;
}

async function autoLight(bot) {
    if (world.shouldPlaceTorch(bot)) {
        try {
            const pos = world.getPosition(bot);
            return await placeBlock(bot, 'torch', pos.x, pos.y, pos.z, 'bottom', true);
        } catch (err) {return false;}
    }
    return false;
}

async function equipHighestAttack(bot) {
    let weapons = bot.inventory.items().filter(item => (
        (item.name.includes('sword') || (item.name.includes('axe') && !item.name.includes('pickaxe')))
        && toolDurability(bot, item).healthy
    ));
    if (weapons.length === 0)
        weapons = bot.inventory.items().filter(item => (
            (item.name.includes('pickaxe') || item.name.includes('shovel'))
            && toolDurability(bot, item).healthy
        ));
    if (weapons.length === 0)
        return;
    weapons.sort((a, b) => (
        (Number(b.attackDamage) || 0) - (Number(a.attackDamage) || 0)
        || toolDurability(bot, b).remaining - toolDurability(bot, a).remaining
    ));
    let weapon = weapons[0];
    if (weapon)
        await bot.equip(weapon, 'hand');
}

export async function craftRecipe(bot, itemName, num=1) {
    /**
     * Attempt to craft the given item name from a recipe. May craft many items.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item name to craft.
     * @returns {Promise<boolean>} true if the recipe was crafted, false otherwise.
     * @example
     * await skills.craftRecipe(bot, "stick");
     **/
    itemName = String(itemName || '').trim();
    const target = { name: itemName || 'item' };
    const requestedCrafts = Math.floor(Number(num));
    let temporaryTable = null;
    let finalEvidence = null;
    const finish = (success, evidence, message) => {
        finalEvidence = evidence;
        setActionEvidence(bot, evidence);
        if (message) log(bot, message);
        return success;
    };

    try {
        if (!itemName || !Number.isFinite(requestedCrafts) || requestedCrafts < 1) {
            return finish(false, { kind: 'craft', outcome: 'invalid_request', target, retryable: false }, 'Crafting needs an item and a positive recipe count.');
        }
        const recipeDocs = mc.getItemCraftingRecipes(itemName) || [];
        if (!recipeDocs.length) {
            return finish(false, { kind: 'craft', outcome: 'invalid_recipe', target, retryable: false }, `${itemName} is either not an item, or it does not have a crafting recipe.`);
        }

        const itemId = mc.getItemId(itemName);
        if (!Number.isInteger(itemId)) {
            return finish(false, { kind: 'craft', outcome: 'invalid_recipe', target, retryable: false }, `${itemName} is not a craftable Minecraft item.`);
        }
        let recipes = bot.recipesFor(itemId, null, 1, null);
        let craftingTable = null;
        const craftingTableRange = 64;

        if (!recipes?.length) {
            recipes = bot.recipesFor(itemId, null, 1, true);
            if (!recipes?.length) {
                const ingredients = Object.entries(recipeDocs[0]?.[0] || {}).map(([key, value]) => `${key}: ${value}`).join(', ');
                return finish(false, { kind: 'craft', outcome: 'missing_material', target, retryable: true }, `You do not have the resources to craft ${itemName}${ingredients ? `. It requires: ${ingredients}.` : '.'}`);
            }

            craftingTable = world.getNearestBlock(bot, 'crafting_table', craftingTableRange);
            let worldTableRouteFailed = false;
            // A carried table is a deterministic local capability. Do not
            // tunnel toward a merely loaded remote workstation before using
            // the one already owned by this action.
            if (
                craftingTable
                && !directlyUsableWorkstation(bot, craftingTable)
                && inventoryCount(bot, 'crafting_table') > 0
            ) craftingTable = null;
            if (craftingTable && bot.entity.position.distanceTo(craftingTable.position) > 4) {
                const reached = await goToPosition(bot, craftingTable.position.x, craftingTable.position.y, craftingTable.position.z, 4);
                if (!reached || bot.entity.position.distanceTo(craftingTable.position) > 4.5) {
                    if (bot.interrupt_code) {
                        return finish(false, { kind: 'craft', outcome: 'interrupted', target, retryable: false }, 'Crafting was interrupted while approaching the crafting table.');
                    }
                    let access = await reachKnownBlockByVoxelCorridor(
                        bot,
                        craftingTable,
                        craftingTableRange,
                    );
                    if (
                        !access.success
                        && access.outcome === 'insufficient_tool_durability'
                        && access.replacementTool === itemName
                        && TOOL_PREPARATION_SPECS[itemName]
                    ) {
                        log(
                            bot,
                            `Using the protected ${itemName} reserve only to reach the workstation that replaces it.`,
                        );
                        access = await reachKnownBlockByVoxelCorridor(
                            bot,
                            craftingTable,
                            craftingTableRange,
                            { allowReplacementBootstrapReserve: true },
                        );
                    }
                    if (!access.success || bot.entity.position.distanceTo(craftingTable.position) > 4.5) {
                        log(bot, `Exact crafting-table approach stopped: ${String(access.outcome).replace(/_/g, ' ')}.`);
                        worldTableRouteFailed = true;
                        craftingTable = null;
                    } else {
                        craftingTable = bot.blockAt(craftingTable.position);
                    }
                }
            }
            if (!craftingTable) {
                const localTable = await placeLocalCraftingTable(bot);
                if (!localTable.ok) {
                    const outcome = localTable.outcome === 'missing_crafting_table'
                        ? worldTableRouteFailed
                            ? 'table_unreachable'
                            : 'missing_crafting_table'
                        : localTable.outcome;
                    const message = outcome === 'table_unreachable'
                        ? `Could not reach a world crafting table, and ${itemName} requires a carried table for a local fallback.`
                        : outcome === 'missing_crafting_table'
                            ? `Crafting ${itemName} requires a crafting table.`
                            : `Could not prepare a local crafting table (${localTable.outcome}).`;
                    return finish(false, {
                        kind: 'craft',
                        outcome,
                        target,
                        fallback: localTable.outcome,
                        ...(outcome === 'table_unreachable'
                            ? {
                                workstationRequirement: {
                                    name: 'crafting_table',
                                    carried: true,
                                },
                            }
                            : {}),
                        retryable: true,
                    }, message);
                }
                temporaryTable = localTable;
                craftingTable = localTable.block;
            }
            recipes = bot.recipesFor(itemId, null, 1, craftingTable);
        }

        if (!recipes?.length) {
            return finish(false, { kind: 'craft', outcome: 'recipe_unavailable', target, retryable: true }, `No usable recipe for ${itemName} is available here.`);
        }

        const recipe = recipes[0];
        const inventory = world.getInventoryCounts(bot);
        const requiredIngredients = mc.ingredientsFromPrismarineRecipe(recipe);
        const craftLimit = mc.calculateLimitingResource(inventory, requiredIngredients);
        const craftAttempts = Math.min(Math.max(0, Math.floor(Number(craftLimit?.num) || 0)), requestedCrafts);
        if (craftAttempts < 1) {
            return finish(false, { kind: 'craft', outcome: 'missing_material', target, retryable: true }, `You do not have enough materials to craft ${itemName}.`);
        }

        const beforeCount = inventoryCount(bot, itemName);
        try {
            await bot.craft(recipe, craftAttempts, craftingTable);
        } catch (error) {
            return finish(false, { kind: 'craft', outcome: 'craft_blocked', target, error: error.message, retryable: true }, `Could not craft ${itemName}: ${error.message}.`);
        }
        const afterCount = inventoryCount(bot, itemName);
        const outputCount = afterCount - beforeCount;
        if (outputCount < 1) {
            return finish(false, { kind: 'craft', outcome: 'not_crafted', target, beforeCount, afterCount, retryable: true }, `Minecraft did not confirm a new ${itemName} in inventory after crafting.`);
        }

        try {
            await bot.armorManager?.equipAll?.();
        } catch (error) {
            console.warn(`[craft] Armor auto-equip failed after crafting ${itemName}: ${String(error?.message || error).slice(0, 240)}`);
        }
        return finish(true, {
            kind: 'craft',
            outcome: 'crafted',
            target,
            requestedCrafts,
            craftAttempts,
            outputCount,
            retryable: false,
        }, `Crafted ${outputCount} ${itemName}.`);
    } finally {
        if (temporaryTable) {
            let cleanup;
            const target = {
                name: 'crafting_table',
                x: temporaryTable.position.x,
                y: temporaryTable.position.y,
                z: temporaryTable.position.z,
            };
            if (bot.blockAt(temporaryTable.position)?.name === 'crafting_table') {
                cleanup = {
                    outcome: 'retained_as_workstation',
                    target,
                    retryable: false,
                };
                log(bot, `Retained crafting_table at (${target.x}, ${target.y}, ${target.z}) for later crafting steps.`);
            } else {
                try {
                    cleanup = await recoverLocalCraftingTable(bot, temporaryTable);
                } catch (error) {
                    cleanup = {
                        outcome: 'table_cleanup_failed',
                        target,
                        error: String(error?.message || error).slice(0, 240),
                        retryable: true,
                    };
                }
            }
            if (
                cleanup.outcome !== 'retained_as_workstation'
                && cleanup.outcome !== 'recovered'
                && cleanup.outcome !== 'already_recovered'
            ) {
                console.warn(`[craft] Temporary crafting table cleanup ended as ${cleanup.outcome}.`);
            }
            if (finalEvidence) setActionEvidence(bot, { ...finalEvidence, cleanup });
            else setActionEvidence(bot, { kind: 'craft', outcome: 'cleanup_only', cleanup, retryable: cleanup.retryable });
        }
    }
}

function toolDurability(bot, item) {
    const max = Number(
        item?.maxDurability
        ?? bot.registry?.items?.[item?.type]?.maxDurability
        ?? bot.registry?.itemsByName?.[item?.name]?.maxDurability,
    );
    if (!Number.isFinite(max) || max <= 0) {
        return {
            max: Infinity,
            used: 0,
            remaining: Infinity,
            reserve: 0,
            usable: Infinity,
            healthy: true,
        };
    }
    const used = Math.max(0, Number(item?.durabilityUsed) || 0);
    const remaining = Math.max(0, max - used);
    const reserve = Math.max(16, Math.ceil(max * 0.1));
    return {
        max,
        used,
        remaining,
        reserve,
        usable: Math.max(0, remaining - reserve),
        healthy: remaining > reserve,
    };
}

// Blocks whose drop multiplies under Fortune. Silk Touch is preferred only when
// the block itself is wanted, which is why it is requested explicitly rather
// than scored as a general bonus.
const FORTUNE_DROP_PATTERN = /(?:coal_ore|diamond_ore|emerald_ore|lapis_ore|redstone_ore|nether_gold_ore|nether_quartz_ore|copper_ore|amethyst_cluster|glowstone|melon|sweet_berry_bush)$/;
const ENCHANT_NAME = /(?:^|:)([a-z_]+)$/;

/**
 * Enchantment levels keyed by canonical name. Reads mineflayer's parsed
 * `enchants` first and falls back to raw NBT, because the shape differs across
 * protocol versions. Never throws: an unreadable item simply has none.
 */
function itemEnchantments(bot, item) {
    const levels = new Map();
    if (!item) return levels;
    const record = (rawName, rawLevel) => {
        const name = String(rawName ?? '').toLowerCase().match(ENCHANT_NAME)?.[1];
        const level = Math.floor(Number(rawLevel));
        if (name && Number.isFinite(level) && level > 0) {
            levels.set(name, Math.max(levels.get(name) || 0, level));
        }
    };
    try {
        // prismarine-item throws outright on protocol versions it cannot parse,
        // so the raw-NBT fallback below must stay reachable.
        if (Array.isArray(item.enchants)) {
            for (const entry of item.enchants) record(entry?.name, entry?.lvl);
        }
    } catch {
        // Fall through to the raw NBT read.
    }
    if (levels.size > 0) return levels;
    try {
        const raw = item.nbt?.value?.ench || item.nbt?.value?.StoredEnchantments;
        for (const entry of raw?.value?.value || []) {
            const id = entry?.id?.value;
            const name = typeof id === 'number'
                ? bot?.registry?.enchantments?.[id]?.name
                : id;
            record(name, entry?.lvl?.value);
        }
    } catch {
        // A malformed or unfamiliar NBT layout is simply "no enchantments".
    }
    return levels;
}

function toolEnchantmentScore(bot, item, block) {
    const levels = itemEnchantments(bot, item);
    if (levels.size === 0) return 0;
    let score = 0;
    // Efficiency is always worth something; it is the difference between a
    // player who finishes a vein and one who is still swinging.
    score += Math.min(5, levels.get('efficiency') || 0) * 2;
    score += Math.min(3, levels.get('unbreaking') || 0);
    if (FORTUNE_DROP_PATTERN.test(String(block?.name || ''))) {
        score += Math.min(3, levels.get('fortune') || 0) * 12;
        // Silk Touch on a Fortune-eligible ore actively destroys yield.
        if (levels.has('silk_touch')) score -= 10;
    }
    return score;
}

function bestInventoryTool(bot, family, { allowWorn=false, block=null } = {}) {
    return bot.inventory.items()
        .filter(item => (
            item.name.endsWith(`_${family}`)
            && (allowWorn || toolDurability(bot, item).healthy)
        ))
        .sort((left, right) => {
            const leftTier = TOOL_TIER[left.name.split('_')[0]] || 0;
            const rightTier = TOOL_TIER[right.name.split('_')[0]] || 0;
            if (rightTier !== leftTier) return rightTier - leftTier;
            // Within a tier, enchantments decide before durability: a Fortune
            // pickaxe is worth more than a slightly fresher plain one.
            const enchantDelta = toolEnchantmentScore(bot, right, block) - toolEnchantmentScore(bot, left, block);
            if (enchantDelta !== 0) return enchantDelta;
            const leftDurability = toolDurability(bot, left);
            const rightDurability = toolDurability(bot, right);
            const leftRatio = leftDurability.remaining / leftDurability.max;
            const rightRatio = rightDurability.remaining / rightDurability.max;
            return rightRatio - leftRatio || rightDurability.remaining - leftDurability.remaining;
        })[0] || null;
}

function inventoryToolTier(bot, family) {
    const tool = bestInventoryTool(bot, family);
    return tool ? TOOL_TIER[tool.name.split('_')[0]] || 0 : 0;
}

function toolFamilyForBlock(block) {
    const recommended = mc.getBlockTool(block?.name);
    const recommendedFamily = recommended?.match(/_(pickaxe|axe|shovel|hoe)$/)?.[1];
    if (recommendedFamily) return recommendedFamily;
    const name = String(block?.name || '');
    if (/(?:_log|_wood|_stem|_hyphae|_planks)$/.test(name) || /(?:bookshelf|pumpkin|melon)$/.test(name)) {
        return 'axe';
    }
    if (/(?:dirt|grass_block|sand|gravel|clay|snow|soul_sand|soul_soil|mud)$/.test(name)) {
        return 'shovel';
    }
    if (
        /(?:ore|stone|deepslate|cobblestone|netherrack|blackstone|basalt|obsidian|terracotta|brick|concrete)$/.test(name)
    ) return 'pickaxe';
    return null;
}

async function equipBestToolForBlock(bot, block) {
    const family = toolFamilyForBlock(block);
    const preferred = family
        ? bestInventoryTool(bot, family, { block })
        : null;
    if (preferred && block.canHarvest(preferred.type)) {
        await bot.equip(preferred, 'hand');
        return preferred;
    }
    await bot.tool.equipForBlock(block);
    if (family && bot.heldItem?.name?.endsWith(`_${family}`)) {
        const heldDurability = toolDurability(bot, bot.heldItem);
        const durableAlternative = bestInventoryTool(bot, family, { block });
        if (!heldDurability.healthy && durableAlternative && block.canHarvest(durableAlternative.type)) {
            await bot.equip(durableAlternative, 'hand');
            return durableAlternative;
        }
    }
    return bot.heldItem || null;
}

function plankInventoryCount(bot) {
    return bot.inventory.items().reduce(
        (total, item) => total + (item.name.endsWith('_planks') ? item.count : 0),
        0,
    );
}

function materialInventoryCount(bot, material) {
    if (material === 'planks') return plankInventoryCount(bot);
    return inventoryCount(bot, material);
}

export async function prepareTool(bot, toolName) {
    const normalizedTool = String(toolName || '').trim();
    const spec = TOOL_PREPARATION_SPECS[normalizedTool];
    const target = { name: normalizedTool || 'tool' };
    if (!spec) {
        setActionEvidence(bot, {
            kind: 'tool_prepare',
            outcome: 'unsupported_tool',
            target,
            retryable: false,
        });
        log(bot, `Automatic survival preparation does not support ${normalizedTool || 'that tool'}.`);
        return false;
    }

    const interrupt = () => {
        if (!bot.interrupt_code) return false;
        setActionEvidence(bot, {
            kind: 'tool_prepare',
            outcome: 'interrupted',
            target,
            retryable: false,
        });
        log(bot, `Stopped preparing ${normalizedTool}.`);
        return true;
    };
    const equipPreparedTool = async () => {
        const tool = bestInventoryTool(bot, spec.family);
        const tier = tool ? TOOL_TIER[tool.name.split('_')[0]] || 0 : 0;
        if (!tool || tier < spec.tier) {
            setActionEvidence(bot, {
                kind: 'tool_prepare',
                outcome: 'tool_missing_after_craft',
                target,
                retryable: true,
            });
            log(bot, `Minecraft did not expose the required ${spec.family} tier after preparation.`);
            return false;
        }
        try {
            await bot.equip(tool, 'hand');
        } catch (error) {
            setActionEvidence(bot, {
                kind: 'tool_prepare',
                outcome: 'equip_blocked',
                target: { name: tool.name },
                error: String(error?.message || error).slice(0, 240),
                retryable: true,
            });
            log(bot, `Could not equip ${tool.name}: ${error?.message || error}.`);
            return false;
        }
        if (bot.heldItem?.name !== tool.name) {
            setActionEvidence(bot, {
                kind: 'tool_prepare',
                outcome: 'equip_unverified',
                target: { name: tool.name },
                observed: bot.heldItem?.name || null,
                retryable: true,
            });
            log(bot, `Minecraft did not confirm ${tool.name} in hand.`);
            return false;
        }
        setActionEvidence(bot, {
            kind: 'tool_prepare',
            outcome: 'prepared',
            target: { name: tool.name },
            requested: normalizedTool,
            tier,
            retryable: false,
        });
        log(bot, `Prepared and equipped ${tool.name}.`);
        return true;
    };

    if (inventoryToolTier(bot, spec.family) >= spec.tier) return await equipPreparedTool();

    const ensurePlanks = async (minimum) => {
        const boundedMinimum = Math.max(1, Math.min(16, Math.floor(Number(minimum) || 1)));
        for (let attempt = 0; attempt < 6 && plankInventoryCount(bot) < boundedMinimum; attempt += 1) {
            if (interrupt()) return false;
            const convertible = bot.inventory.items().find(item => WOOD_TO_PLANKS[item.name]);
            if (!convertible) {
                const deficit = boundedMinimum - plankInventoryCount(bot);
                if (!await collectWood(bot, Math.max(1, Math.ceil(deficit / 4)))) return false;
                continue;
            }
            const plankName = WOOD_TO_PLANKS[convertible.name];
            const before = plankInventoryCount(bot);
            const crafts = Math.max(1, Math.ceil((boundedMinimum - before) / 4));
            if (!await craftRecipe(bot, plankName, crafts)) return false;
            if (plankInventoryCount(bot) <= before) {
                setActionEvidence(bot, {
                    kind: 'tool_prepare',
                    outcome: 'plank_conversion_stalled',
                    target: { name: plankName },
                    retryable: true,
                });
                log(bot, 'Plank conversion made no inventory progress.');
                return false;
            }
        }
        if (plankInventoryCount(bot) >= boundedMinimum) return true;
        setActionEvidence(bot, {
            kind: 'tool_prepare',
            outcome: 'plank_budget_exhausted',
            target,
            required: boundedMinimum,
            available: plankInventoryCount(bot),
            retryable: true,
        });
        log(bot, `Could not prepare ${boundedMinimum} planks within the bounded work budget.`);
        return false;
    };

    const ensureCraftingKit = async () => {
        if (inventoryCount(bot, 'stick') < 2) {
            if (!await ensurePlanks(2) || interrupt()) return false;
            if (!await craftRecipe(bot, 'stick', 1) || interrupt()) return false;
        }
        // A nearby table may be unreachable. Carry one so every upgrade can
        // use craftRecipe's verified local placement and recovery fallback.
        if (inventoryCount(bot, 'crafting_table') < 1) {
            if (!await ensurePlanks(4) || interrupt()) return false;
            if (!await craftRecipe(bot, 'crafting_table', 1) || interrupt()) return false;
        }
        return true;
    };

    const ensurePickaxeTier = async (minimumTier) => {
        if (inventoryToolTier(bot, 'pickaxe') >= minimumTier) return true;
        const prerequisite = minimumTier >= 4
            ? 'iron_pickaxe'
            : minimumTier >= 3
                ? 'stone_pickaxe'
                : 'wooden_pickaxe';
        return await prepareTool(bot, prerequisite);
    };

    const ensureCobblestone = async (minimum) => {
        if (inventoryCount(bot, 'cobblestone') >= minimum) return true;
        if (!await ensurePickaxeTier(1) || interrupt()) return false;

        const collectMissing = async () => {
            const missing = minimum - inventoryCount(bot, 'cobblestone');
            if (missing <= 0) return true;
            await collectBlock(bot, 'cobblestone', missing);
            return inventoryCount(bot, 'cobblestone') >= minimum;
        };

        if (await collectMissing()) return true;
        if (interrupt()) return false;

        // A buried stone face can be known but have no pre-existing standing
        // cell. Open a bounded, supported route to it, then rescan from the
        // new position instead of repeating the same impossible collection.
        // Budget one route per missing block: a safe route may expose exactly
        // one collectible face, while the progress guard still stops dead ends.
        const routeBudget = Math.max(
            1,
            Math.min(8, minimum - inventoryCount(bot, 'cobblestone')),
        );
        for (let attempt = 0; attempt < routeBudget; attempt += 1) {
            const beforeCount = inventoryCount(bot, 'cobblestone');
            const beforePosition = bot.entity?.position?.clone?.() || null;
            log(bot, `No stable stone face is reachable; opening a bounded mining route (attempt ${attempt + 1}/${routeBudget}).`);

            const advanced = await mineSearchTunnel(bot, 'cobblestone', MINING_TUNNEL_LENGTH);
            if (interrupt()) return false;
            if (inventoryCount(bot, 'cobblestone') >= minimum) return true;
            if (await collectMissing()) return true;
            if (interrupt()) return false;

            const gained = inventoryCount(bot, 'cobblestone') > beforeCount;
            const moved = beforePosition && bot.entity?.position
                ? bot.entity.position.distanceTo(beforePosition) >= NAVIGATION_PROGRESS_DISTANCE
                : false;
            if (!advanced && !gained && !moved) break;
        }
        const available = inventoryCount(bot, 'cobblestone');
        setActionEvidence(bot, {
            kind: 'tool_prepare',
            outcome: 'cobblestone_route_exhausted',
            target,
            required: minimum,
            available,
            retryable: true,
        });
        log(
            bot,
            `Could only verify ${available}/${minimum} cobblestone after bounded safe-route recovery.`,
        );
        return false;
    };

    const nearestResource = (names) => {
        try {
            return world.getNearestBlocks(bot, names, 64, 1)[0]?.name || names[0];
        } catch {
            return names[0];
        }
    };

    const ensureFuel = async () => {
        if (mc.getSmeltingFuel(bot)) return true;
        if (!await collectWood(bot, 2) || interrupt()) return false;
        return Boolean(mc.getSmeltingFuel(bot));
    };

    const ensureFurnace = async () => {
        if (inventoryCount(bot, 'furnace') > 0 || world.getNearestBlock(bot, 'furnace', 16)) return true;
        if (!await ensureCobblestone(8) || interrupt()) return false;
        if (!await ensureCraftingKit() || interrupt()) return false;
        if (!await craftRecipe(bot, 'furnace', 1) || interrupt()) return false;
        return inventoryCount(bot, 'furnace') > 0 || Boolean(world.getNearestBlock(bot, 'furnace', 16));
    };

    const ensureIron = async (minimum) => {
        if (inventoryCount(bot, 'iron_ingot') >= minimum) return true;
        if (!await ensurePickaxeTier(3) || interrupt()) return false;
        const ingotDeficit = minimum - inventoryCount(bot, 'iron_ingot');
        if (inventoryCount(bot, 'raw_iron') < ingotDeficit) {
            const ore = nearestResource(['iron_ore', 'deepslate_iron_ore']);
            const rawDeficit = ingotDeficit - inventoryCount(bot, 'raw_iron');
            if (!await collectBlock(bot, ore, rawDeficit) || interrupt()) return false;
        }
        if (inventoryCount(bot, 'raw_iron') < ingotDeficit) {
            setActionEvidence(bot, {
                kind: 'tool_prepare',
                outcome: 'iron_ore_exhausted',
                target,
                required: ingotDeficit,
                available: inventoryCount(bot, 'raw_iron'),
                retryable: true,
            });
            return false;
        }
        if (!await ensureFurnace() || !await ensureFuel() || interrupt()) return false;
        if (!await smeltItem(bot, 'raw_iron', ingotDeficit) || interrupt()) return false;
        return inventoryCount(bot, 'iron_ingot') >= minimum;
    };

    const ensureDiamonds = async (minimum) => {
        if (inventoryCount(bot, 'diamond') >= minimum) return true;
        if (!await ensurePickaxeTier(4) || interrupt()) return false;
        const ore = nearestResource(['diamond_ore', 'deepslate_diamond_ore']);
        const missing = minimum - inventoryCount(bot, 'diamond');
        if (!await collectBlock(bot, ore, missing) || interrupt()) return false;
        return inventoryCount(bot, 'diamond') >= minimum;
    };

    if (!await ensureCraftingKit() || interrupt()) return false;
    const materialReady = spec.material === 'planks'
        ? await ensurePlanks(spec.materialCount)
        : spec.material === 'cobblestone'
            ? await ensureCobblestone(spec.materialCount)
            : spec.material === 'iron_ingot'
                ? await ensureIron(spec.materialCount)
                : spec.material === 'diamond'
                    ? await ensureDiamonds(spec.materialCount)
                    : false;
    if (!materialReady || interrupt()) return false;
    // Prerequisite pickaxes consume sticks while gathering higher-tier
    // materials, so re-establish the final tool's crafting kit afterward.
    if (!await ensureCraftingKit() || interrupt()) return false;
    if (!await craftRecipe(bot, normalizedTool, 1) || interrupt()) return false;
    return await equipPreparedTool();
}

export async function prepareMaterial(bot, materialName, num=1, range=64) {
    const material = String(materialName || '').trim();
    const amount = Math.max(1, Math.min(2304, Math.floor(Number(num) || 1)));
    const searchRange = Math.max(16, Math.min(512, Math.floor(Number(range) || 64)));
    const target = { name: material || 'material' };
    const before = materialInventoryCount(bot, material);
    const desired = before + amount;
    const interrupted = () => {
        if (!bot.interrupt_code) return false;
        setActionEvidence(bot, {
            kind: 'material_prepare',
            outcome: 'interrupted',
            target,
            requested: amount,
            retryable: false,
        });
        log(bot, `Stopped preparing ${material || 'material'}.`);
        return true;
    };
    const finish = (success, outcome, detail = {}) => {
        const after = materialInventoryCount(bot, material);
        setActionEvidence(bot, {
            kind: 'material_prepare',
            outcome,
            target,
            requested: amount,
            before,
            after,
            prepared: Math.max(0, after - before),
            retryable: !success,
            ...detail,
        });
        if (success) log(bot, `Prepared ${Math.max(0, after - before)} ${material}.`);
        return success;
    };

    if (!material) return finish(false, 'invalid_material', { retryable: false });

    const preparePlanks = async (plankName, neededTotal) => {
        const exact = plankName !== 'planks';
        const matchingLog = exact
            ? Object.entries(WOOD_TO_PLANKS).find(([, planks]) => planks === plankName)?.[0]
            : null;
        if (exact && !matchingLog) return false;
        for (let attempt = 0; attempt < 8 && materialInventoryCount(bot, plankName) < neededTotal; attempt += 1) {
            if (interrupted()) return false;
            let logItem = exact
                ? bot.inventory.items().find(item => item.name === matchingLog)
                : bot.inventory.items().find(item => WOOD_TO_PLANKS[item.name]);
            if (!logItem) {
                const remaining = neededTotal - materialInventoryCount(bot, plankName);
                const logsNeeded = Math.max(1, Math.ceil(remaining / 4));
                const gathered = exact
                    ? await collectBlock(bot, matchingLog, logsNeeded, null, searchRange)
                    : await collectWood(bot, Math.min(64, logsNeeded), searchRange);
                if (!gathered || interrupted()) return false;
                logItem = exact
                    ? bot.inventory.items().find(item => item.name === matchingLog)
                    : bot.inventory.items().find(item => WOOD_TO_PLANKS[item.name]);
            }
            if (!logItem) return false;
            const output = WOOD_TO_PLANKS[logItem.name];
            const remaining = neededTotal - materialInventoryCount(bot, plankName);
            if (!await craftRecipe(bot, output, Math.max(1, Math.ceil(remaining / 4)))) return false;
        }
        return materialInventoryCount(bot, plankName) >= neededTotal;
    };

    let success = false;
    if (material === 'planks' || material.endsWith('_planks')) {
        success = await preparePlanks(material, desired);
    } else if (material === 'cobblestone') {
        success = await prepareTool(bot, 'stone_pickaxe')
            && !interrupted()
            && (
                materialInventoryCount(bot, material) >= desired
                || await collectBlock(
                    bot,
                    'cobblestone',
                    desired - materialInventoryCount(bot, material),
                    null,
                    searchRange,
                )
            );
    } else if (material === 'dirt') {
        success = await collectBlock(bot, 'dirt', amount, null, searchRange);
    } else if (material === 'torch') {
        if (inventoryCount(bot, 'stick') < 1) {
            if (plankInventoryCount(bot) < 2 && !await preparePlanks('planks', 2)) {
                return finish(false, 'stick_material_unavailable');
            }
            if (!await craftRecipe(bot, 'stick', 1) || interrupted()) {
                return finish(false, 'stick_craft_failed');
            }
        }
        if (inventoryCount(bot, 'coal') < 1) {
            if (!await prepareTool(bot, 'wooden_pickaxe') || interrupted()) {
                return finish(false, 'coal_tool_unavailable');
            }
            if (!await collectBlock(bot, 'coal_ore', Math.max(1, Math.ceil(amount / 4)), null, searchRange)) {
                return finish(false, 'coal_unavailable');
            }
        }
        const remaining = desired - inventoryCount(bot, 'torch');
        success = remaining <= 0 || await craftRecipe(bot, 'torch', Math.max(1, Math.ceil(remaining / 4)));
    } else {
        return finish(false, 'unsupported_material', {
            retryable: false,
            detail: 'Automatic material sourcing supports planks, cobblestone, dirt, and torches.',
        });
    }

    if (interrupted()) return false;
    return finish(success && materialInventoryCount(bot, material) >= desired, success ? 'prepared' : 'preparation_failed');
}

export async function prepareFood(bot, targetFoodPoints=24, range=64) {
    const targetPoints = Math.max(6, Math.min(160, Math.floor(Number(targetFoodPoints) || 24)));
    const searchRange = Math.max(16, Math.min(128, Math.floor(Number(range) || 64)));
    const beforePoints = safeFoodPoints(bot);
    const previousHeldItem = bot.heldItem?.name || null;
    const progress = {
        cropsHarvested: 0,
        cropsReplanted: 0,
        animalsHunted: 0,
        itemsCooked: 0,
        breadCrafted: 0,
    };
    const target = { name: 'safe_food', foodPoints: targetPoints };
    const interrupted = () => Boolean(bot.interrupt_code);
    const nearbyHostile = () => bot.nearestEntity?.(entity => (
        mc.isHostile(entity)
        && entity?.position
        && bot.entity.position.distanceTo(entity.position) <= 12
    ));
    const restoreHeldItem = async () => {
        if (!previousHeldItem || bot.heldItem?.name === previousHeldItem || interrupted()) return;
        const previous = bot.inventory.findInventoryItem(previousHeldItem);
        if (!previous) return;
        try {
            await bot.equip(previous, 'hand');
        } catch {
            // Food preparation remains valid if the old hand item cannot be restored.
        }
    };
    const finish = async (success, outcome, detail = {}) => {
        await restoreHeldItem();
        const afterPoints = safeFoodPoints(bot);
        setActionEvidence(bot, {
            kind: 'food_prepare',
            outcome,
            target,
            beforeFoodPoints: beforePoints,
            afterFoodPoints: afterPoints,
            gainedFoodPoints: Math.max(0, afterPoints - beforePoints),
            ...progress,
            retryable: !success,
            ...detail,
        });
        if (success) {
            log(bot, `Secured ${afterPoints} safe food points for continued work.`);
        } else if (outcome !== 'interrupted') {
            log(bot, `Food preparation ended with ${afterPoints} safe food points.`);
        }
        return success;
    };
    const craftAvailableBread = async () => {
        const wheat = inventoryCount(bot, 'wheat');
        if (wheat < 3 || safeFoodPoints(bot) >= targetPoints) return true;
        const breadPoints = Math.max(1, Number(bot.registry?.foodsByName?.bread?.foodPoints) || 5);
        const needed = Math.max(1, Math.ceil((targetPoints - safeFoodPoints(bot)) / breadPoints));
        const crafts = Math.min(Math.floor(wheat / 3), needed);
        if (crafts < 1) return true;
        const before = inventoryCount(bot, 'bread');
        if (!await craftRecipe(bot, 'bread', crafts)) return false;
        progress.breadCrafted += Math.max(0, inventoryCount(bot, 'bread') - before);
        return true;
    };
    const ensureCookingStation = async () => {
        if (!world.getNearestBlock(bot, 'furnace', 16) && inventoryCount(bot, 'furnace') < 1) {
            if (!await prepareTool(bot, 'stone_pickaxe') || interrupted()) return false;
            if (inventoryCount(bot, 'cobblestone') < 8) {
                if (!await collectBlock(
                    bot,
                    'cobblestone',
                    8 - inventoryCount(bot, 'cobblestone'),
                    null,
                    searchRange,
                ) || interrupted()) return false;
            }
            if (inventoryCount(bot, 'crafting_table') < 1) {
                if (plankInventoryCount(bot) < 4) {
                    if (!await prepareMaterial(
                        bot,
                        'planks',
                        4 - plankInventoryCount(bot),
                        searchRange,
                    ) || interrupted()) return false;
                }
                if (!await craftRecipe(bot, 'crafting_table', 1) || interrupted()) return false;
            }
            if (!await craftRecipe(bot, 'furnace', 1) || interrupted()) return false;
        }
        if (!mc.getSmeltingFuel(bot)) {
            if (!await collectWood(bot, 2, searchRange) || interrupted()) return false;
        }
        return Boolean(world.getNearestBlock(bot, 'furnace', 16) || inventoryCount(bot, 'furnace') > 0)
            && Boolean(mc.getSmeltingFuel(bot));
    };
    const carriedCookableCount = () => Object.keys(COOKABLE_FOOD).reduce(
        (total, name) => total + inventoryCount(bot, name),
        0,
    );
    const cookCarriedFood = async (bootstrap) => {
        if (carriedCookableCount() < 1 || safeFoodPoints(bot) >= targetPoints) return true;
        if (bootstrap) {
            if (!await ensureCookingStation()) return false;
        } else if (!world.getNearestBlock(bot, 'furnace', 16) || !mc.getSmeltingFuel(bot)) {
            return false;
        }
        for (const [input, output] of Object.entries(COOKABLE_FOOD)) {
            if (interrupted() || safeFoodPoints(bot) >= targetPoints) break;
            const available = inventoryCount(bot, input);
            if (available < 1) continue;
            const outputPoints = Math.max(1, Number(bot.registry?.foodsByName?.[output]?.foodPoints) || 1);
            const amount = Math.min(
                available,
                Math.max(1, Math.ceil((targetPoints - safeFoodPoints(bot)) / outputPoints)),
            );
            const before = inventoryCount(bot, output);
            if (await smeltItem(bot, input, amount)) {
                progress.itemsCooked += Math.max(0, inventoryCount(bot, output) - before);
            }
        }
        return safeFoodPoints(bot) >= targetPoints;
    };
    const harvestMatureCrops = async () => {
        let crops = [];
        try {
            crops = world.getNearestBlocksWhere(bot, matureFoodCrop, searchRange, 32)
                .filter(Boolean)
                .sort((left, right) => (
                    bot.entity.position.distanceTo(left.position)
                    - bot.entity.position.distanceTo(right.position)
                ));
        } catch {
            return;
        }
        for (const crop of crops) {
            if (interrupted() || safeFoodPoints(bot) >= targetPoints || nearbyHostile()) break;
            const current = bot.blockAt(crop.position);
            if (!matureFoodCrop(current)) continue;
            const spec = CROP_FOOD_SPECS[current.name];
            const cropPosition = current.position.clone();
            if (!await breakBlockAt(
                bot,
                cropPosition.x,
                cropPosition.y,
                cropPosition.z,
            )) continue;
            progress.cropsHarvested += 1;
            await new Promise(resolve => setTimeout(resolve, 200));
            try {
                await pickupNearbyItems(bot);
            } catch {
                // Replant and inventory checks below use current observed state.
            }
            const soil = bot.blockAt(cropPosition.offset(0, -1, 0));
            if (
                soil?.name === 'farmland'
                && inventoryCount(bot, spec.seed) > 0
                && !interrupted()
            ) {
                if (await tillAndSow(
                    bot,
                    soil.position.x,
                    soil.position.y,
                    soil.position.z,
                    spec.seed,
                )) progress.cropsReplanted += 1;
            }
        }
    };
    const potentialCookedFoodPoints = () => Object.entries(COOKABLE_FOOD).reduce(
        (total, [input, output]) => {
            const points = Number(bot.registry?.foodsByName?.[output]?.foodPoints) || 0;
            return total + (inventoryCount(bot, input) * points);
        },
        0,
    );
    const huntFoodAnimals = async () => {
        if (
            !bestInventoryTool(bot, 'sword')
            && !bestInventoryTool(bot, 'axe')
            && !interrupted()
        ) {
            await prepareTool(bot, 'stone_sword');
        }
        for (let attempt = 0; attempt < 6; attempt += 1) {
            if (
                interrupted()
                || safeFoodPoints(bot) + potentialCookedFoodPoints() >= targetPoints
                || nearbyHostile()
                || Number(bot.health) < 12
            ) break;
            const candidates = world.getNearbyEntities(bot, searchRange)
                .filter(entity => (
                    mc.isHuntable(entity)
                    && Object.prototype.hasOwnProperty.call(HUNT_FOOD_SPECS, entity.name)
                ));
            if (candidates.length === 0) break;
            const populations = candidates.reduce((counts, entity) => {
                counts[entity.name] = (counts[entity.name] || 0) + 1;
                return counts;
            }, {});
            const sustainable = candidates.find(entity => populations[entity.name] >= 3);
            const animal = sustainable || (safeFoodPoints(bot) === 0 ? candidates[0] : null);
            if (!animal) break;
            if (!await attackEntity(bot, animal, true)) break;
            progress.animalsHunted += 1;
        }
    };

    if (beforePoints >= targetPoints) return await finish(true, 'already_stocked', { retryable: false });
    if (interrupted()) return await finish(false, 'interrupted', { retryable: false });

    await craftAvailableBread();
    if (safeFoodPoints(bot) >= targetPoints) return await finish(true, 'prepared', { retryable: false });
    await cookCarriedFood(false);
    if (safeFoodPoints(bot) >= targetPoints) return await finish(true, 'prepared', { retryable: false });

    await harvestMatureCrops();
    if (interrupted()) return await finish(false, 'interrupted', { retryable: false });
    await craftAvailableBread();
    if (safeFoodPoints(bot) >= targetPoints) return await finish(true, 'prepared', { retryable: false });

    if (carriedCookableCount() > 0) await cookCarriedFood(true);
    if (interrupted()) return await finish(false, 'interrupted', { retryable: false });
    if (safeFoodPoints(bot) >= targetPoints) return await finish(true, 'prepared', { retryable: false });

    await huntFoodAnimals();
    if (interrupted()) return await finish(false, 'interrupted', { retryable: false });
    if (carriedCookableCount() > 0) await cookCarriedFood(true);
    if (safeFoodPoints(bot) >= targetPoints) return await finish(true, 'prepared', { retryable: false });

    const afterPoints = safeFoodPoints(bot);
    return await finish(false, afterPoints > beforePoints ? 'partial_supply' : 'no_food_sources', {
        availableFoodPoints: afterPoints,
    });
}

export async function prepareWoodenTool(bot, toolName) {
    return await prepareTool(bot, toolName);
}

export async function wait(bot, milliseconds) {
    /**
     * Waits for the given number of milliseconds.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} milliseconds, the number of milliseconds to wait.
     * @returns {Promise<boolean>} true if the wait was successful, false otherwise.
     * @example
     * await skills.wait(bot, 1000);
     **/
    // setTimeout is disabled to prevent unawaited code, so this is a safe alternative that enables interrupts
    let timeLeft = milliseconds;
    let startTime = Date.now();
    
    while (timeLeft > 0) {
        if (bot.interrupt_code) return false;
        
        let waitTime = Math.min(2000, timeLeft);
        await interruptibleDelay(bot, waitTime);
        
        let elapsed = Date.now() - startTime;
        timeLeft = milliseconds - elapsed;
    }
    return true;
}

export async function smeltItem(bot, itemName, num=1) {
    /**
     * Puts 1 coal in furnace and smelts the given item name, waits until the furnace runs out of fuel or input items.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item name to smelt. Ores must contain "raw" like raw_iron.
     * @param {number} num, the number of items to smelt. Defaults to 1.
     * @returns {Promise<boolean>} true if the item was smelted, false otherwise. Fail
     * @example
     * await skills.smeltItem(bot, "raw_iron");
     * await skills.smeltItem(bot, "beef");
     **/

    itemName = String(itemName || '').trim();
    const amount = Math.max(1, Math.min(64, Math.floor(Number(num) || 1)));
    const outputName = SMELTING_OUTPUT[itemName]
        || (itemName.endsWith('_log') || itemName.endsWith('_wood') ? 'charcoal' : null);
    const target = { name: itemName || 'smeltable' };
    let finalEvidence = null;
    let furnace = null;
    let furnaceBlock = null;
    let temporaryFurnace = null;
    const finish = (success, outcome, detail = {}) => {
        finalEvidence = {
            kind: 'smelt',
            outcome,
            target,
            output: outputName,
            requested: amount,
            retryable: !success,
            ...detail,
        };
        setActionEvidence(bot, finalEvidence);
        return success;
    };

    if (!itemName || !mc.isSmeltable(itemName) || !mc.getItemId(itemName)) {
        log(bot, `Cannot smelt ${itemName || 'that item'}.`);
        return finish(false, 'not_smeltable', { retryable: false });
    }
    if (inventoryCount(bot, itemName) < amount) {
        log(bot, `You do not have ${amount} ${itemName} to smelt.`);
        return finish(false, 'missing_input', { available: inventoryCount(bot, itemName) });
    }

    try {
        furnaceBlock = world.getNearestBlock(bot, 'furnace', 64);
        // Prefer a carried furnace over excavating toward a merely loaded
        // remote one. The carried block can be bound to verified local space
        // and remains under the current action's placement/cleanup contract.
        if (
            furnaceBlock
            && !directlyUsableWorkstation(bot, furnaceBlock)
            && inventoryCount(bot, 'furnace') > 0
        ) furnaceBlock = null;
        if (!furnaceBlock && inventoryCount(bot, 'furnace') > 0) {
            const position = world.getNearestFreeSpace(bot, 1, 8);
            if (!position) {
                log(bot, 'There is no safe local space to place the furnace.');
                return finish(false, 'no_furnace_space');
            }
            const inventoryBeforePlacement = inventoryCount(bot, 'furnace');
            if (!await placeBlock(bot, 'furnace', position.x, position.y, position.z)) {
                return finish(false, 'furnace_not_placed');
            }
            temporaryFurnace = {
                position: new Vec3(
                    Math.floor(position.x),
                    Math.floor(position.y),
                    Math.floor(position.z),
                ),
                inventoryBeforePlacement,
            };
            furnaceBlock = bot.blockAt(new Vec3(
                Math.floor(position.x),
                Math.floor(position.y),
                Math.floor(position.z),
            ));
            if (furnaceBlock?.name !== 'furnace') {
                return finish(false, 'furnace_not_confirmed');
            }
            temporaryFurnace.position = furnaceBlock.position.clone();
        }
        if (!furnaceBlock) {
            log(bot, 'There is no reachable furnace and no carried furnace.');
            return finish(false, 'missing_furnace');
        }

        if (bot.entity.position.distanceTo(furnaceBlock.position) > 4.5) {
            const reached = await goToPosition(
                bot,
                furnaceBlock.position.x,
                furnaceBlock.position.y,
                furnaceBlock.position.z,
                3,
            );
            if (!reached || bot.entity.position.distanceTo(furnaceBlock.position) > 4.5) {
                if (bot.interrupt_code) return finish(false, 'interrupted', { retryable: false });
                const access = await reachKnownBlockByVoxelCorridor(bot, furnaceBlock, 64);
                if (!access.success || bot.entity.position.distanceTo(furnaceBlock.position) > 4.5) {
                    const at = bot.entity?.position?.floored?.();
                    const step = access.step;
                    log(bot, `Exact furnace approach stopped: ${String(access.outcome).replace(/_/g, ' ')}${Number.isInteger(access.stepIndex) ? ` on step ${access.stepIndex + 1}` : ''}${step ? ` toward (${step.x}, ${step.y}, ${step.z})` : ''}${at ? ` from (${at.x}, ${at.y}, ${at.z})` : ''}.`);
                    return finish(false, 'furnace_unreachable', {
                        access,
                        workstationRequirement: {
                            name: 'furnace',
                            carried: true,
                        },
                    });
                }
                furnaceBlock = bot.blockAt(furnaceBlock.position);
                if (furnaceBlock?.name !== 'furnace') {
                    return finish(false, 'furnace_changed', { access });
                }
            }
        }
        if (bot.interrupt_code) return finish(false, 'interrupted', { retryable: false });

        bot.modes.pause('unstuck');
        await bot.lookAt(furnaceBlock.position);
        furnace = await bot.openFurnace(furnaceBlock);
        const existingInput = furnace.inputItem();
        if (existingInput && existingInput.type !== mc.getItemId(itemName) && existingInput.count > 0) {
            log(bot, `The furnace is already smelting ${existingInput.name || mc.getItemName(existingInput.type)}.`);
            return finish(false, 'furnace_busy', {
                observed: existingInput.name || mc.getItemName(existingInput.type),
            });
        }
        const existingOutput = furnace.outputItem();
        if (existingOutput && outputName && existingOutput.name !== outputName) {
            log(bot, `The furnace contains ${existingOutput.name}; it will not be mixed with ${outputName}.`);
            return finish(false, 'furnace_output_occupied', { observed: existingOutput.name });
        }

        if (!furnace.fuelItem()) {
            const fuel = mc.getSmeltingFuel(bot);
            if (!fuel) {
                log(bot, `No furnace fuel is available for ${itemName}.`);
                return finish(false, 'missing_fuel');
            }
            const fuelOutput = mc.getFuelSmeltOutput(fuel.name);
            const fuelCount = Math.max(1, Math.ceil(amount / Math.max(1, fuelOutput)));
            if (fuel.count < fuelCount) {
                log(bot, `There is not enough ${fuel.name} to cook ${amount} ${itemName}.`);
                return finish(false, 'insufficient_fuel', {
                    fuel: fuel.name,
                    requiredFuel: fuelCount,
                    availableFuel: fuel.count,
                });
            }
            await furnace.putFuel(fuel.type, null, fuelCount);
        }

        await furnace.putInput(mc.getItemId(itemName), null, amount);
        let total = 0;
        let observedOutput = outputName;
        let lastProgressAt = Date.now();
        const deadline = Date.now() + Math.min(660_000, Math.max(25_000, (amount * 11_000) + 15_000));
        while (total < amount && Date.now() < deadline) {
            if (bot.interrupt_code) break;
            await new Promise(resolve => setTimeout(resolve, 500));
            const output = furnace.outputItem();
            if (output) {
                const collected = await furnace.takeOutput();
                if (collected) {
                    total += collected.count;
                    observedOutput = collected.name || mc.getItemName(collected.type);
                    lastProgressAt = Date.now();
                }
            }
            if (Date.now() - lastProgressAt > 15_000) break;
        }

        if (furnace.inputItem()) await furnace.takeInput();
        if (furnace.fuelItem()) await furnace.takeFuel();
        if (bot.interrupt_code) {
            log(bot, `Stopped smelting ${itemName} after collecting ${total}.`);
            return finish(false, 'interrupted', { count: total, observedOutput, retryable: false });
        }
        if (total < amount) {
            log(bot, `The furnace produced ${total} of ${amount} requested ${observedOutput || 'items'}.`);
            return finish(false, total > 0 ? 'partial' : 'stalled', { count: total, observedOutput });
        }
        log(bot, `Smelted ${amount} ${itemName} into ${total} ${observedOutput || outputName || 'items'}.`);
        return finish(true, 'smelted', { count: total, observedOutput, retryable: false });
    } catch (error) {
        const message = String(error?.message || error).slice(0, 240);
        log(bot, `Could not smelt ${itemName}: ${message}.`);
        return finish(false, 'smelt_blocked', { error: message });
    } finally {
        await closeContainerQuietly(furnace);
        if (temporaryFurnace) {
            const { position, inventoryBeforePlacement } = temporaryFurnace;
            let cleanup = { outcome: 'already_recovered', retryable: false };
            if (inventoryCount(bot, 'furnace') < inventoryBeforePlacement) {
                const block = bot.blockAt(position);
                if (block?.name === 'furnace' && await breakBlockAt(bot, position.x, position.y, position.z)) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                    try {
                        await pickupNearbyItems(bot);
                    } catch {
                        // Inventory verification below is authoritative.
                    }
                }
                cleanup = inventoryCount(bot, 'furnace') >= inventoryBeforePlacement
                    ? { outcome: 'recovered', retryable: false }
                    : { outcome: 'furnace_left_in_world', retryable: true };
            }
            if (finalEvidence) setActionEvidence(bot, { ...finalEvidence, cleanup });
        }
    }
}

async function moveOneWindowItem(bot, sourceSlot, destinationSlot) {
    const window = bot.currentWindow;
    if (!window) throw new Error('Container closed while moving an item.');
    if (!window.slots[sourceSlot]) throw new Error(`Source slot ${sourceSlot} is empty.`);
    if (window.slots[destinationSlot]) throw new Error(`Destination slot ${destinationSlot} is occupied.`);
    await bot.clickWindow(sourceSlot, 0, 0);
    await bot.clickWindow(destinationSlot, 1, 0);
    await bot.clickWindow(sourceSlot, 0, 0);
}

function findWindowInventorySlot(window, predicate) {
    for (let slot = window.inventoryStart; slot < window.inventoryEnd; slot += 1) {
        if (predicate(window.slots[slot])) return slot;
    }
    return null;
}

async function returnBrewingContents(bot, window) {
    if (!window || bot.currentWindow !== window) return;
    for (let slot = 0; slot <= 4; slot += 1) {
        if (!window.slots[slot]) continue;
        try {
            await bot.putAway(slot);
        } catch (error) {
            console.warn(`[brewing] Could not return slot ${slot}: ${String(error?.message || error).slice(0, 180)}`);
        }
    }
}

export async function brewPotion(bot, requestedTarget, num=1) {
    /**
     * Brews one to three drinkable, splash, or lingering potions through a
     * real brewing stand and verifies every ingredient-driven state change.
     * @param {MinecraftBot} bot Mineflayer bot.
     * @param {string} requestedTarget Target such as strength,
     * strong_strength, long_fire_resistance, splash_healing, or
     * lingering_poison.
     * @param {number} num Number of bottles, from one to three.
     * @returns {Promise<boolean>} true only after the output bottles are back
     * in inventory with changed potion state.
     */
    const plan = resolveBrewingPlan(requestedTarget);
    const amount = Math.max(1, Math.min(3, Math.floor(Number(num) || 1)));
    const target = { name: String(requestedTarget || '').trim().toLowerCase(), count: amount };
    let stand = null;
    let standBlock = null;
    let temporaryStand = null;
    let contentsOwned = false;
    let finalEvidence = null;
    const finish = (success, outcome, detail = {}) => {
        finalEvidence = {
            kind: 'brew',
            outcome,
            target,
            recipe: plan?.target || null,
            output: plan?.outputItem || null,
            requested: amount,
            retryable: !success,
            ...detail,
        };
        setActionEvidence(bot, finalEvidence);
        return success;
    };

    if (!plan) {
        log(bot, `Unsupported potion target '${target.name || 'unknown'}'.`);
        return finish(false, 'unsupported_potion', { retryable: false });
    }

    try {
        standBlock = world.getNearestBlock(bot, 'brewing_stand', 16);
        if (!standBlock && inventoryCount(bot, 'brewing_stand') < 1) {
            await craftRecipe(bot, 'brewing_stand', 1);
        }
        if (!standBlock && inventoryCount(bot, 'brewing_stand') > 0) {
            const position = world.getNearestFreeSpace(bot, 1, 8);
            if (!position) {
                log(bot, 'There is no safe local space to place the brewing stand.');
                return finish(false, 'no_brewing_stand_space');
            }
            const inventoryBeforePlacement = inventoryCount(bot, 'brewing_stand');
            if (!await placeBlock(bot, 'brewing_stand', position.x, position.y, position.z)) {
                return finish(false, 'brewing_stand_not_placed');
            }
            standBlock = bot.blockAt(new Vec3(
                Math.floor(position.x),
                Math.floor(position.y),
                Math.floor(position.z),
            ));
            if (standBlock?.name !== 'brewing_stand') {
                return finish(false, 'brewing_stand_not_confirmed');
            }
            temporaryStand = {
                position: standBlock.position.clone(),
                inventoryBeforePlacement,
            };
        }
        if (!standBlock) {
            log(bot, 'There is no reachable brewing stand and no carried stand could be prepared.');
            return finish(false, 'missing_brewing_stand');
        }

        if (bot.entity.position.distanceTo(standBlock.position) > 4.5) {
            const reached = await goToPosition(
                bot,
                standBlock.position.x,
                standBlock.position.y,
                standBlock.position.z,
                3,
            );
            if (!reached || bot.entity.position.distanceTo(standBlock.position) > 4.5) {
                return finish(false, 'brewing_stand_unreachable');
            }
        }
        if (bot.interrupt_code) return finish(false, 'interrupted', { retryable: false });

        bot.modes.pause('unstuck');
        await bot.lookAt(standBlock.position);
        stand = await bot.openBlock(standBlock);
        if (stand?.type !== 'minecraft:brewing_stand' || stand.inventoryStart !== 5) {
            return finish(false, 'unexpected_brewing_window', {
                observed: stand?.type || 'closed',
                retryable: false,
            });
        }
        if ([0, 1, 2, 3].some(slot => stand.slots[slot])) {
            log(bot, 'The brewing stand already contains bottles or an ingredient; it was left untouched.');
            return finish(false, 'brewing_stand_busy');
        }

        const waterSlots = [];
        for (let slot = stand.inventoryStart; slot < stand.inventoryEnd; slot += 1) {
            if (isWaterPotion(stand.slots[slot])) waterSlots.push(slot);
        }
        if (waterSlots.length < amount) {
            log(bot, `Need ${amount} verified water bottle(s), but found ${waterSlots.length}.`);
            return finish(false, 'missing_water_bottles', { available: waterSlots.length });
        }

        const required = new Map([['blaze_powder', 1]]);
        for (const ingredient of plan.ingredients) {
            required.set(ingredient, (required.get(ingredient) || 0) + 1);
        }
        for (const [itemName, count] of required) {
            const available = inventoryCount(bot, itemName);
            if (available < count) {
                log(bot, `Need ${count} ${itemName}, but only ${available} is available.`);
                return finish(false, 'missing_brewing_ingredient', {
                    ingredient: itemName,
                    required: count,
                    available,
                });
            }
        }

        for (let bottleSlot = 0; bottleSlot < amount; bottleSlot += 1) {
            const inventorySlot = findWindowInventorySlot(stand, isWaterPotion);
            if (inventorySlot === null) {
                return finish(false, 'water_bottle_transfer_failed');
            }
            await bot.moveSlotItem(inventorySlot, bottleSlot);
        }
        const fuelSlot = findWindowInventorySlot(stand, item => item?.name === 'blaze_powder');
        if (fuelSlot === null) return finish(false, 'missing_brewing_fuel');
        await moveOneWindowItem(bot, fuelSlot, 4);
        contentsOwned = true;

        let completedStages = 0;
        for (const ingredient of plan.ingredients) {
            if (bot.interrupt_code) {
                return finish(false, 'interrupted', { completedStages, retryable: false });
            }
            const before = Array.from(
                { length: amount },
                (_, slot) => potionFingerprint(stand.slots[slot]),
            );
            const ingredientSlot = findWindowInventorySlot(
                stand,
                item => item?.name === ingredient,
            );
            if (ingredientSlot === null) {
                return finish(false, 'brewing_ingredient_transfer_failed', {
                    ingredient,
                    completedStages,
                });
            }
            await moveOneWindowItem(bot, ingredientSlot, 3);
            const brewed = await waitForWorldCondition(
                bot,
                () => (
                    bot.currentWindow === stand
                    && !stand.slots[3]
                    && before.every((fingerprint, slot) => (
                        stand.slots[slot]
                        && potionFingerprint(stand.slots[slot]) !== fingerprint
                    ))
                ),
                BREW_STAGE_TIMEOUT_MS,
                BREW_POLL_MS,
            );
            if (!brewed) {
                return finish(false, bot.interrupt_code ? 'interrupted' : 'brew_stage_timeout', {
                    ingredient,
                    completedStages,
                    retryable: !bot.interrupt_code,
                });
            }
            completedStages += 1;
        }

        const observed = Array.from({ length: amount }, (_, slot) => stand.slots[slot]?.name || null);
        if (observed.some(name => name !== plan.outputItem)) {
            return finish(false, 'brew_output_unverified', {
                observed,
                completedStages: plan.ingredients.length,
            });
        }
        for (let bottleSlot = 0; bottleSlot < amount; bottleSlot += 1) {
            const destination = stand.firstEmptyInventorySlot();
            if (destination === null) {
                return finish(false, 'brew_inventory_full', {
                    completedStages: plan.ingredients.length,
                });
            }
            await bot.moveSlotItem(bottleSlot, destination);
        }
        contentsOwned = false;
        log(bot, `Brewed ${amount} ${plan.target.replace(/_/g, ' ')} potion${amount === 1 ? '' : 's'}.`);
        return finish(true, 'brewed', {
            count: amount,
            ingredients: [...plan.ingredients],
            retryable: false,
        });
    } catch (error) {
        const message = String(error?.message || error).slice(0, 240);
        log(bot, `Could not brew ${plan.target}: ${message}.`);
        return finish(false, 'brew_blocked', { error: message });
    } finally {
        if (contentsOwned) await returnBrewingContents(bot, stand);
        await closeContainerQuietly(stand);
        bot.modes.unpause('unstuck');
        if (temporaryStand?.position) {
            const block = bot.blockAt(temporaryStand.position);
            if (block?.name === 'brewing_stand') {
                await breakBlockAt(
                    bot,
                    temporaryStand.position.x,
                    temporaryStand.position.y,
                    temporaryStand.position.z,
                );
            }
        }
        if (finalEvidence) setActionEvidence(bot, finalEvidence);
    }
}

export async function clearNearestFurnace(bot) {
    /**
     * Clears the nearest furnace of all items.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the furnace was cleared, false otherwise.
     * @example
     * await skills.clearNearestFurnace(bot);
     **/
    let furnaceBlock = world.getNearestBlock(bot, 'furnace', 32);
    const target = furnaceBlock?.position
        ? { name: 'furnace', x: furnaceBlock.position.x, y: furnaceBlock.position.y, z: furnaceBlock.position.z }
        : { name: 'furnace' };
    if (!furnaceBlock) {
        setActionEvidence(bot, { kind: 'furnace', outcome: 'not_found', target, retryable: true });
        log(bot, `No furnace nearby to clear.`);
        return false;
    }
    if (bot.entity.position.distanceTo(furnaceBlock.position) > 4) {
        if (!await goToPosition(bot, furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, 4)) {
            setActionEvidence(bot, { kind: 'furnace', outcome: 'unreachable', target, retryable: true });
            return false;
        }
        furnaceBlock = bot.blockAt(furnaceBlock.position);
        if (furnaceBlock?.name !== 'furnace') {
            setActionEvidence(bot, { kind: 'furnace', outcome: 'target_changed', target, observed: furnaceBlock?.name || 'unloaded', retryable: true });
            return false;
        }
    }

    let furnace = null;
    try {
        furnace = await bot.openFurnace(furnaceBlock);
        const removed = [];
        if (furnace.outputItem()) removed.push(await furnace.takeOutput());
        if (furnace.inputItem()) removed.push(await furnace.takeInput());
        if (furnace.fuelItem()) removed.push(await furnace.takeFuel());
        const remaining = [furnace.outputItem(), furnace.inputItem(), furnace.fuelItem()].filter(Boolean);
        if (remaining.length > 0) {
            setActionEvidence(bot, { kind: 'furnace', outcome: 'clear_unverified', target, remaining: remaining.length, retryable: true });
            log(bot, 'The furnace still contains items after the clear attempt.');
            return false;
        }
        const received = removed
            .filter(Boolean)
            .map(item => ({ name: item.name, count: item.count }));
        setActionEvidence(bot, { kind: 'furnace', outcome: 'cleared', target, received, retryable: false });
        log(bot, received.length > 0
            ? `Cleared furnace and received ${received.map(item => `${item.count} ${item.name}`).join(', ')}.`
            : 'Furnace was already empty.');
        return true;
    } catch (error) {
        const message = String(error?.message || error).slice(0, 240);
        setActionEvidence(bot, { kind: 'furnace', outcome: 'clear_blocked', target, error: message, retryable: true });
        log(bot, `Could not clear the furnace: ${message}.`);
        return false;
    } finally {
        await closeContainerQuietly(furnace);
    }
}


function combatEquipmentSnapshot(bot) {
    const inventoryItems = bot.inventory?.items?.() || [];
    const equipped = [
        bot.heldItem,
        equippedItemAt(bot, 'off-hand'),
    ].filter(Boolean);
    const items = [...inventoryItems, ...equipped];
    const names = new Set(items.map(item => item?.name).filter(Boolean));
    const melee = items.some(item => (
        (
            item?.name?.includes('sword')
            || (item?.name?.includes('axe') && !item.name.includes('pickaxe'))
            || item?.name?.includes('pickaxe')
            || item?.name?.includes('shovel')
        )
        && toolDurability(bot, item).healthy
    ));
    return {
        melee,
        shield: names.has('shield'),
        bow: names.has('bow'),
        arrows: (inventoryCount(bot, 'arrow') + inventoryCount(bot, 'spectral_arrow')) > 0,
    };
}

function tacticalCombatSnapshot(bot, range, attributedEntityId=null) {
    const hostiles = world.getNearbyEntities(bot, range)
        .filter(entity => entity?.position && mc.isHostile(entity))
        .map(entity => {
            const dx = entity.position.x - bot.entity.position.x;
            const dy = entity.position.y - bot.entity.position.y;
            const dz = entity.position.z - bot.entity.position.z;
            const distance = Math.hypot(dx, dy, dz);
            const relativeVelocity = {
                x: (Number(entity.velocity?.x) || 0) - (Number(bot.entity.velocity?.x) || 0),
                y: (Number(entity.velocity?.y) || 0) - (Number(bot.entity.velocity?.y) || 0),
                z: (Number(entity.velocity?.z) || 0) - (Number(bot.entity.velocity?.z) || 0),
            };
            const radialVelocity = distance > 0.001
                ? ((relativeVelocity.x * dx) + (relativeVelocity.y * dy) + (relativeVelocity.z * dz)) / distance
                : 0;
            const closingSpeed = Number((-radialVelocity).toFixed(3));
            const feet = bot.blockAt?.(entity.position.floored?.() || entity.position);
            const headPosition = entity.position.offset?.(0, 1, 0);
            const head = headPosition ? bot.blockAt?.(headPosition) : null;
            return {
                id: entity.id,
                name: entity.name,
                distance,
                disposition: mc.getThreatDisposition(entity),
                attributed: Number.isFinite(attributedEntityId) && entity.id === attributedEntityId,
                motion: {
                    state: closingSpeed > 0.04 ? 'approaching' : closingSpeed < -0.04 ? 'retreating' : 'stationary',
                    closingSpeed,
                },
                lineOfSight: world.hasLineOfSightToEntity(bot, entity),
                localGeometry: {
                    feet: String(feet?.name || 'unknown').slice(0, 64),
                    head: String(head?.name || 'unknown').slice(0, 64),
                    onGround: entity.onGround === true,
                },
            };
        });
    return {
        health: bot.health,
        hunger: bot.food,
        equipment: combatEquipmentSnapshot(bot),
        hostiles,
    };
}

async function waitCombatWindow(bot, durationMs) {
    const deadline = Date.now() + Math.max(0, Number(durationMs) || 0);
    while (!bot.interrupt_code && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, Math.min(50, deadline - Date.now())));
    }
    return !bot.interrupt_code;
}

async function equipCombatShield(bot) {
    const equipped = equippedItemAt(bot, 'off-hand');
    if (equipped?.name === 'shield') return true;
    const shield = bot.inventory?.items?.().find(item => item?.name === 'shield');
    if (!shield) return false;
    try {
        await bot.equip(shield, 'off-hand');
    } catch (error) {
        log(bot, `Could not equip shield for combat: ${error?.message || error}.`);
        return false;
    }
    return equippedItemAt(bot, 'off-hand')?.name === 'shield';
}

async function holdShield(bot, durationMs) {
    if (!await equipCombatShield(bot)) return false;
    let activated = false;
    try {
        bot.activateItem(true);
        activated = true;
        return await waitCombatWindow(bot, durationMs);
    } catch (error) {
        log(bot, `Could not raise shield: ${error?.message || error}.`);
        return false;
    } finally {
        if (activated) {
            try { bot.deactivateItem(); } catch { /* best-effort shield release */ }
        }
    }
}

function isTacticalMeleeStandingCellClear(block) {
    return Boolean(
        block
        && block.boundingBox === 'empty'
        && !isLiquidGameplayBlock(block)
        && !isHazardousGameplayBlock(block)
    );
}

function hasLineOfSightFromTacticalStance(bot, stance, entity) {
    if (!bot?.world?.raycast || !stance || !entity?.position) return false;
    const origin = new Vec3(
        stance.x + 0.5,
        stance.y + (Number(bot.entity?.eyeHeight) || 1.62),
        stance.z + 0.5,
    );
    const entityHeight = Math.max(0.6, Number(entity.height) || Number(entity.eyeHeight) || 1.8);
    const samples = [0.2, 0.55, 0.9].map(ratio => (
        entity.position.offset(0, entityHeight * ratio, 0)
    ));
    for (const sample of samples) {
        const direction = sample.minus(origin);
        const distance = direction.norm();
        if (!Number.isFinite(distance)) continue;
        if (distance <= 0.25) return true;
        if (!bot.world.raycast(origin, direction.scaled(1 / distance), distance)) return true;
    }
    return false;
}

function tacticalMeleeStanceClearance(bot, stance) {
    let clearance = 0;
    for (const [dx, dz] of [
        [-1, -1], [0, -1], [1, -1],
        [-1, 0], [1, 0],
        [-1, 1], [0, 1], [1, 1],
    ]) {
        const feet = stance.offset(dx, 0, dz);
        try {
            if (!isTacticalMeleeStandingCellClear(bot.blockAt(feet))) continue;
            if (!isTacticalMeleeStandingCellClear(bot.blockAt(feet.offset(0, 1, 0)))) continue;
            if (!isSafeGameplaySupport(bot.blockAt(feet.offset(0, -1, 0)))) continue;
            clearance += 1;
        } catch {
            // Unloaded neighbours cannot prove route clearance.
        }
    }
    return clearance;
}

export function findTacticalMeleeStances(bot, entity) {
    if (!bot?.entity?.position || !entity?.position?.floored) return [];
    const targetFeet = entity.position.floored();
    const stances = [];
    for (let y = targetFeet.y - 1; y <= targetFeet.y + 1; y += 1) {
        for (let x = targetFeet.x - TACTICAL_MELEE_STANCE_RADIUS;
            x <= targetFeet.x + TACTICAL_MELEE_STANCE_RADIUS;
            x += 1) {
            for (let z = targetFeet.z - TACTICAL_MELEE_STANCE_RADIUS;
                z <= targetFeet.z + TACTICAL_MELEE_STANCE_RADIUS;
                z += 1) {
                if (x === targetFeet.x && y === targetFeet.y && z === targetFeet.z) continue;
                const feet = new Vec3(x, y, z);
                const standingPosition = new Vec3(x + 0.5, y, z + 0.5);
                if (standingPosition.distanceTo(entity.position) > MAX_MELEE_REACH - TACTICAL_MELEE_REACH_MARGIN) {
                    continue;
                }
                let feetBlock;
                let headBlock;
                let supportBlock;
                try {
                    feetBlock = bot.blockAt(feet);
                    headBlock = bot.blockAt(feet.offset(0, 1, 0));
                    supportBlock = bot.blockAt(feet.offset(0, -1, 0));
                } catch {
                    continue;
                }
                if (!isTacticalMeleeStandingCellClear(feetBlock)) continue;
                if (!isTacticalMeleeStandingCellClear(headBlock)) continue;
                if (!isSafeGameplaySupport(supportBlock)) continue;
                if (!hasLineOfSightFromTacticalStance(bot, feet, entity)) continue;
                stances.push({
                    position: feet,
                    clearance: tacticalMeleeStanceClearance(bot, feet),
                });
            }
        }
    }
    stances.sort((left, right) => {
        const leftPosition = new Vec3(
            left.position.x + 0.5,
            left.position.y,
            left.position.z + 0.5,
        );
        const rightPosition = new Vec3(
            right.position.x + 0.5,
            right.position.y,
            right.position.z + 0.5,
        );
        return right.clearance - left.clearance
            || bot.entity.position.distanceTo(leftPosition) - bot.entity.position.distanceTo(rightPosition)
            || leftPosition.distanceTo(entity.position) - rightPosition.distanceTo(entity.position)
            || left.position.y - right.position.y
            || left.position.x - right.position.x
            || left.position.z - right.position.z;
    });
    const bestClearance = stances[0]?.clearance;
    return stances
        .filter(candidate => candidate.clearance === bestClearance)
        .slice(0, MAX_TACTICAL_MELEE_STANCES)
        .map(candidate => candidate.position);
}

function tacticalMeleeApproachGoal(stances) {
    if (!Array.isArray(stances) || stances.length === 0) return null;
    return new pf.goals.GoalCompositeAny(
        stances.map(position => new pf.goals.GoalBlock(position.x, position.y, position.z)),
    );
}

function isReadyForTacticalMelee(bot, entity) {
    if (!bot?.entity?.position || !entity?.position) return false;
    if (bot.entity.position.distanceTo(entity.position) > MAX_MELEE_REACH - TACTICAL_MELEE_REACH_MARGIN) {
        return false;
    }
    return world.hasLineOfSightToEntity(bot, entity) !== false;
}

export function shouldReplanTacticalMeleeApproach({
    replan,
    navigated,
    physicalProgress,
    targetMovement,
    lineOfSightBefore,
    lineOfSightAfter,
}) {
    if (replan >= MAX_TACTICAL_MELEE_REPLANS) return false;
    if (targetMovement >= TACTICAL_MELEE_REPLAN_DISTANCE) return true;
    return !navigated
        && physicalProgress >= NAVIGATION_PROGRESS_DISTANCE
        && lineOfSightBefore === false
        && lineOfSightAfter === true;
}

async function approachTacticalMeleeRange(bot, entity) {
    const target = { name: entity?.username || entity?.name || 'entity', id: entity?.id };
    const attempts = [];
    const finish = (success, outcome, detail = {}) => {
        setActionEvidence(bot, {
            kind: 'combat_approach',
            outcome,
            target,
            attempts,
            retryable: !success && !bot.interrupt_code,
            ...detail,
        });
        return success;
    };

    for (let replan = 0; replan <= MAX_TACTICAL_MELEE_REPLANS; replan += 1) {
        if (bot.interrupt_code) return finish(false, 'interrupted', { replanCount: replan });
        const liveEntity = bot.entities?.[entity?.id];
        if (!liveEntity?.position) return finish(false, 'target_lost', { replanCount: replan });
        if (isReadyForTacticalMelee(bot, liveEntity)) {
            return finish(true, 'melee_range_reached', { replanCount: replan });
        }

        const plannedPosition = liveEntity.position.clone();
        const routeStart = bot.entity.position.clone();
        const lineOfSightBefore = world.hasLineOfSightToEntity(bot, liveEntity);
        // GoalFollow is Pathfinder's native moving-entity primitive. An exposed
        // hostile must stay live-bound while it moves; freezing its current
        // position into a composite of static stance goals makes a successful
        // hit look like a failed approach as soon as knockback moves it.
        // Exact stance binding remains authoritative when geometry blocks line
        // of sight, where "near the entity" is not yet an attackable position.
        const followsMovingTarget = lineOfSightBefore !== false;
        const stances = followsMovingTarget ? [] : findTacticalMeleeStances(bot, liveEntity);
        const attempt = {
            replan,
            strategy: followsMovingTarget ? 'native_goal_follow' : 'safe_line_of_sight_stance',
            targetPosition: {
                x: plannedPosition.x,
                y: plannedPosition.y,
                z: plannedPosition.z,
            },
            stanceCount: stances.length,
        };
        attempts.push(attempt);
        const goal = followsMovingTarget
            ? new pf.goals.GoalFollow(liveEntity, MAX_MELEE_REACH - 0.4)
            : tacticalMeleeApproachGoal(stances);
        if (!goal) return finish(false, 'no_safe_melee_stance', { replanCount: replan });

        const navigated = await goToGoal(bot, goal);
        attempt.navigationOutcome = bot.lastActionEvidence?.outcome || (navigated ? 'arrived' : 'route_blocked');
        if (bot.interrupt_code) return finish(false, 'interrupted', { replanCount: replan });
        const currentEntity = bot.entities?.[entity.id];
        if (!currentEntity?.position) return finish(false, 'target_lost', { replanCount: replan });
        if (isReadyForTacticalMelee(bot, currentEntity)) {
            return finish(true, 'melee_range_reached', { replanCount: replan });
        }

        const targetMovement = currentEntity.position.distanceTo(plannedPosition);
        const physicalProgress = bot.entity.position.distanceTo(routeStart);
        const lineOfSightAfter = world.hasLineOfSightToEntity(bot, currentEntity);
        attempt.targetMovement = Math.round(targetMovement * 100) / 100;
        attempt.physicalProgress = Math.round(physicalProgress * 100) / 100;
        attempt.lineOfSightBefore = lineOfSightBefore;
        attempt.lineOfSightAfter = lineOfSightAfter;
        if (
            followsMovingTarget
            && lineOfSightAfter === false
            && replan < MAX_TACTICAL_MELEE_REPLANS
        ) {
            attempt.strategyTransition = 'safe_line_of_sight_stance';
            continue;
        }
        if (shouldReplanTacticalMeleeApproach({
            replan,
            navigated,
            physicalProgress,
            targetMovement,
            lineOfSightBefore,
            lineOfSightAfter,
        })) {
            continue;
        }
        if (!navigated) {
            return finish(false, 'melee_route_blocked', {
                replanCount: replan,
                navigation: bot.lastActionEvidence,
            });
        }
        return finish(false, 'melee_stance_unverified', { replanCount: replan });
    }
    return finish(false, 'melee_replan_limit_reached', {
        replanCount: MAX_TACTICAL_MELEE_REPLANS,
    });
}

async function closeWithShield(bot, entity) {
    if (!entity?.position || !await equipCombatShield(bot)) return false;
    let activated = false;
    try {
        bot.activateItem(true);
        activated = true;
        return await approachTacticalMeleeRange(bot, entity);
    } catch (error) {
        log(bot, `Could not close safely behind the shield: ${error?.message || error}.`);
        return false;
    } finally {
        if (activated) {
            try { bot.deactivateItem(); } catch { /* best-effort shield release */ }
        }
    }
}

async function closeForMelee(bot, entity) {
    if (!entity?.position) return false;
    try {
        return await approachTacticalMeleeRange(bot, entity);
    } catch (error) {
        log(bot, `Could not close melee distance: ${error?.message || error}.`);
        return false;
    }
}

function performVerifiedRangedShot(bot, entity, timeoutMs=TACTICAL_SHOT_CONFIRM_MS) {
    return new Promise(resolve => {
        let settled = false;
        let released = false;
        let timeout = null;
        let interruptPoll = null;
        let lastUncreditedDamage = null;
        const targetId = entity?.id;
        const cleanup = () => {
            if (timeout) clearTimeout(timeout);
            if (interruptPoll) clearInterval(interruptPoll);
            try { bot.removeListener?.('entityHurt', onEntityHurt); } catch { /* best-effort listener cleanup */ }
            try { bot.removeListener?.('entityDead', onEntityDead); } catch { /* best-effort listener cleanup */ }
            if (!released) {
                try { bot.deactivateItem(); } catch { /* best-effort bow release */ }
            }
        };
        const finish = result => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(result);
        };
        const onEntityHurt = (hurtEntity, source) => {
            const observation = observeCombatDamage(bot, targetId, hurtEntity, source);
            if (!observation.matchesTarget) return;
            if (observation.confirmsBotHit) {
                finish({ confirmed: true, outcome: 'ranged_hit_attributed', attribution: observation });
                return;
            }
            lastUncreditedDamage = observation;
        };
        const onEntityDead = deadEntity => {
            if (deadEntity?.id === targetId) {
                finish({
                    confirmed: false,
                    outcome: lastUncreditedDamage?.attribution === 'foreign'
                        ? 'target_died_after_foreign_damage'
                        : 'target_died_unattributed',
                    attribution: lastUncreditedDamage,
                });
            }
        };

        bot.on('entityHurt', onEntityHurt);
        bot.on('entityDead', onEntityDead);
        timeout = setTimeout(() => finish({
            confirmed: false,
            outcome: bot.interrupt_code
                ? 'interrupted'
                : lastUncreditedDamage?.code || 'ranged_damage_unconfirmed',
            attribution: lastUncreditedDamage,
        }), timeoutMs + TACTICAL_BOW_CHARGE_MS);
        interruptPoll = setInterval(() => {
            if (bot.interrupt_code) finish({ confirmed: false, outcome: 'interrupted' });
        }, ATTACK_INTERRUPT_POLL_MS);

        void (async () => {
            try {
                const targetHeight = Number.isFinite(entity?.height)
                    ? Math.max(0.5, entity.height * 0.55)
                    : 0.9;
                await bot.lookAt(entity.position.offset(0, targetHeight, 0), true);
                bot.activateItem(false);
                if (!await waitCombatWindow(bot, TACTICAL_BOW_CHARGE_MS)) {
                    finish({ confirmed: false, outcome: 'interrupted' });
                    return;
                }
                bot.deactivateItem();
                released = true;
            } catch (error) {
                finish({
                    confirmed: false,
                    outcome: 'ranged_attack_blocked',
                    error: String(error?.message || error).slice(0, 240),
                });
            }
        })();
    });
}

async function fireTacticalBow(bot, entity, desiredRange) {
    if (!entity?.position) return { confirmed: false, outcome: 'target_lost' };
    let distance = bot.entity.position.distanceTo(entity.position);
    if (distance < desiredRange - 1) {
        if (!await moveAwayFromEntity(bot, entity, desiredRange)) {
            return { confirmed: false, outcome: bot.lastActionEvidence?.outcome || 'range_control_blocked' };
        }
    } else if (distance > Math.max(desiredRange + 5, 14)) {
        if (!await goToGoal(bot, new pf.goals.GoalFollow(entity, desiredRange + 1))) {
            return { confirmed: false, outcome: bot.lastActionEvidence?.outcome || 'range_control_blocked' };
        }
    }
    if (!entity?.position || !bot.entities?.[entity.id]) {
        return { confirmed: false, outcome: 'target_lost' };
    }
    distance = bot.entity.position.distanceTo(entity.position);
    if (distance < desiredRange - 1.5) {
        return { confirmed: false, outcome: 'target_too_close' };
    }
    if (!await equip(bot, 'bow', 'hand')) {
        return { confirmed: false, outcome: 'missing_ranged_weapon' };
    }
    return await performVerifiedRangedShot(bot, entity);
}

export async function resolveTacticalCombat(bot, range=TACTICAL_COMBAT_RANGE, attributedEntityId=null) {
    const requestedRange = Math.max(4, Math.min(32, Math.floor(Number(range) || TACTICAL_COMBAT_RANGE)));
    const startedHealth = Math.max(0, Number(bot.health) || 0);
    const decisions = [];
    let verifiedHits = 0;
    let rangedShots = 0;
    let shieldWindows = 0;
    let retreats = 0;
    let steps = 0;
    let lastTarget = null;
    const finish = (success, outcome, detail = {}) => {
        const evidence = {
            kind: 'tactical_combat',
            outcome,
            target: lastTarget,
            considered: decisions.at(-1)?.considered || 0,
            decisions,
            verifiedHits,
            rangedShots,
            shieldWindows,
            retreats,
            healthBefore: startedHealth,
            healthAfter: Math.max(0, Number(bot.health) || 0),
            alive: (Number(bot.health) || 0) > 0,
            retryable: !success && !bot.interrupt_code,
            ...detail,
        };
        setActionEvidence(bot, evidence);
        return success;
    };

    bot.modes.pause('self_defense');
    bot.modes.pause('cowardice');
    try {
        while (!bot.interrupt_code && steps < MAX_TACTICAL_COMBAT_STEPS && (Number(bot.health) || 0) > 0) {
            const snapshot = tacticalCombatSnapshot(bot, requestedRange, attributedEntityId);
            const decision = chooseTacticalCombatDecision(snapshot);
            if (!decision.selected) {
                log(bot, verifiedHits > 0
                    ? `Area secured after ${verifiedHits} verified combat hit${verifiedHits === 1 ? '' : 's'}.`
                    : 'No loaded hostile requires a tactical response.');
                return finish(true, verifiedHits > 0 ? 'secured' : 'area_already_secure', { steps });
            }

            const selected = decision.selected;
            const entity = bot.entities?.[selected.id];
            lastTarget = { name: selected.name, id: selected.id };
            decisions.push({
                target: lastTarget,
                response: decision.response,
                reason: decision.reason,
                distance: Math.round(selected.distance * 10) / 10,
                considered: decision.considered,
            });
            log(bot, `Tactical choice: ${decision.response} against ${selected.name} (${decision.reason}).`);
            if (!entity?.position) {
                steps += 1;
                continue;
            }

            if (decision.response === 'retreat') {
                const before = bot.entity.position.distanceTo(entity.position);
                const retreated = await moveAwayFromEntity(bot, entity, selected.desiredRange);
                const after = entity.position
                    ? bot.entity.position.distanceTo(entity.position)
                    : selected.desiredRange;
                if (!retreated || after <= before + 0.5) {
                    log(bot, `Could not establish safer spacing from ${selected.name}.`);
                    return finish(false, bot.lastActionEvidence?.outcome || 'retreat_blocked', {
                        steps,
                        retreatDistanceBefore: before,
                        retreatDistanceAfter: after,
                    });
                }
                retreats += 1;
                log(bot, `Retreated from ${selected.name}; spacing increased from ${before.toFixed(1)} to ${after.toFixed(1)} blocks.`);
                return finish(true, 'retreated', {
                    steps: steps + 1,
                    retreatDistanceBefore: before,
                    retreatDistanceAfter: after,
                });
            }

            let attack = null;
            if (decision.response === 'ranged') {
                attack = await fireTacticalBow(bot, entity, selected.desiredRange);
                if (attack.confirmed) rangedShots += 1;
            } else {
                let approached = false;
                let approachFailure = 'melee_approach_blocked';
                if (decision.response === 'shield_melee') {
                    approachFailure = 'shielded_approach_blocked';
                    approached = await closeWithShield(bot, entity);
                    if (approached) shieldWindows += 1;
                } else {
                    approached = await closeForMelee(bot, entity);
                }
                if (!approached) {
                    const approach = bot.lastActionEvidence;
                    // Entity removal can arrive one or two server ticks after
                    // the final verified hit. Do not turn a physically defeated
                    // target into a retryable approach failure merely because
                    // that packet crossed this function boundary. This window
                    // verifies the same attempt; it does not launch another one.
                    await waitCombatWindow(bot, 150);
                    if (bot.interrupt_code) {
                        return finish(false, 'interrupted', { steps, retryable: false });
                    }
                    if (!bot.entities?.[selected.id]) {
                        steps += 1;
                        continue;
                    }
                    return finish(false, approachFailure, {
                        steps,
                        approach,
                    });
                }
                const attacked = await attackEntity(bot, entity, false);
                attack = {
                    confirmed: attacked,
                    outcome: bot.lastActionEvidence?.outcome || (attacked ? 'hit_observed' : 'melee_blocked'),
                };
                if (attacked && decision.response === 'shield_melee' && bot.entities?.[entity.id]) {
                    if (await holdShield(bot, TACTICAL_SHIELD_WINDOW_MS)) shieldWindows += 1;
                }
            }

            if (!attack.confirmed) {
                if (!bot.entities?.[selected.id]) {
                    steps += 1;
                    continue;
                }
                if ([
                    'out_of_reach',
                    'target_lost',
                    'target_obscured',
                    'unreachable',
                ].includes(attack.outcome)) {
                    steps += 1;
                    await waitCombatWindow(bot, 150);
                    continue;
                }
                log(bot, `Tactical ${decision.response} against ${selected.name} was not verified (${attack.outcome}).`);
                return finish(false, attack.outcome || 'attack_unverified', { steps });
            }
            verifiedHits += 1;
            steps += 1;
            if (bot.entities?.[selected.id]) {
                await waitCombatWindow(bot, DEFENSE_SWING_INTERVAL_MS);
            }
        }

        if (bot.interrupt_code) {
            return finish(false, 'interrupted', { steps, retryable: false });
        }
        if ((Number(bot.health) || 0) <= 0) {
            return finish(false, 'died', { steps, retryable: false });
        }
        return finish(false, 'combat_limit_reached', { steps });
    } finally {
        try { bot.deactivateItem(); } catch { /* best-effort combat cleanup */ }
        try { bot.pvp?.stop?.(); } catch { /* best-effort combat cleanup */ }
    }
}


function performVerifiedMeleeHit(bot, entity, timeoutMs=ATTACK_CONFIRM_TIMEOUT_MS) {
    return new Promise(resolve => {
        let settled = false;
        let timeout = null;
        let interruptPoll = null;
        let lastUncreditedDamage = null;
        const targetId = entity?.id;

        const cleanup = () => {
            if (timeout) clearTimeout(timeout);
            if (interruptPoll) clearInterval(interruptPoll);
            try { bot.removeListener?.('entityHurt', onEntityHurt); } catch { /* best-effort listener cleanup */ }
            try { bot.removeListener?.('entityDead', onEntityDead); } catch { /* best-effort listener cleanup */ }
        };
        const finish = result => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(result);
        };
        const onEntityHurt = (hurtEntity, source) => {
            const observation = observeCombatDamage(bot, targetId, hurtEntity, source);
            if (!observation.matchesTarget) return;
            if (observation.confirmsBotHit) {
                finish({ confirmed: true, outcome: 'hit_attributed', attribution: observation });
                return;
            }
            lastUncreditedDamage = observation;
        };
        const onEntityDead = deadEntity => {
            if (deadEntity?.id === targetId) {
                finish({
                    confirmed: false,
                    outcome: lastUncreditedDamage?.attribution === 'foreign'
                        ? 'target_died_after_foreign_damage'
                        : 'target_died_unattributed',
                    attribution: lastUncreditedDamage,
                });
            }
        };

        bot.on('entityHurt', onEntityHurt);
        bot.on('entityDead', onEntityDead);
        timeout = setTimeout(() => {
            finish({
                confirmed: false,
                outcome: bot.interrupt_code
                    ? 'interrupted'
                    : lastUncreditedDamage?.code || 'damage_unconfirmed',
                attribution: lastUncreditedDamage,
            });
        }, timeoutMs);
        interruptPoll = setInterval(() => {
            if (bot.interrupt_code) {
                finish({ confirmed: false, outcome: 'interrupted' });
            }
        }, ATTACK_INTERRUPT_POLL_MS);

        try {
            bot.attack(entity);
        } catch (error) {
            finish({
                confirmed: false,
                outcome: 'attack_blocked',
                error: String(error?.message || error).slice(0, 240),
            });
        }
    });
}

export async function attackNearest(bot, mobType, kill=true) {
    /**
     * Attack mob of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} mobType, the type of mob to attack.
     * @param {boolean} kill, whether or not to continue attacking until the mob is dead. Defaults to true.
     * @returns {Promise<boolean>} true if the mob was attacked, false if the mob type was not found.
     * @example
     * await skills.attackNearest(bot, "zombie", true);
     **/
    bot.modes.pause('cowardice');
    const mob = world.getNearbyEntities(bot, 24).find(entity => entity.name === mobType);
    if (mob) {
        return await attackEntity(bot, mob, kill);
    }
    log(bot, 'Could not find any '+mobType+' to attack.');
    return false;
}

export async function attackEntity(bot, entity, kill=true) {
    /**
     * Attack mob of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {Entity} entity, the entity to attack.
     * @returns {Promise<boolean>} true if the entity was attacked, false if interrupted
     * @example
     * await skills.attackEntity(bot, entity);
     **/

    if (!entity?.position) {
        setActionEvidence(bot, { kind: 'combat', outcome: 'missing_target', retryable: false });
        log(bot, 'Cannot attack: the target is no longer available.');
        return false;
    }

    const target = { name: entity.username || entity.name || 'entity', id: entity.id };
    let pos = entity.position.clone();
    if (bot.interrupt_code) {
        setActionEvidence(bot, { kind: 'combat', outcome: 'interrupted', target, retryable: false });
        return false;
    }
    try {
        await equipHighestAttack(bot);
    } catch (error) {
        const message = String(error?.message || error).slice(0, 240);
        setActionEvidence(bot, { kind: 'combat', outcome: 'equipment_failed', target, error: message, retryable: true });
        log(bot, `Could not prepare a weapon for ${target.name}: ${message}.`);
        return false;
    }

    if (!kill) {
        if (bot.interrupt_code) {
            setActionEvidence(bot, { kind: 'combat', outcome: 'interrupted', target, retryable: false });
            return false;
        }
        if (bot.entity.position.distanceTo(pos) > MAX_MELEE_REACH) {
            console.log('moving to mob...')
            if (!await goToPosition(bot, pos.x, pos.y, pos.z)) {
                const interrupted = Boolean(bot.interrupt_code);
                setActionEvidence(bot, {
                    kind: 'combat',
                    outcome: interrupted ? 'interrupted' : 'unreachable',
                    target,
                    retryable: !interrupted,
                });
                return false;
            }
        }
        if (!entity.position || !bot.entities?.[entity.id]) {
            setActionEvidence(bot, { kind: 'combat', outcome: 'target_lost', target, retryable: true });
            log(bot, `Cannot attack ${target.name}: target left verified world state.`);
            return false;
        }
        const distance = bot.entity.position.distanceTo(entity.position);
        if (distance > MAX_MELEE_REACH) {
            setActionEvidence(bot, { kind: 'combat', outcome: 'out_of_reach', target, retryable: true });
            log(bot, `Cannot attack ${target.name}: target is ${distance.toFixed(1)} blocks away.`);
            return false;
        }

        try {
            const targetHeight = Number.isFinite(entity.height)
                ? Math.max(0.5, entity.height * 0.5)
                : 0.75;
            await bot.lookAt(entity.position.offset(0, targetHeight, 0), true);
            const visibleEntity = bot.entityAtCursor?.(MAX_MELEE_REACH + 0.3);
            if (visibleEntity?.id !== entity.id) {
                setActionEvidence(bot, { kind: 'combat', outcome: 'target_obscured', target, distance, retryable: true });
                log(bot, `Cannot attack ${target.name}: another entity or block obscures the target.`);
                return false;
            }
        } catch (error) {
            const message = String(error?.message || error).slice(0, 240);
            setActionEvidence(bot, { kind: 'combat', outcome: 'visibility_failed', target, error: message, retryable: true });
            log(bot, `Could not verify a clear attack on ${target.name}: ${message}.`);
            return false;
        }

        if (bot.interrupt_code) {
            setActionEvidence(bot, { kind: 'combat', outcome: 'interrupted', target, retryable: false });
            return false;
        }
        if (!entity.position || bot.entity.position.distanceTo(entity.position) > MAX_MELEE_REACH) {
            setActionEvidence(bot, { kind: 'combat', outcome: 'out_of_reach', target, retryable: true });
            log(bot, `Cannot attack ${target.name}: target moved out of reach.`);
            return false;
        }

        console.log('attacking mob...')
        const attack = await performVerifiedMeleeHit(bot, entity);
        if (!attack.confirmed) {
            const retryable = attack.outcome !== 'interrupted' && attack.outcome !== 'target_died_unattributed';
            setActionEvidence(bot, {
                kind: 'combat',
                outcome: attack.outcome,
                target,
                ...(attack.error ? { error: attack.error } : {}),
                retryable,
            });
            const message = attack.outcome === 'interrupted'
                ? `Stopped attacking ${target.name}.`
                : attack.outcome === 'target_died_unattributed'
                    ? `${target.name} died, but this bot's hit was not verified.`
                    : attack.outcome === 'hurt_unattributed'
                        ? `${target.name} was hurt, but Minecraft did not attribute the damage to this bot.`
                        : attack.outcome === 'attack_blocked'
                            ? `Could not attack ${target.name}: ${attack.error}.`
                            : `Minecraft did not confirm damage to ${target.name}.`;
            log(bot, message);
            return false;
        }

        setActionEvidence(bot, { kind: 'combat', outcome: attack.outcome, target, distance, retryable: false });
        return true;
    }
    else {
        let targetDied = false;
        let botAttributedHits = 0;
        let foreignAttributedHits = 0;
        let unknownAttributedHits = 0;
        let lastDamageAttribution = 'unknown';
        const onEntityHurt = (hurtEntity, source) => {
            const observation = observeCombatDamage(bot, entity.id, hurtEntity, source);
            if (!observation.matchesTarget) return;
            lastDamageAttribution = observation.attribution;
            if (observation.attribution === 'bot') botAttributedHits += 1;
            else if (observation.attribution === 'foreign') foreignAttributedHits += 1;
            else unknownAttributedHits += 1;
        };
        const onEntityDead = deadEntity => {
            if (deadEntity?.id !== entity.id) return;
            targetDied = true;
        };
        const startedAt = Date.now();
        bot.on('entityHurt', onEntityHurt);
        bot.on('entityDead', onEntityDead);

        try {
            bot.pvp.attack(entity);
            while (!targetDied && Date.now() - startedAt < MAX_PVP_ENGAGEMENT_MS) {
                await interruptibleDelay(bot, 1_000);
                if (bot.interrupt_code) {
                    setActionEvidence(bot, { kind: 'combat', outcome: 'interrupted', target, retryable: false });
                    return false;
                }
                if (!bot.entities?.[entity.id]) break;
            }

            if (!targetDied) {
                const timedOut = Date.now() - startedAt >= MAX_PVP_ENGAGEMENT_MS;
                setActionEvidence(bot, {
                    kind: 'combat',
                    outcome: timedOut ? 'combat_timeout' : 'target_lost',
                    target,
                    elapsedMs: Date.now() - startedAt,
                    retryable: true,
                });
                log(bot, timedOut
                    ? `Stopped attacking ${target.name}: combat exceeded the safe time limit without a verified defeat.`
                    : `Stopped attacking ${target.name}: the target left verified world state before defeat was confirmed.`);
                return false;
            }

            if (botAttributedHits < 1 || lastDamageAttribution !== 'bot') {
                setActionEvidence(bot, {
                    kind: 'combat',
                    outcome: lastDamageAttribution === 'foreign'
                        ? 'target_died_after_foreign_damage'
                        : 'target_died_unattributed',
                    target,
                    botAttributedHits,
                    foreignAttributedHits,
                    unknownAttributedHits,
                    lastDamageAttribution,
                    elapsedMs: Date.now() - startedAt,
                    retryable: false,
                });
                log(bot, `${target.name} died, but Minecraft did not attribute the final damage to this bot.`);
                return false;
            }

            log(bot, `Successfully defeated ${target.name}.`);
            try {
                await pickupNearbyItems(bot);
            } catch (error) {
                console.warn(`[combat] Could not collect drops after defeating ${target.name}: ${String(error?.message || error).slice(0, 240)}`);
            }
            setActionEvidence(bot, {
                kind: 'combat',
                outcome: 'killed',
                target,
                observedHits: botAttributedHits,
                botAttributedHits,
                foreignAttributedHits,
                unknownAttributedHits,
                lastDamageAttribution,
                elapsedMs: Date.now() - startedAt,
                retryable: false,
            });
            return true;
        } catch (error) {
            setActionEvidence(bot, { kind: 'combat', outcome: 'attack_blocked', target, error: error.message, retryable: true });
            log(bot, `Could not attack ${target.name}: ${error.message}.`);
            return false;
        } finally {
            try { bot.removeListener?.('entityHurt', onEntityHurt); } catch { /* best-effort listener cleanup */ }
            try { bot.removeListener?.('entityDead', onEntityDead); } catch { /* best-effort listener cleanup */ }
            try { bot.pvp.stop(); } catch { /* best-effort combat cleanup */ }
        }
    }
}

export async function defendSelf(bot, range=9, attributedEntityId=null) {
    /**
     * Defend yourself from all nearby hostile mobs until there are no more.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} range, the range to look for mobs. Defaults to 8.
     * @returns {Promise<boolean>} true if the bot found any enemies and has killed them, false if no entities were found.
     * @example
     * await skills.defendSelf(bot);
     * **/
    const requestedRange = Math.max(2, Number(range) || 9);
    const targetFor = entity => ({
        name: entity?.username || entity?.name || 'entity',
        id: entity?.id,
    });
    const stopPvp = () => {
        try { bot.pvp?.stop?.(); } catch { /* best-effort plugin cleanup */ }
    };

    bot.modes.pause('self_defense');
    bot.modes.pause('cowardice');
    let swings = 0;
    let failures = 0;
    let lastTarget = null;

    try {
        while (!bot.interrupt_code && swings < MAX_DEFENSE_SWINGS) {
            const attributed = Number.isFinite(attributedEntityId)
                ? bot.entities?.[attributedEntityId]
                : null;
            const enemy = Number.isFinite(attributedEntityId)
                ? attributed?.position
                    && mc.isCombatSafeHostile(attributed)
                    && bot.entity.position.distanceTo(attributed.position) <= requestedRange
                    ? attributed
                    : null
                : world.getNearestEntityWhere(bot, entity => mc.isCombatSafeHostile(entity), requestedRange);
            if (!enemy) {
                if (swings > 0) {
                    setActionEvidence(bot, { kind: 'combat', outcome: 'secured', swings, target: lastTarget, retryable: false });
                    log(bot, `Defended successfully after ${swings} verified attack attempt${swings === 1 ? '' : 's'}.`);
                    return true;
                }
                setActionEvidence(bot, {
                    kind: 'combat',
                    outcome: Number.isFinite(attributedEntityId) ? 'attributed_threat_clear' : 'no_combat_safe_threat',
                    target: Number.isFinite(attributedEntityId) ? { id: attributedEntityId } : null,
                    retryable: false,
                });
                log(bot, Number.isFinite(attributedEntityId)
                    ? 'The attributed threat is no longer a loaded combat-safe hostile.'
                    : 'No combat-safe hostile mobs are nearby.');
                return false;
            }

            lastTarget = targetFor(enemy);
            const attacked = await attackEntity(bot, enemy, false);
            if (attacked) {
                swings += 1;
                failures = 0;
            } else {
                failures += 1;
                const prior = bot.lastActionEvidence || {};
                if (failures >= MAX_DEFENSE_FAILURES) {
                    setActionEvidence(bot, {
                        kind: 'combat',
                        outcome: prior.outcome || 'defense_blocked',
                        target: prior.target || lastTarget,
                        swings,
                        failures,
                        retryable: prior.retryable !== false,
                    });
                    log(bot, `Could not safely defend against ${lastTarget.name}: ${prior.outcome || 'attack blocked'}.`);
                    return false;
                }
            }

            await interruptibleDelay(bot, DEFENSE_SWING_INTERVAL_MS);
        }

        if (bot.interrupt_code) {
            setActionEvidence(bot, { kind: 'combat', outcome: 'interrupted', target: lastTarget, swings, retryable: false });
            return false;
        }

        setActionEvidence(bot, {
            kind: 'combat',
            outcome: 'threat_persists',
            target: lastTarget,
            swings,
            retryable: true,
        });
        log(bot, `Stopped defending after ${MAX_DEFENSE_SWINGS} attack attempts; the threat is still present.`);
        return false;
    } finally {
        stopPvp();
    }
}

export async function defendPlayer(bot, username, range=10) {
    companionContextFor(bot)?.setDirective?.('guard', username);
    log(bot, `Guarding ${username}; retaliation requires a fresh attributed hostile source.`);
    return await followPlayer(bot, username, normalizePlayerDistance(Math.min(3, Number(range) || 3), 3));
}



export async function collectBlock(bot, blockType, num=1, exclude=null, range=64, searchOptions={}) {
    /**
     * Collect one of the given block type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} blockType, the type of block to collect.
     * @param {number} num, the number of blocks to collect. Defaults to 1.
     * @param {list} exclude, a list of positions to exclude from the search. Defaults to null.
     * @returns {Promise<boolean>} true if the block was collected, false if the block type was not found.
     * @example
     * await skills.collectBlock(bot, "oak_log");
     **/
    if (num < 1) {
        setActionEvidence(bot, {
            kind: 'collect',
            outcome: 'invalid_request',
            target: { name: blockType || 'block' },
            requested: num,
            retryable: false,
        });
        log(bot, `Invalid number of blocks to collect: ${num}.`);
        return false;
    }
    let blocktypes = [blockType];
    if (blockType === 'coal' || blockType === 'diamond' || blockType === 'emerald' || blockType === 'iron' || blockType === 'gold' || blockType === 'lapis_lazuli' || blockType === 'redstone')
        blocktypes.push(blockType+'_ore');
    if (blockType.endsWith('ore'))
        blocktypes.push('deepslate_'+blockType);
    if (blockType === 'dirt')
        blocktypes.push('grass_block');
    if (blockType === 'cobblestone')
        blocktypes.push('stone');
    const allowNaturalRouteDigging = searchOptions?.allowNaturalRouteDigging === true
        || blockType === 'cobblestone'
        || blockType === 'stone'
        || blockType === 'deepslate'
        || blockType === 'ancient_debris'
        || blockType === 'obsidian'
        || blockType.endsWith('_ore');
    const isLiquid = blockType === 'lava' || blockType === 'water';
    const searchRange = Math.max(1, Math.min(512, Math.floor(Number(range) || 64)));
    const search = createCollectionSearch(bot, searchRange, searchOptions);
    const preferredPosition = searchOptions?.preferredPosition
        && [searchOptions.preferredPosition.x, searchOptions.preferredPosition.y, searchOptions.preferredPosition.z]
            .every(Number.isFinite)
        ? new Vec3(
            Math.floor(searchOptions.preferredPosition.x),
            Math.floor(searchOptions.preferredPosition.y),
            Math.floor(searchOptions.preferredPosition.z),
        )
        : null;
    const excludedPositions = Array.isArray(exclude)
        ? exclude.filter(position => (
            position
            && [position.x, position.y, position.z].every(Number.isFinite)
        ))
        : [];

    let collected = 0;
    let lowestCollectedTarget = null;

    const selectionMovements = collectionSafetyMovements(bot);
    bot.pathfinder.setMovements(safeMovements(bot));

    for (let i=0; i<num; i++) {
        const targetMatches = block => {
            if (!blocktypes.includes(block?.name)) return false;
            if (!block.position) return true;
            if (collectionPositionExcluded(block.position, excludedPositions)) return false;
            if (isLiquid) return block.metadata === 0;
            return selectionMovements.safeToBreak(block);
        };
        const preferredBlock = preferredPosition ? bot.blockAt(preferredPosition) : null;
        const blocks = preferredPosition
            ? targetMatches(preferredBlock) ? [preferredBlock] : []
            : allowNaturalRouteDigging
                ? findStableMiningCollectionCandidates(bot, targetMatches, searchRange)
                : world.getNearestBlocksWhere(
                    bot,
                    targetMatches,
                    searchRange,
                    MAX_COLLECTION_CANDIDATES,
                );

        if (blocks.length === 0) {
            if (await relocateCollectionSearch(bot, blockType, search)) {
                i -= 1;
                continue;
            }
            if (collected === 0) {
                setActionEvidence(bot, {
                    kind: 'collect',
                    outcome: 'resource_not_found',
                    target: { name: blockType },
                    count: 0,
                    search: collectionSearchEvidence(bot, search),
                    retryable: true,
                });
            }
            if (collected === 0)
                log(bot, search.relocationEnabled
                    ? `No ${blockType} was found after ${search.relocations + 1} safely reached search areas.`
                    : `No ${blockType} found within ${searchRange} blocks.`);
            else
                log(bot, search.relocationEnabled
                    ? `No more ${blockType} was found after ${search.relocations + 1} safely reached search areas.`
                    : `No more ${blockType} found within ${searchRange} blocks.`);
            break;
        }
        const selection = preferredPosition
            ? (() => {
                const routeMovements = targetScopedCollectionMovements(bot, preferredBlock, {
                    allowPillars: searchOptions?.allowPillars === true,
                    allowNaturalRouteDigging,
                });
                const ranked = rankCollectionCandidates(collectionCandidateObservations(
                    bot,
                    blocks,
                    routeMovements,
                    false,
                    { stableMiningStance: allowNaturalRouteDigging },
                ).map(candidate => ({
                    ...candidate,
                    routeStatus: candidate.safeStances?.length > 0
                        ? 'explicit_target'
                        : candidate.routeStatus,
                })));
                return {
                    selected: ranked.find(candidate => candidate.reachable) || null,
                    ranked,
                    descentFallback: null,
                };
            })()
            : selectCollectionCandidate(
                bot,
                blocks,
                allowNaturalRouteDigging ? miningMovements(bot) : safeMovements(bot),
                { stableMiningStance: allowNaturalRouteDigging },
            );
        if (!selection.selected) {
            const recoveredAccess = (
                searchOptions?.allowAccessRecovery !== false
                && await recoverCollectionAccess(bot, blockType, selection, search, {
                    allowNaturalRouteDigging,
                })
            );
            if (recoveredAccess) {
                i -= 1;
                continue;
            }
            if (bot.lastActionEvidence?.kind === 'collect' && bot.lastActionEvidence.outcome === 'missing_tool') {
                return false;
            }
            const miningFailure = (
                bot.lastActionEvidence?.kind === 'mining_search'
                && [
                    bot.lastActionEvidence?.target?.x,
                    bot.lastActionEvidence?.target?.y,
                    bot.lastActionEvidence?.target?.z,
                ].every(Number.isFinite)
            ) ? bot.lastActionEvidence : null;
            setActionEvidence(bot, {
                kind: 'collect',
                outcome: 'unreachable',
                target: miningFailure ? {
                    ...miningFailure.target,
                    decision: collectionDecisionEvidence(selection),
                } : {
                    name: blockType,
                    decision: collectionDecisionEvidence(selection),
                },
                ...(miningFailure ? { accessOutcome: miningFailure.outcome } : {}),
                ...(miningFailure?.toolRequirement
                    ? { toolRequirement: miningFailure.toolRequirement }
                    : {}),
                retryable: true,
            });
            const rejectionSummary = collectionRejectionSummary(selection);
            log(
                bot,
                `Found ${blocks.length} ${blockType} candidate${blocks.length === 1 ? '' : 's'}, but none has a safe reachable route`
                + `${rejectionSummary ? ` (${rejectionSummary})` : ''}.`,
            );
            break;
        }
        const block = selection.selected.block;
        const nearest = blocks[0];
        const decision = collectionDecisionEvidence(selection);
        const target = {
            name: block.name,
            x: block.position.x,
            y: block.position.y,
            z: block.position.z,
            decision,
        };
        if (!sameBlockPosition(block, nearest)) {
            log(
                bot,
                `Selected ${block.name} at ${target.x}, ${target.y}, ${target.z} over the nearer candidate `
                + `(${decision.routeStatus} route, score ${decision.score}).`,
            );
        }
        const expectedDropTypes = new Set(
            (Array.isArray(block.drops) ? block.drops : [])
                .filter(type => Number.isInteger(type)),
        );
        if (!isLiquid && expectedDropTypes.size === 0) {
            setActionEvidence(bot, {
                kind: 'collect',
                outcome: 'no_collectible_drop',
                target,
                retryable: false,
            });
            log(bot, `${block.name} does not provide a collectible drop with the current game data.`);
            return false;
        }
        const hasFreeSlot = bot.inventory.emptySlotCount() > 0;
        const hasPotentialStackSpace = bot.inventory.items().some(item => (
            expectedDropTypes.has(item.type)
            && Number.isFinite(item.stackSize)
            && item.count < item.stackSize
        ));
        if (expectedDropTypes.size > 0 && !hasFreeSlot && !hasPotentialStackSpace) {
            setActionEvidence(bot, { kind: 'collect', outcome: 'inventory_full', target, retryable: true });
            log(bot, `Cannot collect ${block.name}: inventory has no slot or matching stack space for its drop.`);
            return false;
        }
        try {
            await equipBestToolForBlock(bot, block);
        } catch (err) {
            setActionEvidence(bot, { kind: 'collect', outcome: 'missing_tool', target, error: err.message, retryable: true });
            log(bot, `Could not prepare a tool for ${block.name}: ${err.message}.`);
            return false;
        }
        if (isLiquid) {
            const bucket = bot.inventory.findInventoryItem('bucket');
            if (!bucket) {
                setActionEvidence(bot, {
                    kind: 'collect',
                    outcome: 'missing_tool',
                    target,
                    tool: 'bucket',
                    retryable: true,
                });
                log(bot, `Don't have bucket to harvest ${blockType}.`);
                return false;
            }
            await bot.equip(bucket, 'hand');
        }
        const itemId = bot.heldItem ? bot.heldItem.type : null
        if (!block.canHarvest(itemId)) {
            setActionEvidence(bot, { kind: 'collect', outcome: 'missing_tool', target, retryable: true });
            log(bot, `Don't have right tools to harvest ${blockType}.`);
            return false;
        }
        let beforeTargetDropCount = null;
        try {
            if (!isLiquid) {
                beforeTargetDropCount = inventoryCountByTypes(bot, expectedDropTypes);
            }
            let success = false;
            if (isLiquid) {
                success = await useToolOnBlock(bot, 'bucket', block);
            }
            else if (mc.mustCollectManually(blockType)) {
                const reached = await goToPosition(bot, block.position.x, block.position.y, block.position.z, 2);
                if (!reached || bot.entity.position.distanceTo(block.position) > 4.5) {
                    const navigation = bot.lastActionEvidence?.kind === 'movement'
                        ? bot.lastActionEvidence
                        : null;
                    setActionEvidence(bot, {
                        kind: 'collect',
                        outcome: navigation?.outcome || 'unreachable',
                        target,
                        ...(navigation?.progress ? { progress: navigation.progress } : {}),
                        retryable: true,
                    });
                    log(bot, `Cannot reach ${block.name} to collect it.`);
                    return false;
                }
                await runBoundedCollectionOperation(
                    bot,
                    () => bot.dig(block),
                    () => bot.stopDigging(),
                );
                const remaining = bot.blockAt(block.position);
                if (!remaining || remaining.name === block.name) {
                    setActionEvidence(bot, { kind: 'collect', outcome: 'not_broken', target, retryable: true });
                    log(bot, `Could not verify that ${block.name} was collected.`);
                    return false;
                }
                if (!await waitForExpectedDropPickup(bot, expectedDropTypes, beforeTargetDropCount)) {
                    setActionEvidence(bot, { kind: 'collect', outcome: 'not_collected', target, retryable: true });
                    return false;
                }
                success = true;
            }
            else {
                bot.modes.pause('unstuck');
                bot.modes.pause('elbow_room');
                try {
                    let liveTarget = bot.blockAt(block.position);
                    let miningAssessment = allowNaturalRouteDigging
                        ? assessStableMiningCollectionTarget(bot, liveTarget)
                        : null;
                    let directReach = liveTarget?.type === block.type
                        && bot.entity.position.distanceTo(block.position) <= 4.5
                        // The mining assessment already raycasts the exact
                        // stable stance; canSeeBlock is unreliable for adjacent
                        // blocks below eye height and must not veto that proof.
                        && (miningAssessment
                            ? (
                                miningAssessment.safe
                                && isAtCollectionStance(bot, miningAssessment.stances)
                            )
                            : bot.canSeeBlock?.(liveTarget));
                    if (!directReach && allowNaturalRouteDigging) {
                        if (!miningAssessment?.safe) {
                            setActionEvidence(bot, {
                                kind: 'collect',
                                outcome: miningAssessment?.code || 'no_safe_stance',
                                target,
                                retryable: true,
                            });
                            log(bot, `Cannot safely collect ${block.name}: ${miningAssessment?.code || 'no safe stance'}.`);
                            return false;
                        }
                        const approachGoal = collectionApproachGoal(miningAssessment.stances);
                        let reached = false;
                        let approachNavigation = null;
                        try {
                            reached = await goToGoal(bot, approachGoal, {
                                movements: () => collectionApproachMovements(bot),
                                stallTimeoutMs: 12_000,
                                allowHealthBoundedDescent: false,
                                allowLocalRecovery: false,
                            });
                        } finally {
                            bot.pathfinder.setMovements(safeMovements(bot));
                        }
                        approachNavigation = bot.lastActionEvidence?.kind === 'movement'
                            ? bot.lastActionEvidence
                            : null;
                        liveTarget = bot.blockAt(block.position);
                        miningAssessment = liveTarget?.type === block.type
                            ? assessStableMiningCollectionTarget(bot, liveTarget)
                            : null;
                        directReach = reached
                            && liveTarget?.type === block.type
                            && miningAssessment?.safe
                            && isAtCollectionStance(bot, miningAssessment.stances)
                            && bot.entity.position.distanceTo(block.position) <= 4.5;
                        if (!directReach) {
                            const outcome = bot.interrupt_code
                                ? 'interrupted'
                                : approachNavigation?.outcome
                                    || (!miningAssessment?.safe ? miningAssessment?.code : null)
                                    || 'unreachable';
                            setActionEvidence(bot, {
                                kind: 'collect',
                                outcome,
                                target,
                                ...(approachNavigation?.progress ? { progress: approachNavigation.progress } : {}),
                                retryable: outcome !== 'interrupted',
                            });
                            log(bot, bot.interrupt_code
                                ? `Stopped before collecting ${block.name}.`
                                : `No verified stable stance reached ${block.name}.`);
                            return false;
                        }
                    }
                    if (
                        !directReach
                        && searchOptions?.allowPillars !== true
                        && !allowNaturalRouteDigging
                    ) {
                        const reached = await goToPosition(
                            bot,
                            block.position.x,
                            block.position.y,
                            block.position.z,
                            3,
                        );
                        if (!reached) {
                            const navigation = bot.lastActionEvidence?.kind === 'movement'
                                ? bot.lastActionEvidence
                                : null;
                            setActionEvidence(bot, {
                                kind: 'collect',
                                outcome: navigation?.outcome || 'unreachable',
                                target,
                                ...(navigation?.progress ? { progress: navigation.progress } : {}),
                                retryable: true,
                            });
                            log(bot, navigation?.outcome === 'path_stalled'
                                ? `Stopped the stalled route to ${block.name}; another target can be selected.`
                                : `Cannot reach ${block.name} to collect it.`);
                            return false;
                        }
                        liveTarget = bot.blockAt(block.position);
                        directReach = reached
                            && liveTarget?.type === block.type
                            && bot.entity.position.distanceTo(block.position) <= 4.5
                            && bot.canSeeBlock?.(liveTarget);
                    }
                    // Target selection and safe-stance proof are ours; moving,
                    // digging, and collecting the explicit target belong to
                    // Collect Block. Its movement object is target-scoped
                    // because the plugin requires canDig=true and mutates it.
                    bot.collectBlock.movements = targetScopedCollectionMovements(bot, block, {
                        allowPillars: searchOptions?.allowPillars === true,
                        allowNaturalRouteDigging,
                    });
                    try {
                        await runBoundedCollectionOperation(
                            bot,
                            () => bot.collectBlock.collect(block),
                            () => bot.collectBlock.cancelTask(),
                        );
                    } finally {
                        const routeMovements = safeMovements(bot);
                        bot.collectBlock.movements = routeMovements;
                        bot.pathfinder.setMovements(routeMovements);
                    }
                } finally {
                    bot.modes.unpause('unstuck');
                    bot.modes.unpause('elbow_room');
                }
                if (bot.interrupt_code) {
                    setActionEvidence(bot, {
                        kind: 'collect',
                        outcome: 'interrupted',
                        target,
                        retryable: false,
                    });
                    return false;
                }
                const remaining = bot.blockAt(block.position);
                if (!remaining) {
                    setActionEvidence(bot, {
                        kind: 'collect',
                        outcome: 'target_unloaded',
                        target,
                        retryable: true,
                    });
                    log(bot, `Could not verify ${block.name}; its chunk is no longer loaded.`);
                    return false;
                }
                if (remaining?.type === block.type) {
                    const distance = bot.entity?.position?.distanceTo(block.position);
                    const outcome = Number.isFinite(distance) && distance > 4.5
                        ? 'unreachable'
                        : 'not_broken';
                    setActionEvidence(bot, {
                        kind: 'collect',
                        outcome,
                        target,
                        distance: Number.isFinite(distance) ? distance : null,
                        retryable: true,
                    });
                    log(bot, outcome === 'unreachable'
                        ? `Could not reach ${block.name}; it is still ${Math.round(distance)} blocks away.`
                        : `Collection returned without breaking ${block.name}.`);
                    return false;
                }
                let afterDropCount = inventoryCountByTypes(bot, expectedDropTypes);
                if (expectedDropTypes.size > 0 && afterDropCount <= beforeTargetDropCount) {
                    await waitForExpectedDropPickup(bot, expectedDropTypes, beforeTargetDropCount);
                    afterDropCount = inventoryCountByTypes(bot, expectedDropTypes);
                }
                if (expectedDropTypes.size > 0 && afterDropCount <= beforeTargetDropCount) {
                    setActionEvidence(bot, {
                        kind: 'collect',
                        outcome: 'not_collected',
                        target,
                        beforeCount: beforeTargetDropCount,
                        afterCount: afterDropCount,
                        retryable: true,
                    });
                    log(bot, `${block.name} was broken, but its drop did not enter this bot's inventory.`);
                    return false;
                }
                success = true;
            }
            if (success) {
                collected++;
                if (
                    !lowestCollectedTarget
                    || target.y < lowestCollectedTarget.y
                ) lowestCollectedTarget = target;
            }
            await autoLight(bot);
        }
        catch (err) {
            // mineflayer-collectblock can time out while finalizing its path
            // after Minecraft has already broken the target and delivered the
            // drop. Reconcile against both facts before reporting failure or
            // retrying a now-stale block position.
            const remaining = bot.blockAt(block.position);
            const afterDropCount = inventoryCountByTypes(bot, expectedDropTypes);
            if (
                !isLiquid
                && beforeTargetDropCount !== null
                && remaining
                && remaining.type !== block.type
                && afterDropCount > beforeTargetDropCount
            ) {
                collected += 1;
                if (!lowestCollectedTarget || target.y < lowestCollectedTarget.y) {
                    lowestCollectedTarget = target;
                }
                setActionEvidence(bot, {
                    kind: 'collect',
                    outcome: 'collected',
                    target,
                    count: 1,
                    retryable: false,
                    recoveredFrom: collectionErrorOutcome(err),
                });
                log(bot, `Collected ${block.name}; reconciled the verified drop after the path helper timed out.`);
                await autoLight(bot);
                continue;
            }
            if (err.name === 'NoChests') {
                setActionEvidence(bot, { kind: 'collect', outcome: 'inventory_full', target, retryable: true });
                log(bot, `Failed to collect ${blockType}: Inventory full, no place to deposit.`);
                return false;
            }
            else {
                const outcome = collectionErrorOutcome(err);
                setActionEvidence(bot, {
                    kind: 'collect',
                    outcome,
                    target,
                    error: String(err?.message || err).slice(0, 240),
                    retryable: true,
                });
                log(bot, `Failed to collect ${blockType}: ${err?.message || err}.`);
                return false;
            }
        }
        
        if (bot.interrupt_code)
            break;  
    }
    if (collected > 0) {
        setActionEvidence(bot, {
            kind: 'collect',
            outcome: 'collected',
            target: lowestCollectedTarget || { name: blockType },
            count: collected,
            search: collectionSearchEvidence(bot, search),
            retryable: false,
        });
    } else if (bot.lastActionEvidence?.kind !== 'collect') {
        setActionEvidence(bot, {
            kind: 'collect',
            outcome: 'not_collected',
            target: { name: blockType },
            count: 0,
            retryable: true,
        });
    }
    log(bot, `Collected ${collected} ${blockType}.`);
    return collected > 0;
}

const WOOD_BLOCK_TYPES = Object.freeze([
        'oak_log',
        'spruce_log',
        'birch_log',
        'jungle_log',
        'acacia_log',
        'dark_oak_log',
        'mangrove_log',
        'cherry_log',
        'pale_oak_log',
        'crimson_stem',
        'warped_stem',
]);

export function isWoodBlockType(blockType) {
    return WOOD_BLOCK_TYPES.includes(String(blockType || '').trim());
}

const NATURAL_TREE_SUPPORTS = new Set([
    'grass_block', 'dirt', 'coarse_dirt', 'podzol', 'mycelium', 'rooted_dirt',
    'mud', 'muddy_mangrove_roots', 'mangrove_roots', 'moss_block', 'sand', 'red_sand',
    'crimson_nylium', 'warped_nylium', 'netherrack',
]);
const MAX_TREE_LOGS = 64;
const TREE_HORIZONTAL_RADIUS = 6;
const TREE_VERTICAL_RADIUS = 32;
const TREE_NEIGHBORS = Object.freeze((() => {
    const offsets = [];
    for (let x = -1; x <= 1; x++) {
        for (let y = -1; y <= 1; y++) {
            for (let z = -1; z <= 1; z++) {
                if (x !== 0 || y !== 0 || z !== 0) offsets.push([x, y, z]);
            }
        }
    }
    return offsets;
})());

function blockPositionKey(position) {
    return `${position.x}:${position.y}:${position.z}`;
}

function treeCanopyBlock(name) {
    return String(name || '').endsWith('_leaves')
        || ['nether_wart_block', 'warped_wart_block', 'shroomlight'].includes(name);
}

function discoverNaturalTree(bot, seedBlock) {
    if (!seedBlock?.position || !WOOD_BLOCK_TYPES.includes(seedBlock.name)) {
        return { natural: false, logs: seedBlock ? [seedBlock] : [], base: null };
    }
    const seed = seedBlock.position;
    const queue = [seed.clone()];
    const queued = new Set([blockPositionKey(seed)]);
    const logs = [];
    while (queue.length > 0 && logs.length < MAX_TREE_LOGS) {
        const position = queue.shift();
        const block = bot.blockAt(position);
        if (!block?.position || block.name !== seedBlock.name) continue;
        if (
            Math.abs(block.position.x - seed.x) > TREE_HORIZONTAL_RADIUS
            || Math.abs(block.position.z - seed.z) > TREE_HORIZONTAL_RADIUS
            || Math.abs(block.position.y - seed.y) > TREE_VERTICAL_RADIUS
        ) continue;
        logs.push(block);
        for (const [dx, dy, dz] of TREE_NEIGHBORS) {
            const next = block.position.offset(dx, dy, dz);
            const key = blockPositionKey(next);
            if (queued.has(key)) continue;
            queued.add(key);
            queue.push(next);
        }
    }
    if (logs.length === 0) return { natural: false, logs: [seedBlock], base: seedBlock.position };

    const minimumY = Math.min(...logs.map(block => block.position.y));
    const rooted = logs.filter(block => (
        block.position.y === minimumY
        && NATURAL_TREE_SUPPORTS.has(bot.blockAt(block.position.offset(0, -1, 0))?.name)
    ));
    const canopyCandidates = [...logs]
        .sort((left, right) => right.position.y - left.position.y)
        .slice(0, 12);
    const hasCanopy = canopyCandidates.some(block => {
        for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -1; dy <= 2; dy++) {
                for (let dz = -2; dz <= 2; dz++) {
                    if (treeCanopyBlock(bot.blockAt(block.position.offset(dx, dy, dz))?.name)) return true;
                }
            }
        }
        return false;
    });
    if (rooted.length === 0 || !hasCanopy) {
        return { natural: false, logs: [seedBlock], base: seedBlock.position };
    }

    const base = [...rooted].sort((left, right) => (
        bot.entity.position.distanceTo(left.position) - bot.entity.position.distanceTo(right.position)
    ))[0].position.clone();
    logs.sort((left, right) => (
        left.position.y - right.position.y
        || Math.hypot(left.position.x - base.x, left.position.z - base.z)
            - Math.hypot(right.position.x - base.x, right.position.z - base.z)
        || bot.entity.position.distanceTo(left.position) - bot.entity.position.distanceTo(right.position)
    ));
    return { natural: true, logs, base };
}

function carriedLogCount(bot, woodTypes=null) {
    return bot.inventory.items().reduce((total, item) => (
        /_(?:log|stem)$/.test(String(item?.name || ''))
            && (!(woodTypes instanceof Set) || woodTypes.has(item.name))
            ? total + Math.max(0, Number(item.count) || 0)
            : total
    ), 0);
}

function collectionCandidateShortlist(bot, blocks, collapseVerticalColumns = false) {
    let pool = blocks.filter(block => block?.position);
    if (collapseVerticalColumns) {
        const bases = new Map();
        for (const block of pool) {
            const key = `${block.position.x}:${block.position.z}`;
            const existing = bases.get(key);
            if (!existing || block.position.y < existing.position.y) bases.set(key, block);
        }
        pool = [...bases.values()];
    }
    if (pool.length <= MAX_COLLECTION_CANDIDATES) return pool;

    const position = bot.entity?.position;
    const distance = block => position?.distanceTo(block.position) ?? Number.POSITIVE_INFINITY;
    const vertical = block => Math.abs((position?.y ?? block.position.y) - block.position.y);
    const nearest = [...pool].sort((left, right) => distance(left) - distance(right));
    const level = [...pool].sort((left, right) => (
        vertical(left) - vertical(right)
        || distance(left) - distance(right)
    ));
    const selected = [];
    const selectedKeys = new Set();
    for (let index = 0; selected.length < MAX_COLLECTION_CANDIDATES; index += 1) {
        const pair = [nearest[index], level[index]];
        if (!pair.some(Boolean)) break;
        for (const block of pair) {
            if (!block || selected.length >= MAX_COLLECTION_CANDIDATES) continue;
            const key = `${block.position.x}:${block.position.y}:${block.position.z}`;
            if (selectedKeys.has(key)) continue;
            selectedKeys.add(key);
            selected.push(block);
        }
    }
    return selected;
}

function collectionPositionExcluded(position, exclusions) {
    if (!position) return false;
    return (exclusions || []).some(exclusion => {
        if (!exclusion || ![exclusion.x, exclusion.y, exclusion.z].every(Number.isFinite)) return false;
        const radius = Math.max(0, Math.min(16, Math.floor(Number(exclusion.radius) || 0)));
        return Math.max(
            Math.abs(position.x - exclusion.x),
            Math.abs(position.y - exclusion.y),
            Math.abs(position.z - exclusion.z),
        ) <= radius;
    });
}

function findCollectibleBlockSelection(bot, blockTypes, range=64, exclude=null, collapseVerticalColumns=false) {
    const allowed = blockTypes instanceof Set ? blockTypes : new Set(blockTypes);
    const movements = collectionSafetyMovements(bot);
    const scanned = world.getNearestBlocksWhere(
        bot,
        (block) => {
            if (!allowed.has(block?.name)) return false;
            if (!block.position) return true;
            return (
                movements.safeToBreak(block)
                && !collectionPositionExcluded(block.position, exclude)
            );
        },
        Math.max(1, Math.min(512, Number(range) || 64)),
        collapseVerticalColumns ? MAX_COLLECTION_SCAN_CANDIDATES : MAX_COLLECTION_CANDIDATES,
    ).filter(Boolean);
    const blocks = collectionCandidateShortlist(bot, scanned, collapseVerticalColumns);
    return { blocks, selection: selectCollectionCandidate(bot, blocks) };
}

export function findNearestCollectibleBlock(bot, blockTypes, range=64, exclude=null) {
    return findCollectibleBlockSelection(bot, blockTypes, range, exclude)
        .selection.selected?.block || null;
}

/**
 * Fell an already-discovered connected tree from one standing position.
 *
 * The slow path re-runs a full search-and-navigate for every single log. But
 * the whole trunk is already known, and from the base most of it sits inside
 * the 4.5-block reach, so `breakBlockAt` digs it in place and only re-paths for
 * a log genuinely out of reach. Logs it cannot reach come back in `remaining`
 * for the caller's per-log path, so nothing is lost -- this is purely faster.
 */
async function fellDiscoveredTree(bot, tree, woodTypes, maximumLogs = Number.POSITIVE_INFINITY) {
    const before = carriedLogCount(bot, woodTypes);
    const remaining = [];
    let broken = 0;
    if (tree?.base) {
        // One navigation to the trunk instead of one per log.
        try { await goToPosition(bot, tree.base.x, tree.base.y, tree.base.z, 2); } catch { /* dig from wherever we landed */ }
    }
    // Bottom-up: clearing the low logs first keeps the bot on the ground with
    // the rest of the trunk overhead and within reach.
    const ordered = [...(tree?.logs || [])].sort((left, right) => left.position.y - right.position.y);
    for (const logBlock of ordered) {
        if (bot.interrupt_code) break;
        if (broken >= maximumLogs) {
            remaining.push(logBlock);
            continue;
        }
        const position = logBlock.position;
        const live = bot.blockAt(position);
        if (!live || !woodTypes.has(live.name)) continue; // already felled or changed
        const broke = await breakBlockAt(bot, position.x, position.y, position.z);
        if (!broke) remaining.push(logBlock);
        else broken += 1;
    }
    try { await pickupNearbyItems(bot); } catch { /* drops get swept on the next pass */ }
    return { count: Math.max(0, carriedLogCount(bot, woodTypes) - before), remaining };
}

export async function collectWood(bot, num=1, range=64, exclude=null, searchOptions={}) {
    const requestedWoodType = String(searchOptions?.woodType || '').trim();
    if (requestedWoodType && !isWoodBlockType(requestedWoodType)) {
        setActionEvidence(bot, {
            kind: 'collect',
            outcome: 'invalid_request',
            target: { name: requestedWoodType },
            retryable: false,
        });
        log(bot, `${requestedWoodType} is not a supported log or stem block.`);
        return false;
    }
    const woodTypes = new Set(requestedWoodType ? [requestedWoodType] : WOOD_BLOCK_TYPES);
    const target = Math.max(1, Math.min(64, Number(num) || 1));
    const searchRange = Math.max(1, Math.min(512, Math.floor(Number(range) || 64)));
    const search = createCollectionSearch(bot, searchRange, searchOptions);
    const failedTargets = Array.isArray(exclude)
        ? exclude.filter(position => position && [position.x, position.y, position.z].every(Number.isFinite))
        : [];
    let collected = 0;
    let stumpTarget = null;
    let treeQueue = [];
    let naturalTreeActive = false;
    let currentTreeFailures = 0;
    let completeTrees = 0;

    // `num` is the action's physical bound. Exact work-order collection used
    // to keep draining the discovered tree queue after satisfying that bound,
    // turning a one-log prerequisite into a whole-tree action that could time
    // out after already making sufficient inventory progress.
    while (collected < target && !bot.interrupt_code) {
        let nearest = null;
        while (treeQueue.length > 0 && !nearest) {
            const planned = treeQueue.shift();
            const live = bot.blockAt(planned);
            if (live?.position && woodTypes.has(live.name)) nearest = live;
        }

        let candidates = null;
        if (!nearest) {
            if (collected >= target) break;
            candidates = findCollectibleBlockSelection(
                bot,
                woodTypes,
                searchRange,
                failedTargets,
                true,
            );
            nearest = candidates.selection.selected?.block || null;
            if (nearest) {
                const tree = discoverNaturalTree(bot, nearest);
                naturalTreeActive = tree.natural;
                currentTreeFailures = 0;
                if (tree.natural) {
                    stumpTarget = {
                        name: nearest.name,
                        x: tree.base.x,
                        y: tree.base.y,
                        z: tree.base.z,
                    };
                    log(bot, `Felling one connected ${tree.logs[0].name.replace('_log', '').replace('_stem', '')} tree with ${tree.logs.length} loaded logs.`);
                    if (requestedWoodType) {
                        // Exact work orders need per-block pickup verification;
                        // the family collector's fast fell only counts its haul
                        // after the entire connected tree has been processed.
                        treeQueue = tree.logs.map(block => block.position.clone());
                    } else {
                        // Fast path: fell the reachable trunk from one standing spot.
                        const felled = await fellDiscoveredTree(
                            bot,
                            tree,
                            woodTypes,
                            Math.max(1, target - collected),
                        );
                        collected += felled.count;
                        if (collected >= target) {
                            naturalTreeActive = false;
                            treeQueue = [];
                            nearest = null;
                            continue;
                        }
                        if (felled.count > 0 && felled.remaining.length === 0) {
                            // Whole tree down in place. Record it and move on to the
                            // next one rather than re-pathing to logs already gone.
                            // Clear the seed: it has been felled, so the next pass
                            // must search fresh instead of collecting a gone block.
                            completeTrees += 1;
                            naturalTreeActive = false;
                            nearest = null;
                            continue;
                        }
                        // Only logs it could not reach fall back to the per-log path.
                        treeQueue = felled.remaining.map(block => block.position.clone());
                    }
                    naturalTreeActive = treeQueue.length > 0;
                    nearest = null;
                    while (treeQueue.length > 0 && !nearest) {
                        const planned = treeQueue.shift();
                        const live = bot.blockAt(planned);
                        if (live?.position && woodTypes.has(live.name)) nearest = live;
                    }
                }
            }
        }
        if (!nearest) {
            if (
                candidates?.blocks.length > 0
                && await recoverCollectionAccess(bot, 'trees', candidates.selection, search)
            ) continue;
            if ((candidates?.blocks.length || 0) === 0 && await relocateCollectionSearch(bot, 'trees', search)) continue;
            if (collected === 0) {
                setActionEvidence(bot, {
                    kind: 'collect',
                    outcome: candidates?.blocks.length > 0 ? 'unreachable' : 'resource_not_found',
                    target: search.lastAccessRecoveryTarget || { name: 'wood' },
                    count: 0,
                    search: collectionSearchEvidence(bot, search),
                    retryable: true,
                });
            }
            log(bot, collected
                ? `No more trees were found after collecting ${collected} logs across ${search.relocations + 1} search areas.`
                : candidates?.blocks.length > 0
                    ? `Found ${candidates.blocks.length} trees, but no bounded recovery reached a collectible trunk.`
                : search.relocationEnabled
                    ? `No safely collectible trees were found after ${search.relocations + 1} safely reached search areas.`
                    : `No safely collectible trees found within ${searchRange} blocks.`);
            break;
        }
        const beforeLogs = carriedLogCount(bot, woodTypes);
        const success = await collectBlock(
            bot,
            nearest.name,
            1,
            failedTargets,
            searchRange,
            {
                relocate: false,
                preferredPosition: nearest.position,
                allowPillars: naturalTreeActive,
            },
        );
        if (!success) {
            const failure = bot.lastActionEvidence;
            const failedTarget = [failure?.target?.x, failure?.target?.y, failure?.target?.z].every(Number.isFinite)
                ? failure.target
                : {
                    name: nearest.name,
                    x: nearest.position.x,
                    y: nearest.position.y,
                    z: nearest.position.z,
                };
            const retryAnotherTarget = (
                failure?.kind === 'collect'
                && failure.retryable !== false
                && RETRYABLE_COLLECTION_TARGET_OUTCOMES.has(failure.outcome)
                && [failedTarget?.x, failedTarget?.y, failedTarget?.z].every(Number.isFinite)
                && (
                    naturalTreeActive
                        ? currentTreeFailures < 6
                        : (search.candidateFailures || 0) < MAX_COLLECTION_TARGET_FAILURES
                )
            );
            if (retryAnotherTarget) {
                failedTargets.push({
                    x: failedTarget.x,
                    y: failedTarget.y,
                    z: failedTarget.z,
                });
                search.candidateFailures = (search.candidateFailures || 0) + 1;
                if (naturalTreeActive) currentTreeFailures += 1;
                log(
                    bot,
                    naturalTreeActive
                        ? `Skipping one blocked log at ${failedTarget.x}, ${failedTarget.y}, ${failedTarget.z}; continuing the same tree.`
                        : `Skipping the blocked tree at ${failedTarget.x}, ${failedTarget.y}, ${failedTarget.z}; `
                            + `trying another safe candidate (${search.candidateFailures}/${MAX_COLLECTION_TARGET_FAILURES}).`,
                );
                if (naturalTreeActive && treeQueue.length === 0) naturalTreeActive = false;
                continue;
            }
            break;
        }
        const collectedTarget = bot.lastActionEvidence?.target;
        if (
            [collectedTarget?.x, collectedTarget?.y, collectedTarget?.z].every(Number.isFinite)
            && (!stumpTarget || collectedTarget.y < stumpTarget.y)
        ) stumpTarget = collectedTarget;
        collected += Math.max(1, carriedLogCount(bot, woodTypes) - beforeLogs);
        if (naturalTreeActive && treeQueue.length === 0) {
            if (currentTreeFailures === 0) completeTrees += 1;
            naturalTreeActive = false;
        }
    }

    if (collected > 0) {
        setActionEvidence(bot, {
            kind: 'collect',
            outcome: 'collected',
            target: stumpTarget || { name: 'wood' },
            count: collected,
            completeTrees,
            search: collectionSearchEvidence(bot, search),
            retryable: false,
        });
    }
    log(bot, completeTrees > 0
        ? `Wood collection finished with ${collected} logs from ${completeTrees} complete tree${completeTrees === 1 ? '' : 's'}.`
        : `Wood collection finished with ${collected} logs.`);
    return collected > 0;
}

export async function pickupNearbyItems(bot) {
    /**
     * Pick up all nearby items.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the items were picked up, false otherwise.
     * @example
     * await skills.pickupNearbyItems(bot);
     **/
    const distance = 8;
    const getNearestItem = bot => bot.nearestEntity(entity => entity.name === 'item' && bot.entity.position.distanceTo(entity.position) < distance);
    let nearestItem = getNearestItem(bot);
    let pickedUp = 0;
    if (!nearestItem) {
        setActionEvidence(bot, { kind: 'pickup', outcome: 'no_items', retryable: false });
        log(bot, 'No nearby items to pick up.');
        return true;
    }
    while (nearestItem) {
        const target = { name: nearestItem.displayName || nearestItem.name || 'item', id: nearestItem.id };
        const reached = await approachDroppedItem(bot, nearestItem);
        if (!reached) {
            const outcome = bot.lastActionEvidence?.outcome || 'unreachable';
            setActionEvidence(bot, { kind: 'pickup', outcome, target, count: pickedUp, retryable: true });
            return false;
        }
        let prev = nearestItem;
        const pickupDeadline = Date.now() + 1_200;
        while (bot.entities?.[prev.id] === prev && Date.now() < pickupDeadline) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        nearestItem = getNearestItem(bot);
        if (bot.entities?.[prev.id] === prev) {
            setActionEvidence(bot, { kind: 'pickup', outcome: 'not_collected', target, count: pickedUp, retryable: true });
            log(bot, `Could not pick up ${target.name}.`);
            return false;
        }
        pickedUp++;
    }
    setActionEvidence(bot, { kind: 'pickup', outcome: 'picked_up', count: pickedUp, retryable: false });
    log(bot, `Picked up ${pickedUp} items.`);
    return true;
}

function usefulDroppedItem(bot, item) {
    const name = String(item?.name || '');
    return Boolean(
        (bot.registry?.foodsByName?.[name] && !UNSAFE_FOOD_ITEMS.has(name))
        || /_(?:pickaxe|axe|shovel|hoe|sword|helmet|chestplate|leggings|boots|log|stem|planks|sapling|seeds)$/.test(name)
        || name.startsWith('raw_')
        || /_(?:ore|ingot|nugget)$/.test(name)
        || [
            'coal',
            'charcoal',
            'diamond',
            'emerald',
            'redstone',
            'lapis_lazuli',
            'quartz',
            'torch',
            'soul_torch',
            'crafting_table',
            'furnace',
            'bucket',
            'water_bucket',
            'lava_bucket',
            'shield',
            'bow',
            'crossbow',
            'arrow',
        ].includes(name)
    );
}

export async function pickupUsefulItems(bot, range=12) {
    const distance = Math.max(4, Math.min(32, Number(range) || 12));
    const nearestUseful = () => {
        const candidates = [];
        for (const entity of Object.values(bot.entities || {})) {
            if (entity?.name !== 'item' || !entity.position) continue;
            const itemDistance = bot.entity.position.distanceTo(entity.position);
            if (itemDistance > distance) continue;
            let item;
            try {
                item = entity.getDroppedItem?.();
            } catch {
                continue;
            }
            if (!usefulDroppedItem(bot, item) || !hasInventoryRoomFor(bot, item.name)) continue;
            candidates.push({ entity, item, distance: itemDistance });
        }
        return candidates.sort((left, right) => left.distance - right.distance)[0] || null;
    };
    let pickedUp = 0;
    for (let attempt = 0; attempt < 12; attempt += 1) {
        if (bot.interrupt_code) {
            setActionEvidence(bot, {
                kind: 'useful_pickup',
                outcome: 'interrupted',
                count: pickedUp,
                retryable: false,
            });
            return false;
        }
        const hostile = bot.nearestEntity?.(entity => (
            mc.isHostile(entity)
            && entity?.position
            && bot.entity.position.distanceTo(entity.position) <= 10
        ));
        if (hostile) break;
        const candidate = nearestUseful();
        if (!candidate) break;
        const before = inventoryCount(bot, candidate.item.name);
        const reached = await approachDroppedItem(bot, candidate.entity);
        if (!reached) break;
        const deadline = Date.now() + 1_500;
        while (
            inventoryCount(bot, candidate.item.name) <= before
            && bot.entities?.[candidate.entity.id]
            && Date.now() < deadline
            && !bot.interrupt_code
        ) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (inventoryCount(bot, candidate.item.name) <= before) break;
        pickedUp += inventoryCount(bot, candidate.item.name) - before;
    }
    const success = pickedUp > 0;
    setActionEvidence(bot, {
        kind: 'useful_pickup',
        outcome: success ? 'picked_up' : 'no_reachable_items',
        count: pickedUp,
        retryable: false,
    });
    if (success) log(bot, `Picked up ${pickedUp} useful nearby items.`);
    return success;
}


export async function breakBlockAt(bot, x, y, z) {
    /**
     * Break the block at the given position. Will use the bot's equipped item.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} x, the x coordinate of the block to break.
     * @param {number} y, the y coordinate of the block to break.
     * @param {number} z, the z coordinate of the block to break.
     * @returns {Promise<boolean>} true if the block was broken, false otherwise.
     * @example
     * let position = world.getPosition(bot);
     * await skills.breakBlockAt(bot, position.x, position.y - 1, position.x);
     **/
    if (![x, y, z].every(Number.isFinite)) {
        setActionEvidence(bot, { kind: 'break', outcome: 'invalid_target', retryable: false });
        log(bot, 'Cannot break block: position is incomplete.');
        return false;
    }
    let block = bot.blockAt(Vec3(x, y, z));
    const target = { x, y, z };
    if (!block) {
        setActionEvidence(bot, { kind: 'break', outcome: 'target_unloaded', target, retryable: true });
        log(bot, `Cannot break block at x:${x}, y:${y}, z:${z}: chunk is not loaded.`);
        return false;
    }
    if (block.name !== 'air' && block.name !== 'water' && block.name !== 'lava') {
        target.name = block.name;
        if (isProtectedGameplayBlock(block)) {
            setActionEvidence(bot, { kind: 'break', outcome: 'protected_block', target, retryable: false });
            log(bot, `Refusing to break protected ${block.name} at x:${x}, y:${y}, z:${z}.`);
            return false;
        }
        if (bot.modes.isOn('cheat')) {
            if (useDelay) { await new Promise(resolve => setTimeout(resolve, blockPlaceDelay)); }
            let msg = '/setblock ' + Math.floor(x) + ' ' + Math.floor(y) + ' ' + Math.floor(z) + ' air';
            bot.chat(msg);
            setActionEvidence(bot, { kind: 'break', outcome: 'setblock_requested', completion: 'requested', target, retryable: false });
            log(bot, `Requested /setblock to break block at ${x}, ${y}, ${z}.`);
            return true;
        }

        if (bot.entity.position.distanceTo(block.position) > 4.5) {
            let pos = block.position;
            const reached = await goToGoal(bot, new pf.goals.GoalNear(pos.x, pos.y, pos.z, 4));
            if (!reached || bot.entity.position.distanceTo(block.position) > 4.5) {
                setActionEvidence(bot, { kind: 'break', outcome: 'unreachable', target, retryable: true });
                log(bot, `Cannot reach ${block.name} to break it.`);
                return false;
            }
        }
        if (bot.game.gameMode !== 'creative') {
            try {
                await equipBestToolForBlock(bot, block);
            } catch (err) {
                setActionEvidence(bot, { kind: 'break', outcome: 'missing_tool', target, error: err.message, retryable: true });
                log(bot, `Could not prepare a tool for ${block.name}: ${err.message}.`);
                return false;
            }
            const itemId = bot.heldItem ? bot.heldItem.type : null
            if (!block.canHarvest(itemId)) {
                setActionEvidence(bot, { kind: 'break', outcome: 'missing_tool', target, retryable: true });
                log(bot, `Don't have right tools to break ${block.name}.`);
                return false;
            }
        }
        try {
            await bot.dig(block, true);
        } catch (err) {
            setActionEvidence(bot, { kind: 'break', outcome: 'dig_blocked', target, error: err.message, retryable: true });
            log(bot, `Could not break ${block.name}: ${err.message}.`);
            return false;
        }
        const remaining = bot.blockAt(Vec3(x, y, z));
        if (!remaining || remaining.name === block.name) {
            setActionEvidence(bot, { kind: 'break', outcome: !remaining ? 'unverified' : 'not_broken', target, retryable: true });
            log(bot, `Could not verify that ${block.name} was broken.`);
            return false;
        }
        setActionEvidence(bot, { kind: 'break', outcome: 'broken', target, retryable: false });
        log(bot, `Broke ${block.name} at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);
    }
    else {
        setActionEvidence(bot, { kind: 'break', outcome: 'already_clear', target: { ...target, name: block.name }, retryable: false });
        log(bot, `Skipping block at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)} because it is ${block.name}.`);
        return false;
    }
    return true;
}

const PORTAL_FRAME_CELLS = Object.freeze([
    Object.freeze({ width: 1, height: 0 }),
    Object.freeze({ width: 2, height: 0 }),
    Object.freeze({ width: 0, height: 1 }),
    Object.freeze({ width: 0, height: 2 }),
    Object.freeze({ width: 0, height: 3 }),
    Object.freeze({ width: 3, height: 1 }),
    Object.freeze({ width: 3, height: 2 }),
    Object.freeze({ width: 3, height: 3 }),
    Object.freeze({ width: 1, height: 4 }),
    Object.freeze({ width: 2, height: 4 }),
]);

const PORTAL_INTERIOR_CELLS = Object.freeze([
    Object.freeze({ width: 1, height: 1 }),
    Object.freeze({ width: 2, height: 1 }),
    Object.freeze({ width: 1, height: 2 }),
    Object.freeze({ width: 2, height: 2 }),
    Object.freeze({ width: 1, height: 3 }),
    Object.freeze({ width: 2, height: 3 }),
]);

const PORTAL_CORNER_CELLS = Object.freeze([
    Object.freeze({ width: 0, height: 0 }),
    Object.freeze({ width: 3, height: 0 }),
    Object.freeze({ width: 0, height: 4 }),
    Object.freeze({ width: 3, height: 4 }),
]);

function carriedPortalScaffolds(bot) {
    const preferred = [
        'dirt',
        'cobblestone',
        'cobbled_deepslate',
        'netherrack',
        'stone',
    ];
    const items = bot.inventory.items()
        .filter(item => (
            preferred.includes(item.name)
            || item.name.endsWith('_planks')
        ))
        .sort((left, right) => {
            const leftRank = preferred.includes(left.name)
                ? preferred.indexOf(left.name)
                : preferred.length;
            const rightRank = preferred.includes(right.name)
                ? preferred.indexOf(right.name)
                : preferred.length;
            return leftRank - rightRank
                || right.count - left.count
                || left.name.localeCompare(right.name);
        });
    const scaffolds = [];
    for (const item of items) {
        for (let count = 0; count < item.count && scaffolds.length < 3; count++) {
            scaffolds.push(item.name);
        }
        if (scaffolds.length >= 3) break;
    }
    return scaffolds;
}

function carriedPortalRamps(bot) {
    const preferred = [
        'cobblestone_slab',
        'cobbled_deepslate_slab',
        'stone_slab',
    ];
    const items = bot.inventory.items()
        .filter(item => item.name.endsWith('_slab'))
        .sort((left, right) => {
            const leftRank = preferred.includes(left.name)
                ? preferred.indexOf(left.name)
                : preferred.length;
            const rightRank = preferred.includes(right.name)
                ? preferred.indexOf(right.name)
                : preferred.length;
            return leftRank - rightRank
                || right.count - left.count
                || left.name.localeCompare(right.name);
        });
    const ramps = [];
    for (const item of items) {
        for (let count = 0; count < item.count && ramps.length < 2; count++) {
            ramps.push(item.name);
        }
        if (ramps.length >= 2) break;
    }
    return ramps;
}

function portalRampIsReady(block) {
    if (!block?.name?.endsWith('_slab')) return false;
    try {
        const type = block.getProperties?.()?.type;
        return type !== 'top' && type !== 'double';
    } catch {
        return true;
    }
}

function portalCellPosition(origin, axis, width, height, normal=0) {
    return axis === 'x'
        ? origin.offset(width, height, normal)
        : origin.offset(normal, height, width);
}

function portalCellBlock(bot, site, cell, normal=0) {
    return bot.blockAt(portalCellPosition(
        site.origin,
        site.axis,
        cell.width,
        cell.height,
        normal,
    ));
}

function portalCellIsClear(block) {
    return Boolean(
        block
        && (
            isReplaceableGameplayBlock(block)
            || block.name === 'fire'
            || block.name === 'soul_fire'
            || block.name === 'nether_portal'
        )
    );
}

function portalSiteInspection(bot, origin, axis) {
    const site = { origin, axis };
    const frameBlocks = PORTAL_FRAME_CELLS.map(cell => portalCellBlock(bot, site, cell));
    if (frameBlocks.some(block => !block)) return null;
    if (frameBlocks.some(block => block.name !== 'obsidian' && !portalCellIsClear(block))) return null;

    const existingFrameBlocks = frameBlocks.filter(block => block.name === 'obsidian').length;
    const interiorBlocks = PORTAL_INTERIOR_CELLS.map(cell => portalCellBlock(bot, site, cell));
    if (interiorBlocks.some(block => !portalCellIsClear(block))) return null;

    const cornerBlocks = PORTAL_CORNER_CELLS.map(cell => portalCellBlock(bot, site, cell));
    if (cornerBlocks.some(block => (
        !portalCellIsClear(block)
        && !(block?.name === 'obsidian' && existingFrameBlocks >= 2)
    ))) return null;

    for (let width = 0; width <= 3; width++) {
        const support = bot.blockAt(portalCellPosition(origin, axis, width, -1));
        if (!isSafeGameplaySupport(support)) return null;
    }

    const accessSigns = [1, -1].filter(sign => {
        for (const width of [0, 1, 2, 3]) {
            for (const normal of [sign, sign * 2]) {
                const feet = bot.blockAt(portalCellPosition(origin, axis, width, 0, normal));
                const head = bot.blockAt(portalCellPosition(origin, axis, width, 1, normal));
                const support = bot.blockAt(portalCellPosition(origin, axis, width, -1, normal));
                if (!portalCellIsClear(feet) || !portalCellIsClear(head) || !isSafeGameplaySupport(support)) {
                    return false;
                }
            }
        }
        return true;
    });
    if (accessSigns.length === 0) return null;

    const center = portalCellPosition(origin, axis, 1.5, 1.5);
    const occupied = Object.values(bot.entities || {}).some(entity => (
        entity?.id !== bot.entity?.id
        && entity?.position
        && Math.abs(entity.position.y - center.y) <= 3
        && entity.position.distanceTo(center) < 3
    ));
    if (occupied) return null;

    const preferredSign = accessSigns.sort((left, right) => {
        const leftAccess = portalCellPosition(origin, axis, 1.5, 0, left * 2);
        const rightAccess = portalCellPosition(origin, axis, 1.5, 0, right * 2);
        return leftAccess.distanceTo(bot.entity.position) - rightAccess.distanceTo(bot.entity.position);
    })[0];

    return {
        ...site,
        accessSign: preferredSign,
        existingFrameBlocks,
        center,
        distance: center.distanceTo(bot.entity.position),
    };
}

function findPortalSite(bot, range) {
    const base = bot.entity.position.floored();
    const candidates = [];
    for (const yOffset of [0, 1, -1]) {
        for (const axis of ['x', 'z']) {
            for (let xOffset = -range; xOffset <= range; xOffset++) {
                for (let zOffset = -range; zOffset <= range; zOffset++) {
                    const origin = base.offset(xOffset, yOffset, zOffset);
                    const center = portalCellPosition(origin, axis, 1.5, 1.5);
                    const horizontal = Math.hypot(
                        center.x - bot.entity.position.x,
                        center.z - bot.entity.position.z,
                    );
                    if (horizontal < PORTAL_SEARCH_MIN_DISTANCE || horizontal > range) continue;
                    const inspected = portalSiteInspection(bot, origin, axis);
                    if (inspected) candidates.push(inspected);
                }
            }
        }
    }
    return candidates.sort((left, right) => (
        right.existingFrameBlocks - left.existingFrameBlocks
        || left.distance - right.distance
        || left.origin.y - right.origin.y
        || left.origin.x - right.origin.x
        || left.origin.z - right.origin.z
        || left.axis.localeCompare(right.axis)
    ))[0] || null;
}

function portalFrameIsComplete(bot, site) {
    return PORTAL_FRAME_CELLS.every(cell => portalCellBlock(bot, site, cell)?.name === 'obsidian');
}

function portalIsActive(bot, site) {
    return PORTAL_INTERIOR_CELLS.some(cell => portalCellBlock(bot, site, cell)?.name === 'nether_portal');
}

function portalTarget(site) {
    return {
        name: 'nether_portal',
        x: site.origin.x,
        y: site.origin.y,
        z: site.origin.z,
        axis: site.axis,
    };
}

function normalizedDimension(value) {
    const dimension = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/^minecraft:/, '');
    if (dimension === 'nether') return 'the_nether';
    if (dimension === 'end') return 'the_end';
    return dimension;
}

async function goToExplorationPosition(bot, position, distance=2) {
    const startedAt = Date.now();
    let lastPosition = bot.entity.position.clone();
    const visitedCells = new Set([
        `${Math.floor(lastPosition.x)}:${Math.floor(lastPosition.y)}:${Math.floor(lastPosition.z)}`,
    ]);
    let lastProgressAt = Date.now();
    let stalled = false;
    const interval = setInterval(() => {
        const current = bot.entity?.position;
        if (!current) return;
        lastPosition = current.clone();
        const cell = `${Math.floor(current.x)}:${Math.floor(current.y)}:${Math.floor(current.z)}`;
        if (!visitedCells.has(cell)) {
            visitedCells.add(cell);
            lastProgressAt = Date.now();
            return;
        }
        if (
            Date.now() - lastProgressAt < EXPLORATION_STALL_TIMEOUT_MS
            && Date.now() - startedAt < EXPLORATION_LEG_TIMEOUT_MS
        ) return;
        stalled = true;
        try {
            bot.pathfinder.setGoal(null);
        } catch {
            try { bot.pathfinder.stop(); } catch { /* best-effort bounded leg cleanup */ }
        }
    }, NAVIGATION_PROGRESS_POLL_MS);
    try {
        const reached = await goToPosition(
            bot,
            position.x,
            position.y,
            position.z,
            distance,
        );
        if (!stalled) return reached;
        setActionEvidence(bot, {
            kind: 'exploration_movement',
            outcome: 'path_stalled',
            target: {
                x: position.x,
                y: position.y,
                z: position.z,
            },
            progress: {
                elapsedMs: Date.now() - startedAt,
                stalledMs: Date.now() - lastProgressAt,
                visitedCells: visitedCells.size,
                lastPosition: {
                    x: lastPosition.x,
                    y: lastPosition.y,
                    z: lastPosition.z,
                },
            },
            retryable: true,
        });
        return false;
    } finally {
        clearInterval(interval);
    }
}

function botIsInsideNetherPortal(bot) {
    const feet = bot.entity?.position?.floored?.();
    if (!feet) return false;
    return [feet, feet.offset(0, 1, 0)].some(position => (
        bot.blockAt(position)?.name === 'nether_portal'
    ));
}

function portalTraversalSiteForBlock(bot, block) {
    if (block?.name !== 'nether_portal' || !block.position) return null;
    const support = bot.blockAt(block.position.offset(0, -1, 0));
    if (!isSafeGameplaySupport(support)) return null;
    let axis = 'x';
    try {
        if (block.getProperties?.()?.axis === 'z') axis = 'z';
    } catch {
        // The connected registry normally exposes portal axis properties.
    }
    const approaches = [];
    for (const sign of [-1, 1]) {
        const normal = axis === 'x'
            ? new Vec3(0, 0, sign)
            : new Vec3(sign, 0, 0);
        const position = block.position.offset(normal.x * 2, -1, normal.z * 2);
        const step = block.position.offset(normal.x, -1, normal.z);
        const feet = bot.blockAt(position);
        const head = bot.blockAt(position.offset(0, 1, 0));
        const floor = bot.blockAt(position.offset(0, -1, 0));
        const stepBlock = bot.blockAt(step);
        const stepHead = bot.blockAt(step.offset(0, 1, 0));
        if (
            !isReplaceableGameplayBlock(feet)
            || !isReplaceableGameplayBlock(head)
            || !isSafeGameplaySupport(floor)
            || (
                !portalRampIsReady(stepBlock)
                && !isReplaceableGameplayBlock(stepBlock)
            )
            || !isReplaceableGameplayBlock(stepHead)
        ) continue;
        approaches.push({
            position,
            step,
            stepReady: portalRampIsReady(stepBlock),
            distance: position.distanceTo(bot.entity.position),
        });
    }
    if (approaches.length === 0) return null;
    approaches.sort((left, right) => left.distance - right.distance);
    return {
        block,
        axis,
        approach: approaches[0].position,
        step: approaches[0].step,
        stepReady: approaches[0].stepReady,
        distance: block.position.distanceTo(bot.entity.position),
    };
}

function findPortalTraversalSite(bot, range, preferredPosition=null) {
    const searchRange = Math.max(6, Math.min(64, Math.floor(Number(range) || 24)));
    const portals = world.getNearestBlocks(bot, 'nether_portal', searchRange, 48);
    const candidates = portals
        .map(block => portalTraversalSiteForBlock(bot, block))
        .filter(Boolean);
    candidates.sort((left, right) => {
        const preferredDifference = preferredPosition
            ? left.block.position.distanceTo(preferredPosition)
                - right.block.position.distanceTo(preferredPosition)
            : 0;
        return preferredDifference
            || left.distance - right.distance
            || left.block.position.y - right.block.position.y
            || left.block.position.x - right.block.position.x
            || left.block.position.z - right.block.position.z;
    });
    return candidates[0] || null;
}

async function walkTowardPositionUntil(bot, position, predicate, timeoutMs) {
    try {
        await bot.lookAt(position.offset(0.5, 0.8, 0.5), true);
        bot.setControlState('forward', true);
        return await waitForWorldCondition(bot, predicate, timeoutMs, 50);
    } finally {
        try { bot.setControlState('forward', false); } catch { /* bounded portal control cleanup */ }
    }
}

async function traverseActiveNetherPortal(
    bot,
    expectedDimension,
    range=24,
    preferredPosition=null,
    rampBlock=null,
) {
    const destinationDimension = normalizedDimension(expectedDimension);
    const startingDimension = normalizedDimension(bot.game?.dimension);
    const site = findPortalTraversalSite(bot, range, preferredPosition);
    if (!site) {
        return {
            ok: false,
            outcome: 'portal_not_found',
            startingDimension,
            destinationDimension,
        };
    }
    const sourcePortal = {
        x: site.block.position.x,
        y: site.block.position.y,
        z: site.block.position.z,
        axis: site.axis,
    };
    bot.modes.pause('unstuck');
    bot.modes.pause('elbow_room');
    try {
        if (
            !botIsInsideNetherPortal(bot)
            && !await goToPosition(
                bot,
                site.approach.x,
                site.approach.y,
                site.approach.z,
                0.75,
            )
        ) {
            return {
                ok: false,
                outcome: 'portal_approach_unreachable',
                sourcePortal,
                startingDimension,
                destinationDimension,
            };
        }
        let rampUsed = false;
        if (!site.stepReady) {
            if (!rampBlock) {
                return {
                    ok: false,
                    outcome: 'missing_portal_ramp',
                    sourcePortal,
                    startingDimension,
                    destinationDimension,
                };
            }
            const placed = await placeBlock(
                bot,
                rampBlock,
                site.step.x,
                site.step.y,
                site.step.z,
                'bottom',
                true,
                false,
            );
            if (!placed || !portalRampIsReady(bot.blockAt(site.step))) {
                return {
                    ok: false,
                    outcome: 'portal_ramp_placement_failed',
                    sourcePortal,
                    startingDimension,
                    destinationDimension,
                    rampBlock,
                };
            }
            rampUsed = true;
        }

        let contacted = botIsInsideNetherPortal(bot);
        if (!contacted) {
            const routedIntoPortal = await goToGoal(
                bot,
                new pf.goals.GoalBlock(
                    site.block.position.x,
                    site.block.position.y,
                    site.block.position.z,
                ),
            );
            contacted = (
                routedIntoPortal
                && (
                    botIsInsideNetherPortal(bot)
                    || normalizedDimension(bot.game?.dimension) === destinationDimension
                )
            );
        }
        if (!contacted) {
            return {
                ok: false,
                outcome: bot.interrupt_code ? 'interrupted' : 'portal_contact_unverified',
                sourcePortal,
                startingDimension,
                destinationDimension,
                rampUsed,
            };
        }
        const transitioned = await waitForWorldCondition(
            bot,
            () => normalizedDimension(bot.game?.dimension) === destinationDimension,
            PORTAL_TRANSITION_TIMEOUT_MS,
            100,
        );
        if (!transitioned) {
            return {
                ok: false,
                outcome: bot.interrupt_code ? 'interrupted' : 'dimension_transition_timeout',
                sourcePortal,
                startingDimension,
                destinationDimension,
                rampUsed,
            };
        }
        await waitForWorldCondition(
            bot,
            () => Boolean(findPortalTraversalSite(bot, Math.max(12, range))),
            PORTAL_DESTINATION_SETTLE_MS,
            100,
        );
        const destinationSite = findPortalTraversalSite(bot, Math.max(12, range));
        if (!destinationSite) {
            return {
                ok: false,
                outcome: 'destination_portal_unverified',
                sourcePortal,
                startingDimension,
                destinationDimension,
                rampUsed,
            };
        }
        const exited = !botIsInsideNetherPortal(bot) || await walkTowardPositionUntil(
            bot,
            destinationSite.approach,
            () => (
                !botIsInsideNetherPortal(bot)
                && bot.entity.position.distanceTo(destinationSite.approach) <= 1.25
            ),
            PORTAL_EXIT_TIMEOUT_MS,
        );
        return {
            ok: exited,
            outcome: exited ? 'dimension_reached' : 'portal_exit_unverified',
            sourcePortal,
            destinationPortal: {
                x: destinationSite.block.position.x,
                y: destinationSite.block.position.y,
                z: destinationSite.block.position.z,
                axis: destinationSite.axis,
            },
            startingDimension,
            destinationDimension,
            exited,
            rampUsed,
        };
    } finally {
        try { bot.setControlState('forward', false); } catch { /* bounded portal control cleanup */ }
        try { bot.setControlState('jump', false); } catch { /* bounded portal control cleanup */ }
        bot.modes.unpause('unstuck');
        bot.modes.unpause('elbow_room');
    }
}


export async function placeBlock(
    bot,
    blockType,
    x,
    y,
    z,
    placeOn='bottom',
    dontCheat=false,
    replaceObstruction=true,
) {
    /**
     * Place the given block type at the given position. It will build off from any adjacent blocks. Will fail if there is a block in the way or nothing to build off of.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} blockType, the type of block to place, which can be a block or item name.
     * @param {number} x, the x coordinate of the block to place.
     * @param {number} y, the y coordinate of the block to place.
     * @param {number} z, the z coordinate of the block to place.
     * @param {string} placeOn, the preferred side of the block to place on. Can be 'top', 'bottom', 'north', 'south', 'east', 'west', or 'side'. Defaults to bottom. Will place on first available side if not possible.
     * @param {boolean} dontCheat, overrides cheat mode to place the block normally. Defaults to false.
     * @returns {Promise<boolean>} true if the block was placed, false otherwise.
     * @example
     * let p = world.getPosition(bot);
     * await skills.placeBlock(bot, "oak_log", p.x + 2, p.y, p.x);
     * await skills.placeBlock(bot, "torch", p.x + 1, p.y, p.x, 'side');
     **/
    if (![x, y, z].every(Number.isFinite)) {
        setActionEvidence(bot, { kind: 'place', outcome: 'invalid_target', retryable: false });
        log(bot, 'Cannot place block: position is incomplete or invalid.');
        return false;
    }
    const target_dest = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
    const target = { name: blockType, x: target_dest.x, y: target_dest.y, z: target_dest.z };

    if (blockType === 'air') {
        log(bot, `Placing air (removing block) at ${target_dest}.`);
        return await breakBlockAt(bot, x, y, z);
    }

    if (bot.modes.isOn('cheat') && !dontCheat) {
        if (bot.restrict_to_inventory) {
            let block = bot.inventory.findInventoryItem(blockType);
            if (!block) {
                setActionEvidence(bot, { kind: 'place', outcome: 'missing_material', target, retryable: true });
                log(bot, `Cannot place ${blockType}, you are restricted to your current inventory.`);
                return false;
            }
        }

        // invert the facing direction
        let face = placeOn === 'north' ? 'south' : placeOn === 'south' ? 'north' : placeOn === 'east' ? 'west' : 'east';
        if (blockType.includes('torch') && placeOn !== 'bottom') {
            // insert wall_ before torch
            blockType = blockType.replace('torch', 'wall_torch');
            if (placeOn !== 'side' && placeOn !== 'top') {
                blockType += `[facing=${face}]`;
            }
        }
        if (blockType.includes('button') || blockType === 'lever') {
            if (placeOn === 'top') {
                blockType += `[face=ceiling]`;
            }
            else if (placeOn === 'bottom') {
                blockType += `[face=floor]`;
            }
            else {
                blockType += `[facing=${face}]`;
            }
        }
        if (blockType === 'ladder' || blockType === 'repeater' || blockType === 'comparator') {
            blockType += `[facing=${face}]`;
        }
        if (blockType.includes('stairs')) {
            blockType += `[facing=${face}]`;
        }
        if (useDelay) { await new Promise(resolve => setTimeout(resolve, blockPlaceDelay)); }
        let msg = '/setblock ' + Math.floor(x) + ' ' + Math.floor(y) + ' ' + Math.floor(z) + ' ' + blockType;
        bot.chat(msg);
        if (blockType.includes('door'))
            if (useDelay) { await new Promise(resolve => setTimeout(resolve, blockPlaceDelay)); }
            bot.chat('/setblock ' + Math.floor(x) + ' ' + Math.floor(y+1) + ' ' + Math.floor(z) + ' ' + blockType + '[half=upper]');
        if (blockType.includes('bed'))
            if (useDelay) { await new Promise(resolve => setTimeout(resolve, blockPlaceDelay)); }
            bot.chat('/setblock ' + Math.floor(x) + ' ' + Math.floor(y) + ' ' + Math.floor(z-1) + ' ' + blockType + '[part=head]');
        setActionEvidence(bot, { kind: 'place', outcome: 'setblock_requested', completion: 'requested', target: { ...target, name: blockType }, retryable: false });
        log(bot, `Requested /setblock to place ${blockType} at ${target_dest}.`);
        return true;
    }

    let item_name = blockType;
    if (item_name == "redstone_wire")
        item_name = "redstone";
    else if (item_name === 'water') {
        item_name = 'water_bucket';
    }
    else if (item_name === 'lava') {
        item_name = 'lava_bucket';
    }
    let block_item = bot.inventory.findInventoryItem(item_name);
    if (!block_item && bot.game.gameMode === 'creative' && !bot.restrict_to_inventory) {
        await bot.creative.setInventorySlot(36, mc.makeItem(item_name, 1)); // 36 is first hotbar slot
        block_item = bot.inventory.findInventoryItem(item_name);
    }
    if (!block_item) {
        setActionEvidence(bot, { kind: 'place', outcome: 'missing_material', target, retryable: true });
        log(bot, `Don't have any ${item_name} to place.`);
        return false;
    }

    const targetBlock = bot.blockAt(target_dest);
    if (!targetBlock) {
        setActionEvidence(bot, { kind: 'place', outcome: 'target_unloaded', target, retryable: true });
        log(bot, `Cannot place ${blockType}: destination chunk is not loaded.`);
        return false;
    }
    if (targetBlock.name === blockType || (targetBlock.name === 'grass_block' && blockType === 'dirt')) {
        setActionEvidence(bot, { kind: 'place', outcome: 'already_present', target, retryable: false });
        log(bot, `${blockType} already at ${targetBlock.position}.`);
        return false;
    }
    const empty_blocks = ['air', 'water', 'lava', 'grass', 'short_grass', 'tall_grass', 'snow', 'dead_bush', 'fern'];
    if (!empty_blocks.includes(targetBlock.name)) {
        if (!replaceObstruction) {
            setActionEvidence(bot, {
                kind: 'place',
                outcome: 'occupied',
                target,
                observed: targetBlock.name,
                retryable: false,
            });
            log(bot, `Cannot place ${blockType}: ${targetBlock.name} occupies the validated blueprint cell.`);
            return false;
        }
        log(bot, `${targetBlock.name} in the way at ${targetBlock.position}.`);
        const removed = await breakBlockAt(bot, x, y, z);
        if (!removed) {
            setActionEvidence(bot, { kind: 'place', outcome: 'blocked', target, retryable: true });
            log(bot, `Cannot place ${blockType} at ${targetBlock.position}: block in the way.`);
            return false;
        }
        await new Promise(resolve => setTimeout(resolve, 200)); // wait for block to break
    }
    // get the buildoffblock and facevec based on whichever adjacent block is not empty
    let buildOffBlock = null;
    let faceVec = null;
    const dir_map = {
        'top': Vec3(0, 1, 0),
        'bottom': Vec3(0, -1, 0),
        'north': Vec3(0, 0, -1),
        'south': Vec3(0, 0, 1),
        'east': Vec3(1, 0, 0),
        'west': Vec3(-1, 0, 0),
    }
    let dirs = [];
    if (placeOn === 'side') {
        dirs.push(dir_map['north'], dir_map['south'], dir_map['east'], dir_map['west']);
    }
    else if (dir_map[placeOn] !== undefined) {
        dirs.push(dir_map[placeOn]);
    }
    else {
        dirs.push(dir_map['bottom']);
        log(bot, `Unknown placeOn value "${placeOn}". Defaulting to bottom.`);
    }
    dirs.push(...Object.values(dir_map).filter(d => !dirs.includes(d)));

    for (let d of dirs) {
        const block = bot.blockAt(target_dest.plus(d));
        if (
            block
            && !empty_blocks.includes(block.name)
            && !block.name.endsWith('_door')
        ) {
            buildOffBlock = block;
            faceVec = new Vec3(-d.x, -d.y, -d.z); // invert
            break;
        }
    }
    if (!buildOffBlock) {
        setActionEvidence(bot, { kind: 'place', outcome: 'missing_support', target, retryable: true });
        log(bot, `Cannot place ${blockType} at ${targetBlock.position}: nothing to place on.`);
        return false;
    }

    const pos = bot.entity.position;
    const pos_above = pos.plus(Vec3(0,1,0));
    const dont_move_for = ['torch', 'redstone_torch', 'redstone', 'lever', 'button', 'rail', 'detector_rail', 
        'powered_rail', 'activator_rail', 'tripwire_hook', 'tripwire', 'water_bucket', 'string'];
    if (!dont_move_for.includes(item_name) && (pos.distanceTo(targetBlock.position) < 1.1 || pos_above.distanceTo(targetBlock.position) < 1.1)) {
        // too close
        let goal = new pf.goals.GoalNear(targetBlock.position.x, targetBlock.position.y, targetBlock.position.z, 2);
        let inverted_goal = new pf.goals.GoalInvert(goal);
        const moved = await goToGoal(bot, inverted_goal);
        if (!moved || bot.entity.position.distanceTo(targetBlock.position) < 1.1) {
            setActionEvidence(bot, { kind: 'place', outcome: 'no_clearance', target, retryable: true });
            log(bot, `Cannot make safe clearance to place ${blockType}.`);
            return false;
        }
    }
    if (bot.entity.position.distanceTo(targetBlock.position) > 4.5) {
        // too far
        let pos = targetBlock.position;
        const reached = await goToGoal(bot, new pf.goals.GoalNear(pos.x, pos.y, pos.z, 4));
        if (!reached || bot.entity.position.distanceTo(targetBlock.position) > 4.5) {
            setActionEvidence(bot, { kind: 'place', outcome: 'unreachable', target, retryable: true });
            log(bot, `Cannot reach ${blockType} placement position.`);
            return false;
        }
    }

    // will throw error if an entity is in the way, and sometimes even if the block was placed
    try {
        let placed = false;
        if (item_name.includes('bucket')) {
            placed = await useToolOnBlock(bot, item_name, buildOffBlock);
        }
        else {
            await bot.equip(block_item, 'hand');
            await bot.lookAt(buildOffBlock.position.offset(0.5, 0.5, 0.5));
            await bot.placeBlock(buildOffBlock, faceVec);
            placed = true;
        }
        if (!placed) {
            setActionEvidence(bot, { kind: 'place', outcome: 'use_failed', target, retryable: true });
            return false;
        }
        await new Promise(resolve => setTimeout(resolve, 200));
        const placedBlock = bot.blockAt(target_dest);
        const expectedName = item_name === 'water_bucket'
            ? 'water'
            : item_name === 'lava_bucket'
                ? 'lava'
                : blockType;
        if (placedBlock?.name !== expectedName) {
            setActionEvidence(bot, { kind: 'place', outcome: 'not_placed', target, observed: placedBlock?.name || 'unloaded', retryable: true });
            log(bot, `Could not verify ${blockType} at ${target_dest}.`);
            return false;
        }
        setActionEvidence(bot, { kind: 'place', outcome: 'placed', target, retryable: false });
        log(bot, `Placed ${blockType} at ${target_dest}.`);
        return true;
    } catch (err) {
        setActionEvidence(bot, { kind: 'place', outcome: 'place_blocked', target, error: err.message, retryable: true });
        log(bot, `Failed to place ${blockType} at ${target_dest}.`);
        return false;
    }
}

export async function buildNetherPortal(bot, range=12) {
    const searchRange = Math.max(6, Math.min(16, Math.floor(Number(range) || 12)));
    const nearbyPortal = world.getNearestBlock(bot, 'nether_portal', searchRange);
    if (nearbyPortal) {
        const target = {
            name: 'nether_portal',
            x: nearbyPortal.position.x,
            y: nearbyPortal.position.y,
            z: nearbyPortal.position.z,
        };
        setActionEvidence(bot, {
            kind: 'portal_build',
            outcome: 'already_active',
            target,
            retryable: false,
        });
        log(bot, `An active Nether portal already exists at ${target.x}, ${target.y}, ${target.z}.`);
        return true;
    }

    let scaffoldItems = carriedPortalScaffolds(bot);
    if (scaffoldItems.length < 3) {
        const missing = 3 - scaffoldItems.length;
        if (!await collectBlock(
            bot,
            'dirt',
            missing,
            null,
            Math.max(16, searchRange * 2),
        )) {
            setActionEvidence(bot, {
                kind: 'portal_build',
                outcome: 'missing_scaffold',
                target: { name: 'nether_portal' },
                required: 3,
                available: scaffoldItems.length,
                retryable: true,
            });
            log(bot, 'Cannot build the portal frame without three expendable scaffold blocks.');
            return false;
        }
        scaffoldItems = carriedPortalScaffolds(bot);
    }
    if (scaffoldItems.length < 3 || bot.interrupt_code) {
        setActionEvidence(bot, {
            kind: 'portal_build',
            outcome: bot.interrupt_code ? 'interrupted' : 'missing_scaffold',
            target: { name: 'nether_portal' },
            required: 3,
            available: scaffoldItems.length,
            retryable: !bot.interrupt_code,
        });
        return false;
    }

    const site = findPortalSite(bot, searchRange);
    if (!site) {
        setActionEvidence(bot, {
            kind: 'portal_build',
            outcome: 'no_safe_site',
            target: { name: 'nether_portal' },
            searchRange,
            retryable: true,
        });
        log(bot, `No clear, supported portal footprint was found within ${searchRange} blocks.`);
        return false;
    }

    const target = portalTarget(site);
    const access = portalCellPosition(
        site.origin,
        site.axis,
        1.5,
        0,
        site.accessSign * 2,
    );
    log(
        bot,
        `Selected ${site.axis}-axis portal footprint at ${target.x}, ${target.y}, ${target.z} `
        + `with access at ${access.x}, ${access.y}, ${access.z}.`,
    );
    const ignitionTool = inventoryCount(bot, 'flint_and_steel') > 0
        ? 'flint_and_steel'
        : inventoryCount(bot, 'fire_charge') > 0
            ? 'fire_charge'
            : null;
    const availableObsidian = inventoryCount(bot, 'obsidian')
        + site.existingFrameBlocks;
    const needsConstruction = !portalFrameIsComplete(bot, site);
    const progress = {
        placed: 0,
        reused: site.existingFrameBlocks,
        scaffoldsPlaced: 0,
    };
    let portalModesPaused = false;
    const restorePortalModes = () => {
        if (!portalModesPaused) return;
        bot.modes.unpause('unstuck');
        bot.modes.unpause('elbow_room');
        portalModesPaused = false;
    };
    const finish = (success, outcome, detail={}) => {
        restorePortalModes();
        setActionEvidence(bot, {
            kind: 'portal_build',
            outcome,
            target,
            frameComplete: portalFrameIsComplete(bot, site),
            active: portalIsActive(bot, site),
            ...progress,
            retryable: !success,
            ...detail,
        });
        if (success) {
            log(bot, `Built and activated a Nether portal at ${target.x}, ${target.y}, ${target.z}.`);
        } else if (outcome !== 'interrupted') {
            log(bot, `Nether portal construction stopped (${outcome.replaceAll('_', ' ')}).`);
        }
        return success;
    };

    if (!ignitionTool) {
        return finish(false, 'missing_ignition', {
            missing: ['flint_and_steel_or_fire_charge'],
        });
    }
    if (needsConstruction && availableObsidian < 10) {
        return finish(false, 'missing_material', {
            requiredObsidian: 10,
            availableObsidian,
        });
    }
    bot.modes.pause('unstuck');
    bot.modes.pause('elbow_room');
    portalModesPaused = true;
    if (
        needsConstruction
        && !await goToPosition(bot, access.x, access.y, access.z, 1.5)
    ) {
        return finish(false, 'construction_access_unreachable');
    }

    const ensureObsidian = async (cell) => {
        const position = portalCellPosition(site.origin, site.axis, cell.width, cell.height);
        if (bot.blockAt(position)?.name === 'obsidian') return true;
        if (bot.interrupt_code) return false;
        const placed = await placeBlock(
            bot,
            'obsidian',
            position.x,
            position.y,
            position.z,
            'bottom',
            true,
            false,
        );
        if (placed) progress.placed += 1;
        return placed && bot.blockAt(position)?.name === 'obsidian';
    };
    const ensureTemporaryCorner = async (cell) => {
        const position = portalCellPosition(site.origin, site.axis, cell.width, cell.height);
        const block = bot.blockAt(position);
        if (block && !portalCellIsClear(block)) return true;
        const scaffold = scaffoldItems.shift();
        if (!scaffold) return false;
        const placed = await placeBlock(
            bot,
            scaffold,
            position.x,
            position.y,
            position.z,
            'bottom',
            true,
            false,
        );
        if (placed) progress.scaffoldsPlaced += 1;
        return placed;
    };
    const buildSupportedColumn = async (corner, column) => {
        const missing = column.some(cell => portalCellBlock(bot, site, cell)?.name !== 'obsidian');
        if (missing && !await ensureTemporaryCorner(corner)) return false;
        for (const cell of column) {
            if (!await ensureObsidian(cell)) return false;
        }
        return true;
    };

    if (!portalFrameIsComplete(bot, site)) {
        for (const cell of PORTAL_FRAME_CELLS.filter(cell => cell.height === 0)) {
            if (!await ensureObsidian(cell)) return finish(false, 'frame_placement_failed');
        }
        if (!await buildSupportedColumn(
            { width: 0, height: 0 },
            PORTAL_FRAME_CELLS.filter(cell => cell.width === 0),
        )) return finish(false, 'left_column_failed');
        if (!await buildSupportedColumn(
            { width: 3, height: 0 },
            PORTAL_FRAME_CELLS.filter(cell => cell.width === 3),
        )) return finish(false, 'right_column_failed');

        const topLeft = { width: 1, height: 4 };
        if (portalCellBlock(bot, site, topLeft)?.name !== 'obsidian') {
            const topCorner = { width: 0, height: 4 };
            const topLeftAccess = portalCellPosition(
                site.origin,
                site.axis,
                0,
                0,
                site.accessSign,
            );
            if (!await goToPosition(
                bot,
                topLeftAccess.x,
                topLeftAccess.y,
                topLeftAccess.z,
                0.75,
            )) return finish(false, 'top_access_unreachable');
            if (!await ensureTemporaryCorner(topCorner) || !await ensureObsidian(topLeft)) {
                return finish(false, 'top_support_failed');
            }
        }
        const topRightAccess = portalCellPosition(
            site.origin,
            site.axis,
            2,
            0,
            site.accessSign,
        );
        if (!await goToPosition(
            bot,
            topRightAccess.x,
            topRightAccess.y,
            topRightAccess.z,
            0.75,
        )) return finish(false, 'top_access_unreachable');
        if (!await ensureObsidian({ width: 2, height: 4 })) {
            return finish(false, 'top_row_failed');
        }
    }

    if (bot.interrupt_code) return finish(false, 'interrupted', { retryable: false });
    if (!portalFrameIsComplete(bot, site)) return finish(false, 'frame_verification_failed');

    if (!await goToPosition(bot, access.x, access.y, access.z, 1.5)) {
        return finish(false, 'ignition_position_unreachable');
    }
    if (!await equip(bot, ignitionTool)) {
        return finish(false, 'ignition_equip_failed', { ignitionTool });
    }

    for (const width of [1, 2]) {
        if (bot.interrupt_code) break;
        const baseBlock = portalCellBlock(bot, site, { width, height: 0 });
        if (baseBlock?.name !== 'obsidian') continue;
        try {
            await bot.lookAt(baseBlock.position.offset(0.5, 1, 0.5));
            await bot.activateBlock(
                baseBlock,
                new Vec3(0, 1, 0),
                new Vec3(0.5, 1, 0.5),
            );
        } catch (error) {
            if (width === 2) {
                return finish(false, 'ignition_failed', {
                    ignitionTool,
                    error: String(error?.message || error).slice(0, 240),
                });
            }
            continue;
        }
        if (await waitForWorldCondition(
            bot,
            () => portalIsActive(bot, site),
            PORTAL_ACTIVATION_TIMEOUT_MS,
            100,
        )) {
            return finish(true, 'activated', { ignitionTool, retryable: false });
        }
    }

    return finish(false, bot.interrupt_code ? 'interrupted' : 'activation_unverified', {
        ignitionTool,
        retryable: !bot.interrupt_code,
    });
}

export async function completeNetherQuartzRun(bot, quartzCount=1) {
    const requested = Math.floor(Number(quartzCount));
    const target = { name: 'nether_quartz_ore' };
    if (!Number.isFinite(requested) || requested < 1 || requested > 8) {
        setActionEvidence(bot, {
            kind: 'nether_round_trip',
            outcome: 'invalid_request',
            target,
            requested: quartzCount,
            retryable: false,
        });
        log(bot, 'A Nether quartz run requires between one and eight quartz.');
        return false;
    }

    const startDimension = normalizedDimension(bot.game?.dimension);
    if (!['overworld', 'the_nether'].includes(startDimension)) {
        setActionEvidence(bot, {
            kind: 'nether_round_trip',
            outcome: 'wrong_starting_dimension',
            target,
            startDimension,
            retryable: true,
        });
        log(bot, `A Nether quartz run cannot start in ${startDimension || 'an unknown dimension'}.`);
        return false;
    }
    const startingPortalSite = findPortalTraversalSite(bot, 24);
    if (!startingPortalSite) {
        setActionEvidence(bot, {
            kind: 'nether_round_trip',
            outcome: 'portal_not_found',
            target,
            startDimension,
            retryable: true,
        });
        log(bot, 'No safely approachable active Nether portal is nearby.');
        return false;
    }
    const startingPortalPosition = startingPortalSite.block.position.clone();
    const requiredRamps = (
        startDimension === 'overworld'
            ? (startingPortalSite.stepReady ? 1 : 2)
            : (startingPortalSite.stepReady ? 0 : 1)
    );
    let rampItems = carriedPortalRamps(bot);
    if (rampItems.length < requiredRamps && startDimension === 'overworld') {
        const missingCobblestone = Math.max(0, 3 - inventoryCount(bot, 'cobblestone'));
        if (missingCobblestone > 0) {
            await prepareMaterial(bot, 'cobblestone', missingCobblestone, 48);
        }
        if (
            !bot.interrupt_code
            && inventoryCount(bot, 'cobblestone') >= 3
        ) {
            await craftRecipe(bot, 'cobblestone_slab', 1);
        }
        rampItems = carriedPortalRamps(bot);
    }
    if (rampItems.length < requiredRamps || bot.interrupt_code) {
        setActionEvidence(bot, {
            kind: 'nether_round_trip',
            outcome: bot.interrupt_code ? 'interrupted' : 'missing_portal_ramp',
            target,
            startDimension,
            requiredRamps,
            availableRamps: rampItems.length,
            retryable: !bot.interrupt_code,
        });
        if (!bot.interrupt_code) {
            log(
                bot,
                `The raised portal route needs ${requiredRamps} bottom slab ramp${requiredRamps === 1 ? '' : 's'}.`,
            );
        }
        return false;
    }

    const quartzBefore = inventoryCount(bot, 'quartz');
    const recoveringCarriedQuartz = (
        startDimension === 'the_nether'
        && quartzBefore >= requested
    );
    let enteredNether = false;
    let returnedOverworld = false;
    let exitedReturnPortal = false;
    let died = false;
    let finalized = false;
    let collectionOutcome = null;
    let portalRampsPlaced = 0;
    const onDeath = () => {
        died = true;
    };
    bot.on('death', onDeath);
    const finish = (success, outcome, detail={}) => {
        if (!finalized) {
            bot.off('death', onDeath);
            finalized = true;
        }
        const observedDimension = normalizedDimension(bot.game?.dimension);
        const quartzAfter = inventoryCount(bot, 'quartz');
        const collectedQuartz = Math.max(0, quartzAfter - quartzBefore);
        setActionEvidence(bot, {
            kind: 'nether_round_trip',
            outcome,
            target,
            requested,
            startDimension,
            observedDimension,
            enteredNether,
            returnedOverworld,
            exitedReturnPortal,
            died,
            quartzBefore,
            quartzAfter,
            collectedQuartz,
            recoveringCarriedQuartz,
            collectionOutcome,
            portalRampsPlaced,
            retryable: !success && !bot.interrupt_code,
            ...detail,
        });
        if (success) {
            const securedQuartz = recoveringCarriedQuartz
                ? Math.min(quartzAfter, requested)
                : collectedQuartz;
            log(
                bot,
                `Returned safely to the Overworld with ${securedQuartz} quartz secured for the trip.`,
            );
        } else if (outcome !== 'interrupted') {
            log(bot, `Nether quartz round trip stopped (${outcome.replaceAll('_', ' ')}).`);
        }
        return success;
    };

    try {
        let entry = null;
        let returnPortal = null;
        if (startDimension === 'overworld') {
            if (bot.entity.position.distanceTo(startingPortalPosition) > 8) {
                await goToPosition(
                    bot,
                    startingPortalPosition.x,
                    startingPortalPosition.y,
                    startingPortalPosition.z,
                    4,
                );
            }
            entry = await traverseActiveNetherPortal(
                bot,
                'the_nether',
                24,
                startingPortalPosition,
                rampItems[0] || null,
            );
            if (entry.rampUsed) {
                rampItems.shift();
                portalRampsPlaced += 1;
            }
            enteredNether = (
                entry.ok
                && normalizedDimension(bot.game?.dimension) === 'the_nether'
            );
            if (!entry.ok || !enteredNether) {
                return finish(false, entry.outcome || 'nether_entry_unverified', { entry });
            }
            if (died) return finish(false, 'died_during_entry', { entry, retryable: false });
            if (bot.interrupt_code) return finish(false, 'interrupted', { entry, retryable: false });
            returnPortal = entry.destinationPortal;
        } else {
            enteredNether = true;
            const recoveryPortal = findPortalTraversalSite(bot, 24);
            returnPortal = recoveryPortal
                ? {
                    x: recoveryPortal.block.position.x,
                    y: recoveryPortal.block.position.y,
                    z: recoveryPortal.block.position.z,
                    axis: recoveryPortal.axis,
                }
                : null;
        }
        const collected = recoveringCarriedQuartz || await collectBlock(
            bot,
            'nether_quartz_ore',
            requested,
            null,
            48,
        );
        collectionOutcome = recoveringCarriedQuartz
            ? {
                outcome: 'already_carried',
                count: requested,
                target: { name: 'quartz' },
            }
            : bot.lastActionEvidence?.kind === 'collect'
                ? {
                    outcome: bot.lastActionEvidence.outcome,
                    count: bot.lastActionEvidence.count || 0,
                    target: bot.lastActionEvidence.target || null,
                }
                : { outcome: collected ? 'collected' : 'unverified' };
        if (bot.interrupt_code) {
            return finish(false, 'interrupted', { entry, retryable: false });
        }
        if (died) return finish(false, 'died_in_nether', { entry, retryable: false });

        if (
            returnPortal
            && bot.entity.position.distanceTo(new Vec3(
                returnPortal.x,
                returnPortal.y,
                returnPortal.z,
            )) > 8
        ) {
            await goToPosition(
                bot,
                returnPortal.x,
                returnPortal.y,
                returnPortal.z,
                4,
            );
        }
        const returned = await traverseActiveNetherPortal(
            bot,
            'overworld',
            24,
            returnPortal
                ? new Vec3(returnPortal.x, returnPortal.y, returnPortal.z)
                : null,
            rampItems[0] || null,
        );
        if (returned.rampUsed) {
            rampItems.shift();
            portalRampsPlaced += 1;
        }
        returnedOverworld = (
            returned.ok
            && normalizedDimension(bot.game?.dimension) === 'overworld'
        );
        exitedReturnPortal = returned.exited === true;
        if (!returnedOverworld || !exitedReturnPortal) {
            return finish(false, returned.outcome || 'overworld_return_unverified', {
                entry,
                returned,
            });
        }
        if (died || Number(bot.health) <= 0) {
            return finish(false, 'return_not_survived', {
                entry,
                returned,
                retryable: false,
            });
        }

        const collectedQuartz = Math.max(0, inventoryCount(bot, 'quartz') - quartzBefore);
        const securedQuartz = recoveringCarriedQuartz
            ? inventoryCount(bot, 'quartz') >= requested
            : collectedQuartz >= requested;
        if (!collected || !securedQuartz) {
            return finish(false, 'quartz_incomplete_returned', {
                entry,
                returned,
                collectedQuartz,
            });
        }
        return finish(true, 'completed', {
            entry,
            returned,
            retryable: false,
        });
    } catch (error) {
        return finish(false, 'runtime_error', {
            error: String(error?.message || error).slice(0, 240),
        });
    } finally {
        if (!finalized) bot.off('death', onDeath);
    }
}

export async function completeExplorationRoute(
    bot,
    memoryBank,
    targetItem='echo_shard',
    landmarkCount=3,
    range=96,
) {
    const itemName = String(targetItem || '').trim().toLowerCase().replace(/^minecraft:/, '');
    const requestedLandmarks = Math.max(1, Math.min(8, Math.floor(Number(landmarkCount) || 0)));
    const searchRange = Math.max(16, Math.min(128, Math.floor(Number(range) || 0)));
    const start = bot.entity?.position?.clone?.();
    const dimension = normalizedDimension(bot.game?.dimension);
    const target = start
        ? { name: 'exploration_route', x: start.x, y: start.y, z: start.z }
        : { name: 'exploration_route' };
    const finish = (success, outcome, detail={}) => {
        setActionEvidence(bot, {
            kind: 'exploration_route',
            outcome,
            target,
            requestedLandmarks,
            targetItem: itemName || null,
            dimension,
            retryable: !success && !bot.interrupt_code,
            ...detail,
        });
        if (success) {
            log(
                bot,
                `Exploration route verified ${detail.landmarks?.length || 0} landmarks, secured ${detail.recovered || 0} ${itemName}, and returned to its entrance.`,
            );
        } else if (outcome !== 'interrupted') {
            log(bot, `Exploration route stopped (${outcome.replaceAll('_', ' ')}).`);
        }
        return success;
    };

    if (!start || ![start.x, start.y, start.z].every(Number.isFinite)) {
        return finish(false, 'invalid_start', { retryable: false });
    }
    if (!memoryBank?.rememberPlace || !memoryBank?.rememberFact) {
        return finish(false, 'memory_unavailable', { retryable: false });
    }
    if (!itemName || requestedLandmarks < 1 || searchRange < 16) {
        return finish(false, 'invalid_request', { retryable: false });
    }

    memoryBank.rememberPlace(
        'exploration_route_start',
        start.x,
        start.y,
        start.z,
        dimension,
    );
    const landmarkBlocks = world.getNearestBlocks(
        bot,
        EXPLORATION_LANDMARK_BLOCKS,
        searchRange,
        64,
    ).filter(block => block?.position && EXPLORATION_LANDMARK_BLOCKS.includes(block.name));
    const route = chooseExplorationRoute({
        origin: start,
        landmarkCount: requestedLandmarks,
        candidates: landmarkBlocks.map(block => ({
            name: block.name,
            position: {
                x: block.position.x,
                y: block.position.y,
                z: block.position.z,
            },
        })),
    });
    if (route.outcome !== 'route_selected') {
        return finish(false, route.outcome, {
            considered: route.considered,
            distinctTypes: route.distinctTypes,
        });
    }

    const verifiedLandmarks = [];
    for (const [index, landmark] of route.selected.entries()) {
        if (bot.interrupt_code) return finish(false, 'interrupted', { landmarks: verifiedLandmarks, retryable: false });
        const position = landmark.position;
        if (!await goToExplorationPosition(bot, position, 2)) {
            return finish(false, 'landmark_unreachable', {
                landmarks: verifiedLandmarks,
                failedLandmark: landmark,
            });
        }
        const observed = bot.blockAt(new Vec3(position.x, position.y, position.z));
        if (
            observed?.name !== landmark.name
            || bot.entity.position.distanceTo(observed.position) > 3.5
        ) {
            return finish(false, 'landmark_unverified', {
                landmarks: verifiedLandmarks,
                failedLandmark: landmark,
                observed: observed?.name || null,
            });
        }
        const rememberedAs = `exploration_landmark_${index + 1}_${landmark.name}`;
        if (!memoryBank.rememberPlace(
            rememberedAs,
            position.x,
            position.y,
            position.z,
            dimension,
        )) {
            return finish(false, 'landmark_memory_failed', {
                landmarks: verifiedLandmarks,
                failedLandmark: landmark,
                retryable: false,
            });
        }
        verifiedLandmarks.push({ ...landmark, rememberedAs });
    }

    const containers = world.getNearestBlocks(
        bot,
        EXPLORATION_CONTAINER_BLOCKS,
        searchRange,
        16,
    ).filter(block => block?.position && EXPLORATION_CONTAINER_BLOCKS.includes(block.name));
    containers.sort((left, right) => (
        bot.entity.position.distanceTo(left.position)
        - bot.entity.position.distanceTo(right.position)
    ));
    const itemBefore = inventoryCount(bot, itemName);
    let recovered = 0;
    let recoveredFrom = null;
    for (const container of containers) {
        if (bot.interrupt_code) return finish(false, 'interrupted', { landmarks: verifiedLandmarks, retryable: false });
        if (!await goToExplorationPosition(bot, container.position, 2)) continue;
        const taken = await takeFromChest(bot, itemName, 1, container.position);
        recovered = Math.max(0, inventoryCount(bot, itemName) - itemBefore);
        if (taken && recovered >= 1) {
            recoveredFrom = {
                name: container.name,
                x: container.position.x,
                y: container.position.y,
                z: container.position.z,
            };
            break;
        }
    }
    if (recovered < 1) {
        return finish(false, containers.length ? 'target_item_not_recovered' : 'container_not_found', {
            landmarks: verifiedLandmarks,
            containersChecked: containers.length,
            recovered,
        });
    }

    if (!await goToExplorationPosition(bot, start, 1)) {
        return finish(false, 'return_unreachable', {
            landmarks: verifiedLandmarks,
            recovered,
            recoveredFrom,
        });
    }
    const returnDistance = bot.entity.position.distanceTo(start);
    const returned = (
        normalizedDimension(bot.game?.dimension) === dimension
        && returnDistance <= 2
    );
    if (!returned) {
        return finish(false, 'return_unverified', {
            landmarks: verifiedLandmarks,
            recovered,
            recoveredFrom,
            returnDistance,
        });
    }

    const routeEvidence = {
        verifiedAt: Date.now(),
        dimension,
        landmarkCount: verifiedLandmarks.length,
        targetItem: itemName,
        recovered,
        returned: true,
    };
    if (!memoryBank.rememberFact('exploration_route_verified', JSON.stringify(routeEvidence))) {
        return finish(false, 'route_memory_failed', {
            landmarks: verifiedLandmarks,
            recovered,
            recoveredFrom,
            returnDistance,
            retryable: false,
        });
    }
    memoryBank.personal?.rememberEpisode?.(
        `Explored ${verifiedLandmarks.length} landmarks, recovered ${recovered} ${itemName}, and returned to the saved route entrance.`,
        'verified',
    );
    return finish(true, 'route_completed', {
        landmarks: verifiedLandmarks,
        recovered,
        recoveredFrom,
        returnDistance,
        retryable: false,
    });
}

export async function recoverDeathItems(bot, deathRecord) {
    const position = deathRecord?.position;
    const expected = deathRecord?.inventory && typeof deathRecord.inventory === 'object'
        ? Object.fromEntries(Object.entries(deathRecord.inventory)
            .filter(([name, count]) => name && Number.isFinite(count) && count > 0)
            .map(([name, count]) => [name, Math.floor(count)]))
        : {};
    const dimension = normalizedDimension(deathRecord?.dimension);
    const target = position && [position.x, position.y, position.z].every(Number.isFinite)
        ? { name: 'last_death_position', x: position.x, y: position.y, z: position.z }
        : { name: 'last_death_position' };
    const finish = (success, outcome, detail={}) => {
        setActionEvidence(bot, {
            kind: 'death_recovery',
            outcome,
            target,
            dimension,
            retryable: !success && !bot.interrupt_code,
            ...detail,
        });
        if (success) {
            log(bot, `Returned to the death site and recovered ${detail.recovered || 0} dropped items.`);
        } else if (outcome !== 'interrupted') {
            log(bot, `Death-item recovery stopped (${outcome.replaceAll('_', ' ')}).`);
        }
        return success;
    };

    if (!position || ![position.x, position.y, position.z].every(Number.isFinite)) {
        return finish(false, 'death_position_missing', { retryable: false });
    }
    if (deathRecord?.recoveredAt) {
        return finish(false, 'death_already_recovered', { retryable: false });
    }
    if (Object.keys(expected).length === 0) {
        return finish(false, 'death_manifest_missing', { retryable: false });
    }
    const observedDimension = normalizedDimension(bot.game?.dimension);
    if (!dimension || observedDimension !== dimension) {
        return finish(false, 'wrong_dimension', {
            observedDimension,
            retryable: true,
        });
    }

    const before = world.getInventoryCounts(bot);
    if (!await goToPosition(bot, position.x, position.y, position.z, 2)) {
        return finish(false, 'death_position_unreachable');
    }
    if (bot.interrupt_code) return finish(false, 'interrupted', { retryable: false });

    await pickupNearbyItems(bot);
    const after = world.getInventoryCounts(bot);
    const recoveredByItem = {};
    let recovered = 0;
    let missing = 0;
    for (const [name, expectedCount] of Object.entries(expected)) {
        const gained = Math.max(0, (after[name] || 0) - (before[name] || 0));
        recoveredByItem[name] = gained;
        recovered += Math.min(expectedCount, gained);
        missing += Math.max(0, expectedCount - (after[name] || 0));
    }
    if (missing > 0 || recovered < 1) {
        return finish(false, recovered > 0 ? 'items_partially_recovered' : 'items_not_recovered', {
            expected,
            recoveredByItem,
            recovered,
            missing,
        });
    }
    return finish(true, 'items_recovered', {
        expected,
        recoveredByItem,
        recovered,
        missing: 0,
        retryable: false,
    });
}

export async function placeNearPlayer(bot, username, blockType, num=1) {
    const requested = Math.max(1, Math.min(16, Math.floor(Number(num) || 1)));
    let resolution = resolvePhysicalPlayer(bot, username);
    let target = playerTargetEvidence(resolution, { item: blockType });
    let player = resolution.entity;
    if (!player) {
        setActionEvidence(bot, { kind: 'place_near_player', outcome: 'lost_target', target, requested, placed: 0, retryable: false });
        log(bot, `Could not find ${username} for placement.`);
        return false;
    }
    if (inventoryCount(bot, blockType) < 1) {
        setActionEvidence(bot, { kind: 'place_near_player', outcome: 'missing_material', target, requested, placed: 0, retryable: true });
        log(bot, `Cannot place ${blockType}: none is in inventory.`);
        return false;
    }
    if (bot.entity.position.distanceTo(player.position) > 8 && !await goToPlayer(bot, username, 5)) {
        return false;
    }
    resolution = resolvePhysicalPlayer(bot, username);
    target = playerTargetEvidence(resolution, { item: blockType });
    player = resolution.entity;
    if (!player) {
        setActionEvidence(bot, { kind: 'place_near_player', outcome: 'lost_target', target, requested, placed: 0, retryable: false });
        return false;
    }

    const base = player.position.floored();
    const offsets = [
        [2, 0], [-2, 0], [0, 2], [0, -2],
        [2, 2], [-2, 2], [2, -2], [-2, -2],
        [3, 0], [-3, 0], [0, 3], [0, -3],
        [3, 2], [-3, 2], [3, -2], [-3, -2],
    ];
    const replaceable = new Set(['air', 'cave_air', 'void_air', 'short_grass', 'tall_grass', 'snow']);
    let placed = 0;

    for (const [dx, dz] of offsets) {
        if (placed >= requested || bot.interrupt_code || inventoryCount(bot, blockType) < 1) break;
        const x = base.x + dx;
        const z = base.z + dz;
        let destination = null;
        for (const dy of [0, 1, -1]) {
            const candidate = new Vec3(x, base.y + dy, z);
            const cell = bot.blockAt(candidate);
            const support = bot.blockAt(candidate.offset(0, -1, 0));
            const occupied = Object.values(bot.entities || {}).some(entity => (
                entity?.position && entity.position.distanceTo(candidate.offset(0.5, 0.5, 0.5)) < 1.2
            ));
            if (replaceable.has(cell?.name) && support?.boundingBox === 'block' && !occupied) {
                destination = candidate;
                break;
            }
        }
        if (!destination) continue;
        if (await placeBlock(
            bot,
            blockType,
            destination.x,
            destination.y,
            destination.z,
            'bottom',
            true,
            false,
        )) placed += 1;
    }

    const complete = placed >= requested;
    const outcome = bot.interrupt_code
        ? 'interrupted'
        : complete
            ? 'placed'
            : placed > 0
                ? 'partial'
                : inventoryCount(bot, blockType) < 1
                    ? 'missing_material'
                    : 'no_safe_position';
    setActionEvidence(bot, {
        kind: 'place_near_player',
        outcome,
        target,
        requested,
        placed,
        retryable: !complete && !bot.interrupt_code,
    });
    log(bot, complete
        ? `Placed ${placed} ${blockType} near ${username}.`
        : `Placed ${placed} of ${requested} requested ${blockType} near ${username}.`);
    return complete;
}

function normalizeEquipmentDestination(itemName, requestedDestination = null) {
    const explicit = String(requestedDestination || '').trim().toLowerCase().replace(/_/g, '-');
    if (explicit) {
        if (explicit === 'main' || explicit === 'main-hand') return 'hand';
        if (explicit === 'off' || explicit === 'offhand') return 'off-hand';
        if (['hand', 'off-hand', 'head', 'torso', 'legs', 'feet'].includes(explicit)) return explicit;
        return null;
    }
    if (itemName.includes('leggings')) return 'legs';
    if (itemName.includes('boots')) return 'feet';
    if (itemName.includes('helmet') || itemName === 'carved_pumpkin') return 'head';
    if (itemName.includes('chestplate') || itemName.includes('elytra')) return 'torso';
    if (itemName.includes('shield') || itemName === 'totem_of_undying') return 'off-hand';
    return 'hand';
}

function equippedItemAt(bot, destination) {
    try {
        const slot = bot.getEquipmentDestSlot(destination);
        return bot.inventory?.slots?.[slot] || null;
    } catch {
        return null;
    }
}

export async function equip(bot, itemName, requestedDestination = null) {
    /**
     * Equip the given item to the proper body part, like tools or armor.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item or block name to equip.
     * @returns {Promise<boolean>} true if the item was equipped, false otherwise.
     * @example
     * await skills.equip(bot, "iron_pickaxe");
     **/
    itemName = String(itemName || '').trim();
    if (!itemName) {
        setActionEvidence(bot, { kind: 'equip', outcome: 'invalid_target', retryable: false });
        log(bot, 'Cannot equip an empty item name.');
        return false;
    }
    const destination = normalizeEquipmentDestination(itemName, requestedDestination);
    const target = { name: itemName, destination: destination || String(requestedDestination || '') };
    if (!destination) {
        setActionEvidence(bot, { kind: 'equip', outcome: 'invalid_destination', target, retryable: false });
        log(bot, `Cannot equip ${itemName}: destination must be main, off, head, torso, legs, or feet.`);
        return false;
    }
    try {
        if (itemName === 'hand') {
            if (destination !== 'hand') {
                setActionEvidence(bot, { kind: 'equip', outcome: 'invalid_destination', target, retryable: false });
                log(bot, 'An empty hand can only be selected for the main hand.');
                return false;
            }
            if (!bot.heldItem) {
                setActionEvidence(bot, { kind: 'equip', outcome: 'unequipped', target, retryable: false });
                log(bot, 'Main hand is already empty.');
                return true;
            }
            if (bot.inventory.firstEmptyInventorySlot() == null) {
                setActionEvidence(bot, { kind: 'equip', outcome: 'inventory_full', target, retryable: true });
                log(bot, 'Cannot empty the main hand safely because the inventory is full.');
                return false;
            }
            await bot.unequip('hand');
            if (bot.heldItem) {
                setActionEvidence(bot, {
                    kind: 'equip',
                    outcome: 'unequip_unverified',
                    target,
                    observed: bot.heldItem.name,
                    retryable: true,
                });
                log(bot, `Minecraft still reports ${bot.heldItem.name} in the main hand.`);
                return false;
            }
            setActionEvidence(bot, { kind: 'equip', outcome: 'unequipped', target, retryable: false });
            log(bot, 'Unequipped hand.');
            return true;
        }
        let item = bot.inventory.slots.find(slot => slot && slot.name === itemName);
        if (!item) {
            if (bot.game.gameMode === 'creative') {
                const emptySlot = bot.inventory.firstEmptyInventorySlot();
                if (emptySlot == null) {
                    setActionEvidence(bot, { kind: 'equip', outcome: 'inventory_full', target, retryable: true });
                    log(bot, `Could not create ${itemName}: no empty inventory slot is available.`);
                    return false;
                }
                await bot.creative.setInventorySlot(emptySlot, mc.makeItem(itemName, 1));
                item = bot.inventory.slots.find(slot => slot && slot.name === itemName);
            }
            else {
                setActionEvidence(bot, { kind: 'equip', outcome: 'missing_item', target, retryable: true });
                log(bot, `You do not have any ${itemName} to equip.`);
                return false;
            }
        }
        if (!item) {
            setActionEvidence(bot, { kind: 'equip', outcome: 'missing_item', target, retryable: true });
            log(bot, `Could not create ${itemName} to equip.`);
            return false;
        }
        await bot.equip(item, destination);
    } catch (error) {
        setActionEvidence(bot, { kind: 'equip', outcome: 'equip_blocked', target, error: error.message, retryable: true });
        log(bot, `Could not equip ${itemName}: ${error.message}.`);
        return false;
    }
    const equipped = equippedItemAt(bot, destination);
    if (equipped?.name !== itemName) {
        setActionEvidence(bot, {
            kind: 'equip',
            outcome: 'equip_unverified',
            target,
            observed: equipped?.name || null,
            retryable: true,
        });
        log(bot, `Minecraft did not confirm ${itemName} in the ${destination}.`);
        return false;
    }
    setActionEvidence(bot, { kind: 'equip', outcome: 'equipped', target, retryable: false });
    log(bot, `Equipped ${itemName} in the ${destination}.`);
    return true;
}

export async function discard(bot, itemName, num=-1) {
    /**
     * Discard the given item.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item or block name to discard.
     * @param {number} num, the number of items to discard. Defaults to -1, which discards all items.
     * @returns {Promise<boolean>} true if the item was discarded, false otherwise.
     * @example
     * await skills.discard(bot, "oak_log");
     **/
    let discarded = 0;
    while (true) {
        let item = bot.inventory.findInventoryItem(itemName);
        if (!item) {
            break;
        }
        let to_discard = num === -1 ? item.count : Math.min(num - discarded, item.count);
        await bot.toss(item.type, null, to_discard);
        discarded += to_discard;
        if (num !== -1 && discarded >= num) {
            break;
        }
    }
    if (discarded === 0) {
        log(bot, `You do not have any ${itemName} to discard.`);
        return false;
    }
    log(bot, `Discarded ${discarded} ${itemName}.`);
    return true;
}

function itemMatchesFamily(bot, item, family) {
    const name = String(item?.name || '');
    if (family === 'logs') return /_(?:log|stem)$/.test(name);
    if (family === 'planks') return name.endsWith('_planks');
    if (family === 'food') {
        return Boolean(
            bot.registry?.foodsByName?.[name]
            && !UNSAFE_FOOD_ITEMS.has(name)
            && !Object.prototype.hasOwnProperty.call(COOKABLE_FOOD, name)
        );
    }
    if (family === 'ores') {
        return name.startsWith('raw_')
            || /_(?:ore|ingot|nugget)$/.test(name)
            || ['coal', 'charcoal', 'diamond', 'emerald', 'redstone', 'lapis_lazuli', 'quartz'].includes(name);
    }
    if (family === 'building_blocks') {
        return name.endsWith('_planks')
            || ['cobblestone', 'cobbled_deepslate', 'stone', 'dirt', 'glass'].includes(name);
    }
    return false;
}

function familyInventoryEntries(bot, family) {
    const counts = new Map();
    for (const item of bot.inventory.items()) {
        if (!itemMatchesFamily(bot, item, family)) continue;
        const existing = counts.get(item.name);
        if (existing) existing.count += item.count;
        else counts.set(item.name, { name: item.name, count: item.count });
    }
    return [...counts.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

function familyInventoryCount(bot, family) {
    return familyInventoryEntries(bot, family).reduce((total, entry) => total + entry.count, 0);
}

export async function putInChest(bot, itemName, num=-1, exactPosition=null) {
    /**
     * Put the given item in the nearest chest.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item or block name to put in the chest.
     * @param {number} num, the number of items to put in the chest. Defaults to -1, which puts all items.
     * @returns {Promise<boolean>} true if the item was put in the chest, false otherwise.
     * @example
     * await skills.putInChest(bot, "oak_log");
     **/
    itemName = String(itemName || '').trim();
    let chest = exactPosition && [exactPosition.x, exactPosition.y, exactPosition.z].every(Number.isFinite)
        ? bot.blockAt(new Vec3(
            Math.floor(exactPosition.x),
            Math.floor(exactPosition.y),
            Math.floor(exactPosition.z),
        ))
        : world.getNearestBlock(bot, 'chest', 32);
    if (exactPosition && !['chest', 'trapped_chest', 'barrel'].includes(chest?.name)) {
        setActionEvidence(bot, {
            kind: 'chest_transfer',
            outcome: chest ? 'assigned_container_invalid' : 'assigned_container_unloaded',
            target: {
                name: 'assigned_deposit',
                x: Math.floor(exactPosition.x),
                y: Math.floor(exactPosition.y),
                z: Math.floor(exactPosition.z),
            },
            observed: chest?.name || null,
            retryable: true,
        });
        log(bot, 'The assigned deposit is not a loaded chest, trapped chest, or barrel.');
        return false;
    }
    if (!chest) {
        setActionEvidence(bot, { kind: 'chest_transfer', outcome: 'chest_not_found', target: { name: itemName || 'item' }, retryable: true });
        log(bot, 'Could not find a chest nearby.');
        return false;
    }
    let item = bot.inventory.findInventoryItem(itemName);
    if (!item) {
        setActionEvidence(bot, { kind: 'chest_transfer', outcome: 'missing_item', target: { name: itemName || 'item' }, retryable: true });
        log(bot, `You do not have any ${itemName} to put in the chest.`);
        return false;
    }
    const toPut = num === -1 ? item.count : Math.min(Math.max(0, Math.floor(Number(num) || 0)), item.count);
    const target = { name: chest.name || 'chest', x: chest.position.x, y: chest.position.y, z: chest.position.z };
    if (toPut < 1) {
        setActionEvidence(bot, { kind: 'chest_transfer', outcome: 'invalid_count', target, item: itemName, retryable: false });
        log(bot, `Cannot put a non-positive number of ${itemName} in the chest.`);
        return false;
    }
    const reached = await goToPosition(bot, chest.position.x, chest.position.y, chest.position.z, 2);
    if (!reached || bot.entity.position.distanceTo(chest.position) > 4.5) {
        setActionEvidence(bot, { kind: 'chest_transfer', outcome: 'chest_unreachable', target, item: itemName, retryable: true });
        log(bot, `Could not reach the chest to deposit ${itemName}.`);
        return false;
    }

    const beforeCount = inventoryCount(bot, itemName);
    let chestContainer = null;
    try {
        chestContainer = await bot.openContainer(chest);
        await chestContainer.deposit(item.type, null, toPut);
        await closeContainerQuietly(chestContainer);
        chestContainer = null;
        await waitForWorldCondition(
            bot,
            () => inventoryCount(bot, itemName) <= beforeCount - toPut,
            1_000,
            INVENTORY_POLL_MS,
        );
        const afterCount = inventoryCount(bot, itemName);
        const transferred = beforeCount - afterCount;
        if (transferred < toPut) {
            setActionEvidence(bot, { kind: 'chest_transfer', outcome: 'deposit_unverified', target, item: itemName, requested: toPut, transferred, retryable: true });
            log(bot, `Minecraft only confirmed ${Math.max(0, transferred)} of ${toPut} ${itemName} left inventory.`);
            return false;
        }
        setActionEvidence(bot, { kind: 'chest_transfer', outcome: 'deposited', target, item: itemName, count: transferred, retryable: false });
        log(bot, `Put ${transferred} ${itemName} in the chest.`);
        return true;
    } catch (error) {
        const afterCount = inventoryCount(bot, itemName);
        setActionEvidence(bot, {
            kind: 'chest_transfer',
            outcome: 'deposit_blocked',
            target,
            item: itemName,
            requested: toPut,
            transferred: Math.max(0, beforeCount - afterCount),
            error: error.message,
            retryable: true,
        });
        log(bot, `Could not put ${itemName} in the chest: ${error.message}.`);
        return false;
    } finally {
        await closeContainerQuietly(chestContainer);
    }
}

export async function putInChestAt(bot, itemName, num, x, y, z) {
    return await putInChest(bot, itemName, num, { x, y, z });
}

export async function putFamilyInChestAt(bot, family, num, x, y, z) {
    family = String(family || '').trim();
    const requested = Math.max(1, Math.min(2304, Math.floor(Number(num) || 1)));
    const before = familyInventoryCount(bot, family);
    const target = { name: family || 'item_family', x, y, z };
    if (!['logs', 'planks', 'food', 'ores', 'building_blocks'].includes(family)) {
        setActionEvidence(bot, { kind: 'family_transfer', outcome: 'unsupported_family', target, retryable: false });
        return false;
    }
    if (before < 1) {
        setActionEvidence(bot, { kind: 'family_transfer', outcome: 'family_missing', target, retryable: true });
        log(bot, `There are no ${family} to deposit.`);
        return false;
    }
    let remaining = Math.min(requested, before);
    let allVerified = true;
    for (const entry of familyInventoryEntries(bot, family)) {
        if (remaining < 1 || bot.interrupt_code) break;
        const amount = Math.min(remaining, entry.count);
        if (!await putInChestAt(bot, entry.name, amount, x, y, z)) {
            allVerified = false;
            break;
        }
        remaining -= amount;
    }
    const after = familyInventoryCount(bot, family);
    const transferred = Math.max(0, before - after);
    const expected = Math.min(requested, before);
    const success = allVerified && transferred >= expected;
    setActionEvidence(bot, {
        kind: 'family_transfer',
        outcome: success ? 'deposited' : bot.interrupt_code ? 'interrupted' : transferred > 0 ? 'partial' : 'deposit_blocked',
        target,
        requested: expected,
        transferred,
        retryable: !success && !bot.interrupt_code,
    });
    log(bot, success
        ? `Deposited ${transferred} ${family} across all carried item types.`
        : `Deposited ${transferred} of ${expected} requested ${family}.`);
    return success;
}

function protectedInventoryItem(name, protectedName) {
    if (name === protectedName) return true;
    if (protectedName === 'logs' && /_(?:log|stem)$/.test(name)) return true;
    if (protectedName === 'planks' && name.endsWith('_planks')) return true;
    return false;
}

function overflowKeepCount(bot, role, name, protectedName) {
    if (protectedInventoryItem(name, protectedName)) return Infinity;
    if (
        (bot.registry?.foodsByName?.[name] && !UNSAFE_FOOD_ITEMS.has(name))
        || /_(?:pickaxe|axe|shovel|hoe|sword|helmet|chestplate|leggings|boots)$/.test(name)
        || /(?:shield|bow|crossbow|trident|elytra)$/.test(name)
        || /_(?:sapling|seeds)$/.test(name)
        || name.endsWith('_bed')
        || ['bucket', 'water_bucket', 'lava_bucket', 'crafting_table', 'furnace'].includes(name)
    ) return Infinity;
    if (['torch', 'soul_torch'].includes(name)) return 16;
    if (['coal', 'charcoal'].includes(name)) return 8;
    if (/_(?:log|stem)$/.test(name)) return role === 'lumberjack' ? Infinity : 16;
    if (
        name.endsWith('_planks')
        || ['cobblestone', 'cobbled_deepslate', 'stone', 'dirt', 'sand', 'gravel', 'glass'].includes(name)
    ) return role === 'builder' ? 64 : 32;
    return 0;
}

function overflowPriority(name) {
    if (
        /(?:flower|tulip|dandelion|poppy|grass|fern|bush)$/.test(name)
        || ['rotten_flesh', 'spider_eye', 'poisonous_potato'].includes(name)
    ) return 0;
    if (['dirt', 'gravel', 'sand', 'cobblestone', 'cobbled_deepslate', 'stone'].includes(name)) return 1;
    if (name.startsWith('raw_') || /_(?:ore|ingot|nugget)$/.test(name)) return 3;
    return 2;
}

export async function depositInventoryOverflowAt(bot, role, protectedName, reserveSlots, x, y, z) {
    role = String(role || '').trim();
    protectedName = String(protectedName || '').trim();
    const desiredFreeSlots = Math.max(1, Math.min(12, Math.floor(Number(reserveSlots) || 2)));
    const target = { name: 'inventory_overflow', x, y, z };
    const beforeSlots = bot.inventory.emptySlotCount();
    if (beforeSlots >= desiredFreeSlots) {
        setActionEvidence(bot, {
            kind: 'inventory_consolidate',
            outcome: 'already_clear',
            target,
            beforeSlots,
            afterSlots: beforeSlots,
            retryable: false,
        });
        return true;
    }
    const candidates = familyInventoryEntries(bot, 'building_blocks')
        .concat(
            bot.inventory.items()
                .filter(item => !itemMatchesFamily(bot, item, 'building_blocks'))
                .map(item => ({ name: item.name, count: inventoryCount(bot, item.name) })),
        )
        .filter((entry, index, entries) => entries.findIndex(other => other.name === entry.name) === index)
        .map(entry => ({
            ...entry,
            keep: overflowKeepCount(bot, role, entry.name, protectedName),
            priority: overflowPriority(entry.name),
        }))
        .filter(entry => Number.isFinite(entry.keep) && entry.count > entry.keep)
        .sort((left, right) => (
            left.priority - right.priority
            || (right.count - right.keep) - (left.count - left.keep)
            || left.name.localeCompare(right.name)
        ));

    const deposited = {};
    for (const candidate of candidates) {
        if (bot.interrupt_code || bot.inventory.emptySlotCount() >= desiredFreeSlots) break;
        const available = inventoryCount(bot, candidate.name);
        const amount = Math.max(0, available - candidate.keep);
        if (amount < 1) continue;
        if (!await putInChestAt(bot, candidate.name, amount, x, y, z)) break;
        deposited[candidate.name] = amount;
    }
    const afterSlots = bot.inventory.emptySlotCount();
    const success = afterSlots >= desiredFreeSlots;
    setActionEvidence(bot, {
        kind: 'inventory_consolidate',
        outcome: success ? 'consolidated' : bot.interrupt_code ? 'interrupted' : 'insufficient_space',
        target,
        role,
        protectedItem: protectedName || null,
        beforeSlots,
        afterSlots,
        desiredFreeSlots,
        deposited,
        retryable: !success && !bot.interrupt_code,
    });
    log(bot, success
        ? `Consolidated inventory and restored ${afterSlots} free slots.`
        : `Inventory consolidation ended with ${afterSlots} of ${desiredFreeSlots} requested free slots.`);
    return success;
}

export async function takeFromChest(bot, itemName, num=-1, exactPosition=null) {
    /**
     * Take the given item from the nearest chest, potentially from multiple slots.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item or block name to take from the chest.
     * @param {number} num, the number of items to take from the chest. Defaults to -1, which takes all items.
     * @returns {Promise<boolean>} true if the item was taken from the chest, false otherwise.
     * @example
     * await skills.takeFromChest(bot, "oak_log");
     * **/
    itemName = String(itemName || '').trim();
    let chest = exactPosition && [exactPosition.x, exactPosition.y, exactPosition.z].every(Number.isFinite)
        ? bot.blockAt(new Vec3(
            Math.floor(exactPosition.x),
            Math.floor(exactPosition.y),
            Math.floor(exactPosition.z),
        ))
        : world.getNearestBlock(bot, 'chest', 32);
    if (exactPosition && !EXPLORATION_CONTAINER_BLOCKS.includes(chest?.name)) {
        setActionEvidence(bot, {
            kind: 'chest_transfer',
            outcome: chest ? 'assigned_container_invalid' : 'assigned_container_unloaded',
            target: {
                name: 'assigned_withdrawal',
                x: Math.floor(exactPosition.x),
                y: Math.floor(exactPosition.y),
                z: Math.floor(exactPosition.z),
            },
            observed: chest?.name || null,
            retryable: true,
        });
        log(bot, 'The assigned withdrawal is not a loaded chest, trapped chest, or barrel.');
        return false;
    }
    if (!chest) {
        setActionEvidence(bot, { kind: 'chest_transfer', outcome: 'chest_not_found', target: { name: itemName || 'item' }, retryable: true });
        log(bot, 'Could not find a chest nearby.');
        return false;
    }
    const target = { name: chest.name || 'chest', x: chest.position.x, y: chest.position.y, z: chest.position.z };
    const reached = await goToPosition(bot, chest.position.x, chest.position.y, chest.position.z, 2);
    if (!reached || bot.entity.position.distanceTo(chest.position) > 4.5) {
        setActionEvidence(bot, { kind: 'chest_transfer', outcome: 'chest_unreachable', target, item: itemName, retryable: true });
        log(bot, `Could not reach the chest to take ${itemName}.`);
        return false;
    }

    const beforeCount = inventoryCount(bot, itemName);
    let chestContainer = null;
    let intended = 0;
    try {
        chestContainer = await bot.openContainer(chest);
        const matchingItems = chestContainer.containerItems().filter(item => item.name === itemName);
        if (!matchingItems.length) {
            setActionEvidence(bot, { kind: 'chest_transfer', outcome: 'item_not_found', target, item: itemName, retryable: true });
            log(bot, `Could not find any ${itemName} in the chest.`);
            return false;
        }

        const totalAvailable = matchingItems.reduce((sum, item) => sum + item.count, 0);
        intended = num === -1 ? totalAvailable : Math.min(Math.max(0, Math.floor(Number(num) || 0)), totalAvailable);
        if (intended < 1) {
            setActionEvidence(bot, { kind: 'chest_transfer', outcome: 'invalid_count', target, item: itemName, retryable: false });
            log(bot, `Cannot take a non-positive number of ${itemName} from the chest.`);
            return false;
        }
        if (!hasInventoryRoomFor(bot, itemName)) {
            setActionEvidence(bot, { kind: 'chest_transfer', outcome: 'inventory_full', target, item: itemName, requested: intended, retryable: true });
            log(bot, `Cannot take ${itemName}: inventory has no free slot or stack space.`);
            return false;
        }

        let remaining = intended;
        for (const item of matchingItems) {
            if (remaining <= 0) break;
            const toTakeFromSlot = Math.min(remaining, item.count);
            await chestContainer.withdraw(item.type, null, toTakeFromSlot);
            remaining -= toTakeFromSlot;
        }

        await closeContainerQuietly(chestContainer);
        chestContainer = null;
        await waitForInventoryCount(bot, itemName, beforeCount + intended, 1_000);
        const afterCount = inventoryCount(bot, itemName);
        const transferred = afterCount - beforeCount;
        if (transferred < intended) {
            setActionEvidence(bot, { kind: 'chest_transfer', outcome: 'withdraw_unverified', target, item: itemName, requested: intended, transferred, retryable: true });
            log(bot, `Minecraft only confirmed ${Math.max(0, transferred)} of ${intended} ${itemName} entered inventory.`);
            return false;
        }
        setActionEvidence(bot, { kind: 'chest_transfer', outcome: 'withdrawn', target, item: itemName, count: transferred, retryable: false });
        log(bot, `Took ${transferred} ${itemName} from the chest.`);
        return true;
    } catch (error) {
        const afterCount = inventoryCount(bot, itemName);
        setActionEvidence(bot, {
            kind: 'chest_transfer',
            outcome: 'withdraw_blocked',
            target,
            item: itemName,
            requested: intended,
            transferred: Math.max(0, afterCount - beforeCount),
            error: error.message,
            retryable: true,
        });
        log(bot, `Could not take ${itemName} from the chest: ${error.message}.`);
        return false;
    } finally {
        await closeContainerQuietly(chestContainer);
    }
}

export async function viewChest(bot) {
    /**
     * View the contents of the nearest chest.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the chest was viewed, false otherwise.
     * @example
     * await skills.viewChest(bot);
     * **/
    let chest = world.getNearestBlock(bot, 'chest', 32);
    if (!chest) {
        setActionEvidence(bot, { kind: 'chest_view', outcome: 'chest_not_found', retryable: true });
        log(bot, 'Could not find a chest nearby.');
        return false;
    }
    const target = { name: chest.name || 'chest', x: chest.position.x, y: chest.position.y, z: chest.position.z };
    const reached = await goToPosition(bot, chest.position.x, chest.position.y, chest.position.z, 2);
    if (!reached || bot.entity.position.distanceTo(chest.position) > 4.5) {
        setActionEvidence(bot, { kind: 'chest_view', outcome: 'chest_unreachable', target, retryable: true });
        log(bot, 'Could not reach the chest to inspect it.');
        return false;
    }
    let chestContainer = null;
    try {
        chestContainer = await bot.openContainer(chest);
        const items = chestContainer.containerItems();
        if (!items.length) {
            log(bot, 'The chest is empty.');
        }
        else {
            log(bot, 'The chest contains:');
            for (const item of items) {
                log(bot, `${item.count} ${item.name}`);
            }
        }
        setActionEvidence(bot, { kind: 'chest_view', outcome: 'viewed', target, stackCount: items.length, retryable: false });
        return true;
    } catch (error) {
        setActionEvidence(bot, { kind: 'chest_view', outcome: 'view_blocked', target, error: error.message, retryable: true });
        log(bot, `Could not view the chest: ${error.message}.`);
        return false;
    } finally {
        await closeContainerQuietly(chestContainer);
    }
}

export async function consume(bot, itemName="") {
    /**
     * Eat/drink the given item.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item to eat/drink.
     * @returns {Promise<boolean>} true if the item was eaten, false otherwise.
     * @example
     * await skills.eat(bot, "apple");
     **/
    itemName = String(itemName || '').trim();
    const target = { name: itemName || 'item' };
    let item;
    if (itemName) item = bot.inventory.findInventoryItem(itemName);
    else {
        const foods = bot.registry?.foodsByName || {};
        item = bot.inventory.items()
            .filter(candidate => (
                foods[candidate.name]
                && !UNSAFE_FOOD_ITEMS.has(candidate.name)
            ))
            .sort((left, right) => (
                (Number(foods[right.name]?.foodPoints) || 0) - (Number(foods[left.name]?.foodPoints) || 0)
                || (Number(foods[right.name]?.saturation) || 0) - (Number(foods[left.name]?.saturation) || 0)
            ))[0];
        if (item) target.name = item.name;
    }
    if (!item) {
        setActionEvidence(bot, { kind: 'consume', outcome: 'missing_item', target, retryable: true });
        log(bot, `You do not have any ${itemName || 'requested item'} to consume.`);
        return false;
    }
    const beforeCount = inventoryCount(bot, item.name);
    const beforeFood = Number.isFinite(bot.food) ? bot.food : null;
    const previousHeldItem = bot.heldItem?.name || null;
    try {
        await bot.equip(item, 'hand');
        await bot.consume();
    } catch (error) {
        setActionEvidence(bot, { kind: 'consume', outcome: 'consume_blocked', target, error: error.message, retryable: true });
        log(bot, `Could not consume ${item.name}: ${error.message}.`);
        return false;
    }
    const afterCount = inventoryCount(bot, item.name);
    const afterFood = Number.isFinite(bot.food) ? bot.food : null;
    const countConfirmed = afterCount < beforeCount;
    const hungerConfirmed = beforeFood !== null && afterFood !== null && afterFood > beforeFood;
    if (!countConfirmed && !hungerConfirmed) {
        setActionEvidence(bot, {
            kind: 'consume',
            outcome: 'not_consumed',
            target,
            beforeCount,
            afterCount,
            beforeFood,
            afterFood,
            previousHeldItem,
            restoredHeldItem: false,
            retryable: true,
        });
        log(bot, `Minecraft did not confirm that ${item.name} was consumed.`);
        return false;
    }
    let restoredHeldItem = previousHeldItem === null || previousHeldItem === item.name;
    let restoreError = null;
    if (!restoredHeldItem && !bot.interrupt_code) {
        const previousItem = bot.inventory.findInventoryItem(previousHeldItem);
        if (previousItem) {
            try {
                await bot.equip(previousItem, 'hand');
                restoredHeldItem = bot.heldItem?.name === previousHeldItem;
            } catch (error) {
                restoreError = String(error?.message || error).slice(0, 240);
            }
        }
    }
    setActionEvidence(bot, {
        kind: 'consume',
        outcome: 'consumed',
        target,
        beforeCount,
        afterCount,
        beforeFood,
        afterFood,
        previousHeldItem,
        restoredHeldItem,
        ...(restoreError ? { restoreError } : {}),
        retryable: false,
    });
    log(bot, `Consumed ${item.name}.`);
    return true;
}

export function deliveryDropSpacingNeedsRetreat(botPosition, playerPosition) {
    if (![botPosition?.x, botPosition?.z, playerPosition?.x, playerPosition?.z].every(Number.isFinite)) {
        return true;
    }
    return Math.hypot(
        botPosition.x - playerPosition.x,
        botPosition.z - playerPosition.z,
    ) < DELIVERY_MIN_DROP_HORIZONTAL_DISTANCE;
}

export function deliveryDropStanceIsExclusive(botPosition, playerPosition) {
    if (![botPosition?.x, botPosition?.z, playerPosition?.x, playerPosition?.z].every(Number.isFinite)) {
        return false;
    }
    const dx = Math.abs(botPosition.x - playerPosition.x);
    const dz = Math.abs(botPosition.z - playerPosition.z);
    const distance = Math.hypot(dx, dz);
    return distance >= DELIVERY_MIN_DROP_HORIZONTAL_DISTANCE
        && distance <= DELIVERY_MAX_DROP_HORIZONTAL_DISTANCE
        && Math.min(dx, dz) <= DELIVERY_MAX_DROP_LATERAL_OFFSET;
}

function deliveryDropStances(bot, player) {
    const y = Math.floor(Number(player?.position?.y));
    const x = Math.floor(Number(player?.position?.x));
    const z = Math.floor(Number(player?.position?.z));
    if (![x, y, z].every(Number.isFinite)) return [];
    return [
        new Vec3(x + 2, y, z),
        new Vec3(x - 2, y, z),
        new Vec3(x, y, z + 2),
        new Vec3(x, y, z - 2),
    ].filter(position => {
        const feet = bot.blockAt(position);
        const head = bot.blockAt(position.offset(0, 1, 0));
        const support = bot.blockAt(position.offset(0, -1, 0));
        const center = position.offset(0.5, 0, 0.5);
        return feet?.boundingBox === 'empty'
            && head?.boundingBox === 'empty'
            && !isHazardousGameplayBlock(feet)
            && !isHazardousGameplayBlock(head)
            && !isLiquidGameplayBlock(feet)
            && !isLiquidGameplayBlock(head)
            && isSafeGameplaySupport(support)
            && deliveryDropStanceIsExclusive(center, player.position);
    }).sort((left, right) => (
        bot.entity.position.distanceTo(left.offset(0.5, 0, 0.5))
        - bot.entity.position.distanceTo(right.offset(0.5, 0, 0.5))
    ));
}

async function reachDeliveryDropStance(bot, player) {
    for (let replan = 0; replan < 2 && !bot.interrupt_code; replan += 1) {
        if (deliveryDropStanceIsExclusive(bot.entity.position, player?.position)) return true;
        const stances = deliveryDropStances(bot, player);
        if (stances.length === 0) return false;
        const routed = await goToGoal(bot, new pf.goals.GoalCompositeAny(
            stances.map(position => new pf.goals.GoalBlock(position.x, position.y, position.z)),
        ));
        if (!routed) return false;
        if (deliveryDropStanceIsExclusive(bot.entity.position, player?.position)) return true;
    }
    return false;
}

export async function giveToPlayer(bot, itemType, username, num=1) {
    /**
     * Give one of the specified item to the specified player
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemType, the name of the item to give.
     * @param {string} username, the username of the player to give the item to.
     * @param {number} num, the number of items to give. Defaults to 1.
     * @returns {Promise<boolean>} true if the item was given, false otherwise.
     * @example
     * await skills.giveToPlayer(bot, "oak_log", "player1");
     **/
    let resolution = resolvePhysicalPlayer(bot, username);
    let target = playerTargetEvidence(resolution);
    if (bot.username === username) {
        setActionEvidence(bot, { kind: 'give', outcome: 'invalid_target', target, retryable: false });
        log(bot, `You cannot give items to yourself.`);
        return false;
    }
    let player = resolution.entity;
    if (!player) {
        setActionEvidence(bot, { kind: 'give', outcome: 'lost_target', target, retryable: false });
        log(bot, `Could not find ${username}.`);
        return false;
    }
    const requested = Math.max(1, Math.floor(Number(num) || 1));
    const inventoryBefore = inventoryCount(bot, itemType);
    const transferCount = Math.min(requested, inventoryBefore);
    if (transferCount < 1) {
        setActionEvidence(bot, {
            kind: 'give',
            outcome: 'missing_item',
            target,
            item: itemType,
            requested,
            transferred: 0,
            retryable: true,
        });
        log(bot, `Cannot give ${itemType}: none is in inventory.`);
        return false;
    }
    // Item pickup is only reliable at close range. Stay outside the companion
    // personal-space floor while moving near enough for the recipient to
    // collect the exact dropped entity without chasing it.
    if (!await goToPlayer(bot, username, 1.5)) {
        return false;
    }
    resolution = resolvePhysicalPlayer(bot, username);
    target = playerTargetEvidence(resolution);
    player = resolution.entity;
    if (!player) {
        setActionEvidence(bot, { kind: 'give', outcome: 'lost_target', target, retryable: false });
        log(bot, `Could not give ${itemType}: ${username} is no longer visible.`);
        return false;
    }
    // if we are 2 below the player
    if (bot.entity.position.y < player.position.y - 1) {
        if (!await goToPlayer(bot, username, 1)) {
            return false;
        }
        resolution = resolvePhysicalPlayer(bot, username);
        target = playerTargetEvidence(resolution);
        player = resolution.entity;
        if (!player) {
            setActionEvidence(bot, { kind: 'give', outcome: 'lost_target', target, retryable: false });
            return false;
        }
    }
    // A diagonal toss can enter both pickup boxes and let the thrower reclaim
    // the item first. Use a supported cardinal stance so only the recipient
    // intersects the toss at the pickup boundary.
    if (!await reachDeliveryDropStance(bot, player)) {
        setActionEvidence(bot, {
            kind: 'give',
            outcome: 'drop_stance_unreachable',
            target,
            item: itemType,
            requested,
            transferred: 0,
            retryable: true,
        });
        log(bot, `Failed to give ${itemType} to ${username}: no safe cardinal drop stance was reachable.`);
        return false;
    }
    resolution = resolvePhysicalPlayer(bot, username);
    target = playerTargetEvidence(resolution);
    player = resolution.entity;
    if (!player) return false;

    let given = false;
    let reclaimed = false;
    let droppedEntityId = null;
    let deliveryAttempts = 0;
    let reclaimedAttempts = 0;
    const existingEntityIds = new Set(Object.values(bot.entities || {}).map(entity => entity?.id));
    const markDelivered = entityId => {
        if (given) return;
        droppedEntityId = Number.isFinite(entityId) ? entityId : droppedEntityId;
        const complete = transferCount >= requested;
        setActionEvidence(bot, {
            kind: 'give',
            outcome: complete ? 'delivered' : 'partial',
            target,
            item: itemType,
            requested,
            transferred: transferCount,
            inventoryBefore,
            inventoryAfter: inventoryCount(bot, itemType),
            droppedEntityId,
            deliveryAttempts,
            reclaimedAttempts,
            retryable: !complete,
        });
        log(bot, `${username} received ${transferCount} ${itemType}.`);
        given = true;
    };
    const isExpectedDroppedEntity = entity => {
        if (entity?.name !== 'item' || !entity.position || existingEntityIds.has(entity.id)) return false;
        let droppedItem = null;
        try { droppedItem = entity.getDroppedItem?.() || null; } catch { /* incomplete item metadata */ }
        return Boolean(
            droppedItem?.name === itemType
            && Number(droppedItem.count) === transferCount
            && bot.entity.position.distanceTo(entity.position) <= 1.75
        );
    };
    const onEntitySpawn = entity => {
        if (droppedEntityId !== null || !isExpectedDroppedEntity(entity)) return;
        droppedEntityId = Number.isFinite(entity.id) ? entity.id : null;
    };
    const onPlayerCollect = (collector, collected) => {
        if (droppedEntityId === null && isExpectedDroppedEntity(collected)) {
            droppedEntityId = collected.id;
        }
        if (
            droppedEntityId !== null
            && collector?.id === bot.entity?.id
            && collected?.id === droppedEntityId
        ) {
            reclaimed = true;
            return;
        }
        if (
            droppedEntityId !== null
            && collectorMatchesPlayerTarget(resolution, collector, {
                expectedEntityId: droppedEntityId,
                collected,
            })
        ) {
            markDelivered(droppedEntityId);
        }
    };
    // Mineflayer resolves the high-level playerCollect entities from its entity
    // map. Minecraft may destroy the dropped item before that lookup, leaving
    // `collected` undefined even though the packet carries authoritative IDs.
    // Observe the raw packet as the durable confirmation path.
    const onCollectPacket = packet => {
        const collectorEntityId = Number(packet?.collectorEntityId);
        const collectedEntityId = Number(packet?.collectedEntityId);
        const currentTarget = resolvePhysicalPlayer(bot, username);
        if (!Number.isFinite(collectorEntityId)
            || !Number.isFinite(collectedEntityId)
            || existingEntityIds.has(collectedEntityId)
            || (droppedEntityId !== null && droppedEntityId !== collectedEntityId)) {
            return;
        }
        if (currentTarget.entity?.id === collectorEntityId) {
            markDelivered(collectedEntityId);
        } else if (bot.entity?.id === collectorEntityId) {
            droppedEntityId = collectedEntityId;
            reclaimed = true;
        }
    };
    bot.on('entitySpawn', onEntitySpawn);
    bot.on('playerCollect', onPlayerCollect);
    bot._client?.on?.('collect', onCollectPacket);
    try {
        while (deliveryAttempts < MAX_DELIVERY_DROP_ATTEMPTS && !bot.interrupt_code) {
            deliveryAttempts += 1;
            droppedEntityId = null;
            reclaimed = false;
            resolution = resolvePhysicalPlayer(bot, username);
            target = playerTargetEvidence(resolution);
            player = resolution.entity;
            if (!player) {
                setActionEvidence(bot, { kind: 'give', outcome: 'lost_target', target, retryable: false });
                return false;
            }

            if (deliveryAttempts > 1) {
                if (!await reachDeliveryDropStance(bot, player)) return false;
                resolution = resolvePhysicalPlayer(bot, username);
                target = playerTargetEvidence(resolution);
                player = resolution.entity;
                if (!player) return false;
            }

            await bot.lookAt(player.position);
            if (!await discard(bot, itemType, transferCount)) return false;
            if (droppedEntityId === null) {
                const dropped = Object.values(bot.entities || {}).find(isExpectedDroppedEntity);
                droppedEntityId = Number.isFinite(dropped?.id) ? dropped.id : null;
            }
            const inventoryAfterDrop = inventoryCount(bot, itemType);
            if (inventoryBefore - inventoryAfterDrop < transferCount) {
                setActionEvidence(bot, {
                    kind: 'give',
                    outcome: 'inventory_not_decremented',
                    target,
                    item: itemType,
                    requested,
                    transferred: 0,
                    inventoryBefore,
                    inventoryAfter: inventoryAfterDrop,
                    deliveryAttempts,
                    reclaimedAttempts,
                    retryable: true,
                });
                return false;
            }

            const pickupStartedAt = Date.now();
            while (!given && !reclaimed && !bot.interrupt_code) {
                await new Promise(resolve => setTimeout(resolve, 100));
                if (Date.now() - pickupStartedAt > DELIVERY_PICKUP_TIMEOUT_MS) break;
            }
            if (given) return true;
            if (!reclaimed || deliveryAttempts >= MAX_DELIVERY_DROP_ATTEMPTS) break;
            reclaimedAttempts += 1;
            const reacquired = await waitForWorldCondition(
                bot,
                () => inventoryCount(bot, itemType) >= transferCount,
                750,
                25,
            );
            if (!reacquired) break;
        }
    } finally {
        bot.removeListener('entitySpawn', onEntitySpawn);
        bot.removeListener('playerCollect', onPlayerCollect);
        bot._client?.removeListener?.('collect', onCollectPacket);
    }
    setActionEvidence(bot, {
        kind: 'give',
        outcome: 'not_received',
        target,
        item: itemType,
        requested,
        transferred: 0,
        dropped: transferCount,
        inventoryBefore,
        inventoryAfter: inventoryCount(bot, itemType),
        droppedEntityId,
        deliveryAttempts,
        reclaimedAttempts,
        retryable: true,
    });
    log(bot, `Failed to give ${itemType} to ${username}, it was never received.`);
    return false;
}

export async function giveFamilyToPlayer(bot, family, username, num=1) {
    family = String(family || '').trim();
    const requested = Math.max(1, Math.min(2304, Math.floor(Number(num) || 1)));
    const before = familyInventoryCount(bot, family);
    const target = playerTargetEvidence(resolvePhysicalPlayer(bot, username), { family });
    if (!['logs', 'planks', 'food', 'ores', 'building_blocks'].includes(family)) {
        setActionEvidence(bot, { kind: 'family_give', outcome: 'unsupported_family', target, retryable: false });
        return false;
    }
    if (before < 1) {
        setActionEvidence(bot, { kind: 'family_give', outcome: 'family_missing', target, retryable: true });
        log(bot, `There are no ${family} to give to ${username}.`);
        return false;
    }
    let remaining = Math.min(requested, before);
    let allVerified = true;
    for (const entry of familyInventoryEntries(bot, family)) {
        if (remaining < 1 || bot.interrupt_code) break;
        const amount = Math.min(remaining, entry.count);
        if (!await giveToPlayer(bot, entry.name, username, amount)) {
            allVerified = false;
            break;
        }
        remaining -= amount;
    }
    const after = familyInventoryCount(bot, family);
    const transferred = Math.max(0, before - after);
    const expected = Math.min(requested, before);
    const success = allVerified && transferred >= expected;
    setActionEvidence(bot, {
        kind: 'family_give',
        outcome: success ? 'delivered' : bot.interrupt_code ? 'interrupted' : transferred > 0 ? 'partial' : 'delivery_blocked',
        target,
        requested: expected,
        transferred,
        retryable: !success && !bot.interrupt_code,
    });
    log(bot, success
        ? `Delivered ${transferred} ${family} across all carried item types to ${username}.`
        : `Delivered ${transferred} of ${expected} requested ${family} to ${username}.`);
    return success;
}

function navigationTarget(goal) {
    if (![goal?.x, goal?.y, goal?.z].every(Number.isFinite)) return null;
    return {
        x: Math.floor(goal.x),
        y: Math.floor(goal.y),
        z: Math.floor(goal.z),
    };
}

function navigationGoalMetric(goal, position) {
    if (!goal || !position) return null;
    try {
        const node = position.floored();
        if (goal.isEnd?.(node)) return Number.NEGATIVE_INFINITY;
        const value = Number(goal.heuristic?.(node));
        return Number.isFinite(value) ? value : null;
    } catch {
        return null;
    }
}

function navigationGoalSignature(goal) {
    const target = navigationTarget(goal);
    return target ? `${target.x}:${target.y}:${target.z}` : String(goal?.constructor?.name || 'goal');
}

function startNavigationProgressWatchdog(bot, goal, stallTimeoutMs = NAVIGATION_STALL_TIMEOUT_MS) {
    const startedAt = Date.now();
    const startPosition = bot.entity.position.clone();
    let checkpoint = startPosition.clone();
    let lastPosition = startPosition.clone();
    const startMetric = navigationGoalMetric(goal, startPosition);
    let bestMetric = startMetric;
    let goalSignature = navigationGoalSignature(goal);
    let lastProgressAt = startedAt;
    let lastDigTarget = bot.targetDigBlock?.position?.toString?.() || null;
    let interval = null;
    const stalled = new Promise(resolve => {
        interval = setInterval(() => {
            const current = bot.entity?.position;
            if (!current) return;
            lastPosition = current.clone();
            const digTarget = bot.targetDigBlock?.position?.toString?.() || null;
            const nextSignature = navigationGoalSignature(goal);
            const metric = navigationGoalMetric(goal, current);
            const targetChanged = nextSignature !== goalSignature;
            const metricProgress = Number.isFinite(metric)
                && (!Number.isFinite(bestMetric) || metric <= bestMetric - NAVIGATION_GOAL_PROGRESS_DELTA);
            // A native route may legitimately move sideways around collision
            // geometry or out of a movement medium before its straight-line
            // goal metric improves. Verified body displacement is still real
            // progress and must keep the silence watchdog from cancelling the
            // route; the action deadline remains the outer convergence bound.
            const physicalProgress = checkpoint.distanceTo(current) >= NAVIGATION_PROGRESS_DISTANCE;
            if (targetChanged || metricProgress || physicalProgress || digTarget !== lastDigTarget) {
                checkpoint = current.clone();
                if (targetChanged) {
                    goalSignature = nextSignature;
                    bestMetric = metric;
                } else if (metricProgress) {
                    bestMetric = metric;
                }
                lastDigTarget = digTarget;
                lastProgressAt = Date.now();
                return;
            }
            if (Date.now() - lastProgressAt >= stallTimeoutMs) {
                clearInterval(interval);
                interval = null;
                resolve({
                    state: 'stalled',
                    startedAt,
                    stalledMs: Date.now() - lastProgressAt,
                    startPosition,
                    lastPosition,
                    startMetric,
                    bestMetric,
                    lastMetric: metric,
                });
            }
        }, NAVIGATION_PROGRESS_POLL_MS);
    });
    return {
        stalled,
        stop() {
            if (interval) clearInterval(interval);
            interval = null;
        },
    };
}

function stopNavigationGoal(bot) {
    try {
        bot.pathfinder.setGoal(null);
    } catch {
        try { bot.pathfinder.stop(); } catch { /* best-effort navigation cleanup */ }
    }
}

async function runNavigationAttempt(bot, goal, movements, stallTimeoutMs = NAVIGATION_STALL_TIMEOUT_MS) {
    const progressWatchdog = startNavigationProgressWatchdog(bot, goal, stallTimeoutMs);
    bot.pathfinder.setMovements(movements);
    const navigation = Promise.resolve()
        .then(() => bot.pathfinder.goto(goal))
        .then(
            () => ({ state: 'resolved' }),
            error => ({ state: 'rejected', error }),
        );
    try {
        const outcome = await Promise.race([navigation, progressWatchdog.stalled]);
        const pathfinderState = bot.pathfinder.getLastStuckState?.();
        if (pathfinderState) outcome.pathfinder = pathfinderState;
        if (outcome.state === 'stalled') {
            stopNavigationGoal(bot);
            // Do not release ActionManager while the cancelled path promise is
            // still alive. A new route must never race stale movement from the
            // operation that just timed out.
            await navigation;
        }
        return outcome;
    } finally {
        progressWatchdog.stop();
    }
}

function shouldTryNavigationRecovery(bot, outcome) {
    if (bot.interrupt_code || !outcome) return false;
    if (outcome.state === 'stalled') return true;
    if (outcome.state !== 'rejected') return false;
    return ['unreachable', 'path_timeout'].includes(pathfinderErrorOutcome(outcome.error, false));
}

function shouldTrySurvivableDescent(bot, goal, outcome) {
    if (!shouldTryNavigationRecovery(bot, outcome)) return false;
    const target = navigationTarget(goal);
    const currentY = Number(bot.entity?.position?.y);
    return Boolean(
        target
        && Number.isFinite(currentY)
        && target.y < currentY - DEFAULT_MAX_DROP_DOWN
        && survivableDropDistance(bot) > DEFAULT_MAX_DROP_DOWN
    );
}

function navigationOutcomeName(outcome, bot) {
    if (outcome?.state === 'rejected') {
        return pathfinderErrorOutcome(outcome.error, Boolean(bot.interrupt_code));
    }
    return outcome?.state || 'unknown';
}

function isTraversableShoreSupport(block) {
    return Boolean(
        block
        && block.boundingBox !== 'empty'
        && !isLiquidGameplayBlock(block)
        && !isHazardousGameplayBlock(block)
    );
}

function shallowWaterExitCandidates(bot) {
    const origin = bot.entity?.position?.floored?.();
    if (!origin) return [];
    const clear = block => Boolean(
        block
        && block.boundingBox === 'empty'
        && !isLiquidGameplayBlock(block)
        && !isHazardousGameplayBlock(block)
    );
    const candidates = [];
    for (let radius = 1; radius <= SHALLOW_WATER_SHORE_SCAN_RADIUS; radius += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
            for (let dz = -radius; dz <= radius; dz += 1) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
                // From a water cell, the bot's feet often land two Y levels
                // higher on top of a one-block bank. Wider water needs the
                // same check beyond the eight adjacent cells.
                for (const yOffset of [2, 1, 0, 3, -1]) {
                    const feetPosition = origin.offset(dx, yOffset, dz);
                    const feet = bot.blockAt(feetPosition);
                    const head = bot.blockAt(feetPosition.offset(0, 1, 0));
                    const support = bot.blockAt(feetPosition.offset(0, -1, 0));
                    // Sand and gravel are poor excavation foundations but
                    // ordinary shore surfaces. Accept them for the bounded
                    // water-exit nudge; the caller still routes to a stable
                    // mining staging cell before any excavation begins.
                    if (!clear(feet) || !clear(head) || !isTraversableShoreSupport(support)) continue;
                    candidates.push({
                        position: feetPosition,
                        support: support.name,
                        distance: bot.entity.position.distanceTo(feetPosition),
                        horizontalDistance: Math.hypot(dx, dz),
                    });
                    break;
                }
            }
        }
    }
    return candidates.sort((left, right) => left.distance - right.distance);
}

async function attemptShallowWaterExit(bot) {
    const start = bot.entity?.position?.clone?.();
    const feet = start ? bot.blockAt(start.floored()) : null;
    if (!start || (!bot.entity?.isInWater && !isLiquidGameplayBlock(feet))) {
        return { success: false, strategy: 'shallow_water_exit', outcome: 'not_in_water' };
    }
    const candidates = shallowWaterExitCandidates(bot);
    // Ordinary water-to-shore locomotion belongs to Pathfinder. Bind it to an
    // exact loaded landing cell so probing and execution use the same movement
    // policy, and prefer stable inland support over a merely traversable sand
    // or gravel lip. The old direct-control loop kept aiming at the bank cell
    // after climbing onto it and could report success even when the requested
    // inland movement never happened.
    const stable = candidates.filter(candidate => {
        const support = bot.blockAt(candidate.position.offset(0, -1, 0));
        return isSafeGameplaySupport(support);
    });
    const ordered = [...stable, ...candidates.filter(candidate => !stable.includes(candidate))]
        .slice(0, 4);
    let lastOutcome = null;
    for (const candidate of ordered) {
        if (bot.interrupt_code || remainingActionTimeMs() <= 0) break;
        const goal = new pf.goals.GoalBlock(
            candidate.position.x,
            candidate.position.y,
            candidate.position.z,
        );
        try {
            lastOutcome = await runNavigationAttempt(
                bot,
                goal,
                safeMovements(bot),
                Math.min(SHALLOW_WATER_EXIT_TIMEOUT_MS, remainingActionTimeMs(SHALLOW_WATER_EXIT_TIMEOUT_MS)),
            );
        } catch (error) {
            if (bot.interrupt_code) break;
            lastOutcome = { state: 'rejected', error };
        }
        const position = bot.entity?.position?.floored?.();
        const currentFeet = position ? bot.blockAt(position) : null;
        const support = position ? bot.blockAt(position.offset(0, -1, 0)) : null;
        const exited = lastOutcome?.state === 'resolved'
            && !isLiquidGameplayBlock(currentFeet)
            && isTraversableShoreSupport(support);
        if (exited) {
            return {
                success: true,
                strategy: 'pathfinder_shore_exit',
                outcome: isSafeGameplaySupport(support) ? 'stable_shore_reached' : 'shore_reached',
                target: {
                    x: candidate.position.x,
                    y: candidate.position.y,
                    z: candidate.position.z,
                    support: support.name,
                },
                distance: Math.round(bot.entity.position.distanceTo(start) * 100) / 100,
            };
        }
    }
    return {
        success: false,
        strategy: 'pathfinder_shore_exit',
        outcome: candidates.length > 0 ? 'shore_unreached' : 'no_safe_shore',
        candidates: candidates.length,
        pathOutcome: navigationOutcomeName(lastOutcome, bot),
    };
}

async function attemptLocalNavigationEscape(bot) {
    const start = bot.entity.position.clone();
    const origin = start.floored();
    const recovery = localNavigationRecoveryMovements(bot, origin);
    const escapeGoal = new pf.goals.GoalInvert(new pf.goals.GoalNear(
        origin.x,
        origin.y,
        origin.z,
        NAVIGATION_RECOVERY_DISTANCE,
    ));
    const outcome = await runNavigationAttempt(
        bot,
        escapeGoal,
        recovery.movements,
        NAVIGATION_RECOVERY_STALL_TIMEOUT_MS,
    );
    const moved = bot.entity.position.distanceTo(start);
    return {
        success: !bot.interrupt_code && moved >= NAVIGATION_PROGRESS_DISTANCE,
        strategy: recovery.foliageCount > 0 ? 'local_foliage_escape' : 'safe_local_sidestep',
        foliageCandidates: recovery.foliageCount,
        distance: Math.round(moved * 100) / 100,
        outcome: outcome.state === 'rejected'
            ? pathfinderErrorOutcome(outcome.error, Boolean(bot.interrupt_code))
            : outcome.state,
    };
}

function navigationProgressEvidence(outcome) {
    return {
        startedAt: outcome.startedAt,
        stalledMs: outcome.stalledMs,
        startMetric: Number.isFinite(outcome.startMetric) ? outcome.startMetric : null,
        bestMetric: Number.isFinite(outcome.bestMetric) ? outcome.bestMetric : null,
        lastMetric: Number.isFinite(outcome.lastMetric) ? outcome.lastMetric : null,
        startPosition: {
            x: outcome.startPosition.x,
            y: outcome.startPosition.y,
            z: outcome.startPosition.z,
        },
        lastPosition: {
            x: outcome.lastPosition.x,
            y: outcome.lastPosition.y,
            z: outcome.lastPosition.z,
        },
        ...(outcome.pathfinder ? { pathfinder: outcome.pathfinder } : {}),
    };
}

export async function goToGoal(bot, goal, options = {}) {
    /**
     * Navigate to the given goal. Use doors and attempt minimally destructive movements.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {pf.goals.Goal} goal, the goal to navigate to.
     * @param {object} options, optional movement policy factory and recovery controls.
     **/
    const signal = options?.signal || actionCancellationSignal();
    const aborted = () => signal?.aborted === true;
    const stopForAbort = () => {
        stopNavigationGoal(bot);
        try { bot.clearControlStates?.(); } catch { /* best-effort abort cleanup */ }
    };
    if (aborted() || remainingActionTimeMs() <= 0) return false;
    signal?.addEventListener?.('abort', stopForAbort, { once: true });
    const movementFactory = typeof options?.movements === 'function'
        ? options.movements
        : options?.movements
            ? () => options.movements
            : () => safeMovements(bot);
    const requestedStallTimeoutMs = Math.max(
        NAVIGATION_STALL_TIMEOUT_MS,
        Math.min(30_000, Number(options?.stallTimeoutMs) || NAVIGATION_STALL_TIMEOUT_MS),
    );
    const navigationStallTimeoutMs = Math.max(
        250,
        Math.min(requestedStallTimeoutMs, remainingActionTimeMs(requestedStallTimeoutMs)),
    );
    bot.mindcraftManagedNavigationDepth = Math.max(
        0,
        Number(bot.mindcraftManagedNavigationDepth) || 0,
    ) + 1;
    const doorCheckInterval = startDoorInterval(bot);
    try {
        let recovery = null;
        let currentFeet = bot.entity?.position
            ? bot.blockAt(bot.entity.position.floored())
            : null;
        const initialTarget = navigationTarget(goal);
        const initialY = Number(bot.entity?.position?.y);
        let shallowWaterAttempted = false;
        if (
            !bot.interrupt_code
            && !aborted()
            && (bot.entity?.isInWater || isLiquidGameplayBlock(currentFeet))
            && (!initialTarget || !Number.isFinite(initialY) || initialTarget.y >= Math.floor(initialY))
        ) {
            shallowWaterAttempted = true;
            recovery = await attemptShallowWaterExit(bot);
            if (aborted()) return false;
            if (recovery.success) {
                log(bot, 'Navigation stepped out of shallow water before routing to the requested goal.');
            }
        }
        let outcome = goal?.isEnd?.(bot.entity.position.floored())
            ? { state: 'resolved' }
            : await runNavigationAttempt(bot, goal, movementFactory(), navigationStallTimeoutMs);
        if (aborted()) return false;
        currentFeet = bot.entity?.position
            ? bot.blockAt(bot.entity.position.floored())
            : null;
        if (
            shouldTryNavigationRecovery(bot, outcome)
            && !shallowWaterAttempted
            && (bot.entity?.isInWater || isLiquidGameplayBlock(currentFeet))
        ) {
            recovery = await attemptShallowWaterExit(bot);
            if (aborted()) return false;
            if (recovery.success) {
                log(bot, 'Navigation stepped out of shallow water and is retrying the requested route.');
                outcome = await runNavigationAttempt(bot, goal, movementFactory(), navigationStallTimeoutMs);
                if (aborted()) return false;
            }
        }
        if (
            options?.allowHealthBoundedDescent !== false
            && shouldTrySurvivableDescent(bot, goal, outcome)
        ) {
            const maxDropDown = survivableDropDistance(bot);
            outcome = await runNavigationAttempt(
                bot,
                goal,
                safeDescentMovements(bot),
                navigationStallTimeoutMs,
            );
            if (aborted()) return false;
            const descentRecovery = {
                success: outcome.state === 'resolved' && !bot.interrupt_code,
                strategy: 'health_bounded_descent',
                maxDropDown,
                outcome: navigationOutcomeName(outcome, bot),
            };
            recovery = recovery
                ? { ...descentRecovery, previous: recovery }
                : descentRecovery;
            if (descentRecovery.success) {
                log(bot, `Used a verified landing route with a health-bounded ${maxDropDown}-block descent.`);
            }
        }
        let recoveryAttempts = 0;
        while (
            options?.allowLocalRecovery !== false
            &&
            recoveryAttempts < MAX_NAVIGATION_RECOVERY_ATTEMPTS
            && shouldTryNavigationRecovery(bot, outcome)
        ) {
            const localRecovery = await attemptLocalNavigationEscape(bot);
            if (aborted()) return false;
            recovery = recovery
                ? { ...localRecovery, previous: recovery }
                : localRecovery;
            recoveryAttempts += 1;
            recovery.attempt = recoveryAttempts;
            if (!recovery.success) break;
            const recoveryAction = recovery.strategy === 'local_foliage_escape'
                ? 'a bounded local foliage escape'
                : 'a safe Pathfinder sidestep';
            log(bot, `Navigation made ${recoveryAction} ${recoveryAttempts}/${MAX_NAVIGATION_RECOVERY_ATTEMPTS} and is retrying the route.`);
            outcome = await runNavigationAttempt(bot, goal, movementFactory(), navigationStallTimeoutMs);
            if (aborted()) return false;
        }
        if (outcome.state === 'stalled') {
            const target = navigationTarget(goal);
            setActionEvidence(bot, {
                kind: 'movement',
                outcome: 'path_stalled',
                ...(target ? { target } : {}),
                progress: navigationProgressEvidence(outcome),
                ...(recovery ? { recovery } : {}),
                retryable: true,
            });
            if (outcome.pathfinder) {
                const stuck = outcome.pathfinder;
                log(bot, `Pathfinder stalled in ${stuck.executionMode} at ${stuck.position.x.toFixed(2)}, ${stuck.position.y.toFixed(2)}, ${stuck.position.z.toFixed(2)} toward ${stuck.nextPoint.x}, ${stuck.nextPoint.y}, ${stuck.nextPoint.z}.`);
            }
            log(bot, `Navigation stopped after ${Math.round(outcome.stalledMs / 1000)} seconds without physical progress.`);
            return false;
        }
        if (outcome.state === 'rejected') {
            const failure = pathfinderErrorOutcome(outcome.error, Boolean(bot.interrupt_code));
            setActionEvidence(bot, {
                kind: 'movement',
                outcome: failure,
                error: String(outcome.error?.message || outcome.error).slice(0, 240),
                ...(recovery ? { recovery } : {}),
                retryable: failure !== 'interrupted',
            });
            log(bot, failure === 'unreachable'
                ? 'No safe path reaches the requested goal, including the bounded local escape route.'
                : `Navigation stopped (${failure.replace(/_/g, ' ')}): ${outcome.error?.message || outcome.error}.`);
            return false;
        }
        if (bot.interrupt_code || aborted()) {
            setActionEvidence(bot, {
                kind: 'movement',
                outcome: 'interrupted',
                ...(recovery ? { recovery } : {}),
                retryable: false,
            });
            log(bot, 'Navigation was interrupted before arrival.');
            return false;
        }
        const arrived = Boolean(goal?.isEnd?.(bot.entity.position.floored()));
        if (!arrived) {
            setActionEvidence(bot, {
                kind: 'movement',
                outcome: 'goal_not_reached',
                ...(recovery ? { recovery } : {}),
                retryable: true,
            });
            log(bot, 'Pathfinder stopped without satisfying the requested goal.');
            return false;
        }
        setActionEvidence(bot, {
            kind: 'movement',
            outcome: 'arrived',
            ...(recovery ? { recovery } : {}),
        });
        return true;
    } catch (err) {
        const outcome = pathfinderErrorOutcome(err, Boolean(bot.interrupt_code || aborted()));
        setActionEvidence(bot, {
            kind: 'movement',
            outcome,
            error: String(err?.message || err).slice(0, 240),
            retryable: outcome !== 'interrupted',
        });
        log(bot, outcome === 'unreachable'
            ? 'No safe path reaches the requested goal.'
            : `Navigation stopped (${outcome.replace(/_/g, ' ')}): ${err?.message || err}.`);
        return false;
    } finally {
        signal?.removeEventListener?.('abort', stopForAbort);
        clearDoorInterval(bot, doorCheckInterval);
        // mineflayer-pathfinder retains failed static goals. Leaving one behind
        // made the generic unstuck mode think later crafting or inventory work
        // was stalled movement and interrupt it. Every bounded navigation call
        // owns and clears its goal before releasing action control.
        stopNavigationGoal(bot);
        bot.mindcraftManagedNavigationDepth = Math.max(
            0,
            (Number(bot.mindcraftManagedNavigationDepth) || 1) - 1,
        );
    }
}

function clearDoorInterval(bot, interval = doorIntervals.get(bot)) {
    if (interval) clearInterval(interval);
    if (!interval || doorIntervals.get(bot) === interval) doorIntervals.delete(bot);
}
function startDoorInterval(bot) {
    /**
     * Start helper interval that opens nearby doors if the bot is stuck.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {number} the interval id.
     **/
    clearDoorInterval(bot);
    let prev_pos = bot.entity.position.clone();
    let prev_check = Date.now();
    let stuck_time = 0;
    let activationPending = false;
    const candidateOffsets = [
        [0, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
        [0, 0, -1],
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 1],
        [0, 1, -1],
        [1, 1, 0],
        [-1, 1, 0],
    ];
    const isFallbackOpenable = (block) => {
        const name = String(block?.name || '');
        if (
            !name
            || name.includes('iron')
            || name.includes('trapdoor')
            || (!name.endsWith('_door') && !name.includes('fence_gate'))
        ) return false;
        try {
            const properties = block.getProperties?.() || block._properties || {};
            return properties.open !== true;
        } catch {
            return false;
        }
    };

    const doorCheckInterval = setInterval(() => {
        const now = Date.now();
        if (bot.entity.position.distanceTo(prev_pos) >= 0.1) {
            stuck_time = 0;
        } else {
            stuck_time += now - prev_check;
        }
        
        if (stuck_time > 1200 && !activationPending && !bot.interrupt_code) {
            const origin = bot.entity.position.floored();
            const block = candidateOffsets
                .map(([x, y, z]) => bot.blockAt(origin.offset(x, y, z)))
                .find(isFallbackOpenable);
            if (block) {
                activationPending = true;
                void Promise.resolve()
                    .then(() => bot.activateBlock(block))
                    .catch((error) => {
                        console.warn(
                            `[movement] Door fallback could not activate ${block.name} at ${block.position}: `
                            + String(error?.message || error).slice(0, 240),
                        );
                    })
                    .finally(() => {
                        activationPending = false;
                    });
            }
            stuck_time = 0;
        }
        prev_pos = bot.entity.position.clone();
        prev_check = now;
    }, 200);
    doorIntervals.set(bot, doorCheckInterval);
    return doorCheckInterval;
}

function miningTargetBlockNames(resourceName) {
    const requested = String(resourceName || '').trim().toLowerCase();
    if (requested === 'cobblestone' || requested === 'stone') {
        return new Set(['stone', 'deepslate', 'tuff']);
    }
    if (requested.endsWith('_ore') && !requested.startsWith('deepslate_')) {
        return new Set([requested, `deepslate_${requested}`]);
    }
    return new Set([requested]);
}

function nearestKnownMiningTarget(bot, resourceName = '') {
    const origin = bot.entity?.position;
    if (!origin || !resourceName || typeof bot.findBlocks !== 'function') return null;
    const names = miningTargetBlockNames(resourceName);
    try {
        const blocks = (bot.findBlocks({
            matching: block => names.has(block?.name),
            maxDistance: 64,
            count: 24,
        }) || [])
            .map(position => bot.blockAt(position))
            .filter(block => block?.position && names.has(block.name));
        blocks.sort((left, right) => {
            const leftHorizontal = Math.hypot(left.position.x - origin.x, left.position.z - origin.z);
            const rightHorizontal = Math.hypot(right.position.x - origin.x, right.position.z - origin.z);
            const leftScore = leftHorizontal + (Math.abs(left.position.y - origin.y) * 2);
            const rightScore = rightHorizontal + (Math.abs(right.position.y - origin.y) * 2);
            return leftScore - rightScore || leftHorizontal - rightHorizontal;
        });
        // A merely known block is not yet a usable route target. If every
        // nearby block lacks a stable prospective side stance, let the mining
        // controller use its supported exploratory corridor instead of
        // repeatedly accepting GoalNear at an impossible vertical target.
        return blocks.find(block => (
            prospectiveMiningStandingPositions(bot, block).length > 0
        )) || null;
    } catch {
        return null;
    }
}

function orderedMiningHeadings(bot, resourceName = '', knownTarget = null) {
    const headings = [
        { x: 1, z: 0 },
        { x: -1, z: 0 },
        { x: 0, z: 1 },
        { x: 0, z: -1 },
    ];
    const origin = bot.entity?.position;
    const targetPosition = knownTarget?.position || null;
    const preferred = targetPosition && origin
        ? {
            x: targetPosition.x - origin.x,
            z: targetPosition.z - origin.z,
        }
        : {
            x: -Math.sin(Number(bot.entity?.yaw) || 0),
            z: -Math.cos(Number(bot.entity?.yaw) || 0),
        };
    return headings.sort((left, right) => (
        (right.x * preferred.x) + (right.z * preferred.z)
        - ((left.x * preferred.x) + (left.z * preferred.z))
    ));
}

function isMiningTargetExposed(bot, targetBlock) {
    if (!targetBlock?.position) return false;
    return [
        [1, 0, 0], [-1, 0, 0], [0, 1, 0],
        [0, -1, 0], [0, 0, 1], [0, 0, -1],
    ].some(([x, y, z]) => (
        bot.blockAt(targetBlock.position.offset(x, y, z))?.boundingBox === 'empty'
    ));
}

function prospectiveMiningStandingPositions(bot, targetBlock) {
    const target = targetBlock?.position;
    const origin = bot.entity?.position;
    if (!target?.offset || !origin) return [];

    // These cells may still be solid. A pre-carve raycast would hit the
    // candidate itself, so cardinal adjacency proves future visibility.
    const canBecomeClear = (position) => {
        let block;
        try {
            block = bot.blockAt(position);
        } catch {
            return false;
        }
        return isCollectionStandingCellClear(block) || isNaturalFillBlock(bot, block);
    };
    const positions = [];
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const feet = target.offset(x, 0, z);
        let support;
        try {
            support = bot.blockAt(feet.offset(0, -1, 0));
        } catch {
            continue;
        }
        if (!canBecomeClear(feet)) continue;
        if (!canBecomeClear(feet.offset(0, 1, 0))) continue;
        if (!isSafeGameplaySupport(support)) continue;
        positions.push(feet);
    }
    positions.sort((left, right) => (
        origin.distanceTo(left) - origin.distanceTo(right)
        || left.x - right.x
        || left.z - right.z
    ));
    return positions;
}

function isStableMiningStagingCell(bot, feet) {
    const standing = bot.blockAt(feet);
    const head = bot.blockAt(feet.offset(0, 1, 0));
    const support = bot.blockAt(feet.offset(0, -1, 0));
    if (
        !isCollectionStandingCellClear(standing)
        || !isCollectionStandingCellClear(head)
        || !isSafeGameplaySupport(support)
        || isFallingGameplayBlock(support)
    ) return false;

    // Keep the staircase mouth one full cell away from liquid. Natural-fill
    // safety deliberately rejects blocks beside water, so staging on the
    // waterline can never produce a legal first stair.
    for (let dx = -1; dx <= 1; dx += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
            for (const yOffset of [-1, 0]) {
                if (isLiquidGameplayBlock(bot.blockAt(feet.offset(dx, yOffset, dz)))) return false;
            }
        }
    }
    return true;
}

function stableMiningStagingCandidates(bot) {
    const origin = bot.entity?.position?.floored?.();
    if (!origin) return [];
    const candidates = [];
    for (let radius = 0; radius <= MINING_STAGING_SCAN_RADIUS; radius += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
            for (let dz = -radius; dz <= radius; dz += 1) {
                if (radius > 0 && Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
                for (const yOffset of [0, 1, -1, 2]) {
                    const feet = origin.offset(dx, yOffset, dz);
                    if (!isStableMiningStagingCell(bot, feet)) continue;
                    candidates.push({
                        position: feet,
                        distance: bot.entity.position.distanceTo(feet),
                    });
                    break;
                }
            }
        }
        if (candidates.length >= MAX_MINING_STAGING_ATTEMPTS) break;
    }
    return candidates.sort((left, right) => left.distance - right.distance);
}

async function stageMiningStaircase(bot) {
    const current = observedSupportedStandingCell(bot);
    if (!current) return false;
    if (isStableMiningStagingCell(bot, current)) {
        const settled = await waitForWorldCondition(
            bot,
            () => physicallyOccupiesStandingCell(bot, current),
            GROUND_SETTLE_TIMEOUT_MS,
            25,
        );
        if (settled) return true;
    }

    const candidates = stableMiningStagingCandidates(bot);
    for (const candidate of candidates.slice(0, MAX_MINING_STAGING_ATTEMPTS)) {
        const reached = await goToGoal(
            bot,
            new pf.goals.GoalBlock(
                candidate.position.x,
                candidate.position.y,
                candidate.position.z,
            ),
            {
                movements: () => {
                    const movements = safeMovements(bot);
                    movements.canDig = false;
                    movements.allow1by1towers = false;
                    movements.allowParkour = false;
                    return movements;
                },
                stallTimeoutMs: NAVIGATION_STALL_TIMEOUT_MS,
                allowHealthBoundedDescent: false,
                allowLocalRecovery: false,
            },
        );
        if (bot.interrupt_code) return false;
        if (
            (reached || physicallyOccupiesStandingCell(bot, candidate.position))
            && isStableMiningStagingCell(bot, candidate.position)
        ) {
            log(bot, 'Reached stable dry ground before opening the mining staircase.');
            return true;
        }
    }
    return false;
}

// Depth relocation has no selected block coordinate to converge on. Preserve
// its bounded exploratory fallback separately; exact buried targets never use
// this dig-enabled route.
async function carveExploratoryDepthRoute(bot, targetY) {
    const legHeight = 6;
    const targetTolerance = 1;
    const headings = orderedMiningHeadings(bot);
    let headingIndex = 0;
    let legs = 0;
    const maximumLegs = Math.max(
        1,
        Math.ceil(Math.max(0, bot.entity.position.y - targetY) / legHeight) + 2,
    );
    while (
        !bot.interrupt_code
        && bot.entity.position.y > targetY + targetTolerance
        && legs < maximumLegs
    ) {
        let advanced = false;
        for (let attempt = 0; attempt < Math.min(MAX_MINING_ROUTE_HEADINGS, headings.length); attempt++) {
            const heading = headings[(headingIndex + attempt) % headings.length];
            const start = bot.entity.position.clone();
            const drop = Math.min(legHeight, Math.max(1, Math.floor(start.y) - targetY));
            const run = drop + 2;
            const reached = await goToGoal(
                bot,
                new pf.goals.GoalNear(
                    Math.floor(start.x) + (heading.x * run),
                    Math.floor(start.y) - drop,
                    Math.floor(start.z) + (heading.z * run),
                    1,
                ),
                {
                    movements: () => miningMovements(bot),
                    stallTimeoutMs: MINING_ROUTE_STALL_TIMEOUT_MS,
                    allowHealthBoundedDescent: false,
                    allowLocalRecovery: false,
                },
            );
            if (bot.interrupt_code) break;
            const verticalProgress = start.y - bot.entity.position.y;
            if (reached || verticalProgress >= Math.max(2, drop - 1)) {
                headingIndex = (headingIndex + attempt) % headings.length;
                legs += 1;
                advanced = true;
                break;
            }
        }
        if (!advanced) break;
    }
    return {
        success: !bot.interrupt_code && bot.entity.position.y <= targetY + targetTolerance,
        legs,
        observedY: bot.entity.position.y,
    };
}

const MINING_ROUTE_VARIANTS = Object.freeze([
    Object.freeze({ axisPhase: 0, wiggleAxis: 'x', wiggleSign: 1 }),
    Object.freeze({ axisPhase: 1, wiggleAxis: 'x', wiggleSign: 1 }),
    Object.freeze({ axisPhase: 0, wiggleAxis: 'x', wiggleSign: -1 }),
    Object.freeze({ axisPhase: 1, wiggleAxis: 'x', wiggleSign: -1 }),
    Object.freeze({ axisPhase: 0, wiggleAxis: 'z', wiggleSign: 1 }),
    Object.freeze({ axisPhase: 1, wiggleAxis: 'z', wiggleSign: 1 }),
    Object.freeze({ axisPhase: 0, wiggleAxis: 'z', wiggleSign: -1 }),
    Object.freeze({ axisPhase: 1, wiggleAxis: 'z', wiggleSign: -1 }),
]);

function sameMiningCell(left, right) {
    return Boolean(
        left
        && right
        && left.x === right.x
        && left.y === right.y
        && left.z === right.z
    );
}

function miningCellKey(position) {
    return `${position.x}:${position.y}:${position.z}`;
}

function miningRouteHeading(current, target, variant, stepIndex) {
    const dx = target.x - current.x;
    const dz = target.z - current.z;
    const xHeading = dx === 0 ? null : { x: Math.sign(dx), z: 0 };
    const zHeading = dz === 0 ? null : { x: 0, z: Math.sign(dz) };
    if (xHeading && zHeading) {
        return (stepIndex + variant.axisPhase) % 2 === 0 ? xHeading : zHeading;
    }
    if (xHeading) return xHeading;
    if (zHeading) return zHeading;
    return variant.wiggleAxis === 'x'
        ? { x: variant.wiggleSign, z: 0 }
        : { x: 0, z: variant.wiggleSign };
}

function planMiningVoxelCorridor(origin, stance, variant) {
    const route = [];
    let current = origin.clone();
    const verticalDirection = Math.sign(stance.y - current.y);
    const verticalSteps = Math.abs(stance.y - current.y);
    for (let index = 0; index < verticalSteps; index += 1) {
        const heading = miningRouteHeading(current, stance, variant, index);
        current = current.offset(heading.x, verticalDirection, heading.z);
        route.push({ position: current, heading, yOffset: verticalDirection });
    }
    let horizontalIndex = verticalSteps;
    while (current.x !== stance.x || current.z !== stance.z) {
        const heading = miningRouteHeading(current, stance, variant, horizontalIndex);
        current = current.offset(heading.x, 0, heading.z);
        route.push({ position: current, heading, yOffset: 0 });
        horizontalIndex += 1;
    }
    return route;
}

function miningRouteHeuristic(position, stance) {
    const horizontal = Math.abs(stance.x - position.x) + Math.abs(stance.z - position.z);
    const vertical = Math.abs(stance.y - position.y);
    return Math.max(horizontal, vertical);
}

function pushMiningRouteNode(heap, node) {
    heap.push(node);
    let index = heap.length - 1;
    while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        const parentNode = heap[parent];
        if (
            parentNode.score < node.score
            || (parentNode.score === node.score && parentNode.key <= node.key)
        ) break;
        heap[index] = parentNode;
        index = parent;
    }
    heap[index] = node;
}

function popMiningRouteNode(heap) {
    if (heap.length === 0) return null;
    const first = heap[0];
    const last = heap.pop();
    if (heap.length === 0) return first;
    let index = 0;
    while (true) {
        const left = (index * 2) + 1;
        const right = left + 1;
        if (left >= heap.length) break;
        let child = left;
        if (
            right < heap.length
            && (
                heap[right].score < heap[left].score
                || (heap[right].score === heap[left].score && heap[right].key < heap[left].key)
            )
        ) child = right;
        if (
            heap[child].score > last.score
            || (heap[child].score === last.score && heap[child].key >= last.key)
        ) break;
        heap[index] = heap[child];
        index = child;
    }
    heap[index] = last;
    return first;
}

function searchMiningVoxelCorridor(bot, origin, stance, targetBlock, requestedLength) {
    const maximumSteps = Math.max(
        4,
        Math.abs(stance.y - origin.y) + requestedLength + 2,
    );
    const minimumY = Math.min(origin.y, stance.y) - 2;
    const maximumY = Math.max(origin.y, stance.y) + 2;
    const headings = [
        { x: 1, z: 0 },
        { x: -1, z: 0 },
        { x: 0, z: 1 },
        { x: 0, z: -1 },
    ];
    const startKey = miningCellKey(origin);
    const heap = [];
    const best = new Map([[startKey, { cost: 0, steps: 0 }]]);
    const parents = new Map();
    pushMiningRouteNode(heap, {
        key: startKey,
        position: origin,
        cost: 0,
        steps: 0,
        score: miningRouteHeuristic(origin, stance),
    });

    let expanded = 0;
    while (heap.length > 0 && expanded < MAX_MINING_ROUTE_SEARCH_NODES) {
        const current = popMiningRouteNode(heap);
        const recorded = best.get(current.key);
        if (!recorded || recorded.cost !== current.cost || recorded.steps !== current.steps) continue;
        if (sameMiningCell(current.position, stance)) {
            const route = [];
            let key = current.key;
            while (key !== startKey) {
                const link = parents.get(key);
                if (!link) return null;
                route.push(link.step);
                key = link.parentKey;
            }
            return route.reverse();
        }
        if (current.steps >= maximumSteps) continue;
        expanded += 1;

        const verticalToward = Math.sign(stance.y - current.position.y);
        const verticalOffsets = [...new Set([verticalToward, 0, -verticalToward, 1, -1])];
        const orderedHeadings = [...headings].sort((left, right) => {
            const leftPosition = current.position.offset(left.x, 0, left.z);
            const rightPosition = current.position.offset(right.x, 0, right.z);
            return miningRouteHeuristic(leftPosition, stance)
                - miningRouteHeuristic(rightPosition, stance)
                || left.x - right.x
                || left.z - right.z;
        });

        for (const heading of orderedHeadings) {
            for (const yOffset of verticalOffsets) {
                const position = current.position.offset(heading.x, yOffset, heading.z);
                if (position.y < minimumY || position.y > maximumY) continue;
                if (
                    Math.abs(position.x - origin.x) + Math.abs(position.z - origin.z)
                    > maximumSteps
                ) continue;
                const step = { position, heading, yOffset };
                const assessment = assessMiningRouteStep(bot, step, targetBlock);
                if (!assessment.ok) continue;
                const stepCost = 1 + (assessment.blocks.length * 8) + (Math.abs(yOffset) * 0.25);
                const cost = current.cost + stepCost;
                const steps = current.steps + 1;
                const key = miningCellKey(position);
                const prior = best.get(key);
                if (
                    prior
                    && (prior.cost < cost || (prior.cost === cost && prior.steps <= steps))
                ) continue;
                best.set(key, { cost, steps });
                parents.set(key, { parentKey: current.key, step });
                pushMiningRouteNode(heap, {
                    key,
                    position,
                    cost,
                    steps,
                    score: cost + miningRouteHeuristic(position, stance),
                });
            }
        }
    }
    return null;
}

function miningRouteTouchesLiquid(bot, positions) {
    const offsets = [
        [1, 0, 0], [-1, 0, 0], [0, 1, 0],
        [0, -1, 0], [0, 0, 1], [0, 0, -1],
    ];
    return positions.some(position => offsets.some(([x, y, z]) => (
        isLiquidGameplayBlock(bot.blockAt(position.offset(x, y, z)))
    )));
}

function assessMiningRouteStep(bot, step, targetBlock) {
    const feet = step.position;
    const head = feet.offset(0, 1, 0);
    const support = feet.offset(0, -1, 0);
    const ceiling = head.offset(0, 1, 0);
    const supportBlock = bot.blockAt(support);
    if (!supportBlock || !bot.blockAt(ceiling)) {
        return { ok: false, outcome: 'route_chunk_unloaded', blocks: [] };
    }
    if (!isSafeGameplaySupport(supportBlock) || isFallingGameplayBlock(supportBlock)) {
        return { ok: false, outcome: 'unsafe_route_support', blocks: [] };
    }
    const clearancePositions = [head, feet];
    if (step.yOffset > 0) {
        // A one-block ascent has a higher collision arc than standing height.
        // Clear both the approach-side overhead cell and the landing ceiling;
        // a two-high tunnel cannot physically accept the jump even though the
        // destination feet and head cells themselves are empty.
        clearancePositions.push(
            feet.offset(-step.heading.x, 1, -step.heading.z),
            ceiling,
        );
    } else if (step.yOffset < 0) {
        // The body crosses the destination column at the source elevation
        // before gravity lowers it onto the next stair. Pathfinder's native
        // drop edge requires this upper swept-volume cell to be clear too.
        clearancePositions.push(ceiling);
    }
    if (miningRouteTouchesLiquid(bot, clearancePositions)) {
        return { ok: false, outcome: 'liquid_ingress_risk', blocks: [] };
    }

    const blocks = [];
    for (const position of clearancePositions) {
        if (sameMiningCell(position, targetBlock?.position)) {
            return { ok: false, outcome: 'target_inside_route', blocks: [] };
        }
        const block = bot.blockAt(position);
        if (!block) return { ok: false, outcome: 'route_chunk_unloaded', blocks: [] };
        if (isCollectionStandingCellClear(block)) continue;
        if (isFallingGameplayBlock(block)) {
            return {
                ok: false,
                outcome: sameMiningCell(position, ceiling)
                    ? 'falling_block_above_route'
                    : 'falling_block_in_route',
                blocks: [],
            };
        }
        if (!isNaturalFillBlock(bot, block)) {
            return {
                ok: false,
                outcome: isProtectedGameplayBlock(block)
                    ? 'protected_block_in_route'
                    : 'non_natural_block_in_route',
                blocks: [],
                blockedBy: block.name,
            };
        }
        blocks.push(block);
    }
    return { ok: true, outcome: 'route_step_safe', blocks };
}

function toolDurabilityReserve(bot, item) {
    const durability = toolDurability(bot, item);
    if (!Number.isFinite(durability.max)) return 0;
    return Math.max(16, Math.ceil(durability.max * 0.1));
}

function assessMiningRouteDurability(
    bot,
    blocks,
    { allowReplacementBootstrapReserve = false } = {},
) {
    const items = bot.inventory.items();
    const capacities = new Map(items.map((item, index) => {
        const durability = toolDurability(bot, item);
        const capacity = Number.isFinite(durability.remaining)
            ? Math.max(
                0,
                durability.remaining - (
                    allowReplacementBootstrapReserve
                        ? 1
                        : toolDurabilityReserve(bot, item)
                ),
            )
            : Number.POSITIVE_INFINITY;
        return [index, capacity];
    }));
    const requirements = blocks
        .map(block => {
            let harvestableByHand = false;
            try { harvestableByHand = block.canHarvest(null); } catch { /* require a real tool */ }
            const eligible = items
                .map((item, index) => ({ item, index }))
                .filter(({ item, index }) => {
                    if (!(capacities.get(index) > 0)) return false;
                    try { return block.canHarvest(item.type); } catch { return false; }
                });
            return { block, harvestableByHand, eligible };
        })
        .filter(requirement => !requirement.harvestableByHand)
        .sort((left, right) => left.eligible.length - right.eligible.length);

    const assigned = new Map();
    for (const requirement of requirements) {
        const eligible = requirement.eligible
            .filter(({ index }) => capacities.get(index) > 0)
            .sort((left, right) => (
                capacities.get(right.index) - capacities.get(left.index)
                || left.item.name.localeCompare(right.item.name)
            ));
        const selected = eligible[0];
        if (!selected) {
            const replacement = items
                .filter(item => (
                    TOOL_PREPARATION_SPECS[item.name]
                    && requirements.every(requirement => {
                        try { return requirement.block.canHarvest(item.type); } catch { return false; }
                    })
                    && toolDurability(bot, item).max - toolDurability(bot, item).reserve
                        >= requirements.length
                ))
                .sort((left, right) => (
                    TOOL_PREPARATION_SPECS[left.name].tier - TOOL_PREPARATION_SPECS[right.name].tier
                    || left.name.localeCompare(right.name)
                ))[0] || null;
            return {
                ok: false,
                outcome: 'insufficient_tool_durability',
                requiredFor: requirement.block.name,
                requiredBreaks: requirements.length,
                replacementTool: replacement?.name || null,
                minimumUsableDurability: requirements.length,
            };
        }
        const remaining = capacities.get(selected.index);
        if (Number.isFinite(remaining)) capacities.set(selected.index, remaining - 1);
        assigned.set(selected.item.name, (assigned.get(selected.item.name) || 0) + 1);
    }
    return {
        ok: true,
        outcome: 'tool_capacity_sufficient',
        requiredBreaks: requirements.length,
        assigned: Object.fromEntries(assigned),
        replacementBootstrapReserve: allowReplacementBootstrapReserve,
    };
}

function assessMiningAccessPlan(
    bot,
    origin,
    targetBlock,
    stance,
    route,
    requestedLength,
    {
        breakTarget = true,
        allowReplacementBootstrapReserve = false,
    } = {},
) {
    const maximumSteps = Math.max(
        4,
        Math.abs(stance.y - origin.y) + requestedLength + 2,
    );
    if (route.length === 0 || route.length > maximumSteps) {
        return { ok: false, outcome: 'route_step_budget_exceeded', route, stance };
    }
    let previous = origin;
    const excavation = new Map();
    for (const step of route) {
        const horizontalDelta = Math.abs(step.position.x - previous.x)
            + Math.abs(step.position.z - previous.z);
        const verticalDelta = Math.abs(step.position.y - previous.y);
        if (horizontalDelta !== 1 || verticalDelta > 1) {
            return { ok: false, outcome: 'invalid_route_geometry', route, stance };
        }
        const assessment = assessMiningRouteStep(bot, step, targetBlock);
        if (!assessment.ok) return { ...assessment, route, stance };
        for (const block of assessment.blocks) excavation.set(miningCellKey(block.position), block);
        previous = step.position;
    }
    if (
        previous.y !== targetBlock.position.y
        || Math.abs(previous.x - targetBlock.position.x)
            + Math.abs(previous.z - targetBlock.position.z) !== 1
    ) {
        return { ok: false, outcome: 'route_misses_target_stance', route, stance };
    }
    if (miningRouteTouchesLiquid(bot, [targetBlock.position])) {
        return { ok: false, outcome: 'target_liquid_ingress_risk', route, stance };
    }

    const excavationBlocks = [...excavation.values()];
    const excavationBudget = excavationBlocks.length;
    const plannedBreaks = breakTarget
        ? [...excavationBlocks, targetBlock]
        : excavationBlocks;
    const blockBudget = plannedBreaks.length;
    if (blockBudget > MAX_MINING_EXCAVATION_BLOCKS) {
        return {
            ok: false,
            outcome: 'excavation_budget_exceeded',
            route,
            stance,
            blockBudget,
        };
    }
    const durability = assessMiningRouteDurability(bot, plannedBreaks, {
        allowReplacementBootstrapReserve,
    });
    if (!durability.ok) return { ...durability, route, stance, blockBudget };

    const estimatedDigMs = plannedBreaks.reduce(
        (total, block) => total + Math.max(50, collectionBreakTime(bot, block)),
        0,
    );
    const estimatedDurationMs = Math.ceil(
        estimatedDigMs + (route.length * MINING_ROUTE_STEP_ESTIMATE_MS),
    );
    if (estimatedDurationMs + MINING_ROUTE_DEADLINE_RESERVE_MS > remainingActionTimeMs()) {
        return {
            ok: false,
            outcome: 'route_deadline_insufficient',
            route,
            stance,
            blockBudget,
            estimatedDurationMs,
            durability,
        };
    }
    return {
        ok: true,
        outcome: 'route_ready',
        route,
        stance,
        excavationBlocks,
        excavationBudget,
        blockBudget,
        breakTarget,
        estimatedDurationMs,
        durability,
    };
}

function buildMiningAccessPlan(bot, targetBlock, requestedLength, options = {}) {
    const origin = observedSupportedStandingCell(bot);
    if (!origin) return { ok: false, outcome: 'position_unavailable' };
    const stances = prospectiveMiningStandingPositions(bot, targetBlock);
    if (stances.length === 0) return { ok: false, outcome: 'no_safe_stance' };

    const assessments = [];
    const seenRoutes = new Set();
    for (const stance of stances) {
        const searchedRoute = searchMiningVoxelCorridor(
            bot,
            origin,
            stance,
            targetBlock,
            requestedLength,
        );
        const routes = [
            searchedRoute,
            ...MINING_ROUTE_VARIANTS.map(variant => (
                planMiningVoxelCorridor(origin, stance, variant)
            )),
        ].filter(Boolean);
        for (const route of routes) {
            const routeKey = route.map(step => miningCellKey(step.position)).join('|');
            if (seenRoutes.has(routeKey)) continue;
            seenRoutes.add(routeKey);
            assessments.push(assessMiningAccessPlan(
                bot,
                origin,
                targetBlock,
                stance,
                route,
                requestedLength,
                options,
            ));
        }
    }
    const viable = assessments
        .filter(assessment => assessment.ok)
        .sort((left, right) => (
            left.blockBudget - right.blockBudget
            || left.route.length - right.route.length
            || left.estimatedDurationMs - right.estimatedDurationMs
        ));
    if (viable.length > 0) return viable[0];
    return assessments.find(assessment => assessment.outcome === 'insufficient_tool_durability')
        || assessments.find(assessment => assessment.outcome === 'route_deadline_insufficient')
        || assessments[0]
        || { ok: false, outcome: 'no_safe_route' };
}

function isMiningRouteCellReturnable(bot, position) {
    return Boolean(
        position
        && isCollectionStandingCellClear(bot.blockAt(position))
        && isCollectionStandingCellClear(bot.blockAt(position.offset(0, 1, 0)))
        && isSafeGameplaySupport(bot.blockAt(position.offset(0, -1, 0)))
        && !miningRouteTouchesLiquid(bot, [position, position.offset(0, 1, 0)])
    );
}

function clearedMiningMovements(bot) {
    const movements = safeMovements(bot);
    movements.canDig = false;
    movements.allow1by1towers = false;
    movements.allowParkour = false;
    movements.allowSprinting = false;
    return movements;
}

async function traverseClearedMiningStep(bot, route, stepIndex) {
    const step = route[stepIndex]?.position;
    if (!step) return { success: false, outcome: 'route_step_unavailable' };
    const reached = await goToGoal(
        bot,
        new pf.goals.GoalBlock(step.x, step.y, step.z),
        {
            movements: () => clearedMiningMovements(bot),
            stallTimeoutMs: MINING_ROUTE_STEP_TIMEOUT_MS,
            allowHealthBoundedDescent: false,
            allowLocalRecovery: false,
        },
    );
    await waitForWorldCondition(
        bot,
        () => physicallyOccupiesStandingCell(bot, step),
        GROUND_SETTLE_TIMEOUT_MS,
        25,
    );
    const observed = bot.entity?.position?.clone?.() || null;
    const arrived = Boolean(
        physicallyOccupiesStandingCell(bot, step)
        && isMiningRouteCellReturnable(bot, step)
    );
    return {
        success: arrived,
        outcome: arrived ? 'route_step_reached' : 'route_step_not_reached',
        landedIndex: arrived ? stepIndex : stepIndex - 1,
        observed,
        reached,
        onGround: bot.entity?.onGround === true,
    };
}

async function executeMiningAccessPlan(bot, targetBlock, plan) {
    let excavated = 0;
    let nextIndex = 0;
    while (nextIndex < plan.route.length) {
        if (bot.interrupt_code || remainingActionTimeMs() <= 0) {
            return { success: false, outcome: bot.interrupt_code ? 'interrupted' : 'deadline', excavated };
        }
        const liveTarget = bot.blockAt(targetBlock.position);
        if (!liveTarget || liveTarget.name !== targetBlock.name) {
            return { success: false, outcome: 'target_changed', excavated };
        }
        const step = plan.route[nextIndex];
        const assessment = assessMiningRouteStep(bot, step, liveTarget);
        if (!assessment.ok) {
            return {
                success: false,
                outcome: assessment.outcome,
                excavated,
                stepIndex: nextIndex,
                step: step.position,
            };
        }
        const liveBlocks = assessment.blocks
            .map(block => bot.blockAt(block.position))
            .filter(block => !isCollectionStandingCellClear(block));
        if (liveBlocks.some(block => !block || bot.entity.position.distanceTo(block.position) > 4.5)) {
            return {
                success: false,
                outcome: 'route_step_out_of_reach',
                excavated,
                stepIndex: nextIndex,
                step: step.position,
            };
        }
        for (const liveBlock of liveBlocks) {
            if (
                isFallingGameplayBlock(liveBlock)
                || !isNaturalFillBlock(bot, liveBlock)
            ) return { success: false, outcome: 'route_changed_unsafe', excavated };
            if (excavated >= plan.excavationBudget) {
                return { success: false, outcome: 'excavation_budget_exceeded', excavated };
            }
            if (!await breakBlockAt(
                bot,
                liveBlock.position.x,
                liveBlock.position.y,
                liveBlock.position.z,
            )) return { success: false, outcome: 'route_block_not_broken', excavated };
            excavated += 1;
        }

        const traversal = await traverseClearedMiningStep(bot, plan.route, nextIndex);
        if (!traversal.success) {
            return {
                success: false,
                outcome: traversal.outcome,
                excavated,
                stepIndex: nextIndex,
                step: step.position,
                observed: traversal.observed,
                reached: traversal.reached,
                onGround: traversal.onGround,
            };
        }
        for (let index = 0; index <= traversal.landedIndex; index += 1) {
            if (!isMiningRouteCellReturnable(bot, plan.route[index].position)) {
                return {
                    success: false,
                    outcome: 'return_route_changed',
                    excavated,
                    stepIndex: index,
                    step: plan.route[index].position,
                };
            }
        }
        const previousIndex = nextIndex;
        nextIndex += 1;
        if (nextIndex <= previousIndex) {
            return { success: false, outcome: 'non_convergent_step', excavated };
        }
    }
    const finalTarget = bot.blockAt(targetBlock.position);
    if (!finalTarget || finalTarget.name !== targetBlock.name) {
        return { success: false, outcome: 'target_changed', excavated };
    }
    if (!isMiningTargetExposed(bot, finalTarget)) {
        return { success: false, outcome: 'target_not_exposed', excavated };
    }
    return { success: true, outcome: 'target_exposed', excavated, target: finalTarget };
}

async function reachKnownBlockByVoxelCorridor(
    bot,
    targetBlock,
    requestedLength = 64,
    { allowReplacementBootstrapReserve = false } = {},
) {
    const target = targetBlock?.position?.clone?.();
    const targetName = targetBlock?.name;
    if (!target || !targetName) return { success: false, outcome: 'target_unavailable' };
    if (bot.entity.position.distanceTo(target) <= 4.5) {
        return { success: true, outcome: 'already_in_range', excavated: 0 };
    }
    if (!await stageMiningStaircase(bot)) {
        return {
            success: false,
            outcome: bot.interrupt_code ? 'interrupted' : 'no_stable_staging_cell',
        };
    }
    const liveTarget = bot.blockAt(target);
    if (!liveTarget || liveTarget.name !== targetName) {
        return { success: false, outcome: 'target_changed' };
    }
    const plan = buildMiningAccessPlan(bot, liveTarget, requestedLength, {
        breakTarget: false,
        allowReplacementBootstrapReserve,
    });
    if (!plan.ok) {
        return {
            success: false,
            outcome: plan.outcome,
            blockBudget: plan.blockBudget,
            estimatedDurationMs: plan.estimatedDurationMs,
            replacementTool: plan.replacementTool || null,
            minimumUsableDurability: plan.minimumUsableDurability || null,
        };
    }
    const result = await executeMiningAccessPlan(bot, liveTarget, plan);
    return {
        ...result,
        blockBudget: plan.blockBudget,
        routeSteps: plan.route.length,
        estimatedDurationMs: plan.estimatedDurationMs,
        durability: plan.durability,
    };
}

const TUNNEL_HEADINGS = Object.freeze({
    north: { x: 0, z: -1 },
    south: { x: 0, z: 1 },
    east: { x: 1, z: 0 },
    west: { x: -1, z: 0 },
});

/** A cardinal step: a named direction, or the bot's facing snapped to a cardinal. */
function cardinalHeading(bot, direction) {
    const named = TUNNEL_HEADINGS[String(direction || '').trim().toLowerCase()];
    if (named) return named;
    const yaw = Number(bot.entity?.yaw) || 0;
    const dx = -Math.sin(yaw);
    const dz = Math.cos(yaw);
    return Math.abs(dx) >= Math.abs(dz)
        ? { x: dx >= 0 ? 1 : -1, z: 0 }
        : { x: 0, z: dz >= 0 ? 1 : -1 };
}

/** Let Pathfinder move through one already-cleared tunnel cell without digging. */
async function stepIntoTunnelCell(bot, cell) {
    await goToGoal(
        bot,
        new pf.goals.GoalBlock(cell.x, cell.y, cell.z),
        {
            movements: () => clearedMiningMovements(bot),
            stallTimeoutMs: MINING_ROUTE_STEP_TIMEOUT_MS,
            allowHealthBoundedDescent: false,
            allowLocalRecovery: false,
        },
    );
    return physicallyOccupiesStandingCell(bot, cell);
}

/**
 * Dig a straight 1x2 corridor: deterministic logic authorizes the two blocks
 * directly ahead, then Pathfinder moves through the exact cleared cell with
 * digging disabled. It stops rather than enter liquid, a drop, or anything a
 * player built, and lights the corridor as it goes.
 */
export async function digTunnel(bot, direction = 'forward', length = 16, torchInterval = 8) {
    const len = Math.max(1, Math.min(64, Math.floor(Number(length) || 16)));
    const interval = Math.max(0, Math.min(32, Math.floor(Number(torchInterval) || 0)));
    const heading = cardinalHeading(bot, direction);
    let dug = 0;
    const finish = (success, outcome, extra = {}) => {
        setActionEvidence(bot, {
            kind: 'tunnel',
            outcome,
            target: { name: 'tunnel' },
            dug,
            retryable: !success && !bot.interrupt_code,
            ...extra,
        });
        log(bot, success
            ? `Dug a ${dug}-block tunnel.`
            : `Tunnel stopped after ${dug} block(s): ${String(outcome).replace(/_/g, ' ')}.`);
        return success;
    };
    for (let i = 0; i < len; i += 1) {
        if (bot.interrupt_code) return finish(dug > 0, 'interrupted', { retryable: false });
        const feet = bot.entity?.position?.floored?.();
        if (!feet) return finish(dug > 0, 'position_unavailable');
        const aheadFeet = feet.offset(heading.x, 0, heading.z);
        const aheadHead = feet.offset(heading.x, 1, heading.z);

        // Never open a face onto a liquid: one wrong block floods the corridor.
        for (const position of [aheadFeet, aheadHead, aheadFeet.offset(heading.x, 0, heading.z), aheadHead.offset(heading.x, 0, heading.z)]) {
            const block = bot.blockAt(position);
            if (block && ['water', 'lava'].includes(block.name)) return finish(dug > 0, 'liquid_ahead');
        }
        // Never break anything a player placed.
        for (const position of [aheadFeet, aheadHead]) {
            const block = bot.blockAt(position);
            if (block && block.name !== 'air' && isProtectedGameplayBlock(block)) return finish(dug > 0, 'protected_block_ahead');
        }
        // Do not walk off a ledge into an unlit cave or a fall.
        const floor = bot.blockAt(aheadFeet.offset(0, -1, 0));
        const floorSolid = floor && floor.boundingBox === 'block' && !['water', 'lava'].includes(floor.name);
        if (!floorSolid) return finish(dug > 0, 'floor_missing');

        // Clear a falling block resting above the head cell before it can bury the bot.
        const ceiling = bot.blockAt(aheadHead.offset(0, 1, 0));
        if (ceiling && /(?:sand|gravel|concrete_powder)$/.test(ceiling.name)) {
            await breakBlockAt(bot, ceiling.x, ceiling.y, ceiling.z);
            if (bot.interrupt_code) return finish(dug > 0, 'interrupted', { retryable: false });
        }
        // Head first so debris drops into the space the feet block will vacate.
        const headBlock = bot.blockAt(aheadHead);
        if (headBlock && headBlock.name !== 'air'
            && !await breakBlockAt(bot, aheadHead.x, aheadHead.y, aheadHead.z)
            && !bot.interrupt_code) return finish(dug > 0, 'blocked');
        if (bot.interrupt_code) return finish(dug > 0, 'interrupted', { retryable: false });
        const feetBlock = bot.blockAt(aheadFeet);
        if (feetBlock && feetBlock.name !== 'air'
            && !await breakBlockAt(bot, aheadFeet.x, aheadFeet.y, aheadFeet.z)
            && !bot.interrupt_code) return finish(dug > 0, 'blocked');
        if (bot.interrupt_code) return finish(dug > 0, 'interrupted', { retryable: false });

        if (!await stepIntoTunnelCell(bot, aheadFeet)) return finish(dug > 0, 'step_blocked');
        dug += 1;
        if (interval > 0 && dug % interval === 0) {
            try { await autoLight(bot); } catch { /* corridor lighting is best-effort */ }
        }
    }
    return finish(true, 'tunnel_complete');
}

export async function mineSearchTunnel(
    bot,
    resourceName,
    length = MINING_TUNNEL_LENGTH,
    preferredTarget = null,
) {
    const requested = String(resourceName || '').trim().toLowerCase();
    const requestedLength = Math.max(4, Math.min(32, Math.floor(Number(length) || MINING_TUNNEL_LENGTH)));
    const requestedBlocks = miningTargetBlockNames(requested);
    const livePreferredTarget = preferredTarget?.position
        ? bot.blockAt(preferredTarget.position)
        : null;
    // Collection recovery has already ranked one concrete target. Preserve
    // that identity so the mining route cannot open a different nearby vein
    // and then rescan the still-buried original candidate.
    const knownTarget = (
        livePreferredTarget?.position
        && requestedBlocks.has(livePreferredTarget.name)
        && prospectiveMiningStandingPositions(bot, livePreferredTarget).length > 0
    )
        ? livePreferredTarget
        : nearestKnownMiningTarget(bot, requested);
    if (knownTarget) {
        const staged = await stageMiningStaircase(bot);
        if (!staged) {
            setActionEvidence(bot, {
                kind: 'mining_search',
                outcome: bot.interrupt_code ? 'interrupted' : 'staging_unreachable',
                target: {
                    name: knownTarget.name,
                    x: knownTarget.position.x,
                    y: knownTarget.position.y,
                    z: knownTarget.position.z,
                },
                routeDigging: true,
                retryable: !bot.interrupt_code,
            });
            log(bot, bot.interrupt_code
                ? 'Stopped before reaching a stable mining site.'
                : `Could not reach stable dry ground for the known ${knownTarget.name} target.`);
            return false;
        }

        const stagedTarget = bot.blockAt(knownTarget.position);
        if (!stagedTarget || !requestedBlocks.has(stagedTarget.name)) {
            setActionEvidence(bot, {
                kind: 'mining_search',
                outcome: 'target_changed',
                target: {
                    name: knownTarget.name,
                    x: knownTarget.position.x,
                    y: knownTarget.position.y,
                    z: knownTarget.position.z,
                },
                routeDigging: true,
                retryable: true,
            });
            log(bot, `The selected ${knownTarget.name} target changed before excavation began.`);
            return false;
        }

        const plan = buildMiningAccessPlan(bot, stagedTarget, requestedLength);
        if (!plan.ok) {
            const toolRequirement = (
                plan.outcome === 'insufficient_tool_durability'
                && plan.replacementTool
            ) ? {
                    name: plan.replacementTool,
                    minimumUsableDurability: plan.minimumUsableDurability,
                }
                : null;
            setActionEvidence(bot, {
                kind: 'mining_search',
                outcome: plan.outcome || 'no_safe_route',
                target: {
                    name: stagedTarget.name,
                    x: stagedTarget.position.x,
                    y: stagedTarget.position.y,
                    z: stagedTarget.position.z,
                },
                routeSteps: plan.route?.length || 0,
                blockBudget: plan.blockBudget || 0,
                estimatedDurationMs: plan.estimatedDurationMs || null,
                durability: plan.durability || null,
                blockedBy: plan.blockedBy || null,
                ...(toolRequirement ? { toolRequirement } : {}),
                routeDigging: true,
                retryable: !bot.interrupt_code,
            });
            log(bot, `Rejected the known ${stagedTarget.name} target before excavation: ${String(plan.outcome || 'no safe route').replace(/_/g, ' ')}.`);
            return false;
        }

        const routeStart = bot.entity.position.clone();
        const access = await executeMiningAccessPlan(bot, stagedTarget, plan);
        if (!access.success) {
            setActionEvidence(bot, {
                kind: 'mining_search',
                outcome: access.outcome,
                target: {
                    name: stagedTarget.name,
                    x: stagedTarget.position.x,
                    y: stagedTarget.position.y,
                    z: stagedTarget.position.z,
                },
                stance: {
                    x: plan.stance.x,
                    y: plan.stance.y,
                    z: plan.stance.z,
                },
                routeSteps: plan.route.length,
                excavated: access.excavated,
                blockBudget: plan.blockBudget,
                estimatedDurationMs: plan.estimatedDurationMs,
                durability: plan.durability,
                failedStepIndex: Number.isFinite(access.stepIndex) ? access.stepIndex : null,
                failedStep: access.step || null,
                observedPosition: access.observed || null,
                pathfinderReached: access.reached ?? null,
                onGround: access.onGround ?? null,
                routeDigging: true,
                retryable: !bot.interrupt_code,
            });
            const failedStep = access.step
                ? ` at step ${Number(access.stepIndex) + 1} (${access.step.x}, ${access.step.y}, ${access.step.z}) from (${bot.entity.position.x.toFixed(2)}, ${bot.entity.position.y.toFixed(2)}, ${bot.entity.position.z.toFixed(2)})`
                : '';
            log(bot, `Stopped the exact route to ${stagedTarget.name}: ${String(access.outcome).replace(/_/g, ' ')}${failedStep} after ${access.excavated} block${access.excavated === 1 ? '' : 's'}.`);
            return false;
        }

        const collected = await collectBlock(bot, access.target.name, 1, null, 8, {
            relocate: false,
            preferredPosition: access.target.position,
            allowNaturalRouteDigging: true,
            allowAccessRecovery: false,
        });
        if (!collected) return false;
        setActionEvidence(bot, {
            kind: 'mining_search',
            outcome: 'resource_collected',
            target: {
                name: stagedTarget.name,
                x: stagedTarget.position.x,
                y: stagedTarget.position.y,
                z: stagedTarget.position.z,
            },
            stance: {
                x: plan.stance.x,
                y: plan.stance.y,
                z: plan.stance.z,
            },
            routeSteps: plan.route.length,
            excavated: access.excavated,
            blockBudget: plan.blockBudget,
            estimatedDurationMs: plan.estimatedDurationMs,
            durability: plan.durability,
            distance: bot.entity.position.distanceTo(routeStart),
            routeDigging: true,
            retryable: false,
        });
        log(bot, `Reached and collected the known ${stagedTarget.name} target through an exact ${plan.route.length}-step mining route.`);
        return true;
    }

    const tunnelHeadings = orderedMiningHeadings(bot, requested)
        .slice(0, MAX_MINING_ROUTE_HEADINGS);
    for (const heading of tunnelHeadings) {
        if (bot.interrupt_code) break;
        const routeStart = bot.entity.position.clone();
        let remaining = requestedLength;
        let advanced = false;
        let lastTarget = null;

        // Replan every three blocks. A tunnel face can remain stationary while
        // it is being broken, and a short route prevents a stale long-path
        // calculation from turning that ordinary mining into a false stall.
        while (remaining > 0 && !bot.interrupt_code) {
            const start = bot.entity.position.clone();
            const segmentLength = Math.min(3, remaining);
            lastTarget = {
                name: requested || 'resource',
                x: Math.floor(start.x) + (heading.x * segmentLength),
                y: Math.floor(start.y),
                z: Math.floor(start.z) + (heading.z * segmentLength),
            };
            const reached = await goToGoal(
                bot,
                new pf.goals.GoalNear(lastTarget.x, lastTarget.y, lastTarget.z, 1),
                {
                    movements: () => miningMovements(bot),
                    stallTimeoutMs: MINING_ROUTE_STALL_TIMEOUT_MS,
                    allowHealthBoundedDescent: false,
                    allowLocalRecovery: false,
                },
            );
            if (bot.interrupt_code) break;
            const segmentDistance = bot.entity.position.distanceTo(start);
            advanced ||= reached || segmentDistance >= NAVIGATION_PROGRESS_DISTANCE;
            remaining -= segmentLength;
            if (!reached && segmentDistance < NAVIGATION_PROGRESS_DISTANCE) break;
        }
        if (advanced) {
            const distance = bot.entity.position.distanceTo(routeStart);
            setActionEvidence(bot, {
                kind: 'mining_search',
                outcome: 'search_advanced',
                target: lastTarget || { name: requested || 'resource' },
                distance,
                routeDigging: true,
                retryable: false,
            });
            log(bot, `Advanced a supported two-block mining route ${distance.toFixed(1)} blocks while searching for ${requested || 'resources'}; no resource is claimed yet.`);
            return true;
        }
    }
    setActionEvidence(bot, {
        kind: 'mining_search',
        outcome: bot.interrupt_code ? 'interrupted' : 'tunnel_blocked',
        target: { name: requested || 'resource' },
        routeDigging: true,
        retryable: !bot.interrupt_code,
    });
    log(bot, bot.interrupt_code
        ? 'Stopped the mining search tunnel.'
        : `No safe natural-fill tunnel could advance while searching for ${requested || 'the requested resource'}.`);
    return false;
}

export async function goToMiningDepth(bot, targetY, range=64) {
    const boundedY = Math.max(-60, Math.min(300, Math.floor(Number(targetY) || 0)));
    const boundedRange = Math.max(16, Math.min(128, Math.floor(Number(range) || 64)));
    const origin = bot.entity?.position;
    const target = { name: 'open_cave_route', y: boundedY };
    if (!origin || typeof bot.blockAt !== 'function') {
        setActionEvidence(bot, {
            kind: 'mining_relocation',
            outcome: 'position_unavailable',
            target,
            retryable: true,
        });
        return false;
    }

    const passable = block => Boolean(
        block
        && (block.boundingBox === 'empty' || ['air', 'cave_air', 'void_air'].includes(block.name)),
    );
    const supported = block => Boolean(
        block
        && block.boundingBox === 'block'
        && !['water', 'lava', 'magma_block'].includes(block.name)
        && !/(?:sand|gravel|concrete_powder)$/.test(block.name),
    );
    const safeSpace = (x, y, z) => {
        const feet = bot.blockAt(new Vec3(x, y, z));
        const head = bot.blockAt(new Vec3(x, y + 1, z));
        const floor = bot.blockAt(new Vec3(x, y - 1, z));
        if (!passable(feet) || !passable(head) || !supported(floor)) return false;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const adjacent = bot.blockAt(new Vec3(x + dx, y, z + dz));
            if (['water', 'lava'].includes(adjacent?.name)) return false;
        }
        return true;
    };

    if (Math.abs(origin.y - boundedY) <= 6 && safeSpace(
        Math.floor(origin.x),
        Math.floor(origin.y),
        Math.floor(origin.z),
    )) {
        setActionEvidence(bot, {
            kind: 'mining_relocation',
            outcome: 'already_at_depth',
            target,
            observedY: origin.y,
            retryable: false,
        });
        return true;
    }

    const candidates = [];
    const baseX = Math.floor(origin.x);
    const baseZ = Math.floor(origin.z);
    for (let radius = 8; radius <= boundedRange; radius += 8) {
        for (let direction = 0; direction < 16; direction += 1) {
            const angle = (direction / 16) * Math.PI * 2;
            const x = Math.floor(baseX + (Math.cos(angle) * radius));
            const z = Math.floor(baseZ + (Math.sin(angle) * radius));
            for (const yOffset of [0, -3, 3, -6, 6]) {
                const y = boundedY + yOffset;
                if (!safeSpace(x, y, z)) continue;
                candidates.push({
                    x,
                    y,
                    z,
                    distance: origin.distanceTo(new Vec3(x, y, z)),
                });
            }
        }
    }
    candidates.sort((left, right) => left.distance - right.distance);

    for (const candidate of candidates.slice(0, 6)) {
        if (bot.interrupt_code) {
            setActionEvidence(bot, {
                kind: 'mining_relocation',
                outcome: 'interrupted',
                target,
                retryable: false,
            });
            return false;
        }
        if (!await goToPosition(bot, candidate.x, candidate.y, candidate.z, 1)) continue;
        if (Math.abs(bot.entity.position.y - boundedY) <= 8) {
            setActionEvidence(bot, {
                kind: 'mining_relocation',
                outcome: 'productive_depth_reached',
                target: {
                    ...target,
                    x: candidate.x,
                    z: candidate.z,
                },
                observedY: bot.entity.position.y,
                routeDigging: false,
                retryable: false,
            });
            return true;
        }
    }

    if (boundedY < bot.entity.position.y - 6) {
        const staircase = await carveExploratoryDepthRoute(bot, boundedY);
        if (staircase.success) {
            setActionEvidence(bot, {
                kind: 'mining_relocation',
                outcome: 'staircase_depth_reached',
                target,
                observedY: staircase.observedY,
                legs: staircase.legs,
                routeDigging: true,
                retryable: false,
            });
            log(bot, `Carved and followed a supported staircase to the productive y=${boundedY} band.`);
            return true;
        }
    }

    setActionEvidence(bot, {
        kind: 'mining_relocation',
        outcome: candidates.length > 0 ? 'open_cave_unreachable' : 'no_open_cave_route',
        target,
        candidates: Math.min(candidates.length, 6),
        routeDigging: false,
        retryable: true,
    });
    log(bot, `No safe cave or natural-fill staircase route reaches the productive y=${boundedY} band from here.`);
    return false;
}

export async function goToPosition(bot, x, y, z, min_distance=2) {
    /**
     * Navigate to the given position.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} x, the x coordinate to navigate to. If null, the bot's current x coordinate will be used.
     * @param {number} y, the y coordinate to navigate to. If null, the bot's current y coordinate will be used.
     * @param {number} z, the z coordinate to navigate to. If null, the bot's current z coordinate will be used.
     * @param {number} distance, the distance to keep from the position. Defaults to 2.
     * @returns {Promise<boolean>} true if the position was reached, false otherwise.
     * @example
     * let position = world.world.getNearestBlock(bot, "oak_log", 64).position;
     * await skills.goToPosition(bot, position.x, position.y, position.x + 20);
     **/
    if (![x, y, z].every(Number.isFinite)) {
        setActionEvidence(bot, {
            kind: 'movement',
            outcome: 'invalid_target',
            target: { x, y, z },
            retryable: false,
        });
        log(bot, `Invalid coordinates, given x:${x} y:${y} z:${z}.`);
        return false;
    }
    const requestedDistance = Math.max(0, Math.min(64, Number(min_distance) || 0));
    if (bot.modes.isOn('cheat')) {
        bot.chat('/tp @s ' + x + ' ' + y + ' ' + z);
        setActionEvidence(bot, { kind: 'movement', outcome: 'teleport_requested', completion: 'requested', target: { x, y, z }, retryable: false });
        log(bot, `Requested teleport to ${x}, ${y}, ${z}; waiting for the server to apply it.`);
        return true;
    }
    
    const checkDigProgress = () => {
        if (bot.targetDigBlock) {
            const targetBlock = bot.targetDigBlock;
            const itemId = bot.heldItem ? bot.heldItem.type : null;
            if (!targetBlock.canHarvest(itemId)) {
                log(bot, `Pathfinding stopped: Cannot break ${targetBlock.name} with current tools.`);
                bot.pathfinder.stop();
                bot.stopDigging();
            }
        }
    };
    
    const progressInterval = setInterval(checkDigProgress, 1000);
    
    try {
        const routed = await goToGoal(bot, new pf.goals.GoalNear(x, y, z, requestedDistance));
        if (!routed) return false;
        const distance = bot.entity.position.distanceTo(new Vec3(x, y, z));
        if (distance <= requestedDistance + 1) {
            setActionEvidence(bot, { kind: 'movement', outcome: 'arrived', target: { x, y, z }, distance });
            log(bot, `You have reached at ${x}, ${y}, ${z}.`);
            return true;
        }
        else {
            setActionEvidence(bot, { kind: 'movement', outcome: 'too_far', target: { x, y, z }, distance });
            log(bot, `Unable to reach ${x}, ${y}, ${z}, you are ${Math.round(distance)} blocks away.`);
            return false;
        }
    } catch (err) {
        setActionEvidence(bot, {
            kind: 'movement',
            outcome: pathfinderErrorOutcome(err, Boolean(bot.interrupt_code)),
            target: { x, y, z },
            error: String(err?.message || err).slice(0, 240),
            retryable: !bot.interrupt_code,
        });
        log(bot, `Pathfinding stopped: ${err.message}.`);
        return false;
    } finally {
        clearInterval(progressInterval);
    }
}

export async function goToNearestBlock(bot, blockType,  min_distance=2, range=64) {
    /**
     * Navigate to the nearest block of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} blockType, the type of block to navigate to.
     * @param {number} min_distance, the distance to keep from the block. Defaults to 2.
     * @param {number} range, the range to look for the block. Defaults to 64.
     * @returns {Promise<boolean>} true if the block was reached, false otherwise.
     * @example
     * await skills.goToNearestBlock(bot, "oak_log", 64, 2);
     * **/
    const MAX_RANGE = 512;
    if (range > MAX_RANGE) {
        log(bot, `Maximum search range capped at ${MAX_RANGE}. `);
        range = MAX_RANGE;
    }
    let block = null;
    if (blockType === 'water' || blockType === 'lava') {
        let blocks = world.getNearestBlocksWhere(bot, block => block.name === blockType && block.metadata === 0, range, 1);
        if (blocks.length === 0) {
            log(bot, `Could not find any source ${blockType} in ${range} blocks, looking for uncollectable flowing instead...`);
            blocks = world.getNearestBlocksWhere(bot, block => block.name === blockType, range, 1);
        }
        block = blocks[0];
    }
    else {
        block = world.getNearestBlock(bot, blockType, range);
    }
    if (!block) {
        setActionEvidence(bot, {
            kind: 'movement',
            outcome: 'target_not_found',
            target: { name: blockType },
            range,
            retryable: true,
        });
        log(bot, `Could not find any ${blockType} in ${range} blocks.`);
        return false;
    }
    log(bot, `Found ${blockType} at ${block.position}. Navigating...`);
    const position = block.position.clone();
    const reached = await goToPosition(bot, position.x, position.y, position.z, min_distance);
    if (!reached) return false;
    const observed = bot.blockAt(position);
    if (!observed || observed.name !== blockType) {
        setActionEvidence(bot, {
            kind: 'movement',
            outcome: !observed ? 'target_unloaded' : 'target_changed',
            target: { name: blockType, x: position.x, y: position.y, z: position.z },
            observed: observed?.name || 'unloaded',
            retryable: true,
        });
        log(bot, `${blockType} is no longer present at the reached position.`);
        return false;
    }
    const distance = bot.entity.position.distanceTo(position);
    setActionEvidence(bot, {
        kind: 'movement',
        outcome: 'arrived',
        target: { name: blockType, x: position.x, y: position.y, z: position.z },
        distance,
        retryable: false,
    });
    return true;
}

export async function goToNearestEntity(bot, entityType, min_distance=2, range=64) {
    /**
     * Navigate to the nearest entity of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} entityType, the type of entity to navigate to.
     * @param {number} min_distance, the distance to keep from the entity. Defaults to 2.
     * @param {number} range, the range to look for the entity. Defaults to 64.
     * @returns {Promise<boolean>} true if the entity was reached, false otherwise.
     **/
    let entity = world.getNearestEntityWhere(bot, entity => entity.name === entityType, range);
    if (!entity) {
        setActionEvidence(bot, {
            kind: 'movement',
            outcome: 'target_not_found',
            target: { name: entityType },
            range,
            retryable: true,
        });
        log(bot, `Could not find any ${entityType} in ${range} blocks.`);
        return false;
    }
    const requestedDistance = Math.max(0, Math.min(32, Number(min_distance) || 0));
    const target = { name: entityType, id: entity.id };
    let distance = bot.entity.position.distanceTo(entity.position);
    log(bot, `Found ${entityType} ${distance.toFixed(1)} blocks away.`);
    const reached = await goToGoal(bot, new pf.goals.GoalFollow(entity, requestedDistance));
    const observed = bot.entities?.[entity.id];
    if (!reached || !observed?.position) {
        setActionEvidence(bot, {
            kind: 'movement',
            outcome: !observed?.position ? 'target_lost' : bot.lastActionEvidence?.outcome || 'unreachable',
            target,
            retryable: true,
        });
        if (!observed?.position) log(bot, `${entityType} left verified world state before arrival.`);
        return false;
    }
    distance = bot.entity.position.distanceTo(observed.position);
    if (distance > requestedDistance + 1) {
        setActionEvidence(bot, { kind: 'movement', outcome: 'target_moved', target, distance, retryable: true });
        log(bot, `${entityType} is still ${distance.toFixed(1)} blocks away.`);
        return false;
    }
    setActionEvidence(bot, { kind: 'movement', outcome: 'arrived', target, distance, retryable: false });
    return true;
}

function nearestRideableEntity(bot, requestedType, range) {
    return world.getNearestEntityWhere(
        bot,
        entity => matchesRideableEntity(entity?.name, requestedType),
        range,
    );
}

function currentMountedVehicle(bot) {
    const vehicle = bot.vehicle;
    if (!vehicle) return null;
    const observed = bot.entities?.[vehicle.id];
    if (!observed || observed.isValid === false) {
        bot.vehicle = null;
        return null;
    }
    return observed;
}

function mountedVehicleTarget(vehicle) {
    return vehicle ? {
        name: vehicle.name || 'vehicle',
        entityId: Number.isFinite(vehicle.id) ? vehicle.id : null,
        x: Number.isFinite(vehicle.position?.x) ? vehicle.position.x : null,
        y: Number.isFinite(vehicle.position?.y) ? vehicle.position.y : null,
        z: Number.isFinite(vehicle.position?.z) ? vehicle.position.z : null,
    } : null;
}

function notchianYaw(yaw) {
    return (Math.PI - yaw) * (180 / Math.PI);
}

function vehicleStepIsClear(bot, position, vehicleKnowledge) {
    const feet = bot.blockAt(new Vec3(
        Math.floor(position.x),
        Math.floor(position.y),
        Math.floor(position.z),
    ));
    if (feet && feet.boundingBox !== 'empty') return false;
    if (vehicleKnowledge?.kind === 'boat') return true;
    const head = bot.blockAt(new Vec3(
        Math.floor(position.x),
        Math.floor(position.y) + 1,
        Math.floor(position.z),
    ));
    if (head && head.boundingBox !== 'empty') return false;
    const support = bot.blockAt(new Vec3(
        Math.floor(position.x),
        Math.floor(position.y) - 1,
        Math.floor(position.z),
    ));
    if (vehicleKnowledge?.name === 'strider') {
        return isLiquidGameplayBlock(support) || isSafeGameplaySupport(support);
    }
    return isSafeGameplaySupport(support);
}

function driveVehicleStep(bot, vehicle, destination, vehicleKnowledge) {
    const deltaX = destination.x - vehicle.position.x;
    const deltaZ = destination.z - vehicle.position.z;
    const horizontalDistance = Math.hypot(deltaX, deltaZ);
    if (horizontalDistance <= 0.001) return { moved: false, blocked: false };
    const stepSize = vehicleKnowledge?.kind === 'boat'
        ? BOAT_TRAVEL_PER_TICK
        : ANIMAL_TRAVEL_PER_TICK;
    const step = Math.min(stepSize, horizontalDistance);
    const next = new Vec3(
        vehicle.position.x + ((deltaX / horizontalDistance) * step),
        vehicle.position.y,
        vehicle.position.z + ((deltaZ / horizontalDistance) * step),
    );
    if (!vehicleStepIsClear(bot, next, vehicleKnowledge)) return { moved: false, blocked: true };
    const yaw = Math.atan2(-deltaX, -deltaZ);
    if (vehicleKnowledge?.kind === 'boat') {
        bot._client.write('steer_boat', {
            leftPaddle: true,
            rightPaddle: true,
        });
    }
    bot._client.write('vehicle_move', {
        x: next.x,
        y: next.y,
        z: next.z,
        yaw: notchianYaw(yaw),
        pitch: 0,
        onGround: false,
    });
    return { moved: true, blocked: false };
}

async function mountObservedEntity(bot, entity) {
    try {
        bot.pathfinder?.setGoal?.(null);
        await bot.mount(entity);
    } catch (error) {
        return { mounted: false, error };
    }
    const mounted = await waitForWorldCondition(
        bot,
        () => currentMountedVehicle(bot)?.id === entity.id,
        MOUNT_CONFIRM_TIMEOUT_MS,
    );
    if (!mounted) return { mounted: false, error: null };
    await new Promise(resolve => setTimeout(resolve, MOUNT_STABILITY_MS));
    return { mounted: currentMountedVehicle(bot)?.id === entity.id, error: null };
}

export async function mountEntity(bot, requestedType='mount', range=32) {
    const request = String(requestedType || 'mount')
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_');
    const searchRange = Math.max(4, Math.min(128, Number(range) || 32));
    const existingVehicle = currentMountedVehicle(bot);
    if (existingVehicle) {
        const matching = matchesRideableEntity(existingVehicle.name, request);
        setActionEvidence(bot, {
            kind: 'mount',
            outcome: matching ? 'already_mounted' : 'already_mounted_other',
            target: mountedVehicleTarget(existingVehicle),
            requestedType: request,
            retryable: !matching,
        });
        log(bot, matching
            ? `You are already mounted on ${existingVehicle.name}.`
            : `You are already mounted on ${existingVehicle.name}; dismount before choosing another ride.`);
        return matching;
    }

    let target = nearestRideableEntity(bot, request, searchRange);
    if (!target?.position) {
        setActionEvidence(bot, {
            kind: 'mount',
            outcome: 'rideable_not_found',
            target: { name: request },
            range: searchRange,
            retryable: true,
        });
        log(bot, `Could not find a rideable ${request} within ${searchRange} blocks.`);
        return false;
    }

    let distance = bot.entity.position.distanceTo(target.position);
    if (distance > MOUNT_INTERACTION_RANGE) {
        const approached = await goToGoal(bot, new pf.goals.GoalFollow(target, 2.5));
        target = bot.entities?.[target.id];
        if (!approached || !target?.position) {
            setActionEvidence(bot, {
                kind: 'mount',
                outcome: target?.position ? 'unreachable' : 'target_lost',
                target: { name: request, entityId: target?.id || null },
                retryable: true,
            });
            log(bot, target?.position
                ? `Could not reach the ${request} to mount it.`
                : `The ${request} left observed world state before it could be mounted.`);
            return false;
        }
        distance = bot.entity.position.distanceTo(target.position);
    }
    if (distance > MOUNT_INTERACTION_RANGE) {
        setActionEvidence(bot, {
            kind: 'mount',
            outcome: 'out_of_reach',
            target: mountedVehicleTarget(target),
            distance,
            retryable: true,
        });
        log(bot, `${target.name} is still ${distance.toFixed(1)} blocks away, outside mounting reach.`);
        return false;
    }

    const hasSaddle = inventoryCount(bot, 'saddle') > 0;
    const appearsSaddled = (target.equipment || []).some(item => item?.name === 'saddle');
    let saddleRequested = false;
    let saddleError = null;
    if (
        entityRequiresSaddle(target.name)
        && hasSaddle
        && !appearsSaddled
        && !bot.interrupt_code
    ) {
        const saddle = bot.inventory.items().find(item => item.name === 'saddle');
        try {
            await bot.equip(saddle, 'hand');
            await bot.useOn(target);
            saddleRequested = true;
            await new Promise(resolve => setTimeout(resolve, MOUNT_STABILITY_MS));
            target = bot.entities?.[target.id] || target;
        } catch (error) {
            saddleError = error;
        }
    }
    const result = await mountObservedEntity(bot, target);

    if (!result.mounted) {
        const interrupted = Boolean(bot.interrupt_code);
        setActionEvidence(bot, {
            kind: 'mount',
            outcome: interrupted ? 'interrupted' : 'mount_rejected',
            target: mountedVehicleTarget(target),
            requiresSaddle: entityRequiresSaddle(target.name),
            saddleCarried: hasSaddle,
            saddleRequested,
            error: result.error || saddleError
                ? String((result.error || saddleError).message || result.error || saddleError).slice(0, 240)
                : null,
            retryable: !interrupted,
        });
        log(bot, interrupted
            ? `Stopped while mounting ${target.name}.`
            : `Minecraft did not confirm mounting ${target.name}${entityRequiresSaddle(target.name) && !hasSaddle ? '; it may need a saddle or taming first' : ''}.`);
        return false;
    }

    const vehicle = currentMountedVehicle(bot);
    const knowledge = rideableEntityKnowledge(vehicle?.name || target.name);
    setActionEvidence(bot, {
        kind: 'mount',
        outcome: 'mounted',
        target: mountedVehicleTarget(vehicle || target),
        vehicle: knowledge,
        saddleRequested,
        retryable: false,
    });
    log(bot, `Mounted ${vehicle?.name || target.name}.`);
    return true;
}

export async function dismountVehicle(bot) {
    const vehicle = currentMountedVehicle(bot);
    if (!vehicle) {
        setActionEvidence(bot, {
            kind: 'mount',
            outcome: 'already_dismounted',
            retryable: false,
        });
        log(bot, 'You are already dismounted.');
        return true;
    }
    const target = mountedVehicleTarget(vehicle);
    try {
        bot.moveVehicle?.(0, 0);
        await bot.dismount();
        if (bot.supportFeature?.('newPlayerInputPacket')) {
            bot._client.write('player_input', { inputs: { shift: true } });
            await new Promise(resolve => setTimeout(resolve, 100));
            bot._client.write('player_input', { inputs: { shift: false } });
        }
    } catch (error) {
        setActionEvidence(bot, {
            kind: 'mount',
            outcome: 'dismount_rejected',
            target,
            error: String(error?.message || error).slice(0, 240),
            retryable: true,
        });
        log(bot, `Could not dismount ${target.name}: ${error.message}.`);
        return false;
    }
    const dismounted = await waitForWorldCondition(
        bot,
        () => !currentMountedVehicle(bot),
        MOUNT_CONFIRM_TIMEOUT_MS,
    );
    setActionEvidence(bot, {
        kind: 'mount',
        outcome: dismounted ? 'dismounted' : bot.interrupt_code ? 'interrupted' : 'dismount_unconfirmed',
        target,
        retryable: !dismounted && !bot.interrupt_code,
    });
    log(bot, dismounted
        ? `Dismounted ${target.name}.`
        : `Minecraft did not confirm dismounting ${target.name}.`);
    return dismounted;
}

export async function rideToPosition(bot, x, y, z, minDistance=2) {
    if (![x, y, z].every(Number.isFinite)) {
        setActionEvidence(bot, {
            kind: 'ride',
            outcome: 'invalid_target',
            target: { x, y, z },
            retryable: false,
        });
        log(bot, `Invalid riding coordinates x:${x} y:${y} z:${z}.`);
        return false;
    }
    const mountedVehicle = currentMountedVehicle(bot);
    if (!mountedVehicle || !isRideableEntityName(mountedVehicle.name)) {
        setActionEvidence(bot, {
            kind: 'ride',
            outcome: 'not_mounted',
            target: { x, y, z },
            retryable: true,
        });
        log(bot, 'You must mount a boat, minecart, or rideable animal before riding to coordinates.');
        return false;
    }
    if (typeof bot.moveVehicle !== 'function') {
        setActionEvidence(bot, {
            kind: 'ride',
            outcome: 'vehicle_controls_unavailable',
            target: { x, y, z },
            vehicle: mountedVehicleTarget(mountedVehicle),
            retryable: false,
        });
        log(bot, 'This connected Mineflayer version does not expose vehicle controls.');
        return false;
    }

    const vehicleId = mountedVehicle.id;
    const vehicleName = mountedVehicle.name;
    const vehicleKnowledge = rideableEntityKnowledge(vehicleName);
    const steeringItem = steeringItemForEntity(vehicleName);
    if (steeringItem) {
        const carried = bot.inventory.items().find(item => item.name === steeringItem);
        if (!carried) {
            setActionEvidence(bot, {
                kind: 'ride',
                outcome: 'missing_steering_item',
                target: { x, y, z },
                vehicle: mountedVehicleTarget(mountedVehicle),
                requiredItem: steeringItem,
                retryable: true,
            });
            log(bot, `${vehicleName} requires ${steeringItem} to steer, but none is carried.`);
            return false;
        }
        try {
            await bot.equip(carried, 'hand');
        } catch (error) {
            setActionEvidence(bot, {
                kind: 'ride',
                outcome: 'steering_item_not_equipped',
                target: { x, y, z },
                vehicle: mountedVehicleTarget(mountedVehicle),
                requiredItem: steeringItem,
                error: String(error?.message || error).slice(0, 240),
                retryable: true,
            });
            log(bot, `Could not equip ${steeringItem} to steer ${vehicleName}.`);
            return false;
        }
    }

    const requestedDistance = Math.max(0, Math.min(32, Number(minDistance) || 0));
    const destination = new Vec3(x, y, z);
    const startedAt = Date.now();
    let currentPosition = (mountedVehicle.position || bot.entity.position).clone();
    let bestDistance = currentPosition.distanceTo(destination);
    let lastProgressAt = startedAt;
    let finalDistance = bestDistance;
    let outcome = 'ride_timeout';

    try {
        while (Date.now() - startedAt < RIDE_MAX_DURATION_MS) {
            if (bot.interrupt_code) {
                outcome = 'interrupted';
                break;
            }
            const vehicle = currentMountedVehicle(bot);
            if (!vehicle || vehicle.id !== vehicleId || !vehicle.position) {
                outcome = 'unexpected_dismount';
                break;
            }
            currentPosition = vehicle.position.clone();
            finalDistance = currentPosition.distanceTo(destination);
            const horizontalDistance = Math.hypot(currentPosition.x - x, currentPosition.z - z);
            if (horizontalDistance <= requestedDistance + 0.5 && Math.abs(currentPosition.y - y) <= 4) {
                outcome = 'arrived';
                break;
            }
            if (bestDistance - finalDistance >= RIDE_PROGRESS_DISTANCE) {
                bestDistance = finalDistance;
                lastProgressAt = Date.now();
            }
            if (Date.now() - lastProgressAt >= RIDE_STALL_TIMEOUT_MS) {
                outcome = 'no_progress';
                break;
            }
            try {
                await bot.lookAt(new Vec3(x, currentPosition.y, z), true);
                bot.moveVehicle(0, 1);
                if (['boat', 'animal'].includes(vehicleKnowledge?.kind)) {
                    const step = driveVehicleStep(bot, vehicle, destination, vehicleKnowledge);
                    if (step.blocked) {
                        outcome = 'route_blocked';
                        break;
                    }
                }
            } catch (error) {
                outcome = 'control_rejected';
                setActionEvidence(bot, {
                    kind: 'ride',
                    outcome,
                    target: { x, y, z },
                    vehicle: mountedVehicleTarget(vehicle),
                    error: String(error?.message || error).slice(0, 240),
                    retryable: true,
                });
                log(bot, `Minecraft rejected ${vehicleName} controls: ${error.message}.`);
                return false;
            }
            await new Promise(resolve => setTimeout(
                resolve,
                ['boat', 'animal'].includes(vehicleKnowledge?.kind)
                    ? BOAT_CONTROL_POLL_MS
                    : RIDE_CONTROL_POLL_MS,
            ));
        }
    } finally {
        try { bot.moveVehicle(0, 0); } catch { /* disconnected or dismounted */ }
    }

    const arrived = outcome === 'arrived';
    setActionEvidence(bot, {
        kind: 'ride',
        outcome,
        target: { x, y, z },
        vehicle: {
            name: vehicleName,
            entityId: vehicleId,
            steeringItem,
        },
        distance: finalDistance,
        elapsedMs: Date.now() - startedAt,
        retryable: !arrived && outcome !== 'interrupted',
    });
    if (arrived) {
        log(bot, `Rode ${vehicleName} to within ${finalDistance.toFixed(1)} blocks of ${x}, ${y}, ${z}.`);
    } else if (outcome === 'no_progress') {
        log(bot, `${vehicleName} made no useful progress for ${Math.round(RIDE_STALL_TIMEOUT_MS / 1000)} seconds; it may need a saddle, taming, rails, a steering item, or a clearer route.`);
    } else if (outcome === 'unexpected_dismount') {
        log(bot, `You dismounted ${vehicleName} before reaching ${x}, ${y}, ${z}.`);
    } else if (outcome === 'interrupted') {
        log(bot, `Stopped riding ${vehicleName}.`);
    } else {
        log(bot, `Could not ride ${vehicleName} to ${x}, ${y}, ${z} before the bounded travel window ended.`);
    }
    return arrived;
}

export async function goToPlayer(bot, username, distance=3) {
    /**
     * Navigate to the given player.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} username, the username of the player to navigate to.
     * @param {number} distance, the goal distance to the player.
     * @returns {Promise<boolean>} true if the player was found, false otherwise.
     * @example
     * await skills.goToPlayer(bot, "player");
    **/
    if (bot.username === username) {
        setActionEvidence(bot, {
            kind: 'movement',
            outcome: 'already_at_target',
            target: { name: username },
            distance: 0,
            retryable: false,
        });
        log(bot, `You are already at ${username}.`);
        return true;
    }
    let resolution = resolvePhysicalPlayer(bot, username);
    let target = playerTargetEvidence(resolution);
    let player = resolution.entity;
    if (!player) {
        setActionEvidence(bot, {
            kind: 'movement',
            outcome: 'lost_target',
            target,
            retryable: false,
        });
        log(bot, `Could not find ${username}.`);
        return false;
    }
    if (bot.modes.isOn('cheat')) {
        bot.chat('/tp @s ' + resolution.canonical);
        setActionEvidence(bot, { kind: 'movement', outcome: 'teleport_requested', completion: 'requested', target, retryable: false });
        log(bot, `Requested teleport to ${resolution.canonical}; waiting for the server to apply it.`);
        return true;
    }

    distance = normalizePlayerDistance(distance, 3);
    const goal = new pf.goals.GoalFollow(player, distance);

    const reached = await goToGoal(bot, goal);
    if (!reached) return false;
    resolution = resolvePhysicalPlayer(bot, username);
    target = playerTargetEvidence(resolution);
    player = resolution.entity;
    if (!player) {
        setActionEvidence(bot, { kind: 'movement', outcome: 'lost_target', target, retryable: false });
        log(bot, `${username} is no longer visible after navigation.`);
        return false;
    }
    const actualDistance = bot.entity.position.distanceTo(player.position);
    if (actualDistance > distance + 1) {
        setActionEvidence(bot, { kind: 'movement', outcome: 'too_far', target, distance: actualDistance });
        log(bot, `Could not reach ${username}; still ${Math.round(actualDistance)} blocks away.`);
        return false;
    }
    setActionEvidence(bot, { kind: 'movement', outcome: 'arrived', target, distance: actualDistance });
    log(bot, `You have reached ${username}.`);
    return true;
}


export async function followPlayer(bot, username, distance=4) {
    /**
     * Follow the given player endlessly. Will not return until the code is manually stopped.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} username, the username of the player to follow.
     * @returns {Promise<boolean>} true if the player was found, false otherwise.
     * @example
     * await skills.followPlayer(bot, "player");
     **/
    distance = normalizePlayerDistance(distance, 3);
    let resolution = resolvePhysicalPlayer(bot, username);
    let target = playerTargetEvidence(resolution);
    let player = resolution.entity;
    if (!player) {
        companionContextFor(bot)?.markWaiting?.();
        setActionEvidence(bot, { kind: 'follow', outcome: 'waiting_for_target', target, retryable: false });
        log(bot, `Cannot follow ${username} yet: waiting for the player to reappear.`);
        return false;
    }

    const move = safeMovements(bot);
    bot.pathfinder.setMovements(move);
    let doorCheckInterval = null;
    let lastPosition = bot.entity.position.clone();
    let noProgressMs = 0;
    let recoveryAttempts = 0;
    let recoveryCooldownUntil = 0;
    let lastPathStatus = null;
    let followedEntityId = player.id;
    let lastSeenPosition = player.position.clone();
    let targetMissingSince = null;
    const canonicalUsername = resolution.canonical || username;
    const onPathUpdate = path => {
        lastPathStatus = path?.status || null;
        if (lastPathStatus === 'noPath' || lastPathStatus === 'timeout') {
            noProgressMs = Math.max(noProgressMs, FOLLOW_STUCK_AFTER_MS);
        }
    };

    bot.mindcraftManagedNavigationDepth = Math.max(
        0,
        Number(bot.mindcraftManagedNavigationDepth) || 0,
    ) + 1;
    bot.on('path_update', onPathUpdate);
    try {
        doorCheckInterval = startDoorInterval(bot);
        bot.pathfinder.setGoal(new ResponsiveFollowGoal(player, distance), true);
        setActionEvidence(bot, {
            kind: 'follow',
            outcome: 'pathing',
            target,
            distance,
            retryable: true,
        });
        log(bot, `You are now actively following player ${username}.`);

        while (!bot.interrupt_code) {
        await interruptibleDelay(bot, FOLLOW_SAMPLE_MS);
        if (bot.interrupt_code) break;
        resolution = resolvePhysicalPlayer(bot, username);
        target = playerTargetEvidence(resolution);
        const visiblePlayer = resolution.entity;
        if (!visiblePlayer) {
            const now = Date.now();
            const context = companionContextFor(bot);
            if (!context?.canUseLastSeen?.()) {
                context?.markWaiting?.();
                bot.pathfinder.stop();
                setActionEvidence(bot, {
                    kind: 'follow',
                    outcome: 'waiting_for_target',
                    target,
                    retryable: false,
                });
                log(bot, `Stopped moving toward stale coordinates for ${canonicalUsername}; waiting for the player to reappear.`);
                player = null;
                break;
            }
            if (targetMissingSince === null) {
                targetMissingSince = now;
                bot.pathfinder.setMovements(safeMovements(bot));
                bot.pathfinder.setGoal(new pf.goals.GoalNear(
                    lastSeenPosition.x,
                    lastSeenPosition.y,
                    lastSeenPosition.z,
                    normalizePlayerDistance(distance, 3),
                ));
                setActionEvidence(bot, {
                    kind: 'follow',
                    outcome: 'reacquiring',
                    target,
                    lastSeen: {
                        x: lastSeenPosition.x,
                        y: lastSeenPosition.y,
                        z: lastSeenPosition.z,
                    },
                    retryable: true,
                });
                log(bot, `Temporarily lost sight of ${canonicalUsername}; continuing to their last seen position and watching for them.`);
            }
            continue;
        }
        player = visiblePlayer;
        lastSeenPosition = player.position.clone();
        if (targetMissingSince !== null || player.id !== followedEntityId) {
            followedEntityId = player.id;
            bot.pathfinder.setMovements(safeMovements(bot));
            bot.pathfinder.setGoal(new ResponsiveFollowGoal(player, distance), true);
            noProgressMs = 0;
            recoveryAttempts = 0;
            recoveryCooldownUntil = 0;
            lastPathStatus = null;
            targetMissingSince = null;
            log(bot, `Reacquired ${canonicalUsername}; continuing the same follow order.`);
        }
        // in cheat mode, if the distance is too far, teleport to the player
        const distance_from_player = bot.entity.position.distanceTo(player.position);

        const teleport_distance = 100;
        const ignore_modes_distance = 30; 
        const nearby_distance = distance + 2;

        if (distance_from_player > nearby_distance) {
            const progress = bot.entity.position.distanceTo(lastPosition);
            if (Date.now() < recoveryCooldownUntil) {
                noProgressMs = 0;
            } else if (progress < MIN_MOVEMENT_PROGRESS) {
                noProgressMs += FOLLOW_SAMPLE_MS;
            } else {
                noProgressMs = 0;
                if (progress >= NAVIGATION_PROGRESS_DISTANCE) recoveryAttempts = 0;
            }
            if (noProgressMs >= FOLLOW_STUCK_AFTER_MS) {
                if (recoveryAttempts >= MAX_FOLLOW_RECOVERY_ATTEMPTS) {
                    recoveryCooldownUntil = Date.now() + FOLLOW_RECOVERY_COOLDOWN_MS;
                    setActionEvidence(bot, {
                        kind: 'follow',
                        outcome: 'blocked_waiting',
                        target,
                        distance: distance_from_player,
                        recoveryAttempts,
                        pathStatus: lastPathStatus,
                        retryable: true,
                    });
                    log(bot, `Path to ${canonicalUsername} is still obstructed after ${recoveryAttempts} local escape attempts; follow remains active and will retry after the route can change.`);
                } else {
                    recoveryAttempts += 1;
                    const recovery = await attemptLocalNavigationEscape(bot);
                    if (bot.interrupt_code) break;
                    bot.pathfinder.setMovements(safeMovements(bot));
                    bot.pathfinder.setGoal(new ResponsiveFollowGoal(player, distance), true);
                    setActionEvidence(bot, {
                        kind: 'follow',
                        outcome: recovery.success ? 'recovering' : 'recovery_blocked',
                        target,
                        distance: distance_from_player,
                        recoveryAttempts,
                        pathStatus: lastPathStatus,
                        recovery,
                        retryable: true,
                    });
                    log(bot, recovery.success
                        ? `Following ${username}: completed local escape ${recoveryAttempts}/${MAX_FOLLOW_RECOVERY_ATTEMPTS} and replanned the route.`
                        : `Following ${username}: local escape ${recoveryAttempts}/${MAX_FOLLOW_RECOVERY_ATTEMPTS} was blocked; keeping the dynamic follow route active.`);
                }
                noProgressMs = 0;
                lastPathStatus = null;
            }
        } else {
            noProgressMs = 0;
            recoveryAttempts = 0;
            recoveryCooldownUntil = 0;
            lastPathStatus = null;
        }

        if (distance_from_player > teleport_distance && bot.modes.isOn('cheat')) {
            // teleport with cheat mode
            await goToPlayer(bot, username);
        }
        else if (distance_from_player > ignore_modes_distance) {
            // these modes slow down the bot, and we want to catch up
            bot.modes.pause('item_collecting');
            bot.modes.pause('hunting');
            bot.modes.pause('torch_placing');
        }
        else if (distance_from_player <= ignore_modes_distance) {
            bot.modes.unpause('item_collecting');
            bot.modes.unpause('hunting');
            bot.modes.unpause('torch_placing');
        }

        if (distance_from_player <= nearby_distance) {
            clearDoorInterval(bot, doorCheckInterval);
            doorCheckInterval = null;
            bot.modes.pause('unstuck');
            bot.modes.pause('elbow_room');
        }
        else {
            if (!doorCheckInterval) {
                doorCheckInterval = startDoorInterval(bot);
            }
            bot.modes.unpause('unstuck');
            bot.modes.unpause('elbow_room');
        }
            lastPosition = bot.entity.position.clone();
        }
        return !bot.interrupt_code && Boolean(player);
    } finally {
        stopNavigationGoal(bot);
        bot.clearControlStates?.();
        bot.off('path_update', onPathUpdate);
        clearDoorInterval(bot, doorCheckInterval);
        for (const mode of ['unstuck', 'elbow_room', 'item_collecting', 'hunting', 'torch_placing']) {
            bot.modes.unpause(mode);
        }
        bot.mindcraftManagedNavigationDepth = Math.max(
            0,
            (Number(bot.mindcraftManagedNavigationDepth) || 1) - 1,
        );
    }
}


export async function moveAway(bot, distance, options = {}) {
    /**
     * Move away from current position in any direction.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} distance, the distance to move away.
     * @returns {Promise<boolean>} true if the bot moved away, false otherwise.
     * @example
     * await skills.moveAway(bot, 8);
     **/
    const pos = bot.entity.position.clone();
    const signal = options?.signal;
    if (signal?.aborted) return false;
    const requestedDistance = Math.max(0, Number(distance) || 0);
    const target = { x: pos.x, y: pos.y, z: pos.z };
    let goal = new pf.goals.GoalNear(pos.x, pos.y, pos.z, requestedDistance);
    let inverted_goal = new pf.goals.GoalInvert(goal);
    bot.pathfinder.setMovements(safeMovements(bot));

    if (bot.modes.isOn('cheat')) {
        let path;
        try {
            path = await bot.pathfinder.getPathTo(safeMovements(bot), inverted_goal, 10000);
            if (signal?.aborted) return false;
        } catch (err) {
            setActionEvidence(bot, { kind: 'movement', outcome: 'probe_error', target, error: err.message, retryable: true });
            log(bot, `Could not find a retreat path: ${err.message}.`);
            return false;
        }
        let last_move = path?.path?.[path.path.length - 1];
        if (last_move) {
            let x = Math.floor(last_move.x);
            let y = Math.floor(last_move.y);
            let z = Math.floor(last_move.z);
            bot.chat('/tp @s ' + x + ' ' + y + ' ' + z);
            setActionEvidence(bot, { kind: 'movement', outcome: 'teleport_requested', completion: 'requested', target: { x, y, z }, requestedDistance, retryable: false });
            log(bot, `Requested teleport retreat to ${x}, ${y}, ${z}.`);
            return true;
        }
        setActionEvidence(bot, { kind: 'movement', outcome: 'unreachable', target, pathStatus: path?.status || 'unknown', retryable: true });
        log(bot, `No safe retreat path found (${path?.status || 'unknown'}).`);
        return false;
    }

    let routed;
    try {
        routed = await goToGoal(bot, inverted_goal, options);
    } catch (err) {
        setActionEvidence(bot, {
            kind: 'movement',
            outcome: bot.interrupt_code ? 'interrupted' : 'blocked',
            target,
            error: err.message,
            retryable: !bot.interrupt_code,
        });
        log(bot, `Could not complete retreat: ${err.message}.`);
        return false;
    }
    if (!routed) {
        const outcome = bot.lastActionEvidence?.outcome || 'unreachable';
        setActionEvidence(bot, { kind: 'movement', outcome, target, retryable: true });
        return false;
    }
    if (signal?.aborted) return false;
    let new_pos = bot.entity.position;
    const moved = new_pos.distanceTo(pos);
    if (requestedDistance > 0 && moved + 0.5 < requestedDistance) {
        setActionEvidence(bot, { kind: 'movement', outcome: 'no_progress', target, requestedDistance, distance: moved, retryable: true });
        log(bot, `Retreat stopped after ${moved.toFixed(1)} blocks; ${requestedDistance.toFixed(1)} were requested.`);
        return false;
    }
    setActionEvidence(bot, { kind: 'movement', outcome: 'retreated', target, requestedDistance, distance: moved, retryable: true });
    log(bot, `Moved away from ${pos.floored()} to ${new_pos.floored()}.`);
    return true;
}

export async function moveAwayFromEntity(bot, entity, distance=16) {
    /**
     * Move away from the given entity.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {Entity} entity, the entity to move away from.
     * @param {number} distance, the distance to move away.
     * @returns {Promise<boolean>} true if the bot moved away, false otherwise.
     **/
    if (!entity?.position) {
        setActionEvidence(bot, { kind: 'movement', outcome: 'missing_target', retryable: false });
        log(bot, 'Cannot retreat: the threat is no longer available.');
        return false;
    }

    const requestedDistance = Math.max(0, Number(distance) || 0);
    const target = { name: entity.username || entity.name || 'entity', id: entity.id };
    let goal = new pf.goals.GoalFollow(entity, requestedDistance);
    let inverted_goal = new pf.goals.GoalInvert(goal);
    let routed;
    try {
        routed = await goToGoal(bot, inverted_goal);
    } catch (err) {
        setActionEvidence(bot, {
            kind: 'movement',
            outcome: bot.interrupt_code ? 'interrupted' : 'blocked',
            target,
            error: err.message,
            retryable: !bot.interrupt_code,
        });
        log(bot, `Could not retreat from ${target.name}: ${err.message}.`);
        return false;
    }
    if (!routed) {
        const outcome = bot.lastActionEvidence?.outcome || 'unreachable';
        setActionEvidence(bot, { kind: 'movement', outcome, target, retryable: true });
        return false;
    }
    if (!entity.position) {
        setActionEvidence(bot, { kind: 'movement', outcome: 'threat_gone', target, retryable: false });
        return true;
    }
    const actualDistance = bot.entity.position.distanceTo(entity.position);
    if (actualDistance + 0.5 < requestedDistance) {
        setActionEvidence(bot, { kind: 'movement', outcome: 'too_close', target, requestedDistance, distance: actualDistance, retryable: true });
        log(bot, `Could not clear ${target.name}; still ${actualDistance.toFixed(1)} blocks away.`);
        return false;
    }
    setActionEvidence(bot, { kind: 'movement', outcome: 'retreated', target, requestedDistance, distance: actualDistance, retryable: true });
    return true;
}

export async function avoidEnemies(bot, distance=16) {
    /**
     * Move a given distance away from all nearby enemy mobs.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} distance, the distance to move away.
     * @returns {Promise<boolean>} true if the bot moved away, false otherwise.
     * @example
     * await skills.avoidEnemies(bot, 8);
     **/
    const requestedDistance = Math.max(1, Number(distance) || 16);
    let enemy = world.getNearestEntityWhere(bot, entity => mc.isHostile(entity), requestedDistance);
    if (!enemy) {
        setActionEvidence(bot, { kind: 'reflex', outcome: 'no_threat', retryable: false });
        log(bot, 'No nearby threats require a retreat.');
        return true;
    }

    let attempts = 0;
    try {
        while (enemy && !bot.interrupt_code && attempts < MAX_AVOID_RETREAT_ATTEMPTS) {
            attempts += 1;
            const target = { name: enemy.username || enemy.name || 'entity', id: enemy.id };
            const retreated = await moveAwayFromEntity(bot, enemy, requestedDistance + 1);
            if (!retreated) {
                const prior = bot.lastActionEvidence || {};
                setActionEvidence(bot, {
                    ...prior,
                    kind: 'reflex',
                    target: prior.target || target,
                    attempts,
                    retryable: prior.retryable !== false,
                });
                return false;
            }

            enemy = world.getNearestEntityWhere(bot, entity => mc.isHostile(entity), requestedDistance);
            if (
                enemy
                && mc.isCombatSafeHostile(enemy)
                && bot.entity.position.distanceTo(enemy.position) < 3
            ) {
                if (!await attackEntity(bot, enemy, false)) {
                    const prior = bot.lastActionEvidence || {};
                    setActionEvidence(bot, {
                        ...prior,
                        kind: 'reflex',
                        target: prior.target || target,
                        attempts,
                        retryable: prior.retryable !== false,
                    });
                    return false;
                }
            }
        }
    } finally {
        bot.pathfinder.stop();
    }

    if (bot.interrupt_code) {
        setActionEvidence(bot, { kind: 'reflex', outcome: 'interrupted', attempts, retryable: false });
        return false;
    }
    if (enemy) {
        setActionEvidence(bot, {
            kind: 'reflex',
            outcome: 'threat_persists',
            target: { name: enemy.username || enemy.name || 'entity', id: enemy.id },
            attempts,
            retryable: true,
        });
        log(bot, `Could not establish safe distance after ${attempts} retreat attempts.`);
        return false;
    }
    setActionEvidence(bot, { kind: 'reflex', outcome: 'safe', attempts, requestedDistance, retryable: true });
    log(bot, `Established safe distance from nearby enemies after ${attempts} retreat attempt${attempts === 1 ? '' : 's'}.`);
    return true;
}

export async function stay(bot, seconds=30) {
    /**
     * Stay in the current position until interrupted. Disables all modes.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} seconds, the number of seconds to stay. Defaults to 30. -1 for indefinite.
     * @returns {Promise<boolean>} true if the bot stayed, false otherwise.
     * @example
     * await skills.stay(bot);
     **/
    bot.modes.pause('self_preservation');
    bot.modes.pause('unstuck');
    bot.modes.pause('cowardice');
    bot.modes.pause('self_defense');
    bot.modes.pause('hunting');
    bot.modes.pause('torch_placing');
    bot.modes.pause('item_collecting');
    let start = Date.now();
    while (!bot.interrupt_code && (seconds === -1 || Date.now() - start < seconds*1000)) {
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    log(bot, `Stayed for ${(Date.now() - start)/1000} seconds.`);
    return true;
}

export async function useDoor(bot, door_pos=null) {
    /**
     * Use the door at the given position.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {Vec3} door_pos, the position of the door to use. If null, the nearest door will be used.
     * @returns {Promise<boolean>} true if the door was used, false otherwise.
     * @example
     * let door = world.getNearestBlock(bot, "oak_door", 16).position;
     * await skills.useDoor(bot, door);
     **/
    const isWoodenDoor = block => Boolean(
        block?.name?.endsWith('_door')
        && !block.name.includes('trapdoor')
        && block.name !== 'iron_door'
    );
    const doorProperties = block => {
        try {
            return block?.getProperties?.() || block?._properties || {};
        } catch {
            return block?._properties || {};
        }
    };
    const isDoorOpen = block => {
        const open = doorProperties(block).open;
        return open === true || open === 'true';
    };
    const waitForDoorState = async (position, expectedOpen) => {
        const deadline = Date.now() + DOOR_STATE_SETTLE_MS * 3;
        let block = bot.blockAt(position);
        while (
            isWoodenDoor(block)
            && isDoorOpen(block) !== expectedOpen
            && Date.now() < deadline
            && !bot.interrupt_code
        ) {
            await new Promise(resolve => setTimeout(resolve, DOOR_STATE_SETTLE_MS));
            block = bot.blockAt(position);
        }
        return isWoodenDoor(block) && isDoorOpen(block) === expectedOpen;
    };

    let doorBlock;
    if (door_pos == null) {
        doorBlock = world.getNearestBlocksWhere(
            bot,
            block => isWoodenDoor(block),
            DOOR_SEARCH_RADIUS,
            1,
        )[0] || null;
        door_pos = doorBlock?.position?.clone?.() || null;
    } else {
        const coordinates = [Number(door_pos.x), Number(door_pos.y), Number(door_pos.z)];
        if (!coordinates.every(Number.isFinite)) {
            setActionEvidence(bot, { kind: 'door', outcome: 'invalid_target', retryable: false });
            log(bot, 'Cannot use door: coordinates are incomplete or invalid.');
            return false;
        }
        door_pos = new Vec3(
            Math.floor(coordinates[0]),
            Math.floor(coordinates[1]),
            Math.floor(coordinates[2]),
        );
        doorBlock = bot.blockAt(door_pos);
    }

    if (!door_pos || !doorBlock) {
        setActionEvidence(bot, { kind: 'door', outcome: 'door_not_found', retryable: true });
        log(bot, 'Could not find a loaded wooden door to use.');
        return false;
    }
    const target = {
        name: doorBlock.name || 'door',
        x: door_pos.x,
        y: door_pos.y,
        z: door_pos.z,
    };
    if (!isWoodenDoor(doorBlock)) {
        const outcome = doorBlock.name === 'iron_door' ? 'unsupported_iron_door' : 'invalid_target';
        setActionEvidence(bot, { kind: 'door', outcome, target, retryable: false });
        log(bot, `Cannot use ${doorBlock.name || 'target block'} as a wooden door.`);
        return false;
    }
    if (bot.interrupt_code) {
        setActionEvidence(bot, { kind: 'door', outcome: 'interrupted', target, retryable: false });
        return false;
    }

    const originalPosition = bot.entity.position.clone();
    if (bot.entity.position.distanceTo(door_pos) > DOOR_INTERACTION_REACH) {
        const approached = await goToPosition(bot, door_pos.x, door_pos.y, door_pos.z, 2);
        if (!approached) {
            const prior = bot.lastActionEvidence || {};
            const interrupted = Boolean(bot.interrupt_code);
            setActionEvidence(bot, {
                kind: 'door',
                outcome: interrupted ? 'interrupted' : prior.outcome || 'unreachable',
                target,
                evidence: prior,
                retryable: !interrupted && prior.retryable !== false,
            });
            log(bot, interrupted
                ? `Stopped before reaching ${target.name}.`
                : `Could not safely reach ${target.name}.`);
            return false;
        }
    }

    doorBlock = bot.blockAt(door_pos);
    if (!isWoodenDoor(doorBlock)) {
        const outcome = doorBlock ? 'door_changed' : 'target_unloaded';
        setActionEvidence(bot, { kind: 'door', outcome, target, retryable: true });
        log(bot, `Cannot use ${target.name}: the door is no longer available.`);
        return false;
    }
    const approachDistance = bot.entity.position.distanceTo(door_pos);
    if (approachDistance > DOOR_INTERACTION_REACH) {
        setActionEvidence(bot, { kind: 'door', outcome: 'out_of_reach', target, distance: approachDistance, retryable: true });
        log(bot, `Cannot use ${target.name}: still ${approachDistance.toFixed(1)} blocks away.`);
        return false;
    }

    const properties = doorProperties(doorBlock);
    const axis = properties.facing === 'north' || properties.facing === 'south'
        ? 'z'
        : properties.facing === 'east' || properties.facing === 'west'
            ? 'x'
            : Math.abs(originalPosition.x - (door_pos.x + 0.5)) >= Math.abs(originalPosition.z - (door_pos.z + 0.5))
                ? 'x'
                : 'z';
    const doorCenter = door_pos[axis] + 0.5;
    const sideOfDoor = position => Math.sign(position[axis] - doorCenter);
    const approachedPosition = bot.entity.position.clone();
    const initialSide = sideOfDoor(originalPosition) || sideOfDoor(approachedPosition);
    const approachedSide = sideOfDoor(approachedPosition);
    const approachAlreadyCrossed = Boolean(
        initialSide
        && approachedSide
        && approachedSide !== initialSide
        && approachedPosition.distanceTo(originalPosition) >= MIN_DOOR_TRAVERSE_PROGRESS
    );
    let openedByBot = false;
    let crossed = approachAlreadyCrossed;
    let closeVerified = !isDoorOpen(doorBlock);
    let cleanupError = null;

    try {
        if (!crossed) {
            await bot.lookAt(door_pos.offset(0.5, 0.5, 0.5), true);
            if (!isDoorOpen(doorBlock)) {
                await bot.activateBlock(doorBlock);
                openedByBot = true;
                if (!await waitForDoorState(door_pos, true)) {
                    setActionEvidence(bot, { kind: 'door', outcome: 'door_not_opened', target, retryable: true });
                    log(bot, `Minecraft did not confirm that ${target.name} opened.`);
                    return false;
                }
            }

            const traverseStart = bot.entity.position.clone();
            const startSide = sideOfDoor(traverseStart) || initialSide;
            const deadline = Date.now() + DOOR_TRAVERSE_TIMEOUT_MS;
            bot.setControlState('forward', true);
            try {
                while (!bot.interrupt_code && Date.now() < deadline) {
                    await new Promise(resolve => setTimeout(resolve, DOOR_TRAVERSE_POLL_MS));
                    const currentPosition = bot.entity.position;
                    const currentSide = sideOfDoor(currentPosition);
                    const progress = currentPosition.distanceTo(traverseStart);
                    if (startSide && currentSide && currentSide !== startSide && progress >= MIN_DOOR_TRAVERSE_PROGRESS) {
                        crossed = true;
                        break;
                    }
                }
            } finally {
                bot.setControlState('forward', false);
            }
        }
    } catch (error) {
        cleanupError = String(error?.message || error).slice(0, 240);
    } finally {
        const currentDoor = bot.blockAt(door_pos);
        if (isWoodenDoor(currentDoor) && isDoorOpen(currentDoor)) {
            try {
                await bot.activateBlock(currentDoor);
                closeVerified = await waitForDoorState(door_pos, false);
            } catch (error) {
                cleanupError ||= String(error?.message || error).slice(0, 240);
                closeVerified = false;
            }
        } else {
            closeVerified = isWoodenDoor(currentDoor) && !isDoorOpen(currentDoor);
        }
    }

    const finalPosition = bot.entity.position.clone();
    const distance = finalPosition.distanceTo(originalPosition);
    if (bot.interrupt_code) {
        setActionEvidence(bot, {
            kind: 'door',
            outcome: 'interrupted',
            target,
            distance,
            openedByBot,
            closeVerified,
            retryable: false,
        });
        log(bot, `Stopped while using ${target.name}.`);
        return false;
    }
    if (cleanupError && !crossed) {
        setActionEvidence(bot, {
            kind: 'door',
            outcome: 'door_interaction_failed',
            target,
            distance,
            error: cleanupError,
            closeVerified,
            retryable: true,
        });
        log(bot, `Could not use ${target.name}: ${cleanupError}.`);
        return false;
    }
    if (!crossed) {
        setActionEvidence(bot, {
            kind: 'door',
            outcome: 'not_traversed',
            target,
            distance,
            closeVerified,
            retryable: true,
        });
        log(bot, `Could not verify traversal through ${target.name}.`);
        return false;
    }

    const outcome = closeVerified ? 'traversed' : 'traversed_left_open';
    setActionEvidence(bot, {
        kind: 'door',
        outcome,
        target,
        distance,
        openedByBot,
        approachAlreadyCrossed,
        closeVerified,
        ...(cleanupError ? { cleanupError } : {}),
        retryable: !closeVerified,
    });
    log(bot, closeVerified
        ? `Traversed ${target.name} and closed it behind me.`
        : `Traversed ${target.name}, but could not verify that it closed.`);
    return true;
}

export async function goToBed(bot, {
    navigate = goToPosition,
    now = Date.now,
    delay = ms => new Promise(resolve => setTimeout(resolve, ms)),
    sleepTimeoutMs = 20_000,
} = {}) {
    /**
     * Sleep in the nearest bed.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the bed was found, false otherwise.
     * @example
     * await skills.goToBed(bot);
     **/
    let beds;
    try {
        beds = bot.findBlocks({
            matching: block => block?.name?.endsWith('_bed'),
            maxDistance: 32,
            count: 4,
        });
    } catch (error) {
        setActionEvidence(bot, {
            kind: 'sleep',
            outcome: 'bed_search_failed',
            error: String(error?.message || error).slice(0, 180),
            retryable: true,
        });
        log(bot, 'Could not safely search for a bed.');
        return false;
    }
    if (beds.length === 0) {
        setActionEvidence(bot, { kind: 'sleep', outcome: 'no_bed', retryable: true });
        log(bot, `Could not find a bed to sleep in.`);
        return false;
    }
    const loc = [...beds].sort((left, right) => (
        bot.entity.position.distanceTo(left) - bot.entity.position.distanceTo(right)
    ))[0];
    let bed = bot.blockAt(loc);
    const target = {
        name: bed?.name || 'bed',
        x: loc.x,
        y: loc.y,
        z: loc.z,
    };
    if (!bed?.name?.endsWith('_bed')) {
        setActionEvidence(bot, { kind: 'sleep', outcome: 'bed_unloaded', target, retryable: true });
        log(bot, 'The selected bed is no longer loaded.');
        return false;
    }
    const hostile = bot.nearestEntity?.(entity => mc.isHostile(entity));
    if (
        hostile?.position
        && hostile.position.distanceTo(bot.entity.position) <= 12
    ) {
        setActionEvidence(bot, { kind: 'sleep', outcome: 'unsafe_bed', target, retryable: true });
        log(bot, 'It is not safe to sleep while a hostile is nearby.');
        return false;
    }
    if (bot.interrupt_code) {
        setActionEvidence(bot, { kind: 'sleep', outcome: 'interrupted', target, retryable: true });
        return false;
    }
    const reached = await navigate(bot, loc.x, loc.y, loc.z, 2);
    if (!reached) {
        setActionEvidence(bot, { kind: 'sleep', outcome: 'unreachable', target, retryable: true });
        return false;
    }
    bed = bot.blockAt(loc);
    if (!bed?.name?.endsWith('_bed')) {
        setActionEvidence(bot, { kind: 'sleep', outcome: 'bed_changed', target, retryable: true });
        log(bot, 'The selected bed changed before it could be used.');
        return false;
    }
    try {
        await bot.sleep(bed);
    } catch (error) {
        setActionEvidence(bot, {
            kind: 'sleep',
            outcome: 'sleep_rejected',
            target,
            error: String(error?.message || error).slice(0, 180),
            retryable: true,
        });
        log(bot, `Could not sleep: ${error?.message || error}.`);
        return false;
    }
    if (!bot.isSleeping) {
        setActionEvidence(bot, {
            kind: 'sleep',
            outcome: 'sleep_not_confirmed',
            target,
            enteredSleep: false,
            retryable: true,
        });
        log(bot, 'The server did not confirm that sleep began.');
        return false;
    }
    log(bot, `You are in bed.`);
    bot.modes.pause('unstuck');
    const deadline = now() + Math.max(1_000, sleepTimeoutMs);
    while (bot.isSleeping) {
        if (bot.interrupt_code || now() >= deadline) {
            try {
                await bot.wake?.();
            } catch {
                // The postcondition below remains authoritative.
            }
            const outcome = bot.interrupt_code ? 'interrupted' : 'sleep_timeout';
            setActionEvidence(bot, {
                kind: 'sleep',
                outcome,
                target,
                enteredSleep: true,
                woke: !bot.isSleeping,
                retryable: true,
            });
            return false;
        }
        await delay(250);
    }
    setActionEvidence(bot, {
        kind: 'sleep',
        outcome: 'slept',
        target,
        enteredSleep: true,
        woke: true,
        retryable: false,
    });
    log(bot, `You have woken up.`);
    return true;
}

export async function tillAndSow(bot, x, y, z, seedType=null) {
    /**
     * Till the ground at the given position and plant the given seed type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} x, the x coordinate to till.
     * @param {number} y, the y coordinate to till.
     * @param {number} z, the z coordinate to till.
     * @param {string} plantType, the type of plant to plant. Defaults to none, which will only till the ground.
     * @returns {Promise<boolean>} true if the ground was tilled, false otherwise.
     * @example
     * let position = world.getPosition(bot);
     * await skills.tillAndSow(bot, position.x, position.y - 1, position.x, "wheat");
     **/
    if (![x, y, z].every(Number.isFinite)) {
        setActionEvidence(bot, { kind: 'farm', outcome: 'invalid_target', retryable: false });
        log(bot, 'Cannot till: position is incomplete or invalid.');
        return false;
    }
    const target = { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) };
    const expectedCrop = seedType ? {
        wheat_seeds: 'wheat',
        beetroot_seeds: 'beetroots',
        carrot: 'carrots',
        potato: 'potatoes',
    }[seedType] || seedType.replace(/_seeds?$/, '') : null;
    let pos = new Vec3(target.x, target.y, target.z);
    let block = bot.blockAt(pos);
    if (!block) {
        setActionEvidence(bot, { kind: 'farm', outcome: 'target_unloaded', target, retryable: true });
        log(bot, 'Cannot till: target chunk is not loaded.');
        return false;
    }
    log(bot, `Planting ${seedType} at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);

    if (bot.modes.isOn('cheat')) {
        if (!seedType) {
            return await placeBlock(bot, 'farmland', x, y, z);
        }
        let to_remove = ['_seed', '_seeds'];
        for (let remove of to_remove) {
            if (seedType.endsWith(remove)) {
                seedType = seedType.replace(remove, '');
            }
        }
        if (!await placeBlock(bot, 'farmland', x, y, z)) return false;
        return await placeBlock(bot, seedType, x, y+1, z);
    }

    if (block.name !== 'grass_block' && block.name !== 'dirt' && block.name !== 'farmland') {
        log(bot, `Cannot till ${block.name}, must be grass_block or dirt.`);
        return false;
    }
    let above = bot.blockAt(new Vec3(x, y+1, z));
    if (!above) {
        setActionEvidence(bot, { kind: 'farm', outcome: 'target_unloaded', target, retryable: true });
        return false;
    }
    if (above.name !== 'air') {
        if (block.name === 'farmland' && above.name === expectedCrop) {
            log(bot, `Land is already farmed with ${above.name}.`);
            return true;
        }
        let broken = await breakBlockAt(bot, x, y+1, z);
        if (!broken) {
            log(bot, `Cannot cannot break above block to till.`);
            return false;
        }
    }
    // if distance is too far, move to the block
    if (bot.entity.position.distanceTo(block.position) > 4.5) {
        let pos = block.position;
        const reached = await goToGoal(bot, new pf.goals.GoalNear(pos.x, pos.y, pos.z, 4));
        if (!reached || bot.entity.position.distanceTo(block.position) > 4.5) {
            setActionEvidence(bot, { kind: 'farm', outcome: 'unreachable', target, retryable: true });
            log(bot, 'Cannot reach the farmland target.');
            return false;
        }
    }
    if (block.name !== 'farmland') {
        let hoe = bestInventoryTool(bot, 'hoe');
        if (!hoe) {
            if (!await prepareTool(bot, 'stone_hoe') || bot.interrupt_code) {
                log(bot, 'Cannot till: no usable hoe could be prepared.');
                return false;
            }
            hoe = bestInventoryTool(bot, 'hoe');
        }
        if (!hoe || !await equip(bot, hoe.name)) return false;
        try {
            await bot.activateBlock(block);
        } catch (error) {
            setActionEvidence(bot, { kind: 'farm', outcome: 'till_blocked', target, error: error.message, retryable: true });
            log(bot, `Could not till the block: ${error.message}.`);
            return false;
        }
        const tilled = await waitForWorldCondition(
            bot,
            () => bot.blockAt(pos)?.name === 'farmland',
            1_500,
            50,
        );
        if (!tilled) {
            setActionEvidence(bot, { kind: 'farm', outcome: 'till_unverified', target, retryable: true });
            log(bot, 'Minecraft did not confirm farmland after hoe use.');
            return false;
        }
        block = bot.blockAt(pos);
        log(bot, `Tilled block x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);
    }
    
    if (seedType) {
        if (seedType.endsWith('seed') && !seedType.endsWith('seeds'))
            seedType += 's'; // fixes common mistake
        let equipped_seeds = await equip(bot, seedType);
        if (!equipped_seeds) {
            log(bot, `No ${seedType} to plant.`);
            return false;
        }

        try {
            await bot.activateBlock(block);
        } catch (error) {
            setActionEvidence(bot, { kind: 'farm', outcome: 'plant_blocked', target, error: error.message, retryable: true });
            log(bot, `Could not plant ${seedType}: ${error.message}.`);
            return false;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        const plantedCrop = {
            wheat_seeds: 'wheat',
            beetroot_seeds: 'beetroots',
            carrot: 'carrots',
            potato: 'potatoes',
        }[seedType] || seedType.replace(/_seeds?$/, '');
        const planted = bot.blockAt(new Vec3(x, y + 1, z));
        if (planted?.name !== plantedCrop) {
            setActionEvidence(bot, {
                kind: 'farm',
                outcome: 'plant_unverified',
                target,
                seed: seedType,
                expected: plantedCrop,
                observed: planted?.name || null,
                retryable: true,
            });
            log(bot, `Minecraft did not confirm ${plantedCrop} above the farmland.`);
            return false;
        }
        log(bot, `Planted ${seedType} at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);
    }
    setActionEvidence(bot, { kind: 'farm', outcome: seedType ? 'planted' : 'tilled', target, seed: seedType || null, retryable: false });
    return true;
}

const FARM_CROP_INPUTS = Object.freeze({
    wheat: Object.freeze({ crop: 'wheat', seed: 'wheat_seeds' }),
    wheat_seeds: Object.freeze({ crop: 'wheat', seed: 'wheat_seeds' }),
    carrot: Object.freeze({ crop: 'carrots', seed: 'carrot' }),
    carrots: Object.freeze({ crop: 'carrots', seed: 'carrot' }),
    potato: Object.freeze({ crop: 'potatoes', seed: 'potato' }),
    potatoes: Object.freeze({ crop: 'potatoes', seed: 'potato' }),
    beetroot: Object.freeze({ crop: 'beetroots', seed: 'beetroot_seeds' }),
    beetroots: Object.freeze({ crop: 'beetroots', seed: 'beetroot_seeds' }),
    beetroot_seeds: Object.freeze({ crop: 'beetroots', seed: 'beetroot_seeds' }),
});

function dimensionName(bot) {
    return String(bot.game?.dimension || 'overworld').replace(/^minecraft:/, '');
}

function normalizeFarmState(raw) {
    const spec = FARM_CROP_INPUTS[String(raw?.crop || '').trim().toLowerCase()];
    if (!spec || !Array.isArray(raw?.cells) || raw.cells.length < 1 || raw.cells.length > 64) return null;
    const cells = raw.cells
        .filter(cell => [cell?.x, cell?.y, cell?.z].every(Number.isFinite))
        .map(cell => ({ x: Math.floor(cell.x), y: Math.floor(cell.y), z: Math.floor(cell.z) }));
    if (cells.length !== raw.cells.length) return null;
    return {
        dimension: String(raw.dimension || 'overworld').replace(/^minecraft:/, ''),
        crop: spec.crop,
        seed: spec.seed,
        water: raw.water,
        cells,
    };
}

function farmCellStatus(bot, farm, cell) {
    const soil = bot.blockAt(new Vec3(cell.x, cell.y, cell.z));
    const crop = bot.blockAt(new Vec3(cell.x, cell.y + 1, cell.z));
    const cropSpec = CROP_FOOD_SPECS[farm.crop];
    return {
        soil,
        crop,
        planted: soil?.name === 'farmland' && crop?.name === farm.crop,
        mature: soil?.name === 'farmland'
            && crop?.name === farm.crop
            && Number(crop?._properties?.age) >= cropSpec.maxAge,
    };
}

export async function establishFarm(bot, cropName='wheat', width=3, depth=3, range=32) {
    const spec = FARM_CROP_INPUTS[String(cropName || '').trim().toLowerCase()];
    const farmWidth = Math.max(1, Math.min(4, Math.floor(Number(width) || 3)));
    const farmDepth = Math.max(1, Math.min(4, Math.floor(Number(depth) || 3)));
    const searchRange = Math.max(8, Math.min(64, Math.floor(Number(range) || 32)));
    if (!spec) {
        setActionEvidence(bot, { kind: 'farm_establish', outcome: 'unsupported_crop', retryable: false });
        log(bot, 'Farm crop must be wheat, carrots, potatoes, or beetroots.');
        return false;
    }
    const water = world.getNearestBlock(bot, 'water', searchRange);
    if (!water) {
        setActionEvidence(bot, { kind: 'farm_establish', outcome: 'missing_water', target: { name: spec.crop }, retryable: true });
        log(bot, `No loaded water source is available within ${searchRange} blocks for hydrated farmland.`);
        return false;
    }
    const candidates = [];
    for (let dx = -4; dx <= 4; dx += 1) {
        for (let dz = -4; dz <= 4; dz += 1) {
            if (dx === 0 && dz === 0) continue;
            const soil = bot.blockAt(water.position.offset(dx, 0, dz));
            const above = bot.blockAt(water.position.offset(dx, 1, dz));
            if (
                ['dirt', 'grass_block', 'farmland'].includes(soil?.name)
                && (
                    above?.name === 'air'
                    || above?.name === spec.crop
                    || isReplaceableGameplayBlock(above)
                )
            ) candidates.push({
                x: soil.position.x,
                y: soil.position.y,
                z: soil.position.z,
                distance: Math.abs(dx) + Math.abs(dz),
            });
        }
    }
    candidates.sort((left, right) => left.distance - right.distance || left.x - right.x || left.z - right.z);
    const requested = farmWidth * farmDepth;
    const cells = candidates.slice(0, requested).map(({ x, y, z }) => ({ x, y, z }));
    if (cells.length < requested) {
        setActionEvidence(bot, {
            kind: 'farm_establish',
            outcome: 'insufficient_hydrated_soil',
            target: { name: spec.crop, x: water.position.x, y: water.position.y, z: water.position.z },
            requested,
            available: cells.length,
            retryable: true,
        });
        log(bot, `Only ${cells.length} safe hydrated farm plots are loaded; ${requested} were requested.`);
        return false;
    }
    const alreadyPlanted = cells.filter(cell => farmCellStatus(bot, { crop: spec.crop }, cell).planted).length;
    const seedsNeeded = requested - alreadyPlanted;
    if (inventoryCount(bot, spec.seed) < seedsNeeded) {
        setActionEvidence(bot, {
            kind: 'farm_establish',
            outcome: 'missing_seeds',
            target: { name: spec.crop },
            seed: spec.seed,
            required: seedsNeeded,
            available: inventoryCount(bot, spec.seed),
            retryable: true,
        });
        log(bot, `Establishing this farm requires ${seedsNeeded} ${spec.seed}; only ${inventoryCount(bot, spec.seed)} are carried.`);
        return false;
    }
    for (const cell of cells) {
        if (bot.interrupt_code) return false;
        if (farmCellStatus(bot, { crop: spec.crop }, cell).planted) continue;
        if (!await tillAndSow(bot, cell.x, cell.y, cell.z, spec.seed)) return false;
    }
    const verified = cells.filter(cell => farmCellStatus(bot, { crop: spec.crop }, cell).planted).length;
    const farm = {
        dimension: dimensionName(bot),
        crop: spec.crop,
        seed: spec.seed,
        water: { x: water.position.x, y: water.position.y, z: water.position.z },
        cells,
    };
    setActionEvidence(bot, {
        kind: 'farm_establish',
        outcome: verified === requested ? 'established' : 'verification_failed',
        target: { name: spec.crop, ...farm.water },
        farm,
        requested,
        verified,
        retryable: verified !== requested,
    });
    if (verified !== requested) return false;
    log(bot, `Established and verified ${verified} hydrated ${spec.crop} plots.`);
    return true;
}

export async function maintainFarm(bot, rawFarm) {
    const farm = normalizeFarmState(rawFarm);
    if (!farm) {
        setActionEvidence(bot, { kind: 'farm_maintain', outcome: 'invalid_farm_state', retryable: false });
        return false;
    }
    if (farm.dimension !== dimensionName(bot)) {
        setActionEvidence(bot, {
            kind: 'farm_maintain',
            outcome: 'wrong_dimension',
            target: { name: farm.crop },
            expected: farm.dimension,
            observed: dimensionName(bot),
            retryable: true,
        });
        log(bot, `The remembered farm is in ${farm.dimension}; return there before maintaining it.`);
        return false;
    }
    const statuses = farm.cells.map(cell => ({ cell, ...farmCellStatus(bot, farm, cell) }));
    const actionable = statuses.filter(status => (
        !status.planted || status.mature
    ));
    const missingPlots = statuses.filter(status => !status.planted).length;
    if (inventoryCount(bot, farm.seed) < missingPlots) {
        setActionEvidence(bot, {
            kind: 'farm_maintain',
            outcome: 'missing_seed_reserve',
            target: { name: farm.crop },
            seed: farm.seed,
            required: missingPlots,
            available: inventoryCount(bot, farm.seed),
            retryable: true,
        });
        log(bot, `Repairing missing farm plots requires ${missingPlots} ${farm.seed}; mature plots can supply their own replanting seed.`);
        return false;
    }
    let harvested = 0;
    let replanted = 0;
    for (const { cell } of actionable) {
        if (bot.interrupt_code) return false;
        const status = farmCellStatus(bot, farm, cell);
        if (status.mature) {
            if (!await breakBlockAt(bot, cell.x, cell.y + 1, cell.z)) return false;
            harvested += 1;
            await new Promise(resolve => setTimeout(resolve, 150));
            try { await pickupNearbyItems(bot); } catch { /* inventory verification follows */ }
        }
        if (inventoryCount(bot, farm.seed) < 1) {
            setActionEvidence(bot, {
                kind: 'farm_maintain',
                outcome: 'harvest_yield_missing_seed',
                target: { name: farm.crop, x: cell.x, y: cell.y, z: cell.z },
                seed: farm.seed,
                retryable: true,
            });
            return false;
        }
        if (!await tillAndSow(bot, cell.x, cell.y, cell.z, farm.seed)) return false;
        replanted += 1;
    }
    const verified = farm.cells.filter(cell => farmCellStatus(bot, farm, cell).planted).length;
    setActionEvidence(bot, {
        kind: 'farm_maintain',
        outcome: verified === farm.cells.length ? 'maintained' : 'verification_failed',
        target: { name: farm.crop },
        farm,
        harvested,
        replanted,
        verified,
        expected: farm.cells.length,
        retryable: verified !== farm.cells.length,
    });
    if (verified !== farm.cells.length) return false;
    log(bot, `Maintained ${verified} remembered farm plots; harvested ${harvested} and replanted ${replanted}.`);
    return true;
}

const BREEDING_FOOD = Object.freeze({
    cow: 'wheat',
    sheep: 'wheat',
    pig: 'carrot',
    chicken: 'wheat_seeds',
    rabbit: 'carrot',
});

function isAdultBreedingAnimal(entity, animal) {
    if (entity?.name !== animal || !entity.position) return false;
    const babyFlag = entity.metadata?.[16];
    return babyFlag !== true && babyFlag !== 1;
}

function isBabyBreedingAnimal(entity, animal) {
    return entity?.name === animal
        && Boolean(entity.position)
        && (entity.metadata?.[16] === true || entity.metadata?.[16] === 1);
}

export async function breedAnimals(bot, animalName, pairs=1, range=24) {
    const animal = String(animalName || '').trim().toLowerCase();
    const food = BREEDING_FOOD[animal];
    const pairCount = Math.max(1, Math.min(4, Math.floor(Number(pairs) || 1)));
    const searchRange = Math.max(8, Math.min(48, Math.floor(Number(range) || 24)));
    if (!food) {
        setActionEvidence(bot, { kind: 'breed', outcome: 'unsupported_animal', target: { name: animal }, retryable: false });
        log(bot, 'Breeding supports cows, sheep, pigs, chickens, and rabbits.');
        return false;
    }
    const adults = world.getNearbyEntities(bot, searchRange)
        .filter(entity => isAdultBreedingAnimal(entity, animal))
        .sort((left, right) => bot.entity.position.distanceTo(left.position) - bot.entity.position.distanceTo(right.position));
    const requiredAdults = pairCount * 2;
    if (adults.length < requiredAdults) {
        setActionEvidence(bot, {
            kind: 'breed',
            outcome: 'insufficient_adults',
            target: { name: animal },
            requiredAdults,
            availableAdults: adults.length,
            retryable: true,
        });
        log(bot, `Breeding ${pairCount} pair(s) requires ${requiredAdults} nearby adult ${animal}; ${adults.length} are loaded.`);
        return false;
    }
    if (inventoryCount(bot, food) < requiredAdults) {
        setActionEvidence(bot, {
            kind: 'breed',
            outcome: 'missing_breeding_food',
            target: { name: animal },
            food,
            required: requiredAdults,
            available: inventoryCount(bot, food),
            retryable: true,
        });
        log(bot, `Breeding requires ${requiredAdults} ${food}; only ${inventoryCount(bot, food)} are carried.`);
        return false;
    }
    const beforeIds = new Set(world.getNearbyEntities(bot, searchRange)
        .filter(entity => entity?.name === animal)
        .map(entity => entity.id));
    for (const parent of adults.slice(0, requiredAdults)) {
        if (bot.interrupt_code) return false;
        const reached = await goToGoal(bot, new pf.goals.GoalFollow(parent, 2));
        if (!reached || !parent.position || bot.entity.position.distanceTo(parent.position) > 4.5) {
            setActionEvidence(bot, { kind: 'breed', outcome: 'parent_unreachable', target: { name: animal, id: parent.id }, retryable: true });
            return false;
        }
        if (!await equip(bot, food)) return false;
        const beforeFood = inventoryCount(bot, food);
        try {
            await bot.activateEntity(parent);
        } catch (error) {
            setActionEvidence(bot, { kind: 'breed', outcome: 'feeding_blocked', target: { name: animal, id: parent.id }, error: error.message, retryable: true });
            return false;
        }
        const consumed = await waitForWorldCondition(bot, () => inventoryCount(bot, food) < beforeFood, 1_500, 50);
        if (!consumed) {
            setActionEvidence(bot, { kind: 'breed', outcome: 'feeding_unverified', target: { name: animal, id: parent.id }, retryable: true });
            return false;
        }
    }
    const expectedBabies = pairCount;
    const bred = await waitForWorldCondition(bot, () => (
        world.getNearbyEntities(bot, searchRange)
            .filter(entity => isBabyBreedingAnimal(entity, animal) && !beforeIds.has(entity.id))
            .length >= expectedBabies
    ), 12_000, 100);
    const newAnimals = world.getNearbyEntities(bot, searchRange)
        .filter(entity => isBabyBreedingAnimal(entity, animal) && !beforeIds.has(entity.id))
        .length;
    setActionEvidence(bot, {
        kind: 'breed',
        outcome: bred ? 'bred' : 'offspring_unverified',
        target: { name: animal },
        pairs: pairCount,
        offspring: newAnimals,
        adultsPreserved: adults.length,
        retryable: !bred,
    });
    if (!bred) return false;
    log(bot, `Bred ${pairCount} ${animal} pair(s) and verified ${newAnimals} new offspring.`);
    return true;
}

export async function activateNearestBlock(bot, type) {
    /**
     * Activate the nearest block of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} type, the type of block to activate.
     * @returns {Promise<boolean>} true if the block was activated, false otherwise.
     * @example
     * await skills.activateNearestBlock(bot, "lever");
     * **/
    let block = world.getNearestBlock(bot, type, 16);
    if (!block) {
        setActionEvidence(bot, { kind: 'activate', outcome: 'missing_target', target: { name: type }, retryable: false });
        log(bot, `Could not find any ${type} to activate.`);
        return false;
    }
    const target = { name: type, x: block.position.x, y: block.position.y, z: block.position.z };
    if (bot.entity.position.distanceTo(block.position) > 4.5) {
        let pos = block.position;
        const reached = await goToGoal(bot, new pf.goals.GoalNear(pos.x, pos.y, pos.z, 4));
        if (!reached || bot.entity.position.distanceTo(block.position) > 4.5) {
            setActionEvidence(bot, { kind: 'activate', outcome: 'unreachable', target, retryable: true });
            log(bot, `Cannot reach ${type} to activate it.`);
            return false;
        }
    }
    try {
        await bot.activateBlock(block);
    } catch (error) {
        setActionEvidence(bot, { kind: 'activate', outcome: 'activation_blocked', target, error: error.message, retryable: true });
        log(bot, `Could not activate ${type}: ${error.message}.`);
        return false;
    }
    setActionEvidence(bot, { kind: 'activate', outcome: 'activated', target, retryable: false });
    log(bot, `Activated ${type} at x:${block.position.x.toFixed(1)}, y:${block.position.y.toFixed(1)}, z:${block.position.z.toFixed(1)}.`);
    return true;
}

/**
 * Helper function to find and navigate to a villager for trading
 * @param {MinecraftBot} bot - reference to the minecraft bot
 * @param {number} id - the entity id of the villager
 * @returns {Promise<Object|null>} the villager entity if found and reachable, null otherwise
 */
async function findAndGoToVillager(bot, id) {
    id = id+"";
    const entity = bot.entities[id];
    
    if (!entity) {
        log(bot, `Cannot find villager with id ${id}`);
        let entities = world.getNearbyEntities(bot, 16);
        let villager_list = "Available villagers:\n";
        for (let entity of entities) {
            if (entity.name === 'villager') {
                if (entity.metadata && entity.metadata[16] === 1) {
                    villager_list += `${entity.id}: baby villager\n`;
                } else {
                    const profession = world.getVillagerProfession(entity);
                    villager_list += `${entity.id}: ${profession}\n`;
                }
            }
        }
        if (villager_list === "Available villagers:\n") {
            log(bot, "No villagers found nearby.");
            return null;
        }
        log(bot, villager_list);
        return null;
    }
    
    if (entity.entityType !== bot.registry.entitiesByName.villager.id) {
        log(bot, 'Entity is not a villager');
        return null;
    }
    
    if (entity.metadata && entity.metadata[16] === 1) {
        log(bot, 'This is either a baby villager or a villager with no job - neither can trade');
        return null;
    }
    
    const distance = bot.entity.position.distanceTo(entity.position);
    if (distance > 4) {
        log(bot, `Villager is ${distance.toFixed(1)} blocks away, moving closer...`);
        bot.modes.pause('unstuck');
        try {
            const goal = new pf.goals.GoalFollow(entity, 2);
            const reached = await goToGoal(bot, goal);
            const finalDistance = entity.position
                ? bot.entity.position.distanceTo(entity.position)
                : Number.POSITIVE_INFINITY;
            if (!reached || finalDistance > 4.5) {
                log(bot, 'Failed to reach villager safely.');
                return null;
            }
            log(bot, 'Successfully reached villager.');
        } finally {
            bot.modes.unpause('unstuck');
        }
    }
    
    return entity;
}

/**
 * Show available trades for a specified villager
 * @param {MinecraftBot} bot - reference to the minecraft bot
 * @param {number} id - the entity id of the villager to show trades for
 * @returns {Promise<boolean>} true if trades were shown successfully, false otherwise
 * @example
 * await skills.showVillagerTrades(bot, "123");
 */
export async function showVillagerTrades(bot, id) {
    const villagerEntity = await findAndGoToVillager(bot, id);
    const target = { name: 'villager', id: Number(id) || id };
    if (!villagerEntity) {
        setActionEvidence(bot, { kind: 'villager', outcome: 'not_found', target, retryable: true });
        return false;
    }
    let villager = null;
    try {
        villager = await bot.openVillager(villagerEntity);
        
        if (!villager.trades || villager.trades.length === 0) {
            log(bot, 'This villager has no trades available - might be sleeping, a baby, or jobless');
            setActionEvidence(bot, { kind: 'villager', outcome: 'no_trades', target, retryable: true });
            return false;
        }
        
        log(bot, `Villager has ${villager.trades.length} available trades:`);
        stringifyTrades(bot, villager.trades).forEach((trade, i) => {
            const tradeInfo = `${i + 1}: ${trade}`;
            console.log(tradeInfo);
            log(bot, tradeInfo);
        });
        
        setActionEvidence(bot, {
            kind: 'villager',
            outcome: 'trades_observed',
            target,
            count: villager.trades.length,
            retryable: false,
        });
        return true;
    } catch (err) {
        log(bot, 'Failed to open villager trading interface - they might be sleeping, a baby, or jobless');
        console.log('Villager trading error:', err.message);
        setActionEvidence(bot, {
            kind: 'villager',
            outcome: 'open_blocked',
            target,
            error: String(err?.message || err).slice(0, 240),
            retryable: true,
        });
        return false;
    } finally {
        await closeContainerQuietly(villager);
    }
}

/**
 * Trade with a specified villager
 * @param {MinecraftBot} bot - reference to the minecraft bot
 * @param {number} id - the entity id of the villager to trade with
 * @param {number} index - the index (1-based) of the trade to execute
 * @param {number} count - how many times to execute the trade (optional)
 * @returns {Promise<boolean>} true if trade was successful, false otherwise
 * @example
 * await skills.tradeWithVillager(bot, "123", "1", "2");
 */
export async function tradeWithVillager(bot, id, index, count) {
    const villagerEntity = await findAndGoToVillager(bot, id);
    const target = { name: 'villager', id: Number(id) || id, trade: Number(index) || index };
    if (!villagerEntity) {
        setActionEvidence(bot, { kind: 'trade', outcome: 'villager_not_found', target, retryable: true });
        return false;
    }
    let villager = null;
    try {
        villager = await bot.openVillager(villagerEntity);
        
        if (!villager.trades || villager.trades.length === 0) {
            log(bot, 'This villager has no trades available - might be sleeping, a baby, or jobless');
            setActionEvidence(bot, { kind: 'trade', outcome: 'no_trades', target, retryable: true });
            return false;
        }
        
        const tradeIndex = parseInt(index) - 1; // Convert to 0-based index
        const trade = villager.trades[tradeIndex];
        
        if (!trade) {
            log(bot, `Trade ${index} not found. This villager has ${villager.trades.length} trades available.`);
            setActionEvidence(bot, { kind: 'trade', outcome: 'invalid_trade', target, retryable: false });
            return false;
        }
        
        if (trade.disabled) {
            log(bot, `Trade ${index} is currently disabled`);
            setActionEvidence(bot, { kind: 'trade', outcome: 'trade_disabled', target, retryable: true });
            return false;
        }

        const item_2 = trade.inputItem2 ? stringifyItem(bot, trade.inputItem2)+' ' : '';
        log(bot, `Trading ${stringifyItem(bot, trade.inputItem1)} ${item_2}for ${stringifyItem(bot, trade.outputItem)}...`);
        
        const maxPossibleTrades = trade.maximumNbTradeUses - trade.nbTradeUses;
        const requestedCount = Math.max(1, Math.floor(Number(count) || 1));
        const actualCount = Math.min(requestedCount, maxPossibleTrades);
        
        if (actualCount <= 0) {
            log(bot, `Trade ${index} has been used to its maximum limit`);
            setActionEvidence(bot, { kind: 'trade', outcome: 'trade_exhausted', target, retryable: true });
            return false;
        }
        
        if (!hasResources(villager.slots, trade, actualCount)) {
            log(bot, `Don't have enough resources to execute trade ${index} ${actualCount} time(s)`);
            setActionEvidence(bot, { kind: 'trade', outcome: 'missing_resources', target, count: actualCount, retryable: true });
            return false;
        }
        
        log(bot, `Executing trade ${index} ${actualCount} time(s)...`);
        
        const outputName = trade.outputItem?.name;
        const outputBefore = outputName ? inventoryCount(bot, outputName) : 0;
        await bot.trade(villager, tradeIndex, actualCount);
        const expectedGain = Math.max(1, Number(trade.outputItem?.count) || 1) * actualCount;
        // Mineflayer can resolve trade() before the player inventory view is
        // synchronized. Closing the villager window flushes those slot updates.
        await closeContainerQuietly(villager);
        villager = null;
        if (outputName) {
            await waitForInventoryCount(bot, outputName, outputBefore + expectedGain, 1_000);
        }
        const outputAfter = outputName ? inventoryCount(bot, outputName) : 0;
        const gained = outputAfter - outputBefore;
        if (!outputName || gained < expectedGain) {
            setActionEvidence(bot, {
                kind: 'trade',
                outcome: 'trade_unverified',
                target,
                expectedGain,
                gained,
                retryable: true,
            });
            log(bot, `Trade call resolved, but received ${gained} of ${expectedGain} expected ${outputName || 'output items'}.`);
            return false;
        }
        setActionEvidence(bot, {
            kind: 'trade',
            outcome: 'completed',
            target: { ...target, output: outputName },
            count: actualCount,
            gained,
            retryable: false,
        });
        log(bot, `Successfully traded ${actualCount} time(s) and received ${gained} ${outputName}.`);
        return true;
    } catch (err) {
        log(bot, 'Failed to open villager trading interface');
        console.log('Villager interface error:', err.message);
        setActionEvidence(bot, {
            kind: 'trade',
            outcome: 'trade_blocked',
            target,
            error: String(err?.message || err).slice(0, 240),
            retryable: true,
        });
        return false;
    } finally {
        await closeContainerQuietly(villager);
    }
}

function hasResources(window, trade, count) {
    const first = enough(trade.inputItem1, count);
    const second = !trade.inputItem2 || enough(trade.inputItem2, count);
    return first && second;

    function enough(item, count) {
        let c = 0;
        window.forEach((element) => {
            if (element && element.type === item.type && element.metadata === item.metadata) {
                c += element.count;
            }
        });
        return c >= item.count * count;
    }
}

function stringifyTrades(bot, trades) {
    return trades.map((trade) => {
        let text = stringifyItem(bot, trade.inputItem1);
        if (trade.inputItem2) text += ` & ${stringifyItem(bot, trade.inputItem2)}`;
        if (trade.disabled) text += ' x '; else text += ' » ';
        text += stringifyItem(bot, trade.outputItem);
        return `(${trade.nbTradeUses}/${trade.maximumNbTradeUses}) ${text}`;
    });
}

function stringifyItem(bot, item) {
    if (!item) return 'nothing';
    let text = `${item.count} ${item.displayName}`;
    if (item.nbt && item.nbt.value) {
        const ench = item.nbt.value.ench;
        const StoredEnchantments = item.nbt.value.StoredEnchantments;
        const Potion = item.nbt.value.Potion;
        const display = item.nbt.value.display;

        if (Potion) text += ` of ${Potion.value.replace(/_/g, ' ').split(':')[1] || 'unknown type'}`;
        if (display) text += ` named ${display.value.Name.value}`;
        if (ench || StoredEnchantments) {
            text += ` enchanted with ${(ench || StoredEnchantments).value.value.map((e) => {
                const lvl = e.lvl.value;
                const id = e.id.value;
                return bot.registry.enchantments[id].displayName + ' ' + lvl;
            }).join(' ')}`;
        }
    }
    return text;
}

export async function escapeDrowning(bot, timeoutMs=8_000) {
    const startOxygen = Number(bot.oxygenLevel);
    const target = bot.entity?.position?.floored?.() || null;
    try {
        try { bot.pathfinder?.setGoal?.(null); } catch { /* best-effort immediate movement preemption */ }
        try { bot.clearControlStates(); } catch { /* best-effort control reset */ }
        bot.setControlState('jump', true);
        const surfaced = await waitForWorldCondition(bot, () => {
            const head = bot.blockAt(bot.entity.position.offset(0, 1, 0));
            const oxygen = Number(bot.oxygenLevel);
            return head
                && head.name !== 'water'
                && !bot.entity?.isInLava
                && (!Number.isFinite(oxygen) || oxygen >= DROWNING_RECOVERY_OXYGEN);
        }, Math.max(1_000, Math.min(12_000, Number(timeoutMs) || 8_000)), 100);
        if (!surfaced) {
            setActionEvidence(bot, {
                kind: 'survival',
                outcome: bot.interrupt_code ? 'interrupted' : 'drowning_escape_unconfirmed',
                target,
                oxygenBefore: Number.isFinite(startOxygen) ? startOxygen : null,
                oxygenAfter: Number.isFinite(Number(bot.oxygenLevel)) ? Number(bot.oxygenLevel) : null,
                retryable: !bot.interrupt_code,
            });
            return false;
        }
        setActionEvidence(bot, {
            kind: 'survival',
            outcome: 'surfaced',
            target,
            oxygenBefore: Number.isFinite(startOxygen) ? startOxygen : null,
            oxygenAfter: Number.isFinite(Number(bot.oxygenLevel)) ? Number(bot.oxygenLevel) : null,
            retryable: false,
        });
        log(bot, 'Reached breathable air.');
        return true;
    } finally {
        try { bot.setControlState('jump', false); } catch { /* best-effort control cleanup */ }
    }
}

export async function stabilizeFall(bot, timeoutMs=4_000) {
    const target = bot.entity?.position?.floored?.() || null;
    const startingY = bot.entity?.position?.y;
    try {
        try { bot.pathfinder?.stop?.(); } catch { /* best-effort movement preemption */ }
        try { bot.clearControlStates(); } catch { /* best-effort control reset */ }
        bot.setControlState('sneak', true);
        const landed = await waitForWorldCondition(
            bot,
            () => Boolean(bot.entity?.onGround || bot.entity?.isInWater),
            Math.max(500, Math.min(8_000, Number(timeoutMs) || 4_000)),
            50,
        );
        const support = bot.entity?.onGround
            ? bot.blockAt(bot.entity.position.floored().offset(0, -1, 0))
            : null;
        const safe = landed && (bot.entity?.isInWater || isSafeGameplaySupport(support));
        setActionEvidence(bot, {
            kind: 'survival',
            outcome: bot.interrupt_code ? 'interrupted' : safe ? 'fall_landed' : 'fall_unresolved',
            target,
            startingY,
            observedY: bot.entity?.position?.y,
            support: support?.name || (bot.entity?.isInWater ? 'water' : 'unloaded'),
            retryable: !safe && !bot.interrupt_code,
        });
        return safe;
    } finally {
        try { bot.setControlState('sneak', false); } catch { /* best-effort control cleanup */ }
    }
}

export async function escapeBurning(bot) {
    const hazardAtBot = () => {
        const feet = bot.blockAt(bot.entity.position);
        const head = bot.blockAt(bot.entity.position.offset(0, 1, 0));
        return Boolean(
            bot.entity?.isInLava
            || isHazardousGameplayBlock(feet)
            || isHazardousGameplayBlock(head),
        );
    };
    const target = bot.entity?.position?.floored?.() || null;
    let usedWater = false;
    const dimension = String(bot.game?.dimension || '').toLowerCase();
    if (
        !dimension.includes('nether')
        && bot.inventory.findInventoryItem('water_bucket')
        && target
    ) {
        usedWater = await placeBlock(bot, 'water', target.x, target.y, target.z, 'bottom', true, false);
        if (!hazardAtBot()) {
            setActionEvidence(bot, { kind: 'survival', outcome: 'fire_extinguished', target, usedWater: true, retryable: false });
            return true;
        }
    }
    const moved = await moveAway(bot, 5);
    const safe = moved && !hazardAtBot();
    setActionEvidence(bot, {
        kind: 'survival',
        outcome: safe ? 'escaped_fire' : bot.interrupt_code ? 'interrupted' : 'fire_escape_unconfirmed',
        target,
        usedWater,
        retryable: !safe && !bot.interrupt_code,
    });
    return safe;
}

export async function digDown(bot, distance = 10) {
    /**
     * Digs down a specified distance. Will stop if it reaches lava, water, or a fall of >=4 blocks below the bot.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {int} distance, distance to dig down.
     * @returns {Promise<boolean>} true if successfully dug all the way down.
     * @example
     * await skills.digDown(bot, 10);
     **/

    const requested = Math.floor(Number(distance));
    if (!Number.isFinite(requested) || requested < 1 || requested > 32) {
        setActionEvidence(bot, {
            kind: 'descent',
            outcome: 'invalid_distance',
            target: { distance },
            retryable: false,
        });
        log(bot, 'Safe downward digging requires a distance from 1 to 32 blocks.');
        return false;
    }

    let completed = 0;
    const finish = (success, outcome, extra={}) => {
        setActionEvidence(bot, {
            kind: 'descent',
            outcome,
            target: { distance: requested },
            completed,
            retryable: !success && !bot.interrupt_code,
            ...extra,
        });
        return success;
    };

    while (completed < requested) {
        if (bot.interrupt_code) return finish(false, 'interrupted', { retryable: false });
        const feet = bot.entity?.position?.floored?.();
        if (!feet) {
            log(bot, `Stopped after ${completed} blocks because position is unavailable.`);
            return finish(false, 'position_unavailable');
        }
        const targetPosition = feet.offset(0, -1, 0);
        const supportPosition = feet.offset(0, -2, 0);
        const targetBlock = bot.blockAt(targetPosition);
        const supportBlock = bot.blockAt(supportPosition);
        const overhead = bot.blockAt(feet.offset(0, 2, 0));
        if (!targetBlock || !supportBlock || !overhead) {
            log(bot, `Stopped after ${completed} blocks because the next descent cell is not loaded.`);
            return finish(false, 'target_unloaded', { position: targetPosition });
        }
        if (isProtectedGameplayBlock(targetBlock)) {
            log(bot, `Stopped before protected ${targetBlock.name}.`);
            return finish(false, 'protected_block', { position: targetPosition, observed: targetBlock.name, retryable: false });
        }
        if (isLiquidGameplayBlock(targetBlock) || isHazardousGameplayBlock(targetBlock)
            || isLiquidGameplayBlock(supportBlock) || isHazardousGameplayBlock(supportBlock)) {
            log(bot, `Stopped before unsafe ${targetBlock.name}/${supportBlock.name}.`);
            return finish(false, 'hazard_below', {
                position: targetPosition,
                observed: `${targetBlock.name}/${supportBlock.name}`,
                retryable: false,
            });
        }
        if (isFallingGameplayBlock(targetBlock) || isFallingGameplayBlock(overhead)) {
            log(bot, 'Stopped because a falling block could enter the shaft.');
            return finish(false, 'falling_block_risk', { position: targetPosition, retryable: false });
        }
        if (!isSafeGameplaySupport(supportBlock)) {
            log(bot, `Stopped before an unsupported drop below ${targetBlock.name}.`);
            return finish(false, 'unsupported_drop', { position: targetPosition, observed: supportBlock.name, retryable: false });
        }
        if (targetBlock.boundingBox === 'empty') {
            log(bot, 'Stopped before an existing shaft opening; safe landing was not authorized by a verified dig.');
            return finish(false, 'existing_drop', { position: targetPosition, observed: targetBlock.name, retryable: false });
        }
        const adjacentLiquid = [[1, 0], [-1, 0], [0, 1], [0, -1]]
            .map(([dx, dz]) => bot.blockAt(targetPosition.offset(dx, 0, dz)))
            .find(isLiquidGameplayBlock);
        if (adjacentLiquid) {
            log(bot, `Stopped because ${adjacentLiquid.name} borders the next shaft block.`);
            return finish(false, 'adjacent_liquid', { position: targetPosition, observed: adjacentLiquid.name, retryable: false });
        }

        const startingY = bot.entity.position.y;
        if (!await breakBlockAt(bot, targetPosition.x, targetPosition.y, targetPosition.z)) {
            return finish(false, bot.lastActionEvidence?.outcome || 'dig_blocked', { position: targetPosition });
        }
        const landed = await waitForWorldCondition(
            bot,
            () => bot.entity?.onGround && bot.entity.position.y <= startingY - 0.75,
            2_000,
        );
        if (!landed) {
            try { bot.clearControlStates(); } catch { /* best-effort descent cleanup */ }
            log(bot, `The block was broken, but the ${completed + 1} block descent was not verified.`);
            return finish(false, bot.interrupt_code ? 'interrupted' : 'descent_unverified', {
                position: targetPosition,
                retryable: !bot.interrupt_code,
            });
        }
        const landedSupport = bot.blockAt(bot.entity.position.floored().offset(0, -1, 0));
        if (!isSafeGameplaySupport(landedSupport)) {
            log(bot, 'Landed after digging, but safe support could not be verified.');
            return finish(false, 'landing_unsafe', { observed: landedSupport?.name || 'unloaded', retryable: false });
        }
        completed += 1;
    }
    log(bot, `Safely descended ${completed} blocks.`);
    return finish(true, 'descended', { observedY: bot.entity.position.y, retryable: false });
}

export async function goToSurface(bot) {
    /**
     * Navigate to the surface (highest non-air block at current x,z).
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the surface was reached, false otherwise.
     **/
    const pos = bot.entity.position;
    const columnX = Math.floor(pos.x);
    const columnZ = Math.floor(pos.z);
    const minY = Number.isFinite(Number(bot.game?.minY)) ? Number(bot.game.minY) : -64;
    const height = Number.isFinite(Number(bot.game?.height)) ? Number(bot.game.height) : 384;
    const maxY = minY + Math.max(1, height) - 1;
    const isClear = block => ['air', 'cave_air', 'void_air'].includes(block.name) || block.boundingBox === 'empty';
    let target = null;
    for (let y = maxY - 2; y >= minY; y -= 1) {
        const support = bot.blockAt(new Vec3(columnX, y, columnZ));
        const feet = bot.blockAt(new Vec3(columnX, y + 1, columnZ));
        const head = bot.blockAt(new Vec3(columnX, y + 2, columnZ));
        if (!support || !feet || !head) continue;
        if (support.boundingBox !== 'empty' && isClear(feet) && isClear(head)) {
            target = support.position.offset(0, 1, 0);
            break;
        }
    }
    if (!target) {
        setActionEvidence(bot, {
            kind: 'surface_navigation',
            outcome: 'surface_not_loaded',
            target: { x: columnX, z: columnZ, minY, maxY },
            retryable: true,
        });
        log(bot, 'No loaded, standable surface target is visible in the current column.');
        return false;
    }

    const routed = await goToPosition(bot, target.x, target.y, target.z, 1);
    if (!routed) {
        const routeOutcome = bot.lastActionEvidence?.outcome || 'unreachable';
        setActionEvidence(bot, {
            kind: 'surface_navigation',
            outcome: bot.interrupt_code ? 'interrupted' : 'surface_unreachable',
            target: { x: target.x, y: target.y, z: target.z },
            routeOutcome,
            retryable: !bot.interrupt_code,
        });
        log(bot, `The loaded surface at y=${target.y} is not reachable by a safe route.`);
        return false;
    }

    const observed = bot.entity.position;
    const horizontalDistance = Math.hypot(observed.x - target.x, observed.z - target.z);
    const support = bot.blockAt(observed.floored().offset(0, -1, 0));
    const arrived = horizontalDistance <= 2 && observed.y >= target.y - 1 && support?.boundingBox !== 'empty';
    if (!arrived) {
        setActionEvidence(bot, {
            kind: 'surface_navigation',
            outcome: 'surface_arrival_unverified',
            target: { x: target.x, y: target.y, z: target.z },
            observed: { x: observed.x, y: observed.y, z: observed.z },
            horizontalDistance,
            support: support?.name || null,
            retryable: true,
        });
        log(bot, `Pathfinding ended, but Minecraft did not confirm arrival at the surface target y=${target.y}.`);
        return false;
    }
    setActionEvidence(bot, {
        kind: 'surface_navigation',
        outcome: 'surface_reached',
        target: { x: target.x, y: target.y, z: target.z },
        observed: { x: observed.x, y: observed.y, z: observed.z },
        support: support?.name || null,
        retryable: false,
    });
    log(bot, `Reached the loaded surface at y=${target.y}.`);
    return true;
}

function compactStateFingerprint(value) {
    try {
        return JSON.stringify(value, (_key, entry) => (
            typeof entry === 'bigint' ? entry.toString() : entry
        )).slice(0, 2_000);
    } catch {
        return '';
    }
}

function interactionSnapshot(bot, toolName, { blockPosition = null, entityId = null } = {}) {
    const block = blockPosition ? bot.blockAt(blockPosition) : null;
    const entity = entityId == null ? null : bot.entities?.[entityId] || null;
    const equipped = equippedItemAt(bot, 'hand');
    const currentWindow = bot.currentWindow;
    return {
        block: block ? compactStateFingerprint({
            name: block.name,
            stateId: block.stateId,
            metadata: block.metadata,
            properties: block.getProperties?.() || block._properties || null,
        }) : blockPosition ? 'unloaded' : null,
        entity: entity ? compactStateFingerprint({
            valid: entity.isValid !== false,
            metadata: entity.metadata || null,
            equipment: (entity.equipment || []).map(item => item ? {
                name: item.name,
                count: item.count,
                durabilityUsed: item.durabilityUsed,
            } : null),
        }) : entityId == null ? null : 'missing',
        itemCount: toolName === 'hand' ? null : inventoryCount(bot, toolName),
        itemDurability: toolName === 'hand' || equipped?.name !== toolName
            ? null
            : Number(equipped.durabilityUsed) || 0,
        window: currentWindow ? `${currentWindow.id}:${currentWindow.type}:${currentWindow.title || ''}` : null,
    };
}

function interactionChanges(before, after) {
    return Object.keys(before).filter(key => (
        before[key] !== after[key]
        && after[key] !== 'unloaded'
        && after[key] !== 'missing'
    ));
}

async function waitForInteractionChange(bot, toolName, target, before) {
    const deadline = Date.now() + INTERACTION_CONFIRM_TIMEOUT_MS;
    let after = before;
    while (Date.now() <= deadline) {
        if (bot.interrupt_code) return { interrupted: true, after, changes: [] };
        after = interactionSnapshot(bot, toolName, target);
        const changes = interactionChanges(before, after);
        if (changes.length > 0) return { interrupted: false, after, changes };
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await interruptibleDelay(bot, Math.min(INTERACTION_CONFIRM_POLL_MS, remaining));
    }
    return { interrupted: false, after, changes: [] };
}

export async function useToolOn(bot, toolName, targetName) {
    /**
     * Equip a tool and use it on the nearest target.
     * @param {MinecraftBot} bot
     * @param {string} toolName - item name of the tool to equip, or "hand" for no tool.
     * @param {string} targetName - entity type, block type, or "nothing" for no target
     * @returns {Promise<boolean>} true if action succeeded
     */
    toolName = String(toolName || '').trim().toLowerCase();
    targetName = String(targetName || '').trim().toLowerCase();
    if (!toolName || !targetName) {
        setActionEvidence(bot, { kind: 'tool_use', outcome: 'invalid_target', retryable: false });
        log(bot, 'Cannot use a tool without both a tool and target.');
        return false;
    }
    if (toolName !== 'hand' && !bot.inventory.slots.find(slot => slot && slot.name === toolName) && bot.game.gameMode !== 'creative') {
        setActionEvidence(bot, { kind: 'tool_use', outcome: 'missing_tool', target: { name: targetName }, tool: toolName, retryable: true });
        log(bot, `You do not have any ${toolName} to use.`);
        return false;
    }

    if (targetName === 'nothing') {
        if (toolName === 'hand') {
            setActionEvidence(bot, {
                kind: 'tool_use',
                outcome: 'no_item_or_target',
                target: { name: targetName },
                tool: toolName,
                retryable: false,
            });
            log(bot, 'Empty-hand use requires a block or entity target.');
            return false;
        }
        return await useItem(bot, toolName, 0, 'main');
    } else if (world.isEntityType(targetName)) {
        const entity = world.getNearestEntityWhere(bot, e => e.name === targetName, 64);
        if (!entity) {
            setActionEvidence(bot, {
                kind: 'tool_use',
                outcome: 'target_not_found',
                target: { name: targetName },
                tool: toolName,
                retryable: true,
            });
            log(bot, `Could not find any ${targetName}.`);
            return false;
        }
        const reached = await goToPosition(bot, entity.position.x, entity.position.y, entity.position.z);
        if (!reached || bot.entity.position.distanceTo(entity.position) > 4.5) {
            setActionEvidence(bot, { kind: 'tool_use', outcome: 'unreachable', target: { name: targetName, id: entity.id }, tool: toolName, retryable: true });
            log(bot, `Cannot reach ${targetName} to use ${toolName}.`);
            return false;
        }
        const currentEntity = bot.entities?.[entity.id];
        if (!currentEntity || currentEntity.isValid === false) {
            setActionEvidence(bot, {
                kind: 'tool_use',
                outcome: 'lost_target',
                target: { name: targetName, id: entity.id },
                tool: toolName,
                retryable: true,
            });
            log(bot, `${targetName} is no longer available to interact with.`);
            return false;
        }
        if (!await equip(bot, toolName)) return false;
        const interactionTarget = { entityId: currentEntity.id };
        const before = interactionSnapshot(bot, toolName, interactionTarget);
        try {
            await bot.useOn(currentEntity);
        } catch (error) {
            setActionEvidence(bot, { kind: 'tool_use', outcome: 'use_blocked', target: { name: targetName, id: currentEntity.id }, tool: toolName, error: error.message, retryable: true });
            log(bot, `Could not use ${toolName} on ${targetName}: ${error.message}.`);
            return false;
        }
        const confirmation = await waitForInteractionChange(bot, toolName, interactionTarget, before);
        if (confirmation.interrupted) {
            setActionEvidence(bot, { kind: 'tool_use', outcome: 'interrupted', target: { name: targetName, id: currentEntity.id }, tool: toolName, retryable: false });
            log(bot, `Stopped while verifying use of ${toolName} on ${targetName}.`);
            return false;
        }
        const verified = confirmation.changes.length > 0;
        setActionEvidence(bot, {
            kind: 'tool_use',
            outcome: verified ? 'interaction_verified' : 'interaction_requested',
            ...(verified ? {} : { completion: 'requested' }),
            target: { name: targetName, id: currentEntity.id },
            tool: toolName,
            observedChanges: confirmation.changes,
            before,
            after: confirmation.after,
            retryable: !verified,
        });
        log(bot, verified
            ? `Minecraft confirmed ${toolName} changed ${targetName} state.`
            : `Requested use of ${toolName} on ${targetName}; no authoritative state change is visible yet.`);
    } else {
        let block = null;
        if (targetName === 'water' || targetName === 'lava') {
            // we want to get liquid source blocks, not flowing blocks
            // so search for blocks with metadata 0 (not flowing)
            let blocks = world.getNearestBlocksWhere(bot, block => block.name === targetName && block.metadata === 0, 64, 1);
            if (blocks.length === 0) {
                setActionEvidence(bot, {
                    kind: 'tool_use',
                    outcome: 'target_not_found',
                    target: { name: targetName, source: true },
                    tool: toolName,
                    retryable: true,
                });
                log(bot, `Could not find any source ${targetName}.`);
                return false;
            }
            block = blocks[0];
        }
        else {
            block = world.getNearestBlock(bot, targetName, 64);
        }
        if (!block) {
            setActionEvidence(bot, {
                kind: 'tool_use',
                outcome: 'target_not_found',
                target: { name: targetName },
                tool: toolName,
                retryable: true,
            });
            log(bot, `Could not find any ${targetName}.`);
            return false;
        }
        return await useToolOnBlock(bot, toolName, block);
    }

    return true;
 }

export async function useItem(bot, itemName, durationMs = 0, requestedHand = 'main') {
    const normalizedItem = String(itemName || '').trim();
    const duration = Math.floor(Number(durationMs));
    const hand = String(requestedHand || '').trim().toLowerCase().replace(/_/g, '-');
    const destination = hand === 'main' || hand === 'main-hand' || hand === 'hand'
        ? 'hand'
        : hand === 'off' || hand === 'offhand' || hand === 'off-hand'
            ? 'off-hand'
            : null;
    const target = { name: normalizedItem || 'item', destination: destination || hand || null };
    if (!normalizedItem || normalizedItem === 'hand') {
        setActionEvidence(bot, { kind: 'item_use', outcome: 'invalid_item', target, retryable: false });
        log(bot, 'A carried item is required for a use cycle.');
        return false;
    }
    if (!destination) {
        setActionEvidence(bot, { kind: 'item_use', outcome: 'invalid_destination', target, retryable: false });
        log(bot, 'Item use hand must be main or off.');
        return false;
    }
    if (!Number.isFinite(duration) || duration < 0 || duration > 5_000) {
        setActionEvidence(bot, { kind: 'item_use', outcome: 'invalid_duration', target, retryable: false });
        log(bot, 'Item use duration must be between 0 and 5000 milliseconds.');
        return false;
    }
    if (!await equip(bot, normalizedItem, destination)) return false;

    const beforeCount = inventoryCount(bot, normalizedItem);
    const beforeItem = equippedItemAt(bot, destination);
    const beforeDurability = Number(beforeItem?.durabilityUsed) || 0;
    let activated = false;
    let released = duration === 0;
    try {
        bot.activateItem(destination === 'off-hand');
        activated = true;
        const deadline = Date.now() + duration;
        while (Date.now() < deadline) {
            if (bot.interrupt_code) {
                setActionEvidence(bot, {
                    kind: 'item_use',
                    outcome: 'interrupted',
                    target,
                    durationMs: Math.max(0, duration - Math.max(0, deadline - Date.now())),
                    retryable: false,
                });
                log(bot, `Stopped using ${normalizedItem}.`);
                return false;
            }
            await new Promise(resolve => setTimeout(resolve, Math.min(50, deadline - Date.now())));
        }
        if (duration > 0) {
            bot.deactivateItem();
            released = true;
        }
    } catch (error) {
        setActionEvidence(bot, {
            kind: 'item_use',
            outcome: 'use_blocked',
            target,
            error: String(error?.message || error).slice(0, 240),
            retryable: true,
        });
        log(bot, `Could not use ${normalizedItem}: ${error?.message || error}.`);
        return false;
    } finally {
        if (activated && duration > 0 && !released) {
            try {
                bot.deactivateItem();
            } catch (error) {
                console.warn(`[item-use] Failed to release ${normalizedItem}: ${String(error?.message || error).slice(0, 240)}`);
            }
        }
    }

    const afterCount = inventoryCount(bot, normalizedItem);
    const afterItem = equippedItemAt(bot, destination);
    const afterDurability = Number(afterItem?.durabilityUsed) || 0;
    setActionEvidence(bot, {
        kind: 'item_use',
        outcome: 'use_cycle_completed',
        target,
        requestedDurationMs: duration,
        activated,
        released,
        inventoryDelta: afterCount - beforeCount,
        durabilityDelta: afterDurability - beforeDurability,
        retryable: false,
    });
    const durationText = duration > 0 ? ` for ${duration} ms and released it` : '';
    log(bot, `Activated ${normalizedItem} in the ${destination}${durationText}.`);
    return true;
}

 export async function useToolOnBlock(bot, toolName, block) {
    /**
     * Use a tool on a specific block.
     * @param {MinecraftBot} bot
     * @param {string} toolName - item name of the tool to equip, or "hand" for no tool.
     * @param {Block} block - the block reference to use the tool on.
     * @returns {Promise<boolean>} true if action succeeded
     */

    if (!block?.position) {
        setActionEvidence(bot, { kind: 'tool_use', outcome: 'missing_target', tool: toolName, retryable: false });
        log(bot, `Cannot use ${toolName}: target block is no longer available.`);
        return false;
    }
    const target = { name: block.name, x: block.position.x, y: block.position.y, z: block.position.z };
    const distance = toolName === 'water_bucket' && block.name !== 'lava' ? 1.5 : 2;
    const reached = await goToPosition(bot, block.position.x, block.position.y, block.position.z, distance);
    if (!reached) {
        setActionEvidence(bot, { kind: 'tool_use', outcome: 'unreachable', target, tool: toolName, retryable: true });
        log(bot, `Cannot reach ${block.name} to use ${toolName}.`);
        return false;
    }
    const lookAtTarget = async () => {
        await bot.lookAt(block.position.offset(0.5, 0.5, 0.5));
        const cursor = bot.blockAtCursor(5);
        return {
            visible: Boolean(cursor?.position?.equals(block.position)),
            cursor,
        };
    };
    let sight;
    try {
        sight = await lookAtTarget();
    } catch (error) {
        setActionEvidence(bot, {
            kind: 'tool_use',
            outcome: 'look_blocked',
            target,
            tool: toolName,
            error: String(error?.message || error).slice(0, 240),
            retryable: true,
        });
        log(bot, `Could not face ${block.name}: ${error?.message || error}.`);
        return false;
    }
    if (!sight.visible) {
        const offsets = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
            [1, 1],
            [1, -1],
            [-1, 1],
            [-1, -1],
        ]
            .map(([x, z]) => block.position.offset(x, 0, z))
            .sort((left, right) => (
                left.distanceTo(bot.entity.position) - right.distanceTo(bot.entity.position)
            ))
            .slice(0, 2);
        let lastLookError = null;
        for (const candidate of offsets) {
            if (bot.interrupt_code) break;
            if (!await goToPosition(bot, candidate.x, candidate.y, candidate.z, 1)) continue;
            try {
                sight = await lookAtTarget();
            } catch (error) {
                lastLookError = String(error?.message || error).slice(0, 240);
                continue;
            }
            if (sight.visible) break;
        }
        if (!sight?.visible) {
            setActionEvidence(bot, {
                kind: 'tool_use',
                outcome: bot.interrupt_code ? 'interrupted' : 'line_of_sight_blocked',
                target,
                tool: toolName,
                obstruction: sight?.cursor?.name || null,
                ...(lastLookError ? { error: lastLookError } : {}),
                retryable: !bot.interrupt_code,
            });
            log(bot, bot.interrupt_code
                ? `Stopped before using ${toolName} on ${block.name}.`
                : `${block.name} is not visible from any bounded reachable interaction position.`);
            return false;
        }
    }

    const equipped = await equip(bot, toolName);

    if (!equipped) {
        log(bot, `Could not equip ${toolName}.`);
        return false;
    }
    const currentBlock = bot.blockAt(block.position);
    if (!currentBlock || currentBlock.name !== block.name) {
        setActionEvidence(bot, {
            kind: 'tool_use',
            outcome: currentBlock ? 'target_changed' : 'target_unloaded',
            target,
            tool: toolName,
            observed: currentBlock?.name || null,
            retryable: true,
        });
        log(bot, `${block.name} changed or unloaded before ${toolName} could be used.`);
        return false;
    }
    const interactionTarget = { blockPosition: currentBlock.position };
    const before = interactionSnapshot(bot, toolName, interactionTarget);
    try {
        if (toolName.includes('bucket')) {
            await bot.activateItem();
        }
        else {
            await bot.activateBlock(currentBlock);
        }
    } catch (error) {
        setActionEvidence(bot, { kind: 'tool_use', outcome: 'use_blocked', target, tool: toolName, error: error.message, retryable: true });
        log(bot, `Could not use ${toolName} on ${block.name}: ${error.message}.`);
        return false;
    }
    const confirmation = await waitForInteractionChange(bot, toolName, interactionTarget, before);
    if (confirmation.interrupted) {
        setActionEvidence(bot, { kind: 'tool_use', outcome: 'interrupted', target, tool: toolName, retryable: false });
        log(bot, `Stopped while verifying use of ${toolName} on ${block.name}.`);
        return false;
    }
    const verified = confirmation.changes.length > 0;
    setActionEvidence(bot, {
        kind: 'tool_use',
        outcome: verified ? 'interaction_verified' : 'interaction_requested',
        ...(verified ? {} : { completion: 'requested' }),
        target,
        tool: toolName,
        observedChanges: confirmation.changes,
        before,
        after: confirmation.after,
        retryable: !verified,
    });
    log(bot, verified
        ? `Minecraft confirmed ${toolName} changed ${block.name} state.`
        : `Requested use of ${toolName} on ${block.name}; no authoritative state change is visible yet.`);
    return true;
 }

const FISHING_ROD = 'fishing_rod';
const FISH_CAST_TIMEOUT_MS = 45_000;
const WORKSTATION_SEARCH_RANGE = 32;
const WINDOW_READY_TIMEOUT_MS = 8_000;
const FISH_LOOT_PATTERN = /(?:cod|salmon|pufferfish|tropical_fish|bowl|leather|stick|string|bone|ink_sac|lily_pad|rotten_flesh|saddle|name_tag|enchanted_book|_boots)$/;
const ANVIL_MATERIAL = Object.freeze({
    wooden: 'oak_planks',
    stone: 'cobblestone',
    copper: 'copper_ingot',
    golden: 'gold_ingot',
    iron: 'iron_ingot',
    diamond: 'diamond',
    netherite: 'netherite_ingot',
});

function experienceLevel(bot) {
    const level = Number(bot?.experience?.level);
    return Number.isFinite(level) ? level : 0;
}

/** Resolve a promise or give up, so a silent server can never wedge an action. */
function withDeadline(promise, timeoutMs, code) {
    let timer;
    return Promise.race([
        Promise.resolve(promise),
        new Promise((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error(code)), Math.max(250, timeoutMs));
        }),
    ]).finally(() => clearTimeout(timer));
}

/**
 * A long single await cannot see an interrupt, so Stop has nothing to act on
 * and a reflex that needs the body has to wait out the whole call. Racing the
 * work against an interrupt poll gives ownership back within one poll interval.
 * The abandoned promise settles later against a bot that has already moved on.
 */
function withInterrupt(bot, promise, timeoutMs, code, pollMs = 200) {
    let poller;
    return Promise.race([
        Promise.resolve(promise),
        new Promise((_resolve, reject) => {
            poller = setInterval(() => {
                if (bot.interrupt_code) reject(new Error('interrupted'));
            }, Math.max(50, pollMs));
        }),
        new Promise((_resolve, reject) => {
            setTimeout(() => reject(new Error(code)), Math.max(250, timeoutMs));
        }),
    ]).finally(() => clearInterval(poller));
}

async function closeWindowQuietly(bot, window) {
    if (!window) return;
    try {
        await bot.closeWindow(window);
    } catch (error) {
        console.warn(`[workstation] Failed to close window: ${String(error?.message || error).slice(0, 240)}`);
    }
}

async function reachWorkstation(bot, blockName, navigate) {
    let block = null;
    try {
        block = bot.findBlock({
            matching: bot.registry?.blocksByName?.[blockName]?.id,
            maxDistance: WORKSTATION_SEARCH_RANGE,
        });
    } catch {
        block = null;
    }
    if (!block) return { block: null, code: `${blockName}_not_found` };
    if (bot.entity.position.distanceTo(block.position) > 3.5) {
        const reached = await navigate(bot, block.position.x, block.position.y, block.position.z, 2);
        if (!reached) return { block, code: `${blockName}_unreachable` };
    }
    if (bot.interrupt_code) return { block, code: 'interrupted' };
    return { block, code: null };
}

function totalInventoryCount(bot) {
    return bot.inventory.items().reduce((total, item) => total + Math.max(0, Number(item.count) || 0), 0);
}

export async function fishForItems(bot, count = 1, { castTimeoutMs = FISH_CAST_TIMEOUT_MS } = {}) {
    /**
     * Fish until the requested number of catches is verified.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} count, how many catches to verify.
     * @returns {Promise<boolean>} true if at least one catch was verified.
     * @example
     * await skills.fishForItems(bot, 3);
     **/
    const target = { name: FISHING_ROD };
    const wanted = Math.max(1, Math.min(64, Math.floor(Number(count) || 1)));
    if (!bot.inventory.items().some(item => item.name === FISHING_ROD)) {
        setActionEvidence(bot, { kind: 'fish', outcome: 'missing_rod', target, retryable: false });
        log(bot, 'I have no fishing rod.');
        return false;
    }
    if (!await equip(bot, FISHING_ROD)) {
        setActionEvidence(bot, { kind: 'fish', outcome: 'equip_blocked', target, retryable: true });
        return false;
    }

    let water = null;
    try {
        water = bot.findBlock({ matching: block => block?.name === 'water', maxDistance: 24 });
    } catch {
        water = null;
    }
    if (!water) {
        setActionEvidence(bot, { kind: 'fish', outcome: 'no_water', target, retryable: true });
        log(bot, 'There is no water in reach to fish in.');
        return false;
    }
    if (bot.entity.position.distanceTo(water.position) > 5) {
        if (!await goToPosition(bot, water.position.x, water.position.y + 1, water.position.z, 3)) {
            setActionEvidence(bot, {
                kind: 'fish',
                outcome: 'water_unreachable',
                target: { name: 'water', x: water.position.x, y: water.position.y, z: water.position.z },
                retryable: true,
            });
            log(bot, 'I could not reach the water.');
            return false;
        }
    }

    let caught = 0;
    const collected = [];
    for (let attempt = 0; attempt < wanted; attempt += 1) {
        if (bot.interrupt_code) break;
        const before = totalInventoryCount(bot);
        try {
            await bot.lookAt(water.position.offset(0.5, 1, 0.5), true);
            // A cast can sit for most a minute waiting for a bite, so it has to
            // stay interruptible or Stop and every reflex above it are blocked.
            await withInterrupt(bot, bot.fish(), castTimeoutMs, 'fish_timeout');
        } catch (error) {
            const message = String(error?.message || error);
            const interrupted = message === 'interrupted' || bot.interrupt_code;
            try { bot.activateItem(); } catch { /* reeling in is best effort */ }
            setActionEvidence(bot, {
                kind: 'fish',
                outcome: interrupted ? 'interrupted' : message === 'fish_timeout' ? 'cast_timeout' : 'cast_failed',
                target,
                caught,
                ...(interrupted || message === 'fish_timeout' ? {} : { error: message.slice(0, 240) }),
                retryable: !interrupted,
            });
            log(bot, interrupted
                ? `Stopped fishing after ${caught} catch${caught === 1 ? '' : 'es'}.`
                : message === 'fish_timeout'
                    ? `Nothing bit after ${caught} catch${caught === 1 ? '' : 'es'}.`
                    : `Fishing stopped: ${message}.`);
            return caught > 0;
        }
        if (totalInventoryCount(bot) > before) {
            caught += 1;
            const newest = bot.inventory.items()
                .find(item => FISH_LOOT_PATTERN.test(item.name) && !collected.includes(item.name));
            if (newest) collected.push(newest.name);
        }
    }

    const interrupted = Boolean(bot.interrupt_code);
    setActionEvidence(bot, {
        kind: 'fish',
        outcome: interrupted ? 'interrupted' : caught >= wanted ? 'catches_verified' : caught > 0 ? 'partial_catch' : 'no_catch',
        target,
        caught,
        requested: wanted,
        items: collected.slice(0, 8),
        retryable: !interrupted && caught < wanted,
    });
    log(bot, caught > 0
        ? `Caught ${caught} of ${wanted}${collected.length ? ` (${collected.join(', ')})` : ''}.`
        : 'I fished but caught nothing.');
    return caught > 0;
}

export async function enchantItem(bot, itemName, { navigate = goToPosition } = {}) {
    /**
     * Enchant a carried item at a nearby enchanting table.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item to enchant.
     * @returns {Promise<boolean>} true if Minecraft confirmed a new enchantment.
     * @example
     * await skills.enchantItem(bot, "diamond_pickaxe");
     **/
    const name = String(itemName || '').trim();
    const target = { name: name || 'item' };
    const item = bot.inventory.items().find(candidate => candidate.name === name);
    if (!item) {
        setActionEvidence(bot, { kind: 'enchant', outcome: 'missing_item', target, retryable: false });
        log(bot, `I am not carrying ${name || 'that item'}.`);
        return false;
    }
    if (itemEnchantments(bot, item).size > 0) {
        setActionEvidence(bot, { kind: 'enchant', outcome: 'already_enchanted', target, retryable: false });
        log(bot, `${name} is already enchanted.`);
        return false;
    }
    const lapis = bot.inventory.items().find(candidate => candidate.name === 'lapis_lazuli');
    if (!lapis) {
        setActionEvidence(bot, { kind: 'enchant', outcome: 'missing_lapis', target, retryable: true });
        log(bot, 'I need lapis lazuli to enchant.');
        return false;
    }
    if (experienceLevel(bot) < 1) {
        setActionEvidence(bot, { kind: 'enchant', outcome: 'insufficient_levels', target, level: experienceLevel(bot), retryable: true });
        log(bot, 'I have no experience levels to spend.');
        return false;
    }

    const { block, code } = await reachWorkstation(bot, 'enchanting_table', navigate);
    if (code) {
        setActionEvidence(bot, { kind: 'enchant', outcome: code, target, retryable: code !== 'interrupted' });
        log(bot, code === 'enchanting_table_not_found'
            ? 'There is no enchanting table nearby.'
            : code === 'interrupted' ? 'Stopped before enchanting.' : 'I could not reach the enchanting table.');
        return false;
    }

    let table = null;
    try {
        table = await withDeadline(bot.openEnchantmentTable(block), WINDOW_READY_TIMEOUT_MS, 'table_open_timeout');
        await table.putTargetItem(item);
        await table.putLapis(lapis);
        // The table only publishes real costs once the server answers, and its
        // own enchant() waits on 'ready' forever if that answer never comes.
        await withDeadline(
            new Promise(resolve => {
                if (table.enchantments.some(slot => Number(slot?.level) > 0)) resolve();
                else table.once('ready', resolve);
            }),
            WINDOW_READY_TIMEOUT_MS,
            'table_never_ready',
        );
        const affordable = table.enchantments
            .map((slot, choice) => ({ choice, cost: Number(slot?.level) || -1 }))
            .filter(slot => slot.cost > 0 && slot.cost <= experienceLevel(bot))
            .sort((left, right) => right.cost - left.cost)[0];
        if (!affordable) {
            await closeWindowQuietly(bot, table);
            setActionEvidence(bot, { kind: 'enchant', outcome: 'insufficient_levels', target, level: experienceLevel(bot), retryable: true });
            log(bot, `I do not have the levels for any offered enchantment on ${name}.`);
            return false;
        }
        await withDeadline(table.enchant(affordable.choice), WINDOW_READY_TIMEOUT_MS, 'enchant_timeout');
        await table.takeTargetItem();
        await closeWindowQuietly(bot, table);
    } catch (error) {
        await closeWindowQuietly(bot, table);
        setActionEvidence(bot, {
            kind: 'enchant',
            outcome: 'enchant_failed',
            target,
            error: String(error?.message || error).slice(0, 240),
            retryable: true,
        });
        log(bot, `Enchanting ${name} failed: ${error?.message || error}.`);
        return false;
    }

    const enchanted = bot.inventory.items().find(candidate => (
        candidate.name === name && itemEnchantments(bot, candidate).size > 0
    ));
    const applied = enchanted
        ? [...itemEnchantments(bot, enchanted).entries()].map(([enchantment, lvl]) => `${enchantment} ${lvl}`)
        : [];
    setActionEvidence(bot, {
        kind: 'enchant',
        outcome: enchanted ? 'enchant_verified' : 'enchant_unverified',
        ...(enchanted ? {} : { completion: 'requested' }),
        target,
        enchantments: applied,
        retryable: !enchanted,
    });
    log(bot, enchanted
        ? `Enchanted ${name} with ${applied.join(', ')}.`
        : `I used the table on ${name} but no enchantment is visible yet.`);
    return Boolean(enchanted);
}

export async function repairAtAnvil(bot, itemName, { navigate = goToPosition } = {}) {
    /**
     * Repair a damaged tool at a nearby anvil using a duplicate or its material.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the damaged item to repair.
     * @returns {Promise<boolean>} true if Minecraft confirmed restored durability.
     * @example
     * await skills.repairAtAnvil(bot, "iron_pickaxe");
     **/
    const name = String(itemName || '').trim();
    const target = { name: name || 'item' };
    const damaged = bot.inventory.items()
        .filter(candidate => candidate.name === name)
        .sort((left, right) => toolDurability(bot, left).remaining - toolDurability(bot, right).remaining)[0];
    if (!damaged) {
        setActionEvidence(bot, { kind: 'repair', outcome: 'missing_item', target, retryable: false });
        log(bot, `I am not carrying ${name || 'that item'}.`);
        return false;
    }
    const before = toolDurability(bot, damaged);
    if (!Number.isFinite(before.max) || before.remaining >= before.max) {
        setActionEvidence(bot, { kind: 'repair', outcome: 'not_damaged', target, retryable: false });
        log(bot, `${name} does not need repair.`);
        return false;
    }
    const duplicate = bot.inventory.items().find(candidate => (
        candidate.name === name && candidate.slot !== damaged.slot
    ));
    const materialName = ANVIL_MATERIAL[name.split('_')[0]];
    const material = duplicate || (materialName
        ? bot.inventory.items().find(candidate => candidate.name === materialName)
        : null);
    if (!material) {
        setActionEvidence(bot, {
            kind: 'repair',
            outcome: 'missing_repair_material',
            target,
            required: materialName || 'a second copy',
            retryable: true,
        });
        log(bot, `I need ${materialName || `another ${name}`} to repair ${name}.`);
        return false;
    }
    if (experienceLevel(bot) < 1) {
        setActionEvidence(bot, { kind: 'repair', outcome: 'insufficient_levels', target, level: experienceLevel(bot), retryable: true });
        log(bot, 'I have no experience levels to spend on repairs.');
        return false;
    }

    const { block, code } = await reachWorkstation(bot, 'anvil', navigate);
    if (code) {
        setActionEvidence(bot, { kind: 'repair', outcome: code, target, retryable: code !== 'interrupted' });
        log(bot, code === 'anvil_not_found'
            ? 'There is no anvil nearby.'
            : code === 'interrupted' ? 'Stopped before repairing.' : 'I could not reach the anvil.');
        return false;
    }

    let anvil = null;
    try {
        anvil = await withDeadline(bot.openAnvil(block), WINDOW_READY_TIMEOUT_MS, 'anvil_open_timeout');
        // combine() waits on an experience packet that a silent server may never
        // send, so the deadline is the only thing guaranteeing this returns.
        await withDeadline(anvil.combine(damaged, material), WINDOW_READY_TIMEOUT_MS * 2, 'anvil_combine_timeout');
        await closeWindowQuietly(bot, anvil);
    } catch (error) {
        await closeWindowQuietly(bot, anvil);
        setActionEvidence(bot, {
            kind: 'repair',
            outcome: 'repair_failed',
            target,
            error: String(error?.message || error).slice(0, 240),
            retryable: true,
        });
        log(bot, `Repairing ${name} failed: ${error?.message || error}.`);
        return false;
    }

    const best = bot.inventory.items()
        .filter(candidate => candidate.name === name)
        .map(candidate => toolDurability(bot, candidate).remaining)
        .sort((left, right) => right - left)[0] ?? 0;
    const improved = best > before.remaining;
    setActionEvidence(bot, {
        kind: 'repair',
        outcome: improved ? 'repair_verified' : 'repair_unverified',
        ...(improved ? {} : { completion: 'requested' }),
        target,
        durabilityBefore: before.remaining,
        durabilityAfter: best,
        retryable: !improved,
    });
    log(bot, improved
        ? `Repaired ${name}: ${before.remaining} to ${best} durability.`
        : `I used the anvil on ${name} but no durability change is visible yet.`);
    return improved;
}
