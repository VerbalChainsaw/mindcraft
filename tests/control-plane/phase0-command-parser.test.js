import assert from 'node:assert/strict';
import test from 'node:test';

import { getCommand, parseCommandMessage } from '../../src/agent/commands/index.js';

test('Phase 0 parser accepts equivalent single-quoted and double-quoted follow commands', () => {
  const doubleQuoted = parseCommandMessage('!followPlayer("PlayerName", 4)');
  const singleQuoted = parseCommandMessage("!followPlayer('PlayerName', 4)");

  assert.deepEqual(singleQuoted, doubleQuoted);
  assert.deepEqual(doubleQuoted, {
    commandName: '!followPlayer',
    args: ['PlayerName', 4],
  });
});

test('Command parsing preserves existing callers when a trailing parameter is optional', () => {
  assert.deepEqual(
    parseCommandMessage('!requestItemGoal("acquire", "iron_pickaxe", 1, "ADMIN")'),
    {
      commandName: '!requestItemGoal',
      args: ['acquire', 'iron_pickaxe', 1, 'ADMIN'],
    },
  );
  assert.deepEqual(
    parseCommandMessage('!requestItemGoal("acquire", "iron_pickaxe", 1, "ADMIN", "main_hand")'),
    {
      commandName: '!requestItemGoal',
      args: ['acquire', 'iron_pickaxe', 1, 'ADMIN', 'main_hand'],
    },
  );
  assert.equal(getCommand('!harvestEntityDrop').params.allow_alternative.optional, true);
});
