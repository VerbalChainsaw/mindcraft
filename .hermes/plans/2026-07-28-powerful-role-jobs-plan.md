# Codeplan: Powerful resumable role jobs

## Contract and safety
- Required behavior: Builder, Miner, and Lumberjack perform useful multi-step work, recover from blockers, resume safely, and verify completion.
- Acceptance criteria: every job uses validated work orders and phase postconditions; Builder stockpiles automatically but builds only explicit blueprints or validated emergency-shelter orders.
- Must preserve: verified commands/skills, target-scoped digging, safe movement, Stop, manual-command grace, role/autonomy policy, atomic bot data, and concurrent work.
- Out of scope: immediate distributed task-market scheduling and arbitrary model-authored world mutations.
- Workspace/user work: extensive uncommitted work is present; evolve the existing role seam without parallel schedulers.
- Pre-change checks: `RoleDirector`, resource recovery, tool bootstrap, collection/building skills, action results, runtime memory, and squad assignments inspected.

## Repository evidence
- Current role work repeats one command and has only resource-search recovery.
- Collection, tool preparation, crafting, movement, placement, and action-result contracts already exist.
- Builder currently has no authoritative explicit-blueprint work-order owner.
- Atomic bot persistence and stable squad/member identity already exist.

## Mode
- Candidate mode: full
- Candidate count: 3
- Record profile: compact

## Candidates
- V1 `role-plan-engine,persisted-checkpoint,verified-commands,result-return`: evolve role scheduling into resumable per-role phase plans.
- V2 `self-prompter,model-planning,conversation-state,verified-commands`: let the model choose each step while retaining verified skills.
- V3 `persistent-task-graph,distributed-claims,squad-service,verified-commands`: build a full multi-bot dependency graph and claim service immediately.

## Divergence
- V1↔V2: V1 owns deterministic phase progress; V2 stores progress implicitly in model/history turns.
- V1↔V3: V1 starts with one work order per bot; V3 adds cross-process distributed claims and coordination.
- V2↔V3: V2 is adaptive but probabilistic; V3 is explicit and coordinated but operationally broad.

## Paper gates
- V1: pass - matches current role/action architecture and supports precise phase tests and restart reconciliation.
- V2: pass - physically verified skills remain safe, but planning and recovery are less reproducible.
- V3: pass - strongest squad coordination, but requires new lifecycle, persistence, and contention contracts.

## IN
[codeplan · powerful-role-jobs · IN · mode: full · profile: compact · confidence: high · candidates: V1=resumable-role-plans,verified-commands,checkpointed-phases;V2=model-planned-jobs,self-prompter;V3=persistent-squad-task-graph,distributed-claims · lean: V1 · conservative: V1]

## Frozen rubric and scoring
- freeze: axes=job-competence,architecture-fit,verifiability,recovery-integrity,delivery-cost classes=quality,quality,quality,risk,convenience weights=3,3,3,3,1 denominator=65 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer
- V1: 5,5,5,5,3 = 63/65 = 0.97.
- V2: 4,3,2,3,4 = 40/65 = 0.62.
- V3: 5,4,4,5,1 = 55/65 = 0.85.
- Arithmetic verification: executable calculation confirmed common denominator and totals.
- Formal baseline: V1; V2 is excluded by a score of 2 on active quality axis verifiability.
- Selection stability: V1 leads by 0.12 and has lower lifecycle surface than V3.

## PLAN-OUT
[codeplan · powerful-role-jobs · PLAN-OUT · mode: full · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1=0.97;V2=0.62;V3=0.85 · reason: resumable role plans deliver strong competence and recovery through existing verified command boundaries while leaving a clean path to later squad task graphs · planned-fingerprint: resumable-role-plans,verified-commands,checkpointed-phases]

## Implementation plan
- Files/boundaries: work-order schema/normalizer, evolved role/job director, per-role plans, atomic checkpoint persistence, state projection, focused/integration tests.
- Ordered changes: shared phase engine; validation/persistence; Builder plan; Miner plan; Lumberjack plan; recovery/deposit/delivery; squad-safe IDs; tests; controlled runtime gates.
- Contract checks: explicit-blueprint authority, no duplicate scheduler, exact postconditions, restart revalidation, inventory/tool/hazard/route limits.
- Rollback: normalized job policy can fall back to the existing single-command role intent while checkpoints remain inert.

## Implementation and evidence
- Implemented validated work orders, atomic per-bot checkpoints, restart revalidation, bounded recovery, terminal cleanup, and completion/warning squad radio.
- Replaced autonomous role repetition with one `JobDirector`; direct resumable Miner, Lumberjack, and Builder stockpile commands are available to players and natural-language directives.
- Builder balances plank/cobblestone stockpiles, sources supported materials, builds only explicit construction tasks or validated emergency shelter work, audits hazards/support/exit space, and verifies each cell.
- Miner progresses wooden through diamond pickaxes, manufactures torches, uses resource/depth knowledge, accounts for actual drops, preserves target-scoped no-dig routing, and supports leader or exact-container delivery.
- Lumberjack prepares a stone axe, selects canonical log families, safely collects bounded trunks, uses the verified stump checkpoint for replanting, and supports delivery policies.
- Tool preparation now supports wooden through diamond pickaxes, axes, shovels, hoes, and swords; selection rejects the final ten percent/last sixteen uses of durability, replaces worn equipment, and equips the strongest healthy tool for the current block or combat action.
- Structured inventory awareness exposes remaining/maximum durability, percentage, and replacement need so model reasoning sees the same tool condition as deterministic job planning.
- Job snapshots treat worn tools as unavailable, and all three role loops pause for action-owned food resupply before resuming their saved phase.
- Miner and Lumberjack delivery now accumulates verified delivered quota across inventory cycles. Mixed log types transfer as one family, and checkpoint progress advances only after a successful chest/player transfer.
- Assigned-deposit jobs can unload nonessential overflow while preserving food, equipment, utilities, and the active job target; this prevents full inventories of unrelated items from deadlocking collection.
- Ordinary player language now directly handles food preparation, best-food consumption, full tool preparation/replacement, useful-drop pickup, mining, timber, and Builder stockpile orders.
- The Bot Library now persists and exposes survival, job, stockpile, delivery, leader, assigned-container, and reaction controls.
- `npm run check:behavior`, source syntax checks, and `git diff --check` passed after the gameplay expansion on 2026-07-28. Live-bot activation remains intentionally pending.

## EXEC-OUT
[codeplan · powerful-role-jobs · EXEC-OUT · implemented: V1+durable-tools+cumulative-delivery · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: worn-tool-readiness,mixed-log-delivery,inventory-overflow,food-resupply · evidence: five-tool-families,durability-selection,checkpointed-delivery,family-transfer,overflow-consolidation,natural-directives,66-behavior-tests,syntax,diff-check;live-runtime-not-activated]
