import assert from 'node:assert/strict';
import test from 'node:test';

import { isCancellation } from '../../src/models/cancellation.js';
import { DeepSeek } from '../../src/models/deepseek.js';

function fakeClient(create) {
  return {
    chat: { completions: { create } },
    embeddings: { create() { throw new Error('unexpected embedding request'); } },
  };
}

test('DeepSeek uses the current Flash model, endpoint, credential, and request controls', async () => {
  let clientConfig;
  let requestBody;
  const model = new DeepSeek(null, null, {
    timeout: 45,
    thinking: { type: 'disabled' },
  }, {
    readKey: (name) => {
      assert.equal(name, 'DEEPSEEK_API_KEY');
      return 'test-key';
    },
    createClient: (config) => {
      clientConfig = config;
      return fakeClient((body) => {
        requestBody = body;
        return Promise.resolve({
          choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
        });
      });
    },
  });

  assert.equal(await model.sendRequest([{ role: 'user', content: 'hello' }], 'system'), 'ok');
  assert.deepEqual(clientConfig, {
    baseURL: 'https://api.deepseek.com',
    apiKey: 'test-key',
    timeout: 45_000,
    maxRetries: 0,
  });
  assert.equal(requestBody.model, 'deepseek-v4-flash');
  assert.deepEqual(requestBody.thinking, { type: 'disabled' });
  assert.equal(Object.hasOwn(requestBody, 'timeout'), false);
});

test('DeepSeek cancellation aborts the owned request without returning a provider failure', async () => {
  const model = new DeepSeek('deepseek-v4-flash', null, {}, {
    readKey: () => 'test-key',
    createClient: () => fakeClient((_body, options = {}) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('Request was aborted.');
        error.name = 'AbortError';
        reject(error);
      });
    })),
  });

  const pending = model.sendRequest([{ role: 'user', content: 'hello' }], 'system');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(model.cancelPending(), 1);
  await assert.rejects(pending, error => isCancellation(error));
});

test('DeepSeek rejects an attempt to redirect its credential lookup', () => {
  assert.throws(
    () => new DeepSeek('deepseek-v4-flash', null, {
      api_key_env: 'OPENAI_API_KEY',
    }, {
      readKey: () => 'unused',
      createClient: () => fakeClient(() => Promise.resolve()),
    }),
    /invalid deepseek api_key_env/i,
  );
});

test('DeepSeek keeps embeddings unsupported', async () => {
  const model = new DeepSeek('deepseek-v4-flash', null, {}, {
    readKey: () => 'test-key',
    createClient: () => fakeClient(() => Promise.resolve()),
  });

  await assert.rejects(model.embed('hello'), /not supported by Deepseek/i);
});
