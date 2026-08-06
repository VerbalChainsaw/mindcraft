import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { ContainerOpenGate } = require('../../node_modules/mineflayer/lib/container_open_gate.js');

function gateFixture(responseHorizonMs = 120) {
  const bot = new EventEmitter();
  let activations = 0;
  let closes = 0;
  const gate = new ContainerOpenGate(bot, {
    responseHorizonMs,
    closeLateWindow() {
      closes += 1;
    },
  });
  return {
    bot,
    gate,
    activate() {
      activations += 1;
    },
    counts: () => ({ activations, closes }),
  };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('aborted container activation settles promptly but quarantines and closes its late window', async () => {
  const fixture = gateFixture(160);
  const controller = new AbortController();
  const startedAt = Date.now();
  const cancelled = fixture.gate.open(
    () => fixture.activate(),
    { signal: controller.signal, timeoutMs: 80 },
  );

  controller.abort();
  await assert.rejects(cancelled, error => (
    error?.name === 'AbortError' && error?.code === 'CONTAINER_OPEN_ABORTED'
  ));
  assert.ok(Date.now() - startedAt < 75, 'abort should not wait for Mineflayer response horizon');
  assert.equal(fixture.gate.isQuarantined, true);
  assert.equal(fixture.bot.listenerCount('windowOpen'), 1);
  await assert.rejects(
    fixture.gate.open(() => fixture.activate()),
    error => error?.code === 'CONTAINER_OPEN_QUARANTINED',
  );

  // The old action has already returned, but this response is still owned by
  // its generation and must be disposed rather than becoming a usable window.
  await delay(95);
  fixture.bot.emit('windowOpen', { id: 17, type: 'minecraft:generic_9x3' });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(fixture.counts(), { activations: 1, closes: 1 });
  assert.equal(fixture.gate.isQuarantined, false);
  assert.equal(fixture.bot.listenerCount('windowOpen'), 0);

  const freshWindow = { id: 18, type: 'minecraft:generic_9x3' };
  const fresh = fixture.gate.open(() => fixture.activate());
  fixture.bot.emit('windowOpen', freshWindow);
  assert.equal(await fresh, freshWindow);
  assert.deepEqual(fixture.counts(), { activations: 2, closes: 1 });
  assert.equal(fixture.bot.listenerCount('windowOpen'), 0);
});

test('container quarantine expires at the bounded response horizon without a late window', async () => {
  const fixture = gateFixture(55);
  const controller = new AbortController();
  const cancelled = fixture.gate.open(
    () => fixture.activate(),
    { signal: controller.signal, timeoutMs: 20 },
  );

  controller.abort();
  await assert.rejects(cancelled, error => error?.code === 'CONTAINER_OPEN_ABORTED');
  await delay(25);
  await assert.rejects(
    fixture.gate.open(() => fixture.activate()),
    error => error?.code === 'CONTAINER_OPEN_QUARANTINED',
  );
  await delay(40);

  assert.equal(fixture.gate.isQuarantined, false);
  assert.equal(fixture.bot.listenerCount('windowOpen'), 0);

  const freshWindow = { id: 22, type: 'minecraft:generic_9x3' };
  const fresh = fixture.gate.open(() => fixture.activate());
  fixture.bot.emit('windowOpen', freshWindow);
  assert.equal(await fresh, freshWindow);
  assert.deepEqual(fixture.counts(), { activations: 2, closes: 0 });
});
