[codeplan · session22-night-source-pending · IN · mode: full · confidence: high · candidates: V1 director inference (inline-guard), V2 explicit receipt latch (return-code), V3 persisted source fingerprint (external-store) · lean: V2 · baseline: V1]

# Session 22 night-source pending decision

## Scope

Player-visible outcome: the fishing-breakfast request must not fail in seconds
when the current night has no usable local Spider and native relocation cannot
plan a safe search route. The bot must perform one bounded settlement/search,
preserve the productive-attempt budget, and wait for new live source evidence.

Out of scope: Pathfinder geometry, combat mechanics, tree access, fishing,
furnace interaction, registry cleanup, dependencies, and a new Goal schema.

## Calibration

Repository rules: evidence must remain structured and bounded across selection,
feasibility, planning, execution, reconciliation, and verified outcome.
Project code owns judgment, budgets, receipts, and recovery; Mineflayer plugins
retain physical mechanics. No identical retry may occur without material world
evidence, interruptions are censored, accepted locality/combat/Pathfinder seams
remain frozen, and existing dirty work must be preserved.

Representative source: skills return booleans while publishing snake_case
structured outcomes; GoalDirector normalizes action results, persists every
lifecycle transition, and excludes recovery/preemption/prerequisite work from
productive attempts. Durable subgoals already survive restart. Tests use
`node:test`, strict assertions, fake agents/stores, and direct `handleResult`
or `update` calls. Skills use four-space indentation; runtime/tests use two.

Spot-check: `harvestEntityDrop` currently records `searchAdvanced`,
`relocationDistance`, `spawnWaits`, and `spawnWaitMs`; `GoalDirector` already
persists the finished action code in the normalized subgoal before deciding
whether to charge an attempt.

## Variants and divergence

- V1 **director inference** (`inline-guard`, `existing-subgoal`,
  `degrade-graceful`): infer temporal pending in GoalDirector from the existing
  generic `source_not_found` evidence and latch on the finished subgoal.
- V2 **explicit receipt latch** (`extracted-helper`, `existing-subgoal`,
  `return-code`): the harvest adapter performs one initial bounded spawn
  settlement, emits `source_spawn_pending` when the regional probe cannot
  advance, and GoalDirector uses that explicit durable code until a qualified
  loaded source appears.
- V3 **persisted source fingerprint** (`class-method`, `external-store`,
  `return-code`): add a normalized Goal-memory blocker containing source,
  position, dimension, and world-time fingerprint; clear it only when the
  fingerprint materially changes.

Divergence: V1 versus V2 differs at module boundary and error propagation; V2
versus V3 differs in state location and schema surface; V1 versus V3 differs in
module boundary, state location, and error propagation.

## Hard gates

- V1 G: pass — uses structured evidence, preserves APIs and persistence.
- V2 G: pass — explicit bounded receipt, no dependency/schema/API break, and
  reuses the existing persisted subgoal.
- V3 G: pass — viable with normalization and compatibility handling, but adds
  a persisted-state surface not required by the observed boundary.

## Frozen rubric

Rubric frozen: axes [Style, Theme, Methodology, Modernization, Error wrapping,
Testability, Blast radius] · weights [1,2,2,2,2,2,1] · denominator =
Σ(weights) × 5 · denominator-policy [uniform-N/A-only] · baseline-algo
[lowest-effort gate-passer with no score of 1 on any quality axis]

freeze: axes=Style,Theme,Methodology,Modernization,Error wrapping,Testability,Blast radius weights=1,2,2,2,2,2,1 denom=ΣW×5 baseline=lowest-effort-gate-passer

## Scoring

| Axis | W | V1 director inference | V2 explicit receipt latch | V3 persisted fingerprint |
|---|---:|---:|---:|---:|
| Style | 1 | 4 | 5 | 4 |
| Theme/paradigm | 2 | 3 | 5 | 5 |
| Methodology | 2 | 4 | 5 | 3 |
| Modernization | 2 | 4 | 4 | 5 |
| Error wrapping | 2 | 3 | 5 | 5 |
| Testability | 2 | 4 | 5 | 4 |
| Blast radius | 1 | 5 | 4 | 2 |
| Effort | — | low | medium | high |
| Denominator | — | 60 | 60 | 60 |
| Weighted total | — | 45 | 57 | 50 |
| Normalized | — | 0.750 | 0.950 | 0.833 |

Arithmetic: V1 = `4+6+8+8+6+8+5 = 45`; V2 =
`5+10+10+8+10+10+4 = 57`; V3 = `4+10+6+10+10+8+2 = 50`;
denominator = `(1+2+2+2+2+2+1)×5 = 60`.

Baseline: V1 is the lowest-effort gate-passer and has no quality-axis score of
one. V2 wins because its explicit action receipt preserves the shared contract,
keeps method learning honest, and gains durable restart behavior from an
existing normalized field rather than a new schema.

## Winner implementation contract

1. Reuse one helper for the existing ten-second spawn-settlement wait both at
   the origin and after a verified regional relocation.
2. Emit bounded `source_spawn_pending` evidence only for the established
   Spider/String night source when no entity was attempted, no output was
   collected, the search did not advance, and settlement occurred.
3. Treat that result as censored for method learning, preserve Goal attempts,
   persist the finished subgoal, and wait without dispatching again while no
   qualified Spider is loaded. Daylight continues to use the existing
   requester-return wait.
4. A qualified loaded Spider takes precedence and reopens dispatch. Add one
   focused lifecycle regression, then prove the behavior in Paper with the
   unchanged breakfast request.

## Implementation correction

The first Paper replay proved the explicit pending receipt and zero-attempt
latch, then exposed a transient-source race: a qualified Spider appeared and
reopened dispatch but disappeared before the skill's first scan. The skill had
skipped origin settlement while the Spider existed and therefore returned the
generic failure. This is an execution error inside V2, not a mechanism shift.
When no entity has been attempted and no settlement has occurred, the skill now
performs that same bounded settlement after the observed source disappears
before relocation or pending reconciliation.

[codeplan · session22-night-source-pending · OUT · mode: full · pick: V2 · confidence: high · beatBaseline: yes · scores: V1 0.750, V2 0.950, V3 0.833 · reason: explicit bounded receipt plus existing durable latch preserves attempts and contract truth without a schema · mechanism-check: passed · corrected: transient observed-source disappearance now receives the same bounded settlement before reconciliation]
