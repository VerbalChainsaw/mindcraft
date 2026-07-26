import { readFileSync, writeFileSync } from 'fs';

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
};

const DEFAULT_LAUNCHER_CONFIG = {
  mindserver_port: 8080,
  mindserver_host_public: false,
  auto_open_ui: true,
  auto_start: true,
  port_scan_start: 8080,
  port_scan_max: 20,
  profiles: ['./andy.json'],
  agent_defaults: DEFAULT_AGENT_DEFAULTS,
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

function asNonEmptyString(value, fallback) {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function asStringArray(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  const values = value
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return values.length > 0 ? values : fallback;
}

function sanitizeAgentDefaults(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_AGENT_DEFAULTS };
  }

  return {
    ...DEFAULT_AGENT_DEFAULTS,
    host: asNonEmptyString(value.host, DEFAULT_AGENT_DEFAULTS.host),
    port: asNumber(value.port, DEFAULT_AGENT_DEFAULTS.port),
    auth: asNonEmptyString(value.auth, DEFAULT_AGENT_DEFAULTS.auth),
    minecraft_version: asNonEmptyString(value.minecraft_version, DEFAULT_AGENT_DEFAULTS.minecraft_version),
    base_profile: asNonEmptyString(value.base_profile, DEFAULT_AGENT_DEFAULTS.base_profile),
    model: asNonEmptyString(value.model, DEFAULT_AGENT_DEFAULTS.model),
    init_message: asNonEmptyString(value.init_message, DEFAULT_AGENT_DEFAULTS.init_message),
    load_memory: asBoolean(value.load_memory, DEFAULT_AGENT_DEFAULTS.load_memory),
    speak: asBoolean(value.speak, DEFAULT_AGENT_DEFAULTS.speak),
    chat_ingame: asBoolean(value.chat_ingame, DEFAULT_AGENT_DEFAULTS.chat_ingame),
  };
}

function sanitizeLauncherConfig(raw = {}, baseSettings = {}) {
  const base = {
    ...DEFAULT_LAUNCHER_CONFIG,
    mindserver_port: baseSettings.mindserver_port || DEFAULT_LAUNCHER_CONFIG.mindserver_port,
    agent_defaults: {
      ...DEFAULT_AGENT_DEFAULTS,
      host: baseSettings.host || DEFAULT_AGENT_DEFAULTS.host,
      port: asNumber(baseSettings.port, DEFAULT_AGENT_DEFAULTS.port),
      auth: asNonEmptyString(baseSettings.auth, DEFAULT_AGENT_DEFAULTS.auth),
      minecraft_version: asNonEmptyString(baseSettings.minecraft_version, DEFAULT_AGENT_DEFAULTS.minecraft_version),
      base_profile: asNonEmptyString(baseSettings.base_profile, DEFAULT_AGENT_DEFAULTS.base_profile),
      init_message: asNonEmptyString(baseSettings.init_message, DEFAULT_AGENT_DEFAULTS.init_message),
      load_memory: asBoolean(baseSettings.load_memory, DEFAULT_AGENT_DEFAULTS.load_memory),
      speak: asBoolean(baseSettings.speak, DEFAULT_AGENT_DEFAULTS.speak),
      chat_ingame: asBoolean(baseSettings.chat_ingame, DEFAULT_AGENT_DEFAULTS.chat_ingame),
    },
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
    agent_defaults: sanitizeAgentDefaults(raw.agent_defaults),
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
  };
  const normalized = sanitizeLauncherConfig(merged, {});
  const path = resolveConfigPath(configPath);
  writeFileSync(path, JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

export function createLauncherConfigTemplate(baseSettings = {}) {
  const config = sanitizeLauncherConfig({}, baseSettings);
  return JSON.stringify(config, null, 2);
}

export { DEFAULT_LAUNCHER_CONFIG, DEFAULT_AGENT_DEFAULTS };
