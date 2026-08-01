import assert from 'node:assert/strict';
import test from 'node:test';

import { observeCombatDamage } from '../src/agent/runtime/combat-attribution.js';

const bot = Object.freeze({ entity: Object.freeze({ id: 7, username: 'MindcraftBot' }) });
const target = Object.freeze({ id: 42, name: 'zombie' });

test('bot-attributed target damage confirms the bot hit', () => {
  const observed = observeCombatDamage(bot, target.id, target, bot.entity);

  assert.equal(observed.attribution, 'bot');
  assert.equal(observed.confirmsBotHit, true);
  assert.equal(observed.code, 'bot_attributed_damage');
});

test('foreign-attributed target damage never confirms the bot hit', () => {
  const observed = observeCombatDamage(bot, target.id, target, { id: 99, username: 'OtherPlayer' });

  assert.equal(observed.attribution, 'foreign');
  assert.equal(observed.confirmsBotHit, false);
  assert.equal(observed.code, 'foreign_attributed_damage');
  assert.deepEqual(observed.source, { id: 99, name: 'OtherPlayer' });
});

test('unknown target damage remains unverified without bot-owned evidence', () => {
  const observed = observeCombatDamage(bot, target.id, target, null);

  assert.equal(observed.attribution, 'unknown');
  assert.equal(observed.confirmsBotHit, false);
  assert.equal(observed.code, 'damage_source_unknown');
});
