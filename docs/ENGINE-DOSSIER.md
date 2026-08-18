# Companion engine dossier

**Self-contained.** Start with `REVIEW-PACKET.md` for the dead-list, reproduction
steps and trust notes. Written 2026-08-18 for external review — another model or
engineer should be able to read this cold, with no access to the repo or the
conversation that produced it. Supersedes nothing; `ENGINE-ALIGNMENT.md` and
`ENGINE-RESEARCH.md` are folded in here.

---

## 0. What this is

A Minecraft companion bot ("Kevin") built for the author's son. Node.js,
`mineflayer` + `mineflayer-pathfinder` + `mineflayer-collectblock`, against a
Paper 1.21.11 server. An LLM (gpt-4.1) chooses commands; ~150 registered
commands map to skills in `src/agent/library/skills.js` (~25,000 lines).

**The product test is a child asking for something in plain language and getting
it.** Not a benchmark.

**The failure that will not go away:** the bot refuses things it is fully capable
of, and cannot switch tasks without the seam being scripted.

---

## 1. Evidence (all measured live, 2026-08-17/18)

Verbatim from run logs. Each was traced to a cause.

**1.1 — Twelve routes computed, all discarded, reported as no route.**
```
Rejected the known stone target before excavation: surface excavation not bounded
(12 completed routes, 42 states; surface_excavation_not_bounded:12)
...
Found 12 cobblestone candidates, but none has a safe reachable route (noPath:12).
```
Bot standing on a buried stone column holding a stone pickaxe. The engine
returned twelve complete routes across forty-two states. A project policy
discarded all twelve, and the player-facing sentence said no route existed.

**1.2 — Two project components disagreeing about one block, same second.**
```
Selected stone at 1032, 91, 1012 over the nearer candidate (success route, score 5.62).
Failed to collect cobblestone: No path to the goal!
```
The candidate selector scored a successful route. `collectblock`, configured
with only the *target* block breakable, found no approach — the stone was under
eight layers of dirt it was forbidden to touch. Both components were internally
correct.

**1.3 — Excavation ordered bottom-up, making descent impossible.**
```
Broke dirt at (1032, 99, 1013)
Could not break dirt at (1031, 98, 1013): Block not in view (standing at 1032.5, 99.0, 1013.5)
```
The route digger was told to break a block one down and one over, still capped
by unbroken dirt — every face against solid ground. `mineflayer` raycasts for a
visible face and correctly refused. The excavator was asked to start at the
bottom of a hole it had not opened yet.

**1.4 — One death bricked the companion permanently.**
```
!recoverDeathItems → Failed (skill_death_position_unreachable):
  advanced 205.9 blocks toward the destination in 10 bounded segment attempt(s),
  did not arrive
...
"I cannot craft or deliver an iron axe because my required death recovery step is
 unresolved and must be completed or bypassed before I can do any other tasks."
```
An undischargeable obligation became a precondition for every player request.

**1.5 — Work succeeded, player got nothing.**
```
Failed (skill_not_received): You have reached RequestTarget.
Discarded 8 oak_planks. Failed to give oak_planks, it was never received.
```
Hand-over is a toss. The retry was gated on a flag only set when the stack
returned *by luck*, so the case needing recovery left the items on the ground.

**1.6 — Busy is not on-task.**
Asked for charcoal, the bot derived and executed the entire chain unaided —
`9 oak logs → wooden pickaxe → crafting table → 8 cobblestone → furnace →
"Smelted 1 oak_log into 1 charcoal."` — then said *"Now, I will craft torches…
which is the next progression milestone"* and spent the remaining eighteen
minutes on torches and iron ore. Never handed the charcoal over.

**1.7 — The variance.** Seven fixed campaign cases, four consecutive runs:
`3/7, 5/7, 5/7 with different members, 4/7`. The spread is now a larger problem
than any single defect inside it.

---

## 2. Diagnosis

Every item in §1 has one shape:

> Project code answered a question the engine had already answered, answered it
> worse, and reported its own answer as a fact about the world.

Two structural causes.

**2.1 Private planners beside the search.** `mineflayer-pathfinder` is an A* whose
edges *are* actions — walk, jump, drop, dig-through, place-to-bridge, 1×1 tower.
Beside it we built a mining route planner, a stance enumerator, a surface
disturbance budget, and a collection approach probe. Each re-answers
"is this reachable", each can veto before the search runs, and §1.2 shows two of
them contradicting each other.

**2.2 No request lifecycle.** Nine components can decide what happens next:

```
model loop (handleMessage)   goal-director      job-director
agenda-director              role-director      survival-director
reaction-director            behavior-arbiter   self-prompter
```

`goal-director` owns typed goals. `agenda-director` owns parsed plans. A
plain-language request — *"go get some wood and make me some charcoal"* — is
owned by **none of them**. Measured: 28 commands across **4** separate
`handleMessage` invocations, with nothing carrying the request between them.

That absence is why four separate prompt nudges accumulated in one night. Four
reminders aimed at one behaviour is the signature of a missing state machine.

---

## 3. Research

### 3.1 The library already does the right thing

`node_modules/mineflayer-pathfinder/index.js:138`
```js
while (result.status === 'partial') {
```
It calculates in segments and continues from partial results. Our code:
```js
// skills.js — gates on total success, discards the segment
terminalPosition: terminal && result?.status === 'success'
```
The engine says *"here is a route 40 blocks toward your goal, ask again when you
arrive"*; the project hears *"there is no route."*

### 3.2 Baritone (Minecraft, Java) — the locomotion model to copy

- **18 movement types** in a `Moves` enum; each implements `calculateCost`.
- Costs include break time, tool wear, block placement, sprint/soul-sand/water
  modifiers, jump and fall-damage penalties.
- **"The system evaluates feasibility within movement calculations rather than
  separate decision logic."** Mining through a wall and pillaring up are *edges*,
  not skills. Tunnelling is discovered as the cheapest path; nobody writes a
  tunnel routine.
- **Segmented search.** Calculation ends three ways: goal reached, time out, or
  render-distance limit. On early exit, `AbstractNodeCostSearch` uses
  *incremental cost backoff* — best node tracked at several cost/heuristic
  coefficients, picking the least coefficient that still advances ≥ ~5 blocks.
- **`PathingBehavior`** holds `current` and `next` executors, precalculating the
  next segment while walking the current one.
- **`PathExecutor.onTick()`** watches deviation and cancels if the player strays
  too far too long. Each movement implements **`safeToCancel`** —
  `MovementDiagonal` verifies a supporting block so stopping cannot drop you.

### 3.3 Decision-layer paradigms

| paradigm | switching mechanism | suited to |
|---|---|---|
| Behavior Tree | higher task preempts lower-priority work | structured, tactical |
| GOAP | plans a chain to a goal, re-plans often, interrupts on urgent need | adaptive combat |
| Utility | continuously scores candidates, always takes the highest | **resource/survival** |

Common shipped hybrid, formalised as GOBT: **utility sets priority, a tree
executes the chosen plan.** The cited interrupt example is precisely the
requirement here — pause chopping wood when hunger spikes, then **return** to
the original task.

---

## 4. Proposed architecture

```
INTENT    LLM. Chooses goals and permissions. Never steps.
          "get 8 cobblestone, for the player, digging allowed, don't touch the base"

ARBITER   Utility scoring over candidate states. Owns the request lifecycle.
          The only thing that starts, preempts, resumes or ends work.
          Asks the running edge safeToCancel before preempting.

ENGINE    pathfinder + mineflayer. One search, one topology, action-typed edges.
          Segmented: commit a confident segment, re-plan while moving.
```

Do **not** add a tenth owner. `behavior-arbiter.js` exists; make it
authoritative and demote the directors to proposers returning
`{intent, priority, evidence}`.

### 4.1 A state is a contract, not a planner

```js
const MiningState = {
  name: 'mining',
  // The ONLY permission surface. Policy lives here and nowhere else.
  permits: movements({
    canDig: true,
    canPlaceBlocks: true,
    allow1by1towers: true,      // nerdpole out of a hole
    allowParkour: true,
    safeToBreak: (block) => !isPlayerBuilt(block),
    digCost: 1,
  }),
  goal: new goals.GoalGetToBlock(x, y, z),
  accepts: (world) => world.inventoryOf(BOT).cobblestone >= baseline + 8,
  yieldsTo: ['reflex', 'playerRequest'],
  budget: { ms: 120_000, attempts: 3 },
};
```

**Test for whether a proposed state is the right kind: does it contain a
search?** If yes it duplicates pathfinder and will eventually contradict it
(§1.2). If it only declares permissions, a goal, an acceptance test and a
budget, it is safe.

### 4.2 Outcome vocabulary — makes one class of lie unrepresentable

```js
did(x)                              // engine did it; evidence is the world
engine_cannot(reason, evidence)     // FINISHED search, conclusive negative
we_will_not(rule, whatWouldLiftIt)  // policy; always names the rule
unknown(reason)                     // budget/timeout/unloaded — never impossibility
```
Today these collapse into strings like `skill_unreachable`, which is how §1.1 and
§1.4 reached the player as facts about the world. `tools/veto-audit.mjs` already
enforces an analogous convention for movement amputations (currently 0 unnamed /
29 named); extend it to fail the build when an outcome crosses these categories.

### 4.3 Segmented execution

```js
let result = await pathfinder.getPathTo(movements, goal, TIMEOUT);
while (result.status === 'partial' || result.status === 'timeout') {
  await walk(result.path);                 // commit the segment
  if (accepts(world)) return did(goal);    // acceptance measured in the world
  result = await pathfinder.getPathTo(movements, goal, TIMEOUT);  // re-plan from here
  if (noProgress(result)) break;
}
return result.status === 'noPath'
  ? engine_cannot('noPath', evidence)      // only a FINISHED search says this
  : unknown('segment budget exhausted');
```

### 4.4 Interruption

```js
// Preemption asks the running edge, not a global flag.
if (arbiter.wants(higherPriorityState) && currentMovement.safeToCancel()) {
  const resume = currentState.checkpoint();   // return, don't restart
  arbiter.enter(higherPriorityState, { resumeAfter: resume });
}
```

---

## 5. Change list, cheapest first

1. **Stop discarding partial paths** (§3.1, §4.3). No library change. Should end
   most "unreachable" refusals on its own.
2. **Per-action `safeToCancel`** replacing global interrupt checks (§4.4).
3. **Outcome vocabulary + audit extension** (§4.2). Cheap, and it stops new
   sediment forming while the rest proceeds.
4. **Request lifecycle on the arbiter** (§2.2). When it lands, delete the four
   prompt nudges — stall nudge, drift reminder, request quoting, delivery framing
   — plus `COMMANDS_BETWEEN_REQUEST_REMINDERS` / `MAX_REQUEST_REMINDERS`. They
   exist only because nothing can answer "is it done yet."
5. **Delete the private planners** (§2.1). Each is either expressible as a
   `Movements` restriction — convert it — or is a goal choice, which moves to the
   arbiter. Largest item; do not start before (3) can catch its regressions.

### Where forking a library is justified
- **Cost backoff.** If partial-segment selection proves poor, port Baritone's
  multi-coefficient "best node at least N blocks along".
- **A genuinely missing movement type.** Add it to the *search* with a cost
  function — never as a skill beside it.

Not justified for anything a `Movements` field can express. Nearly every
"missing capability" investigated turned out to be a capability switched off.

---

## 6. Already fixed (do not redo)

All measured, all on current HEAD.

| fix | evidence |
|---|---|
| Surface disturbance measured by **footprint** (distinct sky-lit columns) instead of depth/step-index | a 1-wide shaft is one hole however deep; regression from `a67f35f`, 2026-08-10, which had silently ended straight-down mining |
| Excavation ordered **top-down** for non-gravity blocks (gravity keeps lowest-first) | buried stone collection 0 → 2 |
| Retry a selected candidate once with **natural route digging** authorized | mine-exact case 0 → 4 cobblestone delivered |
| Progression ladder gated on `!open_player_request` instead of a profile name | the gate had only ever applied to the *test* profile; Kevin ships `balanced` |
| Death-recovery obligation no longer a precondition for player requests | §1.4 deadlock gone from every case |
| Policy refusals say "I will not \<rule\>" instead of "unreachable" | §1.1 |
| Partial collection reports its count instead of total failure | §1.5-adjacent |
| Hand-over collects the dropped stack back before retrying | §1.5 |

---

## 6a. ☠ DEAD — hypotheses tried and killed, do not revisit

Recorded so a reviewer does not re-derive them. Each was plausible, and each was
killed by measurement rather than argument.

- **"Stone is excluded from the breakable-terrain set, so route digging cannot
  tunnel to it."** False — `stone` is in `NATURAL_FILL_BLOCKS`.
- **"A solid mass has no legal stance, so collection refuses it."** False — a
  4×3×4 exposed outcrop collects on the first try, every run. The variable was
  never solidity; it was whether the route had to descend through cover.
- **"`bot.dig(block, true, 'raycast')` fails because the bot is not facing the
  block, so aim first and retry."** Implemented, changed the measured outcome by
  exactly nothing, reverted rather than committed. The block was fully enclosed —
  no face existed to aim at. The real cause was excavation order (§1.3).
- **"`!collect` and `!collectBlocksInRange` disagree about the same rock."**
  False — both collect 3 from the same outcrop. The apparent difference was
  partial results being reported as total failure.

The general lesson, which held four times: **reading the code produced confident
wrong answers; a probe that varied one thing produced right ones in minutes.**

## 7. Open risks

- **Variance (§1.7) is unexplained.** Same seven cases, 3/7 → 5/7 → 5/7 different
  → 4/7. Hypothesis: with no request lifecycle, completion depends on the model
  staying lucky. Untested.
- **Hand-over recovery is unbounded.** Each failed attempt now spends a walk
  collecting the stack, up to three times, against a fixed per-case budget. It
  fixed two cases and plausibly starved three long ones in the same run.
- **`!givePlayer` is a toss**, not a transfer. Even with recovery, delivery
  depends on the recipient picking up.
- **Historical anchors** for comparison: `344d0e2` (Aug 1 follow/delivery),
  `b47117b` (10/10 clean doorway-corridor follow), `12bdc21` (Aug 15 broad
  behaviour corpus). HEAD is 62 commits past `12bdc21` with **+5,344 / −317**
  lines in `src/`, including six new gating subsystems. Most Aug 11–14 campaigns
  ran from a dirty tree, so no exact working snapshot exists — the recovery path
  is replay-and-repair at HEAD, not rollback.

## 8. Acceptance

`tools/probe-request-completion.mjs` — replays recovered campaigns as short
cases; acceptance is an item count read from a **real second player** on the
server, in seconds rather than a session.
`tools/probe-collection-geometry.mjs` — isolates one geometry variable at a time.

Target: every promoted campaign passing **repeatedly**, not once.

## Sources
- https://deepwiki.com/cabaletta/baritone/4-pathfinding-system
- https://github.com/cabaletta/baritone/blob/master/FEATURES.md
- https://www.jmis.org/archive/view_article?pid=jmis-10-4-321
- https://tonogameconsultants.com/game-ai-planning/
- https://tonogameconsultants.com/goap/
- https://www.gamedeveloper.com/programming/behavior-trees-and-the-future-of-intelligent-control-2
