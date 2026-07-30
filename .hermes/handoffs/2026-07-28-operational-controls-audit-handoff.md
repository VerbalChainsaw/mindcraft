# Operational Controls Audit Handoff

**Date:** 2026-07-28  
**Workspace:** `C:\Users\zerop\Development\minecraft-companion`  
**Status:** Operational recovery completed 2026-07-29; one Windows self-restart limitation remains documented below.

## 2026-07-29 completion update

- Backend lifecycle owners now publish authoritative retryability and explicit viewer enabled/available state through one REST/socket serializer.
- Failed squads can retry retained agents or recreate missing agents from preserved member settings; the dashboard exposes **Start Again** for failed squads.
- Ollama startup refreshes Bot Library provider capabilities before reporting readiness.
- Bounded startup evidence now distinguishes parent lifecycle stages and fixed child milestones while preserving sanitized stderr and leaving stdout uncaptured.
- Focused contracts passed **31/31**; startup-evidence checks passed **4/4**; `npm run check:critical` passed **9/9** with lint/format/syntax green.
- Live proof used retained squad `Audit_1`: Paper-down start settled `failed` with `retryable: true` and bounded ECONNREFUSED evidence; Paper restart plus squad retry reached `running` and `world_ready`; stop, start, stop, and remove all succeeded.
- Coordinated shutdown removed the owned control center, Paper, and Ollama processes and cleared listeners on `8080`, `25579`, and `11434`. A hidden source console returned on PID `32324`, port `8080`; Paper and Ollama remained stopped.
- Exact evidence: `.hermes/verification/2026-07-29-operational-controls-live.json`.

Open limitation: live `POST /api/restart` did not complete the Windows replacement handoff. The old process retained port `8080` but stopped serving HTTP. After exact ownership verification it was terminated and an explicit hidden source-console launch succeeded. Do not claim the in-process self-handoff route is reliable until separately repaired.

## Current objective

Make the control center operationally truthful and recoverable:

1. lifecycle controls must start, stop, restart, and remove the exact owned process;
2. failed bots and squads must have a working retry path;
3. provider and viewer availability must reflect the live runtime;
4. shutdown must remove owned child processes without leaving old Node, Java, bot, or Ollama processes behind.

The user explicitly rejected granular testing. Use only focused live proof for changed critical paths.

## Master project plan

### Completed changes

- Stack lifecycle ownership was hardened so coordinated shutdown targets owned agents, squads, Minecraft, local providers, and the control center.
- Old/stale Node processes were removed during the preceding repair pass.
- Critical runtime gate passed **9/9** after the lifecycle work.
- The control center was launched without opening visible command windows.
- Managed Paper was started from the UI on Java port `25579`.
- Server quick commands were proven live:
  - player list;
  - save world;
  - set daytime;
  - clear weather;
  - custom `list` command.
- Direct raw `stop` was correctly rejected in favor of coordinated lifecycle ownership.
- Save & Restart Server produced a replacement Java process and returned to running.
- Ollama was started from the UI and became reachable on `11434`.
- `MindcraftBot` was started and reached `world_ready`.
- Bot chat command `!stay(1)` executed and returned structured action output.
- Bot controls proven live:
  - Stay Still;
  - Stop Action;
  - Apply & Restart;
  - Restart;
  - Disconnect;
  - Start;
  - Disconnect All;
  - create disposable bot from JSON;
  - remove disposable bot.
- A disposable squad launch was attempted through the real UI and exposed a genuine recovery defect.

### Needed changes

#### P0 — failed bot recovery

- `src/mindcraft/public/js/utils.js`
  - `canRetryAgent()` does not classify the real timeout text  
    `Agent 'Audit_1' did not become world-ready within 45 seconds.`  
    as retryable.
  - Result: the visible **Retry Start** button is disabled after a recoverable readiness timeout.
- Fix the retry classifier or, preferably, expose an authoritative backend `retryable` value and have the UI honor it.
- Prove with one failed/recovered agent only.

#### P0 — failed squad recovery

- `src/mindcraft/bot-squad-manager.js`
  - `start(id)` accepts only `state === 'stopped'`.
  - A squad whose members all time out becomes `failed`, leaving **Remove Squad** as the only action.
- `src/mindcraft/public/js/agents.js`
  - **Start Again** is rendered only for stopped squads.
- Allow a settled failed squad to retry safely.
- Reuse existing member ownership:
  - if the failed agent record still exists, call the existing agent start path;
  - otherwise recreate it from the squad’s preserved settings.
- Do not release squad name reservations until explicit removal succeeds.
- Prove: fail once, retry to `running`, stop, start again, remove.

#### P0 — find the actual squad login failure

- Disposable squad:
  - id: `04da3d15-ef40-401b-89e1-61097baa17de`
  - prefix: `Audit_`
  - member: `Audit_1`
  - final state: `failed`
  - last stage: `minecraft_login`
  - error: `Agent 'Audit_1' did not become world-ready within 45 seconds.`
- A directly created disposable bot with equivalent Minecraft/provider settings reached `world_ready`, so the shared Minecraft and Ollama services were functional.
- The failed member exposed no useful diagnostics.
- Trace only the difference between direct bot creation and `BotSquadManager.runLaunch()`:
  - prepared member settings;
  - selected profile/runtime identity;
  - connection token registration;
  - agent child-process output;
  - Mineflayer `login` to `spawn/world_ready`.
- Do not “fix” this by increasing the timeout unless evidence proves startup genuinely needs longer.

#### P1 — truthful bot viewer availability

- `src/mindcraft/mindcraft.js` always assigns a `viewerPort`, including when `render_bot_view` is false.
- `/api/agents` forwards that port.
- `src/mindcraft/public/js/agents.js` treats `in_game + valid port` as sufficient and opens an iframe to a server that does not exist.
- Expose and use an explicit `viewerEnabled` / `viewerAvailable` runtime field, or set the public viewer port to null unless the viewer was configured.
- The View tab must show “unavailable” when no viewer process is expected.

#### P1 — live provider status refresh

- Starting Ollama updates the quick-start panel to `Ollama ready · 3 chat models`.
- The Bot Library capability strip remains `Ollama: offline`.
- `ProfilesWorkspace.startOllama()` updates `this.localModels` but does not refresh `this.botLibrary.capabilities`.
- After a successful local-provider start, reload Bot Library capabilities or inject the returned service state before rerendering.
- Prove the quick-start panel and Bot Library show the same live provider state.

#### P1 — owned-process cleanup proof

- At the final handoff check, `http://127.0.0.1:8080` refused the connection. The control center was no longer running.
- Because the user said stop, no further process inspection or cleanup was performed.
- On resume, inspect only for workspace-owned stale processes before relaunch:
  - Node control center/agent children;
  - managed Paper Java;
  - owned Ollama.
- Do not kill unrelated Node, Java, or Ollama processes.
- Relaunch hidden; never show a command window.

### Remaining work after operational fixes

- Prove Stop Everything from the dashboard against a live bot, squad, Paper, and owned Ollama.
- Prove Restart Control Center hands ownership to exactly one replacement control-center process.
- Prove Shut Down Control Center leaves port `8080` closed and no workspace-owned children alive.
- Remove only the disposable `Audit_` squad and `Audit_1` agent after ownership/finalization is safe.
- Preserve the two pre-existing stopped builder squads and the existing Bot Library entry named `ERROR`; their ownership is unknown.
- Update the primary project plan and verification artifact with the final operational results.
- Do not resume cosmetic, navigation-only, or exhaustive click testing unless the user asks.

## CodePlan state

CodePlan was started but implementation did not begin.

Candidates:

- **V1 — boundary truth fields and retry policy**
  - add authoritative retry/viewer availability at the runtime/API boundary;
  - allow settled failed squads to restart through existing ownership-aware paths;
  - refresh provider capabilities after provider lifecycle changes.
- **V2 — UI-only inference**
  - expand timeout regexes, infer viewer availability from settings, and patch local capability state.

Recommended selection: **V1**, because lifecycle truth belongs to the runtime that owns the processes. A small UI refresh remains appropriate for provider status, but failed-agent retryability and viewer availability should not depend on browser guesses.

Before editing, finish the compact CodePlan record and protect the dirty worktree.

## Verification limits

Use only:

1. syntax/import checks for changed critical files;
2. the smallest focused control-plane test for failed squad retry and viewer/retry contracts;
3. one live end-to-end run proving the changed output;
4. the existing critical gate once at the end.

Do not run the broad test suite.

## Workspace cautions

- The worktree contains extensive modified and untracked user/agent work.
- Do not reset, clean, revert, reformat broadly, or overwrite unrelated files.
- Do not commit unless the user explicitly authorizes it.
- Use hidden process launches only.
- Preserve existing saved squads/profiles unless they are explicitly identified as disposable above.

## Resume order

1. Confirm no stale workspace-owned processes remain.
2. Finish compact CodePlan for P0/P1 operational fixes.
3. Fix failed bot/squad retry and diagnose the squad-only login failure.
4. Fix viewer truth and provider refresh.
5. Relaunch hidden.
6. Prove one failed-to-running squad recovery.
7. Prove coordinated Stop Everything and full child cleanup.
8. Run the single critical gate.
9. Update the master plan and hand off the exact remaining state.
