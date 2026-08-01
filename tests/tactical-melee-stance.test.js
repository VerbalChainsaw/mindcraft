import assert from 'node:assert/strict';
import test from 'node:test';
import Vec3 from 'vec3';

import {
    findTacticalMeleeStances,
    guardExecutableDiagonalCorners,
    shouldReplanTacticalMeleeApproach,
} from '../src/agent/library/skills.js';

function block(name, x, y, z, boundingBox = name === 'air' ? 'empty' : 'block') {
    return {
        name,
        boundingBox,
        position: new Vec3(x, y, z),
    };
}

test('tactical melee stances route around an obstruction to supported line-of-sight cells', () => {
    const target = {
        id: 7,
        name: 'zombie',
        height: 1.95,
        position: new Vec3(4.5, 64, 0.5),
    };
    const bot = {
        entity: {
            eyeHeight: 1.62,
            position: new Vec3(0.5, 64, 0.5),
        },
        blockAt(position) {
            if (position.y === 63) return block('stone', position.x, position.y, position.z);
            if (position.x === 2 && position.y >= 64 && position.y <= 65) {
                return block('stone_bricks', position.x, position.y, position.z);
            }
            return block('air', position.x, position.y, position.z);
        },
        world: {
            raycast(origin, direction, distance) {
                const endpoint = origin.plus(direction.scaled(distance));
                if (origin.x < 3 && endpoint.x > 2) {
                    return { position: new Vec3(2, 64, 0), face: 4 };
                }
                return null;
            },
        },
    };

    const stances = findTacticalMeleeStances(bot, target);

    assert.ok(stances.length > 0);
    assert.ok(stances.some(position => position.x === 5 && position.y === 64));
    assert.ok(stances.every(position => position.x >= 4));
    assert.ok(stances.every(position => bot.blockAt(position.offset(0, -1, 0)).name === 'stone'));
});

test('tactical melee replans on new geometry evidence but not a repeated static visible stall', () => {
    assert.equal(shouldReplanTacticalMeleeApproach({
        replan: 0,
        navigated: false,
        physicalProgress: 4.2,
        targetMovement: 0,
        lineOfSightBefore: false,
        lineOfSightAfter: true,
    }), true);
    assert.equal(shouldReplanTacticalMeleeApproach({
        replan: 1,
        navigated: false,
        physicalProgress: 1.1,
        targetMovement: 0,
        lineOfSightBefore: true,
        lineOfSightAfter: true,
    }), false);
});

test('movement policy rejects collision-corner and raised diagonals but preserves flat open-space diagonals', () => {
    const movementFixture = (blockedOffsets, raised = false) => {
        let accepted = 0;
        const movements = {
            getBlock(_node, dx, dy, dz) {
                return {
                    physical: raised && dx === 1 && dy === 0 && dz === 1,
                    safe: !blockedOffsets.has(`${dx}:${dy}:${dz}`),
                };
            },
            getMoveDiagonal() {
                accepted += 1;
            },
        };
        guardExecutableDiagonalCorners(movements);
        movements.getMoveDiagonal(
            { x: 0, y: 64, z: 0 },
            { x: 1, z: 1 },
            [],
        );
        return accepted;
    };

    assert.equal(movementFixture(new Set(['1:0:0'])), 0);
    assert.equal(movementFixture(new Set(), true), 0);
    assert.equal(movementFixture(new Set()), 1);
});
