# Codeplan: Role gameplay ownership

## Contract and safety
- Required behavior: a spawned bot must acquire a real, bounded gameplay behavior from its saved role instead of remaining a chat-only actor.
- Acceptance criteria: scenario role reaches `profile.runtime`; companion/defender roles move with their assigned player; autonomous job roles attempt a concrete world action; failures and suppression remain explicit; operator Stop remains absolute.
- Must preserve: current ActionManager result truth, manual-command ownership, self-prompt limits, scenario commands, provider/persona separation, and all concurrent work.
- Out of scope: behavior-tree rewrite, broad combat redesign, dashboard redesign, live game verification, and regression sweeping.
- Workspace/user work: extensive concurrent edits and untracked runtime/control-plane files are present. Only additive runtime code and narrow inspected seams may be touched.
- Pre-change checks: source/runtime inspection only at user request; no tests, build, lint, or game actions.

## Repository evidence
- `normalizeRuntimeBehavior()` defaults a missing payload to `companion + balanced`.
- Generated scenario members currently contain identity/persona but omit `profile.runtime`; the persisted Builder Brigade therefore lost its builder/autonomous contract.
- `SelfPrompter` resumes only an already-active goal. It does not create role work when stopped.
- `Agent.update()` has one serialized 300 ms scheduler seam; `ActionManager` and `executeCommand()` already own action truth and cleanup.
- Existing modes provide bounded preservation/defense reflexes but no general role-work owner.

## Mode
- Candidate mode: constrained
- Candidate count: 2
- Record profile: compact

## Candidates
- V1 `existing-self-prompter,startup-goal,model-driven`: map the role and automatically start one role prompt. Lowest effort, but the observed 3B model can still emit speech/no command and leaves movement/combat dependent on model compliance.
- V2 `new-module,event-driven,result-return,graceful-degrade`: map role/assignment at scenario launch and use a compact RoleDirector to dispatch existing verified commands with hold, ownership, target, cooldown, and retry guards. Job roles retain bounded model goals only where creative planning is required.

## Divergence
- V1↔V2: V1 relies on language-model command emission for every action; V2 deterministically owns safe movement/defense and bounded job attempts through the existing action contract.

## Paper gates
- V1: pass task shape and compatibility; weak negative-space fit because it can reproduce the observed talk-only failure.
- V2: pass task fulfillment, contract preservation, negative space, repository rules, verification feasibility, lifecycle/ownership, and resource bounds.

## IN
[codeplan · role-gameplay-director · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=existing-self-prompter,startup-goal,model-driven;V2=new-module,event-driven,result-return,graceful-degrade · lean: V2 · conservative: V1]

## Frozen rubric and scoring
- freeze: axes=playability,architecture-fit,stop-and-ownership-safety,failure-truth,delivery-cost classes=quality,quality,risk,risk,convenience weights=3,3,3,2,1 denominator=60 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer
- V1: 2,4,4,3,5 = 38/60 = 0.63
- V2: 5,4,5,4,3 = 53/60 = 0.88
- Arithmetic verified directly; formal baseline V1; selection is stable.

## PLAN-OUT
[codeplan · role-gameplay-director · PLAN-OUT · mode: constrained · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.63;V2=0.88 · reason: deterministic ownership through the existing action/result path solves the observed chat-only gap while preserving Stop and manual-command arbitration · planned-fingerprint: new-module,event-driven,result-return,graceful-degrade]

## Implementation plan
- Add `src/agent/runtime/role-director.js` with bounded role intents, assignment targeting, cooldown/backoff, manual deferral, and structured status.
- Extend runtime normalization with a bounded assignment contract.
- Map scenario behavior/leader/formation into each generated member runtime without discarding template limits, memory, vision, or loadout.
- Instantiate/update the director at the current serialized Agent seam and defer it when a player takes manual action.
- Record the defect and implementation outcome. Verification remains source-only until the requested visual/live play pass.

## Implementation and evidence
- Added the selected RoleDirector module; it delegates every effect to existing commands and ActionManager.
- Added a bounded assignment to runtime v1, scenario mapping, deep merge, and load-time migration for pre-fix persisted squads.
- Added a combat-safe direct `attack nearest enemy` order and exposed bounded director state through the existing action telemetry.
- Pre/post comparison: prior generated Builder Brigade members had no runtime and no post-goal gameplay owner; new/restored scenario members carry their actual role and a bounded action owner.
- Evidence gates: planned fingerprint passed by source inspection; the controlled launcher handoff reported its replacement ready and requested all six active bot names be resumed. Live gameplay, tests, build, lint, and broad regression verification intentionally were not run under the user's current code-first constraint.

## EXEC-OUT
[codeplan · role-gameplay-director · EXEC-OUT · implemented: V2 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: preserved nested runtime fidelity and migrated pre-fix persisted squads · evidence: inspected scenario-to-profile-to-agent-to-command-to-telemetry path; controlled launcher replacement became ready and requested six bot resumes; live Minecraft proof deferred]
