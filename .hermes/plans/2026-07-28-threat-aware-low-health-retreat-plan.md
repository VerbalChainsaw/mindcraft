# Codeplan: Threat-aware low-health retreat

## Contract and safety
- Required behavior: a badly hurt bot must break off early enough to survive and retreat away from a real nearby threat rather than choose an arbitrary direction at near-death health.
- Acceptance criteria: recent damage at half health or after a severe hit triggers once per bounded cooldown; the nearest authoritative hostile anchors retreat; failed target retreat gets one non-random safe fallback; interruption remains terminal; results remain structured.
- Must preserve: self-preservation priority, operator-hold emergency exception, fire/water/falling-block handling, role combat policy, safe pathfinding, ActionManager cleanup, and concurrent UI/profile/squad work.
- Out of scope: armor/loadout provisioning, combat-strength scoring, new listeners, difficulty changes, tests, live combat, and restart.
- Workspace/user work: extensive dirty concurrent work is present; edit only the low-health branch/constants in `src/agent/modes.js` and this lane's Hermes records.
- Pre-change checks: shared safe movement, installed jump/parkour support, mode priority/suppression, low-health branch, retreat helpers, and persisted death histories inspected.

## Repository evidence
- Shared movement already enables parkour/sprinting and ordinary one-block traversal while disabling unsafe route digging and towers; the “cannot jump” policy hypothesis is disproven.
- Current self-preservation waits for health below 5 or a nearly lethal hit, then calls `moveAway(20)`, whose origin-inversion goal has no relationship to the attacker.
- Persisted histories repeatedly show `I'm dying!` immediately before hostile-caused death.
- Existing `moveAwayFromEntity()` provides verified threat-relative retreat and `moveAway()` remains a safe fallback for damage without a surviving source.

## Mode
- Candidate mode: constrained
- Candidate count: 2
- Record profile: compact

## Candidates
- V1 `existing-mode,nearest-hostile,bounded-fallback,result-return`: trigger earlier, retreat from the nearest canonical hostile, then use one safe fallback.
- V2 `damage-listener,source-state,exact-attacker,result-return`: add source-attributed hurt tracking and retreat from the recorded damage source.

## Divergence
- V1-V2: V1 uses current authoritative world state and has no listener lifecycle; V2 is more causally exact but adds state/cleanup and still needs fallback when Minecraft supplies no source.

## Paper gates
- V1: pass - fulfills survival movement using existing bounded contracts with minimal lifecycle risk.
- V2: pass - stronger attribution but unnecessarily broad for the confirmed late/directionless retreat defect.

## IN
[codeplan · threat-aware-low-health-retreat · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=existing-mode,nearest-hostile,bounded-fallback,result-return;V2=damage-listener,source-state,exact-attacker,result-return · lean: V1 · conservative: V1]

## Frozen rubric and scoring
- freeze: axes=survival-value,architecture-fit,movement-truth,lifecycle-risk,delivery-cost classes=quality,quality,quality,risk,convenience weights=3,3,3,3,1 denominator=65 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer
- V1: 5,5,4,5,5 = 62/65 = 0.95
- V2: 5,3,5,3,2 = 50/65 = 0.77
- Arithmetic verification: V1 = 15+15+12+15+5; V2 = 15+9+15+9+2; common denominator 65.
- Formal baseline: V1.
- Selection stability: V1 leads by 0.18 with less lifecycle surface.

## PLAN-OUT
[codeplan · threat-aware-low-health-retreat · PLAN-OUT · mode: constrained · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1=0.95;V2=0.77 · reason: current hostile state plus existing verified retreat fixes the observed death loop without adding damage-source listener ownership · planned-fingerprint: existing-mode,nearest-hostile,bounded-fallback,result-return]

## Implementation plan
1. Add explicit recent-damage, half-health, retreat-distance, and cooldown bounds.
2. Trigger on half health or a severe recent hit.
3. Select the nearest canonical hostile and use verified entity-relative retreat.
4. If it fails without interruption, attempt one safe origin fallback.
5. Re-read the full mode/action lifecycle and defer execution.

## Implementation and evidence
- Added a four-second recent-damage window, half-health threshold, severe-hit threshold, 24-block threat-relative retreat, 12-block fallback, and four-second retreat cooldown inside the existing self-preservation mode.
- The existing health event owns `lastDamageTime` and `lastDamageTaken`; no new listener or lifecycle state was introduced.
- The nearest canonical hostile within the retreat bound anchors `moveAwayFromEntity()`. A failed entity-relative retreat falls back once to safe `moveAway()` only when the action was not interrupted.
- Fire, water, falling-block, operator-hold, mode priority, role combat policy, ActionManager, and safe pathfinding contracts are unchanged.
- Re-read the complete low-health branch, damage-state owner, nearest-entity helper, both retreat helpers, and mode action wrapper. Focused `git diff --check -- src/agent/modes.js` passed.
- Final `src/agent/modes.js` SHA-256: `F4156D9AA753056EB5A5F0CEC9C6AC949558FD2F98BB9A0F8362F4288371DFA0`.
- No test, combat action, build, bot command, or restart was run; the active runtime remains untouched.

## EXEC-OUT
[codeplan · threat-aware-low-health-retreat · EXEC-OUT · implemented: V1 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: earlier bounded damage gate, nearest-hostile entity-relative retreat, interruption-terminal fallback, and cooldown · evidence: complete-source-reread,damage-owner-trace,focused-diff-check; live activation deferred]
