# Codeplan: Generic item use cycle

## Contract and safety
- Required behavior: the bot can intentionally equip and activate any carried registered item in either hand for a bounded duration, release held-use items, clean up on interruption, and report only what the client actually completed.
- Acceptance criteria: equipment destination is validated and verified; use duration is bounded; interruption always deactivates; one-shot and held-use items share one composable primitive; observable inventory/equipment evidence is recorded.
- Must preserve: existing `!equip` and `!useOn` signatures, operator Stop, ActionManager timeouts/results, creative inventory behavior, parser validation, provider neutrality, and all specialized safer skills.
- Out of scope: item-specific activity templates, guessing world outcomes, provisioning items, automated combat selection, runtime restart, and tests.

## Repository evidence
- `!useOn(item, "nothing")` calls `activateItem()` and immediately reports success, so bows, shields, spyglasses, tridents, food, and other held-use items cannot express a use duration or a release.
- `equip()` awaits Mineflayer but does not verify the destination slot even though installed Mineflayer exposes `getEquipmentDestSlot()`.
- Installed Mineflayer defines `activateItem(offHand)` and `deactivateItem()` as the general use/release boundary.

## Candidates
- V1 `item-family-templates`: add separate commands for bows, shields, food, pearls, spyglasses, tridents, and future items. This duplicates mechanics and goes stale with Minecraft versions.
- V2 `bounded-use-cycle`: add one explicit hand/duration primitive over the installed Mineflayer contract, with verified equip and structured evidence.

## PLAN-OUT
[codeplan · generic-item-use-cycle · PLAN-OUT · mode: constrained · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.48;V2=0.93 · reason: one bounded registry-compatible primitive covers present and future usable items without inventing per-item behavior while retaining safer specialized skills · planned-fingerprint: existing-module,composable-primitive,validated-input,cleanup-guaranteed,structured-result]

## Implementation
- Add optional explicit destination support and post-equip slot verification to the shared equip helper.
- Add a bounded interrupt-aware item activation/release skill with inventory and equipment evidence.
- Expose the primitive as one typed command and clarify that specialized skills remain preferred where they verify a stronger outcome.
- Re-read every changed line and run source diff formatting only.

## EXEC-OUT
[codeplan · generic-item-use-cycle · EXEC-OUT · mode: constrained · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · delivered: verified-equipment,bounded-use-cycle,main-or-off-hand,interrupt-cleanup,structured-evidence · evidence: installed-mineflayer-contract,changed-source-reread,syntax-check,diff-formatting · deferred: runtime-action,restart,tests]
