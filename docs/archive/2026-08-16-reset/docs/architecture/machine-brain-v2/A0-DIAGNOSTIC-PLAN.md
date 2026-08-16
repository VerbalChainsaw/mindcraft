# A0 Diagnostic Plan

## Purpose

A0 measures real failures before selecting architecture. It may add narrowly scoped diagnostics in a later, separately authorized implementation slice; it does not change decision or action behavior.

## Preserved baseline

Keep Mineflayer, deterministic skills, `BehaviorArbiter`, `ActionManager`, direct and natural-language routing into the same skill surface, and serialized physical actions unchanged. Run the legacy runtime only. Do not launch a v2 executor.

## Method

1. Freeze a scenario manifest before comparison: command text, world/setup, seed where controllable, start inventory/state, timeout, expected physical outcome, and safety invariants.
2. Reproduce observed failures through the real Paper/Mineflayer path. Include direct and natural-language forms of the same intent.
3. Record an event timeline with correlation ID, selected skill, arbiter owner/priority, ActionManager acquisition/release, preconditions, observations used, physical action attempts, interruption/cancellation, result, elapsed time, and terminal reason.
4. Classify only demonstrated failures: routing, stale/missing evidence, skill precondition, arbitration, action serialization, navigation/spatial assumption, recovery, or external/environmental.
5. Preserve raw run artifacts and summarize success rate, unsafe outcomes, conflicts, latency, retries, and dominant terminal reasons. Never relabel a timeout or death as success.
6. Freeze the A0 baseline and failure taxonomy before proposing A-lite.

## A0 exit evidence

A0 is complete only when all of the following exist:

- at least three reproducible scenario families, or a written finding that fewer failures reproduce;
- at least 10 independent runs per reproduced family, split across direct and natural-language requests where both apply;
- complete diagnostic records for at least 95% of runs;
- a baseline table with success, unsafe outcome, conflict, timeout, and p50/p95 completion time;
- at least one dominant failure class supported by traces, not intuition;
- a minimal hypothesis that maps that class to an existing seam or one proposed anti-corruption adapter.

If instrumentation changes outcomes materially, A0 is invalid and must be rerun with passive diagnostics.

## A-lite proposal limit

A-lite may propose only the smallest reversible adapter or shadow evaluator needed to test the dominant A0 hypothesis. It may not introduce EvidenceFrame, TaskGraph, a new scheduler, a new spatial model, a procedure DSL, or physical-action concurrency.
