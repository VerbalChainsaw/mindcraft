const SOURCE_KINDS = new Set(['bot', 'foreign', 'unknown']);

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
 * Normalize one target-damage event for both melee and ranged verification.
 * Only `bot` attribution confirms the bot's hit. Foreign and unknown sources
 * are retained as negative evidence and can never become success by timing.
 */
export function observeCombatDamage(bot, targetId, hurtEntity, source) {
  if (!Number.isFinite(targetId) || entityId(hurtEntity) !== Math.floor(targetId)) {
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
