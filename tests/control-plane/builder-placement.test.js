import assert from 'node:assert/strict';
import test from 'node:test';

import { placeBlock } from '../../src/agent/library/skills.js';

test('Given a blueprint cell occupied by an unrelated block, strict placement refuses to break it', async () => {
  const material = { name: 'stone', count: 1 };
  const bot = {
    restrict_to_inventory: true,
    modes: { isOn: () => false },
    game: { gameMode: 'survival' },
    inventory: {
      findInventoryItem: name => name === 'stone' ? material : null,
    },
    blockAt: () => ({
      name: 'crafting_table',
      position: { x: 1, y: 64, z: 1 },
    }),
  };

  const result = await placeBlock(bot, 'stone', 1, 64, 1, 'bottom', true, false);

  assert.equal(result, false);
  assert.equal(bot.lastActionEvidence.kind, 'place');
  assert.equal(bot.lastActionEvidence.outcome, 'occupied');
  assert.equal(bot.lastActionEvidence.observed, 'crafting_table');
  assert.equal(bot.lastActionEvidence.retryable, false);
});
