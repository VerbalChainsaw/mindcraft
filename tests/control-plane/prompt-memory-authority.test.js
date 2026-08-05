import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPromptMemory } from '../../src/agent/runtime/memory-recall.js';

function agentHarness(overrides = {}) {
  return {
    name: 'MemoryBot',
    runtime: { identity: { displayName: 'MemoryBot' } },
    history: {
      memory: 'Need coal for the old clock. Ask whether the player still wants a chest.',
    },
    self_prompter: { isStopped: () => true },
    goal_director: {
      activeGoal: null,
      hasProtectedCompletion: () => false,
    },
    job_director: { activeOrder: null },
    agenda_director: { snapshot: () => ({ active: null, queue: [] }) },
    isOperatorHeld: () => false,
    ...overrides,
  };
}

test('runtime memory authority does not turn legacy task prose into unfinished work', () => {
  const agent = agentHarness();
  const runtimePrompt = buildPromptMemory(agent);

  assert.match(runtimePrompt, /no player goal, work order, or agenda is active/i);
  assert.match(runtimePrompt, /historical context, never unfinished work/i);
  assert.doesNotMatch(runtimePrompt, /old clock|still wants a chest/i);

  const compactionPrompt = buildPromptMemory(agent, { purpose: 'summary' });
  assert.match(compactionPrompt, /old clock/i);
});
