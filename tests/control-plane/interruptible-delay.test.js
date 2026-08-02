import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';

import {
  INTERRUPT_EVENT,
  interruptibleDelay,
  signalInterrupt,
  waitForBotEvent,
} from '../../src/agent/runtime/interruptible-delay.js';

function createBot() {
  const bot = new EventEmitter();
  bot.interrupt_code = false;
  return bot;
}

test('Given no interrupt, a wait runs for its requested duration', async () => {
  const bot = createBot();
  const started = Date.now();

  const reason = await interruptibleDelay(bot, 120);

  assert.equal(reason, 'elapsed');
  assert.ok(Date.now() - started >= 80, 'the wait should not end early on its own');
});

test('Given an interrupt mid-wait, the skill is released without waiting out its period', async () => {
  const bot = createBot();
  const started = Date.now();
  setTimeout(() => {
    bot.interrupt_code = true;
    signalInterrupt(bot);
  }, 30);

  const reason = await interruptibleDelay(bot, 5_000);
  const elapsed = Date.now() - started;

  assert.equal(reason, 'interrupted');
  assert.ok(elapsed < 1_000, `expected prompt release, waited ${elapsed}ms`);
});

test('Given an already interrupted bot, a wait does not begin', async () => {
  const bot = createBot();
  bot.interrupt_code = true;
  const started = Date.now();

  const reason = await interruptibleDelay(bot, 5_000);

  assert.equal(reason, 'interrupted');
  assert.ok(Date.now() - started < 200, 'an interrupted bot must not park');
});

// Every wait attaches a listener to the bot. Leaking one per call would build
// up silently across a long session and eventually warn or retain memory.
test('Given many completed waits, no interrupt listeners are retained', async () => {
  const bot = createBot();

  await Promise.all(Array.from({ length: 40 }, () => interruptibleDelay(bot, 1)));
  assert.equal(bot.listenerCount(INTERRUPT_EVENT), 0, 'elapsed waits must detach');

  const pending = interruptibleDelay(bot, 5_000);
  assert.equal(bot.listenerCount(INTERRUPT_EVENT), 1);
  signalInterrupt(bot);
  await pending;
  assert.equal(bot.listenerCount(INTERRUPT_EVENT), 0, 'interrupted waits must detach');
});

test('Given a bot with no emitter, a wait still completes rather than throwing', async () => {
  const reason = await interruptibleDelay({}, 10);

  assert.equal(reason, 'elapsed');
});

test('Given the awaited edge, a waiting loop resumes without serving out its bound', async () => {
  const bot = createBot();
  const started = Date.now();
  setTimeout(() => bot.emit('idle'), 30);

  const reason = await waitForBotEvent(bot, 'idle', 5_000);
  const elapsed = Date.now() - started;

  assert.equal(reason, 'idle');
  assert.ok(elapsed < 1_000, `expected the edge to release the wait, waited ${elapsed}ms`);
});

// The bound exists so a missed edge cannot park the loop forever.
test('Given no edge, a waiting loop still gives up at its bound', async () => {
  const bot = createBot();

  const reason = await waitForBotEvent(bot, 'idle', 60);

  assert.equal(reason, 'timeout');
});

test('Given many waits, no event listeners are retained', async () => {
  const bot = createBot();

  await Promise.all(Array.from({ length: 20 }, () => waitForBotEvent(bot, 'idle', 1)));
  assert.equal(bot.listenerCount('idle'), 0, 'timed-out waits must detach');

  const pending = waitForBotEvent(bot, 'idle', 5_000);
  assert.equal(bot.listenerCount('idle'), 1);
  bot.emit('idle');
  await pending;
  assert.equal(bot.listenerCount('idle'), 0, 'satisfied waits must detach');
});
