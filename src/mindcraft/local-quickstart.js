export const LOCAL_QUICKSTART_PROFILE = './profiles/local-quickstart.json';

export class LocalQuickstartValidationError extends Error {}

function validModelNames(models) {
  return new Set(
    (Array.isArray(models) ? models : [])
      .map(({ name }) => name)
      .filter((name) => typeof name === 'string' && name.length > 0),
  );
}

function normalizeBotName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
    throw new LocalQuickstartValidationError(
      'Bot name must be 3-16 characters using only letters, numbers, or underscores.',
    );
  }
  return name;
}

function normalizeHost(value, fallback = '127.0.0.1') {
  const host = typeof value === 'string' ? value.trim() : '';
  if (!host) return fallback;
  if (host.length > 253 || !/^[A-Za-z0-9._:[\]-]+$/.test(host)) {
    throw new LocalQuickstartValidationError('Minecraft host is invalid.');
  }
  return host;
}

function normalizePort(value, fallback = 55916) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    if (value === undefined || value === null || value === '') return fallback;
    throw new LocalQuickstartValidationError('Minecraft port must be between 1 and 65535.');
  }
  return port;
}

export function createLocalQuickstartPlan(input, models, existingConfig = {}) {
  const available = validModelNames(models);
  const chatModel = typeof input?.chatModel === 'string' ? input.chatModel.trim() : '';
  const embeddingModel = typeof input?.embeddingModel === 'string' ? input.embeddingModel.trim() : '';
  if (!chatModel || !available.has(chatModel)) {
    throw new LocalQuickstartValidationError('Choose a chat model currently available in Ollama.');
  }
  if (embeddingModel && !available.has(embeddingModel)) {
    throw new LocalQuickstartValidationError('Choose an embedding model currently available in Ollama.');
  }

  const botName = normalizeBotName(input?.botName);
  const defaults = existingConfig.agent_defaults || {};
  const host = normalizeHost(input?.host, defaults.host || '127.0.0.1');
  const port = normalizePort(input?.port, defaults.port || 55916);
  const profile = {
    name: botName,
    model: `ollama/${chatModel}`,
    runtime: {
      role: 'companion',
      autonomy: 'command',
      reflexes: { combat: 'off' },
      survival: { mode: 'off', sleep: 'off', shelter: 'off' },
      jobs: { mode: 'off' },
      reactions: { mode: 'off', maxSpeechPerMinute: 0, maxGesturesPerMinute: 0 },
    },
    modes: {
      self_preservation: false,
      unstuck: false,
      cowardice: false,
      self_defense: false,
      hunting: false,
      item_collecting: false,
      torch_placing: false,
      elbow_room: false,
      idle_staring: false,
      cheat: false,
    },
    conversation_examples: [
      [
        { role: 'user', content: `${botName === 'DirectorTest' ? 'Player' : 'DirectorTest'}: Come here.` },
        { role: 'assistant', content: `Coming. !come(\"${botName === 'DirectorTest' ? 'Player' : 'DirectorTest'}\")` },
      ],
      [
        { role: 'user', content: `${botName === 'DirectorTest' ? 'Player' : 'DirectorTest'}: Follow me.` },
        { role: 'assistant', content: `Following. !follow(\"${botName === 'DirectorTest' ? 'Player' : 'DirectorTest'}\")` },
      ],
    ],
  };
  if (embeddingModel) profile.embedding = `ollama/${embeddingModel}`;
  const visionModel = ['llama3.2-vision:latest', 'moondream:latest']
    .find(model => available.has(model));
  if (visionModel) profile.vision_model = `ollama/${visionModel}`;

  return {
    profile,
    configUpdate: {
      profiles: [LOCAL_QUICKSTART_PROFILE],
      auto_open_ui: true,
      auto_start: input?.autoStart === true,
      agent_defaults: {
        ...defaults,
        host,
        port,
        auth: defaults.auth || 'offline',
        minecraft_version: defaults.minecraft_version || 'auto',
        base_profile: defaults.base_profile || 'assistant',
        allow_vision: Boolean(visionModel),
        render_bot_view: defaults.render_bot_view === true,
      },
    },
  };
}

export function summarizeLocalQuickstart(config, profile) {
  const selected = Array.isArray(config?.profiles) && config.profiles.includes(LOCAL_QUICKSTART_PROFILE);
  const model = typeof profile?.model === 'string' && profile.model.startsWith('ollama/')
    ? profile.model.slice('ollama/'.length)
    : null;
  const embeddingModel = typeof profile?.embedding === 'string' && profile.embedding.startsWith('ollama/')
    ? profile.embedding.slice('ollama/'.length)
    : null;
  return {
    configured: Boolean(selected && profile?.name && model),
    botName: typeof profile?.name === 'string' ? profile.name : null,
    chatModel: model,
    embeddingModel,
    minecraft: {
      host: config?.agent_defaults?.host || '127.0.0.1',
      port: config?.agent_defaults?.port || 55916,
    },
    autoStart: Boolean(config?.auto_start),
  };
}
