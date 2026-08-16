/**
 * In-flight activity state expires; durable knowledge does not.
 *
 * Kevin persists nine independent stores, each written whenever its own owner
 * happens to change. On 2026-08-16 a single bot directory held `home-state`
 * from Aug 6, `job-state` from 02:14, `goal-state` from 04:54, `agenda` from
 * 11:14 and `companion-directive` from 11:23. Loading all nine together
 * reconstructed a companion state that never existed at any single moment, and
 * an agenda entry from a finished session could resurface as live work.
 *
 * The split that matters is not per-file atomicity -- every store already
 * writes atomically -- but what the data MEANS:
 *
 *   Knowledge  (home, landmarks, verified procedures, remembered facts)
 *              accumulates. An old timestamp is correct and must be preserved.
 *
 *   Activity   (active work order, typed goal, agenda queue, standing
 *              directive) describes what the companion is doing RIGHT NOW.
 *              Reviving it from a previous play session is never right.
 *
 * A short window still lets a crash-restart resume mid-task, which is the one
 * case where restoring in-flight work genuinely helps. Anything older is a new
 * session: start clean and let the player ask again. See ARCHITECTURE.md.
 *
 * Operator Hold is deliberately NOT activity state. A persisted Hold is an
 * explicit human decision and never expires on its own.
 */

/**
 * How long persisted in-flight activity may be restored after it was written.
 * Sized to cover a crash-and-relaunch, not a break between play sessions.
 */
export const ACTIVITY_STATE_MAX_AGE_MS = 15 * 60 * 1000;

/**
 * True when persisted activity is too old to restore.
 *
 * A missing or unreadable `savedAt` is treated as stale rather than fresh:
 * absent evidence is not permission to revive a stranger's work order.
 */
export function isStaleActivityState(savedAt, {
  now = Date.now(),
  maxAgeMs = ACTIVITY_STATE_MAX_AGE_MS,
} = {}) {
  const stamp = Number(savedAt);
  if (!Number.isFinite(stamp) || stamp <= 0) return true;
  const currentTime = Number(now);
  const limit = Number(maxAgeMs);
  if (!Number.isFinite(currentTime) || !Number.isFinite(limit) || limit <= 0) return true;
  // A stamp from the future means a clock change, not fresh work.
  if (stamp > currentTime) return stamp - currentTime > limit;
  return currentTime - stamp > limit;
}

/**
 * Bounded, player-readable reason for dropping restored activity, suitable for
 * a store's `lastError`-style diagnostic field and for telemetry.
 */
export function staleActivityReason(kind, savedAt, { now = Date.now() } = {}) {
  const stamp = Number(savedAt);
  if (!Number.isFinite(stamp) || stamp <= 0) {
    return `Discarded persisted ${kind}: no usable save timestamp.`;
  }
  const ageMinutes = Math.max(0, Math.round((Number(now) - stamp) / 60000));
  return `Discarded persisted ${kind}: ${ageMinutes} minute(s) old, older than the ${
    Math.round(ACTIVITY_STATE_MAX_AGE_MS / 60000)
  }-minute activity window.`;
}
