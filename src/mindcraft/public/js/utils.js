export const $ = (id, root = document) => root.getElementById(id);

export function node(tag, className, value) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (value !== undefined) el.textContent = String(value);
  return el;
}

export function button(label, action, className = '') {
  const el = node('button', className, label);
  el.type = 'button';
  if (action) {
    el.addEventListener('click', (event) => {
      try {
        const pending = action(event);
        if (pending && typeof pending.catch === 'function') {
          pending.catch((error) => reportActionError(error));
        }
      } catch (error) {
        reportActionError(error);
      }
    });
  }
  return el;
}

function reportActionError(error) {
  const message = errorText(error?.message || error || 'Dashboard action failed.');
  window.dispatchEvent(new CustomEvent('mindcraft-action-error', { detail: { message } }));
}

export function clear(el) { while (el?.firstChild) el.removeChild(el.firstChild); return el; }

export function gridField(labelText, input, hint = '') {
  const wrap = node('div', 'stack');
  const label = node('label', '', labelText);
  if (input.id) label.htmlFor = input.id;
  wrap.append(label, input);
  if (hint) wrap.append(node('div', 'muted small', hint));
  return wrap;
}

export function input(id, type = 'text', value = '') {
  const el = document.createElement('input');
  el.id = id; el.type = type; el.value = value ?? '';
  return el;
}

export function select(id, options, value) {
  const el = document.createElement('select'); el.id = id;
  options.forEach((item) => {
    const opt = document.createElement('option');
    opt.value = item.value ?? item; opt.textContent = item.label ?? item;
    el.appendChild(opt);
  });
  if (value !== undefined) el.value = value;
  return el;
}

export function formatTime(value = Date.now()) {
  try { return new Date(value).toLocaleTimeString(); } catch { return ''; }
}

function compactAge(ageMs) {
  if (!Number.isFinite(ageMs)) return 'unknown age';
  if (ageMs < 1500) return 'just now';
  const seconds = Math.max(1, Math.round(ageMs / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return `${minutes}m ago`;
}

export function telemetryFreshness(state, now = Date.now()) {
  const sampledAt = Number(state?._meta?.sampledAt);
  const ageMs = Number.isFinite(sampledAt) ? Math.max(0, now - sampledAt) : null;
  const transport = state?._meta?.transport;
  const transportStatus = typeof transport?.status === 'string' ? transport.status : '';
  const status = state?.error
    ? 'unavailable'
    : ['fresh', 'stale', 'backoff', 'unavailable'].includes(transportStatus)
      ? transportStatus
      : 'legacy';
  const age = compactAge(ageMs);
  let label;
  if (status === 'fresh') label = ageMs !== null && ageMs < 1500 ? 'Live now' : `Live sample · ${age}`;
  else if (status === 'stale') label = `Last verified ${age} · bridge delayed`;
  else if (status === 'backoff') label = `Last verified ${age} · retrying carefully`;
  else if (status === 'unavailable') label = 'Telemetry unavailable';
  else label = Number.isFinite(ageMs) ? `Sample ${age}` : 'Sample time unavailable';
  return {
    status,
    label,
    ageMs,
    stale: ['stale', 'backoff', 'unavailable'].includes(status),
    error: errorText(transport?.error || state?.error || ''),
  };
}

function compactIdentity(value, fallback = '') {
  const normalized = String(value || '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, 80);
  return normalized || fallback;
}

export function operatorControlLabel(action = {}) {
  if (Number.isFinite(action?.stopTimedOutAt)) return 'Stop needs recovery';
  if (Number.isFinite(action?.stopRequestedAt)) return 'Stopping current action';
  if (action?.held) return 'Held by operator';
  if (action?.isIdle) return 'Ready for a command';
  return 'Working';
}

export function attentionStatusLabel(attention = {}) {
  const state = String(attention?.state || '').toLowerCase();
  const noProgress = Number(attention?.noProgressCount);
  const maxNoProgress = Number(attention?.maxNoProgress);
  const budget = Number.isFinite(noProgress) && Number.isFinite(maxNoProgress) && maxNoProgress > 0
    ? ` · ${Math.max(0, noProgress)}/${maxNoProgress} no-progress turns`
    : '';

  if (attention?.operatorHeld || state === 'held') return 'Held — autonomous work paused';
  if (state === 'paused') return 'Goal paused for dialogue';
  if (state === 'working' || attention?.goalActive) {
    return `Goal active${attention?.processingTurn ? ' · choosing next step' : ''}${budget}`;
  }
  if (attention?.goalSaved) return 'Goal queued';
  return 'No autonomous goal';
}

export function dialogueStatusLabel(dialogue = {}) {
  if (dialogue?.muted) return 'Muted';
  if (dialogue?.inConversation) {
    const partner = compactIdentity(dialogue?.partner);
    return partner ? `Talking with ${partner}` : 'In conversation';
  }
  const lastSender = compactIdentity(dialogue?.lastSender);
  return lastSender ? `Open · last contact ${lastSender}` : 'Open to dialogue';
}

function readableCode(value, prefix = '') {
  return String(value || 'unknown')
    .replace(prefix, '')
    .replace(/_/g, ' ')
    .trim()
    .slice(0, 80);
}

export function behaviorStatusLabel(action = {}) {
  const sections = [];
  const survival = action?.survivalDirector;
  if (survival && typeof survival === 'object') {
    sections.push(`Survival ${readableCode(survival.phase)}: ${readableCode(survival.code)}`);
  }
  const job = action?.jobDirector;
  if (job && typeof job === 'object') {
    const order = job.workOrder;
    if (order && typeof order === 'object') {
      const role = readableCode(order.role);
      const title = role ? `${role[0].toUpperCase()}${role.slice(1)}` : 'Job';
      const progress = Number.isFinite(order.checkpoint?.verifiedCount)
        ? order.checkpoint.verifiedCount
        : Number.isFinite(order.checkpoint?.collected)
          ? order.checkpoint.collected
          : null;
      sections.push(`${title} ${readableCode(order.kind)}: ${readableCode(order.phase)}${progress === null ? '' : ` (${progress} verified)`}`);
    } else {
      sections.push(`Job ${readableCode(job.phase)}: ${readableCode(job.code, 'job_')}`);
    }
  }
  const reactions = action?.reactionDirector;
  if (reactions && typeof reactions === 'object') {
    const queued = Number.isFinite(reactions.queued) && reactions.queued > 0
      ? ` (${Math.min(256, reactions.queued)} queued)`
      : '';
    sections.push(`Reactions ${readableCode(reactions.code, 'reaction_')}${queued}`);
  }
  return (sections.join(' · ') || 'Behavior directors unavailable').slice(0, 240);
}

export function actionTargetLabel(result) {
  const target = result?.target;
  if (!target) return 'No verified target';
  if (typeof target === 'string') return compactIdentity(target, 'Verified target');
  if (typeof target !== 'object') return 'Verified target';
  const name = compactIdentity(target.name || target.id || target.kind || target.type, 'Verified target');
  const position = target.position && typeof target.position === 'object' ? target.position : target;
  const coordinates = [position?.x, position?.y, position?.z];
  if (coordinates.every(Number.isFinite)) return `${name} · x ${coordinates[0]}, y ${coordinates[1]}, z ${coordinates[2]}`;
  return name;
}

export function runtimeRecoveryMessage(action = {}) {
  if (Number.isFinite(action?.stopTimedOutAt)) {
    return 'Stop could not interrupt the current action. The bot remains held; restart only if it does not recover.';
  }
  if (Number.isFinite(action?.stopRequestedAt)) return 'Stop is waiting for the current action to yield.';
  return '';
}

export function normalizeState(agent) {
  const allowed = ['ready','blocked','starting','running','stopping','stopped','failed','restarting'];
  const state = String(agent?.state || '').toLowerCase();
  return allowed.includes(state) ? state : (agent?.in_game ? 'running' : 'ready');
}

export const stateLabels = {
  ready: 'Ready', blocked: 'Blocked', starting: 'Starting…', running: 'Running',
  stopping: 'Stopping…', stopped: 'Stopped', failed: 'Failed', restarting: 'Restarting…',
};

export function isCredentialReason(reason) {
  return /missing\s+(?:.+\s+)?credential|(?:api[ _-]?key|credential|token)\s+(?:is\s+)?(?:missing|not found|not configured|required)|(?:key|credential)\s+not found|no\s+(?:api[ _-]?)?key/i.test(String(reason || ''));
}

export function isNonRetryableReason(reason) {
  return /duplicate|already exists|non[- ]?retry|not retryable|unsupported|invalid profile|missing name|invalid config|invalid key|key[_ -]?env/i.test(String(reason || ''));
}

export function canRetryAgent(agent) {
  const state = normalizeState(agent); const reason = String(agent?.lastError || '');
  if (isNonRetryableReason(reason)) return false;
  if (agent?.retryable === false) return false;
  if (state === 'blocked') return isCredentialReason(reason);
  return state === 'failed' && (!reason || /spawn|launch|process|socket|connection|timeout|temporary|restart|signal|error|path|navigation|cancel/i.test(reason));
}

export function canStartAgent(agent) {
  const state = normalizeState(agent);
  if (agent?.in_game || agent?.socket_connected) return false;
  if (['starting', 'stopping', 'restarting'].includes(state)) return false;
  if (state === 'ready' || state === 'stopped') return true;
  return canRetryAgent(agent);
}

export function localServiceUrl(port) {
  const numericPort = Number(port);
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
    throw new TypeError('Local service port is invalid.');
  }
  const rawHostname = String(window.location.hostname || '').replace(/^\[|\]$/g, '');
  const hostname = rawHostname.includes(':') ? `[${rawHostname}]` : rawHostname;
  if (!hostname) throw new TypeError('Local service host is unavailable.');
  const url = new URL(`${window.location.protocol}//${hostname}:${numericPort}/`);
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('Local service protocol is invalid.');
  return url.href;
}

export function errorText(value) { return String(value || '').slice(0, 320); }
