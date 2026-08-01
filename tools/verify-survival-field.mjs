import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

import { io } from 'socket.io-client';

import { applyStateUpdate } from '../src/mindcraft/public/js/agent-state-protocol.js';

const FIXTURE = Object.freeze({ x: 1071.5, y: 100, z: 1007.5 });
const FOOD = 'cooked_beef';
const FOOD_COUNT = 8;
const OBJECTIVE = 'sur001evidence';
const RELEASE_COMMAND = '!setAutonomy("command")';
const POLL_MS = 100;

function parseArgs(argv) {
  const options = { url: '', bot: 'MindcraftBot', attempts: 3, evidence: '', authorized: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--url') options.url = String(argv[++index] || '');
    else if (value === '--bot') options.bot = String(argv[++index] || '');
    else if (value === '--attempts') options.attempts = Number(argv[++index]);
    else if (value === '--evidence') options.evidence = String(argv[++index] || '');
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

function compactState(state) {
  const result = state?.action?.lastResult;
  return {
    sampledAt: Number(state?._meta?.sampledAt) || Date.now(),
    position: state?.gameplay?.position || null,
    health: state?.gameplay?.health ?? null,
    hunger: state?.gameplay?.hunger ?? null,
    cookedBeef: Number(state?.inventory?.counts?.[FOOD]) || 0,
    mainHand: state?.inventory?.equipment?.mainHand || null,
    held: state?.action?.held === true,
    idle: state?.action?.isIdle === true,
    pathfinding: state?.action?.pathfinding || null,
    current: state?.action?.current || null,
    autonomy: state?.identity?.runtime?.autonomy || state?.identity?.autonomy || null,
    survivalDirector: state?.action?.survivalDirector || null,
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

function paperVitals(lines, botName) {
  // Paper prints Pos as a list and Health/foodLevel as the next two scalar
  // entity-data responses inside our markers. Ignore command-echo lines.
  const scalars = lines
    // eslint-disable-next-line no-control-regex
    .map(line => String(line).replace(/\u001b\[[0-9;]*m/g, ''))
    .filter(line => line.includes(`${botName} has the following entity data:`))
    .map(line => line.match(/entity data:\s*(-?\d+(?:\.\d+)?)f?\s*$/i))
    .filter(Boolean)
    .map(match => Number(match[1]));
  return { health: scalars[0] ?? null, hunger: scalars[1] ?? null };
}

function paperPosition(lines, botName) {
  // eslint-disable-next-line no-control-regex
  const clean = lines.map(line => String(line).replace(/\u001b\[[0-9;]*m/g, ''));
  for (const line of clean.reverse()) {
    if (!line.includes(`${botName} has the following entity data:`)) continue;
    const match = line.match(/\[(-?\d+(?:\.\d+)?)d?,\s*(-?\d+(?:\.\d+)?)d?,\s*(-?\d+(?:\.\d+)?)d?\]/i);
    if (match) return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
  }
  return null;
}

function paperInventoryCount(lines) {
  for (const line of [...lines].reverse()) {
    const found = String(line).match(/Found (\d+) matching item\(s\) on player/i);
    if (found) return Number(found[1]);
    if (/No items were found on player/i.test(String(line))) return 0;
  }
  return null;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const evidence = {
    schemaVersion: 1,
    scenario: 'bounded-deterministic-hunger-survival',
    bot: options.bot,
    trigger: {
      kind: 'Paper-provisioned hunger while operator-held',
      releaseCommand: RELEASE_COMMAND,
      expectedOwner: 'survival',
      expectedAction: 'action:consume',
    },
    fixture: { position: FIXTURE, food: FOOD, resetCount: FOOD_COUNT },
    startedAt: Date.now(),
    attempts: [],
    passed: false,
    error: null,
  };
  let socket = null;
  let states = {};
  let revisions = {};
  let activeAttempt = null;

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
    if (!activeAttempt || activeAttempt.stopPromise) return;
    activeAttempt.stopIssuedAt = Date.now();
    activeAttempt.stopPromise = sendStop();
    activeAttempt.stopPromise.catch(() => {});
  };

  const paperSnapshot = async (runId, phase) => {
    const begin = marker(runId, phase, 'BEGIN');
    const end = marker(runId, phase, 'END');
    await paperCommand(`scoreboard players set ${begin} ${OBJECTIVE} 1`);
    await paperCommand(`data get entity ${options.bot} Pos`);
    await paperCommand(`data get entity ${options.bot} Health`);
    await paperCommand(`data get entity ${options.bot} foodLevel`);
    await paperCommand(`clear ${options.bot} minecraft:${FOOD} 0`);
    await paperCommand(`scoreboard players set ${end} ${OBJECTIVE} 1`);
    await delay(250);
    const status = await fetchJson(options.url, '/api/minecraft-server');
    const lines = Array.isArray(status?.server?.logs) ? status.server.logs : [];
    const first = lines.findIndex(line => String(line).includes(begin));
    const last = lines.findLastIndex(line => String(line).includes(end));
    if (first < 0 || last < first) throw new Error(`Paper markers missing for ${runId}-${phase}.`);
    return lines.slice(first, last + 1);
  };

  const resetFixture = async () => {
    await waitForHeld();
    const commands = [
      `gamemode survival ${options.bot}`,
      `tp ${options.bot} ${FIXTURE.x} ${FIXTURE.y} ${FIXTURE.z}`,
      `effect clear ${options.bot}`,
      `clear ${options.bot} minecraft:${FOOD}`,
      `give ${options.bot} minecraft:${FOOD} ${FOOD_COUNT}`,
      `effect give ${options.bot} minecraft:instant_health 1 4 true`,
      `effect give ${options.bot} minecraft:saturation 1 255 true`,
    ];
    for (const command of commands) await paperCommand(command);
    await waitFor(
      () => states[options.bot] || null,
      state => {
        const compact = compactState(state);
        return compact.held
          && compact.idle
          && !compact.pathfinding
          && distance(compact.position, FIXTURE) <= 0.25
          && Number(compact.health) >= 19
          && Number(compact.hunger) >= 19
          && compact.cookedBeef === FOOD_COUNT;
      },
      'healthy held survival fixture',
      20_000,
    );
    await paperCommand(`effect clear ${options.bot} minecraft:saturation`);
  };

  const prepareHunger = async () => {
    await paperCommand(`effect give ${options.bot} minecraft:hunger 30 79 true`);
    const lowState = await waitFor(
      () => states[options.bot] || null,
      state => {
        const compact = compactState(state);
        return compact.held
          && compact.idle
          && Number(compact.health) >= 19
          && Number(compact.hunger) >= 7
          && Number(compact.hunger) <= 12
          && compact.cookedBeef === FOOD_COUNT;
      },
      'bounded low hunger while held',
      35_000,
    );
    const clearAcceptedAt = Date.now();
    await paperCommand(`effect clear ${options.bot} minecraft:hunger`);
    return await waitFor(
      () => states[options.bot] || null,
      state => {
        const compact = compactState(state);
        return compact.sampledAt >= clearAcceptedAt
          && compact.held
          && compact.idle
          && Number(compact.health) >= 19
          && Number(compact.hunger) >= 7
          && Number(compact.hunger) <= 14
          && compact.cookedBeef === FOOD_COUNT;
      },
      'cleared hunger-effect fixture',
      10_000,
    ) || lowState;
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
        if (activeAttempt) activeAttempt.resyncRequests += 1;
        socket.emit('request-agent-state-snapshot');
      }
      const state = states[options.bot];
      if (!activeAttempt || !state) return;
      const compact = compactState(state);
      if (activeAttempt.samples.at(-1)?.sampledAt !== compact.sampledAt && activeAttempt.samples.length < 120) {
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
        !activeAttempt.terminalState
        && result?.label === 'action:consume'
        && typeof result.actionId === 'string'
        && Number(result.startedAt) >= activeAttempt.issuedAt
      ) {
        activeAttempt.terminalState = structuredClone(compact);
        triggerStop();
      }
    };
    socket.on('state-update', receiveState);
    socket.on('state-delta', receiveState);
    socket.on('bot-output', (agentName, output) => {
      if (agentName === options.bot && activeAttempt && activeAttempt.outputs.length < 32) {
        activeAttempt.outputs.push({ at: Date.now(), output: String(output).slice(0, 1_000) });
      }
    });
    socket.emit('listen-to-agents');
    socket.emit('request-agent-state-snapshot');
    await waitForHeld();
    evidence.originalAutonomy = compactState(states[options.bot]).autonomy;
    await paperCommand(`scoreboard objectives remove ${OBJECTIVE}`);
    await paperCommand(`scoreboard objectives add ${OBJECTIVE} dummy`);

    for (let attemptNumber = 1; attemptNumber <= options.attempts; attemptNumber += 1) {
      await resetFixture();
      await prepareHunger();
      const runId = `SUR001-R${attemptNumber}`;
      const beforeState = compactState(states[options.bot]);
      const paperBefore = await paperSnapshot(runId, 'BEFORE');
      activeAttempt = {
        runId,
        attempt: attemptNumber,
        issuedAt: Date.now(),
        beforeState,
        samples: [],
        outputs: [],
        traceMap: new Map(),
        terminalState: null,
        stopPromise: null,
        stopIssuedAt: null,
        resyncRequests: 0,
      };
      const releaseAck = await sendMessage(RELEASE_COMMAND);
      const terminalState = await waitFor(
        () => activeAttempt?.terminalState || null,
        Boolean,
        `${runId} survival-owned consume result`,
        20_000,
      );
      const terminal = terminalState.lastResult;
      if (!activeAttempt.stopPromise) triggerStop();
      const stopAck = await activeAttempt.stopPromise;
      const stopAcceptedAt = Number(stopAck?.acceptedAt) || activeAttempt.stopIssuedAt;
      const heldState = await waitForHeld(stopAcceptedAt);
      const heldAt = Number(heldState?._meta?.sampledAt) || Date.now();
      const stableSamples = [];
      for (let second = 0; second <= 3; second += 1) {
        stableSamples.push(compactState(states[options.bot]));
        await delay(1_000);
      }
      const paperAfter = await paperSnapshot(runId, 'AFTER');
      const afterState = compactState(states[options.bot]);
      const traces = [...activeAttempt.traceMap.values()]
        .filter(trace => Number(trace.wallClockTimestamp) <= Number(terminal.finishedAt) + 2_500)
        .sort((left, right) => Number(left.wallClockTimestamp) - Number(right.wallClockTimestamp));
      const linked = traces.filter(trace => (
        trace?.correlation?.actionId === terminal.actionId
        && trace?.correlation?.outcomeLinked === true
        && trace?.activeAction?.actionId === terminal.actionId
        && trace?.activeAction?.owner === 'survival'
        && trace?.activeAction?.label === terminal.label
        && trace?.outcome?.code === terminal.code
        && trace?.outcome?.phase === terminal.phase
      ));
      const survivalSelections = traces.filter(trace => trace?.winner?.lane === 'basic_survival');
      const paperBeforeVitals = paperVitals(paperBefore, options.bot);
      const paperAfterVitals = paperVitals(paperAfter, options.bot);
      const paperBeforeFood = paperInventoryCount(paperBefore);
      const paperAfterFood = paperInventoryCount(paperAfter);
      const stable = stableSamples.every(sample => (
        sample.held
        && sample.idle
        && !sample.pathfinding
        && distance(sample.position, stableSamples[0].position) <= 0.05
      ));
      const commandAutonomyObserved = activeAttempt.samples.some(sample => sample.autonomy === 'command' && !sample.held);
      const passed = terminal.phase === 'succeeded'
        && terminal.code === 'skill_consumed'
        && terminal.target?.name === FOOD
        && beforeState.cookedBeef === FOOD_COUNT
        && afterState.cookedBeef === FOOD_COUNT - 1
        && paperBeforeFood === FOOD_COUNT
        && paperAfterFood === FOOD_COUNT - 1
        && Number(beforeState.hunger) >= 7
        && Number(beforeState.hunger) <= 14
        && Number(afterState.hunger) > Number(beforeState.hunger)
        && Number(paperAfterVitals.hunger) > Number(paperBeforeVitals.hunger)
        && Number(paperBeforeVitals.health) >= 19
        && Number(paperAfterVitals.health) >= 19
        && distance(beforeState.position, FIXTURE) <= 0.25
        && distance(afterState.position, FIXTURE) <= 0.25
        && commandAutonomyObserved
        && survivalSelections.length > 0
        && linked.length > 0
        && heldAt - stopAcceptedAt <= 2_000
        && stable;
      evidence.attempts.push({
        runId,
        attempt: attemptNumber,
        issuedAt: activeAttempt.issuedAt,
        releaseAck,
        terminal,
        beforeState,
        terminalState,
        afterState,
        commandAutonomyObserved,
        resyncRequests: activeAttempt.resyncRequests,
        stop: {
          issuedAt: activeAttempt.stopIssuedAt,
          acceptedAt: stopAcceptedAt,
          heldAt,
          quiescenceMs: heldAt - stopAcceptedAt,
          stableForThreeSeconds: stable,
        },
        paper: {
          beforePosition: paperPosition(paperBefore, options.bot),
          afterPosition: paperPosition(paperAfter, options.bot),
          beforeVitals: paperBeforeVitals,
          afterVitals: paperAfterVitals,
          beforeFoodCount: paperBeforeFood,
          afterFoodCount: paperAfterFood,
          before: paperBefore,
          after: paperAfter,
        },
        outputs: activeAttempt.outputs,
        samples: activeAttempt.samples,
        stableSamples,
        traces,
        survivalDecisionIds: survivalSelections.map(trace => trace.decisionId),
        linkedDecisionIds: linked.map(trace => trace.decisionId),
        passed,
      });
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
          const cleanupStop = await sendStop();
          acceptedAt = Number(cleanupStop?.acceptedAt) || Date.now();
        }
        await waitForHeld(acceptedAt, 10_000);
        await resetFixture();
        evidence.cleanup = {
          held: true,
          autonomy: compactState(states[options.bot]).autonomy,
          profileOnDiskUnchanged: true,
          note: 'Command autonomy is intentionally retained under operator hold to suppress the pre-existing role work order.',
        };
        await paperCommand(`scoreboard objectives remove ${OBJECTIVE}`);
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
    error: evidence.error,
    cleanupError: evidence.cleanupError || null,
    durationMs: evidence.durationMs,
    attempts: evidence.attempts.map(attempt => ({
      runId: attempt.runId,
      passed: attempt.passed,
      result: `${attempt.terminal?.phase}:${attempt.terminal?.code}`,
      durationMs: attempt.terminal?.durationMs,
      hunger: `${attempt.beforeState?.hunger}->${attempt.afterState?.hunger}`,
      cookedBeef: `${attempt.beforeState?.cookedBeef}->${attempt.afterState?.cookedBeef}`,
      paperHunger: `${attempt.paper?.beforeVitals?.hunger}->${attempt.paper?.afterVitals?.hunger}`,
      paperFood: `${attempt.paper?.beforeFoodCount}->${attempt.paper?.afterFoodCount}`,
      quiescenceMs: attempt.stop?.quiescenceMs,
      stableForThreeSeconds: attempt.stop?.stableForThreeSeconds,
      linkedDecisionIds: attempt.linkedDecisionIds,
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
