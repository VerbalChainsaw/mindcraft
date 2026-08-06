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

test('Pathfinder represents open submerged ascent as a native swim edge', () => {
  const node = { x: 4, y: 61, z: 7, remainingBlocks: 0 };
  const movement = Object.create(Movements.prototype);
  movement.bot = { registry: { blocksByName: { water: { id: 9 } } } };
  movement.liquidCost = 1;
  movement.exclusionStep = () => 0;
  movement.getNumEntitiesAt = () => 0;
  movement.makeMove = (_node, x, y, z, remainingBlocks, cost, toBreak, toPlace, type) => ({
    x,
    y,
    z,
    remainingBlocks,
    cost,
    toBreak,
    toPlace,
    locomotion: { type },
  });

  movement.getBlock = (_node, _x, y) => new Map([
    [0, { type: 9, safe: true }],
    [1, { type: 9, safe: true }],
    [2, { type: 0, safe: true }],
  ]).get(y);
  const open = [];
  assert.equal(movement.getMoveSwimUp(node, open), true);
  assert.equal(open.length, 1);
  assert.equal(open[0].y, 62);
  assert.equal(open[0].locomotion.type, 'swim_up');

  movement.getBlock = (_node, _x, y) => new Map([
    [0, { type: 9, safe: true }],
    [1, { type: 9, safe: true }],
    [2, { type: 18, safe: false }],
  ]).get(y);
  const obstructed = [];
  assert.equal(movement.getMoveSwimUp(node, obstructed), false);
  assert.deepEqual(obstructed, []);
});
