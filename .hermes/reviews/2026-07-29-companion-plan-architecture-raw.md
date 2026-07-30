Verdict

**NO-GO pending five release-blocker corrections.** The direction is sound, but the current plan cannot yet guarantee a single movement owner, safe preemption, trustworthy combat evidence, or preservation of suspended work. These are implementation-contract problems, not optional polish.

Critical Findings

- **[CRITICAL — RELEASE BLOCKER] Resource ownership is underspecified and cannot be enforced by an action generation alone.**
  - **Plan:** §4.1; Task 2 requirements 2–4; Task 4 requirements 1–3.
  - **Evidence:** `src/agent/action_manager.js:69-99,134-200,240-265`; `src/agent/agent.js:352-358,882-893`; `src/agent/modes.js:455-492`; `src/agent/library/skills.js:3522-3570,4010-4126`.
  - **Failure scenario:** Action A is interrupted; its asynchronous `finally` later calls `pathfinder.stop()`, `pvp.stop()`, or `clearControlStates()` after Action B has started. A generation check around result publication does not prevent stale skill/plugin cleanup from stopping B. The global `idle` handler can do the same.
  - **Smallest correction:** Add an explicit resource lease owned by generation for `pathfinder`, control states, PvP, digging, and collectblock. All critical acquisition and cleanup must go through lease-aware wrappers. Do not start Action B until A’s cleanup promise has completed. Remove unconditional movement cleanup from the generic `idle` handler.
  - **Verified in source:** Yes.

- **[CRITICAL — RELEASE BLOCKER] `mineflayer-pvp` and the proposed navigation supervisor would concurrently own the same pathfinder.**
  - **Plan:** Task 4 requirement 1 (“combat pursuit boundary”); Task 5 requirements 7–8; Task 9 Layer B requirement 5.
  - **Evidence:** `src/agent/library/skills.js:1734-1815`; `node_modules/mineflayer-pvp/lib/PVP.js:60-95`. Installed PvP calls `pathfinder.setMovements()`, installs its own dynamic `GoalFollow`, and stops pathfinder itself.
  - **Failure scenario:** The supervisor installs or recovers a combat route while PvP replaces its movements/goal. Either controller can stop the other, and ownership telemetry can still report one action while two components mutate movement.
  - **Smallest correction:** Choose one combat design before implementation:
    1. use PvP as the sole combat-navigation owner behind a generation-scoped adapter, with the supervisor only observing; or
    2. stop using `pvp.attack()` and implement bounded pursuit plus verified `bot.attack()` under the supervisor.
    Do not claim supervisor ownership while calling `pvp.attack()`.
  - **Verified in source:** Yes.

- **[CRITICAL — RELEASE BLOCKER] Installed PvP cleanup can delete unrelated pathfinder listeners.**
  - **Plan:** Task 2 requirement 3; Task 3 requirement 1; Task 5 requirement 8.
  - **Evidence:** `node_modules/mineflayer-pvp/lib/PVP.js:80-95`, especially line 91: `bot.removeAllListeners('path_stop')`.
  - **Failure scenario:** `pvp.stop()` times out and removes the supervisor’s, verifier’s, or another operation’s `path_stop` listeners. The new action may hang, leak, or publish the wrong terminal state.
  - **Smallest correction:** Patch/replace this call with removal of PvP’s own listener only, and add an integration regression proving unrelated listeners survive PvP stop timeout.
  - **Verified in source:** Yes.

- **[CRITICAL — RELEASE BLOCKER] The proposed persisted-work suspension cannot preserve the required evidence with the current store schema.**
  - **Plan:** §1 non-goal on restart; Task 1 requirements 4–6.
  - **Evidence:** `src/agent/runtime/job-director.js:531-540,615-627`; `src/agent/runtime/job-state-store.js:41-47`; `src/agent/runtime/work-order.js:132-178`.
  - **Failure scenario:** Clearing `activeOrder` via `save(null)` deletes the only persisted copy. Alternatively, leaving it nonterminal permits later execution. The work-order schema has no session/assignment identity, so the proposed identity comparison cannot be implemented.
  - **Smallest correction:** For this baseline, rename/store the prior order as a terminal `cancelled` historical record with `companion_restart_requires_player`, or add a schema-versioned `suspendedOrder` plus `sessionId`. Prefer the terminal historical record to avoid expanding persistence machinery.
  - **Verified in source:** Yes.

- **[CRITICAL — RELEASE BLOCKER] Combat fallback evidence can falsely attribute another actor’s damage to the bot.**
  - **Plan:** §4.3 lines 141–142; Task 5 requirements 5–6.
  - **Evidence:** `node_modules/mineflayer/lib/plugins/entities.js:377-381`; `src/agent/library/skills.js:1530-1596,1735-1805`.
  - **Failure scenario:** The bot emits an attack attempt, then another player/mob damages the target during the fallback window. A generic metadata/health change becomes a false “hit.” A later despawn can become a false defeat if death and removal are conflated.
  - **Smallest correction:** On installed 1.20+ protocols, require `entityHurt(target, source === bot.entity)` for an attributed hit. If source is absent, record `damage_observed_unattributed`, never `hit`. Treat only `entityDead` as death; `entityGone` is `target_lost` unless death was already observed.
  - **Verified in source:** Yes.

Major Findings

- **[MAJOR — RELEASE BLOCKER] Racing `pathfinder.goto()` against a deadline does not cancel or settle its internal listeners.**
  - **Plan:** Task 3 requirements 1–2.
  - **Evidence:** `node_modules/mineflayer-pathfinder/lib/goto.js:16-64`.
  - **Failure scenario:** The supervisor returns `timeout`, but `goto()` remains subscribed and retains its goal. Later path events resolve/reject the abandoned promise or interfere with the next operation.
  - **Smallest correction:** On interrupt/deadline, force `setGoal(null)`, await `goto()` settlement, then remove only supervisor-owned listeners before releasing the lease.
  - **Verified in source:** Yes.

- **[MAJOR — RELEASE BLOCKER] The plan misclassifies `path_reset` reasons as terminal outcomes.**
  - **Plan:** §2 line 61; Task 3 requirement 4.
  - **Evidence:** `node_modules/mineflayer-pathfinder/readme.md:303-323`; `node_modules/mineflayer-pathfinder/index.js:129`.
  - **Failure scenario:** Normal `goal_updated`, `block_updated`, `chunk_loaded`, or `goal_moved` resets are treated like failure, or `dig_error`/`stuck` immediately terminates even though the supervisor intends recovery.
  - **Smallest correction:** Define an explicit event table: observational resets, recoverable resets, terminal path-update statuses, and stop/goal-change events. Make terminal decisions from operation state, not any reset event.
  - **Verified in source:** Yes.

- **[MAJOR — RELEASE BLOCKER] `mineflayer-collectblock` is another hidden movement owner.**
  - **Plan:** Task 4 requirement 1; Task 6 collection requirements 3–5.
  - **Evidence:** `src/agent/library/skills.js:1903-2110`, especially `2064-2070`; plugin loaded at `src/utils/mcdata.js:140-145`.
  - **Failure scenario:** The supervisor approaches the resource, then `collectBlock.collect()` installs its own movement behavior and can re-route or stop pathfinder independently.
  - **Smallest correction:** Either use collectblock as the leased owner for the entire collection operation and observe it, or replace its navigation portion with supervisor-controlled reach plus explicit equip/dig/pickup. Do not combine both.
  - **Verified in source:** Yes.

- **[MAJOR — RELEASE BLOCKER] Hold and safety semantics conflict after replacing `reflex` with `survival`/`defense`.**
  - **Plan:** §4.1; Task 1 requirements 2 and 7; Task 2.
  - **Evidence:** `src/agent/action_manager.js:140-155` permits safety through hold only for owner `reflex` and label `mode:self_preservation`; `src/agent/agent.js:364-375`.
  - **Failure scenario:** After the owner enum changes, drowning/burning/critical-health survival is blocked by operator hold, or defense accidentally bypasses hold if the old exception is generalized too far.
  - **Smallest correction:** Specify hold policy explicitly: emergency survival may bypass hold; defense may not; a new player command atomically releases hold before ownership acquisition. Test each combination.
  - **Verified in source:** Yes.

- **[MAJOR — RELEASE BLOCKER] Timeout currently cannot force an uncooperative action to terminate.**
  - **Plan:** Task 2 requirements 3–4; Task 4 requirement 6.
  - **Evidence:** `src/agent/action_manager.js:371-377`; `src/agent/action_manager.js:69-99`.
  - **Failure scenario:** Timeout calls cooperative `stop()`, which waits for `executing` to become false while the action remains stuck awaiting an SDK promise. The timeout path can wait another ten seconds and still leave stale asynchronous work alive.
  - **Smallest correction:** Pass an `AbortSignal`/interrupt token into every migrated critical operation, force-cancel the leased plugin resources, and keep the action active until cleanup settles. Reject subsequent actions if settlement fails.
  - **Verified in source:** Yes.

- **[MAJOR — RELEASE BLOCKER] Recovery selection contradicts the stated obstruction case and is too weak for door/corner acceptance.**
  - **Plan:** Task 3 geometry and bounded recovery; RED test “body-level grass obstruction triggers recovery.”
  - **Evidence:** Plan lines 348–356; current door fallback at `src/agent/library/skills.js:3577-3649`; pathfinder documents door opening as unreliable at `node_modules/mineflayer-pathfinder/readme.md:294-296`.
  - **Failure scenario:** With a body-level obstruction ahead, “forward feet/head are clear” is false, so the prescribed forward+jump recovery is never selected. Removing the existing door activation interval without an operation-scoped replacement makes doorway acceptance regress.
  - **Smallest correction:** Separate step-up/jumpable obstruction detection from clear-forward detection. Retain a lease-scoped, bounded wooden-door activation strategy until live tests prove the patched pathfinder handles doors.
  - **Verified in source:** Yes.

- **[MAJOR] Default normalization remains autonomous even before profile edits.**
  - **Plan:** Task 1 requirement 1.
  - **Evidence:** `src/agent/runtime/behavior-config.js:75-128`; missing runtime defaults to `autonomy: "balanced"` and jobs `"simple"`. `profiles/local-quickstart.json` contains no runtime block.
  - **Failure scenario:** A minimally specified or legacy companion remains balanced/autonomous despite mode-default changes.
  - **Smallest correction:** Normalize `role === "companion"` to command autonomy and jobs off unless both role and autonomy were explicitly supplied as a recognized non-companion configuration.
  - **Verified in source:** Yes.

- **[MAJOR] The rollout changes global defaults and risks silently disabling existing role profiles.**
  - **Plan:** Task 1; Task 10 activation.
  - **Evidence:** `profiles/defaults/_default.json:17-27`; `src/agent/runtime/behavior-config.js:3-14,75-128`; existing role/job paths in `src/agent/runtime/job-director.js:687-725`.
  - **Failure scenario:** Changing shared mode/default behavior affects builder/miner/lumberjack profiles and older profiles without explicit runtime fields, not only `MindcraftBot`.
  - **Smallest correction:** Gate companion behavior by normalized role and introduce it first in `profiles/local-quickstart.json`; retain legacy defaults for explicitly non-companion profiles. Add profile-matrix compatibility tests.
  - **Verified in source:** Yes.

- **[MAJOR] Full chat preservation can expose command suffixes or execute slash-prefixed content incorrectly.**
  - **Plan:** Task 7 requirements 2 and 7.
  - **Evidence:** `src/agent/agent.js:674-721`; `node_modules/mineflayer/lib/plugins/chat.js:151-166`.
  - **Failure scenario:** Removing truncation preserves the current `remaining` command syntax and sends it in game. A logical message beginning with `/` is not split and is submitted as one server command.
  - **Smallest correction:** Strip internal `!command` text from all game/dashboard dialogue payloads before delivery, and reject/escape leading slash for ordinary speech. Test long messages containing command syntax and leading `/`.
  - **Verified in source:** Yes.

Simplifications

- **[MAJOR — SCOPE REDUCTION] Remove registry synchronization from this gameplay implementation.**
  - **Plan:** Task 0 step 6.
  - **Evidence:** It targets two external registries unrelated to runtime behavior; neither appears in the expected gameplay change set.
  - **Failure scenario:** Implementation mutates external project metadata and introduces an unrelated failure/permission dependency before gameplay work starts.
  - **Smallest correction:** Record the dirty-tree baseline only in review/verification evidence. Handle registry maintenance separately.
  - **Verified in source:** Plan verified; external registries not inspected.

- **[MAJOR — SCOPE REDUCTION] Defer blueprint construction until follow, stop, navigation ownership, and one collection path pass live acceptance.**
  - **Plan:** Tasks 6, 8, and 9.
  - **Evidence:** Blueprint work introduces material resolution, support topology, chunk loading, protected cells, origin selection, placement verification, and partial-result persistence.
  - **Failure scenario:** A large building subsystem delays the player-directed core while ownership/navigation remain unproven.
  - **Smallest correction:** Baseline release should prove exact single-block placement or a supplied 3–5-cell fixture; promote the larger U-wall blueprint to the next milestone.
  - **Verified in source:** Plan and existing builder surface verified.

- **[OPTIONAL IMPROVEMENT] Avoid adding seven derived companion states initially.**
  - **Plan:** §4.2; Task 2 requirement 5.
  - **Evidence:** Existing structured action phase, owner, label, result, and navigation evidence already cover most state.
  - **Failure scenario:** A second derived-state vocabulary drifts from action/result truth.
  - **Smallest correction:** Expose owner, action, generation, hold, and navigation subphase directly; derive friendly labels only in presentation.
  - **Verified in source:** Yes.

- **[OPTIONAL IMPROVEMENT] Remove broad research/backend comparison work from the implementation path.**
  - **Plan:** §2 and §8.
  - **Evidence:** The actual decisions depend on installed Mineflayer, pathfinder, PvP, collectblock, and tool code.
  - **Failure scenario:** Research breadth consumes time without falsifying the current SDK contracts.
  - **Smallest correction:** Retain only installed-source contract checks and the bounded patched/upstream pathfinder trial.
  - **Verified in source:** Yes.

Missing Tests

- **[CRITICAL — RELEASE BLOCKER] Stale cleanup after successor acquisition.**
  - **Plan:** Task 2 RED tests.
  - **Evidence:** Global cleanup sites at `src/agent/agent.js:352-358,882-885`; skill cleanup at `src/agent/library/skills.js:1811-1815,4306-4308`.
  - **Failure scenario:** A completes late and stops B after B acquired movement.
  - **Smallest correction:** Test deferred A cleanup after B requests ownership; assert B cannot start until cleanup settles and stale cleanup cannot touch B.
  - **Verified in source:** Yes.

- **[CRITICAL — RELEASE BLOCKER] PvP listener isolation.**
  - **Plan:** Task 5 and Task 9 Layer B.
  - **Evidence:** `node_modules/mineflayer-pvp/lib/PVP.js:80-95`.
  - **Failure scenario:** PvP timeout removes supervisor listeners.
  - **Smallest correction:** Install unrelated `path_stop` listeners, force PvP stop timeout, and assert they remain.
  - **Verified in source:** Yes.

- **[CRITICAL — RELEASE BLOCKER] Collectblock/pathfinder ownership overlap.**
  - **Plan:** Tasks 4 and 6.
  - **Evidence:** `src/agent/library/skills.js:2064-2070`.
  - **Failure scenario:** Collection silently replaces supervisor movements.
  - **Smallest correction:** Instrument all `setGoal`, `setMovements`, `stop`, and control-state writes during collection; require one lease holder.
  - **Verified in source:** Yes.

- **[MAJOR — RELEASE BLOCKER] Timeout cancellation and promise settlement.**
  - **Plan:** Task 3 RED tests.
  - **Evidence:** `node_modules/mineflayer-pathfinder/lib/goto.js:16-64`.
  - **Failure scenario:** Supervisor returns while `goto()` listeners remain.
  - **Smallest correction:** Fake a never-resolving route; assert forced goal clear, underlying promise settlement, and zero listener delta.
  - **Verified in source:** Yes.

- **[MAJOR — RELEASE BLOCKER] Hold × owner policy matrix.**
  - **Plan:** Tasks 1–2.
  - **Evidence:** `src/agent/action_manager.js:140-155`.
  - **Failure scenario:** Survival is blocked or defense incorrectly bypasses hold.
  - **Smallest correction:** Cover player, background, survival, defense, and explicit new-command release while held.
  - **Verified in source:** Yes.

- **[MAJOR — RELEASE BLOCKER] Unattributed concurrent combat damage.**
  - **Plan:** Task 5 RED tests.
  - **Evidence:** Installed `entityHurt` source support at `node_modules/mineflayer/lib/plugins/entities.js:377-381`.
  - **Failure scenario:** Another actor damages or kills the target immediately after the bot swings.
  - **Smallest correction:** Assert `damage_observed_unattributed` and `target_died_unattributed`, never hit/killed.
  - **Verified in source:** Yes.

- **[MAJOR] Backward-compatible profile matrix.**
  - **Plan:** Task 1.
  - **Evidence:** `src/agent/runtime/behavior-config.js:75-176`; sparse `profiles/local-quickstart.json`.
  - **Failure scenario:** Legacy companion and explicit role profiles change autonomy unexpectedly.
  - **Smallest correction:** Test absent runtime, explicit companion, explicit builder/miner, malformed role/autonomy, and legacy mode settings.
  - **Verified in source:** Yes.

- **[MAJOR] Persistence migration and restart idempotence.**
  - **Plan:** Task 1.
  - **Evidence:** `src/agent/runtime/job-state-store.js:7-49`; `src/agent/runtime/work-order.js:132-178`.
  - **Failure scenario:** Repeated restarts erase evidence or revive suspended work.
  - **Smallest correction:** Load old schema, suspend/cancel once, restart twice, and assert no execution and preserved historical reason.
  - **Verified in source:** Yes.

- **[MAJOR] Door lifecycle and cancellation.**
  - **Plan:** Tasks 3–4.
  - **Evidence:** Existing interval at `src/agent/library/skills.js:3577-3649`.
  - **Failure scenario:** Removing it regresses doors; retaining it leaks activation after stop.
  - **Smallest correction:** Test closed wooden door, already-open door, iron door rejection, stop during activation, and no interval/listener leak.
  - **Verified in source:** Yes.

Recommended Plan Changes

- **[RELEASE BLOCKER] Insert “Task 2A: generation-scoped resource lease and cancellation contract” before navigation work.**
  - **Plan affected:** Tasks 2–5.
  - **Evidence:** All global mutation sites cited above.
  - **Failure scenario:** Later tasks build on unenforceable ownership.
  - **Smallest correction:** Define acquire/release/abort semantics and migrate critical cleanup before creating the supervisor.
  - **Verified in source:** Yes.

- **[RELEASE BLOCKER] Decide explicit adapters for pathfinder, PvP, and collectblock.**
  - **Plan affected:** Tasks 3–6.
  - **Evidence:** Installed plugins directly mutate shared pathfinder state.
  - **Failure scenario:** “Single owner” exists only in telemetry.
  - **Smallest correction:** Document one owner per operation and ban direct plugin calls outside adapters with a source test.
  - **Verified in source:** Yes.

- **[RELEASE BLOCKER] Replace combat metadata fallback with an unattributed evidence state.**
  - **Plan affected:** §4.3 and Task 5.
  - **Evidence:** Installed source already supplies attribution on 1.20+.
  - **Failure scenario:** False hit/defeat narration.
  - **Smallest correction:** `attempted → attributed_hit | damage_observed_unattributed`; only attributed hits qualify for bot-confirmed defeat.
  - **Verified in source:** Yes.

- **[RELEASE BLOCKER] Resolve persisted-work handling without inventing unavailable session identity.**
  - **Plan affected:** Task 1 requirements 4–6.
  - **Evidence:** No session identity exists in `work-order.js`.
  - **Failure scenario:** Evidence deletion or accidental resume.
  - **Smallest correction:** Convert stale companion orders into preserved terminal historical records; defer session-bound resumability.
  - **Verified in source:** Yes.

- **[RELEASE BLOCKER] Specify exact cancellation sequence.**
  - **Plan affected:** Tasks 2–4.
  - **Evidence:** `goto()` and PvP both have asynchronous stop behavior.
  - **Failure scenario:** New action starts during old plugin teardown.
  - **Smallest correction:** Signal abort → force leased resources idle → await operation/plugin settlement → remove owned listeners → publish terminal result → release lease → permit successor.
  - **Verified in source:** Yes.

- **[MAJOR] Split live rollout into two gates.**
  - **Plan affected:** Tasks 8–10.
  - **Evidence:** Current plan combines authority, navigation, combat, collection, building, chat, and control-plane rollout.
  - **Failure scenario:** Failures become hard to localize and rollback.
  - **Smallest correction:** Gate A: idle authority, follow, stop, corner/door recovery, chat. Gate B: combat, one collection, minimal placement. Expand blueprint only afterward.
  - **Verified in source:** Yes.

- **[MAJOR] Remove registry writes and make activation profile-scoped.**
  - **Plan affected:** Task 0 and Task 10.
  - **Evidence:** Shared defaults affect more than `MindcraftBot`.
  - **Failure scenario:** Unrelated metadata or bot roles change during rollout.
  - **Smallest correction:** First activate through `profiles/local-quickstart.json`; change global defaults only after compatibility tests.
  - **Verified in source:** Yes.

Go/No-Go Conditions

**NO-GO until all release blockers below are satisfied:**

- A generation-scoped lease prevents stale action, mode, idle-handler, PvP, and collectblock cleanup from touching a successor.
- Combat uses exactly one navigation owner; the plan explicitly chooses PvP-owned pursuit or supervisor-owned pursuit.
- PvP no longer removes unrelated `path_stop` listeners.
- Timeout/interrupt forces underlying SDK operations to settle before ownership transfers.
- Combat “hit” requires bot-attributed damage; disappearance alone never proves death.
- Stale companion work is preserved as non-executable history without relying on nonexistent session identity.
- Hold policy explicitly distinguishes survival, defense, and a fresh player command.
- Pathfinder reset events have an explicit observational/recoverable/terminal classification.
- Door handling remains bounded and operation-scoped until live evidence supports removal.
- Profile-matrix tests prove non-companion roles retain prior behavior.
- Gate A passes repeatedly in the live game before combat, collection, or building rollout.

**GO after those conditions pass**, with larger blueprint construction, richer companion-state labels, and backend reconsideration treated as follow-on work rather than baseline prerequisites.