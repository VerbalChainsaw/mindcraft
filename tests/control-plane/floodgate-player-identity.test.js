import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCanonicalPlayerIdentity } from '../../src/agent/agent.js';
import { resolvePlayerDirective } from '../../src/agent/player-directives.js';

function player(username) {
  const entity = { type: 'player', username };
  return { username, entity };
}

function botWithPlayers(usernames) {
  return {
    username: 'MindcraftBot',
    players: Object.fromEntries(usernames.map(username => [username, player(username)])),
    entities: {},
  };
}

test('exact Java player identity wins unchanged', () => {
  const bot = botWithPlayers(['JavaPlayer', '.JavaPlayer']);

  assert.equal(resolveCanonicalPlayerIdentity('JavaPlayer', bot), 'JavaPlayer');
});

test('unique dot-prefixed Floodgate player resolves from the chat identity', () => {
  const bot = botWithPlayers(['.LittleBubby9352']);

  assert.equal(resolveCanonicalPlayerIdentity('LittleBubby9352', bot), '.LittleBubby9352');
  assert.equal(resolveCanonicalPlayerIdentity('littlebubby9352', bot), '.LittleBubby9352');
});

test('ambiguous aliases and bot-agent identities refuse canonical mapping', () => {
  const ambiguousBot = botWithPlayers(['.LittleBubby9352', '.littlebubby9352']);
  assert.equal(resolveCanonicalPlayerIdentity('LittleBubby9352', ambiguousBot), null);

  const botAgent = botWithPlayers(['.WorkerBot']);
  assert.equal(resolveCanonicalPlayerIdentity('WorkerBot', botAgent, {
    isBotAgent: identity => identity === '.WorkerBot',
  }), null);

  const fallback = resolveCanonicalPlayerIdentity('LittleBubby9352', ambiguousBot) || 'LittleBubby9352';
  assert.equal(resolvePlayerDirective(fallback, 'follow me').command, '!followPlayer("LittleBubby9352", 3)');
});

test('follow and come directives preserve the canonical physical target only', () => {
  const source = 'LittleBubby9352';
  const canonical = resolveCanonicalPlayerIdentity(source, botWithPlayers(['.LittleBubby9352']));

  assert.equal(source, 'LittleBubby9352');
  assert.equal(resolvePlayerDirective(canonical, 'follow me').command, '!followPlayer(".LittleBubby9352", 3)');
  assert.equal(resolvePlayerDirective(canonical, 'come here').command, '!goToPlayer(".LittleBubby9352", 2)');
});
