[codeplan · session22-source-search-settlement-r2 · IN · mode: constrained · confidence: high · candidates: V1 durable-latch instance-state, V2 receipt-replay list-state · lean: V1 · baseline: V1]

# Session 22 source-search settlement constrained replan

## CENTER audit result: DEFECT_CONFIRMED

### Case file and claim

- **Mode:** AUTONOMOUS.
- **Target:** current dirty workspace at `2b7fc3d1ee9b733d17142e296823e3d3d51a1cf5`; Node 22.22.3, managed Paper 1.21.11, IronSuiteProof PID 164200.
- **Observation:** the unchanged breakfast replay performed two bounded Spider searches, then selected Tripwire and Cobweb and terminally failed Fishing Rod acquisition.
- **Invariant:** one verified bounded source-region advance must preserve the exact Spider-to-String method and productive attempt budget until materially new qualified source evidence exists.
- **Audited claim:** capability reconciliation and Goal settlement disagree about ownership of a verified partial result, and Goal persistence has no durable typed source-search latch after reconciliation.
- **Center:** paired edge `executeCapabilityAction/reconcileCapabilityResult` -> `GoalDirector.dispatch/handleResult` -> normalized Goal operational memory.
- **Falsifier:** a reconciled `source_search_advanced` result remains typed and durable through Goal settlement, or the next dispatch is explicitly authorized by new qualified Spider evidence.

### Fusion

- **Likelihood:** CERTAIN.
- **Impact:** MEDIUM, recoverable but blocks an ordinary multi-stage companion request and causes destructive strategy thrash.
- **Confidence:** HIGH.
- **Reproducibility:** DETERMINISTIC in two live natural-night replays.
- **Root cause:** `executeCapabilityAction` correctly promotes verified region movement to `capability_verified_partial_progress`, but `GoalDirector.dispatch` applies a second verification downgrade and stores `verification_failed`. The structured `source_search_advanced` skill receipt remains nested action evidence and is not normalized into durable Goal state. The next planner call therefore has neither a typed wait latch nor exact same-method replay authority.

### Evidence ledger and trajectory

- **E1 RUNTIME/A:** flights `flight-2026-08-12T12-29-44-709Z-164200-000.jsonl` sequences 14-15 record two distinct `skill_source_search_advanced` results about five seconds apart; `-001.jsonl` sequence 16 then records Tripwire collection. Both searches recorded safe movement of at least 9.7 blocks and no Spider.
- **E2 STATE/A:** `bots/IronSuiteProof/goal-state.json` stores search subgoals 7-8 as `verification_failed`, then Tripwire/Cobweb subgoals, and a terminal attempts-four failure. No source-search latch exists in memory.
- **E3 SOURCE/B:** `capability-catalogue.js` `reconcileCapabilityResult` recognizes `source_search_advanced` with movement >=8 as verified partial progress. `GoalDirector.dispatch` then independently downgrades any succeeded result whose verification is false.
- **E4 SOURCE/B:** `acquisitionTemporalFeasibility` can wait only from the latest flattened source code; `normalizeOperationalMemory` persists only `sourceAccessPending`, whose required entity identity cannot represent a no-entity search settlement.
- **E5 TEST/B:** the existing capability test proves reconciliation returns `capability_verified_partial_progress`; the focused Goal test called `handleResult` with the unreconciled executor result and therefore bypassed the failing production edge.

Trajectory: E1 executor receipt -> E3 capability reconciliation -> E3 duplicate Goal downgrade -> E2 normalized goal state without typed latch -> E4 ordinary planner selection -> E1 repeated search and fallback. Unproven links: none.

### Disproved concerns, blast radius, and repair contract

- This is not Pathfinder inventing geometry: Pathfinder produced the movement receipt that the capability layer accepted. It is not a scheduler race: separate action IDs and five-second intervals match the intended recheck timer. It is not model variance: all selection ran through deterministic capabilities.
- **Direct blast radius:** GoalDirector capability settlement and normalized Goal operational memory. **Boundary:** persisted Goal restart/replay. **Excluded:** Pathfinder, entity-harvest mechanics, combat, prerequisite-planner API, Agenda, Paper configuration, and learned method ranking.
- **Required repair:** accept the capability layer's reconciled structured result exactly once; persist a bounded normalized exact source-search replay latch; resolve it before ordinary prerequisite planning; wait with no new source; bind only a newly qualified Spider; clear or replace the latch only on a structured settlement.
- **Verification:** an integration-style focused Goal test must traverse `dispatch -> executeCapabilityAction -> handleResult`, prove no second search or fallback after the timer, prove exact-ID same-method replay after a new Spider, and prove JSON normalization/reload preserves the latch.

Repair revalidation: **INVARIANT_HOLDS**. E1-E4 were independently re-read against the current workspace before mechanism selection.

## Calibration

GoalDirector owns lifecycle judgment and durable operational memory; capability reconciliation owns the selection/planning/execution/reconciliation boundary for installed deterministic skills. Receipts must be bounded, normalized, immutable, and structured. Tests use `node:test`, strict assertions, fake live state and time, and in-memory stores. Preserve all dirty work, add no dependency, and return to the exact broad breakfast after one focused repair.

## Variants and hard gates

- **V1 — durable-latch (`instance-state`, `class-method`, `internal-reuse`):** remove the duplicate Goal verification downgrade. Add normalized `memory.sourceSearchPending` containing the exact replay descriptor from the structured skill/request receipt. Resolve it before the ordinary planner using existing qualification, temporal gate, and capability builder. **G: pass.**
- **V2 — receipt-replay (`list-state`, `class-method`, `internal-reuse`):** remove the duplicate downgrade, add a normalized exact capability receipt to the settled subgoal, and scan bounded subgoal history to derive source-search wait/replay authority. **G: pass**, but lifecycle state becomes implicit in historical action records and requires a broader subgoal schema.

Both pass functional, contract, negative-space, dependency, HARD-rule, security/data-integrity, compatibility, and Node/Paper runtime gates.

## Frozen rubric and score

Rubric frozen: axes [Style, Theme, Methodology, Modernization, Error wrapping, Testability, Blast radius] · weights [1,2,2,2,2,2,1] · denominator = 60 · denominator-policy [uniform-N/A-only] · baseline-algo [lowest-effort gate-passer with no score of 1 on any quality axis]

freeze: axes=Style,Theme,Methodology,Modernization,Error wrapping,Testability,Blast radius weights=1,2,2,2,2,2,1 denom=60 baseline=lowest-effort-gate-passer

| Axis | W | V1 durable-latch | V2 receipt-replay |
|---|---:|---:|---:|
| Style | 1 | 5 | 4 |
| Theme/paradigm | 2 | 5 | 4 |
| Methodology | 2 | 5 | 3 |
| Modernization | 2 | 4 | 4 |
| Error wrapping | 2 | 5 | 5 |
| Testability | 2 | 5 | 4 |
| Blast radius | 1 | 4 | 3 |
| Effort | - | medium | medium |
| Weighted total | - | 57/60 = 0.950 | 47/60 = 0.783 |

Arithmetic: V1=`(5×1+5×2+5×2+4×2+5×2+5×2+4×1)/60=0.950`; V2=`(4×1+4×2+3×2+4×2+5×2+4×2+3×1)/60=0.783`. Identical axes and denominator verified.

## Winner contract

V1 wins and is also the algorithmic baseline. Operational wait/replay state belongs in Goal memory, as already established by source-access, workstation, tool, delivery, and death-recovery bindings. The repair remains additive and normalized, while subgoals remain action history rather than hidden lifecycle state. Do not alter delegated mechanics or planner ranking.

[codeplan · session22-source-search-settlement-r2 · OUT · mode: constrained · pick: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1 0.950, V2 0.783 · reason: one normalized Goal-owned latch preserves exact replay authority and leaves action history descriptive · mechanism-check: passed · corrected: prior subgoal-code mechanism disproved by live capability reconciliation]
