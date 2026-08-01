import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

import mineflayer from 'mineflayer';
import { io } from 'socket.io-client';
import Vec3 from 'vec3';

import { applyStateUpdate } from '../src/mindcraft/public/js/agent-state-protocol.js';

const BOT_START = Object.freeze({ x: 1028.5, y: 100, z: 1008.5 });
const TARGET_START = Object.freeze({ x: 1028.5, y: 100, z: 1006.5 });
const RESOURCE = Object.freeze({ x: 1032, y: 100, z: 1013 });
const REGION = Object.freeze({ x1: 1026, x2: 1040, y1: 99, y2: 103, z1: 1006, z2: 1016 });
const TARGET_NAME = 'FollowTarget';
const ITEM = 'cobblestone';
const TOOL = 'iron_pickaxe';
const COLLECT_COMMAND = '!collectBlocksInRange("cobblestone", 1, 64)';
const GIVE_COMMAND = '!give("FollowTarget", "cobblestone", 1)';
const NATURAL_COLLECT_REQUEST = 'collect one cobblestone for me';
const NATURAL_DELIVERY_REQUEST = 'bring me one cobblestone';
const OBJECTIVE = 'del001proof';
const POLL_MS = 100;

function parseArgs(argv) {
  const options = {
    url: '',
    bot: 'MindcraftBot',
    attempts: 1,
    evidence: '',
    naturalLanguage: false,
    singleDeliveryRequest: false,
    authorized: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--url') options.url = String(argv[++index] || '');
    else if (value === '--bot') options.bot = String(argv[++index] || '');
    else if (value === '--attempts') options.attempts = Number(argv[++index]);
    else if (value === '--evidence') options.evidence = String(argv[++index] || '');
    else if (value === '--natural-language') options.naturalLanguage = true;
    else if (value === '--single-delivery-request') {
      options.naturalLanguage = true;
      options.singleDeliveryRequest = true;
    }
    else if (value === '--authorized-active-world') options.authorized = true;
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
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function inventoryCount(bot, itemName) {
  return bot?.inventory?.items?.()
    ?.filter(item => item?.name === itemName)
    .reduce((total, item) => total + Number(item.count || 0), 0) || 0;
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
    cobblestone: Number(state?.inventory?.counts?.[ITEM]) || 0,
    tool: Number(state?.inventory?.counts?.[TOOL]) || 0,
    hostiles: (state?.perception?.hostiles || []).map(hostile => ({
      name: hostile?.name || null,
      entityId: hostile?.entityId ?? null,
      distance: hostile?.distance ?? null,
    })),
    lastResult: compactResult(state?.action?.lastResult),
  };
}

function actuatorVelocityIsQuiescent(state) {
  const horizontalSpeed = Math.hypot(Number(state?.velocity?.x) || 0, Number(state?.velocity?.z) || 0);
  const verticalSpeed = Math.abs(Number(state?.velocity?.y) || 0);
  return horizontalSpeed <= 0.05
    && (verticalSpeed <= 0.05 || (state?.onGround === true && verticalSpeed <= 0.09));
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

function inventoryCountFromPaper(lines, begin, end) {
  const first = lines.findIndex(line => String(line).includes(`Set [${OBJECTIVE}] for ${begin} to 1`));
  const last = lines.findIndex((line, index) => (
    index > first && String(line).includes(`Set [${OBJECTIVE}] for ${end} to 1`)
  ));
  if (first < 0 || last <= first) return null;
  for (const line of lines.slice(first + 1, last)) {
    const found = String(line).match(/Found (\d+) matching item\(s\) on player/i);
    if (found) return Number(found[1]);
    if (/No items were found on player/i.test(String(line))) return 0;
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
  for (let y = REGION.y1; y <= REGION.y2; y += 1) {
    for (let z = REGION.z1; z <= REGION.z2; z += 1) {
      let startX = REGION.x1;
      let state = byCoordinate.get(`${startX},${y},${z}`);
      for (let x = REGION.x1 + 1; x <= REGION.x2 + 1; x += 1) {
        const next = x <= REGION.x2 ? byCoordinate.get(`${x},${y},${z}`) : null;
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
    const trackedItems = new Set();
    const target = mineflayer.createBot({
      host: '127.0.0.1',
      port: 25579,
      username: TARGET_NAME,
      auth: 'offline',
      checkTimeoutInterval: 60_000,
    });
    const timeout = setTimeout(() => {
      target.end();
      reject(new Error(`${TARGET_NAME} did not spawn within 15 seconds.`));
    }, 15_000);
    target.once('spawn', () => {
      clearTimeout(timeout);
      eventLog.push({ at: Date.now(), event: 'spawn', position: positionOf(target.entity), version: target.version });
      resolvePromise(target);
    });
    target.on('entitySpawn', entity => {
      if (entity?.name !== 'item' || eventLog.length >= 128) return;
      trackedItems.add(entity.id);
      let item = null;
      try { item = entity.getDroppedItem?.() || null; } catch { /* incomplete item metadata */ }
      eventLog.push({
        at: Date.now(),
        event: 'itemSpawn',
        entityId: entity.id,
        position: positionOf(entity),
        velocity: entity.velocity || null,
        item: item ? { name: item.name, count: item.count } : null,
      });
    });
    target.on('entityGone', entity => {
      if (!trackedItems.has(entity?.id) || eventLog.length >= 128) return;
      eventLog.push({
        at: Date.now(),
        event: 'itemGone',
        entityId: entity.id,
        position: positionOf(entity),
        velocity: entity.velocity || null,
      });
      trackedItems.delete(entity.id);
    });
    target.on('playerCollect', (collector, collected) => {
      if (eventLog.length >= 128) return;
      eventLog.push({
        at: Date.now(),
        event: 'playerCollect',
        collectorId: collector?.id ?? null,
        collectorName: collector?.username || collector?.name || null,
        collectedId: collected?.id ?? null,
        collectedName: collected?.name || null,
        targetInventory: inventoryCount(target, ITEM),
      });
    });
    target._client?.on?.('collect', packet => {
      if (eventLog.length >= 128) return;
      eventLog.push({
        at: Date.now(),
        event: 'collectPacket',
        collectorEntityId: Number(packet?.collectorEntityId),
        collectedEntityId: Number(packet?.collectedEntityId),
        targetInventory: inventoryCount(target, ITEM),
      });
    });
    target.on('kicked', reason => eventLog.push({ at: Date.now(), event: 'kicked', reason: String(reason).slice(0, 500) }));
    target.on('end', reason => eventLog.push({ at: Date.now(), event: 'end', reason: String(reason).slice(0, 500) }));
    target.on('error', error => eventLog.push({ at: Date.now(), event: 'error', error: String(error?.stack || error).slice(0, 1_000) }));
  });
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const evidence = {
    schemaVersion: 1,
    scenario: 'collect-visible-resource-and-deliver-to-player',
    route: options.singleDeliveryRequest
      ? 'natural-language-single-delivery-goal'
      : options.naturalLanguage
        ? 'natural-language-player-chat'
        : 'typed-dashboard-commands',
    commands: options.singleDeliveryRequest
      ? [`FollowTarget chat: ${NATURAL_DELIVERY_REQUEST}`]
      : options.naturalLanguage
        ? [`FollowTarget chat: ${NATURAL_COLLECT_REQUEST}`, `FollowTarget chat: ${NATURAL_DELIVERY_REQUEST}`]
      : [COLLECT_COMMAND, GIVE_COMMAND],
    bot: options.bot,
    controlledTarget: {
      name: TARGET_NAME,
      kind: 'temporary-mineflayer-client',
      model: false,
      profile: false,
      scheduler: false,
      events: [],
    },
    fixture: { region: REGION, botStart: BOT_START, targetStart: TARGET_START, resource: RESOURCE },
    startedAt: Date.now(),
    attempts: [],
    passed: false,
    error: null,
    cleanup: null,
  };
  let socket = null;
  let target = null;
  let targetSampler = null;
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

  const paperSnapshot = async (runId, phase, expectedBlock) => {
    const begin = marker(runId, phase, 'BEGIN');
    const end = marker(runId, phase, 'END');
    const block = marker(runId, phase, `BLOCK_${expectedBlock.toUpperCase()}`);
    const botInventoryBegin = marker(runId, phase, 'BOT_INV_BEGIN');
    const botInventoryEnd = marker(runId, phase, 'BOT_INV_END');
    const targetInventoryBegin = marker(runId, phase, 'TARGET_INV_BEGIN');
    const targetInventoryEnd = marker(runId, phase, 'TARGET_INV_END');
    await paperCommand(`scoreboard players set ${begin} ${OBJECTIVE} 1`);
    await paperCommand(`data get entity ${options.bot} Pos`);
    await paperCommand(`data get entity ${TARGET_NAME} Pos`);
    await paperCommand(
      `execute if block ${RESOURCE.x} ${RESOURCE.y} ${RESOURCE.z} minecraft:${expectedBlock} `
      + `run scoreboard players set ${block} ${OBJECTIVE} 1`,
    );
    await paperCommand(`scoreboard players set ${botInventoryBegin} ${OBJECTIVE} 1`);
    await paperCommand(`clear ${options.bot} minecraft:${ITEM} 0`);
    await paperCommand(`scoreboard players set ${botInventoryEnd} ${OBJECTIVE} 1`);
    await paperCommand(`scoreboard players set ${targetInventoryBegin} ${OBJECTIVE} 1`);
    await paperCommand(`clear ${TARGET_NAME} minecraft:${ITEM} 0`);
    await paperCommand(`scoreboard players set ${targetInventoryEnd} ${OBJECTIVE} 1`);
    await paperCommand(`scoreboard players set ${end} ${OBJECTIVE} 1`);
    await delay(250);
    const status = await fetchJson(options.url, '/api/minecraft-server');
    const lines = Array.isArray(status?.server?.logs) ? status.server.logs : [];
    const first = lines.findLastIndex(line => String(line).includes(begin));
    const last = lines.findLastIndex(line => String(line).includes(end));
    if (first < 0 || last < first) throw new Error(`Paper markers missing for ${runId}-${phase}.`);
    const window = lines.slice(first, last + 1);
    return {
      botPosition: paperPosition(window, options.bot),
      targetPosition: paperPosition(window, TARGET_NAME),
      block: expectedBlock,
      blockVerified: markerObserved(window, block),
      botInventory: inventoryCountFromPaper(window, botInventoryBegin, botInventoryEnd),
      targetInventory: inventoryCountFromPaper(window, targetInventoryBegin, targetInventoryEnd),
      lines: window,
    };
  };

  const restoreFixture = async () => {
    if (!baselineRuns) return;
    await paperCommand(`fill ${REGION.x1} ${REGION.y1} ${REGION.z1} ${REGION.x2} ${REGION.y2} ${REGION.z2} air`);
    for (const runEntry of baselineRuns) {
      if (runEntry.state === 'minecraft:air') continue;
      await paperCommand(
        `fill ${runEntry.x1} ${runEntry.y} ${runEntry.z} ${runEntry.x2} ${runEntry.y} ${runEntry.z} ${runEntry.state}`,
      );
    }
    fixtureMutated = false;
  };

  const provisionFixture = async () => {
    await restoreFixture();
    fixtureMutated = true;
    const commands = [
      `fill ${REGION.x1} ${REGION.y1} ${REGION.z1} ${REGION.x2} ${REGION.y1} ${REGION.z2} polished_andesite`,
      `fill ${REGION.x1} ${REGION.y1 + 1} ${REGION.z1} ${REGION.x2} ${REGION.y2} ${REGION.z2} air`,
      `setblock ${RESOURCE.x} ${RESOURCE.y} ${RESOURCE.z} stone`,
      'kill @e[type=!player,x=1020,y=94,z=1000,dx=30,dy=12,dz=24]',
      `gamemode survival ${options.bot}`,
      `gamemode survival ${TARGET_NAME}`,
      `tp ${options.bot} ${BOT_START.x} ${BOT_START.y} ${BOT_START.z}`,
      `tp ${TARGET_NAME} ${TARGET_START.x} ${TARGET_START.y} ${TARGET_START.z}`,
      `clear ${options.bot} minecraft:${ITEM}`,
      `clear ${TARGET_NAME} minecraft:${ITEM}`,
      `clear ${options.bot} minecraft:${TOOL}`,
      `give ${options.bot} minecraft:${TOOL} 1`,
      `effect give ${options.bot} minecraft:instant_health 1 4 true`,
      `effect give ${options.bot} minecraft:saturation 180 1 true`,
      `effect give ${TARGET_NAME} minecraft:instant_health 1 4 true`,
      `effect give ${TARGET_NAME} minecraft:saturation 180 1 true`,
    ];
    for (const command of commands) await paperCommand(command);
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
          && compact.cobblestone === 0
          && compact.tool === 1
          && compact.hostiles.length === 0
          && distance(compact.position, BOT_START) <= 0.3
          && inventoryCount(target, ITEM) === 0
          && target.blockAt(new Vec3(RESOURCE.x, RESOURCE.y, RESOURCE.z))?.name === 'stone';
      },
      `${options.bot} verified delivery fixture reset`,
      20_000,
    );
  };

  const actionResult = (labels, issuedAt) => {
    if (!activeAttempt) return null;
    return [...activeAttempt.resultMap.values()]
      .filter(result => labels.has(result.label) && Number(result.startedAt) >= issuedAt)
      .sort((left, right) => Number(left.finishedAt) - Number(right.finishedAt))[0] || null;
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
    if (spawningDuring.value !== false) throw new Error('Could not isolate the delivery fixture from natural mob spawning.');
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
      const result = compact.lastResult;
      if (
        result?.actionId
        && Number(result.startedAt) >= activeAttempt.issuedAt
        && (activeAttempt.resultMap.size < 16 || activeAttempt.resultMap.has(result.actionId))
      ) activeAttempt.resultMap.set(result.actionId, result);
      for (const trace of state?.action?.behaviorArbiter?.decisionTrace?.recent || []) {
        if (!trace?.decisionId || Number(trace.wallClockTimestamp) < activeAttempt.issuedAt - 2_000) continue;
        if (activeAttempt.traceMap.size < 256 || activeAttempt.traceMap.has(trace.decisionId)) {
          activeAttempt.traceMap.set(trace.decisionId, trace);
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
    for (let y = REGION.y1; y <= REGION.y2; y += 1) {
      for (let z = REGION.z1; z <= REGION.z2; z += 1) {
        for (let x = REGION.x1; x <= REGION.x2; x += 1) {
          const block = target.blockAt(new Vec3(x, y, z));
          if (!block) throw new Error(`Fixture block ${x},${y},${z} was not loaded.`);
          if (block.entity) throw new Error(`Fixture contains block entity ${block.name} at ${x},${y},${z}; refusing mutation.`);
          baselineEntries.push({ x, y, z, state: blockState(block) });
        }
      }
    }
    baselineRuns = compressFixture(baselineEntries);
    evidence.fixture.beforeState = { compressedRuns: baselineRuns, restoredAfterEachAttempt: true };

    targetSampler = setInterval(() => {
      if (!activeAttempt || activeAttempt.targetSamples.length >= 600) return;
      activeAttempt.targetSamples.push({
        at: Date.now(),
        position: positionOf(target.entity),
        cobblestone: inventoryCount(target, ITEM),
      });
    }, POLL_MS);

    for (let attemptNumber = 1; attemptNumber <= options.attempts; attemptNumber += 1) {
      await waitForHeld();
      await provisionFixture();
      const runId = `D${attemptNumber}`;
      const paperBefore = await paperSnapshot(runId, 'BEFORE', 'stone');
      activeAttempt = {
        attempt: attemptNumber,
        runId,
        issuedAt: Date.now(),
        collectIssuedAt: null,
        deliveryIssuedAt: null,
        collectAck: null,
        deliveryAck: null,
        resultMap: new Map(),
        traceMap: new Map(),
        samples: [],
        targetSamples: [],
        outputs: [],
        resyncRequests: 0,
      };
      activeAttempt.collectIssuedAt = Date.now();
      if (options.singleDeliveryRequest) {
        target.chat(NATURAL_DELIVERY_REQUEST);
        activeAttempt.collectAck = { success: true, source: TARGET_NAME, acceptedAt: activeAttempt.collectIssuedAt };
      } else if (options.naturalLanguage) {
        target.chat(NATURAL_COLLECT_REQUEST);
        activeAttempt.collectAck = { success: true, source: TARGET_NAME, acceptedAt: activeAttempt.collectIssuedAt };
      } else {
        activeAttempt.collectAck = await sendMessage(COLLECT_COMMAND);
      }
      const collectionResult = await waitFor(
        () => actionResult(new Set(['action:collectBlocksInRange', 'action:collect']), activeAttempt.collectIssuedAt),
        Boolean,
        `${runId} correlated collection result`,
        75_000,
      );
      await waitFor(
        () => ({
          bot: compactState(states[options.bot]),
          targetCobblestone: inventoryCount(target, ITEM),
          block: target.blockAt(new Vec3(RESOURCE.x, RESOURCE.y, RESOURCE.z))?.name || null,
        }),
        observation => observation.bot.cobblestone === 1
          && observation.targetCobblestone === 0
          && observation.block === 'air',
        `${runId} physical collection inventory and block transition`,
        10_000,
      );
      const paperCollected = await paperSnapshot(runId, 'COLLECTED', 'air');

      activeAttempt.deliveryIssuedAt = options.singleDeliveryRequest
        ? activeAttempt.collectIssuedAt
        : Date.now();
      if (options.singleDeliveryRequest) {
        activeAttempt.deliveryAck = activeAttempt.collectAck;
      } else if (options.naturalLanguage) {
        target.chat(NATURAL_DELIVERY_REQUEST);
        activeAttempt.deliveryAck = { success: true, source: TARGET_NAME, acceptedAt: activeAttempt.deliveryIssuedAt };
      } else {
        activeAttempt.deliveryAck = await sendMessage(GIVE_COMMAND);
      }
      const deliveryResult = await waitFor(
        () => actionResult(new Set(['action:give', 'action:givePlayer']), activeAttempt.deliveryIssuedAt),
        Boolean,
        `${runId} correlated delivery result`,
        45_000,
      );
      const deliveredState = await waitFor(
        () => ({ bot: compactState(states[options.bot]), targetCobblestone: inventoryCount(target, ITEM) }),
        observation => observation.bot.cobblestone === 0 && observation.targetCobblestone === 1,
        `${runId} physical recipient inventory transfer`,
        10_000,
      );

      const stopIssuedAt = Date.now();
      const stopAck = await sendMessage('!stop');
      const stopAcceptedAt = Number(stopAck?.acceptedAt) || stopIssuedAt;
      const heldState = await waitForHeld(stopAcceptedAt, 10_000);
      const heldAt = Number(heldState?._meta?.sampledAt) || Date.now();
      const stableSamples = [];
      for (let second = 0; second <= 10; second += 1) {
        stableSamples.push(compactState(states[options.bot]));
        await delay(1_000);
      }
      const paperAfter = await paperSnapshot(runId, 'AFTER', 'air');
      const stableOrigin = stableSamples[0]?.position;
      const stable = stableSamples.every(sample => sample.held
        && sample.idle
        && !sample.pathfinding
        && sample.stopTimedOutAt === null
        && actuatorVelocityIsQuiescent(sample)
        && distance(sample.position, stableOrigin) <= 0.05);
      const traces = [...activeAttempt.traceMap.values()]
        .sort((left, right) => Number(left.wallClockTimestamp) - Number(right.wallClockTimestamp));
      const linkedResults = [collectionResult, deliveryResult].every(result => traces.some(trace => (
        trace?.correlation?.actionId === result.actionId
        && trace?.correlation?.outcomeLinked === true
        && trace?.activeAction?.owner === 'player'
        && trace?.outcome?.code === result.code
        && trace?.outcome?.phase === result.phase
      )));
      const transferEvents = evidence.controlledTarget.events.filter(event => (
        Number(event.at) >= activeAttempt.deliveryIssuedAt
        && (event.event === 'playerCollect' || event.event === 'collectPacket')
      ));
      const passed = collectionResult.phase === 'succeeded'
        && collectionResult.code === 'skill_collected'
        && deliveryResult.phase === 'succeeded'
        && deliveryResult.code === 'skill_delivered'
        && paperBefore.blockVerified
        && paperBefore.botInventory === 0
        && paperBefore.targetInventory === 0
        && paperCollected.blockVerified
        && paperCollected.botInventory === 1
        && paperCollected.targetInventory === 0
        && paperAfter.blockVerified
        && paperAfter.botInventory === 0
        && paperAfter.targetInventory === 1
        && deliveredState.bot.cobblestone === 0
        && deliveredState.targetCobblestone === 1
        && heldAt - stopAcceptedAt <= 2_000
        && stable
        && linkedResults;
      evidence.attempts.push({
        attempt: attemptNumber,
        runId,
        issuedAt: activeAttempt.issuedAt,
        collect: {
          issuedAt: activeAttempt.collectIssuedAt,
          ack: activeAttempt.collectAck,
          terminal: collectionResult,
        },
        delivery: {
          issuedAt: activeAttempt.deliveryIssuedAt,
          ack: activeAttempt.deliveryAck,
          terminal: deliveryResult,
          transferEvents,
        },
        paper: { before: paperBefore, collected: paperCollected, after: paperAfter },
        deliveredState,
        stop: {
          issuedAt: stopIssuedAt,
          acceptedAt: stopAcceptedAt,
          heldAt,
          quiescenceMs: heldAt - stopAcceptedAt,
          stableForTenSeconds: stable,
          stableSamples,
        },
        samples: activeAttempt.samples,
        targetSamples: activeAttempt.targetSamples,
        outputs: activeAttempt.outputs,
        traces,
        linkedDecisionIds: traces
          .filter(trace => [collectionResult.actionId, deliveryResult.actionId].includes(trace?.correlation?.actionId))
          .map(trace => trace.decisionId),
        resyncRequests: activeAttempt.resyncRequests,
        passed,
      });
      activeAttempt = null;
      await paperCommand(`clear ${options.bot} minecraft:${ITEM}`);
      await paperCommand(`clear ${TARGET_NAME} minecraft:${ITEM}`);
      await paperCommand(`clear ${options.bot} minecraft:${TOOL}`);
      await restoreFixture();
      if (!passed) break;
    }
    evidence.passed = evidence.attempts.length === options.attempts
      && evidence.attempts.every(attempt => attempt.passed);
  } catch (error) {
    evidence.error = String(error?.stack || error);
    if (activeAttempt && !evidence.attempts.some(attempt => attempt.runId === activeAttempt.runId)) {
      evidence.attempts.push({
        attempt: activeAttempt.attempt,
        runId: activeAttempt.runId,
        incomplete: true,
        collect: {
          issuedAt: activeAttempt.collectIssuedAt,
          ack: activeAttempt.collectAck,
        },
        delivery: {
          issuedAt: activeAttempt.deliveryIssuedAt,
          ack: activeAttempt.deliveryAck,
        },
        results: [...activeAttempt.resultMap.values()],
        samples: activeAttempt.samples,
        targetSamples: activeAttempt.targetSamples,
        outputs: activeAttempt.outputs,
        traces: [...activeAttempt.traceMap.values()]
          .sort((left, right) => Number(left.wallClockTimestamp) - Number(right.wallClockTimestamp)),
        resyncRequests: activeAttempt.resyncRequests,
        passed: false,
      });
    }
    process.exitCode = 1;
  } finally {
    clearInterval(targetSampler);
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
      if (target) {
        await paperCommand(`clear ${TARGET_NAME} minecraft:${ITEM}`);
        await paperCommand(`clear ${options.bot} minecraft:${ITEM}`);
        await paperCommand(`clear ${options.bot} minecraft:${TOOL}`);
      }
      if (fixtureMutated || baselineRuns) await restoreFixture();
      await paperCommand(`scoreboard objectives remove ${OBJECTIVE}`);
      await paperCommand(`tp ${options.bot} 1071.5 100 1007.5`);
      evidence.cleanup = {
        ...(evidence.cleanup || {}),
        fixtureRestored: true,
        inventoriesCleared: true,
        botHeld: true,
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
    try {
      target?.quit('delivery field verification complete');
      await delay(250);
      evidence.cleanup = { ...(evidence.cleanup || {}), targetDisconnected: true };
    } catch (error) {
      try { target?.end(); } catch { /* best-effort controlled target disconnect */ }
      evidence.cleanup = {
        ...(evidence.cleanup || {}),
        success: false,
        targetDisconnected: false,
        targetError: String(error?.stack || error),
      };
      process.exitCode = 1;
    }
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
        collect: attempt.collect?.terminal
          ? `${attempt.collect.terminal.phase}:${attempt.collect.terminal.code}`
          : null,
        delivery: attempt.delivery?.terminal
          ? `${attempt.delivery.terminal.phase}:${attempt.delivery.terminal.code}`
          : null,
        paperInventory: attempt.paper
          ? `${attempt.paper.before.botInventory}/${attempt.paper.before.targetInventory}`
            + ` -> ${attempt.paper.collected.botInventory}/${attempt.paper.collected.targetInventory}`
            + ` -> ${attempt.paper.after.botInventory}/${attempt.paper.after.targetInventory}`
          : null,
        transferEvents: attempt.delivery?.transferEvents?.length ?? null,
        stopMs: attempt.stop?.quiescenceMs ?? null,
      })),
      error: evidence.error,
      cleanup: evidence.cleanup,
      evidence: options.evidence,
    }, null, 2));
  }
}

run().catch(error => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
