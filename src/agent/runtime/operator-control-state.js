import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { writeJsonAtomicSync } from '../../utils/atomic-file.js';

const STORE_VERSION = 1;
const MAX_STORE_BYTES = 8 * 1024;
const MAX_LEGACY_MEMORY_BYTES = 2 * 1024 * 1024;
const SAFE_AGENT_NAME = /^[A-Za-z0-9_]{3,16}$/;

function normalizeState(value = {}) {
  if (value.held !== undefined && typeof value.held !== 'boolean') {
    throw new TypeError('Operator-control held state is invalid.');
  }
  if (value.reason !== undefined && typeof value.reason !== 'string') {
    throw new TypeError('Operator-control reason is invalid.');
  }
  return Object.freeze({
    held: value.held === true,
    reason: String(value.reason || '').slice(0, 160),
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : null,
  });
}

export class OperatorControlStateStore {
  constructor(agentName, { root = './bots' } = {}) {
    if (!SAFE_AGENT_NAME.test(String(agentName || ''))) {
      throw new TypeError('Operator-control bot name is invalid.');
    }
    this.directory = path.resolve(root, agentName);
    this.filePath = path.join(this.directory, 'operator-control.json');
    this.legacyMemoryPath = path.join(this.directory, 'memory.json');
    this.lastError = null;
    this.state = normalizeState();
    mkdirSync(this.directory, { recursive: true });
    this.load();
  }

  load() {
    this.lastError = null;
    if (!existsSync(this.filePath)) return this.migrateLegacyMemory();
    try {
      if (statSync(this.filePath).size > MAX_STORE_BYTES) {
        throw new TypeError('Operator-control file exceeds the size limit.');
      }
      const document = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (document?.version !== STORE_VERSION) {
        throw new TypeError(`Unsupported operator-control version '${document?.version}'.`);
      }
      this.state = normalizeState(document);
    } catch (error) {
      // A broken control file must fail closed. Starting autonomous work is
      // more dangerous than requiring one explicit player command to release
      // a held bot.
      this.lastError = String(error?.message || error).slice(0, 280);
      this.state = normalizeState({
        held: true,
        reason: 'operator control state could not be verified after restart',
        updatedAt: Date.now(),
      });
    }
    return this.snapshot();
  }

  migrateLegacyMemory() {
    if (!existsSync(this.legacyMemoryPath)) return this.snapshot();
    try {
      if (statSync(this.legacyMemoryPath).size > MAX_LEGACY_MEMORY_BYTES) {
        throw new TypeError('Legacy bot memory exceeds the size limit.');
      }
      const legacy = JSON.parse(readFileSync(this.legacyMemoryPath, 'utf8'));
      if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) {
        throw new TypeError('Legacy bot memory is not an object.');
      }
      if (legacy.operator_hold !== undefined && typeof legacy.operator_hold !== 'boolean') {
        throw new TypeError('Legacy operator-hold state is invalid.');
      }
      if (legacy.operator_hold_reason !== undefined && typeof legacy.operator_hold_reason !== 'string') {
        throw new TypeError('Legacy operator-hold reason is invalid.');
      }
      return this.persist({
        held: legacy.operator_hold === true,
        reason: legacy.operator_hold_reason || 'migrated legacy operator state',
        updatedAt: Date.now(),
      });
    } catch (error) {
      this.lastError = String(error?.message || error).slice(0, 280);
      this.state = normalizeState({
        held: true,
        reason: 'legacy operator control state could not be verified after restart',
        updatedAt: Date.now(),
      });
      return this.snapshot();
    }
  }

  persist(next) {
    this.state = normalizeState(next);
    writeJsonAtomicSync(this.filePath, {
      version: STORE_VERSION,
      ...this.state,
      savedAt: Date.now(),
    });
    this.lastError = null;
    return this.snapshot();
  }

  hold(reason = 'operator stop') {
    return this.persist({ held: true, reason, updatedAt: Date.now() });
  }

  release(reason = 'explicit player command') {
    return this.persist({ held: false, reason, updatedAt: Date.now() });
  }

  snapshot() {
    return { ...this.state, error: this.lastError };
  }
}
