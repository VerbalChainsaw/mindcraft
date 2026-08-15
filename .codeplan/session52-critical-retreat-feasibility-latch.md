[codeplan · critical-retreat-feasibility-latch · IN · mode: constrained · confidence: high · candidates: V1 route-stage per-instance latch, V2 route-stage airborne-class latch · lean: V2 · baseline: V1]

# Critical retreat feasibility latch

## Scope and evidence

Constrained mode is required by the Director's hard two-hour ceiling. The live
Paper run produced five new `mode:self_defense` actions in 7.8 seconds. Every
action settled `skill_unreachable` for a `critical_health` retreat from a
Phantom while Kevin remained on the same block at three health, then Kevin was
slain by a Phantom. The current latch treats a new damage timestamp, lower
health, or hostile identity replacement as retry authority even though none
proves the failed route boundary became feasible. ActionManager intentionally
exempts critical reflexes from its generic repetition guard.

The Center Audit result is `DEFECT_CONFIRMED` for the stage-aware retry
authority gap. Its independent witness agreed that the current exact-receipt
latch works for unchanged identity, but did not correlate the live target IDs;
therefore the repair must not claim unproved identity stability. The bounded
contract is: a settled critical retreat route failure cannot redispatch from
the same stance merely because damage worsened or an equivalent airborne
hostile instance was selected. Cancellation remains censored.

## Calibration

Repository rules put judgment and retry authority in project code, physical
route execution in Pathfinder, and tactical execution in the installed combat
package. Existing source uses bounded immutable receipts and mode-local state.
The route and rules calibration both favor keeping this in `modes.js`, using
structured ActionResult evidence, preserving ActionManager's emergency
negative space, and adding one focused regression.

## Variants and gates

### V1 — route-stage per-instance latch

Classify the structured `critical_health` retreat failure as
`route_unavailable`; for that exact entity generation, ignore declining health
and new damage timestamps until bot stance, dimension, critical-health band,
or airborne/grounded state changes.

- Fingerprint: `mode-state`, `instance-key`, `failure-stage`.
- `G: pass`: correct for stable entity identity; no dependency, package, or
  schema change.
- Limitation: a replacement or second Phantom bypasses the latch even though
  the failed retreat feasibility boundary is unchanged.

### V2 — route-stage airborne-class latch

Apply the V1 route-stage rule and treat the same named airborne hostile class
as equivalent while the bot stance, dimension, critical-health band, and
airborne state remain unchanged. Keep ordinary melee and non-route tactical
failures on the existing exact-instance evidence rule.

- Fingerprint: `mode-state`, `bounded-class-key`, `failure-stage`.
- `G: pass`: closes both stable-ID and airborne-ID-churn paths without a broad
  critical-reflex ceiling; no dependency, package, or schema change.

Pairwise divergence is in the receipt key's data structure: entity-generation
identity versus a bounded airborne threat equivalence class.

## Frozen rubric

`freeze: axes=Style,Owner boundary,Boundary accuracy,Safety negative-space,Identity-churn robustness,Testability,Blast radius weights=1,3,3,3,2,2,2 denom=80 baseline=lowest-effort-gate-passer`

| Axis | W | V1 instance | V2 airborne class |
|---|---:|---:|---:|
| Style | 1 | 5 | 5 |
| Owner boundary | 3 | 5 | 5 |
| Boundary accuracy | 3 | 4 | 5 |
| Safety negative-space | 3 | 5 | 4 |
| Identity-churn robustness | 2 | 2 | 5 |
| Testability | 2 | 5 | 5 |
| Blast radius | 2 | 5 | 5 |
| Weighted total | — | 71 | 77 |
| Normalized | — | 0.8875 | 0.9625 |

Arithmetic: V1 = `(5+15+12+15+4+10+10)/80 = 0.8875`; V2 =
`(5+15+15+12+10+10+10)/80 = 0.9625`.

## Selection

V2 wins. It remains mode-local and receipt-driven, but covers the live
identity uncertainty without weakening the separate self-preservation lane or
creating a generic circuit breaker. Implement only the receipt classification,
eligibility rule, and focused regression.

[codeplan · critical-retreat-feasibility-latch · OUT · mode: constrained · pick: V2 · confidence: high · beatBaseline: yes · scores: V1 0.8875, V2 0.9625 · reason: bounded airborne equivalence closes both damage-only and target-ID churn retries without suppressing unrelated emergencies · mechanism-check: passed · corrected: none]
