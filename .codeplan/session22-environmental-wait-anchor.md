[codeplan · session22-environmental-wait-anchor · IN · mode: full · confidence: high · candidates: V1 live-requester goal-recovery, V2 persisted-departure-anchor, V3 skill-transaction-return · lean: V1 · baseline: V1]

# Session 22 environmental-wait anchor

Triviality gate: `trivial: no · continue`. The repair chooses between Goal
lifecycle, persisted goal memory, and the physical source-search transaction.

## Repository calibration

Rules calibration: player identity is binding; Pathfinder owns complete-route
planning and execution; project code owns companion judgment and structured
settlement. Preserve the accepted surface source search and avoid turning
historical coordinates into movement authority. Recovery is not a productive
acquisition attempt and must not loop without new evidence.

Source calibration: GoalDirector already owns temporal feasibility and retains
bounded normalized subgoals. `goToPlayer` uses the exact named live entity,
requires a complete native route before locomotion, and verifies final
player-relative distance. Goal-only recovery commands do not enter learned
procedures. Focused tests use `node:test`, strict assertions, injected command
execution, and normalized goal contracts.

Observed boundary: after a productive 31.9-block night source-search advance,
daylight caused GoalDirector to enter `waiting_for_hostile_spawn_window` at
the remote search stance even though live requester `DadPlayer` remained at
the family base. No Pathfinder action was requested or failed.

## Variants and hard gates

- V1 `goal-transition / helper / durable-subgoal-history / internal-reuse /
  structured-recovery`: when the daylight gate closes and the exact requester
  is live beyond the companion radius, dispatch one goal-only `goToPlayer`
  recovery. A failed matching latest recovery suppresses an identical retry
  until another physical plan action supplies new evidence. `G: pass`.
- V2 `goal-transition / persisted-anchor / goal-memory / internal-reuse /
  structured-recovery`: capture the source-search departure coordinate in
  goal memory and return to it before waiting. `G: pass`; it expands persisted
  state and the departure coordinate is not necessarily the requester or a
  durable safe companion stance.
- V3 `transaction-closeout / skill-inline / action-origin / internal-reuse /
  structured-action-result`: make `harvestEntityDrop` return to its origin
  before reporting a daylight-bounded search advance. `G: pass`; the physical
  adapter does not own requester intent and this changes an accepted source
  search transaction for every caller.

Divergence: V1 and V2 differ in state location and target authority; V1 and V3
differ in module boundary and transaction timing; V2 and V3 differ in both
persistence and error propagation.

Rubric frozen: axes [Style, Theme, Methodology, Modernization, Error wrapping,
Testability, Blast radius] · weights [1,2,2,2,2,2,1] · denominator = 60 ·
denominator-policy [uniform-N/A-only] · baseline-algo
[lowest-effort gate-passer with no score of 1 on any quality axis]

`freeze: axes=Style,Theme,Methodology,Modernization,Error wrapping,Testability,Blast radius weights=1,2,2,2,2,2,1 denom=ΣW×5 baseline=lowest-effort-gate-passer`

## Scoring

| Axis | W | V1 live requester | V2 departure anchor | V3 skill return |
| --- | ---: | ---: | ---: | ---: |
| Style | 1 | 5 | 4 | 4 |
| Theme/paradigm | 2 | 5 | 3 | 3 |
| Methodology | 2 | 5 | 3 | 3 |
| Modernization | 2 | 4 | 5 | 4 |
| Error wrapping | 2 | 5 | 4 | 4 |
| Testability | 2 | 5 | 4 | 4 |
| Blast radius | 1 | 5 | 2 | 3 |
| Effort | - | low | high | medium |
| Weighted total | - | 58 | 44 | 43 |
| Normalized | - | 0.967 | 0.733 | 0.717 |

Arithmetic was evaluated with the frozen weights and one uniform 60-point
denominator. V1 is both the algorithmic baseline and the highest score.

## Repair contract and revalidation

`repair_revalidation: INVARIANT_HOLDS`. The persisted Goal and flight receipt
still prove that temporal feasibility chose a remote wait without issuing any
movement. The live requester entity supplies exact identity and current
position; the existing player-navigation skill supplies route and arrival
proof.

Implement V1 only. Limit it to `waiting_for_hostile_spawn_window`, preserve
attempt budgets, do not guess when the requester is absent/ambiguous, and do
not repeat a failed identical return without intervening physical evidence.

Live execution correction: the first requester return was correctly censored
by self-preservation after advancing 18.5 blocks, but a reused 16-block
delivery-reacquire threshold would then have accepted a 13.5-block,
no-line-of-sight wait stance. The mechanism remains V1; its companion done
condition is six blocks, while `goToPlayer` still targets three and verifies
final distance.

[codeplan · session22-environmental-wait-anchor · OUT · mode: full · pick: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1 0.967, V2 0.733, V3 0.717 · reason: exact live requester authority fixes the companion-visible wait at the owning Goal transition without changing accepted mechanics or schemas · mechanism-check: passed · corrected: execution-threshold]
