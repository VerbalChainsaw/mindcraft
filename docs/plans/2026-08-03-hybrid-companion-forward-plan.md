# Forward Plan: Build the Companion Through Proven Hybrid Slices

**Date:** 2026-08-03
**Starting commit:** `cd71c8d8f7f1e8b2a1f66edf0bd8612d944d8874`
**Architecture decision:** preserve the deterministic Mineflayer body and extend persistent goal ownership only where live compound gameplay proves it useful.

## Product objective

Build a companion that can receive an ordinary player request, continue through prerequisites and recoverable failures, survive interruptions, finish the physical task, and report the result truthfully.

Progress is measured in playable capabilities, not document volume, harness count, or architectural surface area.

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

## Phase 1: Iron progression vertical slice

**Goal:** From a verified stone-tier state, fulfill both an explicit and natural-language request for an iron pickaxe.

Expected chain:

`stone pickaxe â†’ iron ore â†’ furnace materials â†’ fuel â†’ smelting â†’ iron ingots â†’ craft â†’ equip â†’ verify`

This is the next architecture test because it exercises more prerequisites without requiring a new controller.

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

`follow player â†’ stop â†’ accept work â†’ gather/craft â†’ handle danger â†’ resume â†’ return near player â†’ report exact result`

The largest observed gameplay blocker from this session becomes the next coding task. Doorway precision, return navigation, delivery, conversation timing, or resource search are fixed only if they materially block the session.

Acceptance:

- Player instructions remain authoritative throughout the sequence.
- Follow and stop remain responsive.
- Work continues without model micromanagement.
- The bot returns to a useful companion state after completing or failing the work.
- Narration matches the physical state.

## Phase 4: Generalize proven compound routes

After stone and iron progression are live-proven, generalize the routing seam to other compound tool and material goals.

Likely order:

1. Iron tools and weapons.
2. Furnace-dependent materials and food.
3. Delivery goals that require acquisition plus verified handoff.
4. Miner and lumberjack quotas that require tool replacement and recovery.
5. Diamond progression only after iron-tier continuation is reliable.

Generalization must follow evidence. Do not route every command through `GoalDirector` merely because it is possible. Simple commands should remain simple actions.

## Phase 5: Procedure reuse and efficiency

The goal system already records proven procedures. Once several live capabilities work reliably:

- prefer previously successful prerequisite sequences;
- retain failed-target memory long enough to avoid immediate repetition;
- reduce unnecessary movement and repeated crafting-table placement;
- measure completion time only to find obvious gameplay waste;
- never trade correctness or stop authority for speed.

## Prioritized backlog

### P0

- Iron-pickaxe progression through the typed goal loop.
- Survival/reflex interruption followed by verified goal resumption.
- Remove any remaining player-facing compound commands that bypass an existing proven goal route.

### P1

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
- operator stop and cancellation;
- disposable worlds for destructive validation;
- truthful world-state completion checks;
- bounded attempts and productive subgoals;
- clean commits and a restorable runtime configuration.

Documentation, telemetry, and test infrastructure are supporting tools. They must not become independent workstreams unless a current gameplay failure requires them.

## Immediate next coding move

Implement and run the iron-pickaxe vertical slice. Begin from the existing typed item-goal and prerequisite planner. Do not introduce another director. Fix only the first live blocker that prevents the bot from acquiring, smelting, crafting, equipping, and verifying the iron pickaxe.
