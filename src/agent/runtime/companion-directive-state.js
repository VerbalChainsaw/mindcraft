import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';

import { isStaleActivityState, staleActivityReason } from './activity-freshness.js';
import path from 'node:path';

import { writeJsonAtomicSync } from '../../utils/atomic-file.js';

const STORE_VERSION = 1;
const MAX_STORE_BYTES = 8 * 1024;
const MAX_PLAYER_NAME_LENGTH = 64;
const SAFE_AGENT_NAME = /^[A-Za-z0-9_]{3,16}$/;

function normalizeIdentity(value, field) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new TypeError(`${field} is invalid.`);
  if (
    value.length > MAX_PLAYER_NAME_LENGTH
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError(`${field} is invalid.`);
  }
  return value;
}

function normalizeState(value = {}) {
  const directive = value.directive === null || value.directive === undefined
    ? null
    : value.directive === 'follow' || value.directive === 'guard'
      ? value.directive
      : (() => { throw new TypeError('Companion directive is invalid.'); })();
  const requestedName = normalizeIdentity(value.requestedName, 'Companion requested player name');
  const canonicalUsername = normalizeIdentity(value.canonicalUsername, 'Companion canonical player name');
  if (directive && !requestedName && !canonicalUsername) {
    throw new TypeError('Companion directive has no player identity.');
  }
  if (!directive && (requestedName || canonicalUsername)) {
    throw new TypeError('Companion identity cannot be durable without a standing directive.');
  }
  return Object.freeze({
    directive,
    requestedName,
    canonicalUsername,
    authorizedAt: directive && Number.isFinite(value.authorizedAt) ? value.authorizedAt : null,
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : null,
  });
}

/**
 * Dedicated authority record for explicit standing follow/guard orders.
 * Conversation memory and Agenda entries have different lifecycles and must
 * never be used to infer this authority after a process restart.
 */
export class CompanionDirectiveStateStore {
  constructor(agentName, { root = './bots' } = {}) {
    if (!SAFE_AGENT_NAME.test(String(agentName || ''))) {
      throw new TypeError('Companion-directive bot name is invalid.');
    }
    this.directory = path.resolve(root, agentName);
    this.filePath = path.join(this.directory, 'companion-directive.json');
    this.lastError = null;
    this.state = normalizeState();
    mkdirSync(this.directory, { recursive: true });
    this.load();
  }

  load() {
    this.lastError = null;
    if (!existsSync(this.filePath)) return this.snapshot();
    try {
      if (statSync(this.filePath).size > MAX_STORE_BYTES) {
        throw new TypeError('Companion-directive file exceeds the size limit.');
      }
      const document = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (document?.version !== STORE_VERSION) {
        throw new TypeError(`Unsupported companion-directive version '${document?.version}'.`);
      }
      // A standing follow/guard is what the companion is doing right now, not
      // something to revive hours later from a finished session.
      if (isStaleActivityState(document.savedAt)) {
        this.lastError = staleActivityReason('companion directive', document.savedAt);
        this.state = normalizeState();
        return this.snapshot();
      }
      this.state = normalizeState(document);
    } catch (error) {
      // Missing authority is safer than reviving a guessed player order.
      this.lastError = String(error?.message || error).slice(0, 280);
      this.state = normalizeState();
    }
    return this.snapshot();
  }

  persist(next) {
    const normalized = normalizeState(next);
    try {
      writeJsonAtomicSync(this.filePath, {
        version: STORE_VERSION,
        ...normalized,
        savedAt: Date.now(),
      });
      this.state = normalized;
      this.lastError = null;
    } catch (error) {
      this.lastError = String(error?.message || error).slice(0, 280);
      throw error;
    }
    return this.snapshot();
  }

  clear() {
    return this.persist({
      directive: null,
      requestedName: null,
      canonicalUsername: null,
      authorizedAt: null,
      updatedAt: Date.now(),
    });
  }

  snapshot() {
    return { ...this.state, error: this.lastError };
  }
}
