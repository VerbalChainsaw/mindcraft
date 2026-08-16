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
negotiation. If Kevin can't do it, he says so in one sentence and stops.

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

No durable obligation ledger. No cross-session resumption. No settlement
contracts. If Kevin forgets what he was doing after a creeper interrupts him
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

**`npm run scenario:follow-field` exits 0 on the current commit.**

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
