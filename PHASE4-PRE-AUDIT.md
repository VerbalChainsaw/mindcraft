# Phase 4 preflight/probe pre-audit — for the Codex session

**Author:** Director session (DSH), 2026-08-19, by explicit request ("write this to file as a pre-audit for Codex").
**Status:** READ-ONLY audit deliverable. No source file was modified by this audit. No game launch, server start,
runtime/world mutation, dependency change, commit, or push is authorized by this document.
**Governance:** `ARCHITECTURE.md` is the sole active architecture; `docs/HANDOFF.md` names the exact tranche;
`docs/CAMPAIGN-RECORD.md` is the non-regression ledger. This document is a work item / evidence carrier for
Phase 4 (preflight/probe audit and reversible demotion), not a competing plan or ruleset.

---

## 1. Why this exists

The "several revisions of the logic/engine/combo" pattern is a measured history, not a current defect:
there were many genuinely good campaigns, each followed by a different failure at the next seam
(`docs/CAMPAIGN-RECORD.md`). `ARCHITECTURE.md` §13 closes the redesign paths (8 DEAD hypotheses, 32 superseded
mechanisms). The current Mission → causal planner → hard-band arbiter → ActivityExecutive architecture is settled.
The remaining work is the canonical migration order on evidence — Phase 4 is the next tranche.

Phase 3 (one charcoal Mission family) is implemented and physically verified:
`validation-output/orchestration-charcoal-2026-08-19T08-49-44-151/orchestration-charcoal.result.v1.json` is
`passed` / `verified-complete`, 2/2 invocations (direct + natural-language), all 7 expected evidence items
observed, no missing evidence, no safety violations. Runtime was DOWN at audit time (8080/8081 refused).

## 2. Baseline

`npm run audit:veto` (2026-08-19) over 175 source files:

```
PRE_ENGINE_VETO: 0
INCONCLUSIVE_AS_IMPOSSIBLE: 0
NAMED_POLICY_VETO (accepted): 20
```

The movement-capability veto surface is clean. The remaining problem class is **route-probe consumers**,
which the static audit cannot see (see `tools/veto-audit.mjs` header: "an unfinished search reported as a fact").

## 3. Probe core is sound

The probe implementations already implement the navigation contract correctly. Do not change their semantics:

- `probeSafeNavigationFrom` (`src/agent/library/skills.js`) returns
  `conclusive: probeStatus === 'success' || probeStatus === 'noPath'` — only a **finished** search that found
  nothing is terminal; `partial` (RUNNING) and `timeout` (UNKNOWN) are not.
- `probeSafeNavigationStances` returns `{ reachable, conclusive, status, pathLength, terminalPosition? }`, with
  `conclusive: false` for `route_probe_unavailable` / `route_probe_error`.
- `probeSafeRoundTripNavigationStances` requires BOTH legs finished before `conclusive: true`.

## 4. Findings (per-consumer classification)

### Finding 1 — `probeSafeNavigationGoal` drops `conclusive` (highest leverage)

`probeSafeNavigationGoal` (exported from `src/agent/library/skills.js`) returns only
`{ reachable, status, pathLength }` on success and `{ reachable: false, status: 'route_probe_error', ... }` on
error. It **discards `conclusive`**, unlike its sibling `probeSafeNavigationStances`.

Consumers of this API:
- `goToGoal` — initial whole-route proof branch (`options.requirePlannedRoute === true`), then one local-egress
  recovery + one wider re-probe, then `runSegmentedJourney` or `path_not_found` (`retryable: true`).
- `runSegmentedJourney` — direct-route shortcut probe before falling back to segments.

Because `conclusive` is dropped, neither consumer can distinguish `noPath` (terminal for the effective profile)
from `timeout` (UNKNOWN) or `partial` (RUNNING). Per ARCHITECTURE §3.6 / §13.2 items 10–13, timeout is
inconclusive and must not become a terminal refusal.

**Classification: probe defect, not a demotion.** Propagate `conclusive` through `probeSafeNavigationGoal`
exactly as `probeSafeNavigationStances` does, then gate consumers on it.

### Finding 2 — `collection-candidate-selector` internal contradiction

`src/agent/runtime/collection-candidate-selector.js`:

- `ROUTE_PENALTIES` gives `partial: 55` and `timeout: 75` — i.e. reachable with a finite penalty.
- `UNREACHABLE_ROUTE_STATUSES` contains `timeout`, `probe_error`, `unknown`, `action_deadline` — i.e. terminal.

`timeout` appears in BOTH sets; since `scoreCandidate` computes `reachable = !UNREACHABLE_ROUTE_STATUSES.has(...)`,
the UNREACHABLE set wins: a `timeout` candidate is dropped from ranking entirely. `partial` (RUNNING) is
reachable-with-penalty while `timeout` (UNKNOWN) is a hard veto — internally inconsistent and contrary to the
contract. `probe_error`, `unknown`, and `action_deadline` are also not finished searches and should not be
terminal.

The codebase already papers over the worst case: `collectionRejectionsAreAllTimeouts` (skills.js) triggers one
wider re-probe (`COLLECTION_ROUTE_PROBE_RETRY_TIMEOUT_MS`) before concluding `unreachable`. That is a
compensating patch, not the owning fix; mixed status sets still silently drop timeout candidates.

**Classification: demotable behind a reversible flag.** Only `noPath` (and the assessment/policy codes
`no_safe_stance`, `unsafe_drop_support`, `target_unloaded`, `action_deadline` as *feasibility* answers, not
search outcomes) should be terminal. `timeout` / `probe_error` / `unknown` should move to `ROUTE_PENALTIES`
(reachable, high penalty).

### Finding 3 — construction-site selection throws on inconclusive

`src/agent/commands/actions.js` construction-site binding: `probed.find(candidate =>
candidate.routes.every(route => route.reachable))`, then `if (!site) throw new TypeError(...)` with a
"natively reachable" sentence. Each site's routes come from `probeSafeNavigationStances`. A single probe
`timeout` on any geometrically valid site therefore becomes a **whole-order refusal**; the probe's
`conclusive: false` is never read.

**Classification: demotable.** Refuse the order only when every candidate site is conclusively rejected
(every route `conclusive` and unreachable). Otherwise select the best-scored site and let `goToGoal` execute
with its existing segmented/recovery path — the replacement is already covered.

### Finding 4 — `reachInteractionStance` emits PATH_NOT_FOUND on inconclusive

`reachInteractionStance` (exported from `src/agent/library/skills.js`): `if (!route.reachable)` →
`interactionStanceFailure(INTERACTION_STANCE_FAILURE_STAGES.PATH_NOT_FOUND, { code: route.status })`.
A probe `timeout` becomes planning stage `failed` and refuses the interaction. Consumers: container approach,
fixture placement/orientation, workstation stance, and the shared interaction-stance receipts
(`src/agent/runtime/interaction-stance.js`). The receipt contract already supports planning `unknown`; an
inconclusive probe should produce planning `unknown` (retryable), not `failed`.

**Classification: demotable.** Only a conclusive `noPath` (under the effective Movements) is PATH_NOT_FOUND;
inconclusive → planning `unknown` + bounded wider re-probe, then retry.

### Finding 5 — `runSegmentedJourney` counts inconclusive as route_unproven

`runSegmentedJourney` (skills.js): `if (!probe.reachable)` → `unprovenCandidates += 1` and receipt
`route_unproven`, without consulting `conclusive`. With Finding 1 fixed, gate this on `conclusive` so only
finished searches that found nothing count toward `SEGMENT_JOURNEY_MAX_UNPROVEN_CANDIDATES`.

**Classification: demotable (small).** Same flag family as Finding 1.

## 5. Already correct — model consumers, do not change

- `bindExposedOre` (`src/agent/runtime/capability-catalogue.js`) — counts `inconclusiveSkips` when
  `route.conclusive === false`, returns `inconclusive: true` + honest detail while keeping the legacy
  `resource_not_found` code for downstream matching. **The reference implementation to copy.**
- `job-director` blueprint escape check — `if (!escape.reachable && escape.conclusive !== false)` gates
  `trapped_exit`; an unproven exit route proceeds with a recorded reason.
- `survival-director` shelter routing — returns `inconclusive: route.conclusive === false` + routeStatus.
- `world.js` `assessClearPath` / `isClearPath` — three-state (`yes`/`no`/`inconclusive`), fails open.
- `goToGoal` terminal failure — `retryable: true`, local egress recovery first, segmented journey fallback.
- Mining relocation (`skills.js`) — failed open-route round-trip falls through to the deterministic corridor.
- `stageMiningStaircase` — staging-skip only, falls through to further candidates.
- `attemptLocalNavigationEscape` — recovery attempt, honest outcome, not a world claim.

## 6. Keep — legitimate, never demote

- `src/agent/runtime/mining-corridor-planner.js` — the bounded 429-line deterministic excavation-corridor
  search. ARCHITECTURE §4 and the audit targets list name it legitimate. It is an excavation planner, not a
  second voxel-topology oracle. Not part of this demotion.
- Round-trip proof inside return-sensitive mining (preserved return route, mining relocation).
- Bed sleep stance envelope (`isBedSleepStandingStance`) and the interaction-stance receipts themselves.
- The `conclusive` semantics of the probe core (Section 3).

## 7. Reversible-demotion plan

No per-consumer flags exist today (verified by grep for `enable*preflight`, `bypass*preflight`,
`shadow*comparison`, `reversible*flag`, `feature_flag`). Per ARCHITECTURE Phase 4: demote only where the
replacement path is covered, behind **per-consumer reversible flags**, keep strong proof for named atomic or
returnability-critical transactions, and never change the global partial executor or global traversal policy.
One selected path may control the body; shadow may observe only.

| Flag (default) | Gate it demotes | Replacement path |
|---|---|---|
| `preflight.probeGoalConclusive` (on) | Finding 1 | Propagate `conclusive` through `probeSafeNavigationGoal`; `goToGoal` treats `timeout` as UNKNOWN/retryable instead of `path_not_found` |
| `preflight.collectionRoutePenalizesTimeout` (off) | Finding 2 | Move `timeout`/`probe_error`/`unknown` to `ROUTE_PENALTIES`; keep `noPath` + assessment codes terminal |
| `preflight.constructionSiteInconclusiveOk` (off) | Finding 3 | Refuse only when every candidate route is conclusive `noPath`; else best-scored site + `goToGoal` execution |
| `preflight.interactionStanceInconclusiveOk` (off) | Finding 4 | Inconclusive → planning-`unknown` receipt + bounded wider re-probe, then retry |
| `preflight.segmentedProbeRequiresConclusive` (on) | Finding 5 | Count only conclusive failures toward `unprovenCandidates` |

Suggested namespace: profile/settings object (like `settings.charcoal_mission_mode`), default = current
behavior, per-consumer names, one body-controlling path at a time.

## 8. Required verification (before and after any change)

1. `npm run audit:veto` — movement-capability and profile-veto regressions (baseline above).
2. `npm run audit:wiring` — wiring audit (assert).
3. `npm run audit:silent` — silent-failure sweep.
4. `npm run scenario:doctor` — scenario harness health.
5. Focused control-plane tests (action-manager lifecycle, action-correlation, charcoal-mission).
6. Existing charcoal-family Scenario Lab orchestration under Operator Hold: preflight gates in legacy mode and
   in bypass/shadow mode per consumer, with only the selected path controlling the body. Read aggregate
   verdicts, physical evidence, lifecycle telemetry, custody/delivery/return/cleanup — not invocation flags.
7. Preserve the existing Pathfinder/CollectBlock lifecycle regression coverage (Phases 1–2 accepted segments
   stay closed; do not rerun without explicit per-run authorization).

## 9. Operating constraints (from AGENTS.md and the session contract)

- Accepted test segments stay `ACCEPTED / CLOSED`; do not rerun or traverse them without explicit per-run
  authorization. Use saved evidence and the smallest probe for only the unresolved boundary.
- Preserve all dirty, staged, untracked, and concurrent work. Never reset, stash, clean, checkout, revert,
  commit, push, change dependencies, launch the game, or mutate runtime/world data without explicit
  authorization.
- On provider authentication, quota, billing, rate-limit, or routing failure: stop and report immediately; do
  not retry or switch providers without approval.
- Current source outranks this document's symbol claims if they drift — re-inspect before each change
  (DEAD-8/DEAD-28 doctrine: discriminating probes and current source beat static speculation).
