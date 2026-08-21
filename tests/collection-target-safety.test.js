import assert from 'node:assert/strict';
import test from 'node:test';
import Vec3 from 'vec3';

import {
    assessTreeScaffoldDescentStep,
    assessMiningSurfaceDisturbance,
    assessStableMiningCollectionTarget,
    authorizeTemporaryTreeScaffoldItems,
    findStableMiningCollectionCandidates,
    isLocalNavigationFoliage,
    protectedMiningReturnGeometry,
    reclaimSupportingTreeScaffolds,
    settleTreeTransactionOnTerrain,
    treeScaffoldPositionAuthorized,
    treeSettlementStances,
} from '../src/agent/library/skills.js';
import { assessAnchoredGameplaySupport } from '../src/agent/runtime/gameplay-safety.js';

function block(name, x, y, z, boundingBox = name === 'air' ? 'empty' : 'block') {
    return {
        name,
        boundingBox,
        position: new Vec3(x, y, z),
    };
}

function fixture({ supported }) {
    const target = block('stone', 0, 64, 0);
    const blocks = new Map();
    const put = value => blocks.set(`${value.position.x}:${value.position.y}:${value.position.z}`, value);
    put(target);
    if (supported) put(block('stone', 0, 63, 0));
    put(block('stone', 1, 63, 0));
    return {
        target,
        bot: {
            entity: {
                eyeHeight: 1.6,
                position: new Vec3(1.5, 64, 0.5),
            },
            blockAt(position) {
                return blocks.get(`${position.x}:${position.y}:${position.z}`)
                    || block('air', position.x, position.y, position.z);
            },
            world: {
                raycast() {
                    return { position: target.position, face: 1 };
                },
            },
        },
    };
}

test('preserved mining return geometry reserves support, body, and head cells from later collection', () => {
    const protectedCells = protectedMiningReturnGeometry([
        { x: 8062, y: -1, z: 7919 },
        { x: 8061, y: -2, z: 7919 },
    ]);

    assert.equal(protectedCells.has('8062:-2:7919'), true);
    assert.equal(protectedCells.has('8062:-1:7919'), true);
    assert.equal(protectedCells.has('8062:0:7919'), true);
    assert.equal(protectedCells.has('8062:-3:7919'), false);
    assert.equal(protectedCells.has('8063:-2:7919'), false);
});

test('tree scaffolding is authorized only inside voxels from the exact bound component', () => {
    const tree = {
        logs: [
            block('spruce_log', 8, 64, 3),
            block('spruce_log', 8, 65, 3),
            block('spruce_log', 8, 66, 3),
        ],
    };

    assert.equal(treeScaffoldPositionAuthorized(tree, new Vec3(8, 65, 3)), true);
    assert.equal(treeScaffoldPositionAuthorized(tree, new Vec3(9, 65, 3)), false);
    assert.equal(treeScaffoldPositionAuthorized(tree, new Vec3(8, 67, 3)), false);
});

test('whole-tree movement can reuse collected logs as reversible scaffold material', () => {
    const movements = { scafoldingBlocks: [1, 2] };
    const bot = {
        registry: {
            itemsByName: {
                spruce_log: { id: 37 },
                oak_log: { id: 38 },
            },
        },
    };

    assert.equal(
        authorizeTemporaryTreeScaffoldItems(
            bot,
            movements,
            new Set(['spruce_log', 'oak_log', 'missing_log']),
        ),
        movements,
    );
    assert.deepEqual(movements.scafoldingBlocks, [1, 2, 37, 38]);

    authorizeTemporaryTreeScaffoldItems(bot, movements, new Set(['spruce_log']));
    assert.deepEqual(movements.scafoldingBlocks, [1, 2, 37, 38]);
});

test('tree settlement steps onto natural terrain instead of accepting its owned pillar', () => {
    const blocks = new Map();
    const put = value => blocks.set(`${value.position.x}:${value.position.y}:${value.position.z}`, value);
    const base = new Vec3(8, 66, 3);
    const ownedPillar = block('dirt', 8, 66, 3);
    put(ownedPillar);
    // A three-block step down is native, damage-free locomotion. Tree
    // settlement must keep this real terrain candidate instead of inheriting
    // the one-block descent limit used inside deterministic mining corridors.
    put(block('grass_block', 9, 63, 3));
    const bot = {
        entity: { position: new Vec3(8.5, 67, 3.5) },
        blockAt(position) {
            return blocks.get(`${position.x}:${position.y}:${position.z}`)
                || block('air', position.x, position.y, position.z);
        },
    };

    const stances = treeSettlementStances(
        bot,
        { base, logs: [block('spruce_log', 8, 66, 3)] },
        [{ position: ownedPillar.position }],
    );

    assert.ok(stances.some(position => position.equals(new Vec3(9, 64, 3))));
    assert.ok(stances.every(position => !position.equals(new Vec3(8, 67, 3))));
});

test('tree settlement trusts an uncancelled verified terrain stance after navigation recovery', async () => {
    const blocks = new Map();
    const put = value => blocks.set(`${value.position.x}:${value.position.y}:${value.position.z}`, value);
    const base = new Vec3(8, 66, 3);
    put(block('grass_block', 9, 63, 3));
    const bot = {
        interrupt_code: false,
        entity: { position: new Vec3(8.5, 67, 3.5) },
        blockAt(position) {
            return blocks.get(`${position.x}:${position.y}:${position.z}`)
                || block('air', position.x, position.y, position.z);
        },
    };

    const result = await settleTreeTransactionOnTerrain(
        bot,
        { base, logs: [block('spruce_log', 8, 66, 3)] },
        [],
        async () => {
            bot.entity.position = new Vec3(9.5, 64, 3.5);
            return false;
        },
    );

    assert.equal(result.settled, true);
    assert.equal(result.outcome, 'tree_terrain_settled');
    assert.ok(result.target.equals(new Vec3(9, 64, 3)));
});

test('tree scaffold teardown descends through exact owned support before natural terrain', () => {
    const blocks = new Map();
    const put = value => blocks.set(`${value.position.x}:${value.position.y}:${value.position.z}`, value);
    const upper = block('dirt', 8, 66, 3);
    const lower = block('dirt', 8, 65, 3);
    put(upper);
    put(lower);
    put(block('grass_block', 8, 64, 3));
    const bot = {
        entity: { position: new Vec3(8.5, 67, 3.5) },
        blockAt(position) {
            return blocks.get(`${position.x}:${position.y}:${position.z}`)
                || block('air', position.x, position.y, position.z);
        },
    };
    const scaffolds = [
        { position: upper.position, itemName: 'dirt' },
        { position: lower.position, itemName: 'dirt' },
    ];

    const first = assessTreeScaffoldDescentStep(bot, scaffolds);
    assert.equal(first.ok, true);
    assert.equal(first.landingKind, 'owned_scaffold');
    assert.ok(first.target.equals(new Vec3(8, 66, 3)));
    assert.ok(first.expectedFeet.equals(new Vec3(8, 66, 3)));

    blocks.delete('8:65:3');
    const unsafe = assessTreeScaffoldDescentStep(bot, scaffolds);
    assert.equal(unsafe.ok, false);
    assert.equal(unsafe.outcome, 'tree_scaffold_landing_unsafe');
});

test('tree scaffold teardown settles each one-block landing before breaking the next support', async () => {
    const blocks = new Map();
    const put = value => blocks.set(`${value.position.x}:${value.position.y}:${value.position.z}`, value);
    const upper = block('dirt', 8, 66, 3);
    const lower = block('dirt', 8, 65, 3);
    put(upper);
    put(lower);
    put(block('grass_block', 8, 64, 3));
    const bot = {
        interrupt_code: false,
        entity: { position: new Vec3(8.5, 67, 3.5) },
        blockAt(position) {
            return blocks.get(`${position.x}:${position.y}:${position.z}`)
                || block('air', position.x, position.y, position.z);
        },
    };
    const scaffolds = [
        { position: upper.position, itemName: 'dirt' },
        { position: lower.position, itemName: 'dirt' },
    ];
    const breaks = [];
    const settlements = [];

    const result = await reclaimSupportingTreeScaffolds(bot, scaffolds, {
        async breakScaffold(_bot, x, y, z) {
            breaks.push(new Vec3(x, y, z));
            blocks.delete(`${x}:${y}:${z}`);
            bot.entity.position = new Vec3(x + 0.5, y, z + 0.5);
            return true;
        },
        async settleStandingCell() {
            const feet = bot.entity.position.floored();
            settlements.push(feet.clone());
            return feet;
        },
    });

    assert.equal(result.complete, true);
    assert.equal(result.reclaimed, 2);
    assert.deepEqual(breaks.map(position => position.y), [66, 65]);
    assert.deepEqual(settlements.map(position => position.y), [66, 65]);
});

test('tree settlement waits for the physical landing after navigation resolves', async () => {
    const blocks = new Map();
    const put = value => blocks.set(`${value.position.x}:${value.position.y}:${value.position.z}`, value);
    const base = new Vec3(8, 66, 3);
    put(block('grass_block', 9, 63, 3));
    const bot = {
        interrupt_code: false,
        entity: { position: new Vec3(8.5, 67, 3.5) },
        blockAt(position) {
            return blocks.get(`${position.x}:${position.y}:${position.z}`)
                || block('air', position.x, position.y, position.z);
        },
    };

    const result = await settleTreeTransactionOnTerrain(
        bot,
        { base, logs: [block('spruce_log', 8, 66, 3)] },
        [],
        async () => {
            setTimeout(() => {
                bot.entity.position = new Vec3(9.5, 64, 3.5);
            }, 50);
            return true;
        },
    );

    assert.equal(result.settled, true);
    assert.equal(result.outcome, 'tree_terrain_settled');
    assert.ok(result.target.equals(new Vec3(9, 64, 3)));
});

test('tree settlement refreshes a legal terrain stance after the candidate snapshot changes', async () => {
    const blocks = new Map();
    const put = value => blocks.set(`${value.position.x}:${value.position.y}:${value.position.z}`, value);
    const remove = position => blocks.delete(`${position.x}:${position.y}:${position.z}`);
    const base = new Vec3(8, 66, 3);
    const finalFeet = new Vec3(9, 64, 3);
    put(block('grass_block', 8, 63, 4));
    put(block('grass_block', 9, 63, 3));
    put(block('spruce_leaves', 9, 64, 3));
    const bot = {
        interrupt_code: false,
        entity: { position: new Vec3(8.5, 67, 3.5) },
        blockAt(position) {
            return blocks.get(`${position.x}:${position.y}:${position.z}`)
                || block('air', position.x, position.y, position.z);
        },
    };

    const result = await settleTreeTransactionOnTerrain(
        bot,
        { base, logs: [block('spruce_log', 8, 66, 3)] },
        [],
        async () => {
            remove(finalFeet);
            bot.entity.position = new Vec3(9.5, 64, 3.5);
            return false;
        },
    );

    assert.equal(result.settled, true);
    assert.equal(result.outcome, 'tree_terrain_settled');
    assert.ok(result.target.equals(finalFeet));
});

test('mining allows a compact entrance but rejects a visible surface trench before excavation', () => {
    const blocks = new Map();
    const put = value => blocks.set(`${value.position.x}:${value.position.y}:${value.position.z}`, value);
    const visibleDirt = (x, z = 0) => {
        const dirt = block('dirt', x, 64, z);
        const air = block('air', x, 65, z);
        air.skyLight = 15;
        put(dirt);
        put(air);
        return dirt;
    };
    const bot = {
        blockAt(position) {
            return blocks.get(`${position.x}:${position.y}:${position.z}`)
                || Object.assign(block('stone', position.x, position.y, position.z), { skyLight: 0 });
        },
    };

    const compact = assessMiningSurfaceDisturbance(bot, [
        [visibleDirt(0)],
        [visibleDirt(1)],
        [visibleDirt(2)],
        [block('stone', 3, 63, 0)],
    ]);
    assert.deepEqual(compact, {
        ok: true,
        outcome: 'compact_surface_entrance',
        visibleBlocks: 3,
        surfaceColumns: 3,
        lastVisibleStep: 2,
    });

    // A shaft straight down is one hole in the surface however deep it goes.
    // The old metric counted sky-lit blocks, so every block of the shaft
    // scored as fresh surface damage and anything past three deep was refused
    // as "not bounded" -- which ended straight-down mining entirely when it
    // landed on 2026-08-10. Depth is not disturbance; footprint is.
    const shaftColumn = { x: 20, z: 0 };
    const verticalShaft = assessMiningSurfaceDisturbance(bot, [
        [visibleDirt(shaftColumn.x, shaftColumn.z)],
        [visibleDirt(shaftColumn.x, shaftColumn.z)],
        [visibleDirt(shaftColumn.x, shaftColumn.z)],
        [visibleDirt(shaftColumn.x, shaftColumn.z)],
        [visibleDirt(shaftColumn.x, shaftColumn.z)],
        [visibleDirt(shaftColumn.x, shaftColumn.z)],
    ]);
    assert.equal(verticalShaft.ok, true);
    assert.equal(verticalShaft.surfaceColumns, 1);
    assert.equal(verticalShaft.lastVisibleStep, 0);

    // Cutting ONE surface hole late in a route is not a trench, and refusing it
    // was what stopped the companion descending at all: a staircase opens a new
    // column on each of its first few steps by construction. What the rule
    // protects against is width, and width is counted whenever it is cut.
    const lateSurfaceCut = assessMiningSurfaceDisturbance(bot, [
        [], [], [], [visibleDirt(4)],
    ]);
    assert.equal(lateSurfaceCut.ok, true);
    assert.equal(lateSurfaceCut.surfaceColumns, 1);

    // A staircase down: one new column per descending step, then under cover.
    const staircase = assessMiningSurfaceDisturbance(bot, [
        [visibleDirt(30)], [visibleDirt(31)], [visibleDirt(32)], [visibleDirt(33)],
        [block('stone', 34, 63, 0)], [block('stone', 35, 62, 0)],
    ]);
    assert.equal(staircase.ok, true);
    assert.equal(staircase.surfaceColumns, 4);

    // Width is still refused, whenever it is cut -- including late.
    const lateTrench = assessMiningSurfaceDisturbance(bot, [
        [], [], [], [
            visibleDirt(40), visibleDirt(41), visibleDirt(42), visibleDirt(43),
            visibleDirt(44), visibleDirt(45), visibleDirt(46),
        ],
    ]);
    assert.equal(lateTrench.ok, false);
    assert.equal(lateTrench.outcome, 'surface_excavation_budget_exceeded');

    const wideSurfaceCut = assessMiningSurfaceDisturbance(bot, [[
        visibleDirt(10),
        visibleDirt(11),
        visibleDirt(12),
        visibleDirt(13),
        visibleDirt(14),
        visibleDirt(15),
        visibleDirt(16),
    ]]);
    assert.equal(wideSurfaceCut.ok, false);
    assert.equal(wideSurfaceCut.outcome, 'surface_excavation_budget_exceeded');
});

test('natural mining requires recoverable drop support and a stance not supported by the target', () => {
    const unsupported = fixture({ supported: false });
    assert.deepEqual(
        assessStableMiningCollectionTarget(unsupported.bot, unsupported.target),
        {
            safe: false,
            code: 'unsafe_drop_support',
            dropDepth: null,
            stances: [],
        },
    );

    const supported = fixture({ supported: true });
    const assessment = assessStableMiningCollectionTarget(supported.bot, supported.target);
    assert.equal(assessment.safe, true);
    assert.equal(assessment.code, 'safe_stance_available');
    assert.equal(assessment.dropDepth, 0);
    assert.ok(assessment.stances.length > 0);
    assert.ok(assessment.stances.every(position => !(
        position.x === supported.target.position.x
        && position.y - 1 === supported.target.position.y
        && position.z === supported.target.position.z
    )));
});

test('nearer unsupported blocks cannot hide a supported mining target from the bounded candidate pool', () => {
    const candidates = Array.from({ length: 60 }, (_, index) => block('stone', index, 64, 0));
    const supported = block('stone', 60, 64, 0);
    candidates.push(supported);
    const blocks = new Map(candidates.map(value => [
        `${value.position.x}:${value.position.y}:${value.position.z}`,
        value,
    ]));
    blocks.set('60:63:0', block('stone', 60, 63, 0));
    const bot = {
        findBlocks({ matching, count }) {
            return candidates
                .filter(candidate => matching(candidate))
                .slice(0, count)
                .map(candidate => candidate.position);
        },
        blockAt(position) {
            return blocks.get(`${position.x}:${position.y}:${position.z}`)
                || block('air', position.x, position.y, position.z);
        },
    };

    const selected = findStableMiningCollectionCandidates(bot, value => value.name === 'stone', 64);
    assert.deepEqual(selected.map(value => value.position), [supported.position]);
});

test('supported mining candidates span the bounded search instead of one obstructed local cluster', () => {
    const candidates = Array.from({ length: 80 }, (_, index) => block('stone', index, 64, 0));
    const blocks = new Map();
    for (const candidate of candidates) {
        blocks.set(`${candidate.position.x}:${candidate.position.y}:${candidate.position.z}`, candidate);
        blocks.set(`${candidate.position.x}:63:${candidate.position.z}`, block('stone', candidate.position.x, 63, candidate.position.z));
    }
    const bot = {
        findBlocks({ matching, count }) {
            return candidates
                .filter(candidate => matching(candidate))
                .slice(0, count)
                .map(candidate => candidate.position);
        },
        blockAt(position) {
            return blocks.get(`${position.x}:${position.y}:${position.z}`)
                || block('air', position.x, position.y, position.z);
        },
    };

    const selected = findStableMiningCollectionCandidates(bot, value => value.name === 'stone', 128);
    assert.equal(selected.length, 12);
    assert.equal(selected[0].position.x, 0);
    assert.ok(selected.some(value => value.position.x >= 70));
});

test('settled falling material is support only while its bounded column remains anchored', () => {
    const blocks = new Map();
    const put = value => blocks.set(`${value.position.x}:${value.position.y}:${value.position.z}`, value);
    const sand = block('sand', 0, 63, 0);
    put(sand);
    put(block('sand', 0, 62, 0));
    put(block('sandstone', 0, 61, 0));
    const bot = {
        blockAt(position) {
            return blocks.get(`${position.x}:${position.y}:${position.z}`)
                || block('air', position.x, position.y, position.z);
        },
    };

    const anchored = assessAnchoredGameplaySupport(bot, sand);
    assert.equal(anchored.ok, true);
    assert.equal(anchored.outcome, 'falling_support_anchored');
    assert.deepEqual(anchored.blocks.map(value => value.name), ['sand', 'sand', 'sandstone']);

    blocks.delete('0:61:0');
    const unanchored = assessAnchoredGameplaySupport(bot, sand);
    assert.equal(unanchored.ok, false);
    assert.equal(unanchored.outcome, 'falling_support_unanchored');
});

test('canopy recovery authorizes one supported downward foliage step but no unsupported plunge', () => {
    const blocks = new Map();
    const put = value => blocks.set(`${value.position.x}:${value.position.y}:${value.position.z}`, value);
    const descendingLeaf = block('acacia_leaves', 1, 71, 0);
    put(descendingLeaf);
    put(block('acacia_log', 1, 70, 0));
    const bot = {
        blockAt(position) {
            return blocks.get(`${position.x}:${position.y}:${position.z}`)
                || block('air', position.x, position.y, position.z);
        },
    };
    const origin = new Vec3(0, 72, 0);

    assert.equal(isLocalNavigationFoliage(bot, descendingLeaf, origin), true);

    blocks.delete('1:70:0');
    assert.equal(isLocalNavigationFoliage(bot, descendingLeaf, origin), false);
    assert.equal(
        isLocalNavigationFoliage(bot, block('acacia_leaves', 1, 70, 0), origin),
        false,
    );
});
