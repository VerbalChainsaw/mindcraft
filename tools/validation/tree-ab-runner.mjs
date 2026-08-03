import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultRepo = fileURLToPath(new URL('../../', import.meta.url));
const repo = path.resolve(process.argv[2] || defaultRepo);
const outputFile = path.resolve(process.argv[3] || path.join(repo, 'validation-output', 'tree-ab-result.json'));
const baseUrl = process.argv[4] || 'http://localhost:8080';
const actionTimeoutMs = Math.max(1_000, Number(process.argv[5]) || 120_000);

const requireFromRepo = createRequire(path.join(repo, 'package.json'));
const { io } = requireFromRepo('socket.io-client');
const { applyStateUpdate } = await import(
  pathToFileURL(path.join(repo, 'src', 'mindcraft', 'public', 'js', 'agent-state-protocol.js')).href,
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => Date.now();
let states = {};
let revisions = {};
let latestStateAt = 0;
const outputs = [];
const socket = io(baseUrl, {
  transports: ['websocket'],
  timeout: 5000,
  reconnection: false,
});

function currentState() {
  return states.MindcraftBot
    || Object.values(states).find((value) => value?.name === 'MindcraftBot')
    || null;
}

function receive(payload) {
  const applied = applyStateUpdate(states, revisions, payload);
  states = applied.states;
  revisions = applied.revisions;
  latestStateAt = now();
  if (applied.resyncRequired) socket.emit('request-agent-state-snapshot');
}

socket.on('state-update', receive);
socket.on('state-delta', receive);
socket.on('bot-output', (agentName, message) => {
  if (agentName !== 'MindcraftBot') return;
  outputs.push({ at: now(), message: String(message ?? '') });
  if (outputs.length > 500) outputs.splice(0, outputs.length - 500);
});

async function waitFor(predicate, timeoutMs, description, intervalMs = 100) {
  const deadline = now() + timeoutMs;
  let lastError = null;
  while (now() < deadline) {
    try {
      const value = predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  const suffix = lastError ? ` Last predicate error: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for ${description}.${suffix}`);
}

async function postJson(endpoint, body = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
    if (!response.ok || payload?.success === false) {
      throw new Error(`${endpoint} failed (${response.status}): ${JSON.stringify(payload).slice(0, 1000)}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function serverCommands(commands, settleMs = 175) {
  return postJson('/api/minecraft-server/commands', { commands, settleMs }, 120000);
}

function logCount(state = currentState()) {
  const counts = state?.inventory?.counts || {};
  return Object.entries(counts).reduce(
    (total, [name, count]) => /_(?:log|stem)$/.test(name)
      ? total + Math.max(0, Number(count) || 0)
      : total,
    0,
  );
}

function position(state = currentState()) {
  const value = state?.gameplay?.position;
  return value && [value.x, value.y, value.z].every(Number.isFinite)
    ? { x: value.x, y: value.y, z: value.z }
    : null;
}

function distance(left, right) {
  if (!left || !right) return null;
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  const dz = right.z - left.z;
  return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
}

async function waitForIdle(timeoutMs = 30000) {
  return waitFor(() => {
    const state = currentState();
    if (!state) return null;
    return state.action?.isIdle === true || !state.action?.current ? state : null;
  }, timeoutMs, 'MindcraftBot to become idle');
}

const TEST = Object.freeze({
  botX: 1071.5,
  botY: 200,
  botZ: 1007.5,
  treeX: 1077,
  treeZ: 1007,
  trunkBottomY: 200,
  trunkTopY: 203,
  targetLogs: 4,
  range: 32,
});

async function resetArena(label) {
  await postJson('/api/director/command', { agent: 'MindcraftBot', message: '!stop' }, 30000).catch(() => null);
  await waitForIdle(15000);
  await sleep(300);
  await serverCommands([
    'difficulty peaceful',
    'weather clear',
    'time set day',
    'gamemode survival MindcraftBot',
    'clear MindcraftBot',
    'effect give MindcraftBot instant_health 1 10 true',
    'effect give MindcraftBot saturation 30 10 true',
    'effect give MindcraftBot resistance 30 10 true',
    'fill 1055 190 991 1087 210 1023 air',
    'fill 1055 199 991 1087 199 1023 bedrock',
    `setblock ${TEST.treeX} 199 ${TEST.treeZ} grass_block`,
    'fill 1075 202 1005 1079 205 1009 oak_leaves',
    `fill ${TEST.treeX} ${TEST.trunkBottomY} ${TEST.treeZ} ${TEST.treeX} ${TEST.trunkTopY} ${TEST.treeZ} oak_log`,
    `tp MindcraftBot ${TEST.botX} ${TEST.botY} ${TEST.botZ}`,
    'data merge entity MindcraftBot {FallDistance:0f}',
    'execute at MindcraftBot run kill @e[type=item,distance=..48]',
    'give MindcraftBot iron_axe 1',
  ]);
  await sleep(1400);
  socket.emit('request-agent-state-snapshot');
  const state = await waitFor(() => {
    const candidate = currentState();
    const pos = position(candidate);
    if (!candidate || !pos) return null;
    const nearStart = Math.abs(pos.x - TEST.botX) < 1.5
      && Math.abs(pos.y - TEST.botY) < 1.5
      && Math.abs(pos.z - TEST.botZ) < 1.5;
    const arenaSupport = candidate?.surroundings?.below === 'bedrock';
    return nearStart && arenaSupport && logCount(candidate) === 0 ? candidate : null;
  }, 15000, `${label} arena reset`);
  await waitForIdle(15000);
  return state;
}

async function runArm({ id, kind, command, expectedLabel }) {
  const before = await resetArena(id);
  const beforePosition = position(before);
  const previousActionId = before?.action?.lastResult?.actionId || null;
  const outputStart = outputs.length;
  const commandStartedAt = now();
  const accepted = await postJson('/api/director/command', {
    agent: 'MindcraftBot',
    message: command,
  }, 30000);

  const terminal = await waitFor(() => {
    const state = currentState();
    const result = state?.action?.lastResult;
    if (!result || result.label !== expectedLabel) return null;
    if (previousActionId && result.actionId === previousActionId) return null;
    const startedAt = Number(result.startedAt) || 0;
    const finishedAt = Number(result.finishedAt) || 0;
    if (startedAt && startedAt < commandStartedAt - 500) return null;
    if (finishedAt && finishedAt < commandStartedAt) return null;
    if (!['succeeded', 'failed', 'cancelled'].includes(result.phase)) return null;
    return { state, result };
  }, actionTimeoutMs, `${id} terminal action result`, 150);

  await sleep(900);
  socket.emit('request-agent-state-snapshot');
  await sleep(500);
  const finalState = currentState() || terminal.state;
  const messages = outputs.slice(outputStart).map((entry) => entry.message);
  const finishedAt = Number(terminal.result.finishedAt) || now();
  const durationMs = Math.max(0, finishedAt - commandStartedAt);
  const detail = String(terminal.result.detail || '');
  const joined = `${detail}\n${messages.join('\n')}`;
  const logs = logCount(finalState);
  const endPosition = position(finalState);

  return {
    id,
    kind,
    command,
    accepted,
    commandStartedAt,
    durationMs,
    logs,
    targetLogs: TEST.targetLogs,
    success: terminal.result.phase === 'succeeded' && logs >= TEST.targetLogs,
    phase: terminal.result.phase,
    code: terminal.result.code || null,
    detail,
    startPosition: beforePosition,
    endPosition,
    displacementBlocks: distance(beforePosition, endPosition),
    connectedTreeSignal: /Felling one connected/i.test(joined),
    completeTreeSignal: /complete tree/i.test(joined),
    outputs: messages.slice(-40),
    lastResult: terminal.result,
    stateFreshnessMs: Math.max(0, now() - latestStateAt),
  };
}

function median(values) {
  const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!ordered.length) return null;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function summarize(runs, kind) {
  const selected = runs.filter((run) => run.kind === kind);
  const durations = selected.map((run) => run.durationMs);
  return {
    kind,
    runs: selected.length,
    successes: selected.filter((run) => run.success).length,
    medianDurationMs: median(durations),
    minDurationMs: durations.length ? Math.min(...durations) : null,
    maxDurationMs: durations.length ? Math.max(...durations) : null,
    medianLogs: median(selected.map((run) => run.logs)),
    connectedTreeSignalRuns: selected.filter((run) => run.connectedTreeSignal).length,
    completeTreeSignalRuns: selected.filter((run) => run.completeTreeSignal).length,
  };
}

let hardTimer;
try {
  await new Promise((resolve, reject) => {
    hardTimer = setTimeout(() => reject(new Error('Socket connection timed out.')), 10000);
    socket.once('connect', () => {
      clearTimeout(hardTimer);
      socket.emit('listen-to-agents');
      socket.emit('request-agent-state-snapshot');
      resolve();
    });
    socket.once('connect_error', reject);
  });
  await waitFor(() => currentState(), 15000, 'initial MindcraftBot state');
  for (const mode of ['self_preservation', 'unstuck', 'elbow_room']) {
    await postJson('/api/director/command', {
      agent: 'MindcraftBot',
      message: `!setMode("${mode}", false)`,
    }, 30000);
  }
  await postJson('/api/director/command', { agent: 'MindcraftBot', message: '!stop' }, 30000);
  await waitForIdle(15000);

  const plans = [
    {
      id: 'pair-1-new-connected-tree',
      kind: 'new-connected-tree',
      command: `!collectWoodInRange(${TEST.targetLogs}, ${TEST.range})`,
      expectedLabel: 'action:collectWoodInRange',
    },
    {
      id: 'pair-1-old-per-log',
      kind: 'old-per-log',
      command: `!collectBlocksInRange("oak_log", ${TEST.targetLogs}, ${TEST.range})`,
      expectedLabel: 'action:collectBlocksInRange',
    },
    {
      id: 'pair-2-old-per-log',
      kind: 'old-per-log',
      command: `!collectBlocksInRange("oak_log", ${TEST.targetLogs}, ${TEST.range})`,
      expectedLabel: 'action:collectBlocksInRange',
    },
    {
      id: 'pair-2-new-connected-tree',
      kind: 'new-connected-tree',
      command: `!collectWoodInRange(${TEST.targetLogs}, ${TEST.range})`,
      expectedLabel: 'action:collectWoodInRange',
    },
  ];

  const runs = [];
  for (const plan of plans) {
    process.stdout.write(`RUN ${plan.id}\n`);
    runs.push(await runArm(plan));
    process.stdout.write(`${JSON.stringify(runs.at(-1))}\n`);
  }

  const connected = summarize(runs, 'new-connected-tree');
  const old = summarize(runs, 'old-per-log');
  const speedup = connected.medianDurationMs > 0 && old.medianDurationMs > 0
    ? old.medianDurationMs / connected.medianDurationMs
    : null;
  const verdict = connected.successes === connected.runs
    && connected.connectedTreeSignalRuns === connected.runs
    && speedup !== null
    && speedup >= 1.15
    ? 'new-method-wins'
    : connected.successes === connected.runs && old.successes < old.runs
      ? 'new-method-more-reliable'
      : connected.successes < connected.runs
        ? 'new-method-not-viable'
        : 'no-material-win';

  const report = {
    schemaVersion: 'minecraft-tree-ab.v1',
    generatedAt: new Date().toISOString(),
    repo,
    baseUrl,
    test: TEST,
    sequence: plans.map((plan) => plan.id),
    runs,
    summary: {
      connectedTree: connected,
      oldPerLog: old,
      speedup,
      verdict,
      materiallyFasterThreshold: 1.15,
    },
  };
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`FINAL ${JSON.stringify(report.summary)}\n`);
  process.exitCode = verdict === 'new-method-not-viable' ? 4 : 0;
} finally {
  clearTimeout(hardTimer);
  socket.disconnect();
}
