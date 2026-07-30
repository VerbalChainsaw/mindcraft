# Powerful Bot Behavior Implementation Plan

> **For Claude:** Use `${SUPERPOWERS_SKILLS_ROOT}/skills/collaboration/executing-plans/SKILL.md` to implement this plan task-by-task.

**Goal:** Build, test, and harden action-owned survival intelligence, resumable Builder/Miner/Lumberjack work, and factual natural reactions for one to ten Minecraft bots.

**Architecture:** Keep urgent `ModeController` reflexes and `ActionManager` as the physical-action authority. Add a deterministic `SurvivalDirector`, evolve role scheduling into a checkpointed `JobDirector`, and add a non-owning-by-default `ReactionDirector` fed by normalized factual events. All three expose bounded structured status through existing full-state telemetry and degrade safely when models, vision, resources, targets, or routes are unavailable.

**Tech Stack:** Node.js ES modules, Mineflayer 4.37.1, mineflayer-pathfinder, mineflayer-auto-eat, built-in `node:test`, existing atomic JSON helpers, existing MindServer/full-state telemetry.

---

## Execution constraints

- Work in `C:\Users\zerop\Development\minecraft-companion`; essential uncommitted behavior work exists only in this checkout.
- Preserve every unrelated dirty file. Do not reset, clean, reformat broadly, or create a replacement worktree.
- Do not commit, push, restart the active ten-bot world, or issue bot/world commands without explicit authorization.
- Use test-first slices. Each implementation task ends with focused tests and `git diff --check`.
- Use canonical Minecraft identifiers and structured action evidence. Never infer success from chat or logs.
- Keep the full objective active until focused, integration, controlled runtime, soak, and completion-audit gates all pass.

### Task 1: Normalize behavior policies

**Files:**
- Modify: `src/agent/runtime/behavior-config.js`
- Modify: `src/mindcraft/bot-library.js`
- Modify: `src/mindcraft/public/js/bot-library.js`
- Test: `tests/control-plane/behavior-config.test.js`
- Modify: `package.json`

**Step 1: Write failing normalization tests**

Cover:

```js
const runtime = normalizeRuntimeBehavior({
  runtime: {
    survival: {
      mode: 'full',
      eatAt: 14,
      reserveFoodPoints: 12,
      sleep: 'safe',
      shelter: 'emergency',
    },
    jobs: {
      mode: 'resumable',
      stockpileLimit: 128,
      deposit: 'leader',
    },
    reactions: {
      mode: 'natural',
      maxSpeechPerMinute: 4,
      maxGesturesPerMinute: 8,
    },
  },
});

assert.equal(runtime.survival.mode, 'full');
assert.equal(runtime.survival.eatAt, 14);
assert.equal(runtime.jobs.mode, 'resumable');
assert.equal(runtime.reactions.mode, 'natural');
assert(Object.isFrozen(runtime.survival));
```

Also prove malformed enums, negative counts, oversized text, and legacy profiles fall back to safe defaults.

**Step 2: Run the focused test and confirm RED**

Run:

```powershell
node --test tests/control-plane/behavior-config.test.js
```

Expected: FAIL because the new normalized contracts do not exist.

**Step 3: Implement bounded schemas**

Add frozen normalized sections:

```js
survival: {
  mode: 'off' | 'basic' | 'full',
  eatAt: integer 1..20,
  criticalFood: integer 0..20,
  reserveFoodPoints: integer 0..40,
  sleep: 'off' | 'safe',
  shelter: 'off' | 'seek' | 'emergency',
},
jobs: {
  mode: 'off' | 'simple' | 'resumable',
  stockpileLimit: integer 16..2304,
  deposit: 'inventory' | 'leader' | 'assigned',
},
reactions: {
  mode: 'off' | 'minimal' | 'natural',
  maxSpeechPerMinute: integer 0..12,
  maxGesturesPerMinute: integer 0..24,
},
```

Add these sections to `runtimeBehaviorToProfile()`, server catalog defaults, and browser catalog defaults without exposing secrets.

**Step 4: Run GREEN and formatting**

Run:

```powershell
node --test tests/control-plane/behavior-config.test.js
node --check src/agent/runtime/behavior-config.js
git diff --check -- src/agent/runtime/behavior-config.js src/mindcraft/bot-library.js src/mindcraft/public/js/bot-library.js tests/control-plane/behavior-config.test.js package.json
```

Expected: PASS.

### Task 2: Add shared director status and ownership helpers

**Files:**
- Create: `src/agent/runtime/behavior-director.js`
- Test: `tests/control-plane/behavior-director.test.js`

**Step 1: Write failing tests**

Test a small base contract:

```js
const director = new BehaviorDirector(agent, { name: 'survival' });
assert.equal(director.canSchedule(), true);
director.begin('eating', { name: 'bread' });
assert.equal(director.canSchedule(), false);
director.finish({ phase: 'succeeded', code: 'consumed' });
assert.equal(director.status.phase, 'succeeded');
```

Prove `canSchedule()` rejects operator hold, disconnected bot, non-idle agent, active SelfPrompter/manual ownership where relevant, and duplicate in-flight dispatch.

**Step 2: Run RED**

```powershell
node --test tests/control-plane/behavior-director.test.js
```

Expected: module-not-found failure.

**Step 3: Implement the base**

Expose:

```js
export class BehaviorDirector {
  constructor(agent, { name, manualGraceMs = 0 } = {}) {}
  canSchedule({ allowWhileBusy = false } = {}) {}
  defer(reason, durationMs) {}
  begin(code, target, evidence) {}
  finish(result) {}
  fail(code, detail, retryable) {}
  snapshot() {}
}
```

All status text is control-character-free and bounded. `begin()` synchronously acquires `inFlight`.

**Step 4: Run GREEN**

```powershell
node --test tests/control-plane/behavior-director.test.js
git diff --check -- src/agent/runtime/behavior-director.js tests/control-plane/behavior-director.test.js
```

Expected: PASS.

### Task 3: Build the pure survival intent policy

**Files:**
- Create: `src/agent/runtime/survival-policy.js`
- Test: `tests/control-plane/survival-policy.test.js`

**Step 1: Write failing intent tests**

Test priority and blockers with plain snapshots:

```js
assert.deepEqual(
  chooseSurvivalIntent({
    held: false,
    idle: true,
    health: 12,
    hunger: 8,
    recentDamage: false,
    hostiles: [],
    food: [{ name: 'bread', count: 2, foodPoints: 5 }],
    timeOfDay: 6000,
  }, policy),
  { kind: 'eat', item: 'bread', reason: 'low_hunger' },
);
```

Cover:

- hold returns `null`;
- active danger is left to urgent modes;
- critical hunger beats sleep/equipment;
- safe food selection excludes banned/unsafe items;
- scarce tactical food is reserved unless critical;
- damaged bots prefer safe regeneration posture;
- night chooses reachable safe bed before shelter;
- no food/bed/shelter returns a structured wait intent rather than invented success.

**Step 2: Run RED**

```powershell
node --test tests/control-plane/survival-policy.test.js
```

**Step 3: Implement pure selectors**

Export:

```js
export function summarizeSurvivalSituation(agent) {}
export function rankFoodCandidates(items, situation, policy) {}
export function chooseSurvivalIntent(situation, policy) {}
```

Keep Mineflayer calls out of `chooseSurvivalIntent()` so exhaustive tests remain cheap.

**Step 4: Run GREEN**

```powershell
node --test tests/control-plane/survival-policy.test.js
node --check src/agent/runtime/survival-policy.js
```

### Task 4: Make eating action-owned and verifiable

**Files:**
- Modify: `src/agent/agent.js`
- Modify: `src/agent/library/skills.js`
- Test: `tests/control-plane/survival-eating.test.js`

**Step 1: Write failing ownership tests**

Prove:

- plugin auto-eat is disabled after options are configured;
- `consume()` snapshots item count, hunger, and held item;
- successful consumption requires count decrease or hunger increase;
- the prior held tool is restored only if still present;
- interruption does not trigger restoration actions that fight Stop;
- failure evidence distinguishes missing food, consume failure, unverified consumption, and restore failure.

Use an injected fake bot and real exported skill function. Do not assert plugin internals.

**Step 2: Run RED**

```powershell
node --test tests/control-plane/survival-eating.test.js
```

**Step 3: Implement**

In agent setup:

```js
this.bot.autoEat.options = { ... };
this.bot.autoEat.disable();
```

Harden `skills.consume()` to capture:

```js
{
  beforeCount,
  afterCount,
  beforeFood,
  afterFood,
  previousHeldItem,
  restoredHeldItem,
}
```

Return `false` on interrupted or unverified consumption. Preserve the verified consumed result even if optional tool restoration fails, but attach cleanup status to evidence.

**Step 4: Run GREEN**

```powershell
node --test tests/control-plane/survival-eating.test.js
node --check src/agent/library/skills.js
node --check src/agent/agent.js
```

### Task 5: Implement and integrate `SurvivalDirector`

**Files:**
- Create: `src/agent/runtime/survival-director.js`
- Modify: `src/agent/agent.js`
- Modify: `src/agent/library/full_state.js`
- Test: `tests/control-plane/survival-director.test.js`
- Test: `tests/control-plane/agent-lifecycle.test.js`

**Step 1: Write failing scheduling tests**

Cover:

```js
const director = new SurvivalDirector(agent, deps);
director.update();
assert.equal(commands[0], '!consume("bread")');
assert.equal(director.status.phase, 'acting');
```

Prove synchronous in-flight acquisition, no scheduling during hold/manual action/urgent mode, cooldown behavior, structured missing-resource waits, command failures, and exact status projection.

Add an agent-loop order assertion:

```text
modes → survival → self-prompter → job → reactions → task
```

**Step 2: Run RED**

```powershell
node --test tests/control-plane/survival-director.test.js tests/control-plane/agent-lifecycle.test.js
```

**Step 3: Implement**

Initialize:

```js
this.survival_director = new SurvivalDirector(this);
```

Update after modes and before SelfPrompter. Dispatch only verified existing commands/skills. Project:

```js
survivalDirector: this.survival_director.snapshot()
```

into full state with bounded fields.

**Step 4: Run GREEN**

```powershell
node --test tests/control-plane/survival-director.test.js tests/control-plane/agent-lifecycle.test.js
node --check src/agent/runtime/survival-director.js
node --check src/agent/library/full_state.js
```

### Task 6: Add injury recovery, armor, bed, and shelter intents

**Files:**
- Modify: `src/agent/runtime/survival-policy.js`
- Modify: `src/agent/runtime/survival-director.js`
- Modify: `src/agent/library/skills.js`
- Create: `src/agent/runtime/emergency-shelter.js`
- Test: `tests/control-plane/survival-recovery.test.js`

**Step 1: Write failing tests**

Prove:

- recent severe damage suppresses ordinary sleep/shelter work;
- safe recovery chooses food and waits for regeneration without claiming healing;
- armor equip occurs only when the action boundary is free;
- sleep verifies bed reach, `bot.isSleeping`, and interruption;
- shelter candidate requires solid overhead, feet/head clearance, support, and no liquid/falling-block/protected hazard;
- emergency blueprint is fixed, size-bounded, has an exit, and is emitted as a work order rather than directly built.

**Step 2: Run RED**

```powershell
node --test tests/control-plane/survival-recovery.test.js
```

**Step 3: Implement minimal complete behavior**

Harden `goToBed()` with structured evidence and postconditions. Add pure shelter candidate evaluation and a fixed emergency blueprint generator. `SurvivalDirector` may submit, not execute, the work order.

**Step 4: Run GREEN**

```powershell
node --test tests/control-plane/survival-recovery.test.js
node --check src/agent/runtime/emergency-shelter.js
git diff --check -- src/agent/runtime/survival-policy.js src/agent/runtime/survival-director.js src/agent/runtime/emergency-shelter.js src/agent/library/skills.js tests/control-plane/survival-recovery.test.js
```

### Task 7: Define and persist validated work orders

**Files:**
- Create: `src/agent/runtime/work-order.js`
- Create: `src/agent/runtime/job-state-store.js`
- Modify: `src/utils/atomic-file.js`
- Test: `tests/control-plane/work-order.test.js`
- Test: `tests/control-plane/job-state-store.test.js`

**Step 1: Write failing schema tests**

Validate stable IDs, roles, kinds, requester, target coordinates, quotas, blueprint dimensions/cells, phase enum, attempts, and bounded evidence. Reject duplicate blueprint cells, noncanonical item/block names, excessive dimensions/counts, and control characters.

**Step 2: Write failing persistence tests**

Test atomic save/load, corrupt-file preservation, missing file, version mismatch, and restart reconciliation inputs. Use a temporary directory; never touch real bot data.

**Step 3: Run RED**

```powershell
node --test tests/control-plane/work-order.test.js tests/control-plane/job-state-store.test.js
```

**Step 4: Implement**

Export:

```js
normalizeWorkOrder(raw)
createWorkOrder(input)
advanceWorkOrder(order, result)
reconcileWorkOrder(order, currentSnapshot)
```

Store only one active work order per bot at `bots/<safe-name>/job-state.json` through existing atomic file conventions.

**Step 5: Run GREEN**

```powershell
node --test tests/control-plane/work-order.test.js tests/control-plane/job-state-store.test.js
```

### Task 8: Replace single-command role repetition with `JobDirector`

**Files:**
- Create: `src/agent/runtime/job-director.js`
- Modify: `src/agent/runtime/role-director.js`
- Modify: `src/agent/agent.js`
- Modify: `src/agent/library/full_state.js`
- Test: `tests/control-plane/job-director.test.js`
- Test: `tests/control-plane/agent-lifecycle.test.js`

**Step 1: Write failing phase-engine tests**

Prove:

- exactly one active work order;
- phase advances only after a changed structured result with `phase: succeeded`;
- requested/blocked/interrupted/failed results do not falsely advance;
- retryable failures enter bounded recovery;
- permanent failures end truthfully;
- restart state is revalidated;
- direct commands defer jobs for the current grace period;
- no `RoleDirector` and `JobDirector` double scheduling.

**Step 2: Run RED**

```powershell
node --test tests/control-plane/job-director.test.js tests/control-plane/agent-lifecycle.test.js
```

**Step 3: Implement**

`JobDirector` owns:

```js
submit(workOrder)
cancel(reason)
deferForManualCommand(reason)
update()
snapshot()
```

Keep `RoleDirector` as a compatibility adapter or re-export only; remove it as an independent scheduler.

**Step 4: Run GREEN**

```powershell
node --test tests/control-plane/job-director.test.js tests/control-plane/agent-lifecycle.test.js
node --check src/agent/runtime/job-director.js
```

### Task 9: Implement the Builder plan

**Files:**
- Create: `src/agent/runtime/jobs/builder-plan.js`
- Modify: `src/agent/runtime/job-director.js`
- Modify: `src/agent/library/skills.js`
- Test: `tests/control-plane/builder-plan.test.js`

**Step 1: Write failing tests**

Cover:

- autonomous idle Builder creates stockpile orders only;
- construction requires explicit validated blueprint or emergency-shelter origin;
- assess rejects protected/liquid/occupied/unsupported cells and trapped exits;
- material acquisition pauses and resumes;
- placement checkpoint advances only after exact block verification;
- interruption persists the last verified cell;
- restart audits already-correct, missing, and incorrect cells;
- completion requires zero missing/incorrect cells.

**Step 2: Run RED**

```powershell
node --test tests/control-plane/builder-plan.test.js
```

**Step 3: Implement phase reducer**

Export a pure phase function:

```js
nextBuilderStep(order, snapshot, lastResult)
```

Use existing target-scoped collection, crafting, safe movement, and verified placement. Do not bulk-place or issue unverified `/setblock`.

**Step 4: Run GREEN**

```powershell
node --test tests/control-plane/builder-plan.test.js
node --check src/agent/runtime/jobs/builder-plan.js
```

### Task 10: Implement the Miner plan

**Files:**
- Create: `src/agent/runtime/jobs/miner-plan.js`
- Modify: `src/agent/runtime/job-director.js`
- Modify: `src/agent/library/skills.js`
- Test: `tests/control-plane/miner-plan.test.js`

**Step 1: Write failing tests**

Cover canonical resource mapping, pickaxe tier, food/light reserve, inventory capacity, safe selected-block collection, falling/liquid/protected hazards, bounded quota/vein traversal, escape path requirement, and deposit/leader return.

Explicitly preserve `cobblestone → natural stone` mapping.

**Step 2: Run RED**

```powershell
node --test tests/control-plane/miner-plan.test.js
```

**Step 3: Implement phase reducer**

```js
nextMinerStep(order, snapshot, lastResult)
```

The plan may relocate through safe terrain but must not enable general route digging. Collection remains limited to selected resource coordinates.

**Step 4: Run GREEN**

```powershell
node --test tests/control-plane/miner-plan.test.js
node --check src/agent/runtime/jobs/miner-plan.js
```

### Task 11: Implement the Lumberjack plan

**Files:**
- Create: `src/agent/runtime/jobs/lumberjack-plan.js`
- Modify: `src/agent/runtime/job-director.js`
- Modify: `src/agent/library/skills.js`
- Test: `tests/control-plane/lumberjack-plan.test.js`

**Step 1: Write failing tests**

Cover canonical log-family selection, axe preparation, safe reachable trunk collection, unrelated-route block protection, unsupported-fall avoidance, optional sapling replant checks, quota, inventory limit, and return/deposit.

**Step 2: Run RED**

```powershell
node --test tests/control-plane/lumberjack-plan.test.js
```

**Step 3: Implement**

```js
nextLumberjackStep(order, snapshot, lastResult)
```

Replant only when a matching sapling, valid soil, clearance, and safe reachable position are all verified.

**Step 4: Run GREEN**

```powershell
node --test tests/control-plane/lumberjack-plan.test.js
node --check src/agent/runtime/jobs/lumberjack-plan.js
```

### Task 12: Normalize factual behavior events

**Files:**
- Create: `src/agent/runtime/behavior-event.js`
- Modify: `src/agent/agent.js`
- Modify: `src/agent/action_manager.js`
- Modify: `src/agent/runtime/survival-director.js`
- Modify: `src/agent/runtime/job-director.js`
- Test: `tests/control-plane/behavior-event.test.js`

**Step 1: Write failing event tests**

Validate:

```js
normalizeBehaviorEvent({
  type: 'job.completed',
  actor: 'Timber',
  target: { name: 'oak_log' },
  evidence: { workOrderId: '...' },
  salience: 4,
});
```

Reject unknown types, unbounded text, invalid coordinates, secrets-like raw metadata, raw Error objects, and human log prose as evidence.

**Step 2: Run RED**

```powershell
node --test tests/control-plane/behavior-event.test.js
```

**Step 3: Implement adapters**

Emit normalized events for player lifecycle, damage/death, threats, action completion, survival changes, job phases, time/weather transitions, and squad messages. Keep the event bus per agent and cleanup listeners on shutdown.

**Step 4: Run GREEN**

```powershell
node --test tests/control-plane/behavior-event.test.js
node --check src/agent/runtime/behavior-event.js
```

### Task 13: Build pure reaction policy and squad deduplication

**Files:**
- Create: `src/agent/runtime/reaction-policy.js`
- Test: `tests/control-plane/reaction-policy.test.js`

**Step 1: Write failing tests**

Cover:

- low salience returns silence;
- danger warning outranks idle observation;
- active conversation suppresses ambient speech;
- witness distance filters remote events;
- per-type cooldown and global minute budgets;
- stable squad election chooses one speaker for duplicate events;
- deterministic fallback text contains only event facts;
- personality traits affect tone selection, not factual fields;
- significant events alone request episodic memory.

**Step 2: Run RED**

```powershell
node --test tests/control-plane/reaction-policy.test.js
```

**Step 3: Implement pure policy**

Export:

```js
chooseReaction(event, context, policy)
electSquadSpeaker(event, witnesses)
renderDeterministicReaction(reaction)
shouldRememberEvent(event)
```

Use stable hashes/IDs, not randomness, for squad election and testability. Template variation may use a bounded per-agent sequence.

**Step 4: Run GREEN**

```powershell
node --test tests/control-plane/reaction-policy.test.js
```

### Task 14: Implement `ReactionDirector`

**Files:**
- Create: `src/agent/runtime/reaction-director.js`
- Modify: `src/agent/agent.js`
- Modify: `src/agent/speak.js`
- Modify: `src/agent/library/full_state.js`
- Modify: `src/models/prompter.js`
- Test: `tests/control-plane/reaction-director.test.js`
- Test: `tests/control-plane/dialogue-delivery.test.js`

**Step 1: Write failing integration tests**

Prove:

- factual events enqueue bounded reactions;
- direct conversation retains queue priority;
- model phrasing receives immutable facts and may not change them;
- invalid/model-failed output falls back deterministically;
- ambient speech never calls physical-action completion;
- gestures require idle ownership and return structured results;
- one event produces at most one elected squad speaker;
- repeated events do not flood;
- significant episodes enter memory once.

**Step 2: Run RED**

```powershell
node --test tests/control-plane/reaction-director.test.js tests/control-plane/dialogue-delivery.test.js
```

**Step 3: Implement**

Initialize and run the director last in the update loop. Add a constrained optional prompt method that returns only tone-rendered text for a supplied fact payload. Validate output for forbidden new identifiers/numbers before delivery.

**Step 4: Run GREEN**

```powershell
node --test tests/control-plane/reaction-director.test.js tests/control-plane/dialogue-delivery.test.js
node --check src/agent/runtime/reaction-director.js
node --check src/models/prompter.js
```

### Task 15: Wire telemetry, dashboard status, and package gates

**Files:**
- Modify: `src/agent/library/full_state.js`
- Modify: `src/mindcraft/public/js/agents.js`
- Modify: `src/mindcraft/public/js/director.js`
- Modify: `src/mindcraft/public/js/utils.js`
- Modify: `package.json`
- Test: `tests/control-plane/behavior-telemetry.test.js`
- Test: `tests/control-plane/consolidated-shell.test.js`

**Step 1: Write failing status tests**

Require bounded survival/job/reaction summaries with phase, code, target, retryability, work-order progress, and next eligible time. Ensure secrets, prompts, raw errors, and unbounded histories are absent.

**Step 2: Run RED**

```powershell
node --test tests/control-plane/behavior-telemetry.test.js tests/control-plane/consolidated-shell.test.js
```

**Step 3: Implement**

Add one “Behavior” summary per bot and detailed rows in Director. Do not create browser-owned behavior state; render server snapshots.

Add scripts:

```json
"test:behavior": "node --test --test-concurrency=1 tests/control-plane/behavior-*.test.js tests/control-plane/survival-*.test.js tests/control-plane/work-order.test.js tests/control-plane/job-*.test.js tests/control-plane/builder-plan.test.js tests/control-plane/miner-plan.test.js tests/control-plane/lumberjack-plan.test.js tests/control-plane/reaction-*.test.js tests/control-plane/dialogue-delivery.test.js",
"check:behavior": "npm run test:behavior && npm run lint:control-plane && node --check src/agent/agent.js"
```

Extend ESLint inputs to every new runtime module and test.

**Step 4: Run GREEN**

```powershell
npm run test:behavior
node --test tests/control-plane/consolidated-shell.test.js
git diff --check
```

### Task 16: Run focused and broad static regression gates

**Files:**
- Modify only if failures prove an in-scope regression.

**Step 1: Run behavior gate**

```powershell
npm run check:behavior
```

Expected: all behavior tests, lint, syntax, and diff formatting pass.

**Step 2: Run existing repair and lifecycle gates**

```powershell
npm run test:repair
node --test --test-concurrency=1 tests/control-plane/agent-lifecycle.test.js tests/control-plane/agent-finalization.test.js
```

**Step 3: Run the full control-plane gate**

```powershell
npm run check:control-plane
```

Expected: zero failures. Treat simulated failure logs inside passing tests as fixtures, not runtime failures.

**Step 4: Audit the diff**

```powershell
git diff --check
git status --short
```

Confirm no unrelated files were modified by formatting or tests.

### Task 17: Build a controlled runtime verifier

**Files:**
- Create: `tools/verify-behavior-runtime.mjs`
- Create: `tests/runtime/behavior-runtime-cases.json`
- Document: `.hermes/verification/2026-07-28-powerful-bot-behavior.md`

**Step 1: Write verifier dry-run tests**

The verifier must:

- target an explicit console URL and controlled agent names;
- refuse the active production-like ten-bot world unless `--authorized-active-world` is supplied;
- record preconditions, commands, action IDs, state samples, postconditions, and cleanup;
- never infer completion from chat;
- support `--dry-run`, `--case`, and bounded deadlines;
- stop created test bots and leave pre-existing bots untouched.

**Step 2: Implement and run dry-run**

```powershell
node tools/verify-behavior-runtime.mjs --dry-run
```

Expected: prints cases and mutations without connecting or issuing commands.

**Step 3: Run isolated one-bot cases after authorization**

Cases:

- hunger/eating/tool restoration;
- injury retreat/recovery;
- safe bed and no-bed blocker;
- emergency-shelter work-order creation.

Record authoritative results in the verification document.

### Task 18: Run role and restart runtime gates

**Files:**
- Update: `.hermes/verification/2026-07-28-powerful-bot-behavior.md`

After explicit runtime authorization, execute controlled cases:

1. Builder stockpiles without building.
2. Builder completes an explicit small blueprint.
3. Builder pauses for missing material, restarts, revalidates, and resumes.
4. Miner prepares a tool, gathers a quota, preserves route blocks, and returns/deposits.
5. Lumberjack prepares an axe, gathers a tree quota, optionally replants, and returns/deposits.
6. Stop interrupts every phase and remains held.
7. A manual command suppresses survival upkeep, jobs, and gestures except urgent self-preservation.

For every case, record:

```text
precondition
issued order
structured action sequence
Minecraft state postcondition
cleanup
pass/fail
```

### Task 19: Run squad reaction and ten-bot soak gates

**Files:**
- Update: `.hermes/verification/2026-07-28-powerful-bot-behavior.md`

After explicit authorization:

1. Start a controlled three-bot squad.
2. Inject witnessed success, danger, death/return, sunset, and ordinary low-salience events.
3. Verify speaker election, silence, cooldowns, factual text, and conversation priority.
4. Run ten bots for at least 30 minutes with survival, jobs, and reactions enabled.
5. Sample CPU/event rate, action overlap, full-state latency, chat rate, death loops, repeated failure loops, and work-order progress.
6. Stop only test-created bots and verify cleanup.

Pass requires:

- no duplicate reaction storm;
- no action-owner overlap;
- no uncontrolled repeated death/work loop;
- bounded telemetry and state sampling;
- no raw error or secret exposure;
- at least one verified successful end-to-end job per supported role;
- stable Stop/manual-command authority.

### Task 20: Completion audit

**Files:**
- Update: `.hermes/verification/2026-07-28-powerful-bot-behavior.md`
- Update: the three `.hermes/plans/2026-07-28-*-plan.md` records with actual evidence and `EXEC-OUT`
- Update: `.hermes/defects/mindcraft-runtime.md`
- Update: `.hermes/scratchpad.md`

Audit every completion criterion in:

```text
docs/superpowers/specs/2026-07-28-powerful-bot-behavior-design.md
```

For each criterion, cite authoritative source/tests/runtime evidence and classify it as proved, contradicted, incomplete, or missing. Do not mark the active goal complete while any required runtime gate or supported role remains unproved.

Run final gates:

```powershell
npm run check:behavior
npm run check:control-plane
npm run test:repair
git diff --check
git status --short
```

Only after all specification requirements and runtime gates are proved may the goal be marked complete.

## Operational-controls execution update — 2026-07-29

The bounded operational-control repair from `.hermes/handoffs/2026-07-28-operational-controls-audit-handoff.md` is complete:

- authoritative agent retryability and viewer availability are shared by REST and socket status;
- failed squads retry retained or missing members without releasing names early;
- Bot Library capabilities refresh after Ollama starts;
- bounded startup-stage evidence preserves sanitized stderr and does not capture stdout;
- focused contracts passed **31/31** and the startup-evidence slice passed **4/4**;
- a live Paper-down `Audit_1` failure recovered through the failed-squad path to `running`/`world_ready`, then passed stop/start/stop/remove;
- coordinated shutdown removed the owned control center, Paper, and Ollama processes, and a clean hidden source console returned on port `8080`;
- `npm run check:critical` passed **9/9** with lint, format, and syntax checks green.

Evidence is recorded in `.hermes/verification/2026-07-29-operational-controls-live.json` and `.hermes/plans/2026-07-28-operational-control-recovery-plan.md`.

Known limitation: the live Windows `POST /api/restart` replacement handoff did not become ready; explicit verified shutdown plus source-console relaunch succeeded. Keep the self-handoff route open rather than treating it as proved. This update does not waive the separate gameplay/squad-soak gates in Tasks 18–20.
