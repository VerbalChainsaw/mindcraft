[codeplan · session48-equipment-intent · IN · mode: full · confidence: high · candidates: V1 bounded-clause clause-bounded/internal-reuse, V2 registry-selector registry-scan/extracted-helper, V3 prompt-enforcement prompt-gate/degrade-graceful · lean: V1 · baseline: V1]

## Decision boundary

Observed current-workspace failure: `Put on the iron helmet I set out for you.`
returned no deterministic directive. The model then claimed the helmet was
equipped while the live head slot was empty, the item remained carried, no
action receipt existed, and Operator Hold stayed active. The same route already
handles `Put on the iron helmet.` through `!equip("iron_helmet")`; Mineflayer's
equip execution passed physically in the initial tranche.

Hard requirements: preserve conversation architecture; natural/direct requests
must converge on deterministic skills; connected registry and carried item
identity remain authoritative; do not alter package-owned equip mechanics,
ActionManager, Hold semantics, or equipment verification; no new dependency;
repair the first unproven selection boundary and rerun the unchanged Paper
session. This is Campaign 48 repair class 2/2.

Triviality gate: `trivial: no · continue`. Although the winning edit may be
small, three structurally distinct owners are credible and the prior local
classifier repair did not prevent false success.

## Calibration

- Style: ESM JavaScript, small pure parsing helpers/regexes, structured command
  objects, `node:test` plus strict assertions.
- Theme: project code owns semantic selection and exact item binding; existing
  deterministic capability and Mineflayer own execution.
- Methodology: smallest shared seam, focused check, real Paper replay, stop at
  physical truth; preserve dirty WIP.
- Error behavior: unknown item remains unknown and falls through; never invent a
  registry item or report success without an action receipt.
- Testability/blast radius: prefer the existing pure directive surface and no
  persistence/API/dependency changes.

## Variants and gates

### V1 — bounded equipment clause (`clause-bounded`, `internal-reuse`)

Give the existing equipment `objectOf` call a bounded set of natural trailing
clause markers (`I/we/that/which/from/for/please/now`) so it extracts only the
item phrase, then reuse `canonicalItem` and unchanged `!equip`.

G: pass — solves the observed phrase at the existing selection owner, preserves
registry validation and every downstream contract, zero dependencies, local and
reversible.

### V2 — registry-backed longest selector (`registry-scan`, `extracted-helper`)

Create an equipment-specific helper that scans the normalized equipment clause
for connected-registry item names/labels and chooses the longest unique match.
This handles arbitrary trailing prose but adds a new matching algorithm and a
larger ambiguity/performance surface.

G: pass — exact registry binding, deterministic, compatible, zero dependencies;
larger but bounded selection surface.

### V3 — prompt command enforcement (`prompt-gate`, `degrade-graceful`)

Expand the shared model action detector to recognize `put on`/`wear`, forcing a
command or explicit failure whenever deterministic routing misses.

G: fail — it prevents this exact unreceipted success claim but leaves ordinary
equipment intent model-dependent and does not guarantee convergence on the
existing deterministic skill. It violates the negative-space/product contract.

## Divergence proof

- V1 vs V2: inline existing parser plus bounded clause markers versus a new
  extracted registry-search algorithm (module boundary/data selection differ).
- V1 vs V3: deterministic selection versus model-output enforcement
  (control-flow/owner/error path differ).
- V2 vs V3: registry data search versus prompt retry gate (data/control differ).

## Frozen rubric

Rubric frozen: axes [Style, Theme, Methodology, Modernization, Error wrapping,
Testability, Blast radius] · weights [1,2,2,2,2,2,1] · denominator = Σ(weights)
× 5 = 60 · denominator-policy [uniform-N/A-only] · baseline-algo
[lowest-effort gate-passer with no score of 1 on any quality axis]

freeze: axes=Style,Theme,Methodology,Modernization,Error wrapping,Testability,Blast radius weights=1,2,2,2,2,2,1 denom=ΣW×5 baseline=lowest-effort-gate-passer

## Scoring (only gate-passers; 1–5)

| Axis | W | V1 clause-bounded | V2 registry-scan |
|---|---:|---:|---:|
| Style | 1 | 5 | 4 |
| Theme | 2 | 5 | 5 |
| Methodology | 2 | 5 | 4 |
| Modernization | 2 | 4 | 5 |
| Error wrapping | 2 | 4 | 5 |
| Testability | 2 | 5 | 5 |
| Blast radius | 1 | 5 | 3 |
| Effort | — | low | medium |
| Weighted total | — | 56 | 55 |
| Normalized | — | 0.933 | 0.917 |

Arithmetic: V1 = `5×1 + 5×2 + 5×2 + 4×2 + 4×2 + 5×2 + 5×1 = 56`;
V2 = `4×1 + 5×2 + 4×2 + 5×2 + 5×2 + 5×2 + 3×1 = 55`;
denominator `12×5 = 60`.

## Pick

V1 is the algorithmic baseline and wins outright. It repairs the actual parser
boundary, preserves the connected-registry validator and deterministic equip
capability, and avoids installing a second item-recognition mechanism. Focused
verification must prove the exact qualified phrase, simple equip forms, unknown
items, and non-equipment conversation behavior before one final unchanged Paper
tranche.

[codeplan · session48-equipment-intent · OUT · mode: full · pick: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1 0.933, V2 0.917, V3 disqualified · reason: existing deterministic parser can bind the qualified item with the smallest shared semantic change · mechanism-check: passed · corrected: none]
