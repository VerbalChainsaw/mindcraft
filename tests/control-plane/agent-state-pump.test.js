import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectAgentStates,
  createAgentStatePump,
  requiresReliableAgentStateDelivery,
  selectAgentConnectionsForPolling,
} from '../../src/mindcraft/agent-state-pump.js';
import {
  applyStateUpdate,
  createStateDelta,
  createStateSnapshot,
} from '../../src/mindcraft/public/js/agent-state-protocol.js';

test('Given multiple live bots, when state is sampled, then requests run concurrently and remain keyed by bot name', async () => {
  let active = 0;
  let maximumActive = 0;
  const connection = (name, delay) => ({
    in_game: true,
    socket: {
      emit(event, callback) {
        assert.equal(event, 'get-full-state');
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        setTimeout(() => {
          active -= 1;
          callback({ name });
        }, delay);
      },
    },
  });

  const states = await collectAgentStates({
    AlphaBot: connection('AlphaBot', 25),
    BetaBot: connection('BetaBot', 25),
  }, { timeoutMs: 100 });

  assert.equal(maximumActive, 2);
  assert.deepEqual(states, {
    AlphaBot: { name: 'AlphaBot' },
    BetaBot: { name: 'BetaBot' },
  });
});

test('Given a slow state cycle, when the state pump is active, then a second cycle never overlaps the first', async () => {
  let active = 0;
  let maximumActive = 0;
  let cycles = 0;
  const pump = createAgentStatePump({
    intervalMs: 5,
    collect: async () => {
      cycles += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return { cycle: cycles };
    },
    publish: () => {},
    shouldContinue: () => cycles < 3,
  });

  pump.start();
  await pump.waitForIdle();

  assert.equal(cycles, 3);
  assert.equal(maximumActive, 1);
});

test('Given one state cycle fails, when listeners remain active, then the failure is contained and later cycles continue', async () => {
  let cycles = 0;
  const errors = [];
  const published = [];
  const pump = createAgentStatePump({
    intervalMs: 1,
    collect: () => {
      cycles += 1;
      if (cycles === 1) throw new Error('temporary bridge failure');
      return { cycle: cycles };
    },
    publish: (state) => published.push(state),
    onError: (error) => errors.push(error.message),
    shouldContinue: () => cycles < 2,
  });

  pump.start();
  await pump.waitForIdle();

  assert.deepEqual(errors, ['temporary bridge failure']);
  assert.deepEqual(published, [{ cycle: 2 }]);
});

test('Given fresh pushed state, fallback polling selects only legacy or stale agent connections', () => {
  const now = 20_000;
  const fresh = { in_game: true, lastStatePushAt: 19_500 };
  const stale = { in_game: true, lastStatePushAt: 10_000 };
  const legacy = { in_game: true };
  const stopped = { in_game: false };

  assert.deepEqual(
    Object.keys(selectAgentConnectionsForPolling(
      { fresh, stale, legacy, stopped },
      { now, staleAfterMs: 2_000 },
    )).sort(),
    ['legacy', 'stale'],
  );
});

test('Given streamed bot state, only action lifecycle edges require reliable dashboard delivery', () => {
  const active = {
    gameplay: { position: { x: 1, y: 64, z: 1 } },
    action: {
      held: false,
      isIdle: false,
      stopRequestedAt: null,
      stopTimedOutAt: null,
      lastResult: { actionId: 'action-1', finishedAt: 100 },
    },
  };
  const movement = structuredClone(active);
  movement.gameplay.position.x = 2;
  assert.equal(requiresReliableAgentStateDelivery(active, movement), false);

  const terminal = structuredClone(movement);
  terminal.action.isIdle = true;
  terminal.action.lastResult = { actionId: 'action-2', finishedAt: 200 };
  assert.equal(requiresReliableAgentStateDelivery(movement, terminal), true);

  const held = structuredClone(terminal);
  held.action.held = true;
  assert.equal(requiresReliableAgentStateDelivery(terminal, held), true);
});

test('Given a contiguous state delta, dashboard state advances without a resync', () => {
  let applied = applyStateUpdate({}, {}, createStateSnapshot({
    Scout: { name: 'Scout', health: 20, stale: true },
  }, { Scout: 4 }));
  applied = applyStateUpdate(
    applied.states,
    applied.revisions,
    createStateDelta('Scout', { health: 18 }, ['stale'], 4, 5),
  );

  assert.deepEqual(applied.states, { Scout: { name: 'Scout', health: 18 } });
  assert.deepEqual(applied.revisions, { Scout: 5 });
  assert.equal(applied.resyncRequired, false);
});

test('Given a dropped state delta, dashboard state refuses a mixed merge and converges on a snapshot', () => {
  const initial = applyStateUpdate({}, {}, createStateSnapshot({
    Scout: { name: 'Scout', position: { x: 1 } },
  }, { Scout: 1 }));
  const gap = applyStateUpdate(
    initial.states,
    initial.revisions,
    createStateDelta('Scout', { position: { x: 3 }, health: 14 }, [], 2, 3),
  );

  assert.equal(gap.resyncRequired, true);
  assert.deepEqual(gap.states, initial.states, 'a delta with a missing base must not mutate state');
  const recovered = applyStateUpdate(gap.states, gap.revisions, createStateSnapshot({
    Scout: { name: 'Scout', position: { x: 3 }, health: 14 },
  }, { Scout: 3 }));
  assert.equal(recovered.resyncRequired, false);
  assert.deepEqual(recovered.states.Scout, { name: 'Scout', position: { x: 3 }, health: 14 });
});

test('Given a pre-revision version-two delta, dashboard compatibility is preserved', () => {
  const applied = applyStateUpdate(
    { Scout: { name: 'Scout', health: 20 } },
    {},
    { version: 2, type: 'delta', changes: { Scout: { set: { health: 19 }, unset: [] } } },
  );
  assert.equal(applied.resyncRequired, false);
  assert.equal(applied.states.Scout.health, 19);
});
