[codeplan · whole-tree-quota-selection · IN · mode: full · confidence: high · candidates: V1 quota-lexicographic all-reachable/inline-policy, V2 blended-score weighted-score/generic-ranker, V3 local-envelope bounded-component/extracted-helper, V4 sequential-veto route-order/inline-lookahead · lean: V3 · baseline: V4]

## Decision boundary

Observed player-visible failure: a lumberjack request needing three more logs
selected the nearest complete eight-log tree and finished it, yielding eleven
logs for a six-log request. Whole-tree completion correctly prevented a floating
remnant, but target selection ranked individual trunk bases before discovering
their connected component sizes.

Hard requirements: preserve complete-tree stewardship; consider only bounded
natural-tree components; preserve native Pathfinder route evidence and
CollectBlock execution; do not add movement, collection, or dependencies;
remain bounded and deterministic; avoid both gross quota overshoot and absurd
detours; retain truthful evidence and existing failure behavior.

Triviality gate: `trivial: no · continue`. Four credible policies trade quota
fit against route quality differently, and a poor choice can exchange one
obvious gameplay failure for another.

## Calibration

- Style: ESM JavaScript, small pure policy helpers, bounded arrays, deterministic
  tie-breaks, structured evidence, `node:test` plus strict assertions.
- Theme: project code owns component identity and quantity judgment; Pathfinder
  owns route planning/execution; CollectBlock/Mineflayer owns harvesting.
- Methodology: repair the first unproven selection boundary and preserve the
  already accepted whole-tree transaction.
- Error behavior: missing/invalid component or route evidence is never promoted;
  existing terminal execution evidence remains authoritative.
- Runtime: the current shortlist is capped at twelve candidates and natural-tree
  discovery at sixty-four connected logs; no unbounded world scan is permitted.
- Blast radius: prefer the pure collection selector plus a thin `collectWood`
  adapter; leave lumberjack planning and package mechanics unchanged.

## Variants and gates

### V1 — global quota lexicographic (`all-reachable`, `inline-policy`)

Discover every reachable shortlisted component and rank absolute difference
from the remaining quantity before route score, preferring a completing tree on
ties.

G: fail — it improves quantity fidelity but can send the bot across the entire
search range for a perfect-sized tree despite a reasonable nearby choice,
violating route directness and companion naturalness.

### V2 — blended route/yield score (`weighted-score`, `generic-ranker`)

Add component-yield penalties directly to the generic collection score, making
each excess or missing log worth a fixed amount of route cost.

G: pass — bounded and deterministic, but the cross-unit weight is arbitrary and
contaminates a generic block-ranking contract with whole-tree semantics.

### V3 — local route envelope, then quota fit (`bounded-component`, `extracted-helper`)

Discover and deduplicate natural components represented by the existing bounded
ranked shortlist. Admit only reachable trees within a small fixed score delta of
the best native-route candidate, then rank that local set by absolute difference
from the remaining quantity, completing-tree preference, route score, and stable
coordinates. Fall back to the existing selected block when no bounded natural
component is eligible.

G: pass — preserves route/hazard authority, forbids absurd detours by
construction, improves quota fit locally, remains bounded, and isolates the new
judgment in a pure helper.

### V4 — route-order overshoot veto (`route-order`, `inline-lookahead`)

Walk the existing route-ranked list and keep the first natural component unless
a later local candidate crosses a fixed gross-overshoot threshold; use that
first acceptable candidate rather than fully ranking yields.

G: pass — small and bounded, but threshold-edge ordering can choose a materially
worse tree and makes results depend on shortlist interleaving.

## Divergence proof

- V1 globally changes ranking priority; V2 combines different evidence into one
  scalar; V3 uses a route gate followed by a separate yield ordering; V4 retains
  route order and applies only an acceptance veto.
- V2 changes the generic ranker's scoring model; V3 adds a domain-specific pure
  policy; V4 embeds sequential policy in the collector.
- These differ in control flow, data flow, module boundary, and error surface.

## Frozen rubric

Rubric frozen: axes [Style, Ownership integrity, Companion naturalness,
Quantity/stewardship fidelity, Runtime boundedness, Truthful failure behavior,
Testability, Blast radius] · weights [1,2,2,2,2,2,1,1] · denominator =
Σ(weights) × 5 = 65 · denominator-policy [uniform-N/A-only] · baseline-algo
[lowest-effort gate-passer with no score of 1 on any quality axis]

freeze: axes=Style,Ownership integrity,Companion naturalness,Quantity/stewardship fidelity,Runtime boundedness,Truthful failure behavior,Testability,Blast radius weights=1,2,2,2,2,2,1,1 denom=ΣW×5 baseline=lowest-effort-gate-passer

## Scoring (only gate-passers; 1–5)

| Axis | W | V2 blended-score | V3 local-envelope | V4 sequential-veto |
|---|---:|---:|---:|---:|
| Style | 1 | 3 | 5 | 4 |
| Ownership integrity | 2 | 4 | 5 | 5 |
| Companion naturalness | 2 | 4 | 5 | 4 |
| Quantity/stewardship fidelity | 2 | 4 | 5 | 3 |
| Runtime boundedness | 2 | 5 | 5 | 5 |
| Truthful failure behavior | 2 | 5 | 5 | 5 |
| Testability | 1 | 4 | 5 | 4 |
| Blast radius | 1 | 3 | 4 | 4 |
| Effort | — | medium | medium | low |
| Weighted total | — | 54 | 64 | 56 |
| Normalized | — | 0.831 | 0.985 | 0.862 |

Arithmetic: V2 = `3×1 + 4×2 + 4×2 + 4×2 + 5×2 + 5×2 + 4×1 + 3×1 = 54`;
V3 = `5×1 + 5×2 + 5×2 + 5×2 + 5×2 + 5×2 + 5×1 + 4×1 = 64`;
V4 = `4×1 + 5×2 + 4×2 + 3×2 + 5×2 + 5×2 + 4×1 + 4×1 = 56`;
denominator `13×5 = 65`.

## Pick

V3 wins. It treats route quality as a non-compensatory locality gate, then uses
component yield for the judgment it actually informs. The policy is reusable
for every lumberjack quantity, keeps whole-tree stewardship intact, and does not
alter Pathfinder, CollectBlock, work-order planning, or persistence.

[codeplan · whole-tree-quota-selection · OUT · mode: full · pick: V3 · confidence: high · beatBaseline: yes · scores: V1 disqualified, V2 0.831, V3 0.985, V4 0.862 · reason: bounded local route gate followed by deterministic whole-component quota fit · mechanism-check: passed · corrected: arithmetic totals and normalized scores]
