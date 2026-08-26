import assert from 'node:assert/strict';
import test from 'node:test';
import Vec3 from 'vec3';

import Movements from '../packages/minecraft-runtime/mineflayer-pathfinder/lib/movements.js';

function costMovement() {
  const movement = Object.create(Movements.prototype);
  movement.bot = {
    entity: { effects: {} },
    pathfinder: { bestHarvestTool: () => null },
  };
  movement.digCost = 10;
  movement.entityCost = 1;
  movement.canDig = true;
  movement.blocksCantBreak = new Set();
  movement.exclusionAreasStep = [];
  movement.exclusionAreasBreak = [];
  movement.exclusionAreasPlace = [];
  movement.getNumEntitiesAt = () => 0;
  movement.dontCreateFlow = false;
  movement.dontMineUnderFallingBlock = false;
  return movement;
}

function solidBlock({ digTime = 5_000, type = 1 } = {}) {
  return {
    type,
    name: 'test_block',
    safe: false,
    physical: true,
    openable: false,
    position: new Vec3(1, 64, 0),
    digTime: () => digTime,
  };
}

test('Pathfinder preserves an expensive finite break instead of erasing the edge', () => {
  const movement = costMovement();
  const toBreak = [];

  const cost = movement.safeOrBreak(solidBlock(), toBreak);

  assert.equal(Number.isFinite(cost), true);
  assert.ok(cost > 100, `expected labor cost above the former sentinel, received ${cost}`);
  assert.deepEqual(toBreak, [new Vec3(1, 64, 0)]);
});

test('Pathfinder represents a prohibited break as an impossible cost', () => {
  const movement = costMovement();
  movement.blocksCantBreak.add(1);
  const toBreak = [];

  assert.equal(movement.safeOrBreak(solidBlock(), toBreak), Infinity);
  assert.deepEqual(toBreak, []);
});

test('Pathfinder keeps the documented exclusion weight as a policy prohibition', () => {
  const movement = costMovement();
  movement.exclusionAreasBreak.push(() => 100);
  const toBreak = [];

  assert.equal(movement.exclusionBreak(solidBlock()), Infinity);
  assert.equal(movement.safeOrBreak(solidBlock(), toBreak), Infinity);
  assert.deepEqual(toBreak, []);
});
