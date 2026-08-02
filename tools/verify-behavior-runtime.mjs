import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { io } from 'socket.io-client';

import { applyStateUpdate } from '../src/mindcraft/public/js/agent-state-protocol.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CASES_PATH = resolve(ROOT, 'tests/runtime/behavior-runtime-cases.json');
const DEFAULT_DEADLINE_MS = 120_000;
const POLL_MS = 500;
const ACTIVE_STATES = new Set(['starting', 'running', 'restarting', 'stopping']);

function parseArgs(argv) {
  const options = {
    cases: [],
    dryRun: false,
    authorizedActiveWorld: false,
    deadlineMs: DEFAULT_DEADLINE_MS,
    url: '',
    bot: 'MindcraftBot',
    evidence: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--authorized-active-world') options.authorizedActiveWorld = true;
    else if (argument === '--case') options.cases.push(String(argv[++index] || ''));
    else if (argument === '--url') options.url = String(argv[++index] || '');
    else if (argument === '--bot') options.bot = String(argv[++index] || '');
    else if (argument === '--evidence') options.evidence = String(argv[++index] || '');
    else if (argument === '--deadline-ms') options.deadlineMs = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.cases.length) options.cases.push('preflight');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(options.bot)) {
    throw new Error('Bot name must contain only letters, numbers, underscores, or hyphens.');
  }
  if (!Number.isFinite(options.deadlineMs) || options.deadlineMs < 5_000 || options.deadlineMs > 600_000) {
    throw new Error('Deadline must be between 5000 and 600000 milliseconds.');
  }
  if (!options.dryRun && !options.url) {
    throw new Error('Live verification requires an explicit --url.');
  }
  return options;
}

async function loadCases(ids) {
  const allCases = JSON.parse(await readFile(CASES_PATH, 'utf8'));
  const selected = ids.map((id) => {
    const entry = allCases.find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`Unknown runtime case: ${id}`);
    return entry;
  });
  return selected;
}

function normalizeBaseUrl(value) {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Runtime verifier URL must use http or https.');
  }
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

async function fetchJson(baseUrl, path, deadlineMs = 10_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deadlineMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`${path} returned HTTP ${response.status}: ${JSON.stringify(body)}`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForCondition(read, accept, description, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  let latest;
  while (Date.now() < deadline) {
    latest = await read();
    if (accept(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`Timed out waiting for ${description}. Last value: ${JSON.stringify(latest)}`);
}

function connectDashboard(baseUrl, deadlineMs) {
  return new Promise((resolve, reject) => {
    const socket = io(baseUrl, {
      reconnection: false,
      timeout: deadlineMs,
      transports: ['websocket'],
    });
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('Timed out connecting the dashboard socket.'));
    }, deadlineMs);
    socket.once('connect', () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timeout);
      socket.close();
      reject(error);
    });
  });
}

function emitAcknowledged(socket, event, args, deadlineMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`${event} acknowledgement timed out.`)),
      deadlineMs,
    );
    socket.emit(event, ...args, (result) => {
      clearTimeout(timeout);
      resolve(result);
    });
  });
}

function agentFrom(payload, bot) {
  return Array.isArray(payload?.agents)
    ? payload.agents.find((entry) => entry?.name === bot) || null
    : null;
}

function activeAgent(agent) {
  return Boolean(agent && (agent.in_game || agent.socket_connected || ACTIVE_STATES.has(agent.state)));
}

export function validatePreflightPayloads(health, agentsPayload, bot) {
  if (health?.success !== true) {
    throw new Error('/api/health did not report success.');
  }
  if (health?.checks?.minecraftReachable !== true) {
    throw new Error('Configured Minecraft server is not reachable.');
  }
  if (agentsPayload?.success !== true || !Array.isArray(agentsPayload?.agents)) {
    throw new Error('/api/agents did not return a successful agents array.');
  }
  const selectedAgent = agentFrom(agentsPayload, bot);
  if (!selectedAgent) {
    throw new Error(`Configured bot '${bot}' is not registered.`);
  }
  if (activeAgent(selectedAgent)) {
    throw new Error(`Configured bot '${bot}' must be stopped before verification.`);
  }
  return {
    healthSuccess: true,
    minecraftReachable: true,
    healthProblems: Array.isArray(health.problems) ? health.problems : [],
    registeredAgents: agentsPayload.agents.map((entry) => entry.name),
    selectedAgent,
  };
}

export function matchesExpectedActionResult(state, commandIssuedAt, expected) {
  const result = state?.action?.lastResult;
  return (
    Number(state?._meta?.sampledAt) >= commandIssuedAt
    && Number(result?.finishedAt) >= commandIssuedAt
    && result?.phase === expected?.phase
    && result?.code === expected?.code
    && result?.label === expected?.label
  );
}

export function parsePlayerList(lines) {
  if (!Array.isArray(lines)) return null;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = String(lines[index] || '');
    const match = line.match(/There are (\d+) of a max of (\d+) players online(?::\s*(.*))?\.?\s*$/i);
    if (!match) continue;
    const names = String(match[3] || '')
      .replace(/\.$/, '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    return {
      count: Number(match[1]),
      max: Number(match[2]),
      players: names,
      line: line.slice(0, 500),
    };
  }
  return null;
}

export function parsePlayerListAfterLatestCommand(lines) {
  if (!Array.isArray(lines)) return null;
  const commandIndex = lines.findLastIndex((line) => (
    /\[command\]\s*>\s*\/?list\s*$/i.test(String(line || ''))
  ));
  if (commandIndex < 0) return null;
  return parsePlayerList(lines.slice(commandIndex + 1));
}

async function runPreflight(baseUrl, bot) {
  let health = null;
  let agentsPayload = null;
  try {
    [health, agentsPayload] = await Promise.all([
      fetchJson(baseUrl, '/api/health'),
      fetchJson(baseUrl, '/api/agents'),
    ]);
    return {
      id: 'preflight',
      passed: true,
      observed: validatePreflightPayloads(health, agentsPayload, bot),
    };
  } catch (error) {
    return {
      id: 'preflight',
      passed: false,
      error: String(error?.message || error),
      observed: {
        healthSuccess: health?.success === true,
        minecraftReachable: health?.checks?.minecraftReachable === true,
        healthProblems: Array.isArray(health?.problems) ? health.problems : [],
        registeredAgents: Array.isArray(agentsPayload?.agents)
          ? agentsPayload.agents.map((entry) => entry.name)
          : [],
        selectedAgent: agentFrom(agentsPayload, bot),
      },
    };
  }
}

async function postJson(baseUrl, path, body, deadlineMs = 10_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deadlineMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success !== true) {
      throw new Error(`${path} failed: ${JSON.stringify(payload)}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function proveWorldAvailable(baseUrl, options) {
  if (options.authorizedActiveWorld) {
    return {
      provedEmpty: false,
      authorizedOverride: true,
      playerCount: null,
      players: [],
    };
  }
  const statusPayload = await fetchJson(baseUrl, '/api/minecraft-server?logs=1');
  const server = statusPayload?.server;
  if (statusPayload?.success !== true || server?.phase !== 'running' || !Array.isArray(server.logs)) {
    throw new Error(
      'Cannot prove the Minecraft world is empty through the managed server. '
      + 'Use --authorized-active-world only after checking the world yourself.',
    );
  }
  const commandPayload = await postJson(
    baseUrl,
    '/api/minecraft-server/command',
    { command: 'list' },
    Math.min(10_000, options.deadlineMs),
  );
  if (!Array.isArray(commandPayload?.server?.logs)) {
    throw new Error('Managed server did not provide logs for the player check.');
  }
  if (!commandPayload.server.logs.some(line => /\[command\]\s*>\s*\/?list\s*$/i.test(String(line)))) {
    throw new Error('Managed server did not retain the acknowledged player-list command.');
  }
  const listedPayload = await waitForCondition(
    () => fetchJson(baseUrl, '/api/minecraft-server?logs=1'),
    (payload) => parsePlayerListAfterLatestCommand(payload?.server?.logs) !== null,
    'a fresh managed-server player list',
    Math.min(10_000, options.deadlineMs),
  );
  const playerList = parsePlayerListAfterLatestCommand(listedPayload.server.logs);
  if (playerList.count > 0) {
    const detail = playerList.players.length ? `: ${playerList.players.join(', ')}` : '';
    throw new Error(`Refusing an occupied Minecraft world with ${playerList.count} online player(s)${detail}.`);
  }
  return {
    provedEmpty: true,
    authorizedOverride: false,
    playerCount: playerList.count,
    players: playerList.players,
    evidence: playerList.line,
  };
}

async function reconcileBotCleanup(baseUrl, bot, socket, deadlineMs) {
  const cleanup = {
    startedAt: Date.now(),
    finishedAt: null,
    durationMs: null,
    required: false,
    attempted: false,
    success: false,
    acknowledgement: null,
    stopped: null,
    error: null,
  };
  let cleanupSocket = socket;
  let closeCleanupSocket = false;
  try {
    const beforePayload = await fetchJson(baseUrl, '/api/agents');
    const before = agentFrom(beforePayload, bot);
    if (!before) throw new Error(`Bot '${bot}' disappeared before cleanup could be verified.`);
    cleanup.required = activeAgent(before);
    if (!cleanup.required) {
      cleanup.success = true;
      cleanup.stopped = before;
      return cleanup;
    }
    cleanup.attempted = true;
    if (!cleanupSocket?.connected) {
      cleanupSocket = await connectDashboard(baseUrl, Math.min(10_000, deadlineMs));
      closeCleanupSocket = true;
    }
    cleanup.acknowledgement = await emitAcknowledged(
      cleanupSocket,
      'stop-agent',
      [bot],
      Math.min(10_000, deadlineMs),
    );
    if (cleanup.acknowledgement?.success !== true) {
      throw new Error(`Bot cleanup was rejected: ${String(cleanup.acknowledgement?.error || 'no lifecycle result')}`);
    }
    const stoppedPayload = await waitForCondition(
      () => fetchJson(baseUrl, '/api/agents'),
      (payload) => {
        const agent = agentFrom(payload, bot);
        return agent && !activeAgent(agent);
      },
      `${bot} cleanup stop`,
      deadlineMs,
    );
    cleanup.success = true;
    cleanup.stopped = agentFrom(stoppedPayload, bot);
    return cleanup;
  } catch (error) {
    cleanup.error = String(error?.message || error);
    return cleanup;
  } finally {
    cleanup.finishedAt = Date.now();
    cleanup.durationMs = cleanup.finishedAt - cleanup.startedAt;
    if (closeCleanupSocket) cleanupSocket?.close();
  }
}

async function runBotLifecycle(baseUrl, bot, options, runtimeCase) {
  let socket = null;
  let startAttempted = false;
  let latestStates = {};
  let latestRevisions = {};
  const outputs = [];
  const startedAt = Date.now();
  const observed = {
    initial: null,
    worldOccupancy: null,
    startRequestedAt: null,
    startAcknowledgedAt: null,
    startAcknowledgement: null,
    worldReadyObservedAt: null,
    worldReadyMs: null,
    ready: null,
    isolationCommand: null,
    isolationObservedAt: null,
    commandIssuedAt: null,
    command: null,
    actionResultObservedAt: null,
    actionResultLatencyMs: null,
    actionResult: null,
    sampledAt: null,
    outputs,
    cleanupAttempts: [],
    elapsedMs: null,
  };
  try {
    const initialPayload = await fetchJson(baseUrl, '/api/agents');
    const initialAgent = agentFrom(initialPayload, bot);
    observed.initial = initialAgent;
    if (!initialAgent) throw new Error(`Configured bot '${bot}' is not registered.`);
    const activeOthers = initialPayload.agents.filter((entry) => entry.name !== bot && activeAgent(entry));
    if (activeOthers.length && !options.authorizedActiveWorld) {
      throw new Error(`Refusing an active shared world containing: ${activeOthers.map((entry) => entry.name).join(', ')}.`);
    }
    if (activeAgent(initialAgent)) {
      throw new Error(`Refusing to mutate already-active bot '${bot}'. Stop it first or use a dedicated stopped profile.`);
    }
    observed.worldOccupancy = await proveWorldAvailable(baseUrl, options);

    socket = await connectDashboard(baseUrl, Math.min(15_000, options.deadlineMs));
    const receiveState = (payload) => {
      const applied = applyStateUpdate(latestStates, latestRevisions, payload);
      latestStates = applied.states;
      latestRevisions = applied.revisions;
      if (applied.resyncRequired) socket.emit('request-agent-state-snapshot');
    };
    socket.on('state-update', receiveState);
    socket.on('state-delta', receiveState);
    socket.on('bot-output', (agentName, output) => {
      if (agentName === bot) outputs.push(String(output).slice(0, 2_000));
    });
    socket.emit('listen-to-agents');
    socket.emit('request-agent-state-snapshot');

    startAttempted = true;
    observed.startRequestedAt = Date.now();
    const startResult = await emitAcknowledged(socket, 'start-agent', [bot], options.deadlineMs);
    observed.startAcknowledgedAt = Date.now();
    observed.startAcknowledgement = startResult;
    if (startResult?.success !== true) {
      throw new Error(`Bot start failed: ${String(startResult?.error || 'no lifecycle result')}`);
    }

    const readyPayload = await waitForCondition(
      () => fetchJson(baseUrl, '/api/agents'),
      (payload) => {
        const agent = agentFrom(payload, bot);
        return agent?.state === 'running' && agent?.in_game === true && agent?.socket_connected === true;
      },
      `${bot} world-ready state`,
      options.deadlineMs,
    );
    observed.worldReadyObservedAt = Date.now();
    observed.worldReadyMs = observed.worldReadyObservedAt - observed.startRequestedAt;
    const readyAgent = agentFrom(readyPayload, bot);
    observed.ready = readyAgent;

    const isolationResult = await emitAcknowledged(
      socket,
      'send-message',
      [bot, { message: '!setAutonomy("command")' }],
      Math.min(10_000, options.deadlineMs),
    );
    observed.isolationCommand = isolationResult;
    if (isolationResult?.success !== true) {
      throw new Error(`Could not isolate lifecycle action ownership: ${String(isolationResult?.error || 'no result')}`);
    }
    await waitForCondition(
      () => latestStates?.[bot] || null,
      (state) => state?.identity?.runtime?.autonomy === 'command',
      `${bot} command-autonomy isolation`,
      Math.min(10_000, options.deadlineMs),
    );
    observed.isolationObservedAt = Date.now();

    const commandIssuedAt = Date.now();
    observed.commandIssuedAt = commandIssuedAt;
    const commandResult = await emitAcknowledged(
      socket,
      'send-message',
      [bot, { message: runtimeCase.command }],
      Math.min(10_000, options.deadlineMs),
    );
    observed.command = commandResult;
    if (commandResult?.success !== true) {
      throw new Error(`Critical command was not accepted: ${String(commandResult?.error || 'no result')}`);
    }

    const structuredState = await waitForCondition(
      () => latestStates?.[bot] || null,
      (state) => matchesExpectedActionResult(
        state,
        commandIssuedAt,
        runtimeCase.expectedActionResult,
      ),
      `${bot} expected ${runtimeCase.expectedActionResult.label} result`,
      options.deadlineMs,
    );
    observed.actionResultObservedAt = Date.now();
    observed.actionResultLatencyMs = observed.actionResultObservedAt - commandIssuedAt;
    observed.actionResult = structuredState.action.lastResult;
    observed.sampledAt = structuredState._meta.sampledAt;
    const cleanup = await reconcileBotCleanup(baseUrl, bot, socket, options.deadlineMs);
    observed.cleanupAttempts.push(cleanup);
    if (!cleanup.success) throw new Error(`Bot stop failed: ${cleanup.error}`);
    startAttempted = false;
    observed.elapsedMs = Date.now() - startedAt;

    return {
      id: 'bot-lifecycle',
      passed: true,
      observed,
    };
  } catch (error) {
    observed.elapsedMs = Date.now() - startedAt;
    return {
      id: 'bot-lifecycle',
      passed: false,
      error: String(error?.message || error),
      observed,
    };
  } finally {
    if (startAttempted) {
      const cleanup = await reconcileBotCleanup(baseUrl, bot, socket, options.deadlineMs);
      observed.cleanupAttempts.push(cleanup);
    }
    socket?.close();
  }
}

async function writeEvidence(path, payload) {
  if (!path) return;
  const destination = resolve(ROOT, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const selectedCases = await loadCases(options.cases);
  if (options.dryRun) {
    const output = {
      mode: 'dry-run',
      wouldConnect: false,
      url: options.url || null,
      bot: options.bot,
      selectedCases,
      mutations: selectedCases.flatMap((entry) => entry.mutations || []),
    };
    process.stdout.write(`${JSON.stringify(output)}\n`);
    return;
  }

  const baseUrl = normalizeBaseUrl(options.url);
  const report = {
    mode: 'live',
    baseUrl,
    bot: options.bot,
    startedAt: new Date().toISOString(),
    selectedCases: selectedCases.map((entry) => entry.id),
    results: [],
  };
  for (const runtimeCase of selectedCases) {
    process.stderr.write(`[runtime-verifier] ${runtimeCase.id}\n`);
    const result = runtimeCase.id === 'preflight'
      ? await runPreflight(baseUrl, options.bot)
      : await runBotLifecycle(baseUrl, options.bot, options, runtimeCase);
    report.results.push(result);
    if (result.passed !== true) break;
  }
  report.passed = report.results.every((entry) => entry.passed === true);
  report.finishedAt = new Date().toISOString();
  await writeEvidence(options.evidence, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}

async function reportFatalError(error) {
  const failure = {
    mode: process.argv.includes('--dry-run') ? 'dry-run' : 'live',
    passed: false,
    error: String(error?.message || error).slice(0, 1_200),
    finishedAt: new Date().toISOString(),
  };
  const evidenceIndex = process.argv.indexOf('--evidence');
  if (evidenceIndex >= 0 && process.argv[evidenceIndex + 1]) {
    try {
      await writeEvidence(process.argv[evidenceIndex + 1], failure);
    } catch {
      // Preserve the original verification failure.
    }
  }
  process.stdout.write(`${JSON.stringify(failure, null, 2)}\n`);
  process.exitCode = 1;
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  main().catch(reportFatalError);
}
