# Doorway/corridor follow A0 repaired instrumentation-off campaign

This directory preserves the fresh 5-direct/5-natural-language instrumentation-off campaign run after repairing the verifier's terminal stability anchor. All ten invocations passed. The source plan, result, run summary, campaign analysis, and supervisor receipt are copied byte-for-byte and hash-linked by the analysis.

The original 9/10 campaign remains unchanged in the sibling `doorway-corridor-follow-a0-off-20260803` directory. Its failed invocation is not reclassified.

## Baseline

| Measure | Result |
|---|---:|
| Independent invocations | 10 |
| Direct | 5 |
| Deterministic natural language | 5 |
| Strict success | 10/10 (100%) |
| Direct strict success | 5/5 (100%) |
| Natural-language strict success | 5/5 (100%) |
| Complete diagnostic records | 10/10 (100%) |
| Unsafe / death / conflict / timeout | 0 / 0 / 0 / 0 |
| External retries | 0 |
| Nearest-rank elapsed p50 / p95 | 19,733 ms / 27,382 ms |
| Direct elapsed p50 / p95 | 19,663 ms / 22,037 ms |
| Natural-language elapsed p50 / p95 | 20,093 ms / 27,382 ms |

Every invocation correlated the intended request and follow action, crossed the doorway, completed the corridor, reached the final waypoint, confirmed terminal quiescence, restored the fixture, held the bot, disconnected the controlled target, and completed without a safety violation.

## Verifier repair exercised

The verifier now waits for horizontal velocity at or below 0.01 before anchoring the ten-second terminal stability window. Nine invocations were already settled when the anchor was selected. Natural-language invocation 1 required an additional 211 ms, then recorded 40 stable samples with zero displacement, zero horizontal velocity, no pathfinder, and held/idle state throughout. This confirms the repaired settling path executed in the live campaign.

No gameplay, follow-controller, pathfinding, routing, or cognitive behavior was changed by this repair.

## Decision

This campaign satisfies the allocation and diagnostic-completeness requirements for one instrumentation-off scenario family. It does not complete A0, prove diagnostics non-interference, provide cross-seed evidence, authorize A-lite, satisfy the 20-per-arm promotion threshold, or justify broader architecture work. The next bounded action is to verify that the declared diagnostics-on arm changes real runtime instrumentation, then run a matched 5+5 comparison if it does.
