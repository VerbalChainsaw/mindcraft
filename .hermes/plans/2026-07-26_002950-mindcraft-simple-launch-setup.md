# Plan: Fully Automatic, User-Friendly, Configurable Mindcraft Launch

## Goal
Make the companion run with one click and give non-technical users a simple configuration path through UI + file-driven runtime settings.

## Required Components Identified
1. **Launcher Contract (Windows-first entrypoint)**
   - Validate prerequisites (`node`, `keys.json` / fallback copy)
   - Run dependency install
   - Start server process with visible progress
   - Keep port conflict behavior deterministic

2. **Runtime Config Layer**
   - New file-driven config: `launcher-config.json`
   - Schema includes:
     - server port + LAN exposure
     - startup behavior (`auto_open_ui`, `auto_start`)
     - profile list and startup defaults
     - agent profile defaults
   - Env var override path: `LAUNCHER_CONFIG_PATH`

3. **Configuration API for UI**
   - `GET /api/launcher-config`:
     - returns resolved config + runtime host/port
   - `POST /api/launcher-config`:
     - persists sanitized updates
   - `GET /api/key-status`:
     - shows API-key presence only (no secrets)

4. **Auto-Start + Port Safety in Startup**
   - `main.js` merges:
     - `launcher-config.json`
     - CLI args
     - environment overrides
   - Finds next free TCP port in a bounded range when preferred port is busy

5. **Simple Setup UI**
   - Add `src/mindcraft/public/setup.html`:
     - Runtime + agent-default controls
     - profile list editor
     - key presence dashboard
     - save to backend
   - Link from dashboard (`index.html`) as **Setup Wizard**

## Wired-Up Implementation (this pass)
- Added `src/mindcraft/launcher-config.js` with:
  - defaults, validation/sanitization, load/save helpers
  - env-config path support (`LAUNCHER_CONFIG_PATH`)
  - partial-update-safe writes
- Added tracked configs:
  - `launcher-config.example.json`
  - `launcher-config.json`
- Updated `main.js`:
  - loads launcher config
  - applies startup settings safely
  - chooses free port fallback
  - auto-start toggle + profile launch flow
- Updated `src/mindcraft/mindserver.js`:
  - exposes setup/config/key-status API endpoints
  - stores runtime host/port state for UI status
  - optional LAN bind support (`host_public`)
- Added `src/mindcraft/public/setup.html`:
  - user-facing config editor + save
- Added quick access from dashboard:
  - `Setup Wizard` link in footer
- Updated README steps for the new setup flow.

## Remaining work (optional but recommended)
- Add unit tests for launcher-config merge/validation edge cases
- Add a “restart now” button on Setup page with optional server restart endpoint
- Add migration note to preserve older `launcher-config` files
