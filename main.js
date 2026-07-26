import * as Mindcraft from './src/mindcraft/mindcraft.js';
import settings from './settings.js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import net from 'net';
import { loadLauncherConfig } from './src/mindcraft/launcher-config.js';

function parseArguments() {
  return yargs(hideBin(process.argv))
    .option('profiles', {
      type: 'array',
      describe: 'List of agent profile paths'
    })
    .option('task_path', {
      type: 'string',
      describe: 'Path to task file to execute'
    })
    .option('task_id', {
      type: 'string',
      describe: 'Task ID to execute'
    })
    .help()
    .alias('help', 'h')
    .parse();
}

function safeParseJson(raw, fallback = undefined) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalizeProfilePaths(profiles = []) {
  if (!Array.isArray(profiles)) {
    return [];
  }
  return profiles
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeString(value, fallback) {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function normalizeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 65535 ? Math.trunc(parsed) : fallback;
}

function normalizeBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return fallback;
}

function isPortBusy(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', (error) => {
      resolve(error && error.code === 'EADDRINUSE');
    });
    srv.once('listening', () => {
      srv.close(() => resolve(false));
    });
    srv.listen(port, host);
  });
}

// Check both IPv4 and IPv6 loopback families. The mindserver binds to
// `localhost`, which Node may resolve to ::1 (IPv6); a pure IPv4 probe would
// miss an IPv6-bound listener and report a false "free" port.
async function isPortBusyAnyFamily(port) {
  const [v4, v6] = await Promise.all([
    isPortBusy(port, '127.0.0.1'),
    isPortBusy(port, '::1').catch(() => false),
  ]);
  return v4 || v6;
}

async function resolveFreePort(startPort, attempts, host = '127.0.0.1') {
  const start = normalizeNumber(startPort, 8080);
  const total = normalizeNumber(attempts, 20);
  for (let index = 0; index < total; index += 1) {
    const candidate = start + index;
    const busy = await isPortBusyAnyFamily(candidate);
    if (!busy) {
      return candidate;
    }
  }
  throw new Error(`No free port available in range ${start}-${start + total - 1}`);
}

function readTask(settingsObj, taskPath, taskId) {
  if (!taskPath) return;

  if (!existsSync(taskPath)) {
    throw new Error(`task_path does not exist: ${taskPath}`);
  }

  const tasks = safeParseJson(readFileSync(taskPath, 'utf8'), null);
  if (!tasks) {
    throw new Error(`Cannot parse task file: ${taskPath}`);
  }

  if (!taskId) {
    throw new Error('task_id is required when task_path is provided');
  }

  if (!tasks[taskId]) {
    throw new Error(`Task '${taskId}' not found in ${taskPath}`);
  }

  settingsObj.task = tasks[taskId];
  settingsObj.task.task_id = taskId;
  settingsObj.task_path = taskPath;
}

function cloneSettings(source) {
  return JSON.parse(JSON.stringify(source));
}

async function launchProfile(profilePath, baseSettings) {
  const resolvedProfilePath = path.resolve(process.cwd(), profilePath);
  const profileJson = safeParseJson(readFileSync(resolvedProfilePath, 'utf8'), null);
  if (!profileJson) {
    console.error(`[launcher] Skipping profile. Cannot parse JSON: ${profilePath}`);
    return;
  }

  const agentSettings = {
    ...cloneSettings(baseSettings),
    profile: profileJson,
  };

  if (!agentSettings.profile.model && agentSettings.model) {
    agentSettings.profile.model = agentSettings.model;
  }
  delete agentSettings.auto_start;

  if (!agentSettings.profile?.name) {
    console.error(`[launcher] Profile missing name property: ${profilePath}`);
    return;
  }

  const response = await Mindcraft.createAgent(agentSettings);
  if (!response?.success) {
    console.error(`[launcher] Failed to start ${agentSettings.profile.name}:`, response?.error || 'unknown');
  }
}

(async () => {
  const args = parseArguments();
  const launcherConfig = loadLauncherConfig(settings);

  if (args.profiles) {
    settings.profiles = normalizeProfilePaths(args.profiles);
  } else if (Array.isArray(launcherConfig.profiles) && launcherConfig.profiles.length > 0) {
    settings.profiles = normalizeProfilePaths(launcherConfig.profiles);
  }


  if (args.task_path) {
    readTask(settings, normalizeString(args.task_path, ''), normalizeString(args.task_id, ''));
  }

  if (process.env.SETTINGS_JSON) {
    try {
      Object.assign(settings, safeParseJson(process.env.SETTINGS_JSON, {}));
    } catch (err) {
      console.error('Failed to parse SETTINGS_JSON:', err.message);
    }
  }

  settings.mindserver_port = normalizeNumber(launcherConfig.mindserver_port, settings.mindserver_port);
  settings.auto_open_ui = normalizeBoolean(launcherConfig.auto_open_ui, settings.auto_open_ui);
  settings.auto_start = normalizeBoolean(launcherConfig.auto_start, settings.auto_start ?? true);

  settings.host = normalizeString(launcherConfig.agent_defaults.host, settings.host);
  settings.port = normalizeNumber(launcherConfig.agent_defaults.port, settings.port);
  settings.auth = normalizeString(launcherConfig.agent_defaults.auth, settings.auth);
  settings.minecraft_version = normalizeString(launcherConfig.agent_defaults.minecraft_version, settings.minecraft_version);
  settings.base_profile = normalizeString(launcherConfig.agent_defaults.base_profile, settings.base_profile);
  settings.model = normalizeString(launcherConfig.agent_defaults.model, settings.model);
  settings.init_message = normalizeString(launcherConfig.agent_defaults.init_message, settings.init_message);
  settings.load_memory = normalizeBoolean(launcherConfig.agent_defaults.load_memory, settings.load_memory);
  settings.speak = normalizeBoolean(launcherConfig.agent_defaults.speak, settings.speak);
  settings.chat_ingame = normalizeBoolean(launcherConfig.agent_defaults.chat_ingame, settings.chat_ingame);

  // Environment override layer
  if (process.env.MINECRAFT_PORT) {
    settings.port = normalizeNumber(process.env.MINECRAFT_PORT, settings.port);
  }

  if (process.env.MINDSERVER_PORT) {
    settings.mindserver_port = normalizeNumber(process.env.MINDSERVER_PORT, settings.mindserver_port);
  }

  if (process.env.PROFILES) {
    const parsed = safeParseJson(process.env.PROFILES, null);
    const parsedProfiles = normalizeProfilePaths(parsed);
    if (parsedProfiles.length > 0) {
      settings.profiles = parsedProfiles;
    }
  }

  if (process.env.INSECURE_CODING) {
    settings.allow_insecure_coding = true;
  }

  if (process.env.BLOCKED_ACTIONS) {
    const parsed = safeParseJson(process.env.BLOCKED_ACTIONS, null);
    if (Array.isArray(parsed)) {
      settings.blocked_actions = parsed;
    }
  }

  if (process.env.MAX_MESSAGES) {
    settings.max_messages = normalizeNumber(process.env.MAX_MESSAGES, settings.max_messages);
  }

  if (process.env.NUM_EXAMPLES) {
    settings.num_examples = normalizeNumber(process.env.NUM_EXAMPLES, settings.num_examples);
  }

  if (process.env.LOG_ALL) {
    settings.log_all_prompts = normalizeBoolean(process.env.LOG_ALL, settings.log_all_prompts);
  }

  const hostPublic = normalizeBoolean(launcherConfig.mindserver_host_public, false);
  // Honor port_scan_start when it differs from the mindserver port; otherwise
  // scan starting at the configured mindserver port.
  const scanBase = launcherConfig.port_scan_start && launcherConfig.port_scan_start !== 8080
    ? launcherConfig.port_scan_start
    : settings.mindserver_port;
  const resolvedPort = await resolveFreePort(
    scanBase,
    launcherConfig.port_scan_max,
  );

  if (resolvedPort !== settings.mindserver_port) {
    console.log(`[launcher] Port ${settings.mindserver_port} was occupied. Using next free port: ${resolvedPort}`);
    settings.mindserver_port = resolvedPort;
  }

  await Mindcraft.init(hostPublic, settings.mindserver_port, settings.auto_open_ui);

  if (!settings.auto_start) {
    console.log('[launcher] auto_start is disabled. Use the web UI to start agents manually.');
    return;
  }

  const profilesToLaunch = normalizeProfilePaths(settings.profiles);
  if (profilesToLaunch.length === 0) {
    console.log('[launcher] auto_start is enabled, but no profiles were configured.');
    return;
  }

  const startupSettings = cloneSettings(settings);

  for (const profile of profilesToLaunch) {
    await launchProfile(profile, startupSettings);
  }
})().catch((err) => {
  console.error('[launcher] Fatal startup error:', err && err.message ? err.message : err);
  process.exit(1);
});
