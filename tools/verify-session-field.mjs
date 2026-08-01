import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

import { io } from 'socket.io-client';

import { applyStateUpdate } from '../src/mindcraft/public/js/agent-state-protocol.js';

const FIXTURE = Object.freeze({ x: 1071.5, y: 100, z: 1007.5 });
const CLEANUP_REGION = Object.freeze({ x: 1055, y: 90, z: 990, dx: 40, dy: 30, dz: 40 });
const FIXTURE_BLOCKS = Object.freeze([
  { x: 1072, y: 100, z: 1006, name: 'cobblestone' },
  { x: 1072, y: 100, z: 1007, name: 'cobblestone' },
  { x: 1072, y: 100, z: 1008, name: 'cobblestone' },
  { x: 1070, y: 101, z: 1006, name: 'cobblestone' },
  { x: 1070, y: 101, z: 1007, name: 'cobblestone' },
  { x: 1070, y: 101, z: 1008, name: 'cobblestone' },
  { x: 1071, y: 101, z: 1008, name: 'cobblestone' },
  { x: 1070, y: 100, z: 1006, name: 'air' },
]);
const FIXTURE_INVENTORY = Object.freeze({ cobblestone: 0, oak_planks: 1 });
const HOSTILE_TYPES = Object.freeze([
  'zombie',
  'skeleton',
  'creeper',
  'phantom',
  'spider',
  'cave_spider',
  'drowned',
  'husk',
  'stray',
  'bogged',
  'witch',
  'pillager',
  'vindicator',
  'evoker',
  'ravager',
  'slime',
]);
const OBJECTIVE = 'sesfieldproof';
const RELEASE_COMMAND = '!setAutonomy("command")';
const SAMPLE_MS = 1_000;
const SERVICE_POLL_MS = 5_000;
const STATE_STALE_MS = 15_000;
const THRASH_WINDOW_MS = 15_000;
const THRASH_ACTION_COUNT = 5;

function parseArgs(argv) {
  const options = {
    url: '',
    bot: 'MindcraftBot',
    attempts: 2,
    startIndex: 2,
    durationMs: 600_000,
    evidence: '',
    authorized: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--url') options.url = String(argv[++index] || '');
    else if (value === '--bot') options.bot = String(argv[++index] || '');
    else if (value === '--attempts') options.attempts = Number(argv[++index]);
    else if (value === '--start-index') options.startIndex = Number(argv[++index]);
    else if (value === '--duration-ms') options.durationMs = Number(argv[++index]);
    else if (value === '--evidence') options.evidence = String(argv[++index] || '');
    else if (value === '--authorized-active-world') options.authorized = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!options.url || !options.evidence) throw new Error('--url and --evidence are required.');
  if (!options.authorized) throw new Error('Live fixture mutation requires --authorized-active-world.');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(options.bot)) throw new Error('Invalid bot name.');
  if (!Number.isInteger(options.attempts) || options.attempts < 1 || options.attempts > 2) {
    throw new Error('Attempts must be an integer from 1 through 2.');
  }
  if (!Number.isInteger(options.startIndex) || options.startIndex < 1 || options.startIndex > 999) {
    throw new Error('Start index must be an integer from 1 through 999.');
  }
  if (!Number.isInteger(options.durationMs) || options.durationMs < 600_000 || options.durationMs > 900_000) {
    throw new Error('Duration must be an integer from 600000 through 900000 ms.');
  }
  const parsed = new URL(options.url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('URL must use HTTP or HTTPS.');
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  options.url = parsed.toString().replace(/\/$/, '');
  options.evidence = resolve(options.evidence);
  return options;
}

const delay = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));

async function waitFor(read, accept, description, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await read();
    if (accept(latest)) return latest;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}. Last observation: ${JSON.stringify(latest)}`);
}

async function fetchJson(baseUrl, path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        accept: 'application/json',
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.success === false) {
      throw new Error(`${path} failed with HTTP ${response.status}: ${JSON.stringify(body)}`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function emitAcknowledged(socket, event, args, timeoutMs = 30_000) {
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${event} acknowledgement timed out.`)), timeoutMs);
    socket.emit(event, ...args, result => {
      clearTimeout(timeout);
      resolvePromise(result);
    });
  });
}

function connectDashboard(baseUrl) {
  return new Promise((resolvePromise, reject) => {
    const socket = io(baseUrl, { reconnection: false, timeout: 15_000, transports: ['websocket'] });
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('Dashboard connection timed out.'));
    }, 15_000);
    socket.once('connect', () => {
      clearTimeout(timeout);
      resolvePromise(socket);
    });
    socket.once('connect_error', error => {
      clearTimeout(timeout);
      socket.close();
      reject(error);
    });
  });
}

function distance(left, right) {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  return Math.hypot(
    Number(left.x) - Number(right.x),
    Number(left.y) - Number(right.y),
    Number(left.z) - Number(right.z),
  );
}

function compactResult(result) {
  if (!result) return null;
  return {
    actionId: result.actionId || null,
    phase: result.phase || null,
    code: result.code || null,
    label: result.label || null,
    detail: result.detail || null,
    target: result.target || null,
    retryable: result.retryable === true,
    durationMs: result.durationMs ?? null,
    startedAt: result.startedAt ?? null,
    finishedAt: result.finishedAt ?? null,
  };
}

function compactState(state) {
  const arbiter = state?.action?.behaviorArbiter || {};
  return {
    sampledAt: Number(state?._meta?.sampledAt) || 0,
    position: state?.gameplay?.position || null,
    health: state?.gameplay?.health ?? null,
    hunger: state?.gameplay?.hunger ?? null,
    velocity: state?.body?.velocity || null,
    onGround: state?.body?.onGround === true,
    held: state?.action?.held === true,
    idle: state?.action?.isIdle === true,
    pathfinding: state?.action?.pathfinding || null,
    current: state?.action?.current || null,
    stopRequestedAt: state?.action?.stopRequestedAt ?? null,
    stopTimedOutAt: state?.action?.stopTimedOutAt ?? null,
    autonomy: state?.identity?.runtime?.autonomy || state?.identity?.autonomy || null,
    lane: arbiter.selectedLane || null,
    laneCode: arbiter.code || null,
    activeOwner: arbiter.activeActionOwner || null,
    activeLabel: arbiter.activeActionLabel || null,
    arbiterTick: Number(arbiter.tick) || 0,
    goalPhase: state?.action?.goalDirector?.phase || null,
    jobPhase: state?.action?.jobDirector?.phase || null,
    reactionPhase: state?.action?.reactionDirector?.phase || null,
    survivalPhase: state?.action?.survivalDirector?.phase || null,
    lastResult: compactResult(state?.action?.lastResult),
  };
}

function stateSignature(sample) {
  return JSON.stringify([
    sample.held,
    sample.idle,
    sample.pathfinding?.type || null,
    sample.current,
    sample.activeOwner,
    sample.activeLabel,
    sample.lane,
    sample.laneCode,
    sample.lastResult?.actionId || null,
    sample.lastResult?.phase || null,
  ]);
}

function compactTrace(trace) {
  return {
    schemaVersion: trace?.schemaVersion ?? 1,
    decisionId: trace?.decisionId || null,
    agent: trace?.agent || null,
    wallClockTimestamp: trace?.wallClockTimestamp ?? null,
    trigger: trace?.trigger || null,
    activeAction: trace?.activeAction || null,
    evidence: (trace?.evidence || []).map(item => ({
      id: item?.id || null,
      source: item?.source || null,
      observedAt: item?.observedAt ?? null,
      ageMs: item?.ageMs ?? null,
      summary: item?.summary || null,
    })),
    lanes: (trace?.lanes || []).map(lane => ({
      order: lane?.order ?? null,
      lane: lane?.lane || null,
      status: lane?.status || null,
      reasonCode: lane?.reasonCode || null,
      targetRef: lane?.targetRef || null,
      evidenceRefs: lane?.evidenceRefs || [],
    })),
    winner: trace?.winner || null,
    timing: trace?.timing ? { totalMs: trace.timing.totalMs ?? null } : null,
    correlation: trace?.correlation || null,
    outcome: trace?.outcome || null,
  };
}

function marker(runId, phase) {
  return `#${`${runId}_${phase}`.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

function cleanLogLine(line) {
  // eslint-disable-next-line no-control-regex
  return String(line).replace(/\u001b\[[0-9;]*m/g, '');
}

function parsePaperSnapshot(lines, botName) {
  const values = lines
    .map(cleanLogLine)
    .filter(line => line.includes(`${botName} has the following entity data:`))
    .map(line => line.slice(line.indexOf('entity data:') + 'entity data:'.length).trim());
  const positionText = values.find(value => value.startsWith('['));
  const positionMatch = positionText?.match(
    /\[(-?\d+(?:\.\d+)?)d?,\s*(-?\d+(?:\.\d+)?)d?,\s*(-?\d+(?:\.\d+)?)d?\]/i,
  );
  const scalars = values
    .filter(value => !value.startsWith('['))
    .map(value => value.match(/^(-?\d+(?:\.\d+)?)[bdf]?$/i))
    .filter(Boolean)
    .map(match => Number(match[1]));
  return {
    position: positionMatch ? {
      x: Number(positionMatch[1]),
      y: Number(positionMatch[2]),
      z: Number(positionMatch[3]),
    } : null,
    health: scalars[0] ?? null,
    hunger: scalars[1] ?? null,
    onGround: scalars[2] === 1,
  };
}

function findThrashWindows(traces) {
  const starts = new Map();
  for (const trace of traces) {
    const action = trace?.activeAction;
    if (!action?.actionId || !action?.label || !Number.isFinite(Number(action.startedAt))) continue;
    starts.set(action.actionId, {
      actionId: action.actionId,
      label: action.label,
      owner: action.owner || null,
      startedAt: Number(action.startedAt),
    });
  }
  const byLabel = new Map();
  for (const start of starts.values()) {
    const values = byLabel.get(start.label) || [];
    values.push(start);
    byLabel.set(start.label, values);
  }
  const windows = [];
  for (const [label, values] of byLabel) {
    values.sort((left, right) => left.startedAt - right.startedAt);
    for (let left = 0, right = 0; right < values.length; right += 1) {
      while (values[right].startedAt - values[left].startedAt > THRASH_WINDOW_MS) left += 1;
      if (right - left + 1 >= THRASH_ACTION_COUNT) {
        windows.push({
          label,
          startedAt: values[left].startedAt,
          finishedAt: values[right].startedAt,
          actionIds: values.slice(left, right + 1).map(value => value.actionId),
        });
        break;
      }
    }
  }
  return windows;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const evidence = {
    schemaVersion: 1,
    scenario: 'ten-minute-command-autonomy-session-repeat',
    bot: options.bot,
    durationTargetMs: options.durationMs,
    fixture: {
      position: FIXTURE,
      boundedCleanupRegion: CLEANUP_REGION,
      blocks: FIXTURE_BLOCKS,
      inventory: FIXTURE_INVENTORY,
    },
    startedAt: Date.now(),
    attempts: [],
    passed: false,
    error: null,
  };
  let socket = null;
  let states = {};
  let revisions = {};
  let activeAttempt = null;
  let previousMobSpawning = null;
  let mobSpawningMutated = false;

  const paperCommand = command => fetchJson(options.url, '/api/minecraft-server/command', {
    method: 'POST',
    body: JSON.stringify({ command }),
  });

  const sendMessage = async (message) => {
    const result = await emitAcknowledged(socket, 'send-message', [options.bot, { message }]);
    if (result?.success !== true) throw new Error(`Bot command was rejected: ${JSON.stringify(result)}`);
    return result;
  };

  const readBooleanGamerule = async (name) => {
    const command = `gamerule ${name}`;
    await paperCommand(command);
    return waitFor(
      async () => {
        const status = await fetchJson(options.url, '/api/minecraft-server');
        const lines = Array.isArray(status?.server?.logs) ? status.server.logs : [];
        const commandIndex = lines.findLastIndex(line => String(line).includes(`[command] > ${command}`));
        if (commandIndex < 0) return null;
        const pattern = new RegExp(`Gamerule ${name} is currently set to: (true|false)`, 'i');
        for (const line of lines.slice(commandIndex + 1)) {
          const match = String(line).match(pattern);
          if (match) return { value: match[1].toLowerCase() === 'true', line: String(line) };
        }
        return null;
      },
      Boolean,
      `${name} gamerule query`,
      5_000,
    );
  };

  const waitForHeld = (sampledAfter = 0, timeoutMs = 20_000) => waitFor(
    () => states[options.bot] || null,
    state => Number(state?._meta?.sampledAt) >= sampledAfter
      && state?.action?.held === true
      && state?.action?.isIdle === true
      && !state?.action?.pathfinding
      && !state?.action?.behaviorArbiter?.activeActionOwner,
    `${options.bot} held actuator quiescence`,
    timeoutMs,
  );

  const paperSnapshot = async (runId, phase) => {
    const begin = marker(runId, `${phase}_BEGIN`);
    const end = marker(runId, `${phase}_END`);
    await paperCommand(`scoreboard players set ${begin} ${OBJECTIVE} 1`);
    await paperCommand(`data get entity ${options.bot} Pos`);
    await paperCommand(`data get entity ${options.bot} Health`);
    await paperCommand(`data get entity ${options.bot} foodLevel`);
    await paperCommand(`data get entity ${options.bot} OnGround`);
    await paperCommand(`scoreboard players set ${end} ${OBJECTIVE} 1`);
    await delay(300);
    const status = await fetchJson(options.url, '/api/minecraft-server');
    const logs = Array.isArray(status?.server?.logs) ? status.server.logs : [];
    const first = logs.findIndex(line => cleanLogLine(line).includes(`Set [${OBJECTIVE}] for ${begin} to 1`));
    const last = logs.findLastIndex(line => cleanLogLine(line).includes(`Set [${OBJECTIVE}] for ${end} to 1`));
    if (first < 0 || last <= first) throw new Error(`Paper markers missing for ${runId}-${phase}.`);
    const markerWindow = logs.slice(first, last + 1);
    return {
      observedAt: Date.now(),
      serverPhase: status?.server?.phase || null,
      ...parsePaperSnapshot(markerWindow, options.bot),
      markerWindow,
    };
  };

  const declaredMutationKey = target => (
    [target?.x, target?.y, target?.z].every(Number.isFinite)
      ? `${Math.floor(target.x)},${Math.floor(target.y)},${Math.floor(target.z)}`
      : null
  );
  const declaredBlocks = new Map(FIXTURE_BLOCKS.map(block => [declaredMutationKey(block), block]));

  const restoreDeclaredFixture = async (runId) => {
    const markers = FIXTURE_BLOCKS.map((block, index) => ({
      holder: marker(runId, `RESTORE_${index}`),
      block,
    }));
    for (const command of [
      ...FIXTURE_BLOCKS.map(block => `setblock ${block.x} ${block.y} ${block.z} minecraft:${block.name}`),
      `kill @e[type=minecraft:item,x=${CLEANUP_REGION.x},y=${CLEANUP_REGION.y},z=${CLEANUP_REGION.z},`
        + `dx=${CLEANUP_REGION.dx},dy=${CLEANUP_REGION.dy},dz=${CLEANUP_REGION.dz}]`,
      `clear ${options.bot} minecraft:cobblestone`,
      `clear ${options.bot} minecraft:oak_planks`,
      `give ${options.bot} minecraft:oak_planks 1`,
      ...markers.map(({ holder, block }) => (
        `execute if block ${block.x} ${block.y} ${block.z} minecraft:${block.name} `
        + `run scoreboard players set ${holder} ${OBJECTIVE} 1`
      )),
    ]) await paperCommand(command);
    const inventory = await waitFor(
      () => states[options.bot]?.inventory?.counts || {},
      counts => (Number(counts.cobblestone) || 0) === FIXTURE_INVENTORY.cobblestone
        && (Number(counts.oak_planks) || 0) === FIXTURE_INVENTORY.oak_planks,
      `${runId} declared fixture inventory restoration`,
      10_000,
    );
    await delay(300);
    const status = await fetchJson(options.url, '/api/minecraft-server');
    const logs = Array.isArray(status?.server?.logs) ? status.server.logs.map(cleanLogLine) : [];
    const verifiedMarkers = markers.filter(({ holder }) => (
      logs.some(line => line.includes(`Set [${OBJECTIVE}] for ${holder} to 1`))
    ));
    return {
      blocksRestored: verifiedMarkers.length === markers.length,
      verifiedMarkers: verifiedMarkers.map(entry => entry.holder),
      expectedMarkers: markers.map(entry => entry.holder),
      inventory: {
        cobblestone: Number(inventory.cobblestone) || 0,
        oakPlanks: Number(inventory.oak_planks) || 0,
      },
      itemEntitiesClearedInBoundedRegion: true,
      passed: verifiedMarkers.length === markers.length,
    };
  };

  const resetFixture = async () => {
    await waitForHeld();
    for (const command of [
      `effect give ${options.bot} minecraft:resistance 10 255 true`,
      ...HOSTILE_TYPES.map(type => (
        `kill @e[type=minecraft:${type},x=${CLEANUP_REGION.x},y=${CLEANUP_REGION.y},z=${CLEANUP_REGION.z},`
        + `dx=${CLEANUP_REGION.dx},dy=${CLEANUP_REGION.dy},dz=${CLEANUP_REGION.dz}]`
      )),
      `kill @e[type=minecraft:item,x=${CLEANUP_REGION.x},y=${CLEANUP_REGION.y},z=${CLEANUP_REGION.z},`
        + `dx=${CLEANUP_REGION.dx},dy=${CLEANUP_REGION.dy},dz=${CLEANUP_REGION.dz}]`,
      ...FIXTURE_BLOCKS.map(block => `setblock ${block.x} ${block.y} ${block.z} minecraft:${block.name}`),
      `clear ${options.bot} minecraft:cobblestone`,
      `clear ${options.bot} minecraft:oak_planks`,
      `give ${options.bot} minecraft:oak_planks 1`,
      `gamemode survival ${options.bot}`,
      `tp ${options.bot} ${FIXTURE.x} ${FIXTURE.y} ${FIXTURE.z}`,
      `effect clear ${options.bot}`,
      `effect give ${options.bot} minecraft:instant_health 1 4 true`,
      `effect give ${options.bot} minecraft:saturation 1 255 true`,
    ]) await paperCommand(command);
    await delay(1_200);
    await paperCommand(`effect clear ${options.bot} minecraft:saturation`);
    return waitFor(
      () => compactState(states[options.bot]),
      sample => sample.held
        && sample.idle
        && !sample.pathfinding
        && !sample.activeOwner
        && distance(sample.position, FIXTURE) <= 0.25
        && Number(sample.health) >= 19
        && Number(sample.hunger) >= 19,
      'reset ten-minute fixture',
      20_000,
    );
  };

  const pollServices = async () => {
    const at = Date.now();
    const [health, agents, server] = await Promise.all([
      fetchJson(options.url, '/api/health'),
      fetchJson(options.url, '/api/agents'),
      fetchJson(options.url, '/api/minecraft-server'),
    ]);
    const agent = agents?.agents?.find(entry => entry?.name === options.bot);
    return {
      at,
      apiHealthy: health?.ok === true && health?.checks?.minecraftReachable === true,
      agentState: agent?.state || null,
      inGame: agent?.in_game === true,
      socketConnected: agent?.socket_connected === true,
      readiness: agent?.readiness_stage || agent?.connection_stage || null,
      paperPhase: server?.server?.phase || null,
    };
  };

  try {
    const preflight = await pollServices();
    if (!preflight.apiHealthy || preflight.agentState !== 'running' || !preflight.inGame
      || !preflight.socketConnected || preflight.readiness !== 'world_ready' || preflight.paperPhase !== 'running') {
      throw new Error(`Live stack is not ready: ${JSON.stringify(preflight)}`);
    }
    const agents = await fetchJson(options.url, '/api/agents');
    const otherActive = agents?.agents?.filter(entry => entry?.name !== options.bot && entry?.in_game === true) || [];
    if (otherActive.length) throw new Error(`Other bots are active: ${otherActive.map(entry => entry.name).join(', ')}`);

    const spawningBefore = await readBooleanGamerule('spawn_mobs');
    previousMobSpawning = spawningBefore.value;
    if (previousMobSpawning) {
      await paperCommand('gamerule spawn_mobs false');
      mobSpawningMutated = true;
    }
    const spawningDuring = await readBooleanGamerule('spawn_mobs');
    if (spawningDuring.value !== false) throw new Error('Could not isolate the session fixture from natural mob spawning.');
    evidence.fixture.mobSpawning = {
      previous: previousMobSpawning,
      duringFixture: spawningDuring.value,
      restored: false,
    };

    socket = await connectDashboard(options.url);
    const receiveState = payload => {
      const applied = applyStateUpdate(states, revisions, payload);
      states = applied.states;
      revisions = applied.revisions;
      if (applied.resyncRequired) {
        if (activeAttempt) activeAttempt.resyncRequests += 1;
        socket.emit('request-agent-state-snapshot');
      }
      const state = states[options.bot];
      if (!activeAttempt || !state) return;
      for (const trace of state?.action?.behaviorArbiter?.decisionTrace?.recent || []) {
        if (!trace?.decisionId || Number(trace.wallClockTimestamp) < activeAttempt.releaseIssuedAt - 2_000) continue;
        if (activeAttempt.traceMap.has(trace.decisionId)) {
          activeAttempt.traceMap.set(trace.decisionId, compactTrace(trace));
        } else if (activeAttempt.traceMap.size < activeAttempt.traceLimit) {
          activeAttempt.traceMap.set(trace.decisionId, compactTrace(trace));
        } else {
          activeAttempt.tracesTruncated = true;
        }
      }
    };
    socket.on('state-update', receiveState);
    socket.on('state-delta', receiveState);
    socket.on('bot-output', (agentName, output) => {
      if (agentName === options.bot && activeAttempt && activeAttempt.outputs.length < 64) {
        activeAttempt.outputs.push({ at: Date.now(), output: String(output).slice(0, 1_000) });
      }
    });
    socket.on('disconnect', reason => {
      if (activeAttempt) activeAttempt.disconnects.push({ at: Date.now(), source: 'dashboard', reason });
    });
    socket.emit('listen-to-agents');
    socket.emit('request-agent-state-snapshot');
    await waitForHeld();

    await paperCommand(`scoreboard objectives remove ${OBJECTIVE}`);
    await paperCommand(`scoreboard objectives add ${OBJECTIVE} dummy`);

    for (let attemptNumber = 1; attemptNumber <= options.attempts; attemptNumber += 1) {
      const sessionIndex = options.startIndex + attemptNumber - 1;
      const runId = `SES${String(sessionIndex).padStart(3, '0')}-R${attemptNumber}`;
      const beforeState = await resetFixture();
      const paperBefore = await paperSnapshot(runId, 'BEFORE');
      activeAttempt = {
        runId,
        attempt: attemptNumber,
        releaseIssuedAt: Date.now(),
        samples: [],
        transitions: [],
        servicePolls: [],
        serviceFailures: [],
        traceMap: new Map(),
        terminalResults: new Map(),
        outputs: [],
        disconnects: [],
        staleStateEvents: [],
        idleDriftEvents: [],
        ownershipConflicts: [],
        stalledActionWindows: [],
        resyncRequests: 0,
        traceLimit: Math.ceil(options.durationMs / 60) + 64,
        tracesTruncated: false,
      };
      const releaseAck = await sendMessage(RELEASE_COMMAND);
      const releaseAcceptedAt = Number(releaseAck?.acceptedAt) || activeAttempt.releaseIssuedAt;
      const sessionStartedAt = releaseAcceptedAt;
      await waitFor(
        () => compactState(states[options.bot]),
        sample => sample.sampledAt >= releaseAcceptedAt && !sample.held && sample.autonomy === 'command',
        `${runId} command autonomy release`,
        20_000,
      );
      let nextServicePollAt = sessionStartedAt;
      let nextProgressAt = sessionStartedAt + 30_000;
      let lastSignature = null;
      let idleAnchor = null;
      let pathWithoutOwnerAt = null;
      let activeSegment = null;
      let staleRecordedAt = 0;
      console.log(`${runId} started; monitoring ${options.durationMs} ms.`);

      while (Date.now() - sessionStartedAt < options.durationMs) {
        const observedAt = Date.now();
        const sample = compactState(states[options.bot]);
        activeAttempt.samples.push({ observedAt, ...sample });

        const signature = stateSignature(sample);
        if (signature !== lastSignature && activeAttempt.transitions.length < 512) {
          activeAttempt.transitions.push({ observedAt, ...sample });
          lastSignature = signature;
        }

        const result = sample.lastResult;
        if (result?.actionId && Number(result.startedAt) >= sessionStartedAt) {
          activeAttempt.terminalResults.set(result.actionId, result);
        }

        const stateAgeMs = Math.max(0, observedAt - Number(sample.sampledAt || 0));
        if (stateAgeMs > STATE_STALE_MS && observedAt - staleRecordedAt > STATE_STALE_MS) {
          activeAttempt.staleStateEvents.push({ observedAt, stateAgeMs, sampledAt: sample.sampledAt });
          staleRecordedAt = observedAt;
        }

        if (!sample.held && sample.idle && !sample.pathfinding && !sample.activeOwner) {
          if (idleAnchor && distance(idleAnchor.position, sample.position) > 0.35) {
            activeAttempt.idleDriftEvents.push({
              from: idleAnchor,
              to: { observedAt, position: sample.position },
              distance: distance(idleAnchor.position, sample.position),
            });
          }
          idleAnchor = { observedAt, position: sample.position };
        } else {
          idleAnchor = null;
        }

        if (!sample.held && sample.pathfinding && !sample.activeOwner) {
          pathWithoutOwnerAt ??= observedAt;
          if (observedAt - pathWithoutOwnerAt >= 5_000 && activeAttempt.ownershipConflicts.length === 0) {
            activeAttempt.ownershipConflicts.push({
              startedAt: pathWithoutOwnerAt,
              observedAt,
              reason: 'pathfinding_without_action_owner',
              sample,
            });
          }
        } else {
          pathWithoutOwnerAt = null;
        }

        if (sample.activeOwner && sample.activeLabel) {
          if (!activeSegment || activeSegment.owner !== sample.activeOwner || activeSegment.label !== sample.activeLabel) {
            activeSegment = { owner: sample.activeOwner, label: sample.activeLabel, startedAt: observedAt, position: sample.position };
          } else if (observedAt - activeSegment.startedAt >= 60_000
            && distance(activeSegment.position, sample.position) < 0.2
            && !activeSegment.reported) {
            activeAttempt.stalledActionWindows.push({ ...activeSegment, observedAt, position: sample.position });
            activeSegment.reported = true;
          }
        } else {
          activeSegment = null;
        }

        if (observedAt >= nextServicePollAt) {
          try {
            const service = await pollServices();
            activeAttempt.servicePolls.push(service);
            if (!service.apiHealthy || service.agentState !== 'running' || !service.inGame
              || !service.socketConnected || service.readiness !== 'world_ready' || service.paperPhase !== 'running') {
              activeAttempt.disconnects.push({ at: observedAt, source: 'service_poll', service });
            }
          } catch (error) {
            activeAttempt.serviceFailures.push({
              at: observedAt,
              error: String(error?.message || error).slice(0, 1_000),
            });
          }
          nextServicePollAt = observedAt + SERVICE_POLL_MS;
        }

        if (observedAt >= nextProgressAt) {
          const elapsedSeconds = Math.floor((observedAt - sessionStartedAt) / 1_000);
          console.log(
            `${runId} ${elapsedSeconds}s/${Math.floor(options.durationMs / 1_000)}s `
            + `health=${sample.health} hunger=${sample.hunger} owner=${sample.activeOwner || 'none'} `
            + `action=${sample.activeLabel || 'idle'} traces=${activeAttempt.traceMap.size}`,
          );
          nextProgressAt = observedAt + 30_000;
        }
        await delay(SAMPLE_MS);
      }

      const sessionFinishedAt = Date.now();
      const stopIssuedAt = Date.now();
      const stopAck = await sendMessage('!stop');
      const stopAcceptedAt = Number(stopAck?.acceptedAt) || stopIssuedAt;
      const heldState = await waitForHeld(stopAcceptedAt, 20_000);
      const heldAt = Number(heldState?._meta?.sampledAt) || Date.now();
      const stableSamples = [];
      for (let second = 0; second <= 10; second += 1) {
        stableSamples.push({ observedAt: Date.now(), ...compactState(states[options.bot]) });
        if (second < 10) await delay(1_000);
      }
      const stable = stableSamples.every(sample => (
        sample.held
        && sample.idle
        && !sample.pathfinding
        && !sample.activeOwner
        && distance(sample.position, stableSamples[0].position) <= 0.05
      ));
      const paperFinal = await paperSnapshot(runId, 'FINAL');
      const finalState = compactState(states[options.bot]);
      const traces = [...activeAttempt.traceMap.values()]
        .sort((left, right) => Number(left.wallClockTimestamp) - Number(right.wallClockTimestamp));
      const terminalResults = [...activeAttempt.terminalResults.values()];
      const linkedOutcomes = new Map();
      for (const trace of traces) {
        if (trace?.correlation?.outcomeLinked === true && trace?.correlation?.actionId) {
          linkedOutcomes.set(trace.correlation.actionId, trace);
        }
      }
      const falseCompletionCandidates = terminalResults
        .filter(result => result.phase === 'succeeded' && result.label !== 'action:lookAtPosition')
        .filter(result => {
          const linked = linkedOutcomes.get(result.actionId);
          return !linked || linked?.outcome?.phase !== result.phase || linked?.outcome?.code !== result.code;
        });
      const worldMutationResults = terminalResults.filter(result => (
        result.phase === 'succeeded'
        && ['action:breakBlock', 'action:placeBlockAt'].includes(result.label)
      ));
      const undeclaredWorldMutations = worldMutationResults.filter(result => {
        const declared = declaredBlocks.get(declaredMutationKey(result.target));
        if (!declared) return true;
        if (result.label === 'action:breakBlock') return result.target?.name !== declared.name;
        return declared.name !== 'air';
      });
      const fixtureCleanup = await restoreDeclaredFixture(runId);
      const thrashWindows = findThrashWindows(traces);
      const serviceHealthy = activeAttempt.servicePolls.length >= 100
        && activeAttempt.servicePolls.every(service => (
          service.apiHealthy
          && service.agentState === 'running'
          && service.inGame
          && service.socketConnected
          && service.readiness === 'world_ready'
          && service.paperPhase === 'running'
        ));
      const minHealth = Math.min(...activeAttempt.samples.map(sample => Number(sample.health)).filter(Number.isFinite));
      const uniqueCanonicalSamples = new Set(activeAttempt.samples.map(sample => sample.sampledAt).filter(Boolean)).size;
      const paperMatchesCanonical = distance(paperFinal.position, finalState.position) <= 0.5
        && Number(paperFinal.health) === Number(finalState.health)
        && Number(paperFinal.hunger) === Number(finalState.hunger)
        && paperFinal.onGround === finalState.onGround;
      const sessionDurationMs = sessionFinishedAt - sessionStartedAt;
      const passed = sessionDurationMs >= options.durationMs
        && activeAttempt.samples.length >= 550
        && uniqueCanonicalSamples >= 100
        && serviceHealthy
        && activeAttempt.serviceFailures.length === 0
        && activeAttempt.disconnects.length === 0
        && activeAttempt.staleStateEvents.length === 0
        && activeAttempt.idleDriftEvents.length === 0
        && activeAttempt.ownershipConflicts.length === 0
        && activeAttempt.stalledActionWindows.length === 0
        && !activeAttempt.tracesTruncated
        && thrashWindows.length === 0
        && falseCompletionCandidates.length === 0
        && undeclaredWorldMutations.length === 0
        && fixtureCleanup.passed
        && minHealth > 0
        && paperMatchesCanonical
        && heldAt - stopAcceptedAt <= 2_000
        && stable;

      evidence.attempts.push({
        runId,
        attempt: attemptNumber,
        releaseCommand: RELEASE_COMMAND,
        releaseIssuedAt: activeAttempt.releaseIssuedAt,
        releaseAck,
        sessionStartedAt,
        sessionFinishedAt,
        sessionDurationMs,
        beforeState,
        finalState,
        paperBefore,
        paperFinal,
        paperMatchesCanonical,
        sampleCount: activeAttempt.samples.length,
        uniqueCanonicalSamples,
        minHealth,
        serviceHealthy,
        resyncRequests: activeAttempt.resyncRequests,
        traceLimit: activeAttempt.traceLimit,
        tracesTruncated: activeAttempt.tracesTruncated,
        servicePolls: activeAttempt.servicePolls,
        serviceFailures: activeAttempt.serviceFailures,
        disconnects: activeAttempt.disconnects,
        staleStateEvents: activeAttempt.staleStateEvents,
        idleDriftEvents: activeAttempt.idleDriftEvents,
        ownershipConflicts: activeAttempt.ownershipConflicts,
        stalledActionWindows: activeAttempt.stalledActionWindows,
        thrashWindows,
        falseCompletionCandidates,
        worldMutationResults,
        undeclaredWorldMutations,
        fixtureCleanup,
        terminalResults,
        outputs: activeAttempt.outputs,
        samples: activeAttempt.samples,
        transitions: activeAttempt.transitions,
        decisionTraces: traces,
        stop: {
          issuedAt: stopIssuedAt,
          acceptedAt: stopAcceptedAt,
          heldAt,
          quiescenceMs: heldAt - stopAcceptedAt,
          stableForTenSeconds: stable,
          samples: stableSamples,
        },
        passed,
      });
      console.log(
        `${runId} ${passed ? 'passed' : 'failed'}: duration=${sessionDurationMs}ms `
        + `samples=${activeAttempt.samples.length}/${uniqueCanonicalSamples} services=${activeAttempt.servicePolls.length} `
        + `traces=${traces.length} stop=${heldAt - stopAcceptedAt}ms stable10s=${stable}`,
      );
      activeAttempt = null;
      if (!passed) break;
    }
    evidence.passed = evidence.attempts.length === options.attempts
      && evidence.attempts.every(attempt => attempt.passed);
  } catch (error) {
    evidence.error = String(error?.stack || error?.message || error).slice(0, 4_000);
  } finally {
    if (socket?.connected) {
      try {
        let acceptedAt = 0;
        if (states[options.bot]?.action?.held !== true) {
          const cleanupStop = await sendMessage('!stop');
          acceptedAt = Number(cleanupStop?.acceptedAt) || Date.now();
        }
        await waitForHeld(acceptedAt, 20_000);
        const cleanupState = await resetFixture();
        evidence.cleanup = {
          held: cleanupState.held,
          idle: cleanupState.idle,
          pathfinding: cleanupState.pathfinding,
          activeOwner: cleanupState.activeOwner,
          position: cleanupState.position,
          health: cleanupState.health,
          hunger: cleanupState.hunger,
          autonomy: cleanupState.autonomy,
          profileOnDiskUnchanged: true,
        };
      } catch (cleanupError) {
        evidence.cleanupError = String(cleanupError?.stack || cleanupError?.message || cleanupError).slice(0, 2_000);
      }
      try {
        await paperCommand(`scoreboard objectives remove ${OBJECTIVE}`);
      } catch (cleanupError) {
        evidence.objectiveCleanupError = String(cleanupError?.message || cleanupError).slice(0, 1_000);
      }
      socket.close();
    }
    try {
      if (mobSpawningMutated) await paperCommand(`gamerule spawn_mobs ${previousMobSpawning}`);
      if (previousMobSpawning !== null) {
        const spawningAfter = await readBooleanGamerule('spawn_mobs');
        if (spawningAfter.value !== previousMobSpawning) {
          evidence.gameruleCleanupError = `Failed to restore spawn_mobs to ${previousMobSpawning}.`;
          evidence.passed = false;
        } else {
          evidence.fixture.mobSpawning.restored = true;
        }
      }
    } catch (cleanupError) {
      evidence.gameruleCleanupError = String(cleanupError?.stack || cleanupError?.message || cleanupError).slice(0, 2_000);
      evidence.passed = false;
    }
    evidence.finishedAt = Date.now();
    evidence.durationMs = evidence.finishedAt - evidence.startedAt;
    await mkdir(dirname(options.evidence), { recursive: true });
    await writeFile(options.evidence, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  }

  if (!evidence.passed) {
    throw new Error(evidence.error || `Session field verifier failed: ${options.evidence}`);
  }
  console.log(`Session field verifier passed ${evidence.attempts.length}/${options.attempts}: ${options.evidence}`);
}

run().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
