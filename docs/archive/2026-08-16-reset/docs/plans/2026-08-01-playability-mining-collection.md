# Codeplan: Playable mining collection

## Contract and safety

- Required behavior: collect a requested visible stone-family resource without selecting an unsafe support block, navigate to a stable visible stance, break it, acquire the drop, and report the physical outcome truthfully.
- Acceptance criteria: the original typed cobblestone command passes three consecutive reset runs; each run has a linked decision trace, Paper-observed block transition, inventory delta, no unsafe descent, and a terminal structured result.
- Must preserve: `ActionManager` ownership, `collectBlock` API, Mineflayer Pathfinder/CollectBlock, existing lane order, deterministic command routing, and non-mining collection behavior.
- Out of scope: EvidenceFrame, arbitration authority changes, a new planner, generalized mining redesign, timeout inflation, or replacing Mineflayer plugins.
- Workspace/user work: branch `phase0-follow-baseline`; clean before this repair; the current `skills.js` change belongs to this iteration and is not committed.
- Pre-change checks: live command failed `skill_unreachable` with 12 candidates; a near rerun broke stone but left its cobblestone drop in-world; background retries selected an unsafe support target, fell from Y=99 to Y=52, and drowned despite later operator hold.

## Repository evidence

- Hard rules: real Paper gameplay is the product; use existing deterministic skills; focused tests only; do not add another planner or weaken truthful verification.
- Local patterns: `collectBlock` already owns candidate probing, direct dig, CollectBlock fallback, inventory delta verification, and bounded drop pickup in `src/agent/library/skills.js`.
- Tests/contracts/runtime: `rankCollectionCandidates` is dependency-light; `goToGoal`, `isSafeGameplaySupport`, and `waitForExpectedDropPickup` are existing mechanisms; the dashboard state stream links `ActionResult` to decision traces.
- References: `src/agent/library/skills.js`, `src/agent/runtime/collection-candidate-selector.js`, `src/agent/runtime/gameplay-safety.js`, `tests/collection-candidate-selector.test.js`, `tools/gameplay-certification-map.mjs`.

## Mode

- Candidate mode: full
- Candidate count: 3
- Record profile: compact

## Candidates

- V1 `inline+guard-clause+zero-dep`: filter targets that currently support the bot or lack stable support. Low effort and conservative, but it does not prove the stance CollectBlock will later choose and can avoid useful targets instead of collecting them.
- V2 `existing-helper+local-state+iterative+result-return`: enumerate bounded stable visible stance cells, probe and navigate to one without breaking the selected target, revalidate target/support/stance, then use the existing direct dig and verified pickup path. Medium effort; contained to natural mining collection.
- V3 `cross-skill+iterative+internal-reuse`: route buried resources through the staircase/tunnel mining workflow and let generic collection handle only exposed resources. This can find more resources but crosses preparation, progression, and mining boundaries before the visible-resource scenario needs it.

## Divergence

- V1↔V2: V1 filters only the scan-time block; V2 proves and revalidates the execution-time standing cell, preventing plugin stance drift.
- V1↔V3: V1 stays inside target selection; V3 changes the acquisition method and fallback lifecycle.
- V2↔V3: V2 repairs one existing collection method; V3 composes a broader supported-tunnel method across skills.

## Paper gates

- V1: pass, but weak fulfillment; preserves contracts and can be verified, yet may return blocked instead of performing ordinary supported collection.
- V2: pass; uses existing navigation, direct dig, pickup verification, and failure contracts with no dependency or ownership change.
- V3: pass; plausible and in-scope in principle, but has a broader regression surface and would require more live fixtures.

## IN

[codeplan · mining collection safety · IN · mode: full · profile: compact · confidence: high · candidates: V1=stable-target filter/guard-clause;V2=safe-stance approach/existing-helper+iterative;V3=supported mining workflow/cross-skill+iterative · lean: V2 · conservative: V1]

## Frozen rubric and scoring

- freeze: axes=physical-safety,task-fulfillment,repository-fit,verifiability,regression-risk,delivery-cost classes=risk,quality,quality,quality,risk,convenience weights=3,3,2,2,2,1 denominator=65 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer
- V1: 44/65 = 0.677 (`3,2,4,4,4,5`).
- V2: 57/65 = 0.877 (`5,5,4,5,3,3`).
- V3: 42/65 = 0.646 (`4,4,3,3,2,2`).
- Arithmetic verification: executable Node calculation confirmed all weighted points and the common denominator.
- Formal baseline: V1, the lowest-effort eligible candidate.
- Selection stability: V2 leads the baseline by 0.200 with no unknown axis.

## PLAN-OUT

[codeplan · mining collection safety · PLAN-OUT · mode: full · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.677;V2=0.877;V3=0.646 · reason: V2 is the only candidate that proves both a stable approach stance and verified pickup while preserving the existing collection owner and plugin boundary · planned-fingerprint: existing-helper+local-state+iterative+result-return]

- Files/boundaries: collection target assessment and candidate ranking; natural-mining branch inside `collectBlock`; one focused regression file; overnight evidence ledger.
- Ordered changes: add bounded stance assessment; record stable rejection codes; route natural mining to the chosen stance; revalidate and direct-dig; retain plugin fallback for other collection; add one focused regression; rerun the exact fixture three times.
- Contract checks: no lane/owner/order change; no new dependency; no timeout increase; no fabricated inventory or block success.
- Rollback: changes are local and reversible; fixture resets are Paper commands recorded in the iteration ledger.

## Implementation and evidence

- Implemented V2 in the existing collection owner. Natural stone-family collection now performs a bounded hydrated scan, rejects unsupported drops and targets without stable visible stances, navigates with a composite exact-stance goal that cannot break the selected target, revalidates at execution time, direct-digs, and verifies pickup.
- Extended the existing unreachable classification for `unsafe_drop_support`, `no_safe_stance`, and `target_unloaded`.
- Preserved two pre-change failure cases with focused regressions: unsafe support/target-supported stance rejection and a supported target hidden behind more than 48 nearer unsupported candidates.
- Live verifier records bounded state samples, deduplicated decision traces, unique action correlation, Paper block/inventory/support evidence, minimum Y, stop latency, and ten seconds of post-stop stability.
- Final evidence: `docs/verification/2026-08-01-overnight/min-001-live.json` passed three consecutive reset runs.

## EXEC-OUT

[codeplan · mining collection safety · EXEC-OUT · implementation matches V2 fingerprint · evidence: focused tests green; Paper-backed live runs 3/3; inventory 0→3; minimum Y=100; stop 2/71/13ms · drift: terminal state delivery gained authoritative lifecycle snapshots after live evidence proved volatile revision gaps could hide the result; lane order and arbiter authority unchanged]
