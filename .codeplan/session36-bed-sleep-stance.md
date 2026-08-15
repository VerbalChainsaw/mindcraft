[codeplan · session36-bed-sleep-stance · IN · mode: full · confidence: high · candidates: V1 Bed prefilter+extracted-filter, V2 Sleep goal+class-method, V3 Rejection retry+retry-fallback · lean: V1 · baseline: V1]

## Decision boundary

Triviality: no · continue. The live bed failure crosses the project-owned
interaction-stance contract, the local Pathfinder package, and Mineflayer
4.37.1's bed primitive. No dependency or schema change is authorized.

CENTER found the exact executed trajectory: generic `GoalLookAtBlock` admitted
the supported `(8105,66,7938)` stance for a Bed at `(8105,69,7939)`;
Pathfinder planned and executed six nodes to it; Mineflayer's bed plugin then
rejected the body because its bed click envelope permits only two blocks of
vertical separation. The required invariant is that every stance offered to
bed route probing already satisfies the installed Mineflayer bed envelope.

## Repository calibration

- Shared-contract fidelity: selection, planning, execution, and interaction
  rejection remain distinct and evidence-backed.
- Package-first ownership: project code judges legal stances; Pathfinder owns
  route planning/execution; Mineflayer owns the sleep attempt/acknowledgement.
- Compatibility: crafting tables, furnaces, containers, doors, placement, and
  generic `GoalLookAtBlock` behavior remain frozen.
- Method: smallest observed repair, one focused regression, one unchanged live
  replay, then stop at the campaign bound.
- Style/test idiom: pure helpers and injectable deterministic `node:test`
  checks in `skills.js` and `survival-sleep.test.js`; structured evidence rather
  than log parsing.

## Variants and gates

### V1 — Bed prefilter (`extracted-filter`, `internal-reuse`)

Use Mineflayer's exposed `bot.parseBedMetadata` plus one pure, package-calibrated
bed-envelope predicate in `skills.js`. Enumerate the existing generic standing
cells, filter them before `reachInteractionStance`, and pass the remaining
cells through the unchanged shared probe/execution contract.

G: pass. It repairs legality before planning, introduces no dependency, leaves
generic interaction behavior intact, and keeps the package primitive as the
interaction authority.

### V2 — Sleep-specific goal (`class-method`, `package-adapter`)

Add `GoalSleepAtBed` to the local Pathfinder package. Make its `isEnd` combine
visibility with the Mineflayer bed envelope, then use it from `goToBed` so the
generic stance enumerator receives the narrower goal.

G: pass. It can enforce the invariant, but embeds a Mineflayer interaction
contract inside the movement package, expands the vendored/package surface,
and couples future Mineflayer changes to Pathfinder maintenance.

### V3 — Rejection retry (`retry-fallback`, `local-state`)

Keep the generic ready receipt, catch `bed_too_far`, navigate to a closer cell,
and retry `bot.sleep` once.

G: fail — required contract and negative-space gates. It preserves a false
legal-stance claim, performs a knowingly rejected interaction, and repairs the
symptom after the boundary the Director explicitly requires us to diagnose.

## Frozen rubric

Rubric frozen: axes [Repo style, Shared-contract fidelity, Package-first
ownership, Behavioral compatibility, Testability, Blast radius, Error
semantics] · weights [1,3,3,2,2,2,1] · denominator = 70 ·
denominator-policy [uniform-N/A-only] · baseline-algo
[lowest-effort gate-passer with no score of 1 on any quality axis]

freeze: axes=Repo style,Shared-contract fidelity,Package-first ownership,Behavioral compatibility,Testability,Blast radius,Error semantics weights=1,3,3,2,2,2,1 denom=ΣW×5 baseline=lowest-effort-gate-passer

## Scoring

| Axis | W | V1 Bed prefilter | V2 Sleep goal |
|---|---:|---:|---:|
| Repo style | 1 | 4 | 4 |
| Shared-contract fidelity | 3 | 5 | 5 |
| Package-first ownership | 3 | 4 | 2 |
| Behavioral compatibility | 2 | 5 | 3 |
| Testability | 2 | 5 | 4 |
| Blast radius | 2 | 5 | 2 |
| Error semantics | 1 | 5 | 5 |
| Effort | — | low | medium |
| Weighted total | — | 66 | 48 |
| Normalized | — | 0.943 | 0.686 |

Arithmetic was independently checked with the frozen weights: denominator
`14×5=70`; V1 `66/70=0.943`; V2 `48/70=0.686`. Both variants use the same
axes. V1 is the algorithmic baseline and the highest scorer.

## Winner contract

Implement V1 only. The helper must derive the selected bed's head/facing from
Mineflayer's exposed metadata, match the installed plugin's click envelope,
and return a boolean without movement or interaction. `goToBed` must filter
the generic observed standing cells before probing. A focused failing-before
case must exclude the live Y=-3 stance while retaining an ordinary supported
near-bed stance. Existing shared contract stages and non-bed callers remain
unchanged. The unchanged Session 36 sentence receives the sole final live
tranche.

Repair revalidation: `INVARIANT_HOLDS`. The current flight and source still
reproduced the generic-goal/package-envelope mismatch immediately before edit.
Implementation retained the selected `extracted-filter`/`internal-reuse`
mechanism. Focused bed plus shared-contract checks passed 13/13. The unchanged
live replay removed the invalid Y=-3 candidate (seven to six) and moved the
result from `interaction_rejected/bed_too_far` to a truthful
`path_not_found/timeout` with no interaction attempt. This accepts the legality
boundary repair, not end-to-end sleep completion.

[codeplan · session36-bed-sleep-stance · OUT · mode: full · pick: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1 0.943, V2 0.686, V3 gate-fail · reason: repairs legality before planning with the smallest package-calibrated surface · mechanism-check: passed · corrected: none]
