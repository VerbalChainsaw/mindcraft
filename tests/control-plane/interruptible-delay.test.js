import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';

import {
  INTERRUPT_EVENT,
  interruptibleDelay,
  signalInterrupt,
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
