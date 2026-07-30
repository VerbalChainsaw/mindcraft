# Codeplan: Player-requested shelter work order

## Contract and safety
- Required behavior: “build a shelter” must become one durable, verified job for the single bot instead of conversation or disconnected one-block commands.
- Acceptance criteria: an explicit player request creates a bounded 3x3 shelter work order at loaded local coordinates; materials are survival-acquired; every placement is re-audited; obstruction, liquid, occupancy, support, inventory, and Stop failures remain exact.
- Must preserve: explicit construction authorization, no destructive clearing, no creative provisioning, one-active-order arbitration, and the emergency-survival ownership path.
- Out of scope: arbitrary generated blueprints, large structures, squads, UI, runtime restart, and broad tests.

## Repository evidence
- `nextBuilderStep()` already implements acquire, place, verify, recovery, and completion for `source: player` build orders.
- `auditBlueprint()` already rejects unloaded, liquid, protected, occupied, unsupported, obstructed, and trapped work sites.
- No player command or natural-language directive currently creates such an order; construction is reachable only from benchmark task data or emergency survival.

## Candidates
- V1 `model-placement-loop`: rely on repeated `!placeBlockAt` generation. This loses durable progress, material planning, and authoritative completion.
- V2 `fixed-safe-blueprint`: expose one validated local shelter blueprint through the existing work-order pipeline.

## PLAN-OUT
[codeplan · player-shelter-work-order · PLAN-OUT · mode: constrained · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.46;V2=0.89 · reason: the existing builder pipeline already provides the required safety and verification; the missing piece is a bounded player-authorized order constructor and command route · planned-fingerprint: existing-module,request-driven,persistent-state,structured-result]

## Implementation
- Derive a zero-based 3x3 player shelter blueprint from the already validated emergency geometry.
- Anchor it around the spawned bot so all cells begin loaded and the doorway remains the escape path.
- Add one persistent assignment command and one narrow natural-language directive.
- Re-read changed contracts and run source diff formatting only.

## EXEC-OUT
[codeplan · player-shelter-work-order · EXEC-OUT · implemented: V2 · confidence: high · verification: source-only · mechanism-check: passed · plan-history: unchanged · evidence: inspected fixed geometry, normalized footprint, audit, reducer, command, directive, and Stop ownership; focused diff formatting passed; runtime intentionally not started]
