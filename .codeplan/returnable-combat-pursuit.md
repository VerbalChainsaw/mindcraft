[codeplan · returnable-combat-pursuit · IN · mode: full · confidence: high · candidates: V1 package-movement-guard, V2 post-combat-return, V3 round-trip-target-preflight · lean: V1 · baseline: V1]

## Decision target

Prevent package-owned melee pursuit from taking Kevin down a one-way drop and
leaving later player movement impossible, without replacing mineflayer-pvp or
Pathfinder.

## Evidence and hard gates

The live trace moved Kevin from supported dry ground at y=71 to a cavity at
y=68 during a spider engagement. The engagement then timed out, and two later
player rendezvous attempts proved `skill_unreachable`. The installed
mineflayer-pvp 1.3.2 delegates pursuit to Pathfinder using the supplied
Movements object. Its bundled Movements default permits four-block drops and
unbounded liquid drops.

Every candidate must prevent the observed deep-drop edge before locomotion,
retain mineflayer-pvp as the combat executor, preserve ActionManager
cancellation and evidence, add no dependency, and avoid a parallel movement or
combat engine.

### V1 — package movement guard (`adapter-config`, `local-only`, `internal-reuse`)

Supply mineflayer-pvp a combat-specific instance of the existing safe
Movements, with parkour disabled, liquid plunges disabled, and native drops
capped at one standing-cell block. Mineflayer-pvp and Pathfinder still own all
pursuit, jumps, and attacks.

G: pass — directly removes the observed three-block pursuit edge through the
installed package's supported configuration surface.

### V2 — post-combat return (`loop-inline`, `local-state`, `degrade-graceful`)

Record the pre-combat stance and run a separate Pathfinder return after every
combat settlement.

G: fail — recovery begins only after the one-way edge was already consumed, so
it cannot guarantee a route exists and does not prevent the observed trap.

### V3 — round-trip target preflight (`preflight-sequence`, `local-state`, `internal-reuse`)

Probe a complete route to the target's current region and a reverse route to
the origin before enabling dynamic package pursuit.

G: pass — stronger static proof, but the hostile can move after preflight; a
correct implementation needs a second pursuit leash and materially more
lifecycle state than the observed defect requires.

## Frozen rubric

Rubric frozen: axes [Observed safety, Package delegation, Cancellation
ownership, Live utility, Testability, Blast radius] · weights [4,3,3,2,2,1] ·
denominator = 75 · denominator-policy [uniform] · baseline-algo
[lowest-effort gate-passer with no quality score of 1]

freeze: axes=Observed_safety,Package_delegation,Cancellation_ownership,Live_utility,Testability,Blast_radius weights=4,3,3,2,2,1 denom=75 baseline=lowest-effort-gate-passer

| Axis | W | V1 | V3 |
|---|---:|---:|---:|
| Observed safety | 4 | 5 | 5 |
| Package delegation | 3 | 5 | 4 |
| Cancellation ownership | 3 | 5 | 3 |
| Live utility | 2 | 4 | 3 |
| Testability | 2 | 5 | 3 |
| Blast radius | 1 | 5 | 2 |
| Effort | — | low | high |
| Weighted total | — | 73 | 59 |
| Normalized | — | 0.973 | 0.787 |

## Selection and repair contract

V1 wins and is the baseline. Implementation may add one combat Movements
adapter, use it at the existing mineflayer-pvp handoff, and add one focused
configuration regression. It must not change target selection, combat budgets,
Pathfinder itself, Operator Hold, player pursuit, or dependencies.

[codeplan · returnable-combat-pursuit · OUT · mode: full · pick: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1 0.973, V2 disqualified, V3 0.787 · reason: the installed combat package already accepts the exact movement-policy correction needed to prevent the observed one-way drop · mechanism-check: passed · corrected: none]
