[codeplan · floodgate-authoritative-player-lookup · IN · mode: constrained · confidence: high · candidates: V1 agent-context canonical-substitution, V2 server exact-then-prefix fallback · lean: V2 · baseline: V2]

## Decision

The loaded Mineflayer resolver already gives exact Java identities precedence
and uses a leading-dot Floodgate alias only when no exact entity exists. The
authoritative Paper position boundary must preserve the same contract when the
player is outside entity range.

### V1 — agent-context canonical-substitution (`caller-rewrite`, `instance-state`)

Replace the requested name with CompanionContext's remembered canonical name
before requesting Paper state.

G: fail — stale companion memory can silently replace a newly named destination,
violating explicit identity binding.

### V2 — server exact-then-prefix fallback (`boundary-sequence`, `local-only`)

Inside the existing serialized Paper lookup, query the explicit name first. If
and only if Paper proves it absent and the name is not already dot-prefixed,
query the dot-prefixed Floodgate alias. Return the canonical name actually
observed.

G: pass — preserves exact Java precedence, explicit dot names, serialization,
and the current API while matching loaded-entity resolution.

Rubric frozen: axes [Identity fidelity, Authority placement, Resolver parity,
Testability, Blast radius] · weights [4,3,3,2,1] · denominator = 65 ·
denominator-policy [uniform] · baseline-algo [lowest-effort gate-passer]

freeze: axes=Identity_fidelity,Authority_placement,Resolver_parity,Testability,Blast_radius weights=4,3,3,2,1 denom=65 baseline=lowest-effort-gate-passer

V2 scores [5,5,5,5,5] = 65/65 = 1.000. V1 is not scored after failing the
non-compensatory explicit-identity gate.

Allowed scope: `ManagedMinecraftServer.locatePlayerPosition` and its existing
focused managed-server test. Forbidden scope: model prompts, player speech,
CompanionContext identity replacement, movement, and dependencies.

[codeplan · floodgate-authoritative-player-lookup · OUT · mode: constrained · pick: V2 · confidence: high · beatBaseline: baseline-wins · scores: V1 disqualified, V2 1.000 · reason: exact-then-prefix at Paper is the only candidate that preserves explicit identity precedence without stale-context substitution · mechanism-check: passed · corrected: none]
