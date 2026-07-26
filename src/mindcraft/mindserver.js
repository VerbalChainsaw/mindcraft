import { Server } from 'socket.io';
import express from 'express';
import http from 'http';
import net from 'net';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import * as mindcraft from './mindcraft.js';
import { hasKey } from '../utils/keys.js';
import { loadLauncherConfig, writeLauncherConfig, getLauncherConfigPath } from './launcher-config.js';
import { swarm, defaultBrainHook } from './swarm/swarm.js';
import { director } from './director.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mindserver is:
// - central hub for communication between all agent processes
// - api to control from other languages and remote users 
// - host for webapp

let io;
let server;
const agent_connections = {};
const agent_listeners = [];
let mindserverHost = 'localhost';
let mindserverPort = 8080;

const settings_spec = JSON.parse(readFileSync(path.join(__dirname, 'public/settings_spec.json'), 'utf8'));

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
];

function getLauncherConfigSummary() {
  const config = loadLauncherConfig({}, getLauncherConfigPath());
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

function safeMergeLauncherConfig(body = {}) {
  return writeLauncherConfig(body, getLauncherConfigPath());
}

function resolveLauncherEntry() {
  const candidate = process.env.LAUNCHER_ENTRY
    || (process.argv[1] && /\.js$/.test(process.argv[1]) ? process.argv[1] : null)
    || path.join(process.cwd(), 'main.js');
  return path.isAbsolute(candidate) ? candidate : path.resolve(process.cwd(), candidate);
}

class AgentConnection {
    constructor(settings, viewer_port) {
        this.socket = null;
        this.settings = settings;
        this.in_game = false;
        this.full_state = null;
        this.viewer_port = viewer_port;
    }
    setSettings(settings) {
        this.settings = settings;
    }
}

export function registerAgent(settings, viewer_port) {
    let agentConnection = new AgentConnection(settings, viewer_port);
    agent_connections[settings.profile.name] = agentConnection;
}

export function logoutAgent(agentName) {
    if (agent_connections[agentName]) {
        agent_connections[agentName].in_game = false;
        agentsStatusUpdate();
    }
}

// Initialize the server
export function createMindServer(host_public = false, port = 8080) {
    const app = express();
    server = http.createServer(app);
    io = new Server(server);

    // Serve static files
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: true, limit: '1mb' }));
    app.use(express.static(path.join(__dirname, 'public')));

    // Launcher configuration APIs (for Simple Setup UI)
    app.get('/api/launcher-config', (_req, res) => {
      res.json({
        success: true,
        config: getLauncherConfigSummary(),
        providerKeys: getProviderKeyStatus(),
      });
    });

    app.post('/api/launcher-config', (req, res) => {
      try {
        const updated = safeMergeLauncherConfig(req.body);
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

    // Defense-in-depth: block cross-origin browser POSTs (CSRF) to state-
    // changing endpoints. Same-origin pages and non-browser clients (no
    // Origin header, e.g. curl) are allowed. (Outside review CRIT-1/3.)
    const originGuard = (req, res, next) => {
      const origin = req.headers.origin;
      if (!origin) return next(); // curl / same-origin fetch without Origin
      try {
        const o = new URL(origin);
        const hostHeader = String(req.headers.host || '');
        if (`${o.host}` === hostHeader) return next();
      } catch { /* malformed origin -> reject */ }
      return res.status(403).json({ success: false, error: 'Cross-origin request blocked' });
    };
    app.use('/api', (req, res, next) => {
      if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
      return originGuard(req, res, next);
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
      const config = loadLauncherConfig({}, getLauncherConfigPath());
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
        agents.push({ name: agentName, in_game: conn.in_game, socket_connected: !!conn.socket });
      }
      const problems = [];
      if (!anyKey) problems.push('No API key configured — add one in the Setup Wizard (API Keys card).');
      if (!mcReachable) problems.push(`Minecraft server unreachable at ${mcHost}:${mcPort} — open a world to LAN on that port, or change it in Setup.`);
      if (agents.length === 0) problems.push('No agents registered — start one from the dashboard or enable auto_start.');
      else if (!agents.some(a => a.in_game)) problems.push('Agent(s) registered but none are in-game yet.');
      res.json({
        success: true,
        ok: problems.length === 0,
        checks: {
          anyApiKey: anyKey,
          keysFileExists,
          minecraftReachable: mcReachable,
          minecraftTarget: `${mcHost}:${mcPort}`,
          agentsRegistered: agents.length,
          agentsInGame: agents.filter(a => a.in_game).length,
        },
        problems,
      });
    });

    // ----- Realtime agent swarm (angry helpers) -----
    // GET  /api/swarm            -> list helpers
    // POST /api/swarm/deploy      -> { name, command, cwd, location, host, cycleIntervalMs, brain }
    // POST /api/swarm/recall/:id  -> remove a helper
    // POST /api/swarm/relocate/:id -> { cwd, location, host }
    // POST /api/swarm/pulse/:id   -> mark a helper alive (manual heartbeat)
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
      if (!r.ok) return res.status(404).json({ success: false, error: r.error });
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

    // Agents summary for tooling (same data the dashboard sees via socket).
    app.get('/api/agents', (_req, res) => {
      const agents = [];
      for (const agentName in agent_connections) {
        const conn = agent_connections[agentName];
        agents.push({
          name: agentName,
          in_game: conn.in_game,
          viewerPort: conn.viewer_port,
          socket_connected: !!conn.socket,
        });
      }
      res.json({ success: true, agents });
    });

    // Restart the launcher so changed settings in launcher-config.json take effect.
    // We respawn the current entrypoint (default main.js) preserving config path + cwd,
    // then shut the current process down after the child has taken over the port.
    let restarting = false;
    app.post('/api/restart', (_req, res) => {
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
      const entry = resolveLauncherEntry();
      const childArgs = [entry, ...forwardedArgs];

      // Close this server first so the child can bind the port cleanly.
      let closed = false;
      const doClose = () => new Promise((resolve) => {
        if (closed) return resolve();
        closed = true;
        try { server.close(() => resolve()); } catch { resolve(); }
      });

      // Respond before shutting down so the UI gets a clean ack.
      res.json({ success: true, message: 'Restarting launcher' });

      doClose().then(() => {
        const child = spawn(process.execPath, childArgs, {
          cwd: process.cwd(),
          env: {
            ...process.env,
            LAUNCHER_RESTARTING: '1',
          },
          // Detach so the child survives this process exiting on Windows
          // (otherwise the OS terminates the child with the parent).
          detached: true,
          stdio: 'inherit',
        });
        child.unref();
        // Hand off and exit; the detached child runs its own server on the same port.
        setTimeout(() => process.exit(0), 400);
      });
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

    // Socket.io connection handling
    io.on('connection', (socket) => {
        let curAgentName = null;
        console.log('Client connected');

        agentsStatusUpdate(socket);

        socket.on('create-agent', async (settings, callback) => {
            console.log('API create agent...');
            for (let key in settings_spec) {
                if (!(key in settings)) {
                    if (settings_spec[key].required) {
                        callback({ success: false, error: `Setting ${key} is required` });
                        return;
                    }
                    else {
                        settings[key] = settings_spec[key].default;
                    }
                }
            }
            for (let key in settings) {
                if (!(key in settings_spec)) {
                    delete settings[key];
                }
            }
            if (settings.profile?.name) {
                if (settings.profile.name in agent_connections) {
                    callback({ success: false, error: 'Agent already exists' });
                    return;
                }
                let returned = await mindcraft.createAgent(settings);
                callback({ success: returned.success, error: returned.error });
                let name = settings.profile.name;
                if (!returned.success && agent_connections[name]) {
                    mindcraft.destroyAgent(name);
                    delete agent_connections[name];
                }
                agentsStatusUpdate();
            }
            else {
                console.error('Agent name is required in profile');
                callback({ success: false, error: 'Agent name is required in profile' });
            }
        });

        socket.on('get-settings', (agentName, callback) => {
            if (agent_connections[agentName]) {
                callback({ settings: agent_connections[agentName].settings });
            } else {
                callback({ error: `Agent '${agentName}' not found.` });
            }
        });

        socket.on('connect-agent-process', (agentName) => {
            if (agent_connections[agentName]) {
                agent_connections[agentName].socket = socket;
                agentsStatusUpdate();
            }
        });

        socket.on('login-agent', (agentName) => {
            if (agent_connections[agentName]) {
                agent_connections[agentName].socket = socket;
                agent_connections[agentName].in_game = true;
                curAgentName = agentName;
                agentsStatusUpdate();
            }
            else {
                console.warn(`Unregistered agent ${agentName} tried to login`);
            }
        });

        socket.on('disconnect', () => {
            if (agent_connections[curAgentName]) {
                console.log(`Agent ${curAgentName} disconnected`);
                agent_connections[curAgentName].in_game = false;
                agent_connections[curAgentName].socket = null;
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
            const conn = agent_connections[agentName];
            if (!conn || !conn.socket) {
                console.warn(`Agent ${agentName} has no live socket, cannot send message`);
                return;
            }
            const senderName = curAgentName || json?.from || 'client';
            const msg = typeof json?.message === 'string' ? json.message : '';
            console.log(`${senderName} sending message to ${agentName}: ${msg}`);
            conn.socket.emit('chat-message', senderName, json);
        });

        socket.on('set-agent-settings', (agentName, settings) => {
            const agent = agent_connections[agentName];
            if (agent) {
                agent.setSettings(settings);
                if (agent.socket) agent.socket.emit('restart-agent');
            }
        });

        socket.on('restart-agent', (agentName) => {
            console.log(`Restarting agent: ${agentName}`);
            const conn = agent_connections[agentName];
            if (conn && conn.socket) conn.socket.emit('restart-agent');
            else console.warn(`Cannot restart '${agentName}': not registered or no live socket`);
        });

        socket.on('stop-agent', (agentName) => {
            mindcraft.stopAgent(agentName);
        });

        socket.on('start-agent', (agentName) => {
            mindcraft.startAgent(agentName);
        });

        socket.on('destroy-agent', (agentName) => {
            if (agent_connections[agentName]) {
                mindcraft.destroyAgent(agentName);
                delete agent_connections[agentName];
            }
            agentsStatusUpdate();
        });

        socket.on('stop-all-agents', () => {
            console.log('Killing all agents');
            for (let agentName in agent_connections) {
                mindcraft.stopAgent(agentName);
            }
        });

        // ----- Realtime agent swarm control over Socket.io -----
        socket.on('swarm-list', (callback) => {
            callback({ success: true, helpers: swarm.list() });
        });
        socket.on('swarm-deploy', (spec, callback) => {
            try {
                const h = swarm.deploy(spec || {});
                callback({ success: true, helper: h.toJSON() });
            } catch (e) {
                callback({ success: false, error: String(e && e.message ? e.message : e) });
            }
        });
        socket.on('swarm-recall', (id, callback) => {
            const r = swarm.recall(id);
            callback(r.ok ? { success: true, id } : { success: false, error: r.error });
        });
        socket.on('swarm-relocate', (id, opts, callback) => {
            const r = swarm.relocate(id, opts || {});
            callback(r.ok ? { success: true, id, ...r } : { success: false, error: r.error });
        });
        socket.on('swarm-pulse', (id, callback) => {
            const r = swarm.pulse(id);
            callback(r.ok ? { success: true, id, ageMs: r.ageMs } : { success: false, error: r.error });
        });

        // ----- Director control over Socket.io -----
        socket.on('director-command', (agent, message, callback) => {
            const r = director.command(agent, message);
            if (callback) callback({ success: r.ok, error: r.error || null });
        });
        socket.on('director-program', (spec, callback) => {
            const r = director.startProgram({
                agentName: spec?.agent, name: spec?.name, steps: spec?.steps, loop: spec?.loop,
            });
            if (callback) callback({ success: r.ok, program: r.program || null, error: r.error || null });
        });
        socket.on('director-program-stop', (idOrAgent, callback) => {
            const r = director.stopProgram(idOrAgent);
            if (callback) callback({ success: r.ok, stopped: r.stopped || [], error: r.error || null });
        });
        socket.on('director-leash', (spec, callback) => {
            const r = director.leash(spec?.agent, spec?.message, spec?.intervalMs);
            if (callback) callback({ success: r.ok, leash: r.leash || null, error: r.error || null });
        });
        socket.on('director-unleash', (agent, callback) => {
            const r = director.unleash(agent);
            if (callback) callback({ success: r.ok, error: r.error || null });
        });
        socket.on('director-state', (callback) => {
            if (callback) callback({
                success: true,
                programs: director.listPrograms(),
                leashes: director.listLeashes(),
            });
        });

        socket.on('shutdown', () => {
            console.log('Shutting down');
            try { director.shutdown(); } catch { /* ignore */ }
            try { swarm.stop(); } catch { /* ignore */ }
            for (let agentName in agent_connections) {
                mindcraft.stopAgent(agentName);
            }
            // wait 2 seconds
            setTimeout(() => {
                console.log('Exiting MindServer');
                globalThis.process.exit(0);
            }, 2000);
            
        });

		socket.on('send-message', (agentName, data) => {
			if (!agent_connections[agentName] || !agent_connections[agentName].socket) {
				console.warn(`Agent ${agentName} not in game or no socket, cannot send message via MindServer.`);
                return;
			}
			try {
                agent_connections[agentName].socket.emit('send-message', data);
			} catch (error) {
				console.error('Error: ', error);
			}
		});

        socket.on('bot-output', (agentName, message) => {
            io.emit('bot-output', agentName, message);
        });

        socket.on('listen-to-agents', () => {
            addListener(socket);
        });
    });

    const host = host_public ? '0.0.0.0' : 'localhost';
    mindserverHost = host;
    mindserverPort = port;
    if (host_public) {
        console.log('Public hosting enabled: binding 0.0.0.0. This server is LAN reachable.');
    }
    server.listen(port, host, () => {
        console.log(`MindServer running on port ${port} on host ${host}`);
    });

    // Start the realtime agent swarm (heartbeat + cycle + mobility).
    swarm.setBrainHook(defaultBrainHook);
    swarm.start();
    swarm.on('change', () => {
        try { io.emit('swarm-update', swarm.list()); } catch { /* io may not be ready */ }
    });
    swarm.on('deploy', (h) => { try { io.emit('swarm-event', { type: 'deploy', helper: h }); } catch {} });
    swarm.on('recall', (e) => { try { io.emit('swarm-event', { type: 'recall', ...e }); } catch {} });
    swarm.on('relocate', (e) => { try { io.emit('swarm-event', { type: 'relocate', ...e }); } catch {} });
    swarm.on('stale', (e) => { try { io.emit('swarm-event', { type: 'stale', ...e }); } catch {} });

    // Wire director transport: route messages through the agent's socket,
    // exactly like the dashboard's chat box does.
    director.setSender((agentName, message) => {
        const conn = agent_connections[agentName];
        if (!conn) return { ok: false, error: `agent '${agentName}' not registered` };
        if (!conn.socket) return { ok: false, error: `agent '${agentName}' has no live socket` };
        conn.socket.emit('send-message', { from: 'Director', message });
        return { ok: true };
    });
    director.on('command', (e) => { try { io.emit('director-event', { type: 'command', ...e }); } catch {} });
    director.on('program', (e) => { try { io.emit('director-event', { type: 'program', ...e }); } catch {} });
    director.on('leash', (e) => { try { io.emit('director-event', { type: 'leash', ...e }); } catch {} });

    return server;
}

function agentsStatusUpdate(socket) {
    if (!socket) {
        socket = io;
    }
    let agents = [];
    for (let agentName in agent_connections) {
        const conn = agent_connections[agentName];
        agents.push({
            name: agentName, 
            in_game: conn.in_game,
            viewerPort: conn.viewer_port,
            socket_connected: !!conn.socket
        });
    };
    socket.emit('agents-status', agents);
}


let listenerInterval = null;
function addListener(listener_socket) {
    if (!listener_socket || agent_listeners.includes(listener_socket)) return;
    agent_listeners.push(listener_socket);
    if (agent_listeners.length === 1) {
        listenerInterval = setInterval(async () => {
            const states = {};
            for (let agentName in agent_connections) {
                let agent = agent_connections[agentName];
                if (agent.in_game) {
                    if (!agent.socket || typeof agent.socket.emit !== 'function') {
                        states[agentName] = { error: 'agent disconnected' };
                        continue;
                    }
                    try {
                        const state = await new Promise((resolve) => {
                            const done = (payload) => resolve(payload);
                            const timer = setTimeout(() => resolve({ error: 'state request timeout' }), 1200);
                            try {
                                agent.socket.emit('get-full-state', (s) => {
                                  clearTimeout(timer);
                                  done(s);
                                });
                            } catch (error) {
                              clearTimeout(timer);
                              done({ error: String(error) });
                            }
                        });
                        states[agentName] = state;
                    } catch (e) {
                        states[agentName] = { error: String(e) };
                    }
                }
            }
            for (let listener of agent_listeners) {
                if (listener && listener.connected) {
                    try {
                        listener.emit('state-update', states);
                    } catch { /* ignore */ }
                }
            }
        }, 1000);
    }
}

function removeListener(listener_socket) {
    const idx = agent_listeners.indexOf(listener_socket);
    if (idx >= 0) {
        agent_listeners.splice(idx, 1);
    }
    if (agent_listeners.length === 0) {
        clearInterval(listenerInterval);
        listenerInterval = null;
    }
}

// Optional: export these if you need access to them from other files
export const getIO = () => io;
export const getServer = () => server;
export const numStateListeners = () => agent_listeners.length;
