[codeplan · campaign65-family-gift · IN · mode: full · confidence: high · candidates: V1 resolver-first-command (single-directive), V2 typed gift-care Agenda (durable-composition), V3 monolithic gift-care skill (custom-workflow) · lean: V2 · baseline: V1]

## Boundary and gates

Paper proved that a live one-Bread handoff plus “pick it up, eat it … then
wait” is collapsed to `!awareness`; no physical action is selected. The repair
must preserve every clause, exact item identity and custody, native collection
and consumption mechanics, cancellation, restart safety, terminal Hold, and
structured results without adding a dependency or general-purpose command text
to persistence.

- V1 removes the observation shortcut and selects `!pickupUsefulItems`; **gate
  fail** because eat/wait are still discarded and pickup is not exact-item
  bound.
- V2 recognizes the complete gifted-food relation before generic splitting and
  emits typed `pickup_item -> consume_item(terminal hold)` Agenda entries. A
  thin exact-target adapter filters the existing Mineflayer collect-block queue;
  native collection and `bot.consume` retain mechanics ownership. **Pass**.
- V3 adds one `acceptGiftAndEat` skill that performs selection, pickup,
  consumption, and Hold. **Gate fail** because it duplicates orchestration,
  mixes player authority into a physical skill, and weakens restart semantics.

Only V2 passes the semantic-fidelity, package-first, persistence, cancellation,
and terminal-authority gates. It is selected without compensatory scoring.

[codeplan · campaign65-family-gift · OUT · mode: full · pick: V2 · confidence: high · beatBaseline: yes · scores: V2 sole gate-passer · reason: typed durable composition at the existing Agenda owner with package-owned mechanics · mechanism-check: passed · corrected: none]

## Repair class 2: critical-survival admission

[codeplan · campaign65-survival-admission · IN · mode: full · confidence: high · candidates: V1 typed-remedy deferral (local-admission), V2 Agenda lane promotion (global-ordering), V3 Survival executes Agenda remedy (cross-owner-dispatch) · lean: V1 · baseline: V1]

The post-repair Paper tranche proved that the typed Agenda persisted both exact
steps and was otherwise dispatchable, while critical SurvivalDirector recovery
won every arbiter tick and walked away from the live Bread. The repair must let
the exact queued remedy execute without globally demoting bodily survival,
duplicating Agenda execution, or yielding during immediate danger.

- V1 makes SurvivalDirector yield only generic food-recovery intents when the
  active/first pending Agenda entry is a registry-backed safe `consume_item` or
  an exact `pickup_item` with a matching success-dependent consume step, and no
  urgent danger exists. **Pass**.
- V2 moves Agenda ahead of critical survival in BehaviorArbiter. **Gate fail**:
  unrelated player work could delay combat, healing, or other emergencies.
- V3 makes SurvivalDirector dispatch or settle the Agenda entry. **Gate fail**:
  it creates a second durable-work owner and breaks Agenda reconciliation.

[codeplan · campaign65-survival-admission · OUT · mode: full · pick: V1 · confidence: high · beatBaseline: yes · scores: V1 sole gate-passer · reason: smallest typed admission seam; Agenda retains authority and package-backed mechanics · mechanism-check: passed · corrected: none]
