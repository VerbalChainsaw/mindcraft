# Codeplan: Single-bot lifecycle and result teardown

## Contract and safety
- Required behavior: Stop, death, kick, disconnect, and process exit release the one bot's loops, resumable work, prompts, movement controls, and vision work exactly once while retaining structured failure/result truth.
- Must preserve: ActionManager ownership/priority, operator hold, exact structured result shape, child-process lifecycle ownership, and all concurrent dirty work.
- Out of scope: server/dashboard activation, provider calls, squads, tests, restarts, and new abstractions.
- Workspace/user work: present; protected. Pre-change checks: not run by user instruction.

## Repository evidence
- `Agent.start()` and `startEvents()` each bind disconnect listeners; the latter paths call `cleanKill()` directly, while the former exits directly.
- `startEvents()` owns an infinite update loop and an idle resume timeout without stored handles; `cleanKill()` saves/history-chats then exits without coordinating prompt/action cleanup.
- `ActionManager.stop()` is bounded and has the existing action ownership/result seam.

## Candidates
- V1 `exit-local-cleanup`: add cleanup to every kick/end/death/exit callback; lowest local effort but duplicates cleanup races.
- V2 `agent-owned-idempotent-teardown`: retain one Agent cleanup promise/handle registry and route every terminal callback through it before exit; preserves one ownership boundary and bounds duplicate signals.

## Paper gates
- V1: fail - duplicated terminal signals can still race independent cleanup.
- V2: pass - uses existing Agent/ActionManager ownership with no new dependency.

## IN
[codeplan · lifecycle-result-teardown · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=exit-local-cleanup/local-callbacks;V2=agent-owned-idempotent-teardown/instance-state,bounded-cleanup,existing-action-boundary · lean: V2 · conservative: V1]

## Frozen rubric and scoring
- freeze: axes=ownership,idempotency,verification-scope,effort classes=quality,risk,risk,convenience weights=3,3,2,1 denominator=45 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer
- scores: V2=0.91; V1=disqualified. Arithmetic: (5*3 + 5*3 + 4*2 + 3*1)/45 = 0.91.

## PLAN-OUT
[codeplan · lifecycle-result-teardown · PLAN-OUT · mode: constrained · profile: compact · pick: V2 · baseline: V2 · confidence: high · beatBaseline: baseline-wins · scores: V2=0.91;V1=disqualified · reason: one Agent-owned teardown prevents duplicate terminal callbacks from bypassing the existing bounded ActionManager boundary · planned-fingerprint: instance-state,idempotent-teardown,bounded-action-stop,handle-registry]

## Implementation
- Add one idempotent Agent teardown boundary and tracked update/idle handles.
- Route duplicate terminal events through that boundary, preserving sanitized diagnostics.
- Stop prompt/action/resume/movement/vision work before process exit.
- Verify only focused syntax, diff formatting, and changed-line rereads.

## EXEC-OUT
[codeplan · lifecycle-result-teardown · EXEC-OUT · implemented: V2 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: terminal callbacks now share Agent teardown; update and idle-resume handles are owned and cleared · evidence: node --check src/agent/agent.js passed; scoped git diff --check passed; terminal, timer, ActionManager, and vision call sites re-read]

## EXEC-OUT
[codeplan · lifecycle-result-teardown · EXEC-OUT · implemented: V2 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: spawn timeout and spawn initialization failures now use idempotent teardown, the spawn timer is owned and cleared, and death performs bounded current-work cleanup without killing the respawning runtime · evidence: focused node --check and git diff --check passed for agent.js and the awaited end-goal command; live disconnect, death, and process-exit execution remain deferred]
