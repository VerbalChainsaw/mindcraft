# Codeplan: Role resource-search recovery

## Contract
- Required behavior: autonomous Builder, Lumberjack, and Miner roles must not become permanently idle only because their resource is absent from the immediate collection radius.
- Preserve: operator Stop, direct-command grace, bounded safe pathfinding, tool/inventory blockers, structured action truth, role/persona settings.
- Live evidence: Plumb is online with role `builder`, but its verified result is `skill_not_collected` after finding no birch logs. The RoleDirector waits 60 seconds and repeats the same local collection attempt without relocating.

## Candidates
- V1 `existing-role-director,bounded-search-phase,verified-movement`: add a bounded search/retry phase to the existing RoleDirector. Work roles relocate through the verified coordinate movement command, rescan, and stop searching after the profile recovery budget.
- V2 `new-behavior-tree,resource-blackboard,path-planner`: introduce a dedicated job behavior tree with persistent resource maps.

## Decision
[codeplan · role-resource-search · PLAN-OUT · mode: constrained · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: baseline-wins · reason: the existing scheduler already owns autonomous role work and structured results; a bounded search phase fixes the observed no-progress loop without a competing behavior engine · planned-fingerprint: role-director,search-phase,recovery-budget,verified-movement]

## Evidence gate
- Activate through the requested source-console restart and inspect the existing Director telemetry. No broad test sweep or synthetic gameplay commands.

## Implementation note
- The existing activity projection previously reduced every waiting state to “Role initializing” and every recovery state to “Stopped.” The runtime and Director readouts now preserve role phase, code, and bounded target so the operator can distinguish active work, resource search, relocation, cooldown, and a real blocker.

## Execution evidence
[codeplan · role-resource-search · EXEC-OUT · status: implemented-and-activated · evidence: live Director reported builder/recovering/searching_for_resources with target nearby tree cover, then builder/waiting/resource_search_exhausted after the bounded retry budget · limits: no broad regression sweep or synthetic gameplay command]

## Follow-up activation
- The initial relocation distance overlapped the underlying 64-block collection scan.
- A fixed distant-coordinate correction exposed unreachable projected terrain, and an extended synchronous resource lookup exposed telemetry starvation.
- The active implementation now aligns wood safety predicates, preserves `not_collected` evidence, moves through terrain-aware bounded search, and rescans at the normal skill radius.
- Live Director proof: `action:moveAway`, `builder · acting · resource search`, current telemetry, position changing from `x -151.5` to `x -156.7`, Java reachable, and five bots in game.
