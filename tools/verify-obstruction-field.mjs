import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

import { io } from 'socket.io-client';

import { applyStateUpdate } from '../src/mindcraft/public/js/agent-state-protocol.js';

const START = Object.freeze({ x: 1071.5, y: 100, z: 1007.5 });
const TARGET = Object.freeze({ x: 1078.5, y: 100, z: 1007.5 });
const COMMAND = '!goToCoordinates(1078.5, 100, 1007.5, 0.5)';
const OBJECTIVE = 'nav001evidence';
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
    held: state?.action?.held === true,
    idle: state?.action?.isIdle === true,
    pathfinding: state?.action?.pathfinding || null,
    current: state?.action?.current || null,
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
  return lines.some(line => String(line).includes(`Set [${OBJECTIVE}] for ${value} to 1`));
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

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const evidence = {
    schemaVersion: 1,
    scenario: 'ordinary-obstruction-alternate-route',
    command: COMMAND,
    fixture: {
      start: START,
      target: TARGET,
      directObstacle: { x: 1074, y: 100, z: 1007, block: 'stone_bricks' },
      bypass: { x: 1074, y: 100, z: 1006, block: 'air' },
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

  const paperCommand = command => fetchJson(options.url, '/api/minecraft-server/command', {
    method: 'POST',
    body: JSON.stringify({ command }),
  });

  const sendStop = async () => {
    const result = await emitAcknowledged(socket, 'send-message', [options.bot, { message: '!stop' }]);
    if (result?.success !== true) throw new Error(`Stop command was rejected: ${JSON.stringify(result)}`);
    return result;
  };

  const triggerStop = () => {
    if (!activeAttempt || activeAttempt.stopPromise) return;
    activeAttempt.stopIssuedAt = Date.now();
    activeAttempt.stopPromise = sendStop();
    activeAttempt.stopPromise.catch(() => {});
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

  const resetFixture = async () => {
    await waitForHeld();
    const commands = [
      `gamemode survival ${options.bot}`,
      'fill 1074 100 998 1074 103 1014 stone_bricks',
      'fill 1074 100 1005 1074 101 1006 air',
      'setblock 1074 100 1005 oak_door[half=lower,facing=east]',
      'setblock 1074 101 1005 oak_door[half=upper,facing=east]',
      `tp ${options.bot} ${START.x} ${START.y} ${START.z}`,
      `effect give ${options.bot} minecraft:instant_health 1 4 true`,
      `effect give ${options.bot} minecraft:saturation 180 1 true`,
    ];
    for (const command of commands) await paperCommand(command);
    await waitFor(
      () => states[options.bot] || null,
      state => state?.action?.held === true
        && state?.action?.isIdle === true
        && distance(state?.gameplay?.position, START) <= 0.25
        && Number(state?.gameplay?.health) >= 19
        && Number(state?.gameplay?.hunger) >= 19,
      'verified obstruction fixture reset',
      15_000,
    );
  };

  const paperSnapshot = async (runId, phase) => {
    const begin = marker(runId, phase, 'BEGIN');
    const end = marker(runId, phase, 'END');
    await paperCommand(`scoreboard players set ${begin} ${OBJECTIVE} 1`);
    await paperCommand(`data get entity ${options.bot} Pos`);
    await paperCommand(
      `execute if block 1074 100 1007 minecraft:stone_bricks `
      + `run scoreboard players set ${marker(runId, phase, 'OBSTACLE')} ${OBJECTIVE} 1`,
    );
    await paperCommand(
      `execute if block 1074 100 1006 minecraft:air `
      + `run scoreboard players set ${marker(runId, phase, 'BYPASS')} ${OBJECTIVE} 1`,
    );
    await paperCommand(`scoreboard players set ${end} ${OBJECTIVE} 1`);
    await delay(250);
    const status = await fetchJson(options.url, '/api/minecraft-server');
    const lines = Array.isArray(status?.server?.logs) ? status.server.logs : [];
    const first = lines.findIndex(line => String(line).includes(begin));
    const last = lines.findLastIndex(line => String(line).includes(end));
    if (first < 0 || last < first) throw new Error(`Paper markers missing for ${runId}-${phase}.`);
    return lines.slice(first, last + 1);
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
        && result?.label === 'action:goToCoordinates'
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
    await paperCommand(`scoreboard objectives remove ${OBJECTIVE}`);
    await paperCommand(`scoreboard objectives add ${OBJECTIVE} dummy`);

    for (let attemptNumber = 1; attemptNumber <= options.attempts; attemptNumber += 1) {
      await resetFixture();
      const runId = `NAV001-R${attemptNumber}`;
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
      const commandAck = await emitAcknowledged(socket, 'send-message', [options.bot, { message: COMMAND }]);
      if (commandAck?.success !== true) throw new Error(`Navigation command rejected: ${JSON.stringify(commandAck)}`);
      const resultState = await waitFor(
        () => activeAttempt?.terminalState || null,
        Boolean,
        `${runId} navigation terminal result`,
        30_000,
      );
      const terminal = resultState.lastResult;
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
        .filter(trace => Number(trace.wallClockTimestamp) <= Number(terminal.finishedAt) + 2_000)
        .sort((left, right) => Number(left.wallClockTimestamp) - Number(right.wallClockTimestamp));
      const linked = traces.filter(trace => (
        trace?.correlation?.actionId === terminal.actionId
        && trace?.correlation?.outcomeLinked === true
        && trace?.activeAction?.owner === 'player'
        && trace?.outcome?.code === terminal.code
      ));
      const positions = activeAttempt.samples.map(sample => sample.position).filter(Boolean);
      const firstProgress = activeAttempt.samples.find(sample => distance(sample.position, beforeState.position) >= 0.4);
      const detoured = positions.some(position => Number(position.x) > 1074.5 && Number(position.z) < 1007);
      const stayedLevel = positions.every(position => Number(position.y) >= 99.5 && Number(position.y) <= 100.5);
      const stable = stableSamples.every(sample => (
        sample.held
        && sample.idle
        && !sample.pathfinding
        && distance(sample.position, stableSamples[0].position) <= 0.05
      ));
      const obstacleVerified = ['BEFORE', 'AFTER'].every(phase => markerObserved(
        phase === 'BEFORE' ? paperBefore : paperAfter,
        marker(runId, phase, 'OBSTACLE'),
      ));
      const bypassVerified = ['BEFORE', 'AFTER'].every(phase => markerObserved(
        phase === 'BEFORE' ? paperBefore : paperAfter,
        marker(runId, phase, 'BYPASS'),
      ));
      const beforePaperPosition = paperPosition(paperBefore, options.bot);
      const afterPaperPosition = paperPosition(paperAfter, options.bot);
      const passed = terminal.phase === 'succeeded'
        && terminal.code === 'skill_arrived'
        && distance(beforePaperPosition, START) <= 0.35
        && distance(afterPaperPosition, TARGET) <= 1.5
        && distance(afterState.position, TARGET) <= 1.5
        && detoured
        && stayedLevel
        && obstacleVerified
        && bypassVerified
        && heldAt - stopAcceptedAt <= 2_000
        && stable
        && linked.length > 0;
      evidence.attempts.push({
        runId,
        attempt: attemptNumber,
        issuedAt: activeAttempt.issuedAt,
        commandAck,
        terminal,
        beforeState,
        afterState,
        firstPhysicalProgressMs: firstProgress ? firstProgress.sampledAt - activeAttempt.issuedAt : null,
        detoured,
        stayedLevel,
        pathfinderGoalChanges: activeAttempt.samples.reduce((count, sample, index, samples) => (
          index > 0 && JSON.stringify(sample.pathfinding) !== JSON.stringify(samples[index - 1].pathfinding)
            ? count + 1
            : count
        ), 0),
        interruptionCount: traces.filter(trace => trace?.winner?.preemption?.involved === true).length,
        resyncRequests: activeAttempt.resyncRequests,
        stop: {
          issuedAt: activeAttempt.stopIssuedAt,
          acceptedAt: stopAcceptedAt,
          heldAt,
          quiescenceMs: heldAt - stopAcceptedAt,
          stableForThreeSeconds: stable,
        },
        paper: {
          beforePosition: beforePaperPosition,
          afterPosition: afterPaperPosition,
          obstacleVerified,
          bypassVerified,
          before: paperBefore,
          after: paperAfter,
        },
        samples: activeAttempt.samples,
        stableSamples,
        outputs: activeAttempt.outputs,
        traces,
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
    attempts: evidence.attempts.map(attempt => ({
      runId: attempt.runId,
      passed: attempt.passed,
      result: `${attempt.terminal?.phase}:${attempt.terminal?.code}`,
      durationMs: attempt.terminal?.durationMs,
      firstPhysicalProgressMs: attempt.firstPhysicalProgressMs,
      detoured: attempt.detoured,
      stayedLevel: attempt.stayedLevel,
      stopQuiescenceMs: attempt.stop?.quiescenceMs,
      stableForThreeSeconds: attempt.stop?.stableForThreeSeconds,
      paperStartDistance: distance(attempt.paper?.beforePosition, START),
      paperTargetDistance: distance(attempt.paper?.afterPosition, TARGET),
      linkedDecisionIds: attempt.linkedDecisionIds,
    })),
    evidence: options.evidence,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!evidence.passed) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
