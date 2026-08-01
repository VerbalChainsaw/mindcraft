# COM-001 obstructed-combat blocker

## Outcome

Core scenario 6 is not complete. Clear-hostile handling is physically reliable, but the obstructed-hostile case did not pass three consecutive resets. The final bounded mechanism passed two obstructed resets and failed the next, activating the overnight goal's three-surgical-navigation-repair stop condition.

The bot is therefore not declared playable. No arbiter authority or alternate architecture was added.

## Controlled fixture

- Bot start: `(1111.5,100,1057.5)`
- Tagged, silent, persistent, `NoAI` zombie: `(1117.5,100,1057.5)`
- Obstructing wall: `x=1114`, `y=100..102`, `z=1054..1060`
- Open wall ends: `z=1053` and `z=1061`
- Restored supported floor: red concrete at `y=99`, with independently checked critical cells
- Command: `!resolveTacticalCombat(8)`
- Independent proof: Paper `damage_dealt`, `killed:zombie`, tagged-target health/presence, bot health/position, wall/gap/floor markers

The verifier removes other hostile types and dropped items inside the bounded certification course, provisions only the reset state, and never moves, damages, or kills the measured target after command issue.

## Confirmed trajectory

The clear case passed every post-repair measurement with Paper-attributed damage `0→200`, kill count `0→1`, target removal, linked player-owned decisions, and held cleanup.

Obstructed successful runs:

- Target begins recognized as hostile with `visible:false`.
- Pathfinder reaches approximately `(1114.97,100,1061.30)` and visibility changes to true.
- One evidence-gated tactical approach replan runs from the newly exposed geometry.
- Bot reaches approximately `(1116.58,100,1059.64)`, deals attributed damage `0→200`, and records kill `0→1`.
- Measured durations: 14,926 ms and 15,531 ms.

Final failing reset:

- Threat identity and tactical melee choice remain correct.
- The player-owned action retains arbitration; there is no preemption.
- Pathfinder moves from the reset point to `(1113.70,100,1060.67)` and stops after three seconds without further physical progress.
- The zombie remains `visible:false`, health 20, damage `0→0`, kills `0→0`.
- Stop and cleanup succeed; the bot is held, idle, command-autonomy, and returned to `(1071.5,100,1007.5)`.

## Mechanisms tried

1. Replace combat-specific `GoalFollow` with a bounded `GoalCompositeAny` of supported, two-block-clear, prospective-line-of-sight melee cells.
2. Prefer the candidate tier with the strongest supported neighbour clearance so Pathfinder is not asked to finish in a wall-hugging cell.
3. Replan only when new evidence justifies it: target movement, or physical route progress that changes line of sight from false to true. A repeated static visible stall is not retried.

The third mechanism explains and enables the successful runs, but it cannot recover when the path executor stalls before crossing far enough to acquire line of sight. More arbitration, scheduling, generic retries, or longer timeouts would conceal rather than repair that boundary.

## Runnable reproduction

With Paper and `MindcraftBot` already world-ready, held, and using session autonomy `command`:

```powershell
node tools/verify-combat-field.mjs --url "http://[::1]:8080" --bot MindcraftBot --attempts 3 --evidence docs/verification/2026-08-01-overnight/com-001-next-run.json --authorized-active-world
```

Never substitute `127.0.0.1:8080`; that address belongs to an unrelated tunnel client in this environment.

## Best next action

Inspect the actual Mineflayer Pathfinder node/control sequence at the wall-end turn and compare the passing versus failing endpoints before editing. Determine whether the executor is cutting the `(1114,1060)` collision corner, losing its next node/control state, or rejecting the target-side segment. Repair that immediate execution contract or use one evidence-proven clearance waypoint inside the existing navigation owner. Do not add another scheduler, planner, arbiter lane, or blind retry.

The experimental `src/agent/library/skills.js` change and `tests/tactical-melee-stance.test.js` are intentionally not ready to commit: they demonstrate a viable partial mechanism but failed the required consecutive live gate.
