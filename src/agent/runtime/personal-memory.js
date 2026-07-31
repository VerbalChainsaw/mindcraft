import {
  readFileSync,
  renameSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { writeJsonAtomicSync } from '../../utils/atomic-file.js';

const MAX_FILE_BYTES = 512 * 1024;
const MAX_PLACES = 128;
const MAX_FACTS = 256;
const MAX_EPISODES = 64;
const MAX_OUTCOMES = 128;

function text(value, max = 400) {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex -- persistent prompt-visible text is sanitized
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function key(value, max = 64) {
  return text(value, max).toLowerCase().replace(/[^a-z0-9 _-]/g, '').trim();
}

function outcomeKey(value, max = 160) {
  return text(value, max)
    .toLowerCase()
    .replace(/[^a-z0-9_:<>=|.,/+ -]/g, '')
    .trim();
}

function finite(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

function emptyState() {
  return {
    schemaVersion: 2,
    places: {},
    facts: {},
    episodes: [],
    outcomes: {},
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
  if (value.outcomes && typeof value.outcomes === 'object' && !Array.isArray(value.outcomes)) {
    const entries = Object.entries(value.outcomes)
      .map(([rawKey, outcome]) => {
        const name = outcomeKey(rawKey);
        if (!name || !outcome || typeof outcome !== 'object' || Array.isArray(outcome)) return null;
        const attempts = Math.max(0, Math.min(1_000_000, Math.floor(Number(outcome.attempts) || 0)));
        const successes = Math.max(0, Math.min(attempts, Math.floor(Number(outcome.successes) || 0)));
        const failures = Math.max(0, Math.min(attempts, Math.floor(Number(outcome.failures) || 0)));
        if (attempts < 1) return null;
        return [name, {
          attempts,
          successes,
          failures,
          totalDurationMs: Math.max(0, Math.min(1_000_000_000, Number(outcome.totalDurationMs) || 0)),
          totalYield: Math.max(0, Math.min(1_000_000_000, Number(outcome.totalYield) || 0)),
          lastCode: text(outcome.lastCode, 80),
          updatedAt: finite(outcome.updatedAt) || Date.now(),
        }];
      })
      .filter(Boolean)
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
      .slice(0, MAX_OUTCOMES);
    state.outcomes = Object.fromEntries(entries);
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

  rememberOutcome(method, {
    success = false,
    durationMs = 0,
    yieldCount = 0,
    code = '',
  } = {}) {
    const methodKey = outcomeKey(method);
    if (!methodKey) return false;
    const previous = this.state.outcomes[methodKey] || {
      attempts: 0,
      successes: 0,
      failures: 0,
      totalDurationMs: 0,
      totalYield: 0,
      lastCode: '',
      updatedAt: 0,
    };
    if (!Object.hasOwn(this.state.outcomes, methodKey) && Object.keys(this.state.outcomes).length >= MAX_OUTCOMES) {
      const oldest = Object.entries(this.state.outcomes)
        .sort((left, right) => left[1].updatedAt - right[1].updatedAt)[0]?.[0];
      if (oldest) delete this.state.outcomes[oldest];
    }
    const verifiedSuccess = success === true;
    this.state.outcomes[methodKey] = {
      attempts: Math.min(1_000_000, previous.attempts + 1),
      successes: Math.min(1_000_000, previous.successes + (verifiedSuccess ? 1 : 0)),
      failures: Math.min(1_000_000, previous.failures + (verifiedSuccess ? 0 : 1)),
      totalDurationMs: Math.min(
        1_000_000_000,
        previous.totalDurationMs + Math.max(0, Number(durationMs) || 0),
      ),
      totalYield: Math.min(
        1_000_000_000,
        previous.totalYield + Math.max(0, Number(yieldCount) || 0),
      ),
      lastCode: text(code, 80),
      updatedAt: Date.now(),
    };
    this.save();
    return true;
  }

  outcomePreference(method) {
    const outcome = this.state.outcomes[outcomeKey(method)];
    if (!outcome?.attempts) return 0;
    // A neutral two-success/two-failure prior prevents one lucky result from
    // overwhelming registry facts or live-world feasibility.
    const posteriorSuccess = (outcome.successes + 2) / (outcome.attempts + 4);
    const confidence = outcome.attempts / (outcome.attempts + 3);
    return Number((((posteriorSuccess - 0.5) * 20) * confidence).toFixed(3));
  }

  getOutcomeSummary(limit = 6) {
    return Object.entries(this.state.outcomes)
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
      .slice(0, Math.max(0, Math.min(24, Number(limit) || 0)))
      .map(([method, outcome]) => ({
        method,
        attempts: outcome.attempts,
        successes: outcome.successes,
        failures: outcome.failures,
        successRate: Number((outcome.successes / outcome.attempts).toFixed(3)),
        averageDurationMs: outcome.totalDurationMs > 0
          ? Math.round(outcome.totalDurationMs / outcome.attempts)
          : null,
        averageYield: outcome.totalYield > 0
          ? Number((outcome.totalYield / outcome.attempts).toFixed(2))
          : 0,
        lastCode: outcome.lastCode,
        preference: this.outcomePreference(method),
        updatedAt: outcome.updatedAt,
      }));
  }

  getPromptSummary(maxCharacters = 1_200) {
    const facts = Object.entries(this.state.facts).slice(-12).map(([name, value]) => `${name}: ${value.value}`);
    const places = Object.entries(this.state.places).slice(-8).map(([name, place]) => `${name}: ${place.x.toFixed(1)},${place.y.toFixed(1)},${place.z.toFixed(1)}${place.dimension ? ` (${place.dimension})` : ''}`);
    const episodes = this.state.episodes.slice(-4).map((episode) => episode.summary);
    const learned = this.getOutcomeSummary(4)
      .map(outcome => `${outcome.method} ${outcome.successes}/${outcome.attempts}`)
      .join('; ');
    return [`Facts: ${facts.join('; ')}`, `Places: ${places.join('; ')}`, `Recent outcomes: ${episodes.join('; ')}`, `Verified method history: ${learned}`]
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
