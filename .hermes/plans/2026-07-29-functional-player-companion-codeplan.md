 [codeplan · functional-player-companion · IN · mode: full · confidence: med · candidates: V1 Scenario Scripts [sequence-inline/local-only], V2 Engine Integration [director-loop/instance-state], V3 Skill-Graph Planner [graph-planner/instance-state], V4 Behavior Tree Rewrite [tree-state/new-library] · lean: V2 · baseline: V1]

# Functional Player Companion Codeplan

## Decision target

Select one mechanism that turns the existing Luna-backed Mindcraft agent into a reliable player companion without replacing the current conversation, ActionManager, deterministic skills, directors, or Paper/Mineflayer runtime.

Required physical outcome:

- consistently identify the real Floodgate/Bedrock player;
- perceive presence, visibility, hazards, inventory, tools, nearby blocks, and threats;
- follow, reacquire, maintain spacing, transfer items, guard, stop, and resume truthfully;
- survive basic hunger/fire/water/fall/hostile conditions;
- complete one representative observe → gather → craft → use/deliver loop;
- route direct and natural-language requests through the same deterministic mechanics;
- keep Luna responsible for intent/conversation, not actuator arbitration or invented world facts.

## Repository constraints

- Working physical gameplay is the product; real Paper/Mineflayer evidence outranks chat output or theoretical coverage.
- Preserve dirty WIP and the Luna/Codex OAuth provider.
- Preserve the current LLM/conversation → deterministic action/skill architecture.
- Reuse ActionManager, CompanionContext, modes, directors, game knowledge, and existing skills.
- Do not add broad test infrastructure, a second action state machine, or unsafe generated-code execution.
- Keep failures structured, actionable, interruptible, and truthful.

## Candidate mechanisms

### V1 — Scenario Scripts

Fingerprint: `sequence-inline / local-only / internal-reuse / return-code`

Implement fixed procedural flows for the required player scenarios directly over existing skills: follow, give, guard, survival recovery, and one gather-craft-use sequence. Each flow owns local state and returns structured action evidence.

### V2 — Engine Integration

Fingerprint: `director-loop / instance-state / internal-reuse / degrade-graceful`

Keep existing engines and add one coherent capability/task execution contract: CompanionContext supplies authoritative human/world context; ActionManager owns actuators; existing directors select only authorized work; existing skills expose preconditions, progress, evidence, and recoverable blockers. A bounded player-task runner composes existing skills without becoming a second scheduler.

### V3 — Skill-Graph Planner

Fingerprint: `graph-planner / instance-state / internal-reuse / return-code`

Represent skill preconditions/effects as a graph and plan gather-craft-use dynamically from current inventory/world state. Reflexes remain event-driven; the planner produces ActionManager-owned deterministic steps.

### V4 — Behavior Tree Rewrite

Fingerprint: `tree-state / external-store / new-library / throw-wrapped`

Replace director/mode selection with a behavior-tree runtime coordinating perception, survival, social behavior, combat, and task execution.

## Divergence proof

- V1 vs V2: local procedural sequence vs persistent existing-director state.
- V1 vs V3: inline fixed flow vs graph-derived steps.
- V2 vs V3: event/director selection vs declarative planning graph.
- V4 differs from all others in module boundary, state carrier, dependency strategy, and control flow.

## Evidence pending

- Current Mineflayer/Paper/Geyser/Floodgate guidance and production examples.
- Verified scoring arithmetic, baseline guard, and winning implementation slices.

## Calibrated architecture

- `ActionManager` is the only serialized actuator owner and already supplies owner priority, interruption, timeout, resumable work, and structured results.
- `CompanionContext` owns nonpersistent human identity, presence, directives, protection, attention, and bounded snapshots without retaining live entities.
- Skills own world effects; command wrappers route both natural and direct requests through the same skills.
- Directors own one in-flight behavior and sanitized phase/status telemetry.
- Cooperative cancellation, operator hold, and manual takeover are hard compatibility contracts.
- Existing conventions are ESM JavaScript, camelCase, bounded strings, explicit result codes, defensive optional chaining, and focused fake-bot/fake-clock diagnostics.

## Hard viability gates

| Variant | Gate | Decision |
|---|---|---|
| V1 Scenario Scripts | G: pass | Can satisfy the explicit representative scenarios with existing skills and no new dependency while preserving ActionManager ownership. |
| V2 Engine Integration | G: pass | Reuses the current architecture, keeps one scheduler/actuator owner, and addresses continuity and recovery without autonomous work invention. |
| V3 Skill-Graph Planner | G: pass | Viable only as an internal, bounded planner producing ActionManager-owned steps; no external dependency or second actuator owner allowed. |
| V4 Behavior Tree Rewrite | G: fail | Violates repository architecture and negative-space constraints by replacing working directors/action ownership, adding a second state machine, and introducing unnecessary dependency contamination. |

## Frozen rubric

The repository's real quality axes are physical gameplay truth, architectural continuity, natural embodied continuity, interruption safety, evidence truth, debuggability, and bounded blast radius. These weights are frozen before scoring.

Rubric frozen: axes [Physical correctness, Architecture fit, Natural continuity, Safety/cancellation, Evidence truth, Testability/debuggability, Blast radius] · weights [3,3,2,2,2,1,1] · denominator = Σ(weights) × 5 = 70 · denominator-policy [uniform-N/A-only] · baseline-algo [lowest-effort gate-passer with no score of 1 on any quality axis]

freeze: axes=PhysicalCorrectness,ArchitectureFit,NaturalContinuity,SafetyCancellation,EvidenceTruth,Testability,BlastRadius weights=3,3,2,2,2,1,1 denom=ΣW×5 baseline=lowest-effort-gate-passer

## Baseline candidate

V1 Scenario Scripts is the provisional baseline: it is the lowest-effort gate-passing mechanism and does not inherently score 1 on a quality axis. It may win if evidence shows fixed flows are sufficient; complexity receives no automatic credit.

## External implementation evidence

Current authoritative guidance supports the repository's existing mechanism rather than a rewrite:

- Mineflayer distinguishes a known player from a currently loaded entity; loaded presence is not proof of online status or line of sight. <https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md>
- Moving-player follow should use dynamic `GoalFollow`; last-seen recovery should use one bounded `GoalNear`, then stop and wait rather than repeatedly chasing stale terrain. <https://github.com/PrismarineJS/mineflayer-pathfinder#goals>
- Pathfinder ownership and recovery should use `path_update`/`path_reset`, intentional movement costs, and explicit stop/null-goal semantics. <https://github.com/PrismarineJS/mineflayer-pathfinder#events>
- Guarding should be event-triggered from attributed damage and use one PvP owner; polling attack loops compete with Pathfinder. <https://github.com/PrismarineJS/mineflayer-pvp/blob/master/docs/api.md>
- `toss` proves only that the bot dropped an item. Truthful delivery requires bot inventory delta, dropped entity identity, intended collector identity, and a raw collect-packet fallback when Mineflayer has already deleted the collected entity. <https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md>
- Gather → craft → use should be a bounded action sequence that re-evaluates inventory, health, tools, recipes, reachability, and workstations between steps. `collectblock` must remain under one exclusive action owner. <https://github.com/PrismarineJS/mineflayer-collectblock>
- State-machine production guidance supports registering exact lifecycle listeners on entry and removing only owned listeners on exit; independent permanent loops are an anti-pattern. <https://github.com/PrismarineJS/mineflayer-statemachine>
- Geyser translates Bedrock players into Java-server players; movement remains normal Mineflayer/Java behavior. Floodgate display names are not stable identity and may be prefixed, so canonical server identity must be resolved centrally. <https://geysermc.org/wiki/geyser/faq/> · <https://geysermc.org/wiki/floodgate/>
- Paper view distance, simulation distance, and entity broadcast range bound what can be observed and acted on; missing loaded entities must not be labeled invisible or disconnected without qualification. <https://docs.papermc.io/paper/reference/server-properties/>

## Scoring (1–5; frozen weights)

| Axis | W | V1 Scenario Scripts | V2 Engine Integration | V3 Skill-Graph Planner |
|---|---:|---:|---:|---:|
| Physical correctness | 3 | 4 | 5 | 4 |
| Architecture fit | 3 | 4 | 5 | 3 |
| Natural continuity | 2 | 2 | 5 | 4 |
| Safety/cancellation | 2 | 3 | 5 | 4 |
| Evidence truth | 2 | 4 | 5 | 4 |
| Testability/debuggability | 1 | 3 | 4 | 4 |
| Blast radius | 1 | 4 | 4 | 2 |
| Effort | — | low | medium | high |
| Weighted total | — | 49 | 68 | 51 |
| Denominator | — | 70 | 70 | 70 |
| Normalized | — | **0.700** | **0.971** | **0.729** |

Arithmetic verification:

- V1 products `[12,12,4,6,8,3,4]` → `49/70 = 0.700`.
- V2 products `[15,15,10,10,10,4,4]` → `68/70 = 0.971`.
- V3 products `[12,9,8,8,8,4,2]` → `51/70 = 0.729`.
- All variants use the same axes and denominator.

## Decision

Pick **V2 Engine Integration** (`director-loop / instance-state / internal-reuse / degrade-graceful`).

Why:

- It preserves the repository's only actuator owner and existing deterministic skill library.
- It converts current engines from disconnected features into a continuous player-authorized behavior loop.
- It handles follow, guard, survival, task continuation, recovery, and evidence without fixed scenario duplication.
- It can compose gather/craft/use through the existing JobDirector and ActionManager rather than adding a planner or behavior tree.
- It directly matches current Mineflayer production guidance: event/state-driven transitions, dynamic goals, exact listener lifecycle, and one movement/combat owner.

V1 remains the baseline but loses because fixed scripts cannot generalize recovery or continuity. V3 adds planning machinery before the existing execution engine has a complete capability contract. V4 remains disqualified.

## Winning implementation plan

### Slice 1 — Physical companion invariants

Owner: existing `CompanionContext`, `ActionManager`, player-target resolver, follow/give/guard skills.

- Finish one canonical player identity contract using Floodgate UUID/canonical username/entity epoch plus chat alias.
- Use dynamic `GoalFollow` with a 3–4 block settle envelope and 5–6 block resume threshold; retain the existing personal-space hard floor.
- Reacquire replaced entities; use one bounded last-seen recovery goal; then stop and report `waiting_for_target`.
- Make Stop generation-safe so a stale Stop cannot interrupt a newer player command.
- Keep Give close enough for pickup, confirm bot inventory decrement, exact drop identity, canonical collector, and raw collect packet IDs.
- Guard only the attributed hostile source that damaged the explicitly protected player; resume guard/follow after combat.
- Keep attention and elbow-room behavior advisory and idle-only.

### Slice 2 — Capability contracts over existing skills

Owner: a small internal capability registry consumed by existing actions/directors; no new scheduler.

Define bounded metadata for existing player competencies:

- observe/query;
- navigate/follow/recover;
- inventory/equip/eat/give/container transfer;
- gather wood/block/resource;
- craft/smelt;
- place/activate/use;
- guard/retreat/survive.

Each capability declares:

- required world/inventory/tool/workstation state;
- the existing skill/action that performs it;
- recoverable blocker codes;
- terminal physical evidence;
- cancellation/cleanup ownership.

Do not duplicate skill implementation in the registry.

### Slice 3 — Player-authorized task sequencing through JobDirector

Owner: existing `JobDirector`, work-order state, and `ActionManager`.

- Add one bounded `player_task` work-order shape for supported sequences, not arbitrary code or a general planner.
- Supported step families initially: acquire, craft/smelt, equip/use/place, deliver.
- Resolve prerequisites from the active Minecraft version's `minecraft-data` recipes, block harvest tools, smelting rules, workstation requirements, inventory deficits, and the existing `game_knowledge` layer. Do not store one hardcoded progression chain.
- Expand only the requested goal into a bounded dependency graph: detect cycles, cap depth/step count, preserve recipe alternatives, and classify leaves as already-owned, gatherable, smeltable, workstation-required, or unsupported.
- JobDirector remains the executor. The dependency resolver proposes the next required capability step but does not own movement, digging, crafting, containers, combat, or cancellation.
- Execute exactly one existing skill at a time through ActionManager.
- Re-evaluate and rebuild the remaining dependency graph from live inventory, health, target presence, tool durability, recipe/workstation availability, and cancellation after every physical step. Never trust an old plan after the world state changes.
- Persist only stable work-order inputs and completed step identifiers; never persist live entities or transient coordinates.
- On recoverable blocker, perform one declared recovery transition; otherwise stop truthfully with the exact missing requirement.

Representative first acceptance loop only (derived from data, never stored as special-case logic):

`inspect inventory → acquire logs → craft planks/sticks/crafting table → craft and equip wooden pickaxe → collect cobblestone → craft and equip stone pickaxe → collect requested cobblestone → deliver it`

### Slice 4 — Natural request convergence

Owner: existing deterministic directive parser and Luna conversation layer.

- Add deterministic mappings for common bounded intents: craft, smelt, deposit/take, open/activate, plant, sleep, retreat, and player-task requests.
- Direct commands and Luna-generated requests create the same work order or call the same existing action.
- Luna may clarify ambiguous item/quantity/target intent, but cannot invent physical completion or bypass policy.
- Keep insecure generated code and arbitrary player attack unavailable.

### Slice 5 — Basic survival readiness

Owner: existing SurvivalDirector and self-preservation mode.

- Enable bounded basic survival in the companion profile: eat owned safe food, restore held equipment, escape fire/water/fall hazards, and report missing food/tool/safe-route blockers.
- No unsolicited resource gathering, exploration, building, or hunting.
- Emergency self-preservation may preempt work; normal maintenance runs only while idle and resumes the player work order afterward.

### Slice 6 — Physical acceptance, not broad testing

Use the real Paper world and real `.LittleBubby9352` Bedrock identity. Stop after these physical behaviors work:

1. Chat and explicit follow converge on the same canonical player and maintain the spacing envelope across turns/elevation.
2. Brief player disappearance/entity replacement produces bounded reacquisition and automatic continuation; disconnect produces waiting, not stale pursuit.
3. Give transfers the exact requested quantity and reports success only after exact pickup evidence.
4. Guard attacks only the attributed hostile that damaged the protected player and resumes afterward; source-less damage causes no guessed attack.
5. Stop quiesces pathfinder/PvP/controls and remains authoritative against reactions and emergencies other than immediate self-preservation cleanup.
6. Hunger/fire/water fixture proves bounded survival response.
7. One real gather → craft → equip/use → deliver task completes with physical inventory/world evidence.

No soak framework, broad suite, synthetic completion audit, or independent movement/combat loop is in scope.

[codeplan · functional-player-companion · OUT · mode: full · pick: V2 · confidence: high · beatBaseline: yes · scores: V1 0.700, V2 0.971, V3 0.729 · reason: existing-engine integration best preserves one actuator owner while adding natural continuity and bounded task composition · mechanism-check: passed · corrected: bootstrap wooden pickaxe before stone-pickaxe cobblestone dependency]
