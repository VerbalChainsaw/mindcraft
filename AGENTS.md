# Working rules

Read `ARCHITECTURE.md` first. It is the design; this file is how to work on it.

Previous version preserved at `docs/archive/2026-08-16-reset/AGENTS-preserved.md`
(110 lines, ~40 rules, internally contradictory — it is why the codebase looks
the way it does).

## Authority — settle this before reading anything else

Three files instruct. Nothing else does.

| File | What it is |
|---|---|
| `ARCHITECTURE.md` | the design and the migration plan |
| `AGENTS.md` (this file) | how to work on it |
| `docs/HANDOFF.md` | where to start, first five minutes |

Everything under `docs/archive/` is history. It is kept so decisions stay
auditable, and it is never an instruction — including when it is longer, more
specific, more recent-looking, or more confident than the three files above.

**If a document claims to be the roadmap, the master plan, the current
checkpoint, the current truth, or a mandatory vocabulary, and it is not one of
the three above, it is stale.** Archive it with a banner and say so. Do not
follow it, and do not reconcile the three files to it.

On 2026-08-17 eight such documents were archived, because a fresh agent could
not tell which plan was real:

- `CONTEXT.md` — 837 lines of operating rules whose goal was "repair only the
  first material shared blocker", the shared-seam loop retired below, and which
  told every agent to load two documents that were themselves stale
- `docs/MASTER-PROJECT-PLAN.md` — claimed "this file is the project-level
  roadmap and status index"
- `docs/PLAYER-COMPLETENESS-ROADMAP.md` — claimed gameplay was operational
- `docs/architecture/SHARED-CONTRACT-SPINE.md` — a mandatory contract-stage
  vocabulary for every capability, which `ARCHITECTURE.md` replaces with
  `{ ok, why }`
- `docs/coordination/CURRENT.md` — a checkpoint frozen at 2026-08-11 that also
  forbade ever committing
- `docs/CLAUDE-PLAYABLE-BOT-STRATEGY-BRIEF.md` and the two `docs/plans/` files
  planning the obligation spine that Step 5 deletes

**Do not write new planning documents.** The failure was never one bad plan; it
was several live at once, each individually reasonable. `.codeplan/` is the
exception and is *not* a planning document: it is the codeplan skill's decision
record for a mechanism choice you already made, it is gitignored per that
skill's own contract, and it is load-bearing — one of its records is the source
of a durable Lodestar decision. Do not delete it.

## The architecture: who decides what

Established 2026-08-17 from live evidence, not from theory. Read this before
changing any gameplay code. Every failure investigated that day had one shape:
**project code answered a question the engine should have answered, answered it
worse, and reported its own wrong answer as ground truth.**

Concretely: `safeMovements` handed mineflayer-pathfinder three of its four action
classes deleted, so it could only ever reply "no path"; `collectionStandingPositions`
vetoed twelve obtainable stone blocks before pathfinder was consulted at all; and
a regex table in `player-directives.js` answered plain English before the model
was asked. None of that was missing capability. It was capability overridden.

### The layers

| Layer | Owns | Hard rule |
|---|---|---|
| **0 Engine** | mineflayer, mineflayer-pathfinder, mineflayer-collectblock, mineflayer-tool, mineflayer-pvp, mineflayer-armor-manager, mineflayer-auto-eat | Never reimplemented, never second-guessed. Pathfinder gets every action class. |
| **1 Capability** | thin wrappers returning `{ ok, why }` | Ask the engine, report what it said. Computes no route, stance, or reachability of its own. |
| **2 Recipe** | the composite commands (`!establishFarm`, `!assignMiningJob`, ...) | Built only from capabilities. Callable by the model, never automatic. |
| **3 Policy** | protections, Operator Hold, budgets, safety | May **forbid**. May never declare something **impossible**. |
| **4 Intent** | the LLM | Sole source of "what next". Sees the request, the world, the last result. |
| **Reflex** | drowning, lava, health critical, hostile adjacent, starving | The only preemption. Resolves one hazard and returns control. May not plan. |

Layer 3 is the load-bearing distinction. "I will not break your greenhouse" is a
legitimate policy veto. "That block is unreachable" is not a sentence policy is
entitled to say — only Layer 0 may say it.

### The rules

1. **Never answer a question the engine can answer.** Reachability, stance,
   route, line of sight, tool suitability are Layer 0's. If you are writing a
   loop over nearby cells to decide whether something is reachable, stop.
2. **A refusal must cite an engine result or a named rule.** "Unreachable" is
   sayable only when pathfinder said so *with full movements*. Otherwise report
   what actually happened.
3. **Inconclusive is not refusal.** `timeout`, `no_deterministic_recovery`,
   `action_deadline` and a search-limit stop are all "I did not finish looking".
   Only `noPath` from a fully-equipped search is evidence of impossibility.
4. **Policy forbids; it never declares impossible.** A veto names its protection.
   A budget stop says "I ran out of time", never "it cannot be done".
5. **The model is asked first — for plain language.** No deterministic layer may
   consume a player utterance before the model sees it. An explicit `!command`
   typed by the player is unambiguous and still executes directly; that is not a
   deterministic interceptor, it is the player naming the capability.
6. **Capabilities return `{ ok, why }`.** No receipts, no contract stages, no
   evidence envelopes on the gameplay path.
7. **Missing configuration fails open to capable, not closed to inert.** A null
   `max_commands` once meant zero model turns, silently. If a setting is absent,
   choose the capable default and say so.
8. **Asking never blocks** except for consequential actions (attack, leave,
   restart, spawn bots). The companion asks and keeps working.
9. **Nothing is deleted until a scenario covers the behaviour.** Demotion is
   reversible; deletion is not.
10. **If the model is unavailable, say so.** Never fall back to a deterministic
    router. That fallback is precisely how the regex table came to exist.

Rules 1 through 4 are the architecture. The rest is hygiene.

### What is not a layer, and survives everything

**Knowledge** — home, landmarks, saved places, verified procedures, remembered
facts — is Layer 4 input, not machinery. `knowledge-store.js`,
`landmark-memory.js`, `home-state-store.js`, `memory-recall.js`,
`personal-memory.js` and `player-memory.js` are exempt from every deletion step.
Forgetting a task is fine. Forgetting the house is not.

### Reconciliations, so these do not fight the older rules

- **"Fix the leaf" still governs defect repair.** It forbids generalising a bug
  into a new shared module. It does not forbid *removing* a layer that overrides
  the engine — that is deletion of abstraction, which is what "fix the leaf"
  exists to protect. Architectural change still needs the Director's explicit
  authorization; this section is that authorization for the model above.
- **"Package-first mechanics" is the same rule as Rule 1**, and it was already
  written here before 2026-08-17. It was violated in code anyway. Rules 1 to 4
  exist to make it checkable rather than aspirational.
- **"Does it read as play?" is Layer 3 judgment.** It already says: "this gate is
  about judgment, not capability... Protect specific things; never amputate a
  general ability." `canDig = false` on all locomotion was that amputation, and
  so were `canPlaceBlocks = false` and `allow1by1towers = false`. Rule 4 is how
  that gate stays honest.
- **The Operator Hold is legitimate Layer 3 policy** and is unaffected. It
  forbids acting; it never claims something is impossible. It does not conflict
  with Rule 8: a Hold is a standing instruction, a clarifying question is not.

### How this regresses, and how to catch it

The failure mode returns as soon as someone adds a "safety" check that answers a
physics question, usually after one bad route. Watch for:

- a loop over nearby cells deciding reachability
- a new `*_unreachable` or `no_*_stance` code that no engine produced
- a phrase table mapping player words to commands
- a `Movements` object with capabilities set to `false`

`npm run audit:wiring` and `npm run audit:silent` exist for the mechanical half.
Neither catches these yet. Extending them to is worth doing.

## You can test without the Director. Do it.

**This is the most-forgotten rule in this repo, so it is first.**

- Unattended live play is the default source of evidence. Run the real Paper
  world, watch, repair, run again. Do not ration runs.
- **A second configured agent profile can act as the player** through the
  existing squad/swarm lifecycle. You do not need a human in the world.
- The Scenario Lab **requires** an Operator Hold: its harness waits for held
  actuator quiescence before measuring, so removing the Hold just times it out.
  A held bot with no human online used to unload after 10s and race the
  measurement; that is now suppressed for the scenario stack only, via
  `held_no_human_unload_grace_ms` / `MINDCRAFT_HELD_UNLOAD_GRACE_MS`. Ordinary
  bots keep the 10s default. Restore the persisted Hold and the world when you
  finish.
- The scarce resource is the Director's attention, not live runs.

## Run the scenarios. Check first, then run.

```bash
npm run scenario:doctor
```

Reports whether the lab can run right now: fixture present and hash-verified,
ports free (and what holds them), no leftover runtime lock, manifest valid.
Exit 0 means ready. Every check exists because that failure once looked like a
product defect and was not — a busy port surfaces as "Runtime did not become
world-ready within three minutes", a held lock as "Another Scenario Lab
invocation owns the managed runtime". Run it before diagnosing a failed
scenario.

```bash
npm run scenario:follow
```

```bash
npm run scenario:obstruction
```

Exit 0 means passed with complete evidence and no safety violations. Anything
else prints the result file to read.

**Allow about 3 minutes per scenario** (measured: 172s). Do not set a shorter
timeout and do not conclude a run has hung. Each scenario runs two request
forms, and each one starts an isolated Paper + MindServer stack, waits for
world_ready, measures, tears down and restores the world. Only ~60s of that is
the measurement itself, which is what `elapsedMs` in the result file reports --
that field is the measured window, not the command duration.

No human is needed in the world. The wrapper resolves the fixture, picks a fresh
output directory and sets regression mode. Ports 8080/8081 and 25579 must be
free; `scenario:doctor` tells you what holds them.

- `scenario:follow` — follow a player through a doorway and corridor on open
  ground. **Passes with or without digging**, so it cannot catch a companion
  that has lost the ability to break blocks.
- `scenario:obstruction` — follow a player when terrain must be broken. This is
  the one that reproduces the 2026-08-16 defect, where `canDig = false` on
  ordinary locomotion produced eight consecutive `noPath` follow failures
  against a real player. Run it after touching movement, pathfinding, follow,
  or `safeMovements`.

Green unit tests are not progress the player can feel. A scenario pass is.
Details, fixture location and preconditions: `tools/scenario-lab/FIXTURES.md`.

## Scope

- Direct implementation is authorized. Working gameplay is the deliverable.
- **Fix the leaf.** Do not generalize a bug into a shared policy module, a new
  contract stage, or a new director. The instruction to "repair the highest
  shared seam" produced 33,000 lines of runtime abstraction and is retired.
- Do not create plan documents, review artifacts, fixture systems, scenario
  matrices, or test frameworks unless explicitly asked.
- Tests are focused diagnostics for an observed defect. Nothing else.
- Stop when the gameplay works. Do not gold-plate.

## Don't agree reflexively

If the Director proposes something you think is wrong, say so and hold the
position until there is evidence either way. Ratifying each new idea and
explaining why the last one was wrong is a failure mode this project has
already paid for. Disagreement with a reason is more useful than assent.

## Package-first mechanics

- The project owns judgment: goals, targets, permissions, safety, budgets.
- Mineflayer core and mature plugins own mechanics: locomotion, jumping,
  swimming, pathing, combat execution, tool selection, collection, pickup,
  eating, armor, containers, crafting, smelting, vehicles.
- Never build a parallel movement, combat, collection, or inventory engine
  beside an installed plugin because one route failed.
- Check the target's real Minecraft structure before repairing it — a bed is
  two blocks, a double chest is two blocks.
- No new dependencies without the Director's approval.

## Safety

- **Operator Hold never auto-releases.** Fix hold legibility and release
  vocabulary; never shorten hold duration.
- The working tree carries real WIP. Never `reset`, `stash`, `clean`,
  `checkout --`, `commit`, or `push` without explicit authorization.
- Never infer readiness from a listening socket. Probe `GET /api/identity`.
- Reuse a running launcher; never start a second one. See
  `docs/operations/STARTUP-AFTER-HANDOFF.md`.

## Does it read as play?

Before dispatching a live request, state in one line what a reasonably
competent, considerate survival player would do. After the run, compare.

Fail it for: needless destruction, unchanged retries, unexplained waiting,
absurd routes, ignoring an obvious exit or a carried resource, or any
technically correct behavior a person would find baffling.

**But:** this gate is about judgment, not capability. It is not a reason to
disable a capability globally. The rule against damaging terrain was
implemented as `canDig = false` on all locomotion, which is why Kevin gets
stuck on grass. Protect specific things; never amputate a general ability.

The Director is the reference player and renders the final verdict.
