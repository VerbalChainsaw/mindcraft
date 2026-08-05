# Forward Plan: Build the Companion Through Proven Hybrid Slices

**Date:** 2026-08-03
**Starting commit:** `cd71c8d8f7f1e8b2a1f66edf0bd8612d944d8874`
**Architecture decision:** preserve the deterministic Mineflayer body and extend persistent goal ownership only where live compound gameplay proves it useful.

## Product objective

Build a companion that can receive an ordinary player request, continue through prerequisites and recoverable failures, survive interruptions, finish the physical task, and report the result truthfully.

Progress is measured in playable capabilities, not document volume, harness count, or architectural surface area.

## Frozen ownership and capability boundary

The hybrid architecture is binding:

- `GoalDirector` owns durable player outcomes, completion predicates, reassessment, strategic recovery, persistence, and truthful completion or failure.
- The prerequisite planner selects bounded deterministic operations. It does not issue physical controls.
- A declarative capability catalogue is the mandatory boundary between planning and execution. It is not an optional cleanup and must not be bypassed by adding more item-specific routes or nested miniature planners.
- `ActionManager` remains domain-neutral and is the only serialized physical-action owner. It owns priority, one action deadline, cancellation, settlement, and structured results; it does not become a second planner.
- Capability binders and adapters own source-specific feasibility and safe physical execution. Mineflayer core and mature plugins execute ordinary mechanics wherever they can satisfy the contract.
- `BehaviorArbiter` and the existing behavior directors retain follow, stop, combat, survival, hazard, and persistent-work lanes.
- The LLM may interpret intent and explain verified results. It does not restore, micromanage, or physically execute deterministic prerequisites.

Continuous geometry is not promoted into symbolic planning. A safe mining stance, route, support, headroom, liquid boundary, durability reserve, or workstation position is evaluated by a capability binder against fresh Minecraft state. The planner receives a viable binding or a typed failure and may then change source, target, region, prerequisite, or strategy.

Local mechanical recovery stays inside the bounded adapter when it is part of executing the same binding, such as opening a door, leaving shallow water, collecting a nearby drop, or settling a plugin operation. Strategic recovery belongs to `GoalDirector` and must not be hidden inside long physical loops.

## Declarative capability catalogue contract

Every operation available to the prerequisite planner must be registered through one typed contract with these responsibilities:

```text
id
parameters
preconditions(snapshot, arguments)
expectedEffects(snapshot, arguments)
bind(context, arguments, signal)
execute(binding, actionContext)
verify(before, after, binding)
cost(snapshot, arguments)
```

The contract means:

- `preconditions` describe symbolic requirements already knowable from canonical state, such as inventory quantity, equipment, usable tool tier, fuel, and workstation access.
- `expectedEffects` describe the bounded state change the planner may rely on, such as an inventory increase, consumed inputs, equipment destination, verified placement, or delivery.
- `bind` selects and validates a concrete live target, safe stance, route policy, tool, workstation, or entity. Binding may observe the world but may not take physical control.
- `execute` invokes the existing deterministic skill or package adapter under the current `ActionManager` action, signal, and deadline.
- `verify` checks authoritative Minecraft state. Command acceptance, narration, or a resolved promise is never an effect.
- `cost` ranks already legal alternatives; it may not override safety, permissions, ownership, or bounded attempts.

Capability outcomes use typed categories rather than strategy-driving string inference:

- `precondition_missing`;
- `binding_failed`;
- `execution_failed`;
- `verification_failed`;
- `interrupted` or `preempted`;
- `deadline`;
- `physical_owner_unsettled`.

Every failure carries the concrete target or missing prerequisite, verified progress, retryability, timing, and enough identity to prevent an identical failure signature from consuming the entire goal budget.

The first catalogue is deliberately small:

1. collect a block/source;
2. collect wood;
3. craft;
4. place or recover a workstation;
5. smelt;
6. equip;
7. retrieve a drop;
8. deliver.

Ordinary navigation remains a mechanic used by binders and adapters unless reaching a destination is itself the requested outcome. Do not turn every walk, jump, mining step, or pickup nudge into a planner node.

Migration is incremental. Existing executors are wrapped first, then hidden prerequisite decisions are removed only after the replacement capability is physically proven. Do not wholesale-rewrite `skills.js`, introduce another executor, or pause gameplay progress for a speculative framework build.

## Mineflayer and plugin evolution policy

Package-first does not mean package-passive. Mineflayer and its plugins are dependencies we may configure, adapt, patch, ingest, and privately maintain when evidence shows that the defect belongs there.

The binding dependency-ownership plan is [Owned Minecraft Runtime Dependency Strategy](./2026-08-03-owned-runtime-dependency-strategy.md). We do not contribute companion changes upstream. External repositories are read-only sources and compatibility references; mechanics we must change move into pinned companion-owned packages after an exact-parity migration.

Use this escalation order for a demonstrated physical blocker:

1. Confirm the exact installed package and Minecraft versions and reproduce the failure through the existing integration.
2. Correct movement policy, configuration, API usage, or ownership/cancellation adaptation when the package already supports the mechanic.
3. Apply a narrow, versioned local package patch when the upstream implementation violates the required mechanic or cancellation contract. The existing `patch-package` workflow and `patches/mineflayer-collectblock+1.6.0.patch` are the established precedent.
4. With Director approval, ingest a compatible external version or selected commit into the companion-owned source when it contains a useful repair. Verify protocol, Mineflayer, Pathfinder, plugin, and Minecraft compatibility in the real runtime.
5. If the defect is material, implement it in the focused companion-owned package rather than growing a competing movement, collection, combat, or inventory engine inside project skills.

A package patch or version change must be reproducible: pin the exact source commit, commit the complete dependency lock, preserve the superseded patch until parity is proven, document why configuration or a thin adapter was insufficient, and physically rerun the acceptance scenario. V2 must have an independent dependency tree and may not use the frozen control's `node_modules`. Dependency changes remain approval-gated; local evidence, not package deference or novelty, decides the boundary.

## Working method

Each coding cycle follows one compact loop:

1. Select one useful player outcome.
2. Run it in a disposable live world.
3. Identify the first blocker that prevents completion or truthful continuation.
4. Repair the smallest existing seam.
5. Add at most one focused regression for the observed defect.
6. Repeat the same live request.
7. Commit and push the functional result.

A cycle is complete only when the bot physically succeeds or stops with a precise, honest blocker that identifies the next coding move.

## Current transition gate

Iron pickaxe, shield offhand, and one bucket were physically completed and independently verified. The additional-bucket repeatability gate then passed at `b8f17d1`: the same natural request used the V2-owned Pathfinder, mined and smelted iron, crafted a second bucket, and Paper verified the inventory count increased from one to two.

The completed repeatability gate required:

1. Preserve the current uncommitted recovery tranche.
2. Rerun the same additional-bucket request from the preserved baseline.
3. Prove productive and recovery attempt separation, exact failed-target propagation, one action-level deadline, cancellation settlement, generic tool replacement, workstation recovery, and prompt-free deterministic goal resumption.
4. Require the second bucket to be verified in Minecraft state.
5. Commit and push the functional checkpoint.

That gate is now preserved and pushed. Begin the incremental capability-catalogue migration without reopening bucket-specific planning or changing the verified physical ownership boundaries.

This active gate and the immediate-next-move section control execution order. The numbered phases below remain capability milestones and may not be used to route around the repeatability gate or delay the initial catalogue tranche.

## Active 2026-08-05 tranche: bounded buried-resource corridor binding

The capability catalogue has now proved unrelated collect/craft/smelt/equip chains through an iron shovel, minecart, and two compasses. The next unrelated natural request, `Please make a clock.`, exposed one shared binding defect rather than an item recipe gap.

At `0bb9385`, the exact buried-target binder:

- evaluates every prospective cardinal stance beside the selected ore;
- generates only fixed axis-ordered routes with at most one dogleg and six extra steps;
- preflights each full route for support, headroom, liquids, falling blocks, protected blocks, tool durability, excavation count, deadline, and returnability;
- delegates locomotion through each cleared cell to the V2-owned Pathfinder with digging disabled.

The safety and execution boundaries are correct. The route generator is not complete enough for ordinary mixed geology. Two distinct gold regions rejected all 64 offered routes with different distributions: `unsafe_route_support:29, non_natural_block_in_route:20, liquid_ingress_risk:15` and `non_natural_block_in_route:48, unsafe_route_support:12, liquid_ingress_risk:4`. A later target admitted one verified prefix, showing that excavation and Pathfinder settlement can work when the offered geometry is viable. The same goal later reached Y6 while satisfying tool prerequisites and finally failed on underground wood reacquisition; that is downstream evidence, not a reason to bypass the corridor defect.

The selected repair is one bounded deterministic voxel search at the existing binder boundary. It may choose exact supported standing cells and authorized excavation, but it may not execute movement. The search must:

1. consider only cardinal one-cell moves and monotonic elevation toward the exact usable stance;
2. reject a step immediately through the existing support, headroom, liquid, falling-block, protected-block, and target-preservation checks;
3. carry required-support and excavation sets so a later step cannot destroy the return route;
4. remain inside the existing route-length, excavation, durability, deadline, and finite-expansion ceilings;
5. return a complete preflighted route or a typed bounded failure before breaking any block;
6. leave `executeMiningAccessPlan()` and native Pathfinder traversal through already-cleared cells unchanged.

Rejected alternatives:

- Driving the current Pathfinder graph as a dig-enabled dry-run is lower effort, but its neighbor model admits diagonals, placements, drops, and movement shapes that the exact corridor executor deliberately forbids. Repeatedly post-rejecting those paths would recreate the current template-rejection loop.
- Expanding the fixed dogleg table was physically tried with wider offsets and did not generalize. More templates would preserve the root defect.
- Moving companion safety policy into the owned Pathfinder package would mix target authorization, durability, destruction budgets, and returnability into a locomotion dependency. No dependency change is required for this tranche.

Acceptance remains the same natural clock request. The bot must acquire gold through the generic registry graph, smelt it, craft one clock, and have Paper verify the inventory result. A focused geometry regression may pin one obstacle layout that requires more than a fixed dogleg; it is not a substitute for the Paper run. If a later blocker appears after corridor progress, repair that first shared seam within the same clock campaign rather than starting another architecture project.

Implementation checkpoint: the fixed dogleg generator has been replaced by a zero-dependency, bounded voxel search that carries excavation and required-support state and returns only complete preflight candidates. The multi-bend geometry regression, collection safety checks, and productive/recovery budget checks pass. `executeMiningAccessPlan()` still owns no strategy change and still delegates locomotion through each cleared cell to native Pathfinder with digging disabled.

The unchanged clock campaign then exposed a prerequisite-access defect before gold acquisition could exercise the new binder. A deep bot treated incremental ascent as successful recovery, rebuilt collection after reflex interruptions, and restored an interrupted recovery as `assess` after process restart. The shared correction now requires verified surface arrival, sends a concrete materially-higher failed target directly to surface recovery, resumes interrupted recovery without another acquisition attempt, and preserves an in-flight recovery phase across restart. A forced reload physically confirmed model-free deterministic recovery resumption.

Surface locomotion is bound first to Pathfinder's native `GoalY` so the package may choose a cleared horizontal cave or hillside route instead of being forced toward one X/Z column. That call explicitly disables digging, towers, parkour, health-bounded descent, and local excavation recovery. When native locomotion proves no-path, the same deterministic corridor catalogue binds exact loaded surface stances and Pathfinder traverses only its already-cleared cells. Do not restore dig-enabled A* or add collection-specific ascent retries.

### Extra-high evaluation checkpoint: support and debris semantics

The architecture verdict remains unchanged: hybrid wins. The live surface campaign confirmed that the capability boundary is now producing reusable mechanics rather than clock-specific recipes. The generic corridor moved a tool-less bot from Y37 to Y58 through bounded cardinal cells before desert geology exposed two primitive defects.

First, the corridor A* queue preferred shallow and low-excavation states over completion. Equal-cost states now prefer lower remaining distance, while excavation count is only a secondary choice. Second, the shared support descriptor classified every falling-material block as unsafe ground. A settled sand or gravel column is now usable only when a bounded scan proves a non-falling solid anchor; every block in that support chain is protected from route excavation. This is the richer `can I stand here?` contract required by the physical world, not a material-name exception.

The first bottom-up debris executor was unsafe. It admitted a six-step staircase from `(-752,58,-394)` to `(-758,64,-394)`, then breaking sand above the occupied origin column allowed debris to settle into the bot's body. Survival recovery could not escape and Paper recorded `MindcraftBot suffocated in a wall` at 03:33:56. This run is a failed safety result, not progress acceptance.

The locked falling-debris contract is now:

1. keep the per-column falling-debris, total excavation, reach, time, durability, and return-route caps;
2. never bottom-up clear falling material in the currently occupied X/Z column;
3. require a level staging step when debris exists above the origin;
4. while still in the prior supported cell, pre-clear the destination body, headroom, and the next ascent's overhead column;
5. verify that a same-name falling replacement reduced the bounded column height before charging physical progress;
6. require a stable clear interval before Pathfinder receives the cell;
7. fail before digging if the world changed and debris is again above the occupied column.

This staged correction passes the focused checks but is not physically accepted: death respawned the bot at the natural surface, so replaying the buried sand setup would manufacture state. Preserve that distinction. Continue the unchanged `Please make a clock.` request from the real respawn state. The request must still acquire gold through the generic capability graph, smelt it, craft one clock, and pass immediate Paper inventory verification. If buried acquisition exercises the staged corridor again, its physical result governs. No new architecture tranche begins before that clock result.

### Extra-high evaluation checkpoint: bounded deep convergence

The unchanged clock campaign from the real respawn state then physically completed wood acquisition, wooden-tool bootstrap, stone mining, stone-tool replacement, iron acquisition, smelting, and iron-pickaxe replacement. A local furnace placement repeated one bad cell, while a direct replay placed and used a furnace at another safe cell. The working-tree repair now binds up to four distinct anchored, unoccupied local workstation cells for crafting tables, furnaces, and brewing stands. Its focused checks pass; the unchanged campaign must still prove the fallback physically.

Gold acquisition exposed a separate binder defect. Five concrete gold targets survived through real region changes and were rejected before excavation. Solid regions were dominated by excavation-budget and route-support conflicts; an open-cave region was dominated by unsafe air support, water ingress, and support conflicts. This is not evidence for a larger expansion limit. The exact-target path currently asks `buildMiningAccessPlan()` to find one complete route from the current stance to the ore. `selectMiningDeadlinePrefix()` can advance only after that complete route exists, so a safe search that cannot solve the entire 30-plus-level corridor has no legal way to make bounded progress.

The selected correction is receding-horizon binding at the existing capability boundary:

1. preserve the selected ore name and coordinates throughout every intermediate leg;
2. when the exact usable stance is beyond one bounded corridor leg, enumerate loaded, anchored intermediate standing cells that are legal under the same excavation policy;
3. accept only a cell whose bounded route lower bound fits the leg ceiling and whose endpoint strictly reduces the remaining lower bound to an exact final stance;
4. run the existing voxel search, durability/deadline preflight, staged-debris executor, and dig-disabled native Pathfinder traversal unchanged for that leg;
5. report verified `search_advanced` only after occupying a returnable intermediate stance, then rebind against fresh blocks under the same productive attempt;
6. if no bounded convergent leg exists, fail the concrete target cheaply so `GoalDirector` can change target or region.

Do not add support placement, bridge building, dig-enabled Pathfinder, more corridor templates, or a larger search budget in this correction. Those remain possible later primitives only if a bounded staged run physically proves that existing anchored terrain cannot progress. Acceptance remains one Paper-verified clock from the same natural request. The terminal-player-goal/autonomy race and protected temporary-workstation cleanup are confirmed shared defects, but they do not supersede this first acquisition blocker.

Physical result: bounded convergence is materially correct. From Y49, the unchanged clock goal descended through multiple verified legs to Y3, collected four raw gold, returned to the surface, and smelted four Paper-verified gold ingots while remaining at full health. The same code then began a staged redstone descent and preserved the nearly spent iron pickaxe for the final ore while lower-tier tools excavated the route.

The full clock did not pass. Redstone exposed the next shared ownership defect: each intermediate leg advertised only its local durability demand, so the prerequisite planner repeatedly provisioned a wooden pickaxe instead of sizing one tool for the remaining exact-target tranche. Placed crafting tables and furnaces were protected from their own authorized cleanup, forcing repeated workstation recreation. Partial progress did not leave a durable active target binding across those prerequisites, so later actions could reselect and open another corridor. Superseded reserve tools and bulk excavation drops accumulated until all 36 inventory slots were occupied. The goal reached its 128-subgoal ceiling with zero productive attempts charged and failed truthfully as `skill_inventory_full`; immediate lower-priority autonomy was stopped separately.

Do not raise the subgoal, expansion, destruction, or inventory ceilings. The next correction must trace and repair the shared contract across the catalogue, `GoalDirector`, and the mining binder:

1. retain the concrete target and remaining lower-bound cost while a verified staged route is in progress;
2. size generic tool replacement for the bounded remaining tranche, not one local leg, without spending the protected reserve;
3. recover authorized temporary workstations despite general player-block protection;
4. reserve collection capacity and retire or cache only genuinely superseded low-tier tools and bounded bulk excavation output;
5. clear that tranche state on target change, failure, cancellation, or verified completion;
6. rerun `Please make a clock.` from the surviving Paper state and require one verified redstone plus one verified clock.

This is a capability-contract repair, not permission to add a general inventory framework, item-specific clock behavior, automatic broad disposal, or another planner.

### Extra-high evaluation checkpoint: target-owned acquisition tranches

The re-evaluation confirms the architecture and the receding-horizon strategy. The failed clock run was not evidence that the hybrid model needs another layer; it exposed state that must cross the existing planner/executor boundary. One exact acquisition target, its remaining route lower bound, the causal tool prerequisite, temporary workstation ownership, and bounded working capacity now form one coherent generic tranche.

The implementation under live verification does the following:

1. `GoalDirector` persists an exact successful mining target across prerequisite subgoals and supplies that coordinate back to later collection binding. Verified staged progress refreshes the remaining lower bound and clears the paid tool requirement; target completion, invalidation, failure, or cancellation clears the binding.
2. Mining preflight sizes durability for the next bounded target-owned corridor stage, includes the final source block's harvest tier, preserves the reserve, and selects a supported replacement from the capability catalogue even if the worn tool has disappeared from inventory. It does not provision one low-tier tool per local excavation list or require one tool to finish an unbounded journey.
3. A temporary workstation placement receipt is the only authorization to bypass general player-block protection for cleanup. Cleanup shares the action deadline, requests dig cancellation on timeout, and cannot overwrite an already verified craft, smelt, or brew result.
4. Deep collection reserves three physical slots. Capacity release is capped at four actions and may place small expendable natural fill, retire only an exact superseded tool stack beyond the two healthiest copies, or release one exact redundant bulk natural-fill stack while another full stack remains. Functional workstations, requested outputs, and target materials are never candidates.
5. A persisted exact target that changed or became excluded fails immediately. It may not spend regional relocation attempts. Exact stack release uses slot-bound `tossStack`; type/count transfer is not precise enough when tool durability distinguishes otherwise identical item names.

Focused geometry, collection, workstation, goal-memory, syntax, and Windows-native persisted-goal handoff checks pass. This is not acceptance. Reload the bot with this tranche and rerun the unchanged natural `Please make a clock.` request from the surviving Paper world containing four verified gold ingots. Acceptance requires one physically collected redstone and a Paper-verified clock. Any further repair stays on the first shared blocker in that same run; ceilings, item-specific routes, movement engines, and broad inventory policy remain out of scope.

The first bounded rerun disproved one lifecycle detail without invalidating the tranche. Redstone correctly raised a fresh `iron_pickaxe` requirement, but verified progress toward the nested raw-iron prerequisite cleared that requirement as though it had paid the redstone preflight. The next replan therefore retried redstone with the same exhausted iron pick, rediscovered the requirement, and restarted the nested iron chain. The run was stopped after 13 subgoals rather than allowed to exhaust the ceiling. Tool requirements now retain the exact causal source target; unrelated nested mining may progress without replacing that binding or clearing its requirement. Only verified progress on the causal target pays the requirement. Temporary workstation recovery also equips the best available tool and derives its bounded cleanup timeout from the real block break time instead of a drop-pickup constant.

The next rerun proved causal tool ownership but disproved workstation caching as inventory policy. Capacity release placed the only carried crafting table at `(-624,68,-292)`, retired superseded tools, and then ordinary regional recovery moved roughly 70 blocks away. The planner correctly needed new wood to recreate the now-remote crafting capability and failed after two tree searches in a treeless region. A placed workstation is durable world state but not a durable carried capability unless retrieval is also owned; adding that retrieval system here would be scope expansion. Capacity release therefore may no longer place crafting tables or furnaces. It must use exact superseded tools or redundant natural fill and otherwise fail honestly.

The following rerun exposed the corresponding declarative ordering error. `planFromRecipe()` provisioned a crafting table before ensuring remote recipe ingredients. Once redstone search relocated away from a known table, every replan tried to rebuild the final workstation before it resumed redstone acquisition, turning an ore search into unrelated tree recovery. Recipe planning now ensures all ingredients first, then binds the workstation immediately before the craft action. Since `GoalDirector` replans after every verified action, remote acquisition continues without workstation churn; once the ingredients exist, the same generic plan provisions or approaches the table and crafts. The focused planner regression proves a five-ingredient table recipe selects its remote source before any table-building chain.

Ingredient-first planning then physically acquired the two missing raw iron and retained redstone's causal target through mining failures, relocation, and a self-preservation interruption. Paper verified 3 raw iron, 4 gold ingots, and full health. At the old infrastructure site, a real crafting table and furnace were loaded roughly six blocks from the bot, but `ensurePersistentItem()` recognized only workstations already within 4.5-block interaction reach. It therefore planned new wood instead of letting the existing craft/smelt adapters approach the blocks. The planner now accepts a loaded workstation candidate within the adapter's bounded range; the adapter owns native approach and verification, and its existing `carried: true` failure evidence forces local provisioning only when that candidate is physically unusable. The focused regression covers both ingredient-first ordering and a loaded table outside immediate reach.

Loaded-workstation binding reached the real furnace and exposed a fuel-contract mismatch. The planner correctly treated one acacia plank plus one newly collected oak log as three smelts of total fuel, but `smeltItem()` selected only the first fuel stack and required that stack to cover the entire batch. It repeated the same `skill_insufficient_fuel` result four times. The physical primitive now binds an ordered fuel plan across all compatible carried stacks, proves aggregate capacity before inserting input, loads the first stack, and refuels with the next type only after the furnace slot becomes empty. The smelt deadline, output verification, interruption checks, and cleanup ownership remain unchanged. A focused regression pins the exact one-plank-plus-one-log three-smelt case.

The unchanged campaign physically accepted that repair: 3 raw iron became 3 iron ingots, the planner crafted a fresh iron pick, and the retained redstone work resumed. One target advanced through six bounded stages before water/support conflicts rejected its final corridor; the exact coordinate was excluded, surface recovery changed region, and a second target advanced through four further stages. Paper verified full health throughout. The fresh iron pick accumulated 195 damage because `breakBlockAt()` always equips the highest-tier healthy tool for ordinary stone and dirt corridor fill even when two stone picks are carried. The next shared primitive repair is target-aware route tool selection: preserve the minimum tier needed by the final ore and use an already-carried lower-tier capable pick for authorized fill when its real break time remains inside the bound plan. Do not weaken harvest checks, durability reserve, excavation limits, or final-target tool selection.

The package-first audit found no dependency capability to configure for that contract. The owned Pathfinder API exposes `bestHarvestTool(block)`, and installed `mineflayer-tool` ranks `equipForBlock()` candidates by dig time; neither accepts a future-target tier or durability reservation. That behavior is correct for a local break and is not a package defect. Target preservation therefore remains in the capability binder while Mineflayer continues to own `equip()` and `dig()`. Binding, preflight, and execution must share the same concrete route-tool policy: reserve one usable break on a carried final-target tool, assign authorized corridor blocks to the fastest carried capable tier below that target requirement (normally stone below iron), use actual bound-tool dig times in the action deadline, and request generic replacement only when either role lacks capacity. The obsolete fixed whole-tranche minimum is removed because it incorrectly required the ore-tier pick to pay every corridor break. Focused checks are supporting evidence only; the unchanged Paper clock campaign remains the acceptance gate.

The first physical rerun accepted the role ordering: ordinary corridor fill spent the remaining usable stone pick first and moved the bot from Y64 to Y46 before requesting replacement capability. The next blocker was a missing craft precondition, not a mining strategy failure. With all 36 slots occupied, `craftRecipe()` twice consumed stone-pick ingredients but Minecraft could not insert the output, so verification correctly failed only after material loss. Craft execution must prove capacity for the exact bounded output before mutation. It now computes partial-stack plus empty-slot capacity, reuses the existing capped exact-stack release policy while protecting the output and recipe ingredients, and returns `inventory_full` without crafting if safe capacity still cannot be established. This precondition applies to every recipe and does not authorize broad disposal or automatic storage.

The rerun was externally interrupted by `ECONNRESET`; the persisted typed goal bypassed model restoration and resumed its exact deterministic prerequisite, physically accepting the restart contract. It then exposed a connected-registry ranking defect. One carried oak log could immediately produce four oak planks, but one directly carried acacia plank gave the acacia alternative a larger score, so the planner repeatedly searched for an unavailable acacia tree. Recipe ranking now looks through exactly one already-carried deterministic transform when comparing equivalent alternatives. The recursive planner still proves every selected prerequisite and owns all ledger mutation; the bounded look-through only prevents a dead partial stack from outranking a carried source with enough immediate yield. No wood species, stick recipe, or clock route is special-cased.

The next rerun physically accepted that ranking: the planner selected the carried oak log, crafted oak planks, and then crafted sticks without another tree search. A subsequent full-inventory wood action reached a stale `freeCollectionWorkingSlot()` call left behind when the bounded release primitive became `freeCollectionWorkingSlots()`, raising `ReferenceError` before collection. The sole remaining call site now uses the existing plural primitive; its protected wood-family argument and one-slot default preserve the same capped release contract.

```text
[codeplan · bounded-deep-convergence · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=larger-full-route-search/same-binder;V2=deadline-prefix-without-complete-route/executor-policy;V3=bounded-intermediate-stance/binder-policy · lean: V3 · conservative: V3]
[codeplan · bounded-deep-convergence · PLAN-OUT · mode: constrained · profile: compact · pick: V3 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.34;V2=0.58;V3=0.91 · reason: V3 preserves exact-target ownership and every existing safety/execution contract while turning an oversized binding problem into finite verified legs · planned-fingerprint: same-target/bounded-stance/strict-progress/rebind]
```

```text
[codeplan · buried-corridor-binding · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=native-Pathfinder-dry-run/adapter/internal-reuse;V2=binder-owned-bounded-voxel-search/new-module/zero-dep · lean: V2 · conservative: V1]
[codeplan · buried-corridor-binding · PLAN-OUT · mode: constrained · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.62;V2=0.85 · reason: V2 searches only legal excavation geometry at the existing binder boundary while V1 cannot constrain Pathfinder's movement graph tightly enough without package surgery · planned-fingerprint: binder-owned/bounded-search/zero-dep/existing-executor]
```

## Phase 1: Iron progression vertical slice

**Status:** physically completed and verified; retained as the first generic progression proof.

**Goal:** From a verified stone-tier state, fulfill both an explicit and natural-language request for an iron pickaxe.

Expected chain:

`stone pickaxe -> iron ore -> furnace materials -> fuel -> smelting -> iron ingots -> craft -> equip -> verify`

This was the first architecture test because it exercised more prerequisites without requiring a new controller.

Acceptance:

- Direct and natural-language requests enter one persistent typed goal.
- The bot acquires missing ore, furnace, fuel, and crafting prerequisites through existing deterministic commands.
- A recoverable collection, pathing, or smelting failure causes reassessment rather than abandonment.
- Threat or survival preemption does not erase the player goal.
- Completion requires an equipped iron pickaxe and verified inventory state.
- No new physical executor or general framework is introduced.

## Phase 2: Interrupt, survive, and resume

**Goal:** Prove the bot can continue a compound player task after a real survival or defense interruption.

Scenario:

1. Player assigns a resource or tool goal.
2. The bot begins physical work.
3. Hunger, damage, drowning, or a hostile mob legitimately preempts the work.
4. The survival/reflex owner resolves or truthfully fails the urgent condition.
5. The original player goal resumes from fresh world and inventory state.

Acceptance:

- The urgent owner outranks the player goal without canceling it.
- Preemption does not consume the goal's failure budget.
- The bot resumes the correct remaining prerequisite rather than restarting blindly.
- Operator stop still cancels everything immediately.

## Phase 3: Companion work loop

**Goal:** Complete a broad, natural companion sequence in one session.

Target session:

`follow player -> stop -> accept work -> gather/craft -> handle danger -> resume -> return near player -> report exact result`

The largest observed gameplay blocker from this session becomes the next coding task. Doorway precision, return navigation, delivery, conversation timing, or resource search are fixed only if they materially block the session.

Acceptance:

- Player instructions remain authoritative throughout the sequence.
- Follow and stop remain responsive.
- Work continues without model micromanagement.
- The bot returns to a useful companion state after completing or failing the work.
- Narration matches the physical state.

## Phase 4: Capability catalogue and generalized compound routes

After the repeatability gate passes, place the typed capability catalogue between the prerequisite planner and existing deterministic executors. Migrate the current collect, craft, smelt, equip, workstation, retrieval, and delivery paths without changing their physical acceptance behavior.

Then remove duplicated prerequisite knowledge from `prepareTool`, `prepareMaterial`, the hardcoded autonomous progression ladder, and other nested helpers by routing them through the same proven capability contracts. Autonomous progression may select a durable outcome; it must not maintain a second recipe or prerequisite engine.

Generalize by mechanic and source class, not one recipe at a time.

Likely order:

1. Iron tools and weapons.
2. Furnace-dependent materials and food.
3. Delivery goals that require acquisition plus verified handoff.
4. Miner and lumberjack quotas that require tool replacement and recovery.
5. Diamond progression only after iron-tier continuation is reliable.

Generalization must follow evidence. Do not route every command through `GoalDirector` merely because it is possible. Simple commands should remain simple actions.

Acceptance:

- The planner consumes typed capability contracts rather than ad-hoc command strings for migrated operations.
- Preconditions, effects, bindings, execution evidence, and verification are independently visible.
- A binding failure can change concrete source or prerequisite without hiding another physical retry inside `skills.js`.
- `ActionManager` remains the only physical owner and does not acquire domain planning logic.
- Every plugin adapter shares the action deadline and retains ownership until cancellation and physical quiescence are confirmed.
- The same capability implementation completes at least two unrelated item goals without item-specific routing.
- No second navigator, executor, controller, world-state framework, or wholesale `skills.js` rewrite is introduced.

## Phase 5: Procedure reuse and efficiency

The goal system already records proven procedures. Once several live capabilities work reliably:

- prefer previously successful prerequisite sequences;
- retain failed-target memory long enough to avoid immediate repetition;
- reduce unnecessary movement and repeated crafting-table placement;
- measure completion time only to find obvious gameplay waste;
- never trade correctness or stop authority for speed.

## Prioritized backlog

### P0

- Preserve the completed additional-bucket repeatability checkpoint. **Done: `b8f17d1`.**
- Correct productive-attempt ceilings, target propagation, action-level deadlines, cancellation settlement, tool replacement, workstation recovery, and deterministic restart on the same live request. **Done and physically exercised.**
- Introduce the minimal declarative capability contract around already-proven operations without adding item-specific routes.
- Survival/reflex interruption followed by verified goal resumption.

### P1

- Migrate existing collect, craft, place, smelt, equip, retrieve, and delivery operations into the catalogue without changing physical ownership.
- Retire duplicated prerequisite planning in `prepareTool`, `prepareMaterial`, and autonomous progression as each replacement path is physically proven.
- Return-to-player and verified delivery after remote work.
- Resource-search relocation that avoids cycling between the same unusable targets.
- Natural-language phrasing coverage for proven goal types.
- Clear progress and blocker reporting during long work.

### P2

- Procedure selection informed by successful yield and duration.
- Broader tool tiers and furnace workflows.
- Long-session memory of locations, failed targets, and useful infrastructure.
- Multi-bot work only after the single companion loop is dependable.

## Guardrails that remain

Only guardrails that protect the running product remain mandatory:

- one serialized physical action owner;
- one declarative capability boundary between planning and physical execution;
- operator stop and cancellation;
- one action-level deadline propagated through every nested operation;
- cancellation adapters that retain ownership until package and body settlement;
- companion-owned Mineflayer/package mechanics by default when we must alter them, with immutable source commits, a locked independent install, and physical parity before project compensations are removed;
- disposable worlds for destructive validation;
- truthful world-state completion checks;
- bounded attempts and productive subgoals;
- no item-specific prerequisite routes, duplicate planners, or hidden strategic recovery loops;
- clean commits and a restorable runtime configuration.

Documentation, telemetry, and test infrastructure are supporting tools. They must not become independent workstreams unless a current gameplay failure requires them.

## Immediate next coding move

Reload the target-owned acquisition-tranche repair, then rerun `Please make a clock.` from the surviving Paper state with four verified gold ingots. Keep `GoalDirector`, the capability catalogue, `ActionManager`, the V2-owned Pathfinder, deterministic corridor excavation, and Minecraft-state verification in their current ownership lanes. Repair only the first shared capability blocker encountered and rerun the same request until Paper verifies one clock or a genuine external blocker remains. Do not add a clock-specific route, give Pathfinder excavation authority, manufacture a buried test state, raise a ceiling, or start a second executor.
