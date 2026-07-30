# Codeplan: manual command autonomy ownership

## Contract and safety
- Required behavior: an explicit player/dashboard skill action must take ownership from an active autonomous goal before it begins, so an old goal cannot resume and fight follow, stay, navigation, work, or combat orders.
- Acceptance criteria: direct `!followPlayer`, `!stay`, and resolved player directives cannot restart the prior self-prompt; read-only/configuration/vision commands retain their existing non-takeover behavior; the new manual action is never delayed waiting for a model turn or cancelled by the takeover itself.
- Must preserve: explicit `!goal` starts a new goal, `!stop` remains a hard hold, conversation pause/resume behavior, self-preservation reflexes, current action result contract, and legacy commands.
- Out of scope: a behavior-tree rewrite, a new scheduler, live Minecraft execution, or changing the meaning of model-generated actions in a normal conversational response.
- Workspace/user work: present and protected; no files are cleaned or reset.
- Pre-change checks: source call-chain inspection only; no tests, bot, server, or model process by user instruction.

## Repository evidence
- `Agent.handleMessage()` has early explicit-command and directive paths that call `executeCommand()` and return before the existing `SelfPrompter.handleUserPromptedCmd()` coordination used for model responses.
- `runAsAction()` is the common wrapper for world-changing skills; observation/configuration commands do not use it, and vision look commands use a distinct wrapper.
- `SelfPrompter.stop(false)` waits for loop cleanup, which would make manual control wait behind an in-flight model turn; its current interrupt predicate can miss a newly stopped state.
- References: `src/agent/{agent,self_prompter}.js`, `src/agent/commands/{actions,index}.js`.

## Mode
- Candidate mode: constrained
- Candidate count: 2
- Record profile: compact
- Reason: two viable ownership seams differ materially in latency and command metadata locality.

## Candidates
- V1 `action-wrapper ownership metadata` (`existing-wrapper,command-metadata,nonblocking-interrupt,legacy-safe`): mark common skill wrappers as manual-autonomy takeovers, query that metadata in Agent's explicit/directive paths, and add a synchronous self-prompt interrupt that changes state without stopping the new action.
- V2 `Agent-owned command allowlist + awaited stop` (`agent-policy,static-set,awaited-cleanup,legacy-safe`): list takeover command names in Agent and call the existing self-prompt stop helper before every listed action.

## Divergence
- V1↔V2: V1 derives takeover semantics from the actual shared action wrapper and avoids a manual name list; V2 is smaller initially but drifts as commands change and can delay direct player control behind an LLM turn.

## Paper gates
- V1 task fulfillment: pass — explicit world skill actions interrupt the old goal before `executeCommand()`.
- V1 contract preservation: pass — model/conversation paths remain unchanged and non-wrapper commands do not become takeover actions.
- V1 safety: pass — no call to `actions.stop()` occurs in the handoff, so it cannot cancel the new player command.
- V1 verification feasibility: pass — call-chain and metadata inspection can prove the source boundary; live proof is deferred.
- V2 task fulfillment: pass — it can end the old goal for listed commands.
- V2 contract preservation: pass — feasible, but the list has no direct relationship to command implementation.
- V2 safety: pass — only if carefully scheduled, but waiting on cleanup makes immediate player control weaker.
- V2 verification feasibility: pass — source-only inspection possible.

## IN
[codeplan · manual-command-autonomy · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=wrapper-metadata-nonblocking-interrupt;V2=agent-allowlist-awaited-stop · lean: V1 · conservative: V1]

## Frozen rubric and scoring
- freeze: axes=architecture-fit,player-control-latency,behavior-safety,regression-risk,delivery-cost classes=quality,quality,risk,risk,convenience weights=3,3,3,2,1 denominator=60 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer
- V1: 5,5,5,4,4 = 57/60 = 0.95 — action semantics live beside the shared wrapper, and the handoff cannot wait on model cleanup.
- V2: 2,2,3,3,5 = 32/60 = 0.53 — lower edit count but a drift-prone list and delayed handoff weaken the central operator-control requirement.
- arithmetic verification: (5*3)+(5*3)+(5*3)+(4*2)+(4*1)=57; (2*3)+(2*3)+(3*3)+(3*2)+(5*1)=32.
- formal baseline: V1 (only candidate without a new static ownership list or manual-control wait).
- selection stability: V1 exceeds V2 by 0.42.

## PLAN-OUT
[codeplan · manual-command-autonomy · PLAN-OUT · mode: constrained · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1=0.95;V2=0.53 · reason: metadata on the existing world-skill wrapper keeps player ownership accurate as command coverage grows while preserving immediate response. · planned-fingerprint: existing-wrapper,command-metadata,nonblocking-interrupt,legacy-safe]

## Implementation plan
- Files/boundaries: `runAsAction` metadata, command lookup, explicit/directive handling, and self-prompt interrupt predicate/state.
- Ordered changes: mark world skill wrappers; expose safe metadata lookup; add manual-command interruption with no action cancellation; call it only from direct player/dashboard paths before execution.
- Contract checks: direct skills replace the autonomous goal; queries/config/vision do not; `!goal`/`!stop` behavior is unchanged; an in-flight self prompt sees the interrupt immediately.
- Tests/checks: source/diff inspection only; no test, build, server, bot, or provider execution under the current user instruction.
- Rollback: metadata and one conditional handoff are additive; the self-prompt method can be removed without changing command syntax or stored state.

## Implementation and evidence
- Changes: world-skill `runAsAction` wrappers now carry manual-autonomy metadata; the command registry exposes it; Agent consults it only on explicit player/dashboard and resolved-directive paths; SelfPrompter now has a nonblocking manual-command interrupt and a state-independent interrupt predicate.
- Pre/post comparison: direct skill actions formerly bypassed the active goal; they now terminate old autonomous scheduling before `executeCommand()` while avoiding an `ActionManager.stop()` race against the new order.
- Active evidence gates: call-chain and metadata inspection passed; behavior boundary inspection confirmed queries/configuration/vision have no takeover metadata. Runtime, visual, model, and test gates were not run at the user's instruction.
- Corrections/re-plan: none; implementation remains within the selected existing-wrapper/command-metadata/nonblocking-interrupt fingerprint.

## EXEC-OUT
[codeplan · manual-command-autonomy · EXEC-OUT · implemented: V1 · confidence: low · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: none · evidence: source inspection of wrapper, registry, Agent direct paths, and SelfPrompter interruption only; no bot, server, model, build, or test execution by user instruction]
