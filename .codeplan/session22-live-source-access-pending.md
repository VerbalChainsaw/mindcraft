[codeplan · session22-live-source-access-pending · IN · mode: full · confidence: high · candidates: V1 action-local-wait local-loop, V2 failed-target-reuse internal-reuse, V3 goal-memory-receipt external-store, V4 subgoal-receipt subgoal-state · lean: V3 · baseline: V2]

## Decision boundary

Live telemetry proves that `harvestEntityDrop` selected a qualified Spider, delegated pursuit to native Pathfinder, received `unreachable`, and then emitted `source_not_found`. GoalDirector therefore charged the harvest method, relocated, and selected Tripwire/Cobweb even though the Spider remained loaded and later moved materially closer.

Required invariant: a selected, qualified entity whose pursuit fails is not absent. The action must publish the first failed boundary, and durable planning must preserve attempts while the same inaccessible source is unchanged. A new entity or material movement by the observed entity may reopen pursuit.

Explicit non-scope: Pathfinder mechanics, combat policy/package, Agenda retry policy, method enumeration, dependencies, and unrelated collection targets.

## Calibration

Repository guidance and the existing Session 22 rules/source calibration agree on these axes: structured bounded evidence; stable snake-case outcomes; normalized immutable Goal state; GoalDirector ownership of retry budgets; package ownership of movement/combat; smallest shared repair; focused `node:test` coverage; no dependency or broad refactor. Spot checks in `skills.js`, `action-result.js`, `goal-contract.js`, `goal-director.js`, and `goal-director-recovery-budget.test.js` confirm those conventions.

Triviality gate: trivial: no · continue. The repair crosses the skill-result, durable Goal state, and retry-authority boundary.

## Variants and hard gates

- V1 `action-local-wait` (`local-loop`): wait and retry the moving Spider only inside the current action. G: **fail** — it loses retry authority at the action deadline/restart and can still collapse the selected source into absence.
- V2 `failed-target-reuse` (`internal-reuse`): encode the source-access receipt in existing `memory.failedTargets`, extending entries with entity identity. G: **pass** — zero dependency and compatible, but overloads target-blacklist semantics with a censored temporal latch.
- V3 `goal-memory-receipt` (`external-store`): add one bounded normalized `memory.sourceAccessPending` receipt; the skill returns `source_access_pending` with the selected entity, position, qualification, and movement result; GoalDirector persists it without charging attempts and reopens only on a new entity or material entity movement. G: **pass**.
- V4 `subgoal-receipt` (`subgoal-state`): add the bounded source-access receipt to the terminal subgoal record and have feasibility inspect the latest subgoal. G: **pass** — compatible, but mixes operational retry state into historical outcome records.

Divergence proof: V1 differs by local-only state and loop control; V2 uses the existing generic failed-target list; V3 adds dedicated operational memory; V4 stores the receipt on a historical subgoal. These are distinct state locations and data contracts, not restatements.

## Frozen rubric

Rubric frozen: axes [Style, Theme, Methodology, Modernization, Error wrapping, Testability, Blast radius] · weights [1,2,2,2,2,2,1] · denominator = 60 · denominator-policy [uniform-N/A-only] · baseline-algo [lowest-effort gate-passer with no score of 1 on any quality axis]

freeze: axes=Style,Theme,Methodology,Modernization,Error wrapping,Testability,Blast radius weights=1,2,2,2,2,2,1 denom=ΣW×5 baseline=lowest-effort-gate-passer

## Scoring

| Axis | W | V2 failed-target-reuse | V3 goal-memory-receipt | V4 subgoal-receipt |
|---|---:|---:|---:|---:|
| Style | 1 | 4 | 5 | 4 |
| Theme/paradigm | 2 | 4 | 5 | 4 |
| Methodology | 2 | 4 | 5 | 4 |
| Modernization | 2 | 3 | 4 | 4 |
| Error wrapping | 2 | 4 | 5 | 5 |
| Testability | 2 | 4 | 5 | 4 |
| Blast radius | 1 | 4 | 3 | 3 |
| Effort | - | low | medium | medium |
| Weighted total | - | 46 | 56 | 49 |
| Normalized | - | 0.767 | 0.933 | 0.817 |

Arithmetic: V2 = `4+8+8+6+8+8+4=46`; V3 = `5+10+10+8+10+10+3=56`; V4 = `4+8+8+8+10+8+3=49`; denominator = `(1+2+2+2+2+2+1)*5=60`.

Baseline: V2 is the lowest-effort gate-passer with no quality-axis score of 1. V3 wins because dedicated normalized operational memory matches the existing Goal ownership boundary, avoids contaminating collection target blacklisting, and keeps the movement failure receipt explicit across restart.

## Implementation contract

1. Capture the movement receipt immediately after the selected entity pursuit fails; never let regional source search overwrite it.
2. Emit a bounded `source_access_pending` entity-harvest receipt with source, entity ID, observed position, qualification, and normalized movement outcome.
3. Classify the result as censored/non-method failure.
4. Normalize and persist one `goal.memory.sourceAccessPending` record before GoalDirector returns to `assess`; do not increment productive attempts or trigger recovery/method fallback.
5. While only the same entity remains within a small material-movement threshold, report `waiting_for_hostile_source_access_change`. Reopen when entity identity changes or its observed position changes materially; re-run the existing combat preflight before dispatch.
6. Add focused coverage for persistence, unchanged-source waiting, material-movement reopening, and censored learning. Then rerun the same broad fishing-breakfast scenario.

[codeplan · session22-live-source-access-pending · OUT · mode: full · pick: V3 · confidence: high · beatBaseline: yes · scores: V2 0.767, V3 0.933, V4 0.817 · reason: dedicated normalized Goal operational memory preserves the first failed boundary without contaminating blacklist semantics · mechanism-check: passed · corrected: focused test fixture restored the registry and existing prerequisite inventory]
