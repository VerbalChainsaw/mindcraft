## Verdict

**NO-GO.** The proposed release gates are not yet falsifiable from this repository. Task 8 requires objective before/during/after evidence, but the current verifier only recognizes `preflight` and `bot-lifecycle`, sends one `!stay(1)` command, and passes solely on three self-reported `ActionResult` fields ([plan Task 8, lines 583–628](/mnt/c/Users/zerop/Development/minecraft-companion/.hermes/plans/2026-07-29_124834-companion-gameplay-baseline.md:583); [cases, lines 1–20](/mnt/c/Users/zerop/Development/minecraft-companion/tests/runtime/behavior-runtime-cases.json:1); [verifier, lines 416–449](/mnt/c/Users/zerop/Development/minecraft-companion/tools/verify-behavior-runtime.mjs:416)). **Source-verified.**

Even after adding the named cases, the design remains circular unless evidence is independently observed: the bot that may be broken currently supplies its own position, inventory, owner, result, and narration state through `get-full-state`. The dashboard bridge merely relays and caches that state ([state pump, lines 168–207](/mnt/c/Users/zerop/Development/minecraft-companion/src/mindcraft/agent-state-pump.js:168); [full state, lines 553–648](/mnt/c/Users/zerop/Development/minecraft-companion/src/agent/library/full_state.js:553)). **Source-verified.**

## Critical False-Positive Paths

1. **Forged success is sufficient.** `matchesExpectedActionResult` accepts a case when `phase`, `code`, `label`, and timestamps match; it does not compare world state, action ID/generation, owner, command correlation, or evidence ([verifier, lines 170–178](/mnt/c/Users/zerop/Development/minecraft-companion/tools/verify-behavior-runtime.mjs:170)). A bot can remain stationary and publish the expected result. This directly defeats Task 8.4 and Layer C. **Source-verified.**

2. **Telemetry is not independent evidence.** Position, velocity, inventory, goal, and last result all originate in the bot process ([full state, lines 574–638](/mnt/c/Users/zerop/Development/minecraft-companion/src/agent/library/full_state.js:574)). A broken or dishonest action implementation can update both result and evidence consistently without producing the claimed server-side effect. **Source-verified.**

3. **Dual movement ownership can occur between samples.** State is normally sampled at one-second intervals, while Task 3 recovery pulses last only 450–500 ms ([state pump, lines 11–18](/mnt/c/Users/zerop/Development/minecraft-companion/src/mindcraft/agent-state-pump.js:11); [plan Task 3, lines 346–356](/mnt/c/Users/zerop/Development/minecraft-companion/.hermes/plans/2026-07-29_124834-companion-gameplay-baseline.md:346)). A second owner can seize controls and release them before any snapshot. **Source-verified.**

4. **The proposed owner fields do not prove physical ownership.** Task 2 proposes only one `activeOwner`, `activeAction`, and generation scalar ([plan Task 2, lines 244–266](/mnt/c/Users/zerop/Development/minecraft-companion/.hermes/plans/2026-07-29_124834-companion-gameplay-baseline.md:244)). That cannot reveal an unregistered direct `setGoal`, PvP-owned `GoalFollow`, or direct `setControlState`. Mineflayer-PvP independently installs a dynamic `GoalFollow` ([PVP.js, lines 60–74](/mnt/c/Users/zerop/Development/minecraft-companion/node_modules/mineflayer-pvp/lib/PVP.js:60)). **Source-verified.**

5. **Movement can be credited to the bot when caused externally.** Position delta alone does not distinguish walking/jumping from knockback, water flow, piston movement, teleportation, server commands, or player collision. The plan requires displacement but no causal input trace or teleport/external-force exclusion. **Source-verified for the omitted schema; assumption for listed external causes occurring in a run.**

6. **“Jump” can pass without a jump.** The design specifies ≥0.35 block displacement after a forward+jump pulse but does not require upward trajectory, a one-block elevation gain, control-state timing, or landing ([plan Task 3, lines 348–355](/mnt/c/Users/zerop/Development/minecraft-companion/.hermes/plans/2026-07-29_124834-companion-gameplay-baseline.md:348)). Horizontal movement alone satisfies that criterion. **Source-verified.**

7. **Combat death can be misattributed.** `attackedTarget` proves only that `bot.attack()` was invoked ([PVP.js, lines 191–216](/mnt/c/Users/zerop/Development/minecraft-companion/node_modules/mineflayer-pvp/lib/PVP.js:191)). `entityDead` has no source argument, and the plan permits death/removal after one prior hit to become `killed` ([plan §4.3, lines 137–143](/mnt/c/Users/zerop/Development/minecraft-companion/.hermes/plans/2026-07-29_124834-companion-gameplay-baseline.md:137)). Another player, fire, fall damage, or despawn can therefore produce a false defeat. **Source-verified for event semantics/design; assumption for a competing cause occurring.**

8. **Fallback hit evidence is non-causal.** A target health/metadata change “immediately” after `attackedTarget` can be caused by another source. The plan does not define the time window, pre/post health fields, entity identity continuity, or competing damage exclusion ([plan Task 5, lines 448–453](/mnt/c/Users/zerop/Development/minecraft-companion/.hermes/plans/2026-07-29_124834-companion-gameplay-baseline.md:448)). **Source-verified.**

9. **Inventory delta can be unrelated to gathering.** A requested item can enter inventory from an existing ground drop, player delivery, container transfer, or another mined block. Task 6 requires only an expected-family count increase, without correlating the selected block, spawned item entity, pickup event, and inventory transaction ([plan Task 6, lines 491–499](/mnt/c/Users/zerop/Development/minecraft-companion/.hermes/plans/2026-07-29_124834-companion-gameplay-baseline.md:491)). **Source-verified for missing correlation; assumption for contamination occurring.**

10. **Blueprint pre-existing cells can pass as construction.** Final success requires every cell to match and inventory to reflect consumed materials, but neither criterion proves this run placed every required cell. Correct pre-existing blocks plus unrelated material consumption can satisfy both ([plan Task 6, lines 503–517](/mnt/c/Users/zerop/Development/minecraft-companion/.hermes/plans/2026-07-29_124834-companion-gameplay-baseline.md:503)). **Source-verified.**

11. **Chat completeness can be inferred from the sender, not delivery.** Current `bot-output` capture is dashboard/process output and is truncated to 2,000 characters ([verifier, lines 389–395](/mnt/c/Users/zerop/Development/minecraft-companion/tools/verify-behavior-runtime.mjs:389)). Mineflayer splitting confirms packets were submitted, not that a real player received and reassembled every chunk. The plan’s “emitted logical messages” is therefore insufficient for Layer C ([plan Task 8, lines 609–619](/mnt/c/Users/zerop/Development/minecraft-companion/.hermes/plans/2026-07-29_124834-companion-gameplay-baseline.md:609)). **Source-verified.**

12. **Lifecycle stop can masquerade as gameplay stop.** The verifier’s existing cleanup stops the entire agent process through `stop-agent` and declares success when lifecycle state becomes inactive ([verifier, lines 303–349](/mnt/c/Users/zerop/Development/minecraft-companion/tools/verify-behavior-runtime.mjs:303)). That cannot prove `!stop` interrupts follow/recovery/combat/build while the bot remains connected and held. **Source-verified.**

## Major Coverage Gaps

- **Player authority:** The idle-five-minute scenario checks visible mutations only. It does not detect unauthorized failed attempts, transient controls, target acquisition, inventory opening, attack attempts that miss, or job claims created and cleared between samples ([plan Layer C, line 678](/mnt/c/Users/zerop/Development/minecraft-companion/.hermes/plans/2026-07-29_124834-companion-gameplay-baseline.md:678)). **Source-verified.**

- **Sole movement ownership:** No proposed invariant maps every pathfinder goal, PvP target, active control key, recovery pulse, and generation to one owner. A scalar owner label is not an ownership ledger. **Source-verified.**

- **Real displacement:** No minimum path length or required start/end separation is specified for normal follow. A case can begin inside follow tolerance and pass without movement. **Source-verified for omitted threshold; assumption that a fixture may start within tolerance.**

- **Corner recovery:** “Reproduce … if possible” provides neither canonical coordinates nor exact blocks, orientations, initial pose, target, expected escape region, nor reset procedure ([plan Task 8, lines 630–636](/mnt/c/Users/zerop/Development/minecraft-companion/.hermes/plans/2026-07-29_124834-companion-gameplay-baseline.md:630)). A simpler geometry can be substituted and pass. **Source-verified.**

- **Attack/hit/death:** Entity IDs, target UUID/type, attack sequence numbers, health observations, damage source ID, removal reason, and competing attackers are absent from required evidence. **Source-verified.**

- **Inventory deltas:** The plan does not require slot-level before/after snapshots, pickup events, expected drop quantity bounds, selected block coordinate/state transition, or exclusion of pre-existing matching drops. **Source-verified.**

- **Exact blueprint:** Material family matching can conceal wrong variants or block properties. Exact name alone is insufficient for stairs, doors, logs, slabs, beds, and directional blocks; block state/properties are not required. **Source-verified for the name-only contract at plan line 145; assumption regarding which materials the initial fixture uses.**

- **Complete chat:** The SDK splitter drops empty newline segments and divides by JavaScript string code units ([chat.js, lines 145–166](/mnt/c/Users/zerop/Development/minecraft-companion/node_modules/mineflayer/lib/plugins/chat.js:145)). Tests that only spy on `bot.chat(fullText)` prove handoff, not packet chunks, Unicode integrity, ordering at the receiving player, or suffix receipt. **Source-verified.**

- **Stop behavior:** “Within two seconds” is specified only for follow; recovery, combat, and build have no per-case deadline. “No spontaneous resume” has no observation duration or forbidden-state definition ([plan Task 4, line 410](/mnt/c/Users/zerop/Development/minecraft-companion/.hermes/plans/2026-07-29_124834-companion-gameplay-baseline.md:410); [Layer C, line 677](/mnt/c/Users/zerop/Development/minecraft-companion/.hermes/plans/2026-07-29_124834-companion-gameplay-baseline.md:677)). **Source-verified.**

- **Repeatability:** “At least three times where repeatable” permits declaring hard cases non-repeatable, and “do not rely on one lucky path” has no statistical or per-variant pass rule ([plan Layer C, lines 668–686](/mnt/c/Users/zerop/Development/minecraft-companion/.hermes/plans/2026-07-29_124834-companion-gameplay-baseline.md:668)). **Source-verified.**

- **Polling integrity:** The bridge can return cached stale state while retaining the original `_meta.sampledAt`; the verifier does not reject stale transport metadata or require monotonic samples ([state pump, lines 122–157](/mnt/c/Users/zerop/Development/minecraft-companion/src/mindcraft/agent-state-pump.js:122); [verifier, lines 428–439](/mnt/c/Users/zerop/Development/minecraft-companion/tools/verify-behavior-runtime.mjs:428)). **Source-verified.**

## Fixture/Observability Blockers

- No `tests/runtime/fixtures/companion-blueprint.json` or `companion-obstacle-cases.json` currently exists. **Source-verified.**

- The runtime case file contains none of the nine Task 8 cases and has no player-name, fixture, setup, reset, oracle, sampling, repetition, or stop-point schema ([cases](/mnt/c/Users/zerop/Development/minecraft-companion/tests/runtime/behavior-runtime-cases.json:1)). **Source-verified.**

- The verifier has `--bot` but no `--player`, despite Task 8 requiring bot/player names ([verifier, lines 14–45](/mnt/c/Users/zerop/Development/minecraft-companion/tools/verify-behavior-runtime.mjs:14); [plan Task 8, line 608](/mnt/c/Users/zerop/Development/minecraft-companion/.hermes/plans/2026-07-29_124834-companion-gameplay-baseline.md:608)). **Source-verified.**

- The repo exposes managed-server commands, but the plan does not define automatable commands for fixture clearing, block placement, hostile spawning, player positioning, inventory provisioning, time/weather stabilization, or post-run cleanup. **Source-verified for missing definitions; assumption that the operator endpoint has permission for all commands.**

- A “real player online” cannot be positioned, scripted through the course, instructed to acknowledge chat, or made repeatable by this verifier. No player-side test client or receiver telemetry exists in the inspected paths. **Source-verified.**

- The original corner and inconsistent `onGround` setup is explicitly optional (“if possible”), so it is neither reproducible nor a gate ([plan Task 8, line 636](/mnt/c/Users/zerop/Development/minecraft-companion/.hermes/plans/2026-07-29_124834-companion-gameplay-baseline.md:636)). **Source-verified.**

- Full state exposes only the current pathfinder goal, rounded velocity, inventory counts, and a reduced `ActionResult`; it does not expose owner/generation, control keys, navigation events, geometry recovery snapshots, combat events, blueprint cells, or emitted logical messages ([full state, lines 587–648](/mnt/c/Users/zerop/Development/minecraft-companion/src/agent/library/full_state.js:587); [action-result telemetry, lines 70–87](/mnt/c/Users/zerop/Development/minecraft-companion/src/agent/runtime/action-result.js:70)). **Source-verified.**

- Pathfinder events are global bot events without an operation token. `path_stop` carries no reason, `attackedTarget` carries no target, and `startedAttacking` carries no target ([pathfinder, lines 405–410](/mnt/c/Users/zerop/Development/minecraft-companion/node_modules/mineflayer-pathfinder/index.js:405); [PVP.js, lines 72–75](/mnt/c/Users/zerop/Development/minecraft-companion/node_modules/mineflayer-pvp/lib/PVP.js:72); [PVP.js, lines 210–216](/mnt/c/Users/zerop/Development/minecraft-companion/node_modules/mineflayer-pvp/lib/PVP.js:210)). Attribution must be added by the operation wrapper at event time. **Source-verified.**

## Smallest Corrections

1. Add an append-only, monotonic gameplay event stream keyed by `runId`, `caseId`, `actionId`, and `generation`; do not use periodic state snapshots as the primary oracle.

2. Add a server-side observer endpoint or command-driven oracle for bot position, entity identity/health/presence, inventory, and exact block states. Compare it with bot telemetry; fail on disagreement.

3. Instrument every movement actuator: pathfinder goal install/stop, PvP target install/stop, and control-state changes. Each event must carry owner and generation. Fail on any actuator event without the current lease.

4. Define canonical fixtures with exact dimension, coordinates, yaw, blocks and block properties, entity IDs, inventories, tolerances, setup commands, reset commands, and cleanup assertions.

5. Require actual trajectory evidence:

   - follow: initial distance above threshold, cumulative horizontal displacement, final distance;
   - climb/jump: positive vertical excursion and final elevation gain;
   - recovery: no-progress interval, recovery control pulse, ≥0.35 displacement caused during that pulse, replan, and exit from a defined blocked region.

6. Correlate combat by target entity ID and sequence: target snapshot → attack invocation → attributed hurt where available → target health decrease → death event. Without final-source attribution, report `defeated_after_bot_hit`, not `killed_by_bot`.

7. Correlate gathering: selected block coordinate/type → block transition → spawned/picked item entity where observable → expected slot delta. Clear matching drops and prohibit player/container transfers during the window.

8. For building, preflight every target cell as replaceable and not already correct, snapshot exact block state/properties, verify per-cell update, and reconcile material consumption against newly placed cells.

9. Verify chat at the receiving player/client or server log, preserving ordered chunks and reconstructing the exact normalized logical message. A sender-side `bot.chat` spy remains only an SDK-contract test.

10. Make stop a gameplay command while the process remains online. Require actuator quiescence within a fixed deadline and a resume-free hold window of at least 10 seconds for every subphase.

11. Replace “where repeatable” with an exact matrix: three consecutive passes per fixture/profile, with fixture reset and unique run IDs; any failure fails the variant.

## Required Evidence Schema

```json
{
  "schemaVersion": 1,
  "run": {
    "runId": "uuid",
    "caseId": "corner-recovery",
    "attempt": 1,
    "startedAt": 0,
    "finishedAt": 0,
    "serverIdentity": {},
    "botName": "",
    "botUuid": "",
    "playerName": "",
    "playerUuid": "",
    "fixtureId": "",
    "fixtureHash": "",
    "authorizedActiveWorld": true,
    "exactCommands": []
  },
  "fixture": {
    "dimension": "",
    "origin": {"x": 0, "y": 0, "z": 0},
    "initialBotPose": {"position": {}, "yaw": 0},
    "blocks": [{"position": {}, "name": "", "properties": {}}],
    "entities": [{"id": 0, "uuid": "", "type": "", "position": {}, "health": 0}],
    "inventory": {},
    "setupResults": [],
    "resetResults": []
  },
  "events": [{
    "seq": 1,
    "at": 0,
    "source": "bot|server|player-observer",
    "type": "",
    "runId": "",
    "actionId": "",
    "generation": 0,
    "owner": "",
    "payload": {}
  }],
  "movement": {
    "samples": [],
    "pathLength": 0,
    "startEndDisplacement": 0,
    "verticalExcursion": 0,
    "finalElevationDelta": 0,
    "targetDistances": [],
    "controlIntervals": [],
    "goalIntervals": [],
    "ownerLeaseViolations": []
  },
  "combat": {
    "targetEntityId": 0,
    "targetUuid": "",
    "attackAttempts": [],
    "hurtEvents": [],
    "healthSamples": [],
    "deathEvent": null,
    "finalDamageAttribution": "bot|other|unknown"
  },
  "inventory": {
    "beforeSlots": [],
    "afterSlots": [],
    "expectedFamily": [],
    "delta": {},
    "pickupEvents": [],
    "selectedBlock": {},
    "blockTransition": {}
  },
  "blueprint": {
    "definitionHash": "",
    "origin": {},
    "beforeCells": [],
    "blockUpdates": [],
    "afterCells": [],
    "materialDelta": {},
    "unexpectedWorldChanges": []
  },
  "chat": {
    "logicalMessageHash": "",
    "normalizedLength": 0,
    "senderChunks": [],
    "receiverChunks": [],
    "reconstructedHash": "",
    "suffixPresent": false
  },
  "stop": {
    "issuedAt": 0,
    "acknowledgedAt": 0,
    "lastActuatorEventAt": 0,
    "quiescentAt": 0,
    "deadlineMs": 2000,
    "holdObservedUntil": 0,
    "resumeEvents": []
  },
  "oracles": {
    "bot": {},
    "server": {},
    "playerObserver": {},
    "disagreements": []
  },
  "assertions": [{
    "id": "",
    "passed": false,
    "source": "bot|server|player-observer|cross-oracle",
    "evidenceSeq": []
  }],
  "passed": false,
  "failure": null
}
```

This schema is a recommended correction, not an existing contract. **Assumption/design recommendation.**

## Go/No-Go Conditions

**GO only if all are true:**

- Task 8’s nine cases exist as executable definitions, not prose.
- Required fixtures exist and have automated setup, reset, identity verification, and cleanup.
- At least one independent server/player oracle confirms every material postcondition.
- Every movement actuator is lease-instrumented, and the verifier examines the complete event stream rather than sampled scalar state.
- Follow and recovery prove causal displacement; climb variants prove vertical motion.
- Combat distinguishes attempt, attributed hit, death, disappearance, and unknown final attribution.
- Collection correlates the requested world object with the inventory delta.
- Blueprint verification checks exact coordinates and block properties and proves cells were placed during the run.
- Chat is reconstructed exactly at a receiving observer.
- `!stop` leaves the connected bot actuator-quiescent within a fixed bound and held for the defined observation window.
- Every fixture/profile variant passes three consecutive reset runs.
- Evidence rejects stale, missing, reordered, duplicated, cross-run, or self-contradictory samples.

**NO-GO if any required result is accepted solely from `ActionResult`, bot-authored telemetry, dashboard output, operator observation, optional setup, or an uncorrelated before/after delta.** Under the plan’s own §8 criterion that “the live verifier can observe every required postcondition,” implementation may not begin yet ([plan §8, lines 775–785](/mnt/c/Users/zerop/Development/minecraft-companion/.hermes/plans/2026-07-29_124834-companion-gameplay-baseline.md:775)). **Source-verified.**