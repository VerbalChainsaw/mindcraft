import {
  appendFile,
  mkdir,
  readdir,
  stat,
  unlink,
} from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import process from 'node:process';

import {
  actionResultToTelemetry,
  classifyMethodOutcome,
} from './action-result.js';
import { getFullState } from '../library/full_state.js';

const SCHEMA_VERSION = 1;
const DEFAULT_MAX_FILES = 8;
const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
const DEFAULT_MAX_QUEUE = 64;
const DEFAULT_MAX_RECORD_BYTES = 256 * 1024;
const DEFAULT_STALL_AFTER_MS = 30_000;
const DEFAULT_STALL_COOLDOWN_MS = 90_000;
const MAX_DIALOGUE_TURNS = 8;
const MAX_OBJECT_KEYS = 96;
const MAX_ARRAY_ITEMS = 96;
const MAX_STRING_CHARS = 4_096;
const MAX_CLONE_DEPTH = 10;

const CRITICAL_ACTION_CODES = new Set([
  'action_pattern_detected',
  'capability_postcondition_blocked',
  'inventory_capacity_blocked',
  'previous_action_unresponsive',
  'runtime_error',
  'unsafe_goal_command',
  'verification_failed',
]);

const FAILURE_EVENT_TYPES = new Set([
  'goal.changed',
  'job.changed',
  'survival.changed',
]);

const TERMINAL_FAILURE_PHASES = new Set(['blocked', 'failed']);
const STALL_EXCLUDED_STATUS = /(?:cancel|complete|failed|held|preemption|player_(?:absent|ambiguous)|waiting)/;
const MISSING_TOOL_CODE = /(?:missing_tool|tool_missing|no_usable_tool)/;

function boundedText(value, maximum = MAX_STRING_CHARS) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex -- telemetry must remain one valid JSONL record per line.
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function safeName(value, fallback = 'bot') {
  return boundedText(value, 80).replace(/[^A-Za-z0-9_.-]/g, '_') || fallback;
}

function boundedClone(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return boundedText(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return boundedText(value);
  if (typeof value !== 'object') return boundedText(value);
  if (depth >= MAX_CLONE_DEPTH) return '[depth limit]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.slice(0, MAX_ARRAY_ITEMS)
        .map(item => boundedClone(item, depth + 1, seen));
    }
    const clone = {};
    for (const key of Object.keys(value).slice(0, MAX_OBJECT_KEYS)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
      clone[boundedText(key, 120)] = boundedClone(value[key], depth + 1, seen);
    }
    return clone;
  } finally {
    seen.delete(value);
  }
}

function recentDialogue(agent) {
  try {
    return agent?.history?.getHistory?.()
      ?.slice(-MAX_DIALOGUE_TURNS)
      .map(turn => ({
        role: ['assistant', 'system', 'user'].includes(turn?.role) ? turn.role : 'unknown',
        content: boundedText(turn?.content, 1_200),
      })) || [];
  } catch {
    return [];
  }
}

function relevantBehaviorFailure(event) {
  if (!event || typeof event !== 'object') return false;
  if (event.type === 'self.died') return true;
  if (!FAILURE_EVENT_TYPES.has(event.type)) return false;
  return TERMINAL_FAILURE_PHASES.has(String(event.evidence?.phase || '').toLowerCase());
}

export function isTelemetryBookmarkMessage(message) {
  return /^wtf[!?.]*$/i.test(String(message || '').trim());
}

export function isHighValueActionFailure(result) {
  if (!result || typeof result !== 'object') return false;
  if (CRITICAL_ACTION_CODES.has(String(result.code || '').toLowerCase())) return true;
  if (!TERMINAL_FAILURE_PHASES.has(String(result.phase || '').toLowerCase())) return false;
  return classifyMethodOutcome(result) === 'method_failure';
}

function potentialLogicFlags(trigger, canonicalState) {
  const flags = [];
  const action = trigger?.actionResult;
  if (
    action
    && MISSING_TOOL_CODE.test(String(action.code || action.evidence?.skill?.outcome || ''))
    && Array.isArray(canonicalState?.inventory?.tools)
    && canonicalState.inventory.tools.length > 0
  ) {
    flags.push({
      code: 'reported_missing_tool_with_carried_tools',
      carriedTools: canonicalState.inventory.tools.slice(0, 12).map(tool => ({
        name: boundedText(tool?.name, 80),
        count: Math.max(0, Number(tool?.count) || 0),
        durability: boundedClone(tool?.durability || null),
      })),
      interpretation: 'Potential contradiction only; carried tools may still have the wrong tier, family, or durability.',
    });
  }
  return flags;
}

function compactOversizeRecord(record, serializedBytes, maximumBytes) {
  return {
    schemaVersion: record.schemaVersion,
    sequence: record.sequence,
    recordedAt: record.recordedAt,
    kind: record.kind,
    trigger: record.trigger,
    logicFlags: record.logicFlags,
    canonicalState: null,
    recentDialogue: record.recentDialogue,
    capture: {
      code: 'canonical_record_too_large',
      serializedBytes,
      maximumBytes,
      detail: 'The canonical state was omitted rather than writing an unbounded telemetry record.',
    },
  };
}

export class BehaviorFlightRecorder {
  constructor(agent, {
    root = './bots',
    now = Date.now,
    stateSampler = currentAgent => getFullState(currentAgent),
    maxFiles = DEFAULT_MAX_FILES,
    maxFileBytes = DEFAULT_MAX_FILE_BYTES,
    maxQueue = DEFAULT_MAX_QUEUE,
    maxRecordBytes = DEFAULT_MAX_RECORD_BYTES,
    stallAfterMs = DEFAULT_STALL_AFTER_MS,
    stallCooldownMs = DEFAULT_STALL_COOLDOWN_MS,
  } = {}) {
    this.agent = agent;
    this.now = typeof now === 'function' ? now : Date.now;
    this.stateSampler = typeof stateSampler === 'function'
      ? stateSampler
      : currentAgent => getFullState(currentAgent);
    this.maxFiles = Math.max(1, Math.min(32, Math.floor(Number(maxFiles) || DEFAULT_MAX_FILES)));
    this.maxFileBytes = Math.max(4_096, Math.floor(Number(maxFileBytes) || DEFAULT_MAX_FILE_BYTES));
    this.maxQueue = Math.max(1, Math.min(512, Math.floor(Number(maxQueue) || DEFAULT_MAX_QUEUE)));
    this.maxRecordBytes = Math.max(4_096, Math.floor(Number(maxRecordBytes) || DEFAULT_MAX_RECORD_BYTES));
    this.stallAfterMs = Math.max(5_000, Math.floor(Number(stallAfterMs) || DEFAULT_STALL_AFTER_MS));
    this.stallCooldownMs = Math.max(this.stallAfterMs, Math.floor(Number(stallCooldownMs) || DEFAULT_STALL_COOLDOWN_MS));

    const agentName = safeName(agent?.name);
    this.directory = path.resolve(root, agentName, 'telemetry');
    this.sessionId = `${new Date(this.now()).toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
    this.segment = 0;
    this.currentPath = this.segmentPath();
    this.currentBytes = 0;
    this.sequence = 0;
    this.queue = [];
    this.drainPromise = null;
    this.closed = false;
    this.recordsWritten = 0;
    this.recordsDropped = 0;
    this.lastError = null;
    this.stallSignature = '';
    this.stallObservedAt = null;
    this.lastStallRecordedAt = null;
    this.ready = this.prepare();
  }

  segmentPath() {
    return path.join(this.directory, `flight-${this.sessionId}-${String(this.segment).padStart(3, '0')}.jsonl`);
  }

  async prepare() {
    try {
      await mkdir(this.directory, { recursive: true });
      await this.pruneFiles(this.maxFiles - 1);
    } catch (error) {
      this.lastError = boundedText(error?.message || error, 280);
    }
  }

  async pruneFiles(keep = this.maxFiles) {
    const names = await readdir(this.directory);
    const files = [];
    for (const name of names) {
      if (!/^flight-.*\.jsonl$/.test(name)) continue;
      const filePath = path.join(this.directory, name);
      let modifiedAt = 0;
      try { modifiedAt = (await stat(filePath)).mtimeMs; } catch { continue; }
      files.push({ filePath, modifiedAt });
    }
    files.sort((left, right) => right.modifiedAt - left.modifiedAt);
    for (const stale of files.slice(Math.max(0, keep))) {
      if (stale.filePath === this.currentPath) continue;
      try { await unlink(stale.filePath); } catch { /* retention is best effort */ }
    }
  }

  captureCanonicalState() {
    try {
      return { state: boundedClone(this.stateSampler(this.agent)), error: null };
    } catch (error) {
      return {
        state: null,
        error: {
          code: 'canonical_state_unavailable',
          detail: boundedText(error?.message || error, 280),
        },
      };
    }
  }

  buildRecord(kind, trigger) {
    const capture = this.captureCanonicalState();
    const record = {
      schemaVersion: SCHEMA_VERSION,
      sequence: ++this.sequence,
      recordedAt: this.now(),
      kind: boundedText(kind, 80),
      trigger: boundedClone(trigger),
      logicFlags: potentialLogicFlags(trigger, capture.state),
      canonicalState: capture.state,
      recentDialogue: recentDialogue(this.agent),
      capture: capture.error,
    };
    let line = `${JSON.stringify(record)}\n`;
    let bytes = Buffer.byteLength(line);
    if (bytes > this.maxRecordBytes) {
      line = `${JSON.stringify(compactOversizeRecord(record, bytes, this.maxRecordBytes))}\n`;
      bytes = Buffer.byteLength(line);
    }
    return { line, bytes };
  }

  enqueue(kind, trigger) {
    if (this.closed) return false;
    const entry = this.buildRecord(kind, trigger);
    if (entry.bytes > this.maxRecordBytes) {
      this.recordsDropped += 1;
      this.lastError = `Telemetry record remained over ${this.maxRecordBytes} bytes after compaction.`;
      return false;
    }
    if (this.queue.length >= this.maxQueue) {
      this.queue.shift();
      this.recordsDropped += 1;
    }
    this.queue.push(entry);
    this.scheduleDrain();
    return true;
  }

  scheduleDrain() {
    if (this.drainPromise || this.closed) return;
    this.drainPromise = Promise.resolve()
      .then(() => this.drain())
      .catch(error => {
        this.lastError = boundedText(error?.message || error, 280);
      })
      .finally(() => {
        this.drainPromise = null;
        if (this.queue.length > 0 && !this.closed) this.scheduleDrain();
      });
  }

  async rotate() {
    this.segment += 1;
    this.currentPath = this.segmentPath();
    this.currentBytes = 0;
    await this.pruneFiles(this.maxFiles - 1);
  }

  async drain() {
    await this.ready;
    while (this.queue.length > 0) {
      const entry = this.queue.shift();
      try {
        if (this.currentBytes > 0 && this.currentBytes + entry.bytes > this.maxFileBytes) {
          await this.rotate();
        }
        await appendFile(this.currentPath, entry.line, 'utf8');
        this.currentBytes += entry.bytes;
        this.recordsWritten += 1;
        this.lastError = null;
      } catch (error) {
        this.recordsDropped += 1;
        this.lastError = boundedText(error?.message || error, 280);
      }
    }
  }

  recordRuntimeEvent(code, evidence = {}) {
    return this.enqueue('runtime.event', {
      code: boundedText(code, 80),
      evidence: boundedClone(evidence),
    });
  }

  recordActionResult(result) {
    if (!isHighValueActionFailure(result)) return false;
    return this.enqueue('action.failure', {
      actionResult: {
        ...actionResultToTelemetry(result),
        evidence: boundedClone(result?.evidence),
      },
    });
  }

  recordBehaviorEvent(event) {
    if (!relevantBehaviorFailure(event)) return false;
    return this.enqueue(event.type === 'self.died' ? 'self.death' : 'director.failure', {
      behaviorEvent: boundedClone(event),
    });
  }

  bookmark(player, message = 'WTF') {
    return this.enqueue('player.bookmark', {
      player: boundedText(player, 80),
      message: boundedText(message, 240),
      code: 'player_wtf_bookmark',
    });
  }

  observeRuntime() {
    if (this.closed || this.agent?.actions?.executing || this.agent?.isOperatorHeld?.()) {
      this.stallSignature = '';
      this.stallObservedAt = null;
      return false;
    }
    const now = this.now();
    const goal = this.agent?.goal_director?.activeGoal;
    const job = this.agent?.job_director?.activeOrder;
    const director = goal ? this.agent.goal_director : job ? this.agent.job_director : null;
    const commitment = goal || job;
    const status = director?.status || {};
    if (
      !commitment
      || TERMINAL_FAILURE_PHASES.has(String(commitment.phase || '').toLowerCase())
      || STALL_EXCLUDED_STATUS.test(`${status.phase || ''}:${status.code || ''}`)
      || (Number(director?.nextAttemptAt) || 0) > now
      || director?.inFlight
    ) {
      this.stallSignature = '';
      this.stallObservedAt = null;
      return false;
    }
    const signature = `${goal ? 'goal' : 'job'}:${commitment.id || 'unknown'}:${commitment.phase || status.phase || 'unknown'}:${status.code || 'unknown'}`;
    if (signature !== this.stallSignature) {
      this.stallSignature = signature;
      this.stallObservedAt = now;
      return false;
    }
    if (now - this.stallObservedAt < this.stallAfterMs) return false;
    if (this.lastStallRecordedAt !== null && now - this.lastStallRecordedAt < this.stallCooldownMs) return false;
    this.lastStallRecordedAt = now;
    return this.enqueue('runtime.possible_stall', {
      code: 'durable_commitment_idle',
      commitment: {
        owner: goal ? 'goal-director' : 'job-director',
        id: boundedText(commitment.id, 96),
        phase: boundedText(commitment.phase || status.phase, 40),
        statusCode: boundedText(status.code, 80),
        statusDetail: boundedText(status.detail, 280),
        idleForMs: now - this.stallObservedAt,
      },
    });
  }

  snapshot() {
    return {
      schemaVersion: SCHEMA_VERSION,
      enabled: !this.closed,
      directory: this.directory,
      currentFile: this.currentPath,
      queueDepth: this.queue.length,
      recordsWritten: this.recordsWritten,
      recordsDropped: this.recordsDropped,
      lastError: this.lastError,
    };
  }

  async flush() {
    while (this.drainPromise || this.queue.length > 0) {
      if (!this.drainPromise) this.scheduleDrain();
      if (this.drainPromise) await this.drainPromise;
    }
  }

  async close(reason = 'runtime_stopped') {
    if (this.closed) return this.snapshot();
    this.recordRuntimeEvent('runtime.stopped', { reason: boundedText(reason, 280) });
    await this.flush();
    this.closed = true;
    return this.snapshot();
  }
}
