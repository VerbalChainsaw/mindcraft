# Codeplan: Verified explicit door traversal

## Contract and safety
- Required behavior: `useDoor` must select or validate one wooden door, approach it safely, traverse it interruptibly, verify crossing, close it when possible, and never claim success from activation alone.
- Acceptance criteria: no null dereference when a door species is absent; invalid/unloaded/iron/non-door targets fail precisely; shared safe movement owns approach; activation state is verified; forward control is bounded and always released; door-plane crossing is the success oracle; cleanup failure remains visible.
- Must preserve: current `useDoor(bot, Vec3|null)` API, NPC callers, safe pathfinder policy, operator interruption, normal door interaction, and concurrent UI/profile/squad/telemetry work.
- Out of scope: fence gates/trapdoors, general pathfinder redesign, building geometry, tests, live traversal, and restart.
- Workspace/user work: extensive concurrent work is present; edit only `src/agent/library/skills.js`, the two `useDoor` result consumers in `src/agent/npc/controller.js`, and this lane's Hermes records.
- Pre-change checks: the entire door/NPC caller boundary, world block selectors, shared movement contract, installed activation/property APIs, native pathfinder door handling, and target-file hash inspected.

## Repository evidence
- The current species loop dereferences `world.getNearestBlock(...).position` before checking for null, so absence of the first oak door aborts all fallback species.
- Raw `setGoal` plus an unbounded `isMoving()` loop ignores route failure and interruption.
- The function dereferences an unloaded/non-door block, uses internal properties without validation, drives forward without `finally`, toggles once more, and always returns true.
- `goToPosition` already supplies safe progressive navigation and exact failure evidence; Prismarine Block exposes `getProperties()`; Mineflayer activation resolves delivery but not world state.

## Mode
- Candidate mode: constrained
- Candidate count: 2
- Record profile: compact

## Candidates
- V1 `existing-helper,local-state,bounded-controls,verified-postcondition`: use safe approach, explicit open-state verification, bounded straight traversal, facing-axis crossing proof, and best-effort close.
- V2 `pathfinder-only,derived-goal,native-door-use,verified-postcondition`: derive a point beyond the door and delegate all opening/traversal to pathfinder before checking arrival.

## Divergence
- V1-V2: V1 proves traversal through the selected door and retains precise activation failures; V2 may legitimately route around the door and therefore cannot prove the explicit target was used.

## Paper gates
- V1: pass - preserves the API, isolates manual controls in a bounded `finally`, uses authoritative block/position state, and retains shared safe approach.
- V2: pass - smaller control surface, but weak task fulfillment because pathfinder can satisfy a coordinate goal without using the selected door.

## IN
[codeplan · verified-door-traversal · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=existing-helper/local-state/bounded-controls/verified-postcondition;V2=pathfinder-only/derived-goal/native-door-use/verified-postcondition · lean: V1 · conservative: V1]

## Frozen rubric and scoring
- freeze: axes=architecture-fit,traversal-truth,interrupt-lifecycle-safety,door-reliability,delivery-risk classes=quality,quality,risk,quality,risk weights=3,3,3,2,1 denominator=60 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer
- V1: 4,5,5,5,4 = 56/60 = 0.93
- V2: 5,2,5,3,5 = 45/60 = 0.75
- Arithmetic verification: V1 = 12+15+15+10+4; V2 = 15+6+15+6+5; shared denominator = 60.
- Formal baseline: V1.
- Selection stability: V1 is the lowest-effort mechanism that preserves explicit-door semantics and leads by 0.18.

## PLAN-OUT
[codeplan · verified-door-traversal · PLAN-OUT · mode: constrained · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1=0.93;V2=0.75 · reason: bounded explicit traversal is the only candidate that proves the selected door was actually used · planned-fingerprint: existing-helper,local-state,bounded-controls,verified-postcondition]

## Implementation plan
1. Select the nearest supported wooden door without species-order dereferences, or validate the supplied coordinates.
2. Approach through `goToPosition`; refresh and validate the block and reach.
3. Open only when closed and verify the resulting state.
4. Drive forward with an interruptible bounded loop and unconditional control release; verify crossing on the door-facing axis.
5. Close when possible and emit exact evidence.
6. Propagate the boolean through both NPC action callbacks, re-read every changed range, and defer execution.

## Implementation and evidence
- Implemented the selected mechanism in `src/agent/library/skills.js`: validated nearest/supplied wooden-door selection, shared safe approach, refreshed reach/state checks, verified open state, bounded interruptible forward control with unconditional release, door-facing-axis crossing proof, best-effort verified close, and precise structured outcomes.
- Corrected both consumers in `src/agent/npc/controller.js`: `npc:exitBuilding` stops before `moveAway` when traversal fails and returns the downstream movement result after a successful crossing; `npc:returnHome` returns the traversal result.
- Re-read the complete final helper and both caller ranges, enumerated every `useDoor` call site, captured final source hashes, and ran focused diff-format validation only. Per operator direction, no test, build, bot action, live traversal, or restart was run.

## EXEC-OUT
[codeplan · verified-door-traversal · EXEC-OUT · status: implemented-not-activated · actual-fingerprint: existing-helper,local-state,bounded-controls,verified-postcondition · deviations: consumer-return-propagation-added-after-full-caller-trace · evidence: full-source-reread,all-callers-enumerated,focused-diff-check · activation: deferred]
