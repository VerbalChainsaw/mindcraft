# How other engines do this, and what we should build

Research 2026-08-18, prompted by weeks of the companion refusing things it is
capable of. Sources at the bottom.

**Short answer to "do I need to narrate every step?" — No.** The narration is a
symptom of a locomotion layer that reports "impossible" when it means
"unfinished", and a decision layer with no way to interrupt itself. Both are
solved problems with known shapes.

---

## 1. The finding that costs nothing to act on

`mineflayer-pathfinder/index.js:138`:

```js
while (result.status === 'partial') {
```

The library **already** calculates in segments and continues from partial
results. It is Baritone's architecture, already installed.

Our code discards it. `skills.js` gates success on `result.status === 'success'`
and treats `partial` and `timeout` as failure. So the engine says *"here is a
route 40 blocks toward your goal, ask me again when you get there"* and we hear
*"there is no route."*

That is the same defect as everything else found this week, at the layer that
matters most.

---

## 2. Baritone: movements are typed edges, not skills

Baritone models **18 movement types** in a `Moves` enum — traverse, diagonal,
ascend, descend, parkour, and the block-manipulating ones. Each implements
`calculateCost`.

The critical design decision:

> The system evaluates feasibility within movement calculations rather than
> separate decision logic.

Mining through a wall and placing a block to bridge a gap are **not separate
skills with their own planners**. They are edges in the search whose cost
includes breaking time, tool wear, and inventory. Nerdpoling is a movement whose
cost includes placing a block under yourself. The planner discovers "tunnel
under this" or "pillar up here" *as the cheapest path*, not because anyone wrote
a tunnel routine.

We did the opposite: a mining route planner, a stance enumerator, a surface
budget, a collection approach probe — each a private search, each able to veto
before pathfinder is consulted, and on 2026-08-18 two of them disagreed about
the same block in the same second.

**This is why the bot cannot nerdpole its way out of a hole.** Not a missing
skill. The capability exists as an edge; a private planner refused before the
search ran.

### Segmented search and cost backoff

Baritone ends a calculation three ways: reaching the goal, running out of time,
or hitting render distance. When it does not reach the goal it uses **incremental
cost backoff** — `AbstractNodeCostSearch` tracks the best node at several
cost/heuristic coefficients and picks the least coefficient that still makes at
least ~5 blocks of progress. Then it walks that, and calculates the next segment
while walking.

`PathingBehavior` holds `current` and `next` executors so there is no stall
between segments.

**Never plan the whole route. Plan a segment you are confident in, commit,
re-plan while moving.** A world with mobs, gravity and a player in it invalidates
long plans anyway.

### Interruption is a property of the movement

`PathExecutor.onTick()` is a state machine that watches deviation and cancels if
the player strays too far for too long. Each movement implements
**`safeToCancel`** — `MovementDiagonal` checks there is a block under you so you
do not fall when stopping.

This is the answer to "break in and out of action loops and return to the main
tree." Interruptibility is not a global flag or a cooperative check we sprinkle
around. **The currently-executing edge knows whether right now is a safe moment
to stop.** Mid-parkour: no. Standing on solid ground: yes.

---

## 3. The decision layer: what the field actually recommends

| paradigm | how it switches | best for |
|---|---|---|
| Behavior Tree | a task higher in the tree preempts lower-priority work | structured, tactical |
| GOAP | plans a chain to a goal; re-plans frequently; interrupts on urgent need | adaptive combat, dynamic NPCs |
| Utility | scores every candidate continuously, always takes the highest | **resource-heavy survival** |

The consensus, and the hybrid most studios ship: **utility sets the priority, a
behavior tree executes the chosen plan.** Recent work (GOBT) formalises exactly
this fusion.

For Minecraft survival with a companion, utility is the right arbiter — it is
the only one of the three whose natural mode is "conditions changed, the ranking
changed, switch now" without anyone authoring the transition.

And the interrupt semantics we want are already described: *pause chopping wood
when hunger spikes, then return to the original task.* Return, not restart.

---

## 4. The engine, assembled

Three layers. Nothing invented; each is a known pattern, and two of the three
are already installed.

```
INTENT      LLM. Chooses goals and permissions. Never steps.
            "get 8 cobblestone, for the player, digging allowed, don't touch the base"

ARBITER     Utility scoring over candidate states. Owns the request lifecycle.
            The only thing that starts, preempts, resumes or ends work.
            Preemption asks the running edge safeToCancel first.

ENGINE      pathfinder + mineflayer. One search, one topology, action-typed edges.
            Segmented: plan a confident segment, commit, re-plan while moving.
            Returns did / engine_cannot / we_will_not / unknown.
```

A **state** at the arbiter layer is a contract, never a planner:

```
{ name, permits: Movements, goal, accepts(world), yieldsTo, budget }
```

The test for whether a proposed state is the right kind: **does it contain a
search?** If yes it duplicates pathfinder and will eventually contradict it.

---

## 5. Concrete changes, cheapest first

1. **Stop discarding partial paths.** Execute the segment, re-plan from where you
   land, repeat until the goal or a *conclusive* `noPath`. This alone should end
   most "unreachable" refusals. No library change.
2. **`safeToCancel` on the executing action.** Replace global interrupt checks
   with a per-action answer. Preemption becomes safe by construction, so the
   arbiter can switch gears mid-task without scripting the seam.
3. **Delete the private planners.** Every project-side computation of reachable /
   stance / route-exists is either expressible as a `Movements` restriction —
   convert it — or is a goal choice, which moves to the arbiter.
4. **Movements as the single permission surface.** `canDig`, `canPlaceBlocks`,
   `allow1by1towers`, `allowParkour`, `safeToBreak`, `digCost`. Policy lives
   here and nowhere else, so no component can privately veto.
5. **Utility arbiter owns the request lifecycle.** Delete the four prompt nudges
   written on 2026-08-17/18; they exist only because nothing can answer "is it
   done yet."

### Where modifying the libraries is justified

We are allowed to fork, and there are two places it may be warranted:

- **Cost backoff.** mineflayer-pathfinder segments, but does not obviously
  implement Baritone's multi-coefficient "best node at least N blocks along"
  selection. If partial selection proves poor in practice, port it.
- **Movement types.** If a needed edge genuinely does not exist (a specific
  tower/bridge variant), add a movement with a cost function. Add it to the
  *search*, never as a skill beside it.

Do not fork for anything achievable with a `Movements` field. Nearly all of our
"missing capability" turned out to be a capability switched off.

---

## Sources

- [Baritone pathfinding system](https://deepwiki.com/cabaletta/baritone/4-pathfinding-system)
- [Baritone FEATURES.md](https://github.com/cabaletta/baritone/blob/master/FEATURES.md)
- [cabaletta/baritone overview](https://deepwiki.com/cabaletta/baritone)
- [GOBT: goal-oriented and utility-based planning in behavior trees](https://www.jmis.org/archive/view_article?pid=jmis-10-4-321)
- [GOAP in game AI: utility and planning](https://tonogameconsultants.com/goap/)
- [Game AI planning: GOAP, utility, behavior trees](https://tonogameconsultants.com/game-ai-planning/)
- [Behavior trees and the future of intelligent control](https://www.gamedeveloper.com/programming/behavior-trees-and-the-future-of-intelligent-control-2)
