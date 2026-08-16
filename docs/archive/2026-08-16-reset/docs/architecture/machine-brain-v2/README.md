# Machine Brain v2 Architecture

**Status:** active hybrid implementation; original body/brain decision live-proven on 2026-08-03, strategic branch qualification live-proven in shadow mode on 2026-08-10.

## Current decision

Evolve the companion from measured gameplay failures rather than replacing the working body.

Mineflayer remains the physical interface. Existing deterministic skills, `BehaviorArbiter`, `ActionManager`, and serialized physical actions remain authoritative. `GoalDirector` owns compound player outcomes that require prerequisites, recovery, continuation, and verified completion.

The stone-pickaxe architecture experiment proved that this hybrid path materially outperforms the monolithic legacy request path. A wholesale engine rebuild is not justified.

The strategic reasoning rollout preserves that decision. BQ0 and BQ1 now
classify and fingerprint the deterministic planner frontier without calling a
model, persisting a strategy choice, or gaining execution authority. BQ2 then
observed a natural netherite-pickaxe request terminate honestly with zero
feasible methods. That is a capability gap, not a strategic branch; H1 remains
unauthorized until ordinary play exposes a repeatable unresolved frontier of
at least two materially distinct feasible methods for one unchanged completion
contract.

## Current milestone

- [Hybrid Goal Recovery milestone](../../research/2026-08-03-hybrid-goal-recovery-milestone.md)
- [Forward companion plan](../../plans/2026-08-03-hybrid-companion-forward-plan.md)
- [Strategic reasoning rollout and BQ0-BQ2 evidence](../../plans/2026-08-10-strategic-reasoning-rollout.md)
- Milestone implementation: `cd71c8d8f7f1e8b2a1f66edf0bd8612d944d8874`
- Milestone tag: `milestone-hybrid-goal-recovery-20260803`

## Operating rule

Build one useful vertical slice at a time:

1. Run a real compound request.
2. Find the first functional blocker.
3. Repair the smallest existing seam.
4. Add one focused regression when needed.
5. Prove the result in a disposable live world.
6. Commit and push.

New frameworks, schedulers, contracts, or physical executors require evidence that the current architecture cannot solve the observed problem through a bounded local repair.

A strategy selector has the additional fail-closed gate recorded in the
strategic rollout. A zero-method gap, a deterministically ranked frontier, a
mechanical defect, or incomplete evidence cannot authorize selector work.

## Historical architecture documents

The following files preserve earlier diagnostic and migration thinking. They are reference material, not authorization to restart a broad architecture program.

1. [A0 diagnostic plan](A0-DIAGNOSTIC-PLAN.md)
2. [A0 implementation status](A0-IMPLEMENTATION-STATUS.md)
3. [Legacy/v2 boundary contract](BOUNDARY-CONTRACT.md)
4. [Migration gates](MIGRATION-GATES.md)
5. [Benchmark and kill criteria](BENCHMARK-KILL-CRITERIA.md)
6. [Branch/worktree rules](WORKTREE-RULES.md)

## Non-goals

- No big-bang rewrite.
- No second physical-action executor.
- No wholesale rewrite of `src/agent/library/skills.js`.
- No architecture work that is disconnected from a current gameplay blocker.
- No claim of success without Minecraft-state verification.
