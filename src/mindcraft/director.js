// Director subsystem — program, direct, or leash agents through commands.
//
// Three control modes:
//   1. COMMAND  — one-shot: send a single chat/command line to an agent.
//   2. PROGRAM  — queued sequence of steps ({ message, delayMs }) executed in
//                 order, optionally looping. Cancellable at any time.
//   3. LEASH    — a repeating single directive re-issued on an interval
//                 (e.g. "!followPlayer("Director", 3)") until released.
//
// The director never talks to Minecraft directly: it routes every message
// through the mindserver's agent socket ('send-message'), exactly like the
// dashboard chat box, so agent-side validation stays authoritative.

import { EventEmitter } from 'events';

function id6() {
  return Math.random().toString(36).slice(2, 8);
}

export class Director extends EventEmitter {
  constructor() {
    super();
    this.programs = new Map(); // id -> program state
    this.leashes = new Map();  // agentName -> leash state
    this._send = null;         // injected: (agentName, message) => {ok, error?}
  }

  // Inject the transport (mindserver wires this to agent sockets).
  setSender(fn) { this._send = fn; }

  _dispatch(agentName, message) {
    if (!this._send) return { ok: false, error: 'director transport not wired' };
    try {
      return this._send(agentName, message) || { ok: true };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  }

  // ---- COMMAND ----
  command(agentName, message) {
    if (!agentName || !message || typeof message !== 'string') {
      return { ok: false, error: 'agentName and message (string) required' };
    }
    const r = this._dispatch(agentName, message);
    this.emit('command', { agentName, message, ok: r.ok, error: r.error || null });
    return r;
  }

  // ---- PROGRAM ----
  // steps: [{ message, delayMs? }], loop: boolean, name: string
  startProgram({ agentName, name, steps, loop = false } = {}) {
    if (!agentName) return { ok: false, error: 'agentName required' };
    if (!Array.isArray(steps) || steps.length === 0) {
      return { ok: false, error: 'steps must be a non-empty array' };
    }
    const clean = steps
      .filter((s) => s && typeof s.message === 'string' && s.message.trim())
      .map((s) => ({
        message: s.message.trim(),
        delayMs: Math.max(250, Number(s.delayMs) || 3000),
      }));
    if (clean.length === 0) return { ok: false, error: 'no valid steps' };

    const prog = {
      id: `prog-${id6()}`,
      name: name || `program-${id6()}`,
      agentName,
      steps: clean,
      loop: Boolean(loop),
      index: 0,
      cycles: 0,
      status: 'running',
      startedAt: Date.now(),
      lastStep: null,
      lastError: null,
      _timer: null,
    };
    this.programs.set(prog.id, prog);
    this._runStep(prog);
    this.emit('program', { type: 'start', program: this.programJSON(prog) });
    return { ok: true, program: this.programJSON(prog) };
  }

  _runStep(prog) {
    if (prog.status !== 'running') return;
    if (prog.index >= prog.steps.length) {
      prog.cycles += 1;
      if (prog.loop) {
        prog.index = 0;
      } else {
        prog.status = 'done';
        prog._timer = null;
        this.emit('program', { type: 'done', program: this.programJSON(prog) });
        return;
      }
    }
    const step = prog.steps[prog.index];
    const r = this._dispatch(prog.agentName, step.message);
    prog.lastStep = { index: prog.index, message: step.message, ok: r.ok, at: Date.now() };
    if (!r.ok) prog.lastError = r.error || 'dispatch failed';
    this.emit('program', { type: 'step', program: this.programJSON(prog) });
    prog.index += 1;
    prog._timer = setTimeout(() => this._runStep(prog), step.delayMs);
  }

  stopProgram(idOrAgent) {
    let stopped = [];
    for (const prog of this.programs.values()) {
      if (prog.id === idOrAgent || prog.agentName === idOrAgent) {
        if (prog._timer) clearTimeout(prog._timer);
        prog._timer = null;
        if (prog.status === 'running') prog.status = 'stopped';
        stopped.push(prog.id);
      }
    }
    if (stopped.length === 0) return { ok: false, error: 'no matching program' };
    this.emit('program', { type: 'stop', ids: stopped });
    return { ok: true, stopped };
  }

  listPrograms() {
    // prune finished programs older than 10 min
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [pid, p] of this.programs) {
      if (p.status !== 'running' && p.startedAt < cutoff) this.programs.delete(pid);
    }
    return Array.from(this.programs.values()).map((p) => this.programJSON(p));
  }

  programJSON(p) {
    return {
      id: p.id, name: p.name, agentName: p.agentName, status: p.status,
      loop: p.loop, index: p.index, totalSteps: p.steps.length,
      cycles: p.cycles, startedAt: p.startedAt,
      lastStep: p.lastStep, lastError: p.lastError,
      steps: p.steps,
    };
  }

  // ---- LEASH ----
  leash(agentName, message, intervalMs = 15000) {
    if (!agentName || !message) return { ok: false, error: 'agentName and message required' };
    this.unleash(agentName); // replace any existing leash
    const state = {
      agentName,
      message: String(message).trim(),
      intervalMs: Math.max(2000, Number(intervalMs) || 15000),
      issued: 0,
      startedAt: Date.now(),
      lastOk: null,
      _timer: null,
    };
    const fire = () => {
      const r = this._dispatch(agentName, state.message);
      state.issued += 1;
      state.lastOk = r.ok;
      this.emit('leash', { type: 'tick', leash: this.leashJSON(state) });
    };
    fire();
    state._timer = setInterval(fire, state.intervalMs);
    this.leashes.set(agentName, state);
    this.emit('leash', { type: 'attach', leash: this.leashJSON(state) });
    return { ok: true, leash: this.leashJSON(state) };
  }

  unleash(agentName) {
    const state = this.leashes.get(agentName);
    if (!state) return { ok: false, error: 'no leash on that agent' };
    if (state._timer) clearInterval(state._timer);
    this.leashes.delete(agentName);
    this.emit('leash', { type: 'release', agentName });
    return { ok: true, agentName };
  }

  listLeashes() {
    return Array.from(this.leashes.values()).map((s) => this.leashJSON(s));
  }

  leashJSON(s) {
    return {
      agentName: s.agentName, message: s.message, intervalMs: s.intervalMs,
      issued: s.issued, startedAt: s.startedAt, lastOk: s.lastOk,
    };
  }

  shutdown() {
    for (const p of this.programs.values()) if (p._timer) clearTimeout(p._timer);
    for (const l of this.leashes.values()) if (l._timer) clearInterval(l._timer);
    this.programs.clear();
    this.leashes.clear();
  }
}

export const director = new Director();
export default director;
