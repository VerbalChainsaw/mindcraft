import assert from 'node:assert/strict';
import test from 'node:test';

import { collectionRejectionsAreAllTimeouts } from '../src/agent/library/skills.js';

/**
 * Regression for the 2026-08-16 live defect. With dirt two blocks away and
 * plainly visible, the companion reported:
 *
 *   "Found 12 dirt candidates, but none has a safe reachable route
 *    (timeout:12). Collected 0 dirt."
 *
 * and then relocated 32 blocks to look elsewhere. Every rejection was a route
 * probe clock expiry, which proves nothing about whether a route exists.
 * Treating that as 'unreachable' is the mirror of treating an unknown as
 * permission.
 *
 * routeStatuses is DERIVED by counting candidate.routeStatus across
 * selection.ranked -- it is not a field on the selection. Fixtures must be
 * built from ranked candidates or the predicate silently sees an empty set and
 * every assertion passes vacuously.
 */
const rankedOf = (...statuses) => ({
  selected: null,
  ranked: statuses.map(routeStatus => ({ routeStatus, reachable: false })),
});

test('the fixture shape actually reaches the predicate', () => {
  // Guard against the vacuous-pass trap above: a set that must re-probe and a
  // set that must not have to disagree, or the fixtures are not being read.
  assert.notEqual(
    collectionRejectionsAreAllTimeouts(rankedOf('timeout', 'timeout')),
    collectionRejectionsAreAllTimeouts(rankedOf('noPath', 'noPath')),
    'fixtures are not reaching the predicate',
  );
});

test('an all-timeout rejection triggers a wider re-probe', () => {
  assert.equal(collectionRejectionsAreAllTimeouts(rankedOf('timeout')), true);
  assert.equal(
    collectionRejectionsAreAllTimeouts(rankedOf(...Array(12).fill('timeout'))),
    true,
    'the live case: twelve candidates, twelve clock expiries',
  );
});

test('a genuine noPath is evidence and must never be re-probed away', () => {
  assert.equal(collectionRejectionsAreAllTimeouts(rankedOf('noPath', 'noPath')), false);
  assert.equal(
    collectionRejectionsAreAllTimeouts(rankedOf('timeout', 'timeout', 'noPath')),
    false,
    'one real noPath among timeouts is still evidence',
  );
});

test('an empty or malformed selection does not re-probe', () => {
  assert.equal(
    collectionRejectionsAreAllTimeouts({ selected: null, ranked: [] }),
    false,
    'no candidates proves nothing either way',
  );
  assert.equal(collectionRejectionsAreAllTimeouts({}), false);
  assert.equal(collectionRejectionsAreAllTimeouts(null), false);
});

test('other inconclusive statuses are not silently merged into timeout', () => {
  // action_deadline and no_safe_stance are distinct outcomes; only a clock
  // expiry justifies spending a wider budget.
  assert.equal(collectionRejectionsAreAllTimeouts(rankedOf('action_deadline')), false);
  assert.equal(collectionRejectionsAreAllTimeouts(rankedOf('no_safe_stance')), false);
  assert.equal(
    collectionRejectionsAreAllTimeouts(rankedOf('timeout', 'action_deadline')),
    false,
  );
  assert.equal(collectionRejectionsAreAllTimeouts(rankedOf('unknown')), false);
});
