const ROUTE_PENALTIES = Object.freeze({
    direct: 0,
    success: 0,
    unknown: 35,
    partial: 55,
    timeout: 75,
    probe_error: 90,
});

const UNREACHABLE_ROUTE_STATUSES = new Set([
    'noPath',
    'action_deadline',
    'unreachable',
    'unsafe_drop_support',
    'no_safe_stance',
    'target_unloaded',
]);
const INCONCLUSIVE_ROUTE_STATUSES = new Set(['timeout', 'probe_error', 'unknown']);

const REQUESTER_AREA_EXTRACTION_RADIUS = 8;
export const WHOLE_TREE_LOCAL_SCORE_DELTA = 24;
const TERRAIN_EXTRACTION_TARGETS = new Set([
    'andesite',
    'basalt',
    'blackstone',
    'calcite',
    'clay',
    'cobblestone',
    'deepslate',
    'diorite',
    'dirt',
    'dripstone_block',
    'end_stone',
    'granite',
    'gravel',
    'mud',
    'netherrack',
    'obsidian',
    'sand',
    'stone',
    'tuff',
]);

function terrainExtractionTarget(requestedName) {
    const name = String(requestedName || '').trim().toLowerCase();
    return TERRAIN_EXTRACTION_TARGETS.has(name)
        || name.endsWith('_ore')
        || name === 'ancient_debris';
}

/**
 * Keep opportunistic terrain extraction out of the loaded requester's
 * immediate shared area. This is selection policy, not movement policy:
 * Pathfinder still owns the route to whichever source remains eligible.
 */
export function requesterTerrainCollectionExclusion(requestedName, requesterPosition) {
    if (!terrainExtractionTarget(requestedName)) return null;
    if (![requesterPosition?.x, requesterPosition?.y, requesterPosition?.z].every(Number.isFinite)) {
        return null;
    }
    return {
        x: requesterPosition.x,
        y: requesterPosition.y,
        z: requesterPosition.z,
        radius: REQUESTER_AREA_EXTRACTION_RADIUS,
        reason: 'active_requester_shared_area',
    };
}

function finiteOr(value, fallback=0) {
    return Number.isFinite(value) ? value : fallback;
}

function rounded(value) {
    return Math.round(value * 100) / 100;
}

function scoreCandidate(candidate, { inconclusive = 'strict' } = {}) {
    const routeStatus = String(candidate.routeStatus || 'unknown');
    const reachable = !UNREACHABLE_ROUTE_STATUSES.has(routeStatus)
        && (inconclusive === 'advisory' || !INCONCLUSIVE_ROUTE_STATUSES.has(routeStatus));
    const routeCost = Math.max(0, finiteOr(candidate.routeCost));
    const distance = Math.max(0, finiteOr(candidate.distance));
    const verticalDelta = Math.max(0, finiteOr(candidate.verticalDelta));
    const hazardScore = Math.max(0, finiteOr(candidate.hazardScore));
    const breakTimeMs = Math.max(0, finiteOr(candidate.breakTimeMs));
    const breakdown = {
        route: reachable
            ? finiteOr(ROUTE_PENALTIES[routeStatus], ROUTE_PENALTIES.unknown)
                + Math.min(80, routeCost * 2)
            : Number.POSITIVE_INFINITY,
        distance: Math.min(80, distance * 2),
        vertical: Math.min(40, verticalDelta * 4),
        hazard: Math.min(300, hazardScore * 100),
        break: Math.min(20, breakTimeMs / 250),
    };
    const score = reachable
        ? Object.values(breakdown).reduce((sum, value) => sum + value, 0)
        : Number.POSITIVE_INFINITY;
    return {
        ...candidate,
        routeStatus,
        reachable,
        score: Number.isFinite(score) ? rounded(score) : score,
        scoreBreakdown: Object.fromEntries(
            Object.entries(breakdown).map(([key, value]) => [
                key,
                Number.isFinite(value) ? rounded(value) : value,
            ]),
        ),
    };
}

function coordinate(candidate, axis) {
    return finiteOr(candidate?.position?.[axis], Number.POSITIVE_INFINITY);
}

/**
 * Rank already-observed collection targets. Lower scores are better.
 *
 * This module deliberately owns no Minecraft state, memory, or scheduling.
 * Callers provide bounded physical observations and retain action ownership.
 */
export function rankCollectionCandidates(candidates, options = {}) {
    return (Array.isArray(candidates) ? candidates : [])
        .map((candidate, originalIndex) => ({
            ...scoreCandidate(candidate, options),
            originalIndex,
        }))
        .sort((left, right) => (
            Number(right.reachable) - Number(left.reachable)
            || left.score - right.score
            || finiteOr(left.distance, Number.POSITIVE_INFINITY)
                - finiteOr(right.distance, Number.POSITIVE_INFINITY)
            || coordinate(left, 'y') - coordinate(right, 'y')
            || coordinate(left, 'x') - coordinate(right, 'x')
            || coordinate(left, 'z') - coordinate(right, 'z')
            || left.originalIndex - right.originalIndex
        ));
}

/**
 * Choose a sensible whole-tree yield without turning a quantity request into
 * a long-distance scavenger hunt. Native route scoring establishes the local
 * envelope; connected-component size only ranks trees inside that envelope.
 * Callers retain component discovery and execution ownership.
 */
export function rankWholeTreeCandidates(candidates, remainingQuantity, {
    maxScoreDelta = WHOLE_TREE_LOCAL_SCORE_DELTA,
} = {}) {
    const remaining = Math.max(1, Math.floor(finiteOr(remainingQuantity, 1)));
    const scoreDelta = Math.max(0, Math.min(200, finiteOr(
        maxScoreDelta,
        WHOLE_TREE_LOCAL_SCORE_DELTA,
    )));
    const eligible = (Array.isArray(candidates) ? candidates : [])
        .map((candidate, originalIndex) => ({ ...candidate, originalIndex }))
        .filter(candidate => (
            candidate.reachable === true
            && Number.isFinite(candidate.score)
            && Number.isInteger(candidate.componentSize)
            && candidate.componentSize > 0
        ));
    if (eligible.length === 0) return [];

    const bestRouteScore = Math.min(...eligible.map(candidate => candidate.score));
    return eligible
        .filter(candidate => candidate.score <= bestRouteScore + scoreDelta)
        .sort((left, right) => (
            Math.abs(left.componentSize - remaining)
                - Math.abs(right.componentSize - remaining)
            || Number(right.componentSize >= remaining)
                - Number(left.componentSize >= remaining)
            || left.score - right.score
            || finiteOr(left.distance, Number.POSITIVE_INFINITY)
                - finiteOr(right.distance, Number.POSITIVE_INFINITY)
            || coordinate(left, 'y') - coordinate(right, 'y')
            || coordinate(left, 'x') - coordinate(right, 'x')
            || coordinate(left, 'z') - coordinate(right, 'z')
            || left.originalIndex - right.originalIndex
        ));
}

/**
 * Preserve one deterministic physical identity when a ranked collection set
 * has no usable candidate. Recovery memory cannot exclude a failed source if
 * the executor collapses its evidence back to the requested item name.
 */
export function bindRejectedCollectionTarget(selection, fallbackName) {
    const candidate = selection?.ranked?.find(entry => {
        const position = entry?.block?.position || entry?.position;
        return position && [position.x, position.y, position.z].every(Number.isFinite);
    });
    const position = candidate?.block?.position || candidate?.position;
    if (!position) return { name: fallbackName };
    return {
        name: candidate?.block?.name || candidate?.name || fallbackName,
        x: position.x,
        y: position.y,
        z: position.z,
    };
}
