const AVOID_ONLY_THREATS = new Set(['enderman', 'warden', 'wither', 'ender_dragon']);
const EXPLOSIVE_THREATS = new Set(['creeper']);
const RANGED_THREATS = new Set([
  'blaze',
  'bogged',
  'breeze',
  'drowned',
  'elder_guardian',
  'evoker',
  'ghast',
  'guardian',
  'illusioner',
  'pillager',
  'shulker',
  'skeleton',
  'stray',
  'witch',
]);

function normalizedName(value) {
  return String(value || '').trim().toLowerCase().replace(/^minecraft:/, '');
}

function finiteDistance(value) {
  const distance = Number(value);
  return Number.isFinite(distance) && distance >= 0 ? distance : Number.POSITIVE_INFINITY;
}

function threatClass(threat) {
  const name = normalizedName(threat?.name);
  const disposition = normalizedName(threat?.disposition);
  if (disposition === 'avoid_only' || AVOID_ONLY_THREATS.has(name)) return 'avoid_only';
  if (EXPLOSIVE_THREATS.has(name)) return 'explosive';
  if (RANGED_THREATS.has(name)) return 'ranged';
  return 'melee';
}

function responseFor(threat, state) {
  const classification = threatClass(threat);
  const health = Math.max(0, Number(state?.health) || 0);
  const equipment = state?.equipment || {};
  const rangedReady = equipment.bow === true && equipment.arrows === true;
  const shieldReady = equipment.shield === true;
  const meleeReady = equipment.melee === true;

  if (health <= 8) {
    return { response: 'retreat', reason: 'critical_health', desiredRange: 16 };
  }
  if (classification === 'avoid_only') {
    return { response: 'retreat', reason: 'avoid_only_threat', desiredRange: 24 };
  }
  if (classification === 'explosive') {
    if (finiteDistance(threat?.distance) <= 6) {
      return { response: 'retreat', reason: 'immediate_explosive_threat', desiredRange: 10 };
    }
    if (rangedReady) {
      return { response: 'ranged', reason: 'explosive_standoff', desiredRange: 8 };
    }
    return { response: 'retreat', reason: 'explosive_without_ranged_option', desiredRange: 10 };
  }
  if (classification === 'ranged') {
    if (shieldReady && meleeReady) {
      return { response: 'shield_melee', reason: 'projectile_block_and_close', desiredRange: 3 };
    }
    if (rangedReady) {
      return { response: 'ranged', reason: 'answer_range_with_range', desiredRange: 8 };
    }
    if (!meleeReady || health <= 12) {
      // Do not stop on the edge of the same projectile engagement envelope.
      // The shared survival policy already defines 24 blocks as a bounded
      // disengagement distance; Pathfinder owns the physical retreat.
      return { response: 'retreat', reason: 'unsafe_projectile_engagement', desiredRange: 24 };
    }
  }
  if (!meleeReady && health <= 12) {
    return { response: 'retreat', reason: 'no_melee_weapon', desiredRange: 16 };
  }
  return { response: 'melee', reason: 'close_safe_hostile', desiredRange: 3 };
}

function priorityScore(threat, state) {
  const classification = threatClass(threat);
  const distance = finiteDistance(threat?.distance);
  const classScore = classification === 'avoid_only'
    ? 120
    : classification === 'explosive'
      ? 105
      : classification === 'ranged'
        ? 85
        : 65;
  const distanceUrgency = Number.isFinite(distance) ? Math.max(0, 32 - (distance * 2)) : 0;
  const attributedUrgency = threat?.attributed === true ? 50 : 0;
  const lowHealthUrgency = Math.max(0, 12 - (Number(state?.health) || 0));
  return classScore + distanceUrgency + attributedUrgency + lowHealthUrgency;
}

/**
 * Choose one bounded tactical response from a live combat snapshot.
 * This function owns no Minecraft state and performs no physical action.
 */
export function chooseTacticalCombatDecision(state = {}) {
  const hostiles = Array.isArray(state.hostiles)
    ? state.hostiles.filter(threat => threat && Number.isFinite(Number(threat.id)))
    : [];
  if (hostiles.length === 0) {
    return {
      response: 'secure',
      reason: 'no_loaded_hostiles',
      selected: null,
      considered: 0,
      ranked: [],
    };
  }

  const ranked = hostiles
    .map(threat => {
      const classification = threatClass(threat);
      const tactic = responseFor(threat, state);
      return {
        id: Number(threat.id),
        name: normalizedName(threat.name) || 'hostile',
        distance: finiteDistance(threat.distance),
        classification,
        motion: threat.motion && typeof threat.motion === 'object'
          ? { state: normalizedName(threat.motion.state) || 'unknown', closingSpeed: Number(threat.motion.closingSpeed) || 0 }
          : { state: 'unknown', closingSpeed: 0 },
        lineOfSight: typeof threat.lineOfSight === 'boolean' ? threat.lineOfSight : null,
        localGeometry: threat.localGeometry && typeof threat.localGeometry === 'object'
          ? { ...threat.localGeometry }
          : null,
        attributed: threat.attributed === true,
        score: priorityScore(threat, state),
        ...tactic,
      };
    })
    .sort((a, b) => (
      b.score - a.score
      || a.distance - b.distance
      || a.id - b.id
    ));

  return {
    response: ranked[0].response,
    reason: ranked[0].reason,
    selected: ranked[0],
    considered: ranked.length,
    ranked,
  };
}
