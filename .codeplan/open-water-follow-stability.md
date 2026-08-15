[codeplan · open-water-follow-stability · IN · mode: full · confidence: high · candidates: V1 follow-local surface-assist, V2 arbiter-wide surface-owner, V3 directive-persistent wet-recovery · lean: V1 · baseline: V1]

## Decision target

Prevent a standing follow directive from repeatedly re-submerging Kevin after a
successful drowning reflex, while preserving ordinary open-water rescue and
delegating horizontal locomotion and shoreline routing to Pathfinder.

## Repository-calibrated quality axes

- Safety-contract correctness: no repeated drowning/recovery ownership loop.
- Package-first delegation: Pathfinder retains route planning and execution.
- Lifecycle ownership: no competing movement owner or uncensored retry loop.
- Live companion utility: follow should keep progressing when a safe route exists.
- Testability: the water-only adapter must have a focused deterministic check.
- Blast radius: preserve accepted dry-land follow, combat, and Operator Hold.

## Variants and hard gates

### V1 — follow-local surface-assist (`loop-inline`, `local-only`, `internal-reuse`)

While `followPlayer` is in liquid and its player target is dry and supported,
hold Mineflayer's native ascent input while Pathfinder retains horizontal route
ownership and the existing shoreline-exit adapter runs. Release ascent as soon
as the bot is dry and in `finally`.

G: pass — fixes the observed surface/dive cycle, adds no dependency or route
engine, and stays inside the gameplay skill that already owns follow mechanics.

### V2 — arbiter-wide surface-owner (`class-method`, `instance-state`, `internal-reuse`)

Generalize BehaviorArbiter's Operator-Hold surface stance into a second movement
owner that remains active during companion directives.

G: pass — mechanically viable, but it makes the control plane write locomotion
state concurrently with the active Pathfinder-owned player action.

### V3 — directive-persistent wet-recovery (`class-method`, `instance-state`, `degrade-graceful`)

Persist shoreline failures and retry state in CompanionContext across reflex
preemptions; park the follow directive until a target or geometry receipt proves
material change.

G: pass — prevents unchanged loops, but can strand an otherwise swim-capable
follow and broadens companion directive lifecycle state.

## Frozen rubric

Rubric frozen: axes [Safety contract, Package delegation, Lifecycle ownership,
Live utility, Testability, Blast radius] · weights [3,3,3,2,2,1] · denominator
= 70 · denominator-policy [uniform] · baseline-algo
[lowest-effort gate-passer with no quality score of 1]

freeze: axes=Safety_contract,Package_delegation,Lifecycle_ownership,Live_utility,Testability,Blast_radius weights=3,3,3,2,2,1 denom=70 baseline=lowest-effort-gate-passer

| Axis | W | V1 | V2 | V3 |
|---|---:|---:|---:|---:|
| Safety contract | 3 | 5 | 4 | 5 |
| Package delegation | 3 | 5 | 2 | 4 |
| Lifecycle ownership | 3 | 4 | 2 | 5 |
| Live utility | 2 | 5 | 4 | 3 |
| Testability | 2 | 4 | 3 | 4 |
| Blast radius | 1 | 5 | 2 | 1 |
| Effort | — | low | medium | high |
| Weighted total | — | 65 | 40 | 57 |
| Normalized | — | 0.929 | 0.571 | 0.814 |

## Selection and repair contract

V1 wins. It is also the baseline: the defect manifested inside the follow
mechanic, and the smallest compatible correction is a water-only vertical
stability adapter around Pathfinder rather than another movement owner or a new
persisted directive state machine.

Implementation may touch only the follow loop and a focused regression test.
It must not change dry-land movement, shoreline candidate selection, drowning
thresholds, combat policy, Operator Hold, dependencies, or player identity.

[codeplan · open-water-follow-stability · OUT · mode: full · pick: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1 0.929, V2 0.571, V3 0.814 · reason: the follow-local ascent adapter preserves native Pathfinder route ownership with the smallest lifecycle and regression surface · mechanism-check: passed · corrected: none]
