import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

import mineflayer from 'mineflayer';
import pf from 'mineflayer-pathfinder';
import { io } from 'socket.io-client';
import Vec3 from 'vec3';

import { applyStateUpdate } from '../src/mindcraft/public/js/agent-state-protocol.js';

const BOT_START = Object.freeze({ x: 1027.5, y: 100, z: 1008.5 });
const TARGET_START = Object.freeze({ x: 1029.5, y: 100, z: 1008.5 });
const WAYPOINTS = Object.freeze([
  Object.freeze({ name: 'east-through-doorway', x: 1038.5, y: 100, z: 1008.5 }),
  Object.freeze({ name: 'south-after-first-turn', x: 1038.5, y: 100, z: 1014.5 }),
  Object.freeze({ name: 'west-up-one-block', x: 1029.5, y: 101, z: 1014.5 }),
]);
const COURSE = Object.freeze({ x1: 1026, x2: 1040, y1: 100, y2: 102, z1: 1006, z2: 1016 });
const WALL = Object.freeze({ x: 1033, y1: 100, y2: 102, z1: 1006, z2: 1012 });
const DOORWAY = Object.freeze({ x: 1033, y1: 100, y2: 101, z: 1008 });
const PLATFORM = Object.freeze({ x1: 1028, x2: 1034, y: 100, z1: 1013, z2: 1015 });
const OBJECTIVE = 'fol001proof';
const COMMAND = '!followPlayer("FollowTarget", 3)';
const POLL_MS = 100;
const TARGET_NAME = 'FollowTarget';

function parseArgs(argv) {
  const options = {
    url: '',
    bot: 'MindcraftBot',
    attempts: 1,
    evidence: '',
    mode: 'follow',
    naturalLanguage: false,
    authorized: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--url') options.url = String(argv[++index] || '');
    else if (value === '--bot') options.bot = String(argv[++index] || '');
    else if (value === '--attempts') options.attempts = Number(argv[++index]);
    else if (value === '--evidence') options.evidence = String(argv[++index] || '');
    else if (value === '--mode') options.mode = String(argv[++index] || '');
    else if (value === '--natural-language') options.naturalLanguage = true;
    else if (value === '--authorized-active-world') options.authorized = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!options.url || !options.evidence) throw new Error('--url and --evidence are required.');
  if (!options.authorized) throw new Error('Live fixture mutation requires --authorized-active-world.');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(options.bot)) throw new Error('Invalid bot name.');
  if (!Number.isInteger(options.attempts) || options.attempts < 1 || options.attempts > 3) {
    throw new Error('Attempts must be an integer from 1 through 3.');
  }
  if (!['follow', 'stop'].includes(options.mode)) throw new Error('Mode must be follow or stop.');
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
    await delay(POLL_MS);
  }
  throw new Error(`Timed out waiting for ${description}. Last observation: ${JSON.stringify(latest)}`);
}

async function withTimeout(operation, timeoutMs, description, onTimeout = () => {}) {
  let timer = null;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          try { onTimeout(); } catch { /* best-effort cancellation */ }
          reject(new Error(`Timed out waiting for ${description}.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
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

function positionOf(entity) {
  const position = entity?.position;
  if (![position?.x, position?.y, position?.z].every(Number.isFinite)) return null;
  return { x: position.x, y: position.y, z: position.z };
}

function distance(left, right) {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  return Math.hypot(
    Number(left.x) - Number(right.x),
    Number(left.y) - Number(right.y),
    Number(left.z) - Number(right.z),
  );
}

function trajectoryDistance(samples) {
  let travelled = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const segment = distance(samples[index - 1]?.position, samples[index]?.position);
    // Every recorded sample begins after the measured action is issued; fixture
    // teleports happen before this buffer exists. Canonical delivery may
    // legitimately coalesce several blocks of ordinary movement into one edge.
    if (Number.isFinite(segment)) travelled += segment;
  }
  return travelled;
}

function actuatorVelocityIsQuiescent(state) {
  const horizontalSpeed = Math.hypot(
    Number(state?.velocity?.x) || 0,
    Number(state?.velocity?.z) || 0,
  );
  const verticalSpeed = Math.abs(Number(state?.velocity?.y) || 0);
  // Mineflayer retains gravity's -0.08 Y velocity while an entity is firmly
  // grounded. Treat that protocol sentinel as quiescent only when onGround is
  // independently true; horizontal motion remains tightly bounded.
  return horizontalSpeed <= 0.05
    && (verticalSpeed <= 0.05 || (state?.onGround === true && verticalSpeed <= 0.09));
}

function compactResult(result) {
  if (!result) return null;
  return {
    actionId: result.actionId || null,
    phase: result.phase,
    code: result.code,
    label: result.label,
    detail: result.detail,
    target: result.target || null,
    evidence: result.evidence || null,
    durationMs: result.durationMs,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
  };
}

function compactState(state) {
  return {
    sampledAt: Number(state?._meta?.sampledAt) || Date.now(),
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
    companion: state?.companion || null,
    hostiles: (state?.perception?.hostiles || []).map(hostile => ({
      name: hostile?.name || null,
      entityId: hostile?.entityId ?? null,
      distance: hostile?.distance ?? null,
      position: hostile?.position || null,
    })),
    lastResult: compactResult(state?.action?.lastResult),
  };
}

function marker(runId, phase, fact) {
  return `#${`${runId}_${phase}_${fact}`.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

function markerObserved(lines, value) {
  return lines.some(line => String(line).includes(`Set [${OBJECTIVE}] for ${value} to 1`));
}

function paperPosition(lines, playerName) {
  // eslint-disable-next-line no-control-regex
  const clean = lines.map(line => String(line).replace(/\u001b\[[0-9;]*m/g, ''));
  for (const line of clean.reverse()) {
    if (!line.includes(`${playerName} has the following entity data:`)) continue;
    const match = line.match(/\[(-?\d+(?:\.\d+)?)d?,\s*(-?\d+(?:\.\d+)?)d?,\s*(-?\d+(?:\.\d+)?)d?\]/i);
    if (match) return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
  }
  return null;
}

function blockState(block) {
  if (!block?.name) throw new Error('Cannot preserve an unloaded block.');
  const properties = block.getProperties?.() || {};
  const serialized = Object.entries(properties)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${String(value)}`);
  return `minecraft:${block.name}${serialized.length ? `[${serialized.join(',')}]` : ''}`;
}

function compressFixture(entries) {
  const byCoordinate = new Map(entries.map(entry => [`${entry.x},${entry.y},${entry.z}`, entry.state]));
  const runs = [];
  for (let y = COURSE.y1; y <= COURSE.y2; y += 1) {
    for (let z = COURSE.z1; z <= COURSE.z2; z += 1) {
      let startX = COURSE.x1;
      let state = byCoordinate.get(`${startX},${y},${z}`);
      for (let x = COURSE.x1 + 1; x <= COURSE.x2 + 1; x += 1) {
        const next = x <= COURSE.x2 ? byCoordinate.get(`${x},${y},${z}`) : null;
        if (next === state) continue;
        runs.push({ x1: startX, x2: x - 1, y, z, state });
        startX = x;
        state = next;
      }
    }
  }
  return runs;
}

function createControlledTarget(eventLog) {
  return new Promise((resolvePromise, reject) => {
    const target = mineflayer.createBot({
      host: '127.0.0.1',
      port: 25579,
      username: TARGET_NAME,
      auth: 'offline',
      checkTimeoutInterval: 60_000,
    });
    target.loadPlugin(pf.pathfinder);
    const timeout = setTimeout(() => {
      target.end();
      reject(new Error(`${TARGET_NAME} did not spawn within 15 seconds.`));
    }, 15_000);
    target.once('spawn', () => {
      clearTimeout(timeout);
      eventLog.push({ at: Date.now(), event: 'spawn', position: positionOf(target.entity), version: target.version });
      resolvePromise(target);
    });
    target.on('kicked', reason => eventLog.push({ at: Date.now(), event: 'kicked', reason: String(reason).slice(0, 500) }));
    target.on('end', reason => eventLog.push({ at: Date.now(), event: 'end', reason: String(reason).slice(0, 500) }));
    target.on('error', error => {
      eventLog.push({ at: Date.now(), event: 'error', error: String(error?.stack || error).slice(0, 1_000) });
    });
  });
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const evidence = {
    schemaVersion: 1,
    scenario: options.mode === 'follow'
      ? 'follow-controlled-player-through-course'
      : 'stop-during-active-follow',
    route: options.naturalLanguage ? 'natural-language-player-chat' : 'typed-dashboard-command',
    command: options.naturalLanguage ? 'FollowTarget chat: follow me' : COMMAND,
    bot: options.bot,
    controlledTarget: {
      name: TARGET_NAME,
      kind: 'temporary-mineflayer-client',
      model: false,
      profile: false,
      scheduler: false,
      events: [],
    },
    fixture: { course: COURSE, botStart: BOT_START, targetStart: TARGET_START, wall: WALL, doorway: DOORWAY, platform: PLATFORM, waypoints: WAYPOINTS },
    startedAt: Date.now(),
    attempts: [],
    passed: false,
    error: null,
    cleanup: null,
  };
  let socket = null;
  let target = null;
  let targetSampler = null;
  let targetPathListener = null;
  let states = {};
  let revisions = {};
  let activeAttempt = null;
  let baselineRuns = null;
  let fixtureMutated = false;
  let previousMobSpawning = null;
  let mobSpawningMutated = false;

  const paperCommand = command => fetchJson(options.url, '/api/minecraft-server/command', {
    method: 'POST',
    body: JSON.stringify({ command }),
  });

  const readBooleanGamerule = async name => {
    const command = `gamerule ${name}`;
    await paperCommand(command);
    const observation = await waitFor(
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
    return observation;
  };

  const sendMessage = async message => {
    const result = await emitAcknowledged(socket, 'send-message', [options.bot, { message }]);
    if (result?.success !== true) throw new Error(`Bot command was rejected: ${JSON.stringify(result)}`);
    return result;
  };

  const waitForHeld = (sampledAfter = 0, timeoutMs = 20_000) => waitFor(
    () => states[options.bot] || null,
    state => {
      const compact = compactState(state);
      return compact.sampledAt >= sampledAfter
        && compact.held
        && compact.idle
        && !compact.pathfinding
        && actuatorVelocityIsQuiescent(compact);
    },
    `${options.bot} held actuator quiescence`,
    timeoutMs,
  );

  const paperSnapshot = async (runId, phase) => {
    const begin = marker(runId, phase, 'BEGIN');
    const end = marker(runId, phase, 'END');
    const wall = marker(runId, phase, 'WALL');
    const opening = marker(runId, phase, 'OPEN');
    const step = marker(runId, phase, 'STEP');
    await paperCommand(`scoreboard players set ${begin} ${OBJECTIVE} 1`);
    await paperCommand(`data get entity ${options.bot} Pos`);
    await paperCommand(`data get entity ${TARGET_NAME} Pos`);
    await paperCommand(`execute if block 1033 100 1007 minecraft:stone_bricks run scoreboard players set ${wall} ${OBJECTIVE} 1`);
    await paperCommand(`execute if block 1033 100 1008 minecraft:air run scoreboard players set ${opening} ${OBJECTIVE} 1`);
    await paperCommand(`execute if block 1030 100 1014 minecraft:smooth_stone run scoreboard players set ${step} ${OBJECTIVE} 1`);
    await paperCommand(`scoreboard players set ${end} ${OBJECTIVE} 1`);
    await delay(250);
    const status = await fetchJson(options.url, '/api/minecraft-server');
    const lines = Array.isArray(status?.server?.logs) ? status.server.logs : [];
    const first = lines.findIndex(line => String(line).includes(begin));
    const last = lines.findLastIndex(line => String(line).includes(end));
    if (first < 0 || last < first) throw new Error(`Paper markers missing for ${runId}-${phase}.`);
    const window = lines.slice(first, last + 1);
    return {
      botPosition: paperPosition(window, options.bot),
      targetPosition: paperPosition(window, TARGET_NAME),
      wallVerified: markerObserved(window, wall),
      doorwayVerified: markerObserved(window, opening),
      platformVerified: markerObserved(window, step),
      lines: window,
    };
  };

  const restoreFixture = async () => {
    if (!baselineRuns) return;
    await paperCommand(`fill ${COURSE.x1} ${COURSE.y1} ${COURSE.z1} ${COURSE.x2} ${COURSE.y2} ${COURSE.z2} air`);
    for (const run of baselineRuns) {
      if (run.state === 'minecraft:air') continue;
      await paperCommand(`fill ${run.x1} ${run.y} ${run.z} ${run.x2} ${run.y} ${run.z} ${run.state}`);
    }
    fixtureMutated = false;
  };

  const provisionFixture = async () => {
    await restoreFixture();
    fixtureMutated = true;
    const commands = [
      `fill ${COURSE.x1} ${COURSE.y1} ${COURSE.z1} ${COURSE.x2} ${COURSE.y2} ${COURSE.z2} air`,
      `fill ${WALL.x} ${WALL.y1} ${WALL.z1} ${WALL.x} ${WALL.y2} ${WALL.z2} stone_bricks`,
      `fill ${DOORWAY.x} ${DOORWAY.y1} ${DOORWAY.z} ${DOORWAY.x} ${DOORWAY.y2} ${DOORWAY.z} air`,
      `fill ${PLATFORM.x1} ${PLATFORM.y} ${PLATFORM.z1} ${PLATFORM.x2} ${PLATFORM.y} ${PLATFORM.z2} smooth_stone`,
      // The acceptance fixture must not be preempted by a natural mob from an
      // adjacent prior test. This bounded margin contains no player entities;
      // both the companion and controlled target are preserved by type.
      'kill @e[type=!player,x=1020,y=94,z=1000,dx=30,dy=12,dz=24]',
      `gamemode survival ${options.bot}`,
      `gamemode survival ${TARGET_NAME}`,
      `tp ${options.bot} ${BOT_START.x} ${BOT_START.y} ${BOT_START.z}`,
      `tp ${TARGET_NAME} ${TARGET_START.x} ${TARGET_START.y} ${TARGET_START.z}`,
      `effect give ${options.bot} minecraft:instant_health 1 4 true`,
      `effect give ${options.bot} minecraft:saturation 180 1 true`,
      `effect give ${TARGET_NAME} minecraft:instant_health 1 4 true`,
      `effect give ${TARGET_NAME} minecraft:saturation 180 1 true`,
    ];
    for (const command of commands) await paperCommand(command);
    target.pathfinder.stop();
    target.clearControlStates();
    await waitFor(
      () => positionOf(target.entity),
      position => distance(position, TARGET_START) <= 0.3,
      `${TARGET_NAME} reset position`,
      15_000,
    );
    await waitFor(
      () => states[options.bot] || null,
      state => {
        const compact = compactState(state);
        return compact.held
          && compact.idle
          && !compact.pathfinding
          && compact.health >= 19
          && compact.hunger >= 19
          && compact.hostiles.length === 0
          && distance(compact.position, BOT_START) <= 0.3;
      },
      `${options.bot} verified follow fixture reset`,
      15_000,
    );
    const movements = new pf.Movements(target);
    movements.canDig = false;
    movements.allow1by1towers = false;
    movements.allowParkour = false;
    movements.canOpenDoors = true;
    target.pathfinder.setMovements(movements);
  };

  const driveTarget = async waypoint => {
    const startedAt = Date.now();
    const gotoWaypoint = destination => withTimeout(
      target.pathfinder.goto(new pf.goals.GoalNear(destination.x, destination.y, destination.z, 0.25)),
      25_000,
      `${TARGET_NAME} physical movement to ${destination.name}`,
      () => target.pathfinder.stop(),
    );
    try {
      if (waypoint.name === 'west-up-one-block') {
        const staging = { name: 'elevation-staging', x: 1035.5, y: 100, z: 1014.5 };
        await gotoWaypoint(staging);
        await target.lookAt(new Vec3(1029.5, 101.62, 1014.5), true);
        const manualStartedAt = Date.now();
        target.setControlState('forward', true);
        target.setControlState('jump', true);
        try {
          const steppedPosition = await waitFor(
            () => positionOf(target.entity),
            position => Number(position?.y) >= 100.8 && Number(position?.x) <= 1034.9,
            `${TARGET_NAME} manual one-block ascent`,
            3_000,
          );
          activeAttempt.controlledElevation = {
            method: 'physical-forward-jump-controls',
            startedAt: manualStartedAt,
            completedAt: Date.now(),
            position: steppedPosition,
          };
        } finally {
          target.clearControlStates();
        }
        await delay(100);
      }
      await gotoWaypoint(waypoint);
    } catch (error) {
      activeAttempt.waypointFailure = {
        waypoint,
        startedAt,
        failedAt: Date.now(),
        finalPosition: positionOf(target.entity),
        recentPathUpdates: activeAttempt.targetPathUpdates.slice(-12),
        error: String(error?.stack || error),
      };
      throw error;
    }
    const reachedAt = Date.now();
    const observed = await waitFor(
      () => positionOf(target.entity),
      position => distance(position, waypoint) <= 0.8,
      `${TARGET_NAME} at ${waypoint.name}`,
      3_000,
    );
    const paper = await paperSnapshot(activeAttempt.runId, `W${activeAttempt.waypoints.length + 1}`);
    const record = { ...waypoint, startedAt, reachedAt, durationMs: reachedAt - startedAt, observed, paper };
    activeAttempt.waypoints.push(record);
    return record;
  };

  try {
    const health = await fetchJson(options.url, '/api/health');
    if (health?.checks?.minecraftReachable !== true) throw new Error('Paper is not reachable.');
    const agents = await fetchJson(options.url, '/api/agents');
    const agent = agents?.agents?.find(entry => entry?.name === options.bot);
    if (agent?.state !== 'running' || agent?.in_game !== true || agent?.socket_connected !== true) {
      throw new Error(`${options.bot} must already be world-ready.`);
    }
    const otherActive = agents.agents.filter(entry => entry?.name !== options.bot && entry?.in_game === true);
    if (otherActive.length) throw new Error(`Other Mindcraft bots are active: ${otherActive.map(entry => entry.name).join(', ')}`);

    const spawningBefore = await readBooleanGamerule('spawn_mobs');
    previousMobSpawning = spawningBefore.value;
    if (previousMobSpawning) {
      await paperCommand('gamerule spawn_mobs false');
      mobSpawningMutated = true;
    }
    const spawningDuring = await readBooleanGamerule('spawn_mobs');
    if (spawningDuring.value !== false) throw new Error('Could not isolate the follow fixture from natural mob spawning.');
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
      const compact = compactState(state);
      if (activeAttempt.samples.at(-1)?.sampledAt !== compact.sampledAt && activeAttempt.samples.length < 400) {
        activeAttempt.samples.push(compact);
      }
      for (const trace of state?.action?.behaviorArbiter?.decisionTrace?.recent || []) {
        if (!trace?.decisionId || Number(trace.wallClockTimestamp) < activeAttempt.issuedAt - 2_000) continue;
        if (activeAttempt.traceMap.size < 256 || activeAttempt.traceMap.has(trace.decisionId)) {
          activeAttempt.traceMap.set(trace.decisionId, trace);
        }
      }
      const result = compact.lastResult;
      if (
        !activeAttempt.terminal
        && result?.label === 'action:followPlayer'
        && typeof result.actionId === 'string'
        && Number(result.startedAt) >= activeAttempt.issuedAt
      ) activeAttempt.terminal = structuredClone(result);
    };
    socket.on('state-update', receiveState);
    socket.on('state-delta', receiveState);
    socket.on('bot-output', (agentName, output) => {
      if (agentName === options.bot && activeAttempt && activeAttempt.outputs.length < 64) {
        activeAttempt.outputs.push({ at: Date.now(), output: String(output).slice(0, 1_000) });
      }
    });
    socket.emit('listen-to-agents');
    socket.emit('request-agent-state-snapshot');
    await waitForHeld();

    await paperCommand(`scoreboard objectives remove ${OBJECTIVE}`);
    await paperCommand(`scoreboard objectives add ${OBJECTIVE} dummy`);
    target = await createControlledTarget(evidence.controlledTarget.events);
    await paperCommand(`tp ${TARGET_NAME} ${TARGET_START.x} ${TARGET_START.y} ${TARGET_START.z}`);
    await waitFor(
      () => positionOf(target.entity),
      position => distance(position, TARGET_START) <= 0.3,
      `${TARGET_NAME} initial fixture position`,
      15_000,
    );
    await target.waitForChunksToLoad();

    const baselineEntries = [];
    for (let y = COURSE.y1; y <= COURSE.y2; y += 1) {
      for (let z = COURSE.z1; z <= COURSE.z2; z += 1) {
        for (let x = COURSE.x1; x <= COURSE.x2; x += 1) {
          const block = target.blockAt(new Vec3(x, y, z));
          if (!block) throw new Error(`Fixture block ${x},${y},${z} was not loaded.`);
          if (block.entity) throw new Error(`Fixture contains block entity ${block.name} at ${x},${y},${z}; refusing mutation.`);
          baselineEntries.push({ x, y, z, state: blockState(block) });
        }
      }
    }
    const unsupportedFloor = [];
    const floorStates = new Map();
    for (let z = COURSE.z1; z <= COURSE.z2; z += 1) {
      for (let x = COURSE.x1; x <= COURSE.x2; x += 1) {
        const block = target.blockAt(new Vec3(x, COURSE.y1 - 1, z));
        if (!block || block.boundingBox !== 'block') unsupportedFloor.push({ x, y: COURSE.y1 - 1, z, name: block?.name || null });
        else floorStates.set(blockState(block), (floorStates.get(blockState(block)) || 0) + 1);
      }
    }
    if (unsupportedFloor.length) {
      throw new Error(`Fixture floor is not continuously supported: ${JSON.stringify(unsupportedFloor.slice(0, 12))}`);
    }
    baselineRuns = compressFixture(baselineEntries);
    evidence.fixture.beforeState = {
      compressedRuns: baselineRuns,
      floorStates: Object.fromEntries(floorStates),
      restoredAfterEachAttempt: true,
    };

    targetSampler = setInterval(() => {
      if (!activeAttempt || !target?.entity || activeAttempt.targetSamples.length >= 600) return;
      activeAttempt.targetSamples.push({ at: Date.now(), position: positionOf(target.entity) });
    }, POLL_MS);
    targetPathListener = path => {
      if (!activeAttempt || activeAttempt.targetPathUpdates.length >= 80) return;
      activeAttempt.targetPathUpdates.push({
        at: Date.now(),
        status: path?.status || null,
        visitedNodes: path?.visitedNodes ?? null,
        generatedNodes: path?.generatedNodes ?? null,
        pathLength: Array.isArray(path?.path) ? path.path.length : null,
      });
    };
    target.on('path_update', targetPathListener);

    for (let attemptNumber = 1; attemptNumber <= options.attempts; attemptNumber += 1) {
      await waitForHeld();
      await provisionFixture();
      const runId = `F${attemptNumber}`;
      const paperBefore = await paperSnapshot(runId, 'BEFORE');
      activeAttempt = {
        attempt: attemptNumber,
        runId,
        issuedAt: Date.now(),
        commandAck: null,
        samples: [],
        targetSamples: [],
        targetPathUpdates: [],
        outputs: [],
        traceMap: new Map(),
        terminal: null,
        resyncRequests: 0,
        waypoints: [],
        paperBefore,
      };
      if (options.naturalLanguage) {
        target.chat('follow me');
        activeAttempt.commandAck = { success: true, source: TARGET_NAME, acceptedAt: activeAttempt.issuedAt };
      } else {
        activeAttempt.commandAck = await sendMessage(COMMAND);
      }
      const activeState = await waitFor(
        () => states[options.bot] || null,
        state => {
          const compact = compactState(state);
          return compact.sampledAt >= activeAttempt.issuedAt
            && compact.held === false
            && compact.idle === false
            && compact.current === 'action:followPlayer'
            && Boolean(compact.pathfinding);
        },
        `${runId} active follow ownership`,
        15_000,
      );
      activeAttempt.activeAt = Number(activeState?._meta?.sampledAt) || Date.now();

      await driveTarget(WAYPOINTS[0]);
      if (options.mode === 'stop') {
        await waitFor(
          () => activeAttempt.samples,
          samples => samples.some(sample => distance(sample.position, BOT_START) >= 4 && sample.current === 'action:followPlayer'),
          `${runId} physical follow progress before stop`,
          15_000,
        );
      } else {
        await driveTarget(WAYPOINTS[1]);
        await driveTarget(WAYPOINTS[2]);
        await waitFor(
          () => compactState(states[options.bot]),
          state => distance(state.position, WAYPOINTS[2]) <= 4.25
            && activeAttempt.samples.some(sample => Number(sample.position?.y) >= 100.8),
          `${runId} bot completion of doorway/turn/elevation course`,
          25_000,
        );
      }

      activeAttempt.stopIssuedAt = Date.now();
      if (options.naturalLanguage) {
        target.chat('stop');
        activeAttempt.stopAck = { success: true, source: TARGET_NAME, acceptedAt: activeAttempt.stopIssuedAt };
      } else {
        activeAttempt.stopAck = await sendMessage('!stop');
      }
      const stopAcceptedAt = Number(activeAttempt.stopAck?.acceptedAt) || activeAttempt.stopIssuedAt;
      const targetContinuation = options.mode === 'stop'
        ? (async () => {
            await driveTarget(WAYPOINTS[1]);
            await driveTarget(WAYPOINTS[2]);
          })()
        : Promise.resolve();
      const heldState = await waitForHeld(stopAcceptedAt, 10_000);
      const heldAt = Number(heldState?._meta?.sampledAt) || Date.now();
      const stopPosition = compactState(heldState).position;
      const stableSamples = [];
      const stableStartedAt = Date.now();
      while (Date.now() - stableStartedAt < 10_000) {
        stableSamples.push(compactState(states[options.bot]));
        await delay(250);
      }
      await targetContinuation;
      const paperAfter = await paperSnapshot(runId, 'AFTER');
      await waitFor(
        () => activeAttempt.terminal,
        Boolean,
        `${runId} interrupted follow terminal result`,
        5_000,
      );

      const traces = [...activeAttempt.traceMap.values()]
        .sort((left, right) => Number(left.wallClockTimestamp) - Number(right.wallClockTimestamp));
      const botTravel = trajectoryDistance(activeAttempt.samples);
      const targetTravel = trajectoryDistance(activeAttempt.targetSamples);
      const doorwayCrossed = activeAttempt.samples.some(sample => (
        Number(sample.position?.x) >= 1032.4
        && Number(sample.position?.x) <= 1034.2
        && Number(sample.position?.z) >= 1007.35
        && Number(sample.position?.z) <= 1009.65
      ));
      const elevated = activeAttempt.samples.some(sample => Number(sample.position?.y) >= 100.8);
      const timeToFirstProgressMs = (() => {
        const sample = activeAttempt.samples.find(entry => distance(entry.position, BOT_START) >= 0.4);
        return sample ? Number(sample.sampledAt) - activeAttempt.issuedAt : null;
      })();
      const stable = stableSamples.length >= 35 && stableSamples.every(sample => {
        return sample.held
          && sample.idle
          && !sample.pathfinding
          && sample.stopTimedOutAt === null
          && actuatorVelocityIsQuiescent(sample)
          && distance(sample.position, stopPosition) <= 0.05;
      });
      const fixtureVerified = [paperBefore, ...activeAttempt.waypoints.map(entry => entry.paper), paperAfter]
        .every(snapshot => snapshot.wallVerified && snapshot.doorwayVerified && snapshot.platformVerified);
      const targetReachedRequiredWaypoints = options.mode === 'follow'
        ? activeAttempt.waypoints.length === 3
        : activeAttempt.waypoints.length === 3;
      const stopQuiescenceMs = Math.max(0, heldAt - stopAcceptedAt);
      const passed = targetReachedRequiredWaypoints
        && targetTravel >= (options.mode === 'follow' ? 20 : 20)
        && stopQuiescenceMs <= 2_000
        && stable
        && distance(paperAfter.botPosition, stopPosition) <= 0.1
        && fixtureVerified
        && activeAttempt.terminal?.phase === 'interrupted'
        && activeAttempt.terminal?.code === 'interrupted'
        && (options.mode === 'stop' || (
          botTravel >= 10
          && doorwayCrossed
          && elevated
          && distance(paperAfter.botPosition, WAYPOINTS[2]) <= 4.5
        ));
      evidence.attempts.push({
        attempt: attemptNumber,
        runId,
        issuedAt: activeAttempt.issuedAt,
        activeAt: activeAttempt.activeAt,
        commandAck: activeAttempt.commandAck,
        controlledElevation: activeAttempt.controlledElevation || null,
        terminal: activeAttempt.terminal,
        stop: {
          issuedAt: activeAttempt.stopIssuedAt,
          acceptedAt: stopAcceptedAt,
          heldAt,
          quiescenceMs: stopQuiescenceMs,
          position: stopPosition,
          stableForTenSeconds: stable,
          stableSamples,
        },
        performance: {
          durationMs: Date.now() - activeAttempt.issuedAt,
          timeToFirstPhysicalProgressMs: timeToFirstProgressMs,
          botTrajectoryDistance: botTravel,
          targetTrajectoryDistance: targetTravel,
          replanSignals: activeAttempt.outputs.filter(entry => /replan|reacquir|recover/i.test(entry.output)).length,
          interruptionCount: activeAttempt.terminal?.phase === 'interrupted' ? 1 : 0,
        },
        physicalAcceptance: {
          doorwayCrossed,
          twoTurnsCompleted: activeAttempt.waypoints.length === 3,
          oneBlockElevationCompleted: elevated,
          finalDistanceToTarget: distance(paperAfter.botPosition, paperAfter.targetPosition),
          fixtureVerified,
        },
        paper: { before: paperBefore, waypoints: activeAttempt.waypoints.map(entry => entry.paper), after: paperAfter },
        waypoints: activeAttempt.waypoints.map(({ paper, ...entry }) => entry),
        samples: activeAttempt.samples,
        targetSamples: activeAttempt.targetSamples,
        targetPathUpdates: activeAttempt.targetPathUpdates,
        outputs: activeAttempt.outputs,
        traces,
        resyncRequests: activeAttempt.resyncRequests,
        passed,
      });
      activeAttempt = null;
      await restoreFixture();
    }

    evidence.passed = evidence.attempts.length === options.attempts && evidence.attempts.every(attempt => attempt.passed);
  } catch (error) {
    evidence.error = String(error?.stack || error);
    if (activeAttempt && !evidence.attempts.some(attempt => attempt.runId === activeAttempt.runId)) {
      evidence.attempts.push({
        attempt: activeAttempt.attempt,
        runId: activeAttempt.runId,
        incomplete: true,
        issuedAt: activeAttempt.issuedAt,
        activeAt: activeAttempt.activeAt || null,
        commandAck: activeAttempt.commandAck,
        waypointFailure: activeAttempt.waypointFailure || null,
        waypoints: activeAttempt.waypoints,
        samples: activeAttempt.samples,
        targetSamples: activeAttempt.targetSamples,
        targetPathUpdates: activeAttempt.targetPathUpdates,
        outputs: activeAttempt.outputs,
        traces: [...activeAttempt.traceMap.values()]
          .sort((left, right) => Number(left.wallClockTimestamp) - Number(right.wallClockTimestamp)),
        resyncRequests: activeAttempt.resyncRequests,
        terminal: activeAttempt.terminal,
        passed: false,
      });
    }
    process.exitCode = 1;
  } finally {
    clearInterval(targetSampler);
    if (target && targetPathListener) target.off('path_update', targetPathListener);
    try { target?.pathfinder?.stop(); } catch { /* best-effort controlled target stop */ }
    try { target?.clearControlStates(); } catch { /* best-effort controlled target stop */ }
    try {
      if (socket) {
        const stop = await sendMessage('!stop');
        await waitForHeld(Number(stop?.acceptedAt) || Date.now(), 10_000);
      }
    } catch (error) {
      evidence.cleanup = { success: false, error: String(error?.stack || error) };
      process.exitCode = 1;
    }
    try {
      if (fixtureMutated || baselineRuns) await restoreFixture();
      await paperCommand(`scoreboard objectives remove ${OBJECTIVE}`);
      await paperCommand(`tp ${options.bot} 1071.5 100 1007.5`);
      evidence.cleanup = {
        ...(evidence.cleanup || {}),
        fixtureRestored: true,
        botHeld: true,
        targetDisconnected: true,
      };
    } catch (error) {
      evidence.cleanup = { success: false, error: String(error?.stack || error) };
      process.exitCode = 1;
    }
    let gameruleRestoreError = null;
    try {
      if (mobSpawningMutated) await paperCommand(`gamerule spawn_mobs ${previousMobSpawning}`);
      if (previousMobSpawning !== null) {
        const spawningAfter = await readBooleanGamerule('spawn_mobs');
        if (spawningAfter.value !== previousMobSpawning) {
          gameruleRestoreError = new Error(`Failed to restore spawn_mobs to ${previousMobSpawning}.`);
        } else {
          evidence.fixture.mobSpawning.restored = true;
        }
      }
    } catch (error) {
      gameruleRestoreError = error;
    }
    if (gameruleRestoreError) {
      evidence.cleanup = {
        ...(evidence.cleanup || {}),
        success: false,
        mobSpawningRestored: false,
        gameruleError: String(gameruleRestoreError?.stack || gameruleRestoreError),
      };
      process.exitCode = 1;
    }
    try { target?.quit('follow field verification complete'); } catch { target?.end(); }
    socket?.close();
    evidence.finishedAt = Date.now();
    evidence.durationMs = evidence.finishedAt - evidence.startedAt;
    await mkdir(dirname(options.evidence), { recursive: true });
    await writeFile(options.evidence, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({
      scenario: evidence.scenario,
      route: evidence.route,
      passed: evidence.passed,
      attempts: evidence.attempts.map(attempt => ({
        attempt: attempt.attempt,
        passed: attempt.passed,
        incomplete: attempt.incomplete === true,
        botTravel: Number.isFinite(attempt.performance?.botTrajectoryDistance)
          ? Number(attempt.performance.botTrajectoryDistance.toFixed(2))
          : null,
        targetTravel: Number.isFinite(attempt.performance?.targetTrajectoryDistance)
          ? Number(attempt.performance.targetTrajectoryDistance.toFixed(2))
          : null,
        doorway: attempt.physicalAcceptance?.doorwayCrossed ?? null,
        elevation: attempt.physicalAcceptance?.oneBlockElevationCompleted ?? null,
        stopMs: attempt.stop?.quiescenceMs ?? null,
      })),
      error: evidence.error,
      cleanup: evidence.cleanup,
      evidence: options.evidence,
    }, null, 2));
    if (!evidence.passed) process.exitCode = 1;
  }
}

run().catch(error => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
