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

## Specialist escalation

- Codeplan is for materially different mechanisms, architecture/ownership/persistence/API/package/concurrency/lifecycle boundaries, a disproven local mechanism, or a materially expensive wrong choice. Do not invoke it for each ordinary gameplay blocker or routine continuation after a mechanism is selected.
- Center Audit is for a specific cross-owner uncertainty, an important safety/authority/state/cancellation/concurrency/persistence/false-success invariant, a repeated failure class after one ordinary repair, an ambiguous owner after targeted tracing, or an explicit Director request. One audit owns one claim and returns its result to implementation.
- A broad run finding another reproducible defect is not by itself a reason to plan or audit. Use the normal repair loop when the owner and repair are clear.

## Package-first mechanics rule

- The project owns judgment: goals, target selection, permissions, safety policy, budgets, interruption, evidence, verification, recovery, and reporting.
- Mineflayer core and mature plugins own mechanics whenever they already implement them, including locomotion, jumping, swimming, path execution, combat execution, tool selection, collection, pickup, eating, armor, containers, crafting, smelting, and vehicles.
- Before writing or expanding a physical gameplay algorithm, inspect Mineflayer core APIs, installed plugins and versions, upstream documentation and issues, then established compatible Mineflayer packages.
- Prefer configuring, wrapping, adapting, or upgrading an existing package over duplicating it. Preserve ActionManager ownership, cancellation, safety, and Minecraft-state verification around the package.
- Custom raw movement, attack loops, tool ranking, collection/pickup loops, or inventory mechanics require live evidence that the installed package cannot safely perform the mechanic and that a thin adapter is insufficient.
- Never create a parallel movement, combat, collection, tool, or survival engine beside an installed plugin because one route or scenario failed.
- Do not add or upgrade dependencies without the user's explicit approval and a compatibility check.
- At meaningful checkpoints, report delegated mechanics and the evidence for every custom exception.

### Product outcome and campaign scale

- The product is a convincing, useful Minecraft companion, not a catalogue of independently certified mechanics. Every meaningful tranche must improve a player-visible outcome or repair a cross-cutting invariant that materially threatens those outcomes.
- Preserve the current development loop: run a broad natural player scenario in the real Paper world, observe the first material blocker, repair the smallest shared seam, add only focused regression coverage for that observed defect, rerun the same broad scenario, then commit and stop.
- The default unit of work is a broad multi-stage player request or companion session. Do not invent a narrow campaign merely because another item, quantity, caller, or family can be routed through an existing capability.
- A narrow synthetic or controlled campaign is allowed only when a broad live scenario or review exposes a distinct physical failure, ownership race, false-success path, safety violation, or persistence defect. After the narrow proof, return to the broad player outcome when the changed seam could affect it.
- Once a mechanic or domain has passed physical acceptance, freeze it. Do not reopen it for noun swaps, quantity permutations, caller permutations, exhaustive family coverage, or theoretical edge certification unless new live evidence exposes a materially different failure class or the code is directly changed again.
- Capability migration, abstraction cleanup, and duplicate removal are not deliverables by themselves. Perform them only when they remove an observed blocker, eliminate a dangerous shared invariant, or are required by a broad player-valued campaign.
- Do not normalize every duplicated seam merely because it exists. Record non-blocking duplication and theoretical risks for later; prefer a deferred note over expanding the active tranche.
- Every review request must state: the player-visible outcome being improved, the new failure class that justified the slice, why the correction is shared rather than item-specific, what behavior is now frozen, and the next broad campaign. Keep this concise and do not create a new review artifact system.
- Stop when the broad physical outcome works truthfully and repeatably enough for play. Do not pursue exhaustive certification, perfect coverage, or formal completeness before returning to real gameplay.

### Campaign governor

- A single broad gameplay campaign may normally consume at most two newly exposed repair classes before checkpointing and recentering.
- After two distinct shared defects are repaired, preserve the useful progress and report the next blocker separately. Do not automatically begin a third repair or audit cycle.
- Continue immediately through a third class only when it is safety-critical, causes false success or data corruption, prevents the broad outcome from functioning at all, or the Director explicitly says to continue.
- If one mechanic has already received two repair cycles and then exposes increasingly narrow geometry, noun, fixture, permutation, or environment-specific failures, preserve the concrete remaining defect and return to another high-frequency player-valued scenario.
- Do not use that escape hatch for safety-critical defects, false success, corruption, or a mechanic that still fails in ordinary play.
