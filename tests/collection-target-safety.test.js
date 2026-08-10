import assert from 'node:assert/strict';
import test from 'node:test';
import Vec3 from 'vec3';

import {
    assessTreeScaffoldDescentStep,
    assessMiningSurfaceDisturbance,
    assessStableMiningCollectionTarget,
    findStableMiningCollectionCandidates,
    isLocalNavigationFoliage,
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
        lastVisibleStep: 2,
    });

    const lateSurfaceCut = assessMiningSurfaceDisturbance(bot, [
        [], [], [], [visibleDirt(4)],
    ]);
    assert.equal(lateSurfaceCut.ok, false);
    assert.equal(lateSurfaceCut.outcome, 'surface_excavation_not_bounded');

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
