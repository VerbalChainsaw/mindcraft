import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { EventEmitter, once } from 'node:events';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { io } from 'socket.io-client';

import { createMindServer } from '../../src/mindcraft/mindserver.js';
import * as Mindcraft from '../../src/mindcraft/mindcraft.js';
import * as managedServerModule from '../../src/mindcraft/managed-minecraft-server.js';
import { swarm } from '../../src/mindcraft/swarm/swarm.js';

const sha1Of = (value) => createHash('sha1').update(value).digest('hex');
const sha256Of = (value) => createHash('sha256').update(value).digest('hex');

test('managed player observations are positive only with position and dimension, and offline only when explicit', () => {
  const complete = managedServerModule.parseManagedPlayerPositionLogs([
    '[12:00:00 INFO]: phixxation has the following entity data: [1.5d, 64.0d, -3.25d]',
    '[12:00:00 INFO]: phixxation has the following entity data: "minecraft:overworld"',
  ], 'phixxation');
  assert.deepEqual(complete, {
    success: true,
    found: true,
    code: 'player_position_found',
    player: 'phixxation',
    position: { x: 1.5, y: 64, z: -3.25 },
    dimension: 'minecraft:overworld',
  });

  const partial = managedServerModule.parseManagedPlayerPositionLogs([
    '[12:00:00 INFO]: phixxation has the following entity data: [1.5d, 64.0d, -3.25d]',
  ], 'phixxation');
  assert.equal(partial.success, false);
  assert.equal(partial.found, null);
  assert.equal(partial.code, 'player_position_incomplete');

  const delayed = managedServerModule.parseManagedPlayerPositionLogs([], 'phixxation');
  assert.equal(delayed.success, false);
  assert.equal(delayed.found, null);
  assert.equal(delayed.code, 'player_position_unavailable');

  const offline = managedServerModule.parseManagedPlayerPositionLogs([
    '[12:00:00 INFO]: No entity was found',
  ], 'phixxation');
  assert.equal(offline.success, true);
  assert.equal(offline.found, false);
  assert.equal(offline.code, 'player_not_found');
});

test('managed player observations ignore Paper terminal colors around numeric NBT values', () => {
  const observation = managedServerModule.parseManagedPlayerPositionLogs([
    '[11:13:27 INFO]: phixxation has the following entity data: [\u001b[38;5;3m-480.631\u001b[38;5;9md\u001b[0m, \u001b[38;5;3m66.9375\u001b[38;5;9md\u001b[0m, \u001b[38;5;3m70.029\u001b[38;5;9md\u001b[0m]',
    '[11:13:27 INFO]: phixxation has the following entity data: "minecraft:overworld"',
  ], 'phixxation');

  assert.deepEqual(observation, {
    success: true,
    found: true,
    code: 'player_position_found',
    player: 'phixxation',
    position: { x: -480.631, y: 66.9375, z: 70.029 },
    dimension: 'minecraft:overworld',
  });
});

test('managed player lookups serialize unqualified console results and preserve Floodgate-safe names', async () => {
  const manager = new managedServerModule.ManagedMinecraftServer();
  const stdin = new PassThrough();
  const commands = [];
  manager.child = { stdin };
  manager.phase = 'running';
  stdin.on('data', (chunk) => {
    const command = String(chunk).trim();
    commands.push(command);
    queueMicrotask(() => {
      if (command === 'data get entity Missing Pos') {
        manager.appendLog('[12:00:00 INFO]: No entity was found\n');
      } else if (command === 'data get entity .Bubby Pos') {
        manager.appendLog('[12:00:00 INFO]: .Bubby has the following entity data: [8.0d, 70.0d, -4.0d]\n');
      } else if (command === 'data get entity .Bubby Dimension') {
        manager.appendLog('[12:00:00 INFO]: .Bubby has the following entity data: "minecraft:overworld"\n');
      }
    });
  });

  const [missing, present] = await Promise.all([
    manager.locatePlayerPosition('Missing'),
    manager.locatePlayerPosition('.Bubby'),
  ]);

  assert.equal(missing.success, true);
  assert.equal(missing.found, false);
  assert.equal(present.success, true);
  assert.equal(present.found, true);
  assert.deepEqual(present.position, { x: 8, y: 70, z: -4 });
  assert.equal(present.dimension, 'minecraft:overworld');
  assert.deepEqual(commands, [
    'data get entity Missing Pos',
    'data get entity .Bubby Pos',
    'data get entity .Bubby Dimension',
  ]);
  await assert.rejects(
    () => manager.locatePlayerPosition('seventeen_lettersx'),
    /not valid/i,
  );
});

function requestJson(server, requestPath, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const request = http.request({
      hostname: 'localhost',
      port: server.address().port,
      path: requestPath,
      method,
      headers: {
        ...headers,
        ...(payload
          ? {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(payload),
          }
          : {}),
      },
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode,
          body: (() => {
            try {
              return JSON.parse(raw);
            } catch {
              return {};
            }
          })(),
        });
      });
    });
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function requestSocket(socket, event, ...args) {
  return new Promise((resolve) => {
    socket.emit(event, ...args, resolve);
  });
}

function requestStatus(server, requestPath, { headers = {}, hostname = 'localhost' } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname,
      port: server.address().port,
      path: requestPath,
      method: 'GET',
      headers,
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.end();
  });
}

test('Given a different browser origin, when it tries to mutate launcher configuration, then the request is rejected before the file changes', async () => {
  const configDirectory = await mkdtemp(path.join(tmpdir(), 'mindcraft-managed-origin-'));
  const configPath = path.join(configDirectory, 'launcher-config.json');
  const originalConfigPath = process.env.LAUNCHER_CONFIG_PATH;
  process.env.LAUNCHER_CONFIG_PATH = configPath;
  await writeFile(configPath, JSON.stringify({ auto_start: false }), 'utf8');
  const server = await createMindServer(false, 0);

  try {
    const response = await requestJson(server, '/api/launcher-config', {
      method: 'POST',
      headers: { origin: 'http://localhost:65534' },
      body: { auto_start: true },
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.body.success, false);
    const persisted = JSON.parse(await readFile(configPath, 'utf8'));
    assert.equal(persisted.auto_start, false);
  } finally {
    await closeMindServer(server);
    if (originalConfigPath === undefined) delete process.env.LAUNCHER_CONFIG_PATH;
    else process.env.LAUNCHER_CONFIG_PATH = originalConfigPath;
    await rm(configDirectory, { recursive: true, force: true });
  }
});

test('Given a different browser origin, when it opens the control socket, then state-changing Socket.IO events are unreachable', async () => {
  const server = await createMindServer(false, 0);
  const socket = io(`http://localhost:${server.address().port}`, {
    forceNew: true,
    transports: ['websocket'],
    reconnection: false,
    timeout: 500,
    extraHeaders: { Origin: 'http://localhost:65534' },
  });

  try {
    const outcome = await Promise.race([
      once(socket, 'connect').then(() => 'connected'),
      once(socket, 'connect_error').then(() => 'rejected'),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 1000)),
    ]);
    assert.equal(outcome, 'rejected');
  } finally {
    socket.disconnect();
    await closeMindServer(server);
  }
});

test('Given matching non-loopback Host and Origin headers, when REST mutation is attempted, then DNS rebinding is rejected', async () => {
  const configDirectory = await mkdtemp(path.join(tmpdir(), 'mindcraft-managed-rebinding-'));
  const configPath = path.join(configDirectory, 'launcher-config.json');
  const originalConfigPath = process.env.LAUNCHER_CONFIG_PATH;
  process.env.LAUNCHER_CONFIG_PATH = configPath;
  await writeFile(configPath, JSON.stringify({ auto_start: false }), 'utf8');
  const server = await createMindServer(false, 0);
  const port = server.address().port;

  try {
    const response = await requestJson(server, '/api/launcher-config', {
      method: 'POST',
      headers: {
        host: `rebound.example:${port}`,
        origin: `http://rebound.example:${port}`,
      },
      body: { auto_start: true },
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.body.success, false);
    assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), { auto_start: false });
  } finally {
    await closeMindServer(server);
    if (originalConfigPath === undefined) delete process.env.LAUNCHER_CONFIG_PATH;
    else process.env.LAUNCHER_CONFIG_PATH = originalConfigPath;
    await rm(configDirectory, { recursive: true, force: true });
  }
});

test('Given matching non-loopback Host and Origin headers, when Socket.IO connects, then DNS rebinding is rejected', async () => {
  const server = await createMindServer(false, 0);
  const port = server.address().port;

  try {
    const statusCode = await requestStatus(server, '/socket.io/?EIO=4&transport=polling', {
      headers: {
        host: `rebound.example:${port}`,
        origin: `http://rebound.example:${port}`,
      },
    });
    assert.equal(statusCode, 403);
  } finally {
    await closeMindServer(server);
  }
});

test('Given explicit loopback Host and Origin aliases, when REST and Socket.IO are used, then local control remains available', async () => {
  const configDirectory = await mkdtemp(path.join(tmpdir(), 'mindcraft-managed-loopback-aliases-'));
  const configPath = path.join(configDirectory, 'launcher-config.json');
  const originalConfigPath = process.env.LAUNCHER_CONFIG_PATH;
  process.env.LAUNCHER_CONFIG_PATH = configPath;
  await writeFile(configPath, JSON.stringify({ auto_start: false }), 'utf8');
  const server = await createMindServer(false, 0);
  const port = server.address().port;

  try {
    const response = await requestJson(server, '/api/launcher-config', {
      method: 'POST',
      headers: {
        host: `localhost:${port}`,
        origin: `http://127.0.0.1:${port}`,
      },
      body: { auto_start: true },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(await requestStatus(server, '/socket.io/?EIO=4&transport=polling', {
      hostname: '::1',
      headers: {
        origin: `http://[::1]:${port}`,
      },
    }), 200);
  } finally {
    await closeMindServer(server);
    if (originalConfigPath === undefined) delete process.env.LAUNCHER_CONFIG_PATH;
    else process.env.LAUNCHER_CONFIG_PATH = originalConfigPath;
    await rm(configDirectory, { recursive: true, force: true });
  }
});

async function closeMindServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  swarm.stop();
}

async function waitFor(condition, description, timeoutMs = 2000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await condition();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

test('Given the local dashboard, when managed Minecraft status is requested, then it exposes a safe loopback server summary', async () => {
  const managedMinecraftServer = {
    getStatus() {
      return {
        host: '127.0.0.1',
        port: 25565,
        recommendedVersion: '1.21.11',
        compatible: true,
        phase: 'stopped',
        java: {
          available: true,
          requiredMajor: 21,
        },
      };
    },
  };
  const server = await createMindServer(false, 0, 1, { managedMinecraftServer });

  try {
    const response = await requestJson(server, '/api/minecraft-server');

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.server.host, '127.0.0.1');
    assert.equal(response.body.server.port, 25565);
    assert.equal(response.body.server.recommendedVersion, '1.21.11');
    assert.equal(typeof response.body.server.compatible, 'boolean');
    assert.equal(typeof response.body.server.phase, 'string');
    assert.equal(typeof response.body.server.java.available, 'boolean');
    assert.equal(response.body.server.java.requiredMajor, 21);
    assert.equal('downloadUrl' in response.body.server, false);
  } finally {
    await closeMindServer(server);
  }
});

test('Given a running managed server and a saved external target, when health and setup resolve the target, then runtime projection does not overwrite user config', async () => {
  const configDirectory = await mkdtemp(path.join(tmpdir(), 'mindcraft-managed-target-drift-'));
  const configPath = path.join(configDirectory, 'launcher-config.json');
  const originalConfigPath = process.env.LAUNCHER_CONFIG_PATH;
  const minecraftProbe = http.createServer((_request, response) => response.end());
  await new Promise((resolve, reject) => {
    minecraftProbe.once('error', reject);
    minecraftProbe.listen(0, '127.0.0.1', resolve);
  });
  const livePort = minecraftProbe.address().port;
  process.env.LAUNCHER_CONFIG_PATH = configPath;
  await writeFile(configPath, JSON.stringify({
    auto_start: false,
    agent_defaults: {
      host: '127.0.0.1',
      port: 25565,
    },
  }), 'utf8');
  const managedMinecraftServer = {
    getStatus() {
      return {
        phase: 'running',
        installed: true,
        host: '127.0.0.1',
        port: livePort,
      };
    },
  };
  const server = await createMindServer(false, 0, 1, { managedMinecraftServer });

  try {
    const health = await requestJson(server, '/api/health');
    const managed = await requestJson(server, '/api/minecraft-server?logs=0');
    const catalog = await requestJson(server, '/api/bot-library/catalog');
    const saved = await requestJson(server, '/api/launcher-config', {
      method: 'POST',
      body: {
        agent_defaults: {
          host: '127.0.0.1',
          port: 25565,
        },
      },
    });
    const persisted = JSON.parse(await readFile(configPath, 'utf8'));

    assert.equal(health.statusCode, 200);
    assert.equal(health.body.checks.minecraftTarget, `127.0.0.1:${livePort}`);
    assert.equal(health.body.checks.minecraftReachable, true);
    assert.deepEqual(managed.body.server.target, {
      host: '127.0.0.1',
      port: livePort,
      auth: 'offline',
      minecraft_version: 'auto',
      source: 'managed-runtime',
    });
    assert.deepEqual(catalog.body.defaults.connection, {
      host: '127.0.0.1',
      port: livePort,
    });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.body.config.agent_defaults.port, livePort);
    assert.equal(persisted.agent_defaults.port, 25565);
  } finally {
    await closeMindServer(server);
    await new Promise((resolve, reject) => {
      minecraftProbe.close((error) => (error ? reject(error) : resolve()));
    });
    if (originalConfigPath === undefined) delete process.env.LAUNCHER_CONFIG_PATH;
    else process.env.LAUNCHER_CONFIG_PATH = originalConfigPath;
    await rm(configDirectory, { recursive: true, force: true });
  }
});

test('Given no running managed server, when health resolves the target, then an external configured server remains authoritative', async () => {
  const configDirectory = await mkdtemp(path.join(tmpdir(), 'mindcraft-external-target-'));
  const configPath = path.join(configDirectory, 'launcher-config.json');
  const originalConfigPath = process.env.LAUNCHER_CONFIG_PATH;
  const minecraftProbe = http.createServer((_request, response) => response.end());
  await new Promise((resolve, reject) => {
    minecraftProbe.once('error', reject);
    minecraftProbe.listen(0, '127.0.0.1', resolve);
  });
  const externalPort = minecraftProbe.address().port;
  process.env.LAUNCHER_CONFIG_PATH = configPath;
  await writeFile(configPath, JSON.stringify({
    auto_start: false,
    agent_defaults: {
      host: '127.0.0.1',
      port: externalPort,
    },
  }), 'utf8');
  const managedMinecraftServer = {
    getStatus() {
      return {
        phase: 'stopped',
        installed: true,
        host: '127.0.0.1',
        port: 25578,
      };
    },
  };
  const server = await createMindServer(false, 0, 1, { managedMinecraftServer });

  try {
    const health = await requestJson(server, '/api/health');
    const config = await requestJson(server, '/api/launcher-config');

    assert.equal(health.statusCode, 200);
    assert.equal(health.body.checks.minecraftTarget, `127.0.0.1:${externalPort}`);
    assert.equal(health.body.checks.minecraftReachable, true);
    assert.equal(config.statusCode, 200);
    assert.equal(config.body.config.agent_defaults.port, externalPort);
  } finally {
    await closeMindServer(server);
    await new Promise((resolve, reject) => {
      minecraftProbe.close((error) => (error ? reject(error) : resolve()));
    });
    if (originalConfigPath === undefined) delete process.env.LAUNCHER_CONFIG_PATH;
    else process.env.LAUNCHER_CONFIG_PATH = originalConfigPath;
    await rm(configDirectory, { recursive: true, force: true });
  }
});

test('Given dashboard bot registration, when the managed runtime owns the target, then registration projects that target before creation', async () => {
  const source = await readFile(path.resolve('src/mindcraft/mindserver.js'), 'utf8');
  const handler = source.match(/socket\.on\('create-agent',[\s\S]*?\n {8}\}\);/)?.[0] || '';

  assert.match(handler, /await getActiveManagedTarget\(\)/);
  assert.match(handler, /targetSettings\(activeTarget\)/);
  assert.ok(handler.indexOf('targetSettings(activeTarget)') < handler.indexOf('mindcraft.createAgent'));
});

test('Given a stopped registered bot with a stale port, when Start is requested, then the running managed target is applied before launch', async () => {
  const agentName = 'ColdStartBot';
  let requestedTarget = null;
  const fakeProcess = {
    state: 'stopped',
    running: false,
    start() {
      this.state = 'running';
      this.running = true;
      return Promise.resolve();
    },
    stop() {
      this.state = 'stopped';
      this.running = false;
      return true;
    },
    isActive() {
      return this.running;
    },
  };
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
    host: '127.0.0.1',
    port: 25565,
    minecraft_version: 'auto',
    profile: { name: agentName, model: 'ollama/local' },
  }, {
    name: agentName,
    state: 'ready',
    running: false,
    retryable: true,
    lastError: null,
  }, {
    resolveServer: (host, port) => {
      requestedTarget = { host, port };
      return { host, port, version: '1.21.11' };
    },
    createAgentProcess: () => fakeProcess,
  });

  try {
    await once(socket, 'connect');
    const response = await requestSocket(socket, 'start-agent', agentName);
    const settings = await requestSocket(socket, 'get-settings', agentName);

    assert.deepEqual(response, { success: true, error: null });
    assert.deepEqual(requestedTarget, { host: '127.0.0.1', port: 25579 });
    assert.equal(settings.settings.host, '127.0.0.1');
    assert.equal(settings.settings.port, 25579);
  } finally {
    fakeProcess.stop();
    Mindcraft.destroyAgent(agentName);
    socket.disconnect();
    await closeMindServer(server);
  }
});

test('Given a running managed target and a saved external target, when Local Quickstart is persisted, then the external target remains authoritative on disk', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-quickstart-target-authority-'));
  const configPath = path.join(rootDir, 'launcher-config.json');
  const originalConfigPath = process.env.LAUNCHER_CONFIG_PATH;
  const originalCwd = process.cwd();
  process.env.LAUNCHER_CONFIG_PATH = configPath;
  process.chdir(rootDir);
  await writeFile(configPath, JSON.stringify({
    auto_start: false,
    agent_defaults: {
      host: 'external.example',
      port: 25565,
      auth: 'offline',
      minecraft_version: 'auto',
    },
  }), 'utf8');
  const managedMinecraftServer = {
    getStatus: () => ({
      phase: 'running',
      installed: true,
      host: '127.0.0.1',
      port: 25580,
    }),
  };
  const server = await createMindServer(false, 0, 1, {
    managedMinecraftServer,
    discoverOllamaModels: () => Promise.resolve([{ name: 'local-chat', kind: 'chat' }]),
  });

  try {
    const response = await requestJson(server, '/api/quickstart/local', {
      method: 'POST',
      body: {
        botName: 'QuickBot',
        chatModel: 'local-chat',
        host: '127.0.0.1',
        port: 25580,
        autoStart: false,
      },
    });
    const persisted = JSON.parse(await readFile(configPath, 'utf8'));

    assert.equal(response.statusCode, 200);
    assert.equal(persisted.agent_defaults.host, 'external.example');
    assert.equal(persisted.agent_defaults.port, 25565);
  } finally {
    await closeMindServer(server);
    process.chdir(originalCwd);
    if (originalConfigPath === undefined) delete process.env.LAUNCHER_CONFIG_PATH;
    else process.env.LAUNCHER_CONFIG_PATH = originalConfigPath;
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('Given an ordinary primary bot and a managed port change, when the server restarts, then the bot receives the refreshed target before resume', async () => {
  const agentName = 'RetargetBot';
  let active = true;
  let port = 25565;
  const fakeProcess = {
    state: 'running',
    running: true,
    start: () => Promise.resolve(),
    stop() {
      active = false;
      this.state = 'stopped';
      this.running = false;
      return true;
    },
    waitForExit: () => Promise.resolve(),
    forceRestart() {
      active = true;
      this.state = 'running';
      this.running = true;
      return Promise.resolve();
    },
    isActive: () => active,
  };
  const managedMinecraftServer = {
    getStatus: () => ({ phase: 'running', installed: true, host: '127.0.0.1', port }),
    restart: () => {
      port = 25580;
      return { phase: 'starting', installed: true, host: '127.0.0.1', port };
    },
    waitForReady: () => ({ phase: 'running', installed: true, host: '127.0.0.1', port }),
  };
  const server = await createMindServer(false, 0, 1, { managedMinecraftServer });
  const socket = io(`http://localhost:${server.address().port}`, {
    forceNew: true,
    transports: ['websocket'],
  });

  try {
    await Mindcraft.createAgent({
      host: '127.0.0.1',
      port: 25565,
      minecraft_version: 'auto',
      profile: { name: agentName, model: 'ollama/local' },
    }, {
      resolveServer: (host, requestedPort) => ({ host, port: requestedPort, version: '1.21.11' }),
      createAgentProcess: () => fakeProcess,
    });
    await once(socket, 'connect');

    const response = await requestJson(server, '/api/minecraft-server/restart', {
      method: 'POST',
      body: {},
    });
    const settings = await new Promise((resolve) => {
      socket.emit('get-settings', agentName, resolve);
    });

    assert.equal(response.statusCode, 200);
    assert.equal(fakeProcess.state, 'running');
    assert.equal(settings.settings.host, '127.0.0.1');
    assert.equal(settings.settings.port, 25580);
    assert.equal(settings.settings.minecraft_version, 'auto');
  } finally {
    Mindcraft.destroyAgent(agentName);
    socket.disconnect();
    await closeMindServer(server);
  }
});

test('Given legacy and newer bundled Java runtimes, when Java is detected, then the closest compatible runtime wins', async () => {
  assert.equal(typeof managedServerModule.parseJavaMajor, 'function');
  assert.equal(managedServerModule.parseJavaMajor('java version "1.8.0_501"'), 8);
  assert.equal(managedServerModule.parseJavaMajor('openjdk version "21.0.3" 2024-04-16 LTS'), 21);

  const manager = new managedServerModule.ManagedMinecraftServer({
    platform: 'win32',
    runtimeCandidates: () => [
      { path: 'java', source: 'PATH' },
      { path: 'C:\\Minecraft\\runtime\\bin\\java.exe', source: 'Minecraft Launcher' },
      { path: 'C:\\Minecraft\\runtime25\\bin\\java.exe', source: 'Minecraft Launcher' },
    ],
    inspectJava: (candidate) => {
      if (candidate.path === 'java') {
        return { ...candidate, available: true, supported: false, version: '1.8.0_501', major: 8 };
      }
      if (candidate.path.includes('runtime25')) {
        return { ...candidate, available: true, supported: true, version: '25.0.1', major: 25 };
      }
      return { ...candidate, available: true, supported: true, version: '21.0.3', major: 21 };
    },
  });

  const status = await manager.getStatus();

  assert.equal(status.java.available, true);
  assert.equal(status.java.supported, true);
  assert.equal(status.java.major, 21);
  assert.equal(status.java.source, 'Minecraft Launcher');
  assert.equal(status.java.path, 'C:\\Minecraft\\runtime\\bin\\java.exe');
});

test('Given WSL can execute both Linux and Windows Java, when Java is detected, then only the native runtime is eligible', async () => {
  const manager = new managedServerModule.ManagedMinecraftServer({
    platform: 'linux',
    runtimeCandidates: () => [
      { path: '/usr/bin/java', source: 'PATH' },
      { path: '/mnt/c/Minecraft/runtime/bin/java.exe', source: 'Minecraft Launcher' },
    ],
    inspectJava: (candidate) => ({
      ...candidate,
      available: true,
      supported: true,
      version: candidate.path.endsWith('.exe') ? '21.0.7' : '25.0.3',
      major: candidate.path.endsWith('.exe') ? 21 : 25,
    }),
  });

  const status = await manager.getStatus();

  assert.equal(status.java.path, '/usr/bin/java');
  assert.equal(status.java.source, 'PATH');
  assert.equal(status.java.major, 25);
});

test('Given no explicit EULA acceptance, when managed server installation is requested, then nothing is installed', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-managed-server-'));
  const manager = new managedServerModule.ManagedMinecraftServer({ rootDir });

  try {
    await assert.rejects(
      () => manager.install({ acceptEula: false }),
      /accept the Minecraft EULA/i,
    );
    await assert.rejects(() => access(path.join(rootDir, 'server.jar')));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('Given EULA acceptance and the official release metadata, when installed, then the verified server and safe local properties are persisted', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-managed-server-'));
  const jar = Buffer.from('test minecraft server jar');
  const sha1 = createHash('sha1').update(jar).digest('hex');
  const responses = new Map([
    ['https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', {
      latest: { release: '1.21.11' },
      versions: [{ id: '1.21.11', type: 'release', url: 'https://metadata.test/1.21.11.json' }],
    }],
    ['https://metadata.test/1.21.11.json', {
      javaVersion: { majorVersion: 21 },
      downloads: {
        server: {
          url: 'https://downloads.test/server.jar',
          sha1,
          size: jar.length,
        },
      },
    }],
  ]);
  const fetchImpl = (url) => {
    if (url === 'https://downloads.test/server.jar') {
      return {
        ok: true,
        arrayBuffer: () => jar,
      };
    }
    const body = responses.get(url);
    return {
      ok: Boolean(body),
      json: () => body,
    };
  };
  const manager = new managedServerModule.ManagedMinecraftServer({
    rootDir,
    fetchImpl,
    runtimeCandidates: () => [{ path: 'java21', source: 'test' }],
    inspectJava: (candidate) => ({
      ...candidate,
      available: true,
      supported: true,
      version: '21.0.3',
      major: 21,
    }),
  });

  try {
    const status = await manager.install({
      acceptEula: true,
      version: 'latest',
      port: 25565,
      memoryMb: 2048,
    });

    assert.equal(status.installed, true);
    assert.equal(status.version, '1.21.11');
    assert.equal(await readFile(path.join(rootDir, 'server.jar'), 'utf8'), jar.toString());
    assert.equal(await readFile(path.join(rootDir, 'eula.txt'), 'utf8'), 'eula=true\n');
    const properties = await readFile(path.join(rootDir, 'server.properties'), 'utf8');
    assert.match(properties, /^server-ip=127\.0\.0\.1$/m);
    assert.match(properties, /^server-port=25565$/m);
    assert.match(properties, /^online-mode=false$/m);
    assert.match(properties, /^motd=Mindcraft Local Server$/m);
    assert.match(properties, /^white-list=false$/m);
    assert.match(properties, /^pause-when-empty-seconds=-1$/m);
    const config = JSON.parse(await readFile(path.join(rootDir, 'mindcraft-server.json'), 'utf8'));
    assert.deepEqual(config, {
      version: '1.21.11',
      port: 25565,
      javaBindAddress: '127.0.0.1',
      memoryMb: 2048,
      desiredState: 'stopped',
      serverSha1: sha1,
      motd: 'Mindcraft Local Server',
      onlineMode: false,
      whiteList: false,
      enforceWhitelist: false,
      hideOnlinePlayers: false,
      logIps: true,
      gameMode: 'survival',
      difficulty: 'normal',
      maxPlayers: 10,
      pvp: true,
      forceGameMode: false,
      hardcore: false,
      allowFlight: true,
      enableCommandBlock: true,
      spawnProtection: 0,
      playerIdleTimeout: 0,
      opPermissionLevel: 4,
      viewDistance: 10,
      simulationDistance: 8,
      pauseWhenEmptySeconds: -1,
      entityBroadcastRangePercentage: 100,
      javaMajor: 21,
    });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('Given a stopped managed server, when play settings are changed, then validated settings and unknown properties are persisted atomically', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-managed-configure-'));
  await writeFile(path.join(rootDir, 'server.jar'), 'jar');
  await writeFile(path.join(rootDir, 'eula.txt'), 'eula=true\n');
  await writeFile(path.join(rootDir, 'mindcraft-server.json'), JSON.stringify({
    version: '1.21.11',
    port: 25565,
    memoryMb: 2048,
    desiredState: 'stopped',
    javaMajor: 21,
  }));
  await writeFile(path.join(rootDir, 'server.properties'), [
    'server-ip=127.0.0.1',
    'server-port=25565',
    'custom-user-setting=keep-me',
    '',
  ].join('\n'));
  const manager = new managedServerModule.ManagedMinecraftServer({
    rootDir,
    runtimeCandidates: () => [],
  });

  try {
    const status = await manager.configure({
      port: 25570,
      memoryMb: 4096,
      motd: 'Bots and builders',
      onlineMode: true,
      whiteList: true,
      enforceWhitelist: true,
      hideOnlinePlayers: true,
      logIps: false,
      gameMode: 'creative',
      difficulty: 'hard',
      maxPlayers: 12,
      pvp: false,
      forceGameMode: true,
      hardcore: true,
      allowFlight: true,
      enableCommandBlock: false,
      spawnProtection: 8,
      playerIdleTimeout: 30,
      opPermissionLevel: 3,
      viewDistance: 14,
      simulationDistance: 10,
      pauseWhenEmptySeconds: 300,
      entityBroadcastRangePercentage: 75,
      bedrockPort: 19133,
      bedrockBindAddress: '0.0.0.0',
    });

    assert.equal(status.port, 25570);
    assert.equal(status.memoryMb, 4096);
    assert.deepEqual(status.settings, {
      motd: 'Bots and builders',
      onlineMode: true,
      whiteList: true,
      enforceWhitelist: true,
      hideOnlinePlayers: true,
      logIps: false,
      gameMode: 'creative',
      difficulty: 'hard',
      maxPlayers: 12,
      pvp: false,
      forceGameMode: true,
      hardcore: true,
      allowFlight: true,
      enableCommandBlock: false,
      spawnProtection: 8,
      playerIdleTimeout: 30,
      opPermissionLevel: 3,
      viewDistance: 14,
      simulationDistance: 10,
      pauseWhenEmptySeconds: 300,
      entityBroadcastRangePercentage: 75,
    });
    assert.equal(status.crossplay.bedrockPort, 19133);
    assert.equal(status.javaEndpoint.bindAddress, '0.0.0.0');
    const properties = await readFile(path.join(rootDir, 'server.properties'), 'utf8');
    assert.match(properties, /^custom-user-setting=keep-me$/m);
    assert.match(properties, /^server-ip=0\.0\.0\.0$/m);
    assert.match(properties, /^server-port=25570$/m);
    assert.match(properties, /^motd=Bots and builders$/m);
    assert.match(properties, /^online-mode=true$/m);
    assert.match(properties, /^white-list=true$/m);
    assert.match(properties, /^enforce-whitelist=true$/m);
    assert.match(properties, /^hide-online-players=true$/m);
    assert.match(properties, /^log-ips=false$/m);
    assert.match(properties, /^gamemode=creative$/m);
    assert.match(properties, /^difficulty=hard$/m);
    assert.match(properties, /^max-players=12$/m);
    assert.match(properties, /^pvp=false$/m);
    assert.match(properties, /^force-gamemode=true$/m);
    assert.match(properties, /^hardcore=true$/m);
    assert.match(properties, /^allow-flight=true$/m);
    assert.match(properties, /^enable-command-block=false$/m);
    assert.match(properties, /^spawn-protection=8$/m);
    assert.match(properties, /^player-idle-timeout=30$/m);
    assert.match(properties, /^op-permission-level=3$/m);
    assert.match(properties, /^view-distance=14$/m);
    assert.match(properties, /^simulation-distance=10$/m);
    assert.match(properties, /^pause-when-empty-seconds=300$/m);
    assert.match(properties, /^entity-broadcast-range-percentage=75$/m);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('Given an active managed server, when settings are changed, then configuration is rejected without mutating files', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-managed-configure-active-'));
  await writeFile(path.join(rootDir, 'server.jar'), 'jar');
  await writeFile(path.join(rootDir, 'eula.txt'), 'eula=true\n');
  await writeFile(path.join(rootDir, 'mindcraft-server.json'), JSON.stringify({
    version: '1.21.11',
    port: 25565,
    memoryMb: 2048,
    desiredState: 'running',
    javaMajor: 21,
  }));
  await writeFile(path.join(rootDir, 'server.properties'), 'server-port=25565\n');
  const manager = new managedServerModule.ManagedMinecraftServer({ rootDir });
  manager.phase = 'running';
  manager.child = {};

  try {
    await assert.rejects(() => manager.configure({ port: 25570 }), /stop.*before changing/i);
    assert.equal(await readFile(path.join(rootDir, 'server.properties'), 'utf8'), 'server-port=25565\n');
  } finally {
    manager.child = null;
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('Given a late managed configuration write failure, when server.properties was committed first, then it is rolled back and temporary files are removed', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-managed-config-rollback-'));
  const originalConfig = {
    version: '1.21.11',
    port: 25565,
    memoryMb: 2048,
    desiredState: 'stopped',
    motd: 'Original name',
    javaMajor: 21,
  };
  const originalProperties = 'server-port=25565\nmotd=Original name\ncustom-user-setting=keep-me\n';
  await writeFile(path.join(rootDir, 'server.jar'), 'jar');
  await writeFile(path.join(rootDir, 'eula.txt'), 'eula=true\n');
  await writeFile(
    path.join(rootDir, 'mindcraft-server.json'),
    `${JSON.stringify(originalConfig, null, 2)}\n`,
  );
  await writeFile(path.join(rootDir, 'server.properties'), originalProperties);
  const manager = new managedServerModule.ManagedMinecraftServer({
    rootDir,
    runtimeCandidates: () => [],
    fileOps: {
      mkdir,
      rename: (from, to) => {
        if (from.endsWith('-next') && to.endsWith('mindcraft-server.json')) {
          throw new Error('injected config rename failure');
        }
        return rename(from, to);
      },
      unlink,
      writeFile,
    },
  });

  try {
    await assert.rejects(
      () => manager.configure({ motd: 'Changed name' }),
      /injected config rename failure/,
    );
    assert.equal(await readFile(path.join(rootDir, 'server.properties'), 'utf8'), originalProperties);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(rootDir, 'mindcraft-server.json'), 'utf8')),
      originalConfig,
    );
    assert.deepEqual(
      (await readdir(rootDir)).filter((name) => name.includes('.tmp-')),
      [],
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('Given managed server settings, when exposed access and performance values are validated, then malformed or unsafe values are rejected', () => {
  const manager = new managedServerModule.ManagedMinecraftServer({
    rootDir: path.join(tmpdir(), 'mindcraft-managed-validation-does-not-exist'),
    runtimeCandidates: () => [],
  });

  assert.throws(
    () => manager.validateConfiguration({ motd: 'first line\nsecond line' }),
    /server name.*one line/i,
  );
  assert.throws(
    () => manager.validateConfiguration({ onlineMode: 'true' }),
    /onlineMode must be true or false/i,
  );
  assert.throws(
    () => manager.validateConfiguration({ opPermissionLevel: 5 }),
    /operator permission level/i,
  );
  assert.throws(
    () => manager.validateConfiguration({ pauseWhenEmptySeconds: -2 }),
    /empty-server pause/i,
  );
  assert.throws(
    () => manager.validateConfiguration({ entityBroadcastRangePercentage: 9 }),
    /entity broadcast range/i,
  );
  assert.equal(
    manager.validateConfiguration({
      motd: 'Local builders',
      onlineMode: false,
      whiteList: true,
      pauseWhenEmptySeconds: 60,
      entityBroadcastRangePercentage: 80,
    }).motd,
    'Local builders',
  );
});

test('Given Bedrock cross-play installation, when official artifacts are resolved, then Paper, Geyser, Floodgate, and ViaVersion are all hash verified and persisted', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-managed-crossplay-'));
  const serverJar = Buffer.from('paper server jar');
  const geyserJar = Buffer.from('geyser plugin jar');
  const floodgateJar = Buffer.from('floodgate plugin jar');
  const viaJar = Buffer.from('via plugin jar');
  const responses = new Map([
    ['https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', {
      latest: { release: '26.2' },
      versions: [{ id: '1.21.11', url: 'https://metadata.test/1.21.11.json' }],
    }],
    ['https://metadata.test/1.21.11.json', {
      javaVersion: { majorVersion: 21 },
      downloads: { server: { url: 'unused', sha1: 'a'.repeat(40), size: 1 } },
    }],
    ['https://fill.papermc.io/v3/projects/paper/versions/1.21.11/builds/latest', {
      id: 132,
      channel: 'STABLE',
      downloads: {
        'server:default': {
          name: 'paper.jar',
          size: serverJar.length,
          url: 'https://downloads.test/paper.jar',
          checksums: { sha256: sha256Of(serverJar) },
        },
      },
    }],
    ['https://download.geysermc.org/v2/projects/geyser/versions/latest/builds/latest', {
      version: '2.11.0',
      build: 1204,
      downloads: { spigot: { name: 'Geyser-Spigot.jar', sha256: sha256Of(geyserJar) } },
    }],
    ['https://download.geysermc.org/v2/projects/floodgate/versions/latest/builds/latest', {
      version: '2.2.5',
      build: 138,
      downloads: { spigot: { name: 'floodgate-spigot.jar', sha256: sha256Of(floodgateJar) } },
    }],
    ['https://hangar.papermc.io/api/v1/projects/ViaVersion/latestrelease', '5.11.0'],
    ['https://hangar.papermc.io/api/v1/projects/ViaVersion/versions/5.11.0', {
      downloads: {
        PAPER: {
          fileInfo: { name: 'ViaVersion.jar', sizeBytes: viaJar.length, sha256Hash: sha256Of(viaJar) },
          downloadUrl: 'https://downloads.test/via.jar',
        },
      },
    }],
  ]);
  const binaries = new Map([
    ['https://downloads.test/paper.jar', serverJar],
    ['https://download.geysermc.org/v2/projects/geyser/versions/latest/builds/latest/downloads/spigot', geyserJar],
    ['https://download.geysermc.org/v2/projects/floodgate/versions/latest/builds/latest/downloads/spigot', floodgateJar],
    ['https://downloads.test/via.jar', viaJar],
  ]);
  const fetchImpl = (url) => {
    if (binaries.has(url)) {
      const body = binaries.get(url);
      return { ok: true, headers: { get: () => String(body.length) }, arrayBuffer: () => body };
    }
    const body = responses.get(url);
    return {
      ok: body !== undefined,
      json: () => body,
      text: () => String(body),
    };
  };
  const manager = new managedServerModule.ManagedMinecraftServer({
    rootDir,
    fetchImpl,
    runtimeCandidates: () => [{ path: 'java21', source: 'test' }],
    inspectJava: (candidate) => ({
      ...candidate,
      available: true,
      supported: true,
      version: '21.0.3',
      major: 21,
    }),
  });

  try {
    const status = await manager.install({ acceptEula: true, crossplay: true });

    assert.equal(status.distribution, 'paper');
    assert.equal(status.crossplay.enabled, true);
    assert.equal(status.crossplay.installed, true);
    assert.equal(status.crossplay.configured, false);
    assert.equal(status.crossplay.listening, false);
    assert.equal(status.crossplay.joinable, false);
    assert.equal(status.crossplay.lanJoinable, false);
    assert.equal(status.crossplay.ready, false);
    assert.equal(await readFile(path.join(rootDir, 'server.jar'), 'utf8'), serverJar.toString());
    assert.equal(await readFile(path.join(rootDir, 'plugins', 'Geyser-Spigot.jar'), 'utf8'), geyserJar.toString());
    assert.equal(await readFile(path.join(rootDir, 'plugins', 'floodgate-spigot.jar'), 'utf8'), floodgateJar.toString());
    assert.equal(await readFile(path.join(rootDir, 'plugins', 'ViaVersion.jar'), 'utf8'), viaJar.toString());
    const config = JSON.parse(await readFile(path.join(rootDir, 'mindcraft-server.json'), 'utf8'));
    assert.equal(config.serverSha256, sha256Of(serverJar));
    assert.equal(config.geyserSha256, sha256Of(geyserJar));
    assert.equal(config.floodgateSha256, sha256Of(floodgateJar));
    assert.equal(config.floodgateVersion, '2.2.5');
    assert.equal(config.floodgateBuild, 138);
    assert.equal(config.viaVersionSha256, sha256Of(viaJar));
    assert.equal(config.bedrockPort, 19132);

    const geyserDirectory = path.join(rootDir, 'plugins', 'Geyser-Spigot');
    await mkdir(geyserDirectory, { recursive: true });
    await writeFile(path.join(geyserDirectory, 'config.yml'), [
      'remote:',
      '  address: auto',
      '  auth-type: online',
      '',
    ].join('\n'));
    const repaired = await manager.repairCrossplay();
    assert.equal(repaired.crossplay.authentication, 'floodgate');
    assert.match(
      await readFile(path.join(geyserDirectory, 'config.yml'), 'utf8'),
      /^\s*auth-type:\s*floodgate\s*$/m,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('Given Mojang has released a version newer than Mineflayer supports, when latest is requested, then the newest bot-compatible release is selected', async () => {
  const requested = [];
  const fetchImpl = (url) => {
    requested.push(url);
    if (url === 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json') {
      return {
        ok: true,
        json: () => ({
          latest: { release: '26.2' },
          versions: [
            { id: '26.2', url: 'https://metadata.test/26.2.json' },
            { id: '1.21.11', url: 'https://metadata.test/1.21.11.json' },
          ],
        }),
      };
    }
    if (url === 'https://metadata.test/1.21.11.json') {
      return {
        ok: true,
        json: () => ({
          javaVersion: { majorVersion: 21 },
          downloads: {
            server: {
              url: 'https://downloads.test/1.21.11-server.jar',
              sha1: 'b'.repeat(40),
              size: 1024,
            },
          },
        }),
      };
    }
    throw new Error(`unexpected metadata request: ${url}`);
  };
  const manager = new managedServerModule.ManagedMinecraftServer({
    fetchImpl,
    supportedMinecraftVersions: ['1.21.11', '1.21.9'],
    latestSupportedVersion: '1.21.11',
  });

  const download = await manager.resolveServerDownload('latest');

  assert.equal(download.version, '1.21.11');
  assert.equal(download.javaMajor, 21);
  assert.equal(requested.includes('https://metadata.test/26.2.json'), false);
});

test('Given a requested release is outside Mineflayer support, when download metadata is resolved, then it is rejected before installation', async () => {
  const manager = new managedServerModule.ManagedMinecraftServer({
    supportedMinecraftVersions: ['1.21.11'],
    latestSupportedVersion: '1.21.11',
    fetchImpl: () => ({
      ok: true,
      json: () => ({
        latest: { release: '26.2' },
        versions: [
          { id: '26.2', url: 'https://metadata.test/26.2.json' },
          { id: '1.21.11', url: 'https://metadata.test/1.21.11.json' },
        ],
      }),
    }),
  });

  await assert.rejects(
    () => manager.resolveServerDownload('26.2'),
    /not supported by this Mindcraft bot engine.*1\.21\.11/i,
  );
});

test('Given a release requiring newer Java, when installation is requested, then it fails before downloading the server jar', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-managed-java-requirement-'));
  let jarRequested = false;
  const fetchImpl = (url) => {
    if (url === 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json') {
      return {
        ok: true,
        json: () => ({
          latest: { release: '26.2' },
          versions: [{ id: '26.2', url: 'https://metadata.test/26.2.json' }],
        }),
      };
    }
    if (url === 'https://metadata.test/26.2.json') {
      return {
        ok: true,
        json: () => ({
          javaVersion: { majorVersion: 25 },
          downloads: {
            server: {
              url: 'https://downloads.test/server.jar',
              sha1: 'a'.repeat(40),
              size: 1024,
            },
          },
        }),
      };
    }
    jarRequested = true;
    throw new Error('server jar download should not begin');
  };
  const manager = new managedServerModule.ManagedMinecraftServer({
    rootDir,
    fetchImpl,
    supportedMinecraftVersions: ['26.2'],
    latestSupportedVersion: '26.2',
    runtimeCandidates: () => [{ path: 'java21', source: 'test' }],
    inspectJava: (candidate) => ({
      ...candidate,
      available: true,
      supported: true,
      version: '21.0.3',
      major: 21,
    }),
  });

  try {
    await assert.rejects(
      () => manager.install({ acceptEula: true, version: 'latest' }),
      /requires Java 25 or newer/i,
    );
    assert.equal(jarRequested, false);
    await assert.rejects(() => access(path.join(rootDir, 'server.jar')));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('Given a managed server process is active, when installation is requested, then it is rejected before touching the network or world files', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-managed-active-install-'));
  await writeFile(path.join(rootDir, 'server.jar'), 'existing jar', 'utf8');
  const manager = new managedServerModule.ManagedMinecraftServer({
    rootDir,
    fetchImpl: () => {
      throw new Error('network should not be touched');
    },
  });
  manager.child = { pid: 5151 };
  manager.phase = 'running';

  try {
    await assert.rejects(
      () => manager.install({ acceptEula: true, version: 'latest' }),
      /stop the managed server before installing/i,
    );
    assert.equal(await readFile(path.join(rootDir, 'server.jar'), 'utf8'), 'existing jar');
  } finally {
    manager.child = null;
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('Given the installed server jar no longer matches Mojang metadata, when start is requested, then corruption is reported before Java spawns', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-managed-corrupt-jar-'));
  await writeFile(path.join(rootDir, 'server.jar'), 'corrupted jar', 'utf8');
  await writeFile(path.join(rootDir, 'eula.txt'), 'eula=true\n', 'utf8');
  await writeFile(path.join(rootDir, 'mindcraft-server.json'), JSON.stringify({
    version: '1.21.11',
    port: 25565,
    memoryMb: 2048,
    desiredState: 'stopped',
    serverSha1: sha1Of('original jar'),
    javaMajor: 21,
  }), 'utf8');
  let spawnCount = 0;
  const manager = new managedServerModule.ManagedMinecraftServer({
    rootDir,
    runtimeCandidates: () => [{ path: 'java25', source: 'test' }],
    inspectJava: (candidate) => ({
      ...candidate,
      available: true,
      supported: true,
      version: '25.0.1',
      major: 25,
    }),
    spawnImpl: () => {
      spawnCount += 1;
      throw new Error('Java must not spawn for a corrupt jar');
    },
  });

  try {
    await assert.rejects(
      () => manager.start(),
      /integrity check[\s\S]*install.*again/i,
    );
    assert.equal(spawnCount, 0);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('Given an installed server version is newer than Mineflayer supports, when start is requested, then it is blocked before Java spawns', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-managed-incompatible-start-'));
  await writeFile(path.join(rootDir, 'server.jar'), '26.2 jar', 'utf8');
  await writeFile(path.join(rootDir, 'eula.txt'), 'eula=true\n', 'utf8');
  await writeFile(path.join(rootDir, 'mindcraft-server.json'), JSON.stringify({
    version: '26.2',
    port: 25565,
    memoryMb: 2048,
    desiredState: 'running',
    serverSha1: sha1Of('26.2 jar'),
    javaMajor: 25,
  }), 'utf8');
  let spawnCount = 0;
  const manager = new managedServerModule.ManagedMinecraftServer({
    rootDir,
    supportedMinecraftVersions: ['1.21.11'],
    latestSupportedVersion: '1.21.11',
    spawnImpl: () => {
      spawnCount += 1;
      throw new Error('Java must not spawn for an incompatible server');
    },
  });

  try {
    await assert.rejects(
      () => manager.start(),
      /Minecraft 26\.2.*not supported.*replace.*1\.21\.11/i,
    );
    assert.equal(spawnCount, 0);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('Given a newer incompatible world exists, when a compatible server replaces it, then the old world is preserved and a separate world is configured', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-managed-safe-replace-'));
  await mkdir(path.join(rootDir, 'world'), { recursive: true });
  await writeFile(path.join(rootDir, 'world', 'level.dat'), 'newer world marker', 'utf8');
  await writeFile(path.join(rootDir, 'server.jar'), '26.2 jar', 'utf8');
  await writeFile(path.join(rootDir, 'eula.txt'), 'eula=true\n', 'utf8');
  await writeFile(path.join(rootDir, 'mindcraft-server.json'), JSON.stringify({
    version: '26.2',
    port: 25565,
    memoryMb: 2048,
    desiredState: 'stopped',
    serverSha1: sha1Of('26.2 jar'),
    javaMajor: 25,
  }), 'utf8');
  const jar = Buffer.from('1.21.11 jar');
  const sha1 = sha1Of(jar);
  const fetchImpl = (url) => {
    if (url === 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json') {
      return {
        ok: true,
        json: () => ({
          latest: { release: '26.2' },
          versions: [{ id: '1.21.11', url: 'https://metadata.test/1.21.11.json' }],
        }),
      };
    }
    if (url === 'https://metadata.test/1.21.11.json') {
      return {
        ok: true,
        json: () => ({
          javaVersion: { majorVersion: 21 },
          downloads: {
            server: { url: 'https://downloads.test/server.jar', sha1, size: jar.length },
          },
        }),
      };
    }
    return { ok: true, arrayBuffer: () => jar };
  };
  const manager = new managedServerModule.ManagedMinecraftServer({
    rootDir,
    fetchImpl,
    supportedMinecraftVersions: ['1.21.11'],
    latestSupportedVersion: '1.21.11',
    runtimeCandidates: () => [{ path: 'java25', source: 'test' }],
    inspectJava: (candidate) => ({
      ...candidate,
      available: true,
      supported: true,
      version: '25.0.1',
      major: 25,
    }),
  });

  try {
    const status = await manager.install({ acceptEula: true, version: 'latest' });
    assert.equal(status.version, '1.21.11');
    assert.equal(await readFile(path.join(rootDir, 'world', 'level.dat'), 'utf8'), 'newer world marker');
    const properties = await readFile(path.join(rootDir, 'server.properties'), 'utf8');
    assert.match(properties, /^level-name=world-1\.21\.11$/m);
  } finally {
    await rm(rootDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 10 });
  }
});

test('Given persistence fails late in installation, when files are staged, then server.jar is not committed as an installed server', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-managed-partial-install-'));
  const jar = Buffer.from('verified server jar');
  const sha1 = createHash('sha1').update(jar).digest('hex');
  const fetchImpl = (url) => {
    if (url === 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json') {
      return {
        ok: true,
        json: () => ({
          latest: { release: '26.2' },
          versions: [{ id: '26.2', url: 'https://metadata.test/26.2.json' }],
        }),
      };
    }
    if (url === 'https://metadata.test/26.2.json') {
      return {
        ok: true,
        json: () => ({
          javaVersion: { majorVersion: 25 },
          downloads: {
            server: { url: 'https://downloads.test/server.jar', sha1, size: jar.length },
          },
        }),
      };
    }
    return { ok: true, arrayBuffer: () => jar };
  };
  const fileOps = {
    mkdir,
    rename,
    writeFile: (filePath, ...args) => {
      if (String(filePath).includes('mindcraft-server.json.tmp-')) {
        throw new Error('simulated config persistence failure');
      }
      return writeFile(filePath, ...args);
    },
  };
  const manager = new managedServerModule.ManagedMinecraftServer({
    rootDir,
    fetchImpl,
    fileOps,
    supportedMinecraftVersions: ['26.2'],
    latestSupportedVersion: '26.2',
    runtimeCandidates: () => [{ path: 'java25', source: 'test' }],
    inspectJava: (candidate) => ({
      ...candidate,
      available: true,
      supported: true,
      version: '25.0.1',
      major: 25,
    }),
  });

  try {
    await assert.rejects(
      () => manager.install({ acceptEula: true }),
      /simulated config persistence failure/i,
    );
    await assert.rejects(() => access(path.join(rootDir, 'server.jar')));
    assert.equal((await manager.getStatus()).installed, false);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('Given Mojang metadata never responds, when installation waits past its network deadline, then it fails with a bounded timeout', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-managed-fetch-timeout-'));
  const fetchImpl = (_url, options = {}) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  });
  const manager = new managedServerModule.ManagedMinecraftServer({
    rootDir,
    fetchImpl,
    fetchTimeoutMs: 15,
  });

  try {
    await assert.rejects(
      () => Promise.race([
        manager.install({ acceptEula: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('preflight probe expired')), 100)),
      ]),
      /download timed out/i,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('Given a server download declares an oversized body, when installation begins, then it is rejected before buffering the jar', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-managed-content-length-'));
  let bodyBuffered = false;
  const fetchImpl = (url) => {
    if (url === 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json') {
      return {
        ok: true,
        json: () => ({
          latest: { release: '26.2' },
          versions: [{ id: '26.2', url: 'https://metadata.test/26.2.json' }],
        }),
      };
    }
    if (url === 'https://metadata.test/26.2.json') {
      return {
        ok: true,
        json: () => ({
          javaVersion: { majorVersion: 25 },
          downloads: {
            server: {
              url: 'https://downloads.test/server.jar',
              sha1: 'a'.repeat(40),
              size: 1024,
            },
          },
        }),
      };
    }
    return {
      ok: true,
      headers: { get: () => String(151 * 1024 * 1024) },
      arrayBuffer: () => {
        bodyBuffered = true;
        return Buffer.from('too late');
      },
    };
  };
  const manager = new managedServerModule.ManagedMinecraftServer({
    rootDir,
    fetchImpl,
    supportedMinecraftVersions: ['26.2'],
    latestSupportedVersion: '26.2',
    runtimeCandidates: () => [{ path: 'java25', source: 'test' }],
    inspectJava: (candidate) => ({
      ...candidate,
      available: true,
      supported: true,
      version: '25.0.1',
      major: 25,
    }),
  });

  try {
    await assert.rejects(
      () => manager.install({ acceptEula: true }),
      /unexpectedly large/i,
    );
    assert.equal(bodyBuffered, false);
  } finally {
    await rm(rootDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 10 });
  }
});

test('Given an installed local server and current Java, when lifecycle controls are used, then start, console command, readiness, and graceful stop stay synchronized', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-managed-server-'));
  await writeFile(path.join(rootDir, 'server.jar'), 'jar', 'utf8');
  await writeFile(path.join(rootDir, 'eula.txt'), 'eula=true\n', 'utf8');
  await writeFile(path.join(rootDir, 'mindcraft-server.json'), JSON.stringify({
    version: '1.21.11',
    port: 25565,
    memoryMb: 2048,
    desiredState: 'stopped',
    serverSha1: sha1Of('jar'),
    bedrockBindAddress: '0.0.0.0',
  }), 'utf8');

  const child = new EventEmitter();
  child.pid = 4242;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => {
    queueMicrotask(() => child.emit('close', 1, null));
    return true;
  };
  const stdinWrites = [];
  child.stdin.on('data', (chunk) => {
    const value = String(chunk);
    stdinWrites.push(value);
    if (value === 'stop\n') queueMicrotask(() => child.emit('close', 0, null));
  });
  let spawnCall;
  const manager = new managedServerModule.ManagedMinecraftServer({
    rootDir,
    runtimeCandidates: () => [{ path: 'java25', source: 'test' }],
    inspectJava: (candidate) => ({
      ...candidate,
      available: true,
      supported: true,
      version: '25.0.1',
      major: 25,
    }),
    spawnImpl: (...args) => {
      spawnCall = args;
      return child;
    },
  });

  try {
    const starting = await manager.start();
    assert.equal(starting.phase, 'starting');
    assert.equal(starting.pid, 4242);
    assert.deepEqual(spawnCall[1], [
      '-Xms512M',
      '-Xmx2048M',
      '-jar',
      path.join(rootDir, 'server.jar'),
      'nogui',
    ]);
    assert.equal(spawnCall[2].cwd, rootDir);
    assert.equal(spawnCall[2].windowsHide, true);
    assert.match(
      await readFile(path.join(rootDir, 'server.properties'), 'utf8'),
      /^server-ip=0\.0\.0\.0$/m,
    );

    child.stdout.write('[Server thread/INFO]: Done (1.234s)! For help, type "help"\n');
    await waitFor(async () => (await manager.getStatus()).phase === 'running', 'server readiness');
    await manager.sendCommand('say hello from Mindcraft');
    assert.ok(stdinWrites.includes('say hello from Mindcraft\n'));
    const longCommand = `say ${'x'.repeat(512)}`;
    await manager.sendCommand(longCommand);
    assert.ok(stdinWrites.includes(`${longCommand}\n`));
    await manager.sendCommands(['time set day', 'weather clear'], { settleMs: 0 });
    assert.deepEqual(stdinWrites.slice(-2), ['time set day\n', 'weather clear\n']);
    assert.throws(() => manager.sendCommand(`say ${'x'.repeat(2049)}`), /1-2048 characters/i);
    assert.throws(() => manager.sendCommand('say first\nsay second'), /one line/i);
    await assert.rejects(
      () => manager.sendCommands(['say allowed', 'stop']),
      /dashboard Stop Server or Restart/i,
    );
    assert.equal(stdinWrites.includes('say allowed\n'), false);
    for (const blocked of ['stop', '/restart', 'minecraft:reload confirm']) {
      assert.throws(() => manager.sendCommand(blocked), /dashboard Stop Server or Restart/i);
      assert.equal(stdinWrites.includes(`${blocked}\n`), false);
    }

    const running = await manager.getStatus();
    assert.equal(running.phase, 'running');
    assert.match(running.logs.join('\n'), /Done \(1\.234s\)/);
    assert.match(running.logs.join('\n'), /\[command\] > say hello from Mindcraft/);

    const stopped = await manager.stop();
    assert.equal(stopped.phase, 'stopped');
    assert.ok(stdinWrites.includes('stop\n'));
    const config = JSON.parse(await readFile(path.join(rootDir, 'mindcraft-server.json'), 'utf8'));
    assert.equal(config.desiredState, 'stopped');
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('Given a managed cross-play server, when it starts, then Geyser receives an explicit local bind address and configured UDP port', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-managed-geyser-bind-'));
  await writeFile(path.join(rootDir, 'server.jar'), 'jar', 'utf8');
  await writeFile(path.join(rootDir, 'eula.txt'), 'eula=true\n', 'utf8');
  await writeFile(path.join(rootDir, 'server.properties'), 'server-ip=127.0.0.1\nserver-port=25565\n', 'utf8');
  await mkdir(path.join(rootDir, 'plugins', 'Geyser-Spigot'), { recursive: true });
  await writeFile(path.join(rootDir, 'plugins', 'Geyser-Spigot.jar'), 'geyser', 'utf8');
  await writeFile(path.join(rootDir, 'plugins', 'floodgate-spigot.jar'), 'floodgate', 'utf8');
  await writeFile(path.join(rootDir, 'plugins', 'ViaVersion.jar'), 'via', 'utf8');
  await writeFile(path.join(rootDir, 'plugins', 'Geyser-Spigot', 'config.yml'), [
    'bedrock:',
    '  address: 127.0.0.1',
    '  port: 19140',
    'remote:',
    '  auth-type: floodgate',
    '',
  ].join('\n'), 'utf8');
  await writeFile(path.join(rootDir, 'mindcraft-server.json'), JSON.stringify({
    version: '1.21.11',
    distribution: 'paper',
    crossplay: true,
    port: 25565,
    bedrockPort: 19140,
    memoryMb: 2048,
    desiredState: 'stopped',
    serverSha1: sha1Of('jar'),
    javaMajor: 21,
  }), 'utf8');
  const child = new EventEmitter();
  child.pid = 6060;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => true;
  child.stdin.on('data', (chunk) => {
    if (String(chunk).includes('stop')) queueMicrotask(() => child.emit('close', 0, null));
  });
  let spawnArgs;
  const manager = new managedServerModule.ManagedMinecraftServer({
    rootDir,
    platform: 'win32',
    runtimeCandidates: () => [{ path: 'C:\\java.exe', source: 'test' }],
    inspectJava: () => ({
      available: true,
      supported: true,
      path: 'C:\\java.exe',
      source: 'test',
      version: '25.0.1',
      major: 25,
    }),
    checkPortAvailable: () => true,
    spawnImpl: (_executable, args) => {
      spawnArgs = args;
      queueMicrotask(() => child.stdout.write(
        '[Geyser-Spigot] Started Geyser on 127.0.0.1:19140\nDone (1.0s)! For help, type "help"\n',
      ));
      return child;
    },
  });

  try {
    await manager.start();
    await manager.waitForReady(1000);
    assert.ok(spawnArgs.includes('-DgeyserUdpAddress=127.0.0.1'));
    assert.ok(spawnArgs.includes('-DgeyserUdpPort=19140'));
    assert.ok(spawnArgs.indexOf('-DgeyserUdpAddress=127.0.0.1') < spawnArgs.indexOf('-jar'));
    const status = await manager.getStatus();
    assert.equal(status.crossplay.bindAddress, '127.0.0.1');
    assert.equal(status.crossplay.access, 'this-computer');
    assert.equal(status.crossplay.runtimeReady, true);
    assert.equal(status.crossplay.installed, true);
    assert.equal(status.crossplay.configured, true);
    assert.equal(status.crossplay.listening, true);
    assert.equal(status.crossplay.joinable, true);
    assert.equal(status.crossplay.lanJoinable, false);
    assert.deepEqual(status.crossplay.lanAddresses, []);
    const stopped = await manager.stop();
    assert.equal(stopped.crossplay.runtimeReady, false);
  } finally {
    if (manager.child) await manager.stop();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('Given Geyser reports a different runtime UDP endpoint, when cross-play status is read, then listening and joinability remain false with endpoint evidence', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-managed-geyser-observed-endpoint-'));
  await writeFile(path.join(rootDir, 'server.jar'), 'jar', 'utf8');
  await writeFile(path.join(rootDir, 'eula.txt'), 'eula=true\n', 'utf8');
  await mkdir(path.join(rootDir, 'plugins', 'Geyser-Spigot'), { recursive: true });
  await writeFile(path.join(rootDir, 'plugins', 'Geyser-Spigot.jar'), 'geyser', 'utf8');
  await writeFile(path.join(rootDir, 'plugins', 'floodgate-spigot.jar'), 'floodgate', 'utf8');
  await writeFile(path.join(rootDir, 'plugins', 'ViaVersion.jar'), 'via', 'utf8');
  await writeFile(path.join(rootDir, 'plugins', 'Geyser-Spigot', 'config.yml'), [
    'bedrock:',
    '  address: 127.0.0.1',
    '  port: 19140',
    'remote:',
    '  auth-type: floodgate',
    '',
  ].join('\n'), 'utf8');
  await writeFile(path.join(rootDir, 'mindcraft-server.json'), JSON.stringify({
    version: '1.21.11',
    distribution: 'paper',
    crossplay: true,
    port: 25565,
    bedrockPort: 19140,
    bedrockBindAddress: '127.0.0.1',
    desiredState: 'running',
  }), 'utf8');
  const manager = new managedServerModule.ManagedMinecraftServer({
    rootDir,
    runtimeCandidates: () => [],
  });
  manager.phase = 'running';

  try {
    manager.appendLog('[Geyser-Spigot] Started Geyser on 0.0.0.0:19141\n');
    const status = await manager.getStatus();

    assert.deepEqual(status.crossplay.observedEndpoint, {
      bindAddress: '0.0.0.0',
      bedrockPort: 19141,
    });
    assert.equal(status.crossplay.endpointMatchesConfiguration, false);
    assert.equal(status.crossplay.runtimeObserved, true);
    assert.equal(status.crossplay.listening, false);
    assert.equal(status.crossplay.joinable, false);
    assert.equal(status.crossplay.state, 'endpoint-mismatch');
    assert.equal(status.crossplay.repairNeeded, false);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('Given current Geyser reports only its UDP port, when cross-play status is read, then the configured bind address completes the observed endpoint', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-managed-geyser-port-only-'));
  await writeFile(path.join(rootDir, 'server.jar'), 'jar', 'utf8');
  await writeFile(path.join(rootDir, 'eula.txt'), 'eula=true\n', 'utf8');
  await mkdir(path.join(rootDir, 'plugins', 'Geyser-Spigot'), { recursive: true });
  await writeFile(path.join(rootDir, 'plugins', 'Geyser-Spigot.jar'), 'geyser', 'utf8');
  await writeFile(path.join(rootDir, 'plugins', 'floodgate-spigot.jar'), 'floodgate', 'utf8');
  await writeFile(path.join(rootDir, 'plugins', 'ViaVersion.jar'), 'via', 'utf8');
  await writeFile(path.join(rootDir, 'plugins', 'Geyser-Spigot', 'config.yml'), [
    'bedrock:',
    '  address: 0.0.0.0',
    '  port: 19132',
    'java:',
    '  auth-type: floodgate',
    '',
  ].join('\n'), 'utf8');
  await writeFile(path.join(rootDir, 'mindcraft-server.json'), JSON.stringify({
    version: '1.21.11',
    distribution: 'paper',
    crossplay: true,
    port: 25565,
    bedrockPort: 19132,
    bedrockBindAddress: '0.0.0.0',
    desiredState: 'running',
  }), 'utf8');
  const manager = new managedServerModule.ManagedMinecraftServer({
    rootDir,
    runtimeCandidates: () => [],
  });
  manager.phase = 'running';

  try {
    manager.appendLog('[Geyser-Spigot] Started Geyser on UDP port 19132\n');
    const status = await manager.getStatus();

    assert.deepEqual(status.crossplay.observedEndpoint, {
      bindAddress: '0.0.0.0',
      bedrockPort: 19132,
    });
    assert.equal(status.crossplay.runtimeObserved, true);
    assert.equal(status.crossplay.listening, true);
    assert.equal(status.crossplay.joinable, true);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('Given the configured port is occupied, when the managed server starts, then it selects and persists the next free local port', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-managed-port-fallback-'));
  await writeFile(path.join(rootDir, 'server.jar'), 'jar', 'utf8');
  await writeFile(path.join(rootDir, 'eula.txt'), 'eula=true\n', 'utf8');
  await writeFile(path.join(rootDir, 'server.properties'), 'server-ip=127.0.0.1\nserver-port=25565\n', 'utf8');
  await writeFile(path.join(rootDir, 'mindcraft-server.json'), JSON.stringify({
    version: '1.21.11',
    port: 25565,
    memoryMb: 2048,
    desiredState: 'stopped',
    serverSha1: sha1Of('jar'),
    javaMajor: 21,
  }), 'utf8');
  const checkedPorts = [];
  const child = new EventEmitter();
  child.pid = 5353;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => true;
  child.stdin.on('data', (chunk) => {
    if (String(chunk) === 'stop\n') queueMicrotask(() => child.emit('close', 0, null));
  });
  const manager = new managedServerModule.ManagedMinecraftServer({
    rootDir,
    checkPortAvailable: (_host, port) => {
      checkedPorts.push(port);
      return port === 25566;
    },
    runtimeCandidates: () => [{ path: 'java25', source: 'test' }],
    inspectJava: (candidate) => ({
      ...candidate,
      available: true,
      supported: true,
      version: '25.0.1',
      major: 25,
    }),
    spawnImpl: () => child,
  });

  try {
    const status = await manager.start();
    assert.deepEqual(checkedPorts, [25565, 25566]);
    assert.equal(status.port, 25566);
    const config = JSON.parse(await readFile(path.join(rootDir, 'mindcraft-server.json'), 'utf8'));
    assert.equal(config.port, 25566);
    assert.match(await readFile(path.join(rootDir, 'server.properties'), 'utf8'), /^server-port=25566$/m);
  } finally {
    if (manager.child) await manager.stop();
    await rm(rootDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 10 });
  }
});

test('Given Java loses a selected port race, when Paper reports bind failure, then readiness retries on the next port and persists the working target', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-managed-bind-retry-'));
  await writeFile(path.join(rootDir, 'server.jar'), 'jar', 'utf8');
  await writeFile(path.join(rootDir, 'eula.txt'), 'eula=true\n', 'utf8');
  await writeFile(path.join(rootDir, 'server.properties'), 'server-ip=127.0.0.1\nserver-port=25565\n', 'utf8');
  await writeFile(path.join(rootDir, 'mindcraft-server.json'), JSON.stringify({
    version: '1.21.11',
    port: 25565,
    memoryMb: 2048,
    desiredState: 'stopped',
    serverSha1: sha1Of('jar'),
    javaMajor: 21,
  }), 'utf8');
  const children = [];
  const manager = new managedServerModule.ManagedMinecraftServer({
    rootDir,
    checkPortAvailable: () => true,
    runtimeCandidates: () => [{ path: 'java25', source: 'test' }],
    inspectJava: (candidate) => ({
      ...candidate,
      available: true,
      supported: true,
      version: '25.0.1',
      major: 25,
    }),
    spawnImpl: () => {
      const child = new EventEmitter();
      child.pid = 7000 + children.length;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => true;
      child.stdin.on('data', (chunk) => {
        if (String(chunk) === 'stop\n') queueMicrotask(() => child.emit('close', 0, null));
      });
      children.push(child);
      return child;
    },
  });

  try {
    await manager.start();
    const readiness = manager.waitForReady(2000);
    children[0].stdout.write('[Server thread/WARN]: **** FAILED TO BIND TO PORT!\n');
    children[0].emit('close', 0, null);
    await waitFor(() => children.length === 2, 'second Java start after bind failure');
    children[1].stdout.write('[Server thread/INFO]: Done (0.5s)! For help, type "help"\n');

    const ready = await readiness;

    assert.equal(ready.phase, 'running');
    assert.equal(ready.port, 25566);
    assert.match(await readFile(path.join(rootDir, 'server.properties'), 'utf8'), /^server-port=25566$/m);
  } finally {
    if (manager.child) await manager.stop();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('Given two start requests arrive together, when configuration persistence yields, then only one Java process is spawned', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-managed-concurrent-start-'));
  await writeFile(path.join(rootDir, 'server.jar'), 'jar', 'utf8');
  await writeFile(path.join(rootDir, 'eula.txt'), 'eula=true\n', 'utf8');
  await writeFile(path.join(rootDir, 'mindcraft-server.json'), JSON.stringify({
    version: '1.21.11',
    port: 25565,
    memoryMb: 2048,
    desiredState: 'stopped',
    serverSha1: sha1Of('jar'),
    javaMajor: 21,
  }), 'utf8');
  let spawnCount = 0;
  const children = [];
  const manager = new managedServerModule.ManagedMinecraftServer({
    rootDir,
    runtimeCandidates: () => [{ path: 'java25', source: 'test' }],
    inspectJava: (candidate) => ({
      ...candidate,
      available: true,
      supported: true,
      version: '25.0.1',
      major: 25,
    }),
    spawnImpl: () => {
      spawnCount += 1;
      const child = new EventEmitter();
      child.pid = 6000 + spawnCount;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => true;
      child.stdin.on('data', (chunk) => {
        if (String(chunk) === 'stop\n') queueMicrotask(() => child.emit('close', 0, null));
      });
      children.push(child);
      return child;
    },
  });
  const originalWriteConfig = manager.writeConfig.bind(manager);
  manager.writeConfig = async (...args) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return originalWriteConfig(...args);
  };

  try {
    await Promise.all([manager.start(), manager.start()]);
    assert.equal(spawnCount, 1);
    assert.equal(manager.child, children[0]);
  } finally {
    if (manager.child) await manager.stop();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('Given shutdown arrives while startup is persisting configuration, when the start resumes, then it does not orphan a Java process', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-managed-start-cancel-'));
  await writeFile(path.join(rootDir, 'server.jar'), 'jar', 'utf8');
  await writeFile(path.join(rootDir, 'eula.txt'), 'eula=true\n', 'utf8');
  await writeFile(path.join(rootDir, 'mindcraft-server.json'), JSON.stringify({
    version: '1.21.11',
    port: 25565,
    memoryMb: 2048,
    desiredState: 'stopped',
    serverSha1: sha1Of('jar'),
    javaMajor: 21,
  }), 'utf8');
  let releaseWrite;
  const writeBlocked = new Promise((resolve) => { releaseWrite = resolve; });
  let enteredWrite;
  const writeEntered = new Promise((resolve) => { enteredWrite = resolve; });
  let spawnCount = 0;
  const manager = new managedServerModule.ManagedMinecraftServer({
    rootDir,
    runtimeCandidates: () => [{ path: 'java25', source: 'test' }],
    inspectJava: (candidate) => ({
      ...candidate,
      available: true,
      supported: true,
      version: '25.0.1',
      major: 25,
    }),
    spawnImpl: () => {
      spawnCount += 1;
      throw new Error('spawn must not run after cancellation');
    },
  });
  const originalWriteConfig = manager.writeConfig.bind(manager);
  let blockNextWrite = true;
  manager.writeConfig = async (...args) => {
    if (blockNextWrite) {
      blockNextWrite = false;
      enteredWrite();
      await writeBlocked;
    }
    return originalWriteConfig(...args);
  };

  try {
    const starting = manager.start();
    await writeEntered;
    const stopping = manager.stop();
    releaseWrite();
    await Promise.all([starting, stopping]);

    assert.equal(spawnCount, 0);
    assert.equal((await manager.getStatus()).phase, 'stopped');
    const config = JSON.parse(await readFile(path.join(rootDir, 'mindcraft-server.json'), 'utf8'));
    assert.equal(config.desiredState, 'stopped');
  } finally {
    await rm(rootDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 10 });
  }
});

test('Given graceful stop receives no close event, when its deadline expires, then forced termination is bounded and reported', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-managed-forced-stop-'));
  await writeFile(path.join(rootDir, 'server.jar'), 'jar', 'utf8');
  await writeFile(path.join(rootDir, 'mindcraft-server.json'), JSON.stringify({
    desiredState: 'running',
    javaMajor: 25,
  }), 'utf8');
  const child = new EventEmitter();
  child.pid = 6262;
  child.stdin = new PassThrough();
  child.kill = () => {
    setTimeout(() => child.emit('close', 1, null), 20);
    return true;
  };
  const manager = new managedServerModule.ManagedMinecraftServer({
    rootDir,
    stopTimeoutMs: 5,
    killTimeoutMs: 5,
    terminateProcessTree: () => Promise.resolve({
      success: false,
      error: 'Managed test process tree did not exit after forced termination.',
    }),
  });
  manager.child = child;
  manager.phase = 'running';
  const startedAt = Date.now();

  try {
    await assert.rejects(
      () => manager.stop(),
      /did not exit after forced termination/i,
    );
    assert.ok(Date.now() - startedAt < 250, 'forced-stop failure must not hang the control request');
    assert.equal(manager.child, child);
    assert.equal(manager.phase, 'crashed');
  } finally {
    manager.child = null;
    child.emit('close', 1, null);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('Given a persisted running preference, when Mindcraft relaunches, then managed startup waits for actual server readiness', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-managed-relaunch-'));
  await writeFile(path.join(rootDir, 'server.jar'), 'jar', 'utf8');
  await writeFile(path.join(rootDir, 'eula.txt'), 'eula=true\n', 'utf8');
  await writeFile(path.join(rootDir, 'mindcraft-server.json'), JSON.stringify({
    version: '1.21.11',
    port: 25565,
    memoryMb: 2048,
    desiredState: 'running',
    serverSha1: sha1Of('jar'),
  }), 'utf8');
  const child = new EventEmitter();
  child.pid = 4343;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => true;
  const manager = new managedServerModule.ManagedMinecraftServer({
    rootDir,
    runtimeCandidates: () => [{ path: 'java25', source: 'test' }],
    inspectJava: (candidate) => ({
      ...candidate,
      available: true,
      supported: true,
      version: '25.0.1',
      major: 25,
    }),
    spawnImpl: () => child,
  });

  try {
    let settled = false;
    const startup = manager.startIfDesired({ timeoutMs: 1000 }).then((status) => {
      settled = true;
      return status;
    });
    await waitFor(() => manager.child === child, 'managed child spawn');
    assert.equal(settled, false);

    child.stdout.write('[Server thread/INFO]: Done (0.5s)! For help, type "help"\n');
    const ready = await startup;

    assert.equal(ready.phase, 'running');
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('Given Java starts but never becomes ready, when readiness times out, then the child is stopped and the running preference is cleared', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-managed-timeout-'));
  await writeFile(path.join(rootDir, 'server.jar'), 'jar', 'utf8');
  await writeFile(path.join(rootDir, 'eula.txt'), 'eula=true\n', 'utf8');
  await writeFile(path.join(rootDir, 'mindcraft-server.json'), JSON.stringify({
    version: '1.21.11',
    port: 25565,
    memoryMb: 2048,
    desiredState: 'stopped',
    serverSha1: sha1Of('jar'),
    javaMajor: 21,
  }), 'utf8');
  const child = new EventEmitter();
  child.pid = 5252;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => true;
  child.stdin.on('data', (chunk) => {
    if (String(chunk) === 'stop\n') queueMicrotask(() => child.emit('close', 0, null));
  });
  const manager = new managedServerModule.ManagedMinecraftServer({
    rootDir,
    runtimeCandidates: () => [{ path: 'java25', source: 'test' }],
    inspectJava: (candidate) => ({
      ...candidate,
      available: true,
      supported: true,
      version: '25.0.1',
      major: 25,
    }),
    spawnImpl: () => child,
  });

  try {
    await manager.start();
    await assert.rejects(() => manager.waitForReady(25), /did not become ready/i);
    const status = await manager.getStatus();
    assert.equal(status.phase, 'stopped');
    assert.equal(status.pid, null);
    const config = JSON.parse(await readFile(path.join(rootDir, 'mindcraft-server.json'), 'utf8'));
    assert.equal(config.desiredState, 'stopped');
  } finally {
    if (manager.child) await manager.stop();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('Given a launcher restart while the managed server is desired, when the control plane returns, then managed readiness is restored before agents launch', async () => {
  const launcherSource = await readFile(path.resolve('main.js'), 'utf8');
  const mindserverSource = await readFile(path.resolve('src/mindcraft/mindserver.js'), 'utf8');
  const stopScriptSource = await readFile(path.resolve('stop-mindcraft.bat'), 'utf8');

  assert.match(launcherSource, /getManagedMinecraftServer/);
  assert.match(mindserverSource, /managedMinecraftServer\.stop\(\{\s*preserveDesiredState:\s*true\s*\}\)/);
  const managedReady = launcherSource.indexOf('await managedMinecraftServer.startIfDesired');
  const profileLaunch = launcherSource.indexOf('for (const descriptor of profilePreflight.ready)');
  assert.ok(managedReady > 0);
  assert.ok(profileLaunch > managedReady);
  assert.match(launcherSource, /process\.once\('SIGINT'/);
  assert.match(launcherSource, /stopMinecraft:\s*\(\)\s*=>\s*managedMinecraftServer\.stop/);
  assert.match(mindserverSource, /socket\.on\('shutdown',[\s\S]*await stopEverything\(\)/);
  assert.match(mindserverSource, /launcher-restart\.json[\s\S]*resumeAgentNames/);
  assert.match(
    mindserverSource,
    /message\?\.type !== 'mindcraft-ready'[\s\S]*LAUNCHER_HANDOFF_TOKEN[\s\S]*restoreOriginalStack/,
  );
  assert.match(launcherSource, /readRestartResumePlan\(\)/);
  assert.match(
    launcherSource,
    /LAUNCHER_HANDOFF_TOKEN[\s\S]*process\.send\([\s\S]*type:\s*'mindcraft-ready'/,
  );
  assert.match(
    launcherSource,
    /mindServerReady\s*=\s*true[\s\S]*notifyLauncherReady[\s\S]*if\s*\(!mindServerReady\)[\s\S]*process\.exit\(1\)/,
  );
  assert.match(stopScriptSource, /managed-java[\\/]server\.jar/i);
});

test('Given a missing launcher entry, when restart is requested, then the working control plane stays online and reports failure', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-launcher-entry-'));
  const previousEntry = process.env.LAUNCHER_ENTRY;
  const originalExit = process.exit;
  const exitRequests = [];
  const stopCalls = [];
  process.env.LAUNCHER_ENTRY = path.join(rootDir, 'missing-main.js');
  process.exit = (code) => { exitRequests.push(code); };
  const server = await createMindServer(false, 0, 1, {
    managedMinecraftServer: {
      stop: (options) => {
        stopCalls.push(options);
        return Promise.resolve({ phase: 'stopped' });
      },
    },
  });

  try {
    const response = await requestJson(server, '/api/restart', { method: 'POST', body: {} });
    await new Promise((resolve) => setTimeout(resolve, 700));

    assert.equal(response.statusCode, 500);
    assert.equal(response.body.success, false);
    assert.match(response.body.error, /launcher entry/i);
    assert.equal(server.listening, true);
    assert.deepEqual(stopCalls, []);
    assert.deepEqual(exitRequests, []);
  } finally {
    process.exit = originalExit;
    if (previousEntry === undefined) delete process.env.LAUNCHER_ENTRY;
    else process.env.LAUNCHER_ENTRY = previousEntry;
    if (server.listening) await closeMindServer(server);
    else swarm.stop();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('Given a replacement launcher exits before MindServer is ready, when restart is requested, then the original listener is restored', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-launcher-handoff-'));
  const launcherEntry = path.join(rootDir, 'exits-before-ready.js');
  const previousEntry = process.env.LAUNCHER_ENTRY;
  const originalExit = process.exit;
  const exitRequests = [];
  const lifecycleCalls = [];
  await writeFile(launcherEntry, 'process.exit(1);\n', 'utf8');
  process.env.LAUNCHER_ENTRY = launcherEntry;
  process.exit = (code) => { exitRequests.push(code); };
  const server = await createMindServer(false, 0, 1, {
    managedMinecraftServer: {
      stop: (options) => {
        lifecycleCalls.push(['stop', options]);
        return Promise.resolve({ phase: 'stopped' });
      },
      startIfDesired: () => {
        lifecycleCalls.push(['startIfDesired']);
        return Promise.resolve({ phase: 'running' });
      },
    },
  });
  const originalPort = server.address().port;

  try {
    const response = await requestJson(server, '/api/restart', { method: 'POST', body: {} });
    await new Promise((resolve) => setTimeout(resolve, 700));

    assert.equal(response.statusCode, 502);
    assert.equal(response.body.success, false);
    assert.equal(response.body.recovered, true);
    assert.match(response.body.error, /before.*ready|handoff/i);
    assert.equal(server.listening, true);
    assert.equal(server.address().port, originalPort);
    assert.deepEqual(lifecycleCalls, [
      ['stop', { preserveDesiredState: true }],
      ['startIfDesired'],
    ]);
    assert.deepEqual(exitRequests, []);
  } finally {
    process.exit = originalExit;
    if (previousEntry === undefined) delete process.env.LAUNCHER_ENTRY;
    else process.env.LAUNCHER_ENTRY = previousEntry;
    if (server.listening) await closeMindServer(server);
    else swarm.stop();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('Given a Windows-style same-port replacement, when restart succeeds, then the response identifies the completed ownership handoff', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-launcher-same-port-'));
  const launcherEntry = path.join(rootDir, 'same-port-ready.js');
  const previousEntry = process.env.LAUNCHER_ENTRY;
  const previousPort = process.env.TEST_RESTART_PORT;
  const originalExit = process.exit;
  const exitRequests = [];
  process.exit = (code) => { exitRequests.push(code); };
  const server = await createMindServer(false, 0, 1, {
    managedMinecraftServer: {
      stop: () => Promise.resolve({ phase: 'stopped' }),
    },
  });
  const originalPort = server.address().port;
  process.env.TEST_RESTART_PORT = String(originalPort);
  await writeFile(launcherEntry, `
    import http from 'node:http';
    const replacement = http.createServer((_request, response) => response.end('ready'));
    replacement.listen(Number(process.env.TEST_RESTART_PORT), 'localhost', () => {
      process.send?.({
        type: 'mindcraft-ready',
        token: process.env.LAUNCHER_HANDOFF_TOKEN,
        port: replacement.address().port,
      });
    });
    setTimeout(() => process.exit(0), 2000).unref();
  `, 'utf8');
  process.env.LAUNCHER_ENTRY = launcherEntry;

  try {
    const response = await requestJson(server, '/api/restart', { method: 'POST', body: {} });
    await new Promise((resolve) => setTimeout(resolve, 400));

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.handoff, 'replacement-ready');
    assert.equal(response.body.previousPid, process.pid);
    assert.equal(Number.isInteger(response.body.replacementPid), true);
    assert.notEqual(response.body.replacementPid, process.pid);
    assert.equal(response.body.port, originalPort);
    assert.deepEqual(exitRequests, [0]);
    assert.equal(server.listening, false);
  } finally {
    process.exit = originalExit;
    if (previousEntry === undefined) delete process.env.LAUNCHER_ENTRY;
    else process.env.LAUNCHER_ENTRY = previousEntry;
    if (previousPort === undefined) delete process.env.TEST_RESTART_PORT;
    else process.env.TEST_RESTART_PORT = previousPort;
    if (server.listening) await closeMindServer(server);
    else swarm.stop();
    await rm(rootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('Given persisted scan configuration points elsewhere, when the real main launcher replaces MindServer, then it reclaims the active port with PID evidence', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-real-main-restart-'));
  const configPath = path.join(rootDir, 'launcher-config.json');
  const wrapperPath = path.join(rootDir, 'real-main-wrapper.mjs');
  const previousEntry = process.env.LAUNCHER_ENTRY;
  const previousConfigPath = process.env.LAUNCHER_CONFIG_PATH;
  const originalExit = process.exit;
  const exitRequests = [];
  let replacementPid = null;
  process.exit = (code) => { exitRequests.push(code); };
  const server = await createMindServer(false, 0, 1, {
    managedMinecraftServer: {
      stop: () => Promise.resolve({ phase: 'stopped' }),
    },
  });
  const originalPort = server.address().port;
  const persistedPort = originalPort === 24000 ? 24001 : 24000;
  await writeFile(configPath, JSON.stringify({
    mindserver_port: persistedPort,
    port_scan_start: persistedPort,
    port_scan_max: 5,
    auto_open_ui: false,
    auto_start: false,
    profiles: [],
  }), 'utf8');
  await writeFile(wrapperPath, `
    process.chdir(${JSON.stringify(rootDir)});
    const { runLauncher } = await import(${JSON.stringify(new URL('../../main.js', import.meta.url).href)});
    await runLauncher();
  `, 'utf8');
  process.env.LAUNCHER_ENTRY = wrapperPath;
  process.env.LAUNCHER_CONFIG_PATH = configPath;

  try {
    const response = await requestJson(server, '/api/restart', { method: 'POST', body: {} });
    replacementPid = response.body.replacementPid;

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.port, originalPort);
    assert.equal(response.body.previousPid, process.pid);
    assert.equal(Number.isInteger(replacementPid), true);
    assert.notEqual(replacementPid, process.pid);
    assert.equal(await requestStatus({ address: () => ({ port: originalPort }) }, '/api/health'), 200);
    await waitFor(() => exitRequests.length === 1, 'old launcher exit request');
    assert.deepEqual(exitRequests, [0]);
  } finally {
    process.exit = originalExit;
    if (previousEntry === undefined) delete process.env.LAUNCHER_ENTRY;
    else process.env.LAUNCHER_ENTRY = previousEntry;
    if (previousConfigPath === undefined) delete process.env.LAUNCHER_CONFIG_PATH;
    else process.env.LAUNCHER_CONFIG_PATH = previousConfigPath;
    if (Number.isInteger(replacementPid)) {
      try { process.kill(replacementPid, 'SIGTERM'); } catch { /* replacement already exited */ }
      await waitFor(() => {
        try {
          process.kill(replacementPid, 0);
          return false;
        } catch {
          return true;
        }
      }, 'replacement launcher exit', 5000);
    }
    if (server.listening) await closeMindServer(server);
    else swarm.stop();
    await rm(rootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('Given an owned local service and a failed replacement, when restart recovers, then ownership is stopped, transferred, and restored explicitly', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-local-service-handoff-'));
  const launcherEntry = path.join(rootDir, 'record-handoff-and-fail.mjs');
  const handoffRecord = path.join(rootDir, 'handoff.json');
  const previousEntry = process.env.LAUNCHER_ENTRY;
  const previousRecord = process.env.TEST_HANDOFF_RECORD;
  const originalExit = process.exit;
  const exitRequests = [];
  const calls = [];
  await writeFile(launcherEntry, `
    const { writeFileSync } = await import('node:fs');
    writeFileSync(process.env.TEST_HANDOFF_RECORD, JSON.stringify({
      port: process.env.LAUNCHER_HANDOFF_PORT,
      services: process.env.LAUNCHER_RESUME_LOCAL_SERVICES,
      pid: process.pid,
    }));
    process.exit(1);
  `, 'utf8');
  process.env.LAUNCHER_ENTRY = launcherEntry;
  process.env.TEST_HANDOFF_RECORD = handoffRecord;
  process.exit = (code) => { exitRequests.push(code); };
  const localServiceOwner = {
    stopAll: () => {
      calls.push('services-stop');
      return Promise.resolve({
        success: true,
        ollama: { owned: true, stopped: true, pid: 4141, error: null },
      });
    },
    startOllama: () => {
      calls.push('services-restore');
      return Promise.resolve({ models: [{ name: 'restored-model', kind: 'chat' }], owned: true, pid: 4242 });
    },
  };
  const managedMinecraftServer = {
    stop: () => {
      calls.push('minecraft-stop');
      return Promise.resolve({ phase: 'stopped' });
    },
    startIfDesired: () => {
      calls.push('minecraft-restore');
      return Promise.resolve({ phase: 'running' });
    },
  };
  const server = await createMindServer(false, 0, 1, {
    localServiceOwner,
    managedMinecraftServer,
  });
  const originalPort = server.address().port;

  try {
    const response = await requestJson(server, '/api/restart', { method: 'POST', body: {} });
    const handoff = JSON.parse(await readFile(handoffRecord, 'utf8'));

    assert.equal(response.statusCode, 502);
    assert.equal(response.body.success, false);
    assert.equal(response.body.recovered, true);
    assert.deepEqual(calls, [
      'services-stop',
      'minecraft-stop',
      'minecraft-restore',
      'services-restore',
    ]);
    assert.equal(handoff.port, String(originalPort));
    assert.equal(handoff.services, JSON.stringify(['ollama']));
    assert.equal(Number.isInteger(handoff.pid), true);
    assert.deepEqual(exitRequests, []);
  } finally {
    process.exit = originalExit;
    if (previousEntry === undefined) delete process.env.LAUNCHER_ENTRY;
    else process.env.LAUNCHER_ENTRY = previousEntry;
    if (previousRecord === undefined) delete process.env.TEST_HANDOFF_RECORD;
    else process.env.TEST_HANDOFF_RECORD = previousRecord;
    if (server.listening) await closeMindServer(server);
    else swarm.stop();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('Given a transferred local-service plan, when the replacement launcher resumes ownership, then only named supported services are restarted', async () => {
  const { resumeLauncherLocalServices } = await import('../../main.js');
  assert.equal(typeof resumeLauncherLocalServices, 'function');
  const calls = [];
  const result = await resumeLauncherLocalServices({
    startOllama: () => {
      calls.push('ollama');
      return Promise.resolve({ models: [{ name: 'local-model', kind: 'chat' }], owned: true, pid: 5151 });
    },
  }, {
    LAUNCHER_RESUME_LOCAL_SERVICES: JSON.stringify(['ollama', 'unknown', 'ollama']),
  });

  assert.deepEqual(calls, ['ollama']);
  assert.deepEqual(result, {
    resumed: ['ollama'],
    services: {
      ollama: { owned: true, pid: 5151 },
    },
  });
});

test('Given the browser disconnects during a verified handoff, when the replacement becomes ready, then the old process still exits', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mindcraft-launcher-abort-'));
  const launcherEntry = path.join(rootDir, 'ready-after-client-abort.js');
  const previousEntry = process.env.LAUNCHER_ENTRY;
  const originalExit = process.exit;
  const exitRequests = [];
  await writeFile(launcherEntry, `
    const ready = () => process.send?.({
      type: 'mindcraft-ready',
      token: process.env.LAUNCHER_HANDOFF_TOKEN,
      port: Number(process.env.LAUNCHER_HANDOFF_PORT),
    });
    setTimeout(ready, 150);
    process.on('disconnect', () => process.exit(0));
    setInterval(() => {}, 1000);
  `, 'utf8');
  process.env.LAUNCHER_ENTRY = launcherEntry;
  process.exit = (code) => { exitRequests.push(code); };
  const server = await createMindServer(false, 0, 1, {
    managedMinecraftServer: {
      stop: () => Promise.resolve({ phase: 'stopped' }),
    },
  });

  try {
    const request = http.request({
      hostname: 'localhost',
      port: server.address().port,
      path: '/api/restart',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': 2,
      },
    });
    request.on('error', () => {});
    request.end('{}');
    await new Promise((resolve) => setTimeout(resolve, 40));
    request.destroy();
    await new Promise((resolve) => setTimeout(resolve, 900));

    assert.deepEqual(exitRequests, [0]);
    assert.equal(server.listening, false);
  } finally {
    process.exit = originalExit;
    if (previousEntry === undefined) delete process.env.LAUNCHER_ENTRY;
    else process.env.LAUNCHER_ENTRY = previousEntry;
    if (server.listening) await closeMindServer(server);
    else swarm.stop();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('Given a managed server adapter, when dashboard lifecycle endpoints are called, then actions are routed and the bot target is wired to loopback', async () => {
  const configDirectory = await mkdtemp(path.join(tmpdir(), 'mindcraft-managed-api-'));
  const configPath = path.join(configDirectory, 'launcher-config.json');
  const originalConfigPath = process.env.LAUNCHER_CONFIG_PATH;
  process.env.LAUNCHER_CONFIG_PATH = configPath;
  const calls = [];
  const summary = {
    phase: 'running',
    installed: true,
    host: '127.0.0.1',
    port: 25565,
    java: { available: true, supported: true },
  };
  const manager = {
    getStatus: () => summary,
    install: (input) => { calls.push(['install', input]); return summary; },
    validateConfiguration: (input) => { calls.push(['validate', input]); return input; },
    configure: (input) => { calls.push(['configure', input]); return { ...summary, ...input }; },
    start: () => { calls.push(['start']); return summary; },
    waitForReady: () => { calls.push(['wait-ready']); return summary; },
    stop: (options) => {
      calls.push([options?.preserveDesiredState ? 'stop-preserve' : 'stop']);
      return { ...summary, phase: 'stopped' };
    },
    restart: () => { calls.push(['restart']); return summary; },
    repairCrossplay: () => { calls.push(['repair-crossplay']); return summary; },
    sendCommand: (command) => { calls.push(['command', command]); return summary; },
    sendCommands: (commands, options) => { calls.push(['commands', commands, options]); return summary; },
  };
  const server = await createMindServer(false, 0, 1, { managedMinecraftServer: manager });

  try {
    const installed = await requestJson(server, '/api/minecraft-server/install', {
      method: 'POST',
      body: { acceptEula: true, version: 'latest', memoryMb: 2048 },
    });
    const configured = await requestJson(server, '/api/minecraft-server/configure', {
      method: 'POST',
      body: { port: 25570, gameMode: 'creative' },
    });
    const started = await requestJson(server, '/api/minecraft-server/start', { method: 'POST', body: {} });
    const repaired = await requestJson(server, '/api/minecraft-server/repair-crossplay', { method: 'POST', body: {} });
    const restarted = await requestJson(server, '/api/minecraft-server/restart', { method: 'POST', body: {} });
    const commanded = await requestJson(server, '/api/minecraft-server/command', {
      method: 'POST',
      body: { command: 'say hello' },
    });
    const commandedBatch = await requestJson(server, '/api/minecraft-server/commands', {
      method: 'POST',
      body: { commands: ['time set day', 'weather clear'], settleMs: 150 },
    });
    const applied = await requestJson(server, '/api/minecraft-server/apply-settings', {
      method: 'POST',
      body: { maxPlayers: 12, bedrockBindAddress: '127.0.0.1' },
    });
    const stoppedEverything = await requestJson(server, '/api/system/stop', { method: 'POST', body: {} });
    const stopped = await requestJson(server, '/api/minecraft-server/stop', { method: 'POST', body: {} });

    for (const response of [installed, configured, started, repaired, restarted, commanded, commandedBatch, applied, stoppedEverything, stopped]) {
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.success, true);
    }
    assert.deepEqual(calls, [
      ['install', { acceptEula: true, version: 'latest', memoryMb: 2048 }],
      ['configure', { port: 25570, gameMode: 'creative' }],
      ['start'],
      ['wait-ready'],
      ['stop-preserve'],
      ['repair-crossplay'],
      ['start'],
      ['wait-ready'],
      ['restart'],
      ['wait-ready'],
      ['command', 'say hello'],
      ['commands', ['time set day', 'weather clear'], { settleMs: 150 }],
      ['validate', { maxPlayers: 12, bedrockBindAddress: '127.0.0.1' }],
      ['stop-preserve'],
      ['configure', { maxPlayers: 12, bedrockBindAddress: '127.0.0.1' }],
      ['start'],
      ['wait-ready'],
      ['stop'],
      ['stop'],
    ]);
    await assert.rejects(() => access(configPath), (error) => error?.code === 'ENOENT');
  } finally {
    await closeMindServer(server);
    if (originalConfigPath === undefined) delete process.env.LAUNCHER_CONFIG_PATH;
    else process.env.LAUNCHER_CONFIG_PATH = originalConfigPath;
    await rm(configDirectory, { recursive: true, force: true });
  }
});

test('Given an active squad during a Bedrock repair, when the managed stack cycles, then the exact group is quiesced before Java and resumed after readiness', async () => {
  const lifecycleCalls = [];
  const squadCalls = [];
  const summary = {
    phase: 'running',
    installed: true,
    host: '127.0.0.1',
    port: 25565,
    java: { available: true, supported: true },
  };
  const managedMinecraftServer = {
    getStatus: () => summary,
    stop: (options) => {
      lifecycleCalls.push(['stop', options]);
      return { ...summary, phase: 'stopped' };
    },
    repairCrossplay: () => {
      lifecycleCalls.push(['repair']);
      return { ...summary, phase: 'stopped' };
    },
    start: () => {
      lifecycleCalls.push(['start']);
      return summary;
    },
    waitForReady: () => {
      lifecycleCalls.push(['wait-ready']);
      return summary;
    },
  };
  const squad = {
    id: 'repair-squad',
    state: 'running',
    members: [
      { name: 'Repair_1', state: 'started', error: null },
      { name: 'Repair_2', state: 'started', error: null },
    ],
  };
  const botSquadManager = {
    get: (id) => (id === squad.id ? squad : null),
    list: () => [squad],
    stop: (id) => {
      squadCalls.push(['stop', id]);
      squad.state = 'stopped';
      return Promise.resolve({ success: true, squad });
    },
    waitForIdle: (id) => {
      squadCalls.push(['wait', id]);
      return Promise.resolve(squad);
    },
    start: (id) => {
      squadCalls.push(['start', id]);
      squad.state = 'starting';
      return { success: true, squad };
    },
  };
  const server = await createMindServer(false, 0, 1, {
    managedMinecraftServer,
    botSquadManager,
  });

  try {
    const response = await requestJson(server, '/api/minecraft-server/repair-crossplay', {
      method: 'POST',
      body: {},
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(squadCalls, [
      ['stop', 'repair-squad'],
      ['wait', 'repair-squad'],
      ['start', 'repair-squad'],
    ]);
    assert.deepEqual(lifecycleCalls, [
      ['stop', { preserveDesiredState: true }],
      ['repair'],
      ['start'],
      ['wait-ready'],
    ]);
  } finally {
    await closeMindServer(server);
  }
});

test('Given managed startup crashes, when the dashboard start endpoint reports the failure, then it includes current logs and phase for recovery', async () => {
  const summary = {
    phase: 'crashed',
    installed: true,
    host: '127.0.0.1',
    port: 25565,
    error: 'Unable to access jarfile',
    logs: ['Error: Unable to access jarfile'],
    java: { available: true, supported: true },
  };
  const manager = {
    getStatus: () => summary,
    start: () => {
      throw new managedServerModule.ManagedMinecraftServerError('Minecraft server failed to start.');
    },
  };
  const server = await createMindServer(false, 0, 1, { managedMinecraftServer: manager });

  try {
    const response = await requestJson(server, '/api/minecraft-server/start', {
      method: 'POST',
      body: {},
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.success, false);
    assert.equal(response.body.server.phase, 'crashed');
    assert.deepEqual(response.body.server.logs, summary.logs);
  } finally {
    await closeMindServer(server);
  }
});
