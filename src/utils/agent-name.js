const AGENT_NAME_PATTERN = /^[a-zA-Z0-9_]{3,16}$/;

export function normalizeAgentName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function validateAgentName(value) {
  const name = normalizeAgentName(value);
  if (!AGENT_NAME_PATTERN.test(name)) {
    return {
      success: false,
      name,
      error: 'Agent name must be 3-16 alphanumeric or underscore characters.',
    };
  }
  return { success: true, name, error: null };
}

export function prepareAgentName(value) {
  const strict = validateAgentName(value);
  if (strict.success) return { ...strict, changed: false };
  const raw = normalizeAgentName(value);
  if (!/^[a-zA-Z0-9_-]{3,64}$/.test(raw)) return { ...strict, changed: false };
  const prepared = raw.replaceAll('-', '_').slice(0, 16);
  const result = validateAgentName(prepared);
  return {
    ...result,
    changed: result.success && prepared !== raw,
  };
}
