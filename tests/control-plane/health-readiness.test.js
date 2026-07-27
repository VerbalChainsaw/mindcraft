import assert from 'node:assert/strict';
import test from 'node:test';

import * as Mindcraft from '../../src/mindcraft/mindcraft.js';
import { buildHealthStatus } from '../../src/mindcraft/health-status.js';

function selectProfile(name, model, extras = {}) {
  const settings = {
    profile: { name, model, ...extras },
  };
  Mindcraft.registerBlockedAgent(settings, {
    name,
    state: 'blocked',
    running: false,
    retryable: true,
    lastError: 'Prepared readiness must be recomputed.',
  });
  return settings;
}

function healthInput(selectedProfiles, overrides = {}) {
  return {
    anyApiKey: false,
    keysFileExists: false,
    minecraftReachable: true,
    minecraftTarget: '127.0.0.1:25565',
    agents: [{ name: 'selected-agent', in_game: true, socket_connected: true }],
    selectedProfiles,
    ...overrides,
  };
}

function cleanup(...names) {
  for (const name of names) Mindcraft.destroyAgent(name);
}

test('Given selected local profiles and no API keys, when health is assembled, then selected readiness is true while legacy anyApiKey remains false', () => {
  // Given
  selectProfile('local-ollama', 'ollama/llama3');
  selectProfile('local-lmstudio', 'lmstudio/local-model');
  selectProfile('local-vllm', 'vllm/local-model');

  try {
    // When
    const selectedProfiles = Mindcraft.getSelectedProfileReadiness(() => false);
    const health = buildHealthStatus(healthInput(selectedProfiles));

    // Then
    assert.equal(health.checks.anyApiKey, false);
    assert.equal(health.checks.selectedProfilesReady, true);
    assert.equal(health.ok, true);
    assert.equal(health.problems.includes('No API key configured — add one in the Setup Wizard (API Keys card).'), false);
    assert.deepEqual(selectedProfiles.map(({ name, state }) => ({ name, state })), [
      { name: 'local-lmstudio', state: 'ready' },
      { name: 'local-ollama', state: 'ready' },
      { name: 'local-vllm', state: 'ready' },
    ]);
  } finally {
    cleanup('local-ollama', 'local-lmstudio', 'local-vllm');
  }
});

test('Given duplicate local selected profiles, when health readiness is requested, then each selected descriptor remains blocked without exposing settings', () => {
  // Given
  const agentName = 'duplicate-local-health-agent';
  const firstSettings = {
    profile: {
      name: agentName,
      model: 'ollama/local',
      url: 'https://private-one.example/v1',
      params: { apiKey: 'first-secret' },
    },
  };
  const secondSettings = {
    profile: {
      name: agentName,
      model: 'lmstudio/local',
      url: 'https://private-two.example/v1',
      params: { apiKey: 'second-secret' },
    },
  };
  const duplicateReason = `Duplicate agent name "${agentName}".`;
  Mindcraft.registerBlockedAgent(firstSettings, {
    index: 0,
    name: agentName,
    state: 'blocked',
    running: false,
    retryable: false,
    lastError: duplicateReason,
  });
  Mindcraft.registerBlockedAgent(secondSettings, {
    index: 1,
    name: agentName,
    state: 'blocked',
    running: false,
    retryable: false,
    lastError: duplicateReason,
  });

  try {
    // When
    const selectedProfiles = Mindcraft.getSelectedProfileReadiness(() => false);
    const health = buildHealthStatus(healthInput(selectedProfiles));

    // Then
    assert.deepEqual(selectedProfiles.map(({ name, state, reason }) => ({ name, state, reason })), [
      { name: agentName, state: 'blocked', reason: duplicateReason },
      { name: agentName, state: 'blocked', reason: duplicateReason },
    ]);
    assert.equal(health.checks.selectedProfilesReady, false);
    assert.deepEqual(health.problems, [
      `Selected profile "${agentName}" is blocked: ${duplicateReason}`,
      `Selected profile "${agentName}" is blocked: ${duplicateReason}`,
    ]);
    assert.doesNotMatch(JSON.stringify(selectedProfiles), /private-one|private-two|first-secret|second-secret|url|apiKey/i);
  } finally {
    cleanup(agentName);
  }
});

test('Given a selected credentialed provider without any API key, when health is assembled, then legacy no-key health remains false', () => {
  // Given
  const selectedProfiles = [{
    name: 'credentialed-health-agent',
    state: 'ready',
    providerRoles: [{ role: 'chat model', provider: 'openai' }],
    reason: null,
  }];

  // When
  const health = buildHealthStatus(healthInput(selectedProfiles));

  // Then
  assert.equal(health.checks.anyApiKey, false);
  assert.equal(health.ok, false);
  assert.deepEqual(health.problems, [
    'No API key configured — add one in the Setup Wizard (API Keys card).',
  ]);
});

test('Given credentialed profiles and only unrelated keys, when readiness is recomputed, then those profiles remain blocked', () => {
  // Given
  selectProfile('openai-unrelated-key', 'openai/gpt-4o');
  selectProfile('compatible-unrelated-key', {
    api: 'openai_compatible',
    model: 'custom/model',
    url: 'https://custom-provider.example/v1',
  });
  selectProfile('compatible-advertised-key', {
    api: 'openai_compatible',
    model: 'together/model',
    url: 'https://api.together.xyz/v1',
    params: { api_key_env: 'TOGETHER_API_KEY' },
  });

  try {
    // When
    const profiles = Mindcraft.getSelectedProfileReadiness(
      (key) => key === 'DEEPSEEK_API_KEY' || key === 'TOGETHER_API_KEY',
    );

    // Then
    assert.deepEqual(profiles.map(({ name, state }) => ({ name, state })), [
      { name: 'compatible-advertised-key', state: 'ready' },
      { name: 'compatible-unrelated-key', state: 'blocked' },
      { name: 'openai-unrelated-key', state: 'blocked' },
    ]);
    assert.equal(profiles[2].reason, 'Missing credential for chat model provider "openai".');
  } finally {
    cleanup('openai-unrelated-key', 'compatible-unrelated-key', 'compatible-advertised-key');
  }
});

test('Given a DeepSeek profile without its required key, when health is assembled, then only that selected profile has a specific blocked problem', () => {
  // Given
  selectProfile('deepseek-missing-key', 'deepseek/deepseek-chat');

  try {
    // When
    const selectedProfiles = Mindcraft.getSelectedProfileReadiness(() => false);
    const health = buildHealthStatus(healthInput(selectedProfiles, { anyApiKey: true }));

    // Then
    assert.equal(health.checks.selectedProfilesReady, false);
    assert.equal(selectedProfiles[0].state, 'blocked');
    assert.deepEqual(health.problems, [
      'Selected profile "deepseek-missing-key" is blocked: Missing credential for chat model provider "deepseek".',
    ]);
  } finally {
    cleanup('deepseek-missing-key');
  }
});

test('Given a selected profile and a hot-added required key, when readiness is requested again, then it changes without re-registering the profile', () => {
  // Given
  selectProfile('hot-key-profile', 'openai/gpt-4o');
  let keyAvailable = false;
  const keyLookup = (key) => keyAvailable && key === 'OPENAI_API_KEY';

  try {
    // When
    const before = Mindcraft.getSelectedProfileReadiness(keyLookup);
    keyAvailable = true;
    const after = Mindcraft.getSelectedProfileReadiness(keyLookup);

    // Then
    assert.equal(before[0].state, 'blocked');
    assert.equal(after[0].state, 'ready');
    assert.equal(after[0].reason, null);
  } finally {
    cleanup('hot-key-profile');
  }
});

test('Given mixed local and credentialed profiles, when readiness is recomputed, then profile states remain independent', () => {
  // Given
  selectProfile('mixed-local', 'ollama/llama3');
  selectProfile('mixed-openai', 'openai/gpt-4o');

  try {
    // When
    const profiles = Mindcraft.getSelectedProfileReadiness(() => false);

    // Then
    assert.deepEqual(profiles.map(({ name, state }) => ({ name, state })), [
      { name: 'mixed-local', state: 'ready' },
      { name: 'mixed-openai', state: 'blocked' },
    ]);
  } finally {
    cleanup('mixed-local', 'mixed-openai');
  }
});

test('Given private profile settings, when selected readiness is returned, then it exposes only sanitized readiness fields', () => {
  // Given
  selectProfile('sanitized-profile', {
    api: 'openai',
    model: 'gpt-4o',
    url: 'https://private-provider.example/v1',
    params: { apiKey: 'must-not-leak' },
  }, {
    code_model: 'ollama/code',
    vision_model: 'openai/gpt-4o',
  });

  try {
    // When
    const [profile] = Mindcraft.getSelectedProfileReadiness(() => false);

    // Then
    assert.deepEqual(Object.keys(profile), ['name', 'state', 'providerRoles', 'reason']);
    assert.ok(profile.providerRoles.every((role) => Object.keys(role).join(',') === 'role,provider'));
    assert.deepEqual(profile.providerRoles, [
      { role: 'chat model', provider: 'openai' },
      { role: 'code model', provider: 'ollama' },
      { role: 'vision model', provider: 'openai' },
      { role: 'embedding model', provider: 'openai' },
    ]);
    assert.doesNotMatch(JSON.stringify(profile), /private-provider|must-not-leak|url|apiKey/i);
  } finally {
    cleanup('sanitized-profile');
  }
});

test('Given legacy health inputs, when health is assembled, then legacy fields are preserved and selected fields are additive', () => {
  // Given
  const input = healthInput([], {
    anyApiKey: true,
    keysFileExists: true,
    minecraftReachable: false,
    minecraftTarget: 'localhost:55916',
    agents: [
      { name: 'one', in_game: true, socket_connected: true },
      { name: 'two', in_game: false, socket_connected: false },
    ],
  });

  // When
  const health = buildHealthStatus(input);

  // Then
  assert.equal(health.success, true);
  assert.equal(health.ok, false);
  assert.deepEqual(health.checks, {
    anyApiKey: true,
    keysFileExists: true,
    minecraftReachable: false,
    minecraftTarget: 'localhost:55916',
    agentsRegistered: 2,
    agentsInGame: 1,
    selectedProfilesReady: false,
    selectedProfiles: [],
  });
  assert.deepEqual(health.problems, [
    'Minecraft server unreachable at localhost:55916 — open a world to LAN on that port, or change it in Setup.',
  ]);
});
