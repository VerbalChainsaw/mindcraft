[codeplan · campaign67-craft-output-selection · IN · mode: full · confidence: high · candidates: V1 live-recipe direct-agenda, V2 output-contract additive-schema, V3 strategy-hint cross-owner · lean: V1 · baseline: V1]

## Decision boundary

The valid post-repair Paper replay disproved the first mechanism: a generic
`acquire torch` Goal treated placed Torches as collectible blocks, wandered 54
blocks, and never used the carried Coal and Sticks. One final repair class and
one final gameplay tranche remain. The correction must preserve Dad's explicit
craft verb, exact 8 -> Kid 4 + bot 4 postcondition, existing package mechanics,
and the bounded campaign.

Triviality gate: no · continue. Calibration is direct because multi-agent
delegation is not authorized. Relevant repository rules require typed durable
Agenda intent, package-first mechanics, first-unproven-boundary repair, no new
dependency, and physical verification without widening the campaign.

## Variants and gates

- V1 `live-recipe direct-agenda`: at parse time use Mineflayer's loaded recipe
  metadata to convert desired output into recipe executions; queue existing
  direct `craft`, exact `deliver`, and final inventory-checklist entries.
  G: pass.
- V2 `output-contract additive-schema`: add a persisted craft-output target and
  baseline to Agenda normalization; AgendaDirector converts it to recipe work
  and verifies output before settlement. G: pass.
- V3 `strategy-hint cross-owner`: add a craft-only acquisition strategy through
  Goal contract and prerequisite selection so hybrid block/items prefer crafting
  when the player said craft. G: pass.

Divergence: V1 keeps state local to the parser and reuses the existing direct
kind; V2 adds persisted typed state and Director reconciliation; V3 crosses the
GoalDirector/prerequisite ownership boundary. No candidate adds a dependency or
duplicates physical crafting.

Rubric frozen: axes [Semantic fidelity,Package ownership,Durable truth,Campaign scope,Compatibility,Testability,Blast radius] · weights [2,2,2,2,1,1,2] · denominator = 60 · denominator-policy [uniform-N/A-only] · baseline-algo [lowest-effort gate-passer with no score of 1 on any quality axis]

freeze: axes=Semantic fidelity,Package ownership,Durable truth,Campaign scope,Compatibility,Testability,Blast radius weights=2,2,2,2,1,1,2 denom=ΣW×5 baseline=lowest-effort-gate-passer

## Scoring

| Axis | W | V1 | V2 | V3 |
|---|---:|---:|---:|---:|
| Semantic fidelity | 2 | 5 | 5 | 5 |
| Package ownership | 2 | 5 | 5 | 4 |
| Durable truth | 2 | 4 | 5 | 5 |
| Campaign scope | 2 | 5 | 3 | 2 |
| Compatibility | 1 | 5 | 4 | 3 |
| Testability | 1 | 5 | 4 | 3 |
| Blast radius | 2 | 5 | 3 | 2 |
| Effort | - | low | medium | high |
| Weighted total | - | 58 | 50 | 42 |
| Normalized | - | 0.967 | 0.833 | 0.700 |

Baseline guard selects V1: it is the lowest-effort gate-passer and has no
quality-axis score of 1. V1 also wins outright. Its final delivery receipt plus
retained-inventory checklist prove the eight-output postcondition from the
recorded zero-Torch baseline, so a new persistence field is unnecessary.

[codeplan · campaign67-craft-output-selection · OUT · mode: full · pick: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1 0.967, V2 0.833, V3 0.700 · reason: live recipe conversion preserves the explicit craft verb and exact final custody through existing typed/package seams with the smallest blast radius · mechanism-check: passed · corrected: none]
