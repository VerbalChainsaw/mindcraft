import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

import * as Mindcraft from '../../src/mindcraft/mindcraft.js';
import { createMindServer } from '../../src/mindcraft/mindserver.js';
import { swarm } from '../../src/mindcraft/swarm/swarm.js';
import {
  canStartAgent,
  isCredentialReason,
} from '../../src/mindcraft/public/js/utils.js';

function requestSocket(socket, event, ...args) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${event} response.`));
    }, 1000);
    socket.emit(event, ...args, (response) => {
      clearTimeout(timeout);
      resolve(response);
    });
  });
}

async function closeMindServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  swarm.stop();
}

test('Given a non-retryable blocked agent, when the dashboard requests startup, then it receives the sanitized lifecycle failure', async () => {
  // Given
  const agentName = 'DashboardBot';
  const server = await createMindServer(false, 0);
  const socket = io(`http://localhost:${server.address().port}`, {
    forceNew: true,
    transports: ['websocket'],
  });
  Mindcraft.registerBlockedAgent({
    profile: {
      name: agentName,
      model: 'ollama/local',
      url: 'https://private.example/v1',
      params: { apiKey: 'must-not-leak' },
    },
  }, {
    name: agentName,
    state: 'blocked',
    running: false,
    retryable: false,
    lastError: 'Duplicate agent name.',
  });

  try {
    await once(socket, 'connect');

    // When
    const response = await requestSocket(socket, 'start-agent', agentName);

    // Then
    assert.deepEqual(response, { success: false, error: 'Duplicate agent name.' });
    assert.doesNotMatch(JSON.stringify(response), /private|must-not-leak|url|apiKey/i);
  } finally {
    Mindcraft.destroyAgent(agentName);
    socket.disconnect();
    await closeMindServer(server);
  }
});

test('Given invalid registered settings, when managed-target reconciliation rejects Start, then the dashboard receives a bounded failure', async () => {
  const agentName = 'InvalidStartBot';
  const managedMinecraftServer = {
    getStatus: () => ({
      phase: 'running',
      installed: true,
      host: '127.0.0.1',
      port: 25579,
    }),
  };
  const server = await createMindServer(false, 0, 1, { managedMinecraftServer });
  const socket = io(`http://localhost:${server.address().port}`, {
    forceNew: true,
    transports: ['websocket'],
  });
  Mindcraft.registerConfiguredAgent({
    profile: { name: agentName, model: 'ollama/local' },
    host: '127.0.0.1',
    port: 25565,
    load_memory: 'not-a-boolean',
  }, {
    name: agentName,
    state: 'ready',
    running: false,
    retryable: true,
    lastError: null,
  });

  try {
    await once(socket, 'connect');
    const response = await requestSocket(socket, 'start-agent', agentName);

    assert.equal(response.success, false);
    assert.equal(response.error, "Setting 'load_memory' must be true or false.");
  } finally {
    Mindcraft.destroyAgent(agentName);
    socket.disconnect();
    await closeMindServer(server);
  }
});

test('Given the dashboard source, when lifecycle cards are rendered, then blocked and failed agents have explicit recovery wiring', async () => {
  const agentsPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../src/mindcraft/public/js/agents.js',
  );
  const agents = await readFile(agentsPath, 'utf8');

  assert.match(agents, /canStartAgent/);
  assert.match(agents, /state==='failed'\?'Retry Start':'Start'/);
  assert.match(agents, /socketRequest\(this\.socket,'start-agent',\[name\],AGENT_START_TIMEOUT_MS\)/);
  assert.match(agents, /socketRequest\(this\.socket,'stop-agent',\[name\],AGENT_STOP_TIMEOUT_MS\)/);
  assert.match(agents, /socketRequest\(this\.socket,'restart-agent',\[name\],AGENT_RESTART_TIMEOUT_MS\)/);
  assert.match(agents, /if\(\['blocked','failed'\]\.includes\(state\)&&typeof agent\?\.retryable==='boolean'\)return agent\.retryable/);
  assert.match(agents, /did not become world-ready within \\d\+ seconds/);
});

test('Given public recovery fields, when the dashboard renders controls, then viewer, squad, and provider state follow explicit backend truth', async () => {
  const publicJs = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../src/mindcraft/public/js',
  );
  const [agents, profiles] = await Promise.all([
    readFile(path.join(publicJs, 'agents.js'), 'utf8'),
    readFile(path.join(publicJs, 'profiles.js'), 'utf8'),
  ]);

  assert.match(agents, /agent\.viewerAvailable===true&&Number\.isInteger\(port\)&&port>0&&port<65536/);
  assert.match(agents, /if\(\['stopped','failed'\]\.includes\(squad\.state\)\)\{\s*const start=button\('Start Again'/);

  const startOllama = profiles.match(/async startOllama\(\)\{[\s\S]*?\n {2}\}/)?.[0] || '';
  assert.match(startOllama, /await this\.botLibrary\.load\(\)/);
  const capabilityRefresh = startOllama.indexOf('await this.botLibrary.load()');
  assert.ok(capabilityRefresh < startOllama.indexOf('this.fillQuickstart()'));
  assert.ok(capabilityRefresh < startOllama.indexOf("this.announce('Ollama is ready."));
});

test('Given the dashboard source, when untrusted agent data is rendered, then dynamic markup and handlers stay safe', async () => {
  const publicRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../src/mindcraft/public',
  );
  const [shell, agents, utils] = await Promise.all([
    readFile(path.join(publicRoot, 'index.html'), 'utf8'),
    readFile(path.join(publicRoot, 'js', 'agents.js'), 'utf8'),
    readFile(path.join(publicRoot, 'js', 'utils.js'), 'utf8'),
  ]);

  assert.match(shell, /<html lang="en">/);
  assert.match(utils, /el\.textContent\s*=\s*String\(value\)/);
  assert.match(agents, /dataset\.agentName\s*=\s*agent\.name/);
  assert.match(agents, /output\.textContent=diagnostics\.join/);
  assert.match(agents, /addEventListener\(['"]error['"]/);
  assert.doesNotMatch(`${shell}\n${agents}\n${utils}`, /\son(?:click|error|load)\s*=\s*["']/i);
  assert.doesNotMatch(`${agents}\n${utils}`, /\b(?:innerHTML|outerHTML)\s*=/i);
});

test('Given dashboard lifecycle errors, when recovery guidance is classified, then unsupported providers stay non-retryable while missing credentials can retry', () => {
  assert.equal(isCredentialReason('API key is not configured'), true);
  assert.equal(isCredentialReason('provider is unavailable'), false);
  assert.equal(canStartAgent({
    state: 'blocked',
    retryable: true,
    lastError: 'API key is not configured',
  }), true);
  assert.equal(canStartAgent({
    state: 'blocked',
    retryable: true,
    lastError: 'Unsupported provider',
  }), false);
  assert.equal(canStartAgent({
    state: 'failed',
    retryable: true,
    lastError: 'Agent process exited with signal none',
  }), true);
  assert.equal(canStartAgent({
    state: 'failed',
    retryable: false,
    lastError: 'Agent process exited with signal none',
  }), false);
});

test('Given malformed or unknown dashboard lifecycle targets, when actions are requested, then the server acknowledges a bounded failure', async () => {
  const server = await createMindServer(false, 0);
  const socket = io(`http://localhost:${server.address().port}`, {
    forceNew: true,
    transports: ['websocket'],
  });

  try {
    await once(socket, 'connect');
    assert.deepEqual(
      await requestSocket(socket, 'start-agent', '../outside'),
      {
        success: false,
        error: 'Agent name must be 3-16 alphanumeric or underscore characters.',
      },
    );
    assert.deepEqual(
      await requestSocket(socket, 'stop-agent', 'MissingBot'),
      { success: false, error: "Agent 'MissingBot' not found", agents: [] },
    );
  } finally {
    socket.disconnect();
    await closeMindServer(server);
  }
});

test('Given the setup wizard, when live enablement is explained, then local-provider, cloud-credential, Minecraft, and loopback limits are explicit', async () => {
  // Given
  const setupPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../src/mindcraft/public/setup.html',
  );

  // When
  const setup = await readFile(setupPath, 'utf8');

  // Then
  assert.match(setup, /Ollama, LM Studio, and vLLM local profiles do not need an API key/i);
  assert.match(setup, /cloud-backed profile requires its provider's API key/i);
  assert.match(setup, /MindServer stays loopback-only/i);
  assert.match(setup, /open a world to LAN/i);
});

test('Given local Bedrock controls, when the dashboard inspects or changes same-PC access, then only the injected server controller is called', async () => {
  const calls = [];
  const status = {
    supported: true,
    installed: true,
    loopbackEnabled: false,
    actionRequired: 'enable-loopback',
    packageName: 'Microsoft.MinecraftUWP',
    packageFamilyName: 'Microsoft.MinecraftUWP_8wekyb3d8bbwe',
    version: '1.26.3301.0',
    error: null,
  };
  const bedrockClientController = {
    getStatus: (options) => {
      calls.push(['status', options]);
      return Promise.resolve(status);
    },
    setLoopbackEnabled: (enabled) => {
      calls.push(['loopback', enabled]);
      return Promise.resolve({
        success: true,
        status: { ...status, loopbackEnabled: enabled, actionRequired: null },
      });
    },
  };
  const server = await createMindServer(false, 0, 1, { bedrockClientController });
  const baseUrl = `http://localhost:${server.address().port}`;

  try {
    const inspected = await fetch(`${baseUrl}/api/bedrock-client`);
    assert.equal(inspected.status, 200);
    assert.deepEqual(await inspected.json(), { success: true, client: status });

    const changed = await fetch(`${baseUrl}/api/bedrock-client/loopback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal(changed.status, 200);
    assert.deepEqual(await changed.json(), {
      success: true,
      client: { ...status, loopbackEnabled: true, actionRequired: null },
    });
    assert.deepEqual(calls, [
      ['status', undefined],
      ['loopback', true],
    ]);
  } finally {
    await closeMindServer(server);
  }
});

test('Given server-owned squad controls, when dashboard events arrive, then list, launch, stop, restart, and remove stay on the exact group boundary', async () => {
  const calls = [];
  const squad = {
    id: 'squad-1',
    templateName: 'MindcraftBot',
    prefix: 'Guard_',
    targetSize: 3,
    staggerMs: 500,
    state: 'running',
    cancelRequested: false,
    startedCount: 3,
    failedCount: 0,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:01.000Z',
    members: [
      { name: 'Guard_1', state: 'started', error: null },
      { name: 'Guard_2', state: 'started', error: null },
      { name: 'Guard_3', state: 'started', error: null },
    ],
  };
  const botSquadManager = {
    get: (id) => (id === squad.id ? squad : null),
    list: () => [squad],
    launch: (spec) => {
      calls.push(['launch', spec]);
      return { success: true, squad };
    },
    stop: (id) => {
      calls.push(['stop', id]);
      return Promise.resolve({ success: true, squad: { ...squad, state: 'stopped' } });
    },
    start: (id) => {
      calls.push(['start', id]);
      return { success: true, squad: { ...squad, state: 'starting' } };
    },
    remove: (id) => {
      calls.push(['remove', id]);
      return Promise.resolve({ success: true, id });
    },
  };
  const server = await createMindServer(false, 0, 1, { botSquadManager });
  const socket = io(`http://localhost:${server.address().port}`, {
    forceNew: true,
    transports: ['websocket'],
  });

  try {
    await once(socket, 'connect');
    assert.deepEqual(await requestSocket(socket, 'squad-list'), {
      success: true,
      squads: [squad],
      persistence: null,
    });
    assert.equal((await requestSocket(socket, 'squad-launch', {
      templateName: 'MindcraftBot',
      prefix: 'Guard_',
      size: 3,
      staggerMs: 500,
    })).success, true);
    assert.equal((await requestSocket(socket, 'squad-stop', 'squad-1')).success, true);
    assert.equal((await requestSocket(socket, 'squad-start', 'squad-1')).success, true);
    assert.equal((await requestSocket(socket, 'squad-remove', 'squad-1')).success, true);
    assert.deepEqual(calls, [
      ['launch', {
        templateName: 'MindcraftBot',
        prefix: 'Guard_',
        size: 3,
        staggerMs: 500,
      }],
      ['stop', 'squad-1'],
      ['start', 'squad-1'],
      ['remove', 'squad-1'],
    ]);
  } finally {
    socket.disconnect();
    await closeMindServer(server);
  }
});

test('Given the bot workspace, when an operator needs a variable-size group, then the squad launcher exposes bounded presets and exact lifecycle controls', async () => {
  const agentsPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../src/mindcraft/public/js/agents.js',
  );
  const agents = await readFile(agentsPath, 'utf8');

  assert.match(agents, /Squad Launcher/);
  assert.match(agents, /Small \(3\)/);
  assert.match(agents, /Medium \(5\)/);
  assert.match(agents, /Large \(8\)/);
  assert.match(agents, /Maximum \(12\)/);
  assert.match(agents, /socketRequest\(this\.socket,\s*'squad-launch'/);
  assert.match(agents, /runSquadAction\('squad-stop'/);
  assert.match(agents, /runSquadAction\('squad-start'/);
  assert.match(agents, /runSquadAction\(\s*'squad-remove'/);
  assert.match(agents, /Bot memory and history files are kept on disk/);
  assert.match(agents, /aria-valuemax/);
  assert.doesNotMatch(agents, /\binnerHTML\s*=/);
});

test('Given an installed Bedrock client, when the server workspace renders connection help, then translation, Windows access, authentication, and exact join steps are separate', async () => {
  const publicRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../src/mindcraft/public',
  );
  const [serverWorkspace, shell, main, taskRunners] = await Promise.all([
    readFile(path.join(publicRoot, 'js', 'minecraft-server.js'), 'utf8'),
    readFile(path.join(publicRoot, 'index.html'), 'utf8'),
    readFile(path.join(publicRoot, 'js', 'main.js'), 'utf8'),
    readFile(path.join(publicRoot, 'js', 'swarm.js'), 'utf8'),
  ]);

  assert.match(serverWorkspace, /Bedrock Connection Center/);
  assert.match(serverWorkspace, /\/bedrock-client/);
  assert.match(serverWorkspace, /\/bedrock-client\/loopback/);
  assert.match(serverWorkspace, /\/minecraft-server\/repair-crossplay/);
  assert.match(serverWorkspace, /Enable same-PC Bedrock/);
  assert.match(serverWorkspace, /Install Bedrock sign-in support/);
  assert.match(serverWorkspace, /Play → Servers → Add Server/);
  assert.match(serverWorkspace, /status\.javaEndpoint\?\.access === 'local-network'/);
  assert.match(serverWorkspace, /status\.javaEndpoint\.lanAddresses/);
  assert.match(serverWorkspace, /127\.0\.0\.1/);
  assert.match(serverWorkspace, /19132/);
  assert.match(`${shell}\n${main}\n${taskRunners}`, /Task Runners/);
  assert.doesNotMatch(`${shell}\n${main}\n${taskRunners}`, />Swarm</);
});

test('Given stopped, repair-needed, and LAN Bedrock states, when connection semantics are derived, then backend truth is preserved without a LAN loopback exemption', async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { location: { pathname: '/' } };
  const { bedrockConnectionSemantics } = await import('../../src/mindcraft/public/js/minecraft-server.js');
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
  assert.equal(typeof bedrockConnectionSemantics, 'function');

  assert.deepEqual(bedrockConnectionSemantics({
    phase: 'stopped',
    crossplay: {
      state: 'installed-stopped',
      installed: true,
      configured: true,
      listening: false,
      joinable: false,
      access: 'this-computer',
      authentication: 'floodgate',
    },
  }, { loopbackEnabled: false }), {
    translatorLabel: 'Installed · stopped',
    translatorReady: false,
    configuredToTest: false,
    requiresLoopbackExemption: true,
  });

  assert.equal(bedrockConnectionSemantics({
    phase: 'stopped',
    crossplay: {
      state: 'repair-needed',
      installed: false,
      configured: false,
      listening: false,
      joinable: false,
      access: 'this-computer',
      authentication: 'setup-required',
    },
  }, { loopbackEnabled: true }).translatorLabel, 'Needs repair');

  assert.deepEqual(bedrockConnectionSemantics({
    phase: 'running',
    crossplay: {
      state: 'running',
      installed: true,
      configured: true,
      listening: true,
      joinable: true,
      lanJoinable: true,
      access: 'local-network',
      authentication: 'floodgate',
    },
  }, { loopbackEnabled: false }), {
    translatorLabel: 'Running',
    translatorReady: true,
    configuredToTest: true,
    requiresLoopbackExemption: false,
  });
});
