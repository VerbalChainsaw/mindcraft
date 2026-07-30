function finitePosition(value) {
  if (!value || ![value.x, value.y, value.z].every(Number.isFinite)) return null;
  return { x: Number(value.x), y: Number(value.y), z: Number(value.z) };
}

function distanceBetween(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function coordinateKey(candidate) {
  return `${candidate.name}:${candidate.position.x}:${candidate.position.y}:${candidate.position.z}`;
}

/**
 * Choose a deterministic, bounded route through distinct observed landmark
 * types. This module owns no Minecraft state, movement, or persistence.
 */
export function chooseExplorationRoute({
  origin,
  candidates = [],
  landmarkCount = 3,
} = {}) {
  const start = finitePosition(origin);
  const requested = Math.max(1, Math.min(8, Math.floor(Number(landmarkCount) || 1)));
  if (!start) {
    return {
      outcome: 'invalid_origin',
      requested,
      selected: [],
      considered: 0,
      distinctTypes: 0,
      totalDistance: 0,
    };
  }

  const unique = new Map();
  for (const raw of Array.isArray(candidates) ? candidates : []) {
    const name = String(raw?.name || '').trim().toLowerCase().replace(/^minecraft:/, '');
    const position = finitePosition(raw?.position || raw);
    if (!name || !position) continue;
    const candidate = { name, position };
    unique.set(coordinateKey(candidate), candidate);
  }

  const nearestByType = new Map();
  for (const candidate of unique.values()) {
    const distance = distanceBetween(start, candidate.position);
    const prior = nearestByType.get(candidate.name);
    if (
      !prior
      || distance < prior.originDistance
      || (distance === prior.originDistance && coordinateKey(candidate) < coordinateKey(prior))
    ) {
      nearestByType.set(candidate.name, { ...candidate, originDistance: distance });
    }
  }

  const remaining = [...nearestByType.values()];
  const selected = [];
  let cursor = start;
  let totalDistance = 0;
  while (selected.length < requested && remaining.length > 0) {
    remaining.sort((left, right) => {
      const leftDistance = distanceBetween(cursor, left.position);
      const rightDistance = distanceBetween(cursor, right.position);
      return leftDistance - rightDistance
        || left.originDistance - right.originDistance
        || coordinateKey(left).localeCompare(coordinateKey(right));
    });
    const next = remaining.shift();
    const legDistance = distanceBetween(cursor, next.position);
    selected.push({
      name: next.name,
      position: next.position,
      legDistance,
    });
    totalDistance += legDistance;
    cursor = next.position;
  }

  return {
    outcome: selected.length >= requested ? 'route_selected' : 'insufficient_landmarks',
    requested,
    selected,
    considered: unique.size,
    distinctTypes: nearestByType.size,
    totalDistance,
    returnDistance: distanceBetween(cursor, start),
  };
}
