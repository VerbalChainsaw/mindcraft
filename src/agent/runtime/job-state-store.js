import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';

import { isStaleActivityState, staleActivityReason } from './activity-freshness.js';
import path from 'node:path';

import { writeJsonAtomicSync } from '../../utils/atomic-file.js';
import { normalizeWorkOrder } from './work-order.js';

const STORE_VERSION = 1;
const MAX_STORE_BYTES = 512 * 1024;
const SAFE_AGENT_NAME = /^[A-Za-z0-9_]{3,16}$/;
const SAFE_CANONICAL = /^[a-z0-9_]{1,64}$/;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,96}$/;
const HORIZONTAL_FACINGS = new Set(['north', 'south', 'east', 'west']);

function normalizeTerminalReceipt(raw) {
  if (raw == null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Job terminal receipt must be an object.');
  }
  const order = normalizeWorkOrder(raw.order);
  if (!['complete', 'failed', 'cancelled'].includes(order.phase) || raw.orderId !== order.id) {
    throw new TypeError('Job terminal receipt identity is invalid.');
  }
  const structure = raw.structure && typeof raw.structure === 'object'
    ? {
        habitable: raw.structure.habitable === true,
        fixtures: Object.freeze((Array.isArray(raw.structure.fixtures) ? raw.structure.fixtures : [])
          .slice(0, 64)
          .map(fixture => {
            const id = String(fixture?.id || '').slice(0, 64);
            const fixtureFunction = String(fixture?.function || '').slice(0, 64);
            const material = String(fixture?.material || '').slice(0, 64);
            const facing = String(fixture?.facing || '').slice(0, 16);
            const coordinates = [fixture?.position?.x, fixture?.position?.y, fixture?.position?.z].map(Number);
            if (
              !SAFE_CANONICAL.test(id)
              || !SAFE_CANONICAL.test(fixtureFunction)
              || !SAFE_CANONICAL.test(material)
              || !HORIZONTAL_FACINGS.has(facing)
              || !coordinates.every(Number.isFinite)
            ) throw new TypeError('Job terminal fixture receipt is invalid.');
            return Object.freeze({
              id,
              function: fixtureFunction,
              material,
              facing,
              position: Object.freeze({
                x: Math.floor(coordinates[0]),
                y: Math.floor(coordinates[1]),
                z: Math.floor(coordinates[2]),
              }),
            });
          })),
      }
    : null;
  const dimension = String(raw.dimension || '').slice(0, 64);
  if (!SAFE_ID.test(raw.orderId) || (dimension && !SAFE_CANONICAL.test(dimension))) {
    throw new TypeError('Job terminal receipt metadata is invalid.');
  }
  return Object.freeze({
    orderId: order.id,
    phase: order.phase,
    code: String(raw.code || '').slice(0, 80),
    dimension,
    order,
    structure: structure ? Object.freeze(structure) : null,
    finishedAt: Number.isFinite(raw.finishedAt) ? raw.finishedAt : Date.now(),
  });
}

export class JobStateStore {
  constructor(agentName, { root = './bots' } = {}) {
    if (!SAFE_AGENT_NAME.test(String(agentName || ''))) {
      throw new TypeError('Job-state bot name is invalid.');
    }
    this.agentName = agentName;
    this.directory = path.resolve(root, agentName);
    this.filePath = path.join(this.directory, 'job-state.json');
    this.lastError = null;
    this.terminalReceipt = null;
    mkdirSync(this.directory, { recursive: true });
  }

  load({ allowStaleActiveOrder = false } = {}) {
    this.lastError = null;
    this.terminalReceipt = null;
    if (!existsSync(this.filePath)) return null;
    try {
      if (statSync(this.filePath).size > MAX_STORE_BYTES) {
        throw new TypeError('Job-state file exceeds the size limit.');
      }
      const document = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (document?.version !== STORE_VERSION) {
        throw new TypeError(`Unsupported job-state version '${document?.version}'.`);
      }
      this.terminalReceipt = normalizeTerminalReceipt(document.terminalReceipt);
      // An active work order is in-flight activity, not durable knowledge.
      // Ordinary starts must not revive work from a previous play session.
      // AgentProcess' explicit lifecycle-restart marker is the sole exception,
      // symmetric with GoalStateStore: it continues the same owned runtime and
      // lets Agenda correlate the exact executor before either store is refreshed.
      if (
        document.activeOrder
        && isStaleActivityState(document.savedAt)
        && allowStaleActiveOrder !== true
      ) {
        this.lastError = staleActivityReason('job state', document.savedAt);
        return null;
      }
      return document.activeOrder ? normalizeWorkOrder(document.activeOrder) : null;
    } catch (error) {
      this.lastError = String(error?.message || error).slice(0, 280);
      return null;
    }
  }

  save(activeOrder, terminalReceipt = this.terminalReceipt) {
    const normalized = activeOrder ? normalizeWorkOrder(activeOrder) : null;
    const normalizedReceipt = normalizeTerminalReceipt(terminalReceipt);
    writeJsonAtomicSync(this.filePath, {
      version: STORE_VERSION,
      activeOrder: normalized,
      terminalReceipt: normalizedReceipt,
      savedAt: Date.now(),
    });
    this.terminalReceipt = normalizedReceipt;
    this.lastError = null;
    return normalized;
  }
}
