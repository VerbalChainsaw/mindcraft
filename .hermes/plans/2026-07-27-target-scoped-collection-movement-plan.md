# Codeplan: Target-scoped collection movement

## Contract and safety
- Required behavior: a bot may break the explicitly selected safe resource block while pathfinding remains unable to excavate unrelated world blocks.
- Acceptance criteria: wood/stone selectors can return safe targets; collectblock can break that exact target; route digging remains denied for every other coordinate; flow/falling-block guards survive the plugin's internal movement mutations; policy is restored after every outcome.
- Must preserve: exact-block and inventory postconditions, tool/capacity preflight, interruption, non-destructive navigation, role recovery, and concurrent dashboard/profile/squad work.
- Out of scope: replacing collectblock, generic mining plans, vein mining, tests, live bot actions, and process restart.

## CENTER audit result
- Live telemetry repeatedly reports no safely collectible trees while perception sees nearby canonical logs.
- `safeMovements()` sets `canDig = false`.
- Both `collectBlock()` and `findNearestCollectibleBlock()` call `safeToBreak()` on that object.
- Installed pathfinder returns `false` immediately from `safeToBreak()` when `canDig` is false.
- Installed collectblock calls the active movement object's `safeToBreak(target)` and forcibly disables its flow/falling-block flags before collection.
- Result: all non-liquid targets are deterministically rejected, and merely setting `canDig = true` on the shared route policy would re-enable unrelated excavation and weaken guards.

## Mode
- Candidate mode: constrained
- Candidate count: 2
- Record profile: compact

## Candidates
- V1 `target-scoped-movement,independent-safety-guard,plugin-compatible,zero-dep`: use a dig-enabled selector only for target validation, then hand collectblock a movement adapter whose `safeToBreak` accepts only that exact validated coordinate through a separate unmutated safety object.
- V2 `native-dig-pickup-state-machine,no-collectblock`: remove collectblock from the resource path and own approach, dig, drop observation, pickup, and cancellation directly.

## Divergence
- V1-V2: V1 repairs the contradictory adapter boundary and retains installed pickup/cancellation behavior; V2 offers full control but expands the action state machine and drop races beyond the proven defect.

## Paper gates
- V1: pass - closes the exact producer/consumer mismatch, denies route excavation by coordinate, and isolates plugin mutations.
- V2: pass - viable later, but unnecessary delivery and lifecycle risk for this bounded repair.

## IN
[codeplan · target-scoped-collection-movement · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=target-scoped-movement/independent-safety-guard/plugin-compatible/zero-dep;V2=native-dig-pickup-state-machine/no-collectblock · lean: V1 · conservative: V1]

## Frozen rubric and scoring
- freeze: axes=architecture-fit,gameplay-truth,world-safety,interrupt-safety,delivery-risk classes=quality,quality,risk,risk,risk weights=3,3,3,2,1 denominator=60 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer
- V1: 5,5,5,4,4 = 57/60 = 0.95
- V2: 3,5,4,4,2 = 45/60 = 0.75
- Formal baseline: V1.
- Selection stability: V1 leads by 0.20 and preserves the current action/plugin lifecycle.

## PLAN-OUT
[codeplan · target-scoped-collection-movement · PLAN-OUT · mode: constrained · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1=0.95;V2=0.75 · reason: a target-scoped adapter resolves the exact movement contradiction without a second collection state machine · planned-fingerprint: target-scoped-movement,independent-safety-guard,plugin-compatible,policy-restore,zero-dep]

## Implementation plan
1. Add a collection-selection movement policy that enables safety evaluation without changing ordinary route policy.
2. Add a target-scoped plugin policy whose break predicate accepts only the selected block coordinate/type and delegates safety to a separate unmutated guard.
3. Use collection safety for resource selection and the target-scoped policy only during the plugin call.
4. Restore ordinary non-digging movements and a non-digging plugin default in `finally`.
5. Re-read all changed lines and defer execution per the operator's instruction.

## Implementation and evidence
- Implemented V1 without changing the collection action owner or plugin lifecycle.
- `collectionSafetyMovements` enables `safeToBreak` only for resource evaluation; ordinary `safeMovements` remains `canDig = false`.
- `targetScopedCollectionMovements` matches target type and exact x/y/z before consulting a separate safety guard. The plugin may mutate its own movement flags, but cannot mutate that guard or approve any other coordinate.
- Generic collection and wood selection now use the correct evaluation policy.
- The plugin call restores a fresh ordinary route policy for both pathfinder and collectblock in `finally`, including error and interruption paths.
- Evidence gates: current source, installed pathfinder early-return contract, installed collectblock mutation/call order, and final changed ranges inspected. Diff whitespace check clean; no test, bot action, build, or restart run.

## EXEC-OUT
[codeplan · target-scoped-collection-movement · EXEC-OUT · implemented: V1 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: resource selection and exact-target collection now coexist with non-destructive route policy · evidence: current and installed dependency source inspected; runtime activation and tests deferred]
