import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

import { io } from 'socket.io-client';

import { applyStateUpdate } from '../src/mindcraft/public/js/agent-state-protocol.js';

const TARGETS = Object.freeze([
  Object.freeze({ x: 1032, y: 100, z: 1013 }),
  Object.freeze({ x: 1035, y: 100, z: 1013 }),
  Object.freeze({ x: 1038, y: 100, z: 1013 }),
]);
const COMMAND = '!collectBlocksInRange("cobblestone", 3, 64)';
const POLL_MS = 200;
const PAPER_OBJECTIVE = 'min001evidence';
const SUPPORT_BLOCK = 'polished_andesite';

function parseArgs(argv) {
  const options = {
    url: '',
    bot: 'MindcraftBot',
    attempts: 3,
    evidence: '',
    authorizedActiveWorld: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--url') options.url = String(argv[++index] || '');
    else if (argument === '--bot') options.bot = String(argv[++index] || '');
    else if (argument === '--attempts') options.attempts = Number(argv[++index]);
    else if (argument === '--evidence') options.evidence = String(argv[++index] || '');
    else if (argument === '--authorized-active-world') options.authorizedActiveWorld = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.url) throw new Error('An explicit --url is required.');
  if (!options.evidence) throw new Error('An explicit --evidence path is required.');
  if (!options.authorizedActiveWorld) {
    throw new Error('Live fixture mutation requires --authorized-active-world.');
  }
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

const delay = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

async function waitFor(read, accept, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await read();
    if (accept(latest)) return latest;
    await delay(POLL_MS);
  }
  throw new Error(`Timed out waiting for ${label}. Last observation: ${JSON.stringify(latest)}`);
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
    const socket = io(baseUrl, {
      reconnection: false,
      timeout: 15_000,
      transports: ['websocket'],
    });
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('Dashboard socket connection timed out.'));
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
    velocity: state?.body?.velocity || null,
    held: state?.action?.held === true,
    idle: state?.action?.isIdle === true,
    pathfinding: state?.action?.pathfinding || null,
    current: state?.action?.current || null,
    cobblestone: Number(state?.inventory?.counts?.cobblestone) || 0,
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

function tracesFrom(state) {
  return state?.action?.behaviorArbiter?.decisionTrace?.recent || [];
}

function paperInventoryCount(lines) {
  for (const line of [...lines].reverse()) {
    const found = String(line).match(/Found (\d+) matching item\(s\) on player/i);
    if (found) return Number(found[1]);
    if (/No items were found on player/i.test(String(line))) return 0;
  }
  return null;
}

function paperMarker(runId, phase, fact) {
  return `#${`${runId}_${phase}_${fact}`.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

function paperMarkerObserved(lines, marker) {
  return lines.some(line => String(line).includes(`Set [${PAPER_OBJECTIVE}] for ${marker} to 1`));
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const evidence = {
    schemaVersion: 1,
    scenario: 'typed-visible-resource-collection',
    command: COMMAND,
    bot: options.bot,
    startedAt: Date.now(),
    fixture: {
      botStart: { x: 1028.5, y: 100, z: 1008.5 },
      collectionLane: { from: { x: 1026, y: 99, z: 1006 }, to: { x: 1040, y: 103, z: 1016 } },
      targets: TARGETS,
    },
    attempts: [],
    passed: false,
    error: null,
  };
  let socket = null;
  let states = {};
  let revisions = {};
  let activeAttempt = null;

  const paperCommand = async (command) => {
    await fetchJson(options.url, '/api/minecraft-server/command', {
      method: 'POST',
      body: JSON.stringify({ command }),
    });
  };

  const paperSnapshot = async (runId, phase, expectedTarget) => {
    const begin = paperMarker(runId, phase, 'BEGIN');
    const end = paperMarker(runId, phase, 'END');
    await paperCommand(`scoreboard players set ${begin} ${PAPER_OBJECTIVE} 1`);
    await paperCommand(`data get entity ${options.bot} Pos`);
    await paperCommand(`data get entity ${options.bot} Health`);
    await paperCommand(`data get entity ${options.bot} foodLevel`);
    await paperCommand(`clear ${options.bot} minecraft:cobblestone 0`);
    for (let index = 0; index < TARGETS.length; index += 1) {
      const target = TARGETS[index];
      const supportMatch = paperMarker(runId, phase, `S${index}_SUPPORT`);
      const supportMismatch = paperMarker(runId, phase, `S${index}_NOT_SUPPORT`);
      const targetMatch = paperMarker(runId, phase, `T${index}_${expectedTarget.toUpperCase()}`);
      const targetMismatch = paperMarker(runId, phase, `T${index}_NOT_${expectedTarget.toUpperCase()}`);
      await paperCommand(
        `execute if block ${target.x} ${target.y - 1} ${target.z} minecraft:${SUPPORT_BLOCK} `
        + `run scoreboard players set ${supportMatch} ${PAPER_OBJECTIVE} 1`,
      );
      await paperCommand(
        `execute unless block ${target.x} ${target.y - 1} ${target.z} minecraft:${SUPPORT_BLOCK} `
        + `run scoreboard players set ${supportMismatch} ${PAPER_OBJECTIVE} 1`,
      );
      await paperCommand(
        `execute if block ${target.x} ${target.y} ${target.z} minecraft:${expectedTarget} `
        + `run scoreboard players set ${targetMatch} ${PAPER_OBJECTIVE} 1`,
      );
      await paperCommand(
        `execute unless block ${target.x} ${target.y} ${target.z} minecraft:${expectedTarget} `
        + `run scoreboard players set ${targetMismatch} ${PAPER_OBJECTIVE} 1`,
      );
    }
    await paperCommand(`scoreboard players set ${end} ${PAPER_OBJECTIVE} 1`);
    await delay(250);
    const status = await fetchJson(options.url, '/api/minecraft-server');
    const lines = Array.isArray(status?.server?.logs) ? status.server.logs : [];
    const first = lines.findIndex((line) => String(line).includes(begin));
    const last = lines.findLastIndex((line) => String(line).includes(end));
    if (first < 0 || last < first) throw new Error(`Paper evidence markers were not retained for ${runId}-${phase}.`);
    return lines.slice(first, last + 1);
  };

  const waitForHeld = (sampledAfter = 0, timeoutMs = 30_000) => waitFor(
    () => states[options.bot] || null,
    state => Number(state?._meta?.sampledAt) >= sampledAfter
      && state?.action?.held === true
      && state?.action?.isIdle === true
      && !state?.action?.pathfinding,
    `${options.bot} held actuator quiescence`,
    timeoutMs,
  );

  const sendStop = async () => {
    const result = await emitAcknowledged(socket, 'send-message', [options.bot, { message: '!stop' }]);
    if (result?.success !== true) throw new Error(`Stop command was rejected: ${JSON.stringify(result)}`);
    return result;
  };

  const triggerStop = (reason) => {
    if (!activeAttempt || activeAttempt.stopPromise) return;
    activeAttempt.stopTriggeredBy = reason;
    activeAttempt.stopIssuedAt = Date.now();
    activeAttempt.stopPromise = sendStop();
    // The main attempt flow awaits and propagates this same promise. Attach a
    // handler now so a fast rejection cannot become transiently unhandled.
    activeAttempt.stopPromise.catch(() => {});
  };

  const resetFixture = async () => {
    await waitForHeld();
    await paperCommand(`gamemode survival ${options.bot}`);
    await paperCommand(`tp ${options.bot} 1028.5 100 1008.5`);
    await paperCommand(`fill 1026 99 1006 1040 99 1016 ${SUPPORT_BLOCK}`);
    await paperCommand('fill 1026 100 1006 1040 103 1016 air');
    for (const target of TARGETS) {
      await paperCommand(`setblock ${target.x} ${target.y} ${target.z} stone`);
    }
    await paperCommand('kill @e[type=item,x=1026,y=99,z=1006,dx=14,dy=6,dz=10]');
    await paperCommand(`clear ${options.bot} minecraft:cobblestone`);
    await paperCommand(`effect give ${options.bot} minecraft:instant_health 1 4 true`);
    await paperCommand(`effect give ${options.bot} minecraft:saturation 180 1 true`);
    await waitFor(
      () => states[options.bot] || null,
      state => {
        const position = state?.gameplay?.position;
        return state?.action?.held === true
          && state?.action?.isIdle === true
          && !state?.action?.pathfinding
          && Math.abs(Number(position?.x) - 1028.5) < 0.2
          && Math.abs(Number(position?.y) - 100) < 0.2
          && Math.abs(Number(position?.z) - 1008.5) < 0.2
          && Number(state?.gameplay?.health) >= 19
          && Number(state?.gameplay?.hunger) >= 19
          && (Number(state?.inventory?.counts?.cobblestone) || 0) === 0;
      },
      'verified reset state',
      20_000,
    );
  };

  try {
    const health = await fetchJson(options.url, '/api/health');
    if (health?.checks?.minecraftReachable !== true) throw new Error('Paper is not reachable.');
    const agents = await fetchJson(options.url, '/api/agents');
    const agent = agents?.agents?.find(entry => entry?.name === options.bot);
    if (agent?.state !== 'running' || agent?.in_game !== true || agent?.socket_connected !== true) {
      throw new Error(`${options.bot} must already be world-ready.`);
    }

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
      const previous = activeAttempt.stateSamples.at(-1);
      if (!previous || previous.sampledAt !== compact.sampledAt) {
        if (activeAttempt.stateSamples.length < 160) activeAttempt.stateSamples.push(compact);
        const y = Number(compact.position?.y);
        if (Number.isFinite(y)) activeAttempt.minimumY = Math.min(activeAttempt.minimumY, y);
      }
      for (const trace of tracesFrom(state)) {
        if (!trace?.decisionId || Number(trace.wallClockTimestamp) < activeAttempt.issuedAt - 2_000) continue;
        if (activeAttempt.traceMap.size < 256 || activeAttempt.traceMap.has(trace.decisionId)) {
          activeAttempt.traceMap.set(trace.decisionId, trace);
        }
      }
      const result = compact.lastResult;
      if (
        !activeAttempt.terminalState
        && typeof result?.actionId === 'string'
        && result.actionId.length > 0
        && result.label === 'action:collectBlocksInRange'
        && Number(result.startedAt) >= activeAttempt.issuedAt
        && Number(result.finishedAt) >= Number(result.startedAt)
      ) {
        activeAttempt.terminalState = structuredClone(compact);
        triggerStop('correlated_collection_terminal_state');
      }
    };
    socket.on('state-update', receiveState);
    socket.on('state-delta', receiveState);
    socket.on('bot-output', (agentName, output) => {
      if (agentName !== options.bot || !activeAttempt) return;
      const entry = { at: Date.now(), output: String(output).slice(0, 2_000) };
      if (activeAttempt.outputs.length < 64) activeAttempt.outputs.push(entry);
    });
    socket.emit('listen-to-agents');
    socket.emit('request-agent-state-snapshot');
    await waitForHeld();
    await paperCommand(`scoreboard objectives remove ${PAPER_OBJECTIVE}`);
    await paperCommand(`scoreboard objectives add ${PAPER_OBJECTIVE} dummy`);

    for (let attemptNumber = 1; attemptNumber <= options.attempts; attemptNumber += 1) {
      await resetFixture();
      const runId = `MIN001-R${attemptNumber}`;
      const beforeState = compactState(states[options.bot]);
      const paperBefore = await paperSnapshot(runId, 'BEFORE', 'stone');
      activeAttempt = {
        runId,
        attempt: attemptNumber,
        issuedAt: Date.now(),
        beforeState,
        stateSamples: [],
        outputs: [],
        traceMap: new Map(),
        minimumY: Number(beforeState.position?.y),
        resyncRequests: 0,
        terminalState: null,
        stopPromise: null,
        stopIssuedAt: null,
        stopTriggeredBy: null,
      };
      const commandAck = await emitAcknowledged(
        socket,
        'send-message',
        [options.bot, { message: COMMAND }],
      );
      if (commandAck?.success !== true) throw new Error(`Collection command was rejected: ${JSON.stringify(commandAck)}`);
      const resultState = await waitFor(
        () => activeAttempt?.terminalState || null,
        Boolean,
        `${runId} correlated collection terminal result`,
        60_000,
      );
      const terminal = resultState.lastResult;
      if (!activeAttempt.stopPromise) {
        triggerStop('correlated_collection_terminal_state_fallback');
      }
      const stopAck = await activeAttempt.stopPromise;
      const stopAcceptedAt = Number(stopAck?.acceptedAt) || activeAttempt.stopIssuedAt;
      const heldState = await waitForHeld(stopAcceptedAt);
      const heldObservedAt = Number(heldState?._meta?.sampledAt) || Date.now();
      const quiescenceMs = Math.max(0, heldObservedAt - stopAcceptedAt);
      const stableSamples = [];
      for (let second = 0; second <= 10; second += 1) {
        stableSamples.push(compactState(states[options.bot]));
        await delay(1_000);
      }
      const paperAfter = await paperSnapshot(runId, 'AFTER', 'air');
      const afterState = compactState(states[options.bot]);
      const traces = [...activeAttempt.traceMap.values()]
        .filter(trace => Number(trace.wallClockTimestamp) <= Number(terminal.finishedAt) + 2_500)
        .sort((left, right) => Number(left.wallClockTimestamp) - Number(right.wallClockTimestamp));
      const linkedTraces = traces.filter(trace => (
        trace?.correlation?.actionId === terminal.actionId
        && trace?.correlation?.outcomeLinked === true
        && trace?.activeAction?.actionId === terminal.actionId
        && trace?.activeAction?.owner === 'player'
        && trace?.activeAction?.label === terminal.label
        && trace?.outcome?.code === terminal.code
        && trace?.outcome?.phase === terminal.phase
      ));
      const stable = stableSamples.every(sample => (
        sample.held
        && sample.idle
        && !sample.pathfinding
        && Math.abs(Number(sample.position?.x) - Number(stableSamples[0].position?.x)) < 0.05
        && Math.abs(Number(sample.position?.y) - Number(stableSamples[0].position?.y)) < 0.05
        && Math.abs(Number(sample.position?.z) - Number(stableSamples[0].position?.z)) < 0.05
      ));
      const supportsVerified = TARGETS.every((_, index) => (
        paperMarkerObserved(paperBefore, paperMarker(runId, 'BEFORE', `S${index}_SUPPORT`))
        && paperMarkerObserved(paperAfter, paperMarker(runId, 'AFTER', `S${index}_SUPPORT`))
      ));
      const blocksTransitioned = TARGETS.every((_, index) => (
        paperMarkerObserved(paperBefore, paperMarker(runId, 'BEFORE', `T${index}_STONE`))
        && paperMarkerObserved(paperAfter, paperMarker(runId, 'AFTER', `T${index}_AIR`))
      ));
      const paperBeforeCount = paperInventoryCount(paperBefore);
      const paperAfterCount = paperInventoryCount(paperAfter);
      const passed = terminal.phase === 'succeeded'
        && terminal.code === 'skill_collected'
        && beforeState.cobblestone === 0
        && afterState.cobblestone === 3
        && paperBeforeCount === 0
        && paperAfterCount === 3
        && supportsVerified
        && blocksTransitioned
        && activeAttempt.minimumY >= 99.5
        && quiescenceMs <= 2_000
        && stable
        && linkedTraces.length > 0;
      evidence.attempts.push({
        runId,
        attempt: attemptNumber,
        issuedAt: activeAttempt.issuedAt,
        commandAck,
        terminal,
        beforeState,
        afterState,
        minimumY: activeAttempt.minimumY,
        resyncRequests: activeAttempt.resyncRequests,
        stop: {
          triggeredBy: activeAttempt.stopTriggeredBy,
          issuedAt: activeAttempt.stopIssuedAt,
          acceptedAt: stopAcceptedAt,
          heldObservedAt,
          quiescenceMs,
          stableForTenSeconds: stable,
        },
        paper: {
          beforeInventoryCount: paperBeforeCount,
          afterInventoryCount: paperAfterCount,
          supportsVerified,
          blocksTransitioned,
          before: paperBefore,
          after: paperAfter,
        },
        outputs: activeAttempt.outputs,
        stateSamples: activeAttempt.stateSamples,
        stableSamples,
        traces,
        linkedDecisionIds: linkedTraces.map(trace => trace.decisionId),
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
        let cleanupStopAcceptedAt = 0;
        if (states[options.bot]?.action?.held !== true) {
          const cleanupStop = await sendStop();
          cleanupStopAcceptedAt = Number(cleanupStop?.acceptedAt) || Date.now();
        }
        await waitForHeld(cleanupStopAcceptedAt, 10_000);
        await resetFixture();
        await paperCommand(`scoreboard objectives remove ${PAPER_OBJECTIVE}`);
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
      cobblestone: `${attempt.beforeState?.cobblestone}->${attempt.afterState?.cobblestone}`,
      minimumY: attempt.minimumY,
      quiescenceMs: attempt.stop?.quiescenceMs,
      stableForTenSeconds: attempt.stop?.stableForTenSeconds,
      supportsVerified: attempt.paper?.supportsVerified,
      blocksTransitioned: attempt.paper?.blocksTransitioned,
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
