import { Server } from 'socket.io';
import express from 'express';
import http from 'http';
import net from 'net';
import path from 'path';
import { spawn } from 'child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'url';
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'fs';
import * as mindcraft from './mindcraft.js';
import { getKeySource, hasKey } from '../utils/keys.js';
import { writeJsonAtomicSync } from '../utils/atomic-file.js';
import { validateAgentName } from '../utils/agent-name.js';
import { buildHealthStatus } from './health-status.js';
import {
  discoverLocalServices,
  discoverOpenAICompatibleModelsAt,
  discoverOllamaModels,
  discoverOpenAICompatibleModels,
  recommendOllamaModels,
} from './local-service-discovery.js';
import {
  createLocalQuickstartPlan,
  LOCAL_QUICKSTART_PROFILE,
  LocalQuickstartValidationError,
  summarizeLocalQuickstart,
} from './local-quickstart.js';
import {
  getManagedMinecraftServer,
  ManagedMinecraftServerError,
} from './managed-minecraft-server.js';
import {
  collectAgentStates,
  createAgentStatePump,
  fingerprintAgentStates,
  normalizeAgentTelemetryConfig,
  resetAgentStateCache,
  selectAgentConnectionsForPolling,
} from './agent-state-pump.js';
import { normalizeAgentSettings } from './agent-settings.js';
import { createBedrockClientController } from './bedrock-client.js';
import { BotSquadManager } from './bot-squad-manager.js';
import { SquadOrchestrator } from './squad-orchestrator.js';
import { BOT_PROVIDER_CATALOG, BotLibraryStore, botProfileToAgentSettings } from './bot-library.js';
import { SquadScenarioStore } from './squad-scenario-store.js';
import { assertMindServerLoopbackOnly, loadLauncherConfig, writeLauncherConfig, getLauncherConfigPath } from './launcher-config.js';
import { ownedLocalServices } from './owned-local-services.js';
import { stopMindcraftRuntime } from './stack-shutdown.js';
import {
  applyMinecraftTarget,
  resolveManagedMinecraftTarget,
  resolveMinecraftTarget,
  targetSettings,
} from './minecraft-target.js';
import { terminateOwnedProcessTree } from './process-tree.js';
import { swarm, defaultBrainHook } from './swarm/swarm.js';
import { director } from './director.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mindserver is:
// - central hub for communication between all agent processes
// - api to control from other languages and remote users
// - host for webapp

let io;
let server;
const serverSockets = new Set();
const agent_connections = {};
const agent_listeners = [];
const AGENT_TELEMETRY_ROOM = 'dashboard:agent-telemetry';
let mindserverHost = 'localhost';
let mindserverPort = 8080;
let agentTelemetryConfig = normalizeAgentTelemetryConfig();
let lastAgentStates = {};

const settings_spec = JSON.parse(readFileSync(path.join(__dirname, 'public/settings_spec.json'), 'utf8'));
const defaultManagedMinecraftServer = getManagedMinecraftServer();

const LAUNCHER_KEY_PROVIDERS = [
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'ANTHROPIC_API_KEY',
  'XAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'MISTRAL_API_KEY',
  'REPLICATE_API_KEY',
  'GROQCLOUD_API_KEY',
  'HUGGINGFACE_API_KEY',
  'NOVITA_API_KEY',
  'OPENROUTER_API_KEY',
  'GHLF_API_KEY',
  'HYPERBOLIC_API_KEY',
  'QWEN_API_KEY',
  'MERCURY_API_KEY',
  'VLLM_API_KEY',
  'CEREBRAS_API_KEY',
  'OPENAI_COMPATIBLE_API_KEY',
  'NVIDIA_API_KEY',
  'TOGETHER_API_KEY',
  'FIREWORKS_API_KEY',
  'DEEPINFRA_API_KEY',
];

function getLauncherConfigSummary(config = loadLauncherConfig({}, getLauncherConfigPath())) {
  return {
    ...config,
    runtime: {
      host: mindserverHost,
      port: mindserverPort,
    },
  };
}

function hasProviderKey(name) {
  return Boolean(hasKey(name));
}

function getProviderKeyStatus() {
  const out = {};
  for (const provider of LAUNCHER_KEY_PROVIDERS) {
    out[provider] = Boolean(hasProviderKey(provider));
  }
  return out;
}

function getProviderKeySources() {
  const out = {};
  for (const provider of LAUNCHER_KEY_PROVIDERS) {
    out[provider] = getKeySource(provider);
  }
  return out;
}

function readLocalQuickstartProfile() {
  try {
    return JSON.parse(readFileSync(path.resolve(process.cwd(), LOCAL_QUICKSTART_PROFILE), 'utf8'));
  } catch {
    return null;
  }
}

function writeLocalQuickstartProfile(profile) {
  const profilePath = path.resolve(process.cwd(), LOCAL_QUICKSTART_PROFILE);
  writeJsonAtomicSync(profilePath, profile);
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

function normalizeLoopbackHostname(value) {
  let hostname = String(value || '').trim().toLowerCase();
  if (hostname.startsWith('[') && hostname.endsWith(']')) hostname = hostname.slice(1, -1);
  return LOOPBACK_HOSTNAMES.has(hostname) ? hostname : null;
}

function isLoopbackRequestOrigin(requestProtocol, requestHost, originValue) {
  let request;
  try {
    const protocol = String(requestProtocol || '').replace(/:$/, '');
    request = new URL(`${protocol}://${requestHost}`);
  } catch {
    return false;
  }
  if (!normalizeLoopbackHostname(request.hostname)) return false;
  if (!originValue) return true;
  let origin;
  try {
    origin = originValue instanceof URL ? originValue : new URL(originValue);
  } catch {
    return false;
  }
  if (request.protocol !== origin.protocol || request.port !== origin.port) return false;
  return Boolean(normalizeLoopbackHostname(origin.hostname));
}

function safeMergeLauncherConfig(body = {}) {
  return writeLauncherConfig(body, getLauncherConfigPath());
}

function resolveLauncherEntry() {
  const candidate = process.env.LAUNCHER_ENTRY
    || (process.argv[1] && /\.js$/.test(process.argv[1]) ? process.argv[1] : null)
    || path.join(process.cwd(), 'main.js');
  const entry = path.isAbsolute(candidate) ? candidate : path.resolve(process.cwd(), candidate);
  let entryStats;
  try {
    entryStats = statSync(entry);
  } catch {
    throw new Error(`Launcher entry is unavailable: ${entry}`);
  }
  if (!entryStats.isFile()) {
    throw new Error(`Launcher entry is not a file: ${entry}`);
  }
  return entry;
}

function profileProvider(profile, model) {
  if (typeof profile?.provider === 'string' && profile.provider.trim()) return profile.provider.trim();
  if (typeof profile?.api === 'string' && profile.api.trim()) return profile.api.trim();
  const modelText = String(model || '').toLowerCase();
  const prefix = modelText.split('/')[0];
  if (modelText.includes('claude')) return 'anthropic';
  if (modelText.includes('gemini')) return 'google';
  if (modelText.includes('grok')) return 'xai';
  if (modelText.includes('deepseek')) return 'deepseek';
  if (modelText.includes('mistral')) return 'mistral';
  if (modelText.includes('qwen')) return 'qwen';
  if (modelText.includes('gpt') || modelText.includes('/o1') || modelText.includes('/o3')) return 'openai';
  return prefix && modelText.includes('/') ? prefix : '';
}

class AgentConnection {
    constructor(settings, viewer_port, processToken = null) {
        this.socket = null;
        this.settings = settings;
        this.in_game = false;
        this.stage = 'registered';
        this.full_state = null;
        this.viewer_port = viewer_port;
        this.processToken = processToken;
        this.lastStatePushAt = 0;
        this.lastStateSequence = 0;
        this.statePushCount = 0;
    }
    setSettings(settings) {
        this.settings = settings;
    }
}

export function registerAgent(settings, viewer_port, processToken = null) {
    let agentConnection = new AgentConnection(settings, viewer_port, processToken);
    agent_connections[settings.profile.name] = agentConnection;
}

function serializePublicAgent(agentName) {
    const conn = agent_connections[agentName];
    if (!conn) return null;
    const agentProcess = mindcraft.getAgentProcess(agentName);
    const viewerEnabled = conn.settings?.render_bot_view === true;
    const hasViewerPort = Number.isInteger(conn.viewer_port)
      && conn.viewer_port > 0
      && conn.viewer_port <= 65_535;
    const viewerAvailable = Boolean(viewerEnabled && conn.in_game && hasViewerPort);
    return {
      name: agentName,
      in_game: conn.in_game,
      retryable: agentProcess?.retryable === true,
      viewerEnabled,
      viewerAvailable,
      viewerPort: viewerAvailable ? conn.viewer_port : null,
      socket_connected: !!conn.socket,
      connection_stage: conn.stage,
      readiness_stage: agentProcess?.readinessStage || null,
      provider: profileProvider(conn.settings?.profile, conn.settings?.profile?.model) || null,
      model: conn.settings?.profile?.model || null,
      state: agentProcess?.state || 'unknown',
      lastError: agentProcess?.lastError || null,
      diagnostics: agentProcess?.lastError ? agentProcess.getDiagnostics?.(12) || [] : [],
    };
}

function serializePublicAgents() {
    return Object.keys(agent_connections)
      .map((agentName) => serializePublicAgent(agentName))
      .filter(Boolean);
}

function tokensMatch(expected, actual) {
    if (typeof expected !== 'string' || typeof actual !== 'string') return false;
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(actual);
    return expectedBuffer.length === actualBuffer.length
        && timingSafeEqual(expectedBuffer, actualBuffer);
}

const MAX_RELAY_MESSAGE_LENGTH = 4_096;
const MAX_BOT_OUTPUT_LENGTH = 16_384;
const MAX_SQUAD_RADIO_LENGTH = 1_200;
const SQUAD_RADIO_KINDS = new Set(['order', 'status', 'request', 'warning', 'completion']);
// A bot may ask for more bots, but Minecraft chat is untrusted input reaching a
// language model, so a request that starts a process needs a floor on how often
// it can happen regardless of what anyone types.
const AGENT_SPAWN_COOLDOWN_MS = 20_000;
const agent_spawn_cooldowns = new Map();

function isAgentSocket(socket) {
    return socket?.data?.role === 'agent';
}

function ownsAgentIdentity(socket, agentName) {
    return isAgentSocket(socket) && socket.data.agentName === agentName;
}

function boundedString(value, maximumLength) {
    if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength) return null;
    return value;
}

function parseDashboardModelCommand(value) {
    const message = String(value || '').trim();
    const match = /^!model(?:\s+(.+)|\(\s*(.*?)\s*\))?$/i.exec(message);
    if (!match) return null;
    let model = String(match[1] ?? match[2] ?? '').trim();
    if (
        model.length >= 2
        && ((model.startsWith('"') && model.endsWith('"'))
            || (model.startsWith("'") && model.endsWith("'")))
    ) {
        model = model.slice(1, -1).trim();
    }
    if (!model) return { model: null };
    if (model.length > 512 || /[\r\n\0]/.test(model)) {
        return { error: 'Model names must be one line and 512 characters or fewer.' };
    }
    return { model };
}

function modelNameFromSettings(settings) {
    const configured = settings?.profile?.model;
    if (configured && typeof configured === 'object' && !Array.isArray(configured)) {
        return String(configured.model || '').trim();
    }
    return String(configured || '').trim();
}

function settingsWithSelectedModel(settings, selectedModel) {
    const next = JSON.parse(JSON.stringify(settings));
    const configured = next.profile?.model;
    if (configured && typeof configured === 'object' && !Array.isArray(configured)) {
        const api = typeof configured.api === 'string' ? configured.api.trim() : '';
        const model = api && selectedModel.startsWith(`${api}/`)
            ? selectedModel.slice(api.length + 1)
            : selectedModel;
        next.profile.model = { ...configured, model };
        return next;
    }

    const current = String(configured || '');
    const profileApi = typeof next.profile?.api === 'string' ? next.profile.api.trim() : '';
    const prefixedApi = !profileApi && current.includes('/') ? current.slice(0, current.indexOf('/')) : '';
    const api = profileApi || prefixedApi;
    next.profile.model = api && current.startsWith(`${api}/`) && !selectedModel.startsWith(`${api}/`)
        ? `${api}/${selectedModel}`
        : selectedModel;
    return next;
}

function requireDashboardSocket(socket, callback) {
    if (!isAgentSocket(socket)) return true;
    if (typeof callback === 'function') {
        callback({ success: false, error: 'Agent bridges cannot invoke dashboard administration.' });
    }
    return false;
}

function requireValidDashboardAgentName(value, callback) {
    const validation = validateAgentName(value);
    if (validation.success) return validation.name;
    if (typeof callback === 'function') {
        callback({ success: false, error: validation.error });
    }
    return null;
}

export function unregisterAgent(agentName) {
    if (!agent_connections[agentName]) return;
    resetAgentStateCache(agent_connections[agentName]);
    delete agent_connections[agentName];
    delete lastAgentStates[agentName];
    agentsStatusUpdate();
}

export function logoutAgent(agentName) {
    if (agent_connections[agentName]) {
        agent_connections[agentName].in_game = false;
        agent_connections[agentName].stage = 'stopped';
        resetAgentStateCache(agent_connections[agentName]);
        delete lastAgentStates[agentName];
    }
}

export function broadcastAgentStatus() {
    agentsStatusUpdate();
}

export function waitForMindServerListening(server, port) {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            server.off('error', onError);
            server.off('listening', onListening);
        };
        const onError = (error) => {
            cleanup();
            reject(error);
        };
        const onListening = () => {
            cleanup();
            resolve(server);
        };

        server.once('error', onError);
        server.once('listening', onListening);
        try {
            server.listen(port, 'localhost');
        } catch (error) {
            cleanup();
            reject(error);
        }
    });
}

// Initialize the server
export function createMindServer(host_public = false, port = 8080, portScanMax = 1, dependencies = {}) {
    assertMindServerLoopbackOnly(host_public);
    return createMindServerWithRetries(port, portScanMax, dependencies);
}

async function createMindServerWithRetries(port, portScanMax, dependencies) {
    const scanAttempts = Math.max(1, Math.trunc(Number(portScanMax) || 1));

    for (let attempt = 0; attempt < scanAttempts; attempt += 1) {
        try {
            return await createMindServerAtPort(port + attempt, dependencies);
        } catch (error) {
            if (error?.code !== 'EADDRINUSE' || attempt === scanAttempts - 1) {
                throw error;
            }
        }
    }
}

async function createMindServerAtPort(port, dependencies = {}) {

    const app = express();
    agentTelemetryConfig = normalizeAgentTelemetryConfig(
      dependencies.agentTelemetryConfig
      || loadLauncherConfig({}, getLauncherConfigPath()).telemetry,
    );
    listenerPump?.stop();
    listenerPump = null;
    agent_listeners.splice(0, agent_listeners.length);
    lastAgentStates = {};
    lastStateFingerprint = '';
    lastStatePublishedAt = 0;
    const managedMinecraftServer = dependencies.managedMinecraftServer || defaultManagedMinecraftServer;
    const localServiceOwner = dependencies.localServiceOwner || ownedLocalServices;
    const discoverServices = dependencies.discoverLocalServices || discoverLocalServices;
    const discoverOllama = dependencies.discoverOllamaModels || discoverOllamaModels;
    const discoverCompatible = dependencies.discoverOpenAICompatibleModels || discoverOpenAICompatibleModels;
    const discoverCompatibleAt = dependencies.discoverOpenAICompatibleModelsAt || discoverOpenAICompatibleModelsAt;
    const getActiveManagedTarget = async () => {
      try {
        return resolveManagedMinecraftTarget(
          await managedMinecraftServer.getStatus({ includeLogs: false }),
        );
      } catch {
        return null;
      }
    };
    const loadEffectiveLauncherConfig = async () => {
      const config = loadLauncherConfig({}, getLauncherConfigPath());
      const managedTarget = await getActiveManagedTarget();
      return {
        config: applyMinecraftTarget(config, managedTarget),
        managedTarget,
      };
    };
    const reconcileAgentTarget = async (agentName) => {
      const managedTarget = await getActiveManagedTarget();
      if (!managedTarget) return null;
      const connection = agent_connections[agentName];
      const currentSettings = mindcraft.getAgentSettings(agentName) || connection?.settings;
      if (!currentSettings) return managedTarget;
      const normalizedSettings = normalizeAgentSettings({
        ...currentSettings,
        ...targetSettings(managedTarget),
      }, settings_spec, { expectedAgentName: agentName });
      mindcraft.setAgentSettings(agentName, normalizedSettings);
      connection?.setSettings(normalizedSettings);
      return managedTarget;
    };
    const startAgentWithCurrentTarget = async (agentName) => {
      try {
        await reconcileAgentTarget(agentName);
        return await mindcraft.startAgent(agentName);
      } catch (error) {
        const detail = String(error?.message || error).slice(0, 320);
        console.warn(`[agents] Start for ${agentName} failed before launch:`, detail);
        return { success: false, error: detail };
      }
    };
    const applyAgentSettings = async (agentName, settings) => {
      const agent = agent_connections[agentName];
      if (!agent) return { success: false, settingsApplied: false, error: `Agent '${agentName}' not found.` };
      let settingsApplied = false;
      try {
        const normalizedSettings = normalizeAgentSettings(settings, settings_spec, {
          expectedAgentName: agentName,
        });
        mindcraft.setAgentSettings(agentName, normalizedSettings);
        agent.setSettings(normalizedSettings);
        settingsApplied = true;

        const agentProcess = mindcraft.getAgentProcess(agentName);
        const lifecycleState = agentProcess?.state || 'stopped';
        const shouldRestart = ['starting', 'running', 'restarting'].includes(lifecycleState);
        if (agent.socket && !agentProcess) {
          return {
            success: false,
            settingsApplied: true,
            restarted: false,
            lifecycleState: 'unowned',
            error: `Settings were applied, but agent '${agentName}' has no lifecycle owner and was not restarted.`,
          };
        }
        if (!shouldRestart) {
          return {
            success: true,
            settingsApplied: true,
            restarted: false,
            activation: 'next-start',
            lifecycleState,
            error: null,
          };
        }

        const restartResult = await startAgentWithCurrentTarget(agentName);
        const updatedLifecycleState = mindcraft.getAgentProcess(agentName)?.state || lifecycleState;
        if (!restartResult?.success) {
          return {
            success: false,
            settingsApplied: true,
            restarted: false,
            lifecycleState: updatedLifecycleState,
            error: `Settings were applied, but the bot restart failed: ${
              String(restartResult?.error || 'no lifecycle result').slice(0, 320)
            }`,
          };
        }
        return {
          success: true,
          settingsApplied: true,
          restarted: true,
          activation: 'replacement-spawned',
          lifecycleState: updatedLifecycleState,
          error: null,
        };
      } catch (error) {
        const detail = String(error?.message || error).slice(0, 320);
        console.warn(
          `[agents] Settings for ${agentName} ${settingsApplied ? 'activation failed' : 'rejected'}:`,
          detail,
        );
        return settingsApplied
          ? {
              success: false,
              settingsApplied: true,
              restarted: false,
              lifecycleState: mindcraft.getAgentProcess(agentName)?.state || 'unknown',
              error: `Settings were applied, but bot activation failed: ${detail}`,
            }
          : {
              success: false,
              settingsApplied: false,
              restarted: false,
              error: detail,
            };
      } finally {
        agentsStatusUpdate();
      }
    };
    const candidateServer = http.createServer(app);
    const candidateIo = new Server(candidateServer, {
      allowRequest: (request, callback) => {
        const origin = request.headers.origin;
        const protocol = request.socket.encrypted ? 'https:' : 'http:';
        return callback(
          null,
          isLoopbackRequestOrigin(protocol, request.headers.host, origin),
        );
      },
    });
    const bedrockClientController = dependencies.bedrockClientController
      || createBedrockClientController();
    const botSquadManager = dependencies.botSquadManager || new BotSquadManager({
      getAgentSettings: (agentName) => mindcraft.getAgentSettings(agentName),
      hasAgent: (agentName) => Boolean(mindcraft.getAgentProcess(agentName)),
      normalizeSettings: (settings) => normalizeAgentSettings(settings, settings_spec),
      createAgent: (settings) => mindcraft.createAgent(settings),
      startAgent: (agentName) => mindcraft.startAgent(agentName),
      stopAgent: (agentName) => mindcraft.stopAgent(agentName),
      destroyAgent: (agentName) => mindcraft.destroyAgentAndWait(agentName),
      prepareSettings: async (settings) => {
        const target = await getActiveManagedTarget();
        if (!target) return settings;
        return {
          ...settings,
          host: target.host,
          port: target.port,
          auth: target.auth,
          minecraft_version: target.minecraft_version,
        };
      },
      setAgentSettings: (agentName, settings) => {
        const connection = agent_connections[agentName];
        if (!connection) throw new Error(`Agent '${agentName}' has no registered settings owner.`);
        connection.setSettings(settings);
      },
      onUpdate: (squad) => {
        candidateIo.emit('squad-update', squad);
        agentsStatusUpdate();
      },
      persistencePath: dependencies.squadPersistencePath || path.join(process.cwd(), 'server_data', 'squads.json'),
    });
    const botLibraryStore = dependencies.botLibraryStore || new BotLibraryStore();
    const squadScenarioStore = dependencies.squadScenarioStore || new SquadScenarioStore({
      filePath: dependencies.squadScenarioPath || path.join(process.cwd(), 'server_data', 'squad-scenarios.json'),
    });
    const squadOrchestrator = dependencies.squadOrchestrator || new SquadOrchestrator({
      squadManager: botSquadManager,
      send: (agentName, message) => director.command(agentName, message),
      isReady: (agentName) => Boolean(agent_connections[agentName]?.in_game && agent_connections[agentName]?.socket),
      scenarioStore: squadScenarioStore,
      getBotProfileSettings: (reference) => {
        const key = String(reference || '').trim().toLowerCase();
        const profile = botLibraryStore.list().find((candidate) => (
          candidate.id.toLowerCase() === key || candidate.name.toLowerCase() === key
        ));
        return profile ? botProfileToAgentSettings(profile) : null;
      },
    });
    const relaySquadRadio = ({ squadId = '', sourceName = '', message = '', kind = 'status', notifySocket = null } = {}) => {
      const cleanMessage = typeof message === 'string'
        // eslint-disable-next-line no-control-regex
        ? message.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_SQUAD_RADIO_LENGTH)
        : '';
      const cleanKind = SQUAD_RADIO_KINDS.has(String(kind).toLowerCase()) ? String(kind).toLowerCase() : 'status';
      if (!cleanMessage) return { success: false, error: 'Enter a short squad radio message.' };
      const squad = sourceName
        ? botSquadManager.getByMember?.(sourceName)
        : botSquadManager.get(squadId);
      if (!squad) return { success: false, error: 'The bot is not assigned to a squad.' };
      const activeStates = new Set(['started', 'running']);
      const sender = sourceName || 'Director';
      const recipients = squad.members.filter((member) => (
        activeStates.has(member.state)
        && member.name !== sourceName
        && agent_connections[member.name]?.socket
      ));
      if (!recipients.length) return { success: false, error: 'No other live squad members can receive this radio message.' };
      const event = {
        eventId: `radio-${randomBytes(8).toString('hex')}`,
        squadId: squad.id,
        from: sender,
        kind: cleanKind,
        message: cleanMessage,
        delivered: 0,
        targeted: recipients.length,
      };
      recipients.forEach((member) => {
        try {
          agent_connections[member.name].socket.emit('squad-radio', event);
          event.delivered += 1;
        } catch (error) {
          console.warn(`[squad-radio] delivery to ${member.name} failed: ${String(error?.message || error).slice(0, 180)}`);
        }
      });
      const dashboardEvent = { ...event };
      try { (io || notifySocket)?.emit('squad-radio-event', dashboardEvent); } catch { /* dashboard feedback is best effort */ }
      for (const listener of agent_listeners) {
        try { listener.emit('squad-radio-event', dashboardEvent); } catch { /* stale dashboard listener */ }
      }
      return { success: event.delivered > 0, squadId: squad.id, kind: cleanKind, delivered: event.delivered, targeted: event.targeted };
    };
    candidateServer.on('connection', (socket) => {
        serverSockets.add(socket);
        socket.on('close', () => {
            serverSockets.delete(socket);
        });
    });

    // Serve static files
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    app.disable('x-powered-by');
    app.use((_req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      next();
    });
    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: true, limit: '1mb' }));
    app.use(express.static(path.join(__dirname, 'public'), {
        etag: false,
        maxAge: 0,
        setHeaders(response) {
            response.setHeader('Cache-Control', 'no-store, max-age=0');
        },
    }));

    // Require an explicit loopback Host for every API request. When a browser
    // sends Origin, it must also be a loopback alias on the exact protocol and
    // port; local non-browser clients remain usable without an Origin header.
    const loopbackRequestGuard = (req, res, next) => {
      const origin = req.headers.origin;
      if (isLoopbackRequestOrigin(req.protocol, req.headers.host, origin)) return next();
      console.warn('[api] Blocked cross-origin request', {
        origin: origin || null,
        host: req.headers.host,
        path: req.path,
      });
      return res.status(403).json({ success: false, error: 'Cross-origin request blocked' });
    };
    app.use('/api', loopbackRequestGuard);

    // Read-only profile catalogue for the setup picker. Only direct children
    // returned by readdir are used, so request input can never affect paths.
    app.get('/api/profiles', (_req, res) => {
      try {
        const profilesDir = path.join(process.cwd(), 'profiles');
        const profiles = readdirSync(profilesDir, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
          .map((entry) => {
            const file = `./profiles/${entry.name}`;
            try {
              const data = JSON.parse(readFileSync(path.join(profilesDir, entry.name), 'utf8'));
              const rawModel = data?.model;
              const model = typeof rawModel === 'string' ? rawModel : rawModel?.model || '';
              return {
                file,
                name: typeof data?.name === 'string' && data.name.trim() ? data.name.trim() : entry.name.replace(/\.json$/i, ''),
                model: String(model),
                provider: profileProvider(data, model),
              };
            } catch {
              return null;
            }
          })
          .filter(Boolean)
          .sort((a, b) => a.name.localeCompare(b.name));
        res.json({ success: true, profiles });
      } catch (error) {
        if (error?.code === 'ENOENT') return res.json({ success: true, profiles: [] });
        res.status(500).json({ success: false, error: String(error.message || error) });
      }
    });

    const providerKeyName = (provider) => ({
      openai: 'OPENAI_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY',
      google: 'GEMINI_API_KEY',
      deepseek: 'DEEPSEEK_API_KEY',
      groq: 'GROQCLOUD_API_KEY',
      mistral: 'MISTRAL_API_KEY',
      xai: 'XAI_API_KEY',
      qwen: 'QWEN_API_KEY',
      openrouter: 'OPENROUTER_API_KEY',
      cerebras: 'CEREBRAS_API_KEY',
      'openai-compatible': 'OPENAI_COMPATIBLE_API_KEY',
      custom: 'OPENAI_COMPATIBLE_API_KEY',
    })[String(provider || '').toLowerCase()] || null;

    const providerReadiness = async (profile) => {
      const provider = String(profile?.provider?.id || '').toLowerCase();
      const chatModel = String(profile?.provider?.chatModel || '').trim();
      const baseUrl = String(profile?.provider?.baseUrl || '').trim();
      const localServices = await discoverServices();
      const localServiceId = provider === 'lmstudio' ? 'lm-studio' : provider;
      const service = localServices.find((entry) => entry.id === localServiceId);
      const base = {
        provider,
        chatModel,
        configured: Boolean(provider && chatModel),
        reachable: null,
        modelAvailable: null,
      };
      if (!chatModel) return { ...base, ready: false, reason: 'Choose a chat model first.' };
      if (provider === 'ollama') {
        const models = await discoverOllama();
        const reachable = Boolean(service?.available);
        const match = models.some((entry) => entry.name === chatModel);
        return {
          ...base,
          reachable,
          modelAvailable: reachable && match,
          ready: reachable && match,
          reason: !reachable ? 'Ollama is not reachable on its local endpoint.' : match ? null : 'The selected Ollama model is not installed.',
        };
      }
      if (['lmstudio', 'vllm'].includes(provider)) {
        const reachable = Boolean(service?.available);
        const models = reachable ? await discoverCompatible(localServiceId) : [];
        const modelAvailable = reachable && models.some((entry) => entry.name === chatModel);
        return {
          ...base,
          reachable,
          modelAvailable,
          ready: modelAvailable,
          reason: !reachable
            ? `${provider} is not reachable on its local endpoint.`
            : modelAvailable ? null : `The selected ${provider} model is not available.`,
        };
      }
      if (['openai-compatible', 'custom'].includes(provider) && !baseUrl) {
        return { ...base, configured: false, ready: false, reason: 'OpenAI-compatible providers need a base URL ending at the provider API root.' };
      }
      const key = providerKeyName(provider);
      const credential = key ? hasProviderKey(key) : false;
      const localCompatible = ['openai-compatible', 'custom'].includes(provider)
        && /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(baseUrl);
      if (localCompatible) {
        const local = await discoverCompatibleAt(baseUrl);
        const modelAvailable = local.reachable
          && local.models.some((entry) => entry.name === chatModel);
        return {
          ...base,
          configured: true,
          reachable: local.reachable,
          modelAvailable,
          ready: modelAvailable,
          reason: !local.reachable
            ? 'The local OpenAI-compatible endpoint is not reachable.'
            : modelAvailable ? null : 'The selected model is not available from the local OpenAI-compatible endpoint.',
        };
      }
      return {
        ...base,
        configured: credential,
        ready: credential || localCompatible,
        reason: credential ? null : `No ${key || provider} credential is configured.`,
      };
    };

    app.get('/api/bot-library', (_req, res) => {
      res.json({ success: true, profiles: botLibraryStore.list(), storage: botLibraryStore.health?.() || { writable: true, error: null } });
    });

    app.get('/api/bot-library/catalog', async (_req, res) => {
      const providers = BOT_PROVIDER_CATALOG.map((provider) => ({
        ...provider,
        credentialConfigured: provider.credentialEnv ? hasProviderKey(provider.credentialEnv) : null,
      }));
      let connection = { host: '127.0.0.1', port: 25565 };
      let services = [];
      try {
        const [{ config }, discoveredServices] = await Promise.all([
          loadEffectiveLauncherConfig(),
          discoverServices(),
        ]);
        connection = {
          host: String(config?.agent_defaults?.host || connection.host),
          port: Number(config?.agent_defaults?.port) || connection.port,
        };
        services = Array.isArray(discoveredServices) ? discoveredServices : [];
      } catch {
        // The library remains editable with safe defaults if optional discovery fails.
      }
      const credentialProvider = providers.find((provider) => provider.credentialEnv && provider.credentialConfigured);
      const localService = services.find((service) => service?.available && ['ollama', 'lm-studio', 'vllm'].includes(service.id));
      const localProviderId = localService?.id === 'lm-studio' ? 'lmstudio' : localService?.id;
      const recommendedProviderId = credentialProvider?.id || localProviderId || 'ollama';
      const recommendedProvider = providers.find((provider) => provider.id === recommendedProviderId) || providers[0];
      res.json({
        success: true,
        providers,
        defaults: {
          provider: {
            id: recommendedProvider.id,
            chatModel: recommendedProvider.examples?.[0] || '',
          },
          connection,
        },
      });
    });

    app.get('/api/provider-capabilities', async (_req, res) => {
      try {
        const services = await discoverServices();
        res.json({
          success: true,
          services,
          providers: LAUNCHER_KEY_PROVIDERS.map((key) => ({ id: key.replace(/_API_KEY$/, '').toLowerCase(), credential: Boolean(hasProviderKey(key)), key })),
        });
      } catch {
        res.status(500).json({ success: false, error: 'Provider capability discovery unavailable.' });
      }
    });

    app.post('/api/bot-library', (req, res) => {
      try {
        const profile = botLibraryStore.upsert(req.body || {});
        res.json({ success: true, profile });
      } catch (error) {
        res.status(400).json({ success: false, error: String(error?.message || error).slice(0, 320) });
      }
    });

    app.post('/api/bot-library/delete', (req, res) => {
      const result = botLibraryStore.remove(req.body?.id);
      res.status(result.success ? 200 : 404).json(result);
    });

    app.post('/api/bot-library/:id/test', async (req, res) => {
      try {
        const profile = botLibraryStore.get(req.params.id);
        if (!profile) return res.status(404).json({ success: false, error: 'Bot profile not found.' });
        const readiness = await providerReadiness(profile);
        return res.json({ success: true, readiness });
      } catch {
        return res.status(500).json({ success: false, error: 'Provider readiness check failed.' });
      }
    });

    app.post('/api/bot-library/:id/spawn', async (req, res) => {
      try {
        const profile = botLibraryStore.get(req.params.id);
        if (!profile) return res.status(404).json({ success: false, error: 'Bot profile not found.' });
        const readiness = await providerReadiness(profile);
        if (!readiness.ready) return res.status(409).json({ success: false, error: readiness.reason || 'Provider is not ready.', readiness });
        let settings = normalizeAgentSettings(
          botProfileToAgentSettings(profile, { agentName: req.body?.agentName }),
          settings_spec,
        );
        const activeTarget = await getActiveManagedTarget();
        if (activeTarget) settings = { ...settings, ...targetSettings(activeTarget) };
        const existing = mindcraft.getAgentProcess(settings.profile.name);
        if (existing && (existing.isActive?.() || existing.running)) {
          return res.status(409).json({ success: false, error: `Agent '${settings.profile.name}' is already active.` });
        }
        const result = await mindcraft.createAgent(settings);
        agentsStatusUpdate();
        return res.status(result.success ? 202 : 400).json({ ...result, agentName: settings.profile.name, readiness });
      } catch (error) {
        return res.status(400).json({ success: false, error: String(error?.message || error).slice(0, 320) });
      }
    });

    app.get('/api/local-services', async (_req, res) => {
      try {
        const services = await discoverServices();
        res.json({ success: true, services });
      } catch {
        res.status(500).json({ success: false, error: 'Local service discovery unavailable' });
      }
    });

    app.get('/api/local-models', async (_req, res) => {
      try {
        const [ollamaModels, lmStudioModels, vllmModels] = await Promise.all([
          discoverOllama(),
          discoverCompatible('lm-studio'),
          discoverCompatible('vllm'),
        ]);
        const models = ollamaModels;
        const localCatalog = {
          ollama: ollamaModels,
          lmstudio: lmStudioModels,
          vllm: vllmModels,
        };
        const recommendation = recommendOllamaModels(models);
        const { config } = await loadEffectiveLauncherConfig();
        res.json({
          success: true,
          provider: {
            id: 'ollama',
            label: 'Ollama',
            available: models.length > 0,
          },
          models,
          localCatalog,
          recommendation,
          quickstart: summarizeLocalQuickstart(config, readLocalQuickstartProfile()),
        });
      } catch {
        res.status(500).json({ success: false, error: 'Local model discovery unavailable' });
      }
    });

    app.get('/api/minecraft-server', async (req, res) => {
      try {
        const status = await managedMinecraftServer.getStatus({
          includeLogs: req.query.logs !== '0',
        });
        const config = loadLauncherConfig({}, getLauncherConfigPath());
        res.json({
          success: true,
          server: {
            ...status,
            target: resolveMinecraftTarget(config, status),
          },
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: String(error.message || error),
        });
      }
    });

    app.get('/api/bedrock-client', async (_req, res) => {
      try {
        res.json({
          success: true,
          client: await bedrockClientController.getStatus(),
        });
      } catch {
        res.status(500).json({
          success: false,
          error: 'Bedrock client inspection is unavailable.',
        });
      }
    });

    app.post('/api/bedrock-client/loopback', async (req, res) => {
      try {
        const result = await bedrockClientController.setLoopbackEnabled(req.body?.enabled);
        if (!result.success) {
          return res.status(400).json({
            success: false,
            error: result.error,
            client: result.status,
          });
        }
        return res.json({ success: true, client: result.status });
      } catch (error) {
        return res.status(error instanceof TypeError ? 400 : 500).json({
          success: false,
          error: error instanceof TypeError
            ? error.message
            : 'Bedrock client access could not be changed.',
        });
      }
    });

    // Launcher configuration APIs (for Simple Setup UI)
    app.get('/api/launcher-config', async (_req, res) => {
      try {
        const { config } = await loadEffectiveLauncherConfig();
        res.json({
          success: true,
          config: getLauncherConfigSummary(config),
          providerKeys: getProviderKeyStatus(),
          providerKeySources: getProviderKeySources(),
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: String(error.message || error),
        });
      }
    });

    app.post('/api/launcher-config', async (req, res) => {
      try {
        const requested = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
          ? req.body
          : {};
        const persisted = safeMergeLauncherConfig(requested);
        const managedTarget = await getActiveManagedTarget();
        const updated = applyMinecraftTarget(persisted, managedTarget);
        res.json({
          success: true,
          config: {
            ...updated,
            runtime: {
              host: mindserverHost,
              port: mindserverPort,
            },
          },
        });
      } catch (error) {
        res.status(400).json({
          success: false,
          error: String(error.message || error),
        });
      }
    });

    const runManagedServerAction = async (res, action, { wireTarget = false } = {}) => {
      try {
        const status = await action();
        if (!wireTarget) return res.json({ success: true, server: status });
        const config = loadLauncherConfig({}, getLauncherConfigPath());
        return res.json({
          success: true,
          server: {
            ...status,
            target: resolveMinecraftTarget(config, status),
          },
        });
      } catch (error) {
        const statusCode = error instanceof ManagedMinecraftServerError ? 400 : 500;
        let status;
        try {
          status = await managedMinecraftServer.getStatus();
        } catch { /* preserve the original lifecycle error */ }
        return res.status(statusCode).json({
          success: false,
          error: String(error.message || error),
          ...(status ? { server: status } : {}),
        });
      }
    };

    const stopEverything = async () => {
      const result = await stopMindcraftRuntime({
        stopDirector: () => {
          director.shutdown();
          return { success: true };
        },
        stopTaskRunners: () => swarm.stop(),
        stopAgents: async () => {
          let squadError = null;
          try {
            await quiesceSquads(activeSquadPlan());
          } catch (error) {
            squadError = String(error?.message || error);
          }
          const agentResult = await mindcraft.stopAllAgentsAndWait();
          return {
            ...agentResult,
            success: !squadError && agentResult.success,
            error: [squadError, agentResult.error].filter(Boolean).join('; ') || null,
          };
        },
        stopMinecraft: () => managedMinecraftServer.stop(),
        stopLocalServices: () => localServiceOwner.stopAll(),
      });
      agentsStatusUpdate();
      return result;
    };

    const activeAgentNames = () => mindcraft.getActiveAgentNames();

    const stopAgentsAndWait = async (agentNames) => {
      const result = await mindcraft.stopAgentsAndWait(agentNames);
      agentsStatusUpdate();
      if (!result.success) {
        throw new ManagedMinecraftServerError(result.error || 'One or more bots did not stop.');
      }
      return result;
    };

    const resumeAgents = async (agentNames) => {
      const results = await Promise.all(agentNames.map(async (agentName) => {
        const result = await startAgentWithCurrentTarget(agentName);
        return [agentName, result];
      }));
      const failures = results
        .filter(([, result]) => !result?.success)
        .map(([agentName, result]) => `${agentName}: ${result?.error || 'start failed'}`);
      agentsStatusUpdate();
      if (failures.length) {
        throw new ManagedMinecraftServerError(`Minecraft is ready, but bot resume failed: ${failures.join('; ')}`);
      }
    };

    const activeSquadPlan = () => {
      const squads = botSquadManager.list().filter((squad) => (
        ['launching', 'starting', 'running', 'partial', 'stopping'].includes(squad.state)
      ));
      return {
        ids: squads.map(({ id }) => id),
        memberNames: new Set(squads.flatMap((squad) => (
          Array.isArray(squad.members) ? squad.members.map(({ name }) => name) : []
        ))),
      };
    };

    const waitForSquadIdle = async (id) => {
      if (typeof botSquadManager.waitForIdle !== 'function') return;
      let timeout;
      const settled = await Promise.race([
        Promise.resolve(botSquadManager.waitForIdle(id)).then(() => true),
        new Promise((resolve) => {
          timeout = setTimeout(() => resolve(false), 45_000);
        }),
      ]);
      clearTimeout(timeout);
      if (!settled) {
        throw new ManagedMinecraftServerError(`Squad ${id} did not settle before the Minecraft lifecycle change.`);
      }
    };

    const quiesceSquads = async (plan) => {
      for (const id of plan.ids) {
        const result = await Promise.resolve(botSquadManager.stop(id));
        if (!result?.success) {
          throw new ManagedMinecraftServerError(
            `Squad ${id} could not stop cleanly: ${result?.error || 'stop failed'}`,
          );
        }
      }
      await Promise.all(plan.ids.map((id) => waitForSquadIdle(id)));
    };

    const resumeSquads = async (ids) => {
      const failures = [];
      for (const id of ids) {
        const result = await Promise.resolve(botSquadManager.start(id));
        if (!result?.success) failures.push(`${id}: ${result?.error || 'start failed'}`);
      }
      if (failures.length) {
        throw new ManagedMinecraftServerError(`Minecraft is ready, but squad resume failed: ${failures.join('; ')}`);
      }
    };

    const restartManagedStack = async ({ settings } = {}) => {
      const squadPlan = activeSquadPlan();
      const resumeAgentNames = activeAgentNames().filter((name) => !squadPlan.memberNames.has(name));
      await quiesceSquads(squadPlan);
      await stopAgentsAndWait(activeAgentNames());
      if (settings) {
        await managedMinecraftServer.stop({ preserveDesiredState: true });
        await managedMinecraftServer.configure(settings);
        await managedMinecraftServer.start();
      } else {
        await managedMinecraftServer.restart();
      }
      const status = await managedMinecraftServer.waitForReady();
      await resumeAgents(resumeAgentNames);
      await resumeSquads(squadPlan.ids);
      return status;
    };

    const repairManagedCrossplay = async () => {
      if (typeof managedMinecraftServer.repairCrossplay !== 'function') {
        throw new ManagedMinecraftServerError('Bedrock repair is unavailable in this server adapter.');
      }
      const current = await managedMinecraftServer.getStatus();
      const wasRunning = current.phase === 'running';
      const squadPlan = activeSquadPlan();
      const resumeAgentNames = activeAgentNames().filter((name) => !squadPlan.memberNames.has(name));
      await quiesceSquads(squadPlan);
      await stopAgentsAndWait(activeAgentNames());
      if (wasRunning) {
        await managedMinecraftServer.stop({ preserveDesiredState: true });
      }
      let status = await managedMinecraftServer.repairCrossplay();
      if (wasRunning) {
        await managedMinecraftServer.start();
        status = await managedMinecraftServer.waitForReady();
        await resumeAgents(resumeAgentNames);
        await resumeSquads(squadPlan.ids);
      }
      return status;
    };

    app.post('/api/system/stop', async (_req, res) => {
      const result = await stopEverything();
      return res.status(result.success ? 200 : 500).json(result);
    });

    app.post('/api/minecraft-server/install', (req, res) => (
      runManagedServerAction(res, () => managedMinecraftServer.install(req.body || {}), { wireTarget: true })
    ));

    app.post('/api/minecraft-server/configure', (req, res) => (
      runManagedServerAction(res, () => managedMinecraftServer.configure(req.body || {}), { wireTarget: true })
    ));

    app.post('/api/minecraft-server/apply-settings', (req, res) => (
      runManagedServerAction(res, async () => {
        const settings = req.body || {};
        managedMinecraftServer.validateConfiguration(settings);
        const current = await managedMinecraftServer.getStatus();
        if (current.phase === 'running') return restartManagedStack({ settings });
        return managedMinecraftServer.configure(settings);
      }, { wireTarget: true })
    ));

    app.post('/api/minecraft-server/start', (_req, res) => (
      runManagedServerAction(res, async () => {
        await managedMinecraftServer.start();
        return managedMinecraftServer.waitForReady();
      }, { wireTarget: true })
    ));

    app.post('/api/minecraft-server/stop', (_req, res) => (
      runManagedServerAction(res, async () => {
        await quiesceSquads(activeSquadPlan());
        await stopAgentsAndWait(activeAgentNames());
        return managedMinecraftServer.stop();
      })
    ));

    app.post('/api/minecraft-server/restart', (_req, res) => (
      runManagedServerAction(res, () => restartManagedStack(), { wireTarget: true })
    ));

    app.post('/api/minecraft-server/repair-crossplay', (_req, res) => (
      runManagedServerAction(res, repairManagedCrossplay, { wireTarget: true })
    ));

    app.post('/api/minecraft-server/command', (req, res) => (
      runManagedServerAction(res, () => managedMinecraftServer.sendCommand(req.body?.command))
    ));

    app.post('/api/quickstart/local', async (req, res) => {
      try {
        const models = await discoverOllama();
        if (models.length === 0) {
          return res.status(409).json({
            success: false,
            error: 'Ollama is not reachable or has no installed models.',
          });
        }
        const existingConfig = loadLauncherConfig({}, getLauncherConfigPath());
        const requested = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
          ? req.body
          : {};
        const managedTarget = await getActiveManagedTarget();
        const quickstartInput = managedTarget
          ? {
              ...requested,
              host: existingConfig.agent_defaults.host,
              port: existingConfig.agent_defaults.port,
            }
          : requested;
        const plan = createLocalQuickstartPlan(quickstartInput, models, existingConfig);
        writeLocalQuickstartProfile(plan.profile);
        const config = writeLauncherConfig(plan.configUpdate, getLauncherConfigPath());
        return res.json({
          success: true,
          config: {
            ...config,
            runtime: {
              host: mindserverHost,
              port: mindserverPort,
            },
          },
          quickstart: summarizeLocalQuickstart(config, plan.profile),
          note: 'Local Ollama bot configured. Restart Mindcraft to start it.',
        });
      } catch (error) {
        const status = error instanceof LocalQuickstartValidationError ? 400 : 500;
        return res.status(status).json({
          success: false,
          error: status === 400 ? error.message : 'Unable to save local bot setup.',
        });
      }
    });

    app.post('/api/local-services/ollama/start', async (_req, res) => {
      try {
        const started = await localServiceOwner.startOllama();
        const { models } = started;
        if (models.length === 0) {
          return res.status(503).json({
            success: false,
            error: 'Ollama started but did not become ready. Open Ollama once, then try again.',
          });
        }
        return res.json({
          success: true,
          provider: {
            id: 'ollama',
            label: 'Ollama',
            available: true,
            owned: started.owned,
          },
          models,
          recommendation: recommendOllamaModels(models),
        });
      } catch {
        return res.status(500).json({
          success: false,
          error: 'Ollama could not be started. Confirm it is installed and available on PATH.',
        });
      }
    });

    // NOTE: /api/key-status was removed as dead surface — key presence is
    // reported by /api/launcher-config, /api/keys responses, and /api/health.

    // Save API keys from the setup wizard. Values are written to keys.json
    // (created from scratch if missing); presence-only is ever reported back.
    app.post('/api/keys', async (req, res) => {
      try {
        const body = req.body || {};
        const fsMod = await import('fs');
        const keysPath = path.join(process.cwd(), 'keys.json');
        let current = {};
        try { current = JSON.parse(fsMod.readFileSync(keysPath, 'utf8')); } catch { /* fresh file */ }
        let changed = 0;
        for (const name of LAUNCHER_KEY_PROVIDERS) {
          const v = body[name];
          if (typeof v === 'string') {
            const trimmed = v.trim();
            if (trimmed.length > 0) { current[name] = trimmed; changed++; }
            else if (v === '' && body[`${name}__clear`] === true) { delete current[name]; changed++; }
          }
        }
        if (changed === 0) {
          return res.status(400).json({ success: false, error: 'No key values provided' });
        }
        // Atomic write: temp file + rename prevents concurrent-save data loss
        // and partial writes (outside review CRIT-4).
        const tmpPath = `${keysPath}.tmp-${process.pid}-${Date.now()}`;
        fsMod.writeFileSync(tmpPath, JSON.stringify(current, null, 2), 'utf8');
        fsMod.renameSync(tmpPath, keysPath);
        res.json({
          success: true,
          changed,
          note: 'Keys saved and active immediately (hot-reloaded).',
          providerKeys: getProviderKeyStatus(),
          providerKeySources: getProviderKeySources(),
        });
      } catch (error) {
        res.status(500).json({ success: false, error: String(error.message || error) });
      }
    });

    // Health: single endpoint the dashboard polls to explain "why isn't my bot working".
    // The TCP probe result is cached for 5s so rapid polling can't flood the
    // Minecraft server with connections (outside review HIGH-1).
    let _mcProbeCache = { at: 0, target: '', reachable: false };
    app.get('/api/health', async (_req, res) => {
      const { config } = await loadEffectiveLauncherConfig();
      const keys = getProviderKeyStatus();
      const anyKey = Object.values(keys).some(Boolean);
      // keys.json file presence (env vars also count as keys)
      let keysFileExists = false;
      try {
        const fsMod = await import('fs');
        keysFileExists = fsMod.existsSync(path.join(process.cwd(), 'keys.json'));
      } catch { /* ignore */ }
      // Probe the configured Minecraft server (raw TCP; fast + version-agnostic)
      const mcHost = config.agent_defaults.host || '127.0.0.1';
      const mcPort = config.agent_defaults.port || 55916;
      const mcTarget = `${mcHost}:${mcPort}`;
      let mcReachable;
      if (_mcProbeCache.target === mcTarget && (Date.now() - _mcProbeCache.at) < 5000) {
        mcReachable = _mcProbeCache.reachable;
      } else {
        mcReachable = await new Promise((resolve) => {
          const netMod = net;
          const sock = netMod.createConnection({ host: mcHost, port: mcPort, timeout: 1200 }, () => {
            sock.end(); resolve(true);
          });
          sock.on('error', () => resolve(false));
          sock.on('timeout', () => { sock.destroy(); resolve(false); });
        });
        _mcProbeCache = { at: Date.now(), target: mcTarget, reachable: mcReachable };
      }
      const agents = [];
      for (const agentName in agent_connections) {
        const conn = agent_connections[agentName];
        const agentProcess = mindcraft.getAgentProcess(agentName);
        agents.push({
          name: agentName,
          in_game: conn.in_game,
          socket_connected: !!conn.socket,
          connection_stage: conn.stage,
          readiness_stage: agentProcess?.readinessStage || null,
        });
      }
      res.json(buildHealthStatus({
        anyApiKey: anyKey,
        keysFileExists,
        minecraftReachable: mcReachable,
        minecraftTarget: mcTarget,
        agents,
        selectedProfiles: mindcraft.getSelectedProfileReadiness(),
      }));
    });

    // ----- Realtime agent swarm (angry helpers) -----
    // GET  /api/swarm            -> list helpers
    // POST /api/swarm/deploy      -> { name, command, cwd, location, host, cycleIntervalMs, brain }
    // POST /api/swarm/recall/:id  -> remove a helper
    // POST /api/swarm/relocate/:id -> { cwd, location, host }
    // POST /api/swarm/pulse/:id   -> record a manual heartbeat (does not execute a command)
    app.get('/api/swarm', (_req, res) => {
      res.json({ success: true, helpers: swarm.list(), running: true });
    });

    app.post('/api/swarm/deploy', (req, res) => {
      try {
        const h = swarm.deploy(req.body || {});
        res.json({ success: true, helper: h.toJSON() });
      } catch (error) {
        res.status(400).json({ success: false, error: String(error && error.message ? error.message : error) });
      }
    });

    app.post('/api/swarm/recall/:id', (req, res) => {
      const r = swarm.recall(req.params.id);
      if (!r.ok) return res.status(404).json({ success: false, error: r.error });
      res.json({ success: true, id: req.params.id });
    });

    app.post('/api/swarm/relocate/:id', (req, res) => {
      const r = swarm.relocate(req.params.id, req.body || {});
      if (!r.ok) return res.status(r.error === 'not found' ? 404 : 400).json({ success: false, error: r.error });
      res.json({ success: true, id: req.params.id, ...r });
    });

    app.post('/api/swarm/pulse/:id', (req, res) => {
      const r = swarm.pulse(req.params.id);
      if (!r.ok) return res.status(404).json({ success: false, error: r.error });
      res.json({ success: true, id: req.params.id, ageMs: r.ageMs });
    });

    // ----- Director: program / direct / leash agents via REST -----
    // POST /api/director/command          -> { agent, message }
    // GET  /api/director/programs         -> list programs
    // POST /api/director/program          -> { agent, name, steps:[{message,delayMs}], loop }
    // POST /api/director/program/stop     -> { id } or { agent }
    // GET  /api/director/leashes          -> list leashes
    // POST /api/director/leash            -> { agent, message, intervalMs }
    // POST /api/director/unleash          -> { agent }
    app.post('/api/director/command', (req, res) => {
      const { agent, message } = req.body || {};
      const r = director.command(agent, message);
      res.status(r.ok ? 200 : 400).json({ success: r.ok, error: r.error || null });
    });

    app.get('/api/director/programs', (_req, res) => {
      res.json({ success: true, programs: director.listPrograms() });
    });

    app.post('/api/director/program', (req, res) => {
      const { agent, name, steps, loop } = req.body || {};
      const r = director.startProgram({ agentName: agent, name, steps, loop });
      res.status(r.ok ? 200 : 400).json({ success: r.ok, program: r.program || null, error: r.error || null });
    });

    app.post('/api/director/program/stop', (req, res) => {
      const { id, agent } = req.body || {};
      const r = director.stopProgram(id || agent);
      res.status(r.ok ? 200 : 404).json({ success: r.ok, stopped: r.stopped || [], error: r.error || null });
    });

    app.get('/api/director/leashes', (_req, res) => {
      res.json({ success: true, leashes: director.listLeashes() });
    });

    app.post('/api/director/leash', (req, res) => {
      const { agent, message, intervalMs } = req.body || {};
      const r = director.leash(agent, message, intervalMs);
      res.status(r.ok ? 200 : 400).json({ success: r.ok, leash: r.leash || null, error: r.error || null });
    });

    app.post('/api/director/unleash', (req, res) => {
      const { agent } = req.body || {};
      const r = director.unleash(agent);
      res.status(r.ok ? 200 : 404).json({ success: r.ok, error: r.error || null });
    });

    app.get('/api/squads/scenarios', (_req, res) => {
      res.json({
        success: true,
        scenarios: squadOrchestrator.listScenarios(),
        storage: squadScenarioStore.health?.() || { writable: true, error: null },
      });
    });

    app.get('/api/squads', (_req, res) => {
      res.json({
        success: true,
        squads: botSquadManager.list(),
        persistence: typeof botSquadManager.getPersistenceStatus === 'function'
          ? botSquadManager.getPersistenceStatus()
          : null,
      });
    });

    app.post('/api/squads/scenarios', (req, res) => {
      const result = squadOrchestrator.saveScenario(req.body || {});
      res.status(result.success ? 200 : 400).json(result);
    });

    app.post('/api/squads/scenarios/delete', (req, res) => {
      const result = squadOrchestrator.removeScenario(req.body?.id);
      res.status(result.success ? 200 : 404).json(result);
    });

    app.post('/api/squads/scenario', (req, res) => {
      const result = squadOrchestrator.launchScenario(req.body || {});
      res.status(result.success ? 202 : 400).json(result);
    });

    app.post('/api/squads/command', (req, res) => {
      const result = squadOrchestrator.dispatch(req.body?.id, req.body?.message);
      res.status(result.success ? 200 : 400).json(result);
    });

    app.post('/api/squads/behavior', (req, res) => {
      const result = squadOrchestrator.applyBehavior(req.body || {});
      res.status(result.success ? 200 : 400).json(result);
    });

    app.post('/api/squads/persona', (req, res) => {
      const result = squadOrchestrator.applyPersona(req.body || {});
      res.status(result.success ? 200 : 400).json(result);
    });

    // Agents summary for tooling (same data the dashboard sees via socket).
    app.get('/api/agents', (_req, res) => {
      res.json({ success: true, agents: serializePublicAgents() });
    });

    // The command registry pulls in the whole gameplay skill library, so it is
    // loaded on first request rather than at boot and cached afterwards. A
    // failure here costs the console its palette, never the control plane.
    let commandManifestCache = null;
    app.get('/api/commands', async (_req, res) => {
      if (commandManifestCache) {
        res.json({ success: true, commands: commandManifestCache });
        return;
      }
      try {
        const { getCommandManifest } = await import('../agent/commands/index.js');
        commandManifestCache = getCommandManifest();
        res.json({ success: true, commands: commandManifestCache });
      } catch (error) {
        res.status(500).json({
          success: false,
          commands: [],
          error: `Command list unavailable: ${String(error?.message || error).slice(0, 240)}`,
        });
      }
    });

    app.get('/api/agent-telemetry', (_req, res) => {
      const latest = {};
      for (const [agentName, state] of Object.entries(lastAgentStates)) {
        const connection = agent_connections[agentName];
        const sampledAt = Number.isFinite(Number(state?._meta?.sampledAt))
          ? Number(state._meta.sampledAt)
          : null;
        latest[agentName] = {
          sampledAt,
          transport: connection?.lastStatePushAt ? {
            status: 'push',
            receivedAt: connection.lastStatePushAt,
            deliveryMs: sampledAt === null
              ? null
              : Math.max(0, connection.lastStatePushAt - sampledAt),
            sequence: connection.lastStateSequence,
            pushes: connection.statePushCount,
          } : state?._meta?.transport || null,
          available: Boolean(state && !state.error),
        };
      }
      res.json({
        success: true,
        config: agentTelemetryConfig,
        listeners: agent_listeners.filter((listener) => listener?.connected).length,
        pump: listenerPump?.getStatus?.() || {
          state: 'stopped',
          intervalMs: agentTelemetryConfig.intervalMs,
        },
        latest,
      });
    });

    // Restart the launcher so changed settings in launcher-config.json take effect.
    // We respawn the current entrypoint (default main.js) preserving config path + cwd,
    // then shut the current process down after the child has taken over the port.
    let restarting = false;
    app.post('/api/restart', async (req, res) => {
      if (restarting) {
        res.json({ success: false, error: 'Restart already in progress' });
        return;
      }
      restarting = true;
      // Resolve the entrypoint reliably regardless of how this process was
      // launched (npm start, node main.js, or stdin-eval during tests):
      //   1. explicit LAUNCHER_ENTRY env (set by the .bat / wrapper)
      //   2. argv[1] if it looks like a script path (ends in .js)
      //   3. fall back to main.js in the current working directory
      // The remaining argv elements are forwarded as-is. This avoids WSL/
      // Windows path-translation bugs and works even when process.argv[1]
      // is not a real script file.
      const forwardedArgs = process.argv.slice(2);
      let entry;
      try {
        entry = resolveLauncherEntry();
      } catch (error) {
        restarting = false;
        res.status(500).json({
          success: false,
          error: String(error?.message || error),
        });
        return;
      }
      const childArgs = [entry, ...forwardedArgs];
      const squadPlan = activeSquadPlan();
      const resumeAgentNames = activeAgentNames().filter((name) => !squadPlan.memberNames.has(name));
      const resumeSquadIds = squadPlan.ids;
      const resumeLocalServices = [];
      const handoffPath = path.join(process.cwd(), 'server_data', 'launcher-restart.json');
      let handoffWritten = false;
      if (resumeAgentNames.length || resumeSquadIds.length) {
        try {
          mkdirSync(path.dirname(handoffPath), { recursive: true });
          writeJsonAtomicSync(handoffPath, {
            createdAt: Date.now(),
            resumeAgentNames,
            resumeSquadIds,
          });
          handoffWritten = true;
        } catch (error) {
          restarting = false;
          res.status(500).json({
            success: false,
            error: `Unable to preserve active bots for restart: ${error?.message || error}`,
          });
          return;
        }
      }

      const closeServerSockets = (preservedSocket = null) => {
        for (const socket of serverSockets) {
          if (socket === preservedSocket) continue;
          try {
            socket.destroy();
          } catch { /* best-effort cleanup */ }
        }
      };

      const removeHandoffMarker = () => {
        if (!handoffWritten) return;
        try {
          unlinkSync(handoffPath);
        } catch (error) {
          if (error?.code !== 'ENOENT') {
            console.warn('[launcher] Unable to remove failed restart marker:', error?.message || error);
          }
        }
      };

      const handoffToken = randomBytes(24).toString('hex');
      let replacementChild = null;
      const waitForReplacement = () => new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          replacementChild?.off?.('message', onMessage);
          replacementChild?.off?.('error', onError);
          replacementChild?.off?.('exit', onExit);
          callback(value);
        };
        const onMessage = (message) => {
          const readyPort = Number(message?.port);
          if (
            message?.type !== 'mindcraft-ready'
            || !tokensMatch(handoffToken, message?.token)
            || !Number.isInteger(readyPort)
            || readyPort < 1
            || readyPort > 65535
          ) {
            return;
          }
          if (readyPort !== mindserverPort) {
            finish(
              reject,
              new Error(`Replacement launcher claimed MindServer port ${readyPort}; expected active port ${mindserverPort}.`),
            );
            return;
          }
          finish(resolve, { port: readyPort, pid: replacementChild?.pid || null });
        };
        const onError = (error) => {
          finish(reject, new Error(`Replacement launcher could not start: ${error?.message || error}`));
        };
        const onExit = (code, signal) => {
          finish(
            reject,
            new Error(
              `Replacement launcher exited with code ${code ?? 'unknown'}`
              + `${signal ? ` (${signal})` : ''} before MindServer was ready.`,
            ),
          );
        };
        const timeout = setTimeout(() => {
          finish(reject, new Error('Replacement launcher handoff timed out before MindServer was ready.'));
        }, 120_000);
        timeout.unref?.();

        try {
          replacementChild = spawn(process.execPath, childArgs, {
            cwd: process.cwd(),
            windowsHide: true,
            env: {
              ...process.env,
              LAUNCHER_RESTARTING: '1',
              LAUNCHER_RESUME_AGENT_NAMES: JSON.stringify(resumeAgentNames),
              LAUNCHER_RESUME_SQUAD_IDS: JSON.stringify(resumeSquadIds),
              LAUNCHER_RESUME_LOCAL_SERVICES: JSON.stringify(resumeLocalServices),
              LAUNCHER_HANDOFF_PORT: String(mindserverPort),
              LAUNCHER_HANDOFF_TOKEN: handoffToken,
            },
            // The IPC channel proves application readiness; an OS-level
            // `spawn` event alone does not mean the dashboard is usable.
            detached: true,
            stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          });
          replacementChild.on('message', onMessage);
          replacementChild.once('error', onError);
          replacementChild.once('exit', onExit);
          replacementChild.unref();
        } catch (error) {
          finish(reject, new Error(`Replacement launcher could not start: ${error?.message || error}`));
        }
      });

      const stopReplacement = async () => {
        const child = replacementChild;
        if (!child || child.exitCode !== null || child.signalCode !== null) return;
        await terminateOwnedProcessTree(child, { timeoutMs: 2_000 });
      };

      const restoreOriginalStack = async () => {
        const warnings = [];
        try {
          if (!server.listening) await waitForMindServerListening(server, mindserverPort);
        } catch (error) {
          return {
            recovered: false,
            warnings: [`Original control-plane listener could not be restored: ${error?.message || error}`],
          };
        }
        try {
          if (typeof managedMinecraftServer.startIfDesired === 'function') {
            await managedMinecraftServer.startIfDesired();
          }
        } catch (error) {
          warnings.push(`Minecraft recovery failed: ${error?.message || error}`);
        }
        if (resumeLocalServices.includes('ollama')) {
          try {
            const restored = await localServiceOwner.startOllama();
            if (restored?.owned !== true) {
              warnings.push('Ollama recovery did not restore launcher ownership.');
            }
          } catch (error) {
            warnings.push(`Ollama recovery failed: ${error?.message || error}`);
          }
        }
        const stillActive = new Set(activeAgentNames());
        const agentsToRestore = resumeAgentNames.filter((agentName) => !stillActive.has(agentName));
        if (agentsToRestore.length) {
          try {
            await resumeAgents(agentsToRestore);
          } catch (error) {
            warnings.push(`Bot recovery failed: ${error?.message || error}`);
          }
        }
        if (resumeSquadIds.length) {
          try {
            await resumeSquads(resumeSquadIds);
          } catch (error) {
            warnings.push(`Squad recovery failed: ${error?.message || error}`);
          }
        }
        return { recovered: true, warnings };
      };

      let listenerClosed = false;
      try {
        await quiesceSquads(squadPlan);
        await stopAgentsAndWait(resumeAgentNames);
        const localServices = await localServiceOwner.stopAll();
        if (localServices?.ollama?.owned === true && localServices.ollama.stopped === true) {
          resumeLocalServices.push('ollama');
        }
        if (localServices?.success === false || (
          localServices?.ollama?.owned === true
          && localServices.ollama.stopped !== true
        )) {
          throw new Error(localServices?.ollama?.error || 'Launcher-owned local services did not stop cleanly for restart.');
        }
        await managedMinecraftServer.stop({ preserveDesiredState: true });

        // Existing HTTP responses remain valid after `close()`. Keep this
        // request socket alive long enough to report the verified handoff.
        closeServerSockets(req.socket);
        server.close();
        listenerClosed = true;
        await new Promise((resolve) => setImmediate(resolve));

        const ready = await waitForReplacement();
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (
          !replacementChild
          || replacementChild.exitCode !== null
          || replacementChild.signalCode !== null
        ) {
          throw new Error('Replacement launcher exited during the readiness handoff.');
        }
        try {
          if (replacementChild?.connected) replacementChild.disconnect();
        } catch { /* child may have closed IPC after sending readiness */ }

        const finishOldProcess = (() => {
          let finished = false;
          return () => {
            if (finished) return;
            finished = true;
            try { req.socket.destroySoon?.(); } catch { /* response already closed */ }
            const exitTimer = setTimeout(() => process.exit(0), 250);
            exitTimer.unref?.();
          };
        })();
        if (res.destroyed || req.socket.destroyed) {
          finishOldProcess();
        } else {
          res.once('finish', finishOldProcess);
          res.once('close', finishOldProcess);
          res.setHeader('Connection', 'close');
          res.json({
            success: true,
            message: 'Replacement control center is ready',
            handoff: 'replacement-ready',
            previousPid: process.pid,
            replacementPid: ready.pid,
            resumeAgentNames,
            resumeSquadIds,
            resumeLocalServices,
            resumeStatus: (resumeAgentNames.length || resumeSquadIds.length || resumeLocalServices.length)
              ? 'requested'
              : 'not-needed',
            port: ready.port,
          });
        }
      } catch (error) {
        await stopReplacement();
        removeHandoffMarker();
        // Quiescing bots/squads happens before the listener is closed. Even an
        // early managed-server failure therefore requires a real restoration
        // pass; a listening HTTP socket is not proof that gameplay recovered.
        const recovery = await restoreOriginalStack();
        restarting = false;
        const detail = String(error?.message || error);
        console.error('[launcher] Restart handoff failed:', detail);
        if (!res.headersSent && !res.writableEnded) {
          res.status(listenerClosed ? 502 : 500).json({
            success: false,
            recovered: recovery.recovered,
            error: recovery.recovered
              ? `${detail} The original control center was restored.`
              : detail,
            ...(recovery.warnings.length ? { recoveryWarnings: recovery.warnings } : {}),
          });
        }
      }
    });

    // Texture proxy: resolve item/block textures using minecraft-assets with version fallback
    app.get('/assets/item/:agent/:name.png', async (req, res) => {
        try {
            const agentName = req.params.agent;
            const rawName = req.params.name;
            const itemName = String(rawName).toLowerCase();
            const conn = agent_connections[agentName];
            const preferred = conn?.settings?.minecraft_version;
            const candidates = [];
            if (preferred && preferred !== 'auto') candidates.push(preferred);
            candidates.push('1.21.8');

            // Lazy import to avoid ESM/CJS conflicts
            const mod = await import('minecraft-assets');
            const mcAssetsFactory = mod.default || mod;

            for (const ver of candidates) {
                try {
                    const assets = mcAssetsFactory(ver);
                    // Prefer items path first, then blocks
                    const item = assets.items[itemName];
                    const block = assets.blocks[itemName];
                    const tex = assets.textureContent?.[itemName]?.texture
                        || (item ? assets.textureContent?.[itemName]?.texture : null)
                        || (block ? assets.textureContent?.[itemName]?.texture : null);
                    if (tex) {
                        // textureContent already provides a data URL in many versions
                        if (tex.startsWith('data:image')) {
                            const base64 = tex.split(',')[1];
                            const img = globalThis.Buffer.from(base64, 'base64');
                            res.setHeader('Content-Type', 'image/png');
                            return res.end(img);
                        }
                    }
                    // If textureContent missing, try static path resolution inside package
                    // Helps with some strange blocks like Leaf Litter
                    const guessPaths = [];
                    const base = assets.directory;
                    guessPaths.push(path.join(base, 'items', `${itemName}.png`));
                    guessPaths.push(path.join(base, 'blocks', `${itemName}.png`));
                    for (const p of guessPaths) {
                        try {
                            const fsMod = await import('fs');
                            const buf = fsMod.readFileSync(p);
                            res.setHeader('Content-Type', 'image/png');
                            return res.end(buf);
                        } catch { /* ignore */ }
                    }
                } catch { /* ignore */ }
            }
            // Not found, fallback svg
            res.setHeader('Content-Type', 'image/svg+xml');
            res.status(404).send('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="100%" height="100%" fill="#444"/><text x="50%" y="55%" font-size="12" fill="#bbb" text-anchor="middle">?</text></svg>');
        } catch (e) {
            res.setHeader('Content-Type', 'image/svg+xml');
            res.status(500).send('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="100%" height="100%" fill="#444"/><text x="50%" y="55%" font-size="12" fill="#bbb" text-anchor="middle">!</text></svg>');
        }
    });

    candidateIo.use((socket, next) => {
        const auth = socket.handshake?.auth;
        if (auth?.role !== 'agent') {
            socket.data.role = 'dashboard';
            return next();
        }
        const agentName = typeof auth.agentName === 'string' ? auth.agentName : '';
        if (!agentName || !tokensMatch(agent_connections[agentName]?.processToken, auth.token)) {
            return next(new Error('Agent authentication failed.'));
        }
        socket.data.role = 'agent';
        socket.data.agentName = agentName;
        return next();
    });

    // Socket.io connection handling
    candidateIo.on('connection', (socket) => {
        let curAgentName = isAgentSocket(socket) ? socket.data.agentName : null;
        console.log('Client connected');

        agentsStatusUpdate(socket);

        socket.on('create-agent', async (settings, callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            console.log('API create agent...');
            const reply = typeof callback === 'function' ? callback : () => {};
            try {
                let normalizedSettings = normalizeAgentSettings(settings, settings_spec);
                const agentName = normalizedSettings.profile.name;
                const existingProcess = mindcraft.getAgentProcess(agentName);
                if (existingProcess && (existingProcess.isActive?.() || existingProcess.running)) {
                    reply({ success: false, error: 'Agent already exists' });
                    return;
                }
                const activeTarget = await getActiveManagedTarget();
                if (activeTarget) {
                    normalizedSettings = { ...normalizedSettings, ...targetSettings(activeTarget) };
                }
                const returned = await mindcraft.createAgent(normalizedSettings);
                reply({ success: returned.success, error: returned.error });
                agentsStatusUpdate();
            } catch (error) {
                console.warn('[agents] Create request rejected:', error?.message || error);
                reply({ success: false, error: String(error?.message || error) });
            }
        });

        socket.on('get-settings', (agentName, callback) => {
            const reply = typeof callback === 'function' ? callback : () => {};
            if (isAgentSocket(socket) && !ownsAgentIdentity(socket, agentName)) {
                reply({ error: 'Requested settings do not match the authenticated agent identity.' });
                return;
            }
            const validation = validateAgentName(agentName);
            if (!validation.success) {
                reply({ error: validation.error });
                return;
            }
            agentName = validation.name;
            if (agent_connections[agentName]) {
                reply({ settings: agent_connections[agentName].settings });
            } else {
                reply({ error: `Agent '${agentName}' not found.` });
            }
        });

        socket.on('connect-agent-process', (agentName) => {
            if (ownsAgentIdentity(socket, agentName) && agent_connections[agentName]) {
                agent_connections[agentName].socket = socket;
                agent_connections[agentName].stage = 'bridge_connected';
                mindcraft.getAgentProcess(agentName)?.markReadinessStage?.('bridge_connected');
                agentsStatusUpdate();
            }
        });

        socket.on('login-agent', (agentName) => {
            if (ownsAgentIdentity(socket, agentName) && agent_connections[agentName]) {
                resetAgentStateCache(agent_connections[agentName]);
                agent_connections[agentName].socket = socket;
                agent_connections[agentName].in_game = false;
                agent_connections[agentName].stage = 'minecraft_login';
                agent_connections[agentName].lastStatePushAt = 0;
                agent_connections[agentName].lastStateSequence = 0;
                agent_connections[agentName].statePushCount = 0;
                mindcraft.getAgentProcess(agentName)?.markReadinessStage?.('minecraft_login');
                curAgentName = agentName;
                agentsStatusUpdate();
            }
            else {
                console.warn(`Unregistered agent ${agentName} tried to login`);
            }
        });

        socket.on('ready-agent', (agentName, callback) => {
            const reply = typeof callback === 'function' ? callback : () => {};
            const connection = agent_connections[agentName];
            const agentProcess = mindcraft.getAgentProcess(agentName);
            if (!ownsAgentIdentity(socket, agentName) || !connection || connection.socket !== socket) {
                reply({ success: false, error: 'World-ready identity does not own the registered agent connection.' });
                return;
            }
            if (!agentProcess?.markReady?.()) {
                reply({ success: false, error: `Agent '${agentName}' no longer owns an active startup attempt.` });
                return;
            }
            resetAgentStateCache(connection);
            connection.socket = socket;
            connection.in_game = true;
            connection.stage = 'world_ready';
            curAgentName = agentName;
            agentsStatusUpdate();
            socket.emit('state-stream-demand', agent_listeners.length > 0);
            reply({ success: true, error: null });
        });

        socket.on('disconnect', () => {
            if (agent_connections[curAgentName]?.socket === socket) {
                console.log(`Agent ${curAgentName} disconnected`);
                agent_connections[curAgentName].in_game = false;
                agent_connections[curAgentName].socket = null;
                agent_connections[curAgentName].stage = 'disconnected';
                agent_connections[curAgentName].lastStatePushAt = 0;
                agent_connections[curAgentName].lastStateSequence = 0;
                resetAgentStateCache(agent_connections[curAgentName]);
                delete lastAgentStates[curAgentName];
                agentsStatusUpdate();
            }
            if (agent_listeners.includes(socket)) {
                removeListener(socket);
            }
        });

        socket.on('chat-message', (agentName, json) => {
            if (!agent_connections[agentName]) {
                console.warn(`Agent ${agentName} tried to send a message but is not logged in`);
                return;
            }
            if (isAgentSocket(socket)) {
                const sourceName = socket.data.agentName;
                if (agent_connections[sourceName]?.socket !== socket) {
                    console.warn(`Unauthenticated agent relay attempt from ${sourceName || 'unknown'}`);
                    return;
                }
            }
            const conn = agent_connections[agentName];
            if (!conn || !conn.socket) {
                console.warn(`Agent ${agentName} has no live socket, cannot send message`);
                return;
            }
            const msg = boundedString(json?.message, MAX_RELAY_MESSAGE_LENGTH);
            if (!msg) {
                console.warn('Rejected empty or oversized agent relay message');
                return;
            }
            const senderName = isAgentSocket(socket) ? socket.data.agentName : 'ADMIN';
            console.log(`${senderName} sending message to ${agentName}: ${msg}`);
            conn.socket.emit('chat-message', senderName, {
                message: msg,
                start: json?.start === true,
                end: json?.end === true,
            });
        });

        socket.on('squad-radio', (payload, callback) => {
            const reply = typeof callback === 'function' ? callback : () => {};
            if (isAgentSocket(socket)) {
                const sourceName = socket.data.agentName;
                if (!agent_connections[sourceName]?.socket || agent_connections[sourceName].socket !== socket) {
                    reply({ success: false, error: 'This agent socket is not the active squad radio connection.' });
                    return;
                }
                reply(relaySquadRadio({ sourceName, message: payload?.message, kind: payload?.kind }));
                return;
            }
            reply(relaySquadRadio({
                squadId: payload?.squadId,
                message: payload?.message,
                kind: payload?.kind || 'order',
                notifySocket: socket,
            }));
        });

        socket.on('set-agent-settings', async (agentName, settings, callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            const reply = typeof callback === 'function' ? callback : () => {};
            agentName = requireValidDashboardAgentName(agentName, reply);
            if (!agentName) return;
            reply(await applyAgentSettings(agentName, settings));
        });

        socket.on('restart-agent', async (agentName, callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            agentName = requireValidDashboardAgentName(agentName, callback);
            if (!agentName) return;
            console.log(`Restarting agent: ${agentName}`);
            let result;
            try {
                result = await startAgentWithCurrentTarget(agentName);
                if (!result || typeof result.success !== 'boolean') {
                    throw new Error(`Agent '${agentName}' restart did not return a lifecycle result.`);
                }
            } catch (error) {
                console.warn(`[agents] Restart for ${agentName} failed:`, error?.message || error);
                result = {
                    success: false,
                    error: String(error?.message || error),
                };
            }
            if (typeof callback === 'function') callback(result);
            agentsStatusUpdate();
        });

        socket.on('stop-agent', async (agentName, callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            agentName = requireValidDashboardAgentName(agentName, callback);
            if (!agentName) return;
            const result = mindcraft.getAgentProcess(agentName)
              ? await mindcraft.stopAgentsAndWait([agentName])
              : { success: false, error: `Agent '${agentName}' not found`, agents: [] };
            if (typeof callback === 'function') callback(result);
            agentsStatusUpdate();
        });

        socket.on('start-agent', async (agentName, callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            agentName = requireValidDashboardAgentName(agentName, callback);
            if (!agentName) return;
            const result = await startAgentWithCurrentTarget(agentName);
            if (typeof callback === 'function') callback(result);
            agentsStatusUpdate();
        });

        socket.on('destroy-agent', async (agentName, callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            agentName = requireValidDashboardAgentName(agentName, callback);
            if (!agentName) return;
            const result = await mindcraft.destroyAgentAndWait(agentName);
            if (typeof callback === 'function') callback(result);
            agentsStatusUpdate();
        });

        socket.on('stop-all-agents', async (callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            console.log('Stopping all agents');
            const result = await mindcraft.stopAllAgentsAndWait();
            agentsStatusUpdate();
            if (typeof callback === 'function') callback(result);
        });

        const runSquadAction = async (callback, action) => {
            const reply = typeof callback === 'function' ? callback : () => {};
            try {
                reply(await Promise.resolve(action()));
            } catch (error) {
                reply({
                    success: false,
                    error: String(error?.message || error).slice(0, 320),
                });
            }
            agentsStatusUpdate();
        };

        socket.on('squad-list', (callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            const reply = typeof callback === 'function' ? callback : () => {};
            reply({
                success: true,
                squads: botSquadManager.list(),
                persistence: typeof botSquadManager.getPersistenceStatus === 'function'
                    ? botSquadManager.getPersistenceStatus()
                    : null,
            });
        });

        socket.on('squad-launch', (spec, callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            void runSquadAction(callback, () => botSquadManager.launch(spec || {}));
        });

        // A bot asking for help. Until now the only way to put a bot in the
        // world was the dashboard, so a player in game could not say "bring
        // someone to help me dig" without leaving the game.
        //
        // This is the one place where untrusted Minecraft chat can start a
        // process, so it is bounded on every axis: only a live agent socket may
        // ask, one request per bot per cooldown, and the squad manager's own
        // session and size caps decide how many bots may exist at all.
        socket.on('agent-spawn-request', (spec, callback) => {
            const reply = typeof callback === 'function' ? callback : () => {};
            if (!isAgentSocket(socket)) {
                reply({ success: false, error: 'Only a connected bot may request help.' });
                return;
            }
            const sourceName = socket.data.agentName;
            if (agent_connections[sourceName]?.socket !== socket) {
                reply({ success: false, error: 'This agent socket is not the active connection.' });
                return;
            }
            const now = Date.now();
            const readyAt = Number(agent_spawn_cooldowns.get(sourceName)) || 0;
            if (now < readyAt) {
                reply({
                    success: false,
                    error: `Wait ${Math.ceil((readyAt - now) / 1000)}s before asking for more bots.`,
                });
                return;
            }
            void runSquadAction(callback, () => {
                const result = botSquadManager.launch({
                    // An agent may clone only its own server-owned settings. Do
                    // not trust a requested template name from Minecraft chat.
                    templateName: sourceName,
                    prefix: spec?.prefix,
                    size: spec?.size,
                    staggerMs: 750,
                    identity: { displayName: spec?.displayName || spec?.prefix },
                });
                // A typo or occupied prefix should be immediately correctable;
                // only a launch that actually reserved bots consumes cooldown.
                if (result?.success) {
                    agent_spawn_cooldowns.set(sourceName, now + AGENT_SPAWN_COOLDOWN_MS);
                }
                return result;
            });
        });

        socket.on('squad-stop', (id, callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            void runSquadAction(callback, () => botSquadManager.stop(id));
        });

        socket.on('squad-start', (id, callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            void runSquadAction(callback, () => botSquadManager.start(id));
        });

        socket.on('squad-remove', (id, callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            void runSquadAction(callback, () => botSquadManager.remove(id));
        });

        socket.on('squad-scenarios', (callback) => {
          if (!requireDashboardSocket(socket, callback)) return;
          const reply = typeof callback === 'function' ? callback : () => {};
          reply({ success: true, scenarios: squadOrchestrator.listScenarios() });
        });

        socket.on('squad-save-scenario', (spec, callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            void runSquadAction(callback, () => squadOrchestrator.saveScenario(spec || {}));
        });

        socket.on('squad-delete-scenario', (id, callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            void runSquadAction(callback, () => squadOrchestrator.removeScenario(id));
        });

        socket.on('squad-launch-scenario', (spec, callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            void runSquadAction(callback, () => squadOrchestrator.launchScenario(spec || {}));
        });

        socket.on('squad-command', (spec, callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            void runSquadAction(callback, () => squadOrchestrator.dispatch(spec?.id, spec?.message));
        });

        socket.on('squad-behavior', (spec, callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            void runSquadAction(callback, () => squadOrchestrator.applyBehavior(spec || {}));
        });

        socket.on('squad-persona', (spec, callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            void runSquadAction(callback, () => squadOrchestrator.applyPersona(spec || {}));
        });

        // ----- Realtime agent swarm control over Socket.io -----
        socket.on('swarm-list', (callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            callback({ success: true, helpers: swarm.list() });
        });
        socket.on('swarm-deploy', (spec, callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            try {
                const h = swarm.deploy(spec || {});
                callback({ success: true, helper: h.toJSON() });
            } catch (e) {
                callback({ success: false, error: String(e && e.message ? e.message : e) });
            }
        });
        socket.on('swarm-recall', (id, callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            const r = swarm.recall(id);
            callback(r.ok ? { success: true, id } : { success: false, error: r.error });
        });
        socket.on('swarm-relocate', (id, opts, callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            const r = swarm.relocate(id, opts || {});
            callback(r.ok ? { success: true, id, ...r } : { success: false, error: r.error });
        });
        socket.on('swarm-pulse', (id, callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            const r = swarm.pulse(id);
            callback(r.ok ? { success: true, id, ageMs: r.ageMs } : { success: false, error: r.error });
        });

        // ----- Director control over Socket.io -----
        socket.on('director-command', (agent, message, callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            const r = director.command(agent, message);
            if (callback) callback({ success: r.ok, error: r.error || null });
        });
        socket.on('director-program', (spec, callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            const r = director.startProgram({
                agentName: spec?.agent, name: spec?.name, steps: spec?.steps, loop: spec?.loop,
            });
            if (callback) callback({ success: r.ok, program: r.program || null, error: r.error || null });
        });
        socket.on('director-program-stop', (idOrAgent, callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            const r = director.stopProgram(idOrAgent);
            if (callback) callback({ success: r.ok, stopped: r.stopped || [], error: r.error || null });
        });
        socket.on('director-leash', (spec, callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            const r = director.leash(spec?.agent, spec?.message, spec?.intervalMs);
            if (callback) callback({ success: r.ok, leash: r.leash || null, error: r.error || null });
        });
        socket.on('director-unleash', (agent, callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            const r = director.unleash(agent);
            if (callback) callback({ success: r.ok, error: r.error || null });
        });
        socket.on('director-state', (callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            if (callback) callback({
                success: true,
                programs: director.listPrograms(),
                leashes: director.listLeashes(),
            });
        });

        socket.on('shutdown', async (callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            console.log('Shutting down');
            const result = await stopEverything();
            if (typeof callback === 'function') callback(result);
            if (!result.success) return;
            setTimeout(() => {
                console.log('Exiting MindServer');
                globalThis.process.exit(0);
            }, 500);

        });

		socket.on('send-message', async (agentName, data, callback) => {
            if (!requireDashboardSocket(socket, callback)) return;
            const reply = (result) => {
                if (typeof callback === 'function') callback(result);
            };
            agentName = requireValidDashboardAgentName(agentName, reply);
            if (!agentName) return;
            const connection = agent_connections[agentName];
			try {
                const message = boundedString(data?.message ?? data, MAX_RELAY_MESSAGE_LENGTH);
                if (!message) {
                    console.warn('Rejected empty or oversized dashboard message');
                    reply({ success: false, error: 'Bot messages must be present and within the message limit.' });
                    return;
                }
                const modelCommand = parseDashboardModelCommand(message);
                if (modelCommand) {
                    if (!connection) {
                        reply({ success: false, command: 'model', error: `Agent '${agentName}' not found.` });
                        return;
                    }
                    if (modelCommand.error) {
                        reply({ success: false, command: 'model', error: modelCommand.error });
                        return;
                    }
                    const currentSettings = mindcraft.getAgentSettings(agentName) || connection.settings;
                    const previousModel = modelNameFromSettings(currentSettings);
                    if (!modelCommand.model) {
                        reply({
                            success: true,
                            command: 'model',
                            model: previousModel,
                            message: previousModel
                                ? `Current model: ${previousModel}. Use !model <model-name> to change it.`
                                : 'No model is configured. Use !model <model-name> to set one.',
                        });
                        return;
                    }
                    const result = await applyAgentSettings(
                        agentName,
                        settingsWithSelectedModel(currentSettings, modelCommand.model),
                    );
                    const model = modelCommand.model;
                    reply({
                        ...result,
                        command: 'model',
                        previousModel,
                        model,
                        message: result.success
                            ? `Model changed from ${previousModel || 'unconfigured'} to ${model}; ${
                                result.restarted ? 'bot restart started' : 'the change will activate on next start'
                            }.`
                            : result.error,
                    });
                    return;
                }
                if (!connection?.socket || connection.socket.connected === false) {
                    console.warn(`Agent ${agentName} not in game or no socket, cannot send message via MindServer.`);
                    reply({ success: false, error: `Bot '${agentName}' is not connected to the Java world.` });
                    return;
                }
                connection.socket.emit('send-message', {
                    from: 'ADMIN',
                    message,
                });
                reply({ success: true, agentName, acceptedAt: Date.now() });
			} catch (error) {
				const detail = String(error?.message || error || 'relay failed').slice(0, 320);
				console.error(`Unable to relay dashboard message to ${agentName}:`, detail);
                reply({ success: false, error: `MindServer could not relay the message: ${detail}` });
			}
		});

        socket.on('bot-output', (agentName, message) => {
            if (!ownsAgentIdentity(socket, agentName) || agent_connections[agentName]?.socket !== socket) return;
            const output = boundedString(message, MAX_BOT_OUTPUT_LENGTH);
            if (output) io.emit('bot-output', agentName, output);
        });

        socket.on('agent-state', (payload) => {
            const agentName = socket.data?.agentName;
            const connection = agent_connections[agentName];
            const state = payload?.state;
            const sequence = Number(payload?.sequence);
            if (
                !ownsAgentIdentity(socket, agentName)
                || connection?.socket !== socket
                || connection.in_game !== true
                || !state
                || typeof state !== 'object'
                || Array.isArray(state)
                || state.name !== agentName
                || !Number.isSafeInteger(sequence)
                || sequence <= connection.lastStateSequence
            ) return;
            connection.lastStateSequence = sequence;
            connection.lastStatePushAt = Date.now();
            connection.statePushCount += 1;
            lastAgentStates[agentName] = state;
            publishAgentStates(currentLiveAgentStates());
        });

        socket.on('listen-to-agents', () => {
            if (!requireDashboardSocket(socket)) return;
            addListener(socket);
        });
    });

    const host = 'localhost';
    await waitForMindServerListening(candidateServer, port);
    server = candidateServer;
    io = candidateIo;
    mindserverHost = host;
    mindserverPort = candidateServer.address().port;
    console.log(`MindServer running on port ${mindserverPort} on host ${host}`);

    // Start the realtime agent swarm (heartbeat + cycle + mobility).
    swarm.setBrainHook(defaultBrainHook);
    swarm.start();
    const controlSubscriptions = [];
    const subscribe = (emitter, event, handler) => {
        emitter.on(event, handler);
        controlSubscriptions.push({ emitter, event, handler });
    };
    subscribe(swarm, 'change', () => {
        try { candidateIo.emit('swarm-update', swarm.list()); } catch { /* server is closing */ }
    });
    subscribe(swarm, 'deploy', (h) => { try { candidateIo.emit('swarm-event', { type: 'deploy', helper: h }); } catch {} });
    subscribe(swarm, 'recall', (e) => { try { candidateIo.emit('swarm-event', { type: 'recall', ...e }); } catch {} });
    subscribe(swarm, 'relocate', (e) => { try { candidateIo.emit('swarm-event', { type: 'relocate', ...e }); } catch {} });
    subscribe(swarm, 'stale', (e) => { try { candidateIo.emit('swarm-event', { type: 'stale', ...e }); } catch {} });

    // Wire director transport: route messages through the agent's socket,
    // exactly like the dashboard's chat box does.
    director.setSender((agentName, message) => {
        const conn = agent_connections[agentName];
        if (!conn) return { ok: false, error: `agent '${agentName}' not registered` };
        if (!conn.socket) return { ok: false, error: `agent '${agentName}' has no live socket` };
        conn.socket.emit('send-message', { from: 'Director', message });
        return { ok: true };
    });
    subscribe(director, 'command', (e) => { try { candidateIo.emit('director-event', { type: 'command', ...e }); } catch {} });
    subscribe(director, 'program', (e) => { try { candidateIo.emit('director-event', { type: 'program', ...e }); } catch {} });
    subscribe(director, 'leash', (e) => { try { candidateIo.emit('director-event', { type: 'leash', ...e }); } catch {} });
    candidateServer.once('close', () => {
        for (const { emitter, event, handler } of controlSubscriptions) emitter.off(event, handler);
        if (server === candidateServer) director.setSender(null);
    });

    Object.defineProperty(candidateServer, 'mindcraftControl', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: Object.freeze({
        resumeSquads: async (ids = []) => {
          const requested = [...new Set(Array.isArray(ids) ? ids.map((id) => String(id || '')) : [])]
            .filter((id) => /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))
            .slice(0, 64);
          const results = [];
          for (const id of requested) {
            const initial = await Promise.resolve(botSquadManager.start(id));
            if (!initial?.success) {
              results.push({ id, success: false, error: String(initial?.error || 'Squad start failed.').slice(0, 320) });
              continue;
            }
            try {
              let timeoutId;
              const settled = await Promise.race([
                botSquadManager.waitForIdle(id),
                new Promise((resolve) => {
                  timeoutId = setTimeout(() => resolve(null), 60_000);
                }),
              ]);
              clearTimeout(timeoutId);
              if (!settled) {
                results.push({ id, success: false, state: 'starting', error: 'Squad resume did not settle within 60 seconds.' });
                continue;
              }
              const squad = botSquadManager.get(id);
              const success = squad?.state === 'running';
              results.push({
                id,
                success,
                state: squad?.state || 'missing',
                error: success ? null : `Squad settled in state '${squad?.state || 'missing'}'.`,
              });
            } catch (error) {
              results.push({ id, success: false, error: String(error?.message || error).slice(0, 320) });
            }
          }
          const failures = results.filter((result) => !result.success);
          return {
            success: failures.length === 0,
            requested: requested.length,
            resumed: results.length - failures.length,
            results,
            ...(failures.length ? { error: `${failures.length} persisted squad(s) did not resume.` } : {}),
          };
        },
      }),
    });

    return candidateServer;
}

function agentsStatusUpdate(socket) {
    if (!socket) {
        socket = io;
    }
    if (!socket || typeof socket.emit !== 'function') return;
    socket.emit('agents-status', serializePublicAgents());
}


let listenerPump = null;
let lastStateFingerprint = '';
let lastStatePublishedAt = 0;

function currentLiveAgentStates(additional = {}) {
    const states = {};
    for (const [agentName, connection] of Object.entries(agent_connections)) {
        if (!connection?.in_game) continue;
        const state = additional[agentName] || lastAgentStates[agentName];
        if (state) states[agentName] = state;
    }
    return states;
}

function publishAgentStates(states) {
    const now = Date.now();
    lastAgentStates = states;
    const fingerprint = fingerprintAgentStates(states);
    if (
        fingerprint === lastStateFingerprint
        && now - lastStatePublishedAt < agentTelemetryConfig.heartbeatMs
    ) return false;
    lastStateFingerprint = fingerprint;
    lastStatePublishedAt = now;
    const room = io?.to?.(AGENT_TELEMETRY_ROOM);
    if (room?.volatile?.emit) {
        room.volatile.emit('state-update', states);
        return true;
    }
    for (const listener of agent_listeners) {
        if (listener?.connected) {
            try { listener.emit('state-update', states); } catch { /* stale listener */ }
        }
    }
    return true;
}

function addListener(listener_socket) {
    if (!listener_socket || agent_listeners.includes(listener_socket)) return;
    agent_listeners.push(listener_socket);
    try {
        listener_socket.join?.(AGENT_TELEMETRY_ROOM);
    } catch {
        // The explicit listener list remains the fallback delivery path.
    }
    if (Object.keys(lastAgentStates).length > 0) {
        try {
            listener_socket.emit('state-update', lastAgentStates);
        } catch {
            // A just-disconnected dashboard will be removed by its socket event.
        }
    }
    if (agent_listeners.length === 1) {
        lastStateFingerprint = '';
        lastStatePublishedAt = 0;
        listenerPump ??= createAgentStatePump({
            collect: () => collectAgentStates(selectAgentConnectionsForPolling(agent_connections, {
                staleAfterMs: Math.max(
                    agentTelemetryConfig.heartbeatMs * 2,
                    agentTelemetryConfig.intervalMs * 3,
                ),
            }), agentTelemetryConfig),
            publish: (states) => publishAgentStates(currentLiveAgentStates(states)),
            onError: (error) => {
                console.warn('[agents] State sampling failed:', error?.message || error);
            },
            shouldContinue: () => agent_listeners.length > 0,
            intervalMs: agentTelemetryConfig.intervalMs,
        });
        for (const connection of Object.values(agent_connections)) {
            if (connection?.in_game && connection.socket?.connected !== false) {
                connection.socket.emit('state-stream-demand', true);
            }
        }
        listenerPump.start();
    }
}

function removeListener(listener_socket) {
    const idx = agent_listeners.indexOf(listener_socket);
    if (idx >= 0) {
        agent_listeners.splice(idx, 1);
    }
    try {
        listener_socket?.leave?.(AGENT_TELEMETRY_ROOM);
    } catch {
        // Socket.IO also removes disconnected sockets from rooms automatically.
    }
    if (agent_listeners.length === 0) {
        listenerPump?.stop();
        for (const connection of Object.values(agent_connections)) {
            if (connection?.socket?.connected !== false) {
                connection.socket?.emit?.('state-stream-demand', false);
            }
        }
        lastAgentStates = {};
        lastStateFingerprint = '';
        lastStatePublishedAt = 0;
    }
}

// Optional: export these if you need access to them from other files
export const getIO = () => io;
export const getServer = () => server;
export const numStateListeners = () => agent_listeners.length;
