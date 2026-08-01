const MIN_INTERVAL_MS = 250;
const MAX_INTERVAL_MS = 30_000;
const MIN_REQUEST_TIMEOUT_MS = 250;
const MAX_REQUEST_TIMEOUT_MS = 30_000;
const MIN_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 120_000;
const MAX_ERROR_LENGTH = 240;
const COLD_START_REQUEST_TIMEOUT_MS = 3_500;
const LEARNED_LATENCY_MULTIPLIER = 1.75;

export const DEFAULT_AGENT_TELEMETRY_CONFIG = Object.freeze({
  intervalMs: 2_500,
  requestTimeoutMs: 1_200,
  maxConcurrent: 6,
  heartbeatMs: 2_500,
  failureBackoffMs: 1_500,
  maxFailureBackoffMs: 15_000,
});

const connectionTelemetry = new WeakMap();

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(number)));
}

function errorText(error, fallback = 'state request failed') {
  return String(error?.message || error || fallback)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ERROR_LENGTH) || fallback;
}

export function normalizeAgentTelemetryConfig(value = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const failureBackoffMs = boundedInteger(
    input.failureBackoffMs,
    DEFAULT_AGENT_TELEMETRY_CONFIG.failureBackoffMs,
    MIN_BACKOFF_MS,
    MAX_BACKOFF_MS,
  );
  return Object.freeze({
    intervalMs: boundedInteger(
      input.intervalMs,
      DEFAULT_AGENT_TELEMETRY_CONFIG.intervalMs,
      MIN_INTERVAL_MS,
      MAX_INTERVAL_MS,
    ),
    requestTimeoutMs: boundedInteger(
      input.requestTimeoutMs ?? input.timeoutMs,
      DEFAULT_AGENT_TELEMETRY_CONFIG.requestTimeoutMs,
      MIN_REQUEST_TIMEOUT_MS,
      MAX_REQUEST_TIMEOUT_MS,
    ),
    maxConcurrent: boundedInteger(
      input.maxConcurrent,
      DEFAULT_AGENT_TELEMETRY_CONFIG.maxConcurrent,
      1,
      12,
    ),
    heartbeatMs: boundedInteger(
      input.heartbeatMs,
      DEFAULT_AGENT_TELEMETRY_CONFIG.heartbeatMs,
      MIN_INTERVAL_MS,
      MAX_INTERVAL_MS,
    ),
    failureBackoffMs,
    maxFailureBackoffMs: boundedInteger(
      input.maxFailureBackoffMs,
      DEFAULT_AGENT_TELEMETRY_CONFIG.maxFailureBackoffMs,
      failureBackoffMs,
      MAX_BACKOFF_MS,
    ),
  });
}

function createConnectionTelemetry(socket) {
  return {
    socket,
    lastGoodState: null,
    lastReceivedAt: 0,
    lastDurationMs: null,
    lastError: null,
    consecutiveFailures: 0,
    nextRetryAt: 0,
  };
}

function getConnectionTelemetry(connection) {
  let telemetry = connectionTelemetry.get(connection);
  if (!telemetry || telemetry.socket !== connection.socket) {
    telemetry = createConnectionTelemetry(connection.socket);
    connectionTelemetry.set(connection, telemetry);
  }
  return telemetry;
}

export function resetAgentStateCache(connection) {
  if (connection && typeof connection === 'object') {
    connectionTelemetry.delete(connection);
  }
}

function transportMetadata(telemetry, {
  status,
  now,
  error = null,
} = {}) {
  return {
    status,
    receivedAt: telemetry.lastReceivedAt || null,
    ageMs: telemetry.lastReceivedAt ? Math.max(0, now - telemetry.lastReceivedAt) : null,
    error: error ? errorText(error) : null,
    consecutiveFailures: telemetry.consecutiveFailures,
    nextRetryAt: telemetry.nextRetryAt || null,
  };
}

function withTransportMetadata(state, transport) {
  return {
    ...state,
    _meta: {
      ...(state?._meta && typeof state._meta === 'object' ? state._meta : {}),
      transport,
    },
  };
}

function unavailableState(telemetry, error, now, status = 'unavailable') {
  return {
    error: errorText(error),
    _meta: {
      sampledAt: null,
      source: 'bridge',
      depth: 'unavailable',
      transport: transportMetadata(telemetry, {
        status,
        now,
        error,
      }),
    },
  };
}

function staleOrUnavailableState(telemetry, error, now, status = 'stale') {
  const transport = transportMetadata(telemetry, {
    status,
    now,
    error,
  });
  if (!telemetry.lastGoodState) {
    return unavailableState(telemetry, error, now, status === 'backoff' ? 'backoff' : 'unavailable');
  }
  return withTransportMetadata(telemetry.lastGoodState, transport);
}

function nextFailureDelay(config, consecutiveFailures) {
  const exponent = Math.max(0, Math.min(6, consecutiveFailures - 1));
  return Math.min(
    config.maxFailureBackoffMs,
    config.failureBackoffMs * (2 ** exponent),
  );
}

function requestAgentState(connection, timeoutMs) {
  if (!connection?.in_game) {
    return Promise.resolve({ state: null, error: null });
  }
  if (
    !connection.socket
    || connection.socket.connected === false
    || typeof connection.socket.emit !== 'function'
  ) {
    return Promise.resolve({
      state: null,
      error: 'agent disconnected',
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    let timeout;
    const finish = ({ state = null, error = null } = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ state, error });
    };
    timeout = setTimeout(
      () => finish({ error: 'state request timeout' }),
      timeoutMs,
    );
    try {
      connection.socket.emit('get-full-state', (state) => {
        if (!state || typeof state !== 'object' || Array.isArray(state)) {
          finish({ error: 'invalid state response' });
          return;
        }
        if (state.error) {
          finish({ error: state.error });
          return;
        }
        finish({ state });
      });
    } catch (error) {
      finish({ error: errorText(error) });
    }
  });
}

async function sampleAgentState(agentName, connection, config, clock) {
  const telemetry = getConnectionTelemetry(connection);
  const requestStartedAt = clock();
  if (requestStartedAt < telemetry.nextRetryAt) {
    return [
      agentName,
      staleOrUnavailableState(telemetry, telemetry.lastError || 'state request backoff', requestStartedAt, 'backoff'),
    ];
  }

  const learnedTimeout = Number.isFinite(telemetry.lastDurationMs)
    ? Math.ceil(telemetry.lastDurationMs * LEARNED_LATENCY_MULTIPLIER)
    : 0;
  const failureTimeout = config.requestTimeoutMs * (1 + Math.min(3, telemetry.consecutiveFailures));
  const requestTimeoutMs = Math.min(
    MAX_REQUEST_TIMEOUT_MS,
    Math.max(
      config.requestTimeoutMs,
      telemetry.lastGoodState ? 0 : COLD_START_REQUEST_TIMEOUT_MS,
      learnedTimeout,
      failureTimeout,
    ),
  );
  const result = await requestAgentState(connection, requestTimeoutMs);
  const receivedAt = clock();
  if (!result.state) {
    telemetry.consecutiveFailures += 1;
    telemetry.lastError = errorText(result.error);
    telemetry.nextRetryAt = receivedAt + nextFailureDelay(config, telemetry.consecutiveFailures);
    return [
      agentName,
      staleOrUnavailableState(telemetry, telemetry.lastError, receivedAt),
    ];
  }

  telemetry.lastGoodState = result.state;
  telemetry.lastReceivedAt = receivedAt;
  telemetry.lastDurationMs = Math.max(0, receivedAt - requestStartedAt);
  telemetry.lastError = null;
  telemetry.consecutiveFailures = 0;
  telemetry.nextRetryAt = 0;
  // Healthy samples retain their exact legacy shape. Only a degraded bridge
  // overlays transport metadata, so existing bot-state consumers never need
  // to strip a server-owned wrapper from normal game evidence.
  return [agentName, result.state];
}

export async function collectAgentStates(agentConnections, options = {}) {
  const config = normalizeAgentTelemetryConfig(options);
  const clock = typeof options?.clock === 'function' ? options.clock : Date.now;
  const targets = Object.entries(agentConnections || {})
    .filter(([, connection]) => connection?.in_game)
    .sort(([left], [right]) => left.localeCompare(right));
  const entries = new Array(targets.length);
  const workers = Math.max(1, Math.min(config.maxConcurrent, targets.length || 1));
  let cursor = 0;

  await Promise.all(Array.from({ length: workers }, async () => {
    while (cursor < targets.length) {
      const current = cursor;
      cursor += 1;
      const [agentName, connection] = targets[current];
      entries[current] = await sampleAgentState(agentName, connection, config, clock);
    }
  }));

  return Object.fromEntries(entries.filter((entry) => Array.isArray(entry) && entry[1] !== null));
}

export function selectAgentConnectionsForPolling(agentConnections, {
  now = Date.now(),
  staleAfterMs = DEFAULT_AGENT_TELEMETRY_CONFIG.heartbeatMs * 2,
} = {}) {
  const cutoff = Math.max(MIN_INTERVAL_MS, Number(staleAfterMs) || 0);
  return Object.fromEntries(Object.entries(agentConnections || {}).filter(([, connection]) => (
    connection?.in_game
    && (
      !Number.isFinite(connection.lastStatePushAt)
      || now - connection.lastStatePushAt >= cutoff
    )
  )));
}

export function fingerprintAgentStates(states) {
  return JSON.stringify(states, (key, value) => (
    [
      'timeOfDay',
      'sampledAt',
      'ageMs',
      'receivedAt',
      'nextRetryAt',
    ].includes(key) ? undefined : value
  ));
}

export function createAgentStatePump({
  collect,
  publish,
  shouldContinue,
  onError = () => {},
  intervalMs = DEFAULT_AGENT_TELEMETRY_CONFIG.intervalMs,
} = {}) {
  if (
    typeof collect !== 'function'
    || typeof publish !== 'function'
    || typeof shouldContinue !== 'function'
    || typeof onError !== 'function'
  ) {
    throw new TypeError('State pump requires collect, publish, shouldContinue, and onError functions.');
  }

  const cycleIntervalMs = boundedInteger(
    intervalMs,
    DEFAULT_AGENT_TELEMETRY_CONFIG.intervalMs,
    1,
    MAX_INTERVAL_MS,
  );
  let stopped = true;
  let running = false;
  let timer = null;
  let cycles = 0;
  let publishedCycles = 0;
  let failedCycles = 0;
  let lastCycleStartedAt = null;
  let lastCycleCompletedAt = null;
  let lastCycleDurationMs = null;
  let lastError = null;
  const idleWaiters = new Set();

  const notifyIdle = () => {
    if (!stopped || running || timer) return;
    for (const resolve of idleWaiters) resolve();
    idleWaiters.clear();
  };

  const reportError = (error) => {
    failedCycles += 1;
    lastError = errorText(error);
    try {
      onError(error);
    } catch {
      // Telemetry error reporting must never break scheduling or shutdown.
    }
  };

  const canContinue = () => {
    try {
      return shouldContinue() === true;
    } catch (error) {
      reportError(error);
      return false;
    }
  };

  const cycle = async () => {
    timer = null;
    if (stopped || running) return;
    if (!canContinue()) {
      stopped = true;
      notifyIdle();
      return;
    }

    running = true;
    cycles += 1;
    lastCycleStartedAt = Date.now();
    try {
      const states = await collect();
      await publish(states);
      publishedCycles += 1;
      lastError = null;
    } catch (error) {
      reportError(error);
    } finally {
      lastCycleCompletedAt = Date.now();
      lastCycleDurationMs = Math.max(0, lastCycleCompletedAt - lastCycleStartedAt);
      running = false;
      if (!stopped && canContinue()) {
        timer = setTimeout(() => {
          void cycle();
        }, cycleIntervalMs);
      } else {
        stopped = true;
        notifyIdle();
      }
    }
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      if (!running && !timer) void cycle();
    },
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      notifyIdle();
    },
    waitForIdle() {
      if (stopped && !running && !timer) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.add(resolve));
    },
    getStatus() {
      return {
        state: running ? 'sampling' : stopped ? 'stopped' : timer ? 'waiting' : 'idle',
        intervalMs: cycleIntervalMs,
        cycles,
        publishedCycles,
        failedCycles,
        lastCycleStartedAt,
        lastCycleCompletedAt,
        lastCycleDurationMs,
        lastError,
      };
    },
    get running() {
      return running;
    },
  };
}
