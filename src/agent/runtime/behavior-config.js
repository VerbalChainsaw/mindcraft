import { normalizeCharacterIdentity } from './identity-config.js';

const ROLE_PRESETS = Object.freeze({
  companion: Object.freeze({ focus: ['follow', 'assist', 'conversation'], reflexes: ['self_preservation', 'self_defense'] }),
  defender: Object.freeze({ focus: ['protect', 'hold_position', 'intercept'], reflexes: ['self_preservation', 'self_defense'] }),
  attacker: Object.freeze({ focus: ['engage', 'pursue', 'survive'], reflexes: ['self_preservation', 'self_defense'] }),
  builder: Object.freeze({ focus: ['materials', 'safe_building', 'verify_placement'], reflexes: ['self_preservation', 'cowardice'] }),
  miner: Object.freeze({ focus: ['tool_selection', 'resource_collection', 'safe_escape'], reflexes: ['self_preservation', 'cowardice'] }),
  scout: Object.freeze({ focus: ['explore', 'report', 'avoid_hazards'], reflexes: ['self_preservation', 'cowardice'] }),
  lumberjack: Object.freeze({ focus: ['tree_collection', 'replanting', 'safe_return'], reflexes: ['self_preservation', 'cowardice'] }),
  custom: Object.freeze({ focus: ['operator_instructions'], reflexes: ['self_preservation', 'cowardice'] }),
});

const AUTONOMY = new Set(['command', 'balanced', 'autonomous']);
const COMBAT_REFLEX_POLICIES = new Set(['role', 'defend', 'avoid', 'off']);
const VISION_MODES = new Set(['off', 'hybrid', 'on_demand']);
const LOADOUT_MODES = new Set(['survival', 'provisioned']);
const TEAM_MEMORY_MODES = new Set(['off', 'explicit']);
const SURVIVAL_MODES = new Set(['off', 'basic', 'full']);
const SLEEP_POLICIES = new Set(['off', 'safe']);
const SHELTER_POLICIES = new Set(['off', 'seek', 'emergency']);
const ARMOR_POLICIES = new Set(['off', 'upgrade']);
const USEFUL_DROP_POLICIES = new Set(['ignore', 'collect']);
const JOB_MODES = new Set(['off', 'simple', 'resumable']);
const DEPOSIT_POLICIES = new Set(['inventory', 'leader', 'assigned']);
const REACTION_MODES = new Set(['off', 'minimal', 'natural']);
const MAX_SPECIALTIES = 12;
const MAX_TEXT = 240;

function text(value, fallback = '', maxLength = MAX_TEXT) {
  if (typeof value !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex -- Reject wire/control bytes before policy text reaches runtime state.
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function enumValue(value, allowed, fallback) {
  const normalized = text(value, '', 48).toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function normalizeSpecialties(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => text(entry, '', 80)).filter(Boolean))].slice(0, MAX_SPECIALTIES);
}

function normalizeDepositTarget(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (![value.x, value.y, value.z].every(Number.isFinite)) return null;
  return Object.freeze({
    name: text(value.name, 'assigned_deposit', 64).toLowerCase().replace(/[^a-z0-9_]/g, '_'),
    x: Math.floor(value.x),
    y: Math.floor(value.y),
    z: Math.floor(value.z),
  });
}

function normalizeLoadout(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const requested = Array.isArray(source.items)
    ? source.items.slice(0, 36).map((item) => ({
      item: text(item?.item || item?.name, '', 96),
      count: boundedInteger(item?.count, 1, 1, 2304),
    })).filter((item) => item.item)
    : [];
  return {
    mode: enumValue(source.mode, LOADOUT_MODES, 'survival'),
    items: requested,
  };
}

export function normalizeRuntimeBehavior(profile = {}, legacySettings = {}) {
  const hasExplicitRuntime = Boolean(
    profile?.runtime
    && typeof profile.runtime === 'object'
    && !Array.isArray(profile.runtime),
  );
  const raw = hasExplicitRuntime ? profile.runtime : {};
  const role = enumValue(raw.role || profile.type || profile.role, new Set(Object.keys(ROLE_PRESETS)), 'companion');
  const identity = raw.identity && typeof raw.identity === 'object' ? raw.identity : {};
  const memory = raw.memory && typeof raw.memory === 'object' ? raw.memory : {};
  const reflexes = raw.reflexes && typeof raw.reflexes === 'object' && !Array.isArray(raw.reflexes)
    ? raw.reflexes
    : {};
  const vision = raw.vision && typeof raw.vision === 'object' ? raw.vision : {};
  const limits = raw.limits && typeof raw.limits === 'object' ? raw.limits : {};
  const assignment = raw.assignment && typeof raw.assignment === 'object' && !Array.isArray(raw.assignment)
    ? raw.assignment
    : {};
  const survival = raw.survival && typeof raw.survival === 'object' && !Array.isArray(raw.survival)
    ? raw.survival
    : {};
  const jobs = raw.jobs && typeof raw.jobs === 'object' && !Array.isArray(raw.jobs)
    ? raw.jobs
    : {};
  const reactions = raw.reactions && typeof raw.reactions === 'object' && !Array.isArray(raw.reactions)
    ? raw.reactions
    : {};
  const character = normalizeCharacterIdentity(profile.identity || identity, {
    displayName: profile.displayName || profile.name,
    appearance: profile.appearance,
  });
  const autonomy = enumValue(raw.autonomy, AUTONOMY, 'balanced');
  const visionMode = legacySettings.allow_vision === false && raw.vision?.mode === undefined
    ? 'off'
    : enumValue(vision.mode, VISION_MODES, legacySettings.allow_vision ? 'hybrid' : 'off');

  return Object.freeze({
    schemaVersion: 1,
    role,
    rolePreset: ROLE_PRESETS[role],
    autonomy,
    reflexes: Object.freeze({
      combat: enumValue(reflexes.combat, COMBAT_REFLEX_POLICIES, 'role'),
    }),
    survival: Object.freeze({
      mode: enumValue(survival.mode, SURVIVAL_MODES, hasExplicitRuntime ? 'full' : 'basic'),
      eatAt: boundedInteger(survival.eatAt, 14, 1, 20),
      criticalFood: boundedInteger(survival.criticalFood, 6, 0, 20),
      reserveFoodPoints: boundedInteger(survival.reserveFoodPoints, 12, 0, 40),
      sleep: enumValue(survival.sleep, SLEEP_POLICIES, 'safe'),
      shelter: enumValue(survival.shelter, SHELTER_POLICIES, hasExplicitRuntime ? 'emergency' : 'seek'),
      armor: enumValue(survival.armor, ARMOR_POLICIES, 'upgrade'),
      usefulDrops: enumValue(survival.usefulDrops, USEFUL_DROP_POLICIES, 'collect'),
    }),
    jobs: Object.freeze({
      mode: enumValue(jobs.mode, JOB_MODES, hasExplicitRuntime ? 'resumable' : 'simple'),
      stockpileLimit: boundedInteger(jobs.stockpileLimit, 128, 16, 2304),
      deposit: enumValue(jobs.deposit, DEPOSIT_POLICIES, 'inventory'),
    }),
    reactions: Object.freeze({
      mode: enumValue(reactions.mode, REACTION_MODES, hasExplicitRuntime ? 'natural' : 'minimal'),
      maxSpeechPerMinute: boundedInteger(reactions.maxSpeechPerMinute, 4, 0, 12),
      maxGesturesPerMinute: boundedInteger(reactions.maxGesturesPerMinute, 8, 0, 24),
    }),
    assignment: Object.freeze({
      leader: text(assignment.leader, '', 16),
      behavior: text(assignment.behavior, '', 48).toLowerCase(),
      formation: text(assignment.formation, '', 48).toLowerCase(),
      deposit: normalizeDepositTarget(assignment.deposit),
    }),
    identity: Object.freeze({
      ...character,
      nameplate: Object.freeze({ ...character.nameplate }),
      squad: Object.freeze({
        ...character.squad,
        naming: Object.freeze({
          ...character.squad.naming,
          memberNames: Object.freeze([...character.squad.naming.memberNames]),
        }),
      }),
      language: text(identity.language || raw.language || profile.language || legacySettings.language, 'en', 40),
      style: text(identity.style || raw.style || profile.style, '', 180),
      attitude: text(identity.attitude || raw.attitude || profile.attitude, '', 180),
      specialties: Object.freeze(normalizeSpecialties(identity.specialties || raw.specialties || profile.specialties)),
    }),
    memory: Object.freeze({
      personal: memory.personal !== false,
      team: enumValue(memory.team, TEAM_MEMORY_MODES, 'explicit'),
    }),
    vision: Object.freeze({
      mode: visionMode,
      maxRequestsPerMinute: boundedInteger(vision.maxRequestsPerMinute, 2, 0, 12),
      retainScreenshots: boundedInteger(vision.retainScreenshots, 12, 0, 48),
    }),
    loadout: Object.freeze(normalizeLoadout(raw.loadout)),
    limits: Object.freeze({
      maxActionMinutes: boundedInteger(limits.maxActionMinutes, 10, 1, 60),
      maxRecoveryAttempts: boundedInteger(limits.maxRecoveryAttempts, 2, 0, 6),
      maxNoProgress: boundedInteger(limits.maxNoProgress, 3, 1, 8),
      maxPromptTurns: boundedInteger(limits.maxPromptTurns, 3, 1, 8),
      maxConversationTurns: boundedInteger(limits.maxConversationTurns, 6, 2, 20),
      maxConversationMinutes: boundedInteger(limits.maxConversationMinutes, 5, 1, 30),
    }),
  });
}

export function describeRuntimeBehavior(behavior) {
  const config = behavior || normalizeRuntimeBehavior();
  const traits = [config.identity.attitude, config.identity.style, ...config.identity.specialties].filter(Boolean);
  return {
    displayName: config.identity.displayName,
    callSign: config.identity.callSign,
    title: config.identity.title,
    role: config.role,
    autonomy: config.autonomy,
    combatReflex: config.reflexes.combat,
    language: config.identity.language,
    traits,
    vision: config.vision.mode,
    loadout: config.loadout.mode,
  };
}

export function runtimeBehaviorToProfile(behavior) {
  const config = behavior || normalizeRuntimeBehavior();
  return {
    schemaVersion: 1,
    role: config.role,
    autonomy: config.autonomy,
    reflexes: {
      combat: config.reflexes.combat,
    },
    survival: { ...config.survival },
    jobs: { ...config.jobs },
    reactions: { ...config.reactions },
    assignment: {
      ...config.assignment,
      deposit: config.assignment.deposit ? { ...config.assignment.deposit } : null,
    },
    identity: {
      language: config.identity.language,
      style: config.identity.style,
      attitude: config.identity.attitude,
      specialties: [...config.identity.specialties],
    },
    memory: {
      personal: config.memory.personal,
      team: config.memory.team,
    },
    vision: {
      mode: config.vision.mode,
      maxRequestsPerMinute: config.vision.maxRequestsPerMinute,
      retainScreenshots: config.vision.retainScreenshots,
    },
    loadout: {
      mode: config.loadout.mode,
      items: config.loadout.items.map((item) => ({ ...item })),
    },
    limits: { ...config.limits },
  };
}

export const BOT_ROLE_PRESETS = ROLE_PRESETS;
