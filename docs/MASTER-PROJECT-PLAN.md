# Minecraft Companion Master Project Plan

**Last updated:** 2026-08-06

**Canonical workspace:** `/mnt/c/Users/zerop/Development/minecraft-companion-brain-v2`

**Active branch:** `recovery/iron-pickaxe-20260803`

**Current delivery scope:** one primary companion bot

**Authority:** this file is the project-level roadmap and status index.

## How to read and maintain this plan

- `[x]` means the change is installed in source.
- `[~]` means source is installed, but current live/runtime acceptance is still pending.
- `[ ]` means work remains.
- A source-complete item is not automatically runtime-proved.
- Update this file whenever a work slice changes status.
- Keep detailed implementation reasoning in `.hermes/plans/`, defects in `.hermes/defects/mindcraft-runtime.md`, transient transfer notes in `.hermes/handoffs/`, and runtime proof in `.hermes/verification/`.
- Do not delete or rewrite historical records merely because this index supersedes them.

## Product goal

Build a trustworthy Minecraft companion that a player can start locally, direct naturally, and rely on for ordinary survival and world work. The bot must preserve player authority, act through real Minecraft state, report exact blockers, and never turn a request or API acknowledgement into a fictional completed action.

## Current truth

- [x] The hybrid architecture is locked: GoalDirector owns durable player outcomes, ActionManager owns one physical lease, and deterministic Mineflayer skills execute and verify Minecraft effects.
- [x] The planner consumes a typed capability catalogue for collect, craft, smelt, fuel, equip, and delivery operations; it is not an item-specific route table.
- [x] Broad physical campaigns have crossed stone, iron, bucket, shield, clock, interruption/resumption, exact/family delivery, glass, escort, and companion-control boundaries.
- [x] Checkpoint `bd2bd12` physically completed the natural request `Please make and equip an iron sword.` from a deep mine: surfaced, collected fuel, reused an existing furnace, smelted, crafted, reclaimed a temporary table, equipped, and passed Paper verification.
- [x] Checkpoint `3db8228` physically completed the natural request `Please make 16 stone bricks and keep them in your inventory.` twice through the generic fuel, smelting, crafting, and inventory contracts; Paper verified 32 total bricks and furnace reclamation.
- [x] Checkpoint `7b05d24` physically established and planted a coherent 3x3 wheat farm after binding an exact hydrated site and native no-dig route; Paper verified all nine plots, and an unchanged repeat request reused the existing farm without expanding it.
- [~] Checkpoint `fd1d9c4` preserved exact failed-resource coordinates and accepted native workstation interaction stances. One broad eight-iron request completed delivery; a controlled follow-up used the existing workshop furnace with no fallback placement, while the unchanged repeat still failed upstream after four expensive ore-route rejections.
- [x] Owned Pathfinder now handles ordinary locomotion through policy, including the corrected one-block descent contract. Custom controls remain only for mechanics Pathfinder cannot express safely.
- [x] Checkpoint `4fa25d5` gives V2 an independent exact dependency tree and lock, and moves canceled chest-window ownership into a single-generation Mineflayer gate. Paper proved prompt Stop, full response-horizon quarantine, later fresh transfer, and exact chest/inventory restoration.
- [x] Direct Agenda terminal results are persisted before dispatch ownership is released; a Paper Stop-plus-restart proof retained the completed step exactly once and did not replay it.
- [x] The broad farm companion session now passes in one run: natural Follow, standing attributed companion protection within 50 ms of player damage, hostile defeat, deterministic Follow resumption without another order, stationary `0.9995` gaze alignment, authoritative Stop, and hold-safe runtime configuration. Jordan accepted and froze this tranche in `J2C-20260806-1208-broad-farm-companion-accepted`; the sentence established Follow rather than a new explicit Guard owner.
- [x] One natural escorted-worksite request now completes end to end: Follow crosses meaningful water through native Pathfinder shoreline recovery, a bounded typed Agenda condition identifies the player-designated furnace, the existing smelter consumes live carried material and shared fractional fuel data, Follow resumes for the return trip, and ordinary Stop holds the bot. The exact furnace coordinates and dimension now persist atomically onto the dependent smelt step; a local Paper proof showed the designated furnace working while a closer decoy remained empty and unlit.
- [ ] P1 package debt: table crafting still opens its window outside the `openBlock`/`openEntity` gate. Route that raw opener through the package generation boundary before a broad outcome requires crafting immediately after aborted container work; do not claim global UI serialization meanwhile.
- [~] A successful campaign proves the shared path it exercised, not arbitrary repeatability or production readiness. The bot remains a research companion with known product gaps below.
- [ ] Release readiness requires broad cross-domain repeatability, world stewardship, stable companion behavior, clean cancellation across dependency calls, and sustained unattended play.

## Locked product-scale operating plan

1. Start with a broad, useful, unfamiliar player outcome. Do not invent a microscopic campaign before gameplay demands one.
2. Keep that exact scenario active: run, observe the first material blocker, repair the underlying shared primitive or owned dependency, and rerun.
3. Continue through directly encountered blockers until the complete outcome works, a safety boundary stops it, or a named external blocker remains.
4. Add at most one focused regression test for the exposed contract. A passing test never substitutes for physical completion.
5. Verify inventory, equipment, delivery, and world mutations independently through Paper; then commit and push one meaningful functional checkpoint.
6. Do not create a second executor, direct LLM body control, item-specific routes, speculative world-state frameworks, dashboards, or evidence projects to avoid the active gameplay failure.

## Remaining product tranches

### 1. Companion presence and player authority

- [x] Run the approved broad farm companion session: Follow, attributed hostile preemption, defend the player, resume Follow without model restoration, and settle nearby gaze.
- [x] Freeze natural Follow, standing attributed companion protection, deterministic resumption, settled gaze, and Stop after the accepted integrated session; do not rerun companion-control permutations without a later broad regression.
- Finish reliable swimming/follow settlement without oscillating through the player.
- Distinguish orders addressed to the bot from nearby player conversation.
- [x] Keep nearby gaze on the player without stealing active-action control during the integrated farm companion session.
- Preserve self-defense and player-defense while idle; never resume stale or terminal work.

### 2. World stewardship and shared infrastructure

- Protect player and foreign structures from unauthorized digging, placement, shelter construction, and route excavation.
- [x] Complete one natural broad outcome that accompanies the player through meaningful water, binds infrastructure the player explicitly designates, reuses it for a useful operation selected from live materials, returns with the player, and ends under ordinary Stop authority.
- Freeze the proven river/worksite/furnace route. Future broad requests may reuse its shared primitives, but do not manufacture shoreline, furnace, or smelting permutations absent a product-scale regression.
- Prefer non-destructive native routes; do not tear up terrain, paths, or buildings for convenience.
- Discover and reuse reachable furnaces, crafting tables, storage, farms, shelters, and player-designated shared structures.
- Bind building work to an explicit player-owned site and cleanup contract instead of ad-hoc block placement.
- [x] Farm establishment binds a complete rectangular hydrated site, safe service stances, and a non-destructive native route before changing soil; this proves farm-site stewardship only, not general structure ownership.

### 3. Repeatable capability engine

- Grow the typed capability catalogue only when broad scenarios expose a missing composable operation.
- Give planner-visible operations explicit preconditions, binding, effects, execution, verification, cancellation, and failure evidence.
- Move strategy and retry policy out of `skills.js` incrementally; retain its hard-won safety mechanics in bounded execution adapters.
- Prove second-run repeatability and interruption/resumption across resource, crafting, home, farming, exploration, and combat campaigns.

### 4. Owned dependency strategy

- Treat the repository-owned Mineflayer, Pathfinder, CollectBlock, PvP, and Prismarine packages as maintained product code.
- Put generic physics, locomotion, cancellation, and plugin truth defects in the owned packages; keep Minecraft-companion policy in orchestration.
- Replace orchestration compensations only when a broad live failure proves the lower-level primitive and a rollback-safe package repair exists.

The detailed July 2026 completion record below is retained as historical implementation evidence. Where it conflicts with this section, this active V2 plan governs.

## Completed and source-installed changes

### C-001 — Local launch, setup, and control plane

- [x] Windows one-click launch and setup flow.
- [x] Launcher configuration persistence and profile preflight.
- [x] Local service discovery and no-key local-provider onboarding.
- [x] Managed Minecraft server lifecycle and bounded launcher controls.
- [x] Loopback-only unauthenticated MindServer boundary.
- [x] Dashboard agent registration separated from agent spawning.
- [x] Configured stopped bots remain visible instead of disappearing.
- [x] Bedrock/Geyser status distinguishes installed, configured, and joinable states.
- [x] Runtime stop now coordinates director work, task runners, the authoritative bot-process registry, managed Java, and Mindcraft-started local services.
- [x] Windows force cleanup targets complete owned process trees without sweeping unrelated machine processes.
- [x] Dashboard stop/start/restart/remove deadlines now cover the server's bounded lifecycle windows instead of reporting premature timeouts.

Primary evidence:

- `src/mindcraft/mindserver.js`
- `src/mindcraft/launcher-config.js`
- `src/mindcraft/local-quickstart.js`
- `src/mindcraft/managed-minecraft-server.js`
- `src/mindcraft/profile-preflight.js`
- `.hermes/defects/mindcraft-runtime.md`

### C-002 — Truthful readiness and lifecycle ownership

- [x] Spawn remains in `starting` until the authenticated child reports Minecraft world readiness after gameplay handlers are installed.
- [x] Process creation, bridge connection, login, and world readiness are distinct states.
- [x] Stop, Restart, kick, disconnect, timeout, and spawn failure route through bounded owners.
- [x] Single-bot stop/removal and stop-all acknowledgements wait for exit/removal postconditions.
- [x] Stalled bot startup/restart and managed-Java termination retain ownership through bounded process-tree cleanup.
- [x] Agent teardown is idempotent and owns update, idle-resume, and spawn-timeout handles.
- [x] Death performs bounded current-work cleanup without killing the respawning process.
- [x] `!endGoal` awaits self-prompt and action shutdown.
- [x] Last-good telemetry and failure diagnostics remain available after transient errors.

Primary evidence:

- `src/process/agent_process.js`
- `src/agent/agent.js`
- `src/agent/connection_handler.js`
- `src/agent/mindserver_proxy.js`
- `.hermes/plans/2026-07-28-truthful-agent-readiness-plan.md`
- `.hermes/plans/2026-07-28-lifecycle-result-teardown-plan.md`

### C-003 — Action ownership and structured truth

- [x] Action priority is operator hold, reflex, survival, player, durable job, autonomy, then background.
- [x] Lower-priority work cannot cancel higher-priority work.
- [x] Manual player commands interrupt incompatible autonomy.
- [x] Persistent job handoff is bounded and rejects ownership when the previous action will not yield.
- [x] Skill `false`, requested server effects, interruptions, timeouts, and verified success remain distinct structured outcomes.
- [x] Resumable Follow and Guard preserve the owner that created them.
- [x] Operator Stop remains held until an explicit release command.

Primary evidence:

- `src/agent/action_manager.js`
- `src/agent/runtime/action-result.js`
- `src/agent/commands/index.js`
- `src/agent/commands/actions.js`
- `.hermes/plans/2026-07-28-deterministic-action-ownership-plan.md`

### C-004 — Evidence-backed cognition and provider configuration

- [x] Acting prompts receive bounded Minecraft state and valid command capabilities.
- [x] Registry-backed game knowledge remains available when embeddings fail.
- [x] Saved provider endpoints reach model construction.
- [x] Direct autonomy commands are not reinterpreted by a second model.
- [x] Active goals maintain a sanitized bounded execution ledger.
- [x] Only a new structured `succeeded` result advances verified goal progress.
- [x] Observations and server requests do not count as completed world changes.
- [x] Restored goals retain restored authority and cannot be overwritten by default autonomy.
- [x] Exact repeated blockers are retained and surfaced without storing hidden reasoning.

Primary evidence:

- `src/agent/self_prompter.js`
- `src/agent/library/full_state.js`
- `src/agent/library/game_knowledge.js`
- `src/models/prompter.js`
- `src/models/openai_compatible.js`
- `.hermes/plans/2026-07-28-evidence-goal-cognition-plan.md`
- `.hermes/plans/2026-07-28-provider-endpoint-handoff-plan.md`

### C-005 — General gameplay primitives

- [x] Progressive navigation uses minimally destructive safe movements.
- [x] Coordinate and block navigation verify arrival and current target state.
- [x] Moving-entity navigation follows entity identity and rejects lost or moved targets.
- [x] Follow, retreat, door traversal, and surface navigation return observed outcomes.
- [x] Generic breaking refuses protected blocks.
- [x] Placement verifies material, support, clearance, reach, and final block state.
- [x] Downward digging is bounded and rejects unloaded, liquid, hazardous, falling-block, protected, existing-drop, and unsupported cells.
- [x] Every accepted downward step requires an observed safe landing.
- [x] Collection, crafting, smelting, inventory transfer, and temporary-table/furnace recovery preserve postcondition truth.
- [x] Generic item use has bounded activation/release and truthful requested versus observed results.
- [x] Furnace and villager windows close in `finally`.
- [x] Villager trade success requires the expected inventory gain.

Primary evidence:

- `src/agent/library/skills.js`
- `src/agent/runtime/gameplay-safety.js`
- `src/agent/commands/actions.js`
- `.hermes/plans/2026-07-28-core-gameplay-primitives-plan.md`

### C-006 — Combat and immediate survival

- [x] Melee hits require attributed damage evidence.
- [x] Defeat requires target lifecycle and final-damage attribution.
- [x] Defense is bounded and stops when threats persist without verified progress.
- [x] Passive mobs are excluded from hostile-defense logic.
- [x] Role combat reflex policy prevents configured workers from entering unwanted melee.
- [x] Low-health retreat uses recent damage and a real threat direction.
- [x] Drowning, active falling, burning/lava, overhead falling blocks, and urgent damage route through reflex ownership.
- [x] Drowning, fall stabilization, and fire escape are bounded and clean up control states.

Primary evidence:

- `src/agent/library/skills.js`
- `src/agent/modes.js`
- `src/agent/runtime/survival-policy.js`
- `src/agent/runtime/survival-director.js`

### C-007 — Durable survival and work

- [x] Survival policy covers hunger, food safety, health, armor, sleep, emergency shelter, and useful drops.
- [x] Work orders are validated, persisted, reconciled, and resumable.
- [x] A single bot may accept supported builder, miner, or lumberjack work without being locked to one profile role.
- [x] Builder work validates blueprint cells, inventory, protected blocks, occupants, escape, support, and final state.
- [x] Miner work uses game knowledge, tool preparation, safe resource targeting, and no-dig cave relocation.
- [x] Lumberjack work understands log families, tool preparation, quota, return, and deposit stages.
- [x] Player-authorized shelter work has a playable command entry point.
- [x] Functional shelter work follows explicit prerequisite stages: foundation, enclosure, access, weather cover, then light, storage, crafting, and smelting.
- [x] Builder audits ignore the executing bot, wait on transient foreign occupants, and resume from verified cells instead of abandoning or duplicating the structure.
- [x] Legacy NPC item/build callbacks preserve actual skill success and cannot mark blocked structures complete.

Primary evidence:

- `src/agent/runtime/work-order.js`
- `src/agent/runtime/job-state-store.js`
- `src/agent/runtime/job-director.js`
- `src/agent/runtime/jobs/`
- `src/agent/npc/`

### C-008 — Behavior, reaction, and operator visibility

- [x] Behavior events are factual, bounded, deduplicated, and sanitized.
- [x] Environment observation and reaction policy are separated from action ownership.
- [x] Attention, dialogue, job, survival, and action state have distinct telemetry.
- [x] Dashboard activity distinguishes requests, verified outcomes, blockers, and terminal failures.
- [x] Dialogue delivery is bounded and no longer owns gameplay forever.
- [x] Vision work is guarded against premature use and provider overload.

Primary evidence:

- `src/agent/runtime/behavior-event.js`
- `src/agent/runtime/environment-observer.js`
- `src/agent/runtime/reaction-policy.js`
- `src/agent/runtime/reaction-director.js`
- `src/agent/vision/vision_interpreter.js`
- `src/mindcraft/public/js/`

## Needed changes and remaining work

### P0 — Completed critical single-bot acceptance

The user explicitly replaced the former granular test matrix with a fast, critical-files-only gate. The broad matrix is preserved below as remaining hardening, but it does not block MP-001 through MP-006.

#### MP-001 — Add critical output coverage

**Status:** [x] Complete

- Added `tests/critical-runtime-output.test.js`.
- Proved structured action-result output and sanitization.
- Proved critical gameplay-safety classification output.
- Proved exact lifecycle-result matching, real preflight criteria, managed-server player-count parsing, and dry-run/live command agreement without connecting to services.

#### MP-002 — Add the critical static/output gate

**Status:** [x] Complete

- Added `test:critical`, `lint:critical`, and `check:critical` scripts.
- Added `tools/check-critical-format.mjs` so untracked critical files are checked directly instead of being omitted by `git diff --check`.
- `npm run check:critical` passed nine tests plus focused lint, syntax, and direct format checks.
- Broad static and regression gates were intentionally excluded from this fast acceptance scope.

#### MP-003 — Build the controlled runtime verifier

**Status:** [x] Complete

- Added `tools/verify-behavior-runtime.mjs`.
- Added `tests/runtime/behavior-runtime-cases.json`.
- Supports explicit URL/bot selection, dry-run, selected cases, bounded deadlines, active-world refusal, structured evidence, and verifier-owned bot cleanup.
- Requires the exact fresh `succeeded` / `completed` / `action:stay` result rather than accepting any recent action.
- Preflight requires reachable Minecraft plus the selected registered bot in stopped state.
- Unapproved managed worlds must prove zero online players through a fresh server `list` result.
- Any emitted start request remains cleanup-owned until stopped state is observed, including acknowledgement-loss cases.
- Dry-run passed and listed every planned mutation without connecting.

#### MP-004 — Run the authorized critical one-bot lifecycle

**Status:** [x] Complete

- Preflight proved the configured bot was registered and stopped while the managed Minecraft server was reachable.
- Live proof started only `MindcraftBot`, reached authenticated `world_ready`, issued `!stay(1)`, observed structured `phase: succeeded` / `code: completed` output, and stopped the bot.
- The observed action detail was `Action output: Stayed for 1.499 seconds.`
- Evidence: `.hermes/verification/primary-single-bot-preflight.json` and `.hermes/verification/primary-single-bot-live.json`.

#### MP-005 — Run the critical regression gate

**Status:** [x] Complete

- `npm run check:critical` passed after the independent-review repairs.
- Result: 9 tests passed, 0 failed; focused lint, syntax, and direct critical-file format checks over 17 files also passed.
- The earlier combined lifecycle/finalization/readiness command exceeded its time limit and was stopped. It was not counted as passing and was not rerun after the user narrowed the scope.

#### MP-006 — Perform the critical single-bot completion audit

**Status:** [x] Complete

- Every critical P0 criterion is classified in `.hermes/verification/PRIMARY-SINGLE-BOT-RUNTIME.md`.
- A fresh-context review found five important verifier weaknesses and one minor gate weakness; all were corrected through `.hermes/plans/2026-07-28-verifier-review-fixes-plan.md`.
- The original critical audit had no contradiction. A later operator-discovered shutdown contradiction is recorded as RT-083 and repaired in source.
- The verifier-created bot stopped cleanly.
- The dashboard, managed Minecraft server, and Ollama processes launched for verification were shut down; ports 8080, 25579, and 11434 were closed.

### Deferred verification depth

These remain needed for broader confidence, but were explicitly removed from the MP-001 through MP-006 critical gate:

- the full gameplay, behavior, control-plane, repair, and browser/dashboard suites;
- stop/restart interruption coverage across provider startup, login, spawn, and active gameplay;
- action-owner conflict cases across autonomy, jobs, reflexes, and direct player commands;
- navigation, gathering, crafting, smelting, placement, breaking, descent, combat, survival, villager trading, and role-work matrices;
- death, respawn, disconnect, kick, restart, persistence, and restored-goal continuity;
- a live operator check of Stop Mindcraft Runtime, Stop All Bots, single-bot stop/removal, and full control-center shutdown after the RT-083 repair;
- packaged-artifact and release verification.

### P1 — Required hardening after basic playability

#### MP-007 — Verify persistence across restart boundaries

**Status:** [ ] Needed

Verify saved goals, work orders, personal memory, last-good telemetry, operator hold, and stopped/ready registration across clean restart, crash restart, kick, and managed-server restart.

#### MP-008 — Verify dashboard/operator truth for new result codes

**Status:** [ ] Needed

Confirm the UI exposes protected-block refusal, target loss/change, partial descent, survival blockers, trade verification, spawn failure, death cleanup, and terminal teardown without collapsing them into generic success/error text.

#### MP-009 — Reconcile unresolved historical plans against current source

**Status:** [ ] Needed, documentation-only first

The following older records lack reliable execution markers and must be reconciled rather than automatically reimplemented:

- `.hermes/plans/2026-07-27-attention-dialogue-telemetry-plan.md`
- `.hermes/plans/2026-07-27-dialogue-delivery-plan.md`
- `.hermes/plans/2026-07-27-inventory-skill-verification-plan.md`
- `.hermes/plans/2026-07-27-manual-stop-boundary-plan.md`
- `.hermes/plans/2026-07-27-role-reflex-arbitration-plan.md`
- `.hermes/plans/2026-07-27-runtime-autonomy-role-plan.md`
- `.hermes/plans/2026-07-27-threat-recognition-defense-plan.md`

For each record, classify the current implementation as superseded, implemented elsewhere, still needed, or contradicted. Do not change source until the classification proves a live gap.

#### MP-010 — Clean durable record duplication

**Status:** [ ] Needs explicit cleanup approval

- Consolidate duplicate RT-079 entries without losing either root-cause history.
- Consolidate repeated `EXEC-OUT` blocks into a final outcome plus amendment history.
- Mark the 2026-07-28 handoff superseded by this master plan after runtime proof is complete.
- Preserve raw historical evidence; do not delete records without approval.

### P2 — Deferred expansion, not part of current single-bot completion

#### MP-011 — Squad reaction and soak verification

**Status:** [ ] Deferred

Run controlled three-bot reaction cases and a bounded ten-bot soak only after the single-bot P0 gate passes.

#### MP-012 — UI/product refinement

**Status:** [ ] Deferred

Refine setup, bot status, activity, and operator recovery flows only from observed usability defects. Preserve current features and avoid UI redesign without a specific approved direction.

#### MP-013 — Release preparation

**Status:** [ ] Deferred and requires publication approval

- Separate intended project changes from unrelated dirty-worktree content.
- Produce a reviewed commit sequence.
- Re-run acceptance against the exact packaged/released artifact.
- Do not push, publish, or deploy without explicit approval.

## Stop rules

- Stop and report if a live gate needs provider credentials, Minecraft/world mutation, process restart, firewall change, or publication authority not explicitly granted.
- Never convert a failed runtime case into a documentation-only “complete.”
- Never reset, clean, or discard the shared dirty worktree to make verification easier.
- Do not revive a historical plan merely because it lacks `EXEC-OUT`; inspect current source and runtime truth first.

## Definition of single-bot completion

The critical single-bot acceptance slice is complete because:

- MP-001 through MP-006 pass;
- the exact current checkout passes nine focused critical output tests plus lint, syntax, and direct critical-file format checks;
- the controlled runtime verifier proves a stopped configured bot can reach `world_ready`, execute a direct action with structured success evidence, and stop cleanly;
- the later runtime-stop contradiction is recorded as RT-083, repaired in source, and explicitly retained as a live-check item;
- runtime evidence is recorded in `.hermes/verification/PRIMARY-SINGLE-BOT-RUNTIME.md`.

This does not mean the broader gameplay matrix, production readiness, packaging, or release work is complete.
