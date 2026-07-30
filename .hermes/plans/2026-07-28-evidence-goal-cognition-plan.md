# Codeplan: Evidence-backed goal cognition

## Contract and safety
- Required behavior: autonomy maintains a compact, provider-neutral execution record for the active goal and uses exact command outcomes to adapt, complete, or report a blocker.
- Acceptance criteria: prompts expose attempted command, verified-step count, last phase/code/detail, and repeated blocker count; successful actions advance progress; requested actions remain pending; retryable/missing-result turns remain actionable; terminal or exhausted progress reports the exact last blocker; verified completion instructs `!endGoal`.
- Must preserve: one-command turns, current prompt/retry budgets, direct command execution, structured Minecraft state authority, bounded history, Stop, and durable-job handoff.
- Out of scope: activity templates, hidden chain-of-thought, provider-specific planning, UI, runtime restart, and tests.

## Repository evidence
- SelfPrompter already compares action IDs but reduces every retryable failure, invalid query-only turn, and missing result to one `no_progress_count`;
- terminal and exhausted messages expose only a normalized code or generic count, discarding the structured result detail already available;
- the next autonomy prompt receives recent history and world state but no compact active-goal execution summary;
- successful progress has no count and the prompt does not explicitly terminate through `!endGoal` once evidence proves completion.

## Candidates
- V1 `history-only`: depend on the model to infer progress from recent conversation and the latest world snapshot.
- V2 `bounded-goal-ledger`: maintain a sanitized active-goal ledger from structured outcomes and inject that ledger into every autonomy turn.

## PLAN-OUT
[codeplan · evidence-goal-cognition · PLAN-OUT · mode: constrained · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.42;V2=0.94 · reason: V2 strengthens general gameplay reasoning without activity templates, hidden reasoning storage, or a behavior-tree rewrite · planned-fingerprint: compact-ledger,structured-results,exact-blocker,bounded-state,provider-neutral]

## Implementation
- Add a bounded goal ledger to SelfPrompter and reset it only when a genuinely new goal starts.
- Record observation/query turns and structured action outcomes without storing hidden reasoning.
- Inject the ledger beside the active goal in every autonomy prompt.
- Use the ledger's exact blocker/detail when a goal pauses or cannot continue.
- Re-read changed source and run syntax/diff formatting only.

## EXEC-OUT
[codeplan · evidence-goal-cognition · EXEC-OUT · implemented: V2 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: restored goals retain restored source and the blocker label states current occurrences · evidence: complete cognition call-path reread plus node --check for self_prompter.js, prompter.js, full_state.js, and agent.js and focused git diff --check passed; provider, bot, and world execution remain deferred]

## EXEC-OUT
[codeplan · evidence-goal-cognition · EXEC-OUT · implemented: V2 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: restored prompts now prevent default-goal reseeding and ledger wording names current blocker occurrences · evidence: node --check self_prompter/prompter/full_state/agent passed; scoped git diff --check passed; complete ledger, prompt, restore, startup, manual-handoff, and telemetry paths re-read]
