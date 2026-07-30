# Codeplan: Critical survival preemption

## Contract and safety
- Required behavior: a long movement, mining, gathering, or building action cannot suppress eating until starvation or death.
- Acceptance criteria: critical hunger or low-health food recovery may interrupt current work through ActionManager; ordinary eating, armor, sleep, shelter, and pickup upkeep still wait for idle; interrupted durable work remains recoverable.
- Must preserve: operator Stop, urgent combat modes, bounded action cleanup, job checkpoints, equipment restoration, safe-food rules, and structured results.
- Out of scope: automatic provisioning, new food cheats, scheduler rewrite, live activation, and broad tests.

## Repository evidence
- startup disables the Mineflayer auto-eat plugin so SurvivalDirector owns eating.
- `BehaviorDirector.canSchedule()` and `chooseSurvivalIntent()` both reject any non-idle state.
- collection and preparation actions may legitimately run for minutes, leaving no hunger owner while busy.
- ActionManager already performs bounded interruption and JobDirector already converts interrupted results into recoverable work-order state.

## Candidates
- V1 `new-hunger-mode`: duplicate safe-food selection and consumption inside the legacy reflex controller.
- V2 `urgent-survival-intent`: let only explicitly critical food intents use the existing SurvivalDirector command/result path while busy.

## PLAN-OUT
[codeplan · critical-survival-preemption · PLAN-OUT · mode: constrained · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.62;V2=0.93 · reason: SurvivalDirector already owns food truth and ActionManager already owns bounded preemption, so marking only critical intents avoids duplicate policy and preserves recoverable job state · planned-fingerprint: existing-module,event-driven,interruptible,structured-result]

## Implementation
- Add an explicit `allowBusy` scheduling option to the shared director boundary; default remains idle-only.
- Mark critical food consumption/acquisition intents as preemptive and suppress all noncritical upkeep while busy.
- Let SurvivalDirector inspect busy state, but begin/dispatch only an explicitly preemptive intent.
- Re-read changed contracts and run source diff formatting only.

## EXEC-OUT
[codeplan · critical-survival-preemption · EXEC-OUT · implemented: V2 · confidence: high · verification: source-only · mechanism-check: passed · plan-history: unchanged · evidence: inspected auto-eat ownership, busy/critical policy, director scheduling, ActionManager preemption, job recovery, and Stop; focused diff formatting passed; runtime intentionally not started]
