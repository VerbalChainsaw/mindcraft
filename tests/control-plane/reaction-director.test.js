import assert from 'node:assert/strict';
import test from 'node:test';

import { BehaviorEventBus } from '../../src/agent/runtime/behavior-event.js';
import { ReactionDirector } from '../../src/agent/runtime/reaction-director.js';

function createAgent(name = 'Guard') {
  const bus = new BehaviorEventBus(name);
  const episodes = [];
  return {
    name,
    behavior_events: bus,
    runtime: {
      reactions: { mode: 'natural', maxSpeechPerMinute: 4, maxGesturesPerMinute: 8 },
      identity: { attitude: 'warm' },
    },
    last_action_result: null,
    isIdle: () => true,
    isOperatorHeld: () => false,
    memory_bank: {
      personal: {
        rememberEpisode(text, outcome) {
          episodes.push([text, outcome]);
        },
      },
    },
    episodes,
  };
}

function settle() {
  return new Promise(resolve => setImmediate(resolve));
}

test('Given a factual significant event, ReactionDirector delivers one bounded reaction and remembers it once', async () => {
  const agent = createAgent();
  const delivered = [];
  const director = new ReactionDirector(agent, {
    deliverText: text => delivered.push(text),
    getContext: () => ({ inConversation: false, witnesses: ['Guard'] }),
  });
  agent.behavior_events.publish({
    id: 'job-done-1',
    type: 'job.completed',
    target: { name: 'oak_log' },
    evidence: { workOrderId: 'logs-1' },
    salience: 4,
  });

  director.update();
  director.update();
  await settle();

  assert.deepEqual(delivered, ['Finished the oak log work.']);
  assert.equal(agent.episodes.length, 1);
  assert.equal(director.snapshot().spoken, 1);
});

test('Given model phrasing that invents a number, ReactionDirector rejects it and uses factual fallback', async () => {
  const agent = createAgent();
  const delivered = [];
  const director = new ReactionDirector(agent, {
    deliverText: text => delivered.push(text),
    phraseReaction: () => 'Diamond swarm, 99 blocks north!',
    getContext: () => ({ inConversation: false, witnesses: ['Guard'] }),
  });
  agent.behavior_events.publish({
    id: 'threat-1',
    type: 'threat.detected',
    target: { name: 'creeper', distance: 7 },
    evidence: { code: 'combat_safe_hostile' },
    salience: 5,
  });

  director.update();
  await settle();

  assert.deepEqual(delivered, ['Creeper, 7 blocks away!']);
  assert.equal(director.snapshot().fallbacks, 1);
});

test('Given active direct conversation, ambient reaction speech is suppressed', async () => {
  const agent = createAgent();
  const delivered = [];
  const director = new ReactionDirector(agent, {
    deliverText: text => delivered.push(text),
    getContext: () => ({ inConversation: true, witnesses: ['Guard'] }),
  });
  agent.behavior_events.publish({
    id: 'sunrise-1',
    type: 'time.sunrise',
    salience: 2,
  });

  director.update();
  await settle();

  assert.deepEqual(delivered, []);
});

test('Given an idle target-bearing reaction, gesture uses the action boundary without controlling speech success', async () => {
  const agent = createAgent();
  const commands = [];
  const director = new ReactionDirector(agent, {
    deliverText: () => true,
    executeGesture: (_agent, command) => {
      commands.push(command);
      return {
        result: {
          actionId: 'gesture-1',
          phase: 'succeeded',
          code: 'looked',
        },
      };
    },
    getContext: () => ({ inConversation: false, witnesses: ['Guard'] }),
  });
  agent.behavior_events.publish({
    id: 'item-1',
    type: 'observation.item',
    target: { name: 'diamond', x: 2, y: 64, z: 3, distance: 4 },
    salience: 4,
  });

  director.update();
  await settle();

  assert.deepEqual(commands, ['!lookAtPosition(2, 64, 3)']);
  assert.equal(director.snapshot().gestures, 1);
  assert.equal(director.snapshot().phase, 'succeeded');
});

test('Given one shared squad event, multiple directors elect exactly one speaker', async () => {
  const names = ['Builder', 'Miner', 'Timber'];
  const delivered = [];
  const directors = names.map(name => {
    const agent = createAgent(name);
    const director = new ReactionDirector(agent, {
      deliverText: text => delivered.push([name, text]),
      getContext: () => ({ inConversation: false }),
    });
    agent.behavior_events.publish({
      id: 'shared-threat-42',
      type: 'threat.detected',
      target: { name: 'creeper', distance: 8 },
      evidence: { code: 'hostile_spawn' },
      witnesses: names,
      salience: 5,
    });
    return director;
  });

  directors.forEach(director => director.update());
  await settle();

  assert.equal(delivered.length, 1);
  assert.equal(names.includes(delivered[0][0]), true);
  assert.equal(delivered[0][1], 'Creeper, 8 blocks away!');
});
