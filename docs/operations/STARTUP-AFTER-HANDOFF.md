# Startup after a handoff

This worktree has one launcher, one launcher-owned managed Paper server, and
launcher-owned bot processes. Recover those owners in order. Do not start a
second Paper process or treat a bound TCP port as readiness.

## Canonical local target

Read `launcher-config.json` rather than assuming a port. On this WSL host the
persisted MindServer port and scan start are `8081`. Port 8080 has been observed
to accept a listener bind while dropping local connections; it is not a valid
readiness target here.

```bash
CONTROL_URL=http://127.0.0.1:8081
curl -fsS "$CONTROL_URL/api/identity"
```

The only accepted identity is:

```json
{"success":true,"service":"mindcraft-control-center","protocolVersion":1}
```

If that identity responds, reuse the launcher. If it does not respond, confirm
that no Mindcraft launcher is already using another configured scan port, then
start exactly one long-lived owner:

```bash
node main.js
```

Keep that terminal/session alive. Wait for the identity endpoint before any
other lifecycle action. A launcher started from this worktree restores managed
Paper when its persisted desired state is `running`, registers configured bot
profiles, and auto-starts selected profiles when `auto_start` is true.

## Distinguish the three readiness edges

1. Launcher/control plane:

   ```bash
   curl -fsS "$CONTROL_URL/api/identity"
   ```

2. Managed Paper:

   ```bash
   curl -fsS "$CONTROL_URL/api/minecraft-server"
   ```

   Require `server.phase == "running"`, the expected managed target, and no
   server error. If the launcher exists but Paper is stopped, use its owner:

   ```bash
   curl -fsS -X POST "$CONTROL_URL/api/minecraft-server/start"
   ```

   Re-read status until Paper is `running`; the POST acknowledgement alone is
   advisory.

3. Configured bot:

   ```bash
   curl -fsS "$CONTROL_URL/api/agents"
   ```

   `state: "stopped"` with `connection_stage: "registered"` or
   `"disconnected"` means the launcher and profile are healthy but the bot is
   unloaded. Start that exact configured bot with the ordinary dashboard
   `start-agent` lifecycle. Profile and lexical-skill initialization can take
   tens of seconds before the bridge connects. For a non-UI agent, this
   one-shot command uses the same socket contract:

   ```bash
   node --input-type=module <<'NODE'
   import { io } from 'socket.io-client';
   const controlUrl = 'http://127.0.0.1:8081';
   const agentName = 'MindcraftBot';
   const socket = io(controlUrl, { reconnection: false, timeout: 5000 });
   const deadline = setTimeout(() => {
     console.error('start-agent callback timed out');
     socket.close();
     process.exitCode = 1;
   }, 150000);
   socket.on('connect_error', error => {
     clearTimeout(deadline);
     console.error(error.message);
     process.exitCode = 1;
   });
   socket.on('connect', () => socket.emit('start-agent', agentName, result => {
     clearTimeout(deadline);
     console.log(JSON.stringify(result));
     socket.close();
     if (result?.success !== true) process.exitCode = 1;
   }));
   NODE
   ```

   The callback is advisory. Re-read `/api/agents` and require the selected bot
   to report all of:

   - `state: "running"`
   - `in_game: true`
   - `socket_connected: true`
   - `readiness_stage: "world_ready"`

Finally require a clean aggregate:

```bash
curl -fsS "$CONTROL_URL/api/health"
```

Completion is `success: true`, `ok: true`, and an empty `problems` array. Keep
the restored persistent Operator Hold; startup proof never authorizes gameplay,
teleportation, fixture edits, or autonomous work.

When Operator Hold is persisted and no human player is online, the behavior
arbiter intentionally unloads the unattended bot after its bounded grace
period. A bot that was authoritatively observed at `world_ready` and then exits
cleanly to `stopped` under those conditions completed startup successfully; it
did not crash. Start it again when a human is present or when the next authorized
live campaign is ready to dispatch.

## Failure meanings

| Observation | Meaning | Next action |
| --- | --- | --- |
| Identity does not answer | Launcher absent, wrong configured port, or invalid control endpoint | Inspect configured port/processes; start one launcher only if absent |
| Identity answers; Paper is not `running` | Managed server stopped, starting, crashed, or failed | Use the managed-server endpoint and reconcile authoritative status/error |
| Paper runs; bot is `stopped` and registered/disconnected | Profile exists but bot is unloaded | Start that named agent through `start-agent` |
| Bot is `starting` | Lifecycle is in progress | Wait for `world_ready`; do not issue another start |
| Callback missing but bot becomes `world_ready` | Advisory acknowledgement loss | Accept the authoritative state within the same bounded edge |
| Held bot reaches `world_ready`, then cleanly returns to `stopped` with no human online | Expected safe unload under persistent Operator Hold | Leave it stopped until a human or authorized campaign needs it |
| Bot is `failed` or readiness stays unknown | Terminal startup failure | Preserve diagnostics and stop; do not dispatch gameplay |

## Shutdown

If you started the launcher, send SIGINT to that launcher and wait. Its shutdown
path stops the owned bots, managed Paper process, task runners, and local
services. Do not kill Java separately unless the owned shutdown reports failure.
