# Codeplan: Adaptive agent telemetry timeout

## Contract
- Required behavior: the dashboard must retain or obtain authoritative bot state while several active bots are busy; a missed refresh may mark data stale but must not erase the operator readout.
- Preserve: bounded requests, concurrency control, failure backoff, duplicate suppression, last-good-state cache, configurable steady-state cadence.
- Live evidence: five bots are in game, but every initial `get-full-state` request exceeds the configured 1.2-second timeout. With no first good sample, Director can show only `state request timeout`.

## Candidates
- V1 `adaptive-timeout,cold-start-budget,learned-latency,last-good-cache`: retain the configured timeout as the steady-state floor, allow a larger bounded cold-start request, learn successful response duration, and expand the next request only after failures.
- V2 `raise-global-config,static-5s`: replace every configured timeout with a larger fixed value.

## Decision
[codeplan · adaptive-agent-telemetry · PLAN-OUT · mode: constrained · profile: compact · pick: V1 · baseline: V2 · confidence: high · beatBaseline: yes · reason: adaptive budgeting obtains the first sample and follows measured agent latency without permanently slowing healthy bots or discarding operator configuration · planned-fingerprint: cold-start-budget,learned-latency,failure-expansion,last-good-cache]

## Evidence gate
- Activate through the source-console restart and inspect Director telemetry. No broad regression sweep or synthetic state test.

## Execution evidence
[codeplan · adaptive-agent-telemetry · EXEC-OUT · status: implemented-and-activated · evidence: five active agents established current samples after restart, the full telemetry cycle completed in approximately 72 ms, and the pump reported zero failed cycles · limits: no broad regression sweep or synthetic state test]
