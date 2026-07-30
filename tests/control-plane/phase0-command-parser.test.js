import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCommandMessage } from '../../src/agent/commands/index.js';

test('Phase 0 parser accepts equivalent single-quoted and double-quoted follow commands', () => {
  const doubleQuoted = parseCommandMessage('!followPlayer("PlayerName", 4)');
  const singleQuoted = parseCommandMessage("!followPlayer('PlayerName', 4)");

  assert.deepEqual(singleQuoted, doubleQuoted);
  assert.deepEqual(doubleQuoted, {
    commandName: '!followPlayer',
    args: ['PlayerName', 4],
  });
});
