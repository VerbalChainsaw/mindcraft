# Codeplan: Crafting-table fallback and recovery

## Contract and safety
- Required behavior: a survival bot carrying a crafting table must not fail solely because the nearest world table is unreachable, and a table placed temporarily by the bot must not be called recovered until its inventory is restored.
- Acceptance criteria: try an existing table once; fall back to a locally carried table when routing fails; respect interruption; recover only the exact nearby table drop; preserve the craft result while exposing cleanup truth.
- Must preserve: verified recipe output, non-destructive movement, ActionManager Stop ownership, survival inventory truth, current role-tool bootstrap, and concurrent dashboard/profile/squad work.
- Out of scope: generic workstation orchestration, arbitrary item-drop collection, recipe planning, tests, live bot actions, and process restart.

## Audit result
- `craftRecipe` selects one nearest world table and returns `table_unreachable` after a failed route without consulting the carried-table fallback.
- Temporary cleanup verifies only that the block disappeared. It neither targets the dropped table entity nor verifies the pre-placement inventory count.
- Both findings are deterministic static contract gaps in the current dirty workspace; runtime frequency depends on terrain and pickup distance.

## Mode
- Candidate mode: constrained
- Candidate count: 2
- Record profile: compact

## Candidates
- V1 `local-fallback,targeted-drop,inventory-postcondition,zero-dep`: extend the current craft boundary with one local-table fallback and exact recovery evidence.
- V2 `workstation-manager,shared-lease,persistent-cleanup-state`: introduce a generic workstation owner for tables, furnaces, and future blocks.

## Divergence
- V1-V2: V1 closes the proven crafting-table gaps without changing ownership or persistence; V2 creates a new lifecycle/state subsystem beyond the evidence trajectory.

## Paper gates
- V1: pass - isolated to the existing runtime skill, preserves current action ownership, and has direct postconditions.
- V2: fail - unnecessary architecture and persistence risk for the confirmed bounded defects.

## IN
[codeplan · crafting-table-recovery · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=local-fallback/targeted-drop/inventory-postcondition/zero-dep;V2=workstation-manager/shared-lease/persistent-cleanup-state · lean: V1 · conservative: V1]

## Frozen rubric and scoring
- freeze: axes=architecture-fit,gameplay-truth,stop-safety,observability,delivery-risk classes=quality,quality,risk,quality,risk weights=3,3,3,2,1 denominator=60 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer
- V1: 5,5,4,5,4 = 56/60 = 0.93
- V2: 2,4,3,4,1 = 35/60 = 0.58
- Formal baseline: V1.
- Selection stability: V1 leads by 0.35 and is the only candidate that stays within the proven blast radius.

## PLAN-OUT
[codeplan · crafting-table-recovery · PLAN-OUT · mode: constrained · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1=0.93;V2=0.58 · reason: the current craft boundary can close both verified gaps with explicit postconditions and no new lifecycle owner · planned-fingerprint: local-fallback,targeted-drop,inventory-postcondition,structured-cleanup,zero-dep]

## Implementation plan
1. Add bounded helpers to place a carried table and identify its canonical dropped-item entity near the exact placement.
2. Try the nearest existing table once; on verified route failure, respect interruption or fall back to a carried local table.
3. During cleanup, verify block removal, wait briefly for automatic pickup, target only the matching nearby table drop, and verify the pre-placement inventory count.
4. Attach cleanup outcome to the final structured craft evidence without converting a completed craft into a false failure.
5. Re-read the exact changed ranges; defer tests and activation at the user's direction.

## Implementation and evidence
- Implemented V1 without a mechanism shift.
- The existing world table gets one normal progressive route attempt. A route failure now respects interruption or places the bot's carried table in verified nearby space.
- Missing-table and unreachable-table outcomes remain distinct.
- Cleanup verifies block removal, filters dropped entities by canonical `crafting_table` identity and placement radius, routes only to that item, and requires the pre-placement inventory count.
- The primary craft result remains authoritative while a bounded `cleanup` object reports recovery, interruption, unreachable drop, absent drop, or cleanup failure.
- Evidence gates: exact placement, movement, dropped-item, inventory, and final-evidence source ranges re-read; diff whitespace check clean. Tests, live bot actions, and restart intentionally not run.

## EXEC-OUT
[codeplan · crafting-table-recovery · EXEC-OUT · implemented: V1 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: carried-table fallback plus exact temporary-table recovery and structured cleanup truth · evidence: final source and diff formatting inspected; runtime activation and tests deferred]
