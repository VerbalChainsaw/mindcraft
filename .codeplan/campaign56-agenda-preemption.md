[codeplan · campaign56-agenda-preemption · IN · mode: full · confidence: high · candidates: V1 per-entry counter external-store, V2 settlement ledger map-indexed, V3 direct-goal migration new-module · lean: V1 · baseline: V1]

## Decision boundary

Campaign 56 proved that a successful reflex interruption of a direct Agenda `goto` spends the same two-attempt budget as a genuine movement failure. Two safe Skeleton retreats therefore made the still-valid player return terminally fail. The repair must preserve the durable obligation and ordinary failure budget, resume from fresh state, remain bounded under endless danger, retain Stop/death/owner replacement censorship, and avoid parallel movement mechanics.

Triviality gate: `trivial: no · continue`. The code edit is small, but it changes persisted Agenda state and restart behavior.

## Repo calibration

- Style: small pure normalizers, frozen normalized records, bounded scalar counters, structured codes, atomic JSON persistence.
- Theme: one durable owner; selection/recovery policy stays in project control code while Mineflayer/Pathfinder retain physical execution.
- Methodology: repair the first proved boundary, preserve dirty WIP, add one focused regression, then use a real Paper replay.
- Compatibility: Agenda store version 1 accepts additive normalized fields; missing fields must default safely without a migration or version bump.
- Precedent: `work-order.js` already persists `preemptions`, holds the current phase without spending attempts, clears it after verified progress, and caps it at 24.

## Candidates and gates

### V1 — per-entry counter (`external-store`, `internal-reuse`, `return-code`)

Add one bounded `preemptions` scalar to normalized Agenda entries. `commitSettlement` recognizes structured interrupted results, returns the entry to pending without incrementing `attempts`, increments `preemptions`, and terminally fails once the ceiling is exhausted. Any settled non-preemption resets the counter. This directly reuses the WorkOrder contract at the existing Agenda ownership seam.

G: pass — additive backward-compatible state, no dependency, bounded, atomic through the existing store, and no physical-mechanics change.

### V2 — settlement ledger (`external-store`, `map-indexed`, `degrade-graceful`)

Replace the scalar attempt model with a persisted settlement-ledger object containing productive failures, preemptions, and wait outcomes, then derive entry state from the ledger. This generalizes retry accounting but changes every direct settlement and all persisted entries.

G: pass — viable and bounded with a compatible default, but touches substantially more state and callers than the proved defect requires.

### V3 — direct-goal migration (`new-module`, `external-store`, `internal-reuse`)

Introduce a durable direct-goal executor (or broaden GoalDirector kinds) so `goto` and every other direct Agenda command inherit goal preemption recovery and lifecycle reconciliation before Agenda sees a terminal result.

G: pass — structurally viable without new external dependencies, but creates or expands an ownership subsystem and migrates unrelated direct mechanics.

## Divergence proof

- V1 vs V2: scalar per-entry state versus map-indexed generalized settlement state.
- V1 vs V3: existing Agenda class boundary versus a new/broadened executor module.
- V2 vs V3: Agenda-owned ledger versus executor-owned goal lifecycle.

## Frozen rubric

Rubric frozen: axes [Style,Theme,Methodology,Modernization,Error wrapping,Testability,Blast radius] · weights [1,2,2,2,2,2,1] · denominator = 60 · denominator-policy [uniform-N/A-only] · baseline-algo [lowest-effort gate-passer with no score of 1 on any quality axis]

freeze: axes=Style,Theme,Methodology,Modernization,Error wrapping,Testability,Blast radius weights=1,2,2,2,2,2,1 denom=ΣW×5 baseline=lowest-effort-gate-passer

## Scoring

| Axis | W | V1 per-entry | V2 ledger | V3 direct-goal |
|---|---:|---:|---:|---:|
| Style | 1 | 5 | 4 | 3 |
| Theme | 2 | 5 | 4 | 3 |
| Methodology | 2 | 5 | 3 | 2 |
| Modernization | 2 | 5 | 5 | 4 |
| Error wrapping | 2 | 5 | 5 | 5 |
| Testability | 2 | 5 | 4 | 4 |
| Blast radius | 1 | 5 | 3 | 1 |
| Effort | - | low | medium | high |
| Weighted total | - | 60 | 49 | 40 |
| Normalized | - | 1.000 | 0.817 | 0.667 |

Arithmetic: V1 `(5+10+10+10+10+10+5)/60=1.000`; V2 `(4+8+6+10+10+8+3)/60=0.817`; V3 `(3+6+4+8+10+8+1)/60=0.667`. All use the same 60-point denominator.

Baseline: V1 is the lowest-effort gate-passer and has no quality-axis score of 1. It also wins the frozen rubric because it exactly matches an accepted local precedent while leaving physical mechanics and other executors frozen.

[codeplan · campaign56-agenda-preemption · OUT · mode: full · pick: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1 1.000, V2 0.817, V3 0.667 · reason: exact durable WorkOrder precedent at the existing Agenda seam · mechanism-check: passed · corrected: none]
