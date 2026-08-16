# Benchmark and Kill Criteria

## Frozen comparison

Compare legacy and shadow/candidate on the same committed code, scenario manifest, server configuration, world/setup, timeout policy, and run-count rule. Record deviations. Use at least 20 independent runs per arm for a promotion claim; report Wilson 95% intervals for binary outcomes and p50/p95 for completion time.

Primary metrics are physical task success and unsafe outcome rate. Guardrails are deaths, destructive unintended actions, policy violations, overlapping physical actions, direct/NL parity, timeouts, retries, completion latency, and legacy fallback rate.

## Advance

Advance a single hypothesis only when all are true:

- the targeted failure improves by at least 10 percentage points absolute or 25% relative, and its 95% intervals do not overlap in the unfavorable direction;
- aggregate task success does not regress by more than 2 percentage points;
- there are zero policy bypasses and zero overlapping physical-action owners;
- unsafe outcomes and deaths do not increase;
- direct and natural-language forms still reach the same skill surface and have no material outcome divergence;
- candidate p95 completion time is no more than 10% slower unless the approved hypothesis explicitly trades latency for a measured safety gain;
- forced adapter failure and invalid selection both fall back to legacy, and rollback has been rehearsed.

## Hold

Hold when evidence is incomplete, underpowered, inconsistent, contaminated by setup drift, or diagnostic coverage is below 95%. A hold authorizes more measurement, not new architecture.

## Roll back immediately

Select legacy and stop the candidate experiment after any policy bypass, duplicate/overlapping physical execution, unbounded retry, unrecoverable adapter corruption, v2-required legacy startup, increased unsafe outcome/death, or inability to disable v2 by configuration and normal restart.

## Kill a hypothesis

Remove or archive the candidate path when two frozen benchmark cycles fail to meet advance criteria, the measured failure no longer reproduces, improvement comes from bypassing preserved boundaries, maintenance requires duplicated skills or a wholesale `skills.js` rewrite, or a simpler legacy-seam fix matches the result. Killing one hypothesis does not authorize a broader replacement.
