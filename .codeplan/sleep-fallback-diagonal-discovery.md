[codeplan · diagonal-bed-discovery · IN · mode: full · confidence: high · candidates: V1 overscan-filter, V2 ledger-revalidate, V3 probe-union, V4 world-scan, V5 package-upgrade · lean: V1 · baseline: V1]

# Diagonal bed discovery after occupied-bed fallback

## Decision input

The final live replay admitted bed D at `(-351, 71, -159)` from Kevin's initial
position. After Kevin walked to rejected bed C, D remained only 19.7 blocks
away but disappeared from `!nearbyBeds`. Raising the raw result cap from 8 to
64 did not change the failure.

The installed Mineflayer 4.37.1 `findBlocks` scans sections with an
`OctahedronIterator` whose apothem is `ceil((maxDistance + 8) / 16)`. With the
production radius of 24, the apothem is 2. D's section is two Manhattan section
steps from the initial position but three after Kevin crosses south into C's
chunk. The installed iterator reproduced that exact inclusion flip.

The repair must preserve the logical 24-block selection radius, canonical
head/foot identity, exact-bed dispatch, current safety evidence, bounded work,
and Mineflayer ownership of block discovery.

## Calibration

- Style: ESM, two spaces, single quotes, semicolons, early guards, bounded
  constants, frozen receipts, fail-closed environmental evidence.
- Theme: project code owns judgment and thin adapters; Mineflayer owns loaded
  block discovery and interaction; Pathfinder owns routes.
- Methodology: repair the first unproven boundary, use one focused regression,
  return to physical Paper acceptance, and freeze unaffected mechanics.
- No new dependencies, custom block scanner, executor substitution, stale
  safety authority, or broad framework.

## Variants and mechanism fingerprints

### V1 — overscan-filter (`internal-reuse`, `local-only`)

Ask the existing Mineflayer `findBlocks` API to scan 48 blocks, which gives its
section iterator apothem 4, then filter canonical candidates back to the
existing exact 24-block logical radius. Retain the bounded 64-raw-block cap.
For a block within Euclidean distance 24, the maximum reachable section L1
offset is 4; therefore the widened package scan covers the diagonal-section
gap without widening product selection.

G: pass — correct, package-first, bounded, zero dependency, compatible, and
the public selection contract remains 24 blocks.

### V2 — ledger-revalidate (`map-indexed`, `instance-state`)

Persist the first same-night candidate identity set in the director. On each
fallback, revalidate every exact block, occupancy, and current threat state
before policy selection, rather than relying on a fresh package scan.

G: pass — can solve the observed loss and can be made safe, but introduces a
second temporal cache and materially more invalidation/state ownership.

### V3 — probe-union (`list-accum`, `local-only`)

Call Mineflayer `findBlocks` from the current point plus bounded adjacent
section-offset probe points, union native results, canonicalize, and filter to
24 blocks.

G: pass — stays package-first and can cover the gap, but multiplies scans and
requires a more complex coverage proof and merge path.

### V4 — world-scan (`loop-inline`, `local-only`)

Walk loaded Prismarine world sections directly and implement an exact sphere
search in project code.

G: fail — violates the package-first rule because a thin Mineflayer adapter is
available; it creates a parallel discovery engine.

### V5 — package-upgrade (`new-library`, `external-store`)

Upgrade or patch Mineflayer's installed block-search implementation.

G: fail — dependency changes lack authority and compatibility evidence, and a
local bounded adapter can preserve the current runtime.

## Divergence proof

- V1 changes the delegated call envelope and filters locally.
- V2 changes state location to an instance-owned episode ledger.
- V3 changes control flow to multiple delegated probes plus union.
- V4 changes ownership to a custom scanner; V5 changes dependency provenance.

## Frozen rubric

Rubric frozen: axes [Style, Theme, Methodology, Modernization, Error wrapping, Testability, Blast radius] · weights [1,2,2,2,2,2,1] · denominator = Σ(weights) × 5 · denominator-policy [uniform-N/A-only] · baseline-algo [lowest-effort gate-passer with no score of 1 on any quality axis]

freeze: axes=Style,Theme,Methodology,Modernization,Error wrapping,Testability,Blast radius weights=1,2,2,2,2,2,1 denom=ΣW×5 baseline=lowest-effort-gate-passer

## Scoring

| Axis | W | V1 overscan-filter | V2 ledger-revalidate | V3 probe-union |
|---|---:|---:|---:|---:|
| Style | 1 | 5 | 4 | 3 |
| Theme/paradigm | 2 | 5 | 4 | 5 |
| Methodology | 2 | 5 | 3 | 3 |
| Modernization | 2 | 4 | 4 | 4 |
| Error wrapping | 2 | 5 | 4 | 4 |
| Testability | 2 | 5 | 4 | 3 |
| Blast radius | 1 | 5 | 3 | 2 |
| Effort | — | low | medium | medium |
| Weighted total | — | 58 | 45 | 43 |
| Denominator | — | 60 | 60 | 60 |
| Normalized | — | 0.967 | 0.750 | 0.717 |

Baseline: V1 is the lowest-effort gate-passer and has no quality-axis score of
1. V1 also wins the frozen rubric. Its mechanism directly compensates for the
installed package's section iterator while retaining package ownership and the
logical radius.

## Implementation contract

- Introduce explicit logical and delegated scan-radius constants.
- Use the widened radius only at the Mineflayer discovery call.
- Compute candidate distance from Kevin and discard anything beyond 24 before
  policy or query visibility.
- Preserve native `Vec3`, head-to-foot normalization, occupancy, safety,
  deduplication, and exact `!goToBedAt` dispatch.
- Add one focused regression based on the installed section-iterator geometry:
  D is within 24 blocks and must remain discoverable after the chunk crossing.
- Re-run focused survival checks, then Regression Scout's adjacent checks.

[codeplan · diagonal-bed-discovery · OUT · mode: full · pick: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1 0.967, V2 0.750, V3 0.717 · reason: preserves Mineflayer ownership and exact 24-block product semantics with the smallest bounded adapter · mechanism-check: passed · corrected: count-only disqualified by live replay]
