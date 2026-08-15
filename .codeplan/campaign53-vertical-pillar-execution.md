[codeplan · campaign53-vertical-pillar-execution · IN · mode: full · confidence: high · candidates: V1 upstream-executor package-patch, V2 scoped-clearance config-contract, V3 short-tree selection-filter · lean: V1 · baseline: V1]

# Campaign 53 — vertical pillar execution

## Decision context

Target is the current dirty workspace at HEAD
`2b7fc3d1ee9b733d17142e296823e3d3d51a1cf5`; no unrelated WIP may be
discarded or absorbed. The installed runtime is Mineflayer 4.37.1,
Mindcraft-owned `mineflayer-pathfinder` 2.4.5, and
`mineflayer-collectblock` 1.6.0-mindcraft.5 on Paper 1.21.11.

The live action gained seven logs but left the top log at
`(8175,75,7934)`. A fresh read-only native path probe from the settled body at
`(8175.5,68,7934.5)` proved `GoalLookAtBlock` has a successful one-edge route
using exactly one authorized vertical placement; without placement it was only
partial. Runtime recorded one placed/reclaimed scaffold and then physical
route stall. The installed executor starts placement as soon as body Y exceeds
`referenceY + 1`, before the body is above the new block. Upstream issue #296
and open PR #356 identify this exact vertical-pillar timing failure; PR #356
changes the threshold to `referenceY + 2.1` and forces same-tick look during
placement. Local Mineflayer exposes the compatible `_placeBlockWithOptions`
implementation.

## Calibration

- Package-first: Pathfinder owns pillar planning and execution; project code
  owns only authorization, budgets, receipts, and stewardship.
- Shared spine: legal stance exists, Pathfinder plans it, physical execution
  stalls. Do not change selection, feasibility, tree discovery, collection,
  cleanup, or reasoning.
- Workflow: smallest package adaptation, focused diagnostics, real Paper,
  freeze on sensible physical success. No dependency version change.
- Style: StandardJS in the vendored runtime; promises retain settled cleanup.
- Error behavior is globally N/A because no result/error contract changes.

## Variants and gates

### V1 — `upstream-executor package-patch`

Apply the two bounded PR #356 executor corrections directly to the
Mindcraft-owned vendored Pathfinder: wait until the jumping body clears the
new block, then invoke Mineflayer's existing force-look placement primitive.
No API, schema, dependency, or project collection change.

G: pass.

### V2 — `scoped-clearance config-contract`

Add new Movements fields for jump-placement clearance and force-look behavior,
thread them through types and the Pathfinder executor, then opt in only from
whole-tree movements. This preserves old generic placement behavior but adds a
new package API and several ownership edges for a mechanic upstream already
defines globally as incorrect.

G: pass.

### V3 — `short-tree selection-filter`

Reject or avoid trees whose crowns require vertical scaffolding.

G: fail — negative-space and functional correctness. It evades the physically
legal requested tree instead of repairing the proven package execution stage.

## Frozen rubric

Rubric frozen: axes [Style, Theme, Methodology, Modernization, Error wrapping,
Testability, Blast radius] · weights [1,2,2,2,2,2,1] · denominator = 50 after
global Error wrapping N/A · denominator-policy [uniform-N/A-only] ·
baseline-algo [lowest-effort gate-passer with no score of 1 on any quality
axis]

freeze: axes=Style,Theme,Methodology,Modernization,Error wrapping,Testability,Blast radius weights=1,2,2,2,2,2,1 denom=ΣW×5 baseline=lowest-effort-gate-passer

## Scoring

| Axis | W | V1 upstream-executor | V2 scoped-clearance |
|---|---:|---:|---:|
| Style | 1 | 5 | 4 |
| Theme | 2 | 5 | 4 |
| Methodology | 2 | 5 | 3 |
| Modernization | 2 | 4 | 4 |
| Error wrapping | 2 | N/A | N/A |
| Testability | 2 | 3 | 4 |
| Blast radius | 1 | 4 | 3 |
| Effort | - | low | medium |
| Weighted total | - | 43 | 37 |
| Normalized | - | 0.860 | 0.740 |

Arithmetic: active weight sum is 10 and denominator is 50. V1 is
`5 + 10 + 10 + 8 + 6 + 4 = 43`; V2 is
`4 + 8 + 6 + 8 + 8 + 3 = 37`.

Baseline V1 is the lowest-effort gate-passer and has no quality-axis score of
1. It also wins. V1 preserves native package ownership, matches the available
upstream correction, and has the smallest reversible blast radius. V2's
scoped API appears cautious but permanently preserves a known-bad generic
executor default and adds configuration surface without a second product
contract.

[codeplan · campaign53-vertical-pillar-execution · OUT · mode: full · pick: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1 0.860, V2 0.740 · reason: apply the bounded upstream correction at the package execution owner with no new API or dependency · mechanism-check: passed · corrected: none]
