import { Bot } from 'mineflayer';
import { Block } from 'prismarine-block';
import { Entity } from 'prismarine-entity';
export type Collectable = Block | Entity;
export declare class Targets {
    private readonly bot;
    private targets;
    constructor(bot: Bot);
    appendTargets(targets: Collectable[]): void;
    appendTarget(target: Collectable): void;
    /**
     * Gets the closest target to the bot in this list.
     *
     * @returns The closest target, or null if there are no targets.
     */
    getClosest(): Collectable | null;
    /** Gets the closest pending dropped-item entity, if one exists. */
    getClosestDrop(): Entity | null;
    /** Gets the closest pending block while leaving item drops queued. */
    getClosestBlock(): Block | null;
    get empty(): boolean;
    clear(): void;
    /** Stop attempting blocks while preserving already-mined item drops. */
    removeBlocks(): void;
    removeTarget(target: Collectable): void;
}
