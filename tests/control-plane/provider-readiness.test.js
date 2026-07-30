import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { createMindServer } from '../../src/mindcraft/mindserver.js';
import { swarm } from '../../src/mindcraft/swarm/swarm.js';

function requestJson(server, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: 'localhost',
      port: server.address().port,
      path: requestPath,
      method: 'POST',
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => resolve({ statusCode: response.statusCode, body: JSON.parse(raw) }));
    });
    request.on('error', reject);
    request.end();
  });
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  swarm.stop();
}

test('Given local providers, when readiness is checked, then configured, reachable, and model availability remain separate', async () => {
  let profile = {
    id: 'local-provider',
    provider: { id: 'ollama', chatModel: 'missing-model' },
  };
  const botLibraryStore = {
    get: () => profile,
    list: () => [profile],
    health: () => ({ writable: true, error: null }),
  };
  const server = await createMindServer(false, 0, 1, {
    botLibraryStore,
    discoverLocalServices: () => Promise.resolve([
      { id: 'ollama', label: 'Ollama', available: true, status: 'available' },
      { id: 'lm-studio', label: 'LM Studio', available: true, status: 'available' },
    ]),
    discoverOllamaModels: () => Promise.resolve([{ name: 'installed-model', kind: 'chat' }]),
    discoverOpenAICompatibleModels: () => Promise.resolve([{ name: 'served-model', kind: 'chat' }]),
    discoverOpenAICompatibleModelsAt: () => Promise.resolve({ reachable: false, models: [] }),
  });

  try {
    const ollama = await requestJson(server, '/api/bot-library/local-provider/test');
    assert.equal(ollama.statusCode, 200);
    assert.deepEqual(ollama.body.readiness, {
      provider: 'ollama',
      chatModel: 'missing-model',
      configured: true,
      reachable: true,
      modelAvailable: false,
      ready: false,
      reason: 'The selected Ollama model is not installed.',
    });

    profile = {
      id: 'local-provider',
      provider: { id: 'lmstudio', chatModel: 'served-model' },
    };
    const lmStudio = await requestJson(server, '/api/bot-library/local-provider/test');
    assert.deepEqual(lmStudio.body.readiness, {
      provider: 'lmstudio',
      chatModel: 'served-model',
      configured: true,
      reachable: true,
      modelAvailable: true,
      ready: true,
      reason: null,
    });

    profile = {
      id: 'local-provider',
      provider: {
        id: 'openai-compatible',
        chatModel: 'private-model',
        baseUrl: 'http://127.0.0.1:45678/v1?token=must-not-leak',
      },
    };
    const compatible = await requestJson(server, '/api/bot-library/local-provider/test');
    assert.equal(compatible.body.readiness.configured, true);
    assert.equal(compatible.body.readiness.reachable, false);
    assert.equal(compatible.body.readiness.modelAvailable, false);
    assert.equal(compatible.body.readiness.ready, false);
    assert.doesNotMatch(JSON.stringify(compatible.body), /45678|must-not-leak|token=/i);
  } finally {
    await closeServer(server);
  }
});
