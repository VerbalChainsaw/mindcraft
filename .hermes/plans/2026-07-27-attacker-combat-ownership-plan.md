# Codeplan: Attacker combat ownership

## Contract and safety
- Required behavior: Attacker must own a visible, bounded combat action when a combat-safe hostile is nearby; Defender remains an escort that reacts through the existing defense reflex.
- Acceptance criteria: neutral/huntable/avoid-only entities are never autonomous targets; attack uses the existing bounded action/result path; target disappearance is a short truthful retry, not a hard failure; no-player Attacker patrols safely instead of standing indefinitely.
- Must preserve: canonical hostile classification, boss avoidance, operator Stop, action interruption, player safety, current guard behavior, and telemetry.
- Out of scope: PvP against players, hunting neutral mobs, combat loadout crafting, formations, and UI changes.
- Workspace/user work: concurrent work present; only RoleDirector and Hermes records are in scope.

## Repository evidence
- `mc.isCombatSafeHostile()` excludes avoid-only bosses and never-auto-target golems.
- `skills.defendSelf()` is bounded by range, swings, failures, interrupt state, and cleanup.
- `!attackHostile` already wraps that skill in ActionManager and emits structured outcomes.
- RoleDirector currently sends both Defender and Attacker to `!guardPlayer`, so Attacker never emits role-owned combat intent.

## Mode
- Candidate mode: constrained
- Candidate count: 2
- Record profile: compact

## Candidates
- V1 `role-intent,canonical-classifier,existing-command,bounded-action`: select a nearby combat-safe hostile in RoleDirector and dispatch existing `!attackHostile`; otherwise escort or patrol.
- V2 `reflex-policy,mode-priority,implicit-action`: modify self-defense reflex frequency/range for Attacker and infer role behavior from mode activity.

## Divergence
- V1-V2: V1 makes combat an explicit role action with target/status/outcome; V2 remains implicit survival reflex behavior and cannot truthfully represent Attacker job ownership.

## Paper gates
- V1: pass - reuses canonical classification and bounded action with a small reversible scheduler change.
- V2: fail - does not fulfill explicit role-owned combat/status behavior and risks increasing reflex/action contention.

## IN
[codeplan · attacker-combat-ownership · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=role-intent/canonical-classifier/existing-command/bounded-action;V2=reflex-policy/mode-priority/implicit-action · lean: V1 · conservative: V1]

## Frozen rubric and scoring
- V2 is disqualified by task-fulfillment and negative-space gates.
- V1 is the only viable mechanism; no scoring theater is applied.

## PLAN-OUT
[codeplan · attacker-combat-ownership · PLAN-OUT · mode: constrained · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1=1.00;V2=disqualified · reason: only explicit role intent produces truthful Attacker ownership while retaining the existing bounded combat implementation · planned-fingerprint: role-intent,canonical-classifier,existing-command,bounded-action,graceful-degrade]

## Implementation plan
1. Read nearby entities through the existing world helper and canonical combat-safe predicate.
2. Split Companion, Defender, and Attacker intent selection.
3. Attacker engages a safe hostile, performs a finite regroup toward a visible leader otherwise, and uses bounded safe patrol when alone so combat is re-evaluated each cycle.
4. Treat a target that disappears before action start as an expected short retry.
5. Inspect exact source and do not restart the active stack.

## Implementation and evidence
- Implemented V1 without a mechanism shift.
- RoleDirector now reads nearby entities through the existing world helper and canonical combat-safe predicate.
- Companion remains follow, Defender remains continuous guard, and Attacker owns bounded hostile engagement with finite regroup/patrol fallback.
- Continuous movement status is keyed to follow/guard behavior, so an Attacker combat result cannot be masked by its role label.
- A hostile lost between selection and action becomes `combat_target_gone` with a short retry.
- Evidence gates: exact classifier, combat command/skill, and final scheduler source inspected. Syntax/build/lint/live combat remain intentionally not run; the active concurrent stack was preserved.

## EXEC-OUT
[codeplan · attacker-combat-ownership · EXEC-OUT · implemented: V1 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: explicit Attacker combat intent, finite escort/patrol fallback, target-race handling, and behavior-specific continuous movement status · evidence: final source inspected; live activation and tests deferred by user and concurrency constraints]
