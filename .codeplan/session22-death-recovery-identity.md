[codeplan · session22-death-recovery-identity · IN · mode: full · confidence: high · candidates: V1 bound-record-receipt, V2 goal-snapshot-recovery, V3 evict-oldest-admit-latest, V4 capacity-only-increase · lean: V1 · baseline: V1]

## Decision

Observed defect: a ninth non-empty death was rejected by the bounded eight-entry
ledger, the death callback ignored that rejection, GoalDirector entered recovery,
and the argumentless recovery command selected the stale FIFO head. This crossed
from persistence failure into physical movement toward the wrong death site.

Calibration: `PersonalMemory` owns bounded normalized atomic persistence;
`MemoryBank` owns its compatibility facade; GoalDirector owns durable retry
authority; deterministic commands must carry exact identity into the existing
recovery skill. Existing public boolean `rememberDeath`, FIFO recovery, direct
recovery commands, and schema-2 lazy migration must stay backward-compatible.
Expected failures use structured codes; they do not throw or infer success.

## Variants and gates

- **V1 bound-record-receipt** (`argument-token`, `internal-reuse`,
  `degrade-graceful`): add an identity-bearing `recordDeath` result while
  retaining `rememberDeath` as a boolean wrapper. Persist the triggering
  record's `recordedAt` in Goal operational memory, dispatch the existing
  recovery command with that token, and make MemoryBank recall/settle that
  exact record. If persistence rejects the record, Goal fails closed with a
  distinct capacity code and dispatches no stale recovery. **G: pass.**
- **V2 goal-snapshot-recovery** (`embedded-state`, `internal-reuse`,
  `degrade-graceful`): copy the full current death manifest into Goal state and
  bypass MemoryBank for Goal-owned recovery. This avoids capacity rejection but
  creates two owners for the same obligation and does not cover direct/Agenda
  recovery consistently. **G: pass.**
- **V3 evict-oldest-admit-latest** (`ring-eviction`, `local-state`,
  `return-code`): discard the oldest unresolved ledger entry to admit the
  current death. **G: fail — data-integrity and compatibility; it silently
  destroys a still-unsettled obligation.**
- **V4 capacity-only-increase** (`constant-growth`, `local-state`,
  `return-code`): increase the ledger bound. **G: fail — negative-space; the
  same stale-recovery defect returns at the next capacity boundary and ordinary
  multi-death recovery still lacks trigger identity.**

V1 differs from V2 in state ownership and argument carriage; V3 changes the
ledger data structure/eviction policy; V4 changes only a bound.

Rubric frozen: axes [Style, Theme, Methodology, Modernization, Error wrapping, Testability, Blast radius] · weights [1,2,2,2,2,2,1] · denominator = Σ(weights) × 5 · denominator-policy [uniform-N/A-only] · baseline-algo [lowest-effort gate-passer with no score of 1 on any quality axis]

freeze: axes=Style,Theme,Methodology,Modernization,Error wrapping,Testability,Blast radius weights=1,2,2,2,2,2,1 denom=ΣW×5 baseline=lowest-effort-gate-passer

## Scoring

| Axis | W | V1 bound receipt | V2 goal snapshot |
|---|---:|---:|---:|
| Style | 1 | 5 | 3 |
| Theme | 2 | 5 | 2 |
| Methodology | 2 | 5 | 3 |
| Modernization | 2 | 5 | 3 |
| Error wrapping | 2 | 5 | 4 |
| Testability | 2 | 5 | 4 |
| Blast radius | 1 | 4 | 3 |
| Effort | — | medium | medium |
| Weighted total | — | 59 | 38 |
| Normalized | — | 0.983 | 0.633 |

Arithmetic: denominator `(1+2+2+2+2+2+1)*5=60`; V1
`5+10+10+10+10+10+4=59`; V2 `3+4+6+6+8+8+3=38`.

Baseline is V1: both viable variants are medium effort, but V1 is the lower
maintenance mechanism because it preserves one obligation owner and the
existing command/skill. V1 also has the highest normalized score.

[codeplan · session22-death-recovery-identity · OUT · mode: full · pick: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1 0.983, V2 0.633 · reason: one durable owner and exact trigger identity with fail-closed capacity handling · mechanism-check: passed]
