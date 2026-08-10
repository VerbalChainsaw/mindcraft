import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import net from 'node:net';
import { networkInterfaces as listNetworkInterfaces } from 'node:os';
import mineflayer from 'mineflayer';
import { terminateOwnedProcessTree } from './process-tree.js';

const DEFAULT_PORT = 25565;
const DEFAULT_MEMORY_MB = 2048;
const DEFAULT_JAVA_MAJOR = 21;
const JAVA_CACHE_MS = 30_000;
const VERSION_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const PAPER_LATEST_BUILD_URL = (version) => `https://fill.papermc.io/v3/projects/paper/versions/${encodeURIComponent(version)}/builds/latest`;
const GEYSER_LATEST_BUILD_URL = 'https://download.geysermc.org/v2/projects/geyser/versions/latest/builds/latest';
const GEYSER_SPIGOT_DOWNLOAD_URL = `${GEYSER_LATEST_BUILD_URL}/downloads/spigot`;
const FLOODGATE_LATEST_BUILD_URL = 'https://download.geysermc.org/v2/projects/floodgate/versions/latest/builds/latest';
const FLOODGATE_SPIGOT_DOWNLOAD_URL = `${FLOODGATE_LATEST_BUILD_URL}/downloads/spigot`;
const VIAVERSION_LATEST_URL = 'https://hangar.papermc.io/api/v1/projects/ViaVersion/latestrelease';
const VIAVERSION_VERSION_URL = (version) => `https://hangar.papermc.io/api/v1/projects/ViaVersion/versions/${encodeURIComponent(version)}`;
const MAX_SERVER_JAR_BYTES = 150 * 1024 * 1024;
const MAX_PLUGIN_JAR_BYTES = 50 * 1024 * 1024;
const DEFAULT_BEDROCK_PORT = 19132;
const DEFAULT_BEDROCK_BIND_ADDRESS = '127.0.0.1';
const ALLOWED_LOCAL_BIND_ADDRESSES = new Set(['127.0.0.1', '0.0.0.0']);
const MAX_LOG_LINES = 200;
const STOP_TIMEOUT_MS = 20_000;
const DEFAULT_SERVER_SETTINGS = Object.freeze({
  motd: 'Mindcraft Local Server',
  onlineMode: false,
  whiteList: false,
  enforceWhitelist: false,
  hideOnlinePlayers: false,
  logIps: true,
  gameMode: 'survival',
  difficulty: 'normal',
  maxPlayers: 10,
  pvp: true,
  forceGameMode: false,
  hardcore: false,
  allowFlight: true,
  enableCommandBlock: true,
  spawnProtection: 0,
  playerIdleTimeout: 0,
  opPermissionLevel: 4,
  viewDistance: 10,
  simulationDistance: 8,
  pauseWhenEmptySeconds: -1,
  entityBroadcastRangePercentage: 100,
});
const BOOLEAN_SERVER_SETTINGS = Object.freeze([
  'onlineMode',
  'whiteList',
  'enforceWhitelist',
  'hideOnlinePlayers',
  'logIps',
  'pvp',
  'forceGameMode',
  'hardcore',
  'allowFlight',
  'enableCommandBlock',
]);
const MAX_CONSOLE_COMMAND_CHARS = 2_048;
const MAX_CONSOLE_COMMAND_BATCH = 128;
const MAX_CONSOLE_COMMAND_SETTLE_MS = 2_000;
const MANAGED_PLAYER_RESPONSE_TIMEOUT_MS = 750;
const MANAGED_PLAYER_RESPONSE_POLL_MS = 20;
const MANAGED_PLAYER_NAME = /^(?:[A-Za-z0-9_]{1,16}|\.[A-Za-z0-9_]{1,15})$/;
const BLOCKED_CONSOLE_COMMANDS = new Set([
  'stop',
  'minecraft:stop',
  'restart',
  'paper:restart',
  'spigot:restart',
  'reload',
  'minecraft:reload',
  'bukkit:reload',
  'paper:reload',
  'spigot:reload',
]);

export class ManagedMinecraftServerError extends Error {}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readSimpleYamlScalar(source, key) {
  const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*:\\s*([^#\\r\\n]*?)(?:\\s+#.*)?$`, 'm');
  const match = String(source || '').match(pattern);
  if (!match) return null;
  const raw = match[1].trim();
  if (
    raw.length >= 2
    && ((raw.startsWith('"') && raw.endsWith('"'))
      || (raw.startsWith("'") && raw.endsWith("'")))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

function locateYamlSectionSetting(source, section, key) {
  const text = String(source || '');
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const sectionPattern = new RegExp(`^${escapeRegExp(section)}:\\s*(?:#.*)?$`);
  const sectionIndexes = lines
    .map((line, index) => (sectionPattern.test(line) ? index : -1))
    .filter((index) => index >= 0);
  if (sectionIndexes.length !== 1) {
    return {
      success: false,
      error: `Geyser ${section} section is ${sectionIndexes.length ? 'ambiguous' : 'missing'}.`,
    };
  }

  const sectionIndex = sectionIndexes[0];
  let sectionEnd = lines.length;
  for (let index = sectionIndex + 1; index < lines.length; index += 1) {
    if (/^[A-Za-z0-9_-]+:\s*(?:.*)?$/.test(lines[index])) {
      sectionEnd = index;
      break;
    }
  }
  const settingPattern = new RegExp(
    `^(\\s+${escapeRegExp(key)}\\s*:\\s*)([^#\\r\\n]*?)(\\s*(?:#.*)?)$`,
  );
  const matches = [];
  for (let index = sectionIndex + 1; index < sectionEnd; index += 1) {
    const match = lines[index].match(settingPattern);
    if (match) matches.push({ index, match });
  }
  if (matches.length !== 1) {
    return {
      success: false,
      error: `Geyser ${section}.${key} setting is ${matches.length ? 'ambiguous' : 'missing'}.`,
    };
  }
  const [{ index, match }] = matches;
  const rawValue = match[2].trim();
  const unquotedValue = (
    rawValue.length >= 2
    && ((rawValue.startsWith('"') && rawValue.endsWith('"'))
      || (rawValue.startsWith("'") && rawValue.endsWith("'")))
  ) ? rawValue.slice(1, -1) : rawValue;
  return {
    success: true,
    lines,
    newline,
    index,
    prefix: match[1],
    suffix: match[3],
    value: unquotedValue,
  };
}

function locateYamlSetting(source, sections, key) {
  const candidates = Array.isArray(sections) ? sections : [sections];
  const failures = [];
  for (const section of candidates) {
    const located = locateYamlSectionSetting(source, section, key);
    if (located.success) return { ...located, section };
    failures.push(located.error);
  }
  return {
    success: false,
    error: failures.join(' '),
  };
}

function replaceYamlSectionSetting(source, sections, key, value) {
  const located = locateYamlSetting(source, sections, key);
  if (!located.success) throw new ManagedMinecraftServerError(located.error);
  located.lines[located.index] = `${located.prefix}${value}${located.suffix}`;
  return located.lines.join(located.newline);
}

function upsertYamlSectionSetting(source, section, key, value) {
  const located = locateYamlSectionSetting(source, section, key);
  if (located.success) {
    located.lines[located.index] = `${located.prefix}${value}${located.suffix}`;
    return located.lines.join(located.newline);
  }
  if (!located.error.includes(`Geyser ${section} section is missing.`)) {
    if (located.error.includes(`Geyser ${section}.${key} setting is missing.`)) {
      const lines = String(source || '').split(/\r?\n/);
      const newline = String(source || '').includes('\r\n') ? '\r\n' : '\n';
      const sectionIndex = lines.findIndex((line) => new RegExp(`^${escapeRegExp(section)}:\\s*(?:#.*)?$`).test(line));
      let insertAt = lines.length;
      for (let index = sectionIndex + 1; index < lines.length; index += 1) {
        if (/^[A-Za-z0-9_-]+:\s*(?:.*)?$/.test(lines[index])) {
          insertAt = index;
          break;
        }
      }
      lines.splice(insertAt, 0, `  ${key}: ${value}`);
      return lines.join(newline);
    }
    throw new ManagedMinecraftServerError(located.error);
  }
  const newline = String(source || '').includes('\r\n') ? '\r\n' : '\n';
  const suffix = source && !String(source).endsWith(newline) ? newline : '';
  return `${source || ''}${suffix}${newline}${section}:${newline}  ${key}: ${value}${newline}`;
}

function inspectGeyserConfiguration(source, {
  bindAddress = DEFAULT_BEDROCK_BIND_ADDRESS,
  bedrockPort = DEFAULT_BEDROCK_PORT,
} = {}) {
  const expected = [
    [['bedrock'], 'address', String(bindAddress)],
    [['bedrock'], 'port', String(bedrockPort)],
    [['java', 'remote'], 'auth-type', 'floodgate'],
  ];
  const values = {};
  const drift = [];
  for (const [sections, key, expectedValue] of expected) {
    const located = locateYamlSetting(source, sections, key);
    const field = key === 'address'
      ? 'bindAddress'
      : (key === 'port' ? 'bedrockPort' : 'authType');
    if (!located.success) {
      values[field] = null;
      drift.push(located.error);
      continue;
    }
    values[field] = key === 'port' && Number.isInteger(Number(located.value))
      ? Number(located.value)
      : located.value;
    if (String(located.value).toLowerCase() !== expectedValue.toLowerCase()) {
      drift.push(`Geyser ${located.section}.${key} is ${located.value || 'empty'}; expected ${expectedValue}.`);
    }
  }
  return {
    generated: true,
    inSync: drift.length === 0,
    ...values,
    drift,
  };
}

function readServerSettings(config = {}) {
  const integerSetting = (key) => {
    const value = Number(config[key]);
    return Number.isInteger(value) ? value : DEFAULT_SERVER_SETTINGS[key];
  };
  const booleanSetting = (key) => (
    typeof config[key] === 'boolean' ? config[key] : DEFAULT_SERVER_SETTINGS[key]
  );
  return {
    motd: typeof config.motd === 'string' ? config.motd : DEFAULT_SERVER_SETTINGS.motd,
    onlineMode: booleanSetting('onlineMode'),
    whiteList: booleanSetting('whiteList'),
    enforceWhitelist: booleanSetting('enforceWhitelist'),
    hideOnlinePlayers: booleanSetting('hideOnlinePlayers'),
    logIps: booleanSetting('logIps'),
    gameMode: ['survival', 'creative', 'adventure', 'spectator'].includes(config.gameMode)
      ? config.gameMode
      : DEFAULT_SERVER_SETTINGS.gameMode,
    difficulty: ['peaceful', 'easy', 'normal', 'hard'].includes(config.difficulty)
      ? config.difficulty
      : DEFAULT_SERVER_SETTINGS.difficulty,
    maxPlayers: integerSetting('maxPlayers'),
    pvp: booleanSetting('pvp'),
    forceGameMode: booleanSetting('forceGameMode'),
    hardcore: booleanSetting('hardcore'),
    allowFlight: booleanSetting('allowFlight'),
    enableCommandBlock: booleanSetting('enableCommandBlock'),
    spawnProtection: integerSetting('spawnProtection'),
    playerIdleTimeout: integerSetting('playerIdleTimeout'),
    opPermissionLevel: integerSetting('opPermissionLevel'),
    viewDistance: integerSetting('viewDistance'),
    simulationDistance: integerSetting('simulationDistance'),
    pauseWhenEmptySeconds: integerSetting('pauseWhenEmptySeconds'),
    entityBroadcastRangePercentage: integerSetting('entityBroadcastRangePercentage'),
  };
}

function redactCommandForLog(command) {
  return String(command).replace(
    /((?:password|passwd|token|secret|api[_ -]?key)\s*[=:]\s*)\S+/gi,
    '$1[redacted]',
  );
}

function containsControlCharacter(value) {
  return [...String(value)].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function mergeServerProperties(properties, updates) {
  const lines = String(properties || '').replace(/\r/g, '').split('\n');
  const remaining = new Map(Object.entries(updates).map(([key, value]) => [key, String(value)]));
  const output = lines
    .filter((line, index) => line || index < lines.length - 1)
    .map((line) => {
      const key = line.match(/^([^#!\s][^=]*)=/)?.[1];
      if (!key || !remaining.has(key)) return line;
      const value = remaining.get(key);
      remaining.delete(key);
      return `${key}=${value}`;
    });
  for (const [key, value] of remaining) output.push(`${key}=${value}`);
  return `${output.join('\n').trimEnd()}\n`;
}

export function parseJavaMajor(output) {
  const version = String(output || '').match(/version\s+"([^"]+)"/i)?.[1] || '';
  const parts = version.split(/[._+-]/);
  const major = parts[0] === '1' ? Number(parts[1]) : Number(parts[0]);
  return Number.isInteger(major) && major > 0 ? major : null;
}

export function parseManagedPlayerPositionLogs(logs, playerName) {
  const name = String(playerName || '').trim();
  const lines = Array.isArray(logs) ? logs.map(line => String(line || '')) : [];
  const escapedName = escapeRegExp(name);
  const prefix = new RegExp(`${escapedName} has the following entity data:\\s*`, 'i');
  let position = null;
  let dimension = null;
  let explicitlyMissing = false;
  for (const line of lines) {
    if (/\bNo entity was found\b/i.test(line)) {
      explicitlyMissing = true;
      continue;
    }
    const prefixed = line.match(prefix);
    if (!prefixed) continue;
    const payload = line.slice((prefixed.index || 0) + prefixed[0].length).trim();
    const vector = payload.match(/\[\s*(-?\d+(?:\.\d+)?)[dDfF]?,\s*(-?\d+(?:\.\d+)?)[dDfF]?,\s*(-?\d+(?:\.\d+)?)[dDfF]?\s*\]/);
    if (vector) {
      position = { x: Number(vector[1]), y: Number(vector[2]), z: Number(vector[3]) };
      continue;
    }
    const dimensionMatch = payload.match(/^"?([a-z0-9_.-]+:[a-z0-9_./-]+)"?$/i);
    if (dimensionMatch) dimension = dimensionMatch[1].toLowerCase();
  }
  if (explicitlyMissing) {
    return {
      success: true,
      found: false,
      code: 'player_not_found',
      player: name,
      position: null,
      dimension: null,
    };
  }
  const complete = Boolean(position && dimension);
  return {
    success: complete,
    found: complete ? true : null,
    code: complete
      ? 'player_position_found'
      : position || dimension
        ? 'player_position_incomplete'
        : 'player_position_unavailable',
    player: name,
    position,
    dimension,
  };
}

function findJavaExecutables(root, depth = 0, found = []) {
  if (!root || depth > 7 || found.length >= 32 || !existsSync(root)) return found;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (found.length >= 32) break;
    const fullPath = path.join(root, entry.name);
    if (entry.isFile() && /^java(?:\.exe)?$/i.test(entry.name) && path.basename(path.dirname(fullPath)).toLowerCase() === 'bin') {
      found.push(fullPath);
    } else if (entry.isDirectory()) {
      findJavaExecutables(fullPath, depth + 1, found);
    }
  }
  return found;
}

function defaultRuntimeCandidates() {
  const candidates = [{ path: 'java', source: 'PATH' }];
  const roots = [
    [process.env.APPDATA && path.join(process.env.APPDATA, '.minecraft', 'runtime'), 'Minecraft Launcher'],
    [
      process.env.LOCALAPPDATA && path.join(
        process.env.LOCALAPPDATA,
        'Packages',
        'Microsoft.4297127D64EC6_8wekyb3d8bbwe',
        'LocalCache',
        'Local',
        'runtime',
      ),
      'Minecraft Launcher',
    ],
    [process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Minecraft Launcher', 'runtime'), 'Minecraft Launcher'],
    [process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft'), 'Microsoft OpenJDK'],
    [process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Java'), 'Java installation'],
    [process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Eclipse Adoptium'), 'Java installation'],
    [process.env.JAVA_HOME, 'JAVA_HOME'],
  ];
  for (const [root, source] of roots) {
    for (const javaPath of findJavaExecutables(root)) candidates.push({ path: javaPath, source });
  }
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = candidate.path.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function runtimeCandidateMatchesPlatform(candidate, platform = process.platform) {
  const candidatePath = String(candidate?.path || '');
  return platform === 'win32' || !candidatePath.toLowerCase().endsWith('.exe');
}

function configuredJavaBindAddress(config = {}) {
  const requested = config.javaBindAddress || config.bedrockBindAddress || DEFAULT_BEDROCK_BIND_ADDRESS;
  return ALLOWED_LOCAL_BIND_ADDRESSES.has(requested)
    ? requested
    : DEFAULT_BEDROCK_BIND_ADDRESS;
}

function defaultInspectJava(candidate) {
  // `java -version` succeeds even when a bundled runtime has been partially
  // removed (for example, with no java.security or tzdb.dat). Paper fails
  // immediately in that state, so candidate detection must exercise the
  // security runtime before preferring the closest compatible major.
  const result = spawnSync(candidate.path, ['-XshowSettings:security', '-version'], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 5000,
  });
  if (result.error || result.status !== 0) {
    return {
      ...candidate,
      available: false,
      supported: false,
      version: null,
      major: null,
    };
  }
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const version = output.match(/version\s+"([^"]+)"/i)?.[1] || null;
  const major = parseJavaMajor(output);
  return {
    ...candidate,
    available: true,
    supported: Number.isInteger(major) && major >= DEFAULT_JAVA_MAJOR,
    version,
    major,
  };
}

let windowsExcludedTcpRanges;

function isWindowsTcpPortExcluded(port) {
  if (process.platform !== 'win32') return false;
  if (!windowsExcludedTcpRanges) {
    const result = spawnSync('netsh.exe', [
      'interface',
      'ipv4',
      'show',
      'excludedportrange',
      'protocol=tcp',
    ], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 5000,
    });
    windowsExcludedTcpRanges = String(result.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trim().match(/^(\d+)\s+(\d+)(?:\s+\*)?$/))
      .filter(Boolean)
      .map((match) => [Number(match[1]), Number(match[2])]);
  }
  return windowsExcludedTcpRanges.some(([start, end]) => port >= start && port <= end);
}

function checkPortByConnection(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (available) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(available);
    };
    socket.setTimeout(500, () => finish(false));
    socket.once('connect', () => finish(false));
    socket.once('error', (error) => {
      finish(error?.code === 'ECONNREFUSED' || error?.code === 'ECONNRESET');
    });
  });
}

function defaultCheckPortAvailable(host, port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', (error) => {
      if (error?.code === 'EADDRINUSE') resolve(false);
      else if (error?.code === 'EACCES') {
        // Some Windows app containers deny Node every IPv4 loopback bind.
        // Combine Windows' reserved range table with a real connection probe:
        // a reserved port is unavailable, a listener accepts, and a refused
        // non-reserved port is safe for Java to claim.
        if (process.platform === 'win32' && host === '127.0.0.1') {
          if (isWindowsTcpPortExcluded(port)) resolve(false);
          else checkPortByConnection(host, port).then(resolve);
        } else {
          resolve(false);
        }
      }
      else reject(error);
    });
    probe.once('listening', () => {
      probe.close((error) => (error ? reject(error) : resolve(true)));
    });
    probe.listen(port, host);
  });
}

export class ManagedMinecraftServer {
  constructor({
    rootDir = path.join(process.cwd(), 'server_data', 'managed-java'),
    runtimeCandidates = defaultRuntimeCandidates,
    inspectJava = defaultInspectJava,
    fetchImpl = globalThis.fetch,
    spawnImpl = spawn,
    fileOps = { mkdir, rename, unlink, writeFile },
    fetchTimeoutMs = 300_000,
    stopTimeoutMs = STOP_TIMEOUT_MS,
    killTimeoutMs = 5_000,
    supportedMinecraftVersions = mineflayer.testedVersions,
    latestSupportedVersion = mineflayer.latestSupportedVersion,
    checkPortAvailable = defaultCheckPortAvailable,
    networkInterfaces = listNetworkInterfaces,
    terminateProcessTree = terminateOwnedProcessTree,
    platform = process.platform,
  } = {}) {
    this.rootDir = rootDir;
    this.phase = 'stopped';
    this.runtimeCandidates = runtimeCandidates;
    this.inspectJava = inspectJava;
    this.fetchImpl = fetchImpl;
    this.spawnImpl = spawnImpl;
    this.fileOps = fileOps;
    this.fetchTimeoutMs = fetchTimeoutMs;
    this.stopTimeoutMs = stopTimeoutMs;
    this.killTimeoutMs = killTimeoutMs;
    this.supportedMinecraftVersions = new Set(supportedMinecraftVersions || []);
    this.latestSupportedVersion = latestSupportedVersion;
    this.checkPortAvailable = checkPortAvailable;
    this.networkInterfaces = networkInterfaces;
    this.terminateProcessTree = terminateProcessTree;
    this.platform = platform;
    this.javaCache = null;
    this.error = null;
    this.child = null;
    this.startedAt = null;
    this.logs = [];
    this.logSequence = 0;
    this.logRecords = [];
    this.outputBuffers = { stdout: '', stderr: '' };
    this.crossplayRuntimeReady = false;
    this.geyserRuntimeEndpoint = null;
    this.floodgateUsernamePrefix = null;
    this.bedrockJoinObservation = null;
    this.startGeneration = 0;
    this.writeSequence = 0;
    this.configWriteQueue = Promise.resolve();
    this.playerLocationQueue = Promise.resolve();
    this.readinessPromise = null;
  }

  readConfig() {
    try {
      return JSON.parse(readFileSync(path.join(this.rootDir, 'mindcraft-server.json'), 'utf8'));
    } catch {
      return {};
    }
  }

  readFloodgateUsernamePrefix() {
    try {
      const source = readFileSync(
        path.join(this.rootDir, 'plugins', 'floodgate', 'config.yml'),
        'utf8',
      );
      const prefix = readSimpleYamlScalar(source, 'username-prefix');
      return typeof prefix === 'string' ? prefix.slice(0, 16) : null;
    } catch {
      return null;
    }
  }

  bedrockJoinStatus({ floodgateConfigured = false } = {}) {
    const prefix = this.floodgateUsernamePrefix ?? this.readFloodgateUsernamePrefix();
    const active = this.phase === 'running';
    const observed = active ? this.bedrockJoinObservation : null;
    if (!floodgateConfigured) {
      return {
        verified: false,
        state: 'unavailable',
        method: 'floodgate-prefixed-player-join',
        detail: 'Floodgate authentication is not configured.',
        player: null,
        verifiedAt: null,
      };
    }
    if (!prefix) {
      return {
        verified: false,
        state: 'unavailable',
        method: 'floodgate-prefixed-player-join',
        detail: 'Floodgate has no distinct Bedrock username prefix, so Java and Bedrock joins cannot be distinguished.',
        player: null,
        verifiedAt: null,
      };
    }
    if (observed) {
      return {
        verified: true,
        state: 'verified',
        method: 'floodgate-prefixed-player-join',
        detail: 'A Floodgate-backed Bedrock player joined this Java server runtime.',
        player: observed.player,
        verifiedAt: observed.verifiedAt,
      };
    }
    return {
      verified: false,
      state: active ? 'not-observed' : 'inactive',
      method: 'floodgate-prefixed-player-join',
      detail: active
        ? 'No Floodgate-backed Bedrock player join has been observed during this server runtime.'
        : 'Start the Java server before verifying a Bedrock join.',
      player: null,
      verifiedAt: null,
    };
  }

  observeBedrockJoin(line) {
    if (this.bedrockJoinObservation) return;
    const prefix = this.floodgateUsernamePrefix;
    if (!prefix) return;
    const match = String(line || '').match(
      new RegExp(`(?:^|\\]:\\s+)(${escapeRegExp(prefix)}[^\\s]+) joined the game\\s*$`),
    );
    if (!match) return;
    const player = match[1]
      .slice(prefix.length)
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .slice(0, 32);
    this.bedrockJoinObservation = {
      player: player || 'Bedrock player',
      verifiedAt: new Date().toISOString(),
    };
  }

  async getStatus({ includeLogs = true } = {}) {
    const config = this.readConfig();
    const installed = existsSync(path.join(this.rootDir, 'server.jar'));
    const floodgateInstalled = existsSync(path.join(this.rootDir, 'plugins', 'floodgate-spigot.jar'));
    let geyserConfiguration = {
      generated: false,
      inSync: false,
      bindAddress: null,
      bedrockPort: null,
      authType: null,
      drift: ['Geyser config.yml has not been generated yet.'],
    };
    try {
      geyserConfiguration = inspectGeyserConfiguration(
        readFileSync(path.join(this.rootDir, 'plugins', 'Geyser-Spigot', 'config.yml'), 'utf8'),
        {
          bindAddress: config.bedrockBindAddress || DEFAULT_BEDROCK_BIND_ADDRESS,
          bedrockPort: Number(config.bedrockPort) || DEFAULT_BEDROCK_PORT,
        },
      );
    } catch {
      // Geyser creates its config on first start.
    }
    const floodgateConfigured = geyserConfiguration.authType === 'floodgate';
    const crossplayInstalled = config.crossplay === true
      && existsSync(path.join(this.rootDir, 'plugins', 'Geyser-Spigot.jar'))
      && floodgateInstalled
      && existsSync(path.join(this.rootDir, 'plugins', 'ViaVersion.jar'));
    const crossplayConfigured = crossplayInstalled && geyserConfiguration.inSync;
    const configuredBedrockPort = Number(config.bedrockPort) || DEFAULT_BEDROCK_PORT;
    const configuredBindAddress = config.bedrockBindAddress || DEFAULT_BEDROCK_BIND_ADDRESS;
    const javaBindAddress = configuredJavaBindAddress(config);
    const observedEndpoint = this.phase === 'running' && this.geyserRuntimeEndpoint
      ? { ...this.geyserRuntimeEndpoint }
      : null;
    const runtimeObserved = Boolean(observedEndpoint);
    const endpointMatchesConfiguration = Boolean(
      observedEndpoint
      && observedEndpoint.bindAddress === configuredBindAddress
      && observedEndpoint.bedrockPort === configuredBedrockPort,
    );
    const crossplayListening = this.phase === 'running' && endpointMatchesConfiguration;
    const crossplayJoinable = crossplayConfigured && crossplayListening;
    const repairNeeded = config.crossplay === true && (
      !crossplayInstalled
      || (geyserConfiguration.generated && !crossplayConfigured)
    );
    const crossplayState = config.crossplay !== true
      ? 'disabled'
      : repairNeeded
        ? 'repair-needed'
        : this.phase !== 'running'
          ? 'installed-stopped'
          : !runtimeObserved
            ? 'waiting-for-runtime'
            : !endpointMatchesConfiguration
              ? 'endpoint-mismatch'
              : 'running';
    const lanAddresses = crossplayJoinable && configuredBindAddress === '0.0.0.0'
      ? this.localIpv4Addresses()
      : [];
    const requiredJavaMajor = Number(config.javaMajor) || DEFAULT_JAVA_MAJOR;
    const java = await this.detectJava(requiredJavaMajor);
    const installedVersion = typeof config.version === 'string' ? config.version : null;
    return {
      phase: installed ? this.phase : 'uninstalled',
      installed,
      host: '127.0.0.1',
      port: Number(config.port) || DEFAULT_PORT,
      javaEndpoint: {
        host: '127.0.0.1',
        port: Number(config.port) || DEFAULT_PORT,
        bindAddress: javaBindAddress,
        access: javaBindAddress === '0.0.0.0' ? 'local-network' : 'this-computer',
        lanAddresses: javaBindAddress === '0.0.0.0' ? this.localIpv4Addresses() : [],
      },
      memoryMb: Number(config.memoryMb) || DEFAULT_MEMORY_MB,
      distribution: config.distribution || 'vanilla',
      version: installedVersion,
      recommendedVersion: this.latestSupportedVersion,
      compatible: !installed || Boolean(
        installedVersion && this.supportedMinecraftVersions.has(installedVersion),
      ),
      eulaAccepted: this.isEulaAccepted(),
      settings: readServerSettings(config),
      crossplay: {
        enabled: config.crossplay === true,
        installed: crossplayInstalled,
        configured: crossplayConfigured,
        state: crossplayState,
        repairNeeded,
        runtimeObserved,
        observedEndpoint,
        endpointMatchesConfiguration,
        listening: crossplayListening,
        joinable: crossplayJoinable,
        lanJoinable: crossplayJoinable && lanAddresses.length > 0,
        ready: crossplayJoinable,
        configuration: geyserConfiguration,
        bedrockPort: configuredBedrockPort,
        bindAddress: configuredBindAddress,
        access: configuredBindAddress === '0.0.0.0' ? 'local-network' : 'this-computer',
        runtimeReady: crossplayListening,
        lanAddresses,
        geyserVersion: config.geyserVersion || null,
        floodgateVersion: config.floodgateVersion || null,
        authentication: floodgateInstalled && floodgateConfigured
          ? 'floodgate'
          : (floodgateInstalled ? 'setup-required' : 'java-account'),
        joinVerification: this.bedrockJoinStatus({ floodgateConfigured }),
        viaVersion: config.viaVersion || null,
      },
      java,
      pid: this.child?.pid || null,
      startedAt: this.startedAt,
      error: this.error,
      logs: includeLogs ? [...this.logs] : [],
      logCount: this.logs.length,
    };
  }

  isEulaAccepted() {
    try {
      return /^eula=true$/m.test(readFileSync(path.join(this.rootDir, 'eula.txt'), 'utf8'));
    } catch {
      return false;
    }
  }

  localIpv4Addresses() {
    try {
      const addresses = Object.values(this.networkInterfaces?.() || {})
        .flat()
        .filter((entry) => (
          entry
          && !entry.internal
          && (entry.family === 'IPv4' || entry.family === 4)
          && net.isIPv4(entry.address)
        ))
        .map((entry) => entry.address);
      const score = (address) => {
        if (address.startsWith('192.168.')) return 0;
        if (address.startsWith('10.')) return 1;
        const second = Number(address.split('.')[1]);
        if (address.startsWith('172.') && second >= 16 && second <= 31) return 2;
        if (address.startsWith('169.254.')) return 4;
        return 3;
      };
      return [...new Set(addresses)]
        .sort((left, right) => score(left) - score(right) || left.localeCompare(right))
        .slice(0, 4);
    } catch {
      return [];
    }
  }

  async fetchResource(url, label, consume) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.fetchTimeoutMs);
    try {
      const response = await this.fetchImpl(url, { signal: controller.signal });
      if (!response?.ok) throw new ManagedMinecraftServerError(`Unable to download ${label}.`);
      return await consume(response);
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') {
        throw new ManagedMinecraftServerError(`${label} download timed out.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  fetchJson(url, label) {
    return this.fetchResource(url, label, (response) => response.json());
  }

  fetchText(url, label) {
    return this.fetchResource(url, label, (response) => response.text());
  }

  async resolveServerDownload(version) {
    const manifest = await this.fetchJson(VERSION_MANIFEST_URL, 'Minecraft version manifest');
    const versionId = !version || version === 'latest' ? this.latestSupportedVersion : version;
    if (!/^[0-9A-Za-z._-]{1,32}$/.test(String(versionId || ''))) {
      throw new ManagedMinecraftServerError('Minecraft server version is invalid.');
    }
    if (!this.supportedMinecraftVersions.has(versionId)) {
      throw new ManagedMinecraftServerError(
        `Minecraft ${versionId} is not supported by this Mindcraft bot engine. Use ${this.latestSupportedVersion}.`,
      );
    }
    const entry = manifest?.versions?.find((candidate) => candidate?.id === versionId);
    if (!entry?.url) {
      throw new ManagedMinecraftServerError(`Minecraft server version ${versionId} was not found.`);
    }
    const metadata = await this.fetchJson(entry.url, `Minecraft ${versionId} metadata`);
    const download = metadata?.downloads?.server;
    const javaMajor = Number(metadata?.javaVersion?.majorVersion) || DEFAULT_JAVA_MAJOR;
    if (!download?.url || !/^[a-f0-9]{40}$/i.test(String(download.sha1 || ''))) {
      throw new ManagedMinecraftServerError(`Minecraft ${versionId} does not publish a server download.`);
    }
    if (Number(download.size) > MAX_SERVER_JAR_BYTES) {
      throw new ManagedMinecraftServerError('Minecraft server download is unexpectedly large.');
    }
    return {
      version: versionId,
      url: download.url,
      sha1: download.sha1.toLowerCase(),
      javaMajor,
    };
  }

  async resolveCrossplayDownloads(version, vanillaMetadata) {
    const [paperBuild, geyserBuild, floodgateBuild, viaVersion] = await Promise.all([
      this.fetchJson(PAPER_LATEST_BUILD_URL(version), `Paper ${version} build`),
      this.fetchJson(GEYSER_LATEST_BUILD_URL, 'Geyser build'),
      this.fetchJson(FLOODGATE_LATEST_BUILD_URL, 'Floodgate build'),
      this.fetchText(VIAVERSION_LATEST_URL, 'ViaVersion release'),
    ]);
    const viaRelease = String(viaVersion || '').trim();
    if (!/^[0-9A-Za-z._-]{1,32}$/.test(viaRelease)) {
      throw new ManagedMinecraftServerError('ViaVersion release metadata is invalid.');
    }
    const viaBuild = await this.fetchJson(VIAVERSION_VERSION_URL(viaRelease), `ViaVersion ${viaRelease}`);
    const paper = paperBuild?.downloads?.['server:default'];
    const geyser = geyserBuild?.downloads?.spigot;
    const floodgate = floodgateBuild?.downloads?.spigot;
    const via = viaBuild?.downloads?.PAPER;
    const artifacts = {
      server: {
        url: paper?.url,
        sha256: paper?.checksums?.sha256,
        size: paper?.size,
        maxSize: MAX_SERVER_JAR_BYTES,
        label: 'Paper server',
      },
      geyser: {
        url: GEYSER_SPIGOT_DOWNLOAD_URL,
        sha256: geyser?.sha256,
        size: null,
        maxSize: MAX_PLUGIN_JAR_BYTES,
        label: 'Geyser plugin',
      },
      floodgate: {
        url: FLOODGATE_SPIGOT_DOWNLOAD_URL,
        sha256: floodgate?.sha256,
        size: null,
        maxSize: MAX_PLUGIN_JAR_BYTES,
        label: 'Floodgate plugin',
      },
      via: {
        url: via?.downloadUrl,
        sha256: via?.fileInfo?.sha256Hash,
        size: via?.fileInfo?.sizeBytes,
        maxSize: MAX_PLUGIN_JAR_BYTES,
        label: 'ViaVersion plugin',
      },
    };
    for (const artifact of Object.values(artifacts)) {
      if (!artifact.url || !/^[a-f0-9]{64}$/i.test(String(artifact.sha256 || ''))) {
        throw new ManagedMinecraftServerError(`${artifact.label} download metadata is invalid.`);
      }
      if (Number(artifact.size) > artifact.maxSize) {
        throw new ManagedMinecraftServerError(`${artifact.label} download is unexpectedly large.`);
      }
      artifact.sha256 = artifact.sha256.toLowerCase();
    }
    return {
      ...artifacts,
      version,
      javaMajor: vanillaMetadata.javaMajor,
      paperBuild: paperBuild.id,
      geyserVersion: geyserBuild.version,
      geyserBuild: geyserBuild.build,
      floodgateVersion: floodgateBuild.version,
      floodgateBuild: floodgateBuild.build,
      viaVersion: viaRelease,
    };
  }

  async downloadArtifact(artifact) {
    const raw = await this.fetchResource(artifact.url, artifact.label, (response) => {
      const declaredSize = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(declaredSize) && declaredSize > artifact.maxSize) {
        throw new ManagedMinecraftServerError(`${artifact.label} download is unexpectedly large.`);
      }
      return response.arrayBuffer();
    });
    const body = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    if (body.length === 0 || body.length > artifact.maxSize) {
      throw new ManagedMinecraftServerError(`${artifact.label} download has an invalid size.`);
    }
    if (Number.isFinite(Number(artifact.size)) && Number(artifact.size) > 0 && body.length !== Number(artifact.size)) {
      throw new ManagedMinecraftServerError(`${artifact.label} download has an invalid size.`);
    }
    const actual = createHash('sha256').update(body).digest('hex');
    if (actual !== artifact.sha256) {
      throw new ManagedMinecraftServerError(`${artifact.label} download failed its integrity check.`);
    }
    return body;
  }

  async configureGeyserFloodgate() {
    const configPath = path.join(this.rootDir, 'plugins', 'Geyser-Spigot', 'config.yml');
    if (!existsSync(configPath)) return false;
    const source = readFileSync(configPath, 'utf8');
    const config = this.readConfig();
    let updated = upsertYamlSectionSetting(
      source,
      'bedrock',
      'address',
      config.bedrockBindAddress || DEFAULT_BEDROCK_BIND_ADDRESS,
    );
    updated = upsertYamlSectionSetting(
      updated,
      'bedrock',
      'port',
      Number(config.bedrockPort) || DEFAULT_BEDROCK_PORT,
    );
    updated = replaceYamlSectionSetting(updated, ['java', 'remote'], 'auth-type', 'floodgate');
    if (updated === source) return true;
    const temporaryPath = `${configPath}.tmp-${process.pid}-${++this.writeSequence}`;
    await this.fileOps.writeFile(temporaryPath, updated, 'utf8');
    await this.fileOps.rename(temporaryPath, configPath);
    return true;
  }

  async repairCrossplay() {
    if (this.child || ['installing', 'starting', 'running', 'stopping'].includes(this.phase)) {
      throw new ManagedMinecraftServerError('Stop the managed server before repairing Bedrock support.');
    }
    const config = this.readConfig();
    if (!existsSync(path.join(this.rootDir, 'server.jar')) || config.crossplay !== true || !config.version) {
      throw new ManagedMinecraftServerError('Install the managed Bedrock cross-play server before repairing it.');
    }
    this.phase = 'installing';
    this.error = null;
    try {
      const download = await this.resolveCrossplayDownloads(config.version, {
        javaMajor: Number(config.javaMajor) || DEFAULT_JAVA_MAJOR,
      });
      const [geyserJar, floodgateJar, viaVersionJar] = await Promise.all([
        this.downloadArtifact(download.geyser),
        this.downloadArtifact(download.floodgate),
        this.downloadArtifact(download.via),
      ]);
      const pluginDir = path.join(this.rootDir, 'plugins');
      await this.fileOps.mkdir(pluginDir, { recursive: true });
      const suffix = `.tmp-${process.pid}-${++this.writeSequence}`;
      const plugins = [
        ['Geyser-Spigot.jar', geyserJar],
        ['floodgate-spigot.jar', floodgateJar],
        ['ViaVersion.jar', viaVersionJar],
      ];
      for (const [name, body] of plugins) {
        const target = path.join(pluginDir, name);
        const temporaryPath = `${target}${suffix}`;
        await this.fileOps.writeFile(temporaryPath, body);
        await this.fileOps.rename(temporaryPath, target);
      }
      await this.writeConfig({
        geyserVersion: download.geyserVersion,
        geyserBuild: download.geyserBuild,
        floodgateVersion: download.floodgateVersion,
        floodgateBuild: download.floodgateBuild,
        viaVersion: download.viaVersion,
        geyserSha256: download.geyser.sha256,
        floodgateSha256: download.floodgate.sha256,
        viaVersionSha256: download.via.sha256,
      });
      await this.configureGeyserFloodgate();
      this.phase = 'stopped';
      return this.getStatus();
    } catch (error) {
      this.phase = 'stopped';
      this.error = String(error.message || error);
      throw error;
    }
  }

  async install({
    acceptEula = false,
    version = 'latest',
    port = DEFAULT_PORT,
    memoryMb = DEFAULT_MEMORY_MB,
    crossplay = false,
    bedrockPort = DEFAULT_BEDROCK_PORT,
  } = {}) {
    if (acceptEula !== true) {
      throw new ManagedMinecraftServerError('You must accept the Minecraft EULA before installing the server.');
    }
    if (this.child || ['installing', 'starting', 'running', 'stopping'].includes(this.phase)) {
      throw new ManagedMinecraftServerError('Stop the managed server before installing it.');
    }
    const normalizedPort = Number(port);
    if (!Number.isInteger(normalizedPort) || normalizedPort < 1024 || normalizedPort > 65535) {
      throw new ManagedMinecraftServerError('Minecraft server port must be between 1024 and 65535.');
    }
    const normalizedMemory = Number(memoryMb);
    if (!Number.isInteger(normalizedMemory) || normalizedMemory < 512 || normalizedMemory > 32768) {
      throw new ManagedMinecraftServerError('Server memory must be between 512 and 32768 MB.');
    }
    const normalizedBedrockPort = Number(bedrockPort);
    if (!Number.isInteger(normalizedBedrockPort) || normalizedBedrockPort < 1024 || normalizedBedrockPort > 65535) {
      throw new ManagedMinecraftServerError('Bedrock port must be between 1024 and 65535.');
    }

    this.phase = 'installing';
    this.error = null;
    try {
      const vanillaDownload = await this.resolveServerDownload(version);
      const download = crossplay
        ? await this.resolveCrossplayDownloads(vanillaDownload.version, vanillaDownload)
        : vanillaDownload;
      const previousConfig = this.readConfig();
      const levelName = previousConfig.version
        && previousConfig.version !== download.version
        && existsSync(path.join(this.rootDir, 'world'))
        ? `world-${download.version}`
        : 'world';
      const java = await this.detectJava(download.javaMajor);
      if (!java.available) {
        throw new ManagedMinecraftServerError('Java was not found. Launch Minecraft once so its bundled runtime is available.');
      }
      if (!java.supported) {
        throw new ManagedMinecraftServerError(
          `Minecraft ${download.version} requires Java ${download.javaMajor} or newer, but Java ${java.major || java.version || 'unknown'} was selected.`,
        );
      }
      let jar;
      let geyserJar;
      let floodgateJar;
      let viaVersionJar;
      if (crossplay) {
        [jar, geyserJar, floodgateJar, viaVersionJar] = await Promise.all([
          this.downloadArtifact(download.server),
          this.downloadArtifact(download.geyser),
          this.downloadArtifact(download.floodgate),
          this.downloadArtifact(download.via),
        ]);
      } else {
        const raw = await this.fetchResource(download.url, 'Minecraft server', (response) => {
          const declaredSize = Number(response.headers?.get?.('content-length'));
          if (Number.isFinite(declaredSize) && declaredSize > MAX_SERVER_JAR_BYTES) {
            throw new ManagedMinecraftServerError('Minecraft server download is unexpectedly large.');
          }
          return response.arrayBuffer();
        });
        jar = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        if (jar.length === 0 || jar.length > MAX_SERVER_JAR_BYTES) {
          throw new ManagedMinecraftServerError('Minecraft server download has an invalid size.');
        }
        const actualSha1 = createHash('sha1').update(jar).digest('hex');
        if (actualSha1 !== download.sha1) {
          throw new ManagedMinecraftServerError('Minecraft server download failed its integrity check.');
        }
      }

      await this.fileOps.mkdir(this.rootDir, { recursive: true });
      const suffix = `.tmp-${process.pid}`;
      const files = {
        jar: path.join(this.rootDir, 'server.jar'),
        eula: path.join(this.rootDir, 'eula.txt'),
        properties: path.join(this.rootDir, 'server.properties'),
        config: path.join(this.rootDir, 'mindcraft-server.json'),
      };
      const staged = Object.fromEntries(
        Object.entries(files).map(([key, filePath]) => [key, `${filePath}${suffix}`]),
      );
      await this.fileOps.writeFile(staged.jar, jar);
      if (crossplay) {
        await this.fileOps.mkdir(path.join(this.rootDir, 'plugins'), { recursive: true });
        await this.fileOps.writeFile(path.join(this.rootDir, 'plugins', 'Geyser-Spigot.jar'), geyserJar);
        await this.fileOps.writeFile(path.join(this.rootDir, 'plugins', 'floodgate-spigot.jar'), floodgateJar);
        await this.fileOps.writeFile(path.join(this.rootDir, 'plugins', 'ViaVersion.jar'), viaVersionJar);
      }
      await this.fileOps.writeFile(staged.eula, 'eula=true\n', 'utf8');
      await this.fileOps.writeFile(staged.properties, [
        'server-ip=127.0.0.1',
        `server-port=${normalizedPort}`,
        `online-mode=${DEFAULT_SERVER_SETTINGS.onlineMode}`,
        'enforce-secure-profile=false',
        `motd=${DEFAULT_SERVER_SETTINGS.motd}`,
        `enable-command-block=${DEFAULT_SERVER_SETTINGS.enableCommandBlock}`,
        `allow-flight=${DEFAULT_SERVER_SETTINGS.allowFlight}`,
        `spawn-protection=${DEFAULT_SERVER_SETTINGS.spawnProtection}`,
        `white-list=${DEFAULT_SERVER_SETTINGS.whiteList}`,
        `enforce-whitelist=${DEFAULT_SERVER_SETTINGS.enforceWhitelist}`,
        `hide-online-players=${DEFAULT_SERVER_SETTINGS.hideOnlinePlayers}`,
        `log-ips=${DEFAULT_SERVER_SETTINGS.logIps}`,
        `force-gamemode=${DEFAULT_SERVER_SETTINGS.forceGameMode}`,
        `hardcore=${DEFAULT_SERVER_SETTINGS.hardcore}`,
        `op-permission-level=${DEFAULT_SERVER_SETTINGS.opPermissionLevel}`,
        `pause-when-empty-seconds=${DEFAULT_SERVER_SETTINGS.pauseWhenEmptySeconds}`,
        `entity-broadcast-range-percentage=${DEFAULT_SERVER_SETTINGS.entityBroadcastRangePercentage}`,
        `level-name=${levelName}`,
        `view-distance=${DEFAULT_SERVER_SETTINGS.viewDistance}`,
        `simulation-distance=${DEFAULT_SERVER_SETTINGS.simulationDistance}`,
        `gamemode=${DEFAULT_SERVER_SETTINGS.gameMode}`,
        `difficulty=${DEFAULT_SERVER_SETTINGS.difficulty}`,
        `max-players=${DEFAULT_SERVER_SETTINGS.maxPlayers}`,
        `pvp=${DEFAULT_SERVER_SETTINGS.pvp}`,
        '',
      ].join('\n'), 'utf8');
      await this.fileOps.writeFile(staged.config, `${JSON.stringify({
        version: download.version,
        port: normalizedPort,
        javaBindAddress: DEFAULT_BEDROCK_BIND_ADDRESS,
        memoryMb: normalizedMemory,
        desiredState: 'stopped',
        ...(crossplay
          ? {
            distribution: 'paper',
            crossplay: true,
            bedrockPort: normalizedBedrockPort,
            bedrockBindAddress: DEFAULT_BEDROCK_BIND_ADDRESS,
            paperBuild: download.paperBuild,
            geyserVersion: download.geyserVersion,
            geyserBuild: download.geyserBuild,
            floodgateVersion: download.floodgateVersion,
            floodgateBuild: download.floodgateBuild,
            viaVersion: download.viaVersion,
            serverSha256: download.server.sha256,
            geyserSha256: download.geyser.sha256,
            floodgateSha256: download.floodgate.sha256,
            viaVersionSha256: download.via.sha256,
          }
          : {
            serverSha1: download.sha1,
          }),
        ...DEFAULT_SERVER_SETTINGS,
        javaMajor: download.javaMajor,
      }, null, 2)}\n`, 'utf8');
      await this.fileOps.rename(staged.eula, files.eula);
      await this.fileOps.rename(staged.properties, files.properties);
      await this.fileOps.rename(staged.config, files.config);
      // server.jar is the installed-state marker, so commit it only after all
      // supporting files have been persisted successfully.
      await this.fileOps.rename(staged.jar, files.jar);
      this.phase = 'stopped';
      return this.getStatus();
    } catch (error) {
      this.phase = existsSync(path.join(this.rootDir, 'server.jar')) ? 'stopped' : 'uninstalled';
      this.error = String(error.message || error);
      throw error;
    }
  }

  writeConfig(update) {
    const write = async () => {
      await this.fileOps.mkdir(this.rootDir, { recursive: true });
      const config = { ...this.readConfig(), ...update };
      const configPath = path.join(this.rootDir, 'mindcraft-server.json');
      const temporaryPath = `${configPath}.tmp-${process.pid}-${++this.writeSequence}`;
      await this.fileOps.writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
      await this.fileOps.rename(temporaryPath, configPath);
      return config;
    };
    const pendingWrite = this.configWriteQueue.then(write, write);
    this.configWriteQueue = pendingWrite.catch(() => {});
    return pendingWrite;
  }

  validateConfiguration(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new ManagedMinecraftServerError('Server settings must be a JSON object.');
    }
    const current = this.readConfig();
    const currentSettings = readServerSettings(current);
    const next = {
      port: input.port === undefined ? Number(current.port) || DEFAULT_PORT : Number(input.port),
      memoryMb: input.memoryMb === undefined ? Number(current.memoryMb) || DEFAULT_MEMORY_MB : Number(input.memoryMb),
      motd: input.motd === undefined ? currentSettings.motd : input.motd,
      onlineMode: input.onlineMode === undefined ? currentSettings.onlineMode : input.onlineMode,
      whiteList: input.whiteList === undefined ? currentSettings.whiteList : input.whiteList,
      enforceWhitelist: input.enforceWhitelist === undefined
        ? currentSettings.enforceWhitelist
        : input.enforceWhitelist,
      hideOnlinePlayers: input.hideOnlinePlayers === undefined
        ? currentSettings.hideOnlinePlayers
        : input.hideOnlinePlayers,
      logIps: input.logIps === undefined ? currentSettings.logIps : input.logIps,
      gameMode: input.gameMode ?? currentSettings.gameMode,
      difficulty: input.difficulty ?? currentSettings.difficulty,
      maxPlayers: input.maxPlayers === undefined ? currentSettings.maxPlayers : Number(input.maxPlayers),
      pvp: input.pvp === undefined ? currentSettings.pvp : input.pvp,
      forceGameMode: input.forceGameMode === undefined ? currentSettings.forceGameMode : input.forceGameMode,
      hardcore: input.hardcore === undefined ? currentSettings.hardcore : input.hardcore,
      allowFlight: input.allowFlight === undefined ? currentSettings.allowFlight : input.allowFlight,
      enableCommandBlock: input.enableCommandBlock === undefined
        ? currentSettings.enableCommandBlock
        : input.enableCommandBlock,
      spawnProtection: input.spawnProtection === undefined
        ? currentSettings.spawnProtection
        : Number(input.spawnProtection),
      playerIdleTimeout: input.playerIdleTimeout === undefined
        ? currentSettings.playerIdleTimeout
        : Number(input.playerIdleTimeout),
      opPermissionLevel: input.opPermissionLevel === undefined
        ? currentSettings.opPermissionLevel
        : Number(input.opPermissionLevel),
      viewDistance: input.viewDistance === undefined ? currentSettings.viewDistance : Number(input.viewDistance),
      simulationDistance: input.simulationDistance === undefined
        ? currentSettings.simulationDistance
        : Number(input.simulationDistance),
      pauseWhenEmptySeconds: input.pauseWhenEmptySeconds === undefined
        ? currentSettings.pauseWhenEmptySeconds
        : Number(input.pauseWhenEmptySeconds),
      entityBroadcastRangePercentage: input.entityBroadcastRangePercentage === undefined
        ? currentSettings.entityBroadcastRangePercentage
        : Number(input.entityBroadcastRangePercentage),
      bedrockPort: input.bedrockPort === undefined
        ? Number(current.bedrockPort) || DEFAULT_BEDROCK_PORT
        : Number(input.bedrockPort),
      bedrockBindAddress: input.bedrockBindAddress
        ?? current.bedrockBindAddress
        ?? DEFAULT_BEDROCK_BIND_ADDRESS,
    };
    next.javaBindAddress = input.javaBindAddress
      ?? (input.bedrockBindAddress === undefined
        ? configuredJavaBindAddress(current)
        : next.bedrockBindAddress);
    if (!Number.isInteger(next.port) || next.port < 1024 || next.port > 65535) {
      throw new ManagedMinecraftServerError('Minecraft server port must be between 1024 and 65535.');
    }
    if (!Number.isInteger(next.memoryMb) || next.memoryMb < 512 || next.memoryMb > 32768) {
      throw new ManagedMinecraftServerError('Server memory must be between 512 and 32768 MB.');
    }
    if (
      typeof next.motd !== 'string'
      || next.motd.length > 100
      || containsControlCharacter(next.motd)
    ) {
      throw new ManagedMinecraftServerError('Server name must be plain text up to 100 characters on one line.');
    }
    if (!['survival', 'creative', 'adventure', 'spectator'].includes(next.gameMode)) {
      throw new ManagedMinecraftServerError('Game mode must be survival, creative, adventure, or spectator.');
    }
    if (!['peaceful', 'easy', 'normal', 'hard'].includes(next.difficulty)) {
      throw new ManagedMinecraftServerError('Difficulty must be peaceful, easy, normal, or hard.');
    }
    if (!Number.isInteger(next.maxPlayers) || next.maxPlayers < 1 || next.maxPlayers > 100) {
      throw new ManagedMinecraftServerError('Maximum players must be between 1 and 100.');
    }
    for (const key of BOOLEAN_SERVER_SETTINGS) {
      if (input[key] !== undefined && typeof input[key] !== 'boolean') {
        throw new ManagedMinecraftServerError(`${key} must be true or false.`);
      }
    }
    if (!Number.isInteger(next.spawnProtection) || next.spawnProtection < 0 || next.spawnProtection > 64) {
      throw new ManagedMinecraftServerError('Spawn protection must be between 0 and 64 blocks.');
    }
    if (!Number.isInteger(next.playerIdleTimeout) || next.playerIdleTimeout < 0 || next.playerIdleTimeout > 1440) {
      throw new ManagedMinecraftServerError('Player idle timeout must be between 0 and 1440 minutes.');
    }
    if (!Number.isInteger(next.opPermissionLevel) || next.opPermissionLevel < 1 || next.opPermissionLevel > 4) {
      throw new ManagedMinecraftServerError('Operator permission level must be between 1 and 4.');
    }
    for (const [label, value] of [['View distance', next.viewDistance], ['Simulation distance', next.simulationDistance]]) {
      if (!Number.isInteger(value) || value < 2 || value > 32) {
        throw new ManagedMinecraftServerError(`${label} must be between 2 and 32.`);
      }
    }
    if (
      !Number.isInteger(next.pauseWhenEmptySeconds)
      || (next.pauseWhenEmptySeconds !== -1
        && (next.pauseWhenEmptySeconds < 0 || next.pauseWhenEmptySeconds > 3600))
    ) {
      throw new ManagedMinecraftServerError('Empty-server pause must be disabled or between 0 and 3600 seconds.');
    }
    if (
      !Number.isInteger(next.entityBroadcastRangePercentage)
      || next.entityBroadcastRangePercentage < 10
      || next.entityBroadcastRangePercentage > 1000
    ) {
      throw new ManagedMinecraftServerError('Entity broadcast range must be between 10 and 1000 percent.');
    }
    if (!Number.isInteger(next.bedrockPort) || next.bedrockPort < 1024 || next.bedrockPort > 65535) {
      throw new ManagedMinecraftServerError('Bedrock port must be between 1024 and 65535.');
    }
    if (!ALLOWED_LOCAL_BIND_ADDRESSES.has(next.bedrockBindAddress)) {
      throw new ManagedMinecraftServerError('Bedrock access must be limited to this computer or the local network.');
    }
    if (!ALLOWED_LOCAL_BIND_ADDRESSES.has(next.javaBindAddress)) {
      throw new ManagedMinecraftServerError('Java access must be limited to this computer or the local network.');
    }
    return next;
  }

  async configure(input = {}) {
    if (this.child || ['installing', 'starting', 'running', 'stopping'].includes(this.phase)) {
      throw new ManagedMinecraftServerError('Stop the managed server before changing server settings.');
    }
    if (!existsSync(path.join(this.rootDir, 'server.jar'))) {
      throw new ManagedMinecraftServerError('Install the managed Minecraft server before changing settings.');
    }
    const next = this.validateConfiguration(input);
    await this.writeConfiguration({
      'server-ip': next.javaBindAddress,
      'server-port': next.port,
      motd: next.motd,
      'online-mode': next.onlineMode,
      'white-list': next.whiteList,
      'enforce-whitelist': next.enforceWhitelist,
      'hide-online-players': next.hideOnlinePlayers,
      'log-ips': next.logIps,
      gamemode: next.gameMode,
      difficulty: next.difficulty,
      'max-players': next.maxPlayers,
      pvp: next.pvp,
      'force-gamemode': next.forceGameMode,
      hardcore: next.hardcore,
      'allow-flight': next.allowFlight,
      'enable-command-block': next.enableCommandBlock,
      'spawn-protection': next.spawnProtection,
      'player-idle-timeout': next.playerIdleTimeout,
      'op-permission-level': next.opPermissionLevel,
      'view-distance': next.viewDistance,
      'simulation-distance': next.simulationDistance,
      'pause-when-empty-seconds': next.pauseWhenEmptySeconds,
      'entity-broadcast-range-percentage': next.entityBroadcastRangePercentage,
    }, next);
    return this.getStatus();
  }

  writeConfiguration(propertiesUpdates, configUpdate) {
    const write = async () => {
      await this.fileOps.mkdir(this.rootDir, { recursive: true });
      const propertiesPath = path.join(this.rootDir, 'server.properties');
      const configPath = path.join(this.rootDir, 'mindcraft-server.json');
      let originalProperties = '';
      try {
        originalProperties = readFileSync(propertiesPath, 'utf8');
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      const config = { ...this.readConfig(), ...configUpdate };
      const suffix = `.tmp-${process.pid}-${++this.writeSequence}`;
      const nextPropertiesPath = `${propertiesPath}${suffix}-next`;
      const rollbackPropertiesPath = `${propertiesPath}${suffix}-rollback`;
      const nextConfigPath = `${configPath}${suffix}-next`;
      const cleanup = async (...paths) => {
        if (!this.fileOps.unlink) return;
        await Promise.all(paths.map((filePath) => this.fileOps.unlink(filePath).catch(() => {})));
      };

      let propertiesCommitted = false;
      try {
        await this.fileOps.writeFile(
          nextPropertiesPath,
          mergeServerProperties(originalProperties, propertiesUpdates),
          'utf8',
        );
        await this.fileOps.writeFile(nextConfigPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
        await this.fileOps.writeFile(rollbackPropertiesPath, originalProperties, 'utf8');
        await this.fileOps.rename(nextPropertiesPath, propertiesPath);
        propertiesCommitted = true;
        await this.fileOps.rename(nextConfigPath, configPath);
      } catch (error) {
        if (propertiesCommitted) {
          try {
            await this.fileOps.rename(rollbackPropertiesPath, propertiesPath);
          } catch (rollbackError) {
            throw new ManagedMinecraftServerError(
              `Server settings write failed and server.properties rollback failed: ${rollbackError.message || rollbackError}`,
            );
          }
        }
        throw error;
      } finally {
        await cleanup(nextPropertiesPath, nextConfigPath, rollbackPropertiesPath);
      }
      return config;
    };
    const pendingWrite = this.configWriteQueue.then(write, write);
    this.configWriteQueue = pendingWrite.catch(() => {});
    return pendingWrite;
  }

  async writeProperties(updates) {
    const propertiesPath = path.join(this.rootDir, 'server.properties');
    let properties = '';
    try {
      properties = readFileSync(propertiesPath, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const temporaryPath = `${propertiesPath}.tmp-${process.pid}-${++this.writeSequence}`;
    await this.fileOps.writeFile(temporaryPath, mergeServerProperties(properties, updates), 'utf8');
    await this.fileOps.rename(temporaryPath, propertiesPath);
  }

  async selectAvailablePort(preferredPort, attempts = 200) {
    for (let offset = 0; offset < attempts; offset += 1) {
      const port = preferredPort + offset;
      if (port > 65535) break;
      if (await this.checkPortAvailable('127.0.0.1', port)) return port;
    }
    throw new ManagedMinecraftServerError(
      `Minecraft ports ${preferredPort}-${Math.min(65535, preferredPort + attempts - 1)} are already in use.`,
    );
  }

  async writeServerPort(port) {
    await this.writeProperties({ 'server-port': port });
  }

  appendLog(value, source = 'stdout') {
    const text = `${this.outputBuffers[source]}${String(value || '')}`.replace(/\r/g, '');
    const lines = text.split('\n');
    this.outputBuffers[source] = lines.pop() || '';
    for (const line of lines) {
      const clean = line.trimEnd();
      if (!clean) continue;
      this.pushLog(source === 'stderr' ? `[stderr] ${clean}` : clean);
      if (/\bDone \([^)]+\)!/i.test(clean)) {
        this.phase = 'running';
        this.error = null;
      }
      const geyserEndpoint = clean.match(/\[Geyser[^\]]*\].*Started Geyser on\s+(\[[^\]]+\]|[^\s:]+):(\d{1,5})/i);
      const geyserPortOnly = geyserEndpoint
        ? null
        : clean.match(/\[Geyser[^\]]*\].*Started Geyser on UDP port\s+(\d{1,5})\b/i);
      if (geyserEndpoint || geyserPortOnly) {
        const rawAddress = geyserEndpoint?.[1]
          || this.readConfig().bedrockBindAddress
          || DEFAULT_BEDROCK_BIND_ADDRESS;
        const bindAddress = rawAddress.startsWith('[') && rawAddress.endsWith(']')
          ? rawAddress.slice(1, -1)
          : rawAddress;
        const bedrockPort = Number(geyserEndpoint?.[2] || geyserPortOnly[1]);
        this.crossplayRuntimeReady = true;
        this.geyserRuntimeEndpoint = {
          bindAddress,
          bedrockPort,
        };
      }
      this.observeBedrockJoin(clean);
    }
  }

  pushLog(line) {
    const text = String(line);
    this.logs.push(text);
    if (this.logs.length > MAX_LOG_LINES) this.logs.splice(0, this.logs.length - MAX_LOG_LINES);
    const record = { sequence: ++this.logSequence, line: text };
    this.logRecords.push(record);
    if (this.logRecords.length > MAX_LOG_LINES) {
      this.logRecords.splice(0, this.logRecords.length - MAX_LOG_LINES);
    }
    return record;
  }

  async start() {
    if (this.child || this.phase === 'starting') return this.getStatus();
    if (['installing', 'stopping'].includes(this.phase)) {
      throw new ManagedMinecraftServerError(`Minecraft server is currently ${this.phase}.`);
    }
    if (!existsSync(path.join(this.rootDir, 'server.jar'))) {
      throw new ManagedMinecraftServerError('Install the managed Minecraft server before starting it.');
    }
    if (!this.isEulaAccepted()) {
      throw new ManagedMinecraftServerError('Accept the Minecraft EULA before starting the server.');
    }
    const configBeforeStart = this.readConfig();
    if (!configBeforeStart.version || !this.supportedMinecraftVersions.has(configBeforeStart.version)) {
      throw new ManagedMinecraftServerError(
        `Minecraft ${configBeforeStart.version || 'unknown'} is not supported by this Mindcraft bot engine. Replace it with ${this.latestSupportedVersion} before starting.`,
      );
    }
    if (configBeforeStart.crossplay === true && configBeforeStart.floodgateSha256) {
      await this.configureGeyserFloodgate();
    }
    this.floodgateUsernamePrefix = this.readFloodgateUsernamePrefix();
    this.bedrockJoinObservation = null;
    if (/^[a-f0-9]{40}$/i.test(String(configBeforeStart.serverSha1 || ''))) {
      const actualSha1 = createHash('sha1')
        .update(readFileSync(path.join(this.rootDir, 'server.jar')))
        .digest('hex');
      if (actualSha1 !== configBeforeStart.serverSha1.toLowerCase()) {
        throw new ManagedMinecraftServerError(
          'Minecraft server.jar failed its integrity check. Install the managed server again before starting it.',
        );
      }
    }
    for (const [relativePath, expectedHash, label] of [
      ['server.jar', configBeforeStart.serverSha256, 'Paper server.jar'],
      [path.join('plugins', 'Geyser-Spigot.jar'), configBeforeStart.geyserSha256, 'Geyser plugin'],
      [path.join('plugins', 'floodgate-spigot.jar'), configBeforeStart.floodgateSha256, 'Floodgate plugin'],
      [path.join('plugins', 'ViaVersion.jar'), configBeforeStart.viaVersionSha256, 'ViaVersion plugin'],
    ]) {
      if (!/^[a-f0-9]{64}$/i.test(String(expectedHash || ''))) continue;
      let actual;
      try {
        actual = createHash('sha256')
          .update(readFileSync(path.join(this.rootDir, relativePath)))
          .digest('hex');
      } catch {
        throw new ManagedMinecraftServerError(`${label} is missing. Install the managed cross-play server again.`);
      }
      if (actual !== expectedHash.toLowerCase()) {
        throw new ManagedMinecraftServerError(`${label} failed its integrity check. Install the managed cross-play server again.`);
      }
    }
    const requiredJavaMajor = Number(configBeforeStart.javaMajor) || DEFAULT_JAVA_MAJOR;
    const startGeneration = ++this.startGeneration;
    this.phase = 'starting';
    this.error = null;
    this.logs = [];
    this.logRecords = [];
    this.outputBuffers = { stdout: '', stderr: '' };
    this.crossplayRuntimeReady = false;
    this.geyserRuntimeEndpoint = null;
    this.startedAt = new Date().toISOString();
    try {
      const java = await this.detectJava(requiredJavaMajor);
      if (startGeneration !== this.startGeneration) return this.getStatus();
      if (!java.available) {
        throw new ManagedMinecraftServerError('Java was not found. Launch Minecraft once so its current bundled runtime is available.');
      }
      if (!java.supported) {
        throw new ManagedMinecraftServerError(
          `Java ${java.major || java.version || 'unknown'} is too old. This Minecraft server requires Java ${requiredJavaMajor} or newer.`,
        );
      }
      const preferredPort = Number(configBeforeStart.port) || DEFAULT_PORT;
      const selectedPort = await this.selectAvailablePort(preferredPort);
      if (startGeneration !== this.startGeneration) return this.getStatus();
      if (selectedPort !== preferredPort) await this.writeServerPort(selectedPort);
      const javaBindAddress = configuredJavaBindAddress(configBeforeStart);
      await this.writeProperties({ 'server-ip': javaBindAddress });
      const config = await this.writeConfig({
        desiredState: 'running',
        port: selectedPort,
        javaBindAddress,
      });
      if (startGeneration !== this.startGeneration) {
        await this.writeConfig({ desiredState: 'stopped' });
        this.startedAt = null;
        if (this.phase === 'starting') this.phase = 'stopped';
        return this.getStatus();
      }
      const memoryMb = Number(config.memoryMb) || DEFAULT_MEMORY_MB;
      const geyserArguments = config.crossplay === true
        ? [
          `-DgeyserUdpAddress=${config.bedrockBindAddress || DEFAULT_BEDROCK_BIND_ADDRESS}`,
          `-DgeyserUdpPort=${Number(config.bedrockPort) || DEFAULT_BEDROCK_PORT}`,
        ]
        : [];
      const child = this.spawnImpl(java.path, [
        '-Xms512M',
        `-Xmx${memoryMb}M`,
        ...geyserArguments,
        '-jar',
        path.join(this.rootDir, 'server.jar'),
        'nogui',
      ], {
        cwd: this.rootDir,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.child = child;
      child.stdout?.on('data', (chunk) => this.appendLog(chunk, 'stdout'));
      child.stderr?.on('data', (chunk) => this.appendLog(chunk, 'stderr'));
      child.once?.('error', (error) => {
        this.error = String(error.message || error);
        this.phase = 'crashed';
        this.crossplayRuntimeReady = false;
        this.geyserRuntimeEndpoint = null;
      });
      child.once?.('close', (code, signal) => {
        if (this.outputBuffers.stdout) this.appendLog('\n', 'stdout');
        if (this.outputBuffers.stderr) this.appendLog('\n', 'stderr');
        const expected = this.phase === 'stopping';
        this.child = null;
        this.startedAt = null;
        this.phase = expected || code === 0 ? 'stopped' : 'crashed';
        this.crossplayRuntimeReady = false;
        this.geyserRuntimeEndpoint = null;
        if (!expected && code !== 0) {
          const jvmFatal = this.logs.some((line) => /fatal error has been detected by the Java Runtime Environment/i.test(line));
          this.error = jvmFatal
            ? `The selected Java ${java.major || java.version || ''} runtime crashed. Mindcraft will prefer the closest compatible Java runtime on the next start.`
            : `Minecraft server exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}.`;
        }
      });
      return this.getStatus();
    } catch (error) {
      if (startGeneration !== this.startGeneration) {
        this.child = null;
        this.startedAt = null;
        if (this.phase === 'starting') this.phase = 'stopped';
        return this.getStatus();
      }
      this.child = null;
      this.startedAt = null;
      this.phase = 'crashed';
      this.crossplayRuntimeReady = false;
      this.geyserRuntimeEndpoint = null;
      this.error = String(error.message || error);
      throw error;
    }
  }

  validateConsoleCommand(command) {
    const value = typeof command === 'string' ? command.trim() : '';
    if (!value || value.length > MAX_CONSOLE_COMMAND_CHARS || /[\r\n\0]/.test(value)) {
      throw new ManagedMinecraftServerError(
        `Server command must be 1-${MAX_CONSOLE_COMMAND_CHARS} characters on one line.`,
      );
    }
    const commandName = value.replace(/^\/+/, '').split(/\s+/, 1)[0].toLowerCase();
    if (BLOCKED_CONSOLE_COMMANDS.has(commandName)) {
      throw new ManagedMinecraftServerError(
        'Use the dashboard Stop Server or Restart controls; direct lifecycle and reload commands are blocked so bot recovery stays coordinated.',
      );
    }
    return value;
  }

  assertCommandConsoleReady() {
    if (!this.child || this.phase !== 'running' || !this.child.stdin?.writable) {
      throw new ManagedMinecraftServerError('Minecraft server is not ready for commands.');
    }
  }

  sendCommand(command) {
    const value = this.validateConsoleCommand(command);
    this.assertCommandConsoleReady();
    this.child.stdin.write(`${value}\n`);
    this.pushLog(`[command] > ${redactCommandForLog(value)}`);
    return this.getStatus();
  }

  applyAgentRuntimeCompatibility(agentName) {
    const normalizedName = typeof agentName === 'string' ? agentName.trim() : '';
    if (!/^[A-Za-z0-9_]{1,16}$/.test(normalizedName)) {
      throw new ManagedMinecraftServerError('Agent name is not valid for a Minecraft command target.');
    }
    const config = this.readConfig();
    if (config.version !== '1.21.11') return this.getStatus();

    // Minecraft 1.21.11 has an authoritative hitbox edge at exact player
    // scale that leaves protocol bots suspended against ordinary one-block
    // steps. A microscopic server-owned epsilon restores vanilla traversal;
    // it is scoped to registered agents and reapplied idempotently on join.
    return this.sendCommand(
      `attribute ${normalizedName} minecraft:scale base set 0.9999999`,
    );
  }

  async sendCommands(commands, { settleMs = 0 } = {}) {
    if (!Array.isArray(commands) || commands.length < 1 || commands.length > MAX_CONSOLE_COMMAND_BATCH) {
      throw new ManagedMinecraftServerError(
        `Server command batch must contain 1-${MAX_CONSOLE_COMMAND_BATCH} commands.`,
      );
    }
    const boundedSettleMs = Number(settleMs);
    if (!Number.isInteger(boundedSettleMs) || boundedSettleMs < 0 || boundedSettleMs > MAX_CONSOLE_COMMAND_SETTLE_MS) {
      throw new ManagedMinecraftServerError(
        `Server command settleMs must be a whole number from 0-${MAX_CONSOLE_COMMAND_SETTLE_MS}.`,
      );
    }
    const validated = commands.map((command) => this.validateConsoleCommand(command));
    this.assertCommandConsoleReady();
    for (const value of validated) {
      this.child.stdin.write(`${value}\n`);
      this.pushLog(`[command] > ${redactCommandForLog(value)}`);
      if (boundedSettleMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, boundedSettleMs));
      }
    }
    return this.getStatus();
  }

  async waitForManagedPlayerCommand(markerSequence, playerName, expected) {
    const deadline = Date.now() + MANAGED_PLAYER_RESPONSE_TIMEOUT_MS;
    while (Date.now() <= deadline) {
      const records = this.logRecords.filter(record => record.sequence > markerSequence);
      const nextCommandIndex = records.findIndex(record => record.line.startsWith('[command] > '));
      const responseRecords = nextCommandIndex >= 0 ? records.slice(0, nextCommandIndex) : records;
      const lines = responseRecords.map(record => record.line);
      const parsed = parseManagedPlayerPositionLogs(lines, playerName);
      if (parsed.found === false) return { status: 'not_found', lines };
      if (expected === 'position' && parsed.position) return { status: 'observed', lines };
      if (expected === 'dimension' && parsed.dimension) return { status: 'observed', lines };
      if (nextCommandIndex >= 0) return { status: 'interleaved', lines };
      await new Promise(resolve => setTimeout(resolve, MANAGED_PLAYER_RESPONSE_POLL_MS));
    }
    return { status: 'timeout', lines: [] };
  }

  async locatePlayerPositionNow(name) {
    const observe = (command, expected) => {
      this.assertCommandConsoleReady();
      this.child.stdin.write(`${command}\n`);
      const marker = this.pushLog(`[command] > ${redactCommandForLog(command)}`);
      return this.waitForManagedPlayerCommand(marker.sequence, name, expected);
    };
    const position = await observe(`data get entity ${name} Pos`, 'position');
    if (position.status === 'not_found') {
      return {
        success: true,
        found: false,
        code: 'player_not_found',
        player: name,
        position: null,
        dimension: null,
      };
    }
    if (position.status !== 'observed') {
      return {
        success: false,
        found: null,
        code: position.status === 'timeout'
          ? 'player_position_timeout'
          : 'player_position_unavailable',
        player: name,
        position: null,
        dimension: null,
      };
    }
    const dimension = await observe(`data get entity ${name} Dimension`, 'dimension');
    if (dimension.status === 'not_found') {
      return {
        success: true,
        found: false,
        code: 'player_not_found',
        player: name,
        position: null,
        dimension: null,
      };
    }
    if (dimension.status !== 'observed') {
      return {
        success: false,
        found: null,
        code: dimension.status === 'timeout'
          ? 'player_position_incomplete'
          : 'player_position_unavailable',
        player: name,
        position: null,
        dimension: null,
      };
    }
    return parseManagedPlayerPositionLogs([...position.lines, ...dimension.lines], name);
  }

  async locatePlayerPosition(playerName) {
    const name = String(playerName || '').trim();
    if (!MANAGED_PLAYER_NAME.test(name)) {
      throw new ManagedMinecraftServerError('Player name is not valid for an authoritative position lookup.');
    }
    const operation = this.playerLocationQueue.then(
      () => this.locatePlayerPositionNow(name),
      () => this.locatePlayerPositionNow(name),
    );
    this.playerLocationQueue = operation.catch(() => {});
    const observation = await operation;
    return {
      source: 'managed_paper',
      observedAt: Date.now(),
      ...observation,
    };
  }

  waitForChildClose(child, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (closed) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.off?.('close', onClose);
        resolve(closed);
      };
      const onClose = () => finish(true);
      const timeout = setTimeout(() => finish(false), timeoutMs);
      child.once?.('close', onClose);
    });
  }

  async stop({ preserveDesiredState = false } = {}) {
    this.startGeneration += 1;
    if (!preserveDesiredState) await this.writeConfig({ desiredState: 'stopped' });
    if (!this.child) {
      this.phase = existsSync(path.join(this.rootDir, 'server.jar')) ? 'stopped' : 'uninstalled';
      this.crossplayRuntimeReady = false;
      this.geyserRuntimeEndpoint = null;
      return this.getStatus();
    }
    const child = this.child;
    this.phase = 'stopping';
    if (child.stdin?.writable) child.stdin.write('stop\n');
    const closedGracefully = await this.waitForChildClose(child, this.stopTimeoutMs);
    if (!closedGracefully && this.child === child) {
      const termination = await this.terminateProcessTree(child, { timeoutMs: this.killTimeoutMs });
      if (!termination.success && this.child === child) {
        this.startedAt = null;
        this.phase = 'crashed';
        this.error = termination.error || 'Minecraft server process tree did not exit after forced termination.';
        throw new ManagedMinecraftServerError(this.error);
      }
    }
    if (this.child === child) {
      this.child = null;
      this.startedAt = null;
      this.phase = 'stopped';
      this.crossplayRuntimeReady = false;
      this.geyserRuntimeEndpoint = null;
    }
    return this.getStatus();
  }

  async restart() {
    await this.stop({ preserveDesiredState: true });
    return this.start();
  }

  waitForReady(timeoutMs = 90_000) {
    if (this.readinessPromise) return this.readinessPromise;
    const pending = this._waitForReady(timeoutMs).finally(() => {
      if (this.readinessPromise === pending) this.readinessPromise = null;
    });
    this.readinessPromise = pending;
    return pending;
  }

  async _waitForReady(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let bindRetriesRemaining = 5;
    let crossplayBootstrapRestarted = false;
    while (Date.now() < deadline) {
      if (this.phase === 'running') {
        const config = this.readConfig();
        if (config.crossplay !== true) return this.getStatus();
        if (!this.crossplayRuntimeReady) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }

        const status = await this.getStatus();
        if (status.crossplay.joinable) return status;
        if (status.crossplay.state === 'endpoint-mismatch') {
          const observed = status.crossplay.observedEndpoint;
          this.error = `Geyser started on ${observed.bindAddress}:${observed.bedrockPort}, but ${status.crossplay.bindAddress}:${status.crossplay.bedrockPort} is configured.`;
          throw new ManagedMinecraftServerError(this.error);
        }
        if (!status.crossplay.configuration?.generated) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }
        if (crossplayBootstrapRestarted) {
          const detail = status.crossplay.configuration?.drift?.join(' ')
            || 'generated configuration is still out of sync';
          this.error = `Geyser did not retain its managed configuration after restart: ${detail}`;
          throw new ManagedMinecraftServerError(this.error);
        }

        const configured = await this.configureGeyserFloodgate();
        if (!configured) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }
        const converged = await this.getStatus({ includeLogs: false });
        if (!converged.crossplay.configured) {
          const detail = converged.crossplay.configuration?.drift?.join(' ')
            || 'generated configuration could not be verified';
          this.error = `Geyser configuration convergence failed: ${detail}`;
          throw new ManagedMinecraftServerError(this.error);
        }
        crossplayBootstrapRestarted = true;
        await this.restart();
        continue;
      }
      if (this.phase === 'crashed') {
        throw new ManagedMinecraftServerError(this.error || 'Minecraft server stopped before becoming ready.');
      }
      if (!this.child && ['stopped', 'uninstalled'].includes(this.phase)) {
        const bindFailed = this.logs.some((line) => /FAILED TO BIND TO PORT|Failed to bind to port/i.test(line));
        if (bindFailed && bindRetriesRemaining > 0 && this.phase === 'stopped') {
          bindRetriesRemaining -= 1;
          const failedPort = Number(this.readConfig().port) || DEFAULT_PORT;
          const nextPort = await this.selectAvailablePort(failedPort + 1);
          await this.writeServerPort(nextPort);
          await this.writeConfig({ desiredState: 'running', port: nextPort });
          this.error = null;
          await this.start();
          continue;
        }
        throw new ManagedMinecraftServerError('Minecraft server startup was canceled before it became ready.');
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const error = new ManagedMinecraftServerError(
      `Minecraft server did not become ready within ${Math.ceil(timeoutMs / 1000)} seconds.`,
    );
    this.error = error.message;
    await this.stop();
    throw error;
  }

  async startIfDesired({ timeoutMs = 90_000 } = {}) {
    if (this.readConfig().desiredState !== 'running') return this.getStatus();
    await this.start();
    return this.waitForReady(timeoutMs);
  }

  async detectJava(requiredMajor = DEFAULT_JAVA_MAJOR) {
    let inspected = this.javaCache && Date.now() - this.javaCache.at < JAVA_CACHE_MS
      ? this.javaCache.candidates
      : null;
    if (!inspected) {
      inspected = [];
      for (const candidate of (await this.runtimeCandidates())
        .filter((value) => runtimeCandidateMatchesPlatform(value, this.platform))) {
        inspected.push(await this.inspectJava(candidate));
      }
      this.javaCache = { at: Date.now(), candidates: inspected };
    }
    const usable = inspected
      .filter((candidate) => candidate.available)
      .sort((a, b) => {
        const aSupported = Number(a.major) >= requiredMajor;
        const bSupported = Number(b.major) >= requiredMajor;
        if (aSupported !== bSupported) return bSupported - aSupported;
        if (aSupported) return Number(a.major) - Number(b.major);
        return Number(b.major) - Number(a.major);
      });
    const value = usable[0] || {
      available: false,
      supported: false,
      path: null,
      version: null,
      major: null,
      source: null,
    };
    return {
      ...value,
      supported: Number(value.major) >= requiredMajor,
      requiredMajor,
    };
  }
}

let managedServer;

export function getManagedMinecraftServer() {
  if (!managedServer) managedServer = new ManagedMinecraftServer();
  return managedServer;
}
