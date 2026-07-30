# Runtime autonomy and role activation plan

[codeplan · runtime-autonomy-role-activation · PLAN-OUT · mode: full · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.90;V2=0.77;V3=disqualified · reason: activate the existing bounded profile configuration at its prompt/mode/telemetry seams without adding an unverified role behavior engine]

## Candidates

- V1 `policy-seam-activation` (`mode-gate`, `prompt-focus`, `telemetry`, `additive`): command autonomy suppresses non-survival modes; role focus guides wording/planning and is visible in state.
- V2 `role-policy-engine` (`policy-matrix`, `action-interceptor`, `migration`): regulate every command/mode by role. Stronger but risks blocking valid explicit player commands and needs broad behavior proof.
- V3 `role-behavior-tree` (`new-framework`, `role-nodes`, `world-model`): wholly replace current modes. Disqualified because it changes control ownership and conflicts with the surgical runtime lane.

- V1=45/50=0.90 for config truth, stop/survival safety, compatibility, and scope; V2=38/50=0.77; V3=disqualified.

## Ordered changes

1. Surface role focus in the character prompt and structured state.
2. Honor `autonomy: command` by suppressing non-survival modes while preserving explicit commands, held-state rules, and immediate self-preservation.
3. Expose autonomy suppression in mode telemetry so a quiet bot is explainable rather than apparently broken.
4. Run focused syntax/diff checks only; no profile edit, bot restart, or broad suite.
