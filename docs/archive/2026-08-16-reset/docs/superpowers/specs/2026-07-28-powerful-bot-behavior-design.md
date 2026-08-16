# Powerful Bot Behavior System

Status: implemented in source; static/integration gates pass; controlled live-world gates await explicit authorization

## Goal

Build and harden three coordinated behavioral systems:

1. survival intelligence;
2. resumable role and job competence;
3. natural social and environmental presence.

“Powerful” means highly capable within legitimate Minecraft survival rules. Provisioned loadouts and cheats remain explicit operator-selected policies. Bots must never claim a physical result that Minecraft or the structured action boundary has not verified.

## Existing boundaries

- `ModeController` owns urgent reflexes and runs first in the 300 ms agent loop.
- `ActionManager` is the single physical-action owner and projects structured results.
- Direct player commands suppress autonomous role scheduling.
- `RoleDirector` starts bounded verified role commands only while the agent is idle.
- `openChat()` and the current dialogue queue own outbound speech pacing.
- Full state is the authoritative bounded snapshot for health, hunger, equipment, entities, hazards, inventory, weather, time, action, and reflex status.

The new design extends these boundaries. It does not replace them with a second command path or a global behavior-tree rewrite.

## Control order

The effective priority order is:

1. operator Stop;
2. immediate self-preservation;
3. bounded role-appropriate combat or flight reflexes;
4. explicit player command or active manual action;
5. safe survival upkeep;
6. autonomous job work;
7. social reaction or idle expression.

Operator Stop continues to admit only the existing immediate self-preservation exception. Hunger, sleep, job work, social speech, and gestures do not release or bypass a hold.

Every physical behavior must run through `ActionManager`. A lower-priority director may observe while another action runs, but it may not start a competing action. Speech may overlap only through the bounded outbound queue. A physical gesture must obey the same ownership rules as movement.

## Survival intelligence

### Responsibility

Add a `SurvivalDirector` for non-instant survival decisions. Existing modes retain drowning, fire, falling-block, severe-damage retreat, combat, and flight reactions.

The director evaluates an immutable situational snapshot and chooses at most one upkeep intent:

- eat an appropriate safe food;
- preserve an emergency food reserve when hunger is not critical;
- recover after damage by reaching safety, eating, and allowing regeneration;
- equip available armor after the current action releases the hand;
- restore the previously held tool after eating;
- sleep in a verified reachable bed when policy, time, and safety permit;
- seek a nearby verified shelter position during dangerous weather or night;
- emit an emergency-shelter work order when no safe shelter exists and the profile permits autonomous survival work;
- wait with an exact blocker when required food, bed, material, route, or safety conditions are absent.

### Eating ownership

The current auto-eat plugin may detect food and select candidates, but it must not independently mutate the held item during another action. Eating is moved behind the survival/action boundary:

1. snapshot hunger, health, selected food, inventory count, and held item;
2. ensure no operator hold or higher-priority action owns the bot;
3. consume through a verified skill;
4. confirm food consumption or hunger increase;
5. restore the held item when it still exists;
6. publish a structured survival result.

Unsafe foods remain excluded. Golden apples and other scarce tactical foods are reserved unless health is critical or policy explicitly permits ordinary use.

### Night and shelter

Sleeping and shelter are situational, not unconditional:

- do not abandon an explicit player action;
- do not path toward a bed through a known threat;
- do not repeatedly contest an occupied or unreachable bed;
- do not build arbitrary structures;
- prefer an existing nearby shelter or reachable bed;
- use a small validated emergency blueprint only through a work order;
- report why the bot stayed exposed when no safe legitimate action exists.

### State

`SurvivalDirector` keeps bounded instance state: current phase, intent, target, cooldown, last result, food reserve status, and recovery attempt count. Cooldowns reset on process restart. Long-lived facts such as an assigned home or trusted shelter remain in the existing memory/place system.

## Resumable job competence

### Work-order contract

Replace one-command role repetition with resumable work orders:

```text
workOrderId
role
kind
requester
target
constraints
blueprint or resource specification
phase
checkpoint
attempts
result
```

All text, counts, coordinates, dimensions, and item identifiers are bounded and validated. Work orders never contain credentials or raw model prompts.

### Shared phase model

Every role plan uses:

```text
assess
→ acquire
→ prepare
→ execute
→ verify
→ deliver/deposit
→ recover or complete
```

Each phase returns a structured result. A phase advances only after its postcondition is verified. Retryable failures enter bounded recovery. Permanent failures stop the work order with an exact blocker.

### Builder

- Automatically stockpile ordinary building materials within profile limits.
- Construct only an explicit validated player blueprint or a validated emergency-shelter work order.
- Validate footprint, height, replaceability, support, inventory, protected blocks, liquids, entities, and escape space before placement.
- Place in stable layers with a reachable exit.
- Verify every placed block and maintain a compact missing/incorrect-block list.
- Pause safely when materials run out and resume from the checkpoint.
- Never reinterpret “stockpile” as authorization to build.

### Miner

- Resolve requested resources to canonical blocks and suitable depth/biome knowledge.
- Validate pickaxe tier, light, food, inventory capacity, support, liquids, falling blocks, and escape route.
- Mine bounded veins or quotas through target-scoped collection.
- Stop before inventory saturation or unsafe health/hunger.
- Return to an assigned deposit or leader when configured.
- Preserve unrelated route blocks as unbreakable.

### Lumberjack

- Select a safe reachable tree and canonical log family.
- Prepare and equip an axe when possible.
- Collect the reachable trunk without excavating unrelated route blocks.
- Avoid unsupported falls and protected structures.
- Replant only when a matching sapling and valid soil/space are available.
- Return or deposit logs according to the work order.

### Squad scaling

The first implementation keeps one active work order per bot. The contract includes stable IDs and bounded checkpoints so a later squad coordinator can assign disjoint segments without changing skill semantics. No two bots may claim the same blueprint cell or resource target once distributed claims are enabled.

### Persistence

Active work-order identity, phase, and checkpoint are persisted atomically in the existing bot data boundary. On restart, the bot revalidates world state before resuming; it never assumes the previous phase completed.

## Natural social and environmental presence

### Reaction events

Add a `ReactionDirector` fed by normalized factual events:

- player joined, left, approached, returned, looked at the bot, or issued an order;
- nearby player or bot was hurt, died, escaped danger, succeeded, failed, or completed work;
- hostile appeared or cleared;
- item, structure, weather, sunrise, sunset, or meaningful terrain change was observed;
- squad order, warning, request, or completion arrived;
- this bot’s survival or job phase materially changed.

Events contain bounded identifiers, positions/distances when authoritative, timestamps, salience, witnesses, and structured evidence references. Human-readable log prose is not parsed back into events.

### Reaction policy

For each event the director chooses one outcome:

- ignore;
- look or make a small verified gesture;
- emit a short deterministic line;
- render a personality-colored line from a fixed factual payload;
- store a significant episodic memory.

Factual payloads are fixed before optional model wording. The model may change tone, vocabulary, humor, and attitude, but may not add entities, causes, outcomes, possessions, relationships, or completed actions.

### Naturalness controls

- per-event cooldowns;
- global speech and gesture budgets;
- squad deduplication so nearby bots do not all repeat the same warning;
- witness-distance checks;
- conversation priority over ambient remarks;
- stronger salience required during jobs or danger;
- varied but bounded templates when no model call is warranted;
- short-term event memory to avoid immediate repetition;
- personality and relationship traits applied only after truth selection.

Silence is a valid reaction. “Natural” does not mean constant chatter.

### Memory

Only durable, significant events become episodes: player preferences, named places, meaningful rescue or loss, completed assignments, and explicit relationship facts. Routine hunger, every mined block, every sunset, and repeated failures remain telemetry rather than long-term memory.

## Integration

The agent loop becomes conceptually:

```text
await modes.update()
survivalDirector.update()
selfPrompter.update()
jobDirector.update()
reactionDirector.update()
await checkTaskDone()
```

`SurvivalDirector` and `JobDirector` start actions only when ownership rules permit. `ReactionDirector` may enqueue speech while the bot is busy, but gestures require an idle action boundary. `SurvivalDirector` gets the first idle scheduling opportunity after urgent modes and must acquire its in-flight guard synchronously before dispatching an action. SelfPrompter retains priority over autonomous jobs, matching the current loop. `JobDirector` runs only after SelfPrompter has had its turn. `ReactionDirector` runs last and may not start a gesture after another component acquired action ownership during the tick. A newly accepted player command suppresses both directors before the next update.

The existing `RoleDirector` is evolved or wrapped into `JobDirector`; both must not independently schedule role work.

## Structured status

Full state and dashboard telemetry expose bounded director summaries:

- phase;
- code;
- target;
- evidence/detail;
- retryable;
- next eligible time;
- work-order ID and progress counts when applicable.

Status describes requested, active, verified, blocked, interrupted, or failed outcomes precisely. It does not expose private prompts, credentials, unbounded histories, or raw exception objects.

## Failure handling

- Missing state produces a truthful wait, not an optimistic action.
- Every external effect is error-wrapped and cleanup-safe.
- Interruptions are terminal for the current attempt.
- Retry budgets and cooldowns prevent tight loops.
- Restart recovery revalidates inventory, position, world blocks, targets, and assignment.
- A failed optional social reaction never fails a survival or job action.
- A model outage falls back to deterministic wording and cannot disable gameplay.
- An unavailable embedding or vision model cannot hide deterministic skills or factual state.

## Verification strategy

### Pure and focused tests

- intent selection and priority;
- food choice, reserve policy, and critical thresholds;
- work-order validation and phase transitions;
- blueprint cell claiming and checkpoint reconciliation;
- reaction salience, deduplication, cooldowns, and fact preservation;
- serialization bounds and corrupt-state recovery;
- Stop, interruption, and manual-command suppression.

### Integration tests

- only one physical action owner runs;
- auto-eat cannot steal the hand during mining, building, combat, or navigation;
- survival upkeep yields to manual commands and urgent reflexes;
- job phases advance only on structured verified results;
- restart resumes only after revalidation;
- dialogue failures do not contaminate gameplay results;
- ten agents do not create duplicate reaction storms.

### Controlled runtime gates

1. One isolated survival bot: hunger, eating, held-tool restoration, injury recovery, night, bed, and no-food blockers.
2. One bot per job role: complete representative gather/prepare/execute/verify/deliver loops.
3. Builder blueprint: interruption, material exhaustion, restart, and exact completion audit.
4. Three-bot squad: independent targets, leader proximity, warnings, and deduplicated reactions.
5. Ten-bot soak: bounded CPU/event rates, no action overlap, no chat flood, no repeated death/work loops, and stable telemetry.

Runtime tests use a controlled world and explicit operator authorization. The active player world is not used as an uncontrolled test fixture.

## Completion criteria

The system is complete only when:

- all three directors and shared contracts are implemented;
- every supported role completes its representative end-to-end work order;
- survival behavior is action-owned and verified;
- social output remains factual, bounded, and non-repetitive;
- Stop and manual commands retain authority;
- focused, integration, restart, and controlled runtime gates pass;
- the ten-bot soak shows no unbounded loop, action conflict, or reaction storm;
- documentation and telemetry describe the implemented contracts;
- no requirement is supported only by source inspection when runtime evidence is required.
