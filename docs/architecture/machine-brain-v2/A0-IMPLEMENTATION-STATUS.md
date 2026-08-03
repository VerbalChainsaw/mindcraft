# A0 Implementation Status

Status: diagnostics plus the first bounded Scenario Lab replay are implemented; A0 measurement evidence and the full lab remain incomplete.

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
- Scenario Lab focused validation passed 13/13 tests before the decisive replay.
- The decisive 2026-08-03 stone-recovery replay passed both planned invocations: direct in 38,818 ms and deterministic natural language in 29,796 ms. Both independently restored the frozen world, produced and equipped a stone pickaxe, observed `no_safe_stance`, selected bounded recovery, used zero external retries, and retained full health and hunger.
- The result contained all seven expected evidence markers, zero missing fields, zero safety violations, no false-success observation, complete configuration/properties/memory restoration, preserved replay artifacts, and zero remaining managed Java processes.

## Release 0.1 Scenario Lab foundation

The hashed `scenario-lab.manifest.v1` catalog and offline list/validate/plan CLI define five Release 0.1 families. Manifest revision `release-0.1.v3` registers one safe live binding against candidate commit `4c6ab2ea2bb8e8e7ef99f2c1cdbdbd8e042cee44`: frozen seed `8781215452871762684`, fixture archive SHA-256 `535b4ab9da8c39837008a0b18be9eb21f88131d01931aed2291f24abe2d97fd0`, and gameplay-file SHA-256 `cc524c4ceafccb4b850b7f3e65bb705e5e843e2268f94afa3d11052e4d3a21a5`. The direct and deterministic-NL invocations passed on independent restores. The other four families remain unavailable, the required cross-run measurement program has not run, and no lab-complete or architecture-promotion claim is made.

## Current A0 coverage

| A0 evidence surface | Status | Current record |
|---|---|---|
| Request correlation, selected skill, route, and arguments | Covered | Bounded request context reaches the linked action trace. |
| Owner, priority, acquire, release, and terminal outcome | Covered | Existing decision traces explicitly attribute serialized action lifecycle and linked outcome. |
| Common precondition, observation, physical-attempt, verification, and recovery timeline | Partial | Final skill evidence remains heterogeneous and does not yet provide one common timeline shape. |
| Frozen scenario manifests | First runnable slice | Release 0.1 is versioned and hashed; stone recovery has a bounded executor/evidence binding and immutable fixture. Four families remain unavailable. |
| At least 10 independent runs per family | Missing | One direct and one deterministic-NL stone-recovery invocation passed; this is below the independent-run gate. |
| Baseline aggregation | Tooling only | The A0 aggregator and planned held baseline exist; no valid collected baseline table exists. |
| Direct/NL allocation | Partial live evidence | Stone recovery passed one direct and one deterministic-NL invocation; other families and required repetitions have not run. |
| Seed, server, world, and timeout capture | Covered for first slice | Stone recovery recorded seed, Paper 1.21.11/protocol 774, fixture/archive hashes, per-form replay world, action IDs, duration, and bounded timeout state. |
| Instrumentation off/on non-interference comparison | Missing | Release 0.1 declarations are instrumentation-off and no comparison has run. |
| Arbiter hot-path diagnostics | Implemented, baseline not frozen | The bounded DecisionTrace snapshot reports nearest-rank p50/p95/p99/max for evaluation, cleanup, total, scheduled-loop delay/overrun, and action invocation lifetime. Scheduled-loop delay compares the actual behavior-loop start delta with the prior requested tick period; it does not isolate all Node event-loop lag, and early event-driven wakes are excluded. Live `npm run perf:runtime -- --url=...` reports the per-bot summary and, with `--assert`, fails closed on a missing or malformed surface. No latency threshold is claimed before a baseline is frozen. |
| EvidenceFrame assembly timing | Deferred | EvidenceFrame does not exist. No assembly metric is claimed; measurement remains deferred until an authorized component exists after A0 passes. |

## Selected field families

| Family | Existing harness |
|---|---|
| Follow/navigation | `tools/verify-follow-field.mjs` |
| Tactical combat | `tools/verify-combat-field.mjs` |
| Operator hold/emergency recovery | `tools/verify-operator-hold-field.mjs` |

## Current blocker

Four Scenario Lab families still lack safe executor/evidence adapters and immutable fixtures. The runnable stone-recovery family still lacks the required independent repetitions and instrumentation off/on comparison. Those gates must close before A0 or the lab can be declared complete.

Until A0 measurement evidence passes the documented gates, do not introduce EvidenceFrame, TaskGraph, a scheduler, concurrency, a new executor, dependency changes, a `skills.js` rewrite, or any promotion beyond A0 diagnostics.
