const UNSAFE_FOODS = new Set([
  'chicken',
  'poisonous_potato',
  'pufferfish',
  'rotten_flesh',
  'spider_eye',
  'suspicious_stew',
]);

const TACTICAL_FOODS = new Set([
  'enchanted_golden_apple',
  'golden_apple',
  'golden_carrot',
]);

function numeric(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
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
      && !UNSAFE_FOODS.has(item.name)
      && (critical || !TACTICAL_FOODS.has(item.name))
    ))
    .map((item) => ({
      name: item.name,
      count: numeric(item.count),
      foodPoints: numeric(item.foodPoints),
      saturation: numeric(item.saturation),
    }))
    .sort((left, right) => (
      right.foodPoints - left.foodPoints
      || right.saturation - left.saturation
      || left.name.localeCompare(right.name)
    ));
}

export function chooseSurvivalIntent(situation = {}, policy = {}) {
  if (policy.mode === 'off' || situation.held || situation.urgentDanger) return null;
  const hunger = numeric(situation.hunger, 20);
  if (hunger <= numeric(policy.eatAt, 14)) {
    const candidates = rankFoodCandidates(situation.food, situation, policy);
    const critical = hunger <= numeric(policy.criticalFood, 6)
      || numeric(situation.health, 20) <= 8;
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
        targetFoodPoints: Math.max(24, reserve),
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
  if (
    policy.mode === 'full'
    && numeric(situation.health, 20) <= 14
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
        targetFoodPoints: Math.max(24, numeric(policy.reserveFoodPoints, 12)),
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
  const night = timeOfDay >= 12542 && timeOfDay < 23460;
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
        target: {
          name: bed.name,
          x: bed.x,
          y: bed.y,
          z: bed.z,
          distance: bed.distance,
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
    && (night || dangerousWeather)
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
