import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { normalizeRuntimeBehavior, runtimeBehaviorToProfile } from '../agent/runtime/behavior-config.js';
import { normalizeCharacterIdentity } from '../agent/runtime/identity-config.js';
import { validateAgentName } from '../utils/agent-name.js';
import { writeJsonAtomicSync } from '../utils/atomic-file.js';

const MAX_ENTRIES = 128;
const MAX_TEXT = 520;
const MAX_NAME = 40;
const MAX_MODEL = 160;
const BOT_TYPES = new Set(['companion', 'defender', 'attacker', 'builder', 'miner', 'scout', 'lumberjack', 'custom']);
const PROVIDERS = new Set([
  'ollama', 'lmstudio', 'vllm', 'openai', 'anthropic', 'google', 'deepseek', 'groq', 'mistral',
  'xai', 'qwen', 'openrouter', 'cerebras', 'openai-compatible', 'custom',
]);
const AUTH_TYPES = new Set(['offline', 'microsoft']);

export const BOT_PROVIDER_CATALOG = Object.freeze([
  { id: 'openai', label: 'OpenAI API', credentialEnv: 'OPENAI_API_KEY', examples: ['gpt-4.1-mini'] },
  { id: 'deepseek', label: 'DeepSeek', credentialEnv: 'DEEPSEEK_API_KEY', examples: ['deepseek-v4-flash', 'deepseek-v4-pro'] },
  { id: 'anthropic', label: 'Anthropic / Claude', credentialEnv: 'ANTHROPIC_API_KEY', examples: ['claude-sonnet-4-5'] },
  { id: 'google', label: 'Google Gemini', credentialEnv: 'GEMINI_API_KEY', examples: ['gemini-2.5-flash'] },
  { id: 'ollama', label: 'Ollama (local)', credentialEnv: null, examples: ['qwen2.5:3b', 'llama3.2'] },
  { id: 'lmstudio', label: 'LM Studio (local)', credentialEnv: null, examples: ['local model id'] },
  { id: 'vllm', label: 'vLLM (local)', credentialEnv: null, examples: ['served model id'] },
  { id: 'groq', label: 'Groq', credentialEnv: 'GROQCLOUD_API_KEY', examples: ['llama-3.3-70b-versatile'] },
  { id: 'mistral', label: 'Mistral', credentialEnv: 'MISTRAL_API_KEY', examples: ['mistral-large-latest'] },
  { id: 'xai', label: 'xAI / Grok', credentialEnv: 'XAI_API_KEY', examples: ['grok-3-mini'] },
  { id: 'qwen', label: 'Qwen', credentialEnv: 'QWEN_API_KEY', examples: ['qwen-max'] },
  { id: 'openrouter', label: 'OpenRouter', credentialEnv: 'OPENROUTER_API_KEY', examples: ['provider/model-name'] },
  { id: 'openai-compatible', label: 'OpenAI-compatible endpoint', credentialEnv: 'OPENAI_COMPATIBLE_API_KEY', requiresBaseUrl: true, examples: ['provider/model-name'] },
  { id: 'custom', label: 'Custom endpoint (advanced)', credentialEnv: 'OPENAI_COMPATIBLE_API_KEY', requiresBaseUrl: true, examples: ['provider/model-name'] },
]);

function text(value, max = MAX_TEXT, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function model(value) {
  return text(value, MAX_MODEL);
}

function boundedPort(value, fallback = 25565) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback;
}

function providerId(value) {
  const normalized = text(value, 32, 'ollama').toLowerCase();
  return PROVIDERS.has(normalized) ? normalized : 'custom';
}

function typeId(value) {
  const normalized = text(value, 24, 'companion').toLowerCase();
  return BOT_TYPES.has(normalized) ? normalized : 'custom';
}

function safeBaseUrl(value) {
  const raw = text(value, 240);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
    parsed.hash = '';
    parsed.search = '';
    return parsed.href.replace(/\/$/, '');
  } catch {
    return '';
  }
}

function safeAgentName(value) {
  const candidate = text(value, 16);
  return validateAgentName(candidate).success ? candidate : '';
}

function deriveAgentName(name) {
  return safeAgentName(name.replace(/[^A-Za-z0-9_]/g, '').slice(0, 16));
}

export function normalizeBotProfile(input = {}, { preserveId = true } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Bot profile must be an object.');
  }
  const name = text(input.name, MAX_NAME);
  if (name.length < 1) throw new TypeError('Bot profile name is required.');
  const id = preserveId && /^[a-f0-9-]{20,}$/i.test(String(input.id || '')) ? String(input.id) : randomUUID();
  const agentName = safeAgentName(input.agentName) || deriveAgentName(name);
  const type = typeId(input.type);
  const role = text(input.role, 100, type);
  const behavior = {
    allowVision: Boolean(input.behavior?.allowVision ?? input.allowVision),
    loadMemory: Boolean(input.behavior?.loadMemory ?? input.loadMemory),
    speak: Boolean(input.behavior?.speak ?? input.speak),
    chatInGame: input.behavior?.chatInGame !== false && input.chatInGame !== false,
  };
  const identity = normalizeCharacterIdentity({
    ...(input.identity && typeof input.identity === 'object' ? input.identity : {}),
    profileId: id,
  }, {
    displayName: name,
    appearance: input.appearance,
  });
  const runtime = runtimeBehaviorToProfile(normalizeRuntimeBehavior({
    ...input,
    name: agentName,
    type,
    role,
    identity,
    runtime: input.runtime,
  }, {
    allow_vision: behavior.allowVision,
    language: input.language,
  }));
  return {
    id,
    name,
    agentName,
    type,
    role,
    job: text(input.job, 180),
    persona: text(input.persona),
    appearance: identity.appearance,
    identity,
    runtime,
    provider: {
      id: providerId(input.provider?.id || input.provider),
      chatModel: model(input.provider?.chatModel || input.chatModel),
      codeModel: model(input.provider?.codeModel || input.codeModel),
      visionModel: model(input.provider?.visionModel || input.visionModel),
      embeddingModel: model(input.provider?.embeddingModel || input.embeddingModel),
      baseUrl: safeBaseUrl(input.provider?.baseUrl || input.baseUrl),
    },
    connection: {
      host: text(input.connection?.host || input.host, 255, '127.0.0.1'),
      port: boundedPort(input.connection?.port || input.port),
      auth: AUTH_TYPES.has(String(input.connection?.auth || input.auth || 'offline').toLowerCase())
        ? String(input.connection?.auth || input.auth || 'offline').toLowerCase()
        : 'offline',
      minecraftVersion: text(input.connection?.minecraftVersion || input.minecraft_version, 40, 'auto'),
    },
    behavior,
    createdAt: text(input.createdAt, 40, new Date().toISOString()),
    updatedAt: new Date().toISOString(),
  };
}

function readProfiles(filePath) {
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!Array.isArray(raw)) throw new TypeError('Saved bot library must be a JSON array.');
    return { profiles: raw.map((entry) => normalizeBotProfile(entry)).slice(0, MAX_ENTRIES), error: null };
  } catch (error) {
    return {
      profiles: [],
      error: `Saved bot library could not be read. It was left untouched: ${String(error?.message || error).slice(0, 180)}`,
    };
  }
}

export class BotLibraryStore {
  constructor({ filePath = path.join(process.cwd(), 'server_data', 'bot-library.json') } = {}) {
    this.filePath = filePath;
    const loaded = existsSync(filePath) ? readProfiles(filePath) : { profiles: [], error: null };
    this.profiles = loaded.profiles;
    this.storageError = loaded.error;
  }

  assertWritable() {
    if (this.storageError) throw new TypeError(`${this.storageError} Fix or restore the file before changing the Bot Library.`);
  }

  persist() {
    writeJsonAtomicSync(this.filePath, this.profiles);
  }

  list() {
    return this.profiles.map((profile) => structuredClone(profile));
  }

  health() {
    return { writable: !this.storageError, error: this.storageError };
  }

  get(id) {
    const profile = this.profiles.find((entry) => entry.id === String(id || ''));
    return profile ? structuredClone(profile) : null;
  }

  upsert(input = {}) {
    this.assertWritable();
    const existing = this.profiles.find((entry) => entry.id === String(input?.id || ''));
    const normalized = normalizeBotProfile(existing ? {
      ...existing,
      ...input,
      provider: { ...existing.provider, ...(input.provider || {}) },
      connection: { ...existing.connection, ...(input.connection || {}) },
      behavior: { ...existing.behavior, ...(input.behavior || {}) },
      identity: { ...existing.identity, ...(input.identity || {}) },
      runtime: {
        ...existing.runtime,
        ...(input.runtime || {}),
        identity: { ...existing.runtime?.identity, ...(input.runtime?.identity || {}) },
        memory: { ...existing.runtime?.memory, ...(input.runtime?.memory || {}) },
        vision: { ...existing.runtime?.vision, ...(input.runtime?.vision || {}) },
        loadout: { ...existing.runtime?.loadout, ...(input.runtime?.loadout || {}) },
        limits: { ...existing.runtime?.limits, ...(input.runtime?.limits || {}) },
      },
      createdAt: existing.createdAt,
    } : input);
    const duplicate = this.profiles.find((entry) => entry.name.toLowerCase() === normalized.name.toLowerCase() && entry.id !== normalized.id);
    if (duplicate) throw new TypeError(`A bot profile named '${duplicate.name}' already exists.`);
    const index = this.profiles.findIndex((entry) => entry.id === normalized.id);
    if (index === -1 && this.profiles.length >= MAX_ENTRIES) throw new TypeError(`Bot Library is limited to ${MAX_ENTRIES} profiles.`);
    if (index === -1) this.profiles.push(normalized);
    else this.profiles[index] = normalized;
    this.persist();
    return structuredClone(normalized);
  }

  remove(id) {
    try { this.assertWritable(); } catch (error) { return { success: false, error: String(error?.message || error) }; }
    const key = String(id || '');
    const index = this.profiles.findIndex((entry) => entry.id === key);
    if (index === -1) return { success: false, error: 'Bot profile not found.' };
    this.profiles.splice(index, 1);
    this.persist();
    return { success: true, id: key };
  }
}

export function botProfileToAgentSettings(profile, { agentName } = {}) {
  const normalized = normalizeBotProfile(profile);
  const runtimeName = safeAgentName(agentName) || normalized.agentName;
  if (!runtimeName) throw new TypeError('Bot profile needs a valid 3-16 character Minecraft agent name before it can start.');
  const provider = normalized.provider.id;
  const chatModel = normalized.provider.chatModel;
  const api = ['openai-compatible', 'custom'].includes(provider) ? 'openai_compatible' : provider;
  const modelForApi = (value) => {
    if (!value) return value;
    if (value.startsWith(`${api}/`)) return value;
    return `${api}/${value}`;
  };
  const modelName = modelForApi(chatModel);
  const settings = {
    profile: {
      name: runtimeName,
      model: modelName,
      code_model: normalized.provider.codeModel
        ? modelForApi(normalized.provider.codeModel)
        : undefined,
      persona: normalized.persona,
      role: normalized.role,
      job: normalized.job,
      appearance: normalized.appearance,
      identity: normalizeCharacterIdentity({
        ...normalized.identity,
        profileId: normalized.id,
      }, {
        displayName: normalized.name,
        appearance: normalized.appearance,
      }),
      runtime: structuredClone(normalized.runtime),
    },
    host: normalized.connection.host,
    port: normalized.connection.port,
    auth: normalized.connection.auth,
    minecraft_version: normalized.connection.minecraftVersion,
    allow_vision: normalized.behavior.allowVision,
    load_memory: normalized.behavior.loadMemory,
    speak: normalized.behavior.speak,
    chat_ingame: normalized.behavior.chatInGame,
  };
  settings.profile.api = api;
  if (normalized.provider.visionModel) {
    settings.profile.vision_model = modelForApi(normalized.provider.visionModel);
  }
  if (normalized.provider.embeddingModel) {
    settings.profile.embedding = modelForApi(normalized.provider.embeddingModel);
  }
  if (normalized.provider.baseUrl) settings.profile.url = normalized.provider.baseUrl;
  return settings;
}

export const BOT_LIBRARY_TYPES = Object.freeze([...BOT_TYPES]);
