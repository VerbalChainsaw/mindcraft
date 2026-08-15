import assert from 'node:assert/strict';
import test from 'node:test';

import {
    bindRejectedCollectionTarget,
    rankCollectionCandidates,
    rankWholeTreeCandidates,
} from '../src/agent/runtime/collection-candidate-selector.js';

function candidate(overrides={}) {
    return {
        position: { x: 0, y: 64, z: 0 },
        distance: 4,
        verticalDelta: 0,
        hazardScore: 0,
        breakTimeMs: 500,
        routeStatus: 'success',
        routeCost: 4,
        ...overrides,
    };
}

test('confirmed unreachable collection targets lose to reachable alternatives', () => {
    const ranked = rankCollectionCandidates([
        candidate({
            position: { x: 2, y: 64, z: 0 },
            distance: 2,
            routeStatus: 'noPath',
            routeCost: 0,
        }),
        candidate({
            position: { x: 8, y: 64, z: 0 },
            distance: 8,
            routeCost: 9,
        }),
    ]);

    assert.equal(ranked[0].position.x, 8);
    assert.equal(ranked[0].reachable, true);
    assert.equal(ranked[1].reachable, false);
});

test('unproven, unsafe, and timed-out route probes are not promoted into movement attempts', () => {
    for (const routeStatus of [
        'timeout',
        'probe_error',
        'unknown',
        'unsafe_drop_support',
        'no_safe_stance',
        'target_unloaded',
    ]) {
        const [ranked] = rankCollectionCandidates([candidate({ routeStatus })]);
        assert.equal(ranked.reachable, false, routeStatus);
        assert.equal(ranked.score, Number.POSITIVE_INFINITY, routeStatus);
    }
});

test('local hazards outweigh a modest distance advantage', () => {
    const ranked = rankCollectionCandidates([
        candidate({
            position: { x: 3, y: 64, z: 0 },
            distance: 3,
            routeCost: 3,
            hazardScore: 1,
        }),
        candidate({
            position: { x: 6, y: 64, z: 0 },
            distance: 6,
            routeCost: 6,
        }),
    ]);

    assert.equal(ranked[0].position.x, 6);
    assert.equal(ranked[0].hazardScore, 0);
});

test('coordinate tie-breaks keep equivalent rankings deterministic', () => {
    const ranked = rankCollectionCandidates([
        candidate({ position: { x: 4, y: 64, z: 2 } }),
        candidate({ position: { x: 3, y: 64, z: 3 } }),
    ]);

    assert.deepEqual(
        ranked.map(entry => [entry.position.x, entry.position.z]),
        [[3, 3], [4, 2]],
    );
});

test('a fully rejected candidate set preserves one exact target for recovery memory', () => {
    const ranked = rankCollectionCandidates([
        candidate({
            position: { x: 9, y: 12, z: 4 },
            distance: 7,
            routeStatus: 'no_safe_stance',
            name: 'deepslate_iron_ore',
        }),
        candidate({
            position: { x: 4, y: 12, z: 8 },
            distance: 3,
            routeStatus: 'no_safe_stance',
            name: 'iron_ore',
        }),
    ]);

    assert.deepEqual(
        bindRejectedCollectionTarget({ ranked }, 'iron_ore'),
        { name: 'iron_ore', x: 4, y: 12, z: 8 },
    );
});

test('whole-tree selection prefers a better local quantity fit over the nearest oversized tree', () => {
    const ranked = rankWholeTreeCandidates([
        candidate({
            position: { x: 3, y: 64, z: 0 },
            componentSize: 8,
            score: 12,
            distance: 3,
            reachable: true,
        }),
        candidate({
            position: { x: 7, y: 64, z: 0 },
            componentSize: 3,
            score: 28,
            distance: 7,
            reachable: true,
        }),
    ], 3);

    assert.equal(ranked[0].componentSize, 3);
    assert.equal(ranked[0].position.x, 7);
});

test('whole-tree selection will not chase a perfect yield outside the local route envelope', () => {
    const ranked = rankWholeTreeCandidates([
        candidate({
            position: { x: 3, y: 64, z: 0 },
            componentSize: 5,
            score: 10,
            reachable: true,
        }),
        candidate({
            position: { x: 40, y: 64, z: 0 },
            componentSize: 3,
            score: 40,
            reachable: true,
        }),
    ], 3);

    assert.deepEqual(ranked.map(entry => entry.componentSize), [5]);
});

test('whole-tree selection prefers completing the quantity when yield differences tie', () => {
    const ranked = rankWholeTreeCandidates([
        candidate({ componentSize: 2, score: 10, reachable: true }),
        candidate({ componentSize: 4, score: 12, reachable: true }),
    ], 3);

    assert.equal(ranked[0].componentSize, 4);
});

test('whole-tree selection never promotes an unreachable component', () => {
    const ranked = rankWholeTreeCandidates([
        candidate({ componentSize: 3, score: 1, reachable: false }),
        candidate({ componentSize: 4, score: 10, reachable: true }),
    ], 3);

    assert.deepEqual(ranked.map(entry => entry.componentSize), [4]);
});

test('whole-tree selection leaves missing and malformed component evidence unknown', () => {
    assert.deepEqual(rankWholeTreeCandidates(null, 3), []);
    assert.deepEqual(rankWholeTreeCandidates([
        candidate({ componentSize: 0, score: 1, reachable: true }),
        candidate({ componentSize: 3, score: Number.POSITIVE_INFINITY, reachable: true }),
        candidate({ componentSize: 3, score: 1, reachable: false }),
    ], 3), []);
});
