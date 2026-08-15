[codeplan · follow-survival-continuity · IN · mode: full · confidence: high · candidates: V1 inline guards (inline-block/local-only), V2 shared continuity helpers (extracted-helper/internal-reuse), V3 arbiter accompaniment lease (class-method/instance-state) · lean: V2 · baseline: V1]

## Decision target

Keep an accepted follow/guard commitment continuous across reflex handoffs, prevent ambient combat from exploiting an idle handoff gap, and let follow preserve breathable movement before global self-preservation must preempt it.

## Calibration

- Style: small exported pure policy helpers, bounded receipts, and explicit result codes already dominate the touched files.
- Architecture: project code owns judgment and interruption; Mineflayer Pathfinder and existing skills own locomotion.
- Method: repair the first proven boundary, preserve dirty WIP, add only focused defect coverage, then run the real gameplay path.
- Compatibility: fresh attributed damage, protection, and critical self-preservation must retain immediate authority.
- Scope: no dependency changes, no parallel movement/combat engine, no broad arbiter rewrite.

## Variants and gates

- V1 `inline-block/local-only`: add directive checks directly to `ambientSelfDefensePermitted`; call `escapeDrowning` inline from the follow loop at a proactive oxygen threshold. G: pass.
- V2 `extracted-helper/internal-reuse`: expose one pure durable-accompaniment policy helper and one bounded shared breathable-navigation helper; use them from combat admission, follow, and drowning recovery while preserving existing native Pathfinder execution. G: pass.
- V3 `class-method/instance-state`: introduce an accompaniment lease on BehaviorArbiter that owns combat suppression, proactive surfacing, and resume announcements. G: pass, but expands lifecycle state and duplicates ownership already persisted by CompanionContext.

Pairwise divergence: V1/V2 differ at module boundary and reuse; V1/V3 differ in state location and control ownership; V2/V3 differ in state location and module owner.

## Frozen rubric

Rubric frozen: axes [Repo style, Ownership spine, Package-first mechanics, Compatibility/error behavior, Testability, Blast/reversibility] · weights [1,3,3,2,2,1] · denominator = 60 · denominator-policy [uniform-N/A-only] · baseline-algo [lowest-effort gate-passer with no score of 1 on any quality axis]

freeze: axes=Repo style,Ownership spine,Package-first mechanics,Compatibility/error behavior,Testability,Blast/reversibility weights=1,3,3,2,2,1 denom=60 baseline=lowest-effort-gate-passer

## Scoring

| Axis | W | V1 | V2 | V3 |
|---|---:|---:|---:|---:|
| Repo style | 1 | 4 | 5 | 4 |
| Ownership spine | 3 | 3 | 5 | 4 |
| Package-first mechanics | 3 | 4 | 5 | 4 |
| Compatibility/error behavior | 2 | 4 | 5 | 3 |
| Testability | 2 | 3 | 5 | 4 |
| Blast/reversibility | 1 | 5 | 4 | 2 |
| Effort | - | low | medium | high |
| Weighted total | - | 44 | 59 | 44 |
| Normalized | - | 0.733 | 0.983 | 0.733 |

Arithmetic: V1 = 4+9+12+8+6+5 = 44; V2 = 5+15+15+10+10+4 = 59; V3 = 4+12+12+6+8+2 = 44. All use denominator `(1+3+3+2+2+1)*5 = 60`.

Baseline: V1, the lowest-effort gate-passer with no quality-axis score of 1.

Winner: V2. It binds policy to the durable CompanionContext commitment instead of transient ActionManager occupancy, and reuses one breath-recovery primitive without creating an arbiter-owned movement engine.

[codeplan · follow-survival-continuity · OUT · mode: full · pick: V2 · confidence: high · beatBaseline: yes · scores: V1 0.733, V2 0.983, V3 0.733 · reason: preserves durable ownership and delegates locomotion through one shared bounded helper · mechanism-check: passed · corrected: retained package-owned swim ascent and specialized the shared helper to dry retreat settlement]
