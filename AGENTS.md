# Local Gameplay Repair Rules

Direct implementation is authorized; working Minecraft gameplay is the primary deliverable.

- Do not invoke planning, TDD/test-first, review, verification-review, soak, or completion-audit workflows automatically.
- Do not create a plan unless the user explicitly asks for one, and do not split normal implementation into tiny slices.
- Tests are optional diagnostics, not the product. Add only focused checks that reproduce or prevent a specific observed defect.
- Do not build broad test suites, fixture systems, soak tests, verification frameworks, or review artifacts during gameplay repair.
- Do not turn theoretical risks or reviewer suggestions into requirements.
- Prefer running the real Paper server and existing Mindcraft/Mineflayer bot, observing failures, repairing the active path, and running again.
- Preserve the LLM/conversation architecture and route direct and natural-language requests through the same deterministic gameplay skills.
- Stop when the requested physical gameplay works.

## Package-first mechanics rule

- The project owns judgment: goals, target selection, permissions, safety policy, budgets, interruption, evidence, verification, recovery, and reporting.
- Mineflayer core and mature plugins own mechanics whenever they already implement them, including locomotion, jumping, swimming, path execution, combat execution, tool selection, collection, pickup, eating, armor, containers, crafting, smelting, and vehicles.
- Before writing or expanding a physical gameplay algorithm, inspect Mineflayer core APIs, installed plugins and versions, upstream documentation and issues, then established compatible Mineflayer packages.
- Prefer configuring, wrapping, adapting, or upgrading an existing package over duplicating it. Preserve ActionManager ownership, cancellation, safety, and Minecraft-state verification around the package.
- Custom raw movement, attack loops, tool ranking, collection/pickup loops, or inventory mechanics require live evidence that the installed package cannot safely perform the mechanic and that a thin adapter is insufficient.
- Never create a parallel movement, combat, collection, tool, or survival engine beside an installed plugin because one route or scenario failed.
- Do not add or upgrade dependencies without the user's explicit approval and a compatibility check.
- At meaningful checkpoints, report delegated mechanics and the evidence for every custom exception.
