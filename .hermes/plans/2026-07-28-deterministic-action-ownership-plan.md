# Codeplan: Deterministic single-bot action ownership

## Contract and safety
- Required behavior: one gameplay owner controls the bot at a time with strict priority `operator hold > reflex > critical survival > explicit player action > durable job > autonomy/background`.
- Acceptance criteria: lower-priority work cannot interrupt higher-priority work; a higher-priority action can use the existing bounded Stop handoff; resumable actions retain their original owner; autonomy waits without consuming failure/no-progress budgets while a higher owner is active.
- Must preserve: immediate self-preservation during operator hold, direct player replacement of an older player action, resumable Follow/Guard, structured action results, persistent jobs, and existing command signatures.
- Out of scope: behavior trees, squads, UI, provider calls, runtime restart, and tests.

## Repository evidence
- every `ActionManager._executeAction()` currently calls `stop()` before starting, regardless of who owns the current and incoming actions;
- SurvivalDirector can preempt busy work, but SelfPrompter continues independently and can immediately interrupt that survival action;
- mode actions, survival commands, role/job commands, player commands, autonomy commands, and reaction gestures all converge on the same ActionManager without owner metadata;
- resumable actions persist only a function/name, so their authority is lost when resumed.

## Candidates
- V1 `scheduler-order-only`: rely on update-loop ordering and idle checks while retaining unconditional ActionManager preemption.
- V2 `owner-aware-action-boundary`: carry a bounded owner through command dispatch and resume state, enforce priority once at ActionManager, and defer autonomy before model/action work.

## PLAN-OUT
[codeplan · deterministic-action-ownership · PLAN-OUT · mode: constrained · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.28;V2=0.96 · reason: V2 closes races at the one shared execution boundary while preserving every existing scheduler and command surface · planned-fingerprint: shared-boundary,async-context,priority-gate,resume-owner,structured-blocker]

## Implementation
- Add bounded command-owner context and priority policy to ActionManager.
- Carry explicit owner labels from reflex, survival, player, job, autonomy, and background gesture dispatch.
- Preserve owner on resumable actions.
- Make autonomy wait behind higher-priority owners without consuming its progress budgets.
- Re-read changed source and run syntax/diff formatting only.

## EXEC-OUT
[codeplan · deterministic-action-ownership · EXEC-OUT · status: installed-source · fidelity: full · runtime-activation: deferred · verification: syntax,diff-format,line-reread · result: every gameplay lane now reaches one owner-aware ActionManager boundary; lower owners wait or receive a structured retryable blocker, higher owners retain bounded preemption, and resumable actions keep their original authority]
