import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { Physics, PlayerState } = require('prismarine-physics');
const Vec3 = require('vec3');
const mcData = require('minecraft-data')('1.21.11');
const Block = require('prismarine-block')('1.21.11');

function blockAt(name, position) {
  const block = new Block(mcData.blocksByName[name].id, 0, 0);
  block.position = position.clone();
  return block;
}

function createWorld() {
  return {
    getBlock(position) {
      if (position.y === 62) return blockAt('water', position);
      if (position.y < 62) return blockAt('stone', position);
      return blockAt('air', position);
    },
  };
}

function createBot(position) {
  return {
    version: '1.21.11',
    entity: {
      position,
      velocity: new Vec3(0, 0, 0),
      onGround: false,
      isInWater: false,
      isInLava: false,
      isInWeb: false,
      isCollidedHorizontally: false,
      isCollidedVertically: false,
      elytraFlying: false,
      yaw: 0,
      pitch: 0,
      effects: {},
      attributes: {},
    },
    inventory: { slots: [] },
    jumpTicks: 0,
    jumpQueued: false,
    fireworkRocketDuration: 0,
  };
}

const jumpControls = {
  forward: false,
  back: false,
  left: false,
  right: false,
  jump: true,
  sprint: false,
  sneak: false,
};

test('surface-deep feet remain in water so jump produces native swim ascent', () => {
  const world = createWorld();
  const physics = Physics(mcData, world);
  const bot = createBot(new Vec3(0.5, 62.6, 0.5));
  const state = new PlayerState(bot, jumpControls);

  physics.simulatePlayer(state, world);

  assert.equal(state.isInWater, true);
  assert.ok(state.pos.y > 62.6, `expected upward water motion, observed y=${state.pos.y}`);
  assert.ok(state.vel.y > 0, `expected positive water velocity, observed ${state.vel.y}`);
});

test('feet wholly above the rendered water surface remain dry', () => {
  const world = createWorld();
  const physics = Physics(mcData, world);
  const bot = createBot(new Vec3(0.5, 63.01, 0.5));
  const state = new PlayerState(bot, jumpControls);

  physics.simulatePlayer(state, world);

  assert.equal(state.isInWater, false);
});
