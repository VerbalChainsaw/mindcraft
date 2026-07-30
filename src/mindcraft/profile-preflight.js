import { describeModelProvider, resolveConfiguredModel } from '../models/_model_map.js';
import { prepareAgentName, validateAgentName } from '../utils/agent-name.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function createDescriptor(index, name, state, lastError, retryable) {
  return { index, name, state, running: false, lastError, retryable };
}

function evaluateCredential(description, role, hasKey) {
  if (!description.ok) {
    return { lastError: `Unsupported ${role} provider.`, retryable: false };
  }
  const available = description.credentialAlternatives.length === 0
    || description.credentialAlternatives.some((key) => Boolean(hasKey?.(key)));
  return available ? null : {
    lastError: `Missing credential for ${role} provider "${description.provider}".`,
    retryable: true,
  };
}

export function buildProfileSettings(baseSettings, profile) {
  const settings = clone(baseSettings);
  settings.profile = clone(profile);
  if (!settings.profile.model && settings.model) {
    settings.profile.model = settings.model;
  }
  settings.profile.name = normalizeName(settings.profile.name);
  return settings;
}

export function assessProfileSettings(settings, { hasKey } = {}) {
  const nameCheck = validateAgentName(settings?.profile?.name);
  const name = nameCheck.name || 'unnamed-profile';
  if (!nameCheck.success) {
    return createDescriptor(-1, name, 'blocked', nameCheck.error, false);
  }

  let chatProfile;
  try {
    chatProfile = resolveConfiguredModel(settings.profile, 'model');
  } catch {
    return createDescriptor(-1, name, 'blocked', 'Unsupported chat model provider.', false);
  }
  const chat = describeModelProvider(chatProfile);
  let failure = evaluateCredential(chat, 'chat model', hasKey);
  if (failure) return createDescriptor(-1, name, 'blocked', failure.lastError, failure.retryable);

  if (settings.profile.code_model) {
    let codeProfile;
    try {
      codeProfile = resolveConfiguredModel(settings.profile, 'code_model');
    } catch {
      return createDescriptor(-1, name, 'blocked', 'Unsupported code model provider.', false);
    }
    failure = evaluateCredential(describeModelProvider(codeProfile), 'code model', hasKey);
    if (failure) return createDescriptor(-1, name, 'blocked', failure.lastError, failure.retryable);
  }

  if (settings.profile.vision_model) {
    let visionProfile;
    try {
      visionProfile = resolveConfiguredModel(settings.profile, 'vision_model');
    } catch {
      return createDescriptor(-1, name, 'blocked', 'Unsupported vision model provider.', false);
    }
    failure = evaluateCredential(describeModelProvider(visionProfile), 'vision model', hasKey);
    if (failure) return createDescriptor(-1, name, 'blocked', failure.lastError, failure.retryable);
  }

  let embedding = chat;
  if (settings.profile.embedding) {
    try {
      embedding = describeModelProvider(resolveConfiguredModel(settings.profile, 'embedding'));
    } catch {
      return createDescriptor(-1, name, 'blocked', 'Unsupported embedding model provider.', false);
    }
  }
  failure = evaluateCredential(embedding, 'embedding model', hasKey);
  if (failure) return createDescriptor(-1, name, 'blocked', failure.lastError, failure.retryable);

  return createDescriptor(-1, name, 'ready', null, false);
}

export function prepareProfiles(profileEntries, baseSettings, { hasKey } = {}) {
  const candidates = profileEntries.map((entry, index) => {
    if (!entry?.profile || typeof entry.profile !== 'object' || Array.isArray(entry.profile)) {
      return {
        descriptor: createDescriptor(index, `profile-${index + 1}`, 'blocked', 'Malformed selected profile.', false),
      };
    }
    const settings = buildProfileSettings(baseSettings, entry.profile);
    const nameCheck = prepareAgentName(settings.profile.name);
    if (!nameCheck.success) {
      return {
        descriptor: createDescriptor(
          index,
          nameCheck.name || `profile-${index + 1}`,
          'blocked',
          nameCheck.error,
          false,
        ),
      };
    }
    settings.profile.name = nameCheck.name;
    return { settings, index };
  });
  const nameCounts = new Map();
  for (const candidate of candidates) {
    if (candidate.settings) {
      const name = candidate.settings.profile.name;
      nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
    }
  }

  const ready = [];
  const blocked = [];
  for (const candidate of candidates) {
    if (candidate.descriptor) {
      blocked.push(candidate.descriptor);
      continue;
    }
    const name = candidate.settings.profile.name;
    if (nameCounts.get(name) > 1) {
      blocked.push(createDescriptor(candidate.index, name, 'blocked', `Duplicate agent name "${name}".`, false));
      continue;
    }
    const assessed = assessProfileSettings(candidate.settings, { hasKey });
    const descriptor = { ...assessed, index: candidate.index };
    if (descriptor.state === 'ready') ready.push(descriptor);
    else blocked.push(descriptor);
  }
  return { ready, blocked };
}
