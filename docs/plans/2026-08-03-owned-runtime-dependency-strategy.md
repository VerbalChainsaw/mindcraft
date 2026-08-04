# Owned Minecraft Runtime Dependency Strategy

**Date:** 2026-08-03
**Audit snapshot:** `recovery/iron-pickaxe-20260803` at `930e5d6de4c4824f5381aae5ef783196a134dae6`
**Decision:** keep the hybrid companion architecture, stop contributing changes upstream, and move the mechanics we must alter into privately maintained companion-owned packages.

**Approval status:** the Director has selected private ownership. No further upstream-versus-fork decision is pending. Destructive runtime switching remains gated on staged parity and rollback proof.

**First implementation checkpoint (2026-08-04):** `b8f17d1` added the V2-owned `mineflayer-pathfinder` package, redirected the three production imports, removed the harmful global `0.175` arrival-tolerance patch, and physically completed the additional-bucket request. Paper verified the bucket count increased from one to two. The remaining owned packages stay staged; this checkpoint does not authorize a big-bang dependency migration.

This plan replaces the generic “patch, contribute, or fork” choice in the forward plan. External projects remain useful read-only sources and compatibility references. They are not the destination for our changes.

## Outcome

Build a reproducible owned runtime layer that reduces the amount of package-lifecycle, locomotion, collection, and transaction repair inside the companion repository without creating another planner or physical executor.

The companion continues to decide:

- the durable player outcome;
- which resource, target, stance, region, or strategy to use;
- what may be dug, placed, opened, attacked, or consumed;
- safety, durability reserve, productive attempts, recovery budgets, and truthful completion;
- when a failed binding requires a different target or plan.

The owned runtime packages execute ordinary Minecraft mechanics and guarantee:

- one cancellable task per physical operation;
- one caller-supplied deadline;
- observable physical progress;
- explicit cancellation and settlement;
- consistent route planning and execution policy;
- valid cleanup of controls, listeners, cursor state, windows, digging, placement, and goals;
- typed mechanical outcomes instead of leaked timers or unresolved plugin promises.

`GoalDirector`, the prerequisite planner, the capability catalogue, and `ActionManager` remain in V2. Package ownership does not change the proven hybrid architecture.

## Audit baseline

The active checkout currently uses these patched installed packages:

| Package | Installed | Published source snapshot | Local patch |
|---|---:|---|---|
| `mineflayer` | `4.37.1` | `03eba44f3e9cb93a0f0bf69a75938246e174dc6f` | crafting transaction timing/cursor handling; placement confirmation timeout |
| `mineflayer-pathfinder` | `2.4.5` | `ca35a00ec18e7d3095280ffe2dc194e7c81b55eb` | lava, doors, trapdoors, vines, climbing, placement state, arrival tolerance, and movement changes |
| `mineflayer-collectblock` | `1.6.0` | `05eab37a47b81c5b4f26ed7168188bc89094dfe0` | pickup timeout and cancellation/settlement |
| `mineflayer-pvp` | `1.3.2` | `0b4006de03f33f901ab9005c99278cfb24bb22e0` | compiled event name correction |
| `prismarine-viewer` | `1.33.0` | `7102f49e287cab116802bc61ad03d05e2ad395db` | suppress unknown-entity constructor failure |
| `protodef` | `1.19.0` | `c5c0e595d5c56a99a038c9d2b5b480cf7de1f517` | suppress partial-packet logging |

All six are still the latest published npm versions at the audit date. A normal package update therefore does not remove any current patch.

The runtime baseline is not reproducible enough to modify safely yet:

- V2 has no `package-lock.json`, shrinkwrap, Yarn lock, or pnpm lock.
- Several physical-runtime dependencies use semver ranges, including `mineflayer-collectblock`, `mineflayer-tool`, `prismarine-item`, armor, and auto-eat.
- `node_modules` is an untracked symlink to `/mnt/c/Users/zerop/Development/minecraft-companion/node_modules`, crossing the frozen-control boundary.
- no accidental `C:` directory exists beneath the V2 root, but V2's `.git` file contains `gitdir: C:/Users/zerop/Development/minecraft-companion/.git/worktrees/minecraft-companion-brain-v2`; normal WSL Git commands therefore misresolve the worktree until that plumbing is safely repaired or an explicit WSL git-dir is used.
- `patch-package` edits the shared installed tree after installation rather than consuming an independently built V2 artifact.
- the published `mineflayer-collectblock@1.6.0` commit exists, but its repository default branch still presents `1.3.4`; blindly forking the default branch would regress the installed code.
- `mineflayer-pvp@1.3.2` pulls `mineflayer-utils@0.1.4`, which installs an obsolete second copy of `mineflayer@2.41.0` beside V2's `4.37.1`.
- the 265-line Pathfinder patch combines several independent mechanics and policies, making one change difficult to test or roll back in isolation.

Audit toolchain and physical compatibility target:

- Node `22.22.3` and npm `10.9.8` in the WSL audit shell;
- Paper `1.21.11`, protocol `774`, from the current physical evidence;
- Mineflayer `4.37.1` and `minecraft-data` `3.111.0`;
- current Java discovery must remain compatible with the managed Paper configuration.

No package, production source, runtime, process, world, or frozen-control file was modified during this audit. Only this strategy and the existing forward plan were written.

## Patch-by-patch verdict

### 1. Mineflayer core: own it

The crafting patch addresses transaction correctness inside Mineflayer's `craft` implementation. Current Mineflayer source still opens a crafting window and begins clicking without the local settle tick, and it does not return an incompatible cursor stack before selecting the next ingredient. That is mechanical transaction ownership, not companion planning.

Move into the owned Mineflayer package:

- crafting-window readiness;
- cursor-item settlement between ingredients;
- source-slot tracking;
- cancellation that closes the owned window and settles cursor/inventory state;
- a result that distinguishes missing input, rejected click, window loss, deadline, and verified recipe transfer.

Do not preserve `500ms` as a global placement-confirmation timeout. Current Mineflayer uses `5000ms`; V2's patch changes every placement to `500ms`. That is an unsafe hardcoded policy. The owned API should accept `signal`, `deadlineAt`, and an optional confirmation timeout per placement. The companion adapter supplies the remaining action time; Mineflayer owns block-update listening and cleanup.

### 2. Pathfinder: own and deliberately evolve it

This is the largest justified fork. Published Pathfinder is old, and current upstream documentation still describes climbables as unused and `canOpenDoors` as a buggy fence-gate feature. Open upstream issues still describe ordinary doors, vines, water exits, stairs, jumping, collision geometry, and placement failures. V2 has consequently accumulated package patches and orchestration compensations.

Move into the owned Pathfinder package:

- executable diagonal and raised-step geometry, including the current `guardExecutableDiagonalCorners` repair;
- normal one-block stepping and jumping from a physically valid stance;
- water-to-shore locomotion and lava escape mechanics;
- wooden door, gate, trapdoor, ladder, and vine transitions;
- route-node centering where collision geometry requires it;
- placement state cleanup, control cleanup, and confirmation;
- route progress events based on node, body, dig, place, and medium transitions;
- a cancellable navigation task whose `settled` promise proves goals, control states, digging, placement, and listeners are quiescent;
- a route-session API so the policy and route accepted during probing are the policy and route executed;
- a bounded locomotion descriptor for the current/target cell.

The locomotion descriptor replaces the overloaded `onGround` binary without becoming a general world-state framework. It should report only facts Pathfinder needs, such as:

```text
medium: ground | water | lava | air | climbable | vehicle
support: full | partial | falling | liquid | none | unloaded
feetClear / headClear
bodyCollision
stableStance
canStep / canJump / canClimb / canSwimOut
exitOrLandingCells
```

Keep in V2:

- whether lava, falls, digging, placement, parkour, doors, or block damage are authorized;
- target and stance selection;
- mining-corridor geometry and excavation budgets;
- survival reserves and hazard policy;
- whether a failure causes another target, source, region, or strategy;
- the three-to-four-second responsiveness contract and the action-level deadline.

Do not carry forward the patch's speculative `bot.world.setBlockStateId(..., 1)` mutation. The server-confirmed block update must remain authoritative. Do not keep `0.175` as an unexplained global arrival tolerance; make tolerances transition-specific and test them against collision geometry.

### 3. Collection: replace the global plugin loop with our owned atomic collector

The installed CollectBlock package owns an internal target queue, invokes Pathfinder, digs, waits for entity disappearance, and exposes a cancellation method that cannot prove the original operation has settled. V2 then patches it and adds `waitForCollectionOperationSettlement`, `cancelCollectionOperationAndSettle`, and `runBoundedCollectionOperation` to prevent stale movement from escaping `ActionManager` ownership.

The owned collector should execute one already-bound target per task:

```text
collect(target, {
  movements,
  signal,
  deadlineAt,
  pickupTimeoutMs,
  toolPolicy
}) -> {
  result,
  progress,
  cancel(),
  settled
}
```

It owns route execution, exact-target digging, drop approach, pickup observation, listener cleanup, cancellation, and settlement. It must never choose another vein, region, resource type, or recovery strategy. Those decisions stay in the capability binder and `GoalDirector`.

The current fixed three-second pickup timeout becomes a caller option bounded by the shared action deadline. `cancel()` is idempotent and `settled` cannot resolve while Pathfinder, digging, pickup listeners, or control states remain active.

Keep in V2:

- candidate discovery and ranking;
- exact target identity and failed-target propagation;
- stance, hazard, authorization, tool-durability reserve, and route policy binding;
- inventory-before/after verification;
- productive versus recovery attempt accounting.

### 4. PvP: own a cleaned package

The one-line local patch corrects stale compiled JavaScript; current source already uses `physicsTick`, but no newer npm package was published. The package also imports `TaskQueue` from `mineflayer-utils`, causing the obsolete nested Mineflayer installation.

The owned PvP package should:

- build committed runtime artifacts from the corrected source;
- remove `mineflayer-utils` and its nested Mineflayer dependency;
- use the owned Pathfinder task contract;
- make attack and stop cancellation idempotent and settled;
- remove only listeners it owns, never `removeAllListeners('path_stop')`;
- report mechanical attack, range, target-loss, cancellation, and shield-use outcomes.

Target choice, tactical stance selection, threat priority, engagement budgets, flee policy, and survival preemption stay in V2.

### 5. Prismarine Viewer: retire the package patch

The current patch changes the unknown-entity constructor from throwing to returning an incomplete object. Viewer already catches the throw and creates a magenta fallback cube. Returning an object without `mesh` bypasses that fallback and silently drops the entity.

V2 already has `adaptEntityForViewer`, which routes malformed known models through Viewer's fallback path. Keep that compatibility adapter in V2, remove the package patch after a live camera check, and do not fork the complete viewer for this behavior. If the fallback needs quieter reporting, own that behavior in the narrow V2 viewer adapter.

### 6. ProtoDef: retire the package patch and remove string-based error swallowing

`protodef@1.19.0` already has a `noErrorLogging` constructor option. `minecraft-protocol` passes its `hideErrors` option through to that parser, and Mineflayer exposes `hideErrors` at bot creation. Commenting out one logger in `node_modules` duplicates supported configuration.

The V2 `_client.emit` override also swallows any error whose message contains `PartialReadError`, without packet identity or a typed compatibility decision. Replace it with an owned Mineflayer/protocol-boundary classifier that can identify the packet and decide whether it is a verified ignorable Paper/Geyser compatibility condition. Do not fork ProtoDef unless a reproduced parse defect remains after correct versioning and configuration.

## Project code currently compensating for package behavior

The package boundary is not hypothetical. In the audit snapshot:

- `src/agent/library/skills.js` is 13,712 lines and contains 29 direct Pathfinder references, 8 CollectBlock references, 4 PvP references, 1 tool reference, and 24 direct control-state calls.
- `guardExecutableDiagonalCorners` replaces `Movements.getMoveDiagonal` at runtime. This is package geometry and moves to owned Pathfinder.
- `startNavigationProgressWatchdog`, `runNavigationAttempt`, and `stopNavigationGoal` compensate for missing progress, cancellation, and settlement contracts. Low-level task state moves to Pathfinder; V2 retains the policy that decides when silence is unacceptable and what strategy follows.
- `attemptShallowWaterExit` manually drives forward, sprint, and jump. Routine shore locomotion moves to Pathfinder. Immediate drowning ascent remains a bounded survival reflex in V2.
- `startDoorInterval` polls every 200ms and opens nearby doors after a stall; `useDoor` manually walks through the doorway. Ordinary door transitions move to Pathfinder. A player-requested explicit door interaction may remain a capability, but it must use the same package transition.
- `runBoundedCollectionOperation` and its settlement loops compensate for CollectBlock lifecycle defects. They disappear only after the owned collector proves cancellation and settlement.
- `targetScopedCollectionMovements`, safe stance binding, block authorization, and failed-target identity remain in V2; they are companion policy.
- deterministic mining-corridor planning, excavation limits, durability reserve, liquid checks, returnability, and exact ore stance remain in the capability binder. Pathfinder receives each cleared cell and owns locomotion through it.
- portal-plane contact, vehicle steering, drowning ascent, and edge sneak are legitimate bounded direct-control mechanics and remain in V2.
- `adaptEntityForViewer` remains a narrow V2 compatibility adapter.
- the PartialReadError `_client.emit` monkey patch is removed when the owned protocol boundary can classify and report the actual packet condition.

The planner-specific duplication in `prepareTool`, `prepareMaterial`, autonomous progression, and recipe prerequisites does not move into packages. It is removed through the declarative capability catalogue in the main forward plan.

## Owned package layout and source policy

Use one in-repository npm workspace suite so source, compatibility changes, V2 adapters, the lockfile, and rollback remain atomic:

```text
packages/minecraft-runtime/
  mineflayer/
  mineflayer-pathfinder/
  mineflayer-collectblock/
  mineflayer-pvp/
```

This layout is the selected implementation, not an open repository-versus-registry choice. Keep the existing runtime package names during the parity migration so current imports do not churn. Mark the workspace packages private, preserve their original MIT licenses and attribution, commit required build output, and record the imported source commit in an `UPSTREAM.md` file inside each package.

Use the exact published source snapshots as the initial bases, not current default branches and not a big-bang rewrite. External repositories are read-only intake sources. Never push, open pull requests, or publish companion changes to them.

V2 consumes these in-repository workspaces with a committed root `package-lock.json`. Do not consume mutable external branches, a sibling checkout, a private registry, or shared `node_modules`. Convert the owned packages' Mineflayer and Pathfinder relationships to compatible peer dependencies where appropriate, and use exact workspace resolution so only one Mineflayer and one Pathfinder exist in the installed graph. The containing V2 Git commit is the immutable package version and rollback anchor.

Each owned package records:

- its imported upstream commit or npm source snapshot;
- the companion changes as separate, reviewable commits by concern;
- supported Node, Mineflayer, Minecraft protocol, and Paper versions;
- build artifact checksum;
- package-level mechanical tests;
- V2 live acceptance result;
- the previous known-good V2 commit containing that package.

Do not delete the existing patch files when a fork is created. Retire each patch only after the corresponding owned package passes parity and live acceptance. The patch history is the rollback specification until then.

## Migration tranches

### Tranche 0: preserve current gameplay work

Before dependency ownership changes:

1. preserve the current source/test recovery tranche in Git at a meaningful functional checkpoint;
2. record the active branch, commit, runtime/world state, package graph, patch checksums, npm tarball integrities, and physical milestone tag;
3. do not alter the frozen control repository;
4. do not remove or replace the current `node_modules` symlink yet.

The active additional-bucket request remains an integration acceptance scenario, not a recipe-specific development project. If its next blocker is one of the package seams in this audit, the smallest coherent owned-package tranche may be used to repair that seam.

### Tranche 1: independent reproducible V2 installation

1. Stage a clean V2 install in a separate temporary directory while the current symlink remains untouched.
2. Pin every physical-runtime dependency and commit a lockfile.
3. Verify the staged tree contains one Mineflayer and one Pathfinder.
4. Apply the current patches with failure-on-mismatch and prove the staged runtime matches the current patched baseline.
5. Run startup, connection, inventory, camera, stop, and one previously verified physical action.
6. Only after parity is proven, replace the symlink through a reversible checkpoint. Do not delete the frozen control's modules.

### Tranche 2: owned-package parity

1. Import the exact four package snapshots listed above into `packages/minecraft-runtime/`.
2. Re-express each existing patch hunk as a source commit in the appropriate owned package, without redesigning behavior.
3. Commit required build artifacts and resolve V2 to the in-repository workspaces through the lockfile.
4. Prove no behavior change against the staged patched baseline.
5. Retain a one-commit dependency rollback in V2.

This tranche changes ownership only. It must not also redesign Pathfinder, collection, or crafting.

### Tranche 3: Pathfinder mechanical contract

Implement one coherent navigation-task contract, route/execute consistency, typed locomotion state, ordinary jump/step/water/door transitions, and cancellation settlement. Move the diagonal guard and other package geometry out of `skills.js`. Remove speculative world mutation and global magic tolerances.

Keep V2's target, mining, safety, authorization, and strategic recovery logic unchanged during this tranche. Prove the package in real Minecraft before deleting each compensating helper.

### Tranche 4: atomic collector contract

Replace the global CollectBlock task queue with one bound-target task and shared signal/deadline/settlement. Then remove the local collection cancellation polling and the CollectBlock patch. Candidate binding and inventory verification remain unchanged.

### Tranche 5: Mineflayer transaction contract

Move the craft cursor/window repair into owned source, add bounded transaction cancellation, and replace the global placement timeout with a caller-supplied deadline. Prove multi-ingredient crafting, workstation loss, cancellation, and placement confirmation physically.

### Tranche 6: PvP dependency cleanup

Build the corrected PvP package, remove `mineflayer-utils`, use owned Pathfinder task settlement, and prove attack/stop without overlapping navigation. Do not redesign tactical policy in this tranche.

### Tranche 7: retire peripheral patches

1. Remove the Viewer patch and prove unknown/malformed entities render via a valid fallback.
2. Remove the ProtoDef patch and configure logging through the supported boundary.
3. Replace message-based PartialReadError swallowing with typed, packet-aware handling or fix the actual protocol mismatch.
4. Confirm ordinary protocol errors remain visible and actionable.

### Tranche 8: capability catalogue integration

Expose the owned package task results through the declarative capability adapters already required by the forward plan. This is where collect, craft, place, smelt, equip, retrieve, and delivery become typed planner-visible capabilities. Do not put planner preconditions, recipes, source choice, or strategic recovery into the owned mechanics packages.

## Live acceptance matrix

Tests support these gates; they do not replace them. Add at most one focused regression for each confirmed package defect, then rerun the physical scenario.

| Boundary | Required physical acceptance |
|---|---|
| Install parity | clean isolated install; login/spawn on Paper 1.21.11; same inventory and plugin surface; no duplicate Mineflayer/Pathfinder |
| Pathfinder | flat walk; ordinary one-block ascent; raised corner; open/closed wooden door; shallow-water shore exit; exact cleared tunnel cell; cancellation during route with no later motion |
| Collector | exposed block; exact buried target after binder access; dropped item; cancellation during route, dig, and pickup; inventory delta and settled body |
| Mineflayer core | shaped multi-ingredient table recipe; cursor empty and inputs/results correct; table interruption; successful and failed placement under caller deadline |
| PvP | acquire target, attack, stop, and survival preemption; no stale goal, listener removal, or overlapping movement |
| Viewer | malformed known model and unknown entity both yield a valid fallback without crashing camera capture |
| Protocol | Paper/Geyser login and representative packets without global string-based error suppression; real incompatibilities remain visible |
| End to end | the additional bucket succeeds from a fresh comparable state; shield and bucket still succeed on unchanged capability code; operator stop settles promptly |

For every long operation, the physical result must show progress or a prompt typed failure. Repeated identical failure signatures may not consume the entire goal budget.

## Compatibility and rollback contract

- Preserve `milestone-hybrid-goal-recovery-20260803` and the current recovery branch as pre-migration anchors.
- Change one package ownership boundary per functional checkpoint after parity.
- Commit the owned package sources, build output, workspace resolution, and complete dependency lock atomically.
- Keep the previous V2 package-suite commit and lockfile diff sufficient for a one-commit rollback.
- Never combine an upstream intake, package redesign, V2 orchestration rewrite, and live gameplay repair in one checkpoint.
- Never remove a project compensation until the owned package proves the equivalent mechanic and settlement in Paper.
- Never modify or delete the frozen control's shared modules.
- Keep patch files until their replacement is physically accepted; then retire them in the same functional checkpoint that removes their postinstall dependency.
- A rollback restores package versions and orchestration together. It must not depend on reconstructing an old unpinned npm tree.

## Completion criteria

The dependency migration is complete when:

- V2 has an independent locked dependency tree;
- the frozen control is no longer V2's runtime package store;
- there is exactly one Mineflayer and one Pathfinder in the runtime graph;
- owned Mineflayer, Pathfinder, collector, and PvP sources and artifacts live under `packages/minecraft-runtime/` and are pinned by an immutable V2 commit and lockfile;
- owned packages consume the `ActionManager` signal and deadline and expose cancellation settlement;
- routine walking, jumping, water exits, doors, route execution, collection, crafting transactions, and PvP mechanics no longer require project-side package lifecycle policing;
- V2 retains strategy, safety, authorization, binding, recovery budgets, and verification;
- Viewer and ProtoDef patches are gone for evidence-backed reasons;
- the additional-bucket repeatability gate and the unchanged-code shield/bucket regression pass in Paper;
- the repository and runtime finish at a documented, reversible, clean checkpoint.

## Immediate next move

Do not start by rewriting Pathfinder or deleting patches. Preserve the current gameplay WIP, stage an independent exact-parity V2 install, and create the owned package sources from the exact published snapshots. Once parity is proven, use the additional-bucket blocker to select the first real package correction—most likely Pathfinder task/locomotion settlement or the atomic collector—then rerun the same physical request through completion.
