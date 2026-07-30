const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function normalizedTarget(value, source, { loopbackOnly = false } = {}) {
  const host = typeof value?.host === 'string' ? value.host.trim() : '';
  const port = Number(value?.port);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (loopbackOnly && !LOOPBACK_HOSTS.has(host)) return null;
  return {
    host,
    port,
    auth: typeof value?.auth === 'string' && value.auth.trim() ? value.auth.trim() : 'offline',
    minecraft_version: typeof value?.minecraft_version === 'string' && value.minecraft_version.trim()
      ? value.minecraft_version.trim()
      : 'auto',
    source,
  };
}

export function resolveManagedMinecraftTarget(status, { requireRunning = true } = {}) {
  if (!status || typeof status !== 'object' || status.installed !== true) return null;
  if (requireRunning && status.phase !== 'running') return null;
  return normalizedTarget({
    host: status.host,
    port: status.port,
    auth: 'offline',
    minecraft_version: 'auto',
  }, 'managed-runtime', { loopbackOnly: true });
}

export function resolveMinecraftTarget(config, managedStatus = null) {
  return resolveManagedMinecraftTarget(managedStatus)
    || normalizedTarget(config?.agent_defaults, 'launcher-config')
    || normalizedTarget({ host: '127.0.0.1', port: 55916 }, 'default');
}

export function targetSettings(target) {
  if (!target) return {};
  const { host, port, auth, minecraft_version } = target;
  return { host, port, auth, minecraft_version };
}

export function applyMinecraftTarget(config, target) {
  if (!target) return config;
  return {
    ...config,
    agent_defaults: {
      ...config.agent_defaults,
      ...targetSettings(target),
    },
  };
}
