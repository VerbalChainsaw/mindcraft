[codeplan · campaign63-chat-segmentation · IN · mode: full · confidence: high · candidates: V1 atomic transport segments (class-batch), V2 dialogue routing segments (route-list), V3 model compression (model-rewrite) · lean: V1 · baseline: V2]

## Decision boundary

Campaign 63 produced a correct 1,421-character grounded family answer, but
`boundedChatText` silently retained only the first 240 characters. Minecraft
players therefore received only priority one of three. The repair must preserve
the complete player-visible answer, command hiding, translation, delivery
ordering, the 240-character safety bound, whispers, ordinary chat, MindServer
output, and speech behavior without adding a dependency or changing gameplay
authority.

Triviality: `no · continue`. The change is localized, but correct delivery has
multiple credible ownership boundaries and ordering implications.

## Codebase calibration

- Repo hard rules favor the smallest shared owner, truthful player-visible
  results, no new framework/dependency, focused checks, and real Paper replay.
- `Agent.openChat` already owns translation, command elision, rate limiting,
  whisper/chat/server fan-out, speech, and a promise chain that serializes
  deliveries. This is the first boundary that knowingly discards the suffix.
- Existing style uses small zero-dependency helpers, promise serialization,
  bounded normalized strings, and graceful logging rather than thrown delivery
  errors.
- Quality axes: project style, companion/transport ownership, bounded campaign
  methodology, runtime-compatible robustness, graceful delivery failure,
  focused testability, and blast radius.

## Variants and gates

### V1 — atomic transport segments (`class-batch`, `list-accum`, `zero-dep`, `degrade-graceful`)

Replace the lossy single-string helper with a pure word/sentence-aware segment
helper. `openChat` translates once, then delivers every bounded segment inside
one `_chatDelivery` job, applying the existing interval between segments. Speak
the full response once. Every whisper/chat/MindServer segment stays ordered
before the next response can begin.

G: pass — solves complete in-game delivery, preserves all current channels and
contracts, adds no dependency, and keeps ordering at the existing transport
owner.

### V2 — dialogue routing segments (`route-list`, `local-only`, `zero-dep`, `degrade-graceful`)

Split long model dialogue in `routeResponse` and call `openChat` once per chunk.
This solves the observed conversational answer and relies on the existing
promise chain for ordering, but command results, ReactionDirector, SelfPrompter,
and other direct `openChat` callers retain lossy truncation. Translation and
speech also occur per fragment.

G: pass — solves the observed model-conversation defect without API or
dependency changes, though it is not the complete shared output boundary.

### V3 — model compression (`model-rewrite`, `instance-state`, `internal-reuse`, `degrade-graceful`)

When output exceeds 240 characters, ask the configured model for a one-message
summary and fall back to the current ellipsis on failure.

G: fail — nondeterministic rewriting cannot guarantee preservation of exact
health, quantities, all requested priorities, or a complete answer. It also
adds latency/cost and solves overflow by potentially omitting content.

## Divergence proof

- V1 vs V2 differ at module/control boundary: one atomic transport batch versus
  multiple independently queued dialogue calls.
- V1/V2 vs V3 differ in mechanism and state: deterministic list segmentation
  versus a second model rewrite.
- V3 fails before scoring.

Rubric frozen: axes [Style, Theme, Methodology, Modernization, Error wrapping, Testability, Blast radius] · weights [1,2,2,2,2,2,1] · denominator = Σ(weights) × 5 = 60 · denominator-policy [uniform-N/A-only] · baseline-algo [lowest-effort gate-passer with no score of 1 on any quality axis]

freeze: axes=Style,Theme,Methodology,Modernization,Error wrapping,Testability,Blast radius weights=1,2,2,2,2,2,1 denom=ΣW×5 baseline=lowest-effort-gate-passer

## Scoring

| Axis | W | V1 atomic transport | V2 dialogue routing |
|---|---:|---:|---:|
| Style | 1 | 4 | 4 |
| Theme / paradigm | 2 | 5 | 3 |
| Methodology | 2 | 5 | 3 |
| Modernization | 2 | 4 | 4 |
| Error wrapping | 2 | 5 | 4 |
| Testability | 2 | 5 | 3 |
| Blast radius | 1 | 4 | 4 |
| Effort | — | medium | low |
| Weighted total | — | 56 | 42 |
| Normalized | — | 0.933 | 0.700 |

Arithmetic verified with the frozen weights: V1 =
`4 + 10 + 10 + 8 + 10 + 10 + 4 = 56`; V2 =
`4 + 6 + 6 + 8 + 8 + 6 + 4 = 42`; denominator `12 × 5 = 60`.
Identical axes and denominator apply to both scored variants.

Baseline is V2: lowest effort with no quality-axis score of 1. V1 wins because
the additional helper/batch logic belongs exactly at the owner already holding
translation, channel fan-out, pacing, and cross-response serialization. It
also repairs every direct output source rather than only LLM conversation.

[codeplan · campaign63-chat-segmentation · OUT · mode: full · pick: V1 · confidence: high · beatBaseline: yes · scores: V1 0.933, V2 0.700, V3 disqualified · reason: complete ordered delivery at the existing shared transport owner · mechanism-check: passed · corrected: none]
