# Doorway/corridor follow A0 instrumentation-off campaign

This directory preserves the first complete 5-direct/5-natural-language instrumentation-off campaign. It is an honest failed aggregate: nine of ten invocations passed, and one direct invocation failed the terminal-quiescence evidence check. The original plan, result, run summary, and supervisor receipt are copied byte-for-byte and remain unchanged.

## Baseline

| Measure | Result |
|---|---:|
| Independent invocations | 10 |
| Direct | 5 |
| Deterministic natural language | 5 |
| Strict success | 9/10 (90%) |
| Direct strict success | 4/5 (80%) |
| Natural-language strict success | 5/5 (100%) |
| Complete diagnostic records | 10/10 (100%) |
| Unsafe / death / conflict / timeout | 0 / 0 / 0 / 0 |
| External retries | 0 |
| Nearest-rank elapsed p50 / p95 | 18,499 ms / 26,674 ms |

All ten invocations correlated the intended request and follow action, crossed the doorway, completed the corridor, reached the final waypoint, restored the frozen fixture, held the bot, disconnected the controlled target, and left no Java process or runtime lock. The aggregate failed closed because direct invocation 3 did not confirm terminal quiescence.

## Failure finding

The failed invocation was not a doorway or corridor miss. At the first held sample the bot was idle with no pathfinder but retained 0.04 horizontal velocity. It settled 0.09 blocks away 253 ms later and then remained at that exact position for the remaining 38 samples. The verifier currently anchors the stop position at that first held sample and requires every sample to remain within 0.05 blocks, creating a measurement-only terminal-anchor race.

[terminal-quiescence-finding.v1.json](terminal-quiescence-finding.v1.json) records the compact finding and raw-evidence hash. The original failed result is not reclassified or overwritten.

## Decision

This campaign satisfies the per-family A0 allocation shape and the 95% diagnostic-completeness gate. It does not complete A0, prove non-interference, authorize A-lite, satisfy the 20-per-arm promotion threshold, or justify broader architecture. The next bounded action is to repair only the verifier's stop anchor, rerun a fresh instrumentation-off campaign, and then compare a matched diagnostics-on arm.
