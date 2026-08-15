const SOURCE_KINDS = new Set(['bot', 'foreign', 'unknown']);
const FINAL_DAMAGE_CONFIRM_WINDOW_MS = 250;

function boundedName(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ') // eslint-disable-line no-control-regex
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64) || null;
}

function entityId(entity) {
  return Number.isFinite(entity?.id) ? Math.floor(entity.id) : null;
}

function sameEntity(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const leftId = entityId(left);
  const rightId = entityId(right);
  if (leftId !== null && rightId !== null) return leftId === rightId;
  const leftName = boundedName(left.username);
  const rightName = boundedName(right.username);
  return Boolean(leftName && rightName && leftName === rightName);
}

/**
 * Classify Mineflayer's responsible damage entity without inferring ownership
 * from event timing. On 1.20+ Mineflayer supplies this as the second
 * `entityHurt` argument; environmental damage remains explicitly unknown.
 */
export function classifyCombatDamageSource(bot, source) {
  if (!source) return 'unknown';
  if (sameEntity(bot?.entity, source)) return 'bot';
  return 'foreign';
}

/**
 * Preserve the responsible entity when the bot itself is hurt. This receipt is
 * deliberately about identity and source class, not motive: Minecraft proves
 * who dealt the damage but cannot prove why a player swung.
 */
export function observeReceivedDamageSource(
  bot,
  hurtEntity,
  source,
  { requester = '', isHostile = () => false, now = Date.now() } = {},
) {
  if (!sameEntity(bot?.entity, hurtEntity)) {
    return Object.freeze({ matchesSelf: false, kind: 'unknown', code: 'different_hurt_entity' });
  }
  const observedAt = Number(now);
  if (!source) {
    return Object.freeze({
      matchesSelf: true,
      kind: 'unknown',
      code: 'self_damage_source_unknown',
      source: null,
      observedAt: Number.isFinite(observedAt) ? observedAt : Date.now(),
    });
  }
  const username = boundedName(source.username);
  const requesterName = boundedName(requester);
  const player = source.type === 'player' || Boolean(username);
  const kind = player
    ? (username && requesterName && username.toLowerCase() === requesterName.toLowerCase()
      ? 'requester_player'
      : 'other_player')
    : isHostile(source) === true
      ? 'hostile'
      : 'other_entity';
  return Object.freeze({
    matchesSelf: true,
    kind,
    code: `self_damage_source_${kind}`,
    source: Object.freeze({
      id: entityId(source),
      name: boundedName(source.name || source.displayName),
      username,
      type: boundedName(source.type),
    }),
    observedAt: Number.isFinite(observedAt) ? observedAt : Date.now(),
  });
}

/**
 * Normalize one target-damage event for both melee and ranged verification.
 * Only `bot` attribution confirms the bot's hit. Foreign and unknown sources
 * are retained as negative evidence and can never become success by timing.
 */
export function observeCombatDamage(bot, target, hurtEntity, source) {
  const targetId = typeof target === 'object' ? entityId(target) : target;
  const exactLoadedEntity = typeof target !== 'object' || hurtEntity === target;
  if (!Number.isFinite(targetId) || entityId(hurtEntity) !== Math.floor(targetId) || !exactLoadedEntity) {
    return Object.freeze({ matchesTarget: false, attribution: 'unknown', confirmsBotHit: false, code: 'different_target' });
  }
  const attribution = classifyCombatDamageSource(bot, source);
  if (!SOURCE_KINDS.has(attribution)) {
    throw new TypeError(`Unsupported combat attribution '${attribution}'.`);
  }
  const sourceRef = source
    ? Object.freeze({
      id: entityId(source),
      name: boundedName(source.username || source.name),
    })
    : null;
  return Object.freeze({
    matchesTarget: true,
    attribution,
    confirmsBotHit: attribution === 'bot',
    code: attribution === 'bot'
      ? 'bot_attributed_damage'
      : attribution === 'foreign'
        ? 'foreign_attributed_damage'
        : 'damage_source_unknown',
    source: sourceRef,
  });
}

/**
 * Entity death packets do not carry the responsible damage source. Bind them
 * only to a bot-attributed damage packet from the same immediate combat edge;
 * otherwise a later command, player, or environmental death can inherit stale
 * attribution from any earlier bot hit.
 */
export function confirmBotAttributedCombatDeath(
  lastDamageAttribution,
  lastDamageObservedAt,
  targetDeathObservedAt,
  windowMs = FINAL_DAMAGE_CONFIRM_WINDOW_MS,
) {
  const damageAt = Number(lastDamageObservedAt);
  const deathAt = Number(targetDeathObservedAt);
  const maximumDelay = Math.max(0, Number(windowMs) || 0);
  const delayMs = Number.isFinite(damageAt) && Number.isFinite(deathAt)
    ? deathAt - damageAt
    : null;
  const confirmed = lastDamageAttribution === 'bot'
    && Number.isFinite(delayMs)
    && delayMs >= 0
    && delayMs <= maximumDelay;
  return Object.freeze({
    confirmed,
    delayMs: Number.isFinite(delayMs) ? delayMs : null,
    code: confirmed
      ? 'bot_attributed_final_damage'
      : lastDamageAttribution === 'foreign'
        ? 'foreign_final_damage'
        : 'final_damage_unconfirmed',
  });
}
