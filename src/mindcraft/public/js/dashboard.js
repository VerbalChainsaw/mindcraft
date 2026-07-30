import {
  attentionStatusLabel,
  button,
  canStartAgent,
  clear,
  dialogueStatusLabel,
  errorText,
  input,
  node,
  normalizeState,
  operatorControlLabel,
  select,
  stateLabels,
  telemetryFreshness,
} from './utils.js';
import { api } from './api.js';

const PLAYER_NAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;
const SQUAD_PREFIX_PATTERN = /^[A-Za-z][A-Za-z0-9_]{1,11}$/;
const ACTIVE_SQUAD_STATES = new Set(['launching', 'starting', 'running', 'partial', 'stopping']);

function phaseLabel(phase) {
  return ({
    uninstalled: 'Not installed',
    installing: 'Installing',
    stopped: 'Stopped',
    starting: 'Starting',
    running: 'Running',
    stopping: 'Stopping',
    crashed: 'Needs attention',
    external: 'Reachable',
    unknown: 'Checking',
  })[phase] || 'Checking';
}

function stateTone(state, healthy = []) {
  if (healthy.includes(state)) return 'good';
  if (['failed', 'blocked', 'crashed', 'offline'].includes(state)) return 'bad';
  return 'warn';
}

function memberTone(member) {
  const state = String(member?.state || '');
  if (['started', 'running'].includes(state)) return 'online';
  if (state === 'failed') return 'failed';
  if (state === 'stopped') return 'stopped';
  return 'starting';
}

function initials(name) {
  const clean = String(name || '?').replace(/[^A-Za-z0-9]/g, '');
  return (clean.slice(0, 2) || '?').toUpperCase();
}

function hueFor(value) {
  let hash = 0;
  for (const character of String(value || 'Mindcraft')) {
    hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  }
  return Math.abs(hash) % 360;
}

function memberHead(name, state = 'ready', index = 0) {
  const head = node('span', `squad-head head-${memberTone({ state })}`);
  head.style.setProperty('--head-hue', String((hueFor(name) + (index * 19)) % 360));
  head.setAttribute('aria-label', `${name}: ${state}`);
  head.title = `${name} · ${state}`;
  head.append(node('span', 'squad-head-face', initials(name)));
  return head;
}

function sectionHeading(eyebrow, title, detail = '') {
  const heading = node('div', 'control-section-heading');
  const copy = node('div');
  copy.append(node('span', 'eyebrow', eyebrow), node('h2', '', title));
  if (detail) copy.append(node('p', 'muted small', detail));
  heading.append(copy);
  return heading;
}

function compactField(labelText, control, detail = '') {
  const wrap = node('div', 'control-field');
  const label = node('label', '', labelText);
  if (control.id) label.htmlFor = control.id;
  wrap.append(label, control);
  if (detail) wrap.append(node('span', 'field-detail', detail));
  return wrap;
}

function liveFleetReadout(state) {
  if (!state || typeof state !== 'object') return 'Live readout pending';
  if (state.error) return `Telemetry unavailable: ${String(state.error).slice(0, 120)}`;
  const action = state.action || {};
  const gameplay = state.gameplay || {};
  const identity = state.identity || {};
  const perception = state.perception || {};
  const attention = state.attention || {};
  const dialogue = state.dialogue || {};
  const control = operatorControlLabel(action);
  const parts = [
    [identity.displayName, identity.role || identity.job].filter(Boolean).join(' · ') || null,
    action.stopTimedOutAt ? control : action.current || control,
    action.stopTimedOutAt && action.current ? action.current : null,
    gameplay.position && [gameplay.position.x, gameplay.position.y, gameplay.position.z].every(Number.isFinite)
      ? `x ${gameplay.position.x}, y ${gameplay.position.y}, z ${gameplay.position.z}`
      : 'position unavailable',
    Number.isFinite(gameplay.health) ? `${gameplay.health}/${gameplay.healthMax || 20} health` : 'health unavailable',
  ];
  const visibleParts = parts.filter(Boolean);
  if (action.stopRequestedAt && !action.stopTimedOutAt) visibleParts.push('stop pending');
  if (action.held && !action.stopTimedOutAt) visibleParts.push('held');
  if (attention.state === 'working' || attention.state === 'paused' || attention.state === 'held' || attention.goalActive) {
    visibleParts.push(attentionStatusLabel(attention));
  }
  if (dialogue.muted || dialogue.inConversation) visibleParts.push(dialogueStatusLabel(dialogue));
  if (action.lastResult?.phase && action.lastResult.phase !== 'succeeded') {
    visibleParts.push(`${String(action.lastResult.phase).replace(/_/g, ' ')}: ${String(action.lastResult.code || 'unknown').replace(/_/g, ' ')}`);
  }
  if (perception.status === 'fresh' || perception.status === 'cached') {
    const hostiles = Array.isArray(perception.hostiles) ? perception.hostiles.length : 0;
    if (hostiles) visibleParts.push(`${hostiles} hostile${hostiles === 1 ? '' : 's'} nearby`);
  } else if (perception.status === 'stale') {
    visibleParts.push('world scan stale');
  }
  const freshness = telemetryFreshness(state);
  if (freshness.stale) visibleParts.push(freshness.label);
  return visibleParts.join(' · ');
}

export class DashboardWorkspace {
  constructor(root, {
    getState,
    isActive,
    navigate,
    refresh,
    startBot,
    startAgent,
    stopBot,
    stopAllBots,
    startServer,
    stopServer,
    restartServer,
    refreshSquads,
    launchSquad,
    launchScenario,
    controlSquad,
    squadAction,
    stopEverything,
    restartControlCenter,
    shutdownControlCenter,
    announce,
  }) {
    this.root = root;
    this.getState = getState;
    this.isActive = isActive;
    this.navigate = navigate;
    this.refresh = refresh;
    this.startBot = startBot;
    this.startAgent = startAgent;
    this.stopBot = stopBot;
    this.stopAllBots = stopAllBots;
    this.startServer = startServer;
    this.stopServer = stopServer;
    this.restartServer = restartServer;
    this.refreshSquads = refreshSquads;
    this.launchSquad = launchSquad;
    this.launchScenario = launchScenario;
    this.controlSquad = controlSquad;
    this.squadAction = squadAction;
    this.stopEverything = stopEverything;
    this.restartControlCenter = restartControlCenter;
    this.shutdownControlCenter = shutdownControlCenter;
    this.announce = announce;
    this.busy = '';
    this.actionError = '';
    this.selectedSquadId = '';
    this.deployMode = 'single';
    this.deployDraft = {
      templateName: '',
      prefix: 'Squad_',
      size: 3,
      staggerMs: 750,
      scenarioId: '',
      leader: 'Director',
    };
    this.commandDraft = {
      leader: 'Director',
      formation: 'balanced',
    };
    this.libraryProfiles = [];
    this.fleetReadouts = new Map();
  }

  mount() {
    this.render();
    void this.refreshSquads?.();
    void this.refreshLibrary();
  }

  async refreshLibrary() {
    try {
      const response = await api('/bot-library');
      if (!response.success) return;
      this.libraryProfiles = Array.isArray(response.profiles) ? response.profiles : [];
      if (this.isActive?.()) this.render();
    } catch {
      // The Home dashboard remains usable when the optional library endpoint is unavailable.
    }
  }

  async run(key, label, action, confirmation = '') {
    if (this.busy) return null;
    if (confirmation && !window.confirm(confirmation)) return null;
    this.busy = key;
    this.actionError = '';
    this.render();
    try {
      const result = await action();
      if (result?.cancelled) return null;
      if (result?.success === false) throw new Error(result.error || `${label} failed.`);
      return result;
    } catch (error) {
      this.actionError = errorText(error?.message || error || `${label} failed.`);
      this.announce?.(this.actionError);
      return null;
    } finally {
      this.busy = '';
      try {
        await this.refresh?.();
      } catch (error) {
        this.actionError = errorText(error?.message || error || 'Status refresh failed.');
      }
      this.render();
    }
  }

  actionButton(label, key, action, className = '', confirmation = '', busyLabel = '') {
    const active = this.busy === key;
    const control = button(
      active ? (busyLabel || `${label}…`) : label,
      () => this.run(key, label, action, confirmation),
      className,
    );
    control.disabled = Boolean(this.busy);
    return control;
  }

  deriveState() {
    const current = this.getState?.() || {};
    const quickstart = current.quickstart || {};
    const recommendation = current.recommendation || {};
    const agents = Array.isArray(current.agents) ? current.agents : [];
    const agentStates = current.agentStates && typeof current.agentStates === 'object' ? current.agentStates : {};
    const squads = Array.isArray(current.squads) ? current.squads : [];
    const scenarios = Array.isArray(current.scenarios) ? current.scenarios : [];
    const templates = Array.isArray(current.templates) ? current.templates : [];
    const providers = [...new Set(agents.map((agent) => String(agent.provider || '').trim()).filter(Boolean))];
    const primaryBot = agents.find((agent) => agent.name === quickstart.botName) || agents[0] || null;
    const botState = primaryBot ? normalizeState(primaryBot) : (quickstart.configured ? 'ready' : 'unconfigured');
    const server = current.managedServer || null;
    const minecraftReady = Boolean(current.health?.checks?.minecraftReachable || server?.phase === 'running');
    const serverPhase = server?.phase || (minecraftReady ? 'external' : 'unknown');
    const crossplayReady = Boolean(
      server?.crossplay?.ready
      && serverPhase === 'running'
      && server.crossplay.runtimeReady === true
    );
    const bedrockJoinVerified = server?.crossplay?.joinVerification?.verified === true;
    const samePcBedrockNeedsSetup = Boolean(
      crossplayReady
      && server?.crossplay?.access === 'this-computer'
      && current.bedrockClient?.installed
      && !current.bedrockClient.loopbackEnabled
    );
    const providerReady = Boolean(
      current.localProviderAvailable
      && (quickstart.chatModel || recommendation.chatModel)
    ) || providers.length > 0;
    const providerSummary = providers.length ? providers.join(' · ') : (quickstart.chatModel || recommendation.chatModel || 'Not configured');
    const inGameAgents = agents.filter((agent) => agent.in_game);
    if (!squads.some((squad) => squad.id === this.selectedSquadId)) {
      this.selectedSquadId = squads[0]?.id || '';
    }
    if (!templates.some((agent) => agent.name === this.deployDraft.templateName)) {
      this.deployDraft.templateName = templates[0]?.name || '';
    }
    if (!scenarios.some((scenario) => scenario.id === this.deployDraft.scenarioId)) {
      this.deployDraft.scenarioId = scenarios[0]?.id || '';
    }
    return {
      ...current,
      quickstart,
      recommendation,
      agents,
      agentStates,
      squads,
      scenarios,
      templates,
      libraryProfiles: this.libraryProfiles,
      primaryBot,
      botState,
      server,
      serverPhase,
      minecraftReady,
      crossplayReady,
      bedrockJoinVerified,
      samePcBedrockNeedsSetup,
      providerReady,
      providers,
      providerSummary,
      inGameAgents,
      selectedSquad:squads.find((squad) => squad.id === this.selectedSquadId) || null,
    };
  }

  titleBar(state) {
    const bar = node('section', 'control-room-titlebar');
    const copy = node('div');
    copy.append(
      node('span', 'eyebrow', 'Live operations'),
      node('h1', '', 'Mindcraft Command Center'),
      node('p', 'muted', 'Run the world, deploy bots, and command teams from one screen.'),
    );
    const actions = node('div', 'control-room-title-actions');
    actions.append(
      this.actionButton('Refresh', 'refresh', () => this.refresh?.(), '', '', 'Refreshing'),
      button('Open Server Workspace', () => this.navigate('server'), 'primary'),
    );
    if (!state.controlOnline) {
      actions.querySelectorAll('button').forEach((control) => {
        if (control.textContent !== 'Refresh') control.disabled = true;
      });
    }
    bar.append(copy, actions);
    return bar;
  }

  statusStrip(state) {
    const serverKnown = Boolean(state.server);
    const serverIsBusy = serverKnown && ['starting', 'stopping', 'installing'].includes(state.serverPhase);
    const primaryServerAction = !serverKnown
      ? button('Checking…', null, 'compact')
      : state.serverPhase === 'running'
      ? this.actionButton('Stop World', 'server-stop-top', this.stopServer, 'compact danger', 'Stop the Java world? Bots will disconnect.', 'Stopping World')
      : this.actionButton('Start World', 'server-start-top', this.startServer, 'compact success', '', 'Starting World');
    primaryServerAction.disabled = primaryServerAction.disabled || serverIsBusy || !state.server?.installed;
    const restartServer = this.actionButton(
      'Restart World',
      'server-restart-top',
      this.restartServer,
      'compact',
      'Restart the Java world? Active bots may briefly disconnect and reconnect.',
      'Restarting',
    );
    restartServer.disabled = restartServer.disabled || serverIsBusy || state.serverPhase !== 'running' || !state.server?.installed;
    const items = [
      {
        label:'Java world',
        value:!serverKnown ? 'Checking' : state.minecraftReady ? phaseLabel(state.serverPhase) : 'Offline',
        detail:!serverKnown ? 'Reading managed server state' : state.server?.port ? `${state.server.host}:${state.server.port}` : 'Not configured',
        tone:stateTone(!serverKnown ? 'unknown' : state.minecraftReady ? state.serverPhase : 'offline', ['running', 'external']),
        action:() => this.navigate('server'),
        actions:[
          primaryServerAction,
          restartServer,
          button('Open Server', () => this.navigate('server'), 'compact'),
        ],
      },
      {
        label:'Bedrock bridge',
        value:!serverKnown ? 'Checking' : state.samePcBedrockNeedsSetup ? 'Setup needed' : state.bedrockJoinVerified ? 'Join verified' : state.crossplayReady ? 'Bridge running · test join' : (state.server?.crossplay?.enabled ? 'Offline' : 'Not installed'),
        detail:!serverKnown ? 'Reading bridge state' : state.samePcBedrockNeedsSetup ? 'Enable same-PC Bedrock access' : state.crossplayReady ? `UDP ${state.server.crossplay.bedrockPort} · ${state.bedrockJoinVerified ? 'Bedrock joined this run' : 'no Bedrock join observed'}` : 'Open server setup',
        tone:stateTone(!serverKnown ? 'unknown' : state.bedrockJoinVerified ? 'running' : 'offline', ['running']),
        action:() => this.navigate('server'),
        actionLabel:'Open Bedrock setup',
      },
      {
        label:'Bot engine',
        value:state.inGameAgents.length ? `${state.inGameAgents.length} in game` : (state.agents.length ? 'Ready' : 'Not configured'),
        detail:state.agents.length ? `${state.agents.length} registered` : 'Open bot setup',
        tone:stateTone(state.inGameAgents.length ? 'running' : state.agents.length ? 'ready' : 'offline', ['running', 'ready']),
        action:() => this.navigate(state.agents.length ? 'agents' : 'profiles'),
        actionLabel:state.agents.length ? 'Manage bots' : 'Create bot',
      },
      {
        label:'AI provider',
       value:state.providers.length ? `${state.providers.length} configured` : state.providerReady ? 'Local provider ready' : 'Needs setup',
       detail:state.providerSummary,
        tone:stateTone(state.providerReady ? 'running' : 'offline', ['running']),
        action:() => this.navigate('profiles'),
        actionLabel:'Configure AI',
      },
      {
        label:'Control center',
        value:state.controlOnline ? 'Online' : 'Reconnecting',
        detail:state.controlOnline ? 'All controls available' : 'Actions paused',
        tone:stateTone(state.controlOnline ? 'running' : 'offline', ['running']),
        action:() => this.navigate('activity'),
        actionLabel:'Open activity',
      },
    ];
    const strip = node('section', 'runtime-status-strip');
    strip.setAttribute('aria-label', 'Mindcraft runtime status');
    items.forEach((item) => {
      const hasActions = Array.isArray(item.actions) && item.actions.length;
      const card = node('section', hasActions
        ? `runtime-status-cell runtime-server-dock tone-${item.tone}`
        : `runtime-status-cell tone-${item.tone}`);
      card.setAttribute('aria-label', `${item.label}: ${item.value}. ${item.detail}`);
      card.append(
        node('span', 'runtime-status-label', item.label),
        node('strong', '', item.value),
        node('small', '', item.detail),
      );
      if (hasActions) {
        const actions = node('div', 'runtime-server-actions');
        item.actions.forEach((control) => actions.append(control));
        card.append(actions);
      } else if (item.action) {
        const actions = node('div', 'runtime-status-actions');
        actions.append(button(item.actionLabel || 'Open', item.action, 'compact'));
        card.append(actions);
      }
      strip.append(card);
    });
    return strip;
  }

  runtimeRow({ title, subtitle, state, tone, actions = [] }) {
    const row = node('div', `runtime-row tone-${tone}`);
    const stateLine = node('div', 'runtime-row-copy');
    const heading = node('div', 'runtime-row-heading');
    heading.append(node('span', 'runtime-light'), node('strong', '', title));
    stateLine.append(heading, node('span', 'runtime-row-subtitle', subtitle));
    const right = node('div', 'runtime-row-right');
    right.append(node('span', 'runtime-row-state', state));
    const actionBar = node('div', 'runtime-row-actions');
    actions.forEach((control) => actionBar.append(control));
    right.append(actionBar);
    row.append(stateLine, right);
    return row;
  }

  runtimePanel(state) {
    const panel = node('section', 'control-column runtime-stack-panel');
    panel.append(sectionHeading('Runtime health', 'What is alive right now', 'The Java World card above owns start, stop, restart, and server configuration.'));

    const serverKnown = Boolean(state.server);
    const bridgeAction = button(
      !serverKnown ? 'Checking…' : state.samePcBedrockNeedsSetup ? 'Open access setup' : state.crossplayReady ? 'Open bridge details' : 'Open Bedrock setup',
      () => this.navigate('server'),
      'compact',
    );
    bridgeAction.disabled = !serverKnown;
    panel.append(this.runtimeRow({
      title:'Java World',
      subtitle:!serverKnown
        ? 'Reading managed server status'
        : state.server?.installed
        ? `${state.server.distribution === 'paper' ? 'Paper' : 'Minecraft'} ${state.server.version || state.server.recommendedVersion || ''}`.trim() + ' · Power controls are above.'
        : 'Managed server is not installed',
      state:serverKnown ? phaseLabel(state.serverPhase) : 'Checking',
      tone:stateTone(serverKnown ? state.serverPhase : 'unknown', ['running', 'external']),
      actions:[button('Open Server Workspace', () => this.navigate('server'), 'compact')],
    }));

    panel.append(this.runtimeRow({
      title:'Bedrock Bridge',
      subtitle:state.server?.crossplay?.enabled
        ? `${state.server.crossplay.access === 'local-network' ? 'LAN access' : 'This computer'} · UDP ${state.server.crossplay.bedrockPort || '—'} · ${state.bedrockJoinVerified ? 'join verified' : 'join not observed'}`
        : 'Geyser cross-play is not configured',
      state:!serverKnown ? 'Checking' : state.samePcBedrockNeedsSetup ? 'Setup needed' : state.bedrockJoinVerified ? 'Join verified' : state.crossplayReady ? 'Test join' : (state.server?.crossplay?.enabled ? 'Offline' : 'Setup needed'),
      tone:stateTone(!serverKnown ? 'unknown' : state.bedrockJoinVerified ? 'running' : 'offline', ['running']),
      actions:[bridgeAction],
    }));

    const botAction = state.inGameAgents.length
      ? this.actionButton('Stop All Bots', 'bots-stop', this.stopAllBots, 'compact danger', '', 'Stopping Bots')
      : this.actionButton('Start Primary Bot', 'bot-start', this.startBot, 'compact success', '', 'Starting Bot');
    botAction.disabled = botAction.disabled || (!state.inGameAgents.length && !state.quickstart.configured);
    panel.append(this.runtimeRow({
      title:'Bot Engine',
      subtitle:state.agents.length ? `${state.agents.length} configured · ${state.inGameAgents.length} active` : 'No bot profile configured',
      state:state.inGameAgents.length ? 'Active' : (state.agents.length ? 'Standing by' : 'Setup needed'),
      tone:stateTone(state.inGameAgents.length ? 'running' : state.agents.length ? 'ready' : 'offline', ['running', 'ready']),
      actions:[botAction, button('Manage Bots', () => this.navigate('agents'), 'compact')],
    }));

    panel.append(this.runtimeRow({
      title:'AI Providers',
       subtitle:state.providerSummary,
       state:state.providerReady ? 'Ready' : 'Setup needed',
      tone:stateTone(state.providerReady ? 'running' : 'offline', ['running']),
      actions:[button('Configure Providers', () => this.navigate('profiles'), 'compact')],
    }));

    panel.append(this.runtimeRow({
      title:'Control Center',
      subtitle:'Dashboard, bridge, orchestration, and activity log',
      state:state.controlOnline ? 'Online' : 'Reconnecting',
      tone:stateTone(state.controlOnline ? 'running' : 'offline', ['running']),
      actions:[
        this.actionButton('Restart Mindcraft', 'control-restart', this.restartControlCenter, 'compact', 'Restart Mindcraft? This page will reconnect automatically.', 'Restarting Mindcraft'),
        this.actionButton('Shut Down Mindcraft', 'control-shutdown', this.shutdownControlCenter, 'compact danger', 'Stop bots and the server, then close Mindcraft?', 'Stopping Mindcraft'),
      ],
    }));

    const emergency = node('div', 'runtime-emergency');
    emergency.append(
      node('div', '', 'Whole stack'),
      this.actionButton(
        'Stop Mindcraft Runtime',
        'stack-stop',
        this.stopEverything,
        'danger',
        'Stop every bot, task runner, managed Minecraft server, and local service started by Mindcraft? The dashboard will stay open.',
        'Stopping',
      ),
    );
    panel.append(emergency);
    return panel;
  }

  squadCrest(squad, selected) {
    const identity = squad.identity || squad.scenario?.identity || {};
    const label = identity.displayName || squad.scenario?.label || String(squad.prefix || 'Squad').replace(/_+$/, '');
    const prefix = String(squad.prefix || '').replace(/_+$/, '');
    // A scenario can intentionally be launched more than once. Keep its
    // player-facing identity, but expose the unique runtime team name so two
    // simultaneous copies are never indistinguishable in the command center.
    const displayLabel = prefix && prefix.toLowerCase() !== label.toLowerCase()
      ? `${label} · ${prefix}`
      : label;
    const behavior = squad.scenario?.behavior
      ? `${squad.scenario.behavior} · ${squad.scenario.formation || 'balanced'} formation`
      : `${squad.targetSize || 0} bot custom team`;
    const crest = button('', () => {
      this.selectedSquadId = squad.id;
      if (squad.scenario?.leader) this.commandDraft.leader = squad.scenario.leader;
      if (squad.scenario?.formation) this.commandDraft.formation = squad.scenario.formation;
      this.render();
    }, `squad-crest ${selected ? 'is-selected' : ''} crest-${stateTone(squad.state, ['running'])}`);
    crest.style.setProperty('--squad-hue', String(hueFor(label)));
    crest.setAttribute('aria-pressed', String(selected));
    crest.setAttribute('aria-label', `${displayLabel}, ${squad.state}, ${squad.startedCount || 0} of ${squad.targetSize || 0} started`);
    if (identity.badge) crest.append(node('span', 'squad-crest-badge', identity.badge));
    crest.append(
      node('span', 'squad-crest-name', displayLabel),
      node('span', 'squad-crest-mission', behavior),
    );
    const cluster = node('span', 'squad-head-cluster');
    const members = Array.isArray(squad.members) ? squad.members : [];
    members.slice(0, 8).forEach((member, index) => cluster.append(memberHead(member.identity?.displayName || member.name, member.state, index)));
    if (members.length > 8) cluster.append(node('span', 'squad-head-overflow', `+${members.length - 8}`));
    crest.append(cluster);
    const footer = node('span', 'squad-crest-footer');
    footer.append(
      node('span', `squad-state-dot tone-${stateTone(squad.state, ['running'])}`),
      node('span', '', `${squad.startedCount || 0}/${squad.targetSize || 0} ready · ${squad.state || 'unknown'}`),
    );
    crest.append(footer);
    if (squad.lastAction) {
      crest.append(node('span', 'squad-crest-action', `${squad.lastAction.label} · ${squad.lastAction.delivery}`));
    }
    return crest;
  }

  scenarioCrest(scenario) {
    const identity = scenario.identity || {};
    const label = identity.displayName || scenario.label;
    const crest = button('', () => {
      this.deployDraft.scenarioId = scenario.id;
      this.deployMode = 'scenario';
      this.render();
    }, 'squad-crest squad-blueprint-crest');
    crest.style.setProperty('--squad-hue', String(hueFor(label)));
    crest.setAttribute('aria-label', `${label}, saved ${scenario.size}-bot squad, choose to configure deployment`);
    if (identity.badge) crest.append(node('span', 'squad-crest-badge', identity.badge));
    crest.append(
      node('span', 'squad-crest-name', label),
      node('span', 'squad-crest-mission', `${scenario.behavior} · ${scenario.formation} formation`),
    );
    const cluster = node('span', 'squad-head-cluster');
    const memberNames = identity.naming?.memberNames || scenario.memberNames || [];
    Array.from({ length:Math.min(8, scenario.size) }, (_unused, index) => {
      cluster.append(memberHead(memberNames[index] || `${scenario.prefix}${index + 1}`, 'ready', index));
    });
    crest.append(cluster);
    const footer = node('span', 'squad-crest-footer');
    footer.append(
      node('span', 'squad-state-dot tone-warn'),
      node('span', '', `Saved blueprint · ${scenario.size} bots`),
    );
    crest.append(footer);
    return crest;
  }

  commandDock(squad) {
    const dock = node('div', 'squad-command-dock');
    const top = node('div', 'squad-command-top');
    const copy = node('div');
    copy.append(
      node('span', 'eyebrow', 'Selected team'),
      node('strong', '', squad.identity?.displayName || squad.scenario?.identity?.displayName || squad.scenario?.label || String(squad.prefix || 'Squad').replace(/_+$/, '')),
    );
    const lifecycle = node('div', 'squad-lifecycle-actions');
    if (ACTIVE_SQUAD_STATES.has(squad.state)) {
      lifecycle.append(this.actionButton(
        'Stop Team',
        `squad-stop:${squad.id}`,
        () => this.squadAction('squad-stop', squad.id, `Stop ${squad.prefix} only?`),
        'compact danger',
        '',
        'Stopping',
      ));
    } else if (squad.state === 'stopped') {
      lifecycle.append(this.actionButton(
        'Start Team',
        `squad-start:${squad.id}`,
        () => this.squadAction('squad-start', squad.id),
        'compact success',
        '',
        'Starting',
      ));
    }
    lifecycle.append(button('Full Controls', () => this.navigate('agents'), 'compact'));
    top.append(copy, lifecycle);
    dock.append(top);
    if (squad.lastAction) {
      const action = squad.lastAction;
      const commandCount = Math.max(0, Number(action.sent) || 0);
      const botCount = Math.max(0, Number(action.targeted) || 0);
      const commandLabel = `${commandCount} command${commandCount === 1 ? '' : 's'}`;
      const botLabel = `${botCount} bot${botCount === 1 ? '' : 's'}`;
      const deliveryCopy = action.delivery === 'queued'
        ? `${commandLabel} queued for delivery across ${botLabel}.`
        : action.delivery === 'partial'
          ? `${commandLabel} reached some of ${botLabel}.`
          : action.delivery === 'failed'
            ? `${commandLabel} could not be delivered to ${botLabel}.`
            : `${commandLabel} accepted for delivery across ${botLabel}.`;
      dock.append(node(
        'div',
        `squad-action-status delivery-${action.delivery || 'accepted'}`,
        `${action.label || 'Squad command'}: ${deliveryCopy} Live bot status confirms outcomes.`,
      ));
    }

    const leader = input('commandLeader', 'text', this.commandDraft.leader);
    leader.maxLength = 16;
    leader.placeholder = 'Your Minecraft name';
    leader.addEventListener('input', () => {
      this.commandDraft.leader = leader.value;
    });
    const formation = select('commandFormation', [
      { value:'tight', label:'Tight escort' },
      { value:'balanced', label:'Balanced group' },
      { value:'rings', label:'Defensive rings' },
      { value:'wide', label:'Wide patrol' },
    ], this.commandDraft.formation);
    formation.addEventListener('change', () => {
      this.commandDraft.formation = formation.value;
    });
    const fields = node('div', 'squad-command-fields');
    fields.append(compactField('Player to follow', leader), compactField('Formation', formation));
    dock.append(fields);

    const orders = node('div', 'squad-quick-orders');
    [
      ['Follow', 'follow'],
      ['Escort & Defend', 'defend'],
      ['Regroup', 'regroup'],
      ['Hold Ground', 'guard'],
      ['Stop Orders', 'stop'],
    ].forEach(([label, behavior]) => {
      const control = this.actionButton(
        label,
        `behavior:${behavior}`,
        () => {
          const leaderName = this.commandDraft.leader.trim();
          if (!PLAYER_NAME_PATTERN.test(leaderName)) {
            return { success:false, error:'Enter your 3-16 character Minecraft player name.' };
          }
          return this.controlSquad('squad-behavior', {
            id:squad.id,
            behavior,
            leader:leaderName,
            formation:this.commandDraft.formation,
          }, `${label} sent to ${squad.scenario?.label || squad.prefix}.`);
        },
        behavior === 'stop' ? 'compact danger' : 'compact',
        '',
        'Sending',
      );
      control.disabled = control.disabled || !['running', 'partial'].includes(squad.state);
      orders.append(control);
    });
    dock.append(orders);
    return dock;
  }

  teamsPanel(state) {
    const panel = node('section', 'control-column teams-panel');
    const heading = sectionHeading('Teams & bots', 'Your squads at a glance', 'Pick a crest to reveal the orders that team can actually receive.');
    const count = node(
      'span',
      'section-count',
      state.squads.length
        ? `${state.squads.length} active team${state.squads.length === 1 ? '' : 's'}`
        : `${state.scenarios.length} saved formations`,
    );
    heading.append(count);
    panel.append(heading);

    const crestGrid = node('div', 'squad-crest-grid');
    if (!state.squads.length && state.scenarios.length) {
      state.scenarios.slice(0, 4).forEach((scenario) => crestGrid.append(this.scenarioCrest(scenario)));
      const hint = node('div', 'squad-blueprint-hint');
      hint.append(
        node('strong', '', 'No team is active yet.'),
        node('span', '', 'These are saved formations—not live bots. Pick one to configure it, or build a custom group.'),
        button('Custom Group', () => {
          this.deployMode = 'group';
          this.render();
        }, 'compact'),
      );
      crestGrid.append(hint);
    } else if (!state.squads.length) {
      const empty = node('div', 'squad-empty-state');
      empty.append(
        node('strong', '', 'No squads deployed yet'),
        node('span', '', 'Use Pick a Group for a custom team, or Saved Squad for knights, miners, builders, and other character crews.'),
        button('Build My First Squad', () => {
          this.deployMode = 'group';
          this.render();
        }, 'primary'),
      );
      crestGrid.append(empty);
    } else {
      [...state.squads]
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .forEach((squad) => crestGrid.append(this.squadCrest(squad, squad.id === this.selectedSquadId)));
    }
    panel.append(crestGrid);

    if (state.selectedSquad) panel.append(this.commandDock(state.selectedSquad));

    const roster = node('div', 'bot-roster-strip');
    const rosterCopy = node('div');
    rosterCopy.append(
      node('span', 'eyebrow', 'Bot roster'),
      node('strong', '', `${state.agents.length} configured · ${state.inGameAgents.length} in game`),
    );
    const heads = node('div', 'bot-roster-heads');
    state.agents.slice(0, 10).forEach((agent, index) => {
      heads.append(memberHead(agent.name, agent.in_game ? 'running' : normalizeState(agent), index));
    });
    if (!state.agents.length) heads.append(node('span', 'muted small', 'No bot profiles yet'));
    roster.append(rosterCopy, heads, button('Manage Bots', () => this.navigate('agents'), 'compact'));
    panel.append(roster);
    panel.append(this.fleetRoster(state));
    return panel;
  }

  fleetRoster(state) {
    this.fleetReadouts.clear();
    const panel = node('section', 'fleet-roster-panel');
    const heading = node('div', 'fleet-roster-heading');
    const headingCopy = node('div');
    heading.append(
      headingCopy,
    );
    headingCopy.append(
      node('span', 'eyebrow', 'Fleet status'),
      node('strong', '', state.agents.length ? `${state.agents.length} registered bot${state.agents.length === 1 ? '' : 's'}` : 'No bots registered'),
    );
    heading.append(button('Open Bot Controls', () => this.navigate('agents'), 'compact'));
    panel.append(heading);

    if (!state.agents.length) {
      panel.append(node('div', 'fleet-empty', 'Create a bot profile to see lifecycle and connection status here.'));
      return panel;
    }

    const list = node('div', 'fleet-status-list');
    state.agents.forEach((agent, index) => {
      const stateKey = normalizeState(agent);
      const connecting = !agent.in_game && (agent.socket_connected || ['starting', 'restarting', 'running'].includes(stateKey));
      const lifecycle = agent.in_game ? 'In game' : connecting ? 'Connecting' : stateKey === 'failed' ? 'Needs attention' : stateKey === 'stopped' ? 'Stopped' : 'Ready';
      const row = node('div', `fleet-status-row tone-${stateTone(stateKey, ['running', 'ready', 'started'])}`);
      const identity = node('div', 'fleet-status-identity');
      identity.append(memberHead(agent.name, agent.in_game ? 'running' : stateKey, index));
      const copy = node('div');
      copy.append(node('strong', '', agent.name), node('span', 'muted small', lifecycle));
      if (agent.in_game) {
        const readout = node('span', 'fleet-status-readout', liveFleetReadout(state.agentStates[agent.name]));
        this.fleetReadouts.set(agent.name, readout);
        copy.append(readout);
      }
      if (agent.lastError) copy.append(node('span', 'fleet-status-error', errorText(agent.lastError)));
      identity.append(copy);
      const stateBadge = node('span', 'fleet-status-state', stateLabels[stateKey] || stateKey);
      const action = agent.in_game
        ? this.actionButton('Stop', `fleet-stop:${agent.name}`, () => this.stopBot(agent.name), 'compact danger', `Disconnect ${agent.name} from Minecraft?`, 'Stopping')
        : this.actionButton(agent.socket_connected ? 'Watching' : stateKey === 'failed' ? 'Retry' : 'Start', `fleet-start:${agent.name}`, () => this.startAgent(agent), 'compact', '', agent.socket_connected ? 'Connecting' : 'Starting');
      action.disabled = action.disabled || (!agent.in_game && (connecting || stateKey === 'stopping' || !canStartAgent(agent)));
      const right = node('div', 'fleet-status-actions');
      right.append(stateBadge, action);
      row.append(identity, right);
      list.append(row);
    });
    panel.append(list);
    return panel;
  }

  updateAgentStates(agentStates = {}) {
    if (this.isActive && !this.isActive()) return;
    for (const [agentName, readout] of this.fleetReadouts) {
      if (!readout?.isConnected) continue;
      readout.textContent = liveFleetReadout(agentStates[agentName]);
    }
  }

  deployTabs() {
    const tabs = node('div', 'deploy-tabs');
    [
      ['single', 'Single Bot'],
      ['group', 'Pick a Group'],
      ['scenario', 'Saved Squad'],
    ].forEach(([mode, label]) => {
      const control = button(label, () => {
        this.deployMode = mode;
        this.actionError = '';
        this.render();
      }, 'deploy-tab');
      control.setAttribute('aria-selected', String(this.deployMode === mode));
      tabs.append(control);
    });
    return tabs;
  }

  templateSelect(state, id) {
    const control = select(id, state.templates.map((agent) => ({
      value:agent.name,
      label:`${agent.name} · ${agent.in_game ? 'in game' : 'configured'}`,
    })), this.deployDraft.templateName);
    control.disabled = !state.templates.length;
    control.addEventListener('change', () => {
      this.deployDraft.templateName = control.value;
    });
    return control;
  }

  singleDeploy(state) {
    const body = node('div', 'deploy-body');
    const candidates = state.templates.length ? state.templates : state.agents;
    if (!candidates.length) {
      body.append(
        node('div', 'deploy-empty', 'Create one bot profile first. It becomes the reusable character and model template for every team.'),
        button('Set Up a Bot', () => this.navigate('profiles'), 'primary full-width'),
      );
      return body;
    }
    if (!candidates.some((agent) => agent.name === this.deployDraft.templateName)) {
      this.deployDraft.templateName = candidates[0].name;
    }
    const selected = candidates.find((agent) => agent.name === this.deployDraft.templateName) || candidates[0];
    const picker = select('singleBot', candidates.map((agent) => ({
      value:agent.name,
      label:`${agent.name} · ${agent.in_game ? 'in game' : stateLabels[normalizeState(agent)]}`,
    })), selected.name);
    picker.addEventListener('change', () => {
      this.deployDraft.templateName = picker.value;
      this.render();
    });
    body.append(compactField('Configured bot', picker, 'Uses its saved provider, persona, and Minecraft connection.'));
    const preview = node('div', 'deploy-character-preview');
    preview.append(memberHead(selected.name, selected.in_game ? 'running' : normalizeState(selected)), node('div', '', selected.name));
    preview.lastChild.append(
      node('strong', '', selected.in_game ? 'Already in game' : 'Ready to deploy'),
      node('span', 'muted small', selected.in_game ? 'Open Bots to chat or inspect.' : 'Starts only this bot.'),
    );
    body.append(preview);
    if (selected.in_game) {
      body.append(
        button('Open Bot Controls', () => this.navigate('agents'), 'primary full-width'),
        this.actionButton(
          'Disconnect This Bot',
          `bot-stop:${selected.name}`,
          () => this.stopBot(selected.name),
          'danger full-width',
          `Disconnect ${selected.name} from Minecraft?`,
          'Disconnecting',
        ),
      );
    } else {
      const launch = this.actionButton(
        `Deploy ${selected.name}`,
        `agent-start:${selected.name}`,
        () => canStartAgent(selected)
          ? this.startAgent(selected)
          : { success:false, error:`${selected.name} cannot start from its current state.` },
        'primary full-width deploy-primary',
        '',
        'Deploying',
      );
      launch.disabled = launch.disabled || !canStartAgent(selected);
      body.append(launch);
    }
    return body;
  }

  groupDeploy(state) {
    const body = node('div', 'deploy-body');
    if (!state.templates.length) {
      body.append(
        node('div', 'deploy-empty', 'Create a reusable bot profile before cloning a custom group.'),
        button('Set Up a Bot', () => this.navigate('profiles'), 'primary full-width'),
      );
      return body;
    }
    const template = this.templateSelect(state, 'groupTemplate');
    const prefix = input('groupPrefix', 'text', this.deployDraft.prefix);
    prefix.maxLength = 12;
    prefix.placeholder = 'Squad_';
    prefix.addEventListener('input', () => {
      this.deployDraft.prefix = prefix.value;
    });
    body.append(
      compactField('Character / model template', template, 'Private provider settings remain on the server.'),
      compactField('Team name prefix', prefix, 'Creates names like Squad_1, Squad_2, and Squad_3.'),
    );

    const sizeControl = node('div', 'squad-size-control');
    const decrease = button('−', () => {
      this.deployDraft.size = Math.max(1, Number(this.deployDraft.size) - 1);
      this.render();
    }, 'size-step');
    decrease.setAttribute('aria-label', 'Remove one bot from the new squad');
    const count = node('div', 'squad-size-readout');
    count.append(node('strong', '', String(this.deployDraft.size)), node('span', '', 'bots'));
    const increase = button('+', () => {
      this.deployDraft.size = Math.min(12, Number(this.deployDraft.size) + 1);
      this.render();
    }, 'size-step');
    increase.setAttribute('aria-label', 'Add one bot to the new squad');
    sizeControl.append(decrease, count, increase);
    body.append(compactField('Squad size', sizeControl, '1–12 bots. Eight or more asks for confirmation.'));

    const presetRow = node('div', 'deploy-size-presets');
    [1, 3, 5, 8, 12].forEach((size) => {
      const preset = button(String(size), () => {
        this.deployDraft.size = size;
        this.render();
      }, 'compact');
      preset.setAttribute('aria-pressed', String(this.deployDraft.size === size));
      presetRow.append(preset);
    });
    body.append(presetRow);

    const stagger = select('groupStagger', [
      { value:'500', label:'Fast · 0.5 sec apart' },
      { value:'750', label:'Recommended · 0.75 sec' },
      { value:'1000', label:'Gentle · 1 sec apart' },
      { value:'2000', label:'Very gentle · 2 sec' },
    ], String(this.deployDraft.staggerMs));
    stagger.addEventListener('change', () => {
      this.deployDraft.staggerMs = Number(stagger.value);
    });
    body.append(compactField('Launch pacing', stagger, 'Staggering avoids connection and local-model spikes.'));
    body.append(this.actionButton(
      `Deploy ${this.deployDraft.size}-Bot Group`,
      'group-launch',
      () => {
        const spec = {
          templateName:this.deployDraft.templateName,
          prefix:this.deployDraft.prefix.trim(),
          size:Number(this.deployDraft.size),
          staggerMs:Number(this.deployDraft.staggerMs),
        };
        if (!SQUAD_PREFIX_PATTERN.test(spec.prefix)) {
          return { success:false, error:'Team prefix must be 2–12 letters, numbers, or underscores and begin with a letter.' };
        }
        return this.launchSquad(spec).then((result) => {
          if (result?.success && result.squad?.id) this.selectedSquadId = result.squad.id;
          return result;
        });
      },
      'primary full-width deploy-primary',
      '',
      'Deploying',
    ));
    return body;
  }

  scenarioDeploy(state) {
    const body = node('div', 'deploy-body');
    if (!state.scenarios.length || !state.templates.length) {
      body.append(
        node('div', 'deploy-empty', state.templates.length
          ? 'Saved squads are loading from the control center.'
          : 'Create one bot profile first; saved squads clone its provider and connection safely.'),
        button('Open Bot Setup', () => this.navigate('profiles'), 'primary full-width'),
      );
      return body;
    }
    const scenarioGrid = node('div', 'saved-squad-picker');
    state.scenarios.forEach((scenario) => {
      const choice = button('', () => {
        this.deployDraft.scenarioId = scenario.id;
        this.render();
      }, 'saved-squad-choice');
      choice.setAttribute('aria-pressed', String(this.deployDraft.scenarioId === scenario.id));
      choice.append(
        node('strong', '', scenario.label),
        node('span', '', `${scenario.size} bots · ${scenario.behavior}`),
      );
      scenarioGrid.append(choice);
    });
    body.append(scenarioGrid);
    const selectedScenario = state.scenarios.find((scenario) => scenario.id === this.deployDraft.scenarioId) || state.scenarios[0];
    const template = this.templateSelect(state, 'scenarioTemplateHome');
    const leader = input('scenarioLeaderHome', 'text', this.deployDraft.leader);
    leader.maxLength = 16;
    leader.placeholder = 'Your Minecraft name';
    leader.addEventListener('input', () => {
      this.deployDraft.leader = leader.value;
      this.commandDraft.leader = leader.value;
    });
    body.append(
      compactField('Character / model template', template),
      compactField('Player to follow', leader, 'The team forms around this Minecraft player.'),
    );
    const brief = node('div', 'scenario-brief');
    brief.append(
      node('strong', '', selectedScenario.label),
      node('span', '', selectedScenario.description),
      node('small', '', `${selectedScenario.formation} formation · ${selectedScenario.behavior} behavior`),
    );
    body.append(brief);
    body.append(this.actionButton(
      `Deploy ${selectedScenario.label}`,
      'scenario-launch',
      () => {
        const leaderName = this.deployDraft.leader.trim();
        if (!PLAYER_NAME_PATTERN.test(leaderName)) {
          return { success:false, error:'Enter your 3-16 character Minecraft player name.' };
        }
        return this.launchScenario(selectedScenario, {
          templateName:this.deployDraft.templateName,
          leader:leaderName,
          staggerMs:750,
        }).then((result) => {
          if (result?.success && result.squad?.id) this.selectedSquadId = result.squad.id;
          return result;
        });
      },
      'primary full-width deploy-primary',
      '',
      'Deploying',
    ));
    return body;
  }

  deployPanel(state) {
    const panel = node('section', 'control-column deploy-panel');
    panel.append(sectionHeading('Deploy', 'Choose exactly what joins the world', 'One bot, a custom-sized group, or a character-driven saved squad.'));
    panel.append(this.libraryQuickSpawn(state));
    panel.append(this.deployTabs());
    if (this.deployMode === 'single') panel.append(this.singleDeploy(state));
    if (this.deployMode === 'group') panel.append(this.groupDeploy(state));
    if (this.deployMode === 'scenario') panel.append(this.scenarioDeploy(state));
    const library = button('Manage Bot Library', () => this.navigate('profiles'), 'deploy-library-link');
    panel.append(library);
    return panel;
  }

  libraryQuickSpawn(state) {
    const panel = node('div', 'library-quick-spawn');
    const copy = node('div');
    copy.append(node('strong', '', 'Saved bot types'), node('span', 'muted small', 'Start a configured character without reopening setup.'));
    panel.append(copy);
    if (!state.libraryProfiles.length) {
      panel.append(button('Create Bot Type', () => this.navigate('profiles'), 'compact'));
      return panel;
    }
    const profiles = state.libraryProfiles.slice(0, 4);
    const actions = node('div', 'library-quick-spawn-actions');
    profiles.forEach((profile) => {
      const control = this.actionButton(
        `Spawn ${profile.name}`,
        `library-spawn:${profile.id}`,
        () => api(`/bot-library/${encodeURIComponent(profile.id)}/spawn`, { agentName: profile.agentName }),
        'compact',
        '',
        'Spawning',
      );
      control.title = `${profile.type || 'bot'} · ${profile.provider?.chatModel || 'model not selected'}`;
      actions.append(control);
    });
    if (state.libraryProfiles.length > profiles.length) {
      actions.append(button(`+${state.libraryProfiles.length - profiles.length} more`, () => this.navigate('profiles'), 'compact'));
    }
    panel.append(actions);
    return panel;
  }

  alertPanel(state) {
    const problems = Array.isArray(state.health?.problems) ? state.health.problems : [];
    const meaningful = problems.filter((problem) => !(
      state.minecraftReady && /registered but none are in-game/i.test(String(problem))
    ));
    if (!this.actionError && !meaningful.length) return null;
    const alert = node('section', 'control-room-alert');
    alert.append(node('strong', '', 'Needs attention'));
    const copy = [this.actionError, ...meaningful].filter(Boolean).slice(0, 3).map(errorText).join(' · ');
    alert.append(node('span', '', copy));
    alert.append(button('Open Activity', () => this.navigate('activity'), 'compact'));
    return alert;
  }

  render() {
    if (this.isActive && !this.isActive()) return;
    const state = this.deriveState();
    clear(this.root);
    this.root.append(this.titleBar(state), this.statusStrip(state));
    const alert = this.alertPanel(state);
    if (alert) this.root.append(alert);
    const grid = node('div', 'control-room-grid');
    grid.append(this.runtimePanel(state), this.teamsPanel(state), this.deployPanel(state));
    this.root.append(grid);
  }
}
