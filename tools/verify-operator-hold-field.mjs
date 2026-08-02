import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

import { io } from 'socket.io-client';

import { applyStateUpdate } from '../src/mindcraft/public/js/agent-state-protocol.js';

const FIXTURE = Object.freeze({
  x1: 1208,
  x2: 1252,
  y: 250,
  z1: 1078,
  z2: 1122,
  start: Object.freeze({ x: 1230.5, y: 251, z: 1100.5 }),
  movementTarget: Object.freeze({ x: 1242.5, y: 251, z: 1100.5 }),
});
const CLEANUP_POSITION = Object.freeze({ x: 1071.5, y: 100, z: 1007.5 });
const OBJECTIVE = 'holdfieldproof';
const POLL_MS = 80;
const HOLD_WINDOW_MS = 10_000;
const EMERGENCY_LABEL = 'mode:self_preservation';

function parseArgs(argv) {
  const options = {
    url: '',
    bot: 'MindcraftBot',
    attempts: 3,
    evidence: '',
    authorized: false,
  };
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
    autonomy: state?.identity?.runtime?.autonomy || state?.identity?.autonomy || null,
    velocity: state?.body?.velocity || null,
    arbiter: state?.action?.behaviorArbiter?.status || null,
    lastResult: result ? {
      actionId: result.actionId || null,
      phase: result.phase,
      code: result.code,
      label: result.label,
      detail: result.detail,
      evidence: result.evidence || null,
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

function horizontalSpeed(state) {
  return Math.hypot(Number(state?.velocity?.x) || 0, Number(state?.velocity?.z) || 0);
}

function marker(runId, phase, fact) {
  return `#${`${runId}_${phase}_${fact}`.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

function markerObserved(lines, value) {
  return lines.some(line => String(line).includes(`${value} ${OBJECTIVE}`));
}

function paperScore(lines, owner) {
  const ownerPattern = String(owner).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const objectivePattern = OBJECTIVE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    scenario: 'operator-hold-safe-and-bounded-emergency-self-preservation',
    bot: options.bot,
    fixture: FIXTURE,
    startedAt: Date.now(),
    safe: null,
    dangerAttempts: [],
    passed: false,
    error: null,
  };
  let socket = null;
  let states = {};
  let revisions = {};
  let capture = null;

  const paperCommand = command => fetchJson(options.url, '/api/minecraft-server/command', {
    method: 'POST',
    body: JSON.stringify({ command }),
  });

  const sendMessage = async (message) => {
    const result = await emitAcknowledged(socket, 'send-message', [options.bot, { message }]);
    if (result?.success !== true) throw new Error(`Bot command was rejected: ${JSON.stringify(result)}`);
    return result;
  };

  const requestSnapshot = () => socket.emit('request-agent-state-snapshot');

  const waitForState = (accept, description, timeoutMs = 20_000) => waitFor(
    () => compactState(states[options.bot]),
    accept,
    description,
    timeoutMs,
  );

  const waitForHeld = (sampledAfter = 0, timeoutMs = 20_000) => waitForState(
    state => state.sampledAt >= sampledAfter && state.held && state.idle && !state.pathfinding,
    `${options.bot} held actuator quiescence`,
    timeoutMs,
  );

  const waitForPhysicalHold = async (acceptedAt, timeoutMs = 20_000) => {
    const state = await waitForState(
      candidate => candidate.held
        && candidate.idle
        && !candidate.pathfinding
        && horizontalSpeed(candidate) <= 0.02,
      `${options.bot} physically quiescent operator hold`,
      timeoutMs,
    );
    return { state, observedAt: Date.now(), acceptedAt };
  };

  const paperSnapshot = async (runId, phase) => {
    const begin = marker(runId, phase, 'BEGIN');
    const end = marker(runId, phase, 'END');
    await paperCommand(`scoreboard players set ${begin} ${OBJECTIVE} 1`);
    await paperCommand(`execute store result score #health ${OBJECTIVE} run data get entity ${options.bot} Health 10`);
    await paperCommand(`data get entity ${options.bot} Pos`);
    await paperCommand(
      `execute if block ${Math.floor(FIXTURE.start.x)} ${FIXTURE.y} ${Math.floor(FIXTURE.start.z)} minecraft:white_concrete `
      + `run scoreboard players set ${marker(runId, phase, 'PLATFORM')} ${OBJECTIVE} 1`,
    );
    await paperCommand(`scoreboard players get #health ${OBJECTIVE}`);
    await paperCommand(`scoreboard players set ${end} ${OBJECTIVE} 1`);
    await delay(250);
    const status = await fetchJson(options.url, '/api/minecraft-server');
    const lines = Array.isArray(status?.server?.logs) ? status.server.logs : [];
    const first = lines.findIndex(line => String(line).includes(begin));
    const last = lines.findLastIndex(line => String(line).includes(end));
    if (first < 0 || last < first) throw new Error(`Paper markers missing for ${runId}-${phase}.`);
    const proof = lines.slice(first, last + 1);
    return {
      health: paperScore(proof, '#health'),
      positions: paperPositions(proof),
      platformPresent: markerObserved(proof, marker(runId, phase, 'PLATFORM')),
      logs: proof,
    };
  };

  const beginCapture = (issuedAt) => {
    capture = {
      issuedAt,
      samples: [],
      traceMap: new Map(),
      terminalState: null,
    };
    requestSnapshot();
    return capture;
  };

  const stableHeldSamples = async () => {
    const samples = [];
    const startedAt = Date.now();
    while (Date.now() - startedAt <= HOLD_WINDOW_MS) {
      requestSnapshot();
      await delay(1_000);
      samples.push(compactState(states[options.bot]));
    }
    return samples;
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
      if (applied.resyncRequired) requestSnapshot();
      const state = states[options.bot];
      if (!capture || !state) return;
      const compact = compactState(state);
      if (capture.samples.at(-1)?.sampledAt !== compact.sampledAt && capture.samples.length < 512) {
        capture.samples.push(compact);
      }
      for (const trace of state?.action?.behaviorArbiter?.decisionTrace?.recent || []) {
        if (!trace?.decisionId || Number(trace.wallClockTimestamp) < capture.issuedAt - 1_000) continue;
        if (capture.traceMap.size < 512 || capture.traceMap.has(trace.decisionId)) {
          capture.traceMap.set(trace.decisionId, trace);
        }
      }
      const result = compact.lastResult;
      if (
        !capture.terminalState
        && result?.label === EMERGENCY_LABEL
        && Number(result.startedAt) >= capture.issuedAt
      ) capture.terminalState = structuredClone(compact);
    };
    socket.on('state-update', receiveState);
    socket.on('state-delta', receiveState);
    socket.emit('listen-to-agents');
    requestSnapshot();
    await waitFor(() => states[options.bot] || null, Boolean, `${options.bot} canonical state`, 15_000);
    const startupStop = await sendMessage('!stop');
    await waitForHeld(Number(startupStop?.acceptedAt) || Date.now());
    if (compactState(states[options.bot]).autonomy !== 'command') {
      throw new Error('Operator-hold field verification requires command autonomy.');
    }

    await paperCommand(`scoreboard objectives remove ${OBJECTIVE}`);
    await paperCommand(`scoreboard objectives add ${OBJECTIVE} dummy`);
    await paperCommand(`fill ${FIXTURE.x1} ${FIXTURE.y} ${FIXTURE.z1} ${FIXTURE.x2} ${FIXTURE.y} ${FIXTURE.z2} white_concrete`);
    await paperCommand(`tp ${options.bot} ${FIXTURE.start.x} ${FIXTURE.start.y} ${FIXTURE.start.z}`);
    await paperCommand(`effect clear ${options.bot}`);
    await paperCommand(`effect give ${options.bot} minecraft:instant_health 1 4 true`);
    await paperCommand(`effect give ${options.bot} minecraft:saturation 1 255 true`);
    await waitForState(
      state => state.held
        && state.idle
        && !state.pathfinding
        && distance(state.position, FIXTURE.start) <= 0.25
        && Number(state.health) >= 19
        && Number(state.hunger) >= 19,
      'operator-hold fixture readiness',
    );
    await paperCommand(`effect clear ${options.bot} minecraft:saturation`);

    const safeBefore = await paperSnapshot('HOLD-SAFE', 'BEFORE');
    const safeCapture = beginCapture(Date.now());
    const movementAck = await sendMessage(
      `!goToCoordinates(${FIXTURE.movementTarget.x}, ${FIXTURE.movementTarget.y}, ${FIXTURE.movementTarget.z}, 0.5)`,
    );
    const movingState = await waitForState(
      state => !state.held && Boolean(state.pathfinding) && distance(state.position, FIXTURE.start) >= 0.5,
      'safe fixture movement before Stop',
      15_000,
    );
    const stopAck = await sendMessage('!stop');
    const stopAcceptedAt = Number(stopAck?.acceptedAt) || Date.now();
    const physicalHold = await waitForPhysicalHold(stopAcceptedAt, 10_000);
    const heldState = physicalHold.state;
    const heldAt = physicalHold.observedAt;
    const safeStableSamples = await stableHeldSamples();
    const safeAfter = await paperSnapshot('HOLD-SAFE', 'AFTER');
    const safeTraces = [...safeCapture.traceMap.values()]
      .sort((left, right) => Number(left.wallClockTimestamp) - Number(right.wallClockTimestamp));
    const operatorTraces = safeTraces.filter(trace => (
      Number(trace.wallClockTimestamp) >= stopAcceptedAt
      && trace?.winner?.lane === 'operator_hold'
      && trace?.winner?.reasonCode === 'operator_hold_safe'
    ));
    const safeStable = safeStableSamples.length >= 10 && safeStableSamples.every(sample => (
      sample.held
      && sample.idle
      && !sample.pathfinding
      && distance(sample.position, safeStableSamples[0].position) <= 0.05
    ));
    const safePassed = heldAt - stopAcceptedAt <= 2_000
      && safeStable
      && operatorTraces.length > 0
      && safeTraces.every(trace => (
        Number(trace.wallClockTimestamp) < stopAcceptedAt
        || trace?.winner?.lane !== 'emergency_self_preservation'
      ))
      && safeBefore.health >= 190
      && safeAfter.health >= 190
      && safeBefore.platformPresent
      && safeAfter.platformPresent
      && distance(safeAfter.positions.at(-1), safeStableSamples.at(-1).position) <= 0.25;
    evidence.safe = {
      passed: safePassed,
      movementAck,
      movingState,
      stopAck,
      stopAcceptedAt,
      heldAt,
      stopLatencyMs: heldAt - stopAcceptedAt,
      heldState,
      stableSamples: safeStableSamples,
      traces: safeTraces,
      operatorHoldDecisionIds: operatorTraces.map(trace => trace.decisionId),
      paper: { before: safeBefore, after: safeAfter },
    };
    capture = null;
    if (!safePassed) throw new Error('Safe operator-hold scenario did not satisfy its stop and quiescence contract.');

    for (let attemptNumber = 1; attemptNumber <= options.attempts; attemptNumber += 1) {
      await paperCommand(`tp ${options.bot} ${FIXTURE.start.x} ${FIXTURE.start.y} ${FIXTURE.start.z}`);
      await paperCommand(`effect give ${options.bot} minecraft:instant_health 1 4 true`);
      await paperCommand(`effect give ${options.bot} minecraft:saturation 1 255 true`);
      const resetStop = await sendMessage('!stop');
      await waitForState(
        state => state.sampledAt >= (Number(resetStop?.acceptedAt) || 0)
          && state.held
          && state.idle
          && !state.pathfinding
          && distance(state.position, FIXTURE.start) <= 0.25
          && Number(state.health) >= 19,
        `danger attempt ${attemptNumber} readiness`,
      );
      await paperCommand(`effect clear ${options.bot} minecraft:saturation`);
      const runId = `HOLD-DANGER-R${attemptNumber}`;
      const beforeState = compactState(states[options.bot]);
      const paperBefore = await paperSnapshot(runId, 'BEFORE');
      const damageIssuedAt = Date.now();
      const dangerCapture = beginCapture(damageIssuedAt);
      const damageAck = await paperCommand(`damage ${options.bot} 12 minecraft:generic`);
      const paperDamaged = await paperSnapshot(runId, 'DAMAGED');
      const damagedState = await waitForState(
        state => state.sampledAt >= damageIssuedAt && state.held && Number(state.health) <= 10,
        `danger attempt ${attemptNumber} held damage`,
        10_000,
      );
      const terminalState = await waitFor(
        () => dangerCapture.terminalState,
        Boolean,
        `danger attempt ${attemptNumber} self-preservation terminal result`,
        35_000,
      );
      const terminal = terminalState.lastResult;
      const healIssuedAt = Date.now();
      await paperCommand(`effect give ${options.bot} minecraft:instant_health 1 4 true`);
      const returnedHeld = await waitForState(
        state => state.sampledAt >= healIssuedAt
          && state.held
          && state.idle
          && !state.pathfinding
          && Number(state.health) >= 19,
        `danger attempt ${attemptNumber} return to held state`,
        15_000,
      );
      const stableSamples = await stableHeldSamples();
      const paperAfter = await paperSnapshot(runId, 'AFTER');
      const traces = [...dangerCapture.traceMap.values()]
        .sort((left, right) => Number(left.wallClockTimestamp) - Number(right.wallClockTimestamp));
      const emergencyTraces = traces.filter(trace => trace?.winner?.lane === 'emergency_self_preservation');
      const reflexTraces = emergencyTraces.filter(trace => (
        trace?.activeAction?.actionId === terminal.actionId
        && trace?.activeAction?.owner === 'reflex'
        && trace?.activeAction?.label === EMERGENCY_LABEL
      ));
      const linkedTraces = reflexTraces.filter(trace => (
        trace?.correlation?.actionId === terminal.actionId
        && trace?.correlation?.outcomeLinked === true
        && trace?.outcome?.phase === terminal.phase
        && trace?.outcome?.code === terminal.code
      ));
      const returnedHoldTraces = traces.filter(trace => (
        Number(trace.wallClockTimestamp) >= Number(terminal.finishedAt)
        && trace?.winner?.lane === 'operator_hold'
        && trace?.winner?.reasonCode === 'operator_hold_safe'
      ));
      const movedDistance = distance(beforeState.position, terminalState.position);
      const stayedHeld = dangerCapture.samples.every(sample => sample.held);
      const stayedInFixture = dangerCapture.samples.every(sample => (
        Number(sample.position?.x) >= FIXTURE.x1 + 0.25
        && Number(sample.position?.x) <= FIXTURE.x2 + 0.75
        && Number(sample.position?.y) >= FIXTURE.y + 0.5
        && Number(sample.position?.y) <= FIXTURE.y + 1.5
        && Number(sample.position?.z) >= FIXTURE.z1 + 0.25
        && Number(sample.position?.z) <= FIXTURE.z2 + 0.75
      ));
      const stable = stableSamples.length >= 10 && stableSamples.every(sample => (
        sample.held
        && sample.idle
        && !sample.pathfinding
        && distance(sample.position, stableSamples[0].position) <= 0.05
      ));
      const passed = damagedState.held
        && terminal.phase === 'succeeded'
        && terminal.code === 'skill_retreated'
        && movedDistance >= 11.5
        && movedDistance <= 16
        && stayedHeld
        && stayedInFixture
        && emergencyTraces.length > 0
        && reflexTraces.length > 0
        && linkedTraces.length > 0
        && returnedHoldTraces.length > 0
        && returnedHeld.held
        && stable
        && paperBefore.health >= 190
        && paperDamaged.health > 0
        && paperDamaged.health <= 100
        && paperAfter.health >= 190
        && [paperBefore, paperDamaged, paperAfter].every(snapshot => snapshot.platformPresent)
        && distance(paperAfter.positions.at(-1), stableSamples.at(-1).position) <= 0.25;
      evidence.dangerAttempts.push({
        attempt: attemptNumber,
        passed,
        damageIssuedAt,
        damageAck,
        beforeState,
        damagedState,
        terminal,
        terminalState,
        movedDistance,
        returnedHeld,
        stableSamples,
        stayedHeld,
        stayedInFixture,
        traces,
        emergencyDecisionIds: emergencyTraces.map(trace => trace.decisionId),
        reflexDecisionIds: reflexTraces.map(trace => trace.decisionId),
        linkedDecisionIds: linkedTraces.map(trace => trace.decisionId),
        returnedHoldDecisionIds: returnedHoldTraces.map(trace => trace.decisionId),
        paper: { before: paperBefore, damaged: paperDamaged, after: paperAfter },
      });
      capture = null;
      if (!passed) throw new Error(`Danger operator-hold attempt ${attemptNumber} did not satisfy its bounded-reflex contract.`);
    }

    evidence.passed = evidence.safe?.passed === true
      && evidence.dangerAttempts.length === options.attempts
      && evidence.dangerAttempts.every(attempt => attempt.passed);
  } catch (error) {
    evidence.error = String(error?.stack || error?.message || error).slice(0, 4_000);
    if (capture) {
      evidence.failureCapture = {
        issuedAt: capture.issuedAt,
        samples: capture.samples,
        traces: [...capture.traceMap.values()],
        terminalState: capture.terminalState,
      };
    }
  } finally {
    const cleanup = { errors: [] };
    if (socket?.connected) {
      try {
        await paperCommand(`effect give ${options.bot} minecraft:instant_health 1 4 true`);
        await paperCommand(`effect give ${options.bot} minecraft:saturation 1 255 true`);
        const stopAck = await sendMessage('!stop');
        await waitForHeld(Number(stopAck?.acceptedAt) || 0, 15_000);
        await paperCommand(`tp ${options.bot} ${CLEANUP_POSITION.x} ${CLEANUP_POSITION.y} ${CLEANUP_POSITION.z}`);
        await paperCommand(`fill ${FIXTURE.x1} ${FIXTURE.y} ${FIXTURE.z1} ${FIXTURE.x2} ${FIXTURE.y} ${FIXTURE.z2} air`);
        await paperCommand(`kill @e[type=item,x=${FIXTURE.x1},y=${FIXTURE.y},z=${FIXTURE.z1},dx=${FIXTURE.x2 - FIXTURE.x1},dy=3,dz=${FIXTURE.z2 - FIXTURE.z1}]`);
        await waitForState(
          state => state.held
            && state.idle
            && !state.pathfinding
            && state.autonomy === 'command'
            && Number(state.health) >= 19
            && Number(state.hunger) >= 19
            && distance(state.position, CLEANUP_POSITION) <= 0.25,
          'clean operator-hold field state',
          20_000,
        );
        await paperCommand(`effect clear ${options.bot} minecraft:saturation`);
        await paperCommand(`scoreboard objectives remove ${OBJECTIVE}`);
        cleanup.held = true;
        cleanup.autonomy = 'command';
        cleanup.position = compactState(states[options.bot]).position;
        cleanup.health = compactState(states[options.bot]).health;
        cleanup.hunger = compactState(states[options.bot]).hunger;
        cleanup.platformRemoved = true;
      } catch (error) {
        cleanup.errors.push(String(error?.stack || error?.message || error).slice(0, 2_000));
      }
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
    safe: evidence.safe ? {
      passed: evidence.safe.passed,
      stopLatencyMs: evidence.safe.stopLatencyMs,
      operatorHoldDecisions: evidence.safe.operatorHoldDecisionIds.length,
    } : null,
    dangerAttempts: evidence.dangerAttempts.map(attempt => ({
      attempt: attempt.attempt,
      passed: attempt.passed,
      result: `${attempt.terminal?.phase}:${attempt.terminal?.code}`,
      movedDistance: attempt.movedDistance,
      stayedHeld: attempt.stayedHeld,
      emergencyDecisions: attempt.emergencyDecisionIds.length,
      reflexDecisions: attempt.reflexDecisionIds.length,
      linkedDecisions: attempt.linkedDecisionIds.length,
      returnedHoldDecisions: attempt.returnedHoldDecisionIds.length,
      paperHealth: `${attempt.paper?.before?.health}->${attempt.paper?.damaged?.health}->${attempt.paper?.after?.health}`,
    })),
    cleanup: evidence.cleanup,
    evidence: options.evidence,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!evidence.passed) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
