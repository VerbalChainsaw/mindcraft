# Codeplan: Direct autonomy command execution

## Contract and safety
- Required behavior: a command selected by the autonomy model is validated and executed once, without a second language-model reinterpretation, and its result is available to the next planning turn.
- Acceptance criteria: valid generated commands use the normal parser/command/action path; invalid or blocked names produce exact history evidence; query output enters bounded recent context; persistent job selection yields model-loop ownership to JobDirector.
- Must preserve: operator Stop, command blacklist, structured ActionManager results, one-command truncation, prompt/no-progress budgets, history persistence, and provider neutrality.
- Out of scope: new commands, activity templates, provider redesign, UI, runtime restart, and broad tests.

## Repository evidence
- `SelfPrompter` receives a generated command, then calls `Agent.handleMessage('system', command)`.
- system messages bypass the direct-command branch and invoke `promptConvo()`, causing a second model call before execution.
- `promptAutonomy([])` supplies no recent messages, so read-only inspection output cannot inform the next autonomy turn.
- a persistent job emitted from self-prompting does not stop SelfPrompter, while JobDirector requires it to be stopped.

## Candidates
- V1 `second-model-rewrite`: keep conversational reinterpretation and strengthen its prompt. This remains slower, less deterministic, and can still transform an action into speech.
- V2 `validated-direct-dispatch`: validate/truncate once, record the command/result, execute through the existing command boundary, and pass a bounded history window into the next autonomy prompt.

## PLAN-OUT
[codeplan · direct-autonomy-command · PLAN-OUT · mode: constrained · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.43;V2=0.97 · reason: direct dispatch removes an unnecessary provider round trip while preserving every existing parser, blacklist, action, result, Stop, and persistence boundary · planned-fingerprint: existing-module,event-driven,validated-input,structured-result]

## Implementation
- Add a private SelfPrompter command dispatcher using existing validation/truncation/execution functions.
- Persist generated command and returned text as recent evidence.
- Yield SelfPrompter when it chooses a persistent work order so JobDirector can own execution.
- Include a bounded recent conversation/result window in the autonomy context.
- Convert periodic re-planning into next-turn history context instead of another conversational model call.
- Re-read changed contracts and run source diff formatting only.

## EXEC-OUT
[codeplan · direct-autonomy-command · EXEC-OUT · mode: constrained · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · delivered: validated-direct-dispatch,bounded-result-context,persistent-job-yield,contextual-replan · evidence: changed-source-reread,diff-formatting · deferred: provider-call,runtime-action,restart,tests]
