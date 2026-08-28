import assert from 'node:assert/strict';
import test from 'node:test';

import { BehaviorEventBus } from '../../src/agent/runtime/behavior-event.js';
import { ReactionDirector } from '../../src/agent/runtime/reaction-director.js';

const BOT_NAMES = Object.freeze([
  'Builder',
  'Miner',
  'Lumberjack',
  'Guard',
  'Scout',
  'Farmer',
  'Cook',
  'Smith',
  'Medic',
  'Companion',
]);

function settle() {
  return new Promise(resolve => setImmediate(resolve));
}

function createFleet({
  now,
  maxSpeechPerMinute = 100,
  maxGesturesPerMinute = 12,
  held = false,
  idle = true,
} = {}) {
  const deliveries = [];
  const gestures = [];
  const agents = BOT_NAMES.map(name => {
    const agent = {
      name,
      bot: { entity: { position: { x: 0, y: 64, z: 0 } } },
      runtime: {
        identity: { attitude: 'steady' },
        reactions: { mode: 'natural', maxSpeechPerMinute, maxGesturesPerMinute },
      },
      behavior_events: new BehaviorEventBus(name),
      isOperatorHeld: () => held,
      isIdle: () => idle,
      memory_bank: { personal: { rememberEpisode() {} } },
      last_action_result: null,
    };
    const director = new ReactionDirector(agent, {
      now,
      phraseReaction: () => null,
      getContext: () => ({ inConversation: false }),
      deliverText: text => deliveries.push({ name, text }),
      executeGesture: (_agent, command) => {
        gestures.push({ name, command });
        return {
          result: {
            actionId: `${name}-${gestures.length}`,
            phase: 'succeeded',
          },
        };
      },
    });
    return { agent, director };
  });
  return { agents, deliveries, gestures };
}

test('Given ten witnesses over a simulated thirty-minute shift, every shared event elects exactly one speaker', async () => {
  let clock = 1_000_000;
  const fleet = createFleet({ now: () => clock });
  const speechByEvent = new Map();

  for (let index = 0; index < 90; index += 1) {
    const eventId = `shift-threat-${index}`;
    for (const { agent } of fleet.agents) {
      agent.behavior_events.publish({
        id: eventId,
        type: 'threat.detected',
        target: { name: 'creeper', distance: 8 },
        evidence: { code: 'hostile_spawn' },
        witnesses: BOT_NAMES,
        salience: 5,
        timestamp: clock,
      });
    }
    const before = new Map(fleet.agents.map(({ agent, director }) => [agent.name, director.snapshot().spoken]));
    for (const { director } of fleet.agents) director.update();
    await settle();
    const speakers = fleet.agents
      .filter(({ agent, director }) => director.snapshot().spoken > before.get(agent.name))
      .map(({ agent }) => agent.name);
    speechByEvent.set(eventId, speakers);
    clock += 20_001;
  }

  assert.equal(clock - 1_000_000 > 30 * 60_000, true);
  assert.equal(speechByEvent.size, 90);
  for (const speakers of speechByEvent.values()) assert.equal(speakers.length, 1);
  assert.equal(fleet.deliveries.length, 90);
});

test('Given a ten-bot reaction storm, per-bot speech and event queues remain bounded', async () => {
  let clock = 2_000_000;
  const fleet = createFleet({
    now: () => clock,
    maxSpeechPerMinute: 3,
    maxGesturesPerMinute: 0,
  });

  for (let index = 0; index < 400; index += 1) {
    for (const { agent } of fleet.agents) {
      agent.behavior_events.publish({
        id: `${agent.name}-storm-${index}`,
        type: index % 2 === 0 ? 'player.joined' : 'observation.item',
        target: { name: index % 2 === 0 ? 'Alex' : 'diamond' },
        salience: 4,
        timestamp: clock,
      });
    }
  }
  for (const { agent } of fleet.agents) assert.equal(agent.behavior_events.queue.length, 128);

  for (let tick = 0; tick < 20; tick += 1) {
    for (const { director } of fleet.agents) director.update();
    await settle();
    clock += 1_000;
  }

  for (const { director } of fleet.agents) assert.equal(director.snapshot().spoken <= 3, true);
  assert.equal(fleet.deliveries.length <= BOT_NAMES.length * 3, true);
});

test('Given operator hold or busy movement, reactions never steal control for gestures', async () => {
  let clock = 3_000_000;
  const heldFleet = createFleet({ now: () => clock, held: true });
  const busyFleet = createFleet({ now: () => clock, idle: false });
  const event = {
    id: 'control-boundary-item',
    type: 'observation.item',
    target: { name: 'diamond', x: 2, y: 64, z: 3, distance: 4 },
    salience: 4,
    timestamp: clock,
  };

  for (const fleet of [heldFleet, busyFleet]) {
    for (const { agent, director } of fleet.agents) {
      agent.behavior_events.publish({ ...event, id: `${event.id}-${agent.name}` });
      director.update();
    }
  }
  await settle();

  assert.equal(heldFleet.deliveries.length, 0);
  assert.equal(heldFleet.gestures.length, 0);
  assert.equal(busyFleet.gestures.length, 0);
  assert.equal(busyFleet.deliveries.length, BOT_NAMES.length);
});
