// A profile could name exactly one model, so a rate-limited provider, an
// unreachable local server, or a paused subscription stopped the bot talking
// altogether. This lets a profile name several in preference order:
//
//   "model": ["claude-sonnet-4-5", "ollama/qwen2.5:14b"]
//
// The first entry is preferred. When it fails for a transport reason the next
// one answers and the failed provider is put on a short cooldown, so a local
// model can cover for a hosted one and the hosted one is picked back up on its
// own once it recovers.

const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 10 * 60_000;

// Only infrastructure failures should move traffic to another provider. A
// refusal or a bad answer is the model's real reply and must not be retried
// somewhere else, or the bot would silently shop for a provider that agrees.
const TRANSPORT_FAILURE = /(?:429|too many requests|rate.?limit|quota|insufficient_quota|credit|billing|payment|5\d\d|timeout|timed out|econn|enotfound|eai_again|socket hang up|network|fetch failed|unavailable|overloaded|not running|refused)/i;

export function isTransportFailure(error) {
  const text = `${error?.status ?? ''} ${error?.code ?? ''} ${error?.message ?? error ?? ''}`;
  return TRANSPORT_FAILURE.test(text);
}

// Providers swallow their own transport errors and RETURN a sentinel string
// instead of throwing, so the router's catch never fires and it hands the
// failure straight back. Detect that sentinel (and an empty answer, which is
// only ever a failed generation for chat) so the next provider still gets a
// turn -- this is what makes a flaky primary self-heal instead of surfacing
// "my brain disconnected" to the player.
export function isFailedResponse(response) {
  if (typeof response !== 'string') return false;
  const trimmed = response.trim();
  return trimmed === '' || /brain disconnected/i.test(trimmed);
}

function labelFor(profile, index) {
  if (typeof profile === 'string') return profile;
  return String(profile?.model || profile?.api || `model-${index + 1}`);
}

export class FallbackRouter {
  constructor(entries, { now = Date.now, cooldownMs = DEFAULT_COOLDOWN_MS, log = console } = {}) {
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new TypeError('A fallback router needs at least one model.');
    }
    this.now = typeof now === 'function' ? now : Date.now;
    this.cooldownMs = Math.max(1_000, Number(cooldownMs) || DEFAULT_COOLDOWN_MS);
    this.log = log;
    this.entries = entries.map((entry, index) => ({
      model: entry.model,
      label: entry.label || labelFor(entry.profile, index),
      downUntil: 0,
      failures: 0,
      successes: 0,
    }));
    this.lastUsed = this.entries[0].label;
  }

  available() {
    const now = this.now();
    const ready = this.entries.filter((entry) => entry.downUntil <= now);
    // If every provider is cooling down, try them all anyway rather than going
    // silent: a stale cooldown must never outlive an actually-recovered model.
    return ready.length ? ready : this.entries;
  }

  penalize(entry) {
    entry.failures += 1;
    const backoff = Math.min(MAX_COOLDOWN_MS, this.cooldownMs * (2 ** Math.min(4, entry.failures - 1)));
    entry.downUntil = this.now() + backoff;
  }

  async sendRequest(...args) {
    const candidates = this.available();
    let lastError = null;
    for (const entry of candidates) {
      try {
        const response = await entry.model.sendRequest(...args);
        if (isFailedResponse(response)) {
          // The provider failed quietly and returned a sentinel. Move on to the
          // next one rather than returning a dead answer.
          lastError = new Error(`${entry.label} returned a failure sentinel`);
          this.penalize(entry);
          this.log?.warn?.(`[model-route] ${entry.label} returned a failure response; trying the next provider.`);
          continue;
        }
        entry.successes += 1;
        entry.failures = 0;
        entry.downUntil = 0;
        this.lastUsed = entry.label;
        return response;
      } catch (error) {
        lastError = error;
        if (!isTransportFailure(error)) throw error;
        this.penalize(entry);
        this.log?.warn?.(
          `[model-route] ${entry.label} is unavailable (${String(error?.message || error).slice(0, 120)}); trying the next provider.`,
        );
      }
    }
    throw lastError || new Error('No model provider was reachable.');
  }

  async embed(...args) {
    for (const entry of this.available()) {
      if (typeof entry.model.embed !== 'function') continue;
      try {
        return await entry.model.embed(...args);
      } catch (error) {
        if (!isTransportFailure(error)) throw error;
        this.penalize(entry);
      }
    }
    throw new Error('No embedding provider was reachable.');
  }

  // Lifecycle is not routing. A stopped agent must reach every provider it ever
  // built, not just the one currently preferred -- otherwise Operator Stop
  // cancels a router that owns no network job while its children keep
  // generating. Children may themselves be routers, and a specialist route
  // chains to the chat model, so the same leaf is reachable by several paths
  // and must still be torn down exactly once. Hence a de-duplicated leaf set.
  leafModels() {
    const leaves = new Set();
    for (const entry of this.entries) {
      const model = entry.model;
      if (!model) continue;
      if (typeof model.leafModels === 'function') {
        for (const leaf of model.leafModels()) leaves.add(leaf);
      } else {
        leaves.add(model);
      }
    }
    return leaves;
  }

  async preflight() {
    await Promise.all([...this.leafModels()].map((model) => model.preflight?.()));
  }

  cancelPending() {
    let cancelled = 0;
    for (const model of this.leafModels()) {
      cancelled += Number(model.cancelPending?.() || 0);
    }
    return cancelled;
  }

  dispose() {
    return Promise.allSettled([...this.leafModels()].map((model) => model.dispose?.()))
      .then(() => undefined);
  }

  snapshot() {
    const now = this.now();
    return {
      active: this.lastUsed,
      providers: this.entries.map((entry) => ({
        label: entry.label,
        healthy: entry.downUntil <= now,
        cooldownRemainingMs: Math.max(0, entry.downUntil - now),
        failures: entry.failures,
        successes: entry.successes,
      })),
    };
  }
}

/**
 * Build one model, or a router when several are named. `create` is injected so
 * this file never has to know how a provider is constructed.
 */
export function createRoutedModel(configured, create, options = {}) {
  const list = Array.isArray(configured) ? configured : [configured];
  const built = [];
  const failures = [];
  list.forEach((profile, index) => {
    try {
      built.push({ model: create(profile), profile, label: labelFor(profile, index) });
    } catch (error) {
      // One unusable entry must not stop the others from being offered.
      failures.push(`${labelFor(profile, index)}: ${String(error?.message || error).slice(0, 120)}`);
    }
  });
  if (!built.length) {
    throw new Error(`No usable model could be created. ${failures.join('; ')}`);
  }
  if (failures.length) {
    (options.log || console).warn?.(`[model-route] Skipped unusable model entries — ${failures.join('; ')}`);
  }
  return built.length === 1 ? built[0].model : new FallbackRouter(built, options);
}
