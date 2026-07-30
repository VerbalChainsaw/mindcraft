 [codeplan · operational-control-recovery · IN · mode: full · confidence: high · candidates: V1 owner truth fields instance-state, V2 public projection serializer-inline, V3 viewer readiness handshake event-state · lean: V1 · baseline: V2]

# Operational Control Recovery

## Scope and constraints

- Preserve the dirty worktree and existing saved profiles/squads.
- Do not commit, reset, clean, or broadly reformat.
- Keep the existing control center alive until a coordinated hidden restart is required.
- Repair only failed agent/squad recovery, viewer truth, provider refresh, and the confirmed squad-only startup cause.
- Use focused contract checks, one live recovery proof, and `npm run check:critical` once at the end.

## Current contract

- Agent process ownership lives in `mindcraft.js`/`AgentProcess`; public summaries currently omit owner retryability.
- Squad records retain member settings and name reservations, but `BotSquadManager.start()` and the dashboard accept only `stopped`, not settled `failed`.
- Every registered agent receives a viewer port even when `render_bot_view` is false; the browser treats `in_game + port` as availability.
- Ollama start refreshes quick-start model state but not Bot Library provider capabilities.

## Candidates and divergence

### V1 — owner truth fields (`instance-state`, `internal-reuse`, `degrade-graceful`)

Carry retryability and viewer enabled/available state from the lifecycle owners into one public agent serializer. Permit only settled failed/stopped squad retries through the existing member start-or-recreate path. Refresh Bot Library from its existing capability loader after Ollama starts.

### V2 — public projection (`serializer-inline`, `local-derived`, `degrade-graceful`)

Derive retryability and viewer availability only while serializing public agent state, null disabled viewer ports, and make the same squad/provider changes. This is smaller, but duplicates lifecycle policy outside its owners and cannot distinguish every future failure class.

### V3 — viewer readiness handshake (`event-state`, `cross-process`, `return-code`)

Add a new child-to-control-plane viewer-ready/viewer-failed protocol and expose availability only after that handshake, alongside owner retryability and the same squad/provider changes. This gives the strongest live viewer claim but expands the child protocol and startup surface beyond the reported defect.

Divergence: V1 vs V2 differs in state location and module boundary; V1 vs V3 differs in control flow/protocol; V2 vs V3 differs in state location, protocol, and error path.

## Hard viability gates

- V1: G: pass — authoritative, dependency-free, backward-compatible additive fields, bounded scope.
- V2: G: pass — solves the current cases without dependencies, but lifecycle policy remains duplicated.
- V3: G: pass — functionally strongest and dependency-free, but has materially larger protocol/runtime blast radius.

## Frozen rubric

Rubric frozen: axes [Style, Theme, Methodology, Modernization, Error wrapping, Testability, Blast radius] · weights [1,2,2,2,2,2,1] · denominator = Σ(weights) × 5 = 60 · denominator-policy [uniform-N/A-only] · baseline-algo [lowest-effort gate-passer with no score of 1 on any quality axis]

freeze: axes=Style,Theme,Methodology,Modernization,Error wrapping,Testability,Blast radius weights=1,2,2,2,2,2,1 denom=ΣW×5 baseline=lowest-effort-gate-passer

## Scoring

| Axis | W | V1 owner truth | V2 public projection | V3 viewer handshake |
|---|---:|---:|---:|---:|
| Style | 1 | 5 | 4 | 3 |
| Theme | 2 | 5 | 4 | 4 |
| Methodology | 2 | 5 | 4 | 2 |
| Modernization | 2 | 4 | 3 | 5 |
| Error wrapping | 2 | 5 | 4 | 4 |
| Testability | 2 | 5 | 4 | 4 |
| Blast radius | 1 | 4 | 5 | 2 |
| Effort | — | medium | low | high |
| Weighted total | — | 57 | 47 | 43 |
| Normalized | — | 0.950 | 0.783 | 0.717 |

Arithmetic verified with Python: denominator `60`; V1 terms `5+10+10+8+10+10+4=57`; V2 `4+8+8+6+8+8+5=47`; V3 `3+8+4+10+8+8+2=43`.

Baseline: V2, the lowest-effort gate-passer with no quality-axis score of 1. V1 wins because it keeps lifecycle truth with lifecycle owners while avoiding V3's new child protocol.

## Work graph

1. Backend owner contract: agent retryability/public serialization, viewer enabled/available projection, settled failed squad restart, focused owner tests.
2. Browser contract: honor explicit viewer availability, render Start Again for settled failed squads, refresh Bot Library capabilities after Ollama start, focused dashboard-source tests.
3. Root-cause lane: compare direct and squad startup; apply only a confirmed repair without changing the readiness timeout.
4. Reconcile, hidden restart, one failed-to-running squad proof, coordinated shutdown proof, then the critical gate once.

## Evidence path

- Contract: a failed readiness timeout is publicly `retryable: true`; explicit `retryable: false` remains authoritative.
- Contract: a disabled viewer has `viewerEnabled: false`, `viewerAvailable: false`, and no public viewer port; the dashboard refuses to embed it.
- Contract: a settled failed squad retries retained members through `startAgent` and missing members through `createAgent`; reservations remain until successful removal.
- Contract: successful Ollama start reloads Bot Library capabilities before the success announcement.
- Live: one disposable squad fails once, retries to running, stops, starts again, and removes; no timeout increase is accepted as proof.
- Ownership: Stop Everything and control-center shutdown leave only unrelated processes; PID ancestry and listener ports are checked before any termination.

## Root-cause trace result

The direct and squad paths converge on the same normalized `mindcraft.createAgent()` launch, token registration, child process, and Mineflayer lifecycle. Persisted `Audit_1` settings targeted the proven Paper endpoint, underscore-numbered names have joined successfully before, and Paper never recorded `Audit_1` admission. The retained evidence is insufficient to distinguish a transient child stall from stale stage reporting because only stderr is durably bounded while normal startup milestones use stdout. Do not alter settings preparation, token wiring, or the 45-second parent readiness timeout without new evidence.

Before the controlled retry, add bounded timestamps for existing parent-owned stages and retain only structured startup milestones needed to distinguish settings/profile initialization, Mineflayer creation/login, spawn callback, handler readiness, and `world_ready`. This is a diagnostic affordance, not a parallel lifecycle owner.

## Completion evidence — 2026-07-29

- Owner-derived public state now exposes authoritative `retryable`, `viewerEnabled`, `viewerAvailable`, and a nullable `viewerPort` through one REST/socket serializer.
- Settled failed squads can retry retained members through `startAgent` and recreate missing members from preserved settings. The dashboard renders **Start Again** for stopped and failed squads.
- Successful Ollama startup refreshes Bot Library capabilities before the ready announcement.
- Startup diagnostics retain bounded sanitized stderr plus fixed-vocabulary elapsed milestones without capturing stdout.
- Focused control-plane integration: **31 passed, 0 failed**. Startup-evidence slice: **4 passed, 0 failed**.
- Live `Audit_1` proof: Paper-down launch settled `failed` with `retryable: true` and an ECONNREFUSED diagnostic at 4.9 seconds; after Paper returned, the same failed squad reached `running`/`world_ready`, then passed stop, start, stop, and remove.
- Shutdown returned success and removed the owned control center, Paper, and Ollama PIDs; listeners on `8080`, `25579`, and `11434` reached zero. A clean hidden source console returned on PID `32324`, port `8080`, while Paper and Ollama remained stopped.
- Final `npm run check:critical`: **9 passed, 0 failed**; critical lint, format, and syntax checks passed.
- Evidence: `.hermes/verification/2026-07-29-operational-controls-live.json`.

Known limitation: `POST /api/restart` did not complete its Windows replacement handoff in the live run. The original process retained port `8080` but stopped serving HTTP. It was terminated only after ownership verification, and the explicit hidden source-console restart succeeded. Treat the self-handoff route as open; do not claim it is reliable.

[codeplan · operational-control-recovery · OUT · mode: full · pick: V1 · confidence: high · beatBaseline: yes · scores: V1 0.950, V2 0.783, V3 0.717 · reason: owner-derived additive truth fixes the defects without a new child protocol · mechanism-check: passed · corrected: restored ordinary sanitized stderr retention after focused review]
