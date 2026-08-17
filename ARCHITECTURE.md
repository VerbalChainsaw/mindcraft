# Minecraft Companion — Architecture

This file is the design. It is short on purpose. If it grows past ~200 lines,
something has gone wrong.

## The product

Kevin is a companion for a kid. Success is: the kid says something, and Kevin
does it — or says plainly why he can't. Everything else is secondary.

## Current state (2026-08-16)

The repo has two complete brains fighting each other:

- MindCraft's original LLM loop (`self_prompter`, 133 `!commands`, `prompter`).
- A bespoke deterministic control plane: 67 files, 33,303 lines in
  `src/agent/runtime/`, nine `*Director` classes, a 20-lane `BehaviorArbiter`.

In `behavior-arbiter.js`, the `self_prompt` lane is evaluated **last** — after
job, goal, agenda, rules, reaction, and progression all decline. The
conversational intelligence is the lowest-priority actor in the system.

This is why the bot ignores instructions and looks stupid. It is not a bug in
any one module. It is the hierarchy.

## The fix: invert the hierarchy

Four layers. In priority order. Nothing else.

### 1. Reflex — deterministic, preemptive, ≤5 conditions

Drowning, lava, health critical, hostile adjacent, starving.

Interrupts anything. Resolves one hazard. Returns control. **Reflex may not
plan, may not choose targets, may not start work.** It gets out of danger and
exits.

### 2. Player command — overrides everything except Reflex

A command from the kid replaces the current intent immediately. No settlement,
no obligation ledger, no material-change blocker, no persona pause, no
negotiation. If Kevin can't do it, he says so in one sentence — and if a
single question would unblock him, he asks it instead of guessing or stopping.
One question, then he waits.

**Asking is the fallback.** Director intent, 2026-08-17: "I wanted Kevin to ask
me instead of being confused." The retired contract had this, as
`bounded-player-question` — stage six of seven, behind settle, reconcile,
material-change retry, authorized alternative and decomposition. A companion
who runs five mechanisms before asking a simple question reads as broken. No
command to ask the player exists yet; that is a gap, not a design choice.

**A player command is never deferred, queued behind, or paced by anything.**

### 3. LLM sequencing — owns "what next"

The LLM picks the next primitive from the skill library, sees the result, picks
again. That's the loop. It is not gated behind deterministic policy lanes.

### 4. Idle — one behavior

Stay near the player. That's it. Idle does not start projects.

## Intent model

**One current intent. In memory.**

```js
{ text: "get me some wood", queue: [...primitives], startedAt: ... }
```

- New player command → **replace it.** Say what got dropped: "ok, stopping the
  mining."
- Reflex fires → keep it, resume after. **One level deep. No stack.**
- A primitive fails → tell the LLM why, let it choose the next one.
- Bot restarts → the intent is gone. That is fine. The kid will ask again.

No durable obligation ledger. No cross-session resumption of *work*. No
settlement contracts.

**What does survive: everything Kevin knows.** Home, landmarks, saved places,
verified procedures, remembered facts. `activity-freshness.js` already draws
this line — it expires in-flight work orders, typed goals, agenda queues and
standing directives, and deliberately exempts knowledge. Steps 4 and 5 delete
the obligation machinery, **not** `knowledge-store.js`, `landmark-memory.js`,
`home-state-store.js`, `memory-recall.js`, `personal-memory.js` or
`player-memory.js`. Those feed the prompter, which Step 6 promotes.

Director intent, 2026-08-17: remembering where the house is, where the mine
is, and where things happened is what makes Kevin a companion rather than a
tool. `!rememberHere`, `!goToRememberedPlace`, `!savedPlaces` and
`!rememberHome` already ship. Forgetting a task is fine. Forgetting the house
is not. If Kevin forgets what he was doing after a creeper interrupts him
twice, that is an acceptable companion. A companion who ignores the kid because
he's settling an obligation from four minutes ago is not.

## Primitives

Single actions, clear success or failure. `goto`, `mine_block`, `place_block`,
`attack`, `pickup`, `craft`, `eat`, `equip`, `follow`, `say`.

Every primitive returns exactly:

```js
{ ok: true|false, why: "short string" }
```

Nothing else. No receipts, no contract stages, no evidence envelopes.

## Locomotion

**Default movement allows digging.** A companion who cannot break a dirt block
cannot follow a kid across ordinary terrain.

```js
canDig = true
allowParkour = true
allow1by1towers = true
```

Terrain protection is a **blocklist of player-built blocks**, not a global ban
on digging. Protecting a hedge is not worth a companion who gets stuck on grass.

## Rules we deliberately do not have

Written down so they don't come back:

- No obligation ledger, settlement contract, or material-change blocker.
- No comportment/persona pause ahead of a player command.
- No per-lane director classes.
- No "repair the highest proven shared seam" — that rule is how 33k lines of
  runtime abstraction happened. Fix the leaf.
- No new test framework, fixture system, scenario matrix, or review artifact
  system.
- No plan documents unless explicitly asked for.

## Acceptance

**A scenario exits 0 on the current commit.** As of 2026-08-17 three do:
`scenario:follow`, `scenario:obstruction` and `scenario:deliver`.

Nothing is "done" until a scenario passes on HEAD. As of this writing the
scenario manifest records zero passing runs and its `candidateCommit` is 250
commits stale. Fixing that is task #1 — it is the only thing that makes
progress survive a session boundary.

The harness already exists (2,356 lines in `tools/scenario-lab/`). It does not
need to be rebuilt. It needs to be made to pass.

---

# Migration plan

Ordered. Do not skip ahead — step 1 is what makes the rest verifiable.

## Step 1 — Make one scenario pass on HEAD

Get `scenario:follow-field` or `scenario:stone-recovery` to exit 0 and record
`passed` in `tools/scenario-lab/scenarios.v1.json`. Update `candidateCommit`.

This is a debugging job, not a build job. The adapters and PowerShell workers
are already written.

## DONE 2026-08-16

- **Locomotion** (step 2). `safeMovements()` now sets `canDig = true` with a
  real blocklist built from `PROTECTED_GAMEPLAY_BLOCKS` + hazards. Grass, dirt,
  stone and sand are diggable; bedrock, portals, chests, furnaces, crafting
  tables and lava are not. Confirmed cause of the 2026-08-16 live failure.
- **Directive retry** (part of step 3). A material-change blocker on a player
  directive is now bounded by `DIRECTIVE_RETRY_HOLD_MS` (6s). Previously it
  released only on dimension / 8-block movement / target / world change, so a
  failed follow left the companion standing still after it had announced it was
  following. Eight consecutive parked follows were recorded in live telemetry.
- **Activity state expiry** (step 5, first slice). `activity-freshness.js`
  expires in-flight state — active work order, typed goal, agenda queue,
  standing directive — after 15 minutes. Durable knowledge (home, landmarks,
  procedures, remembered facts) and Operator Hold are deliberately exempt. This
  ends "resumed into a state that never existed": one real bot directory held
  a home from Aug 6 beside an agenda from 11:14 the same morning.
- **Memory erosion.** Prose memory budget 500 → 1500 chars, truncation now cuts
  on a sentence boundary instead of mid-character. The old hard slice corrupted
  the memory and then fed that corruption back in as "Old Memory" on the next
  pass. The prompt now forbids dropping a durable fact to save space.
- **Scenario lab.** Re-registered to HEAD, gitdir resolution fixed for this
  worktree, and a `--regression-mode` added so the harness gates development
  instead of certifying one frozen commit. See `tools/scenario-lab/FIXTURES.md`.

Still open below.

## Step 2 — Fix locomotion (DONE — see above)

`src/agent/library/skills.js:1524` `safeMovements()` sets `canDig = false` for
all ordinary locomotion — following, workstation approaches, pickup, recovery.
Default `traversalPolicy` is `'preserve'` (`agent.js:384`), which also disables
parkour, towers, and block placement.

Set the default to `full`. Replace the global dig ban with a player-built-block
blocklist. Nine call sites set `canDig = false`; most should not.

## Step 3 — Player command preempts

In `behavior-arbiter.js`, a player directive currently sits behind
`emergency`, `attributed_protection`, `active_action_retention`,
`bounded_recovery`, and `comportment_pause`. Move it to position 2, directly
below Reflex. Delete `comportment_pause` entirely.

## Open engine defects found by the harness

Found 2026-08-16 while building a typed-goal scenario. All three are real
gameplay defects; only the first is fixed.

**1. Collection route probe budget — FIXED.** The wall clock (75ms) was tighter
than the compute the probe was already allowed (120ms), so searches were cut off
before finishing. Live: "Found 12 dirt candidates, but none has a safe reachable
route (timeout:12)" with dirt two blocks away and visible, followed by a 32-block
relocation. Raised to 400ms; compute budget unchanged.

**2. A timeout is classified as unreachable — FIXED.** The skill recorded
`routeStatuses {timeout: 12}` and reported `outcome: 'unreachable'`. When every
rejection is a clock expiry the candidates are now re-probed once at 1500ms
before concluding. `noPath` is deliberately excluded: re-probing a genuine
missing route would hide the defect class this harness exists to catch.

**3. A typed goal survives death and continues from the respawn point — FIXED.**
The bot died mid-goal, respawned ~1,400 blocks away at world spawn, and the goal
carried on from there: it collected a grass_block near spawn, then tried to walk
back to the recipient across open ocean until it timed out and drowned. Nothing
re-established whether the goal was still viable from the new position. In play
this reads as: die once, and the companion sets off on a doomed cross-country
march instead of reassessing.

Resolved by DEATH_RESUME_MAX_DISPLACEMENT (128), anchored to the ~96 blocks
the goal already relocates of its own accord. Beyond that the goal settles
and says so; nearer than that it resumes as before. An unobservable anchor
never abandons the goal -- unknown distance is not "too far".

## The deliver course is blocked on the world, definitively

A typed-goal scenario (`!requestItemGoal("deliver","dirt",1,...)`) was built and
run five times against the follow fixture. It cannot pass there, and the reason
is now evidence rather than inference — the last run had mobs eliminated as a
variable:

```
sourcePresent : true    the dirt is demonstrably placed
mob contact   : none    peaceful difficulty held
actions       : self_preservation/skill_drowning_escape_open_water
                collectBlocksInRange/skill_unreachable
                moveAway/skill_unsafe_medium
```

The chain: collection cannot route, so the goal relocates 32 blocks
(`ACQUISITION_REGION_RELOCATION_DISTANCE`); the fixture is an island, so 32
blocks is open ocean; the bot enters an unsafe medium, starts drowning, and
self-preservation seizes the body, interrupting the collection. Repeat until
timeout.

**A typed-goal scenario needs a dry-land world — RESOLVED 2026-08-17.** The
world does not have to be authored, only generated. `deliver-item-goal` runs on
a superflat recipe (`tools/scenario-lab/fixtures/deliver-item-flat-v1`) whose
surface is y=100, which is where the existing course constants already sit, so
the course geometry is unchanged. `npm run scenario:deliver` exits 0 on HEAD:
both request forms delivered, `FollowTarget` 0 -> 1 dirt, zero safety
violations. The fixture premise is measured rather than assumed — four
dry-land probes at 40 blocks, past the 32-block relocation.

The course itself is worth keeping. It never passed and still produced four
engine defects — the route probe budget, timeout-as-unreachable, goal-survives-
death, and hostile mobs deciding scenarios — every one of which is now fixed.

## Coverage gate — read before Step 4

**Step 4 and Step 5 are blocked on scenario coverage, not on nerve.** The
original ordering here said "make one scenario pass, then collapse". That was
written before it was clear what the one scenario covers.

Both runnable scenarios issue `!followPlayer(...)`. They prove following, on
open ground and through broken terrain. Nothing else is runnable:
`stone-recovery` has no fixture anywhere on the machine, and three families are
`unavailable`.

Against that, Step 4 proposes deleting:

| Director | Lines | Capability | Unit tests |
|---|---:|---|---|
| `goal-director` | 3,270 | typed goals — "get me 8 iron and come back" | 2 files |
| `agenda-director` | 2,153 | multi-step player requests | 2 files |
| `role-director` | 487 | autonomous role work | **0** |
| `reaction-director` | 270 | speech and gesture reactions | 3 files |
| `progression-director` | 208 | self-directed progression | **0** |

6,388 lines, of which the live harness exercises none. Deleting typed goals and
the agenda with follow-only coverage would remove the capabilities behind every
request that is not "come here", with no way to see what broke until someone
plays. That is the exact failure mode this whole effort exists to end.

**Prerequisite for Step 4:** a scenario that exercises a typed goal
(acquire an item and deliver it) and one that exercises a multi-step agenda
request.

- Typed goal: **DONE** (2026-08-17). `deliver-item-goal` passes on HEAD and
  covers `goal-director` end to end — `!requestItemGoal` dispatching
  `!collectBlocksInRange` then `!givePlayer`, with the item verified in the
  recipient's inventory. Both the direct and natural-language forms pass.
- Multi-step agenda: **still missing.** `agenda-director` (2,153 lines) has no
  live coverage.

### The gate is frozen. Do not add to it.

A gate that grows one item per session is not a safety mechanism, it is a
decision not to collapse, taken by default. Between 2026-08-16 and 2026-08-17
the prerequisite went from "one scenario passes" to "typed goal" to "typed goal
and agenda". That stops here.

**The gate is one scenario per request class the player actually uses.** Not one
per director — directors are what Step 4 deletes, so coverage defined by them is
effort spent on the thing being removed. Every scenario must assert a
player-visible outcome, because that is the assertion that survives the
rewrite: after the collapse, the same scenario should still pass against
completely different internals. `deliver-item-goal` asserts "the dirt is in the
recipient's inventory", which is true or false regardless of whether
`goal-director` exists.

| Request class | Scenario | State |
|---|---|---|
| follow me | `doorway-corridor-follow` | green |
| follow me through terrain | `obstruction-follow` | green |
| bring me X | `deliver-item-goal` | green |
| come here | — | missing |
| get me X (no delivery) | — | missing |
| build me X | — | missing |
| protect me / stay here | — | missing |
| remember this place / take me there | — | **missing, and it matters** |
| ask me when you're stuck | — | **no command exists** |

**This list is provisional and the Director owns it.** It was written from the
intent model above, not from observation. **Ask the Director for the real
list.** Do not infer it from the repo, and do not expect any agent or
assistant to supply it — they are helping build this, they are not the
player. The kid is the acceptance test; the Director is who you ask.

**Two rules, once it is frozen:**

1. No item may be added without the Director. A new idea for coverage is a note,
   not a gate item.
2. When the table is green, Step 4 executes. Not "is considered" — executes.

If the honest answer turns out to be that no amount of coverage feels like
enough, then the collapse is not happening, and this file should say so and stop
describing a migration nobody intends to run. That is a legitimate outcome. What
is not legitimate is leaving it permanently one scenario away.

Cost is no longer the obstacle. The expensive part of a new course was the
mechanism — generated fixture, worker branch, evidence branch — and that is
built and documented in `tools/scenario-lab/FIXTURES.md`. Each remaining course
is a recipe plus roughly a hundred lines.

**Step 4 remains gated.** Half the prerequisite is met, not all of it. Deleting
`agenda-director` with no scenario exercising a multi-step request would repeat
exactly the mistake this gate exists to prevent. The deliver course is the
pattern to copy: it needed a generated world and ~200 lines, no new framework.

Until then, treat the lane count as a known cost, not an emergency.

## Step 4 REVISED 2026-08-17 — reorder, do not delete

Evidence from seven live runs changed this step. The original plan deleted 6,388
lines of directors on the theory that the LLM would pick up the slack. That is
the wrong trade, and the reason is measurable.

**What was actually wrong.** `player-directives.js` holds a regex table that maps
plain English onto composite job commands before any model is consulted:

```
/(?:harvest|collect|gather|chop|get).{0,32}(?:wood|logs?|trees?)/
  -> !assignHarvestJob("logs", 32, player)   + a canned reply
```

"Go get some wood and make me some charcoal" matched on the wood clause, fired a
job, and discarded the charcoal half without ever looking at it.
`dispatchPlayerAgenda` does the same for anything that parses as a chain. So the
model was not merely lowest priority; for these phrasings it was never called.

**What the model does when it IS called.** Refused a composite it asked for, it
composed a primitive instead, unprompted:

```
!collectWoodInRange(4, 64)  -> not available
"Switching to safe primitive"  -> !collectBlocks("oak_log", 8)   executed
```

And when it could not reach the log, it asked:

> "The nearest oak log is unreachable from my position. Would you like me to
> search a wider area or try a different approach?"

That is the Director's stated requirement, and it cost nothing to build. It was
never a missing capability; the model was never consulted.

**So the composites are not the defect.** They work, they represent real
engineering, and a model that can call them is strictly more capable than one
that must rebuild them from primitives every time. The defect is the ORDER.

### The revised step

1. The model decides. Deterministic interceptors do not get first refusal.
   `llm_sequencing` already does this for `dispatchPlayerAgenda` and the regex
   directive table.
2. The full command surface stays available to it, jobs included. A composite is
   a tool the model may choose, not a script that pre-empts it.
3. When nothing fits, it composes primitives. When it is stuck, it asks.
4. Reflex still preempts everything. That layer is unchanged.

Nothing is deleted to get here. Lanes may still be retired later on evidence,
one at a time, once the model is demonstrably choosing well without them — but
that is cleanup, not a prerequisite, and it is no longer what unblocks the
product.

### What this does to the coverage gate

The gate was sized for a large deletion. Reordering is reversible by one flag, so
it does not need the same proof. The scenarios still matter, but as evidence the
companion behaves — not as permission to delete.

## Step 4 — Collapse the lanes

20 → 4. Delete these lanes and their directors:

`bounded_recovery`, `comportment_pause`, `opportunity`, `self_progression`,
`role_work`, `factual_reaction`, `idle_embodiment`, `active_action`.

Collapse `player_directive` / `player_goal` / `player_job` into one
`player_command` lane.

Directors to remove: `agenda-director`, `progression-director`,
`role-director`, `reaction-director`, `goal-director`. Keep a thin
`survival-director` (Reflex) and the job/skill execution path.

## Step 5 — Delete the obligation machinery

~3,818 lines across `work-order.js` (1021), `agenda.js` (1009),
`goal-contract.js` (944), `action-receipt-ledger.js` (421),
`obligation-settlement.js` (231), `job-state-store.js` (116),
`component-transaction.js` (76).

Replace with the single in-memory intent struct above.

## Step 6 — Give the LLM the wheel

Move LLM sequencing from last-evaluated to layer 3. It should be the default
source of "what next" whenever no reflex is firing and no player command is
outstanding.

## Non-goals for this migration

Do not add capabilities. Do not improve the LLM prompt. Do not build new tests
beyond what step 1 requires. The goal is a smaller system that behaves
consistently, not a better one.
