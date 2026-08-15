import assert from 'node:assert/strict';
import test from 'node:test';

import Vec3 from 'vec3';

import {
  configureDryRouteMovements,
  escapeDrowning,
  syncFollowSurfaceAscent,
} from '../src/agent/library/skills.js';

test('critical recovery routes remove water from the native Pathfinder graph', () => {
  const movements = {
    blocksToAvoid: new Set(),
    infiniteLiquidDropdownDistance: true,
  };
  const configured = configureDryRouteMovements(movements, {
    registry: { blocksByName: { water: { id: 42 } } },
  });

  assert.equal(configured, movements);
  assert.equal(configured.blocksToAvoid.has(42), true);
  assert.equal(configured.infiniteLiquidDropdownDistance, false);
});

test('shoreline-bound follow refreshes native ascent until dry settlement', () => {
  const controls = [];
  const bot = {
    setControlState(name, value) {
      controls.push([name, value]);
    },
  };

  let active = syncFollowSurfaceAscent(bot, {
    botInLiquid: true,
    playerDryAndSupported: true,
  });
  assert.equal(active, true);

  active = syncFollowSurfaceAscent(bot, {
    botInLiquid: true,
    playerDryAndSupported: true,
    active,
  });
  assert.equal(active, true);
  assert.deepEqual(controls, [['jump', true], ['jump', true]]);

  active = syncFollowSurfaceAscent(bot, {
    botInLiquid: false,
    playerDryAndSupported: true,
    active,
  });
  assert.equal(active, false);
  assert.deepEqual(controls.at(-1), ['jump', false]);

  syncFollowSurfaceAscent(bot, {
    botInLiquid: false,
    playerDryAndSupported: true,
    active,
  });
  assert.equal(controls.length, 3, 'dry follow does not compete with Pathfinder controls');
});

test('full air in open water remains a retryable emergency until dry shore is verified', async () => {
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

  assert.equal(result, false);
  assert.deepEqual(pathfinderGoals, [null]);
  assert.equal(controls.get('jump'), false);
  assert.equal(bot.lastActionEvidence.kind, 'survival');
  assert.equal(bot.lastActionEvidence.outcome, 'drowning_escape_open_water');
  assert.equal(bot.lastActionEvidence.oxygenAfter, 20);
  assert.equal(bot.lastActionEvidence.shore.outcome, 'no_safe_shore');
  assert.equal(bot.lastActionEvidence.retryable, true);
});
