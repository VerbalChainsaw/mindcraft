# Codeplan: Door recovery fallback

## Contract and safety
- Required behavior: stuck navigation may retry a nearby ordinary door/gate without randomly changing unrelated world openables or producing unhandled promise rejection.
- Acceptance criteria: native pathfinder remains primary; fallback considers only closed non-iron doors/gates at body level; trapdoors are never fallback-activated; one activation is in flight; failures are bounded and wrapped; interval cleanup remains authoritative.
- Must preserve: safe movements, native door/trapdoor planning, Follow recovery, operator Stop, exact movement outcomes, and concurrent UI/control-plane work.
- Out of scope: dependency patching, trapdoor route redesign, tests, live movement, and restart.

## Repository evidence
- `safeMovements` enables native `canOpenDoors`.
- Installed pathfinder adds `useOne` door/gate/trapdoor moves and serializes `activateBlock`.
- Its activation rejection releases the lock but does not clear the current placement state, so a conservative fallback still has reliability value.
- Mindcraft's current fallback shuffles feet/head/ceiling/below-feet positions, may activate unrelated trapdoors, starts activation without awaiting/catching it, and has no overlap guard.

## Mode
- Candidate mode: constrained
- Candidate count: 2
- Record profile: compact

## Candidates
- V1 `narrow-fallback,deterministic-scan,single-flight,error-wrapped`: retain a body-level ordinary door/gate fallback after sustained no-progress, excluding trapdoors and wrapping one activation.
- V2 `native-only,delete-fallback,zero-extra-state`: remove Mindcraft's interval and rely exclusively on installed pathfinder.

## Divergence
- V1-V2: V1 preserves recovery from the installed executor's stalled rejection branch with a small bounded surface; V2 eliminates duplicate behavior but loses that recovery path.

## Paper gates
- V1: pass - preserves native ownership, closes unsafe activation/error gaps, and remains interval-cleaned.
- V2: pass - simplest and safest world mutation policy, but lower reliability against the inspected native rejection state.

## IN
[codeplan · door-recovery-fallback · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=narrow-fallback/deterministic-scan/single-flight/error-wrapped;V2=native-only/delete-fallback/zero-extra-state · lean: V1 · conservative: V1]

## Frozen rubric and scoring
- freeze: axes=architecture-fit,world-safety,movement-reliability,lifecycle-safety,delivery-risk classes=quality,risk,quality,risk,risk weights=3,3,3,2,1 denominator=60 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer
- V1: 4,5,5,5,4 = 55/60 = 0.92
- V2: 5,5,3,5,5 = 52/60 = 0.87
- Formal baseline: V2.
- Selection stability: V1 leads by exactly 0.05; stronger evidence confidence and preservation of the native-error recovery path win the frozen tie-break.

## PLAN-OUT
[codeplan · door-recovery-fallback · PLAN-OUT · mode: constrained · profile: compact · pick: V1 · baseline: V2 · confidence: high · beatBaseline: parity · scores: V1=0.92;V2=0.87 · reason: the bounded fallback closes unsafe interaction gaps while retaining recovery from the installed executor's inspected stalled-error branch · planned-fingerprint: narrow-fallback,deterministic-scan,single-flight,error-wrapped]

## Implementation plan
1. Replace shuffled broad positions with deterministic feet/head body-level candidates.
2. Accept only closed non-iron doors and fence gates; exclude every trapdoor.
3. Serialize fallback activation and catch/log bounded failures.
4. Keep the existing stuck threshold, reset, WeakMap ownership, and cleanup.
5. Re-read source and defer execution.

## Implementation and evidence
- Implemented V1 without changing the native pathfinder or movement-result contract.
- Candidate positions are deterministic and limited to the bot's feet/head plus four horizontal neighbors.
- Only closed non-iron `*_door` and `*fence_gate*` blocks qualify; trapdoors, ceiling, and below-feet positions are excluded.
- One fallback activation may run at a time. Synchronous throws and promise rejection flow through one bounded warning and release the guard in `finally`.
- Existing 1.2-second no-progress threshold, WeakMap interval ownership, and `clearDoorInterval` lifecycle remain intact.
- Evidence gates: final helper range and diff formatting inspected. No movement execution, test, build, or restart run.

## EXEC-OUT
[codeplan · door-recovery-fallback · EXEC-OUT · implemented: V1 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: deterministic body-level ordinary door/gate fallback with single-flight wrapped activation · evidence: current and installed pathfinder source plus final range inspected; runtime activation deferred]
