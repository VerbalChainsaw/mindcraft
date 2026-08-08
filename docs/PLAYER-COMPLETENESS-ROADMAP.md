# Player completeness and runtime performance

Status: commanded companion gameplay is operational and the two required
player-completeness groups are delivered. The bot can
navigate, follow/guard, collect, craft, smelt, prepare food, sleep, seek/build
emergency shelter, equip armor upgrades, use doors and items, trade, ride,
construct fixed verified shelters, build/use Nether portals, run a Nether
quartz round trip, fight tactically, explore landmarks, recover death items,
brew potions, establish and maintain a farm, breed animals, remember and
repair a home structure, and execute bounded general construction projects.
The advanced mechanics table below remains an explicit backlog rather than
an implied capability claim.

## Active V2 playable checkpoint — 2026-08-08

This file records delivered capability breadth; it does not override the live
execution order in `docs/coordination/CURRENT.md` or the active V2 plan. The
latest broad companion checkpoint completed an addressed shared-outpost
stocking request. One natural request became two durable typed Agenda steps:
prepare 24 additional safe food points at the exact selected furnace, then put
only that newly prepared output in the exact selected chest. The unchanged
Paper run produced and deposited two cooked porkchops plus two cooked mutton,
left every baseline food item with the bot, emptied the furnace, preserved the
house/workshop fixtures, and ended under Operator Stop.

The shared corrections are not recipe routes. Agenda now composes bounded food
preparation and family deposit with exact world bindings and restart-stable
baselines. Food preparation keeps one additional-output target across retries,
reuses the selected furnace, safely reclaims incompatible finished output, and
can truthfully continue with useful verified partial supply after its bounded
attempts. Family deposit transfers per-item deltas, so older carried food is
not mistaken for requested output. The command boundary also accepts its
documented inclusive 2,304-item maximum.

An exact loaded-world scan resolved the only preservation concern: the spruce
log harvested for fuel was the lower segment of a real canopied trunk outside
the west wall, not part of the complete spruce-plank house or roof. No
speculative claimed-world framework or replacement collection engine was
added.

The supervised-play entry gate is now passed. Gabriel can begin useful
playtesting without waiting for full release readiness. Prioritize observed
failures in this order: unintended/stale work, destructive world changes, resource no-progress
stalls, dishonest completion or restart replay, then missing gameplay domains.
Known dormant P1 debt remains in the master/forward plans and should activate
only when live play reaches it.

The next broad play request also proved function-constrained general building.
One addressed request for a fenced, gated, lit animal pen preserved its
containment, access, and lighting outcome, compiled through the existing
`@pen` template plus a standing torch, acquired its materials through the shared
prerequisite engine, and completed an exact 50-cell Paper build with zero
productive failures. The resulting spruce gate physically opened and closed;
the nearby chest, furnace, and crafting table remained present. This extends
the playable checkpoint to generic template composition, matched material
families, and probe/executor site-support parity. It does not claim general
structure ownership discovery or verify absent farm/path blocks.

Prior bot-owned failed pen probes remain in the long-lived world and must be
mapped to their exact work-order coordinates before any cleanup. The accepted
pen is order `builder-0a3fa68c-6837-479a-9904-5235af1030f4` at
`(8095,69,7937)`.

The program now moves from capability proof into player-led expansion. The
next product evidence is a normal mixed session with Gabriel in the lived-in
world, not another isolated recipe, quantity, fixture, or pen variation. The
first observed player-visible failure chooses the coding tranche. Prioritize
authority and stale work, world damage and infrastructure reuse, repeated
resource no-progress, dishonest continuation or replay, then a genuinely
missing gameplay domain. Keep passed mechanics frozen unless later play shows
a materially different regression.

## Delivered in this slice

### Behavioral controls

The Bot Library now exposes controls that map to active deterministic policy:

- autonomy and combat reflex;
- full/basic/off survival;
- normal and critical hunger thresholds;
- carried food reserve;
- safe sleep and shelter policy;
- automatic armor upgrades;
- optional useful-drop collection;
- resumable jobs and delivery;
- environmental reactions, speech budget, memory, and vision.

Both the local-quickstart generator and its shipped profile use balanced
autonomy, full survival, safe sleep, emergency shelter, armor upgrades,
useful-drop collection, natural reactions, and the ordinary
hunting/item/torch modes. Older saved profiles retain compatibility defaults.

### Brewing

`!brewPotion(target, count)` uses the ordinary ActionManager and a real
brewing-stand window. It supports one to three bottles and the vanilla base
effects:

- fire resistance, healing, leaping, night vision, poison, regeneration;
- slow falling, strength, swiftness, turtle master, water breathing, weakness;
- `long_`, `strong_`, `splash_`, and `lingering_` prefixes where that vanilla
  combination exists.

The skill verifies registered water bottles, exact ingredients, blaze-powder
fuel, an empty station, ingredient consumption, a changed potion component on
every bottle at every stage, the final item type, inventory return, and
temporary-stand recovery. It leaves an occupied station untouched.

Physical proof on Paper 1.21.11:

- MindcraftBot was placed in survival with one brewing stand, three water
  bottles, one nether wart, and two blaze powders.
- `!brewPotion("strength", 3)` placed the stand, completed both brewing stages,
  returned all three bottles, and recovered the stand.
- Paper awarded `Local Brewery`.
- Independent entity data showed exactly three inventory items with
  `minecraft:potion_contents={potion:"minecraft:strength"}` plus the recovered
  brewing stand.
- A separate natural-language request, `Brew one swiftness potion.`, mapped to
  exactly one `!brewPotion("swiftness", 1)` action, produced the potion,
  recovered the stand, and ended with a non-command success response. This
  run also exposed and fixed the conversation guard that had previously
  retried an already-completed one-shot action.

### Performance

The conversation prompt previously included 20,423 command-document
characters (about 5,106 tokens) on every ordinary turn. The compact typed
catalog retains every available command, parameter, and bounded description
at 12,392 characters (about 3,098 tokens): a 39.3% reduction before history,
awareness, or the player message.

Full survival also performed two loaded-world block scans on every 300 ms
behavior tick. Only the slow-changing bed/shelter/drop environment is now
cached for one second and invalidated by movement or dimension change. Health,
hunger, damage, armor, ownership, reflexes, and inventory remain fresh.

Run the repeatable benchmark:

```powershell
npm run perf:runtime
node tools/benchmark-runtime.mjs --assert --url=http://localhost:8080 --samples=20
```

The implementation run measured:

- command-prompt reduction: 39.3%;
- survival loaded-world scan reduction: 75% (240 to 60 scans over 120 ticks);
- synthetic survival hot-path total: 9.12 ms to 2.92 ms;
- live local telemetry HTTP p50: 1.80 ms over 20 samples with one live bot.

Wall-clock model response still depends primarily on the selected provider and
model. Use the benchmark to keep bot-side/control-plane regressions separate
from provider inference latency.

## Completed major gameplay groups

### 1. Renewable home and equipment lifecycle

Durable per-bot home state now owns a remembered position, one verified farm,
and the latest player-authorized structure blueprint. The deterministic action
surface includes:

- `!rememberHome()`;
- `!establishFarm(crop, width, depth)` for 1-16 hydrated plots;
- `!maintainFarm()` for mature harvest, pickup, replant, and exact audit;
- `!breedAnimals(animal, pairs)` for one to four adult pairs with verified
  offspring;
- `!repairHome()` to resubmit the remembered blueprint and replace only
  missing cells.

Tool preparation already retires tools below the safe remaining-durability
threshold. Armor upkeep now applies the same threshold, allowing a healthy
lower-tier replacement to supersede nearly broken high-tier armor. Anvil and
Mending repair are intentionally still listed as advanced mechanics because
they require separate level/material/enchantment contracts.

Physical proof on Paper 1.21.11:

- established and persisted nine hydrated wheat plots;
- matured, harvested, collected, and replanted all nine plots;
- fed two adult cows and verified one new baby entity;
- removed one cell from a remembered platform and restored it through
  `!repairHome()`, ending at a 4/4 exact blueprint audit.

### 2. General safe construction projects

`!assignConstructionJob(shape, width, depth, height, material)` compiles
operator-approved platforms, bridges, walls, columns, and rooms into the
existing persistent Builder work-order path. It reserves/acquires material,
orders supported cells causally, checkpoints every verified placement,
revalidates after restart, and completes only after an exact world audit.
Horizontal dimensions are bounded to 16. Vertical walls, columns, and rooms
are bounded to the physically reachable verified height of four; taller work
is deferred until scaffolding is a first-class verified mechanic.

Physical proof built and audited a 3x3 stone platform, resumed an active wall
order after a process restart with `restart_revalidation`, and built a second
2x2 platform with a final checkpoint of 4/4.

## Operational hardening gates

Restart continuity is green for typed goals in the state-store contract and
for live player work orders/home state. A confirmed loose handoff had skipped
all persisted work-order loading when autonomy was `command`; player and
survival orders now always restore through restart revalidation, while only
automatic role orders are suppressed. Corrupt state is surfaced without
overwriting the evidence.

Canonical full-state telemetry is now pushed from an agent only while a
dashboard listener exists. Meaningful movement/action changes are debounced
at 80 ms, server broadcast is immediate, and the old concurrent poller remains
as a stale/legacy fallback. No second or reduced-fidelity state schema exists.
The stream reports prompt-build/provider timing, physical action duration, and
push transport timing.

The live one-bot benchmark measured:

- telemetry HTTP p50: 1.31 ms;
- canonical state-push delivery p50: 2 ms;
- first/cold-sample-inclusive delivery p95: 124 ms;
- idle dashboards receive the configured three-second broadcast heartbeat,
  while moving bots publish meaningful changed state at the debounced rate.

One instrumented live conversation measured 167 ms of local prompt assembly,
6.65 s of provider inference, and 6.82 s total. This confirms that the
canonical communication path is no longer the dominant latency in that sample.

The stale pre-arbiter and disabled-quickstart expectations were updated to the
current contracts; the complete control-plane run is green at 213/213.

## Advanced mechanics backlog

Good next bounded additions:

| Mechanic | Size | Safe implementation boundary |
| --- | --- | --- |
| Contextual potion use | Small/medium, deferred | Needs effect-aware survival/combat intent and verified consumption rather than generic item use |
| Fishing | Medium, deferred | Needs a bounded cast/reel state machine, water proof, pickup, interruption, and rod-durability evidence |
| Enchanting | Medium, deferred | Needs exact table-window option, item/lapis/level preflight, and changed enchantment evidence |
| Anvil/Mending repair | Medium, deferred | Needs exact input/material/level contract and before/after durability, XP, and enchantment proof |
| Smithing/netherite | Medium, deferred | Needs version-aware template/window handling with exact consumed inputs and output |
| Villager economy | Medium/large | Persist profession/trade observations and restock state around the existing verified trade skill |
| End progression/dragon | Large | New cross-dimension progression contract, stronghold/portal proof, bounded combat, return/recovery |
| Elytra flight/fireworks | Large | Dedicated flight controller, collision model, landing proof, and durability policy |
| General redstone machines | Large | Explicit circuit schema and stateful verification; not generic block narration |

No current control should claim these mechanics exist before their physical
skill and verification boundary are implemented.

The deferred items are deliberately not folded into the general builder or
generic `useItem` paths: doing so would create narration without the workstation
or entity-state evidence needed for player-like fidelity.

## CodePlan record

Gameplay candidates were: direct verified brewing on the existing action
boundary (V1), a generic all-workstations planner (V2), or generated container
click code (V3). Frozen axes were architecture fit, physical correctness,
reversibility, verification, and delivery size. Scores: V1 0.91, V2 0.73,
V3 0.32. V1 won; V2 is deferred until at least enchanting and smithing justify
the abstraction, and V3 was rejected.

Performance candidates were: targeted prompt/state hot-path reduction with a
repeatable benchmark (P1), instrumentation without optimization (P2), or a new
external observability stack (P3). Scores: P1 0.93, P2 0.61, P3 0.48. P1 won
because both bottlenecks were directly measured and the changes preserve the
single cognitive loop.

```text
[codeplan · player-completeness+performance · EXEC-OUT · implemented: verified-brewing+real-behavior-controls+compact-command-context+cached-survival-environment+runtime-benchmark+one-shot-action-guard · verification: Paper-1.21.11-strength-and-natural-language-swiftness-pass · drift: live-proof-revealed-and-fixed-duplicate-action-retry · remaining-major-gameplay-groups: 2 · hardening-gates: 2]
```

```text
[codeplan · player-completion+fast-state-flow · EXEC-OUT · implemented: durable-home+verified-farm-lifecycle+verified-breeding+bounded-general-construction+restart-order-revalidation+event-driven-canonical-state-push+phase-timing · verification: Paper-1.21.11-farm-maintain-breed-build-repair-restart-pass+control-plane-214-pass+live-push-benchmark · drift: live-tall-wall-run-constrained-vertical-builds-to-verified-height-4+final-blueprint-checkpoint-fixed · remaining-required-gameplay-groups: 0 · advanced-backlog: documented]
```
