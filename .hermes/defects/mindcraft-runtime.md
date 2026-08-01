# Mindcraft runtime defect log

| ID | Symptom | Root cause | Planned correction | Evidence |
| --- | --- | --- | --- | --- |
| RT-001 | Saved places are lost after restart. | `MemoryBank` is separate from persisted history. | Persist structured personal memory atomically. | `src/agent/memory_bank.js`, `history.js` |
| RT-002 | Bots can describe an action without verified physical completion. | Actions/skills return text or booleans without structured evidence. | Add normalized action results and core command verification. | `action_manager.js`, `skills.js` |
| RT-003 | Path probing never reliably selects the safe path. | Path result status is accessed before the promise resolves. | Await path probes and retain explicit route evidence. | `skills.js` |
| RT-004 | Vision can race camera initialization and retain screenshots indefinitely. | Camera readiness and screenshot retention are unmanaged. | Add a bounded vision broker. | `vision/camera.js`, `vision_interpreter.js` |
| RT-005 | User stop can be undermined by idle/reflex/self-prompt loops. | No persistent held control state. | Add a hard operator hold latch. | `agent.js`, `modes.js`, `self_prompter.js` |

## RT-006 - Path probe accessed Promise status
- Reproduction: navigation evaluated getPathTo(...).status before awaiting the promise and could select destructive behavior without a valid probe.
- Root cause: await precedence was wrong and fallback defaulted to destructive movements.
- Fix: await the path object, require success, use safe non-digging/no-tower movements, and report unreachable evidence.
- Evidence: targeted Node syntax validation passed; live pathfinding intentionally deferred.

## RT-007 - Embedding outage removed skill knowledge
- Reproduction: skill retrieval fell back to an empty embedding map and scored vector values rather than skill text.
- Root cause: fallback used skill_docs_embeddings instead of skill_docs.
- Fix: fallback ranks preserved source docs by word overlap.
- Evidence: targeted Node syntax validation passed.

## RT-008 - Explicit failed skills can be reported as complete
- Reproduction: a movement/tool skill returns `false`; the command wrapper awaits and discards it, then `ActionManager` creates a `succeeded` result because no exception occurred.
- Root cause: the action contract treats resolved Promises as success regardless of their Boolean result.
- Planned correction: preserve action return values and map an explicit `false` to `failed/skill_failed` with bounded evidence.
- Evidence: `src/agent/commands/actions.js:16-18`; `src/agent/action_manager.js:128,147-160`.

## RT-009 - Dashboard telemetry is unwired and terminal outcomes are invisible
- Reproduction: State/Inventory renderers consume `state-update`, but the browser never emits `listen-to-agents`, the only route that starts the state pump. The bot stores `last_action_result`, but `full_state` omits it.
- Root cause: subscription and action-result contracts stop at separate boundaries.
- Planned correction: subscribe on dashboard mount/reconnect, export bounded action result evidence, and mark shallow perception as unsampled.
- Evidence: `src/mindcraft/mindserver.js:1973-2073`; `src/mindcraft/public/js/agents.js:52,656-657`; `src/agent/agent.js:272-278`; `src/agent/library/full_state.js:182-190,234-239`.

## RT-010 - Lifecycle controls can acknowledge a result that never happened
- Reproduction: manual bot restart asks the child to exit with code 1 and reports success before a replacement is online; shutdown always ACKs success even if stopping fails; Stop can race Restart.
- Root cause: lifecycle operations use independent paths and optimistic acknowledgements instead of one settled state contract.
- Planned correction: lifecycle generations, operation serialization, structured partial results, and an explicit force-shutdown path.
- Evidence: `src/mindcraft/mindserver.js:1733-1747,1929-1942,958-975`; `src/process/agent_process.js:258-278`.

## RT-011 - Bedrock readiness can mean installed, not joinable
- Reproduction: Geyser/Floodgate config is unavailable before first plugin start but status can say ready from jar presence; front-page status can omit runtime readiness.
- Root cause: installed/configured/runtime/join readiness are collapsed.
- Planned correction: staged bridge readiness, bootstrap/restart configuration, one shared status predicate, and generated-config drift detection.
- Evidence: `src/mindcraft/managed-minecraft-server.js:382-399,591-605,1118-1120`; `src/mindcraft/public/js/main.js:232-238`.

## RT-008 resolution - Explicit skill failures preserve failure truth
- Fix: `runAsAction` now returns the skill's value; `ActionManager` maps an explicit `false` to `phase=failed`, a bounded `skill_*` code, retryability, target evidence, and a user-facing failed-action message.
- Guard: blank skill logs no longer become a misleading `Action output:` success detail.
- Evidence: targeted Node syntax checks passed for `actions.js`, `action_manager.js`, and `action-result.js`; live behavior remains intentionally unproven until the user requests the play check.

## RT-009 resolution - Live telemetry is subscribed, bounded, and labelled
- Fix: Bot workspace subscribes on mount/reconnect; `full_state` exposes a sanitized last action result plus a per-agent deep perception cache with `fresh`, `cached`, `stale`, and `unavailable` status. The callback-only state protocol is preserved for already-running bots.
- UI: Home fleet, Bots State, Director, Server, and Activity now consume the same structured state without treating absent telemetry as `Idle` or delivery acknowledgement as physical completion.
- Guard: deep perception refreshes at a bounded internal cadence, failures back off, and cached results retain their age/state instead of becoming empty arrays.
- Evidence: targeted Node syntax checks passed for the runtime, state pump, MindServer, and affected browser modules; no broad regression sweep or live server restart was run.

## RT-012 - Activity mixed verified outcomes with transport acknowledgements
- Reproduction: the single browser log rendered `BOT`, `DIRECTOR`, `SYSTEM`, and `SWARM` entries as visually equivalent rows, so an operator had to remember that a Director success only meant delivery was accepted.
- Root cause: the Activity surface had no source legend, filter, or outcome-focused summary despite preserving source/tone metadata.
- Fix: retain the bounded local log, add explicit source semantics, focused filters/search, local counts, and a distinct verified-outcome treatment for `BOT` rows. Clearing remains browser-local and never affects Minecraft or saved data.
- Evidence: `src/mindcraft/public/js/activity.js`, `src/mindcraft/public/js/main.js`, and `src/mindcraft/public/styles/console.css`; targeted syntax and visual inspection pending this UI-only patch.

## RT-011 partial resolution - Cross-play display distinguishes bridge and local joinability
- Fix: Home and the status rail now require `runtimeReady === true` before reporting the bridge as live, and surface “Setup needed” when the detected local Bedrock client lacks its loopback exemption. The Server hero now says whether Geyser is running instead of only installed.
- Boundary: this does not yet repair first-run Geyser configuration or the dual Retail/Preview loopback controller; those remain runtime/control-plane work.
- Evidence: `src/mindcraft/public/js/main.js`, `dashboard.js`, and `minecraft-server.js`; targeted syntax and a live UI refresh pending.

## RT-013 - Director routed player controls to a fictional player
- Reproduction: the Follow Me, Come to Me, repeat default, and sequence sample all embedded the literal player name `Director`, so a real operator's bot could be sent toward a nonexistent player.
- Root cause: Director had no explicit operator-player target even though the selected bot's structured telemetry can expose nearby human-player suggestions.
- Fix: add a manual player target, safe JSON-string command serialization, optional nearby-player suggestion buttons, and target-aware helpers for one-time, repeating, and sequence commands. No suggestion claims reachability or action success.
- Evidence: `src/mindcraft/public/js/director.js` and `console.css`; targeted syntax and visual interaction pending.

## RT-014 - Task runners could claim remote execution and false healthy work
- Reproduction: the UI offered `remote (stub)` while the executor always launched a local shell. A command returning a nonzero result was still marked active/alive, and a Pulse button looked like a meaningful health check.
- Root cause: remote location was a presentation-only stub, executor results were not treated as failure outcomes, and raw helper state was exposed without a bounded verdict/proof model.
- Fix: reject remote locations at the runtime boundary, prevent overlapping cycles, mark unsuccessful/timeout cycles as errors, expose a sanitized result verdict plus liveness source, and move manual heartbeat behind an explicit advanced warning.
- Evidence: `src/mindcraft/swarm/swarm.js`, `mindserver.js`, `public/js/swarm.js`, and `console.css`; targeted syntax and visual proof pending.

## RT-010 partial resolution - Restart, Stop, and shutdown acknowledgements follow lifecycle owners
- Reproduction: a connected bot's Restart handler emitted directly to the child and immediately returned success; the child exited through `cleanKill()` while the dashboard had no replacement-process evidence. Control-center shutdown caught `stopEverything()` failures, returned success anyway, and scheduled `process.exit(0)`.
- Root cause: both Socket.IO handlers bypassed or suppressed the existing settled lifecycle result. Separately, `AgentProcess.stop()` resolved the shared restart deferred with `null`, so a Stop racing Restart could be reported as a successful restart.
- Fix: every dashboard bot restart now awaits `Mindcraft.startAgent()`, which reuses the in-flight `AgentProcess.forceRestart()` operation. Stop rejects that shared restart result with an explicit cancellation while preserving the intentional stopping state. Shutdown replies `{ success: false, error }` and returns without scheduling process exit if stack shutdown fails. `stopEverything()` retains and reports both bot-stop and server-stop errors when both occur.
- Boundary: restart success proves replacement child spawn, not Mineflayer in-game readiness. A durable lifecycle-operation receipt and live destructive proof remain future RT-010 work.
- Evidence: Node syntax checks passed for `agent_process.js` and `mindserver.js`; `git diff --check` found no whitespace errors (only the existing MindServer CRLF normalization warning). Live destructive lifecycle proof was intentionally not run.

## RT-010 settings activation resolution - Applying settings no longer impersonates a crash
- Reproduction: the legacy Settings modal invoked `set-agent-settings`; MindServer updated its in-memory record, emitted `restart-agent` to the child, and immediately returned success. The child called `cleanKill()`, so the parent treated the exit as unexpected and could refuse recovery under uptime/restart limits.
- Root cause: settings activation delegated restart to the process being terminated instead of the process owner.
- Fix: active lifecycle states now await `Mindcraft.startAgent()` and preserve its result. Inactive/stopping states retain settings for the next explicit Start without reanimating the bot. Partial results distinguish validation rejection from settings-applied/activation-failed. The unused child restart listener was removed.
- Boundary: these legacy settings remain process-memory configuration; durable character/profile persistence belongs to the separate Bot Library lane.
- Evidence: syntax checks passed for `mindserver.js`, `mindserver_proxy.js`, and `agent_process.js`; diff inspection found no whitespace errors beyond the existing MindServer CRLF warning. No live settings application or restart was issued.

## RT-011 partial resolution - Generated Geyser config follows saved network policy
- Reproduction: live status and the actual Java command/UDP listener use `127.0.0.1:19132`, but generated Geyser `config.yml` still contains `bedrock.address: 0.0.0.0`. Runtime system properties hide the conflict only for Mindcraft-managed launches.
- Root cause: `configureGeyserFloodgate()` updated only `auth-type`; bind address and port remained Geyser defaults, and status exposed no durable-config drift.
- Fix: section-aware generated-config inspection/convergence now preserves comments and unknown settings, supports current `java` and legacy `remote` auth sections, atomically writes the saved bind/port/Floodgate values, and exposes bounded convergence evidence separately from installed/runtime readiness.
- First-start follow-through: shared readiness now waits for the Geyser listener, converges/verifies a newly generated config, performs at most one controlled restart, and requires the second listener proof before success.
- Boundary: Windows loopback and a real Bedrock join remain separate proofs; the running process was intentionally not restarted or modified.
- Evidence: read-only live inspection confirmed UDP `127.0.0.1:19132` and file drift to `0.0.0.0`; Node syntax and diff checks passed for the source change.

## RT-015 - Character customization is persisted but not activated
- Reproduction: Bot Library accepts role, job, persona, and an appearance note, while runtime behavior supports language, style, attitude, specialties, memory, vision, loadout, and limits. `normalizeBotProfile()` drops `profile.runtime`, and `botProfileToAgentSettings()` therefore cannot deliver those saved settings to the bot.
- Root cause: the profile editor/store and runtime behavior schema evolved independently without a shared identity adapter.
- Planned correction: introduce one bounded character identity contract, preserve a validated runtime v1 payload through launch, and project the same identity into prompts and telemetry.
- Evidence: `src/mindcraft/bot-library.js`; `src/agent/runtime/behavior-config.js`; `src/models/prompter.js`; `src/agent/library/full_state.js`.

## RT-016 - Squad identity collapses to a numeric login prefix
- Reproduction: every squad member name is generated as `${prefix}${index + 1}`; squad snapshots expose only the prefix/scenario, and no badge/color/motto or per-member character identity survives orchestration.
- Root cause: squad launch treats the Mineflayer login name as both stable process identity and all user-facing identity.
- Planned correction: keep collision-safe Minecraft login names separate from bounded display identity, attach stable instance/squad metadata to member settings and snapshots, and support preferred themed names with numeric fallback.
- Evidence: `src/mindcraft/bot-squad-manager.js:26-27,230-267`; `src/mindcraft/squad-scenario-store.js`; `src/mindcraft/squad-orchestrator.js`.

## RT-015 resolution - Saved character customization reaches the runtime
- Fix: Bot Library normalization now preserves a validated runtime v1 payload and a bounded character identity while keeping provider/connection fields and the stable Minecraft login separate. Runtime prompts, behavior, and full-state telemetry consume the same normalized identity.
- Guard: personality changes wording and priorities only; authoritative game state and structured action results remain the source of world truth.
- Evidence: focused syntax checks passed for the runtime, Bot Library, prompt, telemetry, and browser editor modules; the Character Identity editor and Knight preset were inspected at the primary viewport. No profile was saved or bot restarted.

## RT-016 resolution - Squads retain themed team and member identity
- Fix: scenarios, manual launches, persistence, and snapshots now retain a bounded team name, badge, color, motto, naming policy, and optional roster. Themed, role-derived, custom, and numeric member names are generated as unique Minecraft-safe logins while friendly identity remains separate metadata.
- Guard: existing numeric-prefix launches and legacy scenarios still normalize through safe defaults; stable member/squad IDs are allocated before launch.
- Evidence: focused syntax checks passed for the squad store, orchestrator, manager, Bots UI, and Dashboard UI; the expanded Team Identity & Custom Roster controls were inspected without launching a squad.

## RT-017 - A transient state timeout destroys useful operator evidence
- Reproduction: `collectAgentStates()` replaces a bot's complete previous state with `{ error: "state request timeout" }` on any late acknowledgement. The next dashboard render loses position, activity, health, inventory, threats, team, and action outcomes even though the last sample remains operationally useful.
- Root cause: the state pump is stateless and has no distinction between current transport health and the age of last authoritative game evidence.
- Planned correction: retain the unmodified last-good sample per active connection, overlay bounded transport freshness/error metadata on delivery, and clear the cache when the authenticated socket changes.

## RT-018 - Concurrent completion order defeats state deduplication
- Reproduction: worker results are appended on completion, so identical multi-bot samples can produce different object key order. `JSON.stringify()` then reports a different fingerprint and broadcasts an unchanged fleet.
- Root cause: concurrency ordering leaks into serialization ordering.
- Planned correction: write each result into its original target index before building the state map; keep volatile timestamp fields outside the semantic fingerprint.

## RT-019 - Child bridge connection and acknowledgement waits are not bounded safely
- Reproduction: concurrent `connect()` calls can create competing sockets; failed connection listeners remain attached; `sendSquadRadio()` can wait forever when its acknowledgement is lost; output/chat helpers throw when the socket disappears.
- Root cause: the proxy tracks only a connected boolean, not the in-flight connection lifecycle, and best-effort sends assume a live socket.
- Planned correction: share one bounded connection promise, dispose failed sockets/listeners, cap acknowledgement waits, and return explicit false/failure results for disconnected best-effort sends.

## RT-017 resolution - Transient telemetry failures preserve honest last-good state
- Fix: the sampler caches the unmodified last successful state per authenticated connection. Timeout, invalid response, and disconnect results return that evidence with bounded `_meta.transport` `stale` or `backoff` status/error/age rather than falsely blanking the operator readout. Login, logout, socket replacement, and unregister clear the cache.
- Guard: healthy samples retain their exact legacy state shape; only a degraded transport gains the server-owned overlay. The UI now labels bridge delay/backoff across Home, Bots, Director, and Server.
- Evidence: focused syntax and diff/whitespace checks passed; live activation deferred.

## RT-018 resolution - State publication is deterministic and listener-efficient
- Fix: concurrent state responses are stored at their stable sorted target index before `Object.fromEntries`, semantic fingerprints omit only volatile timestamps, and subscribed dashboard sockets share one Socket.IO volatile room. A second subscriber receives the current sample immediately; clearing the final listener clears cached broadcast state.
- Guard: state collection remains bounded by the configured concurrency limit and listeners remain explicit dashboard-only subscriptions.
- Evidence: focused syntax and diff/whitespace checks passed; no live multi-tab session was created.

## RT-019 resolution - Agent bridge lifecycle is bounded and disconnect-safe
- Fix: a child shares one 5-second connection operation, gets the initial agent-status event before connection completion, registers with MindServer only after its Agent object exists, disposes failed sockets, and bounds squad-radio acknowledgements. Chat and output now return false instead of throwing after disconnect and are capped to server limits before transport.
- Guard: agent capability authentication and callback-based full-state protocol remain unchanged.
- Evidence: focused syntax and diff/whitespace checks passed; no live bot bridge was restarted.

## RT-020 - Runtime memory can silently disappear behind an I/O failure
- Reproduction: `PersonalMemory.load()` used `existsSync()` before parsing. Node returns `false` for inaccessible paths, so a permissions or I/O failure was indistinguishable from a missing first-start file and the bot received a blank memory state without an actionable error.
- Root cause: presence probing collapsed absence and operational failure before the code's corrupt-data recovery boundary could classify the error.
- Fix: use the authoritative `statSync`/read path, treat only `ENOENT` as clean absence, quarantine only malformed/oversize JSON, and propagate every other filesystem error with the bot name. Empty first-start loads now return the same cloned state boundary as loaded files.
- Evidence: `src/agent/runtime/personal-memory.js`; `node --check`, focused diff/whitespace checks passed. No bot data was modified, no bot restarted, and no broad suite ran.

## RT-021 - Squad durability failures are invisible to the operator
- Reproduction: `BotSquadManager.persist()` builds the serializable record outside its `try`, then suppresses every atomic-write error. `loadPersisted()` also catches every failure and returns an empty manager. A squad can therefore work in this process but disappear after restart with no dashboard-visible warning.
- Root cause: persistence is intentionally non-owning of bot lifecycle, but the code represented that boundary as silent failure rather than a partial, observable result.
- Fix: manager persistence now wraps record construction and atomic write, separately classifies first-start absence, read/parse/semantic-record failure, and write failure, and never overwrites a file it could not read or fully restore. A bounded status flows through existing squad snapshots, list responses, action results, activity notices, and squad cards.
- Guard: lifecycle effects remain truthful—an already-started/stopped/removed squad is not falsely rolled back because disk persistence failed. The card and action notice distinguish an in-session success from restart durability.
- Evidence: focused syntax and scoped tracked-diff checks passed for the manager, MindServer, and Bots workspace. No bot/server restart, saved squad action, or broad suite ran.

## RT-022 - Gameplay skills can fail while commands claim success
- Reproduction: `ActionManager` correctly treats an action callback resolving `false` as a failed structured result, but most `runAsAction` command callbacks only `await skills.*()` and return `undefined`. A missing tool, unreachable path, lost player, or failed placement therefore arrives at the dashboard as `completed`.
- Root cause: the command boundary discards the existing boolean skill contract before `ActionManager` evaluates it.
- Fix: every wrapped movement, follow, inventory, tool, gather, craft, smelt, interaction, combat, villager, digging, and surface command now returns its terminal skill result. The composite discard action snapshots its origin, stops at a failed retreat/discard, and returns its verified return result; absent saved places explicitly fail.
- Guard: success action output remains unchanged; only a skill's pre-existing `false` reaches the already-implemented structured failed result path. Existing action labels, command syntax, resume behavior, and skill APIs remain intact.
- Evidence: `node --check` and scoped `git diff --check` passed; static scan found no direct `await skills.*` statement that discards a result inside `actions.js`. Existing unrelated trailing whitespace lines were preserved. No live bot action or broad suite ran.

## RT-023 - Follow and reflex movement can claim progress without proof
- Reproduction: `moveAway()` returns true after ignoring `goToGoal()`'s false result; `moveAwayFromEntity()` and `avoidEnemies()` use unrestricted direct pathfinder paths and return true without arrival/distance verification; `followPlayer()` can return true while a visible target stays out of reach indefinitely.
- Root cause: the primary `goToGoal()` path was hardened, but several follow/retreat/reflex wrappers bypassed it or treated a running pathfinder goal as completed movement.
- Planned correction: make natural safe traversal explicit, route direct reflex/retreat movement through safe proof-aware behavior, and bound follow no-progress recovery before emitting a truthful stuck/lost result.
- Evidence: `src/agent/library/skills.js:15-24,387-429,1131-1542`; `src/agent/modes.js:151-238`.

## RT-023 resolution - Movement, follow, retreat, and combat carry verified outcomes
- Fix: natural traversal now explicitly permits sprinting, parkour, and doors while defaulting to no digging/towering. Follow clamps unsafe zero-distance requests, identifies a missing/lost player, retries bounded safe paths, and ends with a non-retrying `stuck` result rather than silently resuming forever. Retreat/avoid paths use the proof-aware safe route, verify distance, bound threat recovery, and distinguish `unreachable`, `blocked`, `no_progress`, `too_close`, `threat_persists`, and `teleport_requested`.
- Fix: action results preserve a successful skill outcome code and honor a skill's explicit non-retryable result when deciding whether a resumable action may run again. A one-hit attack now reports target/reach/attack truth instead of resolving `undefined` as success.
- Guard: cheat mode reports a teleport request rather than verified arrival; no live teleport, movement, bot, Paper, or Geyser process was invoked.
- Evidence: focused Node syntax and scoped diff/whitespace checks passed for `skills.js`, `action_manager.js`, and command wiring.

## RT-024 - Attention/reflex loops can restart failure or report fake recovery
- Reproduction: a self-prompt counts any command as progress even when the action failed, resets that budget when its loop restarts, and can retain active-looking state after an operator-held load. Mode wrappers discard false skill results; bounded unstuck recovery treats `moveAway() === false` as moved; natural-language movement directives do not reliably release the explicit Stop hold.
- Root cause: attention, reflex, and player-directive layers each had a local boolean/cleanup contract but did not preserve it across their scheduler boundary.
- Fix: self-prompting now has hold-safe start/load behavior, persistent verified-progress accounting, terminal-result stop, exception-safe loop cleanup, and no self-stop deadlock. Reflex execution returns underlying outcomes, false unstuck movement becomes a failed recovery, and a short bounded retry backoff prevents failure thrash. Player directives explicitly mark whether they can release Stop; status/inventory/look requests remain observational, while real follow/come/work/stay orders can intentionally resume. `guardPlayer` follows a named player with self-defense enabled.
- Guard: manual Stop stays held until a genuine new goal or behavior command; while held only immediate self-preservation remains eligible. No behavior-tree rewrite, live action, or broad suite ran.
- Evidence: focused Node syntax and scoped diff/whitespace checks passed for self-prompter, modes, directives, agent, action, and movement modules.

## RT-025 - Tool, collection, building, and transfer skills can act without verified prerequisites
- Reproduction: collection can ignore a failed approach; pickup always returns success; breaking/building uses unverified/raw movement and can resolve without a postcondition; normal bucket placement falls through without a return; player handoff can dereference a missing player or miss its own collection event.
- Root cause: several gameplay helpers were written as direct Mineflayer calls with local logs rather than one bounded material/inventory/reachability/verification contract.
- Fix: collect, pickup, break, place, equip, tool-use, farm/activate, and give paths now surface exact material/tool/inventory/support/target/reachability outcomes, use safe navigation, and verify normal world results before success. Cheat mutations report requested commands rather than verified world completion.
- Guard: no server plugin or automatic world editing was introduced. Existing Mineflayer skills and command syntax remain the action authority; no live world, inventory, player, or process was touched.
- Evidence: focused Node syntax, scoped diff/whitespace, and static movement-return scans passed for the touched runtime modules.

## RT-026 - Vision can race initialization, overload the provider, and falsely complete
- Reproduction: Camera begins initialization asynchronously but capture has no readiness wait/error surface; concurrent look commands can render/capture in parallel; screenshots have no retention bound; disabled/model/capture failures return prose while command actions resolve `undefined` success.
- Root cause: vision was a thin screenshot helper rather than a bounded request boundary connected to the structured action-result contract.
- Fix: Camera now exposes a readiness/error promise and recursive storage/retention. VisionInterpreter owns profile-derived rate limits, one in-flight request, sanitized structured failures, and a structured-sensing fallback. Explicit look commands return the actual vision outcome to ActionManager; image analysis is labeled non-authoritative beside canonical Minecraft sensing.
- Guard: model vision stays explicit/on-demand. It cannot replace position, entity, block, hazard, inventory, or action-result state. No camera, model, screenshot, or bot action was invoked during this code slice.
- Evidence: focused Node syntax and scoped diff/whitespace checks passed.

## RT-027 - Gameplay knowledge disappears when embeddings are partial or fail later
- Reproduction: a partial embedding initialization leaves a partial doc map; `select_num === -1` reads only that partial map; later query embedding failures throw through prompt construction instead of falling back to the complete gameplay-doc corpus.
- Root cause: the lexical fallback covered only initialization failure and did not establish an all-or-fallback corpus invariant.
- Fix: skill-doc initialization now accepts all valid embeddings or clears them entirely. Query failures/invalid vectors disable embeddings once and rank every available gameplay doc deterministically with lexical overlap while retaining core safety docs.
- Guard: no provider retry loop or filesystem vector cache was added; gameplay knowledge remains usable offline and no model request was issued to validate this source correction.
- Evidence: focused Node syntax and scoped diff/whitespace checks passed for skill-library and adjacent runtime code.

## RT-028 - Defender and Guard can flee before their combat reflex runs
- Reproduction: `cowardice` is scheduled before `self_defense`, and both interrupt every action. A profile marked Defender/Attacker, or a bot actively executing `guardPlayer`, can therefore begin fleeing from the first visible hostile before its self-defense mode receives a turn.
- Root cause: role configuration reaches prompt and telemetry, but the generic reflex scheduler had no narrow threat-priority policy.
- Fix: centralize scheduler suppression reasons; only Defender, Attacker, and an active explicit Guard order suppress `cowardice`. Immediate self-preservation stays first, manual mode off settings are preserved, and structured mode telemetry names the hold/autonomy/role reason.
- Guard: no global ordering change and no new combat behavior tree. Legacy companions retain their existing flee-first behavior unless explicitly guarding.
- Evidence: `src/agent/modes.js`; source/diff inspection completed. No bot, server, combat, or live world action was issued.

## RT-029 - Passive mobs are classified as hostiles and defense can loop without proof
- Reproduction: Mineflayer reports passive and hostile living entities as `type: mob`; the old `isHostile()` therefore marked a cow or sheep hostile. `defendSelf()` then used an unbounded direct PvP loop with ignored path failures and no terminal evidence.
- Root cause: entity type was mistaken for disposition, and the reflex bypassed the proof-aware one-hit combat helper.
- Fix: use a conservative known-hostile registry that also preserves the iron/snow-golem non-target guard, classify boss-level threats as avoid-only, expose disposition in full state, and make self-defense use bounded proof-aware attack attempts with a failure budget, interruption cleanup, and precise terminal outcome.
- Guard: passive/neutral entities are not automatically attacked; explicit user-targeted attack commands keep their existing authority. No live combat was initiated.
- Evidence: `src/utils/mcdata.js`, `src/agent/modes.js`, `src/agent/library/skills.js`, `src/agent/library/full_state.js`; source/diff inspection completed.

## RT-030 - Attention and dialogue state cannot be distinguished from an idle bot
- Reproduction: full state exposed a coarse activity label, but not whether a saved goal was working/paused/held, whether its no-progress budget was being consumed, or whether conversation/mute state explains the apparent pause.
- Root cause: SelfPrompter keeps the relevant lifecycle state locally; full-state telemetry did not project it.
- Fix: record bounded turn/progress timestamps and publish non-secret attention and dialogue state. Raw goal text and chat history remain private and are not sent in state.
- Guard: telemetry adds only operational booleans, counts, timestamps, and bounded player names; it does not add model prompts, conversation content, or provider credentials.
- Evidence: `src/agent/self_prompter.js`, `src/agent/library/full_state.js`; source/diff inspection completed. No runtime connection was made.

## RT-031 - Cheat navigation states server command delivery as verified arrival
- Reproduction: `goToPosition()` and `goToPlayer()` send `/tp` then log that the bot teleported, before a position packet can confirm the server accepted the command.
- Root cause: cheat movement predated the structured action-evidence contract.
- Fix: report `teleport_requested` with the target and waiting language; later structured position state remains the authority for actual arrival.
- Guard: the command is still sent when cheat mode is enabled; no teleport was issued during this code change.
- Evidence: `src/agent/library/skills.js`; source/diff inspection completed.

## RT-032 - Concurrent dialogue delivery can spam, overflow, or die on translation failure
- Reproduction: behavior narration, action responses, and model dialogue can call `openChat()` concurrently. Translation errors reject the whole call, and unbounded/newline-rich text can be passed directly to Minecraft chat.
- Root cause: delivery was a direct side effect with no per-bot ordering, pacing, input boundary, or translation fallback.
- Fix: serialize each bot's outgoing chat, apply a small delivery gap and safe Minecraft-length cap, normalize control/newline characters, send original text when translation fails, and isolate whisper/speech/in-game-chat failures so a remaining output route can still report the bot's message.
- Guard: existing whisper, speech, normal in-game chat, and MindServer-output routing remain intact. Messages are paced, not dropped; no chat was sent during this change.
- Evidence: `src/agent/agent.js`; source/diff inspection completed.

## RT-033 - Manual Stop can kill and auto-restart an uncooperative bot
- Reproduction: `!stop` calls `ActionManager.stop()`. If a pending action does not yield within ten seconds, its watchdog calls `cleanKill()` with an unexpected exit code. The parent can then classify it as a crash and restart it, losing the non-persisted operator hold.
- Root cause: process termination was used as an in-process cancellation mechanism, with no bounded held/unresponsive result and no block against a competing new action.
- Fix: Stop now returns a bounded outcome, leaves the bot explicitly held on timeout, blocks new actions with a structured non-retryable result, avoids fast-loop counting before stop resolution, replaces the rapid-action `cleanKill()` with the same explicit hold, and exposes stop timestamps in full state.
- Guard: cooperative actions still stop normally. A genuinely wedged bot remains visible and requires an explicit operator restart; no Stop/restart was sent during this code change.
- Evidence: `src/agent/action_manager.js`, `src/agent/commands/actions.js`, `src/agent/library/full_state.js`; source/diff inspection completed.

## RT-034 - Operator readouts and direct dialogue can overstate bot control
- Reproduction: full-state telemetry already emits bounded attention, dialogue, verified action-target, and manual Stop timeout state, but Bot, Home, Director, and Server surfaces reduced it to generic activity/held text. The Bot chat pane added an operator message and recorded “command sent” before MindServer accepted the relay; the server handler returned no acknowledgement for a missing socket, invalid message, or relay exception.
- Root cause: the runtime contract and presentation contract evolved separately, and direct dialogue bypassed the dashboard's existing acknowledgement convention.
- Fix: add shared legacy-safe labels for control, attention, dialogue, verified target, and Stop recovery; consume them through the four existing readouts; return `{ success, error }` from the existing `send-message` relay and append local chat history only after relay acceptance.
- Guard: labels expose no raw goal, prompt, private conversation, or provider information. Relay acceptance remains explicitly distinct from bot action completion; no bot or server process was contacted.
- Evidence: `src/mindcraft/public/js/{utils,agents,dashboard,director,minecraft-server}.js`, `src/mindcraft/mindserver.js`; source inspection only, visual/live proof deferred by user instruction.

## RT-035 - A prior autonomous goal can fight a new direct player order
- Reproduction: `Agent.handleMessage()` routes explicit `!command` input and resolved player directives directly to `executeCommand()` before returning. Those paths bypass the existing self-prompt coordination used only for model-generated commands, so an active goal can later restart and reissue work after a player says follow, stay, navigate, gather, attack, or uses the dashboard command field.
- Root cause: action ownership was implicit in call-path ordering rather than encoded in the shared world-skill wrapper.
- Fix: `runAsAction()` now marks world-skill wrappers as direct manual-autonomy takeovers. The command registry exposes that metadata; Agent interrupts the old self-prompt state immediately before explicit/directive execution; SelfPrompter's nonblocking handoff stops goal scheduling without calling `ActionManager.stop()` and its interrupt predicate applies even after state changes to stopped.
- Guard: queries, configuration, conversation, and vision commands retain their existing non-takeover paths; `!goal` still starts a new goal and `!stop` still owns the hard hold. The new player action is not delayed behind or cancelled by self-prompt cleanup.
- Evidence: `src/agent/{agent,self_prompter}.js`, `src/agent/commands/{actions,index}.js`; source inspection only, with no bot/world/model/test execution.

## RT-036 - Server mutation requests are reported as completed world actions
- Reproduction: cheat-mode teleport and setblock helpers set evidence such as `teleport_requested` or `setblock_requested`, then return `true`. ActionManager converted every non-false return to `phase: succeeded`, and action-result validation had no state between requested and completed. The dashboard could therefore show a completed action before a Minecraft position/block update existed.
- Root cause: an asynchronous server-side request shared the same boolean success channel as a verified Mineflayer world action.
- Fix: add the explicit `requested` phase to the structured action contract. Cheat helpers mark `completion: requested`; ActionManager projects that evidence as requested rather than succeeded; messages/telemetry preserve it; SelfPrompter stops autonomous work pending verification instead of counting it as progress or describing it as an ordinary failed skill.
- Guard: failed, blocked, interrupted, and completed results preserve their original phases. Requested effects do not auto-retry, and later authoritative Minecraft state remains the only proof of teleport/build completion.
- Evidence: `src/agent/{action_manager,self_prompter}.js`, `src/agent/runtime/action-result.js`, `src/agent/library/skills.js`; source inspection only, with no server command, world mutation, bot, build, or test execution.

## RT-037 - Scenario role is dropped and no runtime owns gameplay
- Reproduction: launch the built-in Builder Brigade, inspect the persisted member settings, and compare the squad scenario (`behavior: builder`) with each member profile. The member profiles contain persona and identity but no `runtime`; the live agent therefore normalizes to `companion + balanced`.
- Root cause: scenario behavior was dispatched later as chat commands but was never part of the durable bot-runtime handoff. When the small local model stopped self-prompting without a verified command, no scheduler owned the next gameplay action.
- Fix: scenario launch now supplies role/autonomy/leader/formation, member construction deep-merges it without erasing saved runtime limits, and persisted pre-fix squads receive the same bounded migration on load. A RoleDirector dispatches deterministic follow, guard, scout, and resource-work commands through the existing ActionManager path with startup, manual-control, target, success, and failure backoff guards.
- Guard: command-only profiles never self-start; operator Stop remains absolute; a direct player world action defers role scheduling for two minutes; only combat-safe hostiles are eligible for the new direct hostile-engagement command.
- Evidence: current source and persisted runtime state only. No gameplay or regression test was run at operator request.

## RT-038 - Launcher restart drops active squads while claiming their names were resumed
- Reproduction: restart with MindcraftBot plus the active five-member Builder Brigade. The handoff returned all six names in `resumeAgentNames`; the replacement `/api/agents` contained only MindcraftBot.
- Root cause: `main.js` resumes only configured launcher profiles. Squad member settings belong to persisted `BotSquadManager` records, but the restart marker flattened squad members into standalone profile names and never called `BotSquadManager.start(id)` in the replacement process.
- Fix: the handoff now captures active squad IDs separately, excludes their members from launcher-profile names, quiesces through the squad manager, passes a bounded restart plan, and lets the replacement MindServer resume persisted squads through a private owner-scoped control method. Early failure always runs gameplay restoration even if HTTP never stopped listening.
- Guard: stopped squads are absent from the plan and stay stopped; partial squad starts are failures rather than successful resumes; each replacement resume has a 60-second settlement bound; the HTTP response labels restoration as requested.
- Evidence: source path inspection, persistent source console on port 8080, and an accepted start request for the previously dropped Builder Brigade. Final member/gameplay state remains for the operator visual pass; no regression suite ran.

## RT-039 - Reusable bot setup hides the safe path inside an exhaustive editor
- Reproduction: open Bot Profiles and create a reusable character. The editor presents identity decoration, memory, vision, four model slots, endpoint, and connection controls as equal-priority requirements. A new profile also defaults to port `25565` even when the server catalog reports a different effective Minecraft target.
- Root cause: the browser fetched server-issued defaults but discarded them, and the original editor had no distinction between deployment-critical fields and optional customization.
- Fix: retain catalog defaults, prefill the effective provider/model/host/port, keep the deployment-critical fields visible, group advanced character/runtime/provider controls behind named disclosures, and expose a single Save & Deploy action that reports accepted versus failed deployment.
- Guard: all prior settings remain editable and the persisted profile schema is unchanged. Credentials stay server-side; the browser receives only presence/readiness status.
- Evidence: live source-console DOM and visual inspection before the change. Post-change visual inspection is pending; tests remain intentionally deferred.

## RT-040 - Persisted squads restart against a dead managed-server port
- Reproduction: run the managed Java world at `127.0.0.1:25579`, then resume the persisted Builder Brigade. Every member retains `port: 25578`, enters a network-timeout failure, and can be repeatedly restarted against the same dead target.
- Root cause: managed-server wiring updates launcher defaults, but persisted squad members own complete cloned settings and the squad restart path reused those settings without reconciling the current authoritative managed target.
- Fix: BotSquadManager now prepares settings at the create/restart boundary. MindServer supplies the running managed target and refreshes the registered AgentConnection before restarting an existing member; the existing persistence path records the reconciled settings.
- Guard: only a currently running, installed, loopback managed server is authoritative. When no such target exists, saved external-server settings pass through unchanged.
- Evidence: live API/persisted-state inspection followed by the requested source-console restart. All five Builder Brigade records migrated from `25578` to the running managed target `25579`, and all five agent lifecycle owners report `running`. No gameplay command, provider call, build, or test suite was run.

## RT-041 - Autonomous work roles repeat local collection failure without searching
- Reproduction: run a Builder where no safe log is inside the collection scan. RoleDirector dispatches `!collectWood`, receives `skill_not_collected`, waits, then dispatches the same command from the same position. The bot is online and autonomous but makes no progress.
- Root cause: role intent selection had only work and cooldown states. It did not interpret the structured retryable `not_collected` result as a need to relocate before retrying.
- Fix: Builder, Lumberjack, and Miner roles now enter a bounded resource-search phase after `skill_not_collected`. Each relocation uses the existing verified movement command, reports recovery state through RoleDirector telemetry, rescans after arrival, and honors the profile recovery-attempt limit and a cooldown after exhaustion.
- Guard: missing tools, full inventory, unsafe/unreachable targets, operator Stop, and direct-command grace do not become blind search movement. No new behavior tree or unbounded wander loop was added.
- Evidence: live Director readout plus source call-path inspection. Final activation reports `action:moveAway` and `builder · acting · resource search`, with current position telemetry changing during the bounded recovery.

## RT-042 - Busy bots never establish the first live telemetry sample
- Reproduction: restart with five autonomous squad members. All five reach the Java world, but their initial full-state callbacks exceed the configured 1.2-second request timeout. With no last-good cache yet, the dashboard repeatedly shows `state request timeout` instead of location, health, targets, and action outcomes.
- Root cause: transport degradation correctly preserves a last-good state, but the request budget was static and provided no larger cold-start window or learned response-latency floor.
- Fix: each AgentConnection now gets a bounded cold-start request budget, records successful response duration, and uses the larger of configured, learned, and failure-expanded budgets for future requests.
- Guard: the 30-second hard cap, failure backoff, concurrency limit, duplicate suppression, and configured healthy timeout remain intact. The adaptive state resets when the agent socket changes.
- Evidence: live five-bot startup plus source inspection. Activation established five current samples and a complete sampling cycle with zero failed cycles; an intentionally removed extended block scan later confirmed why bot-thread work must remain bounded.

## RT-043 - Dashboard hides role recovery as initialization or Stop
- Reproduction: emit a RoleDirector state such as `recovering/searching_for_resources` or `waiting/resource_search_exhausted`. Full state either falls through to “Stopped” or labels every waiting state “Role initializing,” hiding the real autonomous-work condition.
- Root cause: activity presentation handled only the original waiting/suppressed/failed phases and did not preserve the scheduler's expanded structured state.
- Fix: full-state activity now maps startup, player wait, resource search, relocation, exhaustion, active role work, and completed cycles separately. Director also displays the bounded role scheduler phase/code/target beside the verified action result.
- Guard: the labels consume structured runtime state only; no log parsing or claimed completion was added.
- Evidence: live Director now distinguishes `Searching for resources`, `Rescanning new work area`, `Resource search paused`, and the active `action:moveAway` recovery state.

## RT-044 - Resource recovery burns its budget inside the previous scan radius
- Reproduction: a Builder or Lumberjack receives `skill_not_collected`, then relocates 18 and 24 blocks while `collectWood` already scans a 64-block radius. Both follow-up collection attempts mostly inspect the same area and the bot enters `resource_search_exhausted` without materially exploring.
- Root cause: the recovery step size was selected independently from the underlying skill's search radius.
- Fix: define the resource scan radius at the RoleDirector boundary and use terrain-aware bounded exploration before the next normal-radius skill scan.
- Guard: the existing safe coordinate pathfinder, profile recovery-attempt cap, operator Stop, direct-command grace, structured movement result, and exhaustion cooldown remain unchanged.
- Evidence: source call-path inspection and live activation. Fixed distant coordinates at the current Y level returned `skill_unreachable`, proving guessed geometry was not a reliable fallback; the fallback now delegates reachable terrain choice to the existing pathfinder.

## RT-045 - Wood navigation and collection disagree about the target
- Reproduction: resource recovery finds and reaches a nearby `birch_log`, then `collectWood` calls `collectBlock` and reports no birch log collected from the same position.
- Root cause: `collectWood` selected the nearest wood block without the safety predicate; `collectBlock` independently selected only `safeToBreak` blocks of that one wood species. An unsafe nearest log could hide other collectible wood and make navigation target a block collection would reject.
- Fix: centralize a bounded `findNearestCollectibleBlock` selector and use it for both wood choice and RoleDirector recovery targets. When no safe wood exists, preserve `not_collected` evidence so the scheduler can distinguish a recoverable resource miss from tool, inventory, and execution failures.
- Guard: the selector uses the existing non-destructive movement safety policy, caps search range at 512, and does not weaken tool, inventory, reachability, or post-break verification.
- Evidence: live Director showed a verified arrival at `birch_log at -154, 78, -84`, immediately followed by `skill_not_collected`; the first aligned-selector activation truthfully reported no safely collectible trees but exposed a generic-result fallback. Source call-path inspection identified and preserved the missing structured evidence.

## RT-046 - Extended resource lookup starves live telemetry
- Reproduction: after startup, RoleDirector performs a synchronous 192-block `findBlocks` scan during recovery. The selected bot stays in game, but repeated full-state requests time out and the Director loses its readout.
- Root cause: the recovery lookup expanded a synchronous cubic world scan instead of moving first and reusing the skill's normal bounded scan.
- Fix: remove the extended scan. Recovery now performs terrain-aware bounded movement, then the existing 64-block safe collection scan.
- Guard: no background scan, unbounded search, guessed coordinate, or extra telemetry owner is introduced.
- Evidence: live Director transitioned from current samples to repeated `state request timeout` immediately after the extended scan activation; the expensive lookup was removed.

## RT-047 - Bedrock configuration is presented as a verified playable join
- Reproduction: enable the Windows loopback exemption while Paper, Geyser, and Floodgate report running. The Server connection badge changes to `Ready on this PC` even though no Bedrock client has joined and the control plane has no join-verification state.
- Root cause: plugin presence, converged configuration, Geyser startup, Floodgate auth mode, and Windows loopback were collapsed into one readiness boolean.
- Fix: observe an actual Floodgate-prefixed player join in the authoritative Paper log, reset that observation for every Java runtime, expose bounded `crossplay.joinVerification`, and render `Configured · test join` until a real Bedrock join occurs.
- Guard: Java bot joins cannot satisfy the verifier; no synthetic UDP probe is called a playable connection; usernames are bounded and no IP or credential is exposed.
- Evidence: live pre-change API reports all server/bridge layers separately but has no join-verification field. Source implementation is complete; backend activation is deferred while another agent has ten live bots and an active second squad.

## RT-048 - Resource collection can silently restore unsafe movement and report a swallowed path stop as success
- Reproduction: run an autonomous Builder or Lumberjack against a selected tree while movement is interrupted or no safe route completes. `mineflayer-collectblock` installs its own default `Movements`, catches `PathStopped`, and resolves. Mindcraft then increments `collected` without checking the selected block or inventory. Other path failures are caught, retried against the same nearest target inside one command, and ultimately overwritten as generic `skill_not_collected`.
- Root cause: Mindcraft validated the target with `safeMovements` but did not configure the movement instance the plugin actually consumes, and Promise resolution was treated as verified collection rather than an untrusted adapter result.
- Fix: inject Mindcraft's non-destructive movements into the plugin, validate exact drop-compatible inventory capacity, verify that the selected block changed and its drop entered this bot's inventory, classify bounded collection errors, and preserve specific zero-progress evidence. RoleDirector now relocates only for retryable local collection/path blockers and never converts tool, capacity, non-dropping-block, hold, or interruption failures into blind wandering.
- Guard: the installed collection plugin and action-result schema remain intact; recovery still uses the existing attempt budget/cooldown and operator/manual-command boundaries. No process restart, bot action, server mutation, model call, build, lint, or regression suite was run.
- Evidence: live ten-bot Dashboard showed `skill_not_collected`, `skill_unreachable`, and exhausted resource search; installed plugin source confirms movement replacement and swallowed `PathStopped`; final source inspection confirms guarded movements and postconditions. Runtime activation is deferred to preserve the concurrent ten-bot session.

## RT-049 - Survival job roles know a tool is missing but have no way to prepare one
- Reproduction: start an autonomous Miner without a pickaxe. RoleDirector dispatches cobblestone collection, collection returns `skill_missing_tool`, and the scheduler later repeats the same impossible job. A Lumberjack similarly never upgrades from hand collection even though verified collect/craft/equip skills already exist.
- Root cause: role selection jumped directly from identity to the final job command. Tool readiness was a collection preflight result but not a gameplay stage owned by any runtime component.
- Fix: add a bounded `prepareWoodenTool` composite over the existing verified wood collection and crafting skills. It reuses/equips the strongest available tool family or survival-crafts planks, sticks, a table, and a wooden pickaxe/axe with bounded conversion attempts and verified equip. Miner and Lumberjack intents request preparation only while their tool family is absent.
- Guard: no item spawning, creative inventory, provisioning bypass, recursive arbitrary crafting, second scheduler, or hidden retry loop was added. Intermediate collection/craft failures remain the final structured action evidence, so the existing resource relocation boundary can react only when appropriate.
- Evidence: current source shows `craftRecipe` verifies materials/table/output and RoleDirector previously had no preparation intent. Final source inspection covers the skill, command wrapper, and role selection. Live activation remains deferred to preserve the concurrent ten-bot runtime.

## RT-050 - Attacker and Defender collapse to the same endless guard behavior
- Reproduction: spawn an Attacker and Defender with the same visible leader. RoleDirector sends both to `!guardPlayer`; the resumable follow action owns the role indefinitely. Attacker never emits an explicit combat target/action and can appear identical to a generic escort.
- Root cause: the role preset changed the label but not the control mechanism. Combat existed only as an implicit self-defense reflex, so the role scheduler could not own, report, or re-evaluate Attacker gameplay.
- Fix: split Companion, Defender, and Attacker intent selection. Attacker scans only with the canonical combat-safe predicate, dispatches the existing bounded `!attackHostile` action when eligible, uses finite regroup near a leader otherwise, and performs a small safe cardinal patrol when alone. Defender remains continuous guard with self-defense. A target that disappears before dispatch becomes a short `combat_target_gone` retry.
- Guard: neutral/huntable mobs, golems, players, and avoid-only bosses are excluded; the existing combat range/swing/failure/interrupt cleanup remains authoritative. Continuous-follow detection now keys on follow/guard behavior rather than the role label, preventing a combat result from being hidden as active movement.
- Evidence: source inspection of `mc.isCombatSafeHostile`, `skills.defendSelf`, `!attackHostile`, and final RoleDirector intent/result lines. No bot action, server mutation, restart, build, lint, or regression suite was run.

## RT-051 - Bot dialogue can pause gameplay forever and orphan response timers
- Reproduction: start bot-to-bot dialogue while one or both bots are busy, or send a bot-authored squad status radio. Conversations have no turn/duration cap; response waits double indefinitely; the both-busy branch can schedule no callback; `reset/end` null timer references without cancelling them; radio can mark a conversation active without assigning an active owner/monitor. A goal remains paused until an explicit end that may never occur.
- Root cause: conversation state tracked only `active` and an unowned timer. Attention budget, relay outcome, queued-message bounds, busy deferral, pause provenance, and terminal reason were absent.
- Fix: add normalized per-profile conversation turn/minute limits, per-conversation deadline/turn/deferral/reminder state, owned timer cancellation, bounded queue/compiled input, capped response reminders, bounded busy polling, relay-failure closure, null-safe end/end-all, and one owned goal-resume timer. Status radios become history-only unless already part of a real dialogue. Explicit goals saved during dialogue mark their resume provenance.
- Guard: only goals paused by dialogue—or explicitly deferred with `!goal` during dialogue—resume afterward; a goal paused for failure or operator control does not. Chat routing, explicit end command, one active partner, history, and MindServer protocol remain intact.
- Evidence: live Dashboard showed multiple bots in `Chatting / Goal paused for dialogue`; exact pre-change manager branches and final source were inspected. No conversation, model, bot action, process restart, build, lint, or regression suite was run.

## RT-052 - A one-second duplicate path probe rejects valid progressive routes
- Reproduction: request a route that needs more than one A* slice. Mindcraft calls `getPathTo` with a 1,000 ms total budget and requires `status === success`; installed pathfinder returns `partial` for bounded compute slices and its own `goto()` is designed to keep that A* context moving/computing. Mindcraft reports `unreachable` and never starts movement.
- Root cause: a defensive preflight duplicated pathfinder's native planning lifecycle but applied a stricter, incorrect status contract. The later `goto()` already owns no-path, timeout, changed-goal, path-stop, progressive partial computation, and listener cleanup.
- Fix: remove the duplicate probe, use native progressive `goto()` with Mindcraft safe movements, verify `goal.isEnd` after resolution, map installed pathfinder errors into distinct structured outcomes, and always clear the door interval. Villager movement now consumes the boolean and final distance instead of announcing unconditional success.
- Guard: destructive digging/towering remains disabled; caller-specific arrival distances and ActionManager timeouts remain authoritative; interrupts return non-retryable `interrupted`, while route/environment errors remain retryable.
- Evidence: installed `mineflayer-pathfinder` source explicitly continues `partial` A* results and defines `NoPath`, `Timeout`, `GoalChanged`, and `PathStopped`; final shared navigation/villager source inspected. No route, bot action, restart, build, lint, or regression suite was run.

## RT-053 - Crafting can reject a carried fallback table and silently lose temporary tables
- Reproduction: require a crafting-table recipe while a geometrically nearer world table is within the 16-block scan but has no safe route. `craftRecipe` returns `table_unreachable` even when the bot carries a table. When the bot does place a temporary table, cleanup calls `dig` and treats block disappearance as the end of recovery without collecting or inventory-verifying the dropped table.
- Root cause: the existing-table and carried-table branches were mutually exclusive, and cleanup verified only world-block removal rather than the complete block-to-item-to-inventory transition.
- Fix: try the existing table once, respect interruption, then fall back to a locally carried table; recover only the canonical nearby table drop; require the pre-placement inventory count before reporting recovery; attach cleanup truth to the final craft evidence. Missing and unreachable table states remain distinct.
- Guard: no generic item vacuum, workstation subsystem, unsafe digging, hidden retry loop, server-issued inventory, test run, live bot action, or process restart.
- Evidence: current `craftRecipe`, `world.getNearestBlock`, `placeBlock`, `goToGoal`, and dropped-item recognition source inspected line-by-line in the dirty workspace. Repair is confined to `src/agent/library/skills.js`; final source and diff formatting were inspected without executing tests or the runtime.

## RT-054 - The non-destructive movement policy rejects every collectible block
- Reproduction: autonomous resource roles repeatedly report no safely collectible trees while structured perception sees canonical log blocks a few blocks away. In source, both generic collection and the shared collectible selector call `safeMovements(bot).safeToBreak(block)`.
- Root cause: Mindcraft's ordinary route policy correctly sets `canDig = false`, but installed pathfinder's `safeToBreak()` immediately returns false under that setting. Installed collectblock also requires the active movement predicate to approve the target and mutates flow/falling-block flags before doing so. One object cannot safely represent both “never excavate the route” and “break this selected resource.”
- Fix: validate resources with a dig-enabled safety policy, give the plugin a target-scoped break predicate that accepts only the exact selected coordinate/type through an independent unmutated guard, and restore the ordinary non-digging policy in `finally`.
- Guard: unrelated route blocks remain unbreakable; liquid adjacency, falling-block/entity support, protected-block, tool, inventory, exact-block, inventory-delta, Stop, and error outcomes remain authoritative.
- Evidence: live structured state plus current `skills.js`, installed `mineflayer-pathfinder/lib/movements.js`, and installed `mineflayer-collectblock/lib/CollectBlock.js`. Final source ranges and diff formatting were inspected without executing the runtime. The alternative suspicion that Miner cannot resolve stone from `cobblestone` was disproved: `collectBlock` already expands that request to `stone`.

## RT-055 - A nearby but unreachable table still deadlocks survival tool bootstrap
- Reproduction: start Miner or Lumberjack with no tool/table while any crafting table is geometrically within 16 blocks but has no safe route. `prepareWoodenTool` sees that world table and skips crafting a carried table; `craftRecipe` cannot reach the world table and has no local fallback to place.
- Root cause: bootstrap treated geometric table presence as equivalent to usable workstation capability, contradicting the crafting boundary's explicit reachability/fallback contract.
- Fix: the survival starter kit now ensures one inventory-owned crafting table. Crafting still prefers a reachable world table, while the carried table remains available for the verified local fallback.
- Guard: the table is survival-crafted from collected planks; no item spawning, provisioning bypass, duplicate table crafting, extra path probe, or live activation was added.
- Evidence: current `prepareWoodenTool` and `craftRecipe` call path inspected after RT-053/RT-054. The repair is confined to the existing table-readiness condition.

## RT-056 - One-shot player movement disables every combat reflex
- Reproduction: an Attacker regrouping to its leader or any bot executing `goToPlayer` pauses both `self_defense` and `cowardice` before routing. Continuous Follow/Guard does not. A hostile encountered during that route therefore cannot trigger either bounded fight or retreat behavior.
- Root cause: legacy one-shot navigation suppressed two global reflex modes even though ActionManager/mode interruption already owns arbitration and RoleDirector explicitly depends on combat-aware escort behavior.
- Fix: remove the reflex blackout. Self-preservation, role-aware cowardice suppression, and bounded self-defense remain available to interrupt the route normally. Self-target and missing-player early returns now emit exact structured movement outcomes instead of leaking stale evidence.
- Guard: pathfinding, arrival distance, operator Stop, combat-safe hostile classification, and command ownership remain unchanged.
- Evidence: current `goToPlayer`, `followPlayer`, ModeController priority/suppression, and RoleDirector attacker escort paths inspected. Repair is confined to the shared one-shot player movement boundary.

## RT-057 - Stuck recovery randomly activates trapdoors and drops activation failures
- Reproduction: remain below the movement threshold for 1.2 seconds near any wooden openable. The fallback shuffles blocks at feet, head, ceiling, and below-feet levels, then invokes the first door/gate/trapdoor without checking open state, awaiting completion, catching rejection, or preventing overlap.
- Root cause: a legacy generic openable scanner duplicates the installed pathfinder's native serialized door/trapdoor executor without its route context or lock.
- Fix: keep native pathfinder primary; retain only a deterministic body-level fallback for closed non-iron doors/gates; exclude trapdoors; allow one activation in flight; catch bounded errors; preserve interval cleanup.
- Guard: no floor/ceiling trapdoor mutation, iron-door interaction, random ordering, movement-result overwrite, new timer, or dependency patch.
- Evidence: current `startDoorInterval`, installed pathfinder movement `useOne` generation, and installed executor activation/rejection branches inspected. Nontrivial mechanism recorded in the door-recovery Codeplan; final helper range and diff formatting inspected without execution.

## RT-058 - Single-hit combat reports packet send as verified damage
- Reproduction: call `attackEntity(bot, entity, false)` with the entity within five blocks. The function sends Mineflayer's synchronous attack packet, immediately records `outcome: hit`, and returns true without observing damage; `defendSelf` then counts that result as a verified swing.
- Root cause: command dispatch was treated as the gameplay postcondition, and the allowed distance exceeds normal melee reach.
- Fix: one-hit combat now uses a 3.2-block reach envelope, exact cursor visibility, a target/source-attributed `entityHurt` oracle, bounded interruption/confirmation, and idempotent listener/timer cleanup. Equipment, target loss, obscuration, interruption, unattributed hurt/death, and unconfirmed damage preserve distinct outcomes.
- Guard: preserve kill-mode PvP ownership, bounded Defender/reflex loops, operator interruption, structured evidence, and concurrent dashboard/profile/squad/telemetry work.
- Evidence: current function and all callers inspected; installed Mineflayer source proves `attack()` only writes interaction/animation packets and emits `entityHurt(entity, source)` from modern damage events. Final source range and focused diff formatting inspected without execution.

## RT-059 - Kill-mode combat credits unrelated target deaths to the bot
- Reproduction: begin `attackEntity(bot, entity, true)`, then let another player, bot, or hazard kill that entity. Any matching `entityDead` sets `targetDied`; the function logs `Successfully killed`, records `outcome: killed`, and returns true.
- Root cause: target death was used as both the world postcondition and the causal attribution oracle.
- Fix: kill mode now tracks the selected target's latest server-supplied damage source and this bot's attributed hit count. It emits `killed` only when this bot is the final observed source; otherwise it returns the precise non-retryable `target_died_unattributed` result and skips drop collection.
- Guard: preserve mineflayer-pvp ownership, timeout/interruption/target-loss behavior, drop collection only after verified defeat, and concurrent dashboard/profile/squad/telemetry work.
- Evidence: current kill-mode branch and callers inspected; installed modern Mineflayer exposes target and responsible source through `entityHurt(entity, source)`. Final source range and focused diff formatting inspected without execution.

## RT-060 - Underwater attack disables unrelated emergency survival
- Reproduction: call `attackNearest` for drowned or aquatic mobs. The entry point pauses the entire `self_preservation` mode for the engagement, disabling fire and low-health reactions for up to the 30-second PvP limit.
- Root cause: a broad survival blackout was used to permit underwater pathfinding, even though the mode's water branch explicitly yields whenever pathfinder already owns a goal.
- Fix: remove the unnecessary `self_preservation` pause; keep PvP pathfinder ownership and the existing cowardice pause.
- Guard: no change to target selection, swim/pathfinder controls, combat timeout, or bounded emergency-survival behavior.
- Evidence: full self-preservation update and attack entry inspected. Water assistance is conditional on `!bot.pathfinder.goal`; active PvP navigation is therefore not interrupted by leaving the mode enabled.

## RT-061 - Explicit door traversal crashes, hangs, and reports unverified success
- Reproduction: call `useDoor()` where no oak door is loaded; the first search dereferences `.position` on null and never checks other wood types. With a target, failed movement can wait indefinitely; unloaded/non-door blocks are dereferenced; activation/traversal are not verified; forward control lacks unconditional cleanup; the function always returns true.
- Root cause: the helper predates shared safe navigation and structured action evidence, treating issued movement/activation as traversal.
- Fix: select any supported wooden door without species-order dereferences, validate supplied coordinates and refreshed block state, approach through shared safe navigation, verify reach/open state, bound and clean up forward control, prove a door-plane crossing, and best-effort verify close. Both NPC action callbacks now return failure instead of discarding it; exit movement occurs only after verified traversal.
- Guard: preserve `useDoor(bot, Vec3|null)`, NPC routines, safe pathfinder policy, operator interruption, and concurrent dashboard/profile/squad/telemetry work.
- Evidence: full helper and both callers inspected before and after editing; all `useDoor` call sites enumerated; final hashes are `24D74D66A0926527A6CD536E2810DBC10C9D453E9CD59CFE0F5F4EC78B130F9F` (`skills.js`) and `79239E840F9B98F7FCA1A03CAA475AC0EE68E7F60AF9854CD55FE64305408C63` (`controller.js`). Focused diff formatting passed. No test, movement action, build, bot command, or restart was run.

## RT-062 - Job-role bots ignore their safety presets and repeatedly die in unwanted melee
- Reproduction: launch the current autonomous Builder profiles near hostiles. Persisted modes enable `self_defense` and disable `cowardice`; the bots repeatedly log fights against Endermen, Drowned, Skeletons, Zombies, and Spiders, then die and restart the loop.
- Root cause: runtime role presets declare reflex intent but have no consumer. `initModes()` loads only the generic profile modes, and Endermen are absent from the avoid-only hostile set.
- Fix: normalize `runtime.reflexes.combat` (`role`, `defend`, `avoid`, `off`) and apply it once after profile mode loading for explicit-runtime bots. Worker/scout/custom roles default to avoidance; combat/companion roles retain defense. Endermen are avoid-only through both defense selection and the retreat counter-swing. Retreat no longer suppresses emergency self-preservation.
- Guard: preserve legacy profile modes, explicit attack commands, later operator `!setMode` changes, Stop, and concurrent dashboard/profile/squad work.
- Evidence: current `behavior-config.js`, full mode initialization/suppression path, hostile classifier, all current Builder runtime profiles, and recent persisted histories inspected read-only before editing. Final hashes: `D995B0BCC6A23ECD891692826CFBBCD478FE97CC6D49A8A69DA709D9C2D979C7` (`behavior-config.js`), `F07BAA5EE7E68439A826D8E110A22A784D10882F341B399ED5A47CF1701E0397` (`modes.js`), `C3B1B08F38D5C5916E6214CD847A0948DDD9E506C4135EB31AEBF75378DCE0D8` (`mcdata.js`), and `39312BE1A82607017006BB0AA7C1B36F35804B0065D5F73454053ED8D8DFB299` (`skills.js`). Focused diff formatting passed; no live activation or tests.

## RT-063 - Default balanced job roles regroup forever instead of doing their jobs
- Reproduction: create an ordinary Builder, Miner, Lumberjack, or Scout without changing the normalized default `balanced` autonomy. `chooseIntent()` returns `goToPlayer(..., 5)` before any role-work branch, including while the bot is already beside that player.
- Root cause: `balanced` was implemented as “not autonomous” rather than a player-anchored work policy.
- Fix: balanced non-combat work/scout roles now enter existing role intents within a 12-block player anchor, regroup only when separated, and wait without a visible leader. Long-range resource-search relocation remains autonomous-only, so balanced jobs report local blockers instead of wandering independently.
- Guard: preserve command/autonomous semantics, RoleDirector action ownership/results, Stop, recovery budgets, and concurrent UI/profile/squad work.
- Evidence: runtime normalization default, full RoleDirector intent/result flow, leader resolver/distance helper, scenario-specific autonomous override, and every resource-search state mutation inspected. Final `role-director.js` hash: `FA8F27161921C534C795130FA3220E0723D1FDA3282565D98C894DA342BC8C5A`. Focused diff formatting passed; no live activation or tests.

## RT-064 - Low-health survival waits until near death and retreats in an arbitrary direction
- Reproduction: take repeated hostile damage. Self-preservation does nothing until health is below 5 (2.5 hearts) or the previous hit was nearly lethal, then calls origin-relative `moveAway(20)` instead of moving away from the attacker. Persisted histories show `I'm dying!` immediately before repeated hostile-caused deaths.
- Root cause: the emergency branch is both late and spatially blind.
- Fix: trigger within a four-second damage window at half health or after a severe hit, resolve the nearest canonical hostile within 24 blocks, retreat through the existing verified entity-relative helper, and use one 12-block safe fallback only when that route fails without interruption. A four-second cooldown bounds retriggering.
- Guard: preserve mode priority, Stop emergency exception, verified movement, interruption, and concurrent UI/profile/squad work.
- Evidence: safe movement/parkour policy, full self-preservation mode, existing damage-state owner, canonical hostile lookup, mode execution wrapper, both retreat helpers, and persisted histories inspected. The separate hypothesis that safe movement disabled jumping was disproven. Final `modes.js` SHA-256: `F4156D9AA753056EB5A5F0CEC9C6AC949558FD2F98BB9A0F8362F4288371DFA0`. Focused diff formatting passed; no live activation or tests.

## RT-065 - Configured role hard-locks a single bot out of supported jobs
- Reproduction: ask a Companion, Defender, Attacker, or any differently configured bot to mine, harvest, or stockpile. Mining/stockpiling natural-language routing is skipped, harvesting degrades to a one-shot collection call, and direct persistent assignment is rejected as the wrong role.
- Root cause: the presentation/default-autonomy role was treated as a capability class even though `JobDirector` already selects execution from the validated work order's own role. Player-created stockpile orders were also mislabeled `source: role`, causing command-autonomy suppression and allowing survival to discard an explicit order as background work.
- Fix: explicit mining, harvesting, and stockpiling requests now submit durable player-owned specialty work orders for any bot. The configured role remains unchanged and continues to own default no-order behavior, personality, reflex defaults, and telemetry.
- Guard: work-order validation, one-active-order arbitration, survival preemption, Stop, retries, and automatic role behavior are unchanged; this does not authorize construction or mutate profile identity.
- Evidence: the complete submission helper, natural-language directive branches, `JobDirector.submit()`, and active-order reducer selection were inspected before editing. Final source reread and focused diff formatting only; no runtime action, restart, or tests.

## RT-066 - Player-authorized construction has no playable entry point
- Reproduction: ask the single bot to build a shelter. The runtime has a complete player-build reducer and exact blueprint auditor, but no command or natural-language route creates a player build order; the bot can only talk, emit isolated placements, consume benchmark task data, or wait for an emergency.
- Root cause: safe construction execution was implemented without a product entry point.
- Fix: add one bounded player-authorized 3x3 survival shelter order, anchored around the bot with a fixed doorway, and route explicit shelter language into the existing durable Builder pipeline.
- Guard: the blueprint is fixed and bounded; materials are survival-acquired; no block is cleared; loaded state, liquids, protected blocks, occupants, support, escape, inventory, placement, Stop, and final blueprint audit remain authoritative.
- Evidence: the complete builder reducer, work-order validation, blueprint audit, emergency geometry, command ownership, and directive precedence were inspected before editing. Source-only reread and diff formatting; no build action, restart, or tests.

## RT-067 - Accepted jobs wait forever behind Follow or Guard
- Reproduction: start continuous Follow/Guard, then assign mining, harvesting, stockpiling, or shelter work. Submission succeeds, but `JobDirector.update()` requires idle while the resumable movement remains active indefinitely.
- Root cause: persistent assignment stopped the model loop but did not transfer ActionManager ownership or clear the resumable action.
- Fix: every player-origin persistent assignment now cancels resume state and performs one bounded ActionManager stop before submission. If the action does not yield, the bot is held and the work order is refused with the active-action reason.
- Guard: no scheduler-level forced preemption, no process restart, no silent job acceptance, and no change to survival or Stop priority.
- Evidence: all three player assignment paths, persistent command metadata, ActionManager stop/resume semantics, and JobDirector idle gate were inspected before editing. Source-only reread and diff formatting; no live action, restart, or tests.

## RT-068 - Long actions suppress the only automatic eating owner
- Reproduction: begin a multi-minute gather, mine, build, or movement action and let hunger fall. Startup has disabled Mineflayer auto-eat, while both survival policy and its director require idle; no food action can run until the current action ends.
- Root cause: routine idle-only scheduling was applied to critical survival recovery as well as optional upkeep.
- Fix: critical hunger or low-health food recovery may now preempt a busy action through the existing ActionManager and structured SurvivalDirector path. Noncritical eating and all other upkeep remain idle-only.
- Guard: safe-food ranking, reserve policy, Stop, urgent combat modes, bounded interruption, equipment cleanup, work-order recovery, and result truth are unchanged.
- Evidence: auto-eat ownership, full survival policy/director, BehaviorDirector scheduling, ActionManager interruption, and JobDirector recovery were inspected before editing. Source-only reread and diff formatting; no live action, restart, or tests.

## RT-069 - Core registry knowledge is unavailable to the acting model
- Reproduction: ask what an unfamiliar or version-new item/block is, which tools harvest it, what it drops, whether the bot carries a compatible tool, or how it is crafted. The model can query inventory/craftable items or fetch unbounded remote wiki prose, but cannot inspect the authoritative connected registry.
- Root cause: version-correct object knowledge exists in Mineflayer and `minecraft-data` but has no bounded command boundary.
- Fix: add a registry-first `!inspectMinecraft` query covering canonical identity, capabilities, carried state, durability/repair, food, block physics/light, drops, all registered harvest tools, compatible carried tools, and bounded recipe alternatives, with suggestions for unknown names.
- Guard: read-only, local, version-matched, bounded output; no network, action, guessed world fact, or handwritten per-object template.
- Evidence: active registry schema, current item/block/recipe data, existing query surface, command-doc prompt injection, and local recipe helpers were inspected before editing. Source-only reread and diff formatting; no runtime query, restart, or tests.

## RT-070 - Autonomous turns receive neither game state nor valid capability syntax
- Reproduction: let a default profile self-prompt. Its autonomy template contains literal `__STATS__ __INVENTORY__`, which is never resolved, and omits persona, goal, memory, command docs, awareness, and inventory placeholders. The detailed instruction constructed in `SelfPrompter` is unused. A no-command retry recommends nonexistent/invalid commands.
- Root cause: autonomy was split from the normal conversation prompt without a provider-neutral context contract.
- Fix: every autonomy prompt now normalizes legacy markers and appends missing live persona, goal, memory, awareness, inventory, and compact unblocked command signatures. General rules teach registry inspection and observe/preflight/act/verify/adapt composition; retry examples use real parser-valid commands.
- Guard: all providers receive the same bounded context; profile text remains authoritative; blocked commands stay hidden; one-command and prompt-turn budgets remain unchanged; no per-activity templates were added.
- Evidence: default and inherited profile merging, `promptAutonomy`, replacement logic, SelfPrompter caller, command parser/docs, and retry path were inspected before editing. Source-only reread and diff formatting; no model call, runtime restart, or tests.

## RT-071 - Version-new copper tools are ranked below wood
- Reproduction: connect to a registry version containing copper tools and carry a copper pickaxe. Both shared tool selection and JobDirector assign unknown material prefixes tier zero, so a wooden tool can outrank copper and Miner can prepare a redundant stone pickaxe.
- Root cause: capability ranking predates the connected registry's copper tool family.
- Fix: rank copper between stone and iron in both execution and durable-job inventory summaries; Mineflayer's authoritative per-block `canHarvest` check still decides actual use.
- Guard: no assumed recipe, provisioning, harvest permission, or tool fabrication; connected registry and block capability remain authoritative.
- Evidence: installed active-version item/block data and both current tier consumers were inspected. Source-only reread and diff formatting; no runtime action, restart, or tests.

## RT-072 - Autonomy commands are reinterpreted by a second model and lose observations
- Reproduction: SelfPrompter receives a valid autonomy command and passes it to `handleMessage('system', ...)`. System messages bypass forced-command execution and call `promptConvo`, so a second provider response can narrate, transform, or drop the selected action. Autonomy is then called with an empty message list, so query output cannot guide its next turn.
- Root cause: generated commands were routed through a human-conversation entry point instead of the existing validated command boundary.
- Fix: validate, truncate, record, and execute the generated command directly through `executeCommand`; persist bounded output; supply eight recent turns through `$CONVO`; yield SelfPrompter when it selects a persistent job so JobDirector can run; turn periodic re-planning into next-turn context instead of another conversational model call.
- Guard: blocked commands, parser types, one-command truncation, ActionManager truth, Stop, history, prompt budgets, and work-order arbitration remain authoritative.
- Evidence: SelfPrompter loop, all `handleMessage` branches, command parser/blacklist/execution, JobDirector ownership gate, history API, and autonomy prompt input were inspected before editing. Source-only reread and diff formatting; no provider call, runtime action, restart, or tests.

## RT-073 - Generic item activation cannot hold, release, or verify equipment
- Reproduction: ask the bot to use a bow, shield, spyglass, trident, food, or another held-use item through the generic path. `!useOn(item, "nothing")` activates once, never expresses a duration or release, and reports success without checking the equipment slot. Emptying a full main hand can also fall through to Mineflayer's item-drop behavior.
- Root cause: the command surface exposed only target interaction, while the installed Mineflayer contract separates item activation from deactivation and exposes an authoritative destination-slot lookup that the shared equip helper ignored.
- Fix: add one bounded `!useItem(item, duration, hand)` primitive with explicit main/off-hand selection, verified equip, interrupt-safe release, and inventory/durability evidence. Shared equip now verifies every destination, refuses unsafe full-inventory hand clearing, and avoids overwriting a creative inventory slot.
- Guard: no item-specific templates or claimed world effects; duration is capped at five seconds; specialized consume/combat/place/use skills remain preferred when they can verify a stronger result; Stop and ActionManager retain ownership.
- Evidence: installed Mineflayer `equip`, `getEquipmentDestSlot`, `activateItem`, and `deactivateItem` contracts plus every shared equip/use caller and changed source line were inspected. Syntax and diff formatting only; no item action, runtime restart, or tests.

## RT-074 - Surface navigation claims success after failed pathfinding
- Reproduction: call `!goToSurface` underground without a safe path to the top of the current column. The skill ignores `goToPosition` returning false, logs that it is going to the surface, and returns true.
- Root cause: the legacy helper used fixed build-height constants and treated issuing a route as proof of arrival.
- Fix: derive bounds from the connected dimension, select a loaded solid target with body clearance, require the shared safe route to succeed, and verify final horizontal/vertical proximity plus support before returning success.
- Guard: no digging, towering, teleport, or destructive recovery was added; blocked, unloaded, interrupted, and unverified routes remain explicit failures.
- Evidence: installed Mineflayer dimension fields, shared no-dig movement result contract, the complete surface helper, and its command wrapper were inspected. Syntax and diff formatting only; no movement, runtime restart, or tests.

## RT-075 - Generic interactions claim unobserved block and entity effects
- Reproduction: use an item or empty hand on a block/entity for which the server rejects, delays, or produces no visible effect. The generic skill returns `used` immediately after Mineflayer sends the interaction. Several missing-target/obstruction exits also return false without fresh evidence, and empty-hand entity use bypasses the full-inventory drop guard.
- Root cause: the code treated client interaction completion as gameplay outcome completion and had no shared post-interaction observation contract.
- Fix: snapshot target block/entity state, carried item count/durability, and open-window identity; condition-poll fresh state for 750 ms; return verified only when an authoritative observable changes, otherwise emit `completion: requested`. Missing, lost, obstructed, changed, unloaded, and interrupted targets now carry exact evidence. Targetless item use routes through the bounded item-use cycle and empty-hand use routes through safe equip.
- Guard: no item-specific effect is guessed; unloaded/despawned targets alone do not prove success; sight recovery is deterministic and capped at two positions; ActionManager remains the only result normalizer.
- Evidence: installed Mineflayer interaction contracts, full generic use call graph, equipment safeguards, ActionManager requested semantics, and every changed source line were inspected. Syntax and diff formatting only; no interaction, runtime restart, or tests.

## RT-076 - Saved provider endpoints are discarded before model construction
- Reproduction: save an Ollama, LM Studio, vLLM, OpenAI, DeepSeek, or OpenAI-compatible Bot Library profile with a custom base URL, then deploy it. The adapter stores that URL in `profile.url`, but preflight and Prompter resolve only the bare model string. Generic OpenAI-compatible profiles are blocked as if no URL exists; local providers silently contact their built-in default endpoint.
- Root cause: model selection had a string-only call contract even though model constructors already accept `{ api, model, url, params }`.
- Fix: resolve every model role from the complete profile, inherit the primary endpoint and shared parameters only for roles using that same provider, retain explicit secondary-role configuration, and carry the resolved endpoint into fallback embedding construction and provider readouts.
- Guard: no credential values are serialized; configured environment-variable names remain validated; different secondary providers do not inherit the primary URL; legacy model strings and provider-prefix inference remain supported.
- Evidence: Bot Library normalization/handoff, profile transport, preflight, provider reporting, model selection, and Ollama/LM Studio/vLLM/OpenAI/DeepSeek/OpenAI-compatible constructors were inspected. All changed source lines were re-read; focused syntax and diff formatting passed. No provider request, process start, runtime restart, or test ran.

## RT-077 - Spawn succeeds before the bot runtime or Minecraft world is ready
- Reproduction: request Spawn while provider construction, authentication, or Minecraft world entry will later fail. `AgentProcess.start()` resolves on the operating-system child `spawn` event, before the child loads settings, constructs Prompter, logs into Minecraft, receives `spawn`, or installs gameplay handlers.
- Root cause: process existence and playable readiness shared one `running` state, while Mineflayer's pre-world `login` event also set `in_game`.
- Fix: keep the current process in bounded `starting` state through process, bridge, and login stages; emit one authenticated world-ready acknowledgement only after spawn initialization and gameplay-handler setup; resolve the original start and set `in_game` only after the current `AgentProcess` accepts that acknowledgement.
- Guard: capability-token ownership, current-process identity, Stop/Restart arbitration, bounded timeout, diagnostic redaction, and configured inactive profiles remain intact. Spawn-handler failures now exit nonzero.
- Evidence: parent process lifecycle, child bootstrap, settings bridge, Mineflayer login/spawn sequencing, connection ownership, public status serialization, and all changed lines were inspected. Focused syntax and diff formatting passed; no process was spawned, provider contacted, bot joined, runtime restarted, or test run.

## RT-078 - Lower-priority autonomy can cancel survival and player-owned work
- Reproduction: let SelfPrompter remain active while critical survival dispatches an action, or allow two independent schedulers to reach ActionManager close together. Every incoming action unconditionally calls `stop()` on the current action because neither command dispatch nor resumable state identifies its owner.
- Root cause: update-loop ordering was treated as control ownership even though model calls and action promises run asynchronously outside that tick.
- Fix: carry one bounded owner through asynchronous command dispatch and resume state; enforce `reflex > survival > player > job > autonomy > background` at the shared ActionManager boundary; return a structured retryable blocker instead of interrupting a higher owner; make autonomy wait behind higher owners without spending failure or no-progress budget.
- Guard: Operator Stop remains above all scheduled work, with only immediate self-preservation exempted; higher-priority actions still use the existing bounded Stop handoff; a new player action may replace an older player action; Follow/Guard resumes with its original owner.
- Evidence: all ActionManager entry points, command dispatchers, modes, survival, role/jobs, SelfPrompter, reactions, NPC actions, and benchmark task dispatch were inspected. Focused syntax and diff formatting passed; no action, model call, runtime restart, or test ran.

## RT-079 - Autonomous goals lose exact progress and restored-goal authority
- Reproduction: resume an explicit saved goal or let autonomy issue observations, requested effects, verified actions, and repeated blockers. Without a source-preserving execution record, the next turn can treat queries as progress, lose the exact blocker, or allow default idle autonomy to replace a restored goal.
- Root cause: recent conversation and a single last action id were carrying goal state implicitly; there was no bounded per-goal ledger, no verified-step counter, and restored goals were not kept distinct from default autonomy.
- Fix: maintain a sanitized bounded goal ledger, preserve it when the same prompt resumes, reset it only for a changed prompt, mark restored goals as `source: restored`, inject the ledger into every autonomy prompt, and increment verified progress only for a new structured `phase: succeeded` result.
- Guard: observation and query turns remain `observed`; server-side effects remain `requested`; exact non-retryable and repeated blockers remain bounded; persistent-job handoff and `!endGoal` still stop the loop; only default-sourced paused goals may use the default reseed callback.
- Evidence: complete `SelfPrompter`, autonomy prompt, full-state attention, default startup/load, explicit goal, persistent-job, end-goal, and conversation-resume paths were reread. Focused `node --check` passed for `self_prompter.js`, `prompter.js`, `full_state.js`, and `agent.js`; focused `git diff --check` passed. No provider call, bot action, world action, restart, or test ran.

## RT-079 - Restored goals can be replaced by default autonomy at startup
- Reproduction: load a saved active or paused self-prompt while a legacy `default_goal` is configured. `handleLoad()` correctly restores the prompt, but startup checked only `!isActive()` before default seeding, so a paused restored goal could be silently replaced.
- Root cause: default-goal eligibility treated “not currently executing” as “no saved goal,” despite paused/restored prompts remaining operationally meaningful state.
- Fix: default seeding now requires an empty `self_prompter.prompt`; `handleLoad()` resumes through `start(prompt, { source: 'restored' })`, which preserves the same-prompt ledger and source. Ledger telemetry/prompt wording now accurately calls the first repeated-blocker value “Current blocker occurrences.”
- Guard: a genuinely new goal still resets its ledger; only `phase: succeeded` increments verified steps; observations/requested outcomes remain non-success; persistent-job handoff and `!endGoal` retain their loop-stop behavior.
- Evidence: complete SelfPrompter lifecycle, prompt construction, startup/load, manual command, conversation resume, and attention telemetry paths inspected. `node --check src/agent/{self_prompter,agent,library/full_state}.js` and `src/models/prompter.js` passed; scoped `git diff --check` passed. No provider call, agent action, server start, restart, or test suite was run.

## RT-080 - Terminal agent events bypass coordinated local teardown
- Reproduction: a kick/end can reach both early connection and runtime listeners. Existing callbacks either call `process.exit` directly or `cleanKill()`, while the update loop and idle-resume timeout are unowned and SelfPrompter/ActionManager cleanup is bypassed.
- Root cause: process exit was treated as cleanup, leaving no idempotent Agent-local lifecycle boundary.
- Fix: Agent now owns one teardown promise, stops update/idle-resume handles, cancels resumable actions, requests bounded prompt/action cleanup, interrupts movement, disposes optional vision work, preserves the sanitized terminal message, and only then exits. Initial terminal callbacks route through this boundary; duplicate signals share it.
- Guard: ActionManager remains the action/result owner; no service is restarted and operator-hold/action priorities are unchanged.
- Evidence: focused syntax and diff-format checks passed for `src/agent/agent.js`; no agent, provider, Minecraft action, restart, or suite was run.

## RT-081 - Core gameplay entry points can discard failure or claim unsafe progress
- Reproduction: follow a moving entity, dig downward into an unloaded or unsupported cell, clear a protected block through generic build/break, or run an older NPC item/build callback. The prior paths could navigate to stale coordinates, return success at an unloaded world edge, destructively clear an occupied blueprint cell, or let ActionManager see `undefined` after a failed skill.
- Root cause: newer world-truth checks were local to durable jobs and selected skills; legacy movement, descent, interaction, and NPC wrappers did not preserve the same safety predicates, skill booleans, or observed postconditions.
- Fix: centralize dependency-light protected/replaceable/hazard/falling predicates; follow and re-verify entity identity; verify target blocks at arrival; make every descent cell loaded, supported, dry, non-falling, non-protected, and followed by an observed landing; route drowning/fall/fire reflexes through bounded skills; preserve NPC skill booleans; verify furnace/villager outcomes and close windows in `finally`.
- Guard: ActionManager remains the only ownership/result boundary; durable job planning and existing commands remain intact; legacy building may clear only replaceable blueprint cells and cannot silently mark a blocked structure complete.
- Evidence: focused syntax and diff-format checks passed for every changed gameplay source. No server, provider, bot, Minecraft action, runtime restart, or test suite ran.

## RT-082 - Spawn failure and death cleanup can bypass owned runtime state
- Reproduction: let spawn initialization time out/fail, or die while autonomy/action work is active. Spawn failures called `process.exit()` directly; death stopped only ActionManager without pausing active self-prompt work or clearing owned motion.
- Root cause: idempotent terminal teardown did not own the spawn timer, and respawn-safe current-work cleanup had no dedicated bounded path.
- Fix: store and clear the spawn timeout, route timeout/setup failures through `teardownAndExit()`, and make death share one in-flight cleanup promise that cancels resume, pauses autonomy, stops actions, interrupts plugins, and clears controls without killing the respawning process. `!endGoal` now awaits its stop.
- Guard: invalid pre-initialization profile failure remains a direct exit; death does not terminate the process or discard saved goal text; terminal signals still share the existing teardown promise.
- Evidence: focused syntax and diff-format checks passed for `agent.js` and the end-goal command. No live death, disconnect, process exit, provider request, bot action, restart, or test ran.

## RT-083 - Runtime stop acknowledges requests before owned process trees are gone
- Reproduction: click the dashboard's former `Stop Everything` control or stop/remove a bot while a child is slow or unresponsive. The UI can time out first, individual socket handlers can acknowledge only the signal request, and detached or parent-only children can remain alive.
- Root cause: shutdown was split across connection-derived bot state, immediate callbacks, detached Ollama startup, parent-only termination, and UI deadlines shorter than server lifecycle deadlines. Launcher signals also skipped several runtime owners.
- Fix: centralize structured runtime shutdown across the director, task runners, authoritative bot-process registry, managed Java, and Mindcraft-started local services; retain owned handles; use bounded Windows process-tree termination; wait for stop/removal postconditions; force stalled startup/restart trees; and align UI deadlines with server lifecycle bounds.
- Guard: externally started Ollama and unrelated Node/Java processes remain outside runtime ownership; the dashboard remains online after runtime stop; full control-center shutdown stays a distinct action.
- Evidence: stale PIDs 13532 and 24100 were removed; when the 8643 service respawned as PID 3276, its verified `bash -> bash -> npm -> cmd -> node dist/main.js` owner tree rooted at PID 27780 was terminated. Port 8643 stayed closed through five follow-up checks, port 3000 remained closed, and the final targeted process sweep was empty. `npm run check:critical` passed 9 tests plus focused lint, syntax, and direct format checks over 17 files. No Mindcraft service, bot, provider, Minecraft server, or dashboard was launched for this repair, so the corrected buttons still require a later live operator check.

## RT-084 - Obstructed tactical melee intermittently stalls at a safe wall corner
- Reproduction: run `tools/verify-combat-field.mjs` against the controlled COM-001 fixture. Clear zombies are recognized, approached, damaged, and killed reliably. With the same tagged zombie hidden behind a three-block-high wall, tactical selection remains correct but Mineflayer Pathfinder intermittently stops west of the open wall end before melee range.
- Root cause boundary: threat perception, combat decision, action ownership, floor support, fixture isolation, and Paper attribution are disproven as causes. Successful runs clear the wall end, acquire line of sight, replan, and kill. The failing final reset stops at `(1113.70,100,1060.67)` with the target still hidden and undamaged. This isolates the remaining defect to physical corner execution or its immediate path/recovery contract.
- Attempted mechanisms: bounded supported line-of-sight melee stances, preference for the most traversably clear stance tier, and one evidence-gated replan after physical progress changes visibility from hidden to visible. The final mechanism passed two obstructed resets and failed the next; it did not satisfy the three-consecutive gate.
- Disposition: the explicit three-surgical-navigation-repair stop condition is active. Do not add another scheduler, arbiter lane, timeout increase, or blind retry. The production experiment and focused test remain uncommitted; the verifier, evidence, and `docs/verification/2026-08-01-overnight/com-001-blocker.md` preserve the runnable handoff.
- Evidence: `com-001-live-post-floor-repair.json`, `com-001-live-post-repair-r1.json`, `com-001-live-post-repair-r2b.json`, `com-001-live-post-repair-r3.json`, and `com-001-live.json`; independent Paper damage/kill objectives and tagged-target health; deduplicated linked decision traces; held cleanup after every run.
