# Agent attention, reflex, and dialogue truth plan

[codeplan · agent-attention-reflex-dialogue · PLAN-OUT · mode: full · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.94;V2=0.78;V3=disqualified · reason: strengthen the existing self-prompt, mode, and directive contracts without introducing a second behavior scheduler or replacing Mineflayer control flow]

## Defects to correct

- A self-prompted bot can count a failed action as productive work, reset its no-progress budget after a loop restart, or retain an active-looking state after an operator hold/load boundary.
- Reflex wrappers resolve successfully even when their underlying movement, escape, combat, or recovery skill returns `false`; the action result and narration can therefore claim a recovery that never happened.
- A natural-language player directive such as “follow me” does not consistently release the explicit Stop hold, while reports should remain safe to request without moving the bot.

## Selected implementation

1. Make `SelfPrompter` lifecycle state reliable: structured start result, operator-hold-safe load/start, awaited stop/pause cleanup, persistent no-progress budget, terminal failure stop, and exception-safe loop cleanup.
2. Preserve return values through mode execution, treat a false unstuck movement as a failed recovery, and impose a short retry backoff after a verified reflex failure.
3. Add a bounded `guardPlayer` command built on the existing follow and self-defense mechanics, and expand player directives with explicit hold-release metadata for real movement/goal orders only.
4. Keep reporting/query directives observational so an operator-held bot can still explain status without silently resuming.

## Boundaries

- No new behavior-tree framework, no live-server restart, no profile/UI ownership changes, and no broad test sweep.
- Preserve manual Stop: only a new explicit movement, guard, work, or goal directive can release it; reflexes remain restricted to immediate self-preservation while held.
- All action outcomes continue through the existing structured action-result contract.

## Candidate comparison

- V1 `boundary-hardening` (`self-prompt-budget`, `return-propagation`, `directive-metadata`, `bounded-backoff`): repair existing loop/mode/directive seams and keep Mineflayer ownership unchanged.
- V2 `behavior-coordinator` (`new-scheduler`, `cross-mode-state`, `migration`): centralize attention and reflex decisions in a new runtime service. More unified but too broad to validate without moving all current mode behavior.
- V3 `behavior-tree-rewrite` (`new-framework`, `world-model`, `full-migration`): replace self-prompt/modes with a behavior tree. Disqualified: this would alter core gameplay control and requires a live proving matrix not authorized in this slice.

- V1=47/50=0.94 for behavior truth, stop safety, compatibility, and scope; V2=39/50=0.78; V3=disqualified. V1 is both the conservative baseline and selected implementation.

[codeplan · agent-attention-reflex-dialogue · EXEC-OUT · implemented: V1 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: failed movement no longer reads as unstuck progress; self-prompt stop/pause avoids self-loop deadlock; read-only questions no longer release operator hold · evidence: focused Node syntax and scoped diff/whitespace checks passed; no live bot action, restart, or broad suite ran]
