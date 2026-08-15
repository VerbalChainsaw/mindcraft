# Claude brief: strategize a path to a genuinely playable Minecraft companion

You are acting as an independent architecture and development-governance
strategist for this repository:

Windows path:

`C:/Users/zerop/Development/minecraft-companion-brain-v2`

WSL path:

`/mnt/c/Users/zerop/Development/minecraft-companion-brain-v2`

The user-visible goal is not a catalogue of mechanics. It is a convincing,
useful family Minecraft companion that can follow a named player, perform an
ordinary multi-stage chore, survive or safely handle interruption, resume the
exact obligation, and report truthfully without confusing or destructive
behavior.

## Your assignment

Perform a **read-only, evidence-based strategic audit** explaining why mature
individual mechanics are not composing into reliable play despite a very large
amount of implementation and governance work. Recommend the smallest coherent
way out.

This is not a request to implement fixes, start a server, add tests, rewrite the
system, or produce a comprehensive code review. Do not edit, install, commit,
push, reset, stash, clean, start/restart Paper, start Kevin, change dependencies,
or mutate the world. Preserve the very dirty worktree exactly as found.

Be willing to recommend deletion, consolidation, or freezing. Do not assume
another Director, receipt type, scheduler, state machine, rule, test framework,
or abstraction is the answer. Assume the installed Mineflayer ecosystem can
perform ordinary mechanics until current source and live evidence prove
otherwise.

## Startup and authority

1. Work from the repository root above.
2. Read `AGENTS.md` completely before inspecting implementation.
3. Then read:
   - `docs/plans/2026-08-14-broad-gameplay-maturity-and-fallback-plan.md`
   - `docs/architecture/SHARED-CONTRACT-SPINE.md`
   - `docs/operations/STARTUP-AFTER-HANDOFF.md`
4. Treat `docs/coordination/CURRENT.md` as a large chronological evidence log,
   not automatically current truth. It is presently about 9,384 lines. Search
   it selectively for the incidents and claims below; do not read it as one
   undifferentiated narrative.
5. Inspect the current worktree and source as authority. HEAD was
   `2b7fc3d1ee9b733d17142e296823e3d3d51a1cf5` when this brief was written, with
   extensive modified and untracked companion work above it. Re-check rather
   than assuming that value is still current.

Lodestar may not be installed in your environment. Do **not** install it or
block on it. If it exists, the startup call is:

Windows shell:

```bash
lodestar start --cwd "C:/Users/zerop/Development/minecraft-companion-brain-v2"
```

WSL shell:

```bash
lodestar start --cwd "/mnt/c/Users/zerop/Development/minecraft-companion-brain-v2"
```

If it does not exist, use this supplied projection as the relevant startup
context:

- Preserve user intent, dirty/staged/untracked/concurrent work, and the
  smallest sufficient implementation.
- Never infer missing authority; never weaken safety or quality gates to make
  work pass; never commit or publish without explicit authorization.
- Tests are evidence, not the product. Physical Minecraft behavior is the
  acceptance edge.
- Package-first mechanics: the project owns judgment, authority, cancellation,
  evidence, recovery, and reporting; Mineflayer and mature plugins own physical
  locomotion, path execution, combat, tool use, collection, eating, inventory,
  crafting, smelting, and related mechanics.
- Durable decisions currently include:
  - broad strategy: fixture admission -> functional affordance -> shared
    fallback -> complete intent -> component stewardship -> obligation liveness;
  - confusion fallback: safe settle -> reconcile first failed/unknown boundary
    -> retry only after material change -> supported authorized alternative ->
    promise-preserving decomposition -> one bounded player question -> truthful
    failure/Hold;
  - companion directive persistence: dedicated versioned atomic store;
  - critical survival routing: stable shore plus complete dry path;
  - fixture admission: pure immutable pre-dispatch receipt;
  - relevant dirty companion WIP is presumptively owned and must be preserved;
  - substantial evidence-backed technical-debt repair is authorized.

## Product reality to explain

The bot can join, converse, and often execute isolated deterministic skills.
Paper 1.21.11, Java connectivity, Geyser/Floodgate cross-play, the control
center, and many Mineflayer-backed mechanics have worked in real sessions.
Nevertheless, ordinary family play remains unreliable.

Recent player-visible evidence includes:

1. **Pathfinding and status:** Kevin has reported a complete native route was
   unavailable and made no movement for apparently ordinary approaches,
   sometimes queued a retry without making the situation understandable, and
   later reached the same player in a different run.
2. **Mining:** during a natural logging request the player saw Kevin click and
   hold, stop, and fail to mine/collect properly. Current dirty code contains a
   CollectBlock drop-retention and tree/scaffold settlement repair, with focused
   checks, but the natural `Kevin, get four logs` replay has not physically
   accepted it.
3. **Follow/guard:** player ownership, follow, and guard behavior have been
   visibly janky across interruption. Current dirty code adds durable exact
   directive persistence, but the complete live replay is pending.
4. **Combat/self-preservation:** at about 00:05 CDT on 2026-08-15, Kevin was at
   critical health on dry grass, moved into water during self-preservation,
   later reached dry shore, then created five distinct `mode:self_defense`
   actions in roughly 7.8 seconds. Every action returned
   `skill_unreachable` for a `critical_health` Phantom retreat with no spacing
   progress; Paper then recorded `Kevin was slain by Phantom`. Current dirty
   code adds a failure-stage/airborne-class feasibility latch and focused
   helper plus scheduler tests, but no live acceptance followed.
5. **Lifecycle:** Kevin was left active while no human player was online and
   eventually died; death recovery is pending. Earlier governance says a held,
   unattended bot should unload safely. Determine whether the runtime behavior,
   persisted directive authority, Hold semantics, or startup lifecycle now
   contradicts that intended contract.
6. **Intent compilation:** natural requests such as “collect wood and make
   charcoal” or “build your own bed” have sometimes been rejected before
   gameplay with “complete typed effect list could not be proved,” even though
   their component mechanics exist.
7. **Interaction judgment:** bed use versus spawn-setting and occupied-bed
   behavior produced repetitive or unhelpful responses rather than competent
   companion behavior.
8. **Development consistency:** different sessions and handoffs have produced
   materially different behavior. The worktree is extremely dirty, the bot
   process loads a source snapshot when it starts, persistent Agenda/directive/
   death/world state survives across sessions, and physical acceptances have
   often remained pending after code changes.

Treat these as observations to validate, not conclusions to echo. Distinguish
confirmed source/runtime facts from likely mechanisms and unknowns.

Useful live evidence includes:

- `bots/Kevin/telemetry/flight-2026-08-15T04-28-10-232Z-64654-001.jsonl`
- `.codeplan/session22-self-defense-retry-authority.md`
- `.codeplan/session52-critical-retreat-feasibility-latch.md`
- the latest relevant sections of `docs/coordination/CURRENT.md`
- managed Paper logs exposed by the existing control center, if already
  available read-only; do not start anything to obtain them.

## Surfaces to trace

Do not audit every file. Start with one broad player promise and follow only
proven causal edges through these likely owners:

- `src/agent/agent.js`
- `src/agent/action_manager.js`
- `src/agent/modes.js`
- `src/agent/library/skills.js`
- `src/agent/player-directives.js`
- `src/agent/runtime/behavior-arbiter.js`
- `src/agent/runtime/goal-director.js`
- `src/agent/runtime/agenda-director.js`
- `src/agent/runtime/job-director.js`
- `src/agent/runtime/survival-director.js`
- `src/agent/runtime/companion-context.js`
- `src/agent/runtime/companion-directive-state.js`
- `packages/minecraft-runtime/mineflayer-pathfinder/`
- `packages/minecraft-runtime/mineflayer-collectblock/`

The representative promise is:

> Kevin, follow Bubby. Get four logs and bring them back. If attacked, get safe
> and resume.

Trace selection, feasibility, planning, physical execution, reconciliation,
interruption, cancellation settlement, obligation persistence, resumption,
delivery, and player-facing reporting. Identify every component that can own,
replace, pause, cancel, retry, or declare completion for the same promise.

Ask specifically:

- Is there exactly one owner of the outstanding player promise and exactly one
  owner of the body at a time?
- Can any scheduler/director/mode erase or strand the promise while correctly
  obeying its own local contract?
- Can an action be cancelled while Mineflayer is still physically settling?
- Can multiple layers independently implement retry, fallback, recovery, or
  completion?
- Are wrappers interrupting mature mechanics more often than they protect
  them?
- Does success evidence flow back to the promise owner, or terminate inside a
  skill/reflex layer?
- Does resumption restore the exact deterministic continuation or create a new
  interpreted request?
- Are status messages tied to authoritative state, or can they describe queued
  work the scheduler cannot actually advance?

## Governance and development-control audit

Evaluate whether the development controls are helping agents converge or
causing context overload and ceremonial work.

In particular, inspect and report:

1. Whether `AGENTS.md`, the broad maturity plan, the shared contract spine, and
   `CURRENT.md` agree on current priority and ownership.
2. Whether the active plan is stale. At the time of this brief it still says
   M4 is the next active milestone, while `CURRENT.md` records later M4 work,
   survival changes, mining work, directive persistence, and the Phantom death.
3. Whether the 709-line contract spine and 9,384-line current log contain
   duplicate, obsolete, contradictory, or non-enforceable rules.
4. Whether agents can realistically load the required context without losing
   the actual player outcome.
5. Whether the campaign governor, specialist escalation rules, substantial
   tech-debt authorization, and “stop when gameplay works” rule create any
   push-pull that encourages either premature stopping or endless expansion.
6. Whether the dirty-work policy, lack of a physically accepted checkpoint,
   and no-commit-without-authority rule leave every session without a known-good
   baseline.
7. Whether startup/handoff instructions prove the running bot loaded the
   intended source and persistent state, rather than merely proving ports and
   process readiness.
8. Whether tests and receipts have become proxy deliverables that allow agents
   to say “fixed” before the real Paper replay.

Recommend one minimal canonical context hierarchy. Explicitly say which rules
or documents should remain governing, which should become reference-only,
which should be archived, and which should be deleted or consolidated. Do not
edit them in this pass.

## Required output

Return a decisive report with these sections:

### 1. Executive verdict

In at most 300 words: how close is the product to supervised play and to
trustworthy family play? What is the most important reason simple mechanics do
not compose? Is the dominant problem architecture, runtime state, development
process, stale governance, missing mechanics, or a combination? Do not use a
percentage unless you define an evidence-based denominator.

### 2. End-to-end ownership trace

Provide a compact table for the representative promise. Columns:

`stage | current owner | authority/evidence | who can interrupt or replace it | how continuation is preserved | confirmed gap`

### 3. Confirmed composition failures

List no more than ten. For each include:

- severity and player-visible consequence;
- exact source location(s) and live evidence;
- whether it is confirmed, likely, or still unknown;
- why local tests or local contracts did not prevent it;
- smallest coherent correction or consolidation boundary.

Do not promote a theoretical concern into required work.

### 4. Rules and governance verdict

For each governing artifact, mark `KEEP`, `CONDENSE`, `REFERENCE-ONLY`,
`ARCHIVE`, or `REMOVE`, with evidence. Identify the most dangerous
contradiction or stale instruction. Propose a minimum viable rule/context pack
that a fresh Claude/Codex session can actually follow.

### 5. Development-control verdict

Assess source/runtime identity, persistent-state reproducibility, dirty WIP,
handoffs, physical acceptance, checkpoint discipline, and test/live evidence.
Name the controls that are missing and the controls that merely add ceremony.

### 6. Strategy variants

Compare three materially different paths:

- stabilize the current ownership architecture;
- consolidate/remove overlapping control owners;
- reduce project wrappers and return more mechanics/lifecycle to mature
  Mineflayer packages.

You may replace a variant if evidence supports a better one. Apply hard gates:
preserve exact player authority, safety, cancellation settlement, truthful
evidence, package ownership, and existing physically accepted behavior. Choose
one path or a bounded sequence of paths. Do not recommend a rewrite without
proving the current architecture cannot be reduced safely.

### 7. Playable-baseline recovery program

Give a short ordered set of coherent tranches, not a calendar estimate. For
each state:

- player-visible outcome;
- owning surfaces;
- what must be frozen or removed;
- authoritative acceptance evidence;
- material stop condition;
- what evidence would disprove the proposed mechanism.

The program must return to real Paper quickly and must culminate in the
representative follow → logs → interruption → resume → delivery scenario. It
must not create a scenario matrix, broad test initiative, or new mechanics
engine.

### 8. Immediate next move

Give exactly one next action for the primary developer/agent, including what
not to touch. This should be the highest-leverage move toward a known-good,
physically accepted baseline.

### 9. Questions for the Director

Ask only questions whose answers materially change the strategy. Keep them
bounded and explain the consequence of each choice.

## Quality bar

- Cite paths and line numbers for code/rule claims.
- Cite telemetry record/sequence or Paper timestamp for runtime claims.
- Separate fact, inference, and recommendation.
- Counter-test your preferred strategy against at least one plausible failure
  mode and one simpler baseline.
- Favor deletion and singular ownership over another coordination layer when
  they satisfy the same invariants.
- Do not return generic advice such as “add more integration tests,” “improve
  observability,” or “refactor incrementally” without identifying the exact
  owner, seam, evidence, and acceptance edge.
- End with a blunt sentence completing: **“The project will become playable
  when we stop ___ and start ___.”**
