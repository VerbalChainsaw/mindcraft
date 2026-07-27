import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { describeModelProvider } from '../../src/models/_model_map.js';
import { OpenAICompatible } from '../../src/models/openai_compatible.js';
import { prepareProfiles } from '../../src/mindcraft/profile-preflight.js';

const DEFAULTS = {
  host: '127.0.0.1',
  port: 25565,
  minecraft_version: 'auto',
  model: 'ollama/default',
};

const PROFILE_CASES = [
  ['nvidia-nim.json', 'NVIDIA_API_KEY'],
  ['together.json', 'TOGETHER_API_KEY'],
  ['fireworks.json', 'FIREWORKS_API_KEY'],
  ['deepinfra.json', 'DEEPINFRA_API_KEY'],
];

const APPROVED_KEY_NAMES = [
  'OPENAI_COMPATIBLE_API_KEY',
  'NVIDIA_API_KEY',
  'TOGETHER_API_KEY',
  'FIREWORKS_API_KEY',
  'DEEPINFRA_API_KEY',
];

test('Given unsafe api_key_env values, when the compatible adapter or descriptor validates them, then neither reads a key nor exposes the value', () => {
  for (const apiKeyEnv of ['PATH', 'AWS_SESSION_TOKEN']) {
    // Given
    let keyRead = false;
    let clientCreated = false;
    const runtime = {
      readKey: () => {
        keyRead = true;
        throw new Error('key lookup must not run');
      },
      createClient: () => {
        clientCreated = true;
        return {};
      },
    };

    // When / Then
    assert.throws(
      () => new OpenAICompatible('provider/model', 'https://provider.example/v1', { api_key_env: apiKeyEnv }, runtime),
      (error) => /invalid openai_compatible api_key_env/i.test(error.message)
        && !error.message.includes(apiKeyEnv),
    );
    assert.equal(keyRead, false, `${apiKeyEnv} must not be read`);
    assert.equal(clientCreated, false, `${apiKeyEnv} must not create a client`);
    assert.deepEqual(
      describeModelProvider({
        api: 'openai_compatible',
        model: 'provider/model',
        url: 'https://provider.example/v1',
        params: { api_key_env: apiKeyEnv },
      }),
      {
        ok: false,
        provider: 'openai_compatible',
        credentialAlternatives: [],
        error: 'Invalid openai_compatible api_key_env.',
      },
    );
  }
});

test('Given dedicated compatible-provider key names, when the adapter is constructed, then each exact key is read and accepted', () => {
  for (const apiKeyEnv of APPROVED_KEY_NAMES) {
    // Given
    const keyReads = [];
    let clientConfig;

    // When
    new OpenAICompatible('provider/model', 'https://provider.example/v1', { api_key_env: apiKeyEnv }, {
      readKey: (keyName) => {
        keyReads.push(keyName);
        return 'fixture-key';
      },
      createClient: (config) => {
        clientConfig = config;
        return {};
      },
    });

    // Then
    assert.deepEqual(keyReads, [apiKeyEnv]);
    assert.deepEqual(clientConfig, {
      baseURL: 'https://provider.example/v1',
      apiKey: 'fixture-key',
    });
  }
});

test('Given each compatible-provider profile, when preflight receives only unrelated compatible keys, then it remains blocked until its exact key is present', async () => {
  // Given
  const compatibleKeyNames = [
    ...APPROVED_KEY_NAMES,
  ];

  for (const [file, requiredKey] of PROFILE_CASES) {
    const profile = JSON.parse(await readFile(path.join('profiles', file), 'utf8'));

    // When
    const exact = prepareProfiles([{ profile }], DEFAULTS, {
      hasKey: (keyName) => keyName === requiredKey,
    });
    const unrelated = prepareProfiles([{ profile }], DEFAULTS, {
      hasKey: (keyName) => compatibleKeyNames.includes(keyName) && keyName !== requiredKey,
    });

    // Then
    assert.equal(exact.ready[0]?.state, 'ready', `${file} accepts its advertised key`);
    assert.equal(unrelated.blocked[0]?.state, 'blocked', `${file} rejects other compatible-provider keys`);
    assert.match(
      unrelated.blocked[0]?.lastError || '',
      /Missing credential for (chat|embedding) model provider "openai_compatible"/,
    );
  }
});
