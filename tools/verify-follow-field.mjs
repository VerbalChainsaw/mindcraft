import { readFileSync } from 'node:fs';
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
const DOORWAY_CAPTURE = Object.freeze({
  x1: 1032.4,
  x2: 1034.2,
  y1: 99.75,
  y2: 101.75,
  z1: 1007.35,
  z2: 1009.65,
});
// Obstruction variant. The doorway-corridor course leaves open ground south of
// the wall (wall z1006..z1012, course z1006..z1016), so a companion can walk
// around it -- which is why that course passes identically with digging
// disabled. This variant spans the full course width and fills the doorway with
// an ordinary breakable block, so the only route to the player is through it.
//
// This is the test that would have caught the 2026-08-16 defect, where
// `canDig = false` on all ordinary locomotion produced eight consecutive
// `noPath` follow failures against a real player. See ARCHITECTURE.md.
const OBSTRUCTION_WALL = Object.freeze({ x: 1033, y1: 100, y2: 102, z1: 1006, z2: 1016 });
const OBSTRUCTION_PLUG = Object.freeze({ x: 1033, y1: 100, y2: 101, z: 1008 });
const OBSTRUCTION_PLUG_BLOCK = 'dirt';

// Deliver course. Exercises the typed-goal path (goal-director) rather than the
// follow skill: the companion must acquire an item and physically hand it to
// the player. Dirt is deliberate -- it drops by hand, so the test measures the
// goal chain rather than whether the bot happens to hold a pickaxe.
//
// The source patch sits beside the bot's start so acquisition is a short,
// reliable mine rather than a search. Laid with fill commands like every other
// course here; see the note in FIXTURES.md about why frozen worlds rot.
const DELIVER_SOURCE = Object.freeze({ x1: 1029, x2: 1031, y: 100, z1: 1010, z2: 1011 });

// What each delivering course wants, and how it is allowed to get it.
//
// deliver-item hands the bot its material: a dirt patch is placed beside it, so
// the course measures the goal chain and nothing else.
//
// orchestrate-charcoal places NOTHING. The bot is told "go get some wood and
// make me some charcoal" in plain language and must derive the rest -- charcoal
// needs a furnace, a furnace needs cobblestone, cobblestone needs a pickaxe.
// That derivation is the measurement, so the window is long and the world is a
// forest rather than a prepared patch.
const DELIVER_SPEC = Object.freeze({
  'deliver-item': Object.freeze({ item: 'dirt', quantity: 1, placeSource: true, waitMs: 120_000 }),
  'orchestrate-charcoal': Object.freeze({ item: 'charcoal', quantity: 1, placeSource: false, waitMs: 600_000 }),
});
// Assigned once from the course in run(). Module-level so the existing deliver
// code paths keep reading one name.
let DELIVER_ITEM = 'dirt';
let DELIVER_QUANTITY = 1;
let DELIVER_PLACE_SOURCE = true;
let DELIVER_WAIT_MS = 120_000;

// The deliver course runs on a generated flat world whose top solid block is
// y=99, so the course constants above already stand on real ground. These probes
// prove that rather than assuming it, because assuming it is exactly what failed
// before: on the captured follow fixture the ground ends and the ocean begins a
// few blocks out, acquisition relocates 32 blocks to search, and the companion
// drowns instead of collecting. A run that could not tell those two worlds apart
// would report the same 'unreachable' either way.
//
// DELIVER_GROUND is directly under the course. DELIVER_DRY_LAND samples the four
// compass points at 40 blocks -- beyond the 32-block acquisition relocation --
// so "there is somewhere dry to relocate to" is measured in every direction the
// relocation could pick, not just the one that happened to work.
// The deliver course's terminal act is the hand-over, not a follow. !givePlayer
// is what physically transfers the item and !requestItemGoal is the goal wrapper
// around it; the run records whichever finishes last before the stop. The follow
// label is deliberately absent: this course never emits one, and gating the
// terminal on it is what failed the first run after the companion had already
// delivered the dirt. Judging which of these should have fired is the evidence
// adapter's job -- this list only has to let the measurement finish.
const DELIVER_TERMINAL_LABELS = Object.freeze([
  'action:givePlayer',
  'action:requestItemGoal',
  'action:collectBlocksInRange',
]);
const DELIVER_GROUND = Object.freeze({ x: 1033, y: 99, z: 1011, block: 'grass_block' });
const DELIVER_DRY_LAND = Object.freeze([
  Object.freeze({ name: 'north', x: 1033, y: 99, z: 971 }),
  Object.freeze({ name: 'south', x: 1033, y: 99, z: 1051 }),
  Object.freeze({ name: 'east', x: 1073, y: 99, z: 1011 }),
  Object.freeze({ name: 'west', x: 993, y: 99, z: 1011 }),
]);
// Keeps every block the probes and the relocation can reach resident, so a
// /fill or an `execute if block` never reports a false negative from an
// unloaded chunk. 64 chunks, well under the 256-chunk forceload cap.
const DELIVER_FORCELOAD = Object.freeze({ x1: 978, z1: 958, x2: 1088, z2: 1064 });
// A generated world spawns players at the origin, ~1,440 blocks from the course.
// Without this a single death sends the companion on the cross-country march
// that DEATH_RESUME_MAX_DISPLACEMENT exists to stop, and the run measures that
// instead of the delivery.
const DELIVER_WORLD_SPAWN = Object.freeze({ x: 1033, y: 100, z: 1011 });

// A* budget for the controlled target. Four times the library default of 5s.
const TARGET_THINK_TIMEOUT_MS = 20_000;
// One bounded retry when the target's SEARCH is cut short. Deliberately does
// not cover 'NoPath': no route existing is a real result the scenario must
// report, while a search that ran out of clock is an artifact of machine load.
const TARGET_SEARCH_RETRIES = 1;

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
    course: 'full',
    requestFile: '',
    requestMessage: '',
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
    else if (value === '--course') options.course = String(argv[++index] || '');
    else if (value === '--request-file') options.requestFile = String(argv[++index] || '');
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
  if (!['follow', 'stop', 'deliver'].includes(options.mode)) {
    throw new Error('Mode must be follow, stop, or deliver.');
  }
  if (options.mode === 'deliver' && !Object.hasOwn(DELIVER_SPEC, options.course)) {
    throw new Error(`Deliver verification requires one of: ${Object.keys(DELIVER_SPEC).join(', ')}.`);
  }
  if (!['full', 'doorway-corridor', 'obstruction-follow', ...Object.keys(DELIVER_SPEC)].includes(options.course)) {
    throw new Error('Course must be full, doorway-corridor, obstruction-follow, deliver-item, or orchestrate-charcoal.');
  }
  if (options.mode === 'stop' && options.course !== 'full') {
    throw new Error('Stop verification requires the full course.');
  }
  const parsed = new URL(options.url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('URL must use HTTP or HTTPS.');
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  options.url = parsed.toString().replace(/\/$/, '');
  options.evidence = resolve(options.evidence);
  options.requestFile = options.requestFile ? resolve(options.requestFile) : '';
  options.requestMessage = options.requestFile
    ? readFileSync(options.requestFile, 'utf8')
    : (options.naturalLanguage ? 'follow me' : COMMAND);
  if (
    !options.requestMessage
    || options.requestMessage.length > 512
    || /[\r\n]/.test(options.requestMessage)
  ) {
    throw new Error('The measured request must be one non-empty line of at most 512 characters.');
  }
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

function doorwayContains(position) {
  if (!position) return false;
  return Number(position.x) >= DOORWAY_CAPTURE.x1
    && Number(position.x) <= DOORWAY_CAPTURE.x2
    && Number(position.y) >= DOORWAY_CAPTURE.y1
    && Number(position.y) <= DOORWAY_CAPTURE.y2
    && Number(position.z) >= DOORWAY_CAPTURE.z1
    && Number(position.z) <= DOORWAY_CAPTURE.z2;
}

function doorwayCrossing(samples, source) {
  const positioned = samples.filter(sample => positionOf({ position: sample?.position }));
  for (const sample of positioned) {
    if (!doorwayContains(sample.position)) continue;
    return {
      source,
      method: 'sample',
      sampledAt: Number(sample.sampledAt ?? sample.at) || null,
      position: sample.position,
    };
  }

  for (let index = 1; index < positioned.length; index += 1) {
    const left = positioned[index - 1];
    const right = positioned[index];
    const leftX = Number(left.position.x);
    const rightX = Number(right.position.x);
    const crossesWallPlane = (leftX < WALL.x && rightX >= WALL.x)
      || (leftX > WALL.x && rightX <= WALL.x);
    if (!crossesWallPlane) continue;
    const fraction = (WALL.x - leftX) / (rightX - leftX);
    const position = {
      x: WALL.x,
      y: Number(left.position.y) + fraction * (Number(right.position.y) - Number(left.position.y)),
      z: Number(left.position.z) + fraction * (Number(right.position.z) - Number(left.position.z)),
    };
    if (!doorwayContains(position)) continue;
    const leftAt = Number(left.sampledAt ?? left.at);
    const rightAt = Number(right.sampledAt ?? right.at);
    return {
      source,
      method: 'interpolated-segment',
      sampledAt: Number.isFinite(leftAt) && Number.isFinite(rightAt)
        ? Math.round(leftAt + fraction * (rightAt - leftAt))
        : null,
      position,
      intervalMs: Number.isFinite(leftAt) && Number.isFinite(rightAt) ? rightAt - leftAt : null,
    };
  }
  return null;
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

function actuatorVelocityIsSettled(state) {
  const horizontalSpeed = Math.hypot(
    Number(state?.velocity?.x) || 0,
    Number(state?.velocity?.z) || 0,
  );
  return actuatorVelocityIsQuiescent(state)
    && horizontalSpeed <= 0.01;
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
  // Hoisted deliberately. These were declared inside the attempt loop, where
  // provisionFixture -- defined in this scope and called from it -- could not
  // see them. node --check does not catch that; the run does, at the worst
  // possible moment.
  const deliverCourse = Object.hasOwn(DELIVER_SPEC, options.course);
  const obstructionCourse = options.course === 'obstruction-follow';
  const orchestrationCourse = options.course === 'orchestrate-charcoal';
  if (deliverCourse) {
    const spec = DELIVER_SPEC[options.course];
    DELIVER_ITEM = spec.item;
    DELIVER_QUANTITY = spec.quantity;
    DELIVER_PLACE_SOURCE = spec.placeSource;
    DELIVER_WAIT_MS = spec.waitMs;
  }
  const activeWaypoints = options.mode === 'stop' || options.course === 'full'
    ? WAYPOINTS
    : WAYPOINTS.slice(0, 2);
  const evidence = {
    schemaVersion: 1,
    scenario: options.mode === 'follow'
      ? (options.course === 'doorway-corridor'
        ? 'follow-controlled-player-through-doorway-corridor'
        : 'follow-controlled-player-through-course')
      : 'stop-during-active-follow',
    route: options.naturalLanguage ? 'natural-language-player-chat' : 'typed-dashboard-command',
    command: options.requestMessage,
    bot: options.bot,
    controlledTarget: {
      name: TARGET_NAME,
      kind: 'temporary-mineflayer-client',
      model: false,
      profile: false,
      scheduler: false,
      events: [],
    },
    fixture: {
      course: COURSE,
      courseVariant: options.course,
      botStart: BOT_START,
      targetStart: TARGET_START,
      wall: WALL,
      doorway: DOORWAY,
      platform: PLATFORM,
      waypoints: activeWaypoints,
    },
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
  let previousDifficulty = null;
  let difficultyMutated = false;

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

  // Difficulty, read the same way as a gamerule. Peaceful removes hostile mobs
  // outright rather than racing their travel speed with a kill radius, which is
  // the arithmetic that failed: a margin sized for a 60s measurement is too
  // small for the deliver course's 120s delivery wait, and a drowned covers
  // ~144 blocks in that time.
  const readDifficulty = async () => {
    const command = 'difficulty';
    await paperCommand(command);
    return waitFor(
      async () => {
        const status = await fetchJson(options.url, '/api/minecraft-server');
        const lines = Array.isArray(status?.server?.logs) ? status.server.logs : [];
        const commandIndex = lines.findLastIndex(line => String(line).includes(`[command] > ${command}`));
        if (commandIndex < 0) return null;
        for (const line of lines.slice(commandIndex + 1)) {
          const match = String(line).match(/difficulty is (peaceful|easy|normal|hard)/i);
          if (match) return { value: match[1].toLowerCase(), line: String(line) };
        }
        return null;
      },
      Boolean,
      'difficulty query',
      5_000,
    );
  };

  const paperSnapshot = async (runId, phase) => {
    const begin = marker(runId, phase, 'BEGIN');
    const end = marker(runId, phase, 'END');
    const wall = marker(runId, phase, 'WALL');
    const opening = marker(runId, phase, 'OPEN');
    const step = marker(runId, phase, 'STEP');
    const plug = marker(runId, phase, 'PLUG');
    const source = marker(runId, phase, 'SRCE');
    await paperCommand(`scoreboard players set ${begin} ${OBJECTIVE} 1`);
    await paperCommand(`data get entity ${options.bot} Pos`);
    await paperCommand(`data get entity ${TARGET_NAME} Pos`);
    await paperCommand(`execute if block 1033 100 1007 minecraft:stone_bricks run scoreboard players set ${wall} ${OBJECTIVE} 1`);
    await paperCommand(`execute if block 1033 100 1008 minecraft:air run scoreboard players set ${opening} ${OBJECTIVE} 1`);
    await paperCommand(`execute if block 1030 100 1014 minecraft:smooth_stone run scoreboard players set ${step} ${OBJECTIVE} 1`);
    await paperCommand(`execute if block ${OBSTRUCTION_PLUG.x} ${OBSTRUCTION_PLUG.y1} ${OBSTRUCTION_PLUG.z} minecraft:${OBSTRUCTION_PLUG_BLOCK} run scoreboard players set ${plug} ${OBJECTIVE} 1`);
    // Did provisioning actually place the acquisition source? A goal that fails
    // to find its material is only meaningful if the material was really there.
    await paperCommand(`execute if block ${DELIVER_SOURCE.x1} ${DELIVER_SOURCE.y} ${DELIVER_SOURCE.z1} minecraft:${DELIVER_ITEM} run scoreboard players set ${source} ${OBJECTIVE} 1`);
    // Is the world under this course actually dry land, and does it stay dry
    // past the distance acquisition relocates? On the captured follow fixture the
    // answer is no, and every deliver run there died the same way. Measure it
    // rather than trust the fixture name.
    const ground = marker(runId, phase, 'GRND');
    const dryLand = DELIVER_DRY_LAND.map(probe => ({
      ...probe,
      name_marker: marker(runId, phase, `DRY_${probe.name}`),
    }));
    if (options.course === 'deliver-item') {
      await paperCommand(`execute if block ${DELIVER_GROUND.x} ${DELIVER_GROUND.y} ${DELIVER_GROUND.z} minecraft:${DELIVER_GROUND.block} run scoreboard players set ${ground} ${OBJECTIVE} 1`);
      for (const probe of dryLand) {
        await paperCommand(`execute if block ${probe.x} ${probe.y} ${probe.z} minecraft:${DELIVER_GROUND.block} run scoreboard players set ${probe.name_marker} ${OBJECTIVE} 1`);
      }
    }
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
      plugVerified: markerObserved(window, plug),
      sourceVerified: markerObserved(window, source),
      groundVerified: markerObserved(window, ground),
      dryLandProbes: dryLand.map(probe => ({
        name: probe.name,
        x: probe.x,
        y: probe.y,
        z: probe.z,
        verified: markerObserved(window, probe.name_marker),
      })),
      dryLandVerified: dryLand.every(probe => markerObserved(window, probe.name_marker)),
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
    if (options.course === 'deliver-item') await paperCommand('forceload remove all');
    fixtureMutated = false;
  };

  const provisionFixture = async () => {
    await restoreFixture();
    fixtureMutated = true;
    const commands = [
      // Deliver-course preamble. Both must precede the first fill: the forceload
      // so that no fill or probe below can land in an unloaded chunk and report a
      // false negative, and the world spawn so a death respawns at the course
      // rather than 1,440 blocks away at the generated world's origin.
      ...(options.course === 'deliver-item'
        ? [
            `forceload add ${DELIVER_FORCELOAD.x1} ${DELIVER_FORCELOAD.z1} ${DELIVER_FORCELOAD.x2} ${DELIVER_FORCELOAD.z2}`,
            `setworldspawn ${DELIVER_WORLD_SPAWN.x} ${DELIVER_WORLD_SPAWN.y} ${DELIVER_WORLD_SPAWN.z}`,
          ]
        : []),
      // The orchestration course wants open forest. Clearing the box and walling
      // it is follow geometry, and it boxed a bot whose task is to find trees --
      // the first full run reported "the nearest oak log is unreachable from my
      // position" from inside it.
      ...(orchestrationCourse
        ? []
        : [`fill ${COURSE.x1} ${COURSE.y1} ${COURSE.z1} ${COURSE.x2} ${COURSE.y2} ${COURSE.z2} air`]),
      ...(deliverCourse && DELIVER_PLACE_SOURCE
        ? [
            `fill ${DELIVER_SOURCE.x1} ${DELIVER_SOURCE.y} ${DELIVER_SOURCE.z1} ${DELIVER_SOURCE.x2} ${DELIVER_SOURCE.y} ${DELIVER_SOURCE.z2} ${DELIVER_ITEM}`,
          ]
        : []),
      ...(options.course === 'obstruction-follow'
        ? [
            // Full-width wall so the companion cannot simply walk around it,
            // but the doorway starts OPEN: the controlled target moves with
            // canDig=false and must be able to path east. The doorway is sealed
            // behind it mid-run, once it is through.
            `fill ${OBSTRUCTION_WALL.x} ${OBSTRUCTION_WALL.y1} ${OBSTRUCTION_WALL.z1} ${OBSTRUCTION_WALL.x} ${OBSTRUCTION_WALL.y2} ${OBSTRUCTION_WALL.z2} stone_bricks`,
            `fill ${OBSTRUCTION_PLUG.x} ${OBSTRUCTION_PLUG.y1} ${OBSTRUCTION_PLUG.z} ${OBSTRUCTION_PLUG.x} ${OBSTRUCTION_PLUG.y2} ${OBSTRUCTION_PLUG.z} air`,
          ]
        : orchestrationCourse
        ? []
        : [
            `fill ${WALL.x} ${WALL.y1} ${WALL.z1} ${WALL.x} ${WALL.y2} ${WALL.z2} stone_bricks`,
            `fill ${DOORWAY.x} ${DOORWAY.y1} ${DOORWAY.z} ${DOORWAY.x} ${DOORWAY.y2} ${DOORWAY.z} air`,
          ]),
      ...(orchestrationCourse
        ? []
        : [`fill ${PLATFORM.x1} ${PLATFORM.y} ${PLATFORM.z1} ${PLATFORM.x2} ${PLATFORM.y} ${PLATFORM.z2} smooth_stone`]),
      // The acceptance fixture must not be preempted by a mob. Spawning is
      // already disabled for the run, so the only remaining threat is a mob
      // that already exists swimming or walking in from outside this box.
      //
      // The old margin was 6-10 blocks around the course, which a drowned
      // crosses in seconds: one 2026-08-16 deliver run was killed mid-goal by
      // exactly that ("I got away from the drowned... Took 8 damage!... That
      // got me. Respawning."), and the bot then resumed from world spawn.
      //
      // Sized so arrival is impossible rather than unlikely: a drowned moves
      // ~1.2 blocks/s, so ~70 blocks is the most it covers during a 60s
      // measurement. This clears ~75 blocks on every side of the course.
      // Players are excluded by type, so the companion and controlled target
      // both survive.
      'kill @e[type=!player,x=953,y=70,z=931,dx=160,dy=64,dz=160]',
      `gamemode survival ${options.bot}`,
      `gamemode survival ${TARGET_NAME}`,
      `tp ${options.bot} ${BOT_START.x} ${BOT_START.y} ${BOT_START.z}`,
      `tp ${TARGET_NAME} ${TARGET_START.x} ${TARGET_START.y} ${TARGET_START.z}`,
      `effect give ${options.bot} minecraft:instant_health 1 4 true`,
      `effect give ${options.bot} minecraft:saturation 180 1 true`,
      `effect give ${TARGET_NAME} minecraft:instant_health 1 4 true`,
      `effect give ${TARGET_NAME} minecraft:saturation 180 1 true`,
      // Deterministic delivery baseline. Without this the recipient could enter
      // the attempt already holding the item and the acceptance would pass on
      // stock it never received.
      ...(options.course === 'deliver-item'
        ? [
            `clear ${TARGET_NAME} minecraft:${DELIVER_ITEM}`,
            `clear ${options.bot} minecraft:${DELIVER_ITEM}`,
          ]
        : []),
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
    // The controlled target is measurement scaffolding, not the thing under
    // test. Its default 5s A* budget is a wall-clock allowance, so on a loaded
    // machine the search is cut off and reports status 'timeout' -- which the
    // harness then surfaces as a scenario failure even though the route exists
    // and the companion never had a chance to be wrong. Give the scaffolding
    // room; correctness matters here and speed does not.
    target.pathfinder.thinkTimeout = TARGET_THINK_TIMEOUT_MS;
  };

  // How much of an item the recipient is physically holding. Returns null when
  // the inventory cannot be read, never 0 -- a read failure reported as "none"
  // would set the delivery baseline to zero and let the wait satisfy instantly
  // on stock the target already had.
  const countTargetItem = itemName => {
    try {
      const items = target?.inventory?.items?.();
      if (!Array.isArray(items)) return null;
      return items
        .filter(item => item?.name === itemName)
        .reduce((total, item) => total + (Number(item.count) || 0), 0);
    } catch {
      return null;
    }
  };

  const driveTarget = async waypoint => {
    const startedAt = Date.now();
    const gotoOnce = destination => withTimeout(
      target.pathfinder.goto(new pf.goals.GoalNear(destination.x, destination.y, destination.z, 0.25)),
      25_000,
      `${TARGET_NAME} physical movement to ${destination.name}`,
      () => target.pathfinder.stop(),
    );
    // Retry only a cut-short search. A 'NoPath' result means the route genuinely
    // does not exist and must fail the scenario -- retrying that would hide the
    // exact class of defect this harness exists to catch.
    const gotoWaypoint = async destination => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await gotoOnce(destination);
        } catch (error) {
          const searchExpired = error?.name === 'Timeout'
            || /took to long to decide path/i.test(String(error?.message || ''));
          if (!searchExpired || attempt >= TARGET_SEARCH_RETRIES) throw error;
          evidence.controlledTarget.events.push({
            at: Date.now(),
            event: 'search-timeout-retry',
            destination: destination.name,
            attempt: attempt + 1,
          });
          target.pathfinder.stop();
        }
      }
    };
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

    // Suppressing spawns leaves every mob that already exists. Peaceful removes
    // them and keeps them gone for the whole run, so no scenario can be decided
    // by a drowned that happened to be swimming nearby. Restored on teardown
    // exactly like the gamerule above.
    const difficultyBefore = await readDifficulty();
    previousDifficulty = difficultyBefore.value;
    if (previousDifficulty !== 'peaceful') {
      await paperCommand('difficulty peaceful');
      difficultyMutated = true;
    }
    const difficultyDuring = await readDifficulty();
    if (difficultyDuring.value !== 'peaceful') {
      throw new Error('Could not isolate the fixture from hostile mobs (difficulty is not peaceful).');
    }
    evidence.fixture.difficulty = {
      previous: previousDifficulty,
      duringFixture: difficultyDuring.value,
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
      const resultBelongsToRequest = typeof result?.label === 'string'
        && typeof result?.actionId === 'string'
        && Number(result.startedAt) >= activeAttempt.issuedAt;
      // Record every terminal result this request produced, whatever its label.
      // When a course expects the wrong label this is what says so out loud,
      // instead of the 5s wait below timing out on a result that was never
      // going to arrive -- which is exactly how the first deliver run failed
      // after the companion had already handed over the dirt.
      if (resultBelongsToRequest) {
        activeAttempt.resultsByLabel.set(result.label, structuredClone(result));
      }
      if (resultBelongsToRequest && options.mode === 'deliver') {
        // The deliver course has a chain, not a single action. Its terminal act
        // is the last one to finish before the stop, so take the newest match
        // rather than the first.
        if (DELIVER_TERMINAL_LABELS.includes(result.label)) {
          activeAttempt.terminal = structuredClone(result);
        }
      } else if (
        !activeAttempt.terminal
        && result?.label === 'action:followPlayer'
        && resultBelongsToRequest
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
      if (!activeAttempt || !target?.entity) return;
      const sampledAt = Date.now();
      if (activeAttempt.targetSamples.length < 600) {
        activeAttempt.targetSamples.push({ at: sampledAt, position: positionOf(target.entity) });
      }
      const observedBotPosition = positionOf(target.players?.[options.bot]?.entity);
      if (observedBotPosition && activeAttempt.physicalSamples.length < 600) {
        activeAttempt.physicalSamples.push({ sampledAt, position: observedBotPosition });
      }
      // Obstruction course: once the target is clear of the wall, seal the
      // doorway behind it. From here the only way to keep following is to break
      // through -- which is precisely what a companion with canDig disabled
      // cannot do, and what it reported as `noPath` against a real player.
      if (
        options.course === 'obstruction-follow'
        && !activeAttempt.obstructionSealedAt
        && Number(positionOf(target.entity)?.x) > OBSTRUCTION_WALL.x + 1
      ) {
        activeAttempt.obstructionSealedAt = sampledAt;
        paperCommand(
          `fill ${OBSTRUCTION_PLUG.x} ${OBSTRUCTION_PLUG.y1} ${OBSTRUCTION_PLUG.z} `
          + `${OBSTRUCTION_PLUG.x} ${OBSTRUCTION_PLUG.y2} ${OBSTRUCTION_PLUG.z} ${OBSTRUCTION_PLUG_BLOCK}`,
        ).catch(() => { activeAttempt.obstructionSealedAt = null; });
      }
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
        physicalSamples: [],
        targetPathUpdates: [],
        outputs: [],
        traceMap: new Map(),
        terminal: null,
        resultsByLabel: new Map(),
        obstructionSealedAt: null,
        deliveryBaseline: countTargetItem(DELIVER_ITEM),
        deliveryObservedAt: null,
        deliveryFinal: null,
        resyncRequests: 0,
        waypoints: [],
        paperBefore,
      };
      if (options.naturalLanguage) {
        target.chat(options.requestMessage);
        activeAttempt.commandAck = { success: true, source: TARGET_NAME, acceptedAt: activeAttempt.issuedAt };
      } else {
        activeAttempt.commandAck = await sendMessage(options.requestMessage);
      }
      const activeState = await waitFor(
        () => states[options.bot] || null,
        state => {
          const compact = compactState(state);
          if (compact.sampledAt < activeAttempt.issuedAt) return false;
          if (compact.held !== false) return false;
          // A typed goal dispatches its own subgoal commands (collect, then
          // deliver), so it owns the body under changing labels rather than one
          // fixed follow action. Requiring a specific label here would make the
          // wait a test of the goal's internal command choice.
          if (options.mode === 'deliver') return compact.idle === false;
          return compact.idle === false
            && compact.current === 'action:followPlayer'
            && Boolean(compact.pathfinding);
        },
        `${runId} active ${options.mode === 'deliver' ? 'goal' : 'follow'} ownership`,
        options.mode === 'deliver' ? 30_000 : 15_000,
      );
      activeAttempt.activeAt = Number(activeState?._meta?.sampledAt) || Date.now();

      if (options.mode === 'deliver') {
        // The whole acceptance: the item physically arrives in the recipient's
        // inventory. Not a claim in a log, not a goal phase -- the player is
        // holding it. The target never moves; the companion must acquire and
        // bring it.
        if (activeAttempt.deliveryBaseline === null) {
          throw new Error(`${runId} could not read ${TARGET_NAME}'s inventory for a delivery baseline.`);
        }
        const wanted = activeAttempt.deliveryBaseline + DELIVER_QUANTITY;
        await waitFor(
          () => countTargetItem(DELIVER_ITEM),
          held => held !== null && held >= wanted,
          `${runId} ${DELIVER_QUANTITY}x ${DELIVER_ITEM} delivered to ${TARGET_NAME}`,
          DELIVER_WAIT_MS,
        );
        activeAttempt.deliveryObservedAt = Date.now();
      } else {
      await driveTarget(activeWaypoints[0]);
      if (options.mode === 'stop') {
        await waitFor(
          () => activeAttempt.samples,
          samples => samples.some(sample => distance(sample.position, BOT_START) >= 4 && sample.current === 'action:followPlayer'),
          `${runId} physical follow progress before stop`,
          15_000,
        );
      } else {
        for (const waypoint of activeWaypoints.slice(1)) await driveTarget(waypoint);
        const finalWaypoint = activeWaypoints.at(-1);
        await waitFor(
          () => compactState(states[options.bot]),
          state => distance(state.position, finalWaypoint) <= 4.25
            && (options.course !== 'full'
              || activeAttempt.samples.some(sample => Number(sample.position?.y) >= 100.8)),
          `${runId} bot completion of ${options.course} course`,
          25_000,
        );
      }
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
      const settledState = await waitFor(
        () => states[options.bot] || null,
        state => {
          const compact = compactState(state);
          return compact.sampledAt >= heldAt
            && compact.held
            && compact.idle
            && !compact.pathfinding
            && compact.stopTimedOutAt === null
            && actuatorVelocityIsSettled(compact);
        },
        `${options.bot} settled stop anchor`,
        2_000,
      );
      const settledAt = Number(settledState?._meta?.sampledAt) || Date.now();
      const stopPosition = compactState(settledState).position;
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
        options.mode === 'deliver'
          ? `${runId} goal terminal result (labels seen: ${[...activeAttempt.resultsByLabel.keys()].join(', ') || 'none'})`
          : `${runId} interrupted follow terminal result`,
        5_000,
      );

      const traces = [...activeAttempt.traceMap.values()]
        .sort((left, right) => Number(left.wallClockTimestamp) - Number(right.wallClockTimestamp));
      const physicalBotSamples = activeAttempt.physicalSamples.length >= 2
        ? activeAttempt.physicalSamples
        : activeAttempt.samples;
      const botTravel = trajectoryDistance(physicalBotSamples);
      const targetTravel = trajectoryDistance(activeAttempt.targetSamples);
      const doorwayObservation = doorwayCrossing(activeAttempt.physicalSamples, 'controlled-target-observer')
        || doorwayCrossing(activeAttempt.samples, 'dashboard-state');
      const doorwayCrossed = Boolean(doorwayObservation);
      const elevated = physicalBotSamples.some(sample => Number(sample.position?.y) >= 100.8);
      const timeToFirstProgressMs = (() => {
        const sample = physicalBotSamples.find(entry => distance(entry.position, BOT_START) >= 0.4);
        return sample ? Number(sample.sampledAt ?? sample.at) - activeAttempt.issuedAt : null;
      })();
      const stable = stableSamples.length >= 35 && stableSamples.every(sample => {
        return sample.held
          && sample.idle
          && !sample.pathfinding
          && sample.stopTimedOutAt === null
          && actuatorVelocityIsQuiescent(sample)
          && distance(sample.position, stopPosition) <= 0.05;
      });
      // On the obstruction course the doorway starts plugged with a breakable
      // block, so `doorwayVerified` (block is air) is FALSE at the start by
      // design and only becomes true once the companion breaks through. That
      // transition -- plugged before, open after -- IS the proof, so it
      // replaces the static doorway check rather than failing it.
      // Sealed behind the target, then open again at the end = the companion
      // broke through. `plugVerified` at paperBefore is intentionally false
      // here: the doorway starts open so the target can path east.
      const obstructionDugThrough = obstructionCourse
        ? Boolean(activeAttempt.obstructionSealedAt) && Boolean(paperAfter.doorwayVerified)
        : null;
      const fixtureVerified = orchestrationCourse
        ? paperBefore.groundVerified === true && paperBefore.dryLandVerified === true
        : deliverCourse
        ? [paperBefore, paperAfter].every(snapshot => snapshot.wallVerified && snapshot.platformVerified)
          // The world premise, not just the geometry. The course must stand on
          // real ground and stay dry past the distance acquisition relocates,
          // and the material must actually have been placed. On the island
          // fixture all three of these are false, and the run reported an
          // ambiguous 'unreachable' twenty minutes later instead of saying so.
          && paperBefore.groundVerified === true
          && paperBefore.dryLandVerified === true
          && (DELIVER_PLACE_SOURCE ? paperBefore.sourceVerified === true : true)
        : obstructionCourse
        ? [paperBefore, ...activeAttempt.waypoints.map(entry => entry.paper), paperAfter]
            .every(snapshot => snapshot.wallVerified && snapshot.platformVerified)
          && obstructionDugThrough === true
        : [paperBefore, ...activeAttempt.waypoints.map(entry => entry.paper), paperAfter]
            .every(snapshot => snapshot.wallVerified && snapshot.doorwayVerified && snapshot.platformVerified);
      const targetReachedRequiredWaypoints = options.mode === 'follow'
        ? activeAttempt.waypoints.length === activeWaypoints.length
        : activeAttempt.waypoints.length === WAYPOINTS.length;
      const finalWaypoint = activeWaypoints.at(-1);
      const corridorCompleted = activeAttempt.waypoints.length >= 2;
      const finalWaypointReached = distance(paperAfter.botPosition, finalWaypoint) <= 4.5;
      const stopQuiescenceMs = Math.max(0, heldAt - stopAcceptedAt);
      const settlingMs = Math.max(0, settledAt - heldAt);
      // Delivery acceptance is deliberately narrow: the recipient physically
      // holds at least the requested quantity more than it started with, the
      // companion settled quiescent afterwards, and the fixture is intact.
      // Waypoint and travel thresholds are follow criteria and do not apply --
      // the recipient never moves on this course.
      activeAttempt.deliveryFinal = countTargetItem(DELIVER_ITEM);
      const deliveryVerified = options.mode === 'deliver'
        ? activeAttempt.deliveryBaseline !== null
          && activeAttempt.deliveryFinal !== null
          && activeAttempt.deliveryFinal >= activeAttempt.deliveryBaseline + DELIVER_QUANTITY
        : null;
      const passed = options.mode === 'deliver'
        ? deliveryVerified === true
          && stopQuiescenceMs <= 2_000
          && stable
          && fixtureVerified
        : targetReachedRequiredWaypoints
        && targetTravel >= (options.mode === 'follow'
          ? (options.course === 'full' ? 20 : 12)
          : 20)
        && stopQuiescenceMs <= 2_000
        && stable
        && distance(paperAfter.botPosition, stopPosition) <= 0.1
        && fixtureVerified
        && activeAttempt.terminal?.phase === 'interrupted'
        && activeAttempt.terminal?.code === 'interrupted'
        && (options.mode === 'stop' || (
          botTravel >= (options.course === 'full' ? 10 : 7)
          && doorwayCrossed
          && corridorCompleted
          && (options.course !== 'full' || elevated)
          && finalWaypointReached
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
          settledAt,
          settlingMs,
          position: stopPosition,
          stableForTenSeconds: stable,
          stableSamples,
        },
        performance: {
          durationMs: Date.now() - activeAttempt.issuedAt,
          timeToFirstPhysicalProgressMs: timeToFirstProgressMs,
          botTrajectorySource: physicalBotSamples === activeAttempt.physicalSamples ? 'controlled-target-observer' : 'dashboard-state',
          botTrajectoryDistance: botTravel,
          targetTrajectoryDistance: targetTravel,
          replanSignals: activeAttempt.outputs.filter(entry => /replan|reacquir|recover/i.test(entry.output)).length,
          interruptionCount: activeAttempt.terminal?.phase === 'interrupted' ? 1 : 0,
        },
        physicalAcceptance: {
          course: options.course,
          doorwayCrossed,
          doorwayObservation,
          corridorCompleted,
          finalWaypointReached,
          obstructionDugThrough,
          obstructionSealedAt: activeAttempt.obstructionSealedAt || null,
          deliveryVerified,
          deliveryItem: options.mode === 'deliver' ? DELIVER_ITEM : null,
          deliveryQuantity: options.mode === 'deliver' ? DELIVER_QUANTITY : null,
          deliverySourcePresent: paperBefore.sourceVerified,
          deliveryGroundPresent: paperBefore.groundVerified,
          deliveryDryLandVerified: paperBefore.dryLandVerified,
          deliveryDryLandProbes: paperBefore.dryLandProbes,
          deliveryBaseline: activeAttempt.deliveryBaseline,
          deliveryFinal: activeAttempt.deliveryFinal,
          deliveryObservedAt: activeAttempt.deliveryObservedAt,
          twoTurnsCompleted: activeAttempt.waypoints.length === 3,
          oneBlockElevationCompleted: elevated,
          finalDistanceToTarget: distance(paperAfter.botPosition, paperAfter.targetPosition),
          fixtureVerified,
        },
        paper: { before: paperBefore, waypoints: activeAttempt.waypoints.map(entry => entry.paper), after: paperAfter },
        waypoints: activeAttempt.waypoints.map(({ paper, ...entry }) => entry),
        samples: activeAttempt.samples,
        physicalSamples: activeAttempt.physicalSamples,
        targetSamples: activeAttempt.targetSamples,
        targetPathUpdates: activeAttempt.targetPathUpdates,
        outputs: activeAttempt.outputs,
        traces,
        // Every terminal result this request produced, keyed by label. Without
        // this a course whose expected label is wrong looks like a hang rather
        // than a naming mismatch.
        resultLabels: [...activeAttempt.resultsByLabel.keys()],
        results: Object.fromEntries(activeAttempt.resultsByLabel),
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
        // Fixture state as captured BEFORE the request. Without this an
        // incomplete attempt cannot answer whether its own course was laid
        // correctly, so a failure is indistinguishable from a mis-provisioned
        // fixture. Three deliver runs failed without recording whether their
        // acquisition source block was ever placed.
        paperBefore: activeAttempt.paperBefore || null,
        fixtureBefore: activeAttempt.paperBefore
          ? {
              wallVerified: activeAttempt.paperBefore.wallVerified,
              doorwayVerified: activeAttempt.paperBefore.doorwayVerified,
              platformVerified: activeAttempt.paperBefore.platformVerified,
              plugVerified: activeAttempt.paperBefore.plugVerified,
              sourceVerified: activeAttempt.paperBefore.sourceVerified,
            }
          : null,
        deliveryBaseline: activeAttempt.deliveryBaseline ?? null,
        obstructionSealedAt: activeAttempt.obstructionSealedAt || null,
        waypointFailure: activeAttempt.waypointFailure || null,
        waypoints: activeAttempt.waypoints,
        samples: activeAttempt.samples,
        physicalSamples: activeAttempt.physicalSamples,
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
      if (difficultyMutated && previousDifficulty) {
        await paperCommand(`difficulty ${previousDifficulty}`);
        const difficultyAfter = await readDifficulty();
        evidence.fixture.difficulty = {
          ...(evidence.fixture.difficulty || {}),
          restored: difficultyAfter.value === previousDifficulty,
          after: difficultyAfter.value,
        };
      }
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
