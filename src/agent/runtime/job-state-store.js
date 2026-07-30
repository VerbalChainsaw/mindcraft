import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { writeJsonAtomicSync } from '../../utils/atomic-file.js';
import { normalizeWorkOrder } from './work-order.js';

const STORE_VERSION = 1;
const MAX_STORE_BYTES = 512 * 1024;
const SAFE_AGENT_NAME = /^[A-Za-z0-9_]{3,16}$/;

export class JobStateStore {
  constructor(agentName, { root = './bots' } = {}) {
    if (!SAFE_AGENT_NAME.test(String(agentName || ''))) {
      throw new TypeError('Job-state bot name is invalid.');
    }
    this.agentName = agentName;
    this.directory = path.resolve(root, agentName);
    this.filePath = path.join(this.directory, 'job-state.json');
    this.lastError = null;
    mkdirSync(this.directory, { recursive: true });
  }

  load() {
    this.lastError = null;
    if (!existsSync(this.filePath)) return null;
    try {
      if (statSync(this.filePath).size > MAX_STORE_BYTES) {
        throw new TypeError('Job-state file exceeds the size limit.');
      }
      const document = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (document?.version !== STORE_VERSION) {
        throw new TypeError(`Unsupported job-state version '${document?.version}'.`);
      }
      return document.activeOrder ? normalizeWorkOrder(document.activeOrder) : null;
    } catch (error) {
      this.lastError = String(error?.message || error).slice(0, 280);
      return null;
    }
  }

  save(activeOrder) {
    const normalized = activeOrder ? normalizeWorkOrder(activeOrder) : null;
    writeJsonAtomicSync(this.filePath, {
      version: STORE_VERSION,
      activeOrder: normalized,
      savedAt: Date.now(),
    });
    this.lastError = null;
    return normalized;
  }
}
