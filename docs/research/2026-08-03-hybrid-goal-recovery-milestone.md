# Milestone: Hybrid Goal Recovery Wins

**Date:** 2026-08-03
**Decision:** HYBRID WINS
**Implementation commit:** `cd71c8d8f7f1e8b2a1f66edf0bd8612d944d8874`
**Milestone tag:** `milestone-hybrid-goal-recovery-20260803`

## Question answered

Should Mindcraft be rebuilt as a new engine, or should the existing Mineflayer body and deterministic skills continue under a narrower persistent goal layer?

The live experiment answered this directly: keep the existing body and extend the new brain seam by seam. A wholesale rewrite is not justified.

## Experiment

The same disposable survival-world state was used for the legacy path and the candidate path. The bot began at approximately `(503, 77, 605)` with a wooden pickaxe, crafting table, sticks, minimal birch material, and no cobblestone or stone pickaxe.

The tested player intent was expressed in both supported forms:

- `!prepareTool("stone_pickaxe")`
- `Please upgrade to a stone pickaxe.`

### Legacy behavior

Both forms routed directly to the monolithic `skills.prepareTool` action. The action found 12 stone candidates with no safe stance, exhausted its internal route attempt, and terminated after about 14.9 seconds with `skill_cobblestone_route_exhausted`.

No persistent `GoalDirector` owned the retryable result. The bot remained at the wooden-pickaxe stage.

### Hybrid behavior

Player-origin stone-pickaxe requests were routed into the existing typed item-goal system. The goal continued to use the existing deterministic skills, `BehaviorArbiter`, and `ActionManager` as the only physical execution path.

The direct request:

1. Failed to reach stone.
2. Recovered with bounded movement.
3. Re-read the world and inventory.
4. Retried collection from a new position.
5. Collected the required stone.
6. Crafted and equipped a stone pickaxe.
7. Completed only after inventory verification.

It completed in about 35.7 seconds.

The natural-language request followed the same typed-goal path and completed in about 29.9 seconds. Paper recorded the `Stone Age` and `Getting an Upgrade` advancements, and the final state contained and equipped one stone pickaxe.

## Architecture decision

The project will use a hybrid architecture:

- Mineflayer remains the body and protocol interface.
- Existing deterministic skills remain the physical primitives.
- `ActionManager` remains the single serialized physical-action owner.
- `BehaviorArbiter` remains the authority that selects and retains behavior lanes.
- `GoalDirector` owns compound player outcomes that require observation, prerequisites, recovery, continuation, and verified completion.
- The LLM interprets intent and explains results. It does not control low-level movement or claim physical success.

A second physical executor, a big-bang rewrite, or a replacement of `skills.js` is not authorized by this result.

## Non-regression invariants

These conditions define the milestone and must remain true:

1. Explicit and deterministic natural-language stone-pickaxe requests enter a typed persistent goal rather than running as one monolithic player action.
2. Internal goal steps may still call deterministic commands such as `!prepareTool` without recursively creating another goal.
3. Retryable world failures preserve the player goal, trigger fresh assessment, and may select bounded recovery.
4. Recovery-history entries do not consume the productive-step ceiling.
5. Recovery history remains bounded, and the productive-step ceiling still fails closed.
6. Physical completion is derived from Minecraft inventory state, not command acceptance or narration.
7. All body actions continue through `BehaviorArbiter` and `ActionManager` ownership.
8. Operator stop and cancellation remain authoritative.

The focused regressions protecting these rules are:

- `tests/control-plane/player-directives-routing.test.js`
- `tests/control-plane/goal-director-recovery-budget.test.js`

## Development rule established by this milestone

Future architecture work must begin with one real compound gameplay request, reproduce the first functional blocker, repair the smallest existing seam, and prove the result in a disposable live world. New frameworks, schedulers, contracts, or harnesses require a demonstrated gameplay ceiling that cannot be repaired locally.

The next work is not a new engine. It is the next useful vertical slice on this proven hybrid path.
