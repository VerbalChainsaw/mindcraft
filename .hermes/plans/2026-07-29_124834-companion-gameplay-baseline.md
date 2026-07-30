# Useful Companion Gameplay Baseline Implementation Plan

> **For Hermes:** Implement directly task-by-task in the current branch and dirty working tree. Use subagents or external CLIs only for bounded independent review; do not delegate the main implementation.

**Goal:** Turn the current bot into a player-directed Minecraft companion that reliably follows, navigates, recovers from ordinary obstructions, defends, gathers, places/builds, and communicates truthfully on the live Paper server.

**Architecture:** Keep Mineflayer, Paper, authentication, model integration, `ActionManager`, action results, and the working control plane. Make `ActionManager` the single gameplay ownership boundary and give each action generation one cancellable gameplay-resource lease covering Pathfinder, controls, PvP, digging, and CollectBlock. Make companion policy command-first; move stuck handling inside one deterministic navigation supervisor; allow only bounded self-preservation and evidence-triggered defense to interrupt player work. The LLM chooses typed commands, while deterministic code owns movement, combat mechanics, inventory mutation, and block placement.

**Tech Stack:** Node.js 22, ESM, Mineflayer `^4.37.1`, `mineflayer-pathfinder` `^2.4.5`, `mineflayer-pvp` `^1.3.2`, `mineflayer-collectblock` `^1.6.0`, `mineflayer-tool` `^1.2.0`, Node test runner, Socket.IO runtime verifier, Paper managed server.

---

## 1. Objective and product boundary

The release target is one useful companion, not a generalized autonomous workforce.

The bot must:

1. obey the player before every non-safety source of work;
2. have at most one owner of movement/pathfinder/control states;
3. follow and approach the player across ordinary survival terrain;
4. detect no progress, inspect local geometry, attempt bounded escape, replan, then fail truthfully;
5. defend itself/the player only when explicitly guarding or when recent damage provides real defensive evidence;
6. gather only when requested and verify inventory change;
7. place/build only when requested and verify world blocks at exact coordinates;
8. report pursuit, engagement, completion, blockage, and interruption according to observed evidence;
9. deliver complete chat without silently discarding suffixes;
10. stop promptly and remain stopped until a new player command.

Non-goals for this baseline:

- unsolicited professions, role work, quotas, stockpiling, hunting, item collection, torch placement, wandering, or building;
- replacing Paper with Fabric;
- replacing Mineflayer with Botcraft or a Baritone client;
- adding an MCP server, dashboard surface, squad system, or new provider machinery;
- arbitrary LLM-generated JavaScript (`!newAction`) as the ordinary gameplay path;
- resuming persisted companion work after restart without a fresh player instruction;
- proving every Minecraft mechanic before proving the five core live scenarios.

## 2. Research and SDK contracts that govern implementation

Primary references:

- Mineflayer API: https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md
- Pathfinder API/events/goals: https://github.com/PrismarineJS/mineflayer-pathfinder
- PvP API/events: https://github.com/PrismarineJS/mineflayer-pvp/blob/master/docs/api.md
- CollectBlock task API: https://github.com/PrismarineJS/mineflayer-collectblock
- State-machine single-active-state pattern: https://github.com/PrismarineJS/mineflayer-statemachine
- Mindcraft upstream modes/known limitations: https://github.com/mindcraft-bots/mindcraft/blob/main/src/agent/modes.js and https://github.com/mindcraft-bots/mindcraft/blob/main/FAQ.md
- Voyager skill/critic architecture: https://github.com/MineDojo/Voyager
- MineNPC co-play task/validator architecture: https://arxiv.org/html/2601.05215v2
- Botcraft alternative execution engine: https://github.com/adepierre/Botcraft

Verified local SDK contracts:

- `node_modules/mineflayer/lib/plugins/chat.js:145-166` splits normal chat at the protocol limit.
- `node_modules/mineflayer/lib/plugins/chat.js:190-195` calls the same splitter for whispers and re-adds `/tell <username> ` to every chunk.
- `node_modules/mineflayer/lib/plugins/entities.js:377-381` emits `entityHurt(entity, source)` for the installed 1.20+ protocol implementation.
- `node_modules/mineflayer-pvp/lib/PVP.js:72-95` sets a dynamic `GoalFollow`, then emits `startedAttacking`; that event proves pursuit began, not that a hit landed.
- The documented `attackedTarget` event proves a melee attempt occurred. Damage/death evidence is still required for a confirmed hit/defeat.
- Pathfinder emits `path_update`, `path_reset`, and `goal_reached`; `path_reset` includes `stuck`, `dig_error`, and `place_error` reasons.
- `bot.pathfinder.goto(goal)` is the bounded Promise API for point navigation; dynamic following needs an explicit progress/deadline supervisor around `setGoal(..., true)`.

## 3. Current source baseline and diagnosed contradictions

Preserve the dirty working tree. Do not reset, restore, or overwrite unrelated changes.

Current reusable foundations:

- `src/agent/action_manager.js` already serializes actions, records ownership, stops prior actions, and writes structured results.
- `src/agent/runtime/action-result.js` already separates requested/succeeded/failed/blocked/interrupted phases.
- `src/agent/library/skills.js` already contains evidence-aware collection, placement, combat, follow, give, craft, and survival primitives.
- `src/agent/player-directives.js` already maps common natural-language orders to typed commands.
- `src/mindcraft/agent-state-pump.js` and `tools/verify-behavior-runtime.mjs` already expose live action state.
- Existing process, provider, and managed-server controls are green enough to preserve.

Current contradictions to remove from the active path:

- `profiles/defaults/_default.json:17-27` enables hunting, item collection, torch placement, elbow room, self-defense, and unstuck together.
- `src/agent/modes.js:305-317` says “Fighting” before action ownership or an attack.
- `src/agent/modes.js:321-405` allows ambient hunting, collection, torch placement, and elbow-room movement to interrupt following.
- `src/agent/modes.js:455-464` assigns every mode `reflex` ownership, so even non-safety work outranks a player action.
- `src/agent/modes.js:604-617` polls independent modes instead of enforcing one explicit top-level gameplay state.
- `src/agent/runtime/job-director.js:531-540` reloads any nonterminal persisted work without checking whether a companion should resume it.
- `src/agent/player-directives.js:174-218` routes ordinary gathering/build requests into persistent role jobs instead of bounded current-session companion tasks.
- `src/agent/agent.js:690` applies destructive `boundedChatText`; `src/agent/agent.js:715` then passes already-truncated content to Mineflayer, which could have split it safely.
- `src/agent/library/skills.js:4034-4088` supervises follow using position deltas but only reinstalls the same goal; it does not inspect feet/head/front/support geometry or perform a verified local escape.
- `src/agent/modes.js:236-279` runs a second global unstuck scheduler that can interrupt unrelated work and calls `moveAway` instead of repairing the owning navigation task.

## 4. Target control model

Do not add a second broad orchestration framework. Strengthen the existing `ActionManager` boundary with one small resource-lease object per action generation. The lease is gameplay cancellation machinery, not another scheduler: it cannot invent work, choose goals, or persist tasks.

### 4.1 Ownership

Use these effective lanes:

- `player`: explicit chat command or natural-language directive;
- `survival`: drowning, burning, or critical-health retreat;
- `defense`: explicit guard state or a recent hostile-attributed hit;
- `background`: non-mutating idle animation only.

Delete `reflex` as a blanket owner for every mode. Ambient world mutation is disabled, not merely assigned a lower priority.

Priority behavior:

1. player commands preempt ordinary player/background work;
2. emergency survival can interrupt player work and is the only action allowed through operator hold;
3. defense can interrupt only when explicit guard is active or there is fresh damage/threat evidence, and defense cannot bypass operator hold;
4. a fresh player command atomically releases hold before it requests ownership;
5. recovery is a subphase of the action that owns navigation, never a separate scheduler;
6. after a safety interrupt, do not auto-resume stale commands through the LLM; either resume the exact deterministic continuation owned by `ActionManager` or report interruption and wait.

### 4.2 Generation-scoped gameplay resource lease

Each action receives an `ActionContext` with:

```js
{
  actionId,
  generation,
  owner,
  signal,
  lease,
  recordEvent(type, payload),
  assertCurrent(),
}
```

The lease has one active generation and explicit adapters for `pathfinder`, `controls`, `pvp`, `digging`, and `collectBlock`. It records every acquire, goal/control mutation, cancel, cleanup, and release in a bounded monotonic event ledger. Critical gameplay code may not mutate those resources except through the current context or a plugin adapter operating under that context.

Cancellation order is mandatory:

1. abort the current `ActionContext`;
2. force only that context's leased resources toward idle;
3. await the action/plugin Promise and registered cleanup callbacks;
4. remove only listeners registered by that context;
5. publish the terminal result;
6. release the lease;
7. only then permit a successor action to acquire resources.

If cleanup does not settle within the bounded stop deadline, keep the bot held and reject successors. Never let an old generation's `finally` stop resources belonging to a new generation. Remove unconditional Pathfinder/PvP/CollectBlock cleanup from global `requestInterrupt()` and the generic `idle` handler after equivalent lease-aware cancellation is active.

### 4.3 Observable action state

Expose the actual `activeOwner`, `activeAction`, `generation`, hold status, current resource lease, and navigation/combat subphase. Friendly labels such as “following” or “recovering” are presentation-only derivations; do not create a second authoritative state vocabulary. There must never be two active movement owners.

### 4.4 Evidence vocabulary

Movement outcomes:

- `pathing`: path accepted and position has begun changing;
- `arrived`: measured final distance satisfies the requested tolerance;
- `recovering`: no progress was detected and a bounded local escape is executing;
- `stuck`: recovery/replan budget was exhausted;
- `no_path`, `target_lost`, `interrupted`, `timeout`.

Combat outcomes:

- `pursuing`: PvP target installed and either distance decreases or pathfinder has an active non-empty route;
- `attack_attempted`: `attackedTarget` fired;
- `hit`: `entityHurt(target, source)` identifies this bot; no generic health/metadata fallback may claim attribution;
- `damage_observed_unattributed`: damage occurred after an attack attempt but its source was absent/other;
- `defeated_after_bot_hit`: `entityDead` follows at least one bot-attributed hit but final damage attribution is unknown;
- `killed_by_bot`: use only when final bot attribution is explicitly available;
- `target_lost`: despawn/`entityGone` without `entityDead`;
- `blocked`, `target_lost`, `combat_timeout`, `no_combat_safe_threat`.

Collection success requires the selected block transition plus a correlated expected inventory delta after contamination sources are excluded. Placement success requires an observed server update and exact expected block state/properties at the target. Blueprint success requires a correlated update for every initially empty fixture cell plus exact final states.

## 5. Implementation sequence

### Task 0: Capture the baseline and protect the shared laboratory

**Objective:** Establish exact pre-change state and live identity without touching unrelated dirty work.

**Read/inspect:**

- `package.json`
- `profiles/local-quickstart.json`
- `profiles/defaults/_default.json`
- `src/agent/agent.js`
- `src/agent/action_manager.js`
- `src/agent/modes.js`
- `src/agent/library/skills.js`
- `src/agent/player-directives.js`
- `src/agent/runtime/job-director.js`
- `tools/verify-behavior-runtime.mjs`

**Steps:**

1. Run `git status --short` and save the baseline in the implementation notes.
2. Run `npm run check:critical` and `npm run check:behavior` before changes. Classify pre-existing failures separately.
3. Query both IPv4 and IPv6 control endpoints and identify the Windows-hosted process before live mutation.
4. Query `/api/agents`, `/api/minecraft-server?logs=0`, and `/api/local-models`; preserve actual JSON bodies with credentials redacted.
5. Confirm `MindcraftBot` is stopped before source changes/live verification.
6. Register this confirmed workstream in both project registries without altering unrelated entries:
   - `C:/Users/zerop/Development/projects-registry/projects.json`
   - `C:/Users/zerop/.pocket-project-registry/control.db`
   Verify JSON/SQLite parity after synchronization.

**Gate:** Known baseline captured; no implementation or service mutation yet.

### Task 1: Lock companion authority and eliminate unsolicited execution

**Objective:** A default companion must do nothing physical unless instructed, except bounded self-preservation and evidence-triggered defense.

**Files:**

- Modify: `src/agent/runtime/behavior-config.js`
- Inspect only initially: `profiles/defaults/_default.json`
- Modify: `profiles/local-quickstart.json`
- Modify: `src/agent/modes.js`
- Modify: `src/agent/runtime/job-director.js`
- Modify: `src/agent/player-directives.js`
- Modify: `src/agent/command-policy.js`
- Test: `tests/control-plane/behavior-config.test.js`
- Test: `tests/control-plane/job-director.test.js`
- Create: `tests/control-plane/companion-authority.test.js`

**Required behavior:**

1. Normalize `role === "companion"` to `autonomy: "command"` and jobs off when runtime is absent/sparse. Preserve recognized explicit non-companion role/autonomy configurations and add a compatibility matrix before changing shared defaults.
2. Activate the baseline first through `profiles/local-quickstart.json`; do not globally disable modes for builder/miner/lumberjack profiles. Companion-effective modes are:
   - on: `self_preservation`, `idle_staring`;
   - conditionally available but not ambient: `self_defense`;
   - off: `unstuck`, `cowardice`, `hunting`, `item_collecting`, `torch_placing`, `elbow_room`, `cheat`.
3. Remove `!setMode`, `!goal`, `!newAction`, and persistent role-assignment commands from the LLM-visible default companion command set. Keep explicit operator invocations possible only where existing command policy safely permits them.
4. A companion `JobDirector` must not auto-resume persisted work. Because the version-1 store has no session/suspension schema, normalize a loaded nonterminal order to terminal `cancelled` with evidence code `companion_restart_requires_player`, save that terminal record, assign it to `lastOrder`, and leave `activeOrder = null`. Do not invent assignment/session identity or call `save(null)`, which would erase the only stored record.
5. Repeated restarts must preserve the same terminal historical reason and never revive the order. Automatic/role-derived orders remain non-executable for a companion.
6. Replace natural-language routing to `!assignMiningJob`, `!assignHarvestJob`, `!assignStockpileJob`, and `!assignShelterJob` with bounded current-session commands. Where no safe bounded command exists, route to the model's typed command selection instead of manufacturing a profession.
7. A player message always interrupts/defer-suppresses self-prompter and job execution before the requested action is installed.

**RED tests:**

- companion with defaults has no mutating ambient mode enabled;
- stale Lumberjack order does not become `activeOrder` for a companion;
- `follow me` is never interruptible by item collection/hunting/torch/elbow-room;
- idle companion does not submit any work order across repeated scheduler ticks;
- explicit player stop leaves the bot held and no scheduler restarts movement;
- explicit player harvest/build request may run a bounded task but does not change the companion's role;
- profile matrix preserves explicit builder/miner/lumberjack behavior and handles absent, malformed, and explicit companion runtime values;
- old nonterminal job state is cancelled once, remains historical across two restarts, and never executes.

**Verification:**

```bash
node --test tests/control-plane/behavior-config.test.js \
  tests/control-plane/job-director.test.js \
  tests/control-plane/companion-authority.test.js
```

Expected: all pass; no Lumberjack/Builder/Miner order appears without a player request.

**Checkpoint:** Commit only this coherent authority slice after read-back and focused tests.

### Task 2: Add generation-scoped resource leasing to `ActionManager`

**Objective:** Guarantee one movement owner and correct preemption/cleanup semantics.

**Files:**

- Create: `src/agent/runtime/gameplay-lease.js`
- Modify: `src/agent/action_manager.js`
- Modify: `src/agent/modes.js`
- Modify: `src/agent/agent.js`
- Modify: `src/agent/library/full_state.js`
- Create: `tests/control-plane/action-ownership.test.js`
- Create: `tests/control-plane/gameplay-lease.test.js`
- Modify: `tests/control-plane/agent-state-pump.test.js`

**Required behavior:**

1. Define an explicit action-owner enum and priorities; do not let ambient modes default to `reflex`.
2. Add a monotonically increasing generation and an `AbortController`/`GameplayLease` per action. Pass the full `ActionContext` into every migrated critical operation.
3. Make the lease own all calls that mutate Pathfinder goals/movements, control states, PvP, digging, and CollectBlock for the critical companion paths.
4. On interrupt/timeout, abort the context, invoke operation-specific cancellation, await underlying Promise settlement, run registered cleanup, publish the result, then release the lease. A Promise race alone is insufficient.
5. If prior cleanup does not settle within the existing bounded stop timeout, keep the bot held and reject the new action. Do not start two actions.
6. Replace global `requestInterrupt()` resource mutation with cancellation of the current context. Remove the unconditional Pathfinder stop from the generic `idle` handler; idle may resume only after the current lease is fully released.
7. Expose `activeOwner`, `activeAction`, `actionGeneration`, leased resource/subphase, event sequence, and recent lease-event ledger in full state. Do not add a second authoritative companion-state enum.
8. Hold matrix: emergency self-preservation may bypass hold; defense/background may not; a fresh player command releases hold before acquisition.
9. Do not add another scheduler or persistent state store.

**RED tests:**

- two simultaneous player actions result in one owner, with the first interrupted before the second starts;
- a lower-priority background request cannot interrupt player work;
- survival can interrupt player work;
- stale completion from an older generation is discarded;
- stale cleanup from action A cannot stop action B; B cannot acquire until A cleanup settles;
- stop/timeout/throw each clears only owned controls/listeners exactly once;
- a never-resolving plugin operation is force-cancelled and settled before release, or successors remain blocked/held;
- every critical actuator mutation without the current lease is rejected and logged as a lease violation;
- hold × owner matrix covers player, background, defense, survival, and fresh player-command release;
- state telemetry never reports two active owners.

**Verification:**

```bash
node --test tests/control-plane/gameplay-lease.test.js \
  tests/control-plane/action-ownership.test.js \
  tests/control-plane/agent-state-pump.test.js
```

Expected: all ownership and cleanup assertions pass.

### Task 3: Build one deterministic navigation supervisor

**Objective:** Put point navigation, dynamic following, no-progress detection, local recovery, and truthful failure behind one boundary.

**Files:**

- Create: `src/agent/runtime/navigation-supervisor.js`
- Modify: `src/agent/library/skills.js`
- Modify: `src/agent/connection_handler.js` only if plugin lifecycle setup must expose the supervisor
- Create: `tests/control-plane/navigation-supervisor.test.js`
- Create: `tests/control-plane/navigation-geometry.test.js`

**Public interface:**

```js
const navigation = createNavigationSupervisor(bot, {
  clock,
  sleep,
  sampleMs: 250,
  noProgressMs: 2500,
  minProgress: 0.20,
  maxRecoveries: 2,
});

await navigation.goto({ context, goal, target, tolerance, deadlineMs });
await navigation.follow({ context, resolveTarget, distance, deadlineMs: Infinity });
await navigation.stop({ context, reason });
navigation.snapshot();
```

Return a structured result:

```js
{
  success: false,
  outcome: 'stuck',
  target,
  distance,
  progress,
  pathStatus,
  pathResetReason,
  recoveryAttempts,
  geometry,
  retryable: false,
}
```

**Path supervision:**

1. Listen to `path_update`, `path_reset`, `goal_reached`, and `path_stop` only for the current operation and tag observations with the current generation.
2. For `goto`, retain the underlying `bot.pathfinder.goto(goal)` Promise. On abort/deadline, clear the leased goal, wait for `goto()` to reject/settle and remove its listeners, then release. Do not return from a bare Promise race while `goto()` remains subscribed.
3. For dynamic follow, use `setGoal(new GoalFollow(target, distance), true)` and sample target/distance/position until interrupted, lost, or recovery budget is exhausted.
4. Classify Pathfinder events explicitly:
   - observational/replan resets: `goal_updated`, `block_updated`, `chunk_loaded`, `goal_moved`;
   - recoverable resets: `stuck`, `dig_error`, `place_error` while budget remains;
   - terminal path updates: `noPath`, `timeout` after no usable partial route;
   - normal terminal events: `goal_reached`, owned stop/abort, target loss.
   Never treat every `path_reset` as terminal.
5. Check actual target distance after `goto` resolves. A resolved Promise without acceptable final distance is failure.

**Geometry inspection:**

At each stuck decision, capture:

- bot position, velocity, yaw, and protocol `onGround`;
- feet and head cells;
- forward feet/head cells based on yaw;
- rear/left/right feet/head cells;
- support blocks below current and candidate cells;
- collision shapes and hazard classification;
- current pathfinder goal and last path status/reset reason.

Infer support from loaded collision shapes below the feet; do not trust `onGround` alone.

**Bounded local recovery:**

For each attempt, stop the current goal and clear controls first. Select the first safe candidate using deterministic geometry:

1. if the forward feet cell is a safe one-block step, the cell above that step and the bot's head trajectory are clear, and the landing top is supported, pulse forward+jump for at most 450 ms;
2. if forward feet/head are clear and supported at the current level, pulse forward without requiring a jump;
3. otherwise pulse backward for at most 450 ms;
4. otherwise strafe toward a clear supported side for at most 500 ms;
5. never dig/place during companion locomotion recovery;
6. after each pulse, clear controls and require at least 0.35 block displacement; a jump-specific success also requires positive vertical excursion and landing/elevation evidence;
7. if movement occurred, rebuild movements and replan from the new position;
8. after two failed recoveries, stop and return `stuck` with geometry evidence.

Retain the existing wooden-door activation behavior only as a bounded, lease-scoped helper until the live door fixture proves it unnecessary. Reject iron doors, clear its interval/listeners on every exit, and do not let it run outside the current navigation generation.

Do not run the global `mode:unstuck`; recovery belongs to the owning navigation operation.

**Movement profile A/B:**

Before finalizing movement constants, run the live obstacle fixture once with the current `patches/mineflayer-pathfinder+2.4.5.patch` and once with upstream-equivalent arrival tolerance/door settings in an isolated patch variant. Keep whichever produces measured progress and completion across the acceptance terrain. Do not remove the patch merely because it is suspicious; do not retain it merely because it exists.

**RED tests:**

- stationary with stone support and a body-level grass obstruction triggers recovery despite `onGround: false`;
- clear one-block ascent selects jump/forward;
- blocked front with clear rear selects reverse;
- clear side selects deterministic strafe;
- hazard/support failure rejects a candidate;
- pathfinder `stuck` triggers bounded recovery and one replan;
- observational `path_reset` reasons do not terminate a healthy operation;
- cancelled/expired `goto()` settles and returns listener counts to baseline before lease release;
- two failed recoveries return `stuck` and clear all controls;
- target loss returns `target_lost`;
- resolved `goto` outside tolerance returns failure;
- jump recovery proves vertical excursion/landing, not horizontal movement alone;
- wooden-door helper is operation-scoped and leaves no timer/listener after stop;
- listeners are removed after every outcome.

**Verification:**

```bash
node --test tests/control-plane/navigation-supervisor.test.js \
  tests/control-plane/navigation-geometry.test.js
```

Expected: all deterministic geometry/recovery branches pass with fake timers and no leaked listeners.

### Task 4: Migrate core skills to the navigation supervisor

**Objective:** Ensure every critical operation uses exactly one leased movement adapter at a time.

**Files:**

- Modify: `src/agent/library/skills.js`
- Modify: `src/agent/commands/actions.js`
- Create: `tests/control-plane/companion-navigation-skills.test.js`
- Extend: `tests/control-plane/builder-placement.test.js`

**Required changes:**

1. Replace direct `goToGoal`/ad hoc `GoalFollow` loops on these supervisor-owned paths:
   - `goToPlayer`
   - `followPlayer`
   - `goToPosition`
   - entity/item approach used by give/delivery
   - reachability positioning before placement.
2. Collection ownership decision: `mineflayer-collectblock` is the sole leased pathfinder owner for the complete selected-block operation. Do not pre-install a supervisor goal. On cancel, call `cancelTask()`, await the `collect()` Promise settlement, then restore movements before releasing the lease.
3. Combat ownership decision: `mineflayer-pvp` is the sole leased pathfinder owner while pursuing/attacking. The navigation supervisor observes progress but does not install a concurrent goal. For recovery, fully stop/settle PvP, run one supervisor-owned local escape under the same action generation, then restart PvP only after the Pathfinder goal is clear.
4. Patch `mineflayer-pvp+1.3.2` through the existing `patch-package` mechanism to remove its timeout-path `bot.removeAllListeners('path_stop')`; its own `onceWithTimeout` callback already removes itself. Add a regression proving an unrelated listener survives.
5. Keep one `safeMovements` factory, but stop globally mutating movement settings outside a leased operation.
6. Keep door handling operation-scoped as defined in Task 3.
7. Update `bot.lastActionEvidence` and the lease ledger at subphase transitions (`pathing`, `recovering`, terminal outcome) without presenting a subphase as completion.
8. `followPlayer` remains active until stop, target loss, or bounded failure. It must not claim success merely because `setGoal` was called.
9. `!stop` must interrupt follow within two seconds in normal runtime and leave no goal/control states.

**RED tests:**

- follow uses one navigation operation and cannot coexist with collection movement;
- CollectBlock is the only pathfinder mutator during collection, and cancellation settles before release;
- PvP and navigation supervisor never own a goal concurrently; recovery proves sequential handoff;
- forced PvP stop leaves unrelated `path_stop` listeners intact;
- stop clears a dynamic follow goal;
- go-to verifies final distance;
- collect failure preserves navigation's `stuck` evidence;
- placement approach does not break unrelated obstructions;
- movement consumers do not each install independent stuck loops.

**Verification:**

```bash
node --test tests/control-plane/companion-navigation-skills.test.js \
  tests/control-plane/builder-placement.test.js
```

### Task 5: Make combat defensive, bounded, and evidence-based

**Objective:** Combat status must reflect pursuit, actual attack attempts, verified hits, and verified terminal outcomes.

**Files:**

- Modify: `src/agent/modes.js`
- Modify: `src/agent/library/skills.js`
- Modify: `src/agent/commands/actions.js`
- Modify: `src/agent/agent.js`
- Create: `tests/control-plane/companion-combat.test.js`

**Required behavior:**

1. Remove pre-action `say(agent, "Fighting …")`.
2. Do not require `world.isClearPath` before starting requested defense. Obstructed geometry must be allowed to enter navigation and return a real blocked result.
3. Autonomous defense triggers only when:
   - an explicit `!guardPlayer`/defense action owns the bot; or
   - the bot received recent damage and a combat-safe hostile is attributable/near enough to be the threat.
4. Merely seeing a hostile does not interrupt following in normal companion mode.
5. Instrument combat operation-scoped listeners:
   - `startedAttacking` → pursuit candidate only;
   - `attackedTarget` → attack attempt;
   - `entityHurt(target, source)` → confirmed hit when source is the bot on installed 1.20+ protocol;
   - target metadata/health change with missing/other source → `damage_observed_unattributed`, never a bot hit;
   - `entityDead` → death; `entityGone`/despawn without a prior dead event → `target_lost`.
6. Announce “Fighting …” only after a confirmed attack attempt plus movement/pursuit evidence; announce “Hit …” only after bot-attributed damage; say `defeated_after_bot_hit` rather than “killed by me” when final attribution is unavailable.
7. On `stuck`, `no_path`, or combat timeout, settle PvP through its leased adapter, then say exactly that the bot could not reach/finish the threat.
8. Remove only operation-owned listeners and settle/stop PvP on every exit.

**RED tests:**

- no hostile → no narration and `no_combat_safe_threat`;
- hostile detected but action ownership denied → no “Fighting” narration;
- `startedAttacking` without movement/hit → pursuing, not fighting/success;
- `attackedTarget` without hurt → attempted, not hit;
- attributed `entityHurt` → hit evidence;
- another player/mob damaging immediately after the bot's attempt → unattributed, not hit;
- target `entityDead` after confirmed hit → `defeated_after_bot_hit` unless final source is attributable;
- target disappearance without `entityDead` → `target_lost`;
- target death without a confirmed hit → `target_died_unattributed`, not success;
- obstructed hostile invokes navigation recovery and eventually blocked/stuck truthfully;
- combat timeout stops PvP and clears listeners.

**Verification:**

```bash
node --test tests/control-plane/companion-combat.test.js
```

### Task 6: Make collection and building bounded requested tasks

**Objective:** Requested gather/build commands produce verified world changes without persistent role identity or autonomous resumption.

**Files:**

- Modify: `src/agent/player-directives.js`
- Modify: `src/agent/commands/actions.js`
- Modify: `src/agent/library/skills.js`
- Modify: `src/agent/runtime/builder-plan.js` only where its existing blueprint contract is reused
- Modify: `tests/control-plane/builder-plan.test.js`
- Modify: `tests/control-plane/builder-placement.test.js`
- Create: `tests/control-plane/companion-collection.test.js`
- Create: `tests/control-plane/companion-blueprint.test.js`

**Collection contract:**

1. Validate requested block/resource family before installing an action. `grass_block` must never be accepted as a log.
2. Snapshot exact inventory slots/counts, selected block coordinate/type, and matching nearby item entities before digging.
3. Give the leased CollectBlock adapter sole movement ownership for the selected block; do not pre-route with the navigation supervisor.
4. Equip through the existing tool helper/`mineflayer-tool` path used by CollectBlock.
5. Correlate selected block transition with pickup/inventory evidence where protocol events permit it; clear/exclude pre-existing matching drops and prohibit player/container transfers in the live fixture window.
6. Require expected inventory delta after the selected block changed. A broken block without pickup is partial/failure, not collection success; an uncorrelated inventory increase does not pass live acceptance.
7. Stop at the requested bounded count or failure; do not manufacture a background quota.

**Blueprint contract:**

1. First baseline supports only an explicit 3–5-cell blueprint: ordered cells with exact relative coordinates, exact block names/properties, and carried materials. Promote a larger structure only after Gate B passes.
2. Validate all cells, material counts, dimensions, support dependencies, protected/occupied blocks, and loaded chunks before placement.
3. Choose a safe origin near the player that does not intersect either entity.
4. Topologically order cells so each placement has a valid reference face.
5. For every cell:
   - navigate into reach;
   - require destination to be replaceable and not already correct for live construction proof;
   - equip the material;
   - call survival placement (`dontCheat=true`, `replaceObstruction=false`);
   - wait for `blockUpdate` or poll boundedly;
   - require the expected block name and properties at the coordinate and record the per-cell update.
6. If any cell fails, stop and return exact completed/failed coordinates. Do not claim the structure is complete.
7. Final success requires every initially empty/replaceable blueprint cell to have a correlated placement update, exact final state/properties, and material consumption consistent with newly placed cells.

**Initial live blueprint:** a supplied-material 3–5-cell fixture with exact cells/properties recorded in JSON. The larger 3×3/U-wall structure is a follow-on gate after this exact placement baseline passes. Do not begin with an arbitrary “house.”

**RED tests:**

- invalid resource family rejected before action installation;
- block broken but inventory unchanged is not success;
- mixed expected drop family counts correctly;
- unrelated/pre-existing pickup cannot satisfy the selected-block collection assertion;
- occupied strict blueprint cell aborts without breaking it;
- missing material fails preflight before world mutation;
- unsupported ordering is rejected or topologically corrected;
- each placed cell is observed in world state;
- pre-existing correct cells cannot count as this run's construction;
- partial structure reports exact completed/remaining cells;
- no build continues after player stop.

**Verification:**

```bash
node --test tests/control-plane/companion-collection.test.js \
  tests/control-plane/companion-blueprint.test.js \
  tests/control-plane/builder-plan.test.js \
  tests/control-plane/builder-placement.test.js
```

### Task 7: Make dialogue complete and downstream of evidence

**Objective:** Preserve full messages and eliminate optimistic action narration.

**Files:**

- Modify: `src/agent/agent.js`
- Modify: `src/agent/player-directives.js`
- Create: `tests/control-plane/chat-delivery.test.js`
- Create: `tests/control-plane/action-narration.test.js`

**Required behavior:**

1. Remove destructive 240-character `boundedChatText` from the in-game and server-output path.
2. Strip internal `!command` syntax from every dialogue payload before translation/delivery. Reject or neutralize a leading `/` in ordinary speech. Then pass the complete normalized string to `bot.chat` or `bot.whisper`; rely on the installed Mineflayer splitter.
3. Keep the existing delivery queue/rate limiter between logical messages. Do not independently split text and then double-split it.
4. Preserve the complete logical message in dashboard output. If dashboard storage needs a display bound, label it as display truncation and preserve the full source elsewhere; do not alter the game-bound text.
5. Directive acknowledgment must not say an action is underway before ownership is acquired. Use neutral receipt text (`“Got it.”`) or wait for the action's first verified progress event.
6. Terminal narration comes from `ActionResult`, not from generated promises:
   - succeeded → verified completion text;
   - blocked/failed → exact reason;
   - interrupted → stopped/interrupted;
   - requested → pending verification, never completed.
7. Ensure long command syntax is never exposed to in-game chat and is never split as a server command.

**RED tests:**

- a message longer than 240 characters reaches `bot.chat` intact;
- whisper path reaches `bot.whisper` intact;
- dashboard receives the full logical message;
- translation failure sends original full text;
- long dialogue containing internal command syntax never exposes that syntax, and ordinary leading `/` text cannot execute a server command;
- direct follow order does not say “following” before ownership/progress;
- failed combat never emits fighting/defeated success text;
- chat queue preserves message order.

**Verification:**

```bash
node --test tests/control-plane/chat-delivery.test.js \
  tests/control-plane/action-narration.test.js
```

### Task 8: Extend the live verifier around user-facing gameplay

**Objective:** Make live gameplay—not dashboard health or bot self-report—the release gate.

**Files:**

- Modify: `tests/runtime/behavior-runtime-cases.json`
- Modify: `tools/verify-behavior-runtime.mjs`
- Create: `tests/runtime/fixtures/companion-blueprint.json`
- Create: `tests/runtime/fixtures/companion-obstacle-cases.json`
- Create: `tests/runtime/fixtures/companion-cases.schema.json`
- Modify: `package.json` only to add a focused verification script if needed
- Create evidence under: `.hermes/verification/companion-baseline/`

**Independent oracle:**

Use the existing authorized Paper console endpoint `POST /api/minecraft-server/command` and managed-server logs as the independent world oracle. Bot telemetry is diagnostic and must be cross-checked; an `ActionResult` alone cannot pass a material assertion.

The verifier sends run-ID-tagged setup/query commands and parses their corresponding log output. Required command families include `forceload`, `fill`/`setblock`, `tp`, `clear`/`give`, `kill @e[type=item,…]`, tagged `summon`, `data get entity <bot> Pos|Inventory|Health`, `data get entity @e[tag=<run-tag>,limit=1] Health`, and `execute if block … run say <run-marker>`. Every command is one bounded authorized console line and every response is correlated to a unique run marker. Never query or mutate outside the declared fixture region.

**Executable case schema and event ledger:**

1. Add executable cases:
   - `companion-authority`
   - `follow-player`
   - `corner-recovery`
   - `collect-visible-item`
   - `defend-clear`
   - `defend-obstructed`
   - `build-blueprint`
   - `chat-complete`
   - `stop-preemption`.
2. Require `--authorized-active-world`, `--bot`, `--player`, `--fixture-origin x,y,z`, and an explicit case. The case definition includes dimension, exact relative blocks/properties, initial bot/player pose and yaw, inventory, entities/tags, tolerances, setup commands, reset commands, cleanup assertions, sample interval, repetition count, and stop point.
3. Add an append-only monotonic gameplay event ledger keyed by `runId`, `caseId`, `actionId`, `generation`, `owner`, and sequence. Record every leased pathfinder goal/movement change, control-state interval, PvP target/start/attempt/stop, CollectBlock start/stop, recovery pulse, action result, and logical chat dispatch. Preserve recent events across one-second full-state sampling so sub-second control overlaps cannot disappear between samples.
4. Record and cross-check:
   - Paper-observed bot/player positions and bot inventory/health;
   - bot-observed trajectory/velocity/target distance;
   - active action owner/generation and resource lease ledger;
   - navigation subphase/path status/reset reason and recovery geometry;
   - tagged hostile identity/health/presence and bot combat events;
   - selected block transition, matching item/pickup evidence, and slot-level inventory delta;
   - exact blueprint cell names/properties before, per-cell updates, and after;
   - structured result and ordered logical chat/chunks;
   - stale/missing/duplicated/reordered sequences and bot/server disagreements.
5. Fail immediately if:
   - unrequested job/mode mutates the world;
   - any actuator mutation lacks the current lease or two movement owners overlap;
   - bot says fighting without an attack attempt;
   - bot says completed without postcondition evidence;
   - bot remains motionless past the bounded recovery window or claims jump without positive vertical excursion/landing;
   - chat suffix is lost;
   - stop does not halt movement.
6. Evidence files contain schema version, run/case/fixture IDs and hashes, timestamps, server/bot/player identity, exact redacted commands, monotonic events, movement/combat/inventory/blueprint/chat/stop sections, cross-oracle assertions, pass/fail, and `[REDACTED]` for credentials.

No-go rule: a case cannot pass solely from `ActionResult`, bot-authored full state, dashboard output, operator impression, or an uncorrelated before/after delta.

**Live scenario setup:**

- The fixture origin is explicit and its exact before-state is recorded. Setup first clears/resets only the bounded region, removes matching item entities, provisions exact inventory, positions entities, stabilizes time/weather if needed, and verifies every setup assertion through Paper.
- The obstacle fixture records exact block coordinates/properties, initial pose/yaw, target, blocked region, escape region, and reset procedure. It reproduces the original full grass-block body obstruction with support geometry; it is mandatory, not “if possible.”
- The real player is online for the user-steered follow scenario. The verifier queries both player and bot positions from Paper while the player follows a prescribed waypoint course. A separate deterministic fixture may reposition the target between declared waypoints, but cannot replace the real walk acceptance.
- Hostiles are spawned singly with a unique run tag and fixed fixture coordinates; all competing hostiles/items are cleared from the bounded region first.
- Building targets begin empty/replaceable and the verifier supplies exact materials.
- Normal-chat completeness is verified from ordered Paper server-log chunks and reconstructed against a logical-message hash. Whisper splitting remains an installed-SDK contract test unless a receiving client oracle is added.
- Cleanup removes tagged entities/items, restores fixture blocks where safe, and asserts cleanup. A failed cleanup leaves a visible evidence failure and stops further runs.

### Task 9: Execute layered verification and stop on contradiction

**Objective:** Prove the companion baseline through three independent evidence layers.

#### Layer A: deterministic source/contract checks

Run focused tests from Tasks 1–8, then:

```bash
npm run lint
npm run check:critical
npm run check:behavior
```

Also run the existing lifecycle/managed-target focused suites that protect the retained control plane.

Pass condition: all changed-path tests and established critical/behavior gates pass. Any unrelated IPv6 fixture failure is reported separately but must be fixed if it blocks the actual live verifier endpoint.

#### Layer B: SDK-contract integration checks

1. Assert chat/whisper behavior against the installed Mineflayer implementation.
2. Exercise pathfinder event cleanup and terminal reasons with instrumented fakes.
3. Exercise PvP event sequence and 1.20+ `entityHurt(entity, source)` handling; when `source` is absent/other, require unattributed evidence rather than a hit.
4. Verify patched-versus-upstream pathfinder movement profile through the bounded A/B live fixture.
5. Verify no critical companion path mutates Pathfinder, controls, PvP, digging, or CollectBlock without the current lease. Permit `mineflayer-pvp` and CollectBlock internals only through their explicit leased adapters.
6. Force PvP stop timeout and prove unrelated `path_stop` listeners survive the package patch.
7. Force cancellation while `goto()`/CollectBlock/PvP are pending and prove their Promises/listeners settle before lease release.

Pass condition: local source matches every API assumption in this plan, and all listeners/goals/controls clean up.

#### Layer C: staged live product acceptance

Every listed fixture/profile variant must pass three consecutive reset runs. One failure fails the variant; there is no “where repeatable” exception.

**Gate A — authority and locomotion (must pass before combat/collection/build rollout):**

1. Idle companion for five minutes near drops, trees, animals, darkness, and the player. The lease ledger must show no unauthorized mutating attempt, even if it caused no visible world change.
2. Follow the real player on a prescribed course beginning outside follow tolerance: at least eight blocks horizontal travel, one one-block climb with positive vertical excursion/final elevation gain, two turns, and a wooden doorway. Paper positions and the lease ledger must agree.
3. Escape the canonical grass/tree/corner fixture: record no-progress interval, owned recovery pulse, causal displacement during the pulse, replan, and exit from the exact blocked region.
4. Deliver a >240-character normal-chat message; reconstruct ordered Paper log chunks to the exact normalized logical-message hash and suffix.
5. Issue `!stop` during follow and recovery. While the bot remains connected, require actuator quiescence within 2 seconds and no new goal/control/PvP/CollectBlock event for at least 10 seconds.

**Gate B — bounded survival interactions:**

6. Reach and collect one selected visible resource after clearing matching drops/transfers. Correlate exact block transition with slot-level inventory delta and Paper inventory query.
7. Defend against one uniquely tagged hostile in clear geometry. Correlate target ID, attack sequence, bot-attributed hurt, health change, and death/loss classification.
8. Defend against one uniquely tagged hostile behind the exact obstruction. Either sequentially stop PvP/recover/restart and hit it, or return a truthful blocked result.
9. Place/build the exact 3–5-cell supplied-material fixture. Every target starts empty, each cell has a correlated update, and Paper verifies exact final name/properties.
10. Issue `!stop` during combat, collection, and placement. Require connected actuator quiescence within 2 seconds and a 10-second resume-free hold.

**Gate C — natural-language/player experience:**

11. The real player issues several natural-language variants of follow, stop, defend, collect, and place/build. Each must select only the bounded typed action and satisfy the same Gate A/B postconditions.
12. The bot must never call itself a profession, resume a stale role, or narrate pursuit/hit/completion beyond the evidence classification.

Release pass condition:

- every Gate A/B/C variant passes three consecutive fixture resets;
- no optimistic narration contradiction occurs;
- no unsolicited mutation attempt or world mutation occurs;
- every stop case halts cleanly;
- server and bot oracles agree on material postconditions;
- event sequences are monotonic and contain no owner/lease violation;
- control-plane critical/behavior checks remain green.

Stop condition: on the first product contradiction, mark the run failed, preserve state/evidence, reproduce that exact defect, fix it with a focused regression, and rerun the full affected live scenario. Do not compensate with more dashboard work or broader machinery.

### Task 10: Final cleanup, review, and activation

**Objective:** Activate the companion baseline without deleting experimental work.

**Files:** Only files changed by prior tasks plus plan/evidence/registry updates.

**Steps:**

1. Search for remaining default routes that can start jobs, `!goal`, `!newAction`, hunting, item collection, torch placement, elbow room, or global unstuck for a companion.
2. Search for `say(...Fighting`, success text before action execution, direct critical `setGoal` calls, and chat slicing.
3. Read back every modified region and inspect `git diff --check`.
4. Run complete verification from Task 9.
5. Independently review the final diff for authority, cleanup, evidence truth, and live acceptance coverage.
6. Commit small coherent slices during implementation; do not squash or overwrite unrelated user commits. Do not activate Gate B capabilities before Gate A passes live.
7. Start only `MindcraftBot` against the already-identified Windows IPv4 control process and leave Paper/Ollama ownership unchanged.
8. Run the live acceptance suite and preserve its evidence.
9. Mark the plan complete only after live pass. Leave rejected/old plans untouched unless the user separately asks to archive them.

## 6. Expected change set

Likely new files:

- `src/agent/runtime/gameplay-lease.js`
- `src/agent/runtime/navigation-supervisor.js`
- `patches/mineflayer-pvp+1.3.2.patch`
- `tests/control-plane/companion-authority.test.js`
- `tests/control-plane/action-ownership.test.js`
- `tests/control-plane/gameplay-lease.test.js`
- `tests/control-plane/navigation-supervisor.test.js`
- `tests/control-plane/navigation-geometry.test.js`
- `tests/control-plane/companion-navigation-skills.test.js`
- `tests/control-plane/companion-combat.test.js`
- `tests/control-plane/companion-collection.test.js`
- `tests/control-plane/companion-blueprint.test.js`
- `tests/control-plane/chat-delivery.test.js`
- `tests/control-plane/action-narration.test.js`
- `tests/runtime/fixtures/companion-blueprint.json`
- `tests/runtime/fixtures/companion-obstacle-cases.json`
- `tests/runtime/fixtures/companion-cases.schema.json`

Likely modified files:

- `profiles/defaults/_default.json` only after the profile matrix proves a shared-default change is safe; initial activation is local-profile scoped
- `profiles/local-quickstart.json`
- `src/agent/runtime/behavior-config.js`
- `src/agent/action_manager.js`
- `src/agent/agent.js`
- `src/agent/modes.js`
- `src/agent/player-directives.js`
- `src/agent/command-policy.js`
- `src/agent/commands/actions.js`
- `src/agent/library/skills.js`
- `src/agent/library/full_state.js`
- `src/agent/runtime/job-director.js`
- `tools/verify-behavior-runtime.mjs`
- `tests/runtime/behavior-runtime-cases.json`
- `package.json` only if a focused script is useful.

Files/systems explicitly preserved:

- dashboard layout and control surfaces;
- managed Paper lifecycle implementation;
- provider/Ollama setup;
- bot authentication and target reconciliation;
- existing role/job implementation files as inactive experimental capability;
- prior plans and dirty work.

## 7. Risks and mitigations

1. **Pathfinder can still hang or corner on dynamic goals.**
   - Mitigation: event/deadline/position supervisor, bounded local escape, terminal failure, patched-vs-upstream live A/B.
2. **`onGround` can be inconsistent with collision reality.**
   - Mitigation: infer support from loaded blocks/collision shapes and record both values.
3. **Mineflayer PvP’s `startedAttacking` is not a hit.**
   - Mitigation: separate pursuit/attempt/hit/death evidence; require `attackedTarget` and damage/death observations.
4. **Damage source may be absent on protocol/version edge cases.**
   - Mitigation: only source-attributed damage is a bot hit; otherwise record unattributed damage and never claim the kill.
5. **Persistent jobs may contain user-valued work.**
   - Mitigation: convert version-1 nonterminal state into a preserved terminal historical record; never call `save(null)` or execute it without a fresh order.
6. **The 251k-line-equivalent skill surface has many sibling movement paths.**
   - Mitigation: migrate critical companion paths first, search all direct actuator mutations, and block release if a critical path bypasses its leased supervisor/PvP/CollectBlock adapter.
7. **Live tests can alter the user’s world.**
   - Mitigation: explicit authorization flag, bounded fixture area, supplied materials, exact before/after evidence, stop-on-first-contradiction.
8. **Control-plane green tests can mask gameplay failure.**
   - Mitigation: live product acceptance is the final gate and outranks internal health.
9. **A new controller could become more machinery.**
   - Mitigation: no new broad controller; strengthen `ActionManager` and add only one resource lease plus a locomotion-specific supervisor.
10. **Bot-authored telemetry can lie consistently with a broken action.**
   - Mitigation: cross-check all material postconditions through Paper console queries/server logs and reject self-report-only passes.
11. **PvP/CollectBlock mutate Pathfinder internally.**
   - Mitigation: make each plugin the sole leased movement adapter for its operation; require settled sequential handoff before supervisor recovery or successor acquisition.

## 8. Plan-level go/no-go criteria

Implementation may begin only if review confirms:

- the existing `ActionManager` can remain the sole ownership boundary;
- a generation-scoped lease prevents stale/global cleanup from touching a successor;
- no required Mineflayer event/API is invented;
- PvP and CollectBlock have explicit sole-owner adapters and the PvP listener-removal defect has a concrete patch/test;
- cancellation settles `goto()`/PvP/CollectBlock before lease release;
- critical movement paths can be migrated without replacing the bot backend;
- companion defaults can disable unsolicited behavior without destroying role code;
- the live verifier can independently observe every required material postcondition through Paper and reject stale/circular evidence;
- building is scoped to a deterministic exact 3–5-cell fixture before larger construction, not arbitrary LLM construction;
- the plan does not rely on passing tests as a substitute for live gameplay.

The feature is not complete until the live acceptance section passes. If Mineflayer/pathfinder fails the bounded A/B obstacle and follow trials despite the supervisor, stop and reconsider the execution backend (Botcraft/Baritone bridge) rather than adding another scheduler.

## 9. Triple-check record

This section must be updated after reviews without erasing raw review artifacts.

### Check 1 — source and SDK contract verification

Completed and source-verified against the dirty tree and installed packages. Important corrections incorporated: resource cleanup is global today; PvP and CollectBlock are hidden Pathfinder owners; PvP can remove unrelated `path_stop` listeners; bare `goto()` racing leaks active work; the job store has no suspended/session schema; combat metadata fallback is not attributable; and chat/whisper splitting is implemented locally. Remaining implementation-time empirical check: patched-versus-upstream live movement A/B.

### Check 2 — independent architecture review

Completed. Raw review: `.hermes/reviews/2026-07-29-companion-plan-architecture-raw.md`. All critical and release-blocker findings were independently checked against local source. Accepted corrections are incorporated in §§4–5 and Tasks 1–6; disposition is recorded separately. Architecture status after revision: plan-level GO; Task 1 authority/profile/persistence tests are the first implementation gate, Task 2 lease tests are the first movement-architecture gate, and live Gate A is the first activation gate.

### Check 3 — executable verification review

Completed. Raw review: `.hermes/reviews/2026-07-29-companion-plan-verification-raw.md`. The original self-report-only verifier design was rejected. Task 8 now requires a monotonic lease/event ledger plus independent Paper console/server-log oracles, exact fixtures, three consecutive reset passes, causal movement/combat/collection/build evidence, and connected 2-second stop/10-second hold checks. Verification status after revision: plan-level GO, product release remains NO-GO until live Gates A–C pass.

### Final convergence review

Completed. Raw review: `.hermes/reviews/2026-07-29-companion-plan-final-rereview.md`. Verdict: no unresolved plan-level gameplay blocker; GO to begin implementation, product release NO-GO until Paper-backed Gates A–C pass. Its request to remove registry synchronization was rejected because the active one-developer-laboratory policy explicitly requires substantial workstreams to be synchronized in both registries; registry work remains isolated from gameplay gates.

---

Plan owner: current `develop` branch and canonical dirty workspace at `/mnt/c/Users/zerop/Development/minecraft-companion`.
