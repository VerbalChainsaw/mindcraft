> **ARCHIVED 2026-08-17 — NOT CURRENT.**
> Narrative sections lifted out of `ARCHITECTURE.md`, which has a stated
> ~200 line budget and had grown to 461. Every finding here is resolved;
> they are kept because the evidence chains are worth reading, not because
> they still describe the system.
>
> Current design: `ARCHITECTURE.md` · how to work: `AGENTS.md`

# Open engine defects (all fixed)

## Open engine defects found by the harness

Found 2026-08-16 while building a typed-goal scenario. All three are real
gameplay defects; only the first is fixed.

**1. Collection route probe budget — FIXED.** The wall clock (75ms) was tighter
than the compute the probe was already allowed (120ms), so searches were cut off
before finishing. Live: "Found 12 dirt candidates, but none has a safe reachable
route (timeout:12)" with dirt two blocks away and visible, followed by a 32-block
relocation. Raised to 400ms; compute budget unchanged.

**2. A timeout is classified as unreachable — FIXED.** The skill recorded
`routeStatuses {timeout: 12}` and reported `outcome: 'unreachable'`. When every
rejection is a clock expiry the candidates are now re-probed once at 1500ms
before concluding. `noPath` is deliberately excluded: re-probing a genuine
missing route would hide the defect class this harness exists to catch.

**3. A typed goal survives death and continues from the respawn point — FIXED.**
The bot died mid-goal, respawned ~1,400 blocks away at world spawn, and the goal
carried on from there: it collected a grass_block near spawn, then tried to walk
back to the recipient across open ocean until it timed out and drowned. Nothing
re-established whether the goal was still viable from the new position. In play
this reads as: die once, and the companion sets off on a doomed cross-country
march instead of reassessing.

Resolved by DEATH_RESUME_MAX_DISPLACEMENT (128), anchored to the ~96 blocks
the goal already relocates of its own accord. Beyond that the goal settles
and says so; nearer than that it resumes as before. An unobservable anchor
never abandons the goal -- unknown distance is not "too far".


# Deliver course blocked on the world (resolved)

## The deliver course is blocked on the world, definitively

A typed-goal scenario (`!requestItemGoal("deliver","dirt",1,...)`) was built and
run five times against the follow fixture. It cannot pass there, and the reason
is now evidence rather than inference — the last run had mobs eliminated as a
variable:

```
sourcePresent : true    the dirt is demonstrably placed
mob contact   : none    peaceful difficulty held
actions       : self_preservation/skill_drowning_escape_open_water
                collectBlocksInRange/skill_unreachable
                moveAway/skill_unsafe_medium
```

The chain: collection cannot route, so the goal relocates 32 blocks
(`ACQUISITION_REGION_RELOCATION_DISTANCE`); the fixture is an island, so 32
blocks is open ocean; the bot enters an unsafe medium, starts drowning, and
self-preservation seizes the body, interrupting the collection. Repeat until
timeout.

**A typed-goal scenario needs a dry-land world — RESOLVED 2026-08-17.** The
world does not have to be authored, only generated. `deliver-item-goal` runs on
a superflat recipe (`tools/scenario-lab/fixtures/deliver-item-flat-v1`) whose
surface is y=100, which is where the existing course constants already sit, so
the course geometry is unchanged. `npm run scenario:deliver` exits 0 on HEAD:
both request forms delivered, `FollowTarget` 0 -> 1 dirt, zero safety
violations. The fixture premise is measured rather than assumed — four
dry-land probes at 40 blocks, past the 32-block relocation.

The course itself is worth keeping. It never passed and still produced four
engine defects — the route probe budget, timeout-as-unreachable, goal-survives-
death, and hostile mobs deciding scenarios — every one of which is now fixed.


