import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getCommand } from '../src/agent/commands/index.js';
import { MemoryBank } from '../src/agent/memory_bank.js';
import { resolvePlayerDirective } from '../src/agent/player-directives.js';

test('player-named places persist, route natural language, and can be forgotten without exposing internal markers', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'mindcraft-named-places-'));
  try {
    const memory = new MemoryBank('PlaceBot', { rootDir });
    memory.load();
    assert.equal(memory.rememberUserPlace('landing', 12.5, 64, -8.5, 'minecraft:overworld'), true);
    assert.equal(memory.rememberDeath(
      { x: 30, y: 12, z: 40 },
      'minecraft:overworld',
      { oak_log: 2 },
    ), true);

    const reloaded = new MemoryBank('PlaceBot', { rootDir });
    reloaded.load();
    assert.deepEqual(reloaded.recallUserPlaceDetails('landing'), {
      x: 12.5,
      y: 64,
      z: -8.5,
      dimension: 'minecraft:overworld',
      updatedAt: reloaded.recallUserPlaceDetails('landing').updatedAt,
    });
    assert.deepEqual(reloaded.getPlaceNames(), ['landing']);
    assert.equal(reloaded.recallUserPlaceDetails('last_death_position'), null);

    const context = { memoryBank: reloaded };
    assert.equal(
      resolvePlayerDirective('Gabriel', 'Remember this place as river camp', context)?.command,
      '!rememberHere("river_camp")',
    );
    assert.equal(
      resolvePlayerDirective('Gabriel', 'What places do you remember?', context)?.command,
      '!savedPlaces',
    );
    assert.equal(
      resolvePlayerDirective('Gabriel', 'Go to landing', context)?.command,
      '!goToRememberedPlace("landing")',
    );
    assert.equal(
      resolvePlayerDirective('Gabriel', 'Forget landing', context)?.command,
      '!forgetRememberedPlace("landing")',
    );
    assert.equal(resolvePlayerDirective('Gabriel', 'Go to store and buy milk', context), null);

    const wrongDimensionBot = {
      entity: { position: { x: 0, y: 64, z: 0 } },
      game: { dimension: 'the_nether' },
      output: '',
    };
    const wrongDimensionAgent = {
      bot: wrongDimensionBot,
      memory_bank: reloaded,
      actions: {
        runAction: async (_label, action) => {
          const completed = await action();
          return {
            interrupted: false,
            timedout: false,
            message: null,
            result: {
              phase: completed === false ? 'failed' : 'succeeded',
              code: completed === false ? 'skill_failed' : 'completed',
              detail: wrongDimensionBot.output.trim(),
            },
          };
        },
      },
    };
    assert.match(
      await getCommand('!goToRememberedPlace').perform(wrongDimensionAgent, 'landing'),
      /minecraft:overworld.*minecraft:nether/,
    );

    assert.equal(reloaded.forgetUserPlace('landing'), true);
    const forgotten = new MemoryBank('PlaceBot', { rootDir });
    forgotten.load();
    assert.equal(forgotten.recallUserPlaceDetails('landing'), null);
    assert.deepEqual(forgotten.getPlaceNames(), []);
    assert.notEqual(forgotten.recallDeath(), null);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
