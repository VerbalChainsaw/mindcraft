import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { Vec3 } from 'vec3';

import collectBlockRuntime from '../packages/minecraft-runtime/mineflayer-collectblock/lib/index.js';
import {
    selectMiningDeadlinePrefix,
    selectMiningRouteTool,
} from '../src/agent/library/skills.js';

const { CollectBlock, createDroppedItemPickupGoal, selectCollectionTool } = collectBlockRuntime;
import {
    searchSupportedMiningVoxelCorridors,
    selectBoundedMiningProgressStances,
} from '../src/agent/runtime/mining-corridor-planner.js';

const key = position => `${position.x}:${position.y}:${position.z}`;

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
