# Codeplan: Powerful survival intelligence

## Contract and safety
- Required behavior: bots maintain their bodies and respond intelligently to hunger, injury, equipment, night, weather, beds, and shelter within legitimate survival rules.
- Acceptance criteria: upkeep is action-owned, bounded, interruptible, evidence-backed, and subordinate to Stop, urgent reflexes, and explicit player actions.
- Must preserve: `ModeController`, `ActionManager`, structured results, role combat policy, protected blocks, safe movement, profile loadout policy, and dirty concurrent work.
- Out of scope: difficulty changes, unconditional provisioning, arbitrary construction, and replacing urgent modes.
- Workspace/user work: extensive uncommitted work is present; implementation must use narrow files and preserve it.
- Pre-change checks: urgent modes, auto-eat setup, consume verification, sleep skill, full state, agent loop, and runtime behavior normalization inspected.

## Repository evidence
- Urgent reflexes already run first and may interrupt actions.
- Plugin auto-eat currently selects and consumes food outside `ActionManager`.
- Health, hunger, food inventory, equipment, weather, time, beds, and hazards already have source representations.
- `RoleDirector` proves the local pattern for bounded idle scheduling and structured telemetry.

## Mode
- Candidate mode: full
- Candidate count: 3
- Record profile: compact

## Candidates
- V1 `new-director,instance-state,action-owned,internal-reuse`: add `SurvivalDirector` for upkeep while retaining urgent modes.
- V2 `expanded-modes,inline-state,action-owned,internal-reuse`: add hunger, equipment, sleep, and shelter branches directly to `modes.js`.
- V3 `unified-arbiter,instance-state,priority-scheduler,internal-reuse`: replace modes and autonomous scheduling with one global behavior arbiter.

## Divergence
- V1↔V2: V1 separates long-running upkeep from sub-100 ms reflex selection; V2 concentrates behavior but overloads the reflex boundary.
- V1↔V3: V1 extends current ownership; V3 replaces it and increases migration surface.
- V2↔V3: V2 preserves distributed scheduling; V3 centralizes every behavior class.

## Paper gates
- V1: pass - uses existing action, state, and telemetry contracts without changing urgent reflex ownership.
- V2: pass - can satisfy the contract, but long-running decisions increase reflex complexity and interruption risk.
- V3: pass - can satisfy the end state, but requires broad concurrent migration and stronger runtime evidence.

## IN
[codeplan · survival-intelligence · IN · mode: full · profile: compact · confidence: high · candidates: V1=survival-director,existing-reflexes,action-owned;V2=expanded-modes,inline-state;V3=unified-behavior-arbiter,global-priority · lean: V1 · conservative: V2]

## Frozen rubric and scoring
- freeze: axes=survival-reliability,architecture-fit,action-ownership,naturalness,delivery-cost classes=quality,quality,risk,quality,convenience weights=3,3,3,2,1 denominator=60 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer
- V1: 5,5,5,4,3 = 56/60 = 0.93.
- V2: 4,3,3,4,4 = 42/60 = 0.70.
- V3: 5,4,5,5,1 = 53/60 = 0.88.
- Arithmetic verification: executable calculation confirmed common denominator and totals.
- Formal baseline: V2.
- Selection stability: V1 leads V3 by 0.05 and wins the frozen tie-break through smaller regression surface and stronger current-boundary evidence.

## PLAN-OUT
[codeplan · survival-intelligence · PLAN-OUT · mode: full · profile: compact · pick: V1 · baseline: V2 · confidence: high · beatBaseline: yes · scores: V1=0.93;V2=0.70;V3=0.88 · reason: dedicated upkeep ownership adds powerful survival planning without destabilizing urgent reflexes or replacing RoleDirector · planned-fingerprint: survival-director,existing-reflexes,action-owned]

## Implementation plan
- Files/boundaries: survival runtime module, agent initialization/update, consumption ownership, behavior normalization, full-state projection, focused tests.
- Ordered changes: pure intent policy; director state/ownership; verified eating; recovery/equipment; night/bed/shelter work orders; telemetry; tests; controlled runtime gates.
- Contract checks: Stop, manual actions, urgent modes, role combat, hand restoration, no-cheat default, structured results.
- Rollback: director can remain disabled by normalized policy while existing urgent modes continue.

## Implementation and evidence
- Implemented `SurvivalDirector` after urgent modes and before self-prompt/job scheduling.
- Moved eating behind verified action ownership with food selection, reserve policy, postconditions, and held-tool restoration.
- Added bounded injury recovery, armor upgrades, safe bed use, existing-shelter seeking, and fixed-blueprint emergency shelter work orders.
- Explicit-runtime profiles now default to full survival and emergency shelter capability; legacy profiles retain conservative compatibility behavior.
- Emergency shelter work preempts only automatic role work, never an explicit player work order.
- Added an action-owned `prepareFood` loop that prefers carried/craftable food, harvests only mature crops, replants verified farmland, sustainably hunts adult food animals, bootstraps a portable crafting table/furnace/fuel, cooks raw food, and verifies the resulting safe reserve.
- Full-survival hunger and injury states now acquire food instead of waiting indefinitely; ordinary “get food,” “cook food,” and “eat something” player language routes directly to the verified skills.
- Added safe idle pickup of nearby food, equipment, resources, and work materials without outranking urgent danger, sleep, or shelter.
- `npm run check:behavior`, source syntax checks, and `git diff --check` passed after the gameplay expansion on 2026-07-28. Live-bot activation remains intentionally pending.

## EXEC-OUT
[codeplan · survival-intelligence · EXEC-OUT · implemented: V1+food-acquisition-slice · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: food-wait-deadlock-replaced-by-action-owned-sourcing · evidence: food-crafting,mature-harvest,replant,adult-hunt,furnace-bootstrap,cooking,verified-reserve,66-behavior-tests,syntax,diff-check;live-runtime-not-activated]
