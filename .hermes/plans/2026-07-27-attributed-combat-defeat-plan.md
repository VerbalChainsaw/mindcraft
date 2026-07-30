# Codeplan: Attributed combat defeat

## Contract and safety
- Required behavior: kill-mode combat may report `killed` only when Minecraft attributes the target's final observed damage to this bot.
- Acceptance criteria: track damage source for the exact target; preserve a target death independently from attribution; reject an unattributed defeat without claiming success; keep elapsed time and hit evidence bounded; clean every combat listener.
- Must preserve: mineflayer-pvp chase/attack ownership, the 30-second engagement limit, interruption and target-loss outcomes, drop collection after a verified defeat, and concurrent UI/profile/squad/telemetry work.
- Out of scope: PvP tactics, weapon selection, one-hit combat, mode scheduling, dependency changes, tests, live combat, and restart.
- Workspace/user work: extensive concurrent work is present; edit only `src/agent/library/skills.js` plus this lane's Hermes records.
- Pre-change checks: the whole attack boundary, every caller, mode pause/resume lifecycle, installed Mineflayer damage/death event behavior, and target-file hash inspected; execution intentionally deferred.

## Repository evidence
- Kill mode sets `targetDied` from any matching `entityDead` event and then logs `Successfully killed`, regardless of damage source.
- Installed Mineflayer emits `entityHurt(entity, source)` from modern `damage_event`, exposing the responsible entity when the server supplies one.
- The current Paper runtime is modern; missing source evidence must degrade to an unattributed result, not optimistic success.
- The preceding pause-leak hypothesis was disproven: idle emission and the controller's 300 ms idle pass both restore paused modes.

## Mode
- Candidate mode: constrained
- Candidate count: 2
- Record profile: compact

## Candidates
- V1 `inline-event-state,final-source-attribution,result-return,listener-cleanup`: track the latest target damage source during the existing PvP engagement and require this bot as the source when death arrives.
- V2 `elimination-semantics,source-agnostic-success,result-return`: rename any observed death to `target_eliminated`, count it as success, and avoid claiming this bot killed it.

## Divergence
- V1-V2: V1 proves the command's “attack and kill” postcondition but can truthfully fail closed when attribution is missing; V2 proves only that the target died and may credit an action that made no contribution.

## Paper gates
- V1: pass - preserves the existing combat boundary, uses installed authoritative evidence, fails closed, and adds only engagement-local state/listener cleanup.
- V2: pass - truthfully avoids a kill claim, but weakens action completion and role-progress fidelity.

## IN
[codeplan · attributed-combat-defeat · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=inline-event-state/final-source-attribution/result-return/listener-cleanup;V2=elimination-semantics/source-agnostic-success/result-return · lean: V1 · conservative: V1]

## Frozen rubric and scoring
- freeze: axes=architecture-fit,outcome-truth,command-fulfillment,lifecycle-safety,delivery-risk classes=quality,quality,quality,risk,risk weights=3,3,3,2,1 denominator=60 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer
- V1: 5,5,5,5,4 = 59/60 = 0.98
- V2: 4,4,2,5,5 = 45/60 = 0.75
- Arithmetic verification: V1 = 15+15+15+10+4; V2 = 12+12+6+10+5; shared denominator = 60.
- Formal baseline: V1.
- Selection stability: V1 has the stronger known score and the smallest contract-preserving repair surface.

## PLAN-OUT
[codeplan · attributed-combat-defeat · PLAN-OUT · mode: constrained · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1=0.98;V2=0.75 · reason: final-source attribution preserves the existing kill contract without crediting unrelated deaths · planned-fingerprint: inline-event-state,final-source-attribution,result-return,listener-cleanup]

## Implementation plan
1. Observe target-specific damage events for the existing PvP engagement.
2. Track the latest authoritative source and this bot's attributed hit count.
3. On target death, separate observed death from bot-attributed defeat.
4. Return a precise non-retryable unattributed-death result rather than `killed`.
5. Clean the added listener in the existing `finally`; re-read source and defer execution.

## Implementation and evidence
- Implemented V1 without changing mineflayer-pvp, callers, or any UI/control-plane boundary.
- Kill mode now observes `entityHurt` only for the selected target, records the latest server-supplied source, counts this bot's attributed hits, and snapshots final-source attribution when the target dies.
- A target death whose final observed source is not this bot now returns `target_died_unattributed`, includes bounded hit/elapsed evidence, skips drop collection, and does not claim success.
- A verified defeat retains `killed`, adds attributed-hit and elapsed evidence, then performs the existing best-effort drop collection.
- The added hurt listener is removed beside the existing death listener and PvP cleanup on success, failure, timeout, target loss, interruption, or exception.
- Evidence gates: pre/post target hash captured; final kill branch, callers, installed event source, and focused diff formatting inspected. No combat execution, bot action, test, build, or restart run per user direction.

## EXEC-OUT
[codeplan · attributed-combat-defeat · EXEC-OUT · implemented: V1 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: target-specific final-source attribution, unattributed-death result, bounded hit evidence, and listener cleanup · evidence: current callers and installed Mineflayer damage source plus final modified branch inspected; runtime activation deferred]
