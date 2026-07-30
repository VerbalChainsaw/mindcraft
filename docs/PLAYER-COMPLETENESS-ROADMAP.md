# Player completeness and runtime performance

Status: commanded companion gameplay is operational. The bot can already
navigate, follow/guard, collect, craft, smelt, prepare food, sleep, seek/build
emergency shelter, equip armor upgrades, use doors and items, trade, ride,
construct fixed verified shelters, build/use Nether portals, run a Nether
quartz round trip, fight tactically, explore landmarks, recover death items,
and brew potions. "Player-complete" still has two major gameplay groups and
two operational hardening gates.

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

## Remaining major gameplay groups

### 1. Renewable home and equipment lifecycle — required

Existing food preparation can harvest/replant mature crops and hunt
sustainably, but it does not establish and maintain a renewable base loop.
Player-complete survival still needs:

- select hydrated farmland and plant missing crop rows;
- revisit, harvest, and replant a remembered farm;
- breed a bounded adult pair while preserving breeding stock;
- track equipped tool/armor durability and replace it before breakage;
- choose repair, replacement, or retirement using available materials;
- re-audit and repair the remembered shelter after damage.

This is one major group because the same persistent home/upkeep state should
own farm, supplies, equipment, and shelter maintenance.

### 2. General safe construction projects — required

The bot has verified emergency and functional shelter blueprints. It still
needs a typed construction goal that can compile an operator-approved bounded
shape into supported cells, reserve materials, checkpoint progress, recover
after interruption/restart, and verify the exact finished structure. This must
extend GoalDirector/JobDirector rather than re-enable generated code.

## Operational hardening gates

These are not new gameplay features, but they should be green before calling a
multi-bot deployment unattended:

- live restart continuity for active goals/work orders and remembered home;
- a longer live benchmark separating prompt build, provider inference,
  command dispatch, and physical action duration.

The stale pre-arbiter and disabled-quickstart expectations were updated to the
current contracts; the complete control-plane run is green at 213/213.

## Advanced mechanics backlog

Good next bounded additions:

| Mechanic | Size | Safe implementation boundary |
| --- | --- | --- |
| Contextual potion use | Small/medium | Survival/combat intent chooses only a verified carried potion and confirms consumption/effect |
| Fishing | Medium | One bounded cast/reel skill with water, interruption, pickup, and rod-durability evidence |
| Enchanting | Medium | Enchanting-table window with exact item/lapis/level preflight and changed enchantment evidence |
| Anvil repair | Medium | Exact input/material/level contract; verify durability and XP before output claim |
| Smithing/netherite | Medium | Version-aware smithing-template window with exact consumed inputs and output |
| Villager economy | Medium/large | Persist profession/trade observations and restock state around the existing verified trade skill |
| End progression/dragon | Large | New cross-dimension progression contract, stronghold/portal proof, bounded combat, return/recovery |
| Elytra flight/fireworks | Large | Dedicated flight controller, collision model, landing proof, and durability policy |
| General redstone machines | Large | Explicit circuit schema and stateful verification; not generic block narration |

No current control should claim these mechanics exist before their physical
skill and verification boundary are implemented.

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
