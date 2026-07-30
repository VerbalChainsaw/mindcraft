# Codeplan: inventory skill verification

## Contract and safety
- Required behavior: crafting, chest deposit/withdraw/view, and consumption must verify reachability, operation outcome, and observable inventory change before reporting success.
- Acceptance criteria: failed chest approach never opens/claims a transfer; container lifecycle closes safely on all paths; crafting requires a usable placed/reached table and a positive output delta; chest/consume success has a measured inventory delta; all failure paths emit bounded structured evidence.
- Must preserve: existing commands, survival/creative authority, safe navigation policy, existing inventory format, and no automatic retry/deposit/withdraw beyond the operator request.
- Out of scope: new inventory database/transaction framework, server plugins, item crafting recipes, world startup, or live test execution.
- Workspace/user work: present and protected.
- Pre-change checks: source call-chain inspection only; user explicitly deferred tests/runtimes.

## Repository evidence
- `craftRecipe()` does not require successful table placement/approach or check output inventory delta.
- `putInChest()`, `takeFromChest()`, and `viewChest()` ignore navigation result and lack error/close boundaries; deposit/withdraw report success without a post-transfer count check.
- `consume()` returns true after `bot.consume()` without verifying the consumed item left inventory.
- `world.getInventoryCounts()` already exposes an authoritative per-slot count map, and `setActionEvidence()` is the established structured result seam.

## Mode
- Candidate mode: constrained
- Candidate count: 2
- Record profile: compact
- Reason: local postcondition checks and a new generic transaction abstraction are the only credible mechanisms.

## Candidates
- V1 `localized count snapshots + safe cleanup` (`existing-skill-module,preflight,postcondition,try-finally`): add a small count helper and use it within each affected skill with explicit navigation, container close, and outcome evidence.
- V2 `generic inventory transaction service` (`new-module,transaction-wrapper,shared-state,try-finally`): introduce a reusable inventory/container transaction layer and migrate affected skills.

## Divergence
- V1↔V2: V1 stays in the existing skill authority and expresses distinct craft/chest/consume proofs locally; V2 centralizes future operations but creates new generic semantics over varied Mineflayer container/crafting APIs.

## Paper gates
- V1 task fulfillment: pass — every named operation can compare concrete before/after state and route failures through existing results.
- V1 contract preservation: pass — commands and boolean skill contracts remain unchanged.
- V1 safety/data integrity: pass — no automatic compensation or repeat transfer; containers close in `finally`.
- V1 verification feasibility: pass — source proof available; live Mineflayer proof deferred.
- V2 task fulfillment: pass — could support the same checks.
- V2 contract preservation: pass — feasible but requires a wider migration and a new generic container model.
- V2 safety/data integrity: pass — feasible, with more untested abstraction surface.
- V2 verification feasibility: pass — source inspection possible but broader runtime matrix deferred.

## IN
[codeplan · inventory-skill-verification · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=localized-count-snapshots-safe-cleanup;V2=generic-inventory-transaction-service · lean: V1 · conservative: V1]

## Frozen rubric and scoring
- freeze: axes=architecture-fit,world-truth,data-safety,regression-risk,delivery-cost classes=quality,quality,risk,risk,convenience weights=3,3,3,2,1 denominator=60 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer
- V1: 5,5,5,4,4 = 57/60 = 0.95 — aligns with existing skills/evidence and keeps each Mineflayer operation's proof explicit.
- V2: 3,4,4,2,2 = 39/60 = 0.65 — reusable but introduces a broad untested abstraction for varied container behavior.
- arithmetic verification: (5*3)+(5*3)+(5*3)+(4*2)+(4*1)=57; (3*3)+(4*3)+(4*3)+(2*2)+(2*1)=39.
- formal baseline: V1.
- selection stability: V1 exceeds V2 by 0.30.

## PLAN-OUT
[codeplan · inventory-skill-verification · PLAN-OUT · mode: constrained · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1=0.95;V2=0.65 · reason: localized measurable postconditions harden the current skill contract without inventing a second inventory authority. · planned-fingerprint: existing-skill-module,preflight,postcondition,try-finally]

## Implementation plan
- Files/boundaries: `src/agent/library/skills.js` only, reusing world inventory counts and action evidence.
- Ordered changes: add a safe count helper; harden crafting table/reach/output checks; harden chest navigation/transfer/close/error checks; harden consumption count check.
- Contract checks: every reported success has a measured result; cleanup cannot erase the primary outcome; legacy boolean return values stay intact.
- Tests/checks: source/diff inspection only; no test, build, bot, server, provider, or world execution under user instruction.
- Rollback: all changes are local pre/post guards; no data schema or command syntax changes.
