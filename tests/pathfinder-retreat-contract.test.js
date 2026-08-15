import assert from 'node:assert/strict';
import test from 'node:test';
import { Vec3 } from 'vec3';

import goalsModule from '../packages/minecraft-runtime/mineflayer-pathfinder/lib/goals.js';
import {
  configureReturnableCombatMovements,
  createCourtesySpacingGoal,
  isDrySupportedStandingStance,
} from '../src/agent/library/skills.js';

const { GoalOutsideEntityXZRadius, GoalOutsideXZRadius } = goalsModule;

test('horizontal retreat cannot be satisfied by descending into a cave', () => {
  const goal = new GoalOutsideXZRadius(100, 67, 100, 32, 4);

  assert.equal(goal.isEnd({ x: 100, y: 35, z: 100 }), false);
  assert.equal(goal.isEnd({ x: 132, y: 67, z: 100 }), true);
  assert.equal(goal.isEnd({ x: 132, y: 62, z: 100 }), false);
  assert.ok(goal.heuristic({ x: 100, y: 35, z: 100 }) > 32);
});

test('horizontal retreat applies every recent-region exclusion in XZ', () => {
  const goal = new GoalOutsideXZRadius(0, 64, 0, 8, 2, [
    { x: 8, z: 0, range: 8 },
  ]);

  assert.equal(goal.isEnd({ x: 8, y: 64, z: 0 }), false);
  assert.equal(goal.isEnd({ x: 16, y: 64, z: 8 }), true);
});

test('moving-entity retreat tracks horizontal threat motion without accepting cave depth', () => {
  const entity = { position: new Vec3(100, 67, 100) };
  const goal = new GoalOutsideEntityXZRadius(entity, 10, 67, 4);

  assert.equal(goal.isEnd({ x: 100, y: 54, z: 100 }), false);
  assert.equal(goal.isEnd({ x: 110, y: 67, z: 100 }), true);

  entity.position = new Vec3(105, 66, 100);
  assert.equal(goal.hasChanged(), true);
  assert.equal(goal.isEnd({ x: 110, y: 67, z: 100 }), false);
  assert.equal(goal.isEnd({ x: 115, y: 63, z: 100 }), true);
});

test('courtesy spacing goal requires displacement and increased room from every participant', () => {
  const contract = createCourtesySpacingGoal(new Vec3(0, 64, 0), [
    { name: 'DadPlayer', entity: { position: new Vec3(-2, 64, 0) } },
    { name: 'KidPlayer', entity: { position: new Vec3(2, 64, 0) } },
  ], 4, 1);

  assert.equal(contract.goal.isEnd({ x: 4, y: 64, z: 0 }), false);
  assert.equal(contract.goal.isEnd({ x: 0, y: 62, z: 4 }), false);
  assert.equal(contract.goal.isEnd({ x: 0, y: 64, z: 4 }), true);
  assert.deepEqual(contract.participants.map(participant => participant.name), [
    'DadPlayer',
    'KidPlayer',
  ]);
});

test('combat retreat settlement requires dry feet on traversable support', () => {
  const blocks = new Map([
    ['4,64,7', { name: 'air', boundingBox: 'empty' }],
    ['4,63,7', { name: 'grass_block', boundingBox: 'block' }],
    ['5,64,7', { name: 'water', boundingBox: 'empty' }],
    ['5,63,7', { name: 'sand', boundingBox: 'block' }],
    ['6,64,7', { name: 'air', boundingBox: 'empty' }],
    ['6,63,7', { name: 'lava', boundingBox: 'empty' }],
  ]);
  const bot = {
    blockAt(position) {
      return blocks.get(`${position.x},${position.y},${position.z}`) || null;
    },
  };

  assert.equal(isDrySupportedStandingStance(bot, new Vec3(4, 64, 7)), true);
  assert.equal(isDrySupportedStandingStance(bot, new Vec3(5, 64, 7)), false);
  assert.equal(isDrySupportedStandingStance(bot, new Vec3(6, 64, 7)), false);
});

test('combat pursuit delegates to Pathfinder without advertising one-way drops', () => {
  const movements = {
    canDig: true,
    canPlaceBlocks: true,
    allow1by1towers: true,
    allowParkour: true,
    maxDropDown: 4,
    infiniteLiquidDropdownDistance: true,
  };

  assert.equal(configureReturnableCombatMovements(movements), movements);
  assert.deepEqual(movements, {
    canDig: false,
    canPlaceBlocks: false,
    allow1by1towers: false,
    allowParkour: false,
    maxDropDown: 1,
    infiniteLiquidDropdownDistance: false,
  });
});
