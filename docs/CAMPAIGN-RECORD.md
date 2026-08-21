# Campaign record: archaeology and non-regression contract

**Author: Gabriel (the Director), 2026-08-18.** Evidence-based archaeology over
the project's own artifacts, transcribed here because it existed nowhere in the
repo. `ARCHITECTURE.md` governs. This document preserves physical evidence and
defines non-regression outcomes; it is not an implementation plan or work order.
Current diagnosis and migration status live only in `ARCHITECTURE.md`.

The correction that matters most: **there was never one continuously flawless
long-haul build.** There were many genuinely good campaigns, each often followed
by a different failure at the next seam. That pattern is itself the diagnosis.

## Classification

- 29 strong or complete campaign outcomes
- 35 partial campaigns with a physically verified useful success before another
  seam failed
- 6 controlled repeatability sets

These labels describe overlapping evidence views, not 68 disjoint campaigns. A
repeatability set groups repeated executions of behavior that may also appear in
the strong set. A campaign classified strong for one accepted chain can also have
later partial or failed seams; tables below name the preserved outcome precisely.

## Current accepted-boundary ledger

This ledger prevents accepted evidence from silently becoming runnable work again.
Only `PENDING`, `ACTIVE`, `ACCEPTED / CLOSED`, and `DEAD` are valid test states.

| Boundary | State | Preserved evidence |
|---|---|---|
| Phases 1–2 lifecycle, halt acknowledgement, physical settlement, Pathfinder and CollectBlock transfer | `ACCEPTED / CLOSED` | Focused lifecycle checks and the accepted physical interruption-and-transfer run. |
| Typed item acquisition and delivery | `ACCEPTED / CLOSED` | Passing direct and natural-language aggregate with physical transfer. |
| Doorway/corridor follow | `ACCEPTED / CLOSED` | 10/10 controlled set plus later complete Scenario Lab aggregates. |
| Obstruction follow through breakable terrain | `ACCEPTED / CLOSED` | 18 consecutive passing scenario results, each with both request forms. |
| Phase 3 exact eight-charcoal Mission | `ACCEPTED / CLOSED` | `validation-output/orchestration-charcoal-2026-08-19T08-49-44-151/orchestration-charcoal.result.v1.json`: two of two forms completed, complete evidence, zero retries, blockers, missing evidence, missing fields, timeouts, deaths, conflicts, unsafe state, or safety violations. |
| Phase 4 `probeSafeNavigationGoal` -> `goToGoal` inconclusive-route truth contract | `ACCEPTED / CLOSED` | `validation-output/route-probe-inconclusive-2026-08-20T20-59-54-989/route-probe-inconclusive.result.v1.json`: two of two explicit-command transports completed with `timeout`, `conclusive: false`, retryable `skill_route_unproven`, zero movement, intact terrain, complete evidence, Hold, full restoration, and no remaining managed Java or safety violation. |
| Phase 4 `probeSafeNavigationStances` result-shape truth contract | `ACCEPTED / CLOSED` | Static contract only: an isolated failing-before timeout probe returned no `conclusive` field; after the one-field owner repair, the direct timeout/`noPath`/success contract test and the full `critical-runtime-output` file (`24/24`) pass. No physical gameplay or consumer acceptance is claimed. |
| Any confidence rerun of an accepted boundary | `DEAD` | Saved evidence must be used unless the Director explicitly authorizes the exact disclosed rerun after materially contradictory evidence. |
| Phase 4 `reachInteractionStance` inconclusive-probe consumer truth | `ACCEPTED / CLOSED` | `artifacts/interaction-stance-inconclusive-20260820-r4/live-report.json`: the real producer timed out inconclusively, the shared helper permitted real Pathfinder to traverse 70.19 blocks to the original legal stance, the body settled, no later interaction occurred, inventory and terrain remained intact, and the fixture, configuration, memory, and managed Java runtime were fully restored. Focused conclusive-`noPath` and inconclusive-execution checks pass `7/7`; no provider or accepted campaign ran. |
| In-flight Mission replacement and graceful Activity handoff | `ACCEPTED / CLOSED` | Deterministic failing-before reproduction installed Mission 2 while Mission 1's Activity remained `RUNNING`, then discarded its settlement without one stop call. The controller now validates first, awaits existing ActionManager stop plus correlated Activity settlement, and only then installs the replacement; invalid input and failed halt leave the old Mission current. Focused Mission checks pass `7/7`; adjacent ActionManager lifecycle/correlation checks pass `14/14`. No provider, world, or accepted exact-charcoal campaign ran. |
| Phase 5 `1-give`, trial 1, recorded trace, telemetry off, advisory preflight | `ACCEPTED / CLOSED` | `validation-output/phase5-variance-20260821-v3`: one isolated real-Minecraft cell passed. Kevin began with eight oak logs and physically delivered exactly four to `FollowTarget`; the provider received one request; runtime and provider input/output fingerprints matched; the action settled as `skill_delivered`; the fixture and runtime were restored; Kevin ended held; the test player disconnected; no managed Java or recorded-provider process remained. This closes only this exact cell, not the frozen-model arm or the matrix. |
| Remaining Phase 5 variance cells | `PENDING` | The saved partial acquisition state contains 1 of 112 valid cells and no matrix verdict. Each additional cell remains a separate execution boundary; accepted-overlap runs require exact per-run disclosure and authorization. |

`tools/scenario-lab/scenarios.v1.json` is a definition and availability catalog,
not an execution ledger. A static `not-run` value there cannot reopen a boundary
marked `ACCEPTED / CLOSED` here.

## Commit anchors

| Commit | What it represents | Evidence quality |
|---|---|---|
| `344d0e28ce392af9e379ef9aee727eda20c995d8` | Aug 1 live follow and player-delivery repairs; repeated typed and natural-language field artifacts | Exact commit, live evidence preserved |
| `b47117b373a36d894e8ca9df740ae2ced0493913` | Best clean repeatability anchor: 10/10 doorway/corridor follow, five direct and five natural-language, zero retries, deaths, unsafe results, conflicts or timeouts, median ~19.7s | Exact candidate commit, immutable result |
| `12bdc21081a3e883b945d6eb001a543ba61e7902` | Aug 15 "gameplay maturity" checkpoint containing the Dad/Kid family campaign implementation | Broadest functional snapshot |

**Caveat that constrains any recovery plan:** most Aug 11–14 family campaigns ran
from a dirty tree. No exact commit exists between Aug 11 and the Aug 15
checkpoint, so `12bdc21` is the closest preserved snapshot containing the
mechanics but may include changes made after any particular live run. **There is
no golden state to roll back to.** The path is replay-and-repair at HEAD.

One caveat on `b47117b`: an instrumentation/correlation assertion was later found
weaker than believed. The physical movement, doorway crossing, corridor progress,
waypoint arrival and stable stop were real.

## Controlled, repeatable successes

1. **Aug 1 follow and delivery field runs** (`344d0e2`) — repeated typed follow,
   natural-language follow, stopping, typed delivery, natural-language delivery.
2. **Doorway/corridor follow** (`b47117b`) — 10/10, detailed above.
3. **Obstruction follow** (candidate `12bdc210`) — **18 consecutive passing
   scenario results**, Aug 16 19:08 → Aug 17 08:36, each containing both direct
   and natural-language invocations. Strongest repeated evidence that the bot
   could follow through terrain requiring breaking.
4. **Doorway follow under the later Scenario Lab** — three consecutive passes.
5. **Typed item acquisition and delivery** — one aggregate run passing both
   forms, item physically transferred, both invocations in ~54s total.
6. **Phase 3 exact eight-charcoal Mission** — the final direct and natural-language
   aggregate completed both request forms, delivered exactly eight charcoal to the
   physical requester, captured complete lifecycle/correlation/delivery/cleanup
   evidence, and reported no safety violation.
7. **Phase 4 inconclusive whole-route truth** — both explicit-command transports
   forced the strict route probe to exhaust its clock. Kevin returned retryable
   `route_unproven`, never reported `path_not_found`, travelled 0 blocks, left the
   protected course byte-equivalent, settled under Hold, and cleaned up fully.

## Strong or complete family-campaign successes

Chains that physically worked end to end:

```
craft → equip → return → hold
mine exact quantity → return → hold
craft several distinct kit items → verify custody → hold
follow moving Kid → accept Dad's replacement authority → hold
start Dad return → combat interruption → retreat → resume same return → arrive
craft at exact table → deliver exact output → return → hold
ask one clarification → bind answer → deliver → hold
```

Selected campaigns, by what physically succeeded:

| Campaign | Physically successful behaviour |
|---|---|
| 4 | Open-terrain follow converged 43.37 → 2.7 blocks, no digging, scaffolding, terrain damage, oscillation or absurd detour; Stop/Hold worked |
| 6 | Dad changed the plan; Kevin stopped, reported exact position and bodily state, stayed put 23s, answered Kid conversationally, did not turn concern into unauthorized work |
| 13 | Collected a complete six-log spruce tree, returned, delivered exactly six logs, reconciled inventory |
| 14 | Surface-safe Creeper retreat 6 → 10 blocks at full health; nine-cell construction; return; terminal Hold |
| 16 | While held, admitted self-defense only after taking real damage, killed a Zombie, collected drops, returned to Hold |
| 19 | Built two seats on opposite sides of the remembered picnic pad, facing inward, returned, reapplied Hold |
| 24 | Entire quiet-family-company outcome passed unrepaired: conversational turn, exact inventory report, follow takeover, Stop, Hold, bounded drift, cancellation of stale work, clean unload |
| 27 | Natural workbench handoff and guard: delivered exactly two of five spruce logs, retained the rest, equipped sword, guarded, stopped, held, unloaded |
| 28 | Natural tool preparation unrepaired: one log → planks → sticks → wooden pickaxe; used existing table, equipped, retained leftovers, returned, held |
| 29 | Spoken "four cobblestone": inventory 4 → 8, pick durability decreased appropriately, mining stayed outside the protected family area, returned, held |
| 31 | Natural indefinite wait became persistent Stop/Hold, zero drift, safe unload after 10.635s |
| 34 | Family rescue debrief: grounded explanation, exact status and inventory, open-water waiting, no invented recovery |
| 41 | Table placed 2.1 blocks from Dad and 1.2 from Kid, custody reconciled, legal stances existed, no collateral terrain change |
| 46 | Two complete boat exchanges: exact boat, safe approach, mount, stable posture, dismount, Hold, fixture cleanup |
| 48 | Exact iron helmet equipped in the head slot; Kid's appearance comment stayed conversation; truthful equipment answer |
| 50 | Family perimeter conversation: grounded threat warning, receipt-grounded safety answer, no physical work, no Hold release |
| 53 | Complete seven-log spruce tree in 34.7s, two scaffolds reclaimed, natural settlement verified, no residue |
| 59 | Dad return began, attributed Skeleton damage interrupted it, retreated 5.0 → 24.2 blocks, the same durable return stayed pending without spending an ordinary attempt, then resumed once and arrived |
| 63 | Long family-planning conversation under continuous Hold: every numbered segment arrived in order, no action started, body and custody unchanged |
| 64 | Explicit Stop durably cancelled stale work across restart; a fresh gaze request ran without resurrecting movement |
| 65 | Dad dropped one Bread to injured Kevin; picked up, consumed, hunger 15 → 20, health 7 → 8, terminal Hold |
| 68 | Full exploration kit: oak boat, stone sword, stone shovel from supplied ingredients using existing table; retained exactly those items |
| 69 | Followed the exact moving KidPlayer, within 4.821 blocks at all samples, finished 2.104 away, retained the kit, obeyed final Hold |
| 70 | Exact eight-cobblestone chain in two accepted flights: compact local mining, appropriate tool use, exactly eight new cobblestone, delivery, return, Hold. Each run removed exactly eight natural Stone and one Torch without damaging family structures |
| 76 | Full workshop transaction: supplied recipe → existing table → one Iron Pickaxe → exact Kid delivery → Dad return → terminal Hold |
| M2 | Kid's natural request bound the exact camp Crafting Table and recipe; crafted one Iron Axe, delivered to Dad, returned 2.697 blocks from Kid, retained no output, preserved terrain |
| M3 | Dad asked Kevin to give the sole Bread to "one of us" and wait. Asked exactly once, retained custody and Hold before the answer, accepted KidPlayer, delivered exactly one Bread, retained none |
| Phase 3 charcoal | A natural or direct request created one in-memory Mission, planned prerequisites incrementally, acquired wood/tool/stone/furnace/fuel, produced exactly eight charcoal, delivered it to the physical requester, and terminated with complete evidence and no unsettled lease |
| Phase 4 route truth | An inconclusive whole-route search remained explicitly unproven and retryable; it caused no locomotion or excavation, did not claim `path_not_found`, settled under Hold, and restored the isolated fixture and runtime completely |

## Partial campaigns worth preserving as regression scenarios

Not full passes, but containing mechanics that worked and should not be lost:
Sessions 1, 2, 3, 5, 7, 8, 9, 10, 11, 12, 15, 17, 18, 20, 22 and Campaigns 23,
25, 26, 30, 33, 37, 39, 40, 42, 43, 45, 47, 51, 52, 56, 57, 61, 62, 67, 73.
Representative examples:

- **Session 11** — one raw Porkchop acquired in 13.148s with no workstation or
  tools built, then consumed; a later no-source state produced zero movement and
  no retry loop.
- **Campaign 51** — from an empty, tool-less state, removed an entire eight-log
  spruce trunk, collected seven, reclaimed both scaffolds, left no residue,
  travelled at most 4.11 blocks. Then told Kid harvesting had not begun.
- **Campaign 67** — crafted exactly eight Torches in 50 ms, delivered four,
  retained four; the synchronous checklist failed to apply terminal Hold.

## Explicitly excluded

Campaigns 32, 35, 36, 38, 44, 49, 55, 58, 60, 71, 72, 74, 75 — no valid player
request, no physical product success, or focused/unit evidence only. Campaign 54
ran nothing new. Original Campaign 66 did not physically accept clarification
before closing; the same contract was later accepted as M3. The
`kevin-dad-son-longhaul-20260816-0444` observer run is diagnostic telemetry, not
a success baseline: 15 minutes, 65 action results, 37 alerts, ending in failed
dirt-delivery and lumberjack states.

## Dated recovery conclusion (archaeology, not a work order)

> The historical problem is not that none of this ever worked. It is that each
> successful behaviour was frozen in prose and narrow receipts, while later
> changes did not continuously replay the broad player-valued chains. That
> allowed individually "accepted" mechanics to stop composing.

The Director concluded on 2026-08-18 that recovery was not a rollback:

1. Treat `12bdc210` as the broad behaviour corpus.
2. Treat `b47117b` as the exact repeatability standard.
3. Promote the strongest campaigns into current-working-tree scenario outcomes.
4. Compare HEAD against those player-visible deeds, without restoring the old
   director/receipt architecture merely because it happened to contain them.

**Status recorded on 2026-08-18:** campaigns 28, 29/70, 68 and M2 had been
promoted into `tools/probe-request-completion.mjs` and run against that working
tree. Campaigns 59, 65, 69, M3 and 76 had not; 59 and M3 required a second player
and a scripted hostile/answer flow. This status is dated evidence, not current
authorization or a queue.

## Superseded engine hypotheses preserved

The engine reviews proposed several mechanisms before the canonical architecture
was reconciled. They remain useful archaeology so they are not rediscovered as
current instructions:

- An early diagnosis said project execution globally discarded Pathfinder
  `partial` results and proposed an outer partial-walk/replan loop. Current owned
  source disproves the broad premise: `goto()` keeps running and the fork installs
  partial paths while search continues. The remaining targets are specific
  preflight/probe consumers that turn partial or timeout into vetoes.
- An early proposal made one utility arbiter the sole request lifecycle owner,
  reduced all states to permissions/goal/acceptance, and treated
  `did / engine_cannot / we_will_not / unknown` as the internal result type. The
  canonical design instead uses hard priority bands, one in-memory Mission,
  incremental causal planning, ActivityExecutive body ownership, and orthogonal
  lifecycle/effect/reason/retry/evidence fields. The four phrases survive only as
  player-facing renderings.
- An early activity proposal assumed a thin adapter could halt and release a
  promise synchronously. Current `ActionManager` evidence shows cancellation can
  remain unsettled after its stop ceiling. The canonical lifecycle requires halt
  acknowledgement and physical settlement; timeout never releases ownership.
- Earlier text recommended flipping traversal to `full`. Shipping
  `profiles/local-quickstart.json` already requests `full`; `preserve` is only the
  absent-setting fallback in `agent.js`. Effective `Movements` still require
  per-specialist instrumentation.
- The original research passes were not independent: they read repository rules
  and earlier diagnosis before source. Their agreement is anchored convergence,
  not separate proof.
- The observed 3/7 → 5/7 → 5/7 with different members → 4/7 variance did not
  establish its cause. Lifecycle, model sampling, fixture cleanliness, timing,
  and preflight behavior remain separated only by the canonical variance matrix.

## Non-regression contract

`ARCHITECTURE.md` defines the implementation and migration gates. This record
defines what the replacement must continue to do. The entire broader record above
is in scope, with these campaigns explicitly mandatory: **28, 59, 64, 65, 68, 69,
70, 76, M2, M3, 13, 41, 46, 53, and Phase 3 charcoal**.

Equivalent player-visible outcomes must repeatedly pass before any corresponding
causal planner, director, lane, preflight, or legacy state is deleted:

| Contract family | Required preserved evidence |
|---|---|
| exact item work | 28, 68, 70, 76, M2, Phase 3 charcoal: recipes, exact quantity, causal prerequisites, correct existing workstation, tool/custody, delivery, return, Hold, leftovers and terrain |
| interruption and resumption | 59: attributed threat, safe retreat, same Mission replanned from current reality, arrival, no spent ordinary attempt or stale closure replay |
| authority and persistence | 64: Operator Stop/Hold across restart, stale work cancelled, fresh request does not resurrect movement |
| critical survival | 65: exact food pickup/use and verified hunger/health effect, then Hold |
| moving-player identity | 69: exact KidPlayer follow, bounded spacing, retained custody, final Hold |
| clarification | M3: sole item retained, one mission-bound question, answer bound to exact recipient, exact delivery, wait |
| terrain stewardship | 13 and 53: complete tree collection, exact custody/delivery where requested, scaffold cleanup, no residue |
| placement | 41: legal useful site, exact table custody, no collateral terrain mutation |
| vehicle | 46: exact vehicle, approach, mount, stable posture, dismount, cleanup and Hold |

For every replacement path, evidence must include the physical acceptance
predicate, partial effects, mission/activity/specialist correlation, effective
movement profile where relevant, cancel request/acknowledgement, settlement, world
revision, no unsettled lease, and an ordinary-player-sense verdict. A focused unit
test or one lucky pass is insufficient. Demotion is reversible; deletion waits for
repeated coverage before and after removal.

No historical success authorizes restoration of the old obligation ledger,
gameplay receipt bureaucracy, global partial loop, global traversal flip, or
duplicate voxel-topology planner. Preserve the deed, not necessarily the mechanism
that once produced it.
