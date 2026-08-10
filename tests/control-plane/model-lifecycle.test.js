// TD-MODEL-001 -- lifecycle ownership stopped at wrapper objects instead of
// reaching the provider job that owns the network/process resource. These
// checks pin the two properties that failure depended on: every configured
// route is reached, and a leaf shared by several routes is reached exactly once.
import assert from 'node:assert/strict';
import test from 'node:test';

import { FallbackRouter } from '../../src/models/fallback-router.js';
import { Prompter } from '../../src/models/prompter.js';

function leafModel(label, counters) {
  return {
    label,
    preflight() { counters.preflight.push(label); return Promise.resolve(); },
    cancelPending() { counters.cancel.push(label); return 1; },
    dispose() { counters.dispose.push(label); return Promise.resolve(); },
  };
}

function newCounters() {
  return { preflight: [], cancel: [], dispose: [] };
}

function routerOf(models) {
  return new FallbackRouter(models.map((model, index) => ({ model, label: `entry-${index}` })), {
    log: { warn() {} },
  });
}

// A profile naming several providers for one key produces a router. Before the
// fix `router.cancelPending?.()` was undefined, so Operator Stop reported zero
// cancellations while the children kept generating.
test('Given a router over two providers, when lifecycle methods are called, then each child provider is reached', async () => {
  // Given
  const counters = newCounters();
  const router = routerOf([leafModel('primary', counters), leafModel('secondary', counters)]);

  // When
  await router.preflight();
  const cancelled = router.cancelPending();
  await router.dispose();

  // Then
  assert.deepEqual(counters.preflight.sort(), ['primary', 'secondary']);
  assert.equal(cancelled, 2);
  assert.deepEqual(counters.dispose.sort(), ['primary', 'secondary']);
});

test('Given a router whose child is itself a router, when leaves are collected, then nesting is flattened and de-duplicated', () => {
  // Given
  const counters = newCounters();
  const shared = leafModel('shared', counters);
  const inner = routerOf([shared, leafModel('inner-only', counters)]);
  const outer = routerOf([inner, shared]);

  // When
  const leaves = [...outer.leafModels()].map(model => model.label).sort();

  // Then
  assert.deepEqual(leaves, ['inner-only', 'shared']);
});

// The real shape from profiles/local-quickstart.json: `model` is an array (so
// chat_model is a router) and each specialist is chained to the chat model by
// withChatBackstop, making the chat leaves reachable through five routes.
test('Given specialists chained to a routed chat model, when the agent stops, then every provider is cancelled exactly once', () => {
  // Given
  const counters = newCounters();
  const chatPrimary = leafModel('chat-primary', counters);
  const chatSecondary = leafModel('chat-secondary', counters);
  const chatRoute = routerOf([chatPrimary, chatSecondary]);
  const reasoningLeaf = leafModel('reasoning', counters);
  const memoryLeaf = leafModel('memory', counters);

  const prompter = Object.create(Prompter.prototype);
  prompter.chat_model = chatRoute;
  prompter.code_model = chatRoute;
  prompter.vision_model = chatRoute;
  prompter.embedding_model = null;
  prompter.reasoning_model = routerOf([reasoningLeaf, chatRoute]);
  prompter.memory_model = routerOf([memoryLeaf, chatRoute]);
  prompter.triage_model = chatRoute;
  prompter.autonomy_model = chatRoute;

  // When
  const cancelled = prompter.cancelPendingModelGeneration();

  // Then
  assert.equal(cancelled, 4, 'one cancellation per unique provider');
  assert.deepEqual(
    counters.cancel.slice().sort(),
    ['chat-primary', 'chat-secondary', 'memory', 'reasoning'],
  );
  assert.equal(
    new Set(counters.cancel).size,
    counters.cancel.length,
    'no provider may be cancelled twice',
  );
});

test('Given specialist providers, when the prompter disposes, then specialist leaves are disposed exactly once', async () => {
  // Given
  const counters = newCounters();
  const chatLeaf = leafModel('chat', counters);
  const reasoningLeaf = leafModel('reasoning', counters);

  const prompter = Object.create(Prompter.prototype);
  prompter.chat_model = chatLeaf;
  prompter.code_model = chatLeaf;
  prompter.vision_model = chatLeaf;
  prompter.embedding_model = null;
  prompter.reasoning_model = routerOf([reasoningLeaf, chatLeaf]);
  prompter.memory_model = chatLeaf;
  prompter.triage_model = chatLeaf;
  prompter.autonomy_model = chatLeaf;

  // When
  await prompter.dispose();

  // Then
  assert.deepEqual(counters.dispose.slice().sort(), ['chat', 'reasoning']);
});

test('Given a repeated dispose, when it is called twice, then providers are disposed once', async () => {
  // Given
  const counters = newCounters();
  const chatLeaf = leafModel('chat', counters);
  const prompter = Object.create(Prompter.prototype);
  prompter.chat_model = chatLeaf;
  prompter.code_model = null;
  prompter.vision_model = null;
  prompter.embedding_model = null;
  prompter.reasoning_model = null;
  prompter.memory_model = null;
  prompter.triage_model = null;
  prompter.autonomy_model = null;

  // When
  await prompter.dispose();
  await prompter.dispose();

  // Then
  assert.deepEqual(counters.dispose, ['chat']);
});
