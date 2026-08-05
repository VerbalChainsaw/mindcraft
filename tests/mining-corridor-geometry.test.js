import assert from 'node:assert/strict';
import test from 'node:test';

import { Vec3 } from 'vec3';

import {
    planSupportedMiningVoxelCorridors,
    selectMiningDeadlinePrefix,
} from '../src/agent/library/skills.js';

const key = position => `${position.x}:${position.y}:${position.z}`;

test('deep mining corridors do not excavate their own required support', () => {
    const origin = new Vec3(-582, 65, -322);
    const stance = new Vec3(-584, 51, -319);
    const routes = planSupportedMiningVoxelCorridors(origin, stance);

    assert.ok(routes.length >= 2);
    assert.ok(new Set(routes.map(route => route.length)).size >= 3);
    for (const route of routes) {
        assert.deepEqual(route.at(-1).position, stance);
        assert.ok(route.every(step => (
            Math.abs(step.heading.x) + Math.abs(step.heading.z) === 1
            && [-1, 0].includes(step.yOffset)
        )));

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
    }
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
