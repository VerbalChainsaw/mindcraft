import assert from 'node:assert/strict';
import test from 'node:test';

import { guardExecutableDiagonalCorners } from '../src/agent/library/skills.js';

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
