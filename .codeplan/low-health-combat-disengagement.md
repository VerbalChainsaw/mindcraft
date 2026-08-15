[codeplan · low-health-combat-disengagement · IN · mode: full · confidence: high · candidates: V1 threshold-alignment, V2 reserved-forced-disengagement, V3 package-combat-health-watchdog · lean: V2 · baseline: V1]

## Decision target

Make an ordinary hostile encounter preserve Kevin's life once damage proves
that continuing melee is unsafe, while retaining ActionManager cancellation,
the tactical selector, Mineflayer PvP, and Pathfinder as their existing owners.

## Live evidence and hard gates

Kevin entered zombie self-defense at 16 health. The serialized self-defense
action ran for 6.445 seconds and was correctly interrupted at 10 health. The
replacement self-preservation action then ran for 3.644 seconds and Kevin died
to the same zombie. Code inspection proves the self-preservation trigger uses a
10-health threshold, but the tactical selector it calls permits melee until
health falls to 8. The emergency path therefore re-enters the general combat
policy without carrying a binding disengagement objective.

Every candidate must prevent emergency self-preservation from selecting
ordinary melee, trigger with enough observed health reserve for native route
planning, keep installed PvP and Pathfinder as the physical executors, retain
the blocked-retreat last-resort response, and add no dependency or parallel
combat/movement engine.

### V1 — threshold alignment (`constant-change`, `local-state`, `internal-reuse`)

Raise or lower the two existing numeric thresholds until they match.

G: fail — aligning both at the existing 10-health edge removes the policy
contradiction but leaves only five hearts for a Pathfinder retreat; the live
trace lost nine health during the 3.644-second emergency action. Raising the
generic critical threshold alone also changes deliberate and healthy tactical
behavior without expressing why the action must disengage.

### V2 — reserved forced disengagement (`parameter-object`, `local-state`, `internal-reuse`)

Trigger self-preservation after fresh damage at 14 health, retain the existing
10-health potion threshold, and pass a typed `disengage` objective into the
shared tactical selector. The selector chooses Pathfinder retreat regardless
of equipment, while its existing immediate-melee fallback remains available
only if native retreat is physically blocked.

G: pass — repairs both proven boundaries (late admission and lost emergency
intent) without replacing any package mechanic or adding another owner.

### V3 — package-combat health watchdog (`loop-inline`, `local-state`, `internal-reuse`)

Poll health inside the Mineflayer PvP wait loop and stop the package before the
outer self-preservation reflex preempts it.

G: pass — can shorten cancellation latency, but duplicates the existing
80-millisecond reflex owner inside the package adapter and still needs a
separate rule for what the replacement action should do.

## Frozen rubric

Rubric frozen: axes [Live survival coverage, Intent preservation, Package
delegation, Cancellation ownership, Testability, Blast radius] · weights
[4,3,3,3,2,1] · denominator = 80 · denominator-policy [uniform] ·
baseline-algo [lowest-effort gate-passer with no quality score of 1]

freeze: axes=Live_survival_coverage,Intent_preservation,Package_delegation,Cancellation_ownership,Testability,Blast_radius weights=4,3,3,3,2,1 denom=80 baseline=lowest-effort-gate-passer

| Axis | W | V2 | V3 |
|---|---:|---:|---:|
| Live survival coverage | 4 | 5 | 4 |
| Intent preservation | 3 | 5 | 2 |
| Package delegation | 3 | 5 | 4 |
| Cancellation ownership | 3 | 5 | 2 |
| Testability | 2 | 5 | 4 |
| Blast radius | 1 | 4 | 3 |
| Effort | — | low | medium |
| Weighted total | — | 79 | 55 |
| Normalized | — | 0.988 | 0.688 |

## Selection and repair contract

V2 wins. Implementation may change the fresh-damage retreat admission reserve,
add one typed tactical `disengage` objective, pass it only from the existing
self-preservation action, keep critical potion use at 10 health, and add focused
policy regressions. It must not change combat target attribution, ordinary
healthy combat selection, package PvP execution, Pathfinder retreat mechanics,
player protection authority, or dependencies.

[codeplan · low-health-combat-disengagement · OUT · mode: full · pick: V2 · confidence: high · beatBaseline: yes · scores: V1 disqualified, V2 0.988, V3 0.688 · reason: the live death requires both earlier reserve and binding disengagement intent, while the existing reflex already owns cancellation at sub-frame cadence · mechanism-check: passed · corrected: none]
