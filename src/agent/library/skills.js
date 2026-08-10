import * as mc from "../../utils/mcdata.js";
import * as world from "./world.js";
import { cookingOutputForFood, isCookableFood } from '../../utils/food-semantics.js';
import {
    entityHarvestOutput,
    entityHarvestSources,
    entityMatchesHarvestSource,
} from '../../utils/entity-harvest-semantics.js';
import pf from '../../../packages/minecraft-runtime/mineflayer-pathfinder/index.js';
import Vec3 from 'vec3';
import settings from "../../../settings.js";
import { currentActionExecutionContext } from '../action_manager.js';
import { blockMatchesPlacement } from '../runtime/block-placement-contract.js';
import {
    assessAnchoredGameplaySupport,
    isAnchoredGameplaySupport,
    isFallingGameplayBlock,
    isHazardousGameplayBlock,
    isLiquidGameplayBlock,
    isProtectedGameplayBlock,
    isReplaceableGameplayBlock,
    isSafeCaveStance,
    isSafeGameplaySupport,
} from '../runtime/gameplay-safety.js';
import { collectorMatchesPlayerTarget, resolvePlayerTarget } from '../player-target.js';
import { companionContextFor, normalizePlayerDistance } from '../runtime/companion-context.js';
import {
    bindRejectedCollectionTarget,
    rankCollectionCandidates,
} from '../runtime/collection-candidate-selector.js';
import { chooseTacticalCombatDecision } from '../runtime/combat-decision.js';
import { observeCombatDamage } from '../runtime/combat-attribution.js';
import { chooseExplorationRoute } from '../runtime/exploration-route.js';
import { selectFarmSites, selectRememberedFarmStances } from '../runtime/farm-site-selector.js';
import { interruptibleDelay } from '../runtime/interruptible-delay.js';
import {
    bindCarriedPlankRecipe,
    carriedPlankCount,
    createPlankFamilyRecipe,
    isPlankFamilyRecipe,
} from '../../utils/recipe-families.js';
import {
    familyInventoryCount,
    familyInventoryEntries,
    familyTransferManifest,
    itemMatchesFamily,
    SUPPORTED_ITEM_FAMILIES,
    UNSAFE_FOOD_ITEMS,
} from '../runtime/item-family.js';
import {
    minimumMiningCorridorSteps,
    searchSupportedMiningVoxelCorridors,
    selectBoundedMiningProgressStances,
} from '../runtime/mining-corridor-planner.js';
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
const FOLLOW_DESTINATION_SETTLE_MS = 1_500;
const FOLLOW_DESTINATION_POSITION_EPSILON = 0.75;
const MAX_AVOID_RETREAT_ATTEMPTS = 3;
const MIN_MOVEMENT_PROGRESS = 0.1;
const MAX_DEFENSE_SWINGS = 14;
const MAX_DEFENSE_FAILURES = 2;
const DEFENSE_SWING_INTERVAL_MS = 550;
const MAX_PVP_ENGAGEMENT_MS = 30_000;
const MAX_BOT_OUTPUT_CHARS = 2_048;
const MOVE_AWAY_HISTORY_TTL_MS = 10 * 60_000;
const MOVE_AWAY_HISTORY_LIMIT = 4;
const MEANINGFUL_RELOCATION_VERTICAL_DROP = 8;
const MEANINGFUL_RELOCATION_SCAN_RADIUS = 64;
const MEANINGFUL_RELOCATION_MAX_CANDIDATES = 32;
const MEANINGFUL_RELOCATION_PROBE_MS = 2_500;
const MAX_MELEE_REACH = 3.2;
const ATTACK_CONFIRM_TIMEOUT_MS = 900;
const ATTACK_INTERRUPT_POLL_MS = 50;
const MAX_TACTICAL_COMBAT_STEPS = 24;
const TACTICAL_COMBAT_RANGE = 16;
const TACTICAL_BOW_CHARGE_MS = 900;
const TACTICAL_SHOT_CONFIRM_MS = 1_500;
const TABLE_DROP_SEARCH_RADIUS = 4;
const TABLE_DROP_APPEAR_TIMEOUT_MS = 1_500;
const TABLE_PICKUP_TIMEOUT_MS = 1_500;
const INVENTORY_POLL_MS = 100;
const COLLECTION_DROP_TIMEOUT_MS = 4_000;
const COLLECTION_OPERATION_TIMEOUT_MS = 15_000;
const COLLECTION_SETTLEMENT_TIMEOUT_MS = 2_000;
const PICKUP_NAVIGATION_STALL_TIMEOUT_MS = 4_000;
const PICKUP_TARGET_TIMEOUT_MS = 6_000;
const PICKUP_TARGET_STALL_TIMEOUT_MS = 2_500;
const MAX_PICKUP_QUEUE_TARGETS = 16;
const MAX_PICKUP_TARGET_FAILURES = 1;
const MAX_FARM_WATER_CANDIDATES = 256;
const MAX_FARM_ROUTE_CANDIDATES = 4;
const FARM_ROUTE_PROBE_TIMEOUT_MS = 1_500;
const DOOR_SEARCH_RADIUS = 16;
const DOOR_INTERACTION_REACH = 4.5;
const DOOR_STATE_SETTLE_MS = 150;
const DOOR_TRAVERSE_TIMEOUT_MS = 1_200;
const DOOR_TRAVERSE_POLL_MS = 50;
const MIN_DOOR_TRAVERSE_PROGRESS = 0.75;
const INTERACTION_CONFIRM_TIMEOUT_MS = 750;
const INTERACTION_CONFIRM_POLL_MS = 50;
const NAVIGATION_PROGRESS_POLL_MS = 500;
const NAVIGATION_STALL_TIMEOUT_MS = 3_700;
const NAVIGATION_RECOVERY_STALL_TIMEOUT_MS = 1_500;
const NAVIGATION_PROGRESS_DISTANCE = 0.75;
const NAVIGATION_GOAL_PROGRESS_DELTA = 0.25;
const NAVIGATION_FAILURE_SETTLE_TIMEOUT_MS = 4_000;
const NAVIGATION_RECOVERY_DISTANCE = 1;
const NAVIGATION_RECOVERY_RADIUS = 4;
const MAX_NAVIGATION_RECOVERY_ATTEMPTS = 1;
const GROUND_SETTLE_TIMEOUT_MS = 800;
const SHALLOW_WATER_EXIT_TIMEOUT_MS = 2_500;
const SHALLOW_WATER_SHORE_SCAN_RADIUS = 32;
const DROWNING_RECOVERY_OXYGEN = 20;
const DROWNING_FINAL_ASCENT_RESERVE_MS = 2_000;
const DELIVERY_MIN_DROP_DISTANCE = 1.6;
const DELIVERY_MAX_DROP_DISTANCE = 3.25;
const DELIVERY_MAX_DROP_AXIS_OFFSET = 0.65;
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
const ENTITY_ROUTE_PENALTY = 10;
const MAX_COLLECTION_TARGET_FAILURES = 1;
const COLLECTION_FAILED_TARGET_EXCLUSION_RADIUS = 4;
const MAX_COLLECTION_ACCESS_RECOVERIES = 2;
const COLLECTION_ACCESS_PROGRESS_DISTANCE = 1;
const MINING_COLLECTION_SLOT_RESERVE = 3;
// Every caller already caps its requested reserve at 12 slots. The release
// loop must be able to satisfy that same bounded contract when each discarded
// stack frees only one slot; a lower action ceiling makes valid requests
// impossible from a full inventory.
const MAX_COLLECTION_SLOT_RELEASE_ACTIONS = 12;
const MIN_COLLECTION_NATURAL_FILL_RESERVE = 16;
const MINING_TUNNEL_LENGTH = 12;
const MAX_MINING_ROUTE_HEADINGS = 3;
const MINING_ROUTE_STEP_TIMEOUT_MS = 2_000;
const MINING_ROUTE_STEP_ESTIMATE_MS = 450;
const MINING_ROUTE_DEADLINE_RESERVE_MS = 3_500;
const MAX_MINING_EXCAVATION_BLOCKS = 96;
const MAX_MINING_SURFACE_EXCAVATION_BLOCKS = 6;
const MAX_MINING_SURFACE_EXCAVATION_STEPS = 3;
const MAX_MINING_SURFACE_STAGE_DISTANCE = 10;
const MAX_MINING_CORRIDOR_EXPANSIONS = 6_000;
const MAX_MINING_CORRIDOR_SOLUTIONS = 12;
const MAX_MINING_CORRIDOR_DETOUR = 8;
const MAX_MINING_PROGRESS_ROUTE_STEPS = 12;
const MAX_MINING_PROGRESS_VERTICAL = 6;
const MIN_MINING_PROGRESS_STEPS = 2;
const MAX_MINING_PROGRESS_STANCES = 12;
const MAX_MINING_FALLING_COLUMN = 3;
const FALLING_BLOCK_SETTLE_MS = 250;
const MIN_SURFACE_ROUTE_PROGRESS = 2;
const MAX_SURFACE_ROUTE_LEGS = 8;
const MAX_SURFACE_CORRIDOR_RISE = 4;
const SURFACE_CORRIDOR_ROUTE_SLACK = 12;
const MAX_SURFACE_CORRIDOR_STANCES = 4;
const SURFACE_STANCE_SCAN_RADIUS = 24;
const SURFACE_EGRESS_MIN_DISTANCE = 6;
const SURFACE_EGRESS_SCAN_RADIUS = 10;
const SURFACE_EGRESS_PROBE_MS = 500;
const MAX_LOCAL_WORKSTATION_CANDIDATES = 4;
const MIN_NATURAL_WORKSTATION_ALCOVE_DEPTH = 8;
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
    'no_safe_stance',
    'stance_unverified',
    'not_broken',
    'target_unloaded',
    'collect_blocked',
    'not_collected',
]);

function followTargetRequiresDrySettlement(bot, entity) {
    const position = entity?.position?.floored?.();
    if (!position || typeof bot?.blockAt !== 'function') return false;
    const feet = bot.blockAt(position);
    const support = bot.blockAt(position.offset(0, -1, 0));
    return Boolean(
        feet
        && !isLiquidGameplayBlock(feet)
        && isTraversableShoreSupport(support)
    );
}

export function isCompatibleFollowSettlementStance(bot, entity, node) {
    if (!followTargetRequiresDrySettlement(bot, entity)) return true;
    if (!node || typeof bot?.blockAt !== 'function') return false;
    const position = new Vec3(
        Math.floor(node.x),
        Math.floor(node.y),
        Math.floor(node.z),
    );
    const feet = bot.blockAt(position);
    const support = bot.blockAt(position.offset(0, -1, 0));
    return Boolean(
        feet
        && !isLiquidGameplayBlock(feet)
        && isTraversableShoreSupport(support)
    );
}

export class ResponsiveFollowGoal extends pf.goals.GoalFollow {
    constructor(bot, entity, range) {
        super(entity, range);
        this.bot = bot;
        this.replanDistanceSq = FOLLOW_REPLAN_DISTANCE * FOLLOW_REPLAN_DISTANCE;
        this.requiresDrySettlement = followTargetRequiresDrySettlement(bot, entity);
    }

    isEnd(node) {
        return super.isEnd(node)
            && isCompatibleFollowSettlementStance(this.bot, this.entity, node);
    }

    hasChanged() {
        const position = this.entity?.position?.floored?.();
        if (!position) return false;
        const requiresDrySettlement = followTargetRequiresDrySettlement(this.bot, this.entity);
        const dx = this.x - position.x;
        const dy = this.y - position.y;
        const dz = this.z - position.z;
        if (
            (dx * dx + dy * dy + dz * dz) <= this.replanDistanceSq
            && requiresDrySettlement === this.requiresDrySettlement
        ) return false;
        this.x = position.x;
        this.y = position.y;
        this.z = position.z;
        this.requiresDrySettlement = requiresDrySettlement;
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
const CONTAINER_OPEN_TIMEOUT_MS = 20_000;
const ASSIGNED_CONTAINER_LOAD_RADIUS = 16;
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
const HUNTABLE_FOOD_ANIMALS = new Set(['chicken', 'cow', 'pig', 'rabbit', 'sheep']);

function setActionEvidence(bot, evidence) {
    const previous = bot.lastActionEvidence;
    const preservesVerifiedMiningRoute = Boolean(
        previous?.routeDigging === true
        && previous?.returnable === true
        && Array.isArray(previous?.returnRoute)
        && previous.returnRoute.length > 0
        && evidence?.returnable !== false
    );
    bot.lastActionEvidence = {
        ...(preservesVerifiedMiningRoute ? {
            routeDigging: true,
            returnable: true,
            returnRoute: previous.returnRoute,
        } : {}),
        ...evidence,
        ...(evidence?.kind === 'collect' ? {
            toolState: collectionToolStateEvidence(bot, evidence.target),
            inventoryState: collectionInventoryStateEvidence(bot),
        } : {}),
        recordedAt: Date.now(),
    };
}

function collectionErrorOutcome(error) {
    const name = String(error?.name || '').toLowerCase();
    const message = String(error?.message || error || '').toLowerCase();
    if (name.includes('stalled') || message.includes('stalled')) return 'path_stalled';
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

function carriedWindowInventoryCount(window, itemName) {
    if (
        !window
        || !Number.isInteger(window.inventoryStart)
        || !Number.isInteger(window.inventoryEnd)
    ) return 0;
    let count = 0;
    for (let slot = window.inventoryStart; slot < window.inventoryEnd; slot += 1) {
        const item = window.slots?.[slot];
        if (item?.name === itemName) count += Math.max(0, Number(item.count) || 0);
    }
    return count;
}

export function selectSmeltingFuelPlan(items, requiredSmelts) {
    const required = Math.max(0, Number(requiredSmelts) || 0);
    let remaining = required;
    const entries = [];
    const candidates = (Array.isArray(items) ? items : [])
        .map(item => ({
            item,
            output: mc.getFuelSmeltOutput(item?.name || ''),
            count: Math.max(0, Math.floor(Number(item?.count) || 0)),
        }))
        .filter(candidate => (
            candidate.item
            && Number.isInteger(candidate.item.type)
            && candidate.output > 0
            && candidate.count > 0
        ))
        .sort((left, right) => (
            right.output - left.output
            || left.item.name.localeCompare(right.item.name)
            || (left.item.slot || 0) - (right.item.slot || 0)
        ));
    for (const candidate of candidates) {
        if (remaining <= 0) break;
        const count = Math.min(
            candidate.count,
            Math.max(1, Math.ceil(remaining / candidate.output)),
        );
        entries.push({
            name: candidate.item.name,
            type: candidate.item.type,
            count,
            outputPerItem: candidate.output,
        });
        remaining -= count * candidate.output;
    }
    return {
        ok: remaining <= 0,
        requiredSmelts: required,
        availableSmelts: Math.max(0, required - Math.max(0, remaining)),
        entries,
    };
}

function safeFoodPoints(bot) {
    const foods = bot.registry?.foodsByName || {};
    return bot.inventory.items().reduce((total, item) => {
        const food = foods[item.name];
        if (
            !food
            || UNSAFE_FOOD_ITEMS.has(item.name)
            || isCookableFood(bot.registry, item.name)
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
    const spec = mc.matureCropHarvestForBlock(block?.name);
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

function buriedNaturalWorkstationAlcoveCandidates(bot) {
    const origin = bot.entity?.position?.floored?.();
    if (!origin || !observedSupportedStandingCell(bot)) return [];
    const minY = Number.isFinite(Number(bot.game?.minY)) ? Number(bot.game.minY) : -64;
    const height = Number.isFinite(Number(bot.game?.height)) ? Number(bot.game.height) : 384;
    const maxY = minY + Math.max(1, height) - 1;
    const surface = nearestLoadedSurfaceStandingCell(
        bot,
        origin,
        minY,
        maxY,
        4,
    ).target;
    const burialDepth = surface ? surface.y - origin.y : 0;
    if (burialDepth < MIN_NATURAL_WORKSTATION_ALCOVE_DEPTH) return [];

    return [
        origin.offset(1, 0, 0),
        origin.offset(-1, 0, 0),
        origin.offset(0, 0, 1),
        origin.offset(0, 0, -1),
    ].filter(position => {
        const wall = bot.blockAt(position);
        const support = bot.blockAt(position.offset(0, -1, 0));
        return Boolean(
            wall
            && isNaturalFillBlock(bot, wall)
            && support
            && isAnchoredGameplaySupport(bot, support)
            && !isProtectedGameplayBlock(support)
        );
    }).map(position => ({ position, burialDepth }));
}

async function prepareBuriedNaturalWorkstationAlcove(bot, itemName, inventoryBeforePlacement) {
    const candidate = buriedNaturalWorkstationAlcoveCandidates(bot)[0];
    if (!candidate) return { ok: false, outcome: 'no_authorized_workstation_alcove' };

    // One exact natural wall block is the complete destruction budget. If its
    // removal does not immediately create a usable adjacent workstation cell,
    // stop instead of chewing a larger room into the terrain.
    const opened = await breakBlockAt(
        bot,
        candidate.position.x,
        candidate.position.y,
        candidate.position.z,
    );
    const observed = bot.blockAt(candidate.position);
    if (!opened || !observed || !isReplaceableGameplayBlock(observed)) {
        return {
            ok: false,
            outcome: bot.lastActionEvidence?.outcome || 'workstation_alcove_not_opened',
            position: candidate.position,
            burialDepth: candidate.burialDepth,
        };
    }

    const placed = await placeBlock(
        bot,
        itemName,
        candidate.position.x,
        candidate.position.y,
        candidate.position.z,
    );
    const block = bot.blockAt(candidate.position);
    if (!placed || block?.name !== itemName) {
        return {
            ok: false,
            outcome: bot.lastActionEvidence?.outcome || 'workstation_alcove_placement_failed',
            position: candidate.position,
            burialDepth: candidate.burialDepth,
            excavated: 1,
        };
    }
    return {
        ok: true,
        outcome: 'workstation_alcove_placed',
        itemName,
        block,
        position: candidate.position,
        inventoryBeforePlacement,
        burialDepth: candidate.burialDepth,
        excavated: 1,
    };
}

async function placeLocalWorkstation(bot, itemName, range = 8) {
    const inventoryBeforePlacement = inventoryCount(bot, itemName);
    if (inventoryBeforePlacement < 1) {
        return { ok: false, outcome: `missing_${itemName}`, failures: [] };
    }
    const candidates = world.getNearestFreeSpaces(bot, 1, range, {
        limit: MAX_LOCAL_WORKSTATION_CANDIDATES,
    });
    if (candidates.length === 0) {
        return { ok: false, outcome: 'no_workstation_space', failures: [] };
    }
    const failures = [];
    for (const candidate of candidates) {
        if (bot.interrupt_code) {
            return { ok: false, outcome: 'interrupted', failures };
        }
        const position = new Vec3(
            Math.floor(candidate.x),
            Math.floor(candidate.y),
            Math.floor(candidate.z),
        );
        const placed = await placeBlock(bot, itemName, position.x, position.y, position.z);
        const block = bot.blockAt(position);
        if (placed && block?.name === itemName) {
            return {
                ok: true,
                outcome: 'workstation_placed',
                itemName,
                block,
                position,
                inventoryBeforePlacement,
                failures,
            };
        }
        failures.push({
            position: { x: position.x, y: position.y, z: position.z },
            outcome: bot.lastActionEvidence?.outcome || (placed ? 'not_confirmed' : 'not_placed'),
            error: bot.lastActionEvidence?.error || null,
        });
    }
    const alcove = await prepareBuriedNaturalWorkstationAlcove(
        bot,
        itemName,
        inventoryBeforePlacement,
    );
    if (alcove.ok) return { ...alcove, failures };
    failures.push({
        position: alcove.position || null,
        outcome: alcove.outcome,
        burialDepth: alcove.burialDepth || null,
        excavated: alcove.excavated || 0,
    });
    return { ok: false, outcome: 'workstation_not_placed', failures };
}

async function placeLocalCraftingTable(bot) {
    const placement = await placeLocalWorkstation(bot, 'crafting_table', 6);
    if (placement.ok) return placement;
    const outcomes = {
        missing_crafting_table: 'missing_crafting_table',
        no_workstation_space: 'no_table_space',
        interrupted: 'interrupted',
    };
    return {
        ...placement,
        outcome: outcomes[placement.outcome] || 'table_not_placed',
    };
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

async function bindExistingWorkstation(bot, itemName, range = 64, navigate = null, exactTarget = null) {
    if (exactTarget?.position) {
        const expectedDimension = normalizedDimension(exactTarget.dimension);
        const observedDimension = normalizedDimension(bot.game?.dimension);
        const position = new Vec3(
            Math.floor(Number(exactTarget.position.x)),
            Math.floor(Number(exactTarget.position.y)),
            Math.floor(Number(exactTarget.position.z)),
        );
        if (!expectedDimension || expectedDimension !== observedDimension) {
            return {
                block: null,
                outcome: 'wrong_dimension',
                position,
                expectedDimension,
                observedDimension,
                exact: true,
            };
        }

        let observed = bot.blockAt(position);
        if (observed && observed.name !== itemName) {
            return {
                block: null,
                outcome: 'target_changed',
                position,
                observed: observed.name,
                exact: true,
            };
        }
        if (observed?.name === itemName && directlyUsableWorkstation(bot, observed)) {
            return { block: observed, outcome: 'ready', position, exact: true };
        }

        const approached = typeof navigate === 'function'
            ? await navigate(bot, position.x, position.y, position.z, 2)
            : await goToGoal(bot, new pf.goals.GoalNear(position.x, position.y, position.z, 2));
        if (bot.interrupt_code) return { block: null, outcome: 'interrupted', position, exact: true };
        observed = bot.blockAt(position);
        if (observed?.name !== itemName) {
            return {
                block: null,
                outcome: 'target_changed',
                position,
                observed: observed?.name || 'unloaded',
                exact: true,
            };
        }
        if (!approached) {
            return { block: null, outcome: 'unreachable', position, exact: true };
        }
        const settled = directlyUsableWorkstation(bot, observed)
            || await goToGoal(bot, new pf.goals.GoalLookAtBlock(position, bot.world, { reach: 4 }));
        if (bot.interrupt_code) return { block: null, outcome: 'interrupted', position, exact: true };
        const verified = bot.blockAt(position);
        if (verified?.name !== itemName) {
            return {
                block: null,
                outcome: 'target_changed',
                position,
                observed: verified?.name || 'unloaded',
                exact: true,
            };
        }
        return settled
            ? { block: verified, outcome: 'ready', position, exact: true }
            : { block: null, outcome: 'unreachable', position, exact: true };
    }

    let block = null;
    try {
        block = world.getNearestBlock(bot, itemName, range);
    } catch {
        block = null;
    }
    if (!block?.position) return { block: null, outcome: 'not_found' };

    const position = block.position.clone();
    if (directlyUsableWorkstation(bot, block)) {
        return { block, outcome: 'ready', position };
    }

    const reached = typeof navigate === 'function'
        ? await navigate(bot, position.x, position.y, position.z, 2)
        : await goToGoal(
            bot,
            new pf.goals.GoalLookAtBlock(position, bot.world, { reach: 4 }),
        );
    if (bot.interrupt_code) return { block: null, outcome: 'interrupted', position };

    const observed = bot.blockAt(position);
    if (observed?.name !== itemName) {
        return {
            block: null,
            outcome: 'target_changed',
            position,
            observed: observed?.name || 'unloaded',
        };
    }
    // GoalLookAtBlock is the native interaction-stance contract used by the
    // route itself. Do not veto its verified endpoint with canSeeBlock(center):
    // a neighboring table or wall edge can occlude the block center while an
    // exposed face remains reachable. The real open/craft call below is the
    // final physical verification of that native stance.
    if (!reached) {
        return { block: null, outcome: 'unreachable', position };
    }
    return { block: observed, outcome: 'ready', position };
}

async function recoverLocalWorkstation(bot, temporaryWorkstation) {
    const {
        position,
        inventoryBeforePlacement,
        itemName = 'crafting_table',
    } = temporaryWorkstation;
    const target = { name: itemName, x: position.x, y: position.y, z: position.z };
    if (inventoryCount(bot, itemName) >= inventoryBeforePlacement) {
        return { outcome: 'already_recovered', target, retryable: false };
    }

    const placedWorkstation = bot.blockAt(position);
    if (placedWorkstation?.name === itemName) {
        const distance = bot.entity.position.distanceTo(placedWorkstation.position);
        if (distance > 4.5) {
            return { outcome: 'workstation_left_in_world', target, distance, retryable: true };
        }
        try {
            // The placement receipt is the authorization boundary. Generic
            // protection remains locked for every other block and coordinate.
            if (bot.interrupt_code || actionCancellationSignal()?.aborted) {
                return { outcome: 'recovery_interrupted', target, retryable: false };
            }
            await equipBestToolForBlock(bot, placedWorkstation);
            const cleanupTimeoutMs = Math.min(
                COLLECTION_OPERATION_TIMEOUT_MS,
                Math.max(5_000, collectionBreakTime(bot, placedWorkstation) + 1_000),
            );
            await runBoundedCollectionOperation(
                bot,
                () => bot.dig(placedWorkstation),
                () => bot.stopDigging?.(),
                cleanupTimeoutMs,
            );
        } catch (error) {
            return {
                outcome: 'workstation_cleanup_blocked',
                target,
                error: String(error?.message || error).slice(0, 240),
                retryable: true,
            };
        }
        if (bot.blockAt(position)?.name === itemName) {
            return { outcome: 'workstation_not_broken', target, retryable: true };
        }
    }

    if (await waitForInventoryCount(
        bot,
        itemName,
        inventoryBeforePlacement,
        INVENTORY_POLL_MS * 2,
    )) {
        return { outcome: 'recovered', target, retryable: false };
    }
    if (bot.interrupt_code) {
        return { outcome: 'recovery_interrupted', target, retryable: false };
    }

    const dropDeadline = Date.now() + TABLE_DROP_APPEAR_TIMEOUT_MS;
    let droppedWorkstation = null;
    while (!droppedWorkstation && Date.now() < dropDeadline && !bot.interrupt_code) {
        droppedWorkstation = findDroppedItemNear(bot, itemName, position);
        if (!droppedWorkstation) {
            await interruptibleDelay(bot, INVENTORY_POLL_MS);
        }
    }
    if (!droppedWorkstation) {
        return {
            outcome: bot.interrupt_code ? 'recovery_interrupted' : 'workstation_drop_unobserved',
            target,
            retryable: !bot.interrupt_code,
        };
    }

    const reached = await approachDroppedItem(bot, droppedWorkstation, TABLE_PICKUP_TIMEOUT_MS);
    if (!reached) {
        return {
            outcome: bot.interrupt_code ? 'recovery_interrupted' : 'workstation_drop_unreachable',
            target: { ...target, entityId: droppedWorkstation.id },
            retryable: !bot.interrupt_code,
        };
    }
    const recovered = await waitForInventoryCount(
        bot,
        itemName,
        inventoryBeforePlacement,
        TABLE_PICKUP_TIMEOUT_MS,
    );
    return {
        outcome: recovered
            ? 'recovered'
            : bot.interrupt_code
                ? 'recovery_interrupted'
                : 'workstation_drop_not_collected',
        target: { ...target, entityId: droppedWorkstation.id },
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

function droppedItemEntityIds(bot) {
    return new Set(Object.values(bot.entities || {})
        .filter(entity => entity?.name === 'item' && Number.isFinite(entity.id))
        .map(entity => entity.id));
}

async function waitForExpectedDropPickup(
    bot,
    itemTypes,
    beforeCount,
    {
        timeoutMs = COLLECTION_DROP_TIMEOUT_MS,
        targetPosition = null,
        priorEntityIds = null,
    } = {},
) {
    const deadline = Date.now() + remainingActionTimeMs(timeoutMs);
    const signal = actionCancellationSignal();
    const attemptedEntities = new Set();
    while (Date.now() < deadline && !bot.interrupt_code && !signal?.aborted) {
        if (inventoryCountByTypes(bot, itemTypes) > beforeCount) return true;
        const expectedDrop = Object.values(bot.entities || {}).find(entity => {
            if (entity?.name !== 'item' || !entity.position) return false;
            if (bot.entity.position.distanceTo(entity.position) > 8) return false;
            if (attemptedEntities.has(entity.id)) return false;
            let droppedItem = null;
            try {
                droppedItem = entity.getDroppedItem?.() || null;
            } catch {
                // A just-spawned item may not have its metadata yet. Exact
                // spawn identity and proximity to the block bind that case.
            }
            if (droppedItem) return itemTypes.has(droppedItem.type);
            return Boolean(
                targetPosition
                && priorEntityIds instanceof Set
                && !priorEntityIds.has(entity.id)
                && entity.position.distanceTo(targetPosition.offset(0.5, 0.5, 0.5)) <= 3,
            );
        });
        if (expectedDrop) {
            attemptedEntities.add(expectedDrop.id);
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

function carriedOutputCapacity(bot, itemName) {
    const definition = bot.registry?.itemsByName?.[itemName];
    const stackSize = Math.max(1, Number(definition?.stackSize) || 64);
    const partialCapacity = bot.inventory.items()
        .filter(item => item.name === itemName)
        .reduce((total, item) => (
            total + Math.max(0, (Number(item.stackSize) || stackSize) - item.count)
        ), 0);
    return {
        stackSize,
        capacity: partialCapacity + (bot.inventory.emptySlotCount() * stackSize),
    };
}

async function closeContainerQuietly(container) {
    if (!container?.close) return;
    try {
        await container.close();
    } catch (error) {
        console.warn(`[inventory] Failed to close container: ${String(error?.message || error).slice(0, 240)}`);
    }
}

async function openContainerForAction(bot, container, {
    signal = actionCancellationSignal(),
    openTimeoutMs = remainingActionTimeMs(CONTAINER_OPEN_TIMEOUT_MS),
} = {}) {
    if (!bot?.openContainer) {
        throw new TypeError('Mineflayer container API is unavailable.');
    }
    if (signal?.aborted || bot.interrupt_code || openTimeoutMs <= 0) {
        const error = new Error('Container opening was interrupted before activation.');
        error.name = 'AbortError';
        throw error;
    }

    const opened = await bot.openContainer(container, {
        signal,
        timeoutMs: Math.max(1, Math.min(CONTAINER_OPEN_TIMEOUT_MS, Number(openTimeoutMs) || CONTAINER_OPEN_TIMEOUT_MS)),
    });
    if (signal?.aborted || bot.interrupt_code) {
        await closeContainerQuietly(opened);
        const error = new Error('Container opening was interrupted before transfer.');
        error.name = 'AbortError';
        throw error;
    }
    return opened;
}

function containerItemCounts(container) {
    return (container?.containerItems?.() || []).reduce((counts, item) => {
        const name = String(item?.name || '');
        if (!name) return counts;
        counts[name] = (counts[name] || 0) + Math.max(0, Number(item.count) || 0);
        return counts;
    }, {});
}

function unrelatedContainerContentsPreserved(before, after, transferredItem) {
    const names = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    names.delete(transferredItem);
    return [...names].every(name => (before?.[name] || 0) === (after?.[name] || 0));
}

async function approachContainerBlock(bot, selected) {
    if (!selected?.position) return { block: null, outcome: 'container_not_found' };
    const position = selected.position.clone();
    const expectedName = selected.name;
    const reached = await goToGoal(
        bot,
        new pf.goals.GoalLookAtBlock(position, bot.world, {
            reach: 4,
            entityHeight: Number(bot.entity?.eyeHeight) || 1.6,
        }),
    );
    if (bot.interrupt_code) return { block: null, outcome: 'interrupted' };
    const observed = bot.blockAt(position);
    if (observed?.name !== expectedName || !EXPLORATION_CONTAINER_BLOCKS.includes(observed?.name)) {
        return { block: null, outcome: 'container_changed', observed: observed?.name || 'unloaded' };
    }
    return reached
        ? { block: observed, outcome: 'ready' }
        : { block: null, outcome: 'chest_unreachable' };
}

async function loadAssignedContainerBlock(bot, exactPosition) {
    if (!exactPosition || ![exactPosition.x, exactPosition.y, exactPosition.z].every(Number.isFinite)) {
        return { block: null, outcome: 'assigned_container_invalid', observed: null };
    }
    const position = new Vec3(
        Math.floor(exactPosition.x),
        Math.floor(exactPosition.y),
        Math.floor(exactPosition.z),
    );
    let observed = bot.blockAt(position);
    if (!observed) {
        const reachedLoadRadius = await goToGoal(
            bot,
            new pf.goals.GoalNear(position.x, position.y, position.z, ASSIGNED_CONTAINER_LOAD_RADIUS),
        );
        if (bot.interrupt_code) {
            return { block: null, outcome: 'interrupted', observed: null };
        }
        observed = bot.blockAt(position);
        if (!observed) {
            return {
                block: null,
                outcome: reachedLoadRadius ? 'assigned_container_unloaded' : 'assigned_container_unreachable',
                observed: null,
            };
        }
    }
    if (!EXPLORATION_CONTAINER_BLOCKS.includes(observed.name)) {
        return { block: null, outcome: 'assigned_container_invalid', observed: observed.name || null };
    }
    return { block: observed, outcome: 'ready', observed: observed.name };
}

// Blocks a route may tunnel through when the profile permits it. This is an
// allow-list of unambiguously natural fill, never a deny-list: anything a
// player could have built — planks, bricks, glass, wool, concrete, decorative
// sandstone variants, terracotta, beds, doors, torches — is absent, so a
// digging bot cannot chew through someone's house. Base sandstone remains
// ordinary generated geology. Ores are absent too; breaking those is
// collection, which is authorized separately and explicitly.
const NATURAL_FILL_BLOCKS = new Set([
    'dirt', 'coarse_dirt', 'rooted_dirt', 'grass_block', 'podzol', 'mycelium', 'mud',
    'clay', 'gravel', 'sand', 'red_sand', 'snow_block', 'moss_block',
    'sandstone', 'red_sandstone',
    // Cobblestone forms are processed/player-like structure materials. Raw
    // stone and deepslate remain terrain; their cobbled outputs must not be
    // bulldozed by navigation or treated as a clearable construction site.
    'stone', 'deepslate', 'tuff',
    'andesite', 'diorite', 'granite', 'calcite', 'dripstone_block',
    'netherrack', 'soul_sand', 'soul_soil', 'basalt', 'blackstone',
    'end_stone',
]);
// Inventory provenance is different from world geometry. Cobblestone must
// never become generically breakable terrain, but excess cobbled output made
// by a verified excavation route is safe mining debris once a useful reserve
// is preserved.
const EXCAVATION_DEBRIS_ITEMS = new Set([
    ...NATURAL_FILL_BLOCKS,
    'cobblestone',
    'cobbled_deepslate',
]);
const TRAVERSAL_POLICIES = new Set(['preserve', 'careful', 'full']);
const moveAwayHistory = new WeakMap();

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
    // Ordinary locomotion never owns excavation. Resource collection and the
    // deterministic mining adapters below may explicitly authorize exact
    // breaking; following, workstation approaches, pickup, and recovery may
    // only use native movement through existing space.
    movements.canDig = false;
    movements.canPlaceBlocks = false;
    movements.allow1by1towers = false;
    movements.allowParkour = false;
    movements.allowSprinting = true;
    movements.canOpenDoors = true;
    // Players and other solid entities are expensive route cells, not world
    // geometry. Absolute player exclusion can erase the only doorway when a
    // requester is standing beside the bot; Pathfinder then reports no path
    // to every resource in the world. Its native finite entity cost preserves
    // ordinary detours while still permitting one truthful exit route when a
    // nearby player temporarily occupies the only usable corridor.
    movements.entityCost = ENTITY_ROUTE_PENALTY;
    movements.dontMineUnderFallingBlock = true;
    movements.dontCreateFlow = true;
    movements.placeCost = 8;
    movements.digCost = 10;
    for (const block of ['glass', 'glass_pane']) {
        const blockId = bot?.registry?.blocksByName?.[block]?.id ?? mc.getBlockId(block);
        if (Number.isFinite(blockId)) movements.blocksCantBreak.add(blockId);
    }

    const policy = traversalPolicy(bot);
    if (policy === 'full') {
        // Full permits native jump/parkour geometry, but ordinary locomotion
        // still has no authority to place blocks. Pillaring is construction,
        // not walking, and it also explodes A*'s candidate space in forests
        // and uneven terrain.
        movements.allowParkour = true;
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

/**
 * Read-only native Pathfinder proof for a set of ordinary standing cells.
 * Site selectors use this before persisting a target; actual locomotion uses
 * goToGoal with the same safeMovements policy.
 */
export function probeSafeNavigationStances(bot, stances, timeoutMs = 2_000) {
    const positions = (Array.isArray(stances) ? stances : [])
        .filter(position => [position?.x, position?.y, position?.z].every(Number.isFinite))
        .map(position => new Vec3(
            Math.floor(position.x),
            Math.floor(position.y),
            Math.floor(position.z),
        ));
    if (positions.length === 0 || !bot?.pathfinder?.getPathTo || !bot?.entity?.position) {
        return { reachable: false, status: 'route_probe_unavailable', pathLength: 0 };
    }
    const goal = new pf.goals.GoalCompositeAny(
        positions.map(position => new pf.goals.GoalBlock(position.x, position.y, position.z)),
    );
    if (goal.isEnd(bot.entity.position.floored())) {
        const current = bot.entity.position.floored();
        return {
            reachable: true,
            status: 'already_at_stance',
            pathLength: 0,
            terminalPosition: { x: current.x, y: current.y, z: current.z },
        };
    }
    try {
        const result = bot.pathfinder.getPathTo(
            safeMovements(bot),
            goal,
            Math.max(100, Math.min(5_000, Math.floor(Number(timeoutMs) || 2_000))),
        );
        const terminal = Array.isArray(result?.path) ? result.path.at(-1) : null;
        return {
            reachable: result?.status === 'success',
            status: result?.status || 'unknown',
            pathLength: Array.isArray(result?.path) ? result.path.length : 0,
            terminalPosition: terminal && result?.status === 'success'
                ? { x: Math.floor(terminal.x), y: Math.floor(terminal.y), z: Math.floor(terminal.z) }
                : null,
        };
    } catch (error) {
        return {
            reachable: false,
            status: 'route_probe_error',
            pathLength: 0,
            error: String(error?.message || error).slice(0, 160),
        };
    }
}

function probeSafeNavigationFrom(bot, start, goal, timeoutMs) {
    if (!bot?.pathfinder?.getPathFromTo || !start || !goal) {
        return { reachable: false, status: 'route_probe_unavailable', pathLength: 0 };
    }
    const boundedTimeoutMs = Math.max(40, Math.min(2_000, Math.floor(Number(timeoutMs) || 500)));
    const deadlineAt = Date.now() + boundedTimeoutMs;
    let result = null;
    try {
        const generator = bot.pathfinder.getPathFromTo(
            safeMovements(bot),
            start,
            goal,
            {
                timeout: boundedTimeoutMs,
                tickTimeout: Math.max(
                    1,
                    Math.min(boundedTimeoutMs, Number(bot.pathfinder.tickTimeout) || 40),
                ),
                searchRadius: -1,
            },
        );
        while (Date.now() <= deadlineAt) {
            const next = generator.next();
            if (next.done) break;
            result = next.value?.result || null;
            if (result?.status !== 'partial') break;
        }
    } catch (error) {
        return {
            reachable: false,
            status: 'route_probe_error',
            pathLength: 0,
            error: String(error?.message || error).slice(0, 160),
        };
    }
    return {
        reachable: result?.status === 'success',
        status: result?.status || 'unknown',
        pathLength: Array.isArray(result?.path) ? result.path.length : 0,
    };
}

/**
 * Prove that ordinary native locomotion can both reach a candidate stance and
 * return from it to the supplied home position. Minecraft movement edges are
 * directional: a safe drop into a cave does not imply a climbable route out.
 */
export function probeSafeRoundTripNavigationStances(
    bot,
    stances,
    home,
    timeoutMs = 2_000,
) {
    const candidates = (Array.isArray(stances) ? stances : [])
        .filter(position => [position?.x, position?.y, position?.z].every(Number.isFinite))
        .map(position => new Vec3(
            Math.floor(position.x),
            Math.floor(position.y),
            Math.floor(position.z),
        ));
    if (
        candidates.length === 0
        || ![home?.x, home?.y, home?.z].every(Number.isFinite)
    ) {
        return { reachable: false, status: 'route_probe_unavailable', pathLength: 0 };
    }

    const boundedTimeoutMs = Math.max(100, Math.min(5_000, Math.floor(Number(timeoutMs) || 2_000)));
    const deadlineAt = Date.now() + boundedTimeoutMs;
    const remainingCandidates = candidates.slice(0, 128);
    let lastInbound = null;
    let lastReturn = null;
    let checked = 0;
    while (remainingCandidates.length > 0 && checked < 8 && Date.now() < deadlineAt) {
        const remainingMs = Math.max(40, deadlineAt - Date.now());
        lastInbound = probeSafeNavigationStances(bot, remainingCandidates, remainingMs);
        if (!lastInbound.reachable || !lastInbound.terminalPosition) break;

        const selected = new Vec3(
            lastInbound.terminalPosition.x,
            lastInbound.terminalPosition.y,
            lastInbound.terminalPosition.z,
        );
        const returnGoal = new pf.goals.GoalNear(
            Math.floor(home.x),
            Math.floor(home.y),
            Math.floor(home.z),
            3,
        );
        lastReturn = probeSafeNavigationFrom(
            bot,
            selected,
            returnGoal,
            Math.min(500, Math.max(40, deadlineAt - Date.now())),
        );
        checked += 1;
        if (lastReturn.reachable) {
            return {
                ...lastInbound,
                returnStatus: lastReturn.status,
                returnPathLength: lastReturn.pathLength,
                roundTripCandidatesChecked: checked,
            };
        }
        const selectedKey = `${selected.x}:${selected.y}:${selected.z}`;
        const index = remainingCandidates.findIndex(position => (
            `${position.x}:${position.y}:${position.z}` === selectedKey
        ));
        if (index < 0) break;
        remainingCandidates.splice(index, 1);
    }

    return {
        reachable: false,
        status: lastInbound?.reachable ? 'return_route_unreachable' : lastInbound?.status || 'unknown',
        pathLength: lastInbound?.pathLength || 0,
        returnStatus: lastReturn?.status || null,
        returnPathLength: lastReturn?.pathLength || 0,
        roundTripCandidatesChecked: checked,
    };
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

export function isLocalNavigationFoliage(bot, block, origin) {
    const position = block?.position;
    if (!position || !String(block.name || '').endsWith('_leaves')) return false;
    const dx = Math.abs(position.x - origin.x);
    const dy = position.y - origin.y;
    const dz = Math.abs(position.z - origin.z);
    const locallyBounded = dx <= NAVIGATION_RECOVERY_RADIUS
        && dz <= NAVIGATION_RECOVERY_RADIUS
        && dy >= -1
        && dy <= NAVIGATION_RECOVERY_RADIUS;
    if (!locallyBounded || !isEnvironmentallySafeToClear(bot, block)) return false;
    if (dy >= 0) return true;

    // A canopy can otherwise become a false "surface": ordinary Pathfinder
    // sees safe support but no route down, while recovery refuses to clear any
    // foliage below its starting Y. Authorize exactly one descending leaf cell
    // only when the resulting stance has verified support immediately below
    // and clear body space above. Pathfinder still owns the step and repeats
    // the proof from a new origin before any further descent.
    const support = bot.blockAt(position.offset(0, -1, 0));
    const bodySpace = bot.blockAt(position.offset(0, 1, 0));
    return isSafeGameplaySupport(support)
        && isCollectionStandingCellClear(bodySpace);
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

function observedBodyIntersectsBlock(bot, block) {
    const position = bot.entity?.position;
    if (!position || !block) return true;
    if (block.boundingBox === 'empty') return false;
    if (!block.position || !Array.isArray(block.shapes)) return true;

    const width = Number(bot.entity?.width);
    const height = Number(bot.entity?.height);
    const halfWidth = Number.isFinite(width) && width > 0 ? width / 2 : 0.3;
    const bodyHeight = Number.isFinite(height) && height > 0 ? height : 1.8;
    const epsilon = 1e-6;
    const body = {
        minX: position.x - halfWidth,
        maxX: position.x + halfWidth,
        minY: position.y,
        maxY: position.y + bodyHeight,
        minZ: position.z - halfWidth,
        maxZ: position.z + halfWidth,
    };

    return block.shapes.some(shape => {
        if (!Array.isArray(shape) || shape.length < 6 || !shape.every(Number.isFinite)) return true;
        const minX = block.position.x + shape[0];
        const minY = block.position.y + shape[1];
        const minZ = block.position.z + shape[2];
        const maxX = block.position.x + shape[3];
        const maxY = block.position.y + shape[4];
        const maxZ = block.position.z + shape[5];
        return body.minX < maxX - epsilon
            && body.maxX > minX + epsilon
            && body.minY < maxY - epsilon
            && body.maxY > minY + epsilon
            && body.minZ < maxZ - epsilon
            && body.maxZ > minZ + epsilon;
    });
}

function isObservedStandingCellClear(bot, block) {
    return Boolean(
        block
        && !isLiquidGameplayBlock(block)
        && !isHazardousGameplayBlock(block)
        && !observedBodyIntersectsBlock(bot, block)
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
        isObservedStandingCellClear(bot, bot.blockAt(expected))
        && isObservedStandingCellClear(bot, bot.blockAt(expected.offset(0, 1, 0)))
        && isAnchoredGameplaySupport(bot, bot.blockAt(expected.offset(0, -1, 0)))
    );
}

export function observedSupportedStandingCell(bot) {
    const floored = bot.entity?.position?.floored?.();
    if (!floored) return null;
    return [floored, floored.offset(0, 1, 0)]
        .find(candidate => physicallyOccupiesStandingCell(bot, candidate)) || null;
}

function occupiedOpenSurfaceStandingCell(bot) {
    const supported = observedSupportedStandingCell(bot);
    return supported && world.getFirstBlockAboveHead(bot, null, 32) === 'none'
        ? supported
        : null;
}

function navigationGoalSatisfied(bot, goal) {
    if (typeof goal?.isEnd !== 'function') return false;
    const floored = bot.entity?.position?.floored?.();
    if (floored && goal.isEnd(floored)) return true;
    // Farmland, paths, slabs, and other non-full support blocks can report the
    // body a fraction below the integer feet Y. Raw floor() then describes the
    // support block, not the cell occupied by the player. Use the same verified
    // body-volume descriptor as mining and tunnel settlement before declaring
    // native Pathfinder unable to satisfy an otherwise valid goal.
    const supported = observedSupportedStandingCell(bot);
    return Boolean(supported && goal.isEnd(supported));
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

function targetScopedCollectionMovements(bot, targetBlockOrBlocks, {
    allowPillars = false,
    allowNaturalRouteDigging = false,
    requireReturnableRoute = false,
    maxScaffoldingPlacements = Infinity,
    onBlockPlaced = null,
    placementAuthorizer = null,
    placementExclusions = null,
    additionalSafeToBreak = null,
} = {}) {
    const targetBlocks = Array.isArray(targetBlockOrBlocks)
        ? targetBlockOrBlocks
        : [targetBlockOrBlocks];
    const targets = new Set(targetBlocks
        .filter(block => block?.position && Number.isInteger(block.type))
        .map(block => `${block.type}:${block.position.x}:${block.position.y}:${block.position.z}`));
    const safetyGuard = collectionSafetyMovements(bot);
    const movements = collectionSafetyMovements(bot);
    // This movement is already capability-scoped: safeToBreak below permits
    // only the selected resource and the explicitly authorized natural route
    // cells. Do not inherit the large generic anti-destruction dig penalty
    // here. Pathfinder treats sufficiently expensive edges as unreachable,
    // which made a legal route through a few spruce leaves disappear before
    // it could reach the trunk or its authorized temporary scaffold.
    movements.digCost = 1;
    // collectblock mutates its Movements instance before starting. Keep the
    // authoritative safety checks on a separate instance and expose only the
    // exact bounded target set to pathfinder; every incidental route block
    // stays unbreakable.
    movements.safeToBreak = (candidate) => {
        const selectedTarget = (
            targets.has(`${candidate?.type}:${candidate?.position?.x}:${candidate?.position?.y}:${candidate?.position?.z}`)
            && safetyGuard.safeToBreak(candidate)
        );
        return selectedTarget || (
            allowNaturalRouteDigging
            && safetyGuard.defaultSafeToBreak(candidate)
            && isNaturalFillBlock(bot, candidate)
        ) || (
            typeof additionalSafeToBreak === 'function'
            && safetyGuard.defaultSafeToBreak(candidate)
            && additionalSafeToBreak(candidate) === true
        );
    };
    // A whole-tree harvest may need one temporary pillar to reach the crown.
    // This is never enabled for generic collection or ordinary navigation.
    movements.canPlaceBlocks = allowPillars === true;
    movements.allow1by1towers = allowPillars === true;
    movements.maxScaffoldingPlacements = Number.isFinite(maxScaffoldingPlacements)
        ? Math.max(0, Math.floor(maxScaffoldingPlacements))
        : Infinity;
    movements.onBlockPlaced = typeof onBlockPlaced === 'function' ? onBlockPlaced : null;
    if (allowPillars === true && typeof placementAuthorizer === 'function') {
        // Pathfinder owns how to execute a legal tower edge, while the
        // capability owns where construction is authorized. A denied cell is
        // removed from A* before execution, preventing speculative pillars
        // from bloating search or appearing around the worksite.
        movements.exclusionAreasPlace.push(block => (
            placementAuthorizer(block?.position) === true ? 0 : 1_000
        ));
    }
    if (Array.isArray(placementExclusions) && placementExclusions.length > 0) {
        movements.exclusionAreasPlace.push(block => (
            collectionPositionExcluded(block?.position, placementExclusions) ? 1_000 : 0
        ));
    }
    if (requireReturnableRoute) {
        // A collection plugin may pursue a falling drop after breaking the
        // target. Never advertise a descent it cannot climb back from when
        // the owning capability promises returnability.
        movements.allowParkour = false;
        movements.maxDropDown = Math.min(
            Number(movements.maxDropDown) || DEFAULT_MAX_DROP_DOWN,
            1,
        );
        movements.infiniteLiquidDropdownDistance = false;
    }
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

function collectionBreakTime(bot, block, boundTool = undefined) {
    try {
        const tool = boundTool === undefined
            ? bot.pathfinder.bestHarvestTool?.(block)
            : boundTool;
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
    preservedReturnRoute = [],
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
                {
                    preservedReturnRoute,
                    expectedProtectedRouteCells: preservedReturnRoute.length,
                },
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
        const requiresMonotonicAscent = Boolean(
            !occupiedOpenSurfaceStandingCell(bot)
            && candidate.position.y - Math.floor(start.y) >= MIN_SURFACE_ROUTE_PROGRESS
        );
        // Access recovery may clear nearby leaves, but it must not turn a
        // harvest request into a damaging plunge toward an unreachable block.
        local.movements.maxDropDown = requiresMonotonicAscent
            ? 0
            : Math.max(
                Number(local.movements.maxDropDown) || DEFAULT_MAX_DROP_DOWN,
                Number(selection?.descentFallback?.maxDropDown) || DEFAULT_MAX_DROP_DOWN,
            );
        local.movements.infiniteLiquidDropdownDistance = false;
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
        const monotonicAscentPreserved = !requiresMonotonicAscent || Boolean(
            end
            && Math.floor(end.y) >= Math.floor(start.y)
            && observedSupportedStandingCell(bot)
        );
        const recovered = !bot.interrupt_code
            && monotonicAscentPreserved
            && (reached || targetProgress >= COLLECTION_ACCESS_PROGRESS_DISTANCE);
        search.lastMovementOutcome = monotonicAscentPreserved
            ? navigationOutcomeName(outcome, bot)
            : 'unsafe_descent';
        search.distanceMoved += moved;
        if (!monotonicAscentPreserved) return false;
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

export async function autoLight(bot) {
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

export async function craftRecipe(bot, itemName, num=1, exactWorkstation=null) {
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
        const mixedPlankRecipe = craftingTableAvailable => {
            const template = createPlankFamilyRecipe(
                bot.registry,
                bot.recipesAll(itemId, null, craftingTableAvailable),
            );
            return template
                ? bindCarriedPlankRecipe(bot.registry, template, bot.inventory.items())
                : null;
        };
        let recipes = exactWorkstation
            ? []
            : bot.recipesFor(itemId, null, 1, null);
        if (!recipes?.length && !exactWorkstation) {
            const mixed = mixedPlankRecipe(false);
            if (mixed) recipes = [mixed];
        }
        let craftingTable = null;
        const craftingTableRange = 64;

        if (!recipes?.length) {
            recipes = bot.recipesFor(itemId, null, 1, true);
            if (!recipes?.length) {
                const mixed = mixedPlankRecipe(true);
                if (mixed) recipes = [mixed];
            }
            if (!recipes?.length) {
                const ingredients = Object.entries(recipeDocs[0]?.[0] || {}).map(([key, value]) => `${key}: ${value}`).join(', ');
                return finish(false, { kind: 'craft', outcome: 'missing_material', target, retryable: true }, `You do not have the resources to craft ${itemName}${ingredients ? `. It requires: ${ingredients}.` : '.'}`);
            }

            const tableBinding = await bindExistingWorkstation(
                bot,
                'crafting_table',
                craftingTableRange,
                null,
                exactWorkstation,
            );
            if (tableBinding.outcome === 'interrupted') {
                return finish(false, { kind: 'craft', outcome: 'interrupted', target, retryable: false }, 'Crafting was interrupted while approaching the crafting table.');
            }
            craftingTable = tableBinding.block;
            if (exactWorkstation && !craftingTable) {
                const outcome = tableBinding.outcome === 'wrong_dimension'
                    ? 'exact_table_wrong_dimension'
                    : tableBinding.outcome === 'target_changed'
                        ? 'exact_table_changed'
                        : tableBinding.outcome === 'unreachable'
                            ? 'exact_table_unreachable'
                            : 'exact_table_missing';
                return finish(false, {
                    kind: 'craft',
                    outcome,
                    target,
                    workstation: exactWorkstation,
                    observed: tableBinding.observed || null,
                    retryable: false,
                }, `The exact crafting table at ${exactWorkstation.position.x}, ${exactWorkstation.position.y}, ${exactWorkstation.position.z} is not usable (${tableBinding.outcome}); no substitute was used.`);
            }
            const worldTableRouteFailed = ['unreachable', 'target_changed'].includes(tableBinding.outcome);
            if (worldTableRouteFailed) {
                log(bot, 'The nearest world crafting table has no non-destructive native route; using a carried local fallback if available.');
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
            if (!recipes?.length) {
                const mixed = mixedPlankRecipe(true);
                if (mixed) recipes = [mixed];
            }
        }

        if (!recipes?.length) {
            return finish(false, { kind: 'craft', outcome: 'recipe_unavailable', target, retryable: true }, `No usable recipe for ${itemName} is available here.`);
        }

        const recipe = recipes[0];
        const inventory = world.getInventoryCounts(bot);
        const requiredIngredients = mc.ingredientsFromPrismarineRecipe(recipe);
        const craftLimit = (() => {
            if (!isPlankFamilyRecipe(recipe)) {
                return mc.calculateLimitingResource(inventory, requiredIngredients);
            }
            const exactIngredients = Object.fromEntries(
                Object.entries(requiredIngredients)
                    .filter(([name]) => !name.endsWith('_planks')),
            );
            const exactLimit = mc.calculateLimitingResource(inventory, exactIngredients);
            const familyLimit = Math.floor(
                carriedPlankCount(bot.inventory.items())
                / Math.max(1, Number(recipe.mindcraftIngredientFamily.count) || 1)
            );
            return {
                num: Math.min(familyLimit, Math.max(0, Number(exactLimit.num) || 0)),
                limitingResource: familyLimit <= exactLimit.num
                    ? 'planks'
                    : exactLimit.limitingResource,
            };
        })();
        const craftAttempts = Math.min(Math.max(0, Math.floor(Number(craftLimit?.num) || 0)), requestedCrafts);
        if (craftAttempts < 1) {
            return finish(false, { kind: 'craft', outcome: 'missing_material', target, retryable: true }, `You do not have enough materials to craft ${itemName}.`);
        }

        const outputPerCraft = Math.max(
            1,
            Math.floor(Number(recipe?.result?.count || recipeDocs[0]?.[1]?.craftedCount) || 1),
        );
        const expectedOutputCount = craftAttempts * outputPerCraft;
        let outputCapacity = carriedOutputCapacity(bot, itemName);
        if (outputCapacity.capacity < expectedOutputCount) {
            const requiredAdditionalSlots = Math.ceil(
                (expectedOutputCount - outputCapacity.capacity) / outputCapacity.stackSize,
            );
            const requiredFreeSlots = bot.inventory.emptySlotCount() + requiredAdditionalSlots;
            const protectedNames = new Set([
                itemName,
                ...Object.keys(requiredIngredients),
                ...(isPlankFamilyRecipe(recipe)
                    ? recipe.mindcraftIngredientFamily.members
                    : []),
            ]);
            await freeCollectionWorkingSlots(bot, protectedNames, requiredFreeSlots);
            outputCapacity = carriedOutputCapacity(bot, itemName);
            if (outputCapacity.capacity < expectedOutputCount) {
                return finish(false, {
                    kind: 'craft',
                    outcome: 'inventory_full',
                    target,
                    expectedOutputCount,
                    availableOutputCapacity: outputCapacity.capacity,
                    requiredFreeSlots,
                    requiredAdditionalSlots,
                    observedFreeSlots: bot.inventory.emptySlotCount(),
                    retryable: false,
                }, `Cannot craft ${itemName}: inventory has no safe capacity for the verified output.`);
            }
        }

        const beforeCount = inventoryCount(bot, itemName);
        try {
            if (isPlankFamilyRecipe(recipe)) {
                for (let attempt = 0; attempt < craftAttempts; attempt += 1) {
                    const rebound = mixedPlankRecipe(Boolean(craftingTable));
                    if (!rebound) throw new Error('mixed plank recipe no longer has enough carried planks');
                    await bot.craft(rebound, 1, craftingTable);
                }
            } else {
                await bot.craft(recipe, craftAttempts, craftingTable);
            }
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
            ...(isPlankFamilyRecipe(recipe) ? { ingredientFamily: 'planks' } : {}),
            workstation: exactWorkstation,
            retryable: false,
        }, `Crafted ${outputCount} ${itemName}.`);
    } finally {
        if (temporaryTable) {
            let cleanup;
            try {
                cleanup = await recoverLocalWorkstation(bot, temporaryTable);
            } catch (error) {
                cleanup = {
                    outcome: 'workstation_cleanup_failed',
                    target: {
                        name: 'crafting_table',
                        x: temporaryTable.position.x,
                        y: temporaryTable.position.y,
                        z: temporaryTable.position.z,
                    },
                    error: String(error?.message || error).slice(0, 240),
                    retryable: true,
                };
            }
            if (
                cleanup.outcome !== 'recovered'
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

function collectionToolItemEvidence(bot, item) {
    if (!item?.name) return null;
    const durability = toolDurability(bot, item);
    return {
        name: item.name,
        count: Math.max(0, Number(item.count) || 0),
        inventorySlot: Number.isInteger(item.slot) ? item.slot : null,
        durability: Number.isFinite(durability.max) ? {
            maximum: durability.max,
            used: durability.used,
            remaining: durability.remaining,
            reserve: durability.reserve,
            usable: durability.usable,
            healthy: durability.healthy,
        } : null,
    };
}

function collectionToolStateEvidence(bot, target) {
    const selected = collectionToolItemEvidence(bot, bot?.heldItem);
    const carried = (bot?.inventory?.items?.() || [])
        .filter(item => Object.hasOwn(TOOL_PREPARATION_SPECS, item?.name))
        .slice(0, 16)
        .map(item => collectionToolItemEvidence(bot, item))
        .filter(Boolean);
    let canHarvestTarget = null;
    if (selected && [target?.x, target?.y, target?.z].every(Number.isFinite)) {
        try {
            const block = bot.blockAt(new Vec3(target.x, target.y, target.z));
            canHarvestTarget = block ? block.canHarvest(bot.heldItem?.type ?? null) : null;
        } catch {
            canHarvestTarget = null;
        }
    }
    return {
        observedAt: Date.now(),
        selectedInventorySlot: selected?.inventorySlot ?? null,
        selectedHotbarSlot: Number.isInteger(bot?.quickBarSlot) ? bot.quickBarSlot : null,
        selected,
        carried,
        canHarvestTarget,
    };
}

function collectionInventoryStateEvidence(bot) {
    const items = (bot?.inventory?.items?.() || [])
        .slice(0, 46)
        .map(item => ({
            name: String(item?.name || '').slice(0, 80),
            count: Math.max(0, Number(item?.count) || 0),
            inventorySlot: Number.isInteger(item?.slot) ? item.slot : null,
        }))
        .filter(item => item.name);
    const counts = {};
    for (const item of items) counts[item.name] = (counts[item.name] || 0) + item.count;
    return {
        observedAt: Date.now(),
        emptySlots: Number.isFinite(bot?.inventory?.emptySlotCount?.())
            ? bot.inventory.emptySlotCount()
            : null,
        counts,
        items,
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
    let recommended = null;
    try { recommended = mc.getBlockTool(block?.name); } catch { /* use name fallback */ }
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

function toolPreparationTier(item) {
    return TOOL_PREPARATION_SPECS[item?.name]?.tier
        ?? TOOL_TIER[String(item?.name || '').split('_')[0]]
        ?? 0;
}

function minimumPreparedToolTierForBlock(bot, block, family) {
    return Object.entries(TOOL_PREPARATION_SPECS)
        .filter(([, spec]) => spec.family === family)
        .map(([name, spec]) => ({
            name,
            tier: spec.tier,
            type: bot.registry?.itemsByName?.[name]?.id,
        }))
        .filter(candidate => {
            if (!Number.isInteger(candidate.type)) return false;
            try { return block.canHarvest(candidate.type); } catch { return false; }
        })
        .sort((left, right) => left.tier - right.tier || left.name.localeCompare(right.name))[0]
        ?.tier ?? null;
}

/**
 * Bind a carried tool for authorized mining-route fill without spending the
 * minimum tier needed for the final ore when a lower capable pick exists.
 * Pathfinder and mineflayer-tool intentionally optimize for fastest harvest;
 * target-tier preservation is project planning policy, so the binder owns the
 * choice while Mineflayer continues to own equip and dig mechanics.
 */
export function selectMiningRouteTool(
    bot,
    block,
    targetBlock,
    { capacities = null, allowWorn = false } = {},
) {
    const family = toolFamilyForBlock(block);
    if (!family) return null;
    const items = bot.inventory.items()
        .filter(item => (
            item.name.endsWith(`_${family}`)
            && (allowWorn || toolDurability(bot, item).healthy)
            && (!capacities || capacities.get(item.slot) > 0)
        ))
        .filter(item => {
            try { return block.canHarvest(item.type); } catch { return false; }
        });
    if (items.length === 0) return null;

    const targetFamily = toolFamilyForBlock(targetBlock);
    const targetTier = targetFamily === family
        ? minimumPreparedToolTierForBlock(bot, targetBlock, family)
        : null;
    if (family !== 'pickaxe' || !Number.isFinite(targetTier)) {
        return items.sort((left, right) => (
            toolPreparationTier(right) - toolPreparationTier(left)
            || toolEnchantmentScore(bot, right, block) - toolEnchantmentScore(bot, left, block)
            || (capacities?.get(right.slot) ?? toolDurability(bot, right).usable)
                - (capacities?.get(left.slot) ?? toolDurability(bot, left).usable)
        ))[0];
    }

    // Wooden and golden picks are poor corridor tools even where Minecraft
    // technically permits them. Prefer the fastest carried tier below the
    // target requirement (iron below diamond, stone below iron), otherwise the
    // lowest capable target tier. Durability breaks ties within that role.
    const responsive = items.filter(item => toolPreparationTier(item) >= TOOL_TIER.stone);
    const candidates = responsive.length > 0 ? responsive : items;
    const lowerTier = candidates.filter(item => toolPreparationTier(item) < targetTier);
    const roleCandidates = lowerTier.length > 0 ? lowerTier : candidates;
    return roleCandidates.sort((left, right) => {
        const leftTier = toolPreparationTier(left);
        const rightTier = toolPreparationTier(right);
        const tierDelta = lowerTier.length > 0
            ? rightTier - leftTier
            : leftTier - rightTier;
        if (tierDelta !== 0) return tierDelta;
        const enchantDelta = toolEnchantmentScore(bot, right, block)
            - toolEnchantmentScore(bot, left, block);
        if (enchantDelta !== 0) return enchantDelta;
        return (capacities?.get(right.slot) ?? toolDurability(bot, right).usable)
            - (capacities?.get(left.slot) ?? toolDurability(bot, left).usable);
    })[0];
}

async function equipBestToolForBlock(bot, block, options = {}) {
    const family = toolFamilyForBlock(block);
    const routeTool = options?.preserveTargetToolFor
        ? selectMiningRouteTool(bot, block, options.preserveTargetToolFor)
        : null;
    const preferred = routeTool || (family
        ? bestInventoryTool(bot, family, { block })
        : null);
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

export async function prepareTool(bot, toolName, collectionExclusions=null) {
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
                if (!await collectWood(bot, Math.max(1, Math.ceil(deficit / 4)), 64, collectionExclusions)) return false;
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
        return await prepareTool(bot, prerequisite, collectionExclusions);
    };

    const ensureCobblestone = async (minimum) => {
        if (inventoryCount(bot, 'cobblestone') >= minimum) return true;
        if (!await ensurePickaxeTier(1) || interrupt()) return false;

        const collectMissing = async () => {
            const missing = minimum - inventoryCount(bot, 'cobblestone');
            if (missing <= 0) return true;
            await collectBlock(bot, 'cobblestone', missing, collectionExclusions);
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
        if (!await collectWood(bot, 2, 64, collectionExclusions) || interrupt()) return false;
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
            if (!await collectBlock(bot, ore, rawDeficit, collectionExclusions) || interrupt()) return false;
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
        if (!await collectBlock(bot, ore, missing, collectionExclusions) || interrupt()) return false;
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

export async function prepareMaterial(bot, materialName, num=1, range=64, collectionExclusions=null) {
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
                    ? await collectBlock(bot, matchingLog, logsNeeded, collectionExclusions, searchRange)
                    : await collectWood(bot, Math.min(64, logsNeeded), searchRange, collectionExclusions);
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
        success = await prepareTool(bot, 'stone_pickaxe', collectionExclusions)
            && !interrupted()
            && (
                materialInventoryCount(bot, material) >= desired
                || await collectBlock(
                    bot,
                    'cobblestone',
                    desired - materialInventoryCount(bot, material),
                    collectionExclusions,
                    searchRange,
                )
            );
    } else if (material === 'dirt') {
        success = await collectBlock(bot, 'dirt', amount, collectionExclusions, searchRange);
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
            if (!await prepareTool(bot, 'wooden_pickaxe', collectionExclusions) || interrupted()) {
                return finish(false, 'coal_tool_unavailable');
            }
            if (!await collectBlock(bot, 'coal_ore', Math.max(1, Math.ceil(amount / 4)), collectionExclusions, searchRange)) {
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

export async function prepareFood(bot, targetFoodPoints=24, range=64, exactWorkstation=null, baselineFoodPoints=null) {
    const requestedPoints = Math.max(6, Math.min(160, Math.floor(Number(targetFoodPoints) || 24)));
    const searchRange = Math.max(16, Math.min(128, Math.floor(Number(range) || 64)));
    const beforePoints = safeFoodPoints(bot);
    const hasDurableBaseline = baselineFoodPoints !== null
        && baselineFoodPoints !== undefined
        && Number.isFinite(Number(baselineFoodPoints));
    const durableBaseline = hasDurableBaseline
        ? Math.max(0, Math.min(2304, Math.floor(Number(baselineFoodPoints))))
        : null;
    const targetPoints = hasDurableBaseline
        ? Math.min(2304, durableBaseline + requestedPoints)
        : requestedPoints;
    const previousHeldItem = bot.heldItem?.name || null;
    const progress = {
        cropsHarvested: 0,
        cropsReplanted: 0,
        animalsHunted: 0,
        itemsCooked: 0,
        breadCrafted: 0,
    };
    const target = {
        name: 'safe_food',
        foodPoints: targetPoints,
        additionalFoodPoints: hasDurableBaseline ? requestedPoints : 0,
        baselineFoodPoints: durableBaseline,
    };
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
            workstation: exactWorkstation,
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
        if (exactWorkstation) {
            const binding = await bindExistingWorkstation(bot, 'furnace', 64, null, exactWorkstation);
            if (!binding.block) return false;
        } else if (!world.getNearestBlock(bot, 'furnace', 16) && inventoryCount(bot, 'furnace') < 1) {
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
        return Boolean(exactWorkstation || world.getNearestBlock(bot, 'furnace', 16) || inventoryCount(bot, 'furnace') > 0)
            && Boolean(mc.getSmeltingFuel(bot));
    };
    const carriedCookableFood = () => bot.inventory.items()
        .map(item => ({
            count: Math.max(0, Number(item.count) || 0),
            input: item.name,
            output: cookingOutputForFood(bot.registry, item.name),
        }))
        .filter(entry => entry.output && entry.count > 0);
    const carriedCookableCount = () => carriedCookableFood().reduce(
        (total, entry) => total + entry.count,
        0,
    );
    const cookCarriedFood = async (bootstrap) => {
        if (carriedCookableCount() < 1 || safeFoodPoints(bot) >= targetPoints) return true;
        if (bootstrap) {
            if (!await ensureCookingStation()) return false;
        } else if ((!exactWorkstation && !world.getNearestBlock(bot, 'furnace', 16)) || !mc.getSmeltingFuel(bot)) {
            return false;
        }
        for (const { input, output } of carriedCookableFood()) {
            if (interrupted() || safeFoodPoints(bot) >= targetPoints) break;
            const available = inventoryCount(bot, input);
            if (available < 1) continue;
            const outputPoints = Math.max(1, Number(bot.registry?.foodsByName?.[output]?.foodPoints) || 1);
            const amount = Math.min(
                available,
                Math.max(1, Math.ceil((targetPoints - safeFoodPoints(bot)) / outputPoints)),
            );
            const before = inventoryCount(bot, output);
            if (await smeltItem(bot, input, amount, exactWorkstation)) {
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
            const spec = mc.matureCropHarvestForBlock(current.name);
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
    const potentialCookedFoodPoints = () => carriedCookableFood().reduce(
        (total, { input, output }) => {
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
                    && HUNTABLE_FOOD_ANIMALS.has(entity.name)
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

export async function prepareWoodenTool(bot, toolName, collectionExclusions=null) {
    return await prepareTool(bot, toolName, collectionExclusions);
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

export async function smeltItem(bot, itemName, num=1, exactWorkstation=null) {
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
    const outputName = mc.getItemSmeltingOutput(itemName);
    const target = { name: itemName || 'smeltable' };
    let finalEvidence = null;
    let furnace = null;
    let furnaceBlock = null;
    let temporaryFurnace = null;
    let worldFurnaceRouteFailed = false;
    let reclaimedOutput = null;
    const finish = (success, outcome, detail = {}) => {
        finalEvidence = {
            kind: 'smelt',
            outcome,
            target,
            output: outputName,
            requested: amount,
            workstation: exactWorkstation,
            ...(reclaimedOutput ? { reclaimedOutput } : {}),
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
        const furnaceBinding = await bindExistingWorkstation(bot, 'furnace', 64, null, exactWorkstation);
        if (furnaceBinding.outcome === 'interrupted') {
            return finish(false, 'interrupted', { retryable: false });
        }
        furnaceBlock = furnaceBinding.block;
        if (exactWorkstation && !furnaceBlock) {
            const outcome = furnaceBinding.outcome === 'wrong_dimension'
                ? 'exact_furnace_wrong_dimension'
                : furnaceBinding.outcome === 'target_changed'
                    ? 'exact_furnace_changed'
                    : furnaceBinding.outcome === 'unreachable'
                        ? 'exact_furnace_unreachable'
                        : 'exact_furnace_missing';
            log(bot, `The exact furnace at ${exactWorkstation.position.x}, ${exactWorkstation.position.y}, ${exactWorkstation.position.z} is not usable (${furnaceBinding.outcome}); no substitute was used.`);
            return finish(false, outcome, {
                observed: furnaceBinding.observed || null,
                retryable: false,
            });
        }
        worldFurnaceRouteFailed = ['unreachable', 'target_changed'].includes(furnaceBinding.outcome);
        if (worldFurnaceRouteFailed) {
            log(bot, 'The nearest world furnace has no non-destructive native route; using a carried local fallback if available.');
        }
        if (!furnaceBlock && inventoryCount(bot, 'furnace') > 0) {
            const localFurnace = await placeLocalWorkstation(bot, 'furnace', 8);
            if (!localFurnace.ok && localFurnace.outcome === 'no_workstation_space') {
                log(bot, 'There is no safe local space to place the furnace.');
                return finish(false, 'no_furnace_space');
            }
            if (!localFurnace.ok) {
                log(bot, `Could not place the carried furnace in ${localFurnace.failures.length} bounded local candidate${localFurnace.failures.length === 1 ? '' : 's'}.`);
                return finish(false, localFurnace.outcome === 'interrupted'
                    ? 'interrupted'
                    : 'furnace_not_placed', {
                    placementFailures: localFurnace.failures,
                    retryable: localFurnace.outcome !== 'interrupted',
                });
            }
            temporaryFurnace = {
                itemName: 'furnace',
                position: localFurnace.position,
                inventoryBeforePlacement: localFurnace.inventoryBeforePlacement,
            };
            furnaceBlock = localFurnace.block;
            if (furnaceBlock?.name !== 'furnace') {
                return finish(false, 'furnace_not_confirmed');
            }
            temporaryFurnace.position = furnaceBlock.position.clone();
        }
        if (!furnaceBlock) {
            log(bot, worldFurnaceRouteFailed
                ? 'The world furnace is unreachable without excavation, and no carried furnace is available.'
                : 'There is no reachable furnace and no carried furnace.');
            return finish(false, worldFurnaceRouteFailed ? 'furnace_unreachable' : 'missing_furnace', worldFurnaceRouteFailed
                ? { workstationRequirement: { name: 'furnace', carried: true } }
                : {});
        }
        if (bot.interrupt_code) return finish(false, 'interrupted', { retryable: false });

        // Mineflayer's furnace takeOutput() resolves with the furnace item even
        // when putAway() had no carried slot and tossed that item into the
        // world. Reserve verified carried capacity before transferring any
        // input or fuel so a successful furnace action cannot silently lose
        // its output. Reuse the shared bounded overflow policy and preserve
        // every material that can participate in this smelt.
        let outputCapacity = carriedOutputCapacity(bot, outputName);
        if (outputCapacity.capacity < amount) {
            const requiredAdditionalSlots = Math.ceil(
                (amount - outputCapacity.capacity) / outputCapacity.stackSize,
            );
            const requiredFreeSlots = bot.inventory.emptySlotCount() + requiredAdditionalSlots;
            const protectedNames = new Set([
                itemName,
                outputName,
                'furnace',
                ...bot.inventory.items()
                    .filter(item => mc.getFuelSmeltOutput(item.name) > 0)
                    .map(item => item.name),
            ]);
            const capacityReleased = await freeCollectionWorkingSlots(bot, protectedNames, requiredFreeSlots, {
                allowLocalCache: false,
                resumePosition: furnaceBlock.position,
            });
            outputCapacity = carriedOutputCapacity(bot, outputName);
            if (!capacityReleased || outputCapacity.capacity < amount) {
                log(bot, `Cannot smelt ${itemName}: inventory has no safe capacity for ${amount} ${outputName}.`);
                return finish(false, 'inventory_full', {
                    expectedOutputCount: amount,
                    availableOutputCapacity: outputCapacity.capacity,
                    requiredFreeSlots,
                    requiredAdditionalSlots,
                    observedFreeSlots: bot.inventory.emptySlotCount(),
                    retryable: false,
                });
            }
        }

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
            const outputCount = Math.max(1, Number(existingOutput.count) || 1);
            const capacity = carriedOutputCapacity(bot, existingOutput.name).capacity;
            if (capacity < outputCount) {
                log(bot, `The furnace contains ${existingOutput.name}, but inventory cannot safely reclaim it before smelting ${outputName}.`);
                return finish(false, 'furnace_output_inventory_blocked', {
                    observed: existingOutput.name,
                    observedCount: outputCount,
                    availableCapacity: capacity,
                });
            }
            const beforeReclaim = carriedWindowInventoryCount(furnace, existingOutput.name);
            const reclaimed = await furnace.takeOutput();
            await waitForWorldCondition(
                bot,
                () => carriedWindowInventoryCount(furnace, existingOutput.name) >= beforeReclaim + outputCount,
                1_000,
            );
            const received = Math.max(
                0,
                carriedWindowInventoryCount(furnace, existingOutput.name) - beforeReclaim,
            );
            if (furnace.outputItem() || !reclaimed || received < outputCount) {
                log(bot, `Could not verify reclaiming the existing ${existingOutput.name} furnace output.`);
                return finish(false, 'furnace_output_reclaim_unverified', {
                    observed: existingOutput.name,
                    expected: outputCount,
                    received,
                });
            }
            reclaimedOutput = { name: existingOutput.name, count: received };
            log(bot, `Reclaimed ${received} ${existingOutput.name} from the furnace before smelting ${outputName}.`);
        }

        const existingFuel = furnace.fuelItem();
        const existingFuelCapacity = existingFuel
            ? Math.max(0, Number(existingFuel.count) || 0)
                * mc.getFuelSmeltOutput(existingFuel.name || mc.getItemName(existingFuel.type) || '')
            : 0;
        const fuelPlan = selectSmeltingFuelPlan(
            bot.inventory.items(),
            Math.max(0, amount - existingFuelCapacity),
        );
        const availableSmelts = existingFuelCapacity + fuelPlan.availableSmelts;
        let plannedAmount = amount;
        if (!fuelPlan.ok) {
            plannedAmount = Math.min(amount, Math.floor(availableSmelts));
            if (plannedAmount < 1) {
                log(bot, `Available furnace fuel cannot cook any of ${amount} ${itemName}.`);
                return finish(false, availableSmelts > 0 ? 'insufficient_fuel' : 'missing_fuel', {
                    requiredSmelts: amount,
                    availableSmelts,
                    fuels: fuelPlan.entries.map(entry => ({
                        name: entry.name,
                        count: entry.count,
                        outputPerItem: entry.outputPerItem,
                    })),
                });
            }
            log(bot, `Fuel can cook ${plannedAmount} of ${amount} ${itemName}; completing that verified partial batch.`);
        }
        let nextFuelEntry = 0;
        const refuelIfEmpty = async () => {
            if (furnace.fuelItem() || nextFuelEntry >= fuelPlan.entries.length) return;
            const entry = fuelPlan.entries[nextFuelEntry];
            await furnace.putFuel(entry.type, null, entry.count);
            nextFuelEntry += 1;
        };
        await refuelIfEmpty();

        await furnace.putInput(mc.getItemId(itemName), null, plannedAmount);
        let total = 0;
        let observedOutput = outputName;
        let lastProgressAt = Date.now();
        const deadline = Date.now() + Math.min(660_000, Math.max(25_000, (plannedAmount * 11_000) + 15_000));
        while (total < plannedAmount && Date.now() < deadline) {
            if (bot.interrupt_code) break;
            await new Promise(resolve => setTimeout(resolve, 500));
            // Furnace slots consume the active fuel stack before its burn
            // time expires. That empty interval is the legal point to load a
            // different planned fuel type without resetting smelt progress.
            await refuelIfEmpty();
            const output = furnace.outputItem();
            if (output) {
                const beforeOutputCount = carriedWindowInventoryCount(furnace, output.name);
                const expectedTransfer = Math.max(1, Number(output.count) || 1);
                const collected = await furnace.takeOutput();
                await waitForWorldCondition(
                    bot,
                    () => carriedWindowInventoryCount(furnace, output.name) >= beforeOutputCount + expectedTransfer,
                    1_000,
                );
                const received = Math.max(
                    0,
                    carriedWindowInventoryCount(furnace, output.name) - beforeOutputCount,
                );
                if (collected && received > 0) {
                    total += received;
                    observedOutput = collected.name || mc.getItemName(collected.type);
                    lastProgressAt = Date.now();
                } else {
                    const remainingCapacity = carriedOutputCapacity(bot, output.name).capacity;
                    log(bot, `Furnace output was removed, but ${output.name} did not enter carried inventory.`);
                    return finish(false, remainingCapacity < expectedTransfer
                        ? 'inventory_full'
                        : 'furnace_output_transfer_unverified', {
                        expectedTransfer,
                        received,
                        availableOutputCapacity: remainingCapacity,
                    });
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
            return finish(false, total > 0 ? 'partial' : 'stalled', {
                count: total,
                plannedAmount,
                availableSmelts,
                observedOutput,
            });
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
            let cleanup;
            try {
                cleanup = await recoverLocalWorkstation(bot, temporaryFurnace);
            } catch (error) {
                cleanup = {
                    outcome: 'workstation_cleanup_failed',
                    target: {
                        name: 'furnace',
                        x: temporaryFurnace.position.x,
                        y: temporaryFurnace.position.y,
                        z: temporaryFurnace.position.z,
                    },
                    error: String(error?.message || error).slice(0, 240),
                    retryable: true,
                };
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
        const standBinding = await bindExistingWorkstation(bot, 'brewing_stand', 16);
        if (standBinding.outcome === 'interrupted') {
            return finish(false, 'interrupted', { retryable: false });
        }
        standBlock = standBinding.block;
        if (!standBlock && inventoryCount(bot, 'brewing_stand') < 1) {
            await craftRecipe(bot, 'brewing_stand', 1);
        }
        if (!standBlock && inventoryCount(bot, 'brewing_stand') > 0) {
            const localStand = await placeLocalWorkstation(bot, 'brewing_stand', 8);
            if (!localStand.ok && localStand.outcome === 'no_workstation_space') {
                log(bot, 'There is no safe local space to place the brewing stand.');
                return finish(false, 'no_brewing_stand_space');
            }
            if (!localStand.ok) {
                return finish(false, localStand.outcome === 'interrupted'
                    ? 'interrupted'
                    : 'brewing_stand_not_placed', {
                    placementFailures: localStand.failures,
                    retryable: localStand.outcome !== 'interrupted',
                });
            }
            standBlock = localStand.block;
            if (standBlock?.name !== 'brewing_stand') {
                return finish(false, 'brewing_stand_not_confirmed');
            }
            temporaryStand = {
                itemName: 'brewing_stand',
                position: standBlock.position.clone(),
                inventoryBeforePlacement: localStand.inventoryBeforePlacement,
            };
        }
        if (!standBlock) {
            const worldStandUnreachable = ['unreachable', 'target_changed'].includes(standBinding.outcome);
            log(bot, worldStandUnreachable
                ? 'The world brewing stand is unreachable without excavation, and no carried stand could be prepared.'
                : 'There is no reachable brewing stand and no carried stand could be prepared.');
            return finish(false, worldStandUnreachable ? 'brewing_stand_unreachable' : 'missing_brewing_stand');
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
        let cleanup = null;
        if (temporaryStand?.position) {
            try {
                cleanup = await recoverLocalWorkstation(bot, temporaryStand);
            } catch (error) {
                cleanup = {
                    outcome: 'workstation_cleanup_failed',
                    target: {
                        name: 'brewing_stand',
                        x: temporaryStand.position.x,
                        y: temporaryStand.position.y,
                        z: temporaryStand.position.z,
                    },
                    error: String(error?.message || error).slice(0, 240),
                    retryable: true,
                };
            }
        }
        if (finalEvidence) setActionEvidence(bot, cleanup ? { ...finalEvidence, cleanup } : finalEvidence);
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
    const furnaceBinding = await bindExistingWorkstation(bot, 'furnace', 32);
    let furnaceBlock = furnaceBinding.block;
    const target = furnaceBlock?.position
        ? { name: 'furnace', x: furnaceBlock.position.x, y: furnaceBlock.position.y, z: furnaceBlock.position.z }
        : furnaceBinding.position
            ? { name: 'furnace', x: furnaceBinding.position.x, y: furnaceBinding.position.y, z: furnaceBinding.position.z }
            : { name: 'furnace' };
    if (!furnaceBlock) {
        const outcome = furnaceBinding.outcome === 'interrupted'
            ? 'interrupted'
            : furnaceBinding.outcome === 'not_found'
                ? 'not_found'
                : 'unreachable';
        setActionEvidence(bot, { kind: 'furnace', outcome, target, retryable: outcome !== 'interrupted' });
        log(bot, outcome === 'not_found'
            ? 'No furnace nearby to clear.'
            : outcome === 'interrupted'
                ? 'Stopped before clearing the furnace.'
                : 'The nearest furnace has no non-destructive native route.');
        return false;
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
                    onGround: typeof entity.onGround === 'boolean' ? entity.onGround : null,
                },
            };
        });
    return {
        health: bot.health,
        hunger: bot.food,
        equipment: combatEquipmentSnapshot(bot),
        targetEntityId: Number.isFinite(attributedEntityId) ? attributedEntityId : null,
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

function pvpCombatIsSettled(bot) {
    const controls = bot?.controlState || {};
    return !bot?.pvp?.target
        && bot?.pathfinder?.goal == null
        && bot?.pathfinder?.isMoving?.() !== true
        && !Object.values(controls).some(Boolean);
}

async function stopPvpCombatAndSettle(bot) {
    try { await bot.pvp?.stop?.(); } catch { /* physical settlement below is authoritative */ }
    let warned = false;
    while (!pvpCombatIsSettled(bot)) {
        // entityGone asks mineflayer-pvp to stop without awaiting it. Clearing
        // Pathfinder's goal here settles that package-owned transition before
        // ActionManager is allowed to hand locomotion to another action.
        stopNavigationGoal(bot);
        try { bot.clearControlStates?.(); } catch { /* disconnected body */ }
        await new Promise(resolve => setTimeout(resolve, 25));
        if (!warned) {
            warned = true;
            console.warn('[combat] PvP cancellation is settling; ActionManager ownership remains held.');
        }
    }
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
                if (decision.response === 'shield_melee') {
                    if (!await equipCombatShield(bot)) {
                        return finish(false, 'shield_equipment_failed', { steps });
                    }
                    shieldWindows += 1;
                }
                // mineflayer-pvp is the ordinary moving-melee primitive. It
                // owns live GoalFollow pursuit, vanilla jumps, shield cadence,
                // and repeated swings for this entire engagement. Tactical
                // code chooses the target and policy; it must not reimplement
                // the package by alternating one route with one manual swing.
                const attacked = await attackEntity(bot, entity, true);
                const combat = bot.lastActionEvidence;
                attack = {
                    confirmed: attacked,
                    outcome: combat?.outcome || (attacked ? 'killed' : 'melee_blocked'),
                    evidence: combat,
                };
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
            verifiedHits += Math.max(1, Number(attack.evidence?.botAttributedHits) || 0);
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
        await stopPvpCombatAndSettle(bot);
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

function loadedEntityHarvestCandidates(bot, source) {
    const origin = bot.entity?.position;
    return Object.values(bot.entities || {})
        .filter(entity => entityMatchesHarvestSource(entity, source))
        .filter(entity => entity.position && origin)
        .sort((left, right) => (
            origin.distanceTo(left.position) - origin.distanceTo(right.position)
            || left.id - right.id
        ));
}

function entityHarvestSearchWaypoints(origin, range) {
    const step = Math.min(64, Math.max(32, Math.floor(range / 3)));
    const rings = Math.max(1, Math.ceil(range / step));
    const waypoints = [];
    for (let ring = 1; ring <= rings; ring += 1) {
        const radius = ring * step;
        const offsets = [
            [radius, 0], [radius, radius], [0, radius], [-radius, radius],
            [-radius, 0], [-radius, -radius], [0, -radius], [radius, -radius],
        ];
        for (const [dx, dz] of offsets) {
            if (Math.hypot(dx, dz) <= range + 0.5) {
                waypoints.push({ x: origin.x + dx, z: origin.z + dz });
            }
        }
    }
    return waypoints;
}

function createEntityHarvestSearch(origin, range) {
    return {
        origin: { x: origin.x, y: origin.y, z: origin.z },
        waypoints: entityHarvestSearchWaypoints(origin, range),
        cursor: 0,
        attempts: 0,
        relocations: 0,
        distanceMoved: 0,
        lastMovementOutcome: null,
    };
}

const MAX_ENTITY_HARVEST_RELOCATIONS_PER_ACTION = 1;

async function relocateEntityHarvestSearch(bot, sourceName, search) {
    while (
        !bot.interrupt_code
        && remainingActionTimeMs() > 0
        && search.cursor < search.waypoints.length
    ) {
        const waypoint = search.waypoints[search.cursor++];
        const before = bot.entity?.position?.clone?.();
        if (!before) return false;
        search.attempts += 1;
        log(
            bot,
            `No loaded ${sourceName} is harvestable here. Searching the next covered region `
            + `(${search.cursor}/${search.waypoints.length}).`,
        );
        const reached = await goToGoal(
            bot,
            new pf.goals.GoalXZ(Math.floor(waypoint.x), Math.floor(waypoint.z)),
            { movements: () => safeMovements(bot) },
        );
        const after = bot.entity?.position;
        const moved = after?.distanceTo(before) || 0;
        search.distanceMoved += moved;
        search.lastMovementOutcome = bot.lastActionEvidence?.outcome || (reached ? 'reached' : 'blocked');
        if (bot.interrupt_code) return false;
        if (!reached || moved < MIN_COLLECTION_RESCAN_PROGRESS) continue;
        search.relocations += 1;
        await interruptibleDelay(bot, 350);
        log(bot, `Reached a distinct entity-search region after ${moved.toFixed(1)} blocks; rescanning.`);
        return true;
    }
    return false;
}

async function collectEntityHarvestDrops(bot, outputName, range) {
    const before = inventoryCount(bot, outputName);
    const candidates = droppedItemCandidates(
        bot,
        Math.max(8, Math.min(32, Number(range) || 12)),
        item => item.name === outputName,
    );
    if (candidates.length === 0) return 0;
    await collectDroppedItemQueue(bot, candidates, {
        kind: 'entity_harvest_pickup',
        requireAll: false,
        successMessage: count => `Recovered ${count} ${outputName} from the entity harvest.`,
    });
    return Math.max(0, inventoryCount(bot, outputName) - before);
}

/**
 * Harvest a registry-valid entity drop through its versioned mechanic. Source
 * search is bounded and uses normal native navigation; the action succeeds
 * only when the requested inventory effect is physically observed.
 */
export async function harvestEntityDrop(bot, sourceName, outputName, method='shear', count=1, range=64, allowAlternative=false) {
    const requested = Math.max(1, Math.min(64, Math.floor(Number(count) || 1)));
    const boundedRange = Math.max(16, Math.min(512, Math.floor(Number(range) || 64)));
    const source = entityHarvestSources(bot.registry, outputName)
        .find(candidate => candidate.entity === sourceName && candidate.method === method);
    if (!source) {
        setActionEvidence(bot, {
            kind: 'entity_harvest',
            outcome: 'unsupported_source',
            target: { source: sourceName, output: outputName, method },
            retryable: false,
        });
        log(bot, `${sourceName} is not a verified ${method} source for ${outputName}.`);
        return false;
    }

    const startedAt = Date.now();
    const initialCount = inventoryCount(bot, outputName);
    const desiredCount = initialCount + requested;
    const origin = bot.entity?.position?.clone?.();
    if (!origin) return false;
    const attempted = new Set();
    const search = createEntityHarvestSearch(origin, boundedRange);
    let observedAlternative = null;

    let lastReachedPosition = origin.clone();
    searchLoop: while (!bot.interrupt_code && remainingActionTimeMs() > 0) {
        if (bot.interrupt_code || remainingActionTimeMs() <= 0) break;

        while (!bot.interrupt_code && remainingActionTimeMs() > 0) {
            await collectEntityHarvestDrops(bot, outputName, boundedRange);
            if (inventoryCount(bot, outputName) >= desiredCount) {
                const currentCount = inventoryCount(bot, outputName);
                setActionEvidence(bot, {
                    kind: 'entity_harvest',
                    outcome: 'drop_collected',
                    target: { source: sourceName, output: outputName, method },
                    collected: currentCount - initialCount,
                    requested,
                    elapsedMs: Date.now() - startedAt,
                    retryable: false,
                });
                log(bot, `Collected ${currentCount - initialCount} ${outputName} by ${method}ing ${sourceName}.`);
                return true;
            }
            const candidate = loadedEntityHarvestCandidates(bot, source)
                .find(entity => !attempted.has(entity.id));
            if (!candidate) {
                const alternative = Object.values(bot.entities || {})
                    .map(entity => ({ entity, output: entityHarvestOutput(entity, method) }))
                    .filter(entry => entry.output && entry.output !== outputName && entry.entity?.position)
                    .sort((left, right) => (
                        bot.entity.position.distanceTo(left.entity.position)
                        - bot.entity.position.distanceTo(right.entity.position)
                        || left.entity.id - right.entity.id
                    ))[0];
                // Alternative-family evidence is useful only when the requested
                // source was genuinely absent. Once a matching entity has been
                // attempted (or produced a partial drop), switching variants
                // would hide a physical interaction/pickup failure and can make
                // a durable material binding oscillate between nearby colours.
                if (
                    alternative
                    && !observedAlternative
                    && attempted.size === 0
                    && inventoryCount(bot, outputName) === initialCount
                ) {
                    observedAlternative = {
                        output: alternative.output,
                        entityId: alternative.entity.id,
                        position: alternative.entity.position.clone(),
                    };
                    log(
                        bot,
                        `Observed ${alternative.output} from a nearby ${sourceName}; continuing the exact ${outputName} search first.`,
                    );
                    if (allowAlternative === true) break searchLoop;
                }
                break;
            }
            attempted.add(candidate.id);

            if (source.requiredItem && !await equip(bot, source.requiredItem, 'hand')) {
                setActionEvidence(bot, {
                    kind: 'entity_harvest',
                    outcome: 'tool_unavailable',
                    target: { source: sourceName, output: outputName, method, entityId: candidate.id },
                    retryable: true,
                });
                return false;
            }
            // Entity positions are observations, not destinations. Let native
            // Pathfinder pursue the live entity so ordinary walking, jumping,
            // and replanning remain valid while the animal moves.
            const reached = await goToGoal(bot, new pf.goals.GoalFollow(candidate, 2.5));
            const live = bot.entities?.[candidate.id];
            const interactionDistance = live?.position
                ? bot.entity.position.distanceTo(live.position)
                : Number.POSITIVE_INFINITY;
            if (
                !reached
                || !entityMatchesHarvestSource(live, source)
                || interactionDistance > 4.5
            ) continue;

            try {
                await bot.lookAt(live.position.offset(0, Math.max(0.5, Number(live.height) * 0.5 || 0.65), 0), true);
                // Mineflayer distinguishes generic entity activation (villager
                // interaction, mounting) from using the held item on an entity.
                // Shearing is explicitly owned by useOn().
                bot.useOn(live);
                await interruptibleDelay(bot, 650);
                await collectEntityHarvestDrops(bot, outputName, 12);
            } catch (error) {
                if (bot.interrupt_code) break;
                console.warn(`[entity-harvest] ${method} ${sourceName} failed: ${String(error?.message || error).slice(0, 240)}`);
                continue;
            }

            const currentCount = inventoryCount(bot, outputName);
            if (currentCount >= desiredCount) {
                setActionEvidence(bot, {
                    kind: 'entity_harvest',
                    outcome: 'drop_collected',
                    target: { source: sourceName, output: outputName, method, entityId: candidate.id },
                    collected: currentCount - initialCount,
                    requested,
                    elapsedMs: Date.now() - startedAt,
                    retryable: false,
                });
                log(bot, `Collected ${currentCount - initialCount} ${outputName} by ${method}ing ${sourceName}.`);
                return true;
            }
        }
        // One local miss plus one verified region move is enough evidence for
        // this capability action. Return control to the durable planner after
        // rescanning that new region instead of hiding twenty long journeys
        // inside one opaque action. The next invocation starts from the bot's
        // physically advanced position and can bind the next region or method.
        if (search.relocations >= MAX_ENTITY_HARVEST_RELOCATIONS_PER_ACTION) break;
        if (!await relocateEntityHarvestSearch(bot, sourceName, search)) break;
        lastReachedPosition = bot.entity.position.clone();
    }

    const collected = Math.max(0, inventoryCount(bot, outputName) - initialCount);
    const interrupted = Boolean(bot.interrupt_code);
    const relocationDistance = Math.max(
        origin.distanceTo(lastReachedPosition),
        Number(search.distanceMoved) || 0,
    );
    const searchAdvanced = !interrupted && relocationDistance >= 8;
    const reportAlternative = Boolean(
        !interrupted
        && collected === 0
        && attempted.size === 0
        && observedAlternative
    );
    setActionEvidence(bot, {
        kind: 'entity_harvest',
        outcome: interrupted
            ? 'interrupted'
            : reportAlternative
                ? 'alternative_source_observed'
            : collected > 0
                ? 'partial_drop_collected'
                : searchAdvanced
                    ? 'source_search_advanced'
                    : 'source_not_found',
        target: { source: sourceName, output: outputName, method },
        collected,
        requested,
        searchAdvanced,
        origin: { x: origin.x, y: origin.y, z: origin.z },
        observedPosition: {
            x: lastReachedPosition.x,
            y: lastReachedPosition.y,
            z: lastReachedPosition.z,
        },
        ...(reportAlternative ? {
            alternativeOutput: observedAlternative.output,
            entityId: observedAlternative.entityId,
            alternativePosition: {
                x: observedAlternative.position.x,
                y: observedAlternative.position.y,
                z: observedAlternative.position.z,
            },
        } : {}),
        relocationDistance,
        elapsedMs: Date.now() - startedAt,
        retryable: !interrupted && !reportAlternative,
    });
    log(bot, interrupted
        ? `Stopped harvesting ${outputName}.`
        : `Could not find enough harvestable ${sourceName} for ${requested} ${outputName}.`);
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
            const movements = safeMovements(bot);
            // Combat may traverse normal block geometry, including native
            // jumps, but target pursuit never authorizes excavation.
            movements.canDig = false;
            bot.pvp.movements = movements;
            await bot.pvp.attack(entity);
            const deadlineAt = startedAt + remainingActionTimeMs(MAX_PVP_ENGAGEMENT_MS);
            while (!targetDied && Date.now() < deadlineAt) {
                await interruptibleDelay(bot, 100);
                if (bot.interrupt_code) {
                    setActionEvidence(bot, { kind: 'combat', outcome: 'interrupted', target, retryable: false });
                    return false;
                }
                if (!bot.entities?.[entity.id]) break;
            }

            if (!targetDied) {
                const timedOut = Date.now() >= deadlineAt;
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
            await stopPvpCombatAndSettle(bot);
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
            await stopPvpCombatAndSettle(bot);
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

function ignoredPickupEntityIds(bot) {
    if (!(bot._mindcraftIgnoredPickupEntityIds instanceof Set)) {
        bot._mindcraftIgnoredPickupEntityIds = new Set();
    }
    if (!bot._mindcraftIgnoredPickupCleanupInstalled) {
        bot._mindcraftIgnoredPickupCleanupInstalled = true;
        bot.on('entityGone', entity => {
            if (Number.isFinite(entity?.id)) bot._mindcraftIgnoredPickupEntityIds.delete(entity.id);
        });
    }
    return bot._mindcraftIgnoredPickupEntityIds;
}

export function isIgnoredPickupEntity(bot, entity) {
    return Number.isFinite(entity?.id)
        && bot?._mindcraftIgnoredPickupEntityIds instanceof Set
        && bot._mindcraftIgnoredPickupEntityIds.has(entity.id);
}

async function tossDiscardedStack(bot, item, {
    awayFrom = null,
    discardedEntities = null,
} = {}) {
    const origin = bot.entity?.position?.clone?.();
    const priorIds = new Set(Object.keys(bot.entities || {}).map(Number));
    let observed = null;
    const matchesDiscard = entity => {
        if (
            priorIds.has(Number(entity?.id))
            || entity?.name !== 'item'
            || !entity.position
            || !origin
            || origin.distanceTo(entity.position) > 3.5
        ) return false;
        try {
            return entity.getDroppedItem?.()?.name === item.name;
        } catch {
            return false;
        }
    };
    const onEntitySpawn = entity => {
        if (matchesDiscard(entity)) observed = entity;
    };
    bot.on('entitySpawn', onEntitySpawn);
    try {
        if (origin && awayFrom && [awayFrom.x, awayFrom.z].every(Number.isFinite)) {
            const dx = origin.x - awayFrom.x;
            const dz = origin.z - awayFrom.z;
            const length = Math.hypot(dx, dz);
            if (length > 0.1) {
                await bot.lookAt(origin.offset(
                    (dx / length) * 6,
                    Math.max(1.4, Number(bot.entity?.height) || 1.8),
                    (dz / length) * 6,
                ), true);
            }
        }
        await bot.tossStack(item);
        // Item metadata may arrive just after entitySpawn. Keep physical action
        // ownership through one bounded settlement window, then correlate the
        // newly spawned nearby stack by identity and item type.
        await interruptibleDelay(bot, 350);
        observed ||= Object.values(bot.entities || {}).find(matchesDiscard) || null;
        if (!Number.isFinite(observed?.id)) return false;
        ignoredPickupEntityIds(bot).add(observed.id);
        if (Array.isArray(discardedEntities)) {
            discardedEntities.push({
                id: observed.id,
                position: observed.position?.clone?.() || null,
            });
        }
        return true;
    } finally {
        bot.removeListener('entitySpawn', onEntitySpawn);
    }
}

function redundantNaturalFillStack(
    inventoryItems,
    protectedNames,
    eligibleItems = NATURAL_FILL_BLOCKS,
) {
    const totals = new Map();
    for (const item of inventoryItems) {
        totals.set(item.name, (totals.get(item.name) || 0) + item.count);
    }
    return inventoryItems
        .filter(item => (
            Number.isInteger(item.slot)
            && item.count >= MIN_COLLECTION_NATURAL_FILL_RESERVE
            && eligibleItems.has(item.name)
            && !protectedNames.has(item.name)
            && (totals.get(item.name) - item.count) >= MIN_COLLECTION_NATURAL_FILL_RESERVE
        ))
        .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))[0]
        || null;
}

export function selectRedundantExcavationDebrisStack(inventoryItems, protectedNames = new Set()) {
    return redundantNaturalFillStack(
        Array.isArray(inventoryItems) ? inventoryItems : [],
        protectedNames instanceof Set ? protectedNames : new Set(protectedNames || []),
        EXCAVATION_DEBRIS_ITEMS,
    );
}

async function freeCollectionWorkingSlots(bot, protectedNames, requestedSlots = 1, {
    allowLocalCache = true,
    resumePosition = null,
    requireDisposalSeparation = !allowLocalCache,
    preferBulkNaturalFill = false,
} = {}) {
    const inventoryStart = Number(bot.inventory?.inventoryStart);
    const inventoryEnd = Number(bot.inventory?.inventoryEnd);
    const carriedSlotCount = Number.isInteger(inventoryStart)
        && Number.isInteger(inventoryEnd)
        && inventoryEnd > inventoryStart
        ? inventoryEnd - inventoryStart
        : 36;
    const desiredSlots = Math.max(1, Math.min(
        carriedSlotCount,
        Math.floor(Number(requestedSlots) || 1),
    ));
    if (!allowLocalCache && requireDisposalSeparation) {
        const staleDrop = bot.nearestEntity?.(entity => (
            entity?.name === 'item'
            && entity?.position
            && bot.entity?.position?.distanceTo(entity.position) <= 2.5
        ));
        if (staleDrop) {
            const cleanStanceReached = await moveAway(bot, 4, { allowLocalRecovery: false });
            if (!cleanStanceReached) {
                log(bot, 'Could not reach a clean disposal stance away from old dropped items.');
                return false;
            }
        }
    }
    let releaseActions = 0;
    let discardedDropsQuarantined = true;
    const discardedEntities = [];
    while (
        !bot.interrupt_code
        && bot.inventory.emptySlotCount() < desiredSlots
        && releaseActions < MAX_COLLECTION_SLOT_RELEASE_ACTIONS
    ) {
        const inventoryItems = bot.inventory.items();
        const preferredBulk = preferBulkNaturalFill
            ? selectRedundantExcavationDebrisStack(inventoryItems, protectedNames)
            : null;
        if (preferredBulk) {
            discardedDropsQuarantined = await tossDiscardedStack(bot, preferredBulk, {
                awayFrom: resumePosition,
                discardedEntities,
            }) && discardedDropsQuarantined;
            releaseActions += 1;
            log(
                bot,
                `Released one redundant ${preferredBulk.count}-block ${preferredBulk.name} excavation stack while preserving at least ${MIN_COLLECTION_NATURAL_FILL_RESERVE} carried blocks.`,
            );
            await interruptibleDelay(bot, 100);
            continue;
        }
        let candidate = inventoryItems
            .filter(item => (
                item.count > 0
                && item.count <= 8
                && Number.isInteger(item.slot)
                && NATURAL_FILL_BLOCKS.has(item.name)
                && !protectedNames.has(item.name)
            ))
            .map(item => ({ ...item, kind: 'natural_fill' }))
            .sort((left, right) => left.count - right.count || left.name.localeCompare(right.name))[0];

        if (candidate && allowLocalCache) {
            let placed = 0;
            while (
                !bot.interrupt_code
                && inventoryCount(bot, candidate.name) > 0
                && placed < candidate.count
            ) {
                const selectedSlotItem = bot.inventory.slots[candidate.slot];
                if (
                    selectedSlotItem?.name !== candidate.name
                    && bot.heldItem?.name === candidate.name
                    && Number.isInteger(bot.heldItem.slot)
                ) candidate.slot = bot.heldItem.slot;
                const position = world.getNearestFreeSpace(bot, 1, 8);
                if (!position || !await placeBlock(
                    bot,
                    candidate.name,
                    position.x,
                    position.y,
                    position.z,
                    'bottom',
                    true,
                    false,
                    candidate.slot,
                )) break;
                placed += 1;
            }
            if (placed > 0) {
                releaseActions += 1;
                log(bot, `Cached ${placed} expendable ${candidate.name} block${placed === 1 ? '' : 's'} in verified local cells.`);
                continue;
            }
        }
        if (candidate && !allowLocalCache) {
            // Construction near a player-owned site must not create an
            // untracked cache pile. The same bounded classification is still
            // safe to retire directly: this is a tiny natural-fill stack, not
            // a protected job material or essential item.
            discardedDropsQuarantined = await tossDiscardedStack(bot, candidate, {
                awayFrom: resumePosition,
                discardedEntities,
            })
                && discardedDropsQuarantined;
            releaseActions += 1;
            log(bot, `Released one expendable ${candidate.count}-block ${candidate.name} stack without modifying the worksite.`);
            await interruptibleDelay(bot, 100);
            continue;
        }

        const disposableClutter = selectDisposableWorkingSlotStack(bot, protectedNames);
        if (disposableClutter) {
            // Only the shared overflow policy's lowest-value, zero-reserve
            // class is eligible here. Unknown items, useful reserves, gear,
            // food, and every current job material remain fail-closed.
            discardedDropsQuarantined = await tossDiscardedStack(bot, disposableClutter, {
                awayFrom: resumePosition,
                discardedEntities,
            })
                && discardedDropsQuarantined;
            releaseActions += 1;
            log(bot, `Released one expendable ${disposableClutter.count}-item ${disposableClutter.name} stack.`);
            await interruptibleDelay(bot, 100);
            continue;
        }

        const toolGroups = new Map();
        for (const item of inventoryItems) {
            if (!TOOL_PREPARATION_SPECS[item.name] || protectedNames.has(item.name)) continue;
            const group = toolGroups.get(item.name) || [];
            group.push(item);
            toolGroups.set(item.name, group);
        }
        const duplicateTool = [...toolGroups.values()]
            .flatMap(group => group
                .sort((left, right) => (
                    toolDurability(bot, right).usable - toolDurability(bot, left).usable
                    || left.slot - right.slot
                ))
                .slice(1))
            .sort((left, right) => (
                toolDurability(bot, left).usable - toolDurability(bot, right).usable
                || left.name.localeCompare(right.name)
                || left.slot - right.slot
            ))[0];
        if (duplicateTool) {
            // Drop the exact worn stack selected above. toss(type, count)
            // may transfer a healthier same-type tool from an earlier slot.
            discardedDropsQuarantined = await tossDiscardedStack(bot, duplicateTool, {
                awayFrom: resumePosition,
                discardedEntities,
            })
                && discardedDropsQuarantined;
            releaseActions += 1;
            log(bot, `Retired one superseded ${duplicateTool.name} while preserving the healthiest carried copy.`);
            await interruptibleDelay(bot, 100);
            continue;
        }

        const bulkDebris = redundantNaturalFillStack(inventoryItems, protectedNames);
        if (bulkDebris) {
            // Releasing the bound stack guarantees that this action actually
            // opens a slot instead of draining equivalent blocks elsewhere.
            discardedDropsQuarantined = await tossDiscardedStack(bot, bulkDebris, {
                awayFrom: resumePosition,
                discardedEntities,
            })
                && discardedDropsQuarantined;
            releaseActions += 1;
            log(
                bot,
                `Released one redundant ${bulkDebris.count}-block ${bulkDebris.name} excavation stack while preserving at least ${MIN_COLLECTION_NATURAL_FILL_RESERVE} carried blocks.`,
            );
            await interruptibleDelay(bot, 100);
            continue;
        }
        break;
    }
    let released = bot.inventory.emptySlotCount() >= desiredSlots;
    if (
        released
        && releaseActions > 0
        && !allowLocalCache
        && requireDisposalSeparation
    ) {
        let leftDisposalStance = false;
        if (resumePosition && [resumePosition.x, resumePosition.y, resumePosition.z].every(Number.isFinite)) {
            const resumeGoal = new pf.goals.GoalNear(
                Math.floor(resumePosition.x),
                Math.floor(resumePosition.y),
                Math.floor(resumePosition.z),
                1,
            );
            leftDisposalStance = resumeGoal.isEnd(bot.entity.position.floored())
                || await goToGoal(bot, resumeGoal, { allowLocalRecovery: false });
        } else {
            leftDisposalStance = await moveAway(bot, 3, { allowLocalRecovery: false });
        }
        await interruptibleDelay(bot, 150);
        const clearOfDiscardedItems = discardedEntities.every(entry => {
            const position = bot.entities?.[entry.id]?.position || entry.position;
            return !position || bot.entity.position.distanceTo(position) >= 2.5;
        });
        if (!leftDisposalStance || !discardedDropsQuarantined || !clearOfDiscardedItems) {
            log(bot, 'Working slots opened, but the bot could not leave the disposal pickup radius safely.');
            return false;
        }
        released = bot.inventory.emptySlotCount() >= desiredSlots;
    }
    return released;
}

export async function releaseInventoryWorkingSlots(bot, protectedItems='', requestedSlots=2) {
    const protectedNames = new Set(
        (protectedItems instanceof Set
            ? [...protectedItems]
            : Array.isArray(protectedItems)
                ? protectedItems
                : String(protectedItems || '').split(','))
            .map(name => String(name || '').trim())
            .filter(Boolean),
    );
    const desiredSlots = Math.max(1, Math.min(12, Math.floor(Number(requestedSlots) || 2)));
    const beforeSlots = bot.inventory.emptySlotCount();
    const released = await freeCollectionWorkingSlots(bot, protectedNames, desiredSlots, {
        // A construction capacity repair must not scatter temporary blocks
        // around a player's base. Collection may still cache tiny natural-fill
        // stacks in verified cells while tunnelling.
        allowLocalCache: false,
    });
    const afterSlots = bot.inventory.emptySlotCount();
    setActionEvidence(bot, {
        kind: 'inventory_capacity',
        outcome: released ? 'working_slots_released' : bot.interrupt_code ? 'interrupted' : 'no_safe_release',
        target: { name: 'working_inventory' },
        protectedItems: [...protectedNames],
        requestedSlots: desiredSlots,
        beforeSlots,
        afterSlots,
        retryable: !released && !bot.interrupt_code,
    });
    log(bot, released
        ? `Released ${afterSlots - beforeSlots} safe working inventory slot${afterSlots - beforeSlots === 1 ? '' : 's'} while preserving job materials.`
        : `Could not release ${desiredSlots} working inventory slots without sacrificing protected or essential items.`);
    return released;
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
    const failedCollectionTargets = [];
    const setCollectionEvidence = evidence => setActionEvidence(bot, {
        ...evidence,
        ...(failedCollectionTargets.length > 0 ? {
            failedTargets: failedCollectionTargets.map(target => ({ ...target })),
        } : {}),
    });
    if (num < 1) {
        setCollectionEvidence({
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
    const inferredNaturalRouteDigging = blockType === 'cobblestone'
        || blockType === 'stone'
        || blockType === 'deepslate'
        || blockType === 'ancient_debris'
        || blockType === 'obsidian'
        || blockType.endsWith('_ore');
    // Exact exposed-resource bindings must be able to forbid excavation.
    // Omission retains the normal mining default; an explicit false is policy.
    const allowNaturalRouteDigging = Object.prototype.hasOwnProperty.call(
        searchOptions || {},
        'allowNaturalRouteDigging',
    )
        ? searchOptions.allowNaturalRouteDigging === true
        : inferredNaturalRouteDigging;
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
    const preservedReturnRoute = normalizePreservedMiningReturnRoute(
        searchOptions?.preservedReturnRoute,
    );
    const excludedPositions = normalizeCollectionExclusions(exclude);
    const rememberCollectionTargetFailure = (outcome, target) => {
        if (
            !RETRYABLE_COLLECTION_TARGET_OUTCOMES.has(outcome)
            || ![target?.x, target?.y, target?.z].every(Number.isFinite)
        ) return false;
        const failure = {
            kind: 'collect',
            name: target.name || blockType,
            x: Math.floor(target.x),
            y: Math.floor(target.y),
            z: Math.floor(target.z),
            outcome,
            targetLocal: true,
        };
        const key = `${failure.name}:${failure.x}:${failure.y}:${failure.z}`;
        const priorIndex = failedCollectionTargets.findIndex(candidate => (
            `${candidate.name}:${candidate.x}:${candidate.y}:${candidate.z}` === key
        ));
        if (priorIndex >= 0) failedCollectionTargets.splice(priorIndex, 1);
        failedCollectionTargets.push(failure);
        if (failedCollectionTargets.length > MAX_COLLECTION_CANDIDATES) {
            failedCollectionTargets.shift();
        }
        return true;
    };
    const retryDifferentCollectionTarget = (outcome, target) => {
        const targetFailedLocally = rememberCollectionTargetFailure(outcome, target);
        if (
            preferredPosition
            || !targetFailedLocally
            || search.candidateFailures >= MAX_COLLECTION_TARGET_FAILURES
        ) return false;
        excludedPositions.push({
            x: target.x,
            y: target.y,
            z: target.z,
            radius: COLLECTION_FAILED_TARGET_EXCLUSION_RADIUS,
        });
        search.candidateFailures += 1;
        log(
            bot,
            `Skipping the failed ${target.name || blockType} source at ${target.x}, ${target.y}, ${target.z}; `
                + 'selecting one different safe candidate before returning control.',
        );
        return true;
    };

    let collected = 0;
    let lowestCollectedTarget = null;
    const cancellationSignal = actionCancellationSignal();

    const selectionMovements = collectionSafetyMovements(bot);
    bot.pathfinder.setMovements(safeMovements(bot));

    for (let i=0; i<num && !bot.interrupt_code && !cancellationSignal?.aborted; i++) {
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
            // A persisted coordinate is an exact binding, not a new regional
            // search. If it changed or was excluded, fail it cheaply so the
            // Director can clear or replace that binding immediately.
            if (!preferredPosition && await relocateCollectionSearch(bot, blockType, search)) {
                i -= 1;
                continue;
            }
            if (collected === 0) {
                setCollectionEvidence({
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
                    requireReturnableRoute: searchOptions?.requireReturnableRoute === true,
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
                    preservedReturnRoute,
                })
            );
            if (recoveredAccess) {
                // A deadline-safe corridor prefix is a complete physical
                // action even though it has not produced the requested drop
                // yet. End this lease at the verified staging cell so the
                // next typed action gets a fresh deadline; continuing here
                // used to overwrite real position progress with a late
                // unreachable failure and walk the bot back to the surface.
                if (
                    bot.lastActionEvidence?.kind === 'mining_search'
                    && bot.lastActionEvidence?.outcome === 'search_advanced'
                    && bot.lastActionEvidence?.returnable === true
                ) return false;
                i -= 1;
                continue;
            }
            if (bot.lastActionEvidence?.kind === 'collect' && bot.lastActionEvidence.outcome === 'missing_tool') {
                setCollectionEvidence(bot.lastActionEvidence);
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
            setCollectionEvidence({
                kind: 'collect',
                outcome: 'unreachable',
                target: miningFailure ? {
                    ...miningFailure.target,
                    decision: collectionDecisionEvidence(selection),
                } : {
                    ...bindRejectedCollectionTarget(selection, blockType),
                    decision: collectionDecisionEvidence(selection),
                },
                ...(miningFailure ? { accessOutcome: miningFailure.outcome } : {}),
                ...(miningFailure?.routeOutcomes
                    ? {
                        consideredRoutes: miningFailure.consideredRoutes || 0,
                        routeOutcomes: miningFailure.routeOutcomes,
                    }
                    : {}),
                ...(miningFailure?.searchRejections
                    ? {
                        consideredStates: miningFailure.consideredStates || 0,
                        expandedStates: miningFailure.expandedStates || 0,
                        searchRejections: miningFailure.searchRejections,
                        searchLimitReached: miningFailure.searchLimitReached === true,
                    }
                    : {}),
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
            setCollectionEvidence({
                kind: 'collect',
                outcome: 'no_collectible_drop',
                target,
                retryable: false,
            });
            log(bot, `${block.name} does not provide a collectible drop with the current game data.`);
            return false;
        }
        let hasFreeSlot = bot.inventory.emptySlotCount() > 0;
        let hasPotentialStackSpace = bot.inventory.items().some(item => (
            expectedDropTypes.has(item.type)
            && Number.isFinite(item.stackSize)
            && item.count < item.stackSize
        ));
        if (
            !isLiquid
            && expectedDropTypes.size > 0
            && (
                (!hasFreeSlot && !hasPotentialStackSpace)
                || (
                    allowNaturalRouteDigging
                    && bot.inventory.emptySlotCount() < MINING_COLLECTION_SLOT_RESERVE
                )
            )
        ) {
            const protectedNames = new Set([
                blockType,
                ...blocktypes,
                ...[...expectedDropTypes].map(type => mc.getItemName(type)).filter(Boolean),
            ]);
            const desiredSlots = allowNaturalRouteDigging
                ? MINING_COLLECTION_SLOT_RESERVE
                : 1;
            const cleared = await freeCollectionWorkingSlots(bot, protectedNames, desiredSlots);
            hasFreeSlot = bot.inventory.emptySlotCount() > 0;
            hasPotentialStackSpace = bot.inventory.items().some(item => (
                expectedDropTypes.has(item.type)
                && Number.isFinite(item.stackSize)
                && item.count < item.stackSize
            ));
            if (
                !cleared
                || (!hasFreeSlot && !hasPotentialStackSpace)
                || (
                    allowNaturalRouteDigging
                    && bot.inventory.emptySlotCount() < desiredSlots
                )
            ) {
                setCollectionEvidence({
                    kind: 'collect',
                    outcome: 'inventory_full',
                    target,
                    requiredFreeSlots: desiredSlots,
                    observedFreeSlots: bot.inventory.emptySlotCount(),
                    retryable: true,
                });
                log(bot, `Cannot collect ${block.name}: inventory cannot reserve ${desiredSlots} working slot${desiredSlots === 1 ? '' : 's'} safely.`);
                return false;
            }
        }
        try {
            await equipBestToolForBlock(bot, block);
        } catch (err) {
            setCollectionEvidence({ kind: 'collect', outcome: 'missing_tool', target, error: err.message, retryable: true });
            log(bot, `Could not prepare a tool for ${block.name}: ${err.message}.`);
            return false;
        }
        if (isLiquid) {
            const bucket = bot.inventory.findInventoryItem('bucket');
            if (!bucket) {
                setCollectionEvidence({
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
            setCollectionEvidence({ kind: 'collect', outcome: 'missing_tool', target, retryable: true });
            log(bot, `Don't have right tools to harvest ${blockType}.`);
            return false;
        }
        let beforeTargetDropCount = null;
        let priorDropEntityIds = null;
        try {
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
                    setCollectionEvidence({
                        kind: 'collect',
                        outcome: navigation?.outcome || 'unreachable',
                        target,
                        ...(navigation?.progress ? { progress: navigation.progress } : {}),
                        retryable: true,
                    });
                    log(bot, `Cannot reach ${block.name} to collect it.`);
                    return false;
                }
                // Navigation may legitimately cross an older drop of the same
                // item. Start proof only after arrival so that incidental
                // pickup cannot be mistaken for the target block's drop.
                beforeTargetDropCount = inventoryCountByTypes(bot, expectedDropTypes);
                priorDropEntityIds = droppedItemEntityIds(bot);
                await runBoundedCollectionOperation(
                    bot,
                    () => bot.dig(block),
                    () => bot.stopDigging(),
                );
                const remaining = bot.blockAt(block.position);
                if (!remaining || remaining.name === block.name) {
                    setCollectionEvidence({ kind: 'collect', outcome: 'not_broken', target, retryable: true });
                    log(bot, `Could not verify that ${block.name} was collected.`);
                    return false;
                }
                if (!await waitForExpectedDropPickup(
                    bot,
                    expectedDropTypes,
                    beforeTargetDropCount,
                    { targetPosition: block.position, priorEntityIds: priorDropEntityIds },
                )) {
                    const retryDifferentTarget = retryDifferentCollectionTarget('not_collected', target);
                    setCollectionEvidence({ kind: 'collect', outcome: 'not_collected', target, retryable: true });
                    if (retryDifferentTarget) {
                        i -= 1;
                        continue;
                    }
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
                            setCollectionEvidence({
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
                                : !reached
                                    ? approachNavigation?.outcome || 'unreachable'
                                    : !miningAssessment?.safe
                                        ? miningAssessment?.code || 'no_safe_stance'
                                        : 'stance_unverified';
                            const retryDifferentTarget = retryDifferentCollectionTarget(outcome, target);
                            setCollectionEvidence({
                                kind: 'collect',
                                outcome,
                                target,
                                ...(approachNavigation?.progress ? { progress: approachNavigation.progress } : {}),
                                retryable: outcome !== 'interrupted',
                            });
                            log(bot, bot.interrupt_code
                                ? `Stopped before collecting ${block.name}.`
                                : `No verified stable stance reached ${block.name}.`);
                            if (retryDifferentTarget) {
                                i -= 1;
                                continue;
                            }
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
                            setCollectionEvidence({
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
                    // The approach can pick up existing matching items. The
                    // collection result must be measured from the settled
                    // pre-dig state, not from the start of navigation.
                    beforeTargetDropCount = inventoryCountByTypes(bot, expectedDropTypes);
                    priorDropEntityIds = droppedItemEntityIds(bot);
                    // Target selection and safe-stance proof are ours; moving,
                    // digging, and collecting the explicit target belong to
                    // Collect Block. Its movement object is target-scoped
                    // because the plugin requires canDig=true and mutates it.
                    bot.collectBlock.movements = targetScopedCollectionMovements(bot, block, {
                        allowPillars: searchOptions?.allowPillars === true,
                        allowNaturalRouteDigging,
                        requireReturnableRoute: searchOptions?.requireReturnableRoute === true,
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
                    setCollectionEvidence({
                        kind: 'collect',
                        outcome: 'interrupted',
                        target,
                        retryable: false,
                    });
                    return false;
                }
                const remaining = bot.blockAt(block.position);
                if (!remaining) {
                    setCollectionEvidence({
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
                    setCollectionEvidence({
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
                    await waitForExpectedDropPickup(
                        bot,
                        expectedDropTypes,
                        beforeTargetDropCount,
                        { targetPosition: block.position, priorEntityIds: priorDropEntityIds },
                    );
                    afterDropCount = inventoryCountByTypes(bot, expectedDropTypes);
                }
                if (expectedDropTypes.size > 0 && afterDropCount <= beforeTargetDropCount) {
                    const retryDifferentTarget = retryDifferentCollectionTarget('not_collected', target);
                    setCollectionEvidence({
                        kind: 'collect',
                        outcome: 'not_collected',
                        target,
                        beforeCount: beforeTargetDropCount,
                        afterCount: afterDropCount,
                        retryable: true,
                    });
                    log(bot, `${block.name} was broken, but its drop did not enter this bot's inventory.`);
                    if (retryDifferentTarget) {
                        i -= 1;
                        continue;
                    }
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
                setCollectionEvidence({
                    kind: 'collect',
                    outcome: 'collected',
                    target,
                    count: 1,
                    retryable: false,
                    recoveredFrom: collectionErrorOutcome(err),
                });
                log(bot, `Collected ${block.name}; reconciled the verified drop after the path helper timed out.`);
                if (bot.interrupt_code || cancellationSignal?.aborted) break;
                await autoLight(bot);
                continue;
            }
            if (err.name === 'NoChests') {
                setCollectionEvidence({ kind: 'collect', outcome: 'inventory_full', target, retryable: true });
                log(bot, `Failed to collect ${blockType}: Inventory full, no place to deposit.`);
                return false;
            }
            else {
                const outcome = collectionErrorOutcome(err);
                setCollectionEvidence({
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
    const cancelled = Boolean(bot.interrupt_code || cancellationSignal?.aborted);
    if (cancelled) {
        setCollectionEvidence({
            kind: 'collect',
            outcome: 'interrupted',
            target: lowestCollectedTarget || { name: blockType },
            count: collected,
            search: collectionSearchEvidence(bot, search),
            retryable: false,
        });
    } else if (collected > 0) {
        setCollectionEvidence({
            kind: 'collect',
            outcome: 'collected',
            target: lowestCollectedTarget || { name: blockType },
            count: collected,
            search: collectionSearchEvidence(bot, search),
            retryable: false,
        });
    } else if (bot.lastActionEvidence?.kind !== 'collect') {
        setCollectionEvidence({
            kind: 'collect',
            outcome: 'not_collected',
            target: { name: blockType },
            count: 0,
            retryable: true,
        });
    }
    log(bot, `Collected ${collected} ${blockType}.`);
    return collected > 0 && !cancelled;
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
const MAX_WHOLE_TREE_PASSES = 4;
const MAX_TEMPORARY_TREE_SCAFFOLDS = 8;
const TREE_HORIZONTAL_RADIUS = 6;
const TREE_VERTICAL_RADIUS = 32;
const TREE_SETTLEMENT_RADIUS = 6;
const MAX_TREE_SETTLEMENT_STANCES = 24;
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

function ownedTemporaryScaffoldMatches(scaffold, block) {
    if (!scaffold?.itemName || !block?.position) return false;
    if (block.name === scaffold.itemName) return true;
    // Exposed placed dirt may naturally spread into grass or mycelium before
    // a long tree transaction finishes. The exact placement coordinate is
    // still authoritative; accepting only these vanilla transformations lets
    // cleanup reclaim its own block without broadening into nearby terrain.
    return scaffold.itemName === 'dirt'
        && ['grass_block', 'mycelium'].includes(block.name);
}

export function treeScaffoldPositionAuthorized(tree, position) {
    if (!position || !Array.isArray(tree?.logs)) return false;
    // A temporary tree scaffold may occupy only a voxel that belonged to the
    // exact natural component before this action removed it. This gives native
    // Pathfinder a narrow vertical corridor without granting construction
    // authority anywhere else in the forest or player worksite.
    return tree.logs.some(log => (
        log?.position?.x === position.x
        && log.position.y === position.y
        && log.position.z === position.z
    ));
}

function treeCanopyBlock(name) {
    return String(name || '').endsWith('_leaves')
        || ['nether_wart_block', 'warped_wart_block', 'shroomlight'].includes(name);
}

function discoverNaturalTree(bot, seedBlock, exclusions=null) {
    if (!seedBlock?.position || !WOOD_BLOCK_TYPES.includes(seedBlock.name)) {
        return { natural: false, logs: seedBlock ? [seedBlock] : [], base: null, truncated: false };
    }
    const seed = seedBlock.position;
    const queue = [seed.clone()];
    const queued = new Set([blockPositionKey(seed)]);
    const logs = [];
    while (queue.length > 0 && logs.length < MAX_TREE_LOGS) {
        const position = queue.shift();
        const block = bot.blockAt(position);
        if (!block?.position || block.name !== seedBlock.name) continue;
        if (collectionPositionExcluded(block.position, exclusions)) continue;
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
    if (logs.length === 0) {
        return { natural: false, logs: [seedBlock], base: seedBlock.position, truncated: false };
    }

    // Reaching the cap is not itself proof of truncation because the queue also
    // contains neighboring air and leaves. A queued same-type log proves that
    // the connected component extends beyond the bounded discovery result.
    const truncated = logs.length >= MAX_TREE_LOGS && queue.some(position => {
        const block = bot.blockAt(position);
        return Boolean(
            block?.position
            && block.name === seedBlock.name
            && !collectionPositionExcluded(block.position, exclusions)
            && Math.abs(block.position.x - seed.x) <= TREE_HORIZONTAL_RADIUS
            && Math.abs(block.position.z - seed.z) <= TREE_HORIZONTAL_RADIUS
            && Math.abs(block.position.y - seed.y) <= TREE_VERTICAL_RADIUS
        );
    });

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
        return { natural: false, logs: [seedBlock], base: seedBlock.position, truncated: false };
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
    return { natural: true, logs, base, truncated };
}

function carriedLogCount(bot, woodTypes=null) {
    return bot.inventory.items().reduce((total, item) => (
        /_(?:log|stem)$/.test(String(item?.name || ''))
            && (!(woodTypes instanceof Set) || woodTypes.has(item.name))
            ? total + Math.max(0, Number(item.count) || 0)
            : total
    ), 0);
}

export function treeSettlementStances(bot, tree, placedScaffolds=[]) {
    const base = tree?.base;
    if (!base?.offset || typeof bot?.blockAt !== 'function') return [];
    const placedSupportKeys = new Set([...placedScaffolds]
        .map(scaffold => scaffold?.position || scaffold)
        .filter(position => position?.offset)
        .map(blockPositionKey));
    const current = bot.entity?.position;
    const currentY = Number(current?.y);
    const minY = base.y - TREE_SETTLEMENT_RADIUS;
    const maxY = Math.max(
        base.y + TREE_SETTLEMENT_RADIUS,
        Number.isFinite(currentY) ? Math.ceil(currentY) + 2 : base.y,
    );
    const candidates = [];
    const candidateKeys = new Set();

    for (let distance = 0; distance <= TREE_SETTLEMENT_RADIUS; distance += 1) {
        for (let dx = -distance; dx <= distance; dx += 1) {
            for (let dz = -distance; dz <= distance; dz += 1) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) !== distance) continue;
                const stance = loadedSurfaceStandingCell(
                    bot,
                    base.x + dx,
                    base.z + dz,
                    minY,
                    maxY,
                );
                if (!stance) continue;
                const support = bot.blockAt(stance.offset(0, -1, 0));
                if (
                    !NATURAL_FILL_BLOCKS.has(String(support?.name || ''))
                    || placedSupportKeys.has(blockPositionKey(support.position))
                ) continue;
                const key = blockPositionKey(stance);
                if (candidateKeys.has(key)) continue;
                candidateKeys.add(key);
                candidates.push(stance);
            }
        }
    }

    return candidates
        .sort((left, right) => (
            (current?.distanceTo(left) ?? Number.POSITIVE_INFINITY)
                - (current?.distanceTo(right) ?? Number.POSITIVE_INFINITY)
            || left.distanceTo(base) - right.distanceTo(base)
            || left.y - right.y
            || left.x - right.x
            || left.z - right.z
        ))
        .slice(0, MAX_TREE_SETTLEMENT_STANCES);
}

export function assessTreeScaffoldDescentStep(bot, placedScaffolds=[]) {
    const scaffolds = [...placedScaffolds]
        .filter(scaffold => scaffold?.position?.offset && scaffold?.itemName);
    const feet = observedSupportedStandingCell(bot);
    if (!feet) return { ok: false, outcome: 'tree_scaffold_body_unsettled' };

    const supportPosition = feet.offset(0, -1, 0);
    const supportBlock = bot.blockAt(supportPosition);
    const ownedSupport = scaffolds.find(scaffold => (
        blockPositionKey(scaffold.position) === blockPositionKey(supportPosition)
        && ownedTemporaryScaffoldMatches(scaffold, supportBlock)
    ));
    if (!ownedSupport) {
        return { ok: false, outcome: 'tree_scaffold_not_supporting_body' };
    }

    const landingSupportPosition = supportPosition.offset(0, -1, 0);
    const landingSupport = bot.blockAt(landingSupportPosition);
    const ownedLandingSupport = scaffolds.some(scaffold => (
        blockPositionKey(scaffold.position) === blockPositionKey(landingSupportPosition)
        && ownedTemporaryScaffoldMatches(scaffold, landingSupport)
    ));
    if (
        !landingSupport
        || isLiquidGameplayBlock(landingSupport)
        || isHazardousGameplayBlock(landingSupport)
        || isFallingGameplayBlock(landingSupport)
        || (!ownedLandingSupport && !isAnchoredGameplaySupport(bot, landingSupport))
    ) {
        return {
            ok: false,
            outcome: 'tree_scaffold_landing_unsafe',
            target: supportPosition,
            observed: landingSupport?.name || 'unloaded',
        };
    }

    const adjacentLiquid = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .map(([dx, dz]) => bot.blockAt(supportPosition.offset(dx, 0, dz)))
        .find(isLiquidGameplayBlock);
    if (adjacentLiquid) {
        return {
            ok: false,
            outcome: 'tree_scaffold_landing_liquid',
            target: supportPosition,
            observed: adjacentLiquid.name,
        };
    }

    return {
        ok: true,
        outcome: 'tree_scaffold_descent_ready',
        target: supportPosition,
        expectedFeet: supportPosition.clone(),
        landingSupport: landingSupportPosition,
        landingKind: ownedLandingSupport ? 'owned_scaffold' : 'natural_terrain',
    };
}

async function reclaimSupportingTreeScaffolds(bot, placedScaffolds) {
    const scaffolds = [...placedScaffolds]
        .filter(scaffold => scaffold?.position?.offset && scaffold?.itemName)
        .slice(0, MAX_TEMPORARY_TREE_SCAFFOLDS);
    let reclaimed = 0;
    while (reclaimed < scaffolds.length && !bot.interrupt_code) {
        const step = assessTreeScaffoldDescentStep(bot, scaffolds);
        if (step.outcome === 'tree_scaffold_not_supporting_body') {
            return { complete: true, outcome: 'tree_scaffold_descent_complete', reclaimed };
        }
        if (!step.ok) return { complete: false, ...step, reclaimed };

        if (!await breakBlockAt(
            bot,
            step.target.x,
            step.target.y,
            step.target.z,
            { requireHarvest: false },
        )) {
            return {
                complete: false,
                outcome: bot.interrupt_code ? 'interrupted' : 'tree_scaffold_break_failed',
                target: step.target,
                reclaimed,
            };
        }
        const landed = await waitForWorldCondition(
            bot,
            () => physicallyOccupiesStandingCell(bot, step.expectedFeet),
            GROUND_SETTLE_TIMEOUT_MS,
            25,
        );
        if (!landed) {
            return {
                complete: false,
                outcome: bot.interrupt_code ? 'interrupted' : 'tree_scaffold_descent_unverified',
                target: step.target,
                reclaimed,
            };
        }
        reclaimed += 1;
    }
    const pending = assessTreeScaffoldDescentStep(bot, scaffolds);
    return pending.outcome === 'tree_scaffold_not_supporting_body'
        ? { complete: true, outcome: 'tree_scaffold_descent_complete', reclaimed }
        : { complete: false, ...pending, reclaimed };
}

function pendingOwnedTreeScaffolds(bot, placedScaffolds) {
    return [...placedScaffolds]
        .filter(scaffold => scaffold?.position?.offset && scaffold?.itemName)
        .map(scaffold => ({
            scaffold,
            block: bot.blockAt(scaffold.position),
        }))
        .filter(({ scaffold, block }) => ownedTemporaryScaffoldMatches(scaffold, block))
        .sort((left, right) => (
            right.block.position.y - left.block.position.y
            || left.block.position.x - right.block.position.x
            || left.block.position.z - right.block.position.z
        ));
}

async function reclaimDetachedTreeScaffolds(bot, tree, placedScaffolds) {
    const scaffolds = [...placedScaffolds]
        .filter(scaffold => scaffold?.position?.offset && scaffold?.itemName)
        .slice(0, MAX_TEMPORARY_TREE_SCAFFOLDS);
    let reclaimed = 0;
    while (reclaimed < scaffolds.length && !bot.interrupt_code) {
        const pending = pendingOwnedTreeScaffolds(bot, scaffolds);
        if (pending.length === 0) {
            return { complete: true, outcome: 'tree_scaffold_cleanup_complete', reclaimed };
        }

        // CollectBlock is authoritative for reaching and breaking the exact
        // placed block, but it receives only one target. A bulk queue lets its
        // nearest-target heuristic break a pillar base before its top. The
        // tree transaction instead binds the highest remaining owned cell and
        // verifies its removal before selecting the next one.
        const target = pending[0].block;
        bot.collectBlock.movements = targetScopedCollectionMovements(bot, [target], {
            allowPillars: false,
        });
        let collectionError = null;
        try {
            await runBoundedCollectionOperation(
                bot,
                () => bot.collectBlock.collect([target], {
                    ignoreNoPath: true,
                    targetTimeoutMs: 5_000,
                    targetStallTimeoutMs: 2_000,
                    maxTargetFailures: 1,
                }),
                () => bot.collectBlock.cancelTask(),
            );
        } catch (error) {
            collectionError = error;
        }
        const live = bot.blockAt(pending[0].scaffold.position);
        if (ownedTemporaryScaffoldMatches(pending[0].scaffold, live)) {
            return {
                complete: false,
                outcome: bot.interrupt_code ? 'interrupted' : 'tree_scaffold_cleanup_failed',
                reclaimed,
                target: pending[0].scaffold.position,
                error: collectionError,
            };
        }
        reclaimed += 1;

        // Reaching one target may move the body back into the changing
        // canopy. Re-establish a verified natural stance before binding the
        // next exact cleanup target.
        const settlement = await settleTreeTransactionOnTerrain(bot, tree, scaffolds);
        if (!settlement.settled) {
            return {
                complete: false,
                outcome: settlement.outcome,
                reclaimed,
                target: pending[0].scaffold.position,
            };
        }
    }
    const pending = pendingOwnedTreeScaffolds(bot, scaffolds);
    return pending.length === 0
        ? { complete: true, outcome: 'tree_scaffold_cleanup_complete', reclaimed }
        : {
            complete: false,
            outcome: bot.interrupt_code ? 'interrupted' : 'tree_scaffold_cleanup_bounded',
            reclaimed,
            target: pending[0].scaffold.position,
        };
}

async function settleTreeTransactionOnTerrain(bot, tree, placedScaffolds) {
    const stances = treeSettlementStances(bot, tree, placedScaffolds);
    if (stances.length === 0) {
        return { settled: false, outcome: 'tree_terrain_stance_unavailable', target: null };
    }
    let settled = isAtCollectionStance(bot, stances);
    if (!settled && !bot.interrupt_code) {
        const reached = await goToGoal(bot, collectionApproachGoal(stances), {
            // This is ordinary locomotion away from an owned temporary
            // pillar, not traversal through a preflighted mining corridor.
            // The corridor policy deliberately caps drops at one block; using
            // it here erased Pathfinder's native, damage-free route from the
            // top of a short tree scaffold to nearby terrain.
            movements: () => safeMovements(bot),
            allowHealthBoundedDescent: false,
            // The collector may finish inside the exact tree's changing
            // canopy. The shared navigation primitive owns one bounded local
            // foliage escape, then native Pathfinder retries the same verified
            // terrain stance. Without it, an ordinary leaf collision turns a
            // completed tree into a false permanent settlement failure.
            allowLocalRecovery: true,
        });
        settled = Boolean(reached && isAtCollectionStance(bot, stances));
    }
    const target = stances.find(stance => physicallyOccupiesStandingCell(bot, stance)) || null;
    return {
        settled,
        outcome: settled ? 'tree_terrain_settled' : 'tree_terrain_settlement_unverified',
        target,
    };
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

function validCollectionExclusion(exclusion) {
    if (!exclusion || typeof exclusion !== 'object') return false;
    const isBox = [
        exclusion.minX,
        exclusion.maxX,
        exclusion.minY,
        exclusion.maxY,
        exclusion.minZ,
        exclusion.maxZ,
    ].every(Number.isFinite);
    return isBox || [exclusion.x, exclusion.y, exclusion.z].every(Number.isFinite);
}

function normalizeCollectionExclusions(exclusions) {
    return Array.isArray(exclusions)
        ? exclusions.filter(validCollectionExclusion)
        : [];
}

export function collectionPositionExcluded(position, exclusions) {
    if (!position) return false;
    return (exclusions || []).some(exclusion => {
        if (!validCollectionExclusion(exclusion)) return false;
        if ([
            exclusion.minX,
            exclusion.maxX,
            exclusion.minY,
            exclusion.maxY,
            exclusion.minZ,
            exclusion.maxZ,
        ].every(Number.isFinite)) {
            return position.x >= Math.min(exclusion.minX, exclusion.maxX)
                && position.x <= Math.max(exclusion.minX, exclusion.maxX)
                && position.y >= Math.min(exclusion.minY, exclusion.maxY)
                && position.y <= Math.max(exclusion.minY, exclusion.maxY)
                && position.z >= Math.min(exclusion.minZ, exclusion.maxZ)
                && position.z <= Math.max(exclusion.minZ, exclusion.maxZ);
        }
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
    // Probe with the same no-pillar locomotion policy used by the eventual
    // CollectBlock tree queue. An empty target set keeps route excavation
    // disabled during selection; execution may additionally break only the
    // explicitly bound tree targets.
    const routeMovements = targetScopedCollectionMovements(bot, [], {
        allowPillars: false,
    });
    return { blocks, selection: selectCollectionCandidate(bot, blocks, routeMovements) };
}

export function findNearestCollectibleBlock(bot, blockTypes, range=64, exclude=null) {
    return findCollectibleBlockSelection(bot, blockTypes, range, exclude)
        .selection.selected?.block || null;
}

async function collectDiscoveredTree(bot, tree, woodTypes, maximumLogs = Number.POSITIVE_INFINITY, {
    completeStartedTree = false,
    placementExclusions = null,
} = {}) {
    const before = carriedLogCount(bot, woodTypes);
    const ordered = [...(tree?.logs || [])]
        .sort((left, right) => left.position.y - right.position.y);
    const limit = Number.isFinite(maximumLogs)
        ? Math.max(0, Math.floor(maximumLogs))
        : ordered.length;
    let targets = ordered
        .map(block => bot.blockAt(block.position))
        .filter(block => block?.position && woodTypes.has(block.name));
    if (targets.length === 0) {
        return {
            count: 0,
            remaining: [],
            error: null,
            passes: 0,
            settledOnTerrain: true,
            settlementOutcome: 'tree_not_started',
            settlementTarget: null,
            scaffoldsPlaced: 0,
            scaffoldsReclaimed: 0,
            remainingScaffolds: [],
        };
    }

    let operationError = null;
    let passes = 0;
    let accessRecoveryUsed = false;
    const placedScaffolds = new Map();
    let scaffoldCleanup = { placed: 0, reclaimed: 0, remaining: [] };
    let settlement = { settled: false, outcome: 'tree_terrain_settlement_pending', target: null };
    bot.modes.pause('unstuck');
    bot.modes.pause('elbow_room');
    try {
        while (
            targets.length > 0
            && passes < (completeStartedTree ? MAX_WHOLE_TREE_PASSES + 1 : 1)
        ) {
            const targetCountBeforePass = targets.length;
            // CollectBlock owns native locomotion, exact target breaking, drop
            // pursuit, and settled cancellation. A complete-tree caller may
            // submit the freshly changed remainder again only after this pass
            // removed at least one real log; that is monotonic geometry
            // convergence, not an identical retry.
            bot.collectBlock.movements = targetScopedCollectionMovements(bot, targets, {
                allowPillars: completeStartedTree,
                maxScaffoldingPlacements: Math.max(
                    0,
                    MAX_TEMPORARY_TREE_SCAFFOLDS - placedScaffolds.size,
                ),
                placementExclusions,
                // The verified natural trunk owns only its immediately
                // attached canopy. Ordinary navigation still cannot clear
                // foliage, and distant/player landscaping remains outside
                // this exact tree transaction.
                additionalSafeToBreak: candidate => (
                    treeCanopyBlock(candidate?.name)
                    && !collectionPositionExcluded(candidate?.position, placementExclusions)
                    && isEnvironmentallySafeToClear(bot, candidate)
                    && tree.logs.some(log => (
                        Math.abs(log.position.x - candidate.position.x) <= 2
                        && Math.abs(log.position.y - candidate.position.y) <= 2
                        && Math.abs(log.position.z - candidate.position.z) <= 2
                    ))
                ),
                onBlockPlaced: placement => {
                    if (!placement?.position || !placement.itemName) return;
                    placedScaffolds.set(blockPositionKey(placement.position), {
                        position: placement.position.clone(),
                        itemName: placement.itemName,
                    });
                },
                placementAuthorizer: position => treeScaffoldPositionAuthorized(tree, position),
            });
            try {
                await runBoundedCollectionOperation(
                    bot,
                    () => bot.collectBlock.collect(targets, {
                        ignoreNoPath: true,
                        targetTimeoutMs: 8_000,
                        targetStallTimeoutMs: 3_000,
                        deferDropPickupUntilBlocksComplete: completeStartedTree,
                        isSatisfied: () => !completeStartedTree
                            && carriedLogCount(bot, woodTypes) - before >= limit,
                        maxTargetFailures: Math.min(2, targets.length),
                    }),
                    () => bot.collectBlock.cancelTask(),
                );
            } catch (error) {
                operationError = error;
            }
            passes += 1;
            targets = ordered
                .map(block => bot.blockAt(block.position))
                .filter(block => block?.position && woodTypes.has(block.name));
            if (!completeStartedTree || targets.length === 0 || bot.interrupt_code) break;
            if (targets.length >= targetCountBeforePass) {
                // A no-progress pass after the tree changed most often means
                // the body is wedged in its canopy, not that the remaining
                // connected logs require a new strategy. Permit one shared,
                // bounded foliage escape and then resubmit only the verified
                // remainder. A second identical signature ends the action.
                if (!accessRecoveryUsed && passes <= MAX_WHOLE_TREE_PASSES) {
                    accessRecoveryUsed = true;
                    const recovery = await attemptLocalNavigationEscape(bot);
                    if (recovery.success) continue;
                }
                break;
            }
        }
        if (!bot.interrupt_code && placedScaffolds.size > 0) {
            // A tree pillar is an exact, bounded construction transaction.
            // Reclaim its supporting cells from the top down while descending
            // one verified block at a time. Giving the whole column to a
            // nearest-target collector lets it break the base first, turning
            // the remaining cleanup into falling debris or body support.
            const descent = await reclaimSupportingTreeScaffolds(
                bot,
                placedScaffolds.values(),
            );
            if (!descent.complete && !operationError) {
                operationError = new Error(`Tree scaffold descent failed: ${descent.outcome}.`);
                operationError.name = 'TreeScaffoldDescentUnverified';
            }
        }
        if (!bot.interrupt_code) {
            // Tree completion owns a usable body stance as well as the log
            // delta. Move off the exact temporary trunk/pillar while it still
            // exists, using native Pathfinder through already-clear space.
            // Cleanup can then reclaim the support without asking the bot to
            // mine the block it is standing on.
            settlement = await settleTreeTransactionOnTerrain(
                bot,
                tree,
                placedScaffolds.values(),
            );
            if (!settlement.settled && !operationError) {
                operationError = new Error('Tree collection could not settle on verified nearby terrain.');
                operationError.name = 'TreeSettlementUnverified';
            }
        }
        if (placedScaffolds.size > 0 && !bot.interrupt_code && settlement.settled) {
            const cleanup = await reclaimDetachedTreeScaffolds(
                bot,
                tree,
                placedScaffolds.values(),
            );
            if (!cleanup.complete && !operationError) {
                operationError = cleanup.error
                    || new Error(`Tree scaffold cleanup failed: ${cleanup.outcome}.`);
            }
            const remaining = [...placedScaffolds.values()].filter(scaffold => {
                const block = bot.blockAt(scaffold.position);
                return ownedTemporaryScaffoldMatches(scaffold, block);
            });
            scaffoldCleanup = {
                placed: placedScaffolds.size,
                reclaimed: placedScaffolds.size - remaining.length,
                remaining,
            };
            // Breaking the owned pillar is not sufficient if target pursuit
            // climbed back into foliage. Re-verify the same terrain contract
            // before releasing the tree transaction.
            settlement = await settleTreeTransactionOnTerrain(
                bot,
                tree,
                placedScaffolds.values(),
            );
            if (!settlement.settled && !operationError) {
                operationError = new Error('Tree cleanup did not settle on verified nearby terrain.');
                operationError.name = 'TreeSettlementUnverified';
            }
            log(
                bot,
                `Reclaimed ${scaffoldCleanup.reclaimed}/${scaffoldCleanup.placed} temporary tree scaffold block(s).`,
            );
            if (remaining.length > 0 && !operationError) {
                operationError = new Error(`Failed to reclaim ${remaining.length} temporary tree scaffold block(s).`);
            }
        } else if (placedScaffolds.size > 0) {
            scaffoldCleanup = {
                placed: placedScaffolds.size,
                reclaimed: 0,
                remaining: [...placedScaffolds.values()],
            };
        }
    } finally {
        const routeMovements = safeMovements(bot);
        bot.collectBlock.movements = routeMovements;
        bot.pathfinder.setMovements(routeMovements);
        bot.modes.unpause('unstuck');
        bot.modes.unpause('elbow_room');
    }

    const remaining = ordered.filter(block => {
        const live = bot.blockAt(block.position);
        return live?.position && woodTypes.has(live.name);
    });
    return {
        count: Math.max(0, carriedLogCount(bot, woodTypes) - before),
        remaining,
        error: operationError,
        passes,
        settledOnTerrain: settlement.settled,
        settlementOutcome: settlement.outcome,
        settlementTarget: settlement.target,
        scaffoldsPlaced: scaffoldCleanup.placed,
        scaffoldsReclaimed: scaffoldCleanup.reclaimed,
        remainingScaffolds: scaffoldCleanup.remaining,
    };
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
    const completeStartedTree = searchOptions?.completeStartedTree === true;
    const target = Math.max(1, Math.min(64, Number(num) || 1));
    const searchRange = Math.max(1, Math.min(512, Math.floor(Number(range) || 64)));
    const search = createCollectionSearch(bot, searchRange, searchOptions);
    const failedTargets = normalizeCollectionExclusions(exclude);
    let collected = 0;
    let stumpTarget = null;
    let completeTrees = 0;
    let temporaryScaffoldsPlaced = 0;
    let temporaryScaffoldsReclaimed = 0;

    // `num` remains the physical bound for recipe and GoalDirector collection.
    // A lumberjack work order may explicitly add the stronger stewardship
    // contract: once it starts a bounded natural tree, finish that component.
    while (collected < target && !bot.interrupt_code) {
        let nearest = null;

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
                const tree = discoverNaturalTree(bot, nearest, failedTargets);
                if (tree.natural) {
                    if (completeStartedTree && tree.truncated) {
                        const oversizedTarget = {
                            name: nearest.name,
                            x: tree.base.x,
                            y: tree.base.y,
                            z: tree.base.z,
                        };
                        setActionEvidence(bot, {
                            kind: 'collect',
                            outcome: 'tree_component_limit',
                            target: oversizedTarget,
                            discoveredLogs: tree.logs.length,
                            retryable: false,
                        });
                        log(bot, `The connected ${nearest.name} component exceeds the ${MAX_TREE_LOGS}-log safety bound; it was left intact.`);
                        return false;
                    }
                    if (
                        !hasInventoryRoomFor(bot, nearest.name)
                        && !await freeCollectionWorkingSlots(bot, woodTypes)
                    ) {
                        setActionEvidence(bot, {
                            kind: 'collect',
                            outcome: 'inventory_full',
                            target: {
                                name: nearest.name,
                                x: tree.base.x,
                                y: tree.base.y,
                                z: tree.base.z,
                            },
                            retryable: true,
                        });
                        log(bot, `Cannot collect ${nearest.name}: inventory has no safe working slot.`);
                        break;
                    }
                    stumpTarget = {
                        name: nearest.name,
                        x: tree.base.x,
                        y: tree.base.y,
                        z: tree.base.z,
                    };
                    log(bot, `Collecting a bounded ${tree.logs[0].name.replace('_log', '').replace('_stem', '')} tree queue with ${tree.logs.length} loaded logs.`);
                    const harvested = await collectDiscoveredTree(
                        bot,
                        tree,
                        woodTypes,
                        completeStartedTree
                            ? Number.POSITIVE_INFINITY
                            : Math.max(1, target - collected),
                        { completeStartedTree, placementExclusions: failedTargets },
                    );
                    collected += harvested.count;
                    temporaryScaffoldsPlaced += harvested.scaffoldsPlaced;
                    temporaryScaffoldsReclaimed += harvested.scaffoldsReclaimed;
                    if (bot.interrupt_code) {
                        setActionEvidence(bot, {
                            kind: 'collect',
                            outcome: 'interrupted',
                            target: stumpTarget,
                            count: harvested.count,
                            remainingCount: harvested.remaining.length,
                            retryable: false,
                        });
                        log(bot, `Tree harvesting stopped after collecting ${harvested.count} log${harvested.count === 1 ? '' : 's'} from the active tree.`);
                        return false;
                    }
                    if (harvested.count > 0 && harvested.remaining.length === 0) {
                        completeTrees += 1;
                    }
                    if (harvested.remainingScaffolds.length > 0 && !bot.interrupt_code) {
                        setActionEvidence(bot, {
                            kind: 'collect',
                            outcome: 'tree_cleanup_incomplete',
                            completionBlocked: true,
                            target: stumpTarget,
                            count: harvested.count,
                            scaffoldsPlaced: harvested.scaffoldsPlaced,
                            scaffoldsReclaimed: harvested.scaffoldsReclaimed,
                            remainingTargets: harvested.remainingScaffolds.map(scaffold => ({
                                name: scaffold.itemName,
                                x: scaffold.position.x,
                                y: scaffold.position.y,
                                z: scaffold.position.z,
                            })),
                            retryable: false,
                        });
                        log(bot, `Stopped because ${harvested.remainingScaffolds.length} temporary tree scaffold block(s) could not be reclaimed.`);
                        return false;
                    }
                    if (!harvested.settledOnTerrain && !bot.interrupt_code) {
                        setActionEvidence(bot, {
                            kind: 'collect',
                            outcome: harvested.settlementOutcome || 'tree_terrain_settlement_unverified',
                            completionBlocked: true,
                            target: stumpTarget,
                            count: harvested.count,
                            remainingCount: harvested.remaining.length,
                            scaffoldsPlaced: harvested.scaffoldsPlaced,
                            scaffoldsReclaimed: harvested.scaffoldsReclaimed,
                            retryable: false,
                        });
                        log(bot, 'Stopped because the completed tree transaction did not settle on verified nearby terrain.');
                        return false;
                    }
                    if (completeStartedTree && harvested.remaining.length > 0) {
                        setActionEvidence(bot, {
                            kind: 'collect',
                            outcome: 'tree_incomplete',
                            completionBlocked: true,
                            target: stumpTarget,
                            count: harvested.count,
                            remainingCount: harvested.remaining.length,
                            remainingTargets: harvested.remaining.slice(0, 24).map(block => ({
                                name: block.name,
                                x: block.position.x,
                                y: block.position.y,
                                z: block.position.z,
                            })),
                            passes: harvested.passes,
                            ...(harvested.error ? {
                                error: String(harvested.error?.message || harvested.error).slice(0, 240),
                            } : {}),
                            retryable: false,
                        });
                        log(
                            bot,
                            `Stopped after ${harvested.passes} monotonic tree pass${harvested.passes === 1 ? '' : 'es'}; `
                                + `${harvested.remaining.length} connected ${nearest.name} remain unreachable without unauthorized building or excavation.`,
                        );
                        return false;
                    }
                    if (collected >= target) continue;
                    if (bot.interrupt_code) break;
                    if (harvested.count > 0) {
                        // The requested collection action owns the whole
                        // quantity, not merely one tree. Preserve real partial
                        // progress, exclude any uncollected remainder from
                        // this candidate, and continue with another tree in
                        // the same ActionManager lease.
                        failedTargets.push(...harvested.remaining.map(block => ({
                            x: block.position.x,
                            y: block.position.y,
                            z: block.position.z,
                        })));
                        search.candidateFailures = 0;
                        continue;
                    }

                    const failureTarget = {
                        name: nearest.name,
                        x: tree.base.x,
                        y: tree.base.y,
                        z: tree.base.z,
                    };
                    const outcome = harvested.error
                        ? collectionErrorOutcome(harvested.error)
                        : 'not_collected';
                    setActionEvidence(bot, {
                        kind: 'collect',
                        outcome,
                        target: failureTarget,
                        ...(harvested.error ? {
                            error: String(harvested.error?.message || harvested.error).slice(0, 240),
                        } : {}),
                        retryable: true,
                    });
                    failedTargets.push(...tree.logs.map(block => ({
                        x: block.position.x,
                        y: block.position.y,
                        z: block.position.z,
                    })));
                    search.candidateFailures = (search.candidateFailures || 0) + 1;
                    log(bot, `The native tree queue made no inventory progress (${outcome}); selecting another tree.`);
                    if (search.candidateFailures <= MAX_COLLECTION_TARGET_FAILURES) continue;
                    break;
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
                const surfaceAccessRequired = Boolean(
                    !occupiedOpenSurfaceStandingCell(bot)
                    && candidates?.blocks?.some(block => (
                        String(block?.name || '').endsWith('_log')
                        && Number(block?.position?.y) >= Number(bot.entity?.position?.y) + 4
                    )),
                );
                setActionEvidence(bot, {
                    kind: 'collect',
                    outcome: candidates?.blocks.length > 0 ? 'unreachable' : 'resource_not_found',
                    target: search.lastAccessRecoveryTarget || { name: 'wood' },
                    count: 0,
                    search: collectionSearchEvidence(bot, search),
                    ...(surfaceAccessRequired ? {
                        accessRequirement: { kind: 'surface' },
                    } : {}),
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
                allowPillars: false,
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
                && (search.candidateFailures || 0) < MAX_COLLECTION_TARGET_FAILURES
            );
            if (retryAnotherTarget) {
                failedTargets.push({
                    x: failedTarget.x,
                    y: failedTarget.y,
                    z: failedTarget.z,
                });
                search.candidateFailures = (search.candidateFailures || 0) + 1;
                log(
                    bot,
                    `Skipping the blocked tree at ${failedTarget.x}, ${failedTarget.y}, ${failedTarget.z}; `
                        + `trying another safe candidate (${search.candidateFailures}/${MAX_COLLECTION_TARGET_FAILURES}).`,
                );
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
    }

    if (collected > 0) {
        setActionEvidence(bot, {
            kind: 'collect',
            outcome: 'collected',
            target: stumpTarget || { name: 'wood' },
            count: collected,
            completeTrees,
            temporaryScaffoldsPlaced,
            temporaryScaffoldsReclaimed,
            search: collectionSearchEvidence(bot, search),
            retryable: false,
        });
    }
    log(bot, completeTrees > 0
        ? `Wood collection finished with ${collected} logs from ${completeTrees} complete tree${completeTrees === 1 ? '' : 's'}.`
        : `Wood collection finished with ${collected} logs.`);
    return collected > 0;
}

function droppedItemCandidates(bot, range, itemFilter = () => true) {
    const candidates = [];
    for (const entity of Object.values(bot.entities || {})) {
        if (
            entity?.name !== 'item'
            || isIgnoredPickupEntity(bot, entity)
            || !entity.position
            || !bot.entity?.position
        ) continue;
        const distance = bot.entity.position.distanceTo(entity.position);
        if (distance > range) continue;
        let item;
        try {
            item = entity.getDroppedItem?.();
        } catch {
            continue;
        }
        if (!item?.name || !itemFilter(item, entity)) continue;
        candidates.push({
            entity,
            item,
            distance,
            target: {
                name: item.name,
                id: entity.id,
                x: entity.position.x,
                y: entity.position.y,
                z: entity.position.z,
            },
        });
    }
    return candidates
        .sort((left, right) => left.distance - right.distance)
        .slice(0, MAX_PICKUP_QUEUE_TARGETS);
}

async function collectDroppedItemQueue(bot, candidates, {
    kind,
    requireAll = false,
    successMessage,
}) {
    const beforeCounts = new Map();
    let requestedCount = 0;
    for (const candidate of candidates) {
        if (!beforeCounts.has(candidate.item.name)) {
            beforeCounts.set(candidate.item.name, inventoryCount(bot, candidate.item.name));
        }
        requestedCount += Math.max(1, Number(candidate.item.count) || 1);
    }

    let firstFailure = null;
    const onTargetFailed = (entity, error) => {
        if (firstFailure) return;
        const candidate = candidates.find(entry => entry.entity?.id === entity?.id);
        firstFailure = {
            outcome: collectionErrorOutcome(error),
            target: candidate?.target || {
                name: entity?.displayName || entity?.name || 'item',
                id: entity?.id,
                x: entity?.position?.x,
                y: entity?.position?.y,
                z: entity?.position?.z,
            },
            error: String(error?.message || error).slice(0, 240),
        };
    };

    bot.on('collectBlock_targetFailed', onTargetFailed);
    try {
        const movements = safeMovements(bot);
        movements.canDig = false;
        movements.allow1by1towers = false;
        bot.collectBlock.movements = movements;
        await runBoundedCollectionOperation(
            bot,
            () => bot.collectBlock.collect(
                candidates.map(candidate => candidate.entity),
                {
                    ignoreNoPath: true,
                    maxTargetFailures: MAX_PICKUP_TARGET_FAILURES,
                    targetTimeoutMs: PICKUP_TARGET_TIMEOUT_MS,
                    targetStallTimeoutMs: PICKUP_TARGET_STALL_TIMEOUT_MS,
                    isSatisfied: () => Boolean(bot.interrupt_code),
                },
            ),
            () => bot.collectBlock.cancelTask(),
        );
    } catch (error) {
        if (!firstFailure) {
            firstFailure = {
                outcome: collectionErrorOutcome(error),
                target: candidates[0]?.target || null,
                error: String(error?.message || error).slice(0, 240),
            };
        }
    } finally {
        bot.removeListener('collectBlock_targetFailed', onTargetFailed);
        const movements = safeMovements(bot);
        bot.collectBlock.movements = movements;
        bot.pathfinder.setMovements(movements);
    }

    let pickedUp = 0;
    for (const [itemName, before] of beforeCounts) {
        pickedUp += Math.max(0, inventoryCount(bot, itemName) - before);
    }
    if (bot.interrupt_code || actionCancellationSignal()?.aborted) {
        setActionEvidence(bot, {
            kind,
            outcome: 'interrupted',
            target: firstFailure?.target || candidates[0]?.target || null,
            count: pickedUp,
            requested: requestedCount,
            retryable: false,
        });
        return false;
    }

    const complete = pickedUp >= requestedCount;
    if (pickedUp > 0 && (!requireAll || complete)) {
        setActionEvidence(bot, {
            kind,
            outcome: complete ? 'picked_up' : 'partially_picked_up',
            count: pickedUp,
            requested: requestedCount,
            targets: candidates.length,
            ...(firstFailure ? { targetFailure: firstFailure } : {}),
            retryable: false,
        });
        log(bot, successMessage(pickedUp));
        return true;
    }

    const outcome = pickedUp > 0
        ? 'partial_pickup'
        : firstFailure?.outcome || 'not_collected';
    setActionEvidence(bot, {
        kind,
        outcome,
        target: firstFailure?.target || candidates[0]?.target || null,
        count: pickedUp,
        requested: requestedCount,
        targets: candidates.length,
        ...(firstFailure?.error ? { error: firstFailure.error } : {}),
        retryable: true,
    });
    log(bot, pickedUp > 0
        ? `Picked up ${pickedUp} of ${requestedCount} nearby item units before the queue stopped.`
        : `Could not pick up the nearby ${firstFailure?.target?.name || 'item'} queue.`);
    return false;
}

export async function pickupNearbyItems(bot) {
    /**
     * Pick up all nearby items.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the items were picked up, false otherwise.
     * @example
     * await skills.pickupNearbyItems(bot);
     **/
    const candidates = droppedItemCandidates(bot, 8);
    if (candidates.length === 0) {
        setActionEvidence(bot, { kind: 'pickup', outcome: 'no_items', retryable: false });
        log(bot, 'No nearby items to pick up.');
        return true;
    }
    return await collectDroppedItemQueue(bot, candidates, {
        kind: 'pickup',
        requireAll: true,
        successMessage: count => `Picked up ${count} nearby item${count === 1 ? '' : 's'}.`,
    });
}

export async function harvestMatureCrop(bot, cropName, outputName, count=1, range=64) {
    const crop = String(cropName || '').trim().toLowerCase();
    const output = String(outputName || '').trim().toLowerCase();
    const requested = Math.max(1, Math.min(64, Math.floor(Number(count) || 1)));
    const searchRange = Math.max(16, Math.min(128, Math.floor(Number(range) || 64)));
    const spec = mc.matureCropHarvestForOutput(output);
    const fail = (outcome, detail, extra = {}) => {
        setActionEvidence(bot, {
            kind: 'mature_crop_harvest',
            outcome,
            target: { name: crop },
            output,
            requested,
            ...extra,
            retryable: !['invalid_crop_contract', 'replant_failed'].includes(outcome),
        });
        log(bot, detail);
        return false;
    };
    if (!spec || spec.crop !== crop) {
        return fail('invalid_crop_contract', `${crop || 'That crop'} is not a mature renewable source of ${output || 'that item'}.`);
    }

    const beforeOutput = inventoryCount(bot, output);
    const origin = bot.entity?.position?.clone?.();
    if (!origin) return fail('position_unavailable', 'Cannot bind a crop harvest region without a current position.');
    let candidates = [];
    try {
        candidates = world.getNearestBlocksWhere(
            bot,
            block => block?.name === crop && cropAge(block) >= spec.maxAge,
            searchRange,
            Math.min(64, Math.max(8, requested * 4)),
        )
            .filter(block => block?.position && block.position.distanceTo(origin) <= searchRange)
            .sort((left, right) => (
                bot.entity.position.distanceTo(left.position)
                - bot.entity.position.distanceTo(right.position)
            ));
    } catch {
        return fail('crop_scan_failed', `Could not inspect the loaded area for mature ${crop}.`);
    }
    if (candidates.length === 0) {
        return fail('source_not_found', `No mature ${crop} is loaded within ${searchRange} blocks.`);
    }

    const pendingReplants = [];
    let harvested = 0;
    let replanted = 0;
    const replantPending = async () => {
        while (
            pendingReplants.length > 0
            && inventoryCount(bot, spec.seed) > 0
            && !bot.interrupt_code
            && !actionCancellationSignal()?.aborted
        ) {
            const soil = pendingReplants[0];
            if (!await tillAndSow(bot, soil.x, soil.y, soil.z, spec.seed)) return false;
            pendingReplants.shift();
            replanted += 1;
        }
        return true;
    };

    for (const candidate of candidates) {
        if (bot.interrupt_code || actionCancellationSignal()?.aborted) break;
        if (inventoryCount(bot, output) - beforeOutput >= requested && pendingReplants.length === 0) break;
        const current = bot.blockAt(candidate.position);
        if (current?.name !== crop || cropAge(current) < spec.maxAge) continue;
        const soil = bot.blockAt(current.position.offset(0, -1, 0));
        if (soil?.name !== 'farmland') continue;
        const cropPosition = current.position.clone();
        if (!await breakBlockAt(bot, cropPosition.x, cropPosition.y, cropPosition.z)) continue;
        harvested += 1;
        pendingReplants.push({ x: soil.position.x, y: soil.position.y, z: soil.position.z });

        await waitForWorldCondition(bot, () => (
            droppedItemCandidates(bot, 8, item => item.name === output || item.name === spec.seed).length > 0
            || inventoryCount(bot, output) > beforeOutput
        ), 1_000, 50);
        const drops = droppedItemCandidates(
            bot,
            8,
            item => item.name === output || item.name === spec.seed,
        );
        if (drops.length > 0) {
            await collectDroppedItemQueue(bot, drops, {
                kind: 'crop_pickup',
                requireAll: false,
                successMessage: picked => `Collected ${picked} crop drop${picked === 1 ? '' : 's'}.`,
            });
        }
        if (!await replantPending()) {
            return fail('replant_failed', `Harvested ${crop}, but Minecraft did not confirm the replacement crop.`, {
                harvested,
                replanted,
                pendingReplants: pendingReplants.length,
            });
        }
    }

    if (bot.interrupt_code || actionCancellationSignal()?.aborted) {
        return fail('interrupted', `Stopped after harvesting ${harvested} ${crop}.`, {
            harvested,
            replanted,
            pendingReplants: pendingReplants.length,
        });
    }
    if (!await replantPending() || pendingReplants.length > 0) {
        return fail('replant_failed', `Could not restore ${pendingReplants.length} harvested ${crop} cell(s).`, {
            harvested,
            replanted,
            pendingReplants: pendingReplants.length,
        });
    }
    const gained = Math.max(0, inventoryCount(bot, output) - beforeOutput);
    if (gained < requested) {
        return fail('insufficient_mature_yield', `Mature ${crop} yielded ${gained} of ${requested} required ${output}.`, {
            harvested,
            replanted,
            gained,
        });
    }
    setActionEvidence(bot, {
        kind: 'mature_crop_harvest',
        outcome: 'harvested_and_replanted',
        target: { name: crop },
        output,
        requested,
        gained,
        harvested,
        replanted,
        retryable: false,
    });
    log(bot, `Harvested ${gained} ${output} from ${harvested} mature ${crop} and replanted every harvested cell.`);
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
    const hostile = bot.nearestEntity?.(entity => (
        mc.isHostile(entity)
        && entity?.position
        && bot.entity.position.distanceTo(entity.position) <= 10
    ));
    if (hostile) {
        setActionEvidence(bot, {
            kind: 'useful_pickup',
            outcome: 'hostile_nearby',
            target: { name: hostile.username || hostile.name || 'hostile', id: hostile.id },
            retryable: true,
        });
        return false;
    }
    const candidates = droppedItemCandidates(
        bot,
        distance,
        item => usefulDroppedItem(bot, item) && hasInventoryRoomFor(bot, item.name),
    );
    if (candidates.length === 0) {
        setActionEvidence(bot, {
            kind: 'useful_pickup',
            outcome: 'no_reachable_items',
            count: 0,
            retryable: false,
        });
        return false;
    }
    return await collectDroppedItemQueue(bot, candidates, {
        kind: 'useful_pickup',
        successMessage: count => `Picked up ${count} useful nearby item${count === 1 ? '' : 's'}.`,
    });
}


export async function breakBlockAt(bot, x, y, z, options = {}) {
    /**
     * Break the block at the given position. Will use the bot's equipped item.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} x, the x coordinate of the block to break.
     * @param {number} y, the y coordinate of the block to break.
     * @param {number} z, the z coordinate of the block to break.
     * @param {object} options, bounded harvest and falling-replacement policy.
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
            const requireHarvest = options?.requireHarvest !== false;
            const durability = requireHarvest
                ? assessMiningRouteDurability(bot, [], { targetBlock: block })
                : null;
            const toolRequirement = (
                durability?.ok === false
                && durability.replacementTool
            ) ? {
                    name: durability.replacementTool,
                    minimumUsableDurability: Math.max(
                        1,
                        Number(durability.minimumUsableDurability) || 1,
                    ),
                }
                : null;
            let harvestable = false;
            try {
                await equipBestToolForBlock(bot, block, {
                    preserveTargetToolFor: options?.preserveTargetToolFor || null,
                });
            } catch (err) {
                if (requireHarvest) {
                    setActionEvidence(bot, {
                        kind: 'break',
                        outcome: 'missing_tool',
                        target,
                        error: err.message,
                        ...(toolRequirement ? { toolRequirement } : {}),
                        retryable: true,
                    });
                    log(bot, `Could not prepare a tool for ${block.name}: ${err.message}.`);
                    return false;
                }
            }
            const itemId = bot.heldItem ? bot.heldItem.type : null
            try { harvestable = block.canHarvest(itemId); } catch { harvestable = false; }
            if (requireHarvest && !harvestable) {
                setActionEvidence(bot, {
                    kind: 'break',
                    outcome: 'missing_tool',
                    target,
                    ...(toolRequirement ? { toolRequirement } : {}),
                    retryable: true,
                });
                log(bot, `Don't have right tools to break ${block.name}.`);
                return false;
            }
        }
        const fallingDepthBefore = (
            options?.acceptFallingReplacement === true
            && isFallingGameplayBlock(block)
        ) ? fallingColumnDepth(bot, block.position) : 0;
        try {
            await bot.dig(block, true);
        } catch (err) {
            setActionEvidence(bot, { kind: 'break', outcome: 'dig_blocked', target, error: err.message, retryable: true });
            log(bot, `Could not break ${block.name}: ${err.message}.`);
            return false;
        }
        let remaining = bot.blockAt(Vec3(x, y, z));
        let fallingLayerCleared = false;
        if (remaining?.name === block.name && fallingDepthBefore > 0) {
            fallingLayerCleared = await waitForWorldCondition(
                bot,
                () => fallingColumnDepth(bot, block.position) < fallingDepthBefore,
                GROUND_SETTLE_TIMEOUT_MS,
                25,
            );
            remaining = bot.blockAt(Vec3(x, y, z));
        }
        let replacementPassable = Boolean(
            remaining
            && remaining.boundingBox === 'empty'
            && !isHazardousGameplayBlock(remaining),
        );
        if (replacementPassable && !fallingLayerCleared) {
            // A local block update can briefly advertise air before Paper
            // corrects a stale dig target to the authoritative solid block.
            // Do not hand locomotion a cell until the replacement remains
            // physically passable across a bounded settlement interval.
            await interruptibleDelay(bot, INVENTORY_POLL_MS);
            remaining = bot.blockAt(Vec3(x, y, z));
            replacementPassable = Boolean(
                remaining
                && remaining.boundingBox === 'empty'
                && !isHazardousGameplayBlock(remaining),
            );
        }
        if (bot.interrupt_code) {
            setActionEvidence(bot, { kind: 'break', outcome: 'interrupted', target, retryable: false });
            log(bot, `Stopped before confirming that ${block.name} was broken.`);
            return false;
        }
        if (!remaining || (!replacementPassable && !fallingLayerCleared)) {
            const outcome = !remaining
                ? 'unverified'
                : remaining.name === block.name
                    ? 'not_broken'
                    : 'solid_replacement';
            setActionEvidence(bot, {
                kind: 'break',
                outcome,
                target,
                ...(remaining ? { observed: remaining.name } : {}),
                retryable: true,
            });
            log(bot, remaining && remaining.name !== block.name
                ? `Could not clear ${block.name}: ${remaining.name} still occupies x:${x}, y:${y}, z:${z}.`
                : `Could not verify that ${block.name} was broken.`);
            return false;
        }
        setActionEvidence(bot, {
            kind: 'break',
            outcome: fallingLayerCleared ? 'falling_layer_cleared' : 'broken',
            target,
            retryable: false,
        });
        log(
            bot,
            `${fallingLayerCleared ? 'Cleared one settled layer of' : 'Broke'} ${block.name} at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`,
        );
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

const FIXTURE_FACING_OFFSETS = Object.freeze({
    north: Object.freeze({ x: 0, y: 0, z: -1 }),
    south: Object.freeze({ x: 0, y: 0, z: 1 }),
    east: Object.freeze({ x: 1, y: 0, z: 0 }),
    west: Object.freeze({ x: -1, y: 0, z: 0 }),
});

export function fixtureOrientationStances(bot, anchor, direction) {
    if (!anchor?.offset || !direction || !bot?.blockAt) return [];
    const candidates = [];
    for (const distance of [2, 3, 4]) {
        for (const yOffset of [-3, -2, -1, 0, 1, 2]) {
            if (Math.hypot(distance, yOffset) > 4.25) continue;
            candidates.push(anchor.offset(
                -direction.x * distance,
                yOffset,
                -direction.z * distance,
            ));
        }
    }
    return candidates
        .filter(stance => (
            isReplaceableGameplayBlock(bot.blockAt(stance))
            && isReplaceableGameplayBlock(bot.blockAt(stance.offset(0, 1, 0)))
            && isSafeGameplaySupport(bot.blockAt(stance.offset(0, -1, 0)))
        ))
        .sort((left, right) => (
            (bot.entity?.position?.distanceTo?.(left) ?? 0)
            - (bot.entity?.position?.distanceTo?.(right) ?? 0)
            || left.distanceTo(anchor) - right.distanceTo(anchor)
            || left.y - right.y
        ));
}

export async function placeFixture(bot, blockType, x, y, z, kind, facing) {
    const fixtureKind = String(kind || '').trim().toLowerCase();
    const fixtureFacing = String(facing || '').trim().toLowerCase();
    const direction = FIXTURE_FACING_OFFSETS[fixtureFacing];
    const validMaterial = fixtureKind === 'bed'
        ? String(blockType || '').endsWith('_bed')
        : fixtureKind === 'door'
            ? String(blockType || '').endsWith('_door') && blockType !== 'iron_door'
            : false;
    const anchor = new Vec3(Math.floor(Number(x)), Math.floor(Number(y)), Math.floor(Number(z)));
    const target = { name: blockType, x: anchor.x, y: anchor.y, z: anchor.z };
    if (!validMaterial || !direction || ![x, y, z].every(Number.isFinite)) {
        setActionEvidence(bot, { kind: 'fixture_place', outcome: 'invalid_fixture', target, retryable: false });
        return false;
    }
    const occupied = fixtureKind === 'door'
        ? [
            { position: anchor, part: 'lower' },
            { position: anchor.offset(0, 1, 0), part: 'upper' },
        ]
        : [
            { position: anchor, part: 'foot' },
            { position: anchor.offset(direction.x, 0, direction.z), part: 'head' },
        ];
    const supports = fixtureKind === 'door'
        ? [anchor.offset(0, -1, 0)]
        : occupied.map(cell => cell.position.offset(0, -1, 0));
    if (supports.some(position => !isSafeGameplaySupport(bot.blockAt(position)))) {
        setActionEvidence(bot, { kind: 'fixture_place', outcome: 'missing_support', target, retryable: false });
        return false;
    }
    for (const cell of occupied) {
        const current = bot.blockAt(cell.position);
        if (!current || (!isReplaceableGameplayBlock(current) && !blockMatchesPlacement(bot.registry, blockType, current))) {
            setActionEvidence(bot, {
                kind: 'fixture_place',
                outcome: 'occupied',
                target: { ...target, x: cell.position.x, y: cell.position.y, z: cell.position.z },
                observed: current?.name || 'unloaded',
                retryable: false,
            });
            return false;
        }
    }
    const stances = fixtureOrientationStances(bot, anchor, direction);
    let reachedStance = null;
    for (const stance of stances) {
        if (await goToPosition(bot, stance.x, stance.y, stance.z, 0.75)) {
            reachedStance = stance;
            break;
        }
    }
    if (!reachedStance) {
        setActionEvidence(bot, {
            kind: 'fixture_place',
            outcome: 'orientation_stance_unreachable',
            target,
            candidateCount: stances.length,
            candidates: stances.map(stance => ({ x: stance.x, y: stance.y, z: stance.z })),
            retryable: true,
        });
        return false;
    }
    await bot.lookAt(anchor.offset(0.5, 0.5, 0.5), true);
    if (!await placeBlock(bot, blockType, anchor.x, anchor.y, anchor.z, 'bottom', true, false)) return false;
    const verified = occupied.every(cell => {
        const block = bot.blockAt(cell.position);
        if (!blockMatchesPlacement(bot.registry, blockType, block)) return false;
        const properties = block.getProperties?.() || {};
        const part = fixtureKind === 'door' ? properties.half : properties.part;
        return part === cell.part && properties.facing === fixtureFacing;
    });
    setActionEvidence(bot, {
        kind: 'fixture_place',
        outcome: verified ? 'placed' : 'state_unverified',
        target: { ...target, fixtureKind, facing: fixtureFacing },
        retryable: !verified,
    });
    log(bot, verified
        ? `Placed and verified ${fixtureFacing}-facing ${blockType}.`
        : `Placed ${blockType}, but Minecraft did not confirm its complete ${fixtureFacing}-facing geometry.`);
    return verified;
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
    preferredInventorySlot=null,
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
     * @param {number|null} preferredInventorySlot, exact source slot for bounded inventory compaction. Defaults to normal item selection.
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
    let block_item = Number.isInteger(preferredInventorySlot)
        ? bot.inventory.slots[preferredInventorySlot]
        : bot.inventory.findInventoryItem(item_name);
    if (block_item?.name !== item_name) block_item = null;
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
    if (blockMatchesPlacement(bot.registry, blockType, targetBlock)) {
        setActionEvidence(bot, { kind: 'place', outcome: 'already_present', target, retryable: false });
        log(bot, `${blockType} already at ${targetBlock.position}.`);
        return false;
    }
    if (!isReplaceableGameplayBlock(targetBlock)) {
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
    let placementDirection = null;
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
            && !isReplaceableGameplayBlock(block)
            && !block.name.endsWith('_door')
        ) {
            buildOffBlock = block;
            faceVec = new Vec3(-d.x, -d.y, -d.z); // invert
            placementDirection = d;
            break;
        }
    }
    if (!buildOffBlock) {
        setActionEvidence(bot, { kind: 'place', outcome: 'missing_support', target, retryable: true });
        log(bot, `Cannot place ${blockType} at ${targetBlock.position}: nothing to place on.`);
        return false;
    }

    const dont_move_for = ['torch', 'redstone_torch', 'redstone', 'lever', 'button', 'rail', 'detector_rail', 
        'powered_rail', 'activator_rail', 'tripwire_hook', 'tripwire', 'water_bucket', 'string'];
    if (!dont_move_for.includes(item_name)) {
        // Pathfinder already owns the exact physical predicate for placing a
        // block: do not approximate it with distance-only clearance and
        // GoalNear checks. GoalPlaceBlock proves that the occupied stance is
        // outside the destination cell and can see/reach the exact supporting
        // face selected above. Ordinary locomotion remains no-dig.
        const reached = await goToGoal(
            bot,
            new pf.goals.GoalPlaceBlock(target_dest, bot.world, {
                range: 4.5,
                faces: [placementDirection],
                LOS: true,
            }),
            {
                allowHealthBoundedDescent: false,
                allowLocalRecovery: false,
            },
        );
        if (!reached) {
            setActionEvidence(bot, { kind: 'place', outcome: 'unreachable', target, retryable: true });
            log(bot, `Cannot reach a usable stance to place ${blockType}.`);
            return false;
        }

        // The world can change while Pathfinder is moving. Rebind the exact
        // support face before sending the placement packet.
        buildOffBlock = bot.blockAt(target_dest.plus(placementDirection));
        if (!buildOffBlock || isReplaceableGameplayBlock(buildOffBlock)) {
            setActionEvidence(bot, { kind: 'place', outcome: 'missing_support', target, retryable: true });
            log(bot, `Cannot place ${blockType} at ${targetBlock.position}: its supporting face changed.`);
            return false;
        }
        faceVec = new Vec3(
            -placementDirection.x,
            -placementDirection.y,
            -placementDirection.z,
        );
    }

    // will throw error if an entity is in the way, and sometimes even if the block was placed
    try {
        let placed = false;
        if (item_name.includes('bucket')) {
            placed = await useToolOnBlock(bot, item_name, buildOffBlock);
        }
        else {
            await bot.equip(block_item, 'hand');
            if (bot.heldItem?.name !== item_name) {
                setActionEvidence(bot, {
                    kind: 'place',
                    outcome: 'material_binding_failed',
                    target,
                    expectedItem: item_name,
                    observedItem: bot.heldItem?.name || null,
                    retryable: true,
                });
                log(bot, `Cannot place ${blockType}: the hand contains ${bot.heldItem?.name || 'nothing'} after binding ${item_name}.`);
                return false;
            }
            await bot.lookAt(buildOffBlock.position.offset(0.5, 0.5, 0.5));
            // Mineflayer's generic placement packet still leaves server-side
            // sneak state as a TODO. Without it, clicking a crafting table,
            // furnace, chest, or other interactable support activates that
            // block instead of placing against its selected face. Own the
            // complete physical primitive here and restore prior controls
            // before ActionManager can release the lease.
            const wasSneaking = bot.getControlState?.('sneak') === true;
            bot.setControlState('sneak', true);
            try {
                await bot.waitForTicks?.(1);
                await bot.placeBlock(buildOffBlock, faceVec);
            } finally {
                if (!wasSneaking) bot.setControlState('sneak', false);
            }
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
        if (!blockMatchesPlacement(bot.registry, expectedName, placedBlock)) {
            setActionEvidence(bot, { kind: 'place', outcome: 'not_placed', target, observed: placedBlock?.name || 'unloaded', retryable: true });
            log(bot, `Could not verify ${blockType} at ${target_dest}.`);
            return false;
        }
        setActionEvidence(bot, { kind: 'place', outcome: 'placed', target, retryable: false });
        log(bot, `Placed ${blockType} at ${target_dest}.`);
        return true;
    } catch (err) {
        const message = String(err?.message || err).slice(0, 240);
        setActionEvidence(bot, { kind: 'place', outcome: 'place_blocked', target, error: message, retryable: true });
        log(bot, `Failed to place ${blockType} at ${target_dest}: ${message}.`);
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
    const expectedDimension = normalizedDimension(exactPosition?.dimension);
    const currentDimension = normalizedDimension(bot.game?.dimension);
    if (expectedDimension && expectedDimension !== currentDimension) {
        setActionEvidence(bot, {
            kind: 'chest_transfer',
            outcome: 'assigned_container_wrong_dimension',
            target: {
                name: 'assigned_deposit',
                x: Math.floor(exactPosition.x),
                y: Math.floor(exactPosition.y),
                z: Math.floor(exactPosition.z),
                dimension: expectedDimension,
            },
            observed: currentDimension,
            retryable: true,
        });
        log(bot, `The assigned deposit is in ${expectedDimension}, not ${currentDimension || 'the current dimension'}.`);
        return false;
    }
    let chest = null;
    if (exactPosition) {
        const assigned = await loadAssignedContainerBlock(bot, exactPosition);
        chest = assigned.block;
        if (!chest) {
            const retryable = !['assigned_container_invalid', 'interrupted'].includes(assigned.outcome);
            setActionEvidence(bot, {
                kind: 'chest_transfer',
                outcome: assigned.outcome,
                target: {
                    name: 'assigned_deposit',
                    x: Math.floor(exactPosition.x),
                    y: Math.floor(exactPosition.y),
                    z: Math.floor(exactPosition.z),
                },
                observed: assigned.observed,
                retryable,
            });
            log(bot, assigned.outcome === 'assigned_container_invalid'
                ? 'The assigned deposit is not a chest, trapped chest, or barrel.'
                : 'Could not reach and load the assigned deposit container.');
            return false;
        }
    } else {
        chest = world.getNearestBlock(bot, 'chest', 32);
    }
    if (!chest) {
        setActionEvidence(bot, {
            kind: 'chest_transfer',
            outcome: 'chest_not_found',
            target: { name: itemName || 'item' },
            retryable: true,
        });
        log(bot, 'Could not find a chest nearby.');
        return false;
    }
    let item = bot.inventory.findInventoryItem(itemName);
    if (!item) {
        setActionEvidence(bot, { kind: 'chest_transfer', outcome: 'missing_item', target: { name: itemName || 'item' }, retryable: true });
        log(bot, `You do not have any ${itemName} to put in the chest.`);
        return false;
    }
    const beforeCount = inventoryCount(bot, itemName);
    const toPut = num === -1
        ? beforeCount
        : Math.min(Math.max(0, Math.floor(Number(num) || 0)), beforeCount);
    const target = { name: chest.name || 'chest', x: chest.position.x, y: chest.position.y, z: chest.position.z };
    if (toPut < 1) {
        setActionEvidence(bot, { kind: 'chest_transfer', outcome: 'invalid_count', target, item: itemName, retryable: false });
        log(bot, `Cannot put a non-positive number of ${itemName} in the chest.`);
        return false;
    }
    const approach = await approachContainerBlock(bot, chest);
    if (!approach.block) {
        setActionEvidence(bot, { kind: 'chest_transfer', outcome: approach.outcome, target, item: itemName, observed: approach.observed || null, retryable: approach.outcome !== 'interrupted' });
        log(bot, `Could not reach the chest to deposit ${itemName}.`);
        return false;
    }
    chest = approach.block;

    let chestContainer = null;
    let containerBefore = null;
    let beforeContainerCount = 0;
    try {
        chestContainer = await openContainerForAction(bot, chest);
        containerBefore = containerItemCounts(chestContainer);
        beforeContainerCount = containerBefore[itemName] || 0;
        await chestContainer.deposit(item.type, null, toPut);
        await waitForWorldCondition(
            bot,
            () => (containerItemCounts(chestContainer)[itemName] || 0) >= beforeContainerCount + toPut,
            1_000,
            INVENTORY_POLL_MS,
        );
        const containerAfter = containerItemCounts(chestContainer);
        const containerTransferred = Math.max(0, (containerAfter[itemName] || 0) - beforeContainerCount);
        const unrelatedPreserved = unrelatedContainerContentsPreserved(containerBefore, containerAfter, itemName);
        // Mineflayer updates the open window immediately, but its standalone
        // player inventory can remain stale until that window closes. Verify
        // the selected container first, then close it and verify the player
        // side of the same transfer; waiting for both views concurrently turns
        // a real deposit into a false failure and an unsafe retry.
        await closeContainerQuietly(chestContainer);
        chestContainer = null;
        await waitForWorldCondition(
            bot,
            () => inventoryCount(bot, itemName) <= beforeCount - toPut,
            1_000,
            INVENTORY_POLL_MS,
        );
        const afterCount = inventoryCount(bot, itemName);
        const inventoryTransferred = Math.max(0, beforeCount - afterCount);
        if (inventoryTransferred !== toPut || containerTransferred !== toPut || !unrelatedPreserved) {
            setActionEvidence(bot, {
                kind: 'chest_transfer',
                outcome: 'deposit_unverified',
                target,
                item: itemName,
                requested: toPut,
                transferred: Math.min(inventoryTransferred, containerTransferred),
                inventoryTransferred,
                containerTransferred,
                unrelatedPreserved,
                containerBefore,
                containerAfter,
                retryable: inventoryTransferred === 0 && containerTransferred === 0,
            });
            log(bot, `Minecraft did not verify ${toPut} ${itemName} in the selected chest without changing unrelated contents.`);
            return false;
        }
        setActionEvidence(bot, {
            kind: 'chest_transfer',
            outcome: 'deposited',
            target,
            item: itemName,
            count: toPut,
            inventoryTransferred,
            containerTransferred,
            unrelatedPreserved,
            containerBefore,
            containerAfter,
            retryable: false,
        });
        log(bot, `Put ${toPut} ${itemName} in the chest and verified its contents.`);
        return true;
    } catch (error) {
        const containerAfter = chestContainer ? containerItemCounts(chestContainer) : null;
        const containerTransferred = Math.max(
            0,
            ((containerAfter?.[itemName] || 0) - beforeContainerCount),
        );
        await closeContainerQuietly(chestContainer);
        chestContainer = null;
        await waitForWorldCondition(
            bot,
            () => inventoryCount(bot, itemName) < beforeCount,
            1_000,
            INVENTORY_POLL_MS,
        );
        const afterCount = inventoryCount(bot, itemName);
        const inventoryTransferred = Math.max(0, beforeCount - afterCount);
        setActionEvidence(bot, {
            kind: 'chest_transfer',
            outcome: 'deposit_blocked',
            target,
            item: itemName,
            requested: toPut,
            transferred: Math.min(inventoryTransferred, containerTransferred),
            inventoryTransferred,
            containerTransferred,
            containerBefore,
            containerAfter,
            error: error.message,
            retryable: inventoryTransferred === 0 && containerTransferred === 0,
        });
        log(bot, `Could not put ${itemName} in the chest: ${error.message}.`);
        return false;
    } finally {
        await closeContainerQuietly(chestContainer);
    }
}

export async function putInChestAt(bot, itemName, num, x, y, z, dimension='') {
    return await putInChest(bot, itemName, num, { x, y, z, dimension });
}

function parsedStorageRequirements(encoded) {
    const requirements = [];
    const seen = new Set();
    for (const token of String(encoded || '').split('|').map(value => value.trim()).filter(Boolean)) {
        const match = /^([a-z0-9_]{1,64}):(0|[1-9][0-9]{0,3})$/.exec(token);
        if (!match || seen.has(match[1])) return null;
        seen.add(match[1]);
        requirements.push({ target: match[1], retain: Math.min(2304, Number.parseInt(match[2], 10)) });
    }
    return requirements.length >= 1 && requirements.length <= 12 ? requirements : null;
}

function retainedItemValue(bot, item) {
    const enchantmentValue = [...itemEnchantments(bot, item).values()]
        .reduce((total, level) => total + Math.max(0, Number(level) || 0), 0);
    const durability = toolDurability(bot, item);
    const durabilityRatio = Number.isFinite(durability.max) && durability.max > 0
        ? durability.remaining / durability.max
        : 1;
    return enchantmentValue * 1_000_000 + durabilityRatio * 10_000 + Math.min(9_999, durability.remaining);
}

function containerContentsPreservedExcept(before, after, allowedItems) {
    const names = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    for (const allowed of allowedItems) names.delete(allowed);
    return [...names].every(name => (before?.[name] || 0) === (after?.[name] || 0));
}

function storageItemsCanStack(left, right) {
    const Item = left?.constructor;
    if (typeof Item?.equal === 'function') {
        return Item.equal(left, right, false, true);
    }
    return left?.type === right?.type
        && left?.metadata === right?.metadata
        && JSON.stringify(left?.nbt ?? null) === JSON.stringify(right?.nbt ?? null);
}

/**
 * Mirror Mineflayer's native container stacking rules without clicking a
 * slot. This is policy preflight only: Mineflayer still performs every real
 * transfer after the complete plan is proven to fit.
 */
function storageCapacityPreflight(container, requirements, plannedTransfers) {
    const containerSlotCount = Math.max(0, Number(container?.inventoryStart) || 0);
    const virtualSlots = Array.from({ length: containerSlotCount }, (_, slot) => {
        const item = container?.slots?.[slot] || null;
        return item
            ? {
                item,
                count: Math.max(0, Number(item.count) || 0),
                stackSize: Math.max(1, Number(item.stackSize) || 1),
            }
            : null;
    });
    const availableSlots = virtualSlots.filter(slot => slot === null).length;
    let requiredSlots = 0;

    for (const requirement of requirements) {
        let remaining = Math.max(0, Number(plannedTransfers[requirement.target]) || 0);
        const sources = (container?.items?.() || [])
            .filter(item => item?.name === requirement.target);
        const available = sources.reduce(
            (total, item) => total + Math.max(0, Number(item.count) || 0),
            0,
        );
        if (available < remaining) {
            return {
                fits: false,
                outcome: 'storage_inventory_changed',
                item: requirement.target,
                required: remaining,
                available,
                requiredSlots,
                availableSlots,
                missingSlots: 0,
            };
        }

        for (const source of sources) {
            let sourceRemaining = Math.min(
                remaining,
                Math.max(0, Number(source.count) || 0),
            );
            while (sourceRemaining > 0) {
                const partial = virtualSlots.find(slot => (
                    slot
                    && slot.count < slot.stackSize
                    && storageItemsCanStack(slot.item, source)
                ));
                if (partial) {
                    const moved = Math.min(sourceRemaining, partial.stackSize - partial.count);
                    partial.count += moved;
                    sourceRemaining -= moved;
                    remaining -= moved;
                    continue;
                }

                const stackSize = Math.max(1, Number(source.stackSize) || 1);
                const moved = Math.min(sourceRemaining, stackSize);
                const newSlot = { item: source, count: moved, stackSize };
                const emptyIndex = virtualSlots.findIndex(slot => slot === null);
                if (emptyIndex >= 0) virtualSlots[emptyIndex] = newSlot;
                else virtualSlots.push(newSlot);
                requiredSlots += 1;
                sourceRemaining -= moved;
                remaining -= moved;
            }
            if (remaining < 1) break;
        }
    }

    const missingSlots = Math.max(0, requiredSlots - availableSlots);
    return {
        fits: missingSlots === 0,
        outcome: missingSlots === 0 ? 'storage_capacity_available' : 'storage_capacity_blocked',
        requiredSlots,
        availableSlots,
        missingSlots,
    };
}

/**
 * Store one complete retained-inventory plan through a single native container
 * session. Stackable items use Mineflayer's transfer implementation. Durable
 * single items use Mineflayer's exact-slot move so the worst copies leave
 * first and the requested best copies remain carried.
 */
export async function storeInventoryPlanAt(bot, encodedPlan, x, y, z, dimension='') {
    const requirements = parsedStorageRequirements(encodedPlan);
    const target = { name: 'storage_plan', x, y, z };
    if (!requirements) {
        setActionEvidence(bot, { kind: 'storage_plan', outcome: 'invalid_storage_plan', target, retryable: false });
        log(bot, 'The storage plan was invalid, so nothing was moved.');
        return false;
    }
    const expectedDimension = normalizedDimension(dimension);
    const currentDimension = normalizedDimension(bot.game?.dimension);
    if (expectedDimension && expectedDimension !== currentDimension) {
        setActionEvidence(bot, {
            kind: 'storage_plan',
            outcome: 'assigned_container_wrong_dimension',
            target: { ...target, dimension: expectedDimension },
            observed: currentDimension,
            retryable: true,
        });
        return false;
    }
    const assigned = await loadAssignedContainerBlock(bot, { x, y, z });
    if (!assigned.block) {
        setActionEvidence(bot, {
            kind: 'storage_plan',
            outcome: assigned.outcome,
            target,
            observed: assigned.observed,
            retryable: !['assigned_container_invalid', 'interrupted'].includes(assigned.outcome),
        });
        return false;
    }
    const approach = await approachContainerBlock(bot, assigned.block);
    if (!approach.block) {
        setActionEvidence(bot, {
            kind: 'storage_plan',
            outcome: approach.outcome,
            target,
            observed: approach.observed || null,
            retryable: approach.outcome !== 'interrupted',
        });
        return false;
    }

    const beforeInventory = Object.fromEntries(requirements.map(requirement => [
        requirement.target,
        inventoryCount(bot, requirement.target),
    ]));
    const plannedTransfers = Object.fromEntries(requirements.map(requirement => [
        requirement.target,
        Math.max(0, beforeInventory[requirement.target] - requirement.retain),
    ]));
    let chestContainer = null;
    let containerBefore = null;
    let containerAfter = null;
    try {
        chestContainer = await openContainerForAction(bot, approach.block);
        containerBefore = containerItemCounts(chestContainer);
        const capacity = storageCapacityPreflight(chestContainer, requirements, plannedTransfers);
        if (!capacity.fits) {
            setActionEvidence(bot, {
                kind: 'storage_plan',
                outcome: capacity.outcome,
                target,
                plannedTransfers,
                capacity,
                retryable: false,
            });
            log(bot, capacity.outcome === 'storage_inventory_changed'
                ? `${capacity.item} changed before storage could begin, so nothing was moved.`
                : `The selected container has ${capacity.availableSlots} free slot${capacity.availableSlots === 1 ? '' : 's'}, but the complete cleanup needs ${capacity.requiredSlots}; nothing was moved.`);
            return false;
        }
        for (const requirement of requirements) {
            if (bot.interrupt_code) throw new Error('Storage cleanup was interrupted.');
            const toStore = plannedTransfers[requirement.target];
            if (toStore < 1) continue;
            const carried = chestContainer.items()
                .filter(item => item?.name === requirement.target);
            const available = carried.reduce((total, item) => total + Math.max(0, Number(item.count) || 0), 0);
            if (available < toStore) {
                throw new Error(`${requirement.target} changed before storage could finish.`);
            }
            const singleItems = carried.every(item => Math.max(1, Number(item.stackSize) || 1) === 1);
            if (singleItems) {
                const surplus = carried
                    .slice()
                    .sort((left, right) => retainedItemValue(bot, left) - retainedItemValue(bot, right))
                    .slice(0, toStore);
                const emptySlots = [];
                for (let slot = 0; slot < chestContainer.inventoryStart; slot += 1) {
                    if (!chestContainer.slots[slot]) emptySlots.push(slot);
                }
                if (emptySlots.length < surplus.length) {
                    throw new Error(`The selected container needs ${surplus.length - emptySlots.length} more slot(s) for ${requirement.target}.`);
                }
                for (const [index, item] of surplus.entries()) {
                    await bot.moveSlotItem(item.slot, emptySlots[index]);
                }
            } else {
                const item = carried[0];
                await chestContainer.deposit(item.type, null, toStore);
            }
            const containerStart = containerBefore[requirement.target] || 0;
            await waitForWorldCondition(
                bot,
                () => (containerItemCounts(chestContainer)[requirement.target] || 0) >= containerStart + toStore,
                1_500,
                INVENTORY_POLL_MS,
            );
        }
        containerAfter = containerItemCounts(chestContainer);
        const allowed = new Set(requirements.map(requirement => requirement.target));
        const unrelatedPreserved = containerContentsPreservedExcept(containerBefore, containerAfter, allowed);
        await closeContainerQuietly(chestContainer);
        chestContainer = null;
        await waitForWorldCondition(
            bot,
            () => requirements.every(requirement => inventoryCount(bot, requirement.target) === requirement.retain),
            1_500,
            INVENTORY_POLL_MS,
        );
        const transfers = {};
        const verified = requirements.every(requirement => {
            const inventoryTransferred = Math.max(0, beforeInventory[requirement.target] - inventoryCount(bot, requirement.target));
            const containerTransferred = Math.max(
                0,
                (containerAfter[requirement.target] || 0) - (containerBefore[requirement.target] || 0),
            );
            transfers[requirement.target] = Math.min(inventoryTransferred, containerTransferred);
            return inventoryTransferred === plannedTransfers[requirement.target]
                && containerTransferred === plannedTransfers[requirement.target];
        });
        if (!verified || !unrelatedPreserved) {
            setActionEvidence(bot, {
                kind: 'storage_plan',
                outcome: 'storage_plan_unverified',
                target,
                plannedTransfers,
                transfers,
                unrelatedPreserved,
                retryable: Object.values(transfers).every(value => value === 0),
            });
            log(bot, 'Minecraft did not verify the complete storage cleanup without changing unrelated contents.');
            return false;
        }
        setActionEvidence(bot, {
            kind: 'storage_plan',
            outcome: 'stored',
            target,
            plannedTransfers,
            transfers,
            retained: Object.fromEntries(requirements.map(requirement => [requirement.target, requirement.retain])),
            unrelatedPreserved,
            retryable: false,
        });
        log(bot, `Stored ${Object.values(transfers).reduce((total, value) => total + value, 0)} authorized item${Object.values(transfers).reduce((total, value) => total + value, 0) === 1 ? '' : 's'} and preserved the requested carried set.`);
        return true;
    } catch (error) {
        containerAfter = chestContainer ? containerItemCounts(chestContainer) : containerAfter;
        await closeContainerQuietly(chestContainer);
        chestContainer = null;
        await waitForWorldCondition(
            bot,
            () => requirements.some(requirement => (
                inventoryCount(bot, requirement.target) !== beforeInventory[requirement.target]
            )),
            1_000,
            INVENTORY_POLL_MS,
        );
        const transfers = Object.fromEntries(requirements.map(requirement => [
            requirement.target,
            Math.min(
                Math.max(0, beforeInventory[requirement.target] - inventoryCount(bot, requirement.target)),
                Math.max(
                    0,
                    ((containerAfter?.[requirement.target] || 0) - (containerBefore?.[requirement.target] || 0)),
                ),
            ),
        ]));
        const transferred = Object.values(transfers).reduce((total, value) => total + value, 0);
        setActionEvidence(bot, {
            kind: 'storage_plan',
            outcome: bot.interrupt_code ? 'interrupted' : transferred > 0 ? 'partial' : 'storage_blocked',
            target,
            plannedTransfers,
            transfers,
            error: String(error?.message || error).slice(0, 240),
            retryable: !bot.interrupt_code && transferred === 0,
        });
        log(bot, `Storage cleanup stopped after moving ${transferred} item${transferred === 1 ? '' : 's'}: ${String(error?.message || error).slice(0, 180)}.`);
        return false;
    } finally {
        await closeContainerQuietly(chestContainer);
    }
}

function familyBaselineCounts(bot, family, encoded) {
    const value = String(encoded || '').trim();
    if (!value) return null;
    if (value === 'none') return new Map();
    const counts = new Map();
    for (const part of value.split('|')) {
        const match = /^([a-z0-9_]{1,64}):(\d{1,4})$/.exec(part);
        if (!match || !itemMatchesFamily(bot, { name: match[1] }, family)) return false;
        const count = Math.max(0, Math.min(2304, Number(match[2]) || 0));
        counts.set(match[1], Math.min(2304, (counts.get(match[1]) || 0) + count));
    }
    return counts;
}

export async function putFamilyInChestAt(bot, family, num, x, y, z, dimension='', baselineManifest='') {
    family = String(family || '').trim();
    const requested = Math.max(1, Math.min(2304, Math.floor(Number(num) || 1)));
    const before = familyInventoryCount(bot, family);
    const target = { name: family || 'item_family', x, y, z };
    if (!SUPPORTED_ITEM_FAMILIES.includes(family)) {
        setActionEvidence(bot, { kind: 'family_transfer', outcome: 'unsupported_family', target, retryable: false });
        return false;
    }
    const baseline = familyBaselineCounts(bot, family, baselineManifest);
    if (baseline === false) {
        setActionEvidence(bot, { kind: 'family_transfer', outcome: 'invalid_baseline_manifest', target, retryable: false });
        log(bot, `The ${family} transfer baseline is invalid.`);
        return false;
    }
    const candidates = familyInventoryEntries(bot, family)
        .map(entry => ({
            ...entry,
            count: baseline === null
                ? entry.count
                : Math.max(0, entry.count - (baseline.get(entry.name) || 0)),
        }))
        .filter(entry => entry.count > 0);
    const available = candidates.reduce((total, entry) => total + entry.count, 0);
    if (available < 1) {
        setActionEvidence(bot, {
            kind: 'family_transfer',
            outcome: baseline === null ? 'family_missing' : 'family_delta_missing',
            target,
            retryable: true,
        });
        log(bot, baseline === null
            ? `There are no ${family} to deposit.`
            : `There are no newly prepared ${family} items to deposit.`);
        return false;
    }
    let remaining = Math.min(requested, available);
    let allVerified = true;
    for (const entry of candidates) {
        if (remaining < 1 || bot.interrupt_code) break;
        const amount = Math.min(remaining, entry.count);
        if (!await putInChestAt(bot, entry.name, amount, x, y, z, dimension)) {
            allVerified = false;
            break;
        }
        remaining -= amount;
    }
    const after = familyInventoryCount(bot, family);
    const transferred = Math.max(0, before - after);
    const expected = Math.min(requested, available);
    const success = allVerified && transferred >= expected;
    setActionEvidence(bot, {
        kind: 'family_transfer',
        outcome: success ? 'deposited' : bot.interrupt_code ? 'interrupted' : transferred > 0 ? 'partial' : 'deposit_blocked',
        target,
        requested: expected,
        transferred,
        ...(baseline === null ? {} : {
            baseline: Object.fromEntries(baseline),
            manifest: candidates.map(entry => ({ name: entry.name, count: entry.count })),
        }),
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
        || ['leaf_litter', 'rotten_flesh', 'spider_eye', 'poisonous_potato'].includes(name)
    ) return 0;
    if (['dirt', 'gravel', 'sand', 'cobblestone', 'cobbled_deepslate', 'stone'].includes(name)) return 1;
    if (name.startsWith('raw_') || /_(?:ore|ingot|nugget)$/.test(name)) return 3;
    return 2;
}

export function selectDisposableWorkingSlotStack(bot, protectedNames = new Set()) {
    const protectedSet = protectedNames instanceof Set
        ? protectedNames
        : new Set(Array.isArray(protectedNames) ? protectedNames : [protectedNames]);
    return bot.inventory.items()
        .filter(item => (
            item.count > 0
            && Number.isInteger(item.slot)
            && ![...protectedSet].some(name => protectedInventoryItem(item.name, String(name || '').trim()))
            && overflowKeepCount(bot, 'builder', item.name, '') === 0
            && overflowPriority(item.name) === 0
        ))
        .sort((left, right) => (
            left.count - right.count
            || left.name.localeCompare(right.name)
            || left.slot - right.slot
        ))[0] || null;
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
    let chest = null;
    if (exactPosition) {
        const assigned = await loadAssignedContainerBlock(bot, exactPosition);
        chest = assigned.block;
        if (!chest) {
            const retryable = !['assigned_container_invalid', 'interrupted'].includes(assigned.outcome);
            setActionEvidence(bot, {
                kind: 'chest_transfer',
                outcome: assigned.outcome,
                target: {
                    name: 'assigned_withdrawal',
                    x: Math.floor(exactPosition.x),
                    y: Math.floor(exactPosition.y),
                    z: Math.floor(exactPosition.z),
                },
                observed: assigned.observed,
                retryable,
            });
            log(bot, assigned.outcome === 'assigned_container_invalid'
                ? 'The assigned withdrawal is not a chest, trapped chest, or barrel.'
                : 'Could not reach and load the assigned withdrawal container.');
            return false;
        }
    } else {
        chest = world.getNearestBlock(bot, 'chest', 32);
    }
    if (!chest) {
        setActionEvidence(bot, { kind: 'chest_transfer', outcome: 'chest_not_found', target: { name: itemName || 'item' }, retryable: true });
        log(bot, 'Could not find a chest nearby.');
        return false;
    }
    const target = { name: chest.name || 'chest', x: chest.position.x, y: chest.position.y, z: chest.position.z };
    const approach = await approachContainerBlock(bot, chest);
    if (!approach.block) {
        setActionEvidence(bot, { kind: 'chest_transfer', outcome: approach.outcome, target, item: itemName, observed: approach.observed || null, retryable: approach.outcome !== 'interrupted' });
        log(bot, `Could not reach the chest to take ${itemName}.`);
        return false;
    }
    chest = approach.block;

    const beforeCount = inventoryCount(bot, itemName);
    let chestContainer = null;
    let intended = 0;
    try {
        chestContainer = await openContainerForAction(bot, chest);
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
    const approach = await approachContainerBlock(bot, chest);
    if (!approach.block) {
        setActionEvidence(bot, { kind: 'chest_view', outcome: approach.outcome, target, observed: approach.observed || null, retryable: approach.outcome !== 'interrupted' });
        log(bot, 'Could not reach the chest to inspect it.');
        return false;
    }
    chest = approach.block;
    let chestContainer = null;
    try {
        chestContainer = await openContainerForAction(bot, chest);
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
    ) < DELIVERY_MIN_DROP_DISTANCE;
}

export function deliveryDropStanceIsExclusive(botPosition, playerPosition) {
    if (![botPosition?.x, botPosition?.y, botPosition?.z, playerPosition?.x, playerPosition?.y, playerPosition?.z].every(Number.isFinite)) {
        return false;
    }
    const dx = Math.abs(botPosition.x - playerPosition.x);
    const dy = Math.abs(botPosition.y - playerPosition.y);
    const dz = Math.abs(botPosition.z - playerPosition.z);
    const distance = Math.hypot(dx, dy, dz);
    return distance >= DELIVERY_MIN_DROP_DISTANCE
        && distance <= DELIVERY_MAX_DROP_DISTANCE
        && Math.min(dx, dz) <= DELIVERY_MAX_DROP_AXIS_OFFSET;
}

function deliveryDropStanceIsUsable(bot, player) {
    return deliveryDropStanceIsExclusive(bot?.entity?.position, player?.position)
        && deliveryDropPositionHasSafeSupport(bot, bot?.entity?.position)
        && world.hasLineOfSightToEntity(bot, player) === true;
}

function deliveryDropPositionHasSafeSupport(bot, position) {
    if (![position?.x, position?.y, position?.z].every(Number.isFinite)) return false;
    const feetPosition = new Vec3(
        Math.floor(position.x),
        Math.floor(position.y),
        Math.floor(position.z),
    );
    const feet = bot.blockAt(feetPosition);
    const head = bot.blockAt(feetPosition.offset(0, 1, 0));
    const support = bot.blockAt(feetPosition.offset(0, -1, 0));
    return feet?.boundingBox === 'empty'
        && head?.boundingBox === 'empty'
        && !isHazardousGameplayBlock(feet)
        && !isHazardousGameplayBlock(head)
        && !isLiquidGameplayBlock(feet)
        && !isLiquidGameplayBlock(head)
        && isSafeGameplaySupport(support);
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
        const center = position.offset(0.5, 0, 0.5);
        return deliveryDropPositionHasSafeSupport(bot, position)
            && deliveryDropStanceIsExclusive(center, player.position);
    }).sort((left, right) => (
        bot.entity.position.distanceTo(left.offset(0.5, 0, 0.5))
        - bot.entity.position.distanceTo(right.offset(0.5, 0, 0.5))
    ));
}

async function reachDeliveryDropStance(bot, player) {
    for (let replan = 0; replan < 2 && !bot.interrupt_code; replan += 1) {
        if (!deliveryDropStanceIsUsable(bot, player)) {
            const stances = deliveryDropStances(bot, player);
            if (stances.length === 0) return false;
            const routed = await goToGoal(bot, new pf.goals.GoalCompositeAny(
                stances.map(position => new pf.goals.GoalBlock(position.x, position.y, position.z)),
            ));
            if (!routed) return false;
        }
        if (!deliveryDropStanceIsUsable(bot, player)) continue;
        // Aim through the recipient's pickup volume, not at their feet. A
        // downward inventory toss can land back inside the thrower's pickup
        // radius even from an otherwise exclusive cardinal stance.
        await bot.lookAt(player.position.offset(0, 1, 0));
        if (deliveryDropStanceIsUsable(bot, player)) return true;
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
    // A close toss can enter both pickup boxes and let the thrower reclaim the
    // item first. Use a supported, visible stance whose full 3D separation
    // excludes the thrower. This also permits a safe vertical tunnel handoff.
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
        log(bot, `Failed to give ${itemType} to ${username}: no safe visible drop stance was reachable.`);
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
            droppedEntityId = null;
            reclaimed = false;
            resolution = resolvePhysicalPlayer(bot, username);
            target = playerTargetEvidence(resolution);
            player = resolution.entity;
            if (!player) {
                setActionEvidence(bot, { kind: 'give', outcome: 'lost_target', target, retryable: false });
                return false;
            }

            // Re-bind the moving recipient before every physical drop. Stance
            // recovery is not a drop attempt and cannot consume that budget.
            if (!await reachDeliveryDropStance(bot, player)) return false;
            resolution = resolvePhysicalPlayer(bot, username);
            target = playerTargetEvidence(resolution);
            player = resolution.entity;
            if (!player || !deliveryDropStanceIsUsable(bot, player)) return false;
            deliveryAttempts += 1;
            const inventoryBeforeDrop = inventoryCount(bot, itemType);
            if (!await discard(bot, itemType, transferCount)) return false;
            if (droppedEntityId === null) {
                const dropped = Object.values(bot.entities || {}).find(isExpectedDroppedEntity);
                droppedEntityId = Number.isFinite(dropped?.id) ? dropped.id : null;
            }
            const inventoryAfterDrop = inventoryCount(bot, itemType);
            const actualTransferred = Math.max(0, inventoryBeforeDrop - inventoryAfterDrop);
            if (actualTransferred !== transferCount) {
                setActionEvidence(bot, {
                    kind: 'give',
                    outcome: 'delivery_quantity_mismatch',
                    target,
                    item: itemType,
                    requested,
                    transferred: actualTransferred,
                    inventoryBefore,
                    inventoryBeforeDrop,
                    inventoryAfter: inventoryAfterDrop,
                    deliveryAttempts,
                    reclaimedAttempts,
                    retryable: false,
                });
                log(bot, `Delivery stopped: expected to drop ${transferCount} ${itemType}, but inventory changed by ${actualTransferred}.`);
                return false;
            }

            const pickupStartedAt = Date.now();
            while (!given && !reclaimed && !bot.interrupt_code) {
                await new Promise(resolve => setTimeout(resolve, 100));
                if (Date.now() - pickupStartedAt > DELIVERY_PICKUP_TIMEOUT_MS) break;
            }
            if (given) {
                const complete = actualTransferred >= requested;
                setActionEvidence(bot, {
                    kind: 'give',
                    outcome: complete ? 'delivered' : 'partial',
                    target,
                    item: itemType,
                    requested,
                    transferred: actualTransferred,
                    inventoryBefore,
                    inventoryBeforeDrop,
                    inventoryAfter: inventoryAfterDrop,
                    droppedEntityId,
                    deliveryAttempts,
                    reclaimedAttempts,
                    retryable: !complete,
                });
                log(bot, `${username} received ${actualTransferred} ${itemType}.`);
                return true;
            }
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
    if (!SUPPORTED_ITEM_FAMILIES.includes(family)) {
        setActionEvidence(bot, { kind: 'family_give', outcome: 'unsupported_family', target, retryable: false });
        return false;
    }
    if (before < 1) {
        setActionEvidence(bot, { kind: 'family_give', outcome: 'family_missing', target, retryable: true });
        log(bot, `There are no ${family} to give to ${username}.`);
        return false;
    }
    const expected = Math.min(requested, before);
    const manifest = familyTransferManifest(bot, family, expected);
    const deliveries = [];
    let allVerified = true;
    let transferred = 0;
    for (const entry of manifest) {
        if (bot.interrupt_code) {
            allVerified = false;
            break;
        }
        const succeeded = await giveToPlayer(bot, entry.item, username, entry.quantity);
        const exact = bot.lastActionEvidence || {};
        const verified = Boolean(
            succeeded
            && exact.kind === 'give'
            && exact.outcome === 'delivered'
            && exact.item === entry.item
            && Number(exact.requested) === entry.quantity
            && Number(exact.transferred) === entry.quantity
            && exact.target?.canonicalName === target.canonicalName
            && Number.isFinite(exact.droppedEntityId)
        );
        const observed = verified ? entry.quantity : Math.max(0, Math.floor(Number(exact.transferred) || 0));
        deliveries.push({
            item: entry.item,
            requested: entry.quantity,
            transferred: observed,
            outcome: String(exact.outcome || (bot.interrupt_code ? 'interrupted' : 'delivery_blocked')),
            target: exact.target || target,
            droppedEntityId: Number.isFinite(exact.droppedEntityId) ? exact.droppedEntityId : null,
            deliveryAttempts: Math.max(0, Math.floor(Number(exact.deliveryAttempts) || 0)),
        });
        if (!verified) {
            allVerified = false;
            break;
        }
        transferred += observed;
    }
    const after = familyInventoryCount(bot, family);
    const inventoryDelta = Math.max(0, before - after);
    const success = allVerified && transferred === expected && deliveries.length === manifest.length;
    setActionEvidence(bot, {
        kind: 'family_give',
        outcome: success ? 'delivered' : bot.interrupt_code ? 'interrupted' : transferred > 0 ? 'partial' : 'delivery_blocked',
        target,
        family,
        requested: expected,
        transferred,
        inventoryBefore: before,
        inventoryAfter: after,
        inventoryDelta,
        manifest,
        deliveries,
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
    let lastPosition = startPosition.clone();
    const startMetric = navigationGoalMetric(goal, startPosition);
    let bestMetric = startMetric;
    let goalSignature = navigationGoalSignature(goal);
    let lastProgressAt = startedAt;
    let lastDigTarget = bot.targetDigBlock?.position?.toString?.() || null;
    let nativeSearchStartedAt = startedAt;
    let nativeSearchDeadlineAt = 0;
    const nativeThinkTimeoutMs = Math.max(
        NAVIGATION_PROGRESS_POLL_MS,
        Math.min(30_000, Number(bot.pathfinder?.thinkTimeout) || 5_000),
    );
    const onPathReset = () => {
        nativeSearchStartedAt = Date.now();
        nativeSearchDeadlineAt = 0;
    };
    const onPathUpdate = result => {
        const pathLength = Array.isArray(result?.path) ? result.path.length : 0;
        // An empty partial result means native A* is still calculating, not
        // that locomotion has stalled. Let its own bounded search horizon
        // decide timeout; once it yields an executable node, the ordinary
        // physical-progress deadline immediately applies again.
        nativeSearchDeadlineAt = result?.status === 'partial' && pathLength === 0
            ? nativeSearchStartedAt + nativeThinkTimeoutMs + NAVIGATION_PROGRESS_POLL_MS
            : 0;
    };
    bot.on('path_reset', onPathReset);
    bot.on('path_update', onPathUpdate);
    const visitedCells = new Set([
        `${Math.floor(startPosition.x)}:${Math.floor(startPosition.y)}:${Math.floor(startPosition.z)}`,
    ]);
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
            const cellKey = `${Math.floor(current.x)}:${Math.floor(current.y)}:${Math.floor(current.z)}`;
            const novelCell = !visitedCells.has(cellKey);
            visitedCells.add(cellKey);
            const metricProgress = !targetChanged && Number.isFinite(metric)
                && (!Number.isFinite(bestMetric) || metric <= bestMetric - NAVIGATION_GOAL_PROGRESS_DELTA);
            // A stuck Pathfinder can pace between two nearby cells forever,
            // but an ordinary native route may need to detour around terrain.
            // Count each genuinely new cell once; revisiting it cannot renew
            // the deadline. Goal convergence and digging progress remain
            // independent progress signals.
            if (targetChanged) {
                goalSignature = nextSignature;
                bestMetric = metric;
            }
            if (metricProgress || digTarget !== lastDigTarget || novelCell) {
                if (metricProgress) {
                    bestMetric = metric;
                }
                lastDigTarget = digTarget;
                lastProgressAt = Date.now();
                return;
            }
            const now = Date.now();
            if (nativeSearchDeadlineAt > now) return;
            if (now - lastProgressAt >= stallTimeoutMs) {
                clearInterval(interval);
                interval = null;
                resolve({
                    state: 'stalled',
                    startedAt,
                    stalledMs: now - lastProgressAt,
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
            bot.removeListener('path_reset', onPathReset);
            bot.removeListener('path_update', onPathUpdate);
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
        if (['stalled', 'rejected'].includes(outcome.state)) {
            stopNavigationGoal(bot);
            // Both the external convergence watchdog and Pathfinder's own
            // timeout can stop an ordinary step-up while the body is airborne.
            // Do not let the caller bind recovery geometry until the plugin
            // promise is finished and the server observes a supported stance.
            await navigation;
            try { bot.clearControlStates?.(); } catch { /* disconnected body */ }
            await waitForWorldCondition(
                bot,
                () => Boolean(observedSupportedStandingCell(bot)),
                remainingActionTimeMs(NAVIGATION_FAILURE_SETTLE_TIMEOUT_MS),
                25,
            );
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
    // A Pathfinder timeout means route computation exhausted its own budget;
    // it is not evidence that the body is trapped in local collision geometry.
    // Sidestepping and submitting the identical goal only repeats the same
    // expensive search. Return that failure to the owning goal so it can bind
    // a different target, region, or strategy instead.
    return pathfinderErrorOutcome(outcome.error, false) === 'unreachable';
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

async function attemptShallowWaterExit(bot, { deadlineAt = null } = {}) {
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
        const localRemainingMs = Number.isFinite(deadlineAt)
            ? Math.max(0, deadlineAt - Date.now())
            : Number.POSITIVE_INFINITY;
        if (bot.interrupt_code || remainingActionTimeMs() <= 0 || localRemainingMs <= 0) break;
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
                Math.min(
                    SHALLOW_WATER_EXIT_TIMEOUT_MS,
                    remainingActionTimeMs(SHALLOW_WATER_EXIT_TIMEOUT_MS),
                    localRemainingMs,
                ),
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
    const escapeGoal = new pf.goals.GoalOutsideRadius(
        origin.x,
        origin.y,
        origin.z,
        NAVIGATION_RECOVERY_DISTANCE,
    );
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
        let outcome = navigationGoalSatisfied(bot, goal)
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
                const source = stuck.locomotion?.source;
                const sourceDetail = source
                    ? ` from ${source.x}, ${source.y}, ${source.z} via ${stuck.locomotion.type}`
                    : '';
                log(bot, `Pathfinder stalled in ${stuck.executionMode} at ${stuck.position.x.toFixed(2)}, ${stuck.position.y.toFixed(2)}, ${stuck.position.z.toFixed(2)} toward ${stuck.nextPoint.x}, ${stuck.nextPoint.y}, ${stuck.nextPoint.z}${sourceDetail}; onGround=${stuck.onGround}, controls=${JSON.stringify(stuck.controls)}, blocks=${JSON.stringify(stuck.blocks)}.`);
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
        const arrived = navigationGoalSatisfied(bot, goal);
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
    if (requested.startsWith('deepslate_') && requested.endsWith('_ore')) {
        return new Set([requested, requested.slice('deepslate_'.length)]);
    }
    if (requested.endsWith('_ore') && !requested.startsWith('deepslate_')) {
        return new Set([requested, `deepslate_${requested}`]);
    }
    return new Set([requested]);
}

function isAuthorizedMiningRouteBlock(
    bot,
    block,
    targetBlock,
    { allowNaturalFoliage = false } = {},
) {
    if (isNaturalFillBlock(bot, block)) return true;
    if (
        allowNaturalFoliage
        && String(block?.name || '').endsWith('_leaves')
        && isEnvironmentallySafeToClear(bot, block)
    ) return true;
    // A typed collection action authorizes every block in the selected
    // resource family, not only one coordinate in a natural vein. It may
    // clear those blocks from the exact deterministic corridor, while other
    // ores and all player-like blocks remain protected.
    return Boolean(
        block?.name
        && targetBlock?.name
        && miningTargetBlockNames(targetBlock.name).has(block.name)
        && isEnvironmentallySafeToClear(bot, block)
    );
}

function nearestKnownMiningTarget(bot, resourceName = '', exclusions = []) {
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
            .filter(block => (
                block?.position
                && names.has(block.name)
                && !collectionPositionExcluded(block.position, exclusions)
            ));
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

export function isMiningTargetExposed(bot, targetBlock) {
    if (!targetBlock?.position) return false;
    return [
        [1, 0, 0], [-1, 0, 0], [0, 1, 0],
        [0, -1, 0], [0, 0, 1], [0, 0, -1],
    ].some(([x, y, z]) => (
        bot.blockAt(targetBlock.position.offset(x, y, z))?.boundingBox === 'empty'
    ));
}

function isProspectiveMiningStance(target, feet) {
    return Boolean(
        target
        && feet
        && Math.abs(feet.x - target.x) + Math.abs(feet.z - target.z) === 1
        && feet.y <= target.y
        && target.y - feet.y <= 1
    );
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
        return isCollectionStandingCellClear(block)
            || isAuthorizedMiningRouteBlock(bot, block, targetBlock);
    };
    const positions = [];
    for (const y of [-1, 0]) {
        for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const feet = target.offset(x, y, z);
            let support;
            try {
                support = bot.blockAt(feet.offset(0, -1, 0));
            } catch {
                continue;
            }
            if (!canBecomeClear(feet)) continue;
            if (!canBecomeClear(feet.offset(0, 1, 0))) continue;
            if (!isAnchoredGameplaySupport(bot, support)) continue;
            positions.push(feet);
        }
    }
    positions.sort((left, right) => (
        origin.distanceTo(left) - origin.distanceTo(right)
        || left.x - right.x
        || left.z - right.z
    ));
    return positions;
}

function boundedMiningProgressStances(bot, targetBlock, finalStances) {
    const origin = observedSupportedStandingCell(bot);
    if (!origin || !targetBlock?.position || finalStances.length === 0) return [];
    const candidates = [];
    const keys = new Set();
    const canBecomeClear = block => Boolean(
        isCollectionStandingCellClear(block)
        || isAuthorizedMiningRouteBlock(bot, block, targetBlock)
    );
    for (
        let yOffset = -MAX_MINING_PROGRESS_VERTICAL;
        yOffset <= MAX_MINING_PROGRESS_VERTICAL;
        yOffset += 1
    ) {
        for (
            let xOffset = -MAX_MINING_PROGRESS_ROUTE_STEPS;
            xOffset <= MAX_MINING_PROGRESS_ROUTE_STEPS;
            xOffset += 1
        ) {
            for (
                let zOffset = -MAX_MINING_PROGRESS_ROUTE_STEPS;
                zOffset <= MAX_MINING_PROGRESS_ROUTE_STEPS;
                zOffset += 1
            ) {
                const horizontal = Math.abs(xOffset) + Math.abs(zOffset);
                if (horizontal === 0 || horizontal > MAX_MINING_PROGRESS_ROUTE_STEPS) continue;
                if (Math.max(Math.abs(yOffset), horizontal) > MAX_MINING_PROGRESS_ROUTE_STEPS) continue;
                const stance = origin.offset(xOffset, yOffset, zOffset);
                const key = miningCellKey(stance);
                if (keys.has(key)) continue;
                const feet = bot.blockAt(stance);
                const head = bot.blockAt(stance.offset(0, 1, 0));
                const support = bot.blockAt(stance.offset(0, -1, 0));
                if (!canBecomeClear(feet) || !canBecomeClear(head)) continue;
                if (!isAnchoredGameplaySupport(bot, support)) continue;
                keys.add(key);
                candidates.push(stance);
            }
        }
    }
    return selectBoundedMiningProgressStances({
        origin,
        finalStances,
        candidates,
        maxRouteSteps: MAX_MINING_PROGRESS_ROUTE_STEPS,
        minProgress: MIN_MINING_PROGRESS_STEPS,
        maxStances: MAX_MINING_PROGRESS_STANCES,
    }).map(candidate => candidate.stance);
}

function isStableMiningStagingCell(bot, feet) {
    const standing = bot.blockAt(feet);
    const head = bot.blockAt(feet.offset(0, 1, 0));
    const support = bot.blockAt(feet.offset(0, -1, 0));
    if (
        !isCollectionStandingCellClear(standing)
        || !isCollectionStandingCellClear(head)
        || !isAnchoredGameplaySupport(bot, support)
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

async function stageMiningStaircase(bot, targetBlock = null) {
    let current = observedSupportedStandingCell(bot);
    if (!current) return false;
    const target = targetBlock?.position;
    const horizontalDistance = target
        ? Math.hypot(target.x - current.x, target.z - current.z)
        : 0;
    if (
        target?.offset
        && occupiedOpenSurfaceStandingCell(bot)
        && horizontalDistance > MAX_MINING_SURFACE_STAGE_DISTANCE
    ) {
        // Native locomotion owns the ordinary trip to a remote mine face. A
        // deterministic mining corridor may create a compact entrance, but it
        // must never substitute a long surface trench for walking around the
        // terrain first.
        const minY = Number.isFinite(Number(bot.game?.minY)) ? Number(bot.game.minY) : -64;
        const height = Number.isFinite(Number(bot.game?.height)) ? Number(bot.game.height) : 384;
        const maxY = minY + Math.max(1, height) - 1;
        const candidates = surfaceEgressStances(bot, target, minY, maxY)
            .filter(position => {
                const support = bot.blockAt(position.offset(0, -1, 0));
                return support
                    && !isProtectedGameplayBlock(support)
                    && !isHazardousGameplayBlock(support)
                    && !isLiquidGameplayBlock(support);
            });
        const route = probeSafeNavigationStances(bot, candidates, 1_200);
        const staging = route.reachable && route.terminalPosition
            ? new Vec3(
                route.terminalPosition.x,
                route.terminalPosition.y,
                route.terminalPosition.z,
            )
            : null;
        if (!staging) return false;
        const reached = await goToGoal(
            bot,
            new pf.goals.GoalBlock(staging.x, staging.y, staging.z),
            {
                movements: () => safeMovements(bot),
                stallTimeoutMs: NAVIGATION_STALL_TIMEOUT_MS,
                allowHealthBoundedDescent: false,
                allowLocalRecovery: false,
            },
        );
        if (bot.interrupt_code || (!reached && !physicallyOccupiesStandingCell(bot, staging))) {
            return false;
        }
        current = observedSupportedStandingCell(bot);
        if (!current) return false;
        log(bot, `Walked non-destructively to a surface mining site ${Math.round(horizontalDistance)} blocks nearer the selected ${targetBlock.name}.`);
    }
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

// Depth relocation has no selected ore coordinate to converge on, but it still
// does not grant Pathfinder excavation authority. Preflight one bounded,
// monotonic staircase leg with the same deterministic corridor planner used by
// exact buried targets; Pathfinder only traverses the cells after they clear.
async function carveExploratoryDepthRoute(bot, targetY, options = {}) {
    const origin = observedSupportedStandingCell(bot);
    if (!origin) return { success: false, progressed: false, outcome: 'origin_support_unsafe' };
    const maximumDrop = Math.min(
        MAX_MINING_PROGRESS_VERTICAL,
        Math.max(1, Math.floor(origin.y - targetY)),
    );
    const rejections = {};
    let toolRequirement = null;
    for (let drop = maximumDrop; drop >= 1; drop -= 1) {
        const run = drop + 2;
        const stances = orderedMiningHeadings(bot)
            .slice(0, MAX_MINING_ROUTE_HEADINGS)
            .map(heading => origin.offset(heading.x * run, -drop, heading.z * run));
        const plan = buildMiningAccessPlan(bot, null, run, {
            breakTarget: false,
            stances,
            maxRouteSteps: run,
            preservedReturnRoute: options.preservedReturnRoute,
        });
        if (!plan.ok) {
            const outcome = plan.outcome || 'no_safe_route';
            rejections[outcome] = (rejections[outcome] || 0) + 1;
            if (outcome === 'insufficient_tool_durability' && plan.replacementTool) {
                toolRequirement = {
                    name: plan.replacementTool,
                    minimumUsableDurability: plan.minimumUsableDurability,
                };
            }
            continue;
        }
        const access = await executeMiningAccessPlan(bot, null, plan);
        if (!access.success) {
            return {
                success: false,
                progressed: false,
                outcome: access.outcome,
                failureOutcome: access.failureOutcome || access.outcome,
                retreat: access.retreat || null,
                excavated: access.excavated,
                routeSteps: plan.route.length,
            };
        }
        const observed = observedSupportedStandingCell(bot);
        const verticalProgress = observed ? origin.y - observed.y : 0;
        const returnable = Boolean(
            observed
            && verticalProgress >= 1
            && isMiningRouteCellReturnable(bot, plan.route.at(-1)?.position)
        );
        return {
            success: returnable && observed.y <= targetY + 1,
            progressed: returnable,
            outcome: returnable ? 'mining_depth_advanced' : 'depth_stance_unverified',
            observedY: observed?.y ?? bot.entity.position.y,
            observed,
            verticalProgress,
            routeSteps: plan.route.length,
            excavated: access.excavated,
            durability: plan.durability,
            returnable,
            returnRoute: miningReturnRoute(plan.origin || origin, plan.route, observed),
        };
    }
    return {
        success: false,
        progressed: false,
        outcome: toolRequirement ? 'insufficient_tool_durability' : 'no_safe_depth_corridor',
        rejections,
        ...(toolRequirement ? { toolRequirement } : {}),
    };
}

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

function normalizePreservedMiningReturnRoute(value) {
    return (Array.isArray(value) ? value : [])
        .slice(-512)
        .filter(cell => [cell?.x, cell?.y, cell?.z].every(Number.isFinite))
        .map(cell => new Vec3(
            Math.floor(cell.x),
            Math.floor(cell.y),
            Math.floor(cell.z),
        ));
}

function protectedMiningReturnGeometry(value) {
    const protectedCells = new Set();
    for (const cell of normalizePreservedMiningReturnRoute(value)) {
        for (const offsetY of [-1, 0, 1]) {
            protectedCells.add(miningCellKey(cell.offset(0, offsetY, 0)));
        }
    }
    return protectedCells;
}

function miningReturnRoute(origin, route, observed = null) {
    const cells = [origin, ...(Array.isArray(route) ? route.map(step => step?.position) : []), observed]
        .filter(position => [position?.x, position?.y, position?.z].every(Number.isFinite))
        .map(position => ({
            x: Math.floor(position.x),
            y: Math.floor(position.y),
            z: Math.floor(position.z),
        }));
    return cells.filter((cell, index) => (
        index === 0 || !sameMiningCell(cell, cells[index - 1])
    ));
}

function miningStepSourcePosition(step) {
    return new Vec3(
        step.position.x - step.heading.x,
        step.position.y - step.yOffset,
        step.position.z - step.heading.z,
    );
}

function fallingDebrisAboveStandingCell(bot, standingCell) {
    if (!standingCell?.offset) return null;
    const column = boundedFallingRouteColumn(bot, standingCell.offset(0, 2, 0));
    return column.blocks.length > 0 ? column.blocks[0] : null;
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

function boundedFallingRouteColumn(bot, start) {
    const blocks = [];
    let position = start;
    for (let count = 0; count < MAX_MINING_FALLING_COLUMN; count += 1) {
        const block = bot.blockAt(position);
        if (!block) return { ok: false, outcome: 'route_chunk_unloaded', blocks };
        if (!isFallingGameplayBlock(block)) {
            return { ok: true, outcome: 'falling_column_bounded', blocks };
        }
        blocks.push(block);
        position = position.offset(0, 1, 0);
    }
    const next = bot.blockAt(position);
    if (!next) return { ok: false, outcome: 'route_chunk_unloaded', blocks };
    return isFallingGameplayBlock(next)
        ? { ok: false, outcome: 'falling_column_limit', blocks }
        : { ok: true, outcome: 'falling_column_bounded', blocks };
}

function fallingColumnDepth(bot, start) {
    let depth = 0;
    let position = start;
    while (depth <= MAX_MINING_FALLING_COLUMN) {
        const block = bot.blockAt(position);
        if (!block || !isFallingGameplayBlock(block)) return depth;
        depth += 1;
        position = position.offset(0, 1, 0);
    }
    return depth;
}

function assessMiningRouteStep(bot, step, targetBlock, options = {}) {
    const feet = step.position;
    const head = feet.offset(0, 1, 0);
    const support = feet.offset(0, -1, 0);
    const ceiling = head.offset(0, 1, 0);
    const supportBlock = bot.blockAt(support);
    if (!supportBlock || !bot.blockAt(ceiling)) {
        return { ok: false, outcome: 'route_chunk_unloaded', blocks: [] };
    }
    const supportAssessment = assessAnchoredGameplaySupport(bot, supportBlock);
    if (!supportAssessment.ok) {
        return {
            ok: false,
            outcome: 'unsafe_route_support',
            blockedBy: supportBlock?.name || 'unloaded',
            blocks: [],
        };
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
            const column = boundedFallingRouteColumn(bot, position);
            if (!column.ok) return { ...column, blocks: [] };
            if (miningRouteTouchesLiquid(bot, column.blocks.map(entry => entry.position))) {
                return { ok: false, outcome: 'liquid_ingress_risk', blocks: [] };
            }
            blocks.push(...column.blocks);
            continue;
        }
        if (!isAuthorizedMiningRouteBlock(bot, block, targetBlock, options)) {
            const fallingAbove = boundedFallingRouteColumn(bot, position.offset(0, 1, 0));
            const generatedFillBelowFallingColumn = Boolean(
                NATURAL_FILL_BLOCKS.has(block.name)
                && !isProtectedGameplayBlock(block)
                && !isHazardousGameplayBlock(block)
                && fallingAbove.ok
                && fallingAbove.blocks.length > 0
                && !miningRouteTouchesLiquid(
                    bot,
                    [block.position, ...fallingAbove.blocks.map(entry => entry.position)],
                )
            );
            if (generatedFillBelowFallingColumn) {
                blocks.push(block, ...fallingAbove.blocks);
                continue;
            }
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
    const protectedConflict = blocks.find(block => (
        options.protectedGeometry?.has(miningCellKey(block.position))
    ));
    if (protectedConflict) {
        return {
            ok: false,
            outcome: 'preserved_return_route_conflict',
            blockedBy: protectedConflict.name,
            conflictBlock: protectedConflict.position,
            blocks: [],
        };
    }
    return {
        ok: true,
        outcome: 'route_step_safe',
        blocks,
        supportBlocks: supportAssessment.blocks,
    };
}

function miningExcavationTouchesOpenSky(bot, block) {
    if (!block?.position?.offset) return false;
    return [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]
        .some(([x, y, z]) => {
            const neighbour = bot.blockAt(block.position.offset(x, y, z));
            return Boolean(
                neighbour
                && neighbour.boundingBox === 'empty'
                && Number(neighbour.skyLight) > 0
            );
        });
}

export function assessMiningSurfaceDisturbance(bot, stepExcavationBlocks) {
    const visible = [];
    for (const [stepIndex, blocks] of (stepExcavationBlocks || []).entries()) {
        for (const block of blocks || []) {
            if (!miningExcavationTouchesOpenSky(bot, block)) continue;
            visible.push({ stepIndex, block });
        }
    }
    const lastVisibleStep = visible.reduce(
        (maximum, entry) => Math.max(maximum, entry.stepIndex),
        -1,
    );
    if (visible.length > MAX_MINING_SURFACE_EXCAVATION_BLOCKS) {
        return {
            ok: false,
            outcome: 'surface_excavation_budget_exceeded',
            visibleBlocks: visible.length,
            lastVisibleStep,
        };
    }
    if (lastVisibleStep >= MAX_MINING_SURFACE_EXCAVATION_STEPS) {
        return {
            ok: false,
            outcome: 'surface_excavation_not_bounded',
            visibleBlocks: visible.length,
            lastVisibleStep,
        };
    }
    return {
        ok: true,
        outcome: visible.length > 0 ? 'compact_surface_entrance' : 'subterranean_route',
        visibleBlocks: visible.length,
        lastVisibleStep,
    };
}

function toolDurabilityReserve(bot, item) {
    const durability = toolDurability(bot, item);
    if (!Number.isFinite(durability.max)) return 0;
    return Math.max(16, Math.ceil(durability.max * 0.1));
}

function assessMiningRouteDurability(
    bot,
    routeBlocks,
    {
        allowReplacementBootstrapReserve = false,
        allowUnharvestedBreaks = false,
        targetBlock = null,
    } = {},
) {
    const items = bot.inventory.items();
    const capacities = new Map(items.map(item => {
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
        return [item.slot, capacity];
    }));
    const replacementFor = (blocks, minimumUsableDurability) => Object.keys(TOOL_PREPARATION_SPECS)
        .map(name => {
            const type = bot.registry?.itemsByName?.[name]?.id;
            if (!Number.isInteger(type)) return null;
            const item = { name, type };
            const durability = toolDurability(bot, item);
            return {
                ...item,
                freshUsable: Number.isFinite(durability.max)
                    ? durability.max - toolDurabilityReserve(bot, item)
                    : Number.POSITIVE_INFINITY,
            };
        })
        .filter(item => (
            item
            && item.freshUsable >= minimumUsableDurability
            && blocks.every(block => {
                try { return block.canHarvest(item.type); } catch { return false; }
            })
        ))
        .sort((left, right) => (
            TOOL_PREPARATION_SPECS[left.name].tier - TOOL_PREPARATION_SPECS[right.name].tier
            || left.name.localeCompare(right.name)
        ))[0] || null;

    // The target is a separate capability role. Reserve exactly one usable
    // break for it before assigning corridor fill; a fixed whole-tranche
    // minimum wrongly forced the ore-tier pick to excavate every route block.
    let targetTool = null;
    if (targetBlock) {
        targetTool = items
            .filter(item => capacities.get(item.slot) > 0)
            .filter(item => {
                try { return targetBlock.canHarvest(item.type); } catch { return false; }
            })
            .sort((left, right) => (
                collectionBreakTime(bot, targetBlock, left)
                - collectionBreakTime(bot, targetBlock, right)
                || toolDurability(bot, right).usable - toolDurability(bot, left).usable
            ))[0] || null;
        if (!targetTool) {
            const replacement = replacementFor([targetBlock], 1);
            return {
                ok: false,
                outcome: 'insufficient_tool_durability',
                requiredFor: targetBlock.name,
                requiredBreaks: routeBlocks.length + 1,
                replacementTool: replacement?.name || null,
                minimumUsableDurability: 1,
                targetCapability: true,
            };
        }
        const remaining = capacities.get(targetTool.slot);
        if (Number.isFinite(remaining)) capacities.set(targetTool.slot, remaining - 1);
    }

    const assigned = new Map();
    let unharvestedBreaks = 0;
    const requirements = routeBlocks.map(block => {
        let harvestableByHand = false;
        try { harvestableByHand = block.canHarvest(null); } catch { /* require a real tool */ }
        return { block, harvestableByHand };
    });
    for (let index = 0; index < requirements.length; index += 1) {
        const requirement = requirements[index];
        if (requirement.harvestableByHand) continue;
        const selected = selectMiningRouteTool(bot, requirement.block, targetBlock, {
            capacities,
            allowWorn: allowReplacementBootstrapReserve,
        });
        if (!selected) {
            if (allowUnharvestedBreaks) {
                unharvestedBreaks += 1;
                continue;
            }
            const remainingBlocks = requirements.slice(index).map(entry => entry.block);
            const replacement = replacementFor(remainingBlocks, remainingBlocks.length);
            return {
                ok: false,
                outcome: 'insufficient_tool_durability',
                requiredFor: requirement.block.name,
                requiredBreaks: routeBlocks.length + (targetBlock ? 1 : 0),
                replacementTool: replacement?.name || null,
                minimumUsableDurability: remainingBlocks.length,
            };
        }
        const remaining = capacities.get(selected.slot);
        if (Number.isFinite(remaining)) capacities.set(selected.slot, remaining - 1);
        assigned.set(selected.name, (assigned.get(selected.name) || 0) + 1);
    }
    return {
        ok: true,
        outcome: 'tool_capacity_sufficient',
        requiredBreaks: routeBlocks.length + (targetBlock ? 1 : 0),
        assigned: Object.fromEntries(assigned),
        targetTool: targetTool?.name || null,
        targetReserve: targetBlock ? 1 : 0,
        unharvestedBreaks,
        replacementBootstrapReserve: allowReplacementBootstrapReserve,
        allowUnharvestedBreaks,
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
        allowUnharvestedBreaks = false,
        allowNaturalFoliageExcavation = false,
        stageFallingDebris = false,
        maxRouteSteps = null,
        protectedGeometry = null,
    } = {},
) {
    const maximumSteps = maxRouteSteps !== null && Number.isFinite(Number(maxRouteSteps))
        ? Math.max(1, Math.floor(Number(maxRouteSteps)))
        : Math.max(4, Math.abs(stance.y - origin.y) + requestedLength + 2);
    if (route.length === 0 || route.length > maximumSteps) {
        return { ok: false, outcome: 'route_step_budget_exceeded', route, stance };
    }
    let previous = origin;
    const excavation = new Map();
    const requiredSupports = new Map();
    const bindRequiredSupport = (block, standingCell) => {
        if (!block?.position) return;
        requiredSupports.set(miningCellKey(block.position), {
            support: block.position,
            standingCell,
        });
    };
    const originSupport = assessAnchoredGameplaySupport(
        bot,
        bot.blockAt(origin.offset(0, -1, 0)),
    );
    if (!originSupport.ok) {
        return { ok: false, outcome: 'origin_support_unsafe', route, stance, origin };
    }
    for (const block of originSupport.blocks) bindRequiredSupport(block, origin);
    const stepExcavationBlocks = [];
    const stepEstimatedDigMs = [];
    for (const [stepIndex, step] of route.entries()) {
        const horizontalDelta = Math.abs(step.position.x - previous.x)
            + Math.abs(step.position.z - previous.z);
        const verticalDelta = Math.abs(step.position.y - previous.y);
        if (horizontalDelta !== 1 || verticalDelta > 1) {
            return {
                ok: false,
                outcome: 'invalid_route_geometry',
                route,
                stance,
                origin,
                safePrefixLength: stepIndex,
                excavationBlocks: [...excavation.values()],
                stepExcavationBlocks,
                stepEstimatedDigMs,
                blockedStepIndex: stepIndex,
                blockedStep: step.position,
            };
        }
        const assessment = assessMiningRouteStep(bot, step, targetBlock, {
            allowNaturalFoliage: allowNaturalFoliageExcavation === true,
            protectedGeometry,
        });
        if (!assessment.ok) {
            return {
                ...assessment,
                route,
                stance,
                origin,
                safePrefixLength: stepIndex,
                excavationBlocks: [...excavation.values()],
                stepExcavationBlocks,
                stepEstimatedDigMs,
                blockedStepIndex: stepIndex,
                blockedStep: step.position,
            };
        }
        for (const block of assessment.supportBlocks || []) {
            bindRequiredSupport(block, step.position);
        }
        const newlyBoundBlocks = [];
        for (const block of assessment.blocks) {
            const key = miningCellKey(block.position);
            if (excavation.has(key)) continue;
            excavation.set(key, block);
            newlyBoundBlocks.push(block);
        }
        stepExcavationBlocks.push(newlyBoundBlocks);
        stepEstimatedDigMs.push(newlyBoundBlocks.reduce(
            (total, block) => total + Math.max(
                50,
                collectionBreakTime(
                    bot,
                    block,
                    selectMiningRouteTool(bot, block, targetBlock),
                ),
            ),
            0,
        ));
        previous = step.position;
    }
    if (stageFallingDebris) {
        for (let index = 1; index < route.length; index += 1) {
            if (route[index].yOffset <= 0) continue;
            const stagingCell = route[index - 1].position;
            const precleared = stepExcavationBlocks[index].filter(block => (
                block.position.x === stagingCell.x
                && block.position.z === stagingCell.z
                && block.position.y >= stagingCell.y + 2
            ));
            if (precleared.length === 0) continue;
            const preclearedKeys = new Set(precleared.map(block => miningCellKey(block.position)));
            stepExcavationBlocks[index] = stepExcavationBlocks[index]
                .filter(block => !preclearedKeys.has(miningCellKey(block.position)));
            stepExcavationBlocks[index - 1] = [...new Map([
                ...stepExcavationBlocks[index - 1],
                ...precleared,
            ].map(block => [miningCellKey(block.position), block])).values()];
        }
        stepEstimatedDigMs.splice(
            0,
            stepEstimatedDigMs.length,
            ...stepExcavationBlocks.map(blocks => blocks.reduce(
                (total, block) => total + Math.max(
                    50,
                    collectionBreakTime(
                        bot,
                        block,
                        selectMiningRouteTool(bot, block, targetBlock),
                    ),
                ),
                0,
            )),
        );
    }
    const surfaceDisturbance = assessMiningSurfaceDisturbance(bot, stepExcavationBlocks);
    if (!surfaceDisturbance.ok) {
        return {
            ...surfaceDisturbance,
            route,
            stance,
            origin,
            excavationBlocks: [...excavation.values()],
            stepExcavationBlocks,
            stepEstimatedDigMs,
        };
    }
    if (!sameMiningCell(stance, previous)) {
        return { ok: false, outcome: 'route_misses_target_stance', route, stance };
    }
    if (targetBlock?.position && miningRouteTouchesLiquid(bot, [targetBlock.position])) {
        return { ok: false, outcome: 'target_liquid_ingress_risk', route, stance };
    }
    if (
        breakTarget
        && targetBlock?.position
        && protectedGeometry?.has(miningCellKey(targetBlock.position))
    ) {
        return {
            ok: false,
            outcome: 'preserved_return_route_conflict',
            route,
            stance,
            origin,
            conflictBlock: targetBlock.position,
        };
    }

    const excavationBlocks = [...excavation.values()];
    const supportConflict = excavationBlocks.find(block => (
        requiredSupports.has(miningCellKey(block.position))
    ));
    if (supportConflict) {
        const conflict = requiredSupports.get(miningCellKey(supportConflict.position));
        return {
            ok: false,
            outcome: 'route_support_excavation_conflict',
            route,
            stance,
            origin,
            conflictBlock: supportConflict.position,
            conflictStandingCell: conflict.standingCell,
        };
    }
    const excavationBudget = excavationBlocks.length;
    const plannedBreaks = breakTarget && targetBlock
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
    const durability = assessMiningRouteDurability(bot, excavationBlocks, {
        allowReplacementBootstrapReserve,
        allowUnharvestedBreaks,
        targetBlock,
    });
    if (!durability.ok) return { ...durability, route, stance, blockBudget };

    const estimatedRouteDigMs = excavationBlocks.reduce(
        (total, block) => total + Math.max(
            50,
            collectionBreakTime(
                bot,
                block,
                selectMiningRouteTool(bot, block, targetBlock),
            ),
        ),
        0,
    );
    const estimatedTargetDigMs = breakTarget && targetBlock
        ? Math.max(50, collectionBreakTime(bot, targetBlock))
        : 0;
    const estimatedDigMs = estimatedRouteDigMs + estimatedTargetDigMs;
    const estimatedReturnMs = Math.ceil(route.length * MINING_ROUTE_STEP_ESTIMATE_MS);
    const estimatedDurationMs = Math.ceil(estimatedDigMs + estimatedReturnMs);
    if (
        estimatedDurationMs
        + estimatedReturnMs
        + MINING_ROUTE_DEADLINE_RESERVE_MS
        > remainingActionTimeMs()
    ) {
        return {
            ok: false,
            outcome: 'route_deadline_insufficient',
            route,
            stance,
            origin,
            excavationBlocks,
            excavationBudget,
            stepExcavationBlocks,
            stepEstimatedDigMs,
            blockBudget,
            estimatedDurationMs,
            estimatedReturnMs,
            estimatedTargetDigMs,
            durability,
            protectedGeometry,
            allowUnharvestedBreaks,
            allowNaturalFoliageExcavation: allowNaturalFoliageExcavation === true,
            stageFallingDebris: stageFallingDebris === true,
        };
    }
    return {
        ok: true,
        outcome: 'route_ready',
        route,
        stance,
        origin,
        excavationBlocks,
        excavationBudget,
        stepExcavationBlocks,
        stepEstimatedDigMs,
        blockBudget,
        breakTarget,
        estimatedDurationMs,
        estimatedReturnMs,
        estimatedTargetDigMs,
        durability,
        protectedGeometry,
        allowUnharvestedBreaks,
        allowNaturalFoliageExcavation: allowNaturalFoliageExcavation === true,
        stageFallingDebris: stageFallingDebris === true,
        surfaceDisturbance,
    };
}

export function selectMiningDeadlinePrefix(plan, remainingMs) {
    if (
        plan?.outcome !== 'route_deadline_insufficient'
        || !Array.isArray(plan.route)
        || plan.route.length < 2
        || !Array.isArray(plan.stepExcavationBlocks)
        || !Array.isArray(plan.stepEstimatedDigMs)
    ) return null;

    const availableMs = Math.max(0, Number(remainingMs) || 0);
    const maximumPrefixLength = plan.route.length - 1;
    const totalStepDigMs = plan.stepEstimatedDigMs.reduce(
        (total, duration) => total + Math.max(0, Number(duration) || 0),
        0,
    );
    const targetDigMs = Math.max(0, Number(plan.estimatedTargetDigMs) || 0);
    let cumulativeDigMs = 0;
    let longestSafe = null;
    let bridgingPrefix = null;

    for (let length = 1; length <= maximumPrefixLength; length += 1) {
        cumulativeDigMs += Math.max(0, Number(plan.stepEstimatedDigMs[length - 1]) || 0);
        const traversalMs = length * MINING_ROUTE_STEP_ESTIMATE_MS;
        const requiredMs = cumulativeDigMs
            + (traversalMs * 2)
            + MINING_ROUTE_DEADLINE_RESERVE_MS;
        if (requiredMs > availableMs) break;

        const estimatedExecutionMs = cumulativeDigMs + traversalMs;
        const postRemainingMs = Math.max(0, availableMs - estimatedExecutionMs);
        const remainingSteps = plan.route.length - length;
        const remainingDigMs = totalStepDigMs - cumulativeDigMs + targetDigMs;
        const postRouteRequiredMs = remainingDigMs
            + (remainingSteps * MINING_ROUTE_STEP_ESTIMATE_MS * 2)
            + MINING_ROUTE_DEADLINE_RESERVE_MS;
        const candidate = {
            length,
            requiredMs,
            estimatedExecutionMs,
            estimatedPostRemainingMs: postRemainingMs,
            estimatedPostRouteRequiredMs: postRouteRequiredMs,
        };
        longestSafe = candidate;
        if (!bridgingPrefix && postRouteRequiredMs <= postRemainingMs) {
            bridgingPrefix = candidate;
        }
    }

    const selected = bridgingPrefix || longestSafe;
    if (!selected) return null;
    const route = plan.route.slice(0, selected.length);
    const stepExcavationBlocks = plan.stepExcavationBlocks.slice(0, selected.length);
    const excavationBlocks = stepExcavationBlocks.flat();
    return {
        ...plan,
        ok: true,
        outcome: 'route_prefix_ready',
        route,
        stance: route.at(-1).position,
        excavationBlocks,
        excavationBudget: excavationBlocks.length,
        stepExcavationBlocks,
        stepEstimatedDigMs: plan.stepEstimatedDigMs.slice(0, selected.length),
        blockBudget: excavationBlocks.length,
        breakTarget: false,
        partial: true,
        prefix: selected,
    };
}

function buildMiningAccessPlan(bot, targetBlock, requestedLength, options = {}) {
    const origin = observedSupportedStandingCell(bot);
    if (!origin) return { ok: false, outcome: 'position_unavailable' };
    const originSupport = assessAnchoredGameplaySupport(
        bot,
        bot.blockAt(origin.offset(0, -1, 0)),
    );
    if (!originSupport.ok) return { ok: false, outcome: 'origin_support_unsafe' };
    const stances = Array.isArray(options.stances)
        ? options.stances.filter(position => position?.offset)
        : prospectiveMiningStandingPositions(bot, targetBlock);
    if (stances.length === 0) return { ok: false, outcome: 'no_safe_stance' };
    const protectedGeometry = protectedMiningReturnGeometry(options.preservedReturnRoute);

    const maximumSteps = Number.isFinite(Number(options.maxRouteSteps))
        ? Math.max(1, Math.floor(Number(options.maxRouteSteps)))
        : Math.max(...stances.map(stance => Math.max(
            4,
            Math.abs(stance.y - origin.y) + requestedLength + 2,
        )));
    const assessSearchStep = step => {
        if (
            options.stageFallingDebris === true
            && step.yOffset > 0
            && sameMiningCell(miningStepSourcePosition(step), origin)
        ) {
            const debris = fallingDebrisAboveStandingCell(bot, origin);
            if (debris) {
                return {
                    ok: false,
                    outcome: 'falling_debris_above_origin',
                    blockedBy: debris.name,
                    blocks: [],
                };
            }
        }
        return assessMiningRouteStep(bot, step, targetBlock, {
            allowNaturalFoliage: options.allowNaturalFoliageExcavation === true,
            protectedGeometry,
        });
    };
    const search = searchSupportedMiningVoxelCorridors({
        origin,
        stances,
        assessStep: assessSearchStep,
        maxRouteSteps: maximumSteps,
        maxExcavationBlocks: MAX_MINING_EXCAVATION_BLOCKS,
        maxExpansions: MAX_MINING_CORRIDOR_EXPANSIONS,
        maxSolutions: MAX_MINING_CORRIDOR_SOLUTIONS,
        maxDetour: MAX_MINING_CORRIDOR_DETOUR,
        initialSupportBlocks: originSupport.blocks,
    });
    const assessments = search.solutions.map(solution => assessMiningAccessPlan(
        bot,
        origin,
        targetBlock,
        solution.stance,
        solution.route,
        requestedLength,
        { ...options, protectedGeometry },
    ));
    const routeOutcomes = {};
    for (const assessment of assessments) {
        const outcome = String(assessment?.outcome || 'unknown');
        routeOutcomes[outcome] = (routeOutcomes[outcome] || 0) + 1;
    }
    const diagnostics = {
        consideredRoutes: assessments.length,
        consideredStates: search.consideredStates,
        expandedStates: search.expandedStates,
        routeOutcomes,
        searchRejections: search.rejectionOutcomes,
        searchLimitReached: search.expansionLimitReached,
    };
    const viable = assessments
        .filter(assessment => assessment.ok)
        .sort((left, right) => (
            left.blockBudget - right.blockBudget
            || left.route.length - right.route.length
            || left.estimatedDurationMs - right.estimatedDurationMs
        ));
    if (viable.length > 0) return { ...viable[0], ...diagnostics };
    const toolBlocked = assessments.find(
        assessment => assessment.outcome === 'insufficient_tool_durability',
    );
    if (toolBlocked) return { ...toolBlocked, ...diagnostics };
    const deadlineBlocked = assessments.find(
        assessment => assessment.outcome === 'route_deadline_insufficient',
    );
    if (deadlineBlocked) return { ...deadlineBlocked, ...diagnostics };
    const rejected = assessments[0] || {
        ok: false,
        outcome: search.expansionLimitReached
            ? 'corridor_search_exhausted'
            : 'no_safe_route',
    };
    return {
        ...rejected,
        ...diagnostics,
    };
}

function isMiningRouteCellReturnable(bot, position) {
    return Boolean(
        position
        && isCollectionStandingCellClear(bot.blockAt(position))
        && isCollectionStandingCellClear(bot.blockAt(position.offset(0, 1, 0)))
        && isAnchoredGameplaySupport(bot, bot.blockAt(position.offset(0, -1, 0)))
        && !miningRouteTouchesLiquid(bot, [position, position.offset(0, 1, 0)])
    );
}

function clearedMiningMovements(bot) {
    const movements = safeMovements(bot);
    movements.canDig = false;
    movements.allow1by1towers = false;
    movements.allowParkour = false;
    movements.allowSprinting = false;
    // The deterministic corridor contract preflights only cardinal adjacent
    // cells with at most one vertical block per step. Pathfinder owns motion
    // through that exact geometry, not a multi-block shortcut into an open
    // cave or liquid column.
    movements.maxDropDown = Math.min(
        Number(movements.maxDropDown) || DEFAULT_MAX_DROP_DOWN,
        1,
    );
    movements.infiniteLiquidDropdownDistance = false;
    return movements;
}

function monotonicSurfaceMovements(bot) {
    const movements = clearedMiningMovements(bot);
    // Surface recovery must not turn a failed ascent into a damaging cave
    // descent. Buried-resource corridors retain their separately preflighted
    // descending steps through clearedMiningMovements().
    movements.maxDropDown = 0;
    movements.infiniteLiquidDropdownDistance = false;
    return movements;
}

async function traverseClearedMiningCell(bot, step) {
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
        observed,
        reached,
        onGround: bot.entity?.onGround === true,
    };
}

function fallingBlockEntitiesInMiningCell(bot, target) {
    return Object.values(bot.entities || {}).filter(entity => (
        entity?.name === 'falling_block'
        && entity.position
        && Math.floor(entity.position.x) === target.x
        && Math.floor(entity.position.z) === target.z
        && entity.position.y >= target.y - 0.5
        && entity.position.y <= target.y + MAX_MINING_FALLING_COLUMN + 2
    ));
}

async function restorePreservedMiningRouteCell(bot, target) {
    const feet = target;
    const head = target.offset(0, 1, 0);
    const support = target.offset(0, -1, 0);
    const supportBlock = bot.blockAt(support);
    if (!isAnchoredGameplaySupport(bot, supportBlock)) {
        return { success: false, outcome: 'return_route_support_changed', cleared: 0 };
    }
    if (miningRouteTouchesLiquid(bot, [feet, head])) {
        return { success: false, outcome: 'return_route_liquid_risk', cleared: 0 };
    }

    let cleared = 0;
    let settlementPending = false;
    while (true) {
        if (bot.interrupt_code) {
            return { success: false, outcome: 'interrupted', cleared };
        }
        if (isMiningRouteCellReturnable(bot, target)) {
            const fallingEntities = fallingBlockEntitiesInMiningCell(bot, target);
            if (fallingEntities.length > 0) {
                const settled = await waitForWorldCondition(
                    bot,
                    () => fallingBlockEntitiesInMiningCell(bot, target).length === 0,
                    GROUND_SETTLE_TIMEOUT_MS,
                    25,
                );
                if (!settled) {
                    return {
                        success: false,
                        outcome: bot.interrupt_code ? 'interrupted' : 'return_route_debris_unsettled',
                        cleared,
                    };
                }
                settlementPending = true;
                continue;
            }
            if (!settlementPending) {
                return {
                    success: true,
                    outcome: cleared > 0 ? 'return_route_debris_restored' : 'return_route_ready',
                    cleared,
                };
            }
            await interruptibleDelay(
                bot,
                Math.min(
                    GROUND_SETTLE_TIMEOUT_MS,
                    FALLING_BLOCK_SETTLE_MS * MAX_MINING_FALLING_COLUMN,
                ),
            );
            settlementPending = false;
            continue;
        }
        const blocked = [bot.blockAt(feet), bot.blockAt(head)]
            .filter(block => block && !isCollectionStandingCellClear(block))
            .sort((left, right) => left.position.y - right.position.y);
        const lowest = blocked[0] || null;
        if (!lowest || !isFallingGameplayBlock(lowest)) {
            return { success: false, outcome: 'return_route_changed', cleared };
        }
        const column = boundedFallingRouteColumn(bot, lowest.position);
        if (!column.ok || column.blocks.length === 0) {
            return { success: false, outcome: column.outcome, cleared };
        }
        if (cleared >= MAX_MINING_FALLING_COLUMN) {
            return { success: false, outcome: 'return_route_debris_limit', cleared };
        }
        if (miningRouteTouchesLiquid(bot, column.blocks.map(block => block.position))) {
            return {
                success: false,
                outcome: 'return_route_liquid_risk',
                cleared,
            };
        }
        if (!await breakBlockAt(
            bot,
            lowest.position.x,
            lowest.position.y,
            lowest.position.z,
            {
                requireHarvest: false,
                acceptFallingReplacement: true,
            },
        )) {
            return { success: false, outcome: 'return_route_debris_not_cleared', cleared };
        }
        cleared += 1;
        settlementPending = true;
    }
}

export async function traverseMiningRouteCell(bot, x, y, z) {
    const target = new Vec3(
        Math.floor(Number(x)),
        Math.floor(Number(y)),
        Math.floor(Number(z)),
    );
    if (![target.x, target.y, target.z].every(Number.isFinite)) {
        setActionEvidence(bot, {
            kind: 'mining_return',
            outcome: 'invalid_route_cell',
            target: { name: 'mining_return_cell', x, y, z },
            retryable: false,
        });
        return false;
    }
    const fallingEntitiesObserved = fallingBlockEntitiesInMiningCell(bot, target).length;
    if (fallingEntitiesObserved > 0) {
        const settled = await waitForWorldCondition(
            bot,
            () => fallingBlockEntitiesInMiningCell(bot, target).length === 0,
            GROUND_SETTLE_TIMEOUT_MS,
            25,
        );
        if (!settled) {
            setActionEvidence(bot, {
                kind: 'mining_return',
                outcome: bot.interrupt_code ? 'interrupted' : 'return_route_debris_unsettled',
                target: { name: 'mining_return_cell', x: target.x, y: target.y, z: target.z },
                fallingEntitiesObserved,
                retryable: !bot.interrupt_code,
            });
            log(bot, `Falling debris did not settle clear of preserved mining cell ${target.x}, ${target.y}, ${target.z}.`);
            return false;
        }
    }
    const restoration = await restorePreservedMiningRouteCell(bot, target);
    if (!restoration.success) {
        setActionEvidence(bot, {
            kind: 'mining_return',
            outcome: restoration.outcome,
            target: { name: 'mining_return_cell', x: target.x, y: target.y, z: target.z },
            debrisRestored: restoration.cleared,
            retryable: false,
        });
        log(bot, `The preserved mining return cell at ${target.x}, ${target.y}, ${target.z} could not be safely restored (${restoration.outcome.replace(/_/g, ' ')}).`);
        return false;
    }
    const traversal = await traverseClearedMiningCell(bot, target);
    if (traversal.success && (fallingEntitiesObserved > 0 || restoration.cleared > 0)) {
        // The relevant falling column changed during this action. Give the
        // authoritative world one final bounded settlement interval before
        // checkpointing the route index; otherwise gravel can push the bot
        // backward immediately after ActionManager releases ownership.
        await interruptibleDelay(bot, FALLING_BLOCK_SETTLE_MS);
    }
    const success = Boolean(
        traversal.success === true
        && !bot.interrupt_code
        && fallingBlockEntitiesInMiningCell(bot, target).length === 0
        && physicallyOccupiesStandingCell(bot, target)
        && isMiningRouteCellReturnable(bot, target)
    );
    setActionEvidence(bot, {
        kind: 'mining_return',
        outcome: success
            ? 'route_cell_returned'
            : traversal.success
                ? 'return_route_settlement_changed'
                : traversal.outcome,
        target: { name: 'mining_return_cell', x: target.x, y: target.y, z: target.z },
        observedPosition: traversal.observed || null,
        fallingEntitiesObserved,
        debrisRestored: restoration.cleared,
        returnable: success,
        routeDigging: restoration.cleared > 0,
        retryable: !success && !bot.interrupt_code,
    });
    log(bot, success
        ? `Returned through preserved mining cell ${target.x}, ${target.y}, ${target.z}${restoration.cleared > 0 ? ` after clearing ${restoration.cleared} settled debris block${restoration.cleared === 1 ? '' : 's'}` : ''}.`
        : `Could not settle on preserved mining cell ${target.x}, ${target.y}, ${target.z}.`);
    return success;
}

async function traverseClearedMiningStep(bot, route, stepIndex) {
    const traversal = await traverseClearedMiningCell(bot, route[stepIndex]?.position);
    return {
        ...traversal,
        landedIndex: traversal.success ? stepIndex : stepIndex - 1,
    };
}

async function retreatMiningAccessRoute(bot, plan, lastReachedIndex) {
    const origin = plan?.origin;
    if (!origin) return { attempted: false, success: false, outcome: 'return_origin_unavailable' };
    if (bot.interrupt_code) {
        return { attempted: false, success: false, outcome: 'return_interrupted' };
    }

    const targets = [];
    for (let index = lastReachedIndex; index >= 0; index -= 1) {
        targets.push({ position: plan.route[index].position, routeIndex: index });
    }
    targets.push({ position: origin, routeIndex: -1 });

    let retreatedSteps = 0;
    for (const target of targets) {
        if (physicallyOccupiesStandingCell(bot, target.position)) continue;
        if (remainingActionTimeMs() <= GROUND_SETTLE_TIMEOUT_MS + 250) {
            return {
                attempted: true,
                success: false,
                outcome: 'return_deadline',
                retreatedSteps,
                failedRouteIndex: target.routeIndex,
                target: target.position,
            };
        }
        if (!isMiningRouteCellReturnable(bot, target.position)) {
            return {
                attempted: true,
                success: false,
                outcome: 'return_cell_unsafe',
                retreatedSteps,
                failedRouteIndex: target.routeIndex,
                target: target.position,
            };
        }
        const traversal = await traverseClearedMiningCell(bot, target.position);
        if (!traversal.success) {
            return {
                attempted: true,
                success: false,
                outcome: traversal.outcome,
                retreatedSteps,
                failedRouteIndex: target.routeIndex,
                target: target.position,
                observed: traversal.observed,
                reached: traversal.reached,
                onGround: traversal.onGround,
            };
        }
        retreatedSteps += 1;
    }
    return {
        attempted: true,
        success: physicallyOccupiesStandingCell(bot, origin),
        outcome: physicallyOccupiesStandingCell(bot, origin)
            ? 'return_origin_reached'
            : 'return_origin_unverified',
        retreatedSteps,
        target: origin,
        observed: bot.entity?.position?.clone?.() || null,
    };
}

function miningRouteInventoryRequirement(bot, plan, targetBlock) {
    const routeBlocks = Array.isArray(plan?.excavationBlocks)
        ? plan.excavationBlocks
        : [];
    const plannedBlocks = [
        ...routeBlocks,
        ...(plan?.breakTarget === true && targetBlock ? [targetBlock] : []),
    ];
    const expectedCounts = new Map();
    for (const block of plannedBlocks) {
        for (const type of Array.isArray(block?.drops) ? block.drops : []) {
            const name = Number.isInteger(type) ? mc.getItemName(type) : null;
            if (!name) continue;
            // Multiple possible drops are deliberately all reserved. The
            // route preflight must remain safe across gravel/flint and similar
            // server-side drop choices.
            expectedCounts.set(name, (expectedCounts.get(name) || 0) + 1);
        }
    }
    let additionalSlots = 0;
    for (const [name, expected] of expectedCounts) {
        const definition = bot.registry?.itemsByName?.[name];
        const stackSize = Math.max(1, Number(definition?.stackSize) || 64);
        const partialCapacity = bot.inventory.items()
            .filter(item => item.name === name)
            .reduce((total, item) => (
                total + Math.max(0, (Number(item.stackSize) || stackSize) - item.count)
            ), 0);
        additionalSlots += Math.ceil(Math.max(0, expected - partialCapacity) / stackSize);
    }
    return {
        expectedDrops: [...expectedCounts.keys()].sort(),
        requiredFreeSlots: Math.max(
            MINING_COLLECTION_SLOT_RESERVE,
            Math.min(12, additionalSlots + 1),
        ),
    };
}

async function executeMiningAccessPlan(bot, targetBlock, plan) {
    const capacity = miningRouteInventoryRequirement(bot, plan, targetBlock);
    if (bot.inventory.emptySlotCount() < capacity.requiredFreeSlots) {
        const protectedNames = new Set([
            ...familyInventoryEntries(bot, 'ores').map(entry => entry.name),
            ...(targetBlock?.drops || [])
                .map(type => Number.isInteger(type) ? mc.getItemName(type) : null)
                .filter(Boolean),
        ]);
        const released = await freeCollectionWorkingSlots(
            bot,
            protectedNames,
            capacity.requiredFreeSlots,
            {
                allowLocalCache: false,
                requireDisposalSeparation: false,
                preferBulkNaturalFill: true,
                // Toss redundant fill behind the route so native traversal
                // immediately carries the bot away from passive pickup range.
                resumePosition: plan.route?.[0]?.position || null,
            },
        );
        if (!released || bot.inventory.emptySlotCount() < capacity.requiredFreeSlots) {
            return {
                success: false,
                outcome: 'inventory_full',
                requiredFreeSlots: capacity.requiredFreeSlots,
                observedFreeSlots: bot.inventory.emptySlotCount(),
                expectedDrops: capacity.expectedDrops,
            };
        }
    }
    let excavated = 0;
    let nextIndex = 0;
    let lastReachedIndex = -1;
    const fail = async (outcome, extra = {}) => {
        const retreat = await retreatMiningAccessRoute(bot, plan, lastReachedIndex);
        return {
            success: false,
            outcome: retreat.attempted && !retreat.success
                ? 'return_route_failed'
                : outcome,
            failureOutcome: outcome,
            excavated,
            retreat,
            ...extra,
        };
    };
    while (nextIndex < plan.route.length) {
        const returnReserveMs = (
            (lastReachedIndex + 2) * MINING_ROUTE_STEP_ESTIMATE_MS
        ) + GROUND_SETTLE_TIMEOUT_MS;
        if (bot.interrupt_code) {
            return await fail('interrupted');
        }
        if (remainingActionTimeMs() <= returnReserveMs) {
            return await fail('deadline');
        }
        let liveTarget = null;
        if (targetBlock?.position) {
            liveTarget = bot.blockAt(targetBlock.position);
            if (!liveTarget || liveTarget.name !== targetBlock.name) {
                return await fail('target_changed');
            }
        }
        const step = plan.route[nextIndex];
        const occupiedCell = observedSupportedStandingCell(bot);
        if (!occupiedCell) return await fail('position_unavailable');
        const assessment = assessMiningRouteStep(bot, step, liveTarget, {
            allowNaturalFoliage: plan.allowNaturalFoliageExcavation === true,
            protectedGeometry: plan.protectedGeometry,
        });
        if (!assessment.ok) {
            return await fail(assessment.outcome, {
                stepIndex: nextIndex,
                step: step.position,
            });
        }
        let boundBlocks = [...assessment.blocks];
        const nextStep = plan.route[nextIndex + 1] || null;
        if (plan.stageFallingDebris === true && nextStep?.yOffset > 0) {
            const nextAssessment = assessMiningRouteStep(bot, nextStep, liveTarget, {
                allowNaturalFoliage: plan.allowNaturalFoliageExcavation === true,
                protectedGeometry: plan.protectedGeometry,
            });
            if (!nextAssessment.ok) {
                return await fail(`next_step_${nextAssessment.outcome}`, {
                    stepIndex: nextIndex + 1,
                    step: nextStep.position,
                });
            }
            boundBlocks.push(...nextAssessment.blocks.filter(block => (
                block.position.x === step.position.x
                && block.position.z === step.position.z
                && block.position.y >= step.position.y + 2
            )));
        }
        const authorizedPositions = [...new Map(boundBlocks.map(block => (
            [miningCellKey(block.position), block.position]
        ))).values()];
        const fallingDebrisBound = boundBlocks.some(isFallingGameplayBlock);
        let clearSettlementObserved = !fallingDebrisBound;
        while (true) {
            if (bot.interrupt_code) return await fail('interrupted');
            if (remainingActionTimeMs() <= returnReserveMs) return await fail('deadline');
            const liveBlockObservations = authorizedPositions.map(position => bot.blockAt(position));
            if (liveBlockObservations.some(block => !block)) {
                return await fail('route_changed_unsafe');
            }
            const liveBlocks = liveBlockObservations
                .filter(block => !isCollectionStandingCellClear(block));
            if (liveBlocks.length === 0) {
                if (!clearSettlementObserved) {
                    await interruptibleDelay(bot, FALLING_BLOCK_SETTLE_MS);
                    clearSettlementObserved = true;
                    continue;
                }
                break;
            }
            clearSettlementObserved = !fallingDebrisBound;
            const occupiedFallingBlock = liveBlocks.find(block => (
                isFallingGameplayBlock(block)
                && block.position.x === occupiedCell.x
                && block.position.z === occupiedCell.z
            ));
            if (occupiedFallingBlock) {
                return await fail('falling_debris_above_occupied_cell', {
                    stepIndex: nextIndex,
                    step: step.position,
                    blockedBy: occupiedFallingBlock.name,
                    blockedBlock: occupiedFallingBlock.position,
                });
            }
            // Clear the lowest reachable layer first. For bounded falling
            // columns, the next layer may settle into the same coordinate;
            // breakBlockAt verifies that the column height decreased before
            // this loop charges the excavation or continues.
            const liveBlock = liveBlocks
                .filter(block => bot.entity.position.distanceTo(block.position) <= 4.5)
                .sort((left, right) => (
                    left.position.y - right.position.y
                    || bot.entity.position.distanceTo(left.position)
                        - bot.entity.position.distanceTo(right.position)
                ))[0];
            if (!liveBlock) {
                const nearest = liveBlocks.sort((left, right) => (
                    bot.entity.position.distanceTo(left.position)
                    - bot.entity.position.distanceTo(right.position)
                ))[0];
                return await fail('route_step_out_of_reach', {
                    stepIndex: nextIndex,
                    step: step.position,
                    blockedBy: nearest?.name,
                    blockedBlock: nearest?.position,
                    blockedDistance: nearest
                        ? bot.entity.position.distanceTo(nearest.position)
                        : null,
                });
            }
            if (excavated >= plan.excavationBudget) {
                return await fail('excavation_budget_exceeded');
            }
            if (!await breakBlockAt(
                bot,
                liveBlock.position.x,
                liveBlock.position.y,
                liveBlock.position.z,
                {
                    requireHarvest: plan.allowUnharvestedBreaks !== true,
                    acceptFallingReplacement: true,
                    preserveTargetToolFor: liveTarget,
                },
            )) return await fail('route_block_not_broken');
            excavated += 1;
        }

        const traversal = await traverseClearedMiningStep(bot, plan.route, nextIndex);
        if (!traversal.success) {
            return await fail(traversal.outcome, {
                stepIndex: nextIndex,
                step: step.position,
                observed: traversal.observed,
                reached: traversal.reached,
                onGround: traversal.onGround,
            });
        }
        lastReachedIndex = traversal.landedIndex;
        for (let index = 0; index <= traversal.landedIndex; index += 1) {
            if (!isMiningRouteCellReturnable(bot, plan.route[index].position)) {
                return await fail('return_route_changed', {
                    stepIndex: index,
                    step: plan.route[index].position,
                });
            }
        }
        const previousIndex = nextIndex;
        nextIndex += 1;
        if (nextIndex <= previousIndex) {
            return await fail('non_convergent_step');
        }
    }
    if (plan.partial) {
        return {
            success: true,
            outcome: 'route_advanced',
            excavated,
            reachedSteps: nextIndex,
            target: targetBlock?.position ? bot.blockAt(targetBlock.position) : null,
            observed: bot.entity?.position?.clone?.() || null,
        };
    }
    if (!targetBlock?.position) {
        const reached = Boolean(
            physicallyOccupiesStandingCell(bot, plan.stance)
            && isMiningRouteCellReturnable(bot, plan.stance)
        );
        return reached
            ? {
                success: true,
                outcome: 'stance_reached',
                excavated,
                reachedSteps: nextIndex,
                observed: bot.entity?.position?.clone?.() || null,
            }
            : await fail('stance_unverified');
    }
    const finalTarget = bot.blockAt(targetBlock.position);
    if (!finalTarget || finalTarget.name !== targetBlock.name) {
        return await fail('target_changed');
    }
    if (!isMiningTargetExposed(bot, finalTarget)) {
        return await fail('target_not_exposed');
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
            consideredRoutes: plan.consideredRoutes || 0,
            consideredStates: plan.consideredStates || 0,
            expandedStates: plan.expandedStates || 0,
            routeOutcomes: plan.routeOutcomes || null,
            searchRejections: plan.searchRejections || null,
            searchLimitReached: plan.searchLimitReached === true,
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
    options = {},
) {
    const requested = String(resourceName || '').trim().toLowerCase();
    const requestedLength = Math.max(4, Math.min(32, Math.floor(Number(length) || MINING_TUNNEL_LENGTH)));
    const requestedBlocks = miningTargetBlockNames(requested);
    const preservedReturnRoute = normalizePreservedMiningReturnRoute(options.preservedReturnRoute);
    const excludedTargets = normalizeCollectionExclusions(options.excludedTargets);
    const expectedProtectedRouteCells = Number.isFinite(options.expectedProtectedRouteCells)
        ? Math.max(0, Math.floor(options.expectedProtectedRouteCells))
        : null;
    if (
        expectedProtectedRouteCells !== null
        && expectedProtectedRouteCells !== preservedReturnRoute.length
    ) {
        setActionEvidence(bot, {
            kind: 'mining_search',
            outcome: 'preserved_return_route_changed',
            target: { name: requested || 'resource' },
            expectedProtectedRouteCells,
            observedProtectedRouteCells: preservedReturnRoute.length,
            routeDigging: true,
            retryable: true,
        });
        return false;
    }
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
        : nearestKnownMiningTarget(bot, requested, excludedTargets);
    if (knownTarget) {
        const staged = await stageMiningStaircase(bot, knownTarget);
        if (!staged) {
            setActionEvidence(bot, {
                kind: 'mining_search',
                targetBound: true,
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
                targetBound: true,
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

        const finalStances = prospectiveMiningStandingPositions(bot, stagedTarget);
        const origin = observedSupportedStandingCell(bot);
        const fullRouteLowerBound = minimumMiningCorridorSteps(origin, finalStances);
        const progressStances = fullRouteLowerBound > MAX_MINING_PROGRESS_ROUTE_STEPS
            ? boundedMiningProgressStances(bot, stagedTarget, finalStances)
            : [];
        let plan = progressStances.length > 0
            ? buildMiningAccessPlan(bot, stagedTarget, 4, {
                breakTarget: false,
                stances: progressStances,
                maxRouteSteps: MAX_MINING_PROGRESS_ROUTE_STEPS,
                preservedReturnRoute,
            })
            : buildMiningAccessPlan(bot, stagedTarget, requestedLength, { preservedReturnRoute });
        if (progressStances.length > 0 && plan.ok) {
            plan = {
                ...plan,
                partial: true,
                boundary: {
                    kind: 'bounded_target_convergence',
                    fullRouteLowerBound,
                },
                plannedRouteSteps: fullRouteLowerBound,
            };
        }
        const plannedRouteSteps = plan.plannedRouteSteps || plan.route?.length || 0;
        let partialAdvance = plan.partial === true;
        if (!plan.ok && plan.outcome === 'route_deadline_insufficient') {
            const prefix = selectMiningDeadlinePrefix(plan, remainingActionTimeMs());
            if (prefix) {
                plan = prefix;
                partialAdvance = true;
            }
        }
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
                targetBound: true,
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
                safePrefixLength: plan.safePrefixLength || 0,
                blockedStepIndex: Number.isFinite(plan.blockedStepIndex)
                    ? plan.blockedStepIndex
                    : null,
                blockedStep: plan.blockedStep || null,
                consideredRoutes: plan.consideredRoutes || 0,
                consideredStates: plan.consideredStates || 0,
                expandedStates: plan.expandedStates || 0,
                routeOutcomes: plan.routeOutcomes || null,
                searchRejections: plan.searchRejections || null,
                searchLimitReached: plan.searchLimitReached === true,
                ...(toolRequirement ? { toolRequirement } : {}),
                routeDigging: true,
                retryable: !bot.interrupt_code,
            });
            const dominantRoutes = Object.entries(plan.routeOutcomes || {})
                .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
                .slice(0, 4)
                .map(([outcome, count]) => `${outcome}:${count}`)
                .join(', ');
            const dominantSearchRejections = Object.entries(plan.searchRejections || {})
                .filter(([outcome]) => ![
                    'corridor_bounds',
                    'route_cell_revisited',
                    'route_step_budget_exceeded',
                ].includes(outcome))
                .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
                .slice(0, 4)
                .map(([outcome, count]) => `${outcome}:${count}`)
                .join(', ');
            const searchSummary = dominantRoutes || dominantSearchRejections;
            log(
                bot,
                `Rejected the known ${stagedTarget.name} target before excavation: ${String(plan.outcome || 'no safe route').replace(/_/g, ' ')}`
                + `${searchSummary ? ` (${plan.consideredRoutes} completed routes, ${plan.expandedStates || 0} states; ${searchSummary})` : ''}.`,
            );
            return false;
        }

        const routeStart = bot.entity.position.clone();
        const access = await executeMiningAccessPlan(bot, stagedTarget, plan);
        if (!access.success) {
            setActionEvidence(bot, {
                kind: 'mining_search',
                targetBound: true,
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
                estimatedReturnMs: plan.estimatedReturnMs,
                durability: plan.durability,
                failedStepIndex: Number.isFinite(access.stepIndex) ? access.stepIndex : null,
                failedStep: access.step || null,
                accessFailureOutcome: access.failureOutcome || access.outcome,
                retreat: access.retreat || null,
                observedPosition: access.observed || null,
                pathfinderReached: access.reached ?? null,
                onGround: access.onGround ?? null,
                routeDigging: true,
                retryable: !bot.interrupt_code,
            });
            const failedStep = access.step
                ? ` at step ${Number(access.stepIndex) + 1} (${access.step.x}, ${access.step.y}, ${access.step.z}) from (${bot.entity.position.x.toFixed(2)}, ${bot.entity.position.y.toFixed(2)}, ${bot.entity.position.z.toFixed(2)})`
                : '';
            const returnDetail = access.retreat?.attempted
                ? access.retreat.success
                    ? ` Returned to the route origin in ${access.retreat.retreatedSteps} reverse step${access.retreat.retreatedSteps === 1 ? '' : 's'}.`
                    : ` Return to the route origin failed (${String(access.retreat.outcome).replace(/_/g, ' ')}).`
                : '';
            log(bot, `Stopped the exact route to ${stagedTarget.name}: ${String(access.failureOutcome || access.outcome).replace(/_/g, ' ')}${failedStep} after ${access.excavated} block${access.excavated === 1 ? '' : 's'}.${returnDetail}`);
            return false;
        }

        if (partialAdvance) {
            const observed = bot.entity?.position?.clone?.() || null;
            const remainingRouteLowerBound = observed
                ? minimumMiningCorridorSteps(
                    observed.floored(),
                    prospectiveMiningStandingPositions(bot, stagedTarget),
                )
                : Number.POSITIVE_INFINITY;
            const returnable = Boolean(
                observed
                && isMiningRouteCellReturnable(bot, plan.route.at(-1)?.position)
            );
            setActionEvidence(bot, {
                kind: 'mining_search',
                targetBound: true,
                outcome: 'search_advanced',
                target: {
                    name: stagedTarget.name,
                    x: stagedTarget.position.x,
                    y: stagedTarget.position.y,
                    z: stagedTarget.position.z,
                },
                routeSteps: plan.route.length,
                remainingRouteSteps: Math.max(0, plannedRouteSteps - plan.route.length),
                excavated: access.excavated,
                distance: observed ? observed.distanceTo(routeStart) : 0,
                observedPosition: observed,
                returnRoute: miningReturnRoute(plan.origin || routeStart, plan.route, observed),
                ...(observed ? {
                    progress: {
                        verified: true,
                        kind: 'mining_route_cell',
                        position: {
                            x: observed.x,
                            y: observed.y,
                            z: observed.z,
                        },
                    },
                } : {}),
                returnable,
                ...(plan.boundary ? {
                    boundary: {
                        ...plan.boundary,
                        remainingRouteLowerBound: Number.isFinite(remainingRouteLowerBound)
                            ? remainingRouteLowerBound
                            : null,
                    },
                } : {}),
                routeDigging: true,
                retryable: false,
            });
            log(
                bot,
                `Advanced ${plan.route.length} verified mining step${plan.route.length === 1 ? '' : 's'} toward `
                + `${stagedTarget.name}; the remaining route will be rebound from stable ground.`,
            );
            return true;
        }

        const collected = await collectBlock(bot, access.target.name, 1, null, 8, {
            relocate: false,
            preferredPosition: access.target.position,
            allowNaturalRouteDigging: true,
            allowAccessRecovery: false,
        });
        if (!collected) return false;
        let collectedPosition = observedSupportedStandingCell(bot);
        if (!collectedPosition || !isMiningRouteCellReturnable(bot, collectedPosition)) {
            // CollectBlock may finish the inventory effect while the body is
            // still brushing a collision boundary. Never persist raw entity
            // coordinates as a cleared return cell: settle through native
            // Pathfinder on the already preflighted stance first.
            await traverseClearedMiningCell(bot, plan.stance);
            collectedPosition = observedSupportedStandingCell(bot);
        }
        if (!collectedPosition || !isMiningRouteCellReturnable(bot, collectedPosition)) {
            setActionEvidence(bot, {
                kind: 'mining_search',
                targetBound: true,
                outcome: 'collection_settlement_unverified',
                target: {
                    name: stagedTarget.name,
                    x: stagedTarget.position.x,
                    y: stagedTarget.position.y,
                    z: stagedTarget.position.z,
                },
                observedPosition: bot.entity?.position?.clone?.() || null,
                routeSteps: plan.route.length,
                excavated: access.excavated,
                routeDigging: true,
                returnable: false,
                retryable: true,
            });
            log(bot, `Collected ${stagedTarget.name}, but no verified return-route stance settled before release.`);
            return false;
        }
        setActionEvidence(bot, {
            kind: 'mining_search',
            targetBound: true,
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
            observedPosition: collectedPosition,
            returnRoute: miningReturnRoute(plan.origin || routeStart, plan.route, collectedPosition),
            returnable: true,
            routeDigging: true,
            retryable: false,
        });
        log(bot, `Reached and collected the known ${stagedTarget.name} target through an exact ${plan.route.length}-step mining route.`);
        return true;
    }

    const tunnelHeadings = orderedMiningHeadings(bot, requested)
        .slice(0, MAX_MINING_ROUTE_HEADINGS);
    const origin = observedSupportedStandingCell(bot);
    if (!origin) {
        setActionEvidence(bot, {
            kind: 'mining_search',
            outcome: 'origin_support_unsafe',
            target: { name: requested || 'resource' },
            routeDigging: true,
            retryable: true,
        });
        return false;
    }
    const rejections = {};
    let toolRequirement = null;
    for (const heading of tunnelHeadings) {
        if (bot.interrupt_code) break;
        const endpoint = origin.offset(
            heading.x * requestedLength,
            0,
            heading.z * requestedLength,
        );
        let plan = buildMiningAccessPlan(bot, null, requestedLength, {
            breakTarget: false,
            stances: [endpoint],
            maxRouteSteps: requestedLength,
            preservedReturnRoute,
        });
        if (!plan.ok && plan.outcome === 'route_deadline_insufficient') {
            const prefix = selectMiningDeadlinePrefix(plan, remainingActionTimeMs());
            if (prefix) plan = prefix;
        }
        if (!plan.ok) {
            const outcome = plan.outcome || 'no_safe_route';
            rejections[outcome] = (rejections[outcome] || 0) + 1;
            if (outcome === 'insufficient_tool_durability' && plan.replacementTool) {
                toolRequirement = {
                    name: plan.replacementTool,
                    minimumUsableDurability: plan.minimumUsableDurability,
                };
            }
            continue;
        }
        const access = await executeMiningAccessPlan(bot, null, plan);
        if (!access.success) {
            setActionEvidence(bot, {
                kind: 'mining_search',
                outcome: access.outcome,
                failureOutcome: access.failureOutcome || access.outcome,
                target: {
                    name: requested || 'resource',
                    x: endpoint.x,
                    y: endpoint.y,
                    z: endpoint.z,
                },
                routeSteps: plan.route.length,
                excavated: access.excavated,
                retreat: access.retreat || null,
                routeDigging: true,
                retryable: !bot.interrupt_code,
            });
            return false;
        }
        const observed = observedSupportedStandingCell(bot);
        const returnable = Boolean(
            observed
            && isMiningRouteCellReturnable(bot, plan.route.at(-1)?.position)
        );
        const distance = observed ? observed.distanceTo(origin) : 0;
        setActionEvidence(bot, {
            kind: 'mining_search',
            outcome: returnable ? 'search_advanced' : 'return_route_changed',
            target: {
                name: requested || 'resource',
                x: endpoint.x,
                y: endpoint.y,
                z: endpoint.z,
            },
            observedPosition: observed,
            returnRoute: miningReturnRoute(plan.origin || origin, plan.route, observed),
            routeSteps: plan.route.length,
            excavated: access.excavated,
            distance,
            durability: plan.durability,
            returnable,
            routeDigging: true,
            retryable: !returnable,
        });
        if (!returnable) return false;
        log(bot, `Advanced a preflighted ${plan.route.length}-step mining corridor ${distance.toFixed(1)} blocks while searching for ${requested || 'resources'}; no resource is claimed yet.`);
        return true;
    }
    setActionEvidence(bot, {
        kind: 'mining_search',
        outcome: bot.interrupt_code
            ? 'interrupted'
            : toolRequirement
                ? 'insufficient_tool_durability'
                : 'corridor_search_exhausted',
        target: { name: requested || 'resource' },
        rejections,
        ...(toolRequirement ? { toolRequirement } : {}),
        routeDigging: true,
        retryable: !bot.interrupt_code,
    });
    log(bot, bot.interrupt_code
        ? 'Stopped the mining search tunnel.'
        : `No preflighted natural-fill corridor could advance while searching for ${requested || 'the requested resource'}.`);
    return false;
}

/**
 * Reach one catalogue-bound cave stance with native Pathfinder and verify that
 * the reached area is lit. Selection policy lives above this adapter; this
 * function owns only locomotion, the torch mechanic, and physical evidence.
 */
export async function lightCaveAt(bot, x, y, z) {
    const target = {
        name: 'cave_region',
        x: Math.floor(Number(x)),
        y: Math.floor(Number(y)),
        z: Math.floor(Number(z)),
    };
    if (![target.x, target.y, target.z].every(Number.isFinite)) {
        setActionEvidence(bot, { kind: 'cave_survey', outcome: 'invalid_target', target, retryable: false });
        return false;
    }
    const selectedPosition = new Vec3(target.x, target.y, target.z);
    if (!isSafeCaveStance(bot, selectedPosition)) {
        setActionEvidence(bot, { kind: 'cave_survey', outcome: 'target_changed', target, retryable: true });
        log(bot, 'The selected cave stance is no longer present.');
        return false;
    }
    const reached = await goToPosition(bot, target.x, target.y, target.z, 1);
    if (
        !reached
        || !bot.entity?.position
        || bot.entity.position.distanceTo(new Vec3(target.x, target.y, target.z)) > 2.25
    ) {
        setActionEvidence(bot, {
            kind: 'cave_survey',
            outcome: bot.interrupt_code ? 'interrupted' : 'unreachable',
            target,
            retryable: !bot.interrupt_code,
        });
        return false;
    }

    const lightWasRequired = world.shouldPlaceTorch(bot);
    const beforeTorches = inventoryCount(bot, 'torch');
    const placed = lightWasRequired ? await autoLight(bot) : false;
    const afterTorches = inventoryCount(bot, 'torch');
    if (bot.interrupt_code) {
        setActionEvidence(bot, { kind: 'cave_survey', outcome: 'interrupted', target, retryable: false });
        return false;
    }
    const torchesPlaced = Math.max(0, beforeTorches - afterTorches);
    const lit = !lightWasRequired || placed === true || torchesPlaced > 0;
    setActionEvidence(bot, {
        kind: 'cave_survey',
        outcome: lit ? (lightWasRequired ? 'cave_lit' : 'already_lit') : 'lighting_failed',
        target,
        lightWasRequired,
        torchesPlaced,
        observedPosition: {
            x: bot.entity.position.x,
            y: bot.entity.position.y,
            z: bot.entity.position.z,
        },
        retryable: !lit,
    });
    log(bot, lit
        ? `Reached and verified lighting at the cave stance ${target.x}, ${target.y}, ${target.z}.`
        : 'Reached the cave stance, but could not verify lighting it.');
    return lit;
}

/** Collect one exact, still-exposed ore target without route excavation. */
export async function collectExposedOreAt(
    bot,
    blockName,
    x,
    y,
    z,
    returnX,
    returnY,
    returnZ,
) {
    const target = {
        name: String(blockName || '').trim(),
        x: Math.floor(Number(x)),
        y: Math.floor(Number(y)),
        z: Math.floor(Number(z)),
    };
    if (
        !/^(?:deepslate_)?[a-z0-9_]+_ore$/.test(target.name)
        || ![target.x, target.y, target.z].every(Number.isFinite)
    ) {
        setActionEvidence(bot, { kind: 'collect', outcome: 'invalid_target', target, retryable: false });
        return false;
    }
    const block = bot.blockAt(new Vec3(target.x, target.y, target.z));
    if (!block || block.name !== target.name) {
        setActionEvidence(bot, { kind: 'collect', outcome: 'target_changed', target, retryable: true });
        return false;
    }
    if (isProtectedGameplayBlock(block) || !isMiningTargetExposed(bot, block)) {
        setActionEvidence(bot, {
            kind: 'collect',
            outcome: isProtectedGameplayBlock(block) ? 'protected_block' : 'target_not_exposed',
            target,
            retryable: !isProtectedGameplayBlock(block),
        });
        return false;
    }
    const returnStance = new Vec3(
        Math.floor(Number(returnX)),
        Math.floor(Number(returnY)),
        Math.floor(Number(returnZ)),
    );
    if (![returnStance.x, returnStance.y, returnStance.z].every(Number.isFinite)) {
        setActionEvidence(bot, {
            kind: 'collect',
            outcome: 'return_stance_missing',
            target,
            retryable: false,
        });
        return false;
    }
    const collected = await collectBlock(bot, target.name, 1, null, 8, {
        relocate: false,
        preferredPosition: target,
        allowNaturalRouteDigging: false,
        allowAccessRecovery: false,
        allowPillars: false,
        requireReturnableRoute: true,
    });
    const collectionEvidence = bot.lastActionEvidence?.kind === 'collect'
        ? bot.lastActionEvidence
        : null;
    if (!collected) return false;

    const returned = physicallyOccupiesStandingCell(bot, returnStance) || await goToGoal(
        bot,
        new pf.goals.GoalBlock(returnStance.x, returnStance.y, returnStance.z),
        {
            movements: () => clearedMiningMovements(bot),
            allowHealthBoundedDescent: false,
            allowLocalRecovery: false,
        },
    );
    const settled = Boolean(returned && physicallyOccupiesStandingCell(bot, returnStance));
    setActionEvidence(bot, {
        kind: 'collect',
        outcome: settled ? 'collected_returnable' : 'return_stance_unreachable',
        target,
        count: Math.max(1, Number(collectionEvidence?.count) || 1),
        returnStance: {
            x: returnStance.x,
            y: returnStance.y,
            z: returnStance.z,
        },
        returnStanceVerified: settled,
        retryable: !settled,
    });
    log(bot, settled
        ? `Collected ${target.name} and returned to its verified expedition stance.`
        : `Collected ${target.name}, but could not return to its bound expedition stance.`);
    return settled;
}

export async function goToMiningDepth(bot, targetY, range=64, options = {}) {
    const boundedY = Math.max(-60, Math.min(300, Math.floor(Number(targetY) || 0)));
    const boundedRange = Math.max(16, Math.min(128, Math.floor(Number(range) || 64)));
    let origin = observedSupportedStandingCell(bot)
        || bot.entity?.position?.floored?.()
        || null;
    const target = { name: 'open_cave_route', y: boundedY };
    const preservedReturnRoute = normalizePreservedMiningReturnRoute(options.preservedReturnRoute);
    const expectedProtectedRouteCells = Number.isFinite(options.expectedProtectedRouteCells)
        ? Math.max(0, Math.floor(options.expectedProtectedRouteCells))
        : null;
    if (
        expectedProtectedRouteCells !== null
        && expectedProtectedRouteCells !== preservedReturnRoute.length
    ) {
        setActionEvidence(bot, {
            kind: 'mining_relocation',
            outcome: 'preserved_return_route_changed',
            target,
            expectedProtectedRouteCells,
            observedProtectedRouteCells: preservedReturnRoute.length,
            routeDigging: true,
            retryable: true,
        });
        return false;
    }
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

    // Once deterministic excavation begins, the persisted route endpoint is
    // the only honest continuation stance. Re-probing arbitrary open caves on
    // every bounded leg can climb far above that endpoint, stall, and then
    // make a short local descent look like global progress. Rejoin the exact
    // cleared endpoint after interruption/restart and keep A* excavation off.
    const routeEndpoint = preservedReturnRoute.at(-1) || null;
    if (routeEndpoint && !sameMiningCell(origin, routeEndpoint)) {
        const rejoined = await goToGoal(
            bot,
            new pf.goals.GoalBlock(routeEndpoint.x, routeEndpoint.y, routeEndpoint.z),
            {
                movements: () => clearedMiningMovements(bot),
                stallTimeoutMs: NAVIGATION_STALL_TIMEOUT_MS,
                allowHealthBoundedDescent: false,
                allowLocalRecovery: false,
            },
        );
        await waitForWorldCondition(
            bot,
            () => physicallyOccupiesStandingCell(bot, routeEndpoint),
            GROUND_SETTLE_TIMEOUT_MS,
            25,
        );
        if (!rejoined || !physicallyOccupiesStandingCell(bot, routeEndpoint)) {
            setActionEvidence(bot, {
                kind: 'mining_relocation',
                outcome: bot.interrupt_code
                    ? 'interrupted'
                    : 'preserved_route_endpoint_unreachable',
                target: {
                    ...target,
                    x: routeEndpoint.x,
                    z: routeEndpoint.z,
                },
                observedY: bot.entity?.position?.y ?? null,
                routeDigging: false,
                returnable: false,
                retryable: !bot.interrupt_code,
            });
            log(bot, bot.interrupt_code
                ? 'Stopped before the preserved mining-route endpoint settled.'
                : 'Could not rejoin the exact preserved mining-route endpoint without excavation.');
            return false;
        }
        origin = observedSupportedStandingCell(bot) || routeEndpoint;
    }

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
    if (preservedReturnRoute.length === 0) {
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

        const openRoute = probeSafeRoundTripNavigationStances(
            bot,
            candidates.slice(0, 24),
            origin,
            2_000,
        );
        if (openRoute.reachable && openRoute.terminalPosition) {
            const candidate = openRoute.terminalPosition;
            if (await goToPosition(bot, candidate.x, candidate.y, candidate.z, 1)) {
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
                        returnable: true,
                        retryable: false,
                    });
                    return true;
                }
            }

            // A successful read-only probe does not guarantee live execution
            // will finish under changing entities or chunk state. Never begin
            // deterministic excavation from that partial route position.
            const returned = physicallyOccupiesStandingCell(bot, origin) || await goToGoal(
                bot,
                new pf.goals.GoalBlock(origin.x, origin.y, origin.z),
                {
                    movements: () => clearedMiningMovements(bot),
                    stallTimeoutMs: NAVIGATION_STALL_TIMEOUT_MS,
                    allowHealthBoundedDescent: false,
                    allowLocalRecovery: false,
                },
            );
            await waitForWorldCondition(
                bot,
                () => physicallyOccupiesStandingCell(bot, origin),
                GROUND_SETTLE_TIMEOUT_MS,
                25,
            );
            if (!returned || !physicallyOccupiesStandingCell(bot, origin)) {
                setActionEvidence(bot, {
                    kind: 'mining_relocation',
                    outcome: bot.interrupt_code
                        ? 'interrupted'
                        : 'open_route_settlement_failed',
                    target,
                    observedY: bot.entity?.position?.y ?? null,
                    routeDigging: false,
                    returnable: false,
                    retryable: !bot.interrupt_code,
                });
                log(bot, bot.interrupt_code
                    ? 'Stopped before the failed open-route probe settled.'
                    : 'The open-route probe did not execute and its exact origin could not be restored.');
                return false;
            }
            origin = observedSupportedStandingCell(bot) || origin;
        }
    }

    if (boundedY < bot.entity.position.y - 6) {
        const staircase = await carveExploratoryDepthRoute(bot, boundedY, { preservedReturnRoute });
        const verticalProgress = Number.isFinite(staircase.observedY)
            ? origin.y - staircase.observedY
            : 0;
        if (staircase.progressed && verticalProgress >= 1) {
            setActionEvidence(bot, {
                kind: 'mining_relocation',
                outcome: staircase.success ? 'staircase_depth_reached' : 'mining_depth_advanced',
                target: {
                    ...target,
                    ...(staircase.observed ? {
                        x: staircase.observed.x,
                        z: staircase.observed.z,
                    } : {}),
                },
                observedY: staircase.observedY,
                observedPosition: staircase.observed || null,
                verticalProgress,
                routeSteps: staircase.routeSteps,
                excavated: staircase.excavated,
                durability: staircase.durability || null,
                routeDigging: true,
                returnable: staircase.returnable === true,
                returnRoute: staircase.returnRoute || [],
                retryable: false,
            });
            log(bot, staircase.success
                ? `Carved and followed a preflighted staircase to the productive y=${boundedY} band.`
                : `Advanced ${verticalProgress} vertical block${verticalProgress === 1 ? '' : 's'} toward the productive y=${boundedY} band through a preflighted returnable staircase.`);
            return true;
        }
        if (staircase.progressed) {
            setActionEvidence(bot, {
                kind: 'mining_relocation',
                outcome: 'non_convergent_depth_route',
                target,
                observedY: staircase.observedY,
                verticalProgress,
                routeSteps: staircase.routeSteps,
                excavated: staircase.excavated,
                routeDigging: true,
                returnable: staircase.returnable === true,
                returnRoute: staircase.returnRoute || [],
                retryable: true,
            });
            log(bot, 'The bounded staircase did not finish below its action origin, so no mining-depth progress was accepted.');
            return false;
        }
        setActionEvidence(bot, {
            kind: 'mining_relocation',
            outcome: staircase.outcome || 'no_safe_depth_corridor',
            target,
            routeDigging: true,
            retryable: !bot.interrupt_code,
            rejections: staircase.rejections || null,
            retreat: staircase.retreat || null,
            ...(staircase.toolRequirement ? { toolRequirement: staircase.toolRequirement } : {}),
        });
        log(bot, `No preflighted returnable staircase leg advances toward y=${boundedY} from here.`);
        return false;
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
    let target = {
        name: entityType,
        id: entity.id,
        x: entity.position.x,
        y: entity.position.y,
        z: entity.position.z,
    };
    let distance = bot.entity.position.distanceTo(entity.position);
    log(bot, `Found ${entityType} ${distance.toFixed(1)} blocks away.`);
    const reached = await goToGoal(bot, new pf.goals.GoalFollow(entity, requestedDistance));
    const observed = bot.entities?.[entity.id];
    if (!observed?.position) {
        setActionEvidence(bot, {
            kind: 'movement',
            outcome: 'target_lost',
            target,
            retryable: true,
        });
        log(bot, `${entityType} left verified world state before arrival.`);
        return false;
    }
    target = {
        name: entityType,
        id: observed.id,
        x: observed.position.x,
        y: observed.position.y,
        z: observed.position.z,
    };
    distance = bot.entity.position.distanceTo(observed.position);
    // GoalFollow can settle just after its moving target takes another step.
    // Trust the final Minecraft distance when it is still inside one ordinary
    // entity-width of the requested radius instead of turning successful
    // native pursuit into a false failure and another identical retry.
    const physicallySettled = distance <= requestedDistance + 1.5;
    if (!reached && !physicallySettled) {
        setActionEvidence(bot, {
            kind: 'movement',
            outcome: bot.lastActionEvidence?.outcome || 'unreachable',
            target,
            distance,
            retryable: true,
        });
        return false;
    }
    if (!physicallySettled) {
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

export async function goToPlayer(bot, username, distance=3, { locatePlayerPosition = null } = {}) {
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
    if (!player && typeof locatePlayerPosition === 'function') {
        const observation = await locatePlayerPosition(username);
        const position = observation?.position;
        const observedDimension = String(observation?.dimension || '').replace(/^minecraft:/, '');
        if (
            observation?.success === true
            && observation?.found === true
            && [position?.x, position?.y, position?.z].every(Number.isFinite)
            && observedDimension === dimensionName(bot)
        ) {
            const reacquireDistance = Math.max(6, normalizePlayerDistance(distance, 3) + 2);
            const regionGoal = new pf.goals.GoalNear(
                Math.floor(position.x),
                Math.floor(position.y),
                Math.floor(position.z),
                reacquireDistance,
            );
            const reachedRegion = regionGoal.isEnd(bot.entity.position.floored()) || await goToGoal(bot, regionGoal, {
                movements: () => safeMovements(bot),
                allowHealthBoundedDescent: false,
                allowLocalRecovery: false,
            });
            if (!reachedRegion) return false;
            resolution = resolvePhysicalPlayer(bot, username);
            target = playerTargetEvidence(resolution);
            player = resolution.entity;
        } else {
            setActionEvidence(bot, {
                kind: 'movement',
                outcome: observation?.success === true && observation?.found === false
                    ? 'target_offline'
                    : observedDimension && observedDimension !== dimensionName(bot)
                        ? 'target_other_dimension'
                        : 'target_location_unavailable',
                target: { ...target, source: observation?.source || 'managed_paper' },
                expected: dimensionName(bot),
                observed: observedDimension || null,
                retryable: observation?.found !== false,
            });
            log(bot, observation?.found === false
                ? `${username} is not online.`
                : `${username}'s current position is not reachable in ${dimensionName(bot)}.`);
            return false;
        }
    }
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

    let reached = await goToGoal(bot, goal);
    if (!reached && !bot.interrupt_code) {
        resolution = resolvePhysicalPlayer(bot, username);
        player = resolution.entity;
        const settledDistance = player?.position
            ? bot.entity.position.distanceTo(player.position)
            : Number.POSITIVE_INFINITY;
        if (settledDistance <= distance + 1) {
            reached = true;
            log(bot, `Minecraft already shows ${username} within ${settledDistance.toFixed(1)} blocks despite Pathfinder's late failure.`);
        }
    }
    if (
        !reached
        && !bot.interrupt_code
        && bot.lastActionEvidence?.outcome === 'path_timeout'
    ) {
        // A dynamic GoalFollow can time out while the same stationary player's
        // exact observed region has a valid native route. Change the planning
        // strategy once inside this owned action: route to the immutable
        // observation, then reacquire and verify the live player below. This is
        // not another executor and it never turns a stale coordinate into
        // success; final completion remains player-relative.
        resolution = resolvePhysicalPlayer(bot, username);
        player = resolution.entity;
        if (player?.position) {
            const observed = player.position.clone();
            const regionGoal = new pf.goals.GoalNear(
                Math.floor(observed.x),
                Math.floor(observed.y),
                Math.floor(observed.z),
                Math.max(2, distance),
            );
            log(bot, `Dynamic pursuit timed out; routing once to ${username}'s verified current region.`);
            reached = await goToGoal(bot, regionGoal, {
                movements: () => safeMovements(bot),
                allowHealthBoundedDescent: false,
                allowLocalRecovery: false,
            });
        }
    }
    if (!reached && !bot.interrupt_code) {
        resolution = resolvePhysicalPlayer(bot, username);
        player = resolution.entity;
        const settledDistance = player?.position
            ? bot.entity.position.distanceTo(player.position)
            : Number.POSITIVE_INFINITY;
        if (settledDistance <= distance + 1) {
            reached = true;
            log(bot, `Minecraft confirmed ${username} within ${settledDistance.toFixed(1)} blocks after the fallback settled.`);
        }
    }
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


export async function followPlayerUntilNearBlock(bot, username, blockName, radius=8, distance=3) {
    const canonicalBlock = String(blockName || '')
        .trim()
        .toLowerCase()
        .replace(/^minecraft:/, '')
        .replace(/[\s-]+/g, '_');
    const blockType = bot.registry?.blocksByName?.[canonicalBlock];
    if (!blockType) {
        setActionEvidence(bot, {
            kind: 'follow',
            outcome: 'unsupported_destination_block',
            target: { name: canonicalBlock || 'unknown' },
            retryable: false,
        });
        log(bot, `${blockName || 'That destination block'} is not a known block in this world.`);
        return false;
    }

    const sharedRadius = Math.max(2, Math.min(32, Number(radius) || 8));
    let candidateKey = null;
    let candidateSince = 0;
    let playerAnchor = null;
    let botAnchor = null;
    return await followPlayer(bot, username, distance, {
        completionDescription: `Reached ${canonicalBlock.replaceAll('_', ' ')} with ${username}.`,
        until: ({ player }) => {
            let positions;
            try {
                positions = bot.findBlocks({
                    matching: blockType.id,
                    maxDistance: Math.ceil(sharedRadius),
                    count: 16,
                });
            } catch {
                positions = [];
            }
            const candidate = positions
                .map(position => ({
                    position,
                    botDistance: bot.entity.position.distanceTo(position),
                    playerDistance: player.position.distanceTo(position),
                }))
                .filter(observation => (
                    observation.botDistance <= sharedRadius
                    && observation.playerDistance <= sharedRadius
                ))
                .sort((left, right) => (
                    left.botDistance + left.playerDistance - right.botDistance - right.playerDistance
                ))[0];
            if (!candidate) {
                candidateKey = null;
                candidateSince = 0;
                playerAnchor = null;
                botAnchor = null;
                return null;
            }

            const key = `${candidate.position.x},${candidate.position.y},${candidate.position.z}`;
            if (
                key !== candidateKey
                || !playerAnchor
                || !botAnchor
                || player.position.distanceTo(playerAnchor) > FOLLOW_DESTINATION_POSITION_EPSILON
                || bot.entity.position.distanceTo(botAnchor) > FOLLOW_DESTINATION_POSITION_EPSILON
            ) {
                candidateKey = key;
                candidateSince = Date.now();
                playerAnchor = player.position.clone();
                botAnchor = bot.entity.position.clone();
                return null;
            }
            const settledMs = Date.now() - candidateSince;
            if (settledMs < FOLLOW_DESTINATION_SETTLE_MS) return null;
            return {
                kind: 'shared_world_block',
                name: canonicalBlock,
                position: {
                    x: candidate.position.x,
                    y: candidate.position.y,
                    z: candidate.position.z,
                },
                dimension: (() => {
                    const current = String(bot.game?.dimension || '')
                        .trim()
                        .toLowerCase()
                        .replace(/^minecraft:/, '')
                        .replace(/^the_nether$/, 'nether')
                        .replace(/^the_end$/, 'end');
                    return current ? `minecraft:${current}` : '';
                })(),
                radius: sharedRadius,
                settledMs,
            };
        },
    });
}


export async function followPlayer(bot, username, distance=4, options={}) {
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
    let bestLiquidFollowDistance = Number.POSITIVE_INFINITY;
    let liquidNoConvergenceMs = 0;
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
        bot.pathfinder.setGoal(new ResponsiveFollowGoal(bot, player, distance), true);
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
            bot.pathfinder.setGoal(new ResponsiveFollowGoal(bot, player, distance), true);
            noProgressMs = 0;
            recoveryAttempts = 0;
            recoveryCooldownUntil = 0;
            bestLiquidFollowDistance = Number.POSITIVE_INFINITY;
            liquidNoConvergenceMs = 0;
            lastPathStatus = null;
            targetMissingSince = null;
            log(bot, `Reacquired ${canonicalUsername}; continuing the same follow order.`);
        }
        // in cheat mode, if the distance is too far, teleport to the player
        const distance_from_player = bot.entity.position.distanceTo(player.position);

        if (typeof options.until === 'function') {
            let completion;
            try {
                completion = options.until({ bot, player, distance: distance_from_player });
            } catch (error) {
                setActionEvidence(bot, {
                    kind: 'follow',
                    outcome: 'completion_check_failed',
                    target,
                    error: error.message,
                    retryable: true,
                });
                log(bot, `Could not verify the requested follow destination: ${error.message}`);
                return false;
            }
            if (completion) {
                setActionEvidence(bot, {
                    kind: 'follow',
                    outcome: 'condition_reached',
                    target,
                    distance: distance_from_player,
                    completion,
                    retryable: false,
                });
                log(bot, options.completionDescription || `Reached the requested destination with ${username}.`);
                return true;
            }
        }

        const teleport_distance = 100;
        const ignore_modes_distance = 30; 
        const nearby_distance = distance + 2;
        const botFeetPosition = bot.entity.position.floored();
        const botFeet = bot.blockAt(botFeetPosition);
        const botInLiquid = Boolean(
            bot.entity?.isInWater
            || bot.entity?.isInLava
            || isLiquidGameplayBlock(botFeet)
        );
        const playerDryAndSupported = followTargetRequiresDrySettlement(bot, player);
        const needsShoreRecovery = botInLiquid && playerDryAndSupported;

        if (distance_from_player > nearby_distance || needsShoreRecovery) {
            if (needsShoreRecovery) {
                noProgressMs = 0;
                if (distance_from_player <= bestLiquidFollowDistance - NAVIGATION_GOAL_PROGRESS_DELTA) {
                    bestLiquidFollowDistance = distance_from_player;
                    liquidNoConvergenceMs = 0;
                } else if (Date.now() >= recoveryCooldownUntil) {
                    liquidNoConvergenceMs += FOLLOW_SAMPLE_MS;
                }
                if (liquidNoConvergenceMs >= FOLLOW_STUCK_AFTER_MS) {
                    const recovery = await attemptShallowWaterExit(bot);
                    if (bot.interrupt_code) break;
                    bot.pathfinder.setMovements(safeMovements(bot));
                    bot.pathfinder.setGoal(new ResponsiveFollowGoal(bot, player, distance), true);
                    setActionEvidence(bot, {
                        kind: 'follow',
                        outcome: recovery.success ? 'shore_recovering' : 'shore_recovery_blocked',
                        target,
                        distance: distance_from_player,
                        pathStatus: lastPathStatus,
                        recovery,
                        retryable: true,
                    });
                    log(bot, recovery.success
                        ? `Following ${username}: reached a dry shoreline with Pathfinder and resumed the dynamic follow route.`
                        : `Following ${username}: Pathfinder could not bind a dry shoreline yet; keeping the dynamic follow route active.`);
                    recoveryCooldownUntil = Date.now() + FOLLOW_RECOVERY_COOLDOWN_MS;
                    bestLiquidFollowDistance = Number.POSITIVE_INFINITY;
                    liquidNoConvergenceMs = 0;
                    lastPathStatus = null;
                }
            } else {
                bestLiquidFollowDistance = Number.POSITIVE_INFINITY;
                liquidNoConvergenceMs = 0;
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
                        bot.pathfinder.setGoal(new ResponsiveFollowGoal(bot, player, distance), true);
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
            }
        } else {
            noProgressMs = 0;
            recoveryAttempts = 0;
            recoveryCooldownUntil = 0;
            bestLiquidFollowDistance = Number.POSITIVE_INFINITY;
            liquidNoConvergenceMs = 0;
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


function recentMoveAwayExclusionZones(bot, position, range, now = Date.now()) {
    const recent = (moveAwayHistory.get(bot) || []).filter(entry => (
        now - entry.at <= MOVE_AWAY_HISTORY_TTL_MS
        && [entry.x, entry.y, entry.z].every(Number.isFinite)
    ));
    moveAwayHistory.set(bot, recent);
    if (range <= 0) return [];
    return recent
        .slice(-MOVE_AWAY_HISTORY_LIMIT)
        .filter(entry => Math.hypot(
            entry.x - position.x,
            entry.y - position.y,
            entry.z - position.z,
        ) >= 0.5)
        .map(entry => ({
            x: entry.x,
            y: entry.y,
            z: entry.z,
            range,
        }));
}

function rememberMoveAwayOrigin(bot, position, now = Date.now()) {
    const recent = (moveAwayHistory.get(bot) || []).filter(entry => (
        now - entry.at <= MOVE_AWAY_HISTORY_TTL_MS
    ));
    recent.push({
        x: Math.floor(position.x),
        y: Math.floor(position.y),
        z: Math.floor(position.z),
        at: now,
    });
    moveAwayHistory.set(bot, recent.slice(-MOVE_AWAY_HISTORY_LIMIT));
}

function meaningfulRelocationCandidates(bot, position, requestedDistance, exclusionZones) {
    const origin = position.floored();
    // A sky platform needs a lower usable world region. Ordinary surface play
    // usually needs different terrain at roughly the same height. Treating
    // every meaningful relocation as a descent made a shoreline bot ignore
    // nearby dry land and spend its whole action routing toward distant caves.
    const requiresLowerRegion = origin.y >= 128;
    const minY = Number.isFinite(Number(bot.game?.minY)) ? Number(bot.game.minY) : -64;
    const maxY = Math.floor(position.y) + 2;
    const firstRing = Math.max(2, Math.floor(requestedDistance));
    const maximumRing = Math.max(
        firstRing,
        Math.min(
            MEANINGFUL_RELOCATION_SCAN_RADIUS,
            Math.ceil(Math.max(requestedDistance * 4, 24)),
        ),
    );
    const outsideExcludedRegion = target => exclusionZones.every(zone => (
        Math.hypot(target.x - zone.x, target.y - zone.y, target.z - zone.z) >= zone.range
    ));

    for (let ring = firstRing; ring <= maximumRing; ring += 1) {
        const candidates = [];
        for (let dx = -ring; dx <= ring; dx += 1) {
            for (let dz = -ring; dz <= ring; dz += 1) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
                const target = loadedSurfaceStandingCell(
                    bot,
                    origin.x + dx,
                    origin.z + dz,
                    minY,
                    maxY,
                );
                if (!target) continue;
                if (
                    requiresLowerRegion
                    && target.y > origin.y - MEANINGFUL_RELOCATION_VERTICAL_DROP
                ) continue;
                if (!outsideExcludedRegion(target)) continue;
                candidates.push(target);
            }
        }
        if (candidates.length > 0) {
            return candidates
                .sort((left, right) => (
                    position.distanceTo(left) - position.distanceTo(right)
                    || (requiresLowerRegion
                        ? right.y - left.y
                        : Math.abs(left.y - origin.y) - Math.abs(right.y - origin.y))
                    || left.x - right.x
                    || left.z - right.z
                ))
                .slice(0, MEANINGFUL_RELOCATION_MAX_CANDIDATES);
        }
    }
    return [];
}

function probeMeaningfulRelocation(bot, candidates, movements, signal) {
    if (
        candidates.length === 0
        || typeof bot.pathfinder?.getPathFromTo !== 'function'
        || !bot.entity?.position
    ) return null;
    const goal = new pf.goals.GoalCompositeAny(
        candidates.map(position => new pf.goals.GoalBlock(position.x, position.y, position.z)),
    );
    const timeoutMs = Math.max(
        100,
        Math.min(
            MEANINGFUL_RELOCATION_PROBE_MS,
            remainingActionTimeMs(MEANINGFUL_RELOCATION_PROBE_MS),
        ),
    );
    let result = null;
    try {
        const generator = bot.pathfinder.getPathFromTo(
            movements,
            bot.entity.position,
            goal,
            { timeout: timeoutMs, tickTimeout: 40, searchRadius: -1 },
        );
        for (const step of generator) {
            result = step?.result || null;
            if (signal?.aborted || result?.status !== 'partial') break;
        }
    } catch {
        return null;
    }
    if (signal?.aborted || result?.status !== 'success') return null;
    const terminal = result.path?.at(-1);
    if (!terminal) return null;
    const target = candidates.find(candidate => (
        candidate.x === Math.floor(terminal.x)
        && candidate.y === Math.floor(terminal.y)
        && candidate.z === Math.floor(terminal.z)
    ));
    if (!target) return null;
    return {
        target,
        movements,
        pathLength: result.path.length,
    };
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
    const startingFeet = bot.blockAt(pos.floored());
    const startedInLiquid = Boolean(
        bot.entity?.isInWater
        || bot.entity?.isInLava
        || isLiquidGameplayBlock(startingFeet)
    );
    const requestedDistance = Math.max(0, Number(distance) || 0);
    const exclusionZones = recentMoveAwayExclusionZones(bot, pos, requestedDistance);
    const meaningfulMovements = options?.meaningfulRegion === true && !startedInLiquid
        ? safeMovements(bot)
        : null;
    const meaningfulRelocation = meaningfulMovements
        ? probeMeaningfulRelocation(
            bot,
            meaningfulRelocationCandidates(bot, pos, requestedDistance, exclusionZones),
            meaningfulMovements,
            signal,
        )
        : null;
    const target = meaningfulRelocation
        ? {
            x: meaningfulRelocation.target.x,
            y: meaningfulRelocation.target.y,
            z: meaningfulRelocation.target.z,
        }
        : { x: pos.x, y: pos.y, z: pos.z };
    const retreatGoal = meaningfulRelocation
        ? new pf.goals.GoalBlock(target.x, target.y, target.z)
        : new pf.goals.GoalOutsideRadius(
            pos.x,
            pos.y,
            pos.z,
            requestedDistance,
            exclusionZones,
        );
    const routeMovements = meaningfulRelocation?.movements || safeMovements(bot);
    bot.pathfinder.setMovements(routeMovements);

    if (bot.modes.isOn('cheat')) {
        let path;
        try {
            path = await bot.pathfinder.getPathTo(routeMovements, retreatGoal, 10000);
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
        const retreatOptions = {
            ...options,
            // moveAway is itself a recovery primitive. Its native route may
            // replan, but nesting a second local sidestep recovery merely
            // repeats the same blocked region inside one action.
            allowLocalRecovery: options?.allowLocalRecovery ?? false,
        };
        const movementOptions = meaningfulRelocation
            ? {
                ...retreatOptions,
                movements: routeMovements,
                allowHealthBoundedDescent: false,
            }
            : retreatOptions.movements
            ? retreatOptions
            : {
                ...retreatOptions,
                movements: () => {
                    const movements = safeMovements(bot);
                    const feet = bot.entity?.position
                        ? bot.blockAt(bot.entity.position.floored())
                        : null;
                    // goToGoal owns the initial water-to-shore route. Once
                    // that route reaches land, the actual relocation must not
                    // choose an equally short path back through water.
                    if (!bot.entity?.isInWater && !isLiquidGameplayBlock(feet)) {
                        const waterType = bot.registry?.blocksByName?.water?.id;
                        if (Number.isFinite(waterType)) movements.blocksToAvoid.add(waterType);
                    }
                    return movements;
                },
            };
        routed = await goToGoal(bot, retreatGoal, movementOptions);
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
    const finalFeet = bot.blockAt(new_pos.floored());
    if ((startedInLiquid || meaningfulRelocation) && (
        bot.entity?.isInWater
        || bot.entity?.isInLava
        || isLiquidGameplayBlock(finalFeet)
    )) {
        setActionEvidence(bot, {
            kind: 'movement',
            outcome: 'unsafe_medium',
            target,
            requestedDistance,
            distance: moved,
            medium: finalFeet?.name || 'liquid',
            retryable: true,
        });
        log(bot, `Retreat moved ${moved.toFixed(1)} blocks but did not reach a dry stance.`);
        return false;
    }
    if (requestedDistance > 0 && moved + 0.5 < requestedDistance) {
        setActionEvidence(bot, { kind: 'movement', outcome: 'no_progress', target, requestedDistance, distance: moved, retryable: true });
        log(bot, `Retreat stopped after ${moved.toFixed(1)} blocks; ${requestedDistance.toFixed(1)} were requested.`);
        return false;
    }
    rememberMoveAwayOrigin(bot, pos);
    setActionEvidence(bot, {
        kind: 'movement',
        outcome: 'retreated',
        target,
        requestedDistance,
        distance: moved,
        excludedRegions: exclusionZones.length,
        strategy: meaningfulRelocation ? 'verified_region_change' : 'local_relocation',
        ...(meaningfulRelocation ? { probePathLength: meaningfulRelocation.pathLength } : {}),
        retryable: true,
    });
    log(bot, meaningfulRelocation
        ? `Relocated from ${pos.floored()} to a verified distinct dry region at ${new_pos.floored()}.`
        : `Moved away from ${pos.floored()} to ${new_pos.floored()}.`);
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

function classifySleepRejection(error) {
    const message = String(error?.message || error || '').trim();
    const known = {
        'there are monsters nearby': { outcome: 'hostiles_near_bed', retryable: true },
        'the bed is occupied': { outcome: 'bed_occupied', retryable: true },
        "it's not night and it's not a thunderstorm": { outcome: 'not_sleep_time', retryable: true },
        'the bed is too far': { outcome: 'bed_too_far', retryable: true },
        'cant click the bed': { outcome: 'bed_interaction_failed', retryable: true },
        "there's only half bed": { outcome: 'bed_incomplete', retryable: false },
        'wrong block : not a bed block': { outcome: 'bed_changed', retryable: false },
        'already sleeping': { outcome: 'sleep_state_conflict', retryable: false },
        'already awake': { outcome: 'sleep_state_conflict', retryable: false },
        'bot is not sleeping': { outcome: 'sleep_not_confirmed', retryable: true },
    };
    return {
        message,
        ...(known[message] || { outcome: 'sleep_rejected', retryable: true }),
    };
}

export async function goToBed(bot, {
    navigate = goToPosition,
    now = Date.now,
    delay = ms => new Promise(resolve => setTimeout(resolve, ms)),
    standaloneSleepTimeoutMs = 600_000,
    exactPosition = null,
    expectedDimension = null,
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
        if (exactPosition) {
            if (
                ![exactPosition.x, exactPosition.y, exactPosition.z].every(Number.isFinite)
                || (expectedDimension && normalizedDimension(bot.game?.dimension) !== normalizedDimension(expectedDimension))
            ) throw new TypeError('The exact bed position or dimension does not match the current world.');
            beds = [new Vec3(
                Math.floor(exactPosition.x),
                Math.floor(exactPosition.y),
                Math.floor(exactPosition.z),
            )];
        } else {
            beds = bot.findBlocks({
                matching: block => block?.name?.endsWith('_bed'),
                maxDistance: 32,
                count: 4,
            });
        }
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
        dimension: normalizedDimension(bot.game?.dimension),
    };
    if (!bed?.name?.endsWith('_bed')) {
        setActionEvidence(bot, { kind: 'sleep', outcome: 'bed_unloaded', target, retryable: true });
        log(bot, 'The selected bed is no longer loaded.');
        return false;
    }
    const signal = actionCancellationSignal();
    if (bot.interrupt_code || signal?.aborted) {
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
    // The owned Mineflayer bed primitive returns a transition receipt. This is
    // required on a one-player server, where Paper can accept the bed and jump
    // to dawn without ever leaving isSleeping true for a caller to sample.
    let sleepTransition = null;
    try {
        sleepTransition = await bot.sleep(bed);
    } catch (error) {
        const rejection = classifySleepRejection(error);
        setActionEvidence(bot, {
            kind: 'sleep',
            outcome: rejection.outcome,
            target,
            error: rejection.message.slice(0, 180),
            retryable: rejection.retryable,
        });
        log(bot, `Could not sleep: ${error?.message || error}.`);
        return false;
    }
    if (!bot.isSleeping) {
        const completedTransition = sleepTransition?.enteredSleep === true
            && sleepTransition?.woke === true;
        if (completedTransition) {
            bot.modes.pause('unstuck');
            setActionEvidence(bot, {
                kind: 'sleep',
                outcome: 'slept',
                target,
                enteredSleep: true,
                woke: true,
                immediateDawn: sleepTransition?.immediateDawn === true,
                transitionEvidence: sleepTransition.evidence,
                retryable: false,
            });
            log(bot, 'You slept and woke at dawn.');
            return true;
        }
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
    // ActionManager's AbortSignal is the authoritative deadline and Stop
    // boundary. Direct callers that do not own an ActionManager context retain
    // one full-night backstop, but nested timers never shorten an owned action.
    const boundedStandaloneTimeoutMs = Number.isFinite(standaloneSleepTimeoutMs)
        ? Math.max(600_000, standaloneSleepTimeoutMs)
        : 600_000;
    const standaloneDeadline = signal
        ? Number.POSITIVE_INFINITY
        : now() + boundedStandaloneTimeoutMs;
    let cancellationRequested = false;
    let lastWakeRequestedAt = 0;
    while (bot.isSleeping) {
        if (bot.interrupt_code || signal?.aborted || now() >= standaloneDeadline) {
            cancellationRequested = true;
            const wakeRequestedAt = now();
            // Waking is a packet request, not an acknowledgement. Reissue it
            // until entityWake proves the body is no longer owned by the bed;
            // a lost first packet must not strand Stop behind a long sleep.
            if (wakeRequestedAt - lastWakeRequestedAt >= 500) {
                lastWakeRequestedAt = wakeRequestedAt;
                try {
                    await bot.wake?.();
                } catch {
                    // Do not release physical ownership until entityWake makes
                    // the postcondition true, even if Mineflayer rejects wake.
                }
            }
        }
        await delay(250);
    }
    if (cancellationRequested) {
        setActionEvidence(bot, {
            kind: 'sleep',
            outcome: 'interrupted',
            target,
            enteredSleep: true,
            woke: true,
            retryable: true,
        });
        return false;
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
    const cropSpec = mc.matureCropHarvestForBlock(farm.crop);
    return {
        soil,
        crop,
        planted: soil?.name === 'farmland' && crop?.name === farm.crop,
        mature: soil?.name === 'farmland'
            && crop?.name === farm.crop
            && Number(crop?._properties?.age) >= cropSpec.maxAge,
    };
}

export async function approachRememberedFarm(bot, rawFarm) {
    const farm = normalizeFarmState(rawFarm);
    if (!farm) {
        setActionEvidence(bot, { kind: 'farm_approach', outcome: 'invalid_farm_state', retryable: false });
        return false;
    }
    if (farm.dimension !== dimensionName(bot)) {
        setActionEvidence(bot, {
            kind: 'farm_approach',
            outcome: 'wrong_dimension',
            target: { name: farm.crop },
            expected: farm.dimension,
            observed: dimensionName(bot),
            retryable: true,
        });
        return false;
    }

    // A remembered farm may be outside loaded chunks. Native Pathfinder can
    // route to its durable coordinates without inspecting the crops, then the
    // loaded-world stance binder selects only verified perimeter footing.
    const xs = farm.cells.map(cell => cell.x);
    const zs = farm.cells.map(cell => cell.z);
    const center = {
        x: Math.floor((Math.min(...xs) + Math.max(...xs)) / 2),
        y: farm.cells[0].y + 1,
        z: Math.floor((Math.min(...zs) + Math.max(...zs)) / 2),
    };
    const coarseGoal = new pf.goals.GoalNear(center.x, center.y, center.z, 8);
    if (!coarseGoal.isEnd(bot.entity.position.floored())) {
        const reached = await goToGoal(bot, coarseGoal, {
            movements: () => safeMovements(bot),
            allowHealthBoundedDescent: false,
            allowLocalRecovery: false,
        });
        if (!reached || !coarseGoal.isEnd(bot.entity.position.floored())) {
            setActionEvidence(bot, {
                kind: 'farm_approach',
                outcome: 'farm_region_unreachable',
                target: { name: farm.crop, ...center },
                retryable: true,
            });
            return false;
        }
    }

    const stances = selectRememberedFarmStances(bot, farm.cells);
    if (stances.length === 0) {
        setActionEvidence(bot, {
            kind: 'farm_approach',
            outcome: 'farm_service_stance_unavailable',
            target: { name: farm.crop, ...center },
            retryable: true,
        });
        return false;
    }
    const serviceGoal = new pf.goals.GoalCompositeAny(
        stances.map(position => new pf.goals.GoalBlock(position.x, position.y, position.z)),
    );
    if (!serviceGoal.isEnd(bot.entity.position.floored())) {
        const reached = await goToGoal(bot, serviceGoal, {
            movements: () => safeMovements(bot),
            allowHealthBoundedDescent: false,
            allowLocalRecovery: false,
        });
        if (!reached || !serviceGoal.isEnd(bot.entity.position.floored())) {
            setActionEvidence(bot, {
                kind: 'farm_approach',
                outcome: 'farm_service_stance_unreachable',
                target: { name: farm.crop, ...center },
                candidates: stances.length,
                retryable: true,
            });
            return false;
        }
    }
    setActionEvidence(bot, {
        kind: 'farm_approach',
        outcome: 'arrived',
        target: { name: farm.crop, ...center },
        farm,
        retryable: false,
    });
    return true;
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
    const waterBlocks = world.getNearestBlocks(
        bot,
        'water',
        searchRange,
        MAX_FARM_WATER_CANDIDATES,
    ).filter(block => block?.position);
    if (waterBlocks.length === 0) {
        setActionEvidence(bot, { kind: 'farm_establish', outcome: 'missing_water', target: { name: spec.crop }, retryable: true });
        log(bot, `No loaded water source is available within ${searchRange} blocks for hydrated farmland.`);
        return false;
    }
    const requested = farmWidth * farmDepth;
    const selection = selectFarmSites(bot, waterBlocks, {
        crop: spec.crop,
        width: farmWidth,
        depth: farmDepth,
    });
    if (selection.sites.length === 0) {
        const nearestWater = waterBlocks[0].position;
        setActionEvidence(bot, {
            kind: 'farm_establish',
            outcome: 'insufficient_hydrated_soil',
            target: { name: spec.crop, x: nearestWater.x, y: nearestWater.y, z: nearestWater.z },
            requested,
            available: selection.bestAvailable,
            waterCandidates: selection.waterCount,
            retryable: true,
        });
        log(bot, `No coherent, safely serviceable hydrated ${farmWidth}x${farmDepth} farm site is loaded; the best candidate had ${selection.bestAvailable} of ${requested} usable plots.`);
        return false;
    }
    let site = null;
    const routeFailures = [];
    for (const candidate of selection.sites.slice(0, MAX_FARM_ROUTE_CANDIDATES)) {
        const goal = new pf.goals.GoalCompositeAny(
            candidate.stances.map(position => new pf.goals.GoalBlock(position.x, position.y, position.z)),
        );
        const route = goal.isEnd(bot.entity.position.floored())
            ? { status: 'success', path: [] }
            : bot.pathfinder.getPathTo(safeMovements(bot), goal, FARM_ROUTE_PROBE_TIMEOUT_MS);
        const routePath = Array.isArray(route?.path) ? route.path : [];
        const routeEnd = routePath.at(-1);
        const endpointDistance = routeEnd
            ? Math.min(...candidate.stances.map(position => Math.hypot(
                routeEnd.x - position.x,
                routeEnd.y - position.y,
                routeEnd.z - position.z,
            )))
            : Number.POSITIVE_INFINITY;
        const convergingPartial = route?.status === 'partial'
            && routePath.length > 0
            && endpointDistance + 1 < candidate.distance;
        if (route?.status === 'success' || convergingPartial) {
            site = {
                ...candidate,
                goal,
                routeProbe: {
                    status: route.status,
                    pathLength: routePath.length,
                    endpointDistance,
                },
            };
            break;
        }
        routeFailures.push({
            origin: candidate.origin,
            status: route?.status || 'unknown',
            pathLength: routePath.length,
            endpointDistance: Number.isFinite(endpointDistance) ? endpointDistance : null,
        });
    }
    if (!site) {
        setActionEvidence(bot, {
            kind: 'farm_establish',
            outcome: 'farm_site_unreachable',
            target: { name: spec.crop },
            candidates: Math.min(selection.sites.length, MAX_FARM_ROUTE_CANDIDATES),
            routeFailures,
            retryable: true,
        });
        log(bot, `Found ${selection.sites.length} complete hydrated farm site${selection.sites.length === 1 ? '' : 's'}, but native Pathfinder found no non-destructive route to the bounded candidates.`);
        return false;
    }
    const cells = site.cells;
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
    if (!site.goal.isEnd(bot.entity.position.floored())) {
        const reached = await goToGoal(bot, site.goal, {
            movements: () => safeMovements(bot),
            allowHealthBoundedDescent: false,
            allowLocalRecovery: false,
        });
        if (!reached || !site.goal.isEnd(bot.entity.position.floored())) {
            setActionEvidence(bot, {
                kind: 'farm_establish',
                outcome: 'farm_site_route_changed',
                target: { name: spec.crop, ...site.origin },
                retryable: true,
            });
            log(bot, 'The preflighted non-destructive farm route did not settle at its bound service stance.');
            return false;
        }
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
        water: site.water,
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
    if (!await approachRememberedFarm(bot, farm)) return false;
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

function livestockInPen(bot, animal, bounds) {
    return Object.values(bot.entities || {}).filter(entity => (
        entity?.name === animal
        && entity.position
        && entity.position.x > bounds.minX
        && entity.position.x < bounds.maxX + 1
        && entity.position.z > bounds.minZ
        && entity.position.z < bounds.maxZ + 1
        && entity.position.y >= bounds.y - 1
        && entity.position.y <= bounds.y + 2
    ));
}

function entityInsideLivestockBounds(entity, bounds) {
    return Boolean(
        !bounds
        || (
            entity?.position
            && entity.position.x > bounds.minX
            && entity.position.x < bounds.maxX + 1
            && entity.position.z > bounds.minZ
            && entity.position.z < bounds.maxZ + 1
            && entity.position.y >= bounds.y - 1
            && entity.position.y <= bounds.y + 2
        )
    );
}

async function releaseLivestockAttraction(bot, food) {
    if (bot.heldItem?.name !== food) return true;
    return await equip(bot, 'hand');
}

function noSprintLivestockMovements(bot) {
    const movements = safeMovements(bot);
    movements.allowSprinting = false;
    movements.canDig = false;
    movements.allow1by1towers = false;
    return movements;
}

function currentFenceGate(bot, point) {
    const block = bot.blockAt(new Vec3(point.x, point.y, point.z));
    return String(block?.name || '').endsWith('_fence_gate') ? block : null;
}

function fenceGateIsOpen(block) {
    try {
        return block?.getProperties?.()?.open === true;
    } catch {
        return false;
    }
}

async function setFenceGateOpen(bot, point, open) {
    let block = currentFenceGate(bot, point);
    if (!block) return false;
    if (fenceGateIsOpen(block) === open) return true;
    if (bot.entity.position.distanceTo(block.position) > 4.5) {
        const reached = await goToGoal(bot, new pf.goals.GoalNear(point.x, point.y, point.z, 3), {
            movements: () => noSprintLivestockMovements(bot),
            allowHealthBoundedDescent: false,
            allowLocalRecovery: false,
        });
        if (!reached || bot.interrupt_code) return false;
        block = currentFenceGate(bot, point);
        if (!block) return false;
    }
    try {
        await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true);
        await bot.activateBlock(block);
    } catch {
        return false;
    }
    return await waitForWorldCondition(bot, () => (
        fenceGateIsOpen(currentFenceGate(bot, point)) === open
    ), 2_000, 50);
}

function selectedLivestock(bot, ids) {
    return ids.map(id => bot.entities?.[id]).filter(entity => entity?.position);
}

function farthestLivestockFromBot(bot, ids) {
    return selectedLivestock(bot, ids)
        .sort((left, right) => (
            bot.entity.position.distanceTo(right.position)
            - bot.entity.position.distanceTo(left.position)
        ))[0] || null;
}

async function gatherSelectedLivestock(bot, ids, maximumDistance=7.5) {
    const allNear = () => {
        const selected = selectedLivestock(bot, ids);
        return selected.length === ids.length
            && selected.every(entity => bot.entity.position.distanceTo(entity.position) <= maximumDistance);
    };
    if (allNear()) return true;
    const farthest = farthestLivestockFromBot(bot, ids);
    if (!farthest) return false;
    const reached = await goToGoal(bot, new pf.goals.GoalFollow(farthest, 3), {
        movements: () => noSprintLivestockMovements(bot),
        allowHealthBoundedDescent: false,
        allowLocalRecovery: false,
    });
    if (!reached || bot.interrupt_code) return false;
    return await waitForWorldCondition(bot, allNear, 3_000, 100);
}

async function lureLivestockTo(bot, ids, destination, {
    distance=3,
    animalDistance=5,
} = {}) {
    let strides = 0;
    while (!bot.interrupt_code && remainingActionTimeMs() > 5_000) {
        const horizontal = Math.hypot(
            bot.entity.position.x - destination.x,
            bot.entity.position.z - destination.z,
        );
        if (horizontal <= distance) {
            return await waitForWorldCondition(bot, () => {
                const selected = selectedLivestock(bot, ids);
                return selected.length === ids.length
                    && selected.every(entity => (
                        Math.hypot(
                            entity.position.x - destination.x,
                            entity.position.z - destination.z,
                        ) <= animalDistance
                    ));
            }, 5_000, 100);
        }
        if (strides >= 40) return false;
        if (!await gatherSelectedLivestock(bot, ids)) return false;
        const step = Math.min(4, horizontal);
        const x = bot.entity.position.x + (((destination.x - bot.entity.position.x) / horizontal) * step);
        const z = bot.entity.position.z + (((destination.z - bot.entity.position.z) / horizontal) * step);
        // Bind the next horizontal stride to the highest loaded, supported
        // surface near that X/Z. Reusing the pen's final Y rejects ordinary
        // lower terrain, while GoalXZ alone may legally converge in a cave
        // directly underneath the requested surface route.
        const currentY = Math.floor(bot.entity.position.y);
        const surface = nearestLoadedSurfaceStandingCell(
            bot,
            new Vec3(Math.round(x), currentY, Math.round(z)),
            currentY - 4,
            currentY + 7,
            2,
            currentY - 1,
        ).target;
        if (!surface) return false;
        const reached = await goToGoal(bot, new pf.goals.GoalBlock(
            surface.x,
            surface.y,
            surface.z,
        ), {
            movements: () => noSprintLivestockMovements(bot),
            allowHealthBoundedDescent: false,
            allowLocalRecovery: false,
        });
        if (!reached) return false;
        strides += 1;
        if (!await waitForWorldCondition(bot, () => {
            const selected = selectedLivestock(bot, ids);
            return selected.length === ids.length
                && selected.every(entity => bot.entity.position.distanceTo(entity.position) <= 8);
        }, 3_000, 100)) {
            if (!await gatherSelectedLivestock(bot, ids)) return false;
        }
    }
    return false;
}

function livestockExteriorRoute(entity, outside, bounds) {
    const horizontalDistance = (left, right) => Math.hypot(left.x - right.x, left.z - right.z);
    if (horizontalDistance(entity.position, outside) <= 5) return [outside];
    const y = outside.y;
    const corners = [
        { x: bounds.minX - 2, y, z: bounds.minZ - 2 },
        { x: bounds.maxX + 3, y, z: bounds.minZ - 2 },
        { x: bounds.maxX + 3, y, z: bounds.maxZ + 3 },
        { x: bounds.minX - 2, y, z: bounds.maxZ + 3 },
    ];
    const nearestCorner = corners
        .map((point, index) => ({ index, distance: horizontalDistance(entity.position, point) }))
        .sort((left, right) => left.distance - right.distance || left.index - right.index)[0].index;
    const gateCorners = outside.x < bounds.minX
        ? [0, 3]
        : outside.x > bounds.maxX + 1
            ? [1, 2]
            : outside.z < bounds.minZ
                ? [0, 1]
                : [3, 2];
    const routes = [];
    for (const gateCorner of gateCorners) {
        for (const direction of [-1, 1]) {
            const route = [corners[nearestCorner]];
            let index = nearestCorner;
            while (index !== gateCorner && route.length <= corners.length) {
                index = (index + direction + corners.length) % corners.length;
                route.push(corners[index]);
            }
            route.push(outside);
            const length = route.reduce((total, point, routeIndex) => (
                total + horizontalDistance(routeIndex === 0 ? entity.position : route[routeIndex - 1], point)
            ), 0);
            routes.push({ route, length });
        }
    }
    return routes.sort((left, right) => left.length - right.length)[0].route;
}

async function lureLivestockAroundPen(bot, entity, outside, bounds) {
    for (const point of livestockExteriorRoute(entity, outside, bounds)) {
        if (!await lureLivestockTo(bot, [entity.id], point, {
            distance: 1.5,
            animalDistance: 4,
        })) return false;
    }
    return true;
}

function livestockHoldingPoint(outside, inside, bounds) {
    if (outside.x < bounds.minX) return { x: bounds.maxX - 1, y: inside.y, z: inside.z };
    if (outside.x > bounds.maxX + 1) return { x: bounds.minX + 1, y: inside.y, z: inside.z };
    if (outside.z < bounds.minZ) return { x: inside.x, y: inside.y, z: bounds.maxZ - 1 };
    if (outside.z > bounds.maxZ + 1) return { x: inside.x, y: inside.y, z: bounds.minZ + 1 };
    return { x: inside.x, y: inside.y, z: inside.z };
}

const REMEMBERED_LIVESTOCK_REGION_RADIUS = 96;
const LIVESTOCK_REGION_SEARCH_STEP = 40;
const LIVESTOCK_ACTION_FINISH_RESERVE_MS = 45_000;

function rememberedLivestockSearchWaypoints(source) {
    const offsets = [
        [0, 0],
        [1, 0], [1, 1], [0, 1], [-1, 1],
        [-1, 0], [-1, -1], [0, -1], [1, -1],
        [2, 0], [0, 2], [-2, 0], [0, -2],
    ];
    return offsets.map(([dx, dz]) => ({
        x: source.x + (dx * LIVESTOCK_REGION_SEARCH_STEP),
        z: source.z + (dz * LIVESTOCK_REGION_SEARCH_STEP),
    }));
}

function observedLivestockInRememberedRegion(bot, animal, source, bounds) {
    const sourcePoint = new Vec3(source.x, source.y, source.z);
    const penIds = new Set(livestockInPen(bot, animal, bounds).map(entity => entity.id));
    return Object.values(bot.entities || {})
        .filter(entity => (
            isAdultBreedingAnimal(entity, animal)
            && !penIds.has(entity.id)
            && entity.position.distanceTo(sourcePoint) <= REMEMBERED_LIVESTOCK_REGION_RADIUS
        ))
        .sort((left, right) => (
            bot.entity.position.distanceTo(left.position)
            - bot.entity.position.distanceTo(right.position)
            || left.id - right.id
        ));
}

async function reacquireLivestockInRememberedRegion(bot, animal, source, bounds, search) {
    let candidates = observedLivestockInRememberedRegion(bot, animal, source, bounds);
    if (candidates.length > 0) return candidates[0];

    while (
        !bot.interrupt_code
        && remainingActionTimeMs() > LIVESTOCK_ACTION_FINISH_RESERVE_MS
        && search.cursor < search.waypoints.length
    ) {
        const waypoint = search.waypoints[search.cursor++];
        const reached = await goToGoal(bot, new pf.goals.GoalXZ(
            Math.round(waypoint.x),
            Math.round(waypoint.z),
        ), {
            movements: () => noSprintLivestockMovements(bot),
            allowHealthBoundedDescent: false,
            allowLocalRecovery: false,
        });
        search.attempts += 1;
        if (bot.interrupt_code) return null;
        if (!reached) continue;
        await interruptibleDelay(bot, 250);
        candidates = observedLivestockInRememberedRegion(bot, animal, source, bounds);
        if (candidates.length > 0) return candidates[0];
    }
    return null;
}

export async function settleLivestockAtPen(bot, {
    animal: rawAnimal,
    adultCount: rawAdultCount,
    breedingPairs: rawBreedingPairs,
    source,
    gate,
    inside,
    outside,
    bounds,
    dimension,
    baselineAnimals: rawBaselineAnimals,
} = {}) {
    const animal = String(rawAnimal || '').trim().toLowerCase();
    const food = mc.breedingFoodForAnimal(animal);
    const adultCount = Math.max(2, Math.min(8, Math.floor(Number(rawAdultCount) || 2)));
    const breedingPairs = Math.max(1, Math.min(4, Math.floor(Number(rawBreedingPairs) || 1)));
    const baselineAnimals = Math.max(0, Math.floor(Number(rawBaselineAnimals) || 0));
    const target = { name: animal, source, gate, inside, outside, bounds, dimension };
    const fail = (outcome, detail, extra = {}) => {
        setActionEvidence(bot, {
            kind: 'livestock_settlement',
            outcome,
            target,
            requestedAdults: adultCount,
            breedingPairs,
            baselineAnimals,
            ...extra,
            retryable: ![
                'invalid_contract',
                'wrong_dimension',
                'pen_changed',
                'insufficient_source_adults',
            ].includes(outcome),
        });
        log(bot, detail);
        return false;
    };
    if (
        !food
        || ![source, gate, inside, outside].every(point => (
            point && [point.x, point.y, point.z].every(Number.isFinite)
        ))
        || !bounds
        || !['minX', 'maxX', 'minZ', 'maxZ', 'y'].every(key => Number.isFinite(bounds[key]))
    ) return fail('invalid_contract', 'The livestock settlement contract is incomplete.');
    if (normalizedDimension(bot.game?.dimension) !== normalizedDimension(dimension)) {
        return fail('wrong_dimension', `The selected pen is in ${dimension}, not this dimension.`);
    }
    if (!currentFenceGate(bot, gate)) {
        return fail('pen_changed', 'The exact selected fence gate is no longer present.');
    }
    const expectedFinal = baselineAnimals + adultCount + breedingPairs;
    let insideAnimals = livestockInPen(bot, animal, bounds);
    if (insideAnimals.length >= expectedFinal) {
        if (!await setFenceGateOpen(bot, gate, false)) {
            return fail('gate_close_failed', 'The livestock are already settled, but the exact pen gate could not be verified closed.');
        }
        setActionEvidence(bot, {
            kind: 'livestock_settlement',
            outcome: 'already_settled',
            target,
            requestedAdults: adultCount,
            breedingPairs,
            baselineAnimals,
            finalAnimals: insideAnimals.length,
            retryable: false,
        });
        log(bot, `The selected pen already contains the requested ${animal} settlement and its gate is closed.`);
        return true;
    }
    if (inventoryCount(bot, food) < breedingPairs * 2) {
        return fail(
            'missing_breeding_food',
            `Settling ${animal} requires ${breedingPairs * 2} ${food}; only ${inventoryCount(bot, food)} are carried.`,
            { food, requiredFood: breedingPairs * 2, availableFood: inventoryCount(bot, food) },
        );
    }

    const relocatedAlready = Math.max(0, insideAnimals.length - baselineAnimals);
    const remainingAdults = Math.max(0, adultCount - relocatedAlready);
    const sourceSearch = {
        waypoints: rememberedLivestockSearchWaypoints(source),
        cursor: 0,
        attempts: 0,
    };
    const holdingPoint = livestockHoldingPoint(outside, inside, bounds);

    let gateOpened = fenceGateIsOpen(currentFenceGate(bot, gate));
    try {
        for (let index = 0; index < remainingAdults; index += 1) {
            const selected = await reacquireLivestockInRememberedRegion(
                bot,
                animal,
                source,
                bounds,
                sourceSearch,
            );
            if (!selected) {
                return fail(
                    'insufficient_source_adults',
                    `The bounded remembered region contains fewer than ${remainingAdults} available adult ${animal}.`,
                    {
                        relocatedAdults: index,
                        requiredAdults: remainingAdults,
                        searchedWaypoints: sourceSearch.attempts,
                        searchRadius: REMEMBERED_LIVESTOCK_REGION_RADIUS,
                    },
                );
            }
            if (!await equip(bot, food)) return fail('food_equip_failed', `Could not hold ${food} to attract the selected ${animal}.`);
            const selectedIds = [selected.id];
            if (!await gatherSelectedLivestock(bot, selectedIds)) {
                return fail('livestock_gather_failed', `The selected ${animal} would not gather around the held ${food}.`);
            }
            if (!await lureLivestockAroundPen(bot, selected, outside, bounds)) {
                return fail('livestock_route_failed', `The selected ${animal} did not make verified progress to the exact pen gate.`);
            }
            if (!await setFenceGateOpen(bot, gate, true)) {
                return fail('gate_open_failed', 'The exact selected pen gate could not be opened for the livestock crossing.');
            }
            gateOpened = true;
            if (!await lureLivestockTo(bot, selectedIds, holdingPoint, {
                distance: 1,
                animalDistance: 1.5,
            })) {
                return fail('livestock_entry_failed', `The selected ${animal} did not cross into the exact pen.`);
            }
            const entered = await waitForWorldCondition(bot, () => (
                selectedIds.every(id => livestockInPen(bot, animal, bounds).some(entity => entity.id === id))
            ), 8_000, 100);
            if (!entered) return fail('livestock_entry_unverified', `Minecraft did not confirm the selected ${animal} inside the pen.`);
            if (!await releaseLivestockAttraction(bot, food)) {
                return fail('food_release_failed', `The ${animal} entered the pen, but the attraction food could not be safely put away.`);
            }
            await interruptibleDelay(bot, 750);
            const exited = await goToGoal(bot, new pf.goals.GoalNear(outside.x, outside.y, outside.z, 1), {
                movements: () => noSprintLivestockMovements(bot),
                allowHealthBoundedDescent: false,
                allowLocalRecovery: false,
            });
            if (!exited) return fail('pen_exit_failed', 'The bot could not exit the selected pen between livestock transfers.');
            if (!await setFenceGateOpen(bot, gate, false)) {
                return fail('gate_close_failed', 'The exact pen gate could not be closed after a livestock transfer.');
            }
            gateOpened = false;
        }

        if (bot.entity.position.distanceTo(new Vec3(holdingPoint.x, holdingPoint.y, holdingPoint.z)) > 2) {
            if (!await setFenceGateOpen(bot, gate, true)) {
                return fail('gate_open_failed', 'The exact selected pen gate could not be opened for breeding access.');
            }
            gateOpened = true;
            const reached = await goToGoal(bot, new pf.goals.GoalNear(
                holdingPoint.x,
                holdingPoint.y,
                holdingPoint.z,
                1,
            ), {
                movements: () => noSprintLivestockMovements(bot),
                allowHealthBoundedDescent: false,
                allowLocalRecovery: false,
            });
            if (!reached) return fail('pen_entry_failed', 'Could not enter the selected pen through native Pathfinder.');
        }
        if (!await setFenceGateOpen(bot, gate, false)) {
            return fail('gate_close_failed', 'The exact pen gate could not be closed before interior breeding work.');
        }
        gateOpened = false;

        insideAnimals = livestockInPen(bot, animal, bounds);
        if (insideAnimals.length < baselineAnimals + adultCount) {
            return fail(
                'adult_settlement_unverified',
                `The pen contains ${insideAnimals.length - baselineAnimals} of ${adultCount} requested new ${animal}.`,
                { finalAnimals: insideAnimals.length },
            );
        }
        if (!await breedAnimals(bot, animal, breedingPairs, 16, { bounds })) {
            return fail('breeding_failed', `The relocated ${animal} reached the pen, but breeding did not verify.`);
        }
        if (!await releaseLivestockAttraction(bot, food)) {
            return fail('food_release_failed', `The ${animal} were bred, but the attraction food could not be safely put away.`);
        }
        await interruptibleDelay(bot, 750);
        if (!await setFenceGateOpen(bot, gate, true)) {
            return fail('gate_open_failed', 'The exact selected pen gate could not be opened for the bot to exit.');
        }
        gateOpened = true;
        const exited = await goToGoal(bot, new pf.goals.GoalNear(outside.x, outside.y, outside.z, 1), {
            movements: () => noSprintLivestockMovements(bot),
            allowHealthBoundedDescent: false,
            allowLocalRecovery: false,
        });
        if (!exited) return fail('pen_exit_failed', 'The bot could not exit the selected pen before gate closure.');
        if (!await setFenceGateOpen(bot, gate, false)) {
            return fail('gate_close_failed', 'The livestock outcome is not complete because the exact pen gate did not close.');
        }
        gateOpened = false;
        const finalAnimals = livestockInPen(bot, animal, bounds).length;
        if (finalAnimals < expectedFinal) {
            return fail(
                'final_livestock_count_failed',
                `The closed pen contains ${finalAnimals}; at least ${expectedFinal} ${animal} were required from the bound baseline.`,
                { finalAnimals, expectedFinal },
            );
        }
        setActionEvidence(bot, {
            kind: 'livestock_settlement',
            outcome: 'settled_and_bred',
            target,
            requestedAdults: adultCount,
            breedingPairs,
            baselineAnimals,
            finalAnimals,
            gateClosed: true,
            retryable: false,
        });
        log(bot, `Settled ${adultCount} ${animal}, verified ${breedingPairs} breeding pair, exited, and closed the exact pen gate.`);
        return true;
    } finally {
        if (gateOpened && bot.entity?.position?.distanceTo(new Vec3(gate.x, gate.y, gate.z)) <= 5) {
            try { await setFenceGateOpen(bot, gate, false); } catch { /* best-effort world-safe cancellation cleanup */ }
        }
    }
}

export async function breedAnimals(bot, animalName, pairs=1, range=24, { bounds = null } = {}) {
    const animal = String(animalName || '').trim().toLowerCase();
    const food = mc.breedingFoodForAnimal(animal);
    const pairCount = Math.max(1, Math.min(4, Math.floor(Number(pairs) || 1)));
    const searchRange = Math.max(8, Math.min(48, Math.floor(Number(range) || 24)));
    if (!food) {
        setActionEvidence(bot, { kind: 'breed', outcome: 'unsupported_animal', target: { name: animal }, retryable: false });
        log(bot, 'Breeding supports cows, sheep, pigs, chickens, and rabbits.');
        return false;
    }
    const adults = world.getNearbyEntities(bot, searchRange)
        .filter(entity => isAdultBreedingAnimal(entity, animal) && entityInsideLivestockBounds(entity, bounds))
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
        .filter(entity => entity?.name === animal && entityInsideLivestockBounds(entity, bounds))
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
            .filter(entity => (
                isBabyBreedingAnimal(entity, animal)
                && entityInsideLivestockBounds(entity, bounds)
                && !beforeIds.has(entity.id)
            ))
            .length >= expectedBabies
    ), 12_000, 100);
    const newAnimals = world.getNearbyEntities(bot, searchRange)
        .filter(entity => (
            isBabyBreedingAnimal(entity, animal)
            && entityInsideLivestockBounds(entity, bounds)
            && !beforeIds.has(entity.id)
        ))
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
    const deadlineAt = Date.now() + Math.max(1_000, Math.min(12_000, Number(timeoutMs) || 8_000));
    const riseToBreathableSurface = async () => {
        bot.setControlState('jump', true);
        return await waitForWorldCondition(bot, () => {
            const head = bot.blockAt(bot.entity.position.offset(0, 1, 0));
            const oxygen = Number(bot.oxygenLevel);
            return head
                && head.name !== 'water'
                && !bot.entity?.isInLava
                && (!Number.isFinite(oxygen) || oxygen >= DROWNING_RECOVERY_OXYGEN);
        }, Math.max(1, deadlineAt - Date.now()), 100);
    };
    try {
        try { bot.pathfinder?.setGoal?.(null); } catch { /* best-effort immediate movement preemption */ }
        try { bot.clearControlStates(); } catch { /* best-effort control reset */ }
        const surfaced = await riseToBreathableSurface();
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

        // Mineflayer reports oxygen on a 0-20 scale, so reaching this point
        // means the immediate drowning hazard is resolved with a full air
        // reserve. Native Pathfinder may improve that result by reaching dry
        // support, but open water is not a failed rescue merely because no
        // loaded shoreline exists. The interrupted deterministic action owns
        // the destination once this bounded reflex releases ActionManager.
        bot.setControlState('jump', false);
        const feetPosition = bot.entity?.position?.floored?.() || null;
        const feet = feetPosition ? bot.blockAt(feetPosition) : null;
        const support = feetPosition ? bot.blockAt(feetPosition.offset(0, -1, 0)) : null;
        const alreadyStable = !isLiquidGameplayBlock(feet)
            && isTraversableShoreSupport(support);
        const shoreDeadlineAt = Math.max(Date.now(), deadlineAt - DROWNING_FINAL_ASCENT_RESERVE_MS);
        const shore = alreadyStable
            ? { success: true, outcome: 'stable_shore_reached', target: feetPosition }
            : await attemptShallowWaterExit(bot, { deadlineAt: shoreDeadlineAt });
        if (!shore.success) {
            const breathable = await riseToBreathableSurface();
            if (!breathable) {
                setActionEvidence(bot, {
                    kind: 'survival',
                    outcome: bot.interrupt_code ? 'interrupted' : 'drowning_escape_unconfirmed',
                    target,
                    oxygenBefore: Number.isFinite(startOxygen) ? startOxygen : null,
                    oxygenAfter: Number.isFinite(Number(bot.oxygenLevel)) ? Number(bot.oxygenLevel) : null,
                    shore,
                    retryable: !bot.interrupt_code,
                });
                return false;
            }
            setActionEvidence(bot, {
                kind: 'survival',
                outcome: 'drowning_escape_breathable_surface',
                target,
                oxygenBefore: Number.isFinite(startOxygen) ? startOxygen : null,
                oxygenAfter: Number.isFinite(Number(bot.oxygenLevel)) ? Number(bot.oxygenLevel) : null,
                shore,
                retryable: false,
            });
            log(bot, 'Reached breathable air; no loaded dry shore was reachable.');
            return true;
        }
        setActionEvidence(bot, {
            kind: 'survival',
            outcome: 'drowning_escape_stable',
            target: shore.target || target,
            oxygenBefore: Number.isFinite(startOxygen) ? startOxygen : null,
            oxygenAfter: Number.isFinite(Number(bot.oxygenLevel)) ? Number(bot.oxygenLevel) : null,
            shore: shore.outcome,
            retryable: false,
        });
        log(bot, 'Reached breathable air and stable shore.');
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
    if (!Number.isFinite(requested) || requested < 1 || requested > 384) {
        setActionEvidence(bot, {
            kind: 'descent',
            outcome: 'invalid_distance',
            target: { distance },
            retryable: false,
        });
        log(bot, 'Safe downward digging requires a distance from 1 to 384 blocks.');
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

function isSurfaceTerrainSupport(bot, block) {
    const name = String(block?.name || '');
    return Boolean(
        isAnchoredGameplaySupport(bot, block)
        && !/(?:_log|_stem|_leaves)$/.test(name)
        && !['bamboo', 'cactus', 'chorus_plant', 'chorus_flower'].includes(name)
    );
}

function countSurfaceScanOutcome(diagnostics, group, name) {
    if (!diagnostics) return;
    const key = String(name || 'unknown');
    diagnostics[group][key] = (diagnostics[group][key] || 0) + 1;
}

function loadedSurfaceStandingCell(bot, x, z, minY, maxY, diagnostics = null) {
    if (diagnostics) diagnostics.columns += 1;
    for (let y = maxY - 2; y >= minY; y -= 1) {
        const support = bot.blockAt(new Vec3(x, y, z));
        if (!support || support.boundingBox === 'empty') continue;
        if (!isSurfaceTerrainSupport(bot, support)) continue;
        const feet = support.position.offset(0, 1, 0);
        const feetBlock = bot.blockAt(feet);
        const headBlock = bot.blockAt(feet.offset(0, 1, 0));
        if (
            isCollectionStandingCellClear(feetBlock)
            && isCollectionStandingCellClear(headBlock)
        ) return feet;
        countSurfaceScanOutcome(
            diagnostics,
            'blockedBodies',
            `${feetBlock?.name || 'unloaded'}/${headBlock?.name || 'unloaded'}`,
        );
        // This is the top terrain block in the column, but vegetation or a
        // structure occupies its body space. A cave floor below is not a
        // substitute for literal surface access.
        return null;
    }
    if (diagnostics) diagnostics.noTerrain += 1;
    return null;
}

function nearestLoadedSurfaceStandingCell(
    bot,
    position,
    minY,
    maxY,
    radius = SURFACE_STANCE_SCAN_RADIUS,
    minimumStandingY = null,
) {
    const origin = position.floored();
    const diagnostics = { columns: 0, noTerrain: 0, blockedBodies: {} };
    for (let distance = 0; distance <= radius; distance += 1) {
        const candidates = [];
        for (let dx = -distance; dx <= distance; dx += 1) {
            for (let dz = -distance; dz <= distance; dz += 1) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) !== distance) continue;
                const target = loadedSurfaceStandingCell(
                    bot,
                    origin.x + dx,
                    origin.z + dz,
                    minY,
                    maxY,
                    diagnostics,
                );
                if (
                    target
                    && (!Number.isFinite(minimumStandingY) || target.y >= minimumStandingY)
                ) candidates.push(target);
            }
        }
        if (candidates.length > 0) {
            return {
                target: candidates.sort((left, right) => (
                position.distanceTo(left) - position.distanceTo(right)
                || left.y - right.y
                || left.x - right.x
                || left.z - right.z
                ))[0],
                diagnostics,
            };
        }
    }
    return { target: null, diagnostics };
}

function surfaceEgressStances(bot, supported, minY, maxY) {
    const candidates = [];
    for (
        let distance = SURFACE_EGRESS_MIN_DISTANCE;
        distance <= SURFACE_EGRESS_SCAN_RADIUS;
        distance += 1
    ) {
        for (let dx = -distance; dx <= distance; dx += 1) {
            for (let dz = -distance; dz <= distance; dz += 1) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) !== distance) continue;
                const stance = loadedSurfaceStandingCell(
                    bot,
                    supported.x + dx,
                    supported.z + dz,
                    minY,
                    maxY,
                );
                if (!stance || stance.y < supported.y - 1) continue;
                candidates.push(stance);
            }
        }
        if (candidates.length >= 32) break;
    }
    return candidates.slice(0, 32);
}

function occupiedUsableSurfaceStandingCell(bot, minY, maxY) {
    const supported = occupiedOpenSurfaceStandingCell(bot);
    if (!supported) return null;
    const egress = surfaceEgressStances(bot, supported, minY, maxY);
    if (egress.length === 0) return null;
    const route = probeSafeNavigationStances(bot, egress, SURFACE_EGRESS_PROBE_MS);
    return route.reachable ? supported : null;
}

function terminalSurfaceCorridorStances(bot, origin, minY, maxY) {
    const maximumRise = MAX_SURFACE_CORRIDOR_RISE * 2;
    const maximumRun = maximumRise + SURFACE_CORRIDOR_ROUTE_SLACK;
    const candidates = [];
    for (let dx = -maximumRun; dx <= maximumRun; dx += 1) {
        for (let dz = -maximumRun; dz <= maximumRun; dz += 1) {
            const horizontalRun = Math.abs(dx) + Math.abs(dz);
            if (horizontalRun === 0 || horizontalRun > maximumRun) continue;
            const stance = loadedSurfaceStandingCell(
                bot,
                origin.x + dx,
                origin.z + dz,
                minY,
                maxY,
            );
            if (!stance) continue;
            const rise = stance.y - origin.y;
            if (rise < MIN_SURFACE_ROUTE_PROGRESS || rise > maximumRise) continue;
            // Every corridor step moves one horizontal cell. An endpoint with
            // less horizontal displacement than vertical rise forces a folded
            // staircase whose later support overlaps previously excavated
            // headroom. Bind a literal surface cell that admits monotonic
            // supported convergence instead of making search invent a spiral.
            if (horizontalRun < rise || horizontalRun > rise + SURFACE_CORRIDOR_ROUTE_SLACK) {
                continue;
            }
            candidates.push({ stance, rise, horizontalRun });
        }
    }
    return candidates
        .sort((left, right) => (
            Math.abs(left.horizontalRun - left.rise)
            - Math.abs(right.horizontalRun - right.rise)
            || left.horizontalRun - right.horizontalRun
            || right.rise - left.rise
            || left.stance.x - right.stance.x
            || left.stance.z - right.stance.z
        ))
        .slice(0, MAX_SURFACE_CORRIDOR_STANCES)
        .map(candidate => candidate.stance);
}

function surfaceCorridorStances(bot, origin, surfaceTarget, minY, maxY) {
    const remainingRise = Math.max(2, Math.ceil(surfaceTarget.y - origin.y));
    const terminalStances = terminalSurfaceCorridorStances(bot, origin, minY, maxY);
    if (terminalStances.length > 0) return terminalStances;
    const rise = Math.min(MAX_SURFACE_CORRIDOR_RISE, remainingRise);
    const run = rise;
    const stances = [];
    const keys = new Set();
    for (const heading of orderedMiningHeadings(bot)) {
        const x = origin.x + (heading.x * run);
        const z = origin.z + (heading.z * run);
        let stance = new Vec3(x, origin.y + rise, z);
        if (remainingRise <= MAX_SURFACE_CORRIDOR_RISE) {
            const observedSurface = loadedSurfaceStandingCell(bot, x, z, minY, maxY);
            const observedRise = observedSurface ? observedSurface.y - origin.y : Number.POSITIVE_INFINITY;
            if (observedRise >= MIN_SURFACE_ROUTE_PROGRESS
                && observedRise <= MAX_SURFACE_CORRIDOR_RISE) {
                stance = observedSurface;
            }
        }
        const support = bot.blockAt(stance.offset(0, -1, 0));
        if (!support || !isAnchoredGameplaySupport(bot, support)) continue;
        const key = miningCellKey(stance);
        if (keys.has(key)) continue;
        keys.add(key);
        stances.push(stance);
        if (stances.length >= MAX_SURFACE_CORRIDOR_STANCES) return stances;
    }
    return stances;
}

function incrementalSurfaceCorridorStances(bot, origin, surfaceTarget) {
    const candidates = [];
    const keys = new Set();
    for (let horizontal = 1; horizontal <= MAX_SURFACE_CORRIDOR_RISE; horizontal += 1) {
        for (let dx = -horizontal; dx <= horizontal; dx += 1) {
            for (let dz = -horizontal; dz <= horizontal; dz += 1) {
                if (Math.abs(dx) + Math.abs(dz) !== horizontal) continue;
                for (const rise of [2, 1]) {
                    if (rise > horizontal) continue;
                    const stance = origin.offset(dx, rise, dz);
                    const support = bot.blockAt(stance.offset(0, -1, 0));
                    if (!support || !isAnchoredGameplaySupport(bot, support)) continue;
                    const key = miningCellKey(stance);
                    if (keys.has(key)) continue;
                    keys.add(key);
                    candidates.push({
                        stance,
                        rise,
                        horizontal,
                        targetDistance: Math.hypot(
                            surfaceTarget.x - stance.x,
                            surfaceTarget.z - stance.z,
                        ),
                    });
                }
            }
        }
    }
    return candidates
        .sort((left, right) => (
            right.rise - left.rise
            || left.targetDistance - right.targetDistance
            || left.horizontal - right.horizontal
            || left.stance.x - right.stance.x
            || left.stance.z - right.stance.z
        ))
        .slice(0, MAX_SURFACE_CORRIDOR_STANCES)
        .map(candidate => candidate.stance);
}

function bindSurfaceCorridorPlan(bot, surfaceTarget, minY, maxY) {
    const origin = observedSupportedStandingCell(bot);
    if (!origin) return { ok: false, outcome: 'position_unavailable' };
    const stances = surfaceCorridorStances(bot, origin, surfaceTarget, minY, maxY);
    const incrementalStances = incrementalSurfaceCorridorStances(bot, origin, surfaceTarget);
    if (stances.length === 0 && incrementalStances.length === 0) {
        return { ok: false, outcome: 'no_safe_surface_stance' };
    }
    const planFor = (candidateStances, requestedLength, maxRouteSteps = null) => buildMiningAccessPlan(
        bot,
        null,
        requestedLength,
        {
            breakTarget: false,
            stances: candidateStances,
            allowUnharvestedBreaks: true,
            allowNaturalFoliageExcavation: true,
            stageFallingDebris: true,
            ...(Number.isFinite(maxRouteSteps) ? { maxRouteSteps } : {}),
        },
    );
    let plan = stances.length > 0
        ? planFor(stances, SURFACE_CORRIDOR_ROUTE_SLACK)
        : planFor(incrementalStances, MAX_SURFACE_CORRIDOR_RISE, MAX_SURFACE_CORRIDOR_RISE + 2);
    if (
        !plan.ok
        && !['insufficient_tool_durability', 'route_deadline_insufficient'].includes(plan.outcome)
        && incrementalStances.length > 0
    ) {
        plan = planFor(
            incrementalStances,
            MAX_SURFACE_CORRIDOR_RISE,
            MAX_SURFACE_CORRIDOR_RISE + 2,
        );
    }
    if (!plan.ok && plan.outcome === 'route_deadline_insufficient') {
        plan = selectMiningDeadlinePrefix(plan, remainingActionTimeMs()) || plan;
    }
    return plan;
}

function surfaceArrivalObservation(bot, minY, maxY) {
    const observed = bot.entity?.position?.clone?.() || null;
    const supported = observedSupportedStandingCell(bot);
    // Seeing the sky is not sufficient surface access: a ravine or open pit
    // floor can be supported and open overhead while ordinary locomotion has
    // no way onto the surrounding terrain. Require native Pathfinder to prove
    // usable horizontal egress from the occupied stance. If it cannot, bind a
    // genuinely higher surface cell so deterministic recovery keeps climbing.
    const occupiedOpenSurface = occupiedOpenSurfaceStandingCell(bot);
    const occupiedUsableSurface = occupiedOpenSurface
        ? occupiedUsableSurfaceStandingCell(bot, minY, maxY)
        : null;
    const scan = occupiedUsableSurface
        ? { target: supported, diagnostics: null }
        : observed
        ? nearestLoadedSurfaceStandingCell(
            bot,
            observed,
            minY,
            maxY,
            SURFACE_STANCE_SCAN_RADIUS,
            occupiedOpenSurface ? supported.y + MIN_SURFACE_ROUTE_PROGRESS : null,
        )
        : { target: null, diagnostics: null };
    const target = scan.target;
    return {
        observed,
        supported,
        target,
        scan: scan.diagnostics,
        arrived: Boolean(observed && supported && occupiedUsableSurface && target),
    };
}

export async function goToSurface(bot) {
    const origin = bot.entity.position.clone();
    const minY = Number.isFinite(Number(bot.game?.minY)) ? Number(bot.game.minY) : -64;
    const height = Number.isFinite(Number(bot.game?.height)) ? Number(bot.game.height) : 384;
    const maxY = minY + Math.max(1, height) - 1;
    let lastTarget = null;

    const finishReached = (arrival, leg, routeDigging = false) => {
        const support = bot.blockAt(arrival.supported.offset(0, -1, 0));
        setActionEvidence(bot, {
            kind: 'surface_navigation',
            outcome: 'surface_reached',
            target: { x: arrival.target.x, y: arrival.target.y, z: arrival.target.z },
            observed: {
                x: arrival.observed.x,
                y: arrival.observed.y,
                z: arrival.observed.z,
            },
            support: support?.name || null,
            legs: leg,
            verticalProgress: arrival.observed.y - origin.y,
            routeDigging,
            retryable: false,
        });
        log(bot, `Reached a verified loaded surface stance at y=${arrival.target.y} in ${leg} bounded route leg${leg === 1 ? '' : 's'}.`);
        return true;
    };

    for (let leg = 1; leg <= MAX_SURFACE_ROUTE_LEGS; leg += 1) {
        if (bot.interrupt_code || remainingActionTimeMs() <= 0) break;
        const before = surfaceArrivalObservation(bot, minY, maxY);
        if (before.arrived) return finishReached(before, leg - 1);
        const target = before.target;
        lastTarget = target || lastTarget;
        if (!target) {
            setActionEvidence(bot, {
                kind: 'surface_navigation',
                outcome: 'surface_not_loaded',
                observed: before.observed,
                scan: before.scan,
                legs: leg - 1,
                verticalProgress: before.observed?.y - origin.y,
                supported: Boolean(before.supported),
                retryable: true,
            });
            const blockers = Object.entries(before.scan?.blockedBodies || {})
                .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
                .slice(0, 4)
                .map(([name, count]) => `${name}:${count}`)
                .join(', ');
            log(
                bot,
                `No loaded, stable surface stance is visible in ${before.scan?.columns || 0} bounded columns`
                    + `${blockers ? `; body blockers ${blockers}` : ''}.`,
            );
            return false;
        }

        const nativeStart = bot.entity.position.clone();
        // The scan already bound a concrete, supported surface stance. Asking
        // Pathfinder for any cell at the same elevation makes its search fan
        // out through the whole cave and can time out despite a viable route to
        // the selected exit. Keep the native locomotion policy, but give it the
        // exact usable stance the surface planner chose.
        const routed = await goToGoal(bot, new pf.goals.GoalNear(
            target.x,
            target.y,
            target.z,
            2,
        ), {
            movements: () => monotonicSurfaceMovements(bot),
            allowHealthBoundedDescent: false,
            allowLocalRecovery: false,
        });
        let arrival = surfaceArrivalObservation(bot, minY, maxY);
        if (arrival.target) lastTarget = arrival.target;
        if (arrival.arrived) return finishReached(arrival, leg);
        const nativeRise = arrival.observed.y - nativeStart.y;
        if (!bot.interrupt_code && arrival.supported && nativeRise >= MIN_SURFACE_ROUTE_PROGRESS) {
            log(bot, `Native Pathfinder advanced ${nativeRise.toFixed(1)} vertical blocks without excavation; rebinding surface leg ${leg}/${MAX_SURFACE_ROUTE_LEGS}.`);
            continue;
        }
        if (bot.interrupt_code) break;

        const plan = bindSurfaceCorridorPlan(bot, target, minY, maxY);
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
                kind: 'surface_navigation',
                outcome: plan.outcome || 'no_safe_surface_route',
                target: { x: target.x, y: target.y, z: target.z },
                observed: arrival.observed,
                routeOutcome: bot.lastActionEvidence?.outcome || (routed ? 'goal_resolved' : 'unreachable'),
                consideredRoutes: plan.consideredRoutes || 0,
                consideredStates: plan.consideredStates || 0,
                expandedStates: plan.expandedStates || 0,
                routeOutcomes: plan.routeOutcomes || null,
                searchRejections: plan.searchRejections || null,
                searchLimitReached: plan.searchLimitReached === true,
                ...(toolRequirement ? { toolRequirement } : {}),
                routeDigging: true,
                legs: leg,
                verticalProgress: arrival.observed.y - origin.y,
                supported: Boolean(arrival.supported),
                retryable: true,
            });
            const dominantRejections = Object.entries({
                ...(plan.searchRejections || {}),
                ...(plan.routeOutcomes || {}),
            })
                .filter(([outcome]) => ![
                    'corridor_bounds',
                    'route_cell_revisited',
                    'route_step_budget_exceeded',
                ].includes(outcome))
                .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
                .slice(0, 4)
                .map(([outcome, count]) => `${outcome}:${count}`)
                .join(', ');
            log(
                bot,
                `No bounded deterministic surface corridor is safe from this stance (${String(plan.outcome || 'no safe route').replace(/_/g, ' ')})`
                    + `${dominantRejections ? `; ${dominantRejections}` : ''}.`,
            );
            return false;
        }

        const corridorStart = bot.entity.position.clone();
        const access = await executeMiningAccessPlan(bot, null, plan);
        if (!access.success) {
            const observed = access.observed || bot.entity.position;
            setActionEvidence(bot, {
                kind: 'surface_navigation',
                outcome: access.outcome,
                target: { x: target.x, y: target.y, z: target.z },
                observed,
                routeSteps: plan.route.length,
                excavated: access.excavated,
                blockBudget: plan.blockBudget,
                accessFailureOutcome: access.failureOutcome || access.outcome,
                retreat: access.retreat || null,
                routeDigging: true,
                legs: leg,
                verticalProgress: observed.y - origin.y,
                supported: Boolean(observedSupportedStandingCell(bot)),
                retryable: !bot.interrupt_code,
            });
            log(bot, `Deterministic surface corridor stopped (${String(access.failureOutcome || access.outcome).replace(/_/g, ' ')}).`);
            return false;
        }

        arrival = surfaceArrivalObservation(bot, minY, maxY);
        if (arrival.target) lastTarget = arrival.target;
        if (arrival.arrived) return finishReached(arrival, leg, true);
        const corridorRise = arrival.observed.y - corridorStart.y;
        const verifiedPrefixAdvance = Boolean(
            plan.partial === true
            && access.outcome === 'route_advanced'
            && Number(access.reachedSteps) > 0
            && arrival.supported
        );
        if (verifiedPrefixAdvance) {
            // A deadline-safe prefix can end on a horizontal staging cell
            // before the staircase rises. The executor has already proved the
            // exact bound cell clear, supported, occupied, and returnable, so
            // continue the same bounded recovery action from that new stance.
            // Arbitrary lateral Pathfinder displacement still does not count.
            log(bot, `Deterministic excavation occupied ${access.reachedSteps} verified prefix cell${access.reachedSteps === 1 ? '' : 's'}; rebinding surface leg ${leg}/${MAX_SURFACE_ROUTE_LEGS}.`);
            continue;
        }
        if (arrival.supported && corridorRise >= MIN_SURFACE_ROUTE_PROGRESS) {
            log(bot, `Deterministic excavation advanced ${corridorRise.toFixed(1)} vertical blocks through ${plan.route.length} preflighted cells; rebinding surface leg ${leg}/${MAX_SURFACE_ROUTE_LEGS}.`);
            continue;
        }
        setActionEvidence(bot, {
            kind: 'surface_navigation',
            outcome: 'non_convergent_surface_corridor',
            target: { x: target.x, y: target.y, z: target.z },
            observed: arrival.observed,
            routeSteps: plan.route.length,
            excavated: access.excavated,
            routeDigging: true,
            legs: leg,
            verticalProgress: arrival.observed.y - origin.y,
            supported: Boolean(arrival.supported),
            retryable: true,
        });
        log(bot, 'The deterministic surface corridor completed without verified upward convergence.');
        return false;
    }

    const observed = bot.entity.position;
    const supported = observedSupportedStandingCell(bot);
    const verticalProgress = observed.y - origin.y;
    const verifiedProgress = Boolean(
        !bot.interrupt_code
        && supported
        && verticalProgress > 0
    );
    setActionEvidence(bot, {
        kind: 'surface_navigation',
        outcome: bot.interrupt_code ? 'interrupted' : 'surface_progress_incomplete',
        ...(lastTarget ? { target: { x: lastTarget.x, y: lastTarget.y, z: lastTarget.z } } : {}),
        observed: { x: observed.x, y: observed.y, z: observed.z },
        legs: MAX_SURFACE_ROUTE_LEGS,
        verticalProgress,
        supported: Boolean(supported),
        ...(verifiedProgress ? {
            progress: {
                verified: true,
                kind: 'surface_route_cell',
                position: { x: supported.x, y: supported.y, z: supported.z },
            },
        } : {}),
        retryable: !bot.interrupt_code,
    });
    log(bot, bot.interrupt_code
        ? 'Surface navigation was interrupted before verified arrival.'
        : `Surface navigation made bounded progress but did not reach a verified surface after ${MAX_SURFACE_ROUTE_LEGS} route legs.`);
    return false;
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
    const binding = await bindExistingWorkstation(
        bot,
        blockName,
        WORKSTATION_SEARCH_RANGE,
        navigate === goToPosition ? null : navigate,
    );
    if (binding.outcome === 'ready') return { block: binding.block, code: null };
    if (binding.outcome === 'interrupted') return { block: null, code: 'interrupted' };
    return {
        block: null,
        code: `${blockName}_${binding.outcome === 'not_found' ? 'not_found' : 'unreachable'}`,
    };
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
