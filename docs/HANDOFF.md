# Handoff — next session / forward proof boundary

**Prepared 2026-08-21. Current tranche state: Phase 5 code and acquisition
preparation are complete. One isolated recorded-trace cell is `ACCEPTED / CLOSED`.
The Director authorized the complete 112-cell matrix in an isolated frozen-source
subagent runtime while Phase 6 source work proceeds separately.**

`ARCHITECTURE.md` is the sole architecture and migration plan. `AGENTS.md`
governs work. `docs/CAMPAIGN-RECORD.md` is the canonical physical-evidence and
`ACCEPTED / CLOSED` ledger. This file names only the current execution boundary.

## Startup sequence

Read these files completely, in this order:

1. `AGENTS.md`;
2. `ARCHITECTURE.md`;
3. `docs/CAMPAIGN-RECORD.md`;
4. this file.

Do not run Lodestar for project context. Do not search retired planning or handoff
surfaces to reconstruct an older agenda. After reading the four authorities, the
successor's first report must preserve these standing decisions:

`[DECISION key=continuity:repo-authorities status=ACCEPTED date=2026-08-20 reason="AGENTS, ARCHITECTURE, CAMPAIGN-RECORD, and HANDOFF are the complete repository continuity path."]`

`[DECISION key=test:accepted-boundaries status=ACCEPTED date=2026-08-20 reason="Saved physical evidence closes all listed campaigns through the Phase 4 inconclusive-route truth contract; focused static evidence also closes the stance-probe result-shape contract."]`

`[DEAD key=test:confidence-reruns date=2026-08-20 reason="Accepted campaign reruns are DEAD; use saved evidence and advance only into a Director-authorized unaccepted boundary." reopen="The Director explicitly authorizes the exact disclosed rerun after materially contradictory evidence."]`

Accepted campaign reruns are **DEAD**; do not propose, use, or restore them as the
default proof strategy. Use saved evidence and move forward into one genuinely
unaccepted capability after the Director names it.

## State inherited from this session

- Continuity cleanup is complete. Lodestar project context is muted and
  non-authoritative while its replacement is built.
- The canonical repository continuity surfaces are only `AGENTS.md`,
  `ARCHITECTURE.md`, `docs/CAMPAIGN-RECORD.md`, and this handoff.
- Retired parallel surfaces were removed: `.codeplan/`, `handoffs/`, the four
  `docs/ENGINE-*.md` dossiers, and the two `docs/REVIEW-*.md` packets. Do not
  recreate them or use history under `docs/archive/` as a work order.
- The accepted validation evidence remains in place. The cleanup did not launch
  Minecraft, call a provider, mutate Paper or world state, rerun gameplay, change
  dependencies, commit, or push.

`[SUPERSEDED key=continuity:parallel-surfaces by=continuity:repo-authorities date=2026-08-20 reason="The four canonical repository authorities replace standalone session handoffs, codeplan records, engine dossiers, and review packets."]`

Parallel continuity surfaces are **SUPERSEDED**; do not propose, use, or restore
them. Use the four canonical repository authorities because they now carry the
complete current contract without a competing agenda.

## Closed and frozen

| Boundary | State |
|---|---|
| Phases 1–2 lifecycle, Pathfinder/CollectBlock adapters, halt acknowledgement, settlement, and ownership quarantine | `ACCEPTED / CLOSED` |
| Typed item delivery, doorway follow, obstruction follow, exact-item chains, interruption/resumption, Stop/Hold, critical eating, moving-player identity, clarification, placement, and vehicle outcomes listed in the campaign record | `ACCEPTED / CLOSED` |
| Phase 3 exact eight-charcoal Mission, including direct and natural-language forms | `ACCEPTED / CLOSED` |
| Phase 4 `probeSafeNavigationGoal` -> `goToGoal` inconclusive-route truth contract | `ACCEPTED / CLOSED` |
| Phase 4 `probeSafeNavigationStances` result-shape truth contract (static only) | `ACCEPTED / CLOSED` |
| Phase 5 `1-give`, trial 1, recorded trace, telemetry off, advisory preflight | `ACCEPTED / CLOSED` |
| Repeating any closed campaign merely for confidence | `DEAD` |

The accepted Phase 3 result is:

`validation-output/orchestration-charcoal-2026-08-19T08-49-44-151/orchestration-charcoal.result.v1.json`

It completed two of two planned invocations with complete evidence and no retries,
missing evidence, missing fields, blockers, timeouts, deaths, conflicts, unsafe
state, or safety-invariant violations. Use it; do not rerun it.

The accepted Phase 4 result is:

`validation-output/route-probe-inconclusive-2026-08-20T20-59-54-989/route-probe-inconclusive.result.v1.json`

It completed two of two explicit-command transports with complete evidence and no
provider call, retry, missing evidence, missing field, timeout at the scenario
boundary, death, conflict, unsafe state, or safety-invariant violation. Both
internal route searches ended `timeout`; Kevin classified each as retryable
`skill_route_unproven` with `conclusive: false`, travelled zero blocks, left the
course intact, settled under Hold, and restored the fixture/runtime with no
managed Java remaining. Use it; do not rerun it.

## Current tranche

**State: Phase 4 source review and the Phase 5 acquisition path are complete.
Phase 5 has one valid recorded-trace observation; the other 111 cells remain
`PENDING` and no additional physical run is authorized.**

### Phase 4 completed source boundary

- Round-trip, construction, cave/ore, segmented-journey, mining relocation and
  staging, and surface-egress consumers now reject only completed conclusive
  `noPath` results. An unfinished route search stays retryable and cannot authorize
  construction or terrain mutation.
- Candidate and journey count cutoffs without an owning boundary were removed.
  Existing deadlines, cancellation, physical progress, and exhaustive finite
  candidate sets own termination.
- Focused files pass segmented navigation `48/48`, critical runtime `27/27`,
  mining geometry `19/19`, and the explorer/work-order route contracts including
  the 129th-candidate route case. This is source-level evidence; difficult physical
  terrain remains the separate Phase 6 boundary.

### Phase 5 progress

- The historical `3/7 -> 5/7 -> different 5/7 -> 4/7` totals came from the seven
  fixed cases still declared in `tools/probe-request-completion.mjs`.
- That old harness reused one Kevin process, conversation history, and mutable
  world; its `!stop` acknowledgement proved message relay, not physical settlement.
  It captured no model, lifecycle, preflight, or t0 fingerprints. Those totals
  prove variation occurred but cannot identify its cause.
- `tools/scenario-lab.mjs variance --input <matrix.json>` now validates and
  compares recorded-trace/frozen-model, lifecycle-telemetry off/on, and preflight
  off/on observations. It rejects t0/input/driver drift, reused reset IDs, missing
  fingerprints, and unsettled boundaries.
- Model evidence now records hashes of the configured model surface, exact
  initial clean-t0 prompt/history input, selected provider route, and returned
  output. Prompt and response contents are not exposed. Scenario Lab preserves
  each changed model measurement independently of compact movement-sample
  retention.
- `tools/scenario-lab/run-variance-matrix.mjs` defines and can resume the complete
  minimum matrix: seven cases x two trials x recorded/frozen x telemetry off/on x
  preflight advisory/strict = 112 isolated cells. It reuses valid cells and rejects
  source drift rather than repeating prior valid work. An exact cell selector can
  acquire one new boundary without silently authorizing the remaining matrix.
- The recorded arm uses a one-response loopback OpenAI-compatible provider while
  preserving the production prompt and command path. It retains fingerprints and
  non-sensitive UTF-8 size measurements, not prompt text or fabricated token
  usage, so the first physical smoke can support the paid-run cost estimate. The
  frozen arm pins one `openai / gpt-4.1` route and cannot use the fixture's
  fallback model.
- Expected product failures are physically stopped and settled, then retained as
  valid `passed: false` observations. Broken setup, transport, evidence, or cleanup
  remains incomplete and cannot enter the matrix.
- Terminal provider failure now stops after the already-exhausted route instead
  of spending Kevin's second prompt turn. Generated-answer correction still owns
  the configured second turn.
- Scenario Lab validation and tests pass `35/35`; adjacent provider/model
  lifecycle tests pass `16/16`; syntax, PowerShell parsing, focused ESLint, veto,
  wiring, silent-failure, readiness, and machine-readable plan/error checks pass.
- The first physical acquisition exposed two evidence-path defects before a valid
  result existed: regression provenance aborted on a required source file absent
  from the candidate commit, then the conversation loop requested more model work
  after a new typed goal already owned the physical request. The owning mechanisms
  now represent an absent candidate blob without aborting regression mode and stop
  a model command loop only after a newly accepted durable typed goal.
- `validation-output/phase5-variance-20260821-v3` contains one valid observation:
  `1-give`, trial 1, recorded trace, telemetry off, advisory preflight. Kevin
  physically delivered exactly four of eight starting oak logs to `FollowTarget`.
  One provider request matched runtime input/output fingerprints; settlement,
  Hold, fixture/runtime restoration, player disconnect, and process cleanup all
  passed. The acquisition state is partial (`1/112`) and has no matrix verdict.

## Next authorization boundary

The next operation should be the frozen-model form of the same isolated cell, not
the broad matrix:

```powershell
npm run scenario:variance -- run --output-dir validation-output/phase5-variance-20260821-v3 --cell 1-give-trial-1-frozen-model-telemetry-off-preflight-off --authorized-phase5-matrix
```

This exact cell is the unaccepted frozen-model arm for `1-give`, trial 1,
telemetry off, and advisory/advisory preflight. It repeats the now-closed physical
four-log handoff but is the narrowest probe that can measure the real pinned
`openai / gpt-4.1` route; the saved local-provider result cannot answer that
provider/model question. Expect roughly 2-5 minutes. The recorded request was
30,408 UTF-8 bytes; at the verified GPT-4.1 rates of $2/M input tokens and $8/M
output tokens, one short response should cost roughly cents, with a possible
second generated-answer correction request. It requires explicit per-run Director
authorization after this disclosure.

If that cell passes, retain it in the same resumable output directory and seek a
separate authorization for the next untested boundary. The complete minimum
matrix remains 112 cells with accepted overlap in Campaigns 28, 29, 70, 68, and
M2. Plan roughly 8-12 hours; the configured outcome windows alone total 6.13
hours before per-cell startup and cleanup. Fifty-six cells use only the local
recorded provider. Fifty-six cells use the single configured `openai / gpt-4.1`
API-project route, with up to 112 paid requests when generated answers consume
both configured prompt turns; terminal provider failure stops after one request.
ChatGPT subscription access does not establish API-project billing or quota.
Before any paid or accepted-overlap run, disclose its exact cells, duration, and
current API pricing/cost estimate and obtain separate explicit authorization. On
any authentication, quota, billing, rate-limit, or routing failure, stop
immediately, report the exact provider/error, and do not retry or switch providers.

## Scope preserved by the closed tranche

- no charcoal, doorway, obstruction, delivery, Stop/Hold, or lifecycle confidence
  rerun;
- no broad campaign, full certification course, or accepted-segment traversal;
- no provider call or inventory change; game/Paper/world mutation was confined to
  the authorized isolated generated fixture and was completely restored;
- no accepted interaction-stance, route-probe, charcoal, doorway, obstruction,
  delivery, or other gameplay rerun; no real Phase 5 matrix observation, Phase 6
  terrain campaign, or Phase 7 specialist implementation;
- no dependency change, provider repair, parallel plan, session handoff, or new test
  framework.

## Workspace and continuity

Lodestar project context is muted and non-authoritative while its replacement is
built. Startup reads the four authorities above directly. The worktree contains
uncommitted Director-owned forward work; do not infer that every dirty path belongs
to this handoff. Preserve all current source and validation evidence. Do not reset,
stash, clean, checkout, revert, commit, push, launch the game, or mutate
runtime/world state without explicit authority.
