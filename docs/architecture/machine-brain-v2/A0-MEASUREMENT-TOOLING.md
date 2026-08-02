# A0 Measurement Tooling

## Purpose and boundary

A0 is an offline, fail-closed admissibility gate for measurement artifacts produced by an external harness. It validates a manifest, reads the artifacts named by that manifest, normalizes what is actually known, and emits deterministic aggregate JSON. Unknown or incomplete facts remain held or null; they are never converted into favorable evidence.

`tools/a0/aggregate.mjs` is read-only and has no network path. It reads the manifest and expected artifact files, writes only one JSON report to stdout, and does not connect to Minecraft, a bot, a server, a world, or any other network service. It does not mutate manifests, fixtures, artifacts, evidence, or runtime state.

Non-goals are gameplay execution, collection automation, server instrumentation, runtime behavior changes, dependencies, EvidenceFrame, TaskGraph, scheduling, concurrency, freeze, and promotion. Harness execution is a separate, externally authorized live operation.

## Approved five-file surface

The complete approved A0 surface is exactly:

1. `tools/a0/manifest.schema.json`
2. `tools/a0/manifests/baseline.v1.json`
3. `tools/a0/aggregate.mjs`
4. `tests/control-plane/a0-aggregation.test.js`
5. `docs/architecture/machine-brain-v2/A0-MEASUREMENT-TOOLING.md`

This guide completes that five-file surface. The schema, corrected planned baseline, aggregator, and 16 focused test cases are committed through preparation HEAD `23a570e2b56c0ebbb1c9ceeb3c6ff5db7e40c6a9`; this document is the final commit-ready file. “Commit-ready” describes the tooling surface only. It does not mean that evidence has been collected, accepted, frozen, or promoted.

## Manifest states and the planned baseline

A ManifestV1 is a closed object with `schemaVersion: "a0.manifest.v1"`, a revision, hash, status, title, metadata status, missing-field pointers, family declarations, and runs.

- `manifestStatus` is `planned` or `runnable`.
- `metadataStatus` is `complete` or `incomplete`. Complete manifests have no `missingFields`; incomplete manifests have at least one.
- `manifestHash: "pending"` is allowed only for a planned, incomplete manifest.
- A runnable manifest requires a 64-character lowercase SHA-256 `manifestHash`, complete metadata, and no manifest `missingFields`.
- A complete run has no `missingFields` or blockers, complete bot/server/world/fixture metadata, and disposition `valid` or `invalid`.
- An incomplete run has at least one missing field and blocker and must be `held`.
- An available family route has a non-null harness path and argv array and no blockers. An unavailable route has null path/argv and at least one blocker. A blocked family has at least one blocker.

The committed baseline is deliberately planned, incomplete, and not runnable: its hash is `pending`, its manifest missing list is `[/manifestHash]`, and all 30 run rows are held with incomplete execution metadata and null `pairId`. Do not use it directly as runnable input and do not treat its argv templates as permission to execute a harness.

The allocation is 30 planned independent slots: 10 per selected family (`follow-navigation`, `ordinary-obstruction`, and `operator-hold`), with five direct and five NL slots per family. Each family currently allocates six diagnostics-off and four diagnostics-on slots. This meets the shape of the A0 allocation only; it contributes zero valid invocations.

Current harness reality must be distinguished from the historical planned declarations:

- Follow has direct and NL argv support in `tools/verify-follow-field.mjs`.
- `tools/verify-obstruction-field.mjs` is the actual supported direct obstruction harness. The corrected family declaration names it and marks the direct route available, and all five direct run slots name it; only the five NL slots remain unavailable because `--natural-language` is unsupported.
- `tools/verify-obstruction-field.mjs` and `tools/verify-operator-hold-field.mjs` do not parse `--natural-language`. Their NL slots therefore remain blocked. Do not run the unavailable obstruction or operator-hold NL argv templates.

All three current harnesses emit rich raw evidence with legacy top-level `passed` and `durationMs`, but they do not emit the complete canonical artifact envelope required below. Their raw output alone therefore remains held.

## Canonical manifest hash

`computeManifestHash` performs exactly these steps:

1. Make a shallow root object that omits only the root `manifestHash` member. A nested member with that name is not specially omitted.
2. Canonicalize recursively: object keys are sorted lexicographically at every depth; array order and elements are retained; values use compact JSON encoding with no insignificant whitespace. Non-finite numbers and non-JSON value types are rejected.
3. Encode that compact canonical JSON as UTF-8.
4. Compute lowercase hexadecimal SHA-256 over those bytes.

Example from the focused test:

```text
canonicalJson({ z: 1, a: { d: 4, c: 3 }, m: [2, { b: 2, a: 1 }] })
=> {"a":{"c":3,"d":4},"m":[2,{"a":1,"b":2}],"z":1}
```

After all runnable metadata is final, set the hash without changing any other field:

```bash
node --input-type=module -e "import{readFile,writeFile}from'node:fs/promises';import{computeManifestHash}from'./tools/a0/aggregate.mjs';const p=process.argv[1],m=JSON.parse(await readFile(p,'utf8'));m.manifestHash=computeManifestHash(m);await writeFile(p,JSON.stringify(m,null,2)+'\n')" path/to/runnable-manifest.json
```

Any later manifest change requires recomputing the hash.

## Artifact lookup and CLI

For every run, `expectedArtifactPath` is resolved against the aggregator process’s current working directory, not against the manifest file’s directory. Run from the intended evidence root. The schema rejects absolute paths, drive-letter paths, and lexical `..` segments. The aggregator also resolves each path and rejects a result outside the current working directory with `path-escape`.

The only supported CLI form is:

```bash
node tools/a0/aggregate.mjs --manifest <path>
```

Exactly those two arguments are required. The CLI emits one compact, canonical JSON report plus a newline to stdout and emits no human-formatted report. Rows and diagnostics are sorted deterministically. Redirect stdout to archive the report; capture the process exit code separately.

## Exit codes and precedence

| Code | Current meaning |
| --- | --- |
| `0` | No manifest/artifact validation error, duplicate, diagnostics contamination, held evidence, or incomplete pair was found. This is a complete report, not a freeze or promotion result. A schema-valid row explicitly marked `invalid` can still appear in such a report. |
| `2` | CLI usage, manifest read/JSON/schema/hash validation, malformed artifact JSON, or runtime path-escape validation error. |
| `3` | At least one row is held, or manifest metadata is incomplete. |
| `4` | Duplicate evidence/reset identity or diagnostics contamination. |
| `5` | A declared off/on comparison is incomplete. |

Precedence is fail-closed and exact: code `2` returns before duplicate/pair analysis; otherwise `4` overrides `3` and `5`, `3` overrides `5`, then `5`, then `0`. Every handled outcome still produces parseable deterministic JSON on stdout. No code claims freeze or promotion: reports always contain `freezeClaimed: false`, `promotionClaimed: false`, and a separate promotion-threshold note.

## Independence, retries, resets, and duplicates

One external harness process/invocation is one independent run. `attemptCount` is 1–3 observations inside that invocation; it does not increase independent `n`. Artifact `retryCount` is an outcome measure for that same run, not replication.

Aggregation rejects duplicates rather than silently deduplicating. It checks duplicate `runId`, `invocationId`, `expectedArtifactPath`, and artifact SHA-256 (the SHA-256 is over the artifact’s raw file bytes). For runs whose `resetPolicy` is `fresh`, it also rejects reused non-null `worldId` and `resetId`. Reuse under `restored` is not rejected by this duplicate rule. Use unique run/invocation/artifact identities for every arm and invocation.

## Diagnostics off/on pairs

Only non-null `pairId` values create pair groups. A complete pair has exactly two rows: one `off` and one `on`. The two rows must have distinct run, invocation, and artifact identities but matching `pairId` and matching canonical provenance for:

`gitCommit`, `family`, `variant`, `harness`, `argvTemplate`, `routeOrigin`, `independentRunIndex`, `bot`, `server`, `world`, `fixture`, `timeoutMs`, and `safetyBounds`.

Because a pair intentionally shares world/reset provenance, use a supported restored identity; duplicating a `fresh` world/reset identity is independently rejected as duplicate evidence.

For a declared pair, both artifacts need the same 64-character lowercase SHA-256 `comparisonFingerprint`. It is the producer/envelope step’s assertion that the comparison-relevant execution inputs match; the aggregator compares the two strings but does not derive the fingerprint. A missing or unequal fingerprint makes the pair incomplete (code `5`, unless a higher-precedence condition applies).

`diagnosticsMutationDetected: true` on either arm is contamination (code `4`). `false` records that the producer found no diagnostics mutation. The field is optional for normalization as currently implemented: absence alone neither holds a row nor makes a pair incomplete. The aggregator does not infer equivalence from this flag; matching provenance and fingerprints are still required. Provenance mismatch is contamination regardless of fingerprint.

## Canonical artifact contract

A row can become `valid` only when its manifest run is metadata-complete and marked `valid`, the artifact is an object, and all facts below normalize without a missing-field entry.

| Artifact field | Required value/type |
| --- | --- |
| `runId` | String exactly equal to the manifest run’s `runId`. |
| `invocationId` | String exactly equal to the manifest run’s `invocationId`. |
| `evidenceCompleteness` | Exactly `"complete"`. |
| `missingFields` | An empty array. |
| `success` | Boolean. Legacy adapter: boolean `passed`. |
| `unsafe` | Boolean. |
| `death` | Boolean. |
| `conflict` | Boolean. |
| `timeout` | Boolean. |
| `retryCount` | Non-negative integer. |
| `terminalReason` | Non-empty string. |
| `elapsedMs` | Finite non-negative number. Legacy adapter: finite non-negative `durationMs`. |

The canonical field wins when present; an ill-typed canonical value becomes null rather than falling back to its legacy alias. There are no legacy adapters for safety, death, conflict, timeout, retries, terminal reason, identity, or completeness. Those unknown facts remain null, add `/artifact/<field>` to the row’s missing list, and hold the row. `comparisonFingerprint` and `diagnosticsMutationDetected` have the pair semantics above. Other artifact properties are currently ignored rather than treated as schema errors.

The artifact’s raw-byte SHA-256 becomes `artifactSha256`. The manifest’s disposition controls admissibility; an artifact cannot promote a manifest run from held or invalid to valid.

## Normalized rows, reports, and statistics

Each run produces a `NormalizedRunRow`, including manifest identity/provenance, artifact hash, optional comparison fields, disposition, completeness, missing fields, and the normalized outcome fields. Missing/unreadable artifacts produce held rows (or preserve a manifest-declared invalid disposition) with `/artifact`; a read failure is exposed as `readError`. Rows are sorted by `runId`, then `invocationId`.

Disposition behavior is:

- `valid`: complete run metadata, manifest disposition `valid`, and complete canonical artifact facts.
- `held`: evidence or metadata is incomplete or unknown; visible in totals but excluded from outcome denominators.
- `invalid`: explicitly invalid complete manifest run, or a missing artifact for a run already marked invalid; never improves valid measures.

Reports include rows; total `n` and valid/held/invalid counts; complete/incomplete evidence counts; valid-only measures; fixed views by all families, routes, and diagnostics arms; selected-family route allocation and route parity; pair comparisons; promotion-threshold counts; and sorted diagnostics. Route parity is `complete` only when both direct and NL have at least one valid row.

All outcome proportions (`success`, `unsafe`, `death`, `conflict`, `timeout`, and any-retry) use only valid rows and report `{count, n, rate, wilson95}`. Wilson 95% intervals use `z = 1.96` and rates/bounds are rounded to 12 decimal places. Elapsed and retry-count p50/p95 use deterministic nearest rank after numeric ascending sort: index `ceil(percentile * n) - 1`. Terminal reasons are lexicographically sorted. When valid `n = 0`, rates, Wilson intervals, p50, and p95 are `null`, never zero or perfect.

## A0 allocation versus promotion

A0 allocation requires at least five valid direct and five valid NL independent invocations per selected family: 10 per family and 30 across the current three-family baseline. The report exposes this as `routeAllocation`; planned or held slots do not count.

Promotion is a separate threshold of at least 20 valid independent invocations per diagnostics arm (`off` and `on`) across report rows. Meeting A0 allocation does not necessarily meet that threshold, and meeting either count does not cause this tool to claim freeze or promotion.

## Safe operator checklist

1. Copy `tools/a0/manifests/baseline.v1.json` to a new collection-specific manifest. Preserve the committed baseline unchanged; never run it as-is.
2. Reconcile declarations with current harness support. Keep obstruction and operator-hold NL unavailable until real NL support exists; do not execute their planned NL templates.
3. Assign unique `runId`, `invocationId`, and `expectedArtifactPath`. Assign a non-null shared `pairId` only to intentional one-off/on pairs. Keep retries inside one invocation.
4. Populate real immutable provenance before execution: current `gitCommit`; Mineflayer bot identity; server/protocol; supported dimension and reset policy; world/seed/reset identity; fixture ID, SHA-256, and coordinates; timeout and safety bounds. Use fresh world/reset identities once only, or a documented restored identity for a matched pair.
5. Replace incomplete/held metadata consistently. Runnable manifests and candidate-valid runs must be complete, have empty missing/blocker arrays, and have a real hash. Do not mark a run valid merely because an argv slot exists.
6. Only under separate live-world authorization, invoke an actually supported harness route externally. Resolve `${url}`, `${bot}`, and `${expectedArtifactPath}` without adding unsupported flags. Preserve each raw harness artifact byte-for-byte.
7. Run a collection/envelope step outside this five-file gate. It must retain the raw artifact and produce the canonical identity, completeness, safety/outcome, retry, terminal, elapsed, and pair fields required above. Derive comparison fingerprints and mutation findings from reviewable provenance; do not fabricate them.
8. After the manifest and artifact paths are final, set `manifestStatus: "runnable"`, manifest/run metadata to complete where truthful, compute `manifestHash`, and make no further un-hashed edits.
9. From the intended evidence root, aggregate once with the exact CLI. Redirect stdout to a new report file, capture the exit code, and do not overwrite raw artifacts.
10. Archive the runnable manifest, raw harness artifacts, enveloped canonical artifacts, stdout report, exit code, collection logs, and authorization/provenance record together. An exit `0` archives a complete report only; it is not a promotion action.

## Failure triage

- `2`: inspect sorted diagnostics for `/cli`, manifest read/JSON/hash/schema paths, malformed artifact JSON, or path escape. Correct the copied manifest/envelope or working directory; do not edit raw evidence to make it pass.
- `3`: inspect `totals.held`, `evidenceCompleteness`, each held row’s `missingFields`/`readError`, and manifest metadata. Collect missing facts or rerun a genuinely independent invocation; never coerce null to false.
- `4`: inspect `duplicate-*` and `diagnostics-contamination`. Preserve all files, stop the comparison, correct collection identity/reset discipline or diagnostics behavior, then recollect; do not deduplicate silently.
- `5`: inspect `pairComparisons` for missing/extra arms or comparison fingerprints. Repair the collection/envelope contract or recollect the pair; do not assume equivalence.
- `0`: archive the report and evaluate external allocation/kill criteria separately. Do not freeze or promote from this exit code.

## Focused validation

Run from the repository root:

```bash
node --test tests/control-plane/a0-aggregation.test.js
```

Current expected outcome: 16 tests passed, 0 failed.

Validate the committed planned baseline without treating it as runnable evidence:

```bash
node tools/a0/aggregate.mjs --manifest tools/a0/manifests/baseline.v1.json > /tmp/a0-baseline-report.json
code=$?
node -e "const r=require('/tmp/a0-baseline-report.json'); console.log({totals:r.totals, validN:r.measures.n, successRate:r.measures.success.rate, p50:r.measures.elapsedMs.p50})"
printf 'exit=%s\n' "$code"
```

Current expected outcome: parseable JSON, exit `3`, `totals` of `{ n: 30, valid: 0, held: 30, invalid: 0 }`, valid `n` of `0`, and null success rate and p50. The baseline remains unchanged.

Before committing documentation, also run:

```bash
git diff --check
git status --short
```

## Limitations and next blocker

The aggregator validates and summarizes files; it does not produce canonical evidence, verify semantic truth inside producer assertions, execute resets, or authorize/live-run a harness. Artifact objects are normalized by required-field checks but are not closed against extra properties. Artifact path containment is lexical resolution against the current working directory.

The explicit next blocker is to add real NL harness support for ordinary obstruction and operator hold, then add a collection/envelope step outside this five-file gate that converts preserved raw harness output into the canonical artifact contract. Until both exist and real metadata is collected, obstruction/operator-hold NL evidence cannot be valid, raw current harness output remains held, and no A0 evidence, freeze, or promotion claim is warranted.
