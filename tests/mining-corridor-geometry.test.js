import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';

import collectBlockRuntime from '../packages/minecraft-runtime/mineflayer-collectblock/lib/index.js';
import {
    assessMiningRouteStep,
    assessMiningRouteDurability,
    goToSurface,
    observedSupportedStandingCell,
    orderMiningExcavationBlocks,
    selectMiningDeadlinePrefix,
    selectMiningRouteTool,
    surfaceCorridorToolRequirement,
    toolPreparationPlankFloor,
    waitForStableSupportedStandingCell,
} from '../src/agent/library/skills.js';

const {
    CollectBlock,
    createDroppedItemPickupGoal,
    isDropFromMinedBlock,
    selectCollectionTool,
} = collectBlockRuntime;
import {
    searchSupportedMiningVoxelCorridors,
    selectBoundedMiningProgressStances,
} from '../src/agent/runtime/mining-corridor-planner.js';

const key = position => `${position.x}:${position.y}:${position.z}`;

test('observed standing geometry accepts a body touching but not intersecting bamboo', () => {
    const blocks = new Map();
    const put = (x, y, z, name, boundingBox, shapes) => {
        const position = new Vec3(x, y, z);
        blocks.set(key(position), { name, boundingBox, shapes, position });
    };
    put(2696, 51, 2701, 'podzol', 'block', [[0, 0, 0, 1, 1, 1]]);
    put(2696, 52, 2701, 'bamboo', 'block', [[0.15625, 0, 0.15625, 0.34375, 1, 0.34375]]);
    put(2696, 53, 2701, 'bamboo', 'block', [[0.15625, 0, 0.15625, 0.34375, 1, 0.34375]]);
    const bot = {
        entity: {
            position: new Vec3(2696.3309871781084, 52, 2701.64375),
            width: 0.6,
            height: 1.8,
        },
        blockAt(position) {
            return blocks.get(key(position)) || null;
        },
    };

    assert.deepEqual(observedSupportedStandingCell(bot), new Vec3(2696, 52, 2701));

    bot.entity.position = new Vec3(2696.25, 52, 2701.25);
    assert.equal(observedSupportedStandingCell(bot), null);
});

test('surface recovery does not bind from one transient supported body sample', async () => {
    const blocks = new Map();
    const put = (x, y, z, name, boundingBox = 'block') => {
        const position = new Vec3(x, y, z);
        blocks.set(key(position), { name, boundingBox, shapes: [], position });
    };
    put(4, 63, -3, 'stone');
    const bot = {
        interrupt_code: false,
        entity: {
            position: new Vec3(4.5, 64, -2.5),
            width: 0.6,
            height: 1.8,
        },
        blockAt(position) {
            return blocks.get(key(position)) || {
                name: 'air',
                boundingBox: 'empty',
                shapes: [],
                position: position.floored(),
            };
        },
    };
    let transientEnded = false;
    setTimeout(() => {
        bot.entity.position = new Vec3(4.5, 65, -2.5);
    }, 20);
    setTimeout(() => {
        bot.entity.position = new Vec3(4.5, 64, -2.5);
        transientEnded = true;
    }, 60);

    const settled = await waitForStableSupportedStandingCell(bot, 300, 75);

    assert.equal(transientEnded, true);
    assert.deepEqual(settled, new Vec3(4, 64, -3));
});

test('surface recovery does not classify corridor planning when native movement never settles', async () => {
    const blocks = new Map();
    const put = (x, y, z, name, boundingBox = 'block') => {
        const position = new Vec3(x, y, z);
        blocks.set(key(position), { name, boundingBox, shapes: [], position });
    };
    put(4, 26, -3, 'stone');
    put(4, 63, -3, 'stone');
    const bot = {
        interrupt_code: false,
        entity: {
            position: new Vec3(4.5, 27, -2.5),
            width: 0.6,
            height: 1.8,
        },
        game: { minY: -64, height: 384 },
        blockAt(position) {
            return blocks.get(key(position)) || {
                name: 'air',
                boundingBox: 'empty',
                shapes: [],
                position: position.floored(),
            };
        },
        output: '',
    };
    let navigateCalls = 0;
    let settleCalls = 0;

    const reached = await goToSurface(bot, {
        async navigateGoal() {
            navigateCalls += 1;
            bot.entity.position = new Vec3(4.08, 28, -2.5);
            bot.lastActionEvidence = { kind: 'movement', outcome: 'unreachable' };
            return false;
        },
        async settleSupportedStandingCell() {
            settleCalls += 1;
            return null;
        },
    });

    assert.equal(reached, false);
    assert.equal(navigateCalls, 1);
    assert.equal(settleCalls, 1);
    assert.equal(bot.lastActionEvidence.outcome, 'surface_settlement_unverified');
    assert.equal(bot.lastActionEvidence.settlement, 'no_stable_stance');
    assert.equal(bot.lastActionEvidence.routeDigging, false);
});

test('surface recovery recognizes covered ground-level access from a complete native egress proof', async () => {
    const blocks = new Map();
    const put = (x, y, z, name, boundingBox = 'block') => {
        const position = new Vec3(x, y, z);
        blocks.set(key(position), { name, boundingBox, shapes: [], position });
    };
    put(4, 68, -3, 'spruce_planks');
    put(4, 71, -3, 'spruce_planks');
    put(10, 68, -3, 'grass_block');
    const bot = {
        entity: {
            position: new Vec3(4.5, 69, -2.5),
            width: 0.6,
            height: 1.8,
        },
        game: { minY: -64, height: 384 },
        blockAt(position) {
            return blocks.get(key(position.floored())) || {
                name: 'air',
                boundingBox: 'empty',
                shapes: [],
                position: position.floored(),
            };
        },
        output: '',
    };
    let navigationCalls = 0;
    const reached = await goToSurface(bot, {
        async navigateGoal() {
            navigationCalls += 1;
            return false;
        },
        probeSurfaceEgress(_bot, stances) {
            assert.ok(stances.some(stance => stance.equals(new Vec3(10, 69, -3))));
            assert.ok(stances.every(stance => stance.y <= 70));
            return {
                reachable: true,
                status: 'success',
                pathLength: 6,
                terminalPosition: { x: 10, y: 69, z: -3 },
            };
        },
    });

    assert.equal(reached, true);
    assert.equal(navigationCalls, 0);
    assert.equal(bot.lastActionEvidence.outcome, 'surface_reached');
    assert.equal(bot.lastActionEvidence.support, 'spruce_planks');
    assert.deepEqual(bot.lastActionEvidence.access, {
        kind: 'covered_surface_egress',
        candidateCount: 1,
        pathStatus: 'success',
        pathLength: 6,
        terminalPosition: { x: 10, y: 69, z: -3 },
    });
    assert.equal(bot.lastActionEvidence.legs, 0);
});

test('surface recovery does not excavate after an unfinished native egress proof', async () => {
    const blocks = new Map();
    const put = (x, y, z, name, boundingBox = 'block') => {
        const position = new Vec3(x, y, z);
        blocks.set(key(position), { name, boundingBox, shapes: [], position });
    };
    put(4, 68, -3, 'spruce_planks');
    put(4, 71, -3, 'spruce_planks');
    put(10, 68, -3, 'grass_block');
    const bot = {
        interrupt_code: false,
        entity: {
            position: new Vec3(4.5, 69, -2.5),
            width: 0.6,
            height: 1.8,
        },
        game: { minY: -64, height: 384 },
        blockAt(position) {
            return blocks.get(key(position.floored())) || {
                name: 'air',
                boundingBox: 'empty',
                shapes: [],
                position: position.floored(),
            };
        },
        output: '',
    };
    let navigationCalls = 0;

    const reached = await goToSurface(bot, {
        async navigateGoal() {
            navigationCalls += 1;
            return false;
        },
        probeSurfaceEgress() {
            return {
                reachable: false,
                conclusive: false,
                status: 'timeout',
                pathLength: 0,
            };
        },
    });

    assert.equal(reached, false);
    assert.equal(navigationCalls, 0);
    assert.equal(bot.lastActionEvidence.outcome, 'surface_egress_route_unproven');
    assert.equal(bot.lastActionEvidence.inconclusive, true);
    assert.equal(bot.lastActionEvidence.routeDigging, false);
    assert.equal(bot.lastActionEvidence.retryable, true);
});

test('surface recovery accepts an occupied open stance with a complete native ground-egress proof', async () => {
    const blocks = new Map();
    const put = (x, y, z, name, boundingBox, shapes) => {
        const position = new Vec3(x, y, z);
        blocks.set(key(position), { name, boundingBox, shapes, position });
    };
    put(4, 72, -3, 'acacia_leaves', 'block', [[0, 0, 0, 1, 1, 1]]);
    put(10, 72, -3, 'grass_block', 'block', [[0, 0, 0, 1, 1, 1]]);
    const bot = {
        entity: {
            position: new Vec3(4.5, 73, -2.5),
            width: 0.6,
            height: 1.8,
        },
        game: { minY: -64, height: 384 },
        blockAt(position) {
            return blocks.get(key(position)) || {
                name: 'air',
                boundingBox: 'empty',
                shapes: [],
                position: position.floored(),
            };
        },
        output: '',
    };

    assert.equal(await goToSurface(bot, {
        async navigateGoal() {
            assert.fail('The already occupied usable surface should not start another navigation leg.');
        },
        probeSurfaceEgress(_bot, stances) {
            assert.ok(stances.some(stance => stance.equals(new Vec3(10, 73, -3))));
            return {
                reachable: true,
                status: 'success',
                pathLength: 6,
                terminalPosition: { x: 10, y: 73, z: -3 },
            };
        },
    }), true);
    assert.equal(bot.lastActionEvidence.outcome, 'surface_reached');
    assert.equal(bot.lastActionEvidence.support, 'acacia_leaves');
    assert.equal(bot.lastActionEvidence.legs, 0);
});

test('surface recovery requires one shared responsive pick only for a bound unharvested stone corridor', () => {
    const stone = {
        name: 'stone',
        canHarvest: type => type === 2,
        position: new Vec3(1, 32, 0),
    };
    const carried = [];
    const bot = {
        inventory: { items: () => carried },
        registry: {
            itemsByName: {
                wooden_pickaxe: { id: 1 },
                stone_pickaxe: { id: 2 },
                iron_pickaxe: { id: 3 },
                diamond_pickaxe: { id: 4 },
            },
        },
    };
    const plan = {
        ok: true,
        excavationBlocks: [stone, stone],
        durability: { unharvestedBreaks: 2 },
    };

    assert.deepEqual(surfaceCorridorToolRequirement(bot, plan), {
        name: 'stone_pickaxe',
        minimumUsableDurability: 2,
    });

    carried.push({
        name: 'stone_pickaxe',
        type: 2,
        slot: 10,
        maxDurability: 131,
        durabilityUsed: 0,
    });
    assert.equal(surfaceCorridorToolRequirement(bot, plan), null);
    assert.equal(surfaceCorridorToolRequirement(bot, {
        ...plan,
        durability: { unharvestedBreaks: 0 },
    }), null);
});

test('responsive wooden pickaxe preparation reserves Spruce-family tool planks before its crafting kit', () => {
    const items = [
        { name: 'spruce_log', count: 4 },
        { name: 'stick', count: 3 },
    ];
    const bot = { inventory: { slots: items, items: () => items } };

    assert.equal(toolPreparationPlankFloor(bot, 'wooden_pickaxe'), 7);

    items.push({ name: 'crafting_table', count: 1 });
    assert.equal(toolPreparationPlankFloor(bot, 'wooden_pickaxe'), 3);
    assert.equal(toolPreparationPlankFloor(bot, 'stone_pickaxe'), 0);
});

test('surface corridor binds and clears Gravel above an authorized Diorite plug before opening the stance', () => {
    const blocks = new Map();
    const put = (x, y, z, name, boundingBox = 'block') => {
        const position = new Vec3(x, y, z);
        const block = { name, boundingBox, shapes: [], position };
        blocks.set(key(position), block);
        return block;
    };
    const air = position => ({
        name: 'air',
        boundingBox: 'empty',
        shapes: [],
        position: position.floored(),
    });
    put(1, 64, 0, 'dirt');
    const plug = put(1, 67, 0, 'diorite');
    const gravel = put(1, 68, 0, 'gravel');
    const bot = {
        blockAt(position) {
            return blocks.get(key(position.floored())) || air(position);
        },
    };
    const assessment = assessMiningRouteStep(bot, {
        position: new Vec3(1, 65, 0),
        heading: { x: 1, z: 0 },
        yOffset: 1,
    }, null);

    assert.equal(assessment.ok, true);
    assert.ok(assessment.blocks.some(block => block.position.equals(gravel.position)));
    assert.deepEqual(
        orderMiningExcavationBlocks([plug, gravel]).map(block => block.name),
        ['gravel', 'diorite'],
    );
});

test('corridor binding preserves the ore-tier pick when a capable stone pick is carried', () => {
    const stonePick = {
        name: 'stone_pickaxe',
        type: 2,
        slot: 10,
        maxDurability: 131,
        durabilityUsed: 94,
    };
    const ironPick = {
        name: 'iron_pickaxe',
        type: 3,
        slot: 11,
        maxDurability: 250,
        durabilityUsed: 195,
    };
    const bot = {
        inventory: { items: () => [stonePick, ironPick] },
        registry: {
            itemsByName: {
                wooden_pickaxe: { id: 1 },
                stone_pickaxe: { id: 2 },
                iron_pickaxe: { id: 3 },
                diamond_pickaxe: { id: 4 },
            },
        },
    };
    const corridorStone = {
        name: 'stone',
        canHarvest: type => type === 2 || type === 3 || type === 4,
    };
    const redstoneOre = {
        name: 'redstone_ore',
        canHarvest: type => type === 3 || type === 4,
    };

    assert.equal(
        selectMiningRouteTool(bot, corridorStone, redstoneOre),
        stonePick,
    );
});

test('corridor replacement prefers a fresh stone pick that is craftable from carried supplies', () => {
    const woodenPick = {
        name: 'wooden_pickaxe',
        type: 1,
        slot: 10,
        maxDurability: 59,
        durabilityUsed: 43,
    };
    const stonePick = {
        name: 'stone_pickaxe',
        type: 2,
        slot: 11,
        maxDurability: 131,
        durabilityUsed: 113,
    };
    const carried = [
        woodenPick,
        stonePick,
        { name: 'cobblestone', type: 20, slot: 12, count: 64 },
        { name: 'stick', type: 21, slot: 13, count: 2 },
        { name: 'crafting_table', type: 22, slot: 14, count: 1 },
    ];
    const bot = {
        inventory: { items: () => carried, slots: carried },
        registry: {
            itemsByName: {
                wooden_pickaxe: { id: 1, maxDurability: 59 },
                stone_pickaxe: { id: 2, maxDurability: 131 },
                iron_pickaxe: { id: 3, maxDurability: 250 },
                diamond_pickaxe: { id: 4, maxDurability: 1561 },
            },
        },
    };
    const stone = {
        name: 'stone',
        canHarvest: type => [1, 2, 3, 4].includes(type),
    };

    const assessment = assessMiningRouteDurability(bot, Array(5).fill(stone));

    assert.equal(assessment.ok, false);
    assert.equal(assessment.outcome, 'insufficient_tool_durability');
    assert.equal(assessment.replacementTool, 'stone_pickaxe');
    assert.equal(assessment.minimumUsableDurability, 3);
});

test('ordinary hand-harvestable collection does not consume a tied durable tool', () => {
    const ironPick = {
        name: 'iron_pickaxe',
        type: 1,
        slot: 10,
        maxDurability: 250,
        durabilityUsed: 12,
    };
    const dirt = { name: 'dirt', type: 2, slot: 11 };
    const bot = {
        inventory: {
            items: () => [ironPick, dirt],
            emptySlotCount: () => 0,
        },
        registry: { items: { 1: { maxDurability: 250 }, 2: {} }, itemsByName: {} },
        tool: {
            getDigTime: () => 10,
        },
    };
    const sand = {
        name: 'sand',
        canHarvest: () => true,
    };

    assert.deepEqual(selectCollectionTool(bot, sand), { kind: 'item', item: dirt, digTime: 10 });
});

test('dropped-item pursuit preserves a native adjacent approach for the exact cavity geometry', () => {
    const entity = { position: new Vec3(-379.0625, 66, -39.875), isValid: true };
    const goal = createDroppedItemPickupGoal(entity);

    // The adjacent node is the only reachable block stance in this cavity.
    // CollectBlock must retain it for native routing, then settle the remaining
    // sub-block distance before it may report the item picked up.
    assert.equal(goal.isEnd(new Vec3(-381, 66, -40)), true);
    assert.equal(goal.isEnd(new Vec3(-380, 66, -40)), true);
    assert.equal(goal.isEnd(new Vec3(-378, 66, -40)), false);
});

test('CollectBlock retains the exact mined drop after it falls below the source voxel', () => {
    const block = {
        position: new Vec3(2530, 71, 2864),
        drops: [14],
    };
    const fallingCobblestone = {
        name: 'item',
        position: new Vec3(2530.62, 69.4, 2864.38),
        getDroppedItem: () => ({ type: 14, name: 'cobblestone' }),
    };
    const unrelatedItem = {
        ...fallingCobblestone,
        getDroppedItem: () => ({ type: 15, name: 'dirt' }),
    };

    assert.equal(isDropFromMinedBlock(block, fallingCobblestone), true);
    assert.equal(isDropFromMinedBlock(block, unrelatedItem), false);
});

test('CollectBlock cancellation waits for its active lease after the target queue becomes empty', async () => {
    const bot = new EventEmitter();
    let stoppedGoal = false;
    let stoppedDigging = false;
    const stopFailure = new Error('dig cleanup failed');
    bot.pathfinder = { setGoal(goal) { stoppedGoal = goal === null; } };
    bot.stopDigging = () => {
        stoppedDigging = true;
        return Promise.reject(stopFailure);
    };

    const collector = Object.create(CollectBlock.prototype);
    collector.bot = bot;
    collector.targets = { empty: true, clear() {} };
    let settleLease;
    collector.activeTask = {
        generation: 7,
        cancelRequested: false,
        settled: new Promise(resolve => { settleLease = resolve; }),
    };

    let cancellationReturned = false;
    let cancellationError = null;
    const cancellation = collector.cancelTask().catch(error => {
        cancellationError = error;
        cancellationReturned = true;
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(cancellationReturned, false);
    assert.equal(collector.activeTask.cancelRequested, true);
    assert.equal(stoppedGoal, true);
    assert.equal(stoppedDigging, true);

    settleLease();
    await cancellation;
    assert.equal(cancellationReturned, true);
    assert.equal(cancellationError, stopFailure);
});

test('CollectBlock approach never starts breaking the exact interaction target', async () => {
    class Block {
        constructor() {
            this.name = 'acacia_log';
            this.type = 17;
            this.position = new Vec3(1, 0, 0);
            this.drops = [];
        }

        canHarvest() {
            return true;
        }
    }

    const bot = new EventEmitter();
    const target = new Block();
    let liveTarget = target;
    let approachDigStarts = 0;
    let explicitDigStarts = 0;
    let activeMovements = null;
    const movements = {
        exclusionAreasBreak: [],
        safeToBreak(block) {
            return this.exclusionAreasBreak.reduce((cost, exclusion) => cost + exclusion(block), 0) < 100;
        },
    };
    bot.entity = { position: new Vec3(0, 0, 0) };
    bot.registry = minecraftData('1.21.11');
    bot.entities = {};
    bot.inventory = {
        items: () => [],
        emptySlotCount: () => 1,
    };
    bot.heldItem = null;
    bot.world = {};
    bot.blockAt = () => liveTarget;
    bot.unequip = () => Promise.resolve();
    bot.stopDigging = () => Promise.resolve();
    bot.dig = () => {
        explicitDigStarts += 1;
        liveTarget = { name: 'air', type: 0, position: target.position };
        setTimeout(() => {
            for (let tick = 0; tick < 10; tick += 1) bot.emit('physicsTick');
        }, 0);
        return Promise.resolve();
    };
    bot.tool = {
        getDigTime: () => 100,
        equipForBlock: () => Promise.resolve(),
    };
    bot.pathfinder = {
        movements,
        setMovements(next) {
            activeMovements = next;
            this.movements = next;
        },
        setGoal() {},
        goto() {
            if (activeMovements.safeToBreak(target)) {
                // Model Pathfinder beginning the route excavation and then
                // settling its approach without completing that block. The
                // explicit miner must be the only owner allowed to start it.
                approachDigStarts += 1;
            }
            return Promise.resolve();
        },
    };

    const collector = new CollectBlock(bot);
    collector.movements = movements;
    await collector.collect(target);

    assert.equal(approachDigStarts, 0);
    assert.equal(explicitDigStarts, 1);
    assert.equal(movements.exclusionAreasBreak.length, 0);

    liveTarget = target;
    bot.pathfinder.goto = () => Promise.reject(new Error('route failed'));
    await assert.rejects(collector.collect(target), /route failed/);
    assert.equal(movements.exclusionAreasBreak.length, 0);
});

test('deep mining corridor search binds a supported multi-bend route around rejected cells', () => {
    const origin = new Vec3(0, 4, 0);
    const stance = new Vec3(4, 2, 0);
    const allowed = [
        new Vec3(1, 4, 0),
        new Vec3(1, 3, 1),
        new Vec3(2, 3, 1),
        new Vec3(2, 3, 2),
        new Vec3(3, 2, 2),
        new Vec3(4, 2, 2),
        new Vec3(4, 2, 1),
        stance,
    ];
    const allowedKeys = new Set(allowed.map(key));
    const search = searchSupportedMiningVoxelCorridors({
        origin,
        stances: [stance],
        maxRouteSteps: 10,
        maxExcavationBlocks: 96,
        maxExpansions: 1_000,
        maxSolutions: 4,
        assessStep: step => allowedKeys.has(key(step.position))
            ? {
                ok: true,
                outcome: 'route_step_safe',
                blocks: [
                    { position: step.position },
                    { position: step.position.offset(0, 1, 0) },
                    ...(step.yOffset < 0
                        ? [{ position: step.position.offset(0, 2, 0) }]
                        : []),
                ],
            }
            : { ok: false, outcome: 'non_natural_block_in_route', blocks: [] },
    });

    assert.equal(search.expansionLimitReached, false);
    assert.ok(search.solutions.length >= 1);
    const route = search.solutions[0].route;
    assert.deepEqual(route.map(step => step.position), allowed);
    assert.ok(route.every(step => (
        Math.abs(step.heading.x) + Math.abs(step.heading.z) === 1
        && [-1, 0].includes(step.yOffset)
    )));
    const headingChanges = route.slice(1).filter((step, index) => (
        step.heading.x !== route[index].heading.x
        || step.heading.z !== route[index].heading.z
    )).length;
    assert.ok(headingChanges >= 4);

    const requiredSupports = new Set([
        key(origin.offset(0, -1, 0)),
        ...route.map(step => key(step.position.offset(0, -1, 0))),
    ]);
    const excavation = route.flatMap(step => [
        step.position,
        step.position.offset(0, 1, 0),
        ...(step.yOffset < 0 ? [step.position.offset(0, 2, 0)] : []),
    ]);
    assert.equal(
        excavation.some(position => requiredSupports.has(key(position))),
        false,
    );
});

test('an over-deadline corridor advances the shortest safe prefix that makes the remainder viable', () => {
    const route = Array.from({ length: 10 }, (_, index) => ({
        position: new Vec3(index + 1, 64 - index, 0),
        heading: { x: 1, z: 0 },
        yOffset: index === 0 ? 0 : -1,
    }));
    const stepExcavationBlocks = route.map(step => [{ position: step.position.clone() }]);
    const prefix = selectMiningDeadlinePrefix({
        ok: false,
        outcome: 'route_deadline_insufficient',
        origin: new Vec3(0, 64, 0),
        stance: route.at(-1).position,
        route,
        excavationBlocks: stepExcavationBlocks.flat(),
        excavationBudget: stepExcavationBlocks.length,
        stepExcavationBlocks,
        stepEstimatedDigMs: Array(route.length).fill(500),
        estimatedTargetDigMs: 500,
    }, 15_000);

    assert.ok(prefix);
    assert.equal(prefix.route.length, 7);
    assert.equal(prefix.partial, true);
    assert.equal(prefix.breakTarget, false);
    assert.ok(
        prefix.prefix.estimatedPostRouteRequiredMs
        <= prefix.prefix.estimatedPostRemainingMs,
    );
});

test('a distant exact mining stance binds only bounded intermediate cells with strict remaining-distance progress', () => {
    const origin = new Vec3(0, 54, 0);
    const finalStance = new Vec3(8, 20, 0);
    const selected = selectBoundedMiningProgressStances({
        origin,
        finalStances: [finalStance],
        candidates: [
            new Vec3(-4, 48, 0),
            new Vec3(4, 48, 0),
            new Vec3(8, 40, 0),
            new Vec3(12, 42, 0),
        ],
        maxRouteSteps: 12,
        minProgress: 2,
        maxStances: 4,
    });

    assert.deepEqual(
        selected.map(candidate => candidate.stance),
        [new Vec3(12, 42, 0), new Vec3(-4, 48, 0), new Vec3(4, 48, 0)],
    );
    assert.ok(selected.every(candidate => (
        candidate.legSteps <= 12
        && candidate.progress >= 2
        && candidate.remainingSteps < 34
    )));
});
