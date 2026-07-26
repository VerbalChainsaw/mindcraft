// Realtime agent swarm subsystem.
//
// A "swarm" is a registry of lightweight helpers. Each helper:
//   - has a HEARTBEAT (proves it is alive; staleness is watched by the core)
//   - runs a REGULAR CYCLE (tick interval, executes a command/task at cwd)
//   - can MOVE about the system (location: 'in-process' | 'child' | 'remote',
//     plus a `cwd` it operates from; relocate() changes where it runs)
//
// Brains are optional (hybrid core): a helper with a `brain` config consults an
// LLM via the brain hook before acting; without a brain it just runs its task.
//
// The core is intentionally resilient: a throwing helper never breaks the loop
// or the other helpers, and stale helpers are auto-recalled (with a grace count).

import { EventEmitter } from 'events';
import path from 'path';
import { hasKey } from '../../utils/keys.js';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
const DEFAULTS = {
  heartbeatIntervalMs: 5000, // how often a helper pings "I'm alive"
  cycleIntervalMs: 15000, // how often a helper performs its task
  staleAfterMs: 30000, // heartbeat older than this => stale
  maxStaleCycles: 3, // this many stale ticks => auto-recall
  defaultCwd: process.cwd(),
};

// ---------------------------------------------------------------------------
// Helper: one member of the angry swarm
// ---------------------------------------------------------------------------
export class Helper {
  constructor(spec = {}) {
    this.id = spec.id || `helper-${Math.random().toString(36).slice(2, 8)}`;
    this.name = spec.name || this.id;
    this.command = spec.command || 'echo "[swarm] ' + this.name + ' alive"';
    this.cwd = spec.cwd || DEFAULTS.defaultCwd;
    this.location = spec.location || 'in-process'; // 'in-process' | 'child' | 'remote'
    this.host = spec.host || 'localhost'; // for 'remote' / 'child' reporting
    // Mobility: where it should run. relocate() updates cwd + location.
    this.status = 'idle'; // 'idle' | 'active' | 'stale' | 'stopped' | 'error'
    this.cycleIntervalMs = spec.cycleIntervalMs || DEFAULTS.cycleIntervalMs;
    this.heartbeatIntervalMs = spec.heartbeatIntervalMs || DEFAULTS.heartbeatIntervalMs;
    this.staleAfterMs = spec.staleAfterMs || DEFAULTS.staleAfterMs;
    this.maxStaleCycles = spec.maxStaleCycles ?? DEFAULTS.maxStaleCycles;

    // Optional brain hook (hybrid). If set, called each cycle with context;
    // may mutate/approve the action. Guarded so a missing key can't crash.
    this.brain = spec.brain || null; // { provider, model, prompt, enabled }

    this.cycleCount = 0;
    this.staleCycles = 0;
    this.lastBeat = Date.now();
    this.lastResult = null;
    this.lastError = null;
    this._heartbeatTimer = null;
    this._cycleTimer = null;
    this._proc = null; // for 'child' location
    this._onAction = null; // injected executor
  }

  markAlive() {
    this.lastBeat = Date.now();
    if (this.status === 'stale') this.status = 'active';
    this.staleCycles = 0;
  }

  isStale(now = Date.now()) {
    return now - this.lastBeat > this.staleAfterMs;
  }

  setExecutor(fn) {
    // fn(context) => Promise<result> | result. Runs the helper's action.
    this._onAction = fn;
  }

  async tick() {
    this.cycleCount += 1;
    try {
      // Optional brain: consult LLM (guarded). Brain may return an override
      // command or a decision object; we pass it through to the executor.
      let brainOutput = null;
      if (this.brain && this.brain.enabled && this._brainHook) {
        brainOutput = await this._brainHook(this, {
          cycleCount: this.cycleCount,
          status: this.status,
          cwd: this.cwd,
          command: this.command,
        });
      }
      this.status = 'active';
      const result = this._onAction
        ? await this._onAction({
            helper: this,
            cycleCount: this.cycleCount,
            brain: brainOutput,
          })
        : { skipped: true, reason: 'no executor attached' };
      this.lastResult = result;
      this.lastError = null;
      this.markAlive();
      return { ok: true, result };
    } catch (err) {
      this.lastError = String(err && err.message ? err.message : err);
      this.status = 'error';
      return { ok: false, error: this.lastError };
    }
  }

  start() {
    if (this._cycleTimer) return;
    this.status = 'active';
    this.markAlive();
    // NOTE: no self-ping heartbeat — lastBeat is refreshed ONLY by real
    // liveness proof (a successful tick, or an external pulse via the API).
    // A self-ping timer would defeat the watchdog entirely.
    this._cycleTimer = setInterval(() => {
      this.tick().catch(() => {});
    }, this.cycleIntervalMs);
  }

  stop() {
    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer); // legacy safety
    if (this._cycleTimer) clearInterval(this._cycleTimer);
    this._heartbeatTimer = null;
    this._cycleTimer = null;
    this.status = 'stopped';
    this._killProc();
  }

  _killProc() {
    if (this._proc) {
      try { this._proc.kill(); } catch { /* ignore */ }
      this._proc = null;
    }
  }

  // Mobility: change where this helper runs. For 'in-process' helpers this
  // switches cwd; for 'child' it relaunches the worker at the new cwd.
  relocate({ cwd, location, host } = {}) {
    const prevCwd = this.cwd;
    if (cwd) this.cwd = path.resolve(cwd);
    if (location) this.location = location;
    if (host) this.host = host;
    this._killProc();
    if (this.location === 'child') {
      // executor re-spawns worker on next tick via the swarm's child runner
      this.status = 'active';
    }
    return { ok: true, from: prevCwd, to: this.cwd, location: this.location };
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      command: this.command,
      cwd: this.cwd,
      location: this.location,
      host: this.host,
      status: this.status,
      cycleCount: this.cycleCount,
      staleCycles: this.staleCycles,
      lastBeat: this.lastBeat,
      ageMs: Date.now() - this.lastBeat,
      hasBrain: Boolean(this.brain && this.brain.enabled),
      brain: this.brain ? { provider: this.brain.provider, model: this.brain.model, enabled: this.brain.enabled } : null,
      lastResult: this.lastResult,
      lastError: this.lastError,
    };
  }
}

// ---------------------------------------------------------------------------
// Swarm: registry + watchdog + mobility orchestration
// ---------------------------------------------------------------------------
export class Swarm extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.helpers = new Map();
    this.config = { ...DEFAULTS, ...opts };
    this._watchdogTimer = null;
    this._executor = opts.executor || defaultExecutor;
    this._brainHook = opts.brainHook || null;
    this._running = false;
  }

  setExecutor(fn) {
    this._executor = fn;
    for (const h of this.helpers.values()) h.setExecutor(fn);
  }
  setBrainHook(fn) {
    this._brainHook = fn;
    // Propagate to already-deployed helpers so call order never matters.
    for (const h of this.helpers.values()) h._brainHook = fn;
  }

  deploy(spec = {}) {
    const h = new Helper(spec);
    h.setExecutor(this._executor);
    h._brainHook = this._brainHook;
    this.helpers.set(h.id, h);
    h.start();
    this.emit('deploy', h.toJSON());
    this.emit('change');
    return h;
  }

  recall(id) {
    const h = this.helpers.get(id);
    if (!h) return { ok: false, error: 'not found' };
    h.stop();
    this.helpers.delete(id);
    this.emit('recall', { id });
    this.emit('change');
    return { ok: true, id };
  }

  relocate(id, opts = {}) {
    const h = this.helpers.get(id);
    if (!h) return { ok: false, error: 'not found' };
    const r = h.relocate(opts);
    this.emit('relocate', { id, ...r });
    this.emit('change');
    return r;
  }

  list() {
    return Array.from(this.helpers.values()).map((h) => h.toJSON());
  }

  pulse(id) {
    const h = this.helpers.get(id);
    if (!h) return { ok: false, error: 'not found' };
    h.markAlive();
    this.emit('change');
    return { ok: true, id, ageMs: Date.now() - h.lastBeat };
  }

  // Watchdog: marks stale helpers, auto-recalls after maxStaleCycles.
  _watchdog() {
    const now = Date.now();
    for (const h of this.helpers.values()) {
      if (h.isStale(now) && h.status !== 'stopped') {
        h.status = 'stale';
        h.staleCycles += 1;
        this.emit('stale', { id: h.id, staleCycles: h.staleCycles });
        if (h.staleCycles >= h.maxStaleCycles) {
          console.warn(`[swarm] helper ${h.name} (${h.id}) stale ${h.staleCycles}x — auto-recalling`);
          this.recall(h.id);
        }
      }
    }
    this.emit('change');
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._watchdogTimer = setInterval(() => this._watchdog(), Math.max(1000, Math.floor(this.config.heartbeatIntervalMs / 2)));
    this.emit('start');
  }

  stop() {
    if (this._watchdogTimer) clearInterval(this._watchdogTimer);
    this._watchdogTimer = null;
    for (const h of this.helpers.values()) h.stop();
    this.helpers.clear();
    this._running = false;
    this.emit('stop');
  }
}

// ---------------------------------------------------------------------------
// Default executor: runs the helper's command at its cwd.
//   - 'in-process': spawn a child process in the same node process (safe,
//     isolated via child_process), capturing stdout.
//   - 'child' / 'remote': currently falls back to an in-process spawn at cwd
//     (remote is a stub hook — wire SSH/WinRM here later without API changes).
// The executor never throws to the caller; errors are returned as results.
// ---------------------------------------------------------------------------
async function defaultExecutor({ helper, brain } = {}) {
  const { spawn } = await import('child_process');
  const cmd = (brain && brain.command) || helper.command;
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let done = false;
    const close = (payload) => {
      if (done) return;
      done = true;
      resolve(payload);
    };
    let proc;
    try {
      // Split a shell command safely: use the system shell.
      const isWin = process.platform === 'win32';
      proc = spawn(isWin ? 'cmd.exe' : 'sh', [isWin ? '/c' : '-c', cmd], {
        cwd: helper.cwd,
        windowsHide: true,
        env: process.env,
      });
      helper._proc = proc;
      const to = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* ignore */ }
        close({ ok: false, timedOut: true, stdout, stderr: stderr + '\n[swarm] cycle timed out' });
      }, Math.max(2000, Math.floor(helper.cycleIntervalMs * 0.8)));
      proc.stdout.on('data', (d) => { stdout += String(d); });
      proc.stderr.on('data', (d) => { stderr += String(d); });
      proc.on('error', (e) => { clearTimeout(to); close({ ok: false, error: String(e.message || e), stdout, stderr }); });
      proc.on('close', (code) => {
        clearTimeout(to);
        close({ ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim() });
      });
    } catch (e) {
      close({ ok: false, error: String(e && e.message ? e.message : e) });
    }
  });
}

// ---------------------------------------------------------------------------
// Optional brain hook (hybrid core). Guarded: only fires if the configured
// provider key is actually present (via keys.js hasKey). Returns either:
//   { command }      -> override the command for this cycle
//   { decision }     -> advisory object the executor/UI can log
//   null             -> no change (run the static command)
// This is a safe, dependency-light default; swap in a real LLM client later.
// ---------------------------------------------------------------------------
export async function defaultBrainHook(helper, ctx) {
  const brain = helper.brain;
  if (!brain || !brain.enabled) return null;
  const keyName = providerKeyName(brain.provider);
  let hasKeyOk = false;
  try { hasKeyOk = hasKey(keyName); } catch { hasKeyOk = false; }
  if (!hasKeyOk) {
    // No key present — run static command, don't crash.
    return { skipped: true, reason: `no key for ${brain.provider}` };
  }
  // No live LLM call by default (keeps the subsystem dependency-free and safe).
  // Real brains register a custom brainHook on the swarm. This returns an
  // advisory decision so the UI can show the brain "thought" without network.
  return {
    decision: `brain(${brain.provider}:${brain.model}) cycle ${ctx.cycleCount} — static command retained`,
    command: null,
  };
}

function providerKeyName(provider) {
  const map = {
    openai: 'OPENAI_API_KEY',
    gemini: 'GEMINI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    xai: 'XAI_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    qwen: 'QWEN_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
  };
  return map[provider] || 'OPENAI_API_KEY';
}

// Singleton for the running server.
export const swarm = new Swarm();
export default swarm;
