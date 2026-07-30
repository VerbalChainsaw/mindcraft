# Minecraft Companion Live Dashboard Handoff

Date: 2026-07-29
Branch: `develop`
Workspace: `C:\Users\zerop\Development\minecraft-companion`

## Stop state

- Work was stopped at the user's request.
- The persistent execution goal was cleared.
- No background specialist or browser-automation session remains active.
- The live Minecraft Companion stack was intentionally left running for the next worker to inspect.
- No commit, reset, clean, bulk stage, or file deletion was performed.

## Repository state

- Branch `develop` is 13 commits ahead of `origin/develop`.
- `git status --porcelain=v1` reported 188 entries at handoff:
  - 51 modified entries.
  - 137 untracked entries.
- The dirty tree predates this live-operation session and contains work from several prior agents. Do not infer authorship from Git status.
- Earlier in this conversation, a platform-hardening packet changed or added launcher/control-plane files and tests. Those changes remain uncommitted. The abandoned deepwork record is `.slim/deepwork/finish-minecraft-companion.md`.
- A final attempted dual-loopback dashboard task was cancelled before completion. The active control center still listens only on IPv6 loopback (`::1:8080`).

## Live runtime at handoff

The following state was queried immediately before this handoff:

| Component | State | Address / PID |
|---|---|---|
| Mindcraft control center | running | `::1:8080`, PID `15224` |
| Ollama | running | `127.0.0.1:11434`, PID `38280` |
| Managed Paper | running | `127.0.0.1:25579`, PID `42988` |
| Geyser Bedrock bridge | running/listening | UDP `127.0.0.1:19132`, owned by PID `42988` |
| MindcraftBot | running, in game | Socket connected; connection/readiness stages both `world_ready` |

Agent API projection at handoff:

- name: `MindcraftBot`
- state: `running`
- `in_game: true`
- `socket_connected: true`
- `connection_stage: world_ready`
- `readiness_stage: world_ready`
- provider projection: `qwen`
- model: `ollama/qwen2.5:3b`

The process query used for an agent child PID did not match a command line, so no bot child PID is recorded here. `/api/agents` was the authoritative bot-state source.

## What was done in the live session

1. Opened `http://localhost:8080` in a real Windows Playwright/Chrome session.
2. Confirmed the dashboard loaded, Socket.IO connected, navigation rendered, and the initial browser console had zero errors.
3. Observed the initial operational blockers:
   - control center online;
   - managed Paper stopped;
   - selected Ollama profile unavailable;
   - MindcraftBot stopped;
   - dashboard health referred to `127.0.0.1:25565` while the installed managed server was configured for `127.0.0.1:25579`;
   - one Bot Library entry rendered as `ERROR` / `Spawn ERROR`.
4. Gracefully shut down the old control center through the dashboard. Its PID was `32324`.
5. Relaunched through `start-mindcraft-silent.vbs`. The replacement opened `::1:8080` under PID `15224`.
6. Used the dashboard's `Start Ollama` action.
   - Ollama opened `127.0.0.1:11434` under PID `38280`.
   - `ollama list` confirmed these relevant models are installed:
     - `qwen2.5:3b`
     - `nomic-embed-text:latest`
     - `llama3.2-vision:latest`
7. Used the dashboard's `Start Server` action.
   - Paper reached `running` at `127.0.0.1:25579` under PID `42988`.
   - Dashboard server output showed Paper 1.21.11, Floodgate, ViaVersion, and Geyser startup.
   - Geyser logged `Started Geyser on 127.0.0.1:19132`.
8. Used the Bots workspace to start `MindcraftBot`.
   - First start failed with `[LoginGuard] Network Error: Connection timed out or was lost.`
   - `/api/agents` diagnostics showed the exact failed target: `127.0.0.1:25565`.
9. Opened the bot Settings modal in the dashboard.
   - Confirmed saved bot port was `25565`.
   - Changed it to `25579` and selected `Apply & Restart`.
   - The failed lifecycle intentionally did not auto-restart; selected `Retry Start` afterward.
10. Polled `/api/agents` until `MindcraftBot` reached `running`, `in_game`, socket-connected `world_ready`.
11. Used the dashboard `Stay Still` button.
   - Dashboard sent `!stay(-1)`.
   - Bot output included `*ADMIN used stay*`.
12. Sent an authoritative bounded `!stay(1)` through the same Socket.IO control path and waited for structured telemetry.
   - Structured result was observed:

```json
{
  "phase": "succeeded",
  "code": "completed",
  "label": "action:stay",
  "detail": "Action output: Stayed for 1.028 seconds.",
  "target": null,
  "retryable": false,
  "finishedAt": 1785343161782
}
```

This proves the current live stack can carry an operator action from the control plane to the in-world bot and return the expected structured terminal result.

## Fresh automated evidence from this conversation

These were run before the live startup sequence; no production source was edited during the live startup sequence:

- `npm run check:behavior`
  - 67 passed, 0 failed.
  - behavior ESLint passed.
  - syntax checks passed.
- `npm run check:critical`
  - 9 passed, 0 failed.
  - lint, format checks, and syntax checks passed.
- The platform remediation had separately reached `npm run check:control-plane` at 210 passed, 0 failed plus ESLint before the final cancelled dual-loopback task.

## Exact functional issue found

The dashboard and Socket.IO client were functional. The failed product startup was caused by runtime configuration drift:

- managed Paper target: `127.0.0.1:25579`;
- `launcher-config.json` raw `agent_defaults.port`: `25565`;
- registered `MindcraftBot` settings at first start: `25565`.

Starting Paper did not update the already-registered stopped bot before its first explicit Start. The bot therefore attempted `127.0.0.1:25565`, failed, and required a manual settings correction plus retry.

The live bot is corrected to `25579` now. This handoff does not claim the correction persists across every clean launcher restart; the ignored/private persistence file was not located before work stopped. `launcher-config.json` still contained `25565` when last read.

## Work still needed for a repeatable product path

These are observed gaps, not a prescribed implementation:

1. **Cold-start target reconciliation**
   - Reproduce a complete stop/start from the current tree.
   - Determine whether a stopped registered bot is always projected onto the running managed server target before `start-agent`.
   - Reason: this exact mismatch caused the live bot failure in this session.

2. **Persistence source confirmation**
   - Identify where the dashboard's `MindcraftBot` port update is persisted.
   - Verify whether the value survives a clean control-center restart.
   - Reason: the current runtime is correct, but `launcher-config.json` still has raw port `25565`.

3. **One-action startup UX**
   - Establish the intended behavior when Ollama and Paper are stopped and the user starts a bot.
   - Current observed path required `Start Ollama`, `Start Server`, bot `Start`, a settings correction, and `Retry Start`.
   - The dashboard already contains each control; the unresolved question is orchestration and gating, not missing screens.

4. **Malformed Bot Library record**
   - One saved record renders as display name/type/provider text `ERROR` and exposes `Spawn ERROR` on the dashboard.
   - Its storage record was not changed or deleted.

5. **Saved stopped squads**
   - Two five-member `Stone & Timber Guild` squad records remain stopped in the dashboard.
   - They were not started, removed, or altered in this session.

6. **Dashboard transport scope**
   - The control center currently listens on `::1:8080`; `http://localhost:8080` works on this machine.
   - Direct IPv4 dashboard transport on `127.0.0.1:8080` was the final unresolved Oracle finding. The associated implementation task was cancelled.

7. **Bedrock scope**
   - Geyser is running on loopback UDP `19132` and the dashboard reports `test join` / no observed Bedrock player.
   - Current bind is this-computer-only, not LAN exposure.
   - No Bedrock client join was performed.

8. **Repository reconciliation**
   - The current product depends on a large dirty/untracked tree.
   - Exact intended source slices have not been staged or committed.

## Useful observation commands

These are read-only checks against the live state:

```powershell
Invoke-RestMethod http://localhost:8080/api/agents | ConvertTo-Json -Depth 10
Invoke-RestMethod http://localhost:8080/api/minecraft-server | ConvertTo-Json -Depth 10
Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 8080,25579,11434
Get-NetUDPEndpoint | Where-Object LocalPort -eq 19132
ollama list
```

Dashboard URL:

```text
http://localhost:8080
```

## Constraints preserved

- No secrets were printed or copied into this handoff.
- No live squad was launched.
- No Bedrock client joined.
- No source commit was created.
- No cleanup or revert was attempted against the shared dirty tree.
