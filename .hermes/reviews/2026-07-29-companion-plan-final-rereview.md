## Verdict

**GO to begin implementation. Product release remains NO-GO** until Tasks 1–10 are implemented and live Gates A–C pass exactly as specified.

## Unresolved Release Blockers

**None at plan level.**

The source-verified architecture and verification blockers are now expressed as implementation tasks with falsifiable gates. In particular, §§4.2–4.4 and Tasks 2–9 specify sole movement ownership, ordered cancellation and settlement, plugin listener isolation, attributable combat evidence, independent Paper observations, exact fixtures, monotonic event evidence, and connected stop verification.

Failure of any required Task 2 ownership/cancellation test, SDK-contract check, or live Gate A–C case remains a **product-release blocker**, not a blocker to starting implementation.

## Incorrect Dispositions

- **A16 is incorrectly rejected.** Revised-plan Task 0 step 6 still requires writes to two external registries, while the review supplies no current repository evidence that gameplay implementation depends on them. The current canonical context explicitly marks the old project registries as non-authoritative. This step should be removed, separately authorized, or explicitly waived before Task 1. It does not invalidate the gameplay architecture.

- The disposition’s statement that “Task 2 lease/cancellation tests [are] the first release blocker” is imprecise. Task 1’s authority, compatibility, and persisted-order tests are earlier mandatory implementation gates. Task 2 is the first **movement-architecture** release gate.

## Residual Major Risks

- Task 2 must prove that plugin-internal Pathfinder mutations are actually intercepted and attributed, not merely labeled by the surrounding action.
- Paper health and world queries independently confirm effects, but direct attacker attribution still depends partly on Mineflayer’s `entityHurt(target, source)` event. Fixture isolation and cross-oracle timing are therefore essential.
- Task 8 assumes Paper logs can be reliably correlated for command responses and reconstructed chat chunks. That is plausible from the existing managed-server command/log surface, but remains an implementation-time contract to prove.
- The critical actuator search is intentionally limited to companion paths. An overlooked legacy path could bypass the lease; Task 9 Layer B and Task 10’s source search must remain release gates.
- Persisting a terminal order in the version-1 `activeOrder` field is viable only if startup explicitly reloads terminal records into `lastOrder`; current `JobDirector` ignores terminal loaded records.
- The patched-versus-upstream locomotion trial remains empirical. Failure of both variants requires backend reconsideration under §8, not further scheduler layering.

## Minimum Preconditions for Task 1

- Complete Task 0’s dirty-tree baseline, focused pre-change checks, control-endpoint identity checks, and confirmation that `MindcraftBot` is stopped.
- Remove or explicitly waive Task 0 step 6’s unsupported external-registry requirement.
- Preserve unrelated dirty changes and classify pre-existing test failures.
- Confirm Task 1 remains companion-role scoped through `profiles/local-quickstart.json`.
- Treat its profile compatibility matrix and two-restart persisted-order test as mandatory gates before proceeding to Task 2.

## Final Rationale

The revision has resolved the source-verified plan blockers sufficiently to begin implementation. It no longer assumes that generations alone prevent stale cleanup, that PvP or CollectBlock are passive, that Promise racing cancels Pathfinder, that generic damage proves a bot hit, or that sampled self-report proves gameplay. Each formerly blocking issue now has an explicit ownership decision, cancellation sequence, observable evidence contract, and falsifiable test or live gate.

This is approval of a technically viable implementation plan—not evidence that the companion is release-ready. Product release remains NO-GO until independent Paper-backed Gates A–C pass without lease violations, optimistic narration, stale evidence, unsolicited mutation, or failed stop behavior.