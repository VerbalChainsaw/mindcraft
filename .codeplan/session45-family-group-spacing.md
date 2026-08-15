[codeplan · session45-family-group-spacing · IN · mode: full · confidence: high · candidates: V1 requester-only entity goal, V2 centroid anchor, V3 moveAway group exclusions, V4 ranked destination cells · lean: V3 · baseline: V3]

# Session 45 family group spacing

## Decision boundary

Triviality: no · continue. The unchanged live replay proved that the repaired
spoken quantity reached `!moveAway(4)` and Pathfinder physically executed a
safe four-block displacement, but the selected endpoint increased distance
from Dad while decreasing distance from Kid. The failure is therefore the
project-owned relational target contract before path planning, not Pathfinder
execution.

## Repository calibration

- Preserve the spoken-number repair and ordinary `!moveAway` callers.
- Project code owns exact requester/group selection, constraints, and verified
  outcome; the installed Pathfinder owns planning and execution.
- Reuse the existing nearby loaded-player group convention (requester plus
  humans within eight horizontal and three vertical blocks, capped at eight).
- Reuse `GoalOutsideXZRadius`'s supported multiple exclusion zones,
  `safeMovements`, and `goToGoal`; do not add movement or dependencies.
- Keep receipts bounded and truthful. Missing requester or failed group
  spacing is failure, not generic movement success.
- This is repair class two of two. Only one unchanged final Paper tranche may
  follow.

## Variants and hard gates

- V1 `requester-only / entity-goal / internal-reuse`: route away from the exact
  requester using `GoalOutsideEntityXZRadius`. `G: fail` — “us” still permits
  approaching another named group participant.
- V2 `centroid-anchor / synthetic-target / local-state`: calculate one group
  centroid and retreat from it. `G: fail` — a centroid endpoint can approach an
  outlying participant, so it cannot verify the player-visible promise.
- V3 `group-exclusions / command-adapter / local-state / internal-reuse`:
  explicit group phrasing carries the requester through optional `!moveAway`
  arguments; the skill composes the requested origin displacement with one
  existing Pathfinder exclusion per selected participant and verifies every
  final spacing delta. `G: pass`.
- V4 `destination-ranking / bounded-enumeration / local-state / internal-reuse`:
  enumerate supported cells, rank those satisfying every group constraint,
  then send the best `GoalBlock` to Pathfinder. `G: pass`, but duplicates
  package-owned goal search and creates a broader site-selection mechanic.

The variants differ in target representation and ownership: single entity,
synthetic centroid, package-native compound goal, or project-ranked cell.

## Frozen rubric

Rubric frozen: axes [Style fit, Package ownership, Semantic fidelity, Safety,
Truthful verification, Testability, Blast radius] · weights [1,3,3,3,2,1,2] ·
denominator = 75 · denominator-policy [uniform-N/A-only] · baseline-algo
[lowest-effort gate-passer with no score of 1 on any quality axis]

`freeze: axes=Style fit,Package ownership,Semantic fidelity,Safety,Truthful verification,Testability,Blast radius weights=1,3,3,3,2,1,2 denom=ΣW×5 baseline=lowest-effort-gate-passer`

| Axis | W | V3 group exclusions | V4 ranked cells |
|---|---:|---:|---:|
| Style fit | 1 | 5 | 4 |
| Package ownership | 3 | 5 | 3 |
| Semantic fidelity | 3 | 5 | 5 |
| Safety | 3 | 5 | 4 |
| Truthful verification | 2 | 5 | 5 |
| Testability | 1 | 5 | 4 |
| Blast radius | 2 | 5 | 2 |
| Effort | — | medium | high |
| Weighted total | — | 75 | 57 |
| Normalized | — | 1.000 | 0.760 |

Arithmetic: V3 `5+15+15+15+10+5+10=75`; V4
`4+9+15+12+10+4+4=58`, correcting the draft table total from 57 to 58 and
normalized score from 0.760 to 0.773. The common denominator is 75.

## Winner contract

V3 wins and is the algorithmic baseline. Recognize explicit plural courtesy
phrasing before generic movement, serialize the exact requester, select that
requester plus the bounded nearby loaded human group, and build one package
goal requiring both the requested XZ displacement and a positive spacing gain
from every selected participant. Preserve the safe elevation band and verify
origin displacement, group deltas, and final elevation before returning
`retreated`. Ordinary `!moveAway` behavior remains unchanged.

[codeplan · session45-family-group-spacing · OUT · mode: full · pick: V3 · confidence: high · beatBaseline: baseline-wins · scores: V3 1.000, V4 0.773, V1/V2 gate-fail · reason: package-native exclusion composition is the smallest mechanism that represents every participant and retains Pathfinder ownership · mechanism-check: passed · corrected: V4 arithmetic 57→58 and 0.760→0.773]

## Physical acceptance result

Focused routing and compound-goal checks passed 24/24, but the sole final
unchanged Paper tranche did not physically accept V3. Exact participant
selection and arguments were correct; the compound goal returned
`skill_unreachable` after 52 ms and moved only 0.13 blocks. No separate receipt
proves that a legal supported endpoint existed, so this does not yet falsify
Pathfinder or justify V4. Campaign bounds close the slice without replay or
replan. Preserve V3 as physically unaccepted work and require a bounded
legal-endpoint feasibility receipt if broad play later re-exposes this outcome.

[codeplan · session45-family-group-spacing · ACCEPTANCE · result: failed · evidence: flight-2026-08-13T05-20-09-077Z-93290-000.jsonl · boundary: feasibility/planning unknown · action: campaign-closed-no-replay]
