# A0 Implementation Status

Status: diagnostic foundation implemented; A0 measurement evidence is not complete.

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

## Current A0 coverage

| A0 evidence surface | Status | Current record |
|---|---|---|
| Request correlation, selected skill, route, and arguments | Covered | Bounded request context reaches the linked action trace. |
| Owner, priority, acquire, release, and terminal outcome | Covered | Existing decision traces explicitly attribute serialized action lifecycle and linked outcome. |
| Common precondition, observation, physical-attempt, verification, and recovery timeline | Partial | Final skill evidence remains heterogeneous and does not yet provide one common timeline shape. |
| Frozen scenario manifests | Missing | No frozen comparison manifests yet. |
| At least 10 independent runs per family | Missing | Required field repetitions are not complete. |
| Baseline aggregation | Missing | No aggregate success, unsafe-outcome, conflict, timeout, latency, retry, or terminal-reason table yet. |
| Direct/NL allocation | Missing | The required per-family request-form allocation is not frozen. |
| Seed, server, world, and timeout capture | Missing | Run-environment metadata is not yet consistently captured. |
| Instrumentation off/on non-interference comparison | Missing | Passive-instrumentation equivalence has not been demonstrated. |

## Selected field families

| Family | Existing harness |
|---|---|
| Follow/navigation | `tools/verify-follow-field.mjs` |
| Tactical combat | `tools/verify-combat-field.mjs` |
| Operator hold/emergency recovery | `tools/verify-operator-hold-field.mjs` |

## Next authorized design gate

The next gate is a non-runtime proposal for frozen scenario manifests and an aggregation tool. It must define reproducible inputs, run metadata, direct/NL allocation, independent-run counting, baseline metrics, and instrumentation off/on comparison before implementation is authorized.

Until A0 measurement evidence passes the documented gates, do not introduce EvidenceFrame, TaskGraph, a scheduler, concurrency, a new executor, dependency changes, a `skills.js` rewrite, or any promotion beyond A0 diagnostics.
