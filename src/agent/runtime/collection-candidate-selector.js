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
    'timeout',
    'probe_error',
    'unknown',
    'unsafe_drop_support',
    'no_safe_stance',
    'target_unloaded',
]);

function finiteOr(value, fallback=0) {
    return Number.isFinite(value) ? value : fallback;
}

function rounded(value) {
    return Math.round(value * 100) / 100;
}

function scoreCandidate(candidate) {
    const routeStatus = String(candidate.routeStatus || 'unknown');
    const reachable = !UNREACHABLE_ROUTE_STATUSES.has(routeStatus);
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
export function rankCollectionCandidates(candidates) {
    return (Array.isArray(candidates) ? candidates : [])
        .map((candidate, originalIndex) => ({
            ...scoreCandidate(candidate),
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
