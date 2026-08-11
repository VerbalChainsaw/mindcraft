# Minecraft Companion V2 — Technical Debt Map

**Purpose:** Maintain a living, evidence-based register of technical debt without turning maintenance into a competing architecture program.

**Last reconciled:** 2026-08-10, branch `recovery/iron-pickaxe-20260803`, source checkpoint `8e58d0b` (reliability tranche: TD-LIFE-001, TD-ACT-001, TD-PROMPT-002, TD-PROV-001, TD-JOB-001) plus a model-lifecycle tranche closing TD-MODEL-001's plumbing and opening TD-MODEL-002.

**Anchor drift note (2026-08-10):** `src/agent/library/skills.js` is now 19,829 lines, not the 13,682 recorded under TD-PHY-001. Line anchors in records last touched on 2026-08-04/06 should be re-verified before use; the anchors cited in the reliability-tranche records below were re-verified on 2026-08-10.

**Coordination note:** Codex remains the sole repository writer and Minecraft runtime owner. This file does not authorize touching active source/runtime work or interrupting the current gameplay checkpoint.

## How to use this map

Debt is not automatically scheduled work. A record becomes actionable only when its activation gate is met or the Director explicitly schedules it.

- **P0 — current correctness/safety blocker:** repair inside the active functional tranche.
- **P1 — mission-coupled debt:** repair when the next real player outcome reaches this boundary.
- **P2 — demonstrated reliability/performance debt:** schedule after a direct measurement or reproduced failure.
- **P3 — maintainability debt:** handle opportunistically at a clean checkpoint; never interrupt gameplay solely for cleanup.
- **Conditional:** plausible from code inspection, but requires the named runtime probe before modification.
- **Rejected/closed:** retained so a stale review cannot silently promote it again.

When updating a record:

1. Refresh line anchors if the referenced file moved.
2. Add observed Minecraft/runtime evidence, not reviewer agreement or test counts.
3. Record the smallest boundary that owns the defect.
4. Promote priority only when the activation gate is satisfied.
5. Close debt only after the stated exit criteria are directly verified.
6. Do not use lower line count, more interfaces, more tests, or more documents as proof of resolution.
7. Reconcile this file whenever new evidence confirms, disproves, reprioritizes, activates, or closes a record; do not leave material debt reasoning stranded only in chat or review documents.

## Structural scan provenance

The 2026-08-04 expansion used the built `center-geo` scanner interactively against the current dirty V2 snapshot with default configuration. Scan ID: `scan:4ee6b7896858c7cc`; configuration hash: `e093a6a1eb83a4e3`.

- Files seen/indexed: 187/187; failed or unsupported: 0.
- Graph: 2,837 nodes and 26,726 edges.
- Engines completed: radial, cycle, boundary, anomaly, convergent, and path.
- Boundary and path engines produced zero signals. The other engines produced 438 raw signals and 20 fused hypotheses.
- 17,838 edges were low-confidence, so graph rank was used only to select code for direct inspection.
- The highest-ranked regions were expected hubs: `agent.js`, `prompter.js`, `ActionManager`, player directives, Minecraft data, and the owned Pathfinder goal surface.

**These are structural risk hypotheses derived from graph evidence. They are not confirmed defects until reproduced or proven by a focused audit.** Only findings whose concrete code path was subsequently traced appear as confirmed debt below.

## Current map

| ID | Priority | Status | Boundary | Summary |
|---|---:|---|---|---|
| TD-BUILD-001 | P1 | Confirmed, Director-deferred | Blueprint contract → placement → verification | Blueprint cells preserve name, position, stage, and function, but cannot yet express or verify block properties, orientation, multi-cell identity, or final functional assertions. |
| TD-BUILD-002 | P1 | Conditional, activation-gated | Blueprint dependency scheduling | One scalar `stage` imposes a global barrier even when a later supported cell is independently ready. |
| TD-BUILD-003 | P3 | Deferred consolidation | Construction request → blueprint compiler | Primitive generation, the design DSL/templates, and the named structure catalogue overlap, although all currently converge on the same persisted blueprint. |
| TD-PLAN-001 | P1 | Deferred, activation-gated | Prerequisite candidate ranking | Source and recipe selection still includes fixed acquisition costs and material bonuses layered over live distance and learned outcomes. |
| TD-LEARN-001 | P1 | Confirmed, activation-gated | Runtime outcome memory → acquisition strategy binding | Learning can rank candidates within a method but cannot exclude a repeatedly nonproductive acquisition strategy and bind a structurally different one. |
| TD-INV-001 | P1 | Deferred, activation-gated | Active plan → inventory capacity policy | Retention and disposal decisions are role/item tables rather than requirements derived from the active plan or work order. |
| TD-INTENT-001 | P1 | Deferred semantic debt | Player directive → durable outcome routing | Direct craft/smelt phrases can dispatch one-shot commands instead of the durable prerequisite-planned goal path. |
| TD-FOOD-001 | — | Closed at `0f465fe` | Versioned food facts → policy/execution | Stale `raw_*`/`steak` identities were replaced by one registry-filtered food-semantics owner backed by the generated smelting catalogue. |
| TD-PLAN-002 | P1 | Confirmed, campaign-gated | Role/progression helpers → prerequisite planner | `prepareTool` and `prepareMaterial` remain executable recursive prerequisite engines for several older callers. |
| TD-PLAN-003 | — | Closed at `cad4bf3` | Planner perception → event loop → physical execution | Repeated wide synchronous proximity scans were cached and bounded for planning without shrinking the chosen action's physical search range. |
| TD-TOOL-001 | P1 | Mapped, activation-gated | Registry harvest facts → equipment choice | Tool tier, recipe, harvest eligibility, and preference knowledge remain repeated across planner, roles, progression, and physical skills. |
| TD-DUR-001 | P1 | Mapped, activation-gated | Equipment condition facts → context policy | The same durability-reserve calculation is implemented independently by several consumers. |
| TD-MINE-001 | P1 | Mapped, activation-gated | Registry drops/harvest → worldgen/search policy | Static mining outputs, required tools, tier choice, and preferred depths are still mixed in role logic. |
| TD-SEM-001 | P1 | Mapped, activation-gated | Connected Minecraft facts → context policy | Food, hazard, ore, workstation, useful-item, and related object traits are repeatedly inferred with local regexes and lists. |
| TD-WORK-001 | P1 | Deferred until broad demand | Operation prerequisite → workstation binder | Existing, remembered, carried, and temporary crafting stations are selected through several narrow paths rather than one bounded resolver. |
| TD-PROG-001 | P1 | Mapped, campaign-gated | Autonomous milestone → prerequisite planner | Progression correctly owns outcomes but still embeds the recipe ladder and direct preparation commands used to reach them. |
| TD-THREAT-001 | P2 | Deferred | Entity facts → combat/survival policy | Hostile, ranged, explosive, avoid, and value traits are repeated; policies may legitimately weight shared facts differently. |
| TD-FARM-001 | P2 | Deferred until farming broadens | Versioned crop mechanics → farm policy | Crop drops, seeds, ages, soil, and hydration facts remain hand-described across farm paths. |
| TD-BUILD-004 | Later | Deferred until requested | Fixture intent → material-family substitution | Template accessories choose concrete defaults such as oak doors and red beds rather than binding compatible material families. |
| TD-CAP-001 | P1 | Active, incremental | Planner → capability binder → executor | Catalogue contracts exist, but the first tranche is narrow and most binders still wrap opaque commands rather than concrete world targets. |
| TD-CAP-002 | P1 | Confirmed contract gap | Capability failure → GoalDirector recovery | Every catalogue-generated failure is marked retryable and omits the target, progress, timing, and blocker identity required for causal replanning. |
| TD-PHY-001 | P1 | Active, incremental | Deterministic physical execution | `skills.js` concentrates unrelated mechanics, policies, recovery loops, and evidence production in one 13,682-line module. |
| TD-DEP-001 | P1 | Active migration debt | Owned Minecraft dependency graph | The owned Pathfinder is imported directly while registry Pathfinder remains installed; the root lockfile is explicitly ignored and the installed graph contains a second legacy Mineflayer. |
| TD-IO-001 | P3 | Measured 2026-08-10, gate NOT met | Durable state persistence | Real cost is 1.8ms on a typical tick and 13.5ms on a heavy one; the stall premise is not supported on this hardware. |
| TD-PROV-001 | P2 | Repaired 2026-08-10, live probe pending | Provider transport | OpenAI-compatible and Qwen adapters now lift `timeout`/`timeout_seconds` onto the SDK client. |
| TD-MODEL-001 | — | Closed 2026-08-10 (plumbing) | Model routing/cancellation | Lifecycle now forwards through routers to unique leaf providers across all eight routes. |
| TD-MODEL-002 | P2 | Repaired 2026-08-10, live stop pending | Provider cancellation capability | The OpenAI-family adapters now abort in-flight requests; cancellation throws a typed error the router refuses to route past. |
| TD-PROMPT-001 | P2 | Conditional on measurement | Prompt assembly | Prompt expansion repeats world queries and example embedding/ranking work for unchanged inputs. |
| TD-PROMPT-002 | P2 | Repaired 2026-08-10 | Coding/autonomy generation | `awaiting_coding` now releases in `finally`; both floating `startLoop()` launches route through a guarded sink. |
| TD-LIFE-001 | P2 | Repaired 2026-08-10, live stop pending | Agent process lifecycle | The child entrypoint now maps one SIGINT/SIGTERM into one bounded `teardownAndExit`. |
| TD-ACT-001 | — | Closed 2026-08-10 | Action timeout settlement | The timeout callback now sinks its own rejections; injected stop/history failure is covered by a focused check. |
| TD-MEM-001 | P3 | Measured 2026-08-10, largely disproved | Landmark memory persistence | Real stores are 1.1KB (not the 256KB cap) and `save()` already no-ops unless dirty; the design smell remains, the cost does not. |
| TD-HIST-001 | P2 | Confirmed concurrency gap | Conversation/history mutation | Numerous call sites fire-and-forget async history addition, allowing overlapping summarization and unobserved rejection. |
| TD-JOB-001 | — | Closed 2026-08-10 | Job deduplication memory | Completed work-order IDs are retained in an insertion-ordered bound of 256. |
| TD-SWARM-001 | P2 | Confirmed process race | Swarm helper relocation | Relocation reports success without awaiting termination of the old child process. |
| TD-ARB-001 | P2 | Conditional on runtime trace | Behavior arbitration | Several mutually intended job lanes call `job.update()`; duplicate calls in one tick have not been directly measured. |
| TD-AGENT-001 | P3 | Deferred | Agent composition/lifecycle | `Agent.start()` constructs and wires most subsystems, creating a wide change surface. |
| TD-PROV-002 | P3 | Deferred, partial only | Provider adapters | Several provider files duplicate OpenAI-compatible transport, but not all providers share the same semantics. |
| TD-TEXT-001 | — | Primitive closed 2026-08-10; family still deferred | Runtime data normalization | The corrupted primitive silently broke rule removal for every auto-generated rule; repaired and both files re-encoded as searchable text. |
| TD-TEST-001 | P2 | Confirmed coverage gap | Lint/test gate maintenance | Named lint lanes cover only 57 of 160 source files, while abruptly globbing the remainder currently exposes substantial legacy configuration and rule noise. |
| TD-DOC-001 | P3 | Deferred | Evidence/document retention | Verification evidence is numerous and lacks an explicit retention/archive rule. |
| TD-COORD-001 | — | Closed at `faec430` | Coordination | `CURRENT.md` now distinguishes the preserved functional source commit from later documentation-only checkpoint commits. |

## Detailed records

### TD-BUILD-001 — Blueprint placement semantics stop at block identity

- **Priority/status:** P1, confirmed contract gap, explicitly deferred by the Director until a broad functional build reaches it.
- **Evidence:**
  - `src/agent/runtime/work-order.js:66-116` normalizes each blueprint cell to coordinates, material, optional scalar stage, and optional function only.
  - `src/agent/runtime/jobs/builder-plan.js:599-609` emits the raw `!placeBlockAt` command for the next cell rather than a typed placement capability with state requirements.
  - `src/agent/runtime/block-placement-contract.js:10-31` verifies exact block name or a narrow same-drop attachment equivalence, not facing, open/powered state, paired halves, or multi-cell identity.
  - `src/agent/runtime/job-director.js:406-532` audits cell occupancy and support but does not evaluate blueprint-level functional assertions.
- **Why this is debt:** The generic construction milestone proves mixed-material, persisted, resumable placement of ordinary cells. It does not yet prove that the same contract can faithfully build doors, beds, chests with intended facing, powered components with required state, or other stateful/multi-cell structures.
- **Activation gate:** A broad player-authorized build requires orientation, block-state properties, paired/multi-cell placement, or a functional final assertion. Do not schedule a synthetic placement permutation campaign.
- **Correct repair shape:** Extend the existing blueprint cell/effect contract only with the semantics demanded by that build, bind placement through the capability catalogue, let Mineflayer perform the mechanic, and verify the resulting Paper state.
- **Exit criteria:** The activating broad build survives persistence/resumption and Paper verifies both the cells and the requested functional state.
- **Do not solve by:** A second builder, per-structure scripts, symbolic simulation of every Minecraft block state, or a general world-state framework.

### TD-BUILD-002 — Scalar stages are a conservative global dependency barrier

- **Priority/status:** P1, conditional and activation-gated; no confirmed live correctness failure yet.
- **Evidence:** `src/agent/runtime/jobs/builder-plan.js:228-247` sorts supported missing cells by scalar stage and permits carried work only in the earliest stage, even when another supported cell in a later stage is independent.
- **Why this is debt:** Stages are a useful compact ordering hint, but one global number cannot represent partial dependency order. It can force unnecessary acquisition or defer safe parallel work.
- **Activation gate:** A broad build is blocked, detoured, or made materially slower solely because an independently supported carried cell is behind an unfinished earlier stage.
- **Correct repair shape:** Derive readiness from concrete support/dependency edges while retaining deterministic tie-breaking; do not invent a general-purpose planner.
- **Exit criteria:** The reproduced build selects any dependency-ready carried cell without violating support, returnability, or exact verification.

### TD-BUILD-003 — Construction has overlapping blueprint frontends

- **Priority/status:** P3, deferred consolidation only.
- **Evidence:** `createConstructionBlueprint()` in `src/agent/runtime/jobs/builder-plan.js`, the template/DSL compiler in `src/agent/runtime/jobs/structure-design.js`, and the named definitions in `src/agent/runtime/jobs/structure-catalog.js` all generate related construction descriptions that ultimately converge on the persisted blueprint contract.
- **Why this is debt:** The overlap can drift as blueprint semantics expand, but it is not currently a second executor and did not block the accepted generic construction campaign.
- **Activation gate:** Two frontends produce observably inconsistent semantics, or a required blueprint-contract change would otherwise need duplicate normalization/validation logic.
- **Correct repair shape:** Consolidate only the shared compiler/normalization boundary while preserving deterministic templates and model-authored custom designs as separate inputs.
- **Exit criteria:** All affected frontends emit one validated blueprint schema with unchanged accepted gameplay behavior.
- **Do not solve by:** Deleting working templates, routing every build through the model, or starting a standalone construction-framework rewrite.

### TD-PLAN-001 — Prerequisite selection still contains fixed ranking policy

- **Priority/status:** P1, deferred and activation-gated.
- **Evidence:**
  - `src/agent/runtime/prerequisite-planner.js:294-300` gives fixed bonuses to several source-block families.
  - `src/agent/runtime/prerequisite-planner.js:314-330` assigns regex-based acquisition costs by item family.
  - `src/agent/runtime/prerequisite-planner.js:391-424` combines live inventory, one-step production, proximity, learned outcomes, and fixed cobblestone/plank bonuses when ranking recipes.
- **Why this is debt:** These hints repaired real bad choices and are not item-specific routes, but their fixed costs are only estimates. As capabilities widen, they can rank a theoretically cheap source above a materially easier live alternative.
- **Activation gate:** The same broad goal repeatedly chooses an inferior viable source or recipe despite available live distance, inventory, or outcome history proving a better candidate.
- **Correct repair shape:** Improve one shared cost/ranking input from registry facts and observed execution outcomes; retain deterministic tie-breaking and bounded search.
- **Exit criteria:** The unchanged broad request selects the materially better candidate and completes without a target-specific route or recipe table.
- **Do not solve by:** Removing all heuristics at once, teaching one recipe at a time, or adding an unconstrained general planner.

### TD-LEARN-001 — Runtime learning influences source ranking but not acquisition strategy

- **Priority/status:** P1 capability-engine debt, confirmed and activation-gated; not an immediate architecture rewrite.
- **Observed evidence:**
  - `bots/MindcraftBot/runtime-memory.json` contains accumulated outcomes for 52 method identities.
  - Reported lifetime examples include `collect:iron_ore->raw_iron` at 427 attempts, 16% success, and roughly 90 minutes; `collect:oak_log->oak_log` at 129 attempts, 22%, and roughly 21 minutes; and `smelt:raw_iron->iron_ingot` at 73 attempts, 34%, and roughly 25 minutes. Simple crafting methods are reported at 100% and near-instant.
  - `learnedPreference()` in `src/agent/runtime/prerequisite-planner.js` clamps remembered preference to ±12 and feeds candidate ranking. It cannot declare the current method unsuitable or bind a structurally different strategy.
- **Risk:** Re-ranking can repeatedly select the least-bad candidate inside a strategy that is producing no verified progress. Collection can therefore dominate unattended wall-clock time without producing a meaningful method change.
- **Validation required before implementation:**
  1. Confirm whether one recorded attempt is a candidate block, plugin invocation, bounded capability action, retry, or complete acquisition subgoal.
  2. Confirm whether verified partial inventory progress is classified as failure.
  3. Separate recent current-code behavior from historical code, contaminated worlds, and other bot identities.
  4. Confirm method identities remain stable and compare genuinely equivalent executions.
  5. Prioritize no-progress duration, verified requested output per minute, and repeated identical failure signatures over raw lifetime percentages; use attempt count only as exposure/confidence.
- **Smallest coherent repair contract:** Give genuinely different existing acquisition approaches stable strategy identities. At the capability/planner binding seam, use enough recent comparable no-progress evidence to exclude the failing strategy temporarily for the current goal/region and bind another existing deterministic strategy. Never turn the threshold into another identical retry or relocation. If no alternative exists, report that gap truthfully. Preserve productive-versus-recovery budgets, cancellation ownership, Paper verification, and the frozen hybrid architecture.
- **Activation gate:** Implement when a broad collection-heavy scenario demonstrates repeated no-progress behavior and at least two real strategies are bindable, or when two such strategies otherwise become available to the planner. Until then, use the statistics only to prioritize shared collection work.
- **Exit criteria:** The activating broad request changes to a genuinely different deterministic strategy after bounded comparable no-progress evidence, then either makes verified progress or reports that no alternative exists without consuming the goal budget on identical attempts.
- **Explicit non-goals:** No telemetry dashboard, new director, generalized world-state/learning framework, automated policy based directly on unvalidated lifetime percentages, or refactor of the arbiter lane cascade.

### TD-INV-001 — Inventory retention is not derived from active work

- **Priority/status:** P1, deferred and activation-gated.
- **Evidence:** `overflowKeepCount()`, `overflowPriority()`, and `selectDisposableWorkingSlotStack()` in `src/agent/library/skills.js:8366-8412` encode role and item-family retention/disposal rules directly.
- **Why this is debt:** The rules are bounded safety policy and have enabled real campaigns, but they cannot know every material, tool, by-product, or intermediate required by the current prerequisite plan or persisted work order.
- **Activation gate:** A broad goal discards a required item, preserves irrelevant inventory until capacity blocks progress, or cannot free a slot despite a clearly safe option.
- **Correct repair shape:** Protect quantities referenced by the active plan/work-order manifest first, then apply the existing survival and value safeguards as fallback policy.
- **Exit criteria:** The reproduced broad request frees capacity without losing required materials, requested output, survival equipment, or resumable progress.
- **Do not solve by:** A speculative storage controller, universal item-value ontology, or arbitrary timed reservations.

### TD-INTENT-001 — Direct craft and smelt phrases can bypass durable planning

- **Priority/status:** P1 semantic debt, deferred until natural language exposes it.
- **Evidence:** `src/agent/player-directives.js:326-357` routes recognized smelt/craft phrasing directly to `!smeltItem` or `!craftRecipe`, while compound acquisition outcomes elsewhere use GoalDirector and the prerequisite planner.
- **Why this is debt:** A genuine one-shot instruction using carried inputs should stay cheap. The same imperative wording can also express a durable desired outcome whose prerequisites, interruption, persistence, and verified completion belong to GoalDirector.
- **Activation gate:** A broad natural request is misrouted, fails only because prerequisites are absent, or reports terminal success/failure without the durable outcome lifecycle the player intended.
- **Correct repair shape:** Make the semantic distinction explicit: immediate transformation of already-carried inputs remains a deterministic command; an outcome that requires acquisition or persistence routes through the existing typed goal path.
- **Exit criteria:** The activating natural request chooses the correct lane, completes physically, and does not regress the cheap one-shot command.
- **Do not solve by:** Phrase-specific recipe routes, sending all commands through the model, or removing direct deterministic mechanics.

### TD-FOOD-001 — Canonical food identities drifted from Paper 1.21.11

- **Priority/status:** Closed at `0f465fe`.
- **Original defect:** Active cooking, job-upkeep, family, hunting, and animal-source paths used nonexistent `raw_beef`, `raw_chicken`, and peer identifiers; beef output was also named `steak` instead of `cooked_beef`.
- **Resolution:** `src/utils/food-semantics.js` now derives cooking transforms from the versioned generated smelting catalogue and connected registry, owns canonical food-animal drop facts, and fails closed on stale names. Unsafe/tactical food choices remain policy in their existing consumers.
- **Verification:** Current `minecraft-data` accepted canonical inputs and rejected stale aliases; focused food/legacy lookup checks and 27 adjacent Builder/JobDirector checks passed.
- **Reopen gate:** A supported Minecraft version changes canonical food, loot, or cooking identities without the connected-registry boundary rejecting or adapting them.

### TD-PLAN-002 — Recursive preparation helpers remain parallel prerequisite engines

- **Priority/status:** P1, confirmed by a bounded center-out audit; migrate only as an activating broad campaign reaches a caller.
- **Evidence:**
  - `prepareTool()` in `src/agent/library/skills.js` recursively acquires planks, sticks, crafting tables, tool tiers, cobblestone, furnace/fuel, iron, diamonds, crafting, and equipment inside one opaque physical action.
  - `prepareMaterial()` separately plans planks, cobblestone, dirt, sticks, coal, tools, and torches.
  - Exact-item GoalDirector and mixed-material blueprint Builder paths already call `buildPrerequisitePlan()` and dispatch typed capabilities one at a time with persistence and verification.
  - Miner, Lumberjack, autonomous progression, food bootstrapping, farming, Nether-ramp preparation, family goals, and compatibility commands still reach the recursive helpers.
- **Why this is debt:** The helper action owns planning, recovery, and multiple physical operations below the director checkpoint. Its internal partial sequence is not visible as typed capability progress, even though the central planner now derives the same item graph from the connected registry.
- **Correct repair boundary:** Migrate the owning director/reducer to request and persist the central planner's next capability. Do not make a running ActionManager action recursively dispatch another capability plan.
- **Activation gate:** A broad role, progression, food/farm, travel, or family-outcome campaign reaches one of these callers, or an opaque helper failure prevents causal reassessment.
- **Exit criteria:** The activating caller sequences central capabilities with unchanged Minecraft behavior and restart/Stop ownership; only then may its old recursive branch become a compatibility adapter or be retired when no callers remain.
- **Do not solve by:** A whole-repository caller sweep, deleting public compatibility commands before equivalence is proven, or moving the same recursive graph into a new wrapper.

### TD-PLAN-003 — Planning-only proximity scans could starve the runtime

- **Priority/status:** Closed at `cad4bf3` after the broad functional-workshop campaign reproduced the failure.
- **Original defect:** Planning one missing torch performed 230 synchronous `findBlock` calls across 63 unique block types, repeatedly scanning radius 64. The Node event loop stopped servicing the live connection long enough for Paper to time the bot out after 39 verified blueprint cells.
- **Resolution:** One prerequisite-planning pass now caches proximity results by block type and range and caps planning-only probes at radius 16. Candidate ranking still sees nearby live materials, while the selected physical collection capability retains the original range 64 and remains responsible for authoritative search and execution.
- **Verification:** An offline trace fell from 230 probes to 63 unique probes with no duplicate block/range pair and maximum planning range 16; the selected birch collection command retained range 64. The persisted live Builder then resumed, supplied its wood/charcoal/torch prerequisites, and completed the 72-cell workshop under Paper verification.
- **Reopen gate:** A broad goal again starves the event loop during planning, or the bounded perception cache causes a materially available source to be excluded rather than merely ranked later.

### Additional hard-coded semantics register

These items are deliberately recorded without scheduling a consolidation project. Each must be revalidated against current source and a real activating scenario before modification.

- **TD-TOOL-001:** Registry `harvestTools`/`canHarvest` should own eligibility; one equipment evaluator should own condition and deterministic preference; the prerequisite planner should own acquisition cost. Activate when a broad goal selects or prepares the wrong usable tool.
- **TD-DUR-001:** The repeated `max(16, ceil(maxDurability * 0.1))` reserve is a factual calculation with multiple consumers. Activate when one consumer disagrees about whether a tool remains usable, then centralize assessment while leaving context policy separate.
- **TD-MINE-001:** Registry facts should replace static drop/harvest claims; versioned world-generation knowledge may retain resource-depth facts; learned outcomes may rank regions. Activate on a wrong drop, tool, or search-region decision—not to modernize tables in isolation.
- **TD-SEM-001:** A small connected-registry/generated facts layer may answer factual traits. Safety, retention, salience, pickup, and risk remain separate policies. Activate only when local classifiers contradict one another in a broad scenario; never create `GameKnowledgeGodObject.js`.
- **TD-WORK-001:** When the functional workshop needs a station, bind in bounded order from explicit player constraint, reachable world station, remembered station, carried station, then planner-derived temporary station. Do not prebuild a workstation framework.
- **TD-PROG-001:** Preserve high-level autonomous milestones and the command permission whitelist. When progression is the active broad lane, replace one embedded recipe step with the central planner rather than deleting the whole ladder.
- **TD-THREAT-001:** Consolidate entity traits only after a reproduced contradiction; reflex combat, survival, observation, and avoidance may legitimately assign different policy weights.
- **TD-FARM-001:** Add one versioned crop/mechanic descriptor only when a broader farming request introduces a second crop/mechanic path that would otherwise duplicate facts.
- **TD-BUILD-004:** Resolve accessory material families only when a real construction request needs substitution. Existing concrete template defaults remain legitimate declarative content.

### TD-CAP-001 — Capability catalogue breadth and binding depth

- **Priority/status:** P1, active through functional slices only.
- **Evidence:**
  - `src/agent/runtime/capability-catalogue.js:168-311` registers only `collect_wood`, `collect_block`, `craft`, `smelt`, and `equip`.
  - `src/agent/runtime/capability-catalogue.js:185-190`, `217-222`, `244-249`, `274-279`, and `303-308` show that current binders primarily create deterministic command strings.
  - `src/agent/runtime/capability-catalogue.js:317-340` binds once during plan-action construction.
  - `src/agent/runtime/capability-catalogue.js:358-390` correctly rechecks preconditions, rebinds against fresh state, executes, and verifies at dispatch time.
  - `docs/plans/2026-08-03-hybrid-companion-forward-plan.md:29-78` defines the intended typed contract and lists future workstation, drop-retrieval, and delivery capabilities.
- **Why this is debt:** The contract exists, but concrete source selection, safe stance choice, workstation access, pickup, and portions of recovery can still be hidden behind an opaque command. That prevents GoalDirector from consistently receiving typed target identity and binding failure information.
- **Risk if ignored:** New player outcomes can accumulate item-specific planner branches or nested strategy loops inside physical skills, recreating the implicit boundary the catalogue is intended to eliminate.
- **Correct boundary:** The planner chooses a legal symbolic operation. A binder selects a concrete live target/stance/tool/workstation without taking control. The existing deterministic adapter executes under ActionManager. Minecraft state verifies the effect.
- **Activation gate:** A real player request reaches an operation whose hidden target/prerequisite decision prevents prompt replanning or produces repeated indistinguishable failure.
- **Exit criteria:** The affected operation has a catalogue entry with typed arguments, concrete binding identity, structured failure, deadline/signal propagation, authoritative verification, and a successful physical acceptance scenario.
- **Do not solve by:** Adding item-specific routes, creating a second planner/executor, symbolically modeling every movement cell, or building the entire future catalogue in advance.

### TD-CAP-002 — Capability failures lose causal recovery information

- **Priority/status:** P1, confirmed contract gap; repair when the next catalogue-backed live failure reaches it.
- **Evidence:**
  - `src/agent/runtime/capability-catalogue.js:347-355` creates every capability failure with `retryable: true` and evidence containing only the outcome code.
  - `src/agent/runtime/capability-catalogue.js:364-398` uses that same shape for unknown capability, missing precondition, binding failure, and arbitrary execution exception.
  - `src/agent/runtime/goal-director.js:814-821` charges most failed plan operations against the productive-attempt budget.
  - `src/agent/runtime/goal-director.js:891-906` sends any retryable failure into recovery while budget remains.
  - `docs/plans/2026-08-03-hybrid-companion-forward-plan.md:53-63` requires distinct failure categories plus concrete target/prerequisite, verified progress, retryability, timing, and stable identity.
- **Why this is debt:** A configuration/programming error such as an unknown capability is not retryable world failure. A stale precondition should usually trigger reassessment, while a concrete binding failure should identify the rejected target. Collapsing all cases into the same retryable record can spend productive attempts without changing the plan.
- **Risk if ignored:** Repeated identical failures can exhaust a durable goal while failed-target memory remains empty, recreating the shield/raw-iron recovery pathology at the catalogue boundary.
- **Correct boundary:** Each capability outcome supplies a stable failure signature, category-specific retryability, concrete target or missing prerequisite, before/after progress, elapsed/remaining time, and settlement state. GoalDirector decides strategic recovery from those fields.
- **Activation gate:** The next live capability failure lacks enough identity to exclude a target, distinguish a prerequisite, or decide whether retry is legal.
- **Exit criteria:** A physically induced binding/precondition/execution failure produces the required structured fields and causes prompt target/strategy change without consuming the entire productive budget on an unchanged signature.
- **Do not solve by:** Strategy-driving regex over error strings or embedding GoalDirector recovery rules inside the catalogue.

### TD-PHY-001 — Physical execution concentration in `skills.js`

- **Priority/status:** P1, incremental; never a standalone rewrite.
- **Evidence:**
  - `src/agent/library/skills.js` is currently 13,682 lines.
  - `src/agent/library/skills.js:8526-8582` owns navigation policy, cancellation hookup, stall timing, shallow-water recovery, and Pathfinder dispatch in one path.
  - `src/agent/library/skills.js:9790-9801` now correctly delegates locomotion through an already-cleared tunnel cell to native Pathfinder.
  - `src/agent/library/skills.js:9804-9810` begins a separate deterministic excavation mechanic in the same module.
  - Direct controls remain at `src/agent/library/skills.js:5780-5783`, `11543-11556`, and `12570-12633` for bounded portal, shoreline/emergency, jump, or sneak mechanics.
- **Why this is debt:** File size alone is not the defect. The debt is the co-location of unrelated mechanics with target selection, safety policy, local recovery, cancellation cleanup, and evidence formatting. A change to one mechanic has an unnecessarily broad regression surface.
- **Risk if ignored:** Fixes become local compensations, shared invariants diverge, and reviewers cannot easily determine whether policy belongs to the planner, binder, package, or physical adapter.
- **Correct boundary:** Extract only a cohesive mechanic already being changed, preserve the public command surface, keep ordinary locomotion in the owned Pathfinder package, and keep strategic replanning in GoalDirector.
- **Activation gate:** A live blocker requires material changes within one cohesive skills domain, or two confirmed defects require the same shared helper/invariant.
- **Exit criteria:** The touched domain has a stable adapter boundary, unchanged command behavior, the same ActionManager ownership, and a physically verified outcome. Line-count reduction is not an exit criterion.
- **Do not solve by:** Empty wrapper modules, a wholesale split by arbitrary line ranges, a second navigation engine, or a long refactor before rerunning Minecraft.

### TD-DEP-001 — Owned runtime and installed dependency graph are not yet reproducible as one stack

- **Priority/status:** P1, active migration debt; sequence through the existing owned-runtime plan.
- **Evidence:**
  - `.gitignore:4` explicitly ignores `package-lock.json`, and no npm, pnpm, or Yarn lockfile exists at the repository root.
  - `package.json:21-27` still installs registry Mineflayer, CollectBlock, Pathfinder, PvP, and Tool packages; several are semver ranges.
  - `package.json:46` reapplies package patches after every installation.
  - `src/utils/mcdata.js:5`, `src/agent/library/world.js:1`, and `src/agent/library/skills.js:3` bypass package resolution and import the owned Pathfinder through relative repository paths.
  - `npm ls --all` on this snapshot reports registry `mineflayer-pathfinder@2.4.5` beside the owned source, and `mineflayer-pvp -> mineflayer-utils@0.1.4 -> mineflayer@2.41.0` beside the root `mineflayer@4.37.1`.
  - `packages/minecraft-runtime/mineflayer-pathfinder` has no `UPSTREAM.md`, imported-source record, or artifact checksum.
  - `docs/plans/2026-08-03-owned-runtime-dependency-strategy.md:211-234` requires workspace resolution, a committed root lockfile, one Mineflayer/Pathfinder graph, source provenance, checksums, and parity/live evidence.
- **Why this is debt:** The bot currently mixes an owned Pathfinder used by project code with registry package graphs used or declared by plugins. With no committed lock, a fresh install can select different transitive versions or a version that no longer matches a `patch-package` filename.
- **Risk if ignored:** “Works on this node_modules” can diverge from a clean reinstall; plugin code may bind to a different Pathfinder or legacy Mineflayer instance; rollback and attribution remain ambiguous.
- **Correct boundary:** Complete one owned-package tranche at a time using exact workspace resolution, compatible peer dependencies, a committed complete lockfile, provenance, and live parity. Preserve the registry patch until the corresponding owned mechanic proves parity.
- **Activation gate:** Before claiming reproducible V2 installation, moving another mechanic into owned packages, or modifying the dependency graph.
- **Exit criteria:** A clean independent install resolves exactly one intended Mineflayer and Pathfinder runtime, all owned sources are pinned/provenanced, package patches apply deterministically or are explicitly retired after parity, and the unchanged physical acceptance scenario passes.
- **Do not solve by:** Deleting patches early, sharing the frozen control's `node_modules`, upgrading packages wholesale, or publishing upstream.

### TD-IO-001 — Synchronous durable-state writes on the event loop

- **Priority/status:** P2, conditional on measurement or a reproduced responsiveness failure.
- **Evidence:**
  - `src/utils/atomic-file.js:14-33` performs synchronous open, write, `fsync`, close, and rename.
  - `src/agent/runtime/goal-director.js:90-99` invokes that path for goal persistence.
  - `src/agent/runtime/job-state-store.js:41-49` invokes it for work-order persistence.
  - The same utility is used by additional memory, configuration, and runtime stores; those are not necessarily hot paths.
- **Why this is debt:** Goal and job state may transition on the same JavaScript event loop that processes Mineflayer packets and arbitration. A durable filesystem flush can pause that loop.
- **Risk if ignored:** On slower or heavily contended storage, state transitions can create observable movement, packet, or response stalls.
- **Required evidence:** Measure event-loop delay and write duration during a real persisted goal. Static presence of `fsyncSync` is not proof of a material gameplay stall.
- **Measured 2026-08-10 (`node tools/measure-persistence-cost.mjs`, win32, NVMe C:):** one 2KB persist blocks the loop for a median of **1.03ms**. At the arbiter's ~180ms cadence a typical single-persist tick blocks **1.77ms** (1.0% of wall clock, 3.5% of a 50ms Minecraft tick); a heavy tick modelled as 12 persists blocks **13.5ms** (7.5% of wall clock, 26.9% of a Minecraft tick). A 256KB write costs 3.8ms.
- **Verdict — the activation gate is NOT met.** The mechanism is real and the arithmetic in the record was right, but the magnitude assumed "tens of ms per write on slow or contended storage." On this machine fsync is ~1ms, so the worst modelled tick costs about a quarter of one Minecraft tick and the typical tick is negligible. **Priority lowered P2 → P3.** Do not migrate the stores to async, debounce the writer, or restructure persistence on this evidence: the map's own warning against changing every store to async indiscriminately applies, and the durability/resumption semantics being protected are worth more than 1.8ms.
- **Instrument caveat for whoever re-measures:** a synchronous fsync produces no separately-samplable loop lag — it *is* the lag. A `setInterval(1)` probe measures Windows' ~15.6ms timer granularity instead (its idle baseline reads higher than the write cases), and `monitorEventLoopDelay` returns NaN across a purely synchronous block. Both were tried and discarded before the direct measurement above.
- **Re-open gate:** Re-measure on the target hardware if the bot runs from spinning disk, a network share, or a heavily contended volume, or if a real session shows packet/movement stalls correlated with state transitions. The heavy-tick figure would become material somewhere around a 5-10x slower fsync.
- **Correct repair shape (if ever re-opened):** A serialized/coalesced writer with monotonic state ordering, atomic rename, explicit flush/checkpoint semantics, shutdown draining, and surfaced write failure.
- **Considered and rejected as a cheap win:** merging JobDirector's checkpoint persist (`job-director.js:1498-1500`) with its anchor persist (`:1510-1516`). They are separated by an early `continue` at `:1506`, so the checkpoint must commit for declarative steps that never reach the anchor write. Merging would restructure checkpoint durability across that branch to save ~1.1ms. Not worth the resumption risk.
- **Exit criteria:** Durability/restart tests still pass, shutdown flush is verified, and measured event-loop stalls materially decrease in the real runtime.
- **Do not solve by:** Removing durability, fire-and-forgetting promises, allowing old state to overwrite new state, or changing every store to async indiscriminately.

### TD-PROV-001 — Missing provider client timeouts

- **Priority/status:** P2, confirmed and bounded.
- **Evidence:**
  - `src/models/gpt.js:18-36` correctly extracts `timeout`/`timeout_seconds` from request parameters and converts the value into the OpenAI client timeout.
  - `src/models/openai_compatible.js:23-47` leaves those settings in `requestParams` and creates the client without a timeout.
  - `src/models/openai_compatible.js:58-68` spreads remaining parameters into the completion request body.
  - `src/models/qwen.js:7-16` creates its client without a timeout, while `src/models/qwen.js:23-34` spreads all parameters into the request body.
- **Why this is debt:** Transport timeout is a client concern. Treating it as a generation parameter means a stalled provider can hold the model turn far longer than the bot's responsiveness contract permits.
- **Correct boundary:** Normalize provider transport settings once, pass them to the SDK client, and keep only model-generation parameters in request bodies.
- **Activation gate:** Schedule as a small provider-reliability tranche, or immediately if either adapter is used by the active profile and a request stall is reproduced.
- **Resolution (2026-08-10, uncommitted):** Both adapters now destructure `{ timeout, timeout_seconds, ...bodyParams }` and set `config.timeout` in milliseconds, matching the `gpt.js` precedent. Generation parameters still reach the request body unchanged. **No default timeout was invented** — an unset timeout keeps the SDK default, deliberately, because a slow local Ollama generation is legitimate and a speculative 120s cap would abort it. Configuring a bound is a profile decision.
- **Verification:** `tests/control-plane/reliability-tranche.test.js` asserts a configured 45s reaches the client, is removed from the body, and that no timeout is invented when unset. Both checks fail against the pre-fix adapters.
- **Live probe run 2026-08-10 — it failed, and found a second defect.** Against a real black-holed TCP endpoint and the real OpenAI SDK, a configured 3s bound settled in **10,460ms**. The client timeout was correct; the OpenAI SDK simply retries a timed-out request twice by default, so the effective bound was silently tripled. A profile asking for 12s was really asking for ~36s of a motionless bot, which is still the stall this record exists to remove.
- **Second repair:** All three adapters now set `maxRetries: 0` whenever a timeout is configured, and accept an explicit `max_retries`/`maxRetries` to override. Rationale: `FallbackRouter` already owns failover to another provider, so SDK-level retry is redundant here rather than protective. Re-measured: **3,015ms** against a configured 3s bound.
- **Reproduce with:** `node tools/verify-provider-transport.mjs` (no Paper world, no live credential).
- **Exit criteria:** A black-holed local endpoint rejects within the configured bound, normal requests remain compatible, and fallback/backoff receives the timeout as a structured failure. — **met and measured.**
- **Do not solve by:** A general provider framework or consolidating semantically different providers at the same time.

### TD-MODEL-001 — Model lifecycle operations do not reach every configured provider

- **Priority/status:** P2, confirmed.
- **Evidence:**
  - `src/models/prompter.js:175-184` constructs distinct reasoning, memory, triage, and autonomy model routes.
  - `src/models/prompter.js:226-234` preflights only chat, code, vision, and embedding models.
  - `src/models/prompter.js:258-280` likewise cancels/disposes only those four models, omitting the specialist routes.
  - `src/models/fallback-router.js:42-131` implements request routing and status but exposes no `preflight`, `cancelPending`, or `dispose` forwarding to its child models.
  - `src/models/codex.js:802-845` does implement meaningful cancellation/disposal, proving that omission at the router/Prompter layer has an observable effect.
  - `src/agent/agent.js:572-583` requests model cancellation on Operator Stop, but that call can reach zero underlying jobs for omitted or routed models.
- **Why this is debt:** Lifecycle ownership stops at wrapper objects instead of reaching the provider job that owns network/process resources. A stopped autonomy turn can continue consuming time or credits, and a specialist Codex app-server can outlive Prompter disposal.
- **Risk if ignored:** Operator Stop may prevent later physical execution but still pay for discarded inference; shutdown can leak specialist provider resources; preflight may report readiness without checking the actual routed provider.
- **Correct boundary:** Every model wrapper forwards idempotent `preflight`, `cancelPending`, and `dispose` to each unique child. Prompter owns one complete set of every configured model, including specialists and routers.
- **Activation gate:** Before claiming universal Operator Stop cancellation or when specialist/routed providers are used by the active profile. — **Gate was already met:** `profiles/local-quickstart.json`, the profile named by `launcher-config.json`, declares `model` as a two-entry array plus `reasoning_model`, `autonomy_model`, and `memory_model`. This was a live defect on the running configuration, not a latent one.
- **Additional evidence found 2026-08-10 (worse than recorded):** `FallbackRouter` implemented **none** of `preflight`, `cancelPending`, or `dispose`. Because `buildModel()` returns a router whenever a key names several providers, `model.cancelPending?.()` optional-chained to `undefined` even for the four routes that *were* enumerated. On the active profile `cancelPendingModelGeneration()` therefore returned 0 and `dispose()` disposed nothing — the omission was total, not partial.
- **Resolution (2026-08-10):** `FallbackRouter` gained `leafModels()`, which flattens nested routers into a de-duplicated leaf set, plus `preflight`/`cancelPending`/`dispose` built on it. `Prompter` now flattens all eight routes (the four general plus reasoning, memory, triage, autonomy) to unique leaves and drives lifecycle from that set, so a provider reachable through five routes is still handled once. Preflight deliberately keeps the general routes fatal and treats specialist-only leaves as non-fatal with a warning, because `withChatBackstop` exists so a specialist degrades to the chat model rather than failing startup.
- **Verification:** `tests/control-plane/model-lifecycle.test.js` — five checks covering router forwarding, nested-router flattening, exactly-once cancellation across the real `local-quickstart` route shape, specialist disposal, and repeat-dispose idempotency. Four fail against the pre-fix code.
- **Exit criteria:** Injected child providers prove exactly-once lifecycle forwarding — **met**. The second half (an actual in-flight specialist generation cancelled and settled) is **not met and cannot be met at this boundary**; it now depends on TD-MODEL-002.
- **Do not solve by:** Killing the whole agent process for ordinary cancellation or assuming an ignored response means the provider request was cancelled.

### TD-MODEL-002 — No OpenAI-family adapter can abort an in-flight generation

- **Priority/status:** P2, confirmed; exposed while closing TD-MODEL-001's plumbing.
- **Evidence:** A repository-wide search for `cancelPending(` across `src/models` returns exactly one implementation, `src/models/codex.js:802`. `gpt.js`, `openai_compatible.js`, `qwen.js`, and the other OpenAI-shaped adapters implement none, and construct requests without an `AbortSignal`.
- **Why this is debt:** TD-MODEL-001 guarantees Operator Stop now *reaches* every configured provider. On `local-quickstart.json` every leaf is an `api: openai` model, so each reached leaf has no `cancelPending` and the call is still a no-op. The agent stops issuing new actions, but the in-flight generation runs to completion and is paid for.
- **Why it was invisible before:** With the plumbing broken, the cancellation count was zero for a *routing* reason, which masked the fact that it would also be zero for a *capability* reason.
- **Correct boundary:** Each adapter owns an `AbortController` per in-flight request, passes the signal to the SDK call, and `cancelPending()` aborts and returns the number of aborted jobs. The router/Prompter forwarding built for TD-MODEL-001 already delivers the call.
- **Activation gate:** Before claiming Operator Stop halts model spend, or when a stop is observed to be followed by a late-arriving action.
- **Resolution (2026-08-10):** New `src/models/cancellation.js` owns `ModelCancelledError`, an `isCancellation()` predicate covering our error, the OpenAI SDK's `APIUserAbortError`, a raw `AbortError`, and the Codex `CANCELLED` code, plus a `PendingRequests` controller registry. `gpt.js` (both the chat-completions and Responses paths), `openai_compatible.js`, and `qwen.js` each register an `AbortController` per request, pass its signal to the SDK, release it in `finally`, and expose `cancelPending()`.
- **The trap this had to avoid:** Every one of those adapters answers a failure by *returning* `'My brain disconnected, try again.'`, and `isFailedResponse()` treats that sentinel as a dead provider. Had cancellation been reported the usual way, `FallbackRouter` would have penalized the aborted provider and run the same generation on the next one — a stop that *starts* work, strictly worse than the previous no-op. Cancellation therefore throws, and `FallbackRouter.sendRequest`/`embed` check `isCancellation()` **before** the transport test, since some abort messages contain words the transport pattern matches.
- **Caller settlement:** `self_prompter.js` now breaks its loop on a cancelled turn instead of charging it to `failure_count`. Otherwise a few Operator Stops would push a later healthy goal closer to its `MAX_FAILURES` pause threshold, and the failure backoff would delay a stop already in progress.
- **Verification:** `tests/control-plane/model-cancellation.test.js` — six checks, four of which fail against the pre-fix adapters. They cover the abort itself, controller release on the success path, repeat-safe `cancelPending()`, predicate coverage across every provider error shape, and — the important one — that cancelling a router's in-flight generation leaves the fallback provider with **zero** starts.
- **Lint scope note:** `gpt.js` and `qwen.js` could not previously be linted at all; `eslint.config.js` gave the base scope `ecmaVersion: 2021`, which cannot parse their `static prefix = …` class fields. They are now in the Node scope alongside `openai_compatible.js`, and the four legacy style errors that surfaced in `gpt.js` were ratcheted. This is a small down payment on TD-TEST-001, not a resolution of it.
- **Live probe run 2026-08-10 — it failed, and the mocked tests were why.** Against a real endpoint the SDK threw `APIUserAbortError`, `isCancellation()` returned false, and the adapter returned the `'My brain disconnected'` sentinel anyway. Cause: `APIUserAbortError extends APIError extends Error` and never assigns `this.name`, so the *instance* name is `'Error'` and only the *constructor* is named `APIUserAbortError`. The unit test had built that error by hand with `name = 'APIUserAbortError'` and therefore asserted the author's assumption rather than the SDK's behaviour.
- **Second repair:** The adapters no longer infer cancellation from error shape at all. Each owns its `AbortController`, so `controller.signal.aborted` is the authoritative answer to "did we abort this?" — checked first, with `isCancellation()` retained as a fallback for aborts arriving from elsewhere. `isCancellation()` additionally checks `constructor.name` and the abort message. The unit test now instantiates the **real** `APIUserAbortError` and asserts `instance.name === 'Error'`, pinning the assumption that was wrong.
- **Measured after repair:** a stop during a real in-flight request settled in 762ms as a cancellation, and the underlying TCP socket was observed closing — the difference between aborting a request and merely discarding its answer.
- **Reproduce with:** `node tools/verify-provider-transport.mjs`.
- **Coverage inventory (swept 2026-08-10).** Cancellation reaches 4 of 19 adapters. **Safe:** `gpt.js`, `openai_compatible.js`, `qwen.js`, `codex.js`. **Still uncancellable — 8 OpenAI-SDK shaped, where the existing fix applies verbatim:** `deepseek.js`, `glhf.js`, `grok.js`, `lmstudio.js`, `mercury.js`, `novita.js`, `openrouter.js`, `vllm.js`. **Still uncancellable — different SDKs, needing per-provider work:** `cerebras.js`, `claude.js`, `gemini.js`, `groq.js`, `huggingface.js`, `hyperbolic.js`, `mistral.js`, `ollama.js`, `replicate.js`.
- **Why this is not urgent today:** `profiles/local-quickstart.json` resolves every route to `api: openai` → `gpt.js`, which is covered. The gap bites only when a profile names one of the other providers — `ollama.js` and `lmstudio.js` are the realistic ones on this machine.
- **Trap for whoever extends this — read before touching another adapter.** Every one of those adapters answers a failure by *returning* `'My brain disconnected, try again.'`, and `FallbackRouter.isFailedResponse()` treats that string as a dead provider. Adding an `AbortController` **without** also throwing a typed cancellation would make Operator Stop penalize the aborted provider and run the same generation on the next one — a stop that starts work, strictly worse than today's no-op. The adapter must check `controller.signal.aborted` first and throw `ModelCancelledError`, exactly as the four safe adapters do.
- **Remaining before close:** The transport half is proven for the four covered adapters. The end-to-end half — an Operator Stop during live autonomous play producing no later action — still needs a Paper world and is untested. The 15 uncovered adapters were deliberately left alone: they are unused by the active profile and each needs its own credential to verify live, and this record's own evidence shows mock-only verification is not sufficient here.
- **Exit criteria:** A stop during a real generation aborts the HTTP request, settles it as a cancelled turn rather than an error, and produces no later action from the discarded response.
- **Do not solve by:** Discarding the response while letting the request run, or killing the agent process.

### TD-PROMPT-001 — Repeated prompt-assembly work

- **Priority/status:** P2, conditional on profiling.
- **Evidence:**
  - `src/models/prompter.js:285-392` expands prompt placeholders procedurally.
  - `src/models/prompter.js:311-317` reruns awareness and inventory commands whenever those placeholders occur.
  - `src/models/prompter.js:336-350` performs example selection and memory recall.
  - `src/models/prompter.js:526-546` runs the same expansion for autonomous turns.
  - `src/utils/examples.js:46-65` requests an embedding, mutates `this.examples` by sorting it, recomputes text keys inside the comparator, and deep-copies the selected examples.
- **Why this is debt:** Unchanged perception and conversation inputs can repeat world scans, transport calls, ranking, and allocation before provider inference begins.
- **Risk if ignored:** Increased model latency and spend; discarded autonomous generations can still pay the full assembly cost.
- **Required evidence:** Separate timings for awareness, inventory, example embedding/ranking, memory recall, provider inference, and total prompt assembly during actual play.
- **Correct repair shape:** Cache only against explicit revisions/keys, avoid mutating shared example order, and invalidate on the state that affects the placeholder. Preserve fresh state for deterministic decisions.
- **Exit criteria:** Measured prompt assembly improves without stale inventory/perception appearing in player-visible or decision-critical prompts.
- **Do not solve by:** Reducing canonical state fidelity, caching without invalidation, or optimizing this path while deterministic goal execution is the active blocker.

### TD-PROMPT-002 — Generation latches and loop promises are not failure-safe

- **Priority/status:** P2, confirmed.
- **Evidence:**
  - `src/models/prompter.js:491-504` sets `awaiting_coding = true` and clears it only on the success path. A failure in cooldown, prompt assembly, provider request, or pre-clear processing leaves every later coding request returning “Already awaiting.”
  - `src/agent/self_prompter.js:178-181` starts the async autonomy loop without awaiting or attaching a rejection handler.
  - `src/agent/self_prompter.js:433-451` repeats the same floating start during automatic restart.
  - `src/agent/self_prompter.js:296-419` has a `finally` that resets `loop_active`, but operations outside the inner provider catch—such as the periodic awaited history update at lines 400-404—can still reject the whole floating promise.
- **Why this is debt:** A transient provider, disk, or summarization failure can permanently disable a subsystem or surface as an unhandled rejection instead of a bounded failed turn.
- **Correct boundary:** Boolean ownership latches reset in `finally`; background loop entrypoints attach one terminal error sink that updates state and telemetry without recursively restarting.
- **Activation gate:** A bounded prompt/reliability tranche or any observed “already awaiting” state after a failed request.
- **Resolution (2026-08-10, uncommitted):** `promptCoding()` now holds `awaiting_coding` across a `try/finally`, so cooldown, prompt-assembly, provider, and log failures all release the latch. The latch now also covers `_saveLog`, which it previously did not — a slightly longer hold, but the latch is ownership of an in-flight request rather than a success flag. Both floating `startLoop()` launches (`self_prompter.js` start path and idle-restart path) now call `_startLoopGuarded()`, which sinks the rejection and resets `loop_active` — the `finally` alone could not, because a throw between `loop_active = true` and the `try` skips it.
- **Verification:** A focused check drives `promptCoding` through a provider failure and asserts the next request succeeds instead of returning “Already awaiting”; it fails against the pre-fix method.
- **Remaining before close:** The loop-restart half is code-only. Injected per-stage failure proof for the autonomy loop itself was not built, as that needs the broader async-state tranche.
- **Exit criteria:** Injected failures at each awaited stage clear the latch, record a bounded error, and allow a subsequent request/loop restart without an unhandled rejection.

### TD-LIFE-001 — Agent child process lacks graceful signal teardown

- **Priority/status:** P2, confirmed.
- **Evidence:** `src/process/init_agent.js:40-58` constructs and starts `Agent` but registers no SIGINT or SIGTERM handler.
- **Why this is debt:** An external stop can use Node's default termination instead of the agent's existing teardown sequence. That can bypass ActionManager settlement, bot shutdown, provider disposal, and final persistence.
- **Correct boundary:** The child entrypoint should translate one OS stop signal into one idempotent, time-bounded agent teardown; the launcher remains responsible for escalation if it does not settle.
- **Activation gate:** Schedule before claiming graceful dashboard/launcher stop semantics, or immediately after a reproduced uncontrolled termination.
- **Resolution (2026-08-10, uncommitted):** `installStopSignalHandlers()` registers `process.once` for SIGINT and SIGTERM after `agent.start()` resolves, guarded by a `stopping` flag, and routes both into the already-idempotent `agent.teardownAndExit(msg, 0)`. A 10s `unref`'d timer forces exit if teardown stalls, staying inside the launcher's 15s graceful window (`agent_process.js:76`).
- **Exit-code check:** Exit code 0 was chosen deliberately. `agent_process.js:386` classifies `stopRequested || code === 0 || signal === 'SIGINT'` as a graceful `stopped`/`retryable` transition, so the handler preserves the launcher's existing classification instead of turning a graceful stop into a crash-restart.
- **Remaining before close:** Not yet verified live. The exit criteria's dashboard-stop probe — tailing the agent log for `self prompt loop stopped` and the `Exiting.` chat line — requires a running Paper world and has not been run.
- **Exit criteria:** SIGINT and SIGTERM each invoke teardown once, settle or forcibly bound the physical action, close the bot, and exit within the launcher's grace period.
- **Do not solve by:** Indefinite signal waits or swallowing a second forced-termination signal.

### TD-ACT-001 — Unobserved rejection in action timeout callback

- **Priority/status:** P2, confirmed.
- **Evidence:** `src/agent/action_manager.js:646-654` passes an `async` callback to `setTimeout`; `await this.stop()` can reject, but no caller observes the callback's returned promise. `history.add(...)` at line 651 is also not awaited.
- **Why this is debt:** The error path intended to recover a long-running action can itself create an unhandled rejection, obscuring or worsening the original timeout.
- **Correct boundary:** The timer should trigger a separately guarded settlement routine whose errors are caught, recorded, and converted into an ActionResult/hard fault without releasing ownership prematurely.
- **Priority/status update:** Closed at the 2026-08-10 reliability tranche (uncommitted).
- **Resolution:** The timer callback is now a synchronous function wrapping a self-sinking async IIFE, so neither `this.stop()` nor anything else in the recovery path can escape as an unhandled rejection. `history.add(...)` keeps its original fire-and-forget timing — deliberately not awaited, so the force stop is not queued behind a model summarization call — but now carries its own `.catch`. Ordering of abort and stop is unchanged.
- **Verification:** A focused check fires the callback with both `history.add` and `stop()` rejecting, listens on `process.on('unhandledRejection')`, and asserts nothing escapes while `timedout` is still recorded. It fails against the pre-fix callback.
- **Activation gate:** A bounded ActionManager reliability tranche or any reproduced timeout-settlement failure.
- **Exit criteria:** Forced timeout with injected stop/history failure produces a bounded recorded failure and no unhandled rejection or overlapping action. — met.

### TD-MEM-001 — Landmark recall performs persistence

- **Priority/status:** P2, confirmed; performance impact requires measurement.
- **Evidence:** `src/agent/runtime/landmark-memory.js:241-273` prunes and verifies entries during `recall()`, then calls `this.save()` before returning results.
- **Why this is debt:** A read operation can mutate and synchronously persist the full store from prompt assembly. That hides write latency inside an apparently observational API.
- **Correct boundary:** Recall may mark invalid entries dirty, but persistence should occur through an explicit serialized/debounced flush or a separately owned mutation path.
- **Activation gate:** Confirm that recall-driven writes occur materially in active profiles, preferably while measuring TD-IO-001/TD-PROMPT-001.
- **Measured 2026-08-10 — the premise is substantially overstated.** Two corrections to the evidence this record and the 2026-08-03 audit rest on:
  1. **Store size.** The 256KB figure is `MAX_STORE_BYTES`, the cap, not observed data. Every real store on disk is **1.1KB or smaller** (`bots/*/landmarks.json`: 1.1, 1.1, 0.8, 0.3, 0.1 KB). The real write costs **1.10ms**, not the 4.29ms a capped store would.
  2. **Write frequency.** `save()` at `landmark-memory.js:143-144` early-returns unless `this.dirty`. A recall over an unchanged store performs **no write at all**. The audit's "hundreds of sync file writes per minute" assumed every recall flushes; only recalls whose prune/verify actually evicted something do.
- **Verdict:** The exit criterion "repeated reads do not repeatedly flush unchanged state" is **already satisfied by the existing dirty guard**. What remains is a design smell — a read API that can write — costing ~1.1ms on the rare dirtying recall. **Priority lowered P2 → P3.** The one-line audit fix (drop `save()` from `recall()`) is still defensible on API-shape grounds, but it is not a performance repair and should ride along with other landmark work rather than justify its own change.
- **Re-open gate:** A profile whose landmark store actually approaches the cap, or a measured prompt-assembly stall attributable to recall.
- **Exit criteria:** Recall remains self-healing in memory, persistence remains crash-safe, and repeated reads do not repeatedly flush unchanged state. — the third clause already holds.

### TD-HIST-001 — History mutation and summarization are not serialized

- **Priority/status:** P2, confirmed concurrency gap.
- **Evidence:**
  - `src/agent/history.js:148-166` mutates `turns`, removes a summary chunk, then awaits a provider-backed `summarizeMemories()` before appending the transcript.
  - `src/agent/history.js:96-105` replaces the single `memory` value with the result of that asynchronous summary.
  - Unawaited calls occur in `src/agent/agent.js:806`, `957-960`, `1023-1035`, and `1438`; `src/agent/conversation.js:58`, `118`, `237`, and `318-322`; and `src/agent/commands/actions.js:1630`.
  - `src/agent/action_manager.js:651` also launches an unobserved history addition from the timeout path.
- **Why this is debt:** `add()` performs its initial array mutation synchronously, so it appears safe in casual use. Once the threshold is crossed it yields during summarization. Another unawaited add can then splice and summarize a second chunk concurrently; whichever summary resolves last overwrites `memory`, and either rejection can be unhandled.
- **Risk if ignored:** Conversation order can be persisted inconsistently, older summaries can overwrite newer context, and model/disk failure can escape from unrelated command or timeout paths.
- **Correct boundary:** One serialized history mutation/summary queue per agent, with ordered commit, explicit error handling, and bounded shutdown flush. Callers that require the message before the next prompt await the operation; truly advisory callers use a named guarded enqueue API.
- **Activation gate:** Before relying on memory correctness during multi-bot conversation/autonomy, or after a reproduced history-summary/provider failure.
- **Exit criteria:** Concurrent injected adds preserve turn order and every summarized chunk exactly once; failure is recorded without wedging the queue; shutdown drains or reports the unflushed tail.
- **Do not solve by:** Making every chat path wait on an expensive model call without a queue, or swallowing summary failures silently.

### TD-JOB-001 — Unbounded completed work-order ID set

- **Priority/status:** P3, confirmed.
- **Evidence:**
  - `src/agent/runtime/job-director.js:604` creates `completedOrderIds` as an empty `Set`.
  - `src/agent/runtime/job-director.js:754` only adds completed IDs.
  - `src/agent/runtime/job-director.js:468-476` uses the set for deduplication.
- **Why this is debt:** Memory grows linearly with unique completed automatic work orders for the life of the process, while very old IDs have diminishing deduplication value.
- **Correct repair shape:** A bounded insertion-ordered set/ring with an explicit retention constant. Decide separately whether restart persistence is required; do not accidentally change job idempotency.
- **Priority/status update:** Closed at the 2026-08-10 reliability tranche (uncommitted).
- **Resolution:** `rememberCompletedOrder()` replaces the raw `Set.add` at the single completion site. A `Set` iterates in insertion order, so the first value is always the oldest id; re-completing a remembered id deletes and re-adds it so it refreshes rather than sitting near eviction. Retention constant `MAX_COMPLETED_ORDER_IDS = 256`. Restart persistence was deliberately **not** added — the record calls that a separate decision, and adding it would change job idempotency across restarts.
- **Verification:** Two focused checks: 300 completions leave exactly 256 entries with the newest retained and the oldest evicted; a refreshed id survives while the next-oldest is the one evicted. Both fail against the pre-fix code. `tests/control-plane/job-director.test.js` shows exact parity with HEAD (23 pass / 2 fail, the same two pre-existing failures before and after this change).
- **Activation gate:** Schedule with adjacent JobDirector work or before long unattended role campaigns.
- **Exit criteria:** Retention remains bounded and repeated current work is still suppressed correctly. — met.

### TD-SWARM-001 — Relocation does not settle the previous child process

- **Priority/status:** P2, confirmed; outside the current single-bot gameplay path.
- **Evidence:**
  - `src/mindcraft/swarm/swarm.js:188-203` returns the process-tree termination promise from `_killProc()`, but `Helper.relocate()` calls it without awaiting.
  - `src/mindcraft/swarm/swarm.js:168-177` leaves the periodic cycle timer active; the next tick may request a child at the new working directory.
  - `src/mindcraft/swarm/swarm.js:281-292` treats relocation as synchronous and immediately emits success/change events.
  - `src/mindcraft/mindserver.js:2526-2529` immediately reports successful relocation to the dashboard.
- **Why this is debt:** Logical ownership moves to the new location before physical ownership of the old process tree is confirmed released.
- **Risk if ignored:** Old and replacement helpers can overlap briefly, contend for files/resources, or make the dashboard report a completed relocation that is still terminating.
- **Correct boundary:** Relocation is an async state transition: suppress spawning, invalidate the generation, await bounded process-tree settlement, update location, then resume the cycle and publish success. Failure must leave an honest stopped/error state.
- **Activation gate:** Before relying on child-mode swarm relocation or after any overlapping-helper observation.
- **Exit criteria:** A delayed termination probe proves no replacement starts until the old tree settles, and the API callback reflects the final transition result.

### TD-ARB-001 — Potential duplicate `job.update()` calls per arbiter tick

- **Priority/status:** P2, conditional.
- **Evidence:** `src/agent/runtime/behavior-arbiter.js:648-658`, `701-724`, and `745-762` contain separate survival-job, player-job, command-policy, and role-work calls to `job.update()`.
- **Why this may be debt:** The lanes are semantically distinct, but some state combinations may allow more than one update during the same arbiter pass, repeating planning, inventory inspection, or persistence.
- **Why it is not yet confirmed:** Most selected lanes return early, and eligibility conditions may make the calls mutually exclusive in normal configurations.
- **Required evidence:** One per-tick counter recording eligible lane, work-order source, and number/duration of `job.update()` calls in a representative command bot and autonomous role bot.
- **Exit criteria:** Either disprove duplication and close the record, or ensure exactly one semantically correct update per tick without changing lane priority.
- **Do not solve by:** Reordering arbitration from static inspection alone.

### TD-AGENT-001 — Wide construction and lifecycle surface in `Agent.start()`

- **Priority/status:** P3, deferred.
- **Evidence:**
  - `src/agent/agent.js` is 1,482 lines and imports roughly forty modules.
  - `src/agent/agent.js:186-269` mixes identity normalization, component construction, memory loading, policy setup, command blacklisting, and Mineflayer creation.
  - `src/agent/agent.js:270-304` constructs JobDirector, GoalDirector, SurvivalDirector, ReactionDirector, observers, progression, agenda, optional memory/rules, and BehaviorArbiter.
- **Why this is debt:** Lifecycle changes have a wide blast radius, ordering dependencies are implicit, and constructing a reduced runtime requires extensive stubbing.
- **Important correction:** The individual directors are already unit-testable with controlled Agent-shaped objects. This is composition debt, not proof that every director needs an interface or rewrite.
- **Activation gate:** Two or more concrete lifecycle defects share construction order/criticality as their root cause, or a required runtime variant cannot be built safely with the current constructor.
- **Correct repair shape:** Extract a behavior-preserving composition helper around existing constructors and explicit critical/optional startup phases. Keep `Agent` as the runtime aggregate.
- **Exit criteria:** Startup/shutdown ordering is clearer, existing lifecycle behavior and tests pass, and no new service locator or parallel state container is introduced.

### TD-PROV-002 — Partial provider transport duplication

- **Priority/status:** P3, deferred and explicitly partial.
- **Evidence:**
  - `src/models/_model_map.js:12-35` dynamically discovers model classes.
  - `src/models/_model_map.js:37-60` lists provider-specific credential requirements.
  - `src/models/openai_compatible.js`, `qwen.js`, `novita.js`, `mercury.js`, and several other adapters use OpenAI-shaped chat-completion clients, but endpoint defaults, credentials, formatting, retry, embedding, and request semantics differ.
- **Why this is debt:** Compatible adapters repeat client construction and parameter normalization, allowing fixes such as timeout handling to diverge.
- **Correct boundary:** Share only proven transport-normalization code. Preserve small provider policy modules for authentication, endpoints, formatting, and special APIs.
- **Activation gate:** A second confirmed cross-provider defect requires the same transport change, or provider maintenance becomes an active product objective.
- **Exit criteria:** A directly compared compatible subset shares transport invariants with per-provider request/response parity tests; incompatible providers remain explicit.
- **Do not solve by:** Collapsing every provider into one class or changing discovery merely to reduce file count.

### TD-TEXT-001 — Repeated bounded-text normalization

- **Priority/status:** P2, confirmed localized defect; consolidation remains bounded.
- **Evidence:**
  - `src/agent/runtime/rule-engine.js:10-15` uses `.replace(/[ -]/g, ' ')`. Executing the complete helper proves that it converts a legitimate hyphen to a space and preserves NUL, ESC, and DEL bytes. Its following `\s+` replacement does correctly collapse newlines and tabs, so the defect is narrower than a test of the first replacement alone suggests.
  - `boundedText()` is used by `rule-engine.js:39`, `56`, `64`, `181`, and `199` for errors, warning telemetry, and removal lookup. Rule bodies are normalized separately by `src/agent/runtime/rules.js`; the defect is not evidence that raw control bytes are persisted in rule records.
  - `src/agent/runtime/rules.js:52-58` has a functionally correct control-character range encoded with literal binary control bytes in the source. That makes ordinary source search treat the file as binary and creates an avoidable tooling hazard even though the runtime expression works.
  - No focused test currently exercises the RuleEngine text boundary. ESLint accepts the malformed character class, so syntax/lint checks cannot establish the intended behavior.
  - Independent `boundedText`-style functions still appear in at least 13 files under `src/agent/runtime` and `src/mindcraft`, including `goal-director.js:34`, `agenda-director.js:37`, `work-order.js:39`, `behavior-arbiter.js:88`, `role-director.js:49`, and `squad-orchestrator.js:183`.
- **Why this is debt:** The RuleEngine has a directly proven primitive defect, and the larger family mixes three distinct policies—reject invalid text, sanitize telemetry, and canonicalize persisted values—without naming those contracts.
- **Correct boundary:** Repair the malformed RuleEngine primitive and replace literal binary source bytes with an equivalent escaped representation. Consolidate only helpers with identical reject/replace, whitespace, fallback, and length semantics; keep domain-specific validation explicit.
- **Activation gate:** The localized primitive repair is eligible at the next clean maintenance checkpoint. Wider consolidation activates only when a directly compared group has identical semantics or is already in one coherent tranche.
- **Severity was understated — this was a live functional defect, not text hygiene.** `rule-engine.js` `remove(id)` builds its lookup key with the corrupted helper, while `normalizeRule()` generates ids as `rule-<createdAt>-<sequence>` and default names as `<trigger> -> <action>`. Both contain hyphens, so the key could never equal the id it was derived from: `rule-1760000000000-3` became `rule 1760000000000 3`. **No rule created by the system could be removed by its own id or default name.** Byte inspection confirmed the origin: `rules.js:55` holds genuine raw `0x00`/`0x1f`/`0x7f` bytes, while `rule-engine.js` held literal ASCII space-and-hyphen — a copy whose control bytes were lost in transit. The absent `eslint-disable no-control-regex` in the copy is the corroborating tell; once the bytes were gone, the rule had nothing to flag.
- **Resolution (2026-08-10):** Both files now express the class as escaped Unicode sequences -- NUL through unit-separator, plus DEL -- instead of literal bytes. The replacement had to be generated from character codes, because several tool and shell layers reinterpret a typed escape: one attempt wrote raw control bytes back into the source, and another produced a double-escaped class matching a literal backslash. Anyone editing these lines should verify the resulting bytes rather than trust the rendering. `rules.js` behaviour is unchanged -- same class, different encoding. `rule-engine.js` behaviour changes only in that it now strips control characters and preserves hyphens, which is what it was always meant to do.
- **The tooling hazard, demonstrated:** mid-repair, `git diff -- src/agent/runtime/rules.js` emitted `Bin 7235 -> 7250 bytes` and `git apply` then refused it with "cannot apply binary patch without full index line". Git itself could not round-trip the file. That resolves once the escaped version is the committed blob.
- **Verification:** `tests/control-plane/rule-text-boundary.test.js` — eight checks covering removal by generated id, removal by default name, hyphen survival, NUL/ESC/DEL/BELL stripping, whitespace collapse, truncation at 48, generated fallbacks, and a non-match guard so the repair did not loosen removal into a fuzzy match. Three fail against the pre-fix source; the five covering `rules.js` pass both ways by design, pinning behaviour that must not change while the encoding does. A final sweep asserts no raw control bytes in either source **or in the test file itself** — writing that test reproduced the original corruption, because a regex literal typed as an escape reached disk as raw bytes.
- **Deliberately not done:** the ~13 other `boundedText`-style helpers were left alone, per this record's own "do not solve by". Only the proven-defective primitive and the binary-encoded sibling were touched.
- **Follow-through from the 2026-08-10 sweep.** A tree-wide byte scan found two more files carrying the class as literal bytes: `knowledge-store.js:33` and `player-memory.js:26`. Both were functionally correct (their classes did include DEL, unlike the corrupted `rule-engine.js` copy), so only the encoding changed and the exact character set was preserved. Four files have now held this construct and one of them was silently corrupted by a copy that lost the bytes, which meets ND-CI-001's bar of "a repeatedly violated, mechanically checkable invariant" — so the test guard was widened from two named files to the whole source tree.
- **Measurement caveat recorded for the next sweep:** a naive per-line scan reported 543 "raw control bytes" across `src/`. 185 of those were carriage returns from CRLF line endings and the rest was double-counting. The true figure was six bytes in two files. Tab, LF and CR must be excluded before any such count is believed.
- **Exit criteria:** Focused examples cover hyphens, whitespace, NUL/C0 controls, DEL, fallback, and truncation; search tooling reads `rules.js` as text; no persisted format or rejection policy changes unintentionally. — **met for the primitive.** The wider family consolidation remains open and unscheduled.
- **Do not solve by:** Mechanically routing every similarly named helper through one option-heavy utility.

### TD-TEST-001 — Incomplete lint/test gate membership

- **Priority/status:** P2, confirmed coverage gap requiring controlled rollout.
- **Evidence:**
  - `package.json:53-61` hand-enumerates the critical, behavior, and control-plane lint lanes. Their union covers 57 of 160 `src/**/*.js` files (35.63%); 103 source files (64.38%) are in none of those lanes.
  - Uncovered load-bearing files include `src/agent/action_manager.js`, `agent.js`, `conversation.js`, `self_prompter.js`, `library/skills.js`, `runtime/behavior-arbiter.js`, and `runtime/capability-catalogue.js`.
  - A read-only ESLint sample across six uncovered load-bearing files produced 30 errors. Seventeen were auto-fixable style findings, several `process` errors came from Node globals being assigned only to the current control-plane list in `eslint.config.js:6-26` and `64-74`, and `conversation.js:310` exposed a substantive floating-promise finding.
  - There is no single default `npm test` contract, but the existing focused, broad, live, and soak distinctions are intentional and should remain explicit.
- **Why this is debt:** Important production files can bypass static checks, while the current ESLint environment configuration is coupled to a hand-maintained membership list. This allows both real defects and configuration drift to remain hidden.
- **Why the obvious fix is unsafe:** Replacing the lists with a repository-wide blocking glob today would mix genuine findings with existing environment/style debt and could make slow or live test lanes implicit. The claim that this is a one-line, zero-risk repair is disproven by the sample run.
- **Correct repair shape:** First define correct browser/Node scopes independently of lane membership. Then introduce a cross-platform manifest or staged broad lint lane with an explicit baseline, preserve named focused/broad/live/soak test lanes, and ratchet newly touched files or newly introduced errors without silently auto-fixing unrelated source.
- **Activation gate:** A dedicated maintenance tranche after the current gameplay checkpoint; the confirmed floating-promise finding may be repaired sooner only within its owning async-state tranche.
- **Exit criteria:** Every production source file has an intentional lint disposition, Node/browser globals are scope-correct, new debt cannot enter uncovered files, and named test lanes remain deterministic on Windows and WSL.

### TD-DOC-001 — Verification evidence retention

- **Priority/status:** P3, deferred.
- **Evidence:** `docs/verification` currently contains 124 files. `docs/architecture/machine-brain-v2/README.md:33-42` already labels several older architecture documents as historical reference.
- **Why this is debt:** Without an explicit current/archive convention, readers can confuse historical evidence with binding architecture, and repository navigation becomes harder.
- **Correct repair shape:** Keep durable milestone summaries and reproducible evidence indexes; mark superseded evidence as historical or move it only under an explicitly approved retention policy.
- **Activation gate:** At a clean documentation checkpoint, not during gameplay repair.
- **Exit criteria:** Current decisions, historical evidence, and disposable runtime artifacts are clearly distinguished.
- **Do not solve by:** Bulk deletion, rewriting history, or treating document count as a product metric.

### TD-COORD-001 — Checkpoint marker drift

- **Priority/status:** Closed at documentation checkpoint `faec430`.
- **Original evidence:** The earlier marker named functional source commit `b8f17d1` while the active branch had advanced through source and uncommitted Pathfinder work.
- **Resolution evidence:** `d632d0e` and `faec430` update only `docs/coordination/CURRENT.md`. Its current lines 2-10 identify branch, functional source commit `a3d3427`, sole writer/runtime owner, owned subsystem, live blocker, last physical result, next campaign, and mailbox request. The active `HEAD` is `faec430`; the difference is intentionally documentation-only rather than unrecorded functional drift.
- **Closure rationale:** The marker now distinguishes the preserved functional source checkpoint from later coordination commits and contains the bounded handoff fields required by the protocol.
- **Reopen gate:** Reopen only if the marker again omits or materially misstates the preserved functional source, owner, blocker, next campaign, or mailbox state.

## Reviewed items that are not current debt

These records are deliberately retained to prevent recurrence of stale recommendations.

| ID | State | Evidence and rationale |
|---|---|---|
| ND-ARCH-001 | Rejected | The legacy/shadow/candidate adapter design in `docs/architecture/machine-brain-v2/BOUNDARY-CONTRACT.md` is historical. `docs/architecture/machine-brain-v2/README.md:33-42` already labels that document set non-binding and explicitly says it does not authorize restarting a broad architecture program. No implementation or deletion is required merely to clarify its status; the current boundary is the typed capability catalogue. |
| ND-TRACE-001 | Closed | Decision trace retention is bounded: defaults/caps are at `src/agent/runtime/decision-trace.js:1-9`, and the retaining helper evicts excess samples at `decision-trace.js:87-90`. Do not create a retention subsystem for it. |
| ND-PATH-001 | Closed for generic tunnel locomotion | `src/agent/library/skills.js:9790-9801` uses native Pathfinder with digging policy disabled to enter an already-cleared tunnel cell. Do not reintroduce hand-walking there. |
| ND-DIR-001 | Rejected | The claim that directors cannot be tested independently is false. Existing control-plane tests instantiate director classes with controlled Agent-shaped dependencies. Composition can improve without rewriting each director around a new interface hierarchy. |
| ND-ARB-002 | Watch only | The linear arbiter lane cascade remains readable policy. Refactor it only after a demonstrated precedence ambiguity or ownership conflict makes the winning lane unpredictable—not because the cascade is long or linear. |
| ND-TEST-001 | Rejected as mandate | A single all-up globbed `npm test` is not inherently superior. Named focused/broad/soak lanes are intentional; TD-TEST-001 concerns membership drift, not test-count maximization. |
| ND-CI-001 | Rejected | File-size thresholds, architecture-growth budgets, and new structural CI governance are not justified by a current gameplay failure. Add a structural guard only for a repeatedly violated, mechanically checkable invariant. |

## Sequencing rule

1. Finish and preserve the current physical gameplay checkpoint first.
2. Let the next real player outcome activate TD-CAP-001/TD-CAP-002 and, where necessary, a bounded portion of TD-PHY-001.
3. Complete TD-DEP-001 only through the already-approved owned-runtime migration gates; never mix dependency ownership changes casually into a gameplay repair.
4. Schedule small reliability repairs such as TD-PROV-001, TD-MODEL-001, TD-PROMPT-002, TD-LIFE-001, TD-ACT-001, TD-HIST-001, TD-JOB-001, or TD-SWARM-001 as coherent maintenance tranches; do not mix them into unrelated gameplay commits.
5. Measure before acting on TD-IO-001, TD-PROMPT-001, TD-MEM-001, or TD-ARB-001. **TD-IO-001 and TD-MEM-001 were measured on 2026-08-10 and both failed their activation gates; they are now P3 and must not be re-promoted without new measurement on the target hardware.** TD-PROMPT-001 and TD-ARB-001 remain unmeasured.
6. Leave P3 cleanup alone unless it is already inside the active change surface.

This map tracks liabilities. The playable companion roadmap remains authoritative for what gets built next.
