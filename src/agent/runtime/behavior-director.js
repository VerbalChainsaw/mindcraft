const MAX_DETAIL = 280;
const MAX_CODE = 80;
const PUBLIC_PHASES = new Set([
  'waiting',
  'suppressed',
  'acting',
  'recovering',
  'succeeded',
  'requested',
  'failed',
  'blocked',
  'interrupted',
  'cancelled',
]);

function boundedText(value, maximum = MAX_DETAIL) {
  if (typeof value !== 'string') return '';
  return value
    // eslint-disable-next-line no-control-regex -- Director telemetry must remain single-line and display-safe.
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function boundedTarget(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const target = {};
  for (const key of ['name', 'type', 'x', 'y', 'z', 'distance']) {
    if (typeof value[key] === 'string') target[key] = boundedText(value[key], 96);
    else if (Number.isFinite(value[key])) target[key] = value[key];
  }
  return Object.keys(target).length ? target : null;
}

export class BehaviorDirector {
  constructor(agent, { name = 'behavior' } = {}) {
    this.agent = agent;
    this.name = boundedText(name, 40) || 'behavior';
    this.inFlight = false;
    this.nextEligibleAt = 0;
    this.status = {
      phase: 'waiting',
      code: 'ready',
      target: null,
      detail: 'Waiting for an eligible behavior.',
      retryable: true,
    };
  }

  scheduleGate({ allowBusy = false, now = Date.now() } = {}) {
    const evaluatedAt = Number.isFinite(now) ? Number(now) : Date.now();
    const inFlight = this.inFlight === true;
    const cooldownActive = evaluatedAt < this.nextEligibleAt;
    const botAvailable = Boolean(this.agent?.bot?.entity);
    const held = this.agent?.isOperatorHeld?.() === true;
    const idle = this.agent?.isIdle?.() === true;
    const code = inFlight
      ? 'in_flight'
      : cooldownActive
        ? 'cooldown'
        : !botAvailable
          ? 'bot_unavailable'
          : held
            ? 'operator_held'
            : !allowBusy && !idle
              ? 'busy'
              : 'ready';
    return Object.freeze({
      allowed: code === 'ready',
      code,
      evaluatedAt,
      allowBusy: allowBusy === true,
      inFlight,
      cooldownActive,
      nextEligibleAt: cooldownActive ? this.nextEligibleAt : null,
      botAvailable,
      held,
      idle,
    });
  }

  canSchedule(options = {}) {
    return this.scheduleGate(options).allowed;
  }

  defer(reason, durationMs = 0) {
    const delay = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
    this.nextEligibleAt = Date.now() + delay;
    this.status = {
      phase: 'suppressed',
      code: 'deferred',
      target: null,
      detail: boundedText(reason) || 'Behavior is temporarily deferred.',
      retryable: true,
    };
  }

  begin(code, target = null, detail = '', { allowBusy = false } = {}) {
    if (!this.canSchedule({ allowBusy })) return false;
    this.inFlight = true;
    this.status = {
      phase: 'acting',
      code: boundedText(code, MAX_CODE) || 'acting',
      target: boundedTarget(target),
      detail: boundedText(detail),
      retryable: true,
    };
    return true;
  }

  finish(result = {}) {
    this.inFlight = false;
    const phase = boundedText(result.phase, 24);
    this.status = {
      phase: PUBLIC_PHASES.has(phase) ? phase : 'failed',
      code: boundedText(result.code, MAX_CODE) || 'unknown',
      target: boundedTarget(result.target),
      detail: boundedText(result.detail),
      retryable: result.retryable === true,
    };
  }

  fail(code, detail = '', retryable = false) {
    this.finish({
      phase: 'failed',
      code,
      detail,
      retryable,
    });
  }

  snapshot() {
    return {
      name: this.name,
      ...this.status,
      nextEligibleAt: this.nextEligibleAt > Date.now() ? this.nextEligibleAt : null,
    };
  }
}
