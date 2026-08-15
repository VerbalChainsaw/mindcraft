# Session22 hostile-harvest closeout decision

## Decision boundary

Session22 proved that `harvestEntityDrop` could begin Pathfinder pursuit while
other hostiles were already inside the tactical envelope, then settle as soon
as String reached inventory even though the bot remained in the hostile night
region. The active Goal therefore released ordinary crafting work before its
safety prerequisite had closed.

The fix must preserve project-owned admission and evidence while delegating all
physical retreat to the existing Pathfinder-backed `avoidEnemies` mechanic.

## Variants

| Variant | Mechanism | Surface | Evidence | Risk |
| --- | --- | --- | --- | --- |
| A | Check the hostile envelope before pursuit, recheck before combat, and require an all-hostile clearance receipt after the drop before returning success. | Local harvest adapter; reuses existing retreat mechanic. | One bounded action receipt carries admission and closeout. | Low-medium. |
| B | Persist a safe-origin checkpoint in Goal memory and add a post-harvest return phase. | Goal contract, persistence, planner, and harvest adapter. | Durable return checkpoint plus phase receipts. | Medium-high; the observed action origin was itself unsafe, so a new safe-origin owner is required. |
| C | Add a general BehaviorArbiter hostile-clearance lane before noncombat Goal dispatch. | Behavior arbitration, Goal dispatch, ownership/preemption. | Cross-lane safety receipt. | High; broader than the observed optional-harvest transaction and risks competing with existing survival ownership. |

## Hard gates and weighted choice

All variants preserve package ownership and can be made fail-closed, but B does
not solve this replay without inventing a new durable safe-origin contract, and
C crosses unrelated autonomy lanes. Weighted for functional fit, regression
risk, lifecycle consistency, evidence quality, and delivery cost, A is the only
smallest-sufficient mechanism: 0.90 versus 0.66 for B and 0.61 for C.

## Selected mechanism

Implement A. A later-stage inventory effect must not override a failed safety
closeout, so the failure receipt sets `completionBlocked: true`. A subsequent
Goal attempt can reverify the real inventory only after normal recovery; it may
not turn the unsafe action itself into apparent success.

The separate post-death Agenda inventory-custody defect remains a distinct
lifecycle repair. It is not coupled into this adapter change.
