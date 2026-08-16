# Migration Gates

No phase is authorized merely because it appears here. Each transition requires committed benchmark evidence and a written decision naming the measured failure, selected seam, rollback, and scope.

## A0 — diagnostics only

Allowed: frozen scenarios, passive telemetry, run artifacts, failure taxonomy, and baseline analysis.

Forbidden: behavior changes, new planning models, new action paths, dependency changes, and v2 physical execution.

Exit: all A0 evidence requirements pass.

## A-lite — one reversible hypothesis

Allowed: boundary schemas/adapters, startup-time `legacy`/`shadow` selection, and one shadow evaluator or minimal candidate change tied to the dominant A0 failure.

Required: legacy remains default; shadow has no physical authority; direct/NL parity, arbiter ownership, ActionManager serialization, and rollback are demonstrated.

Forbidden: EvidenceFrame, TaskGraph, a replacement scheduler, a new spatial model, a procedure DSL, concurrent physical actions, duplicated skills, or wholesale `skills.js` work.

Exit: benchmark advance criteria pass and the hypothesis is supported. Otherwise hold, revise within A-lite, or kill it.

## Release B+ — individually justified capabilities

EvidenceFrame, TaskGraph, scheduler changes, spatial modeling, procedure DSL, and any concurrency are separate proposals, not a bundle or roadmap entitlement. Every capability remains prohibited until both A0 and A-lite are complete and its own proposal demonstrates:

1. a measured residual failure that A-lite cannot address at an existing seam;
2. a simpler rejected alternative and why evidence rejects it;
3. a versioned boundary and anti-corruption adapter;
4. no bypass of deterministic skills, `BehaviorArbiter`, or `ActionManager`;
5. benchmark thresholds, safety invariants, kill criteria, and configuration-only rollback;
6. a small implementation slice that does not rewrite `skills.js` wholesale.

Concurrency is additionally barred from physical actions. Any future non-physical concurrency proposal must prove deterministic cancellation and must still serialize every bot action through ActionManager.

## Promotion record

A promotion decision records scenario manifest revision, baseline and candidate artifact paths, sample counts, confidence intervals, safety results, rollback rehearsal, approved capability, approver, and date. Missing evidence means no promotion.
