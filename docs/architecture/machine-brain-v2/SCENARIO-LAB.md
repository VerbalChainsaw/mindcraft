# Release 0.1 Scenario Lab

Status: deterministic contract and offline planning foundation only. No executor or evidence adapter is registered, no live scenario has passed, and the lab is not complete.

## Contract and evidence boundary

`tools/scenario-lab/scenarios.v1.json` is the frozen `scenario-lab.manifest.v1` contract. Its hash reuses the A0 rule: canonical recursive JSON, array order preserved, root `manifestHash` omitted, then UTF-8 SHA-256. The executable validator is `tools/scenario-lab.mjs`.

The manifest records candidate commit, seed, Paper version/protocol, world or fixture identity, timeout, direct and natural-language request forms with repetitions, expected evidence, safety invariants, instrumentation mode, executor declaration, and blockers. Moving a declaration to `not-run` requires a safe executor, evidence adapter, immutable fixture hash, and no blockers.

Plan and result artifacts reuse A0 outcome names and unknown-value discipline: `evidenceCompleteness`, `missingFields`, `success`, `unsafe`, `death`, `conflict`, `timeout`, `retryCount`, `terminalReason`, and `elapsedMs`. Unknown facts remain `null`. These offline artifacts are not admissible A0 run evidence.

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
```

Output is canonical JSON. `list` is ID-sorted. `plan` exclusively writes `<id>.plan.v1.json` and `<id>.result.v1.json` and refuses overwrite. It never starts Paper, Mineflayer, a bot, a world, or a gameplay harness. Unavailable/not-run/blocked exits `3`; validation/usage/write errors exit `2`; observed failure is reserved as `4`; only a verified result may exit `0`.

## Registered families

| Family | Release 0.1 state |
|---|---|
| Doorway/corridor follow | Unavailable: follow harness not registered as a Scenario Lab adapter; fixture not frozen. |
| Elevation follow | Unavailable: follow harness not registered as a Scenario Lab adapter; fixture not frozen. |
| Operator stop/quiescence | Unavailable: operator-hold harness not registered as a Scenario Lab adapter; fixture not frozen. |
| Autonomous wood-to-stone recovery after `no_safe_stance` | Unavailable: executor, evidence adapter, and frozen fixture absent. |
| Chunk-unloaded versus confirmed-air semantics | Unavailable: executor, evidence adapter, and frozen fixture absent. |

The catalog is not live-world authorization. A later release must register bounded adapters and freeze fixtures before any family can move to `not-run`. Preserve future raw evidence and submit canonical run envelopes to the existing A0 aggregation gate; never infer success from command acceptance, absent evidence, unloaded chunks, or a generated plan.
