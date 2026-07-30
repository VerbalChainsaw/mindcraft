# Codeplan: Balanced role autonomy

## Contract and safety
- Required behavior: the default `balanced` setting must produce visible role gameplay without letting a bot wander independently from its player.
- Acceptance criteria: nearby balanced Builder/Miner/Lumberjack/Scout bots dispatch their normal bounded role intent; separated bots regroup; missing-player bots wait; autonomous and command semantics remain unchanged.
- Must preserve: RoleDirector ownership, verified command/results, resource recovery budgets, manual-command grace, operator Stop, role assignments, and concurrent UI/profile/squad work.
- Out of scope: new role skills, building system, combat changes, formation engine, UI, tests, live bot action, and restart.
- Workspace/user work: extensive dirty concurrent work is present; edit only `src/agent/runtime/role-director.js` and this lane's Hermes records.
- Pre-change checks: complete intent order, leader resolution/distance helper, recovery flow, normalization default, saved scenario autonomy, and status/result handling inspected.

## Repository evidence
- Runtime normalization defaults to `balanced`.
- `chooseIntent()` currently sends every non-autonomous Scout and resource role to `goToPlayer(..., 5)` before any role branch, even when already beside the player.
- Scenario bots explicitly use `autonomous`, but ordinary reusable profiles without an explicit choice receive the inert balanced path.
- The existing `playerDistance()` and leader resolver provide a bounded authoritative anchor without adding state or another scheduler.

## Mode
- Candidate mode: constrained
- Candidate count: 2
- Record profile: compact

## Candidates
- V1 `proximity-gate,existing-intents,world-state,result-return`: balanced roles work inside a bounded leader radius, regroup outside it, and wait without a leader.
- V2 `sequence-alternation,existing-intents,counter-state,result-return`: balanced roles alternate a regroup turn with a work turn regardless of actual distance.

## Divergence
- V1-V2: V1 responds to authoritative player distance and never wastes a turn regrouping while already close; V2 is simpler but arbitrary and may start work while separated.

## Paper gates
- V1: pass - fulfills default playability, preserves ownership, uses existing state, and bounds player anchoring.
- V2: pass - preserves APIs but weakens task fulfillment and spatial truth.

## IN
[codeplan · balanced-role-autonomy · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=proximity-gate,existing-intents,world-state,result-return;V2=sequence-alternation,existing-intents,counter-state,result-return · lean: V1 · conservative: V1]

## Frozen rubric and scoring
- freeze: axes=playability,spatial-truth,architecture-fit,ownership-risk,delivery-cost classes=quality,quality,quality,risk,convenience weights=3,3,3,3,1 denominator=65 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer
- V1: 5,5,5,5,5 = 65/65 = 1.00
- V2: 3,2,4,4,5 = 43/65 = 0.66
- Arithmetic verification: V1 = 15+15+15+15+5; V2 = 9+6+12+12+5; common denominator 65.
- Formal baseline: V1.
- Selection stability: V1 leads by 0.34 and is no higher effort than the counter policy.

## PLAN-OUT
[codeplan · balanced-role-autonomy · PLAN-OUT · mode: constrained · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1=1.00;V2=0.66 · reason: player distance is the existing authoritative signal for balancing useful work with companion cohesion · planned-fingerprint: proximity-gate,existing-intents,world-state,result-return]

## Implementation plan
1. Add one bounded balanced-role work radius.
2. For balanced non-combat work/scout roles, wait without a leader and regroup only outside the radius.
3. Allow the existing scout/resource/tool/job branches to run while anchored.
4. Re-read the complete intent and result flow; defer execution.

## Implementation and evidence
- Added a 12-block player-anchor gate for balanced non-combat work/scout roles.
- Balanced bots now wait without a visible leader, regroup only when outside the anchor radius, and otherwise continue into the existing scout, tool-preparation, or job intent.
- Long-range resource relocation remains exclusive to autonomous profiles; balanced jobs report a local collection blocker rather than wandering 32–64 blocks on their own.
- Re-read the complete intent order and result/recovery flow, enumerated every resource-search state mutation, and ran focused diff formatting only. No test, bot action, build, command, or restart was run.

## EXEC-OUT
[codeplan · balanced-role-autonomy · EXEC-OUT · implemented: V1 · confidence: low · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: long-range resource recovery restricted to autonomous profiles · evidence: complete-intent-result-reread,resource-state-enumeration,focused-diff-check; live activation deferred]
