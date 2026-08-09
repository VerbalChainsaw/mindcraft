import { Bot } from 'mineflayer';
import { Block } from 'prismarine-block';
import { goals, Movements } from 'mineflayer-pathfinder';
import { Entity } from 'prismarine-entity';
import { Vec3 } from 'vec3';
import { ItemFilter } from './Inventory';
import { Collectable } from './Targets';
export type Callback = (err?: Error) => void;
export type CollectionToolPolicy = 'preserve_durability' | 'fastest';
export interface CollectionToolSelection {
    kind: 'empty_hand' | 'item';
    item: unknown | null;
    digTime: number;
}
export declare function selectCollectionTool(bot: Bot, block: Block, policy?: CollectionToolPolicy): CollectionToolSelection | null;
export declare function createDroppedItemPickupGoal(entity: Entity): goals.GoalFollow;
export declare function isDropFromMinedBlock(block: Block, entity: Entity): boolean;
/**
 * A set of options to apply when collecting the given targets.
 */
export interface CollectOptions {
    /**
     * If true, the target(s) will be appended to the existing target list instead of
     * starting a new task. Defaults to false.
     */
    append?: boolean;
    /**
     * If true, errors will not be thrown when a path to the target block cannot
     * be found. The bot will attempt to choose the best available position it
     * can find, instead. Errors are still thrown if the bot cannot interact with
     * the block from it's final location. Defaults to false.
     */
    ignoreNoPath?: boolean;
    /**
     * Maximum milliseconds one block or dropped-item navigation may own before
     * it is cancelled and, when ignoreNoPath is true, skipped. Zero disables
     * the target-level deadline. Defaults to zero.
     */
    targetTimeoutMs?: number;
    /**
     * Maximum milliseconds target navigation may make no verified physical
     * position progress before it is cancelled and, when ignoreNoPath is true,
     * skipped. Zero disables the stall deadline. Defaults to zero.
     */
    targetStallTimeoutMs?: number;
    /**
     * Maximum additional A* route cost allowed beyond the target heuristic.
     * Keeps one impossible local target from searching the loaded world.
     * Defaults to 16.
     */
    targetSearchRadius?: number;
    /**
     * Selects the fastest tool by default, but avoids durability wear when an
     * empty hand or non-wearing item has identical break speed. Set to
     * `fastest` to retain mineflayer-tool's original tie behavior.
     */
    toolPolicy?: CollectionToolPolicy;
    /**
     * Called between physical targets. When it returns true, remaining queued
     * targets are released and collection completes successfully. This lets a
     * caller provide fallback candidates without over-collecting its requested
     * physical outcome.
     */
    isSatisfied?: () => boolean;
    /**
     * Maximum skippable target failures allowed inside one native queue before
     * it returns control to the caller for a meaningful source or region
     * change. Defaults to unlimited.
     */
    maxTargetFailures?: number;
    /**
     * Gets the list of chest locations to use when storing items after the bot's
     * inventory becomes full. If undefined, it defaults to the chest location
     * list on the bot.collectBlock plugin.
     */
    chestLocations?: Vec3[];
    /**
     * When transferring items to a chest, this filter is used to determine what
     * items are allowed to be moved, and what items aren't allowed to be moved.
     * Defaults to the item filter specified on the bot.collectBlock plugin.
     */
    itemFilter?: ItemFilter;
}
/**
 * The collect block plugin.
 */
export declare class CollectBlock {
    /**
       * The bot.
       */
    private readonly bot;
    /**
     * The list of active targets being collected.
     */
    private readonly targets;
    /** The exact async collection lease, which may outlive an empty target queue. */
    private activeTask;
    /** Monotonic identity used to correlate cancellation with its owning lease. */
    private nextTaskGeneration;
    /**
       * The movements configuration to be sent to the pathfinder plugin.
       */
    movements?: Movements;
    /**
     * Default maximum milliseconds one target navigation may own. Individual
     * collect calls can override this with targetTimeoutMs.
     */
    targetTimeoutMs: number;
    /**
     * Default maximum milliseconds one target navigation may make no physical
     * position progress. Individual calls can override targetStallTimeoutMs.
     */
    targetStallTimeoutMs: number;
    /**
       * A list of chest locations which the bot is allowed to empty their inventory into
       * if it becomes full while the bot is collecting resources.
       */
    chestLocations: Vec3[];
    /**
       * When collecting items, this filter is used to determine what items should be placed
       * into a chest if the bot's inventory becomes full. By default, returns true for all
       * items except for tools, weapons, and armor.
       *
       * @param item - The item stack in the bot's inventory to check.
       *
       * @returns True if the item should be moved into the chest. False otherwise.
       */
    itemFilter: ItemFilter;
    /**
       * Creates a new instance of the create block plugin.
       *
       * @param bot - The bot this plugin is acting on.
       */
    constructor(bot: Bot);
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
    collect(target: Collectable | Collectable[], options?: CollectOptions | Callback, cb?: Callback): Promise<void>;
    /**
     * Loads all touching blocks of the same type to the given block and returns them as an array.
     * This effectively acts as a flood fill algorithm to retrieve blocks in the same ore vein and similar.
     *
     * @param block - The starting block.
     * @param maxBlocks - The maximum number of blocks to look for before stopping.
     * @param maxDistance - The max distance from the starting block to look.
     * @param floodRadius - The max distance distance from block A to block B to be considered "touching"
     */
    findFromVein(block: Block, maxBlocks?: number, maxDistance?: number, floodRadius?: number): Block[];
    /**
     * Cancels the current collection task, if still active.
     *
     * @param cb - The callback to use when the task is stopped.
     */
    cancelTask(cb?: Callback): Promise<void>;
}
