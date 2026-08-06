import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createLocalQuickstartPlan,
  LOCAL_QUICKSTART_PROFILE,
  LocalQuickstartValidationError,
  summarizeLocalQuickstart,
} from '../../src/mindcraft/local-quickstart.js';

const models = [
  { name: 'qwen2.5:3b', kind: 'chat' },
  { name: 'nomic-embed-text:latest', kind: 'embedding' },
];

test('Given installed Ollama models, when local quickstart is planned, then it creates one persistent auto-start bot setup', () => {
  const plan = createLocalQuickstartPlan({
    botName: 'MindcraftBot',
    chatModel: 'qwen2.5:3b',
    embeddingModel: 'nomic-embed-text:latest',
    host: '127.0.0.1',
    port: 55916,
    autoStart: true,
  }, models, {
    agent_defaults: {
      auth: 'offline',
      base_profile: 'assistant',
      init_message: 'Hello from Mindcraft',
    },
  });

  assert.equal(plan.profile.name, 'MindcraftBot');
  assert.equal(plan.profile.model, 'ollama/qwen2.5:3b');
  assert.equal(plan.profile.embedding, 'ollama/nomic-embed-text:latest');
  assert.equal(plan.profile.runtime.autonomy, 'balanced');
  assert.equal(plan.profile.runtime.survival.mode, 'full');
  assert.equal(plan.profile.runtime.jobs.mode, 'resumable');
  assert.equal(plan.profile.runtime.reactions.mode, 'natural');
  assert.equal(plan.profile.modes.self_preservation, true);
  assert.equal(plan.profile.modes.hunting, false);
  assert.equal(plan.profile.modes.item_collecting, true);
  assert.deepEqual(plan.configUpdate.profiles, [LOCAL_QUICKSTART_PROFILE]);
  assert.equal(plan.configUpdate.auto_open_ui, true);
  assert.equal(plan.configUpdate.auto_start, true);
  assert.equal(plan.configUpdate.agent_defaults.host, '127.0.0.1');
  assert.equal(plan.configUpdate.agent_defaults.port, 55916);
  assert.equal(plan.configUpdate.agent_defaults.init_message, 'Hello from Mindcraft');
});

test('Given an unavailable model or invalid Minecraft name, when quickstart is planned, then it rejects before persistence', () => {
  assert.throws(
    () => createLocalQuickstartPlan({
      botName: 'MindcraftBot',
      chatModel: 'not-installed',
      port: 55916,
    }, models, {}),
    LocalQuickstartValidationError,
  );
  assert.throws(
    () => createLocalQuickstartPlan({
      botName: 'name with spaces',
      chatModel: 'qwen2.5:3b',
      port: 55916,
    }, models, {}),
    /3-16 characters/,
  );
});

test('Given local setup is saved without a start request, when it is planned, then automatic spawning stays disabled', () => {
  const plan = createLocalQuickstartPlan({
    botName: 'MindcraftBot',
    chatModel: 'qwen2.5:3b',
    port: 55916,
  }, models, {});

  assert.equal(plan.configUpdate.auto_start, false);
});

test('Given a selected generated profile, when quickstart is summarized, then only safe setup metadata is returned', () => {
  assert.deepEqual(summarizeLocalQuickstart({
    profiles: [LOCAL_QUICKSTART_PROFILE],
    auto_start: true,
    agent_defaults: { host: 'localhost', port: 25565 },
  }, {
    name: 'MindcraftBot',
    model: 'ollama/qwen2.5:3b',
    embedding: 'ollama/nomic-embed-text:latest',
    privatePrompt: 'must-not-be-returned',
  }), {
    configured: true,
    botName: 'MindcraftBot',
    chatModel: 'qwen2.5:3b',
    embeddingModel: 'nomic-embed-text:latest',
    minecraft: { host: 'localhost', port: 25565 },
    autoStart: true,
  });
});
