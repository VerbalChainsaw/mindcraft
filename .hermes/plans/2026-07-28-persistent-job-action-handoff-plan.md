# Codeplan: Persistent-job action handoff

## Contract and safety
- Required behavior: a newly assigned durable job must take control from an indefinite Follow/Guard or other current action instead of remaining accepted but undispatched.
- Acceptance criteria: player assignment stops self-prompt autonomy, cancels resumable movement, waits boundedly for the current action to yield, then submits; an unresponsive action blocks submission and holds the bot with an exact reason.
- Must preserve: operator Stop, ActionManager's bounded interrupt contract, job persistence, structured outcomes, and survival arbitration.
- Out of scope: scheduler rewrite, forced process restart, live activation, and regression testing.

## Repository evidence
- `JobDirector.update()` requires `agent.isIdle()`.
- Follow/Guard use resumable ActionManager actions and can remain active indefinitely.
- Persistent assignment metadata stops only `SelfPrompter`; it neither cancels the resumable action nor calls bounded `ActionManager.stop()`.
- Ordinary `runAsAction` commands perform that handoff internally, but work-order assignment commands intentionally do not enter ActionManager.

## Candidates
- V1 `scheduler-preemption`: let JobDirector forcibly stop any action during every update. This risks stealing control from unrelated explicit commands and creates repeated stop attempts.
- V2 `assignment-boundary-handoff`: perform one bounded ownership transfer only when a player assigns the job, before submission.

## PLAN-OUT
[codeplan · persistent-job-action-handoff · PLAN-OUT · mode: constrained · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.58;V2=0.92 · reason: assignment is the exact ownership boundary, so a one-time bounded handoff avoids scheduler-wide preemption while guaranteeing the accepted job can run · planned-fingerprint: existing-module,request-driven,interruptible,graceful-degrade]

## Implementation
- Add one Agent helper that stops model autonomy, cancels resume state, and awaits bounded current-action cleanup.
- Use it in forced commands, resolved player directives, and player-requested model commands before persistent submission.
- If cleanup times out, hold the bot and refuse the new job rather than reporting acceptance.

## EXEC-OUT
[codeplan · persistent-job-action-handoff · EXEC-OUT · implemented: V2 · confidence: high · verification: source-only · mechanism-check: passed · plan-history: unchanged · evidence: inspected all player assignment paths, ActionManager stop and resume state, JobDirector idle gate, and hold behavior; focused diff formatting passed; runtime intentionally not started]
