[codeplan · session22-player-return-arrival-envelope · IN · mode: full · confidence: high · candidates: V1 aligned-goal-envelope, V2 persistent-search-continuation, V3 snapshot-reacquire-loop · lean: V1 · baseline: V1]

# Session 22 player-return arrival envelope

Triviality gate: `trivial: no · continue`. The eventual edit may be small, but
the demonstrated failure crosses the project-owned pursuit contract and the
installed Pathfinder planner, with materially different semantic, search, and
reacquisition mechanisms.

## Repository calibration

Rules calibration: exact player identity is binding; player pursuit receives
no locomotion authority until native Pathfinder proves a complete route; a
partial path must remain zero movement. Project code owns the accepted arrival
contract, while Pathfinder owns route search and execution. No digging,
placement, custom locomotion, dependency change, or unsafe partial execution is
authorized.

Source calibration: `goToPlayer` normalizes the requested distance, constructs
one native `GoalFollow`, requires `probeSafeNavigationGoal` success, executes
the same goal through Pathfinder, then already accepts the physical outcome at
`distance + 1`. Focused checks use `node:test`, strict assertions, and injected
Pathfinder results.

Observed boundary: the live return from `(8196.45,66,7951.33)` to Dad at
`(8104.5,69,7939.5)` timed out at five seconds with a 92-node partial route and
zero movement. A controlled ten-second repeat still returned partial. Letting
the same no-dig/no-place native search reach a terminal result exhausted
143,462 nodes after 17.406 seconds and returned `noPath`; its best legal stance
was `(8104.5,66,7938.5)`, 3.08 blocks from Dad. A bounded native probe using
the action's existing four-block verified-completion envelope returned
`success` with 93 nodes in 561 ms.

## Variants and hard gates

- V1 `aligned-envelope / local-only / internal-reuse / return-code`: construct
  the existing dynamic `GoalFollow` with the same `distance + 1` envelope that
  already governs physical completion, then retain exact-player reacquisition
  and final distance verification. `G: pass`.
- V2 `search-continuation / package-instance / internal-reuse / return-code`:
  preserve or extend A* computation until a longer terminal horizon before
  deciding. `G: fail [functional correctness: the same planner terminates as
  noPath after 17.406 seconds; more budget cannot cross the evidenced geometry]`.
- V3 `snapshot-reacquire / local-loop / internal-reuse / return-code`: route to
  an immutable snapshot inside the accepted envelope, reacquire the exact live
  player, and repeat a bounded phase if the player moved. `G: pass`; it adds a
  second pursuit control flow and is less responsive than the existing dynamic
  goal for no demonstrated benefit.

Divergence: V1 and V2 differ in state location and correction mechanism
(semantic goal versus retained package search); V1 and V3 differ in control
flow (one dynamic goal versus snapshot/reacquire loop); V2 and V3 differ in
both package state and project control flow.

Rubric frozen: axes [Style, Theme, Methodology, Modernization, Error wrapping,
Testability, Blast radius] · weights [1,2,2,2,2,2,1] · denominator = 60 ·
denominator-policy [uniform-N/A-only] · baseline-algo
[lowest-effort gate-passer with no score of 1 on any quality axis]

`freeze: axes=Style,Theme,Methodology,Modernization,Error wrapping,Testability,Blast radius weights=1,2,2,2,2,2,1 denom=ΣW×5 baseline=lowest-effort-gate-passer`

## Scoring

| Axis | W | V1 aligned envelope | V3 snapshot loop |
| --- | ---: | ---: | ---: |
| Style | 1 | 5 | 4 |
| Theme/paradigm | 2 | 5 | 4 |
| Methodology | 2 | 5 | 4 |
| Modernization | 2 | 4 | 4 |
| Error wrapping | 2 | 5 | 5 |
| Testability | 2 | 5 | 4 |
| Blast radius | 1 | 5 | 3 |
| Effort | - | low | medium |
| Weighted total | - | 58 | 49 |
| Normalized | - | 0.967 | 0.817 |

Arithmetic: V1 = `5+10+10+8+10+10+5 = 58`; V3 =
`4+8+8+8+10+8+3 = 49`; both use the frozen denominator
`(1+2+2+2+2+2+1)×5 = 60`. V1 is the algorithmic baseline and highest score.

## Repair contract

Implement V1 only. Keep the complete native-route gate, zero movement on
partial/noPath/error, exact named-player target, and final live-player
verification. Do not change Pathfinder, terrain permissions, timeouts,
dependencies, or the stored Goal/Agenda schemas. Add one focused regression
for a complete native route to a legal stance between the requested radius and
the already-authorized verified-completion radius, then replay the same broad
breakfast.

[codeplan · session22-player-return-arrival-envelope · OUT · mode: full · pick: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1 0.967, V3 0.817, V2 disqualified · reason: align native planning with the action's existing verified completion contract; longer search is disproved and snapshot pursuit adds unnecessary control flow · mechanism-check: passed · corrected: none]
