[codeplan · session41-shared-family-placement · IN · mode: full · confidence: high · candidates: V1 prompt-nudge local-guidance, V2 shared-place command-adapter, V3 here-overload context-mutation, V4 builder-cell persisted-job, V5 shared-command new-module · lean: V2 · baseline: V2]

# Session 41 shared family placement

Triviality gate: `trivial: no · continue`. The observed request lost a
player-relative reachability promise before physical execution and selected a
command with explicitly different semantics. The repair crosses natural intent,
the direct command API, site judgment, evidence, and live reconciliation.

## Repository calibration

Governance calibration: natural and direct requests must converge on the same
deterministic gameplay skill. Project code owns intent, participant identity,
carried-item binding, relational site selection, legal supported stances, and
truthful verification. Pathfinder owns route planning/execution after a target
is selected; Mineflayer/Paper owns placement acknowledgement. Repair the first
unproven boundary and do not alter successful mechanics.

Source calibration: `!placeHere` literally places at the bot's current cell.
The existing `!place(player, block, quantity)` delegates to
`placeNearPlayer`, which already resolves an exact player, searches bounded
supported cells, calls the shared strict `placeBlock`, and returns structured
evidence. `placeBlock` already emits the four-stage interaction stance receipt.
Focused tests use `node:test`, strict assertions, small Vec3 worlds, and exact
command/evidence assertions.

Spot checks confirmed `!placeHere` passed the bot position in Session 41 and
`placeNearPlayer` passes strict non-replacing placement into `placeBlock`.

## Variants and hard gates

- V1 `prompt-nudge / local-guidance / zero-state / internal-reuse / prose-fail`:
  clarify command descriptions and rely on the model to calculate a coordinate
  and choose `!placeBlockAt`. `G: fail` — violates deterministic convergence and
  still cannot prove a shared legal site before issuing the action.
- V2 `shared-place / command-adapter / local-state / internal-reuse /
  return-code`: deterministically recognize carried single-block relational
  placement, route it to the existing `!place` command with an optional shared
  flag, and extend `placeNearPlayer` to rank supported non-obstructing sites
  against the requester plus the nearby human group while retaining
  `placeBlock` mechanics and stance receipts. `G: pass`.
- V3 `here-overload / context-mutation / instance-state / internal-reuse /
  degrade-graceful`: reinterpret `!placeHere` from ActionManager's request
  context whenever a requester exists. `G: fail` — changes the documented
  direct-command contract, makes explicit `!placeHere` context-dependent, and
  silently regresses current-location torch/block use.
- V4 `builder-cell / persisted-job / external-store / internal-reuse /
  return-code`: compile the carried table as a one-cell Builder work order and
  use construction site selection/persistence. `G: pass`, but it converts a
  responsive carried-item action into durable construction and broadens
  acquisition/job semantics.
- V5 `shared-command / new-module / local-state / internal-reuse /
  return-code`: add a separate `!placeShared` API plus a new relational-site
  module and receipt schema. `G: pass`, but duplicates an existing command and
  selector ownership seam.

Divergence: V1 is model-local guidance; V2 adapts an existing command and skill;
V3 mutates existing command semantics through request instance state; V4 uses a
persisted job; V5 adds a parallel command/module boundary. Each differs in
module boundary, state location, or error path; none is a naming restatement.

Rubric frozen: axes [Semantic fidelity, Contract ownership, Evidence truth,
Gameplay quality, Testability, Regression safety, Blast radius] · weights
[3,3,2,2,2,2,1] · denominator = 75 · denominator-policy
[uniform-N/A-only] · baseline-algo [lowest-effort gate-passer with no score of
1 on any quality axis]

`freeze: axes=Semantic fidelity,Contract ownership,Evidence truth,Gameplay quality,Testability,Regression safety,Blast radius weights=3,3,2,2,2,2,1 denom=ΣW×5 baseline=lowest-effort-gate-passer`

## Scoring

| Axis | W | V2 shared-place | V4 builder-cell | V5 shared-command |
| --- | ---: | ---: | ---: | ---: |
| Semantic fidelity | 3 | 5 | 4 | 5 |
| Contract ownership | 3 | 5 | 4 | 4 |
| Evidence truth | 2 | 4 | 5 | 5 |
| Gameplay quality | 2 | 5 | 3 | 5 |
| Testability | 2 | 4 | 5 | 5 |
| Regression safety | 2 | 4 | 3 | 3 |
| Blast radius | 1 | 4 | 2 | 2 |
| Effort | - | medium | high | medium-high |
| Weighted total | - | 68 | 58 | 65 |
| Normalized | - | 0.907 | 0.773 | 0.867 |

Arithmetic was independently evaluated with weights `3,3,2,2,2,2,1`; all
three variants use the identical 75-point denominator. V2 is the algorithmic
baseline and highest score. It preserves the established responsive placement
surface, introduces no parallel mechanic, and makes the missing relational
promise explicit without changing ordinary `!place` callers.

## Winning repair contract

Implement V2 only. A natural request to place one carried block “beside/near
us” must bind the exact item and requester, select the existing `!place`
capability in shared mode, identify the bounded loaded human group near that
requester, choose a supported replaceable unoccupied site within the shared
distance envelope with at least two legal adjacent stances, and then delegate
route/placement/acknowledgement unchanged to `placeBlock`. Failure to find such
a site settles truthfully before placement. Preserve exact interaction-stance
evidence in the final action result. Existing three-argument `!place` and
`!placeHere` semantics remain unchanged.

[codeplan · session41-shared-family-placement · OUT · mode: full · pick: V2 · confidence: high · beatBaseline: baseline-wins · scores: V2 0.907, V4 0.773, V5 0.867 · reason: existing responsive placement is the correct shared seam; explicit shared intent and site ranking fix selection without duplicating mechanics or jobs · mechanism-check: passed · corrected: none]
