# Handoff — start here

Written 2026-08-16, after the Scenario Lab was repaired and five engine defects
were fixed. Read `AGENTS.md` for the working rules and `ARCHITECTURE.md` for the
design. This page is what you need in the first five minutes.

## Run the scenarios

```bash
npm run scenario:doctor        # can it run right now, and what is blocking
npm run scenario:follow        # follow a player on open ground
npm run scenario:obstruction   # follow through terrain that must be broken
npm run scenario:deliver       # typed goal: acquire an item and hand it over
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

1. **A scenario for a multi-step agenda request.** This is now the only thing
   gating Step 4. `agenda-director` is 2,153 lines with no live coverage.
   Copy the deliver course: it cost a generated world recipe and ~200 lines,
   no new framework. Read the generated-fixture section of
   `tools/scenario-lab/FIXTURES.md` first.
2. **Then the lane collapse** (`ARCHITECTURE.md` Step 4). Still gated, and now
   on exactly one missing scenario rather than two. Deleting `agenda-director`
   with nothing exercising a multi-step request would be blind in the same way
   follow-only coverage was.

The typed-goal half of that gate closed on 2026-08-17 — see below.

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

## What changed on 2026-08-17

**The typed-goal course passes.** `npm run scenario:deliver` exits 0 on HEAD:
both request forms, `FollowTarget` 0 -> 1 dirt, zero safety violations, no
deaths. It is the first scenario that exercises `goal-director` rather than
`!followPlayer`.

The blocker was never the harness. It was the world: the follow fixture is an
island, so acquisition relocated 32 blocks into open ocean and drowned. The
previous conclusion — recorded in three docs — was that this needed a
hand-authored dry-land world. It did not. Paper generates one from
`server.properties`, so the fixture is a **superflat layer recipe checked into
the repo**, not a captured `.zip`:

- `tools/scenario-lab/fixtures/deliver-item-flat-v1/` — text, diffable, cannot
  rot the way `stone-recovery`'s missing `trial-world.zip` did, and needs no
  machine-local path.
- 164 layers put the top solid block at y=99, so the standing surface is y=100
  — exactly where the existing course constants already were. **No coordinate
  changes.** Get that arithmetic wrong and the course floats.
- `scenario:doctor` checks the recipe hash against the manifest, so an edited
  recipe fails at the door rather than deep inside the worker.

**Two harness assumptions were follow-shaped and had to be branched**, not
loosened: the terminal-result listener only ever accepted `action:followPlayer`
(the deliver course ends on `action:givePlayer`), and the worker's false-success
guard required `doorwayCrossed` / `corridorCompleted` / `finalWaypointReached`
— follow criteria the deliver recipient can never satisfy because it does not
move. The deliver branch is strictly stronger: it also requires that the item
physically changed hands.

**The fixture premise is measured, not assumed.** Four dry-land probes at 40
blocks — past the 32-block relocation — plus a ground probe under the course,
all required by `fixtureVerified`. Verified discriminating by replaying the
2026-08-16 island runs through the current evidence adapter:
`dry-land-fixture-confirmed` and `item-delivered-to-recipient` are absent there
and present on the generated fixture.

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
