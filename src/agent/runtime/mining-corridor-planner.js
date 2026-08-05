import Vec3 from 'vec3';

const CARDINAL_HEADINGS = Object.freeze([
  Object.freeze({ x: 1, z: 0 }),
  Object.freeze({ x: -1, z: 0 }),
  Object.freeze({ x: 0, z: 1 }),
  Object.freeze({ x: 0, z: -1 }),
]);

function cellKey(position) {
  return `${position.x}:${position.y}:${position.z}`;
}

function compareQueueEntries(left, right) {
  return left.priority - right.priority
    || left.excavation.size - right.excavation.size
    || left.route.length - right.route.length
    || left.position.y - right.position.y
    || left.position.x - right.position.x
    || left.position.z - right.position.z
    || left.order - right.order;
}

class MinHeap {
  constructor(compare) {
    this.compare = compare;
    this.values = [];
  }

  get size() {
    return this.values.length;
  }

  push(value) {
    const values = this.values;
    values.push(value);
    let index = values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(values[parent], value) <= 0) break;
      values[index] = values[parent];
      index = parent;
    }
    values[index] = value;
  }

  pop() {
    const values = this.values;
    if (values.length === 0) return null;
    const root = values[0];
    const tail = values.pop();
    if (values.length === 0) return root;

    let index = 0;
    while (true) {
      const left = (index * 2) + 1;
      const right = left + 1;
      if (left >= values.length) break;
      let child = left;
      if (right < values.length && this.compare(values[right], values[left]) < 0) {
        child = right;
      }
      if (this.compare(values[child], tail) >= 0) break;
      values[index] = values[child];
      index = child;
    }
    values[index] = tail;
    return root;
  }
}

function countOutcome(outcomes, outcome) {
  const key = String(outcome || 'unknown');
  outcomes[key] = (outcomes[key] || 0) + 1;
}

function minimumStepsToStance(position, stance, verticalDirection) {
  const verticalDelta = stance.y - position.y;
  if (verticalDirection !== 0 && verticalDelta !== 0
      && Math.sign(verticalDelta) !== verticalDirection) {
    return Number.POSITIVE_INFINITY;
  }
  const horizontal = Math.abs(stance.x - position.x) + Math.abs(stance.z - position.z);
  let minimum = Math.max(Math.abs(verticalDelta), horizontal);
  if ((minimum - horizontal) % 2 !== 0) minimum += 1;
  return minimum;
}

function nearestCompletion(position, stances, verticalDirection) {
  let steps = Number.POSITIVE_INFINITY;
  let stance = null;
  for (const candidate of stances) {
    const candidateSteps = minimumStepsToStance(position, candidate, verticalDirection);
    if (
      candidateSteps < steps
      || (
        candidateSteps === steps
        && stance
        && (
          candidate.y < stance.y
          || (candidate.y === stance.y && candidate.x < stance.x)
          || (candidate.y === stance.y && candidate.x === stance.x && candidate.z < stance.z)
        )
      )
    ) {
      steps = candidateSteps;
      stance = candidate;
    }
  }
  return { steps, stance };
}

function stateSignature(state) {
  return [
    cellKey(state.position),
    state.verticalDirection,
    [...state.excavation].sort().join(','),
    [...state.supports].sort().join(','),
  ].join('|');
}

function searchBounds(origin, stances, maxRouteSteps, maxDetour) {
  const horizontalDistance = Math.min(...stances.map(stance => (
    Math.abs(stance.x - origin.x) + Math.abs(stance.z - origin.z)
  )));
  const slack = Math.max(0, maxRouteSteps - horizontalDistance);
  const margin = Math.max(2, Math.min(maxDetour, Math.floor(slack / 2)));
  return {
    minX: Math.min(origin.x, ...stances.map(stance => stance.x)) - margin,
    maxX: Math.max(origin.x, ...stances.map(stance => stance.x)) + margin,
    minY: Math.min(origin.y, ...stances.map(stance => stance.y)),
    maxY: Math.max(origin.y, ...stances.map(stance => stance.y)),
    minZ: Math.min(origin.z, ...stances.map(stance => stance.z)) - margin,
    maxZ: Math.max(origin.z, ...stances.map(stance => stance.z)) + margin,
  };
}

function withinBounds(position, bounds) {
  return position.x >= bounds.minX && position.x <= bounds.maxX
    && position.y >= bounds.minY && position.y <= bounds.maxY
    && position.z >= bounds.minZ && position.z <= bounds.maxZ;
}

function candidateVerticalOffsets(state, stances) {
  const offsets = [0];
  if (
    state.verticalDirection !== 1
    && stances.some(stance => stance.y < state.position.y)
  ) offsets.unshift(-1);
  if (
    state.verticalDirection !== -1
    && stances.some(stance => stance.y > state.position.y)
  ) offsets.unshift(1);
  return offsets;
}

function orderedNextSteps(state, stances) {
  const candidates = [];
  for (const yOffset of candidateVerticalOffsets(state, stances)) {
    for (const heading of CARDINAL_HEADINGS) {
      const position = new Vec3(
        state.position.x + heading.x,
        state.position.y + yOffset,
        state.position.z + heading.z,
      );
      const verticalDirection = state.verticalDirection || Math.sign(yOffset);
      const completion = nearestCompletion(position, stances, verticalDirection);
      candidates.push({ position, heading, yOffset, verticalDirection, completion });
    }
  }
  return candidates.sort((left, right) => (
    left.completion.steps - right.completion.steps
    || Math.abs(left.yOffset) - Math.abs(right.yOffset)
    || left.position.y - right.position.y
    || left.position.x - right.position.x
    || left.position.z - right.position.z
  ));
}

/**
 * Search only excavation geometry. This function never moves the bot or breaks
 * a block; its caller supplies the authoritative live step assessment and
 * later hands an accepted, already-cleared cell to native Pathfinder.
 */
export function searchSupportedMiningVoxelCorridors({
  origin,
  stances,
  assessStep,
  maxRouteSteps,
  maxExcavationBlocks,
  maxExpansions = 6_000,
  maxSolutions = 12,
  maxDetour = 8,
}) {
  const goals = (stances || [])
    .filter(stance => stance && Number.isFinite(stance.x)
      && Number.isFinite(stance.y) && Number.isFinite(stance.z))
    .map(stance => new Vec3(stance.x, stance.y, stance.z));
  const routeLimit = Math.max(1, Math.floor(Number(maxRouteSteps) || 1));
  const excavationLimit = Math.max(0, Math.floor(Number(maxExcavationBlocks) || 0));
  const expansionLimit = Math.max(1, Math.floor(Number(maxExpansions) || 1));
  const solutionLimit = Math.max(1, Math.floor(Number(maxSolutions) || 1));
  if (!origin || goals.length === 0 || typeof assessStep !== 'function') {
    return {
      solutions: [],
      expandedStates: 0,
      consideredStates: 0,
      rejectionOutcomes: { corridor_input_invalid: 1 },
      expansionLimitReached: false,
    };
  }

  const start = new Vec3(origin.x, origin.y, origin.z);
  const bounds = searchBounds(start, goals, routeLimit, Math.max(2, maxDetour));
  const initialCompletion = nearestCompletion(start, goals, 0);
  const queue = new MinHeap(compareQueueEntries);
  const initial = {
    position: start,
    verticalDirection: 0,
    route: [],
    excavation: new Set(),
    supports: new Set([cellKey(start.offset(0, -1, 0))]),
    pathCells: new Set([cellKey(start)]),
    priority: initialCompletion.steps,
    order: 0,
  };
  queue.push(initial);

  const seen = new Set([stateSignature(initial)]);
  const solutions = [];
  const solutionRoutes = new Set();
  const rejectionOutcomes = {};
  let expandedStates = 0;
  let consideredStates = 1;
  let order = 1;

  while (
    queue.size > 0
    && expandedStates < expansionLimit
    && solutions.length < solutionLimit
  ) {
    const state = queue.pop();
    expandedStates += 1;
    const goal = goals.find(stance => cellKey(stance) === cellKey(state.position));
    if (goal && state.route.length > 0) {
      const routeKey = state.route.map(step => cellKey(step.position)).join('|');
      if (!solutionRoutes.has(routeKey)) {
        solutionRoutes.add(routeKey);
        solutions.push({
          route: state.route,
          stance: goal,
          excavationCount: state.excavation.size,
        });
      }
      continue;
    }
    if (state.route.length >= routeLimit) continue;

    for (const candidate of orderedNextSteps(state, goals)) {
      if (!withinBounds(candidate.position, bounds)) {
        countOutcome(rejectionOutcomes, 'corridor_bounds');
        continue;
      }
      const candidateKey = cellKey(candidate.position);
      if (state.pathCells.has(candidateKey)) {
        countOutcome(rejectionOutcomes, 'route_cell_revisited');
        continue;
      }
      const remainingSteps = routeLimit - state.route.length - 1;
      if (!Number.isFinite(candidate.completion.steps)
          || candidate.completion.steps > remainingSteps) {
        countOutcome(rejectionOutcomes, 'route_step_budget_exceeded');
        continue;
      }

      const step = {
        position: candidate.position,
        heading: candidate.heading,
        yOffset: candidate.yOffset,
      };
      const assessment = assessStep(step);
      if (!assessment?.ok) {
        countOutcome(rejectionOutcomes, assessment?.outcome || 'route_step_rejected');
        continue;
      }

      const supportKey = cellKey(candidate.position.offset(0, -1, 0));
      if (state.excavation.has(supportKey)) {
        countOutcome(rejectionOutcomes, 'route_support_excavation_conflict');
        continue;
      }
      const excavation = new Set(state.excavation);
      let supportConflict = false;
      for (const block of assessment.blocks || []) {
        if (!block?.position) continue;
        const blockKey = cellKey(block.position);
        if (state.supports.has(blockKey) || blockKey === supportKey) {
          supportConflict = true;
          break;
        }
        excavation.add(blockKey);
      }
      if (supportConflict) {
        countOutcome(rejectionOutcomes, 'route_support_excavation_conflict');
        continue;
      }
      if (excavation.size > excavationLimit) {
        countOutcome(rejectionOutcomes, 'excavation_budget_exceeded');
        continue;
      }

      const supports = new Set(state.supports);
      supports.add(supportKey);
      const pathCells = new Set(state.pathCells);
      pathCells.add(candidateKey);
      const route = [...state.route, step];
      const next = {
        position: candidate.position,
        verticalDirection: candidate.verticalDirection,
        route,
        excavation,
        supports,
        pathCells,
        priority: route.length + candidate.completion.steps + (excavation.size * 0.5),
        order,
      };
      order += 1;
      const signature = stateSignature(next);
      if (seen.has(signature)) continue;
      seen.add(signature);
      queue.push(next);
      consideredStates += 1;
    }
  }

  return {
    solutions,
    expandedStates,
    consideredStates,
    rejectionOutcomes,
    expansionLimitReached: queue.size > 0 && expandedStates >= expansionLimit,
  };
}
