[codeplan · campaign52-exact-harvest-intent · IN · mode: full · confidence: high · candidates: V1 job-envelope job-checkpoint, V2 agenda-chain internal-reuse, V3 composite-command command-bundle, V4 prompt-contract prompt-only · lean: V2 · baseline: V2]

# Campaign 52 — exact harvest intent and compound return

## Center Audit result

Mode: AUTONOMOUS. Target is the dirty working tree at HEAD
`2b7fc3d1ee9b733d17142e296823e3d3d51a1cf5`; existing changes are preserved.

Claim: a player request for newly gathered logs can falsely settle from old
inventory, and its named family return can be lost before execution.

Confirmed trajectory:

1. The exact live request split into a harvest segment and `come back to us`.
2. The harvest segment deterministically maps to `!assignHarvestJob("logs", 6)`.
3. The group-pronoun return is not converted into a typed `goto`, leaving only
   one typed step; the Agenda therefore does not intercept the compound request.
4. The model-selected harvest command creates a player work order with generic
   requester `player` and an empty checkpoint.
5. `nextLumberjackStep` computes progress as all current logs plus delivered
   logs. Seven old logs therefore satisfy quota six without a collection action.
6. The live order persisted `attempts: 0`, no anchor, empty checkpoint, and
   terminal `log_quota_retained` 94 ms after creation.

Result: `DEFECT_CONFIRMED`, HIGH confidence. The first failed boundary is typed
compound-intent admission, followed by player-harvest acquisition accounting.
Mineflayer collection, Pathfinder, tree selection, JobDirector action
settlement, and Paper are frozen non-owners.

Falsifier: a current-source trace showing `come back to us` becomes a typed
requester-bound return and a player harvest order persists a baseline which the
lumberjack reducer subtracts before quota reconciliation. Neither exists.

Smallest safe repair contract: reuse the existing Agenda chain for harvest then
return; bind group pronouns to the exact requesting player; persist additive
player-harvest inventory checkpoints; count only post-request inventory growth
plus verified delivery. Role stockpile orders remain absolute. Direct and
natural player harvest paths must share the same accounting.

## Triviality gate

`trivial: no · continue` — the fix crosses intent routing and durable work-order
accounting, with materially different mechanisms.

## Calibration

- Style: ESM, small pure helpers, normalized frozen persisted state, structured
  codes, `node:test` with strict assertions.
- Theme: selection → feasibility → planning → execution → reconciliation →
  verified outcome; missing evidence remains unknown.
- Method: repair the first unproven shared boundary; preserve existing Agenda,
  JobDirector, ActionManager, Pathfinder, and package mechanics.
- Error behavior: reject or wait truthfully; never infer an action from carried
  inventory that predates the request.
- Verification: focused parser/reducer/dispatch checks, then unchanged Paper
  gameplay; no broad suite or synthetic framework.
- Blast radius: preserve dirty WIP and role-owned absolute stockpile semantics.

## Variants and gates

- V1 `job-checkpoint`: encode baseline, requester, and return inside the
  lumberjack WorkOrder only. `G: fail` — the observed natural request loses the
  group return before order creation, so this leaves the first failed boundary
  unresolved.
- V2 `agenda-chain`: teach the existing directive/Agenda path to bind `us` to
  the exact requester, then add persisted additive checkpoints to player
  harvest admission and make the lumberjack reducer consume them. Direct
  `!assignHarvestJob` uses the same additive accounting; role jobs stay
  absolute. `G: pass`.
- V3 `command-bundle`: introduce a new composite harvest-plan command carrying
  requester and return flags, and teach the model to choose it instead of the
  existing command. `G: pass`, but it duplicates existing Agenda composition
  and leaves correctness more dependent on model command choice.
- V4 `prompt-only`: tell the model to mention requester, old inventory, and
  return in prose. `G: fail` — no deterministic or persisted contract.

Divergence: V2 uses the existing Agenda state/dispatcher; V3 adds a new command
boundary and model-selected bundle. V1 stores coordination in WorkOrder; V4 has
no state carrier. These differ in module boundary, state location, and control
flow rather than naming.

## Frozen rubric

Rubric frozen: axes [Style, Theme, Methodology, Modernization, Error wrapping,
Testability, Blast radius] · weights [1,2,2,2,2,2,1] · denominator = 60 ·
denominator-policy [uniform-N/A-only] · baseline-algo
[lowest-effort gate-passer with no score of 1 on any quality axis]

freeze: axes=Style,Theme,Methodology,Modernization,Error wrapping,Testability,Blast radius weights=1,2,2,2,2,2,1 denom=ΣW×5 baseline=lowest-effort-gate-passer

## Scoring

| Axis | W | V2 agenda-chain | V3 command-bundle |
|---|---:|---:|---:|
| Style | 1 | 5 | 4 |
| Theme | 2 | 5 | 4 |
| Methodology | 2 | 5 | 4 |
| Modernization | 2 | 4 | 4 |
| Error wrapping | 2 | 5 | 4 |
| Testability | 2 | 5 | 4 |
| Blast radius | 1 | 4 | 3 |
| Effort | — | medium | high |
| Weighted total | — | 57 | 47 |
| Normalized | — | 0.950 | 0.783 |

Arithmetic: V2 = `5 + 10 + 10 + 8 + 10 + 10 + 4 = 57`; V3 =
`4 + 8 + 8 + 8 + 8 + 8 + 3 = 47`; common denominator is
`(1+2+2+2+2+2+1)*5 = 60`.

Baseline is V2: it is the lowest-effort gate-passer and has no quality-axis
score of one. It also wins the frozen rubric.

## Implementation verification

Implemented the selected mechanism without a mechanism shift. The existing
directive/Agenda chain now binds `come back to us` to the canonical requester;
player harvest admission persists baseline and target inventory in the ordinary
WorkOrder checkpoint; the lumberjack reducer subtracts that baseline; and the
direct harvest command uses the same requester and fresh-output contract. Role
stockpile orders remain absolute. Five focused parser, Agenda admission, direct
command, and reducer checks pass; syntax and focused whitespace checks pass.

[codeplan · campaign52-exact-harvest-intent · OUT · mode: full · pick: V2 · confidence: high · beatBaseline: baseline-wins · scores: V2 0.950, V3 0.783 · reason: existing Agenda preserves the compound chain while one persisted acquisition checkpoint fixes shared player-harvest accounting · mechanism-check: passed · corrected: none]
