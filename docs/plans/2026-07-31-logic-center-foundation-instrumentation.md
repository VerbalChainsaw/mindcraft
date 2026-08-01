# Logic-center foundation repair and decision instrumentation

Status: **implementation selected**

This is the bounded foundation-and-observability tranche for the existing
cognitive loop. It does not replace the loop or introduce a new planner.

## Contract and workspace safety

- Required behavior: repair combat attribution, preemption-poisoned method
  learning, threat recognition coupled to walkability, and stale bounded
  recovery; trace the existing `BehaviorArbiter`; report bounded traces.
- Acceptance: every defect is classified from current HEAD evidence; focused
  regressions pass; tracing on/off selects and acts identically; a representative
  trace replays through the terminal reporter; trace overhead is measured.
- Must preserve: `ActionManager` actuation ownership, `BehaviorArbiter` priority
  authority and exact lane order, `GoalDirector` lifecycle and verification,
  `PrerequisitePlanner` planning, deterministic skill execution, current cadence.
- Out of scope: `EvidenceFrame`, universal proposals, shadow arbitration,
  priority-band competition, action leases, learned arbitration ranking, HTN,
  GOAP, generalized evidence DSLs, predicted-effect marketplaces, and UI work.
- Workspace: `C:/Users/zerop/Development/minecraft-companion`, branch
  `phase0-follow-baseline`; the preceding agenda repair is isolated in commit
  `00da83c`; no unrelated work is present.
- Pre-change checks: 47/47 passed across combat decisions, perception/learning,
  lifecycle/unstuck, and `ActionManager` focused suites.

## Current-HEAD evidence and defect ledger

| ID | State before implementation | Evidence |
| --- | --- | --- |
| F1 combat attribution | confirmed | `performVerifiedMeleeHit`, `performVerifiedRangedShot`, and PVP defeat accounting accept target hurt/death events without checking the Mineflayer damage source. Mineflayer 4.37.1 provides the responsible entity as the second `entityHurt` argument on 1.20+. |
| F2 preemption learning | confirmed | `GoalDirector.finishLatestSubgoal` calls `rememberOutcome(success=false)` before `handleResult` calls `isPreemption`; `PersonalMemory` therefore records a failure even though the goal attempt budget is preserved. |
| F3 threat/walkability | confirmed | self-defense selects one nearest hostile and awaits `world.isClearPath()` before scheduling tactical combat; a blocked nearest hostile can suppress the entire reflex. |
| F4 bounded cancellation | confirmed | `runBoundedUnstuckRecovery` returns the timeout arm of `Promise.race` after an interrupt but never cancels or awaits the movement promise. |
| F5 lane observability | confirmed gap | the arbiter publishes only its latest winning status; skipped lanes, evidence age, selection timing, preemption, and outcome correlation are not recorded. |

## Repository calibration

- The arbiter is a literal, ordered, short-circuit cascade. Instrumentation must
  observe that control flow rather than normalize it into candidate competition.
- `full_state.js` already projects `behaviorArbiter.snapshot()` to MindServer,
  making the arbiter snapshot the smallest existing read-only telemetry surface.
- `BehaviorEventBus` is consumed by reactions, rules, landmarks, and memory. It
  is semantic gameplay input, not a safe per-pass diagnostic stream.
- Action outcomes already have stable IDs and structured telemetry; correlation
  should reuse those IDs rather than create another outcome contract.
- Runtime additions are zero-dependency ES modules with bounded text and arrays.

## Candidate mechanisms

### V1 — inline arbiter trace state

- Fingerprint: `existing-module`, `instance-ring`, `inline-hooks`, `zero-dep`.
- Keep trace construction, retention, normalization, and formatting directly in
  `behavior-arbiter.js`; add a standalone reporter that knows the object shape.
- Lowest effort and no new runtime module, but schema enforcement and reporting
  drift across two files, and inline bookkeeping makes the priority cascade
  harder to compare mechanically.

### V2 — dedicated bounded trace recorder

- Fingerprint: `new-observability-module`, `instance-ring`, `cascade-hooks`,
  `snapshot-adapter`, `zero-dep`.
- Add one side-effect-free recorder/formatter module. The arbiter marks the
  existing stages as they execute, finalizes in `finally`, retains a bounded
  in-memory ring, and projects recent records through its existing snapshot.
- Foundation repairs remain surgical in their current owners. Action-result
  correlation links through the existing result ID.

### V3 — decision events through `BehaviorEventBus`

- Fingerprint: `existing-event-bus`, `event-stream`, `schema-expansion`.
- Emit lane evaluations as behavior events and aggregate them for reporting.
- Rejected: these events would be consumed as gameplay stimuli by reactions,
  rules, landmarks, and memory, so enabling tracing could change behavior. The
  existing event schema also cannot faithfully encode ordered skipped lanes and
  stage timing without a broad semantic contract change.

Divergence: V1 keeps observability embedded in the priority authority; V2 keeps
the authority unchanged and gives trace normalization one bounded module; V3
feeds diagnostics into an active gameplay event stream and is behaviorally unsafe.

## Paper gates

- V1: passes task fulfillment, ownership, zero-dependency, and verification;
  weaker schema/report cohesion but viable.
- V2: passes task fulfillment, ownership, negative-space, zero-dependency,
  bounded-retention, telemetry reuse, and focused verification.
- V3: **fails contract preservation** because trace enablement can drive reaction
  and rule consumers. It is disqualified and not scored.

[codeplan · logic-center foundation instrumentation · IN · mode: full · profile: compact · confidence: high · candidates: V1=inline-arbiter/instance-ring/zero-dep;V2=bounded-recorder/cascade-hooks/snapshot-adapter/zero-dep;V3=behavior-event-stream/schema-expansion(disqualified) · lean: V2 · conservative: V1]

## Frozen rubric and selection

Freeze: axes=`architecture fit, trace fidelity/verifiability, regression risk,
operability, implementation complexity`; classes=`quality, quality, risk,
quality, convenience`; weights=`3,3,3,2,1`; denominator=`60`;
unknown-policy=`interval`; baseline=`lowest-effort eligible gate passer`.

| Axis | W | V1 | V2 |
| --- | ---: | ---: | ---: |
| Architecture fit | 3 | 4 — remains in owner, but mixes concerns | 5 — observes the owner without becoming one |
| Trace fidelity / verifiability | 3 | 3 — duplicated schema knowledge | 5 — one normalizer and deterministic formatter |
| Regression risk / reversibility | 3 | 4 — no new boundary, denser cascade | 4 — contained module, explicit hooks |
| Operability | 2 | 3 — bespoke reporter coupling | 5 — snapshot and reporter share the contract |
| Implementation complexity | 1 | 5 — lowest effort | 4 — one small internal module |
| Weighted total |  | 44/60 = **0.733** | 55/60 = **0.917** |

Arithmetic was checked against the frozen common denominator. V1 is the formal
baseline. V2 wins stably by 0.184 and introduces no control or persistence owner.

[codeplan · logic-center foundation instrumentation · PLAN-OUT · mode: full · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.733;V2=0.917 · reason: one bounded recorder gives the short-circuit cascade and reporter a shared schema without feeding diagnostics into gameplay or changing priority · planned-fingerprint: new-observability-module+instance-ring+cascade-hooks+snapshot-adapter+zero-dep]

## Decision trace schema v1

The schema is frozen before tracing implementation. Records contain only
identifiers, bounded summaries, primitives, and small arrays—never raw entities,
world objects, bot objects, prompts, or logs.

```text
DecisionTraceV1 {
  schemaVersion: 1,
  decisionId: string,                 // stable agent/tick/wall-time identifier
  agent: string,
  wallClockTimestamp: number,         // epoch milliseconds
  monotonicStartedMs: number,
  trigger: { code: string, deltaMs: number|null },
  activeAction: {
    actionId: string|null,
    owner: string|null,
    label: string|null,
    intent: string|null,
    startedAt: number|null,
    commitment: {
      resumeAction: string|null,
      goalId: string|null,
      goalPhase: string|null,
      workOrderId: string|null,
      workOrderPhase: string|null
    }
  },
  evidence: [{
    id: string,
    source: string,
    observedAt: number|null,
    ageMs: number|null,
    summary: string|null
  }],
  lanes: [{
    order: number,
    lane: string,
    status: "eligible"|"ineligible"|"not_evaluated"|"error",
    reasonCode: string,
    targetRef: string|null,
    evidenceRefs: string[],
    durationMs: number|null
  }],
  winner: {
    lane: string,
    reasonCode: string,
    control: "retained"|"acquired"|"none",
    controlReason: string,
    hardGate: string|null,
    preemption: {
      involved: boolean,
      fromOwner: string|null,
      fromAction: string|null,
      toLane: string|null
    }
  },
  stages: [{ stage: string, durationMs: number }],
  timing: { evaluationMs: number, cleanupMs: number, totalMs: number },
  correlation: { actionId: string|null, outcomeLinked: boolean },
  outcome: {
    actionId: string,
    phase: string,
    code: string,
    finishedAt: number|null,
    durationMs: number|null
  }|null
}
```

Lane order is the current cascade order: operator hold, emergency, protection,
active-action retention, recovery, comportment pause, directive continuation,
survival, survival job, player goal, player job, command-policy guard, factual
reaction, role work, self progression, opportunity, idle embodiment, self prompt,
then idle. Rules and agenda dispatch remain non-owning timed stages, not invented
competitors. A short-circuit leaves every later entry `not_evaluated`.

Retention is an in-memory ring with configurable enabled state and limit; the
limit is clamped to a fixed maximum. The existing arbiter snapshot exposes a
smaller recent window. No per-decision log files are written.

## Ordered implementation

1. Add centralized combat damage attribution and use it in melee, ranged, and
   defeat accounting.
2. Add a shared method-outcome classifier; keep censored outcomes out of method
   counters while preserving the existing goal retry budget behavior.
3. Remove walkability from self-defense recognition and enrich the tactical
   threat snapshot with independent class, distance, attribution, motion, LOS,
   and local-geometry summaries.
4. Make bounded unstuck cancellation cooperative and await movement settlement
   before returning.
5. Add `DecisionTraceRecorder`, instrument the existing cascade in place, link
   action outcomes, project bounded recent traces, and add a terminal reporter.
6. Add only focused regression tests, one fixture, and measure enabled/disabled
   trace overhead without inventing a pass threshold.

## Later stages — document only

1. Build one `EvidenceFrame` per arbitration pass, not per Minecraft tick.
2. Carry evidence source, timestamp, provenance, and confidence where meaningful.
3. Let each consumer declare freshness; do not attach one global expiration to a fact.
4. Share side-effect-free lane assessment logic between live eligibility and future shadow evaluation.
5. Keep shadow candidates free of pathfinding, plugin calls, action startup, and world mutation.
6. Enrich ordinary decisions with asynchronous/cached route data; reflex decisions never await it.
7. Confine the first live arbitration experiment to hostile-target selection.
8. Consider cross-lane competition only after traces prove recurring fixed-order failures.
9. Prefer explicit takeover rules and action leases over overlapping priority bands or universal scoring.
10. Learn only from correctly attributed `success`, `method_failure`, and `censored` outcomes.

Explicitly excluded later constructs: `EvidenceRequest` expressions, AND/OR
evidence DSLs, universal urgency scales, predicted-effect models, generalized
proposal marketplaces, HTN, GOAP, or a second outcome-verification framework.

## Implementation evidence and final defect disposition

| ID | Final disposition | Repair evidence |
| --- | --- | --- |
| F1 combat attribution | **confirmed, fixed** | One pure attribution helper now classifies the second Mineflayer `entityHurt` argument as `bot`, `foreign`, or `unknown`. Melee, ranged, and player-defeat accounting confirm only bot-attributed damage. Bot/foreign/unknown regressions pass. |
| F2 preemption learning | **confirmed, fixed** | `classifyMethodOutcome()` runs before `rememberOutcome()`. `censored` samples return without changing persisted counters; success and genuine method failure remain counted. The existing preemption attempt-budget branch is unchanged. |
| F3 threat/walkability | **confirmed, fixed** | Self-defense no longer awaits `world.isClearPath()`. Tactical combat evaluates all loaded relevant hostiles, while class, distance, attribution, motion, line of sight, and local block geometry remain independent fields. Existing ranged/explosive/retreat/avoid cases and the obscured-nearest regression pass. |
| F4 bounded cancellation | **confirmed, fixed** | Unstuck owns an `AbortController`, production `moveAway`/`goToGoal` cooperate with its signal, timeout clears navigation/control state, and the wrapper awaits settlement. The delayed-mutation regression advances past timeout and observes zero post-return control mutation. |
| F5 lane observability | **confirmed gap, implemented** | The zero-dependency recorder observes the existing cascade, leaves short-circuited lanes `not_evaluated`, retains a configurable/clamped 1–512 trace ring, projects the newest four records through the existing arbiter snapshot, and links ActionManager IDs/outcomes. It emits no gameplay events and writes no log files. |

No requested defect was already fixed or disproven on the inspected HEAD. All
five findings were confirmed before editing; the fifth was the requested
instrumentation gap rather than a gameplay defect.

## Reporter demonstration

Command:

```powershell
node tools/report-decision-trace.mjs tests/fixtures/decision-trace.v1.json
```

Representative output (abridged only after the short-circuit is visible):

```text
decision TraceBot-41-1785520800000-1 @ 1785520800000
trigger=scheduled_tick active=player:!collect
winner=attributed_protection reason=damage_attributed control=acquired
00 operator_hold: ineligible (operator_not_held) 0.02ms
01 emergency_self_preservation: ineligible (inactive) 0.11ms
02 attributed_protection: eligible (damage_attributed) 0.18ms
03 active_action_retention: not_evaluated (short_circuit) -
evidence=perception-41:environment_observer:25ms
preemption=player:!collect->attributed_protection
timing evaluation=0.82ms cleanup=0.08ms total=0.9ms
outcome=interrupted:interrupted action=TraceBot-41-1785520800000
```

The checked-in fixture contains all nineteen ordered lane records and the full
v1 schema, including commitment and outcome correlation.

## Measured overhead

A five-run in-process benchmark used 5,000 emergency short-circuit decisions per
run after 500 warm-up decisions, with the same fake agent and side effects in
both cases. Median results:

- tracing disabled: **0.00392 ms/decision**;
- tracing enabled, retention 128: **0.22692 ms/decision**;
- added absolute cost: **0.22300 ms/decision**;
- relative ratio: **57.86×**, dominated by the nearly empty 0.00392 ms baseline.

The absolute added cost is about **0.28% of the fastest 80 ms lane cadence**.
This is a measurement, not an invented pass/fail threshold.

## Verification record

- Pre-change focused baseline: **47/47 passed**.
- Post-change focused integration (repairs, trace parity/retention/correlation,
  ActionManager, settings propagation, state pump): **65/65 passed**.
- Focused ESLint over repair/trace modules and their tests: **passed**.
- Reporter fixture replay: **passed** with the output above.
- Full repository run: **410/411 passed**. One existing dashboard socket test
  reached its 1.5-second response deadline. The entire owning test file then
  passed **13/13 in isolation** (the same test completed in 609 ms), so no
  deterministic defect was confirmed and no unrelated timing code was changed.

## Changed surfaces and preserved invariants

- Attribution and tactical evidence: `combat-attribution.js`, `skills.js`,
  `combat-decision.js`, and the self-defense branch in `modes.js`.
- Learning boundary: `action-result.js`, `goal-director.js`, and
  `personal-memory.js`.
- Cooperative cancellation: `modes.js` and signal-aware `moveAway`/`goToGoal`.
- Observability: `decision-trace.js`, surgical hooks in
  `behavior-arbiter.js`, ActionManager correlation fields, existing full-state
  projection, the terminal reporter, fixture, and settings/spec entries.
- Focused regressions: combat attribution/decision, learning, unstuck lifecycle,
  and arbiter trace tests.

`ActionManager` remains the sole actuator. The tracer has no action, event-bus,
pathfinder, plugin, or persistence authority. Arbiter lane order, selection
conditions, and cadence constants are unchanged. `GoalDirector` still owns goal
lifecycle and its preemption attempt rule. `PrerequisitePlanner` and deterministic
skill ownership are unchanged. None of the documented future architecture was
implemented.

## Remaining bounded risks

- Mineflayer versions/protocols that provide no damage source now produce a
  conservative false negative unless separate bot-owned evidence exists; they
  cannot produce a false bot credit.
- A custom injected unstuck `moveAway` implementation must honor the supplied
  `AbortSignal`; the production movement path does.
- Traces intentionally reset on process restart and retain no raw entities or
  long-term log history.
- The non-reproducing full-suite dashboard timeout remains a test-timing signal,
  not a confirmed logic-center regression.

[codeplan · logic-center foundation instrumentation · EXEC-OUT · mode: full · profile: compact · result: implemented · confidence: high · defects: F1=confirmed-fixed;F2=confirmed-fixed;F3=confirmed-fixed;F4=confirmed-fixed;F5=confirmed-implemented · verification: focused=65/65;full=410/411+isolated-dashboard=13/13;lint=pass;reporter=pass · overhead: +0.22300ms/decision median · invariants: action-owner+lane-order+cadence+goal-owner+planner-owner preserved · future-architecture: documented-only]
