# Handoff — start here

Written 2026-08-16, after the Scenario Lab was repaired and five engine defects
were fixed. Read `AGENTS.md` for the working rules and `ARCHITECTURE.md` for the
design. This page is what you need in the first five minutes.

## Run the scenarios

```bash
npm run scenario:doctor        # can it run right now, and what is blocking
npm run scenario:follow        # follow a player on open ground
npm run scenario:obstruction   # follow through terrain that must be broken
npm run scenario:list          # what exists and why
```

No human is needed in the world. A second bot profile plays the player.

**Run `scenario:doctor` before diagnosing any failure.** Busy ports, a leftover
runtime lock, a damaged fixture and this worktree's WSL gitdir all produce errors
that read like product defects and are not. Each one cost a debugging cycle.

**Allow ~3 minutes per scenario** (measured 172s). Do not set a shorter timeout
and do not conclude a run has hung. `elapsedMs` in the result file is the
measured window, not the command duration.

## Things that will mislead you

**`scenario:follow` cannot catch a movement regression.** It passes with or
without digging — proven by reverting `canDig` and re-running. Use
`scenario:obstruction` after touching movement, pathfinding, follow, or
`safeMovements`.

**Read the aggregate verdict, not the per-invocation flag.** A scenario can
report `passed` on each invocation while the aggregate is `failed` on missing
evidence. This caught two overclaims in one session.

**A timeout is not a missing route.** `timeout`, `no_deterministic_recovery` and
`action_deadline` are inconclusive; `noPath` is evidence. Conflating them is what
made the companion call visible resources unreachable.

**Three tests fail on clean HEAD.** Verified against a detached checkout and
listed in `tests/BASELINE.md`. Expected: behavior 192/194, control-plane 289/290.
Do not blame your own change for those.

**`node --check` is not a correctness check.** It passed over an undefined
constant, a `const` reassignment, and two missing `let` declarations in one
session. Import the module — that catches all of them.

**Do not remove the Operator Hold from the harness.** `verify-follow-field.mjs`
waits for held actuator quiescence before measuring. Removing it was tried; the
harness simply times out.

## Open work, in order

1. **A dry-land fixture for a typed-goal scenario.** The follow world is an
   island. Acquisition relocates 32 blocks, lands in open ocean, drowns, and
   self-preservation interrupts the goal. Five runs and the full evidence chain
   are in `ARCHITECTURE.md`. Geometry can be laid programmatically with `fill`,
   but acquisition needs terrain — this part is world authoring.
2. **Then the lane collapse** (`ARCHITECTURE.md` Step 4). It is gated on that
   coverage, not on nerve: deleting 6,388 lines across five directors with
   follow-only coverage would be blind.

## Standing rules worth repeating

- **Fix the leaf.** The retired instruction to "repair the highest proven shared
  seam" is what produced 33,000 lines of runtime abstraction.
- **Unknown is not permission**, and its mirror: an inconclusive result is not a
  negative one. Both directions have caused real defects here.
- **Do not record a pass in `scenarios.v1.json`.** The runner requires
  `status: 'not-run'`; writing `passed` makes a scenario permanently unrunnable.
  The outcome belongs in the result file.
- **Verify the check could have failed.** Four things passed for the wrong
  reason in one session, including a test asserting against an empty object.

## What changed on 2026-08-16

Five gameplay defects, each confirmed against live evidence from the bot:

| Defect | Effect in play |
|---|---|
| `canDig = false` on all locomotion | could not break a dirt block to reach the player |
| Unbounded material-change blockers | stood still after a failed follow until the world changed |
| Nine independently-timed state stores | resumed work from a state that never existed |
| Persona pause above `player_directive` | dawdled ahead of an explicit instruction |
| 75ms route-probe budget, timeout read as unreachable | called visible resources unreachable and walked away |
| Goal resumed after death from any distance | marched cross-country to a recipient it could not reach |

And the harness itself: six blockers repaired, a second course that actually
catches movement regressions, `scenario:doctor`, and failure paths that now
record the fixture they observed.
