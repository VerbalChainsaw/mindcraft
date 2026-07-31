import { api, optionalApi } from './api.js';
import { button, clear, errorText, node } from './utils.js';

// Before this existed the only way to send a command was the chat box on the
// focused bot, which meant knowing all 116 command names and their exact
// argument syntax by heart. This renders the real registry, builds the syntax
// for you, and shows what came back.

const MAX_HISTORY = 25;
const QUOTED_TYPES = new Set(['string', 'BlockName', 'ItemName', 'BlockOrItemName']);

function formatArgument(param, raw) {
  const value = String(raw ?? '').trim();
  if (param.type === 'boolean') return value === 'true' ? 'true' : 'false';
  if (param.type === 'int' || param.type === 'float') {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${param.name} must be a number.`);
    return param.type === 'int' ? String(Math.trunc(number)) : String(number);
  }
  if (value.includes('"')) throw new Error(`${param.name} cannot contain a double quote.`);
  return `"${value}"`;
}

/** Build valid command syntax, or explain exactly which field is wrong. */
export function buildCommand(command, values) {
  if (!command) throw new Error('Pick a command first.');
  const params = command.params || [];
  if (!params.length) return command.name;
  const args = params.map((param) => {
    const raw = values[param.name];
    if (raw === undefined || String(raw).trim() === '') {
      throw new Error(`${param.name} is required.`);
    }
    return formatArgument(param, raw);
  });
  return `${command.name}(${args.join(', ')})`;
}

function domainHint(param) {
  if (!Array.isArray(param.domain) || param.domain.length < 2) return '';
  const [low, high] = param.domain;
  if (typeof low === 'number' && typeof high === 'number') return ` (${low}–${high})`;
  return '';
}

export class ConsoleWorkspace {
  constructor(root, { activity = null, announce = null, getAgents = () => [] } = {}) {
    this.root = root;
    this.activity = activity;
    this.announce = announce;
    this.getAgents = getAgents;
    this.commands = [];
    this.loadError = '';
    this.filter = '';
    this.selected = null;
    this.values = {};
    this.target = '';
    this.history = [];
    this.busy = false;
  }

  async load() {
    const response = await optionalApi('/commands');
    if (response?.success && Array.isArray(response.commands)) {
      this.commands = response.commands;
      this.loadError = '';
    } else {
      this.commands = [];
      this.loadError = errorText(response?.error || 'The command list could not be loaded.');
    }
    this.render();
  }

  mount() {
    this.render();
    if (!this.commands.length && !this.loadError) void this.load();
  }

  matching() {
    const needle = this.filter.trim().toLowerCase();
    if (!needle) return this.commands;
    return this.commands.filter((command) => (
      command.name.toLowerCase().includes(needle)
      || command.category.toLowerCase().includes(needle)
      || command.description.toLowerCase().includes(needle)
    ));
  }

  select(command) {
    this.selected = command;
    this.values = {};
    this.render();
  }

  async send() {
    if (this.busy) return;
    let text;
    try {
      text = buildCommand(this.selected, this.values);
    } catch (error) {
      this.record(this.selected?.name || 'command', '', false, error.message);
      this.render();
      return;
    }
    const targets = this.target
      ? [this.target]
      : this.getAgents().map((agent) => agent.name);
    if (!targets.length) {
      this.record(text, '', false, 'No bot is available to receive this command.');
      this.render();
      return;
    }

    this.busy = true;
    this.render();
    for (const name of targets) {
      let response;
      try {
        response = await api('/director/command', { agent: name, message: text });
      } catch (error) {
        response = { success: false, error: errorText(error?.message || error) };
      }
      const ok = response?.success === true;
      this.record(text, name, ok, ok ? '' : errorText(response?.error || 'The command was rejected.'));
      this.activity?.add('COMMAND', `${name}: ${text}${ok ? '' : ` — ${errorText(response?.error)}`}`, ok ? 'ok' : 'err');
    }
    this.announce?.(`Sent ${text} to ${targets.length} bot${targets.length === 1 ? '' : 's'}.`);
    this.busy = false;
    this.render();
  }

  record(command, target, ok, detail) {
    this.history.unshift({ command, target, ok, detail, at: Date.now() });
    this.history = this.history.slice(0, MAX_HISTORY);
  }

  palettePanel() {
    const panel = node('section', 'panel console-palette');
    panel.append(node('h3', '', 'Commands'));

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'console-search';
    search.placeholder = `Search ${this.commands.length} commands`;
    search.value = this.filter;
    search.addEventListener('input', () => {
      this.filter = search.value;
      this.renderList();
    });
    panel.append(search);

    if (this.loadError) {
      const failure = node('div', 'empty-state', this.loadError);
      failure.append(button('Try again', () => this.load(), 'primary'));
      panel.append(failure);
      return panel;
    }

    this.listEl = node('div', 'console-list');
    panel.append(this.listEl);
    this.renderList();
    return panel;
  }

  renderList() {
    if (!this.listEl) return;
    clear(this.listEl);
    const matches = this.matching();
    if (!matches.length) {
      this.listEl.append(node('div', 'empty-state compact', 'No command matches that search.'));
      return;
    }
    let category = '';
    for (const command of matches) {
      if (command.category !== category) {
        category = command.category;
        this.listEl.append(node('div', 'console-category', category));
      }
      const entry = button(command.name, () => this.select(command), 'console-command');
      if (this.selected?.name === command.name) entry.classList.add('selected');
      entry.title = command.description;
      this.listEl.append(entry);
    }
  }

  formPanel() {
    const panel = node('section', 'panel console-form');
    if (!this.selected) {
      panel.append(node('h3', '', 'No command selected'));
      panel.append(node('div', 'empty-state compact', 'Pick a command on the left. The form builds the exact syntax for you.'));
      return panel;
    }
    panel.append(node('h3', '', this.selected.name));
    panel.append(node('div', 'summary-detail', this.selected.description));

    const agents = this.getAgents();
    const targetRow = node('div', 'console-field');
    targetRow.append(node('label', 'telemetry-label', 'Send to'));
    const targetSelect = document.createElement('select');
    const everyone = document.createElement('option');
    everyone.value = '';
    everyone.textContent = agents.length ? `Every bot (${agents.length})` : 'No bots connected';
    targetSelect.append(everyone);
    for (const agent of agents) {
      const option = document.createElement('option');
      option.value = agent.name;
      option.textContent = agent.name;
      if (this.target === agent.name) option.selected = true;
      targetSelect.append(option);
    }
    targetSelect.addEventListener('change', () => { this.target = targetSelect.value; this.renderPreview(); });
    targetRow.append(targetSelect);
    panel.append(targetRow);

    for (const param of this.selected.params || []) {
      const field = node('div', 'console-field');
      field.append(node('label', 'telemetry-label', `${param.name}${domainHint(param)}`));
      const control = document.createElement('input');
      control.type = param.type === 'int' || param.type === 'float' ? 'number' : 'text';
      control.value = this.values[param.name] ?? '';
      control.placeholder = param.description || param.type;
      control.addEventListener('input', () => { this.values[param.name] = control.value; this.renderPreview(); });
      field.append(control);
      if (param.description) field.append(node('div', 'summary-detail', param.description));
      panel.append(field);
    }

    this.previewEl = node('div', 'console-preview');
    panel.append(this.previewEl);
    this.renderPreview();

    const actions = node('div', 'panel-actions');
    const sendButton = button(this.busy ? 'Sending…' : 'Send command', () => this.send(), 'primary');
    if (this.busy) sendButton.disabled = true;
    actions.append(sendButton, button('Clear fields', () => { this.values = {}; this.render(); }));
    panel.append(actions);
    return panel;
  }

  renderPreview() {
    if (!this.previewEl) return;
    clear(this.previewEl);
    try {
      const text = buildCommand(this.selected, this.values);
      this.previewEl.append(node('code', '', text));
      this.previewEl.append(node('div', 'summary-detail', 'This is exactly what the bot receives. You can also type it in game chat.'));
    } catch (error) {
      this.previewEl.append(node('div', 'warning-copy small', error.message));
    }
  }

  historyPanel() {
    const panel = node('section', 'panel console-history');
    panel.append(node('h3', '', 'Recent commands'));
    if (!this.history.length) {
      panel.append(node('div', 'empty-state compact', 'Nothing sent yet this session.'));
      return panel;
    }
    for (const entry of this.history) {
      const row = node('div', `console-history-row ${entry.ok ? 'ok-copy' : 'error-copy'}`);
      row.append(node('code', '', entry.command));
      row.append(node('span', 'summary-detail', entry.target ? ` → ${entry.target}` : ' → all bots'));
      if (entry.detail) row.append(node('div', 'summary-detail', entry.detail));
      if (entry.ok) {
        row.append(button('Send again', () => {
          this.target = entry.target || '';
          void api('/director/command', { agent: entry.target, message: entry.command })
            .then((response) => {
              this.record(entry.command, entry.target, response?.success === true, response?.success ? '' : errorText(response?.error));
              this.render();
            });
        }, 'ghost'));
      }
      panel.append(row);
    }
    return panel;
  }

  render() {
    clear(this.root);
    const heading = node('div', 'workspace-heading');
    heading.append(node('h2', '', 'Console'));
    heading.append(node('div', 'summary-detail', 'Every command the bots understand. The same text works in game chat.'));
    this.root.append(heading);

    const layout = node('div', 'console-layout');
    layout.append(this.palettePanel(), this.formPanel());
    this.root.append(layout);
    this.root.append(this.historyPanel());
  }
}
