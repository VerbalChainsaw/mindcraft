import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chooseReaction,
  electSquadSpeaker,
  renderDeterministicReaction,
  shouldRememberEvent,
} from '../../src/agent/runtime/reaction-policy.js';

const POLICY = {
  mode: 'natural',
  maxSpeechPerMinute: 4,
  maxGesturesPerMinute: 8,
};

test('Reaction policy stays silent for low salience, active conversation, remote events, and exhausted budgets', () => {
  const base = { id: 'e1', type: 'observation.item', actor: 'Bot', salience: 1, timestamp: 1 };
  assert.equal(chooseReaction(base, {}, POLICY), null);
  assert.equal(chooseReaction({ ...base, salience: 4 }, { inConversation: true }, POLICY), null);
  assert.equal(chooseReaction(
    { ...base, salience: 4, target: { name: 'diamond', distance: 80 } },
    {},
    POLICY,
  ), null);
  assert.equal(chooseReaction(
    { ...base, salience: 5 },
    { speechInLastMinute: 4 },
    POLICY,
  ), null);
});

test('Danger warnings outrank ambient observations and render only supplied facts', () => {
  const event = {
    id: 'danger-1',
    type: 'threat.detected',
    actor: 'Guard',
    target: { name: 'creeper', distance: 7 },
    evidence: { code: 'combat_safe_hostile' },
    salience: 5,
    timestamp: 1,
  };
  const reaction = chooseReaction(event, { selfName: 'Guard' }, POLICY);
  assert.equal(reaction.priority, 'urgent');
  assert.equal(reaction.kind, 'warning');
  assert.equal(renderDeterministicReaction(reaction), 'Creeper, 7 blocks away!');
  assert.equal(renderDeterministicReaction(reaction).includes('north'), false);
});

test('Stable squad election chooses exactly one witness for duplicate events', () => {
  const event = { id: 'shared-event-1', type: 'job.completed', salience: 4 };
  const witnesses = ['Timber', 'Builder', 'Miner'];
  const elected = electSquadSpeaker(event, witnesses);
  assert.equal(witnesses.includes(elected), true);
  assert.equal(electSquadSpeaker(event, [...witnesses].reverse()), elected);
});

test('Only significant events request episodic memory', () => {
  assert.equal(shouldRememberEvent({ type: 'time.sunrise', salience: 2 }), false);
  assert.equal(shouldRememberEvent({ type: 'self.died', salience: 5 }), true);
  assert.equal(shouldRememberEvent({ type: 'job.completed', salience: 4 }), true);
});
