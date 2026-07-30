import { Buffer } from 'node:buffer';
import { validateAgentName } from '../utils/agent-name.js';

const MAX_SETTINGS_BYTES = 256 * 1024;
const MAX_STRING_LENGTH = 32 * 1024;
const MAX_ARRAY_ITEMS = 256;

export class AgentSettingsValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AgentSettingsValidationError';
  }
}

function cloneJson(value, label) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new AgentSettingsValidationError(`${label} must contain valid JSON data.`);
  }
  if (serialized === undefined) {
    throw new AgentSettingsValidationError(`${label} must contain valid JSON data.`);
  }
  return JSON.parse(serialized);
}

function validateValue(key, value, definition) {
  const label = `Setting '${key}'`;
  if (value === null && definition.default === null) return null;
  if (definition.type === 'array') {
    if (!Array.isArray(value)) throw new AgentSettingsValidationError(`${label} must be an array.`);
    if (value.length > MAX_ARRAY_ITEMS) {
      throw new AgentSettingsValidationError(`${label} has too many items.`);
    }
  } else if (definition.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new AgentSettingsValidationError(`${label} must be an object.`);
    }
  } else if (definition.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new AgentSettingsValidationError(`${label} must be a finite number.`);
    }
  } else if (definition.type === 'boolean') {
    if (typeof value !== 'boolean') throw new AgentSettingsValidationError(`${label} must be true or false.`);
  } else if (definition.type === 'string') {
    if (typeof value !== 'string') throw new AgentSettingsValidationError(`${label} must be text.`);
    if (value.length > MAX_STRING_LENGTH) throw new AgentSettingsValidationError(`${label} is too long.`);
  }
  if (Array.isArray(definition.options) && !definition.options.includes(value)) {
    throw new AgentSettingsValidationError(`${label} must be one of: ${definition.options.join(', ')}.`);
  }
  return cloneJson(value, label);
}

export function normalizeAgentSettings(input, settingsSpec, { expectedAgentName } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AgentSettingsValidationError('Agent settings must be an object.');
  }
  let serialized;
  try {
    serialized = JSON.stringify(input);
  } catch {
    throw new AgentSettingsValidationError('Agent settings must contain valid JSON data.');
  }
  if (!serialized || Buffer.byteLength(serialized, 'utf8') > MAX_SETTINGS_BYTES) {
    throw new AgentSettingsValidationError('Agent settings are too large.');
  }

  const normalized = {};
  for (const [key, definition] of Object.entries(settingsSpec || {})) {
    const hasValue = Object.hasOwn(input, key);
    if (!hasValue && definition.required && !Object.hasOwn(definition, 'default')) {
      throw new AgentSettingsValidationError(`Setting '${key}' is required.`);
    }
    if (!hasValue && !Object.hasOwn(definition, 'default')) continue;
    const value = hasValue ? input[key] : definition.default;
    normalized[key] = validateValue(key, value, definition);
  }

  const nameResult = validateAgentName(normalized.profile?.name);
  if (!nameResult.success) throw new AgentSettingsValidationError(nameResult.error);
  normalized.profile.name = nameResult.name;
  if (expectedAgentName && nameResult.name !== expectedAgentName) {
    throw new AgentSettingsValidationError('Agent settings cannot change the registered agent name.');
  }
  return normalized;
}
