import assert from 'node:assert/strict';
import test from 'node:test';
import Vec3 from 'vec3';

import Movements from '../packages/minecraft-runtime/mineflayer-pathfinder/lib/movements.js';
import goalsModule from '../packages/minecraft-runtime/mineflayer-pathfinder/lib/goals.js';

const { GoalLookAtBlock } = goalsModule;

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

test('Pathfinder accepts an overhead block reached by the survival eye ray', () => {
  const target = new Vec3(4, 75, 7);
  const world = {
    raycast(start, direction, reach) {
      const lowerFace = target.offset(0.5, 0, 0.5);
      if (start.distanceTo(lowerFace) > reach) return null;
      assert.ok(direction.y > 0);
      assert.equal(reach, 4.5);
      return { position: target, face: 0 };
    },
  };
  const goal = new GoalLookAtBlock(target, world);

  // Feet at y=70 put the player's eye at y=71.6. The lower face of the y=75
  // log is only 3.4 blocks away and is a normal survival interaction.
  assert.equal(goal.isEnd(new Vec3(4, 70, 7)), true);
});

test('Pathfinder requires independent support before settling a destructive interaction stance', () => {
  const target = new Vec3(4, 69, 7);
  const world = {
    raycast() {
      return { position: target, face: 1 };
    },
  };
  const goal = new GoalLookAtBlock(target, world, {
    requireIndependentSupport: true,
  });

  // Feet directly above the target would make the bot dig away its own
  // support. An adjacent, equally visible standing cell is valid.
  assert.equal(goal.isEnd(new Vec3(4, 70, 7)), false);
  assert.equal(goal.isEnd(new Vec3(5, 69, 7)), true);
});

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
  assert.equal(movement.getMoveSwimUp(node, open), 'submerged');
  assert.equal(open.length, 1);
  assert.equal(open[0].y, 62);
  assert.equal(open[0].locomotion.type, 'swim_up');

  movement.getBlock = (_node, _x, y) => new Map([
    [0, { type: 9, safe: true }],
    [1, { type: 0, safe: true }],
    [2, { type: 0, safe: true }],
  ]).get(y);
  const surface = [];
  assert.equal(movement.getMoveSwimUp(node, surface), 'surface');
  assert.equal(surface.length, 1);
  assert.equal(surface[0].y, 62);
  assert.equal(surface[0].locomotion.type, 'swim_up');

  movement.getBlock = (_node, _x, y) => new Map([
    [0, { type: 9, safe: true }],
    [1, { type: 9, safe: true }],
    [2, { type: 18, safe: false }],
  ]).get(y);
  const obstructed = [];
  assert.equal(movement.getMoveSwimUp(node, obstructed), false);
  assert.deepEqual(obstructed, []);
});

test('Pathfinder represents a one-block waterline bank as a native step-up', () => {
  const node = { x: 4, y: 62, z: 7, remainingBlocks: 0 };
  const movement = Object.create(Movements.prototype);
  movement.getNumEntitiesAt = () => 0;
  movement.safeOrBreak = () => 0;
  movement.openableAction = () => null;
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
    if (x === 0 && y === 0 && z === 0) {
      return { position: new Vec3(4, 62, 7), liquid: true, physical: false, height: 62 };
    }
    if (x === 0 && y === -1 && z === 0) {
      return { position: new Vec3(4, 61, 7), liquid: true, physical: false, height: 61 };
    }
    if (x === 1 && y === 0 && z === 0) {
      return { position: new Vec3(5, 62, 7), liquid: false, physical: true, height: 63 };
    }
    return {
      position: new Vec3(node.x + x, node.y + y, node.z + z),
      liquid: false,
      physical: false,
      safe: true,
      height: node.y + y,
    };
  };

  const neighbors = [];
  movement.getMoveJumpUp(node, { x: 1, z: 0 }, neighbors);

  assert.equal(neighbors.length, 1);
  assert.equal(neighbors[0].y, 63);
  assert.equal(neighbors[0].locomotion.type, 'step_up');
});

test('Pathfinder does not advertise a step-up launched from inside a door', () => {
  const node = { x: 4, y: 71, z: 7, remainingBlocks: 0 };
  const movement = Object.create(Movements.prototype);
  movement.canPlaceBlocks = false;
  movement.getNumEntitiesAt = () => 0;
  movement.safeOrBreak = () => 0;
  movement.openableAction = () => null;
  movement.getBlock = (_node, x, y, z) => {
    if (x === 0 && y === -1 && z === 0) {
      return {
        position: new Vec3(4, 70, 7),
        name: 'oak_door',
        openable: true,
        physical: true,
        liquid: false,
        height: 71,
      };
    }
    if (x === 1 && y === 0 && z === 0) {
      return {
        position: new Vec3(5, 71, 7),
        name: 'cobblestone',
        openable: false,
        physical: true,
        liquid: false,
        height: 72,
      };
    }
    return {
      position: new Vec3(node.x + x, node.y + y, node.z + z),
      name: 'air',
      openable: false,
      physical: false,
      liquid: false,
      safe: true,
      height: node.y + y,
    };
  };
  movement.makeMove = () => {
    throw new Error('a door is passable body space, not a solid launch platform');
  };

  const neighbors = [];
  movement.getMoveJumpUp(node, { x: 1, z: 0 }, neighbors);

  assert.deepEqual(neighbors, []);
});

test('Pathfinder omits bridge placement when the movement owner has no construction authority', () => {
  const node = { x: 4, y: 64, z: 7, remainingBlocks: 8 };
  const movement = Object.create(Movements.prototype);
  movement.canPlaceBlocks = false;
  movement.liquidCost = 1;
  movement.exclusionStep = () => 0;
  movement.getNumEntitiesAt = () => 0;
  movement.safeOrBreak = () => 0;
  movement.openableAction = () => null;
  movement.getBlock = (_node, x, y, z) => ({
    position: new Vec3(node.x + x, node.y + y, node.z + z),
    physical: false,
    replaceable: true,
    liquid: false,
    safe: true,
  });
  movement.makeMove = () => {
    throw new Error('a no-construction movement must not advertise a placement edge');
  };

  const neighbors = [];
  movement.getMoveForward(node, { x: 1, z: 0 }, neighbors);
  movement.getMoveJumpUp(node, { x: 1, z: 0 }, neighbors);
  movement.getMoveUp(node, neighbors);
  assert.deepEqual(neighbors, []);
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
