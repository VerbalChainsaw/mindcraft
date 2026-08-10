import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { Vec3 } from 'vec3';

const require = createRequire(import.meta.url);
const injectBedPlugin = require('../../node_modules/mineflayer/lib/plugins/bed.js');

test('owned Mineflayer sleep returns a completed transition when Paper skips directly to dawn', async () => {
  const bot = Object.assign(new EventEmitter(), {
    _client: new EventEmitter(),
    entity: { id: 7, position: new Vec3(0, 64, 1) },
    entities: {},
    game: { gameMode: 'survival' },
    time: { time: 13_000, timeOfDay: 13_000 },
    isRaining: false,
    thunderState: 0,
    supportFeature(name) {
      return name === 'blockMetadata';
    },
    canDigBlock() {
      return true;
    },
    activateBlock() {
      queueMicrotask(() => {
        this.time.time = 24_010;
        this.time.timeOfDay = 10;
        this.emit('time');
      });
    },
  });
  injectBedPlugin(bot);
  const bed = { name: 'gray_bed', metadata: 8, position: new Vec3(0, 64, 0) };

  const result = await bot.sleep(bed);

  assert.deepEqual(result, {
    enteredSleep: true,
    woke: true,
    immediateDawn: true,
    evidence: 'day_advance',
  });
  assert.equal(bot.isSleeping, false);
  assert.equal(bot.listenerCount('sleep'), 0);
  assert.equal(bot.listenerCount('time'), 0);
});

test('owned Mineflayer wake uses the protocol-mapped leave-bed action', async () => {
  const packets = [];
  const bot = Object.assign(new EventEmitter(), {
    _client: Object.assign(new EventEmitter(), {
      write(name, payload) { packets.push({ name, payload }); },
    }),
    entity: { id: 11, position: new Vec3(0, 64, 0) },
    supportFeature() { return false; },
  });
  injectBedPlugin(bot);
  bot.isSleeping = true;

  await bot.wake();

  assert.deepEqual(packets, [{
    name: 'entity_action',
    payload: { entityId: 11, actionId: 'leave_bed', jumpBoost: 0 },
  }]);
});
