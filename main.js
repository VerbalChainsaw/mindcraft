import * as Mindcraft from './src/mindcraft/mindcraft.js';
import settings from './settings.js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { readFileSync, existsSync, unlinkSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadLauncherConfig } from './src/mindcraft/launcher-config.js';
import { getManagedMinecraftServer } from './src/mindcraft/managed-minecraft-server.js';
import { resolveManagedMinecraftTarget, targetSettings } from './src/mindcraft/minecraft-target.js';
import { ownedLocalServices } from './src/mindcraft/owned-local-services.js';
import { buildProfileSettings, prepareProfiles } from './src/mindcraft/profile-preflight.js';
import { stopMindcraftRuntime } from './src/mindcraft/stack-shutdown.js';
import { director } from './src/mindcraft/director.js';
import { swarm } from './src/mindcraft/swarm/swarm.js';
import {
  cloneSettings,
  normalizeProfilePaths,
  normalizeString,
  resolveLauncherSettings,
} from './src/mindcraft/runtime-config.js';
import { hasKey } from './src/utils/keys.js';

export { resolveLauncherSettings } from './src/mindcraft/runtime-config.js';

let managedShutdownRegistered = false;
let mindServerReady = false;

function registerManagedServerShutdown(managedMinecraftServer) {
  if (managedShutdownRegistered) return;
  managedShutdownRegistered = true;
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[launcher] ${signal} received; stopping owned Mindcraft runtime processes.`);
    const result = await stopMindcraftRuntime({
      stopDirector: () => {
        director.shutdown();
        return { success: true };
      },
      stopTaskRunners: () => swarm.stop(),
      stopAgents: () => Mindcraft.stopAllAgentsAndWait(),
      // A launcher shutdown stops the owned Java process but preserves the
      // operator's desired running state so the next `npm start` restores
      // Paper before auto-starting agents. An explicit dashboard Server Stop
      // still records desiredState=stopped.
      stopMinecraft: () => managedMinecraftServer.stop({ preserveDesiredState: true }),
      stopLocalServices: () => ownedLocalServices.stopAll(),
    });
    if (!result.success) {
      console.error('[launcher] Runtime shutdown incomplete:', result.error);
    }
    process.exit(result.success ? 0 : 1);
  };
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
}

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

function boundedStringList(value, pattern, limit = 64) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((entry) => typeof entry === 'string' && pattern.test(entry))
    .slice(0, limit))];
}

function readRestartResumePlan() {
  const markerPath = path.join(process.cwd(), 'server_data', 'launcher-restart.json');
  try {
    const marker = safeParseJson(readFileSync(markerPath, 'utf8'), {});
    unlinkSync(markerPath);
    if (!Number.isFinite(marker.createdAt) || Date.now() - marker.createdAt > 5 * 60_000) {
      return { agentNames: [], squadIds: [] };
    }
    return {
      agentNames: boundedStringList(marker.resumeAgentNames, /^[A-Za-z0-9_]{3,16}$/),
      squadIds: boundedStringList(
        marker.resumeSquadIds,
        /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,
      ),
    };
  } catch {
    return { agentNames: [], squadIds: [] };
  }
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

export function notifyLauncherReady(port) {
  const token = process.env.LAUNCHER_HANDOFF_TOKEN;
  if (!token || typeof process.send !== 'function') return false;
  try {
    process.send({
      type: 'mindcraft-ready',
      token,
      port,
    }, (error) => {
      if (error) {
        console.error('[launcher] Unable to acknowledge restart handoff:', error.message || error);
      }
      try {
        if (process.connected) process.disconnect();
      } catch { /* parent may already have closed the IPC channel */ }
    });
    return true;
  } catch (error) {
    console.error('[launcher] Unable to acknowledge restart handoff:', error?.message || error);
    return false;
  }
}

export async function resumeLauncherLocalServices(
  serviceOwner = ownedLocalServices,
  environment = process.env,
) {
  const requested = boundedStringList(
    safeParseJson(environment.LAUNCHER_RESUME_LOCAL_SERVICES, []),
    /^(?:ollama)$/,
  );
  const resumed = [];
  const services = {};
  for (const service of requested) {
    if (service !== 'ollama') continue;
    const result = await serviceOwner.startOllama();
    if (result?.owned !== true) {
      throw new Error('Replacement launcher could not reclaim ownership of Ollama.');
    }
    resumed.push(service);
    services.ollama = {
      owned: true,
      pid: Number.isInteger(result.pid) ? result.pid : null,
    };
  }
  return { resumed, services };
}

function readRestartHandoffPort(environment = process.env) {
  if (!environment.LAUNCHER_HANDOFF_TOKEN) return null;
  const port = Number(environment.LAUNCHER_HANDOFF_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Replacement launcher requires a valid active MindServer handoff port.');
  }
  return port;
}

export async function runLauncher() {
  mindServerReady = false;
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

  const restartResumePlan = readRestartResumePlan();
  const resumeAgentNames = new Set([
    ...boundedStringList(
      safeParseJson(process.env.LAUNCHER_RESUME_AGENT_NAMES, []),
      /^[A-Za-z0-9_]{3,16}$/,
    ),
    ...restartResumePlan.agentNames,
  ]);
  const resumeSquadIds = new Set([
    ...boundedStringList(
      safeParseJson(process.env.LAUNCHER_RESUME_SQUAD_IDS, []),
      /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,
    ),
    ...restartResumePlan.squadIds,
  ]);
  const shouldLaunchSelectedProfiles = runtimeSettings.auto_start || resumeAgentNames.size > 0;
  const profilesToLaunch = normalizeProfilePaths(runtimeSettings.profiles);
  const selectedProfiles = loadSelectedProfiles(profilesToLaunch);
  const profilePreflight = prepareProfiles(selectedProfiles, runtimeSettings, { hasKey });

  const restartHandoffPort = readRestartHandoffPort();
  // A replacement must reclaim the listener being handed off. Ordinary starts
  // retain the configured bounded scan behavior.
  const scanBase = restartHandoffPort || (
    launcherConfig.port_scan_start && launcherConfig.port_scan_start !== 8080
      ? launcherConfig.port_scan_start
      : runtimeSettings.mindserver_port
  );
  const resolvedPort = await Mindcraft.init(
    false,
    scanBase,
    runtimeSettings.auto_open_ui,
    restartHandoffPort ? 1 : launcherConfig.port_scan_max,
  );

  if (resolvedPort !== runtimeSettings.mindserver_port) {
    console.log(`[launcher] Port ${runtimeSettings.mindserver_port} was occupied. Using next free port: ${resolvedPort}`);
    runtimeSettings.mindserver_port = resolvedPort;
  }

  const managedMinecraftServer = getManagedMinecraftServer();
  registerManagedServerShutdown(managedMinecraftServer);
  await resumeLauncherLocalServices();
  try {
    const managedStatus = await managedMinecraftServer.startIfDesired();
    const managedTarget = resolveManagedMinecraftTarget(managedStatus);
    if (managedTarget) {
      Object.assign(runtimeSettings, targetSettings(managedTarget));
    }
  } catch (error) {
    console.error('[launcher] Managed Minecraft server could not be restored:', error?.message || error);
  }
  mindServerReady = true;
  notifyLauncherReady(resolvedPort);

  if (resumeSquadIds.size > 0) {
    try {
      const result = await Mindcraft.resumePersistedSquads([...resumeSquadIds]);
      if (!result?.success) {
        console.error('[launcher] Persisted squads could not be fully resumed:', result?.error || 'unknown squad resume failure');
      }
    } catch (error) {
      console.error('[launcher] Persisted squad resume failed:', error?.message || error);
    }
  }

  if (profilesToLaunch.length === 0) {
    console.log('[launcher] No bot profiles are configured. Use the web UI to set up a bot.');
    return;
  }

  const selectedForThisLaunch = (descriptor) => runtimeSettings.auto_start || resumeAgentNames.has(descriptor.name);

  for (const descriptor of profilePreflight.blocked) {
    const agentSettings = createBlockedSettings(runtimeSettings, descriptor, selectedProfiles[descriptor.index]);
    delete agentSettings.auto_start;
    Mindcraft.registerBlockedAgent(agentSettings, descriptor, { hasKey });
  }

  for (const descriptor of profilePreflight.ready) {
    if (selectedForThisLaunch(descriptor)) {
      await launchProfile(descriptor, selectedProfiles, runtimeSettings);
      continue;
    }
    const agentSettings = createBlockedSettings(runtimeSettings, descriptor, selectedProfiles[descriptor.index]);
    delete agentSettings.auto_start;
    Mindcraft.registerConfiguredAgent(agentSettings, descriptor, { hasKey });
  }

  if (!shouldLaunchSelectedProfiles) {
    console.log('[launcher] Configured bot profiles are ready to start from the web UI.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runLauncher().catch((err) => {
    console.error('[launcher] Fatal startup error:', err && err.message ? err.message : err);
    if (!mindServerReady) {
      process.exit(1);
      return;
    }
    console.error('[launcher] MindServer remains online so the startup problem can be corrected from the dashboard.');
  });
}
