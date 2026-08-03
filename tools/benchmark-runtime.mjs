import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { io } from 'socket.io-client';

import { getCommandDocs } from '../src/agent/commands/index.js';
import {
  clearSurvivalSituationCache,
  summarizeSurvivalSituation,
} from '../src/agent/runtime/survival-director.js';

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function round(value, places = 2) {
  return Number(Number(value || 0).toFixed(places));
}

function parseArgs(argv) {
  const options = {
    assert: false,
    samples: 20,
    url: '',
  };
  for (const arg of argv) {
    if (arg === '--assert') options.assert = true;
    else if (arg.startsWith('--samples=')) options.samples = Math.max(3, Math.min(200, Number(arg.slice(10)) || 20));
    else if (arg.startsWith('--url=')) options.url = arg.slice(6).replace(/\/$/, '');
  }
  return options;
}

// A survival policy that can actually reach bed and shelter candidates. The
// scans are gated on the policy being able to read them, so a fixture without
// one measures the gate rather than the cache.
const FULL_SURVIVAL_POLICY = Object.freeze({
  mode: 'full',
  sleep: 'safe',
  shelter: 'emergency',
  usefulDrops: 'collect',
});

function createSurvivalFixture({ night = false, policy = null } = {}) {
  let findBlocksCalls = 0;
  const origin = {
    x: 0,
    y: 64,
    z: 0,
    distanceTo(other) {
      return Math.hypot(other.x, other.y - 64, other.z);
    },
  };
  const entities = {};
  for (let index = 0; index < 800; index += 1) {
    entities[index] = {
      id: index,
      name: index % 40 === 0 ? 'item' : 'zombie',
      position: {
        x: (index % 64) - 32,
        y: 64,
        z: (index % 47) - 23,
        distanceTo(other) {
          return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z);
        },
      },
      getDroppedItem: () => ({ name: 'cobblestone', count: 1 }),
    };
  }
  const bot = {
    entity: { position: origin },
    entities,
    health: 20,
    food: 20,
    lastDamageTime: 0,
    inventory: {
      slots: Array(46).fill(null),
      items: () => [],
    },
    registry: { foodsByName: {} },
    modes: { getStatus: () => [] },
    time: { timeOfDay: night ? 18000 : 6000 },
    game: { dimension: 'minecraft:overworld' },
    rainState: 0,
    thunderState: 0,
    findBlocks() {
      findBlocksCalls += 1;
      // Approximate loaded-world filtering work without relying on a live bot.
      let checksum = 0;
      for (let index = 0; index < 4096; index += 1) checksum ^= index;
      return checksum === -1 ? [origin] : [];
    },
    blockAt(position) {
      return position.y < 64
        ? { name: 'stone', boundingBox: 'block', position }
        : { name: 'air', boundingBox: 'empty', position };
    },
    nearestEntity: () => null,
  };
  return {
    agent: {
      bot,
      isOperatorHeld: () => false,
      isIdle: () => true,
      ...(policy ? { runtime: { survival: policy } } : {}),
    },
    bot,
    calls: () => findBlocksCalls,
  };
}

function runSurvivalBenchmark({ iterations = 120, cached, scenario = {} }) {
  const fixture = createSurvivalFixture(scenario);
  const durations = [];
  for (let index = 0; index < iterations; index += 1) {
    if (!cached) clearSurvivalSituationCache(fixture.bot);
    const started = performance.now();
    summarizeSurvivalSituation(fixture.agent, { now: index * 300 });
    durations.push(performance.now() - started);
  }
  return {
    iterations,
    findBlocksCalls: fixture.calls(),
    totalMs: round(durations.reduce((sum, value) => sum + value, 0)),
    p50Ms: round(percentile(durations, 0.5), 3),
    p95Ms: round(percentile(durations, 0.95), 3),
  };
}

// The wire carries three shapes: the v2 `snapshot` envelope, the v2 `delta`
// envelope on its own socket event, and the pre-v2 bare state map. Reading only
// the bare map made `Object.values` walk the envelope's own fields, so a busy
// server reported zero delivery samples.
function extractSampledStates(payload) {
  if (!payload || typeof payload !== 'object') return [];
  if (payload.type === 'snapshot' && payload.states && typeof payload.states === 'object') {
    return Object.values(payload.states);
  }
  if (payload.type === 'delta' && payload.changes && typeof payload.changes === 'object') {
    return Object.values(payload.changes)
      .map(change => change?.set)
      .filter(set => set && typeof set === 'object');
  }
  if (payload.version || payload.type) return [];
  return Object.values(payload);
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeLiveStates(states, payload) {
  if (!isRecord(payload)) return;
  if (payload.type === 'snapshot') {
    states.clear();
    if (!isRecord(payload.states)) return;
    for (const [agentName, state] of Object.entries(payload.states)) {
      if (isRecord(state)) states.set(agentName, state);
    }
    return;
  }
  if (payload.type === 'delta') {
    if (!isRecord(payload.changes)) return;
    for (const [agentName, change] of Object.entries(payload.changes)) {
      if (!isRecord(change)) continue;
      const prior = isRecord(states.get(agentName)) ? states.get(agentName) : {};
      const next = { ...prior, ...(isRecord(change.set) ? change.set : {}) };
      for (const key of Array.isArray(change.unset) ? change.unset : []) {
        if (typeof key === 'string') delete next[key];
      }
      states.set(agentName, next);
    }
    return;
  }
  if (payload.version || payload.type) return;
  states.clear();
  for (const [agentName, state] of Object.entries(payload)) {
    if (isRecord(state)) states.set(agentName, state);
  }
}

function readNearestRankSummary(value) {
  if (!isRecord(value)) return null;
  const { samples, retentionLimit, p50, p95, p99, max } = value;
  if (
    !Number.isSafeInteger(samples)
    || samples < 0
    || !Number.isSafeInteger(retentionLimit)
    || retentionLimit < 1
    || samples > retentionLimit
  ) return null;
  const values = [p50, p95, p99, max];
  if (samples === 0) {
    if (!values.every(item => item === null)) return null;
  } else {
    if (!values.every(item => Number.isFinite(item) && item >= 0)) return null;
    if (!(p50 <= p95 && p95 <= p99 && p99 <= max)) return null;
  }
  return { samples, retentionLimit, p50, p95, p99, max };
}

function hotPathDiagnosticSummary(agentName, state) {
  const invalid = field => ({
    agent: agentName,
    valid: false,
    error: `missing_or_malformed:${field}`,
  });
  const decisionTrace = state?.action?.behaviorArbiter?.decisionTrace;
  if (
    !isRecord(decisionTrace)
    || decisionTrace.schemaVersion !== 1
    || !Number.isSafeInteger(decisionTrace.retained)
    || decisionTrace.retained < 0
    || !Number.isSafeInteger(decisionTrace.retentionLimit)
    || decisionTrace.retentionLimit < 1
    || decisionTrace.retained > decisionTrace.retentionLimit
  ) return invalid('decisionTrace');
  const diagnostics = decisionTrace.diagnostics;
  if (!isRecord(diagnostics) || !isRecord(diagnostics.timing)) {
    return invalid('diagnostics');
  }
  const evaluationMs = readNearestRankSummary(diagnostics.timing.evaluationMs);
  const cleanupMs = readNearestRankSummary(diagnostics.timing.cleanupMs);
  const totalMs = readNearestRankSummary(diagnostics.timing.totalMs);
  const scheduledLoopDelayMs = readNearestRankSummary(diagnostics.scheduledLoopDelayMs);
  if (!evaluationMs) return invalid('timing.evaluationMs');
  if (!cleanupMs) return invalid('timing.cleanupMs');
  if (!totalMs) return invalid('timing.totalMs');
  if (!scheduledLoopDelayMs) return invalid('scheduledLoopDelayMs');
  if (
    evaluationMs.samples !== decisionTrace.retained
    || evaluationMs.samples !== cleanupMs.samples
    || cleanupMs.samples !== totalMs.samples
    || evaluationMs.retentionLimit !== decisionTrace.retentionLimit
    || cleanupMs.retentionLimit !== decisionTrace.retentionLimit
    || totalMs.retentionLimit !== decisionTrace.retentionLimit
    || scheduledLoopDelayMs.retentionLimit !== decisionTrace.retentionLimit
  ) return invalid('timing.consistency');

  const actionLifecycles = diagnostics.actionLifecycles;
  const actionDurationMs = readNearestRankSummary(actionLifecycles?.durationMs);
  if (
    !isRecord(actionLifecycles)
    || !Number.isSafeInteger(actionLifecycles.retained)
    || actionLifecycles.retained < 0
    || !Number.isSafeInteger(actionLifecycles.retentionLimit)
    || actionLifecycles.retentionLimit < 1
    || actionLifecycles.retained > actionLifecycles.retentionLimit
    || !actionDurationMs
    || actionDurationMs.retentionLimit !== actionLifecycles.retentionLimit
    || actionDurationMs.samples > actionLifecycles.retained
  ) return invalid('actionLifecycles');

  return {
    agent: agentName,
    valid: true,
    timing: { evaluationMs, cleanupMs, totalMs },
    scheduledLoopDelayMs,
    actionLifecycles: {
      retained: actionLifecycles.retained,
      retentionLimit: actionLifecycles.retentionLimit,
      durationMs: actionDurationMs,
    },
  };
}

async function runLiveBenchmark(options) {
  if (!options.url) return null;
  const socket = io(options.url, { transports: ['websocket'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Live telemetry socket timed out.')), 5_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });
  const stateDeliveries = [];
  const stateIntervals = [];
  const liveStates = new Map();
  const liveBotNames = new Set();
  let previousStateAt = null;
  const recordStatePayload = (payload) => {
    const receivedAt = Date.now();
    if (previousStateAt !== null) stateIntervals.push(receivedAt - previousStateAt);
    previousStateAt = receivedAt;
    mergeLiveStates(liveStates, payload);
    for (const state of extractSampledStates(payload)) {
      const sampledAt = Number(state?._meta?.sampledAt);
      if (Number.isFinite(sampledAt)) stateDeliveries.push(Math.max(0, receivedAt - sampledAt));
    }
  };
  socket.on('state-update', recordStatePayload);
  // Movement publishes deltas on a separate event; counting only snapshots
  // undercounts exactly the traffic that matters while the bot is active.
  socket.on('state-delta', recordStatePayload);
  socket.emit('listen-to-agents');
  await delay(1_250);
  const durations = [];
  const payloadBytes = [];
  let liveBots = 0;
  try {
    for (let index = 0; index < options.samples; index += 1) {
      const started = performance.now();
      const response = await fetch(`${options.url}/api/agent-telemetry`, {
        headers: { accept: 'application/json' },
      });
      const body = await response.text();
      durations.push(performance.now() - started);
      payloadBytes.push(Buffer.byteLength(body));
      if (!response.ok) throw new Error(`Live telemetry returned HTTP ${response.status}.`);
      const parsed = JSON.parse(body);
      const states = parsed?.latest || parsed?.states || parsed?.agents || {};
      const names = Object.keys(isRecord(states) ? states : {});
      for (const name of names) liveBotNames.add(name);
      liveBots = Math.max(liveBots, names.length);
    }
    if (liveBots > 0) {
      const deadline = Date.now() + 3_500;
      const diagnosticsReady = () => [...liveBotNames].every(agentName => (
        hotPathDiagnosticSummary(agentName, liveStates.get(agentName)).valid
      ));
      while (
        (stateDeliveries.length < 3 || !diagnosticsReady())
        && Date.now() < deadline
      ) await delay(100);
    }
  } finally {
    socket.close();
  }
  const hotPathDiagnostics = [...liveBotNames]
    .sort()
    .map(agentName => hotPathDiagnosticSummary(agentName, liveStates.get(agentName)));
  return {
    url: options.url,
    samples: options.samples,
    liveBots,
    hotPathDiagnostics,
    responseP50Ms: round(percentile(durations, 0.5)),
    responseP95Ms: round(percentile(durations, 0.95)),
    payloadP50Bytes: Math.round(percentile(payloadBytes, 0.5)),
    statePushSamples: stateDeliveries.length,
    stateDeliveryP50Ms: round(percentile(stateDeliveries, 0.5)),
    stateDeliveryP95Ms: round(percentile(stateDeliveries, 0.95)),
    stateIntervalP50Ms: round(percentile(stateIntervals, 0.5)),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const fakeAgent = { blocked_actions: [] };
  const fullDocs = getCommandDocs(fakeAgent);
  const compactDocs = getCommandDocs(fakeAgent, { compact: true });
  // The autonomy prompt is the one rebuilt before every action, so it is the
  // number that actually tracks how fast self-directed play feels.
  const autonomyDocs = getCommandDocs(fakeAgent, { compact: true, purpose: 'autonomy' });
  const promptReduction = 1 - (compactDocs.length / fullDocs.length);
  const autonomyReduction = 1 - (autonomyDocs.length / compactDocs.length);
  // Night with a full policy is the case where the policy can actually consult
  // beds and shelters, so it is the case where the cache is what saves work.
  const scanScenario = { night: true, policy: FULL_SURVIVAL_POLICY };
  const uncached = runSurvivalBenchmark({ cached: false, scenario: scanScenario });
  const cached = runSurvivalBenchmark({ cached: true, scenario: scanScenario });
  const scanReduction = uncached.findBlocksCalls > 0
    ? 1 - (cached.findBlocksCalls / uncached.findBlocksCalls)
    : 0;
  // Daylight, full health, clear weather: nothing downstream can read a bed or
  // shelter candidate, so the sweeps should not run at all.
  const gated = runSurvivalBenchmark({
    cached: false,
    scenario: { night: false, policy: FULL_SURVIVAL_POLICY },
  });
  const live = await runLiveBenchmark(options);

  const report = {
    commandPrompt: {
      fullCharacters: fullDocs.length,
      compactCharacters: compactDocs.length,
      fullEstimatedTokens: Math.ceil(fullDocs.length / 4),
      compactEstimatedTokens: Math.ceil(compactDocs.length / 4),
      reductionPercent: round(promptReduction * 100),
      autonomyCharacters: autonomyDocs.length,
      autonomyEstimatedTokens: Math.ceil(autonomyDocs.length / 4),
      autonomyReductionPercent: round(autonomyReduction * 100),
    },
    survivalHotPath: {
      uncached,
      cached,
      scanReductionPercent: round(scanReduction * 100),
      gatedOutOfSeason: gated,
    },
    live,
  };

  console.log(JSON.stringify(report, null, 2));

  if (options.assert) {
    if (promptReduction < 0.3) throw new Error('Compact command prompt reduction fell below 30%.');
    // Guarded so a zero-scan fixture reports a failure instead of dividing by
    // zero and sliding past the threshold as NaN.
    if (uncached.findBlocksCalls === 0) throw new Error('Survival scan benchmark performed no scans; the fixture no longer reaches the scanned path.');
    if (scanReduction < 0.6) throw new Error('Survival environment scan reduction fell below 60%.');
    if (gated.findBlocksCalls !== 0) throw new Error(`Survival scans ran ${gated.findBlocksCalls} times with no policy able to read the result.`);
    // A0 fails closed on diagnostic shape only. Latency gates wait for a
    // frozen baseline instead of turning an arbitrary first sample into policy.
    if (live?.liveBots > 0) {
      const diagnostics = Array.isArray(live.hotPathDiagnostics) ? live.hotPathDiagnostics : [];
      const failures = diagnostics
        .filter(item => item?.valid !== true)
        .map(item => `${item?.agent || 'unknown'} (${item?.error || 'invalid'})`);
      if (diagnostics.length < live.liveBots) {
        failures.push(`reported ${diagnostics.length} diagnostic surfaces for ${live.liveBots} live bots`);
      }
      if (failures.length > 0) {
        throw new Error(`Live hot-path diagnostics are missing or malformed: ${failures.join(', ')}.`);
      }
    }
  }
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
