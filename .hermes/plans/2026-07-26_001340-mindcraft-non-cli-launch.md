# MindCraft One-Click Launch Plan

> **For Hermes:** Use `software-development:plan` and `subagent-driven-development` for delegated execution task-by-task.

**Goal:** Make the MindCraft bot project launchable by double-click on Windows with minimal setup, including dependency install, API key sanity check, and automatic browser UI startup.

**Architecture:** Add a lightweight Windows launcher that validates prerequisites, initializes dependencies idempotently, and starts the existing `node main.js` entrypoint. Keep runtime behavior identical (no bot logic changes).

**Tech Stack:** Existing Node.js app + Windows batch shell + existing npm scripts.

---

## Why this path (best path forward)

From runtime checks, the main non-CLI friction points are:

1. Users can launch `node main.js`, but dependency bootstrap may fail silently in production-like shells because `NODE_ENV=production` is set on this host, which skips dev-only `patch-package` needed by `postinstall`.
2. The app has a browser UI and `auto_open_ui` in `settings.js`, but setup steps (keys/config + `npm install`) are still command-driven.
3. There is no existing documented Windows click launcher in the repo root.

A Windows `.bat` launcher with explicit `set NODE_ENV=development` during install is the lowest-risk path:
- no source code changes to bot runtime behavior,
- no packaging/Docker dependency,
- easy for non-CLI users,
- keeps `npm start` / `node main.js` as-is for advanced users.

---

## Task 1: Add one-click launcher script

**Objective:** Add a documented Windows launcher file that handles install/start flow without terminal commands.

**Files:**
- Add: `.hermes/plans/2026-07-26_001340-mindcraft-non-cli-launch.md` *(done)*
- Add: `start-mindcraft.bat`
- Optional: `START_MINDCRAFT_README.md` (if user wants separate quick-start note)

### Steps

**Step 1: Create `start-mindcraft.bat` with safe defaults**

- Print a clear title.
- Detect Node on `PATH` and fail with actionable message.
- Ensure `keys.json` exists (copy from `keys.example.json` if missing, then pause and ask user to fill it).
- Set `NODE_ENV=development` for dependency install path only.
- Run `npm install --no-audit --no-fund --progress=false`.
- Launch with `npm start`.
- Optionally suppress noisy browser opening duplication by keeping default `settings.js` `auto_open_ui=true`.

**Step 2: Make start script idempotent**

- Re-run install only if needed (or keep it each launch for reliability); choose `npm install` each launch for simplicity and dependency drift safety.
- Use `call` so script doesn't exit on failed subcommands.

### Example batch behavior (to implement)

```bat
@echo off
setlocal EnableExtensions

#
title MindCraft One-Click Launcher
where node >nul 2>nul || (
  echo [ERROR] Node.js not found. Install Node.js and reopen this window.
  pause
  exit /b 1
)
if not exist "keys.json" (
  if exist "keys.example.json" copy /Y "keys.example.json" "keys.json" >nul
)
if not exist "keys.json" (
  echo [ERROR] keys.json is missing and keys.example.json was not found.
  pause
  exit /b 1
)
set NODE_ENV=development
npm install --no-audit --no-fund --progress=false
if errorlevel 1 (
  echo [ERROR] npm install failed. Fix network/dependency errors and rerun.
  pause
  exit /b 1
)
npm start
```

---

## Task 2: Add quick discoverability in README

**Objective:** Make non-CLI entrypoint discoverable from the project start instructions.

**Files:**
- Modify: `README.md`

### Steps

1. In “Install and Run”, add a Windows one-click path:
   - `start-mindcraft.bat`
2. Include note that `keys.json` is required before first launch.
3. Keep old CLI instructions for power users (`npm install`, `node main.js`) for parity.

---

## Task 3: Validate end-to-end launch on Windows

**Objective:** Confirm non-CLI usability for your stated requirement.

**Validation commands / checks:**
- Double-click `start-mindcraft.bat` from `File Explorer`.
- Confirm output includes:
  - `MindServer running on port 8080 on host localhost`
  - Browser opens at `http://localhost:8080` (depends on Minecraft server availability).
- Confirm failure mode guidance is clear when:
  - `keys.json` absent,
  - Minecraft server is not running on `settings.js` host/port.

**Acceptance criteria:**
- No command line needed to reach first launch screen for project bootstrap/start.
- No change in bot runtime behavior beyond startup orchestration.

---

## Risks, tradeoffs, and open questions

### Risks
- `start-mindcraft.bat` still relies on external Java/Minecraft setup (not this project).
- Running `npm install` each launch may be slower first run.

### Tradeoff chosen
- Keep launcher behavior simple and robust over a complex auto-detection approach.

### Open questions
- Should we also add a “no-install mode” (skip npm install if dependencies already exist) for repeat launches?
- Should we default-check `node_modules/.bin/node` presence and skip installation when valid?
