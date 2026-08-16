# Architecture Audit — Performance, Execution Speed, Logical Flow

**Repo:** `minecraft-companion-brain-v2`
**Date:** 2026-08-03
**Mode:** read-only audit (no code changed)
**Scope:** defects impacting performance, speed of execution, and logical flow only.
**Method:** two parallel evidence-grounded audit lanes (hot-path/control-flow; concurrency/state/wiring), then synthesis. Every finding tied to `file:line` verified in source.

## Doctrine respected

Per `docs/architecture/machine-brain-v2/BOUNDARY-CONTRACT.md` and `docs/architecture/machine-brain-v2/README.md`:

- No finding proposes rewriting `src/agent/library/skills.js`.
- No finding proposes a second physical-action executor. `ActionManager` remains the sole serializer.
- No finding proposes a big-bang rewrite. All fixes are surgical or explicitly marked `architectural-remediation`.
- v2 components observe/recommend only; findings that touch arbitration respect the legacy rollback authority.

## Executive summary

The system is architecturally sound at the boundary level: the arbiter/action-manager serialization model, the director layering, the state-pump delta protocol, and the shutdown ordering are all correct and well-bounded. The defects that will actually cost you performance and logical flow cluster in **four themes**:

1. **The prompt-assembly hot path re-derives everything every turn** (P1-A-001, P1-A-002, P1-A-015, P2-B-002). Every autonomous turn re-probes the world (`!awareness`, `!inventory`), re-runs an embedding round trip, re-ranks examples with a destructive sort, and — via `LandmarkMemory.recall()` — can write a 256 KB JSON file synchronously with fsync. This is the single largest per-turn wall-clock cost before the LLM call.
2. **Synchronous fsync writes inside the behavior-arbiter tick** (P1-A-003, P1-A-004). `GoalDirector` and `JobDirector` persist state via `writeJsonAtomicSync` (open→write→fsync→close→rename) from inside the tick loop, up to 6 transitions × 2 writes per tick. This stalls the agent's event loop — the same loop that must answer Mineflayer packets.
3. **Provider timeouts are missing on two providers** (P1-A-005). `openai_compatible` and `qwen` drop the profile's `timeout`/`timeout_seconds` into the request body instead of the client config, so a stalled provider hangs the turn loop for the OpenAI SDK's 10-minute default. The failure-backoff path cannot fire because the promise never rejects.
4. **The agent child process has no signal handler** (P2-B-001). The launcher's graceful stop sends SIGINT, but the child never registers a handler, so Node's default terminates the process immediately — bypassing `teardownAndExit`, in-flight action cancellation, the exit chat line, and prompter disposal. The operator sees a "successful" stop that was actually an uncontrolled kill.

Plus a set of medium/low async-hygiene, unbounded-growth, and dead-control-flow defects (P1-A-006..014, P2-B-003..007).

**Count:** 22 findings — 3 Critical, 5 High, 8 Medium, 6 Low. 16 Confirmed, 4 Likely, 2 Suspected.

---

## Active runtime map (confirmed)

```
start-mindcraft.bat / node main.js
  └─ launcher (main.js)
      ├─ Mindcraft.init → MindServer (express + socket.io, :8080, loopback-only)
      │    ├─ dashboard (public/js/*)
      │    ├─ agent-state-pump (delta/snapshot protocol, gated on dashboard demand)
      │    └─ restart handoff (IPC, port reclaim)
      ├─ managed Paper Java process (managed-minecraft-server.js)
      ├─ local services (ollama) (owned-local-services.js)
      └─ per-agent child processes (src/process/agent_process.js → init_agent.js)
           └─ agent.js
                ├─ BehaviorArbiter (priority lanes, wake-timer)
                │    ├─ GoalDirector / JobDirector / SurvivalDirector / ReactionDirector
                │    │    └─ persist → writeJsonAtomicSync (fsync)  ← P1-A-003/004
                │    └─ SelfPrompter (autonomy loop) → promptAutonomy → replaceStrings
                │         └─ Examples.getRelevant (embedding RTT + sort)  ← P1-A-001/002/015
                ├─ ActionManager (sole physical-action serializer)
                └─ connection_handler ↔ Mineflayer
```

---

## Findings register

### Critical

#### P1-A-001 — `promptAutonomy` rebuilds the entire prompt (stats, inventory, examples, memory) from scratch every turn
- **Severity:** Critical · **Confidence:** Confirmed · **Category:** Perf Hot Path
- **Evidence:** `src/models/prompter.js:526-548` — `promptAutonomy()` calls `replaceStrings(template, messages, this.convo_examples)` unconditionally every turn. `replaceStrings` (`prompter.js:285-392`) runs `$STATS` → `await getCommand('!awareness').perform(this.agent)` (full registry/inventory/entity probe), `$INVENTORY` → `!inventory`, `$EXAMPLES` → `examples.createExampleMessage(messages)` → `getRelevant`, `$MEMORY` → `buildMemoryRecall(...)`. The self-prompt loop fires this every ~350 ms idle + every cooldown cycle (`src/agent/self_prompter.js:282-316`). The command-docs string IS cached (`prompter.js:513-524`), proving the pattern was known and the rest missed.
- **Impact:** Every autonomous turn re-probes the world and re-runs an embedding round trip on the request thread before the LLM call. For a 4-bot squad this is a measurable wall-clock floor under each turn.
- **Root cause:** `replaceStrings` was written for one-shot convo calls; autonomy inherited it without per-turn layer caching.
- **Surgical fix:** Per-turn cache keyed on the bot's perception revision for `$STATS`/`$INVENTORY`; cache embedding+ranking in `Examples.getRelevant` keyed on the last-8-turns slice (`self_prompter.js:314` already slices it).
- **Validation:** `console.time`/`timeEnd` around `replaceStrings`; observe per-turn wall clock drop from ~50-200 ms to near zero after the first turn.

#### P1-A-002 — `Examples.getRelevant` mutates `this.examples` via sort and triggers a fresh embedding round trip every call
- **Severity:** Critical · **Confidence:** Confirmed · **Category:** Perf Hot Path
- **Evidence:** `src/utils/examples.js:46-66` — `getRelevant(turns)` calls `await this.model.embed(turn_text)` then `this.examples.sort(...)` **every call**, mutating the loaded example set in place, then `JSON.parse(JSON.stringify(selected))` deep-copies. Called from every `$EXAMPLES` expansion in `promptAutonomy`, `promptConvo`, `promptCoding`.
- **Impact:** (a) Embedding RTT (~50-500 ms to a hosted provider) swallows the request thread every turn. (b) Destructive sort recomputes every cosine similarity each call — O(n·cost) per turn with no memoization.
- **Root cause:** Pre-LLM-cost-era code never profiled under autonomy cadence.
- **Surgical fix:** Cache latest turn-text → selected-examples pair; bust only when the last-user-message slice changes. Sort a copy (`[...this.examples].sort(...)`) instead of mutating.
- **Validation:** `node --prof` a 60 s autonomy session; embedding provider calls drop from ~3/sec to ~1/sec.

#### P2-B-001 — Agent child process has no SIGINT/SIGTERM handler; launcher graceful-stop bypasses `teardownAndExit`
- **Severity:** Critical · **Confidence:** Confirmed · **Category:** Logical-Flow Break / Async-Hygiene / Resource Ownership
- **Evidence:** `src/process/agent_process.js:203` (`stop()` → `process.kill('SIGINT')`), `:243`, `:504` (forceRestart/startup-failure send SIGINT), `:386` (parent treats SIGINT as graceful `stopped`/`retryable`). `src/process/init_agent.js` (38 lines) registers **no** signal handler. `src/agent/agent.js:1416-1444` `teardownAndExit()` is reachable only via the internal `cleanKill()` path. Full grep across `src/agent/*.js` + `src/process/*.js` confirms zero `process.on('SIGINT'|'SIGTERM')` registrations.
- **Impact:** When `Mindcraft.stopAllAgentsAndWait()` (launcher shutdown `main.js:69`, or mindserver restart-handoff) sends SIGINT, Node's default terminates the child immediately: `actions.stop({timeoutMs:2000})` never runs (in-flight Mineflayer action not cancelled), the exit chat line never sends, `prompter.dispose()` skipped, arbiter `stop()` skipped. The launcher reports a graceful `stopped` — an uncontrolled kill.
- **Root cause:** `init_agent.js` predates `teardownAndExit`; the teardown path was added as the internal-fatal-error exit, not the OS-signal exit.
- **Surgical fix:** In `init_agent.js` after `await agent.start(...)`, register `process.once('SIGINT'|'SIGTERM', ...)` → guarded `agent.teardownAndExit(...)` with a hard upper bound so the parent's 15 s graceful timeout is respected.
- **Validation:** Stop one running agent from the dashboard; tail the agent log for `Self-prompt loop stopped` + `Exiting.` chat. Currently neither appears.

---

### High

#### P1-A-003 — `GoalDirector.persist` runs synchronous fsync+rename inside the behavior-arbiter tick
- **Severity:** High · **Confidence:** Confirmed · **Category:** Perf Hot Path
- **Evidence:** `src/agent/runtime/goal-director.js:267-271` → `GoalStateStore.save` (`goal-director.js:86-96`) → `writeJsonAtomicSync` (`src/utils/atomic-file.js:35-36`, `writeFileAtomicSync` lines 14-33: open→write→fsync→close→rename). `persist()` is called from ≥19 sites (lines 781, 794, 818, 842, 867, 890, 1029, 1034, 1037, 1045, 1053, 1057, 1069, 1074, 1080, 1121, 1154, plus inside `appendActingSubgoal`, `handleResult`, `rememberFailedTarget`, `rememberToolRequirement`, `rememberWorkstationRequirement`). The arbiter awaits `goal.update()` at `behavior-arbiter.js:692`, which loops `while (transitions < 6)` calling `persist()` several times per transition (`goal-director.js:1003-1164`).
- **Impact:** A synchronous fsync blocks the agent event loop ~1 ms (SSD) to tens of ms (slow/flush-on-write disk) per write, multiplied by up to 6 transitions × several persists per tick. Stalls every reactive handler (threat sensor, packet handling, mode-band evaluation) for the duration.
- **Root cause:** Atomic-write convenience placed in the sync family without recognizing the caller runs on the same tick loop that must answer Mineflayer packets.
- **Surgical fix:** (a) async sibling `writeFileAtomic` via `fs.promises` and migrate `GoalStateStore.save`/`JobStateStore.save` to async; or (b) write-coalesced buffer flushed on a 50 ms debounced timer. Either eliminates the per-tick fsync.
- **Validation:** Profile a goal dispatch (`Assess → Acquire → Succeed`) with `node --prof`; pre-fix `writeFileAtomicSync` shows ≥3 self-time samples per tick.

#### P1-A-004 — `JobDirector` same sync-write-per-tick pattern + redundant double-persist per planner loop
- **Severity:** High · **Confidence:** Confirmed · **Category:** Perf Hot Path
- **Evidence:** `src/agent/runtime/job-director.js:728-744` (`persist()` → `JobStateStore.save` → `writeJsonAtomicSync`); `job-director.js:880-893` calls `this.persist({...})` twice in quick succession (lines 883 and 887-893) before `void Promise.resolve(executeJobCommand(...))`. The arbiter ticks `job.update()` from ≥4 lanes (`behavior-arbiter.js:652, 704, 716, 752`).
- **Impact:** Same as P1-A-003, amplified: a single arbiter tick can call `job.update()` more than once across lanes, and the planner loop runs up to 6 transitions × 2 persists each.
- **Root cause:** Shared store infrastructure; sync write applied uniformly.
- **Surgical fix:** Same async/debounce fix as P1-A-003. Merge the double-persist at `job-director.js:883-893` into one write (the second only sets `anchor`).
- **Validation:** Same profiling as P1-A-003; assert `writeFileAtomicSync` absent from in-tick samples.

#### P1-A-005 — `openai_compatible` and `qwen` providers ship no request timeout; a stalled provider hangs the turn loop for the SDK default (10 min)
- **Severity:** High · **Confidence:** Confirmed · **Category:** Control-Flow Defect
- **Evidence:** `src/models/openai_compatible.js:23-48` constructs `new OpenAIApi({ baseURL, apiKey })` with no `timeout`; the `params` spread goes into the chat-completions **body** (`openai_compatible.js:58-63`), so a profile's `timeout`/`timeout_seconds` is silently dropped. `src/models/qwen.js:7-16` repeats it. Compare `src/models/gpt.js:18-36` which correctly extracts `{ timeout, timeout_seconds, ...bodyParams }` and sets `config.timeout = Math.round(timeoutSeconds * 1000)`.
- **Impact:** A stalled TLS stream (known for self-hosted Ollama, NVIDIA, DashScope Qwen) parks `promptAutonomy → _generateAutonomy → sendRequest` (`prompter.js:556`) for the full 10-minute default. The failure-backoff path (`self_prompter.js:321-340`) cannot fire because the promise never rejects. The bot is silent and unresponsive; reflex lane ownership idles because the turn is "processing".
- **Root cause:** Newer providers copied the body-spread pattern from `gpt.js` without porting its client-config extraction.
- **Surgical fix:** Extract `timeout`/`timeout_seconds` in `OpenAICompatible`/`Qwen` constructors exactly as `gpt.js` does; default to a safety-bounded value (e.g. 120 s) when unset.
- **Validation:** Point a profile at a deliberately hung TCP endpoint; assert the request rejects within the configured timeout, not 10 minutes.

#### P2-B-002 — `LandmarkMemory.recall()` writes the full JSON file on every prompt assembly
- **Severity:** High · **Confidence:** Confirmed · **Category:** Runtime Fragility / Logical-Flow Break (read path performs write IO)
- **Evidence:** `src/agent/runtime/landmark-memory.js:188-220` — `recall()` ends with an unconditional `this.save()` at line 219, writing the entire `landmarks.json` (up to `MAX_STORE_BYTES = 256 * 1024`) synchronously via `writeJsonAtomicSync` whenever `dirty` is true. `recall()` calls `this.prune()` (line 191, sets dirty on expiry) and `verifyAgainstWorld(bot, ...)` (lines 205-213, deletes mined-out blocks, sets dirty). `recall()` is invoked from `memory-recall.js:55-65` (`buildMemoryRecall`), which runs on **every prompt assembly** for every bot.
- **Impact:** A read API owns disk writes on the hot prompt path. On a populated landmark store with a 6-12 bot squad, hundreds of sync file writes per minute, each blocking the agent JS thread (write→fsync→rename).
- **Root cause:** `recall()` mutates the store while answering a query (self-healing prune/verify), and committing those mutations to disk from inside the read path was convenient.
- **Surgical fix:** Remove `this.save()` at the end of `recall()` (line 219); let the next `observe()` (line 222+) or a debounced dirty-flush perform persistence. Evictions remain in memory; the `dirty` flag already makes persistence lazy.
- **Validation:** `node -e` loop 1000 `recall()` calls after one `observe()`; assert file mtime advances once (during observe), not 1000 times.

#### P2-B-003 — `Helper.relocate()` does not await `_killProc()`; cycle timer keeps firing
- **Severity:** High · **Confidence:** Confirmed · **Category:** Async-Hygiene / Concurrency Defect
- **Evidence:** `src/mindcraft/swarm/swarm.js:200-208` — `relocate()` calls `this._killProc()` (returns a Promise, NOT awaited), bumps `_executionGeneration`, returns. `_killProc()` (lines 162-167) returns `terminateOwnedProcessTree(proc)` which on win32 issues `taskkill /T /F` and resolves asynchronously. `start()` (lines 145-148) registers `setInterval(() => this.tick()...)` and is not stopped by `relocate()`. The next tick can spawn a fresh child at the new cwd while `taskkill` is still terminating the previous tree.
- **Impact:** Two child processes briefly exist during relocate; on a target with cwd/file-lock contention this produces platform races. `_executionGeneration` protects against stale tick reuse but not the gap where neither proc is tracked.
- **Root cause:** `relocate()` was modeled as a synchronous "switch directory" helper for `in-process` mode and never grew an `await` when `child`-mode lifecycle was added.
- **Surgical fix:** Make `relocate()` `async` and `await this._killProc()` before returning; have the swarm caller await it. The `in-process` path is unaffected (await on a resolved `{alreadyExited:true}`).
- **Validation:** Unit test with an injected `terminateProcessTree` resolving after 50 ms; relocate a `child`-mode helper twice within 100 ms; assert exactly one `_proc` allocated at a time.

---

### Medium

#### P1-A-006 — `FallbackRouter.sendRequest` swallows non-transport errors; primary context exhaustion stops fallback from trying a larger-context secondary
- **Severity:** Medium · **Confidence:** Confirmed · **Category:** Logical-Flow Break
- **Evidence:** `src/models/fallback-router.js:74-101` — the loop catches an error, checks `isTransportFailure(error)`, and either rethrows or `penalize(entry)` + continues. For a non-transport throw (e.g. `context_length_exceeded` after the provider's own inline recursive retry exhausted `turns` — `openai_compatible.js:74-77`), `throw error` (line 95) bubbles immediately and never tries remaining entries, even though a secondary may have a larger context.
- **Impact:** A primary that returns "context length exceeded" with `turns.length === 1` bubbles to `SelfPrompter.startLoop`, counts as a `failure_count` (`self_prompter.js:326-333`), and backoffs 5 s — even though the secondary could answer the same single message. Repeated across turns, a long-running goal pauses after `MAX_FAILURES` (default 5) because of a primary's context limit alone.
- **Root cause:** The transport/non-transport binary does not model "primary exhausted its own sub-retry and the same payload may still succeed elsewhere".
- **Surgical fix:** Add `context_length_exceeded` to a "retry-elsewhere" set alongside transport failures, or only rethrow on the LAST entry. Keep non-transport rejections (refusals, content policy) on the primary path.
- **Validation:** Unit test: router with one provider throwing `{ message: 'Context length exceeded' }` and a second returning a valid string; assert the second is tried.

#### P1-A-007 — `SelfPrompter.startLoop` permits overlapping self-prompt turns (race window during failure-backoff `await`)
- **Severity:** Medium · **Confidence:** Likely · **Category:** Control-Flow Defect
- **Evidence:** `src/agent/self_prompter.js:321-340` — on a thrown error, `this.processing_turn` is cleared by `finally` (line 339), the catch increments `failure_count`, awaits a backoff, and `continue`s. The `while` guard re-checks `this.interrupt`/`this.state` only; it does NOT re-check whether a higher-priority lane (player `!follow`, survival, job) has taken ActionManager ownership during the backoff. The `isOwnerBlocked('autonomy')` check at line 298 is top-of-loop only and is skipped by `continue`.
- **Impact:** After backoff, the loop re-enters `promptAutonomy` even though a higher-priority action is in-flight. `executeAutonomyResponse` re-checks control at `self_prompter.js:242-258` and bails — but only after paying for the entire model round trip. Wasted model spend + perceived lag.
- **Root cause:** The early-exit `continue` branches bypass the owner-blocked precheck.
- **Surgical fix:** Move the `isOwnerBlocked('autonomy')` check inside the `while` body before the model call so `continue` re-enters it.
- **Validation:** Start autonomy, immediately issue `!follow <player>`; observe whether a concurrent autonomy generation is consumed before being discarded.

#### P1-A-008 — Arbiter single tick may call `job.update()` 3× across lanes → 3× inventory + findBlocks sweeps
- **Severity:** Medium · **Confidence:** Suspected · **Category:** Control-Flow Defect
- **Evidence:** `src/agent/runtime/behavior-arbiter.js:648-660` (`survival_job`), `:701-712` (`player_job`), `:713-724` (`command_policy_guard` fires when `autonomy === 'command'` regardless of the player_job verdict), `:745-762` (`role_work` fires when `!activeOrder || ROLE_JOB_SOURCES.has(source)`). For a command-autonomy role bot, up to three `job.update()` calls per tick. Each rebuilds the situation snapshot via `summarizeJobSituation` (`job-director.js:409-466`) — inventory counts, tool tiers for 5 families, food points, and for miner/lumberjack roles `bot.findBlocks` radius-64 sweeps (`selectedResourcePresence` AND `selectedResourceSafety`, up to 12 × `bot.blockAt` probes — `job-director.js:180-216, 218-241`). The code's own comment at `job-director.js:438-442` acknowledges the cost.
- **Impact:** Two findBlocks sweeps per tick × N lanes for miner/lumberjack bots.
- **Root cause:** Lanes layered for priority clarity; `job.update()` treated as re-entrant-without-cost.
- **Surgical fix:** Snapshot the job situation once per tick (memoize keyed on the tick window) or lift lane dispatch so only one `job.update()` runs per arbiter tick (guarded by a `jobTickedThisTick` flag).
- **Validation:** Add a counter on `selectedResourcePresence`/`selectedResourceSafety`; assert ≤1 call each per arbiter tick for a miner role. **Needs runtime probe to confirm the 3× count.**

#### P1-A-011 — `SelfPrompter.update()` calls `this.startLoop()` without await or `.catch`; unguarded rejection becomes a process-level unhandled rejection
- **Severity:** Medium · **Confidence:** Likely · **Category:** Control-Flow Defect
- **Evidence:** `src/agent/self_prompter.js:433-477` — `update()` (invoked from `behavior-arbiter.js:796`) calls `this.startLoop();` (line 451) without awaiting. `startLoop` (`self_prompter.js:282-422`) has a `try/finally` but no catch around the `while` body; an unexpected synchronous throw inside `_endGoal` or `recordGoalAttempt` propagates as an unhandled Promise rejection.
- **Impact:** (1) Unguarded rejection can crash the agent process on Node configs with `--unhandled-rejections=throw`. (2) Fire-and-forget means the arbiter cannot observe a failed loop start; it keeps selecting `self_prompt_active` based on `isActive()` while the bot no longer makes decisions.
- **Root cause:** `startLoop` predates the arbiter tick loop framing it as an externally-observed subsystem.
- **Surgical fix:** Add a `.catch(...)` sink to the `startLoop()` call inside `update()` (or wrap `startLoop` with try/catch that resets to STOPPED on unhandled throws).
- **Validation:** Inject a forced throw inside `startLoop`'s `_endGoal`; assert the agent process does not die and the arbiter selects `degraded` rather than `self_prompt_active`.

#### P1-A-012 — `summarizeSurvivalSituation` cache invalidated by >2-block movement every tick → walking bot pays full entity + findBlocks sweep each tick
- **Severity:** Medium · **Confidence:** Confirmed · **Category:** Perf Hot Path
- **Evidence:** `src/agent/runtime/survival-director.js:252-295` — `environmentalSituation` caches by `(bot, dimension)` with `SURVIVAL_ENVIRONMENT_TTL_MS = 1_000` ms, but the cache is invalidated if `moved` (Euclidean distance > 2) OR `now >= cached.nextRefreshAt`. A walking bot is moving continuously, so the cache only helps when fully still for 1 s. `usefulDropCandidates` (`survival-director.js:127-150`) iterates `Object.values(bot.entities || {})` computing `entity.position.distanceTo` for every item entity within 12 blocks on every cache bust. The arbiter invokes `survival.update()` (`survival-director.js:402`) on the `basic_survival` lane (`behavior-arbiter.js:634-646`).
- **Impact:** A walking bot invalidates the cache every tick (~180 ms cadence); each tick rebuilds the entity scan and, if needs match, two findBlocks sweeps. For a 4-bot squad exploring, measurable per-tick cost with no gameplay benefit when no survival intent fires.
- **Root cause:** Cache tuned when bots stood still in conversation; autonomous walking cadence not re-benchmarked.
- **Surgical fix:** (a) Move cheap `usefulDropCandidates` + constant `bot.food`/`bot.health`/`bot.time` reads outside the movement-busted cache (or cache them on a tighter TTL regardless of movement). (b) Keep the expensive findBlocks sweeps gated behind `chooseSurvivalIntent`'s lightweight preconditions (partially done at `survival-director.js:325-331`; tighten so the entity scan is unconditional but the sweeps remain gated).
- **Validation:** Profile a walking autonomy session; pre-fix `usefulDropCandidates` shows per-tick self time.

#### P1-A-014 — `GoalDirector.dispatch` returns synchronously before ActionManager claim; reflex lane can preempt a just-dispatched player goal
- **Severity:** Medium · **Confidence:** Likely · **Category:** Logical-Flow Break
- **Evidence:** `src/agent/runtime/goal-director.js:902-953` — `dispatch()` performs `void Promise.resolve(this.executeGoalCommand(...)).then(...).finally(() => { this.inFlight = false; })` and returns `true` synchronously. The arbiter's `player_goal` lane sees `dispatch → true` and returns. Until the dispatched `executeGoalCommand` resolves (a full Mineflayer skill execution, possibly seconds), `agent.actions.executing` may be false. `classifyActiveAction` (`behavior-arbiter.js:446-478`) returns `null` during that window, falling through to bounded_recovery/opportunity lanes which can preempt. Reflex (priority 50) blocks player (30) ownership, so a reflex action racing the goal's claim wins; `handleResult` only harvests outcomes whose `actionId !== previousActionId`, so a `missing_action_result` is fabricated — silently counting as a failed attempt against `goal.maxAttempts`.
- **Impact:** A reflex/recovery mode can fire concurrently with a just-dispatched player goal command; the goal's attempt is silently counted as failed.
- **Root cause:** The `dispatch → Promise.resolve(...).then(...)` pattern records intent (`inFlight=true`, `activeGoal` updated) without claiming ActionManager.
- **Surgical fix:** Have `GoalDirector.dispatch` synchronously call `this.agent.actions.runWithOwner('player', () => this.executeGoalCommand(...))` so ActionManager's owner-check guards the reflex race. Or ensure `goal.update()` does not return before the action dispatch has entered `_executeAction`. Mark `architectural-remediation` if broader.
- **Validation:** Trace probe recording `(inFlight=true, actions.executing)` immediately after `goal.dispatch` returns; assert `actions.executing === true` or `currentActionLabel` set before the next arbiter tick. **Needs evidence probe.**

#### P2-B-004 — `ActionManager._startTimeout` schedules an async `setTimeout` with unhandled rejection
- **Severity:** Medium · **Confidence:** Confirmed · **Category:** Async-Hygiene / Runtime Fragility
- **Evidence:** `src/agent/action_manager.js:646-655` — `setTimeout(async () => { ... this.agent.history.add('system', ...); ... await this.stop(); }, TIMEOUT_MINS * 60 * 1000)`. `History.add` (line 148) is async and may call `summarizeMemories` (model call, can reject) — called without await or `.catch`. `await this.stop()` is the only awaited path inside the inner async; the outer `setTimeout(async () => …)` returns a Promise nobody awaits; if `stop()` rejects it surfaces as `unhandledRejection` (crash on Node ≥15 in some configs).
- **Impact:** When a player-issued command runs long enough to time out, a model summarization rejection during `history.add` can crash the agent child process — exactly when the timeout handler is supposed to recover the bot.
- **Root cause:** The async-`setTimeout` pattern was wrapped to allow `await this.stop()` but the outer promise's error surface was missed.
- **Surgical fix:** Replace the inner `async () =>` with a `.catch`-guarded IIFE that logs `[action-manager] Timeout recovery failed:` and never lets the rejection escape.
- **Validation:** Set `TIMEOUT_MINS` to 0.05 via test fixture, mock `prompter.promptMemSaving` to reject; assert the agent stays alive and logs the recovery-failed line.

#### P2-B-005 — `JobDirector.completedOrderIds` Set grows without eviction across long-lived sessions
- **Severity:** Medium · **Confidence:** Confirmed · **Category:** Unbounded Growth
- **Evidence:** `src/agent/runtime/job-director.js:604` — `this.completedOrderIds = new Set();` (never loaded from disk). `:754` — `if (phase === 'complete') this.completedOrderIds.add(terminal.id);` — only ever adds, never prunes, never serialized. `:817` uses it as the de-dupe key for automatic role orders; `constructionTaskOrder` at line 476 short-circuits completed orders. Ids are `order-${Date.now()}-${random}` shaped; growth is linear in unique role work orders completed.
- **Impact:** Slow unbounded memory growth over multi-hour autonomous runs; for a builder bot whose blueprint is fully completed, entries become dead weight until process restart.
- **Root cause:** The de-dupe set was added without realizing non-builder roles generate fresh unique order ids on every quota-fill cycle.
- **Surgical fix:** Cap with an LRU-style ring: when `size >= MAX_COMPLETED_ORDERS (256)`, delete the oldest (`values().next().value`) before adding.
- **Validation:** Unit test: complete 300 work orders for a `miner` role; assert `size === 256` after the run.

---

### Low

#### P1-A-009 — Per-agent synchronous re-parse of `_default.json` at Prompter construction
- **Severity:** Low · **Confidence:** Confirmed · **Category:** Perf Hot Path (startup)
- **Evidence:** `src/models/prompter.js:73-90` — constructor runs `JSON.parse(readFileSync(path.join(defaults_dir, '_default.json'), 'utf8'))` (line 73) unconditionally, then parses the base profile (line 84). `main.js:86` (`loadSelectedProfiles`) already parsed each selected profile; the launcher then builds a new `Prompter` that re-reads `_default.json` again.
- **Impact:** Startup-only; N extra sync file reads of the same content for N bots. Microseconds on SSD, linear on network-mounted profiles.
- **Surgical fix:** Memoize the `_default.json` parse at module level in `runtime-config.js` (which already owns settings concerns).
- **Validation:** Wrap `readFileSync` for `_default.json` with a module-level cache.

#### P1-A-010 — `replaceStrings`'s `$BLUEPRINTS` branch uses `for...in` over `npc.constructions`
- **Severity:** Low · **Confidence:** Suspected · **Category:** Standards Drift
- **Evidence:** `src/models/prompter.js:376-384` — `for (let blueprint in this.agent.npc.constructions)`. Every other keyed iteration in the file uses `Object.keys`/`Object.entries` (e.g. `prompter.js:386-389`, `agent-state-pump.js:264`, `behavior-event.js:66`). If `npc.constructions` is ever an object with a non-default prototype, enumeration includes prototype keys.
- **Impact:** Latent correctness drift in the hot prompt builder; the `.slice(0, -2)` trailing-comma trim is also fragile.
- **Surgical fix:** `for (const blueprint of Object.keys(this.agent.npc.constructions))`; use `.join(', ')` instead of slice.
- **Validation:** Visual; no behavior change for plain-object constructions.

#### P1-A-013 — Stale `timedout` flag leakage between action executions in ActionManager catch path
- **Severity:** Low · **Confidence:** Suspected · **Category:** Control-Flow Defect
- **Evidence:** `src/agent/action_manager.js:574-596` — the catch block re-issues `await this.stop()` at line 596 after `cancelResume()`. `this.timedout` is reset only at line 478 inside `_executeAction`; if a skill throws during `actionFn` invocation itself (before the timeout was set), `this.timedout` may be stale from a prior action that DID time out. `clearTimeout(undefined)` is a no-op, so no crash — but the failure-result construction at lines 598-604 can carry stale timeout wording.
- **Impact:** Latent state leak; minor. Flagged as Suspected because the failure modes require careful sequence analysis.
- **Surgical fix:** Set `this.timedout = false` at the top of `_executeAction` (before the try), above the current line 478.
- **Validation:** Unit test invoking a mock actionFn that throws synchronously after a prior `this.timedout = true` action; inspect the result detail for stale timeout wording.

#### P1-A-015 — `Examples.getRelevant` recomputes `turnsToText` inside the sort comparator — 2n log n wasted concat per turn
- **Severity:** Low · **Confidence:** Confirmed · **Category:** Perf Hot Path
- **Evidence:** `src/utils/examples.js:30-39` (load: stores `embeddings[turn_text] = embedding`), `:46-66` (getRelevant: the sort comparator calls `this.turnsToText(b)` and `turnsToText(a)` repeatedly on every comparator invocation — `Array.sort` may invoke it O(n log n) times, recomputing the same stable string keys).
- **Impact:** Minor per-turn cost vs the embedding calls, but stacks with P1-A-001/002; on 1k-example profiles this is wasted work each turn.
- **Surgical fix:** Memoize `turnsToText` per example once at `load` time (store `{ text, turns }` pairs or a parallel `exampleTexts` array).
- **Validation:** `console.time('examples-rank')` inside `getRelevant`; expect constant-time-vs-input-size ranking after the memo.

#### P2-B-006 — `BehaviorEventBus extends EventEmitter` but zero listeners anywhere + no `setMaxListeners`
- **Severity:** Low · **Confidence:** Confirmed · **Category:** Runtime Fragility (latent)
- **Evidence:** `src/agent/runtime/behavior-event.js:127` — `export class BehaviorEventBus extends EventEmitter` without `setMaxListeners`. `publish()` (line 138) calls `this.emit('event', event)`. Repo-wide grep for `behavior_events.on|once|addListener|off` returns zero matches; the only consumer is `reaction-director.js:132` via `drain()`. The `seen`-Set dedup and `queue` ring are the actual mechanism.
- **Impact:** Decorative inheritance; latent risk if future code attaches listeners to a singleton that lives for the agent's lifetime.
- **Surgical fix:** Either drop `extends EventEmitter` + `this.emit(...)` (zero behavior change), or `setMaxListeners(8)` in the constructor.
- **Validation:** Repo-wide grep confirms no listeners; re-run `tests/control-plane/agent-lifecycle.test.js`.

#### P2-B-007 — `SelfPrompter.update()` declares an unreachable `reseedPrompt === null` gate
- **Severity:** Low · **Confidence:** Confirmed · **Category:** Logical-Flow Break (dead control-flow)
- **Evidence:** `src/agent/self_prompter.js:372-405` — `let reseedPrompt = null;` is never reassigned between declaration and the `reseedPrompt === null` check, so the check is always true. The surrounding comment block suggests a suppressed branch was intended.
- **Impact:** No perf/correctness delta today; misleading to a reader adding another reseed suppression branch.
- **Surgical fix:** Remove the dead clause and unused `let`, or actually wire the suppressed branch (set `reseedPrompt = ''` in the active-stuck branch).
- **Validation:** Unit test asserting the reseed handler is/isn't invoked in the relevant branches.

---

## Audited clean — no material defects found

These surfaces were inspected and are correctly bounded. Do not "fix" them.

- **`src/mindcraft/agent-state-pump.js`** — bounded delta/snapshot protocol, exponential failure backoff, learned-timeout, maxConcurrent workers, idle-waiter shutdown. Polling cadence beats the legacy push model.
- **`src/agent/runtime/interruptible-delay.js`** — emitter-driven with timeouts and listener cleanup in all exit paths; `signalInterrupt` fire-safe.
- **`src/agent/runtime/behavior-event.js`** — bounded queue (128) / seen (512) / dedup with FIFO eviction; `drain` non-mutating.
- **`src/mindcraft/runtime-config.js`** — settings precedence explicit; single deep-clone at launcher start, not per-turn.
- **`src/agent/command-policy.js`** — no NL bypass path violating the boundary contract; `dispatchPlayerAgenda` queues through `AgendaDirector.add`, not directly into skills.
- **`src/mindcraft/director.js`** — launcher-program timer chains cleaned on `stop()`; leash interval cleaned on release.
- **Memory stores** — `knowledge-store`, `personal-memory`, `player-memory`, `procedure-store`, `home-state-store`, `job-state-store`, `squad-scenario-store` all hard-capped (`MAX_ENTRIES`, `MAX_STORE_BYTES`, `MAX_FARM_CELLS`), reject oversize files on load, quarantine corrupt JSON, use atomic writes. `goal-director.failedTargets` bounded via `slice(-MAX_FAILED_TARGETS)`. The single exception is `job-director.completedOrderIds` (P2-B-005).
- **`src/agent/runtime/decision-trace.js`** — retention enforced in code (`clampRetention` caps at 512; `recent` sliced at retention; `ACTION_LIFECYCLE_RETENTION = 128`; timing arrays clipped via `retain`). No per-tick large-structure serialization.
- **`src/agent/runtime/environment-observer.js`** — `players` Map ≤64, `lastBlockEventAt` Map ≤256, FIFO evictions.
- **`src/agent/runtime/combat-attribution.js`** — stateless. **`companion-context.js`** — single per-bot object with TTL expiry. **`comportment.js`** — pure functions + preset tables.
- **`src/agent/runtime/behavior-arbiter.js`** — wake-timer/wakeResolve/wakeDeadline tracked explicitly; `stop()` releases a parked loop immediately; main update loop wraps body in try/catch with 5-strike cleanKill.
- **`src/mindcraft/stack-shutdown.js`** — ordering correct: director → task-runners → agents → minecraft → local-services. `terminateOwnedProcessTree` 5 s default with SIGTERM-then-SIGKILL fallback. Restart handoff `restoreOriginalStack` correct (stops agents → Ollama → Minecraft → closes listener → IPC → exit).
- **`src/mindcraft/swarm/swarm.js`** — `Helper.start()` guards re-entry; watchdog throttled ≥1 s; watchdog try/catch swallows listener errors. **`bot-squad-manager.js`** — injectable bounded sleep, `cancelRequested` checked between awaits, finalization polling capped at 10 s, `Promise.all` parallel stops (not O(N²)).
- **MindServer broadcast hygiene** — `publishAgentStates` (`mindserver.js:2915-2929`) uses `fingerprintAgentStates()` to skip unchanged broadcasts; listener pump gated on `agent_listeners.length > 0` (zero polling with no dashboard); agent-side push debounced 80 ms / rate-limited 250 ms with `unref()`'d timers; dashboard health polling gated on `document.hidden`.

---

## Recommended surgical fixes (batched by risk)

**Batch 1 — tick-loop I/O (highest measurable win, lowest behavior risk):**
1. P1-A-003 + P1-A-004: async/debounced `writeFileAtomic` for `GoalStateStore`/`JobStateStore`; merge the double-persist at `job-director.js:883-893`.
2. P2-B-002: remove `this.save()` from `LandmarkMemory.recall()`.

**Batch 2 — provider reliability:**
3. P1-A-005: extract `timeout`/`timeout_seconds` in `OpenAICompatible`/`Qwen` constructors (precedent: `gpt.js`).
4. P1-A-006: add `context_length_exceeded` to the fallback-router retry-elsewhere set.

**Batch 3 — prompt hot path (do together so the wall-clock drop is measurable in one profiling run):**
5. P1-A-001 + P1-A-002 + P1-A-015: per-turn caching in `replaceStrings` + `Examples.getRelevant` + memoized `turnsToText`.

**Batch 4 — async hygiene / crash safety:**
6. P2-B-001: SIGINT/SIGTERM handler in `init_agent.js` → `teardownAndExit`.
7. P2-B-004: `.catch`-guarded IIFE in `ActionManager._startTimeout`.
8. P1-A-011: `.catch` sink on `SelfPrompter.startLoop()` call in `update()`.

**Batch 5 — bounded growth / dead code:**
9. P2-B-005: LRU cap on `JobDirector.completedOrderIds`.
10. P2-B-006, P2-B-007, P1-A-010, P1-A-013, P1-A-009: small surgical cleanups (drop dead EventEmitter, remove dead gate, `Object.keys` iteration, `timedout` reset placement, memoized `_default.json`).

**Needs runtime probe before fixing (do not fix blind):**
- P1-A-008 (3× `job.update()` per tick) — add a debug counter first.
- P1-A-014 (reflex-vs-goal ownership race) — add a trace probe first.

---

## Recommended architecture remediation (only where surgical fix is insufficient)

- **P1-A-014 (goal dispatch ownership race):** if the trace probe confirms the reflex preemption, the durable fix is to make `GoalDirector.dispatch` claim ActionManager synchronously via `runWithOwner('player', ...)` rather than fire-and-forget `Promise.resolve(...).then(...)`. This is a bounded change to one dispatch site, but it touches the arbitration contract, so it should be treated as a controlled change with the existing control-plane tests as the gate.
- **P1-A-008 (multi-lane job.update):** if the probe confirms 3× per tick, lift the lane dispatch so exactly one `job.update()` runs per arbiter tick. This is a small arbiter change but affects lane semantics; treat as controlled.

No other finding requires architecture-level remediation. Everything else is a bounded surgical fix.

---

## Validation commands

```bash
# Batch 1 — profile the tick loop before/after
node --prof src/main.js   # or: clinic flame -- node main.js
# assert writeFileAtomicSync absent from in-tick samples

# Batch 2 — provider timeout
# point a profile at a hung TCP endpoint; assert rejection within configured timeout

# Batch 3 — prompt hot path
node --prof # 60s autonomy session; embedding provider calls drop from ~3/s to ~1/s

# Batch 4 — crash safety
# stop one agent from dashboard; tail agent log for "Self-prompt loop stopped" + "Exiting."

# Batch 5 — bounded growth
node --test tests/control-plane/job-director.test.js   # after adding LRU cap test

# Existing gates to re-run after any change
npm run check:control-plane
npm run check:behavior
npm run check:critical
```

---

## Blocked unknowns

- **P1-A-008 exact 3× `job.update()` count** — statically confirmed multiple lanes CAN fire in one tick; runtime counter needed to confirm the actual count for a command-autonomy role bot.
- **P1-A-014 reflex-vs-goal race** — strongly suspected from code path; a single trace probe is sufficient to confirm.
- **P1-A-013 stale `timedout`** — sequence analysis suggests the invariant mostly holds today; needs a targeted unit test to confirm the leak is reachable.

---

## Next three safest actions

1. **Land Batch 1** (P1-A-003 + P1-A-004 + P2-B-002): async/debounced persistence for `GoalStateStore`/`JobStateStore` + remove `save()` from `LandmarkMemory.recall()`. Lowest behavioral risk, highest measurable per-tick win; does not change decision semantics, only I/O timing.
2. **Land Batch 2** (P1-A-005 + P1-A-006): provider timeouts + fallback-router context-exhaustion retry. Single-file, additive, well-precedented by `gpt.js`; prevents a class of stuck-bot incidents.
3. **Land Batch 3** (P1-A-001 + P1-A-002 + P1-A-015): prompt hot-path caching. Small, additive, measurable in one profiling run.
