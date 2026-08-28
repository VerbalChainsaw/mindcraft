import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import test from 'node:test';
import { io } from 'socket.io-client';

import * as Mindcraft from '../../src/mindcraft/mindcraft.js';
import { createMindServer } from '../../src/mindcraft/mindserver.js';
import { swarm } from '../../src/mindcraft/swarm/swarm.js';
import { AgentProcess } from '../../src/process/agent_process.js';

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
    retryable: false,
    lastError: null,
    connectionToken: 'active-process-capability',
    stopCalls: 0,
    forceRestartCalls: 0,
    handleControlDisconnectCalls: 0,
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
    handleControlDisconnect() {
      this.handleControlDisconnectCalls += 1;
      return Promise.resolve(this);
    },
    markReady() {
      this.state = 'running';
      this.running = true;
      this.retryable = false;
      return true;
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

function connect(url, options = {}) {
  return io(url, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    ...options,
  });
}

function publicLifecycleFields(agent) {
  return {
    retryable: agent.retryable,
    viewerEnabled: agent.viewerEnabled,
    viewerAvailable: agent.viewerAvailable,
    viewerPort: agent.viewerPort,
  };
}

test('Given multiple queued replacements, when the owner exits, then only the latest replacement installs and starts remain pending until finalization', async () => {
  // Given
  const agentName = 'LatestFinalBot';
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
  const agentName = 'DestroyFinalBot';
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
  const agentName = 'StaleFinalBot';
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

test('Given a runtime startup reaches the exact readiness deadline, when it fails, then its owner and public summary remain retryable with a disabled viewer', async () => {
  const agentName = 'TimeoutPublicBot';
  const child = new EventEmitter();
  child.killed = false;
  child.kill = (signal) => {
    child.killed = true;
    queueMicrotask(() => child.emit('exit', null, signal));
    return true;
  };
  const owner = new AgentProcess(agentName, 8080, {
    readyTimeoutMs: 5_000,
    spawnChild: () => {
      setImmediate(() => child.emit('spawn'));
      return child;
    },
    terminateProcessTree: () => ({ success: true }),
  });
  const mindServer = await createMindServer(false, 0);

  try {
    const result = await Mindcraft.createAgent({
      ...settingsFor(agentName),
      render_bot_view: false,
    }, {
      viewerPort: 3900,
      resolveServer: () => Promise.resolve({ host: '127.0.0.1', port: 25565, version: '1.21.8' }),
      createAgentProcess: () => owner,
    });
    const [publicAgent] = await listPublicAgents(mindServer.address().port);

    assert.deepEqual(result, {
      success: false,
      error: `Agent '${agentName}' did not become world-ready within 5 seconds.`,
    });
    assert.equal(owner.state, 'failed');
    assert.equal(owner.retryable, true);
    assert.equal(publicAgent.state, 'failed');
    assert.equal(publicAgent.lastError, result.error);
    assert.deepEqual(publicLifecycleFields(publicAgent), {
      retryable: true,
      viewerEnabled: false,
      viewerAvailable: false,
      viewerPort: null,
    });
  } finally {
    await new Promise((resolve) => setImmediate(resolve));
    Mindcraft.destroyAgent(agentName);
    await closeMindServer(mindServer);
  }
});

test('Given owner settings enable a viewer, when the agent becomes in-game, then REST and agents-status share the same available viewer projection', async () => {
  const agentName = 'ViewerPublicBot';
  const activeProcess = createActiveProcess();
  const mindServer = await createMindServer(false, 0);
  await Mindcraft.createAgent({
    ...settingsFor(agentName),
    render_bot_view: true,
  }, {
    viewerPort: 3901,
    resolveServer: () => Promise.resolve({ host: '127.0.0.1', port: 25565, version: '1.21.8' }),
    createAgentProcess: () => activeProcess,
  });
  const socket = connect(`http://localhost:${mindServer.address().port}`, {
    auth: {
      role: 'agent',
      agentName,
      token: activeProcess.connectionToken,
    },
  });

  try {
    await once(socket, 'connect');
    let statusUpdate = once(socket, 'agents-status');
    socket.emit('connect-agent-process', agentName);
    await statusUpdate;
    statusUpdate = once(socket, 'agents-status');
    socket.emit('login-agent', agentName);
    await statusUpdate;
    statusUpdate = once(socket, 'agents-status');
    const readyResult = new Promise((resolve) => socket.emit('ready-agent', agentName, resolve));
    const [[statusAgents], ready] = await Promise.all([statusUpdate, readyResult]);
    const [restAgent] = await listPublicAgents(mindServer.address().port);
    const statusAgent = statusAgents.find(({ name }) => name === agentName);

    assert.deepEqual(ready, { success: true, error: null });
    assert.deepEqual(statusAgent, restAgent);
    assert.deepEqual(publicLifecycleFields(restAgent), {
      retryable: false,
      viewerEnabled: true,
      viewerAvailable: true,
      viewerPort: 3901,
    });
  } finally {
    socket.disconnect();
    await activeProcess.resolveExit();
    Mindcraft.destroyAgent(agentName);
    await closeMindServer(mindServer);
  }
});

test('Given an authenticated in-game agent, when its control socket disconnects unexpectedly, then MindServer delegates recovery to the lifecycle owner', async () => {
  const agentName = 'DisconnectBot';
  const activeProcess = createActiveProcess();
  const mindServer = await createMindServer(false, 0);
  await createActiveAgent(agentName, activeProcess);
  const socket = connect(`http://localhost:${mindServer.address().port}`, {
    auth: {
      role: 'agent',
      agentName,
      token: activeProcess.connectionToken,
    },
  });

  try {
    await once(socket, 'connect');
    socket.emit('connect-agent-process', agentName);
    socket.emit('login-agent', agentName);
    const ready = await new Promise((resolve) => socket.emit('ready-agent', agentName, resolve));
    assert.deepEqual(ready, { success: true, error: null });

    socket.disconnect();
    const deadline = Date.now() + 1_000;
    while (activeProcess.handleControlDisconnectCalls === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.equal(activeProcess.handleControlDisconnectCalls, 1);
  } finally {
    socket.disconnect();
    await activeProcess.resolveExit();
    Mindcraft.destroyAgent(agentName);
    await closeMindServer(mindServer);
  }
});

test('Given blocked lifecycle owners, when retryability is refused or recomputed, then the public owner value stays authoritative', async () => {
  const fixedName = 'FixedBlockedBot';
  const recheckedName = 'RecheckBlockBot';
  const mindServer = await createMindServer(false, 0);
  Mindcraft.registerBlockedAgent(
    settingsFor(fixedName),
    blockedDescriptor(fixedName, 'Duplicate agent name.', false),
  );
  Mindcraft.registerBlockedAgent(
    {
      ...settingsFor(recheckedName),
      profile: { name: recheckedName, model: 'unsupported/model' },
    },
    blockedDescriptor(recheckedName, 'Readiness must be rechecked.', true),
  );

  try {
    const before = await listPublicAgents(mindServer.address().port);
    assert.equal(before.find(({ name }) => name === fixedName).retryable, false);
    assert.equal(before.find(({ name }) => name === recheckedName).retryable, true);

    assert.deepEqual(await Mindcraft.startAgent(fixedName), {
      success: false,
      error: 'Duplicate agent name.',
    });
    const rechecked = await Mindcraft.startAgent(recheckedName);
    const after = await listPublicAgents(mindServer.address().port);

    assert.equal(rechecked.success, false);
    assert.match(rechecked.error, /unsupported chat model provider/i);
    assert.equal(Mindcraft.getAgentProcess(fixedName).retryable, false);
    assert.equal(Mindcraft.getAgentProcess(recheckedName).retryable, false);
    assert.equal(after.find(({ name }) => name === fixedName).retryable, false);
    assert.equal(after.find(({ name }) => name === recheckedName).retryable, false);
  } finally {
    Mindcraft.destroyAgent(fixedName);
    Mindcraft.destroyAgent(recheckedName);
    await closeMindServer(mindServer);
  }
});
