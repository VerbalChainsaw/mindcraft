import assert from 'node:assert/strict';
import test from 'node:test';

import {
  confirmBotAttributedCombatDeath,
  observeReceivedDamageSource,
  observeCombatDamage,
} from '../src/agent/runtime/combat-attribution.js';

const bot = Object.freeze({ entity: Object.freeze({ id: 7, username: 'MindcraftBot' }) });
const target = Object.freeze({ id: 42, name: 'zombie' });

test('bot-attributed target damage confirms the bot hit', () => {
  const observed = observeCombatDamage(bot, target, target, bot.entity);

  assert.equal(observed.attribution, 'bot');
  assert.equal(observed.confirmsBotHit, true);
  assert.equal(observed.code, 'bot_attributed_damage');
});

test('foreign-attributed target damage never confirms the bot hit', () => {
  const observed = observeCombatDamage(bot, target, target, { id: 99, username: 'OtherPlayer' });

  assert.equal(observed.attribution, 'foreign');
  assert.equal(observed.confirmsBotHit, false);
  assert.equal(observed.code, 'foreign_attributed_damage');
  assert.deepEqual(observed.source, { id: 99, name: 'OtherPlayer' });
});

test('unknown target damage remains unverified without bot-owned evidence', () => {
  const observed = observeCombatDamage(bot, target, target, null);

  assert.equal(observed.attribution, 'unknown');
  assert.equal(observed.confirmsBotHit, false);
  assert.equal(observed.code, 'damage_source_unknown');
});

test('received damage preserves requester, other player, hostile, and unknown source identity', () => {
  const hurtBot = { entity: { id: 7, username: 'MindcraftBot' } };
  const options = { requester: 'DadPlayer', isHostile: entity => entity.name === 'zombie', now: 1_000 };

  const requester = observeReceivedDamageSource(
    hurtBot,
    hurtBot.entity,
    { id: 8, type: 'player', username: 'DadPlayer' },
    options,
  );
  assert.equal(requester.kind, 'requester_player');
  assert.equal(requester.source.username, 'DadPlayer');

  const stranger = observeReceivedDamageSource(
    hurtBot,
    hurtBot.entity,
    { id: 9, type: 'player', username: 'Griefer' },
    options,
  );
  assert.equal(stranger.kind, 'other_player');

  const hostile = observeReceivedDamageSource(
    hurtBot,
    hurtBot.entity,
    { id: 10, type: 'mob', name: 'zombie' },
    options,
  );
  assert.equal(hostile.kind, 'hostile');
  assert.equal(hostile.source.name, 'zombie');

  const unknown = observeReceivedDamageSource(hurtBot, hurtBot.entity, null, options);
  assert.equal(unknown.kind, 'unknown');
  assert.equal(unknown.source, null);
});

test('reused entity id cannot attribute a new entity generation to the old target', () => {
  const bot = { entity: { id: 7, username: 'IronSuiteProof' } };
  const oldTarget = { id: 42, name: 'zombie' };
  const replacement = { id: 42, username: 'IronSuiteProof' };

  const observed = observeCombatDamage(bot, oldTarget, replacement, replacement);

  assert.equal(observed.matchesTarget, false);
  assert.equal(observed.confirmsBotHit, false);
  assert.equal(observed.code, 'different_target');
});

test('combat death requires fresh bot-attributed final damage', () => {
  assert.deepEqual(
    confirmBotAttributedCombatDeath('bot', 1_000, 1_100),
    { confirmed: true, delayMs: 100, code: 'bot_attributed_final_damage' },
  );
  assert.deepEqual(
    confirmBotAttributedCombatDeath('bot', 1_000, 1_251),
    { confirmed: false, delayMs: 251, code: 'final_damage_unconfirmed' },
  );
  assert.deepEqual(
    confirmBotAttributedCombatDeath('foreign', 1_000, 1_010),
    { confirmed: false, delayMs: 10, code: 'foreign_final_damage' },
  );
});
