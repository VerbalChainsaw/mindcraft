# Strategic Reasoning / Deterministic Execution Rollout

Date: 2026-08-10
Status: BQ0/BQ1 hardened and online; BQ2 live zero-method qualification complete; H1 selector authority not justified
Branch baseline: `recovery/iron-pickaxe-20260803` at `1b6a7a3` (`2917ef7` is the accepted H0 evidence checkpoint)
Extends: `docs/plans/2026-08-03-hybrid-companion-forward-plan.md`
Preserves: `docs/research/2026-08-03-hybrid-goal-recovery-milestone.md`

## Outcome

Bring the strategic-reasoning paradigm into the existing hybrid companion so a
failed tactic does not silently kill a still-valid player objective. The bot
should continue through ordinary friction by using deterministic mechanics and
known recovery first, then asking a model to select among bounded, validated
high-level strategies only when a real strategic branch remains.

The destination is not a second planner or unrestricted model control. It is a
narrow strategic exception inside the existing `GoalDirector` lifecycle:

```text
durable objective
  -> deterministic plan and ActionManager execution
  -> settled ActionResult plus fresh Minecraft state
  -> deterministic reconciliation and known recovery
  -> bounded strategy selection only if a genuine branch remains
  -> validate the decision against current goal/state/budgets
  -> compile it back into the existing planner and capability catalogue
  -> ActionManager execution
  -> physical completion verification
  -> conservative learning from repeated verified outcomes
```

## Why this is a revision, not a direct translation

The governing paradigm is sound, but current evidence requires four corrections
before implementation:

1. **Repair reconciliation before adding reasoning.** The observed coal seam
   includes `skill_stance_unverified`, but current failed-target reconciliation
   recognizes only path/timeout/unreachable-style evidence. Losing concrete
   target identity can make deterministic recovery appear exhausted when it is
   not.
2. **Do not build from the pickaxe narrative as though it were proven.** The bot
   did mechanically reselect usable tools. The later narration that no pickaxe
   existed contradicted canonical inventory, but available evidence does not
   prove Mineflayer failed to see or switch tools. Tool durability and selected
   tool evidence must be explicit before classifying another incident.
3. **Keep model output advisory and typed.** The model may select a registered
   strategy or request clarification. It may not emit body commands,
   coordinates, targets, prerequisites, or arbitrary execution arguments.
4. **Reject stale decisions aggressively.** Goal revision, Stop generation,
   action identity, state snapshot, blocker signature, and candidate-set changes
   can all invalidate an in-flight response. A late but otherwise reasonable
   answer must never regain control.

## Non-negotiable invariants

- The original completion predicate remains authoritative. Coal does not become
  charcoal, or delivery become inventory acquisition, unless the player intent
  explicitly allows that semantic alternative.
- `GoalDirector` retains durable acquire/deliver/world-state ownership. Other
  directors retain their current domains. `Agenda` remains orchestration, not a
  body owner or replacement strategic planner.
- `ActionManager` remains the sole serialized physical-action owner.
- Mineflayer core and mature plugins retain ordinary mechanics: Pathfinder
  movement, tool selection, collection, crafting, smelting, combat, inventory,
  and related execution.
- A physical action must be settled and canonical Minecraft state refreshed
  before strategic escalation.
- Stop, goal replacement, restart, death, safety preemption, or invalidated state
  cancels or makes stale any pending model work.
- Model latency is never charged to an active physical-action deadline. No
  movement, digging, Pathfinder goal, or control state may remain ambiguously
  owned while the selector waits.
- Missing mechanics are capability gaps, not reasoning opportunities. For
  example, knowing that a nerd pole would solve a shaft escape does not make it
  safe to synthesize raw movement or placement.
- Narration, command acceptance, a selected strategy, or an intermediate item is
  never completion. Minecraft state proves completion.
- Strategy learning requires repeated equivalent verified success and must be
  invalidated by relevant code, registry, or contract changes.

## Evidence states and blocker taxonomy

Every failure reaching the strategic boundary must first be classified. The
taxonomy is deliberately small so the selector cannot become a generic error
handler.

| Class | Meaning | Owner / next action | Model allowed? |
|---|---|---|---|
| `mechanical_defect` | An installed mechanic or adapter did not perform its stated contract | Repair/configure the package boundary | No |
| `state_reconciliation` | Result evidence and fresh canonical state disagree or target identity was lost | Deterministically reconcile and preserve evidence | No |
| `known_recovery` | A registered, mechanically implied recovery remains feasible | Existing planner executes it | No |
| `strategic_branch` | Two or more materially different legal strategies remain after reconciliation | Bounded selector chooses a registered strategy | Yes |
| `clarification_required` | Player intent, permission, acceptable substitution, risk, or cost is materially ambiguous | Ask the player one focused question | Only to recommend clarification |
| `capability_gap` | No registered safe capability can carry out the needed tactic | Report truthfully and preserve objective evidence | No arbitrary composition |
| `terminal` | Completion is impossible or bounded alternatives are exhausted | Fail truthfully with evidence | No |

Classification is not inferred from a string alone. It uses the settled
`ActionResult`, target evidence, fresh canonical state, completion contract,
known recovery catalogue, and current budgets. Unknown evidence defaults to
reconciliation or truthful blockage, never to model authority.

## Strategic decision contract

### Candidate ownership

Deterministic code enumerates registered strategies. Each strategy has a stable,
versioned identifier and declares:

- applicable typed goal kinds and phases;
- completion semantics it preserves;
- deterministic feasibility checks;
- required registered capabilities;
- expected cost and safety class;
- exclusions and previous-attempt evidence;
- compiler entry point back into the existing planner.

The first implementation may prefer an existing strategy. It does not let the
model construct a new strategy, change a target, or supply capability arguments.

### Decision packet

The compact packet contains only decision-relevant state:

- goal ID, goal revision, phase, and immutable completion contract;
- current strategy ID and plan revision;
- Stop generation and latest settled action ID;
- snapshot ID, timestamp, and state fingerprint;
- structured blocker and concrete failed-target identity/evidence;
- relevant inventory, tool tier and durability, world facts, and known places;
- tried strategies with outcomes and exclusions;
- deterministically enumerated candidate IDs with feasibility, cost, and safety;
- remaining productive, recovery, strategic-call, and time budgets;
- candidate-set hash and strategy-registry epoch.

Do not send an unbounded transcript or world dump. Recent dialogue is included
only when it materially constrains the durable objective or allowed substitution.

### Model output

The accepted schema is intentionally narrower than a plan:

```json
{
  "decision": "prefer_strategy | ask_player | blocked",
  "strategyId": "registered-id-or-null",
  "reasonCode": "bounded-enum"
}
```

Free-form rationale may be logged separately for diagnosis but is never parsed
as an instruction. The validator rejects unknown fields, unknown strategy IDs,
unavailable candidates, goal-semantic changes, unsafe choices, and any response
whose packet identity is stale.

### Initial budgets

These are canary defaults, not permanent tuning:

- at most one selector call for the same blocker signature and goal revision;
- at most two accepted strategic decisions for one durable goal;
- approximately ten seconds wall time per call, outside the physical-action
  deadline;
- budget exhaustion produces clarification or truthful blockage, not a hidden
  retry loop;
- deterministic progress may create a new blocker signature, but log chatter,
  candidate switching, or model output is not progress.

## Lifecycle integration

Use the existing `GoalDirector` `recover -> assess` lifecycle with a bounded
`memory.strategicReconsideration` subrecord; do not add a new phase or director.

```text
assess -> acquire/verify/deliver
             |
             v
       settled failure
             |
             v
    fresh-state reconciliation
       |          |          |
       |          |          +-> terminal/clarify/capability gap
       |          +-> known deterministic recovery -> assess
       +-> genuine strategic branch
                         |
                         v
       quiescent strategic reconsideration
                         |
           validated preference or stale rejection
                         |
                         v
            accepted strategy ID -> assess
```

While a strategic request is pending in-process:

- no physical action remains active;
- the durable goal remains persisted and incomplete in the existing recovery
  lifecycle; the in-flight request itself is not persisted;
- the request carries an abort signal and immutable packet identity;
- Stop or replacement cancels it immediately;
- a restart does not resurrect the old request. Restore the goal, refresh state,
  and re-enter assessment; reissue only if the same blocker still qualifies and
  the persisted budget allows it;
- a valid preference persists the accepted strategy ID and consumed budget
  before returning through the normal planner. It does not call a skill
  directly; `planRevision` remains a derived in-process observation, not durable
  lifecycle authority.

## Implementation prework checklist

This checklist is the gate between the accepted H0 evidence work and any model
authority. A checked item records a concrete receipt; unchecked items are work,
not assumptions.

### Accepted foundation

- [x] Preserve fresh inventory, selected tool, durability, and the full failed
  target set at the collection/GoalDirector boundary.
- [x] Allow prerequisite evidence and concrete failed-target evidence to coexist
  instead of letting one erase the other.
- [x] Emit a truthful terminal-boundary taxonomy without changing execution.
- [x] Prove existing deterministic recovery in the live Paper world with an
  unchanged natural-language coal request (`64 -> 96` coal, including carried
  pickaxe rotation).
- [x] Reconcile the Jordan and Claude reviews: both authorize H0 only and require
  a positive planner-visible branch before selector work.

### Branch qualification — current implementation tranche

- [x] Define one pure, fail-closed qualification contract for `0`, `1`, and
  `2+` feasible planner-visible methods under the same completion predicate.
- [x] Treat incomplete enumeration, mixed completion predicates, unresolved
  feasibility, or unexhausted deterministic recovery as **not qualified**.
- [x] Derive method identities from the prerequisite planner; do not create a
  parallel hand-authored strategy registry.
- [x] Record the qualification receipt at existing GoalDirector terminal seams
  in shadow mode only: no model call, plan change, or new physical authority.
- [x] Add focused regression checks for the fail-closed gate and unchanged
  GoalDirector behavior.
- [x] Reject non-string, whitespace-aliased, oversized, truncated, or
  non-versioned method identities instead of coercing them into authority.
- [x] Prove planner-frontier `0`, `1`, and resolved `2+` outcomes; prove that
  search limits, planner budgets, already-satisfied completion, and planner
  runtime faults all fail closed rather than manufacturing a branch.
- [x] Bind every feasibility proof to the exact canonical executable plan,
  bind the complete candidate set to one frontier fingerprint, and make BQ0
  reject altered or missing proof identity.
- [x] Make BQ0 itself reject mechanical defects, state reconciliation, known
  recovery, clarification, and unknown blocker classes as model-ineligible.
- [x] Observe ordinary play until a complete frontier exposes either zero, one,
  or at least two materially distinct feasible methods.
- [x] Stop the rollout if the result is zero (capability gap) or one (use the
  deterministic method). Authorize H1 only for a repeatable unresolved `2+`
  branch.

### Required only after a positive branch receipt

- [ ] Define stable versioned strategy IDs around those existing planner method
  identities and build the compact packet plus strict pure validator.
- [ ] Keep model selection shadow-only while proving Stop cancellation,
  replacement/restart staleness, budget charging, and current-state
  revalidation.
- [ ] Persist only durable goal-scoped budget use and an accepted strategy ID;
  do not persist an in-flight request or add a new `awaiting_strategy` phase.
- [ ] Permit a canary only after shadow evidence shows useful bounded choices;
  compile accepted preferences through the existing planner and ActionManager.

### Measurable milestone receipts

| Milestone | Receipt | Success condition |
|---|---|---|
| BQ0 — fail-closed gate | Focused unit and GoalDirector telemetry checks | Incomplete/ambiguous input cannot become `strategic_branch`; gameplay is unchanged |
| BQ1 — planner frontier | Planner-derived method IDs and completeness evidence | Every reported candidate preserves one completion predicate and is independently feasible |
| BQ2 — live qualification | Flight-recorder event from ordinary play | `0`, `1`, or unresolved `2+` is observed truthfully; only `2+` permits H1 |
| H1 — packet/validator | Shadow packet and stale-response fixtures | No new execution authority; invalid or stale decisions are rejected |
| H2 — model shadow | Cancelable, budgeted shadow decisions | Decisions are measured but never executed |
| H3 — canary | One broad physical companion campaign | A validated preference compiles through existing mechanics and Minecraft state proves completion |

## Codeplan decision — BQ0 fail-closed qualification

Task contract: implement only the first branch-qualification milestone. It must
turn planner evidence into an explicit immutable receipt, fail closed on
incomplete or semantically mixed evidence, attach that receipt to the existing
terminal telemetry, and leave planning, model use, persistence, and physical
behavior unchanged.

Workspace: uncommitted user/concurrent work is present. This tranche owns only
this plan, the new pure qualification seam, its GoalDirector telemetry adapter,
and focused tests. In particular, `src/models/fallback-router.js`,
`src/models/prompter.js`, `package.json`,
`tests/control-plane/model-lifecycle.test.js`, `docs/coordination/CURRENT.md`,
`.claude/`, and unrelated untracked artifacts are protected.

Candidates:

- **V1 — inline GoalDirector classifier (conservative baseline):** compute the
  receipt inside `recordTerminalBoundary`. Smallest diff, but it couples a
  safety contract to telemetry construction and makes isolated verification and
  later planner reuse awkward.
- **V2 — pure qualification module plus terminal adapter:** normalize and
  classify evidence in a side-effect-free module; GoalDirector supplies its
  currently incomplete selected-chain evidence. This adds one narrow seam but
  cannot change behavior or manufacture completeness.
- **V3 — recursive planner-frontier refactor now:** retain every recursively
  successful plan and expose a complete method frontier. Disqualified at the
  paper gate: the planner currently commits one candidate at each recursive
  node and collection identities collapse different physical approaches into
  the same source/output key. Refactoring that search before method identity is
  established cannot truthfully satisfy BQ1 and materially expands this slice.

Frozen scoring axes: contract correctness/fail-closed behavior 30%; preservation
of planner/execution authority 25%; repository fit/simplicity 20%; isolated
testability/observability 15%; compatibility with a later planner-derived
frontier 10%.

| Candidate | Score | Decision evidence |
|---|---:|---|
| V1 | 4.10 / 5 | Safest diff and behavior preservation; weaker ownership and isolated verification |
| V2 | 4.70 / 5 | Strongest fail-closed contract and test seam while remaining shadow-only |
| V3 | disqualified | Cannot yet prove complete or materially distinct method identities |

`[codeplan · branch qualification BQ0 · PLAN-OUT · mode: constrained · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=4.10;V2=4.70;V3=disqualified-design-fail · reason: the pure gate improves contract ownership and falsifiable verification without changing planner or execution behavior · planned-fingerprint: pure+fail-closed+shadow-only+no-persistence]`

`[codeplan · branch qualification BQ0 · EXEC-OUT · implemented: V2 · confidence: high · verification: passed · mechanism-check: passed · plan-history: unchanged · corrected: none · evidence: 17/17 focused and adjacent tests passed; exact-file ESLint and syntax checks passed; managed Paper remained healthy and the single bot source reload returned IronSuiteProof to world_ready]`

## Codeplan decision — BQ1 planner-derived method frontier

Task contract: extend the prerequisite planner with a bounded, truthful frontier
of whole-goal completion methods. Every candidate must preserve one supplied
completion identity, be independently re-proven by the existing planner, carry
a stable versioned ID, and fail closed if enumeration cannot finish. Normal plan
selection, persistence, model use, and physical execution must remain unchanged.

Candidates:

- **V1 — retain all recursive speculative contexts:** refactor `produceItem` to
  expose every successful internal branch. This can be complete, but it is
  invasive and risks treating mutated prerequisite contexts as independent
  whole-goal methods.
- **V2 — bounded exclusion-lattice queries through the existing planner:** call
  `buildPrerequisitePlan` repeatedly for the unchanged completion contract,
  excluding each returned completion-producing method until the queue is
  exhausted. Every emitted candidate is therefore a successful full plan.
- **V3 — external registry/strategy enumerator:** duplicate recipe, smelting,
  collection, and entity-source logic beside the planner. Disqualified because
  it creates the forbidden second planner.
- **V4 — exclude only the selected next step:** smallest repeated-query adapter,
  but incomplete when plans share a prerequisite prefix and diverge at the
  completion-producing method.

Frozen scoring axes: contract correctness 30%; preservation of planner and
execution authority 25%; change risk 20%; falsifiable verification 15%; bounded
runtime cost 10%.

| Candidate | Score | Decision evidence |
|---|---:|---|
| V1 | 3.85 / 5 | Strong internal visibility, but invasive speculative-context ownership |
| V2 | 4.70 / 5 | Existing planner remains the only feasibility oracle; completeness and truncation are explicit |
| V3 | disqualified | Duplicates planner ownership and can drift from capability bindings |
| V4 | 3.90 / 5 | Small, but cannot prove a whole-goal frontier after shared prefixes |

`[codeplan · BQ1 planner frontier · PLAN-OUT · mode: constrained · pick: V2 · baseline: V4 · confidence: high · beatBaseline: yes · scores: V1=3.85;V2=4.70;V3=disqualified-design-fail;V4=3.90 · reason: independent full-plan proofs and fail-closed queue exhaustion preserve planner authority without a recursive refactor · planned-fingerprint: planner-oracle+completion-method-hash+bounded-exclusion-lattice+fail-closed-completeness+shadow-only]`

Repair revalidation before edit: `INVARIANT_HOLDS`. The chosen path calls the
existing planner for every candidate, does not persist frontier state, does not
call a model, and cannot dispatch a capability.

The first adversarial real-registry probe rejected a full prerequisite-chain
fingerprint: coal, torch, and iron-pickaxe each produced twelve noun-level wood,
stone, ore, and recipe permutations and hit the runtime search bound. Those are
prerequisite variants, not whole-goal strategies. The corrected identity is the
planner action that actually produces the requested completion item:

- source-name variants under the same capability/output collapse, so coal ore
  and deepslate coal ore are one `collect_block -> coal` completion method;
- distinct final transforms remain distinct, so coal-torch and charcoal-torch
  recipes remain two methods;
- each representative still carries the complete successful planner path as
  feasibility proof;
- raw completion-method keys remain the exclusion mechanism, allowing the
  search to exhaust source aliases without promoting them to separate IDs.

The corrected connected-registry probe completes within the twelve-query
terminal bound: coal `1` method / `3` queries, torch `2` deterministically ranked
methods / `3` queries, and iron pickaxe `1` method / `2` queries. This proves the
representation and bounded runtime; it is not BQ2 ordinary-play evidence and it
does not authorize H1.

`[codeplan · BQ1 planner frontier · EXEC-OUT · implemented: V2 · confidence: high · mechanism-check: passed · plan-history: corrected within V2 after adversarial registry evidence · authority: shadow-only · result: coal and iron-pickaxe remain deterministic single-method outcomes; torch exposes two methods but existing planner ranking resolves them]`

### BQ0/BQ1 verification receipt

- `12/12` focused branch/frontier checks passed, including hostile identity
  inputs, `0`/`1`/resolved-`2+`, stable IDs across source aliases, search and
  planner budget truncation, already-satisfied completion, planner runtime
  failure, immutable receipts, and unchanged GoalDirector model/persistence
  behavior.
- `34/34` adjacent prerequisite-planner, capability, completion, and learning
  checks passed.
- `16/16` adjacent GoalDirector recovery, persistence, Stop, late-settlement,
  relocation, and delivery checks passed.
- `4/4` flight-recorder and behavior-telemetry checks passed.
- Exact-file ESLint, Node syntax checks, and `git diff --check` passed.
- A corrected Minecraft `1.21.11` registry probe completed coal, torch, and
  iron-pickaxe frontiers within `3`, `3`, and `2` queries respectively.
- Managed Paper remained on PID `144666` and healthy at `127.0.0.1:25579`.
  The one-shot bot restart callback timed out as previously documented, but the
  process changed exactly once from PID `178841` to `184073`; no second restart
  was emitted, and the replacement reached `world_ready` with no diagnostic.

BQ0 and BQ1 were materially complete for their original contracts. The two
pre-BQ2 hardening audits below found and closed evidence/authority defects
before live qualification.

### BQ1 pre-BQ2 hardening receipt

`[codeplan · BQ1 pre-BQ2 hardening · PLAN-OUT · mode: constrained · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · reason: canonical executable proof plus BQ0-owned frontier and blocker validation closes both reproduced defects at their owners without adding execution authority · planned-fingerprint: canonical-executable-proof+frontier-integrity+BQ0-blocker-gate]`

**CENTER-AUDIT RESULT: DEFECT_CONFIRMED — executable proof identity.** The old
`plannerProofFingerprint` hashed capability IDs, learning keys, and target names
but omitted capability arguments and effects. A before-repair probe produced
identical plan fingerprints for quantity `1` and quantity `2` under both the
craft and collect methods. That made the purported feasibility proof weaker
than the executable plan it identified.

**CENTER-AUDIT RESULT: DEFECT_CONFIRMED — blocker authority.** The old BQ0 API
did not accept a blocker class, while GoalDirector always supplied
`deterministicRecoveryExhausted: true`. A before-repair probe explicitly paired
`mechanical_defect` with a complete unresolved two-method frontier and received
`strategic_branch`. That crossed the rollout's own model-eligibility taxonomy.

The bounded correction is schema version `2`:

- the planner canonicalizes and hashes status, code, target, quantity, and the
  complete public executable action list, including capability arguments and
  expected effects;
- a stable order-independent frontier fingerprint binds completion identity,
  completeness, ranking, selection, method IDs, feasibility, and every plan
  fingerprint;
- BQ0 recomputes that fingerprint and rejects missing, malformed, altered, or
  conflicting candidate proof identity;
- BQ0 accepts only `terminal` and `capability_gap` blocker classes. Mechanical
  defects, state reconciliation, known recovery, clarification, missing, and
  unknown classes fail closed before any strategic branch can be established;
- GoalDirector passes the classified blocker and frontier fingerprint into BQ0
  and records both in the existing bounded terminal event. No model, dispatch,
  persistence, phase, or ActionManager authority was added.

Repair revalidation: `INVARIANT_HOLDS` for lifecycle, persistence, dispatch,
model isolation, and ordinary planner selection. Post-repair adversarial probes
showed every quantity-changing executable proof and its frontier fingerprint
changed, while `mechanical_defect` returned
`not_qualified / blocker_class_ineligible`.

- `15/15` focused branch/frontier/GoalDirector cases passed.
- `51/51` adjacent planner, capability, learning, GoalDirector, flight-recorder,
  and behavior-telemetry cases passed.
- Exact-file ESLint, Node syntax checks, and `git diff --check` passed.
- The documented no-unobserved-demolition Minecraft `1.21.11` probe remained
  coal `1` method / `3` queries, torch `2` / `3`, and iron pickaxe `1` / `2`,
  now with exact plan and frontier fingerprints.
- One managed reload changed the bot exactly once from PID `184073` to
  `191653`; Paper remained healthy on PID `144666` and the replacement reached
  `world_ready`. The callback timeout was treated as ambiguous and was not
  retried.

`[codeplan · BQ1 pre-BQ2 hardening · EXEC-OUT · implemented: V2 · confidence: high · mechanism-check: passed · authority: shadow-only · verification: 66/66 focused and adjacent checks passed; both before-repair probes now fail closed; managed runtime world_ready]`

### BQ2 ordinary-play qualification receipt

**BQ2 RESULT: COMPLETE — truthful zero-method capability gap.** On 2026-08-10,
a real temporary Mineflayer player named `BQ2Witness` joined the managed Paper
world and sent the unchanged natural request: **“Bring me one netherite
pickaxe.”** The existing deterministic player-directive route accepted delivery
goal `goal-0cd4c8ee-c179-4a0f-b0e8-9c3764c3d4e3` without a model prompt.

Flight recorder sequence `2` in
`bots/IronSuiteProof/telemetry/flight-2026-08-11T00-11-19-948Z-191653-000.jsonl`
recorded:

- boundary `causal_plan_blocked` and terminal code
  `unsupported_acquisition_leaf`;
- blocker class `capability_gap`;
- a complete schema-v2 frontier in `1` planner query with `0` candidates and
  fingerprint
  `49540c4aae4cacd8b4807165d40b748d122a9270905179b8070654934ae60035`;
- qualification `capability_gap / no_feasible_method`, with the same completion
  and frontier identity, `strategicBranchEstablished: false`, and no selected
  method;
- `0` attempts, no last physical action, no model prompt, no recorder
  compaction/error, and an honest in-game failure report to the requester.

The independent lifecycle oracle agrees: the persisted goal is terminal
`failed` with the same goal ID/code, inventory and world action state did not
change for the request, and IronSuiteProof remained `world_ready` after the
witness disconnected.

BQ2 therefore passes as a qualification milestone and stops this selector
rollout at the intended negative gate. It proves that ordinary play can produce
a truthful complete receipt; it does **not** justify H1. No strategy packet,
model selector, canary, or new execution authority should be implemented from
this result.

### Qualification evidence checkpoint — BQ0/BQ1/BQ2

The prior BQ0/BQ1 Ladder Audit result remains
`COMPLETE_FOR_DEFINED_SCOPE`; this tranche did not invoke a new completion-audit
workflow. Additional synthetic BQ0/BQ1 qualification would repeat proven
owners rather than reduce uncertainty. BQ2's independent ordinary-play oracle
is now recorded, and its zero-method result closes the current rollout before
model-selector work.

| Required contract | Receipt | Verdict |
|---|---|---|
| BQ0 cannot coerce malformed evidence into authority | Strict completion strings, versioned planner-ID grammar, hostile-input checks | Proven |
| `0`, `1`, resolved `2+`, and unresolved `2+` classify truthfully | Pure qualification cases, duplicate/conflict checks, immutable receipts | Proven |
| BQ1 methods come from the existing planner | Every candidate originates in a successful `buildPrerequisitePlan` call; no strategy registry was added | Proven |
| Method identity is stable and material | Completion-producing binding hash; source aliases collapse; coal/torch/iron transfer probe | Proven |
| Every candidate preserves one completion predicate | Exact shared completion identity is required by frontier and rechecked by BQ0 | Proven |
| Enumeration never overclaims completeness | Search cap, planner budget, invalid contract, runtime failure, and already-complete cases all return incomplete/not-applicable | Proven |
| Ordinary deterministic planning is unchanged | `buildPrerequisitePlan` selection path is untouched; 34 adjacent planner/capability checks pass | Proven |
| GoalDirector integration is shadow-only | No model call, persistence save, dispatch, phase change, or active-goal mutation in focused checks | Proven |
| Telemetry/runtime packaging remains healthy | Bounded proof summary, 4 telemetry checks, one managed reload to `world_ready` | Proven |
| Executable and frontier proof identity resists argument/candidate tampering | Before/after quantity probe, hostile proof checks, schema-v2 hashes | Proven |
| Model-ineligible blockers cannot establish a branch | Pure class matrix plus mechanical GoalDirector integration check | Proven |
| Ordinary gameplay produces a live qualification receipt | Natural player delivery request, flight sequence 2, persisted terminal goal | Proven: `0` / capability gap |

Scaffolds were bounded and transferred: the synthetic two-method registry proved
classification and negative controls; the real connected registry rejected
noun-level overfitting; adjacent lifecycle tests removed isolated-planner
assumptions; and the managed reload removed source-only packaging assumptions.
No production branch contains fixture names, rung IDs, known coordinates, or a
canned answer. BQ2 owns the independent live terminal-boundary oracle and its
zero-method result is recorded without being promoted into selector authority.

## Bounded Center Audit receipts

### CENTER A — planner-visible method identity

**CENTER-AUDIT RESULT: DEFECT_CONFIRMED**

**Case file:** static workspace audit at `8e58d0bcb95d`; dirty concurrent
changes were treated as protected. Center: `sourceLearningKey` and the
`buildPrerequisitePlan` acquisition-choice edge. Falsifier: an existing
GoalDirector-visible API that exhaustively returns stable, materially distinct,
feasible whole-goal method identities for one unchanged completion contract.

**Claim:** the current GoalDirector prerequisite path cannot truthfully establish
a strategic branch. It identifies collection by `collect:<source>-><output>`,
commits the best candidate at recursive choice points, and exposes only the
selected action chain. Cave and corridor methods do exist in the separate
Explorer work-order state machine, but they are a deterministic sequence there,
not an enumerated GoalDirector frontier.

**Fusion:** likelihood CERTAIN; impact MEDIUM at the current shadow-only stage;
confidence HIGH; reproducibility DETERMINISTIC. The terminal consequence is a
readiness block: building a selector registry now would either duplicate planner
ownership or present an incomplete frontier as complete.

**Evidence ledger:**

- E1 [SOURCE/B] `prerequisite-planner.js:515-516`: source method identity contains
  only source and output.
- E2 [SOURCE/B] `prerequisite-planner.js:1187-1242`: world sources are tried in
  order and the first successful candidate is committed.
- E3 [SOURCE/B] `prerequisite-planner.js:1453-1531`: recipe/entity/world-source
  candidates are compared internally, then only `successfulMethods[0]` is
  accepted.
- E4 [SOURCE/B] `goal-director.js:959-973,2255-2292`: terminal telemetry declares
  selected-chain scope and incomplete enumeration; GoalDirector receives one
  returned plan.
- E5 [SOURCE/B] `jobs/explorer-plan.js:205-240,447-455`: cave and corridor have
  distinct work-order method keys, but the state machine switches between them
  deterministically after exhaustion.
- E6 [STATIC-TOOL/C] bounded reference search: GoalDirector has one
  `buildPrerequisitePlan` call and no Explorer frontier adapter.

**Trajectory:** source/output learning key -> recursive candidate selection ->
one public plan -> explicitly incomplete terminal receipt. No unproven hop is
needed for the readiness verdict.

**Confirmed defect:** [MEDIUM, HIGH confidence] planner method representation is
insufficient for a strategic `2+` proof. This does not make current gameplay
incorrect because selector execution remains disabled.

**Disproven concern:** the existing Explorer cave/corridor keys do not falsify
the claim; E5 shows they belong to another owner and are selected sequentially,
not enumerated as simultaneous alternatives for one GoalDirector predicate.

**Repair contract:** BQ0 must remain fail-closed. BQ1 may extend the existing
planner to expose complete whole-goal method identities, but it may not copy
Explorer methods into a parallel registry or reinterpret selected causal steps
as alternative strategies. Verify that duplicate IDs collapse, every method
preserves one completion identity, and incomplete enumeration never qualifies.

**Explicit non-scope:** do not refactor recursive planning, migrate Explorer
ownership, or add a model selector in BQ0. Stop reason: the exact representation
gap and the next admissible boundary are established.

### CENTER B — BQ0 lifecycle and persistence boundary

**CENTER-AUDIT RESULT: NO_DEFECT_CONFIRMED**

**Case file:** static edge audit at `8e58d0bcb95d`; center edge
`GoalDirector.recordTerminalBoundary -> BehaviorFlightRecorder.recordRuntimeEvent`.
Falsifier: a reachable call from that edge into model dispatch/cancellation,
GoalDirector persistence, operator-hold generation, or physical execution.

**Claim:** V2 can be implemented without entering Stop, cancellation,
persistence, or action-ownership surfaces, provided the qualification function
is synchronous and pure and its result is only attached to the existing
terminal event.

**Fusion:** likelihood UNLIKELY that BQ0 crosses the audited lifecycle boundary;
impact HIGH if that constraint were violated; confidence HIGH; reproducibility
NOT_APPLICABLE. Root cause N/A.

**Evidence ledger:**

- E1 [SOURCE/B] `goal-director.js:919-1008`: terminal recording reads snapshots
  and sends one telemetry event; it does not persist, dispatch, or call a model.
- E2 [SOURCE/B] `behavior-flight-recorder.js:327-331`: the event is bounded and
  enqueued; the recorder owns telemetry I/O only.
- E3 [SOURCE/B] `goal-director.js:669-672,737-770`: goal persistence and
  cancellation are separate explicit methods outside the audited edge.
- E4 [SOURCE/B] `agent.js:740-779`: Stop generation and model cancellation are
  owned by `holdPosition`, also outside the audited edge.
- E5 [STATIC-TOOL/C] bounded exact-reference search found no reverse call from
  terminal telemetry into those lifecycle owners.

**Trajectory:** terminal condition -> pure receipt (planned) -> bounded telemetry
enqueue. Evidence of absence is strong within this exact edge; it does not audit
the future H2 model request lifecycle.

**Confirmed defects:** none. Disproof quality STRONG for BQ0's bounded surface.

**Repair contract:** N/A for the current edge. Implementation constraint: BQ0
may add only a pure module, a synchronous GoalDirector adapter, and telemetry;
no goal schema, store version, model route, hold generation, phase, dispatch, or
ActionManager change is allowed.

**Verification plan:** focused pure gate cases plus one GoalDirector terminal
event check that asserts the receipt is recorded while the active goal and model
call count remain unchanged. Stop reason: all evidence-bearing edges from the
center are resolved; future selector cancellation is intentionally deferred to
H2.

### CENTER C — strict BQ0 evidence identity

**CENTER-AUDIT RESULT: DEFECT_CONFIRMED, REPAIRED**

Center: `strategic-branch-qualification.js` input normalization. Falsifier: an
explicit type, size, control-character, and planner-ID grammar check before any
candidate can contribute authority.

The original `boundedString` coerced objects and truncated oversized method IDs.
That could alias malformed evidence to a valid candidate or selected method.
BQ0 now rejects rather than coerces: completion identities must be exact bounded
strings, and method IDs must match `planner_method:v1:<64 lowercase hex>`.
Focused checks cover object coercion, leading/trailing whitespace, control
characters, truncation, invalid selection, oversized candidate sets,
conflicting duplicate feasibility, and unknown ranking. Impact is MEDIUM while
shadow-only and HIGH before any future selector authority; confidence HIGH.

### CENTER D — material whole-goal identity

**CENTER-AUDIT RESULT: DEFECT_CONFIRMED, REPAIRED**

Center: BQ1 method fingerprint and exclusion key. Falsifier: a connected-registry
probe in which ordinary coal, torch, and iron-pickaxe frontiers complete within
the terminal bound without promoting wood species, stone aliases, or ore block
variants to separate whole-goal strategies.

Hashing every prerequisite decision failed the falsifier: all three probes hit
twelve queries and remained incomplete because tool-manufacturing permutations
dominated the frontier. The repaired center identifies the planner action that
produces the requested completion item, groups source aliases under one
capability/output method, and retains the successful prerequisite chain only as
proof. The repeated probe completed as coal `1`, torch `2` resolved, and iron
pickaxe `1`. Cave/corridor are still not invented as separate methods because
both currently compile to the same collection completion binding. Impact MEDIUM,
confidence HIGH, reproducibility DETERMINISTIC.

## Rollout horizons

Each horizon has a player-visible or invariant-level exit. No later horizon
starts because earlier code merely exists.

### H0 — Evidence and deterministic hygiene

Purpose: ensure strategic escalation is responding to a real decision boundary,
not hiding a mechanical or evidence defect.

Work:

- use the online flight recorder during ordinary play and `WTF` bookmarks;
- repair the current `skill_stance_unverified` failed-target reconciliation gap;
- preserve tool selection, item durability, selected slot, failed target, and
  fresh inventory evidence in relevant action outcomes;
- emit the blocker taxonomy at GoalDirector terminal seams without changing
  behavior yet;
- rerun the same broad coal/fuel request after the shared repair.

Exit:

- the coal campaign either continues through existing deterministic recovery or
  exposes one repeatable `strategic_branch` with concrete, fresh evidence;
- the same failure no longer appears under multiple vague reason strings;
- no more than two new repair classes are consumed before checkpointing under the
  campaign governor.

### H1 — Strategy packet and validator in shadow mode

Purpose: prove that the strategic boundary can be represented without granting
new authority.

Work:

- after a positive BQ2 receipt, wrap only those existing versioned planner
  method IDs in the strategy contract; do not create a parallel method list;
- consume the BQ1 deterministic frontier and completeness receipt rather than
  re-enumerating candidates;
- build the compact decision packet and strict pure validator;
- create packet fingerprints and stale-response predicates;
- record what would have escalated, but do not call a model or change execution.

Exit:

- ordinary play produces understandable packets only at genuine branches;
- packets exclude routine mechanical failures and known recovery;
- candidate lists preserve the exact completion contract;
- no physical behavior changes.

### H2 — Bounded selector, still shadow-only

Purpose: measure whether a model can make useful choices under the narrow
contract before any choice affects gameplay.

Work:

- add a dedicated selector prompt and structured response parser; do not reuse
  free-form `promptAutonomy`;
- enforce cancellation, deadline, per-blocker deduplication, per-goal budgets,
  and strict staleness checks;
- log the decision, validation result, and what deterministic code actually did;
- compare selector preference to fresh feasibility and later physical outcome.

Exit:

- zero stale, invalid, or unknown responses are executed because execution is
  still disabled;
- latency and escalation frequency are measured from ordinary play;
- most selector calls correspond to a materially different strategy choice, not
  missing mechanics or stale state;
- invalid/rejected rates are low enough to justify a canary, with exact examples
  reviewed rather than a target percentage invented in advance.

### H3 — Typed-goal canary execution

Purpose: let one validated preference revise one existing typed goal through the
normal planner.

Scope:

- one bot/profile;
- `GoalDirector` acquire or deliver goals only;
- registered strategy selection only;
- no arbitrary targets, coordinates, arguments, or capability compositions.

Work:

- persist only durable goal-scoped decision-budget use and an accepted strategy
  ID; keep the in-flight packet/request process-local and do not add an
  `awaiting_strategy` phase;
- compile the preference into existing planner exclusions/priorities and a new
  plan revision;
- preserve Stop, replacement, death, restart, and action-settlement invariants;
- add a kill switch that disables canary execution while retaining shadow
  telemetry.

Physical acceptance:

1. A broad natural request encounters an evidenced deterministic blocker.
2. Known recovery is genuinely exhausted or inapplicable.
3. The selector chooses a feasible registered alternative.
4. GoalDirector, the existing capability catalogue, and ActionManager execute it.
5. Minecraft state verifies the original completion predicate.
6. Stop and restart trials demonstrate that no stale response can reacquire the
   body or grant an extra attempt.

After one accepted domain, repeat with an unrelated resource or delivery request
before expanding ownership.

### H4 — Conservative strategy learning

Purpose: make recurring successful decisions cheap without turning anecdotes
into permanent policy.

Work:

- extend the existing procedure/outcome storage seam rather than create a new
  memory platform;
- key learned preferences by a strong state signature: goal semantics, blocker,
  candidate set, relevant inventory/tool state, environment class, safety class,
  and registry/code epoch;
- record verified completion and material failures;
- permit deterministic preference only after at least three equivalent verified
  successes, no recent safety failure, and no invalidating epoch change;
- fall back to normal enumeration when confidence or equivalence is not met.

Exit:

- a repeated equivalent branch skips inference and still physically completes;
- an altered state signature or strategy epoch does not reuse the learned choice;
- one target-local failure cannot poison a method or resource family globally.

### H5 — Owner-by-owner expansion

Purpose: extend the advisory seam without collapsing director ownership.

Order:

1. additional `GoalDirector` goal phases supported by live evidence;
2. `JobDirector` only when telemetry shows the same branch contract applies;
3. construction or other domains only after their owner can enumerate stable
   strategies and validate completion semantics.

`Agenda` remains an orchestrator. Each owner integrates the shared packet and
validator but remains responsible for its own goal lifecycle. Expand one owner at
a time and retain a shadow-only switch per owner.

Exit:

- two materially different owners can use the shared advisory seam without
  concurrent body ownership, cross-domain goal mutation, or duplicated planners.

### H6 — Semantic alternatives and constrained novel composition

Purpose: support richer substitutions without quietly changing what the player
asked for.

First add explicit semantic completion contracts, such as a player-approved fuel
equivalence class. Only after selection-only operation is stable may the model
propose a declarative composition of registered capabilities. Such a proposal
must be schema-validated, deterministically grounded, costed, permission-checked,
and compiled by the owning director. Raw commands and body control remain out of
scope.

Exit:

- a semantic substitute is accepted only when the persisted player contract
  permits it;
- a constrained composition completes through registered capabilities and exact
  Minecraft verification;
- disabling the experimental lane restores selection-only behavior.

### H7 — Long-session continuity

Purpose: prove the feature improves being a companion rather than one benchmark.

Use ordinary mixed sessions, not an exhaustive synthetic certification campaign.
Exercise mundane acquisition, delivery, travel, interruption, survival, tool
turnover, workstation use, and restart. Cluster first material failures from the
flight recorder and obey the two-class campaign governor.

Exit direction:

- durable objectives routinely survive tactic failure, safe interruption, and
  restart;
- the player intervenes less often to restate still-valid intent;
- strategic calls remain exceptions rather than per-action tolls;
- zero observed objective drift, stale-response execution, or concurrent
  physical ownership;
- remaining failures are truthfully classified and preserved for the next broad
  campaign.

## Telemetry required for rollout

Extend the existing bounded flight recorder; do not create a second telemetry
system.

Events:

- `strategy.reconsideration_started`
- `strategy.decision_received`
- `strategy.decision_rejected`
- `strategy.response_stale`
- `strategy.execution_started`
- `strategy.execution_outcome`
- `strategy.budget_exhausted`

Decision records should carry goal/plan revisions, blocker and target signatures,
packet/candidate hashes, latency, decision/result codes, and final physical proof
references. They must respect existing queue, record-size, and disk bounds.

Track:

- escalation frequency by goal kind and blocker class;
- decision latency and cancellation latency;
- stale, rejected, unknown, and budget-exhausted response counts;
- decision-to-first-action time;
- repeated blocker signatures after strategy replacement;
- verified success/failure by strategy and state signature;
- player clarification/intervention frequency;
- objective-drift and concurrent-action-ownership incidents, whose acceptable
  count is zero.

Metrics describe behavior; they do not prove product success without physical
Minecraft outcomes.

## Current implementation anchors

At branch checkpoint `1b6a7a3` plus the BQ0/BQ1 work recorded here:

- `src/agent/runtime/goal-contract.js` retains the established lifecycle; no
  reconsideration phase or persisted in-flight selector state was added.
- `src/agent/runtime/goal-director.js` owns one shared prerequisite-option seam
  for normal planning and terminal frontier evidence, then records only a
  bounded qualification/frontier summary.
- `src/agent/runtime/prerequisite-planner.js` remains the feasibility owner and
  now exports the bounded completion-method frontier plus canonical executable
  plan/frontier fingerprints; ordinary `buildPrerequisitePlan` selection is
  unchanged.
- `src/agent/runtime/strategic-branch-qualification.js` owns the pure immutable
  `0`/`1`/resolved-or-unresolved-`2+` gate, accepts only versioned planner
  method/proof identities, verifies the complete frontier fingerprint, and
  rejects model-ineligible blocker classes.
- the planner's existing `excludedMethods`, capability catalogue, and
  `planRevision` remain the future compilation seam; no new registry exists.
- free-form `promptAutonomy` still expects executable commands and remains
  unsuitable for strategic selection.
- `src/agent/runtime/behavior-flight-recorder.js` is the bounded telemetry sink;
  BQ1 adds no model call, persistence write, dispatch, or ActionManager path.

These anchors must be rechecked at implementation time; this plan does not freeze
line numbers or assume the checkout cannot change.

## Change sequence and rollback

1. BQ0 and BQ1 are implemented and hardened. BQ2 ordinary play produced a
   complete live `0`-method capability-gap receipt without changing behavior.
2. H1 remains blocked. This BQ2 zero-method result ends the current selector
   rollout; only a later, naturally observed, repeatable unresolved and
   materially distinct `2+` branch may reopen H1 review.
3. H3 requires an explicit canary configuration defaulting off outside the named
   profile. Disabling it must leave current deterministic behavior intact.
4. Persisted additions must be versioned and backward-compatible. Older goal
   records restore to assessment rather than inventing an in-flight decision.
5. H4 learning remains disabled until H3 has repeated verified outcomes.
6. H5–H7 begin only from live evidence and Director authorization, not because
   this document lists them.

Rollback means disabling model selection and returning a persisted goal to fresh
deterministic assessment. It never means discarding the durable objective,
rewriting history, or bypassing Stop.

## Explicitly deferred

- unrestricted model-generated capability plans;
- arbitrary model-generated coordinates, targets, or commands;
- a general world-model service or second state schema;
- a new director, scheduler, action executor, or movement layer;
- broad item-specific recovery trees;
- automatic dependency additions or upgrades;
- broad promotion of single successful tactics into learned policy;
- exhaustive scenario matrices or soak infrastructure.

## Review disposition

The Jordan and Claude reviews accepted the advisory boundary, H0-first ordering,
and reuse of planner exclusions/priorities, but did not authorize a selector
from the architecture alone. Their controlling condition remains: H1 starts
only after ordinary play repeatedly exposes a complete, materially distinct,
unresolved `2+` planner frontier for one unchanged completion contract. BQ1's
offline torch result is deterministically ranked, and BQ2's live netherite
pickaxe result is a zero-method capability gap; neither satisfies that
condition. Packet staleness, Stop/replacement/restart cancellation, and budget
persistence remain H1/H2 proof obligations only if that gate is ever crossed.
