import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import * as Launcher from '../../main.js';
import { loadLauncherConfig } from '../../src/mindcraft/launcher-config.js';
import { resolveLauncherSettings as resolveRuntimeConfig } from '../../src/mindcraft/runtime-config.js';

function createDefaultSettings() {
  return {
    mindserver_port: 7101,
    auto_open_ui: false,
    auto_start: false,
    profiles: ['./settings.json'],
    host: 'settings-host',
    port: 7105,
    auth: 'offline',
    minecraft_version: 'auto',
    base_profile: 'assistant',
    model: '',
    init_message: 'settings message',
    load_memory: false,
    speak: false,
    chat_ingame: true,
    allow_insecure_coding: true,
    blocked_actions: [],
    max_messages: 15,
    num_examples: 2,
    log_all_prompts: false,
  };
}

function createLauncherConfig(settings) {
  return {
    mindserver_port: settings.mindserver_port,
    auto_open_ui: settings.auto_open_ui,
    auto_start: settings.auto_start,
    port_scan_start: 8080,
    port_scan_max: 20,
    profiles: settings.profiles,
    agent_defaults: {
      host: settings.host,
      port: settings.port,
      auth: settings.auth,
      minecraft_version: settings.minecraft_version,
      base_profile: settings.base_profile,
      model: settings.model,
      init_message: settings.init_message,
      load_memory: settings.load_memory,
      speak: settings.speak,
      chat_ingame: settings.chat_ingame,
    },
  };
}

test('Given the runtime configuration module, when main re-exports its resolver, then both imports share the same function', () => {
  // Given / When / Then
  assert.strictEqual(resolveRuntimeConfig, Launcher.resolveLauncherSettings);
});

test('Given every supported layer, when runtime settings are resolved, then higher-precedence values win without mutating defaults', async () => {
  // Given
  const defaults = createDefaultSettings();
  const originalDefaults = JSON.parse(JSON.stringify(defaults));
  const configDirectory = await mkdtemp(path.join(tmpdir(), 'mindcraft-runtime-config-'));
  const configPath = path.join(configDirectory, 'launcher-config.json');
  await writeFile(configPath, JSON.stringify({
    mindserver_port: 7102,
    profiles: ['./launcher-config.json'],
    agent_defaults: {
      host: 'launcher-config-host',
      model: 'launcher-config-model',
    },
  }), 'utf8');
  const launcherConfig = loadLauncherConfig(defaults, configPath);

  try {
    // When
    const resolved = Launcher.resolveLauncherSettings({
      defaults,
      launcherConfig,
      settingsJson: JSON.stringify({
        mindserver_port: 7103,
        profiles: ['./settings-json.json'],
        allow_insecure_coding: true,
        model: 'settings-json-model',
      }),
      environment: {
        MINDSERVER_PORT: '7104',
        PROFILES: JSON.stringify(['./environment.json']),
        BLOCKED_ACTIONS: JSON.stringify(['!environment-action']),
        INSECURE_CODING: 'false',
      },
      args: {
        profiles: ['./cli.json'],
      },
    });

    // Then
    assert.equal(resolved.mindserver_port, 7104);
    assert.deepEqual(resolved.profiles, ['./cli.json']);
    assert.equal(resolved.host, 'launcher-config-host');
    assert.equal(resolved.model, 'settings-json-model');
    assert.equal(resolved.init_message, 'settings message');
    assert.deepEqual(resolved.blocked_actions, ['!environment-action']);
    assert.equal(resolved.allow_insecure_coding, false);
    assert.deepEqual(defaults, originalDefaults);
  } finally {
    await rm(configDirectory, { recursive: true, force: true });
  }
});

test('Given an explicit empty profiles array in launcher configuration, when runtime settings are resolved, then profiles remain empty', async () => {
  // Given
  const defaults = createDefaultSettings();
  const configDirectory = await mkdtemp(path.join(tmpdir(), 'mindcraft-runtime-config-'));
  const configPath = path.join(configDirectory, 'launcher-config.json');
  await writeFile(configPath, JSON.stringify({ profiles: [] }), 'utf8');

  try {
    const launcherConfig = loadLauncherConfig(defaults, configPath);

    // When
    const resolved = Launcher.resolveLauncherSettings({
      defaults,
      launcherConfig,
      environment: {},
      args: {},
    });

    // Then
    assert.deepEqual(launcherConfig.profiles, []);
    assert.deepEqual(resolved.profiles, []);
  } finally {
    await rm(configDirectory, { recursive: true, force: true });
  }
});

test('Given malformed SETTINGS_JSON, when runtime settings are resolved, then an actionable startup error is thrown', () => {
  // Given
  const defaults = createDefaultSettings();

  // When / Then
  assert.throws(
    () => Launcher.resolveLauncherSettings({
      defaults,
      launcherConfig: createLauncherConfig(defaults),
      settingsJson: '{',
      environment: {},
      args: {},
    }),
    /Invalid SETTINGS_JSON: expected valid JSON object/i,
  );
});

test('Given strict boolean strings in SETTINGS_JSON, when runtime settings are resolved, then they become booleans', () => {
  // Given
  const defaults = createDefaultSettings();

  // When
  const resolved = Launcher.resolveLauncherSettings({
    defaults,
    launcherConfig: createLauncherConfig(defaults),
    settingsJson: JSON.stringify({
      allow_insecure_coding: 'false',
      auto_start: 'false',
      log_all_prompts: 'true',
    }),
    environment: {},
    args: {},
  });

  // Then
  assert.equal(resolved.allow_insecure_coding, false);
  assert.equal(resolved.auto_start, false);
  assert.equal(resolved.log_all_prompts, true);
});

test('Given an invalid SETTINGS_JSON boolean, when runtime settings are resolved, then startup rejects it', () => {
  // Given
  const defaults = createDefaultSettings();

  // When / Then
  assert.throws(
    () => Launcher.resolveLauncherSettings({
      defaults,
      launcherConfig: createLauncherConfig(defaults),
      settingsJson: JSON.stringify({ auto_start: 'on' }),
      environment: {},
      args: {},
    }),
    /SETTINGS_JSON\.auto_start must be "true" or "false"/i,
  );
});

test('Given malformed PROFILES JSON, when runtime settings are resolved, then startup rejects it before CLI overrides', () => {
  // Given
  const defaults = createDefaultSettings();

  // When / Then
  assert.throws(
    () => Launcher.resolveLauncherSettings({
      defaults,
      launcherConfig: createLauncherConfig(defaults),
      environment: { PROFILES: '[' },
      args: { profiles: ['./cli.json'] },
    }),
    /Invalid PROFILES: expected valid JSON/i,
  );
});

test('Given malformed BLOCKED_ACTIONS JSON, when runtime settings are resolved, then startup rejects it', () => {
  // Given
  const defaults = createDefaultSettings();

  // When / Then
  assert.throws(
    () => Launcher.resolveLauncherSettings({
      defaults,
      launcherConfig: createLauncherConfig(defaults),
      environment: { BLOCKED_ACTIONS: '{' },
      args: {},
    }),
    /Invalid BLOCKED_ACTIONS: expected valid JSON/i,
  );
});

test('Given a singular --profile CLI flag, when runtime settings are resolved, then it auto-converts to the profiles array', () => {
  // Given
  const defaults = createDefaultSettings();

  // When
  const resolved = Launcher.resolveLauncherSettings({
    defaults,
    launcherConfig: createLauncherConfig(defaults),
    environment: {},
    args: { profile: './my-profile.json' },
  });

  // Then
  assert.deepEqual(resolved.profiles, ['./my-profile.json']);
});

test('Given both --profile and --profiles CLI flags, when runtime settings are resolved, then --profiles takes precedence', () => {
  // Given
  const defaults = createDefaultSettings();

  // When
  const resolved = Launcher.resolveLauncherSettings({
    defaults,
    launcherConfig: createLauncherConfig(defaults),
    environment: {},
    args: { profile: './ignored.json', profiles: ['./cli-profiles.json'] },
  });

  // Then
  assert.deepEqual(resolved.profiles, ['./cli-profiles.json']);
});

test('Given an invalid boolean environment value, when runtime settings are resolved, then startup rejects it instead of enabling coding', () => {
  // Given
  const defaults = createDefaultSettings();

  // When / Then
  assert.throws(
    () => Launcher.resolveLauncherSettings({
      defaults,
      launcherConfig: createLauncherConfig(defaults),
      environment: { INSECURE_CODING: '1' },
      args: {},
    }),
    /INSECURE_CODING must be "true" or "false"/i,
  );
});
