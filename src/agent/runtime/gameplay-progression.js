const LOG_PATTERN = /(?:_log|_stem)$/;
const PLANK_PATTERN = /_planks$/;
const FOOD_PATTERN = /(?:apple|bread|carrot|potato|beetroot|berries|melon|beef|porkchop|chicken|mutton|rabbit|cod|salmon|stew|pie|cookie|cake)$/;

const TOOL_TIERS = ['wooden', 'golden', 'stone', 'copper', 'iron', 'diamond', 'netherite'];

function countMatching(counts, matcher) {
    return Object.entries(counts || {}).reduce(
        (total, [name, count]) => matcher(name) ? total + Math.max(0, Number(count) || 0) : total,
        0,
    );
}

function countToolsAtOrAbove(counts, tool, minimumTier) {
    const minimumIndex = TOOL_TIERS.indexOf(minimumTier);
    return TOOL_TIERS.slice(minimumIndex).reduce(
        (total, tier) => total + Math.max(0, Number(counts?.[`${tier}_${tool}`]) || 0),
        0,
    );
}

function nearbyBlockCount(state, matcher) {
    return (state.perception?.usefulBlocks || []).reduce(
        (total, block) => matcher(block.name) ? total + Math.max(1, Number(block.count) || 1) : total,
        0,
    );
}

function hasNearby(state, name) {
    return nearbyBlockCount(state, candidate => candidate === name) > 0;
}

function firstCarriedFood(counts) {
    return Object.keys(counts || {}).find(name => (counts[name] || 0) > 0 && FOOD_PATTERN.test(name)) || null;
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

function survivalOverride(state) {
    const health = Number(state.gameplay?.health) || 0;
    const hunger = Number(state.gameplay?.hunger) || 0;
    const food = firstCarriedFood(state.inventory?.counts);
    const nearestHostile = (state.perception?.hostiles || [])[0];
    const nearestHazard = (state.perception?.hazards || [])[0];

    if (health <= 8) {
        return {
            code: 'critical_health',
            reason: `health is ${health}/20`,
            nextOperation: nearestHostile
                ? `Retreat from the immediate ${nearestHostile.name}, then eat only after safe spacing is verified.`
                : food
                    ? `Reach cover, then eat carried ${food}; verify health is regenerating before resuming.`
                    : 'Reach cover; obtain safe food only after immediate danger is clear.',
            command: nearestHostile ? '!resolveTacticalCombat(16)' : food ? `!consume("${food}")` : null,
        };
    }
    if (nearestHostile && nearestHostile.distance <= 6) {
        return {
            code: 'immediate_hostile',
            reason: `${nearestHostile.name} is ${nearestHostile.distance} blocks ${nearestHostile.direction}`,
            nextOperation: 'Resolve or escape the immediate hostile before gathering, crafting, mining, or building.',
            command: '!resolveTacticalCombat(16)',
        };
    }
    if (nearestHazard && nearestHazard.distance <= 2) {
        return {
            code: 'immediate_hazard',
            reason: `${nearestHazard.name} is ${nearestHazard.distance} blocks ${nearestHazard.direction}`,
            nextOperation: 'Move onto verified solid support away from the hazard, then inspect awareness again.',
            command: null,
        };
    }
    if (hunger <= 6) {
        return {
            code: 'critical_hunger',
            reason: `hunger is ${hunger}/20`,
            nextOperation: food
                ? `Eat carried ${food}, then verify hunger before doing strenuous work.`
                : 'Secure food before mining, combat, exploration, or construction.',
            command: food ? `!consume("${food}")` : '!prepareFood(20, 48)',
        };
    }
    return null;
}

function milestone(id, label, complete, nextOperation, command, missing) {
    return { id, label, complete, nextOperation, command, missing };
}

/**
 * Derive a truthful survival-progression chain from live Minecraft evidence.
 *
 * This is deliberately not a second autonomous controller. It tells the
 * existing LLM/conversation path which prerequisite is currently satisfied,
 * which one comes next, and which deterministic command can perform that
 * operation. Higher-tier evidence satisfies consumed lower-tier prerequisites
 * (for example, an iron pickaxe proves that wooden and stone pickaxe gates were
 * passed even if those old tools are no longer carried).
 */
export function evaluateGameplayProgression(state) {
    const counts = state.inventory?.counts || {};
    const logCount = countMatching(counts, name => LOG_PATTERN.test(name));
    const plankCount = countMatching(counts, name => PLANK_PATTERN.test(name));
    const woodEvidence = logCount + plankCount
        + countToolsAtOrAbove(counts, 'pickaxe', 'wooden')
        + countToolsAtOrAbove(counts, 'axe', 'wooden');
    const craftingTableReady = (counts.crafting_table || 0) > 0
        || hasNearby(state, 'crafting_table')
        || countToolsAtOrAbove(counts, 'pickaxe', 'wooden') > 0;
    const woodenPickaxeReady = countToolsAtOrAbove(counts, 'pickaxe', 'wooden') > 0;
    const carriedStone = Math.max(0, Number(counts.cobblestone) || 0)
        + Math.max(0, Number(counts.cobbled_deepslate) || 0);
    const stonePickaxeReady = countToolsAtOrAbove(counts, 'pickaxe', 'stone') > 0;
    const furnaceReady = (counts.furnace || 0) > 0
        || hasNearby(state, 'furnace')
        || countToolsAtOrAbove(counts, 'pickaxe', 'iron') > 0;
    const fuelCount = Math.max(0, Number(counts.coal) || 0)
        + Math.max(0, Number(counts.charcoal) || 0);
    const lightCount = Math.max(0, Number(counts.torch) || 0)
        + Math.max(0, Number(counts.lantern) || 0);
    const ironInputCount = countMatching(
        counts,
        name => name === 'raw_iron' || name === 'iron_ore' || name === 'deepslate_iron_ore',
    );
    const ironIngotCount = Math.max(0, Number(counts.iron_ingot) || 0);
    const ironToolEvidence = countToolsAtOrAbove(counts, 'pickaxe', 'iron')
        + countToolsAtOrAbove(counts, 'axe', 'iron')
        + countToolsAtOrAbove(counts, 'sword', 'iron');
    const ironAcquired = ironInputCount + ironIngotCount + ironToolEvidence > 0;
    const ironSmelted = ironIngotCount + ironToolEvidence > 0;
    const ironPickaxeReady = countToolsAtOrAbove(counts, 'pickaxe', 'iron') > 0;
    const shieldReady = (counts.shield || 0) > 0;
    const bucketReady = (counts.bucket || 0) + (counts.water_bucket || 0) + (counts.lava_bucket || 0) > 0;
    const diamondCount = Math.max(0, Number(counts.diamond) || 0);
    const diamondPickaxeReady = countToolsAtOrAbove(counts, 'pickaxe', 'diamond') > 0;
    const obsidianCount = Math.max(0, Number(counts.obsidian) || 0);
    const ignitionReady = (counts.flint_and_steel || 0) > 0 || (counts.fire_charge || 0) > 0;
    const portalReady = hasNearby(state, 'nether_portal');
    const dimension = normalizedDimension(state.gameplay?.dimension);
    const quartzCount = Math.max(0, Number(counts.quartz) || 0);
    const netherRoundTripReady = quartzCount > 0 && dimension === 'overworld';
    const lastAction = state.action?.lastResult || null;
    const explorationRouteReady = state.memory?.explorationRouteVerified === true;
    const deathRecoveryReady = (
        state.memory?.deathRecoveryVerified === true
        && state.memory?.deathRecoveryPending !== true
    );
    const tacticalCombatReady = explorationRouteReady || deathRecoveryReady || (
        ['action:resolveTacticalCombat', 'action:attackHostile'].includes(lastAction?.label)
        && lastAction.phase === 'succeeded'
        && lastAction.code === 'skill_secured'
    );

    const milestones = [
        milestone(
            'wood',
            'Acquire wood',
            woodEvidence > 0,
            'Collect reachable logs and verify they enter inventory.',
            '!collectWoodInRange(4, 64)',
            ['logs'],
        ),
        milestone(
            'planks',
            'Make planks',
            plankCount >= 4 || craftingTableReady,
            'Convert logs into at least four planks.',
            '!prepareMaterial("planks", 4, 64)',
            ['4 planks'],
        ),
        milestone(
            'crafting_table',
            'Establish crafting access',
            craftingTableReady,
            'Craft a crafting table and retain it or place it nearby.',
            '!craftRecipe("crafting_table", 1)',
            ['crafting table'],
        ),
        milestone(
            'wooden_pickaxe',
            'Prepare a wooden pickaxe',
            woodenPickaxeReady,
            'Prepare and equip a wooden pickaxe before attempting to mine stone.',
            '!prepareTool("wooden_pickaxe")',
            ['wooden pickaxe'],
        ),
        milestone(
            'stone_pickaxe',
            'Prepare a stone pickaxe',
            stonePickaxeReady,
            'Craft and equip a stone pickaxe before mining iron ore.',
            '!prepareTool("stone_pickaxe")',
            ['stone pickaxe'],
        ),
        milestone(
            'furnace_stone',
            'Secure furnace stone',
            carriedStone >= 8 || furnaceReady,
            'Carry eight cobblestone for a furnace after the stone pickaxe has been prepared.',
            `!prepareMaterial("cobblestone", ${Math.max(1, 8 - carriedStone)}, 64)`,
            [`${Math.max(0, 8 - carriedStone)} more cobblestone`],
        ),
        milestone(
            'furnace',
            'Establish smelting access',
            furnaceReady,
            'Craft a furnace and retain it or place it nearby.',
            '!craftRecipe("furnace", 1)',
            ['furnace'],
        ),
        milestone(
            'fuel_and_light',
            'Secure fuel and light',
            fuelCount > 0 && lightCount > 0,
            fuelCount === 0
                ? 'Collect coal before extended underground work.'
                : 'Craft torches before extended underground work.',
            fuelCount === 0
                ? '!collectBlocksInRange("coal_ore", 2, 64)'
                : '!prepareMaterial("torch", 8, 64)',
            [fuelCount === 0 ? 'coal or charcoal' : null, lightCount === 0 ? 'torches' : null].filter(Boolean),
        ),
        milestone(
            'iron_ore',
            'Acquire iron ore',
            ironAcquired,
            'Locate and mine iron only with a stone-or-better pickaxe.',
            '!collectBlocksInRange("iron_ore", 3, 64)',
            ['3 raw iron'],
        ),
        milestone(
            'iron_ingots',
            'Smelt iron',
            ironSmelted,
            'Smelt raw iron with verified furnace and fuel access.',
            `!smeltItem("raw_iron", ${Math.max(1, Math.min(3, ironInputCount || 3))})`,
            ['iron ingots'],
        ),
        milestone(
            'iron_pickaxe',
            'Prepare an iron pickaxe',
            ironPickaxeReady,
            'Craft and equip an iron pickaxe before attempting to mine diamond or obsidian.',
            '!prepareTool("iron_pickaxe")',
            ['iron pickaxe'],
        ),
        milestone(
            'defense_utility',
            'Prepare defense and utility',
            shieldReady && bucketReady,
            !shieldReady
                ? 'Craft a shield before deliberate hostile encounters.'
                : 'Craft a bucket before lava, portal, or deep-cave operations.',
            !shieldReady ? '!craftRecipe("shield", 1)' : '!craftRecipe("bucket", 1)',
            [!shieldReady ? 'shield' : null, !bucketReady ? 'bucket' : null].filter(Boolean),
        ),
        milestone(
            'diamonds',
            'Acquire diamonds',
            diamondCount >= 3 || diamondPickaxeReady,
            'Explore at diamond depth, then mine at least three diamonds with an iron-or-better pickaxe.',
            '!collectBlocksInRange("diamond_ore", 3, 128)',
            [`${Math.max(0, 3 - diamondCount)} more diamonds`],
        ),
        milestone(
            'diamond_pickaxe',
            'Prepare a diamond pickaxe',
            diamondPickaxeReady,
            'Craft and equip a diamond pickaxe before mining obsidian.',
            '!prepareTool("diamond_pickaxe")',
            ['diamond pickaxe'],
        ),
        milestone(
            'portal_materials',
            'Prepare Nether portal materials',
            portalReady || (obsidianCount >= 10 && ignitionReady),
            obsidianCount < 10
                ? 'Mine ten obsidian with a diamond-or-better pickaxe.'
                : 'Craft flint and steel before constructing a portal.',
            obsidianCount < 10
                ? `!collectBlocksInRange("obsidian", ${Math.max(1, 10 - obsidianCount)}, 64)`
                : '!craftRecipe("flint_and_steel", 1)',
            [obsidianCount < 10 ? `${10 - obsidianCount} more obsidian` : null, !ignitionReady ? 'flint and steel' : null].filter(Boolean),
        ),
        milestone(
            'portal_assembly',
            'Construct and ignite a Nether portal',
            portalReady,
            'Select a clear supported footprint, construct the ten-obsidian frame, ignite it, and verify portal blocks in the world.',
            '!buildNetherPortal(12)',
            ['active Nether portal'],
        ),
        milestone(
            'nether_round_trip',
            'Collect Nether quartz and return safely',
            netherRoundTripReady,
            dimension === 'the_nether'
                ? 'Collect verified quartz if needed, then use the active return portal and verify the bot is alive in the Overworld.'
                : 'Enter through the active portal, collect verified quartz, return through the paired portal, and step onto safe Overworld ground.',
            '!completeNetherQuartzRun(1)',
            [
                quartzCount > 0 ? null : 'newly collected quartz',
                dimension === 'overworld' ? null : 'verified Overworld return',
            ].filter(Boolean),
        ),
        milestone(
            'tactical_combat',
            'Resolve a tactical hostile encounter',
            tacticalCombatReady,
            'Inspect live health, equipment, hostile type, and spacing; then execute the selected melee, shielded, ranged, or retreat response and verify the physical outcome.',
            '!resolveTacticalCombat(16)',
            ['verified tactical combat choice'],
        ),
        milestone(
            'exploration_route',
            'Explore landmarks and return by memory',
            explorationRouteReady,
            'Visit distinct observed landmarks, remember their verified positions, recover the target cache item, and return physically to the saved entrance.',
            '!completeExplorationRoute("echo_shard", 3, 96)',
            ['verified landmark memory', 'recovered exploration cache', 'verified route return'],
        ),
        milestone(
            'death_recovery',
            'Recover inventory after death',
            deathRecoveryReady,
            state.memory?.deathRecoveryPending
                ? 'Return to the recorded death site in the same dimension and verify the dropped inventory is recovered.'
                : 'After a real death records a recoverable inventory manifest, return physically and verify the dropped items are restored.',
            state.memory?.deathRecoveryPending ? '!recoverDeathItems()' : null,
            [state.memory?.deathRecoveryPending ? 'verified dropped-item pickup' : 'recorded death with recoverable items'],
        ),
    ];

    const next = milestones.find(entry => !entry.complete) || null;
    const completed = milestones.filter(entry => entry.complete).length;
    const override = survivalOverride(state);

    return {
        model: 'survival_progression_v1',
        completedMilestones: completed,
        totalMilestones: milestones.length,
        currentStage: override ? 'survival_override' : (next?.id || 'operational'),
        nextMilestone: override ? 'Restore safe operating conditions' : (next?.label || 'Maintain sustained survival operations'),
        missingPrerequisites: override ? [override.reason] : (next?.missing || []),
        nextOperation: override
            ? override.nextOperation
            : (next?.nextOperation || 'The full survival progression, exploration route, and death/item recovery loop are verified. Continue maintaining food, equipment, shelter, and resources from live state.'),
        recommendedCommand: override ? override.command : (next?.command || null),
        blocker: null,
        safetyOverride: override,
        milestones: milestones.map(({ id, label, complete }) => ({ id, label, complete })),
    };
}
