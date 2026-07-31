import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { writeJsonAtomicSync } from '../../utils/atomic-file.js';

// The environment observer already publishes coordinate-bearing sightings of
// ore, hazards, and workstations, but nothing kept them: the bot announced
// "I spotted diamond ore" and then had no idea where it was. This store keeps
// a small, decaying, self-healing index of those sightings so gameplay can
// return to them instead of re-searching blind.
const STORE_VERSION = 1;
const MAX_STORE_BYTES = 256 * 1024;
const SAFE_AGENT_NAME = /^[A-Za-z0-9_]{3,16}$/;
const MAX_LANDMARKS = 160;
const DEFAULT_RETENTION_MS = 6 * 60 * 60_000;
// Sightings inside the same cell collapse into one entry, so an eight-block
// vein does not consume eight slots.
const GRID = 4;

const TRACKED_EVENT_TYPES = new Set([
  'observation.terrain',
  'observation.structure',
]);

const CATEGORY_PATTERNS = Object.freeze([
  Object.freeze({ category: 'ore', pattern: /(?:_ore|ancient_debris|amethyst_cluster)$/ }),
  Object.freeze({ category: 'workstation', pattern: /(?:crafting_table|furnace|blast_furnace|smoker|enchanting_table|anvil|brewing_stand|cartography_table|smithing_table|loom|grindstone)$/ }),
  Object.freeze({ category: 'storage', pattern: /(?:chest|barrel|shulker_box)$/ }),
  Object.freeze({ category: 'shelter', pattern: /(?:_bed)$/ }),
  Object.freeze({ category: 'portal', pattern: /(?:_portal|portal_frame)$/ }),
  Object.freeze({ category: 'hazard', pattern: /(?:lava|spawner|magma_block)$/ }),
  Object.freeze({ category: 'water', pattern: /^water$/ }),
]);

function safeText(value, maximum = 64) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/^minecraft:/, '')
    .replace(/[^a-z0-9_]/g, '_')
    .slice(0, maximum);
}

function finiteInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.floor(number) : null;
}

export function landmarkCategory(name) {
  const canonical = safeText(name);
  if (!canonical) return null;
  for (const entry of CATEGORY_PATTERNS) {
    if (entry.pattern.test(canonical)) return entry.category;
  }
  return null;
}

function cellKey(dimension, x, y, z) {
  return [
    dimension,
    Math.floor(x / GRID),
    Math.floor(y / GRID),
    Math.floor(z / GRID),
  ].join(':');
}

function normalizeEntry(raw) {
  const x = finiteInteger(raw?.x);
  const y = finiteInteger(raw?.y);
  const z = finiteInteger(raw?.z);
  const name = safeText(raw?.name);
  if (x === null || y === null || z === null || !name) return null;
  const category = safeText(raw?.category, 24) || landmarkCategory(name);
  if (!category) return null;
  const firstSeenAt = Number.isFinite(raw?.firstSeenAt) ? raw.firstSeenAt : 0;
  const lastSeenAt = Number.isFinite(raw?.lastSeenAt) ? raw.lastSeenAt : firstSeenAt;
  return {
    name,
    category,
    dimension: safeText(raw?.dimension, 32) || 'overworld',
    x,
    y,
    z,
    salience: Math.min(5, Math.max(1, finiteInteger(raw?.salience) ?? 2)),
    sightings: Math.min(999, Math.max(1, finiteInteger(raw?.sightings) ?? 1)),
    firstSeenAt,
    lastSeenAt,
  };
}

function distanceTo(entry, origin) {
  if (!origin) return Infinity;
  return Math.hypot(entry.x - origin.x, entry.y - origin.y, entry.z - origin.z);
}

export class LandmarkMemory {
  constructor(agentName, {
    root = './bots',
    now = Date.now,
    retentionMs = DEFAULT_RETENTION_MS,
    maxEntries = MAX_LANDMARKS,
  } = {}) {
    if (!SAFE_AGENT_NAME.test(String(agentName || ''))) {
      throw new TypeError('Landmark-memory bot name is invalid.');
    }
    this.now = typeof now === 'function' ? now : Date.now;
    this.retentionMs = Math.max(60_000, Number(retentionMs) || DEFAULT_RETENTION_MS);
    this.maxEntries = Math.min(1_000, Math.max(16, Number(maxEntries) || MAX_LANDMARKS));
    this.directory = path.resolve(root, agentName);
    this.filePath = path.join(this.directory, 'landmarks.json');
    this.lastError = null;
    this.dirty = false;
    this.entries = new Map();
    mkdirSync(this.directory, { recursive: true });
    this.load();
  }

  load() {
    this.lastError = null;
    this.entries = new Map();
    if (!existsSync(this.filePath)) return;
    try {
      if (statSync(this.filePath).size > MAX_STORE_BYTES) {
        throw new TypeError('Landmark file exceeds the size limit.');
      }
      const document = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (document?.version !== STORE_VERSION) {
        throw new TypeError(`Unsupported landmark-store version '${document?.version}'.`);
      }
      if (!Array.isArray(document.landmarks)) return;
      for (const raw of document.landmarks.slice(0, this.maxEntries)) {
        const entry = normalizeEntry(raw);
        if (!entry) continue;
        this.entries.set(cellKey(entry.dimension, entry.x, entry.y, entry.z), entry);
      }
    } catch (error) {
      // A corrupt or foreign store must never stop a bot from spawning; it is
      // rebuilt from live observation instead.
      this.lastError = String(error?.message || error).slice(0, 280);
      this.entries = new Map();
    }
  }

  save() {
    if (!this.dirty) return false;
    try {
      writeJsonAtomicSync(this.filePath, {
        version: STORE_VERSION,
        landmarks: [...this.entries.values()],
        savedAt: this.now(),
      });
      this.dirty = false;
      this.lastError = null;
      return true;
    } catch (error) {
      this.lastError = String(error?.message || error).slice(0, 280);
      return false;
    }
  }

  prune() {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (now - entry.lastSeenAt > this.retentionMs) {
        this.entries.delete(key);
        this.dirty = true;
      }
    }
    if (this.entries.size <= this.maxEntries) return;
    // Evict the least valuable first: low salience and long unseen.
    const ranked = [...this.entries.entries()].sort((left, right) => {
      const score = entry => (entry.salience * 60_000) + entry.lastSeenAt;
      return score(left[1]) - score(right[1]);
    });
    for (const [key] of ranked.slice(0, this.entries.size - this.maxEntries)) {
      this.entries.delete(key);
      this.dirty = true;
    }
  }

  /**
   * Records a published behavior event when it carries a usable position.
   * Returns the stored entry, or null when the event is not a landmark.
   */
  observe(event, { dimension = 'overworld' } = {}) {
    if (!event || !TRACKED_EVENT_TYPES.has(event.type)) return null;
    const candidate = normalizeEntry({
      name: event.target?.name,
      x: event.target?.x,
      y: event.target?.y,
      z: event.target?.z,
      dimension: event.dimension || dimension,
      salience: event.salience,
    });
    if (!candidate) return null;
    const now = this.now();
    const key = cellKey(candidate.dimension, candidate.x, candidate.y, candidate.z);
    const previous = this.entries.get(key);
    const entry = previous && previous.name === candidate.name
      ? {
        ...previous,
        salience: Math.max(previous.salience, candidate.salience),
        sightings: Math.min(999, previous.sightings + 1),
        lastSeenAt: now,
      }
      : {
        ...candidate,
        sightings: 1,
        firstSeenAt: now,
        lastSeenAt: now,
      };
    this.entries.set(key, entry);
    this.dirty = true;
    this.prune();
    return entry;
  }

  /**
   * Drops an entry whose block is verifiably gone. `bot.blockAt` returns null
   * for unloaded chunks, and an unloaded chunk is not evidence of removal, so
   * only a loaded mismatch evicts.
   */
  verifyAgainstWorld(bot, entry) {
    if (typeof bot?.blockAt !== 'function') return true;
    let block;
    try {
      block = bot.blockAt({ x: entry.x, y: entry.y, z: entry.z });
    } catch {
      return true;
    }
    if (!block?.name) return true;
    if (safeText(block.name) === entry.name) return true;
    this.entries.delete(cellKey(entry.dimension, entry.x, entry.y, entry.z));
    this.dirty = true;
    return false;
  }

  /**
   * Nearest remembered landmarks matching the filter, closest first. Entries
   * are verified against loaded chunks so a mined-out vein self-heals.
   */
  recall({
    bot = null,
    name = null,
    category = null,
    dimension = null,
    origin = null,
    maxDistance = Infinity,
    limit = 8,
  } = {}) {
    this.prune();
    const wantedName = name ? safeText(name) : null;
    const wantedCategory = category ? safeText(category, 24) : null;
    const wantedDimension = dimension ? safeText(dimension, 32) : null;
    const range = Number.isFinite(Number(maxDistance)) ? Number(maxDistance) : Infinity;
    const bounded = Math.min(64, Math.max(1, Number(limit) || 8));
    const matches = [];
    for (const entry of [...this.entries.values()]) {
      if (wantedName && entry.name !== wantedName) continue;
      if (wantedCategory && entry.category !== wantedCategory) continue;
      if (wantedDimension && entry.dimension !== wantedDimension) continue;
      const distance = distanceTo(entry, origin);
      if (distance > range) continue;
      matches.push({ ...entry, distance: Number.isFinite(distance) ? distance : null });
    }
    matches.sort((left, right) => (left.distance ?? Infinity) - (right.distance ?? Infinity));
    const verified = [];
    for (const match of matches) {
      if (verified.length >= bounded) break;
      if (bot && !this.verifyAgainstWorld(bot, match)) continue;
      verified.push(match);
    }
    this.save();
    return verified;
  }

  telemetry(limit = 8) {
    this.prune();
    const counts = {};
    for (const entry of this.entries.values()) {
      counts[entry.category] = (counts[entry.category] || 0) + 1;
    }
    const recent = [...this.entries.values()]
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
      .slice(0, Math.min(32, Math.max(1, Number(limit) || 8)))
      .map(entry => ({
        name: entry.name,
        category: entry.category,
        dimension: entry.dimension,
        x: entry.x,
        y: entry.y,
        z: entry.z,
        sightings: entry.sightings,
        lastSeenAt: entry.lastSeenAt,
      }));
    return {
      tracked: this.entries.size,
      byCategory: counts,
      recent,
      error: this.lastError,
    };
  }
}
