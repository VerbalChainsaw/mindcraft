> **ARCHIVED 2026-08-17 — NOT CURRENT.**
> This document predates the 2026-08-16 architecture reset and describes a plan
> the project no longer follows. Kept as history, not as instruction.
>
> **Why it was archived:** Plans the obligation spine that ARCHITECTURE.md Step 5 deletes.
>
> Current design: `ARCHITECTURE.md` · how to work: `AGENTS.md` · start here:
> `docs/HANDOFF.md`

[codeplan · shared receipt and obligation spine · IN · mode: full · confidence: high · candidates: V1 receipt-first staged migration (context ledger), V2 obligation-kernel-first migration (event reducer), V3 domain-by-domain extraction (domain adapters), V4 wholesale runtime replacement (runtime replacement) · lean: V1 · baseline: V3]

# Shared Receipt and Obligation Spine

**Date:** 2026-08-15
**Status:** proposed architecture and migration plan; no source implementation is authorized by this document alone
**Primary outcome:** stop repairing lost causality, retry authority, identity, and cancellation independently at every gameplay seam while preserving Mineflayer package ownership and existing accepted gameplay.
**Planning evidence snapshot:** dirty workspace based on `12bdc21081a3e883b945d6eb001a543ba61e7902`; implementation must remeasure the activating path because concurrent gameplay work is expected.

## Decision

Use a **receipt-first staged migration**. Extend ActionManager's existing async
execution context into the single action-scoped receipt carrier, retain a
bounded compatibility adapter for unmigrated skills, then build shared
obligation settlement and material-change retry decisions on those receipts.
Migrate participant identity, prerequisite callers, and cohesive physical
domains only when their activating broad scenario reaches them.

This is not a new mechanics engine, a new director, or a big-bang rewrite.
ActionManager remains the body-ownership boundary. AgendaDirector continues to
sequence complete player intent, GoalDirector continues to own durable outcome
planning, JobDirector continues to own resumable role work, and Mineflayer plus
its installed plugins continue to perform physical mechanics.

## Why this requires an architectural change

The current snapshot has repeated evidence that local repairs are preserving or
reconstructing information which should have survived a shared boundary:

- At the audited dirty snapshot, `src/agent/library/skills.js` was 24,501
  lines and contained 475 `setActionEvidence(...)` calls. `src/agent/`
  contained 85 `lastActionEvidence` references. These counts show migration
  pressure; they are not acceptance gates and must be remeasured at the
  implementation checkpoint.
- `setActionEvidence` contains a special preservation rule for returnable mining
  routes. Parent skills separately snapshot navigation, collection, cleanup,
  death recovery, and other child receipts before a later child overwrites the
  same global slot.
- `goToPlayer` recently needed a before/after identity comparison merely to
  retain the navigation receipt produced by `goToGoal`.
- ActionManager already owns an `AsyncLocalStorage` execution context containing
  action ID, cancellation signal, and deadline, but result evidence is still
  collected afterward from `bot.lastActionEvidence`.
- AgendaDirector, GoalDirector, JobDirector, and SurvivalDirector independently
  implement overlapping attempt, retry, cooldown, preemption, cancellation,
  material-change, and terminal-settlement rules.
- `prepareTool` and `prepareMaterial` remain recursive prerequisite planners
  inside the physical skill layer even though the durable prerequisite planner
  and capability catalogue already own the same causal problem for newer paths.
- Physical player lookup is centralized in `player-target.js`, but recent
  durable Agenda admission still required a separate roster check because raw
  name strings crossed the persistence boundary without an authoritative
  participant binding.

The problem is therefore not merely module size or duplicated syntax. It is
that child evidence, authority, and retry identity are not consistently carried
through action and obligation boundaries.

## Governing constraints from `AGENTS.md`

- The shared stages remain selection, feasibility, planning, execution,
  reconciliation, and verified outcome.
- Missing evidence is unknown. Stop, preemption, owner replacement, and
  cancellation are censored samples, not mechanic failure.
- Project code owns judgment, authority, receipts, recovery, and reporting.
  Mineflayer and mature plugins own physical mechanics.
- No parallel movement, combat, collection, tool, or survival engine may be
  created.
- No dependency may be added or upgraded without explicit authority.
- Broad natural gameplay and direct Paper evidence remain the product oracle.
  Focused checks support an observed defect; they do not replace live play.
- Accepted mechanics remain frozen unless directly changed or contradicted by
  materially different live evidence.
- Relevant dirty WIP must be preserved and integrated. No reset, clean, stash,
  commit, or push is implied by this plan.
- Substantial debt work may span all causally necessary modules, but it must
  declare a concrete system outcome, acceptance evidence, and material stop
  condition.

## Completion-audit corrections incorporated

A read-only Center Audit confirmed the V1 mechanism and found underspecified
boundaries that could otherwise recreate the same patch cycle during
implementation. This revision makes the following part of the selected
mechanism rather than optional implementation detail:

- an explicit open-to-sealed ledger lifecycle covering success, exception,
  timeout, cancellation, and owner replacement
- exactly one terminal receipt plus ordered, bounded child sequences
- normalization and deep immutability at both recording and ActionResult
  publication
- one compatibility writer and deterministic dual-write precedence
- separate method retryability, strategic retry authority, material change,
  budget, and censorship facts
- distinct durable identity and current-presence states

These corrections do not change the variant selection. They are the conditions
under which V1 passes its viability gates.

## Codeplan calibration

### Triviality gate

`trivial: no · continue`

This crosses action evidence, director settlement, persistence, identity, and
planner ownership. Several credible migration mechanisms exist and a wrong
choice could destabilize accepted gameplay.

### Repository quality axes

- **Style:** existing ESM JavaScript, small pure normalizers/reducers, bounded
  constants and text, immutable public receipts, snake-case outcome codes.
- **Theme / paradigm:** shared contract spine, project judgment around
  package-owned mechanics, explicit ownership and authoritative Minecraft
  reconciliation.
- **Methodology:** preserve dirty WIP, migrate through evidenced broad outcomes,
  retain public command behavior, avoid speculative frameworks and test
  matrices.
- **Modernization:** use existing `AsyncLocalStorage`, `AbortSignal`, frozen
  records, versioned schemas, and explicit return values without adding a type
  system or dependency.
- **Error wrapping:** bounded structured stage and retry evidence; unknown stays
  unknown and censorship is not reclassified as failure.
- **Testability:** pure normalization/settlement functions plus small injectable
  integration boundaries; focused regressions tied to observed failures.
- **Blast radius / reversibility:** compatibility adapters, versioned persisted
  fields, one active migration boundary at a time, no command/API flag day.

## Variants

### V1 — Receipt-first staged migration

**Mechanism fingerprint:** `context ledger`

Taxonomy: control flow `append child`; data structure `receipt tree`; module
boundary `internal module`; state location `async context`; dependency
`internal reuse`; error path `return receipt`.

Extend ActionManager's existing execution context with a bounded receipt ledger.
Skills record immutable child receipts into that context. ActionManager consumes
the composed final receipt directly and temporarily mirrors the current terminal
skill receipt to `bot.lastActionEvidence` for unmigrated callers. After the
evidence boundary is stable, add a pure shared obligation-settlement reducer and
material-change failure ledger used by existing directors.

### V2 — Obligation-kernel-first migration

**Mechanism fingerprint:** `event reducer`

Taxonomy: control flow `event reduce`; data structure `event list`; module
boundary `new runtime kernel`; state location `director instance plus stores`;
dependency `internal reuse`; error path `return transition`.

First introduce a common obligation event/state reducer beneath AgendaDirector,
GoalDirector, JobDirector, and SurvivalDirector. Normalize dispatch,
preemption, retry, and terminal events there. Migrate action receipts afterward.
This centralizes ownership quickly but initially still consumes the mutable
`lastActionEvidence` boundary and requires simultaneous persistent-state changes
across several directors.

### V3 — Domain-by-domain extraction

**Mechanism fingerprint:** `domain adapters`

Taxonomy: control flow `direct call`; data structure `local record`; module
boundary `extracted domain`; state location `local only`; dependency
`zero dependency`; error path `return code`.

Extract one physical domain at a time from `skills.js`—navigation first, then
containers/workstations, collection/mining, and survival. Each domain locally
improves its evidence and retry handling. This has the smallest initial change
surface, but it permits each extracted module to establish a different receipt
and retry convention before the shared boundary is fixed.

### V4 — Wholesale runtime replacement

**Mechanism fingerprint:** `runtime replacement`

Replace the directors, ActionManager evidence, prerequisite planning, and the
physical skill facade with one new runtime and migrate all persisted state and
commands at once.

## Variant divergence check

- V1 versus V2 differs in state location and ordering: action-local async
  receipt context first versus cross-director event state first.
- V1 versus V3 differs in module boundary and carrier: one shared execution
  ledger versus independent domain-local result records.
- V2 versus V3 differs in control flow and persistence: centralized event
  reduction versus direct domain adapters with local state.
- V4 differs from all candidates in compatibility and migration mechanism.

These variants are mechanically distinct, not naming alternatives.

## Hard viability gates

| Gate | V1 | V2 | V3 | V4 |
|---|---|---|---|---|
| Functional correctness | G: pass with the sealed terminal/child reconciliation contract below | G: pass | G: pass | G: pass |
| Required contracts and public commands | G: pass | G: pass with versioned migrations | G: pass | G: fail — flag-day replacement threatens accepted contracts |
| Negative-space | G: pass | G: pass | G: pass | G: pass |
| Dependency contamination | G: pass | G: pass | G: pass | G: pass |
| Repository HARD rules | G: pass | G: pass | G: pass | G: fail — wholesale rewrite and speculative adjacent system |
| Security and data integrity | G: pass with deep immutable bounded publication and fail-closed stale-write rejection | G: pass with atomic persistence work | G: pass | G: fail — simultaneous store migration has unacceptable corruption exposure |
| Regression and migration path | G: pass through one normalized compatibility adapter with exact precedence | G: pass but broad | G: pass | G: fail — no safe incremental compatibility boundary |
| Runtime/platform compatibility | G: pass | G: pass | G: pass | G: unknown |

V4 is disqualified and does not enter scoring.

## Rubric freeze

Rubric frozen: axes [Style, Theme, Methodology, Modernization, Error wrapping,
Testability, Blast radius] · weights [1,2,2,2,2,2,1] · denominator = 60 ·
denominator-policy [uniform-N/A-only] · baseline-algo [lowest-effort gate-passer
with no score of 1 on any quality axis]

`freeze: axes=Style,Theme,Methodology,Modernization,Error wrapping,Testability,Blast radius weights=1,2,2,2,2,2,1 denom=ΣW×5 baseline=lowest-effort-gate-passer`

## Scoring

| Axis | W | V1 context ledger | V2 event reducer | V3 domain adapters |
|---|---:|---:|---:|---:|
| Style | 1 | 4 — extends existing context conventions | 4 — pure reducer fits runtime style | 5 — smallest familiar modules |
| Theme / paradigm | 2 | 5 — causal receipts precede policy | 5 — explicit obligation ownership | 3 — domains can drift before convergence |
| Methodology | 2 | 5 — staged, reversible, broad-outcome driven | 3 — several directors move before live value | 5 — highly incremental |
| Modernization | 2 | 5 — existing async context plus immutable receipts | 5 — versioned event transitions | 3 — improves structure without solving carrier |
| Error wrapping | 2 | 5 — child stages cannot be overwritten | 5 — uniform settlement, but input remains weak initially | 3 — local schemas may remain inconsistent |
| Testability | 2 | 5 — pure receipt composition and scoped integration | 4 — reducers are pure but migrations are broad | 4 — small domain checks |
| Blast radius | 1 | 4 — compatibility adapter bounds rollout | 2 — cross-director and persistence first | 5 — smallest initial surface |
| Effort | — | high program; medium first outcome | high | medium |
| Denominator | — | 60 | 60 | 60 |
| Weighted total | — | 58 | 50 | 46 |
| Normalized score | — | **0.967** | 0.833 | 0.767 |

Arithmetic verification:

- V1: `4×1 + 5×2 + 5×2 + 5×2 + 5×2 + 5×2 + 4×1 = 58`; `58/60 = 0.967`.
- V2: `4×1 + 5×2 + 3×2 + 5×2 + 5×2 + 4×2 + 2×1 = 50`; `50/60 = 0.833`.
- V3: `5×1 + 3×2 + 5×2 + 3×2 + 3×2 + 4×2 + 5×1 = 46`; `46/60 = 0.767`.
- A Python arithmetic check confirmed the shared seven-axis set and denominator
  `sum([1,2,2,2,2,2,1]) × 5 = 60`.

The V1 scores describe the corrected contract below. Omitting sealing, deep
immutable publication, bounded overflow behavior, or writer convergence would
invalidate the corresponding gate rather than silently lower a score.

## Baseline guard and pick

V3 is the algorithmic baseline: it has the lowest estimated effort among gate
passers and no quality-axis score of 1. V1 beats it by 0.200 because fixing the
shared causal carrier before moving domains prevents the extracted modules from
replicating the same receipt-loss and retry-identity defects.

V1 also beats V2 because obligation decisions cannot become reliably causal
while their input is still a mutable terminal slot that parent and child skills
overwrite. Receipt scope is the prerequisite for safe obligation unification.

## Winning architecture

```text
natural/direct request
        |
        v
existing Agenda / Goal / Job domain owner
        |
        v
ActionManager authority + ActionExecutionContext
        |  actionId / AbortSignal / deadline
        |  bounded child receipt ledger
        v
existing deterministic skill adapter
        |
        v
Mineflayer / installed plugin mechanics
        |
        v
Minecraft reconciliation receipt
        |
        v
composed immutable ActionResult
        |
        v
shared obligation settlement decision
        |
        +--> complete / waiting / censored / retry-after-material-change / terminal
```

The action receipt describes what happened. The obligation reducer decides what
that means for durable work. A skill never decides its own strategic retry, and
a director never reconstructs a mechanic stage from prose.

## Migration outcomes

These are coherent system outcomes, not artificial turn-sized slices. Several
modules may move together when causally required. Each outcome stops once its
acceptance condition is met.

### Outcome 1 — Action-scoped compositional receipts

**System outcome:** a parent action cannot lose or confuse child navigation,
interaction, collection, combat, cleanup, or reconciliation evidence because a
later child wrote another result.

**Owning surfaces:**

- `src/agent/action_manager.js`
- `src/agent/runtime/action-result.js`
- a small zero-dependency receipt normalizer/composer under
  `src/agent/runtime/`
- the `setActionEvidence` compatibility boundary in
  `src/agent/library/skills.js`
- only the parent skills needed by the activating live scenario

**Mechanism:**

1. Construct one ledger handle before `ACTION_EXECUTION_CONTEXT.run(...)` and
   retain that handle in ActionManager across both the success and exception
   paths. Its internal lifecycle is exactly `open -> sealed`; it is never
   reopened or reused for another action ID. The action invocation explicitly
   declares `receiptMode: 'legacy' | 'composed'`, defaulting to `legacy`; only a
   deliberately migrated activating path may select `composed`.
2. Seal the ledger immediately when the action function resolves, throws,
   times out, is cancelled, or loses ownership, before ActionManager releases
   the owner, clears its current action ID, composes ActionResult, emits
   telemetry, or permits another action to acquire the body.
3. Every recorder operation requires the same action ID and an `open` ledger.
   A post-seal or wrong-generation write returns a bounded
   `stale_action_receipt_rejected` result, changes neither the sealed ledger nor
   `bot.lastActionEvidence`, and cannot contaminate a replacement action.
4. Expose two explicit context operations:
   `recordActionChild(relationship, evidence)` and
   `recordActionTerminal(evidence)`. Neither operation guesses its role.
   `setActionEvidence` remains a legacy compatibility writer and is never
   implicitly promoted into a child or terminal ledger record. Every producer
   on a migrated path must call the appropriate explicit operation.
5. The ledger contains exactly one terminal receipt slot and logically
   append-only child sequences under this initial relationship allowlist:
   `selection`, `feasibility`, `planning`, `navigation`, `interaction`,
   `collection`, `combat`, `cleanup`, and `reconciliation`. Adding a
   relationship is a schema change; relationships are never inferred from logs,
   narration, or outcome regexes.
6. Publish `ActionResult.evidence.skill` as the terminal receipt at its existing
   top-level shape so current consumers of fields such as `kind`, `outcome`,
   `target`, and `retryable` remain compatible. Reserve and add
   `receiptSchemaVersion: 1`, the correlated `actionId`, a `children` object
   whose allowlisted keys contain ordered receipt arrays, and an `overflow`
   summary or `null`. A normalized legacy fallback uses the same envelope with
   `source: 'legacy_fallback'` and empty children; it cannot masquerade as a
   fully migrated receipt.
7. Child receipts receive monotonically increasing sequence numbers within the
   action. They describe attempted stages and never decide the parent phase.
   Only the parent's explicit terminal reconciliation can declare a migrated
   action succeeded, failed, requested, blocked, interrupted, or cancelled. A
   handled child failure may coexist with terminal success; migrated success
   without a terminal reconciliation remains unknown. A duplicate terminal or
   child write after the terminal is a bounded
   `action_receipt_contract_violation`; it does not replace the first terminal
   and prevents success or retry authority. Unmigrated actions retain the
   current compatibility behavior until their path is migrated.
8. Freeze these initial receipt-envelope constants in the zero-dependency
   normalizer: at most 9 relationships, 16 receipts per relationship, 48 child
   receipts total, depth 8, 96 keys per object, 96 items per nested array, 1,200
   characters per string, and 128 KiB for the composed skill receipt. These
   preserve the existing ten-segment journey and bounded mining routes while
   remaining below the flight recorder's 256 KiB record limit. Lowering a bound
   requires evidence that accepted receipts still fit.
9. On per-relationship overflow, retain the first eight and latest eight
   receipts by sequence. If the union still exceeds the global limit, retain
   the first 24 and latest 24 child receipts by sequence. Record total, retained,
   dropped, and first/last dropped sequence numbers globally and per
   relationship in an immutable `receipt_evidence_truncated` summary. If the
   composed receipt still exceeds 128 KiB, replace the largest nonterminal child
   payloads first—ordered by serialized size descending and then sequence
   descending—with bounded summaries that retain relationship, sequence, kind,
   outcome/code, target identity/coordinates, and original byte count. Never
   discard or silently truncate the terminal core, overflow counts, or a stage
   needed to justify success. If the normalized terminal alone exceeds its
   remaining envelope, publish a bounded `terminal_receipt_oversized` contract
   violation with its core kind, outcome/code, target, and byte count; it cannot
   authorize success or retry.
10. Normalize supported primitives, plain objects, and arrays once; bound and
   sanitize text; reject or replace functions, symbols, exotic prototypes,
   circular references, and non-finite numbers conservatively. Deep-freeze the
   recorded snapshot. Internally mutable counters may exist only while the
   ledger is open and may never escape.
11. `createActionResult` must publish a separately normalized, recursively frozen
   evidence tree. `structuredClone` followed only by an outer `Object.freeze`
   is insufficient because it makes previously frozen nested receipts mutable.
12. Route every evidence producer on the activating path through the explicit
    recorder API,
    including any direct `lastActionEvidence` writer in commands or vision.
    Each explicit operation creates one normalized snapshot, records it in the
    open context, and mirrors that exact same snapshot to
    `bot.lastActionEvidence` only when compatibility consumers on that activating
    path still require the mirror. It never independently merges two versions.
    The legacy setter continues to write only the legacy slot until its caller
    is deliberately migrated.
13. ActionManager prefers the sealed context snapshot. It may fall back to the
    global slot only when `receiptMode === 'legacy'`. A composed action with no
    terminal receipt is `action_terminal_receipt_missing`, even if the global
    slot contains a value. Context and mirror disagreement is a bounded
    `action_evidence_mirror_mismatch` diagnostic; the values are never merged and
    disagreement cannot authorize success or retry.
14. Migrate the activating parent path so it no longer snapshots the global slot
    before and after child calls. Remove only the preservation exceptions made
    unreachable by that migration. Keep telemetry bounded and versioned; expose
    contract stages, truncation, and selected child summaries rather than raw
    arbitrary nested implementation data.

**Focused evidence:** reproduce one observed overwrite path; prove a second
child cannot erase the first; prove child failure followed by reconciled parent
success retains both facts; prove migrated success without terminal evidence is
unknown; prove field-absent stays unknown; prove exact bounds and visible
overflow; prove published nested evidence is frozen; prove a floating async
write after resolve/throw/timeout/cancel is rejected; prove a direct legacy
writer cannot bypass or diverge from the activating context; and prove an old
action generation cannot publish into a replacement action.

**Physical acceptance:** rerun the active broad player scenario that activated
the migration. The result must physically complete or fail at the first true
boundary, preserve the relevant child receipts in flight telemetry, honor Stop
and safety preemption, and pass the Director's player-sense verdict.

**Material stop condition:** one representative nested action and its sibling
error/cancellation path use the context ledger without global-slot
before/after capture. Do not sweep all 475 setters in this outcome.

### Outcome 2 — Shared obligation settlement and material-change retry

**System outcome:** Agenda, Goal, Job, and Survival owners classify the same
action receipt consistently without surrendering their domain policy or stores.

**Owning surfaces:** existing action-result classification, a pure
zero-dependency obligation-settlement module, and only the directors implicated
by the activating repeated failure class.

**Shared input:**

- obligation ID and domain owner
- authority/dispatch generation
- current domain stage and attempt checkpoint
- correlated ActionResult and composed skill receipts
- verified progress signature
- concrete failed target or missing prerequisite
- bounded world checkpoint relevant to material change
- explicit `sampleClass`: `success`, `method_failure`, `censored`, or `unknown`
- explicit `methodRetryable`, `retryAuthority`, `materialChanged`, and
  `budgetAvailable` facts; absent values are unknown, never truthy defaults

**Shared output:**

- `complete`
- `waiting`
- `censored` for Stop, preemption, death, or owner replacement
- `waiting_for_material_change`
- `retry_authorized`
- `supported_alternative`
- `terminal_failure`

The reducer classifies settlement; each existing director still chooses its
domain's next legal operation and persists its domain-specific state.

`methodRetryable` means the attempted mechanic could reasonably work under
different material conditions. It is not strategic permission. Redispatch is
authorized only by this complete conjunction:

```text
sampleClass === 'method_failure'
&& methodRetryable === true
&& retryAuthority === true
&& materialChanged === true
&& budgetAvailable === true
```

Missing fields fail closed. Censored samples preserve the obligation, do not
charge the mechanic attempt budget, and do not grant immediate redispatch by
themselves. `waiting_for_material_change` records that the obligation remains
live but currently lacks retry authority. Generic `waiting` is reserved for an
external prerequisite or player-owned fact when no failed-method signature is
being held.

**Material-change ledger:** store a bounded immutable failure signature,
rejected target, checkpoint, release predicates, and retry authority. Time alone
is never material change. Domain callbacks may prove changes such as a different
bed, position region, dimension, inventory prerequisite, target generation, or
world state. Unknown evidence—including missing current position, dimension,
target identity, or world sample—retains the blocker. A changed timestamp or
cooldown never satisfies a release predicate.

**Compatibility:** introduce versioned optional settlement fields and stable
receipt/action correlation IDs. Persist summaries or stable receipt references,
not unbounded duplicate receipt trees. Old and mixed-version stores load
conservatively; absence cannot authorize retry. Writers commit the domain state,
settlement schema version, and correlation identity through that store's
existing atomic persistence boundary. Do not rewrite every persisted store in
one transition.

**Acceptance:** an activating broad request is interrupted by a real higher
priority action, resumes the same whole obligation, avoids charging censored
work as mechanic failure, and either changes target/strategy after proved
material change or settles truthfully without an unchanged retry. The focused
truth table must cover every true, false, and field-absent branch, including a
missing physical position retaining an existing blocker.

**Material stop condition:** the repeated failure class uses one shared
classification path in at least two existing owners. Do not merge the directors
or normalize unrelated cooldowns.

### Outcome 3 — Durable participant identity

**Activation gate:** another broad request crosses persistence/restart with a
named player, Floodgate alias, delivery recipient, protected player, or return
destination and raw-string rebinding is ambiguous or false.

**System outcome:** bind one versioned participant reference at authoritative
player ingress and preserve the requested and canonical identity through
durable work.

The `participantSchemaVersion: 1` reference should contain only bounded facts
needed across boundaries: requested identity, canonical username, match source,
binding authority, entity/session generation when live, and the authoritative
observation time. Persistence never treats an entity ID as permanent.

Identity validity and current presence are separate state axes:

- `bound_present`: reacquire the current live entity for the same canonical
  participant and execute.
- `bound_absent`: preserve the same obligation and wait or report absence; do
  not discard or rebind the participant.
- `unbound`: ask one bounded player question or fail truthfully before durable
  work is installed.
- `ambiguous`: ask or fail; never choose a candidate by proximity or casing.
- `invalid_self_or_bot`: terminally reject the destination.

A transition from absent to present requires an authoritative roster/entity
observation matching the durable canonical identity. Current absence is not
evidence that the durable binding was invalid.

Reuse `player-target.js`; do not create a second resolver. Agenda, Goal, Job,
companion directives, protection, and delivery migrate only as their activating
scenario reaches them.

### Outcome 4 — One prerequisite planning owner

**Activation gate:** a broad progression, role, food/farm, travel, family, or
resource request reaches `prepareTool` or `prepareMaterial` and the opaque
recursive helper prevents causal reassessment or restart-safe progress.

**System outcome:** the owning director persists and executes the central
prerequisite planner's next capability. The physical skill performs one bounded
operation and returns its receipt. Compatibility commands may adapt into the
existing typed goal path; they may not run a second recursive plan inside an
ActionManager action.

Migrate one activating caller end to end, physically accept its broad outcome,
then retire only the recursive branch proven unreachable. Do not perform a
whole-repository caller sweep.

### Outcome 5 — Cohesive physical-domain extraction

**Activation gate:** a live blocker requires material changes in one cohesive
skills domain, or two confirmed defects require the same shared helper or
invariant.

**System outcome:** move that domain's target binding, package adapter,
cancellation cleanup, and receipt formatting behind one stable module boundary.
Keep commands and ActionManager ownership unchanged. Strategic planning remains
in directors, and Mineflayer/plugin mechanics remain package-owned.

Candidate domains are navigation, workstation/container interaction,
collection/mining, and survival access. Extraction order follows live need, not
file position or line-count reduction.

## Explicit non-goals

- No second movement, combat, collection, tool, survival, or inventory engine.
- No merger of AgendaDirector, GoalDirector, JobDirector, or SurvivalDirector
  into a god object.
- No event-sourcing framework or new external database.
- No wholesale replacement of `skills.js`.
- No all-call-site receipt migration before a broad outcome requires it.
- No scenario matrix, soak suite, or certification campaign.
- No dependency addition or upgrade.
- No parsing model narration or arbitrary logs into contract evidence.
- No weakening of accepted route, stance, safety, custody, identity,
  returnability, or verification gates.

## Implementation checkpoint requirements

Before starting any migration outcome:

1. Record current source revision, dirty-file inventory, current runtime/Paper
   state, persisted Hold, relevant telemetry, and physically unaccepted slices.
2. Name the exact player-visible or independently concrete engineering outcome,
   the observed repeated failure class, owning surfaces, acceptance evidence,
   and material stop condition.
3. Confirm the active source still matches this plan. If the required mechanism
   has shifted, run constrained Codeplan between the original and adapted
   mechanism rather than silently changing the design.
4. Measure the largest accepted activating receipts and confirm they fit the
   frozen envelope. A required bound change is an explicit contract adjustment,
   not silent truncation.
5. Enumerate every evidence writer on the activating call path, including direct
   global-slot assignments, and record which are migrated or remain behind the
   fallback boundary.
6. Preserve accepted mechanics not directly changed.
7. After focused diagnostics, rerun the same broad Paper outcome and stop when
   it works truthfully and passes player sense.

## Review packet for each completed outcome

Keep the review concise:

- player-visible outcome improved
- new repeated failure class that justified shared repair
- why the correction is shared rather than item-specific
- behavior now frozen
- next broad campaign
- package-delegated mechanics and evidence for any custom exception

## Current recommendation

Outcome 1 is activated now. Repeated receipt loss is already evidenced, and the
already-changed segmented player-pursuit path is the smallest coherent migration
and physical-acceptance route. Begin there after the implementation checkpoint;
do not wait for another instance of the known failure class. Do not begin by
merging directors or moving large regions of `skills.js`.

[codeplan · shared receipt and obligation spine · OUT · mode: full · pick: V1 · confidence: high · beatBaseline: yes · scores: V1 0.967, V2 0.833, V3 0.767 · reason: action-scoped causal receipts are the prerequisite for safe obligation and domain migration · mechanism-check: passed with sealed lifecycle, immutable bounded publication, writer convergence, explicit retry authority, durable presence states, and active migration entry · corrected: completion-audit gaps incorporated]

## 2026-08-16 activating implementation checkpoint

Outcome 1 is implemented on the activated Agenda and continuous-follow paths.
Composed actions publish bounded child receipts and one terminal receipt; shared
obligation settlement preserves censored work, permits retry only through
explicit authority plus material change, and treats missing evidence as unknown.
The same material-change contract now backs Survival sleep blocking.

The live follow replay found and closed one global lifecycle seam: cooperative
Stop used to seal the action ledger before the interrupted skill could write its
terminal receipt. `ActionManager.stop()` now aborts and interrupts while leaving
the ledger writable; normal action settlement seals after the skill returns,
while the exhausted Stop budget still force-seals an unresponsive action. This
is frozen by a direct regression and by the passing natural-language doorway and
corridor replay.

The staged V1 migration also activated shared component transactions for whole
tree collection, spatial world-modification authority for tree/shelter mutation,
route-proven segmented recovery for continuous follow, and JobDirector-owned
large-lumberjack prerequisites. It did not add a second physical mechanics
engine or merge directors.

Physical evidence now satisfies both broad material stops: the natural player
chat `Kevin, get four logs.` produced exactly four new oak logs from one complete
tree and the durable goal settled `inventory_goal_verified`; the obstruction
follow course and Stop acceptance also passed after a Kevin-only source reload.
All fixtures, added inventory, effects, position, gamerule changes, and clients
were restored, Kevin safely unloaded under persistent Hold, and managed Paper
remained running with zero players online.

### Activated collection receipt correction — 2026-08-16

The accepted four-log run produced a whole-tree component transaction but its
action envelope still declared `legacy_receipt_unmigrated`. A bounded
command-boundary adapter now promotes only a supported final `collect` or
`mining_search` observation into the composed ledger for
`!collectBlocksInRange`, `!collectWood`, and `!collectWoodInRange`. It requires
boolean/result agreement and positive custody count for claimed collection
success. Unknown, stale, or contradictory evidence becomes the explicit
non-retryable `collection_terminal_invalid` outcome; it is never promoted as
success. Nested resource acquisition remains owned by its outer skill and does
not take the terminal slot.

Source verification passes the focused receipt and command contracts (27/27),
adjacent collection/navigation/action checks (94/94), and critical checks
(22/22). The behavior baseline remains 191/193 with the same two pre-existing
JobDirector fixture failures. No human was online after the correction, so
Kevin remained stopped and the same natural four-log replay is pending; the
earlier physical pass is not presented as acceptance of this changed source.
