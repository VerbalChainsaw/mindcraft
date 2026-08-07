import assert from 'node:assert/strict';
import test from 'node:test';

import { createActionResult } from '../../src/agent/runtime/action-result.js';
import { normalizeBehaviorEvent } from '../../src/agent/runtime/behavior-event.js';
import {
  CompanionContext,
  normalizePlayerDistance,
} from '../../src/agent/runtime/companion-context.js';
import { RoleDirector } from '../../src/agent/runtime/role-director.js';
import { getModeSuppressionReason } from '../../src/agent/modes.js';
import { JobDirector } from '../../src/agent/runtime/job-director.js';
import { createWorkOrder } from '../../src/agent/runtime/work-order.js';

function player(username, id, x = 2) {
  return {
    type: 'player',
    username,
    id,
    position: { x, y: 64, z: 0 },
  };
}

function fixture({ now = 1_000, onReappeared = () => {} } = {}) {
  const human = player('.LittleBubby9352', 7);
  const bot = {
    username: 'MindcraftBot',
    game: { dimension: 'overworld' },
    players: { '.LittleBubby9352': { username: '.LittleBubby9352', entity: human } },
    entities: { 7: human },
  };
  const clock = { value: now };
  const agent = {
    name: 'MindcraftBot',
    bot,
    runtime: { role: 'companion', autonomy: 'command' },
    isOperatorHeld: () => false,
    getKnownAgentNames: () => ['MindcraftBot'],
  };
  const context = new CompanionContext(agent, {
    now: () => clock.value,
    onReappeared,
    recentPresenceMs: 8_000,
    followGraceMs: 3_500,
  });
  agent.companion_context = context;
  return { agent, bot, clock, context, human };
}

test('context resolves Floodgate identity, tracks presence and entity epoch without retaining an entity in telemetry', () => {
  const { context, bot } = fixture();
  context.observeChat('LittleBubby9352');
  context.observeLoadedPlayer('.LittleBubby9352', bot.entities[7], { lineOfSight: false, dimension: 'overworld' });
  const first = context.snapshot();

  assert.equal(first.alias, 'LittleBubby9352');
  assert.equal(first.canonicalUsername, '.LittleBubby9352');
  assert.equal(first.presence, 'present');
  assert.equal(first.entityId, 7);
  assert.equal(first.entityEpoch, 1);
  assert.equal(first.lineOfSight, false);
  assert.equal(Object.hasOwn(first, 'entity'), false);

  const replacement = player('.LittleBubby9352', 8, 3);
  bot.players['.LittleBubby9352'].entity = replacement;
  bot.entities = { 8: replacement };
  context.observeLoadedPlayer('.LittleBubby9352', replacement, { lineOfSight: true, dimension: 'overworld' });
  assert.equal(context.snapshot().entityEpoch, 2);
  assert.equal(Object.hasOwn(context.snapshot(), 'entity'), false);
});

test('behavior events accept legitimate leading-dot Floodgate names', () => {
  const event = normalizeBehaviorEvent({
    type: 'entity.hurt',
    actor: 'MindcraftBot',
    target: { name: '.LittleBubby9352' },
    evidence: { code: 'nearby_hurt_attributed', sourceName: 'zombie', sourceEntityId: 12 },
  });
  assert.equal(event.target.name, '.LittleBubby9352');
  assert.equal(event.evidence.sourceEntityId, 12);
});

test('command autonomy suppresses invented role work without suppressing context embodiment', () => {
  const { agent, context } = fixture();
  agent.isIdle = () => true;
  agent.self_prompter = { isStopped: () => true };
  const director = new RoleDirector(agent);
  director.update();

  assert.equal(director.status.code, 'command_autonomy');
  assert.equal(context.observeChat('LittleBubby9352').canonical, '.LittleBubby9352');
});

test('follow waits after bounded last-seen grace and resumes the same directive on replacement', async () => {
  const resumed = [];
  const { context, bot, clock, human } = fixture({ onReappeared: snapshot => resumed.push(snapshot) });
  context.observeChat('LittleBubby9352');
  context.setDirective('follow', '.LittleBubby9352');
  context.observeGone(human);
  assert.equal(context.canUseLastSeen(), true);

  clock.value += 3_501;
  assert.equal(context.canUseLastSeen(), false);
  context.markWaiting();
  const replacement = player('.LittleBubby9352', 9, 4);
  bot.players['.LittleBubby9352'].entity = replacement;
  bot.entities = { 9: replacement };
  context.observeLoadedPlayer('.LittleBubby9352', replacement, { lineOfSight: true, dimension: 'overworld' });
  await Promise.resolve();

  assert.equal(resumed.length, 1);
  assert.equal(context.resumeCommand(), '!followPlayer(".LittleBubby9352", 3)');
});

test('guard protection requires attributed loaded hostile and operator Stop clears all embodiment state', () => {
  const { agent, bot, context, human } = fixture();
  agent.actions = { currentActionLabel: 'action:guardPlayer' };
  context.observeChat('LittleBubby9352');
  context.setDirective('guard', '.LittleBubby9352');
  assert.equal(context.observeProtectedHurt(human, null), null);
  assert.equal(context.protectionThreat(), null);
  assert.equal(getModeSuppressionReason(agent, { name: 'self_defense' }), 'command_autonomy');

  const zombie = { type: 'hostile', name: 'zombie', id: 12, position: { x: 3, y: 64, z: 0 } };
  bot.entities[12] = zombie;
  assert.equal(context.observeProtectedHurt(human, zombie).threatEntityId, 12);
  assert.equal(context.protectionThreat(), zombie);
  assert.equal(getModeSuppressionReason(agent, { name: 'self_defense' }), null);

  agent.isOperatorHeld = () => true;
  assert.equal(getModeSuppressionReason(agent, { name: 'self_defense' }), 'operator_hold');
  context.clearControl();
  assert.equal(context.snapshot().directive, null);
  assert.equal(context.snapshot().protection, null);
  assert.equal(context.snapshot().attention, null);
});

test('command autonomy admits a recently damaging ranged threat at tactical distance', () => {
  const { agent, bot } = fixture();
  const skeleton = { type: 'hostile', name: 'skeleton', id: 13, position: { x: 12, y: 64, z: 0 } };
  bot.entity = {
    position: {
      x: 0,
      y: 64,
      z: 0,
      distanceTo(position) {
        return Math.hypot(position.x - this.x, position.y - this.y, position.z - this.z);
      },
    },
  };
  bot.entities[13] = skeleton;
  bot.nearestEntity = predicate => Object.values(bot.entities).find(predicate) || null;
  bot.lastDamageTime = Date.now();

  assert.equal(getModeSuppressionReason(agent, { name: 'self_defense' }), null);

  skeleton.position.x = 17;
  assert.equal(getModeSuppressionReason(agent, { name: 'self_defense' }), 'command_autonomy');
});

test('attention remains bounded advisory state and never owns movement', () => {
  const { context, clock } = fixture();
  const attention = context.requestAttention('human_chat', { ttlMs: 500 });
  assert.equal(attention.reason, 'human_chat');
  assert.equal(context.snapshot().attention.reason, 'human_chat');
  clock.value += 501;
  assert.equal(context.snapshot().attention, null);
});

test('action target evidence preserves canonical observation metadata', () => {
  const result = createActionResult({
    target: {
      name: 'LittleBubby9352',
      requestedName: 'LittleBubby9352',
      canonicalName: '.LittleBubby9352',
      entityId: 7,
      observedAt: 1_000,
      age: 0,
      lineOfSight: false,
    },
  });
  assert.deepEqual(result.target, {
    name: 'LittleBubby9352',
    requestedName: 'LittleBubby9352',
    canonicalName: '.LittleBubby9352',
    entityId: 7,
    observedAt: 1_000,
    age: 0,
    lineOfSight: false,
  });
});

test('companion movement enforces the personal-space floor', () => {
  assert.equal(normalizePlayerDistance(0, 3), 1.25);
  assert.equal(normalizePlayerDistance(1, 3), 1.25);
  assert.equal(normalizePlayerDistance(3, 3), 3);
});

test('command autonomy permits resumable player jobs but suppresses role-invented jobs', () => {
  const makeAgent = () => ({
    name: 'JobCompanion',
    bot: {
      entity: { position: { x: 0, y: 64, z: 0 } },
      inventory: { items: () => [], slots: [] },
    },
    runtime: {
      role: 'miner',
      autonomy: 'command',
      jobs: { mode: 'resumable', stockpileLimit: 128, deposit: 'inventory' },
      limits: { maxRecoveryAttempts: 2 },
      assignment: {},
    },
    self_prompter: { isStopped: () => true },
    isIdle: () => false,
    isOperatorHeld: () => false,
  });
  const store = { load: () => null, save: value => value };
  const playerDirector = new JobDirector(makeAgent(), { store, now: () => 10_000 });
  playerDirector.submit(createWorkOrder({
    id: 'player-job',
    source: 'player',
    role: 'miner',
    kind: 'mine',
    target: { name: 'cobblestone' },
    quota: 4,
  }));
  playerDirector.update();
  assert.equal(playerDirector.status.code, 'job_accepted');
  assert.equal(playerDirector.activeOrder.source, 'player');

  const roleDirector = new JobDirector(makeAgent(), { store, now: () => 10_000 });
  roleDirector.submit(createWorkOrder({
    id: 'role-job',
    source: 'role',
    role: 'miner',
    kind: 'mine',
    target: { name: 'cobblestone' },
    quota: 4,
  }));
  roleDirector.update();
  assert.equal(roleDirector.status.code, 'command_autonomy');
});
