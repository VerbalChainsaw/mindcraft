import { readFileSync } from 'fs';
import { writeJsonAtomicSync } from '../utils/atomic-file.js';
import { LOCAL_QUICKSTART_PROFILE } from './local-quickstart.js';

const CONFIG_FILENAME = 'launcher-config.json';

const DEFAULT_AGENT_DEFAULTS = {
  host: '127.0.0.1',
  port: 55916,
  auth: 'offline',
  minecraft_version: 'auto',
  base_profile: 'assistant',
  model: '',
  init_message: 'Respond with hello world and your name',
  load_memory: false,
  speak: false,
  chat_ingame: true,
  allow_vision: false,
  render_bot_view: false,
};

const DEFAULT_AGENT_TELEMETRY = {
  intervalMs: 1000,
  requestTimeoutMs: 1200,
  maxConcurrent: 6,
  heartbeatMs: 3000,
  failureBackoffMs: 1500,
  maxFailureBackoffMs: 15000,
};

const DEFAULT_LAUNCHER_CONFIG = {
  mindserver_port: 8080,
  mindserver_host_public: false,
  auto_open_ui: true,
  auto_start: true,
  port_scan_start: 8080,
  port_scan_max: 20,
  profiles: [LOCAL_QUICKSTART_PROFILE],
  agent_defaults: DEFAULT_AGENT_DEFAULTS,
  telemetry: DEFAULT_AGENT_TELEMETRY,
};

function resolveConfigPath(configPath) {
  if (configPath && configPath.trim && configPath.trim().length) {
    return configPath;
  }
  if (process.env.LAUNCHER_CONFIG_PATH) {
    return process.env.LAUNCHER_CONFIG_PATH;
  }
  return CONFIG_FILENAME;
}

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 65535 ? Math.trunc(parsed) : fallback;
}

function asBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return fallback;
}

function asBoundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.trunc(parsed)))
    : fallback;
}

export class MindServerPublicBindError extends Error {}

export function assertMindServerLoopbackOnly(hostPublic) {
  if (asBoolean(hostPublic, false)) {
    throw new MindServerPublicBindError('mindserver_host_public: true is not supported because MindServer has no authentication. Keep MindServer loopback-only: set mindserver_host_public to false.');
  }
}

function asNonEmptyString(value, fallback) {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function asStringArray(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  if (value.length === 0) return [];
  const values = value
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return values.length > 0 ? values : fallback;
}

function sanitizeAgentDefaults(value, fallback = DEFAULT_AGENT_DEFAULTS) {
  const base = {
    ...DEFAULT_AGENT_DEFAULTS,
    ...fallback,
  };

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...base };
  }

  return {
    ...base,
    host: asNonEmptyString(value.host, base.host),
    port: asNumber(value.port, base.port),
    auth: asNonEmptyString(value.auth, base.auth),
    minecraft_version: asNonEmptyString(value.minecraft_version, base.minecraft_version),
    base_profile: asNonEmptyString(value.base_profile, base.base_profile),
    model: asNonEmptyString(value.model, base.model),
    init_message: asNonEmptyString(value.init_message, base.init_message),
    load_memory: asBoolean(value.load_memory, base.load_memory),
    speak: asBoolean(value.speak, base.speak),
    chat_ingame: asBoolean(value.chat_ingame, base.chat_ingame),
    allow_vision: asBoolean(value.allow_vision, base.allow_vision),
    render_bot_view: asBoolean(value.render_bot_view, base.render_bot_view),
  };
}

function sanitizeTelemetry(value, fallback = DEFAULT_AGENT_TELEMETRY) {
  const base = {
    ...DEFAULT_AGENT_TELEMETRY,
    ...(fallback && typeof fallback === 'object' && !Array.isArray(fallback) ? fallback : {}),
  };
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const failureBackoffMs = asBoundedNumber(
    input.failureBackoffMs,
    base.failureBackoffMs,
    250,
    120000,
  );
  return {
    intervalMs: asBoundedNumber(input.intervalMs, base.intervalMs, 250, 30000),
    requestTimeoutMs: asBoundedNumber(input.requestTimeoutMs, base.requestTimeoutMs, 250, 30000),
    maxConcurrent: asBoundedNumber(input.maxConcurrent, base.maxConcurrent, 1, 12),
    heartbeatMs: asBoundedNumber(input.heartbeatMs, base.heartbeatMs, 250, 30000),
    failureBackoffMs,
    maxFailureBackoffMs: asBoundedNumber(
      input.maxFailureBackoffMs,
      base.maxFailureBackoffMs,
      failureBackoffMs,
      120000,
    ),
  };
}

function sanitizeLauncherConfig(raw = {}, baseSettings = {}) {
  assertMindServerLoopbackOnly(raw.mindserver_host_public);

  const baseAgentDefaults = {
    ...DEFAULT_AGENT_DEFAULTS,
    host: asNonEmptyString(baseSettings.host, DEFAULT_AGENT_DEFAULTS.host),
    port: baseSettings.port ?? DEFAULT_AGENT_DEFAULTS.port,
    auth: asNonEmptyString(baseSettings.auth, DEFAULT_AGENT_DEFAULTS.auth),
    minecraft_version: asNonEmptyString(baseSettings.minecraft_version, DEFAULT_AGENT_DEFAULTS.minecraft_version),
    base_profile: asNonEmptyString(baseSettings.base_profile, DEFAULT_AGENT_DEFAULTS.base_profile),
    model: asNonEmptyString(baseSettings.model, DEFAULT_AGENT_DEFAULTS.model),
    init_message: asNonEmptyString(baseSettings.init_message, DEFAULT_AGENT_DEFAULTS.init_message),
    load_memory: asBoolean(baseSettings.load_memory, DEFAULT_AGENT_DEFAULTS.load_memory),
    speak: asBoolean(baseSettings.speak, DEFAULT_AGENT_DEFAULTS.speak),
    chat_ingame: asBoolean(baseSettings.chat_ingame, DEFAULT_AGENT_DEFAULTS.chat_ingame),
    allow_vision: asBoolean(baseSettings.allow_vision, DEFAULT_AGENT_DEFAULTS.allow_vision),
    render_bot_view: asBoolean(baseSettings.render_bot_view, DEFAULT_AGENT_DEFAULTS.render_bot_view),
  };
  const base = {
    ...DEFAULT_LAUNCHER_CONFIG,
    mindserver_port: baseSettings.mindserver_port || DEFAULT_LAUNCHER_CONFIG.mindserver_port,
    auto_open_ui: asBoolean(baseSettings.auto_open_ui, DEFAULT_LAUNCHER_CONFIG.auto_open_ui),
    auto_start: asBoolean(baseSettings.auto_start, DEFAULT_LAUNCHER_CONFIG.auto_start),
    profiles: asStringArray(baseSettings.profiles, DEFAULT_LAUNCHER_CONFIG.profiles),
    agent_defaults: baseAgentDefaults,
    telemetry: sanitizeTelemetry(baseSettings.telemetry, DEFAULT_AGENT_TELEMETRY),
  };

  return {
    ...base,
    mindserver_port: asNumber(raw.mindserver_port, base.mindserver_port),
    mindserver_host_public: asBoolean(raw.mindserver_host_public, base.mindserver_host_public),
    auto_open_ui: asBoolean(raw.auto_open_ui, base.auto_open_ui),
    auto_start: asBoolean(raw.auto_start, base.auto_start),
    port_scan_start: asNumber(raw.port_scan_start, base.port_scan_start),
    port_scan_max: Math.max(1, Math.min(80, asNumber(raw.port_scan_max, base.port_scan_max))),
    profiles: asStringArray(raw.profiles, base.profiles),
    agent_defaults: sanitizeAgentDefaults(raw.agent_defaults, base.agent_defaults),
    telemetry: sanitizeTelemetry(raw.telemetry, base.telemetry),
  };
}

export function getLauncherConfigPath(configPath) {
  return resolveConfigPath(configPath);
}

export function loadLauncherConfig(baseSettings = {}, configPath) {
  const path = resolveConfigPath(configPath);
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    return sanitizeLauncherConfig(raw, baseSettings);
  } catch (err) {
    if (err instanceof MindServerPublicBindError) {
      throw err;
    }
    if (err.code !== 'ENOENT') {
      console.warn('Invalid launcher-config.json. Falling back to defaults.');
      console.warn(err.message);
    }
    return sanitizeLauncherConfig({}, baseSettings);
  }
}

export function writeLauncherConfig(update, configPath) {
  const existing = loadLauncherConfig({}, configPath);
  const incoming = update || {};
  const merged = {
    ...existing,
    ...incoming,
    agent_defaults: {
      ...existing.agent_defaults,
      ...(incoming?.agent_defaults || {}),
    },
    telemetry: {
      ...existing.telemetry,
      ...(incoming?.telemetry || {}),
    },
  };
  const normalized = sanitizeLauncherConfig(merged, {});
  const path = resolveConfigPath(configPath);
  writeJsonAtomicSync(path, normalized);
  return normalized;
}

export function createLauncherConfigTemplate(baseSettings = {}) {
  const config = sanitizeLauncherConfig({}, baseSettings);
  return JSON.stringify(config, null, 2);
}

export { DEFAULT_LAUNCHER_CONFIG, DEFAULT_AGENT_DEFAULTS, DEFAULT_AGENT_TELEMETRY };
