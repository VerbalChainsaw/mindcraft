import assert from 'node:assert/strict';
import test from 'node:test';

import { goToBed } from '../../src/agent/library/skills.js';

function position(x, y, z) {
  return {
    x,
    y,
    z,
    distanceTo(other) {
      return Math.hypot(x - other.x, y - other.y, z - other.z);
    },
  };
}

function createBot() {
  const bedPosition = position(4, 64, 0);
  const bot = {
    interrupt_code: false,
    isSleeping: false,
    entity: { position: position(0, 64, 0) },
    modes: { pause() {} },
    findBlocks: () => [bedPosition],
    blockAt: () => ({ name: 'white_bed', position: bedPosition }),
    nearestEntity: () => null,
    sleep() {
      this.isSleeping = true;
    },
    wake() {
      this.isSleeping = false;
    },
  };
  return { bot, bedPosition };
}

test('Given an unreachable bed, verified sleep fails without calling Mineflayer sleep', async () => {
  const { bot } = createBot();
  let sleepCalls = 0;
  bot.sleep = () => { sleepCalls += 1; };

  const result = await goToBed(bot, {
    navigate: () => false,
    delay: () => {},
  });

  assert.equal(result, false);
  assert.equal(sleepCalls, 0);
  assert.equal(bot.lastActionEvidence.kind, 'sleep');
  assert.equal(bot.lastActionEvidence.outcome, 'unreachable');
  assert.deepEqual(bot.lastActionEvidence.target, {
    name: 'white_bed',
    x: 4,
    y: 64,
    z: 0,
    dimension: '',
  });
  assert.equal(bot.lastActionEvidence.retryable, true);
});

test('Given a multiplayer night, verified sleep remains owned past the old 20-second ceiling and succeeds at dawn', async () => {
  const { bot } = createBot();
  const pauses = [];
  bot.modes.pause = mode => pauses.push(mode);
  let now = 1_000;
  let sleepPolls = 0;
  const result = await goToBed(bot, {
    navigate: () => true,
    now: () => now,
    delay: () => {
      now += 250;
      sleepPolls += 1;
      if (now > 26_000) bot.isSleeping = false;
    },
  });

  assert.equal(result, true);
  assert.ok(sleepPolls > 80);
  assert.deepEqual(pauses, ['unstuck']);
  assert.equal(bot.lastActionEvidence.kind, 'sleep');
  assert.equal(bot.lastActionEvidence.outcome, 'slept');
  assert.equal(bot.lastActionEvidence.enteredSleep, true);
  assert.equal(bot.lastActionEvidence.woke, true);
  assert.equal(bot.lastActionEvidence.retryable, false);
});

test('Given Mineflayer sleep rejections, evidence preserves the physical cause and retry policy', async () => {
  const cases = [
    ['there are monsters nearby', 'hostiles_near_bed', true],
    ["it's not night and it's not a thunderstorm", 'not_sleep_time', true],
    ["there's only half bed", 'bed_incomplete', false],
    ['wrong block : not a bed block', 'bed_changed', false],
  ];

  for (const [message, outcome, retryable] of cases) {
    const { bot } = createBot();
    bot.sleep = () => { throw new Error(message); };
    const result = await goToBed(bot, { navigate: () => true });
    assert.equal(result, false);
    assert.equal(bot.lastActionEvidence.outcome, outcome);
    assert.equal(bot.lastActionEvidence.retryable, retryable);
    assert.equal(bot.lastActionEvidence.error, message);
  }
});

test('Given Stop while sleeping, physical ownership is retained until Mineflayer confirms wake', async () => {
  const { bot } = createBot();
  let polls = 0;
  let wakeCalls = 0;
  bot.wake = () => { wakeCalls += 1; };

  const result = await goToBed(bot, {
    navigate: () => true,
    delay: () => {
      polls += 1;
      if (polls === 1) bot.interrupt_code = true;
      if (polls === 3) bot.isSleeping = false;
    },
  });

  assert.equal(result, false);
  assert.equal(wakeCalls, 1);
  assert.equal(polls, 3);
  assert.equal(bot.lastActionEvidence.outcome, 'interrupted');
  assert.equal(bot.lastActionEvidence.enteredSleep, true);
  assert.equal(bot.lastActionEvidence.woke, true);
});

test('Given an exact structure bed, sleep ignores a closer decoy and verifies the requested dimension', async () => {
  const { bot, bedPosition } = createBot();
  bot.game = { dimension: 'overworld' };
  let searches = 0;
  bot.findBlocks = () => {
    searches += 1;
    return [position(1, 64, 0)];
  };
  const navigated = [];
  let now = 2_000;
  const result = await goToBed(bot, {
    exactPosition: bedPosition,
    expectedDimension: 'overworld',
    navigate: (_bot, x, y, z) => {
      navigated.push({ x, y, z });
      return true;
    },
    now: () => now,
    delay: () => {
      now += 250;
      bot.isSleeping = false;
    },
  });

  assert.equal(result, true);
  assert.equal(searches, 0);
  assert.deepEqual(navigated, [{ x: 4, y: 64, z: 0 }]);
  assert.equal(bot.lastActionEvidence.target.dimension, 'overworld');

  const wrongWorld = await goToBed(bot, {
    exactPosition: bedPosition,
    expectedDimension: 'the_nether',
  });
  assert.equal(wrongWorld, false);
  assert.equal(bot.lastActionEvidence.outcome, 'bed_search_failed');
});
