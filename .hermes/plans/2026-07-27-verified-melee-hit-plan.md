# Codeplan: Verified one-hit melee

## Contract and safety
- Required behavior: a one-hit combat action succeeds only when Minecraft attributes damage to this bot; failed reach, sight, interruption, attack send, and confirmation must remain explicit.
- Acceptance criteria: use a realistic melee reach; preflight line of sight; subscribe before the attack packet; accept only a target-matching, bot-attributed damage event; bound the wait; clean every listener/timer; preserve exact structured evidence.
- Must preserve: kill-mode PvP ownership, Defender/reflex callers, operator Stop, safe navigation, existing action-result shape, and concurrent UI/profile/squad/telemetry work.
- Out of scope: PvP plugin redesign, combat tactics, dependency changes, tests, live bot actions, and restart.
- Workspace/user work: extensive concurrent work is present; edit only `src/agent/library/skills.js` plus this lane's Hermes records.
- Pre-change checks: source, every `attackEntity` caller, installed Mineflayer attack implementation, `damage_event` source attribution, and current target-file hash inspected; execution intentionally deferred.

## Repository evidence
- `attackEntity(..., false)` currently allows five-block attacks, awaits a synchronous packet sender, and immediately records `hit`.
- `defendSelf` counts that boolean as a verified swing, so packet sends can exhaust the bounded defense loop without damage.
- Installed Mineflayer `attack()` writes `use_entity` and arm animation only.
- On the installed 1.20+ protocol, Mineflayer emits `entityHurt(entity, source)` from `damage_event`, including the responsible entity when present.

## Mode
- Candidate mode: constrained
- Candidate count: 2
- Record profile: compact

## Candidates
- V1 `event-oracle,source-attribution,real-reach,listener-cleanup`: verify the existing one-hit boundary through a target/source-filtered `entityHurt` oracle with a bounded timeout.
- V2 `pvp-plugin-all-attacks,plugin-state,event-death`: route even one-hit defense through mineflayer-pvp and stop it after a combat event.

## Divergence
- V1-V2: V1 retains one-hit command ownership and proves its exact postcondition; V2 expands plugin chase/attack state into reflex callers and still needs an attribution oracle to distinguish this bot's hit.

## Paper gates
- V1: pass - uses the installed authoritative event, preserves the API, has bounded lifecycle cleanup, and is isolated to the false-success boundary.
- V2: pass - can execute combat, but expands ownership and interruption surface without removing the need for damage attribution.

## IN
[codeplan · verified-melee-hit · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=event-oracle/source-attribution/real-reach/listener-cleanup;V2=pvp-plugin-all-attacks/plugin-state/event-death · lean: V1 · conservative: V1]

## Frozen rubric and scoring
- freeze: axes=architecture-fit,gameplay-truth,interrupt-lifecycle-safety,combat-reliability,delivery-risk classes=quality,quality,risk,quality,risk weights=3,3,3,2,1 denominator=60 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer
- V1: 5,5,5,5,4 = 59/60 = 0.98
- V2: 3,4,3,4,2 = 40/60 = 0.67
- Arithmetic verification: V1 = 15+15+15+10+4; V2 = 9+12+9+8+2; shared denominator = 60.
- Formal baseline: V1.
- Selection stability: V1 has the stronger known score and is also the lowest-effort eligible mechanism.

## PLAN-OUT
[codeplan · verified-melee-hit · PLAN-OUT · mode: constrained · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1=0.98;V2=0.67 · reason: a local attributed-damage oracle fixes the false result with the smallest ownership and lifecycle surface · planned-fingerprint: event-oracle,source-attribution,real-reach,listener-cleanup]

## Implementation plan
1. Add bounded melee reach and damage-confirmation constants.
2. Add one internal helper that subscribes before attack, filters target and source, bounds confirmation, and cleans up exactly once.
3. Harden non-kill attack preflight for interruption, current reach, and clear path.
4. Preserve exact failure evidence; record `hit` only after attributed damage.
5. Re-read the modified range and formatting; defer execution and tests.

## Implementation and evidence
- Implemented V1 without changing kill-mode PvP or any UI/control-plane boundary.
- One-hit combat now rejects an interrupted command before equipment or attack, wraps equipment failure, moves to a 3.2-block melee envelope, verifies that the exact target is under the bot's cursor, and rechecks reach before sending.
- Damage confirmation subscribes before the packet, accepts only `entityHurt` for the selected target with this bot as source, distinguishes unattributed damage/death and unconfirmed damage, and polls interruption within a bounded 900 ms window.
- Timeout, interrupt, synchronous packet failure, confirmed damage, and target death all converge on one idempotent cleanup path for both listeners and both timers.
- Evidence gates: pre/post target hash captured; final constants, helper, attack boundary, callers, and focused diff formatting inspected. No combat execution, bot action, test, build, or restart run per user direction.

## EXEC-OUT
[codeplan · verified-melee-hit · EXEC-OUT · implemented: V1 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: realistic reach, exact visibility, attributed damage oracle, interruption polling, and idempotent cleanup · evidence: current callers and installed Mineflayer packet/event source plus final modified ranges inspected; runtime activation deferred]
