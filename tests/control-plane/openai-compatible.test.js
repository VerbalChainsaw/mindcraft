import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { createModel, selectAPI } from '../../src/models/_model_map.js';
import { OpenAICompatible } from '../../src/models/openai_compatible.js';

const PROFILE_CASES = [
  {
    file: 'nvidia-nim.json',
    keyEnv: 'NVIDIA_API_KEY',
    url: 'https://integrate.api.nvidia.com/v1',
    chatModel: 'nvidia/llama-3.1-nemotron-70b-instruct',
    embeddingModel: 'nvidia/nv-embed-v1',
  },
  {
    file: 'together.json',
    keyEnv: 'TOGETHER_API_KEY',
    url: 'https://api.together.xyz/v1',
    chatModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    embeddingModel: 'BAAI/bge-large-en-v1.5',
  },
  {
    file: 'fireworks.json',
    keyEnv: 'FIREWORKS_API_KEY',
    url: 'https://api.fireworks.ai/inference/v1',
    chatModel: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
    embeddingModel: 'nomic-ai/nomic-embed-text-v1.5',
  },
  {
    file: 'deepinfra.json',
    keyEnv: 'DEEPINFRA_API_KEY',
    url: 'https://api.deepinfra.com/v1/openai',
    chatModel: 'meta-llama/Llama-3.3-70B-Instruct',
    embeddingModel: 'BAAI/bge-base-en-v1.5',
  },
];

function fakeClient() {
  const requests = { chat: [], embeddings: [] };
  return {
    requests,
    client: {
      chat: {
        completions: {
          create: (request) => {
            requests.chat.push(request);
            return { choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] };
          },
        },
      },
      embeddings: {
        create: (request) => {
          requests.embeddings.push(request);
          return { data: [{ embedding: [1, 2, 3] }] };
        },
      },
    },
  };
}

test('Given an adapter key env and request params, when requests are made, then getKey is used and api_key_env is never forwarded', async () => {
  // Given
  const fake = fakeClient();
  const keyLookups = [];
  let clientConfig;
  const params = { api_key_env: 'TOGETHER_API_KEY', temperature: 0.25 };
  const model = new OpenAICompatible(
    'provider/model',
    'https://provider.example/v1',
    params,
    {
      readKey: (name) => {
        keyLookups.push(name);
        return 'key-from-getKey-seam';
      },
      createClient: (config) => {
        clientConfig = config;
        return fake.client;
      },
    },
  );

  assert.deepEqual(keyLookups, ['TOGETHER_API_KEY']);
  assert.deepEqual(clientConfig, {
    baseURL: 'https://provider.example/v1',
    apiKey: 'key-from-getKey-seam',
  });

  // When
  const chat = await model.sendRequest([{ role: 'user', content: 'hello' }], 'system');
  const embedding = await model.embed('hello');

  // Then
  assert.equal(chat, 'ok');
  assert.deepEqual(embedding, [1, 2, 3]);
  assert.deepEqual(params, { api_key_env: 'TOGETHER_API_KEY', temperature: 0.25 });
  assert.equal(Object.hasOwn(fake.requests.chat[0], 'api_key_env'), false);
  assert.equal(Object.hasOwn(fake.requests.embeddings[0], 'api_key_env'), false);
  assert.equal(fake.requests.chat[0].temperature, 0.25);
  assert.equal(fake.requests.embeddings[0].temperature, 0.25);
});

test('Given an isolated keys.json, when the generic adapter uses its default key lookup, then its client receives the profile-specific file key', async () => {
  // Given
  const keyDirectory = await mkdtemp(path.join(tmpdir(), 'mindcraft-compatible-key-'));
  const adapterUrl = pathToFileURL(path.resolve('src/models/openai_compatible.js')).href;
  await writeFile(
    path.join(keyDirectory, 'keys.json'),
    JSON.stringify({ TOGETHER_API_KEY: 'fixture-key-from-key-file' }),
    'utf8',
  );
  const childScript = [
    `import { OpenAICompatible } from ${JSON.stringify(adapterUrl)};`,
    "new OpenAICompatible('provider/model', 'https://provider.example/v1', { api_key_env: 'TOGETHER_API_KEY' }, {",
    '  createClient: (configuration) => {',
    '    process.stdout.write(JSON.stringify(configuration));',
    '    return {};',
    '  },',
    '});',
  ].join('\n');

  try {
    // When
    const child = spawn(process.execPath, ['--input-type=module', '--eval', childScript], {
      cwd: keyDirectory,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const [exitCode] = await once(child, 'close');

    // Then
    assert.equal(exitCode, 0, stderr);
    assert.deepEqual(JSON.parse(stdout), {
      baseURL: 'https://provider.example/v1',
      apiKey: 'fixture-key-from-key-file',
    });
  } finally {
    await rm(keyDirectory, { recursive: true, force: true });
  }
});

test('Given a missing URL or invalid api_key_env, when the generic adapter is constructed, then it rejects without exposing the invalid value', () => {
  // Given
  const runtime = {
    readKey: () => 'unused',
    createClient: () => ({ unused: true }),
  };

  // When / Then
  assert.throws(
    () => new OpenAICompatible('model', '', {}, runtime),
    /openai_compatible requires an explicit non-empty URL/i,
  );
  const invalidKeyEnv = 'secret-value-that-must-not-appear';
  assert.throws(
    () => new OpenAICompatible('model', 'https://provider.example/v1', { api_key_env: invalidKeyEnv }, runtime),
    (error) => /invalid openai_compatible api_key_env/i.test(error.message)
      && !error.message.includes(invalidKeyEnv),
  );
});

test('Given the four compatible-provider profiles, when chat and embedding models are created, then both preserve the provider URL and exact key env', async () => {
  for (const profileCase of PROFILE_CASES) {
    // Given
    const profile = JSON.parse(await readFile(path.join('profiles', profileCase.file), 'utf8'));
    const originalKey = process.env[profileCase.keyEnv];
    process.env[profileCase.keyEnv] = 'test-only-key';

    try {
      // When
      const chat = createModel(selectAPI(structuredClone(profile.model)));
      const embedding = createModel(selectAPI(structuredClone(profile.embedding)));

      // Then
      assert.ok(chat instanceof OpenAICompatible, `${profileCase.file} chat adapter`);
      assert.ok(embedding instanceof OpenAICompatible, `${profileCase.file} embedding adapter`);
      assert.equal(chat.openai.baseURL, profileCase.url);
      assert.equal(embedding.openai.baseURL, profileCase.url);
      assert.equal(chat.apiKeyEnv, profileCase.keyEnv);
      assert.equal(embedding.apiKeyEnv, profileCase.keyEnv);
      assert.equal(chat.model_name, profileCase.chatModel);
      assert.equal(embedding.model_name, profileCase.embeddingModel);
    } finally {
      if (originalKey === undefined) delete process.env[profileCase.keyEnv];
      else process.env[profileCase.keyEnv] = originalKey;
    }
  }
});

test('Given compatible-provider key names, when setup key sources are inspected, then every advertised key is available without values', async () => {
  // Given
  const keyNames = [
    'OPENAI_COMPATIBLE_API_KEY',
    'NVIDIA_API_KEY',
    'TOGETHER_API_KEY',
    'FIREWORKS_API_KEY',
    'DEEPINFRA_API_KEY',
  ];

  // When
  const exampleKeys = JSON.parse(await readFile('keys.example.json', 'utf8'));
  const mindserverSource = await readFile('src/mindcraft/mindserver.js', 'utf8');

  // Then
  for (const keyName of keyNames) {
    assert.equal(exampleKeys[keyName], '');
    assert.match(mindserverSource, new RegExp(`'${keyName}'`));
  }
});
