import { clear, formatTime, node } from './utils.js';

export const ACTIVITY_FILTERS = Object.freeze([
  { id: 'all', label: 'All activity' },
  { id: 'bot', label: 'Verified bot outcomes' },
  { id: 'control', label: 'Delivery & control' },
  { id: 'attention', label: 'Needs attention' },
]);

function normalizedText(value) {
  return String(value || '').trim().toLowerCase();
}

export function isAttentionEntry(entry) {
  return ['err', 'warning', 'warn'].includes(String(entry?.tone || '').toLowerCase());
}

function matchesFilter(entry, filter) {
  switch (filter) {
    case 'bot': return entry.source === 'BOT';
    case 'control': return ['DIRECTOR', 'SYSTEM', 'SWARM'].includes(entry.source);
    case 'attention': return isAttentionEntry(entry);
    default: return true;
  }
}

export class ActivityLog {
  constructor(limit = 250) { this.limit = limit; this.entries = []; this.listeners = new Set(); }
  add(source, message, tone = '') {
    const entry = { at: Date.now(), source: String(source || 'SYSTEM'), message: String(message || ''), tone };
    this.entries.unshift(entry); this.entries = this.entries.slice(0, this.limit);
    this.listeners.forEach((listener) => listener(entry, this.entries));
  }
  clear() {
    if (!this.entries.length) return;
    this.entries = [];
    this.listeners.forEach((listener) => listener(null, this.entries));
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  getEntries({ filter = 'all', query = '' } = {}) {
    const needle = normalizedText(query);
    return this.entries.filter((entry) => {
      if (!matchesFilter(entry, filter)) return false;
      if (!needle) return true;
      return normalizedText(`${entry.source} ${entry.message}`).includes(needle);
    });
  }
  summary(options = {}) {
    const visible = this.getEntries(options);
    return {
      total: this.entries.length,
      visible: visible.length,
      botOutcomes: this.entries.filter((entry) => entry.source === 'BOT').length,
      attention: this.entries.filter(isAttentionEntry).length,
    };
  }
  render(container, options = {}) {
    clear(container);
    if (!this.entries.length) {
      container.append(node('div', 'empty-state', 'No activity yet. Start a bot or use a control to build this browser-local timeline.'));
      return;
    }
    const entries = this.getEntries(options);
    if (!entries.length) {
      container.append(node('div', 'empty-state', 'No timeline entries match this view. Adjust the filters or search phrase.'));
      return;
    }
    entries.forEach((entry) => {
      const row = node('div', `console-entry ${entry.tone}`);
      row.dataset.source = entry.source;
      const meta = node('span', 'log-meta', `${formatTime(entry.at)} `);
      const source = node('span', 'source', `[${entry.source}] `);
      row.append(meta, source, node('span', '', entry.message)); container.append(row);
    });
  }
}
