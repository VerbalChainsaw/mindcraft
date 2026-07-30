# Codeplan: Autonomy gameplay context

## Contract and safety
- Required behavior: every autonomous turn knows its current goal, body/world state, inventory, character priorities, and valid commands, and can inspect unfamiliar registry objects before composing an action.
- Acceptance criteria: autonomy receives resolved live placeholders and compact valid command signatures; retry guidance names real commands with parser-valid syntax; no dead prompt text implies context that was never supplied.
- Must preserve: provider-neutral prompting, bounded prompt turns, one command per turn, profile customization, blocked commands, memory, truthful action results, and small-model prompt efficiency.
- Out of scope: provider redesign, behavior-tree templates, UI, runtime restart, and broad tests.

## Repository evidence
- the inherited default autonomy prompt contains literal `__STATS__ __INVENTORY__`, which `replaceStrings()` never resolves.
- it contains no `$PERSONA`, `$SELF_PROMPT`, `$MEMORY`, or `$COMMAND_DOCS`.
- `SelfPrompter` constructs a detailed goal instruction in a local variable but never sends it to `promptAutonomy()`.
- autonomy retry text recommends nonexistent `!explore` and invalid single-quoted/nonexistent collection syntax.

## Candidates
- V1 `larger-role-templates`: write a separate autonomy prompt per job/activity. This repeats knowledge and preserves missing live context.
- V2 `provider-neutral-context-envelope`: normalize legacy placeholders, append any missing live context once, use all valid commands in compact form, and state a general observe/preflight/act/verify/adapt discipline.

## PLAN-OUT
[codeplan · autonomy-gameplay-context · PLAN-OUT · mode: constrained · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.49;V2=0.96 · reason: a live provider-neutral context envelope gives every model the same game state and composable capability set without per-activity templates or a wasteful full documentation prompt · planned-fingerprint: existing-module,request-driven,bounded-context,graceful-degrade]

## Implementation
- Add compact command documentation that preserves every unblocked command signature and a bounded description.
- Normalize legacy autonomy placeholders and append missing persona, goal, memory, awareness, inventory, and command context.
- Add general gameplay operating rules centered on authoritative registry inspection and verified composition.
- Remove the unused self-prompt message and replace invalid retry examples with real commands.
- Re-read changed contracts and run source diff formatting only.

## EXEC-OUT
[codeplan · autonomy-gameplay-context · EXEC-OUT · implemented: V2 · confidence: high · verification: source-only · mechanism-check: passed · plan-history: unchanged · evidence: inspected profile inheritance, legacy markers, prompt replacement, compact command filtering, SelfPrompter caller, parser syntax, and retry loop; focused diff formatting passed; runtime and providers intentionally not started]
