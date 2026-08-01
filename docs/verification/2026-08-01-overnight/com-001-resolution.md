# COM-001 obstructed-combat resolution

## Confirmed defect

Pathfinder planned the wall-end transition `(1113.5,100,1060.5)→(1114.5,100,1061.5)` as one diagonal. Its graph accepted that move because the z-side corridor was clear even though the x-side feet/head corridor contained the wall. The executor then aimed directly at the diagonal node with forward and sprint asserted, so the bot's collision box stopped near `(1113.7,100,1060.7)`.

The bounded control trace in `com-001-path-execution-trace.json` proves that threat recognition, the melee decision, player action ownership, Pathfinder path generation, and movement controls were active. Recovery succeeded only after replanning introduced cardinal clearance nodes. This located the defect at the graph-to-executor movement contract, not arbitration.

## Repair

`safeMovements` now guards diagonal neighbor generation with the executor's two-block-high body corridor. Both orthogonal sides must be open before the diagonal is admitted. When one side is blocked, the cardinal moves remain available and A* produces the executable two-segment route. Open-space diagonals are preserved.

The deterministic melee skill also approaches supported, hazard-free cells with prospective line of sight and verifies actual reach plus current line of sight before attacking. Replanning remains bounded to target movement or a hidden-to-visible geometry transition.

No arbiter ordering, authority, planner, scheduler, provider, timeout, or dependency changed.

## Live proof

The traced repair build passed three clear and three obstructed resets. Obstructed paths resolved on their first navigation attempt, contained cardinal wall clearance, and completed in 4962/4918/4995 ms with no stall reset.

After removing the temporary gameplay trace hooks and reloading the exact production code, a second independent run passed:

- Clear: 3/3 in 3886/3949/3909 ms.
- Obstructed: 3/3 in 4995/4975/4965 ms.
- Paper-attributed damage: `0→200` on every case.
- Paper-attributed kills: `0→1` on every case.
- Obstructed targets began recognized with `visible:false`.
- Every action linked to a player decision.
- Stop quiescence: 2–11 ms across all six cases.
- Cleanup: bot held at `(1071.5,100,1007.5)`, session autonomy `command`, tagged targets removed, temporary wall removed.

Evidence: `com-001-path-execution-trace.json`, `com-001-live-corner-guard.json`, and `com-001-live-final.json`.
