import { Vec3 } from 'vec3';
import * as skills from '../library/skills.js';
import * as world from '../library/world.js';
import * as mc from '../../utils/mcdata.js';
import { blockSatisfied, getTypeOfGeneric, rotateXZ } from './utils.js';
import {
    isLiquidGameplayBlock,
    isProtectedGameplayBlock,
    isReplaceableGameplayBlock,
} from '../runtime/gameplay-safety.js';


export class BuildGoal {
    constructor(agent) {
        this.agent = agent;
    }

    async wrapSkill(func) {
        if (!this.agent.isIdle())
            return false;
        let res = await this.agent.actions.runAction('BuildGoal', func, { owner: 'job' });
        return res.success === true;
    }

    async executeNext(goal, position=null, orientation=null) {
        let sizex = goal.blocks[0][0].length;
        let sizez = goal.blocks[0].length;
        let sizey = goal.blocks.length;
        if (!position) {
            position = world.getNearestFreeSpace(this.agent.bot, Math.max(sizex, sizez), 16);
        }
        if (!position) {
            return {
                missing: {},
                blocked: [{ outcome: 'no_safe_build_site' }],
                acted: false,
                complete: false,
                position: null,
                orientation,
            };
        }
        if (orientation === null) {
            orientation = Math.floor(Math.random() * 4);
        }

        let inventory = world.getInventoryCounts(this.agent.bot);
        let missing = {};
        let blocked = [];
        let acted = false;
        for (let y = goal.offset; y < sizey+goal.offset; y++) {
            for (let z = 0; z < sizez; z++) {
                for (let x = 0; x < sizex; x++) {

                    let [rx, rz] = rotateXZ(x, z, orientation, sizex, sizez);
                    let ry = y - goal.offset;
                    let block_name = goal.blocks[ry][rz][rx];
                    if (block_name === null || block_name === '') continue;

                    let world_pos = new Vec3(position.x + x, position.y + y, position.z + z);
                    let current_block = this.agent.bot.blockAt(world_pos);

                    let res = null;
                    if (current_block === null) {
                        blocked.push({ position: world_pos, outcome: 'target_unloaded' });
                        acted = true;
                        continue;
                    }
                    if (!blockSatisfied(block_name, current_block)) {
                        acted = true;

                        if (current_block.name !== 'air') {
                            if (
                                isProtectedGameplayBlock(current_block)
                                || isLiquidGameplayBlock(current_block)
                                || !isReplaceableGameplayBlock(current_block)
                            ) {
                                blocked.push({
                                    position: world_pos,
                                    outcome: isProtectedGameplayBlock(current_block)
                                        ? 'protected_block'
                                        : isLiquidGameplayBlock(current_block)
                                            ? 'liquid'
                                            : 'occupied',
                                    observed: current_block.name,
                                    expected: block_name,
                                });
                                continue;
                            }
                            res = await this.wrapSkill(async () => {
                                return await skills.breakBlockAt(this.agent.bot, world_pos.x, world_pos.y, world_pos.z);
                            });
                            if (!res) {
                                blocked.push({ position: world_pos, outcome: 'clear_failed', observed: current_block.name });
                                continue;
                            }
                        }

                        if (block_name !== 'air') {
                            let block_typed = getTypeOfGeneric(this.agent.bot, block_name);
                            if (inventory[block_typed] > 0) {
                                res = await this.wrapSkill(async () => {
                                    return await skills.placeBlock(
                                        this.agent.bot,
                                        block_typed,
                                        world_pos.x,
                                        world_pos.y,
                                        world_pos.z,
                                        'bottom',
                                        false,
                                        false,
                                    );
                                });
                                if (!res) {
                                    blocked.push({ position: world_pos, outcome: 'place_failed', expected: block_typed });
                                    continue;
                                }
                            } else {
                                if (missing[block_typed] === undefined)
                                    missing[block_typed] = 0;
                                missing[block_typed]++;
                            }
                        }
                    }
                }
            }
        }
        return {
            missing,
            blocked,
            acted,
            complete: Object.keys(missing).length === 0 && blocked.length === 0,
            position,
            orientation,
        };
    }

}
