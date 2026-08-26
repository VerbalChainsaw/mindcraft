import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

import mineflayer from 'mineflayer';
import pf from 'mineflayer-pathfinder';
import { io } from 'socket.io-client';
import Vec3 from 'vec3';

import { canonicalJson } from './a0/aggregate.mjs';
import { applyStateUpdate } from '../src/mindcraft/public/js/agent-state-protocol.js';
import { reachInteractionStance } from '../src/agent/library/skills.js';
import {
  fingerprintVarianceValue,
  requestCompletionCase,
  REQUEST_COMPLETION_FIXTURE,
} from './scenario-lab/variance-cases.mjs';

const BOT_START = Object.freeze({ x: 1027.5, y: 100, z: 1008.5 });
const TARGET_START = Object.freeze({ x: 1029.5, y: 100, z: 1008.5 });
const WAYPOINTS = Object.freeze([
  Object.freeze({ name: 'east-through-doorway', x: 1038.5, y: 100, z: 1008.5 }),
  Object.freeze({ name: 'south-after-first-turn', x: 1038.5, y: 100, z: 1014.5 }),
  Object.freeze({ name: 'west-up-one-block', x: 1029.5, y: 101, z: 1014.5 }),
]);
const PLAYER_ROUTE_TARGET = WAYPOINTS[0];
// Mirrors goToPlayer's established one-block terrain settlement envelope. The
// course requires the final continuous body position, not merely Pathfinder's
// integer standing-cell completion.
const PLAYER_ROUTE_REQUESTED_DISTANCE = 3;
const PLAYER_ROUTE_TERRAIN_ENVELOPE = 1;
const PLAYER_ROUTE_ACCEPTANCE_DISTANCE = PLAYER_ROUTE_REQUESTED_DISTANCE
  + PLAYER_ROUTE_TERRAIN_ENVELOPE;
const COURSE = Object.freeze({ x1: 1026, x2: 1040, y1: 100, y2: 102, z1: 1006, z2: 1016 });
const PLAYER_ROUTE_BLOCKED_COURSE = Object.freeze({ ...COURSE, y1: 95, y2: 105 });
const PLAYER_ROUTE_BLOCKED_CAGE = Object.freeze({ x1: 1029, x2: 1040, y1: 95, y2: 105, z1: 1006, z2: 1016 });
const PLAYER_ROUTE_BLOCKED_TARGET = Object.freeze({ x: 1034.5, y: 100, z: 1011.5 });
// The target is centered six blocks from the nearest legal outside stance.
// A quarter-block observation allowance covers server/body settlement without
// admitting any cell beyond that geometry-owned nearest face.
const PLAYER_ROUTE_BLOCKED_NEAREST_DISTANCE = 6;
const PLAYER_ROUTE_BLOCKED_OBSERVATION_ALLOWANCE = 0.25;
const ROUTE_PROBE_COURSE = Object.freeze({ ...COURSE, y1: 99, y2: 103 });
const REQUEST_COMPLETION_COURSE = Object.freeze({ ...COURSE, y1: 91, y2: 103 });
const ROUTE_PROBE_TARGET = Object.freeze({ x: 1038, y: 100, z: 1013, closeness: 0 });
const ROUTE_PROBE_CAGE = Object.freeze({
  x1: 1036,
  x2: 1040,
  y1: 99,
  y2: 103,
  z1: 1011,
  z2: 1015,
  block: 'bedrock',
});
// Phase 6 first physical terrain course. Kevin begins at the bottom of a
// four-block water column and receives an ordinary !goToCoordinates request
// for dry ground on the east bank. The generated flat fixture supplies the
// substrate; this programmatic basin is captured and restored by the same
// mechanism as the established Scenario Lab courses.
const TERRAIN_SWIM_COURSE = Object.freeze({ x1: 1025, x2: 1041, y1: 95, y2: 102, z1: 1004, z2: 1013 });
const TERRAIN_SWIM_START = Object.freeze({ x: 1029.5, y: 96, z: 1008.5 });
const TERRAIN_SWIM_GOAL = Object.freeze({ x: 1038, y: 100, z: 1008, closeness: 0 });
const TERRAIN_SWIM_BASIN = Object.freeze({ x1: 1027, x2: 1032, y1: 95, y2: 99, z1: 1006, z2: 1011 });
const TERRAIN_SWIM_WATER = Object.freeze({ x1: 1028, x2: 1031, y1: 96, y2: 99, z1: 1007, z2: 1010 });
const TERRAIN_SWIM_OBSERVER = Object.freeze({
  x: TERRAIN_SWIM_GOAL.x + 2.5,
  y: TERRAIN_SWIM_GOAL.y,
  z: TERRAIN_SWIM_GOAL.z + 4.5,
});
// Phase 6 composed terrain course. One bedrock-sided corridor forces the real
// package Pathfinder to use every destructive/building locomotion mechanism in
// sequence. The fixture grants ordinary player supplies; no helper teleports,
// topology planner, or per-segment command advances the body.
const TERRAIN_CHAIN_COURSE = Object.freeze({ x1: 1025, x2: 1054, y1: 94, y2: 110, z1: 1007, z2: 1009 });
const TERRAIN_CHAIN_START = Object.freeze({ x: 1027.5, y: 100, z: 1008.5 });
const TERRAIN_CHAIN_GOAL = Object.freeze({ x: 1052, y: 107, z: 1008, closeness: 0 });
const TERRAIN_CHAIN_OBSERVER = Object.freeze({ x: 1052.5, y: 100, z: 1012.5 });
const TERRAIN_CHAIN_DIG = Object.freeze([
  Object.freeze({ x: 1031, y: 100, z: 1008 }),
  Object.freeze({ x: 1031, y: 101, z: 1008 }),
]);
const TERRAIN_CHAIN_PARKOUR_GAP = Object.freeze({ x1: 1034, x2: 1035, y: 99, z: 1008 });
const TERRAIN_CHAIN_BRIDGE = Object.freeze({ x1: 1038, x2: 1041, y: 99, z: 1008 });
const TERRAIN_CHAIN_TOWER = Object.freeze({ x: 1043, y1: 100, y2: 101, z: 1008 });
const TERRAIN_CHAIN_STAIR_BREAKS = Object.freeze([
  Object.freeze({ x: 1044, y: 105, z: 1008 }),
  Object.freeze({ x: 1045, y: 104, z: 1008 }),
  Object.freeze({ x: 1045, y: 105, z: 1008 }),
  Object.freeze({ x: 1045, y: 106, z: 1008 }),
  Object.freeze({ x: 1046, y: 105, z: 1008 }),
  Object.freeze({ x: 1046, y: 106, z: 1008 }),
  Object.freeze({ x: 1046, y: 107, z: 1008 }),
  Object.freeze({ x: 1047, y: 106, z: 1008 }),
  Object.freeze({ x: 1047, y: 107, z: 1008 }),
]);
const TERRAIN_CHAIN_DESCENT = Object.freeze({ fromY: 106, toY: 103, landingX: 1048 });
const TERRAIN_CHAIN_WATER = Object.freeze({ x: 1050, y1: 103, y2: 106, z: 1008 });
const TERRAIN_CHAIN_SCAFFOLD = Object.freeze({ item: 'dirt', count: 12 });
const STANCE_COURSE = Object.freeze({ x1: 1026, x2: 1058, y1: 99, y2: 103, z1: 1006, z2: 1038 });
const STANCE_TARGET = Object.freeze({ x: 1056, y: 100, z: 1008 });
const STANCE_WALLS = Object.freeze([
  Object.freeze({ x1: 1026, x2: 1058, y1: 100, y2: 102, z1: 1006, z2: 1006 }),
  Object.freeze({ x1: 1026, x2: 1058, y1: 100, y2: 102, z1: 1038, z2: 1038 }),
  Object.freeze({ x1: 1026, x2: 1026, y1: 100, y2: 102, z1: 1006, z2: 1038 }),
  Object.freeze({ x1: 1058, x2: 1058, y1: 100, y2: 102, z1: 1006, z2: 1038 }),
  // The only route into the target-side corridor passes the far end of this
  // separator. The bounded advisory search must explore the chamber; the real
  // Pathfinder activity then has enough time to take the same physical route.
  Object.freeze({ x1: 1054, x2: 1054, y1: 100, y2: 102, z1: 1007, z2: 1036 }),
]);
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
const FINITE_BREAK_COST_PLUG_BLOCK = 'oak_log';

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
// orchestrate-charcoal places NOTHING. The model interprets the plain-language
// promise once; the Phase 3 Mission must then derive one causal Activity at a
// time from current Minecraft state, through exact verified delivery.
const DELIVER_SPEC = Object.freeze({
  'deliver-item': Object.freeze({ item: 'dirt', quantity: 1, placeSource: true, waitMs: 120_000 }),
  // 20 minutes. The 10-minute window ended with the furnace crafted and the
  // companion gathering logs to smelt -- three steps from done. This chain is
  // eight or nine physical stages, each with real travel and mining in it.
  'orchestrate-charcoal': Object.freeze({ item: 'charcoal', quantity: 8, placeSource: false, waitMs: 1_200_000 }),
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
// A walk-up stone outcrop for the orchestration course, a few blocks from the
// bot's start and standing proud of the grass so it has faces to mine from.
const OUTCROP = Object.freeze({ x1: 1036, x2: 1039, y1: 100, y2: 102, z1: 1012, z2: 1015 });
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
// How many clarifying questions the scenario will answer. Bounded so a bot
// that only ever asks cannot pass by conversation alone.
//
// Four was calibrated against a short chain and starved a long one. The
// 2026-08-17 orchestration run spent its whole budget inside the first 47
// seconds -- two of the four on questions a player would never be asked
// ("Would you like me to equip it for you?" right after crafting the pickaxe
// it needed) -- then asked a fifth at t+79s, got silence, and sat idle for
// 18.7 of the run's 20 minutes. The cap did not measure orchestration; it
// ended it. The charcoal chain is roughly a dozen steps, so the budget has to
// clear a dozen.
//
// This does not weaken the acceptance. The answer carries no method, no
// coordinates, and no next step, the item still has to physically arrive in
// the recipient's inventory, and every answer is recorded as evidence so the
// transcript shows exactly how much help the companion was given.
const MAX_CLARIFICATION_ANSWERS = 16;
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
    varianceCase: '',
    preflightMode: '',
    maxPromptTurns: null,
    operationTimeoutMs: null,
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
    else if (value === '--variance-case') options.varianceCase = String(argv[++index] || '');
    else if (value === '--preflight-mode') options.preflightMode = String(argv[++index] || '');
    else if (value === '--max-prompt-turns') options.maxPromptTurns = Number(argv[++index]);
    else if (value === '--operation-timeout-ms') options.operationTimeoutMs = Number(argv[++index]);
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
  if (!Number.isInteger(options.operationTimeoutMs) || options.operationTimeoutMs < 1_000) {
    throw new Error('--operation-timeout-ms must carry the worker-owned scenario timeout.');
  }
  if (!['follow', 'stop', 'deliver', 'player-route', 'route-probe', 'interaction-stance', 'request-completion', 'terrain'].includes(options.mode)) {
    throw new Error('Mode must be follow, stop, deliver, player-route, route-probe, interaction-stance, request-completion, or terrain.');
  }
  if (options.mode === 'deliver' && !Object.hasOwn(DELIVER_SPEC, options.course)) {
    throw new Error(`Deliver verification requires one of: ${Object.keys(DELIVER_SPEC).join(', ')}.`);
  }
  // And the converse, which cost several runs: a delivering course measured in
  // follow mode waits for follow ownership no delivery task will ever produce,
  // and fails on a timeout that looks like a gameplay defect.
  if (Object.hasOwn(DELIVER_SPEC, options.course) && options.mode !== 'deliver') {
    throw new Error(`Course ${options.course} must be measured with --mode deliver, got '${options.mode}'.`);
  }
  if (!['full', 'doorway-corridor', 'obstruction-follow', 'player-route-obstruction', 'pathfinding-finite-break-cost', 'player-route-best-reachable', 'route-probe-inconclusive', 'interaction-stance-inconclusive', 'request-completion', 'terrain-swim-exit', 'terrain-workaround-chain', ...Object.keys(DELIVER_SPEC)].includes(options.course)) {
    throw new Error('Course must be full, doorway-corridor, obstruction-follow, player-route-obstruction, pathfinding-finite-break-cost, player-route-best-reachable, route-probe-inconclusive, interaction-stance-inconclusive, request-completion, terrain-swim-exit, terrain-workaround-chain, deliver-item, or orchestrate-charcoal.');
  }
  if (options.mode === 'stop' && options.course !== 'full') {
    throw new Error('Stop verification requires the full course.');
  }
  if ((options.mode === 'route-probe') !== (options.course === 'route-probe-inconclusive')) {
    throw new Error('The route-probe-inconclusive course must be measured with --mode route-probe, and that mode serves no other course.');
  }
  if ((options.mode === 'interaction-stance') !== (options.course === 'interaction-stance-inconclusive')) {
    throw new Error('The interaction-stance-inconclusive course must be measured with --mode interaction-stance, and that mode serves no other course.');
  }
  if ((options.mode === 'request-completion') !== (options.course === 'request-completion')) {
    throw new Error('The request-completion course must be measured with --mode request-completion, and that mode serves no other course.');
  }
  if ((options.mode === 'terrain') !== ['terrain-swim-exit', 'terrain-workaround-chain'].includes(options.course)) {
    throw new Error('Terrain courses must be measured with --mode terrain, and that mode serves no other course.');
  }
  if ((options.mode === 'player-route') !== ['player-route-obstruction', 'pathfinding-finite-break-cost', 'player-route-best-reachable'].includes(options.course)) {
    throw new Error('Player-route courses must be measured with --mode player-route, and that mode serves no other course.');
  }
  if (options.mode === 'request-completion') {
    requestCompletionCase(options.varianceCase);
    if (!['off', 'on'].includes(options.preflightMode)) {
      throw new Error('Request-completion verification requires --preflight-mode off or on.');
    }
    if (!Number.isSafeInteger(options.maxPromptTurns) || options.maxPromptTurns < 1) {
      throw new Error('Request-completion verification requires a positive --max-prompt-turns value from the active profile.');
    }
    if (!options.naturalLanguage) {
      throw new Error('Request-completion verification must originate as controlled player chat.');
    }
  } else if (options.varianceCase || options.preflightMode || options.maxPromptTurns !== null) {
    throw new Error('--variance-case, --preflight-mode, and --max-prompt-turns belong only to request-completion verification.');
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

function verticalAscentObserved(samples, startY, minimumRise) {
  let lowObserved = false;
  for (const sample of Array.isArray(samples) ? samples : []) {
    const y = Number(sample?.position?.y);
    if (!Number.isFinite(y)) continue;
    if (y <= startY + 0.35) lowObserved = true;
    if (lowObserved && y >= startY + minimumRise) return true;
  }
  return false;
}

function orderedTerrainChainCheckpoints(samples) {
  const observations = Array.isArray(samples) ? samples : [];
  const definitions = [
    ['dig_exit', position => position.x >= 1032.25 && position.y >= 99.5],
    ['parkour_landing', position => position.x >= 1036.2 && position.y >= 99.5],
    ['bridge_exit', position => position.x >= 1042.2 && position.y >= 99.5],
    ['tower_top', position => position.x >= 1042.5 && position.x <= 1044.5 && position.y >= 102.75],
    ['stair_top', position => position.x >= 1046.5 && position.y >= 105.65],
    ['descent_landing', position => position.x >= 1047.5 && position.x <= 1049.25 && position.y <= 103.4],
    ['swim_surface', position => Math.floor(position.x) === TERRAIN_CHAIN_WATER.x
      && position.y >= TERRAIN_CHAIN_WATER.y2 + 0.45],
    ['dry_goal', position => position.x >= 1051.5 && position.y >= 106.8],
  ];
  const checkpoints = [];
  let cursor = 0;
  for (const [name, predicate] of definitions) {
    const relativeIndex = observations.slice(cursor).findIndex(sample => {
      const position = sample?.position;
      return [position?.x, position?.y, position?.z].every(Number.isFinite)
        && predicate(position);
    });
    if (relativeIndex < 0) return { complete: false, checkpoints, missing: name };
    const index = cursor + relativeIndex;
    checkpoints.push({ name, index, ...observations[index] });
    cursor = index + 1;
  }
  return { complete: true, checkpoints, missing: null };
}

function inventorySnapshot(bot) {
  return (bot?.inventory?.items?.() || [])
    .map(item => ({ name: item.name, count: Number(item.count) || 0, slot: Number(item.slot) }))
    .sort((left, right) => left.slot - right.slot || left.name.localeCompare(right.name));
}

function inconclusiveRouteProbeStatus(terminal) {
  if (terminal?.code !== 'skill_route_unproven') return null;
  const match = String(terminal?.detail || '').match(
    /without a conclusive answer \((partial|timeout)\)/i,
  );
  return match ? match[1].toLowerCase() : null;
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
    retryable: result.retryable === true,
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
    mainHand: state?.body?.mainHand || null,
    inventoryCounts: { ...(state?.inventory?.counts || {}) },
    held: state?.action?.held === true,
    idle: state?.action?.isIdle === true,
    pathfinding: state?.action?.pathfinding || null,
    current: state?.action?.current || null,
    stopRequestedAt: state?.action?.stopRequestedAt ?? null,
    stopTimedOutAt: state?.action?.stopTimedOutAt ?? null,
    traversalPolicy: state?.identity?.runtime?.traversal || null,
    preflightPolicy: state?.identity?.runtime?.preflight || null,
    modelMeasurement: state?.modelMeasurement?.conversation || null,
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

function normalizedCounts(value) {
  return Object.fromEntries(
    Object.entries(value || {})
      .filter(([, count]) => Number(count) > 0)
      .map(([name, count]) => [name, Number(count)])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function fixedPosition(value) {
  if (!value || ![value.x, value.y, value.z].every(Number.isFinite)) return null;
  return {
    x: Number(Number(value.x).toFixed(3)),
    y: Number(Number(value.y).toFixed(3)),
    z: Number(Number(value.z).toFixed(3)),
  };
}

function latestResult(results) {
  return [...results.values()].sort((left, right) => (
    Number(left?.finishedAt || left?.startedAt || 0) - Number(right?.finishedAt || right?.startedAt || 0)
  )).at(-1) || null;
}

function stablePreflightResults(value, path = 'action', output = [], seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return output;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => stablePreflightResults(entry, `${path}[${index}]`, output, seen));
    return output;
  }
  const routeShaped = /(?:route|probe|preflight|stance|path)/i.test(path)
    && typeof value.status === 'string';
  if (routeShaped) {
    const stable = {
      owner: path.split(/[.[\]]/).filter(Boolean).slice(0, 3).join('.'),
      operation: path,
      status: value.status,
      code: typeof value.code === 'string' ? value.code : null,
      conclusive: typeof value.conclusive === 'boolean'
        ? value.conclusive
        : ['success', 'noPath'].includes(value.status) ? true : null,
      retryable: typeof value.retryable === 'boolean' ? value.retryable : null,
    };
    stable.resultFingerprint = fingerprintVarianceValue(stable);
    output.push(stable);
  }
  for (const [key, child] of Object.entries(value)) {
    stablePreflightResults(child, `${path}.${key}`, output, seen);
  }
  return output;
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

function compressFixture(entries, region = COURSE) {
  const byCoordinate = new Map(entries.map(entry => [`${entry.x},${entry.y},${entry.z}`, entry.state]));
  const runs = [];
  for (let y = region.y1; y <= region.y2; y += 1) {
    for (let z = region.z1; z <= region.z2; z += 1) {
      let startX = region.x1;
      let state = byCoordinate.get(`${startX},${y},${z}`);
      for (let x = region.x1 + 1; x <= region.x2 + 1; x += 1) {
        const next = x <= region.x2 ? byCoordinate.get(`${x},${y},${z}`) : null;
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
  const obstructionFollowCourse = options.course === 'obstruction-follow';
  const playerRouteObstructionCourse = options.course === 'player-route-obstruction';
  const finiteBreakCostCourse = options.course === 'pathfinding-finite-break-cost';
  const playerRouteBreakCourse = playerRouteObstructionCourse || finiteBreakCostCourse;
  const playerRouteBestCourse = options.course === 'player-route-best-reachable';
  const playerRouteCourse = playerRouteBreakCourse || playerRouteBestCourse;
  const obstructionCourse = obstructionFollowCourse || playerRouteBreakCourse;
  const obstructionPlugBlock = finiteBreakCostCourse
    ? FINITE_BREAK_COST_PLUG_BLOCK
    : OBSTRUCTION_PLUG_BLOCK;
  const orchestrationCourse = options.course === 'orchestrate-charcoal';
  const routeProbeCourse = options.course === 'route-probe-inconclusive';
  const interactionStanceCourse = options.course === 'interaction-stance-inconclusive';
  const requestCompletionCourse = options.course === 'request-completion';
  const terrainSwimCourse = options.course === 'terrain-swim-exit';
  const terrainChainCourse = options.course === 'terrain-workaround-chain';
  const varianceCase = requestCompletionCourse ? requestCompletionCase(options.varianceCase) : null;
  const generatedFlatCourse = options.course === 'deliver-item'
    || routeProbeCourse
    || interactionStanceCourse
    || requestCompletionCourse
    || terrainSwimCourse
    || terrainChainCourse;
  const activeCourse = requestCompletionCourse
    ? REQUEST_COMPLETION_COURSE
    : interactionStanceCourse
    ? STANCE_COURSE
    : routeProbeCourse
    ? ROUTE_PROBE_COURSE
    : terrainSwimCourse
    ? TERRAIN_SWIM_COURSE
    : terrainChainCourse
    ? TERRAIN_CHAIN_COURSE
    : playerRouteBestCourse ? PLAYER_ROUTE_BLOCKED_COURSE : COURSE;
  const botStart = terrainSwimCourse
    ? TERRAIN_SWIM_START
    : terrainChainCourse
    ? TERRAIN_CHAIN_START
    : BOT_START;
  const targetStart = terrainSwimCourse
    ? TERRAIN_SWIM_OBSERVER
    : terrainChainCourse
    ? TERRAIN_CHAIN_OBSERVER
    : playerRouteBestCourse
    ? PLAYER_ROUTE_BLOCKED_TARGET
    : playerRouteBreakCourse ? PLAYER_ROUTE_TARGET : TARGET_START;
  if (deliverCourse) {
    const spec = DELIVER_SPEC[options.course];
    DELIVER_ITEM = spec.item;
    DELIVER_QUANTITY = spec.quantity;
    DELIVER_PLACE_SOURCE = spec.placeSource;
    DELIVER_WAIT_MS = spec.waitMs;
  }
  const activeWaypoints = routeProbeCourse || interactionStanceCourse || terrainSwimCourse || terrainChainCourse || playerRouteCourse
    ? []
    : options.mode === 'stop' || options.course === 'full'
    ? WAYPOINTS
    : WAYPOINTS.slice(0, 2);
  const evidence = {
    schemaVersion: 1,
    scenario: requestCompletionCourse
      ? `phase-5-request-completion-${varianceCase.id}`
      : terrainSwimCourse
      ? 'phase-6-native-swim-exit-to-dry-bank'
      : terrainChainCourse
      ? 'phase-6-composed-terrain-workaround-chain'
      : finiteBreakCostCourse
      ? 'reach-stationary-player-through-expensive-finite-break'
      : playerRouteCourse
      ? (playerRouteBestCourse
        ? 'advance-to-best-available-position-outside-unbreakable-enclosure'
        : 'reach-stationary-player-through-breakable-obstruction')
      : interactionStanceCourse
      ? 'inconclusive-interaction-stance-probe-falls-through-to-real-pathfinder'
      : routeProbeCourse
      ? 'inconclusive-whole-route-probe-remains-unproven'
      : options.mode === 'follow'
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
      course: activeCourse,
      courseVariant: options.course,
      botStart,
      targetStart,
      wall: WALL,
      doorway: DOORWAY,
      platform: PLATFORM,
      routeProbeTarget: routeProbeCourse ? ROUTE_PROBE_TARGET : null,
      routeProbeCage: routeProbeCourse ? ROUTE_PROBE_CAGE : null,
      terrainSwim: terrainSwimCourse ? {
        start: TERRAIN_SWIM_START,
        goal: TERRAIN_SWIM_GOAL,
        basin: TERRAIN_SWIM_BASIN,
        water: TERRAIN_SWIM_WATER,
      } : null,
      terrainChain: terrainChainCourse ? {
        start: TERRAIN_CHAIN_START,
        goal: TERRAIN_CHAIN_GOAL,
        dig: TERRAIN_CHAIN_DIG,
        parkourGap: TERRAIN_CHAIN_PARKOUR_GAP,
        bridge: TERRAIN_CHAIN_BRIDGE,
        tower: TERRAIN_CHAIN_TOWER,
        stairBreaks: TERRAIN_CHAIN_STAIR_BREAKS,
        descent: TERRAIN_CHAIN_DESCENT,
        water: TERRAIN_CHAIN_WATER,
        scaffold: TERRAIN_CHAIN_SCAFFOLD,
      } : null,
      interactionStanceTarget: interactionStanceCourse ? STANCE_TARGET : null,
      interactionStanceWalls: interactionStanceCourse ? STANCE_WALLS : null,
      waypoints: activeWaypoints,
      requestCompletion: requestCompletionCourse ? {
        caseId: varianceCase.id,
        expectedT0: varianceCase.expectedT0,
        expectedT0Fingerprint: varianceCase.fixtureFingerprint,
      } : null,
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
    const routeTarget = marker(runId, phase, 'ROUTE_TARGET');
    const swimBottom = marker(runId, phase, 'SWIM_BOTTOM');
    const swimSurface = marker(runId, phase, 'SWIM_SURFACE');
    const swimBank = marker(runId, phase, 'SWIM_BANK');
    const blockedWest = marker(runId, phase, 'BLOCKED_WEST');
    const blockedFloor = marker(runId, phase, 'BLOCKED_FLOOR');
    const blockedRoof = marker(runId, phase, 'BLOCKED_ROOF');
    await paperCommand(`scoreboard players set ${begin} ${OBJECTIVE} 1`);
    await paperCommand(`data get entity ${options.bot} Pos`);
    await paperCommand(`data get entity ${TARGET_NAME} Pos`);
    await paperCommand(`execute if block 1033 100 1007 minecraft:stone_bricks run scoreboard players set ${wall} ${OBJECTIVE} 1`);
    await paperCommand(`execute if block 1033 100 1008 minecraft:air run scoreboard players set ${opening} ${OBJECTIVE} 1`);
    await paperCommand(`execute if block 1030 100 1014 minecraft:smooth_stone run scoreboard players set ${step} ${OBJECTIVE} 1`);
    await paperCommand(`execute if block ${OBSTRUCTION_PLUG.x} ${OBSTRUCTION_PLUG.y1} ${OBSTRUCTION_PLUG.z} minecraft:${obstructionPlugBlock} run scoreboard players set ${plug} ${OBJECTIVE} 1`);
    if (routeProbeCourse) {
      await paperCommand(
        `execute if block ${ROUTE_PROBE_TARGET.x} ${ROUTE_PROBE_TARGET.y} ${ROUTE_PROBE_TARGET.z} `
        + `minecraft:${ROUTE_PROBE_CAGE.block} run scoreboard players set ${routeTarget} ${OBJECTIVE} 1`,
      );
    }
    if (terrainSwimCourse) {
      await paperCommand(
        `execute if block ${Math.floor(TERRAIN_SWIM_START.x)} ${Math.floor(TERRAIN_SWIM_START.y)} ${Math.floor(TERRAIN_SWIM_START.z)} `
        + `minecraft:water run scoreboard players set ${swimBottom} ${OBJECTIVE} 1`,
      );
      await paperCommand(
        `execute if block ${Math.floor(TERRAIN_SWIM_START.x)} ${TERRAIN_SWIM_WATER.y2} ${Math.floor(TERRAIN_SWIM_START.z)} `
        + `minecraft:water run scoreboard players set ${swimSurface} ${OBJECTIVE} 1`,
      );
      await paperCommand(
        `execute if block ${TERRAIN_SWIM_GOAL.x} ${TERRAIN_SWIM_GOAL.y - 1} ${TERRAIN_SWIM_GOAL.z} `
        + `minecraft:grass_block run scoreboard players set ${swimBank} ${OBJECTIVE} 1`,
      );
    }
    if (playerRouteBestCourse) {
      await paperCommand(
        `execute if block ${PLAYER_ROUTE_BLOCKED_CAGE.x1} ${Math.floor(targetStart.y)} ${Math.floor(targetStart.z)} `
        + `minecraft:bedrock run scoreboard players set ${blockedWest} ${OBJECTIVE} 1`,
      );
      await paperCommand(
        `execute if block ${Math.floor(targetStart.x)} ${PLAYER_ROUTE_BLOCKED_CAGE.y1} ${Math.floor(targetStart.z)} `
        + `minecraft:bedrock run scoreboard players set ${blockedFloor} ${OBJECTIVE} 1`,
      );
      await paperCommand(
        `execute if block ${Math.floor(targetStart.x)} ${PLAYER_ROUTE_BLOCKED_CAGE.y2} ${Math.floor(targetStart.z)} `
        + `minecraft:bedrock run scoreboard players set ${blockedRoof} ${OBJECTIVE} 1`,
      );
    }
    // Did provisioning actually place the acquisition source? A goal that fails
    // to find its material is only meaningful if the material was really there.
    if (DELIVER_PLACE_SOURCE) {
      await paperCommand(`execute if block ${DELIVER_SOURCE.x1} ${DELIVER_SOURCE.y} ${DELIVER_SOURCE.z1} minecraft:${DELIVER_ITEM} run scoreboard players set ${source} ${OBJECTIVE} 1`);
    }
    // Is the world under this course actually dry land, and does it stay dry
    // past the distance acquisition relocates? On the captured follow fixture the
    // answer is no, and every deliver run there died the same way. Measure it
    // rather than trust the fixture name.
    const ground = marker(runId, phase, 'GRND');
    const dryLand = DELIVER_DRY_LAND.map(probe => ({
      ...probe,
      name_marker: marker(runId, phase, `DRY_${probe.name}`),
    }));
    if (deliverCourse) {
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
      routeTargetVerified: markerObserved(window, routeTarget),
      swimWaterColumnVerified: markerObserved(window, swimBottom) && markerObserved(window, swimSurface),
      swimBankVerified: markerObserved(window, swimBank),
      blockedCageVerified: markerObserved(window, blockedWest)
        && markerObserved(window, blockedFloor)
        && markerObserved(window, blockedRoof),
      lines: window,
    };
  };

  const captureFixtureRuns = () => {
    const entries = [];
    for (let y = activeCourse.y1; y <= activeCourse.y2; y += 1) {
      for (let z = activeCourse.z1; z <= activeCourse.z2; z += 1) {
        for (let x = activeCourse.x1; x <= activeCourse.x2; x += 1) {
          const block = target.blockAt(new Vec3(x, y, z));
          if (!block) throw new Error(`Fixture block ${x},${y},${z} was not loaded.`);
          if (block.entity) {
            throw new Error(`Fixture contains block entity ${block.name} at ${x},${y},${z}; refusing mutation.`);
          }
          entries.push({ x, y, z, state: blockState(block) });
        }
      }
    }
    return compressFixture(entries, activeCourse);
  };

  const restoreFixture = async () => {
    if (!baselineRuns) return;
    // Keep the standing surface continuously present while restoring. The
    // route course mutates y=99 under its cage; its verified solid baseline is
    // written back below, while only the body-space/roof layers are cleared.
    await paperCommand(`fill ${activeCourse.x1} ${activeCourse.y1} ${activeCourse.z1} ${activeCourse.x2} ${activeCourse.y2} ${activeCourse.z2} air`);
    for (const run of baselineRuns) {
      if (run.state === 'minecraft:air') continue;
      await paperCommand(`fill ${run.x1} ${run.y} ${run.z} ${run.x2} ${run.y} ${run.z} ${run.state}`);
    }
    if (generatedFlatCourse) await paperCommand('forceload remove all');
    fixtureMutated = false;
  };

  const interactionStanceFixtureReady = () => {
    if (!interactionStanceCourse) return true;
    const wallContains = (wall, x, y, z) => x >= wall.x1 && x <= wall.x2
      && y >= wall.y1 && y <= wall.y2
      && z >= wall.z1 && z <= wall.z2;
    for (let y = STANCE_COURSE.y1; y <= STANCE_COURSE.y2; y += 1) {
      for (let z = STANCE_COURSE.z1; z <= STANCE_COURSE.z2; z += 1) {
        for (let x = STANCE_COURSE.x1; x <= STANCE_COURSE.x2; x += 1) {
          const block = target.blockAt(new Vec3(x, y, z));
          if (!block) return false;
          const expectedBedrock = y === STANCE_COURSE.y1
            || STANCE_WALLS.some(wall => wallContains(wall, x, y, z));
          if (expectedBedrock ? block.name !== 'bedrock' : block.name !== 'air') return false;
        }
      }
    }
    return true;
  };

  const terrainChainSnapshot = () => {
    const nameAt = ({ x, y, z }) => target.blockAt(new Vec3(x, y, z))?.name || null;
    const line = (x1, x2, y, z) => Array.from(
      { length: x2 - x1 + 1 },
      (_, offset) => ({ x: x1 + offset, y, z }),
    );
    const column = (x, y1, y2, z) => Array.from(
      { length: y2 - y1 + 1 },
      (_, offset) => ({ x, y: y1 + offset, z }),
    );
    return {
      dig: TERRAIN_CHAIN_DIG.map(nameAt),
      parkourGap: line(
        TERRAIN_CHAIN_PARKOUR_GAP.x1,
        TERRAIN_CHAIN_PARKOUR_GAP.x2,
        TERRAIN_CHAIN_PARKOUR_GAP.y,
        TERRAIN_CHAIN_PARKOUR_GAP.z,
      ).map(nameAt),
      bridge: line(
        TERRAIN_CHAIN_BRIDGE.x1,
        TERRAIN_CHAIN_BRIDGE.x2,
        TERRAIN_CHAIN_BRIDGE.y,
        TERRAIN_CHAIN_BRIDGE.z,
      ).map(nameAt),
      tower: column(
        TERRAIN_CHAIN_TOWER.x,
        TERRAIN_CHAIN_TOWER.y1,
        TERRAIN_CHAIN_TOWER.y2,
        TERRAIN_CHAIN_TOWER.z,
      ).map(nameAt),
      stairBreaks: TERRAIN_CHAIN_STAIR_BREAKS.map(nameAt),
      water: column(
        TERRAIN_CHAIN_WATER.x,
        TERRAIN_CHAIN_WATER.y1,
        TERRAIN_CHAIN_WATER.y2,
        TERRAIN_CHAIN_WATER.z,
      ).map(nameAt),
      bank: nameAt({ x: TERRAIN_CHAIN_GOAL.x, y: TERRAIN_CHAIN_GOAL.y - 1, z: TERRAIN_CHAIN_GOAL.z }),
    };
  };

  const terrainChainFixtureReady = () => {
    if (!terrainChainCourse) return true;
    const snapshot = terrainChainSnapshot();
    return snapshot.dig.every(name => name === 'stone')
      && snapshot.parkourGap.every(name => name === 'air')
      && snapshot.bridge.every(name => name === 'air')
      && snapshot.tower.every(name => name === 'air')
      && snapshot.stairBreaks.every(name => name === 'stone')
      && snapshot.water.every(name => name === 'water')
      && snapshot.bank === 'grass_block';
  };

  const provisionFixture = async () => {
    await restoreFixture();
    fixtureMutated = true;
    const commands = [
      // Deliver-course preamble. Both must precede the first fill: the forceload
      // so that no fill or probe below can land in an unloaded chunk and report a
      // false negative, and the world spawn so a death respawns at the course
      // rather than 1,440 blocks away at the generated world's origin.
      ...(generatedFlatCourse
        ? [
            `forceload add ${DELIVER_FORCELOAD.x1} ${DELIVER_FORCELOAD.z1} ${DELIVER_FORCELOAD.x2} ${DELIVER_FORCELOAD.z2}`,
            `setworldspawn ${DELIVER_WORLD_SPAWN.x} ${DELIVER_WORLD_SPAWN.y} ${DELIVER_WORLD_SPAWN.z}`,
          ]
        : []),
      // A surface stone outcrop, which a real forest has and a superflat recipe
      // does not. Without it the only stone is under seven layers of dirt, so the
      // companion digs a one-wide shaft into solid rock and every cobblestone
      // candidate is then rejected for no_safe_stance -- twelve of them, in the
      // run that got this far. That rejection looks like a genuine skill defect
      // and may well be one, but the geometry that provokes it is this fixture's
      // invention, not Minecraft's. Give it rock it can walk up to.
      ...(orchestrationCourse
        ? [
            `fill ${OUTCROP.x1} ${OUTCROP.y1} ${OUTCROP.z1} ${OUTCROP.x2} ${OUTCROP.y2} ${OUTCROP.z2} stone`,
          ]
        : []),
      // The orchestration course wants open forest. Clearing the box and walling
      // it is follow geometry, and it boxed a bot whose task is to find trees --
      // the first full run reported "the nearest oak log is unreachable from my
      // position" from inside it.
      ...(orchestrationCourse
        ? []
        : terrainSwimCourse
          ? [`fill ${TERRAIN_SWIM_COURSE.x1} ${TERRAIN_SWIM_COURSE.y1} ${TERRAIN_SWIM_COURSE.z1} ${TERRAIN_SWIM_COURSE.x2} ${TERRAIN_SWIM_COURSE.y2} ${TERRAIN_SWIM_COURSE.z2} air`]
        : terrainChainCourse
          ? [`fill ${TERRAIN_CHAIN_COURSE.x1} ${TERRAIN_CHAIN_COURSE.y1} ${TERRAIN_CHAIN_COURSE.z1} ${TERRAIN_CHAIN_COURSE.x2} ${TERRAIN_CHAIN_COURSE.y2} ${TERRAIN_CHAIN_COURSE.z2} air`]
        : interactionStanceCourse
          ? [`fill ${STANCE_COURSE.x1} ${COURSE.y1} ${STANCE_COURSE.z1} ${STANCE_COURSE.x2} ${STANCE_COURSE.y2} ${STANCE_COURSE.z2} air`]
          : [`fill ${COURSE.x1} ${COURSE.y1} ${COURSE.z1} ${COURSE.x2} ${COURSE.y2} ${COURSE.z2} air`]),
      ...(deliverCourse && DELIVER_PLACE_SOURCE
        ? [
            `fill ${DELIVER_SOURCE.x1} ${DELIVER_SOURCE.y} ${DELIVER_SOURCE.z1} ${DELIVER_SOURCE.x2} ${DELIVER_SOURCE.y} ${DELIVER_SOURCE.z2} ${DELIVER_ITEM}`,
          ]
        : []),
      ...(requestCompletionCourse
        ? [
            `setblock ${REQUEST_COMPLETION_FIXTURE.craftingTable.x} ${REQUEST_COMPLETION_FIXTURE.craftingTable.y} ${REQUEST_COMPLETION_FIXTURE.craftingTable.z} ${REQUEST_COMPLETION_FIXTURE.craftingTable.block}`,
          ]
        : []),
      ...(routeProbeCourse
        ? [
            `fill ${ROUTE_PROBE_CAGE.x1} ${ROUTE_PROBE_CAGE.y1} ${ROUTE_PROBE_CAGE.z1} `
            + `${ROUTE_PROBE_CAGE.x2} ${ROUTE_PROBE_CAGE.y2} ${ROUTE_PROBE_CAGE.z2} ${ROUTE_PROBE_CAGE.block}`,
          ]
        : interactionStanceCourse
        ? [
            `fill ${STANCE_COURSE.x1} ${STANCE_COURSE.y1} ${STANCE_COURSE.z1} `
            + `${STANCE_COURSE.x2} ${STANCE_COURSE.y1} ${STANCE_COURSE.z2} bedrock`,
            ...STANCE_WALLS.map(wall => (
              `fill ${wall.x1} ${wall.y1} ${wall.z1} ${wall.x2} ${wall.y2} ${wall.z2} bedrock`
            )),
          ]
        : terrainSwimCourse
        ? [
            `fill ${TERRAIN_SWIM_COURSE.x1} ${TERRAIN_SWIM_COURSE.y1} ${TERRAIN_SWIM_COURSE.z1} `
            + `${TERRAIN_SWIM_COURSE.x2} ${TERRAIN_SWIM_GOAL.y - 2} ${TERRAIN_SWIM_COURSE.z2} dirt`,
            `fill ${TERRAIN_SWIM_COURSE.x1} ${TERRAIN_SWIM_GOAL.y - 1} ${TERRAIN_SWIM_COURSE.z1} `
            + `${TERRAIN_SWIM_COURSE.x2} ${TERRAIN_SWIM_GOAL.y - 1} ${TERRAIN_SWIM_COURSE.z2} grass_block`,
            `fill ${TERRAIN_SWIM_BASIN.x1} ${TERRAIN_SWIM_BASIN.y1} ${TERRAIN_SWIM_BASIN.z1} `
            + `${TERRAIN_SWIM_BASIN.x2} ${TERRAIN_SWIM_BASIN.y2} ${TERRAIN_SWIM_BASIN.z2} stone`,
            `fill ${TERRAIN_SWIM_WATER.x1} ${TERRAIN_SWIM_WATER.y1} ${TERRAIN_SWIM_WATER.z1} `
            + `${TERRAIN_SWIM_WATER.x2} ${TERRAIN_SWIM_WATER.y2} ${TERRAIN_SWIM_WATER.z2} water`,
          ]
        : terrainChainCourse
        ? [
            // The course is a single-cell-wide physical corridor. Bedrock owns
            // the boundary; every mutable cell inside is ordinary terrain.
            `fill ${TERRAIN_CHAIN_COURSE.x1} ${TERRAIN_CHAIN_COURSE.y1} ${TERRAIN_CHAIN_COURSE.z1} `
            + `${TERRAIN_CHAIN_COURSE.x2} ${TERRAIN_CHAIN_COURSE.y1} ${TERRAIN_CHAIN_COURSE.z2} bedrock`,
            `fill ${TERRAIN_CHAIN_COURSE.x1} ${TERRAIN_CHAIN_COURSE.y1 + 1} ${TERRAIN_CHAIN_COURSE.z1} `
            + `${TERRAIN_CHAIN_COURSE.x2} ${TERRAIN_CHAIN_COURSE.y2} ${TERRAIN_CHAIN_COURSE.z1} bedrock`,
            `fill ${TERRAIN_CHAIN_COURSE.x1} ${TERRAIN_CHAIN_COURSE.y1 + 1} ${TERRAIN_CHAIN_COURSE.z2} `
            + `${TERRAIN_CHAIN_COURSE.x2} ${TERRAIN_CHAIN_COURSE.y2} ${TERRAIN_CHAIN_COURSE.z2} bedrock`,
            `fill ${TERRAIN_CHAIN_COURSE.x1} ${TERRAIN_CHAIN_COURSE.y1 + 1} ${TERRAIN_CHAIN_COURSE.z1} `
            + `${TERRAIN_CHAIN_COURSE.x1} ${TERRAIN_CHAIN_COURSE.y2} ${TERRAIN_CHAIN_COURSE.z2} bedrock`,
            `fill ${TERRAIN_CHAIN_COURSE.x2} ${TERRAIN_CHAIN_COURSE.y1 + 1} ${TERRAIN_CHAIN_COURSE.z1} `
            + `${TERRAIN_CHAIN_COURSE.x2} ${TERRAIN_CHAIN_COURSE.y2} ${TERRAIN_CHAIN_COURSE.z2} bedrock`,

            // Dig-through, then a two-cell gap whose cheapest and only
            // non-mutating crossing is the native three-block parkour edge.
            'fill 1026 99 1008 1033 99 1008 smooth_stone',
            'fill 1026 102 1008 1031 102 1008 bedrock',
            'fill 1031 100 1008 1031 101 1008 stone',
            'fill 1036 99 1008 1037 99 1008 smooth_stone',
            // Full movement and parkour clearance remains below this roof,
            // but no pre-shaft cell can pillar above the stair tunnel.
            'fill 1026 104 1008 1042 104 1008 bedrock',

            // The following four-cell gap is longer than the executable
            // parkour edge and therefore consumes a horizontal dirt bridge.
            'fill 1042 99 1008 1043 99 1008 smooth_stone',

            // A capped shaft has one exit three blocks above the corridor.
            // Its bedrock boundary reaches the course floor so the bridge pit
            // cannot become a lower bypass around the tower and stair tunnel.
            // The only forward route is the package-owned 1x1 tower edge.
            'fill 1044 95 1008 1044 102 1008 bedrock',
            'fill 1042 105 1008 1043 105 1008 bedrock',

            // Three rising stone columns form a real stair tunnel. The sloped
            // bedrock roof makes repeated vertical pillaring a dead end while
            // leaving each forward/up excavation edge executable.
            'setblock 1044 105 1008 stone',
            'setblock 1044 106 1008 bedrock',
            'fill 1045 103 1008 1045 106 1008 stone',
            'setblock 1045 103 1008 bedrock',
            'setblock 1045 107 1008 bedrock',
            'fill 1046 104 1008 1046 107 1008 stone',
            'setblock 1046 104 1008 bedrock',
            'setblock 1046 108 1008 bedrock',
            'fill 1047 105 1008 1047 107 1008 stone',
            'setblock 1047 105 1008 bedrock',
            'setblock 1047 109 1008 bedrock',

            // A three-block native drop lands directly beside the bottom of a
            // contained four-block water column. Its two-block-high lower
            // entrance admits the body without letting the upper source flow
            // west into the stair blocks. Swimming to its air node is the only
            // connection to the elevated dry bank and final goal.
            'setblock 1048 102 1008 stone',
            'setblock 1049 102 1008 stone',
            'setblock 1050 102 1008 stone',
            'fill 1049 105 1008 1049 106 1008 bedrock',
            `fill ${TERRAIN_CHAIN_WATER.x} ${TERRAIN_CHAIN_WATER.y1} ${TERRAIN_CHAIN_WATER.z} `
            + `${TERRAIN_CHAIN_WATER.x} ${TERRAIN_CHAIN_WATER.y2} ${TERRAIN_CHAIN_WATER.z} water`,
            'fill 1051 106 1008 1053 106 1008 grass_block',
          ]
        : playerRouteBestCourse
        ? [
            // A sealed bedrock shell makes exact arrival physically impossible
            // from every face. Clearing Kevin's inventory removes scaffolding
            // as a fixture variable; the measured contract is consumption of
            // Pathfinder's best available native route, not item acquisition.
            `clear ${options.bot}`,
            `fill ${PLAYER_ROUTE_BLOCKED_CAGE.x1} ${PLAYER_ROUTE_BLOCKED_CAGE.y1} ${PLAYER_ROUTE_BLOCKED_CAGE.z1} `
            + `${PLAYER_ROUTE_BLOCKED_CAGE.x2} ${PLAYER_ROUTE_BLOCKED_CAGE.y2} ${PLAYER_ROUTE_BLOCKED_CAGE.z2} air`,
            `fill ${PLAYER_ROUTE_BLOCKED_CAGE.x1} ${PLAYER_ROUTE_BLOCKED_CAGE.y1} ${PLAYER_ROUTE_BLOCKED_CAGE.z1} `
            + `${PLAYER_ROUTE_BLOCKED_CAGE.x2} ${PLAYER_ROUTE_BLOCKED_CAGE.y1} ${PLAYER_ROUTE_BLOCKED_CAGE.z2} bedrock`,
            `fill ${PLAYER_ROUTE_BLOCKED_CAGE.x1} ${PLAYER_ROUTE_BLOCKED_CAGE.y2} ${PLAYER_ROUTE_BLOCKED_CAGE.z1} `
            + `${PLAYER_ROUTE_BLOCKED_CAGE.x2} ${PLAYER_ROUTE_BLOCKED_CAGE.y2} ${PLAYER_ROUTE_BLOCKED_CAGE.z2} bedrock`,
            `fill ${PLAYER_ROUTE_BLOCKED_CAGE.x1} ${PLAYER_ROUTE_BLOCKED_CAGE.y1} ${PLAYER_ROUTE_BLOCKED_CAGE.z1} `
            + `${PLAYER_ROUTE_BLOCKED_CAGE.x1} ${PLAYER_ROUTE_BLOCKED_CAGE.y2} ${PLAYER_ROUTE_BLOCKED_CAGE.z2} bedrock`,
            `fill ${PLAYER_ROUTE_BLOCKED_CAGE.x2} ${PLAYER_ROUTE_BLOCKED_CAGE.y1} ${PLAYER_ROUTE_BLOCKED_CAGE.z1} `
            + `${PLAYER_ROUTE_BLOCKED_CAGE.x2} ${PLAYER_ROUTE_BLOCKED_CAGE.y2} ${PLAYER_ROUTE_BLOCKED_CAGE.z2} bedrock`,
            `fill ${PLAYER_ROUTE_BLOCKED_CAGE.x1} ${PLAYER_ROUTE_BLOCKED_CAGE.y1} ${PLAYER_ROUTE_BLOCKED_CAGE.z1} `
            + `${PLAYER_ROUTE_BLOCKED_CAGE.x2} ${PLAYER_ROUTE_BLOCKED_CAGE.y2} ${PLAYER_ROUTE_BLOCKED_CAGE.z1} bedrock`,
            `fill ${PLAYER_ROUTE_BLOCKED_CAGE.x1} ${PLAYER_ROUTE_BLOCKED_CAGE.y1} ${PLAYER_ROUTE_BLOCKED_CAGE.z2} `
            + `${PLAYER_ROUTE_BLOCKED_CAGE.x2} ${PLAYER_ROUTE_BLOCKED_CAGE.y2} ${PLAYER_ROUTE_BLOCKED_CAGE.z2} bedrock`,
            `fill ${PLAYER_ROUTE_BLOCKED_CAGE.x1 + 1} ${Math.floor(targetStart.y) - 1} ${PLAYER_ROUTE_BLOCKED_CAGE.z1 + 1} `
            + `${PLAYER_ROUTE_BLOCKED_CAGE.x2 - 1} ${Math.floor(targetStart.y) - 1} ${PLAYER_ROUTE_BLOCKED_CAGE.z2 - 1} smooth_stone`,
          ]
        : playerRouteBreakCourse
        ? [
            // The requester is already east of the wall. The doorway begins
            // sealed, so a successful finite goToPlayer must break the plug;
            // there is no moving-target timing dependency in this course.
            `fill ${OBSTRUCTION_WALL.x} ${OBSTRUCTION_WALL.y1} ${OBSTRUCTION_WALL.z1} ${OBSTRUCTION_WALL.x} ${OBSTRUCTION_WALL.y2} ${OBSTRUCTION_WALL.z2} stone_bricks`,
            ...(finiteBreakCostCourse ? [`clear ${options.bot}`] : []),
            `fill ${OBSTRUCTION_PLUG.x} ${OBSTRUCTION_PLUG.y1} ${OBSTRUCTION_PLUG.z} ${OBSTRUCTION_PLUG.x} ${OBSTRUCTION_PLUG.y2} ${OBSTRUCTION_PLUG.z} ${obstructionPlugBlock}`,
          ]
        : obstructionFollowCourse
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
      ...(orchestrationCourse || routeProbeCourse || interactionStanceCourse || terrainSwimCourse || terrainChainCourse || playerRouteBestCourse
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
      ...(requestCompletionCourse
        ? [
            `clear ${options.bot}`,
            `clear ${TARGET_NAME}`,
            ...varianceCase.grants.map(({ item, count }) => `give ${options.bot} ${item} ${count}`),
          ]
        : []),
      ...(terrainSwimCourse
        ? [
            `clear ${options.bot}`,
            `effect give ${options.bot} minecraft:water_breathing 60 0 true`,
          ]
        : []),
      ...(terrainChainCourse
        ? [
            `clear ${options.bot}`,
            `give ${options.bot} minecraft:${TERRAIN_CHAIN_SCAFFOLD.item} ${TERRAIN_CHAIN_SCAFFOLD.count}`,
            `give ${options.bot} minecraft:iron_pickaxe 1`,
            `effect give ${options.bot} minecraft:water_breathing 60 0 true`,
          ]
        : []),
      `gamemode survival ${options.bot}`,
      `gamemode survival ${TARGET_NAME}`,
      `tp ${options.bot} ${botStart.x} ${botStart.y} ${botStart.z}`,
      `tp ${TARGET_NAME} ${targetStart.x} ${targetStart.y} ${targetStart.z}`,
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
    if (interactionStanceCourse) {
      await waitFor(
        interactionStanceFixtureReady,
        Boolean,
        'controlled observer receipt of the complete interaction-stance maze',
        5_000,
      );
    }
    if (routeProbeCourse) {
      await waitFor(
        () => target.blockAt(new Vec3(
          ROUTE_PROBE_TARGET.x,
          ROUTE_PROBE_TARGET.y,
          ROUTE_PROBE_TARGET.z,
        ))?.name || null,
        name => name === ROUTE_PROBE_CAGE.block,
        'controlled observer receipt of the protected route-probe target',
        5_000,
      );
    }
    if (terrainChainCourse) {
      await waitFor(
        terrainChainFixtureReady,
        Boolean,
        'controlled observer receipt of the complete terrain workaround corridor',
        5_000,
      );
    }
    target.pathfinder.stop();
    target.clearControlStates();
    await waitFor(
      () => positionOf(target.entity),
      position => distance(position, targetStart) <= 0.3,
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
          && (!finiteBreakCostCourse
            || Object.values(compact.inventoryCounts || {}).every(count => Number(count) === 0))
          && (!terrainSwimCourse || (
            compact.traversalPolicy === 'full'
            && Object.values(compact.inventoryCounts || {}).every(count => Number(count) === 0)
          ))
          && (!terrainChainCourse || (
            compact.traversalPolicy === 'full'
            && Number(compact.inventoryCounts?.[TERRAIN_CHAIN_SCAFFOLD.item]) === TERRAIN_CHAIN_SCAFFOLD.count
            && Number(compact.inventoryCounts?.iron_pickaxe) === 1
          ))
          && distance(compact.position, botStart) <= 0.3;
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

  const targetInventoryCounts = () => {
    const counts = {};
    for (const item of target?.inventory?.items?.() || []) {
      counts[item.name] = (counts[item.name] || 0) + (Number(item.count) || 0);
    }
    return normalizedCounts(counts);
  };

  const droppedItemNames = () => Object.values(target?.entities || {}).flatMap(entity => {
    try {
      const item = entity?.getDroppedItem?.();
      return item?.name ? [item.name] : [];
    } catch {
      return [];
    }
  }).sort();

  const requestCompletionT0 = () => {
    const compact = compactState(states[options.bot]);
    const table = REQUEST_COMPLETION_FIXTURE.craftingTable;
    const groundX = Math.floor(REQUEST_COMPLETION_FIXTURE.botPosition.x);
    const groundZ = Math.floor(REQUEST_COMPLETION_FIXTURE.botPosition.z);
    const observedDrops = droppedItemNames();
    return {
      schemaVersion: 'scenario-lab.request-completion-t0.v1',
      fixture: {
        ...REQUEST_COMPLETION_FIXTURE,
        botPosition: fixedPosition(compact.position),
        recipientPosition: fixedPosition(positionOf(target?.entity)),
        craftingTable: {
          ...table,
          block: target?.blockAt?.(new Vec3(table.x, table.y, table.z))?.name || null,
        },
        ground: {
          ...REQUEST_COMPLETION_FIXTURE.ground,
          block: target?.blockAt?.(new Vec3(groundX, REQUEST_COMPLETION_FIXTURE.ground.y, groundZ))?.name || null,
        },
        droppedItems: observedDrops.length ? observedDrops : 'none',
      },
      caseId: varianceCase.id,
      botInventory: normalizedCounts(compact.inventoryCounts),
      recipientInventory: targetInventoryCounts(),
      botHeld: compact.held,
      botIdle: compact.idle,
      botPathfinding: Boolean(compact.pathfinding),
    };
  };

  const requestCompletionOutcomes = () => {
    const compact = compactState(states[options.bot]);
    return varianceCase.outcomes.map(expected => {
      const held = expected.holder === 'bot'
        ? Number(compact.inventoryCounts?.[expected.item]) || 0
        : Number(targetInventoryCounts()[expected.item]) || 0;
      const equipped = expected.equipped
        ? compact.mainHand === expected.item
        : null;
      return {
        holder: expected.holder,
        item: expected.item,
        requested: expected.count,
        held,
        equipped: expected.equipped || null,
        equippedVerified: equipped,
        complete: held >= expected.count && (expected.equipped ? equipped === true : true),
      };
    });
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
      restored: !difficultyMutated,
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
      if (compact.modelMeasurement) {
        const measurementKey = JSON.stringify(compact.modelMeasurement);
        if (!activeAttempt.modelMeasurementKeys.has(measurementKey)) {
          activeAttempt.modelMeasurementKeys.add(measurementKey);
          activeAttempt.modelMeasurements.push(structuredClone(compact.modelMeasurement));
        }
      }
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
        // Any action belonging to this request is the terminal act. This
        // required 'action:followPlayer' by name, so the model choosing !follow
        // meant no terminal was ever captured and the run died at the wait for
        // it -- after ownership, after the course, after the stop. The third
        // place the same hard-coded name broke the same run. resultsByLabel
        // records what actually arrived, so a wrong expectation reads as a
        // naming mismatch instead of a hang.
        && result?.label?.startsWith('action:')
        && resultBelongsToRequest
      ) activeAttempt.terminal = structuredClone(result);
    };
    socket.on('state-update', receiveState);
    socket.on('state-delta', receiveState);
    socket.on('bot-output', (agentName, output) => {
      if (agentName === options.bot && activeAttempt && activeAttempt.outputs.length < 64) {
        const text = String(output).slice(0, 1_000);
        activeAttempt.outputs.push({ at: Date.now(), output: text });
        // A companion that asks instead of thrashing is the behaviour we want,
        // but an unattended scenario has nobody to answer, so the first run to
        // reach the furnace step asked about cobblestone and then waited out the
        // entire delivery window. A real player would just say yes. Answer it,
        // bounded, and record every answer as evidence so the transcript shows
        // exactly how much help the companion was given.
        if (orchestrationCourse && /\?/.test(text) && activeAttempt.answers.length < MAX_CLARIFICATION_ANSWERS) {
          // Grants standing authority, not method. Every question in the
          // 2026-08-17 run was a permission check after a step that had already
          // succeeded, so the answer says the authority covers the whole job.
          // It still names no material, no coordinate, and no next action.
          const answer = 'Yes — you already have my go-ahead for the whole job.'
            + ' Get whatever you need, decide the steps yourself, and only ask again if you are genuinely stuck.';
          activeAttempt.answers.push({ at: Date.now(), question: text, answer });
          target.chat(answer);
        }
      }
    });
    socket.emit('listen-to-agents');
    socket.emit('request-agent-state-snapshot');
    await waitForHeld();

    await paperCommand(`scoreboard objectives remove ${OBJECTIVE}`);
    await paperCommand(`scoreboard objectives add ${OBJECTIVE} dummy`);
    target = await createControlledTarget(evidence.controlledTarget.events);
    await paperCommand(`tp ${TARGET_NAME} ${targetStart.x} ${targetStart.y} ${targetStart.z}`);
    await waitFor(
      () => positionOf(target.entity),
      position => distance(position, targetStart) <= 0.3,
      `${TARGET_NAME} initial fixture position`,
      15_000,
    );
    await target.waitForChunksToLoad();

    const unsupportedFloor = [];
    const floorStates = new Map();
    for (let z = activeCourse.z1; z <= activeCourse.z2; z += 1) {
      for (let x = activeCourse.x1; x <= activeCourse.x2; x += 1) {
        const block = target.blockAt(new Vec3(x, COURSE.y1 - 1, z));
        if (!block || block.boundingBox !== 'block') unsupportedFloor.push({ x, y: COURSE.y1 - 1, z, name: block?.name || null });
        else floorStates.set(blockState(block), (floorStates.get(blockState(block)) || 0) + 1);
      }
    }
    if (unsupportedFloor.length) {
      throw new Error(`Fixture floor is not continuously supported: ${JSON.stringify(unsupportedFloor.slice(0, 12))}`);
    }
    baselineRuns = captureFixtureRuns();
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
        obstructionFollowCourse
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
      const routeFixtureBefore = routeProbeCourse ? captureFixtureRuns() : null;
      const terrainFixtureBefore = terrainSwimCourse ? captureFixtureRuns() : null;
      const blockedFixtureBefore = playerRouteBestCourse ? captureFixtureRuns() : null;
      const terrainStateBefore = terrainSwimCourse
        ? compactState(states[options.bot])
        : null;
      const terrainChainStateBefore = terrainChainCourse
        ? compactState(states[options.bot])
        : null;
      const finiteBreakStateBefore = finiteBreakCostCourse
        ? compactState(states[options.bot])
        : null;
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
        modelMeasurementKeys: new Set(),
        modelMeasurements: [],
        traceMap: new Map(),
        terminal: null,
        resultsByLabel: new Map(),
        answers: [],
        obstructionSealedAt: null,
        deliveryBaseline: countTargetItem(DELIVER_ITEM),
        deliveryObservedAt: null,
        deliveryFinal: null,
        resyncRequests: 0,
        waypoints: [],
        paperBefore,
        routeFixtureBefore,
        terrainFixtureBefore,
        blockedFixtureBefore,
        terrainInventoryBefore: terrainStateBefore?.inventoryCounts || null,
        terrainTraversalPolicy: terrainStateBefore?.traversalPolicy || null,
        terrainChainBefore: terrainChainCourse ? terrainChainSnapshot() : null,
        terrainChainInventoryBefore: terrainChainStateBefore?.inventoryCounts || null,
        terrainChainTraversalPolicy: terrainChainStateBefore?.traversalPolicy || null,
        finiteBreakInventoryBefore: finiteBreakStateBefore?.inventoryCounts || null,
      };
      if (requestCompletionCourse) {
        const expectedPolicy = options.preflightMode === 'on'
          ? { collectionRoute: 'strict', interactionStance: 'strict' }
          : { collectionRoute: 'advisory', interactionStance: 'advisory' };
        const t0 = await waitFor(
          requestCompletionT0,
          observed => (
            canonicalJson(observed) === canonicalJson(varianceCase.expectedT0)
            && canonicalJson(compactState(states[options.bot]).preflightPolicy) === canonicalJson(expectedPolicy)
          ),
          `${runId} exact request-completion t0 and preflight policy`,
          15_000,
        );
        const t0Fingerprint = fingerprintVarianceValue(t0);
        if (t0Fingerprint !== varianceCase.fixtureFingerprint) {
          throw new Error(`${runId} request-completion t0 fingerprint disagrees with the declared case.`);
        }
        activeAttempt.t0 = t0;
        activeAttempt.t0Fingerprint = t0Fingerprint;
        activeAttempt.preflightPolicy = structuredClone(compactState(states[options.bot]).preflightPolicy);
        activeAttempt.commandAck = {
          success: true,
          source: TARGET_NAME,
          transport: 'minecraft-player-chat',
          acceptedAt: activeAttempt.issuedAt,
        };
        target.chat(options.requestMessage);
        activeAttempt.activeAt = Date.now();

        let completionStatus = 'pending';
        const completionDeadline = Date.now() + varianceCase.timeoutMs;
        while (completionStatus === 'pending') {
          const outcomes = requestCompletionOutcomes();
          if (outcomes.every(outcome => outcome.complete)) {
            completionStatus = 'outcome-complete';
            break;
          }
          const latestMeasurement = activeAttempt.modelMeasurements.at(-1);
          if (latestMeasurement?.outcome === 'provider_failed') {
            completionStatus = 'provider-failed';
            break;
          }
          if (Date.now() >= completionDeadline) {
            completionStatus = 'outcome-timeout';
            break;
          }
          await delay(POLL_MS);
        }
        activeAttempt.completedAt = Date.now();
        if (completionStatus === 'outcome-complete') {
          try {
            await waitFor(
              () => latestResult(activeAttempt.resultsByLabel),
              result => result?.phase === 'succeeded',
              `${runId} correlated successful request-completion result`,
              15_000,
            );
            completionStatus = 'succeeded';
          } catch {
            completionStatus = 'result-unconfirmed';
          }
        }
        activeAttempt.terminal = structuredClone(latestResult(activeAttempt.resultsByLabel));

        activeAttempt.stopIssuedAt = Date.now();
        activeAttempt.stopAck = await sendMessage('!stop');
        const stopAcceptedAt = Number(activeAttempt.stopAck?.acceptedAt) || activeAttempt.stopIssuedAt;
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
          `${options.bot} settled request-completion stop anchor`,
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
        const stable = stableSamples.length >= 35 && stableSamples.every(sample => (
          sample.held
          && sample.idle
          && !sample.pathfinding
          && sample.stopTimedOutAt === null
          && actuatorVelocityIsQuiescent(sample)
          && distance(sample.position, stopPosition) <= 0.05
        ));
        const finalOutcomes = requestCompletionOutcomes();
        const results = Object.fromEntries(activeAttempt.resultsByLabel);
        const policyResult = {
          owner: 'runtime.preflight',
          operation: 'inconclusive-route-consumer-policy',
          status: options.preflightMode === 'on' ? 'strict' : 'advisory',
          code: `${expectedPolicy.collectionRoute}/${expectedPolicy.interactionStance}`,
          conclusive: null,
          retryable: null,
        };
        policyResult.resultFingerprint = fingerprintVarianceValue(policyResult);
        const observedPreflights = stablePreflightResults(results)
          .sort((left, right) => left.operation.localeCompare(right.operation));
        const preflightEvidence = options.preflightMode === 'on'
          ? [policyResult, ...observedPreflights]
          : null;
        const traces = [...activeAttempt.traceMap.values()]
          .sort((left, right) => Number(left.wallClockTimestamp) - Number(right.wallClockTimestamp));
        const stopQuiescenceMs = Math.max(0, heldAt - stopAcceptedAt);
        const passed = finalOutcomes.every(outcome => outcome.complete)
          && completionStatus === 'succeeded'
          && stable
          && stopQuiescenceMs <= 2_000
          && t0Fingerprint === varianceCase.fixtureFingerprint;
        evidence.attempts.push({
          attempt: attemptNumber,
          runId,
          issuedAt: activeAttempt.issuedAt,
          activeAt: activeAttempt.activeAt,
          completedAt: activeAttempt.completedAt,
          commandAck: activeAttempt.commandAck,
          terminal: activeAttempt.terminal,
          stop: {
            issuedAt: activeAttempt.stopIssuedAt,
            acceptedAt: stopAcceptedAt,
            heldAt,
            quiescenceMs: stopQuiescenceMs,
            settledAt,
            settlingMs: Math.max(0, settledAt - heldAt),
            position: stopPosition,
            stableForTenSeconds: stable,
            stableSamples,
          },
          performance: {
            durationMs: Date.now() - activeAttempt.issuedAt,
            botTrajectoryDistance: trajectoryDistance(activeAttempt.physicalSamples.length >= 2
              ? activeAttempt.physicalSamples
              : activeAttempt.samples),
          },
          physicalAcceptance: {
            course: options.course,
            caseId: varianceCase.id,
            t0Verified: true,
            t0Fingerprint,
            outcomes: finalOutcomes,
            outcomesVerified: finalOutcomes.every(outcome => outcome.complete),
            completionStatus,
            fixtureVerified: true,
            preflightMode: options.preflightMode,
            preflightPolicy: activeAttempt.preflightPolicy,
            maxPromptTurns: options.maxPromptTurns,
          },
          t0,
          samples: activeAttempt.samples,
          physicalSamples: activeAttempt.physicalSamples,
          outputs: activeAttempt.outputs,
          modelMeasurements: activeAttempt.modelMeasurements,
          traces,
          preflightEvidence,
          resultLabels: [...activeAttempt.resultsByLabel.keys()],
          results,
          resyncRequests: activeAttempt.resyncRequests,
          passed,
        });
        activeAttempt = null;
        await restoreFixture();
        continue;
      }
      if (interactionStanceCourse) {
        const terrainBefore = captureFixtureRuns();
        const inventoryBefore = inventorySnapshot(target);
        const startPosition = positionOf(target.entity);
        const stanceGoal = new pf.goals.GoalBlock(STANCE_TARGET.x, STANCE_TARGET.y, STANCE_TARGET.z);
        const receipt = await reachInteractionStance(target, {
          kind: 'physical_verifier',
          target: { name: 'isolated_stance', ...STANCE_TARGET },
          goal: stanceGoal,
          candidates: [STANCE_TARGET],
          probeTimeoutMs: 100,
        });
        const finalPosition = positionOf(target.entity);
        const paperAfter = await paperSnapshot(runId, 'AFTER');
        const terrainAfter = captureFixtureRuns();
        const inventoryAfter = inventorySnapshot(target);
        const terrainIntact = JSON.stringify(terrainBefore) === JSON.stringify(terrainAfter);
        const inventoryIntact = JSON.stringify(inventoryBefore) === JSON.stringify(inventoryAfter);
        const probeInconclusive = ['partial', 'timeout'].includes(receipt?.path?.status);
        const goalReached = stanceGoal.isEnd(target.entity.position.floored());
        const pathfinderSettled = !target.pathfinder.isMoving()
          && !target.pathfinder.isMining()
          && !target.pathfinder.isBuilding();
        const targetTravel = trajectoryDistance(activeAttempt.targetSamples);
        const passed = receipt?.status === 'ready'
          && probeInconclusive
          && goalReached
          && distance(startPosition, finalPosition) > 1
          && pathfinderSettled
          && inventoryIntact
          && terrainIntact;
        evidence.attempts.push({
          attempt: attemptNumber,
          runId,
          issuedAt: activeAttempt.issuedAt,
          activeAt: activeAttempt.issuedAt,
          commandAck: { success: true, source: 'direct-production-helper', provider: false },
          terminal: { phase: receipt?.status === 'ready' ? 'succeeded' : 'failed', receipt },
          performance: {
            durationMs: Date.now() - activeAttempt.issuedAt,
            controlledTargetTrajectoryDistance: targetTravel,
          },
          physicalAcceptance: {
            course: options.course,
            producerStatus: receipt?.path?.status || null,
            producerConclusive: ['success', 'noPath'].includes(receipt?.path?.status),
            helperStatus: receipt?.status || null,
            helperFailureStage: receipt?.failureStage || null,
            originalGoalReached: goalReached,
            startPosition,
            finalPosition,
            pathfinderSettled,
            laterInteractionAttempted: false,
            inventoryIntact,
            terrainIntact,
            fixtureVerified: terrainIntact,
          },
          paper: { before: paperBefore, after: paperAfter },
          targetSamples: activeAttempt.targetSamples,
          targetPathUpdates: activeAttempt.targetPathUpdates,
          passed,
        });
        activeAttempt = null;
        await restoreFixture();
        continue;
      }
      if (options.naturalLanguage) {
        target.chat(options.requestMessage);
        activeAttempt.commandAck = { success: true, source: TARGET_NAME, acceptedAt: activeAttempt.issuedAt };
      } else if (options.course === 'orchestrate-charcoal') {
        // A Mission promises delivery to its authoritative requester. The
        // dashboard relay is intentionally authenticated as ADMIN, which is
        // not a Minecraft player and therefore cannot be the recipient. Keep
        // this direct form private and deterministic, but originate it from
        // the controlled fixture player so requester identity is physical.
        target.whisper(options.bot, options.requestMessage);
        activeAttempt.commandAck = {
          success: true,
          source: TARGET_NAME,
          transport: 'minecraft-whisper',
          acceptedAt: activeAttempt.issuedAt,
        };
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
          // A strict route probe computes without installing a Pathfinder goal,
          // so movement ownership is deliberately absent. Its correlated
          // failed terminal is the observable completion boundary.
          if (routeProbeCourse) {
            return activeAttempt.terminal?.label === 'action:goToCoordinates'
              && activeAttempt.terminal?.phase === 'failed';
          }
          if (terrainSwimCourse && activeAttempt.terminal?.label === 'action:goToCoordinates') {
            return activeAttempt.terminal?.phase === 'succeeded';
          }
          if (terrainChainCourse && activeAttempt.terminal?.label === 'action:goToCoordinates') {
            return ['succeeded', 'failed', 'interrupted'].includes(activeAttempt.terminal?.phase);
          }
          if (playerRouteBestCourse && activeAttempt.terminal?.label === 'action:goToPlayer') {
            return activeAttempt.terminal?.phase === 'failed';
          }
          if (playerRouteBreakCourse && activeAttempt.terminal?.label === 'action:goToPlayer') {
            return activeAttempt.terminal?.phase === 'succeeded';
          }
          // Ownership is a physical state: not idle, and actively pathfinding.
          // This used to also require current === 'action:followPlayer'. Under
          // model-first the model picks the command, and four registered
          // commands legitimately serve "follow me" -- it chose !follow, which
          // reports action:follow. The harness then never confirmed ownership,
          // so it never started walking the target, so the companion followed a
          // stationary player and travelled 0.0 blocks. The whole failure came
          // from one hard-coded name. What the course actually needs to know is
          // that the body is moving under a request, and that is measured here;
          // whether it crossed the doorway and the corridor is measured later
          // and is what the scenario really asserts.
          return compact.idle === false && Boolean(compact.pathfinding);
        },
        `${runId} ${routeProbeCourse ? 'route-probe terminal' : `active ${options.mode === 'deliver' ? 'goal' : options.mode === 'terrain' ? 'terrain movement' : 'follow'} ownership`}`,
        options.mode === 'deliver' ? 30_000 : 15_000,
      );
      activeAttempt.activeAt = routeProbeCourse || terrainSwimCourse || terrainChainCourse || playerRouteCourse
        ? Number(activeAttempt.terminal?.startedAt) || Date.now()
        : Number(activeState?._meta?.sampledAt) || Date.now();

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
        await waitFor(
          () => activeAttempt.terminal,
          terminal => terminal?.phase === 'succeeded'
            && (orchestrationCourse
              ? terminal.label === 'action:givePlayer' && terminal.code === 'skill_delivered'
              : ['action:givePlayer', 'action:requestItemGoal'].includes(terminal.label)),
          `${runId} correlated successful delivery settlement`,
          15_000,
        );
      } else if (terrainSwimCourse) {
        await waitFor(
          () => activeAttempt.terminal,
          terminal => terminal?.label === 'action:goToCoordinates'
            && terminal?.phase === 'succeeded'
            && terminal?.code === 'skill_arrived',
          `${runId} successful terrain swim settlement`,
          30_000,
        );
        await waitFor(
          () => compactState(states[options.bot]),
          state => distance(state.position, TERRAIN_SWIM_GOAL) <= 1
            && Number(state.position?.y) >= TERRAIN_SWIM_GOAL.y - 0.1,
          `${runId} dry-bank arrival`,
          5_000,
        );
      } else if (terrainChainCourse) {
        const terminal = await waitFor(
          () => activeAttempt.terminal,
          terminal => terminal?.label === 'action:goToCoordinates'
            && ['succeeded', 'failed', 'interrupted'].includes(terminal?.phase),
          `${runId} composed terrain terminal result`,
          options.operationTimeoutMs,
        );
        if (terminal.phase !== 'succeeded' || terminal.code !== 'skill_arrived') {
          throw new Error(`${runId} composed terrain action failed: ${JSON.stringify(terminal)}`);
        }
        await waitFor(
          () => compactState(states[options.bot]),
          state => distance(state.position, TERRAIN_CHAIN_GOAL) <= 1
            && Number(state.position?.y) >= TERRAIN_CHAIN_GOAL.y - 0.1,
          `${runId} composed terrain dry-goal arrival`,
          5_000,
        );
      } else if (playerRouteBestCourse) {
        await waitFor(
          () => activeAttempt.terminal,
          terminal => terminal?.label === 'action:goToPlayer'
            && terminal?.phase === 'failed'
            && ['skill_closest_reachable', 'skill_closest_explored'].includes(terminal?.code),
          `${runId} honest best-available player-route settlement`,
          30_000,
        );
        await waitFor(
          () => compactState(states[options.bot]),
          state => {
            const observedDistance = distance(state.position, positionOf(target.entity));
            return observedDistance > PLAYER_ROUTE_ACCEPTANCE_DISTANCE
              && observedDistance <= PLAYER_ROUTE_BLOCKED_NEAREST_DISTANCE
                + PLAYER_ROUTE_BLOCKED_OBSERVATION_ALLOWANCE;
          },
          `${runId} physical convergence at the sealed enclosure`,
          5_000,
        );
      } else if (playerRouteBreakCourse) {
        await waitFor(
          () => activeAttempt.terminal,
          terminal => terminal?.label === 'action:goToPlayer'
            && terminal?.phase === 'succeeded'
            && terminal?.code === 'skill_arrived',
          `${runId} successful player-route settlement`,
          30_000,
        );
        await waitFor(
          () => compactState(states[options.bot]),
          state => distance(state.position, positionOf(target.entity)) <= PLAYER_ROUTE_ACCEPTANCE_DISTANCE,
          `${runId} physical arrival at stationary player`,
          5_000,
        );
      } else if (!routeProbeCourse) {
      await driveTarget(activeWaypoints[0]);
      if (options.mode === 'stop') {
        await waitFor(
          () => activeAttempt.samples,
          // Physical progress under any request-owned action, not one name.
          samples => samples.some(sample => (
            distance(sample.position, botStart) >= 4
            && typeof sample.current === 'string'
            && sample.current.startsWith('action:')
          )),
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
      if (options.mode === 'deliver' || routeProbeCourse || terrainSwimCourse || terrainChainCourse || playerRouteCourse) {
        // Delivery acceptance is already physical at this point. Establishing
        // the post-condition hold is harness teardown, not another user request
        // and not another provider-latency measurement. Natural-language stop
        // interpretation remains covered by the dedicated stop/follow course.
        activeAttempt.stopAck = await sendMessage('!stop');
      } else if (options.naturalLanguage) {
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
          : terrainSwimCourse
            ? `${runId} terrain movement terminal result`
          : terrainChainCourse
            ? `${runId} composed terrain movement terminal result`
          : playerRouteCourse
            ? `${runId} player-route terminal result`
          : routeProbeCourse
            ? `${runId} inconclusive route-probe terminal result`
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
        const sample = physicalBotSamples.find(entry => distance(entry.position, botStart) >= 0.4);
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
      // Follow seals the doorway after the target crosses. Player-route begins
      // with it sealed because the requester is already on the far side. Both
      // variants require the same final physical fact: the opening is now air.
      const obstructionDugThrough = obstructionFollowCourse
        ? Boolean(activeAttempt.obstructionSealedAt) && Boolean(paperAfter.doorwayVerified)
        : playerRouteBreakCourse
        ? Boolean(paperBefore.plugVerified) && Boolean(paperAfter.doorwayVerified)
        : null;
      const playerRoutePathfinderObserved = playerRouteCourse
        ? activeAttempt.samples.some(sample => Boolean(sample?.pathfinding))
        : null;
      const playerRouteTerminalVerified = playerRouteBreakCourse
        ? activeAttempt.terminal?.label === 'action:goToPlayer'
          && activeAttempt.terminal?.phase === 'succeeded'
          && activeAttempt.terminal?.code === 'skill_arrived'
          && activeAttempt.terminal?.retryable === false
        : null;
      const playerRouteBestTerminalVerified = playerRouteBestCourse
        ? activeAttempt.terminal?.label === 'action:goToPlayer'
          && activeAttempt.terminal?.phase === 'failed'
          && ['skill_closest_reachable', 'skill_closest_explored'].includes(activeAttempt.terminal?.code)
          && activeAttempt.terminal?.retryable === true
        : null;
      const playerRouteFinalDistance = playerRouteCourse
        ? distance(paperAfter.botPosition, paperAfter.targetPosition)
        : null;
      const playerRouteArrivalVerified = playerRouteBreakCourse
        ? playerRouteTerminalVerified === true
          && obstructionDugThrough === true
          && doorwayCrossed
          && Number.isFinite(botTravel)
          && botTravel >= 7
          && Number.isFinite(targetTravel)
          && targetTravel <= 0.3
          && Number.isFinite(playerRouteFinalDistance)
          && playerRouteFinalDistance <= PLAYER_ROUTE_ACCEPTANCE_DISTANCE
        : null;
      const finiteBreakCostVerified = finiteBreakCostCourse
        ? playerRouteArrivalVerified === true
          && paperBefore.plugVerified === true
          && Object.values(activeAttempt.finiteBreakInventoryBefore || {})
            .every(count => Number(count) === 0)
        : null;
      const blockedFixtureAfter = playerRouteBestCourse ? captureFixtureRuns() : null;
      const blockedTerrainIntact = playerRouteBestCourse
        ? JSON.stringify(activeAttempt.blockedFixtureBefore) === JSON.stringify(blockedFixtureAfter)
        : null;
      const unbreakableObstructionPreserved = playerRouteBestCourse
        ? paperBefore.blockedCageVerified === true
          && paperAfter.blockedCageVerified === true
          && blockedTerrainIntact === true
        : null;
      const playerRouteBestPositionVerified = playerRouteBestCourse
        ? playerRouteBestTerminalVerified === true
          && Number.isFinite(botTravel)
          && botTravel > 0
          && Number.isFinite(targetTravel)
          && targetTravel <= 0.3
          && Number.isFinite(playerRouteFinalDistance)
          && playerRouteFinalDistance > PLAYER_ROUTE_ACCEPTANCE_DISTANCE
          && playerRouteFinalDistance <= PLAYER_ROUTE_BLOCKED_NEAREST_DISTANCE
            + PLAYER_ROUTE_BLOCKED_OBSERVATION_ALLOWANCE
        : null;
      const routeFixtureAfter = routeProbeCourse ? captureFixtureRuns() : null;
      const routeTerrainIntact = routeProbeCourse
        ? JSON.stringify(activeAttempt.routeFixtureBefore) === JSON.stringify(routeFixtureAfter)
        : null;
      const terrainFixtureAfter = terrainSwimCourse ? captureFixtureRuns() : null;
      const terrainIntact = terrainSwimCourse
        ? JSON.stringify(activeAttempt.terrainFixtureBefore) === JSON.stringify(terrainFixtureAfter)
        : null;
      const terrainInventoryAfter = terrainSwimCourse
        ? compactState(states[options.bot]).inventoryCounts
        : null;
      const terrainScaffoldAccountingVerified = terrainSwimCourse
        ? JSON.stringify(activeAttempt.terrainInventoryBefore) === JSON.stringify(terrainInventoryAfter)
          && Object.values(terrainInventoryAfter || {}).every(count => Number(count) === 0)
        : null;
      const terrainTrajectory = terrainSwimCourse
        ? [{ sampledAt: activeAttempt.issuedAt - 1, position: paperBefore.botPosition }, ...physicalBotSamples]
        : [];
      const terrainStartSubmerged = terrainSwimCourse
        ? paperBefore.swimWaterColumnVerified === true
          && Number(paperBefore.botPosition?.y) <= TERRAIN_SWIM_START.y + 0.35
        : null;
      const terrainAscentObserved = terrainSwimCourse
        ? verticalAscentObserved(terrainTrajectory, TERRAIN_SWIM_START.y, 3)
        : null;
      const terrainDrySettlement = terrainSwimCourse
        ? paperAfter.swimBankVerified === true
          && distance(paperAfter.botPosition, TERRAIN_SWIM_GOAL) <= 1
          && Number(paperAfter.botPosition?.y) >= TERRAIN_SWIM_GOAL.y - 0.1
        : null;
      const terrainPathfinderObserved = terrainSwimCourse
        ? activeAttempt.samples.some(sample => Boolean(sample?.pathfinding))
        : null;
      const terrainTerminalVerified = terrainSwimCourse
        ? activeAttempt.terminal?.label === 'action:goToCoordinates'
          && activeAttempt.terminal?.phase === 'succeeded'
          && activeAttempt.terminal?.code === 'skill_arrived'
        : null;
      const terrainChainAfter = terrainChainCourse ? terrainChainSnapshot() : null;
      const terrainChainInventoryAfter = terrainChainCourse
        ? compactState(states[options.bot]).inventoryCounts
        : null;
      const terrainChainTrajectory = terrainChainCourse
        ? [{ sampledAt: activeAttempt.issuedAt - 1, position: paperBefore.botPosition }, ...physicalBotSamples]
        : [];
      const terrainChainCheckpoints = terrainChainCourse
        ? orderedTerrainChainCheckpoints(terrainChainTrajectory)
        : null;
      const terrainChainDigVerified = terrainChainCourse
        ? activeAttempt.terrainChainBefore?.dig?.every(name => name === 'stone')
          && terrainChainAfter?.dig?.every(name => name === 'air')
        : null;
      const terrainChainParkourVerified = terrainChainCourse
        ? activeAttempt.terrainChainBefore?.parkourGap?.every(name => name === 'air')
          && terrainChainAfter?.parkourGap?.every(name => name === 'air')
          && terrainChainCheckpoints?.checkpoints?.some(entry => entry.name === 'parkour_landing')
        : null;
      const terrainChainBridgeVerified = terrainChainCourse
        ? activeAttempt.terrainChainBefore?.bridge?.every(name => name === 'air')
          && terrainChainAfter?.bridge?.some(name => name === TERRAIN_CHAIN_SCAFFOLD.item)
        : null;
      const terrainChainTowerVerified = terrainChainCourse
        ? activeAttempt.terrainChainBefore?.tower?.every(name => name === 'air')
          && terrainChainAfter?.tower?.every(name => name === TERRAIN_CHAIN_SCAFFOLD.item)
        : null;
      const terrainChainStairTunnelVerified = terrainChainCourse
        ? activeAttempt.terrainChainBefore?.stairBreaks?.every(name => name === 'stone')
          && terrainChainAfter?.stairBreaks?.every(name => name === 'air')
        : null;
      const terrainChainDescentVerified = terrainChainCourse
        ? terrainChainCheckpoints?.checkpoints?.some(entry => entry.name === 'descent_landing')
        : null;
      const terrainChainSwimExitVerified = terrainChainCourse
        ? terrainChainAfter?.water?.every(name => name === 'water')
          && terrainChainAfter?.bank === 'grass_block'
          && terrainChainCheckpoints?.checkpoints?.some(entry => entry.name === 'swim_surface')
          && distance(paperAfter.botPosition, TERRAIN_CHAIN_GOAL) <= 1
          && Number(paperAfter.botPosition?.y) >= TERRAIN_CHAIN_GOAL.y - 0.1
        : null;
      const terrainChainPlacedBlocks = terrainChainCourse
        ? (terrainChainAfter?.bridge || []).filter(name => name === TERRAIN_CHAIN_SCAFFOLD.item).length
          + (terrainChainAfter?.tower || []).filter(name => name === TERRAIN_CHAIN_SCAFFOLD.item).length
        : null;
      const terrainChainScaffoldAccountingVerified = terrainChainCourse
        ? Number(activeAttempt.terrainChainInventoryBefore?.[TERRAIN_CHAIN_SCAFFOLD.item])
            - Number(terrainChainInventoryAfter?.[TERRAIN_CHAIN_SCAFFOLD.item] || 0)
            === terrainChainPlacedBlocks
          && terrainChainPlacedBlocks
            === (terrainChainAfter?.bridge || []).filter(name => name === TERRAIN_CHAIN_SCAFFOLD.item).length
              + (TERRAIN_CHAIN_TOWER.y2 - TERRAIN_CHAIN_TOWER.y1 + 1)
          && Number(terrainChainInventoryAfter?.iron_pickaxe) === 1
        : null;
      const terrainChainPathfinderObserved = terrainChainCourse
        ? activeAttempt.samples.some(sample => Boolean(sample?.pathfinding))
        : null;
      const terrainChainTerminalVerified = terrainChainCourse
        ? activeAttempt.terminal?.label === 'action:goToCoordinates'
          && activeAttempt.terminal?.phase === 'succeeded'
          && activeAttempt.terminal?.code === 'skill_arrived'
        : null;
      const terrainChainFixtureVerified = terrainChainCourse
        ? terrainChainDigVerified === true
          && terrainChainParkourVerified === true
          && terrainChainBridgeVerified === true
          && terrainChainTowerVerified === true
          && terrainChainStairTunnelVerified === true
          && terrainChainDescentVerified === true
          && terrainChainSwimExitVerified === true
          && terrainChainScaffoldAccountingVerified === true
          && terrainChainCheckpoints?.complete === true
        : null;
      const routeProbeStatus = routeProbeCourse
        ? inconclusiveRouteProbeStatus(activeAttempt.terminal)
        : null;
      const routeProbeConclusive = routeProbeCourse
        ? routeProbeStatus !== null
          ? false
          : activeAttempt.terminal?.code === 'skill_path_not_found' ? true : null
        : null;
      const routeMovementAttempted = routeProbeCourse
        ? botTravel > 0.1 || activeAttempt.samples.some(sample => Boolean(sample?.pathfinding))
        : null;
      const routePositionStable = routeProbeCourse
        ? distance(paperBefore.botPosition, paperAfter.botPosition) <= 0.1
        : null;
      const fixtureVerified = routeProbeCourse
        ? paperBefore.routeTargetVerified === true
          && paperAfter.routeTargetVerified === true
          && routeTerrainIntact === true
        : terrainSwimCourse
        ? [paperBefore, paperAfter].every(snapshot => (
            snapshot.swimWaterColumnVerified === true
            && snapshot.swimBankVerified === true
          ))
          && terrainIntact === true
        : terrainChainCourse
        ? terrainChainFixtureVerified === true
        : orchestrationCourse
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
        : playerRouteBestCourse
        ? unbreakableObstructionPreserved === true
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
      const finalWaypointReached = playerRouteBestCourse
        ? playerRouteBestPositionVerified
        : playerRouteBreakCourse
        ? playerRouteArrivalVerified
        : distance(paperAfter.botPosition, finalWaypoint) <= 4.5;
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
      const deliveryTerminalVerified = options.mode === 'deliver'
        ? activeAttempt.terminal?.phase === 'succeeded'
          && (orchestrationCourse
            ? activeAttempt.terminal?.label === 'action:givePlayer'
              && activeAttempt.terminal?.code === 'skill_delivered'
            : ['action:givePlayer', 'action:requestItemGoal'].includes(activeAttempt.terminal?.label))
        : null;
      const routeProbeVerified = routeProbeCourse
        ? routeProbeStatus !== null
          && activeAttempt.terminal?.phase === 'failed'
          && activeAttempt.terminal?.code === 'skill_route_unproven'
          && activeAttempt.terminal?.retryable === true
          && routeMovementAttempted === false
          && routePositionStable === true
          && routeTerrainIntact === true
        : null;
      const passed = routeProbeCourse
        ? routeProbeVerified === true
          && stopQuiescenceMs <= 2_000
          && stable
          && distance(paperAfter.botPosition, stopPosition) <= 0.1
          && fixtureVerified
        : terrainSwimCourse
        ? terrainStartSubmerged === true
          && terrainAscentObserved === true
          && terrainDrySettlement === true
          && terrainPathfinderObserved === true
          && activeAttempt.terrainTraversalPolicy === 'full'
          && terrainTerminalVerified === true
          && terrainScaffoldAccountingVerified === true
          && stopQuiescenceMs <= 2_000
          && stable
          && distance(paperAfter.botPosition, stopPosition) <= 0.1
          && fixtureVerified
        : terrainChainCourse
        ? terrainChainPathfinderObserved === true
          && activeAttempt.terrainChainTraversalPolicy === 'full'
          && terrainChainTerminalVerified === true
          && terrainChainFixtureVerified === true
          && stopQuiescenceMs <= 2_000
          && stable
          && distance(paperAfter.botPosition, stopPosition) <= 0.1
          && fixtureVerified
        : playerRouteBestCourse
        ? playerRoutePathfinderObserved === true
          && playerRouteBestPositionVerified === true
          && unbreakableObstructionPreserved === true
          && stopQuiescenceMs <= 2_000
          && stable
          && distance(paperAfter.botPosition, stopPosition) <= 0.1
          && fixtureVerified
        : playerRouteBreakCourse
        ? playerRoutePathfinderObserved === true
          && playerRouteArrivalVerified === true
          && (!finiteBreakCostCourse || finiteBreakCostVerified === true)
          && stopQuiescenceMs <= 2_000
          && stable
          && distance(paperAfter.botPosition, stopPosition) <= 0.1
          && fixtureVerified
        : options.mode === 'deliver'
        ? deliveryVerified === true
          && deliveryTerminalVerified === true
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
          playerRoutePathfinderObserved,
          playerRouteTerminalVerified,
          playerRouteArrivalVerified,
          finiteBreakCostVerified,
          finiteBreakInventoryBefore: activeAttempt.finiteBreakInventoryBefore,
          playerRouteBestTerminalVerified,
          playerRouteBestPositionVerified,
          unbreakableObstructionPreserved,
          blockedTerrainIntact,
          deliveryVerified,
          deliveryTerminalVerified,
          deliveryItem: options.mode === 'deliver' ? DELIVER_ITEM : null,
          deliveryQuantity: options.mode === 'deliver' ? DELIVER_QUANTITY : null,
          deliverySourcePresent: paperBefore.sourceVerified,
          deliveryGroundPresent: paperBefore.groundVerified,
          deliveryDryLandVerified: paperBefore.dryLandVerified,
          deliveryDryLandProbes: paperBefore.dryLandProbes,
          deliveryBaseline: activeAttempt.deliveryBaseline,
          deliveryFinal: activeAttempt.deliveryFinal,
          deliveryObservedAt: activeAttempt.deliveryObservedAt,
          routeProbeStatus,
          routeProbeConclusive,
          routeMovementAttempted,
          routeStartPosition: routeProbeCourse ? paperBefore.botPosition : null,
          routeFinalPosition: routeProbeCourse ? paperAfter.botPosition : null,
          routeTerrainIntact,
          terrainStartSubmerged,
          terrainAscentObserved,
          terrainDrySettlement,
          terrainPathfinderObserved,
          terrainTraversalPolicy: activeAttempt.terrainTraversalPolicy,
          terrainTerminalVerified,
          terrainIntact,
          terrainScaffoldAccountingVerified,
          terrainInventoryBefore: activeAttempt.terrainInventoryBefore,
          terrainInventoryAfter,
          terrainStartPosition: terrainSwimCourse ? paperBefore.botPosition : null,
          terrainFinalPosition: terrainSwimCourse ? paperAfter.botPosition : null,
          terrainChainDigVerified,
          terrainChainParkourVerified,
          terrainChainBridgeVerified,
          terrainChainTowerVerified,
          terrainChainStairTunnelVerified,
          terrainChainDescentVerified,
          terrainChainSwimExitVerified,
          terrainChainScaffoldAccountingVerified,
          terrainChainPathfinderObserved,
          terrainChainTraversalPolicy: activeAttempt.terrainChainTraversalPolicy,
          terrainChainTerminalVerified,
          terrainChainFixtureVerified,
          terrainChainCheckpoints,
          terrainChainBefore: activeAttempt.terrainChainBefore,
          terrainChainAfter,
          terrainChainInventoryBefore: activeAttempt.terrainChainInventoryBefore,
          terrainChainInventoryAfter,
          terrainChainStartPosition: terrainChainCourse ? paperBefore.botPosition : null,
          terrainChainFinalPosition: terrainChainCourse ? paperAfter.botPosition : null,
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
        modelMeasurements: activeAttempt.modelMeasurements,
        traces,
        // Every terminal result this request produced, keyed by label. Without
        // this a course whose expected label is wrong looks like a hang rather
        // than a naming mismatch.
        resultLabels: [...activeAttempt.resultsByLabel.keys()],
        clarificationAnswers: activeAttempt.answers,
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
        modelMeasurements: activeAttempt.modelMeasurements,
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
