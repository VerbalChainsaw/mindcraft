# Unified Gameplay Planner / Executor

## Decision

Do not add a second autonomous “brain” that bypasses the existing gameplay system. Build a deterministic, version-aware planning layer between player/LLM intent and the existing verified skills.

The layer owns **what must happen next**. Existing skills own **how one physical action happens and how Minecraft confirms it**. `BehaviorArbiter` remains the sole owner of action priority and interruption.

This document is a design plan only. It intentionally does not modify runtime behavior.

## Why the current system is insufficient

The repository already has most low-level capabilities:

- `minecraft-data` provides version-specific item/block/recipe data.
- Mineflayer provides live recipe availability (`bot.recipesFor`) and physical crafting (`bot.craft`).
- `craftRecipe`, `smeltItem`, gathering, navigation, placement, and tool preparation are verified atomic actions.
- `GoalDirector` persists typed goals and verifies inventory/delivery completion.
- `BehaviorArbiter` serializes player goals, jobs, survival, reflexes, recovery, and operator stop.

But the general link is absent. `GoalDirector` currently chooses one flat `acquisitionKind` and invokes one command. A generic `craft` goal calls `craftRecipe`; missing ingredients become an error rather than child goals. `prepareTool` contains a narrow hand-authored prerequisite chain. `getDetailedCraftingPlan` recursively explains recipe dependencies but is used only as a text query, not as executable state.

Result: the bot can know a direct recipe and still cannot reliably satisfy the full chain of prerequisites needed to obtain its ingredients, workstations, fuel, and harvest tools.

## Product contract

For a typed goal such as “bring me an iron pickaxe” or “build this structure,” the bot must:

1. Normalize the requested target against the connected server’s Minecraft registry.
2. Inspect live inventory, equipment, world availability, and safe operating constraints.
3. Derive a dependency graph across transformations and acquisition methods.
4. Select a feasible plan with explicit alternatives and a bounded search budget.
5. Execute exactly one verified primitive at a time through the existing action ownership boundary.
6. Reconcile the real result after every primitive, then replan if the world diverged.
7. Finish only on inventory/world evidence, or report the exact blocking leaf and next repair action.
8. Persist only resumable intent and evidence; on restart, re-observe world state before continuing.

The planner must never claim that a resource was gathered, a recipe was crafted, a block was placed, or an item was delivered without the existing runtime evidence.

## Scope

### MVP

- crafting-table recipes, ingredient quantities, batch outputs, and leftovers
- gathering/mining known source blocks
- tool and harvest-tier prerequisites
- furnace placement/use, smelting/cooking, and fuel acquisition
- inventory-aware plan selection
- interruption, retry, replan, and exact blocked-leaf reporting
- single requested acquisition/delivery goal at a time

### Deliberately deferred

- village trading, loot-table farming, structures, fishing, breeding, raids
- brewing, enchanting, smithing, Nether/end progression
- arbitrary LLM-generated commands or arbitrary shell/code execution
- concurrent multi-bot dependency allocation
- pretending an unknown resource is available

Deferred mechanics can be added as explicit acquisition adapters after they have real observation and execution contracts.

## Architecture

### 1. `GameKnowledgeIndex` — canonical facts

Use the connected bot registry and `minecraft-data` as the source of truth. Index:

- items, blocks, drops, harvestability, tool requirements
- all recipe alternatives, shaped/shapeless ingredient multiplicities, output counts
- workstation requirements
- known transforms: crafting, smelting/cooking, and fuel consumption
- acquisition adapters for mineable/collectable world resources

Do not encode mechanics in prompt text or duplicate broad recipe tables by hand. Small explicit overrides are acceptable only where upstream registry data cannot represent a runtime fact and must be version-gated and tested.

### 2. `PrerequisitePlanner` — pure plan construction

Input:

```text
Goal target + quantity
Live inventory/equipment snapshot
Observed world/resource snapshot
Safety and capability policy
Planner budget
```

Output:

```text
Plan DAG
- nodes: obtain | transform | workstation | equip | travel | verify
- required quantity, available quantity, output batch size
- alternatives with selection reason
- prerequisites and dependents
- estimated cost/risk
- status: pending | ready | blocked | complete
- explicit blocker nodes
```

The graph is AND/OR:

- an iron pickaxe requires `3 iron_ingot + 2 stick + crafting_table` (AND)
- planks can be produced from compatible logs (OR)
- an unavailable route is not silently discarded; it is recorded with its reason

Planning rules:

- consume inventory before creating prerequisites
- account for batch output and leftover material
- prefer reachable, safe, low-setup alternatives over a fixed first recipe
- cap recursion depth, node count, alternative expansion, and replans
- detect cycles and unsupported transforms as explicit blockers
- use the exact server version and registry, not screenshots/display names

### 3. `PlanExecutor` — one primitive, then reconcile

`PlanExecutor` chooses only a ready leaf node and maps it to an already-verified command/skill:

| Plan node | Existing primitive examples |
|---|---|
| collect source | `collectBlock`, `collectWood` |
| equip/prepare tool | `prepareTool`, equip primitive |
| craft | `craftRecipe` |
| prepare workstation | existing table/furnace placement/recovery primitives |
| transform | `smeltItem` |
| delivery | `givePlayer`, `giveFamilyToPlayer` |

After every action:

1. consume `ActionResult` / inventory / world evidence;
2. mark the node succeeded, failed, or blocked;
3. refresh affected facts;
4. replan only the unresolved portion;
5. publish concise truthful progress.

No raw string command should become the system’s authoritative state. Commands remain an adapter to the verified action layer.

### 4. `PlanDirector` — goal lifecycle integration

Replace the single-hop acquisition decision in `GoalDirector`, not the established lifecycle:

```text
assess → plan → select-ready-step → acting → reconcile → replan
      ↘ blocked | complete | cancelled
```

`GoalDirector` remains responsible for persistence, player delivery, terminal status, and restart revalidation. `PlanDirector` owns graph construction/execution state for one active goal.

### 5. `BehaviorArbiter` integration

The planner does not create a competing control loop.

- `BehaviorArbiter` still gives priority to operator stop, self-preservation, defense, recovery, survival, explicit player goals, and jobs.
- A plan step is dispatched only when the player-goal lane owns `ActionManager`.
- Interruptions preserve the graph but invalidate the active step; live state is re-read before resume.
- A plan cannot restart itself after an authoritative stop.

## Example: iron pickaxe from an empty inventory

```text
Goal: 1 iron_pickaxe

craft iron_pickaxe
├─ 3 iron_ingot
│  └─ smelt 3 raw_iron
│     ├─ collect raw_iron
│     │  └─ equip stone_pickaxe
│     │     ├─ craft stone_pickaxe
│     │     │  ├─ 3 cobblestone
│     │     │  └─ 2 sticks
│     │     └─ ...wooden-pickaxe prerequisites
│     ├─ furnace
│     └─ fuel
├─ 2 sticks
└─ crafting_table
```

The exact graph changes when the bot already owns planks, coal, a furnace, tools, or reachable resources. If no iron is observed after the configured scout/search policy, the result is:

```text
blocked: iron_ingot
reason: no safe reachable raw_iron source observed
next action: scout for iron or supply 3 raw_iron
```

—not a false “craft failed.”

## Learning model

“Learning” must mean evidence-backed operational learning, not an LLM inventing Minecraft mechanics.

Persist per-agent, version-scoped observations:

- successful alternative and workstation choice
- observed source locations/dimensions with freshness/expiry
- action duration, path failures, and resource yield
- verified procedure traces already supported by `ProcedureStore`

Use learned data only to rank feasible alternatives. It must never override registry facts, safety rules, explicit player instructions, or fresh live evidence. Invalidated/expired observations become hints, not facts.

## Implementation sequence

### Phase 0 — protect current work

- Do not alter the currently dirty `gameplay-progression.js`, `skills.js`, `full_state.js`, or `queries.js` work.
- Confirm ownership with the current runtime agent before touching `GoalDirector`, shared skill contracts, or full-state telemetry.
- Establish a clean integration branch/worktree after that work lands.

### Phase 1 — pure knowledge and planning

New isolated modules:

- `src/agent/runtime/game-knowledge-index.js`
- `src/agent/runtime/prerequisite-planner.js`
- `tests/control-plane/prerequisite-planner.test.js`

Implement pure, deterministic plan generation against fixture registries/inventories. No agent-loop wiring yet.

### Phase 2 — executor adapter and reconciliation

New module:

- `src/agent/runtime/plan-executor.js`

Map ready plan nodes to existing primitive actions and normalized action evidence. Test interrupted, missing-material, unreachable-workstation, and changed-inventory paths.

### Phase 3 — lifecycle integration

Modify only after Phase 1/2 are stable:

- `goal-director.js`
- goal contract persistence/versioning
- agent runtime initialization and full-state readout

Migrate flat acquisition goals to a persisted plan snapshot with restart revalidation. Retain the old path behind a temporary compatibility boundary until characterization tests prove parity for simple collection goals.

### Phase 4 — additional mechanics

Add acquisition adapters one at a time: crops, mobs, building bill-of-materials, then specialized workstations. Each adapter needs factual detection, bounded execution, safety policy, and runtime verification before being planner-visible.

## Verification contract

Unit/contract tests:

- recursively plan sticks/planks/table from logs
- plan iron pickaxe with partial inventory and correct leftovers
- choose a viable alternative when the first recipe/source is unavailable
- report an unsupported/blocked leaf rather than fabricate a plan
- detect cycle/depth/budget exhaustion safely

Runtime integration tests:

- one plan node runs at a time through `ActionManager`
- emergency/stop interrupts the active node and prevents automatic restart
- failed/changed action evidence causes replan, not false success
- restart restores intent but requires fresh inventory/world verification
- simple existing `collect_block` and delivery behavior remains intact

Live certification scenarios:

- empty-inventory wooden/stone/iron tool progression
- partial-inventory torch and shield goals
- furnace/fuel path
- missing-resource blocked report
- building-material deficit followed by verified placement

## Risk controls

- bounded graph/search/replan budgets prevent runaway recursion and API/model cost
- planner is deterministic and local; no network or LLM is required for mechanics
- every physical action goes through existing verified skills
- one action owner at a time
- no claim of game success without runtime evidence
- learn from verified outcomes only, version-scoped and expiring
- staged integration preserves current gameplay while planner modules are characterized

## Decision gate before implementation

Do not begin implementation until the agent currently editing gameplay progression and shared skills confirms its intended contract. The planner should consume that work, not overwrite or parallel it.
