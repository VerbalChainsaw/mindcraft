import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { normalizeSquadIdentity } from '../agent/runtime/identity-config.js';
import { writeJsonAtomicSync } from '../utils/atomic-file.js';

const MAX_SCENARIOS = 48;
const BEHAVIORS = new Set(['regroup', 'follow', 'defend', 'guard', 'forage', 'scout', 'lumberjack', 'miner', 'builder', 'hunt', 'peaceful']);
const FORMATIONS = new Set(['tight', 'balanced', 'rings', 'wide']);
const PREFIX = /^[A-Za-z][A-Za-z0-9_]{1,11}$/;

function text(value, max, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function id(value) {
  const normalized = text(value, 40).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return normalized;
}

export function normalizeScenario(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Scenario must be an object.');
  const scenarioId = id(input.id || input.label);
  const label = text(input.label, 60);
  const size = Number(input.size);
  const prefix = text(input.prefix, 12);
  const behavior = text(input.behavior, 32).toLowerCase();
  const formation = text(input.formation, 24, 'balanced').toLowerCase();
  const botTypes = Array.isArray(input.botTypes)
    ? input.botTypes.map((entry) => text(entry, 80)).filter(Boolean).slice(0, size)
    : [];
  if (!scenarioId || !label) throw new TypeError('Scenario name is required.');
  if (!Number.isInteger(size) || size < 1 || size > 12) throw new TypeError('Scenario size must be between 1 and 12 bots.');
  if (!PREFIX.test(prefix)) throw new TypeError('Scenario prefix must be 2-12 letters, numbers, or underscores and begin with a letter.');
  if (!BEHAVIORS.has(behavior)) throw new TypeError('Choose a supported squad behavior.');
  if (!FORMATIONS.has(formation)) throw new TypeError('Choose a supported formation.');
  const personas = Array.isArray(input.personas) ? input.personas.map((entry) => text(entry, 520)).filter(Boolean).slice(0, size) : [];
  const identity = normalizeSquadIdentity({
    ...(input.identity && typeof input.identity === 'object' ? input.identity : {}),
    id: scenarioId,
    naming: {
      ...(input.identity?.naming && typeof input.identity.naming === 'object' ? input.identity.naming : {}),
      style: input.nameStyle || input.identity?.naming?.style,
      memberNames: input.memberNames || input.identity?.naming?.memberNames,
    },
  }, {
    displayName: label,
    badge: prefix.slice(0, 6).toUpperCase(),
  });
  return {
    id: scenarioId,
    label,
    description: text(input.description, 240),
    size,
    prefix,
    behavior,
    formation,
    personas,
    botTypes,
    identity,
    nameStyle: identity.naming.style,
    memberNames: identity.naming.memberNames,
    updatedAt: new Date().toISOString(),
  };
}

export class SquadScenarioStore {
  constructor({ filePath = path.join(process.cwd(), 'server_data', 'squad-scenarios.json') } = {}) {
    this.filePath = filePath;
    this.storageError = null;
    if (!existsSync(filePath)) {
      this.scenarios = [];
      return;
    }
    try {
      const raw = JSON.parse(readFileSync(filePath, 'utf8'));
      if (!Array.isArray(raw)) throw new TypeError('Saved scenarios must be a JSON array.');
      this.scenarios = raw.map(normalizeScenario).slice(0, MAX_SCENARIOS);
    } catch (error) {
      this.scenarios = [];
      this.storageError = `Saved scenarios could not be read. They were left untouched: ${String(error?.message || error).slice(0, 180)}`;
    }
  }

  list() { return this.scenarios.map((scenario) => structuredClone(scenario)); }

  health() { return { writable: !this.storageError, error: this.storageError }; }

  assertWritable() {
    if (this.storageError) throw new TypeError(`${this.storageError} Fix or restore the file before changing saved scenarios.`);
  }

  upsert(input) {
    this.assertWritable();
    const scenario = normalizeScenario(input);
    const index = this.scenarios.findIndex((entry) => entry.id === scenario.id);
    if (index === -1 && this.scenarios.length >= MAX_SCENARIOS) throw new TypeError(`Saved scenarios are limited to ${MAX_SCENARIOS}.`);
    if (index === -1) this.scenarios.push(scenario); else this.scenarios[index] = scenario;
    writeJsonAtomicSync(this.filePath, this.scenarios);
    return structuredClone(scenario);
  }

  remove(inputId) {
    try { this.assertWritable(); } catch (error) { return { success: false, error: String(error?.message || error) }; }
    const scenarioId = id(inputId);
    const index = this.scenarios.findIndex((entry) => entry.id === scenarioId);
    if (index === -1) return { success: false, error: 'Saved scenario not found.' };
    this.scenarios.splice(index, 1);
    writeJsonAtomicSync(this.filePath, this.scenarios);
    return { success: true, id: scenarioId };
  }
}
