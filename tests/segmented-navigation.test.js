import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import Vec3 from 'vec3';

import { ActionManager } from '../src/agent/action_manager.js';
import {
    attemptLocalNavigationEgress,
    attemptSegmentedFollowRecovery,
    breakBlockAt,
    continuousFollowLiveness,
    goToGoal,
    goToMiningDepth,
    goToPlayer,
    goToPosition,
    mineSearchTunnel,
    followPlayer,
    localNavigationEgressPlan,
    observeFollowDestinationProgress,
    recoverDeathItems,
    segmentJourneyDestination,
    segmentWaypointCandidates,
    segmentWaypointSelection,
} from '../src/agent/library/skills.js';

const require = createRequire(import.meta.url);
const mcData = require('minecraft-data')('1.21.11');
const Block = require('prismarine-block')('1.21.11');
const pf = require('mineflayer-pathfinder');

// Live seam campaign 2026-08-15: death-item recovery failed
// `skill_death_position_unreachable` with a Pathfinder decision timeout over a
// 122-block return. The approved segmented-navigation contract lets a journey
// proceed as individually route-proven segments, but only over ordinary level
// supported ground: drops, water, and hazards require a reverse-route proof
// this layer deliberately does not attempt.

function worldBot({
    solidBelow = true,
    supportName = 'stone',
    anchorName = 'stone',
    liquidAt = () => false,
    hazardAt = () => false,
    loaded = () => true,
} = {}) {
    return {
        entity: { position: new Vec3(0.5, 70, 0.5) },
        blockAt(position) {
            if (!loaded(position)) return null;
            if (position.y === 69) {
                return solidBelow
                    ? { name: supportName, boundingBox: 'block', position: position.clone() }
                    : { name: 'air', boundingBox: 'empty', position: position.clone() };
            }
            if (position.y === 68 && solidBelow && supportName === 'sand') {
                return {
                    name: anchorName,
                    boundingBox: anchorName === 'air' ? 'empty' : 'block',
                    position: position.clone(),
                };
            }
            if (liquidAt(position)) return { name: 'water', boundingBox: 'empty', position: position.clone() };
            if (hazardAt(position)) return { name: 'lava', boundingBox: 'empty', position: position.clone() };
            return { name: 'air', boundingBox: 'empty', position: position.clone() };
        },
    };
}

function routeTarget(goal) {
    const target = Array.isArray(goal?.goals) ? goal.goals[0] : goal;
    if (target?.entity?.position) return target.entity.position.floored();
    return [target?.x, target?.y, target?.z].every(Number.isFinite)
        ? new Vec3(target.x, target.y, target.z)
        : null;
}

function nativeJourneyBot({
    reverseRoute = true,
    loseSupportAfterMove = false,
    finalDestinationX = 50,
    directRouteFromX = 19,
    candidateRouteStatus = 'success',
} = {}) {
    const gotoTargets = [];
    const routeCalls = [];
    const executionPolicies = [];
    let moved = false;
    const bot = {
        version: '1.21.11',
        registry: mcData,
        interrupt_code: false,
        output: '',
        health: 20,
        controlState: {},
        game: { dimension: 'overworld' },
        entities: {},
        inventory: { slots: [] },
        entity: {
            position: new Vec3(0.5, 70, 0.5),
            width: 0.6,
            height: 1.8,
            isInWater: false,
        },
        modes: { isOn: () => false },
        pathfinder: {
            thinkTimeout: 500,
            tickTimeout: 40,
            setMovements(movements) {
                executionPolicies.push(movements);
            },
            setGoal() {},
            getLastStuckState() { return null; },
            getPathFromTo(movements, start, goal, options) {
                const target = routeTarget(goal);
                routeCalls.push({
                    movements,
                    start: start.clone(),
                    target: target?.clone() || null,
                    timeout: options?.timeout ?? null,
                });
                const isFinalDestination = target?.x === finalDestinationX
                    && target?.y === 70
                    && target?.z === 0;
                const isLongFinalRoute = isFinalDestination && start.x < directRouteFromX;
                const current = bot.entity.position.floored();
                const isForwardCandidate = !isFinalDestination
                    && Math.floor(start.x) === current.x
                    && Math.floor(start.y) === current.y
                    && Math.floor(start.z) === current.z;
                const isRejectedReverse = !reverseRoute
                    && target?.x === current.x
                    && target?.y === current.y
                    && target?.z === current.z
                    && (
                        start.x !== current.x
                        || start.y !== current.y
                        || start.z !== current.z
                    );
                const status = isLongFinalRoute || isRejectedReverse
                    ? 'noPath'
                    : isForwardCandidate
                        ? candidateRouteStatus
                        : 'success';
                return (function * nativeRoute() {
                    yield {
                        result: {
                            status,
                            path: status === 'success' && target ? [target.clone()] : [],
                        },
                    };
                }());
            },
            goto(goal) {
                const target = routeTarget(goal);
                assert.ok(target);
                gotoTargets.push(target.clone());
                bot.entity.position = target.clone();
                moved = true;
                return Promise.resolve();
            },
        },
        on() {},
        off() {},
        removeListener() {},
        clearControlStates() {},
        blockAt(position) {
            const supportLost = loseSupportAfterMove && moved && position.x >= 5;
            const name = position.y < 70 && !supportLost ? 'stone' : 'air';
            const block = new Block(mcData.blocksByName[name].id, 0, 0);
            block.position = position.clone();
            return block;
        },
    };
    return { bot, executionPolicies, gotoTargets, routeCalls };
}

function miningRelocationProbeBot(routeStatus = 'timeout') {
    const routeCalls = [];
    const gotoTargets = [];
    const dug = [];
    const supportLevels = new Set([69, 73, 76, 79, 82]);
    const bot = {
        version: '1.21.11',
        registry: mcData,
        interrupt_code: false,
        output: '',
        health: 20,
        controlState: {},
        game: { dimension: 'overworld', minY: -64, height: 384 },
        entities: {},
        inventory: { slots: [] },
        entity: {
            position: new Vec3(0.5, 70, 0.5),
            width: 0.6,
            height: 1.8,
            isInWater: false,
        },
        modes: { isOn: () => false },
        pathfinder: {
            thinkTimeout: 500,
            tickTimeout: 40,
            setMovements() {},
            setGoal() {},
            getPathFromTo(movements, start, goal, options) {
                const target = routeTarget(goal);
                routeCalls.push({
                    start: start.clone(),
                    target: target?.clone() || null,
                    timeout: options?.timeout ?? null,
                });
                return (function * routeProbe() {
                    yield {
                        result: {
                            status: routeStatus,
                            path: routeStatus === 'success' && target ? [target.clone()] : [],
                        },
                    };
                }());
            },
            goto(goal) {
                const target = routeTarget(goal);
                gotoTargets.push(target?.clone() || null);
                return Promise.resolve();
            },
        },
        on() {},
        off() {},
        removeListener() {},
        clearControlStates() {},
        blockAt(position) {
            const name = supportLevels.has(Math.floor(position.y)) ? 'stone' : 'air';
            const block = new Block(mcData.blocksByName[name].id, 0, 0);
            block.position = position.clone();
            return block;
        },
        dig(block) {
            dug.push(block.position.clone());
            return Promise.resolve();
        },
    };
    return { bot, dug, gotoTargets, routeCalls };
}

function miningStagingProbeBot(routeStatus = 'timeout') {
    const routeCalls = [];
    const gotoTargets = [];
    const targetPosition = new Vec3(20, 70, 0);
    const bot = {
        version: '1.21.11',
        registry: mcData,
        interrupt_code: false,
        output: '',
        health: 20,
        controlState: {},
        game: { dimension: 'overworld', minY: -64, height: 384 },
        entities: {},
        inventory: { slots: [] },
        entity: {
            position: new Vec3(0.5, 70, 0.5),
            width: 0.6,
            height: 1.8,
            isInWater: false,
        },
        modes: { isOn: () => false },
        pathfinder: {
            thinkTimeout: 500,
            tickTimeout: 40,
            setMovements() {},
            setGoal() {},
            getPathFromTo(movements, start, goal, options) {
                const target = routeTarget(goal);
                routeCalls.push({
                    start: start.clone(),
                    target: target?.clone() || null,
                    timeout: options?.timeout ?? null,
                });
                return (function * routeProbe() {
                    yield {
                        result: {
                            status: routeStatus,
                            path: routeStatus === 'success' && target ? [target.clone()] : [],
                        },
                    };
                }());
            },
            goto(goal) {
                const target = routeTarget(goal);
                gotoTargets.push(target?.clone() || null);
                return Promise.resolve();
            },
        },
        on() {},
        off() {},
        removeListener() {},
        clearControlStates() {},
        blockAt(position) {
            const x = Math.floor(position.x);
            const y = Math.floor(position.y);
            const z = Math.floor(position.z);
            const name = x === targetPosition.x && y === targetPosition.y && z === targetPosition.z
                ? 'iron_ore'
                : y === 69
                    ? 'stone'
                    : 'air';
            const block = new Block(mcData.blocksByName[name].id, 0, 0);
            block.position = position.clone();
            return block;
        },
    };
    return {
        bot,
        gotoTargets,
        routeCalls,
        target: bot.blockAt(targetPosition),
    };
}

function enclosedNavigationBot({
    material = 'dirt',
    liquidOutside = false,
    enclosed = true,
    protectedSite = false,
} = {}) {
    const cleared = new Set();
    const dug = [];
    const routeCalls = [];
    const wallCells = new Set();
    const faces = enclosed ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[1, 0]];
    for (const [dx, dz] of faces) {
        wallCells.add(`${dx}:70:${dz}`);
        wallCells.add(`${dx}:71:${dz}`);
    }
    const bot = {
        version: '1.21.11',
        registry: mcData,
        interrupt_code: false,
        output: '',
        health: 20,
        traversalPolicy: 'careful',
        heldItem: null,
        controlState: {},
        game: { dimension: 'overworld', gameMode: 'survival' },
        entities: {},
        inventory: { slots: [] },
        entity: {
            position: new Vec3(0.5, 70, 0.5),
            width: 0.6,
            height: 1.8,
            isInWater: false,
        },
        modes: { isOn: () => false },
        pathfinder: {
            thinkTimeout: 500,
            tickTimeout: 40,
            setMovements() {},
            setGoal() {},
            getLastStuckState() { return null; },
            getPathFromTo(movements, start, goal, options) {
                const target = routeTarget(goal);
                routeCalls.push({ start: start.clone(), target: target?.clone() || null, timeout: options?.timeout });
                const positiveExitOpen = cleared.has('1:70:0') && cleared.has('1:71:0');
                const status = positiveExitOpen ? 'success' : 'noPath';
                return (function * route() {
                    yield { result: { status, path: status === 'success' && target ? [target.clone()] : [] } };
                }());
            },
            goto(goal) {
                const target = routeTarget(goal);
                bot.entity.position = target.clone();
                return Promise.resolve();
            },
        },
        on() {},
        removeListener() {},
        clearControlStates() {},
        blockAt(position) {
            const key = `${position.x}:${position.y}:${position.z}`;
            let name = 'air';
            if (position.y === 69) name = 'stone';
            if (wallCells.has(key) && !cleared.has(key)) name = material;
            if (protectedSite && position.x === 0 && position.y === 70 && position.z === 2) {
                name = 'oak_planks';
            }
            if (liquidOutside && (
                (Math.abs(position.x) === 2 && position.z === 0)
                || (Math.abs(position.z) === 2 && position.x === 0)
            ) && (position.y === 70 || position.y === 71)) name = 'water';
            const block = new Block(mcData.blocksByName[name].id, 0, 0);
            block.position = position.clone();
            return block;
        },
        dig(block) {
            const key = `${block.position.x}:${block.position.y}:${block.position.z}`;
            dug.push(key);
            cleared.add(key);
        },
    };
    return { bot, cleared, dug, routeCalls };
}

function detourJourneyBot({ directAfterDetour = true } = {}) {
    const gotoTargets = [];
    const routeCalls = [];
    const executionPolicies = [];
    const bot = {
        version: '1.21.11',
        registry: mcData,
        interrupt_code: false,
        output: '',
        health: 20,
        controlState: {},
        game: { dimension: 'overworld' },
        entities: {},
        inventory: { slots: [] },
        entity: {
            position: new Vec3(0.5, 70, 0.5),
            width: 0.6,
            height: 1.8,
            isInWater: false,
        },
        modes: { isOn: () => false },
        pathfinder: {
            thinkTimeout: 500,
            tickTimeout: 40,
            setMovements(movements) {
                executionPolicies.push(movements);
            },
            setGoal() {},
            getLastStuckState() { return null; },
            getPathFromTo(movements, start, goal) {
                const target = routeTarget(goal);
                routeCalls.push({ movements, start: start.clone(), target: target?.clone() || null });
                const finalFromOrigin = target?.x === 50
                    && target?.z === 0
                    && start.x < 1
                    && start.z < 1;
                const finalAfterDetour = target?.x === 50 && target?.z === 0 && start.z >= 19;
                const status = finalFromOrigin || (finalAfterDetour && !directAfterDetour)
                    ? 'noPath'
                    : 'success';
                return (function * nativeRoute() {
                    yield {
                        result: {
                            status,
                            path: status === 'success' && target ? [target.clone()] : [],
                        },
                    };
                }());
            },
            goto(goal) {
                const target = routeTarget(goal);
                assert.ok(target);
                gotoTargets.push(target.clone());
                bot.entity.position = target.clone();
                return Promise.resolve();
            },
        },
        on() {},
        removeListener() {},
        clearControlStates() {},
        blockAt(position) {
            const supported = position.y === 69 && (
                (position.x === 0 && position.z === 0)
                || (position.x === 0 && position.z === 20)
                || (position.x === 50 && position.z === 0)
            );
            const name = supported ? 'stone' : 'air';
            const block = new Block(mcData.blocksByName[name].id, 0, 0);
            block.position = position.clone();
            return block;
        },
    };
    return { bot, executionPolicies, gotoTargets, routeCalls };
}

function verticalEgressJourneyBot() {
    const gotoTargets = [];
    const routeCalls = [];
    const bot = {
        version: '1.21.11',
        registry: mcData,
        interrupt_code: false,
        output: '',
        health: 20,
        controlState: {},
        game: { dimension: 'overworld' },
        entities: {},
        inventory: { slots: [] },
        entity: {
            position: new Vec3(0.5, 66, 0.5),
            width: 0.6,
            height: 1.8,
            isInWater: false,
        },
        modes: { isOn: () => false },
        pathfinder: {
            thinkTimeout: 500,
            tickTimeout: 40,
            setMovements() {},
            setGoal() {},
            getLastStuckState() { return null; },
            getPathFromTo(movements, start, goal) {
                const target = routeTarget(goal);
                routeCalls.push({ start: start.clone(), target: target?.clone() || null });
                // The destination is directly above a cave ceiling. Native
                // Pathfinder cannot route through the ceiling, but it can use
                // the existing cave exit to reach a nearby surface stance.
                const throughCeiling = target?.x === 0
                    && target?.y === 71
                    && target?.z === 0
                    && start.y < 70;
                const status = throughCeiling ? 'noPath' : 'success';
                return (function * nativeRoute() {
                    yield {
                        result: {
                            status,
                            path: status === 'success' && target ? [target.clone()] : [],
                        },
                    };
                }());
            },
            goto(goal) {
                const target = routeTarget(goal);
                assert.ok(target);
                gotoTargets.push(target.clone());
                bot.entity.position = target.clone();
                return Promise.resolve();
            },
        },
        on() {},
        removeListener() {},
        clearControlStates() {},
        blockAt(position) {
            const name = position.y === 65 || position.y === 70 ? 'stone' : 'air';
            const block = new Block(mcData.blocksByName[name].id, 0, 0);
            block.position = position.clone();
            return block;
        },
    };
    return { bot, gotoTargets, routeCalls };
}

function overheadDeathDropBot({ obstruction = null } = {}) {
    const cleared = [];
    const leafCells = new Set(['0:68:0', '0:70:0']);
    const itemEntity = {
        id: 41,
        name: 'item',
        position: new Vec3(0.5, 72.1, 0.5),
        getDroppedItem: () => ({ name: 'dirt', count: 1 }),
    };
    const { bot } = verticalEgressJourneyBot();
    // Natural drops can scatter across a canopy. The owning affordance may
    // bind the exact stack anywhere inside the existing pickup envelope; the
    // injected break mechanic represents its short native approach.
    bot.entity.position = new Vec3(-5.5, 66, 0.5);
    bot.entities = { 41: itemEntity };
    bot.blockAt = (position) => {
        const key = `${position.x}:${position.y}:${position.z}`;
        let name = 'air';
        if (position.y === 65) name = 'grass_block';
        if (leafCells.has(key)) name = 'acacia_leaves';
        if (obstruction && position.y === obstruction.y) name = obstruction.name;
        const block = new Block(mcData.blocksByName[name].id, 0, 0);
        block.position = position.clone();
        return block;
    };
    const breakBlock = (subject, x, y, z) => {
        const key = `${x}:${y}:${z}`;
        assert.equal(subject, bot);
        assert.equal(leafCells.has(key), true);
        subject.output += 'Broke a leaf during an intermediate access step.\n';
        leafCells.delete(key);
        cleared.push({ x, y, z });
        if (leafCells.size === 0) itemEntity.position = new Vec3(0.5, 66.25, 0.5);
        return Promise.resolve(true);
    };
    const pickupItems = () => {
        bot.output += 'No nearby items remained after automatic pickup.\n';
        bot.inventory.slots.push({ name: 'dirt', count: 1 });
        delete bot.entities[41];
        return Promise.resolve(true);
    };
    return { bot, breakBlock, cleared, pickupItems };
}

function blockBreakBot({ correctedByServer = false } = {}) {
    const position = new Vec3(0, 70, 0);
    const leaf = new Block(mcData.blocksByName.acacia_leaves.id, 0, 0);
    leaf.position = position.clone();
    const air = new Block(mcData.blocksByName.air.id, 0, 0);
    air.position = position.clone();
    const digCalls = [];
    let digAt = 0;
    const bot = {
        version: '1.21.11',
        registry: mcData,
        interrupt_code: false,
        output: '',
        heldItem: null,
        entity: { position: new Vec3(0.5, 66, 0.5) },
        game: { gameMode: 'survival' },
        inventory: { items: () => [], slots: [] },
        modes: { isOn: () => false },
        tool: { equipForBlock: () => Promise.resolve() },
        blockAt() {
            if (!digAt) return leaf;
            if (correctedByServer && Date.now() - digAt >= 120) return leaf;
            return air;
        },
        dig(block, forceLook, digFace) {
            digCalls.push({ block, forceLook, digFace });
            digAt = Date.now();
            return Promise.resolve();
        },
    };
    return { bot, digCalls };
}

test('shared block breaking delegates visible-face selection to Mineflayer raycast', async () => {
    const { bot, digCalls } = blockBreakBot();

    const broken = await breakBlockAt(bot, 0, 70, 0, { requireHarvest: false });

    assert.equal(broken, true);
    assert.equal(digCalls.length, 1);
    assert.equal(digCalls[0].forceLook, true);
    assert.equal(digCalls[0].digFace, 'raycast');
    assert.equal(bot.lastActionEvidence.outcome, 'broken');
});

test('shared block breaking rejects Mineflayer optimistic air corrected by Paper', async () => {
    const { bot, digCalls } = blockBreakBot({ correctedByServer: true });

    const broken = await breakBlockAt(bot, 0, 70, 0, { requireHarvest: false });

    assert.equal(broken, false);
    assert.equal(digCalls.length, 1);
    assert.equal(bot.lastActionEvidence.outcome, 'not_broken');
});

test('a destination is extracted from coordinate goals and from a followed entity', () => {
    assert.deepEqual(segmentJourneyDestination({ x: 10, y: 64, z: -3 }), { x: 10, y: 64, z: -3 });
    assert.deepEqual(
        segmentJourneyDestination({ entity: { position: { x: -5, y: 70, z: 8 } } }),
        { x: -5, y: 70, z: 8 },
    );
    assert.equal(segmentJourneyDestination(null), null);
    assert.equal(segmentJourneyDestination({}), null);
});

test('waypoints order direct progress before bounded lateral detour options', () => {
    const bot = worldBot();
    const candidates = segmentWaypointCandidates(bot, { x: 120, y: 70, z: 0 });

    assert.ok(candidates.length > 0);
    assert.ok(candidates[0].remaining < 120);
    assert.ok(candidates.some(candidate => candidate.remaining >= 120));
    // Best-first ordering lets the journey prefer direct progress and consult
    // lateral options only when the direct set is unavailable or exhausted.
    for (let i = 1; i < candidates.length; i += 1) {
        assert.ok(candidates[i - 1].remaining <= candidates[i].remaining);
    }
    // Elevation stays within ordinary level movement.
    for (const candidate of candidates) assert.ok(Math.abs(candidate.y - 70) <= 1);
});

test('unsupported ground yields no waypoint rather than a hopeful step', () => {
    const bot = worldBot({ solidBelow: false });
    assert.deepEqual(segmentWaypointCandidates(bot, { x: 120, y: 70, z: 0 }), []);
});

test('anchored beach sand is walkable but unanchored falling support remains refused', () => {
    const anchored = segmentWaypointCandidates(
        worldBot({ supportName: 'sand', anchorName: 'sandstone' }),
        { x: 120, y: 70, z: 0 },
    );
    const unanchored = segmentWaypointCandidates(
        worldBot({ supportName: 'sand', anchorName: 'air' }),
        { x: 120, y: 70, z: 0 },
    );

    assert.ok(anchored.length > 0);
    assert.deepEqual(unanchored, []);
});

test('waypoint selection reacquires a loaded surface up to four blocks above the origin', () => {
    const bot = {
        entity: { position: new Vec3(0.5, 70, 0.5) },
        blockAt(position) {
            return position.y === 73
                ? { name: 'stone', boundingBox: 'block' }
                : { name: 'air', boundingBox: 'empty' };
        },
    };

    const candidates = segmentWaypointCandidates(bot, { x: 40, y: 74, z: 0 });

    assert.ok(candidates.length > 0);
    assert.ok(candidates.some(candidate => candidate.y === 74));
});

test('horizontal alignment below a ceiling searches nearby destination-level egress stances', () => {
    const { bot } = verticalEgressJourneyBot();

    const selection = segmentWaypointSelection(bot, { x: 0, y: 71, z: 0 });

    assert.equal(selection.code, 'vertical_egress_candidates_available');
    assert.ok(selection.candidates.some(candidate => (
        candidate.y === 71
        && candidate.remaining < 2
    )));
});

test('waypoint selection reports bounded reasons when no surface is admissible', () => {
    const selection = segmentWaypointSelection(
        worldBot({ solidBelow: false }),
        { x: 120, y: 70, z: 0 },
    );

    assert.equal(selection.code, 'no_safe_waypoint');
    assert.equal(selection.candidates.length, 0);
    assert.ok(selection.inspected > 0);
    assert.ok(selection.rejectionCounts.unsupported > 0);
    assert.equal(Object.isFrozen(selection), true);
    assert.equal(Object.isFrozen(selection.rejectionCounts), true);
    assert.equal(Object.isFrozen(selection.candidates), true);
});

test('water on the route is refused because it would need a reverse-route proof', () => {
    const bot = worldBot({ liquidAt: position => position.y >= 70 });
    assert.deepEqual(segmentWaypointCandidates(bot, { x: 120, y: 70, z: 0 }), []);
});

test('a hazard at the endpoint is refused', () => {
    const bot = worldBot({ hazardAt: position => position.y >= 70 });
    assert.deepEqual(segmentWaypointCandidates(bot, { x: 120, y: 70, z: 0 }), []);
});

test('unloaded terrain is unknown, not walkable', () => {
    const bot = worldBot({ loaded: position => position.y === 69 });
    assert.deepEqual(segmentWaypointCandidates(bot, { x: 120, y: 70, z: 0 }), []);
});

test('a destination already underfoot produces no segments', () => {
    const bot = worldBot();
    assert.deepEqual(segmentWaypointCandidates(bot, { x: 0, y: 70, z: 0 }), []);
});

test('a failed long proof converges through complete native segments and preserves receipts', async () => {
    const { bot, executionPolicies, gotoTargets, routeCalls } = nativeJourneyBot();

    const arrived = await goToPosition(bot, 50, 70, 0, 2, {
        allowSegmentedJourney: true,
    });

    assert.equal(arrived, true);
    assert.deepEqual(gotoTargets.map(position => position.x), [20, 50]);
    assert.equal(bot.lastActionEvidence.outcome, 'arrived');
    assert.deepEqual(bot.lastActionEvidence.finalDestination, { x: 50, y: 70, z: 0 });
    assert.equal(bot.lastActionEvidence.segments.length, 1);
    assert.deepEqual(bot.lastActionEvidence.segments[0], {
        schemaVersion: 1,
        index: 0,
        origin: { x: 0, y: 70, z: 0 },
        waypoint: { x: 20, y: 70, z: 0 },
        finalDestination: { x: 50, y: 70, z: 0 },
        nativeRoute: {
            status: 'success',
            pathLength: 1,
            returnStatus: 'success',
            returnPathLength: 1,
        },
        safety: {
            loaded: true,
            bodyClear: true,
            supported: true,
            nonHazardous: true,
            adjacentLiquid: false,
        },
        returnability: 'native_round_trip_proved',
        expectedProgress: {
            relation: 'decrease_spatial_distance',
            minimum: 2,
            blocks: 19.5,
        },
        executionOutcome: 'arrived',
        terminal: { x: 20, y: 70, z: 0 },
        executed: true,
        progress: 19.5,
        outcome: 'progress_verified',
    });
    assert.equal(Object.isFrozen(bot.lastActionEvidence.segments), true);
    assert.equal(Object.isFrozen(bot.lastActionEvidence.segments[0]), true);
    assert.equal(Object.isFrozen(bot.lastActionEvidence.segments[0].nativeRoute), true);
    const segmentPolicy = routeCalls.find(call => call.target?.x === 20)?.movements;
    assert.ok(segmentPolicy);
    assert.ok(routeCalls.some(call => call.target?.x === 0 && call.movements === segmentPolicy));
    assert.equal(executionPolicies[0], segmentPolicy);
});

test('a progressing segmented journey is not refused after ten proven legs', async () => {
    const { bot, gotoTargets } = nativeJourneyBot({
        finalDestinationX: 250,
        directRouteFromX: 219,
    });

    const arrived = await goToPosition(bot, 250, 70, 0, 2, {
        allowSegmentedJourney: true,
    });

    assert.equal(arrived, true);
    assert.equal(gotoTargets.at(-1)?.x, 250);
    assert.ok(bot.lastActionEvidence.segments.length > 10);
    assert.deepEqual(
        bot.lastActionEvidence.segments.map(receipt => receipt.index),
        bot.lastActionEvidence.segments.map((_, index) => index),
    );
});

test('a native-proven bounded detour can clear an obstacle before exact arrival', async () => {
    const { bot, executionPolicies, gotoTargets, routeCalls } = detourJourneyBot();

    const arrived = await goToPosition(bot, 50, 70, 0, 2, {
        allowSegmentedJourney: true,
    });

    assert.equal(arrived, true);
    assert.deepEqual(gotoTargets.map(position => [position.x, position.z]), [[0, 20], [50, 0]]);
    assert.equal(bot.lastActionEvidence.outcome, 'arrived');
    assert.equal(bot.lastActionEvidence.segments.length, 1);
    const detour = bot.lastActionEvidence.segments[0];
    assert.equal(detour.expectedProgress.relation, 'bounded_obstacle_detour');
    assert.equal(detour.expectedProgress.minimumDisplacement, 2);
    assert.equal(detour.expectedProgress.maximumDistanceDebt, 8);
    assert.ok(detour.expectedProgress.blocks < 0);
    assert.equal(detour.outcome, 'detour_verified');
    assert.equal(detour.nativeRoute.status, 'success');
    assert.equal(detour.nativeRoute.returnStatus, 'success');
    const segmentPolicy = routeCalls.find(call => call.target?.x === 0 && call.target?.z === 20)?.movements;
    assert.ok(segmentPolicy);
    assert.ok(routeCalls.some(call => call.target?.x === 0 && call.target?.z === 0));
    assert.equal(executionPolicies[0], segmentPolicy);
    // Ordinary locomotion may break ordinary terrain: a companion that cannot
    // dig a dirt block cannot follow a player. Protection is the blocklist
    // below, not a global ban. See ARCHITECTURE.md.
    assert.equal(segmentPolicy.canDig, true);
    assert.equal(segmentPolicy.canPlaceBlocks, false);
});

test('a bounded detour without later journey progress settles instead of earning a retry', async () => {
    const { bot, gotoTargets } = detourJourneyBot({ directAfterDetour: false });

    const arrived = await goToPosition(bot, 50, 70, 0, 2, {
        allowSegmentedJourney: true,
    });

    assert.equal(arrived, false);
    assert.deepEqual(gotoTargets.map(position => [position.x, position.z]), [[0, 20]]);
    assert.equal(bot.lastActionEvidence.retryable, false);
    assert.equal(bot.lastActionEvidence.progressed, 0);
    assert.equal(bot.lastActionEvidence.segments.length, 1);
    assert.equal(bot.lastActionEvidence.segments[0].outcome, 'detour_verified');
});

test('player pursuit preserves the exact segmented navigation receipt in its final outcome', async () => {
    const { bot, gotoTargets } = nativeJourneyBot();
    const player = {
        id: 42,
        type: 'player',
        username: 'RouteGuide',
        position: new Vec3(50, 70, 0),
    };
    bot.username = 'Kevin';
    bot.players = {
        RouteGuide: { username: 'RouteGuide', entity: player },
    };

    const arrived = await goToPlayer(bot, 'RouteGuide', 3);

    assert.equal(arrived, true);
    assert.deepEqual(gotoTargets.map(position => position.x), [20, 50]);
    assert.equal(bot.lastActionEvidence.kind, 'movement');
    assert.equal(bot.lastActionEvidence.outcome, 'arrived');
    assert.equal(bot.lastActionEvidence.target.name, 'RouteGuide');
    assert.equal(bot.lastActionEvidence.navigation.outcome, 'arrived');
    assert.equal(bot.lastActionEvidence.navigation.segments.length, 1);
    assert.deepEqual(
        bot.lastActionEvidence.navigation.finalDestination,
        { x: 50, y: 70, z: 0 },
    );
    assert.equal(Object.isFrozen(bot.lastActionEvidence.navigation), true);
});

test('continuous follow recovery reuses segmented navigation within one absolute planning budget', async () => {
    const { bot, gotoTargets, routeCalls } = nativeJourneyBot();
    const player = {
        id: 45,
        type: 'player',
        username: 'RouteGuide',
        position: new Vec3(50, 70, 0),
    };

    const recovery = await attemptSegmentedFollowRecovery(bot, player, 3);

    assert.equal(recovery.success, true);
    assert.equal(recovery.strategy, 'segmented_follow_journey');
    assert.equal(recovery.arrived, true);
    assert.deepEqual(gotoTargets.map(position => position.x), [20, 50]);
    assert.equal(bot.lastActionEvidence.outcome, 'arrived');
    assert.equal(bot.lastActionEvidence.stage, 'follow_segmented_recovery');
    assert.equal(bot.lastActionEvidence.segments.length, 1);
    assert.ok(routeCalls.length >= 3);
    assert.ok(routeCalls.every(call => call.timeout > 0 && call.timeout <= 1_000));
    assert.equal(recovery.planningBudgetMs, 3_000);
    assert.ok(recovery.planningElapsedMs <= recovery.planningBudgetMs);
});

test('planned navigation clears one bounded natural-fill exit column before route proof', async () => {
    const { bot, dug, routeCalls } = enclosedNavigationBot();
    const goal = new pf.goals.GoalBlock(10, 70, 0);

    const plan = localNavigationEgressPlan(bot, goal);
    assert.equal(plan.code, 'local_egress_ready');
    assert.equal(plan.enclosureObserved, true);
    assert.deepEqual(plan.blocks.map(block => [block.x, block.y, block.z]), [
        [1, 71, 0],
        [1, 70, 0],
    ]);

    const arrived = await goToGoal(bot, goal, {
        requirePlannedRoute: true,
        allowSegmentedJourney: true,
    });

    assert.equal(arrived, true);
    assert.deepEqual(dug, ['1:71:0', '1:70:0']);
    assert.equal(bot.entity.position.x, 10);
    assert.ok(routeCalls.length >= 1);
    assert.equal(bot.lastActionEvidence.recovery.strategy, 'bounded_natural_egress');
    assert.equal(bot.lastActionEvidence.recovery.cleared, 2);
});

test('a failed native player route may clear one target-directed natural face without full enclosure', async () => {
    const { bot, dug } = enclosedNavigationBot({ enclosed: false });
    const goal = new pf.goals.GoalBlock(10, 70, 0);

    assert.equal(localNavigationEgressPlan(bot, goal).code, 'local_egress_not_enclosed');
    const failedRoutePlan = localNavigationEgressPlan(bot, goal, { routeUnavailable: true });
    assert.equal(failedRoutePlan.code, 'local_egress_ready');
    assert.equal(failedRoutePlan.enclosureObserved, false);

    const arrived = await goToGoal(bot, goal, {
        requirePlannedRoute: true,
        allowSegmentedJourney: true,
    });

    assert.equal(arrived, true);
    assert.deepEqual(dug, ['1:71:0', '1:70:0']);
    assert.equal(bot.lastActionEvidence.recovery.outcome, 'egress_cleared');
});

test('target-directed partial egress still refuses natural-looking blocks at a protected site', async () => {
    const { bot, dug } = enclosedNavigationBot({ enclosed: false, protectedSite: true });
    const goal = new pf.goals.GoalBlock(10, 70, 0);

    const plan = localNavigationEgressPlan(bot, goal, { routeUnavailable: true });

    assert.equal(plan.code, 'local_egress_no_authorized_face');
    assert.equal((await attemptLocalNavigationEgress(bot, goal, { routeUnavailable: true })).success, false);
    assert.deepEqual(dug, []);
});

test('local egress refuses a crafted enclosure and liquid-backed natural exits', async () => {
    const crafted = enclosedNavigationBot({ material: 'oak_planks' });
    const craftedPlan = localNavigationEgressPlan(crafted.bot, new pf.goals.GoalBlock(10, 70, 0));
    assert.equal(craftedPlan.code, 'local_egress_no_authorized_face');
    assert.equal((await attemptLocalNavigationEgress(crafted.bot)).success, false);
    assert.deepEqual(crafted.dug, []);

    const flooded = enclosedNavigationBot({ liquidOutside: true });
    const floodedPlan = localNavigationEgressPlan(flooded.bot, new pf.goals.GoalBlock(10, 70, 0));
    assert.equal(floodedPlan.code, 'local_egress_no_authorized_face');
    assert.equal((await attemptLocalNavigationEgress(flooded.bot)).success, false);
    assert.deepEqual(flooded.dug, []);
});

test('Follow may advance to a forward-proven safe frontier while generic travel remains round-trip strict', async () => {
    const followWorld = nativeJourneyBot({ reverseRoute: false });
    const player = {
        id: 45,
        type: 'player',
        username: 'RouteGuide',
        position: new Vec3(50, 70, 0),
    };

    const recovery = await attemptSegmentedFollowRecovery(followWorld.bot, player, 3);

    assert.equal(recovery.success, true);
    assert.ok(recovery.progressed >= 2);
    assert.deepEqual(followWorld.gotoTargets.map(position => position.x), [20, 50]);
    assert.ok(followWorld.bot.lastActionEvidence.segments.every(segment => (
        segment.returnability === 'safe_frontier_forward_proved'
    )));

    const genericWorld = nativeJourneyBot({ reverseRoute: false });
    const arrived = await goToPosition(genericWorld.bot, 50, 70, 0, 2, {
        allowSegmentedJourney: true,
    });
    assert.equal(arrived, false);
    assert.equal(genericWorld.gotoTargets.length, 0);
});

test('Follow progress is destination-relative: wandering does not reset recovery, approaching does', () => {
    const stalled = observeFollowDestinationProgress({
        bestDistance: 12,
        currentDistance: 12.1,
        targetMoved: false,
        noProgressMs: 2_500,
        sampleMs: 500,
    });
    assert.equal(stalled.progressed, false);
    assert.equal(stalled.noProgressMs, 3_000);
    assert.equal(stalled.bestDistance, 12);

    const approaching = observeFollowDestinationProgress({
        bestDistance: 12,
        currentDistance: 10.5,
        targetMoved: false,
        noProgressMs: 2_500,
        sampleMs: 500,
    });
    assert.equal(approaching.progressed, true);
    assert.equal(approaching.noProgressMs, 0);
    assert.equal(approaching.bestDistance, 10.5);

    const relocated = observeFollowDestinationProgress({
        bestDistance: 10.5,
        currentDistance: 18,
        targetMoved: true,
        noProgressMs: 2_500,
        sampleMs: 500,
    });
    assert.equal(relocated.progressed, true);
    assert.equal(relocated.noProgressMs, 0);
    assert.equal(relocated.bestDistance, 18);
});

test('continuous follow liveness settles after its bounded recovery budget instead of timing another unchanged retry', () => {
    assert.equal(continuousFollowLiveness({ noProgressMs: 2_999, recoveryAttempts: 2 }), 'continue');
    assert.equal(continuousFollowLiveness({ noProgressMs: 3_000, recoveryAttempts: 0 }), 'recover');
    assert.equal(continuousFollowLiveness({ noProgressMs: 3_000, recoveryAttempts: 2 }), 'wait_material_change');
    assert.equal(continuousFollowLiveness({
        noProgressMs: 0,
        recoveryAttempts: 2,
        lastRecoverySucceeded: false,
    }), 'wait_material_change');
    assert.equal(continuousFollowLiveness({
        noProgressMs: 0,
        recoveryAttempts: 2,
        lastRecoverySucceeded: true,
    }), 'continue');
});

test('an exhausted absolute planning budget starts no additional native route search', async () => {
    const { bot, routeCalls } = nativeJourneyBot();
    const arrived = await goToGoal(bot, new pf.goals.GoalBlock(50, 70, 0), {
        requirePlannedRoute: true,
        allowSegmentedJourney: true,
        planningDeadlineAt: Date.now() - 1,
    });

    assert.equal(arrived, false);
    assert.equal(routeCalls.length, 0);
    assert.equal(bot.lastActionEvidence.outcome, 'planning_deadline_exhausted');
    assert.equal(bot.lastActionEvidence.retryable, true);
});

test('planned navigation reports an inconclusive probe without claiming path not found', async () => {
    const { bot, gotoTargets } = nativeJourneyBot();
    let routeProbes = 0;
    bot.pathfinder.getPathFromTo = () => (function * timedOutRoute() {
        routeProbes += 1;
        yield { result: { status: 'timeout', path: [new Vec3(1, 70, 0)] } };
    }());

    const arrived = await goToGoal(bot, new pf.goals.GoalBlock(10, 70, 0), {
        requirePlannedRoute: true,
        allowLocalRecovery: false,
        allowSegmentedJourney: true,
    });

    assert.equal(arrived, false);
    assert.equal(gotoTargets.length, 0);
    assert.equal(routeProbes, 1);
    assert.equal(bot.lastActionEvidence.outcome, 'route_unproven');
    assert.equal(bot.lastActionEvidence.planning.status, 'timeout');
    assert.equal(bot.lastActionEvidence.planning.conclusive, false);
    assert.equal(bot.lastActionEvidence.retryable, true);
    assert.doesNotMatch(bot.output, /path not found|unreachable/i);
});

test('planned navigation keeps completed noPath terminal', async () => {
    const { bot, gotoTargets } = nativeJourneyBot();
    bot.pathfinder.getPathFromTo = () => (function * missingRoute() {
        yield { result: { status: 'noPath', path: [] } };
    }());

    const arrived = await goToGoal(bot, new pf.goals.GoalBlock(10, 70, 0), {
        requirePlannedRoute: true,
        allowLocalRecovery: false,
    });

    assert.equal(arrived, false);
    assert.equal(gotoTargets.length, 0);
    assert.equal(bot.lastActionEvidence.outcome, 'path_not_found');
    assert.equal(bot.lastActionEvidence.planning.status, 'noPath');
    assert.equal(bot.lastActionEvidence.planning.conclusive, true);
    assert.equal(bot.lastActionEvidence.retryable, true);
});

test('composed player pursuit retains nested navigation receipts beside its terminal arrival', async () => {
    const { bot, gotoTargets } = nativeJourneyBot();
    const player = {
        id: 44,
        type: 'player',
        username: 'RouteGuide',
        position: new Vec3(50, 70, 0),
    };
    bot.username = 'Kevin';
    bot.players = { RouteGuide: { username: 'RouteGuide', entity: player } };
    bot.emit = () => {};
    const agent = {
        name: 'Kevin',
        bot,
        self_prompter: { isActive: () => false },
        history: { add() {} },
        behavior_arbiter: {
            recordActionStart() {},
            recordActionRelease() {},
            recordOutcome() {},
        },
        isIdle() { return !this.actions.executing; },
        requestInterrupt() { bot.interrupt_code = true; },
        clearBotLogs() {
            bot.output = '';
            bot.interrupt_code = false;
        },
        recordActionResult() {},
    };
    agent.actions = new ActionManager(agent);

    const outcome = await agent.actions.runAction(
        'action:goToPlayer',
        () => goToPlayer(bot, 'RouteGuide', 3),
        { receiptMode: 'composed', timeout: -1 },
    );

    assert.equal(outcome.result.phase, 'succeeded');
    assert.equal(outcome.result.code, 'skill_arrived');
    assert.deepEqual(gotoTargets.map(position => position.x), [20, 50]);
    const receipt = outcome.result.evidence.skill;
    assert.equal(receipt.outcome, 'arrived');
    assert.equal(receipt.target.name, 'RouteGuide');
    assert.equal(receipt.receiptSchemaVersion, 1);
    assert.equal(receipt.source, 'action_context');
    assert.equal(receipt.contract.valid, true);
    assert.ok(receipt.children.navigation.length >= 2);
    const segmented = receipt.children.navigation.find(child => child.segments?.length === 1);
    assert.ok(segmented);
    assert.equal(segmented.outcome, 'arrived');
    assert.deepEqual(segmented.finalDestination, { x: 50, y: 70, z: 0 });
    assert.equal(Object.hasOwn(receipt, 'navigation'), false);
});

test('off-screen player pursuit segments the managed position before exact live-player reconciliation', async () => {
    const { bot, gotoTargets } = nativeJourneyBot();
    const player = {
        id: 43,
        type: 'player',
        username: 'RouteGuide',
        position: new Vec3(50, 70, 0),
    };
    bot.username = 'Kevin';
    bot.players = {};
    const nativeGoto = bot.pathfinder.goto;
    bot.pathfinder.goto = async goal => {
        await nativeGoto(goal);
        if (bot.entity.position.x >= 44) {
            bot.players.RouteGuide = { username: 'RouteGuide', entity: player };
        }
    };

    const arrived = await goToPlayer(bot, 'RouteGuide', 3, {
        locatePlayerPosition: async () => ({
            success: true,
            found: true,
            position: { x: 50, y: 70, z: 0 },
            dimension: 'minecraft:overworld',
            source: 'managed_paper',
        }),
    });

    assert.equal(arrived, true);
    assert.deepEqual(gotoTargets.map(position => position.x), [20, 50]);
    assert.equal(bot.lastActionEvidence.outcome, 'arrived');
    assert.equal(bot.lastActionEvidence.target.name, 'RouteGuide');
    assert.equal(bot.lastActionEvidence.navigation.segments.length, 1);
    assert.deepEqual(
        bot.lastActionEvidence.navigation.finalDestination,
        { x: 50, y: 70, z: 0 },
    );
    assert.deepEqual(
        bot.lastActionEvidence.navigationStages.map(stage => stage.stage),
        ['managed_player_region', 'live_player_pursuit'],
    );
    assert.equal(bot.lastActionEvidence.navigationStages[0].navigation.segments.length, 1);
    assert.equal(Object.isFrozen(bot.lastActionEvidence.navigationStages), true);
    assert.equal(Object.isFrozen(bot.lastActionEvidence.navigationStages[0]), true);
});

test('standing Follow reacquires an off-screen player through the managed position before continuous accompaniment', async () => {
    const { bot, gotoTargets } = nativeJourneyBot();
    const player = {
        id: 43,
        type: 'player',
        username: 'RouteGuide',
        position: new Vec3(50, 70, 0),
    };
    bot.username = 'Kevin';
    bot.players = {};
    bot.modes.pause = () => {};
    bot.modes.unpause = () => {};
    bot.pathfinder.stop = () => {};
    const nativeGoto = bot.pathfinder.goto;
    bot.pathfinder.goto = async goal => {
        await nativeGoto(goal);
        if (bot.entity.position.x >= 44) {
            bot.players.RouteGuide = { username: 'RouteGuide', entity: player };
        }
    };

    const followed = await followPlayer(bot, 'RouteGuide', 3, {
        locatePlayerPosition: async () => ({
            success: true,
            found: true,
            position: { x: 50, y: 70, z: 0 },
            dimension: 'minecraft:overworld',
            source: 'managed_paper',
        }),
        until: ({ distance }) => distance <= 3,
        completionDescription: 'Reacquired the managed player and settled nearby.',
    });

    assert.equal(followed, true);
    assert.deepEqual(gotoTargets.map(position => position.x), [20, 50]);
    assert.equal(bot.lastActionEvidence.outcome, 'condition_reached');
});

test('a vertically separated local destination converges through a native-routed surface stance', async () => {
    const { bot, gotoTargets, routeCalls } = verticalEgressJourneyBot();

    const arrived = await goToPosition(bot, 0, 71, 0, 2, {
        allowSegmentedJourney: true,
    });

    assert.equal(arrived, true);
    assert.equal(gotoTargets.length, 1);
    assert.equal(gotoTargets[0].y, 71);
    assert.ok(Math.hypot(gotoTargets[0].x, gotoTargets[0].z) <= 2);
    assert.ok(routeCalls.some(call => (
        call.start.y < 70
        && call.target?.x === 0
        && call.target?.y === 71
        && call.target?.z === 0
    )));
    assert.equal(bot.lastActionEvidence.outcome, 'arrived');
    assert.ok(bot.lastActionEvidence.segments.some(receipt => (
        receipt.executed === true
        && receipt.terminal?.y === 71
        && receipt.expectedProgress.relation === 'decrease_spatial_distance'
    )));
});

test('segmentation never executes a waypoint without a native reverse proof', async () => {
    const { bot, gotoTargets } = nativeJourneyBot({ reverseRoute: false });

    const arrived = await goToPosition(bot, 50, 70, 0, 2, {
        allowSegmentedJourney: true,
    });

    assert.equal(arrived, false);
    assert.equal(gotoTargets.length, 0);
    assert.equal(bot.lastActionEvidence.outcome, 'segmented_journey_route_unreachable');
    assert.equal(bot.lastActionEvidence.retryable, false);
    assert.ok(bot.lastActionEvidence.segments.length > 2);
    assert.ok(bot.lastActionEvidence.segments.every(receipt => (
        receipt.executed === false
        && receipt.outcome === 'route_unreachable'
        && receipt.nativeRoute.returnStatus === 'noPath'
    )));
});

test('unfinished segment route checks remain retryable after every candidate is examined', async () => {
    const { bot, gotoTargets } = nativeJourneyBot({ candidateRouteStatus: 'timeout' });

    const arrived = await goToPosition(bot, 50, 70, 0, 2, {
        allowSegmentedJourney: true,
        plannedRouteTimeoutMs: 1,
    });

    assert.equal(arrived, false);
    assert.equal(gotoTargets.length, 0);
    assert.equal(bot.lastActionEvidence.outcome, 'segmented_journey_route_unproven');
    assert.equal(bot.lastActionEvidence.retryable, true);
    assert.ok(bot.lastActionEvidence.segments.length > 2);
    assert.ok(bot.lastActionEvidence.segments.every(receipt => (
        receipt.executed === false
        && receipt.outcome === 'route_unproven'
        && receipt.nativeRoute.status === 'timeout'
    )));
});

test('mining relocation keeps an unfinished open-route search retryable', async () => {
    const { bot, dug, gotoTargets, routeCalls } = miningRelocationProbeBot('timeout');

    const reached = await goToMiningDepth(bot, 77, 16);

    assert.equal(reached, false);
    assert.ok(routeCalls.length > 0);
    assert.equal(gotoTargets.length, 0);
    assert.equal(dug.length, 0);
    assert.equal(bot.lastActionEvidence.kind, 'mining_relocation');
    assert.equal(bot.lastActionEvidence.outcome, 'open_cave_route_unproven');
    assert.equal(bot.lastActionEvidence.inconclusive, true);
    assert.equal(bot.lastActionEvidence.retryable, true);
});

test('mining relocation keeps completed open-route rejection conclusive', async () => {
    const { bot, dug, gotoTargets } = miningRelocationProbeBot('noPath');

    const reached = await goToMiningDepth(bot, 77, 16);

    assert.equal(reached, false);
    assert.equal(gotoTargets.length, 0);
    assert.equal(dug.length, 0);
    assert.equal(bot.lastActionEvidence.outcome, 'open_cave_unreachable');
    assert.notEqual(bot.lastActionEvidence.inconclusive, true);
    assert.equal(bot.lastActionEvidence.retryable, true);
});

test('mining relocation does not excavate when a proven open route fails to execute', async () => {
    const { bot, dug, gotoTargets } = miningRelocationProbeBot('success');

    const reached = await goToMiningDepth(bot, 77, 16);

    assert.equal(reached, false);
    assert.ok(gotoTargets.length > 0);
    assert.equal(dug.length, 0);
    assert.equal(bot.lastActionEvidence.outcome, 'open_route_execution_unfinished');
    assert.equal(bot.lastActionEvidence.returnable, true);
    assert.equal(bot.lastActionEvidence.retryable, true);
});

test('mining staging does not call an unfinished surface route unreachable', async () => {
    const { bot, gotoTargets, routeCalls, target } = miningStagingProbeBot('timeout');

    const reached = await mineSearchTunnel(bot, 'iron_ore', 12, target);

    assert.equal(reached, false);
    assert.ok(routeCalls.length > 0);
    assert.equal(gotoTargets.length, 0);
    assert.equal(bot.lastActionEvidence.kind, 'mining_search');
    assert.equal(bot.lastActionEvidence.outcome, 'staging_route_unproven');
    assert.equal(bot.lastActionEvidence.inconclusive, true);
    assert.equal(bot.lastActionEvidence.retryable, true);
});

test('mining staging keeps completed round-trip rejection conclusive', async () => {
    const { bot, gotoTargets, target } = miningStagingProbeBot('noPath');

    const reached = await mineSearchTunnel(bot, 'iron_ore', 12, target);

    assert.equal(reached, false);
    assert.equal(gotoTargets.length, 0);
    assert.equal(bot.lastActionEvidence.outcome, 'staging_unreachable');
    assert.notEqual(bot.lastActionEvidence.inconclusive, true);
    assert.equal(bot.lastActionEvidence.retryable, false);
});

test('mining staging requires physical settlement after a proven round trip', async () => {
    const { bot, gotoTargets, target } = miningStagingProbeBot('success');

    const reached = await mineSearchTunnel(bot, 'iron_ore', 12, target);

    assert.equal(reached, false);
    assert.ok(gotoTargets.length > 0);
    assert.equal(bot.lastActionEvidence.outcome, 'staging_execution_failed');
    assert.equal(bot.lastActionEvidence.inconclusive, undefined);
    assert.equal(bot.lastActionEvidence.retryable, true);
});

test('observed support loss after execution blocks every later segment', async () => {
    const { bot, gotoTargets } = nativeJourneyBot({ loseSupportAfterMove: true });

    const arrived = await goToPosition(bot, 50, 70, 0, 2, {
        allowSegmentedJourney: true,
    });

    assert.equal(arrived, false);
    assert.deepEqual(gotoTargets.map(position => position.x), [20]);
    assert.equal(bot.lastActionEvidence.outcome, 'segmented_journey_settlement_unverified');
    assert.equal(bot.lastActionEvidence.segments.length, 1);
    assert.equal(bot.lastActionEvidence.segments[0].executed, true);
    assert.equal(bot.lastActionEvidence.segments[0].terminal, null);
    assert.equal(bot.lastActionEvidence.segments[0].outcome, 'settlement_unverified');
});

test('death recovery uses segmented coordinate travel and retains its navigation receipt', async () => {
    const { bot, gotoTargets } = nativeJourneyBot();

    const recovered = await recoverDeathItems(bot, {
        position: { x: 50, y: 70, z: 0 },
        dimension: 'overworld',
        inventory: { dirt: 1 },
    });

    assert.equal(recovered, false);
    assert.deepEqual(gotoTargets.map(position => position.x), [20, 50]);
    assert.equal(bot.lastActionEvidence.kind, 'death_recovery');
    assert.equal(bot.lastActionEvidence.outcome, 'items_not_recovered');
    assert.equal(bot.lastActionEvidence.navigation.outcome, 'arrived');
    assert.equal(bot.lastActionEvidence.navigation.segments.length, 1);
    assert.deepEqual(bot.lastActionEvidence.navigation.finalDestination, { x: 50, y: 70, z: 0 });
});

test('death recovery reconciles the manifest when pickup completes during an incomplete approach', async () => {
    const { bot } = nativeJourneyBot();

    const recovered = await recoverDeathItems(bot, {
        position: { x: 50, y: 70, z: 0 },
        dimension: 'overworld',
        inventory: { dirt: 1 },
    }, {
        navigateToPosition() {
            bot.inventory.slots.push({ name: 'dirt', count: 1 });
            bot.output += 'The segmented approach did not reach its abstract coordinate.\n';
            bot.lastActionEvidence = Object.freeze({
                kind: 'movement',
                outcome: 'segmented_journey_route_unproven',
                retryable: false,
            });
            return Promise.resolve(false);
        },
    });

    assert.equal(recovered, true);
    assert.equal(bot.lastActionEvidence.outcome, 'items_recovered');
    assert.equal(bot.lastActionEvidence.completionSource, 'automatic_pickup_during_approach');
    assert.deepEqual(bot.lastActionEvidence.recoveredByItem, { dirt: 1 });
    assert.deepEqual(bot.lastActionEvidence.gainedByItem, { dirt: 1 });
    assert.equal(bot.output, 'Returned to the death site and recovered 1 dropped items.\n');
});

test('death recovery settles a pending record whose exact manifest is already carried', async () => {
    const { bot } = nativeJourneyBot();
    bot.inventory.slots.push({ name: 'dirt', count: 1 });

    const recovered = await recoverDeathItems(bot, {
        position: { x: 50, y: 70, z: 0 },
        dimension: 'overworld',
        inventory: { dirt: 1 },
    }, {
        navigateToPosition() {
            assert.fail('a satisfied manifest must not redispatch movement');
        },
    });

    assert.equal(recovered, true);
    assert.equal(bot.lastActionEvidence.outcome, 'items_recovered');
    assert.equal(bot.lastActionEvidence.completionSource, 'manifest_already_present');
    assert.deepEqual(bot.lastActionEvidence.recoveredByItem, { dirt: 1 });
    assert.deepEqual(bot.lastActionEvidence.gainedByItem, { dirt: 0 });
});

test('death recovery clears only the bounded leaf column under exact local overhead drops', async () => {
    const { bot, breakBlock, cleared, pickupItems } = overheadDeathDropBot();
    let navigationCalls = 0;

    const recovered = await recoverDeathItems(bot, {
        position: { x: 0, y: 71, z: 0 },
        dimension: 'overworld',
        inventory: { dirt: 1 },
    }, {
        navigateToPosition() {
            navigationCalls += 1;
            assert.fail('local overhead affordance must run before route search');
        },
        breakBlock,
        pickupItems,
    });

    assert.equal(recovered, true);
    assert.equal(navigationCalls, 0);
    assert.deepEqual(cleared, [
        { x: 0, y: 68, z: 0 },
        { x: 0, y: 70, z: 0 },
    ]);
    assert.equal(bot.lastActionEvidence.outcome, 'items_recovered');
    assert.equal(bot.lastActionEvidence.overheadAccess.outcome, 'death_drops_released');
    assert.equal(bot.lastActionEvidence.overheadAccess.matchedItems[0].name, 'dirt');
    assert.equal(Object.isFrozen(bot.lastActionEvidence.overheadAccess), true);
    assert.equal(Object.isFrozen(bot.lastActionEvidence.overheadAccess.cleared), true);
    assert.equal(bot.output, 'Returned to the death site and recovered 1 dropped items.\n');
});

test('death recovery never treats a log below overhead drops as disposable access', async () => {
    const { bot, breakBlock, cleared } = overheadDeathDropBot({
        obstruction: { name: 'acacia_log', y: 69 },
    });
    let navigationCalls = 0;

    const recovered = await recoverDeathItems(bot, {
        position: { x: 0, y: 71, z: 0 },
        dimension: 'overworld',
        inventory: { dirt: 1 },
    }, {
        navigateToPosition() {
            navigationCalls += 1;
            bot.lastActionEvidence = Object.freeze({
                kind: 'movement',
                outcome: 'segmented_journey_route_unproven',
                retryable: false,
            });
            return Promise.resolve(false);
        },
        breakBlock,
        pickupItems() {
            assert.fail('pickup is unavailable before the obstruction is resolved');
        },
    });

    assert.equal(recovered, false);
    assert.equal(navigationCalls, 1);
    assert.deepEqual(cleared, []);
    assert.equal(bot.lastActionEvidence.outcome, 'death_position_unreachable');
    assert.equal(bot.lastActionEvidence.overheadAccess.outcome, 'no_bounded_leaf_column');
    assert.equal(bot.lastActionEvidence.overheadAccess.rejectedColumns.non_leaf_obstruction, 1);
});

test('death recovery does not redispatch a conclusively unreachable segment', async () => {
    const { bot, gotoTargets } = nativeJourneyBot({ reverseRoute: false });

    const recovered = await recoverDeathItems(bot, {
        position: { x: 50, y: 70, z: 0 },
        dimension: 'overworld',
        inventory: { dirt: 1 },
    });

    assert.equal(recovered, false);
    assert.equal(gotoTargets.length, 0);
    assert.equal(bot.lastActionEvidence.kind, 'death_recovery');
    assert.equal(bot.lastActionEvidence.outcome, 'death_position_unreachable');
    assert.equal(bot.lastActionEvidence.retryable, false);
    assert.equal(bot.lastActionEvidence.navigation.retryable, false);
    assert.equal(bot.lastActionEvidence.navigation.outcome, 'segmented_journey_route_unreachable');
});
