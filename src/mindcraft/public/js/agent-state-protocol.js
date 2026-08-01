// Shared wire contract for the server and dashboard state stream.
//
// State updates are best-effort after the first reliable snapshot: slow browser
// transports may drop a delta rather than accumulating historical movement.
// Per-agent revisions prevent a missed delta from being merged into stale state;
// the caller requests one fresh snapshot when a revision gap is observed.

// Keep v2 so an already-open dashboard from the prior release can still
// consume the additive revision fields during a rolling refresh.
const PROTOCOL_VERSION = 2;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validRevision(value, fallback = 0) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : fallback;
}

function snapshotRevisions(states, revisions) {
  const result = {};
  for (const agentName of Object.keys(states || {})) {
    result[agentName] = validRevision(revisions?.[agentName]);
  }
  return result;
}

export function createStateSnapshot(states, revisions = {}) {
  const safeStates = isRecord(states) ? states : {};
  return {
    version: PROTOCOL_VERSION,
    type: 'snapshot',
    states: safeStates,
    revisions: snapshotRevisions(safeStates, revisions),
  };
}

export function createStateDelta(agentName, set, unset, baseRevision, revision) {
  return {
    version: PROTOCOL_VERSION,
    type: 'delta',
    changes: {
      [agentName]: {
        set: isRecord(set) ? set : {},
        unset: Array.isArray(unset) ? unset.filter(key => typeof key === 'string') : [],
        baseRevision: validRevision(baseRevision),
        revision: validRevision(revision),
      },
    },
  };
}

/**
 * Apply one wire update without ever merging a patch onto the wrong prior state.
 * `resyncRequired` is true only for a version gap; malformed payloads are ignored.
 */
export function applyStateUpdate(currentStates, currentRevisions, payload) {
  const states = isRecord(currentStates) ? currentStates : {};
  const revisions = isRecord(currentRevisions) ? currentRevisions : {};
  if (!isRecord(payload)) return { states, revisions, resyncRequired: false };

  // The pre-v2 wire shape was the full state map itself.
  if (payload.version !== PROTOCOL_VERSION || !payload.type) {
    return { states: payload, revisions: {}, resyncRequired: false };
  }

  if (payload.type === 'snapshot') {
    const nextStates = isRecord(payload.states) ? payload.states : {};
    return {
      states: nextStates,
      revisions: snapshotRevisions(nextStates, payload.revisions),
      resyncRequired: false,
    };
  }

  if (payload.type !== 'delta' || !isRecord(payload.changes)) {
    return { states, revisions, resyncRequired: false };
  }

  const nextStates = { ...states };
  const nextRevisions = { ...revisions };
  let resyncRequired = false;
  for (const [agentName, patch] of Object.entries(payload.changes)) {
    if (!isRecord(patch)) continue;
    const hasRevision = patch.baseRevision !== undefined || patch.revision !== undefined;
    const baseRevision = validRevision(patch.baseRevision, -1);
    const revision = validRevision(patch.revision, -1);
    if (hasRevision && (baseRevision < 0 || revision < baseRevision || validRevision(revisions[agentName]) !== baseRevision)) {
      resyncRequired = true;
      continue;
    }
    const prior = isRecord(nextStates[agentName]) ? nextStates[agentName] : {};
    const next = { ...prior, ...(isRecord(patch.set) ? patch.set : {}) };
    for (const key of Array.isArray(patch.unset) ? patch.unset : []) {
      if (typeof key === 'string') delete next[key];
    }
    nextStates[agentName] = next;
    nextRevisions[agentName] = hasRevision ? revision : validRevision(revisions[agentName]) + 1;
  }
  return { states: nextStates, revisions: nextRevisions, resyncRequired };
}
