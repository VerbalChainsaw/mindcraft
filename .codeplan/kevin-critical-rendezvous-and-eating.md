# Kevin critical rendezvous and eating

## Outcome

When the player asks Kevin to come over during a bodily emergency, the accepted
rendezvous remains durable across package-owned safety reflexes and resumes as
soon as the reflex releases. Spacing is only an intermediate receipt: the
survival objective must settle by defeating the attributed pursuer, reaching
verified cover, or rendezvousing with a non-attacking companion and asking for
help. If safe food is carried, the existing Mineflayer consume path may select
and eat it without an invalid command type. A settled food-source blocker may
still animate safe eye contact while it waits beside the player.

## Live evidence and invariant

- `phixxation: kevin come to me` started a one-shot `!goToPlayer` immediately
  before self-defense preempted it. The request had no durable Agenda owner and
  was not resumed.
- Critical retreat chooses 16 blocks while self-defense admits threats at 16
  blocks. Successful retreat therefore returns to the same admission edge and
  live telemetry showed repeated reacquisition. `INVARIANT_HOLDS`.
- `phixxation: Eat the watermellon` generated `!consume("")`; the
  `ConsumableName` validator rejected the empty string before `skills.consume`
  ran. The skill already implements safe best-carried-food selection.
- `recovery_food_sources_exhausted` blocks the arbiter before idle embodiment,
  so Kevin stops tracking a visible nearby player even though eye movement is
  safe and owns no locomotion.

## Calibrated axes

Hard gates: preserves player identity; no parallel movement/combat/eating
engine; cancellation remains censored; existing owners emit structured results;
no dependency change. Weighted preferences: player-visible recovery 35,
ownership fit 30, regression surface 20, observability/testability 15.

## Variants

### V1 — requeue interrupted one-shot actions in ActionManager

Teach ActionManager to retain selected interrupted actions and add a critical
survival exception for them. This is locally small but introduces action-label
policy into a generic execution owner and does not give SurvivalDirector the
requester identity it already knows how to return to.

Gate: pass. Score: 73/100.

### V2 — narrowly admit a single rendezvous to Agenda (selected)

Allow the already-typed single `goto` plan through `dispatchPlayerAgenda`.
Agenda already persists requester identity, censors reflex interruption, and
redispatches without spending its failure budget. SurvivalDirector can adopt a
new requester on an existing food blocker and use its existing package-backed
`return_to_player` action. Increase the critical-health spacing policy beyond
the reflex admission edge. Permit only idle embodiment while the terminal food
blocker continues suppressing autonomous work.

Gate: pass. Score: 92/100.

### V3 — new shelter/help behavior state

Create a dedicated escape-to-player-or-shelter state machine with its own
movement and help dialogue. This duplicates existing Agenda, SurvivalDirector,
Pathfinder and reaction ownership and adds a new subsystem for a failure the
current owners can represent.

Gate: fail (parallel ownership and unjustified scope).

### V4 — attacker receipt + existing tactical/survival objectives (selected clarification)

Capture Mineflayer's responsible `entityHurt` source when Kevin is the hurt
entity, retaining whether it is the current companion, another player, a
hostile, another entity, or unknown. Self-preservation may use only that exact
fresh source as attribution; it must not blame the nearest unrelated mob.
Existing tactical combat still decides fight versus disengage by hostile class
and equipment. After disengagement, the existing SurvivalDirector owns the
next objective: explicit rendezvous first, then verified existing shelter, then
a non-attacking present companion as the help destination. A companion who
caused the fresh hit is never silently selected as safety.

Gate: pass. This extends V2's receipt and selection seams without duplicating
Mineflayer mechanics or inventing an opaque reason for a player attack.

### Eating variants

- Selected: add a bounded semantic consumable `best_food` and map generic eat
  requests to it; `skills.consume` keeps the existing safe ranking and native
  `bot.consume()` execution.
- Rejected: relax `ConsumableName` to accept every empty/unknown string. This
  weakens validation rather than expressing the intended selection.
- Rejected: custom autonomous raw-food loop. SurvivalDirector and Mineflayer
  already own this mechanic.

## Repair contract

1. Single natural-language rendezvous requests become one durable Agenda entry.
2. Critical retreat spacing clears the self-defense admission envelope, but is
   not reported as the final safety objective.
3. Received damage retains its exact source class. Unknown evidence stays
   unknown, and a player source is never replaced with the nearest hostile.
4. An existing food blocker adopts a newly durable requester without another
   pointless generic food search, and censored return attempts remain retryable.
5. A terminal food blocker keeps unsafe autonomous lanes suppressed but permits
   idle embodiment.
6. Generic eat uses `best_food`; named/semantic consumables retain validation.

## Acceptance

Focused routing, Agenda-preemption, survival recovery, combat-policy, command
parser, consumption, and arbiter tests pass. In real Paper gameplay Kevin eats
safe carried food autonomously, survives reflex interruption of a player
rendezvous, reaches or truthfully asks the player for help, and tracks the
visible nearby player while safely waiting.
