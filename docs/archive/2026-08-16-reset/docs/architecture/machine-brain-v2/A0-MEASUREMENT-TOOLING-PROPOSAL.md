# A0 Measurement Tooling Proposal

## Purpose

A0 needs an offline, fail-closed measurement design that establishes whether benchmark evidence is admissible before any later implementation or promotion decision. This proposal defines that measurement contract only. It does not change runtime behavior, execute gameplay, control a bot, or alter a server or world. The intended aggregator is a read-only consumer of artifacts already produced by an external harness. It must not connect to a server, bot, world, or network, and it must not mutate fixtures, manifests, evidence, or any runtime state.

Fail-closed means incomplete, ambiguous, duplicated, contaminated, or unverifiable evidence is never silently converted into a favorable result. Unknown values remain unknown. Missing evidence is held or invalid according to explicit rules, and reports expose those states rather than manufacturing denominators or outcomes.

## ManifestV1 contract

Every independent invocation supplies a ManifestV1 with the following fields:

- `schemaVersion` and an immutable `manifestRevision` or manifest `hash` identify the contract used.
- `family`, `variant`, and `harness` identify the benchmark scenario and producer.
- `argvTemplate` records the invocation shape without relying on reconstructed command history.
- `routeOrigin` is exactly `direct` or `nl`.
- `diagnosticsArm` is exactly `off` or `on`.
- `runId`, `invocationId`, `independentRunIndex`, and `attemptCount` establish run identity and observation structure.
- `gitCommit`, `bot`, `serverVersion`, and `protocolVersion` establish implementation and execution provenance.
- `worldId`, `seed`, and fixture coordinates plus fixture hash establish world and reset identity.
- `timeoutMs` and `safetyBounds` record the limits in force before execution.
- `expectedArtifactPath` identifies the artifact expected from the invocation.
- `metadataStatus` and `missingFields` explicitly state whether metadata is complete and, if not, which fields are absent.

Validation must check field presence, type, allowed values, identifier uniqueness, and consistency between metadata status and missing fields. A producer cannot claim complete metadata while listing missing fields, and absence cannot be inferred as a negative result.

## Independence and admissibility

One harness process and invocation is one independent run. Retries or internal attempts inside that process are observations within the same run; they do not increase the independent sample count. `attemptCount` and normalized retry data preserve those observations without presenting them as replication.

The tooling must reject duplicate `runId`, duplicate `invocationId`, and duplicate artifact SHA-256. It must also reject reused world or reset identity whenever the manifest requires a fresh reset. These checks apply across all input artifacts in the aggregation set, not merely within one file. Rejection is preferable to deduplication because silent deduplication could conceal a collection defect.

## A0 allocation

The A0 minimum is 10 independent invocations per family: five using the direct route and five using the natural-language route. Internal attempts do not satisfy this allocation. Operator-hold and obstruction families are blocked from freeze until natural-language harness support exists, because direct-only evidence cannot establish route parity.

This A0 gate is not the promotion threshold. Promotion is evaluated separately under `BENCHMARK-KILL-CRITERIA` and requires at least 20 independent invocations per diagnostics arm. Meeting the A0 allocation therefore authorizes neither freeze nor promotion by itself.

## Diagnostics off/on pairing

An off/on pair must use the same git commit, scenario, environment, reset identity, route, and independent-run index. Each arm must still have a unique invocation identity and unique artifact. Pairing is a controlled comparison, not duplicate execution identity.

Validation must reject contamination between arms and reject any mutation attributable to shadow diagnostics. Diagnostics may observe and emit evidence, but must not modify commands, timing controls, retry policy, world state, bot state, fixture state, route handling, or outcome classification. If equivalence cannot be established from the recorded provenance, the comparison is incomplete rather than assumed clean.

## NormalizedRunRow

Each accepted artifact maps to one NormalizedRunRow. The row includes identity and provenance fields plus an evidence disposition of `valid`, `held`, or `invalid`. It records `success`; unsafe outcome or death; conflict or overlap; timeout; `retryCount`; `terminalReason`; `elapsedMs`; route; diagnostics arm; `evidenceCompleteness`; and `missingFields`.

Normalization must preserve source meaning. Unknown is never coerced to false, and it is never treated as success. A missing unsafe flag does not prove safety; a missing success flag does not prove failure or success. Held rows remain visible to completeness reporting but do not enter outcome denominators intended for valid evidence. Invalid rows remain countable as validation failures and cannot improve measured rates.

## Aggregation and statistics

Each report provides total `n`, held and invalid counts, and evidence completeness. For valid evidence it reports success, unsafe, conflict, timeout, and retry measures, along with terminal-reason counts. It also reports direct versus natural-language parity and diagnostics-arm comparisons only when the required inputs are complete.

Elapsed-time summaries use deterministic nearest-rank p50 and p95 calculations. The input ordering and tie handling must be stable so repeated aggregation of identical artifacts is byte-for-byte explainable. Proportions include a Wilson 95% interval using `z = 1.96`. When `n = 0`, the interval and any rate requiring that denominator are `null`. The report must never fabricate zero percentages, perfect rates, or other values to avoid division by zero.

Route parity must expose direct and natural-language sample counts, dispositions, and outcome measures separately before presenting a comparison. Aggregate totals cannot hide a missing route or an allocation shortfall.

## CLI outcomes and fail-closed behavior

The proposed CLI uses stable exit codes:

- `0`: valid, complete report.
- `2`: validation error.
- `3`: missing or held evidence.
- `4`: duplicate evidence or diagnostics contamination.
- `5`: comparison incomplete.

A nonzero exit must still produce deterministic diagnostics sufficient to identify rejected inputs and fields, without rewriting those inputs. Exit code `0` is reserved for a complete report; it does not claim benchmark promotion.

## Proposed implementation

If the decision gate is approved, implementation is limited to exactly these five later files:

1. `tools/a0/manifest.schema.json`
2. `tools/a0/manifests/baseline.v1.json`
3. `tools/a0/aggregate.mjs`
4. `tests/control-plane/a0-aggregation.test.js`
5. `docs/architecture/machine-brain-v2/A0-MEASUREMENT-TOOLING.md`

The schema will encode ManifestV1 validation, the baseline manifest will provide a reviewable instance, the aggregator will normalize and report offline, the focused test will cover rejection and statistics contracts, and the final tooling document will describe approved operation.

## Non-goals

This proposal does not introduce EvidenceFrame, TaskGraph, a scheduler, concurrency, an executor, or a dependency. It makes no harness, runtime, or gameplay-skill changes. It does not add collection automation, alter route behavior, or create server-side instrumentation. It does not establish that any family is ready to freeze or promote.

## Decision gate

Implementation begins only after reviewers approve the schema shape, CLI contract, artifact-to-NormalizedRunRow mapping, and all duplication, reset-reuse, contamination, completeness, and pairing rejection rules. Review approval authorizes implementation of the five listed files only. It does not validate existing evidence and must not be represented as a promotion decision.
