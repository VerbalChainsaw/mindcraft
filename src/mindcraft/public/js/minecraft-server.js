import { api, requestControlCenterRestart } from './api.js';
import { actionTargetLabel, attentionStatusLabel, button, clear, dialogueStatusLabel, input, node, operatorControlLabel, runtimeRecoveryMessage, select, telemetryFreshness } from './utils.js';

const EULA_URL = 'https://aka.ms/MinecraftEULA';
const MAX_COMMAND_HISTORY = 20;
const LONG_RUNNING_ACTIONS = new Set([
  '/minecraft-server/install',
  '/minecraft-server/configure',
  '/minecraft-server/apply-settings',
  '/minecraft-server/start',
  '/minecraft-server/stop',
  '/minecraft-server/restart',
  '/minecraft-server/repair-crossplay',
  '/system/stop',
]);
const QUICK_COMMANDS = Object.freeze([
  { label: 'Players', detail: 'See who is online', command: 'list' },
  { label: 'Save world', detail: 'Flush changes to disk', command: 'save-all flush' },
  { label: 'Daytime', detail: 'Set time to day', command: 'time set day' },
  { label: 'Clear weather', detail: 'Stop rain and storms', command: 'weather clear' },
]);

function statusLabel(phase) {
  return ({
    uninstalled: 'Not installed',
    installing: 'Installing…',
    stopped: 'Stopped',
    starting: 'Starting…',
    running: 'Running',
    stopping: 'Stopping…',
    crashed: 'Needs attention',
  })[phase] || 'Unknown';
}

export function bedrockConnectionSemantics(status = {}, client = {}) {
  const crossplay = status.crossplay || {};
  const requiresLoopbackExemption = crossplay.access !== 'local-network';
  const transportJoinable = requiresLoopbackExemption
    ? crossplay.joinable === true
    : crossplay.lanJoinable === true;
  const translatorLabel = crossplay.listening === true
    ? 'Running'
    : crossplay.state === 'repair-needed'
      ? 'Needs repair'
      : crossplay.state === 'endpoint-mismatch'
        ? 'Endpoint mismatch'
        : crossplay.installed === true
          ? 'Installed · stopped'
          : 'Not installed';
  return {
    translatorLabel,
    translatorReady: crossplay.listening === true,
    configuredToTest: Boolean(
      transportJoinable
      && crossplay.authentication === 'floodgate'
      && (!requiresLoopbackExemption || client.loopbackEnabled === true)
    ),
    requiresLoopbackExemption,
  };
}

function field(label, control, hint = '') {
  const wrap = node('div', 'stack');
  const title = node('label', '', label);
  title.htmlFor = control.id;
  wrap.append(title, control);
  if (hint) wrap.append(node('small', 'muted', hint));
  return wrap;
}

function toggleField(label, control, hint = '') {
  const wrap = node('label', 'toggle-field');
  const copy = node('span', 'toggle-copy');
  copy.append(node('strong', '', label));
  if (hint) copy.append(node('small', 'muted', hint));
  wrap.append(control, copy);
  return wrap;
}

function groupHeading(title, detail) {
  const heading = node('div', 'settings-group-heading');
  heading.append(node('h3', '', title));
  if (detail) heading.append(node('p', 'muted small', detail));
  return heading;
}

export class MinecraftServerWorkspace {
  constructor(root, activity, announce, onStatus, onTargetSelected, onShutdown, getAgentStates = () => ({})) {
    this.root = root;
    this.activity = activity;
    this.announce = announce;
    this.onStatus = onStatus;
    this.onTargetSelected = onTargetSelected;
    this.onShutdown = onShutdown;
    this.getAgentStates = getAgentStates;
    this.status = null;
    this.bedrockClient = null;
    this.busy = '';
    this.result = '';
    this.commandDraft = '';
    this.operation = 0;
    this.statusEpoch = 0;
    this.loadSequence = 0;
    this.renderKey = '';
    this.consoleEl = null;
    this.logCountEl = null;
    this.logFilter = 'all';
    this.logQuery = '';
    this.lastLogs = [];
    this.commandHistory = [];
    this.commandHistoryIndex = -1;
    this.presencePanelEl = null;
  }

  mount() {
    this.render();
  }

  updateAgentStates() {
    if (!this.presencePanelEl?.isConnected) return;
    this.renderPresenceContents();
  }

  renderPresenceContents() {
    if (!this.presencePanelEl) return;
    clear(this.presencePanelEl);
    const states = this.getAgentStates?.() || {};
    const entries = Object.entries(states).filter(([, state]) => state && typeof state === 'object');
    this.presencePanelEl.append(
      groupHeading(
        'Live bot presence',
        'Verified bot telemetry from the Java world. This is not a guessed server player count.',
      ),
    );
    if (!entries.length) {
      this.presencePanelEl.append(node('div', 'empty-state compact', 'No live bot telemetry yet. Start a bot to see its current location and work here.'));
      return;
    }
    const grid = node('div', 'summary-grid');
    entries.sort(([left], [right]) => left.localeCompare(right)).forEach(([agentName, state]) => {
      const gameplay = state.gameplay || {};
      const action = state.action || {};
      const attention = state.attention || {};
      const dialogue = state.dialogue || {};
      const nearby = state.nearby || {};
      const position = gameplay.position;
      const location = position && [position.x, position.y, position.z].every(Number.isFinite)
        ? `x ${position.x}, y ${position.y}, z ${position.z}`
        : 'Position unavailable';
      const freshness = telemetryFreshness(state);
      const card = node('div', 'summary-card');
      card.append(
        node('strong', '', agentName),
        node('div', 'summary-detail', state.error ? `Telemetry unavailable: ${state.error}` : `${action.current || 'Action unknown'} · ${operatorControlLabel(action)} · ${location}`),
        node('div', 'summary-detail', `Health ${Number.isFinite(gameplay.health) ? `${gameplay.health}/${gameplay.healthMax || 20}` : 'unknown'} · ${freshness.label}`),
      );
      if (freshness.stale && freshness.error) {
        card.append(node('div', 'warning-copy small', freshness.error));
      }
      const players = Array.isArray(nearby.humanPlayers) ? nearby.humanPlayers : [];
      if (players.length) card.append(node('div', 'summary-detail', `Nearby players: ${players.slice(0, 4).join(', ')}`));
      if (attention.state === 'working' || attention.state === 'paused' || attention.state === 'held' || attention.goalActive) {
        card.append(node('div', 'summary-detail', `Attention: ${attentionStatusLabel(attention)}`));
      }
      if (dialogue.muted || dialogue.inConversation) card.append(node('div', 'summary-detail', `Dialogue: ${dialogueStatusLabel(dialogue)}`));
      const recoveryMessage = runtimeRecoveryMessage(action);
      if (recoveryMessage) card.append(node('div', 'warning-copy small', recoveryMessage));
      const outcome = action.lastResult;
      if (outcome?.phase && outcome.phase !== 'succeeded') {
        card.append(node('div', 'warning-copy small', `Last verified result: ${String(outcome.phase).replace(/_/g, ' ')} · ${String(outcome.code || 'unknown').replace(/_/g, ' ')}`));
      }
      if (outcome?.target) card.append(node('div', 'summary-detail', `Verified target: ${actionTargetLabel(outcome)}`));
      grid.append(card);
    });
    this.presencePanelEl.append(grid);
  }

  serverPresencePanel() {
    const panel = node('section', 'panel');
    this.presencePanelEl = panel;
    this.renderPresenceContents();
    return panel;
  }

  async load({ quiet = false } = {}) {
    const request = ++this.loadSequence;
    const statusEpoch = this.statusEpoch;
    const visible = this.root.isConnected;
    const [response, bedrockResponse] = await Promise.all([
      api(`/minecraft-server?logs=${visible ? '1' : '0'}`),
      api('/bedrock-client'),
    ]);
    if (request !== this.loadSequence || statusEpoch !== this.statusEpoch) return this.status;
    if (bedrockResponse.success) this.bedrockClient = bedrockResponse.client;
    if (response.success) {
      this.status = response.server;
      this.onStatus?.(this.status);
      if (visible) {
        const nextKey = this.statusRenderKey(this.status);
        if (!quiet || nextKey !== this.renderKey) this.render();
        else this.renderLogs(this.status.logs);
      }
    } else if (!quiet) {
      this.result = response.error || 'Managed server status is unavailable.';
      this.render();
    }
    return this.status;
  }

  statusRenderKey(status) {
    if (!status) return '';
    const { logs: _logs, logCount: _logCount, ...core } = status;
    return JSON.stringify({ server: core, bedrockClient: this.bedrockClient });
  }

  async run(label, path, body = {}, {
    interrupt = false,
    successMessage = '',
    onSuccess = null,
    timeoutMs = null,
  } = {}) {
    if (this.busy && !interrupt) return null;
    const operation = ++this.operation;
    this.statusEpoch += 1;
    this.loadSequence += 1;
    this.busy = label;
    this.result = '';
    this.render();
    const requestTimeoutMs = timeoutMs ?? (LONG_RUNNING_ACTIONS.has(path) ? 120_000 : 15_000);
    const response = await api(path, body, { timeoutMs: requestTimeoutMs });
    if (operation !== this.operation) return response.success ? response.server : null;
    this.statusEpoch += 1;
    this.loadSequence += 1;
    this.busy = '';
    if (!response.success) {
      if (response.server) {
        this.status = response.server;
        this.onStatus?.(this.status);
      }
      this.result = response.error || `${label} failed.`;
      this.activity?.add('MINECRAFT', this.result, 'err');
      this.announce?.(this.result);
      this.render();
      return null;
    }
    this.status = response.server;
    this.result = successMessage || `${label} complete.`;
    if (onSuccess) onSuccess(response.server);
    this.activity?.add('MINECRAFT', this.result, 'ok');
    this.announce?.(this.result);
    this.onStatus?.(this.status);
    if (['/minecraft-server/install', '/minecraft-server/configure', '/minecraft-server/apply-settings', '/minecraft-server/start', '/minecraft-server/restart', '/minecraft-server/repair-crossplay'].includes(path)) {
      this.onTargetSelected?.(this.status);
    }
    this.render();
    return response.server;
  }

  async setBedrockLoopback(enabled) {
    if (this.busy) return;
    if (enabled && !window.confirm('Enable same-PC Bedrock access for Minecraft for Windows? Windows will ask for administrator approval.')) return;
    if (!enabled && !window.confirm('Remove same-PC Bedrock access for Minecraft for Windows?')) return;
    const operation = ++this.operation;
    this.busy = enabled ? 'Enabling same-PC Bedrock' : 'Removing same-PC Bedrock access';
    this.result = '';
    this.render();
    const response = await api('/bedrock-client/loopback', { enabled }, { timeoutMs: 120_000 });
    if (operation !== this.operation) return;
    this.busy = '';
    if (response.client) this.bedrockClient = response.client;
    if (!response.success) {
      this.result = response.error || 'Windows Bedrock access could not be changed.';
      this.activity?.add('BEDROCK', this.result, 'err');
      this.announce?.(this.result);
    } else {
      this.result = enabled ? 'Same-PC Bedrock access enabled.' : 'Same-PC Bedrock access removed.';
      this.activity?.add('BEDROCK', this.result, 'ok');
      this.announce?.(this.result);
    }
    this.render();
  }

  repairBedrockSignIn() {
    if (!window.confirm('Install verified Floodgate support and restart the server? Active bots will stop and resume automatically.')) return null;
    return this.run(
      'Bedrock sign-in repair',
      '/minecraft-server/repair-crossplay',
      {},
      {
        timeoutMs: 120_000,
        successMessage: 'Bedrock sign-in support installed and the stack recovered.',
      },
    );
  }

  async installAndStart(eula, memory, port, bedrockPort) {
    if (!eula.checked) {
      this.result = 'Accept the Minecraft EULA to install the local server.';
      this.announce?.(this.result);
      this.render();
      return;
    }
    const installed = await this.run('Cross-play server installation', '/minecraft-server/install', {
      acceptEula: true,
      version: 'latest',
      memoryMb: Number(memory.value),
      port: Number(port.value),
      bedrockPort: Number(bedrockPort.value),
      crossplay: true,
    }, { timeoutMs: 120_000 });
    if (installed) await this.run('Server start', '/minecraft-server/start', {}, { timeoutMs: 60_000 });
  }

  async replaceAndStart(status) {
    const installed = await this.run('Compatible cross-play server installation', '/minecraft-server/install', {
      acceptEula: true,
      version: 'latest',
      memoryMb: status.memoryMb,
      port: status.port,
      bedrockPort: status.crossplay?.bedrockPort || 19132,
      crossplay: true,
    }, { timeoutMs: 120_000 });
    if (installed) await this.run('Server start', '/minecraft-server/start', {}, { timeoutMs: 60_000 });
  }

  async saveSettings(controls) {
    await this.run('Server settings', '/minecraft-server/apply-settings', {
      port: Number(controls.port.value),
      memoryMb: Number(controls.memory.value),
      motd: controls.motd.value,
      onlineMode: controls.onlineMode.checked,
      whiteList: controls.whiteList.checked,
      enforceWhitelist: controls.enforceWhitelist.checked,
      hideOnlinePlayers: controls.hideOnlinePlayers.checked,
      logIps: controls.logIps.checked,
      gameMode: controls.gameMode.value,
      difficulty: controls.difficulty.value,
      maxPlayers: Number(controls.maxPlayers.value),
      pvp: controls.pvp.checked,
      forceGameMode: controls.forceGameMode.checked,
      hardcore: controls.hardcore.checked,
      allowFlight: controls.allowFlight.checked,
      enableCommandBlock: controls.enableCommandBlock.checked,
      spawnProtection: Number(controls.spawnProtection.value),
      playerIdleTimeout: Number(controls.playerIdleTimeout.value),
      opPermissionLevel: Number(controls.opPermissionLevel.value),
      viewDistance: Number(controls.viewDistance.value),
      simulationDistance: Number(controls.simulationDistance.value),
      pauseWhenEmptySeconds: Number(controls.pauseWhenEmptySeconds.value),
      entityBroadcastRangePercentage: Number(controls.entityBroadcastRangePercentage.value),
      bedrockPort: Number(controls.bedrockPort.value),
      bedrockBindAddress: controls.bedrockAccess.value,
    });
  }

  async sendCommand(commandInputOrValue) {
    const command = typeof commandInputOrValue === 'string'
      ? commandInputOrValue.trim()
      : commandInputOrValue.value.trim();
    if (!command) return;
    this.commandDraft = command;
    await this.run('Command', '/minecraft-server/command', { command }, {
      successMessage: `Command sent: ${command}`,
      onSuccess: () => {
        this.commandHistory = [
          command,
          ...this.commandHistory.filter((item) => item !== command),
        ].slice(0, MAX_COMMAND_HISTORY);
        this.commandHistoryIndex = -1;
        this.commandDraft = '';
      },
    });
  }

  handleCommandHistory(event, commandInput) {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key) || this.commandHistory.length === 0) return;
    event.preventDefault();
    if (event.key === 'ArrowUp') {
      this.commandHistoryIndex = Math.min(
        this.commandHistoryIndex + 1,
        this.commandHistory.length - 1,
      );
      this.commandDraft = this.commandHistory[this.commandHistoryIndex];
    } else if (this.commandHistoryIndex <= 0) {
      this.commandHistoryIndex = -1;
      this.commandDraft = '';
    } else {
      this.commandHistoryIndex -= 1;
      this.commandDraft = this.commandHistory[this.commandHistoryIndex];
    }
    commandInput.value = this.commandDraft;
  }

  filteredLogs(rawLogs) {
    const query = this.logQuery.trim().toLowerCase();
    return (Array.isArray(rawLogs) ? rawLogs : []).filter((line) => {
      const text = String(line);
      const matchesCategory = this.logFilter === 'all'
        || (this.logFilter === 'commands' && (
          /^\[command\]/i.test(text)
          || /issued server command/i.test(text)
        ))
        || (this.logFilter === 'warnings' && /\b(?:warn|error|fatal|exception|crash)\b/i.test(text))
        || (this.logFilter === 'players' && (
          /joined the game|left the game|logged in|lost connection/i.test(text)
          || /\[Not Secure\]\s*</i.test(text)
        ));
      return matchesCategory && (!query || text.toLowerCase().includes(query));
    });
  }

  jumpToNewestLog() {
    if (!this.consoleEl) return;
    this.consoleEl.scrollTop = this.consoleEl.scrollHeight;
    this.consoleEl.focus({ preventScroll: true });
  }

  async copyText(value, label, copyButton) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.');
      await navigator.clipboard.writeText(value);
      copyButton.textContent = 'Copied';
      this.announce?.(`${label} copied.`);
    } catch {
      copyButton.textContent = 'Copy failed';
      this.announce?.(`Could not copy ${label.toLowerCase()}. Select the address manually.`);
    }
  }

  async shutdownControlCenter() {
    if (!window.confirm('Stop every bot and Minecraft server, then close the Mindcraft dashboard?')) return;
    if (this.busy) return;
    this.busy = 'Control center shutdown';
    this.result = '';
    this.render();
    const result = await this.onShutdown?.();
    if (result?.success === false) {
      this.busy = '';
      this.result = result.error || 'Control center shutdown failed.';
      this.announce?.(this.result);
      this.render();
    }
  }

  async restartControlCenter() {
    if (this.busy) return;
    this.busy = 'Control center restart';
    this.result = '';
    this.render();
    const result = await requestControlCenterRestart();
    if (!result.success) {
      this.busy = '';
      this.result = result.error || 'Control center restart failed.';
      this.announce?.(result.error || 'Control center restart failed.');
      this.render();
      return;
    }
    this.busy = '';
    this.result = 'Control center restarted.';
    this.activity?.add('SYSTEM', this.result, 'ok');
    this.announce?.('Mindcraft restarted. The replacement control center is ready.');
    this.render();
  }

  settingsPanel(status) {
    const transitioning = ['installing', 'starting', 'stopping'].includes(status.phase);
    const editable = status.installed && !transitioning && !this.busy;
    const settings = status.settings || {};
    const memoryOptions = [1024, 2048, 4096, 8192, 16384];
    if (!memoryOptions.includes(Number(status.memoryMb))) memoryOptions.push(Number(status.memoryMb));
    const pauseValue = Number.isInteger(Number(settings.pauseWhenEmptySeconds))
      ? Number(settings.pauseWhenEmptySeconds)
      : -1;
    const pauseOptions = [
      { value: '-1', label: 'Never pause' },
      { value: '0', label: 'Pause immediately when empty' },
      { value: '60', label: 'Pause after 1 minute' },
      { value: '300', label: 'Pause after 5 minutes' },
    ];
    if (!pauseOptions.some((option) => Number(option.value) === pauseValue)) {
      pauseOptions.push({ value: String(pauseValue), label: `${pauseValue} seconds` });
    }
    const controls = {
      memory: select('managedServerMemoryEdit', memoryOptions.sort((a, b) => a - b).map((value) => ({
        value: String(value),
        label: `${value / 1024} GB`,
      })), String(status.memoryMb || 2048)),
      port: input('managedServerPortEdit', 'number', status.port || 25565),
      bedrockPort: input('managedBedrockPortEdit', 'number', status.crossplay?.bedrockPort || 19132),
      bedrockAccess: select('managedBedrockAccess', [
        { value: '127.0.0.1', label: 'This computer only (recommended)' },
        { value: '0.0.0.0', label: 'Local network' },
      ], status.crossplay?.bindAddress || '127.0.0.1'),
      motd: input('managedServerMotd', 'text', settings.motd ?? 'Mindcraft Local Server'),
      onlineMode: input('managedOnlineMode', 'checkbox'),
      whiteList: input('managedWhiteList', 'checkbox'),
      enforceWhitelist: input('managedEnforceWhitelist', 'checkbox'),
      hideOnlinePlayers: input('managedHideOnlinePlayers', 'checkbox'),
      logIps: input('managedLogIps', 'checkbox'),
      gameMode: select('managedGameMode', ['survival', 'creative', 'adventure', 'spectator'], settings.gameMode || 'survival'),
      difficulty: select('managedDifficulty', ['peaceful', 'easy', 'normal', 'hard'], settings.difficulty || 'normal'),
      maxPlayers: input('managedMaxPlayers', 'number', settings.maxPlayers || 10),
      viewDistance: input('managedViewDistance', 'number', settings.viewDistance || 10),
      simulationDistance: input('managedSimulationDistance', 'number', settings.simulationDistance || 8),
      pauseWhenEmptySeconds: select('managedPauseWhenEmpty', pauseOptions, String(pauseValue)),
      entityBroadcastRangePercentage: input(
        'managedEntityBroadcastRange',
        'number',
        settings.entityBroadcastRangePercentage || 100,
      ),
      pvp: input('managedPvp', 'checkbox'),
      forceGameMode: input('managedForceGameMode', 'checkbox'),
      hardcore: input('managedHardcore', 'checkbox'),
      allowFlight: input('managedAllowFlight', 'checkbox'),
      enableCommandBlock: input('managedCommandBlocks', 'checkbox'),
      spawnProtection: input('managedSpawnProtection', 'number', settings.spawnProtection ?? 0),
      playerIdleTimeout: input('managedPlayerIdleTimeout', 'number', settings.playerIdleTimeout ?? 0),
      opPermissionLevel: select('managedOpPermissionLevel', [
        { value: '1', label: '1 · Basic moderation' },
        { value: '2', label: '2 · Gameplay commands' },
        { value: '3', label: '3 · Player management' },
        { value: '4', label: '4 · Full server control' },
      ], String(settings.opPermissionLevel || 4)),
    };
    controls.onlineMode.checked = settings.onlineMode === true;
    controls.whiteList.checked = settings.whiteList === true;
    controls.enforceWhitelist.checked = settings.enforceWhitelist === true;
    controls.hideOnlinePlayers.checked = settings.hideOnlinePlayers === true;
    controls.logIps.checked = settings.logIps !== false;
    controls.pvp.checked = settings.pvp !== false;
    controls.forceGameMode.checked = settings.forceGameMode === true;
    controls.hardcore.checked = settings.hardcore === true;
    controls.allowFlight.checked = settings.allowFlight !== false;
    controls.enableCommandBlock.checked = settings.enableCommandBlock !== false;
    for (const control of Object.values(controls)) control.disabled = !editable;
    controls.motd.maxLength = 100;
    controls.port.min = controls.bedrockPort.min = '1024';
    controls.port.max = controls.bedrockPort.max = '65535';
    controls.maxPlayers.min = '1';
    controls.maxPlayers.max = '100';
    controls.spawnProtection.min = controls.playerIdleTimeout.min = '0';
    controls.spawnProtection.max = '64';
    controls.playerIdleTimeout.max = '1440';
    controls.viewDistance.min = controls.simulationDistance.min = '2';
    controls.viewDistance.max = controls.simulationDistance.max = '32';
    controls.entityBroadcastRangePercentage.min = '10';
    controls.entityBroadcastRangePercentage.max = '1000';

    const panel = node('section', 'panel server-settings-panel');
    const heading = node('div', 'section-heading');
    const headingCopy = node('div');
    headingCopy.append(
      node('span', 'eyebrow', 'Managed Paper settings'),
      node('h2', '', 'Server settings'),
      node('p', 'muted small', editable
        ? status.phase === 'running'
          ? 'Review everything here, then restart Minecraft once. Active bots resume automatically.'
          : 'Changes are validated and saved for the next server start.'
        : 'Settings are temporarily locked while the server changes state.'),
    );
    heading.append(headingCopy);
    panel.append(heading);

    const layout = node('div', 'settings-layout');
    const access = node('section', 'settings-group settings-group-wide');
    access.append(groupHeading(
      'Connection, identity & privacy',
      'Who can discover and join this world, plus what the server records.',
    ));
    const accessGrid = node('div', 'settings-grid');
    const motd = field('Server name (MOTD)', controls.motd, 'Shown in the multiplayer server list.');
    motd.classList.add('span-full');
    accessGrid.append(
      motd,
      field('Java port', controls.port),
      field('Bedrock port', controls.bedrockPort, 'UDP through Geyser'),
      field(
        'Bedrock access',
        controls.bedrockAccess,
        'This computer only is safest. Local network may require a firewall allowance.',
      ),
    );
    const accessToggles = node('div', 'toggle-grid');
    accessToggles.append(
      toggleField(
        'Online account authentication',
        controls.onlineMode,
        'Off keeps the preconfigured offline Mindcraft bot compatible. Turn this on only after changing bot and player authentication.',
      ),
      toggleField(
        'Use whitelist',
        controls.whiteList,
        'Only players named with the whitelist command can join.',
      ),
      toggleField(
        'Enforce whitelist immediately',
        controls.enforceWhitelist,
        'Kick players who are removed when the whitelist is reloaded.',
      ),
      toggleField(
        'Hide online players',
        controls.hideOnlinePlayers,
        'Do not expose the player sample in server-list status.',
      ),
      toggleField(
        'Log player IP addresses',
        controls.logIps,
        'Turn off for a more private local log. Useful detail is lost when diagnosing connections.',
      ),
    );
    access.append(accessGrid, accessToggles);

    const world = node('section', 'settings-group');
    world.append(groupHeading('Gameplay & permissions', 'Rules that change how players and operators experience the world.'));
    const worldGrid = node('div', 'settings-grid');
    worldGrid.append(
      field('Game mode', controls.gameMode),
      field('Difficulty', controls.difficulty),
      field('Max players', controls.maxPlayers),
      field('Idle timeout', controls.playerIdleTimeout, 'Minutes; 0 keeps players connected'),
      field('Operator permission', controls.opPermissionLevel),
      field('Spawn protection', controls.spawnProtection, 'Radius in blocks; 0 disables it'),
    );
    const worldToggles = node('div', 'toggle-grid');
    worldToggles.append(
      toggleField('Player vs player damage', controls.pvp),
      toggleField('Force default game mode', controls.forceGameMode, 'Reset each player to the configured mode when they join.'),
      toggleField('Hardcore world rules', controls.hardcore, 'Death can remove normal access. Enable deliberately.'),
      toggleField('Allow flight', controls.allowFlight, 'Required by some bots, mods, and creative workflows.'),
      toggleField('Enable command blocks', controls.enableCommandBlock),
    );
    world.append(worldGrid, worldToggles);

    const performance = node('section', 'settings-group');
    performance.append(groupHeading('Performance & idle behavior', 'Bound world activity without hiding what each control changes.'));
    const performanceGrid = node('div', 'settings-grid');
    performanceGrid.append(
      field('Memory', controls.memory, 'Maximum Java heap'),
      field('View distance', controls.viewDistance, 'How far players can see'),
      field('Simulation distance', controls.simulationDistance, 'How far mobs and redstone stay active'),
      field('Entity broadcast range', controls.entityBroadcastRangePercentage, 'Percent of the normal tracking distance'),
      field('When nobody is online', controls.pauseWhenEmptySeconds, 'Pausing reduces idle CPU use; a joining player resumes the server.'),
    );
    performance.append(performanceGrid);
    layout.append(access, world, performance);
    panel.append(layout);

    const actions = node('div', 'settings-save-bar');
    actions.append(node('div', 'settings-impact', status.phase === 'running'
      ? 'One restart · active bots resume'
      : 'Saved for the next server start'));
    const save = button(status.phase === 'running' ? 'Save & Restart Server' : 'Save Server Settings', () => this.saveSettings(controls), 'primary');
    save.disabled = !editable;
    actions.append(save);
    panel.append(actions);
    return panel;
  }

  connectionPanel(status) {
    const panel = node('section', 'panel join-panel bedrock-center');
    const crossplay = status.crossplay || {};
    const client = this.bedrockClient;
    const floodgateReady = crossplay.authentication === 'floodgate';
    const joinVerification = crossplay.joinVerification || {};
    const joinVerified = joinVerification.verified === true;
    const connectionSemantics = bedrockConnectionSemantics(status, client);
    const heading = node('div', 'section-heading');
    const copy = node('div');
    copy.append(
      node('span', 'eyebrow', 'Join this world'),
      node('h2', '', 'Bedrock Connection Center'),
      node('p', 'muted small', 'Geyser translates Bedrock traffic; Floodgate handles Xbox-authenticated Bedrock identities.'),
    );
    const configuredToTest = connectionSemantics.configuredToTest;
    const readinessLabel = !configuredToTest
      ? 'Setup needed'
      : joinVerified ? 'Join verified' : 'Configured · test join';
    heading.append(
      copy,
      node('span', `state-badge ${joinVerified ? 'state-running' : 'state-blocked'}`, readinessLabel),
    );
    panel.append(heading);

    const checks = node('div', 'bedrock-check-grid');
    const addCheck = (label, value, ready, detail) => {
      const item = node('div', `bedrock-check ${ready ? 'is-ready' : 'needs-action'}`);
      item.append(
        node('span', 'bedrock-check-label', label),
        node('strong', '', value),
        node('small', 'muted', detail),
      );
      checks.append(item);
    };
    addCheck(
      'Translator',
      connectionSemantics.translatorLabel,
      connectionSemantics.translatorReady,
      crossplay.observedEndpoint
        ? `Geyser observed at ${crossplay.observedEndpoint.bindAddress}:${crossplay.observedEndpoint.bedrockPort}`
        : `Geyser · configured UDP ${crossplay.bedrockPort || 19132}`,
    );
    addCheck(
      'Windows client',
      client?.installed ? 'Detected' : 'Not detected',
      Boolean(client?.installed),
      client?.version ? `Minecraft for Windows ${client.version}` : 'Install Minecraft for Windows',
    );
    if (connectionSemantics.requiresLoopbackExemption) {
      addCheck(
        'Same-PC access',
        client?.loopbackEnabled ? 'Enabled' : 'Needs one-time setup',
        Boolean(client?.loopbackEnabled),
        client?.supported === false ? 'Windows control unavailable' : 'Windows loopback exemption',
      );
    }
    addCheck(
      'Bedrock sign-in',
      floodgateReady ? 'Xbox account' : 'Needs Floodgate',
      floodgateReady,
      floodgateReady ? `Floodgate ${crossplay.floodgateVersion || 'installed'}` : 'No paid Java account required after setup',
    );
    addCheck(
      'Actual Bedrock join',
      joinVerified ? 'Verified this run' : (configuredToTest ? 'Not observed yet' : 'Waiting for setup'),
      joinVerified,
      joinVerified
        ? `${joinVerification.player || 'Bedrock player'} joined · ${new Date(joinVerification.verifiedAt).toLocaleTimeString()}`
        : configuredToTest
          ? 'Join once from Minecraft for Windows; this changes only after Paper observes a Floodgate-backed player.'
          : joinVerification.detail || 'Complete the checks above, then join from Minecraft for Windows.',
    );
    panel.append(checks);

    const actions = node('div', 'actions bedrock-actions');
    if (connectionSemantics.requiresLoopbackExemption && client?.installed && !client.loopbackEnabled) {
      const enable = button('Enable same-PC Bedrock', () => this.setBedrockLoopback(true), 'primary');
      enable.disabled = Boolean(this.busy);
      actions.append(enable);
    } else if (connectionSemantics.requiresLoopbackExemption && client?.loopbackEnabled) {
      const disable = button('Remove same-PC access', () => this.setBedrockLoopback(false));
      disable.disabled = Boolean(this.busy);
      actions.append(disable);
    }
    if (status.installed && crossplay.enabled && !floodgateReady) {
      const repair = button('Install Bedrock sign-in support', () => this.repairBedrockSignIn(), 'primary');
      repair.disabled = Boolean(this.busy);
      actions.append(repair);
    }
    if (actions.childElementCount) panel.append(actions);

    const steps = node('div', 'bedrock-steps');
    steps.append(node('strong', '', 'Minecraft for Windows: Play → Servers → Add Server'));
    const list = node('ol');
    const address = crossplay.access === 'local-network'
      ? (Array.isArray(crossplay.lanAddresses) && crossplay.lanAddresses[0] ? crossplay.lanAddresses[0] : 'this computer’s LAN IP')
      : '127.0.0.1';
    for (const text of [
      `Server Name: ${status.settings?.motd || 'Mindcraft Local Server'}`,
      `Server Address: ${address}`,
      `Port: ${crossplay.bedrockPort || 19132}`,
      'Save, select the server, then Join Server.',
    ]) list.append(node('li', '', text));
    steps.append(list);
    const target = `${address}:${crossplay.bedrockPort || 19132}`;
    if (!address.includes('LAN IP')) {
      const copyButton = button('Copy Bedrock address', () => this.copyText(target, 'Bedrock address', copyButton));
      steps.append(copyButton);
    }
    panel.append(steps);

    const javaTarget = `${status.host}:${status.port}`;
    const javaLine = node('div', 'java-join-line');
    javaLine.append(node('span', '', 'Java Edition & bots'), node('code', '', javaTarget));
    const copyJava = button('Copy', () => this.copyText(javaTarget, 'Java address', copyJava));
    javaLine.append(copyJava);
    panel.append(javaLine);
    if (!status.settings?.onlineMode) {
      panel.append(node(
        'p',
        'warning-callout small',
        'This is a local/private compatibility server. Keep it on this computer or your trusted LAN, and enable the whitelist before allowing other players.',
      ));
    }
    return panel;
  }

  operatorPanel(status) {
    const panel = node('section', 'panel operator-panel');
    const running = status.phase === 'running';
    const heading = node('div', 'section-heading');
    const headingCopy = node('div');
    headingCopy.append(
      node('span', 'eyebrow', 'Live operations'),
      node('h2', '', 'Operator console'),
      node('p', 'muted small', 'Run safe routine actions, send a Paper command, and inspect the response without leaving this page.'),
    );
    heading.append(
      headingCopy,
      node('span', `state-badge ${running ? 'state-running' : 'state-stopped'}`, running ? 'Commands live' : 'Commands offline'),
    );
    panel.append(heading);

    const layout = node('div', 'operator-layout');
    const commandPane = node('section', 'command-pane');
    commandPane.append(
      node('h3', '', 'Game administration'),
      node('p', 'muted small', 'Lifecycle and reload commands are intentionally blocked here. Use the server controls above so bots stop and resume cleanly.'),
    );
    const quick = node('div', 'quick-command-grid');
    for (const preset of QUICK_COMMANDS) {
      const quickButton = button('', () => this.sendCommand(preset.command), 'quick-command');
      quickButton.append(node('strong', '', preset.label), node('small', '', preset.detail));
      quickButton.disabled = !running || Boolean(this.busy);
      quick.append(quickButton);
    }
    commandPane.append(
      quick,
      node('p', 'muted small command-examples', 'Other examples: op <player> · whitelist add <player> · gamemode creative <player>.'),
    );

    const commandForm = node('form', 'command-form');
    const commandLabel = node('label', '', 'Server command');
    const commandInput = input('managedServerCommand', 'text');
    commandInput.value = this.commandDraft;
    commandInput.placeholder = 'Example: gamemode creative MindcraftBot';
    commandInput.autocomplete = 'off';
    commandInput.maxLength = 2048;
    commandInput.disabled = !running || Boolean(this.busy);
    commandInput.addEventListener('input', () => {
      this.commandDraft = commandInput.value;
      this.commandHistoryIndex = -1;
    });
    commandInput.addEventListener('keydown', (event) => this.handleCommandHistory(event, commandInput));
    commandLabel.htmlFor = commandInput.id;
    const commandRow = node('div', 'command-row');
    const send = button(this.busy === 'Command' ? 'Sending…' : 'Send Command', () => this.sendCommand(commandInput), 'primary');
    send.disabled = !running || Boolean(this.busy);
    commandRow.append(commandInput, send);
    commandForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!send.disabled) this.sendCommand(commandInput);
    });
    commandForm.append(
      commandLabel,
      commandRow,
      node('small', 'muted command-hint', 'One line, up to 2048 characters. Use ↑ and ↓ to recall successful commands.'),
    );
    commandPane.append(commandForm);
    const feedback = node('div', 'command-feedback');
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    if (!running) {
      feedback.append(node('p', 'status-text', status.installed
        ? 'Start the server to enable live commands.'
        : 'Install the managed server to enable live commands.'));
    }
    if (this.busy) feedback.append(node('p', 'status-text', `${this.busy}…`));
    if (this.result) {
      feedback.append(node(
        'p',
        /failed|required|attention|blocked|could not/i.test(this.result) ? 'error-copy' : 'success-copy',
        this.result,
      ));
    }
    if (status.error) feedback.append(node('p', 'error-copy', status.error));
    commandPane.append(feedback);

    const outputPane = node('section', 'server-output-pane');
    const outputHeading = node('div', 'output-heading');
    const outputTitle = node('div');
    outputTitle.append(node('h3', '', 'Server output'));
    this.logCountEl = node('span', 'muted small', '0 lines');
    outputTitle.append(this.logCountEl);
    const newest = button('Jump to newest', () => this.jumpToNewestLog());
    outputHeading.append(outputTitle, newest);
    outputPane.append(outputHeading);
    const outputControls = node('div', 'output-controls');
    const filter = select('managedLogFilter', [
      { value: 'all', label: 'All output' },
      { value: 'commands', label: 'Commands' },
      { value: 'warnings', label: 'Warnings & errors' },
      { value: 'players', label: 'Players & chat' },
    ], this.logFilter);
    filter.setAttribute('aria-label', 'Filter server output');
    filter.addEventListener('change', () => {
      this.logFilter = filter.value;
      this.renderLogs(this.lastLogs);
    });
    const search = input('managedLogSearch', 'search', this.logQuery);
    search.placeholder = 'Search output';
    search.setAttribute('aria-label', 'Search server output');
    search.addEventListener('input', () => {
      this.logQuery = search.value;
      this.renderLogs(this.lastLogs);
    });
    outputControls.append(filter, search);
    outputPane.append(outputControls);
    this.consoleEl = node('div', 'console server-console');
    this.consoleEl.tabIndex = 0;
    this.consoleEl.setAttribute('aria-label', 'Minecraft server output');
    this.renderLogs(status.logs);
    outputPane.append(this.consoleEl);
    layout.append(commandPane, outputPane);
    panel.append(layout);
    return panel;
  }

  controlCenterPanel() {
    const panel = node('section', 'panel control-center-panel');
    const copy = node('div');
    copy.append(
      node('span', 'eyebrow', 'Mindcraft process'),
      node('h2', '', 'Control center'),
      node('p', 'muted small', 'These actions affect bots and the dashboard process, not just the Minecraft world.'),
    );
    const actions = node('div', 'control-center-actions');
    const stopEverything = button('Stop Mindcraft Runtime', () => {
      if (!window.confirm('Stop every bot, task runner, managed Minecraft server, and local service started by Mindcraft? The dashboard will stay open.')) return;
      return this.run('Runtime stop', '/system/stop', {}, { interrupt: true });
    }, 'danger');
    const restart = button('Restart Control Center', () => this.restartControlCenter());
    const shutdown = button('Shut Down Control Center', () => this.shutdownControlCenter(), 'danger');
    restart.disabled = shutdown.disabled = Boolean(this.busy);
    actions.append(stopEverything, restart, shutdown);
    panel.append(copy, actions);
    return panel;
  }

  render() {
    clear(this.root);
    const status = this.status || {
      phase: 'unknown',
      installed: false,
      host: '127.0.0.1',
      port: 25565,
      memoryMb: 2048,
      recommendedVersion: null,
      java: { available: false, supported: false },
      settings: {},
      crossplay: { enabled: false, ready: false, bedrockPort: 19132 },
      logs: [],
    };
    this.renderKey = this.statusRenderKey(status);

    const heading = node('div', 'workspace-heading');
    const headingText = node('div');
    headingText.append(
      node('span', 'eyebrow', 'Local Java + Bedrock world'),
      node('h1', '', 'Minecraft Server'),
      node('p', '', 'Run the world, command it live, and tune every managed setting from one workspace.'),
    );
    const headingActions = node('div', 'heading-actions');
    headingActions.append(button('Refresh status', () => this.load()));
    heading.append(headingText, headingActions);
    this.root.append(heading);

    const summary = node('section', 'panel server-hero');
    const statusCopy = node('div');
    const badge = node('span', `state-badge state-${status.phase === 'crashed' ? 'failed' : status.phase}`, statusLabel(status.phase));
    statusCopy.append(badge, node('h2', '', status.installed ? `Local server · ${status.host}:${status.port}` : 'One-time local server setup'));
    const version = status.version
      ? `${status.distribution === 'paper' ? 'Paper' : 'Minecraft Java'} ${status.version}`
      : status.recommendedVersion
        ? `Mindcraft-compatible Paper ${status.recommendedVersion}`
        : 'Compatible Minecraft Java server';
    statusCopy.append(node('p', 'muted', version));
    if (status.crossplay?.enabled) {
      const bridgeSemantics = bedrockConnectionSemantics(status, this.bedrockClient);
      const bridgeRunning = bridgeSemantics.translatorReady;
      statusCopy.append(node('p', bridgeRunning ? 'success-copy small' : 'warning-copy small', bridgeRunning
        ? `Bedrock translator running · ${status.crossplay.authentication === 'floodgate' ? 'Floodgate sign-in' : 'sign-in setup needed'} · UDP ${status.crossplay.bedrockPort}`
        : bridgeSemantics.translatorLabel === 'Installed · stopped'
          ? 'Bedrock translator is installed but not currently running.'
          : `Bedrock translator: ${bridgeSemantics.translatorLabel.toLowerCase()}.`));
    }
    const actions = node('div', 'launch-actions');
    if (status.installed && status.compatible === false && ['stopped', 'crashed'].includes(status.phase)) {
      actions.append(button('Replace with compatible cross-play server', () => this.replaceAndStart(status), 'primary'));
    } else if (status.installed && status.phase === 'stopped') {
      actions.append(button('Start Server', () => this.run('Server start', '/minecraft-server/start', {}), 'success'));
    } else if (status.phase === 'starting') {
      actions.append(button('Cancel Start', () => this.run('Server stop', '/minecraft-server/stop', {}, { interrupt: true }), 'danger'));
    } else if (status.phase === 'running') {
      actions.append(
        button('Restart Server', () => this.run('Server restart', '/minecraft-server/restart', {})),
        button('Stop Server', () => this.run('Server stop', '/minecraft-server/stop', {}, { interrupt: true }), 'danger'),
      );
    } else if (status.phase === 'crashed' && status.compatible !== false) {
      actions.append(button('Try Again', () => this.run('Server start', '/minecraft-server/start', {}), 'primary'));
    }
    summary.append(statusCopy, actions);
    if (status.installed && status.compatible !== false) {
      const overview = node('div', 'server-overview-grid');
      overview.append(summary, this.connectionPanel(status));
      this.root.append(overview);
      this.root.append(this.serverPresencePanel());
    } else {
      this.root.append(summary);
    }

    if (!status.installed) {
      const setup = node('section', 'panel quickstart-panel');
      setup.append(node('h2', '', 'Install a cross-play server'));
      const javaReady = status.java?.supported;
      const requiredJavaMajor = status.java?.requiredMajor || 21;
      const javaCard = node('div', `java-detection ${javaReady ? 'ready' : 'blocked'}`);
      javaCard.append(
        node('strong', '', javaReady ? 'Java is ready' : `Java ${requiredJavaMajor} is required`),
        node('div', 'summary-detail', javaReady
          ? `${status.java.source || 'Java'} · ${status.java.version} · selected automatically`
          : status.java?.available
            ? `Found Java ${status.java.major || status.java.version}, but it does not meet the server requirement.`
            : 'No compatible Java runtime was detected.'),
      );
      setup.append(
        javaCard,
        node('p', 'muted small', 'Installs Paper for Mindcraft bots plus Geyser, Floodgate, and ViaVersion for current Bedrock clients. The preserved 26.2 world is not overwritten.'),
      );
      const memory = select('managedServerMemory', [
        { value: '1024', label: '1 GB' },
        { value: '2048', label: '2 GB (recommended)' },
        { value: '4096', label: '4 GB' },
        { value: '8192', label: '8 GB' },
      ], String(status.memoryMb || 2048));
      const port = input('managedServerPort', 'number', status.port || 25565);
      const bedrockPort = input('managedBedrockPort', 'number', status.crossplay?.bedrockPort || 19132);
      port.min = bedrockPort.min = '1024';
      port.max = bedrockPort.max = '65535';
      const options = node('div', 'grid-3');
      options.append(field('Memory', memory), field('Java port', port), field('Bedrock port', bedrockPort, 'UDP'));
      setup.append(options);
      const eulaRow = node('label', 'eula-row');
      const eula = input('managedServerEula', 'checkbox');
      const eulaText = node('span');
      eulaText.append(document.createTextNode('I accept the '));
      const eulaLink = node('a', '', 'Minecraft EULA');
      eulaLink.href = EULA_URL;
      eulaLink.target = '_blank';
      eulaLink.rel = 'noreferrer';
      eulaText.append(eulaLink, document.createTextNode('.'));
      eulaRow.append(eula, eulaText);
      setup.append(eulaRow);
      const install = button('Install & Start Cross-play Server', () => this.installAndStart(eula, memory, port, bedrockPort), 'primary');
      install.disabled = !javaReady || Boolean(this.busy);
      const setupActions = node('div', 'actions');
      setupActions.append(install);
      setup.append(setupActions);
      this.root.append(setup);
    }

    if (status.installed && status.compatible === false) {
      const repair = node('section', 'panel');
      repair.append(
        node('h2', '', 'Compatibility repair required'),
        node('p', 'error-copy', `Minecraft ${status.version || 'unknown'} is newer than this bot engine supports. Replace it with Paper ${status.recommendedVersion}; the existing world is preserved and a separate compatible world is created.`),
        node('p', 'muted small', 'The replacement also installs Geyser, Floodgate, and ViaVersion for Bedrock cross-play.'),
      );
      this.root.append(repair);
    }

    this.root.append(this.operatorPanel(status));
    if (status.installed) this.root.append(this.settingsPanel(status));
    this.root.append(this.controlCenterPanel());
  }

  renderLogs(rawLogs) {
    if (!this.consoleEl) return;
    const logs = Array.isArray(rawLogs) ? rawLogs : [];
    this.lastLogs = logs;
    const visibleLogs = this.filteredLogs(logs);
    const signature = JSON.stringify([this.logFilter, this.logQuery, logs]);
    if (this.consoleEl.dataset.signature === signature) return;
    const pinnedToBottom = this.consoleEl.scrollTop + this.consoleEl.clientHeight >= this.consoleEl.scrollHeight - 24;
    clear(this.consoleEl);
    if (visibleLogs.length === 0) {
      this.consoleEl.append(node(
        'div',
        'empty-state',
        logs.length === 0 ? 'Server output will appear here.' : 'No output matches this filter.',
      ));
    } else {
      visibleLogs.forEach((line) => {
        const tone = /^\[command\]/i.test(line)
          ? ' command-entry'
          : /\b(?:warn|error|fatal|exception|crash)\b/i.test(line)
            ? ' warning-entry'
            : '';
        this.consoleEl.append(node('div', `console-entry${tone}`, line));
      });
    }
    if (this.logCountEl) {
      this.logCountEl.textContent = `${visibleLogs.length} of ${logs.length} lines`;
    }
    this.consoleEl.dataset.signature = signature;
    if (pinnedToBottom) this.consoleEl.scrollTop = this.consoleEl.scrollHeight;
  }
}
