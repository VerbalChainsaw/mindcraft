import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { writeJsonAtomicSync } from '../../utils/atomic-file.js';
import { normalizeWorkOrder } from './work-order.js';

const STORE_VERSION = 1;
const MAX_STORE_BYTES = 512 * 1024;
const SAFE_AGENT_NAME = /^[A-Za-z0-9_]{3,16}$/;
const CANONICAL_NAME = /^[a-z0-9_]{1,64}$/;
const MAX_FARM_CELLS = 64;

function coordinate(value, label) {
  if (!Number.isFinite(Number(value))) throw new TypeError(`Home ${label} must be finite.`);
  return Math.floor(Number(value));
}

function normalizePoint(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a coordinate object.`);
  }
  return Object.freeze({
    x: coordinate(value.x, `${label} x`),
    y: coordinate(value.y, `${label} y`),
    z: coordinate(value.z, `${label} z`),
  });
}

function normalizeDimension(value) {
  return String(value || 'overworld').replace(/^minecraft:/, '').slice(0, 48);
}

function normalizeFarm(value) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Farm state must be an object.');
  }
  const crop = String(value.crop || '').trim().toLowerCase();
  const seed = String(value.seed || '').trim().toLowerCase();
  if (!CANONICAL_NAME.test(crop) || !CANONICAL_NAME.test(seed)) {
    throw new TypeError('Farm crop and seed must be canonical.');
  }
  if (
    !Array.isArray(value.cells)
    || value.cells.length < 1
    || value.cells.length > MAX_FARM_CELLS
  ) throw new TypeError('Farm cell count is invalid.');
  const seen = new Set();
  const cells = value.cells.map((cell) => {
    const point = normalizePoint(cell, 'Farm cell');
    const key = `${point.x},${point.y},${point.z}`;
    if (seen.has(key)) throw new TypeError('Farm cells must be unique.');
    seen.add(key);
    return point;
  });
  return Object.freeze({
    dimension: normalizeDimension(value.dimension),
    crop,
    seed,
    water: normalizePoint(value.water, 'Farm water'),
    cells: Object.freeze(cells),
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now(),
  });
}

function normalizeHome(value) {
  if (value == null) return null;
  const point = normalizePoint(value, 'Home');
  return Object.freeze({
    ...point,
    dimension: normalizeDimension(value.dimension),
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now(),
  });
}

function normalizeState(value = {}) {
  const structureOrder = value.structureOrder
    ? normalizeWorkOrder(value.structureOrder)
    : null;
  return Object.freeze({
    home: normalizeHome(value.home),
    farm: normalizeFarm(value.farm),
    structureOrder,
  });
}

export class HomeStateStore {
  constructor(agentName, { root = './bots' } = {}) {
    if (!SAFE_AGENT_NAME.test(String(agentName || ''))) {
      throw new TypeError('Home-state bot name is invalid.');
    }
    this.directory = path.resolve(root, agentName);
    this.filePath = path.join(this.directory, 'home-state.json');
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
        throw new TypeError('Home-state file exceeds the size limit.');
      }
      const document = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (document?.version !== STORE_VERSION) {
        throw new TypeError(`Unsupported home-state version '${document?.version}'.`);
      }
      this.state = normalizeState(document);
    } catch (error) {
      this.lastError = String(error?.message || error).slice(0, 280);
    }
    return this.snapshot();
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

  rememberHome(position, dimension = 'overworld') {
    return this.persist({
      ...this.state,
      home: {
        ...normalizePoint(position, 'Home'),
        dimension: normalizeDimension(dimension),
        updatedAt: Date.now(),
      },
    });
  }

  rememberStructure(order) {
    const normalized = normalizeWorkOrder(order);
    return this.persist({
      ...this.state,
      home: this.state.home || {
        ...normalized.target,
        dimension: 'overworld',
        updatedAt: Date.now(),
      },
      structureOrder: normalized,
    });
  }

  rememberFarm(farm) {
    return this.persist({
      ...this.state,
      farm: normalizeFarm({ ...farm, updatedAt: Date.now() }),
    });
  }

  snapshot() {
    return {
      home: this.state.home,
      farm: this.state.farm,
      structureOrder: this.state.structureOrder,
      error: this.lastError,
    };
  }

  telemetry() {
    const structure = this.state.structureOrder;
    return {
      home: this.state.home,
      farm: this.state.farm ? {
        dimension: this.state.farm.dimension,
        crop: this.state.farm.crop,
        seed: this.state.farm.seed,
        water: this.state.farm.water,
        cellCount: this.state.farm.cells.length,
        updatedAt: this.state.farm.updatedAt,
      } : null,
      structure: structure ? {
        id: structure.id,
        kind: structure.kind,
        target: structure.target,
        blueprint: structure.blueprint ? {
          id: structure.blueprint.id,
          cellCount: structure.blueprint.cells.length,
        } : null,
        updatedAt: structure.updatedAt,
      } : null,
      error: this.lastError,
    };
  }
}
