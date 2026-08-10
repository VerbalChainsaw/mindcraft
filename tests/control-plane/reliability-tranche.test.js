// Focused regressions for the reliability tranche: each check reproduces one
// specific confirmed defect (TD-PROV-001, TD-PROMPT-002, TD-JOB-001,
// TD-ACT-001) rather than certifying the surrounding subsystem.
import assert from 'node:assert/strict';
import test from 'node:test';

import { OpenAICompatible } from '../../src/models/openai_compatible.js';

function capturingClient() {
  const seen = {};
  return {
    seen,
    create: (config) => {
      Object.assign(seen, config);
      return { chat: { completions: { create: () => Promise.resolve({ choices: [] }) } } };
    },
  };
}

// TD-PROV-001 -- a `timeout` left in the request body is silently dropped by the
// API, so a stalled provider held the turn for the SDK's 10 minute default.
test('Given a profile timeout, when an openai_compatible model is constructed, then the timeout reaches the client and leaves the request body', () => {
  // Given
  const client = capturingClient();

  // When
  const model = new OpenAICompatible('local/model', 'https://example.invalid/v1', {
    timeout_seconds: 45,
    temperature: 0.7,
  }, {
    readKey: () => 'test-key',
    createClient: client.create,
  });

  // Then
  assert.equal(client.seen.timeout, 45_000);
  assert.equal(model.params.timeout_seconds, undefined);
  assert.equal(model.params.timeout, undefined);
  assert.equal(model.params.temperature, 0.7);
});

test('Given no configured timeout, when an openai_compatible model is constructed, then no client timeout is invented', () => {
  // Given
  const client = capturingClient();

  // When
  new OpenAICompatible('local/model', 'https://example.invalid/v1', { temperature: 0.2 }, {
    readKey: () => 'test-key',
    createClient: client.create,
  });

  // Then
  assert.ok(!Object.hasOwn(client.seen, 'timeout'));
});

// TD-PROMPT-002 -- the latch was cleared only on the success path, so one failed
// request left every later coding request answering "Already awaiting".
test('Given a coding request that fails, when a later coding request is made, then the awaiting latch has been released', async () => {
  // Given
  const { Prompter } = await import('../../src/models/prompter.js');
  const prompter = Object.create(Prompter.prototype);
  prompter.awaiting_coding = false;
  prompter.profile = { coding: 'coding-prompt' };
  prompter.coding_examples = null;
  prompter.checkCooldown = () => Promise.resolve();
  prompter.replaceStrings = (prompt) => Promise.resolve(prompt);
  prompter._saveLog = () => Promise.resolve();
  prompter.code_model = { sendRequest: () => Promise.reject(new Error('provider exploded')) };

  // When
  await assert.rejects(prompter.promptCoding([]), /provider exploded/);

  // Then
  assert.equal(prompter.awaiting_coding, false);
  prompter.code_model = { sendRequest: () => Promise.resolve('recovered') };
  assert.equal(await prompter.promptCoding([]), 'recovered');
});

// TD-JOB-001 -- non-builder roles mint a unique order id every quota-fill cycle,
// so the de-dupe set grew for the life of the process.
test('Given more completed work orders than the retention bound, when they are remembered, then the set stays bounded and keeps the most recent ids', async () => {
  // Given
  const { JobDirector } = await import('../../src/agent/runtime/job-director.js');
  const director = Object.create(JobDirector.prototype);
  director.completedOrderIds = new Set();

  // When
  for (let index = 0; index < 300; index += 1) {
    director.rememberCompletedOrder(`order-${index}`);
  }

  // Then
  assert.equal(director.completedOrderIds.size, 256);
  assert.ok(director.completedOrderIds.has('order-299'), 'most recent id must still suppress repeat work');
  assert.ok(!director.completedOrderIds.has('order-0'), 'oldest id must have been evicted');
});

test('Given a re-completed order id, when it is remembered again, then it refreshes instead of sitting near eviction', async () => {
  // Given
  const { JobDirector } = await import('../../src/agent/runtime/job-director.js');
  const director = Object.create(JobDirector.prototype);
  director.completedOrderIds = new Set();
  for (let index = 0; index < 256; index += 1) director.rememberCompletedOrder(`order-${index}`);

  // When
  director.rememberCompletedOrder('order-0');
  director.rememberCompletedOrder('fresh-order');

  // Then
  assert.equal(director.completedOrderIds.size, 256);
  assert.ok(director.completedOrderIds.has('order-0'), 'refreshed id must survive');
  assert.ok(!director.completedOrderIds.has('order-1'), 'next-oldest id must be the one evicted');
});

// TD-ACT-001 -- the timeout callback is the recovery path for a stuck action; a
// rejection escaping it crashed the agent at exactly the wrong moment.
test('Given a failing stop and history during action timeout, when the timeout fires, then no unhandled rejection escapes', async () => {
  // Given
  const { ActionManager } = await import('../../src/agent/action_manager.js');
  const manager = Object.create(ActionManager.prototype);
  manager.executing = true;
  manager.currentActionId = 'action-1';
  manager.timedout = false;
  manager.agent = { history: { add: () => Promise.reject(new Error('summarization failed')) } };
  manager.stop = () => Promise.reject(new Error('stop failed'));

  const rejections = [];
  const onRejection = (error) => rejections.push(error);
  process.on('unhandledRejection', onRejection);

  // When
  try {
    const timer = manager._startTimeout(0, 'action-1', null);
    clearTimeout(timer);
    // Invoke the same callback body the timer would have run.
    const immediate = manager._startTimeout(0, 'action-1', null);
    await new Promise(resolve => setTimeout(resolve, 50));
    clearTimeout(immediate);
    await new Promise(resolve => setImmediate(resolve));
  } finally {
    process.off('unhandledRejection', onRejection);
  }

  // Then
  assert.deepEqual(rejections, []);
  assert.equal(manager.timedout, true, 'timeout must still record that it fired');
});
