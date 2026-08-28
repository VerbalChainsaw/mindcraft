import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import minecraftData from 'minecraft-data';

const require = createRequire(import.meta.url);
const mineflayerPackage = require('../../node_modules/mineflayer/package.json');
const injectHealthPlugin = require('../../node_modules/mineflayer/lib/plugins/health.js');

function fakeBot(version) {
  const registry = minecraftData(version);
  const bot = new EventEmitter();
  bot._client = new EventEmitter();
  bot.isAlive = true;
  bot.writes = [];
  bot.supportFeature = feature => registry.supportFeature(feature);
  bot._client.write = (packet, value) => bot.writes.push({ packet, value });
  return bot;
}

test('Mineflayer 4.38.0 natively acknowledges player_loaded before spawn listeners run', () => {
  assert.equal(mineflayerPackage.version, '4.38.0');

  const bot = fakeBot('1.21.4');
  const spawnWrites = [];
  bot.on('spawn', () => spawnWrites.push([...bot.writes]));
  injectHealthPlugin(bot, { respawn: false });

  bot._client.emit('update_health', {
    health: 20,
    food: 20,
    foodSaturation: 5,
  });

  assert.deepEqual(bot.writes, [{ packet: 'player_loaded', value: {} }]);
  assert.deepEqual(spawnWrites, [[{ packet: 'player_loaded', value: {} }]]);
});

test('the resolved minecraft-data release exposes the upstream spawn feature gate', () => {
  assert.equal(minecraftData('1.21.4').supportFeature('sendsPlayerLoadedPacket'), true);
  assert.equal(minecraftData('1.20.4').supportFeature('sendsPlayerLoadedPacket'), false);
});
