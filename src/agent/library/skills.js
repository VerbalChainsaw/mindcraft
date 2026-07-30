import * as mc from "../../utils/mcdata.js";
import * as world from "./world.js";
import pf from 'mineflayer-pathfinder';
import Vec3 from 'vec3';
import settings from "../../../settings.js";
import {
    isFallingGameplayBlock,
    isHazardousGameplayBlock,
    isLiquidGameplayBlock,
    isProtectedGameplayBlock,
    isSafeGameplaySupport,
} from '../runtime/gameplay-safety.js';
import { collectorMatchesPlayerTarget, resolvePlayerTarget } from '../player-target.js';
import { companionContextFor, normalizePlayerDistance } from '../runtime/companion-context.js';

const blockPlaceDelay = settings.block_place_delay == null ? 0 : settings.block_place_delay;
const useDelay = blockPlaceDelay > 0;
const doorIntervals = new WeakMap();
const FOLLOW_SAMPLE_MS = 500;
const FOLLOW_STUCK_AFTER_MS = 5_000;
const MAX_FOLLOW_RECOVERY_ATTEMPTS = 2;
const MAX_AVOID_RETREAT_ATTEMPTS = 3;
const MIN_MOVEMENT_PROGRESS = 0.1;
const MAX_DEFENSE_SWINGS = 14;
const MAX_DEFENSE_FAILURES = 2;
const DEFENSE_SWING_INTERVAL_MS = 550;
const MAX_PVP_ENGAGEMENT_MS = 30_000;
const MAX_MELEE_REACH = 3.2;
const ATTACK_CONFIRM_TIMEOUT_MS = 900;
const ATTACK_INTERRUPT_POLL_MS = 50;
const TABLE_DROP_SEARCH_RADIUS = 4;
const TABLE_DROP_APPEAR_TIMEOUT_MS = 1_500;
const TABLE_PICKUP_TIMEOUT_MS = 1_500;
const INVENTORY_POLL_MS = 100;
const DOOR_SEARCH_RADIUS = 16;
const DOOR_INTERACTION_REACH = 4.5;
const DOOR_STATE_SETTLE_MS = 150;
const DOOR_TRAVERSE_TIMEOUT_MS = 1_200;
const DOOR_TRAVERSE_POLL_MS = 50;
const MIN_DOOR_TRAVERSE_PROGRESS = 0.75;
const INTERACTION_CONFIRM_TIMEOUT_MS = 750;
const INTERACTION_CONFIRM_POLL_MS = 50;

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
        await new Promise(resolve => setTimeout(resolve, INVENTORY_POLL_MS));
    }
    return inventoryCount(bot, itemName) >= expectedCount;
}

async function waitForWorldCondition(bot, predicate, timeoutMs, pollMs=50) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !bot.interrupt_code) {
        if (predicate()) return true;
        await new Promise(resolve => setTimeout(resolve, pollMs));
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
            await new Promise(resolve => setTimeout(resolve, INVENTORY_POLL_MS));
        }
    }
    if (!droppedTable) {
        return {
            outcome: bot.interrupt_code ? 'recovery_interrupted' : 'table_drop_unobserved',
            target,
            retryable: !bot.interrupt_code,
        };
    }

    const reached = await goToGoal(bot, new pf.goals.GoalFollow(droppedTable, 1));
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

function safeMovements(bot) {
    const movements = new pf.Movements(bot);
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
    return movements;
}

function collectionSafetyMovements(bot) {
    const movements = safeMovements(bot);
    // This instance evaluates whether an explicitly selected resource may be
    // broken. It is never used as the ordinary route policy.
    movements.canDig = true;
    return movements;
}

function targetScopedCollectionMovements(bot, targetBlock) {
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
    movements.safeToBreak = (candidate) => (
        candidate?.type === target.type
        && candidate?.position?.x === target.x
        && candidate?.position?.y === target.y
        && candidate?.position?.z === target.z
        && safetyGuard.safeToBreak(candidate)
    );
    return movements;
}

export function log(bot, message) {
    bot.output += message + '\n';
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
        const craftingTableRange = 16;

        if (!recipes?.length) {
            recipes = bot.recipesFor(itemId, null, 1, true);
            if (!recipes?.length) {
                const ingredients = Object.entries(recipeDocs[0]?.[0] || {}).map(([key, value]) => `${key}: ${value}`).join(', ');
                return finish(false, { kind: 'craft', outcome: 'missing_material', target, retryable: true }, `You do not have the resources to craft ${itemName}${ingredients ? `. It requires: ${ingredients}.` : '.'}`);
            }

            craftingTable = world.getNearestBlock(bot, 'crafting_table', craftingTableRange);
            let worldTableRouteFailed = false;
            if (craftingTable && bot.entity.position.distanceTo(craftingTable.position) > 4) {
                const reached = await goToPosition(bot, craftingTable.position.x, craftingTable.position.y, craftingTable.position.z, 4);
                if (!reached || bot.entity.position.distanceTo(craftingTable.position) > 4.5) {
                    if (bot.interrupt_code) {
                        return finish(false, { kind: 'craft', outcome: 'interrupted', target, retryable: false }, 'Crafting was interrupted while approaching the crafting table.');
                    }
                    worldTableRouteFailed = true;
                    craftingTable = null;
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
            try {
                cleanup = await recoverLocalCraftingTable(bot, temporaryTable);
            } catch (error) {
                cleanup = {
                    outcome: 'table_cleanup_failed',
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
            if (cleanup.outcome !== 'recovered' && cleanup.outcome !== 'already_recovered') {
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
        return { max: Infinity, used: 0, remaining: Infinity, healthy: true };
    }
    const used = Math.max(0, Number(item?.durabilityUsed) || 0);
    const remaining = Math.max(0, max - used);
    const replacementAt = Math.max(16, Math.ceil(max * 0.1));
    return { max, used, remaining, healthy: remaining > replacementAt };
}

function bestInventoryTool(bot, family, { allowWorn=false } = {}) {
    return bot.inventory.items()
        .filter(item => (
            item.name.endsWith(`_${family}`)
            && (allowWorn || toolDurability(bot, item).healthy)
        ))
        .sort((left, right) => {
            const leftTier = TOOL_TIER[left.name.split('_')[0]] || 0;
            const rightTier = TOOL_TIER[right.name.split('_')[0]] || 0;
            if (rightTier !== leftTier) return rightTier - leftTier;
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
        ? bestInventoryTool(bot, family)
        : null;
    if (preferred && block.canHarvest(preferred.type)) {
        await bot.equip(preferred, 'hand');
        return preferred;
    }
    await bot.tool.equipForBlock(block);
    if (family && bot.heldItem?.name?.endsWith(`_${family}`)) {
        const heldDurability = toolDurability(bot, bot.heldItem);
        const durableAlternative = bestInventoryTool(bot, family);
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
        const missing = minimum - inventoryCount(bot, 'cobblestone');
        if (!await collectBlock(bot, 'cobblestone', missing) || interrupt()) return false;
        return inventoryCount(bot, 'cobblestone') >= minimum;
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
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
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
        furnaceBlock = world.getNearestBlock(bot, 'furnace', 16);
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
                return finish(false, 'furnace_unreachable');
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


function performVerifiedMeleeHit(bot, entity, timeoutMs=ATTACK_CONFIRM_TIMEOUT_MS) {
    return new Promise(resolve => {
        let settled = false;
        let timeout = null;
        let interruptPoll = null;
        let sawUnattributedHurt = false;
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
            if (hurtEntity?.id !== targetId) return;
            if (source?.id === bot.entity?.id) {
                finish({ confirmed: true, outcome: 'hit' });
                return;
            }
            if (!source) sawUnattributedHurt = true;
        };
        const onEntityDead = deadEntity => {
            if (deadEntity?.id === targetId) {
                finish({ confirmed: false, outcome: 'target_died_unattributed' });
            }
        };

        bot.on('entityHurt', onEntityHurt);
        bot.on('entityDead', onEntityDead);
        timeout = setTimeout(() => {
            finish({
                confirmed: false,
                outcome: bot.interrupt_code
                    ? 'interrupted'
                    : sawUnattributedHurt
                        ? 'hurt_unattributed'
                        : 'damage_unconfirmed',
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

        setActionEvidence(bot, { kind: 'combat', outcome: 'hit', target, distance, retryable: false });
        return true;
    }
    else {
        let targetDied = false;
        let defeatAttributed = false;
        let attributedHits = 0;
        let lastDamageSourceId = null;
        const onEntityHurt = (hurtEntity, source) => {
            if (hurtEntity?.id !== entity.id) return;
            lastDamageSourceId = source?.id ?? null;
            if (lastDamageSourceId === bot.entity?.id) attributedHits += 1;
        };
        const onEntityDead = deadEntity => {
            if (deadEntity?.id !== entity.id) return;
            targetDied = true;
            defeatAttributed = lastDamageSourceId === bot.entity?.id;
        };
        const startedAt = Date.now();
        bot.on('entityHurt', onEntityHurt);
        bot.on('entityDead', onEntityDead);

        try {
            bot.pvp.attack(entity);
            while (!targetDied && Date.now() - startedAt < MAX_PVP_ENGAGEMENT_MS) {
                await new Promise(resolve => setTimeout(resolve, 1_000));
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

            if (!defeatAttributed) {
                setActionEvidence(bot, {
                    kind: 'combat',
                    outcome: 'target_died_unattributed',
                    target,
                    attributedHits,
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
                attributedHits,
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

            await new Promise(resolve => setTimeout(resolve, DEFENSE_SWING_INTERVAL_MS));
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



export async function collectBlock(bot, blockType, num=1, exclude=null, range=64) {
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
    const isLiquid = blockType === 'lava' || blockType === 'water';
    const searchRange = Math.max(1, Math.min(512, Math.floor(Number(range) || 64)));

    let collected = 0;
    let lowestCollectedTarget = null;

    const selectionMovements = collectionSafetyMovements(bot);
    bot.pathfinder.setMovements(safeMovements(bot));

    for (let i=0; i<num; i++) {
        let blocks = world.getNearestBlocksWhere(bot, block => {
            if (!blocktypes.includes(block.name)) {
                return false;
            }
            if (exclude) {
                for (let position of exclude) {
                    if (block.position.x === position.x && block.position.y === position.y && block.position.z === position.z) {
                        return false;
                    }
                }
            }
            if (isLiquid) {
                // collect only source blocks
                return block.metadata === 0;
            }
            
            return selectionMovements.safeToBreak(block);
        }, searchRange, 1);

        if (blocks.length === 0) {
            if (collected === 0) {
                setActionEvidence(bot, {
                    kind: 'collect',
                    outcome: 'not_collected',
                    target: { name: blockType },
                    count: 0,
                    retryable: true,
                });
            }
            if (collected === 0)
                log(bot, `No ${blockType} nearby to collect.`);
            else
                log(bot, `No more ${blockType} nearby to collect.`);
            break;
        }
        const block = blocks[0];
        const target = { name: block.name, x: block.position.x, y: block.position.y, z: block.position.z };
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
        try {
            let success = false;
            if (isLiquid) {
                success = await useToolOnBlock(bot, 'bucket', block);
            }
            else if (mc.mustCollectManually(blockType)) {
                const reached = await goToPosition(bot, block.position.x, block.position.y, block.position.z, 2);
                if (!reached || bot.entity.position.distanceTo(block.position) > 4.5) {
                    setActionEvidence(bot, { kind: 'collect', outcome: 'unreachable', target, retryable: true });
                    log(bot, `Cannot reach ${block.name} to collect it.`);
                    return false;
                }
                await bot.dig(block);
                const remaining = bot.blockAt(block.position);
                if (!remaining || remaining.name === block.name) {
                    setActionEvidence(bot, { kind: 'collect', outcome: 'not_broken', target, retryable: true });
                    log(bot, `Could not verify that ${block.name} was collected.`);
                    return false;
                }
                if (!await pickupNearbyItems(bot)) {
                    setActionEvidence(bot, { kind: 'collect', outcome: 'not_collected', target, retryable: true });
                    return false;
                }
                success = true;
            }
            else {
                const beforeDropCount = inventoryCountByTypes(bot, expectedDropTypes);
                // The plugin requires canDig=true even for its explicit target
                // and mutates the supplied policy. Scope that permission to this
                // exact block, then restore ordinary non-digging movement.
                bot.collectBlock.movements = targetScopedCollectionMovements(bot, block);
                try {
                    await bot.collectBlock.collect(block);
                } finally {
                    const routeMovements = safeMovements(bot);
                    bot.collectBlock.movements = routeMovements;
                    bot.pathfinder.setMovements(routeMovements);
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
                const afterDropCount = inventoryCountByTypes(bot, expectedDropTypes);
                if (expectedDropTypes.size > 0 && afterDropCount <= beforeDropCount) {
                    setActionEvidence(bot, {
                        kind: 'collect',
                        outcome: 'not_collected',
                        target,
                        beforeCount: beforeDropCount,
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

export function findNearestCollectibleBlock(bot, blockTypes, range=64) {
    const allowed = blockTypes instanceof Set ? blockTypes : new Set(blockTypes);
    const movements = collectionSafetyMovements(bot);
    return world.getNearestBlocksWhere(
        bot,
        (block) => allowed.has(block?.name) && movements.safeToBreak(block),
        Math.max(1, Math.min(512, Number(range) || 64)),
        1,
    ).find(Boolean) || null;
}

export async function collectWood(bot, num=1, range=64) {
    const woodTypes = new Set(WOOD_BLOCK_TYPES);
    const target = Math.max(1, Math.min(64, Number(num) || 1));
    const searchRange = Math.max(1, Math.min(512, Math.floor(Number(range) || 64)));
    let collected = 0;
    let stumpTarget = null;

    while (collected < target && !bot.interrupt_code) {
        const nearest = findNearestCollectibleBlock(bot, woodTypes, searchRange);
        if (!nearest) {
            if (collected === 0) {
                setActionEvidence(bot, {
                    kind: 'collect',
                    outcome: 'not_collected',
                    target: { name: 'wood' },
                    count: 0,
                    retryable: true,
                });
            }
            log(bot, collected
                ? `No more trees nearby after collecting ${collected} logs.`
                : 'No safely collectible trees found within 64 blocks.');
            break;
        }
        const success = await collectBlock(bot, nearest.name, 1);
        if (!success) break;
        const collectedTarget = bot.lastActionEvidence?.target;
        if (
            [collectedTarget?.x, collectedTarget?.y, collectedTarget?.z].every(Number.isFinite)
            && (!stumpTarget || collectedTarget.y < stumpTarget.y)
        ) stumpTarget = collectedTarget;
        collected += 1;
    }

    if (collected > 0) {
        setActionEvidence(bot, {
            kind: 'collect',
            outcome: 'collected',
            target: stumpTarget || { name: 'wood' },
            count: collected,
            retryable: false,
        });
    }
    log(bot, `Wood collection finished with ${collected} logs.`);
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
        const reached = await goToGoal(bot, new pf.goals.GoalFollow(nearestItem, 1));
        if (!reached) {
            const outcome = bot.lastActionEvidence?.outcome || 'unreachable';
            setActionEvidence(bot, { kind: 'pickup', outcome, target, count: pickedUp, retryable: true });
            return false;
        }
        await new Promise(resolve => setTimeout(resolve, 200));
        let prev = nearestItem;
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
        const reached = await goToGoal(bot, new pf.goals.GoalFollow(candidate.entity, 1));
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
        if (block && !empty_blocks.includes(block.name)) {
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

export async function takeFromChest(bot, itemName, num=-1) {
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
    let chest = world.getNearestBlock(bot, 'chest', 32);
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
    // Avoid overlapping the player while remaining close enough for pickup.
    if (bot.entity.position.distanceTo(player.position) < 1.25) {
        let too_close = true;
        let start_moving_away = Date.now();
        if (!await moveAwayFromEntity(bot, player, 1.75)) {
            return false;
        }
        while (too_close && !bot.interrupt_code) {
            await new Promise(resolve => setTimeout(resolve, 200));
            resolution = resolvePhysicalPlayer(bot, username);
            target = playerTargetEvidence(resolution);
            player = resolution.entity;
            if (!player) return false;
            too_close = bot.entity.position.distanceTo(player.position) < 1.25;
            if (too_close) {
                if (!await moveAwayFromEntity(bot, player, 1.75)) {
                    return false;
                }
            }
            if (Date.now() - start_moving_away > 1500) {
                break;
            }
        }
        if (too_close) {
            log(bot, `Failed to give ${itemType} to ${username}: could not make safe drop space.`);
            return false;
        }
    }

    await bot.lookAt(player.position);
    let given = false;
    let droppedEntityId = null;
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
            || currentTarget.entity?.id !== collectorEntityId
            || existingEntityIds.has(collectedEntityId)
            || (droppedEntityId !== null && droppedEntityId !== collectedEntityId)) {
            return;
        }
        markDelivered(collectedEntityId);
    };
    bot.on('entitySpawn', onEntitySpawn);
    bot.on('playerCollect', onPlayerCollect);
    bot._client?.on?.('collect', onCollectPacket);
    try {
        if (!await discard(bot, itemType, transferCount)) {
            return false;
        }
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
                retryable: true,
            });
            return false;
        }
        let start = Date.now();
        while (!given && !bot.interrupt_code) {
            await new Promise(resolve => setTimeout(resolve, 500));
            if (given) {
                return true;
            }
            if (Date.now() - start > 3000) {
                break;
            }
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

export async function goToGoal(bot, goal) {
    /**
     * Navigate to the given goal. Use doors and attempt minimally destructive movements.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {pf.goals.Goal} goal, the goal to navigate to.
     **/

    const movements = safeMovements(bot);
    const doorCheckInterval = startDoorInterval(bot);

    bot.pathfinder.setMovements(movements);
    try {
        await bot.pathfinder.goto(goal);
        if (bot.interrupt_code) {
            setActionEvidence(bot, {
                kind: 'movement',
                outcome: 'interrupted',
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
                retryable: true,
            });
            log(bot, 'Pathfinder stopped without satisfying the requested goal.');
            return false;
        }
        setActionEvidence(bot, { kind: 'movement', outcome: 'arrived' });
        return true;
    } catch (err) {
        const outcome = pathfinderErrorOutcome(err, Boolean(bot.interrupt_code));
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
        clearDoorInterval(bot, doorCheckInterval);
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

    setActionEvidence(bot, {
        kind: 'mining_relocation',
        outcome: candidates.length > 0 ? 'open_cave_unreachable' : 'no_open_cave_route',
        target,
        candidates: Math.min(candidates.length, 6),
        routeDigging: false,
        retryable: true,
    });
    log(bot, `No safe no-dig cave route reaches the productive y=${boundedY} band from here.`);
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
    let doorCheckInterval = startDoorInterval(bot);
    let lastPosition = bot.entity.position.clone();
    let noProgressMs = 0;
    let recoveryAttempts = 0;
    let followedEntityId = player.id;
    let lastSeenPosition = player.position.clone();
    let targetMissingSince = null;
    const canonicalUsername = resolution.canonical || username;

    bot.pathfinder.setGoal(new pf.goals.GoalFollow(player, distance), true);
    setActionEvidence(bot, {
        kind: 'follow',
        outcome: 'pathing',
        target,
        distance,
        retryable: true,
    });
    log(bot, `You are now actively following player ${username}.`);


    while (!bot.interrupt_code) {
        await new Promise(resolve => setTimeout(resolve, FOLLOW_SAMPLE_MS));
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
            bot.pathfinder.setGoal(new pf.goals.GoalFollow(player, distance), true);
            noProgressMs = 0;
            recoveryAttempts = 0;
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
            if (progress < MIN_MOVEMENT_PROGRESS) {
                noProgressMs += FOLLOW_SAMPLE_MS;
            } else {
                noProgressMs = 0;
            }
            if (noProgressMs >= FOLLOW_STUCK_AFTER_MS) {
                recoveryAttempts += 1;
                if (recoveryAttempts > MAX_FOLLOW_RECOVERY_ATTEMPTS) {
                    setActionEvidence(bot, {
                        kind: 'follow',
                        outcome: 'recovering',
                        target,
                        distance: distance_from_player,
                        recoveryAttempts,
                        retryable: true,
                    });
                    log(bot, `Path to ${canonicalUsername} is obstructed; follow remains active and will keep looking for a safe route.`);
                    recoveryAttempts = 1;
                }
                bot.pathfinder.setMovements(safeMovements(bot));
                bot.pathfinder.setGoal(new pf.goals.GoalFollow(player, distance), true);
                setActionEvidence(bot, {
                    kind: 'follow',
                    outcome: 'recovering',
                    target,
                    distance: distance_from_player,
                    recoveryAttempts,
                    retryable: true,
                });
                log(bot, `Following ${username}: retrying safe path (${recoveryAttempts}/${MAX_FOLLOW_RECOVERY_ATTEMPTS}).`);
                noProgressMs = 0;
            }
        } else {
            noProgressMs = 0;
            recoveryAttempts = 0;
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
    bot.pathfinder.stop();
    bot.clearControlStates?.();
    clearDoorInterval(bot, doorCheckInterval);
    return !bot.interrupt_code && Boolean(player);
}


export async function moveAway(bot, distance) {
    /**
     * Move away from current position in any direction.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} distance, the distance to move away.
     * @returns {Promise<boolean>} true if the bot moved away, false otherwise.
     * @example
     * await skills.moveAway(bot, 8);
     **/
    const pos = bot.entity.position.clone();
    const requestedDistance = Math.max(0, Number(distance) || 0);
    const target = { x: pos.x, y: pos.y, z: pos.z };
    let goal = new pf.goals.GoalNear(pos.x, pos.y, pos.z, requestedDistance);
    let inverted_goal = new pf.goals.GoalInvert(goal);
    bot.pathfinder.setMovements(safeMovements(bot));

    if (bot.modes.isOn('cheat')) {
        let path;
        try {
            path = await bot.pathfinder.getPathTo(safeMovements(bot), inverted_goal, 10000);
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
        routed = await goToGoal(bot, inverted_goal);
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
        if (block.name === 'farmland') {
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
        const expectedCrop = {
            wheat_seeds: 'wheat',
            beetroot_seeds: 'beetroots',
            carrot: 'carrots',
            potato: 'potatoes',
        }[seedType] || seedType.replace(/_seeds?$/, '');
        const planted = bot.blockAt(new Vec3(x, y + 1, z));
        if (planted?.name !== expectedCrop) {
            setActionEvidence(bot, {
                kind: 'farm',
                outcome: 'plant_unverified',
                target,
                seed: seedType,
                expected: expectedCrop,
                observed: planted?.name || null,
                retryable: true,
            });
            log(bot, `Minecraft did not confirm ${expectedCrop} above the farmland.`);
            return false;
        }
        log(bot, `Planted ${seedType} at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);
    }
    setActionEvidence(bot, { kind: 'farm', outcome: seedType ? 'planted' : 'tilled', target, seed: seedType || null, retryable: false });
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
        const outputAfter = outputName ? inventoryCount(bot, outputName) : 0;
        const expectedGain = Math.max(1, Number(trade.outputItem?.count) || 1) * actualCount;
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
        try { bot.pathfinder?.stop?.(); } catch { /* best-effort movement preemption */ }
        try { bot.clearControlStates(); } catch { /* best-effort control reset */ }
        bot.setControlState('jump', true);
        const surfaced = await waitForWorldCondition(bot, () => {
            const head = bot.blockAt(bot.entity.position.offset(0, 1, 0));
            return head && head.name !== 'water' && !bot.entity?.isInLava;
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
        await new Promise(resolve => setTimeout(resolve, Math.min(INTERACTION_CONFIRM_POLL_MS, remaining)));
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
