[codeplan · session22-source-access-latch-order · IN · mode: full · confidence: high · candidates: V1 clear-then-plan gate-clear, V2 force-planner planner-pin, V3 persist-replay durable-replay, V4 infer-replay subgoal-inference · lean: V3 · baseline: V2]

# Session 22 source-access latch ordering

## Decision

Live Paper proved that `skill_source_access_pending` was persisted and did not
consume the Goal attempt budget, but after the Spider moved the causal planner
selected Tripwire before the access latch was evaluated. The latch therefore
must own selection until the same acquisition method receives genuinely new
source evidence.

## Calibration

- GoalDirector owns operational retry judgment and persisted Goal memory;
  prerequisite planning should remain a causal material planner rather than
  acquiring lifecycle state.
- Receipts are bounded, normalized, immutable, and structured. Cancellation and
  environment/access waits are censored, not failed methods.
- Focused tests directly drive `handleResult()` and `update()` with fake time,
  mutable entities, captured commands, and strict assertions.
- Preserve all unrelated dirty work, add no dependency, and return to the live
  breakfast scenario after the smallest shared repair.

## Variants and hard gates

- **V1 — gate-clear (`inline-block`, `local-only`, `zero-dep`)**: wait before
  planning while the source is unchanged, then clear the latch and run the
  ordinary planner after movement. **G: fail** — a moved Spider can still lead
  the planner to select Tripwire, so it does not preserve same-method retry
  authority.
- **V2 — planner-pin (`set-filter`, `module-boundary`, `internal-reuse`)**: add a
  prerequisite-planner option that excludes every method except the latched
  method for one planning cycle. **G: pass** — functional and compatible, but
  moves operational lifecycle policy into the shared causal planner and expands
  its API/blast radius.
- **V3 — durable-replay (`instance-state`, `class-method`, `internal-reuse`)**:
  persist a normalized bounded retry descriptor with `sourceAccessPending`;
  GoalDirector resolves the latch before planning and directly rebuilds the same
  existing capability action after new entity/movement evidence. Settle or
  replace the latch only on a structured action result. **G: pass**.
- **V4 — subgoal-inference (`list-scan`, `class-method`, `zero-dep`)**: rebuild
  the replay only from the latest subgoal's learning key and expected output.
  **G: fail** — the current subgoal does not durably retain the complete
  normalized arguments such as range and alternative policy.

All variants pass dependency, security, platform, and workspace-safety gates;
V1 and V4 fail the functional/contract gate and are not scored.

## Frozen rubric

Rubric frozen: axes [Style, Theme, Methodology, Modernization, Error wrapping, Testability, Blast radius] · weights [1,2,2,2,2,2,1] · denominator = 60 · denominator-policy [uniform-N/A-only] · baseline-algo [lowest-effort gate-passer with no score of 1 on any quality axis]

freeze: axes=Style,Theme,Methodology,Modernization,Error wrapping,Testability,Blast radius weights=1,2,2,2,2,2,1 denom=60 baseline=lowest-effort-gate-passer

| Axis | W | V2 planner-pin | V3 durable-replay |
|---|---:|---:|---:|
| Style | 1 | 4 | 4 |
| Theme/paradigm | 2 | 3 | 5 |
| Methodology | 2 | 3 | 5 |
| Modernization | 2 | 4 | 5 |
| Error wrapping | 2 | 4 | 4 |
| Testability | 2 | 4 | 5 |
| Blast radius | 1 | 3 | 4 |
| Effort | - | medium | medium |
| Weighted total | - | 43/60 = 0.717 | 56/60 = 0.933 |

Arithmetic was independently evaluated as
`V2=(4×1+3×2+3×2+4×2+4×2+4×2+3×1)/60=0.717` and
`V3=(4×1+5×2+5×2+5×2+4×2+5×2+4×1)/60=0.933`.

## Winner contract

V3 wins. Add only bounded normalized replay metadata to Goal operational
memory. Resolve `sourceAccessPending` before calling `buildPrerequisitePlan`.
With unchanged or absent evidence, wait without dispatch. With a different
entity or material movement and a safe combat environment, rebuild and dispatch
the same installed `harvest_entity_drop` capability. Keep the latch during the
in-flight action; replace it on another access receipt, or clear it when that
same capability settles with any other structured outcome. Do not alter
Pathfinder, combat, the causal planner API, learned method preferences, Agenda,
or physical skills.

Verification: strengthen the focused Goal test with a large negative Spider
preference and a positive Tripwire preference, prove no alternate dispatch
while latched, prove the same entity-harvest command after movement, prove
restart normalization preserves the replay descriptor, then rerun live Paper.

[codeplan · session22-source-access-latch-order · OUT · mode: full · pick: V3 · confidence: high · beatBaseline: yes · scores: V2 0.717, V3 0.933 · reason: Goal-owned durable replay resolves the latch before planner selection without contaminating the causal planner API · mechanism-check: passed · corrected: none]
