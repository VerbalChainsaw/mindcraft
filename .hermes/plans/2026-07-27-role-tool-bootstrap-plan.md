# Codeplan: Survival role tool bootstrap

## Contract and safety
- Required behavior: survival-mode job roles must obtain and equip an appropriate starter tool through verified Minecraft actions instead of repeatedly attempting work bare-handed.
- Acceptance criteria: Miner prepares/equips a pickaxe; Lumberjack prepares/equips an axe; existing equal-or-better tools are reused; wood, planks, sticks, table, tool, and equip stages are bounded and preserve the precise failed stage.
- Must preserve: survival inventory truth, provisioned-loadout boundary, operator Stop, role recovery budgets, current commands/actions, and concurrent UI/control-plane work.
- Out of scope: server-issued items, arbitrary recursive crafting, tool durability replacement, armor/loadout policy, combat equipment, and live activation.
- Workspace/user work: dirty concurrent work is present; only runtime skill/command/director files and Hermes records are in scope.

## Repository evidence
- `craftRecipe()` already verifies recipe/material availability, table placement/reachability, output inventory delta, and cleanup.
- `collectWood()` now produces guarded, structured collection outcomes.
- RoleDirector owns bounded role sequencing through the shared ActionManager command path.
- Current Miner intent immediately requests cobblestone and can only report `missing_tool`; no component prepares one.

## Mode
- Candidate mode: constrained
- Candidate count: 2
- Record profile: compact

## Candidates
- V1 `bounded-composite-skill,existing-actions,inventory-state,zero-dep`: add one reusable wooden-tool preparation skill and command; RoleDirector invokes it only when the required tool family is absent.
- V2 `director-state-machine,multi-command-stage-state,instance-state`: make RoleDirector persist each log/plank/stick/table/tool stage and dispatch separate commands over multiple cycles.

## Divergence
- V1-V2: V1 keeps preparation inside one interruptible ActionManager ownership window and reuses existing verified skills; V2 exposes every stage to the scheduler but adds persistent partial-stage state and more resume/race cases.

## Paper gates
- V1: pass - existing skill composition, bounded loops, survival-only effects, and one structured outcome boundary.
- V2: pass - can work, but expands scheduler state and interruption recovery without a current need.

## IN
[codeplan · role-tool-bootstrap · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=bounded-composite-skill/existing-actions/inventory-state/zero-dep;V2=director-state-machine/multi-command-stage-state/instance-state · lean: V1 · conservative: V1]

## Frozen rubric and scoring
- freeze: axes=architecture-fit,gameplay-truth,interrupt-safety,operability,delivery-risk classes=quality,quality,risk,quality,risk weights=3,3,3,2,1 denominator=60 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer
- V1: 5,4,4,4,4 = 51/60 = 0.85
- V2: 3,4,3,5,2 = 41/60 = 0.68
- Formal baseline: V1.
- Selection stability: V1 leads by 0.17 with less persistent state and fewer ownership races.

## PLAN-OUT
[codeplan · role-tool-bootstrap · PLAN-OUT · mode: constrained · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1=0.85;V2=0.68 · reason: verified skill composition fits the current ActionManager ownership model and avoids a second scheduler state machine · planned-fingerprint: bounded-composite-skill,existing-actions,inventory-state,structured-result,zero-dep]

## Implementation plan
1. Add bounded wooden-tool preparation for pickaxe and axe families.
2. Reuse an existing equal-or-better tool and equip it.
3. Otherwise collect wood, convert the available species to planks, craft sticks/table/tool, verify inventory, and equip.
4. Expose preparation through the existing command/action wrapper.
5. Make Miner and Lumberjack intents request preparation only while the tool family is absent.
6. Preserve intermediate collection/crafting evidence and do not restart the live stack.

## Implementation and evidence
- Implemented V1 without a mechanism shift.
- `prepareWoodenTool` accepts only wooden pickaxe/axe starters, prefers the strongest existing matching family, and verifies hand equip.
- Plank conversion is species-aware and bounded to six attempts; missing wood delegates to guarded `collectWood`, while sticks, table, and tool delegate to verified `craftRecipe`.
- Miner and Lumberjack add the preparation intent only when their live inventory lacks the required family.
- The shared command wrapper gives the entire composite one ActionManager owner, timeout, Stop boundary, telemetry result, and role-scheduler handoff.
- Evidence gates: exact skill, command, and director source ranges inspected. Syntax/build/lint/live gameplay remain intentionally not run at the user's direction; active ten-bot state was not restarted.

## EXEC-OUT
[codeplan · role-tool-bootstrap · EXEC-OUT · implemented: V1 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: deterministic survival wood/plank/stick/table/tool/equip preparation plus Miner/Lumberjack readiness intent · evidence: final source inspected; live activation and tests deferred to preserve concurrent runtime and user constraints]
