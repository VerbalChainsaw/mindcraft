# Codeplan: Critical-path single-bot acceptance

## Contract and safety
- Required behavior: finish master-plan items MP-001 through MP-006 without a granular test campaign.
- Acceptance criteria: critical runtime modules produce expected structured output; one bounded verifier supports dry-run and controlled live checks; current service limitations are recorded honestly; the master plan and verification record reflect proved versus blocked work.
- Must preserve: the shared dirty checkout, existing action/lifecycle contracts, local profiles, pre-existing processes, and user authority over external services.
- Out of scope: broad suite sweeps, per-function tests, squad soak, UI redesign, release work, commits, and publication.
- Workspace/user work: heavily present and protected.
- Pre-change checks: the combined lifecycle/finalization/readiness test command exceeded 60 seconds and its two remaining Node test processes were terminated; no source was changed by that command.

## Repository evidence
- Node's built-in test runner and strict assertions are the local test pattern.
- `action-result.js` and `gameplay-safety.js` are dependency-light critical seams with observable output.
- MindServer exposes bounded HTTP health/agent state plus dashboard Socket.IO start, stop, message, and state events.
- No Mindcraft/Java process is active; configured Ollama and Minecraft endpoints are currently unreachable.

## Mode
- Candidate mode: constrained
- Candidate count: 2
- Record profile: compact

## Candidates
- V1 `critical-output-gate`: one small real-module test, one explicit lint/syntax gate, and one built-in HTTP/Socket.IO verifier with bounded cases and cleanup.
- V2 `granular-matrix`: extend all lifecycle, gameplay, NPC, provider, dashboard, and role suites before building a full runtime harness.

## Divergence
- V1 exercises only the stable output boundaries needed to decide readiness quickly; V2 maximizes coverage through the exact granular campaign the user rejected.

## Paper gates
- V1: pass - satisfies the narrowed request using existing dependencies and observable structured output.
- V2: fail - violates the explicit speed and granularity constraint.

## IN
[codeplan · critical-path-acceptance · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=critical-output-gate/builtin-test,bounded-verifier,condition-polling;V2=granular-matrix/broad-suites,full-case-harness · lean: V1 · conservative: V1]

## Frozen rubric and scoring
- freeze: axes=repository-fit,output-proof,regression-risk,speed classes=quality,quality,risk,convenience weights=3,3,2,3 denominator=55 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer
- V1=0.91: (5*3 + 4*3 + 4*2 + 5*3)/55=50/55.
- V2=disqualified before scoring.

## PLAN-OUT
[codeplan · critical-path-acceptance · PLAN-OUT · mode: constrained · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1=0.91;V2=disqualified · reason: the existing structured seams and control contracts support direct output proof without the rejected broad matrix · planned-fingerprint: builtin-test,bounded-verifier,condition-polling,explicit-cleanup]

## Implementation
- Create one critical-output test for action results, gameplay safety, and runtime case normalization.
- Add one `test:critical` and one `check:critical` package script covering only critical files.
- Create a zero-new-dependency verifier with dry-run, preflight, critical live cases, bounded polling, evidence output, and cleanup limited to its selected bot.
- Run dry-run and critical static/output gates.
- Attempt live preflight and only the service-supported critical cases.
- Update the verification record and master plan with exact proved/blocked status.

## EXEC-OUT
[codeplan · critical-path-acceptance · EXEC-OUT · result: pass · gate: npm-run-check-critical/3-pass-0-fail,lint-clean,syntax-clean,focused-diff-clean · runtime: MindcraftBot/world-ready,stay-succeeded,bot-stopped · evidence: primary-single-bot-preflight.json,primary-single-bot-live.json,PRIMARY-SINGLE-BOT-RUNTIME.md · cleanup: dashboard-stopped,minecraft-stopped,ollama-stopped,ports-closed · deferred: broad-matrix,full-suites,browser,packaging,release]
