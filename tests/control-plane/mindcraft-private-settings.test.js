import assert from 'node:assert/strict';
import test from 'node:test';

import * as Mindcraft from '../../src/mindcraft/mindcraft.js';

test('Given a configured bot template, when the server-owned squad manager requests it, then a defensive private settings copy is returned', () => {
  const agentName = 'SquadTemplate';
  const settings = {
    profile: {
      name: agentName,
      model: 'ollama/qwen2.5:3b',
    },
    host: '127.0.0.1',
    port: 25578,
    load_memory: false,
  };
  Mindcraft.registerConfiguredAgent(settings, {
    name: agentName,
    index: 998,
  });

  try {
    const first = Mindcraft.getAgentSettings(agentName);
    assert.deepEqual(first, settings);
    first.profile.name = 'Mutated';
    assert.equal(Mindcraft.getAgentSettings(agentName).profile.name, agentName);
    assert.equal(Mindcraft.getAgentSettings('MissingTemplate'), null);
  } finally {
    Mindcraft.destroyAgent(agentName);
  }
});

test('Given settings change while replacement is pending, when the old process exits, then the replacement keeps the latest settings', async () => {
  const agentName = 'PendingSettings';
  let resolveExit;
  const exited = new Promise((resolve) => { resolveExit = resolve; });
  const fakeProcess = {
    state: 'stopped',
    running: false,
    start() {
      this.state = 'running';
      this.running = true;
      return Promise.resolve();
    },
    stop() {
      this.state = 'stopping';
      this.running = false;
      return true;
    },
    isActive() {
      return this.running;
    },
    waitForExit: () => exited,
  };
  const initial = {
    profile: { name: agentName, model: 'ollama/local' },
    host: '127.0.0.1',
    port: 25565,
    minecraft_version: 'auto',
  };
  const replacement = { ...initial, port: 25578 };
  const latest = { ...initial, port: 25579 };

  await Mindcraft.createAgent(initial, {
    resolveServer: (host, port) => ({ host, port, version: '1.21.11' }),
    createAgentProcess: () => fakeProcess,
  });
  const queued = Mindcraft.registerConfiguredAgent(replacement, {
    name: agentName,
    state: 'ready',
    running: false,
    retryable: true,
    lastError: null,
  });

  try {
    assert.equal(queued.pending, true);
    Mindcraft.setAgentSettings(agentName, latest);
    resolveExit();
    await exited;
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(Mindcraft.getAgentSettings(agentName).port, 25579);
  } finally {
    resolveExit();
    fakeProcess.stop();
    await new Promise((resolve) => setImmediate(resolve));
    Mindcraft.destroyAgent(agentName);
  }
});
