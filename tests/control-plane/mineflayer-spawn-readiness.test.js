import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { installPlayerLoadedSpawnReadiness } from '../../src/utils/mineflayer-spawn-readiness.js';

function fakeBot({ supported = true } = {}) {
  const bot = new EventEmitter();
  bot.supportFeature = feature => feature === 'sendsPlayerLoadedPacket' && supported;
  bot.writes = [];
  bot._client = {
    write(packet, value) {
      bot.writes.push({ packet, value });
    },
  };
  return bot;
}

test('Mineflayer 4.37.1 acknowledges player_loaded before ordinary spawn listeners', () => {
  const bot = fakeBot();
  const order = [];
  bot.on('spawn', () => order.push('agent-spawn'));

  assert.equal(installPlayerLoadedSpawnReadiness(bot, { mineflayerVersion: '4.37.1' }), true);
  bot.prependListener('spawn', () => order.push('mineflayer-spawn'));
  bot.on('spawn', () => order.push(`packet:${bot.writes[0]?.packet || 'missing'}`));
  bot.emit('spawn');

  assert.deepEqual(bot.writes, [{ packet: 'player_loaded', value: {} }]);
  assert.deepEqual(order, ['mineflayer-spawn', 'agent-spawn', 'packet:player_loaded']);
});
test('the compatibility owner is inert for unsupported protocols and later Mineflayer versions', () => {
  const unsupported = fakeBot({ supported: false });
  assert.equal(installPlayerLoadedSpawnReadiness(unsupported, { mineflayerVersion: '4.37.1' }), true);
  unsupported.emit('spawn');
  assert.deepEqual(unsupported.writes, []);

  const upgraded = fakeBot();
  assert.equal(installPlayerLoadedSpawnReadiness(upgraded, { mineflayerVersion: '4.38.0' }), false);
  upgraded.emit('spawn');
  assert.deepEqual(upgraded.writes, []);
});
