[codeplan · session42-food-upkeep-handoff · IN · mode: full · confidence: high · candidates: V1 job-owned executor inline-dispatch, V2 cooperative upkeep status-handoff, V3 agenda food prefix plan-prefix, V4 critical-only alignment threshold-policy, V5 arbiter forced upkeep lane-override · lean: V2 · baseline: V5]

## Decision

Center Audit confirmed one cross-owner liveness defect: JobDirector blocks
durable work below its reserve threshold and explicitly waits for
SurvivalDirector, while SurvivalDirector suppresses noncritical acquisition
during the same durable work. Session 42 reproduced the resulting four-minute
stall after a verified pig checkpoint and failed Dad return.

Triviality gate: `trivial: no · continue`. The repair crosses durable job,
survival, and arbitration ownership and must define both success and bounded
no-source settlement.

## Calibrated rules

- JobDirector owns durable progress and declares structured upkeep needs; it
  must not become a parallel food mechanic.
- SurvivalDirector is the sole deterministic bodily-upkeep/food executor.
- BehaviorArbiter already evaluates SurvivalDirector before player jobs; retain
  that ordering and ActionManager ownership.
- Preserve scout checkpoint, exact requester, native Pathfinder, truthful
  receipts, no dependencies, and one remaining unchanged Paper acceptance.
- Quality axes: style, ownership/paradigm, campaign fidelity, liveness,
  survival safety, persistence/restart behavior, testability, blast radius.

## Variants and gates

| Variant | Fingerprint | Mechanism | Gate |
|---|---|---|---|
| V1 | `inline-dispatch` | JobDirector directly dispatches `prepareFood` while blocked. | fail — creates the forbidden second food executor and duplicates SurvivalDirector ownership |
| V2 | `status-handoff` | JobDirector publishes a bounded correlated upkeep request; SurvivalDirector alone executes/reconciles it, and terminal no-source outcome settles the job truthfully. | pass |
| V3 | `plan-prefix` | Agenda compilation inserts food acquisition ahead of remote durable jobs. | pass — but spreads runtime reserve policy into language planning and changes plan composition |
| V4 | `threshold-policy` | Lower the job reserve gate to critical hunger so existing critical preemption eventually acts. | fail — avoids the deadlock by permitting a no-food expedition to deteriorate to critical hunger |
| V5 | `lane-override` | BehaviorArbiter detects the blocked status and forces a special survival evaluation/override. | pass — but makes arbitration infer and execute a domain prerequisite |

Pairwise divergence: V1 changes executor ownership; V2 adds an explicit
producer/consumer contract; V3 changes persisted plan structure; V4 changes
policy thresholds; V5 changes arbiter control flow. These are mechanically
distinct.

## Frozen rubric

Rubric frozen: axes [Style, Ownership, Campaign fidelity, Liveness, Safety,
Persistence, Testability, Blast radius] · weights [1,3,2,3,2,1,1,2] ·
denominator = 75 · denominator-policy [uniform-N/A-only] · baseline-algo
[lowest-effort gate-passer with no score of 1 on any quality axis]

`freeze: axes=Style,Ownership,Campaign fidelity,Liveness,Safety,Persistence,Testability,Blast radius weights=1,3,2,3,2,1,1,2 denom=ΣW×5 baseline=lowest-effort-gate-passer`

| Variant | S | O | F | L | Sa | P | T | B | Weighted | Normalized | Effort |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| V2 | 4 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 70 | 0.933 | medium |
| V3 | 4 | 4 | 4 | 4 | 5 | 4 | 4 | 2 | 58 | 0.773 | high |
| V5 | 3 | 4 | 4 | 5 | 4 | 3 | 3 | 2 | 56 | 0.747 | medium |

Arithmetic: V2 `4+15+10+15+10+4+4+8=70`; V3
`4+12+8+12+10+4+4+4=58`; V5 `3+12+8+15+8+3+3+4=56`; denominator
`(1+3+2+3+2+1+1+2)*5=75`.

V5 is the algorithmic baseline because it is a medium-effort gate-passer, but
V2 wins by keeping domain ownership explicit, preserving the existing arbiter
order, and providing a correlated terminal failure instead of another silent
wait. Implementation fingerprint must remain `status-handoff`: no job-owned
food dispatch and no arbiter-owned food policy.

[codeplan · session42-food-upkeep-handoff · OUT · mode: full · pick: V2 · confidence: high · beatBaseline: yes · scores: V2 0.933, V3 0.773, V5 0.747 · reason: explicit correlated upkeep handoff preserves sole survival execution and closes both success and no-source liveness paths · mechanism-check: passed · corrected: none]

## Implementation and physical result

Implemented the selected `status-handoff` fingerprint without mechanism drift:
JobDirector publishes/clears the correlated reserve request and never dispatches
food; SurvivalDirector alone executes food preparation/recovery and exposes the
correlated terminal outcome. Focused publication, dispatch/immutability, and
terminal-exhaustion checks pass 3/3.

Final Paper flight `flight-2026-08-13T04-30-45-782Z-82821-000.jsonl`
physically selected `acquire_food` with reason
`durable_job_food_resupply` during the active scout order. This accepts the
handoff. The broader session did not pass: no safe food source existed and a
known close-Skeleton zero-progress retreat caused death before the scout later
resumed and completed. Campaign bounds prohibit treating that tactical class as
mechanism drift or opening another repair here.
