# Supervised Landing-Area Companion Playtest

## Applicability

`APPLICABLE_WITH_LIMITS`. The unchanged outcome crosses intent binding, multi-item planning, prerequisite acquisition, player-site stewardship, movement, survival, return, cancellation, and verification. A short scaffold-fading ladder makes the first failure attributable without turning Minecraft into a unit-test framework. The final authority remains ordinary live play.

## Outcome and Graduation

```text
Mode: DESIGN, then live TRIAGE
Repository / system: minecraft-companion-brain-v2 + managed Paper 1.21.11
Target revision/state: recovery/iron-pickaxe-20260803 at the current pushed checkpoint
Workspace state: tracked-clean before this playtest tooling tranche; protected untracked artifacts remain untouched
Real outcome: the bot helps establish a player-started landing area by gathering a sensible bounded starter supply, preparing its needed tools, preserving the site, and returning truthfully
Exact unchanged graduation request: Help me establish this landing area. Don't damage what I've already built. Gather a sensible starter supply, make whatever basic tools you need, and return here when you're finished.
Authorized mutations: bounded natural resource collection, prerequisite crafting/smelting, inventory management, safe travel, combat/self-preservation, and player-authorized work outside the protected landing area
Forbidden mutations: damage to the player-started landing area, arbitrary construction, destructive navigation, hidden provisioning, stale-job revival, fabricated completion, or a second physical executor
Identity requirements: player phixxation, bot IronSuiteProof, one locked landing-area anchor, one correlated request, and the existing GoalDirector/Agenda/JobDirector/ActionManager ownership chain
Independent final oracle: live bot POV, compact dashboard state, Paper position/health/inventory queries, player inspection of the landing area, and exact Goal/Job terminal state
Natural starting condition: ordinary survival inventory and the player's real partially started landing area
Recovery expectation: Stop settles promptly; one later explicit continuation resumes only the active outcome; one controlled bot restart preserves verified progress without replay
Full-run cost: several minutes of real survival play with mutable terrain
Reset mechanism: use a low-value landing area for the first run; Stop on P0 risk; do not delete or restore the lived-in world automatically
```

## Capability Map

```text
C1 Player authority and exact intent [UNPROVEN]
  owner: player-speech-authority, player-directives, player-agenda, model fallback
  evidence: the exact phrase currently has no deterministic single-directive or Agenda binding

C2 Bounded starter-supply policy [UNPROVEN]
  depends on: C1
  owner: existing capability/planner binding seam
  evidence: item goals and stockpile jobs exist, but no generic starter-resource outcome currently chooses a balanced bounded manifest

C3 Prerequisite planning and deterministic manufacture [PROVEN]
  depends on: concrete requested outputs
  owner: GoalDirector, capability catalogue, prerequisite planner, deterministic skills
  evidence: iron, bucket, shield, clock, rails, tool set, glass, charcoal, and shelter campaigns

C4 Ordinary collection and tool preparation [PROVEN_WITH_LIMITS]
  depends on: concrete resource target
  owner: miner/lumberjack plans, CollectBlock, Pathfinder, skills
  evidence: whole-tree lumberjack and manufactured-output checkpoints; long collection remains the dominant live cost

C5 Player-started site identity and protection [CONTRADICTED]
  depends on: locked site anchor
  owner: gameplay safety and collection/build authorization
  evidence: utility blocks and processed materials receive type-based protection, but a manually started region is not a durable claim and natural-looking dirt/stone/logs have no player-placement provenance

C6 Named site memory, return, and player proximity [PROVEN_WITH_LIMITS]
  depends on: canonical player or explicit player-named place
  owner: PersonalMemory, MemoryBank, companion context, native Pathfinder, delivery/return skills
  evidence: live save -> bot restart -> list -> move 6.2 blocks -> “Go to landing” returned within 0.18 blocks; forget removed only the player name while internal death memory survived
  limit: named places do not yet grant a protected-region claim, cross dimensions, guide a following player, or substitute for fresh player-position tracking

C7 Survival preemption and deterministic resumption [PROVEN]
  owner: BehaviorArbiter, SurvivalDirector, ReactionDirector, ActionManager
  evidence: accepted hostile interruption and broad companion campaigns

C8 Stop/restart settlement [PROVEN_WITH_LIMITS]
  owner: ActionManager, GoalDirector, AgendaDirector, JobDirector
  evidence: accepted interruption, Agenda settlement, container quarantine, and restart campaigns; must transfer to this new broad outcome
```

Deepest unproven boundary: bind one bounded starter manifest to the existing proven item/capability engine without granting construction or site-demolition authority.

## Scaffold Inventory

| Scaffold | Capability temporarily removed | Why supplied | Removal rung |
|---|---|---|---|
| Exact starter manifest named by player | Manifest selection | Separates general planning/execution from “what counts as basic” policy | L2 |
| Low-value disposable landing area | Irreversible stewardship risk | Lets the live observer detect damage without risking an important build | L3 |
| No planned restart | Persistence transfer | Keeps ordinary success focused | L4 |
| Bot starts Stop-held | Stale autonomy and old work | Establishes an uncontaminated request boundary | Removed when L1 request is issued |

## Next Ladder Tranche

| Rung | Ready | Scaffold removed | Newly active capability | Request | Qualified oracle | Failure route |
|---|---|---|---|---|---|---|
| O0 Observer readiness | BLOCKED | none | Live visual/state observation | No gameplay request; bot remains Stop-held | Viewer renders current bot POV; watcher receives state; Paper confirms one bot and health | Dashboard currently reports viewer unavailable despite the requested setting; resolve configuration at this boundary only |
| L1 Explicit starter bundle | READY after O0 | Stop hold and pre-supplied manifest policy | Multi-output sequencing through existing engine | “From outside this landing area, gather 16 logs, 32 cobblestone, 16 torches, and 16 food. Make the basic stone tools you need and return here. Do not alter this landing area.” | Pre-inventory lacks requested delta; watcher sees correlated Goal/Agenda/Job actions; Paper verifies inventory/health/position; player inspects site | First failed owner only; Center Audit if causal edge is uncertain |
| L2 Natural starter policy | BLOCKED until L1 | Exact manifest wording | Generic bounded starter-resource binding | Exact unchanged graduation request | One durable correlated outcome; bounded concrete manifest visible before work; final resources/tools/site/return verified independently | Player intent or capability binding seam |
| L3 Stewardship transfer | BLOCKED until L2 | Disposable unimportant site | Real player-started landing area protection | Exact unchanged graduation request at a different valid player-started site | No unauthorized site changes; ordinary resource work succeeds outside the boundary | Gameplay safety/site authorization seam |
| L4 Stop/restart replay | BLOCKED until L3 | Clean uninterrupted process | Settlement and persistence transfer | Stop once during acquisition, restart bot once, then explicitly continue the same request | No overlap, no replay of verified work, same request/site identity, eventual truthful terminal result | Action/Goal/Agenda/Job settlement seam |

## Pre-Fix Candidates

```text
PF-1 Generic “basic resources” has no durable deterministic representation
  Status: NEEDS_CENTER_AUDIT before L2 implementation
  Evidence: resolvePlayerDirective and parsePlayerAgenda both return null for the exact phrase; model responses allow only one command
  Shared invariant: one broad player outcome must bind a bounded manifest and sequence existing capabilities without model physical control
  Existing ownership seam: player intent -> Agenda/GoalDirector capability binding
  Failing-before check: exact request has no correlated durable outcome
  Passing-after check: exact request produces one bounded manifest and durable request identity before physical execution
  Why graduation remains necessary: correct binding does not prove collection, stewardship, return, or survival behavior

PF-2 Manually started areas are not durable protected regions
  Status: NEEDS_CENTER_AUDIT only after a live L1/L2 site-risk observation
  Evidence: current protection is primarily block-type and blueprint-specific; no current durable manual player-site claim owns ordinary natural-looking blocks
  Shared invariant: collection and navigation may not treat a player-designated worksite as free terrain
  Existing ownership seam: gameplay safety and exact target authorization
  Failing-before check: watcher/player observes a bot-caused change inside the locked area
  Passing-after check: the unchanged request gathers outside while the site remains intact
  Why graduation remains necessary: preserving one site does not prove the full companion outcome
```

## Isolation and Oracles

- Keep the active V2 checkout and managed Paper world; do not touch the frozen control repository.
- Start with `IronSuiteProof` Stop-held, no active player goal/job/agenda, health 20, and the user standing at the landing-area center.
- Run `npm run playtest:watch -- --bot IronSuiteProof --player phixxation` before issuing the request.
- The watcher records to `/tmp/mindcraft-playtest-*/events.jsonl` and `summary.json`; it never sends a bot command.
- Open the viewer URL printed by the watcher. Codex watches that live POV while also reading action, Goal, Job, inventory, health, player-distance, and no-progress transitions.
- A harness failure is `BLOCKED`; ambiguous observation is `INCONCLUSIVE`; only a real gameplay failure is `FAIL`.
- Stop immediately for ignored Stop, unauthorized site damage, overlapping physical owners, uncontrolled construction, false success, or suicidal behavior.
- For ordinary failures, retain the unchanged request, stop at the first shared blocker, repair that seam, and rerun the same rung.

## Transfer and Graduation Gates

| After | Variation | Must transfer | Oracle |
|---|---|---|---|
| L1 | Change one common resource family or quantity | Generic sequencing and prerequisites, not a memorized recipe | Dashboard/Paper resource delta and terminal state |
| L3 | Different landing shape/material | Site identity protects coordinates, not a hard-coded material list | Player inspection plus live POV/Paper state |
| L4 | One Stop and one restart point | Correlated progress and ownership settle identically | Persisted Goal/Agenda/Job state and no duplicate effects |

Graduation uses the exact unchanged request from a natural survival state, without supplied inventory, fixed coordinates, canned routes, hidden commands, or a scenario-specific production branch.

## Failure Routing

| Failure | First owner | Next method | Stop condition |
|---|---|---|---|
| No durable request/manifest | player directive/Agenda/capability binding | Center Audit, then shared repair | Same exact phrase binds one bounded outcome |
| Damages landing area | gameplay safety/target authorization | Immediate Stop, preserve coordinates, Center Audit | Same request works without site mutation |
| Stalls or repeats failures | selected physical capability/recovery seam | Inspect first repeated signature; fix primitive or strategy binding | Physical progress or meaningful strategy change resumes promptly |
| Makes needless structures/tools | manifest/prerequisite planner | Compare requested outputs to bound plan | Remove unauthorized output without noun-specific rules |
| Cannot return/stay near player | companion context/Pathfinder | Inspect player identity, target freshness, and native route | Returns to exact player/site safely |
| Old work reappears | Goal/Agenda/Job lifecycle | Stop and inspect correlated IDs before more play | Only current request remains actionable |

## Recommended First Rung

Run O0 now, then L1 when phixxation joins. O0 proves that Codex can genuinely see the bot and receive live state without contaminating gameplay. L1 is the smallest broad run that removes only manifest ambiguity while keeping tool preparation, collection, return, survival, and stewardship real.

## Named-Place Memory Checkpoint

The basic player memory seam is complete and deliberately smaller than scouting. Natural player phrases can save an explicitly named current place, list player-named places, return to an exact known name, and forget it. Coordinates and canonical dimension persist atomically across bot restart; wrong-dimension navigation refuses before Pathfinder runs. Internal death and exploration markers are neither listed nor reachable through player-name commands. The live IronSuiteProof proof used `landing`, preserved operator Hold across save/list/forget, returned through native Pathfinder after restart, and ended Stop-held at health 20 with the test name removed.

Deferred until ordinary play demands it: asking for a missing nickname, aliases, arbitrary fact memory, protected-region ownership, scouting observations, escorting the player to a place, and portal-aware cross-dimension travel.

## Director Play Guide

1. Join the managed Paper world as `phixxation`.
2. Use a low-value partially started landing area for L1 and stand at its center.
3. Wait for Codex to confirm the watcher locked your position and the live camera is visible.
4. Send the L1 sentence exactly once in normal Minecraft chat. Do not repeat it while the bot is thinking.
5. Play normally nearby. Do not coach movement or hand it missing items unless Codex declares the rung blocked and asks for one explicit scaffold.
6. Say `Stop` immediately if Codex or you sees unauthorized site damage, uncontrolled building, repeated collision, drowning/suicidal behavior, or ignored authority.
7. Otherwise let the first material blocker occur. Codex will name it, preserve the request, repair the shared seam, and guide the rerun.

## Do Not Encode

- No fixed landing coordinates, campaign IDs, rung names, or known route.
- No hard-coded recipe sequence for the exact starter bundle.
- No silent creative provisioning or hidden server commands.
- No “protect all dirt/stone everywhere” shortcut.
- No second executor, custom navigator, dashboard project, evidence platform, or broad telemetry expansion.
- No automatic claim that a watcher warning is a gameplay failure; visual and Minecraft state govern.
