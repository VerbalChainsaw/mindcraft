# Codeplan: Runtime verifier review fixes

## Contract and safety
- Required behavior: eliminate false-positive lifecycle acceptance, make preflight a real gate, refuse occupied worlds, reconcile cleanup after uncertain start acknowledgement, keep dry-run/live commands identical, and check formatting for untracked critical files.
- Acceptance criteria: pure focused tests reject wrong action results and invalid preflight state; dry-run reports the live command; verifier fails closed when world occupancy cannot be proved; cleanup evidence is retained; one critical gate passes.
- Must preserve: existing MindServer APIs, the shared dirty checkout, stopped pre-existing bots, and the user’s no-broad-testing/no-visible-command-window direction.
- Out of scope: broad suites, live service launch, MindServer redesign, commits, packaging, and release work.
- Workspace/user work: present and protected.
- Pre-change checks: independent review reproduced five important verifier defects and one format-gate overstatement; the earlier critical gate passed before these fixes.

## Repository evidence
- MindServer already exposes managed-server status, logs, and a bounded console-command route.
- Paper/Java `list` emits an authoritative player count into managed logs without changing world state.
- Agent lifecycle state is available through `/api/agents`; Socket.IO supplies bounded start/stop acknowledgements.
- Existing critical tests use Node’s built-in runner and may import dependency-light pure helpers.

## Mode
- Candidate mode: constrained
- Candidate count: 2
- Record profile: compact

## Candidates
- V1 `verifier-local/fail-closed/reconcile`: export pure acceptance helpers, query managed occupancy through the existing `list` route, treat an emitted start as cleanup-owned until stopped state is proved, and scan critical files directly for format defects. Low API surface; managed worlds only unless explicitly authorized.
- V2 `new-api/correlation-id/server-owned`: add player-occupancy and lifecycle-correlation APIs to MindServer, then rebuild the verifier around those contracts. Stronger long-term coordination, but crosses the control-plane boundary and requires broader tests.

## Divergence
- V1 keeps safety logic inside the verifier and composes existing contracts; V2 changes server APIs and lifecycle identity semantics, increasing reach and verification cost.

## Paper gates
- V1: pass - satisfies every current finding using existing zero-dependency boundaries and focused tests.
- V2: pass - technically stronger for future external-server support, but disproportionate to this critical verifier repair.

## IN
[codeplan · runtime-verifier-review-fixes · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=verifier-local/fail-closed,reconcile,zero-dep;V2=new-api/correlation-id,server-owned · lean: V1 · conservative: V1]

## Frozen rubric and scoring
- freeze: axes=repository-fit,safety-correctness,verifiability,regression-risk,delivery-cost classes=quality,risk,quality,risk,convenience weights=3,3,3,2,1 denominator=60 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer
- V1: `(5*3 + 4*3 + 5*3 + 4*2 + 4*1)/60 = 54/60 = 0.90`.
- V2: `(3*3 + 5*3 + 4*3 + 2*2 + 2*1)/60 = 42/60 = 0.70`.
- Formal baseline: V1. Selection is stable and V1 has the smaller regression surface.

## PLAN-OUT
[codeplan · runtime-verifier-review-fixes · PLAN-OUT · mode: constrained · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1=0.90;V2=0.70 · reason: existing status, command, log, and lifecycle contracts can close the reviewed holes without expanding the public control plane · planned-fingerprint: verifier-local,fail-closed,reconcile,zero-dep]

## Implementation
- Export pure preflight, action-result, and player-list acceptance helpers.
- Make the lifecycle case own its command and expected result in the runtime-case manifest.
- Require healthy/reachable registered-stopped preflight state.
- Prove an empty managed world through a fresh `list` response or require explicit authorization.
- Mark ownership before awaiting start acknowledgement and reconcile actual bot state during cleanup.
- Return structured failure and cleanup evidence instead of losing it in the top-level catch.
- Add direct critical-file format scanning and focused tests for the repaired contracts.
- Run only `npm run check:critical`, then update completion evidence.

## EXEC-OUT
[codeplan · runtime-verifier-review-fixes · EXEC-OUT · implemented: V1 · confidence: high · verification: passed · mechanism-check: passed · plan-history: unchanged · corrected: format-checker wrapped for repository lint compatibility · evidence: 6-tests-pass,lint-pass,syntax-pass,7-file-format-pass,no-services-launched]
