"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Targets = void 0;
class Targets {
    constructor(bot) {
        this.targets = [];
        this.bot = bot;
    }
    appendTargets(targets) {
        for (const target of targets) {
            this.appendTarget(target);
        }
    }
    appendTarget(target) {
        if (this.targets.includes(target))
            return;
        this.targets.push(target);
    }
    /**
     * Gets the closest target to the bot in this list.
     *
     * @returns The closest target, or null if there are no targets.
     */
    getClosest() {
        let closest = null;
        let distance = 0;
        for (const target of this.targets) {
            const dist = target.position.distanceTo(this.bot.entity.position);
            if (closest == null || dist < distance) {
                closest = target;
                distance = dist;
            }
        }
        return closest;
    }
    /**
     * Gets the closest pending dropped-item entity, if one exists.
     *
     * A block is not fully collected when it breaks; its physical drop still
     * has to reach inventory. Finish that transaction before starting another
     * block route so a later path failure cannot erase verified block progress.
     */
    getClosestDrop() {
        let closest = null;
        let distance = 0;
        for (const target of this.targets) {
            if (target?.constructor?.name !== 'Entity')
                continue;
            const dist = target.position.distanceTo(this.bot.entity.position);
            if (closest == null || dist < distance) {
                closest = target;
                distance = dist;
            }
        }
        return closest;
    }
    /**
     * Gets the closest pending block while deliberately ignoring item drops.
     * A caller may use this for one bound vertical component where abandoning
     * a temporary climbing stance after every break makes the remaining
     * blocks physically unreachable. Drops remain queued and are still
     * collected before the task settles.
     */
    getClosestBlock() {
        let closest = null;
        let distance = 0;
        for (const target of this.targets) {
            if (target?.constructor?.name !== 'Block')
                continue;
            const dist = target.position.distanceTo(this.bot.entity.position);
            if (closest == null || dist < distance) {
                closest = target;
                distance = dist;
            }
        }
        return closest;
    }
    get empty() {
        return this.targets.length === 0;
    }
    clear() {
        this.targets.length = 0;
    }
    /**
     * Stop attempting pending block targets while preserving mined item drops.
     * A later block can exhaust its route-failure budget after earlier blocks
     * already produced physical drops. Clearing the whole queue at that edge
     * loses the unfinished pickup half of those successful block transactions.
     */
    removeBlocks() {
        this.targets = this.targets.filter(target => target?.constructor?.name !== 'Block');
    }
    removeTarget(target) {
        const index = this.targets.indexOf(target);
        if (index < 0)
            return;
        this.targets.splice(index, 1);
    }
}
exports.Targets = Targets;
