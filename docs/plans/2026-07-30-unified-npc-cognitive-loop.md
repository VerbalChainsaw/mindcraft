# Unified NPC Cognitive Loop

Status: **current plan**

This plan supersedes the implementation sequencing in
`2026-07-29-unified-gameplay-planner-executor.md`. That earlier document remains
the historical foundation for the prerequisite planner. Its central decision
has now been implemented: `GoalDirector` uses connected-version registry facts
to derive and execute verified prerequisite steps through the existing skills.

## North star

The bot should play like a person by repeatedly turning intent into verified
world-state changes:

```text
sense -> remember -> choose goal -> plan -> act -> verify -> learn -> replan
```

This must remain one cognitive system. New gameplay capabilities extend the
same loop; they do not add independent autonomous scripts or a second brain.

## Governing architecture

| Responsibility | Existing owner |
| --- | --- |
| Human/LLM intent | conversation and typed goal routing |
| Shared situational state | perception and full-state snapshots |
| Priority and control arbitration | `BehaviorArbiter` |
| Goal lifecycle and causal reasoning | `GoalDirector` |
| Registry-derived prerequisites | `PrerequisitePlanner` |
| Exclusive, interruptible execution | `ActionManager` |
| Physical Minecraft operations | deterministic skills |
| Truthful completion | structured action and world evidence |

The LLM interprets intent, resolves ambiguity, and can reason about unfamiliar
high-level outcomes. It does not invent Minecraft mechanics or claim physical
success. Registry data, live world state, deterministic skills, and structured
evidence remain authoritative.

## The action model

Every planner-visible action should progressively converge on one contract:

```text
preconditions
predicted effects
candidate targets or methods
cost and risk
observable progress
completion condition
structured failure reason
interruption policy
```

An action does not succeed because its function returned. It succeeds only when
its predicted effect is observed. A failed prediction becomes shared memory
that changes the next decision.

## Shared operational memory

The first memory is bounded, goal-local failed-target memory:

- action kind and canonical target identity;
- exact position or entity identity when known;
- structured failure code;
- failure count and observation time;
- a bounded avoidance cooldown.

Fresh world evidence can invalidate a memory. Expired memory becomes a ranking
hint rather than a fact. Memory never overrides explicit player instructions,
safety policy, registry facts, or verified current state.

This same model will later hold successful durations, yields, route costs, and
workstation choices. Learning means ranking verified alternatives better, not
generating new game rules.

## General recovery algorithm

Recovery is part of the cognitive loop:

1. Observe progress expected for the active action.
2. If physical progress stops for a bounded interval, stop that action safely.
3. Return a structured outcome such as `path_stalled` with its exact target.
4. Record that target in the active goal's bounded operational memory.
5. Replan the unresolved goal from fresh inventory and world state.
6. Exclude or penalize the failed target during its cooldown.
7. Select another candidate, another method, or report the blocking leaf.

This is not a wood-specific, mining-specific, or movement-specific retry
script. It is the common discrepancy response for any action whose predicted
effect did not occur.

## Current implementation sequence

### Slice 1 — physical progress and failed-target memory — implemented

- Add bounded physical-progress monitoring to navigation.
- Emit `path_stalled` without converting it into an operator interruption.
- Preserve the target and progress evidence through collection results.
- Store failed targets in the active `GoalDirector` contract.
- Have the existing collection adapter exclude active failed positions.
- Expose bounded memory in goal telemetry.
- Prove that an observed stalled resource target yields to another candidate
  while the original acquisition goal remains active.

Physical proof completed on Paper 1.21.11 with `MindcraftBot`:

- The player goal was submitted through the normal command/conversation route:
  acquire one `oak_log`.
- The nearest log at `(1016,100,1007)` was sealed behind bedrock.
- Navigation returned `skill_path_timeout`; `GoalDirector` persisted that exact
  target with a 90-second avoidance cooldown.
- The recovery loop executed a bounded four-block disengagement before
  replanning, preventing the bot from remaining pressed against the failed
  obstacle.
- Subsequent stalled candidates at the alternate tree were also stopped by the
  20-second physical-progress watchdog and remembered rather than retried
  indefinitely.
- The same goal remained active, eventually reached the alternate tree at
  `(1032,100,1002)`, collected one log, and completed only after inventory
  verification.

The live run exposed and repaired one Mineflayer matcher integration detail:
functional block matchers are first called with palette-only blocks that have
no world position. Position-dependent exclusion now treats that call as a
section precheck and applies exact coordinates only during the full block scan.

### Slice 2 — candidate scoring — implemented

- Collection now evaluates at most six safe observed block instances instead
  of committing to the nearest raw match.
- Each candidate receives a bounded, read-only pathfinder probe that requires
  a reachable interaction position with line of sight to the exact block.
- A pure deterministic scorer combines confirmed reachability, route cost,
  geometric distance, vertical effort, local hazards, and break time. Stable
  coordinate tie-breaks make equivalent decisions reproducible.
- Confirmed unreachable candidates are rejected before physical action;
  partial, timed-out, and failed probes remain bounded, penalized uncertainty
  rather than false proof of impossibility.
- Existing `GoalDirector` failed-target exclusions supply recent-outcome
  memory, and the selected score/rationale travels with collection evidence.

Physical proof completed on Paper 1.21.11 with `MindcraftBot`:

- A nearer oak log at `(1028,100,1028)` was completely sealed in bedrock.
- A farther oak log at `(1038,99,1032)` was exposed across open ground.
- `!collectWoodInRange(1, 16)` selected the farther target with a successful
  route score, walked to it, broke it, and verified one log in inventory.
- Server predicates confirmed the nearer sealed log remained intact and the
  farther selected log became air.
- A typed acquire goal reused the normal procedure path, dispatched
  `!collectBlocksInRange("oak_log", 1, 64)`, made the same physical choice, and
  completed only after the inventory count reached one.

The live run also rejected `GoalNear` as insufficient evidence: a sealed block
can be geometrically near while offering no interactable face. The implemented
probe uses `GoalLookAtBlock`, so reachability means the bot can stand somewhere
that can actually interact with the selected block.

### Slice 3 — world-state construction goals

- Represent structures as desired world predicates and ordered constraints.
- Derive material deficits through the existing prerequisite planner.
- Select location, access, support, enclosure, lighting, and placement order.
- Verify the built result from world state.

### Slice 4 — broader player loops

Extend the same action contract and causal loop to food, farming, combat,
exploration, equipment replacement, and dimension progression one verified
mechanic at a time.

## Slice 1 acceptance contract

- A navigation attempt that makes no meaningful physical progress terminates
  well before the existing ten-minute action timeout.
- The result contains `path_stalled`, the attempted target, elapsed stall time,
  and the last observed position.
- `GoalDirector` persists a bounded failed-target entry for the active goal.
- The next collection attempt does not immediately select that position.
- A successful alternate action clears the retry pressure and continues the
  original causal goal.
- `!stop` remains authoritative and prevents automatic restart.
- Direct commands and natural-language goals still use the same deterministic
  skill path.

## Codeplan decision for Slice 1

Candidates:

- **V1 — navigation watchdog only:** smallest change, but repeated planning can
  select the same failed target.
- **V2 — GoalDirector outcome memory plus navigation watchdog:** physical
  execution returns structured progress failure; the existing goal lifecycle
  remembers it; existing collection consults that memory.
- **V3 — new cognitive service and action schema:** potentially general, but it
  duplicates current state ownership before the existing boundaries require it.

Frozen rubric:

| Axis | Weight | V1 | V2 | V3 |
| --- | ---: | ---: | ---: | ---: |
| Architecture fit | 3 | 3 | 5 | 3 |
| Recovery correctness | 3 | 2 | 5 | 5 |
| Risk/reversibility | 2 | 5 | 4 | 2 |
| Verifiability | 2 | 4 | 4 | 3 |
| Delivery complexity | 1 | 5 | 4 | 2 |
| Normalized score |  | 0.69 | **0.91** | 0.66 |

Decision: **V2**. It is the smallest mechanism that solves both halves of the
observed failure without introducing another control loop.

```text
[codeplan · unified NPC cognitive loop · PLAN-OUT · mode: full · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.69;V2=0.91;V3=0.66 · planned-fingerprint: existing-GoalDirector+persistent-goal-memory+navigation-watchdog+zero-dependency]
```

```text
[codeplan · unified NPC cognitive loop · EXEC-OUT · mode: full · profile: compact · implemented: V2 · verification: Paper-1.21.11-live-pass · drift: bounded-disengage-added-after-observed-obstacle-trap · scope: existing-GoalDirector+collection-skills+navigation-watchdog]
```

## Verification posture

Use the real Paper server and bot for the active gameplay path. Add no broad
test framework. Focused static checks or a small diagnostic are appropriate
only where they directly prove the changed contract. Completion requires
physical evidence, not a simulated success report.

## Architecture references

- Minecraft `Brain`: sensors, shared memories, activities, and tasks:
  <https://maven.fabricmc.net/docs/yarn-1.21.4+build.8/net/minecraft/entity/ai/brain/Brain.html>
- Minecraft `GoalSelector`: prioritized goals competing for controls:
  <https://maven.fabricmc.net/docs/yarn-21w13a+build.44/net/minecraft/entity/ai/goal/GoalSelector.html>
- Mineflayer Pathfinder goals, events, stopping, and movement costs:
  <https://github.com/PrismarineJS/mineflayer-pathfinder>
