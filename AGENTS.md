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
