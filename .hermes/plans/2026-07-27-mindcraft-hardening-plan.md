# Mindcraft hardening plan — evidence-led

## Goal

Make Mindcraft truthful under real play: an action, bot lifecycle transition, server lifecycle transition, and Bedrock-ready indicator must not claim more than the runtime has actually proved.

## Constraints

- Preserve the shared dirty checkout and the active Bot Library/dashboard work.
- Paper/Java remains the bot world; Geyser is only the Bedrock client bridge.
- Do not expose provider credentials or replace user-selected external server targets without an explicit choice.
- Keep existing public endpoints where possible; add structured state rather than parsing logs.
- No broad regression sweep or shared-console restart during these first fixes. Use focused proof after each slice.

## Confirmed defects

| Priority | Defect | Evidence | Required repair shape |
| --- | --- | --- | --- |
| P0 | A skill returning `false` is marked as an action success. | `src/agent/commands/actions.js:16-18`; `src/agent/action_manager.js:128,147-160` | Propagate `false` and emit `phase: failed`, `code: skill_failed`. |
| P1 | Dashboard never subscribes to live bot state. | `src/mindcraft/mindserver.js:1973-2073`; `src/mindcraft/public/js/agents.js:52,656-657` | Subscribe on mount/reconnect; confirm state source and freshness. |
| P1 | Terminal action results never leave the bot process. | `src/agent/agent.js:272-278`; `src/agent/library/full_state.js:234-239` | Export bounded result evidence or publish typed action-result events. |
| P1 | Shallow perception represents unsampled world data as empty arrays. | `src/agent/mindserver_proxy.js:81-84`; `src/agent/library/full_state.js:182-190` | Mark unsampled perception explicitly or collect a bounded deep snapshot. |
| P1 | Manual bot restart can acknowledge success, then fail under automatic-restart limits. | `src/mindcraft/mindserver.js:1733-1747`; `src/process/agent_process.js:258-278` | Use one explicit restart lifecycle with a new generation and settled result. |
| P1 | Shutdown can report success even when bot/server cleanup failed. | `src/mindcraft/mindserver.js:1929-1942` | Return structured partial/failure status; force exit only by an explicit separate action. |
| P1 | Stop and restart can race, leaving the Java server starting after Stop. | `src/mindcraft/mindserver.js:958-975`; `src/mindcraft/managed-minecraft-server.js:1151-1176,1277-1283,1309-1312` | Serialize lifecycle operations behind one intent revision/operation queue. |
| P1 | First-run Geyser/Floodgate setup can be missing while status says Bedrock-ready. | `src/mindcraft/managed-minecraft-server.js:591-605,1118-1120,382-399` | Bootstrap Geyser config, enforce Floodgate auth, and separate installed from join-ready. |
| P1 | Launcher can replace an external server target with a stopped managed target. | `main.js:220-233`; `src/mindcraft/mindserver.js:172-187` | Only adopt a running managed target; preserve explicit external choice. |
| P2 | Front-page Bedrock rail can ignore Geyser runtime readiness. | `src/mindcraft/public/js/main.js:232-238`; `src/mindcraft/public/js/dashboard.js:216-219` | Use one readiness predicate across surfaces. |
| P2 | Bot directives and Apply & Restart are optimistic acknowledgements. | `src/mindcraft/public/js/agents.js:691-699,816-835`; `src/mindcraft/mindserver.js:1720-1726,1946-1965` | Add acknowledgements and distinguish saved/requested/confirmed. |
| P2 | Runtime profile limits are normalized but mostly not enforced. | `src/agent/runtime/behavior-config.js:63-95`; `src/agent/agent.js:38-39` | Wire each exposed setting to a runtime gate or label it unavailable. |

## Implementation order

### Slice A — Truthful bot action and telemetry contract

1. Repair Boolean action propagation in `actions.js` and `action_manager.js`.
2. Include bounded terminal action result and explicit perception sampling state in `full_state.js`.
3. Subscribe the dashboard state pump on mount/reconnect and display result phase rather than defaulting to Idle.
4. Add narrow deterministic tests for `false -> failed`, state subscription/reconnect, and unsampled perception labels.

**Visible product moment:** a blocked/unreachable/missing-tool command visibly reports failure with evidence instead of “completed” or “Idle.”

### Slice B — Explicit bot lifecycle results

1. Introduce lifecycle generations/structured completion in `agent_process.js` and `mindcraft.js`.
2. Route manual restart through the explicit lifecycle owner rather than `cleanKill()` and automatic-restart policy.
3. Return `accepted`, `starting`, `online`, `failed`, or `timed_out` accurately to the UI.
4. Make agent settings changes say either “saved for next start” or “restart confirmed.”

### Slice C — Server operation ownership and recovery

1. Serialize Start, Stop, Restart, Apply Settings, Repair Cross-play, and Full Stop with one operation intent queue.
2. Record a bounded recovery plan before quiescing bots/squads; on failure, expose the exact stopped/resume state instead of hiding it.
3. Make shutdown return partial failure and leave the control center reachable unless the user explicitly chooses force shutdown.
4. Use transactional configuration updates when a port is replaced after bind failure.

### Slice D — Bedrock truth and configuration convergence

1. Distinguish `installed`, `configured`, `runtimeReady`, and `joinReady`; use the same predicate in Home and Server workspaces.
2. Bootstrap/configure Geyser and Floodgate after the first plugin-generated config exists, then require a controlled restart.
3. Prevent managed-target adoption unless the managed world is actually running; retain external targets otherwise.
4. Reconcile generated Geyser bind configuration with Mindcraft’s saved configuration and report drift.

### Slice E — Make profile controls real

1. Wire autonomy, action/recovery budgets, vision budget, loadout policy, and role priorities to actual gates.
2. For anything deferred, render it as unavailable/coming later rather than an apparently active control.
3. Add server-issued provisioning receipts before a provisioned loadout is treated as usable.

## Deferred until after these slices

- richer vision model broker and screenshot retention;
- shared team-memory service and owner export/clear controls;
- broader role intelligence and long-horizon task behavior;
- large-scale live playbook/regression sweep.

## Focused proof plan

Each slice gets deterministic unit/mocked Mineflayer tests first, then one short user-observed live play. Do not call a UI acknowledgement a completed operation without the corresponding bot/server state transition.

## Codeplan — Slice A telemetry and action truth

### Contract and safety

- Required behavior: an explicit skill failure remains failed; live browser readouts distinguish live, cached, stale, unavailable, and unsampled data; each bot exposes a bounded current action, last result, position, health, and game context without exposing raw model output or provider secrets.
- Must preserve: legacy callback-only `get-full-state` callers, the name-to-state map, existing query-level deep awareness, the shared dirty UI work, and the user's no-broad-regression-sweep pace.
- Out of scope: lifecycle restart semantics, Bedrock readiness, server administration, Bot Library/squad editor ownership, and a broad test pass.
- Workspace/user work: shared dirty `develop`; do not overwrite the active Bot Library/dashboard agent's presentation work.

### Repository evidence

- `runAsAction` discards Boolean values in `src/agent/commands/actions.js:17-23`; `ActionManager` treats every resolved callback as success in `src/agent/action_manager.js:128-160`.
- `getFullState(agent, { deep })` already owns perception construction in `src/agent/library/full_state.js:95-190`, while the poller requests callback-only shallow state in `src/mindcraft/agent-state-pump.js:1-43`.
- The dashboard transport is an existing Socket.IO name-to-state map; `listen-to-agents` starts the bounded state pump in `src/mindcraft/mindserver.js:2061-2064,2127-2173`.
- `AgentsWorkspace` already owns `state-update` state but never subscribes (`src/mindcraft/public/js/agents.js:48-60`), and its State tab defaults missing data to `Idle` (`:688`).

### Candidate decision

- V1 `scheduled-direct-snapshots` (`inline`, `poll-driven`, `no-cache`, `zero-dep`): request a deep state on a schedule and render only that poll's data. It is the conservative lowest-effort change, but shallow intervening polls erase the useful context and make freshness ambiguous.
- V2 `cached-telemetry-contract` (`existing-owner`, `instance-cache`, `event-driven`, `result-return`, `graceful-degrade`): retain a bounded deep perception snapshot at the agent state boundary, tag it with sampling/freshness metadata, publish a sanitized action-result summary, and refresh the cache on a bounded internal cadence while returning cache state between scans.
- Divergence: V1 treats each poll as the source of truth and loses context between deep samples; V2 defines an explicit durable snapshot contract that remains accurate about its own age and status.

[codeplan · truthful-game-telemetry · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=scheduled-direct-snapshots/inline,poll-driven,no-cache;V2=cached-telemetry-contract,instance-cache,result-return,graceful-degrade · lean: V2 · conservative: V1]

### Paper gates and frozen rubric

- Task fulfillment: V1 pass with a weaker intermittent readout; V2 pass with live/cached/unsampled distinction.
- Contract preservation: V1 pass; V2 pass by keeping callback-only requests valid and making detail optional.
- Resource bounds: V1 pass only with an arbitrary deep-poll interval; V2 pass with bounded cache refresh and existing concurrency/timeouts.
- Privacy/observability: V1 pass but risks reusing raw evidence; V2 pass by projecting a bounded public result.
- Verification feasibility: both pass with syntax/import checks; focused runtime/play proof remains deferred by user instruction.
- freeze: axes=truthfulness,resource-bounds,repository-fit,privacy-observability,reversibility classes=quality,risk,quality,risk,risk weights=3,3,2,2,1 denominator=55 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer.
- scoring: V1=37/55=0.67 (3,3,4,3,5); V2=50/55=0.91 (5,5,4,4,4). Arithmetic checked: V1 9+9+8+6+5=37; V2 15+15+8+8+4=50.

[codeplan · truthful-game-telemetry · PLAN-OUT · mode: constrained · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.67;V2=0.91 · reason: V2 keeps the browser useful between bounded deep samples while truthfully labelling cache age and preserving the existing Socket.IO contract. · planned-fingerprint: existing-owner,instance-cache,result-return,graceful-degrade]

### Ordered change and evidence boundary

1. Preserve false action returns and create a structured `skill_failed` result with the last bounded skill evidence.
2. Add a private per-agent perception cache and a public action-result projection to `full_state`.
3. Keep `get-full-state` callback-only and let `full_state` refresh the bounded deep cache when due.
4. Subscribe on Bot workspace mount/reconnect, retain state freshness, and render unavailable/cached state rather than a false Idle label.
5. Keep the Dashboard overview handoff data-ready but avoid presentation overlap with the active Bot Library/dashboard agent until that lane settles.

Checks this slice: targeted syntax/import checks and diff review only. Focused deterministic and live checks are deferred at the user's direction; no broad regression sweep or console restart is authorized by this record.

### Constrained re-plan — callback-only state compatibility

New evidence during implementation: an already-running agent may still implement callback-only `get-full-state`. Sending it an options object before the callback would cause that older handler to call a non-function and can disrupt its state response.

- V2A `capability-gated-options` (`new-handshake`, `protocol-version`, `adapter`): advertise an extended request capability, then send deep options only to upgraded agents. Safe but adds a second lifecycle/connection contract for a cache that is owned entirely by `full_state`.
- V2B `self-refreshing-perception-cache` (`existing-owner`, `instance-cache`, `callback-compatible`, `graceful-degrade`): keep the callback-only wire shape and let `full_state` refresh its bounded cache when due, with cached/stale/unavailable metadata between refreshes.
- Gates: both preserve truth and resource bounds; V2B preserves compatibility with both old and new agent processes without a handshake and keeps the cache decision at its existing owner.
- freeze: axes=callback-compatibility,resource-bounds,repository-fit,reversibility classes=risk,risk,quality,risk weights=3,3,2,1 denominator=45.
- scoring: V2A=35/45=0.78 (4,4,3,5); V2B=42/45=0.93 (5,5,4,4). Arithmetic checked: V2A 12+12+6+5=35; V2B 15+15+8+4=42.

[codeplan · truthful-game-telemetry-compat · PLAN-OUT · mode: constrained · profile: compact · pick: V2B · baseline: V2A · confidence: high · beatBaseline: yes · scores: V2A=0.78;V2B=0.93 · reason: V2B preserves the callback-only state contract while keeping cache freshness and failure semantics in the existing full-state owner. · planned-fingerprint: existing-owner,instance-cache,callback-compatible,graceful-degrade]

This supersedes only the planned extended state-pump request payload. It retains the parent V2 action-result and cached-telemetry contract.

## Codeplan — Director player targeting

### Contract and safety

- Required behavior: Follow and Come quick controls must target an explicit player selected or typed by the operator, never a fictional hard-coded `Director` name. Nearby-player suggestions are only suggestions from the selected bot's latest structured state; they do not imply that a player is currently reachable.
- Must preserve: manual command entry, repeat/sequence workflows, callback-only telemetry, and the distinction between directive delivery and verified action completion.
- Out of scope: a new player-defend skill, server-side player roster, or changing the agent command grammar.

### Candidate decision

- V1 `placeholder-only` (`copy-edit`, `manual-entry`, `no-state`): remove the fake name and replace it with a generic placeholder. It avoids the explicit bug but still makes follow/come error-prone and does not use available game telemetry.
- V2 `explicit-player-target` (`safe-command-builder`, `manual-override`, `telemetry-suggestions`): add one manual player target, serialize it safely into follow/come commands, and offer optional nearby-player suggestions from the selected bot's structured state.
- Gates: V2 retains an explicit operator choice, does not falsely assert player reachability, and prevents a quote/control-character-bearing manual value from changing command grammar.
- freeze: axes=task-fulfillment,operator-control,truthfulness,compatibility,reversibility classes=quality,quality,risk,risk,risk weights=3,3,3,2,1 denominator=60.
- scoring: V1=45/60=0.75 (3,3,4,5,5); V2=57/60=0.95 (5,5,5,4,4). Arithmetic checked: V1 9+9+12+10+5=45; V2 15+15+15+8+4=57.

[codeplan · director-player-targeting · PLAN-OUT · mode: constrained · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.75;V2=0.95 · reason: V2 removes the fictional target while making the real player choice explicit, safely serialized, and easier to select from truthful local telemetry. · planned-fingerprint: explicit-target,safe-serialization,manual-override,telemetry-suggestions]

## Codeplan — Host task runner truth

### Contract and safety

- Required behavior: the Task Runners surface must make it impossible to mistake a local shell helper for a remote agent or Minecraft bot. A command exit failure, timeout, or manual heartbeat must be distinguishable from a successful cycle.
- Must preserve: locally configured trusted commands, bounded command execution, helper recall/relocate APIs, and existing Socket.IO update flow.
- Out of scope: remote SSH/WinRM transport, a new sandbox, a durable task-run history, and user profile/squad ownership.

### Candidate decision

- V1 `ui-disclaimer` (`label-only`, `remote-hidden`, `no-runtime-change`): remove the remote choice from the form and add copy explaining the limitation. It leaves direct API callers free to create a false remote helper and still reports a failed command as an active helper.
- V2 `enforced-local-verdict` (`server-validation`, `sanitized-result`, `manual-heartbeat-labelled`, `one-cycle-at-a-time`): reject remote locations at the runtime boundary, expose only a bounded result verdict, distinguish manual heartbeats, and prevent overlapping execution cycles.
- Gates: V2 does not execute more code than V1, prevents the false remote claim for every caller, and makes the displayed liveness proof meaningful without exposing command output or secrets.
- freeze: axes=truthfulness,operator-safety,compatibility,resource-bounds,reversibility classes=risk,risk,risk,risk,risk weights=3,3,2,2,1 denominator=55.
- scoring: V1=39/55=0.71 (3,3,4,4,5); V2=52/55=0.95 (5,5,4,5,4). Arithmetic checked: V1 9+9+8+8+5=39; V2 15+15+8+10+4=52.

[codeplan · host-task-runner-truth · PLAN-OUT · mode: constrained · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.71;V2=0.95 · reason: V2 removes the false remote execution path at its owner and turns raw helper state into bounded, meaningful operator evidence. · planned-fingerprint: local-only,structured-verdict,heartbeat-source,overlap-guard]

## Codeplan — Lifecycle acknowledgement truth

### Contract and safety

- Required behavior: a dashboard bot restart must use the explicit `AgentProcess.forceRestart()` lifecycle and acknowledge only its settled spawn result; a control-center shutdown must report any bot/server stop failure and keep MindServer alive for recovery.
- Must preserve: existing Socket.IO callback shapes, `Mindcraft.startAgent()` as the bot lifecycle owner, `stopEverything()` as the stack-stop owner, loopback-only control access, and the shared dirty worktree.
- Out of scope: Bot Library/profile/squad editing, a new lifecycle receipt schema, hard-kill policy changes, or claiming that a spawned bot process is already in game.
- Verification boundary: syntax and diff inspection only in this slice; no broad regression sweep and no live restart/shutdown against the user's running console.

### Candidate decision

- V1 `delegate-and-propagate` (`existing-owner`, `result-return`, `fail-closed`, `zero-dep`): route every dashboard restart through `mindcraft.startAgent()`, propagate unexpected exceptions as failure results, and make shutdown return immediately on `stopEverything()` failure without scheduling process exit. Aggregate simultaneous bot/server stop failures in the existing owner.
- V2 `lifecycle-operation-coordinator` (`new-service`, `operation-state`, `event-driven`, `result-return`): introduce a shared lifecycle operation service for REST and Socket.IO that owns phases, receipts, timeouts, and result broadcasts.
- Divergence: V1 repairs both false acknowledgements at their current lifecycle owners with no public-contract change; V2 adds a durable operation model and better future observability but expands state, API, and concurrency surface beyond these confirmed defects.

[codeplan · lifecycle-ack-truth · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=delegate-and-propagate/existing-owner,result-return,fail-closed;V2=lifecycle-operation-coordinator/new-service,operation-state,event-driven · lean: V1 · conservative: V1]

### Paper gates and frozen rubric

- Task fulfillment: V1 pass; V2 pass.
- Contract preservation: V1 pass with unchanged callback shapes; V2 pass only with an adapter around the new operation model.
- Negative space: both pass because neither suppresses failures or treats child exit as proof of restart.
- Concurrency/idempotency: V1 pass by reusing `forceRestart()`'s shared deferred operation; V2 pass with new serialization state.
- Verification feasibility: both can be inspected and syntax-checked; live destructive proof remains intentionally deferred.
- freeze: axes=lifecycle-truth,owner-fit,failure-recoverability,compatibility,reversibility classes=risk,quality,risk,risk,risk weights=3,3,3,2,1 denominator=60 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer.
- scoring: V1=58/60=0.97 (5,5,5,4,5); V2=53/60=0.88 (5,4,5,4,3). Arithmetic checked: V1 15+15+15+8+5=58; V2 15+12+15+8+3=53.

[codeplan · lifecycle-ack-truth · PLAN-OUT · mode: constrained · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1=0.97;V2=0.88 · reason: the existing restart and stack-stop owners already implement the required lifecycle waits, so delegating and propagating their results fixes the false acknowledgements with the least new state and collision risk. · planned-fingerprint: existing-owner,result-return,fail-closed,zero-dep]

### Ordered change and evidence boundary

1. Remove the connected-agent restart shortcut and always await `mindcraft.startAgent(agentName)` inside an error-wrapped handler.
2. Capture both bot-stop and managed-server-stop failures in `stopEverything()` and return one actionable error without hiding either failure.
3. On shutdown failure, reply `{ success: false, error }`, keep MindServer running, and never schedule `process.exit`.
4. Record the resolved defect and run only syntax/diff checks for the touched boundary.

[codeplan · lifecycle-ack-truth · EXEC-OUT · implemented: V1 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: none · evidence: source trace confirms restart delegates to startAgent/forceRestart and shutdown returns before exit on failure; Node syntax and diff checks passed, while live destructive lifecycle proof remains deferred]

## Codeplan — Stop cancels an in-flight bot restart

### Contract and safety

- Required behavior: if Stop arrives before an explicit restart has spawned its replacement child, the restart caller must receive a cancellation failure and the bot must settle stopped.
- Must preserve: repeated Restart calls share one deferred result, Stop remains idempotent while a child is already stopping, intentional cancellation does not mark the bot failed, and automatic crash recovery remains unchanged.
- Out of scope: a cross-agent operation queue, dashboard presentation changes, kill escalation, or treating child spawn as in-game readiness.

### Candidate decision

- V1 `owner-cancellation` (`existing-owner`, `deferred-reject`, `stop-wins`, `zero-dep`): add a non-failing restart-cancellation path in `AgentProcess`; Stop clears restart intent and rejects only the pending restart promise before continuing the existing stop sequence.
- V2 `lifecycle-command-queue` (`new-coordinator`, `serialized-commands`, `operation-state`): enqueue Start/Stop/Restart commands and settle every caller from a per-agent command processor.
- Divergence: V1 defines the missing winner for one real race inside the current owner; V2 generalizes every lifecycle command but adds a new scheduler and state model.

[codeplan · stop-restart-cancellation · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=owner-cancellation/existing-owner,deferred-reject,stop-wins;V2=lifecycle-command-queue/new-coordinator,serialized-commands,operation-state · lean: V1 · conservative: V1]

- Gates: both fulfill the race contract; V1 preserves the current state machine and repeated-restart promise sharing, while V2 requires adapting every lifecycle caller and is unnecessary for this confirmed race.
- freeze: axes=cancellation-truth,owner-fit,compatibility,concurrency,reversibility classes=risk,quality,risk,risk,risk weights=3,3,2,3,1 denominator=60 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer.
- scoring: V1=58/60=0.97 (5,5,4,5,5); V2=53/60=0.88 (5,4,4,5,3). Arithmetic checked: V1 15+15+8+15+5=58; V2 15+12+8+15+3=53.

[codeplan · stop-restart-cancellation · PLAN-OUT · mode: constrained · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1=0.97;V2=0.88 · reason: the race exists entirely inside AgentProcess's existing shared restart deferred, so rejecting that deferred on Stop defines the truthful result without introducing another scheduler. · planned-fingerprint: existing-owner,deferred-reject,stop-wins,zero-dep]

[codeplan · stop-restart-cancellation · EXEC-OUT · implemented: V1 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: none · evidence: Stop now rejects the shared restart deferred before the existing signal path; Node syntax and diff checks passed, while live destructive race proof remains deferred]

## Codeplan — Settings activation follows the lifecycle owner

### Contract and safety

- Required behavior: applying settings to an active bot must restart it through `Mindcraft.startAgent()` and return the settled lifecycle result. Applying settings to a stopped/stopping bot must not silently start it; the new settings remain available for the next explicit Start.
- Must preserve: normalized settings validation, agent capability isolation, the legacy Socket.IO callback shape, in-memory settings delivery during the child bridge handshake, and the active Bot Library/profile UI lane.
- Out of scope: profile-file persistence, Bot Library editing, changing the Settings modal, or claiming replacement process spawn means in-game readiness.

### Candidate decision

- V1 `parent-owned-activation` (`existing-owner`, `state-aware`, `result-return`, `zero-dep`): normalize and update the registered settings, inspect the authoritative process lifecycle, await `Mindcraft.startAgent()` only for an active bot, and return explicit `settingsApplied`/`restarted`/`lifecycleState` fields.
- V2 `child-restart-roundtrip` (`new-protocol`, `reverse-rpc`, `event-driven`): retain the child-side restart event, make the child request a parent lifecycle restart back through MindServer, and correlate a second acknowledgement.
- Divergence: V1 invokes the process owner directly from the existing dashboard handler; V2 adds a bidirectional restart protocol and correlation state solely to recover ownership after sending the command to the wrong process.

[codeplan · settings-lifecycle-activation · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=parent-owned-activation/existing-owner,state-aware,result-return;V2=child-restart-roundtrip/new-protocol,reverse-rpc,event-driven · lean: V1 · conservative: V1]

- Gates: both can preserve validation and capability isolation; V1 directly reuses the proven lifecycle owner and naturally keeps stopped bots stopped, while V2 expands the trusted bridge protocol and introduces a disconnect-sensitive second acknowledgement.
- freeze: axes=activation-truth,stopped-state-safety,owner-fit,compatibility,reversibility classes=risk,risk,quality,risk,risk weights=3,3,3,2,1 denominator=60 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer.
- scoring: V1=58/60=0.97 (5,5,5,4,5); V2=48/60=0.80 (5,5,3,3,3). Arithmetic checked: V1 15+15+15+8+5=58; V2 15+15+9+6+3=48.

[codeplan · settings-lifecycle-activation · PLAN-OUT · mode: constrained · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1=0.97;V2=0.80 · reason: MindServer already owns both the validated settings record and AgentProcess registry, so state-aware direct delegation produces one truthful result without adding a reverse bridge protocol. · planned-fingerprint: existing-owner,state-aware,result-return,zero-dep]

[codeplan · settings-lifecycle-activation · EXEC-OUT · implemented: V1 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: preserved settingsApplied truth when an unexpected activation exception occurs · evidence: active settings changes await startAgent, inactive states remain inactive, obsolete child restart listener removed, and focused syntax/diff checks passed; live activation remains deferred]

## Codeplan — Geyser generated-config convergence

### Contract and safety

- Required behavior: the generated Geyser configuration must agree with Mindcraft's validated Bedrock bind address, UDP port, and Floodgate authentication policy before a managed start. Status must distinguish installed plugins from configuration convergence and runtime listener readiness.
- Must preserve: generated comments/unknown Geyser settings, atomic replacement, first-start graceful handling when Geyser has not generated its config yet, runtime system-property overrides, and the current running server until the user requests a restart.
- Out of scope: changing the live process, opening LAN access, enabling Windows loopback, adding a YAML dependency, or claiming a Bedrock client joined successfully.

### Candidate decision

- V1 `runtime-override-and-drift-report` (`existing-args`, `read-only-config`, `graceful-degrade`): retain Java system-property bind/port overrides, parse the generated file only to report drift, and leave the file unchanged.
- V2 `section-aware-atomic-convergence` (`targeted-transform`, `atomic-replace`, `status-evidence`, `zero-dep`): locate exact keys inside Geyser's `bedrock` and `java` sections, preserve all other text/comments, atomically write validated bind/port/auth values, and expose convergence/drift details in server status.
- Divergence: V1 keeps the managed launch safe but leaves Geyser's own configuration contradictory and unsafe for plugin/manual launches; V2 makes the durable generated configuration match the control plane without serializing the full YAML document.

[codeplan · geyser-config-convergence · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=runtime-override-and-drift-report/existing-args,read-only-config;V2=section-aware-atomic-convergence/targeted-transform,atomic-replace,status-evidence · lean: V2 · conservative: V1]

- Gates: V1 preserves compatibility but does not fully repair the durable configuration; V2 preserves unknown settings/comments, uses already-validated values and existing atomic file operations, and fails with an actionable error if the expected generated structure is missing.
- freeze: axes=task-fulfillment,network-safety,config-integrity,compatibility,reversibility classes=quality,risk,risk,risk,risk weights=3,3,3,2,1 denominator=60 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer.
- scoring: V1=42/60=0.70 (3,4,2,5,5); V2=54/60=0.90 (5,5,4,4,4). Arithmetic checked: V1 9+12+6+10+5=42; V2 15+15+12+8+4=54.

[codeplan · geyser-config-convergence · PLAN-OUT · mode: constrained · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.70;V2=0.90 · reason: live evidence shows the managed process is loopback-bound while the generated file still advertises 0.0.0.0, so durable section-aware convergence removes a real network-policy split that runtime arguments only mask. · planned-fingerprint: targeted-transform,atomic-replace,status-evidence,zero-dep]

[codeplan · geyser-config-convergence · EXEC-OUT · implemented: V2 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: added legacy remote-section compatibility · evidence: live pre-change listener/file drift captured, source now atomically converges bind/port/auth and exports drift evidence, syntax/diff checks pass; next-start mutation and Bedrock join remain unverified]

## Codeplan — First-start cross-play readiness bootstrap

### Contract and safety

- Required behavior: when cross-play is enabled, managed readiness must require both Paper and the Geyser listener. If first start generates an out-of-sync Geyser config, Mindcraft may perform exactly one controlled convergence restart and must require listener readiness again before acknowledging success.
- Must preserve: Java-only readiness behavior, the global readiness timeout, bind-failure port recovery, desired-state persistence, one lifecycle owner, and the user's running process until an explicit future action loads this source.
- Out of scope: enabling Windows loopback, proving an Xbox login or Bedrock join, unbounded restart loops, or changing bot/squad recovery orchestration.

### Candidate decision

- V1 `manual-repair-readiness` (`status-only`, `operator-repair`, `no-bootstrap`): require Geyser runtime readiness but return a setup-required failure when generated config is unsynchronized; the operator must press Repair.
- V2 `readiness-owned-bootstrap` (`shared-operation`, `bounded-restart`, `verify-after-write`, `graceful-degrade`): deduplicate concurrent readiness callers, wait for the Geyser listener, converge/verify the generated config, perform at most one managed restart, and wait for the second listener proof within the original deadline.
- Divergence: V1 is truthful but preserves a confusing first-use repair step; V2 makes the existing Start operation complete its own generated-config bootstrap while bounding the lifecycle effect and sharing it across callers.

[codeplan · first-start-crossplay-bootstrap · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=manual-repair-readiness/status-only,operator-repair;V2=readiness-owned-bootstrap/shared-operation,bounded-restart,verify-after-write · lean: V2 · conservative: V1]

- Gates: both preserve Java-only behavior and reject missing Geyser readiness; V2 additionally uses the existing restart owner, keeps one absolute deadline, and prevents concurrent waiters from initiating duplicate restarts.
- freeze: axes=readiness-truth,first-use-completion,concurrency-safety,owner-fit,reversibility classes=risk,quality,risk,quality,risk weights=3,3,3,2,1 denominator=60 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer.
- scoring: V1=43/60=0.72 (4,2,4,4,5); V2=57/60=0.95 (5,5,5,4,4). Arithmetic checked: V1 12+6+12+8+5=43; V2 15+15+15+8+4=57.

[codeplan · first-start-crossplay-bootstrap · PLAN-OUT · mode: constrained · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.72;V2=0.95 · reason: managed Start already owns readiness, and one shared bounded convergence restart turns the generated-config prerequisite into a completed lifecycle operation instead of another hidden setup ritual. · planned-fingerprint: shared-operation,bounded-restart,verify-after-write,graceful-degrade]

[codeplan · first-start-crossplay-bootstrap · EXEC-OUT · implemented: V2 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: none · evidence: cross-play readiness now waits for Geyser, shares concurrent callers, verifies generated config, permits one convergence restart, and waits for Geyser again; syntax/diff checks pass, live first-start proof deferred]

## Codeplan — Integrated character and squad identity

### Contract and safety

- Required behavior: saved bots and squads need an integrated, validated identity model supporting a friendly display name, immutable runtime identity metadata, call sign, title, appearance note, roleplay style, squad badge/color/motto, and distinct Minecraft-safe member names.
- Acceptance: legacy Bot Library entries and scenarios still load; the Minecraft login name remains 3–16 safe characters; runtime prompts and telemetry receive the same bounded identity; repeated themed squad deployments cannot collide; presentation names never replace authoritative action/world state.
- Must preserve: existing profile IDs, provider/connection fields, role/job/persona fields, numeric-prefix fallback, current Bot Library and squad API shapes, and all unrelated dirty work.
- Out of scope: changing live Microsoft-account usernames, applying Paper scoreboard teams or skins, migrating existing `bots/<agentName>` data, restarting the console, or claiming Bedrock nameplate rendering.
- Workspace: `C:\Users\zerop\Development\minecraft-companion`; extensive user/concurrent work is present. The active Bot Library/squad presentation lane is protected until its Glimpse row settles, so this slice begins at the shared runtime/data contract.
- Pre-change checks: source trace only. Broad tests and live lifecycle actions are deferred by user direction.

### Candidates

- V1 `legacy-field-expansion` (`inline-fields`, `agent-name-key`, `numeric-fallback`, `zero-dep`): add more top-level profile/scenario strings and render them directly. It is small and compatible but duplicates validation, keeps personality fields thinly wired, and cannot express one coherent individual/team identity.
- V2 `normalized-layered-identity` (`shared-module`, `normalized-model`, `stable-metadata`, `graceful-degrade`): add one bounded runtime identity contract, adapt legacy fields into it, pass it unchanged through profile launch, attach member/squad identity at orchestration, and emit it through prompt/telemetry boundaries. Minecraft login names remain separate and collision-safe.
- V3 `paper-nameplate-authority` (`server-scoreboard`, `persistent-world-state`, `live-side-effects`, `plugin-bridge`): make Paper scoreboard teams/skin plugins the identity source of truth. This can produce rich in-game visuals, but it cannot own profile/personality persistence, adds permission/plugin/runtime dependencies, and is disqualified from this first contract slice.
- Divergence: V1 expands the existing scattered schema; V2 creates one shared model spanning profile/runtime/squad boundaries; V3 moves presentation authority into the live Minecraft server and adds external state.

### Paper gates

- V1: pass task/compatibility/verification gates; weak but viable conservative baseline.
- V2: pass task, contract, data-integrity, backward-compatibility, dependency, and verification-feasibility gates. It adds no dependency and preserves legacy fields as adapters.
- V3: fail task fulfillment and repository hard rules for this slice because server presentation cannot replace the saved character contract and would require live/plugin effects outside the approved boundary.

[codeplan · integrated-bot-identity · IN · mode: full · profile: compact · confidence: high · candidates: V1=legacy-field-expansion/inline-fields,agent-name-key,numeric-fallback;V2=normalized-layered-identity/shared-module,normalized-model,stable-metadata;V3=paper-nameplate-authority/server-scoreboard,persistent-world-state,live-side-effects · lean: V2 · conservative: V1]

### Frozen rubric and scoring

- freeze: axes=data-integrity,architecture-fit,identity-capability,backward-compatibility,reversibility classes=risk,quality,quality,risk,risk weights=3,3,3,2,2 denominator=65 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer.
- V1=47/65=0.72 (3,4,2,5,5): preserves old behavior but scatters identity and leaves runtime/team capability thin.
- V2=61/65=0.94 (5,5,5,4,4): one validation owner, stable metadata, rich individual/team contract, bounded migration via legacy adapters.
- V3=disqualified before scoring.
- Arithmetic: V1 9+12+6+10+10=47; V2 15+15+15+8+8=61. Formal baseline V1; V2 wins by 0.22 with no overlapping uncertainty.

[codeplan · integrated-bot-identity · PLAN-OUT · mode: full · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.72;V2=0.94;V3=disqualified · reason: a shared layered identity contract is the only viable mechanism that makes individual character and squad identity coherent while keeping login names, memory paths, and gameplay truth separate. · planned-fingerprint: shared-module,normalized-model,stable-metadata,graceful-degrade]

### Ordered changes

1. Add a bounded runtime identity module for character, squad presentation, prompt/telemetry projection, and collision-safe Minecraft member names.
2. Adapt Bot Library normalization and launch settings to preserve stable profile identity plus validated runtime behavior without breaking legacy fields.
3. Attach stable instance/squad identity and preferred themed names in scenario launch/persistence/snapshots.
4. Add identity to prompts and full-state telemetry so all control surfaces consume the same truth.
5. After the concurrent presentation lane settles, wire the individual editor and squad badge/naming controls to this contract without inventing a second model.
6. Record defects and run only focused syntax/diff checks; no broad sweep or live restart.

[codeplan · integrated-bot-identity · EXEC-OUT · implemented: V2 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: added role-derived naming and preserved two-character squad prefixes · evidence: runtime/profile/squad identity is wired through prompts, telemetry, persistence, and both editors; focused syntax/diff checks and primary-viewport browser inspection passed; live backend restart, profile save/spawn, Paper nameplates, and Bedrock rendering remain deferred]

## Codeplan — Lossless agent/server telemetry wiring

### Contract and safety

- Required behavior: reduce avoidable agent/server work and failure amplification without dropping location, activity, target/path, health, inventory, perception, identity, team, or action-outcome fidelity.
- Acceptance: healthy bots retain the configured sampling cadence and full-state schema; concurrent result ordering is deterministic; transient request failure preserves explicitly stale last-good evidence; failed bridges receive bounded exponential retry backoff; stop/start listener races cannot orphan the pump; child bridge connect and acknowledgement waits are bounded.
- Must preserve: authenticated private agent sockets, callback-based `get-full-state`, listener-on-demand sampling, volatile dashboard delivery, existing UI state maps, launcher configuration compatibility, and all unrelated dirty work.
- Out of scope: push-stream protocol replacement, delta payload schemas, live process restart, broad regression tests, or weakening structured state.

### Candidates

- V1 `stateless-tuning` (`existing-module`, `bounded-config`, `room-broadcast`, `zero-dep`): validate cadence/concurrency and broadcast through one Socket.IO room. Small, but timeouts still erase rich state and every failed bot is retried each cycle.
- V2 `stateful-lossless-sampler` (`existing-module`, `instance-cache`, `bounded-backoff`, `graceful-degrade`): retain V1 tuning, add per-connection last-good samples with explicit transport freshness, deterministic indexed collection, failure backoff, pump race/error containment, and bounded child bridge lifecycle.
- V3 `agent-push-stream` (`protocol-change`, `event-driven`, `agent-owned-state`, `new-contract`): agents push samples/deltas to the server. Potentially lowest request overhead, but it changes lifecycle/subscription authority and cannot be proved safely under the current no-restart/no-broad-test boundary; disqualified at verification-feasibility and compatibility gates.
- Divergence: V1 tunes the current stateless pull; V2 makes the pull failure-aware without changing its public schema; V3 replaces pull ownership and protocol.

[codeplan · agent-server-telemetry · IN · mode: full · profile: compact · confidence: high · candidates: V1=stateless-tuning/existing-module,bounded-config,room-broadcast;V2=stateful-lossless-sampler/existing-module,instance-cache,bounded-backoff;V3=agent-push-stream/protocol-change,event-driven,agent-owned-state · lean: V2 · conservative: V1]

### Frozen rubric and scoring

- freeze: axes=fidelity,performance,reliability,compatibility,verifiability classes=quality,quality,risk,risk,quality weights=3,3,3,2,2 denominator=65 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer.
- V1=48/65=0.738 (4,3,3,5,4): compatible and cheap, but retains blank-on-timeout and repeated failed requests.
- V2=58/65=0.892 (5,4,5,4,4): preserves full samples, eliminates false publish churn, degrades truthfully, and bounds failure load inside existing seams.
- V3=disqualified before scoring.
- Arithmetic verified by executable calculation. Formal baseline V1; V2 wins by 0.154 with stable known evidence.

[codeplan · agent-server-telemetry · PLAN-OUT · mode: full · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.738;V2=0.892;V3=disqualified · reason: the existing pull boundary is sound, but it needs deterministic ordering, stale-preserving cache/backoff, bounded configuration, and child bridge lifecycle containment to improve performance without losing state fidelity. · planned-fingerprint: existing-module,instance-cache,bounded-backoff,graceful-degrade]

### Ordered changes

1. Add bounded telemetry configuration and deterministic, cache-aware sampling to `agent-state-pump.js`.
2. Harden pump stop/start, async publication, continuation failures, and expose bounded operational status.
3. Apply launcher telemetry settings and one-room volatile broadcast in MindServer; reset per-connection cache across login/disconnect.
4. Bound child bridge connect and squad-radio acknowledgement paths; make best-effort output sends disconnect-safe.
5. Remove duplicate entity/inventory walks inside `full_state` while preserving output fields and ordering.
6. Record defects and run syntax/diff checks only; defer live activation.

[codeplan · agent-server-telemetry · EXEC-OUT · implemented: V2 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: healthy state output retains its exact legacy shape; only stale/backoff samples gain transport metadata · evidence: focused syntax checks passed for 11 touched modules, focused diff/whitespace checks passed, and the primary viewport showed bounded telemetry controls; no process restart, saved configuration, live bot action, or broad suite was run]

## Codeplan — Runtime-memory load truth

[codeplan · runtime-memory-load-truth · SKIP · reason: one existing error boundary has one safe corrective mechanism: distinguish ENOENT from filesystem failure and quarantine only parse/validation faults.]

- Required behavior: a bot receives an empty personal-memory state only for an actually absent runtime-memory file; malformed or oversized data remains quarantined, while access and I/O failures stay visible and stop startup rather than impersonating a clean first run.
- Must preserve: `runtime-memory.json` v1 format, atomic writes, corrupt-file preservation, legacy `MemoryBank` callers, and no mutation of existing bot data during load.
- Evidence plan: source contract inspection plus focused syntax/diff checks only; no live bot restart or broad test sweep by user direction.

## Codeplan — Squad persistence truth

### Contract and safety

- Required behavior: a squad lifecycle action must remain responsive when persistence fails, but the operator must receive a truthful, bounded save/load status instead of a silently disappearing squad after restart.
- Acceptance: missing `squads.json` is normal first use; malformed/unreadable saved data is visibly degraded; write/serialization failures do not roll back an already-completed lifecycle action; the existing `squad-list`/`squad-update` consumers retain their squad shapes and can render one explicit warning.
- Must preserve: atomic writes, secret redaction, lifecycle ownership, squad snapshots, current Socket.IO authorization, no bot/server restart, and all unrelated dirty work.
- Out of scope: a new persistence service, automatic repair/quarantine of server-level squad data, lifecycle rollback, or broad test execution.

### Candidates

- V1 `server-log-only` (`inline-catch`, `console-observability`, `zero-dep`): log the existing persistence error and retain lifecycle behavior. It is small but leaves dashboard users unaware and cannot distinguish a missing initial file from failed saved data.
- V2 `snapshot-status-contract` (`instance-state`, `result-return`, `existing-socket`, `graceful-degrade`): own a bounded persistence status in `BotSquadManager`, catch record construction plus atomic-write failures, publish it through the existing list/update response and show it on the current squad surface.
- V3 `persistence-as-lifecycle-failure` (`transactional`, `rollback`, `strict-failure`): reject or undo squad actions when saving fails. It is disqualified because an in-game start/stop/remove may already have occurred and falsely reporting that action as failed is less truthful than a partial durable-state warning.
- Divergence: V1 observes only server-side; V2 preserves the action while making durability a first-class operator fact; V3 couples disk persistence to irreversible bot lifecycle effects.

### Paper gates and selection

- V1: pass compatibility but weakly fulfills truthful operator visibility.
- V2: pass task, data-integrity, compatibility, and verification gates using existing manager/socket/card seams.
- V3: fail task fulfillment/negative-space gate because it hides completed lifecycle effects behind persistence failure.

[codeplan · squad-persistence-truth · IN · mode: full · profile: compact · confidence: high · candidates: V1=server-log-only/inline-catch,console-observability;V2=snapshot-status-contract/instance-state,result-return,existing-socket;V3=persistence-as-lifecycle-failure/transactional,rollback,strict-failure · lean: V2 · conservative: V1]

- freeze: axes=operator-truth,data-integrity,compatibility,scope classes=quality,risk,risk,convenience weights=3,3,2,2 denominator=50 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer.
- V1=35/50=0.70 (2,3,5,5): logs failure but leaves the control surface blind.
- V2=46/50=0.92 (5,5,4,4): exposes save/load truth, protects the lifecycle result, and stays inside the existing manager/socket/UI boundaries.
- V3=disqualified before scoring. Arithmetic checked by executable calculation; V1 is the formal baseline and V2 wins by 0.22.

[codeplan · squad-persistence-truth · PLAN-OUT · mode: full · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.70;V2=0.92;V3=disqualified · reason: the existing squad manager is the sole durable-state owner, so a bounded status contract is the smallest mechanism that makes persistence failure visible without lying about completed bot actions. · planned-fingerprint: instance-state,result-return,existing-socket,graceful-degrade]

### Ordered changes

1. Give `BotSquadManager` a bounded persistence status; classify missing data separately from unreadable/malformed data and contain record-construction plus write failures.
2. Persist before publishing a squad snapshot so every list/update payload carries the actual durability result; retain lifecycle outcomes as successful-but-degraded when appropriate.
3. Return the top-level status from `squad-list` and render a concise operator warning in the existing squad surface.
4. Run only focused syntax/diff checks; do not restart a process or execute a broad suite.

[codeplan · squad-persistence-truth · EXEC-OUT · implemented: V2 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: save-record construction is now contained as well as atomic write; unreadable or semantically rejected saved data is blocked from automatic overwrite · evidence: focused syntax checks passed for manager/MindServer/Bots workspace, scoped tracked-diff checks passed, and static source inspection confirms the bounded list/update/action/card status path; no live squad action, server restart, or broad suite ran]

## Codeplan — Command outcome propagation

### Contract and safety

- Required behavior: an action command must propagate a skill’s explicit `false` outcome into `ActionManager`, so blocked movement, missing tools, failed interaction, or unavailable targets are never transformed into a successful action result.
- Acceptance: every command wrapped by `runAsAction` returns the terminal skill/composite result; missing remembered places and failed intermediate discard movement are `false`; successful outputs and async errors retain their existing command/result shapes.
- Must preserve: action labels, resume behavior, user-visible command syntax, skill implementations, structured `ActionManager` result schema, and no live bot/server action.
- Out of scope: rewriting every skill to a new result-object schema, changing model prompts, changing command parsing, or broad regression execution.

### Candidates

- V1 `boundary-return-propagation` (`command-boundary`, `result-return`, `zero-dep`, `existing-action-manager`): return each skill/composite result from the existing command wrappers so `ActionManager`'s current explicit-false handling becomes reachable.
- V2 `action-manager-heuristic` (`central-inference`, `log-derived`, `compatibility-risk`): infer failure from output/evidence when callbacks return `undefined`. It avoids edits to commands but cannot distinguish valid undefined success from discarded failure and would parse human prose.
- V3 `skill-result-rewrite` (`cross-library-schema`, `structured-result`, `broad-migration`): convert every skill and caller to a richer result object. It could be valuable later but is too broad and risks behavior drift before restoring the existing boolean contract.
- Divergence: V1 restores the existing result contract at its lost boundary; V2 guesses after information is already discarded; V3 replaces contracts across the skill library.

### Paper gates and selection

- V1: passes task, compatibility, error-truth, and verification gates using the existing `ActionManager` false-result path.
- V2: passes mechanically but is weak on task truth because output/evidence is incomplete and sometimes intentionally absent.
- V3: passes in principle but has materially larger migration/verification risk under the user’s code-surgical/no-broad-suite constraint.

[codeplan · command-outcome-propagation · IN · mode: full · profile: compact · confidence: high · candidates: V1=boundary-return-propagation/command-boundary,result-return,existing-action-manager;V2=action-manager-heuristic/central-inference,log-derived,compatibility-risk;V3=skill-result-rewrite/cross-library-schema,structured-result,broad-migration · lean: V1 · conservative: V1]

- freeze: axes=outcome-truth,compatibility,scope-reliability,reversibility classes=quality,risk,risk,risk weights=3,3,2,2 denominator=50 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer.
- V1=48/50=0.96 (5,5,4,5): preserves existing explicit-false semantics at every command boundary.
- V2=35/50=0.70 (2,3,5,5): small but unreliable because logs cannot prove a skill outcome.
- V3=29/50=0.58 (5,2,2,2): rich future direction but disproportionate and difficult to verify safely now. Arithmetic checked by executable calculation; V1 is the formal baseline and wins outright.

[codeplan · command-outcome-propagation · PLAN-OUT · mode: full · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1=0.96;V2=0.70;V3=0.58 · reason: the ActionManager already has truthful explicit-false handling; returning the skill outcome through the existing command boundary restores it without guessing from logs or migrating the library. · planned-fingerprint: command-boundary,result-return,zero-dep,existing-action-manager]

### Ordered changes

1. Return direct movement/tool/combat/interaction skill results from every `runAsAction` command callback.
2. Make the composite discard command stop on a failed retreat/discard and return the verified return-to-origin result.
3. Mark an absent saved place as failure rather than an undefined success; return the smelt-start result after its existing deferred cleanup setup.
4. Run syntax/diff checks only; no live Minecraft command or broad suite.

[codeplan · command-outcome-propagation · EXEC-OUT · implemented: V1 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: the discard composite now snapshots origin and short-circuits failed prerequisites; remembered-place absence is explicit false · evidence: `node --check` and scoped diff checks passed, and a focused static scan found no direct discarded `await skills.*` in the command wrappers; no live bot command or broad suite ran]

## Codeplan — Evidence-based movement and reflex recovery

### Contract and safety

- Required behavior: normal jumping/sprinting/parkour and non-iron door traversal remain available, but default navigation never digs or towers; follow/retreat/reflex operations must return explicit failure rather than success when they cannot make verified progress.
- Acceptance: safe movement policy explicitly enables natural traversal while keeping destructive pathing disabled; follow detects bounded no-progress and retries/ends truthfully; retreat verifies distance from origin/hostile; reflex combat/retreat paths no longer install unrestricted Mineflayer movement; interruptions stop cleanly.
- Must preserve: Mineflayer/Pathfinder APIs, existing commands and role modes, current action-result schema, cheat-mode behavior, user stop/hold semantics, and no live bot/server restart.
- Out of scope: a custom physics controller, world editing/tower escape, a full behavior-tree rewrite, server-side plugins, or broad live testing.

### Candidates

- V1 `localized-evidence-recovery` (`existing-skills`, `safe-movements`, `bounded-loop`, `result-return`): explicitly configure safe natural movement, repair the movement/reflex branches that discard results, and add bounded follow no-progress recovery inside the existing skills.
- V2 `navigation-controller-service` (`new-service`, `stateful-route`, `shared-recovery`, `migration`): introduce a new controller that owns every pathfinder call and recovery policy. Stronger long-term unification, but would require broad migration across skills/modes before it can be trusted.
- V3 `custom-control-state-driver` (`physics-control`, `event-driven`, `new-protocol`): replace pathfinder recovery with manual movement/reflex control. It offers potential sophistication but reimplements Minecraft traversal and is too risky for an operator companion.
- Divergence: V1 repairs truth and safety at current skills; V2 adds a centralized navigation architecture; V3 changes movement ownership entirely.

### Paper gates and selection

- V1: passes task, safety, compatibility, and verification gates using existing `safeMovements`, `goToGoal`, follow, retreat, and reflex seams.
- V2: viable but weaker on scope/reversibility under the no-broad-suite constraint.
- V3: viable only in theory; poor repository fit and verification feasibility disqualify it for this task.

[codeplan · evidence-based-movement-recovery · IN · mode: full · profile: compact · confidence: high · candidates: V1=localized-evidence-recovery/existing-skills,safe-movements,bounded-loop,result-return;V2=navigation-controller-service/new-service,stateful-route,shared-recovery;V3=custom-control-state-driver/physics-control,event-driven,new-protocol · lean: V1 · conservative: V1]

- freeze: axes=movement-truth,recovery-safety,compatibility,scope-reversibility classes=quality,risk,risk,risk weights=3,3,2,2 denominator=50 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer.
- V1=47/50=0.94 (5,4,5,5): keeps actual pathfinder semantics and adds proof/budgets where current branches lie.
- V2=42/50=0.84 (5,5,3,3): more centralized but wider migration and harder proof.
- V3=34/50=0.68 (5,5,1,1): replaces a working movement engine without enough validation room. Arithmetic checked by executable calculation; V1 is the formal baseline and wins outright.

[codeplan · evidence-based-movement-recovery · PLAN-OUT · mode: full · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1=0.94;V2=0.84;V3=0.68 · reason: the runtime already has safe path probing and action outcomes; repairing unsafe direct path calls and no-progress gaps gives bots natural traversal and truthful failure without a risky navigation rewrite. · planned-fingerprint: existing-skills,safe-movements,bounded-loop,result-return]

### Ordered changes

1. Make safe natural traversal explicit in `safeMovements` while retaining no-dig/no-tower safety.
2. Verify movement outcome in retreat and avoid-enemy reflexes; change direct unrestricted `goto` paths in reflex/placement distance handling to safe movement.
3. Add bounded no-progress detection/recovery to follow and explicit lost/stuck outcomes.
4. Run focused syntax/static checks only; no live Minecraft movement playbook yet.
