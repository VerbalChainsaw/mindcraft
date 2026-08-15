[codeplan · m3-shared-fallback-retry-authority · IN · mode: full · confidence: high · candidates: V1 fail-closed consumer+return-code, V2 producer default+local-state, V3 shared retry receipt+new-module · lean: V1 · baseline: V1]

# M3 shared fallback: retry authority

## Triviality and center-audit result

`trivial: no · continue`

The edit can be small, but the decision is not trivial because the defect crosses
GoalDirector's exhausted internal budget, Agenda's durable settlement, and a new
executor dispatch. The current dirty workspace at
`2b7fc3d1ee9b733d17142e296823e3d3d51a1cf5` was audited read-only.

`CENTER-AUDIT RESULT: DEFECT_CONFIRMED`

- Claim: a terminal GoalDirector failure that omits `evidence.retryable` is
  converted into Agenda retry authority and can receive a new Goal ID and fresh
  internal budget without evidence of material change.
- Center: the producer-consumer edge from `GoalDirector.fail` to
  `AgendaDirector.settleActive`.
- Falsifier: every terminal producer explicitly establishing retry authority,
  or Agenda refusing to redispatch when the flag is absent.
- Evidence: `GoalDirector.fail` deliberately omits the field when its option is
  null; `settleActive` converts absence with `!== false`; `commitSettlement`
  returns the entry to pending; `dispatch` constructs and submits a new goal.
  The JobDirector sibling path explicitly forbids this exact fresh-budget clone.
- Fusion: likelihood CERTAIN, impact HIGH, confidence HIGH, reproducibility
  DETERMINISTIC. No runtime dependency or model variance is involved.
- Smallest repair contract: Agenda may retry a failed step only when the settled
  result explicitly says `retryable: true`. Preserve waiting/preemption paths,
  explicit checkpointed acquisition retry, executor correlation, dependencies,
  and GoalDirector's internal recovery.
- Non-scope: no new fallback director, no package/mechanic change, no attempt
  budget change, no persistence rewrite, and no reopening M1/M2.

## Calibration

The repository uses ESM, camelCase helpers, snake_case outcome codes, bounded
immutable normalized records, explicit fail-closed codes, injected clocks and
stores, and focused `node:test` checks. Goal/Job/WorkOrder own mechanic recovery;
Agenda owns whole-promise persistence, dependencies, and final reporting. Player
Agenda owns pure clarification detection; Agent owns the conversational pending
state. The governing quality axes are truthfulness, boundedness, deterministic
evidence, owner correctness, progress/custody preservation, testability, and
minimal architecture growth.

## Variants and gates

### V1 — fail-closed Agenda consumer (`consumer-guard`, `return-code`)

Require `settled.retryable === true` in the common Agenda settlement gate and
`last.evidence.retryable === true` at the Goal result adapter. Add focused checks
for omitted authority stopping and explicit checkpointed authority continuing.

- G: pass. Correct, backward-safe for explicit retry receipts, zero dependency,
  no lifecycle or schema change.

### V2 — default Goal producer false (`producer-default`, `local-state`)

Have `GoalDirector.fail` always serialize `retryable: false` unless explicitly
true, leaving Agenda's permissive consumer unchanged.

- G: pass for new Goal failures, but weaker for legacy persisted results and
  other settlement producers that omit the field. It protects one producer
  instead of the ownership boundary.

### V3 — shared retry-authorization receipt (`new-module`, `receipt-state`)

Create a new fallback module that normalizes material-change evidence and issues
retry authorization receipts consumed by Agent, GoalDirector, and Agenda.

- G: pass, but introduces a new cross-runtime contract before live evidence
  requires generic material fingerprints. It is materially larger and risks a
  parallel recovery policy beside existing owners.

Pairwise divergence is structural: V1 changes the consumer boundary, V2 changes
one producer's persisted default, and V3 introduces a new module/schema shared
by several owners.

## Frozen rubric

Rubric frozen: axes [Style,Theme,Methodology,Modernization,Error wrapping,Testability,Blast radius] · weights [1,2,2,2,2,2,1] · denominator = 60 · denominator-policy [uniform-N/A-only] · baseline-algo [lowest-effort gate-passer with no score of 1 on any quality axis]

`freeze: axes=Style,Theme,Methodology,Modernization,Error wrapping,Testability,Blast radius weights=1,2,2,2,2,2,1 denom=ΣW×5 baseline=lowest-effort-gate-passer`

## Scoring

| Axis | W | V1 consumer guard | V2 producer default | V3 shared receipt |
|---|---:|---:|---:|---:|
| Style | 1 | 5 | 5 | 4 |
| Theme | 2 | 5 | 4 | 5 |
| Methodology | 2 | 5 | 4 | 3 |
| Modernization | 2 | 4 | 4 | 5 |
| Error wrapping | 2 | 5 | 3 | 5 |
| Testability | 2 | 5 | 4 | 5 |
| Blast radius | 1 | 5 | 4 | 2 |
| Effort | — | low | low | high |
| Weighted total | — | 58 | 47 | 52 |
| Normalized | — | 0.967 | 0.783 | 0.867 |

Arithmetic: V1 `5+10+10+8+10+10+5=58`; V2
`5+8+8+8+6+8+4=47`; V3 `4+10+6+10+10+10+2=52`; denominator
`(1+2+2+2+2+2+1)*5=60`.

## Selection and implementation contract

V1 is the algorithmic baseline and wins. It repairs the actual authority edge,
retains every explicit retry route, and does not invent a new recovery owner.
Implement only the two fail-closed predicates plus focused regression coverage,
then verify the existing explicit acquisition-checkpoint retry still passes.

[codeplan · m3-shared-fallback-retry-authority · OUT · mode: full · pick: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1 0.967, V2 0.783, V3 0.867 · reason: retry authority belongs at the shared Agenda consumer boundary and must be explicit · mechanism-check: passed · corrected: none]

## Repair revalidation and acceptance

`repair_revalidation: INVARIANT_HOLDS` — the original producer-consumer path
was reproduced before repair. After V1, an independent read-only witness found
both explicit-true gates intact, reproduced that omitted authority leaves only
one Goal submission, and returned `NO_DEFECT_CONFIRMED` on the repaired dirty
snapshot. The explicit checkpointed retry remains green. No mechanism shift or
producer normalization was required.
