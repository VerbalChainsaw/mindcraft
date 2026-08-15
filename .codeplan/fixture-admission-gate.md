[codeplan · fixture-admission-gate · IN · mode: full · confidence: high · candidates: V1 verifier-inline/local-array, V2 pure-module/immutable-receipt, V3 control-endpoint/server-query, V4 declarative-engine/fixture-registry · lean: V2 · baseline: V1]

## Decision boundary

Repeated live campaigns were censored by unloaded blocks, invalid body cells,
hostile or custody drift, stale bot position, and harness timing. The immediate
engineering outcome is a reusable fail-closed fixture receipt called immediately
before request dispatch. It must distinguish confirmed, failed, and unknown
required facts without adding a scenario framework or changing product mechanics.

Triviality gate: `trivial: no · continue`. The boundary may live inside one
verifier, in a pure shared module, behind the control API, or in a declarative
engine; that choice materially changes ownership and future harness coupling.

## Calibration

- Style: ESM, dependency-light modules, early normalization, bounded arrays and
  strings, explicit failures, immutable structured evidence, `node:test` with
  strict assertions.
- Ownership: a harness owns setup truth; project contracts own identity, stance,
  safety and returnability; Pathfinder owns route proof; Mineflayer/Paper owns
  physical truth. The gate aggregates receipts and must not invent those facts.
- Methodology: repair the first unproven admission boundary and integrate it into
  one representative verifier; do not build a fixture framework or broad suite.
- Error behavior: missing evidence is `unknown`; any required failed or unknown
  fact prevents dispatch with exact check identifiers.
- Operational fit: reuse the verifier's state protocol, managed Paper evidence,
  bounded polling, and pre-dispatch seam without adding a product API.

## Variants and gates

### V1 — inline verifier gate (`verifier-inline`, `local-array`)

Add normalized checks and admission logic directly to
`verify-behavior-runtime.mjs`.

G: pass — smallest immediate diff and easy to diagnose, but reuse requires
importing an increasingly mixed executable module and encourages later harnesses
to duplicate normalization.

### V2 — pure shared receipt (`pure-module`, `immutable-receipt`)

Add one zero-dependency validation module that normalizes bounded checks and
request metadata into an immutable receipt, plus an assertion that rejects any
non-admitted receipt. The representative verifier supplies authoritative checks
immediately before dispatch.

G: pass — keeps fact acquisition with existing owners, makes unknown fail closed,
is reusable without product coupling, and remains a modest gate rather than a
fixture engine.

### V3 — control-plane endpoint (`control-endpoint`, `server-query`)

Expose `/api/fixture-admission` and have the server query runtime and Paper state.

G: fail — creates a new product/API ownership boundary, cannot independently
prove harness-specific geometry or Pathfinder routes, and materially expands the
server blast radius for a validation concern.

### V4 — declarative fixture engine (`declarative-engine`, `fixture-registry`)

Define scenario schemas, reusable predicates, setup execution, admission, and
reporting in a new orchestrator.

G: fail — violates the explicit prohibition on fixture frameworks and scenario
matrices and would duplicate existing harness/runtime responsibilities.

## Divergence proof

V1 stores checks in an executable verifier; V2 uses a pure module and immutable
receipt; V3 moves acquisition and admission behind a server API; V4 introduces a
declarative registry and orchestration lifecycle. They differ in module boundary,
state location, API surface, control flow, and error path.

## Frozen rubric

Rubric frozen: axes [Style, Ownership integrity, Fail-closed correctness, Reuse,
Testability, Blast radius, Operational fit] · weights [1,2,2,2,2,1,2] ·
denominator = Σ(weights) × 5 = 60 · denominator-policy [uniform-N/A-only] ·
baseline-algo [lowest-effort gate-passer with no score of 1 on any quality axis]

freeze: axes=Style,Ownership integrity,Fail-closed correctness,Reuse,Testability,Blast radius,Operational fit weights=1,2,2,2,2,1,2 denom=ΣW×5 baseline=lowest-effort-gate-passer

## Scoring (only gate-passers; 1–5)

| Axis | W | V1 verifier-inline | V2 pure-module |
|---|---:|---:|---:|
| Style | 1 | 4 | 5 |
| Ownership integrity | 2 | 3 | 5 |
| Fail-closed correctness | 2 | 4 | 5 |
| Reuse | 2 | 2 | 5 |
| Testability | 2 | 4 | 5 |
| Blast radius | 1 | 5 | 4 |
| Operational fit | 2 | 4 | 5 |
| Effort | — | low | medium |
| Weighted total | — | 43 | 59 |
| Normalized | — | 0.717 | 0.983 |

Arithmetic: V1 = `4×1 + 3×2 + 4×2 + 2×2 + 4×2 + 5×1 + 4×2 = 43`;
V2 = `5×1 + 5×2 + 5×2 + 5×2 + 5×2 + 4×1 + 5×2 = 59`;
denominator `12×5 = 60`.

## Pick

V2 wins. It gives every harness one small, pure, fail-closed evidence carrier
while leaving fact collection and mechanics with their existing owners. The
representative integration remains one call immediately before dispatch, and no
new runtime, endpoint, dependency, fixture registry, or scenario matrix appears.

[codeplan · fixture-admission-gate · OUT · mode: full · pick: V2 · confidence: high · beatBaseline: yes · scores: V1 0.717, V2 0.983, V3 disqualified, V4 disqualified · reason: bounded immutable shared receipt with existing-owner fact acquisition · mechanism-check: passed · corrected: none]
