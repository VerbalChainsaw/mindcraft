[codeplan · session50-threat-grounding · IN · mode: full · confidence: high · candidates: V1 prompt policy+inline-block, V2 awareness contract+producer-enrichment, V3 grounding guard+extracted-helper · lean: V3 · baseline: V1]

## Decision boundary

Campaign 50 reproduced one false-safety response. The authoritative perception receipt reported an occluded, high-priority skeleton closing from 10.2 to 7.6 blocks. The follow-up response asserted both that the family was safe and that neither hostile had a clear path, although no reachability receipt existed.

Center Audit result: `DEFECT_CONFIRMED`, HIGH confidence for the unchecked grounding boundary, intermittent reproduction because model text is nondeterministic. The first unproven boundary is `!awareness` evidence -> conversation generation -> unchecked conversational settlement. Pathfinder, Mineflayer, threat scoring, Operator Hold, and combat execution are non-scope.

## Calibration

- Style: small exported pure helpers, early returns, bounded strings, no dependency additions.
- Theme: structured world evidence stays authoritative; missing evidence remains unknown; LLM conversation is preserved but cannot promote occlusion into route proof.
- Methodology: repair the smallest shared seam, add one focused regression check, replay the unchanged real-Paper family request once.
- Error path: reject unsupported generated certainty and retry within the existing bounded conversation budget; do not throw or execute gameplay.
- Testability: the decision must be independently testable from generated text plus a normalized perception receipt.
- Blast radius: conversation grounding only; no movement, combat, perception scoring, persistence, or schema changes.

Triviality gate: trivial: no · continue. The change is small but has three materially different mechanisms and safety/regression consequences.

## Candidates and gates

### V1 — Prompt policy (`inline-block`, `local-only`, `zero-dep`, `degrade-graceful`)

Add one global operating rule explaining that occlusion is line-of-sight evidence only and that categorical safety requires stronger evidence.

G: pass. Smallest mechanism and preserves interfaces, but model compliance remains probabilistic and there is no independently testable settlement gate.

### V2 — Awareness contract (`producer-enrichment`, `local-only`, `zero-dep`, `return-text`)

Enrich `!awareness` with an explicit route-evidence/epistemic line derived from the perception snapshot, leaving generation unchecked.

G: pass. Improves the authoritative input and is reusable across models, but still relies on the model honoring the contract and mixes consumer policy into the query formatter.

### V3 — Grounding guard (`extracted-helper`, `local-only`, `zero-dep`, `degrade-graceful`)

Add a pure conversational grounding check at the generation boundary. Reject unsupported hostile reachability claims unconditionally; reject categorical safety when the authoritative primary threat is high/critical or approaching nearby; append a bounded evidence-specific correction and reuse the existing retry loop. Keep the ordinary LLM response path and provide no new gameplay authority.

G: pass. Preserves APIs, schemas, conversation architecture, and runtime compatibility; directly enforces the violated boundary without changing perception or mechanics.

Pairwise divergence: V1 changes only prompt policy; V2 changes the evidence producer; V3 changes settlement control-flow through a pure guard and bounded retry. These differ in module boundary and control-flow, not wording.

## Frozen rubric

Rubric frozen: axes [Style, Theme, Methodology, Modernization, Error wrapping, Testability, Blast radius] · weights [1,2,2,2,2,2,1] · denominator = Σ(weights) × 5 = 60 · denominator-policy [uniform-N/A-only] · baseline-algo [lowest-effort gate-passer with no score of 1 on any quality axis]

freeze: axes=Style,Theme,Methodology,Modernization,Error wrapping,Testability,Blast radius weights=1,2,2,2,2,2,1 denom=ΣW×5 baseline=lowest-effort-gate-passer

## Scoring

| Axis | W | V1 prompt policy | V2 awareness contract | V3 grounding guard |
|---|---:|---:|---:|---:|
| Style | 1 | 5 | 4 | 4 |
| Theme/paradigm | 2 | 3 | 4 | 5 |
| Methodology | 2 | 3 | 4 | 5 |
| Modernization | 2 | 3 | 4 | 4 |
| Error wrapping | 2 | 4 | 4 | 5 |
| Testability | 2 | 2 | 4 | 5 |
| Blast radius | 1 | 5 | 4 | 4 |
| Effort | - | low | low-medium | medium |
| Weighted total | - | 40 | 48 | 56 |
| Normalized | - | 0.667 | 0.800 | 0.933 |

Baseline: V1, the lowest-effort gate-passer with no quality score of 1.

Pick: V3. Its pure receipt-driven guard makes the missing-evidence invariant enforceable and testable while retaining the existing model, prompt, retry budget, and conversational surface. V1 and V2 improve the odds but leave the demonstrated false settlement legal.

[codeplan · session50-threat-grounding · OUT · mode: full · pick: V3 · confidence: high · beatBaseline: yes · scores: V1 0.667, V2 0.800, V3 0.933 · reason: receipt-driven guard enforces unknown-as-unknown at the existing model boundary · mechanism-check: passed · corrected: bounded retries could end silently; the same receipt guard now degrades to a deterministic honest threat summary]
