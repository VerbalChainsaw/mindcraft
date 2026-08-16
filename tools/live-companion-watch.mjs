#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { io } from 'socket.io-client';

import { applyStateUpdate } from '../src/mindcraft/public/js/agent-state-protocol.js';
import { resolveMindserverUrl } from './mindserver-url.mjs';

const DEFAULT_REQUEST = 'Help me establish this landing area. Don\'t damage what I\'ve already built. Gather a sensible starter supply, make whatever basic tools you need, and return here when you\'re finished.';

function usage() {
  return `Usage: npm run playtest:watch -- [options]

Read-only live companion observer. It never sends a bot command.

Options:
  --bot <name>               Managed bot name (default: IronSuiteProof)
  --player <name>            Human player to follow (default: phixxation)
  --url <url>                MindServer URL (default: derived from launcher-config.json)
  --request <text>           Graduation request recorded with this session
  --site <x,y,z>             Fixed landing-area anchor; otherwise lock player position
  --site-radius <blocks>     Informational site radius (default: 12)
  --stall-seconds <seconds>  Busy no-progress warning threshold (default: 6)
  --duration-minutes <mins>  Stop observer after a fixed duration (default: unlimited)
  --output <directory>       Session output directory (default: /tmp)
  --help                     Show this help
`;
}

function boundedNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function parseSite(value) {
  if (!value) return null;
  const parts = String(value).split(',').map(Number);
  if (parts.length !== 3 || parts.some(part => !Number.isFinite(part))) {
    throw new TypeError('--site must be x,y,z with three finite numbers.');
  }
  return { x: parts[0], y: parts[1], z: parts[2] };
}

function parseArgs(argv) {
  const options = {
    bot: 'IronSuiteProof',
    player: 'phixxation',
    url: '',
    request: DEFAULT_REQUEST,
    site: null,
    siteRadius: 12,
    stallMs: 6_000,
    durationMs: 0,
    output: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') return { ...options, help: true };
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new TypeError(`${argument} requires a value.`);
    if (argument === '--bot') options.bot = value;
    else if (argument === '--player') options.player = value;
    else if (argument === '--url') options.url = value.replace(/\/$/, '');
    else if (argument === '--request') options.request = value;
    else if (argument === '--site') options.site = parseSite(value);
    else if (argument === '--site-radius') options.siteRadius = boundedNumber(value, 2, 64, 12);
    else if (argument === '--stall-seconds') options.stallMs = boundedNumber(value, 3, 60, 6) * 1_000;
    else if (argument === '--duration-minutes') options.durationMs = boundedNumber(value, 0, 720, 0) * 60_000;
    else if (argument === '--output') options.output = path.resolve(value);
    else throw new TypeError(`Unknown option: ${argument}`);
    index += 1;
  }
  if (!/^[A-Za-z0-9_]{1,16}$/.test(options.player)) {
    throw new TypeError('--player must be a valid Minecraft username.');
  }
  if (!/^[A-Za-z0-9_. -]{1,64}$/.test(options.bot)) {
    throw new TypeError('--bot contains unsupported characters.');
  }
  options.url = resolveMindserverUrl({ explicitUrl: options.url });
  return options;
}

function safeTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function finitePosition(value) {
  if (![value?.x, value?.y, value?.z].every(Number.isFinite)) return null;
  return { x: Number(value.x), y: Number(value.y), z: Number(value.z) };
}

function distance(left, right) {
  if (!left || !right) return null;
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function roundedPosition(value) {
  const position = finitePosition(value);
  if (!position) return null;
  return Object.fromEntries(Object.entries(position).map(([key, number]) => [key, Number(number.toFixed(2))]));
}

function stableCounts(value) {
  return Object.fromEntries(Object.entries(value || {})
    .filter(([, count]) => Number(count) !== 0)
    .map(([name, count]) => [name, Number(count) || 0])
    .sort(([left], [right]) => left.localeCompare(right)));
}

function countsFingerprint(value) {
  return JSON.stringify(stableCounts(value));
}

function countDelta(before, after) {
  const changes = [];
  const names = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const name of [...names].sort()) {
    const delta = (Number(after?.[name]) || 0) - (Number(before?.[name]) || 0);
    if (delta !== 0) changes.push(`${delta > 0 ? '+' : ''}${delta} ${name}`);
  }
  return changes;
}

function compactResult(result) {
  if (!result) return null;
  return {
    actionId: result.actionId || null,
    phase: result.phase || null,
    code: result.code || null,
    label: result.label || null,
    detail: String(result.detail || '').slice(0, 300),
    target: result.target || null,
    retryable: result.retryable === true,
    durationMs: Number(result.durationMs) || 0,
  };
}

function compactGoal(goalDirector) {
  const goal = goalDirector?.goal;
  return {
    phase: goalDirector?.phase || null,
    code: goalDirector?.code || null,
    id: goal?.id || null,
    kind: goal?.kind || null,
    target: goal?.target?.family || goal?.target?.canonicalName || goal?.target?.requestedName || null,
    goalPhase: goal?.phase || null,
    attempts: Number(goal?.attempts) || 0,
    maxAttempts: Number(goal?.maxAttempts) || 0,
    checkpoint: goal?.checkpoint || null,
  };
}

function compactJob(jobDirector) {
  const job = jobDirector?.workOrder;
  return {
    phase: jobDirector?.phase || null,
    code: jobDirector?.code || null,
    id: job?.id || null,
    role: job?.role || null,
    kind: job?.kind || null,
    target: job?.target || null,
    jobPhase: job?.phase || null,
    attempts: Number(job?.attempts) || 0,
    maxAttempts: Number(job?.maxAttempts) || 0,
    checkpoint: job?.checkpoint || null,
  };
}

function compactState(state, siteAnchor) {
  const botPosition = finitePosition(state?.gameplay?.position);
  const playerPosition = finitePosition(state?.companion?.position);
  return {
    observedAt: new Date().toISOString(),
    gameplay: {
      position: roundedPosition(botPosition),
      dimension: state?.gameplay?.dimension || null,
      health: Number(state?.gameplay?.health) || 0,
      hunger: Number(state?.gameplay?.hunger) || 0,
      biome: state?.gameplay?.biome || null,
      weather: state?.gameplay?.weather || null,
      timeLabel: state?.gameplay?.timeLabel || null,
    },
    action: {
      current: state?.action?.current || null,
      kind: state?.action?.kind || null,
      isIdle: state?.action?.isIdle === true,
      held: state?.action?.held === true,
      lastResult: compactResult(state?.action?.lastResult),
      arbiterLane: state?.action?.behaviorArbiter?.selectedLane || null,
      arbiterCode: state?.action?.behaviorArbiter?.code || null,
    },
    goal: compactGoal(state?.action?.goalDirector),
    job: compactJob(state?.action?.jobDirector),
    inventory: {
      counts: stableCounts(state?.inventory?.counts),
      equipment: state?.inventory?.equipment || null,
      stacksUsed: Number(state?.inventory?.stacksUsed) || 0,
    },
    companion: {
      player: state?.companion?.canonicalUsername || state?.companion?.requestedName || null,
      presence: state?.companion?.presence || null,
      position: roundedPosition(playerPosition),
      distance: playerPosition && botPosition ? Number(distance(playerPosition, botPosition).toFixed(2)) : null,
    },
    nearbyHumans: Array.isArray(state?.nearby?.humanPlayers) ? state.nearby.humanPlayers : [],
    site: {
      anchor: roundedPosition(siteAnchor),
      botDistance: siteAnchor && botPosition ? Number(distance(siteAnchor, botPosition).toFixed(2)) : null,
    },
  };
}

function directorIdentity(value) {
  return JSON.stringify([value?.phase, value?.code, value?.id, value?.goalPhase, value?.jobPhase, value?.attempts, value?.checkpoint]);
}

async function fetchJson(url, pathname, init) {
  const response = await fetch(new URL(pathname, `${url}/`), {
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : null;
}

async function queryPlayerPosition(options) {
  const command = `data get entity ${options.player} Pos`;
  await fetchJson(options.url, '/api/minecraft-server/command', {
    method: 'POST',
    body: JSON.stringify({ command }),
  });
  const deadline = Date.now() + 2_500;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 150));
    const payload = await fetchJson(options.url, '/api/minecraft-server?logs=1');
    const logs = payload?.server?.logs || [];
    const commandIndex = logs.map(String).findLastIndex(line => line.includes(`[command] > ${command}`));
    if (commandIndex < 0) continue;
    for (const line of logs.slice(commandIndex + 1, commandIndex + 5).map(String)) {
      if (/No entity was found/i.test(line)) return null;
      const match = /following entity data:\s*\[\s*(-?\d+(?:\.\d+)?)d,\s*(-?\d+(?:\.\d+)?)d,\s*(-?\d+(?:\.\d+)?)d\s*\]/i.exec(line);
      if (match) return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
    }
  }
  return null;
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  process.stdout.write(usage());
  process.exit(0);
}

const startedAt = Date.now();
const sessionId = `playtest-${safeTimestamp()}`;
const outputDir = options.output || path.join('/tmp', `mindcraft-${sessionId}`);
fs.mkdirSync(outputDir, { recursive: true });
const eventsPath = path.join(outputDir, 'events.jsonl');
const summaryPath = path.join(outputDir, 'summary.json');

let states = {};
let revisions = {};
let latest = null;
let previous = null;
let siteAnchor = options.site;
let lastPhysicalProgressAt = startedAt;
let lastProgressPosition = null;
let lastProgressInventory = '';
let lastActionIdentity = '';
let lastStallAlertAt = 0;
let lastFailureSignature = '';
let repeatedFailureCount = 0;
let anchorQueryPending = false;
let lastAnchorQueryAt = 0;
let viewerUrl = null;
let finished = false;
let stateCount = 0;
let resultCount = 0;
let alertCount = 0;
let socket;
let interval;
let durationTimer;

function append(type, detail = {}) {
  const record = { at: Date.now(), observedAt: new Date().toISOString(), type, ...detail };
  fs.appendFileSync(eventsPath, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

function announce(label, message) {
  process.stdout.write(`[${label}] ${message}\n`);
}

function alert(code, message, detail = {}) {
  alertCount += 1;
  append('alert', { code, message, ...detail });
  announce('WATCH', `${code}: ${message}`);
}

function inspectState(state) {
  const current = compactState(state, siteAnchor);
  latest = current;
  stateCount += 1;
  append('state', { state: current });

  const position = finitePosition(current.gameplay.position);
  const inventory = current.inventory.counts;
  const inventoryFingerprint = countsFingerprint(inventory);
  const actionIdentity = JSON.stringify([current.action.current, current.action.kind, current.action.arbiterLane]);
  const moved = distance(position, lastProgressPosition);
  const physicalChanged = (
    !lastProgressPosition
    || (Number.isFinite(moved) && moved >= 0.35)
    || inventoryFingerprint !== lastProgressInventory
    || current.action.lastResult?.actionId !== previous?.action?.lastResult?.actionId
  );
  if (physicalChanged || actionIdentity !== lastActionIdentity) {
    lastPhysicalProgressAt = Date.now();
    lastStallAlertAt = 0;
    if (position) lastProgressPosition = position;
    lastProgressInventory = inventoryFingerprint;
    lastActionIdentity = actionIdentity;
  }

  if (!previous || actionIdentity !== JSON.stringify([previous.action.current, previous.action.kind, previous.action.arbiterLane])) {
    announce('ACTION', `${current.action.kind || 'unknown'} | ${current.action.current || 'unnamed'} | lane ${current.action.arbiterLane || 'none'}`);
    append('action_changed', { action: current.action });
  }

  const inventoryChanges = previous ? countDelta(previous.inventory.counts, inventory) : [];
  if (inventoryChanges.length > 0) {
    announce('INVENTORY', inventoryChanges.join(', '));
    append('inventory_changed', { changes: inventoryChanges, counts: inventory });
  }

  if (previous && current.gameplay.health < previous.gameplay.health) {
    alert('health_drop', `${previous.gameplay.health} -> ${current.gameplay.health}`, { state: current });
  }

  const result = current.action.lastResult;
  if (result?.actionId && result.actionId !== previous?.action?.lastResult?.actionId) {
    resultCount += 1;
    announce('RESULT', `${result.phase}/${result.code} in ${result.durationMs}ms | ${result.detail}`);
    append('action_result', { result });
    const failureLike = result.phase === 'failed'
      || /(?:fail|blocked|not_found|unreachable|stalled|timeout|no_path)/i.test(String(result.code || ''));
    if (failureLike) {
      const signature = JSON.stringify([result.phase, result.code, result.target]);
      repeatedFailureCount = signature === lastFailureSignature ? repeatedFailureCount + 1 : 1;
      lastFailureSignature = signature;
      if (repeatedFailureCount >= 2) {
        alert('repeated_failure_signature', `${result.code} repeated ${repeatedFailureCount} times`, { result });
      }
    } else {
      repeatedFailureCount = 0;
      lastFailureSignature = '';
    }
  }

  if (!previous || directorIdentity(current.goal) !== directorIdentity(previous.goal)) {
    announce('GOAL', `${current.goal.phase || 'none'}/${current.goal.code || 'none'} | ${current.goal.kind || 'none'} ${current.goal.target || ''}`.trim());
    append('goal_changed', { goal: current.goal });
  }
  if (!previous || directorIdentity(current.job) !== directorIdentity(previous.job)) {
    announce('JOB', `${current.job.phase || 'none'}/${current.job.code || 'none'} | ${current.job.role || 'none'} ${current.job.kind || ''}`.trim());
    append('job_changed', { job: current.job });
  }

  if (!siteAnchor && current.companion.position) {
    siteAnchor = finitePosition(current.companion.position);
    current.site.anchor = roundedPosition(siteAnchor);
    current.site.botDistance = Number(distance(siteAnchor, position).toFixed(2));
    append('site_locked', { source: 'companion_state', position: roundedPosition(siteAnchor) });
    announce('SITE', `Locked landing-area anchor from player state at ${JSON.stringify(roundedPosition(siteAnchor))}`);
  }

  previous = current;
}

async function refreshViewer() {
  if (viewerUrl) return;
  try {
    const payload = await fetchJson(options.url, '/api/agents');
    const agent = payload?.agents?.find(candidate => candidate?.name === options.bot);
    if (!agent) return;
    if (agent.viewerAvailable === true && Number.isInteger(agent.viewerPort)) {
      viewerUrl = `${new URL(options.url).protocol}//${new URL(options.url).hostname}:${agent.viewerPort}`;
      append('viewer_ready', { viewerUrl });
      announce('VIEW', `Live first-person camera: ${viewerUrl}`);
    }
  } catch (error) {
    append('observer_warning', { code: 'viewer_probe_failed', detail: String(error?.message || error) });
  }
}

async function refreshSiteAnchor() {
  if (siteAnchor || anchorQueryPending || Date.now() - lastAnchorQueryAt < 5_000) return;
  anchorQueryPending = true;
  lastAnchorQueryAt = Date.now();
  try {
    const position = await queryPlayerPosition(options);
    if (!position) return;
    siteAnchor = position;
    append('site_locked', { source: 'paper_player_position', position: roundedPosition(position) });
    announce('SITE', `Locked landing-area anchor at ${JSON.stringify(roundedPosition(position))}`);
  } catch (error) {
    append('observer_warning', { code: 'site_probe_failed', detail: String(error?.message || error) });
  } finally {
    anchorQueryPending = false;
  }
}

function inspectResponsiveness() {
  if (!latest) return;
  const busy = latest.action.isIdle !== true
    && !['idle', 'stopped', 'thinking', 'chatting'].includes(String(latest.action.kind || ''));
  if (!busy) return;
  const silentMs = Date.now() - lastPhysicalProgressAt;
  if (silentMs < options.stallMs || Date.now() - lastStallAlertAt < options.stallMs) return;
  lastStallAlertAt = Date.now();
  alert(
    'no_verified_progress',
    `${latest.action.current || latest.action.kind} has shown no position, inventory, result, or strategy change for ${(silentMs / 1_000).toFixed(1)}s`,
    { silentMs, state: latest },
  );
}

async function finish(reason, exitCode = 0) {
  if (finished) return;
  finished = true;
  clearInterval(interval);
  clearTimeout(durationTimer);
  socket?.disconnect();
  const summary = {
    schemaVersion: 1,
    sessionId,
    reason,
    startedAt,
    finishedAt: Date.now(),
    durationMs: Date.now() - startedAt,
    bot: options.bot,
    player: options.player,
    request: options.request,
    siteAnchor: roundedPosition(siteAnchor),
    siteRadius: options.siteRadius,
    viewerUrl,
    stateCount,
    resultCount,
    alertCount,
    latest,
    eventsPath,
  };
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  announce('DONE', `${reason}; ${resultCount} results, ${alertCount} watch alerts. Summary: ${summaryPath}`);
  process.exitCode = exitCode;
}

fs.writeFileSync(eventsPath, '', 'utf8');
append('session_started', {
  sessionId,
  options: { ...options, output: outputDir },
  note: 'Observer only: no gameplay command is sent by this process.',
});
announce('SESSION', `${sessionId} watching ${options.bot} with player ${options.player}`);
announce('REQUEST', options.request);
announce('FILES', outputDir);
if (siteAnchor) announce('SITE', `Using supplied landing-area anchor ${JSON.stringify(roundedPosition(siteAnchor))}`);
else announce('SITE', `Stand at the landing-area center; the watcher will lock ${options.player}'s position when they join.`);

socket = io(options.url, {
  transports: ['websocket'],
  timeout: 5_000,
  reconnection: true,
  reconnectionDelay: 500,
  reconnectionDelayMax: 3_000,
});

function receive(payload) {
  const applied = applyStateUpdate(states, revisions, payload);
  states = applied.states;
  revisions = applied.revisions;
  if (applied.resyncRequired) socket.emit('request-agent-state-snapshot');
  const state = states[options.bot] || Object.values(states).find(value => value?.name === options.bot);
  if (state) inspectState(state);
}

socket.on('connect', () => {
  append('dashboard_connected');
  announce('DASHBOARD', 'Connected to live agent state.');
  socket.emit('listen-to-agents');
  socket.emit('request-agent-state-snapshot');
});
socket.on('disconnect', reason => append('dashboard_disconnected', { reason }));
socket.on('connect_error', error => append('observer_warning', { code: 'dashboard_connect_error', detail: String(error?.message || error) }));
socket.on('state-update', receive);
socket.on('state-delta', receive);

interval = setInterval(() => {
  inspectResponsiveness();
  void refreshViewer();
  void refreshSiteAnchor();
  socket.emit('request-agent-state-snapshot');
}, 1_000);
if (options.durationMs > 0) {
  durationTimer = setTimeout(() => void finish('duration elapsed'), options.durationMs);
}

process.on('SIGINT', () => void finish('observer interrupted'));
process.on('SIGTERM', () => void finish('observer terminated'));
process.on('uncaughtException', error => {
  append('observer_error', { detail: String(error?.stack || error) });
  void finish('observer error', 1);
});
process.on('unhandledRejection', error => {
  append('observer_error', { detail: String(error?.stack || error) });
  void finish('observer rejection', 1);
});

await refreshViewer();
await refreshSiteAnchor();
