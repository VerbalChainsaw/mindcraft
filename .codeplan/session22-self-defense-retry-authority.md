[codeplan · session22-self-defense-retry-authority · IN · mode: full · confidence: high · candidates: V1 ActionManager evidence index+instance-state, V2 self-defense failed-retreat latch+mode-state, V3 arbiter perception latch+instance-state · lean: V2 · baseline: V2]

# Session 22 self-defense retry authority

## Triviality gate

`trivial: no · continue`

The observed correction can remain small, but it crosses safety-reflex retry
authority, ActionManager ownership, and truthful Pathfinder failure evidence.
More than one owner could plausibly hold the retry latch, and choosing the
wrong one can suppress life-saving work or keep generating failed actions.

## Center Audit repair contract

Target is `2b7fc3d1ee9b733d17142e296823e3d3d51a1cf5` plus the dirty shared
workspace and managed Paper 1.21.11 runtime. The audit independently
reproduced the invariant from live telemetry and current source:

- thirty-five `mode:self_defense` actions returned `skill_unreachable` over
  93,278 ms against the same Pillager while the bot occupied essentially one
  block at three health;
- Paper then recorded death by that Pillager, followed by two more deaths
  during recovery;
- `execute()` applies only a 1,500 ms failure delay, `ModeController` admits
  the mode again after that timestamp, and `ActionManager` explicitly exempts
  critical reflex actions from its repeated-pattern guard;
- no owner retains a bounded receipt for the failed retreat geometry.

Center Audit result: `DEFECT_CONFIRMED`, likelihood `CERTAIN`, impact `HIGH`,
confidence `HIGH`, reproducibility `DETERMINISTIC`. Required invariant: an
uncensored tactical-retreat failure may not dispatch again against unchanged
target generation, bot stance, target stance, health, and dimension evidence.
Cancellation remains censored. A material evidence change must reopen the
reflex. Do not alter Pathfinder, combat execution, tactical selection, Goal,
Agenda, or death recovery.

Repair revalidation: `INVARIANT_HOLDS`. The runtime sequence and the exact
`modes.js` / `action_manager.js` control edges still match the audit.

## Calibration

Repository guidance requires the smallest shared evidence-backed repair,
structured truthful failure, package-owned movement/combat, and no identical
retry without changed evidence. Current code uses ESM, camelCase helpers,
snake_case result codes, bounded immutable receipts, explicit early returns,
and focused `node:test` checks. `modes.js` already owns a nearby precedent:
`explosiveReflexEligibility` suppresses a stale warning-range trigger using an
in-memory receipt while leaving tactical mechanics unchanged.

Quality axes are therefore: source style, owner-boundary fit, recovery-contract
integrity, safety/cancellation compatibility, telemetry truth, testability,
and blast radius/reversibility.

## Variants and divergence

### V1 — ActionManager evidence index (`instance-state`, `internal-reuse`)

Teach ActionManager a critical-reflex failure index keyed from action result,
position, health, and target, then expose a pre-dispatch eligibility query to
ModeController.

- Divergence: central action-owner state and a cross-module query.
- Advantage: one generic loop boundary.
- Risk: ActionManager must interpret domain-specific material change and could
  suppress drowning, burning, or other critical reflexes incorrectly.
- Gates: `G: pass` only if restricted to self-defense; no dependency or schema
  change, but ownership fit is weak.

### V2 — self-defense failed-retreat latch (`mode-state`, `return-code`)

Add one bounded immutable failed-retreat receipt to the existing self-defense
mode. Key it by exact hostile identity/generation, floored bot and hostile
stances, normalized health, and dimension. Store it only after an uncensored
tactical retreat returns a no-progress/path failure. Before dispatch, return a
non-action suppression code when the receipt still matches; clear or replace it
when material evidence changes or the response succeeds.

- Divergence: domain-owned in-memory state and pre-dispatch return code.
- Advantage: mirrors the existing explosive-trigger precedent and has the
  evidence necessary to distinguish a real new safety situation.
- Risk: the latch is intentionally restart-local; restart permits one fresh
  physical assessment, which is acceptable because world/entity state is new.
- Gates: `G: pass`; no schema, dependency, package, or command changes.

### V3 — arbiter perception latch (`arbiter-state`, `degrade-graceful`)

Have BehaviorArbiter compare its latest `mode:self_defense` ActionResult with a
perception fingerprint and suppress the protection lane until that fingerprint
changes.

- Divergence: scheduler-owned state, downstream result inspection, and lane
  degradation.
- Advantage: keeps ModeController simple and can surface lane diagnostics.
- Risk: BehaviorArbiter would learn tactical result semantics and entity
  geometry, expanding a general arbitration boundary and complicating active
  action/cancellation ordering.
- Gates: `G: pass`; functional but materially larger and easier to regress.

Pairwise divergence is structural: V1 stores state in ActionManager and adds a
cross-owner query; V2 stores it in the domain mode and returns a suppression
code before action ownership; V3 stores it in the arbiter and suppresses an
entire lane from downstream result/perception state.

## Frozen rubric

Rubric frozen: axes [Style, Owner boundary, Recovery contract, Safety/cancellation, Telemetry truth, Testability, Blast radius] · weights [1,3,3,3,2,2,2] · denominator = 80 · denominator-policy [uniform-N/A-only] · baseline-algo [lowest-effort gate-passer with no score of 1 on any quality axis]

`freeze: axes=Style,Owner boundary,Recovery contract,Safety/cancellation,Telemetry truth,Testability,Blast radius weights=1,3,3,3,2,2,2 denom=ΣW×5 baseline=lowest-effort-gate-passer`

## Scoring

| Axis | W | V1 ActionManager index | V2 mode latch | V3 arbiter latch |
|---|---:|---:|---:|---:|
| Style | 1 | 4 | 5 | 4 |
| Owner boundary | 3 | 3 | 5 | 3 |
| Recovery contract | 3 | 4 | 5 | 4 |
| Safety/cancellation | 3 | 3 | 5 | 3 |
| Telemetry truth | 2 | 4 | 4 | 4 |
| Testability | 2 | 4 | 4 | 4 |
| Blast radius | 2 | 2 | 5 | 2 |
| Effort | — | medium | low | medium |
| Weighted total | — | 54 | 76 | 54 |
| Normalized | — | 0.675 | 0.950 | 0.675 |

Arithmetic:

- V1: `4 + 9 + 12 + 9 + 8 + 8 + 4 = 54`; `54 / 80 = 0.675`.
- V2: `5 + 15 + 15 + 15 + 8 + 8 + 10 = 76`; `76 / 80 = 0.950`.
- V3: `4 + 9 + 12 + 9 + 8 + 8 + 4 = 54`; `54 / 80 = 0.675`.
- Every variant uses the same seven axes and denominator.

## Selection and implementation contract

V2 wins and is also the algorithmic baseline: it is the lowest-effort
gate-passer, has no quality-axis score of one, and owns the exact evidence
needed for safe retry. Implement only the mode-local latch and one focused
eligibility/result-classification regression. Preserve ActionManager's
critical-reflex exemption, because the generic pattern guard intentionally
cannot decide whether changed combat evidence authorizes another life-saving
attempt. Preserve all existing tactical and Pathfinder mechanics.

[codeplan · session22-self-defense-retry-authority · OUT · mode: full · pick: V2 · confidence: high · beatBaseline: baseline-wins · scores: V1 0.675, V2 0.950, V3 0.675 · reason: the self-defense owner has the smallest sufficient material-evidence fingerprint and an existing stale-trigger precedent · mechanism-check: passed · corrected: none]
