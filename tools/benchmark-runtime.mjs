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

function createSurvivalFixture() {
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
    time: { timeOfDay: 6000 },
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
    },
    bot,
    calls: () => findBlocksCalls,
  };
}

function runSurvivalBenchmark({ iterations = 120, cached }) {
  const fixture = createSurvivalFixture();
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
  let previousStateAt = null;
  socket.on('state-update', (states) => {
    const receivedAt = Date.now();
    if (previousStateAt !== null) stateIntervals.push(receivedAt - previousStateAt);
    previousStateAt = receivedAt;
    for (const state of Object.values(states || {})) {
      const sampledAt = Number(state?._meta?.sampledAt);
      if (Number.isFinite(sampledAt)) stateDeliveries.push(Math.max(0, receivedAt - sampledAt));
    }
  });
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
      liveBots = Math.max(liveBots, Object.keys(states && typeof states === 'object' ? states : {}).length);
    }
    if (liveBots > 0 && stateDeliveries.length < 3) {
      const deadline = Date.now() + 3_500;
      while (stateDeliveries.length < 3 && Date.now() < deadline) await delay(100);
    }
  } finally {
    socket.close();
  }
  return {
    url: options.url,
    samples: options.samples,
    liveBots,
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
  const uncached = runSurvivalBenchmark({ cached: false });
  const cached = runSurvivalBenchmark({ cached: true });
  const scanReduction = 1 - (cached.findBlocksCalls / uncached.findBlocksCalls);
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
    },
    live,
  };

  console.log(JSON.stringify(report, null, 2));

  if (options.assert) {
    if (promptReduction < 0.3) throw new Error('Compact command prompt reduction fell below 30%.');
    if (scanReduction < 0.6) throw new Error('Survival environment scan reduction fell below 60%.');
  }
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
