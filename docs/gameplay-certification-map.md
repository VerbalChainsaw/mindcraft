# Gameplay certification map

This is a bounded, resettable physical course for observing whether a real
Mindcraft/Mineflayer bot can play Minecraft. It is not a synthetic test suite.
Every pass condition is a Minecraft state change, not a chat claim.

## Operating the map

Start the managed Paper server and MindServer, then run:

```powershell
node tools/gameplay-certification-map.mjs build
```

`build` and `reset` are equivalent and restore the entire course. Populate the
three combat cells only when the bot is ready:

```powershell
node tools/gameplay-certification-map.mjs spawn-combat
```

Remove the course and release its forced chunks with:

```powershell
node tools/gameplay-certification-map.mjs remove
```

The Overworld course occupies only `x=990..1150`, `y=98..130`,
`z=990..1130`. The safe Nether receiver occupies `x=128..152`,
`y=60..84`, `z=128..152`. The tool sends commands through the existing managed
Paper control path at `http://localhost:8080`; use `--base-url` only when the
existing MindServer uses another address.

Resetting destroys blocks and tagged course entities inside those exact course
bounds. Do not build anything permanent there.

## Required awareness gate

Before acting, run `!awareness`. The bot must accurately report:

- health, hunger, time, weather, dimension, position, facing, support, and body clearance;
- held item, tools, weapons, food, nearby hostiles, hazards, useful resources, and workstations;
- its current survival-progression stage;
- the single next required milestone, its missing prerequisites, and the next legal operation;
- either an existing deterministic command or an explicit blocker.

Immediate danger, critical health, or critical hunger must override normal
progression. After every material state change, inspect again. A stale previous
answer is not evidence.

## Order of operations

For independent survival progression, the bot must obey this dependency chain:

1. logs;
2. planks;
3. crafting table;
4. wooden pickaxe;
5. three cobblestone consumed into a stone pickaxe;
6. eight additional cobblestone consumed into a furnace;
7. fuel and torches;
8. iron ore, then smelted iron;
9. iron pickaxe, shield, and bucket;
10. three diamonds, then a diamond pickaxe;
11. ten obsidian and an ignition item;
12. verified portal assembly and ignition;
13. Nether entry, quartz collection, and a live Overworld return.

The bot may reuse valid equipment or nearby workstations. Higher-tier equipment
is valid evidence that its lower-tier prerequisites were previously satisfied.
It may not claim a later operation from intention alone. Portal assembly now
uses the verified `!buildNetherPortal` command. The paired
`!completeNetherQuartzRun` command owns cross-dimensional entry, quartz
collection, safe return, and final world-state verification as one bounded
physical loop.

## Course stations and physical pass conditions

| Station | Bounds | Physical pass condition |
| --- | --- | --- |
| Hub | `995..1020, 995..1020` | From the lime start block, awareness identifies the current body and progression state before movement. |
| Bootstrap | `1025..1065, 995..1035` | Starting with an empty inventory, obtain a crafting table, stone pickaxe, furnace, fuel, torches, smelted iron, iron pickaxe, shield, bucket, safe food, and a bed or lit shelter. Each prerequisite must precede the operation that needs it. |
| Traversal | `1070..1145, 995..1018` | Open the door, cross water, survive the safety-catch gap without teleporting, climb and descend the ladder tower, enter and leave the mine chamber, reach the lime block, and return. |
| Mounted transport | `1074..1139, 1022..1039` | Mount the boat, steer it down the water lane, stop it mid-route on command, complete the lane, and dismount. Mount the genuinely saddled horse, steer it down the fenced land lane, stop, complete the lane, and dismount. Unsaddled pigs/striders must report their saddle and steering-item prerequisites rather than claim movement. |
| Farming | `1025..1065, 1040..1075` | Harvest and replant the mature plots, plant the empty hydrated plot, and breed at least one animal pair without emptying a breeding population. |
| Construction | `1070..1100, 1040..1072` | On the yellow footprint, build a lit, roofed enclosure with a usable door, bed, chest, and furnace. Verify enclosure and utility blocks in world state. |
| Combat | `1105..1145, 1040..1072` | After `spawn-combat`, defeat the zombie, skeleton, and creeper without creative mode, teleport, or command damage. Shield/range/spacing choices must reflect the active threat. |
| Exploration | `995..1065, 1080..1125` | Discover the gold, emerald, and diamond landmarks, recover the echo shard, remember their locations, then return to the entrance without teleporting. |
| Portal lab | `1070..1145, 1080..1125` | Acquire diamonds before obsidian, assemble and ignite a portal on the yellow frame marker, then use `!completeNetherQuartzRun` to prepare raised-frame ramps, enter the prepared Nether receiver, mine quartz, and return alive. A missing physical ability is a failed station, not permission to narrate success. |

Coordinates in the table are `x` and `z`; all Overworld station floors are at
`y=99`. The course deliberately includes lava, water, drops, hostiles, doors,
vertical travel, resource prerequisites, crop state, animals, construction
supplies, landmarks, and a dimension transition so gameplay awareness is
measured under actual state changes.
