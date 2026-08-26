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

### 2.1 Current phase and proof ledger (2026-08-19)

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
| Autonomous village expedition and player guidance | `ACCEPTED / CLOSED` | Kevin found and verified a taiga village, remembered its bell at `(781,66,-775)`, returned to the requester, and completed the saved guide continuation with both bodies at the village. The roughly 590-block final guidance leg physically composed forest travel, slopes, repeated step-ups, deep-water traversal, shoreline ascent, catch-up, and chained recoveries. |
| Phase 7 Container specialist and village supply cache | `ACTIVE` | Native chest/barrel actions now carry Container Activity ownership across Pathfinder approach, window progress, halt, close, and settlement. Kevin physically stored six oak logs in the exact village chest at `(796,67,-774)`, returned, later worked around an unreachable first withdrawal stance, retrieved exactly two from the same chest, returned, retained custody after correction, and durably remembered `village_supply_cache`. The chest ended with four logs and Kevin with eight. Other Phase 7 specialists and Container interruption-in-window behavior remain open. |
| Outcome-directed confidence coverage across new and old mechanics | `ACTIVE` | Saved accepted evidence remains valid. Controlled runs are authorized when they can change a mechanic owner, repair, composition verdict, or significant risk; fixed-count and reassurance-only reruns are not. |
| Remaining Phase 5 and later work | `PENDING` | The stopped API-routed Phase 5 attempt preserved four local reports but used the wrong frozen-model provider. The corrected `codex/gpt-5.6-luna` OAuth matrix has not started and has no variance verdict; the Director explicitly authorized the corrected matrix on 2026-08-21 without another authorization ceremony. Phase 6 and the autonomous village expedition are closed; Phase 7 specialist adapters remain later work. |

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

Add Craft, Furnace, PvP, Placement, Vehicle, and Container adapters. Each requires
package-specific cancellation acknowledgement, settlement evidence, partial-effect
handling, and player-visible campaign coverage.

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
window transaction, and Craft, Furnace, PvP, Placement, and Vehicle adapters remain
unimplemented.

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
movement composition and the autonomous village expedition are closed. Finish the
bounded Phase 5 variance question, add the real Phase 7 specialist adapters, then
begin Phase 8 collapse of legacy directors and lanes as replacement evidence
covers their player-visible deeds.

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
redesign. The canonical variance matrix and the Phase 6-7 terrain and specialist
probes are the measurement path.

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
- Whether MissionStore and causal-planner boundaries need adjustment after the
  first charcoal-family evidence.
