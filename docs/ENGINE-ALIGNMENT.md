# Engine alignment: what to assemble, what to delete

Written 2026-08-18 from a night of live measurement. Every defect found had the
same shape, and it is not a shape more code fixes.

> Project code answered a question the engine had already answered, answered it
> worse, and reported its own answer as a fact about the world.

The pieces are right. The assembly is not. **Nothing here proposes a new state
engine on top.** The proposal is to delete a layer, consolidate onto an arbiter
that already exists, and make one class of lie structurally impossible.

---

## 1. The three vocabularies, and why they must not share a type

Tonight's five confirmed defects were all the same collapse: a *permission*
refusal and an *unfinished search* both reported as `skill_unreachable`, which
downstream reads as "the world makes this impossible."

| what happened | what was reported | truth |
|---|---|---|
| surface-excavation bound rejected 12 complete routes | `noPath:12` | 12 routes existed |
| stance check found no already-clear cell | `unreachable` | one pickaxe swing away |
| collectblock forbidden to break intervening dirt | `No path to the goal!` | forbidden, not impossible |
| collected 2 of 3, third candidate failed | `failed` | 2 were in the inventory |
| death manifest unrecoverable | "cannot do any other task" | an errand, not a precondition |

Every skill outcome must be exactly one of:

- **`did(x)`** — the engine did it. Evidence is the world, not a sentence.
- **`engine_cannot(reason, evidence)`** — a *finished* engine search returned a
  conclusive negative. `noPath` from a completed A*. A missing ingredient.
- **`we_will_not(rule, what_would_lift_it)`** — policy. Always names the rule and
  what would change the answer. Never phrased as inability.
- **`unknown(reason)`** — budget, timeout, unloaded chunk, unfinished search.
  **Never** collapses into `engine_cannot`.

The refusal topology *is* the absence of this distinction. Nuking it means
making `we_will_not` and `unknown` structurally unable to surface as
`engine_cannot` — not remembering to phrase them carefully.

**Do:** extend `tools/veto-audit.mjs` past its current scope (movement
amputations only) to fail the build when an outcome string crosses these
categories. It already proves the pattern works: 0 unnamed vetoes, 29 named.

---

## 2. Delete project-side reachability

`mineflayer-pathfinder` is an A* over the voxel volume **where the edges are
actions** — walk, jump, drop, dig-through, place-to-bridge, 1×1 tower. It
already answers "can I get there, and by what sequence of things I can do."

We built a second, worse planner in front of it: stance enumeration, corridor
binding, surface-disturbance budgets, route pre-assessment. Each duplicates
something pathfinder does natively, and each can veto before pathfinder is ever
consulted. That is the "assembled in the wrong order" problem exactly.

**The only legitimate project input is the `Movements` object.** It *is* the
permission surface — one place, declarative, per-action. `canDig`,
`canPlaceBlocks`, `allow1by1towers`, `allowParkour`, `safeToBreak`, `digCost`.
Policy belongs there and nowhere else.

**Do:**
- Inventory every project-side computation of *reachable*, *stance*, *route
  exists*, *safe approach*. Each is either (a) expressible as a `Movements`
  restriction — convert it — or (b) a genuine goal choice, which stays.
- Anything that computes a route to decide whether to ask for a route: delete.
- Keep the *evidence* those probes produced; it is good. Stop letting it veto.

Measured tonight: the selector scored `success route, score 5.62` to stone at
(1032, 91, 1012), and collectblock answered `No path to the goal!` for the same
block in the same breath. Two project-configured answers to one engine question.

---

## 3. The master loop and its siblings

Current owners of "what should the companion do next":

```
model loop (handleMessage)   goal-director      job-director
agenda-director              role-director      survival-director
reaction-director            behavior-arbiter   self-prompter
```

Nine. Each with its own notion of the next action, its own suppression rules,
and no single answer to *what is Kevin doing and on whose behalf*.

A plain-language request — the thing a child actually says — is owned by **none
of them**. `goal-director` owns typed goals, `agenda-director` owns parsed
plans. "Go get some wood and make me some charcoal" falls through every one.

That gap is why four separate prompt nudges accumulated in one night (stall
nudge, drift reminder, quoted request, delivery framing). Four reminders aimed
at one behaviour is the signature of a missing state machine — and reminders
are what you write when you cannot ask "is the request satisfied?"

**Do not add a tenth owner.** `behavior-arbiter.js` already exists and is the
right seat. Make it authoritative:

- Directors become **proposers**: each returns `{intent, priority, evidence}`.
  None of them acts.
- The arbiter is the only thing that starts, preempts, or ends an action.
- A **request lifecycle** is a first-class object the arbiter owns:
  `{ asked, by, at, acceptance, state: open|satisfied|blocked|abandoned }`.
  `acceptance` is a predicate over the world — *the item is in the player's
  inventory* — not a claim in a transcript.
- Reflexes stay preemptive. Operator Hold stays inviolable and never
  auto-releases.

When that lands, **delete**: the stall nudge, the drift reminder, the
request-quoting reminder, and `COMMANDS_BETWEEN_REQUEST_REMINDERS` /
`MAX_REQUEST_REMINDERS`. They exist only because nothing can answer "is it done
yet." Leaving them in after the arbiter can answer it is how the next layer of
sediment starts.

---

## 3a. Does each state get its own engine?

The instinct is right and the wording matters, because the wrong reading is what
this codebase already did.

**Wrong:** each major state owns a full action topology — it works out what is
possible within itself. That is what exists today. Mining has its own route
planner and surface budget. Collection has its own stance enumerator. Follow has
its own clearance probe. Each re-implements the same question, each answers it
differently, and each can veto before the real engine is asked. Two of them
disagreed about one block in the same second on 2026-08-18.

**Right:** the topology of what is physically possible lives in exactly one
place — pathfinder, whose A* edges already *are* the action set: walk, jump,
drop, dig-through, place-to-bridge, 1×1 tower. A state does not compute
possibility. A state is a **contract**:

```
State = {
  name,                    // 'mining', 'following', 'delivering', 'idle'
  permits,                 // a Movements object: which action edges are legal here
  goal,                    // the target, as a pathfinder Goal or world predicate
  accepts(world),          // the acceptance test, measured in the world
  yieldsTo,                // reflex always; a player request for self-directed states
  budget,                  // time and attempts, so it cannot run forever
}
```

Enter it, run one engine against it, exit to the arbiter with a result in the
§1 vocabulary. That is the "full actions it can perform within JUST that state"
part, expressed as *permissions on a shared topology* rather than a private copy
of it — one place to look, one place to change, and no two components able to
disagree about the same block.

So: many states, thin. One topology, shared. One arbiter, authoritative.

The test for whether a proposed state engine is the right kind: **does it
contain a search?** If it does, it is duplicating pathfinder and will eventually
contradict it. If it only declares permissions, a goal, and an acceptance test,
it is a contract and it is safe.

## 4. Why an errand must never become a refusal

A recorded death manifest at an unreachable location made Kevin refuse every
request indefinitely: *"my required death recovery step is unresolved and must
be completed or bypassed before I can do any other tasks."* One death, and the
companion is bricked for a child.

**Rule:** an obligation the companion cannot discharge is never a precondition
for something a player asked for. Self-directed work yields to a request, always
— and an obligation that cannot be discharged must expire rather than accumulate.

---

## 5. Acceptance

Not unit tests. `tools/probe-request-completion.mjs` replays campaigns from the
recovered record as short measured cases — an item count read from a real second
player, in seconds rather than a session.

The current spread across four runs of the same seven cases: **3/7, 5/7, 5/7 with
different members, 4/7.** The variance is now a bigger problem than any single
defect in it, and it is what a lifecycle fixes: today, completion depends on the
model staying lucky.

Target: every promoted campaign passing *repeatedly*, not once.

---

## Order of work

1. Outcome vocabulary + audit extension. Cheapest, and it stops new sediment.
2. Request lifecycle on the arbiter; delete the four nudges.
3. Inventory and convert project-side reachability into `Movements` policy.
4. Promote the remaining campaigns (59, 65, 69, M3, 76) into the probe.

1 and 2 are independent and can go in either order. 3 is the largest and should
not start until 1 can catch its regressions.
