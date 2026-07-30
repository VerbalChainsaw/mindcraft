import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import process from 'node:process';
import test from 'node:test';

import {
  actionResultFromError,
  actionResultToMessage,
  actionResultToTelemetry,
  createActionResult,
} from '../src/agent/runtime/action-result.js';
import {
  isFallingGameplayBlock,
  isHazardousGameplayBlock,
  isProtectedGameplayBlock,
  isReplaceableGameplayBlock,
  isSafeGameplaySupport,
} from '../src/agent/runtime/gameplay-safety.js';
import {
  matchesExpectedActionResult,
  parsePlayerList,
  validatePreflightPayloads,
} from '../tools/verify-behavior-runtime.mjs';
import { OwnedLocalServices } from '../src/mindcraft/owned-local-services.js';
import { terminateOwnedProcessTree } from '../src/mindcraft/process-tree.js';
import { stopMindcraftRuntime } from '../src/mindcraft/stack-shutdown.js';

test('critical action results preserve phase, sanitize output, and expose bounded telemetry', () => {
  const result = createActionResult({
    actionId: 'action-1',
    label: ' break protected block ',
    phase: 'blocked',
    code: 'protected_block',
    detail: 'Refused\u0000 protected chest',
    target: { name: 'chest', x: 4, y: 70, z: -2, ignored: 'secret' },
    retryable: false,
    startedAt: 10,
    finishedAt: 20,
  });

  assert.deepEqual(result, {
    actionId: 'action-1',
    label: 'break protected block',
    phase: 'blocked',
    code: 'protected_block',
    detail: 'Refused protected chest',
    target: { name: 'chest', x: 4, y: 70, z: -2 },
    evidence: null,
    retryable: false,
    startedAt: 10,
    finishedAt: 20,
  });
  assert.equal(actionResultToMessage(result), 'Blocked (protected_block): Refused protected chest');
  assert.deepEqual(actionResultToTelemetry(result), {
    phase: 'blocked',
    code: 'protected_block',
    label: 'break protected block',
    detail: 'Refused protected chest',
    target: { name: 'chest', x: 4, y: 70, z: -2 },
    retryable: false,
    finishedAt: 20,
  });

  const interrupted = actionResultFromError(new Error('path stopped by player'), {
    actionId: 'action-2',
    label: 'follow',
  });
  assert.equal(interrupted.phase, 'interrupted');
  assert.equal(interrupted.code, 'interrupted');
  assert.equal(interrupted.retryable, true);
});

test('critical gameplay safety classifies protected, replaceable, falling, hazardous, and supported blocks', () => {
  assert.equal(isProtectedGameplayBlock('chest'), true);
  assert.equal(isProtectedGameplayBlock('blue_shulker_box'), true);
  assert.equal(isProtectedGameplayBlock('stone'), false);
  assert.equal(isReplaceableGameplayBlock('tall_grass'), true);
  assert.equal(isReplaceableGameplayBlock('stone'), false);
  assert.equal(isFallingGameplayBlock('red_concrete_powder'), true);
  assert.equal(isFallingGameplayBlock('sandstone'), false);
  assert.equal(isHazardousGameplayBlock('soul_fire'), true);
  assert.equal(isSafeGameplaySupport({ name: 'stone', boundingBox: 'block' }), true);
  assert.equal(isSafeGameplaySupport({ name: 'magma_block', boundingBox: 'block' }), false);
});

test('runtime verifier requires the exact fresh successful action result', () => {
  const expected = {
    phase: 'succeeded',
    code: 'completed',
    label: 'action:stay',
  };
  const state = {
    _meta: { sampledAt: 1_100 },
    action: {
      lastResult: {
        phase: 'succeeded',
        code: 'completed',
        label: 'action:stay',
        finishedAt: 1_050,
      },
    },
  };

  assert.equal(matchesExpectedActionResult(state, 1_000, expected), true);
  assert.equal(matchesExpectedActionResult({
    ...state,
    action: { lastResult: { ...state.action.lastResult, phase: 'blocked' } },
  }, 1_000, expected), false);
  assert.equal(matchesExpectedActionResult({
    ...state,
    action: { lastResult: { ...state.action.lastResult, label: 'reflex:retreat' } },
  }, 1_000, expected), false);
  assert.equal(matchesExpectedActionResult({
    ...state,
    action: { lastResult: { ...state.action.lastResult, finishedAt: 999 } },
  }, 1_000, expected), false);
});

test('runtime verifier preflight requires reachable Minecraft and a registered stopped bot', () => {
  const health = {
    success: true,
    checks: { minecraftReachable: true },
    problems: ['Agent(s) registered but none are in-game yet.'],
  };
  const stoppedAgent = {
    name: 'CriticalBot',
    state: 'stopped',
    in_game: false,
    socket_connected: false,
  };
  const agents = { success: true, agents: [stoppedAgent] };

  assert.equal(validatePreflightPayloads(health, agents, 'CriticalBot').selectedAgent, stoppedAgent);
  assert.throws(
    () => validatePreflightPayloads({
      ...health,
      checks: { minecraftReachable: false },
    }, agents, 'CriticalBot'),
    /not reachable/,
  );
  assert.throws(
    () => validatePreflightPayloads(health, { success: true, agents: [] }, 'CriticalBot'),
    /not registered/,
  );
  assert.throws(
    () => validatePreflightPayloads(health, {
      success: true,
      agents: [{ ...stoppedAgent, state: 'running', in_game: true }],
    }, 'CriticalBot'),
    /must be stopped/,
  );
});

test('runtime verifier parses authoritative managed-server player counts', () => {
  assert.deepEqual(
    parsePlayerList(['[Server thread/INFO]: There are 0 of a max of 20 players online:']),
    {
      count: 0,
      max: 20,
      players: [],
      line: '[Server thread/INFO]: There are 0 of a max of 20 players online:',
    },
  );
  assert.deepEqual(
    parsePlayerList(['There are 2 of a max of 20 players online: Alex, Steve']),
    {
      count: 2,
      max: 20,
      players: ['Alex', 'Steve'],
      line: 'There are 2 of a max of 20 players online: Alex, Steve',
    },
  );
  assert.equal(parsePlayerList(['Done (1.23s)!']), null);
});

test('runtime verifier dry-run reports the exact bounded live command without connecting', () => {
  const execution = spawnSync(process.execPath, [
    'tools/verify-behavior-runtime.mjs',
    '--dry-run',
    '--case',
    'bot-lifecycle',
    '--bot',
    'CriticalBot',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 10_000,
  });

  assert.equal(execution.status, 0, execution.stderr || execution.stdout);
  const output = JSON.parse(execution.stdout);
  assert.equal(output.mode, 'dry-run');
  assert.equal(output.wouldConnect, false);
  assert.equal(output.bot, 'CriticalBot');
  assert.deepEqual(output.selectedCases.map((entry) => entry.id), ['bot-lifecycle']);
  assert.equal(output.selectedCases[0].command, '!stay(1)');
  assert.deepEqual(output.selectedCases[0].expectedActionResult, {
    phase: 'succeeded',
    code: 'completed',
    label: 'action:stay',
  });
  assert.deepEqual(output.mutations, [
    'query managed server player list',
    'start selected bot',
    'send !stay(1) to selected bot',
    'stop selected bot',
  ]);
});

test('stack shutdown runs every owner and reports partial cleanup instead of false success', async () => {
  const calls = [];
  const result = await stopMindcraftRuntime({
    stopDirector: () => { calls.push('director'); return { success: true }; },
    stopTaskRunners: () => { calls.push('tasks'); return { success: true }; },
    stopAgents: () => { calls.push('agents'); return { success: false, error: 'agent remained' }; },
    stopMinecraft: () => {
      calls.push('minecraft');
      return { phase: 'stopped', installed: true };
    },
    stopLocalServices: () => { calls.push('services'); return { success: true }; },
  });

  assert.deepEqual(calls, ['director', 'tasks', 'agents', 'minecraft', 'services']);
  assert.equal(result.success, false);
  assert.match(result.error, /agents: agent remained/);
  assert.equal(result.server.phase, 'stopped');
  assert.equal(result.components.length, 5);
});

test('Mindcraft owns and terminates only the Ollama process it starts', async () => {
  const child = new EventEmitter();
  child.pid = 4242;
  child.exitCode = null;
  child.signalCode = null;
  let spawnOptions = null;
  let discoveryCount = 0;
  let terminatedPid = null;
  const owner = new OwnedLocalServices({
    discoverOllama: () => {
      discoveryCount += 1;
      return discoveryCount === 1 ? [] : [{ name: 'qwen2.5:3b', kind: 'chat' }];
    },
    spawnImpl: (_command, _args, options) => {
      spawnOptions = options;
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
    terminateProcessTree: (target) => {
      terminatedPid = target.pid;
      target.exitCode = 0;
      target.emit('exit', 0, null);
      return { success: true, pid: target.pid, forced: true, error: null };
    },
  });

  const started = await owner.startOllama();
  assert.equal(started.owned, true);
  assert.equal(started.pid, 4242);
  assert.equal(spawnOptions.detached, false);
  assert.equal(spawnOptions.windowsHide, true);

  const stopped = await owner.stopAll();
  assert.equal(stopped.success, true);
  assert.equal(stopped.ollama.stopped, true);
  assert.equal(terminatedPid, 4242);
});

test('Windows owned-process cleanup targets the complete hidden process tree', async () => {
  const child = new EventEmitter();
  child.pid = 4242;
  child.exitCode = null;
  child.signalCode = null;
  let invocation = null;
  const execFileImpl = (file, args, options, callback) => {
    invocation = { file, args, options };
    child.exitCode = 1;
    child.emit('exit', 1, null);
    callback(null);
  };

  const result = await terminateOwnedProcessTree(child, {
    platform: 'win32',
    execFileImpl,
    timeoutMs: 100,
  });

  assert.equal(result.success, true);
  assert.equal(result.forced, true);
  assert.deepEqual(invocation, {
    file: 'taskkill.exe',
    args: ['/PID', '4242', '/T', '/F'],
    options: { windowsHide: true, timeout: 10_000 },
  });
});
