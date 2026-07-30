import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SurvivalDirector,
  summarizeSurvivalSituation,
} from '../../src/agent/runtime/survival-director.js';

const POLICY = Object.freeze({
  mode: 'full',
  eatAt: 14,
  criticalFood: 6,
  reserveFoodPoints: 12,
  sleep: 'safe',
  shelter: 'seek',
});

function createAgent() {
  return {
    bot: { entity: { id: 1 } },
    runtime: { survival: POLICY },
    last_action_result: null,
    isIdle: () => true,
    isOperatorHeld: () => false,
  };
}

function settle() {
  return new Promise(resolve => setImmediate(resolve));
}

test('Given low hunger, SurvivalDirector dispatches one verified consume action and publishes its result', async () => {
  const agent = createAgent();
  const commands = [];
  const director = new SurvivalDirector(agent, {
    getSituation: () => ({
      held: false,
      idle: true,
      health: 18,
      hunger: 8,
      urgentDanger: false,
      food: [{ name: 'bread', count: 4, foodPoints: 5, saturation: 6 }],
      timeOfDay: 6000,
      weather: 'Clear',
    }),
    executeCommand: (_agent, command) => {
      commands.push(command);
      agent.last_action_result = {
        actionId: 'survival-1',
        phase: 'succeeded',
        code: 'skill_consumed',
        detail: 'Consumed bread.',
        target: { name: 'bread' },
        retryable: false,
      };
    },
  });

  director.update();
  director.update();
  await settle();

  assert.deepEqual(commands, ['!consume("bread")']);
  const status = director.snapshot();
  assert.deepEqual({
    ...status,
    nextEligibleAt: '<bounded cooldown>',
  }, {
    name: 'survival',
    phase: 'succeeded',
    code: 'skill_consumed',
    target: { name: 'bread' },
    detail: 'Consumed bread.',
    retryable: false,
    nextEligibleAt: '<bounded cooldown>',
  });
  assert.equal(Number.isFinite(status.nextEligibleAt), true);
});

test('Given operator hold, SurvivalDirector does not schedule hunger, sleep, or shelter upkeep', async () => {
  const agent = createAgent();
  agent.isOperatorHeld = () => true;
  const commands = [];
  const director = new SurvivalDirector(agent, {
    getSituation: () => ({
      held: true,
      idle: true,
      health: 10,
      hunger: 2,
      urgentDanger: false,
      food: [{ name: 'bread', count: 2, foodPoints: 5, saturation: 6 }],
      timeOfDay: 14000,
      weather: 'Thunderstorm',
    }),
    executeCommand: (_agent, command) => commands.push(command),
  });

  director.update();
  await settle();

  assert.deepEqual(commands, []);
  assert.equal(director.snapshot().phase, 'waiting');
});

test('Given an unresolved critical bodily need, SurvivalDirector acquires food and blocks lower-priority jobs', () => {
  const agent = createAgent();
  const director = new SurvivalDirector(agent, {
    getSituation: () => ({
      held: false,
      idle: true,
      health: 9,
      hunger: 3,
      urgentDanger: false,
      food: [],
      timeOfDay: 6000,
      weather: 'Clear',
    }),
  });

  director.update();

  assert.equal(director.snapshot().code, 'acquire_food');
  assert.equal(director.blocksLowerPriority(), true);
});

test('Given live inventory and cover, survival situation reports armor upgrades and verified shelter state', () => {
  const leatherBoots = { name: 'leather_boots', count: 1 };
  const ironBoots = { name: 'iron_boots', count: 1 };
  const slots = Array(9).fill(null);
  slots[8] = leatherBoots;
  const origin = {
    x: 0,
    y: 64,
    z: 0,
    distanceTo(other) {
      return Math.hypot(other.x, other.y - 64, other.z);
    },
  };
  const situation = summarizeSurvivalSituation({
    bot: {
      entity: { position: origin },
      health: 20,
      food: 20,
      lastDamageTime: 0,
      inventory: { slots, items: () => [ironBoots] },
      registry: { foodsByName: {} },
      modes: { getStatus: () => [] },
      time: { timeOfDay: 6000 },
      game: { dimension: 'minecraft:overworld' },
      rainState: 0,
      thunderState: 0,
      findBlocks: () => [],
      blockAt(position) {
        return position.y === 66
          ? { name: 'stone', boundingBox: 'block', position }
          : { name: 'air', boundingBox: 'empty', position };
      },
      nearestEntity: () => null,
    },
    isOperatorHeld: () => false,
    isIdle: () => true,
  });

  assert.deepEqual(situation.armor, [
    { name: 'leather_boots', slot: 'feet', score: 1, equipped: true },
    { name: 'iron_boots', slot: 'feet', score: 4, equipped: false },
  ]);
  assert.equal(situation.sheltered, true);
});

test('Given a verified armor upgrade, SurvivalDirector dispatches it through ActionManager command ownership', async () => {
  const agent = createAgent();
  const commands = [];
  const director = new SurvivalDirector(agent, {
    getSituation: () => ({
      held: false,
      idle: true,
      health: 20,
      hunger: 20,
      urgentDanger: false,
      food: [],
      armor: [{ name: 'iron_chestplate', slot: 'torso', score: 4, equipped: false }],
      timeOfDay: 6000,
      weather: 'Clear',
    }),
    executeCommand: (_agent, command) => {
      commands.push(command);
      agent.last_action_result = {
        actionId: 'survival-equip-1',
        phase: 'succeeded',
        code: 'skill_equipped',
        target: { name: 'iron_chestplate' },
        retryable: false,
      };
    },
  });

  director.update();
  await settle();

  assert.deepEqual(commands, ['!equip("iron_chestplate")']);
  assert.equal(director.snapshot().code, 'skill_equipped');
});

test('Given emergency shelter policy, SurvivalDirector requests exactly one validated work order', () => {
  const agent = createAgent();
  agent.runtime.survival = { ...POLICY, shelter: 'emergency' };
  const requests = [];
  const director = new SurvivalDirector(agent, {
    getSituation: () => ({
      held: false,
      idle: true,
      health: 20,
      hunger: 20,
      urgentDanger: false,
      food: [],
      armor: [],
      timeOfDay: 6000,
      dimension: 'overworld',
      weather: 'Thunderstorm',
      sheltered: false,
      shelters: [],
    }),
    requestWorkOrder: order => {
      requests.push(order);
      return { accepted: true, id: 'shelter-1' };
    },
  });

  director.update();
  director.update();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].kind, 'emergency_shelter');
  assert.equal(requests[0].blueprint.id, 'emergency_3x3');
  assert.equal(requests[0].blueprint.cells.length > 0, true);
  assert.equal(director.snapshot().phase, 'requested');
});
