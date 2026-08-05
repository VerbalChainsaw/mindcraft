"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CollectBlock = exports.selectCollectionTool = void 0;
const mineflayer_pathfinder_1 = require("../../mineflayer-pathfinder");
const TemporarySubscriber_1 = require("./TemporarySubscriber");
const Util_1 = require("./Util");
const Inventory_1 = require("./Inventory");
const BlockVeins_1 = require("./BlockVeins");
const Targets_1 = require("./Targets");
const events_1 = require("events");
const util_1 = require("util");
const DEFAULT_TARGET_TIMEOUT_MS = 12000;
const DEFAULT_TARGET_STALL_TIMEOUT_MS = 3000;
const SKIPPABLE_TARGET_ERRORS = new Set(['NoPath', 'Timeout', 'TargetStalled', 'TargetTimeout']);
function boundedTargetTimeout(value) {
    const timeout = Number(value);
    if (!Number.isFinite(timeout) || timeout <= 0)
        return 0;
    return Math.max(100, Math.min(60000, Math.floor(timeout)));
}
function boundedTargetFailures(value) {
    if (value === Infinity)
        return Infinity;
    const failures = Number(value);
    if (!Number.isFinite(failures))
        return Infinity;
    return Math.max(1, Math.min(64, Math.floor(failures)));
}
function gotoWithTargetLimits(bot, goal, targetTimeoutMs, targetStallTimeoutMs) {
    return __awaiter(this, void 0, void 0, function* () {
        const timeoutMs = boundedTargetTimeout(targetTimeoutMs);
        const stallTimeoutMs = boundedTargetTimeout(targetStallTimeoutMs);
        if (timeoutMs <= 0 && stallTimeoutMs <= 0)
            return yield bot.pathfinder.goto(goal);
        let timeout;
        let stallInterval;
        const navigation = Promise.resolve().then(() => bot.pathfinder.goto(goal));
        const limits = [];
        if (timeoutMs > 0) {
            limits.push(new Promise((resolve, reject) => {
                timeout = setTimeout(() => reject((0, Util_1.error)('TargetTimeout', `Target navigation exceeded ${timeoutMs}ms.`)), timeoutMs);
            }));
        }
        if (stallTimeoutMs > 0) {
            limits.push(new Promise((resolve, reject) => {
                let checkpoint = bot.entity.position.clone();
                let lastProgressAt = Date.now();
                stallInterval = setInterval(() => {
                    const current = bot.entity === null || bot.entity === void 0 ? void 0 : bot.entity.position;
                    if (current && current.distanceTo(checkpoint) >= 0.35) {
                        checkpoint = current.clone();
                        lastProgressAt = Date.now();
                    }
                    if (Date.now() - lastProgressAt >= stallTimeoutMs) {
                        reject((0, Util_1.error)('TargetStalled', `Target navigation made no physical progress for ${stallTimeoutMs}ms.`));
                    }
                }, 100);
            }));
        }
        try {
            return yield Promise.race([navigation, ...limits]);
        }
        catch (err) {
            if (['TargetStalled', 'TargetTimeout'].includes(err === null || err === void 0 ? void 0 : err.name)) {
                bot.pathfinder.setGoal(null);
                try {
                    yield navigation;
                }
                catch (_a) {
                    // GoalChanged/PathStopped confirms the timed-out route settled.
                }
            }
            throw err;
        }
        finally {
            clearTimeout(timeout);
            clearInterval(stallInterval);
        }
    });
}
function collectAll(bot, options) {
    return __awaiter(this, void 0, void 0, function* () {
        let targetFailures = 0;
        while (!options.targets.empty) {
            if (options.isSatisfied()) {
                options.targets.clear();
                break;
            }
            const closest = options.targets.getClosest();
            if (closest == null)
                break;
            if (!(0, Inventory_1.hasInventoryRoomForTarget)(bot, closest)) {
                yield (0, Inventory_1.emptyInventory)(bot, options.chestLocations, options.itemFilter);
            }
            try {
                switch (closest.constructor.name) {
                    case 'Block': {
                        const goal = new mineflayer_pathfinder_1.goals.GoalLookAtBlock(closest.position, bot.world);
                        yield gotoWithTargetLimits(bot, goal, options.targetTimeoutMs, options.targetStallTimeoutMs);
                        yield mineBlock(bot, closest, options);
                        break;
                    }
                    case 'Entity': {
                        // Don't collect any entities that are marked as 'invalid'
                        if (!closest.isValid)
                            break;
                        const tempEvents = new TemporarySubscriber_1.TemporarySubscriber(bot);
                        let finishPickupWait;
                        let pickupObserved = false;
                        const waitForPickup = new Promise(resolve => {
                            finishPickupWait = resolve;
                            tempEvents.subscribeTo('entityGone', (entity) => {
                                if (entity === closest) {
                                    pickupObserved = true;
                                    resolve();
                                }
                            });
                        });
                        const cancelPickupWait = () => finishPickupWait();
                        bot.once('collectBlock_cancelled', cancelPickupWait);
                        let pickupTimeout;
                        try {
                            const navigation = gotoWithTargetLimits(bot, new mineflayer_pathfinder_1.goals.GoalFollow(closest, 0), options.targetTimeoutMs, options.targetStallTimeoutMs);
                            const first = yield Promise.race([
                                navigation.then(() => 'arrived'),
                                waitForPickup.then(() => 'picked-up')
                            ]);
                            if (first === 'picked-up') {
                                // GoalFollow can remain pending after the item has already
                                // entered inventory. Stop and settle that obsolete route;
                                // successful pickup, not a later path timeout, owns the result.
                                bot.pathfinder.setGoal(null);
                                try {
                                    yield navigation;
                                }
                                catch (_a) {
                                    // GoalChanged/PathStopped confirms settlement.
                                }
                            }
                            else {
                                pickupTimeout = setTimeout(finishPickupWait, 3000);
                                yield waitForPickup;
                            }
                        }
                        catch (err) {
                            // Mineflayer may remove the entity during the same tick that
                            // Pathfinder rejects its now-obsolete GoalFollow. The physical
                            // pickup is authoritative and must not be reported as a failure.
                            if (!pickupObserved && closest.isValid)
                                throw err;
                        }
                        finally {
                            clearTimeout(pickupTimeout);
                            tempEvents.cleanup();
                            bot.removeListener('collectBlock_cancelled', cancelPickupWait);
                        }
                        break;
                    }
                    default: {
                        throw (0, Util_1.error)('UnknownType', `Target ${closest.constructor.name} is not a Block or Entity!`);
                    }
                }
            }
            catch (err) {
                options.targets.removeTarget(closest);
                bot.emit('collectBlock_targetFailed', closest, err);
                if (options.ignoreNoPath && SKIPPABLE_TARGET_ERRORS.has(err === null || err === void 0 ? void 0 : err.name)) {
                    targetFailures += 1;
                    if (targetFailures >= options.maxTargetFailures) {
                        options.targets.clear();
                        break;
                    }
                    continue;
                }
                throw err;
            }
            options.targets.removeTarget(closest);
        }
    });
}
const equipToolOptions = {
    requireHarvest: true,
    getFromChest: true,
    maxTools: 2
};
function itemWearsWithUse(bot, item) {
    if (item == null)
        return false;
    const direct = Number(item.maxDurability);
    const registered = Number(bot.registry?.items?.[item.type]?.maxDurability);
    return (Number.isFinite(direct) && direct > 0)
        || (Number.isFinite(registered) && registered > 0);
}
function selectCollectionTool(bot, block, policy = 'preserve_durability') {
    if (policy === 'fastest')
        return null;
    let handHarvestable = false;
    try {
        handHarvestable = block.canHarvest(null) === true;
    }
    catch (_a) {
        return null;
    }
    if (!handHarvestable || typeof bot?.tool?.getDigTime !== 'function')
        return null;
    const digTime = (item) => {
        try {
            const time = Number(bot.tool.getDigTime(block, item));
            return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
        }
        catch (_a) {
            return Number.POSITIVE_INFINITY;
        }
    };
    const bareHandTime = digTime(undefined);
    const items = bot.inventory.items();
    const fastestCarriedTime = items.reduce((fastest, item) => Math.min(fastest, digTime(item)), Number.POSITIVE_INFINITY);
    if (!Number.isFinite(bareHandTime) || fastestCarriedTime < bareHandTime)
        return null;
    if (bot.inventory.emptySlotCount() > 0)
        return { kind: 'empty_hand', item: null, digTime: bareHandTime };
    const item = items
        .filter(candidate => !itemWearsWithUse(bot, candidate))
        .sort((left, right) => digTime(left) - digTime(right) || left.slot - right.slot)[0] || null;
    return item && digTime(item) <= bareHandTime
        ? { kind: 'item', item, digTime: digTime(item) }
        : null;
}
exports.selectCollectionTool = selectCollectionTool;
function equipCollectionTool(bot, block, policy) {
    return __awaiter(this, void 0, void 0, function* () {
        const selected = selectCollectionTool(bot, block, policy);
        if (selected?.kind === 'empty_hand') {
            yield bot.unequip('hand');
            return;
        }
        if (selected?.item) {
            yield bot.equip(selected.item, 'hand');
            return;
        }
        yield bot.tool.equipForBlock(block, equipToolOptions);
    });
}
function mineBlock(bot, block, options) {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function* () {
        // @ts-expect-error
        if (((_a = bot.blockAt(block.position)) === null || _a === void 0 ? void 0 : _a.type) !== block.type || ((_b = bot.blockAt(block.position)) === null || _b === void 0 ? void 0 : _b.type) === 0 || !bot.pathfinder.movements.safeToBreak(block)) {
            options.targets.removeTarget(block);
            return;
        }
        yield equipCollectionTool(bot, block, options.toolPolicy);
        if (bot.heldItem !== null && !block.canHarvest(bot.heldItem.type)) {
            options.targets.removeTarget(block);
            return;
        }
        const tempEvents = new TemporarySubscriber_1.TemporarySubscriber(bot);
        tempEvents.subscribeTo('itemDrop', (entity) => {
            if (entity.position.distanceTo(block.position.offset(0.5, 0.5, 0.5)) <= 0.5) {
                options.targets.appendTarget(entity);
            }
        });
        try {
            yield bot.dig(block);
            // Waiting for items to drop
            yield new Promise(resolve => {
                let remainingTicks = 10;
                tempEvents.subscribeTo('physicsTick', () => {
                    remainingTicks--;
                    if (remainingTicks <= 0) {
                        tempEvents.cleanup();
                        resolve();
                    }
                });
            });
        }
        finally {
            tempEvents.cleanup();
        }
    });
}
/**
 * The collect block plugin.
 */
class CollectBlock {
    /**
       * Creates a new instance of the create block plugin.
       *
       * @param bot - The bot this plugin is acting on.
       */
    constructor(bot) {
        /**
           * A list of chest locations which the bot is allowed to empty their inventory into
           * if it becomes full while the bot is collecting resources.
           */
        this.chestLocations = [];
        /**
           * When collecting items, this filter is used to determine what items should be placed
           * into a chest if the bot's inventory becomes full. By default, returns true for all
           * items except for tools, weapons, and armor.
           *
           * @param item - The item stack in the bot's inventory to check.
           *
           * @returns True if the item should be moved into the chest. False otherwise.
           */
        this.itemFilter = (item) => {
            if (item.name.includes('helmet'))
                return false;
            if (item.name.includes('chestplate'))
                return false;
            if (item.name.includes('leggings'))
                return false;
            if (item.name.includes('boots'))
                return false;
            if (item.name.includes('shield'))
                return false;
            if (item.name.includes('sword'))
                return false;
            if (item.name.includes('pickaxe'))
                return false;
            if (item.name.includes('axe'))
                return false;
            if (item.name.includes('shovel'))
                return false;
            if (item.name.includes('hoe'))
                return false;
            return true;
        };
        this.bot = bot;
        this.targets = new Targets_1.Targets(bot);
        this.movements = new mineflayer_pathfinder_1.Movements(bot);
        /** Default total navigation ownership allowed for one target. */
        this.targetTimeoutMs = DEFAULT_TARGET_TIMEOUT_MS;
        /** Default time one target may show no verified position progress. */
        this.targetStallTimeoutMs = DEFAULT_TARGET_STALL_TIMEOUT_MS;
    }
    /**
       * If target is a block:
       * Causes the bot to break and collect the target block.
       *
       * If target is an item drop:
       * Causes the bot to collect the item drop.
       *
       * If target is an array containing items or blocks, preforms the correct action for
       * all targets in that array sorting dynamically by distance.
       *
       * @param target - The block(s) or item(s) to collect.
       * @param options - The set of options to use when handling these targets
       * @param cb - The callback that is called finished.
       */
    collect(target, options = {}, cb) {
        var _a, _b, _c, _d, _e;
        return __awaiter(this, void 0, void 0, function* () {
            if (typeof options === 'function') {
                cb = options;
                options = {};
            }
            // @ts-expect-error
            if (cb != null)
                return (0, util_1.callbackify)(this.collect)(target, options, cb);
            const optionsFull = {
                append: (_a = options.append) !== null && _a !== void 0 ? _a : false,
                ignoreNoPath: (_b = options.ignoreNoPath) !== null && _b !== void 0 ? _b : false,
                chestLocations: (_c = options.chestLocations) !== null && _c !== void 0 ? _c : this.chestLocations,
                itemFilter: (_d = options.itemFilter) !== null && _d !== void 0 ? _d : this.itemFilter,
                isSatisfied: (_e = options.isSatisfied) !== null && _e !== void 0 ? _e : (() => false),
                maxTargetFailures: boundedTargetFailures(options.maxTargetFailures),
                targetTimeoutMs: boundedTargetTimeout(options.targetTimeoutMs === undefined
                    ? this.targetTimeoutMs
                    : options.targetTimeoutMs),
                targetStallTimeoutMs: boundedTargetTimeout(options.targetStallTimeoutMs === undefined
                    ? this.targetStallTimeoutMs
                    : options.targetStallTimeoutMs),
                toolPolicy: options.toolPolicy === 'fastest' ? 'fastest' : 'preserve_durability',
                targets: this.targets
            };
            if (this.bot.pathfinder == null) {
                throw (0, Util_1.error)('UnresolvedDependency', 'The mineflayer-collectblock plugin relies on the mineflayer-pathfinder plugin to run!');
            }
            if (this.bot.tool == null) {
                throw (0, Util_1.error)('UnresolvedDependency', 'The mineflayer-collectblock plugin relies on the mineflayer-tool plugin to run!');
            }
            if (this.movements != null) {
                this.movements.dontMineUnderFallingBlock = false;
                this.movements.dontCreateFlow = false;
                this.bot.pathfinder.setMovements(this.movements);
            }
            if (!optionsFull.append)
                yield this.cancelTask();
            if (Array.isArray(target)) {
                this.targets.appendTargets(target);
            }
            else {
                this.targets.appendTarget(target);
            }
            try {
                yield collectAll(this.bot, optionsFull);
            }
            catch (err) {
                this.targets.clear();
                // Ignore path stopped error for cancelTask to work properly (imo we shouldn't throw any pathing errors)
                // @ts-expect-error
                if (err.name !== 'PathStopped')
                    throw err;
            }
            finally {
                // @ts-expect-error
                this.bot.emit('collectBlock_finished');
            }
        });
    }
    /**
     * Loads all touching blocks of the same type to the given block and returns them as an array.
     * This effectively acts as a flood fill algorithm to retrieve blocks in the same ore vein and similar.
     *
     * @param block - The starting block.
     * @param maxBlocks - The maximum number of blocks to look for before stopping.
     * @param maxDistance - The max distance from the starting block to look.
     * @param floodRadius - The max distance distance from block A to block B to be considered "touching"
     */
    findFromVein(block, maxBlocks = 100, maxDistance = 16, floodRadius = 1) {
        return (0, BlockVeins_1.findFromVein)(this.bot, block, maxBlocks, maxDistance, floodRadius);
    }
    /**
     * Cancels the current collection task, if still active.
     *
     * @param cb - The callback to use when the task is stopped.
     */
    cancelTask(cb) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.targets.empty) {
                if (cb != null)
                    cb();
                return yield Promise.resolve();
            }
            const finished = (0, events_1.once)(this.bot, 'collectBlock_finished');
            this.targets.clear();
            this.bot.emit('collectBlock_cancelled');
            this.bot.pathfinder.setGoal(null);
            this.bot.stopDigging();
            yield finished;
            if (cb != null)
                cb();
        });
    }
}
exports.CollectBlock = CollectBlock;
