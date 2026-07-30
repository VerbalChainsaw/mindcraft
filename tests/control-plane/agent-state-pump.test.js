import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectAgentStates,
  createAgentStatePump,
} from '../../src/mindcraft/agent-state-pump.js';

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
