import assert from 'node:assert/strict';
import test from 'node:test';

import { getCommand, parseCommandMessage } from '../../src/agent/commands/index.js';

test('consume admits the verified semantic healing selector', () => {
  assert.deepEqual(parseCommandMessage('!consume("healing_potion")'), {
    commandName: '!consume',
    args: ['healing_potion'],
  });
});

test('consume admits the verified semantic best-food selector', () => {
  assert.deepEqual(parseCommandMessage('!consume("best_food")'), {
    commandName: '!consume',
    args: ['best_food'],
  });
});

test('Phase 0 parser accepts equivalent single-quoted and double-quoted follow commands', () => {
  const doubleQuoted = parseCommandMessage('!followPlayer("PlayerName", 4)');
  const singleQuoted = parseCommandMessage("!followPlayer('PlayerName', 4)");

  assert.deepEqual(singleQuoted, doubleQuoted);
  assert.deepEqual(doubleQuoted, {
    commandName: '!followPlayer',
    args: ['PlayerName', 4],
  });
});

test('continuous player pursuit publishes composed receipts for shared settlement', () => {
  assert.equal(getCommand('!followPlayer').perform.receiptMode, 'composed');
  assert.equal(getCommand('!guardPlayer').perform.receiptMode, 'composed');
});

test('activated resource collection commands publish composed terminal receipts', () => {
  assert.equal(getCommand('!collectBlocksInRange').perform.receiptMode, 'composed');
  assert.equal(getCommand('!collectWood').perform.receiptMode, 'composed');
  assert.equal(getCommand('!collectWoodInRange').perform.receiptMode, 'composed');
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

test('Fishing breakfast commands preserve durable baselines and exact furnace coordinates', () => {
  assert.deepEqual(
    parseCommandMessage('!fish(3, "cod:1|salmon:2")'),
    { commandName: '!fish', args: [3, 'cod:1|salmon:2'] },
  );
  assert.deepEqual(
    parseCommandMessage('!cookCaughtFish(3, 8102, 70, 7938, "overworld", "none", "cooked_cod:2")'),
    {
      commandName: '!cookCaughtFish',
      args: [3, 8102, 70, 7938, 'overworld', 'none', 'cooked_cod:2'],
    },
  );
  assert.deepEqual(
    parseCommandMessage('!giveFamilyToPlayer("cooked_fish", "DadPlayer", 3, "none")'),
    {
      commandName: '!giveFamilyToPlayer',
      args: ['cooked_fish', 'DadPlayer', 3, 'none'],
    },
  );
});
