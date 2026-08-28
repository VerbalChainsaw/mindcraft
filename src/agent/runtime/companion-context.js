import * as mc from '../../utils/mcdata.js';
import { resolvePlayerTarget } from '../player-target.js';

const contextsByBot = new WeakMap();
const RECENT_PRESENCE_MS = 8_000;
const FOLLOW_GRACE_MS = 3_500;
const ATTENTION_TTL_MS = 2_500;
const PROTECTION_TTL_MS = 6_000;

function positionSnapshot(position) {
  if (!position || ![position.x, position.y, position.z].every(Number.isFinite)) return null;
  return { x: position.x, y: position.y, z: position.z };
}

function boundedText(value, maximum = 96) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maximum);
}

export function bindCompanionContext(bot, context) {
  if (bot && context) contextsByBot.set(bot, context);
}

export function companionContextFor(bot) {
  return bot ? contextsByBot.get(bot) || null : null;
}

export function normalizePlayerDistance(value, fallback = 3) {
  const distance = Number(value);
  return Math.max(1.25, Number.isFinite(distance) ? distance : fallback);
}

export class CompanionContext {
  constructor(agent, {
    now = Date.now,
    onReappeared = () => {},
    recentPresenceMs = RECENT_PRESENCE_MS,
    followGraceMs = FOLLOW_GRACE_MS,
    directiveState = null,
  } = {}) {
    this.agent = agent;
    this.now = now;
    this.onReappeared = onReappeared;
    this.recentPresenceMs = recentPresenceMs;
    this.followGraceMs = followGraceMs;
    this.directiveState = directiveState;
    this.directivePersistenceError = null;
    this.directiveAuthorizedAt = null;
    this.chatAlias = null;
    this.requestedName = null;
    this.canonicalUsername = null;
    this.presence = 'absent';
    this.entityId = null;
    this.entityEpoch = 0;
    this.position = null;
    this.lastSeenPosition = null;
    this.lastSeenSource = null;
    this.dimension = null;
    this.lastSeenDimension = null;
    this.loaded = false;
    this.lineOfSight = null;
    this.lineOfSightObservedAt = null;
    this.observedAt = null;
    this.lastSeenAt = null;
    this.authoritativeCheckedAt = null;
    this.authoritativeFound = null;
    this.authoritativePlayer = null;
    this.directive = null;
    this.protection = null;
    this.attention = null;
    this.waitingSince = null;
    try {
      const restored = this.directiveState?.snapshot?.();
      this.directivePersistenceError = restored?.error || null;
      if (restored?.directive === 'follow' || restored?.directive === 'guard') {
        this.directive = restored.directive;
        this.requestedName = boundedText(restored.requestedName, 64) || null;
        this.canonicalUsername = boundedText(restored.canonicalUsername, 64) || null;
        this.directiveAuthorizedAt = Number.isFinite(restored.authorizedAt)
          ? restored.authorizedAt
          : null;
      }
    } catch (error) {
      this.directivePersistenceError = String(error?.message || error).slice(0, 280);
      this.directive = null;
      this.requestedName = null;
      this.canonicalUsername = null;
      this.directiveAuthorizedAt = null;
    }
    bindCompanionContext(agent?.bot, this);
  }

  syncDirectiveState({ required = false } = {}) {
    if (!this.directiveState) return null;
    try {
      const current = this.directiveState.snapshot();
      const requestedName = this.directive ? this.requestedName : null;
      const canonicalUsername = this.directive ? this.canonicalUsername : null;
      if (
        current.error === null
        && current.directive === this.directive
        && current.requestedName === requestedName
        && current.canonicalUsername === canonicalUsername
        && current.authorizedAt === this.directiveAuthorizedAt
      ) {
        this.directivePersistenceError = null;
        return current;
      }
      const persisted = this.directive
        ? this.directiveState.persist({
            directive: this.directive,
            requestedName,
            canonicalUsername,
            authorizedAt: this.directiveAuthorizedAt,
            updatedAt: this.now(),
          })
        : this.directiveState.clear();
      this.directivePersistenceError = persisted?.error || null;
      return persisted;
    } catch (error) {
      this.directivePersistenceError = String(error?.message || error).slice(0, 280);
      if (required) throw error;
      return null;
    }
  }

  resolve(requestedName = this.requestedName || this.chatAlias || this.canonicalUsername) {
    return resolvePlayerTarget(this.agent?.bot, requestedName, {
      knownBotNames: this.agent?.getKnownAgentNames?.() || [],
    });
  }

  observeChat(alias) {
    const incomingAlias = boundedText(alias, 64) || null;
    const resolution = this.resolve(incomingAlias);
    if (!this.directive || !this.canonicalUsername || resolution.canonical === this.canonicalUsername) {
      this.chatAlias = incomingAlias;
      this.requestedName = incomingAlias;
      this.observeResolution(incomingAlias, resolution, { lineOfSight: null });
    }
    this.requestAttention('human_chat');
    return resolution;
  }

  observeResolution(requestedName, resolution, {
    lineOfSight,
    dimension,
    notify = true,
    persistDirective = true,
  } = {}) {
    const now = this.now();
    const wasPresent = this.presence === 'present';
    const requested = boundedText(requestedName, 64) || this.requestedName;
    if (requested) this.requestedName = requested;
    this.observedAt = now;
    if (!resolution?.entity || !resolution.canonical) {
      this.loaded = false;
      this.position = null;
      this.lineOfSight = null;
      this.lineOfSightObservedAt = now;
      this.presence = resolution?.ambiguous
        ? 'ambiguous'
        : this.lastSeenAt !== null && now - this.lastSeenAt <= this.recentPresenceMs
          ? 'recent'
          : 'absent';
      return this.snapshot();
    }

    const entity = resolution.entity;
    const previousEntityId = this.entityId;
    const nextEntityId = Number.isFinite(entity.id) ? entity.id : null;
    if (!wasPresent || nextEntityId !== previousEntityId) this.entityEpoch += 1;
    this.entityId = nextEntityId;
    this.canonicalUsername = resolution.canonical;
    this.loaded = true;
    this.presence = 'present';
    this.position = positionSnapshot(entity.position);
    this.lastSeenPosition = this.position ? { ...this.position } : this.lastSeenPosition;
    this.lastSeenSource = this.position ? 'mineflayer_entity' : this.lastSeenSource;
    this.dimension = boundedText(dimension || this.agent?.bot?.game?.dimension, 64) || null;
    this.lastSeenDimension = this.dimension || this.lastSeenDimension;
    if (typeof lineOfSight === 'boolean' || lineOfSight === null) {
      this.lineOfSight = lineOfSight;
      this.lineOfSightObservedAt = now;
    } else if (nextEntityId !== previousEntityId) {
      this.lineOfSight = null;
      this.lineOfSightObservedAt = null;
    }
    this.lastSeenAt = now;
    this.waitingSince = null;
    if (persistDirective && this.directive) this.syncDirectiveState();
    if (notify && !wasPresent && this.directive && !this.agent?.isOperatorHeld?.()) {
      queueMicrotask(() => this.onReappeared(this.snapshot()));
    }
    return this.snapshot();
  }

  observeAuthoritativePosition(requestedName, observation) {
    const checkedAt = Number.isFinite(observation?.observedAt) ? observation.observedAt : this.now();
    const requested = boundedText(requestedName, 64);
    const position = positionSnapshot(observation?.position);
    const dimension = boundedText(observation?.dimension, 64) || null;
    const completePositive = Boolean(
      observation?.success === true
      && observation?.found === true
      && position
      && dimension
    );
    this.authoritativeCheckedAt = checkedAt;
    this.authoritativeFound = observation?.success === true && observation?.found === false
      ? false
      : completePositive
        ? true
        : null;
    this.authoritativePlayer = requested || this.authoritativePlayer;
    if (requested) this.requestedName = requested;
    if (!completePositive) return this.snapshot();
    const canonical = boundedText(observation.player || requestedName, 64);
    if (canonical) this.canonicalUsername = canonical;
    this.lastSeenPosition = position;
    this.lastSeenDimension = dimension;
    this.lastSeenSource = boundedText(observation.source, 32) || 'managed_paper';
    this.lastSeenAt = Number.isFinite(observation.observedAt) ? observation.observedAt : this.now();
    this.observedAt = this.lastSeenAt;
    if (!this.loaded) this.presence = 'recent';
    if (this.directive) this.syncDirectiveState();
    return this.snapshot();
  }

  reconcileLoadedPlayer({ lineOfSight = null, dimension } = {}) {
    const expected = this.canonicalUsername || this.requestedName || this.chatAlias;
    if (!expected) return this.snapshot();
    return this.observeResolution(expected, this.resolve(expected), {
      lineOfSight,
      dimension,
    });
  }

  observeLoadedPlayer(name, entity, { lineOfSight = null, dimension } = {}) {
    if (!this.requestedName && !this.canonicalUsername && !this.chatAlias) return this.snapshot();
    const candidate = boundedText(name || entity?.username, 64);
    const expected = this.canonicalUsername || this.requestedName || this.chatAlias;
    const resolution = this.resolve(expected);
    if (!resolution.entity || (candidate && resolution.canonical !== candidate && entity?.id !== resolution.entity.id)) {
      return this.snapshot();
    }
    return this.observeResolution(expected, resolution, { lineOfSight, dimension });
  }

  observeGone(entityOrName) {
    const id = Number.isFinite(entityOrName?.id) ? entityOrName.id : null;
    const name = boundedText(entityOrName?.username || entityOrName, 64);
    if ((id !== null && id !== this.entityId) || (id === null && name && name !== this.canonicalUsername)) return;
    this.observeResolution(this.requestedName || name, {
      requested: this.requestedName || name,
      canonical: null,
      entity: null,
      ambiguous: false,
    });
  }

  setDirective(kind, requestedName, { chatAlias = null } = {}) {
    const directive = kind === 'guard' ? 'guard' : kind === 'follow' ? 'follow' : null;
    const requested = boundedText(requestedName, 64);
    const resolution = requested ? this.resolve(requested) : null;
    const previous = {
      directive: this.directive,
      requestedName: this.requestedName,
      canonicalUsername: this.canonicalUsername,
      authorizedAt: this.directiveAuthorizedAt,
    };
    this.directive = directive;
    this.directiveAuthorizedAt = directive ? this.now() : null;
    if (requested) {
      this.requestedName = requested;
      this.canonicalUsername = resolution?.canonical || null;
    }
    try {
      this.syncDirectiveState({ required: true });
    } catch (error) {
      this.directive = previous.directive;
      this.requestedName = previous.requestedName;
      this.canonicalUsername = previous.canonicalUsername;
      this.directiveAuthorizedAt = previous.authorizedAt;
      throw error;
    }
    if (chatAlias) this.chatAlias = boundedText(chatAlias, 64) || this.chatAlias;
    if (requested) {
      this.observeResolution(requested, resolution, {
        lineOfSight: null,
        notify: false,
        persistDirective: false,
      });
    }
    this.waitingSince = null;
    if (directive !== 'guard') this.clearProtection('directive_changed');
    if (directive !== 'guard' && this.agent?.runtime?.reflexes?.combat === 'off') {
      this.agent?.bot?.modes?.setOn?.('self_defense', false);
    }
    return this.snapshot();
  }

  markWaiting() {
    if (this.waitingSince === null) this.waitingSince = this.now();
    return this.snapshot();
  }

  canUseLastSeen() {
    const age = this.lastSeenAt === null ? Infinity : this.now() - this.lastSeenAt;
    return Boolean(
      this.directive
      && this.lastSeenPosition
      && this.lastSeenDimension === boundedText(this.agent?.bot?.game?.dimension, 64)
      && age <= this.followGraceMs
    );
  }

  resumeCommand() {
    if (!this.directive || !this.canonicalUsername || this.presence !== 'present') return null;
    const escaped = this.canonicalUsername.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    return this.directive === 'guard'
      ? `!guardPlayer("${escaped}", 3)`
      : `!followPlayer("${escaped}", 3)`;
  }

  requestAttention(reason, { ttlMs = ATTENTION_TTL_MS } = {}) {
    if (this.agent?.isOperatorHeld?.()) return null;
    const now = this.now();
    this.attention = {
      reason: boundedText(reason, 64) || 'observation',
      requestedAt: now,
      expiresAt: now + Math.max(250, Math.min(5_000, Number(ttlMs) || ATTENTION_TTL_MS)),
    };
    return { ...this.attention };
  }

  currentAttention() {
    if (!this.attention || this.now() >= this.attention.expiresAt || this.agent?.isOperatorHeld?.()) {
      this.attention = null;
      return null;
    }
    return { ...this.attention };
  }

  observeProtectedHurt(victim, source) {
    const protectionAuthorized = this.directive === 'guard'
      || (
        this.agent?.runtime?.role === 'companion'
        && this.agent?.runtime?.reflexes?.combat === 'defend'
      );
    const victimMatches = Boolean(
      protectionAuthorized
      && this.canonicalUsername
      && (victim?.id === this.entityId || victim?.username === this.canonicalUsername)
    );
    if (!victimMatches || this.agent?.isOperatorHeld?.()) return null;
    this.requestAttention(source ? 'guarded_player_hurt' : 'guarded_player_hurt_unattributed');
    if (!source?.id || !source.position) return null;
    const loadedSource = this.agent?.bot?.entities?.[source.id];
    if (!loadedSource || loadedSource !== source || !mc.isCombatSafeHostile(source)) return null;
    if (this.dimension && this.dimension !== boundedText(this.agent?.bot?.game?.dimension, 64)) return null;
    const now = this.now();
    this.protection = {
      threatEntityId: source.id,
      threatName: boundedText(source.username || source.name || 'hostile', 64),
      observedAt: now,
      expiresAt: now + PROTECTION_TTL_MS,
      state: 'attributed',
    };
    return { ...this.protection };
  }

  protectionThreat() {
    if (!this.protection || this.agent?.isOperatorHeld?.() || this.now() >= this.protection.expiresAt) {
      this.clearProtection('expired');
      return null;
    }
    const entity = this.agent?.bot?.entities?.[this.protection.threatEntityId];
    if (!entity?.position || !mc.isCombatSafeHostile(entity)) {
      this.clearProtection('threat_clear');
      return null;
    }
    return entity;
  }

  clearProtection(state = 'cleared') {
    if (this.protection) this.protection = { ...this.protection, state };
    this.protection = null;
  }

  clearControl() {
    this.directive = null;
    this.directiveAuthorizedAt = null;
    this.syncDirectiveState();
    this.waitingSince = null;
    this.clearProtection('operator_stop');
    this.attention = null;
  }

  currentControlCommitment(action = {}) {
    const directive = String(this.directive || '').toLowerCase();
    const username = String(this.canonicalUsername || '').trim().toLowerCase();
    if (
      !['follow', 'guard'].includes(directive)
      || !username
      || !Number.isFinite(this.directiveAuthorizedAt)
    ) return null;
    return {
      owner: 'player_directive',
      obligationId: `${directive}:${username}:${this.directiveAuthorizedAt}`,
      phase: directive,
      ownsCurrentAction: action.owner === 'player',
    };
  }

  snapshot() {
    const now = this.now();
    if (this.protection && now >= this.protection.expiresAt) this.clearProtection('expired');
    const age = this.lastSeenAt === null ? null : Math.max(0, now - this.lastSeenAt);
    const authoritativeCheckAge = this.authoritativeCheckedAt === null
      ? null
      : Math.max(0, now - this.authoritativeCheckedAt);
    const lineOfSightAge = this.lineOfSightObservedAt === null
      ? null
      : Math.max(0, now - this.lineOfSightObservedAt);
    const presence = this.loaded
      ? 'present'
      : this.presence === 'ambiguous'
        ? 'ambiguous'
        : age !== null && age <= this.recentPresenceMs
          ? 'recent'
          : 'absent';
    let directivePersistence = {
      status: this.directiveState ? 'ready' : 'volatile',
      updatedAt: null,
      authorizedAt: this.directiveAuthorizedAt,
      error: this.directivePersistenceError,
    };
    try {
      const persisted = this.directiveState?.snapshot?.();
      if (persisted) {
        directivePersistence = {
          status: persisted.error || this.directivePersistenceError ? 'error' : 'ready',
          updatedAt: persisted.updatedAt,
          authorizedAt: persisted.authorizedAt,
          error: persisted.error || this.directivePersistenceError,
        };
      }
    } catch (error) {
      directivePersistence = {
        status: 'error',
        updatedAt: null,
        authorizedAt: this.directiveAuthorizedAt,
        error: String(error?.message || error).slice(0, 280),
      };
    }
    return {
      alias: this.chatAlias,
      requestedName: this.requestedName,
      canonicalUsername: this.canonicalUsername,
      presence,
      entityId: this.entityId,
      entityEpoch: this.entityEpoch,
      position: this.position ? { ...this.position } : null,
      lastSeenPosition: this.lastSeenPosition ? { ...this.lastSeenPosition } : null,
      lastSeenSource: this.lastSeenSource,
      dimension: this.dimension,
      lastSeenDimension: this.lastSeenDimension,
      loaded: this.loaded,
      lineOfSight: this.lineOfSight,
      lineOfSightObservedAt: this.lineOfSightObservedAt,
      lineOfSightAge,
      observedAt: this.observedAt,
      lastSeenAt: this.lastSeenAt,
      age,
      authoritativeCheckedAt: this.authoritativeCheckedAt,
      authoritativeCheckAge,
      authoritativeFound: this.authoritativeFound,
      authoritativePlayer: this.authoritativePlayer,
      directive: this.directive,
      directiveAuthorizedAt: this.directiveAuthorizedAt,
      directivePersistence,
      protection: this.protection ? { ...this.protection } : null,
      attention: this.currentAttention(),
      waitingSince: this.waitingSince,
    };
  }
}
