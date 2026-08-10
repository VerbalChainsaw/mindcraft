# Minecraft Companion Master Project Plan

**Last updated:** 2026-08-09

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
- For explicitly diagnostic disposable-world campaigns, follow `docs/contracts/diagnostic-continuation-policy.md`; the preserved pre-extension policy is archived at `docs/archive/2026-08-09-original-first-blocker-policy.md`.

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
- [x] Checkpoint `1cf3501` repairs the owned Pathfinder waterline primitive rather than wrapping it in project movement code. Water-to-bank jump height is measured from the occupied liquid cell instead of the submerged floor; open water exposes its final native emergence edge; that edge survives path normalization; and execution remains in swim mode until the feet cell is physically dry. The root dependency and lock now consume that committed package directly instead of installing the public tarball plus a patch overlay. Natural production Follow on the canonical owned package climbed the same ordinary one-block grass bank from deep, low-surface, and offset starts in 1.3s, 2.5s, and 1.8s, landed on verified support, and ended healthy under Stop.
- [x] Checkpoint `370f31b` completes the open-water continuation contract. Full recovered air is a truthful survival success even when no loaded shore exists; a player Follow request arriving during the critical reflex is registered without corrupting physical ownership; and deterministic Follow resumes after the reflex. Paper proved deep-water rescue in 5.1 seconds and dry-shore arrival 2.75 blocks from the player in 10.6 seconds at health 20 and full air.
- [x] Checkpoint `4fa25d5` gives V2 an independent exact dependency tree and lock, and moves canceled chest-window ownership into a single-generation Mineflayer gate. Paper proved prompt Stop, full response-horizon quarantine, later fresh transfer, and exact chest/inventory restoration.
- [x] Direct Agenda terminal results are persisted before dispatch ownership is released; a Paper Stop-plus-restart proof retained the completed step exactly once and did not replay it.
- [x] The broad farm companion session now passes in one run: natural Follow, standing attributed companion protection within 50 ms of player damage, hostile defeat, deterministic Follow resumption without another order, stationary `0.9995` gaze alignment, authoritative Stop, and hold-safe runtime configuration. Jordan accepted and froze this tranche in `J2C-20260806-1208-broad-farm-companion-accepted`; the sentence established Follow rather than a new explicit Guard owner.
- [x] One natural escorted-worksite request now completes end to end: Follow crosses meaningful water through native Pathfinder shoreline recovery, a bounded typed Agenda condition identifies the player-designated furnace, the existing smelter consumes live carried material and shared fractional fuel data, Follow resumes for the return trip, and ordinary Stop holds the bot. The exact furnace coordinates and dimension now persist atomically onto the dependent smelt step; a local Paper proof showed the designated furnace working while a closer decoy remained empty and unlit.
- [x] The natural indefinite request `go make some rails` now enters GoalDirector as one generic recipe-batch outcome instead of model-owned command improvisation. Connected-registry target binding prefers a safe recipe over dismantling a placed crafted block, collection frees bounded redundant natural-fill stacks while retaining at least 16 of each material, and an exhausted capacity precondition cannot consume productive attempts. The unchanged live request collected and smelted its iron, crafted 16 rails with zero productive failures, passed Paper inventory/health verification, and ended under Operator Stop.
- [x] The generic construction engine now accepts one persisted mixed-material blueprint, audits already-satisfied world effects, derives missing materials through the shared prerequisite planner, places any currently supported carried cell in stage order, resumes the exact bound site across Stop/restart, returns from remote acquisition through a typed surface-access prerequisite plus native Pathfinder, and completes only on an exact world audit. The live 44-cell campaign independently acquired stone/iron/gold/redstone/fuel and intermediate tools/components, resumed from partial physical state, and Paper verified all 44 cells plus four actively powered rails. No rail recipe, route, controller, or item-specific build planner was added.
- [x] Checkpoint `cad4bf3` then completed a materially different custom 72-cell functional workshop through the same engine. The model compiled one bounded blueprint, the Builder selected a safe surface site, recovered from a restart after supplying wood and charcoal prerequisites, and Paper verified a clear entrance, lighting, crafting table, furnace, chest, exact cells, health 20, and zero productive failures. The repairs were shared site-ranking, held-request ownership, and bounded cached planner perception—not workshop recipes or a second construction path.
- [x] The final natural overnight-outpost campaign completed on the same generic engine. One request compiled and built a 111-cell spruce outpost with a clear two-block door, three windows, interior light, exact bed, crafting table, furnace, chest, enclosure, and roof; it survived a controlled Stop/restart, remote resource acquisition, combat, food recovery, partial-fuel smelting, and worksite return. Paper independently verified the fixtures and roof. The durable dependent Agenda step then used the exact bound bed and completed a real one-player sleep-to-dawn transition. The shared repairs were causal design feedback, survival-owner separation, useful partial smelting, waitable world preconditions, and an owned Mineflayer sleep receipt—not an outpost recipe or second executor.
- [x] The natural broad request for a complete iron tool set now compiles into five generic acquisitions plus five exact deposits without item-specific routes. The bot independently gathered wood and iron, made and used prerequisite tools and workstations, preserved the outpost, recovered failed ore regions, returned through native Pathfinder from an unloaded work region, loaded and validated the exact bound chest, and stored one pickaxe, axe, shovel, hoe, and sword. Paper verified all five exact chest items, no requested tools remained on the bot, health 20, and the protected foundation and door stayed intact. Agenda-owned typed-goal failures now settle upward for bounded Agenda retry instead of activating standalone-goal Hold or announcing a false terminal outcome.
- [x] The broad river companion request now completes through the existing companion lanes: native Pathfinder crossed meaningful water, settled on supported dry land, attributed protection preempted Follow to defeat a hostile, and deterministic Follow resumed without another order. The bot then followed the player inland and retained Follow across a disconnect/reconnect. V2 now prevents a water cell from satisfying dry-player Follow settlement, and ordinary open chat counts only other profiles actually in game. The native package already owns settled gaze; the apparent gaze failure exposed and corrected a shared Mineflayer-yaw sign error in canonical perception instead of adding a second gaze controller.
- [x] One broad outpost-improvement request now compiles a function-constrained general structure instead of reducing to a canned pen or free-form narration. Durable Agenda required containment and light; the existing design language composed `@pen` with a supported torch; generic material planning produced a matched spruce fence/gate family; site probing and Builder execution agreed on support; and the unchanged live order completed all 50 cells with zero productive failures. An independent observer matched every cell, operated and reclosed the gate, and found the nearby chest, furnace, and crafting table intact. Current routing also preserves explicit gate/access intent, while the accepted review correction removed the solved lit-pen command from request prompting. Earlier bot-owned failed-build artifacts remain explicitly uncleaned pending exact ownership mapping.
- [x] Ordinary play exposed and repaired a generic manufactured-output seam: bare requests such as `Make charcoal` now give registry-backed item goals priority over model-owned construction, full-inventory smelting reserves a stable carried slot through the furnace interaction, and smelting counts only output verified in the player inventory. The unchanged request completed through GoalDirector and Paper independently found two carried charcoal; no charcoal recipe or route was added.
- [x] Ordinary play exposed and repaired a generic started-tree stewardship seam. Lumberjack work now finishes the bounded connected natural tree it starts through the owned CollectBlock/Pathfinder path, while recipe prerequisites remain quantity-bound. The same 26-neighbor discovery covers straight, branching, diagonal, 2x2, rooted, and supported Nether stems without species recipes; oversized components and unreachable remainders fail truthfully instead of being silently cored. In the unchanged world, a one-log whole-tree action removed a five-log acacia component, inventory rose from one to six after settled pickup, and Paper verified health 20.
- [x] A post-checkpoint natural mobility run crossed five distinct savanna, beach, shallow-water, and slope landmarks without source changes; every Follow leg converged in 2.9-17.3 seconds at health 20. The same session family then saved `river camp`, followed the player 64 blocks away, obeyed Stop, and navigated independently back to the durable named point within one block. This is the basic persistent place-memory outcome Gabriel requested, not a generalized scouting claim.
- [x] The next mobility/collection checkpoint fixes shared progress truth at the package boundary. Owned CollectBlock completes the mined block's physical drop before selecting another trunk target and bounds each target's native route search; a natural four-oak-log request completed in 10.4 seconds. Native route-computation timeout is no longer misclassified as local collision geometry: the same unreachable sky-player route returned one truthful failure in 9.1 seconds instead of sidestepping into an identical second search. Paper retained health 20, full survival recovery, and exact inventory.
- [x] The broad landing-area starter-supply request now compiles one complete model-selected output list into a durable typed Agenda before physical work begins. Each entry is a minimum carried floor rather than a blind additional quantity, and a final aggregate checklist restores any promise consumed by later work before allowing the return step. The full unchanged run independently gathered coal, crafted torches, reconciled both coal and torch floors after cross-step consumption, and returned with all four stone tools, 16 oak logs, 50 cobblestone, 8 coal, and 19 torches. A same-request repeat reverified the carried set and returned through native Pathfinder in 16 seconds. Paper observed the bot remain beside the player without movement for 15 seconds at health 20/full air; command-only autonomy now suppresses optional survival-lane debris collection while retaining bodily survival, self-defense, and player-defense.
- [x] The unchanged natural request to set up a small shared work area and return now becomes one durable construction barrier followed by one typed player-return step. The model composed a bounded 33-cell structure with access, crafting, smelting, storage, and light through the generic design language; Builder completed it from carried inventory with zero productive failures, and Paper verified every cell under the authoritative placement contract before the bot returned beside the witness. Generic setup verbs, multiword worksite nouns, required-function guidance, curly punctuation, and return phrasing were repaired at shared language/Agenda boundaries. Command-only idle survival no longer invents optional shelter construction after terminal player work; a live night proof retained bodily survival and defense while the healthy bot stayed idle.
- [x] Randomized supervised play then exercised one natural cave/iron/coal/return outcome. The request now remains one durable Explorer order plus a settlement-dependent return, retains every named resource, prevents terminal job replay, and uses native round-trip route proof for cave and exposed-ore stances. Owned Mineflayer placement receipts tolerate delayed authoritative cache updates, ordinary Pathfinder movement no longer builds towers or declares a stall before its own search horizon, and “surface” now means a stance with a native route to surrounding terrain rather than merely open sky. The live run preserved the worksite, increased coal from 8 to 10, failed missing iron honestly, climbed from the exact formerly false y70 surface to a usable y72 exit, and returned beside LandingWitness at health 20.
- [x] The follow-on cave campaign now binds the existing deterministic mining-corridor strategy after exposed-cave exhaustion, protects every accumulated feet/head/support cell from later excavation, propagates that route contract through capability binding, and retraces exact cleared cells with native Pathfinder and digging disabled. Its delegated all-in-one replay completed inside the broader Resource-to-Project request: the bot retained nine fresh raw iron and nine fresh coal from the expedition, returned over its saved route, manufactured the requested iron pickaxe and bucket, stored both in the exact chest, and returned to the player at health 20. Carried excavation debris can now fund bounded capacity recovery while world cobblestone remains protected.
- [x] Resource-to-Project composition is physically accepted. One natural request became a durable generic Explorer order, two GoalDirector acquisitions, two exact deposits, and one player return; it added no item recipe, ore route, controller, or executor. The last blocker was not crafting logic: owned Pathfinder abstracted away which side of a partial fence collision cell the body occupied and advertised a first edge through the fence onto a furnace. The package now preserves the exact initial body pose, rejects collision-crossing first edges, retains real open-side and low-enclosure exits, and routes around the obstruction. Paper verified a second iron pickaxe and one bucket in the selected chest, the bot beside LandingWitness, health 20, and durable Operator Stop.
- [~] Home Stewardship now has one generic retained-inventory cleanup path. Cognition selects only authorized carried surplus once; Agenda persists canonical item/retain floors plus one exact chest; Mineflayer owns the real window and transfers; V2 preserves the best durable copies, verifies both inventories, and preflights the complete container capacity before moving anything. The first live run safely deposited 67 raw iron, 34 coal, 64 granite, 33 diorite, 256 cobblestone, 51 andesite, 84 dirt, 10 sand, and one wooden pickaxe before exposing the missing preflight. On the corrected unchanged rerun, the exact chest had three free slots while ten extra stone pickaxes required ten, so the bot moved nothing, spent one attempt instead of two, returned to the player, and Paper verified every item and health 20 unchanged. Full all-groups cleanup remains externally blocked by the selected chest's physical capacity; the exact-slot durable-tool success path is installed but not yet physically accepted.
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

### Additive diagnostic-continuation exception

The first-material-blocker loop above remains the normal development and
acceptance rule. When the Director or active campaign explicitly requests a
disposable-world diagnostic run, a settled operational failure may be
checkpointed and narrowly scaffolded so independent downstream capabilities can
be exercised in the same run. Unsafe, unsettled, authority-violating, corrupt,
or causally ambiguous failures still stop immediately. Scaffolded completion is
diagnostic only; the unchanged unassisted request must still pass for acceptance.
The binding procedure and evidence labels are defined in
`docs/contracts/diagnostic-continuation-policy.md`.

## Playtest-first priority order

The supervised-play entry gate has passed. The next objective is to turn the proven engine into a companion Gabriel can use naturally for sustained sessions, not to certify another noun, recipe, fixture, or isolated mechanic.

1. **Control and intent:** distinguish ordinary nearby conversation from addressed work, keep terminal and stopped goals dead, and preserve the companion idle contract.
2. **World respect and reuse:** bind the designated shared outpost, prefer its furnace and chest, and preserve its house, farm, paths, fixtures, contents, and access.
3. **Resource responsiveness:** the first real collection-heavy play request exposed partial-tree acceptance, now repaired at the shared natural-tree primitive. The landing-area request then proved complete multi-item planning, minimum inventory floors, cross-step reconciliation, and meaningful regional recovery. The randomized cave request now has a second deterministic mining-corridor strategy, an accumulated non-self-destructive return route, player-relative retained-result settlement, and route-derived excavation-debris capacity. Keep these source changes frozen; let the next ordinary collection-heavy request provide the integrated replay and expose the next real method gap rather than inventing another ore campaign.
4. **Sustained truthful play:** run longer mixed companion sessions now. Exercise Stop/restart when ordinary play requires it, not as a ritual; fix stale ownership, misleading narration, or replay only when physically observed.
5. **Broaden gameplay by outcomes:** add exploration, farming, combat, building, transport, and advanced mechanics through useful natural requests—not mechanic inventories or item-by-item certification.

Known bounded defects remain visible without becoming preemptive projects: table crafting still bypasses the container-open generation gate; indefinite manufactured delivery may transfer only the parsed requested quantity rather than the full recipe batch; runtime learning can rank sources but cannot yet switch between genuinely different acquisition strategies; planner workstation perception is capped below the executor's approach range; and identical retryable capability signatures can still be replayed across nested GoalDirector/Agenda budgets. Activate each only when broad play reaches it, except that a repeated identical signature must terminate or change method promptly if observed again.

## Broad campaign program

Gameplay expansion is organized into four player-valued campaign families, not
individual recipes or mechanics:

1. **Companion Journey:** travel with the player, remain close without
   oscillation, cross ordinary terrain and water, protect the player, obey
   interruption and Stop, and return safely.
2. **Resource-to-Project:** gather raw materials, manage tools and inventory,
   reuse or establish authorized infrastructure, manufacture a useful finished
   outcome, store or deliver it, and return.
3. **Home Stewardship:** use a lived-in base without damaging structures, paths,
   farms, contents, or access; maintain and restock authorized shared fixtures.
4. **Explore-Remember-Guide:** scout a bounded area, remember useful places and
   observations, report truthfully, guide the player, and return home.

Campaigns rotate one or two real stress conditions—authority changes, survival
hazards, interruption/restart, another player, or resource scarcity—rather than
running every permutation. Every campaign uses the same acceptance questions:
did the requested world outcome exist; did player authority and Stop hold; was
the world preserved; did long work make progress or change strategy promptly;
did interruption avoid replay; and was the final report truthful?

An ordinary run still repairs the first material shared blocker. An explicitly
diagnostic run may continue after a fully settled safe failure under
`docs/contracts/diagnostic-continuation-policy.md`, but scaffolded evidence never
counts as acceptance. The unchanged unassisted Paper-verified request remains
the final gate.

### Completed lane: Resource-to-Project

The active broad request is:

> Stop, use this outpost as home. Find a cave and gather 8 fresh iron and 8
> fresh coal without damaging our buildings or paths. Return, make an iron
> pickaxe and bucket with our furnace and table, and store both tools in this
> chest, then come back to me.

This combined mining capacity with durable planning, strategy selection, tool
and inventory management, smelting, crafting, bound infrastructure, exact
storage, stewardship, player-relative return, and truthful settlement. The
unchanged request passed physically on 2026-08-09 after the owned Pathfinder
partial-collision start primitive was corrected. Freeze this campaign; do not
turn its workstation arrangement or item quantities into new acceptance slices.

### Active lane: Home Stewardship

The first ordinary shared-base cleanup request now compiles and executes through
one durable generic storage plan. Its corrected rerun reached a truthful world
precondition: the exact selected chest had three free slots but the remaining
authorized tool cleanup required ten. Resume Home Stewardship with adequate
player-authorized existing storage or another ordinary maintenance/restocking
outcome. Do not enlarge the chest, move unrelated contents, place storage, or
invent a capacity permutation merely to certify the installed path.

## Next-stage product program

The project is now in player-led capability expansion. These goals are ordered by player value and safety, not by code-layer neatness:

1. **Convincing supervised companion sessions.** Gabriel should be able to talk normally, issue an addressed multi-stage request, travel with the bot, encounter ordinary danger, receive truthful progress or a precise blocker, and end the session with Stop. The next session is unscripted enough that real play—not a prepared noun—selects the first repair.
2. **World stewardship in a lived-in base.** The bot must preserve buildings, paths, farms, contents, and access; reuse the player's designated furnace, crafting table, chest, shelter, farm, or work area; and refuse uncertain destructive mutations rather than guessing ownership. Extend existing bindings and safety checks only when play exposes a concrete gap.
3. **Responsive resource work.** Long actions must produce verified movement or inventory progress within a few seconds, change target/region/strategy after repeated no-progress evidence, and fail truthfully when no second strategy exists. Do not raise attempt ceilings or automate against unvalidated lifetime statistics.
4. **Durable truthful continuity.** Player goals, jobs, direct Agenda results, selected workstations, baselines, failed targets, and Operator Hold must remain monotonic through real interruption or restart. Terminal work must never resurrect, replay, or fall into unrelated autonomy.
5. **Broader player capability.** Add missing exploration, transport, farming, combat, building, and advanced-progression behavior only when a useful natural request reaches that domain. Grow the existing capability catalogue and owned packages at the demonstrated seam; never teach recipes one by one or introduce another executor.
6. **Release readiness after playability.** Only after sustained single-companion sessions are dependable should the project spend a tranche on cross-session repeatability, packaging, operator UX, or additional bots. Release evidence must come from the exact shipped runtime rather than a parallel harness.

The current working session ends with IronSuiteProof Operator Stop-held after the first Home Stewardship request reached a precise external capacity blocker. Freeze the generic cleanup compilation, exact-container binding, capacity preflight, single-attempt failure, and player return. Continue broad lived-in-base play from adequate player-authorized storage or another useful maintenance outcome; do not turn this into a chest-size test series. Preserve the package-first movement mandate, generic capability catalogue, one ActionManager executor, and broad-run acceptance rule.

## Remaining product tranches

### 1. Companion presence and player authority

- [x] Run the approved broad farm companion session: Follow, attributed hostile preemption, defend the player, resume Follow without model restoration, and settle nearby gaze.
- [x] Freeze natural Follow, standing attributed companion protection, deterministic resumption, settled gaze, and Stop after the accepted integrated session; do not rerun companion-control permutations without a later broad regression.
- [x] Finish reliable swimming/follow settlement without oscillating through the player. The broad river campaign crossed meaningful water and settled on supported land through native Pathfinder; project policy prevents false completion in water, while the owned package now represents and executes the final emergence-plus-step-up transition onto an ordinary bank.
- [x] Distinguish orders addressed to the bot from nearby player conversation. The shared-outpost campaign proved nearby first-person chatter remained conversation while the explicitly addressed stocking request entered durable work.
- [x] Keep nearby gaze on the player without stealing active-action control during the integrated farm companion session.
- [x] Preserve self-defense and player-defense while idle; never resume stale or terminal work. Farm and river companion sessions proved attributed protection, deterministic Follow resumption, and authoritative Stop without resurrecting terminal work.

### 2. World stewardship and shared infrastructure

- Protect player and foreign structures from unauthorized digging, placement, shelter construction, and route excavation.
- [x] Complete one natural broad outcome that accompanies the player through meaningful water, binds infrastructure the player explicitly designates, reuses it for a useful operation selected from live materials, returns with the player, and ends under ordinary Stop authority.
- Freeze the proven river/worksite/furnace route. Future broad requests may reuse its shared primitives, but do not manufacture shoreline, furnace, or smelting permutations absent a product-scale regression.
- Prefer non-destructive native routes; do not tear up terrain, paths, or buildings for convenience.
- Discover and reuse reachable furnaces, crafting tables, storage, farms, shelters, and player-designated shared structures.
- [~] Compile broad inventory cleanup into one exact-container retained-inventory plan, preserve requested gear, and reject insufficient capacity before mutation. The natural outpost cleanup physically proved exact binding, native stackable transfers, unrelated-content preservation, one-attempt capacity refusal, and player return; complete success remains pending adequate authorized storage.
- Bind building work to an explicit player-owned site and cleanup contract instead of ad-hoc block placement.
- [x] Farm establishment binds a complete rectangular hydrated site, safe service stances, and a non-destructive native route before changing soil; this proves farm-site stewardship only, not general structure ownership.

### 3. Repeatable capability engine

- Grow the typed capability catalogue only when broad scenarios expose a missing composable operation.
- Give planner-visible operations explicit preconditions, binding, effects, execution, verification, cancellation, and failure evidence.
- [x] Indefinite manufactured-item language binds one recipe batch generically; placed crafted blocks are not treated as preferred free resource sources.
- [x] Collection can reclaim bounded working capacity from redundant natural excavation fill without sacrificing target materials, and terminal capacity blockage remains a non-productive precondition failure.
- [x] Mixed-material construction is driven by blueprint effects and shared capability dependencies rather than one recipe-at-a-time orchestration. Durable state-only prerequisites settle before the next physical action, remote acquisition cannot erase verified cells, and native Pathfinder—not a same-height binary—is authoritative for escaping a bounded work footprint.
- [x] Prove the same engine on a materially different custom functional structure: the 72-cell workshop completed with access, light, crafting, smelting, and storage on unchanged generic construction semantics.
- [x] Prove one broad usable overnight outpost at a player-designated site, including construction and actual use. The 111-cell natural campaign completed after one controlled Stop/restart and finished by sleeping in its exact bound bed; the live blockers selected shared oriented-fixture, ownership, survival, smelting, time-precondition, and Mineflayer sleep-transition repairs.
- [x] Prove one broad multi-output manufactured set through the generic prerequisite engine and exact storage. The five-tool campaign completed all ten durable steps, including a remote unloaded-container return, without recipe-specific orchestration.
- [x] Complete the broad outpost expedition: the natural request stayed one durable operation, prepared supplies generically, searched bounded home-centered regions through native Pathfinder, lit a real cave, mined eight new exposed coal, returned to the exact home binding, and stored only the new manifest in the bound chest. Paper verified the original tool set, baseline inventory, chest, crafting table, furnace, and final position. Unquantified expeditions now persist best-effort batch intent so bounded geology can return verified nonzero output; explicit quantities remain exact.
- [x] Complete the broad river companion tranche: cross meaningful water with a designated player, stay close without oscillating through them, preserve self/player defense, resume Follow after danger, settle on land, and face the player through native package behavior.
- [x] Combine conversational authority with shared-outpost stewardship: ordinary nearby first-person conversation does not start work; addressed stocking reused the selected furnace and chest, produced useful food, preserved baseline contents and fixtures, and ended under Operator Stop.
- [x] Prove function-constrained general construction in the lived-in outpost: one natural lit-pen request completed through Agenda, design compilation, generic material acquisition, exact placement, and physical gate verification.
- [x] Complete Gabriel's ordinary landing-area starter-supply request through one durable model-selected item plan, generic prerequisites, aggregate minimum-floor verification, and native return.
- [x] Complete the follow-on shared-worksite request through one function-constrained Builder order plus durable return, then prove that command-only idle survival does not invent optional construction after completion.
- [x] Use randomized two-player play to select the next blocker: the cave/iron/coal/return request proved durable multi-resource intent, protected-site departure, return-safe cave/ore stance binding, truthful terminal failure, real surface egress, and player return.
- [x] Complete that unchanged request by binding a second deterministic acquisition strategy after cave/exposed-ore no-progress. The follow-on Resource-to-Project run used the same corridor strategy to acquire nine fresh raw iron and nine fresh coal, manufactured and stored an iron pickaxe and bucket, preserved the work area, and returned at health 20 without item-specific planning.
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
