[codeplan · session22-agenda-death-revalidation · IN · mode: full · confidence: high · candidates: V1 event-rewind class-method, V2 dispatch-lease inline-gate, V3 custody-epoch external-store · lean: V1 · baseline: V1]

# Session 22 Agenda death revalidation

Triviality gate: `trivial: no · continue`. The repair crosses Agent death
lifecycle, Agenda persistence, and asynchronous direct-dispatch cancellation.

## Repository calibration

Rules calibration: use the smallest shared Agenda seam, preserve one
ActionManager owner and deterministic direct/natural-language skills, treat
death and owner replacement as censored lifecycle evidence, persist normalized
immutable receipts, fail closed on missing evidence, and preserve unrelated
dirty work. Do not alter mechanics, packages, or accepted gameplay seams.

Source calibration: Agenda entries are immutable normalized replacements saved
atomically; restart repairs target exact persisted contradictions. Direct
commands use a closed typed map and `directDispatchGeneration` censors stale
callbacks. Tests use `node:test`, strict assertions, injected clocks/stores and
executors, restart reconstruction, and exact structured outcomes.

Spot checks: `AgendaDirector.commitDirectResult` verifies the dispatch
generation and exact active entry; `AgendaDirector.replace` normalizes then
persists; `Agent` currently sends death only to GoalDirector.

## Variants and hard gates

- V1 `event-rewind / class-method / instance-state / internal-reuse /
  return-code`: `AgendaDirector.reconcileDeath` censors the direct generation,
  rewinds only the first unfinished step's exact completed inventory-acquire
  predecessor, persists once, and delays redispatch through respawn settlement.
  `G: pass`.
- V2 `dispatch-lease / inline-gate / local-query / internal-reuse /
  return-code`: death only censors the generation; every dependency dispatch
  resolves the predecessor target and rechecks current inventory, rewinding on
  mismatch. `G: pass`.
- V3 `custody-epoch / class-method / external-store / zero-dep /
  degrade-graceful`: persist a body-life epoch on inventory completion and
  require an epoch match at every dependent dispatch. `G: pass`.

Divergence: V1 differs from V2 in control time and module boundary; V1 differs
from V3 in state location; V2 differs from V3 in both state carrier and error
path. None removes, suppresses, or relabels the required revalidation.

Rubric frozen: axes [Style, Theme, Methodology, Modernization, Error wrapping,
Testability, Blast radius] · weights [1,2,2,2,2,2,1] · denominator = 60 ·
denominator-policy [uniform-N/A-only] · baseline-algo
[lowest-effort gate-passer with no score of 1 on any quality axis]

`freeze: axes=Style,Theme,Methodology,Modernization,Error wrapping,Testability,Blast radius weights=1,2,2,2,2,2,1 denom=ΣW×5 baseline=lowest-effort-gate-passer`

## Scoring

| Axis | W | V1 event-rewind | V2 dispatch-lease | V3 custody-epoch |
| --- | ---: | ---: | ---: | ---: |
| Style | 1 | 5 | 4 | 4 |
| Theme/paradigm | 2 | 5 | 4 | 3 |
| Methodology | 2 | 5 | 4 | 3 |
| Modernization | 2 | 4 | 4 | 5 |
| Error wrapping | 2 | 5 | 5 | 4 |
| Testability | 2 | 5 | 4 | 4 |
| Blast radius | 1 | 5 | 3 | 2 |
| Effort | - | low | medium | high |
| Weighted total | - | 58 | 49 | 44 |
| Normalized | - | 0.967 | 0.817 | 0.733 |

Arithmetic was independently evaluated with the frozen weights; all variants
use the identical 60-point denominator. V1 is the algorithmic baseline and the
highest score. It binds invalidation to the authoritative death edge without
adding repeated registry queries or a new durable epoch contract.

## Repair contract and revalidation

`repair_revalidation: INVARIANT_HOLDS`. The live flight, persisted Agenda, and
current source still reproduce the audit trajectory: death does not reach
Agenda, the dependency gate trusts terminal state alone, and the existing
generation is the correct stale-callback boundary.

Implement V1 only. Preserve attempts, acquisition checkpoint, downstream
queue, GoalDirector behavior, ActionManager cleanup, and every physical
mechanic. Emit the bounded Agenda revalidation result in the existing
`self.died` event evidence. Verify pending and already-dispatching dependent
cases plus restart persistence.

[codeplan · session22-agenda-death-revalidation · OUT · mode: full · pick: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1 0.967, V2 0.817, V3 0.733 · reason: authoritative death-edge rewind gives the strongest lifecycle fit with the smallest persisted surface · mechanism-check: passed · corrected: none]
