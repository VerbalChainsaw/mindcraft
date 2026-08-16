# Shared Contract Spine

This is the durable failure-attribution vocabulary for the Minecraft companion. Its purpose is to make the layer holding responsibility mechanically legible so a repair changes the correct owner.

The common progression is **selection → feasibility → planning → execution → reconciliation → verified outcome**. A domain can omit a boundary that genuinely does not apply, but it must not merge materially different boundaries into one generic failure.

## How to load this document

Enforcement plus sections 1–16 are the mandatory vocabulary. They are short, change rarely, and apply to every capability.

The `Current executable …` sections record the accepted contract and its physical acceptance evidence for one domain each. Load only the ones matching the capability in scope; they are why this file is long, and reading all of them for an unrelated repair spends context that belongs to the repair. Find the right one by domain:

- fixtures, stances, placement — Current executable stance receipt
- player targets and returnability — Current executable target/returnability enforcement
- movement in stages — Approved segmented-navigation contract
- surfacing and egress — Current executable surface-access semantics
- hostiles, harvest, healing — Current executable environment/combat enforcement
- death, trees, scaffolds — Current executable death and tree reconciliation; Durable death recovery and fresh player authority
- food, shelter, critical bodily need — Critical survival ownership and no-source recovery
- Hold and unattended lifecycle — Operator Hold mortal-survival boundary
- retreating from an entity — Surface-safe moving-entity retreat
- multi-part requests and builds — Packet-split construction sequencing and terminal companionship
- retry authority and fallback — Confusion, explicit retry authority, and terminal Hold

## Enforcement

- Emit bounded, normalized, immutable receipts in structured action evidence. Promote high-value contract state into the flight recorder and dashboard telemetry.
- A stage is evidence, not a guess. A later-stage failure requires affirmative receipts for all earlier required boundaries. Missing evidence remains unknown.
- Cancellation, preemption, Stop, and ownership replacement are censored. They do not prove that selection, planning, Pathfinder, Mineflayer, Paper, or the world failed.
- Repair the first unproven boundary. Do not alter an earlier layer whose success receipt remains valid.
- Preserve package ownership: project code owns judgment, policy, target/site selection, authorization, evidence, reconciliation, and verification; Mineflayer and mature plugins own supported mechanics.
- Success normally requires a physically observed postcondition, not merely an issued command or a mechanic promise resolution.
- Legacy paths without a receipt remain explicitly unattributed. Do not synthesize a stage from log text merely to fill telemetry.

## 1. Interaction stance

Applies to beds, crafting tables, furnaces, chests and other containers, doors, and placement targets.

1. `no_legal_stance`: project geometry/safety validation found no legal supported interaction stance.
2. `path_not_found`: at least one legal stance exists, but Pathfinder cannot form a route to it under the authorized movement policy.
3. `path_execution_failed`: Pathfinder formed a route, but physical execution stalled, diverged, or did not settle at the goal.
4. `interaction_rejected`: the stance was reached, but Mineflayer/Paper rejected the interaction or the expected interaction postcondition was not confirmed.
5. Confirmed: the exact interaction postcondition was observed.

The project owns stage 1, Pathfinder owns stages 2–3, and Mineflayer/Paper acknowledgement plus project verification owns stage 4. Do not blame Pathfinder for a stupid or impossible site, and do not blame reasoning when Pathfinder planned impossible geometry.

## 2. Resource acquisition

1. The requested resource is not obtainable under current policy/world state.
2. A legal source exists, but no acquisition plan can be formed.
3. A plan exists, but execution cannot physically obtain the resource.
4. The resource was physically obtained, but inventory/evidence reconciliation failed.
5. The exact requested quantity is satisfied and reserved for the requesting job.

## 3. Returnability

1. The departure anchor is known and valid.
2. Outbound movement remains inside a provably returnable envelope.
3. A return strategy survives each material world-state change.
4. Return execution succeeds physically.
5. Arrival is verified against the original anchor.

An outbound action is not fully successful if it strands the companion.

## 4. Tool fitness

1. No suitable tool is legally available.
2. A suitable tool exists, but selection policy rejected or missed it.
3. The selected tool cannot perform the requested mechanic.
4. The tool performed work, but durability/replacement state became invalid.
5. Tool lifecycle and remaining inventory reconcile.

## 5. Material custody

1. The material does not yet exist.
2. It exists but is not under bot/job custody.
3. It is under custody but not reserved for the intended consumer.
4. It was transferred, dropped, or stored, but the receipt is unconfirmed.
5. The intended consumer physically possesses or has accepted custody.

## 6. World-modification authority

1. The target world state is protected or unauthorized.
2. Modification is authorized, but the proposed method exceeds allowed collateral.
3. The method is legal, but execution changed unintended state.
4. The intended change occurred, but cleanup/restoration is incomplete.
5. Final world state matches the requested outcome and preservation rules.

Technically acquiring a block does not excuse a mutilated tree, needless pit, abandoned scaffold, open door, or damaged shared build.

## 7. Intent authority

1. Speech is conversation-only.
2. Speech contains actionable intent but no execution authority.
3. Authorized intent cannot be normalized into a supported contract.
4. A valid contract conflicts with active ownership/state.
5. The contract is accepted and installed exactly once.

## 8. Job replacement and continuation

1. No active work exists.
2. New work is a compatible continuation.
3. New work supersedes active work.
4. Existing work reaches a safe settled/cancelled boundary.
5. New work becomes the sole authoritative plan.

## 9. Target identity

1. No semantic candidate exists.
2. Candidates exist, but identity is ambiguous.
3. The correct target is identified, but its physical address is stale or unreachable.
4. The target vicinity is reached, but Mineflayer/Paper identity disagrees.
5. Interaction occurred against the exact intended target.

## 10. Progress

1. Work has not started.
2. Work started without measurable physical progress.
3. Progress occurred and then stalled.
4. Physical activity continues but diverges from the requested outcome.
5. The required physical effect is complete.

Breaking blocks in the wrong direction is divergence, not healthy progress.

## 11. Recovery escalation

1. Retry the same mechanism only after a material world/evidence change.
2. Reposition or rebind within the same strategy.
3. Switch to another already-supported strategy.
4. Reconcile/replan at the capability boundary.
5. Fail truthfully with the exact unresolved condition.

Never repeat an identical recovery against materially identical evidence.

## 12. Completion receipt

1. The action command was issued.
2. The delegated mechanic reported success.
3. Observable world state changed.
4. The requested postcondition is physically true.
5. The postcondition remains true after a short reconciliation boundary.

Stage 4 is the minimum product-success boundary unless the capability explicitly defines a stronger one.

## 13. Equivalence and substitution

1. The exact requested item is available.
2. It is unavailable, but a policy-authorized equivalent exists.
3. The equivalent is explicitly bound to this request.
4. Downstream mechanics consume that same binding consistently.
5. The result satisfies the original semantic contract.

Execution primitives must not invent substitutions mid-action.

## 14. Temporary state

1. Original state is captured.
2. The temporary mutation is owned by the current action.
3. The mutation remains necessary.
4. Completion or interruption makes cleanup due.
5. Original or explicitly approved final state is restored.

## 15. Safe interruption

1. Interruption is requested but not acknowledged.
2. The mechanic is reaching a safe cancellation point.
3. Physical action stopped, but state/custody remains unsettled.
4. State is reconciled and ownership released.
5. A new instruction may safely take control.

“The bot stopped moving” is not equivalent to “the previous job is dead and cannot resume.”

## 16. Environment feasibility

1. The environment fundamentally cannot satisfy the capability contract.
2. It could satisfy the contract after legal preparation.
3. A preparation plan exists but cannot be physically completed.
4. The environment is prepared, but the mechanic still fails.
5. The environment satisfies prerequisites and execution succeeds.

## Current executable stance receipt

`src/agent/runtime/interaction-stance.js` is the canonical runtime schema for the interaction-stance contract. Named gameplay skills attach it as `evidence.skill.interactionStance`; `actionResultToTelemetry` promotes the normalized receipt. Schema v2 keeps the four stable failure codes backward-readable while exposing explicit immutable stages for selection, feasibility, planning, execution, acknowledgement, and functional postcondition. Legacy v1 receipts normalize with an unevaluated functional postcondition rather than invented success.

M2 physically accepted the first full functional-access transaction at the existing camp Crafting Table `(-392,67,-42)`. KidPlayer's natural request bound the exact loaded table and recipe, the supported current stance produced a native `already_at_stance` route receipt, Mineflayer acknowledged one Iron Axe craft, inventory reconciliation confirmed exactly one output, DadPlayer received that exact item, and the companion returned 2.697 blocks from KidPlayer under terminal Hold. The table and bounded surrounding terrain were unchanged, bot custody was empty, health/hunger remained 20, and Hold drift was zero. Pathfinder and Mineflayer mechanics were unchanged; the custom project seam is only bounded judgment and evidence.

Player delivery uses the same ownership split even though its target is an
entity rather than a fixture. Project code enumerates supported, unobstructed
drop cells and enforces the existing three-dimensional pickup-exclusivity
boundary; native Pathfinder owns the route. Candidate selection includes the
recipient's Y plus bounded offsets `+1`, `-1`, `+2`, and `-2`, because a player
standing on the lower side of a one-block terrace can have no legal same-Y
cardinal cell. A real-Paper acceptance at DadPlayer
`(8158.5,67,7927.5)` reached the upper stance at approximately
`(8156.69,68,7927.5)`, transferred exactly six Spruce Logs, reconciled bot
inventory from eleven to five, and persisted the final Agenda terminal hold.
This freezes the supported upper-terrace case without teaching project code to
plan routes or weakening custody verification.

Construction now routes exact stair furniture through this same stance
contract. The design DSL accepts only `put X Y Z EXACT_STAIRS FACING`; it
persists a one-cell logical `stair` fixture with exact material and cardinal
facing. Site selection proves natural support for a lowest-course stair,
Builder dispatches the existing `!placeFixtureAt`, Pathfinder owns travel to
the orientation ray, and Mineflayer/Paper plus a block-state read must confirm
material and facing. Session 17 physically placed south- and north-facing
Spruce Stairs with `skill_placed` receipts and left the existing picnic pad
unchanged. That does not certify site judgment: the seats were about
twenty-eight blocks from the named pad, so landmark-relative site binding is
the first unresolved boundary and neither Pathfinder nor placement is blamed.

Session 18 closes that site-identity boundary without moving coordinates into
the model. An explicit construction relation is resolved from a durable
player-named place, existing remembered-farm state, or a physically
revalidated latest remembered structure;
its bounded position, dimension, relation, and source are normalized and
frozen in `constructionIntent.siteConstraint`. The existing safe-site selector
searches from that grounded origin, while an unresolved name or dimension
mismatch fails before Builder ownership. The real-Paper replay bound beside
`picnic_pad`, preserved all nine pad cells and its complete walking ring,
returned to DadPlayer, and applied terminal Hold. Site identity is therefore
accepted and frozen. Relational layout remains distinct: both verified seats
landed on the same southeast side rather than opposite pad edges, so the next
repair belongs to design/landmark geometry and must not alter Pathfinder or
fixture execution.

Session 19 closes that relational boundary for the evidenced contract. An
explicit `one on each side` plus `facing inward` promise beside a grounded
landmark persists a bounded immutable `opposite_sides/inward` layout
constraint. Project-owned site judgment discovers one loaded bounded
player-made horizontal footprint, evaluates sparse cardinal pairs outside the
requested clearance, and accepts only an exact two-lowest-course-stair design.
Each fixture must retain a legal existing orientation stance with a complete
native Pathfinder route proof; the transformed output is still an ordinary
normalized Builder blueprint. Natural, unbounded, unsupported, ambiguous, or
nonconforming landmarks/designs fail closed. Paper physically confirmed
north/south chairs at `(8155,68,7921/7927)`, the intact nine-block pad, the
complete clear walking ring, Dad return, and terminal Hold. This layout seam,
named-site identity, Pathfinder, and fixture mechanics are now frozen absent
contradictory live evidence.

## Current executable target/returnability enforcement

`resolvePlayerDirective` binds the evidenced natural form `come/return/head home to <player>` directly to that exact player's `goToPlayer` capability. Preservation clauses can constrain the route but cannot grant construction authority. A target equal to the bot's own username is rejected as `invalid_self_target`; it cannot produce `already_at_target` or success.

For player pursuit, `probeSafeNavigationGoal` requires native Pathfinder to return a complete `success` route before `goto` receives execution authority. `partial`, `noPath`, and probe errors produce `path_not_found` evidence and no movement. Health-bounded descent and generic exploratory sidesteps are disabled for this pursuit path.

When ordinary navigation recovery is allowed elsewhere, `localNavigationEscapeStances` enumerates only loaded supported nearby body cells. `probeSafeRoundTripNavigationStances` must prove both the native inbound path and the reverse route to the origin before an exact `GoalBlock` is executed. Mere displacement after a rejected Pathfinder attempt is never recovery success.

These gates enforce target identity, planning, execution authority, and returnability without replacing Mineflayer Pathfinder mechanics. Their focused acceptance lives in `tests/control-plane/player-directives-routing.test.js` and `tests/critical-runtime-output.test.js`.

## Approved segmented-navigation contract

The complete-route gate above is the current safe implementation baseline, not a product requirement that every journey be planned end to end before the bot takes one step. Player pursuit, follow, return, and ordinary local escape may evolve to a segmented, receding-horizon journey under this contract:

1. The project retains the exact final destination, named-player identity, outstanding obligation, permissions, and preservation constraints for the whole journey. A waypoint cannot replace or silently weaken them.
2. Project judgment selects one bounded waypoint that represents sensible progress a competent Minecraft player could make from the loaded world. The endpoint must be a loaded, supported, clear, non-hazardous body cell within the original movement and terrain-mutation authority.
3. Native Pathfinder must produce a complete `success` route to that waypoint before locomotion. Its raw `partial`, `noPath`, timed-out frontier, or search error remains planning evidence and must never be executed directly.
4. The segment receipt records bounded origin, waypoint, final destination, native route status and length, safety/returnability classification, and the expected progress relation. Mineflayer/Pathfinder owns physical execution.
5. After execution, project reconciliation samples the actual supported body state and verifies material journey progress before another segment is authorized. A justified obstacle detour may temporarily increase direct distance only when its receipt explains the progress relation.
6. Repeated waypoint/body cells, oscillation, unchanged failed planning evidence, or bounded segments that make no overall progress terminate the segmented attempt and enter the shared fallback contract. Elapsed time or fresh narration alone never authorizes another segment.
7. A native reverse-route proof is required before a returnability-sensitive segment: one-way drops, cave or water entry, hazardous crossings, destructive access, or leaving a verified safe region. Ordinary level supported movement does not require an end-to-end reverse proof.
8. Final success still requires the original destination-relative physical postcondition. Completing one or more waypoint segments is progress, never arrival by itself.

This contract authorizes a thin orchestration layer around installed Pathfinder; it does not authorize custom movement, arbitrary frontier walking, a parallel path engine, or relaxing complete native planning for each executed segment. Until an implementation emits these receipts and passes a live player-valued acceptance, the current full-route gate remains the fail-closed executable behavior.

## Current executable surface-access semantics

Open sky is not itself the surface-access contract. A supported bot inside a
ground-level home, under an awning, or beneath a canopy is already at usable
surface access only when native Pathfinder proves a complete ordinary route to
loaded open terrain within the bounded six-to-ten-block egress ring and no more
than one block above or below the occupied stance. A roof or treetop several
blocks higher is therefore not arrival evidence. The normalized
`covered_surface_egress` or `open_surface_egress` receipt records candidate
count, native path status and length, and terminal stance; a missing complete
route continues through ordinary surface recovery rather than inferred
success.

Session 20 physically accepted the covered-base case. From the spruce-plank
family floor at `(8104.5,69,7939.5)`, Dad's unchanged “get back to the surface”
request settled as `skill_surface_reached` in 81 ms with zero movement,
excavation, or vertical progress. The receipt preserved a complete seven-step
native route to open stance `(8104,68,7933)` instead of targeting the roof at
Y73. A separate controlled replay from the existing Y31 stone corridor also
accepted the shared tool prerequisite: with crafting supplies but no pick, the
bot crafted and selected a Stone Pickaxe, consumed 48 durability, and advanced
on supported staircase geometry to Y52 before truthfully returning
`skill_route_deadline_insufficient`.

## Current executable environment/combat enforcement

Managed server configuration and loaded-world state are separate evidence
sources. Paper persists world difficulty in `level.dat`, so
`ManagedMinecraftServer` reapplies the normalized configured difficulty only
after the authoritative `Done` readiness edge. Hostile-spawn diagnosis must use
the live Paper value; `server.properties` or dashboard configuration alone is
not proof that the capability environment is feasible.

String acquisition waits in place during daylight when no Spider is loaded and
allows one bounded regional search plus spawn-settlement window at night. A
deliberate kill source then applies a stronger contract than emergency defense:
`deliberateEntityHarvestCombatRequirement` requires a usable melee item before
pursuit. Missing equipment is returned as structured
`combat_preparation_required` evidence with an exact `toolRequirement`, which
GoalDirector persists and the causal prerequisite planner satisfies. Once
armed, `harvestEntityDrop` delegates target pursuit and melee to
`resolveTacticalCombat` and `mineflayer-pvp`; it still owns exact drop pickup
and inventory verification. A retreat, interruption, or undefeated target is
never a successful harvest.

The focused contract acceptance lives in
`tests/control-plane/fishing-breakfast.test.js`; the real Paper replay on
2026-08-11 physically produced `skill_combat_preparation_required`, crafted a
wooden sword, and dispatched no Spider pursuit before that weapon existed.

Self-preservation now keeps an evidence-sensitive, instance-local lease after a
warning-range explosive reflex settles as `area_already_secure`. The same
entity may not repeatedly preempt the same action/goal without material new
evidence. A critical-range approach, player damage, a different entity, a new
action, or a new goal immediately reopens reflex authority. This suppresses a
stale ownership loop without pausing self-preservation or replacing
`mineflayer-pvp`. The unchanged Paper replay admitted one genuine reflex and
then completed the armed Spider harvest with two String.

Tree transaction settlement likewise follows the common receipt rule: an
uncensored navigation helper's boolean is advisory, while the final supported,
loaded collection stance is the authoritative physical postcondition. A
cancellation remains failure. After native navigation resolves, the transaction
allows a bounded 2.5-second Paper body-settlement edge before sampling that
postcondition. Cleanup attribution is independent: only exact placement records
whose live blocks still match the transaction count as remaining temporary
scaffolds. Session 13 therefore correctly reported one scaffold placed and one
reclaimed while separately returning `tree_terrain_settlement_unverified` for
the body. This prevents an in-flight landing from becoming a false failure and
prevents an already-Air placement cell from becoming false cleanup residue;
the still-unsettled uneven-terrain case remains a distinct deferred geometry
failure.

Tall-tree access remains package-owned. `completeStartedTree` configures the
existing Mineflayer Pathfinder `Movements` with the exact selected wood item
IDs as legal temporary scaffolds; the project still owns component identity,
placement authorization, bounded tracking, and cleanup verification. It does
not implement a parallel climbing or placement engine. A Paper proof completed
the vertical Spruce component at `(8153,67..74,7927)`, collected all eight
logs, reclaimed its one temporary scaffold, and returned to the original
supported stance.

Optional hostile acquisition now has a temporal-health admission gate before
dispatch: a deliberate `kill` method is rejected as
`combat_health_unknown` when health is unavailable and waits as
`waiting_for_combat_recovery` at eight health or below. This does not weaken
emergency defense; it prevents a nonessential resource prerequisite from
starting in a state that cannot reasonably survive it.

The live combat boundary is stricter than a health/tool precondition. Before
`harvestEntityDrop` gives the exact hostile target to the installed tactical
combat adapter, it samples the bounded 16-block engagement envelope. Any
second loaded hostile makes optional combat infeasible as structured
`combat_environment_unsafe`; the receipt carries at most four normalized
threats and the project never asks Pathfinder or `mineflayer-pvp` to invent a
safe multi-hostile engagement. Separately, reaching a native retreat goal
proves target spacing, not bodily safety. If health deteriorates into or within
the critical band, reconciliation is `retreat_health_deteriorated`, never a
successful retreat, even when Pathfinder increased spacing.

These receipts were physically accepted in Session 22, but the companion
outcome was not. A later clear-envelope Spider harvest succeeded and the bot
then continued ordinary crafting in the nighttime region until another
hostile closed and killed it. Therefore admission and truthful reconciliation
are necessary evidence boundaries, not a complete hostile-work closeout
policy. No ordinary noncombat continuation after deliberate hostile
acquisition is considered safe or frozen until live evidence proves the bot
either returns to a verified safe origin or passes an equivalent shared
immediate-hostile feasibility boundary.

Session 22 now also bounds optional hostile target locality. Goal temporal
feasibility and `harvestEntityDrop` share one qualifier: a deliberate hostile
candidate must be within 24 blocks and no more than six vertical blocks from
the current stance. Other-level hostiles do not contaminate that local combat
receipt. If a Spider disappears or proves non-local during daylight, regional
relocation is denied and the Goal returns to temporal waiting. The loaded Paper
replay completed one 31.9-block surface search from Y69 to Y72 and then waited
without a second daylight dispatch, accepting those observed boundaries. It
did not contain a loaded non-local Spider, so candidate rejection itself is not
claimed as live acceptance.

That replay exposed the next returnability boundary: temporal waiting retained
the remote search stance for the entire day, 31.2 blocks from the requester.
Environment feasibility is not companion-site judgment. A long wait after an
outbound prerequisite search now resolves the exact live Goal requester and
delegates one return to the existing `goToPlayer` skill before waiting when the
bot is beyond six blocks. That skill retains complete native-route authority
and player-relative arrival verification. Missing or ambiguous requester
evidence authorizes no movement; a genuine failed return is not repeated
without intervening physical acquisition evidence; safety interruption is
censored and may resume. The first controlled replay advanced 18.5 blocks
before self-preservation preempted it, disproving the initial 16-block done
radius because Dad remained 13.5 blocks away and out of line of sight. The
six-block correction is physically accepted: the next Paper replay settled
IronSuiteProof 0.179 blocks from Dad and retained that exact-requester stance
through the remaining daylight sample.

Nighttime absence of a usable local hostile source is also a temporal
feasibility boundary, not a failed acquisition method. `harvestEntityDrop`
performs one bounded spawn settlement at the current stance (and after a
verified regional relocation), then emits `source_spawn_pending` only when it
attempted no entity, collected no output, advanced no search route, and the
existing Spider-to-String contract applies. GoalDirector persists that receipt
on the ordinary durable subgoal, classifies it as censored, preserves the
productive-attempt budget, and waits for a newly qualified loaded Spider before
dispatching again. A source observed before dispatch but gone before the first
skill scan receives the same bounded settlement instead of becoming a generic
method failure. The loaded Paper replay remained beside Dad for more than 90
seconds after one 10.856-second pending action, with zero productive attempts
and no Tripwire/Cobweb fallback. Pathfinder, tactical combat, and source
registry mechanics remain unchanged.

Critical healing uses one semantic `healing_potion` contract through both
direct commands and automatic survival. Modern 1.21.11 Mineflayer items expose
numeric `potion_contents.potionId`; the live-observed vanilla identities 24
(`healing`) and 25 (`strong_healing`) are version-scoped, while unknown versions
and IDs fail closed. During recent-damage self-preservation, the already owning
reflex invokes native `bot.consume()` before its existing retreat. Outside that
reflex, SurvivalDirector may request the same deterministic skill. Settlement
waits for both increased health and decreased potion inventory, restores the
exact prior held item (including the authoritative hotbar fallback), and never
reports healing from inventory disappearance alone.

The final Paper proof started at health 20 with a wooden sword selected. Twelve
points of generic damage triggered the reflex; the potion became a glass bottle,
health returned to 20, the wooden sword was selected again, and the delegated
retreat completed. Focused acceptance lives in
`tests/brewing-plan.test.js`,
`tests/control-plane/self-preservation-healing.test.js`,
`tests/control-plane/survival-eating.test.js`, and the survival/parser checks.

Focused acceptance covers the stale-reflex evidence transitions in
`tests/control-plane/agent-lifecycle.test.js` and physical tree settlement in
`tests/collection-target-safety.test.js`. Combat timeout and survivable
low-health recovery remain separate live failure classes; none is relabelled
as stale-reflex churn.

Combat target identity is scoped to the exact loaded Mineflayer entity object,
not only its numeric entity ID. Paper may replace the player entity on respawn
and later reuse an ID; damage or death packets from that replacement generation
must not verify hits against, or the death of, a pre-death hostile. Every melee
and ranged confirmation therefore requires both the expected ID and the same
loaded entity object, and a death edge clears the recent-damage admission that
belonged to the dead body. This is target-identity and receipt enforcement
around `mineflayer-pvp`, not a replacement combat mechanic.

`entityDead` does not itself identify the damage source. Successful kill
reconciliation therefore also requires the last observed damage against that
exact target generation to be bot-attributed and to immediately precede death
within the bounded 250 ms confirmation edge. An external, player, or
environmental death after older bot damage remains
`skill_target_died_unattributed`; stale attribution must never become verified
combat success.

## Current executable death and tree reconciliation

Death is a censored physical-action result but an authoritative goal-lifecycle
event. `GoalDirector.reconcileDeath` invalidates the current dispatch token,
charges one durable attempt through the ordinary failure transition, and enters
the existing `!recoverDeathItems` capability only when the death callback proves
that exact current manifest was durably stored. Goal-owned recovery persists the
manifest's `recordedAt` identity and carries it through the command so recall and
settlement cannot fall back to another FIFO death. A rejected ledger write is a
structured `death_recovery_persistence_failed` terminal boundary; it never
authorizes movement toward an older death site. Argumentless direct player
recovery retains FIFO compatibility. A late `interrupted` result from the action
that died is ignored. The goal must therefore become exact bounded recovery or
terminal exhaustion; it cannot remain active at the same attempt budget after
inventory loss. Focused
acceptance lives in
`tests/control-plane/goal-director-recovery-budget.test.js`. This lifecycle
invariant has focused regression evidence; a full live item-recovery round trip
was not exercised in the final Session 9 replay.

Tree scaffold cleanup gives the one-block support-break transition a
tree-specific 2.5-second body and passive-pickup settlement window. Ordinary
terrain settlement now uses the same bounded physical edge after navigation;
generic locomotion deadlines and Pathfinder planning are unchanged. Final
cleanup counts come from exact owned placement cells that still contain the
owned material, so Air is reclaimed rather than reported as residue even when
the body remains unsettled. Focused collection acceptance remains in
`tests/collection-target-safety.test.js`.

## Critical survival ownership and no-source recovery

Critical bodily need is one shared threshold, not a suggestion interpreted
differently by each layer. BehaviorArbiter, SurvivalDirector, and ActionManager
all treat health at eight or below or hunger at the configured `criticalFood`
threshold as preemptive. Only that critical case evaluates basic survival ahead
of active player/job retention; routine eating, armor, sleep, shelter, and drop
upkeep remain below durable player work. ActionManager's existing owner
priority performs the physical interruption. Decision telemetry records the
displaced owner/action and `basic_survival` acquisition.

An interrupted, succeeded, failed, blocked, or recovering critical-survival
attempt keeps the body reserved through its bounded settlement/retry cooldown
while the bodily evidence remains critical. The cooldown rate-limits another
survival action; it is never permission for a lower-priority goal to work
between acquisition and consumption or between attempts. The reservation
releases when health/hunger is no longer critical. Focused ownership acceptance
lives in `tests/control-plane/behavior-arbiter-trace.test.js` and
`tests/control-plane/survival-director.test.js`.

Food preparation checks health and nearby danger before preparing a hunting
weapon. Critical bodily recovery requests one immediately edible food point in
a 24-block search: safe raw beef, pork, mutton, rabbit, cod, and salmon count,
and the existing native combat adapter may hunt without manufacturing a weapon.
Durable reserve and exact-furnace requests retain their cooked-food contract.
If no safe food source exists, SurvivalDirector persists one bounded
blocker containing position, dimension, and exact player requester. With
unchanged evidence it attempts one return through `!goToPlayer`. If that exact
requester return fails or the requester is unavailable, it may then attempt one
finite same-dimension remembered-home route through the existing
`!goToCoordinates`/Pathfinder path before waiting as
`recovery_food_sources_exhausted`. The home anchor grants a destination, not
planning success: Pathfinder failure is retained and the bot does not invent a
movement fallback or call arbitrary region novelty safe. Only verified player-
return or home-region change reopens food assessment; a material
dimension/body/inventory or requester change also reopens recovery. Bodily
recovery requires health and hunger to be recovered rather than either healthy
dimension erasing the other.
Pathfinder's partial plan remains a
truthful zero-movement failure; project recovery must not weaken that native
planning gate. Session 11 physically reduced the prior 52.355-second tool and
furnace expedition to a 13.148-second raw-Porkchop acquisition/consumption, and
then to a 35 ms stationary no-source wait after local animals were exhausted.
Before Agenda creates its typed Goal, critical recovery now inherits the exact
requester from the active or first pending normalized Agenda entry. Session 12
physically bound `DadPlayer` and dispatched exactly one return attempt after a
30 ms no-source result. The attempt could not safely cross the damaged family
anchor: normal non-destructive Pathfinder was partial, while parkour's only
complete native route descended from Y69 to Y60 through the crater and the
executable diagonal guard rejected its corner geometry. That is truthful
returnability evidence, not authority to weaken Pathfinder or treat dangerous
terrain as a successful player return.

## Operator Hold mortal-survival boundary

Operator Hold is authoritative over ordinary work; it is not authorization to
silently die. Two exact reflexes may execute without releasing the persisted
Hold bit:

1. `mode:self_preservation` for its existing severe bodily/environmental
   evidence; and
2. `mode:self_defense` only while `getRecentDamageCombatThreat` proves both a
   fresh hit within the four-second damage window and a loaded, combat-safe
   hostile inside the existing sixteen-block tactical envelope.

BehaviorArbiter evaluates those two bounded mode bands before selecting the
Hold gate. ModeController owns the evidence-sensitive eligibility check, and
ActionManager independently admits only the exact `reflex` labels
`mode:self_preservation` and `mode:self_defense`. Ambient enemy presence,
cowardice, hunting, player-protection attribution without fresh damage to the
bot, goals, jobs, and every ordinary action remain blocked. After the reflex
settles, Hold remains asserted and wins the next safe tick. This is an
authority exception, not a second combat engine: the existing tactical-combat
adapter and its mature packages still own attack, retreat, and movement.

Session 16 physically accepted the ordinary-melee case on Normal Paper. A held
bot waited while a tagged Zombie approached, admitted `mode:self_defense` only
after health changed `20 → 18`, then action
`IronSuiteProof-1-1786494796239` resolved as `skill_secured` in 2.236 seconds.
The Zombie was gone, its drops were collected, and the bot returned to
`operator_hold_safe` without ordinary work or Hold release. A later natural hit
also admitted a bounded `skill_retreated` response before returning to Hold.
Focused authority and trace acceptance lives in
`tests/control-plane/behavior-arbiter-trace.test.js`, with unchanged ambient
Hold suppression retained in `tests/control-plane/companion-context.test.js`
and the exact action gate covered through ActionManager.

Explicit Operator Stop and a completed Agenda terminal wait now also have a
terminal lifecycle disposition when companionship is physically impossible
because every human has left the server. Temporary assignment-compilation and
handoff Holds continue preserving authorized durable work and never trigger
this disposition. The arbiter
uses the full Mineflayer tab roster rather than nearby loaded entities, excludes
the bot itself and other known agent profiles, and treats a missing roster as
unknown. After ten continuous seconds with zero humans—and only after both
mortal-reflex bands decline ownership—it rechecks the roster and delegates one
graceful code-zero teardown to the existing Agent/AgentProcess lifecycle.
`operator-control.json` remains held, the supervisor settles as `stopped`
without automatic restart, and a later dashboard/player-directed start restores
the same Hold before ordinary world control. This does not move the companion,
build shelter, or claim that overhead cover is safe. A stopped bot cannot notice
an unannounced later player join; automatic presence-triggered restart remains a
separate supervisor feature, not inferred behavior.

Natural indefinite `stay` and `wait` are authority requests, not long-running
body mechanics. They now route through the same existing `!stop` operation,
which persists Operator Hold, settles current physical ownership, preserves
durable work, and leaves the zero-human unload gate eligible. Finite explicit
`!stay(seconds)` remains a bounded player action. Session 31 physically
accepted the natural path: zero drift, retained health/inventory, and code-zero
unload after 10.635 seconds. The same session also live-confirmed the reciprocal
gap: KidPlayer rejoined authoritatively, but the stopped held profile remained
absent for 20.229 seconds. That is managed presence/supervisor lifecycle
evidence; it does not reopen chat, Hold, movement, or Minecraft mechanics.

The Paper acceptance on 2026-08-12 started the sole empty, full-health
explicitly stopped bot
at `(8104.5,69,7939.5)` with zero humans online. It remained on that exact cell
through the grace, then departed normally after approximately 10.5 seconds.
The launcher reported `stopped` with no error, Hold remained true, and recorder
sequence 2 published `runtime.stopped` with reason `Operator Hold safely
unloaded after 10 seconds with no human players online.` Focused arbitration
and code-zero lifecycle checks cover roster identity, timer reset, temporary-
Hold exclusion, one-shot dispatch, and no-restart settlement.

## Surface-safe moving-entity retreat

Threat separation is horizontal gameplay safety, not arbitrary
three-dimensional distance. `GoalOutsideEntityXZRadius` lives in the owned
Pathfinder package, retains the live entity reference for X/Z replanning, and
anchors its allowed Y band to the retreating body's starting stance. Its
heuristic is a non-negative lower bound to the horizontal boundary plus any
vertical excess; cave depth can neither lower the heuristic nor satisfy the
goal. `moveAwayFromEntity` continues to use the existing `goToGoal` and
ActionManager cancellation path, disables parkour and large dropdowns for the
emergency route, and verifies fresh horizontal distance and vertical drift
before reporting success. It may truthfully fail when no surface-safe route
exists; it must never reinterpret a cave fall as successful retreat.

Session 14 physically accepted that contract on Normal Paper. A tagged
stationary Creeper remained loaded while action
`IronSuiteProof-5-1786490397405` increased spacing from 6.0 to 10.0 blocks in
925 ms, moved four blocks horizontally, changed elevation only from Y68 to Y67,
and retained full health. Focused goal acceptance lives in
`tests/pathfinder-retreat-contract.test.js`. Pathfinder still owns planning and
execution; project code owns the safety envelope and postcondition.

## Packet-split construction sequencing and terminal companionship

Minecraft may deliver one long Mineflayer chat call as several player packets.
Deterministic Agenda compilation must preserve semantic ownership across that
boundary without inventing transport-level packet correlation. When the whole
utterance resolves as deferred construction but connective splitting would
erase the construction verb from every individual segment, the Agenda parser
retains one typed construction barrier with the complete required-function
contract. A later return segment that itself ends in `wait` or `stay` attaches
the existing `terminalDisposition: hold_position` to its normalized goto entry.

Construction compilation intentionally holds physical action until an exact
Builder order is accepted and bound. That hold is appendable only when Agenda
exposes the exact unfinished construction entry in
`assignmentState: compiling`; ordinary continuations then remain FIFO behind
the barrier. Explicit interrupt disposition and a genuinely Operator-Stopped
agenda retain replacement semantics. No hold-reason string, chat timing
heuristic, model promise, or unrelated active job may substitute for that typed
state. Builder completion releases the dependent goto; only verified arrival
may apply terminal hold.

Session 14 accepted the live 256/40-character split as construction → return
→ wait. Builder verified nine Spruce-plank cells, the dependent goto reached
DadPlayer, and the final persisted Agenda entry records both
`terminalDisposition: hold_position` and `terminalDispositionApplied: true`.
Focused acceptance lives in `tests/control-plane/player-agenda.test.js` and
`tests/control-plane/agent-agenda-dispatch.test.js`.

The behavioral flight recorder did not publish those successful action
lifecycles in the final Session 14 file even though canonical state, Paper,
Agenda, and the world agreed. Session 15 closes that gap without turning the
recorder into a tick dump: request-correlated successes from explicit,
deterministic-natural-language, model-selected, directive-resume, Agenda,
GoalDirector, and JobDirector routes are retained; internal/reflex successes
remain excluded. Each success keeps canonical counters and diagnostics but
removes the repeated recent decision ticks, sets
`decisionTrace.compactedFor: action.success`, and adds capture marker
`canonical_action_trace_compacted`. Failures retain their existing policy.

Live Agenda-owned death recovery emitted a 19,953-byte `action.success` with
zero recent ticks, exact request correlation, `skill_items_recovered`, the
death-site coordinate, and item-by-item reconciliation for all five drops.
This accepts bounded successful-action publication; it does not imply that
every ambient behavior or world transition should be recorded as success.

## Durable death recovery and fresh player authority

Natural compound aftercare may persist a typed `recover_death` Agenda entry,
which routes through the existing `!recoverDeathItems` capability and its
MemoryBank manifest. Recovery, requester return, and terminal wait therefore
remain one ordered contract instead of relying on a model to remember the next
step. The additive kind does not introduce a second recovery mechanic or state
store.

A fresh player Agenda takeover invalidates Prompter's current generation epoch
before cancelling provider leaves. A provider that settles late cannot execute
commands from an older conversation turn after the newer typed plan has become
authoritative. Ordinary FIFO Agenda append deliberately does not perform this
invalidation, so construction continuation compilation remains intact.

Session 15 physically accepted both seams after a real Zombie death. The sole
Agenda recovery action collected two Spruce Logs and three Spruce Planks at
`(8143.32,63,7881.54)`, cleared the pending recovery manifest, and emitted one
correlated success; no stale model-selected action duplicated it. The dependent
return then failed truthfully because native Pathfinder produced only partial
plans. Terminal hold was not applied. That distinct returnability failure is
preserved rather than being hidden inside the accepted recovery/control claim.

## Confusion, explicit retry authority, and terminal Hold

An executor's terminal result is not implicit permission for its durable parent
to manufacture a fresh attempt budget. GoalDirector and JobDirector own their
bounded mechanical recovery. Agenda may redispatch a failed typed step only
when the correlated settlement explicitly records `retryable: true`; an absent
flag is unknown and therefore terminal. An explicit retry must retain its
normalized checkpoint and any verified progress or changed supported method.

Agenda terminal settlement persists before speaking. It emits one concise
receipt-grounded blocker, explicitly states that no unchanged retry occurred,
and enters Hold when no already-authorized continuation remains. An
`after_settlement` return, regroup, or other typed continuation remains allowed
to run before Hold; a failed predecessor cannot silently erase that promise.

Material ambiguity is settled before action authority. The pure player-agenda
front door may retain a bounded item, quantity, requester, candidate-recipient
set, and terminal disposition, but it authorizes no transfer until the original
requester names one loaded candidate. The answer reconstructs one ordinary
typed Agenda request, so clarification and direct natural-language play use the
same GoalDirector and Mineflayer delivery mechanics.

M3 physically accepted this contract on Normal Paper. DadPlayer asked
IronSuiteProof to give its sole Bread to “one of us” and wait. The bot asked
exactly once, retained custody and Hold before the answer, delivered exactly one
Bread to the named KidPlayer, retained none, and settled under terminal Hold.
Flight `flight-2026-08-14T17-28-32-859Z-167556-000.jsonl` records the correlated
`skill_delivered` receipt; focused and adjacent ownership checks pass 103/103.

## Durable loading and enforcement

This document is the canonical detailed contract record. Repository
`AGENTS.md` supplies the mandatory local enforcement summary. The reusable
`mindcraft-minecraft-development` skill requires Enforcement plus sections 1–16
whenever gameplay, evidence, telemetry, recovery, interruption, or ownership is
in scope, together with the `Current executable` sections matching the
capability being changed. Loading the entire file for every task is not
required. That layered path keeps the rules discoverable to new agents while
executable schemas and focused checks prevent documentation from becoming the
only enforcement.

Each `Current executable` section deliberately carries both a contract and the
physical evidence that froze it. Preserve both. The contract without its
acceptance evidence cannot be safely reopened or rescoped, and the evidence
without its contract cannot be enforced; that pairing, not narrative habit, is
why these sections are long.
