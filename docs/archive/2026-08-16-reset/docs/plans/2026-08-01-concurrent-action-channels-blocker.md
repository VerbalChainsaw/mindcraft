# Concurrent action channels — blocked, and on what

Status: **investigated, not implemented**

The intent was per-actuator control channels, so that actions using disjoint
parts of the body could run at the same time: eating while walking, raising a
shield while pathing, looking at whoever just spoke while working. Vanilla
Minecraft does exactly this — `Goal.Control` is `{MOVE, LOOK, JUMP, TARGET}` and
`GoalSelector` runs goals concurrently when their control sets are disjoint.

The mechanism itself is small. It is not what blocks this.

## What blocks it

The single-action lock is not only a control-arbitration device. Three separate
subsystems depend on "exactly one action is in flight" for **correctness**, and
each one silently produces wrong data the moment a second action overlaps.

### 1. Result attribution is a global slot plus a race

Nine dispatch sites share one pattern:

```js
const previousActionId = this.agent.last_action_result?.actionId || null;
void Promise.resolve(this.executeCommand(...)).then(() => {
  const result = this.agent.last_action_result;
  if (!result?.actionId || result.actionId === previousActionId) { /* failed */ }
});
```

`agenda-director.js:226`, `goal-director.js:759`, `job-director.js:894`,
`progression-director.js:179`, `reaction-director.js:237`,
`role-director.js:343`, `survival-director.js:497`, `self_prompter.js:301`, and
`agent.js:994`.

Every one reads "the newest terminal result" and assumes it is its own. That
holds only because actions are serialized. With two in flight, whichever
finishes second is attributed to whichever director reads next, and the
directors then drive retry budgets, cooldowns, and goal lifecycle from another
lane's outcome.

### 2. Skill evidence is a single slot

`setActionEvidence` (`skills.js:288`) writes `bot.lastActionEvidence`.
`_executeAction` clears it before running and reads it after
(`action_manager.js:403`, `:454`) to build the structured result. Two concurrent
skills overwrite each other's evidence, so the completion proof — the thing this
project treats as authoritative over the model — becomes whichever skill wrote
last.

### 3. Action output is a single accumulator

`log()` (`skills.js:1457`) appends to `bot.output`, and
`getBotOutputSummary()` reads **and clears** it. Concurrent actions interleave
their narration into one buffer and then steal each other's on read.

## Why this is the real answer to "why isn't it there yet"

The lock cannot be relaxed locally. Anything that runs a second action
concurrently — however narrow, however well-chosen its channels — corrupts
result attribution, completion evidence, and action output at the same time,
and does so silently. Nothing throws. The bot keeps playing and the telemetry
keeps looking plausible.

That is worse than the stall it would fix.

## What unblocking actually requires

In order, each independently valuable and verifiable:

1. **Correlate results by action, not by recency.** Dispatch returns its own
   `actionId` (or the result object) and the nine sites above stop reading a
   global. This is a pure refactor with no behaviour change, and it removes a
   latent fragility that exists today regardless of concurrency.
2. **Scope evidence and output to the action.** Both move from `bot.*` slots
   into per-action state that `_executeAction` owns, keyed by `actionId`.
3. **Then** channels: declare per-label footprints, allow a second action only
   when the sets are disjoint, keep everything undeclared claiming the whole
   body so existing behaviour is untouched.

Steps 1 and 2 are the work. Step 3 is roughly a hundred lines.

## Notes for whoever picks this up

- Labels are already a usable key: `runAsAction` builds `action:<commandName>`
  (`commands/actions.js:38`), so per-label channel declarations need no plumbing
  through `executeCommand` or the skills.
- The genuinely disjoint pair in Mineflayer is narrower than the theory
  suggests. Pathfinder steers by looking, so navigation holds LOOK as well as
  LEGS, and mining and combat hold LOOK too. The one real pair is
  navigation ∥ hands-only item use: eat, drink, equip.
- Eating while moving additionally needs live confirmation that pathfinder's
  sprint control does not cancel the item use. Design for it to fail: the
  consume skill already returns a structured `consume_blocked`, so falling back
  to today's stop-and-eat costs one wasted attempt and nothing else.
- `idle_staring` already moves the head outside `ActionManager`
  (`modes.js:604`) and `reaction_director` already speaks during player and job
  actions (`behavior-arbiter.js:441`). Both are hand-carved exceptions that a
  channel model would absorb. They are also the precedent that a channel which
  never touches the result pipeline is safe today.
