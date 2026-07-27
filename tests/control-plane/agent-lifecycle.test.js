import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import * as Mindcraft from '../../src/mindcraft/mindcraft.js';
import { AgentProcess } from '../../src/process/agent_process.js';
import './profile-preflight.test.js';

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
  await assert.rejects(startup, /stopped before becoming ready/);
  assert.deepEqual(child.killCalls, ['SIGINT']);
  assert.equal(agentProcess.running, false);
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
  assert.equal(blockedRestartSettled, true);
  await assert.rejects(blockedRestart, /still stopping/);
  assert.equal(factory.calls.length, 1);

  firstChild.emit('exit', null, 'SIGINT');
  const recovery = agentProcess.forceRestart();
  assert.equal(factory.calls.length, 2);
  recoveredChild.emit('spawn');
  await recovery;
  assert.equal(agentProcess.state, 'running');
});

test('Given a failed restart signal delivery, when restart is retried before child exit, then no replacement child is spawned', async () => {
  // Given
  const firstChild = new FakeChildProcess([false, false]);
  const replacementChild = new FakeChildProcess();
  const factory = createChildFactory([firstChild, replacementChild]);
  const agentProcess = new AgentProcess('restart-kill-failure', 8080, factory);
  await startFakeAgent(agentProcess, firstChild);

  // When
  const firstRestart = agentProcess.forceRestart();
  let firstRestartSettled = false;
  firstRestart.then(
    () => { firstRestartSettled = true; },
    () => { firstRestartSettled = true; },
  );
  await Promise.resolve();

  // Then
  assert.equal(firstRestartSettled, true);
  await assert.rejects(firstRestart, /Unable to send SIGINT/);
  assert.equal(agentProcess.process, firstChild);
  assert.equal(agentProcess.isActive(), true);

  const retry = agentProcess.forceRestart();
  let retrySettled = false;
  retry.then(
    () => { retrySettled = true; },
    () => { retrySettled = true; },
  );
  await Promise.resolve();
  assert.equal(retrySettled, true);
  await assert.rejects(retry, /Unable to send SIGINT/);
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

  // Then
  assert.deepEqual(statusReports.map((report) => report.state), ['restarting', 'starting', 'running']);
  assert.match(statusReports[0].lastError, /exited with code 1/);
  assert.equal(statusReports.at(-1).lastError, null);
});

test('Given lifecycle dependencies, when creating an agent, then Mindcraft accepts an injected runtime seam', () => {
  // Then
  assert.equal(Mindcraft.createAgent.length, 2);
});

test('Given an existing live agent, when duplicate creation is requested, then Mindcraft preserves the registered process', async () => {
  // Given
  const agentName = 'duplicate-lifecycle-agent';
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
  const agentName = 'manual-blocked-replacement-agent';
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

test('Given a delayed normal create for an old blocked placeholder, when a newer blocked generation replaces it, then the stale create leaves the newer placeholder current', async () => {
  // Given
  const agentName = 'stale-manual-blocked-replacement-agent';
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
  const agentName = 'restart-failure-agent';
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
  const agentName = 'failed-lifecycle-agent';
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
