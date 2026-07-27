import { assertMindServerLoopbackOnly } from './launcher-config.js';

const SETTINGS_JSON_BOOLEAN_FIELDS = ['auto_open_ui', 'auto_start', 'load_memory', 'speak', 'chat_ingame', 'allow_insecure_coding', 'allow_vision', 'render_bot_view', 'narrate_behavior', 'chat_bot_messages', 'log_all_prompts', 'mindserver_host_public'];

export function normalizeProfilePaths(profiles = []) {
  if (!Array.isArray(profiles)) {
    return [];
  }
  return profiles
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function normalizeString(value, fallback) {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function normalizeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 65535 ? Math.trunc(parsed) : fallback;
}

function normalizeBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function parseSettingsJson(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error('Invalid SETTINGS_JSON: expected valid JSON object.', { cause: error });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid SETTINGS_JSON: expected valid JSON object.');
  }

  for (const field of SETTINGS_JSON_BOOLEAN_FIELDS) {
    if (Object.hasOwn(parsed, field)) parsed[field] = parseBoolean(`SETTINGS_JSON.${field}`, parsed[field]);
  }

  return parsed;
}

function parseBoolean(name, value, fallback) {
  if (value === undefined) return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`${name} must be "true" or "false".`);
}

function parseJsonEnvironment(name, raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid ${name}: expected valid JSON.`, { cause: error });
  }
}

function applyLauncherConfig(defaults, launcherConfig) {
  const agentDefaults = launcherConfig.agent_defaults || {};
  return {
    ...cloneSettings(defaults),
    mindserver_port: normalizeNumber(launcherConfig.mindserver_port, defaults.mindserver_port),
    auto_open_ui: normalizeBoolean(launcherConfig.auto_open_ui, defaults.auto_open_ui),
    auto_start: normalizeBoolean(launcherConfig.auto_start, defaults.auto_start ?? true),
    profiles: Array.isArray(launcherConfig.profiles)
      ? normalizeProfilePaths(launcherConfig.profiles)
      : normalizeProfilePaths(defaults.profiles),
    host: normalizeString(agentDefaults.host, defaults.host),
    port: normalizeNumber(agentDefaults.port, defaults.port),
    auth: normalizeString(agentDefaults.auth, defaults.auth),
    minecraft_version: normalizeString(agentDefaults.minecraft_version, defaults.minecraft_version),
    base_profile: normalizeString(agentDefaults.base_profile, defaults.base_profile),
    model: normalizeString(agentDefaults.model, defaults.model),
    init_message: normalizeString(agentDefaults.init_message, defaults.init_message),
    load_memory: normalizeBoolean(agentDefaults.load_memory, defaults.load_memory),
    speak: normalizeBoolean(agentDefaults.speak, defaults.speak),
    chat_ingame: normalizeBoolean(agentDefaults.chat_ingame, defaults.chat_ingame),
  };
}

export function resolveLauncherSettings({
  defaults,
  launcherConfig,
  settingsJson,
  environment = {},
  args = {},
}) {
  let resolved = applyLauncherConfig(defaults, launcherConfig);

  if (settingsJson !== undefined) {
    const settingsOverride = parseSettingsJson(settingsJson);
    assertMindServerLoopbackOnly(settingsOverride.mindserver_host_public);
    resolved = { ...resolved, ...settingsOverride };
  }

  if (environment.MINECRAFT_PORT !== undefined) {
    resolved.port = normalizeNumber(environment.MINECRAFT_PORT, resolved.port);
  }
  if (environment.MINDSERVER_PORT !== undefined) {
    resolved.mindserver_port = normalizeNumber(environment.MINDSERVER_PORT, resolved.mindserver_port);
  }
  if (environment.PROFILES !== undefined) {
    const profiles = parseJsonEnvironment('PROFILES', environment.PROFILES);
    if (Array.isArray(profiles)) resolved.profiles = normalizeProfilePaths(profiles);
  }
  resolved.allow_insecure_coding = parseBoolean(
    'INSECURE_CODING',
    environment.INSECURE_CODING,
    resolved.allow_insecure_coding,
  );
  if (environment.BLOCKED_ACTIONS !== undefined) {
    const blockedActions = parseJsonEnvironment('BLOCKED_ACTIONS', environment.BLOCKED_ACTIONS);
    if (Array.isArray(blockedActions)) resolved.blocked_actions = blockedActions;
  }
  if (environment.MAX_MESSAGES !== undefined) {
    resolved.max_messages = normalizeNumber(environment.MAX_MESSAGES, resolved.max_messages);
  }
  if (environment.NUM_EXAMPLES !== undefined) {
    resolved.num_examples = normalizeNumber(environment.NUM_EXAMPLES, resolved.num_examples);
  }
  resolved.log_all_prompts = parseBoolean(
    'LOG_ALL',
    environment.LOG_ALL,
    resolved.log_all_prompts,
  );

  // Singular --profile auto-converts to --profiles array.
  // When both are present --profiles takes precedence.
  if (args.profiles !== undefined || args.profile !== undefined) {
    resolved.profiles = normalizeProfilePaths(
      args.profiles !== undefined ? args.profiles : [args.profile],
    );
  }

  return resolved;
}

export function cloneSettings(source) {
  return JSON.parse(JSON.stringify(source));
}
