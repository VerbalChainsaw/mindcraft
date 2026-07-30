# Codeplan: Truthful generic block and entity interaction

## Contract and safety
- Required behavior: generic right-click interaction must distinguish an observed Minecraft result from a packet that was merely sent.
- Acceptance criteria: missing targets and obstructed sight have explicit evidence; empty-hand selection uses the safe shared equip path; block/entity/item/window changes are condition-polled within a hard bound; no observed change yields `completion: requested`, never false success.
- Must preserve: existing `!useOn` signature, specialized stronger skills, safe navigation, operator Stop, ActionManager result normalization, provider neutrality, and item-use duration command.
- Out of scope: per-item templates, guessing intended world effects, runtime restart, and tests.

## Repository evidence
- `useToolOn` and `useToolOnBlock` report `outcome: used` immediately after `useOn`, `activateItem`, or `activateBlock` resolves.
- Multiple target-not-found and obstructed-view exits return false without their own action evidence.
- Entity empty-hand interaction calls Mineflayer `unequip('hand')` directly, bypassing the full-inventory drop guard in the shared equip helper.
- Installed Mineflayer describes these APIs as client interaction boundaries, not proof that the server accepted a particular gameplay effect.

## Candidates
- V1 `optimistic-packet-success`: keep treating a resolved interaction call as completed gameplay.
- V2 `observable-or-requested`: snapshot authoritative state, poll for a change up to a bounded deadline, record verified evidence when it changes, otherwise emit a structured requested result.

## PLAN-OUT
[codeplan · truthful-generic-interaction · PLAN-OUT · mode: constrained · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.24;V2=0.95 · reason: generic mechanics cannot prove every item-specific effect, so observable state or an honest pending request is the strongest version-neutral contract · planned-fingerprint: existing-module,condition-based-waiting,structured-result,graceful-degrade]

## Implementation
- Add compact block/entity/item/window interaction snapshots and equality checks.
- Poll fresh state with a bounded deadline and interruption awareness.
- Route targetless item activation through the bounded item-use primitive.
- Use safe empty-hand equipment handling and add evidence to every missing/blocked exit.
- Re-read changed source and run syntax/diff formatting only.

## EXEC-OUT
[codeplan · truthful-generic-interaction · EXEC-OUT · mode: constrained · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · delivered: state-snapshots,condition-polling,verified-or-requested,safe-empty-hand,deterministic-sight-recovery,structured-failures · evidence: installed-mineflayer-contract,changed-source-reread,syntax-check,diff-formatting · deferred: runtime-action,restart,tests]
