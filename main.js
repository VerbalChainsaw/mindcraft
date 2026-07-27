import * as Mindcraft from './src/mindcraft/mindcraft.js';
import settings from './settings.js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadLauncherConfig } from './src/mindcraft/launcher-config.js';
import { buildProfileSettings, prepareProfiles } from './src/mindcraft/profile-preflight.js';
import {
  cloneSettings,
  normalizeProfilePaths,
  normalizeString,
  resolveLauncherSettings,
} from './src/mindcraft/runtime-config.js';
import { hasKey } from './src/utils/keys.js';

export { resolveLauncherSettings } from './src/mindcraft/runtime-config.js';

function parseArguments() {
  return yargs(hideBin(process.argv))
    .option('profiles', {
      type: 'array',
      describe: 'List of agent profile paths'
    })
    .option('profile', {
      type: 'string',
      describe: 'Agent profile path (converted to --profiles)'
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

function loadSelectedProfiles(profilePaths) {
  return profilePaths.map((profilePath) => {
    try {
      const resolvedProfilePath = path.resolve(process.cwd(), profilePath);
      const profile = safeParseJson(readFileSync(resolvedProfilePath, 'utf8'), null);
      return profile && typeof profile === 'object' && !Array.isArray(profile)
        ? { profile }
        : { loadError: 'Malformed selected profile.' };
    } catch {
      return { loadError: 'Malformed selected profile.' };
    }
  });
}

function createBlockedSettings(baseSettings, descriptor, profileEntry) {
  if (profileEntry?.profile) return buildProfileSettings(baseSettings, profileEntry.profile);
  return {
    ...cloneSettings(baseSettings),
    profile: { name: descriptor.name },
  };
}

async function launchProfile(descriptor, profileEntries, baseSettings) {
  const profileEntry = profileEntries[descriptor.index];
  const agentSettings = buildProfileSettings(baseSettings, profileEntry.profile);
  delete agentSettings.auto_start;

  if (!agentSettings.profile?.name) {
    console.error('[launcher] Profile missing name property.');
    return;
  }

  const response = await Mindcraft.createAgent(agentSettings);
  if (!response?.success) {
    console.error(`[launcher] Failed to start ${agentSettings.profile.name}:`, response?.error || 'unknown');
  }
}

export async function runLauncher() {
  const args = parseArguments();
  const launcherConfig = loadLauncherConfig(settings);
  const runtimeSettings = resolveLauncherSettings({
    defaults: settings,
    launcherConfig,
    settingsJson: process.env.SETTINGS_JSON,
    environment: process.env,
    args,
  });
  if (args.task_path) {
    readTask(runtimeSettings, normalizeString(args.task_path, ''), normalizeString(args.task_id, ''));
  }

  const profilesToLaunch = runtimeSettings.auto_start
    ? normalizeProfilePaths(runtimeSettings.profiles)
    : [];
  const selectedProfiles = runtimeSettings.auto_start ? loadSelectedProfiles(profilesToLaunch) : [];
  const profilePreflight = runtimeSettings.auto_start
    ? prepareProfiles(selectedProfiles, runtimeSettings, { hasKey })
    : { ready: [], blocked: [] };

  // Honor port_scan_start when it differs from the mindserver port; otherwise
  // scan starting at the configured mindserver port.
  const scanBase = launcherConfig.port_scan_start && launcherConfig.port_scan_start !== 8080
    ? launcherConfig.port_scan_start
    : runtimeSettings.mindserver_port;
  const resolvedPort = await Mindcraft.init(
    false,
    scanBase,
    runtimeSettings.auto_open_ui,
    launcherConfig.port_scan_max,
  );

  if (resolvedPort !== runtimeSettings.mindserver_port) {
    console.log(`[launcher] Port ${runtimeSettings.mindserver_port} was occupied. Using next free port: ${resolvedPort}`);
    runtimeSettings.mindserver_port = resolvedPort;
  }

  if (!runtimeSettings.auto_start) {
    console.log('[launcher] auto_start is disabled. Use the web UI to start agents manually.');
    return;
  }

  if (profilesToLaunch.length === 0) {
    console.log('[launcher] auto_start is enabled, but no profiles were configured.');
    return;
  }

  for (const descriptor of profilePreflight.blocked) {
    const agentSettings = createBlockedSettings(runtimeSettings, descriptor, selectedProfiles[descriptor.index]);
    delete agentSettings.auto_start;
    Mindcraft.registerBlockedAgent(agentSettings, descriptor, { hasKey });
  }

  for (const descriptor of profilePreflight.ready) {
    await launchProfile(descriptor, selectedProfiles, runtimeSettings);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runLauncher().catch((err) => {
    console.error('[launcher] Fatal startup error:', err && err.message ? err.message : err);
    process.exit(1);
  });
}
