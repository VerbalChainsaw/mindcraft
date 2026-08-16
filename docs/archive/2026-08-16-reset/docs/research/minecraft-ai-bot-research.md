# Research: Successful AI-Powered Minecraft Bots

## Best-documented example: Voyager

Voyager is an open-source Minecraft agent created by researchers from NVIDIA, Caltech, UT Austin, Stanford, and ASU.

**Is it AI-powered?** Yes. Voyager uses GPT-4 as its planner and JavaScript programmer. It does not fine-tune GPT-4 or train a Minecraft-specific neural controller. Instead, it combines a large language model with Mineflayer:

```text
Minecraft world state
â†’ structured text observation
â†’ GPT-4 chooses a task and writes JavaScript
â†’ Mineflayer executes deterministic movement/gameplay
â†’ world state, errors, and results are observed
â†’ GPT-4 critiques and revises the program
â†’ successful program is saved as a reusable skill
```

### Primary sources

- [Voyager source code](https://github.com/MineDojo/Voyager)
- [Voyager paper](https://arxiv.org/abs/2305.16291)
- [Official Voyager site](https://voyager.minedojo.org/)

## Evidence that Voyager worked

In three-run research evaluations, Voyager:

- Discovered **63 unique items in 160 prompting iterations**, reported as **3.3Ã— more** than the baselines.
- Traveled **2.3Ã— farther** than the comparison agents.
- Reached wooden, stone, and iron tool milestones substantially faster.
- Was the only evaluated system to reach the diamond-tool tier, although it managed that in only **one of three trials**.
- With its learned skill library, completed each of four unseen task categories in all three trials:
  - Diamond pickaxe
  - Golden sword
  - Lava bucket
  - Compass

Voyager was successful by embodied-agent research standards, but it was not a perfectly reliable human-level Minecraft player.

## How Voyager works

### 1. The LLM operates at the strategy and program level

GPT-4 does not continuously decide whether to press forward, jump, or turn. It writes asynchronous JavaScript functions such as â€œcollect wood, craft planks, make sticks, then craft a pickaxe.â€ These programs call controlled primitives including:

- `mineBlock`
- `craftItem`
- `smeltItem`
- `placeItem`
- `killMob`
- `exploreUntil`

Mineflayer handles the actual Minecraft protocol, inventory operations, movement, and block interaction.

The critical separation is:

> AI decides what sequence of operations is appropriate; deterministic code controls the body.

### 2. GPT-4 receives structured state rather than raw video

The model receives text containing:

- Current task
- Biome and time
- Position
- Nearby blocks and entities
- Health and hunger
- Equipment
- Inventory
- Known chests
- Last generated program
- Execution errors
- Minecraft chat output
- Critique from the previous attempt

Voyager therefore sidesteps visual perception and low-level motor learning. It queries Minecraft through Mineflayer and converts the result into a compact textual observation.

### 3. It uses an automatic curriculum

A separate GPT-4 role examines the botâ€™s current equipment, inventory, environment, completed tasks, and failed tasks, then selects one achievable next objective.

It starts with simple objectives such as collecting a wood log and gradually proposes more advanced goals. Tasks are intended to be:

- Immediately achievable
- Slightly beyond the botâ€™s existing capabilities
- Novel enough to expand its knowledge
- Verifiable using available game state

This mattered substantially: replacing the curriculum with random objectives reportedly reduced unique-item discovery by **93%**.

### 4. It improves programs using execution feedback

Voyager runs the generated program and returns the results to GPT-4:

```text
Program
â†’ execution
â†’ errors and resulting state
â†’ critique
â†’ revised program
```

Each task gets up to four program-generation attempts. This allows the model to correct mistakes such as:

- Missing ingredients
- Incorrect APIs
- Failure to find a block
- Wrong crafting order
- Insufficient equipment
- A program that ran without actually accomplishing the task

This is more effective than asking an LLM to create a complete long-term Minecraft plan in one response.

### 5. It uses a critic to decide whether the physical task succeeded

A second GPT-4 role receives the post-action state and decides whether the task was accomplished. If not, it returns a critique for the next attempt.

For example:

```text
Task: Craft a wooden pickaxe
Inventory: crafting table, planks, sticks
Result: Failure
Critique: You have the ingredients but did not actually craft the pickaxe.
```

Voyager only adds a generated program to its permanent skill library after the critic declares success.

There is an important limitation: the verifier itself is an LLM and can make mistakes. The paper acknowledges incorrect success judgments. A production bot should use deterministic world-state predicates wherever possible.

### 6. It accumulates an executable skill library

Every successful JavaScript program is:

1. Given an LLM-generated description.
2. Stored on disk.
3. Embedded into a Chroma vector database.
4. Retrieved when semantically relevant to a future task.

For a new objective, Voyager retrieves the top five relevant skills and includes their source code in the prompt. More complicated skills can call earlier skills, producing compositional growth:

```text
collect logs
â†’ craft planks
â†’ craft sticks
â†’ craft pickaxe
â†’ mine stone
â†’ craft stone tools
â†’ acquire iron
```

This is Voyagerâ€™s form of learning. It is in-context, code-based learning rather than neural-network weight training.

## Second project: Mindcraft

Mindcraft is particularly relevant because it is a companion-style Minecraft bot rather than only an autonomous research agent.

### Primary sources

- [Mindcraft repository](https://github.com/mindcraft-bots/mindcraft)
- [MineCollab/Mindcraft paper](https://arxiv.org/abs/2504.17950)

Mindcraft is also AI-powered. It connects configurable LLMsâ€”including hosted models and local Ollama modelsâ€”to Mineflayer. Its architecture includes:

- Natural-language conversation
- LLM selection of explicit commands
- Deterministic gameplay skills
- Mineflayer Pathfinder for navigation
- Conversation and summarized memory
- Optional LLM-generated JavaScript
- An action manager for interruption, timeout, cancellation, and resumable actions
- Multiple cooperating bots
- Optional vision and speech models

A typical interaction is:

```text
Player: Bring me four oak logs.
LLM: chooses !collectBlock("oak_log", 4)
Command layer: validates and dispatches it
Deterministic skill: searches, navigates, equips a tool, mines, and collects
Action manager: controls ownership, interruption, and timeout
Result: returned to the LLM as structured action output
```

Mindcraftâ€™s published results are more sobering than Voyagerâ€™s. Its MineCollab benchmark contains crafting, cooking, and construction tasks. It demonstrates successful runs, but the paper also reports that contemporary models struggle with complex construction and multi-agent coordination. Even Claude 3.5 Sonnet placed less than approximately 40% of the required blocks in its harder construction evaluation.

Mindcraft is therefore a functioning AI-bot platform, but not evidence that LLMs can reliably solve arbitrary Minecraft work.

## Transferable lessons

1. **Do not use the LLM as the body.**
   Use it for intent interpretation, task selection, decomposition, and recovery decisions. Keep movement, mining, crafting, following, and combat deterministic.

2. **Route language into a bounded command vocabulary first.**
   Known gameplay should use tested skills. Generate new code only for genuinely novel work.

3. **Close the loop with live world observations.**
   Every action needs to return inventory changes, positions, nearby objects, errors, interruption status, and physical outcomes.

4. **Judge completion from Minecraft state.**
   Prefer checks such as inventory counts, block coordinates, entity state, and measured distanceâ€”not an LLM saying â€œthat looks successful.â€

5. **Persist proven procedures, not conversations alone.**
   A reusable executable skill is much more valuable than another paragraph in chat history.

6. **Make actions interruptible and centrally owned.**
   Mindcraftâ€™s action manager stops pathfinding, collection, digging, and combat before replacing an action. This prevents multiple behaviors from fighting over the bot.

7. **Use bounded retry-and-repair loops.**
   Supply the failed action, observed world state, and exact error to the model. Do not continually regenerate from scratch.

8. **Treat arbitrary code generation as dangerous.**
   Mindcraft disables it by default and warns against enabling it on public servers. Even its sandbox is described as vulnerable to prompt injection.

## Bottom line

Successful AI-powered Minecraft bots exist. The best-supported example is Voyager. Its breakthrough was not simply connecting GPT-4 to Minecraft. It built a hybrid system:

- **GPT-4:** planning, curriculum, program synthesis, and critique
- **Mineflayer:** embodiment and the game protocol
- **Deterministic primitives:** reliable physical operations
- **Execution feedback:** a correction loop
- **Skill database:** reusable learned behavior
- **World-state verification:** evidence of progress

Voyager is the stronger autonomous-learning result. Mindcraft is the stronger reference for an interactive conversational companion. The best practical architecture combines Voyagerâ€™s feedback-and-skill approach with Mindcraftâ€™s command layer and action ownership, while replacing LLM-only success judgments with deterministic physical verification wherever possible.


## Local architecture result: Hybrid Goal Recovery (2026-08-03)

The project has now reproduced the core hybrid-agent lesson locally rather than relying only on published systems.

A controlled disposable-world comparison tested whether stone-tool progression should remain a monolithic deterministic skill or be owned as a persistent typed goal over the existing deterministic body.

The monolithic path failed after about 14.9 seconds with `skill_cobblestone_route_exhausted`. It found 12 stone candidates with no safe stance, but no persistent goal owned the retryable result, so the player outcome ended without a stone pickaxe.

The hybrid path preserved Mineflayer, the deterministic skills, `BehaviorArbiter`, and `ActionManager`, but routed the compound player outcome through `GoalDirector`. It recovered by moving, reassessing, retrying collection, crafting, equipping, and verifying the resulting inventory.

The direct request completed in about 35.7 seconds. The natural-language request completed in about 29.9 seconds. Both produced and equipped a stone pickaxe from the same disposable starting state.

This result supports the same separation identified in Voyager and Mindcraft research:

> Persistent planning and recovery should operate above a deterministic body. The body does not need to be replaced merely because a one-shot skill cannot finish a compound outcome.

The project decision is **HYBRID WINS**. Keep the existing physical engine and extend persistent goal ownership one live-proven vertical slice at a time. Do not perform a wholesale rewrite.

Full record: [Hybrid Goal Recovery milestone](2026-08-03-hybrid-goal-recovery-milestone.md)
Forward implementation: [Hybrid companion forward plan](../plans/2026-08-03-hybrid-companion-forward-plan.md)
