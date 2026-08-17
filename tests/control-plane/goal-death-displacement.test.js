import assert from 'node:assert/strict';
import test from 'node:test';

import { deathDisplacedGoalBeyondReach } from '../../src/agent/runtime/goal-director.js';

/**
 * Regression for the 2026-08-16 live defect. The companion died mid-goal,
 * respawned ~1,400 blocks away at world spawn, and resumed from there: it
 * collected near spawn, then tried to walk back to the recipient across open
 * ocean until it timed out and drowned. Nothing checked whether the goal was
 * still achievable from the new position.
 *
 * The threshold is anchored to what the goal already travels voluntarily
 * (ACQUISITION_REGION_RELOCATION_DISTANCE 32, up to three hops ~96), not picked
 * at random.
 */
const botAt = (x, y, z, players = {}) => ({ entity: { position: { x, y, z } }, players });
const playerAt = (name, x, y, z) => ({ [name]: { entity: { position: { x, y, z } } } });

const diedGoal = extra => ({
  requester: 'phixxation',
  evidence: { code: 'goal_owner_died' },
  ...extra,
});

test('a death that lands far from the recipient stops the goal', () => {
  const goal = diedGoal({ destination: { kind: 'player', player: 'phixxation' } });
  const bot = botAt(-382, 65, -54, playerAt('phixxation', 1029, 100, 1010));
  assert.equal(deathDisplacedGoalBeyondReach(goal, bot), true, 'the live 1,400-block case');
});

test('dying near the work resumes normally', () => {
  const goal = diedGoal({ destination: { kind: 'player', player: 'phixxation' } });
  // 20 blocks away: an ordinary death during the job, well inside the ~96 the
  // goal would relocate on its own. Abandoning here would be worse than useless.
  const bot = botAt(1049, 100, 1010, playerAt('phixxation', 1029, 100, 1010));
  assert.equal(deathDisplacedGoalBeyondReach(goal, bot), false);
});

test('the boundary is the documented threshold, not an accident', () => {
  const goal = diedGoal({ destination: { kind: 'player', player: 'phixxation' } });
  const inside = botAt(1029 + 127, 100, 1010, playerAt('phixxation', 1029, 100, 1010));
  const outside = botAt(1029 + 129, 100, 1010, playerAt('phixxation', 1029, 100, 1010));
  assert.equal(deathDisplacedGoalBeyondReach(goal, inside), false);
  assert.equal(deathDisplacedGoalBeyondReach(goal, outside), true);
});

test('an acquire goal anchors on the requester when there is no destination', () => {
  const goal = diedGoal({});
  const far = botAt(-382, 65, -54, playerAt('phixxation', 1029, 100, 1010));
  const near = botAt(1035, 100, 1010, playerAt('phixxation', 1029, 100, 1010));
  assert.equal(deathDisplacedGoalBeyondReach(goal, far), true);
  assert.equal(deathDisplacedGoalBeyondReach(goal, near), false);
});

test('an unobservable anchor never abandons the goal', () => {
  // Unknown distance is not "too far". Abandoning on missing evidence is the
  // failure this repo keeps repeating; the goal is left alone instead.
  const goal = diedGoal({ destination: { kind: 'player', player: 'phixxation' } });
  assert.equal(deathDisplacedGoalBeyondReach(goal, botAt(0, 0, 0, {})), false, 'player offline');
  assert.equal(
    deathDisplacedGoalBeyondReach(goal, { players: playerAt('phixxation', 1029, 100, 1010) }),
    false,
    'own position unknown',
  );
  assert.equal(deathDisplacedGoalBeyondReach(goal, null), false);
  assert.equal(deathDisplacedGoalBeyondReach(null, botAt(0, 0, 0)), false);
});

test('only a death triggers this; other failures are untouched', () => {
  const far = botAt(-382, 65, -54, playerAt('phixxation', 1029, 100, 1010));
  for (const code of ['skill_unreachable', 'resource_not_found', 'interrupted', '']) {
    assert.equal(
      deathDisplacedGoalBeyondReach({ requester: 'phixxation', evidence: { code } }, far),
      false,
      `${code || '(empty)'} must not be treated as a death displacement`,
    );
  }
});
