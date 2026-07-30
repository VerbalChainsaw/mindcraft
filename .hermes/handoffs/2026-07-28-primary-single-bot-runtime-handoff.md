# Mindcraft primary single-bot runtime handoff

Date: 2026-07-28  
Canonical checkout: `C:\Users\zerop\Development\minecraft-companion`  
Branch: `develop`  
Status: active implementation, not runtime-tested or complete

## Mission

Finish the five primary coding slices required for one bot to become a truthful, capable Minecraft companion:

1. truthful world-ready Spawn;
2. deterministic action ownership and preemption;
3. evidence-backed observe/act/verify cognition;
4. hardened general movement, combat, survival, gathering, crafting, mining, building, and interaction primitives;
5. complete stop/death/disconnect/restart cleanup plus structured result propagation.

The user explicitly reduced scope to one bot. Do not expand into squads, pets, dashboard redesign, backups, cosmetics, server administration, or provider-product redesign during this handoff.

The desired architecture is general Minecraft knowledge plus composable, evidence-checked actions. Do not add a bespoke template for every activity.

## Non-negotiable operating constraints

- Work directly in the canonical saved checkout above. It has essential uncommitted changes and is shared with another active agent.
- Inspect every complete function and adjacent call path before editing. Preserve all concurrent work.
- Do not run `git reset`, `git clean`, checkout-discard commands, commits, pushes, rebases, or broad formatters.
- Do not start or restart the server, dashboard, agent, Minecraft, or a model provider.
- Do not make provider calls or perform live bot/world actions.
- The user explicitly said to stop testing and install the code first. Do not run unit, integration, behavior, control-plane, browser, or regression suites.
- Allowed proof while coding: focused `node --check`, `git diff --check`, exact changed-line rereads, and read-only source inspection.
- Keep `.hermes/scratchpad.md`, `.hermes/defects/mindcraft-runtime.md`, and one Codeplan per nontrivial slice current.
- Record every discovered flaw with reproduction, root cause, fix, guards, and evidence.
- Keep status updates short and frequent. Never claim playability from source inspection.

## Active plan

| Slice | Status | Result / next edge |
|---|---|---|
| 1. Truthful world-ready Spawn | Source-complete | RT-077. Spawn remains `starting` until authenticated world-ready acknowledgement after Minecraft spawn and gameplay handler setup. |
| 2. Deterministic action ownership | Source-complete | RT-078. Priority is operator hold > reflex > survival > player > job > autonomy > background. |
| 3. Observe/act/verify cognition | In progress | Goal ledger is implemented, but the last `handleLoad()` source-preservation edit has not received the final focused checks, reread, EXEC-OUT, RT-079 record, or scratchpad entry. Start here. |
| 4. Core gameplay primitives | Pending | Audit and surgically harden general movement/combat/survival/gather/craft/mine/build/use behavior. Do not add activity templates. |
| 5. Lifecycle and result wiring | Pending | Cancel loops/timers/listeners/actions/vision/modes cleanly on Stop, death, kick, disconnect, and restart; preserve exact sanitized failure reasons through the bridge. |
| Final source audit | Pending | Requirement-by-requirement source proof only. Live proof remains explicitly deferred. |

## Exact resume point

Open and reread these complete files/functions before any edit:

- `src/agent/self_prompter.js`
  - constructor ledger state;
  - `start(prompt, { source })`;
  - `handleLoad(prompt, state)`;
  - `setPromptPaused(prompt)`;
  - `executeAutonomyResponse(response)`;
  - `startLoop()`;
  - `update(delta)`;
  - `_endGoal()`, `stop()`, and manual interruption paths.
- `src/models/prompter.js`
  - `$SELF_PROMPT` construction;
  - `promptAutonomy()`;
  - current goal and `getProgressPrompt()` injection.
- `src/agent/library/full_state.js`
  - attention/goal telemetry and redaction/bounding.
- `src/agent/agent.js`
  - default-goal startup;
  - player/manual goal handling;
  - the call path that resumes a deferred goal.
- `src/agent/conversation.js`
  - the `self_prompter.start()` resume call near the manual-command completion path.

The final interrupted edit changed:

```js
return this.start(prompt, { source: 'restored' });
```

inside `SelfPrompter.handleLoad()`. This is intended to prevent a restored explicit goal from being mislabeled and later replaced by default idle autonomy. Treat it as installed but not yet source-verified.

Before declaring slice 3 source-complete:

1. confirm an explicit or restored goal cannot be silently replaced by the default goal;
2. confirm resuming the same prompt does not erase its ledger;
3. confirm a genuinely new prompt resets the ledger;
4. confirm exact blockers are sanitized and bounded;
5. confirm query/observation turns do not count as verified success;
6. confirm only structured `phase: succeeded` increments verified steps;
7. confirm persistent-job handoff and `!endGoal` still stop the autonomy loop;
8. run only:
   - `node --check src/agent/self_prompter.js`
   - `node --check src/models/prompter.js`
   - `node --check src/agent/library/full_state.js`
   - `node --check src/agent/agent.js`
   - focused `git diff --check` for those files;
9. add `EXEC-OUT` to `.hermes/plans/2026-07-28-evidence-goal-cognition-plan.md`;
10. add RT-079 to `.hermes/defects/mindcraft-runtime.md`;
11. append the completed slice to `.hermes/scratchpad.md`.

Minor cognition issue to decide during the reread: `repeated_blocker_count` is `1` for the first occurrence while the prompt label says “Same blocker repeats.” Either change the label to “Current blocker occurrences” or change the counting contract. Do not let this trigger a larger rewrite.

## Five-slice implementation contract

### Slice 1: truthful world-ready Spawn — complete in source

Relevant plan: `.hermes/plans/2026-07-28-truthful-agent-readiness-plan.md`  
Defect: RT-077

Primary files:

- `src/process/agent_process.js`
- `src/agent/mindserver_proxy.js`
- `src/agent/agent.js`
- `src/mindcraft/mindserver.js`

Implemented contract:

- readiness stages: `process_starting`, `process_spawned`, `bridge_connected`, `minecraft_login`, `world_ready`;
- bounded 45-second world-ready wait;
- operating-system child spawn no longer means agent running;
- authenticated child `ready-agent` acknowledgement;
- readiness only after Minecraft spawn and gameplay handlers;
- early exit, setup failure, and readiness timeout reject startup;
- `login-agent` no longer sets `in_game`;
- public agent status includes connection/readiness stage;
- spawn-handler failure exits nonzero.

Do not reopen this slice unless a direct lifecycle conflict is found.

### Slice 2: deterministic action ownership — complete in source

Relevant plan: `.hermes/plans/2026-07-28-deterministic-action-ownership-plan.md`  
Defect: RT-078

Primary files:

- `src/agent/action_manager.js`
- `src/agent/commands/index.js`
- `src/agent/modes.js`
- `src/agent/self_prompter.js`
- survival, role/job, reaction, NPC, and task dispatch callers

Implemented contract:

- owner context propagates through async command execution and resumable actions;
- priorities: background 0, autonomy 10, job 20, player 30, survival 40, reflex 50;
- a lower owner receives structured `higher_priority_action_active`;
- higher-priority work uses the existing bounded stop handoff;
- Follow/Guard retains its original owner on resume;
- autonomy waits behind a higher owner without spending progress/failure budgets;
- operator hold remains above scheduled work;
- only immediate `reflex` self-preservation may operate while held.

Do not weaken this boundary in slices 4 or 5.

### Slice 3: evidence-backed cognition — in progress

Relevant plan: `.hermes/plans/2026-07-28-evidence-goal-cognition-plan.md`

Implemented so far:

- bounded and redacted per-goal execution ledger;
- attempt count, verified-step count, last command/output/outcome, repeated blocker, and last provider error;
- authoritative ledger injected into each autonomy prompt;
- exact blocker/provider failure reporting;
- ledger resets only for a genuinely changed goal;
- default startup goal marked `source: default`;
- restored goals marked `source: restored`;
- attention telemetry exposes bounded progress state.

Required completion is listed in “Exact resume point.”

### Slice 4: general gameplay hardening — pending

Create a Codeplan before changing this slice. Inspect current implementations rather than assuming they are thin.

Required outcomes:

- movement:
  - path goal ownership and cleanup;
  - arrival-distance verification;
  - safe door handling and listener cleanup;
  - Follow lost-target behavior;
  - bounded stuck recovery;
  - safe jumping/parkour policy;
  - no unsafe digging, towering, or false arrival by default;
- combat:
  - canonical hostile recognition;
  - target lifecycle and line/range evidence;
  - appropriate held tool/weapon;
  - verified hit/defeat distinctions;
  - retreat/food/survival preemption;
  - explicit lost/blocked/interrupted outcomes;
- survival:
  - food, health, drowning, falling, fire, darkness/sleep, and immediate-threat behavior;
  - reflex survival remains allowed during operator hold, but may not restart normal autonomy;
- gathering/mining:
  - target-scoped digging only;
  - natural resource mapping;
  - reachability, hazard, liquid, falling-block, protected-block, tool, inventory, interruption, and post-action checks;
  - restore no-dig path policy on every exit;
- crafting/tool use:
  - version-current registry knowledge;
  - recipe/material/tool preflight;
  - reachable table or verified portable-table fallback;
  - equipment verification and safe hand clearing;
  - bounded generic item activation/deactivation;
- building:
  - loaded-state, support, clearance, liquids, occupants, protected blocks, inventory, placement, Stop, and final blueprint audit;
  - never clear or invent completion unless explicitly authorized and verified;
- general:
  - return structured results shaped like `{ phase, code, target, evidence, retryable }`;
  - no narrative success can override Minecraft state;
  - preserve `ActionManager` as the single action/result ownership boundary.

Likely high-value files:

- `src/agent/library/skills.js`
- `src/agent/library/game_knowledge.js`
- `src/agent/commands/actions.js`
- `src/agent/action_manager.js`
- `src/agent/modes.js`
- `src/agent/runtime/survival-director.js`
- `src/agent/runtime/job-director.js`
- `src/agent/runtime/reaction-director.js`
- `src/agent/runtime/environment-observer.js`
- `src/agent/runtime/*policy*.js`
- `src/agent/npc/*.js`

Existing fixes that must be preserved:

- target-scoped collection movement;
- portable crafting-table fallback;
- movement/door/arrival truth;
- threat recognition and verified melee hit;
- critical food preemption;
- version-current `!inspectMinecraft`;
- copper tool ranking;
- bounded `!useItem`;
- truthful `goToSurface`;
- condition-based generic interaction;
- explicit cross-role durable jobs;
- persistent job control handoff;
- fixed bounded player-authorized shelter entry point.

### Slice 5: lifecycle and structured result wiring — pending

Create a Codeplan before changing this slice.

Inspect these known risk points:

- `Agent.cleanKill()` and every exit caller;
- the infinite `Agent` update loop and its untracked timers;
- death handler calling `actions.stop()` without awaiting cleanup;
- kick/end/error duplication and `_disconnectHandled`;
- SelfPrompter in-flight provider request, loop state, and timers;
- ActionManager abort/stop/resume state;
- pathfinder movement goals and door listeners;
- mode/reflex timers and listeners;
- vision broker/camera readiness, requests, retention, and teardown;
- JobDirector/SurvivalDirector/ReactionDirector pending work;
- MindServer AgentConnection removal and current-process identity;
- child process Stop/Restart timeout paths.

Required outcomes:

- hard operator Stop stays stopped until a new explicit player command or goal;
- ordinary reflex/idle/self-prompt work cannot silently restart;
- only immediate survival reflexes may run while held;
- all action, prompt, movement, mode, vision, and update-loop resources terminate on stop/disconnect/death/restart;
- cleanup is idempotent and bounded;
- duplicate disconnect signals do not duplicate state changes or restart work;
- failure reason survives the agent bridge with secrets redacted;
- `last_action_result` and current action owner remain available to structured state/readout consumers;
- missing tool, blocked loadout, unreachable target, unavailable vision, lost target, interruption, and timeout retain precise codes and retryability.

## Provider and bot-data boundary already implemented

Relevant plan: `.hermes/plans/2026-07-28-provider-endpoint-handoff-plan.md`  
Defect: RT-076

Primary files:

- `src/models/_model_map.js`
- `src/models/prompter.js`
- `src/mindcraft/profile-preflight.js`
- `src/mindcraft/mindcraft.js`

Saved provider endpoints and shared request parameters now flow through full-profile model resolution. Preserve:

- custom Ollama, LM Studio, vLLM, OpenAI, DeepSeek, and generic OpenAI-compatible URLs;
- same-provider inheritance for secondary model roles;
- independent explicitly configured secondary providers;
- legacy model strings;
- credential-name validation;
- no secret values in state or diagnostics.

Do not replace this with a new provider abstraction during the five-slice goal.

Runtime/data modules already present under `src/agent/runtime/` include behavior settings, structured action results, identity/persona, durable personal/squad memory boundaries, survival/jobs/reactions, and perception support. Read the actual directory before deciding what is missing.

## Durable records and files that are part of this handoff

The next task must read:

1. this handoff:
   - `.hermes/handoffs/2026-07-28-primary-single-bot-runtime-handoff.md`
2. active Codeplans:
   - `.hermes/plans/2026-07-28-evidence-goal-cognition-plan.md`
   - `.hermes/plans/2026-07-28-truthful-agent-readiness-plan.md`
   - `.hermes/plans/2026-07-28-deterministic-action-ownership-plan.md`
   - `.hermes/plans/2026-07-28-provider-endpoint-handoff-plan.md`
3. ongoing defect log:
   - `.hermes/defects/mindcraft-runtime.md`
4. working notes:
   - `.hermes/scratchpad.md`
5. stack reference:
   - `C:\Users\zerop\.codex\skills\mindcraft-minecraft-development\references\mindcraft-stack-map.md`
6. required skills for this lane:
   - `C:\Users\zerop\.codex\skills\mindcraft-minecraft-development\SKILL.md`
   - `C:\Users\zerop\.codex\skills\codeplan\SKILL.md`
   - use focused root-cause/defense-in-depth guidance only when it directly serves the current slice.

The defect log already contains RT-054 through RT-078. Continue numbering at RT-079.

## Shared-worktree warning

`git status --short` is intentionally very dirty. It includes modified and untracked source, tests, plans, runtime modules, UI assets, profiles, logs, and changes from other work. Do not infer authorship from the diff.

Before editing any file:

1. read its current complete relevant function;
2. inspect all direct callers and consumers;
3. view the focused current diff;
4. keep the edit surgical;
5. reread after editing;
6. record only the defect actually fixed.

Never create a clean worktree for this continuation unless the user explicitly requests a snapshot/fork. A clean branch would omit the essential uncommitted runtime state.

## Verification truth

The latest completed slices received focused syntax and diff-format checks. The final `handleLoad()` cognition edit did not.

No live agent, provider, Minecraft, server, browser, action, or restart proof was performed for the recent runtime slices. This is deliberate. Do not report the bot as playable or the five-slice goal as complete until later live proof is authorized and performed.

Historical test results elsewhere in the repository do not prove the current dirty tree.

## Completion gate for this new task

Do not stop after documenting gaps. Continue coding through slices 3, 4, and 5 unless the user interrupts.

The handoff task is complete only when:

- slice 3 is source-closed with RT-079 and EXEC-OUT;
- the remaining core playability defects found in slice 4 are implemented with exact structured outcomes;
- lifecycle resources in slice 5 have bounded, idempotent teardown;
- all five slices have durable plan/defect/scratch records;
- focused source checks and exact line rereads are recorded;
- remaining uncertainty is explicitly limited to deferred runtime/live testing.

Do not mark success because token/time budget is low. If a slice remains, state the exact file/function/edge and continue in the next turn.
