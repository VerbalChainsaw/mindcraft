# Gameplay skill knowledge fallback plan

[codeplan · skill-knowledge-fallback · PLAN-OUT · mode: full · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.95;V2=0.74;V3=disqualified · reason: make the existing embedding ranker all-or-fallback and deterministic, preserving every skill doc without adding a retrieval service]

## Candidates

- V1 `all-or-lexical-fallback` (`all-settled-init`, `query-catch`, `stable-ranking`, `zero-dep`): retain embeddings only when all valid; otherwise select from the complete skill corpus with word-overlap ranking and always-visible core skills.
- V2 `persistent-vector-cache` (`filesystem-cache`, `cache-invalidation`, `new-format`): retain prior embeddings across outages. Potentially faster but adds cache trust/invalidation and data-path complexity.
- V3 `provider-retry-loop` (`network-retry`, `latency`, `provider-coupling`): retry embeddings during every prompt. Disqualified: blocks the agent loop and still cannot guarantee usable docs offline.

- V1=48/50=0.95 for gameplay continuity, compatibility, scope, and failure truth; V2=37/50=0.74; V3=disqualified.

## Ordered changes

1. Treat initialization as all-valid embeddings or clean lexical fallback—never a partial corpus.
2. Catch runtime embedding failures and use the complete corpus with stable lexical ranking for that and later requests.
3. Normalize selection bounds and retain the existing always-visible safe core docs.
4. Run focused syntax/static checks only; no provider request or broad suite.

[codeplan · skill-knowledge-fallback · EXEC-OUT · implemented: V1 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: partial embedding maps cannot hide docs and a later query outage becomes lexical fallback rather than prompt failure · evidence: focused Node syntax and scoped diff/whitespace checks passed; no provider request or broad suite ran]
