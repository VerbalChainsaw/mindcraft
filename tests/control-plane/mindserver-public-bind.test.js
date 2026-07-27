import assert from 'node:assert/strict';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { tmpdir } from 'node:os';

import { runLauncher } from '../../main.js';
import { createMindServer } from '../../src/mindcraft/mindserver.js';
import {
  MindServerPublicBindError,
  loadLauncherConfig,
  writeLauncherConfig,
} from '../../src/mindcraft/launcher-config.js';
import './agent-finalization.test.js';
import './dashboard-lifecycle.test.js';
import './health-readiness.test.js';
import './mindserver-readiness.test.js';
import './openai-compatible.test.js';
import './agent-lifecycle.test.js';
import './runtime-config.test.js';

test('Given no public-bind setting, when launcher configuration is loaded, then MindServer remains loopback-only', async () => {
  // Given
  const configDirectory = await mkdtemp(path.join(tmpdir(), 'mindcraft-control-plane-'));
  const configPath = path.join(configDirectory, 'launcher-config.json');

  try {
    // When
    const config = loadLauncherConfig({}, configPath);

    // Then
    assert.equal(config.mindserver_host_public, false);
  } finally {
    await rm(configDirectory, { recursive: true, force: true });
  }
});

test('Given a public MindServer configuration, when it is loaded, then startup is rejected with loopback guidance', async () => {
  // Given
  const configDirectory = await mkdtemp(path.join(tmpdir(), 'mindcraft-control-plane-'));
  const configPath = path.join(configDirectory, 'launcher-config.json');
  await writeFile(configPath, JSON.stringify({ mindserver_host_public: true }), 'utf8');

  try {
    // When / Then
    assert.throws(
      () => loadLauncherConfig({}, configPath),
      /mindserver_host_public: true is not supported.*set mindserver_host_public to false/i,
    );
  } finally {
    await rm(configDirectory, { recursive: true, force: true });
  }
});

test('Given a launcher configuration update that requests public binding, when it is saved, then the file is not written', async () => {
  // Given
  const configDirectory = await mkdtemp(path.join(tmpdir(), 'mindcraft-control-plane-'));
  const configPath = path.join(configDirectory, 'launcher-config.json');

  try {
    // When / Then
    assert.throws(
      () => writeLauncherConfig({ mindserver_host_public: true }, configPath),
      MindServerPublicBindError,
    );
    await assert.rejects(() => access(configPath));
  } finally {
    await rm(configDirectory, { recursive: true, force: true });
  }
});

test('Given a direct MindServer creation request for public binding, when it is created, then it rejects before listening', () => {
  // Given / When / Then
  assert.throws(
    () => createMindServer(true),
    MindServerPublicBindError,
  );
});

test('Given a launcher configuration that requests public binding, when the main entrypoint starts, then it rejects before opening a server', async () => {
  // Given
  const configDirectory = await mkdtemp(path.join(tmpdir(), 'mindcraft-control-plane-'));
  const configPath = path.join(configDirectory, 'launcher-config.json');
  await writeFile(configPath, JSON.stringify({ mindserver_host_public: true }), 'utf8');
  const originalConfigPath = process.env.LAUNCHER_CONFIG_PATH;
  process.env.LAUNCHER_CONFIG_PATH = configPath;

  try {
    // When / Then
    await assert.rejects(
      () => runLauncher(),
      /mindserver_host_public: true is not supported.*set mindserver_host_public to false/i,
    );
  } finally {
    if (originalConfigPath === undefined) delete process.env.LAUNCHER_CONFIG_PATH;
    else process.env.LAUNCHER_CONFIG_PATH = originalConfigPath;
    await rm(configDirectory, { recursive: true, force: true });
  }
});

test('Given a SETTINGS_JSON override that requests public binding, when the main entrypoint starts, then it rejects before opening a server', async () => {
  // Given
  const configDirectory = await mkdtemp(path.join(tmpdir(), 'mindcraft-control-plane-'));
  const configPath = path.join(configDirectory, 'launcher-config.json');
  await writeFile(configPath, '{}', 'utf8');
  const originalConfigPath = process.env.LAUNCHER_CONFIG_PATH;
  const originalSettingsJson = process.env.SETTINGS_JSON;
  process.env.LAUNCHER_CONFIG_PATH = configPath;
  process.env.SETTINGS_JSON = JSON.stringify({ mindserver_host_public: true });

  try {
    // When / Then
    await assert.rejects(
      () => runLauncher(),
      /mindserver_host_public: true is not supported.*set mindserver_host_public to false/i,
    );
  } finally {
    if (originalConfigPath === undefined) delete process.env.LAUNCHER_CONFIG_PATH;
    else process.env.LAUNCHER_CONFIG_PATH = originalConfigPath;
    if (originalSettingsJson === undefined) delete process.env.SETTINGS_JSON;
    else process.env.SETTINGS_JSON = originalSettingsJson;
    await rm(configDirectory, { recursive: true, force: true });
  }
});
