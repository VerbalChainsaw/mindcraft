import assert from 'node:assert/strict';
import test from 'node:test';

import { rankCollectionCandidates } from '../src/agent/runtime/collection-candidate-selector.js';

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

