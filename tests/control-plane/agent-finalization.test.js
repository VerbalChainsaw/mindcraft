import assert from 'node:assert/strict';
import test from 'node:test';

import * as Mindcraft from '../../src/mindcraft/mindcraft.js';
import { createMindServer } from '../../src/mindcraft/mindserver.js';
import { swarm } from '../../src/mindcraft/swarm/swarm.js';

function settingsFor(agentName) {
  return {
    host: '127.0.0.1',
    port: 25565,
    minecraft_version: 'auto',
    profile: { name: agentName, model: 'openai/gpt-4o' },
  };
}

function blockedDescriptor(agentName, lastError, retryable = false) {
  return {
    name: agentName,
    state: 'blocked',
    running: false,
    retryable,
    lastError,
  };
}

function createActiveProcess() {
  let resolveExit;
  const exitWait = new Promise((resolve) => {
    resolveExit = resolve;
  });
  return {
    state: 'running',
    running: true,
    lastError: null,
    stopCalls: 0,
    forceRestartCalls: 0,
    start() {
      return Promise.resolve(this);
    },
    isActive() {
      return this.running;
    },
    stop() {
      this.stopCalls += 1;
      this.state = 'stopping';
      return true;
    },
    forceRestart() {
      this.forceRestartCalls += 1;
      return Promise.resolve(this);
    },
    waitForExit() {
      return exitWait;
    },
    resolveExit() {
      this.running = false;
      this.state = 'stopped';
      resolveExit();
      return exitWait;
    },
  };
}

function createDeferredStartProcess() {
  let resolveStart;
  let signalStarted;
  let resolveExit;
  const started = new Promise((resolve) => {
    signalStarted = resolve;
  });
  const startWait = new Promise((resolve) => {
    resolveStart = resolve;
  });
  const exitWait = new Promise((resolve) => {
    resolveExit = resolve;
  });
  const process = {
    state: 'idle',
    running: false,
    lastError: null,
    stopCalls: 0,
    start() {
      this.state = 'starting';
      this.running = true;
      signalStarted();
      return startWait;
    },
    isActive() {
      return this.running;
    },
    stop() {
      this.stopCalls += 1;
      this.state = 'stopping';
      return true;
    },
    waitForExit() {
      return exitWait;
    },
  };
  return {
    process,
    started,
    resolveStart() {
      process.state = 'running';
      resolveStart(process);
    },
    resolveExit() {
      process.running = false;
      process.state = 'stopped';
      resolveExit();
      return exitWait;
    },
  };
}

async function createActiveAgent(agentName, activeProcess) {
  const result = await Mindcraft.createAgent(settingsFor(agentName), {
    resolveServer: () => Promise.resolve({ host: '127.0.0.1', port: 25565, version: '1.21.8' }),
    createAgentProcess: () => activeProcess,
  });
  assert.deepEqual(result, { success: true, error: null });
}

async function listPublicAgents(port) {
  const response = await fetch(`http://localhost:${port}/api/agents`);
  assert.equal(response.ok, true);
  return (await response.json()).agents;
}

async function closeMindServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  swarm.stop();
}

test('Given multiple queued replacements, when the owner exits, then only the latest replacement installs and starts remain pending until finalization', async () => {
  // Given
  const agentName = 'latest-finalization-agent';
  const activeProcess = createActiveProcess();
  await createActiveAgent(agentName, activeProcess);
  const first = Mindcraft.registerBlockedAgent(
    settingsFor(agentName),
    blockedDescriptor(agentName, 'first replacement'),
  );
  const second = Mindcraft.registerBlockedAgent(
    settingsFor(agentName),
    { ...blockedDescriptor(agentName, 'latest replacement'), index: 0 },
  );

  try {
    // When
    const startResult = await Mindcraft.startAgent(agentName);
    await activeProcess.resolveExit();

    // Then
    assert.equal(first.pending, true);
    assert.equal(second.pending, true);
    assert.deepEqual(startResult, {
      success: false,
      pending: true,
      retryable: true,
      error: `Agent '${agentName}' finalization is pending.`,
    });
    assert.equal(activeProcess.stopCalls, 1);
    assert.equal(activeProcess.forceRestartCalls, 0);
    assert.equal(Mindcraft.getAgentProcess(agentName).state, 'blocked');
    assert.equal(Mindcraft.getAgentProcess(agentName).lastError, 'latest replacement');
    assert.deepEqual(
      Mindcraft.getSelectedProfileReadiness(() => false).map(({ name, state, reason }) => ({ name, state, reason })),
      [{ name: agentName, state: 'blocked', reason: 'latest replacement' }],
    );
  } finally {
    Mindcraft.destroyAgent(agentName);
  }
});

test('Given a queued replacement, when destruction supersedes it before exit, then public ownership is removed only after the original owner exits', async () => {
  // Given
  const agentName = 'destroy-finalization-agent';
  const activeProcess = createActiveProcess();
  const mindServer = await createMindServer(false, 0);
  await createActiveAgent(agentName, activeProcess);
  Mindcraft.registerBlockedAgent(
    settingsFor(agentName),
    blockedDescriptor(agentName, 'replacement must be discarded'),
  );

  try {
    // When
    const destroyResult = Mindcraft.destroyAgent(agentName);
    const beforeExit = await listPublicAgents(mindServer.address().port);
    await activeProcess.resolveExit();
    const afterExit = await listPublicAgents(mindServer.address().port);

    // Then
    assert.deepEqual(destroyResult, {
      success: false,
      pending: true,
      retryable: true,
      error: `Agent '${agentName}' finalization is pending.`,
    });
    assert.equal(activeProcess.stopCalls, 1);
    assert.deepEqual(beforeExit.map((agent) => agent.name), [agentName]);
    assert.equal(Mindcraft.getAgentProcess(agentName), undefined);
    assert.deepEqual(afterExit, []);
  } finally {
    await activeProcess.resolveExit();
    Mindcraft.destroyAgent(agentName);
    await closeMindServer(mindServer);
  }
});

test('Given a stale startup, when a replacement is queued before it completes, then the stale completion preserves public ownership until its owner exits', async () => {
  // Given
  const agentName = 'stale-finalization-agent';
  const deferred = createDeferredStartProcess();
  const mindServer = await createMindServer(false, 0);
  Mindcraft.registerBlockedAgent(
    settingsFor(agentName),
    blockedDescriptor(agentName, 'initial blocked record', true),
    {
      hasKey: (key) => key === 'OPENAI_API_KEY',
      resolveServer: () => Promise.resolve({ host: '127.0.0.1', port: 25565, version: '1.21.8' }),
      createAgentProcess: () => deferred.process,
    },
  );
  const staleStart = Mindcraft.startAgent(agentName);
  await deferred.started;
  const replacement = Mindcraft.registerBlockedAgent(
    settingsFor(agentName),
    blockedDescriptor(agentName, 'replacement after stale startup'),
  );

  try {
    // When
    deferred.resolveStart();
    const staleResult = await staleStart;
    const beforeExit = await listPublicAgents(mindServer.address().port);
    await deferred.resolveExit();
    const afterExit = await listPublicAgents(mindServer.address().port);

    // Then
    assert.equal(replacement.pending, true);
    assert.deepEqual(staleResult, {
      success: false,
      cancelled: true,
      error: `Agent '${agentName}' startup cancelled`,
    });
    assert.equal(deferred.process.stopCalls, 2);
    assert.deepEqual(beforeExit.map((agent) => agent.name), [agentName]);
    assert.deepEqual(afterExit.map((agent) => agent.name), [agentName]);
    assert.equal(Mindcraft.getAgentProcess(agentName).state, 'blocked');
    assert.equal(Mindcraft.getAgentProcess(agentName).lastError, 'replacement after stale startup');
  } finally {
    deferred.resolveStart();
    await deferred.resolveExit();
    await staleStart.catch(() => {});
    Mindcraft.destroyAgent(agentName);
    await closeMindServer(mindServer);
  }
});
