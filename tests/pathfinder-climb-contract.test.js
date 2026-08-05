import assert from 'node:assert/strict';
import test from 'node:test';

import Movements from '../packages/minecraft-runtime/mineflayer-pathfinder/lib/movements.js';

function climbMovement(blocksByOffset) {
  const movements = Object.create(Movements.prototype);
  movements.getBlock = (_node, _x, y) => blocksByOffset.get(y) || {
    climbable: false,
    liquid: false,
    safe: true,
  };
  movements.getNumEntitiesAt = () => 0;
  movements.safeOrBreak = () => 0;
  movements.makeMove = (_node, x, y, z, remainingBlocks, cost, toBreak, toPlace, type) => ({
    x,
    y,
    z,
    remainingBlocks,
    cost,
    toBreak,
    toPlace,
    locomotion: { type },
  });
  movements.allow1by1towers = false;
  return movements;
}

test('Pathfinder climbs only into another physics-supported climbable cell', () => {
  const node = { x: 4, y: 64, z: 7, remainingBlocks: 0 };
  const topOfVine = climbMovement(new Map([
    [0, { climbable: true, liquid: false, safe: true }],
    [1, { climbable: false, liquid: false, safe: true }],
    [2, { climbable: false, liquid: false, safe: true }],
  ]));
  const unsupported = [];
  topOfVine.getMoveUp(node, unsupported);
  assert.deepEqual(unsupported, []);

  const continuousVine = climbMovement(new Map([
    [0, { climbable: true, liquid: false, safe: true }],
    [1, { climbable: true, liquid: false, safe: true }],
    [2, { climbable: false, liquid: false, safe: true }],
  ]));
  const supported = [];
  continuousVine.getMoveUp(node, supported);
  assert.equal(supported.length, 1);
  assert.equal(supported[0].y, 65);
  assert.equal(supported[0].locomotion.type, 'vertical_up');
});
