# Machine Brain v2 Architecture

Status: architecture-only; no runtime implementation is authorized here.

## Lodestar

Evolve from measured gameplay failures rather than replacing a working bot. Mineflayer remains the physical interface. Existing deterministic skills, `BehaviorArbiter`, `ActionManager`, the shared direct/natural-language skill surface, and serialized physical actions remain authoritative until evidence passes the documented gates.

## Documents

1. [A0 diagnostic plan](A0-DIAGNOSTIC-PLAN.md) — establish reproducible failures and a frozen baseline.
2. [A0 implementation status](A0-IMPLEMENTATION-STATUS.md) — record the diagnostic foundation, remaining measurement gaps, and next authorized gate.
3. [Legacy/v2 boundary contract](BOUNDARY-CONTRACT.md) — define adapters, authority, runtime selection, and rollback.
4. [Migration gates](MIGRATION-GATES.md) — constrain what each release may introduce.
5. [Benchmark and kill criteria](BENCHMARK-KILL-CRITERIA.md) — decide advance, hold, rollback, or stop from evidence.
6. [Branch/worktree rules](WORKTREE-RULES.md) — keep architecture work isolated from the runnable checkout.

## Non-goals

This branch does not authorize a big-bang rewrite, a second physical-action executor, dependency changes, production runtime changes, or a wholesale rewrite of `src/agent/library/skills.js`. EvidenceFrame, TaskGraph, a new scheduler, a new spatial model, a procedure DSL, and concurrent physical actions are Release B+ ideas and are prohibited until measured A0 and A-lite gates explicitly justify each one.
