# Campaign record: what has physically worked

**Author: Gabriel (the Director), 2026-08-18.** Evidence-based archaeology over
the project's own artifacts, transcribed here because it existed nowhere in the
repo. Read alongside `ENGINE-DOSSIER.md`, which diagnoses the current failures —
this document is the counterweight: the behaviours that provably worked.

The correction that matters most: **there was never one continuously flawless
long-haul build.** There were many genuinely good campaigns, each often followed
by a different failure at the next seam. That pattern is itself the diagnosis.

## Classification

- 28 strong or complete campaign outcomes
- 35 partial campaigns with a physically verified useful success before another
  seam failed
- 5 controlled repeatability sets

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
- **Campaign 59** — see above; the real preemption acceptance.
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

## What the author concluded

> The historical problem is not that none of this ever worked. It is that each
> successful behaviour was frozen in prose and narrow receipts, while later
> changes did not continuously replay the broad player-valued chains. That
> allowed individually "accepted" mechanics to stop composing.

Recovery is therefore not a rollback:

1. Treat `12bdc210` as the broad behaviour corpus.
2. Treat `b47117b` as the exact repeatability standard.
3. Promote the strongest campaigns — **28, 29, 59, 65, M2, M3, 68, 69, 70, 76** —
   into current-HEAD scenario outcomes.
4. Compare HEAD against those player-visible deeds, without restoring the old
   director/receipt architecture merely because it happened to contain them.

**Status of (3):** campaigns 28, 29/70, 68 and M2 are promoted into
`tools/probe-request-completion.mjs` and run at HEAD. Campaigns 59, 65, 69, M3
and 76 are not yet promoted; 59 and M3 need a second player and a scripted
hostile.
