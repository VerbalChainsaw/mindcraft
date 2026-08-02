import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

import { io } from 'socket.io-client';

import { EMERGENCY_SHELTER_BLUEPRINT } from '../src/agent/runtime/emergency-shelter.js';
import { applyStateUpdate } from '../src/mindcraft/public/js/agent-state-protocol.js';

const FIXTURES = Object.freeze({
  hunger: Object.freeze({ x: 1071.5, y: 160, z: 1007.5 }),
  sleep: Object.freeze({ x: 1111.5, y: 160, z: 1007.5 }),
  shelter: Object.freeze({ x: 1151.5, y: 160, z: 1007.5 }),
});
const BED = Object.freeze({
  foot: Object.freeze({ x: 1113, y: 160, z: 1007 }),
  head: Object.freeze({ x: 1114, y: 160, z: 1007 }),
});
const FOOD = 'cooked_beef';
const FOOD_COUNT = 8;
const SHELTER_MATERIAL = 'cobblestone';
const OBJECTIVE = 'svfieldproof';
const RELEASE_COMMAND = '!setAutonomy("command")';
const POLL_MS = 100;
const HOLD_WINDOW_MS = 10_000;
const TERMINAL_PHASES = new Set(['complete', 'failed', 'cancelled']);
const BUILDING_MATERIALS = Object.freeze([
  'oak_planks',
  'spruce_planks',
  'birch_planks',
  'jungle_planks',
  'acacia_planks',
  'dark_oak_planks',
  'mangrove_planks',
  'cherry_planks',
  'pale_oak_planks',
  'bamboo_planks',
  'crimson_planks',
  'warped_planks',
  'stone',
  'dirt',
  SHELTER_MATERIAL,
]);
const TRACKED_ITEMS = Object.freeze([...new Set([FOOD, ...BUILDING_MATERIALS])]);

function parseArgs(argv) {
  const options = {
    url: '',
    bot: 'MindcraftBot',
    attempts: 3,
    scenarios: ['hunger', 'sleep', 'shelter'],
    evidence: '',
    authorized: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--url') options.url = String(argv[++index] || '');
    else if (value === '--bot') options.bot = String(argv[++index] || '');
    else if (value === '--attempts') options.attempts = Number(argv[++index]);
    else if (value === '--scenario') {
      const requested = String(argv[++index] || '').toLowerCase();
      options.scenarios = requested === 'all'
        ? ['hunger', 'sleep', 'shelter']
        : requested.split(',').map(entry => entry.trim()).filter(Boolean);
    } else if (value === '--evidence') options.evidence = String(argv[++index] || '');
    else if (value === '--authorized-active-world') options.authorized = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!options.url || !options.evidence) throw new Error('--url and --evidence are required.');
  if (!options.authorized) throw new Error('Live fixture mutation requires --authorized-active-world.');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(options.bot)) throw new Error('Invalid bot name.');
  if (!Number.isInteger(options.attempts) || options.attempts < 1 || options.attempts > 3) {
    throw new Error('Attempts must be an integer from 1 through 3.');
  }
  const allowed = new Set(['hunger', 'sleep', 'shelter']);
  if (!options.scenarios.length || options.scenarios.some(scenario => !allowed.has(scenario))) {
    throw new Error('Scenario must be hunger, sleep, shelter, all, or a comma-separated subset.');
  }
  options.scenarios = [...new Set(options.scenarios)];
  const parsed = new URL(options.url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('URL must use HTTP or HTTPS.');
  if (parsed.hostname === '127.0.0.1') {
    throw new Error('Use localhost or [::1]; 127.0.0.1 belongs to the tunnel dashboard.');
  }
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
    await delay(POLL_MS);
  }
  throw new Error(`Timed out waiting for ${description}. Last observation: ${JSON.stringify(latest)}`);
}

async function fetchJson(baseUrl, path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
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
  const counts = state?.inventory?.counts || {};
  return {
    sampledAt: Number(state?._meta?.sampledAt) || 0,
    position: state?.gameplay?.position || null,
    health: state?.gameplay?.health ?? null,
    hunger: state?.gameplay?.hunger ?? null,
    timeOfDay: state?.gameplay?.timeOfDay ?? null,
    weather: state?.gameplay?.weather || null,
    gamemode: state?.gameplay?.gamemode || null,
    sleeping: state?.body?.sleeping === true,
    velocity: state?.body?.velocity || null,
    onGround: state?.body?.onGround === true,
    held: state?.action?.held === true,
    idle: state?.action?.isIdle === true,
    pathfinding: state?.action?.pathfinding || null,
    current: state?.action?.current || null,
    autonomy: state?.identity?.runtime?.autonomy || state?.identity?.autonomy || null,
    lane: arbiter.selectedLane || null,
    laneCode: arbiter.code || null,
    activeOwner: arbiter.activeActionOwner || null,
    activeLabel: arbiter.activeActionLabel || null,
    survivalDirector: state?.action?.survivalDirector || null,
    jobDirector: state?.action?.jobDirector || null,
    inventory: Object.fromEntries(TRACKED_ITEMS.map(item => [item, Number(counts[item]) || 0])),
    lastResult: compactResult(state?.action?.lastResult),
  };
}

function distance(left, right) {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  return Math.hypot(
    Number(left.x) - Number(right.x),
    Number(left.y) - Number(right.y),
    Number(left.z) - Number(right.z),
  );
}

function speed(sample) {
  const velocity = sample?.velocity;
  if (!velocity) return Number.POSITIVE_INFINITY;
  return Math.hypot(Number(velocity.x), Number(velocity.y), Number(velocity.z));
}

function marker(runId, phase, fact) {
  return `#${`${runId}_${phase}_${fact}`.replace(/[^A-Za-z0-9_]/g, '_')}`.slice(0, 40);
}

function cleanLines(lines) {
  // eslint-disable-next-line no-control-regex
  return lines.map(line => String(line).replace(/\u001b\[[0-9;]*m/g, ''));
}

function paperPosition(lines, botName) {
  for (const line of cleanLines(lines).reverse()) {
    if (!line.includes(`${botName} has the following entity data:`)) continue;
    const match = line.match(/\[(-?\d+(?:\.\d+)?)d?,\s*(-?\d+(?:\.\d+)?)d?,\s*(-?\d+(?:\.\d+)?)d?\]/i);
    if (match) return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
  }
  return null;
}

function paperScalars(lines, botName) {
  return cleanLines(lines)
    .filter(line => line.includes(`${botName} has the following entity data:`))
    .map(line => line.match(/entity data:\s*(-?\d+(?:\.\d+)?)(?:[bdfsL])?\s*$/i))
    .filter(Boolean)
    .map(match => Number(match[1]));
}

function paperTime(lines) {
  for (const line of cleanLines(lines).reverse()) {
    const match = line.match(/The time is\s+(\d+)/i);
    if (match) return Number(match[1]);
  }
  return null;
}

function paperInventoryCount(lines) {
  for (const line of cleanLines(lines).reverse()) {
    const found = line.match(/Found (\d+) matching item\(s\) on player/i);
    if (found) return Number(found[1]);
    if (/No items were found on player/i.test(line)) return 0;
  }
  return null;
}

function paperScore(lines, player) {
  const escaped = player.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escaped} has (\\d+)`, 'i');
  for (const line of cleanLines(lines).reverse()) {
    const match = line.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function isNight(timeOfDay) {
  const value = Number(timeOfDay);
  return Number.isFinite(value) && value >= 12_542 && value < 23_460;
}

function activeWorkOrder(jobDirector) {
  const order = jobDirector?.workOrder;
  return order && !TERMINAL_PHASES.has(order.phase) ? order : null;
}

function traceLane(trace, lane) {
  return trace?.lanes?.find(candidate => candidate?.lane === lane) || null;
}

function linkedActionTraces(traces, result, owner) {
  if (!result?.actionId) return [];
  return traces.filter(trace => (
    trace?.correlation?.actionId === result.actionId
    && trace?.correlation?.outcomeLinked === true
    && trace?.activeAction?.actionId === result.actionId
    && trace?.activeAction?.owner === owner
    && trace?.activeAction?.label === result.label
    && trace?.outcome?.code === result.code
    && trace?.outcome?.phase === result.phase
  ));
}

function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readOptional(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const evidence = {
    schemaVersion: 2,
    scenario: 'isolated-survival-field-suite',
    bot: options.bot,
    selectedScenarios: options.scenarios,
    attemptsPerScenario: options.attempts,
    contract: {
      hunger: 'consume action, hunger/inventory deltas, ownership, traces, Paper proof, <=2s stop, stable 10s hold',
      sleep: 'safe-night policy selection, canonical sleep entry, Paper sleep proof, wake postconditions, stable hold',
      shelter: 'survival-owned work selection, bounded physical build, complete blueprint postcondition, cleanup',
    },
    fixtures: { ...FIXTURES, bed: BED, shelterBlueprint: EMERGENCY_SHELTER_BLUEPRINT.id },
    startedAt: Date.now(),
    isolation: {},
    results: {},
    passed: false,
    error: null,
  };
  const jobStatePath = resolve('bots', options.bot, 'job-state.json');
  const botsRoot = `${resolve('bots')}\\`;
  if (!jobStatePath.startsWith(botsRoot)) throw new Error('Resolved job-state path escaped the bots directory.');

  let socket = null;
  let states = {};
  let revisions = {};
  let activeAttempt = null;
  let originalState = null;
  let originalJobBytes = null;
  let originalJobExists = false;
  let originalInventory = null;
  let originalMobSpawning = null;
  let originalSleepingPercentage = null;
  let jobStateCaptured = false;
  let jobStateWasDetached = false;
  const controlledOrderIds = new Set();

  const paperCommand = command => fetchJson(options.url, '/api/minecraft-server/command', {
    method: 'POST',
    body: JSON.stringify({ command }),
  });

  const sendMessage = async (message) => {
    const result = await emitAcknowledged(socket, 'send-message', [options.bot, { message }]);
    if (result?.success !== true) throw new Error(`Bot command was rejected: ${JSON.stringify(result)}`);
    return result;
  };

  const sendStop = () => sendMessage('!stop');

  const paperCapture = async (runId, phase, commands) => {
    const begin = marker(runId, phase, 'BEGIN');
    const end = marker(runId, phase, 'END');
    await paperCommand(`scoreboard players set ${begin} ${OBJECTIVE} 1`);
    for (const command of commands) await paperCommand(command);
    await paperCommand(`scoreboard players set ${end} ${OBJECTIVE} 1`);
    await delay(300);
    const status = await fetchJson(options.url, '/api/minecraft-server');
    const lines = Array.isArray(status?.server?.logs) ? status.server.logs : [];
    const first = lines.findLastIndex(line => String(line).includes(begin));
    const last = lines.findLastIndex(line => String(line).includes(end));
    if (first < 0 || last < first) throw new Error(`Paper markers missing for ${runId}-${phase}.`);
    return lines.slice(first, last + 1);
  };

  const paperEntitySnapshot = async (runId, phase, { item = null, sleep = false } = {}) => {
    const commands = [
      `data get entity ${options.bot} Pos`,
      `data get entity ${options.bot} Health`,
      `data get entity ${options.bot} foodLevel`,
      ...(sleep ? [
        `data get entity ${options.bot} SleepTimer`,
        `data get entity ${options.bot} SleepingX`,
        `data get entity ${options.bot} SleepingY`,
        `data get entity ${options.bot} SleepingZ`,
      ] : []),
      'time query daytime',
      ...(item ? [`clear ${options.bot} minecraft:${item} 0`] : []),
    ];
    const lines = await paperCapture(runId, phase, commands);
    const scalars = paperScalars(lines, options.bot);
    return {
      position: paperPosition(lines, options.bot),
      health: scalars[0] ?? null,
      hunger: scalars[1] ?? null,
      sleepTimer: sleep ? scalars[2] ?? null : null,
      sleepingPosition: sleep && scalars.length >= 6
        ? { x: scalars[3], y: scalars[4], z: scalars[5] }
        : null,
      timeOfDay: paperTime(lines),
      item: item ? { name: item, count: paperInventoryCount(lines) } : null,
      lines,
    };
  };

  const readGamerule = async (name) => {
    const command = `gamerule ${name}`;
    await paperCommand(command);
    return waitFor(
      async () => {
        const status = await fetchJson(options.url, '/api/minecraft-server');
        const lines = Array.isArray(status?.server?.logs) ? status.server.logs : [];
        const commandIndex = lines.findLastIndex(line => String(line).includes(`[command] > ${command}`));
        if (commandIndex < 0) return null;
        const pattern = new RegExp(`Gamerule ${name} is currently set to: ([^\\s]+)`, 'i');
        for (const line of lines.slice(commandIndex + 1)) {
          const match = String(line).match(pattern);
          if (!match) continue;
          const raw = match[1];
          const value = /^(?:true|false)$/i.test(raw)
            ? raw.toLowerCase() === 'true'
            : Number.isFinite(Number(raw)) ? Number(raw) : raw;
          return { name, value, line: String(line) };
        }
        return null;
      },
      Boolean,
      `${name} gamerule query`,
      5_000,
    );
  };

  const requestSnapshot = () => socket.emit('request-agent-state-snapshot');

  const waitForHeld = (sampledAfter = 0, timeoutMs = 20_000) => waitFor(
    () => states[options.bot] || null,
    state => Number(state?._meta?.sampledAt) >= sampledAfter
      && state?.action?.held === true
      && state?.action?.isIdle === true
      && !state?.action?.pathfinding
      && state?.body?.sleeping !== true,
    `${options.bot} held actuator quiescence`,
    timeoutMs,
  );

  const triggerStop = attempt => {
    if (!attempt || attempt.stopPromise) return;
    attempt.stopIssuedAt = Date.now();
    attempt.stopPromise = sendStop();
    attempt.stopPromise.catch(() => {});
  };

  const observeHeldWindow = async attempt => {
    if (!attempt.stopPromise) triggerStop(attempt);
    const stopAck = await attempt.stopPromise;
    const acceptedAt = Number(stopAck?.acceptedAt) || attempt.stopIssuedAt;
    const heldState = await waitForHeld(acceptedAt);
    const heldAt = Number(heldState?._meta?.sampledAt) || Date.now();
    const samples = [];
    const startedAt = Date.now();
    while (Date.now() - startedAt < HOLD_WINDOW_MS) {
      samples.push({ capturedAt: Date.now(), ...compactState(states[options.bot]) });
      await delay(1_000);
    }
    samples.push({ capturedAt: Date.now(), ...compactState(states[options.bot]) });
    const origin = samples[0]?.position;
    const stable = samples.length >= 11 && samples.every(sample => (
      sample.held
      && sample.idle
      && !sample.pathfinding
      && !sample.sleeping
      && speed(sample) <= 0.05
      && distance(sample.position, origin) <= 0.05
    ));
    return {
      stopAck,
      issuedAt: attempt.stopIssuedAt,
      acceptedAt,
      heldAt,
      latencyMs: heldAt - acceptedAt,
      durationMs: samples.at(-1).capturedAt - samples[0].capturedAt,
      stable,
      samples,
    };
  };

  const preparePlatform = async (fixture, radius = 5) => {
    const x = Math.floor(fixture.x);
    const y = Math.floor(fixture.y);
    const z = Math.floor(fixture.z);
    await paperCommand(`fill ${x - radius} ${y} ${z - radius} ${x + radius} ${y + 4} ${z + radius} air`);
    await paperCommand(`fill ${x - radius} ${y - 1} ${z - radius} ${x + radius} ${y - 1} ${z + radius} stone`);
  };

  const clearPlatform = async (fixture, radius = 5) => {
    const x = Math.floor(fixture.x);
    const y = Math.floor(fixture.y);
    const z = Math.floor(fixture.z);
    await paperCommand(`fill ${x - radius} ${y - 1} ${z - radius} ${x + radius} ${y + 4} ${z + radius} air`);
  };

  const healthyHeldFixture = async fixture => {
    await waitForHeld();
    await paperCommand(`gamemode survival ${options.bot}`);
    await paperCommand(`tp ${options.bot} ${fixture.x} ${fixture.y} ${fixture.z}`);
    await paperCommand(`effect clear ${options.bot} minecraft:hunger`);
    await paperCommand(`effect clear ${options.bot} minecraft:saturation`);
    await paperCommand(`effect give ${options.bot} minecraft:instant_health 1 4 true`);
    await paperCommand(`effect give ${options.bot} minecraft:saturation 1 255 true`);
    await waitFor(
      () => compactState(states[options.bot]),
      state => state.held
        && state.idle
        && !state.pathfinding
        && distance(state.position, fixture) <= 0.25
        && Number(state.health) >= 19
        && Number(state.hunger) >= 19,
      'healthy held survival fixture',
      20_000,
    );
    await paperCommand(`effect clear ${options.bot} minecraft:saturation`);
  };

  const setItemCounts = async desired => {
    for (const [item, amount] of Object.entries(desired)) {
      await paperCommand(`clear ${options.bot} minecraft:${item}`);
      if (Number(amount) > 0) await paperCommand(`give ${options.bot} minecraft:${item} ${Math.floor(Number(amount))}`);
    }
    await waitFor(
      () => compactState(states[options.bot]),
      state => Object.entries(desired).every(([item, amount]) => state.inventory[item] === Number(amount)),
      `controlled inventory ${JSON.stringify(desired)}`,
      20_000,
    );
  };

  const blueprintProof = async (runId, phase) => {
    const anchor = {
      x: Math.floor(FIXTURES.shelter.x),
      y: Math.floor(FIXTURES.shelter.y),
      z: Math.floor(FIXTURES.shelter.z),
    };
    const correctPlayer = marker(runId, phase, 'CORRECT');
    const doorPlayer = marker(runId, phase, 'DOOR');
    const commands = [
      `scoreboard players set ${correctPlayer} ${OBJECTIVE} 0`,
      `scoreboard players set ${doorPlayer} ${OBJECTIVE} 0`,
      ...EMERGENCY_SHELTER_BLUEPRINT.cells.map(cell => (
        `execute if block ${anchor.x + cell.x} ${anchor.y + cell.y} ${anchor.z + cell.z} minecraft:${SHELTER_MATERIAL} run scoreboard players add ${correctPlayer} ${OBJECTIVE} 1`
      )),
      `execute if block ${anchor.x} ${anchor.y} ${anchor.z - 1} minecraft:air run scoreboard players add ${doorPlayer} ${OBJECTIVE} 1`,
      `execute if block ${anchor.x} ${anchor.y + 1} ${anchor.z - 1} minecraft:air run scoreboard players add ${doorPlayer} ${OBJECTIVE} 1`,
      `scoreboard players get ${correctPlayer} ${OBJECTIVE}`,
      `scoreboard players get ${doorPlayer} ${OBJECTIVE}`,
      `data get entity ${options.bot} Pos`,
      `clear ${options.bot} minecraft:${SHELTER_MATERIAL} 0`,
    ];
    const lines = await paperCapture(runId, phase, commands);
    return {
      correct: paperScore(lines, correctPlayer),
      openDoorCells: paperScore(lines, doorPlayer),
      position: paperPosition(lines, options.bot),
      materialCount: paperInventoryCount(lines),
      lines,
    };
  };

  const bedProof = async (runId, phase) => {
    const bedPlayer = marker(runId, phase, 'BED');
    const commands = [
      `scoreboard players set ${bedPlayer} ${OBJECTIVE} 0`,
      `execute if block ${BED.foot.x} ${BED.foot.y} ${BED.foot.z} minecraft:red_bed[part=foot] run scoreboard players add ${bedPlayer} ${OBJECTIVE} 1`,
      `execute if block ${BED.head.x} ${BED.head.y} ${BED.head.z} minecraft:red_bed[part=head] run scoreboard players add ${bedPlayer} ${OBJECTIVE} 1`,
      `scoreboard players get ${bedPlayer} ${OBJECTIVE}`,
    ];
    const lines = await paperCapture(runId, phase, commands);
    return { parts: paperScore(lines, bedPlayer), lines };
  };

  const beginAttempt = (kind, attemptNumber) => ({
    kind,
    runId: `${kind === 'hunger' ? 'HUN' : kind === 'sleep' ? 'SLP' : 'SHL'}-R${attemptNumber}`,
    attempt: attemptNumber,
    issuedAt: Date.now(),
    samples: [],
    outputs: [],
    traceMap: new Map(),
    resultMap: new Map(),
    terminalState: null,
    sleepEntryState: null,
    sleepEntryPaperPromise: null,
    workOrderId: null,
    workOrderFirstState: null,
    stopPromise: null,
    stopIssuedAt: null,
    resyncRequests: 0,
  });

  const tracesFor = attempt => [...attempt.traceMap.values()]
    .filter(trace => Number(trace.wallClockTimestamp) >= attempt.issuedAt - 2_000)
    .sort((left, right) => Number(left.wallClockTimestamp) - Number(right.wallClockTimestamp));

  const runHungerAttempt = async attemptNumber => {
    const runId = `HUN-R${attemptNumber}`;
    await preparePlatform(FIXTURES.hunger);
    await healthyHeldFixture(FIXTURES.hunger);
    await setItemCounts({ [FOOD]: FOOD_COUNT });
    await paperCommand('time set 6000');
    await paperCommand('weather clear');
    await paperCommand(`effect give ${options.bot} minecraft:hunger 30 79 true`);
    await waitFor(
      () => compactState(states[options.bot]),
      state => state.held
        && state.idle
        && Number(state.health) >= 19
        && Number(state.hunger) >= 7
        && Number(state.hunger) <= 12
        && state.inventory[FOOD] === FOOD_COUNT,
      `${runId} bounded low hunger`,
      35_000,
    );
    await paperCommand(`effect clear ${options.bot} minecraft:hunger`);
    const beforeState = compactState(states[options.bot]);
    const paperBefore = await paperEntitySnapshot(runId, 'BEFORE', { item: FOOD });
    const attempt = beginAttempt('hunger', attemptNumber);
    attempt.issuedAt = Date.now();
    activeAttempt = attempt;
    const releaseAck = await sendMessage(RELEASE_COMMAND);
    const terminalState = await waitFor(
      () => attempt.terminalState,
      Boolean,
      `${runId} survival-owned consume terminal state`,
      25_000,
    );
    const terminal = terminalState.lastResult;
    const hold = await observeHeldWindow(attempt);
    const afterState = compactState(states[options.bot]);
    const paperAfter = await paperEntitySnapshot(runId, 'AFTER', { item: FOOD });
    const traces = tracesFor(attempt);
    const linked = linkedActionTraces(traces, terminal, 'survival');
    const selections = traces.filter(trace => trace?.winner?.lane === 'basic_survival');
    const unrelatedWork = attempt.samples.filter(sample => activeWorkOrder(sample.jobDirector));
    const passed = terminal.phase === 'succeeded'
      && terminal.code === 'skill_consumed'
      && terminal.label === 'action:consume'
      && terminal.target?.name === FOOD
      && beforeState.inventory[FOOD] === FOOD_COUNT
      && terminalState.inventory[FOOD] === FOOD_COUNT - 1
      && afterState.inventory[FOOD] === FOOD_COUNT - 1
      && paperBefore.item?.count === FOOD_COUNT
      && paperAfter.item?.count === FOOD_COUNT - 1
      && Number(beforeState.hunger) >= 7
      && Number(beforeState.hunger) <= 14
      && Number(terminalState.hunger) > Number(beforeState.hunger)
      && Number(paperAfter.hunger) > Number(paperBefore.hunger)
      && Number(paperBefore.health) >= 19
      && Number(paperAfter.health) >= 19
      && distance(beforeState.position, FIXTURES.hunger) <= 0.25
      && distance(terminalState.position, FIXTURES.hunger) <= 0.25
      && distance(afterState.position, terminalState.position) <= 0.05
      && attempt.samples.some(sample => sample.autonomy === 'command' && !sample.held)
      && selections.length > 0
      && linked.length > 0
      && unrelatedWork.length === 0
      && hold.latencyMs <= 2_000
      && hold.durationMs >= HOLD_WINDOW_MS
      && hold.stable;
    activeAttempt = null;
    return {
      runId,
      attempt: attemptNumber,
      releaseAck,
      beforeState,
      terminalState,
      afterState,
      terminal,
      paper: { before: paperBefore, after: paperAfter },
      ownership: {
        expected: 'survival',
        survivalDecisionIds: selections.map(trace => trace.decisionId),
        linkedDecisionIds: linked.map(trace => trace.decisionId),
        unrelatedWorkObserved: unrelatedWork.length,
      },
      hold,
      outputs: attempt.outputs,
      samples: attempt.samples,
      traces,
      passed,
    };
  };

  const runSleepAttempt = async attemptNumber => {
    const runId = `SLP-R${attemptNumber}`;
    await preparePlatform(FIXTURES.sleep);
    await paperCommand(`setblock ${BED.foot.x} ${BED.foot.y} ${BED.foot.z} minecraft:red_bed[part=foot,facing=east]`);
    await paperCommand(`setblock ${BED.head.x} ${BED.head.y} ${BED.head.z} minecraft:red_bed[part=head,facing=east]`);
    await healthyHeldFixture(FIXTURES.sleep);
    await paperCommand('weather clear');
    await paperCommand('time set 13000');
    const beforeState = compactState(states[options.bot]);
    const paperBefore = await paperEntitySnapshot(runId, 'BEFORE', { sleep: true });
    const bedBefore = await bedProof(runId, 'BEFORE');
    const attempt = beginAttempt('sleep', attemptNumber);
    attempt.issuedAt = Date.now();
    activeAttempt = attempt;
    const releaseAck = await sendMessage(RELEASE_COMMAND);
    const sleepEntryState = await waitFor(
      () => attempt.sleepEntryState,
      Boolean,
      `${runId} canonical sleep entry`,
      35_000,
    );
    const paperDuring = await attempt.sleepEntryPaperPromise;
    const terminalState = await waitFor(
      () => attempt.terminalState,
      Boolean,
      `${runId} verified wake result`,
      45_000,
    );
    const terminal = terminalState.lastResult;
    const hold = await observeHeldWindow(attempt);
    const afterState = compactState(states[options.bot]);
    const paperAfter = await paperEntitySnapshot(runId, 'AFTER', { sleep: true });
    const bedAfter = await bedProof(runId, 'AFTER');
    const traces = tracesFor(attempt);
    const linked = linkedActionTraces(traces, terminal, 'survival');
    const selections = traces.filter(trace => trace?.winner?.lane === 'basic_survival');
    const unrelatedWork = attempt.samples.filter(sample => activeWorkOrder(sample.jobDirector));
    const passed = isNight(beforeState.timeOfDay)
      && isNight(paperBefore.timeOfDay)
      && bedBefore.parts === 2
      && sleepEntryState.sleeping
      && paperDuring.sleepTimer > 0
      && paperDuring.sleepingPosition !== null
      && terminal.phase === 'succeeded'
      && terminal.code === 'skill_slept'
      && terminal.label === 'action:goToBed'
      && terminal.target?.name?.endsWith('_bed')
      && terminalState.sleeping === false
      && afterState.sleeping === false
      && !isNight(afterState.timeOfDay)
      && !isNight(paperAfter.timeOfDay)
      && Number(paperAfter.sleepTimer) === 0
      && bedAfter.parts === 2
      && selections.length > 0
      && linked.length > 0
      && unrelatedWork.length === 0
      && hold.latencyMs <= 2_000
      && hold.durationMs >= HOLD_WINDOW_MS
      && hold.stable;
    activeAttempt = null;
    return {
      runId,
      attempt: attemptNumber,
      releaseAck,
      beforeState,
      sleepEntryState,
      terminalState,
      afterState,
      terminal,
      paper: { before: paperBefore, during: paperDuring, after: paperAfter, bedBefore, bedAfter },
      ownership: {
        expected: 'survival',
        survivalDecisionIds: selections.map(trace => trace.decisionId),
        linkedDecisionIds: linked.map(trace => trace.decisionId),
        unrelatedWorkObserved: unrelatedWork.length,
      },
      hold,
      outputs: attempt.outputs,
      samples: attempt.samples,
      traces,
      passed,
    };
  };

  const runShelterAttempt = async attemptNumber => {
    const runId = `SHL-R${attemptNumber}`;
    await preparePlatform(FIXTURES.shelter, 6);
    await healthyHeldFixture(FIXTURES.shelter);
    const controlledInventory = Object.fromEntries(BUILDING_MATERIALS.map(item => [item, 0]));
    controlledInventory[SHELTER_MATERIAL] = EMERGENCY_SHELTER_BLUEPRINT.cells.length;
    await setItemCounts(controlledInventory);
    await paperCommand(`effect give ${options.bot} minecraft:saturation 600 255 true`);
    await paperCommand('time set 13000');
    await paperCommand('weather thunder 600');
    const beforeState = compactState(states[options.bot]);
    const paperBefore = await blueprintProof(runId, 'BEFORE');
    const attempt = beginAttempt('shelter', attemptNumber);
    attempt.issuedAt = Date.now();
    activeAttempt = attempt;
    const releaseAck = await sendMessage(RELEASE_COMMAND);
    const firstOrderState = await waitFor(
      () => attempt.workOrderFirstState,
      Boolean,
      `${runId} survival work-order ownership`,
      25_000,
    );
    controlledOrderIds.add(attempt.workOrderId);
    const terminalState = await waitFor(
      () => attempt.terminalState,
      Boolean,
      `${runId} completed emergency shelter`,
      240_000,
    );
    const hold = await observeHeldWindow(attempt);
    const afterState = compactState(states[options.bot]);
    const paperAfter = await blueprintProof(runId, 'AFTER');
    const traces = tracesFor(attempt);
    const survivalJobTraces = traces.filter(trace => traceLane(trace, 'survival_job')?.status === 'eligible');
    const results = [...attempt.resultMap.values()];
    const placements = results.filter(result => (
      result.label === 'action:placeBlockAt'
      && result.phase === 'succeeded'
      && result.code === 'skill_placed'
    ));
    const linkedPlacementIds = new Set();
    for (const placement of placements) {
      if (linkedActionTraces(traces, placement, 'job').length) linkedPlacementIds.add(placement.actionId);
    }
    const observedOrders = attempt.samples
      .map(sample => sample.jobDirector?.workOrder)
      .filter(order => order?.id === attempt.workOrderId);
    const terminalOrder = terminalState.jobDirector?.workOrder;
    const requested = attempt.samples.some(sample => (
      sample.survivalDirector?.code === 'emergency_shelter_requested'
      || sample.survivalDirector?.phase === 'requested'
    ));
    const bounded = Number(terminalOrder?.attempts) <= Number(terminalOrder?.maxAttempts)
      && Date.now() - attempt.issuedAt <= 240_000
      && results.length <= 40;
    const passed = paperBefore.correct === 0
      && paperBefore.openDoorCells === 2
      && firstOrderState.jobDirector?.workOrder?.source === 'survival'
      && firstOrderState.jobDirector?.workOrder?.requester === options.bot
      && firstOrderState.jobDirector?.workOrder?.kind === 'emergency_shelter'
      && requested
      && observedOrders.length > 0
      && observedOrders.every(order => order.source === 'survival' && order.requester === options.bot)
      && terminalState.jobDirector?.phase === 'complete'
      && terminalState.jobDirector?.code === 'blueprint_complete'
      && terminalOrder?.id === attempt.workOrderId
      && terminalOrder?.source === 'survival'
      && terminalOrder?.requester === options.bot
      && terminalOrder?.phase === 'complete'
      && Number(terminalOrder?.checkpoint?.verifiedCount) === EMERGENCY_SHELTER_BLUEPRINT.cells.length
      && paperAfter.correct === EMERGENCY_SHELTER_BLUEPRINT.cells.length
      && paperAfter.openDoorCells === 2
      && paperAfter.materialCount === 0
      && survivalJobTraces.length > 0
      && placements.length > 0
      && linkedPlacementIds.size > 0
      && bounded
      && hold.latencyMs <= 2_000
      && hold.durationMs >= HOLD_WINDOW_MS
      && hold.stable;
    activeAttempt = null;
    return {
      runId,
      attempt: attemptNumber,
      releaseAck,
      beforeState,
      firstOrderState,
      terminalState,
      afterState,
      workOrderId: attempt.workOrderId,
      paper: { before: paperBefore, after: paperAfter },
      execution: {
        requested,
        resultCount: results.length,
        placementCount: placements.length,
        linkedPlacementCount: linkedPlacementIds.size,
        bounded,
        results,
      },
      ownership: {
        expectedSource: 'survival',
        expectedRequester: options.bot,
        survivalJobDecisionIds: survivalJobTraces.map(trace => trace.decisionId),
      },
      hold,
      outputs: attempt.outputs,
      samples: attempt.samples,
      traces,
      passed,
    };
  };

  const runScenario = async (name, operation) => {
    const result = { scenario: name, attempts: [], passed: false };
    for (let attemptNumber = 1; attemptNumber <= options.attempts; attemptNumber += 1) {
      try {
        const attempt = await operation(attemptNumber);
        result.attempts.push(attempt);
        if (!attempt.passed) break;
      } catch (error) {
        const failedAttempt = activeAttempt;
        if (failedAttempt) triggerStop(failedAttempt);
        result.attempts.push({
          runId: failedAttempt?.runId || `${name}-R${attemptNumber}`,
          attempt: attemptNumber,
          error: String(error?.stack || error?.message || error).slice(0, 4_000),
          samples: failedAttempt?.samples || [],
          outputs: failedAttempt?.outputs || [],
          traces: failedAttempt ? tracesFor(failedAttempt) : [],
          passed: false,
        });
        if (failedAttempt?.stopPromise) {
          try { await failedAttempt.stopPromise; } catch { /* recorded in the attempt */ }
        }
        try { await waitForHeld(0, 20_000); } catch { /* outer cleanup will retry */ }
        activeAttempt = null;
        break;
      }
    }
    result.passed = result.attempts.length === options.attempts
      && result.attempts.every(attempt => attempt.passed);
    evidence.results[name] = result;
    return result;
  };

  const detachProtectedJob = async () => {
    originalJobBytes = await readOptional(jobStatePath);
    originalJobExists = originalJobBytes !== null;
    jobStateCaptured = true;
    let diskOrder = null;
    if (originalJobBytes) {
      const document = JSON.parse(originalJobBytes.toString('utf8'));
      diskOrder = document?.activeOrder || null;
    }
    const state = compactState(states[options.bot]);
    const publicOrder = activeWorkOrder(state.jobDirector);
    evidence.isolation.protectedJob = {
      file: jobStatePath,
      existed: originalJobExists,
      sha256: originalJobBytes ? hashBytes(originalJobBytes) : null,
      diskOrder: diskOrder ? {
        id: diskOrder.id,
        kind: diskOrder.kind,
        source: diskOrder.source,
        requester: diskOrder.requester,
        phase: diskOrder.phase,
        target: diskOrder.target,
      } : null,
      publicOrder,
      detached: false,
      restored: false,
    };
    if (!diskOrder && !publicOrder) return;
    if (!diskOrder || !publicOrder || diskOrder.id !== publicOrder.id) {
      throw new Error(`Persisted/public work-order mismatch: ${JSON.stringify({ diskOrder, publicOrder })}`);
    }
    const cancelAck = await sendMessage('!cancelJob');
    requestSnapshot();
    const cancelledState = await waitFor(
      () => compactState(states[options.bot]),
      candidate => candidate.jobDirector?.workOrder?.id === diskOrder.id
        && candidate.jobDirector?.workOrder?.phase === 'cancelled'
        && candidate.jobDirector?.phase === 'cancelled',
      `protected work order ${diskOrder.id} cancellation`,
      15_000,
    );
    await waitFor(
      async () => {
        const bytes = await readOptional(jobStatePath);
        if (!bytes) return null;
        return JSON.parse(bytes.toString('utf8'));
      },
      document => document?.activeOrder == null,
      'detached job-state persistence',
      10_000,
    );
    jobStateWasDetached = true;
    evidence.isolation.protectedJob.cancelAck = cancelAck;
    evidence.isolation.protectedJob.cancelledState = cancelledState.jobDirector;
    evidence.isolation.protectedJob.detached = true;
  };

  const cancelControlledOrder = async () => {
    const bytes = await readOptional(jobStatePath);
    if (!bytes) return null;
    const document = JSON.parse(bytes.toString('utf8'));
    const order = document?.activeOrder;
    if (!order) return null;
    const shelter = FIXTURES.shelter;
    const belongsToFixture = order.source === 'survival'
      && order.kind === 'emergency_shelter'
      && order.requester === options.bot
      && Number(order.target?.x) === Math.floor(shelter.x)
      && Number(order.target?.y) === Math.floor(shelter.y)
      && Number(order.target?.z) === Math.floor(shelter.z);
    if (!controlledOrderIds.has(order.id) && !belongsToFixture) {
      throw new Error(`Refusing to cancel unrelated work order ${order.id}.`);
    }
    controlledOrderIds.add(order.id);
    const ack = await sendMessage('!cancelJob');
    await waitFor(
      async () => {
        const current = await readOptional(jobStatePath);
        return current ? JSON.parse(current.toString('utf8')) : null;
      },
      current => current?.activeOrder == null,
      `controlled work order ${order.id} cancellation`,
      10_000,
    );
    return { id: order.id, ack };
  };

  const restoreJobState = async () => {
    if (originalJobExists) {
      await writeFile(jobStatePath, originalJobBytes);
    } else {
      try {
        await unlink(jobStatePath);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    const restored = await readOptional(jobStatePath);
    const restoredHash = restored ? hashBytes(restored) : null;
    const expectedHash = originalJobBytes ? hashBytes(originalJobBytes) : null;
    if (restoredHash !== expectedHash) throw new Error('Protected job-state bytes were not restored exactly.');
    if (evidence.isolation.protectedJob) {
      evidence.isolation.protectedJob.restored = true;
      evidence.isolation.protectedJob.restoredSha256 = restoredHash;
    }
  };

  try {
    const [health, agents, minecraft] = await Promise.all([
      fetchJson(options.url, '/api/health'),
      fetchJson(options.url, '/api/agents'),
      fetchJson(options.url, '/api/minecraft-server'),
    ]);
    const agent = agents?.agents?.find(entry => entry?.name === options.bot);
    if (health?.checks?.minecraftReachable !== true || minecraft?.server?.phase !== 'running') {
      throw new Error('Paper is not reachable and running.');
    }
    if (agent?.state !== 'running' || agent?.in_game !== true || agent?.socket_connected !== true || agent?.readiness !== 'world_ready') {
      throw new Error(`${options.bot} must already be world-ready: ${JSON.stringify(agent)}`);
    }
    const otherActive = agents.agents.filter(entry => entry?.name !== options.bot && entry?.in_game === true);
    if (otherActive.length) throw new Error(`Other bots are active: ${otherActive.map(entry => entry.name).join(', ')}`);

    socket = await connectDashboard(options.url);
    const receiveState = payload => {
      const applied = applyStateUpdate(states, revisions, payload);
      states = applied.states;
      revisions = applied.revisions;
      if (applied.resyncRequired) {
        if (activeAttempt) activeAttempt.resyncRequests += 1;
        requestSnapshot();
      }
      const state = states[options.bot];
      if (!state || !activeAttempt) return;
      const compact = compactState(state);
      const signature = JSON.stringify([
        compact.sampledAt,
        compact.current,
        compact.sleeping,
        compact.lastResult?.actionId,
        compact.jobDirector?.workOrder?.id,
        compact.jobDirector?.workOrder?.phase,
      ]);
      if (activeAttempt.lastSampleSignature !== signature && activeAttempt.samples.length < 2_000) {
        activeAttempt.lastSampleSignature = signature;
        activeAttempt.samples.push(structuredClone(compact));
      }
      const result = compact.lastResult;
      if (result?.actionId && Number(result.startedAt) >= activeAttempt.issuedAt) {
        activeAttempt.resultMap.set(result.actionId, structuredClone(result));
      }
      for (const trace of state?.action?.behaviorArbiter?.decisionTrace?.recent || []) {
        if (!trace?.decisionId || Number(trace.wallClockTimestamp) < activeAttempt.issuedAt - 2_000) continue;
        if (activeAttempt.traceMap.size < 1_024 || activeAttempt.traceMap.has(trace.decisionId)) {
          activeAttempt.traceMap.set(trace.decisionId, structuredClone(trace));
        }
      }
      if (activeAttempt.kind === 'hunger' && !activeAttempt.terminalState && (
        result?.label === 'action:consume'
        && Number(result.startedAt) >= activeAttempt.issuedAt
        && ['succeeded', 'failed', 'interrupted', 'blocked'].includes(result.phase)
      )) {
        activeAttempt.terminalState = structuredClone(compact);
        triggerStop(activeAttempt);
      }
      if (activeAttempt.kind === 'sleep') {
        if (compact.sleeping && !activeAttempt.sleepEntryState) {
          activeAttempt.sleepEntryState = structuredClone(compact);
          activeAttempt.sleepEntryPaperPromise = paperEntitySnapshot(activeAttempt.runId, 'DURING', { sleep: true });
        }
        if (!activeAttempt.terminalState && (
          result?.label === 'action:goToBed'
          && Number(result.startedAt) >= activeAttempt.issuedAt
          && ['succeeded', 'failed', 'interrupted', 'blocked'].includes(result.phase)
        )) {
          activeAttempt.terminalState = structuredClone(compact);
          triggerStop(activeAttempt);
        }
      }
      if (activeAttempt.kind === 'shelter') {
        const order = compact.jobDirector?.workOrder;
        if (
          order?.source === 'survival'
          && order?.kind === 'emergency_shelter'
          && order?.requester === options.bot
          && !activeAttempt.workOrderId
        ) {
          activeAttempt.workOrderId = order.id;
          activeAttempt.workOrderFirstState = structuredClone(compact);
          controlledOrderIds.add(order.id);
        }
        if (
          !activeAttempt.terminalState
          && activeAttempt.workOrderId
          && order?.id === activeAttempt.workOrderId
          && order?.phase === 'complete'
          && compact.jobDirector?.phase === 'complete'
        ) {
          activeAttempt.terminalState = structuredClone(compact);
          triggerStop(activeAttempt);
        }
      }
    };
    socket.on('state-update', receiveState);
    socket.on('state-delta', receiveState);
    socket.on('bot-output', (agentName, output) => {
      if (agentName === options.bot && activeAttempt && activeAttempt.outputs.length < 256) {
        activeAttempt.outputs.push({ at: Date.now(), output: String(output).slice(0, 1_000) });
      }
    });
    socket.emit('listen-to-agents');
    requestSnapshot();
    await waitFor(() => states[options.bot] || null, Boolean, `${options.bot} canonical state`, 15_000);
    originalState = compactState(states[options.bot]);
    originalInventory = { ...originalState.inventory };
    evidence.isolation.originalState = originalState;
    evidence.isolation.originalInventory = originalInventory;

    if (!originalState.held || !originalState.idle || originalState.pathfinding) {
      const stopAck = await sendStop();
      await waitForHeld(Number(stopAck?.acceptedAt) || Date.now());
    }

    originalMobSpawning = (await readGamerule('spawn_mobs')).value;
    originalSleepingPercentage = (await readGamerule('players_sleeping_percentage')).value;
    evidence.isolation.gamerules = {
      spawn_mobs: { before: originalMobSpawning, during: false, restored: false },
      players_sleeping_percentage: { before: originalSleepingPercentage, during: 1, restored: false },
    };
    await paperCommand('gamerule spawn_mobs false');
    await paperCommand('gamerule players_sleeping_percentage 1');
    if ((await readGamerule('spawn_mobs')).value !== false) throw new Error('Could not disable natural mob spawning.');
    if ((await readGamerule('players_sleeping_percentage')).value !== 1) {
      throw new Error('Could not isolate the safe-sleep threshold.');
    }

    await paperCommand(`scoreboard objectives remove ${OBJECTIVE}`);
    await paperCommand(`scoreboard objectives add ${OBJECTIVE} dummy`);
    await detachProtectedJob();

    for (const name of options.scenarios) {
      if (name === 'hunger') {
        await runScenario(name, runHungerAttempt);
        await setItemCounts({ [FOOD]: originalInventory[FOOD] });
      } else if (name === 'sleep') {
        await runScenario(name, runSleepAttempt);
      } else if (name === 'shelter') {
        await runScenario(name, runShelterAttempt);
        await paperCommand(`effect clear ${options.bot} minecraft:saturation`);
        await setItemCounts(Object.fromEntries(BUILDING_MATERIALS.map(item => [item, originalInventory[item]])));
      }
    }
    evidence.passed = options.scenarios.every(name => evidence.results[name]?.passed === true);
  } catch (error) {
    evidence.error = String(error?.stack || error?.message || error).slice(0, 8_000);
    evidence.passed = false;
  } finally {
    const cleanup = { held: null, autonomy: null, errors: [] };
    if (socket?.connected) {
      try {
        if (activeAttempt) triggerStop(activeAttempt);
        if (activeAttempt?.stopPromise) await activeAttempt.stopPromise;
        let held = compactState(states[options.bot]).held;
        if (!held) {
          const stopAck = await sendStop();
          await waitForHeld(Number(stopAck?.acceptedAt) || Date.now());
        } else {
          await waitForHeld();
        }
      } catch (error) {
        cleanup.errors.push(`stop: ${String(error?.message || error)}`);
      }
      try {
        cleanup.controlledOrderCancellation = await cancelControlledOrder();
      } catch (error) {
        cleanup.errors.push(`controlled job: ${String(error?.message || error)}`);
      }
      try {
        if (originalInventory) await setItemCounts(originalInventory);
      } catch (error) {
        cleanup.errors.push(`inventory: ${String(error?.message || error)}`);
      }
      try {
        if (originalState?.position) {
          await paperCommand(`tp ${options.bot} ${originalState.position.x} ${originalState.position.y} ${originalState.position.z}`);
        }
        if (originalState?.gamemode) await paperCommand(`gamemode ${originalState.gamemode} ${options.bot}`);
        await paperCommand(`effect clear ${options.bot} minecraft:hunger`);
        await paperCommand(`effect clear ${options.bot} minecraft:saturation`);
      } catch (error) {
        cleanup.errors.push(`bot fixture: ${String(error?.message || error)}`);
      }
      for (const [name, fixture] of Object.entries(FIXTURES)) {
        try {
          await clearPlatform(fixture, name === 'shelter' ? 6 : 5);
        } catch (error) {
          cleanup.errors.push(`${name} blocks: ${String(error?.message || error)}`);
        }
      }
      try {
        if (Number.isFinite(Number(originalState?.timeOfDay))) {
          await paperCommand(`time set ${Math.floor(Number(originalState.timeOfDay))}`);
        }
        const weatherCommand = originalState?.weather === 'Thunderstorm'
          ? 'weather thunder'
          : originalState?.weather === 'Rain' ? 'weather rain' : 'weather clear';
        await paperCommand(weatherCommand);
        if (originalMobSpawning !== null) await paperCommand(`gamerule spawn_mobs ${originalMobSpawning}`);
        if (originalSleepingPercentage !== null) {
          await paperCommand(`gamerule players_sleeping_percentage ${originalSleepingPercentage}`);
        }
        if (evidence.isolation.gamerules) {
          evidence.isolation.gamerules.spawn_mobs.restored = (await readGamerule('spawn_mobs')).value === originalMobSpawning;
          evidence.isolation.gamerules.players_sleeping_percentage.restored = (
            (await readGamerule('players_sleeping_percentage')).value === originalSleepingPercentage
          );
        }
      } catch (error) {
        cleanup.errors.push(`world controls: ${String(error?.message || error)}`);
      }
      try {
        await paperCommand(`scoreboard objectives remove ${OBJECTIVE}`);
      } catch (error) {
        cleanup.errors.push(`scoreboard: ${String(error?.message || error)}`);
      }
      try {
        const currentAutonomy = compactState(states[options.bot]).autonomy;
        if (originalState?.autonomy && currentAutonomy !== originalState.autonomy) {
          await sendMessage(`!setAutonomy(${JSON.stringify(originalState.autonomy)})`);
        }
        if (originalState?.held) {
          const stopAck = await sendStop();
          await waitForHeld(Number(stopAck?.acceptedAt) || Date.now());
        } else if (compactState(states[options.bot]).held) {
          await sendMessage(`!setAutonomy(${JSON.stringify(originalState?.autonomy || 'command')})`);
          await waitFor(
            () => compactState(states[options.bot]),
            state => state.held === false && state.autonomy === originalState?.autonomy,
            'original released hold state',
            10_000,
          );
        }
      } catch (error) {
        cleanup.errors.push(`autonomy/hold: ${String(error?.message || error)}`);
      }
      try {
        if (jobStateCaptured) await restoreJobState();
      } catch (error) {
        cleanup.errors.push(`protected job restore: ${String(error?.message || error)}`);
      }
      const finalState = compactState(states[options.bot]);
      cleanup.held = finalState.held;
      cleanup.autonomy = finalState.autonomy;
      cleanup.position = finalState.position;
      cleanup.inventory = finalState.inventory;
      cleanup.protectedJobRestored = evidence.isolation.protectedJob?.restored === true
        || (!jobStateWasDetached && !originalJobExists);
      socket.close();
    }
    evidence.cleanup = cleanup;
    if (cleanup.errors.length) evidence.passed = false;
    evidence.finishedAt = Date.now();
    evidence.durationMs = evidence.finishedAt - evidence.startedAt;
    await mkdir(dirname(options.evidence), { recursive: true });
    await writeFile(options.evidence, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  }

  const summary = {
    passed: evidence.passed,
    error: evidence.error,
    durationMs: evidence.durationMs,
    scenarios: Object.fromEntries(Object.entries(evidence.results).map(([name, result]) => [name, {
      passed: result.passed,
      attempts: result.attempts.map(attempt => ({
        runId: attempt.runId,
        passed: attempt.passed,
        error: attempt.error || null,
        terminal: attempt.terminal ? `${attempt.terminal.phase}:${attempt.terminal.code}` : null,
        workOrderId: attempt.workOrderId || null,
        stopLatencyMs: attempt.hold?.latencyMs ?? null,
        stableForTenSeconds: attempt.hold?.stable ?? false,
      })),
    }])),
    cleanup: evidence.cleanup,
    evidence: options.evidence,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!evidence.passed) process.exitCode = 1;
}

run().catch(error => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
