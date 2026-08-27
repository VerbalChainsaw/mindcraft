# Minecraft Companion — authoritative architecture and implementation plan

This is the sole active architecture and implementation plan for Kevin. `AGENTS.md`
defines working rules; `docs/HANDOFF.md` names the exact next tranche. The engine
documents are evidence, research, theory, alignment, and archaeology only. If any
supporting document conflicts with this file, this file governs.

## 1. Product outcome

Kevin is a companion for a child. A player speaks naturally; Kevin remembers the
player-visible promise, does the useful work, preserves prior accepted behavior,
and either verifies the requested outcome or explains truthfully what happened.
The product is judged by physical outcome and ordinary-player sense, not internal
activity or plausible narration.

## 2. Verified baseline (working tree, 2026-08-18)

These implementation facts were checked against current production source before
this plan was reconciled:

- `profiles/local-quickstart.json` requests `runtime.traversal: "full"`.
  `src/agent/agent.js` uses `"preserve"` only as the fallback when traversal is
  absent. There is no global traversal-policy flip to implement.
- The owned `packages/minecraft-runtime/mineflayer-pathfinder` preserves an A*
  context across partial calculations. `goto()` remains pending on `partial`, and
  the pathfinder installs and walks the best partial path while search continues.
  There is no global partial-path execution loop to add above Pathfinder.
- `ActionManager` already aborts cooperatively, requests specialist interruption,
  waits for the underlying action, and retains ownership after its stop ceiling if
  the action has not settled. It is the starting seam for `ActivityExecutive`, not
  proof that the full lifecycle below already exists.
- The current navigation-probe families are `probeSafeNavigationGoal`,
  `probeSafeNavigationFrom`, and `probeSafeRoundTripNavigationStances`, plus
  interaction-stance preflights and collection route probes/selectors. The
  verified 429-line `src/agent/runtime/mining-corridor-planner.js` implements the
  bounded mining-corridor search. `requirePlannedRoute` consumers and the
  `runSegmentedJourney` waypoint mechanism in `src/agent/library/skills.js` are
  also current route-preflight symbols; these require per-consumer
  atomicity/returnability classification as audit targets.
- Source line numbers are not architecture. Current symbols and behavior must be
  re-inspected before each implementation change; supporting docs avoid binding
  claims to mutable line offsets.

### 2.1 Current phase and proof ledger (2026-08-26)

Only the states below are current. `docs/CAMPAIGN-RECORD.md` owns the detailed
physical evidence and accepted non-regression outcomes; `docs/HANDOFF.md` owns the
one active tranche, if any.

| Boundary | State | Evidence boundary |
|---|---|---|
| Phase 0 documentation/evidence baseline | `ACCEPTED / CLOSED` | This architecture and the campaign record are reconciled and canonical. |
| Phases 1–2 Activity lifecycle, Pathfinder/CollectBlock adapters, halt acknowledgement, settlement, and ownership quarantine | `ACCEPTED / CLOSED` | Focused lifecycle checks plus the accepted physical interruption-and-transfer run. |
| Phase 3 charcoal Mission vertical slice | `ACCEPTED / CLOSED` | Direct and natural-language Scenario Lab invocations both physically completed the exact eight-charcoal Mission with complete evidence and no safety violations. |
| Phase 4 `probeSafeNavigationGoal` -> `goToGoal` inconclusive-route truth contract | `ACCEPTED / CLOSED` | Both explicit-command Scenario Lab transports physically ended `timeout` as retryable `route_unproven` with `conclusive: false`, zero movement, intact terrain, complete cleanup, Hold, and no safety violations. |
| Phase 4 `probeSafeNavigationStances` result-shape truth contract | `ACCEPTED / CLOSED` | The normal wrapper path now preserves the producer's `conclusive` field for `timeout`, completed `noPath`, and `success`; failing-before and passing-after isolated checks plus the focused runtime suite prove the static contract. No physical gameplay acceptance or consumer demotion is claimed. |
| Phase 4 `reachInteractionStance` inconclusive-probe consumer truth | `ACCEPTED / CLOSED` | Focused conclusive/inconclusive checks plus one isolated non-provider physical course prove that a real producer timeout falls through to the original interaction goal, real Pathfinder reaches the legal stance, and no later interaction, inventory change, terrain change, unsettled body, or fixture leak occurs. |
| Phase 4 player-directed incremental route consumer | `ACCEPTED / CLOSED` | Two live Scenario Lab courses passed both direct and natural-language transports on current source. Kevin used native Pathfinder to break through a dirt obstruction and arrive at 3.000 blocks; against a sealed bedrock shell he advanced to 6.179/6.185 blocks, preserved the shell, and truthfully ended retryable `skill_closest_explored` without claiming arrival. Both aggregates have complete evidence, stable Hold, full restoration, and no safety violations. |
| Pathfinder expensive finite-break routing | `ACCEPTED / CLOSED` | `validation-output/pathfinding-finite-break-cost-2026-08-25T18-28-23-798/pathfinding-finite-break-cost.result.v1.json` passed both transports: empty-handed Kevin selected and executed a two-log hand-break route whose labor cost exceeds the former numeric impossibility sentinel, crossed the obstruction, reached the player, settled, and restored the runtime with no retry or safety violation. |
| In-flight Mission replacement and graceful Activity handoff | `ACCEPTED / CLOSED` | Deterministic failing-before evidence showed immediate replacement stranded the old Activity as `RUNNING`; focused passing-after tests now prove validation before halt, old-Mission retention through ActionManager stop and correlated settlement, replacement only after both, and fail-closed behavior when validation or halt fails. |
| Phase 5 `1-give`, trial 1, recorded trace, telemetry off, advisory preflight | `ACCEPTED / CLOSED` | One isolated real-Minecraft observation physically delivered exactly four of eight starting oak logs, matched the single recorded provider request to runtime input/output fingerprints, settled under Hold, restored the fixture/runtime, disconnected the test player, and left no managed Java or provider process. |
| Phase 6 controlled swim-exit | `ACCEPTED / CLOSED` | Both isolated explicit-command transports climbed from the generated water basin to the dry bank through real Pathfinder under `full` traversal, ended `skill_arrived`, preserved terrain and empty scaffold inventory, settled under Hold, restored the fixture/runtime, and produced complete evidence with zero retries or safety violations. |
| Phase 6 composed terrain workarounds | `ACCEPTED / CLOSED` | One uninterrupted real Pathfinder action composed dig-through, three-block parkour, two-block horizontal bridge, two-block 1x1 tower, nine-stone stair-tunnel excavation across three rises, controlled descent, contained-column swim exit, and dry arrival with exact scaffold and terrain accounting. |
| Dynamic escape selection and Mission resumption | `ACCEPTED / CLOSED` | A DeepSeek-interpreted one-cobblestone Mission crossed previously unencoded survival-world confinement from y=17 to the requester at y=91 through hostile interruptions, changed-route support restoration, supported corridor excavation, surface recovery, and native best-frontier continuation. Paper confirmed the player received the item. The exact receipt race and mixed-offset canopy handoff exposed at the end were repaired at their owners and re-exercised once on current source with an exact one-granite delivery, one successful subgoal, and no blind replay. |
| Autonomous village expedition and player guidance | `ACCEPTED / CLOSED` | Kevin found and verified a taiga village, remembered its bell at `(781,66,-775)`, returned to the requester, and completed the saved guide continuation with both bodies at the village. The roughly 590-block final guidance leg physically composed forest travel, slopes, repeated step-ups, deep-water traversal, shoreline ascent, catch-up, and chained recoveries. |
| Phase 7 Container specialist and village supply cache | `ACTIVE` | Native chest/barrel actions now carry Container Activity ownership across Pathfinder approach, window progress, halt, close, and settlement. Kevin physically stored six oak logs in the exact village chest at `(796,67,-774)`, returned, later worked around an unreachable first withdrawal stance, retrieved exactly two from the same chest, returned, retained custody after correction, and durably remembered `village_supply_cache`. The chest ended with four logs and Kevin with eight. Other Phase 7 specialists and Container interruption-in-window behavior remain open. |
| Phase 7 Placement specialist and compounded survival shelter | `ACCEPTED / CLOSED` | In the continuously running survival world, one shelter promise survived hostile preemptions, death displacement, a 56-block persistent return with chained self-preservation recoveries, stale surface-access state, partial construction, material rebinding, and post-occupancy world change. Placement Activity ownership covered verified block effects and settlement; Builder reused the existing spruce shell instead of restarting or clearing it. The final order re-audited after Kevin entered and ended `blueprint_complete` at 23/23, with Paper confirming all 23 spruce cells, the four required air cells, and Kevin grounded inside. |
| Outcome-directed confidence coverage across new and old mechanics | `ACTIVE` | Saved accepted evidence remains valid. Controlled runs are authorized when they can change a mechanic owner, repair, composition verdict, or significant risk; fixed-count and reassurance-only reruns are not. |
| Phase 5 controlled variance matrix | `PENDING` | The stopped API-routed attempt preserved four local reports but used the wrong frozen-model provider. The corrected `codex/gpt-5.6-luna` OAuth matrix has not started and has no variance verdict; it remains separately authorized and does not displace current gameplay work. |
| Phase 7 composition strengthening through the operational workshop expedition | `ACTIVE — PARTIAL` | Saved current state now outranks the earlier active-Explorer cursor: the cave/resource entry, iron-pickaxe goal, and shield goal completed; the bucket goal failed `inventory_capacity_blocked`; the three deposits and requester return were later cancelled by the player. The project is preserved incomplete evidence, not the current gameplay cursor and not acceptance. `CS-1` through `CS-5` have forward source implementations with static syntax/module evidence only; `CS-6` remains physically open. |
| Phase 7B deterministic compound livestock project | `ACTIVE` | The newest player-valued outcome is one ordinary request: build and secure a catalogue animal pen, scout and remember at least two requested adult animals, return and guide the requester to them, prepare the exact attraction food, move and breed the animals, close the gate, and return. Saved gameplay proves the old language path fell through to improvised commands and the first pen Builder order stopped at 37/49 on `spruce_fence`; the typed Agenda/compiler, requested-population scout contract, exact deferred pen/source binding, and unchanged-placement containment are the active owning seams below. |
| Remaining Phase 7 specialist boundaries | `PENDING` | Craft, Furnace, PvP, Vehicle, and Container's open-window interruption boundary close only when their package-specific cancellation, physical settlement, partial-effect truth, and composed player-visible behavior are actually traversed. Placement remains closed. |

The Scenario Lab catalog describes registered scenario definitions and executor
availability. Its static `not-run` values are not an acceptance ledger and must
never reopen an `ACCEPTED / CLOSED` segment. Saved aggregate results and the
campaign record determine execution history.

## 3. Governing decomposition

### 3.1 One Mission remembers the promise

At most one ordinary player Mission is current. It is in memory by default and
stores the player-visible promise, not a stale closure or pre-expanded command
queue.

```ts
type Mission = {
  missionId: string
  requester: PlayerRef
  promise: string
  acceptance: OutcomePredicate[]
  permissions: PermissionSet
  constraints: Constraint[]
  clarification?: { token: string; activityId: string; question: string }
  status: 'OPEN' | 'WAITING_FOR_INPUT' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
  createdAt: number
  updatedAt: number
}
```

A new player request may replace the current Mission after deterministic policy
validation. Replacement requests graceful halt of the current Activity; it does
not release the body early. The old Mission is not a durable obligation.
Conversational, informational, or social utterances without validated
physical-action authority do not replace, pause, or cancel the current Mission;
they remain conversation.

### 3.2 Incremental causal planner chooses the next Activity

A lightweight causal planner reads the Mission and current world model, then
selects the next required outcome-level `Activity`. It plans incrementally and
re-plans after every material observation, effect, interruption, or failure.

It owns deterministic completeness concerns that repeated stochastic model turns
must not carry alone:

- prerequisites and high-level method decomposition;
- exact requested and remaining quantities;
- recipes, tools, workstation and fuel dependencies;
- acquisition, custody, delivery, return, and cleanup postconditions;
- preservation of verified partial effects such as 2 of 3 items;
- selection among valid causal methods after a specialist result.

The planner does not compute voxel routes, stances, or physical reachability. It
may search causal prerequisites, recipes, inventory, workstations, resources,
placement sites, combat targets, and search regions. Those are not voxel-topology
oracles.

```ts
type ActivitySpec = {
  missionId: string
  activityId: string
  kind: ActivityKind
  requiredEffect: OutcomePredicate
  preconditions: OutcomePredicate[]
  permissions: PermissionSet
  specialist: SpecialistId
  atomicity: 'incremental' | 'atomic' | 'returnability-critical'
}
```

### 3.3 Request-first arbiter chooses who may own the body

Arbitration uses hard, lexicographic priority bands:

1. Operator Stop / Hold
2. emergency reflex
3. critical survival
4. current player Mission
5. normal survival
6. optional role or opportunity
7. idle

Utility may rank peers only within one band. It cannot make optional work outrank
a player Mission or survival outrank Operator Hold. Deterministic policy may
forbid an action and must name the rule; it may not declare physical impossibility.

Reflex suppresses the current Activity, resolves one hazard, and returns control.
The Mission resumes by planning from current reality, never by replaying a stale
closure or specialist call.

### 3.4 ActivityExecutive owns one physical body lease

`ActivityExecutive` evolves `ActionManager`. It is the sole owner of the physical
body lease. The lease spans start, graceful cancellation, forced halt if needed,
and verified physical settlement.

```ts
type ActivityRecord = {
  missionId: string
  activityId: string
  specialist: SpecialistId
  lifecycle: ActivityLifecycle
  startedAt?: number
  lastProgressAt?: number
  cancelRequestedAt?: number
  cancelAcknowledgedAt?: number
  forceHaltAt?: number
  settledAt?: number
  worldRevisionAtStart: number
  worldRevisionAtEnd?: number
  outcome?: ActivityOutcome
}

type ActivityLifecycle =
  | 'RUNNING'
  | 'WAITING_FOR_INPUT'
  | 'CANCELING'
  | 'SETTLING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'ABORTED_UNSETTLED'
```

Lifecycle rules:

- `requestHalt(reason)` is graceful. It asks the specialist to stop at a safe
  boundary and waits for halt acknowledgement.
- `forceHalt(reason)` escalates specialist-specific cancellation after graceful
  halt has failed or safety requires escalation.
- A deadline can trigger escalation or an `UNKNOWN` reason. It never releases the
  lease merely because time elapsed.
- The lease releases only after specialist halt acknowledgement and observable
  physical settlement: no continuing navigation, digging, combat, collection,
  window transaction, vehicle control, or delayed callback able to mutate the
  body for that Activity.
- `WAITING_FOR_INPUT` is a logical pre-execution or suspended state, not physical
  ownership. The prior physical specialist must be acknowledged and settled
  before the Activity enters it, and the waiting Activity never retains the body
  lease. The pending Activity identity and required effect remain bound to the
  mission/activity/clarification token. When a matching answer arrives, the
  planner revalidates and re-plans rather than blindly continuing stale
  specialist calls.
- If settlement cannot be established, lifecycle becomes
  `ABORTED_UNSETTLED`. The body is quarantined and requires controlled runtime
  restart before new physical work. Kevin must not pretend the Activity stopped.
- `LegacyPromiseActivity` is only a migration wrapper for old promise-shaped
  skills. It receives no exemption from lease, halt, telemetry, or settlement
  rules and is removed after specialist replacement evidence exists.

### 3.5 Specialist adapters own mechanics

Specialist adapters translate an `ActivitySpec` into the mature package that owns
its mechanics. Initial adapters are Pathfinder and CollectBlock; later adapters
cover Craft, Furnace, PvP, Placement, Vehicle, and Container behavior.

Each adapter must expose:

- start with mission/activity/specialist correlation;
- progress observations;
- `requestHalt` and halt acknowledgement;
- `forceHalt` where the package supports an escalation;
- settlement observation;
- a typed `ActivityOutcome` based on world and engine evidence.

Mineflayer core and mature plugins own locomotion, route execution, interaction,
combat execution, collection, tool choice, armor, eating, inventory mechanics,
containers, crafting, smelting, and vehicles. Project code owns Mission meaning,
causal prerequisites, target selection, permissions, priority, and acceptance.
Thin wrappers do not make non-cooperative mechanics safe by magic; each adapter
must prove its package-specific halt and settlement contract.

### 3.6 Pathfinder is the only voxel-topology oracle

Pathfinder alone decides routes and physically typed movement edges. Project code
must not build a second voxel A*, stance-reachability oracle, dry-path scan, or
waypoint system that claims world impossibility.

Navigation semantics:

- Owned `goto()` already executes and tolerates partial paths while its search
  continues. Do not add a global loop that walks partial results and re-plans.
- Audit individual preflight and probe consumers. For ordinary incremental
  navigation, `partial` means `RUNNING`; search timeout means `UNKNOWN`.
- Only a completed `noPath` under the effective `Movements` profile rejects that
  particular method. It does not establish impossibility under other profiles.
- Keep terminal or round-trip proof only for an explicitly atomic or
  returnability-critical transaction, and record why that stronger proof is
  required.
- Long journeys may use policy-selected bounded destinations, but Pathfinder owns
  whether each route is traversable, with the relevant action classes enabled.
- Critical survival seeks stable dry land; Pathfinder computes the route.

At every specialist call site, record the effective `Movements`: traversal
profile, dig/place/tower/parkour permissions, costs, exclusions, and scaffold
source/cleanup authority. Shipping Kevin already asks for `full`. A restricted
profile can be valid for a named policy, but its `noPath` describes that profile
and triggers a broader allowed profile or a named refusal—not a world-level claim.

### 3.7 Versioned world model observes; it does not command

The world model is a versioned observation store:

```ts
type WorldModel = {
  revision: number
  observedAt: number
  bot: BotObservation
  players: PlayerObservation[]
  inventory: InventoryObservation
  threats: ThreatObservation[]
  workstations: WorkstationObservation[]
  landmarks: LandmarkObservation[]
  activityTelemetry: ActivityObservation[]
}
```

Observations carry provenance, freshness, and revision. The world model supplies
facts to planning, arbitration, verification, and explanation. It has no behavior
authority and may not dispatch, veto, or retain body ownership.

## 4. LLM and deterministic boundaries

The LLM:

- interprets natural language before any deterministic plain-language router;
- proposes a Mission and high-level causal methods;
- explains unfamiliar failures using typed outcomes;
- asks one bounded question when a materially ambiguous choice has no safe default;
- converses naturally while deterministic work proceeds.

Deterministic policy:

- validates identity, permissions, protected terrain, Operator Hold, and
  consequential authority;
- rejects forbidden actions with a named rule;
- never substitutes a canned command for plain language before the model sees it.

Causal planning, not repeated model luck, owns prerequisites, exact quantities,
workstation dependencies, delivery, return, and cleanup. An explicit player
`!command` remains a direct invocation and still passes policy and body-lease
validation.

## 5. Clarification without global freeze

A question is bound to `missionId`, `activityId`, and a one-use clarification
token. Only the materially ambiguous Activity may enter `WAITING_FOR_INPUT`, and
only when no safe default can satisfy the Mission.

While waiting, Kevin may converse, defend himself, obey Operator Stop/Hold, and
perform non-conflicting maintenance. He must not execute the ambiguous irreversible
choice. An answer with the matching token updates the Mission and causes replanning;
a stale or cross-mission answer cannot authorize anything.

The Mission status may be `WAITING_FOR_INPUT` while only that Activity is blocked.
The waiting Activity does not own the body: the body lease is free for higher-band
or non-conflicting work, subject to the arbiter.

Campaign M3 is canonical: when asked to give the sole Bread to "one of us," Kevin
keeps custody, asks exactly once, binds the recipient answer, then delivers and
waits. Ordinary reversible ambiguity uses a safe default and continues. Attack,
leave, restart, bot spawning, sole-item transfer, destructive placement, and
similarly consequential choices may wait when authority is unresolved.

## 6. Outcomes and player-facing truth

Lifecycle, verified effect, reason, retryability, and evidence are orthogonal:

```ts
type ContinuationKind =
  | 'resume_same'
  | 'replan_current'
  | 'retry_after_material_change'
  | 'disengage_then_resume'
  | 'terminal'

type ActivityOutcome = {
  lifecycle: ActivityLifecycle
  effect: {
    complete: boolean
    progress: boolean
    amount?: number
    requested?: number
    worldRevision: number
  }
  reasonClass: 'ENGINE' | 'POLICY' | 'BUDGET' | 'CANCEL' | 'SETTLEMENT' | 'UNKNOWN'
  reasonCode: string
  retryable: boolean
  continuation: {
    kind: ContinuationKind
    incidentId?: string
    preemptorActivityId?: string
  }
  evidence: EvidenceRef[]
}
```

`did`, `engine_cannot`, `we_will_not`, and `unknown` are player-facing renderings,
not the internal result type. Preserve partial success: if 2 of 3 items are
verified, report 2 of 3 and leave the Mission open for the remaining one. Never
collapse timeout, cancellation, policy, partial progress, or unsettled ownership
into "unreachable" or generic failure. Gameplay capability implementations use
the typed outcome; legacy `{ ok, why }` primitives may be adapted during migration
but are not the final Activity contract.

The exact settled `ActionResult` produced by `ActivityExecutive` travels back to
its dispatching consumer in the same execution envelope. `agent.last_action_result`
may remain a bounded telemetry and migration projection, but Agenda, Job, Goal,
Capability, and Survival consumers must not rediscover their own result from that
shared mutable field. Preserve the public command value for conversation and
parse/argument errors; internal callers receive both the legacy value and the
correlated result rather than changing every command into a new public API.

`continuation.kind` is finalized after physical-effect and capability verification,
so a reconciled success cannot retain a stale failure continuation. It expresses
orchestration meaning only; successful planner progression remains owned by the
planner's verified `nextPhase`. Legacy codes may be translated in one compatibility
mapper during migration, but migrated consumers do not independently regex-match
reason strings to decide whether to resume, replan, change method, disengage, or
terminate.

`terminal` means no permitted causal method can satisfy a remaining Mission
predicate, or physical settlement is unproven and the body must be quarantined. A
failed route, target, region, tactic, job, or workstation stance is not terminal
while an allowed materially different method remains. `retryable` keeps its
method-level meaning and is never a substitute for the continuation contract.

## 7. Persistence

- Ordinary Mission work is in memory by default and may disappear on restart.
- Operator Hold survives restart and never auto-releases.
- Durable knowledge survives: home, landmarks, saved sites, remembered events,
  people, procedures, and verified facts.
- In-flight specialist calls, Activity leases, work orders, and directives do not
  resume across restart.
- After reflex, Mission continuation re-plans from the current world revision.
- Do not restore an obligation ledger, cross-session task replay, or stale closure
  resumption.

## 8. Invariants

1. Exactly one component—the ActivityExecutive—owns the physical body lease.
2. No lease release occurs before halt acknowledgement and physical settlement.
3. Unsettled ownership quarantines the body until controlled restart.
4. Hard priority bands dominate utility.
5. A current player Mission dominates normal survival, optional work, and idle.
6. Plain language reaches the LLM before deterministic routing.
7. Deterministic policy validates permissions; it does not invent physics facts.
8. Pathfinder is the only voxel-topology oracle.
9. A timeout is inconclusive; only completed `noPath` rejects a method under the
   effective movement profile.
10. Partial verified effects survive and keep the Mission open.
11. World observations have provenance and revision but no behavior authority.
12. Durable knowledge and Operator Hold survive every migration and deletion.
13. No causal/director deletion occurs before equivalent player-visible outcomes
    repeatedly pass.
14. The consumer that dispatched an Activity settles the exact correlated result
    returned by that execution; a later global telemetry write cannot replace it.
15. Every verified settled outcome has exactly one post-verification continuation
    kind; individual directors do not reinterpret failure strings independently.
16. A local target, route, region, tactic, job, or workstation failure cannot
    cascade into Mission failure while a permitted materially different causal
    method remains.
17. A repeated-action circuit breaker is scoped to the owning Activity, Job, Goal,
    or safety incident. It never manufactures Operator Hold when body settlement
    remains proven.

## 9. Canonical migration order

Each phase is reversible where possible, preserves existing behavior until covered,
and advances only on observable evidence.

### Phase 0 — documentation and evidence baseline

Reconcile the active engine-document packet; record current source facts; preserve the
campaign archaeology; identify current feature flags and scenario commands. This
phase changes no gameplay code.

### Phase 1 — correlation and lifecycle instrumentation

Instrument mission, activity, and specialist IDs; effective `Movements`; progress;
cancel request and acknowledgement; force-halt request; settlement; body-lease
owner; and world revision. Instrument before changing semantics so the old and new
paths can be compared.

**State: `ACCEPTED / CLOSED`.** Do not replay this phase as a confidence campaign.

### Phase 2 — ActivityExecutive plus first adapters

Evolve `ActionManager` into `ActivityExecutive`. Add Pathfinder and CollectBlock
adapters with graceful halt, escalation, settlement, progress, and lease tests.
Place remaining skills behind `LegacyPromiseActivity`. Prove interruption and
settlement directly; never infer them from elapsed time.

**State: `ACCEPTED / CLOSED`.** Pathfinder and CollectBlock lifecycle acceptance is
durable and is not reopened by later provider, telemetry, harness, or cleanup work.

### Phase 3 — one Mission family and causal planner

Add `MissionStore` and the incremental causal planner for one item-fulfillment
family using charcoal. Cover prerequisites, exact quantity, workstation/fuel,
custody, delivery, return, cleanup, partial success, reflex interruption, and a
bounded clarification. Keep legacy routing behind a reversible comparison flag.
Run the charcoal acceptance campaign with each relevant per-consumer preflight gate
in legacy mode and in bypass or shadow-comparison mode, with only the selected path
controlling the body. Compare outcomes and lifecycle evidence so planner acceptance
is not confounded by one refusal layer. This measurement does not authorize Phase 4
demotion or deletion.

**State: `ACCEPTED / CLOSED`.** The final preserved aggregate result completed both
direct and natural-language forms, delivered exactly eight charcoal to the physical
requester, captured complete evidence, and reported no missing fields, blockers,
timeouts, retries, deaths, conflicts, unsafe state, or safety violations. Do not run
this campaign again without explicit per-run Director authorization.

**Accepted control-plane sub-boundary — 2026-08-20.** A validated replacement now
uses the existing ActionManager halt owner and awaits both its stopped result and
the correlated Mission Activity settlement before `MissionStore` installs the new
promise. Invalid replacement input does not request a halt; a failed or unproven
halt leaves the old Mission current. The focused Mission file passes `7/7`, and
the adjacent ActionManager lifecycle/correlation files pass `14/14`. This does not
reopen the accepted charcoal gameplay campaign or accept the separate explicit
`!cancelMission` in-flight handoff path.

### Phase 4 — preflight/probe audit and reversible demotion

Inventory consumers of the current preflight/probe families —
`probeSafeNavigationGoal`, `probeSafeNavigationFrom`,
`probeSafeRoundTripNavigationStances`, interaction-stance preflights, collection
route probes/selectors, `requirePlannedRoute` consumers, and the
`runSegmentedJourney` waypoint mechanism — plus round-trip proofs, stance scans,
and the mining corridor planner. Demote only gates whose replacement path is
covered, behind reversible flags. Keep stronger proof for named atomic or
returnability-critical transactions. Do not change the global partial executor or
global traversal policy.

**Accepted sub-boundary — 2026-08-20.** `probeSafeNavigationFrom` and
`probeSafeNavigationGoal` now preserve whether a search was conclusive, and the
strict `goToGoal` preflight treats only completed `noPath` as method rejection.
The isolated `route-probe-inconclusive` Scenario Lab result passed both local
explicit-command transports with `timeout`, retryable `route_unproven`, zero
travel, no terrain mutation, complete settlement/restoration, and no safety
violations. This closes only that truth contract. Other Phase 4 consumers,
demotions, and flags remain `PENDING` and require a new authorized tranche.

**Accepted static sub-boundary — 2026-08-20.**
`probeSafeNavigationStances` now preserves the same `conclusive` result on its
normal wrapper path instead of returning a branch-dependent object shape. An
isolated timeout probe demonstrated the missing field before repair; the focused
contract test now proves `false` for `timeout` and `true` for completed `noPath`
and `success`, and the full critical-runtime file passes `24/24`. This is a
source/result-contract closure only. It does not accept, demote, or physically
exercise construction-site, interaction-stance, shelter, segmented-journey,
round-trip, collection, or other Phase 4 consumer behavior.

**Accepted consumer sub-boundary — 2026-08-20.** `reachInteractionStance` now
rejects only a completed conclusive `noPath`. An inconclusive advisory result uses
the original interaction goal for real incremental Pathfinder execution, while
later interaction remains blocked until the stance receipt is `ready`. Focused
checks pass `7/7`. The isolated physical result at
`artifacts/interaction-stance-inconclusive-20260820-r4/live-report.json` records a
real producer `timeout`, 70.19 blocks of Pathfinder movement to the original legal
stance, settled ownership, no later interaction, intact inventory and terrain,
complete fixture/runtime restoration, and zero provider calls. Other Phase 4
consumers remain `PENDING`.

**Source review completed — 2026-08-21.** The remaining round-trip, construction,
cave/ore, segmented-journey, mining relocation/staging, and surface-egress
consumers now distinguish a completed conclusive `noPath` from an unfinished route
search. Unfinished searches remain retryable and do not authorize construction or
terrain mutation. Candidate and journey attempt cutoffs without an owning boundary
were removed; existing deadlines, cancellation, physical progress, and exhaustive
finite candidate sets now own termination. Focused files pass segmented navigation
`48/48`, critical runtime `27/27`, mining geometry `19/19`, and the explorer/work-
order route contracts including the 129th-candidate case. This closes the Phase 4
source-consumer review. It does not claim the separate Phase 6 physical terrain
acceptance.

**Player-directed consumer acceptance — 2026-08-22.** Recorded play showed
`goToPlayer` repeatedly returning inconclusive `route_unproven` with zero movement
over a long-distance player separation. Kevin's active `full`
traversal profile and `safeMovements` already enabled ordinary walking, jumping and
parkour, scaffolding, block breaking, and tool-aware mining, but the player's
managed-region and live `GoalFollow` calls required a complete preflight and could
therefore veto every native edge before execution. Those two ordinary incremental
calls now enter owned `goto()` directly. The owned Pathfinder retains partial A*
state, walks the best known partial route, and replans as terrain loads; action
cancellation, stall detection, protected/hazard block exclusions, and final
player-relative settlement remain unchanged. Strict preflight and segmented
journeys remain available to explicitly atomic or returnability-critical consumers.
For exact player pursuit, a legal outer `GoalFollow` stance is refined against the
continuous body-distance contract. When exact arrival remains impossible, the
shared attempt captures native A*'s best `noPath` endpoint and also recognizes
strict physical goal-metric improvement already consumed before a timeout or final
stall. Player navigation preserves that closest stance as `closest_reachable` or
`closest_explored`, returns false, and emits a retryable failed terminal receipt;
it never converts partial progress into false arrival. The temporary response-loop
material-change blocker was also removed so repeated player-route attempts reach
ActionManager.

The live breakable-obstruction aggregate at
`validation-output/player-route-obstruction-2026-08-22T18-43-22-588/player-route-obstruction.result.v1.json`
passed both transports: real Pathfinder broke the two-block dirt plug, crossed the
wall, refined to 3.000 blocks from the stationary player, ended `skill_arrived`,
settled under Hold, and restored the fixture/runtime. The complementary sealed-
bedrock aggregate at
`validation-output/player-route-best-reachable-2026-08-22T19-17-21-939/player-route-best-reachable.result.v1.json`
also passed both transports: Kevin made real progress to 6.179 and 6.185 blocks,
ended retryable `skill_closest_explored`, preserved the shell and terrain, remained
stable through the observation window, and restored the fixture/runtime. Both
aggregates contain complete evidence and zero safety violations. Focused runtime
checks pass `30/30`; Scenario Lab control-plane checks pass `38/38`. This player-
directed consumer boundary is `ACCEPTED / CLOSED`.

### Phase 5 — variance matrix

Run a discriminating matrix: no-LLM recorded trace; frozen model; clean t0 fixture;
lifecycle telemetry; and preflight on/off. Do not attribute variance to the model,
lifecycle, pathfinder, or preflights until the matrix separates them.

**Measurement and acquisition contract prepared — 2026-08-21.**
`tools/scenario-lab.mjs variance` validates and compares independently reset
observations across the required recorded-trace/frozen-model,
lifecycle-telemetry, and preflight axes. It fails closed on t0/input/driver
drift, reused reset identities, missing fingerprints, or unsettled activity
boundaries and reports matched source signals without promoting association to
root cause. Conversation telemetry exposes hashes for the configured model,
initial clean-t0 prompt/history input, selected provider route, and returned
output without exposing their contents; the Scenario Lab harness preserves
those measurements independently of compact movement samples.

`tools/scenario-lab/run-variance-matrix.mjs` now owns the isolated acquisition
path for the seven fixed request-completion cases. The comparison minimum is two
independent trials, producing 112 cells across recorded-trace/frozen-model,
telemetry off/on, and preflight advisory/strict. Every cell gets a fresh bot
process, memory, generated world, exact inventory/t0 contract, physical outcome
check, and terminal settlement check. The no-LLM arm serves one declared response
through a loopback OpenAI-compatible endpoint while retaining the production
prompt and command path. The frozen-model arm pins one configured model route;
it cannot silently fall through to the fixture's ordinary fallback entry.
Settled physical failures remain valid `passed: false` observations instead of
being discarded as incomplete evidence. Setup, transport, corrupt-evidence, or
unsettled-cleanup failures still fail closed. Terminal provider failure now exits
the conversation prompt loop after the already-exhausted model route rather than
spending a second prompt turn.

The coordinator is resumable, reuses valid cells, preserves failed attempt
artifacts, and rejects cells from different source fingerprints. An exact cell
selector permits one new boundary to prove acquisition before a broader run;
partial results remain in the same matrix directory and cannot claim a complete
variance verdict. Its read-only
plan resolves the current workspace to 56 local recorded-trace cells and 56
single-route `codex / gpt-5.6-luna` cells through the logged-in ChatGPT OAuth
session. The 112 configured outcome windows total 6.13 hours before isolated
startup and cleanup time; the full run should be planned as roughly 8-12 hours
until live timing exists. Up to 112 Codex subscription requests are configured if
every frozen-model cell consumes both prompt turns for generated-answer
correction; no API-key-billed OpenAI route belongs to Kevin's matrix. A terminal
provider failure stops after one call. Preflight `off` means advisory/advisory
consumer policy, not that the route probe is removed; `on` means strict/strict.

The local recorded provider retains only fingerprints and non-sensitive UTF-8
size measurements for the compatible request, prompt, conversation content,
and recorded response. It does not retain prompt text or invent zero token usage;
the measurements provide the first physical smoke's input for the separately
required paid-run cost estimate.

Scenario Lab validation and focused tests pass `35/35`; adjacent provider and
model-lifecycle checks pass `16/16`; focused syntax, PowerShell parsing, ESLint,
veto, wiring, silent-failure, and readiness checks pass. The accepted first
recorded-trace observation remains at
`validation-output/phase5-variance-20260821-v3`; it passed the exact physical
four-log delivery and all evidence/cleanup checks with one matching provider
request.

The authorized isolated full-matrix run at source snapshot `00aa2bb` preserved
four valid local recorded-trace reports under
`C:\Users\zerop\Development\minecraft-companion-brain-v2-phase5-matrix-00aa2bb\validation-output\phase5-variance-20260821-v4`.
All four physically delivered the exact four oak logs and passed evidence,
settlement, restoration, and cleanup. The run then stopped on the first
frozen-model cell because provider `openai-api` returned
`credit_balance_exhausted`: the configured OpenAI API project had no usable
credit or spend allowance. No retry, fallback, or route switch occurred; all
isolated processes stopped and ports were released. The saved
`acquisition-state.v1.json` incorrectly reports zero completed cells even though
four valid cell reports exist. Resumption scans the reports directly, so the
evidence is usable, but the progress-summary defect remains open. The remaining
reports and the variance verdict were pending when the provider failure stopped
that attempt.

**Provider-route defect corrected — 2026-08-21.** The matrix resolved its frozen
route by taking the delivery fixture's primary conversation model. That fixture
still named `openai / gpt-4.1`, so the worker faithfully selected a separately
billed API project instead of Kevin's existing Codex OAuth provider. The owning
Kevin and delivery-fixture configurations now use `codex / gpt-5.6-luna` for
conversation, reasoning, autonomy, and memory; the matrix plan reports ChatGPT
subscription access and retains a single frozen route with no fallback. The
ordinary `settings.js` and launcher defaults now select that Kevin profile through
the existing shared profile-path constant. The machine was observed logged in
through ChatGPT. Because the selected provider is
part of the matrix plan and provenance, the four reports from the stopped
API-routed attempt remain preserved evidence but do not claim completion in the
corrected Luna matrix. The corrected matrix is `0/112`; the Director explicitly
authorized its physical execution on 2026-08-21 without another authorization
ceremony. It has not started. The source of the historical variance remains
unknown. The old seven-case request-completion probe reused one bot process,
history, and mutable world and acknowledged message relay rather than physical
settlement; its four aggregate totals cannot populate the controlled matrix.

### Phase 6 — isolated physical terrain probes

Probe tower, bridge, dig-through, stair-tunnel, swim-exit, descent-return, and
interruption on controlled terrain. Verify effective movements, progress,
settlement, protection, scaffold accounting, and returnability where required.
These are package-mechanism probes, not a second topology planner.

**Swim-exit accepted — 2026-08-21.** The first physical run exposed a fixture
defect: clearing the course to air left a hollow dirt-free subgrade, so real
Pathfinder legally routed beneath the intended bank. Restoring solid dirt beneath
the grass repaired the owning fixture. The second run then separated a second
fixture defect: the controlled observer occupied the exact goal block, allowing
one transport to arrive while the other stopped 1.31 blocks away and timed out.
Moving the observer off-goal removed that interference.

The post-repair result
`validation-output/terrain-swim-exit-2026-08-21T22-57-42-927/terrain-swim-exit.result.v1.json`
passed both isolated explicit-command transports in 42.381 seconds with complete
evidence and zero retries, blockers, missing evidence, missing fields, timeouts,
deaths, conflicts, unsafe state, or safety violations. Both transports physically
ascended from `(1029.5,96,1008.5)` to the dry bank near
`(1038.30,100,1008.50)` through real Pathfinder under `full` traversal and ended
correlated `skill_arrived`. Terrain remained intact, inventory/scaffold counts
remained empty, Hold was stable, and fixture/runtime cleanup completed. The
focused fixture assertions and neighboring Scenario Lab/pathfinder checks pass.
Swim-exit is `ACCEPTED / CLOSED`.

**Composed terrain workarounds accepted — 2026-08-25.** The controlled
`terrain-workaround-chain` course exercised one uninterrupted explicit
`!goToCoordinates(1052,107,1008,0,false)` action through real Pathfinder under
the `full` traversal profile. The accepted physical result is
`validation-output/terrain-workaround-chain-2026-08-25-direct-r17/follow-field-evidence.json`.
Kevin cleared the two-cell dig wall, executed the three-block parkour landing,
placed two horizontal bridge blocks, placed a two-block 1x1 tower, excavated all
nine stones across three rising stair-tunnel edges, settled the controlled
three-block descent, entered and ascended the contained four-block water column,
and settled dry at `(1052.5,107,1008.5)`. The single correlated action ended
`skill_arrived` after 17.982 seconds. Inventory and post-run world state agree:
four dirt consumed equals two bridge plus two tower blocks, all nine tunnel
stones are air, the iron pickaxe remains present, and the water column and grass
bank remain intact.

The saved report retains a false aggregate bit from the pre-repair swim
checkpoint, which still bounded the old `x=1049` shaft after the contained shaft
moved to `x=1050`. The owning predicate now derives the occupied water cell from
`TERRAIN_CHAIN_WATER`; reevaluating the saved 100 ms physical trajectory records
all eight checkpoints in order through swim surface and dry goal. No duplicate
gameplay run was performed for that evidence-only coordinate correction. The
executor repair binds a three-block parkour edge to a verified runway, settles
inside the physical destination block before handing off the next edge, and
normalizes centered and raw post-processed path coordinates to the same landing
cell. Course bedrock only constrains bypasses; Mission, ActionManager, A*, and the
package-owned movement producers remain the one real execution stream.

Dig-through, parkour, horizontal bridge, 1x1 tower, stair-tunnel, controlled
descent, swim-exit, and dry-arrival composition are `ACCEPTED / CLOSED`. Existing
Phases 1–2 interruption evidence remains authoritative because its ownership did
not change; another interruption run would add no material delta. Phase 6 is
`ACCEPTED / CLOSED`.

### Phase 6B — dynamic escape and Mission resumption

**State: `ACCEPTED / CLOSED` — 2026-08-26.** The controlled Phase 6 course first
established that the owned Pathfinder can execute the required movement vocabulary
and can compose it when a course exposes the sequence. The later non-course run
closed the separate live-selection and Mission-resumption boundary below.

The required outcome was for Kevin to encounter previously unencoded live confinement
while pursuing a player Mission, use the effective `Movements` profile and native
Pathfinder search to select and revise whatever dig, parkour, bridge, tower,
stair-excavation, descent, swim, or shoreline-exit combination the observed
geometry requires, reach a stable supported exterior stance, and then resume the
same Mission from current reality. Material block changes and partial progress
must feed native replanning; they must not become a scripted microstep list,
project-computed escape route, duplicate topology planner, or blind repetition of
the last failed action. ActionManager retains the one body lease through escape,
settlement, and Mission handback. Protected or intentionally sealed terrain must
remain intact and produce a truthful remaining-problem outcome rather than false
arrival or an infinite retry.

Acceptance requires a player-valued, non-course composition in which the escape
sequence is selected from live geometry, uses multiple required workaround modes,
settles safely with terrain and scaffold custody accounted for, and resumes or
completes the interrupted Mission. Replaying the accepted Phase 6 obstacle course,
adding another verifier, or demonstrating isolated movement primitives cannot
close this boundary.

**Accepted controlled sub-boundary — 2026-08-26.** A generated delivery fixture
began with an open route, accepted one durable `deliver 1 cobblestone` Mission,
and rewrote the route only after GoalDirector's terminal `givePlayer` Activity had
Pathfinder ownership. Both the explicit typed request and ordinary “Bring me one
cobblestone” request then completed dig-through, parkour, bridge, tower, stair
excavation, descent, swim exit, ground return, and the original delivery under one
native `GoalFollow` search with material replanning. The natural arm reached Luna
first, selected `!requestItemGoal`, and its terminal handoff carried
`routeOrigin: goal-director`; no second model request occurred. All ten physical
checkpoints, exact one-item custody, four-block scaffold consumption, stable
settlement, fixture restoration, and runtime cleanup passed. Evidence is preserved
under `validation-output/dynamic-escape-delivery-2026-08-26T15-00-09-649` and
`validation-output/dynamic-escape-natural-goal-promotion-20260826-01`. Because the
geometry is a generated controlled course, it did not by itself close the required
player-valued non-course live-world composition.

**Accepted non-course live-world boundary — 2026-08-26.** In the continuously
running saved survival world, DirectorTest asked naturally for one cobblestone while
Kevin was confined at y=17 below the requester at y=91 in a natural cave/trial-
chamber region. DeepSeek selected the typed delivery Goal once. The same Mission
survived repeated Breeze, Creeper, Skeleton, and other hostile preemptions; restored
the missing support beneath a preserved mining-return cell; opened successive
supported corridor legs toward the surface; consumed native closest-explored
progress instead of treating it as terminal; reached the requester on the spruce
canopy; and physically transferred the cobblestone. Paper inventory truth confirmed
the requester held exactly one cobblestone.

That run also exposed two terminal-boundary defects rather than justifying a replay.
The exact collect packet could arrive while Kevin began reclaiming the drop, so the
recipient received it while the Mission falsely reported `skill_pickup_unverified`;
the handoff selector also searched only four perfectly cardinal cells and could not
use the live canopy's safe one-by-two offset. The receipt owner now honors that
verified collector immediately after reclaim, the bounded stance selector searches
supported near-cardinal block-grid lanes, and GoalDirector no longer repeats an
unchanged `skill_drop_stance_unreachable` Activity. After a Kevin-only restart, one
current-source delivery Goal moved to a supported leaf stance 2.2 blocks from the
stationary requester, completed its only `givePlayer` subgoal as `skill_delivered`,
and closed `delivery_verified`; Paper showed Kevin's granite count 42 -> 41 and
DirectorTest's 0 -> 1. The saved server, world, and controlled players stayed up.
The natural chain plus the direct re-exercise of its repaired terminal boundary
closes Phase 6B without replaying the completed journey.

### Phase 6A — autonomous expedition and player guidance

**Village expedition accepted — 2026-08-25.** The natural-language request was
“Find a village, remember it, come back to me, then take me there.” The Scout job
verified a taiga settlement by its bell at `(781,66,-775)` together with loaded
villager/bed evidence, persisted it as `nearby_village`, and retained that finding
through interruption and restart. The saved continuation “Come back to me, then
take me to the village you found” resumed the same obligation instead of searching
again.

The final physical guidance leg began near `(292.5,62,-429.3)` and ended with the
controlled player at `(774.1,65,-771.5)` and Kevin at
`(780.5,64.94,-773.5)`, 6.74 blocks apart beside the remembered bell. That roughly
590-block leg composed ordinary forest travel, steep ascent and descent, repeated
step-ups, deep-water traversal, shoreline exit, wait-for-catch-up, return-to-player,
and continued guidance in one persisted Scout agenda. A live mixed-mode failure
showed that shoreline Pathfinder released ascent during the unsupported surface
frame; `attemptShallowWaterExit` now reuses the existing surface-ascent primitive
until a dry supported stance is physically occupied. The identical blocked bank
then cleared and the route continued through another river and successive hills.

`bots/Kevin/agenda.json` records the final `complete` state with
`scout_route_complete`; `bots/Kevin/runtime-memory.json` retains the verified
`nearby_village`. Search, memory, return, and guide composition are
`ACCEPTED / CLOSED`. This closes the observed same-dimension, loaded-world
expedition contract; it does not claim portal travel or passage through protected
or intentionally sealed terrain.

### Phase 7 — remaining specialist adapters

Phase 7 covers Craft, Furnace, PvP, Placement, Vehicle, and Container ownership.
Placement is now `ACCEPTED / CLOSED`; Container has an accepted custody chain but
remains `ACTIVE` at its open-window interruption boundary. Craft, Furnace, PvP, and
Vehicle remain open. Each requires package-specific cancellation acknowledgement,
settlement evidence, partial-effect handling, and player-visible campaign coverage,
preferably inside a compound gameplay outcome rather than as an isolated demo.

**Container baseline active — 2026-08-25.** Exact chest/barrel deposit, retained-
inventory storage, withdrawal, and inspection commands now enter a Container
Activity adapter. It composes the existing Pathfinder approach with Mineflayer's
native window, records window open/close progress, closes an active window during
halt, and releases the body only after the window is closed and Pathfinder is
settled. Exact-coordinate withdrawal is now available alongside exact deposit.

In the live village world, Kevin interpreted the ordinary request to store six of
twelve oak logs, bound the chest at `(796,67,-774)`, worked around a stalled first
approach, verified six deposited, and returned with six. A later request to recover
two from that same chest first ended `skill_chest_unreachable`; Kevin moved to a
usable stance, reissued the exact-container withdrawal, verified two recovered,
and returned. Final Paper state reports four oak logs in the chest, eight on Kevin,
zero on the controlled player, and Kevin beside the player at `(779.5,64.94,-773.5)`.
`bots/Kevin/runtime-memory.json` durably records `village_supply_cache` beside the
container. The model briefly over-interpreted “come back to me with them” as a
delivery request; the player's correction was honored and no logs were dropped.
Container is `ACTIVE`, not globally closed: this run did not interrupt a live
window transaction, and Craft, Furnace, PvP, and Vehicle adapters remain open.

**Placement compounded shelter accepted — 2026-08-26.** `placeBlockAt`,
`placeHere`, and fixture placement now enter a native Placement Activity adapter.
The adapter observes the exact material-binding-through-world-confirmation interval,
keeps its body lease while a placement is active, and requires both placement and
Pathfinder settlement before release. The existing JobDirector, Builder blueprint,
site selection, and Mineflayer placement remain the mechanical owners.

The live outcome was one continuous survival-world chain, not an isolated placement
probe. A partially built spruce emergency shelter survived repeated hostile
preemptions and checkpointed progress. Repairs cleared stale worksite-surface state,
made completed work re-audit after occupancy movement, allowed explicit revalidation
of terminal work, and rebound both automatic and explicit 3x3 shelter retries to the
dominant non-natural material already present in their footprint. Kevin was later
displaced roughly 56 blocks; a persistent follow automatically resumed after several
self-preservation interruptions, returned him to the requester and original worksite,
and Builder repaired only the changed roof cells. The final revalidation completed
23/23 after Kevin entered. Paper directly confirmed all 23 spruce cells, both open
door cells, both open interior cells, and Kevin grounded inside at
`(215.5,84,-382.5)`. Health was 18, hunger 16, no path or body hold remained, and
the same Paper world and controlled players stayed live throughout. This Placement
boundary is `ACCEPTED / CLOSED`; do not reopen it with standalone block-placement
runs. Future compositions may traverse it when a larger outcome materially depends
on it.

**Functional-base commissioning accepted — 2026-08-26.** In the continuously
running saved survival world, the explicit Builder order
`builder-e4fc91b9-ce7b-4801-b76d-fa5c34566352` selected and completed a 5x5
cobblestone shelter at `(765,65,-767)`. The order preserved its site and progress
through hostile interruptions, death and exact inventory recovery, underground
material acquisition, return-route excavation, an occupied interior, a blocked
interaction stance, and a failed distant coal search. The final causal workaround
used the already installed furnace at `(768,66,-764)` and carried spruce to make
charcoal, crafted sticks and four torches, placed the required interior torch at
`(766,66,-765)`, and closed `blueprint_complete` with checkpoint `85/85`.

Kevin then used the installed chest at `(768,66,-766)` as an actual base cache in
one exact retained-inventory transaction: 69 dirt, 26 granite, 10 diorite, and 32
clay balls were stored while the requested carried set was preserved. Paper
directly confirmed those 137 items, the chest, furnace, crafting table, torch,
spruce door, cleared interior cell, and opposite roof corners after the transfer.
Difficulty was restored to Easy; Paper and Kevin remained live. No provider call
was used for the terminal smelt, craft, placement, or storage chain. Functional-
base commissioning is `ACCEPTED / CLOSED`; it does not close the still-unexercised
Craft/Furnace cancellation boundaries or Container's open-window interruption.

The Phase 7A workshop outcome is an **operational workshop expedition**, not isolated
Craft, Furnace, or Container demonstrations. From the accepted base, Kevin must
bind home and its exact fixtures, prepare for and survive a cave expedition,
acquire enough iron and fuel for multiple durable upgrades, return to the same
base, smelt and manufacture the requested kit, cache it in the installed chest,
return to the requester, and settle with inventory, terrain, and base truth
accounted for. The existing resource-project Agenda, GoalDirector prerequisite
planner, jobs, and specialist adapters own the chain; do not script its phases as
independent admin actions.

#### Phase 7A — composition strengthening through the operational workshop

**State: `ACTIVE — PARTIAL`; path retained from 2026-08-26.** This is one architecture-completion
tranche and one player-valued acceptance outcome. No isolated specialist demo,
confidence matrix, new orchestrator, Phase 8 lane collapse, branch cleanup, or
later gameplay mechanism may displace it unless the Director explicitly changes
priority. Do not restart the accepted base, reissue the project as a new Agenda,
or manually drive its phases.

The canonical transition is:

```text
ordinary request
  -> one Mission and persisted resource-project Agenda
  -> next outcome-level Activity
  -> request-first arbitration
  -> one ActivityExecutive / ActionManager body lease
  -> package-owned specialist mechanics
  -> exact correlated result plus physical settlement
  -> verified effect, checkpoint, custody, negative knowledge, and continuation
  -> atomic project transition
  -> replan the same Mission from current reality
```

No layer may replay a stale command, discover its own result from a later global
telemetry write, independently reinterpret the same failure, advance a dependent
Agenda entry before the transition commits, or report success before the physical
acceptance predicate is true.

“Atomic project transition” is an execution-order contract, not a new database or
receipt ledger. One immutable correlated transition input is delivered to the
existing owners; each owner updates its own projection; no next Activity may
dispatch until the required Job/Agenda/Mission projections acknowledge that same
transition. Do not add gameplay evidence envelopes or a universal transaction
store.

##### Locked implementation chain

Complete these actions in order. They are one coherent tranche; a later action
may expose a defect in an earlier one and send work back to its owning boundary,
but it does not authorize a parallel mechanism.

`CS-1` and `CS-2` may be coded sequentially but are accepted together: typed
continuation carried over shared mutable result state would preserve the race it is
supposed to remove. Each later action depends on that exact-result foundation.

| ID | Required action and owner | Acceptance criteria |
|---|---|---|
| `CS-1` | **Deliver the exact result directly.** Preserve the existing public command value while carrying an internal `{ value, result }` execution envelope from `ActionManager.runAction` through command execution to Capability, Survival, Job, Goal, and Agenda. `last_action_result` becomes telemetry and compatibility only. | The initiating consumer receives the exact `actionId` returned by its dispatch; a later reflex/survival result cannot replace it; request, Mission, Activity, order, and dispatch-generation correlation remain intact; stale callbacks are still rejected; player-facing strings and parse/argument failures remain compatible; every workshop-path consumer stops reading `last_action_result` to discover its own result. |
| `CS-2` | **Finalize one typed continuation and commit one checkpoint.** Extend the existing result/outcome contract with `continuation.kind`; finalize it only after capability and physical-effect verification; atomically merge verified physical delta, partial custody, world revision, negative target/region/method knowledge, source WorkOrder checkpoint, Agenda state, and remaining Mission predicates before replanning. One mapper in `action-result.js` may adapt legacy codes. | A settled higher-priority interruption yields `resume_same` without spending productive attempts; verified partial progress yields `replan_current` with its checkpoint preserved; an unchanged failed method may yield `retry_after_material_change`; a failed response to the same safety incident may yield `disengage_then_resume`; unproven body settlement yields `terminal` and quarantine; a reconciled success cannot carry a stale failure continuation; migrated consumers do not regex-match codes to choose continuation. |
| `CS-3` | **Contain local failure and localize the loop breaker.** Make Mission acceptance, not a child status, authoritative. Agenda dependency failure becomes terminal only after causal alternatives are exhausted. Enrich the repeated-action signature with durable owner/order identity, phase/checkpoint, target, and a material-progress token; return the scoped continuation to that owner instead of calling global `holdPosition`. | A repeated automatic launch is prevented; the body is settled; Operator Hold remains false; the same Agenda entry and Job/Goal identity remain persisted; scheduler delay alone cannot reopen the circuit; a changed checkpoint, target, phase, verified effect, materially different method, or fresh player command can reopen it; productive attempts and preemption budgets are not spent by the circuit; global Hold remains reserved for explicit Operator authority or genuinely unproven body settlement. |
| `CS-4` | **Escalate the existing safety incident and resume durable work.** Extend the existing SurvivalIncident/arbiter path; do not create a second recovery system. Correlate a settled failed tactic to the incident. After one retryable melee failure against the same continuing threat, latch the failed response and select the existing `objective: 'disengage'`; verified safety then returns control to the exact interrupted WorkOrder. | Cancellation or higher-priority preemption is censored rather than counted as a tactical failure; fresh damage from the same threat cannot erase the escalation latch; the next response to that incident is disengagement, not identical melee; a different hostile retains an independent decision; verified retreat advances the incident to recovery; reflex cannot reacquire the same threat while Survival owns cover/rendezvous; closure requires verified clearance, cover/line-of-sight break, requester rendezvous, unloaded calm, or a truthful blocked wait; the original order resumes with the same ID, phase, checkpoint, and productive-attempt budget. |
| `CS-5` | **Settle the workshop transactions.** Preserve the generic Container window/body contract, then add a thin Craft transaction specialist and a thin Furnace transaction specialist. Do not build a universal transaction engine and do not pretend closing a window rolls server state back. | Generic Container releases only after `currentWindow == null`, cursor truth is reconciled, and Pathfinder is idle. Craft reconciles ingredients, grid, cursor, authoritative open-window inventory, completed output, remaining quantity, and exact table across interruption without duplication. Furnace preserves the exact bound furnace and reconciles carried inventory, input, fuel, output, in-progress burn, already-collected output, and remaining quantity; server-side continued smelting counts as observed partial progress. Unsettled window closure quarantines instead of becoming a retryable job failure. |
| `CS-6` | **Complete the same persisted workshop project.** Resume the existing eight-entry Agenda only after the owning repair is ready. Use its complete ordinary-language contract and the continuously preserved world as the integration surface. | The player-visible chain below completes under one project identity. Every newly changed boundary is directly re-exercised inside this project where the composed outcome can isolate it. No new test suite, broad verifier, standalone coal delivery, or accepted-travel replay substitutes for the physical outcome. |

Primary code seams, to be re-inspected by symbol before editing rather than bound
to mutable line numbers:

- `CS-1`: `ActionManager.runAction`, the `runAsAction`/`executeCommand` internal
  envelope, and the Agenda, Job, Goal, Capability, and Survival dispatch consumers;
- `CS-2`: `createActionResult`, post-capability verification, WorkOrder reduction,
  and the one legacy continuation mapper;
- `CS-3`: `actionAttemptSignature`/`recordActionAttempt`, ActionManager circuit
  settlement, and Agenda dependency/terminal classification;
- `CS-4`: `selfDefenseReflexEligibility`, failed-tactical receipts, the existing
  SurvivalIncident stages, combat `objective: 'disengage'`, and WorkOrder handback;
- `CS-5`: Activity adapter selection, `ContainerActivityAdapter`, `craftRecipe`,
  `smeltItem`, and their exact workstation/window reconciliation.

##### Locked player-visible action chain

The live persisted predicates, not an invented replacement script, define the
workshop outcome:

| Order | Physical action | Owner | Step acceptance |
|---|---|---|---|
| 1 | Retain the existing request, requester, home, furnace, crafting table, exact chest, quantities, outputs, and final return predicate. | Mission plus resource-project Agenda | The existing Agenda remains the one project; its eight entries and bindings are preserved rather than recompiled or manually replaced. |
| 2 | Prepare expedition prerequisites and leave the accepted base for a live cave/search region. | Causal planner, Explorer, Pathfinder Activity | Kevin has the required usable tool, lighting, food/safety state, working inventory capacity, and one settled outbound route. Accepted base construction is not repeated. |
| 3 | Acquire eight `raw_iron` from iron ore and three `coal` from coal ore while preserving every verified partial acquisition. | Explorer target selection, Pathfinder, CollectBlock | Exact family counts advance the same Explorer checkpoint. An exhausted cave is excluded; an inconclusive cave route changes physical vantage; bounded cave relocation can fall through to the existing deterministic mining-corridor strategy. No unchanged location or action is replayed. |
| 4 | Resolve bodily danger and return to the same expedition obligation. | Hard-band reflex/survival, existing SafetyIncident, PvP/Combat Activity | The chain contains at least one real interruption and one compound recovery with at least two materially different decisions. A failed tactic changes to disengagement/retreat or another justified response; verified safety settles; the same Explorer order resumes without a new player command or lost checkpoint. |
| 5 | Return with acquired custody to the exact bound base and fixtures. | Pathfinder Activity plus Mission checkpoint | Kevin reaches the bound workshop; required ore/fuel remains accounted for; route work, terrain effects, scaffolds, death recovery if any, and remaining prerequisites are truthful. |
| 6 | Smelt the required iron in the exact installed furnace. | Furnace Activity using Mineflayer furnace mechanics | The bound furnace, input, fuel, burn progress, output, carried inventory, and remaining quantity reconcile; eight required iron ingots become available without duplication or false loss. |
| 7 | Craft one additional iron pickaxe, one shield, and one bucket at the exact installed table. | Craft Activity using Mineflayer/recipe-book mechanics | The three exact outputs exist once, workstation and ingredient effects reconcile, partial output survives interruption, and unrelated inventory remains accounted for. |
| 8 | Store exactly those three requested outputs in the installed chest at `(768,66,-766)` while preserving unrelated contents and leftovers. | Container Activity | Paper/window truth confirms one iron pickaxe, one shield, and one bucket added to the bound chest; cursor is empty or reconciled; no unrelated stack is lost or substituted. |
| 9 | Return to the exact requester and settle the project. | Pathfinder Activity followed by Mission acceptance | Kevin returns to `DirectorTest`; the Agenda is complete; inventory, chest, terrain/scaffold, fixture, threat, health, position, and remaining-material truth agree; no action, path, combat, collection, window, delayed callback, or body lease remains active. |

##### Continue, stop, acceptance, and definition of done

**Continue** while the body is settled and another permitted action can change a
remaining predicate, recover custody, resolve a threat, choose a materially
different method, or verify an owning repair. A timeout is inconclusive. Death,
displacement, hostile preemption, exhausted source/region, partial mining, failed
route, or recoverable workstation stance causes settlement and replanning from
current reality; it does not erase completed effects or restart the project.

**Stop** only for explicit Operator Stop/Hold, unproven physical settlement that
requires quarantine, provider authentication/quota/routing failure, lost
consequential authority, runtime/world integrity risk, or an exhausted named
permission/resource/method boundary that makes a remaining Mission predicate
impossible. A terminal stop preserves every verified partial effect and names the
exact remaining problem. Never blind-retry the same failure.

**Tranche acceptance** requires one continuous player-valued composition under the
existing ordinary-language project: base departure; live iron/fuel acquisition;
real interruption; a compound changed-method recovery; exact project resumption;
base return; furnace, Craft, and Container handoffs; exact cache contents; requester
return; and truthful settlement. Accepted movement, escape, Placement, and prior
Container custody evidence may be traversed but is not replayed alone.

**Definition of done:** all `CS-1` through `CS-6` acceptance criteria are true;
one project identity remains authoritative from its existing checkpoint through
completion; no local failure causes an unchanged action loop, false terminal
cascade, or global Hold; verified partial effects and custody survive every
handoff; Paper/world truth confirms the exact three outputs in the bound chest and
Kevin back with the requester; Mission and Agenda are complete; Job/Goal are idle;
the SafetyIncident is resolved; ActionManager is physically settled; no window or
path remains active; and no unexplained inventory or terrain delta remains. Then
mark this Phase 7A workshop composition `ACCEPTED / CLOSED` in this architecture,
the campaign record, and the handoff together.

Closure applies only to boundaries physically traversed. Vehicle, Container
open-window interruption, or any Craft/Furnace/PvP cancellation case not actually
exercised remains `ACTIVE` or `PENDING`; it cannot block the completed workshop
promise and cannot inherit acceptance by prose.

#### Phase 7B — deterministic compound livestock project

**State: `ACTIVE`; current gameplay frontier locked 2026-08-26.** The Director's
newest gameplay request supersedes the workshop as the execution cursor without
erasing its verified partial results. This is one compound outcome, not separate
pen, cow-search, wheat, breeding, gate, and return demonstrations. Use the existing
Agenda, JobDirector, GoalDirector, Capability catalogue, Builder, livestock
specialist, and ActionManager. Do not add another planner, scheduler, command
script, provider-specific prompt, or monolithic livestock mega-skill.

The required chain is:

| ID | Required action and owner | Acceptance criteria |
|---|---|---|
| `LB-1` | **Deterministic language ownership.** The ordinary sentence is owned by the typed livestock compiler even when model sequencing is enabled. | The whole request produces one five-entry Agenda—catalogue construction, requested-animal scout/return/guide, attraction-food acquisition, livestock settlement, requester return. It cannot fall through to zero-argument `!settleLivestockAtPen`, malformed structure names/materials, clarification churn, or a partial single command. |
| `LB-2` | **Resume or assign one catalogue pen.** Agenda construction uses the existing `animal_pen` catalogue and shared safe-site/material binder. | If the exact latest compatible partial animal-pen WorkOrder exists, resume its ID/checkpoint instead of selecting a new site. Otherwise bind one safe loaded site and one approved feasible primary material. Builder verifies containment and access; no model-authored blueprint is required. |
| `LB-3` | **Scout the requested population.** Extend the existing Scout/Explorer capability request with the requested adult animal and minimum count. | A cow request cannot settle from a pig, sheep, or one cow. Capability binding and verification both observe at least the requested number of adults in the bounded source region; the exact selected source point and animal name enter the existing scout checkpoint and durable `useful_animals` memory; return and player guidance complete under the same Scout order. |
| `LB-4` | **Bind produced inputs at the consumer boundary.** Keep unresolved source and pen as typed selectors until their producing steps finish. | Immediately before settlement, Agenda resolves the exact completed remembered animal-pen WorkOrder and the exact remembered scout source in the current dimension, physically validates the closed enclosure, persists concrete source coordinates and the complete pen constraint, and only then dispatches the livestock specialist. A restart cannot substitute the nearest unrelated pen or a stale cross-dimension source. |
| `LB-5` | **Contain Builder placement failure at its owner.** Preserve exact interaction-stage evidence and the durable material-change circuit already installed in WorkOrder/JobDirector. | The old fence-cell failure cannot consume three identical retries from a generic `skill_unreachable` string. Exact `no_legal_stance` evidence terminalizes the impossible cell; a route/environment failure retains its causal stage and cannot reopen from scheduler delay alone; a fresh request may resume the same compatible partial Builder order after a material code/world change. No cell-specific or spruce-specific geometry patch is allowed without discriminating evidence. |
| `LB-6` | **Complete the player outcome.** Run only after explicit runtime resumption. | The exact pen completes; at least two requested adults are scouted and remembered; Kevin returns and guides the requester; the exact breeding food is carried; the adults enter the bound pen; one pair breeds; Kevin exits; the exact gate is closed; final animal count is verified; Kevin returns; all Agenda/Job/Goal/Activity/ActionManager ownership settles. |

The source implementation of `LB-1` through `LB-5` currently has syntax and module-
load evidence only. That is forward implementation evidence, not physical
acceptance. Kevin and Paper remain preserved under the Director's pause; do not
restart or mutate the world from documentation work.

**Definition of done:** one persisted project identity owns the complete five-step
chain; the partial pen is resumed rather than discarded when compatible; exact
requested-animal population, memory, pen, food, breeding, closed-gate, return, and
settlement predicates are directly observed on current source; no dependent step
runs before its producer settles; no unchanged failure is redispatched; no stale
or nearest-object fallback can satisfy a binding; no unexplained inventory, entity,
gate, path, window, terrain, or body lease remains. Then and only then mark Phase
7B `ACCEPTED / CLOSED` in this file, the campaign record, and the handoff together.

### Phase 8 — demote directors and collapse lanes

Only after repeated campaign coverage, demote or remove legacy directors and
collapse lanes into the canonical priority bands. Preserve causal planning and
legitimate non-topology searches. Demotion precedes deletion and is reversible.

### Phase 9 — remove replaced legacy state

After replacement evidence, remove prompt nudges, stale closures, duplicate
voxel-topology planners, obsolete legacy state, and `LegacyPromiseActivity` paths.
Never remove durable knowledge or Operator Hold. Record the covering scenarios for
each deletion.

## 10. Feature flags and rollback

- New ActivityExecutive dispatch is selected by specialist/family flags, never an
  all-at-once switch.
- Legacy and new paths may run in shadow comparison when only the selected path
  controls the body.
- Preflight gates get per-consumer reversible flags; there is no global
  "accept partial" or "force full" flag.
- Instrumentation is additive and remains active through variance measurement.
- A rollback changes dispatch back to the last settled implementation. It never
  transfers a live lease between implementations.
- If a new path reaches `ABORTED_UNSETTLED`, quarantine and restart; do not fall
  through to legacy execution in the same runtime.
- Nothing is deleted until the covering player-visible campaign repeatedly passes
  with the replacement enabled and again after deletion.

## 11. Acceptance and non-regression campaigns

The acceptance contract is the complete `docs/CAMPAIGN-RECORD.md`, not a new test
framework. At minimum, migration evidence must explicitly preserve campaigns 28,
59, 64, 65, 68, 69, 70, 76, M2, M3, 13, 41, 46, and 53 plus the accepted Phase 3
charcoal Mission:

- exact crafting, tool, workstation, quantity, custody, delivery, return, cleanup;
- interruption, retreat, same-Mission replanning, arrival;
- durable Stop/Hold without stale work resurrection;
- critical eating and survival;
- moving-player follow with exact identity;
- placement-site and terrain stewardship;
- vehicle and container transactions;
- request-bound sole-item clarification.

Acceptance requires player-visible outcomes, lifecycle telemetry, no unsettled
lease, truthful partial-effect reporting, and an ordinary-player-sense verdict.
Unit tests and audits support this proof but do not replace physical campaign
evidence.

### 11.1 Outcome-directed confidence rubric

Every tranche must move visibly toward this product criterion:

> Gabriel Jr. tells Kevin what he wants in ordinary language; Kevin figures out
> what that promise means, executes a coherent multi-step plan, survives
> interruption or change, and truthfully finishes or explains the remaining
> problem.

Confidence is evidence saturation, not a run count or a new engine. Apply these
yes/no dimensions to the selected tranche:

1. **Promise:** ordinary language creates or updates the correct player-visible
   Mission without deterministic pre-routing.
2. **Mechanics:** every newly implemented or materially changed physical mechanic
   has direct current-source evidence at the smallest boundary that identifies its
   owner.
3. **Composition:** the relevant mechanics complete one coherent player-valued
   chain, including the material interruption, replacement, partial-effect, or
   resumption boundary for that tranche.
4. **Truth and settlement:** the observed effect, remaining problem, retryability,
   body settlement, terrain/custody state, and cleanup agree with the report.
5. **Independence:** saved evidence is reused for unchanged owners; fresh fixture,
   provider, transport, or request-form coverage is added only when that variable
   can change the verdict.
6. **Saturation:** every observed failure is owned and either repaired, preserved
   as an explicit remaining problem, or shown irrelevant to the acceptance
   predicate. Another run must be able to change the verdict, repair, owner, or
   significant risk.

A missing dimension keeps the tranche `PENDING` or `ACTIVE`. After a material
repair, directly re-exercise its failing boundary and then its player-visible
composition where those are distinct. Stop and mark `ACCEPTED / CLOSED` when all
dimensions are supported and no further controlled run has a plausible material
delta. A failure requires classification before the next run; never blind-retry.

Use the existing Scenario Lab, saved campaign evidence, focused checks, and direct
runtime observations. Do not create a confidence scheduler, statistical assurance
engine, parallel verifier framework, or broad certification course. Phase 6
movement composition, Phase 6B dynamic escape, the autonomous village expedition,
the Phase 7 compounded Placement shelter, and functional-base commissioning are
closed. Phase 7B deterministic compound livestock is the active technical/gameplay
tranche. Its single acceptance vehicle resumes or completes one catalogue pen,
verifies and remembers the requested adult-animal population, returns and guides,
acquires attraction food, moves and breeds the animals, closes the exact gate,
returns to the requester, and settles. The Phase 7A workshop's partial results,
Container custody chain, and bounded Phase 5 question remain preserved; none should
be replayed merely to delay this compound gameplay outcome.
Begin Phase 8 collapse only as replacement evidence covers the specialists'
player-visible deeds.

## 12. Risks

- Legacy promise skills may ignore cancellation; quarantine is required rather
  than optimistic release.
- Package stop APIs differ: a stop request is not automatically halt
  acknowledgement or settlement.
- World observations can be stale; every acceptance and planner decision needs a
  revision/freshness rule.
- Shadow paths can accidentally double-dispatch; only one path may hold the lease.
- Overbroad preflight removal can break atomic or returnability-critical work;
  classify each consumer before demotion.
- Utility can leak across bands if implemented as one score; test lexicographic
  selection directly.
- Causal planning can become another monolith; keep methods incremental, typed,
  and limited to non-voxel prerequisites and outcomes.
- Campaign fixtures can pass for the wrong reason; prove checks are discriminating
  and preserve the broader archaeology.

## 13. Closed paths, non-goals, and open questions

This is the final engine-plan section: `ARCHITECTURE.md` is the sole active plan,
and the items below must not be rescheduled or rediscovered without materially
contradictory evidence. This section is self-contained for startup use; no review
packet, alignment crosswalk, session handoff, or superseded planning record is an
additional authority.

### 13.1 Empirically closed — do not reinvestigate without new contradictory evidence

These are empirical failure hypotheses that live evidence closed. Reopen one only
by addressing the cited measurement, not by re-reading source.

- **DEAD-1 — "stone is excluded from breakable natural terrain."** False: `stone`
  is a member of `NATURAL_FILL_BLOCKS`; stone exclusion was not the blocker.
- **DEAD-2 — "a solid stone block has no legal stance, so collection refuses
  it."** False: exposed outcrops collect on the first try in both `!collect` and
  `!collectBlocksInRange`. Solidity was never the variable; descending through
  cover was.
- **DEAD-3 — "the dig fails because the bot is not facing the block; aim and
  retry."** False, and implemented then reverted: a `lookAt` + retry at the dig
  call site changed the measured outcome by exactly nothing because the enclosed
  target had no visible face to aim at. The measured cause was excavation order.
- **DEAD-4 — "`!collect` and `!collectBlocksInRange` disagree about the same
  rock."** False: both collect the identical count from the identical outcrop.
  The apparent disagreement was partial results reported as total failure.
- **DEAD-5 — "the three-step surface excavation cap is a deliberate landscape
  policy."** False: it is a regression introduced 2026-08-10 with no prior bound,
  and it reversed straight-down mining that had worked the week before. It is not
  a design decision requiring approval to change.
- **DEAD-6 — "obstruction-follow never worked / needs a new movement
  capability."** False: it passed 18 consecutive runs before model-first shipped;
  then the test oracle regressed by asserting the literal string
  `action:followPlayer` while the model chose `!follow`. Oracle defect, not
  capability.
- **DEAD-7 — "roll back to a known-good commit."** Not available: most Aug 11–14
  campaigns ran from a dirty working tree, and no exact commit captures those runs
  between their evidence and the Aug 15 checkpoint.
  There is no golden state; recovery is replay-and-repair at HEAD.
- **DEAD-8 — "reading the code will find the cause."** Failed four times in one
  session, each with a confident wrong answer; a probe varying one variable
  answered in minutes. Discriminating probes outrank confident source-only
  diagnosis in this codebase.

### 13.2 Superseded architecture and mechanism paths — do not implement

Each entry names a path this project has already rejected. Do not implement,
reintroduce, or propose it without materially contradictory evidence; the
canonical replacement is named where useful.

1. **LLM-only causal/what-next sequencing.** The LLM interprets and proposes;
   the incremental causal planner owns prerequisites, quantities, dependencies,
   delivery, return, and cleanup.
2. **Deterministic regex or plain-language router before the model.** Plain
   language reaches the LLM first; only explicit player `!commands` stay direct.
3. **One top-level utility score across priority bands.** Hard lexicographic
   bands govern; utility ranks peers only within a band.
4. **Legacy directors or the arbiter as a god object** owning Mission semantics,
   causal planning, and physical lifecycle. Canonical owners are Mission, the
   causal planner, the request-first hard-band arbiter, and ActivityExecutive.
5. **Durable ordinary obligation ledger, cross-restart Mission replay, or stale
   closure resumption.** Ordinary Mission work is in memory and may drop on
   restart; durable knowledge and Operator Hold are the only survivors.
6. **Primitive `{ok, why}` or `did` / `engine_cannot` / `we_will_not` / `unknown`
   as the final internal outcome.** Those are player-facing renderings; gameplay
   uses the typed Activity outcome. Legacy primitives may be adapted during
   migration only.
7. **Cancellation without acknowledgement and settlement.** No cooperative
   cancellation claim is a release.
8. **Synchronous halt-and-release, elapsed-timeout release, or deleting
   unresponsive-owner protection before quarantine replacement.**
9. **Thin adapters assumed to make opaque skills cooperative.** Each adapter must
   prove its package-specific halt and settlement contract; `LegacyPromiseActivity`
   receives no exemption.
10. **Global premise that project execution discards all partial paths.** Owned
    `goto()` installs and walks partials while search continues; the defect was
    per-consumer preflight vetoes, not a global discard.
11. **An outer global partial execution loop** above the owned pathfinder. Partial
    is running and timeout unknown for ordinary consumers.
12. **Global traversal flip to `full`.** Shipping Kevin already requests `full`;
    `preserve` is the absent-setting fallback. Instrument effective Movements per
    call site instead.
13. **Every movement action always enabled, or policy living only in
    `Movements`.** A restricted profile is legitimate for a named policy, but its
    `noPath` is profile-scoped; policy forbids, it never declares impossibility.
14. **Banning every non-Pathfinder search.** Only a second voxel-topology oracle
    is forbidden; causal, recipe, inventory, workstation, target, placement,
    combat, and search-region selection remain valid.
15. **Universal whole-route or round-trip proof before movement.** Keep such proof
    only for explicitly atomic or returnability-critical transactions.
16. **Generic project-selected safe waypoint proofs.** Policy may bound
    destinations; Pathfinder decides each route with the effective action profile.
17. **Project-computed complete dry path.** Critical survival seeks stable dry
    land; Pathfinder computes the route.
18. **Clarification that either freezes all of Kevin or never waits for
    consequential ambiguity.** Only a materially ambiguous Activity may wait,
    bound to Mission and token; the body lease stays free and other work
    continues.
19. **World model dispatch, veto, or body authority.** The versioned world model
    observes with provenance and freshness only.
20. **Gameplay receipt or contract-stage bureaucracy.** Evidence belongs to typed
    Activity outcomes and telemetry, not evidence envelopes on the gameplay path.
21. **Immediate bulk deletion of directors, planners, or lanes.** Demote behind
    reversible flags and delete only after repeated replacement evidence.
22. **Assuming Mission, ActivityExecutive, lifecycle, model luck, or preflight
    stochasticity alone has already explained variance.** The variance matrix must
    separate them first.
23. **Baritone as correctness proof, replacing Pathfinder wholesale, or running a
    second locomotion owner.** Baritone is mechanism reference only; owned
    packages and physical probes supply evidence.
24. **Treating movement primitives as fully reliable from source presence without
    physical probes.** Package-mechanism probes, not static presence, establish
    reliability.
25. **Forking or porting libraries before a probe proves a missing mechanism.**
    Probe the specific behavior first.
26. **Scripting every microstep or driving physics from the LLM or player.**
    Project code owns judgment; packages own locomotion and interaction.
27. **A ground-up engine rewrite or importing a large BT/GOAP framework as the
    first repair.** Work through the canonical migration order on evidence.
28. **Mutable line offsets or superseded planning records as current authority.**
    Reinspect current source before implementation.
29. **Creating another competing engine-plan document.** `ARCHITECTURE.md` is the
    sole active plan; supporting docs are evidence only.
30. **Retired named strategy, maturity, and fallback vocabularies as current work
    orders.** The old six-stage fixture-admission → functional-affordance →
    shared-fallback → complete-intent → component-stewardship → obligation-liveness
    strategy, M4/M5 maturity labels, and the old staged confusion-fallback chain are
    archaeology. The canonical phases, contracts, and HANDOFF tranche replace them.
31. **Arbitrary wall-clock cutoffs that force an authorized evidence-backed repair
    to stop incomplete.** Checkpoints and handoffs preserve continuity; they do not
    convert an unfinished justified repair into a terminal result. Explicit runtime,
    safety, scenario, and search budgets still apply to the operations they govern.
32. **Treating conversation or informational speech as physical-action authority
    that replaces the current Mission.** Only a validated physical request may
    replace Mission work; ordinary conversation remains conversation.

These items absorb the earlier non-goals list: no bulk deletion before coverage
(21), no source-line contract (28), no global partial loop or traversal flip
(11, 12), no duplicate topology oracle (14), no receipt bureaucracy (20), and no
thin-adapter magic (9).

### 13.3 Open — measure, do not prematurely close

"Open" means not proven by evidence yet; it is not permission for speculative
redesign. The separately authorized variance matrix answers only its bounded Phase
5 question. The current Phase 7 measurement path is the compound livestock outcome
and the smallest owning-boundary observation needed after a material repair.

- The source of the 3/7 → 5/7 → different-5/7 → 4/7 run-to-run variance across
  fixed cases. Model sampling, lifecycle, fixture cleanliness, timing, and
  preflight behavior remain hypotheses until the matrix separates them.
- Which preflight/probe consumers are justified atomic or returnability-critical
  gates and which should be demoted behind reversible flags.
- Whether the effective `Movements` actually reach each specialist — traversal
  profile, dig/place/tower/parkour permissions, costs, exclusions, and scaffold
  source/cleanup authority — per call site.
- Which legacy specialists acknowledge cancellation but fail to settle, so
  quarantine is scoped correctly rather than assumed.
- Whether specific Baritone mechanisms or Pathfinder macro edges are actually
  missing — answer by probe before any fork or port.
- Which non-workshop callers still depend on shared `last_action_result` after the
  workshop's Agenda, Job, Goal, Capability, and Survival path receives exact direct
  results; migrate them only when Phase 8 or a player-valued composition reaches
  them.
- Which Craft, Furnace, PvP, and Container cancellation variants the workshop
  physically traverses. Close only those observed boundaries; leave untraversed
  variants explicit rather than inferring acceptance.
