import assert from 'node:assert/strict';
import test from 'node:test';

import { Vec3 } from 'vec3';

import { planSupportedMiningVoxelCorridors } from '../src/agent/library/skills.js';

const key = position => `${position.x}:${position.y}:${position.z}`;

test('deep mining corridors do not excavate their own required support', () => {
    const origin = new Vec3(-582, 65, -322);
    const stance = new Vec3(-584, 51, -319);
    const routes = planSupportedMiningVoxelCorridors(origin, stance);

    assert.ok(routes.length >= 2);
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
