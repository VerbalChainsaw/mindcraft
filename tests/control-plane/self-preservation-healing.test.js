import assert from 'node:assert/strict';
import test from 'node:test';

import {
  openWaterDrowningEscapeDecision,
  rearmDeterioratingSelfPreservationRetreat,
  rearmOpenWaterDrowningEscape,
  recentDamageRequiresRetreat,
  shouldUseCriticalHealingPotion,
} from '../../src/agent/modes.js';

test('open-water breathing retains emergency retry authority ahead of combat', () => {
  const wakeReasons = [];
  const mode = { next_retry_at: 21_500 };
  const agent = {
    bot: {
      entity: { isInWater: true, position: { x: 0, y: 63, z: 0 } },
      game: { dimension: 'overworld' },
      health: 10,
      oxygenLevel: 20,
      blockAt: () => ({ name: 'water' }),
    },
    goal_director: {
      activeGoal: {
        id: 'goal-obsidian',
        phase: 'assess',
        checkpoint: {
          miningReturnRoute: [{ x: 0, y: 63, z: 0 }],
          miningReturnIndex: 0,
        },
      },
    },
    behavior_arbiter: { wake: reason => wakeReasons.push(reason) },
  };
  const execution = {
    interrupted: false,
    result: {
      phase: 'failed',
      evidence: {
        skill: {
          kind: 'survival',
          outcome: 'drowning_escape_open_water',
          retryable: true,
          shore: { outcome: 'no_safe_shore', candidates: 0 },
        },
      },
    },
  };

  assert.equal(rearmOpenWaterDrowningEscape(mode, agent, execution), true);
  assert.equal(mode.next_retry_at, 21_500, 'settlement backoff must not be erased');
  assert.deepEqual(wakeReasons, ['open_water_drowning_handoff']);
  assert.equal(mode.failed_drowning_trigger.goalId, 'goal-obsidian');

  assert.deepEqual(
    openWaterDrowningEscapeDecision(mode, agent),
    {
      eligible: false,
      blocking: false,
      code: 'open_water_mining_return_handoff',
    },
  );

  agent.goal_director.activeGoal.checkpoint.miningReturnRoute = [];
  assert.deepEqual(
    openWaterDrowningEscapeDecision(mode, agent),
    {
      eligible: false,
      blocking: true,
      code: 'open_water_escape_waiting_for_material_change',
    },
  );

  agent.bot.oxygenLevel = 12;
  assert.deepEqual(
    openWaterDrowningEscapeDecision(mode, agent),
    {
      eligible: true,
      blocking: false,
      code: 'open_water_escape_material_changed',
    },
  );
  assert.equal(mode.failed_drowning_trigger, null);

  agent.bot.entity.isInWater = false;
  agent.bot.blockAt = () => ({ name: 'air' });
  assert.equal(rearmOpenWaterDrowningEscape(mode, agent, execution), false);
});

test('self-preservation recognizes a live numeric healing potion while it owns the critical lane', () => {
  const healingPotion = {
    name: 'potion',
    componentMap: new Map([
      ['potion_contents', { data: { potionId: 24, customEffects: [] } }],
    ]),
  };
  const bot = {
    version: '1.21.11',
    health: 8,
    inventory: { items: () => [healingPotion] },
  };

  assert.equal(shouldUseCriticalHealingPotion(bot), true);
  bot.health = 11;
  assert.equal(shouldUseCriticalHealingPotion(bot), false);
});

test('fresh ordinary damage reserves enough health for native tactical retreat', () => {
  const now = 20_000;
  const bot = {
    health: 13,
    lastDamageTaken: 3,
    lastDamageTime: now - 50,
  };

  assert.equal(recentDamageRequiresRetreat(bot, now), true);
  bot.health = 15;
  assert.equal(recentDamageRequiresRetreat(bot, now), false);
  bot.lastDamageTaken = 9;
  assert.equal(recentDamageRequiresRetreat(bot, now), true);
  bot.lastDamageTime = now - 4_000;
  assert.equal(recentDamageRequiresRetreat(bot, now), false);
});

test('a retreat that gains distance but loses health immediately retains self-preservation retry authority', () => {
  const wakeReasons = [];
  const mode = { last_retreat_at: 20_000, next_retry_at: 21_500 };
  const agent = { behavior_arbiter: { wake: reason => wakeReasons.push(reason) } };
  const execution = {
    interrupted: false,
    result: {
      phase: 'failed',
      code: 'skill_retreat_health_deteriorated',
      evidence: {
        skill: {
          kind: 'tactical_combat',
          outcome: 'retreat_health_deteriorated',
          retryable: true,
          healthBefore: 14,
          healthAfter: 8,
          retreatDistanceBefore: 2,
          retreatDistanceAfter: 26,
        },
      },
    },
  };

  assert.equal(rearmDeterioratingSelfPreservationRetreat(mode, agent, execution), true);
  assert.equal(mode.last_retreat_at, 0);
  assert.equal(mode.next_retry_at, 0);
  assert.deepEqual(wakeReasons, ['self_preservation_health_deteriorated']);
});

test('an unchanged blocked retreat cannot bypass the ordinary reflex cooldown', () => {
  const mode = { last_retreat_at: 20_000, next_retry_at: 21_500 };
  const execution = {
    interrupted: false,
    result: {
      phase: 'failed',
      evidence: {
        skill: {
          kind: 'tactical_combat',
          outcome: 'retreat_blocked',
          retryable: true,
          healthBefore: 14,
          healthAfter: 14,
          retreatDistanceBefore: 2,
          retreatDistanceAfter: 2,
        },
      },
    },
  };

  assert.equal(rearmDeterioratingSelfPreservationRetreat(mode, {}, execution), false);
  assert.deepEqual(mode, { last_retreat_at: 20_000, next_retry_at: 21_500 });
});
