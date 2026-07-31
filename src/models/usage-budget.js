// Nothing in this project ever capped model spend. Per-bot chat limits exist,
// but a squad of self-prompting bots left running overnight had no ceiling at
// all, and routing greetings and sightings through the model made that worse.
//
// The important design choice is what happens when the budget runs out: the
// bot keeps playing. Survival, jobs, goals, the agenda, progression, and every
// reflex are deterministic and need no model at all. Exhausting the budget
// stops the bot talking and self-prompting; it does not stop it living.

// Deliberately generous. This is a runaway guard, not a cost control: it exists
// so a stuck self-prompt loop cannot spin forever, not to ration normal play.
// Local providers are typically free, so tighten this only if you actually want
// a paid provider rationed.
const DEFAULTS = Object.freeze({
  maxPerMinute: 120,
  maxPerHour: 3_000,
  maxPerSession: 50_000,
});

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(number)));
}

export function normalizeUsageBudget(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  // 0 disables a limit rather than blocking every call, so a misconfigured
  // zero cannot silently mute a bot forever.
  return Object.freeze({
    maxPerMinute: boundedInteger(source.maxPerMinute, DEFAULTS.maxPerMinute, 0, 10_000),
    maxPerHour: boundedInteger(source.maxPerHour, DEFAULTS.maxPerHour, 0, 100_000),
    maxPerSession: boundedInteger(source.maxPerSession, DEFAULTS.maxPerSession, 0, 1_000_000),
  });
}

/**
 * Priority decides what gets sacrificed first when the budget tightens.
 * Ambient chatter goes long before the player's own conversation does.
 */
export const SPEND_PRIORITY = Object.freeze({
  reaction: 1,
  autonomy: 2,
  memory: 3,
  conversation: 4,
  command: 5,
});

const RESERVED_FRACTION = Object.freeze({
  1: 0.50,
  2: 0.65,
  3: 0.85,
  4: 1,
  5: 1,
});

export class UsageBudget {
  constructor(limits = {}, { now = Date.now } = {}) {
    this.limits = normalizeUsageBudget(limits);
    this.now = typeof now === 'function' ? now : Date.now;
    this.recent = [];
    this.sessionCount = 0;
    this.deniedCount = 0;
    this.lastDenialReason = '';
  }

  prune(now) {
    const cutoff = now - HOUR_MS;
    while (this.recent.length && this.recent[0] < cutoff) this.recent.shift();
  }

  counts(now = this.now()) {
    this.prune(now);
    const minuteCutoff = now - MINUTE_MS;
    let inMinute = 0;
    for (let index = this.recent.length - 1; index >= 0; index -= 1) {
      if (this.recent[index] < minuteCutoff) break;
      inMinute += 1;
    }
    return { inMinute, inHour: this.recent.length, session: this.sessionCount };
  }

  /**
   * `kind` names the caller so low-value traffic yields first. Returns a
   * reason string when refused so telemetry can say which limit bit.
   */
  check(kind = 'conversation') {
    const now = this.now();
    const { inMinute, inHour, session } = this.counts(now);
    const priority = SPEND_PRIORITY[kind] ?? SPEND_PRIORITY.conversation;
    const share = RESERVED_FRACTION[priority] ?? 1;

    if (this.limits.maxPerSession > 0 && session >= this.limits.maxPerSession * share) {
      return { allowed: false, reason: 'session_budget_exhausted' };
    }
    if (this.limits.maxPerHour > 0 && inHour >= this.limits.maxPerHour * share) {
      return { allowed: false, reason: 'hourly_budget_exhausted' };
    }
    if (this.limits.maxPerMinute > 0 && inMinute >= this.limits.maxPerMinute * share) {
      return { allowed: false, reason: 'minute_budget_exhausted' };
    }
    return { allowed: true, reason: '' };
  }

  record() {
    const now = this.now();
    this.prune(now);
    this.recent.push(now);
    this.sessionCount += 1;
    return this.sessionCount;
  }

  deny(reason) {
    this.deniedCount += 1;
    this.lastDenialReason = String(reason || 'budget_exhausted').slice(0, 64);
  }

  /** Check and record in one step, so a caller cannot spend without counting. */
  claim(kind = 'conversation') {
    const verdict = this.check(kind);
    if (!verdict.allowed) {
      this.deny(verdict.reason);
      return verdict;
    }
    this.record();
    return verdict;
  }

  snapshot() {
    const { inMinute, inHour, session } = this.counts();
    return {
      limits: this.limits,
      inMinute,
      inHour,
      session,
      denied: this.deniedCount,
      lastDenialReason: this.lastDenialReason || null,
      // The fraction of the tightest active limit already consumed.
      pressure: Math.max(
        this.limits.maxPerMinute > 0 ? inMinute / this.limits.maxPerMinute : 0,
        this.limits.maxPerHour > 0 ? inHour / this.limits.maxPerHour : 0,
        this.limits.maxPerSession > 0 ? session / this.limits.maxPerSession : 0,
      ),
    };
  }
}
