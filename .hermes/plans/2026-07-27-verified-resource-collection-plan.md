# Codeplan: Verified resource collection

## Contract and safety
- Required behavior: autonomous resource roles must either collect the selected block or emit the exact actionable blocker and perform bounded relocation when the blocker is local reachability.
- Acceptance criteria: a swallowed path stop cannot become collection success; collection uses the existing non-destructive movement policy; missing tools and full inventory do not trigger blind wandering; retryable local path failures can enter the existing bounded search cycle.
- Must preserve: operator Stop, direct-command grace, current action-result schema, role recovery budget, Mineflayer plugin compatibility, and concurrent dashboard/profile/squad work.
- Out of scope: role loadout crafting, provisioned inventory, behavior-tree replacement, UI presentation, backend restart, and broad tests.
- Workspace/user work: extensive dirty and untracked concurrent work is present. Only `src/agent/library/skills.js`, `src/agent/runtime/role-director.js`, this record, scratchpad, and defect log are in scope.
- Pre-change checks: live Dashboard shows ten connected Builders with `skill_not_collected`, `skill_unreachable`, and exhausted resource-search states. Source inspection shows `mineflayer-collectblock` replaces the caller's movements and swallows `PathStopped`, while Mindcraft increments collection without checking the target block.

## Repository evidence
- `safeMovements()` is the existing movement safety boundary and disables pathfinder digging/towers while allowing normal traversal.
- `collectBlock()` currently configures safe movements before calling the plugin, but the plugin installs its own `Movements` object during `collect()`.
- The plugin catches `PathStopped` and resolves; Mindcraft currently treats any resolution as a collected block.
- `RoleDirector` relocates only for `skill_not_collected`; retryable `skill_unreachable` and `skill_not_broken` repeat in place after a generic failure cooldown.

## Mode
- Candidate mode: constrained
- Candidate count: 2
- Record profile: compact

## Candidates
- V1 `existing-plugin,guarded-movements,postcondition-check,structured-result`: keep the plugin, inject the safe movement instance it actually consumes, verify the exact block changed, preserve failure evidence, and widen only the existing bounded relocation classifier.
- V2 `internal-collector,manual-path-dig-pickup,new-control-flow`: replace the plugin with a Mindcraft-owned navigate/dig/drop/pickup state machine.

## Divergence
- V1-V2: V1 hardens the installed plugin boundary and retains its drop/pickup lifecycle; V2 owns the complete collection lifecycle but introduces substantially more movement, inventory, event, and cleanup surface.

## Paper gates
- V1: pass - satisfies action truth and safety using existing seams, zero dependencies, and a small reversible surface.
- V2: pass - can satisfy the contract, but replaces a mature plugin path and would require broader live evidence than the user currently authorizes.

## IN
[codeplan · verified-resource-collection · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=existing-plugin/guarded-movements/postcondition-check/structured-result;V2=internal-collector/manual-path-dig-pickup/new-control-flow · lean: V1 · conservative: V1]

## Frozen rubric and scoring
- freeze: axes=architecture-fit,truth-verifiability,safety,performance,delivery-risk classes=quality,quality,risk,quality,risk weights=3,3,3,2,1 denominator=60 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer
- V1: 4,4,4,4,5 = 49/60 = 0.82
- V2: 3,5,5,3,2 = 47/60 = 0.78
- Formal baseline: V1.
- Selection stability: V1 has the higher known score and the smaller regression surface.

## PLAN-OUT
[codeplan · verified-resource-collection · PLAN-OUT · mode: constrained · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1=0.82;V2=0.78 · reason: the existing plugin remains useful when its real movement boundary and swallowed completion are guarded; replacing its entire lifecycle adds risk without improving the present bounded fix · planned-fingerprint: existing-plugin,guarded-movements,postcondition-check,structured-result,bounded-recovery]

## Implementation plan
1. Make plugin collection consume the same safe movements used by target selection.
2. Treat a resolved plugin call as incomplete when the exact selected block still exists.
3. Convert thrown collection errors into bounded structured outcomes and stop retrying the same target inside one command.
4. Preserve detailed zero-collection evidence rather than replacing it with generic `not_collected`.
5. Let resource roles relocate only for retryable local collection/path blockers; preserve tool, capacity, hold, and interruption outcomes.
6. Inspect the exact edited source and record partial verification; do not restart the active ten-bot runtime.

## Implementation and evidence
- Implemented V1 without a mechanism shift.
- The collectblock adapter receives `safeMovements`; target selection and plugin traversal now share one non-destructive policy.
- A resolved plugin call is rejected when the selected block remains, its chunk becomes unavailable, the action was interrupted, or the expected drop did not enter this bot's inventory.
- Inventory preflight now recognizes only free slots or partial stacks compatible with the selected block's declared drops.
- Thrown collection errors become `skill_unreachable`, `skill_path_timeout`, `skill_missing_tool`, or `skill_collect_blocked` rather than being retried in place and replaced with a generic result.
- Role recovery admits only retryable collection-local codes and retains its existing movement/recovery budget.
- Evidence gates: exact source ranges and installed plugin behavior inspected; active ten-bot runtime preserved. Syntax/build/lint/live collection remain intentionally not run at the user's direction.

## EXEC-OUT
[codeplan · verified-resource-collection · EXEC-OUT · implemented: V1 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: plugin movement boundary, exact block/drop postconditions, error preservation, compatible inventory preflight, and bounded relocation classification · evidence: installed plugin and final source inspected; live activation and tests deferred to preserve concurrent runtime and follow user test constraints]
