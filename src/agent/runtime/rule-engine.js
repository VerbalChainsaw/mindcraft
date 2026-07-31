import { describeRule, normalizeRule, RULE_LIMITS, RuleStore } from './rules.js';

// The engine matches events to rules and queues the result. It never acts
// itself and never executes anything: matching a rule appends an agenda step,
// and the agenda still hands that to the executors that own verification. A
// rule can therefore start work but can never bypass the safety already built
// into the lane that performs it.
const MAX_FIRES_PER_TICK = 2;

function boundedText(value, maximum = 240) {
  return String(value ?? '')
    .replace(/[ -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function distance(from, to) {
  if (!from || !to) return Infinity;
  return Math.hypot(from.x - to.x, from.y - to.y, from.z - to.z);
}

export class RuleEngine {
  constructor(agent, { store = null, now = Date.now } = {}) {
    this.agent = agent;
    this.now = typeof now === 'function' ? now : Date.now;
    this.rules = [];
    this.sequence = 0;
    this.patrolIndex = 0;
    this.lastFired = '';
    this.firedThisSession = 0;
    try {
      this.store = store || new RuleStore(agent.name);
      this.rules = this.store.load();
      this.sequence = this.rules.length;
      this.lastError = this.store.lastError;
    } catch (error) {
      this.store = null;
      this.lastError = boundedText(error?.message || error);
    }
  }

  persist() {
    if (this.store) this.store.save(this.rules);
  }

  add(raw) {
    if (this.rules.length >= RULE_LIMITS.maxRules) {
      return { accepted: false, detail: `Only ${RULE_LIMITS.maxRules} rules are allowed.` };
    }
    let rule;
    try {
      this.sequence += 1;
      rule = normalizeRule({ ...raw, id: '' }, { sequence: this.sequence, now: this.now });
    } catch (error) {
      return { accepted: false, detail: boundedText(error?.message || error) };
    }
    this.rules = [...this.rules, rule];
    this.persist();
    return { accepted: true, id: rule.id, description: describeRule(rule) };
  }

  remove(id) {
    const key = boundedText(id, 48);
    const before = this.rules.length;
    this.rules = this.rules.filter((rule) => rule.id !== key && rule.name !== key);
    if (this.rules.length === before) return { removed: false };
    this.persist();
    return { removed: true };
  }

  list() {
    return this.rules.map((rule) => ({
      id: rule.id,
      description: describeRule(rule),
      enabled: rule.enabled,
      firedCount: rule.firedCount,
    }));
  }

  markFired(rule) {
    this.rules = this.rules.map((entry) => (
      entry.id === rule.id
        ? normalizeRule({ ...entry, firedCount: entry.firedCount + 1, lastFiredAt: this.now() })
        : entry
    ));
    this.firedThisSession += 1;
    this.lastFired = describeRule(rule);
    this.persist();
  }

  /** A remembered place of the rule's category, if one is known. */
  placeFor(rule) {
    if (!rule.place) return null;
    try {
      const matches = this.agent?.landmark_memory?.recall?.({
        category: rule.place,
        dimension: this.agent?.bot?.game?.dimension,
        origin: this.agent?.bot?.entity?.position,
        limit: 8,
      }) || [];
      return matches.length ? matches : null;
    } catch {
      return null;
    }
  }

  matches(rule, event) {
    if (!rule.enabled) return false;
    if (this.now() - rule.lastFiredAt < rule.cooldownMs) return false;
    if (rule.trigger !== event.type) return false;

    if (rule.subject) {
      const name = String(event.target?.name || '').toLowerCase();
      if (!name.includes(rule.subject.replace(/_/g, ''))
        && name.replace(/_/g, '') !== rule.subject.replace(/_/g, '')
        && name !== rule.subject) return false;
    }
    if (rule.player) {
      const who = String(event.target?.name || '');
      if (who !== rule.player) return false;
    }
    if (rule.place) {
      const places = this.placeFor(rule);
      if (!places) return false;
      // The event has to happen near one of those remembered places.
      const where = [event.target?.x, event.target?.y, event.target?.z].every(Number.isFinite)
        ? { x: event.target.x, y: event.target.y, z: event.target.z }
        : this.agent?.bot?.entity?.position;
      if (!places.some((place) => distance(where, place) <= rule.within)) return false;
    }
    return true;
  }

  /** Turn a matched rule into queued work, or into speech. */
  fire(rule, event) {
    if (rule.action === 'say') {
      void Promise.resolve(this.agent?.openChat?.(rule.target))
        .catch(() => { /* chat is best effort */ });
      this.markFired(rule);
      return true;
    }

    let entry;
    if (rule.action === 'visit') {
      const places = this.placeFor(rule);
      if (!places?.length) return false;
      // Rotate so a patrol actually walks a circuit instead of one spot.
      const place = places[this.patrolIndex % places.length];
      this.patrolIndex += 1;
      entry = { kind: 'visit', x: place.x, y: place.y, z: place.z, note: `patrol ${rule.place}` };
    } else if (rule.action === 'goto') {
      entry = { kind: 'goto', recipient: rule.player, requester: rule.player };
    } else if (rule.action === 'shelter') {
      entry = { kind: 'shelter', requester: rule.player || this.agent?.name };
    } else {
      entry = {
        kind: rule.action,
        target: rule.target,
        quantity: rule.quantity,
        requester: rule.player || this.agent?.name,
        recipient: rule.player || this.agent?.name,
      };
    }

    const result = this.agent?.agenda_director?.add?.({ ...entry, note: describeRule(rule) });
    if (!result?.accepted) return false;
    this.markFired(rule);
    return true;
  }

  /** Called for every published behavior event. */
  observe(event) {
    if (!event?.type || !this.rules.length) return 0;
    let fired = 0;
    for (const rule of this.rules) {
      if (fired >= MAX_FIRES_PER_TICK) break;
      try {
        if (this.matches(rule, event) && this.fire(rule, event)) fired += 1;
      } catch (error) {
        console.warn(`[rules] ${rule.id} failed safely: ${boundedText(error?.message || error, 160)}`);
      }
    }
    return fired;
  }

  /** Scheduled rules have no event, so the behavior tick drives them. */
  update() {
    if (!this.rules.length) return;
    const now = this.now();
    let fired = 0;
    for (const rule of this.rules) {
      if (fired >= MAX_FIRES_PER_TICK) break;
      if (rule.trigger !== 'schedule' || !rule.enabled) continue;
      if (now - rule.lastFiredAt < Math.max(rule.cooldownMs, rule.everySeconds * 1_000)) continue;
      try {
        if (this.fire(rule, { type: 'schedule' })) fired += 1;
      } catch (error) {
        console.warn(`[rules] Scheduled ${rule.id} failed safely: ${boundedText(error?.message || error, 160)}`);
      }
    }
  }

  snapshot() {
    return {
      count: this.rules.length,
      enabled: this.rules.filter((rule) => rule.enabled).length,
      firedThisSession: this.firedThisSession,
      lastFired: this.lastFired || null,
      rules: this.list().slice(0, 12),
      error: this.lastError || null,
    };
  }
}
