import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import http from 'node:http';
import test from 'node:test';

import { createMindServer } from '../../src/mindcraft/mindserver.js';
import {
  discoverOpenAICompatibleModelsAt,
  discoverLocalServices,
  recommendOllamaModels,
  summarizeOllamaModels,
} from '../../src/mindcraft/local-service-discovery.js';
import { swarm } from '../../src/mindcraft/swarm/swarm.js';

function fakeRequest(statusCode, { timeout = false, body = '' } = {}) {
  const request = new EventEmitter();
  request.destroyed = false;
  request.destroy = () => {
    request.destroyed = true;
  };
  request.setTimeout = (_milliseconds, onTimeout) => {
    if (timeout) queueMicrotask(onTimeout);
  };

  queueMicrotask(() => {
    if (timeout) return;
    const response = new EventEmitter();
    response.statusCode = statusCode;
    response.headers = { 'x-secret-header': 'must-not-leak' };
    response.resume = () => body;
    response.emit('data', body);
    response.emit('end');
    request.responseCallback(response);
  });

  return request;
}

function requestFactoryFor(statuses, requests) {
  return (options, responseCallback) => {
    requests.push(options);
    const request = fakeRequest(statuses[options.port]);
    request.responseCallback = responseCallback;
    return request;
  };
}

function getJson(server, requestPath) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const request = http.get({
      hostname: 'localhost',
      port: address.port,
      path: requestPath,
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try {
          resolve({ statusCode: response.statusCode, body: JSON.parse(body) });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', reject);
  });
}

async function closeServer(server) {
  if (!server) return;
  if (!server.listening) await once(server, 'listening');
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test('Given fixed local provider responses, when discovery runs, then it returns only the fixed catalog and status fields', async () => {
  // Given
  const requests = [];
  const requestFactory = requestFactoryFor({
    11434: 200,
    1234: 503,
    8000: 404,
  }, requests);

  // When
  const services = await discoverLocalServices(requestFactory);

  // Then
  assert.deepEqual(services, [
    { id: 'ollama', label: 'Ollama', available: true, status: 'available' },
    { id: 'lm-studio', label: 'LM Studio', available: false, status: 'unavailable' },
    { id: 'vllm', label: 'vLLM', available: false, status: 'unavailable' },
  ]);
  assert.deepEqual(requests, [
    { hostname: '127.0.0.1', port: 11434, path: '/api/tags', method: 'GET' },
    { hostname: '127.0.0.1', port: 1234, path: '/v1/models', method: 'GET' },
    { hostname: '127.0.0.1', port: 8000, path: '/v1/models', method: 'GET' },
  ]);
  for (const service of services) assert.deepEqual(Object.keys(service), ['id', 'label', 'available', 'status']);
});

test('Given discovery input containing a response body and headers, when a provider fails or times out, then output is generic and bounded', async () => {
  // Given
  const requests = [];
  let timeoutMilliseconds = 0;
  const requestFactory = (options, responseCallback) => {
    requests.push(options);
    const request = fakeRequest(200, {
      timeout: options.port === 1234,
      body: 'provider-model-secret https://private.example token=secret-value',
    });
    const originalSetTimeout = request.setTimeout;
    request.setTimeout = (milliseconds, onTimeout) => {
      timeoutMilliseconds = Math.max(timeoutMilliseconds, milliseconds);
      originalSetTimeout(milliseconds, onTimeout);
    };
    request.responseCallback = responseCallback;
    return request;
  };

  // When
  const services = await discoverLocalServices(requestFactory);
  const output = JSON.stringify(services);

  // Then
  assert.equal(timeoutMilliseconds <= 1000, true);
  assert.match(output, /ollama|lm-studio|vllm/);
  assert.doesNotMatch(output, /provider-model-secret|private\.example|token=|secret-value|x-secret-header/i);
  assert.deepEqual(services.find(({ id }) => id === 'lm-studio'), {
    id: 'lm-studio', label: 'LM Studio', available: false, status: 'timeout',
  });
  assert.equal(services.every((service) => !Object.hasOwn(service, 'url')), true);
});

test('Given the loopback MindServer, when the local-services GET route is requested, then a sanitized fixed-shape catalog is returned', async () => {
  // Given
  const server = await createMindServer(false, 0);

  try {
    // When
    const response = await getJson(server, '/api/local-services');

    // Then
    assert.equal(response.statusCode, 200);
    assert.deepEqual(Object.keys(response.body), ['success', 'services']);
    assert.equal(response.body.success, true);
    assert.deepEqual(response.body.services.map(({ id, label }) => ({ id, label })), [
      { id: 'ollama', label: 'Ollama' },
      { id: 'lm-studio', label: 'LM Studio' },
      { id: 'vllm', label: 'vLLM' },
    ]);
    assert.equal(response.body.services.every(({ available, status }) => (
      (available === true && status === 'available')
      || (available === false && ['unavailable', 'timeout'].includes(status))
    )), true);
    assert.doesNotMatch(JSON.stringify(response.body), /127\.0\.0\.1|11434|1234|8000|\/api\/tags|\/v1\/models|authorization|api[-_]?key|models/i);
  } finally {
    await closeServer(server);
    swarm.stop();
  }
});

test('Given an Ollama model payload, when it is summarized, then only bounded safe names and model kinds are returned', () => {
  const models = summarizeOllamaModels({
    models: [
      { name: 'qwen2.5:3b' },
      { model: 'nomic-embed-text:latest' },
      { name: 'qwen2.5:3b' },
      { name: 'bad model with spaces token=secret' },
      { name: 'x'.repeat(121) },
    ],
  });

  assert.deepEqual(models, [
    { name: 'qwen2.5:3b', kind: 'chat' },
    { name: 'nomic-embed-text:latest', kind: 'embedding' },
  ]);
  assert.deepEqual(recommendOllamaModels(models), {
    chatModel: 'qwen2.5:3b',
    embeddingModel: 'nomic-embed-text:latest',
  });
});

test('Given a bracketed IPv6 loopback provider URL, when compatible models are discovered, then the local endpoint is queried without brackets', async () => {
  const requests = [];
  const requestFactory = (options, responseCallback) => {
    requests.push(options);
    const request = new EventEmitter();
    request.destroy = () => {};
    request.setTimeout = () => {};
    queueMicrotask(() => {
      const response = new EventEmitter();
      response.statusCode = 200;
      response.setEncoding = () => {};
      responseCallback(response);
      response.emit('data', JSON.stringify({ data: [{ id: 'ipv6-local-model' }] }));
      response.emit('end');
    });
    return request;
  };

  const result = await discoverOpenAICompatibleModelsAt('http://[::1]:4567/v1', {
    http: requestFactory,
  });

  assert.deepEqual(result, {
    reachable: true,
    models: [{ name: 'ipv6-local-model', kind: 'chat' }],
  });
  assert.deepEqual(requests, [{
    hostname: '::1',
    port: '4567',
    path: '/v1/models',
    method: 'GET',
  }]);
});
