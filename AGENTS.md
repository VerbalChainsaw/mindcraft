# Local Gameplay Repair Rules

The Lodestar Golden Rules are mandatory machine-level invariants. This file may
specialize them for Minecraft, but it may never weaken, negate, bypass, or
contradict them. If this file and the Golden Rules conflict, the Golden Rules
win unless the Director explicitly overrides the specific rule.

Working Minecraft gameplay is the primary deliverable. Direct implementation is
authorized within the current task and the Golden Rules' safety boundaries.

## Non-trivial change workflow

For every non-trivial change, invoke both `codeplan` and `center-audit` before
mutation as required by the Golden Rules. Keep both bounded to the changed
contract. Do not manufacture variants, broad review, test infrastructure,
repository archaeology, or process ceremony merely to satisfy invocation.

## Earned capability stays earned

Once a gameplay capability has passed real physical acceptance, freeze the
exercised contract. Do not re-certify it merely because a higher-level mission,
architecture change, scenario, or test happens to traverse it.

A frozen capability may be reopened only when at least one of these is true:

1. source inside its owning contract changed;
2. a dependency, protocol, or contract it relies on changed; or
3. new physical runtime evidence directly contradicts the prior acceptance.

Repetition, preparation, curiosity, confidence-building, a different noun,
quantity, caller, prompt form, or higher-level scenario are not reopening
evidence.

A higher-layer end-to-end proof may traverse a frozen lower-layer capability
once when necessary to prove the changed higher-layer contract. That traversal
does not reopen or recertify the lower layer. If the lower layer fails with a
materially new failure class during that proof, record the contradictory
evidence and reopen only that affected contract.

## Gameplay verification selection

Start from the exact contract that changed or the exact new physical failure.
Run the smallest existing Paper/Mineflayer scenario that can prove or falsify
that claim. Do not treat the gameplay certification map, Scenario Lab, or any
other scenario collection as a checklist.

Run a full clean-room progression or broad certification campaign only when the
Director explicitly requests full certification or when a cross-cutting change
actually invalidates several previously accepted capability contracts. A new
mission/executive layer does not by itself invalidate collection, crafting,
furnace, smelting, delivery, traversal, or other mechanics that remain
unchanged and physically accepted.

## Repair loop

- Tests are evidence, not the product. Add or run only focused checks that
  reproduce or prevent a specific observed defect or prove the changed
  contract.
- Do not build broad test suites, fixture systems, soak tests, verification
  frameworks, or review artifacts during gameplay repair.
- Do not turn theoretical risks, noun permutations, or reviewer suggestions
  into requirements.
- Prefer the real Paper server and existing Mindcraft/Mineflayer bot when the
  changed contract requires physical proof: observe the first material new
  failure, repair the active owner, and rerun only the same necessary scenario.
- Preserve the LLM/conversation architecture and route direct and
  natural-language requests through the same deterministic gameplay skills.
- Stop when the requested physical outcome and its direct verification are
  complete. Preserve unrelated WIP and already accepted capabilities.
