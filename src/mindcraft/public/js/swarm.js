import { api } from './api.js';
import { button, clear, gridField, input, node } from './utils.js';

const MAX_COMMAND_LENGTH = 4096;

function elapsedLabel(value) {
  const age = Number.isFinite(Number(value)) ? Math.max(0, Date.now() - Number(value)) : null;
  if (age === null) return 'unknown age';
  if (age < 1_000) return 'just now';
  if (age < 60_000) return `${Math.round(age / 1_000)} sec ago`;
  return `${Math.round(age / 60_000)} min ago`;
}

function resultVerdict(result) {
  if (!result) return { text: 'No completed cycle yet', tone: 'muted' };
  if (result.timedOut) return { text: 'Last cycle timed out', tone: 'error-copy' };
  if (result.ok) return { text: `Last cycle succeeded${Number.isInteger(result.code) ? ` · exit ${result.code}` : ''}`, tone: 'success-copy' };
  if (result.skipped) return { text: 'Last cycle was skipped', tone: 'warning-copy' };
  const detail = String(result.error || '').slice(0, 180);
  return { text: `Last cycle failed${detail ? ` · ${detail}` : ''}`, tone: 'error-copy' };
}

function helperStatusClass(status) {
  return status === 'active' ? 'state-running' : status === 'error' ? 'state-failed' : 'state-stopped';
}

export class SwarmWorkspace {
  constructor(root, socket, activity) {
    this.root = root;
    this.socket = socket;
    this.activity = activity;
    this.helpers = [];
    socket.on('swarm-update', (list) => {
      this.helpers = Array.isArray(list) ? list : [];
      this.renderList();
    });
    socket.on('swarm-event', () => this.refresh());
  }

  mount() {
    clear(this.root);
    this.root.append(this.heading());
    const grid = node('div', 'grid-2 swarm-layout');
    grid.append(this.form(), this.listPanel());
    this.root.append(grid);
    this.refresh();
  }

  heading() {
    const heading = node('div', 'workspace-heading');
    const copy = node('div');
    copy.append(
      node('h1', '', 'Host Task Runners'),
      node('p', '', 'Run bounded local commands on this computer. These are not Minecraft bots or remote agents.'),
    );
    heading.append(copy);
    return heading;
  }

  form() {
    const card = node('section', 'panel swarm-deploy-panel');
    card.append(
      node('h2', '', 'Deploy a Local Helper'),
      node('p', 'warning-copy small', 'Advanced control: every command runs locally in the selected working directory. Mindcraft does not deploy this helper to another computer.'),
    );

    this.name = input('swarm-name', 'text', 'scout-1');
    this.name.maxLength = 64;
    this.command = document.createElement('textarea');
    this.command.id = 'swarm-command';
    this.command.maxLength = MAX_COMMAND_LENGTH;
    this.command.value = 'echo "[runner] scout-1 alive"';
    this.cwd = input('swarm-cwd', 'text', '.');
    this.cycle = input('swarm-cycle', 'number', '15000');
    this.cycle.min = '2000';
    this.cycle.step = '1000';
    this.heartbeat = input('swarm-heartbeat', 'number', '5000');
    this.heartbeat.min = '1000';
    this.heartbeat.step = '1000';

    const execution = node('div', 'swarm-local-scope');
    execution.append(
      node('strong', '', 'Execution scope: this computer only'),
      node('span', 'muted small', 'Remote execution is intentionally unavailable until there is a real transport and verification path.'),
    );

    const brainInfo = document.createElement('details');
    brainInfo.className = 'disclosure';
    const brainSummary = document.createElement('summary');
    brainSummary.textContent = 'About model-assisted helpers';
    brainInfo.append(
      brainSummary,
      node('p', 'muted small', 'This control center does not expose a model switch here because the current host-runner hook is advisory only; it does not make a model call or change the local command. Use Bots for Minecraft AI behavior.'),
    );

    const deploy = button('Deploy Local Helper', () => this.deploy(), 'primary');
    deploy.title = 'Start this local command on a bounded repeating cycle.';
    const cadence = node('div', 'grid-2');
    cadence.append(
      gridField('Cycle interval (ms)', this.cycle, 'How often the command is allowed to run.'),
      gridField('Liveness window (ms)', this.heartbeat, 'How quickly the watchdog flags missing successful cycles.'),
    );
    card.append(
      gridField('Name', this.name),
      gridField('Local command', this.command, 'Runs on this computer only. Keep secrets out of command text.'),
      gridField('Working directory', this.cwd, 'Relative paths resolve from the Mindcraft process; invalid paths report a failed cycle.'),
      execution,
      cadence,
      brainInfo,
      deploy,
    );
    return card;
  }

  listPanel() {
    this.listSection = node('section', 'panel swarm-list-panel');
    const heading = node('div', 'section-heading');
    const copy = node('div');
    copy.append(
      node('h2', '', 'Local Helpers'),
      node('p', 'muted small', 'A green status means the last completed local cycle succeeded. A manual heartbeat is labelled separately.'),
    );
    this.listCount = node('span', 'state-badge state-stopped', '0 active');
    heading.append(copy, this.listCount);
    this.list = node('div', 'agent-list');
    this.listSection.append(heading, this.list);
    return this.listSection;
  }

  async deploy() {
    const command = this.command.value.trim();
    if (!command) {
      this.activity?.add('SWARM', 'Enter a local command before deploying a helper.', 'err');
      this.command.focus();
      return;
    }
    if (command.length > MAX_COMMAND_LENGTH) {
      this.activity?.add('SWARM', `Local command exceeds the ${MAX_COMMAND_LENGTH}-character limit.`, 'err');
      this.command.focus();
      return;
    }
    const spec = {
      name: this.name.value.trim() || undefined,
      command,
      cwd: this.cwd.value.trim() || '.',
      location: 'in-process',
      cycleIntervalMs: Math.max(2_000, Number(this.cycle.value) || 15_000),
      heartbeatIntervalMs: Math.max(1_000, Number(this.heartbeat.value) || 5_000),
      brain: null,
    };
    const response = await api('/swarm/deploy', spec);
    this.activity?.add(
      'SWARM',
      response.success
        ? `Local helper ${response.helper?.name || spec.name || 'unnamed'} deployed. Wait for a completed cycle before treating it as healthy.`
        : `Local helper deployment failed: ${response.error}`,
      response.success ? 'ok' : 'err',
    );
    if (response.success) {
      this.name.value = '';
      await this.refresh();
    }
  }

  async refresh() {
    const response = await api('/swarm');
    if (!response.success) return;
    this.helpers = Array.isArray(response.helpers) ? response.helpers : [];
    this.renderList();
  }

  async markHeartbeat(helper) {
    const response = await api(`/swarm/pulse/${encodeURIComponent(helper.id)}`, {});
    this.activity?.add(
      'SWARM',
      response.success
        ? `${helper.name}: manual heartbeat recorded. This does not execute the command or prove it is healthy.`
        : `${helper.name}: unable to record a manual heartbeat: ${response.error}`,
      response.success ? 'ok' : 'err',
    );
    await this.refresh();
  }

  async relocate(helper) {
    const cwd = window.prompt(`Change ${helper.name}'s local working directory:`, helper.cwd || '.');
    if (cwd === null) return;
    const response = await api(`/swarm/relocate/${encodeURIComponent(helper.id)}`, { cwd });
    this.activity?.add(
      'SWARM',
      response.success ? `${helper.name}: local working directory changed.` : `${helper.name}: directory change failed: ${response.error}`,
      response.success ? 'ok' : 'err',
    );
    await this.refresh();
  }

  async recall(helper) {
    if (!window.confirm(`Recall local helper ${helper.name}? Its repeating command will stop.`)) return;
    const response = await api(`/swarm/recall/${encodeURIComponent(helper.id)}`, {});
    this.activity?.add(
      'SWARM',
      response.success ? `${helper.name}: local helper recalled and stopped.` : `${helper.name}: recall failed: ${response.error}`,
      response.success ? 'ok' : 'err',
    );
    await this.refresh();
  }

  renderList() {
    if (!this.list) return;
    clear(this.list);
    const active = this.helpers.filter((helper) => helper.status === 'active').length;
    if (this.listCount) {
      this.listCount.className = `state-badge ${active ? 'state-running' : 'state-stopped'}`;
      this.listCount.textContent = `${active} active`;
    }
    if (!this.helpers.length) {
      this.list.append(node('div', 'empty-state', 'No local helpers deployed. Deploy one only when you need host-side automation—not to control Minecraft bots.'));
      return;
    }
    this.helpers.forEach((helper) => {
      const item = node('article', 'summary-card swarm-helper-card');
      const top = node('div', 'agent-header');
      top.append(
        node('strong', '', helper.name),
        node('span', `state-badge ${helperStatusClass(helper.status)}`, helper.status || 'unknown'),
      );
      const verdict = resultVerdict(helper.lastResult);
      const proof = helper.lastBeatSource === 'manual-pulse'
        ? `Manual heartbeat ${elapsedLabel(helper.lastBeat)} — not a command result`
        : helper.lastBeatSource === 'successful-cycle'
          ? `Successful cycle ${elapsedLabel(helper.lastBeat)}`
          : `Started ${elapsedLabel(helper.lastBeat)} — no cycle proof yet`;
      item.append(
        top,
        node('div', 'summary-detail', 'Execution: local shell on this computer'),
        node('div', 'summary-detail', `Working directory: ${helper.cwd || 'unknown'}`),
        node('div', 'summary-detail', `Cycles: ${helper.cycleCount || 0}${helper.cycleInFlight ? ' · one running now' : ''}`),
        node('div', `summary-detail ${verdict.tone}`, verdict.text),
        node('div', 'summary-detail', `Liveness proof: ${proof}`),
      );
      if (helper.lastResultAt) item.append(node('div', 'muted small', `Last completed cycle ${elapsedLabel(helper.lastResultAt)}.`));
      if (helper.lastError) item.append(node('div', 'error-copy small', `Failure detail: ${String(helper.lastError).slice(0, 240)}`));

      const actions = node('div', 'actions');
      actions.append(
        button('Change Directory', () => this.relocate(helper)),
        button('Recall Helper', () => this.recall(helper), 'danger'),
      );
      const heartbeat = document.createElement('details');
      heartbeat.className = 'disclosure swarm-heartbeat-control';
      const summary = document.createElement('summary');
      summary.textContent = 'Advanced liveness override';
      heartbeat.append(
        summary,
        node('p', 'warning-copy small', 'Use only when you have independently verified the local helper is alive. This updates the watchdog timer; it does not run the command.'),
        button('Record Manual Heartbeat', () => this.markHeartbeat(helper)),
      );
      item.append(actions, heartbeat);
      this.list.append(item);
    });
  }
}
