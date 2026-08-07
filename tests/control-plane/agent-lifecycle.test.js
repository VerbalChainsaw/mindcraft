import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
  executeModeAction,
  runBoundedUnstuckRecovery,
} from '../../src/agent/modes.js';
import {
  Agent,
  configureSurvivalOwnership,
  emitStartupMilestone,
  shouldSeedLegacyDefaultGoal,
} from '../../src/agent/agent.js';
import * as Mindcraft from '../../src/mindcraft/mindcraft.js';
import { Prompter } from '../../src/models/prompter.js';
import { AgentProcess, sanitizeAgentDiagnostic } from '../../src/process/agent_process.js';
class FakeChildProcess extends EventEmitter {
  constructor(killResults = [true]) {
    super();
    this.killed = false;
    this.killCalls = [];
    this.killResults = killResults;
  }

  kill(signal) {
    this.killCalls.push(signal);
    const accepted = this.killResults.shift() ?? false;
    if (accepted) this.killed = true;
    return accepted;
  }

  emit(eventName, ...args) {
    if (eventName === 'spawn' && !this.pid) this.pid = 1000;
    return super.emit(eventName, ...args);
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeRegisteredAgentProcess {
  constructor() {
    this.state = 'idle';
    this.lastError = null;
    this.startCalls = 0;
  }

  start() {
    this.startCalls += 1;
    this.state = 'running';
    return Promise.resolve(this);
  }

  isActive() {
    return this.state === 'running';
  }

  stop() {
    this.state = 'stopped';
  }

  forceRestart() {
    this.forceRestartCalls = (this.forceRestartCalls || 0) + 1;
    this.state = 'running';
    return Promise.resolve(this);
  }
}

test('Given bounded unstuck movement, when its deadline expires, then cancellation settles before controls can mutate again', async () => {
  const calls = {
    clearControlStates: 0,
    cleanKill: 0,
    requestInterrupt: 0,
    delayedControlMutation: 0,
  };
  const agent = {
    bot: {
      clearControlStates() {
        calls.clearControlStates += 1;
      },
    },
    cleanKill() {
      calls.cleanKill += 1;
    },
    requestInterrupt() {
      calls.requestInterrupt += 1;
    },
  };

  const result = await runBoundedUnstuckRecovery(agent, {
    moveAway: (_bot, _distance, { signal }) => new Promise(resolve => {
      const delayedMutation = setTimeout(() => {
        calls.delayedControlMutation += 1;
        resolve(true);
      }, 25);
      signal.addEventListener('abort', () => {
        clearTimeout(delayedMutation);
        resolve(false);
      }, { once: true });
    }),
    timeoutMs: 5,
  });

  await new Promise(resolve => setTimeout(resolve, 30));

  assert.deepEqual(result, { success: false, reason: 'timed-out' });
  assert.equal(calls.requestInterrupt, 1);
  assert.equal(calls.clearControlStates, 1);
  assert.equal(calls.cleanKill, 0);
  assert.equal(calls.delayedControlMutation, 0);
});

test('Given a fire-and-forget mode action rejects, when it settles, then the rejection is contained and active state is cleared', async () => {
  const originalConsoleError = console.error;
  const reportedErrors = [];
  console.error = message => reportedErrors.push(String(message));
  const mode = { name: 'test-mode', active: false };
  const agent = {
    actions: {
      currentActionLabel: '',
      resume_func: null,
      runAction: () => {
        const error = new Error('expected test rejection');
        error.name = 'PathStopped';
        return Promise.reject(error);
      },
    },
    self_prompter: {
      isActive: () => false,
      stopLoop() {},
    },
  };

  try {
    const result = await executeModeAction(mode, agent, async () => {});
    assert.equal(result.success, false);
    assert.equal(mode.active, false);
    assert.match(reportedErrors.join('\n'), /expected test rejection/);
  } finally {
    console.error = originalConsoleError;
  }
});

function createChildFactory(children) {
  const calls = [];
  return {
    calls,
    spawnChild: () => {
      const child = children.shift();
      calls.push(child);
      return child;
    },
  };
}

async function startFakeAgent(agentProcess, child) {
  const startup = agentProcess.start();
  child.emit('spawn');
  agentProcess.markReady();
  await startup;
}

test('Given an injected child factory, when an AgentProcess is constructed, then lifecycle startup uses that factory', () => {
  // Given
  const spawnChild = () => {
    throw new Error('test child factory should not start during construction');
  };

  // When
  const agentProcess = new AgentProcess('lifecycle-test', 8080, { spawnChild });

  // Then
  assert.equal(agentProcess.spawnChild, spawnChild);
});

test('Given an agent process capability, when the child is spawned, then the capability is passed privately through the child environment', async () => {
  const child = new FakeChildProcess();
  child.stdout = new PassThrough();
  let spawnOptions;
  const agentProcess = new AgentProcess('BridgeBot', 8080, {
    connectionToken: 'test-bridge-capability',
    spawnChild: (_executable, _args, options) => {
      spawnOptions = options;
      return child;
    },
  });

  const startup = agentProcess.start();
  child.emit('spawn');
  agentProcess.markReady();
  await startup;

  assert.equal(agentProcess.connectionToken, 'test-bridge-capability');
  assert.equal(spawnOptions.env.MINDCRAFT_AGENT_TOKEN, 'test-bridge-capability');
  assert.equal(spawnOptions.windowsHide, true);
  assert.deepEqual(spawnOptions.stdio, ['ignore', 'inherit', 'pipe']);
  assert.equal(child.stdout.listenerCount('data'), 0);
});

test('Given parent, fixed child milestones, and ordinary stderr, when startup fails, then diagnostics retain sanitized errors and ordered stage evidence', async () => {
  const child = new FakeChildProcess();
  child.stderr = new PassThrough();
  let now = 1_000;
  const agentProcess = new AgentProcess('DiagnosticBot', 8080, {
    maxAutoRestarts: 0,
    now: () => now,
    spawnChild: () => child,
  });

  const startup = agentProcess.start();
  now = 1_004;
  child.emit('spawn');
  now = 1_006;
  child.stderr.write('[mindcraft-startup] settings_profile_ready\n');
  child.stderr.write('api_key=super-secret-value\n');
  child.stderr.write('Error: Ollama model unavailable\n');
  child.stderr.write('[mindcraft-startup] login_callback arbitrary-value\n');
  now = 1_007;
  child.stderr.write('[mindcraft-startup] mineflayer_created\n');
  now = 1_009;
  agentProcess.markReadinessStage('bridge_connected');
  now = 1_012;
  agentProcess.markReadinessStage('minecraft_login');
  child.stderr.write('[mindcraft-startup] login_callback\n');
  now = 1_014;
  child.stderr.write('[mindcraft-startup] spawn_callback\n');
  now = 1_016;
  child.stderr.write('[mindcraft-startup] handlers_ready\n');
  now = 1_018;
  agentProcess.markReady();
  await startup;
  now = 1_025;
  child.emit('exit', 1, null);

  assert.equal(agentProcess.state, 'failed');
  assert.equal(agentProcess.lastError, 'Error: Ollama model unavailable');
  assert.deepEqual(agentProcess.getDiagnostics(40), [
    'startup +0ms: process_starting',
    'startup +4ms: process_spawned',
    'startup +6ms: child.settings_profile_ready',
    'api_key=[redacted]',
    'Error: Ollama model unavailable',
    'startup +7ms: child.mineflayer_created',
    'startup +9ms: bridge_connected',
    'startup +12ms: minecraft_login',
    'startup +12ms: child.login_callback',
    'startup +14ms: child.spawn_callback',
    'startup +16ms: child.handlers_ready',
    'startup +18ms: world_ready',
    'startup +25ms: failure',
  ]);
  const evidence = agentProcess.getDiagnostics(40).filter((line) => line.startsWith('startup +'));
  const elapsed = evidence.map((line) => Number(/\+(\d+)ms/.exec(line)[1]));
  assert.deepEqual(elapsed, [...elapsed].sort((first, second) => first - second));
  assert.doesNotMatch(agentProcess.getDiagnostics(40).join('\n'), /arbitrary-value/i);
  assert.equal(sanitizeAgentDiagnostic('Bearer abc123'), 'Bearer [redacted]');
});

test('Given repeated fixed startup markers, when evidence exceeds its limit, then only the newest bounded fixed-vocabulary entries remain', () => {
  const child = new FakeChildProcess();
  child.stderr = new PassThrough();
  let now = 2_000;
  const agentProcess = new AgentProcess('BoundedEvidence', 8080, {
    now: () => now,
    spawnChild: () => child,
  });
  agentProcess.start().catch(() => {});
  child.emit('spawn');

  for (let index = 0; index < 55; index += 1) {
    now += 1;
    const marker = index % 2 === 0 ? 'spawn_callback' : 'handlers_ready';
    child.stderr.write(`[mindcraft-startup] ${marker}\n`);
  }

  const diagnostics = agentProcess.getDiagnostics(100);
  assert.equal(diagnostics.length, 40);
  assert.ok(diagnostics.every((line) => /^startup \+\d+ms: child\.(?:spawn_callback|handlers_ready)$/.test(line)));
  const elapsed = diagnostics.map((line) => Number(/\+(\d+)ms/.exec(line)[1]));
  assert.deepEqual(elapsed, [...elapsed].sort((first, second) => first - second));
  agentProcess.stop();
  child.emit('exit', null, 'SIGINT');
});

test('Given the child milestone writer, when arbitrary or secret-bearing values are requested, then only exact fixed vocabulary is emitted', () => {
  const writes = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = (chunk) => {
    writes.push(String(chunk));
    return true;
  };
  try {
    assert.equal(emitStartupMilestone('mineflayer_created'), true);
    assert.equal(emitStartupMilestone('mineflayer_created token=do-not-emit'), false);
    assert.equal(emitStartupMilestone('bot chat or model output'), false);
  } finally {
    process.stderr.write = originalWrite;
  }
  assert.deepEqual(writes, ['[mindcraft-startup] mineflayer_created\n']);
});

test('Given stale stderr from a handled gameplay warning, when the child later exits, then the warning is not misreported as the crash cause', async () => {
  const child = new FakeChildProcess();
  child.stderr = new PassThrough();
  let now = 1_000;
  const agentProcess = new AgentProcess('StaleDiagnostic', 8080, {
    maxAutoRestarts: 0,
    now: () => now,
    spawnChild: () => child,
  });

  const startup = agentProcess.start();
  child.emit('spawn');
  agentProcess.markReady();
  await startup;
  child.stderr.write('PathStopped: expected navigation cancellation\n');
  now += 31_000;
  child.emit('exit', 1, null);

  assert.equal(agentProcess.lastError, 'Agent process exited with code 1 and signal none');
});

test('Given a child spawn error, when agent startup is awaited, then the agent is failed with a usable error', async () => {
  // Given
  const child = new FakeChildProcess();
  const agentProcess = new AgentProcess('spawn-error', 8080, {
    spawnChild: () => child,
  });

  // When
  const startup = agentProcess.start();
  assert.equal(typeof startup?.then, 'function');
  child.emit('error', new Error('ENOENT: test spawn failure'));

  // Then
  await assert.rejects(() => startup, /ENOENT: test spawn failure/);
  assert.equal(agentProcess.state, 'failed');
  assert.equal(agentProcess.running, false);
  assert.match(agentProcess.lastError, /ENOENT: test spawn failure/);
});

test('Given an accepted stop signal without child exit, when multiple exit waiters are registered, then none settle until the owned child exits', async () => {
  // Given
  const child = new FakeChildProcess();
  const agentProcess = new AgentProcess('wait-for-exit', 8080, { spawnChild: () => child });
  const startup = agentProcess.start();
  const firstWaiter = agentProcess.waitForExit();
  const secondWaiter = agentProcess.waitForExit();
  let settled = false;
  firstWaiter.then(() => { settled = true; });
  child.emit('spawn');
  agentProcess.markReady();
  await startup;

  // When
  assert.equal(agentProcess.stop(), true);
  child.emit('error', new Error('post-spawn error'));
  await Promise.resolve();

  // Then
  assert.equal(firstWaiter, secondWaiter);
  assert.equal(settled, false);
  assert.equal(agentProcess.process, child);
  child.emit('exit', null, 'SIGINT');
  await Promise.all([firstWaiter, secondWaiter]);
  assert.equal(agentProcess.process, null);
});

test('Given a definitive spawn failure, when waiting for exit, then the child-scoped wait resolves after ownership clears', async () => {
  // Given
  const child = new FakeChildProcess();
  const agentProcess = new AgentProcess('wait-spawn-failure', 8080, { spawnChild: () => child });
  const startup = agentProcess.start();
  const exitWait = agentProcess.waitForExit();

  // When
  child.emit('error', new Error('ENOENT: test spawn failure'));

  // Then
  await assert.rejects(startup, /ENOENT: test spawn failure/);
  await exitWait;
  assert.equal(agentProcess.process, null);
});

test('Given a stop before a delayed child spawn, when startup settles, then it rejects without becoming ready', async () => {
  // Given
  const child = new FakeChildProcess();
  const agentProcess = new AgentProcess('stop-before-spawn', 8080, {
    spawnChild: () => child,
  });
  const startup = agentProcess.start();

  // When
  const stopped = agentProcess.stop();
  child.emit('spawn');

  // Then
  assert.equal(stopped, true);
  await assert.rejects(startup, /startup stopped by operator request/);
  assert.deepEqual(child.killCalls, ['SIGINT']);
  assert.equal(agentProcess.running, false);
  assert.equal(agentProcess.state, 'stopping');
  child.emit('exit', null, 'SIGINT');
  assert.equal(agentProcess.state, 'stopped');
});

test('Given an intentional stop, when the child exits with SIGINT, then the agent stops without an automatic restart', async () => {
  // Given
  const child = new FakeChildProcess();
  const factory = createChildFactory([child]);
  const agentProcess = new AgentProcess('manual-stop', 8080, factory);
  await startFakeAgent(agentProcess, child);

  // When
  agentProcess.stop();
  child.emit('exit', null, 'SIGINT');

  // Then
  assert.deepEqual(child.killCalls, ['SIGINT']);
  assert.equal(factory.calls.length, 1);
  assert.equal(agentProcess.state, 'stopped');
});

test('Given repeated unexpected exits, when automatic restart is bounded, then no launcher exit or unbounded respawn occurs', async () => {
  // Given
  const firstChild = new FakeChildProcess();
  const restartedChild = new FakeChildProcess();
  const factory = createChildFactory([firstChild, restartedChild]);
  const agentProcess = new AgentProcess('bounded-restart', 8080, {
    ...factory,
    minAutoRestartUptimeMs: 0,
    maxAutoRestarts: 1,
  });
  await startFakeAgent(agentProcess, firstChild);

  // When
  firstChild.emit('exit', 1, null);
  restartedChild.emit('spawn');
  restartedChild.emit('exit', 1, null);

  // Then
  assert.equal(factory.calls.length, 2);
  assert.equal(agentProcess.state, 'failed');
  assert.match(agentProcess.lastError, /exited with code 1/);
});

test('Given an unexpected Windows control event after stable uptime, when no stop was requested, then bounded recovery restarts the bot', async () => {
  // Given
  const firstChild = new FakeChildProcess();
  const restartedChild = new FakeChildProcess();
  const factory = createChildFactory([firstChild, restartedChild]);
  let now = 0;
  const agentProcess = new AgentProcess('windows-control-recovery', 8080, {
    ...factory,
    now: () => now,
    platform: 'win32',
    minAutoRestartUptimeMs: 10000,
    maxAutoRestarts: 1,
  });
  await startFakeAgent(agentProcess, firstChild);

  // When
  now = 15000;
  firstChild.emit('exit', 0xC000013A, null);
  restartedChild.emit('spawn');
  agentProcess.markReady();

  // Then
  assert.equal(factory.calls.length, 2);
  assert.equal(agentProcess.state, 'running');
  assert.equal(agentProcess.lastError, null);
});

test('Given one explicit restart request, when the current child exits, then exactly one stop-to-start transition occurs', async () => {
  // Given
  const firstChild = new FakeChildProcess();
  const restartedChild = new FakeChildProcess();
  const factory = createChildFactory([firstChild, restartedChild]);
  const agentProcess = new AgentProcess('explicit-restart', 8080, factory);
  await startFakeAgent(agentProcess, firstChild);

  // When
  const restart = agentProcess.forceRestart();
  firstChild.emit('exit', null, 'SIGINT');
  restartedChild.emit('spawn');
  agentProcess.markReady();
  await restart;

  // Then
  assert.deepEqual(firstChild.killCalls, ['SIGINT']);
  assert.equal(factory.calls.length, 2);
  assert.equal(agentProcess.state, 'running');
});

test('Given a post-spawn child error during an explicit restart, when the old child has not exited, then restart ownership remains with that child', async () => {
  // Given
  const firstChild = new FakeChildProcess();
  const recoveredChild = new FakeChildProcess();
  const factory = createChildFactory([firstChild, recoveredChild]);
  const agentProcess = new AgentProcess('restart-error', 8080, factory);
  await startFakeAgent(agentProcess, firstChild);
  const restart = agentProcess.forceRestart();
  const killError = new Error('SIGINT delivery failed');
  let restartSettled = false;
  restart.then(
    () => { restartSettled = true; },
    () => { restartSettled = true; },
  );

  // When
  firstChild.emit('error', killError);
  await Promise.resolve();

  // Then
  assert.equal(restartSettled, true);
  await assert.rejects(restart, /SIGINT delivery failed/);
  assert.equal(agentProcess.state, 'failed');
  assert.equal(agentProcess.running, false);
  assert.match(agentProcess.lastError, /SIGINT delivery failed/);
  assert.equal(agentProcess.process, firstChild);
  assert.equal(agentProcess.isActive(), true);

  const blockedRestart = agentProcess.forceRestart();
  let blockedRestartSettled = false;
  blockedRestart.then(
    () => { blockedRestartSettled = true; },
    () => { blockedRestartSettled = true; },
  );
  await Promise.resolve();
  assert.equal(blockedRestartSettled, false);
  assert.equal(factory.calls.length, 1);

  firstChild.emit('exit', null, 'SIGINT');
  assert.equal(factory.calls.length, 2);
  recoveredChild.emit('spawn');
  agentProcess.markReady();
  await blockedRestart;
  assert.equal(agentProcess.state, 'running');
});

test('Given a failed restart signal delivery, when restart is retried before child exit, then no replacement child is spawned', async () => {
  // Given
  const firstChild = new FakeChildProcess([false, false]);
  const replacementChild = new FakeChildProcess();
  const factory = createChildFactory([firstChild, replacementChild]);
  const agentProcess = new AgentProcess('restart-kill-failure', 8080, {
    ...factory,
    terminateProcessTree: () => Promise.resolve({
      success: false,
      error: 'Unable to terminate owned test process tree.',
    }),
  });
  await startFakeAgent(agentProcess, firstChild);

  // When
  const firstRestart = agentProcess.forceRestart();
  await new Promise((resolve) => setTimeout(resolve, 10));
  // Then
  await assert.rejects(firstRestart, /Unable to terminate owned test process tree/);
  assert.equal(agentProcess.process, firstChild);
  assert.equal(agentProcess.isActive(), true);

  const retry = agentProcess.forceRestart();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await assert.rejects(retry, /Unable to terminate owned test process tree/);
  assert.deepEqual(firstChild.killCalls, ['SIGINT', 'SIGINT']);
  assert.equal(factory.calls.length, 1);
  assert.equal(agentProcess.process, firstChild);
});

test('Given an automatic restart, when lifecycle state changes asynchronously, then status reports finalized restart transitions', async () => {
  // Given
  const firstChild = new FakeChildProcess();
  const restartedChild = new FakeChildProcess();
  const statusReports = [];
  const factory = createChildFactory([firstChild, restartedChild]);
  const agentProcess = new AgentProcess('status-restart', 8080, {
    ...factory,
    minAutoRestartUptimeMs: 0,
    notifyStatus: () => {
      statusReports.push({
        state: agentProcess.state,
        lastError: agentProcess.lastError,
      });
    },
  });
  await startFakeAgent(agentProcess, firstChild);
  statusReports.length = 0;

  // When
  firstChild.emit('exit', 1, null);
  restartedChild.emit('spawn');
  agentProcess.markReady();

  // Then
  assert.deepEqual(statusReports.map((report) => report.state), ['restarting', 'starting', 'starting', 'running']);
  assert.match(statusReports[0].lastError, /exited with code 1/);
  assert.equal(statusReports.at(-1).lastError, null);
});

test('Given lifecycle dependencies, when creating an agent, then Mindcraft accepts an injected runtime seam', () => {
  // Then
  assert.equal(Mindcraft.createAgent.length, 2);
});

test('Given plugin auto-eat, when survival ownership is configured, then unsupervised eating is disabled', () => {
  const calls = [];
  const bot = {
    autoEat: {
      options: null,
      disable() {
        calls.push('disable');
      },
    },
  };

  configureSurvivalOwnership(bot);

  assert.deepEqual(calls, ['disable']);
  assert.equal(bot.autoEat.options.startAt, 14);
  assert.equal(bot.autoEat.options.bannedFood.includes('rotten_flesh'), true);
});

test('Given an agent update, when the coordinated arbiter exists, then Agent delegates the tick once', async () => {
  const calls = [];
  const fakeAgent = {
    behavior_arbiter: {
      update(delta) {
        calls.push(`arbiter:${delta}`);
        return { selectedLane: 'idle' };
      },
    },
  };

  const result = await Agent.prototype.update.call(fakeAgent, 25);

  assert.deepEqual(calls, ['arbiter:25']);
  assert.equal(result.selectedLane, 'idle');
});

test('Given the arbiter suppresses lower lanes, when Agent updates, then that decision is preserved', async () => {
  const calls = [];
  const fakeAgent = {
    behavior_arbiter: {
      update() {
        calls.push('arbiter');
        return { selectedLane: 'basic_survival', lowerLanesSuppressed: true };
      },
    },
  };

  const result = await Agent.prototype.update.call(fakeAgent, 25);

  assert.deepEqual(calls, ['arbiter']);
  assert.equal(result.lowerLanesSuppressed, true);
});

test('Given runtime-configured role bots, when legacy default-goal seeding is evaluated, then role autonomy keeps control and self-prompt bootstrap stays off', () => {
  assert.equal(
    shouldSeedLegacyDefaultGoal(
      { runtime: { role: 'companion', autonomy: 'balanced' } },
      { role: 'companion', autonomy: 'balanced' },
      { default_goal: 'Gather and explore.' },
    ),
    false,
  );

  assert.equal(
    shouldSeedLegacyDefaultGoal(
      { runtime: { role: 'builder', autonomy: 'autonomous' } },
      { role: 'builder', autonomy: 'autonomous' },
      { default_goal: 'Gather and build.' },
    ),
    false,
  );
});

test('Given a legacy profile without runtime behavior, when default-goal seeding is evaluated, then the old self-prompt bootstrap still works', () => {
  assert.equal(
    shouldSeedLegacyDefaultGoal(
      { name: 'andy' },
      { role: 'companion', autonomy: 'balanced' },
      { default_goal: 'Gather and explore.' },
    ),
    true,
  );

  assert.equal(
    shouldSeedLegacyDefaultGoal(
      { name: 'andy' },
      { role: 'companion', autonomy: 'command' },
      { default_goal: 'Gather and explore.' },
    ),
    false,
  );
});

test('Given autonomy output containing think tags, when the autonomy generator strips them, then the command survives without throwing', async () => {
  const sentPrompts = [];
  const response = await Prompter.prototype._generateAutonomy.call({
    agent: { name: 'RoleBot', runtime: { limits: { maxPromptTurns: 1 } } },
    chat_model: {
      sendRequest(_messages, prompt) {
        sentPrompts.push(prompt);
        return '</think>!followPlayer("Director", 3)';
      },
    },
    async checkCooldown() {},
  }, 'Autonomy prompt');

  assert.equal(sentPrompts.length, 1);
  assert.equal(response, '!followPlayer("Director", 3)');
});

test('Given an existing live agent, when duplicate creation is requested, then Mindcraft preserves the registered process', async () => {
  // Given
  const agentName = 'DuplicateBot';
  const createdProcesses = [];
  const runtime = {
    resolveServer: () => Promise.resolve({ host: '127.0.0.1', port: 25565, version: '1.21.8' }),
    createAgentProcess: () => {
      const agentProcess = new FakeRegisteredAgentProcess();
      createdProcesses.push(agentProcess);
      return agentProcess;
    },
  };
  const settings = {
    host: '127.0.0.1',
    port: 25565,
    minecraft_version: 'auto',
    profile: { name: agentName },
  };

  try {
    // When
    const first = await Mindcraft.createAgent(settings, runtime);
    const second = await Mindcraft.createAgent(settings, runtime);

    // Then
    assert.equal(first.success, true);
    assert.equal(second.success, false);
    assert.equal(createdProcesses.length, 1);
    assert.equal(Mindcraft.getAgentProcess(agentName), createdProcesses[0]);
  } finally {
    Mindcraft.destroyAgent(agentName);
  }
});

test('Given an inactive blocked placeholder, when a normal create replaces it, then an ordinary restart follows the live agent path', async () => {
  // Given
  const agentName = 'ManualBot';
  const settings = {
    host: '127.0.0.1',
    port: 25565,
    minecraft_version: 'auto',
    profile: { name: agentName, model: 'ollama/local' },
  };
  const liveProcess = new FakeRegisteredAgentProcess();
  Mindcraft.registerBlockedAgent(settings, {
    name: agentName,
    state: 'blocked',
    running: false,
    retryable: false,
    lastError: 'Duplicate agent name.',
  });

  try {
    // When
    const createResult = await Mindcraft.createAgent(settings, {
      resolveServer: () => Promise.resolve({ host: '127.0.0.1', port: 25565, version: '1.21.8' }),
      createAgentProcess: () => liveProcess,
    });
    const restartResult = await Mindcraft.startAgent(agentName);

    // Then
    assert.deepEqual(createResult, { success: true, error: null });
    assert.deepEqual(restartResult, { success: true, error: null });
    assert.equal(liveProcess.forceRestartCalls, 1);
    assert.equal(Mindcraft.getAgentProcess(agentName), liveProcess);
  } finally {
    Mindcraft.destroyAgent(agentName);
  }
});

test('Given a configured profile with auto-start disabled, when it is registered, then the dashboard can start it on demand', async () => {
  const agentName = 'ReadyManualBot';
  const settings = {
    host: '127.0.0.1',
    port: 25565,
    minecraft_version: 'auto',
    profile: { name: agentName, model: 'ollama/local' },
  };
  const liveProcess = new FakeRegisteredAgentProcess();
  const configured = Mindcraft.registerConfiguredAgent(settings, {
    name: agentName,
    state: 'ready',
    running: false,
    retryable: false,
    lastError: null,
  });

  try {
    assert.equal(configured.state, 'stopped');

    const startResult = await Mindcraft.startAgent(agentName, {
      hasKey: () => true,
      resolveServer: () => Promise.resolve({ host: '127.0.0.1', port: 25565, version: '1.21.8' }),
      createAgentProcess: () => liveProcess,
    });

    assert.deepEqual(startResult, { success: true, error: null });
    assert.equal(liveProcess.state, 'running');
    assert.equal(Mindcraft.getAgentProcess(agentName), liveProcess);
  } finally {
    Mindcraft.destroyAgent(agentName);
  }
});

test('Given a delayed normal create for an old blocked placeholder, when a newer blocked generation replaces it, then the stale create leaves the newer placeholder current', async () => {
  // Given
  const agentName = 'StaleManualBot';
  const settings = {
    host: '127.0.0.1',
    port: 25565,
    minecraft_version: 'auto',
    profile: { name: agentName, model: 'ollama/local' },
  };
  let releaseServer;
  let createdProcesses = 0;
  Mindcraft.registerBlockedAgent(settings, {
    name: agentName,
    state: 'blocked',
    running: false,
    retryable: false,
    lastError: 'Old placeholder.',
  });

  try {
    const staleCreate = Mindcraft.createAgent(settings, {
      resolveServer: () => new Promise((resolve) => {
        releaseServer = () => resolve({ host: '127.0.0.1', port: 25565, version: '1.21.8' });
      }),
      createAgentProcess: () => {
        createdProcesses += 1;
        return new FakeRegisteredAgentProcess();
      },
    });
    const newerPlaceholder = Mindcraft.registerBlockedAgent(settings, {
      name: agentName,
      state: 'blocked',
      running: false,
      retryable: false,
      lastError: 'New placeholder.',
    });

    // When
    releaseServer();
    const staleResult = await staleCreate;
    const currentStart = await Mindcraft.startAgent(agentName);

    // Then
    assert.equal(staleResult.success, false);
    assert.equal(createdProcesses, 0);
    assert.equal(Mindcraft.getAgentProcess(agentName), newerPlaceholder);
    assert.deepEqual(currentStart, { success: false, error: 'New placeholder.' });
  } finally {
    Mindcraft.destroyAgent(agentName);
  }
});

test('Given an ordinary agent whose restart rejects, when it is started, then Mindcraft returns a failure without changing lifecycle state', async () => {
  // Given
  const agentName = 'RestartFailBot';
  const restartError = new Error('SIGINT delivery failed');
  const restartFailedProcess = {
    state: 'failed',
    lastError: restartError.message,
    start: () => Promise.resolve(),
    forceRestart: () => Promise.reject(restartError),
    isActive: () => false,
    stop: () => {},
  };
  const settings = {
    host: '127.0.0.1',
    port: 25565,
    minecraft_version: 'auto',
    profile: { name: agentName },
  };

  try {
    await Mindcraft.createAgent(settings, {
      resolveServer: () => Promise.resolve({ host: '127.0.0.1', port: 25565, version: '1.21.8' }),
      createAgentProcess: () => restartFailedProcess,
    });

    // When
    const result = await Mindcraft.startAgent(agentName);

    // Then
    assert.deepEqual(result, { success: false, error: restartError.message });
    assert.equal(Mindcraft.getAgentProcess(agentName), restartFailedProcess);
    assert.equal(restartFailedProcess.state, 'failed');
    assert.equal(restartFailedProcess.lastError, restartError.message);
  } finally {
    Mindcraft.destroyAgent(agentName);
  }
});

test('Given a failed child startup, when Mindcraft creates the agent, then it reports failure and retains failed lifecycle state', async () => {
  // Given
  const agentName = 'FailedLifeBot';
  const failedProcess = {
    state: 'failed',
    lastError: 'ENOENT: test spawn failure',
    start: () => Promise.reject(new Error('ENOENT: test spawn failure')),
    isActive: () => false,
    stop: () => {},
  };
  const runtime = {
    resolveServer: () => Promise.resolve({ host: '127.0.0.1', port: 25565, version: '1.21.8' }),
    createAgentProcess: () => failedProcess,
  };
  const settings = {
    host: '127.0.0.1',
    port: 25565,
    minecraft_version: 'auto',
    profile: { name: agentName },
  };

  try {
    // When
    const result = await Mindcraft.createAgent(settings, runtime);

    // Then
    assert.equal(result.success, false);
    assert.match(result.error, /ENOENT: test spawn failure/);
    assert.equal(Mindcraft.getAgentProcess(agentName), failedProcess);
    assert.equal(Mindcraft.getAgentProcess(agentName).state, 'failed');
  } finally {
    Mindcraft.destroyAgent(agentName);
  }
});

test('a delayed player-A lookup cannot overwrite the newer authorized player-B observation', async () => {
  const requestA = deferred();
  const requestB = deferred();
  const observed = [];
  const harness = {
    _playerPositionLookup: null,
    _playerPositionLookupGeneration: 0,
    _requestPlayerPosition(name) {
      return name === 'PlayerA' ? requestA.promise : requestB.promise;
    },
    companion_context: {
      observeAuthoritativePosition(name, observation) {
        observed.push({ name, observation });
      },
    },
  };

  const lookupA = Agent.prototype.locatePlayerPosition.call(harness, 'PlayerA');
  const lookupB = Agent.prototype.locatePlayerPosition.call(harness, 'PlayerB');
  requestB.resolve({
    success: true,
    found: true,
    player: 'PlayerB',
    position: { x: 20, y: 70, z: 20 },
    dimension: 'minecraft:overworld',
  });
  await lookupB;
  requestA.resolve({
    success: true,
    found: true,
    player: 'PlayerA',
    position: { x: -20, y: 70, z: -20 },
    dimension: 'minecraft:overworld',
  });
  await lookupA;

  assert.deepEqual(observed.map(entry => entry.name), ['PlayerB']);
  assert.equal(harness._playerPositionLookup, null);
});

test('dashboard commands cannot replace the tracked Minecraft companion', async () => {
  const observed = [];
  const harness = {
    name: 'MindcraftBot',
    checkTaskDone: async () => {},
    companion_context: {
      observeChat(name) {
        observed.push(name);
        return { canonical: name };
      },
    },
    routeResponse: () => {},
  };

  await Agent.prototype.handleMessage.call(harness, 'ADMIN', '!unavailableDashboardCommand', 1);
  await Agent.prototype.handleMessage.call(harness, 'phixxation', '!unavailablePlayerCommand', 1);

  assert.deepEqual(observed, ['phixxation']);
});

test('a held construction request keeps physical Stop until a valid work order exists', async () => {
  const history = [];
  const responses = [];
  const holds = [];
  let released = 0;
  let promptCalls = 0;
  const harness = {
    name: 'MindcraftBot',
    runtime: { role: 'companion' },
    bot: { modes: { flushBehaviorLog: () => '' } },
    shut_up: false,
    operator_hold: true,
    operator_hold_generation: 7,
    checkTaskDone: () => Promise.resolve(),
    dispatchPlayerAgenda: () => Promise.resolve(false),
    isOperatorHeld() { return this.operator_hold; },
    isCurrentOperatorHold(generation) {
      return this.operator_hold && this.operator_hold_generation === generation;
    },
    releaseOperatorHold() {
      released += 1;
      this.operator_hold = false;
    },
    holdPosition(reason) {
      holds.push(reason);
      this.operator_hold = true;
      this.operator_hold_generation += 1;
    },
    routeResponse(_source, message) { responses.push(message); },
    companion_context: { observeChat: () => null },
    self_prompter: {
      interruptForManualCommand: () => {},
      shouldInterrupt: () => false,
      isActive: () => false,
    },
    role_director: { deferForManualCommand: () => {} },
    history: {
      add(name, content) {
        history.push({ name, content });
        return Promise.resolve();
      },
      save: () => {},
      getHistory: () => [],
    },
    prompter: {
      promptConvo() {
        promptCalls += 1;
        return Promise.resolve('The workshop is already registered and underway.');
      },
    },
  };

  const usedCommand = await Agent.prototype.handleMessage.call(
    harness,
    'ADMIN',
    'Build a small functional workshop with a clear entrance, lighting, a crafting table, a furnace, and a chest.',
    1,
  );

  assert.equal(usedCommand, false);
  assert.equal(promptCalls, 1);
  assert.equal(released, 0);
  assert.deepEqual(holds, ['player design request was not compiled']);
  assert.equal(responses.at(-1), 'I did not produce a valid bounded construction command, so no work order was created. I am holding position.');
  assert.equal(history.some(entry => entry.content.includes('already registered and underway')), false);
});
