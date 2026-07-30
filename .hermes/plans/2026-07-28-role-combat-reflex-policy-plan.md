# Codeplan: Role-aware combat reflex policy

## Contract and safety
- Required behavior: runtime-configured companions must react to threats according to their job instead of forcing every role into autonomous melee.
- Acceptance criteria: Builder, Miner, Lumberjack, Scout, and Custom default to bounded avoidance; Defender, Attacker, and Companion retain defense; operators can explicitly choose role/defend/avoid/off; dangerous Endermen are never autonomous melee targets; legacy profiles retain their configured modes.
- Must preserve: explicit combat commands, later `!setMode` overrides, operator Stop, self-preservation priority, ActionManager ownership, and concurrent dashboard/profile/squad work.
- Out of scope: combat AI rewrite, equipment/loadout provisioning, server difficulty, UI controls, tests, bot actions, and restart.
- Workspace/user work: dirty concurrent work is present; edit only `src/agent/runtime/behavior-config.js`, `src/agent/modes.js`, `src/utils/mcdata.js`, the `avoidEnemies` preservation blackout in `src/agent/library/skills.js`, and this lane's Hermes records.
- Pre-change checks: complete role normalization, mode initialization/suppression, threat classification, persisted profile modes, and current bot history evidence inspected.

## Repository evidence
- All current Builder profiles are `autonomous` but persist `self_defense: true` and `cowardice: false`.
- Runtime role presets already describe per-role reflex intent, but no consumer applies `rolePreset.reflexes`.
- Current histories show repeated unarmed Builder fights and deaths against Endermen and ordinary hostiles.
- `isCombatSafeHostile()` treats Mineflayer-reported hostile Endermen as safe because the avoid-only set omits them.
- `initModes()` is the single initialization seam; later `!setMode` calls can still override its result.

## Mode
- Candidate mode: constrained
- Candidate count: 2
- Record profile: compact

## Candidates
- V1 `init-policy,normalized-override,existing-modes,legacy-safe`: normalize a combat-reflex policy, resolve role defaults once after profile modes load, and keep the existing mode scheduler.
- V2 `dynamic-arbitration,capability-scoring,per-tick-policy,new-state`: choose fight/flight every tick from role, equipment, health, and threat strength.

## Divergence
- V1-V2: V1 makes the existing declared role contract real with a small deterministic seam; V2 could become more adaptive but adds an unproven combat decision engine and broader lifecycle surface.

## Paper gates
- V1: pass - fulfills the confirmed role mismatch, preserves legacy and explicit command authority, adds no new scheduler, and is visible through existing mode telemetry.
- V2: pass - potentially stronger game knowledge, but materially higher behavior and regression risk without live combat proof.

## IN
[codeplan · role-combat-reflex-policy · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=init-policy,normalized-override,existing-modes,legacy-safe;V2=dynamic-arbitration,capability-scoring,per-tick-policy,new-state · lean: V1 · conservative: V1]

## Frozen rubric and scoring
- freeze: axes=playability,architecture-fit,operator-configurability,lifecycle-risk,delivery-cost classes=quality,quality,quality,risk,convenience weights=3,3,2,3,1 denominator=60 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer
- V1: 4,5,4,5,5 = 56/60 = 0.93
- V2: 5,3,5,2,2 = 43/60 = 0.72
- Arithmetic verification: V1 = 12+15+8+15+5; V2 = 15+9+10+6+2; common denominator 60.
- Formal baseline: V1.
- Selection stability: V1 leads by 0.21 with lower lifecycle risk.

## PLAN-OUT
[codeplan · role-combat-reflex-policy · PLAN-OUT · mode: constrained · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1=0.93;V2=0.72 · reason: the existing role preset and mode controller already define the right ownership boundary; applying a normalized policy once fixes the confirmed death loop without a competing combat engine · planned-fingerprint: init-policy,normalized-override,existing-modes,legacy-safe]

## Implementation plan
1. Add a bounded runtime `reflexes.combat` policy with `role`, `defend`, `avoid`, and `off`.
2. Make non-combat role presets explicitly request cowardice rather than self-defense.
3. After legacy/profile modes load, apply the policy only for profiles with explicit runtime configuration.
4. Add Endermen to avoid-only autonomous targeting without changing explicit attack commands.
5. Keep emergency self-preservation available during avoidance, re-read every changed range, and defer execution.

## Implementation and evidence
- Added normalized `runtime.reflexes.combat` values `role`, `defend`, `avoid`, and `off`; serialization and reader-facing behavior description preserve the setting.
- Non-combat work/scout/custom role presets now request avoidance, while Companion, Defender, and Attacker retain defense.
- `initModes()` applies the policy only when the source profile has an explicit runtime payload, after legacy mode loading; later `!setMode` calls remain authoritative.
- Endermen are avoid-only for autonomous targeting, including the retreat routine's close-range counter-swing.
- Removed the retreat path's self-preservation blackout so fire, drowning, and critical-health reactions may interrupt it.
- Re-read the full normalization and mode-initialization ranges, hostile classification, and complete avoidance function; focused diff formatting passed. No test, combat action, build, bot command, or restart was run.

## EXEC-OUT
[codeplan · role-combat-reflex-policy · EXEC-OUT · implemented: V1 · confidence: low · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: preserved self-preservation during retreat and closed avoid-only counter-swing edge · evidence: persisted-profile/history witness,complete-source-reread,focused-diff-check; live activation deferred]
