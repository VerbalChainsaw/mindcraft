# Codeplan: Verified stack shutdown ownership

## Contract and safety
- Required behavior: Stop Everything must stop and verify every Mindcraft-owned bot, task-runner child, managed Java server, and locally started Ollama process; normal launcher exit must use the same cleanup owners; UI success must mean postconditions, not request acceptance.
- Acceptance criteria: stack shutdown returns structured component outcomes and fails if any owned component remains; stop-all-agents waits for exits; owned process trees receive bounded force cleanup; focused tests prove success and partial-failure reporting.
- Must preserve: unrelated Node/Java/provider processes, externally started Ollama, the dashboard distinction between runtime stop and full control-center shutdown, and the dirty shared checkout.
- Out of scope: broad suites, live relaunch, heuristic machine-wide process killing, commits, packaging, or publication.
- Workspace/user work: present and protected.
- Pre-change evidence: two unrelated stale Node servers were removed by exact PID; Mindcraft’s stack endpoint stopped only connection-derived agents and Java, Ollama was detached/untracked, Stop All Bots acknowledged immediately, and launcher signals skipped bot/provider cleanup.

## Repository evidence
- `mindcraft.js` owns the authoritative agent-process registry.
- `AgentProcess.waitForExit()` and managed-server `stop()` provide bounded completion seams.
- MindServer currently owns task runners, director timers, and local Ollama startup.
- Existing UI already distinguishes runtime stop from control-center shutdown, but the `Stop Everything` label overstates its old scope.

## Mode
- Candidate mode: constrained
- Candidate count: 2
- Record profile: forensic

## Candidates
- V1 `owned-registry/postcondition/tree-cleanup`: stop from authoritative registries, retain handles for locally started services, force only owned child trees after a grace period, and return structured postconditions.
- V2 `os-sweep/commandline-heuristic`: scan all Windows processes during every stop and kill anything resembling Mindcraft, Node viewers, Java, or Ollama.

## Divergence
- V1 proves ownership before termination and works through runtime contracts; V2 may catch unregistered orphans but risks destroying unrelated user services and cannot safely generalize across platforms.

## Paper gates
- V1: pass - satisfies cleanup while preserving unrelated processes and supports focused deterministic tests.
- V2: fail - violates the explicit unrelated-process safety boundary and repository process ownership model.

## IN
[codeplan · verified-stack-shutdown · IN · mode: constrained · profile: forensic · confidence: high · candidates: V1=owned-registry,postcondition,tree-cleanup;V2=os-sweep,commandline-heuristic · lean: V1 · conservative: V1]

## Frozen rubric and scoring
- freeze: axes=ownership-safety,shutdown-correctness,repository-fit,verifiability,implementation-risk classes=risk,quality,quality,quality,risk weights=3,3,3,2,2 denominator=65 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer
- V1: `(5*3 + 5*3 + 5*3 + 4*2 + 4*2)/65 = 61/65 = 0.94`.
- V2: disqualified before scoring because it cannot preserve unrelated processes.
- Formal baseline: V1. Selection is stable.

## PLAN-OUT
[codeplan · verified-stack-shutdown · PLAN-OUT · mode: constrained · profile: forensic · pick: V1 · baseline: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1=0.94;V2=disqualified · reason: authoritative registries and retained child handles provide complete normal-path cleanup without machine-wide collateral damage · planned-fingerprint: owned-registry,postcondition,tree-cleanup,bounded-force]

## Implementation
- Add a bounded owned-process-tree terminator.
- Add an owned local-service manager; do not detach or stop pre-existing Ollama.
- Add authoritative `stopAllAgentsAndWait` with graceful then forced cleanup.
- Make swarm task-runner shutdown await owned child termination.
- Make stack shutdown collect component postconditions and report partial failure.
- Route Stop All Bots and Stop Everything through verified completion.
- Make launcher signals stop agents, task runners/local services, and managed Java before exit.
- Clarify the dashboard label as `Stop Mindcraft Runtime`; reserve `Shut Down Mindcraft` for closing the control center.
- Add only focused critical tests and run the critical gate.

## EXEC-OUT
[codeplan · verified-stack-shutdown · EXEC-OUT · implemented: V1 · confidence: high · verification: focused-pass · mechanism-check: passed · plan-history: unchanged · corrected: authoritative bot stop/removal waits for exit, runtime stop owns every registered component, stalled child trees receive bounded force cleanup, UI deadlines match lifecycle bounds, and unrelated processes remain outside ownership · evidence: stale PIDs 13532/24100 gone; respawned PID 3276 and its five-process owner tree rooted at PID 27780 gone; ports 3000/8643/8080/25579/11434 closed; npm run check:critical passed 9 tests plus focused lint, syntax, and 17-file direct format checks; no Mindcraft service or dashboard launch ran]
