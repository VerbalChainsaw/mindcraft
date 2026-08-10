import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import Vec3 from 'vec3';

const require = createRequire(import.meta.url);
const Movements = require('../packages/minecraft-runtime/mineflayer-pathfinder/lib/movements.js');

const fence = {
  position: new Vec3(8101, 70, 7938),
  shapes: [
    [0.375, 0, 0, 0.625, 1.5, 1],
    [0.625, 0, 0.375, 1, 1.5, 0.625],
  ],
};

function movementHarness() {
  const movements = Object.create(Movements.prototype);
  movements.bot = {
    blockAt(position) {
      return position.equals(fence.position) ? fence : null;
    },
  };
  return movements;
}

function startNode() {
  return {
    x: 8101,
    y: 70,
    z: 7938,
    physicalStart: {
      x: 8101.075,
      y: 70,
      z: 7938.5,
      width: 0.6,
      height: 1.8,
    },
  };
}

test('Pathfinder rejects a first edge through a partial collision shape but preserves its open exit', () => {
  const movements = movementHarness();
  const blockedEastStep = {
    x: 8102,
    y: 71,
    z: 7938,
    locomotion: { type: 'step_up' },
  };
  const openWestExit = {
    x: 8100,
    y: 70,
    z: 7938,
    locomotion: { type: 'walk' },
  };

  assert.equal(movements.startTransitionIsExecutable(startNode(), blockedEastStep), false);
  assert.equal(movements.startTransitionIsExecutable(startNode(), openWestExit), true);
});

test('Pathfinder preserves the native jump-out edge from a low enclosing block', () => {
  const cauldron = {
    position: new Vec3(20, 64, 20),
    shapes: [
      [0, 0, 0, 1, 0.3125, 1],
      [0, 0.3125, 0, 0.125, 1, 1],
      [0.875, 0.3125, 0, 1, 1, 1],
      [0.125, 0.3125, 0, 0.875, 1, 0.125],
      [0.125, 0.3125, 0.875, 0.875, 1, 1],
    ],
  };
  const movements = Object.create(Movements.prototype);
  movements.bot = { blockAt: () => cauldron };
  const node = {
    x: 20,
    y: 64,
    z: 20,
    physicalStart: {
      x: 20.5,
      y: 64.3125,
      z: 20.5,
      width: 0.6,
      height: 1.8,
    },
  };
  const jumpOut = {
    x: 21,
    y: 64,
    z: 20,
    locomotion: { type: 'drop_down' },
  };

  assert.equal(movements.startTransitionIsExecutable(node, jumpOut), true);
  assert.equal(movements.startTransitionIsExecutable({ x: 20, y: 64, z: 20 }, jumpOut), true);
});
