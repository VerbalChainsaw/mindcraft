# A0 Implementation Status

Status: diagnostics plus two bounded Scenario Lab adapters are implemented. Doorway/corridor follow now has a complete 5-direct/5-natural-language instrumentation-off campaign at 10/10 strict success; stone recovery still has only one direct plus one deterministic-NL replay. Diagnostics-on non-interference, three unavailable families, and the full A0/lab gates remain incomplete.

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
- Doorway/corridor follow adapter validation passed 15/15 Scenario Lab tests and 6/6 directive-routing tests before registration.
- The decisive 2026-08-03 doorway/corridor replay passed both planned invocations on independent restores: direct in 23,154 ms and deterministic natural language in 19,212 ms. Both correlated the intended route and action, crossed the doorway, completed the corridor, reached the final waypoint, held stable for ten seconds, used zero external retries, and observed no false success.
- The follow result contained all six expected evidence markers, zero missing fields, zero safety violations, clean process exit for both forms, complete configuration/properties/memory restoration, preserved replay artifacts, a clean repository, and zero remaining managed Java processes or runtime lock. Exact canonical evidence is preserved under `verification/doorway-corridor-follow-20260803/`.
- The first full instrumentation-off follow campaign preserved under `verification/doorway-corridor-follow-a0-off-20260803/` passed 9/10. Its only miss was an honestly retained terminal-anchor measurement race after physical doorway/corridor success.
- Commit `b47117b373a36d894e8ca9df740ae2ced0493913` changed only the verifier to wait for settled horizontal velocity before anchoring stability. The fresh post-fix campaign preserved under `verification/doorway-corridor-follow-a0-off-anchor-fixed-20260803/` passed 10/10 with 100% diagnostic completeness, zero retries, and zero unsafe/death/conflict/timeout outcomes. One invocation exercised the new settling path for 211 ms before remaining perfectly stable.
- The broader gates passed 9/9 critical tests, 104/104 behavior tests, and 219/219 control-plane tests; control-plane lint passed. The runtime performance assertion passed with cached-survival p95 0.128 ms and 75% fewer scans than the uncached path.

## Release 0.1 Scenario Lab foundation

The hashed `scenario-lab.manifest.v1` catalog and offline list/validate/plan CLI define five Release 0.1 families. Manifest revision `release-0.1.v7` registers two safe live bindings against candidate commit `b47117b373a36d894e8ca9df740ae2ced0493913`. Stone recovery retains frozen seed `8781215452871762684` and fixture archive SHA-256 `535b4ab9da8c39837008a0b18be9eb21f88131d01931aed2291f24abe2d97fd0`; its direct and deterministic-NL invocations passed on independent restores. Doorway/corridor follow uses frozen seed `3579780610592225162`, source world `viability-pilot-disposable`, and fixture archive SHA-256 `be49ccbd9115e34ccd3ea6b0958302fa7c794709dfdcc6b379d06fba31a026b8`; its repaired instrumentation-off campaign passed all five direct and all five deterministic-NL invocations on independent restores. The other three families remain unavailable, diagnostics-on non-interference has not run, and no lab-complete or architecture-promotion claim is made.

## Current A0 coverage

| A0 evidence surface | Status | Current record |
|---|---|---|
| Request correlation, selected skill, route, and arguments | Covered | Bounded request context reaches the linked action trace. |
| Owner, priority, acquire, release, and terminal outcome | Covered | Existing decision traces explicitly attribute serialized action lifecycle and linked outcome. |
| Common precondition, observation, physical-attempt, verification, and recovery timeline | Partial | Final skill evidence remains heterogeneous and does not yet provide one common timeline shape. |
| Frozen scenario manifests | Two runnable slices | Release 0.1 is versioned and hashed; stone recovery and doorway/corridor follow have bounded executor/evidence bindings and immutable fixtures. Three families remain unavailable. |
| At least 10 independent runs per family | Partial | Doorway/corridor follow completed one 10-run instrumentation-off allocation (5 direct, 5 deterministic-NL). Stone recovery remains at one direct plus one deterministic-NL invocation, and three families remain unavailable. |
| Baseline aggregation | Partial live baseline | Doorway/corridor follow has a hash-linked 10-run off-arm analysis: 10/10 success, p50 19,733 ms, p95 27,382 ms, 100% complete records, and zero unsafe/death/conflict/timeout/retries. No matched on-arm table exists. |
| Direct/NL allocation | Partial live evidence | Doorway/corridor follow completed the required 5 direct plus 5 deterministic-NL allocation for the off arm. Stone recovery and three unavailable families remain below their allocations. |
| Seed, server, world, and timeout capture | Covered for registered slices | Both live slices recorded seed, Paper 1.21.11/protocol 774, fixture hashes, independent per-form replay worlds, action IDs, durations, bounded timeout state, and cleanup. Follow additionally recorded source-world identity plus profile, metadata, and course hashes. |
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

Three Scenario Lab families still lack safe executor/evidence adapters and immutable fixtures. Doorway/corridor follow has a complete 10-run instrumentation-off family allocation, but lacks a real matched diagnostics-on comparison. Stone recovery still lacks required repetitions. Those gates must close before A0 or the lab can be declared complete.

Until A0 measurement evidence passes the documented gates, do not introduce EvidenceFrame, TaskGraph, a scheduler, concurrency, a new executor, dependency changes, a `skills.js` rewrite, or any promotion beyond A0 diagnostics.
