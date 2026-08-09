import assert from 'node:assert/strict';
import test from 'node:test';

import Vec3 from 'vec3';

import { escapeDrowning } from '../src/agent/library/skills.js';

test('full air in open water completes drowning recovery without inventing a dry shore', async () => {
  const position = new Vec3(0, 64, 0);
  const controls = new Map();
  const pathfinderGoals = [];
  const bot = {
    oxygenLevel: 20,
    interrupt_code: false,
    output: '',
    entity: {
      position,
      isInWater: true,
      isInLava: false,
    },
    pathfinder: {
      setGoal(goal) {
        pathfinderGoals.push(goal);
      },
    },
    clearControlStates() {
      controls.clear();
    },
    setControlState(name, value) {
      controls.set(name, value);
    },
    blockAt(blockPosition) {
      if (
        blockPosition.x === position.x
        && blockPosition.y === position.y + 1
        && blockPosition.z === position.z
      ) {
        return { name: 'air', boundingBox: 'empty' };
      }
      return { name: 'water', boundingBox: 'empty' };
    },
  };

  const result = await escapeDrowning(bot);

  assert.equal(result, true);
  assert.deepEqual(pathfinderGoals, [null]);
  assert.equal(controls.get('jump'), false);
  assert.equal(bot.lastActionEvidence.kind, 'survival');
  assert.equal(bot.lastActionEvidence.outcome, 'drowning_escape_breathable_surface');
  assert.equal(bot.lastActionEvidence.oxygenAfter, 20);
  assert.equal(bot.lastActionEvidence.shore.outcome, 'no_safe_shore');
  assert.equal(bot.lastActionEvidence.retryable, false);
});
