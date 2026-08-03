# Machine Brain v2 Architecture

**Status:** active hybrid implementation, live-proven on 2026-08-03.

## Current decision

Evolve the companion from measured gameplay failures rather than replacing the working body.

Mineflayer remains the physical interface. Existing deterministic skills, `BehaviorArbiter`, `ActionManager`, and serialized physical actions remain authoritative. `GoalDirector` owns compound player outcomes that require prerequisites, recovery, continuation, and verified completion.

The stone-pickaxe architecture experiment proved that this hybrid path materially outperforms the monolithic legacy request path. A wholesale engine rebuild is not justified.

## Current milestone

- [Hybrid Goal Recovery milestone](../../research/2026-08-03-hybrid-goal-recovery-milestone.md)
- [Forward companion plan](../../plans/2026-08-03-hybrid-companion-forward-plan.md)
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
