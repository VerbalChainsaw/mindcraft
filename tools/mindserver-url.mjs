/**
 * One place that knows where MindServer is.
 *
 * Seven separate tools hardcoded `http://localhost:8080`. `launcher-config.json`
 * now says `mindserver_port: 8081`, so each of them silently connected to a dead
 * port. In the Scenario Lab that surfaced as a bare "websocket error" one step
 * before the measurement harness ever started, and it cost several runs to
 * locate because each tool had its own copy of the wrong number.
 *
 * Resolution order, most specific first:
 *   1. an explicit URL (CLI flag)
 *   2. SCENARIO_LAB_MINDSERVER_URL / MINDSERVER_URL
 *   3. launcher-config.json -> mindserver_port, then port_scan_start
 *   4. http://localhost:8080
 *
 * Use `localhost`, not the `127.0.0.1` literal: MindServer binds the IPv6
 * loopback, so `localhost` and `[::1]` answer while the IPv4 literal is refused
 * even when the launcher is healthy.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_MINDSERVER_PORT = 8080;

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

function validPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

/** MindServer's port from launcher-config.json, or null when unreadable. */
export function mindserverPortFromLauncherConfig(repoRoot = REPO_ROOT) {
  try {
    const raw = readFileSync(path.join(repoRoot, 'launcher-config.json'), 'utf8');
    const config = JSON.parse(raw);
    return validPort(config?.mindserver_port) ?? validPort(config?.port_scan_start);
  } catch {
    return null;
  }
}

/** Resolved MindServer base URL, with no trailing slash. */
export function resolveMindserverUrl({
  explicitUrl = '',
  env = process.env,
  repoRoot = REPO_ROOT,
} = {}) {
  const explicit = String(explicitUrl || '').trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const fromEnv = String(env?.SCENARIO_LAB_MINDSERVER_URL || env?.MINDSERVER_URL || '').trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');

  const port = mindserverPortFromLauncherConfig(repoRoot) ?? DEFAULT_MINDSERVER_PORT;
  return `http://localhost:${port}`;
}
