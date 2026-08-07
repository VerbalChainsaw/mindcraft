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
    // Contact-damage blocks that otherwise pass the standing checks: the first
    // two have an empty bounding box, so a position whose feet block is one of
    // them satisfies "the bot can occupy this space"; pointed dripstone is a
    // full block and so was accepted as a surface to stand on.
    'sweet_berry_bush',
    'wither_rose',
    'pointed_dripstone',
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

export function assessAnchoredGameplaySupport(bot, block, { maxFallingDepth = 8 } = {}) {
    if (isSafeGameplaySupport(block)) {
        return { ok: true, outcome: 'stable_support', blocks: [block], anchor: block };
    }
    if (
        !block?.position?.offset
        || !isFallingGameplayBlock(block)
        || !bot?.blockAt
    ) {
        return {
            ok: false,
            outcome: block ? 'unsafe_support' : 'support_unloaded',
            blocks: [],
            anchor: null,
        };
    }

    const depthLimit = Math.max(1, Math.floor(Number(maxFallingDepth) || 1));
    const blocks = [block];
    let position = block.position.offset(0, -1, 0);
    for (let depth = 1; depth <= depthLimit; depth += 1) {
        let below;
        try {
            below = bot.blockAt(position);
        } catch {
            below = null;
        }
        if (!below) {
            return { ok: false, outcome: 'support_unloaded', blocks, anchor: null };
        }
        if (isFallingGameplayBlock(below)) {
            blocks.push(below);
            position = position.offset(0, -1, 0);
            continue;
        }
        if (isSafeGameplaySupport(below)) {
            blocks.push(below);
            return {
                ok: true,
                outcome: 'falling_support_anchored',
                blocks,
                anchor: below,
            };
        }
        return { ok: false, outcome: 'falling_support_unanchored', blocks, anchor: null };
    }
    return { ok: false, outcome: 'falling_support_depth_exceeded', blocks, anchor: null };
}

export function isAnchoredGameplaySupport(bot, block, options = {}) {
    return assessAnchoredGameplaySupport(bot, block, options).ok;
}
