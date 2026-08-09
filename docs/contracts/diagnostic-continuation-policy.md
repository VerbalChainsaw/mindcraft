# Degraded diagnostic continuation contract

**Status:** binding for explicitly designated disposable-world diagnostic campaigns

**Relationship to the product loop:** additive exception for gathering useful
downstream evidence; it does not replace the ordinary first-material-blocker
development loop and never establishes gameplay acceptance.

## Purpose

A broad Minecraft campaign may expose an early settled failure that prevents
later independent capabilities from running. In an explicitly diagnostic run,
Codex may preserve that first failure, supply a narrowly controlled prerequisite,
and continue the original campaign to find additional candidate defects without
claiming that the end-to-end outcome passed.

The rule is:

> Stop on the first unsafe error. Preserve and, when causally safe, continue
> past a settled operational error.

## Authority and architecture

- The original natural player request and its completion predicates remain unchanged.
- `GoalDirector`, Agenda, the capability planner, `ActionManager`, BehaviorArbiter,
  Mineflayer, and Paper keep their existing ownership boundaries.
- `ActionManager` remains the only bot physical-action owner.
- Diagnostic continuation is external campaign procedure, not a new product
  director, executor, scheduler, recovery engine, or success path.
- Product code must not be weakened to ignore terminal failures merely to keep
  a diagnostic campaign moving.
- Operator Stop remains absolute.

## Failure checkpoint

Before any continuation, record:

1. the original request and campaign phase;
2. the first material blocker, structured result, and dependency it blocked;
3. bot position, dimension, health, food, inventory, equipment, and active owner;
4. relevant world effects and protected structures;
5. the exact intervention proposed for continuation.

Minecraft/Paper state is authoritative. Logs or narration alone do not prove
that an action settled or that a world effect occurred.

## Continuation eligibility

Continuation is allowed only when all of the following are true:

- movement, digging, collection, window interaction, and plugin work from the
  failed action are confirmed cancelled or settled;
- `ActionManager` ownership is released or held by the known current action;
- the world state is sufficiently known to interpret later evidence;
- the bot and nearby players are not in immediate danger;
- continuing cannot authorize new destruction or broaden the player's request;
- the proposed intervention supplies one exact missing precondition rather than
  performing the capability being investigated; and
- later work is independent of the failure or its dependency is explicitly
  identified as scaffolded.

Examples of continuable failures include a settled resource-not-found result,
a missing ingredient, bounded inventory-capacity blockage, a settled route
failure, or a failed verified construction cell.

## Mandatory stop conditions

Stop the diagnostic run immediately when:

- physical ownership or cancellation is uncertain;
- movement, digging, combat, collection, or a window/plugin call may still be alive;
- Stop or player authority was violated;
- unauthorized or unbounded world damage occurred;
- persisted goal, Agenda, job, or checkpoint state may be corrupt;
- the bot is trapped in a current hazard or unsafe health state;
- the intervention would conceal the exact mechanic under investigation; or
- accumulated interventions make later results causally uninterpretable.

## Controlled scaffolds

- Use scaffolds only in a designated disposable or explicitly authorized test world.
- Prefer exact Paper-side state preparation: supply the missing prerequisite,
  restore a known safe position, clear a test-induced hazard, or provide a
  verified reachable target.
- Never mutate the frozen control checkout or a valuable player world to make a
  diagnostic continuation convenient.
- Never store or replay arbitrary command text as durable bot work.
- Record the exact scaffold and every later result whose dependency includes it.
- Default to no more than three scaffolds in one campaign. Stop earlier when
  causality becomes ambiguous; exceed that ceiling only with Director approval.

## Evidence classification

Every observation from the run must be labeled as exactly one of:

- **Confirmed:** observed before any relevant scaffold.
- **Independent downstream defect:** observed after a scaffold but causally
  independent of it.
- **Scaffold-exposed candidate:** a plausible defect reached only because an
  earlier precondition was supplied; it requires an unassisted reproduction.
- **Blocked/not exercised:** the capability never ran.
- **Contaminated artifact:** the observation plausibly resulted from the earlier
  failure, intervention, or artificial world state.

Do not promote a candidate or contaminated artifact into a confirmed defect
merely because it appeared later in the same run.

## Repair and acceptance

1. Rank confirmed defects in causal order, starting with the earliest shared owner.
2. Repair underlying capability, package, ownership, persistence, safety, or
   verification seams—not the campaign noun or supplied scaffold.
3. Use downstream candidates to guide inspection, not to justify speculative fixes.
4. Rerun the same broad natural request without scaffolds after repairs.
5. Only the unassisted Paper-verified run may satisfy the original outcome and
   become a committed functional acceptance checkpoint.

Tests and scaffolded continuation support diagnosis. Neither substitutes for
the requested physical Minecraft result.
