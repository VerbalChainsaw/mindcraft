# Release 0.1 Scenario Lab

Status: two bounded replay adapters are registered. Doorway/corridor follow has completed a 10-run instrumentation-off campaign (5 direct, 5 deterministic natural language) at 10/10 strict success; stone recovery remains at one direct plus one deterministic-NL replay. Three families, diagnostics-on non-interference, and the full lab gates remain open.

## Contract and evidence boundary

`tools/scenario-lab/scenarios.v1.json` is the frozen `scenario-lab.manifest.v1` contract. Its hash reuses the A0 rule: canonical recursive JSON, array order preserved, root `manifestHash` omitted, then UTF-8 SHA-256. The executable validator is `tools/scenario-lab.mjs`.

The manifest records candidate commit, gameplay-file hash, seed, Paper version/protocol, world or fixture identity, timeout, direct and natural-language request forms with repetitions, expected evidence, safety invariants, instrumentation mode, executor declaration, and blockers. Moving a declaration to `not-run` requires a safe executor, evidence adapter, immutable fixture hash, and no blockers.

Plan and result artifacts reuse A0 outcome names and unknown-value discipline: `evidenceCompleteness`, `missingFields`, `success`, `unsafe`, `death`, `conflict`, `timeout`, `retryCount`, `terminalReason`, and `elapsedMs`. Unknown facts remain `null`. Offline plan artifacts are not admissible A0 run evidence; a live adapter result is admissible only for its declared scenario and repetitions.

## Registered live adapters

`tools/scenario-lab/adapters/run-stone-recovery.mjs` runs the wood-to-stone recovery scenario. Each request form receives an independent restore of the frozen fixture. The worker forces a per-run command-only profile, disables startup messages/goals and memory loading, verifies the pre-command state, and rejects startup action contamination. It launches Paper and Mineflayer within a bounded timeout, captures action/request correlation and physical inventory evidence, holds and stops the bot, restores managed configuration/properties/pre-run memory, preserves post-run world and replay memory, and fails closed when required evidence or cleanup is absent.

The natural-language request is deliberately local and deterministic: `Please upgrade to a stone pickaxe.` must resolve to `!prepareTool("stone_pickaxe")` with route origin `deterministic-nl`. A model-routed substitution does not satisfy this scenario.

`tools/scenario-lab/adapters/run-follow-field.mjs` runs the doorway/corridor follow scenario. Direct and deterministic-NL request forms receive independent restores of frozen seed `3579780610592225162`. Before launch, the worker verifies the fixture archive, metadata, profile, baseline course contract, and candidate gameplay/controller/harness blobs. It confines both endpoints to loopback, forces command-only autonomy, records exact request/action attribution plus health, doorway crossing, corridor progress, and terminal quiescence, and restores every managed runtime input.

The follow natural-language request is also local and deterministic: `Follow me through the doorway and down the corridor.` must select `!followPlayer` for the speaking target at distance 3 with route origin `deterministic-nl`. A model-routed substitution, uncorrelated action, missing health observation, non-finite timing, or claimed physical completion without doorway and corridor evidence fails closed.

The decisive 2026-08-03 replay passed both forms on independent restores. The [frozen verification record](verification/doorway-corridor-follow-20260803/README.md) preserves the canonical plan, result, run summary, physical acceptance metrics, hashes, and cleanup outcome.

The first full off-arm campaign is preserved unchanged as a [9/10 baseline and terminal-anchor finding](verification/doorway-corridor-follow-a0-off-20260803/README.md). After a verifier-only settling-anchor repair, a fresh [10/10 instrumentation-off campaign](verification/doorway-corridor-follow-a0-off-anchor-fixed-20260803/README.md) completed all five direct and five deterministic-NL invocations with complete records and no safety outcome, retry, managed-process, or runtime-lock residue. This is one fixed-fixture family/arm result, not diagnostics non-interference or cross-seed generalization.

## Closed statuses

| Status | Meaning |
|---|---|
| `unavailable` | A required safe executor or evidence adapter does not exist. |
| `not-run` | Inputs are ready, but no execution observation exists. |
| `blocked` | A named precondition prevents execution or acceptance. |
| `failed` | Execution was observed, but outcome, evidence, repetitions, or safety requirements failed. |
| `passed` | Every repetition completed with all required evidence, complete outcome facts, and no unsafe/death/conflict/timeout or safety violation. |

Adapter readiness is checked first. Missing expected evidence, missing safety reporting, or a missing canonical outcome field cannot pass.

## CLI

```text
node tools/scenario-lab.mjs list
node tools/scenario-lab.mjs validate
node tools/scenario-lab.mjs plan --scenario <id> --output-dir <new-directory>
npm run test:scenario-lab
npm run scenario:stone-recovery -- --output-dir <new-directory> --fixture-root <frozen-fixture-directory>
npm run scenario:follow-field -- --output-dir <new-directory> --fixture-root <frozen-follow-fixture-directory>
```

Live adapters never guess a machine-specific fixture path. Supply `--fixture-root`, or set `SCENARIO_LAB_STONE_FIXTURE_ROOT` for the stone fixture and `SCENARIO_LAB_FOLLOW_FIXTURE_ROOT` for the follow fixture. The follow directory must contain `follow-world.zip`, `fixture-metadata.json`, and `scenario-profile.json`; metadata carries the frozen baseline-course hash, and the worker verifies all four hashes.

Output is canonical JSON. `list` is ID-sorted. `plan` exclusively writes `<id>.plan.v1.json` and `<id>.result.v1.json` and refuses overwrite. It never starts Paper, Mineflayer, a bot, a world, or a gameplay harness. The separate `scenario:stone-recovery` and `scenario:follow-field` entry points are the registered live adapters. Unavailable/not-run/blocked exits `3`; validation/usage/write errors exit `2`; observed failure exits `4`; only a verified live result may exit `0`.

## Registered families

| Family | Release 0.1 state |
|---|---|
| Doorway/corridor follow | Instrumentation-off allocation passed on the frozen fixture: 5/5 direct and 5/5 deterministic-NL on independent restores. Diagnostics-on non-interference and cross-seed gates remain open. |
| Elevation follow | Unavailable: follow harness not registered as a Scenario Lab adapter; fixture not frozen. |
| Operator stop/quiescence | Unavailable: operator-hold harness not registered as a Scenario Lab adapter; fixture not frozen. |
| Autonomous wood-to-stone recovery after `no_safe_stance` | Runnable: bounded adapter and immutable fixture registered. Decisive 2026-08-03 replay passed direct and deterministic-NL forms; broader repetition gate remains open. |
| Chunk-unloaded versus confirmed-air semantics | Unavailable: executor, evidence adapter, and frozen fixture absent. |

The catalog is not general live-world authorization. Each later family must register a bounded adapter and freeze its fixture before moving to `not-run`. Preserve raw evidence and canonical run envelopes; never infer success from command acceptance, absent evidence, unloaded chunks, or a generated plan. Stone recovery currently proves one direct plus one deterministic-NL replay on one fixed fixture. Doorway/corridor follow proves a 10-run instrumentation-off allocation on one fixed fixture. Neither result proves diagnostics non-interference or cross-seed generalization, and the lab is not complete.
