# Manual Stop boundary plan

[codeplan · manual-stop-nonrestarting-boundary · PLAN-OUT · mode: full · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.94;V2=0.73;V3=disqualified · reason: convert an action-stop watchdog from destructive process exit into a bounded held/unresponsive outcome, which preserves explicit operator intent and prevents overlapping actions]

## Candidates

- V1 `bounded-held-stop` (`no-cleanKill`, `structured-block`, `no-overlap`, `telemetry`): stop trying for a bounded interval, remain held if it fails, reject new actions truthfully, and expose stop-pending state.
- V2 `clean-exit-stop` (`offline`, `restart-risk`): exit with success after a timeout. Rejected because it removes the bot from the world and loses the held state.
- V3 `hard-thread-cancel` (`unsafe`, `not-supported`): terminate arbitrary JavaScript work in-process. Disqualified because Node cannot safely cancel an arbitrary pending promise.

## Ordered changes

1. Replace the automatic `cleanKill()` watchdog with a bounded return object from ActionManager.stop().
2. Reject a new action when an older action is still unresponsive; do not run both concurrently or trip a fast-loop process kill.
3. Make `!stop` report held-versus-fully-stopped truth and surface stop request/timed-out timestamps in runtime state.
4. Inspect source/diff only; do not issue Stop, restart, or server commands.
