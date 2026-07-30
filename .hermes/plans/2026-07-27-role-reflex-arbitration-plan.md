# Role reflex arbitration plan

[codeplan · role-reflex-arbitration · PLAN-OUT · mode: full · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.91;V2=0.74;V3=disqualified · reason: a small scheduling gate makes Defender, Attacker, and an explicit Guard order truthful without changing command ownership or adding an unproven combat framework]

## Candidates

- V1 `role-aware-reflex-gate` (`narrow`, `telemetry`, `additive`): suppress the generic flee reflex for Defender/Attacker roles and while an explicit guard order is active; preserve self-preservation and every explicit user mode choice.
- V2 `global-mode-reorder` (`broad`, `implicit`): place combat before fleeing for every profile. Rejected because it changes legacy companion survival behavior.
- V3 `combat-behavior-tree` (`new-framework`, `stateful`, `migration`): replace reflex scheduling. Disqualified because it needs a live playbook and crosses the runtime lane boundary.

## Ordered changes

1. Centralize mode-suppression reasons so scheduling and telemetry cannot drift.
2. Give Defender/Attacker and active `guardPlayer` a combat-priority exception over generic cowardice only; immediate self-preservation remains first.
3. Expose the exact suppression reason so the dashboard can distinguish disabled, held, command-only, and role-prioritized modes.
4. Perform only source/diff inspection after the patch; do not start a bot or server.
