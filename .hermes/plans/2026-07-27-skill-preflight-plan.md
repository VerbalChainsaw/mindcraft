# Skill preflight and verified completion plan

[codeplan · skill-preflight-verification · PLAN-OUT · mode: full · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.93;V2=0.76;V3=disqualified · reason: preserve Mineflayer skill APIs while inserting local material, inventory, support, reachability, and postcondition checks where execution currently bypasses them]

## Candidates

- V1 `local-preflight-verification` (`existing-skills`, `safe-movements`, `structured-evidence`, `postcondition-check`): validate tool/material/inventory/reachability at individual collect, pickup, break, and place boundaries and return the existing boolean contract.
- V2 `shared-task-planner` (`new-service`, `resource-model`, `migration`): centralize every gameplay action in a planner. Stronger architecture but requires a wide caller migration and live behavior proof.
- V3 `server-authoritative-automation` (`plugin-protocol`, `world-mutation`, `new-deployment`): move action proof into a Paper plugin. Disqualified because it changes the server authority/deployment model and cannot cover normal survival interaction without a new protocol.

- V1=46/50=0.93 for action truth, safety, compatibility, and scope; V2=38/50=0.76; V3=disqualified. V1 is the selected conservative implementation.

## Ordered changes

1. Use safe movements and verified arrival for collection, pickup, and breaking; surface inventory/tool/reachability blockers before world interaction.
2. Make placement validate destination/support/reachability/materials and verify the resulting block or tool-use outcome; report cheat commands as requests, not arrival.
3. Preserve partial counts as evidence and terminate a failed skill as `false` instead of a resolved undefined success.
4. Run focused syntax and static/diff checks only; do not run bots or a broad suite.

[codeplan · skill-preflight-verification · EXEC-OUT · implemented: V1 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: normal bucket placement now returns/validates, pickup/give no longer fabricate completion, and raw skill navigation is safe/verified · evidence: focused Node syntax, scoped diff/whitespace, and remaining raw-movement scan passed; no live Minecraft action or broad suite ran]
