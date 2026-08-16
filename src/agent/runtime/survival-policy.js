import {
  EMERGENCY_FOOD_TIER_A,
  EMERGENCY_FOOD_TIER_B,
  UNSAFE_FOOD_ITEMS,
} from './item-family.js';

const TACTICAL_FOODS = new Set([
  'enchanted_golden_apple',
  'golden_apple',
  'golden_carrot',
]);

function numeric(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

// 0 is an ordinary safe food, 1 inflicts Hunger only, 2 inflicts Poison, which
// cannot reduce health below 1 HP. Anything still unsafe at critical need —
// pufferfish, suspicious stew — stays at 0 here and remains filtered out.
function emergencyFoodTier(name) {
  if (EMERGENCY_FOOD_TIER_A.has(name)) return 1;
  if (EMERGENCY_FOOD_TIER_B.has(name)) return 2;
  return 0;
}

/**
 * Shared so a caller deciding whether a night-only scan is worth running uses
 * the same window this policy reads it back with. Two copies of the boundary
 * would drift apart silently.
 */
export function isNightTime(timeOfDay) {
  const time = numeric(Number(timeOfDay), 0);
  return time >= 12542 && time < 23460;
}

export function rankFoodCandidates(items = [], situation = {}, policy = {}) {
  const critical = numeric(situation.hunger, 20) <= numeric(policy.criticalFood, 6)
    || numeric(situation.health, 20) <= 8;
  return items
    .filter((item) => (
      item
      && typeof item.name === 'string'
      && numeric(item.count) > 0
      && numeric(item.foodPoints) > 0
      && (!UNSAFE_FOOD_ITEMS.has(item.name) || (critical && emergencyFoodTier(item.name) > 0))
      && (critical || !TACTICAL_FOODS.has(item.name))
    ))
    .map((item) => ({
      name: item.name,
      count: numeric(item.count),
      foodPoints: numeric(item.foodPoints),
      saturation: numeric(item.saturation),
      emergencyTier: emergencyFoodTier(item.name),
    }))
    // Tier ordering runs ahead of food points so an ordinary safe food is always
    // preferred over a desperation food that happens to restore more hunger.
    // With no emergency candidates every tier is 0 and this sorts as before.
    .sort((left, right) => (
      left.emergencyTier - right.emergencyTier
      || right.foodPoints - left.foodPoints
      || right.saturation - left.saturation
      || left.name.localeCompare(right.name)
    ));
}

export function chooseSurvivalIntent(situation = {}, policy = {}) {
  if (policy.mode === 'off' || situation.held || situation.urgentDanger) return null;
  const health = numeric(situation.health, 20);
  if (health <= 8) {
    const healing = (Array.isArray(situation.healingConsumables)
      ? situation.healingConsumables
      : [])
      .filter(candidate => candidate?.item === 'healing_potion' && numeric(candidate.count) > 0)
      .sort((left, right) => (
        numeric(right.potency) - numeric(left.potency)
        || String(left.effect || '').localeCompare(String(right.effect || ''))
      ))[0];
    if (healing) {
      return {
        kind: 'heal',
        item: healing.item,
        reason: 'critical_health_healing',
        ...(situation.idle !== true ? { preempt: true } : {}),
      };
    }
  }
  // Physical safety outranks sustenance once health is critical, and this must
  // sit ahead of the hunger branch below: that branch always returns, so while
  // it ran first an injured, hungry, exposed companion could never reach the
  // shelter or sleep rungs at all. Sealing in place needs no route, no food and
  // no weapon, so it stays available exactly when every navigation-shaped
  // recovery has already failed.
  // Low health alone is not danger. Bunkering in clear daylight while a player
  // is walking over with food would be absurd, so this also requires live
  // evidence that the body is actually exposed to harm.
  const criticallyExposed = situation.recentDamage === true
    || (Array.isArray(situation.hostiles) && situation.hostiles.length > 0)
    || (
      isNightTime(numeric(situation.timeOfDay, 0))
      && String(situation.difficulty || '').toLowerCase() !== 'peaceful'
    );
  const criticalRoutedShelter = (Array.isArray(situation.shelters) ? situation.shelters : [])
    .filter(candidate => (
      candidate?.reachable === true
      && candidate?.safe === true
      && ['success', 'already_at_stance'].includes(candidate?.pathStatus)
    ))
    .sort((left, right) => numeric(left.distance, Infinity) - numeric(right.distance, Infinity))[0];
  if (
    policy.mode === 'full'
    && policy.shelter !== 'off'
    && health <= 8
    && criticallyExposed
    && situation.sheltered !== true
  ) {
    if (criticalRoutedShelter) {
      return {
        kind: 'seek_shelter',
        target: {
          name: criticalRoutedShelter.name || 'shelter',
          x: criticalRoutedShelter.x,
          y: criticalRoutedShelter.y,
          z: criticalRoutedShelter.z,
          distance: criticalRoutedShelter.distance,
        },
        reason: 'critical_health_exposed',
        ...(situation.idle !== true ? { preempt: true } : {}),
      };
    }
    // Selection requires a current world/inventory feasibility receipt. A
    // missing synthetic field is unknown, never permission to mutate terrain.
    if (situation.canShelterInPlace === true) {
      return {
        kind: 'shelter_in_place',
        reason: 'critical_health_exposed',
        ...(situation.idle !== true ? { preempt: true } : {}),
      };
    }
    // Continue down the bodily ladder to carried food or another immediate
    // option; inability to mutate terrain is not permission to wait.
  }
  const hunger = numeric(situation.hunger, 20);
  if (hunger <= numeric(policy.eatAt, 14)) {
    const candidates = rankFoodCandidates(situation.food, situation, policy);
    const critical = hunger <= numeric(policy.criticalFood, 6)
    || health <= 8;
    const availableFoodPoints = candidates.reduce(
      (total, candidate) => total + (candidate.count * candidate.foodPoints),
      0,
    );
    const reserve = numeric(policy.reserveFoodPoints, 12);
    const food = critical
      ? candidates[0]
      : candidates.find(candidate => availableFoodPoints - candidate.foodPoints >= reserve);
    if (food) {
      return {
        kind: 'eat',
        item: food.name,
        reason: critical ? 'critical_hunger' : 'low_hunger',
        ...(critical && situation.idle !== true ? { preempt: true } : {}),
      };
    }
    if (situation.idle !== true && !critical) return null;
    if (candidates.length > 0 && !critical) {
      if (policy.mode === 'full') {
        return {
          kind: 'acquire_food',
          targetFoodPoints: Math.max(24, reserve),
          reason: 'food_reserve_low',
        };
      }
      return {
        kind: 'wait',
        reason: 'preserving_food_reserve',
        retryable: true,
      };
    }
    if (policy.mode === 'full') {
      return {
        kind: 'acquire_food',
        targetFoodPoints: critical ? 1 : Math.max(24, reserve),
        reason: 'missing_safe_food',
        ...(critical && situation.idle !== true ? { preempt: true } : {}),
      };
    }
    return {
      kind: 'wait',
      reason: 'missing_safe_food',
      retryable: true,
    };
  }
  if (situation.idle !== true) return null;
  // A competent player at recoverable health does not forage at night with a
  // safe bed nearby. Sleeping skips the hostile window at no cost and resets the
  // insomnia that spawns phantoms, while night foraging is what walked the body
  // into open water at low health. Critical need still outranks rest, because
  // starvation and a critical wound cannot be slept off.
  const nightRestAvailable = policy.mode === 'full'
    && policy.sleep === 'safe'
    && situation.dimension === 'overworld'
    && isNightTime(numeric(situation.timeOfDay, 0))
    && health > 8
    && hunger > numeric(policy.criticalFood, 6)
    && (Array.isArray(situation.beds) ? situation.beds : [])
      .some(candidate => candidate?.reachable === true && candidate?.safe === true);
  if (
    policy.mode === 'full'
    && health <= 14
    && !nightRestAvailable
  ) {
    if (situation.recentDamage === true && situation.sheltered !== true) {
      const recoveryShelter = (Array.isArray(situation.shelters) ? situation.shelters : [])
        .filter(candidate => candidate?.reachable === true && candidate?.safe === true)
        .sort((left, right) => numeric(left.distance, Infinity) - numeric(right.distance, Infinity))[0];
      if (recoveryShelter) {
        return {
          kind: 'seek_shelter',
          target: {
            name: recoveryShelter.name || 'shelter',
            x: recoveryShelter.x,
            y: recoveryShelter.y,
            z: recoveryShelter.z,
            distance: recoveryShelter.distance,
          },
          reason: 'injury_recovery_shelter',
        };
      }
    }
    if (hunger < 18) {
      const food = rankFoodCandidates(situation.food, situation, policy)[0];
      if (food) {
        return {
          kind: 'eat',
          item: food.name,
          reason: 'injury_recovery',
        };
      }
      return {
        kind: 'acquire_food',
        targetFoodPoints: health <= 8
          ? 1
          : Math.max(24, numeric(policy.reserveFoodPoints, 12)),
        reason: 'recovery_missing_food',
      };
    }
    return {
      kind: 'wait',
      reason: 'regenerating_health',
      retryable: true,
    };
  }
  if (policy.mode === 'full' && policy.armor !== 'off') {
    const armor = Array.isArray(situation.armor) ? situation.armor : [];
    const equippedBySlot = new Map(
      armor
        .filter(candidate => candidate?.equipped === true && typeof candidate.slot === 'string')
        .map(candidate => [candidate.slot, numeric(candidate.score)]),
    );
    const upgrade = armor
      .filter(candidate => (
        candidate
        && candidate.equipped !== true
        && typeof candidate.name === 'string'
        && typeof candidate.slot === 'string'
        && numeric(candidate.score) > numeric(equippedBySlot.get(candidate.slot))
      ))
      .sort((left, right) => (
        numeric(right.score) - numeric(left.score)
        || left.name.localeCompare(right.name)
      ))[0];
    if (upgrade) {
      return {
        kind: 'equip',
        item: upgrade.name,
        reason: 'armor_upgrade',
      };
    }
  }
  const timeOfDay = numeric(situation.timeOfDay, 0);
  const night = isNightTime(timeOfDay);
  const unsafeNight = night && String(situation.difficulty || '').toLowerCase() !== 'peaceful';
  if (
    policy.mode === 'full'
    && policy.sleep === 'safe'
    && night
    && situation.dimension === 'overworld'
  ) {
    const bed = (Array.isArray(situation.beds) ? situation.beds : [])
      .filter((candidate) => candidate?.reachable === true && candidate?.safe === true)
      .sort((left, right) => numeric(left.distance, Infinity) - numeric(right.distance, Infinity))[0];
    if (bed) {
      return {
        kind: 'sleep',
        // The dimension travels with the target so the executor can bind this
        // exact bed. A bare `!goToBed` re-searches and takes the nearest one,
        // which silently substitutes a different bed than the one selected.
        target: {
          name: bed.name,
          x: bed.x,
          y: bed.y,
          z: bed.z,
          distance: bed.distance,
          dimension: situation.dimension,
        },
        reason: 'safe_night',
      };
    }
    if (policy.shelter === 'off' || situation.sheltered === true) {
      return {
        kind: 'wait',
        reason: 'no_safe_reachable_bed',
        retryable: true,
      };
    }
  }
  const dangerousWeather = situation.weather === 'Thunderstorm';
  if (
    policy.mode === 'full'
    && policy.shelter !== 'off'
    && situation.sheltered !== true
    && (unsafeNight || dangerousWeather)
  ) {
    const shelter = (Array.isArray(situation.shelters) ? situation.shelters : [])
      .filter(candidate => candidate?.reachable === true && candidate?.safe === true)
      .sort((left, right) => numeric(left.distance, Infinity) - numeric(right.distance, Infinity))[0];
    if (shelter) {
      return {
        kind: 'seek_shelter',
        target: {
          name: shelter.name || 'shelter',
          x: shelter.x,
          y: shelter.y,
          z: shelter.z,
          distance: shelter.distance,
        },
        reason: dangerousWeather ? 'dangerous_weather' : 'unsafe_night',
      };
    }
    if (policy.shelter === 'emergency') {
      return {
        kind: 'shelter_work_order',
        blueprint: 'emergency_3x3',
        reason: dangerousWeather ? 'dangerous_weather' : 'unsafe_night',
      };
    }
    return {
      kind: 'wait',
      reason: dangerousWeather ? 'no_safe_storm_shelter' : 'no_safe_night_shelter',
      retryable: true,
    };
  }
  if (policy.mode === 'full' && policy.usefulDrops !== 'ignore') {
    const usefulDrop = (Array.isArray(situation.usefulDrops) ? situation.usefulDrops : [])
      .filter(candidate => typeof candidate?.name === 'string' && numeric(candidate.distance, Infinity) <= 12)
      .sort((left, right) => numeric(left.distance, Infinity) - numeric(right.distance, Infinity))[0];
    if (usefulDrop) {
      return {
        kind: 'collect_useful_drop',
        target: {
          name: usefulDrop.name,
          id: usefulDrop.id,
          distance: usefulDrop.distance,
        },
        reason: 'useful_item_nearby',
      };
    }
  }
  return null;
}
