# Codeplan: Truthful surface navigation

## Contract and safety
- Required behavior: `!goToSurface` must use the connected dimension bounds, attempt ordinary safe pathfinding, verify arrival, and never claim escape when the route failed.
- Acceptance criteria: loaded-column surface target is explicit; no loaded target produces a precise retryable failure; interrupted/blocked routing stays failed; success records the observed final position and support.
- Must preserve: no-dig movement policy, door cleanup, operator Stop, ActionManager results, and existing command signature.
- Out of scope: tunneling, towering, destructive escape, teleport fallback, runtime restart, and tests.

## Repository evidence
- The current implementation scans fixed y=360..-64, ignores the boolean returned by `goToPosition`, logs success unconditionally, and returns true after any attempted route.
- Installed Mineflayer exposes the connected dimension's `game.minY` and `game.height`.
- The shared movement path already returns false for interruption, no path, timeout, and unverified arrival.

## Candidates
- V1 `optimistic-fixed-column`: retain fixed bounds and unconditional success.
- V2 `dimension-aware-verified-route`: calculate bounds from live game state, identify a loaded target, require the shared route result, then verify final position/support.

## PLAN-OUT
[codeplan · truthful-surface-navigation · PLAN-OUT · mode: constrained · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.22;V2=0.96 · reason: V2 preserves the conservative no-dig policy while removing a direct false-success path in a core movement primitive · planned-fingerprint: existing-module,authoritative-bounds,structured-result,graceful-degrade]

## Implementation
- Replace fixed world limits with connected dimension bounds.
- Require a loaded solid support block with clear body space.
- Require path success and verify final vertical/horizontal proximity and support.
- Re-read changed source and run syntax/diff formatting only.

## EXEC-OUT
[codeplan · truthful-surface-navigation · EXEC-OUT · mode: constrained · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · delivered: dimension-aware-target,loaded-clearance-check,verified-route,structured-failure · evidence: installed-mineflayer-dimension-contract,changed-source-reread,syntax-check,diff-formatting · deferred: runtime-action,restart,tests]
