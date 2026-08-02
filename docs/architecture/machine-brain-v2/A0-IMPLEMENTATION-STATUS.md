# A0 Implementation Status

Status: diagnostic and offline Scenario Lab contract foundations implemented; A0 measurement evidence is not complete.

## Confirmed implementation

| Slice | Commit | Confirmed scope |
|---|---|---|
| A0.1 | `492aa2e0140a4aef792082c110eb55dbb71b7307` | Adds explicit action acquire/release lifecycle attribution through the existing `DecisionTraceRecorder`. |
| A0.2 | `1581aa8d2d7f7aafbedf8ed16b890f8f7c7f05b7` | Adds bounded command-request correlation with distinct `explicit-command`, `deterministic-nl`, `model-selected`, `directive-resume`, and `internal` origins. Request context uses an `AsyncLocalStorage` separate from action-owner context. |
| Cleanup | `93372d7c7a9dec7d8762c6824dd396000da79c61` | Removes an accidentally tracked zero-byte verifier artifact. |

Both implementation worktrees were clean at this checkpoint. Nothing was pushed.

## Validation record

- A0.1 focused validation passed 15/15 tests.
- A0.1 broader `check:behavior` passed 104/104 tests plus lint and syntax checks.
- A0.2's targeted three-file command exited 0 and comprised 22 tests: 7 correlation tests plus the prior 15 tests.
- A0.2's broader `check:behavior` exited 0 and covered the configured 104-test behavior suite plus lint and syntax checks. That command does not include the new correlation test file, so the separate targeted command remains required.

## Release 0.1 Scenario Lab foundation

The hashed `scenario-lab.manifest.v1` catalog and offline list/validate/plan CLI define the five Release 0.1 families against candidate commit `bc8139cea8771999d133f3f32db68d07de01de7f`. They reuse A0 canonical JSON/hash and outcome semantics. All families remain unavailable because safe adapters and immutable fixture hashes are absent. No live execution, valid A0 invocation, evidence freeze, promotion, or lab-complete claim was added.

## Current A0 coverage

| A0 evidence surface | Status | Current record |
|---|---|---|
| Request correlation, selected skill, route, and arguments | Covered | Bounded request context reaches the linked action trace. |
| Owner, priority, acquire, release, and terminal outcome | Covered | Existing decision traces explicitly attribute serialized action lifecycle and linked outcome. |
| Common precondition, observation, physical-attempt, verification, and recovery timeline | Partial | Final skill evidence remains heterogeneous and does not yet provide one common timeline shape. |
| Frozen scenario manifests | Foundation only | Release 0.1 is versioned and hashed, but not a runnable A0 comparison manifest; executor bindings are unavailable. |
| At least 10 independent runs per family | Missing | Required repetitions have not been executed. |
| Baseline aggregation | Tooling only | The A0 aggregator and planned held baseline exist; no valid collected baseline table exists. |
| Direct/NL allocation | Contract only | Both forms and repetitions are declared per scenario; no allocation has run. |
| Seed, server, world, and timeout capture | Contract only | Scenario inputs require them; no execution metadata has been collected. |
| Instrumentation off/on non-interference comparison | Missing | Release 0.1 declarations are instrumentation-off and no comparison has run. |

## Selected field families

| Family | Existing harness |
|---|---|
| Follow/navigation | `tools/verify-follow-field.mjs` |
| Tactical combat | `tools/verify-combat-field.mjs` |
| Operator hold/emergency recovery | `tools/verify-operator-hold-field.mjs` |

## Current blocker

Safe Scenario Lab executor/evidence adapters and immutable fixture hashes do not exist. A later release must establish bounded bindings under separate live-world authorization before any scenario may move from `unavailable` to `not-run`.

Until A0 measurement evidence passes the documented gates, do not introduce EvidenceFrame, TaskGraph, a scheduler, concurrency, a new executor, dependency changes, a `skills.js` rewrite, or any promotion beyond A0 diagnostics.
