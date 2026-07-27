import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { io } from 'socket.io-client';

import * as Mindcraft from '../../src/mindcraft/mindcraft.js';
import { createMindServer } from '../../src/mindcraft/mindserver.js';
import { swarm } from '../../src/mindcraft/swarm/swarm.js';
import { describeModelProvider } from '../../src/models/_model_map.js';
import { prepareProfiles } from '../../src/mindcraft/profile-preflight.js';

const DEFAULTS = {
  host: '127.0.0.1',
  port: 25565,
  minecraft_version: 'auto',
  model: 'ollama/default',
};

function preflight(profile, availableKeys = []) {
  return prepareProfiles(
    [{ profile }],
    DEFAULTS,
    { hasKey: (key) => availableKeys.includes(key) },
  );
}

function descriptor(result) {
  return [...result.ready, ...result.blocked][0];
}

class FakeRetryProcess {
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

  stop() {}
}

function createDeferredStartProcess() {
  let resolveStart;
  const started = new Promise((resolve) => {
    resolveStart = resolve;
  });
  let finishStart;
  const startResult = new Promise((resolve) => {
    finishStart = resolve;
  });
  let resolveExit;
  const exitWait = new Promise((resolve) => {
    resolveExit = resolve;
  });
  const process = {
    state: 'idle',
    startCalls: 0,
    stopCalls: 0,
    start() {
      this.startCalls += 1;
      this.state = 'starting';
      resolveStart();
      return startResult;
    },
    stop() {
      this.stopCalls += 1;
      this.state = 'stopped';
      return true;
    },
    isActive() {
      return this.state === 'starting' || this.state === 'running';
    },
    waitForExit() {
      return exitWait;
    },
  };
  return {
    process,
    started,
    resolveStart: () => {
      process.state = 'running';
      finishStart(process);
    },
    resolveExit: () => {
      process.state = 'stopped';
      resolveExit();
    },
  };
}

function createActiveProcess(stopResult) {
  let resolveExit;
  const exitWait = new Promise((resolve) => {
    resolveExit = resolve;
  });
  return {
    state: 'running',
    running: true,
    startCalls: 0,
    stopCalls: 0,
    forceRestartCalls: 0,
    start() {
      this.startCalls += 1;
      return Promise.resolve(this);
    },
    stop() {
      this.stopCalls += 1;
      if (stopResult) {
        this.state = 'stopped';
        this.running = false;
      }
      return stopResult;
    },
    forceRestart() {
      this.forceRestartCalls += 1;
      return Promise.resolve(this);
    },
    isActive() {
      return this.running;
    },
    waitForExit() {
      return exitWait;
    },
    resolveExit() {
      this.running = false;
      this.state = 'stopped';
      resolveExit();
    },
  };
}

test('Given a model profile, when its provider is described, then resolution preserves the input and returns credential alternatives', () => {
  // Given
  const profile = { api: 'azure', model: 'chat-deployment', url: 'https://private.example' };

  // When
  const description = describeModelProvider(profile);

  // Then
  assert.deepEqual(profile, { api: 'azure', model: 'chat-deployment', url: 'https://private.example' });
  assert.deepEqual(description, {
    ok: true,
    provider: 'azure',
    credentialAlternatives: ['AZURE_OPENAI_API_KEY', 'OPENAI_API_KEY'],
  });
});

test('Given an unsupported model profile, when its provider is described, then it returns a structured failure', () => {
  // Given / When
  const description = describeModelProvider('unsupported-model');

  // Then
  assert.deepEqual(description, {
    ok: false,
    provider: null,
    credentialAlternatives: [],
    error: 'Unsupported model provider.',
  });
});

test('Given duplicate trimmed names, when profiles are prepared, then all duplicate profiles are blocked before launch', () => {
  // Given
  const profiles = [
    { profile: { name: '  duplicate  ', model: 'ollama/a' } },
    { profile: { name: 'duplicate', model: 'ollama/b' } },
  ];

  // When
  const result = prepareProfiles(profiles, DEFAULTS, { hasKey: () => false });

  // Then
  assert.equal(result.ready.length, 0);
  assert.deepEqual(result.blocked.map((entry) => entry.name), ['duplicate', 'duplicate']);
  assert.ok(result.blocked.every((entry) => entry.state === 'blocked' && entry.running === false));
  assert.ok(result.blocked.every((entry) => /Duplicate agent name/.test(entry.lastError)));
});

test('Given a malformed selected profile, when profiles are prepared, then it has a sanitized blocked descriptor', () => {
  // Given / When
  const result = prepareProfiles([{ loadError: 'profile JSON failed to parse' }], DEFAULTS, { hasKey: () => false });

  // Then
  assert.deepEqual(result.ready, []);
  assert.deepEqual(result.blocked, [{
    index: 0,
    name: 'profile-1',
    state: 'blocked',
    running: false,
    lastError: 'Malformed selected profile.',
    retryable: false,
  }]);
});

test('Given an OpenAI profile without its credential, when profiles are prepared, then it is blocked without exposing profile settings', () => {
  // Given / When
  const result = preflight({ name: 'openai-agent', model: 'gpt-4o' });
  const blocked = descriptor(result);

  // Then
  assert.equal(blocked.state, 'blocked');
  assert.equal(blocked.running, false);
  assert.match(blocked.lastError, /Missing credential for chat model provider "openai"/);
  assert.deepEqual(Object.keys(blocked).sort(), ['index', 'lastError', 'name', 'retryable', 'running', 'state']);
});

test('Given local model providers, when profiles are prepared without keys, then they are ready', () => {
  // Given / When / Then
  for (const provider of ['ollama', 'lmstudio', 'vllm']) {
    const result = preflight({ name: provider, model: { api: provider, model: 'model' } });
    assert.equal(descriptor(result).state, 'ready');
  }
});

test('Given an Azure profile with only an OpenAI key, when profiles are prepared, then the Azure credential fallback is ready', () => {
  // Given / When
  const result = preflight(
    { name: 'azure-agent', model: { api: 'azure', model: 'deployment' } },
    ['OPENAI_API_KEY'],
  );

  // Then
  assert.equal(descriptor(result).state, 'ready');
});

test('Given every installed model adapter, when its provider is described, then its current credential alternatives are complete', () => {
  // Given
  const cases = [
    ['anthropic', ['ANTHROPIC_API_KEY']],
    ['azure', ['AZURE_OPENAI_API_KEY', 'OPENAI_API_KEY']],
    ['cerebras', ['CEREBRAS_API_KEY']],
    ['deepseek', ['DEEPSEEK_API_KEY']],
    ['glhf', ['GHLF_API_KEY']],
    ['google', ['GEMINI_API_KEY']],
    ['groq', ['GROQCLOUD_API_KEY']],
    ['huggingface', ['HUGGINGFACE_API_KEY']],
    ['hyperbolic', ['HYPERBOLIC_API_KEY']],
    ['lmstudio', []],
    ['mercury', ['MERCURY_API_KEY']],
    ['mistral', ['MISTRAL_API_KEY']],
    ['novita', ['NOVITA_API_KEY']],
    ['ollama', []],
    ['openai', ['OPENAI_API_KEY']],
    ['openrouter', ['OPENROUTER_API_KEY']],
    ['qwen', ['QWEN_API_KEY']],
    ['replicate', ['REPLICATE_API_KEY']],
    ['openai_compatible', ['OPENAI_COMPATIBLE_API_KEY']],
    ['vllm', []],
    ['xai', ['XAI_API_KEY']],
  ];

  // When / Then
  for (const [provider, credentialAlternatives] of cases) {
    const modelProfile = provider === 'openai_compatible'
      ? { api: provider, model: 'model', url: 'https://provider.example/v1' }
      : { api: provider, model: 'model' };
    assert.deepEqual(
      describeModelProvider(modelProfile),
      { ok: true, provider, credentialAlternatives },
    );
  }
});

test('Given compatible-provider profiles with distinct key envs, when providers are described, then each returns only its advertised credential', () => {
  // Given
  const cases = [
    ['NVIDIA_API_KEY', 'nvidia/model'],
    ['TOGETHER_API_KEY', 'together/model'],
    ['FIREWORKS_API_KEY', 'fireworks/model'],
    ['DEEPINFRA_API_KEY', 'deepinfra/model'],
  ];

  // When / Then
  for (const [apiKeyEnv, model] of cases) {
    assert.deepEqual(
      describeModelProvider({
        api: 'openai_compatible',
        model,
        url: 'https://provider.example/v1',
        params: { api_key_env: apiKeyEnv },
      }),
      {
        ok: true,
        provider: 'openai_compatible',
        credentialAlternatives: [apiKeyEnv],
      },
    );
  }
});

test('Given an invalid compatible-provider key env, when it is described, then the failure is sanitized', () => {
  // Given
  const invalidKeyEnv = 'secret-value-that-must-not-appear';

  // When
  const description = describeModelProvider({
    api: 'openai_compatible',
    model: 'provider/model',
    url: 'https://provider.example/v1',
    params: { api_key_env: invalidKeyEnv },
  });

  // Then
  assert.deepEqual(description, {
    ok: false,
    provider: 'openai_compatible',
    credentialAlternatives: [],
    error: 'Invalid openai_compatible api_key_env.',
  });
  assert.doesNotMatch(JSON.stringify(description), new RegExp(invalidKeyEnv));
});

test('Given explicit code, vision, or embedding models without their credentials, when profiles are prepared, then each requirement blocks startup', () => {
  // Given
  const cases = [
    ['code_model', 'openai/gpt-4o', 'code model'],
    ['vision_model', 'anthropic/claude-vision', 'vision model'],
    ['embedding', 'openai/text-embedding-3-small', 'embedding model'],
  ];

  // When / Then
  for (const [field, model, label] of cases) {
    const result = preflight({ name: `${field}-agent`, model: 'ollama/local', [field]: model });
    assert.match(descriptor(result).lastError, new RegExp(`Missing credential for ${label} provider`));
  }
});

test('Given a malformed explicit embedding model, when profiles are prepared, then it falls back to the chat provider as Prompter does', () => {
  // Given / When
  const result = preflight({ name: 'embedding-fallback', model: 'ollama/local', embedding: 'unsupported-model' });

  // Then
  assert.equal(descriptor(result).state, 'ready');
});

test('Given a blocked profile, when start is requested before a key is available, then no Minecraft lookup or child spawn occurs', async () => {
  // Given
  const settings = { ...DEFAULTS, profile: { name: 'blocked-agent', model: 'openai/gpt-4o' } };
  const blocked = descriptor(preflight(settings.profile));
  let minecraftLookups = 0;
  let childStarts = 0;
  Mindcraft.registerBlockedAgent(settings, blocked, {
    hasKey: () => false,
    resolveServer: () => {
      minecraftLookups += 1;
      throw new Error('Minecraft lookup must not run');
    },
    createAgentProcess: () => {
      childStarts += 1;
      throw new Error('Child spawn must not run');
    },
  });

  try {
    // When
    const result = await Mindcraft.startAgent('blocked-agent');

    // Then
    assert.equal(result.success, false);
    assert.equal(minecraftLookups, 0);
    assert.equal(childStarts, 0);
    assert.equal(Mindcraft.getAgentProcess('blocked-agent').state, 'blocked');
    assert.equal(Mindcraft.getAgentProcess('blocked-agent').running, false);
  } finally {
    Mindcraft.destroyAgent('blocked-agent');
  }
});

test('Given a blocked profile and a hot-added key, when start is retried, then readiness is reevaluated before normal startup', async () => {
  // Given
  const settings = { ...DEFAULTS, profile: { name: 'retry-agent', model: 'openai/gpt-4o' } };
  const blocked = descriptor(preflight(settings.profile));
  let keyAvailable = false;
  let minecraftLookups = 0;
  const retryProcess = new FakeRetryProcess();
  const runtime = {
    hasKey: (key) => keyAvailable && key === 'OPENAI_API_KEY',
    resolveServer: () => {
      minecraftLookups += 1;
      return Promise.resolve({ host: '127.0.0.1', port: 25565, version: '1.21.8' });
    },
    createAgentProcess: () => retryProcess,
  };
  Mindcraft.registerBlockedAgent(settings, blocked, runtime);

  try {
    // When
    keyAvailable = true;
    const result = await Mindcraft.startAgent('retry-agent');

    // Then
    assert.equal(result.success, true);
    assert.equal(minecraftLookups, 1);
    assert.equal(retryProcess.startCalls, 1);
    assert.equal(Mindcraft.getAgentProcess('retry-agent').state, 'running');
  } finally {
    Mindcraft.destroyAgent('retry-agent');
  }
});

test('Given a blocked profile with private settings, when public settings are requested, then only its name is exposed while retry retains the private settings', async () => {
  // Given
  const agentName = 'private-blocked-agent';
  const settings = {
    ...DEFAULTS,
    profile: {
      name: agentName,
      model: 'openai/gpt-4o',
      url: 'https://private-provider.example/v1',
      params: { privateSetting: 'must-not-be-public' },
    },
  };
  const blocked = descriptor(preflight(settings.profile));
  const retryProcess = new FakeRetryProcess();
  let keyAvailable = false;
  let resolveServerCalls = 0;
  const mindServer = await createMindServer(false, 0);
  const socket = io(`http://localhost:${mindServer.address().port}`, {
    forceNew: true,
    transports: ['websocket'],
  });
  const runtime = {
    hasKey: (key) => keyAvailable && key === 'OPENAI_API_KEY',
    resolveServer: () => {
      resolveServerCalls += 1;
      return Promise.resolve({ host: '127.0.0.1', port: 25565, version: '1.21.8' });
    },
    createAgentProcess: () => retryProcess,
  };

  try {
    await once(socket, 'connect');
    Mindcraft.registerBlockedAgent(settings, blocked, runtime);

    // When
    const publicSettings = await new Promise((resolve) => {
      socket.emit('get-settings', agentName, resolve);
    });

    // Then
    assert.deepEqual(publicSettings, { settings: { profile: { name: agentName } } });

    const blockedAttempt = await Mindcraft.startAgent(agentName);
    assert.equal(blockedAttempt.success, false);
    assert.equal(resolveServerCalls, 0);
    assert.equal(retryProcess.startCalls, 0);

    keyAvailable = true;
    const retry = await Mindcraft.startAgent(agentName);
    assert.equal(retry.success, true);
    assert.equal(resolveServerCalls, 1);
    assert.equal(retryProcess.startCalls, 1);
  } finally {
    Mindcraft.destroyAgent(agentName);
    socket.disconnect();
    await new Promise((resolve, reject) => {
      mindServer.close((error) => (error ? reject(error) : resolve()));
    });
    swarm.stop();
  }
});

test('Given a queued stale blocked retry, when a newer generation is registered, then stale completion preserves the new record for a later start', async () => {
  // Given
  const agentName = 'cancelled-retry-agent';
  const settings = { ...DEFAULTS, profile: { name: agentName, model: 'openai/gpt-4o' } };
  const blocked = descriptor(preflight(settings.profile));
  let staleChildStarts = 0;
  let laterChildStarts = 0;
  let forceRestartCalls = 0;
  const retryProcess = new FakeRetryProcess();
  Mindcraft.registerBlockedAgent(settings, blocked, {
    hasKey: (key) => key === 'OPENAI_API_KEY',
    resolveServer: () => Promise.resolve({ host: '127.0.0.1', port: 25565, version: '1.21.8' }),
    createAgentProcess: () => {
      staleChildStarts += 1;
      return retryProcess;
    },
  });

  try {
    // When
    const staleRetry = Mindcraft.startAgent(agentName);
    Mindcraft.destroyAgent(agentName);

    const newerBlockedProcess = Mindcraft.registerBlockedAgent(settings, blocked, {
      hasKey: (key) => key === 'OPENAI_API_KEY',
      resolveServer: () => Promise.resolve({ host: '127.0.0.1', port: 25565, version: '1.21.8' }),
      createAgentProcess: () => {
        laterChildStarts += 1;
        return retryProcess;
      },
    });
    newerBlockedProcess.forceRestart = () => {
      forceRestartCalls += 1;
      return Promise.resolve();
    };
    // Then
    assert.deepEqual(await staleRetry, {
      success: false,
      cancelled: true,
      error: `Agent '${agentName}' startup cancelled`,
    });
    const laterResult = await Mindcraft.startAgent(agentName);
    assert.equal(laterResult.success, true);
    assert.equal(staleChildStarts, 0);
    assert.equal(laterChildStarts, 1);
    assert.equal(forceRestartCalls, 0);
    assert.equal(Mindcraft.getAgentProcess(agentName), retryProcess);
  } finally {
    Mindcraft.destroyAgent(agentName);
  }
});

test('Given a stale blocked child startup, when a newer generation replaces it, then stale completion stops only the old process without altering the replacement', async () => {
  // Given
  const agentName = 'stale-start-owner-agent';
  const settings = { ...DEFAULTS, profile: { name: agentName, model: 'openai/gpt-4o' } };
  const blocked = descriptor(preflight(settings.profile));
  const oldStart = createDeferredStartProcess();
  Mindcraft.registerBlockedAgent(settings, blocked, {
    hasKey: (key) => key === 'OPENAI_API_KEY',
    resolveServer: () => Promise.resolve({ host: '127.0.0.1', port: 25565, version: '1.21.8' }),
    createAgentProcess: () => oldStart.process,
  });

  try {
    const staleRetry = Mindcraft.startAgent(agentName);
    await oldStart.started;

    // When
    const pendingReplacement = Mindcraft.registerBlockedAgent(settings, blocked, {
      hasKey: (key) => key === 'OPENAI_API_KEY',
      resolveServer: () => Promise.resolve({ host: '127.0.0.1', port: 25565, version: '1.21.8' }),
      createAgentProcess: () => {
        throw new Error('Replacement must not start in this test');
      },
    });
    oldStart.resolveStart();
    const staleResult = await staleRetry;
    oldStart.resolveExit();
    await Promise.resolve();
    const currentPlaceholder = Mindcraft.getAgentProcess(agentName);

    // Then
    assert.deepEqual(staleResult, {
      success: false,
      cancelled: true,
      error: `Agent '${agentName}' startup cancelled`,
    });
    assert.equal(pendingReplacement.pending, true);
    assert.equal(oldStart.process.stopCalls, 2);
    assert.equal(oldStart.process.isActive(), false);
    assert.equal(Mindcraft.getAgentProcess(agentName), currentPlaceholder);

    const oldStopCalls = oldStart.process.stopCalls;
    Mindcraft.destroyAgent(agentName);
    assert.equal(oldStart.process.stopCalls, oldStopCalls);
    assert.equal(Mindcraft.getAgentProcess(agentName), undefined);
  } finally {
    Mindcraft.destroyAgent(agentName);
  }
});

test('Given a current blocked generation, when its child startup completes, then it remains the active process', async () => {
  // Given
  const agentName = 'current-start-owner-agent';
  const settings = { ...DEFAULTS, profile: { name: agentName, model: 'openai/gpt-4o' } };
  const blocked = descriptor(preflight(settings.profile));
  const currentProcess = new FakeRetryProcess();
  Mindcraft.registerBlockedAgent(settings, blocked, {
    hasKey: (key) => key === 'OPENAI_API_KEY',
    resolveServer: () => Promise.resolve({ host: '127.0.0.1', port: 25565, version: '1.21.8' }),
    createAgentProcess: () => currentProcess,
  });

  try {
    // When
    const result = await Mindcraft.startAgent(agentName);

    // Then
    assert.equal(result.success, true);
    assert.equal(currentProcess.startCalls, 1);
    assert.equal(Mindcraft.getAgentProcess(agentName), currentProcess);
  } finally {
    Mindcraft.destroyAgent(agentName);
  }
});

test('Given an active agent whose stop is unconfirmed, when blocked replacement is requested, then existing ownership is retained and start reports the replacement failure', async () => {
  // Given
  const agentName = 'failed-stop-replacement-agent';
  const settings = { ...DEFAULTS, profile: { name: agentName, model: 'openai/gpt-4o' } };
  const blocked = descriptor(preflight(settings.profile));
  const activeProcess = createActiveProcess(false);
  let replacementChildStarts = 0;
  await Mindcraft.createAgent(settings, {
    resolveServer: () => Promise.resolve({ host: '127.0.0.1', port: 25565, version: '1.21.8' }),
    createAgentProcess: () => activeProcess,
  });

  try {
    // When
    const registration = Mindcraft.registerBlockedAgent(settings, blocked, {
      hasKey: (key) => key === 'OPENAI_API_KEY',
      resolveServer: () => Promise.resolve({ host: '127.0.0.1', port: 25565, version: '1.21.8' }),
      createAgentProcess: () => {
        replacementChildStarts += 1;
        return new FakeRetryProcess();
      },
    });
    const startResult = await Mindcraft.startAgent(agentName);

    // Then
    assert.equal(registration.success, false);
    assert.equal(registration.pending, true);
    assert.match(registration.error, /finalization is pending/i);
    assert.equal(activeProcess.stopCalls, 1);
    assert.equal(Mindcraft.getAgentProcess(agentName), activeProcess);
    assert.equal(startResult.success, false);
    assert.match(startResult.error, /finalization is pending/i);
    assert.equal(activeProcess.forceRestartCalls, 0);
    assert.equal(replacementChildStarts, 0);

    const destroyResult = Mindcraft.destroyAgent(agentName);
    assert.equal(destroyResult.pending, true);
    assert.equal(activeProcess.stopCalls, 1);
    assert.equal(Mindcraft.getAgentProcess(agentName), activeProcess);
    activeProcess.resolveExit();
    await Promise.resolve();
    assert.equal(Mindcraft.getAgentProcess(agentName), undefined);
  } finally {
    Mindcraft.destroyAgent(agentName);
  }
});

test('Given an active agent whose stop is confirmed, when blocked replacement is requested, then the replacement installs and starts normally', async () => {
  // Given
  const agentName = 'confirmed-stop-replacement-agent';
  const settings = { ...DEFAULTS, profile: { name: agentName, model: 'openai/gpt-4o' } };
  const blocked = descriptor(preflight(settings.profile));
  const activeProcess = createActiveProcess(true);
  const replacementProcess = new FakeRetryProcess();
  await Mindcraft.createAgent(settings, {
    resolveServer: () => Promise.resolve({ host: '127.0.0.1', port: 25565, version: '1.21.8' }),
    createAgentProcess: () => activeProcess,
  });

  try {
    // When
    const pendingReplacement = Mindcraft.registerBlockedAgent(settings, blocked, {
      hasKey: (key) => key === 'OPENAI_API_KEY',
      resolveServer: () => Promise.resolve({ host: '127.0.0.1', port: 25565, version: '1.21.8' }),
      createAgentProcess: () => replacementProcess,
    });
    assert.equal(pendingReplacement.pending, true);
    assert.equal(Mindcraft.getAgentProcess(agentName), activeProcess);
    activeProcess.resolveExit();
    await Promise.resolve();
    const placeholder = Mindcraft.getAgentProcess(agentName);
    const startResult = await Mindcraft.startAgent(agentName);

    // Then
    assert.equal(activeProcess.stopCalls, 1);
    assert.notEqual(placeholder, activeProcess);
    assert.equal(startResult.success, true);
    assert.equal(replacementProcess.startCalls, 1);
    assert.equal(Mindcraft.getAgentProcess(agentName), replacementProcess);
  } finally {
    Mindcraft.destroyAgent(agentName);
  }
});

test('Given concurrent retries for a newly-ready blocked profile, when startup is pending, then both callers share one normal startup', async () => {
  // Given
  const settings = { ...DEFAULTS, profile: { name: 'concurrent-retry-agent', model: 'openai/gpt-4o' } };
  const blocked = descriptor(preflight(settings.profile));
  const retryProcess = new FakeRetryProcess();
  let releaseServer;
  let resolveServerCalls = 0;
  const runtime = {
    hasKey: (key) => key === 'OPENAI_API_KEY',
    resolveServer: () => {
      resolveServerCalls += 1;
      return new Promise((resolve) => {
        releaseServer = () => resolve({ host: '127.0.0.1', port: 25565, version: '1.21.8' });
      });
    },
    createAgentProcess: () => retryProcess,
  };
  Mindcraft.registerBlockedAgent(settings, blocked, runtime);

  try {
    // When
    const firstStart = Mindcraft.startAgent('concurrent-retry-agent');
    const secondStart = Mindcraft.startAgent('concurrent-retry-agent');

    // Then
    assert.equal(
      await Promise.race([secondStart, Promise.resolve('pending')]),
      'pending',
      'a concurrent retry must wait for the in-flight startup instead of reporting not found',
    );
    assert.equal(resolveServerCalls, 1);

    releaseServer();
    const [firstResult, secondResult] = await Promise.all([firstStart, secondStart]);
    assert.equal(firstResult.success, true);
    assert.equal(secondResult.success, true);
    assert.equal(retryProcess.startCalls, 1);
  } finally {
    Mindcraft.destroyAgent('concurrent-retry-agent');
  }
});
