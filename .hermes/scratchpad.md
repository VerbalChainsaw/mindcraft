# Mindcraft runtime upgrade scratchpad

## Current state

- Working branch: `develop` with substantial shared, uncommitted dashboard and control-plane work.
- Active lane: bot runtime configuration, durable memory, cognition, movement/action truthfulness, and perception.
- Protected concurrent lane: Bot Library CRUD/UI, Fleet Home, squads UI/storage, provider readiness UI, and server administration.

## Completed commits

- None in this runtime slice; changes remain intentionally uncommitted in the shared dirty tree.

## Active problem

- Runtime behavior defaults, durable personal memory, action-result normalization, prompt memory injection, and an operator hold latch are now wired.
- An evidence-led audit found cross-boundary truthfulness failures: false skill results can be reported as success; dashboard telemetry is not subscribed; terminal outcomes remain inside bot processes; manual restart/shutdown can acknowledge success before lifecycle completion; and Bedrock status conflates installation with join readiness.

## Next concrete step

- Slice A is wired in source: failed skill outcomes, cached perception, live state subscription, and operator readouts now share one structured contract. Next: harden action/lifecycle completion semantics and keep widening the operational readouts without colliding with the active Bot Library editor work.

## Batch 2 - movement and action hardening
- Repaired unsafe asynchronous path probe and made the default route non-digging/no-tower with bounded door cleanup per bot.
- Navigation now returns precise unreachable, lost-target, interrupted, and arrival evidence instead of optimistic success.
- Fixed skill-library embedding fallback to score actual skill docs; embeddings no longer remove gameplay knowledge.
- Corrected tool inventory condition and added path/tool collection evidence. Targeted syntax checks passed; no live server restart or regression suite run.

## Live readout slice
- Home fleet rows now show actual action, coordinates, health, hold state, scan staleness, and verified failures rather than lifecycle-only status.
- Bot State, Director, Server, and Activity consume the same state map. Director explicitly distinguishes delivery accepted from verified in-game completion.
- Compatibility correction: deep perception refresh is internal to `full_state`, so the existing callback-only `get-full-state` wire contract remains safe for running bots.

## Activity timeline pass
- [codeplan · operator-activity-timeline · SKIP · reason: one small, reversible browser-local mechanism fits the existing `ActivityLog` contract; no backend schema, lifecycle protocol, or profile ownership changes are required.]
- Clarify source semantics, expose bounded filters/search/counts, and make `BOT` outcomes visibly distinct from transport/delivery records. The timeline must never imply that it is durable server history or that a Director acknowledgement means in-game completion.

## Cross-play readout alignment
- [codeplan · bedrock-readout-alignment · SKIP · reason: this is a narrow presentation correction over existing server and client state; it does not change Geyser configuration, lifecycle ownership, or Windows permissions.]
- Separate “Geyser bridge running” from “this Windows Bedrock client can join.” A missing loopback exemption must surface as setup needed on Home and the diagnostics rail, while a stopped Geyser must not stay green merely because its jars are installed.

## Director player targeting
- [codeplan · director-player-targeting · PLAN-OUT · pick: V2 · reason: explicit player target with safe serialization and structured nearby-player suggestions beats an ambiguous placeholder-only fix.]
- Remove the fictional `Director` player name from quick, repeat, and sequence defaults. Keep manual command entry, but give follow/come a visible target field so the operator knows exactly whom the bot is being told to follow.

## Host task runner truth
- [codeplan · host-task-runner-truth · PLAN-OUT · pick: V2 · reason: reject false remote execution at the runtime boundary and expose bounded last-cycle evidence rather than a cosmetic disclaimer.]
- The Task Runners tab is local host automation only. It must not present a remote stub as usable or allow manual heartbeat to look like a completed command.

## Director active-operation readout
- [codeplan · director-active-readout · SKIP · reason: this is a direct presentation of the existing structured state map in the already-owned Director cards; it introduces no new transport or operation correlation claim.]
- Repeat and program cards must show their bot's current action, coordinates, last verified result, and telemetry age so delivery scheduling cannot look like physical progress.

## Dashboard first-sample truth
- [codeplan · dashboard-first-sample · SKIP · reason: one render-state correction prevents the existing asynchronous server poll from briefly claiming that an unknown managed server is uninstalled.]
- Until the first managed-server response arrives, Home should say “Checking” and disable server actions rather than show false offline/not-installed status.

## Lifecycle acknowledgement truth
- [codeplan · lifecycle-ack-truth · PLAN-OUT · pick: V1 · reason: the existing lifecycle owners already provide the needed settled result, so the dashboard handlers should delegate and propagate rather than invent a parallel operation path.]
- Bot Restart now always reaches `Mindcraft.startAgent()` and `AgentProcess.forceRestart()` even when the old bot socket is connected. Its acknowledgement means the replacement child spawned; the existing lifecycle/in-game state remains the stronger readiness proof.
- If Stop arrives while that restart is waiting for the old child to exit or the replacement to spawn, Stop cancels and rejects the shared restart result without marking the bot failed.
- Control-center shutdown now returns a visible failure and leaves MindServer running when bot or Paper shutdown is unconfirmed. Concurrent bot/server stop failures are combined so one failure no longer hides the other.
- No live restart or shutdown was issued against the user's running console. Syntax and diff checks only.

## Legacy settings activation convergence
- `set-agent-settings` still sent a private restart event to the child, which exited through `cleanKill()` and could hit crash-recovery limits while the modal already claimed success.
- The handler now validates and applies settings first, then inspects the parent lifecycle state. Running/starting/restarting bots await `Mindcraft.startAgent()`; stopped, stopping, failed, and ready bots remain stopped and use the new settings on their next explicit Start.
- Partial outcomes report `settingsApplied`, `restarted`, `activation`, and `lifecycleState`. The obsolete child-side restart listener is removed, leaving the dashboard `restart-agent` request as the only restart event under `src`.
- Bot Library/profile UI remains untouched. Syntax and diff checks only; no settings change or bot restart was sent to the live console.

## Geyser durable configuration convergence
- Live proof before the source change: the managed Java process listens on `127.0.0.1:19132` through `-DgeyserUdpAddress`, while generated `plugins/Geyser-Spigot/config.yml` still says `bedrock.address: 0.0.0.0`.
- The next managed start or Bedrock repair now locates the exact generated `bedrock.address`, `bedrock.port`, and current/legacy `java|remote.auth-type` keys, updates only those values, and atomically renames the file.
- Server status now exposes `crossplay.configured` and bounded `crossplay.configuration` evidence (`generated`, `inSync`, effective generated values, and drift reasons) separately from plugin installation and runtime listener readiness.
- The currently running Paper/Geyser process and generated file were not changed. Source syntax/diff inspection only; the convergence will become effective on the next user-authorized managed restart/repair.

## First-start cross-play readiness
- `waitForReady()` previously returned when Paper reached `running`, even if Geyser had not emitted its listener proof. A fresh generated config therefore remained unconverged until a separate repair/restart.
- Readiness calls are now shared per manager. Java-only servers keep the existing Paper readiness behavior; cross-play servers wait for `crossplayRuntimeReady`, inspect generated configuration, converge and verify it, perform at most one managed restart, and require the second Geyser listener proof within the original deadline.
- Multiple concurrent readiness callers reuse the same operation and cannot each initiate a bootstrap restart.
- No current process was cycled. Syntax/diff inspection only; first-install lifecycle proof remains deferred to the later user-observed playbook.

## Integrated identity slice
- User selected both individual Character Identity and squad naming/badges as one system.
- Current safe split: `profile.id` is stable library identity; `profile.name`/`agentName` is the Minecraft login and process key; mutable display name/title/call sign must not replace it.
- Confirmed thin wiring: Bot Library persists role/job/persona/appearance but drops `profile.runtime`; runtime already understands language/style/attitude/specialties, so the editor cannot currently activate those capabilities.
- Confirmed data hazard: histories and runtime memory live below `bots/<agentName>`. A mutable login-name rename can strand prior state. This slice will preserve login identity and add stable/mutable presentation metadata; filesystem migration remains a separate explicit operation.
- Confirmed squad gap: squad member names are always `${prefix}${number}` and snapshots expose no team/member identity beyond prefix/scenario.
- Concurrent Glimpse lane still reports ownership of Bot Library/profile/squad UI. Implement shared runtime/data contracts first and avoid presentation files until that lane settles.

## Integrated identity completion
- Character identity now has bounded display name, stable Minecraft login, call sign, title, bot type, job/role, appearance note, nameplate presentation, language, attitude, style, specialties, memory, vision, and runtime limits.
- Squad identity now has a display name, badge, color, motto, naming policy, and optional named roster. Themed, role-derived, custom, and numeric names remain collision-safe Minecraft logins while friendly identity travels separately.
- Bot Library launch preserves validated `profile.runtime`; prompts and full-state telemetry consume the same identity contract; squad persistence/snapshots retain stable squad and member metadata.
- Primary-viewport browser inspection covered the Character Identity preset/editor and expanded Team Identity & Custom Roster controls. No profile was saved, no squad was launched, and no server or bot process was restarted.
- Focused `node --check` passed for all 11 touched JavaScript files and focused `git diff --check` passed. Live backend activation and in-game rendering remain deferred.

## Agent/server telemetry wiring completion
- Replaced the stateless sampler behavior with a bounded, per-connection last-good cache. A late or unavailable bridge now retains the last authoritative game state and overlays explicit `stale` or `backoff` transport evidence instead of deleting position, activity, health, inventory, perception, identity, and action outcome data.
- Concurrent samples now occupy their original sorted target slots before the object is built, so semantic fingerprints no longer churn because callbacks happen to finish in a different order. Unchanged fields are sent through one volatile dashboard room, and a joining second dashboard gets the current shared sample immediately.
- The sampler has bounded interval/timeout/concurrency/heartbeat/backoff settings, a safe stop→start rearm path, async-publish containment, and status available from the read-only `/api/agent-telemetry` endpoint. Settings persist in `launcher-config.json` and are exposed in Advanced Setup; a launcher restart is required to apply them.
- Child agent bridge setup now shares a bounded connection operation, installs status listeners before the first connection event, delays registration until the Agent exists, and makes chat/output/radio paths disconnect-safe with a bounded radio acknowledgement.
- `full_state` now shares one nearby-entity pass and one inventory pass per heartbeat while preserving the existing output fields and nearest-first ordering.
- Focused syntax, tracked diff, and new-file whitespace checks passed. Primary-viewport browser inspection showed the closed-by-default six-field telemetry configuration control. No configuration was saved, no bot/server was restarted, and no broad regression suite was run.

## Runtime-memory load truth
- [codeplan · runtime-memory-load-truth · SKIP · reason: one existing error boundary has one safe corrective mechanism: distinguish `ENOENT` from filesystem failure and retain corrupt-file quarantine only for parse/validation faults.]
- A bot must not silently receive an empty personal-memory state when its data path is inaccessible. This correction preserves the current file format, atomic writer, and malformed-file recovery behavior; it does not migrate, delete, or rewrite any existing bot data.

## Verified resource collection
- The live Builder squads exposed a plugin-boundary lie: `mineflayer-collectblock` replaces the caller's safe movements and intentionally swallows `PathStopped`, while Mindcraft treated any resolved call as collection success.
- Collection now supplies the plugin's real movement policy, checks only drop-compatible inventory stack space, verifies the exact block changed and its expected drop entered this bot's inventory, and preserves path/tool/capacity/interrupt evidence.
- Resource roles relocate only for a closed set of retryable local collection blockers. Missing tools, full inventory, non-dropping targets, operator Stop, and interrupted work stay visible and do not trigger blind search.
- Backend activation remains deferred because another agent has ten live bots and a second active squad on the current source console.

## Survival role tool bootstrap
- Miner and Lumberjack no longer assume their job tool exists. The role scheduler checks the live inventory for any pickaxe/axe family and dispatches one shared verified preparation action only when absent.
- Preparation is survival-only and bounded: collect real wood, convert its actual species to planks, craft sticks/table/tool, verify the resulting inventory, then equip and verify the held item.
- Stronger existing tools win by tier and are equipped instead of replaced. Collection/crafting failures remain structured and no provider/model reasoning is needed for the deterministic bootstrap.
- Runtime activation remains deferred while the concurrent ten-bot session is active.

## Attacker combat ownership
- Defender stays attached to its leader and relies on the bounded defense reflex. Attacker now owns explicit combat-safe hostile engagement and therefore produces a visible role target and structured combat outcome.
- When no eligible hostile is present, Attacker uses a finite regroup toward a player or an eight-block safe patrol step, allowing threat selection to run again instead of being trapped in an endless follow action.
- Only the canonical `isCombatSafeHostile` set is eligible; players, passive mobs, golems, and avoid-only bosses are untouched.

## Bounded dialogue attention
- Conversation limits now normalize under `profile.runtime.limits`: six outbound turns and five minutes by default, configurable from 2-20 turns and 1-30 minutes.
- Busy actions defer dialogue processing for at most six five-second polls; response reminders cap at one before a graceful mission return. Queues cap at 24 messages / 12,000 compiled characters.
- Reset/end really cancel timers, relay failures end the lock, end-all is null-safe, and one owned resume timer restores only goals actually paused or explicitly deferred by conversation.
- Ordinary bot-authored squad status radio is recorded as context without creating a conversation lock or pausing gameplay.

## Progressive verified navigation
- Deleted the shared one-second `getPathTo` gate that rejected pathfinder `partial` results before movement. Native `goto` now owns its intended progressive A* lifecycle, avoiding duplicate computation on every movement skill.
- Success requires the goal predicate to be true after `goto` resolves. No path, path timeout, changed goal, stopped path, interrupt, and resolved-without-arrival stay distinct.
- Door monitoring remains per-action and clears in `finally`; safe movements still disallow destructive route digging and towers while allowing normal sprint/parkour/doors.
- The villager helper now checks both the navigation result and final distance instead of logging success after a false return.

## Squad persistence truth
- A running squad can be real even when a later restart cannot restore it; that is a partial operational result, not an excuse to call the action failed or hide its durability problem.
- `BotSquadManager` now owns a bounded persistence status. Missing storage is normal first use, unreadable storage becomes a blocked error that cannot be overwritten automatically, and write/serialization errors remain retryable but visible through the same list/update/action payloads the dashboard already consumes.
- The Bots workspace warns on the empty state, squad card, and affected action notice. No second persistence protocol, server restart, or bot action was added.

## Command outcome propagation
- The runtime already knew `false` meant a verified inability to complete a skill, but almost every command wrapper discarded it. That made the structured action result lie exactly where the dashboard and action memory consume it.
- The wrappers now return skill outcomes, and the discard composite has real prerequisite/return-to-origin semantics. This makes tool/path/target failures visible without forcing an incompatible skill-library rewrite.
- Static source checks only; do not infer live Minecraft behavior until the user authorizes the focused playbook.

## Movement, attention, reflex, and dialogue hardening
- [codeplan · evidence-based-movement-recovery · EXEC-OUT · implemented: V1 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: bounded follow recovery, verified retreat/avoid distance, safe reflex movement, combat return truth, and terminal resume cancellation · evidence: focused syntax/diff checks passed; no live bot/server action or broad suite ran]
- [codeplan · agent-attention-reflex-dialogue · PLAN-OUT · pick: V1 · reason: repair the existing self-prompt/mode/directive boundaries rather than introduce a second scheduler or behavior tree.]
- The activity contract now distinguishes actual move/retreat/hit/safe outcomes from path failure, lost targets, stuck follow, missing targets, and requested-but-unverified cheat teleportation.
- Self-prompting advances only after a newly recorded successful action result. Repeated non-actions/retryable failures pause the goal, and a non-retryable action failure stops it with a short factual chat explanation.
- Natural-language `defend me`, `follow me`, `come here`, `stay`, and wood-gathering are explicit behavior orders. Reports remain read-only and do not unhold a stopped companion.

## Skill preflight, vision, and gameplay knowledge
- [codeplan · skill-preflight-verification · EXEC-OUT · implemented: V1 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: collection/pickup/break/place/equip/farm/activate/give now preserve verified blockers and completion evidence · evidence: focused syntax/diff and raw-movement static scan passed; no live game action or broad suite ran]
- [codeplan · vision-broker-fallback · EXEC-OUT · implemented: V1 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: camera readiness, rate/single-flight, retention, structured failure, and look-command result propagation · evidence: focused syntax/diff checks passed; no camera/model request was sent]
- [codeplan · skill-knowledge-fallback · EXEC-OUT · implemented: V1 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: all-or-lexical embedding behavior, runtime query fallback, complete select-all corpus, deterministic ranking · evidence: focused syntax/diff checks passed; no provider request or broad suite ran]
- The bot’s model can now be creative about character and strategy but must take gameplay result, structured sensing, and explicit skill documentation as the truth boundary.
## 2026-07-27 - Role reflex arbitration
- Observation: role focus was visible to prompts/telemetry, but `cowardice` runs before `self_defense`, so a Defender/Attacker or a bot on an explicit `guardPlayer` command could flee before defending.
- Chosen seam: a small ModeController suppression-reason helper; no global mode reorder or behavior-tree rewrite.
- Intended truth: survival stays first; a Defender/Attacker or explicit guard can use self-defense; the dashboard can explain why a mode is suppressed.

## 2026-07-27 - Threat recognition and bounded defense
- Found: Mineflayer `entity.type === mob` includes livestock, so the prior hostile predicate could make a bot flee from or attack cows/sheep.
- Chosen seam: conservative canonical IDs plus an avoid-only category; self-defense reuses the bounded one-hit action path rather than trusting a persistent PvP loop.
- Intended truth: passive mobs are not threats, bosses trigger avoidance rather than autonomous melee, and a defense action reports secured, blocked, interrupted, or threat-persisting instead of hanging.

## 2026-07-27 - Attention and dialogue telemetry
- Gap: a dashboard could see `Thinking` or `Stopped` but could not distinguish a held bot, a paused goal, repeated non-progress, or an active conversation.
- Chosen seam: SelfPrompter lifecycle timestamps plus a bounded full-state projection.
- Privacy boundary: never emit raw goal text or chat turns; emit only goal state, loop status, progress budget/timestamps, mute, and conversation partner metadata.

## 2026-07-27 - Cheat navigation truth
- Corrected the remaining direct `/tp` helpers to report a requested server command, not a verified arrival.
- Arrival remains visible only when the authoritative next full-state position changes.

## 2026-07-27 - Dialogue delivery
- Found concurrent behavior/model chat with no order, pacing, byte-safe limit, or translation fallback.
- Chosen seam: one per-agent outbound queue after translation, preserving existing routing while making refusal/behavior dialogue reliable and bounded.

## 2026-07-27 - Manual Stop boundary
- Found a real Stop violation: a noncooperative action hit a 10-second `cleanKill()` watchdog, then the child lifecycle could treat the exit as a crash and restart without the operator hold.
- Chosen seam: ActionManager returns a bounded held/unresponsive outcome, blocks competing actions, and projects that condition into full state instead of terminating the process.

## 2026-07-27 - Operator attention, target, and dialogue truth
- Current source already subscribes dashboard mounts and reconnects to `listen-to-agents`; the earlier stale-telemetry audit finding is therefore resolved in this working copy and was not duplicated.
- The next presentation seam is deliberately additive: existing `utils.js` labels project bounded runtime state into Bot, Home, Director, and Server readouts without introducing another browser-state owner.
- Direct Bot chat now waits for a structured MindServer relay acknowledgement. “Accepted for relay” is deliberately weaker than “the bot completed the command”; only the action-result telemetry can claim completion.
- No browser, bot, server, model, or test command was started for this slice. Source inspection only.

## 2026-07-27 - Direct player order ownership
- Found an attention-control race: forced commands and natural-language directives went straight to `executeCommand`, while only the model-response path coordinated SelfPrompter. An old goal could therefore resume after Follow, Stay, Go To, work, or combat orders.
- Chosen seam: tag the existing shared world-skill wrapper, not a hand-maintained command list. Direct operator/world commands now synchronously stop autonomous scheduling before they begin; the old model turn sees the interrupt and cannot emit a later competing command.
- Boundary: the handoff does not call `ActionManager.stop()`, so it cannot cancel or delay the new direct command. Query, configuration, conversation, vision, `!goal`, and hard `!stop` semantics are unchanged.
- No runtime process or test was started; source call-chain inspection only.

## 2026-07-27 - Requested versus verified world actions
- Found a structured-result lie: cheat teleport/setblock skills said `*_requested` in evidence but returned `true`, and ActionManager turned that into a `succeeded` result. The dashboard could call an unobserved server command “completed.”
- Chosen seam: add a small `requested` result phase rather than invent an unverified per-skill polling loop. It flows through messages and telemetry, while Minecraft state remains authoritative for the actual world change.
- Autonomous goals stop rather than treating a pending server request as verified progress or as an ordinary hard skill failure. No automatic retry is introduced.
- No live server command, world mutation, bot action, model call, build, or test was issued.

## 2026-07-27 - Gameplay ownership
- Live evidence: six agents are connected, yet the persisted Builder Brigade members lost the scenario role at `profile.runtime` and normalize to `companion + balanced`.
- Runtime gap: modes provide reflexes and SelfPrompter can continue an explicit goal, but no component starts or recovers role work after spawn/no-progress.
- Selected repair: preserve scenario role/leader/formation in the runtime handoff and add one bounded RoleDirector over the existing command/action path. Manual Stop and manual command ownership remain higher priority.
- Implemented: scenario runtime mapping plus legacy persisted-squad migration; deep runtime merge; bounded deterministic RoleDirector; direct `attack nearest enemy` route; structured role-director telemetry folded into the existing action readout.
- Activation: the controlled `/api/restart` handoff reported the replacement control center ready on port 8083 and requested resume for MindcraftBot, Plumb, Mortar, Timber, Pane, and Crate. No gameplay action or regression suite was run; live behavior remains for the operator visual pass.

## 2026-07-27 - Squad-aware control-center restart
- Reproduced a false resume: six names were returned, only launcher-selected MindcraftBot existed afterward.
- Root cause: squad member names are not launcher profiles; their settings and desired state live under BotSquadManager.
- Implemented separate squad-ID handoff, owner-scoped replacement resume, strict partial-failure reporting, bounded settlement, and recovery even when an early failure leaves HTTP listening.
- Current source console: `http://localhost:8080`. The older 8082 instance was left untouched for concurrent work. Builder Brigade start was accepted on the source console; user visual proof remains pending.

## 2026-07-27 - Guided Bot Library setup
- Live Profiles inspection showed the recommended Ollama quickstart was clear, but the reusable character editor exposed every identity, memory, vision, provider, endpoint, and connection field in one uninterrupted form.
- The editor also ignored the catalog's server-issued provider and Minecraft defaults, leaving a new saved bot pointed at `25565` while the effective managed world was on another port.
- Implemented the existing-form Codeplan: essential identity, role, autonomy, provider, model, and world target stay visible; secondary character/runtime/model controls remain available in named disclosures; provider readiness uses actionable language; save-and-deploy is one truthful path.
- No test suite, build, provider call, or bot action was run. Visual source-console inspection is the active proof gate.

## 2026-07-27 - Squad target reconciliation
- Live read-only state exposed the concrete network failure: managed Java is on `127.0.0.1:25579`, while all five persisted Builder Brigade members are pinned to the prior `25578`.
- Selected the lifecycle boundary rather than a bulk startup rewrite. Immediately before squad create/restart, a running managed target refreshes the member settings and the registered agent settings owner; the reconciled settings are persisted by the existing squad emit path.
- If the managed world is stopped or unavailable, no override occurs, preserving intentional external-server profiles.
- Activation: source console restart on port `8080` resumed the Builder Brigade. All five member settings now persist `127.0.0.1:25579`, all five lifecycle owners report `running`, and the live Profiles status rail settled to `Java Reachable · 5 Running · 1 Stopped`.
- No gameplay command, provider call, build, broad regression sweep, or test suite was run.

## 2026-07-27 - Role resource-search recovery
- Live Director telemetry proved the Builder role was active but terminally repeating the same local collection failure: `skill_not_collected`, target `birch_log`, zero logs.
- The explicit Director player target and nearby-player suggestions already exist in the concurrent working copy and were preserved.
- Selected a bounded recovery phase inside the existing RoleDirector. Builder, Lumberjack, and Miner roles relocate through verified safe coordinate movement, rescan, and stop after the profile recovery budget instead of wandering forever.
- Tool, inventory, hazard, reachability, manual-command, and operator-Stop blockers retain priority and do not trigger blind resource wandering.

## 2026-07-27 - Adaptive agent telemetry
- After the role-recovery restart, five bots reached `in game`, but all first full-state requests exceeded the configured 1.2-second timeout. Because the new MindServer had no last-good sample yet, Director could show only an unavailable state.
- The state pump already preserves a last-good sample correctly; the missing seam was obtaining the first sample under busy multi-bot startup.
- Added a bounded 3.5-second cold-start budget, learned successful response latency, and failure-only expansion while preserving the configured timeout as the healthy floor.
- This adapts per AgentConnection and resets with its socket; it does not globally slow healthy bots or remove failure backoff.
- Activation result: five current samples, one complete five-bot sampling cycle in roughly 72 ms, zero failed pump cycles. The cold-start timeout wall is gone.

## 2026-07-27 - Role state presentation truth
- Found: full state mapped all RoleDirector `waiting` codes to “Role initializing,” while the new `recovering` phase fell through to “Stopped.”
- Corrected the activity mapping and added a Director `Role scheduler` row with bounded role, phase, code, and target.

## 2026-07-27 - Resource-search coverage
- Found: `collectWood` and `collectBlock` search 64 blocks, but RoleDirector recovery moved only 18–24 blocks before rescanning. A bot could visibly move yet spend every bounded retry inside essentially the same search area.
- The first widened fixed-coordinate activation truthfully failed as unreachable: projecting the bot's current Y level far away can select invalid terrain.
- Corrected the seam: recovery now prefers an actual loaded role resource within a bounded extended radius, then falls back to terrain-aware `moveAway` exploration rather than a guessed coordinate. The existing pathfinder, Stop/manual-control priority, and retry/cooldown limits remain authoritative.
- Live follow-up exposed a target contract mismatch: recovery reached a nearby birch log, but `collectWood` had selected it without the safety predicate later enforced by `collectBlock`. A shared collectible-block selector now drives both target selection paths.
- The aligned selector then exposed generic result fallback when no safe wood existed. `collectWood` now emits `not_collected` evidence at that boundary so only a genuine resource miss enters search recovery.
- A 192-block recovery lookup then starved the bot's full-state replies. Removed it: recovery moves through safe reachable terrain and reuses the normal 64-block scan, avoiding a synchronous giant cube search.

## 2026-07-27 - Bedrock join truth
- Live status proves Paper running, Geyser bound on UDP 19132, Floodgate configured, Minecraft for Windows detected, and same-PC loopback still disabled. None of those proves the Bedrock client can complete a join.
- Added a current-runtime verifier that accepts only a Floodgate-prefixed Paper `joined the game` event. Server, Dashboard, and shell status now distinguish setup, bridge running/test join, and verified join.
- A concurrent agent expanded the live world to ten bots across two squads during this slice. The source console was not restarted over that active runtime; visual frontend inspection can proceed, while backend activation remains explicitly pending.
- No test suite, build, provider call, or synthetic gameplay command was run.

## 2026-07-27 - Crafting-table fallback and recovery
- CENTER audit confirmed two coupled survival bootstrap gaps: an unreachable nearest world table blocks use of a carried table, and temporary-table cleanup verifies only block removal.
- Chosen seam: one local fallback plus exact dropped-item and inventory postconditions inside `craftRecipe`; no generic workstation manager.
- Intended truth: interruption remains authoritative, crafting success remains separate from cleanup status, and a temporary table is called recovered only when the bot's pre-placement inventory count returns.
- Implemented: existing-table routing falls back only after a verified failure; canonical nearby table-drop recovery is bounded; cleanup truth is attached to the craft evidence. No test, bot action, or restart was run.

## 2026-07-27 - Target-scoped collection movement
- Live/source convergence found the primary collection deadlock: the non-digging route policy is also used as the block-collection predicate, and pathfinder therefore rejects every resource before movement or tool use.
- The collectblock plugin cannot simply receive `canDig = true`; it mutates safety flags and could allow route excavation.
- Chosen seam: a dig-enabled selector plus an exact-coordinate plugin adapter backed by a separate unmutated safety guard, followed by unconditional restoration of the ordinary non-digging policy.
- Disproved: Miner `cobblestone` requests already include natural `stone`, so that command is not being changed.
- Implemented: generic resource and wood selection can now approve safe blocks; collectblock can break only the exact selected block; ordinary no-dig pathfinding is restored on every plugin exit. No test, bot action, or restart was run.

## 2026-07-27 - Portable table bootstrap
- Found: tool preparation skipped table crafting when any world table was nearby, even though the crafting boundary can prove that table unreachable.
- Implemented: Miner/Lumberjack survival bootstrap keeps one legitimately crafted table in inventory, allowing the existing local fallback to work without creative provisioning.
- No test, bot action, or restart was run.

## 2026-07-27 - Player-route reflex availability
- Found: `goToPlayer` disabled both fight and flee reflexes for its whole route, contradicting continuous Follow/Guard and role-aware combat arbitration.
- Implemented: one-shot player navigation remains interruptible by bounded survival reflexes; already-at-self and missing-player exits now produce structured evidence.
- No test, bot action, or restart was run.

## 2026-07-27 - Door recovery fallback
- Found: the custom stuck helper duplicates native pathfinder interaction and may randomly activate a trapdoor below/above the bot; its unawaited promise can reject outside the action error boundary.
- Selected: preserve native door/trapdoor routing and retain only a deterministic, single-flight, error-wrapped ordinary door/gate fallback for the native executor's inspected stalled rejection branch.
- Implemented: fallback scans only closed body-level wooden doors/gates, excludes trapdoors and vertical hazards, and releases its one-in-flight guard on every completion.
- No test, movement action, or restart was run.

## 2026-07-27 - Verified one-hit melee
- Found: one-hit combat calls a synchronous packet send a successful hit, permits a five-block swing, and feeds that false result into Defender/reflex progress accounting.
- Selected: keep the existing one-hit boundary and verify its exact Minecraft postcondition through a target- and source-attributed damage event with bounded cleanup.
- Implemented: realistic reach, exact target visibility, pre/post movement checks, wrapped equipment/send failures, 50 ms interruption polling, a 900 ms damage deadline, precise unconfirmed/unattributed outcomes, and idempotent cleanup.
- No test, combat action, build, bot command, or restart was run; the active runtime remains untouched until the user directs activation.

## 2026-07-27 - Combat mode lifecycle and defeat attribution
- Disproved: attack skill pauses do not permanently disable reflexes. Normal/error action exits emit `idle`; interrupted exits are idle on the next 300 ms controller update; both paths call `unPauseAll`.
- Confirmed instead: kill mode calls any matching target death this bot's kill, without observing the damage source.
- Selected: retain PvP execution but require the target's final observed damage source to be this bot before emitting `killed`.
- Implemented: target-specific damage-source tracking, attributed hit count, fail-closed unattributed death, causal kill evidence, and complete listener cleanup.
- [codeplan · underwater-combat-survival · SKIP · reason: single-valid-mechanism]
- Removed the aquatic-target survival blackout after proving that self-preservation's water control already yields to an active pathfinder goal. Fire and low-health reflexes remain available during underwater combat.
- No test, combat action, build, bot command, or restart was run; the active runtime remains untouched until the user directs activation.

## 2026-07-28 - Verified explicit door traversal
- Confirmed: nearest-door lookup crashes on the first missing species, manual movement can hang, and activation/forward motion are reported as success without a traversal postcondition.
- Selected: preserve the explicit helper but rebuild it over safe approach, canonical block state, bounded controls, facing-axis crossing proof, and best-effort close.
- Implemented: all wooden species share one safe lookup; supplied targets and refreshed state are validated; approach consumes the shared navigation result; door open/cross/close state is bounded and evidence-backed; forward control always releases.
- Completed the consumer trace: both NPC door actions now return traversal failure, and building-exit movement cannot continue after a failed crossing.
- Re-read every changed source line and enumerated all call sites. Focused diff formatting passed. No test, movement action, build, bot command, or restart was run in this slice.

## 2026-07-28 - Role-aware threat response
- Live persisted histories show the bots are not merely standing: unarmed Builder-role bots repeatedly enter bad melee engagements, get stuck, die, respawn, and repeat.
- Confirmed wiring gap: `rolePreset.reflexes` is normalized but never consumed; explicit Builder profiles therefore inherit generic `self_defense: true` and `cowardice: false`.
- Confirmed classification gap: Mineflayer-reported hostile Endermen pass `isCombatSafeHostile()`.
- Selected: normalize a configurable combat-reflex policy and apply it once at the existing mode initialization seam for explicit-runtime profiles; preserve legacy profiles and later `!setMode` authority.
- Implemented: role-safe fight/flight defaults plus `role`/`defend`/`avoid`/`off` override, conservative Enderman classification, no avoid-only counter-swing, and no self-preservation blackout during retreat.
- Re-read the complete changed contracts and ran focused diff formatting only. No test, combat action, build, bot command, or restart was run in this slice.

## 2026-07-28 - Balanced role playability
- Confirmed: the default `balanced` setting short-circuits Scout and all resource roles to the same regroup command before role work, even when already beside the assigned player.
- Selected: make balanced behavior player-anchored—work nearby, regroup when separated, wait without a player—using the existing leader/distance state and verified intent path.
- Implemented: balanced role work runs inside a 12-block player anchor; separation triggers regroup; no player triggers a truthful wait.
- Corrected the recovery edge during full-flow reread: 32–64 block resource relocation is autonomous-only, so balanced bots do not silently abandon their player.
- Focused diff formatting passed. No test, bot action, build, command, or restart was run in this slice.

## 2026-07-28 - Threat-aware low-health retreat
- Disproved: shared safe movement does not disable ordinary jumping; it explicitly enables parkour and sprinting while disabling destructive digging/towering.
- Confirmed instead: low-health preservation waits until below 2.5 hearts and uses directionless origin-relative movement despite known nearby hostiles.
- Selected: trigger at a bounded survivable threshold, retreat from the nearest canonical hostile, and use one safe fallback only when the target-relative route fails without interruption.
- Implemented in the existing self-preservation mode: recent damage at half health or after a severe hit now resolves the nearest canonical hostile, attempts verified entity-relative retreat, and uses one safe fallback only after an un-interrupted failure. A bounded cooldown prevents reflex churn.
- Re-read the damage-state owner, full low-health branch, hostile selector, retreat helpers, and action wrapper; focused diff formatting passed. No test, combat action, build, command, or restart ran in this slice.

## 2026-07-28 - Powerful behavior functional slices
- Implemented the full source-side survival, resumable Builder/Miner/Lumberjack, and factual social/environmental presence designs as major end-to-end slices.
- Added material and tool progression, light preparation, real mining-drop accounting, no-dig depth relocation, stable-layer construction, stump-based replanting, exact assigned deposits, terminal job cleanup/radio, environmental sensing, bounded natural reaction variation, and player-facing persistent job assignment.
- Wired survival/job/reaction and delivery controls into saved Bot Library profiles. Explicit-runtime bots default to full survival, resumable work, natural reactions, and validated emergency shelter capability; legacy compatibility remains conservative.
- Broad gates passed together: 66 behavior tests, 200 control-plane tests, 5 repair regressions, both lint suites, syntax checks, simulated ten-bot reaction soak, and diff formatting.
- No runtime restart, bot command, world mutation, commit, or push was performed. The ten live bots remain untouched; source activation and controlled Minecraft postconditions still require explicit authorization.

## 2026-07-28 - One bot can perform every durable work specialty
- CENTER trace confirmed a premature capability gate: validated active work orders are already executed by `order.role`, but command submission and natural-language routing required the profile's default role to match.
- Follow-through found player stockpile orders were incorrectly stamped as automatic role work; they are now player-owned so command-autonomy and survival arbitration preserve the explicit request.
- Selected the existing work-order seam instead of mutating `runtime.role`; character identity, default autonomy, reflex policy, and readouts remain stable while an explicit player job temporarily owns work.
- Implemented cross-role durable mining, harvesting, and stockpiling requests with existing validation, checkpointing, recovery, and truthful result flow.
- No runtime action, restart, test, build, or regression sweep was run.

## 2026-07-28 - Playable shelter construction entry point
- Confirmed: the verified Builder pipeline supported player construction internally, but no player command or ordinary-language route could create a build order.
- Selected a fixed local 3x3 shelter using the already validated survival geometry shifted into the auditor's zero-based footprint convention.
- Implemented one player-owned persistent shelter order; exact site and placement audits retain authority, and any obstruction is reported rather than destroyed.
- No runtime action, restart, test, build, or regression sweep was run.

## 2026-07-28 - Persistent job control handoff
- Confirmed: Follow/Guard is a resumable indefinite ActionManager action, while JobDirector refuses to dispatch until idle; assignment previously stopped only the model loop.
- Implemented one bounded handoff at the player assignment boundary: stop model autonomy, cancel resume, await action cleanup, then submit.
- If cleanup is unresponsive, the new order is not accepted and the bot is held with the active action named.
- No runtime action, restart, test, build, or regression sweep was run.

## 2026-07-28 - Critical food preemption
- Confirmed: automatic eating is disabled at startup, but the replacement survival owner could run only while idle; long verified actions therefore created a starvation window.
- Selected urgent intent preemption inside SurvivalDirector rather than duplicating food policy in a legacy mode.
- Implemented busy-state inspection plus explicit critical-only preemption; routine upkeep remains idle-only and interrupted durable jobs keep their recovery path.
- No runtime action, restart, test, build, or regression sweep was run.

## 2026-07-28 - Registry-first Minecraft knowledge
- User clarified the desired architecture: general Minecraft understanding plus composable actions, not a template for every activity.
- Confirmed the connected registry already supplies version-correct object, tool, drop, food, and durability facts, while the model had no general read boundary.
- Implemented bounded `!inspectMinecraft` knowledge backed by the active registry and local recipe data; unknown names return suggestions rather than invented facts.
- No runtime query, restart, test, build, or regression sweep was run.

## 2026-07-28 - Autonomous gameplay context
- Found the central cognition break: default autonomous turns were promised `__STATS__ __INVENTORY__`, but those literal markers were never replaced; goal, memory, persona, and command docs were absent too.
- The unused SelfPrompter instruction confirmed that the intended context never reached the provider.
- Implemented one provider-neutral, compact live context envelope plus registry-first composition rules and valid retry commands.
- No model call, runtime action, restart, test, build, or regression sweep was run.

## 2026-07-28 - Version-new tool recognition
- Installed Minecraft data includes copper tools and marks copper pickaxes as valid for iron ore, but both local tier maps treated copper as tier zero.
- Added copper between stone and iron for selection and job readiness; actual block harvesting still uses registry `canHarvest`.
- No runtime action, restart, test, build, or regression sweep was run.

## 2026-07-28 - Direct autonomy dispatch
- Confirmed the autonomy model's command was fed into `handleMessage` as a system message, which invoked the conversational model again instead of executing it.
- Confirmed autonomy received an empty recent-message list, so inspection results were invisible on the next turn.
- Implemented direct validated command dispatch, bounded command/output history, recent observation context, explicit ownership yield for persistent jobs, and context-only periodic re-planning.
- No provider call, runtime action, restart, test, build, or regression sweep was run.

## 2026-07-28 - Composable item use
- Confirmed generic targetless use could only send a single activation and falsely call it complete; it could not hold or release bows, shields, spyglasses, tridents, food, or future held-use items.
- Added one bounded main/off-hand use cycle instead of per-item templates. It verifies equipment, releases on interruption, and records inventory/durability evidence without claiming an unobserved world effect.
- Hardened shared equipment handling so full-inventory hand clearing cannot drop the held item and creative provisioning cannot overwrite an occupied slot.
- No item action, runtime restart, test, build, or regression sweep was run.

## 2026-07-28 - Truthful surface movement
- Confirmed `goToSurface` ignored failed routing and returned success from a fixed-height scan.
- Replaced it with connected-dimension bounds, loaded support/body-clearance selection, required path success, and final position/support verification.
- Kept escape conservative: it reports no loaded target or no safe route instead of digging, towering, teleporting, or pretending.
- No movement, runtime restart, test, build, or regression sweep was run.

## 2026-07-28 - Truthful generic interaction
- Confirmed generic block/entity use equated a resolved client call with a completed world effect and left several false exits with stale or absent evidence.
- Added compact block/entity/item/window snapshots and condition-based confirmation. Observable changes succeed; unobservable interactions remain explicitly requested.
- Routed empty-hand and targetless item operation through the hardened shared equipment/use primitives and replaced random sight recovery with two deterministic bounded positions.
- No interaction, runtime restart, test, build, or regression sweep was run.

## 2026-07-28 - Provider endpoint handoff
- Confirmed Bot Library preserved the selected base URL, but chat/code/vision/embedding preflight and construction discarded it by resolving bare model strings.
- Added one full-profile role resolver. The primary provider and same-provider secondary roles inherit its endpoint and shared request parameters; explicitly different providers retain only their own configuration.
- Wired that contract through preflight, provider readouts, Prompter construction, and embedding fallback. Re-read the downstream constructors to confirm the resolved URL is consumed.
- Focused syntax and diff formatting passed. No provider call, agent process, runtime restart, test, build, or regression sweep was run.

## 2026-07-28 - Truthful agent readiness
- Confirmed dashboard Spawn resolved at child-process creation, before settings/provider initialization or Minecraft login, and the pre-world Mineflayer login event was already labeled `in_game`.
- Added bounded process/bridge/login/world-ready stages. The authenticated child acknowledges readiness only after world spawn and gameplay-handler setup; only that acknowledgement resolves Spawn and sets `running`/`in_game`.
- Early exit, setup error, or readiness timeout now rejects startup with retained sanitized diagnostics, while explicit Stop and Restart retain ownership.
- Focused syntax and diff formatting passed. No child process, provider call, Minecraft connection, runtime restart, test, build, or regression sweep was run.

## 2026-07-28 - Deterministic action ownership
- Confirmed scheduler order did not survive asynchronous model/action work: any later ActionManager caller could Stop the current action regardless of whether it was autonomy, a background gesture, player work, or critical survival.
- Added owner context and one priority gate at ActionManager. Reflex, survival, player, durable job/NPC, autonomy, and background actions now declare ownership; resumable Follow/Guard retains it.
- Lower owners no longer interrupt higher work, and SelfPrompter waits without consuming its progress budgets while a higher owner is active. Operator Stop still permits only immediate self-preservation.
- Focused syntax and diff formatting passed. No action, provider call, runtime restart, test, build, or regression sweep was run.

## 2026-07-28 - Primary single-bot runtime handoff
- Created `.hermes/handoffs/2026-07-28-primary-single-bot-runtime-handoff.md` so a new task can continue in the live shared checkout without losing uncommitted work or crossing into the other agent's UI/squad/server lane.
- Recorded the five-slice plan, completed readiness and action-ownership contracts, the exact unfinished cognition edit, required file map, play/lifecycle acceptance criteria, and the no-test/no-restart boundary.
- The final cognition `handleLoad()` source-preservation edit remains installed but has not received its focused source checks, EXEC-OUT, RT-079 record, or cognition scratch entry.

## 2026-07-28 - Evidence-backed goal cognition source closure
- Closed RT-079 in source: restored goals retain `source: restored`, default autonomy cannot reseed over explicit/restored work, same-prompt resume preserves the bounded ledger, and a changed prompt resets it.
- Query/observation turns and requested server effects do not count as verified progress; only a new structured `phase: succeeded` result increments the verified-step ledger. Exact blockers and provider errors are sanitized and bounded before prompt/telemetry use.
- Persistent-job handoff and `!endGoal` still stop autonomy. The blocker label now truthfully says `Current blocker occurrences`.
- Complete cognition callers were reread. Focused syntax checks for `self_prompter.js`, `prompter.js`, `full_state.js`, and `agent.js` plus focused diff formatting passed. No provider, bot, world, restart, or test execution occurred.

## 2026-07-28 - Evidence-backed goal cognition closed in source
- Completed the restore/startup trace: restored goals retain `source: restored`, same-prompt resumption retains the bounded ledger, new prompts reset it, and default legacy autonomy now seeds only when no saved prompt exists.
- Corrected the prompt-facing counter label to “Current blocker occurrences,” matching the first-occurrence value of one.
- Confirmed structured `succeeded` is the only verified-progress source; observation/requested turns remain non-success, and persistent-job/`!endGoal` controls retain their existing loop-stop paths.
- Focused syntax checks and scoped diff formatting passed. No model/provider request, runtime start, Minecraft action, restart, or test suite ran; live proof remains deferred.

## 2026-07-28 - Lifecycle teardown source slice
- Consolidated duplicate kick/end exits through an idempotent Agent teardown boundary. It owns update and idle-resume handles, cancels resumable work, bounds prompt/action shutdown, interrupts movement, and disposes optional vision before exit.
- Focused syntax and diff-format checks passed. No live process, bot, provider, Minecraft, restart, or test suite ran; teardown behavior remains source-only evidence.

## 2026-07-28 - Core gameplay and lifecycle source completion
- Installed one shared gameplay-safety vocabulary across direct skills and durable jobs. Generic break/build refuses protected blocks; moving entities and target blocks are re-observed at arrival; downward digging verifies one safe supported landing at a time and returns failure for partial/unloaded/hazardous descent.
- Self-preservation now owns bounded drowning, falling, and burning actions with cleanup and observed outcomes. Legacy NPC build/item/controller callbacks return actual skill success, refuse destructive occupied cells, and cannot mark blocked construction complete.
- Furnace and villager interactions close their windows in `finally`; trade success requires the expected inventory gain. Spawn timeout/setup failures now use Agent teardown, death has bounded respawn-safe work cleanup, and `!endGoal` awaits shutdown.
- Focused syntax and diff formatting passed for the changed sources. Per instruction, no server, dashboard, provider, bot, Minecraft action, runtime restart, behavioral test, or suite ran; live proof remains deferred.
