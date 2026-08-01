import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

import { io } from 'socket.io-client';

import { applyStateUpdate } from '../src/mindcraft/public/js/agent-state-protocol.js';

const BOT_START = Object.freeze({ x: 1111.5, y: 100, z: 1057.5 });
const TARGET_START = Object.freeze({ x: 1117.5, y: 100, z: 1057.5 });
const CLEANUP_POSITION = Object.freeze({ x: 1071.5, y: 100, z: 1007.5 });
const WALL = Object.freeze({ x: 1114, y1: 100, y2: 102, z1: 1054, z2: 1060 });
const TAG = 'mindcraft_com001';
const PROOF_OBJECTIVE = 'com001proof';
const DAMAGE_OBJECTIVE = 'com001damage';
const KILL_OBJECTIVE = 'com001kills';
const COMMAND = '!resolveTacticalCombat(8)';
const NATURAL_LANGUAGE_COMMAND = 'fight the hostile';
const POLL_MS = 100;
const VERIFIED_FLOOR_CELLS = Object.freeze([
  { x: 1111, z: 1057, block: 'red_concrete' },
  { x: 1113, z: 1053, block: 'red_concrete' },
  { x: 1114, z: 1053, block: 'red_concrete' },
  { x: 1115, z: 1053, block: 'red_concrete' },
  { x: 1113, z: 1061, block: 'red_concrete' },
  { x: 1114, z: 1061, block: 'red_concrete' },
  { x: 1115, z: 1061, block: 'red_concrete' },
  { x: 1117, z: 1057, block: 'red_concrete' },
]);
const COURSE_HOSTILE_TYPES = Object.freeze([
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
  'enderman',
]);

function parseArgs(argv) {
  const options = {
    url: '',
    bot: 'MindcraftBot',
    attempts: 3,
    evidence: '',
    authorized: false,
    naturalLanguageDefend: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--url') options.url = String(argv[++index] || '');
    else if (value === '--bot') options.bot = String(argv[++index] || '');
    else if (value === '--attempts') options.attempts = Number(argv[++index]);
    else if (value === '--evidence') options.evidence = String(argv[++index] || '');
    else if (value === '--authorized-active-world') options.authorized = true;
    else if (value === '--natural-language-defend') options.naturalLanguageDefend = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!options.url || !options.evidence) throw new Error('--url and --evidence are required.');
  if (!options.authorized) throw new Error('Live fixture mutation requires --authorized-active-world.');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(options.bot)) throw new Error('Invalid bot name.');
  if (!Number.isInteger(options.attempts) || options.attempts < 1 || options.attempts > 3) {
    throw new Error('Attempts must be an integer from 1 through 3.');
  }
  const parsed = new URL(options.url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('URL must use HTTP or HTTPS.');
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  options.url = parsed.toString().replace(/\/$/, '');
  options.evidence = resolve(options.evidence);
  options.command = options.naturalLanguageDefend ? NATURAL_LANGUAGE_COMMAND : COMMAND;
  options.expectedActionLabel = options.naturalLanguageDefend
    ? 'action:attackHostile'
    : 'action:resolveTacticalCombat';
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
    socket.emit(event, ...args, (result) => {
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
    socket.once('connect_error', (error) => {
      clearTimeout(timeout);
      socket.close();
      reject(error);
    });
  });
}

function compactHostile(hostile) {
  if (!hostile) return null;
  return {
    name: hostile.name || null,
    entityId: Number.isFinite(hostile.entityId) ? hostile.entityId : null,
    distance: Number.isFinite(hostile.distance) ? hostile.distance : null,
    position: hostile.position || null,
    visible: typeof hostile.visible === 'boolean' ? hostile.visible : null,
    inView: typeof hostile.inView === 'boolean' ? hostile.inView : null,
    hostile: hostile.hostile === true,
    threatDisposition: hostile.threatDisposition || null,
    threatPriority: hostile.threatPriority || null,
    motion: hostile.motion || null,
  };
}

function compactState(state) {
  const result = state?.action?.lastResult;
  return {
    sampledAt: Number(state?._meta?.sampledAt) || Date.now(),
    position: state?.gameplay?.position || null,
    health: state?.gameplay?.health ?? null,
    hunger: state?.gameplay?.hunger ?? null,
    held: state?.action?.held === true,
    idle: state?.action?.isIdle === true,
    pathfinding: state?.action?.pathfinding || null,
    current: state?.action?.current || null,
    autonomy: state?.identity?.runtime?.autonomy || state?.identity?.autonomy || null,
    mainHand: state?.inventory?.equipment?.mainHand || null,
    hostiles: (state?.perception?.hostiles || []).map(compactHostile),
    lastResult: result ? {
      actionId: result.actionId || null,
      phase: result.phase,
      code: result.code,
      label: result.label,
      detail: result.detail,
      target: result.target || null,
      durationMs: result.durationMs,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
    } : null,
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

function marker(runId, phase, fact) {
  return `#${`${runId}_${phase}_${fact}`.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

function markerObserved(lines, value) {
  return lines.some(line => String(line).includes(`Set [${PROOF_OBJECTIVE}] for ${value} to 1`));
}

function paperScore(lines, owner, objective) {
  const ownerPattern = String(owner).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const objectivePattern = String(objective).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${ownerPattern} has (-?\\d+) \\[${objectivePattern}\\]`, 'i');
  for (const line of [...lines].reverse()) {
    const match = String(line).match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function paperPositions(lines) {
  // eslint-disable-next-line no-control-regex
  return lines.map(line => String(line).replace(/\u001b\[[0-9;]*m/g, ''))
    .map(line => line.match(/entity data:\s*\[(-?\d+(?:\.\d+)?)d?,\s*(-?\d+(?:\.\d+)?)d?,\s*(-?\d+(?:\.\d+)?)d?\]/i))
    .filter(Boolean)
    .map(match => ({ x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) }));
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const evidence = {
    schemaVersion: 1,
    scenario: options.naturalLanguageDefend
      ? 'natural-language-clear-and-obstructed-hostile-tactical-combat'
      : 'clear-and-obstructed-hostile-tactical-combat',
    command: options.command,
    expectedActionLabel: options.expectedActionLabel,
    bot: options.bot,
    fixture: {
      arena: { x1: 1109, x2: 1118, y1: 100, y2: 105, z1: 1045, z2: 1067 },
      botStart: BOT_START,
      targetStart: TARGET_START,
      wall: WALL,
      alternateRoutes: [{ z: 1053 }, { z: 1061 }],
      repairedFloor: { x1: 1109, x2: 1118, y: 99, z1: 1045, z2: 1067 },
      target: { type: 'zombie', tag: TAG, activeAI: false },
    },
    independentAttribution: {
      damageCriterion: 'minecraft.custom:minecraft.damage_dealt',
      killCriterion: 'minecraft.killed:minecraft.zombie',
    },
    startedAt: Date.now(),
    attempts: [],
    passed: false,
    error: null,
  };
  let socket = null;
  let states = {};
  let revisions = {};
  let activeCase = null;

  const paperCommand = command => fetchJson(options.url, '/api/minecraft-server/command', {
    method: 'POST',
    body: JSON.stringify({ command }),
  });

  const sendMessage = async (message) => {
    const result = await emitAcknowledged(socket, 'send-message', [options.bot, { message }]);
    if (result?.success !== true) throw new Error(`Bot command was rejected: ${JSON.stringify(result)}`);
    return result;
  };

  const waitForHeld = (sampledAfter = 0, timeoutMs = 20_000) => waitFor(
    () => states[options.bot] || null,
    state => Number(state?._meta?.sampledAt) >= sampledAfter
      && state?.action?.held === true
      && state?.action?.isIdle === true
      && !state?.action?.pathfinding,
    `${options.bot} held actuator quiescence`,
    timeoutMs,
  );

  const sendStop = () => sendMessage('!stop');

  const triggerStop = () => {
    if (!activeCase || activeCase.stopPromise) return;
    activeCase.stopIssuedAt = Date.now();
    activeCase.stopPromise = sendStop();
    activeCase.stopPromise.catch(() => {});
  };

  const paperSnapshot = async (runId, phase, kind) => {
    const begin = marker(runId, phase, 'BEGIN');
    const end = marker(runId, phase, 'END');
    const expectedWall = kind === 'obstructed' ? 'stone_bricks' : 'air';
    await paperCommand(`scoreboard players set ${begin} ${PROOF_OBJECTIVE} 1`);
    await paperCommand(`scoreboard players set #targethealth ${PROOF_OBJECTIVE} -1`);
    await paperCommand(`execute store result score #targethealth ${PROOF_OBJECTIVE} run data get entity @e[tag=${TAG},limit=1] Health 10`);
    await paperCommand(`execute store result score #bothealth ${PROOF_OBJECTIVE} run data get entity ${options.bot} Health 10`);
    await paperCommand(`data get entity @e[tag=${TAG},limit=1] Pos`);
    await paperCommand(`data get entity ${options.bot} Pos`);
    await paperCommand(`scoreboard players get ${options.bot} ${DAMAGE_OBJECTIVE}`);
    await paperCommand(`scoreboard players get ${options.bot} ${KILL_OBJECTIVE}`);
    await paperCommand(
      `execute if entity @e[tag=${TAG}] run scoreboard players set ${marker(runId, phase, 'TARGET_PRESENT')} ${PROOF_OBJECTIVE} 1`,
    );
    await paperCommand(
      `execute unless entity @e[tag=${TAG}] run scoreboard players set ${marker(runId, phase, 'TARGET_ABSENT')} ${PROOF_OBJECTIVE} 1`,
    );
    await paperCommand(
      `execute if block ${WALL.x} 100 1057 minecraft:${expectedWall} `
      + `run scoreboard players set ${marker(runId, phase, 'WALL_EXPECTED')} ${PROOF_OBJECTIVE} 1`,
    );
    for (const z of [1053, 1061]) {
      await paperCommand(
        `execute if block ${WALL.x} 100 ${z} minecraft:air `
        + `run scoreboard players set ${marker(runId, phase, `GAP_${z}`)} ${PROOF_OBJECTIVE} 1`,
      );
    }
    for (const cell of VERIFIED_FLOOR_CELLS) {
      await paperCommand(
        `execute if block ${cell.x} 99 ${cell.z} minecraft:${cell.block} `
        + `run scoreboard players set ${marker(runId, phase, `FLOOR_${cell.x}_${cell.z}`)} ${PROOF_OBJECTIVE} 1`,
      );
    }
    await paperCommand(`scoreboard players get #targethealth ${PROOF_OBJECTIVE}`);
    await paperCommand(`scoreboard players get #bothealth ${PROOF_OBJECTIVE}`);
    await paperCommand(`scoreboard players set ${end} ${PROOF_OBJECTIVE} 1`);
    await delay(250);
    const status = await fetchJson(options.url, '/api/minecraft-server');
    const lines = Array.isArray(status?.server?.logs) ? status.server.logs : [];
    const first = lines.findIndex(line => String(line).includes(begin));
    const last = lines.findLastIndex(line => String(line).includes(end));
    if (first < 0 || last < first) throw new Error(`Paper markers missing for ${runId}-${phase}.`);
    return lines.slice(first, last + 1);
  };

  const resetCase = async (kind) => {
    await waitForHeld();
    const wallBlock = kind === 'obstructed' ? 'stone_bricks' : 'air';
    const commands = [
      ...COURSE_HOSTILE_TYPES.map(type => (
        `kill @e[type=minecraft:${type},x=990,y=90,z=990,dx=160,dy=50,dz=140]`
      )),
      'kill @e[type=item,x=1109,y=99,z=1045,dx=9,dy=6,dz=22]',
      'fill 1109 99 1045 1118 99 1067 red_concrete',
      'setblock 1113 99 1057 sea_lantern',
      `fill ${WALL.x} ${WALL.y1} ${WALL.z1} ${WALL.x} ${WALL.y2} ${WALL.z2} ${wallBlock}`,
      `setblock ${WALL.x} 100 1053 air`,
      `setblock ${WALL.x} 101 1053 air`,
      `setblock ${WALL.x} 100 1061 air`,
      `setblock ${WALL.x} 101 1061 air`,
      `gamemode survival ${options.bot}`,
      `tp ${options.bot} ${BOT_START.x} ${BOT_START.y} ${BOT_START.z}`,
      `effect clear ${options.bot}`,
      `clear ${options.bot} minecraft:iron_sword`,
      `give ${options.bot} minecraft:iron_sword 1`,
      `effect give ${options.bot} minecraft:instant_health 1 4 true`,
      `effect give ${options.bot} minecraft:saturation 1 255 true`,
      `scoreboard players set ${options.bot} ${DAMAGE_OBJECTIVE} 0`,
      `scoreboard players set ${options.bot} ${KILL_OBJECTIVE} 0`,
      `summon minecraft:zombie ${TARGET_START.x} ${TARGET_START.y} ${TARGET_START.z} {Tags:["${TAG}"],PersistenceRequired:1b,CanPickUpLoot:0b,NoAI:1b,Silent:1b}`,
    ];
    for (const command of commands) await paperCommand(command);
    await waitFor(
      () => states[options.bot] || null,
      state => {
        const compact = compactState(state);
        const zombie = compact.hostiles.find(hostile => hostile.name === 'zombie');
        return compact.held
          && compact.idle
          && !compact.pathfinding
          && compact.autonomy === 'command'
          && distance(compact.position, BOT_START) <= 0.25
          && Number(compact.health) >= 19
          && Number(compact.hunger) >= 19
          && zombie?.hostile === true
          && zombie?.threatDisposition === 'combat_safe'
          && Number(zombie.distance) >= 5
          && Number(zombie.distance) <= 7
          && zombie.visible === (kind === 'clear')
          && compact.hostiles.length === 1;
      },
      `${kind} hostile perception fixture`,
      20_000,
    );
    await paperCommand(`effect clear ${options.bot} minecraft:saturation`);
  };

  const cleanupFixture = async () => {
    await paperCommand(`kill @e[tag=${TAG}]`);
    await paperCommand('kill @e[type=item,x=1109,y=99,z=1045,dx=9,dy=6,dz=22]');
    await paperCommand(`fill ${WALL.x} ${WALL.y1} ${WALL.z1} ${WALL.x} ${WALL.y2} ${WALL.z2} air`);
    await paperCommand(`tp ${options.bot} ${CLEANUP_POSITION.x} ${CLEANUP_POSITION.y} ${CLEANUP_POSITION.z}`);
    await paperCommand(`effect give ${options.bot} minecraft:instant_health 1 4 true`);
    await paperCommand(`effect give ${options.bot} minecraft:saturation 1 255 true`);
    await waitFor(
      () => states[options.bot] || null,
      state => {
        const compact = compactState(state);
        return compact.held
          && compact.idle
          && !compact.pathfinding
          && distance(compact.position, CLEANUP_POSITION) <= 0.25
          && compact.hostiles.every(hostile => hostile.name !== 'zombie');
      },
      'clean held combat fixture',
      20_000,
    );
    await paperCommand(`effect clear ${options.bot} minecraft:saturation`);
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
    if (otherActive.length) throw new Error(`Other bots are active: ${otherActive.map(entry => entry.name).join(', ')}`);

    socket = await connectDashboard(options.url);
    const receiveState = (payload) => {
      const applied = applyStateUpdate(states, revisions, payload);
      states = applied.states;
      revisions = applied.revisions;
      if (applied.resyncRequired) {
        if (activeCase) activeCase.resyncRequests += 1;
        socket.emit('request-agent-state-snapshot');
      }
      const state = states[options.bot];
      if (!activeCase || !state) return;
      const compact = compactState(state);
      if (activeCase.samples.at(-1)?.sampledAt !== compact.sampledAt && activeCase.samples.length < 180) {
        activeCase.samples.push(compact);
      }
      for (const trace of state?.action?.behaviorArbiter?.decisionTrace?.recent || []) {
        if (!trace?.decisionId || Number(trace.wallClockTimestamp) < activeCase.issuedAt - 2_000) continue;
        if (activeCase.traceMap.size < 256 || activeCase.traceMap.has(trace.decisionId)) {
          activeCase.traceMap.set(trace.decisionId, trace);
        }
      }
      const result = compact.lastResult;
      if (
        !activeCase.terminalState
        && result?.label === options.expectedActionLabel
        && typeof result.actionId === 'string'
        && Number(result.startedAt) >= activeCase.issuedAt
      ) {
        activeCase.terminalState = structuredClone(compact);
        triggerStop();
      }
    };
    socket.on('state-update', receiveState);
    socket.on('state-delta', receiveState);
    socket.on('bot-output', (agentName, output) => {
      if (agentName === options.bot && activeCase && activeCase.outputs.length < 64) {
        activeCase.outputs.push({ at: Date.now(), output: String(output).slice(0, 1_500) });
      }
    });
    socket.emit('listen-to-agents');
    socket.emit('request-agent-state-snapshot');
    await waitForHeld();
    await paperCommand(`scoreboard objectives remove ${PROOF_OBJECTIVE}`);
    await paperCommand(`scoreboard objectives remove ${DAMAGE_OBJECTIVE}`);
    await paperCommand(`scoreboard objectives remove ${KILL_OBJECTIVE}`);
    await paperCommand(`scoreboard objectives add ${PROOF_OBJECTIVE} dummy`);
    await paperCommand(`scoreboard objectives add ${DAMAGE_OBJECTIVE} minecraft.custom:minecraft.damage_dealt`);
    await paperCommand(`scoreboard objectives add ${KILL_OBJECTIVE} minecraft.killed:minecraft.zombie`);

    outer: for (let attemptNumber = 1; attemptNumber <= options.attempts; attemptNumber += 1) {
      const attempt = { attempt: attemptNumber, cases: [], passed: false };
      evidence.attempts.push(attempt);
      for (const kind of ['clear', 'obstructed']) {
        await resetCase(kind);
        const runId = `COM001-R${attemptNumber}-${kind === 'clear' ? 'C' : 'O'}`;
        const beforeState = compactState(states[options.bot]);
        const initialHostile = beforeState.hostiles.find(hostile => hostile.name === 'zombie') || null;
        const paperBefore = await paperSnapshot(runId, 'BEFORE', kind);
        activeCase = {
          runId,
          kind,
          issuedAt: Date.now(),
          samples: [],
          outputs: [],
          traceMap: new Map(),
          terminalState: null,
          stopPromise: null,
          stopIssuedAt: null,
          resyncRequests: 0,
        };
        const commandAck = await sendMessage(options.command);
        const terminalState = await waitFor(
          () => activeCase?.terminalState || null,
          Boolean,
          `${runId} tactical combat terminal result`,
          30_000,
        );
        const terminal = terminalState.lastResult;
        if (!activeCase.stopPromise) triggerStop();
        const stopAck = await activeCase.stopPromise;
        const stopAcceptedAt = Number(stopAck?.acceptedAt) || activeCase.stopIssuedAt;
        const heldState = await waitForHeld(stopAcceptedAt);
        const heldAt = Number(heldState?._meta?.sampledAt) || Date.now();
        const stableSamples = [];
        for (let second = 0; second <= 3; second += 1) {
          stableSamples.push(compactState(states[options.bot]));
          await delay(1_000);
        }
        const paperAfter = await paperSnapshot(runId, 'AFTER', kind);
        const afterState = compactState(states[options.bot]);
        const traces = [...activeCase.traceMap.values()]
          .filter(trace => Number(trace.wallClockTimestamp) <= Number(terminal.finishedAt) + 2_500)
          .sort((left, right) => Number(left.wallClockTimestamp) - Number(right.wallClockTimestamp));
        const linked = traces.filter(trace => (
          trace?.correlation?.actionId === terminal.actionId
          && trace?.correlation?.outcomeLinked === true
          && trace?.activeAction?.actionId === terminal.actionId
          && trace?.activeAction?.owner === 'player'
          && trace?.activeAction?.label === terminal.label
          && trace?.outcome?.code === terminal.code
          && trace?.outcome?.phase === terminal.phase
        ));
        const beforePositions = paperPositions(paperBefore);
        const afterPositions = paperPositions(paperAfter);
        const beforeDamage = paperScore(paperBefore, options.bot, DAMAGE_OBJECTIVE);
        const afterDamage = paperScore(paperAfter, options.bot, DAMAGE_OBJECTIVE);
        const beforeKills = paperScore(paperBefore, options.bot, KILL_OBJECTIVE);
        const afterKills = paperScore(paperAfter, options.bot, KILL_OBJECTIVE);
        const beforeTargetHealth = paperScore(paperBefore, '#targethealth', PROOF_OBJECTIVE);
        const afterTargetHealth = paperScore(paperAfter, '#targethealth', PROOF_OBJECTIVE);
        const beforeBotHealth = paperScore(paperBefore, '#bothealth', PROOF_OBJECTIVE);
        const afterBotHealth = paperScore(paperAfter, '#bothealth', PROOF_OBJECTIVE);
        const targetPresentBefore = markerObserved(paperBefore, marker(runId, 'BEFORE', 'TARGET_PRESENT'));
        const targetAbsentAfter = markerObserved(paperAfter, marker(runId, 'AFTER', 'TARGET_ABSENT'));
        const geometryVerified = ['BEFORE', 'AFTER'].every(phase => {
          const lines = phase === 'BEFORE' ? paperBefore : paperAfter;
          return markerObserved(lines, marker(runId, phase, 'WALL_EXPECTED'))
            && markerObserved(lines, marker(runId, phase, 'GAP_1053'))
            && markerObserved(lines, marker(runId, phase, 'GAP_1061'))
            && VERIFIED_FLOOR_CELLS.every(cell => markerObserved(
              lines,
              marker(runId, phase, `FLOOR_${cell.x}_${cell.z}`),
            ));
        });
        const tacticalChoiceCount = activeCase.outputs.reduce((count, entry) => (
          count + (entry.output.match(/Tactical choice:/gi) || []).length
        ), 0);
        const detoured = kind === 'clear' || activeCase.samples.some(sample => (
          Number(sample.position?.z) < WALL.z1 - 0.1 || Number(sample.position?.z) > WALL.z2 + 0.1
        ));
        const stayedInArena = activeCase.samples.every(sample => (
          Number(sample.position?.x) >= 1108.5
          && Number(sample.position?.x) <= 1118.5
          && Number(sample.position?.y) >= 99.5
          && Number(sample.position?.y) <= 101.5
          && Number(sample.position?.z) >= 1044.5
          && Number(sample.position?.z) <= 1067.5
        ));
        const stable = stableSamples.every(sample => (
          sample.held
          && sample.idle
          && !sample.pathfinding
          && distance(sample.position, stableSamples[0].position) <= 0.05
        ));
        const passed = terminal.phase === 'succeeded'
          && terminal.code === 'skill_secured'
          && initialHostile?.entityId !== null
          && initialHostile?.hostile === true
          && initialHostile?.threatDisposition === 'combat_safe'
          && initialHostile?.visible === (kind === 'clear')
          && targetPresentBefore
          && targetAbsentAfter
          && beforeTargetHealth === 200
          && Number(afterTargetHealth) <= 0
          && beforeDamage === 0
          && Number(afterDamage) > 0
          && beforeKills === 0
          && afterKills === 1
          && beforeBotHealth >= 190
          && afterBotHealth > 0
          && beforePositions.length >= 2
          && afterPositions.length >= 1
          && distance(beforePositions.at(-1), BOT_START) <= 0.35
          && geometryVerified
          && tacticalChoiceCount > 0
          && detoured
          && stayedInArena
          && linked.length > 0
          && heldAt - stopAcceptedAt <= 2_000
          && stable;
        attempt.cases.push({
          runId,
          kind,
          issuedAt: activeCase.issuedAt,
          commandAck,
          initialHostile,
          terminal,
          terminalState,
          afterState,
          tacticalChoiceCount,
          resyncRequests: activeCase.resyncRequests,
          detoured,
          stayedInArena,
          stop: {
            issuedAt: activeCase.stopIssuedAt,
            acceptedAt: stopAcceptedAt,
            heldAt,
            quiescenceMs: heldAt - stopAcceptedAt,
            stableForThreeSeconds: stable,
          },
          paper: {
            targetPresentBefore,
            targetAbsentAfter,
            targetHealth: `${beforeTargetHealth}->${afterTargetHealth}`,
            botHealth: `${beforeBotHealth}->${afterBotHealth}`,
            attributedDamage: `${beforeDamage}->${afterDamage}`,
            attributedKills: `${beforeKills}->${afterKills}`,
            targetPositionBefore: beforePositions[0] || null,
            botPositionBefore: beforePositions.at(-1) || null,
            botPositionAfter: afterPositions.at(-1) || null,
            geometryVerified,
            before: paperBefore,
            after: paperAfter,
          },
          outputs: activeCase.outputs,
          samples: activeCase.samples,
          stableSamples,
          traces,
          linkedDecisionIds: linked.map(trace => trace.decisionId),
          passed,
        });
        activeCase = null;
        if (!passed) break outer;
      }
      attempt.passed = attempt.cases.length === 2 && attempt.cases.every(entry => entry.passed);
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
          const cleanupStop = await sendStop();
          acceptedAt = Number(cleanupStop?.acceptedAt) || Date.now();
        }
        await waitForHeld(acceptedAt, 10_000);
        await cleanupFixture();
        await paperCommand(`scoreboard objectives remove ${PROOF_OBJECTIVE}`);
        await paperCommand(`scoreboard objectives remove ${DAMAGE_OBJECTIVE}`);
        await paperCommand(`scoreboard objectives remove ${KILL_OBJECTIVE}`);
        evidence.cleanup = {
          held: true,
          position: compactState(states[options.bot]).position,
          autonomy: compactState(states[options.bot]).autonomy,
          taggedTargetsRemoved: true,
          temporaryWallRemoved: true,
        };
      } catch (cleanupError) {
        evidence.cleanupError = String(cleanupError?.stack || cleanupError?.message || cleanupError).slice(0, 2_000);
      }
      socket.close();
    }
    evidence.finishedAt = Date.now();
    evidence.durationMs = evidence.finishedAt - evidence.startedAt;
    await mkdir(dirname(options.evidence), { recursive: true });
    await writeFile(options.evidence, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  }

  const summary = {
    passed: evidence.passed,
    command: evidence.command,
    expectedActionLabel: evidence.expectedActionLabel,
    error: evidence.error,
    cleanupError: evidence.cleanupError || null,
    durationMs: evidence.durationMs,
    attempts: evidence.attempts.map(attempt => ({
      attempt: attempt.attempt,
      passed: attempt.passed,
      cases: attempt.cases.map(entry => ({
        kind: entry.kind,
        passed: entry.passed,
        result: `${entry.terminal?.phase}:${entry.terminal?.code}`,
        durationMs: entry.terminal?.durationMs,
        initialVisible: entry.initialHostile?.visible,
        entityId: entry.initialHostile?.entityId,
        tacticalChoiceCount: entry.tacticalChoiceCount,
        attributedDamage: entry.paper?.attributedDamage,
        attributedKills: entry.paper?.attributedKills,
        detoured: entry.detoured,
        quiescenceMs: entry.stop?.quiescenceMs,
        linkedDecisionIds: entry.linkedDecisionIds,
      })),
    })),
    cleanup: evidence.cleanup || null,
    evidence: options.evidence,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!evidence.passed) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
