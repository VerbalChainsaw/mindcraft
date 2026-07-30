import http from 'node:http';
import https from 'node:https';
import { Buffer } from 'node:buffer';

const PROBE_TIMEOUT_MS = 1000;
const MAX_MODEL_RESPONSE_BYTES = 256 * 1024;
const MAX_LOCAL_MODELS = 50;

const LOCAL_SERVICE_TARGETS = Object.freeze([
  Object.freeze({ id: 'ollama', label: 'Ollama', hostname: '127.0.0.1', port: 11434, path: '/api/tags' }),
  Object.freeze({ id: 'lm-studio', label: 'LM Studio', hostname: '127.0.0.1', port: 1234, path: '/v1/models' }),
  Object.freeze({ id: 'vllm', label: 'vLLM', hostname: '127.0.0.1', port: 8000, path: '/v1/models' }),
]);

function isSuccessfulStatus(statusCode) {
  return Number.isInteger(statusCode) && statusCode >= 200 && statusCode < 300;
}

function requestLocalService(options, onResponse) {
  return http.get(options, onResponse);
}

function normalizeModelName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name || name.length > 120) return null;
  return /^[A-Za-z0-9._:/@+-]+$/.test(name) ? name : null;
}

function modelKind(name) {
  return /(?:^|[-_./:])(embed|embedding|bge|nomic|mxbai)(?:[-_./:]|$)/i.test(name)
    ? 'embedding'
    : 'chat';
}

export function summarizeOllamaModels(payload) {
  const rows = Array.isArray(payload?.models) ? payload.models : [];
  const seen = new Set();
  const models = [];
  for (const row of rows) {
    const name = normalizeModelName(row?.name || row?.model);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    models.push({ name, kind: modelKind(name) });
    if (models.length >= MAX_LOCAL_MODELS) break;
  }
  return models;
}

export function recommendOllamaModels(models) {
  const list = Array.isArray(models) ? models : [];
  const chatModels = list.filter(({ kind }) => kind === 'chat');
  const embeddingModels = list.filter(({ kind }) => kind === 'embedding');
  const chatScore = (name) => {
    if (/qwen/i.test(name)) return 50;
    if (/llama/i.test(name) && !/vision/i.test(name)) return 40;
    if (/mistral|gemma/i.test(name)) return 30;
    if (/vision|moondream/i.test(name)) return 10;
    return 20;
  };
  const embeddingScore = (name) => {
    if (/nomic/i.test(name)) return 40;
    if (/mxbai/i.test(name)) return 30;
    if (/bge/i.test(name)) return 20;
    return 10;
  };
  const best = (rows, score) => [...rows]
    .sort((a, b) => score(b.name) - score(a.name) || a.name.localeCompare(b.name))[0]?.name || null;
  return {
    chatModel: best(chatModels, chatScore),
    embeddingModel: best(embeddingModels, embeddingScore),
  };
}

function probeLocalService(target, requestFactory) {
  return new Promise((resolve) => {
    let settled = false;
    let deadline;
    let request;

    const finish = (available, status) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve({
        id: target.id,
        label: target.label,
        available,
        status,
      });
    };

    const onTimeout = () => {
      try {
        request?.destroy();
      } catch {
        // The probe result remains a generic timeout either way.
      }
      finish(false, 'timeout');
    };

    try {
      request = requestFactory({
        hostname: target.hostname,
        port: target.port,
        path: target.path,
        method: 'GET',
      }, (response) => {
        const available = isSuccessfulStatus(response?.statusCode);
        finish(available, available ? 'available' : 'unavailable');
        try {
          // Discard the body without buffering or parsing it.
          response?.resume?.();
          response?.destroy?.();
        } catch {
          // The HTTP status still provides the bounded probe result.
        }
      });

      if (settled) return;
      if (typeof request?.once === 'function') {
        request.once('error', () => finish(false, 'unavailable'));
      }
      deadline = setTimeout(onTimeout, PROBE_TIMEOUT_MS);
      if (typeof request?.setTimeout === 'function') {
        request.setTimeout(PROBE_TIMEOUT_MS, onTimeout);
      }
    } catch {
      finish(false, 'unavailable');
    }
  });
}

export function discoverLocalServices(requestFactory = requestLocalService) {
  return Promise.all(LOCAL_SERVICE_TARGETS.map((target) => probeLocalService(target, requestFactory)));
}

export function discoverOllamaModels(requestFactory = requestLocalService) {
  return new Promise((resolve) => {
    let settled = false;
    let request;
    let deadline;
    const finish = (models = []) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(models);
    };
    const onTimeout = () => {
      try {
        request?.destroy();
      } catch {
        // The bounded empty result remains valid.
      }
      finish([]);
    };

    try {
      request = requestFactory({
        hostname: '127.0.0.1',
        port: 11434,
        path: '/api/tags',
        method: 'GET',
      }, (response) => {
        if (!isSuccessfulStatus(response?.statusCode)) {
          try {
            response?.resume?.();
          } catch {
            // Ignore an unreadable error body.
          }
          finish([]);
          return;
        }

        let size = 0;
        const chunks = [];
        response.setEncoding?.('utf8');
        response.on?.('data', (chunk) => {
          if (settled) return;
          const text = String(chunk);
          size += Buffer.byteLength(text);
          if (size > MAX_MODEL_RESPONSE_BYTES) {
            try {
              request?.destroy();
            } catch {
              // The bounded empty result remains valid.
            }
            finish([]);
            return;
          }
          chunks.push(text);
        });
        response.on?.('end', () => {
          if (settled) return;
          try {
            finish(summarizeOllamaModels(JSON.parse(chunks.join(''))));
          } catch {
            finish([]);
          }
        });
        response.on?.('error', () => finish([]));
      });
      request.once?.('error', () => finish([]));
      deadline = setTimeout(onTimeout, PROBE_TIMEOUT_MS);
      request.setTimeout?.(PROBE_TIMEOUT_MS, onTimeout);
    } catch {
      finish([]);
    }
  });
}

export function discoverOpenAICompatibleModels(providerId, requestFactory = requestLocalService) {
  const target = LOCAL_SERVICE_TARGETS.find((entry) => entry.id === String(providerId || '').toLowerCase());
  if (!target || !['lm-studio', 'vllm'].includes(target.id)) return Promise.resolve([]);
  return new Promise((resolve) => {
    let settled = false;
    let request;
    let deadline;
    const finish = (models = []) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(models);
    };
    const onTimeout = () => {
      try { request?.destroy(); } catch { /* bounded empty result */ }
      finish([]);
    };
    try {
      request = requestFactory({ hostname: target.hostname, port: target.port, path: target.path, method: 'GET' }, (response) => {
        if (!isSuccessfulStatus(response?.statusCode)) {
          response?.resume?.();
          finish([]);
          return;
        }
        let size = 0;
        const chunks = [];
        response.setEncoding?.('utf8');
        response.on?.('data', (chunk) => {
          if (settled) return;
          const text = String(chunk);
          size += Buffer.byteLength(text);
          if (size > MAX_MODEL_RESPONSE_BYTES) {
            try { request?.destroy(); } catch { /* bounded empty result */ }
            finish([]);
            return;
          }
          chunks.push(text);
        });
        response.on?.('end', () => {
          try {
            const rows = JSON.parse(chunks.join(''))?.data;
            const seen = new Set();
            const models = [];
            for (const row of Array.isArray(rows) ? rows : []) {
              const name = normalizeModelName(row?.id || row?.name);
              if (!name || seen.has(name)) continue;
              seen.add(name);
              models.push({ name, kind: modelKind(name) });
              if (models.length >= MAX_LOCAL_MODELS) break;
            }
            finish(models);
          } catch {
            finish([]);
          }
        });
        response.on?.('error', () => finish([]));
      });
      request.once?.('error', () => finish([]));
      deadline = setTimeout(onTimeout, PROBE_TIMEOUT_MS);
      request.setTimeout?.(PROBE_TIMEOUT_MS, onTimeout);
    } catch {
      finish([]);
    }
  });
}

export function discoverOpenAICompatibleModelsAt(baseUrl, requestFactories = {}) {
  let endpoint;
  try {
    endpoint = new URL(String(baseUrl || ''));
  } catch {
    return Promise.resolve({ reachable: false, models: [] });
  }
  const parsedHostname = endpoint.hostname.toLowerCase();
  const hostname = parsedHostname.startsWith('[') && parsedHostname.endsWith(']')
    ? parsedHostname.slice(1, -1)
    : parsedHostname;
  if (
    !['127.0.0.1', 'localhost', '::1'].includes(hostname)
    || !['http:', 'https:'].includes(endpoint.protocol)
    || endpoint.username
    || endpoint.password
  ) {
    return Promise.resolve({ reachable: false, models: [] });
  }
  const requestFactory = endpoint.protocol === 'https:'
    ? (requestFactories.https || https.get)
    : (requestFactories.http || requestLocalService);
  const pathname = `${endpoint.pathname.replace(/\/+$/, '') || ''}/models`;

  return new Promise((resolve) => {
    let settled = false;
    let request;
    let deadline;
    const finish = (reachable, models = []) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve({ reachable, models });
    };
    const onTimeout = () => {
      try { request?.destroy(); } catch { /* bounded readiness result */ }
      finish(false);
    };
    try {
      request = requestFactory({
        hostname,
        port: endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80),
        path: pathname,
        method: 'GET',
      }, (response) => {
        if (!isSuccessfulStatus(response?.statusCode)) {
          response?.resume?.();
          finish(false);
          return;
        }
        let size = 0;
        const chunks = [];
        response.setEncoding?.('utf8');
        response.on?.('data', (chunk) => {
          if (settled) return;
          const text = String(chunk);
          size += Buffer.byteLength(text);
          if (size > MAX_MODEL_RESPONSE_BYTES) {
            try { request?.destroy(); } catch { /* bounded readiness result */ }
            finish(false);
            return;
          }
          chunks.push(text);
        });
        response.on?.('end', () => {
          try {
            const rows = JSON.parse(chunks.join(''))?.data;
            const seen = new Set();
            const models = [];
            for (const row of Array.isArray(rows) ? rows : []) {
              const name = normalizeModelName(row?.id || row?.name);
              if (!name || seen.has(name)) continue;
              seen.add(name);
              models.push({ name, kind: modelKind(name) });
              if (models.length >= MAX_LOCAL_MODELS) break;
            }
            finish(true, models);
          } catch {
            finish(false);
          }
        });
        response.on?.('error', () => finish(false));
      });
      request.once?.('error', () => finish(false));
      deadline = setTimeout(onTimeout, PROBE_TIMEOUT_MS);
      request.setTimeout?.(PROBE_TIMEOUT_MS, onTimeout);
    } catch {
      finish(false);
    }
  });
}
