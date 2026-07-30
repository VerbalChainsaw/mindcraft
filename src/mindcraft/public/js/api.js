const pathName = window.location.pathname;
export const basePath = pathName.endsWith('/') ? pathName : pathName.slice(0, pathName.lastIndexOf('/') + 1);
export const apiBase = `${basePath}api`;
export const API_REQUEST_TIMEOUT_MS = 15_000;
export const API_MAX_RESPONSE_CHARS = 2_000_000;

function safeMessage(value, fallback = 'Mindcraft request failed.') {
  const message = String(value || '').replace(/\s+/g, ' ').trim();
  return (message || fallback).slice(0, 320);
}

function normalizeApiPath(path) {
  if (typeof path !== 'string') throw new TypeError('API path must be a string.');
  const normalized = path.startsWith('/api') ? path.slice(4) : path;
  if (
    !normalized.startsWith('/')
    || normalized.startsWith('//')
    || normalized.includes('\\')
    || normalized.includes('#')
    || /(?:^|\/)\.\.(?:\/|$)/.test(normalized)
    || /%(?:0[0-9a-f]|1[0-9a-f]|2e|2f|5c|7f)/i.test(normalized)
    // eslint-disable-next-line no-control-regex -- API paths reject HTTP control characters.
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new TypeError('API path is invalid.');
  }
  return normalized;
}

export async function api(path, body, { timeoutMs = API_REQUEST_TIMEOUT_MS } = {}) {
  let normalized;
  try {
    normalized = normalizeApiPath(path);
  } catch (error) {
    return { success: false, error: safeMessage(error?.message), _ok: false, _status: 0 };
  }

  const boundedTimeoutMs = Number.isFinite(Number(timeoutMs))
    ? Math.min(120_000, Math.max(1_000, Math.trunc(Number(timeoutMs))))
    : API_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), boundedTimeoutMs);
  const options = {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal: controller.signal,
  };
  try {
    if (body !== undefined) {
      options.method = 'POST';
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    const response = await fetch(`${apiBase}${normalized}`, options);
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > API_MAX_RESPONSE_CHARS) {
      return {
        success: false,
        error: 'Mindcraft returned more data than the dashboard can safely display.',
        _ok: false,
        _status: response.status,
      };
    }
    const raw = await response.text();
    if (raw.length > API_MAX_RESPONSE_CHARS) {
      return {
        success: false,
        error: 'Mindcraft returned more data than the dashboard can safely display.',
        _ok: false,
        _status: response.status,
      };
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { success: false, error: 'Mindcraft returned an invalid response.' };
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      data = { success: false, error: 'Mindcraft returned an invalid response.' };
    }
    if (!response.ok && data.success !== false) {
      data = {
        ...data,
        success: false,
        error: safeMessage(data.error, `Mindcraft request failed with status ${response.status}.`),
      };
    }
    return { ...data, _ok: response.ok, _status: response.status };
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    return {
      success: false,
      error: timedOut
        ? `Mindcraft did not respond within ${Math.ceil(boundedTimeoutMs / 1000)} seconds.`
        : safeMessage(error?.message || error),
      _ok: false,
      _status: 0,
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function requestControlCenterRestart() {
  const result = await api('/restart', {}, { timeoutMs: 120_000 });
  if (!result.success) return result;

  const replacementPort = Number(result.port);
  if (Number.isInteger(replacementPort) && replacementPort >= 1 && replacementPort <= 65535) {
    const current = new URL(window.location.href);
    const currentPort = Number(current.port || (current.protocol === 'https:' ? 443 : 80));
    if (replacementPort !== currentPort) {
      const replacement = new URL(current.href);
      replacement.port = String(replacementPort);
      window.setTimeout(() => window.location.assign(replacement.href), 250);
    }
  }
  return result;
}

export async function optionalApi(path) {
  const result = await api(path);
  return result._status === 404 ? { success: false, unavailable: true } : result;
}
