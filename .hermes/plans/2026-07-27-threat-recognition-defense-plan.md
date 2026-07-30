# Threat recognition and bounded defense plan

[codeplan · threat-recognition-bounded-defense · PLAN-OUT · mode: full · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.92;V2=0.72;V3=disqualified · reason: correct canonical entity classification and reuse proof-aware one-hit movement with bounded combat turns instead of trusting a persistent PvP loop]

## Candidates

- V1 `curated-threat-contract` (`known-hostiles`, `avoid-only`, `bounded-defense`, `telemetry`): stop treating every Mineflayer `mob` as hostile; distinguish reflex-avoid-only threats; bound defensive swings and retain structured outcomes.
- V2 `metadata-heuristics` (`opaque`, `version-fragile`): infer hostility from entity metadata/AI flags. Rejected because those slots vary across protocol versions and do not safely identify passive mobs.
- V3 `combat-rewrite` (`behavior-tree`, `weapon-model`, `live-tuning`): replace all PvP behavior. Disqualified because it requires a live combat playbook and widens scope beyond a hardening pass.

## Ordered changes

1. Replace broad `type === mob` hostility with a conservative Java hostile registry plus explicit avoid-only boss threats.
2. Let threat avoidance see all recognized hostiles while the self-defense reflex engages only bounded combat-safe threats.
3. Replace the unbounded direct PvP loop with proof-aware attack attempts, failure budget, interrupt cleanup, and final action evidence.
4. Surface threat disposition in structured nearby-entity state for operators and prompts.
5. Inspect source and diff only; do not run a bot, server, combat, or regression suite.
