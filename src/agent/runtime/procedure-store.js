import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { writeJsonAtomicSync } from '../../utils/atomic-file.js';
import { goalContractDescription } from './goal-contract.js';

const STORE_VERSION = 1;
const MAX_STORE_BYTES = 512 * 1024;
const MAX_PROCEDURES = 128;
const MAX_STEPS = 64;
const SAFE_AGENT_NAME = /^[A-Za-z0-9_]{3,16}$/;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,96}$/;
const SAFE_COMMANDS = new Set([
  '!collectWoodInRange',
  '!collectBlocksInRange',
  '!prepareMaterial',
  '!prepareTool',
  '!craftRecipe',
  '!smeltItem',
  '!equip',
  '!giveFamilyToPlayer',
  '!givePlayer',
  '!moveAway',
]);

function boundedText(value, maximum, fallback = '') {
  return Array.from(String(value ?? fallback), character => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? ' ' : character;
  }).join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function normalizeStep(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Procedure step must be an object.');
  }
  const commandName = boundedText(raw.commandName, 80);
  if (!SAFE_COMMANDS.has(commandName)) {
    throw new TypeError(`Procedure command '${commandName}' is not a safe deterministic command.`);
  }
  return Object.freeze({
    kind: boundedText(raw.kind, 32),
    commandName,
    resultCode: boundedText(raw.resultCode, 80),
  });
}

function normalizeProcedure(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Procedure must be an object.');
  }
  const id = boundedText(raw.id, 96);
  if (!SAFE_ID.test(id)) throw new TypeError('Procedure id is invalid.');
  const kind = boundedText(raw.kind, 24);
  if (!['acquire', 'deliver'].includes(kind)) throw new TypeError('Procedure goal kind is invalid.');
  const targetKey = boundedText(raw.targetKey, 80);
  if (!/^[a-z0-9_]{1,80}$/.test(targetKey)) throw new TypeError('Procedure target is invalid.');
  const destinationKind = boundedText(raw.destinationKind, 24);
  if (!['inventory', 'player'].includes(destinationKind)) {
    throw new TypeError('Procedure destination is invalid.');
  }
  const completionKind = boundedText(
    raw.completionKind || (destinationKind === 'player' ? 'delivery' : 'inventory'),
    24,
  );
  if (!['inventory', 'main_hand', 'off_hand', 'delivery'].includes(completionKind)) {
    throw new TypeError('Procedure completion is invalid.');
  }
  if (!Array.isArray(raw.steps) || raw.steps.length < 1 || raw.steps.length > MAX_STEPS) {
    throw new TypeError('Procedure steps are missing or excessive.');
  }
  return Object.freeze({
    id,
    kind,
    targetKey,
    destinationKind,
    completionKind,
    description: boundedText(raw.description, 240),
    steps: Object.freeze(raw.steps.map(normalizeStep)),
    successfulRuns: Math.max(1, Math.min(1_000_000, Math.floor(Number(raw.successfulRuns) || 1))),
    firstVerifiedAt: Number.isFinite(raw.firstVerifiedAt) ? raw.firstVerifiedAt : Date.now(),
    lastVerifiedAt: Number.isFinite(raw.lastVerifiedAt) ? raw.lastVerifiedAt : Date.now(),
  });
}

function procedureKey(goal) {
  return [
    goal.kind,
    goal.target.family || goal.target.canonicalName,
    goal.destination.kind,
    goal.completion.kind,
  ].join(':');
}

function procedureFromGoal(goal) {
  if (goal.phase !== 'complete' || goal.evidence?.verified !== true) {
    throw new TypeError('Only deterministically completed goals may become procedures.');
  }
  const steps = goal.subgoals
    .filter(subgoal => subgoal.state === 'succeeded' && SAFE_COMMANDS.has(subgoal.commandName))
    .map(subgoal => ({
      kind: subgoal.kind,
      commandName: subgoal.commandName,
      resultCode: subgoal.code || '',
    }));
  if (steps.length < 1) throw new TypeError('Completed goal contains no proven deterministic command steps.');
  const now = Date.now();
  return normalizeProcedure({
    id: `procedure-${procedureKey(goal)}`,
    kind: goal.kind,
    targetKey: goal.target.family || goal.target.canonicalName,
    destinationKind: goal.destination.kind,
    completionKind: goal.completion.kind,
    description: goalContractDescription(goal),
    steps,
    successfulRuns: 1,
    firstVerifiedAt: now,
    lastVerifiedAt: now,
  });
}

export class ProcedureStore {
  constructor(agentName, { root = './bots' } = {}) {
    if (!SAFE_AGENT_NAME.test(String(agentName || ''))) {
      throw new TypeError('Procedure-store bot name is invalid.');
    }
    this.agentName = agentName;
    this.directory = path.resolve(root, agentName);
    this.filePath = path.join(this.directory, 'verified-procedures.json');
    this.procedures = [];
    this.lastError = null;
    mkdirSync(this.directory, { recursive: true });
    this.load();
  }

  load() {
    this.lastError = null;
    if (!existsSync(this.filePath)) {
      this.procedures = [];
      return [];
    }
    try {
      if (statSync(this.filePath).size > MAX_STORE_BYTES) {
        throw new TypeError('Procedure store exceeds the size limit.');
      }
      const document = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (document?.version !== STORE_VERSION || !Array.isArray(document.procedures)) {
        throw new TypeError('Procedure store has an unsupported document shape.');
      }
      this.procedures = document.procedures
        .slice(0, MAX_PROCEDURES)
        .map(normalizeProcedure);
    } catch (error) {
      this.lastError = boundedText(error?.message || error, 280);
      this.procedures = [];
    }
    return this.procedures.slice();
  }

  save() {
    writeJsonAtomicSync(this.filePath, {
      version: STORE_VERSION,
      procedures: this.procedures,
      savedAt: Date.now(),
    });
    this.lastError = null;
  }

  find(goal) {
    const targetKey = goal.target.family || goal.target.canonicalName;
    const ranked = this.procedures
      .filter(procedure => (
        procedure.kind === goal.kind
        && procedure.targetKey === targetKey
        && procedure.destinationKind === goal.destination.kind
        && procedure.completionKind === goal.completion.kind
      ))
      .map(procedure => ({
        procedure,
        score: Math.min(50, procedure.successfulRuns),
      }))
      .sort((left, right) => (
        right.score - left.score
        || right.procedure.lastVerifiedAt - left.procedure.lastVerifiedAt
        || left.procedure.id.localeCompare(right.procedure.id)
      ));
    return ranked[0]?.procedure || null;
  }

  record(goal) {
    const candidate = procedureFromGoal(goal);
    const existingIndex = this.procedures.findIndex(procedure => procedure.id === candidate.id);
    if (existingIndex >= 0) {
      const existing = this.procedures[existingIndex];
      const merged = normalizeProcedure({
        ...candidate,
        steps: candidate.steps,
        successfulRuns: existing.successfulRuns + 1,
        firstVerifiedAt: existing.firstVerifiedAt,
        lastVerifiedAt: Date.now(),
      });
      this.procedures.splice(existingIndex, 1, merged);
    } else {
      this.procedures.push(candidate);
    }
    this.procedures = this.procedures
      .sort((left, right) => right.lastVerifiedAt - left.lastVerifiedAt)
      .slice(0, MAX_PROCEDURES);
    this.save();
    return this.procedures.find(procedure => procedure.id === candidate.id) || candidate;
  }
}

export function isSafeProcedureCommand(commandName) {
  return SAFE_COMMANDS.has(commandName);
}
