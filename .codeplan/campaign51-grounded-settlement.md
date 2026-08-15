[codeplan · campaign51-grounded-settlement · IN · mode: full · confidence: high · candidates: V1 receipt-context prompt-inline, V2 receipt-guard pure-helper, V3 status-router deterministic-bypass, V4 verifier-pass model-chain · lean: V2 · baseline: V3]

trivial: no · continue

## Fixed contract

Player-visible outcome: after a physically verified action, a follow-up question receives a response consistent with the fresh structured action receipt and current inventory. The repair must preserve the LLM conversation architecture, accept ordinary companion prose when grounded, and fall back truthfully after bounded invalid generations. Lumberjack, inventory, JobDirector, ActionManager, Mineflayer, and Paper are frozen.

## Variants and gates

- V1 `prompt-inline`: append the fresh receipt to the conversation prompt and rely on model compliance. **G: fail — functional/negative-space.** It informs but does not enforce; the current prompt already provides authoritative inventory and the observed generation still contradicted it.
- V2 `pure-helper` + `internal-reuse` + `degrade-graceful`: append one bounded normalized receipt context, validate a relevant denial against that receipt after generation, retry with an exact correction, and use a receipt-derived fallback only after the existing retry budget. **G: pass.**
- V3 `deterministic-bypass` + `inline-block` + `return-code`: classify recent-action questions before prompting and answer them deterministically. **G: pass.** It enforces truth but diverts ordinary family conversation around the LLM and requires a broader intent classifier.
- V4 `model-chain` + `instance-state` + `degrade-graceful`: send every conversational response through a second model-based factual verifier. **G: pass.** It preserves natural prose but adds provider latency, nondeterminism, lifecycle surface, and cost.

Pairwise divergence: V2 differs from V3 in control flow and module boundary; V2 differs from V4 in dependency/control flow; V3 differs from V4 in state and error path.

## Rubric freeze

Rubric frozen: axes [Style, Theme, Methodology, Modernization, Error wrapping, Testability, Blast radius] · weights [1,2,2,2,2,2,1] · denominator = 60 · denominator-policy [uniform-N/A-only] · baseline-algo [lowest-effort gate-passer with no score of 1 on any quality axis]

freeze: axes=Style,Theme,Methodology,Modernization,Error wrapping,Testability,Blast radius weights=1,2,2,2,2,2,1 denom=ΣW×5 baseline=lowest-effort-gate-passer

## Scoring

| Axis | W | V2 receipt-guard | V3 status-router | V4 verifier-pass |
|---|---:|---:|---:|---:|
| Style | 1 | 5 | 4 | 3 |
| Theme/paradigm | 2 | 5 | 3 | 4 |
| Methodology | 2 | 5 | 3 | 2 |
| Modernization | 2 | 4 | 4 | 3 |
| Error wrapping | 2 | 5 | 5 | 3 |
| Testability | 2 | 5 | 5 | 2 |
| Blast radius | 1 | 4 | 3 | 1 |
| Effort | - | medium | low | high |
| Weighted total | - | 57/60 = 0.950 | 47/60 = 0.783 | 32/60 = 0.533 |

Baseline: V3, the lowest-effort gate-passer with no quality-axis score of 1. V2 wins because it enforces the same evidence boundary while retaining normal LLM conversation and reusing the existing bounded retry/fallback lifecycle. V4 is disproportionate and expands provider/lifecycle ownership.

[codeplan · campaign51-grounded-settlement · OUT · mode: full · pick: V2 · confidence: high · beatBaseline: yes · scores: V2 0.950, V3 0.783, V4 0.533 · reason: bounded receipt context plus deterministic contradiction guard preserves companion conversation and enforces truth at the existing settlement seam · mechanism-check: passed · corrected: arithmetic verification corrected V2 weighted total before implementation]
