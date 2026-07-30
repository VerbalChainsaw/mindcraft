import { api } from './api.js';
import { actionTargetLabel, attentionStatusLabel, behaviorStatusLabel, button, clear, dialogueStatusLabel, gridField, input, node, operatorControlLabel, runtimeRecoveryMessage, telemetryFreshness } from './utils.js';

const PLAYER_TARGET_MAX_LENGTH = 64;

function normalizePlayerTarget(value) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, PLAYER_TARGET_MAX_LENGTH);
}

function buildPlayerCommand(kind, value) {
  const player = normalizePlayerTarget(value);
  if (!player) return '';
  const encoded = JSON.stringify(player);
  return kind === 'follow'
    ? `!followPlayer(${encoded}, 3)`
    : `!goToPlayer(${encoded}, 2)`;
}

function roleDirectorStatusLabel(roleDirector = {}) {
  if (!roleDirector || typeof roleDirector !== 'object') return 'Role scheduler unavailable';
  const role = String(roleDirector.role || 'companion').replace(/_/g, ' ');
  const phase = String(roleDirector.phase || 'unknown').replace(/_/g, ' ');
  const code = String(roleDirector.code || 'unknown').replace(/^role_/, '').replace(/_/g, ' ');
  const target = roleDirector.target ? ` · ${String(roleDirector.target).slice(0, 64)}` : '';
  return `${role} · ${phase} · ${code}${target}`;
}

const QUICK_INSTRUCTIONS = [
  {
    label: 'Stop Movement',
    command: '!stop',
    title: 'Stop the bot’s current movement or action.',
  },
  {
    label: 'Read Situation',
    command: '!awareness',
    title: 'Report the bot’s position, movement, body clearance, held gear, nearby items, threats, hazards, resources, and reflex state.',
  },
  {
    label: 'Basic Status',
    command: '!stats',
    title: 'Report basic health, hunger, location, time, and activity.',
  },
  {
    label: 'Show Inventory',
    command: '!inventory',
    title: 'Ask the bot to list what it is carrying.',
  },
  {
    label: 'Scan Nearby Blocks',
    command: '!nearbyBlocks',
    title: 'Ask the bot to report blocks around it.',
  },
  {
    label: 'Follow selected player',
    playerAction: 'follow',
    title: 'Fill the instruction box with a command that follows the player selected above.',
  },
  {
    label: 'Go to selected player',
    playerAction: 'go',
    title: 'Fill the instruction box with a command that approaches the player selected above.',
  },
  {
    label: 'Enable Self Defense',
    command: '!setMode("self_defense", true)',
    title: 'Let the bot automatically fight nearby hostile creatures.',
  },
  {
    label: 'Gather Wood',
    command: '!collectWood(8)',
    title: 'Collect eight nearby logs using an appropriate tool when available.',
  },
  {
    label: 'Collect Nearby Items',
    command: '!setMode("item_collecting", true)',
    title: 'Enable the reflex that picks up nearby dropped items.',
  },
  {
    label: 'Scout Nearby',
    command: '!goal("Scout the nearby area, identify terrain, hazards, mobs, structures, and useful resources, then report what you find truthfully.")',
    title: 'Start an autonomous local scouting goal.',
  },
  {
    label: 'Show Character',
    command: '!persona',
    title: 'Report the bot’s active character and roleplay identity.',
  },
  {
    label: 'End Autonomous Goal',
    command: '!endGoal',
    title: 'Stop the bot’s current autonomous goal loop.',
  },
];

export class DirectorWorkspace {
  constructor(root, socket, activity, agents) {
    this.root = root;
    this.socket = socket;
    this.activity = activity;
    this.agents = agents;
    this.target = '';
    this.leashes = [];
    this.programs = [];
    this.events = [];
    this.states = {};
    this.playerTarget = '';
    this.pendingDeliveries = new Map();

    socket.on('agents-status', (list) => {
      this.agents = list || [];
      this.renderTarget();
    });
    socket.on('state-update', (states) => {
      this.states = states && typeof states === 'object' ? states : {};
      this.renderTargetTelemetry();
      this.renderLists();
    });
    socket.on('director-event', (event) => {
      const message = this.describeEvent(event);
      this.events.unshift({
        at: Date.now(),
        message,
        failed: event?.ok === false,
      });
      this.events = this.events.slice(0, 40);
      this.activity?.add('DIRECTOR', message, event?.ok === false ? 'err' : 'ok');
      this.renderEventLog();
      this.refresh();
    });
  }

  mount() {
    clear(this.root);
    this.root.classList.add('director-workspace');
    this.root.append(this.heading());

    const layout = node('div', 'director-layout');
    const controls = node('div', 'director-column');
    const status = node('div', 'director-column director-status-column');

    controls.append(
      this.targetCard(),
      this.commandCard(),
      this.leashCard(),
      this.programCard(),
    );

    this.leashEl = node('section', 'panel director-status-panel');
    this.programEl = node('section', 'panel director-status-panel');
    this.logEl = node('div', 'director-log');
    const activityCard = node('section', 'panel director-status-panel');
    activityCard.append(
      this.panelHeading(
        'Director Activity',
        'Recent instructions, repeats, and sequence changes.',
      ),
      this.logEl,
    );
    status.append(this.leashEl, this.programEl, activityCard);

    layout.append(controls, status);
    this.root.append(layout);
    this.renderEventLog();
    this.refresh();
  }

  heading() {
    const wrapper = node('div', 'workspace-heading');
    const text = node('div');
    text.append(
      node('h1', '', 'Director'),
      node(
        'p',
        '',
        'Control a bot once, keep an instruction running, or execute a command sequence.',
      ),
    );
    wrapper.append(text);
    return wrapper;
  }

  panelHeading(title, description) {
    const heading = node('div', 'director-panel-heading');
    heading.append(
      node('h2', '', title),
      node('p', 'muted small', description),
    );
    return heading;
  }

  targetCard() {
    const card = node('section', 'panel director-panel');
    card.append(
      this.panelHeading(
        'Choose a Bot',
        'Every instruction below is sent only to this bot.',
      ),
    );
    this.targetSelect = document.createElement('select');
    this.targetSelect.id = 'director-target';
    this.targetSelect.addEventListener('change', () => {
      this.target = this.targetSelect.value;
      this.renderTargetTelemetry();
    });
    this.targetHint = node('div', 'muted small director-target-hint');
    this.playerTargetInput = input('director-player-target', 'text', this.playerTarget);
    this.playerTargetInput.maxLength = PLAYER_TARGET_MAX_LENGTH;
    this.playerTargetInput.autocomplete = 'off';
    this.playerTargetInput.placeholder = 'Exact Minecraft player name';
    this.playerTargetInput.addEventListener('input', () => this.setPlayerTarget(this.playerTargetInput.value));
    this.playerTargetHint = node('div', 'muted small director-player-hint');
    this.playerSuggestions = node('div', 'director-player-suggestions');
    this.targetTelemetry = node('div', 'stack director-target-live');
    card.append(
      gridField('Bot to control', this.targetSelect),
      gridField(
        'Player to follow or meet',
        this.playerTargetInput,
        'Type the exact in-game name, or choose a suggestion from the selected bot’s latest game sample.',
      ),
      this.playerTargetHint,
      this.playerSuggestions,
      this.targetHint,
      this.targetTelemetry,
    );
    this.renderTarget();
    return card;
  }

  renderTarget() {
    if (!this.targetSelect) return;
    const current = this.target;
    clear(this.targetSelect);
    this.agents.forEach((agent) => {
      const option = document.createElement('option');
      option.value = agent.name;
      option.textContent = `${agent.name} ${agent.in_game ? '(in game)' : '(offline)'}`;
      this.targetSelect.append(option);
    });
    if (current && this.agents.some((agent) => agent.name === current)) {
      this.targetSelect.value = current;
    }
    this.target = this.targetSelect.value || '';
    this.targetHint.textContent = this.target
      ? `${this.agents.length} ${this.agents.length === 1 ? 'bot' : 'bots'} registered`
      : 'No bot selected. Start one from Bots.';
    this.renderTargetTelemetry();
  }

  setPlayerTarget(value) {
    this.playerTarget = normalizePlayerTarget(value);
    if (this.playerTargetInput) {
      if (this.playerTargetInput.value !== this.playerTarget) this.playerTargetInput.value = this.playerTarget;
      this.playerTargetInput.removeAttribute('aria-invalid');
    }
    this.renderPlayerSuggestions();
  }

  nearbyPlayerSuggestions() {
    const players = this.states[this.target]?.nearby?.humanPlayers;
    if (!Array.isArray(players)) return [];
    return [...new Set(players
      .map((player) => normalizePlayerTarget(player))
      .filter(Boolean))]
      .slice(0, 6);
  }

  renderPlayerSuggestions() {
    if (!this.playerTargetHint || !this.playerSuggestions) return;
    clear(this.playerSuggestions);
    if (!this.target) {
      this.playerTargetHint.textContent = 'Select a bot first, then type the player it should follow or meet.';
      return;
    }
    const suggestions = this.nearbyPlayerSuggestions();
    if (!suggestions.length) {
      this.playerTargetHint.textContent = 'No nearby-player suggestion is available yet. You can still enter an exact Minecraft name.';
      return;
    }
    this.playerTargetHint.textContent = `Suggestions from ${this.target}'s latest game sample. Selecting one only fills the target; it does not prove the player is reachable.`;
    suggestions.forEach((player) => {
      const suggestion = button(player, () => this.setPlayerTarget(player), 'director-player-suggestion');
      suggestion.title = `Use ${player} as the player target.`;
      suggestion.setAttribute('aria-pressed', String(this.playerTarget === player));
      this.playerSuggestions.append(suggestion);
    });
  }

  commandForSelectedPlayer(kind) {
    const command = buildPlayerCommand(kind, this.playerTarget);
    if (command) return command;
    const message = 'Choose or enter the Minecraft player this bot should follow or meet first.';
    if (this.playerTargetHint) this.playerTargetHint.textContent = message;
    if (this.playerTargetInput) {
      this.playerTargetInput.setAttribute('aria-invalid', 'true');
      this.playerTargetInput.focus();
    }
    this.activity?.add('DIRECTOR', message, 'err');
    return '';
  }

  renderTargetTelemetry() {
    if (!this.targetTelemetry) return;
    this.renderPlayerSuggestions();
    clear(this.targetTelemetry);
    if (!this.target) {
      this.targetTelemetry.append(node('div', 'muted small', 'Choose a bot to see its live game readout.'));
      return;
    }
    const state = this.states[this.target];
    if (!state || state.error) {
      this.targetTelemetry.append(node('div', 'muted small', state?.error
        ? `Live telemetry unavailable: ${state.error}`
        : 'Waiting for a live game sample. Delivery acknowledgement is not action completion.'));
      return;
    }
    const action = state.action || {};
    const attention = state.attention || {};
    const dialogue = state.dialogue || {};
    const gameplay = state.gameplay || {};
    const result = action.lastResult;
    const roleDirector = action.roleDirector;
    const position = gameplay.position;
    const values = [
      ['Live action', action.current || 'Unknown'],
      ['Behavior', behaviorStatusLabel(action)],
      ['Role scheduler', roleDirectorStatusLabel(roleDirector)],
      ['Control', operatorControlLabel(action)],
      ['Attention', attentionStatusLabel(attention)],
      ['Dialogue', dialogueStatusLabel(dialogue)],
      ['Position', position && [position.x, position.y, position.z].every(Number.isFinite)
        ? `x ${position.x}, y ${position.y}, z ${position.z}`
        : 'Unavailable'],
      ['Health', Number.isFinite(gameplay.health) ? `${gameplay.health}/${gameplay.healthMax || 20}` : 'Unavailable'],
      ['Last verified result', result
        ? `${String(result.phase || 'unknown').replace(/_/g, ' ')} · ${String(result.code || 'unknown').replace(/_/g, ' ')}`
        : 'No completed action yet'],
      ['Verified target', actionTargetLabel(result)],
    ];
    const grid = node('div', 'telemetry-grid');
    values.forEach(([label, value]) => {
      const item = node('div', 'telemetry');
      item.append(node('div', 'telemetry-label', label), node('div', 'telemetry-value', value));
      grid.append(item);
    });
    this.targetTelemetry.append(grid);
    const recoveryMessage = runtimeRecoveryMessage(action);
    if (recoveryMessage) this.targetTelemetry.append(node('div', 'warning-copy small', recoveryMessage));
    const deliveredAt = this.pendingDeliveries.get(this.target);
    if (deliveredAt) {
      const resultAfterDelivery = Number.isFinite(result?.finishedAt) && result.finishedAt >= deliveredAt;
      this.targetTelemetry.append(node(
        'div',
        'muted small',
        resultAfterDelivery
          ? 'A bot action result arrived after Director accepted the delivery. Inspect its verified outcome below; delivery itself was not completion.'
          : 'Director accepted the delivery. Waiting for the bot to report a verified action result.',
      ));
    }
    if (result?.detail) {
      this.targetTelemetry.append(node('div', 'muted small', `Result detail: ${String(result.detail).slice(0, 280)}`));
    }
  }

  commandCard() {
    const card = node('section', 'panel director-panel');
    card.append(
      this.panelHeading(
        'Send a One-Time Instruction',
        'Send one action command or one chat message, then stop.',
      ),
    );

    this.command = input('director-command');
    this.command.placeholder = 'Type a chat message or choose a quick action below';

    const quickLabel = node('div', 'director-field-label', 'Quick actions');
    const quickActions = node('div', 'director-command-presets');
    QUICK_INSTRUCTIONS.forEach((instruction) => {
      const control = button(instruction.label, () => {
        const command = instruction.playerAction
          ? this.commandForSelectedPlayer(instruction.playerAction)
          : instruction.command;
        if (!command) return;
        this.command.value = command;
        this.command.focus();
      }, 'director-preset');
      control.title = instruction.title;
      control.setAttribute('aria-label', `${instruction.label}. ${instruction.title}`);
      quickActions.append(control);
    });

    const send = button('Send Once', async () => {
      const response = await api('/api/director/command', {
        agent: this.target,
        message: this.command.value.trim(),
      });
      if (response.success) {
        this.pendingDeliveries.set(this.target, Date.now());
        this.renderTargetTelemetry();
      }
      this.activity?.add(
        'DIRECTOR',
        response.success
          ? `One-time instruction delivery accepted for ${this.target}; awaiting a verified bot result.`
          : `Instruction failed: ${response.error}`,
        response.success ? 'ok' : 'err',
      );
    }, 'primary');
    send.title = 'Send the instruction once to the selected bot.';

    const actionBar = node('div', 'director-action-bar');
    actionBar.append(send);
    card.append(
      gridField('Instruction or chat message', this.command),
      quickLabel,
      quickActions,
      actionBar,
    );
    return card;
  }

  leashCard() {
    const card = node('section', 'panel director-panel');
    card.append(
      this.panelHeading(
        'Repeat an Instruction',
        'Keep sending the same instruction until you stop it.',
      ),
    );

    this.leashMessage = input('leash-message', 'text', '');
    this.leashMessage.placeholder = 'Type an instruction, or use the selected-player follow helper';
    this.leashInterval = input('leash-interval', 'number', '20');
    this.leashInterval.min = '2';
    this.leashInterval.step = '1';

    const start = button('Start Repeating', async () => {
      const seconds = Math.max(2, Number(this.leashInterval.value) || 20);
      const response = await api('/api/director/leash', {
        agent: this.target,
        message: this.leashMessage.value.trim(),
        intervalMs: Math.round(seconds * 1000),
      });
      this.activity?.add(
        'DIRECTOR',
        response.success
          ? `Repeating instruction configured for ${this.target}; each delivery is separate from bot completion.`
          : `Repeating instruction failed: ${response.error}`,
        response.success ? 'ok' : 'err',
      );
      this.refresh();
    }, 'primary');
    start.title = 'Start repeating this instruction for the selected bot.';

    const stop = button('Stop Repeating', async () => {
      const response = await api('/api/director/unleash', {
        agent: this.target,
      });
      this.activity?.add(
        'DIRECTOR',
        response.success
          ? `Repeating instruction stopped for ${this.target}.`
          : `Nothing was stopped: ${response.error}`,
        response.success ? 'ok' : 'err',
      );
      this.refresh();
    }, 'danger');
    stop.title = 'Stop the repeating instruction on the selected bot.';

    const actionBar = node('div', 'director-action-bar');
    actionBar.append(stop, start);
    const playerTemplate = button('Use Follow Target', () => {
      const command = this.commandForSelectedPlayer('follow');
      if (!command) return;
      this.leashMessage.value = command;
      this.leashMessage.focus();
    }, 'compact');
    playerTemplate.title = 'Fill the repeating instruction with a follow command for the selected player.';
    const templateActions = node('div', 'director-template-actions');
    templateActions.append(playerTemplate, node('span', 'muted small', 'Uses the player target above.'));
    card.append(
      gridField(
        'Instruction to repeat',
        this.leashMessage,
        'Example: keep following a player or repeatedly scan the area.',
      ),
      templateActions,
      gridField(
        'Repeat interval (seconds)',
        this.leashInterval,
        'The instruction will run immediately, then repeat at this interval.',
      ),
      actionBar,
    );
    return card;
  }

  programCard() {
    const card = node('section', 'panel director-panel');
    card.append(
      this.panelHeading(
        'Run a Command Sequence',
        'Execute several instructions in order as one named sequence.',
      ),
    );

    this.programName = input('program-name', 'text', 'patrol-1');
    const steps = document.createElement('textarea');
    steps.id = 'program-steps';
    steps.value = [
      '!goToCoordinates(0, 64, 0, 2) | 15000',
      '!collectBlocks("oak_log", 4) | 20000',
    ].join('\n');
    const loop = input('program-loop', 'checkbox');

    const start = button('Start Sequence', async () => {
      const parsed = steps.value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [message, delay] = line.split('|').map((part) => part.trim());
          return { message, delayMs: Number(delay) || 5000 };
        });
      const response = await api('/api/director/program', {
        agent: this.target,
        name: this.programName.value.trim(),
        steps: parsed,
        loop: loop.checked,
      });
      this.activity?.add(
        'DIRECTOR',
        response.success
          ? `Sequence ${this.programName.value} accepted; step delivery does not prove in-game completion.`
          : `Sequence failed: ${response.error}`,
        response.success ? 'ok' : 'err',
      );
      this.refresh();
    }, 'primary');
    start.title = 'Start this command sequence on the selected bot.';

    const loopLabel = node('label', 'director-toggle');
    loopLabel.append(
      loop,
      node('span', '', 'Repeat the whole sequence until stopped'),
    );
    const actionBar = node('div', 'director-action-bar');
    actionBar.append(start);
    const playerTemplate = button('Add Return to Player', () => {
      const command = this.commandForSelectedPlayer('go');
      if (!command) return;
      const step = `${command} | 10000`;
      steps.value = steps.value.trim() ? `${steps.value.trim()}\n${step}` : step;
      steps.focus();
    }, 'compact');
    playerTemplate.title = 'Append a return-to-player step using the selected player target.';
    const templateActions = node('div', 'director-template-actions');
    templateActions.append(playerTemplate, node('span', 'muted small', 'Adds a safe, quoted player name to this sequence.'));
    card.append(
      gridField('Sequence name', this.programName),
      gridField(
        'Instructions and delays',
        steps,
        'Use one line per instruction: command | delay in milliseconds.',
      ),
      templateActions,
      loopLabel,
      actionBar,
    );
    return card;
  }

  async refresh() {
    const [programs, leashes] = await Promise.all([
      api('/api/director/programs'),
      api('/api/director/leashes'),
    ]);
    if (programs.success) this.programs = programs.programs || [];
    if (leashes.success) this.leashes = leashes.leashes || [];
    this.renderLists();
  }

  operationReadout(agentName) {
    const readout = node('div', 'director-operation-readout');
    readout.append(node('span', 'director-operation-label', 'Live game state'));
    const state = this.states[agentName];
    if (!state || state.error) {
      readout.append(node('div', 'muted small', state?.error
        ? `Telemetry unavailable: ${state.error}`
        : 'Waiting for a live game sample. Delivery scheduling is not game completion.'));
      return readout;
    }
    const action = state.action || {};
    const attention = state.attention || {};
    const dialogue = state.dialogue || {};
    const gameplay = state.gameplay || {};
    const result = action.lastResult;
    const roleDirector = action.roleDirector;
    const position = gameplay.position;
    const freshness = telemetryFreshness(state);
    const positionText = position && [position.x, position.y, position.z].every(Number.isFinite)
      ? `x ${position.x}, y ${position.y}, z ${position.z}`
      : 'Position unavailable';
    const resultText = result
      ? `${String(result.phase || 'unknown').replace(/_/g, ' ')} · ${String(result.code || 'unknown').replace(/_/g, ' ')}`
      : 'No completed action yet';
    const values = node('div', 'director-operation-values');
    [
      ['Now', action.current || 'Action unknown'],
      ['Behavior', behaviorStatusLabel(action)],
      ['Role scheduler', roleDirectorStatusLabel(roleDirector)],
      ['Control', operatorControlLabel(action)],
      ['Attention', attentionStatusLabel(attention)],
      ['Dialogue', dialogueStatusLabel(dialogue)],
      ['Where', positionText],
      ['Last result', resultText],
      ['Verified target', actionTargetLabel(result)],
      ['Telemetry', freshness.label],
    ].forEach(([label, value]) => {
      const valueEl = node('div', 'director-operation-value');
      valueEl.append(node('span', '', label), node('strong', '', value));
      values.append(valueEl);
    });
    readout.append(values);
    const recoveryMessage = runtimeRecoveryMessage(action);
    if (recoveryMessage) readout.append(node('div', 'warning-copy small', recoveryMessage));
    return readout;
  }

  renderLists() {
    if (!this.leashEl) return;

    clear(this.leashEl);
    this.leashEl.append(
      this.panelHeading(
        'Repeating Instructions',
        'Instructions currently being re-sent automatically.',
      ),
    );
    if (!this.leashes.length) {
      this.leashEl.append(
        node('div', 'empty-state compact', 'No repeating instructions running.'),
      );
    }
    this.leashes.forEach((leash) => {
      const item = node('div', 'summary-card director-summary-card');
      const stop = button('Stop Repeating', async () => {
        await api('/api/director/unleash', { agent: leash.agentName });
        this.refresh();
      }, 'danger');
      stop.title = `Stop the repeating instruction on ${leash.agentName}.`;
      const actions = node('div', 'director-list-actions');
      actions.append(stop);
      item.append(
        node('strong', '', leash.agentName),
        node('div', 'summary-detail', leash.message),
        node(
          'div',
          'summary-detail',
          `Every ${Math.round(leash.intervalMs / 1000)} seconds · delivery attempted ${leash.issued} times · ${leash.lastOk ? 'last delivery accepted' : 'waiting for delivery status'}`,
        ),
        this.operationReadout(leash.agentName),
        actions,
      );
      this.leashEl.append(item);
    });

    clear(this.programEl);
    this.programEl.append(
      this.panelHeading(
        'Command Sequences',
        'Named multi-step instruction sets and their progress.',
      ),
    );
    if (!this.programs.length) {
      this.programEl.append(
        node('div', 'empty-state compact', 'No command sequences running.'),
      );
    }
    this.programs.forEach((program) => {
      const item = node('div', 'summary-card director-summary-card');
      item.append(
        node('strong', '', `${program.name} · ${program.status}`),
        node(
          'div',
          'summary-detail',
          `${program.agentName} · step ${Math.min(program.index, program.totalSteps)}/${program.totalSteps}${program.loop ? ' · repeats' : ''}${program.lastError ? ` · ${program.lastError}` : ''}`,
        ),
        this.operationReadout(program.agentName),
      );
      if (program.status === 'running') {
        const stop = button('Stop Sequence', async () => {
          await api('/api/director/program/stop', { id: program.id });
          this.refresh();
        }, 'danger');
        stop.title = `Stop the ${program.name} command sequence.`;
        const actions = node('div', 'director-list-actions');
        actions.append(stop);
        item.append(actions);
      }
      this.programEl.append(item);
    });
  }

  describeEvent(event = {}) {
    const agent = event.agentName
      || event.leash?.agentName
      || event.program?.agentName
      || 'Bot';
    const sequence = event.program?.name || 'Command sequence';
    const descriptions = {
      command: `${agent}: one-time instruction delivery ${event.ok === false ? 'failed' : 'accepted'}.`,
      attach: `${agent}: repeating instruction configured.`,
      tick: `${agent}: repeating instruction delivery accepted.`,
      release: `${agent}: repeating instruction stopped.`,
      start: `${agent}: ${sequence} scheduling started.`,
      step: `${agent}: ${sequence} delivery advanced to the next step.`,
      done: `${agent}: ${sequence} delivery sequence finished.`,
      stop: 'Command sequence stopped.',
    };
    return descriptions[event.type] || `${agent}: Director state updated.`;
  }

  renderEventLog() {
    if (!this.logEl) return;
    clear(this.logEl);
    if (!this.events.length) {
      this.logEl.append(
        node('div', 'empty-state compact', 'Director activity will appear here.'),
      );
      return;
    }
    this.events.forEach((event) => {
      const entry = node('div', `log-entry${event.failed ? ' error-copy' : ''}`);
      entry.append(
        node('div', 'log-meta', new Date(event.at).toLocaleTimeString()),
        node('div', '', event.message),
      );
      this.logEl.append(entry);
    });
  }
}
