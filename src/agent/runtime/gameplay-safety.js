const PROTECTED_GAMEPLAY_BLOCKS = new Set([
    'bedrock',
    'barrier',
    'end_gateway',
    'end_portal',
    'end_portal_frame',
    'nether_portal',
    'chest',
    'trapped_chest',
    'barrel',
    'furnace',
    'blast_furnace',
    'smoker',
    'crafting_table',
    'enchanting_table',
    'ender_chest',
    'shulker_box',
    'beacon',
    'respawn_anchor',
]);

const REPLACEABLE_GAMEPLAY_BLOCKS = new Set([
    'air',
    'cave_air',
    'void_air',
    'grass',
    'short_grass',
    'tall_grass',
    'fern',
    'large_fern',
    'dead_bush',
    'snow',
    'vine',
]);

const HAZARDOUS_GAMEPLAY_BLOCKS = new Set([
    'lava',
    'fire',
    'soul_fire',
    'magma_block',
    'cactus',
    'campfire',
    'soul_campfire',
    'powder_snow',
]);

function blockName(blockOrName) {
    return typeof blockOrName === 'string'
        ? blockOrName
        : String(blockOrName?.name || '');
}

export function isProtectedGameplayBlock(blockOrName) {
    const name = blockName(blockOrName);
    return PROTECTED_GAMEPLAY_BLOCKS.has(name) || name.endsWith('_shulker_box');
}

export function isReplaceableGameplayBlock(blockOrName) {
    return REPLACEABLE_GAMEPLAY_BLOCKS.has(blockName(blockOrName));
}

export function isHazardousGameplayBlock(blockOrName) {
    return HAZARDOUS_GAMEPLAY_BLOCKS.has(blockName(blockOrName));
}

export function isFallingGameplayBlock(blockOrName) {
    const name = blockName(blockOrName);
    return name === 'sand'
        || name === 'red_sand'
        || name === 'gravel'
        || name === 'anvil'
        || name === 'chipped_anvil'
        || name === 'damaged_anvil'
        || name.endsWith('_concrete_powder');
}

export function isLiquidGameplayBlock(blockOrName) {
    const name = blockName(blockOrName);
    return name === 'water' || name === 'lava';
}

export function isSafeGameplaySupport(block) {
    return Boolean(
        block
        && block.boundingBox !== 'empty'
        && !isLiquidGameplayBlock(block)
        && !isHazardousGameplayBlock(block)
        && !isFallingGameplayBlock(block),
    );
}

