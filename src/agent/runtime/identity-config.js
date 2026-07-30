import { validateAgentName } from '../../utils/agent-name.js';

const ID_PATTERN = /^[A-Za-z0-9:_-]{1,96}$/;
const NAME_STYLES = new Set(['numbered', 'role', 'themed', 'custom']);
const NAMEPLATE_COLORS = new Set([
  'black', 'dark_blue', 'dark_green', 'dark_aqua', 'dark_red', 'dark_purple',
  'gold', 'gray', 'dark_gray', 'blue', 'green', 'aqua', 'red', 'light_purple',
  'yellow', 'white',
]);

function text(value, max = 120, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function identityId(value) {
  const candidate = text(value, 96);
  return ID_PATTERN.test(candidate) ? candidate : '';
}

function color(value, fallback = 'gray') {
  const candidate = text(value, 24).toLowerCase();
  return NAMEPLATE_COLORS.has(candidate) ? candidate : fallback;
}

function nameStyle(value, fallback = 'numbered') {
  const candidate = text(value, 24).toLowerCase();
  return NAME_STYLES.has(candidate) ? candidate : fallback;
}

function normalizedNameplate(input = {}, fallback = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const defaults = fallback && typeof fallback === 'object' && !Array.isArray(fallback) ? fallback : {};
  return {
    badge: text(source.badge, 12, text(defaults.badge, 12)),
    color: color(source.color, color(defaults.color)),
  };
}

export function normalizeSquadIdentity(input = {}, fallback = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const defaults = fallback && typeof fallback === 'object' && !Array.isArray(fallback) ? fallback : {};
  const namingSource = source.naming && typeof source.naming === 'object' && !Array.isArray(source.naming)
    ? source.naming
    : {};
  const namingDefaults = defaults.naming && typeof defaults.naming === 'object' && !Array.isArray(defaults.naming)
    ? defaults.naming
    : {};
  const memberNames = Array.isArray(namingSource.memberNames)
    ? namingSource.memberNames
    : (Array.isArray(source.memberNames) ? source.memberNames : namingDefaults.memberNames);

  return {
    id: identityId(source.id || defaults.id),
    displayName: text(source.displayName || source.name, 60, text(defaults.displayName || defaults.name, 60)),
    badge: text(source.badge, 12, text(defaults.badge, 12)),
    color: color(source.color, color(defaults.color)),
    motto: text(source.motto, 120, text(defaults.motto, 120)),
    naming: {
      style: nameStyle(namingSource.style || source.nameStyle, nameStyle(namingDefaults.style)),
      memberNames: Array.isArray(memberNames)
        ? memberNames.map((entry) => text(entry, 40)).filter(Boolean).slice(0, 12)
        : [],
    },
  };
}

export function normalizeCharacterIdentity(input = {}, fallback = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const defaults = fallback && typeof fallback === 'object' && !Array.isArray(fallback) ? fallback : {};
  const squad = normalizeSquadIdentity(source.squad, defaults.squad);
  const nameplate = normalizedNameplate(source.nameplate, {
    badge: defaults.nameplate?.badge || squad.badge,
    color: defaults.nameplate?.color || squad.color,
  });

  return {
    schemaVersion: 1,
    profileId: identityId(source.profileId || defaults.profileId),
    instanceId: identityId(source.instanceId || defaults.instanceId),
    displayName: text(
      source.displayName || source.name,
      60,
      text(defaults.displayName || defaults.name, 60),
    ),
    callSign: text(source.callSign, 24, text(defaults.callSign, 24)),
    title: text(source.title, 80, text(defaults.title, 80)),
    appearance: text(source.appearance, 240, text(defaults.appearance, 240)),
    nameplate,
    squad,
  };
}

function minecraftNameBase(value, fallback) {
  let candidate = text(value, 40)
    .replace(/[^A-Za-z0-9_]/g, '')
    .slice(0, 16);
  if (candidate.length < 3) {
    candidate = text(fallback, 16, 'Bot')
      .replace(/[^A-Za-z0-9_]/g, '')
      .slice(0, 16);
  }
  if (candidate.length < 3) candidate = `Bot${candidate}`.slice(0, 16);
  return validateAgentName(candidate).success ? candidate : 'Bot';
}

function minecraftPrefixBase(value) {
  const candidate = text(value, 40)
    .replace(/[^A-Za-z0-9_]/g, '')
    .slice(0, 15);
  return candidate.length >= 2 ? candidate : 'Bot';
}

function availableMinecraftName(base, occupied) {
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const suffix = attempt === 0 ? '' : String(attempt + 1);
    const candidate = `${base.slice(0, 16 - suffix.length)}${suffix}`;
    if (validateAgentName(candidate).success && !occupied.has(candidate.toLowerCase())) {
      occupied.add(candidate.toLowerCase());
      return candidate;
    }
  }
  throw new TypeError(`Could not generate an available Minecraft name from '${base}'.`);
}

export function createUniqueAgentNames({
  prefix,
  size,
  preferredNames = [],
  occupiedNames = [],
} = {}) {
  const count = Number(size);
  if (!Number.isInteger(count) || count < 1 || count > 12) {
    throw new TypeError('Squad size must be between 1 and 12.');
  }
  const safePrefix = minecraftPrefixBase(prefix);
  const occupied = new Set(
    [...occupiedNames]
      .map((entry) => text(entry, 16).toLowerCase())
      .filter(Boolean),
  );

  return Array.from({ length: count }, (_unused, index) => {
    const fallback = `${safePrefix}${index + 1}`.slice(0, 16);
    const preferred = Array.isArray(preferredNames) ? preferredNames[index] : '';
    const base = minecraftNameBase(preferred, fallback);
    return availableMinecraftName(base, occupied);
  });
}

export function identityToTelemetry(identity = {}, fallback = {}) {
  return normalizeCharacterIdentity(identity, fallback);
}

export function identityPrompt(identity = {}) {
  const normalized = normalizeCharacterIdentity(identity);
  const lines = [];
  if (normalized.displayName) lines.push(`Display name: ${normalized.displayName}`);
  if (normalized.callSign) lines.push(`Call sign: ${normalized.callSign}`);
  if (normalized.title) lines.push(`Title: ${normalized.title}`);
  if (normalized.appearance) lines.push(`Appearance theme: ${normalized.appearance}`);
  if (normalized.squad.displayName) lines.push(`Squad: ${normalized.squad.displayName}`);
  if (normalized.squad.motto) lines.push(`Squad motto: ${normalized.squad.motto}`);
  return lines.join('\n');
}

export const IDENTITY_NAME_STYLES = Object.freeze([...NAME_STYLES]);
export const IDENTITY_NAMEPLATE_COLORS = Object.freeze([...NAMEPLATE_COLORS]);
