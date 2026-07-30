# Codeplan: requested versus verified world actions

## Contract and safety
- Required behavior: a server-side mutation request (teleport or cheat-mode setblock) must be represented as requested, not succeeded, until authoritative Minecraft state verifies its result.
- Acceptance criteria: the structured action contract carries a distinct requested state; direct chat/UI text says requested rather than completed; self-prompting cannot count it as verified progress or describe it as a terminal skill failure; failed/blocked/interrupted semantics remain intact.
- Must preserve: bounded action result shape, current result telemetry, direct world-skill return values, no automatic server-command retry, and no false claim when the server responds late or rejects a command.
- Out of scope: executing server commands, writing a plugin verifier, a broad action-result rewrite, or live/path/server testing.
- Workspace/user work: dirty/concurrent work is preserved.
- Pre-change checks: source contract inspection only; tests and runtime execution intentionally deferred.

## Repository evidence
- Cheat helpers set `outcome: '*_requested'` then return `true`; ActionManager currently maps every non-false return to `phase: succeeded`.
- `createActionResult` and telemetry validation permit only succeeded/failed/blocked/interrupted/cancelled, while message/UI presentation treats every non-succeeded result as a failure.
- SelfPrompter uses succeeded as verified progress and otherwise treats non-retryable results as a terminal failure, so requested needs dedicated handling.
- References: `src/agent/{action_manager,self_prompter}.js`, `src/agent/runtime/action-result.js`, `src/agent/library/skills.js`, dashboard result consumers.

## Mode
- Candidate mode: constrained
- Candidate count: 2
- Record profile: compact
- Reason: two materially distinct mechanisms can avoid false completion.

## Candidates
- V1 `explicit requested phase` (`result-schema,explicit-evidence,graceful-degrade,zero-dep`): carry `completion: requested` in skill evidence; ActionManager emits an allowed requested phase; presentation labels it distinctly; SelfPrompter pauses rather than claiming success/failure.
- V2 `bounded in-action postcondition verifier` (`polling-verifier,per-skill-state,timeout,zero-dep`): make each teleport/setblock action wait for a new position/block state with a timeout before returning success/failure.

## Divergence
- V1↔V2: V1 preserves the truth boundary at request acceptance and lets later authoritative telemetry prove completion; V2 attempts immediate verification per skill, increasing timing/chunk/server-version coupling and action latency.

## Paper gates
- V1 task fulfillment: pass — distinguishes accepted request from verified result without inventing server proof.
- V1 contract preservation: pass — extends the existing structured result enum and keeps all prior phases unchanged.
- V1 negative space: pass — does not relabel a request as a failure or success.
- V1 verification feasibility: pass — source contract can be inspected; live world proof is intentionally deferred.
- V2 task fulfillment: pass in principle — can verify selected mutations.
- V2 contract preservation: unknown — every target type has distinct state propagation and no live timing evidence is authorized, so it cannot be scored safely for this slice.

## IN
[codeplan · requested-world-action · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=explicit-requested-phase;V2=bounded-postcondition-verifier · lean: V1 · conservative: V1]

## Frozen rubric and scoring
- freeze: axes=truthfulness,architecture-fit,compatibility-risk,operability,delivery-cost classes=quality,quality,risk,quality,convenience weights=3,3,3,2,1 denominator=60 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer
- V1: 5,5,5,4,4 = 57/60 = 0.95 — matches the source of truth and keeps verification responsibility with later Minecraft state.
- V2: not scored — contract-preservation gate unknown without prohibited live timing evidence.
- arithmetic verification: (5*3)+(5*3)+(5*3)+(4*2)+(4*1)=57.
- formal baseline: V1.
- selection stability: V1 is the only scored eligible candidate.

## PLAN-OUT
[codeplan · requested-world-action · PLAN-OUT · mode: constrained · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1=0.95;V2=unscored-gate-unknown · reason: an explicit request state is the smallest truthful contract extension and avoids building unverified timing-dependent world polling. · planned-fingerprint: result-schema,explicit-evidence,graceful-degrade,zero-dep]

## Implementation plan
- Files/boundaries: action-result allowlist/messages, ActionManager result creation, explicit cheat evidence, SelfPrompter request handling, and existing browser labels.
- Ordered changes: mark asynchronous server requests explicitly; emit requested rather than succeeded; preserve requested status through telemetry and messages; stop autonomous work pending proof without calling it a failure; adapt dashboard result labels.
- Contract checks: no requested action returns a completed/succeeded label; failed/blocked/interrupted remain unchanged; legacy action evidence has no requested completion and retains prior semantics.
- Tests/checks: source and diff inspection only; no test, build, bot, server, or provider execution under the current user instruction.
- Rollback: requested is additive to the phase enum; removing the explicit evidence reverts only asynchronous request presentation.

## Implementation and evidence
- Changes: `requested` is now a valid action/telemetry phase; cheat teleports and setblock paths explicitly mark asynchronous completion; ActionManager maps that evidence to requested rather than succeeded; messages use “Requested”; SelfPrompter stops the active goal pending Minecraft verification.
- Pre/post comparison: prior server-side request actions emitted succeeded/Completed despite unverified state; they now retain their precise requested code/target and do not count as autonomous progress.
- Active evidence gates: phase allowlist, ActionManager branch, all five request-evidence sites, and known phase consumers were source-inspected. Runtime, world, bot, provider, build, and test gates were not run by user instruction.
- Corrections/re-plan: none; implementation remains within the selected explicit-result-schema/evidence/degrade fingerprint.

## EXEC-OUT
[codeplan · requested-world-action · EXEC-OUT · implemented: V1 · confidence: low · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: none · evidence: source inspection of result schema, action branch, self-prompt handling, cheat evidence sites, and presentation consumers only; no bot, server, world, build, or test execution]
