import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectorMatchesPlayerTarget,
  resolvePlayerTarget,
} from '../../src/agent/player-target.js';

function entity(username, id) {
  return { type: 'player', username, id };
}

function botWithPlayers(entries) {
  const players = {};
  for (const [username, id] of entries) {
    const loaded = entity(username, id);
    players[username] = { username, entity: loaded };
  }
  return { username: 'MindcraftBot', players, entities: {} };
}

test('exact Java identity wins over a competing Floodgate alias', () => {
  const bot = botWithPlayers([['JavaPlayer', 1], ['.JavaPlayer', 2]]);
  const resolution = resolvePlayerTarget(bot, 'JavaPlayer');

  assert.equal(resolution.canonical, 'JavaPlayer');
  assert.equal(resolution.entity.id, 1);
  assert.equal(resolution.matchedBy, 'exact');
});

test('raw and dot-prefixed explicit targets resolve to the same loaded Floodgate player', () => {
  const bot = botWithPlayers([['.LittleBubby9352', 7]]);
  const raw = resolvePlayerTarget(bot, 'LittleBubby9352');
  const canonical = resolvePlayerTarget(bot, '.LittleBubby9352');

  assert.equal(raw.canonical, '.LittleBubby9352');
  assert.equal(raw.matchedBy, 'floodgate_prefix');
  assert.equal(canonical.canonical, '.LittleBubby9352');
  assert.equal(canonical.matchedBy, 'exact');
  assert.equal(raw.entity, canonical.entity);
});

test('a unique case-insensitive Floodgate alias resolves conservatively', () => {
  const loaded = entity('.LittleBubby9352', 8);
  const resolution = resolvePlayerTarget(
    { username: 'MindcraftBot', players: {}, entities: { 8: loaded } },
    'littlebubby9352',
  );

  assert.equal(resolution.canonical, '.LittleBubby9352');
  assert.equal(resolution.matchedBy, 'case_insensitive');
});

test('ambiguous aliases, self, and known Mindcraft bots never resolve', () => {
  const ambiguous = resolvePlayerTarget(
    botWithPlayers([['.LittleBubby9352', 9], ['.littlebubby9352', 10]]),
    'LittleBubby9352',
  );
  assert.equal(ambiguous.canonical, null);
  assert.equal(ambiguous.entity, null);
  assert.equal(ambiguous.ambiguous, true);
  assert.deepEqual(ambiguous.aliasesTried, ['LittleBubby9352', '.LittleBubby9352']);

  const identities = botWithPlayers([['MindcraftBot', 11], ['.WorkerBot', 12]]);
  assert.equal(resolvePlayerTarget(identities, 'MindcraftBot').canonical, null);
  assert.equal(resolvePlayerTarget(identities, 'WorkerBot', {
    knownBotNames: ['.WorkerBot'],
  }).canonical, null);
});

test('repeated follow-style samples reacquire a replacement entity through the requested alias', () => {
  const bot = botWithPlayers([['.LittleBubby9352', 20]]);
  const first = resolvePlayerTarget(bot, 'LittleBubby9352');
  const replacement = entity('.LittleBubby9352', 21);
  bot.players['.LittleBubby9352'] = { username: '.LittleBubby9352', entity: replacement };
  const reacquired = resolvePlayerTarget(bot, 'LittleBubby9352');

  assert.equal(first.canonical, '.LittleBubby9352');
  assert.equal(first.entity.id, 20);
  assert.equal(reacquired.canonical, '.LittleBubby9352');
  assert.equal(reacquired.entity.id, 21);
});

test('give delivery accepts only the canonical collector username', () => {
  const resolution = resolvePlayerTarget(
    botWithPlayers([['.LittleBubby9352', 30]]),
    'LittleBubby9352',
  );

  assert.equal(collectorMatchesPlayerTarget(resolution, { username: '.LittleBubby9352' }), true);
  assert.equal(collectorMatchesPlayerTarget(resolution, { username: 'LittleBubby9352' }), false);
  assert.equal(collectorMatchesPlayerTarget({ ...resolution, canonical: null }, { username: '.LittleBubby9352' }), false);
  assert.equal(collectorMatchesPlayerTarget(resolution, { username: '.LittleBubby9352' }, {
    expectedEntityId: 44,
    collected: { id: 43 },
  }), false);
  assert.equal(collectorMatchesPlayerTarget(resolution, { username: '.LittleBubby9352' }, {
    expectedEntityId: 44,
    collected: { id: 44 },
  }), true);
});
