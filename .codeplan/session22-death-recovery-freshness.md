[codeplan · session22-death-recovery-freshness · IN · mode: full · confidence: high · candidates: V1 receipted-latest-rotation, V2 active-plus-backlog, V3 loaded-site-pruning, V4 capacity-growth · lean: V1 · baseline: V1]

## Decision boundary

The earlier identity plan remains correct for an active Goal: the current
death's exact `recordedAt` is carried into `!recoverDeathItems(ID)`, and a
rejected write cannot authorize stale FIFO movement. New live evidence exposes
a different boundary. Outside an active Goal, eight unresolved historical
records made the current 23-item death unpersistable, and the argumentless
player command selected the oldest one-log record while the fresh pile
despawned. A bounded companion ledger must prioritize the newest time-sensitive
death and make any capacity displacement explicit and durable.

Calibration: `PersonalMemory` owns bounded normalized atomic storage;
`MemoryBank` owns death ordering and its compatibility facade; the existing
command and recovery skill remain the one action path. Existing exact-ID Goal
recovery, legacy one-record migration, the eight-record bound, ActionManager,
and Mineflayer pickup/navigation remain unchanged. Expected capacity behavior
uses structured receipts and never throws or claims recovery.

Triviality gate: `trivial: no · continue` — this changes persisted ordering,
capacity settlement, direct-command selection, and death telemetry.

## Variants and gates

- **V1 receipted-latest-rotation** (`list-rotation`, `class-method`,
  `degrade-graceful`): keep the existing bounded pending list and exact-ID API.
  When full, durably move the oldest obligation into one bounded
  `lastDisplaced` receipt, append the fresh death, and return
  `death_recorded_after_capacity_displacement` with both identities. Add a
  latest-record accessor; argumentless player/Agenda recovery selects it and
  settles that exact identity. FIFO `recallDeath()` remains compatible for
  legacy callers. **G: pass.**
- **V2 active-plus-backlog** (`map-indexed`, `external-store`,
  `degrade-graceful`): migrate the ledger to a separately persisted active
  death plus a seven-record backlog and displacement history; argumentless
  recovery always selects active. **G: pass.** It solves the boundary but
  changes the persisted schema and every accessor for no additional current
  gameplay result.
- **V3 loaded-site-pruning** (`world-probe`, `instance-state`, `return-code`):
  pass live bot/world access into persistence and remove only old records whose
  loaded sites contain no matching drops. **G: fail — functional correctness.**
  All eight old sites may be unloaded, so the current death can still be
  rejected; persistence would also begin owning world mechanics.
- **V4 capacity-growth** (`constant-growth`, `local-state`, `return-code`):
  raise the bound and make argumentless recovery newest-first. **G: fail —
  negative-space.** The same silent rejection returns at the next bound and no
  durable displacement outcome exists.

V1 and V2 differ in data structure, state shape, and migration blast radius.
V3 crosses the memory/world module boundary. V4 changes only the constant and
cannot satisfy the durability contract.

Rubric frozen: axes [Style, Theme, Methodology, Modernization, Error wrapping, Testability, Blast radius] · weights [1,2,2,2,2,2,1] · denominator = Σ(weights) × 5 · denominator-policy [uniform-N/A-only] · baseline-algo [lowest-effort gate-passer with no score of 1 on any quality axis]

freeze: axes=Style,Theme,Methodology,Modernization,Error wrapping,Testability,Blast radius weights=1,2,2,2,2,2,1 denom=ΣW×5 baseline=lowest-effort-gate-passer

## Scoring

| Axis | W | V1 rotation | V2 active/backlog |
|---|---:|---:|---:|
| Style | 1 | 5 | 4 |
| Theme | 2 | 5 | 4 |
| Methodology | 2 | 5 | 3 |
| Modernization | 2 | 4 | 5 |
| Error wrapping | 2 | 5 | 4 |
| Testability | 2 | 5 | 4 |
| Blast radius | 1 | 4 | 2 |
| Effort | — | medium | high |
| Weighted total | — | 57 | 46 |
| Normalized | — | 0.950 | 0.767 |

Arithmetic verified with the repository Node runtime: denominator
`(1+2+2+2+2+2+1)*5=60`; V1
`5+10+10+8+10+10+4=57`; V2 `4+8+6+10+8+8+2=46`; both use the same
seven-axis set.

Baseline is V1: it is the lower-effort gate-passer and has no quality-axis
score of 1. V1 also wins the frozen rubric because it preserves the current
store/API while making the unavoidable bounded tradeoff explicit.

[codeplan · session22-death-recovery-freshness · OUT · mode: full · pick: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1 0.950, V2 0.767 · reason: newest death remains durable with an explicit bounded displacement receipt and no second recovery owner · mechanism-check: passed · corrected: prior fail-closed capacity policy superseded by live non-Goal evidence]
