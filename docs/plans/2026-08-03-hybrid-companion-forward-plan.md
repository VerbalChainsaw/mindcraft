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

Introduce the smallest coherent capability-catalogue tranche around the already-proven collect, craft, smelt, equip, workstation, and verification operations. Keep `GoalDirector`, `ActionManager`, the V2-owned Pathfinder, existing deterministic skills, safety policy, and Minecraft-state verification in their current ownership lanes. Prove the tranche by rerunning an existing multi-step request; do not add a new recipe-specific path or a second executor.
