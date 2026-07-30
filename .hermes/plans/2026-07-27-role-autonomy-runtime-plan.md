# Role autonomy runtime repair

## Goal
Stop runtime role bots from being preempted by the legacy self-prompt bootstrap, and harden autonomy generation against `<think>` output rewriting crashes.

## Root cause
1. `src/agent/agent.js` auto-starts `settings.default_goal` for every non-task bot.
2. Runtime-configured library bots always carry `runtime.role` / `runtime.autonomy`, but `role_director.update()` refuses to act while `self_prompter` is active.
3. Result: balanced/role bots never enter the role lane that makes them follow, guard, regroup, patrol, or gather like players.
4. `src/models/prompter.js::_generateAutonomy()` assigns back into a `const generation` when stripping `</think>`, which can throw at runtime.

## Surgical fix
- Add a pure gate that only seeds the legacy default goal for legacy profiles without explicit `profile.runtime`.
- Keep runtime-configured bots on the role-director path.
- Add regression tests for legacy vs runtime bootstrap behavior.
- Fix the autonomy generation reassignment bug and test it.

## Validation
- Run targeted node tests for the new regressions.
- Run the focused control-plane suite slice touching agent lifecycle / command policy / state.
