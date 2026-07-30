import {
  readFileSync,
  renameSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { writeJsonAtomicSync } from '../../utils/atomic-file.js';

const MAX_FILE_BYTES = 512 * 1024;
const MAX_PLACES = 128;
const MAX_FACTS = 256;
const MAX_EPISODES = 64;

function text(value, max = 400) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function key(value, max = 64) {
  return text(value, max).toLowerCase().replace(/[^a-z0-9 _-]/g, '').trim();
}

function finite(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

function emptyState() {
  return {
    schemaVersion: 1,
    places: {},
    facts: {},
    episodes: [],
    updatedAt: null,
  };
}

function normalizeState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Runtime memory must be an object.');
  const state = emptyState();
  if (value.places && typeof value.places === 'object' && !Array.isArray(value.places)) {
    for (const [rawName, place] of Object.entries(value.places).slice(0, MAX_PLACES)) {
      const name = key(rawName);
      if (!name || !place || typeof place !== 'object') continue;
      const x = finite(place.x); const y = finite(place.y); const z = finite(place.z);
      if (x === null || y === null || z === null) continue;
      state.places[name] = { x, y, z, dimension: text(place.dimension, 80), updatedAt: finite(place.updatedAt) || Date.now() };
    }
  }
  if (value.facts && typeof value.facts === 'object' && !Array.isArray(value.facts)) {
    for (const [rawKey, fact] of Object.entries(value.facts).slice(0, MAX_FACTS)) {
      const factKey = key(rawKey);
      const factText = text(typeof fact === 'string' ? fact : fact?.value, 600);
      if (factKey && factText) state.facts[factKey] = { value: factText, updatedAt: finite(fact?.updatedAt) || Date.now() };
    }
  }
  if (Array.isArray(value.episodes)) {
    state.episodes = value.episodes.slice(-MAX_EPISODES).map((episode) => ({
      summary: text(episode?.summary || episode, 600),
      outcome: text(episode?.outcome, 80),
      updatedAt: finite(episode?.updatedAt) || Date.now(),
    })).filter((episode) => episode.summary);
  }
  state.updatedAt = finite(value.updatedAt);
  return state;
}

export class PersonalMemory {
  constructor(agentName, { rootDir = path.join(process.cwd(), 'bots') } = {}) {
    this.agentName = text(agentName, 32);
    this.filePath = path.join(rootDir, this.agentName, 'runtime-memory.json');
    this.state = emptyState();
  }

  load() {
    try {
      if (statSync(this.filePath).size > MAX_FILE_BYTES) throw new TypeError('Runtime memory file exceeds the safety limit.');
      this.state = normalizeState(JSON.parse(readFileSync(this.filePath, 'utf8')));
    } catch (error) {
      // statSync is intentional here instead of existsSync: existsSync turns a
      // permissions/I/O failure into a false "not found" result. Only a real
      // absent file is safe to interpret as a clean first start.
      if (error?.code === 'ENOENT') {
        this.state = emptyState();
        return this.export();
      }
      const recoverable = error instanceof SyntaxError || error instanceof TypeError;
      if (!recoverable) {
        console.error(`[memory] Failed to load runtime memory for ${this.agentName}: ${error.message}`);
        throw error;
      }
      const quarantine = this.filePath.replace(/\.json$/i, `.corrupt-${Date.now()}.json`);
      try { renameSync(this.filePath, quarantine); } catch { /* preserve best effort only */ }
      this.state = emptyState();
      console.warn(`[memory] Ignored invalid runtime memory for ${this.agentName}: ${error.message}`);
    }
    return this.export();
  }

  save() {
    this.state.updatedAt = Date.now();
    writeJsonAtomicSync(this.filePath, this.state);
  }

  rememberPlace(name, position, dimension = '') {
    const nameKey = key(name);
    const x = finite(position?.x); const y = finite(position?.y); const z = finite(position?.z);
    if (!nameKey || x === null || y === null || z === null) return false;
    if (!Object.hasOwn(this.state.places, nameKey) && Object.keys(this.state.places).length >= MAX_PLACES) return false;
    this.state.places[nameKey] = { x, y, z, dimension: text(dimension, 80), updatedAt: Date.now() };
    this.save();
    return true;
  }

  recallPlace(name) {
    const place = this.state.places[key(name)];
    return place ? structuredClone(place) : null;
  }

  rememberFact(name, value) {
    const factKey = key(name);
    const factValue = text(value, 600);
    if (!factKey || !factValue) return false;
    if (!Object.hasOwn(this.state.facts, factKey) && Object.keys(this.state.facts).length >= MAX_FACTS) return false;
    this.state.facts[factKey] = { value: factValue, updatedAt: Date.now() };
    this.save();
    return true;
  }

  rememberEpisode(summary, outcome = '') {
    const normalized = text(summary, 600);
    if (!normalized) return false;
    this.state.episodes.push({ summary: normalized, outcome: text(outcome, 80), updatedAt: Date.now() });
    this.state.episodes = this.state.episodes.slice(-MAX_EPISODES);
    this.save();
    return true;
  }

  getPromptSummary(maxCharacters = 1_200) {
    const facts = Object.entries(this.state.facts).slice(-12).map(([name, value]) => `${name}: ${value.value}`);
    const places = Object.entries(this.state.places).slice(-8).map(([name, place]) => `${name}: ${place.x.toFixed(1)},${place.y.toFixed(1)},${place.z.toFixed(1)}${place.dimension ? ` (${place.dimension})` : ''}`);
    const episodes = this.state.episodes.slice(-4).map((episode) => episode.summary);
    return [`Facts: ${facts.join('; ')}`, `Places: ${places.join('; ')}`, `Recent outcomes: ${episodes.join('; ')}`]
      .filter((line) => !line.endsWith(': '))
      .join('\n')
      .slice(0, maxCharacters);
  }

  clear() {
    this.state = emptyState();
    this.save();
  }

  export() {
    return structuredClone(this.state);
  }
}
