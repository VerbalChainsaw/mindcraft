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
const LAST_RESORT_MELEE_DISTANCE = 3.5;
const CRITICAL_HEALTH = 8;

function normalizedName(value) {
  return String(value || '').trim().toLowerCase().replace(/^minecraft:/, '');
}

function finiteDistance(value) {
  const distance = Number(value);
  return Number.isFinite(distance) && distance >= 0 ? distance : Number.POSITIVE_INFINITY;
}

/**
 * Route completion proves separation from the selected threat, not bodily
 * safety. A retreat that loses health in the critical band is not a verified
 * self-preservation success even when Pathfinder reached its goal.
 */
export function reconcileTacticalRetreatHealth(healthBefore, healthAfter) {
  const before = Math.max(0, Number(healthBefore) || 0);
  const after = Math.max(0, Number(healthAfter) || 0);
  const verified = after >= before || after > CRITICAL_HEALTH;
  return Object.freeze({
    verified,
    outcome: verified ? 'retreated' : 'retreat_health_deteriorated',
    healthBefore: before,
    healthAfter: after,
  });
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
  const retreat = (reason, desiredRange) => ({
    response: 'retreat',
    reason,
    desiredRange,
    ...(
      classification === 'melee'
      && finiteDistance(threat?.distance) <= LAST_RESORT_MELEE_DISTANCE
      && threat?.localGeometry?.onGround !== false
        ? {
            fallbackResponse: 'melee',
            fallbackReason: 'retreat_blocked_immediate_melee',
          }
        : {}
    ),
  });

  if (normalizedName(state?.objective) === 'disengage') {
    return retreat('self_preservation_disengage', 24);
  }
  if (health <= 8) {
    // Critical health changes the objective to disengagement. Clear the
    // reflex's 16-block admission envelope so the package-backed retreat buys
    // enough time for SurvivalDirector to choose cover or a player rendezvous.
    return retreat('critical_health', 24);
  }
  if (classification === 'avoid_only') {
    return retreat('avoid_only_threat', 24);
  }
  if (classification === 'explosive') {
    if (finiteDistance(threat?.distance) <= 6) {
      return retreat('immediate_explosive_threat', 24);
    }
    if (rangedReady) {
      return { response: 'ranged', reason: 'explosive_standoff', desiredRange: 8 };
    }
    if (shieldReady && meleeReady) {
      return {
        response: 'explosive_melee',
        reason: 'shielded_explosive_kite',
        desiredRange: 8,
      };
    }
    // Ten blocks clears the fuse radius but not the Creeper's pursuit or the
    // reflex admission envelope. Stopping there let the same live Creeper
    // catch up and repeatedly reacquire self-preservation until the bot died.
    // Use the shared full-disengagement distance; Pathfinder still owns the
    // physical route and may fail truthfully when the world cannot provide it.
    return retreat('explosive_without_ranged_option', 24);
  }
  if (threat?.localGeometry?.onGround === false) {
    if (rangedReady) {
      return { response: 'ranged', reason: 'airborne_standoff', desiredRange: 8 };
    }
    return retreat('airborne_without_ranged_option', 24);
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
      return retreat('unsafe_projectile_engagement', 24);
    }
  }
  if (!meleeReady && health <= 12) {
    return retreat('no_melee_weapon', 24);
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
  const targetEntityId = Number.isFinite(state?.targetEntityId)
    ? Number(state.targetEntityId)
    : null;
  const hostiles = Array.isArray(state.hostiles)
    ? state.hostiles.filter(threat => (
      threat
      && Number.isFinite(Number(threat.id))
      && (targetEntityId === null || Number(threat.id) === targetEntityId)
    ))
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
