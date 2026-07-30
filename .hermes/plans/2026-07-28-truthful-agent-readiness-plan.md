# Codeplan: Truthful agent spawn readiness

## Contract and safety
- Required behavior: Spawn/Start succeeds only after the selected settings are loaded, the runtime/provider is constructed, Minecraft login completes, the world spawn event fires, and gameplay handlers are installed.
- Acceptance criteria: OS process creation remains `starting`; bridge and login stages are visible but not `in_game`; one authenticated world-ready acknowledgement promotes the current process to `running`; early exit, bridge loss, spawn failure, or readiness timeout rejects the original start with a sanitized actionable reason.
- Must preserve: capability-token identity checks, current-process ownership, stop/restart arbitration, bounded startup, diagnostics redaction, existing dashboard event shape, and inactive configured profiles.
- Out of scope: provider network probes, gameplay action tests, UI redesign, squads, process restart, and broad regression tests.

## Repository evidence
- `AgentProcess.start()` currently resolves and sets `running` on the child-process `spawn` event.
- `init_agent.js` has not loaded the provider or called `Agent.start()` at that point.
- `login-agent` is emitted from Mineflayer's `login` event before its `spawn` event and before gameplay handlers are installed.
- The existing spawn callback already provides the correct seam after world arrival and runtime event setup.

## Candidates
- V1 `process-exists`: retain the current OS-process definition of success and rely on later dashboard status changes.
- V2 `world-ready-ack`: retain bounded lifecycle ownership in `AgentProcess`, expose intermediate stages, and resolve only from an authenticated acknowledgement emitted after gameplay setup.

## PLAN-OUT
[codeplan · truthful-agent-readiness · PLAN-OUT · mode: constrained · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.12;V2=0.97 · reason: V2 makes the existing Spawn result describe a usable bot without introducing provider-specific probes or a second lifecycle owner · planned-fingerprint: existing-bridge,authenticated-ack,bounded-wait,current-process-guard,sanitized-failure]

## Implementation
- Keep the process active but `starting` after OS spawn, with a bounded readiness wait owned and cleaned up by `AgentProcess`.
- Add authenticated bridge/login/world-ready lifecycle stages in MindServer.
- Acknowledge world readiness from the child only after its spawn callback installs gameplay handlers.
- Reject early exit and readiness timeout as startup failures; preserve explicit Stop/Restart semantics.
- Re-read changed lines and run syntax/diff formatting only.

## EXEC-OUT
[codeplan · truthful-agent-readiness · EXEC-OUT · status: installed-source · fidelity: full · runtime-activation: deferred · verification: syntax,diff-format,line-reread · result: Spawn now remains starting across process, bridge, and login stages and resolves only after authenticated world spawn plus gameplay-handler setup; early exit and bounded timeout reject with retained diagnostics]
