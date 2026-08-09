import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { goToGoal } from '../src/agent/library/skills.js';

const require = createRequire(import.meta.url);
const Vec3 = require('vec3');
const mcData = require('minecraft-data')('1.21.11');
const Block = require('prismarine-block')('1.21.11');

function blockAt(name, position) {
  const block = new Block(mcData.blocksByName[name].id, 0, 0);
  block.position = position.clone();
  return block;
}

test('a Pathfinder computation timeout does not trigger an identical local retry', async () => {
  const position = new Vec3(0.5, 64, 0.5);
  let gotoCalls = 0;
  const bot = {
    version: '1.21.11',
    interrupt_code: false,
    output: '',
    health: 20,
    controlState: {},
    entity: {
      position,
      width: 0.6,
      height: 1.8,
      isInWater: false,
    },
    pathfinder: {
      setMovements() {},
      setGoal() {},
      getLastStuckState() { return null; },
      async goto() {
        gotoCalls += 1;
        const error = new Error('Took too long to decide path to goal!');
        error.name = 'Timeout';
        throw error;
      },
    },
    on() {},
    removeListener() {},
    clearControlStates() {},
    blockAt(blockPosition) {
      return blockAt(blockPosition.y < 64 ? 'stone' : 'air', blockPosition);
    },
  };
  const goal = {
    x: 32,
    y: 64,
    z: 0,
    isEnd() { return false; },
    heuristic(node) { return Math.abs(32 - node.x); },
  };

  const result = await goToGoal(bot, goal, { movements: {} });

  assert.equal(result, false);
  assert.equal(gotoCalls, 1);
  assert.equal(bot.lastActionEvidence.kind, 'movement');
  assert.equal(bot.lastActionEvidence.outcome, 'path_timeout');
  assert.equal(bot.lastActionEvidence.recovery, undefined);
});
