import assert from 'node:assert/strict';
import test from 'node:test';
import Vec3 from 'vec3';

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

test('Pathfinder counts drop depth between standing cells rather than destination support', () => {
  const movement = Object.create(Movements.prototype);
  movement.bot = { game: { minY: -64 } };
  movement.maxDropDown = 1;
  movement.getBlock = (origin, x, y, z) => {
    const position = new Vec3(origin.x + x, origin.y + y, origin.z + z);
    return {
      position,
      physical: position.y === 68,
      liquid: false,
      safe: true,
    };
  };

  const landing = movement.getLandingBlock(
    { x: 4, y: 70, z: 7 },
    { x: 1, z: 0 },
  );
  assert.deepEqual(landing.position, new Vec3(5, 69, 7));

  movement.maxDropDown = 0;
  assert.equal(movement.getLandingBlock(
    { x: 4, y: 70, z: 7 },
    { x: 1, z: 0 },
  ), null);
});

test('Pathfinder owns closing an openable that it opened for a forward move', () => {
  const node = { x: 4, y: 64, z: 7, remainingBlocks: 0 };
  const movement = Object.create(Movements.prototype);
  movement.canOpenDoors = true;
  movement.liquidCost = 1;
  movement.exclusionStep = () => 0;
  movement.getNumEntitiesAt = () => 0;
  movement.safeOrBreak = () => 0;
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
  movement.getBlock = (_node, x, y, z) => {
    if (x === 1 && y === 0 && z === 0) {
      return {
        position: new Vec3(5, 64, 7),
        openable: true,
        _properties: { open: false },
        liquid: false,
      };
    }
    return {
      position: new Vec3(node.x + x, node.y + y, node.z + z),
      physical: y === -1,
      liquid: false,
    };
  };

  const neighbors = [];
  movement.getMoveForward(node, { x: 1, z: 0 }, neighbors);

  assert.equal(neighbors.length, 1);
  assert.deepEqual(neighbors[0].toPlace, [{
    x: 5,
    y: 64,
    z: 7,
    dx: 0,
    dy: 0,
    dz: 0,
    useOne: true,
    closeAfterCrossing: {
      source: { x: 4, y: 64, z: 7 },
      destination: { x: 5, y: 64, z: 7 },
    },
  }]);
});

test('Pathfinder uses the same owned openable lifecycle for a raised doorway', () => {
  const node = { x: 4, y: 64, z: 7, remainingBlocks: 0 };
  const movement = Object.create(Movements.prototype);
  movement.canOpenDoors = true;
  movement.getNumEntitiesAt = () => 0;
  movement.safeOrBreak = () => 0;
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
  movement.getBlock = (_node, x, y, z) => {
    if (x === 1 && y === 1 && z === 0) {
      return {
        position: new Vec3(5, 65, 7),
        openable: true,
        _properties: { open: false },
        physical: false,
      };
    }
    if (x === 1 && y === 0 && z === 0) {
      return {
        position: new Vec3(5, 64, 7),
        physical: true,
        height: 65,
      };
    }
    if (x === 0 && y === -1 && z === 0) {
      return {
        position: new Vec3(4, 63, 7),
        physical: true,
        height: 64,
      };
    }
    return {
      position: new Vec3(node.x + x, node.y + y, node.z + z),
      physical: false,
      height: node.y + y,
    };
  };

  const neighbors = [];
  movement.getMoveJumpUp(node, { x: 1, z: 0 }, neighbors);

  assert.equal(neighbors.length, 1);
  assert.equal(neighbors[0].locomotion.type, 'step_up');
  assert.deepEqual(neighbors[0].toPlace, [{
    x: 5,
    y: 65,
    z: 7,
    dx: 0,
    dy: 0,
    dz: 0,
    useOne: true,
    closeAfterCrossing: {
      source: { x: 4, y: 64, z: 7 },
      destination: { x: 5, y: 65, z: 7 },
    },
  }]);
});
