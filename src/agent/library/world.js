import pf from '../../../packages/minecraft-runtime/mineflayer-pathfinder/index.js';
import * as mc from '../../utils/mcdata.js';
import {
    isAnchoredGameplaySupport,
    isProtectedGameplayBlock,
} from '../runtime/gameplay-safety.js';


function cellKey(position) {
    return `${position.x}:${position.y}:${position.z}`;
}

function entityOccupiesCell(bot, cell) {
    return Object.values(bot.entities || {}).some(entity => {
        if (!entity?.position || entity.id === bot.entity?.id) return false;
        const feet = entity.position.floored();
        return cell.equals(feet) || cell.equals(feet.offset(0, 1, 0));
    });
}

export function getNearestFreeSpaces(
    bot,
    size = 1,
    distance = 8,
    { limit = 8, exclude = [] } = {},
) {
    const excluded = new Set((exclude || []).map(position => cellKey(position)));
    const emptyPositions = (bot.findBlocks({
        matching: block => block?.name === 'air',
        maxDistance: distance,
        count: 1000,
    }) || []).sort((left, right) => (
        bot.entity.position.distanceTo(left) - bot.entity.position.distanceTo(right)
        || left.y - right.y
        || left.x - right.x
        || left.z - right.z
    ));
    const occupiedFeet = bot.entity.position.floored();
    const occupiedHead = occupiedFeet.offset(0, 1, 0);
    const results = [];
    for (const position of emptyPositions) {
        if (excluded.has(cellKey(position))) continue;
        let empty = true;
        for (let x = 0; x < size; x++) {
            for (let z = 0; z < size; z++) {
                const cell = position.offset(x, 0, z);
                const top = bot.blockAt(cell);
                const bottom = bot.blockAt(cell.offset(0, -1, 0));
                const occupiedByBot = cell.equals(occupiedFeet) || cell.equals(occupiedHead);
                if (
                    !top
                    || top.name !== 'air'
                    || occupiedByBot
                    || entityOccupiesCell(bot, cell)
                    || !bottom
                    || isProtectedGameplayBlock(bottom)
                    || !isAnchoredGameplaySupport(bot, bottom)
                ) {
                    empty = false;
                    break;
                }
            }
            if (!empty) break;
        }
        if (!empty) continue;
        results.push(position);
        if (results.length >= Math.max(1, Math.floor(Number(limit) || 1))) break;
    }
    return results;
}

export function getNearestFreeSpace(bot, size=1, distance=8) {
    /**
     * Get the nearest empty space with solid blocks beneath it of the given size.
     * @param {Bot} bot - The bot to get the nearest free space for.
     * @param {number} size - The (size x size) of the space to find, default 1.
     * @param {number} distance - The maximum distance to search, default 8.
     * @returns {Vec3} - The south west corner position of the nearest free space.
     * @example
     * let position = world.getNearestFreeSpace(bot, 1, 8);
     **/
    return getNearestFreeSpaces(bot, size, distance, { limit: 1 })[0];
}


export function getBlockAtPosition(bot, x=0, y=0, z=0) {
     /**
     * Get a block from the bot's relative position 
     * @param {Bot} bot - The bot to get the block for.
     * @param {number} x - The relative x offset to serach, default 0.
     * @param {number} y - The relative y offset to serach, default 0.
     * @param {number} y - The relative z offset to serach, default 0. 
     * @returns {Block} - The nearest block.
     * @example
     * let blockBelow = world.getBlockAtPosition(bot, 0, -1, 0);
     * let blockAbove = world.getBlockAtPosition(bot, 0, 2, 0); since minecraft position is at the feet
     **/
    let block = bot.blockAt(bot.entity.position.offset(x, y, z));
    if (!block) block = {name: 'air'};
       
    return block;
}


export function getSurroundingBlocks(bot) {
    /**
     * Get the surrounding blocks from the bot's environment.
     * @param {Bot} bot - The bot to get the block for.
     * @returns {string[]} - A list of block results as strings.
     * @example
     **/
    // Create a list of block position results that can be unpacked.
    let res = [];
    res.push(`Block Below: ${getBlockAtPosition(bot, 0, -1, 0).name}`);
    res.push(`Block at Legs: ${getBlockAtPosition(bot, 0, 0, 0).name}`);
    res.push(`Block at Head: ${getBlockAtPosition(bot, 0, 1, 0).name}`);

    return res;
}


export function getFirstBlockAboveHead(bot, ignore_types=null, distance=32) {
     /**
     * Searches a column from the bot's position for the first solid block above its head
     * @param {Bot} bot - The bot to get the block for.
     * @param {string[]} ignore_types - The names of the blocks to ignore.
     * @param {number} distance - The maximum distance to search, default 32.
     * @returns {string} - The fist block above head.
     * @example
     * let firstBlockAboveHead = world.getFirstBlockAboveHead(bot, null, 32);
     **/
    // if ignore_types is not a list, make it a list.
    let ignore_blocks = []; 
    if (ignore_types === null) ignore_blocks = ['air', 'cave_air'];
    else {
        if (!Array.isArray(ignore_types))
            ignore_types = [ignore_types];
        for(let ignore_type of ignore_types) {
            if (mc.getBlockId(ignore_type)) ignore_blocks.push(ignore_type);
        }
    }
    // The block above, stops when it finds a solid block .
    let block_above = {name: 'air'};
    let height = 0
    for (let i = 0; i < distance; i++) {
        let block = bot.blockAt(bot.entity.position.offset(0, i+2, 0));
        if (!block) block = {name: 'air'};
        // Ignore and continue
        if (ignore_blocks.includes(block.name)) continue;
        // Defaults to any block
        block_above = block;
        height = i;
        break;
    }

    if (ignore_blocks.includes(block_above.name)) return 'none';
    
    return `${block_above.name} (${height} blocks up)`;
}


export function getNearestBlocks(bot, block_types=null, distance=8, count=10000) {
    /**
     * Get a list of the nearest blocks of the given types.
     * @param {Bot} bot - The bot to get the nearest block for.
     * @param {string[]} block_types - The names of the blocks to search for.
     * @param {number} distance - The maximum distance to search, default 16.
     * @param {number} count - The maximum number of blocks to find, default 10000.
     * @returns {Block[]} - The nearest blocks of the given type.
     * @example
     * let woodBlocks = world.getNearestBlocks(bot, ['oak_log', 'birch_log'], 16, 1);
     **/
    // if blocktypes is not a list, make it a list
    let block_ids = [];
    if (block_types === null) {
        block_ids = mc.getAllBlockIds(['air']);
    }
    else {
        if (!Array.isArray(block_types))
            block_types = [block_types];
        for(let block_type of block_types) {
            block_ids.push(mc.getBlockId(block_type));
        }
    }
    return getNearestBlocksWhere(bot, block_ids, distance, count);  
}

export function getNearestBlocksWhere(bot, predicate, distance=8, count=10000) {
    /**
     * Get a list of the nearest blocks that satisfy the given predicate.
     * @param {Bot} bot - The bot to get the nearest blocks for.
     * @param {function} predicate - The predicate to filter the blocks.
     * @param {number} distance - The maximum distance to search, default 16.
     * @param {number} count - The maximum number of blocks to find, default 10000.
     * @returns {Block[]} - The nearest blocks that satisfy the given predicate.
     * @example
     * let waterBlocks = world.getNearestBlocksWhere(bot, block => block.name === 'water', 16, 10);
     **/
    let positions = bot.findBlocks({matching: predicate, maxDistance: distance, count: count});
    let blocks = positions.map(position => bot.blockAt(position));
    return blocks;
}


export function getNearestBlock(bot, block_type, distance=16) {
     /**
     * Get the nearest block of the given type.
     * @param {Bot} bot - The bot to get the nearest block for.
     * @param {string} block_type - The name of the block to search for.
     * @param {number} distance - The maximum distance to search, default 16.
     * @returns {Block} - The nearest block of the given type.
     * @example
     * let coalBlock = world.getNearestBlock(bot, 'coal_ore', 16);
     **/
    let blocks = getNearestBlocks(bot, block_type, distance, 1);
    if (blocks.length > 0) {
        return blocks[0];
    }
    return null;
}


export function getNearbyEntities(bot, maxDistance=16) {
    let entities = [];
    for (const entity of Object.values(bot.entities)) {
        const distance = entity.position.distanceTo(bot.entity.position);
        if (distance > maxDistance) continue;
        entities.push({ entity: entity, distance: distance });
    }
    entities.sort((a, b) => a.distance - b.distance);
    let res = [];
    for (let i = 0; i < entities.length; i++) {
        res.push(entities[i].entity);
    }
    return res;
}

export function getNearestEntityWhere(bot, predicate, maxDistance=16) {
    return bot.nearestEntity(entity => predicate(entity) && bot.entity.position.distanceTo(entity.position) < maxDistance);
}


export function getNearbyPlayers(bot, maxDistance) {
    if (maxDistance == null) maxDistance = 16;
    let players = [];
    for (const entity of Object.values(bot.entities)) {
        const distance = entity.position.distanceTo(bot.entity.position);
        if (distance > maxDistance) continue;
        if (entity.type == 'player' && entity.username != bot.username) {
            players.push({ entity: entity, distance: distance });
        } 
    }
    players.sort((a, b) => a.distance - b.distance);
    let res = [];
    for (let i = 0; i < players.length; i++) {
        res.push(players[i].entity);
    }
    return res;
}

// Helper function to get villager profession from metadata
export function getVillagerProfession(entity) {
    // Villager profession mapping based on metadata
    const professions = {
        0: 'Unemployed',
        1: 'Armorer',
        2: 'Butcher', 
        3: 'Cartographer',
        4: 'Cleric',
        5: 'Farmer',
        6: 'Fisherman',
        7: 'Fletcher',
        8: 'Leatherworker',
        9: 'Librarian',
        10: 'Mason',
        11: 'Nitwit',
        12: 'Shepherd',
        13: 'Toolsmith',
        14: 'Weaponsmith'
    };
    
    if (entity.metadata && entity.metadata[18]) {
        // Check if metadata[18] is an object with villagerProfession property
        if (typeof entity.metadata[18] === 'object' && entity.metadata[18].villagerProfession !== undefined) {
            const professionId = entity.metadata[18].villagerProfession;
            const level = entity.metadata[18].level || 1;
            const professionName = professions[professionId] || 'Unknown';
            return `${professionName} L${level}`;
        }
        // Fallback for direct profession ID
        else if (typeof entity.metadata[18] === 'number') {
            const professionId = entity.metadata[18];
            return professions[professionId] || 'Unknown';
        }
    }
    
    // If we can't determine profession but it's an adult villager
    if (entity.metadata && entity.metadata[16] !== 1) { // Not a baby
        return 'Adult';
    }
    
    return 'Unknown';
}


export function getInventoryCounts(bot) {
    /**
     * Get an object representing the bot's inventory.
     * @param {Bot} bot - The bot to get the inventory for.
     * @returns {object} - An object with item names as keys and counts as values.
     * @example
     * let inventory = world.getInventoryCounts(bot);
     * let oakLogCount = inventory['oak_log'];
     * let hasWoodenPickaxe = inventory['wooden_pickaxe'] > 0;
     **/
    let inventory = {};
    for (const slot of bot.inventory.slots) {
        if (slot != null && slot.name) {
            if (inventory[slot.name] == null) {
                inventory[slot.name] = 0;
            }
            inventory[slot.name] += slot.count;
        }
    }
    return inventory;
}


export function getCraftableItems(bot) {
    /**
     * Get a list of all items that can be crafted with the bot's current inventory.
     * @param {Bot} bot - The bot to get the craftable items for.
     * @returns {string[]} - A list of all items that can be crafted.
     * @example
     * let craftableItems = world.getCraftableItems(bot);
     **/
    let table = getNearestBlock(bot, 'crafting_table');
    if (!table) {
        for (const item of bot.inventory.items()) {
            if (item != null && item.name === 'crafting_table') {
                table = item;
                break;
            }
        }
    }
    let res = [];
    for (const item of mc.getAllItems()) {
        let recipes = bot.recipesFor(item.id, null, 1, table);
        if (recipes.length > 0)
            res.push(item.name);
    }
    return res;
}


export function getPosition(bot) {
    /**
     * Get your position in the world (Note that y is vertical).
     * @param {Bot} bot - The bot to get the position for.
     * @returns {Vec3} - An object with x, y, and x attributes representing the position of the bot.
     * @example
     * let position = world.getPosition(bot);
     * let x = position.x;
     **/
    return bot.entity.position;
}


export function getNearbyEntityTypes(bot) {
    /**
     * Get a list of all nearby mob types.
     * @param {Bot} bot - The bot to get nearby mobs for.
     * @returns {string[]} - A list of all nearby mobs.
     * @example
     * let mobs = world.getNearbyEntityTypes(bot);
     **/
    let mobs = getNearbyEntities(bot, 16);
    let found = [];
    for (let i = 0; i < mobs.length; i++) {
        if (!found.includes(mobs[i].name)) {
            found.push(mobs[i].name);
        }
    }
    return found;
}

export function isEntityType(name) {
    /**
     * Check if a given name is a valid entity type.
     * @param {string} name - The name of the entity type to check.
     * @returns {boolean} - True if the name is a valid entity type, false otherwise.
     */
    return mc.getEntityId(name) !== null;
}

export function getNearbyPlayerNames(bot) {
    /**
     * Get a list of all nearby player names.
     * @param {Bot} bot - The bot to get nearby players for.
     * @returns {string[]} - A list of all nearby players.
     * @example
     * let players = world.getNearbyPlayerNames(bot);
     **/
    let players = getNearbyPlayers(bot, 64);
    let found = [];
    for (let i = 0; i < players.length; i++) {
        if (!found.includes(players[i].username) && players[i].username != bot.username) {
            found.push(players[i].username);
        }
    }
    return found;
}


export function getNearbyBlockTypes(bot, distance=16) {
    /**
     * Get a list of all nearby block names.
     * @param {Bot} bot - The bot to get nearby blocks for.
     * @param {number} distance - The maximum distance to search, default 16.
     * @returns {string[]} - A list of all nearby blocks.
     * @example
     * let blocks = world.getNearbyBlockTypes(bot);
     **/
    let blocks = getNearestBlocks(bot, null, distance);
    let found = [];
    for (let i = 0; i < blocks.length; i++) {
        if (!found.includes(blocks[i].name)) {
            found.push(blocks[i].name);
        }
    }
    return found;
}

// Constructing Movements walks the whole block registry to build its ID sets.
// isClearPath is called from the cowardice, hunting, and item_collecting mode
// updates, so that construction ran up to three times per behavior tick to
// produce an identical configuration every time. The instance is safe to reuse:
// its configuration here is constant, it never escapes this function, and the
// pathfinder rebuilds the only per-search state on it (the entity collision
// index) at the start of each search.
const clearPathMovements = new WeakMap();

function clearPathMovementsFor(bot) {
    const cached = clearPathMovements.get(bot);
    if (cached) return cached;
    const movements = new pf.Movements(bot);
    // policy: this probe answers "can I walk there without touching the world".
    // Digging and placing are excluded because they are the thing being asked
    // about, not because the bot is incapable of them. A false answer here means
    // "not trivially walkable", never "unreachable" -- see assessClearPath.
    movements.canDig = false;
    movements.canPlaceBlocks = false;
    // Opening a door is neither digging nor placing, and this function's own
    // docstring only promises "no digging or placing". With doors shut off, a
    // closed door read as "no clear path" and the caller never tried.
    movements.canOpenDoors = true;
    clearPathMovements.set(bot, movements);
    return movements;
}

// 100ms was the old budget and it ran on a behavior tick, so an unfinished
// search -- not a missing route -- routinely became "no". Matches the 400ms the
// collection route probe was raised to on 2026-08-16 for the same reason.
const CLEAR_PATH_BUDGET_MS = 400;

/**
 * Three-state walkability. 'no' means pathfinder actually finished and found
 * nothing; 'inconclusive' means it ran out of budget or only got partway, which
 * is not the same claim and must never be reported as impossibility.
 *
 * @returns {{ clear: 'yes'|'no'|'inconclusive', status: string }}
 */
export async function assessClearPath(bot, target) {
    const movements = clearPathMovementsFor(bot);
    const goal = new pf.goals.GoalNear(target.position.x, target.position.y, target.position.z, 1);
    let path = null;
    try {
        path = await bot.pathfinder.getPathTo(movements, goal, CLEAR_PATH_BUDGET_MS);
    } catch (error) {
        return { clear: 'inconclusive', status: 'probe_error' };
    }
    const status = path?.status || 'unknown';
    if (status === 'success') return { clear: 'yes', status };
    if (status === 'noPath') return { clear: 'no', status };
    return { clear: 'inconclusive', status };
}

export async function isClearPath(bot, target) {
    /**
     * Check if there is a path to the target that requires no digging or placing blocks.
     * @param {Bot} bot - The bot to get the path for.
     * @param {Entity} target - The target to path to.
     * @returns {boolean} - True if there is a clear path, false otherwise.
     */
    // Attempt unless pathfinder definitively said there is no route. These are
    // opportunistic modes -- flee, hunt, pick up a dropped item -- where trying
    // and failing costs almost nothing and refusing to try costs the behaviour
    // entirely. An unfinished search fails open to "go ahead".
    const assessment = await assessClearPath(bot, target);
    return assessment.clear !== 'no';
}

export function hasLineOfSightToEntity(bot, entity) {
    if (!bot?.entity?.position || !entity?.position || !bot.world?.raycast) return null;
    if (!bot.blockAt?.(entity.position)) return null;

    const origin = bot.entity.position.offset(0, Number(bot.entity.eyeHeight) || 1.62, 0);
    const entityHeight = Math.max(0.6, Number(entity.height) || Number(entity.eyeHeight) || 1.8);
    const samples = [0.2, 0.55, 0.9].map(ratio => entity.position.offset(0, entityHeight * ratio, 0));
    for (const sample of samples) {
        const direction = sample.minus(origin);
        const distance = direction.norm();
        if (!Number.isFinite(distance)) continue;
        if (distance <= 0.25) return true;
        if (!bot.world.raycast(origin, direction.scaled(1 / distance), distance)) return true;
    }
    return false;
}

export function shouldPlaceTorch(bot) {
    if (!bot.modes.isOn('torch_placing') || bot.interrupt_code) return false;
    const pos = getPosition(bot);
    // TODO: check light level instead of nearby torches, block.light is broken
    let nearest_torch = getNearestBlock(bot, 'torch', 6);
    if (!nearest_torch)
        nearest_torch = getNearestBlock(bot, 'wall_torch', 6);
    if (!nearest_torch) {
        const block = bot.blockAt(pos);
        let has_torch = bot.inventory.findInventoryItem('torch');
        return has_torch && block?.name === 'air';
    }
    return false;
}

export function getBiomeName(bot) {
    /**
     * Get the name of the biome the bot is in.
     * @param {Bot} bot - The bot to get the biome for.
     * @returns {string} - The name of the biome.
     * @example
     * let biome = world.getBiomeName(bot);
     **/
    const biomeId = bot.world.getBiome(bot.entity.position);
    return mc.getAllBiomes()[biomeId].name;
}
