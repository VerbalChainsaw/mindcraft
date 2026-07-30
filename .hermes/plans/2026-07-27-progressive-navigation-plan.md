# Codeplan: Progressive verified navigation

## Contract and safety
- Required behavior: valid longer routes must be allowed to compute progressively and walk; navigation succeeds only when the goal predicate is actually satisfied.
- Acceptance criteria: no duplicate one-second full pre-probe; partial A* is not called unreachable; no-path/timeout/stopped/changed errors remain distinct; door listener cleans up; a resolved-but-unreached goal is failure; callers can preserve structured evidence.
- Must preserve: non-destructive movements, operator/action interrupts, arrival distance checks, door handling, ActionManager timeout, and Mineflayer pathfinder.
- Out of scope: movement physics rewrite, parkour heuristics, destructive digging/towering, teleport verification, and live activation.
- Workspace/user work: concurrent work present; only shared skills navigation and Hermes records are in scope.

## Repository evidence
- Mindcraft calls `getPathTo(..., 1000)` and rejects every status except `success`.
- Installed pathfinder emits `partial` from bounded A* slices and `goto()` continues the same A* context while moving.
- Installed `goto()` rejects `NoPath`, `Timeout`, `GoalChanged`, and `PathStopped`, but can resolve when an update has an empty path; Mindcraft must still verify `goal.isEnd`.
- Many gameplay skills already perform target-specific distance verification after `goToGoal`.
- Villager navigation ignores the helper's boolean and logs success unconditionally.

## Mode
- Candidate mode: constrained
- Candidate count: 2
- Record profile: compact

## Candidates
- V1 `native-goto,progressive-astar,goal-postcondition,error-result`: remove the duplicate probe, use native progressive goto, verify the goal predicate, and normalize errors.
- V2 `generator-preflight,progressive-probe,double-compute,error-result`: own `getPathFromTo` generator slices before invoking goto.

## Divergence
- V1-V2: V1 uses the pathfinder's intended progressive execution and one A* lifecycle; V2 duplicates path computation/state and delays movement until a separate preflight finishes.

## Paper gates
- V1: pass - installed API explicitly supports the required mechanism and current callers retain target postconditions.
- V2: pass - technically possible, but adds compute/complexity and a second cancellation boundary without stronger proof.

## IN
[codeplan · progressive-navigation · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=native-goto/progressive-astar/goal-postcondition/error-result;V2=generator-preflight/progressive-probe/double-compute/error-result · lean: V1 · conservative: V1]

## Frozen rubric and scoring
- freeze: axes=api-fit,movement-truth,performance,cleanup-safety,delivery-risk classes=quality,quality,quality,risk,risk weights=3,3,3,2,1 denominator=60 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer
- V1: 5,5,5,4,4 = 55/60 = 0.92
- V2: 3,4,2,3,2 = 34/60 = 0.57
- Formal baseline: V1.
- Selection stability: V1 leads by 0.35 using the installed API's intended control flow.

## PLAN-OUT
[codeplan · progressive-navigation · PLAN-OUT · mode: constrained · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1=0.92;V2=0.57 · reason: native goto already owns partial A-star continuation, movement, cancellation, and listener cleanup; a separate probe duplicates work and creates the false-negative bug · planned-fingerprint: native-goto,progressive-astar,goal-postcondition,structured-error,zero-dep]

## Implementation plan
1. Normalize installed pathfinder errors to structured movement outcomes.
2. Remove the one-second pre-probe and duplicate A* work.
3. Run native goto with safe movements and door cleanup.
4. Verify `goal.isEnd` after resolution and preserve interrupted state.
5. Make villager movement consume the boolean and final distance.
6. Inspect exact source; do not restart or broadly test.

## Implementation and evidence
- Implemented V1 without a mechanism shift.
- Removed the duplicate one-second probe and let installed pathfinder continue partial A* work through native `goto`.
- Added explicit postcondition verification with the goal's own `isEnd` predicate.
- Normalized installed `NoPath`, `Timeout`, `GoalChanged`, and `PathStopped` errors plus operator interruption into structured movement outcomes.
- Door cleanup remains in `finally`; safe movement configuration is still applied before goto.
- Villager navigation now handles false movement/final distance and cannot log a false arrival.
- Evidence gates: installed pathfinder implementation/types and exact final source inspected. Syntax/build/lint/live movement remain intentionally not run; active concurrent runtime preserved.

## EXEC-OUT
[codeplan · progressive-navigation · EXEC-OUT · implemented: V1 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: native progressive A-star, goal postcondition, structured path errors, duplicate-compute removal, and truthful villager arrival · evidence: installed dependency and final source inspected; live activation and tests deferred by user and concurrency constraints]
