# Campaign record: archaeology and non-regression contract

**Author: Gabriel (the Director), 2026-08-18.** Evidence-based archaeology over
the project's own artifacts, transcribed here because it existed nowhere in the
repo. `ARCHITECTURE.md` governs. This document preserves physical evidence and
defines non-regression outcomes; it is not an implementation plan or work order.
Current diagnosis and migration status live only in `ARCHITECTURE.md`.

The correction that matters most: **there was never one continuously flawless
long-haul build.** There were many genuinely good campaigns, each often followed
by a different failure at the next seam. That pattern is itself the diagnosis.

## Classification as of the 2026-08-18 archaeology

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
| Outcome-directed confidence coverage across new and old mechanics | `ACTIVE` | Saved evidence remains valid. The Director authorized controlled runs under the architecture's evidence-saturation rubric; each run must be capable of changing the mechanic owner, repair, composition verdict, or significant risk. |
| Recorded live player-return route convergence | `ACCEPTED / CLOSED` | `validation-output/player-route-obstruction-2026-08-22T18-43-22-588/player-route-obstruction.result.v1.json` passed both transports with complete evidence: Kevin used real Pathfinder, broke through the two-block dirt plug, crossed the wall, refined to 3.000 blocks from the stationary player, ended `skill_arrived`, settled under Hold, and fully restored the fixture/runtime. `validation-output/player-route-best-reachable-2026-08-22T19-17-21-939/player-route-best-reachable.result.v1.json` passed both transports against a sealed bedrock shell: Kevin advanced to 6.179/6.185 blocks, truthfully ended retryable `skill_closest_explored` without false arrival, preserved the shell and terrain, settled under Hold, and fully restored the fixture/runtime. Both aggregates have zero retries and safety violations. The owner repair removes atomic whole-route gating from ordinary player travel, preserves native movement choices, refines continuous body distance, and retains strictly improved native best-frontier progress when exact arrival is impossible. Focused runtime checks pass `30/30`; Scenario Lab control-plane checks pass `38/38`. |
| Pathfinder expensive finite-break routing | `ACCEPTED / CLOSED` | `validation-output/pathfinding-finite-break-cost-2026-08-25T18-28-23-798/pathfinding-finite-break-cost.result.v1.json`: both transports passed in 60.317 seconds with complete evidence. Empty-handed Kevin preserved the valid hand-mining edge above the former `100` sentinel, broke the two-log plug, crossed the wall, reached the stationary player, settled under Hold, and fully restored the fixture/runtime with zero retries, timeouts, deaths, blockers, missing evidence, unsafe state, or safety violations. |
| Phase 4 `reachInteractionStance` inconclusive-probe consumer truth | `ACCEPTED / CLOSED` | `artifacts/interaction-stance-inconclusive-20260820-r4/live-report.json`: the real producer timed out inconclusively, the shared helper permitted real Pathfinder to traverse 70.19 blocks to the original legal stance, the body settled, no later interaction occurred, inventory and terrain remained intact, and the fixture, configuration, memory, and managed Java runtime were fully restored. Focused conclusive-`noPath` and inconclusive-execution checks pass `7/7`; no provider or accepted campaign ran. |
| In-flight Mission replacement and graceful Activity handoff | `ACCEPTED / CLOSED` | Deterministic failing-before reproduction installed Mission 2 while Mission 1's Activity remained `RUNNING`, then discarded its settlement without one stop call. The controller now validates first, awaits existing ActionManager stop plus correlated Activity settlement, and only then installs the replacement; invalid input and failed halt leave the old Mission current. Focused Mission checks pass `7/7`; adjacent ActionManager lifecycle/correlation checks pass `14/14`. No provider, world, or accepted exact-charcoal campaign ran. |
| Phase 5 `1-give`, trial 1, recorded trace, telemetry off, advisory preflight | `ACCEPTED / CLOSED` | `validation-output/phase5-variance-20260821-v3`: one isolated real-Minecraft cell passed. Kevin began with eight oak logs and physically delivered exactly four to `FollowTarget`; the provider received one request; runtime and provider input/output fingerprints matched; the action settled as `skill_delivered`; the fixture and runtime were restored; Kevin ended held; the test player disconnected; no managed Java or recorded-provider process remained. This closes only this exact cell, not the frozen-model arm or the matrix. |
| Complete Phase 5 variance matrix | `PENDING` | The authorized isolated run at source snapshot `00aa2bb` preserved four local recorded-trace reports, then stopped on the first frozen-model cell when the incorrectly selected `openai-api` route returned `credit_balance_exhausted`. No retry, fallback, or route switch occurred; cleanup completed. The owning Kevin and fixture configurations now select `codex/gpt-5.6-luna` through ChatGPT OAuth for every model role. Because provider route is matrix provenance, the old reports remain evidence but do not count as completed cells in the corrected Luna matrix. The corrected matrix is `0/112` and has no variance verdict. The Director explicitly authorized its physical execution on 2026-08-21 without another authorization ceremony; it has not started. |
| Phase 6 controlled swim-exit | `ACCEPTED / CLOSED` | `validation-output/terrain-swim-exit-2026-08-21T22-57-42-927/terrain-swim-exit.result.v1.json`: after repairing hollow fixture subgrade and moving the controlled observer off the destination, both isolated explicit-command transports physically climbed from water to the dry bank through real Pathfinder under `full` traversal and ended correlated `skill_arrived`. Evidence is complete; terrain and empty scaffold inventory remained unchanged; Hold and cleanup passed; retries, blockers, missing evidence/fields, timeouts, deaths, conflicts, unsafe state, and safety violations are all zero. |
| Phase 6 composed terrain workarounds | `ACCEPTED / CLOSED` | `validation-output/terrain-workaround-chain-2026-08-25-direct-r17/follow-field-evidence.json`: one uninterrupted explicit `!goToCoordinates` action ended correlated `skill_arrived` in 17.982 seconds after real Pathfinder cleared the two-cell wall, parkoured, placed a two-block horizontal bridge, built a two-block 1x1 tower, mined all nine stair-tunnel clearance stones across three rises, executed the controlled descent, ascended the contained four-block water column, and settled dry at `(1052.5,107,1008.5)`. Four consumed dirt equals the four named placed blocks; the pickaxe remained present; water and bank remained intact. The saved report's aggregate false bit is an evidence-check defect: it retained the old `x=1049` swim bound after the shaft moved to `x=1050`. The repaired constant-derived predicate evaluates all eight saved 100 ms trajectory checkpoints in order; no duplicate gameplay run was performed. |
| Dynamic escape selection and Mission resumption | `ACCEPTED / CLOSED` | The saved controlled direct and natural-language results still close the generated after-ownership composition sub-boundary. The terminal non-course run then began from a natural cave/trial-chamber region at y=17 under a requester at y=91: one DeepSeek-interpreted cobblestone Mission survived hostile preemptions, restored a changed mining-route support, excavated successive supported surface-corridor legs, retained native closest-explored progress, reached the player, and physically transferred the item. Paper confirmed DirectorTest held exactly one cobblestone. That live chain exposed an exact collect/reclaim receipt race and a cardinal-only canopy stance selector. Their owners were repaired without replaying the journey; one current-source granite delivery then used a supported mixed-offset leaf stance 2.2 blocks from DirectorTest, completed one `givePlayer` subgoal as `skill_delivered`, closed `delivery_verified`, and changed exact inventory Kevin 42 -> 41 / DirectorTest 0 -> 1 with no blind retry. Paper, the saved world, and both controlled clients remained running. This closes Phase 6B; the later automatic emergency-shelter attempt is separate Phase 7 Placement evidence. |
| Autonomous village expedition and player guidance | `ACCEPTED / CLOSED` | On 2026-08-25 Kevin fulfilled “Find a village, remember it, come back to me, then take me there.” The Scout job verified and persisted a taiga village bell at `(781,66,-775)`, returned to the requester, and resumed the saved finding rather than searching again. The final roughly 590-block guide leg physically moved both bodies from near `(292.5,62,-429.3)` through forest, slopes, repeated step-ups, deep water, shoreline recovery, catch-up waits, and chained recoveries. It ended beside the bell with the controlled player at `(774.1,65,-771.5)`, Kevin at `(780.5,64.94,-773.5)`, and 6.74-block separation. `bots/Kevin/agenda.json` records `complete` / `scout_route_complete`; runtime memory retains `nearby_village`. |
| Phase 7 Container specialist and village supply cache | `ACTIVE` | On 2026-08-25 Kevin used the new Container Activity owner to deposit exactly six oak logs in the village chest at `(796,67,-774)` and return with six. On the recovery leg, an exact withdrawal first reported `skill_chest_unreachable`; Kevin navigated to a usable stance, withdrew exactly two from the same bound chest, and returned. Paper then reported four logs in the chest, eight on Kevin, zero on `DirectorTest`, and Kevin at `(779.5,64.94,-773.5)` beside the requester. The location is durably saved as `village_supply_cache`. Container transfer, navigation composition, partial-effect custody, and settlement passed; interruption during an open window was not exercised, so the specialist remains `ACTIVE`. |
| Phase 7 Placement specialist and compounded survival shelter | `ACCEPTED / CLOSED` | On 2026-08-26 the continuously running saved world exposed a real compound shelter chain. A survival order partially built a spruce 3x3 shell through Zombie, Phantom, Spider, Creeper, and death-related displacement, preserved its checkpoint, and later exposed stale surface access, false completion after occupancy removed a roof cell, and retry material drift from spruce to dirt. The owner repairs added Placement Activity lifecycle/settlement, local worksite-access reconciliation, explicit terminal-job revalidation, post-occupancy blueprint re-audit, and dominant existing-material binding for automatic and explicit 3x3 shelter resumes. Kevin then crossed roughly 56 blocks back through a persistent follow that automatically reissued after multiple self-preservation interruptions, returned to the exact worksite, and resumed Builder rather than starting over. The final explicit order `builder-7119832e-643c-4b03-9c01-8907ff4226ea` repaired only changed spruce cells and ended `blueprint_complete`, checkpoint `23/23`. After Kevin entered, the same order re-audited and again completed `23/23`. Paper directly confirmed all 23 expected spruce cells, both door air cells, both interior air cells, and Kevin inside/on-ground at `(215.5,84,-382.5)`. Kevin ended health 18, hunger 16, idle, unheld, and pathless; Java PID 30156, the saved world, DirectorTest, and EscapeScout remained continuously up. No provider call was used for this Placement chain. |

| Phase 7 functional-base commissioning | `ACCEPTED / CLOSED` | On 2026-08-26 Builder order `builder-e4fc91b9-ce7b-4801-b76d-fa5c34566352` completed a 5x5 cobblestone functional shelter at `(765,65,-767)` through hostile/death recovery, underground collection and return, site clearing, interaction-stance repair, and a failed remote-coal path. Rather than repeating coal, Kevin used the shelter's exact furnace `(768,66,-764)` and carried spruce to make charcoal, crafted sticks and torches, placed the required light `(766,66,-765)`, and closed `blueprint_complete` at `85/85`. He then used the exact installed chest `(768,66,-766)` to store 137 surplus materials in one verified retained-inventory transaction: dirt 69, granite 26, diorite 10, clay balls 32. Paper confirmed the resulting five chest stacks, installed chest/furnace/table/torch/door, cleared interior, opposite roof corners, and restored Easy difficulty. Paper, the saved world, and Kevin stayed up; the terminal composed chain used no provider request. This closes the operational base outcome, not Craft/Furnace cancellation or Container open-window interruption. |
| Phase 7 operational workshop expedition and composition strengthening | `ACTIVE — PARTIAL` | Saved current state on 2026-08-26 supersedes the earlier active-Explorer cursor. Resource-project entry `agenda-1787773879851-9` and Explorer order `miner-03572e5a-cf90-48e7-a192-98c08b464b9c` completed; the iron-pickaxe goal completed; the shield goal completed; the bucket goal failed `inventory_capacity_blocked`; the three dependent deposits and final requester return were then cancelled by the player as `agenda_cleared`. These are preserved verified partial effects, not a completed workshop outcome. `CS-1` through `CS-5` now have forward source implementations with syntax/module checks only; they do not retroactively accept the project. Do not replay coal, cave travel, pickaxe, or shield as standalone proof. |
| Phase 7B compound livestock project | `ACTIVE` | The newest physical request was: build a safe animal pen near the functional base, scout and remember at least two cows, return and guide the requester to them, prepare wheat, bring two cows into the pen, breed a pair, close the gate, and return. Saved history `8-26-2026_6-36-53PM.jsonl` shows the language path repeatedly fell through to improvised or malformed commands, including zero-argument `!settleLivestockAtPen`, unknown `pen`, invalid fence primary material, and clarification churn, before a valid `animal_pen` Builder order began. Saved `job-state.json`/`home-state.json` then show exact order `builder-0545847a-84e8-497f-89f6-49c43c08f8d0` failed at checkpoint 37/49 while placing the fence cell at absolute `(734,69,-790)`, with only generic `skill_unreachable` retained by that runtime. This is classified incomplete physical evidence. Current source now adds deterministic livestock ownership, compatible partial-pen resumption, requested-animal/minimum-population scout binding, exact deferred pen/source persistence, and exact placement-failure containment; those repairs have static syntax/module evidence only and are not accepted until the compound player outcome runs after explicit runtime resumption. |

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
