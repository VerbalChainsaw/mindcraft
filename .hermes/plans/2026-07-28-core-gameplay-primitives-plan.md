# Codeplan: Truthful core gameplay primitives

## Contract and safety
- Required behavior: the single companion can move, gather, mine, craft, smelt, build, fight, survive immediate hazards, and interact through the existing command/action/skill stack without reporting an unverified world change as success.
- Acceptance criteria: moving targets are followed and re-verified; protected blocks are never cleared by generic break/build paths; downward digging refuses unloaded, liquid, falling-block, unsupported, or long-fall cells and verifies every descent; drowning, falling, and burning reflexes are bounded and postcondition-checked; legacy NPC wrappers return actual skill truth; furnace and villager interactions close their windows and report observed results.
- Must preserve: ActionManager as the sole ownership/result boundary, current commands, safe pathfinder movements, durable job directors, existing inventory/tool preflight, concurrent dirty work, Stop, and provider-neutral behavior.
- Out of scope: activity templates, behavior-tree replacement, squads, pets, UI, server/provider changes, runtime activation, and tests prohibited by the handoff.
- Workspace/user work: heavily present and protected. No reset, cleanup, broad formatting, or rollback.

## Repository evidence
- `goToNearestEntity()` snapshots an entity position and can report arrival after that entity moves or disappears.
- `breakBlockAt()` has tool/reach/postcondition checks but no protected-block guard; `placeBlock()` can therefore clear protected obstructions through it.
- `digDown()` reports unloaded world edges as success, skips air without validating a landing, and never verifies that the bot descended safely after a dig.
- self-preservation only holds jump when no path exists, has no bounded falling response, and passes `water_bucket` where the placement skill expects the world block name `water`.
- `BuildGoal`, `ItemGoal`, and two NPC controller callbacks await skills without returning their booleans; `BuildGoal.wrapSkill()` treats every non-interrupted action as success and can clear arbitrary mismatched structure blocks.
- furnace and villager helpers resolve API calls without complete cleanup/evidence or inventory-delta verification.

## Candidates
- V1 `existing-boundary-hardening`: keep boolean skill results plus `lastActionEvidence`; centralize only shared block-safety predicates and patch the affected movement, descent, reflex, interaction, and NPC call paths.
- V2 `native-structured-skill-results`: migrate core skills to return structured action results directly and add ActionManager compatibility normalization for every legacy caller.

## Paper gates
- V1: pass - preserves the established ActionManager contract and limits edits to observed false-success/safety seams.
- V2: pass - could improve the long-term type boundary, but requires a broad caller migration that cannot be behavior-tested under this handoff.

## IN
[codeplan · core-gameplay-primitives · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=existing-boundary-hardening/shared-safety,verified-postconditions,truthful-callbacks;V2=native-structured-skill-results/result-migration,compatibility-adapter · lean: V1 · conservative: V1]

## Frozen rubric and scoring
- freeze: axes=fit,world-truth,regression-risk,source-verifiability,effort classes=quality,quality,risk,risk,convenience weights=3,2,3,2,1 denominator=55 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer
- scores: V1=0.85; V2=0.60. Arithmetic: V1=(5*3 + 4*2 + 4*3 + 4*2 + 4*1)/55=47/55; V2=(4*3 + 5*2 + 2*3 + 2*2 + 1*1)/55=33/55.

## PLAN-OUT
[codeplan · core-gameplay-primitives · PLAN-OUT · mode: constrained · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1=0.85;V2=0.60 · reason: focused hardening closes the observed false-success and safety gaps while retaining the only result/ownership boundary that the rest of the runtime already understands · planned-fingerprint: shared-block-safety,moving-target-verification,safe-descent,bounded-survival,truthful-npc-callbacks,verified-interactions]

## Implementation
- Add a dependency-light gameplay-safety module and use its protected/replaceable/hazard/falling predicates in generic skills and the durable builder audit.
- Harden coordinate/block/entity movement, generic breaking, and downward descent with exact evidence and postconditions.
- Add bounded drowning, falling, and burning skills; route self-preservation through them using observed oxygen/physics/block state.
- Preserve skill booleans through legacy NPC action callbacks and refuse destructive legacy blueprint clearing outside replaceable cells.
- Close furnace/villager windows in `finally` and verify trade inventory deltas.
- Re-read every changed path and run only focused `node --check` and `git diff --check`.

## EXEC-OUT
[codeplan · core-gameplay-primitives · EXEC-OUT · implemented: V1 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: shared protected-block safety, moving-target verification, bounded safe descent, drowning/fall/fire reflexes, truthful legacy NPC callbacks, and verified furnace/villager results · evidence: focused node --check and git diff --check passed for every changed runtime source; Minecraft, provider, server, dashboard, and behavioral execution remain deferred by instruction]
