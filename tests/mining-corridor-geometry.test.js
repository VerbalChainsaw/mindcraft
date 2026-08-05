import assert from 'node:assert/strict';
import test from 'node:test';

import { Vec3 } from 'vec3';

import { selectMiningDeadlinePrefix } from '../src/agent/library/skills.js';
import { searchSupportedMiningVoxelCorridors } from '../src/agent/runtime/mining-corridor-planner.js';

const key = position => `${position.x}:${position.y}:${position.z}`;

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
