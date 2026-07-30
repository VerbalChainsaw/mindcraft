# Primary single-bot runtime verification

**Recorded:** 2026-07-28  
**Scope:** MP-001 through MP-006, critical-files-only acceptance  
**Result:** PASS

## Acceptance summary

| Item | Classification | Evidence |
| --- | --- | --- |
| MP-001 critical output coverage | Proved | `tests/critical-runtime-output.test.js`; 9 tests passed |
| MP-002 critical static/output gate | Proved | `npm run check:critical` exited 0 |
| MP-003 controlled verifier | Proved | Dry-run passed without connecting and listed all planned mutations |
| MP-004 critical live lifecycle | Proved | `primary-single-bot-preflight.json`; `primary-single-bot-live.json` |
| MP-005 critical regression gate | Proved | 9 passed, 0 failed; focused lint, syntax, and direct critical-file format checks passed |
| MP-006 completion audit and cleanup | Proved | This record, updated master plan, and closed verification services |

No critical criterion was contradicted or missing during the original MP-001 through MP-006 audit. A later operator-discovered shutdown defect is recorded separately as RT-083.

## Live proof

- Console: `http://localhost:8080`
- Bot: `MindcraftBot`
- Provider/model: `qwen` / `ollama/qwen2.5:3b`
- Initial state: configured, registered, stopped
- Readiness: `state: running`, `connection_stage: world_ready`, `readiness_stage: world_ready`, `in_game: true`, `socket_connected: true`
- Issued command: `!stay(1)`
- Authoritative result: `phase: succeeded`, `code: completed`, `label: action:stay`
- Observed detail: `Action output: Stayed for 1.499 seconds.`
- Final bot state: stopped, not in game, socket disconnected
- Live case duration: 24,482 ms

Completion was accepted from structured runtime state, not from chat text.

## Cleanup

The live verifier stopped the bot it started. After evidence capture, the verification dashboard, managed Java Minecraft server, and verifier-started Ollama service were shut down. Their process IDs were no longer running and ports 8080, 25579, and 11434 were not listening.

The detached Windows launch method used during this run caused foreground console windows despite its hidden flag. That launch method was discontinued; no further detached command windows were created.

## Explicitly deferred

At the user's direction, testing stopped at the critical output boundary. The comprehensive gameplay matrix and broad behavior, control-plane, repair, restart, persistence, browser/dashboard, packaging, and release gates were not run and are not implied by this PASS.

An earlier combined lifecycle/finalization/readiness test command exceeded its time limit. Its remaining test processes were stopped, the command was not counted as passing, and it was not rerun after the scope was narrowed.

## Independent-review correction

A fresh-context read-only review found that the first verifier implementation could accept a failed or unrelated fresh action, treated preflight as a snapshot, checked only other registered bots rather than human occupancy, could lose cleanup ownership when a start acknowledgement was lost, allowed dry-run/live command drift, and relied on `git diff --check` for untracked files.

The follow-up implementation corrected each finding:

- lifecycle acceptance now requires the exact fresh `succeeded` / `completed` / `action:stay` result;
- preflight now requires reachable Minecraft and the selected registered bot to be stopped;
- an unapproved managed world must return a fresh authoritative zero-player `list` result;
- cleanup ownership begins before awaiting start acknowledgement and actual agent state is reconciled in `finally`;
- failure reports retain cleanup attempts and outcomes;
- the lifecycle command and expected result live in the shared case manifest used by dry-run and live execution;
- a direct format checker scans critical files whether tracked or untracked.

`npm run check:critical` passed after the latest repairs with 9 tests and no lint, syntax, or format failures across 17 directly scanned files. No services were launched for the repair pass. The earlier live artifact predates the stricter reusable verifier, but its recorded state independently contains the exact world-ready, `action:stay` success, and stopped outcome now required.

## RT-083 shutdown ownership amendment

After the original acceptance run, the operator reported that `Stop Everything` did not work. The audit found that the dashboard aborted its request after 15 seconds, bot stop/removal handlers could acknowledge before exit, Ollama could be detached and untracked, managed Java and task-runner cleanup could terminate only a parent, and launcher signals did not invoke every runtime owner.

Source now routes runtime stop through structured component postconditions, authoritative bot ownership, retained local-service handles, and bounded complete-process-tree cleanup. The first two exact stale Node processes found during the audit were removed. When the 8643 process respawned under its surviving launcher, the verified five-process owner tree rooted at PID 27780 was terminated; port 8643 stayed closed through five follow-up checks. The final targeted process sweep was empty, and ports 3000, 8643, 8080, 25579, and 11434 were closed.

This amendment is source- and focused-gate-proved, not a live dashboard acceptance run. The corrected controls remain listed for a later operator check because this repair intentionally launched no service or visible command window.
