[codeplan · session22-harvest-target-binding · IN · mode: full · confidence: high · candidates: V1 exact-target-passthrough, V2 rejected-target-exclusion, V3 dedicated-target-command, V4 old-target-only-gate · lean: V1 · baseline: V2]

## Decision

Observed defect: GoalDirector authorized a replay because Spider `59574` was
new evidence, but the ordinary `harvestEntityDrop` selector independently chose
the nearer previously rejected Spider `58072` three times. The correction must
preserve project-owned target identity while leaving Pathfinder pursuit and the
installed tactical combat package unchanged.

Calibration: ESM JavaScript uses camelCase arguments, snake_case capability and
receipt codes, normalized frozen capability arguments, boolean skill settlement
with structured evidence, and focused `node:test` assertions. GoalDirector owns
durable retry authority; the capability/command/skill path owns deterministic
argument carriage; the harvest skill owns candidate selection but delegates
movement and combat. Missing bound identity must wait truthfully, not fall back
to nearest or become a learned method failure.

## Variants and gates

- **V1 exact-target-passthrough** (`argument-token`, `internal-reuse`,
  `degrade-graceful`): temporal feasibility returns the exact qualifying entity
  ID; GoalDirector binds it as an optional normalized capability argument; the
  existing command and skill carry and exclusively honor it. A dispatch race
  settles under the existing censored `source_access_pending` receipt with a
  target-identity-stale detail and retains the latch. **G: pass.**
- **V2 rejected-target-exclusion** (`set-filter`, `internal-reuse`,
  `degrade-graceful`): carry only the old rejected entity ID and let the skill
  pick the nearest different qualified Spider. It stops the observed identical
  retry but does not preserve which new source actually authorized execution.
  **G: pass.**
- **V3 dedicated-target-command** (`new-command`, `internal-reuse`,
  `return-code`): add a target-specific direct command that wraps the same
  harvest skill. It preserves identity but duplicates public command surface
  and routing for one replay mode. **G: pass.**
- **V4 old-target-only-gate** (`inline-guard`, `local-only`, `degrade-graceful`):
  ignore new entities and replay only when the rejected Spider itself moves.
  **G: fail — functional correctness and negative-space; it avoids rather than
  uses the expressly supported new-source evidence.**

Pairwise divergence: V1 changes the existing argument contract; V2 changes the
selection data structure from exact token to exclusion set; V3 introduces a new
command boundary; V4 changes only GoalDirector control flow.

Rubric frozen: axes [Style, Theme, Methodology, Modernization, Error wrapping, Testability, Blast radius] · weights [1,2,2,2,2,2,1] · denominator = Σ(weights) × 5 · denominator-policy [uniform-N/A-only] · baseline-algo [lowest-effort gate-passer with no score of 1 on any quality axis]

freeze: axes=Style,Theme,Methodology,Modernization,Error wrapping,Testability,Blast radius weights=1,2,2,2,2,2,1 denom=ΣW×5 baseline=lowest-effort-gate-passer

## Scoring

| Axis | W | V1 exact target | V2 exclusion | V3 new command |
|---|---:|---:|---:|---:|
| Style | 1 | 5 | 4 | 4 |
| Theme | 2 | 5 | 3 | 5 |
| Methodology | 2 | 5 | 4 | 4 |
| Modernization | 2 | 5 | 4 | 4 |
| Error wrapping | 2 | 5 | 4 | 5 |
| Testability | 2 | 5 | 4 | 4 |
| Blast radius | 1 | 4 | 4 | 3 |
| Effort | — | medium | low | medium |
| Weighted total | — | 59 | 46 | 51 |
| Normalized | — | 0.983 | 0.767 | 0.850 |

Arithmetic: denominator `(1+2+2+2+2+2+1)*5 = 60`; V1
`5+10+10+10+10+10+4=59`; V2 `4+6+8+8+8+8+4=46`; V3
`4+10+8+8+10+8+3=51`.

Baseline is V2, the lowest-effort gate-passer without a quality-axis score of
1. V1 wins because the target-identity spine requires the exact selected
identity to survive into physical execution, while its optional argument keeps
ordinary planner calls backward-compatible and avoids a parallel command.

[codeplan · session22-harvest-target-binding · OUT · mode: full · pick: V1 · confidence: high · beatBaseline: yes · scores: V1 0.983, V2 0.767, V3 0.850 · reason: exact qualifying identity reaches the existing package-owned mechanic with truthful race settlement · mechanism-check: passed · corrected: none]
