[codeplan · picnic-seat-fixture · IN · mode: full · confidence: high · candidates: V1 extend the verified fixture path (class-method internal-reuse), V2 add a seat-specific macro and material derivation (template-macro internal-reuse), V3 admit raw bracketed block states (inline-block local-only), V4 compose acquire and coordinate placement steps (agenda-compose local-only) · lean: V1 · baseline: V1]

# Picnic seat fixture decision

## Trigger and calibration

Triviality gate: `trivial: no · continue`. The live Dad-and-Kid request reached
the construction compiler, but its two model attempts used unsupported stair
state syntax and exhausted without a durable assignment. Oriented stair seats
cross the design DSL, blueprint fixture schema, Builder dispatch, placement
stance, and world-state verification.

Calibration was read directly because this runtime does not provide Codeplan's
named `delegate_task` tool. Repository hard rules require package-owned
mechanics, shared interaction-stance receipts, one ActionManager owner, no new
dependency, exact physical verification, and one live-path repair. Existing
door/bed fixtures already persist facing through structure design, Builder,
`!placeFixtureAt`, and `skills.placeFixture`; focused tests use `node:test` and
strict assertions around pure design expansion and command dispatch.

Quality axes: repository style, architecture/theme integrity, live-repair
methodology, runtime-compatible modernization, truthful error receipts,
focused testability, and blast radius/reversibility.

## Variants and hard gates

- **V1 — class-method internal-reuse:** extend `put` to accept exact stair
  materials plus cardinal facing, represent a stair as a one-cell logical
  fixture, and extend the existing orientation-aware fixture placement and
  verification path. `G: pass`.
- **V2 — template-macro internal-reuse:** add an `@seats` macro, typed template
  arguments, and wood-family-to-stair material derivation before emitting the
  same fixture records. `G: pass`; it solves the case but expands template and
  material semantics for one observed form.
- **V3 — inline-block local-only:** allow arbitrary bracketed block-state text
  in `block` and pass it through ordinary placement. `G: fail` — bypasses the
  canonical-material grammar, logical-fixture receipt, facing verification,
  and interaction-stance ownership.
- **V4 — agenda-compose local-only:** compile acquire-stairs plus two direct
  placement actions. `G: fail` — Agenda has no authorized coordinates or site
  judgment and this would create a parallel construction/placement path.

Divergence: V1 changes the existing fixture class path; V2 changes macro and
material-derivation structure; V3 changes raw value representation and error
surface; V4 relocates state and control into Agenda composition. They are not
restatements.

## Frozen rubric

Rubric frozen: axes [Style, Theme, Methodology, Modernization, Error wrapping,
Testability, Blast radius] · weights [1,2,2,2,2,2,1] · denominator = 60 ·
denominator-policy [uniform-N/A-only] · baseline-algo
[lowest-effort gate-passer with no score of 1 on any quality axis]

`freeze: axes=Style,Theme,Methodology,Modernization,Error wrapping,Testability,Blast radius weights=1,2,2,2,2,2,1 denom=ΣW×5 baseline=lowest-effort-gate-passer`

## Scoring

| Axis | W | V1 fixture extension | V2 seat macro |
|---|---:|---:|---:|
| Style | 1 | 5 | 4 |
| Theme | 2 | 5 | 4 |
| Methodology | 2 | 5 | 3 |
| Modernization | 2 | 4 | 4 |
| Error wrapping | 2 | 5 | 4 |
| Testability | 2 | 5 | 4 |
| Blast radius | 1 | 4 | 2 |
| Effort | — | medium | high |
| Weighted total | — | 57/60 = **0.950** | 44/60 = **0.733** |

Arithmetic verification: V1 terms `5+10+10+8+10+10+4=57`; V2 terms
`4+8+6+8+8+8+2=44`; identical denominator `(1+2+2+2+2+2+1)×5=60`.

Baseline V1 is the lowest-effort gate-passer and has no quality-axis score of
one. It also wins outright. Implementation must remain inside the existing
logical-fixture/interaction-stance path: no raw state passthrough, seat-only
Agenda path, or new movement mechanic.

[codeplan · picnic-seat-fixture · OUT · mode: full · pick: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1 0.950, V2 0.733, V3 fail, V4 fail · reason: exact stair facing becomes a small additive fixture contract while existing Builder and Mineflayer mechanics retain ownership · mechanism-check: passed · corrected: none]
