# Scenario Lab fixtures — where they actually live

**The frozen fixtures are NOT in this repo.** They live outside it, they are
gitignored, and losing this path is why the scenario lab looked broken for 250
commits. Do not go looking for them under `tools/` or `tests/fixtures/`.

## doorway-corridor-follow

```
C:\Users\zerop\Development\JordanWorkspace\artifacts\minecraft-validation\fixtures\doorway-corridor-follow-v1
```

Contains `follow-world.zip`, `scenario-profile.json`, `fixture-metadata.json`.

Verified byte-identical to the frozen contract on 2026-08-16:

| File | SHA256 |
|---|---|
| `follow-world.zip` | `be49ccbd…a026b8` |
| `fixture-metadata.json` | `ddcc34ab…c49a67` |
| `scenario-profile.json` | `e82b8f03…17ae57` |
| course contract baseline | `850d7cd7…e13a42` |

World `viability-pilot-disposable`, seed `3579780610592225162`.

## Running it

```bash
npm run scenario:doctor        # ready? names whatever is blocking
npm run scenario:follow        # open-ground follow
npm run scenario:obstruction   # follow through terrain that must be broken
npm run scenario:list          # what exists and why
```

The wrapper resolves the fixture, picks a fresh output directory and sets
regression mode. Nothing else is needed.

**Allow ~3 minutes per scenario** (measured: 172s). Two request forms, each
starting an isolated stack, waiting for world_ready, measuring, tearing down and
restoring. Only ~60s is the measurement -- which is what `elapsedMs` in the
result reports, so do not read that as the command duration.

On another machine, point the fixture somewhere else:

```bash
export SCENARIO_LAB_FOLLOW_FIXTURE_ROOT="/path/to/doorway-corridor-follow-v1"
```

An explicit override wins outright and does NOT fall back to the machine-local
default -- a mistyped path fails loudly instead of silently running against a
fixture you did not choose.

The worker starts its own isolated stack. MindServer's port is derived from
`launcher-config.json` (currently 8081, formerly 8080); Paper uses 25579. Both
must be free, and `scenario:doctor` reports which process holds either.

## Two modes

**Certification mode (default).** Aborts unless the working tree is clean and
all seven bound files are byte-identical to the registered `candidateCommit`.
A result recorded this way provably describes that exact code.

**Regression mode.** Pass `--regression-mode true`. Every one of those hashes is
still computed and written into the report (`candidate_blob_checks`,
`working_tree_dirty`, `regression_mode`), but a mismatch no longer aborts. Use
this to gate ordinary development.

This distinction is the whole reason the lab sat unused for 250 commits: in
certification mode the harness can only ever verify one commit, once. Every
commit after the registered one invalidated it, and the failure was a `throw`
during setup rather than a red test, so nobody saw it.

## Preconditions the worker still enforces in BOTH modes

1. **Candidate commit must be an ancestor of HEAD.**
2. **All four fixture hashes must match** the frozen contract.
3. **Ports 8080 and 25579 must be free.**
4. **Output directory must not already exist** (`mkdir` is non-recursive and
   every write uses `flag: 'wx'`). Use a fresh timestamped directory per run.

## Do NOT record a pass in the manifest

`run-follow-field.mjs` refuses to run unless `plan.status === 'not-run'`.
Setting a scenario's status to `passed` in `scenarios.v1.json` makes it
permanently unrunnable. The outcome belongs in the result file, not the
manifest.

## Re-registering to a new HEAD

Set `candidateCommit`, bump `manifestRevision`, then recompute `manifestHash`
with `computeManifestHash` from `tools/a0/aggregate.mjs` (it hashes the manifest
with the `manifestHash` key removed). `validateScenarioManifest` recomputes and
compares, so a stale hash fails validation. Re-registered to
`12bdc21` as `regression-gate-20260816.v1` on 2026-08-16.

## Known-good baseline — read the caveat

Commit `b47117b` (2026-08-03) recorded **10/10** — 5 direct, 5 natural-language —
in 213s, p50 ~19.7s per invocation, zero deaths/timeouts/conflicts. Preserved in
`docs/archive/2026-08-16-reset/docs/architecture/machine-brain-v2/verification/doorway-corridor-follow-a0-off-anchor-fixed-20260803/`.

**That baseline was partly a false positive.** It declared
`instrumentationMode: off`, and at that commit `request-correlation` could ONLY
be satisfied from arbiter decision traces (`traceCandidates` read nothing else).
Traces are supposed to be absent in that mode. They were present anyway, because
`decision_trace.enabled` defaults to `true` and the "traces must be absent when
off" enforcement did not exist yet.

So the August run proved the **movement** (doorway, corridor, waypoint) but never
actually proved **correlation** under its declared configuration. When the
enforcement was later added, `request-correlation` became unsatisfiable by
construction — the scenario required evidence its own configuration forbade
producing — and the lab could not go green no matter how well the bot played.

Fixed 2026-08-16 by projecting `evidence.request` in `actionResultToTelemetry`,
so correlation no longer depends on instrumentation at all.

**Lesson:** a green run is not automatically a trustworthy baseline. Check which
evidence source actually satisfied each requirement.

## Fixed 2026-08-16

Both workers shelled out to `git -C $repo`, which fails with
`fatal: not a git repository: (NULL)` in this worktree because `.git` points at
a WSL-style gitdir (`/mnt/c/...`). Every provenance probe threw before any
gameplay ran. `Initialize-ScenarioGitEnvironment` now resolves and exports
`GIT_DIR`/`GIT_WORK_TREE` at worker startup.

## stone-recovery has NO fixture

`autonomous-wood-to-stone-no-safe-stance-recovery` is registered `not-run`, but
its worker needs `trial-world.zip` and a `trial-bot-memory/` directory under
`SCENARIO_LAB_STONE_FIXTURE_ROOT`. Neither exists anywhere on this machine
(checked 2026-08-16, whole-home sweep). Only `doorway-corridor-follow` is
runnable until that fixture is rebuilt.

## Three code-state pins, all now regression-gated

The worker aborts on drift in certification mode. Each of these had to be found
separately, and each on its own made the lab a one-shot notary:

1. clean working tree
2. seven bound files byte-identical to `candidateCommit`
3. `skills.js` vs the fixture's recorded `candidate.gameplay_skills_sha256`

Everything else that aborts is genuine fixture integrity or false-success
protection and stays fatal in both modes.

## MindServer port is derived, not hardcoded

The worker used to hardcode `http://localhost:8080`. `launcher-config.json` now
says `mindserver_port: 8081` (it was 8080 when the scenario was frozen), so the
run polled a dead port and died in `waiting-for-world-ready` after burning its
full three-minute budget — with the bot already logged in and spawned.

The worker now reads `mindserver_port` (then `port_scan_start`) from
`launcher-config.json`, and the free-port precheck guards that derived port so
the isolation guarantee still holds. If you change the launcher's port, the
harness follows automatically.

## The Operator Hold is REQUIRED — and it races the unload gate

Two true things that took several runs to separate.

**1. The harness requires the Hold.** `verify-follow-field.mjs` calls
`waitForHeld()` and will not begin the measured request until the bot reports:

```js
compact.held && compact.idle && !compact.pathfinding && actuatorVelocityIsQuiescent(compact)
```

That quiescent baseline is what makes the follow measurement meaningful. Removing
the Hold makes the harness time out after ~23s. Do not remove it.

**2. A held bot with no human online unloads, and it races the measurement.**
`HELD_NO_HUMAN_UNLOAD_GRACE_MS` was a hardcoded 10s in the arbiter. The worker
sleeps 3s after the Hold, then starts the harness — so the measurement usually
finished first, but not always. When it lost the race the symptom was:

```
Error: Timed out waiting for MindcraftBot held actuator quiescence. Last observation: null
cleanup: "Bot 'MindcraftBot' is not connected to the Java world."
```

Roughly one invocation in three. Because it was intermittent it looked like an
unrelated infrastructure fault, and an early attempt to "fix" it by skipping the
Hold made things worse by breaking `waitForHeld`.

**The fix:** `held_no_human_unload_grace_ms` in `settings.js`, overridable via
`MINDCRAFT_HELD_UNLOAD_GRACE_MS`. A negative value disables the unload and keeps
a held bot loaded. The worker sets `-1` for its isolated stack only; ordinary
bots keep the 10s default. This suppresses the **process unload**, never the
Operator Hold — hold duration and release vocabulary are untouched.

**Reading stack logs here:** cleanup runs on every failure path and sends its own
`!stop`, so a `!stop` followed by a disconnect in the log may be the consequence
of a failure rather than its cause. Check the phase in `active-live-status.json`
before concluding causation.

## Every component must agree on the MindServer URL

Three separate places needed the port, and each had its own copy:

| Component | How it gets the URL |
|---|---|
| `follow-field-worker.ps1` | derives from `launcher-config.json` |
| `verify-follow-field.mjs` | `--url` passed by the worker |
| `capture-agent-state.mjs` | argv[4] passed by the worker, then env, then default |

For JS tools generally, use `tools/mindserver-url.mjs`
(`resolveMindserverUrl()`): explicit URL → `SCENARIO_LAB_MINDSERVER_URL` /
`MINDSERVER_URL` → `launcher-config.json` → `http://localhost:8080`. Use
`localhost`, never the `127.0.0.1` literal — MindServer binds IPv6 loopback.

## Geometry is programmatic; the world underneath is not

Two scenarios differ in a way that decided which one survived, and the lesson
has a limit that cost a build to find.

`doorway-corridor-follow` and `obstruction-follow` lay their geometry at run
time: `provisionFixture` clears a box and places the wall, doorway and platform
with `fill` commands, restoring the baseline afterwards. Adding
`obstruction-follow` therefore cost ~90 lines and no new fixture.

`autonomous-wood-to-stone-no-safe-stance-recovery` does the opposite -- zero
`fill` commands, total dependence on a captured `trial-world.zip` plus a
`trial-bot-memory` directory. Neither exists on this machine and neither was
checked in, so it cannot be repaired without re-authoring a world.

**The limit.** An attempt on 2026-08-16 to add a typed-goal delivery course to
the follow fixture failed, and not in the harness. `goal-director` accepted the
goal and dispatched correctly:

```
!requestItemGoal ['deliver','dirt',1,'FollowTarget'] -> !collectBlocksInRange('dirt',1,64)
goalDirector: failed / no_deterministic_recovery
  "No reachable loaded surface region satisfies the requested relocation."
```

The follow fixture is a cleared platform in **ocean**. The same world logs
"Reached breathable air, but no loaded dry shore was reachable" during ordinary
self-preservation. Resource acquisition relocates to search, finds no reachable
dry surface, and fails before it ever sees a dirt patch three blocks away.

So: **lay geometry programmatically, but match the world to the behaviour.**
Following needs only local terrain and runs anywhere. Acquisition, mining,
building and anything that searches for resources needs a world that supports
it. That is why stone-recovery shipped its own world -- that was the necessary
choice for its behaviour class, not the lazy one.

A typed-goal scenario therefore needs a dry-land fixture. That is real authoring
work, not a fill command, and it gates deleting goal-director (see
ARCHITECTURE.md, Coverage gate).

## Superseded note (kept for context)

The two scenarios differ in a way that decided which one survived.

`doorway-corridor-follow` and `obstruction-follow` lay their geometry at run
time: `provisionFixture` clears a box and places the wall, doorway and platform
with `fill` commands, then restores the baseline afterwards. The frozen world is
only a flat substrate. Adding `obstruction-follow` therefore cost ~90 lines and
no new fixture at all.

`autonomous-wood-to-stone-no-safe-stance-recovery` does the opposite. It issues
zero `fill`/`setblock` commands and depends entirely on a pre-captured world
plus a `trial-bot-memory` directory holding a specific bot state. Neither exists
on this machine and neither was ever checked in, so the scenario is
unrunnable and cannot be repaired without re-authoring a world by hand.

**Build new courses the first way.** A programmatic course is readable, diffable,
survives a lost directory, and can be changed without re-freezing a hash. A
captured world is a binary that rots silently and takes its scenario with it.
