import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const INSTALLED_MINEFLAYER_VERSION = require('mineflayer/package.json').version;
const INSTALL_MARKER = Symbol('mindcraft.playerLoadedSpawnReadiness');

/**
 * Mineflayer 4.37.1 emits `spawn` on 1.21.4+ without first sending the
 * protocol's player_loaded acknowledgement. Paper may ignore block and item
 * interactions for the next 60 ticks. Upstream fixed this after 4.37.1; keep
 * the compatibility owner version-scoped so a later dependency update cannot
 * send the packet twice.
 */
export function installPlayerLoadedSpawnReadiness(bot, {
  mineflayerVersion = INSTALLED_MINEFLAYER_VERSION,
} = {}) {
  if (!bot || mineflayerVersion !== '4.37.1' || bot[INSTALL_MARKER]) return false;
  if (typeof bot.prependListener !== 'function') return false;

  const sendPlayerLoaded = () => {
    let supported = false;
    try {
      supported = bot.supportFeature?.('sendsPlayerLoadedPacket') === true;
    } catch {
      return;
    }
    if (supported) bot._client?.write?.('player_loaded', {});
  };

  bot.prependListener('spawn', sendPlayerLoaded);
  Object.defineProperty(bot, INSTALL_MARKER, { value: true });
  return true;
}
