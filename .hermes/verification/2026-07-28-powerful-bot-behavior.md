# Powerful bot behavior verification

Date: 2026-07-28

## Current verdict

Source implementation and non-live integration gates pass. The ten running bots were not restarted, commanded, or otherwise touched, so activation and Minecraft-world postconditions remain intentionally unproved.

## Implemented functional slices

- Survival: action-owned eating, reserve policy, tool restoration, injury recovery, armor, beds, shelter seeking, and validated emergency construction.
- Builder: balanced material stockpiles, supported material sourcing, explicit-only construction, stable support layers, exact placement verification, recovery, and restart reconciliation.
- Miner: full pickaxe progression, torch preparation, resource/depth knowledge, real drop accounting, bounded target-scoped collection, no-dig relocation, and leader/exact-container delivery.
- Lumberjack: stone-axe progression, safe trunk collection, verified stump replanting, capacity limits, recovery, and delivery.
- Presence: factual event normalization, nearby environmental observation, natural bounded reactions, gestures, personality rendering fallback, squad deduplication, memory filtering, radio, and dashboard telemetry.
- Operator wiring: direct resumable job commands, role-aware natural-language assignment, cancellation, profile controls, and preserved Stop/manual-action priority.

## Automated evidence

| Gate | Result |
| --- | --- |
| `npm run check:behavior` | PASS: 66 tests, behavior lint, syntax |
| `npm run check:control-plane` | PASS: 200 tests, control-plane lint, syntax |
| `npm run test:repair` | PASS: 5 regressions |
| `git diff --check` | PASS |
| Simulated ten-bot thirty-minute reaction/ownership soak | PASS inside behavior suite |

## Live gates still required

These are pending explicit authorization because they mutate or restart the active runtime:

1. activate the new source in a controlled bot process;
2. prove hunger/eating/tool restoration, injury recovery, sleep, and shelter in Minecraft;
3. prove Builder stockpile and an explicit blueprint, including restart/resume;
4. prove Miner quota/tool/light/depth/delivery and unrelated-route-block preservation;
5. prove Lumberjack tool/harvest/replant/delivery;
6. prove Stop/manual ownership across every phase;
7. run the controlled multi-bot reaction and sustained live soak;
8. stop only test-created bots and record cleanup.

No live pass is claimed until those postconditions are observed from authoritative bot/Minecraft state.
