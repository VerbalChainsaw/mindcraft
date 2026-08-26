# Recurring development headaches

## DevLink `git_status` cannot resolve this Windows worktree

- **State:** `RESOLVED` on 2026-08-21.
- **Observed:** 2026-08-21
- **Working surfaces:** AgentLink, RuntimeLink, SysLink, and DevLink file
  inspection all read this project successfully. Codex also operates inside the
  repository successfully.
- **Failure:** DevLink's `git_status` endpoint reports this project as “not a git
  repository.” Plain Windows Git reproduces that result because the worktree's
  `.git` file contains a WSL-style `/mnt/c/...` gitdir pointer. Supplying the
  equivalent Windows gitdir and work-tree explicitly succeeds.
- **Owner:** DevLink's cross-platform Git/worktree resolution, not Kevin runtime
  code or repository state.
- **Durable correction needed:** Resolve `.git` file pointers across Windows and
  WSL path forms before invoking Git, using the existing Git primitive rather
  than adding a project-specific wrapper.
- **Impact:** Connector Git status is unavailable or misleading for valid
  worktrees; file inspection and Kevin development remain functional.
- **Resolution update:** Git's owning `worktree repair` command restored this
  checkout's native Windows back-pointer. The Phase 5 matrix provenance resolver
  now invokes the host `git` executable directly instead of crossing into WSL
  through `bash`, and Scenario Lab readiness fails closed when the current host
  cannot resolve Git provenance. The read-only matrix plan and the complete
  Scenario Lab source suite pass on the repaired Windows worktree.

## Live player-return request repeats an unchanged inconclusive route

- **State:** `OWNING REPAIR IMPLEMENTED / LIVE ACCEPTANCE PENDING` on 2026-08-22.
- **Observed:** 2026-08-21 19:38–19:41 America/Chicago in the fresh normal-world
  play session.
- **Player request:** `KEVIN COME TO US`, followed by increasingly explicit
  requests to try again and fight through.
- **Failure:** Kevin repeatedly issued `!come("phixxation")` and
  `!goToPlayer("phixxation", 3, false)` after the same specialist family returned
  `skill_route_unproven`. He kept promising another attempt without changing a
  controlled factor, selecting a materially different method, or terminating
  with the truthful route-unproven blocker. The final clarification arrived only
  after the repeated loop.
- **Available evidence:** `bots/Kevin/histories/8-21-2026_7-06-03PM.jsonl`,
  `launcher.log`, and `server_data/managed-java/logs/latest.log`. The telemetry
  files previously cited for this interval are no longer present at their
  recorded paths and were not used to justify the repair.
- **Owner correction:** The later source audit established that `goToPlayer`
  demanded complete route proof before allowing native incremental execution.
  The repeated responses followed that zero-movement caller failure; this was not
  evidence that Pathfinder lacked traversal choices.
- **Impact:** high player-visible incoherence, wasted provider turns, repeated
  specialist work with no information gain, and delayed truthful explanation.
- **Repair:** Ordinary player travel now enters native `goto()` directly so its
  partial path can execute and replan. The temporary response-loop
  material-change blocker was removed at the Director's instruction; identical
  later route attempts remain eligible to reach ActionManager. Pathfinder safety,
  cancellation, stall detection, and protected-block policy remain authoritative.
- **Verification:** Before blocker removal, only one of four selected route
  attempts reached execution. After removal all four execute, and a later
  identical route also executes without world-state change. The player-route
  contract passes `27/27`; adjacent navigation/runtime/lifecycle checks pass
  `132/132`; syntax and diff checks pass.
- **Remaining acceptance:** The currently running Kevin process predates this
  source change. No bot/Paper restart or world mutation was authorized or
  performed, so real Minecraft acceptance remains open.

## Blocked survival shelter is recreated and announced as “Worksite.”

- **State:** `PENDING`
- **Observed:** 2026-08-21 19:36–19:41 and recurring from 19:52
  America/Chicago in the fresh normal-world play session.
- **Recurrence:** After the player-return command stopped and the failure stayed
  quiet for about eleven minutes, SurvivalDirector resumed the same unchanged
  submission at `19:52:10`. Seventeen new work-order IDs had failed at the same
  site by `19:56:12`, at approximately 15-second intervals. Paper exposed the
  generic `Worksite.` reaction about every 30 seconds throughout the recurrence.
  No player request, site change, or world evidence preceded the retries.
- **Post-death continuation:** After Kevin died and respawned, the same-site loop
  continued under `unsafe_blueprint_trapped_exit` instead of
  `blueprint_incorrect_block`, still creating fresh work-order IDs. Suppression
  therefore cannot depend only on the exact failure code; it must bind the
  unchanged site, attempted outcome, and relevant world evidence.
- **Failure:** Survival automation repeatedly created a new emergency-shelter
  work order at the same `(157, 72, -364)` worksite. Each order immediately
  failed with `blueprint_incorrect_block` because mossy cobblestone occupied
  `(156, 72, -365)`. The unchanged failure was resubmitted about every 15
  seconds under a new work-order ID instead of waiting for changed site or world
  evidence. The reaction renderer treated those IDs as fresh `job.changed`
  events and exposed its generic target-name fallback to players as the repeated
  chat line `Worksite.`
- **Evidence:**
  `bots/Kevin/telemetry/flight-2026-08-22T00-03-21-734Z-4016-003.jsonl`
  through `-006.jsonl`, `bots/Kevin/job-state.json`, and
  `server_data/managed-java/logs/latest.log`.
- **Owners:** SurvivalDirector retry admission owns suppression of the unchanged
  terminal site failure. ReactionPolicy owns truthful rendering or suppression
  of non-recovery `job.changed` events. The builder correctly rejected the
  obstructed blueprint cell.
- **Durable correction needed:** retain the terminal site-failure signature and
  do not submit a replacement shelter at that site until relevant world/site
  evidence changes or a materially different site is selected. Render one
  useful blocked-shelter report, or suppress the event; never fall through to a
  bare target label.
- **Impact:** persistent autonomous job thrash, noisy misleading chat, repeated
  state churn, and obscured player commands despite no possible material
  progress.

## Self-preservation death leaves the prior Activity without observable settlement

- **State:** `PENDING`
- **Observed:** 2026-08-21 19:56:39–19:56:47 America/Chicago in the fresh
  normal-world play session.
- **Failure:** A creeper retreat increased spacing but reduced Kevin from 15
  health to 2.5 and ended `skill_retreat_health_deteriorated`. Eight seconds
  later a zombie killed Kevin. At the death event, Activity
  `Kevin-78-1787360201988` still reported `RUNNING`, retained the body lease, and
  had no cancellation, acknowledgement, settlement, or terminal result. Twenty-
  two milliseconds later Activity `Kevin-79-1787360207510` owned the body and
  settled a food-preparation failure. No flight record terminalizes the prior
  Activity.
- **Evidence:**
  `bots/Kevin/telemetry/flight-2026-08-22T00-03-21-734Z-4016-008.jsonl`,
  `-009.jsonl`, `server_data/managed-java/logs/latest.log`, and `launcher.log`.
- **Owners:** Tactical self-preservation composition owns the health-collapse
  response and survival escalation. The death/respawn lifecycle boundary and
  ActionManager own terminalizing or quarantining the old Activity before a new
  body lease is issued.
- **Durable correction needed:** Treat deteriorating-health retreat as an urgent
  escalation input rather than ordinary retryable completion. On death, produce
  an explicit terminal lifecycle and settlement/reset observation for the active
  Activity before any post-death action can acquire the body.
- **Impact:** Kevin died while attempting self-preservation, and telemetry cannot
  prove that the pre-death physical owner settled before post-death work began.

## Player-return route cannot execute obstacle-crossing options

- **State:** `IMPLEMENTED / LIVE ACCEPTANCE PENDING` on 2026-08-22.
- **Observed:** 2026-08-21 19:58–19:59 America/Chicago in the fresh normal-world
  play session.
- **Player requests:** `kevin you gotta think for yourself man, we're stuck`,
  followed by `Kevin just jumop or break the canopy with your hands lol`.
- **Failure:** The live player was near `(-925, 61, 1040)` while Kevin was near
  `(161, 83, -384)`. The actual job was to route to the player. `goToPlayer`
  required a complete native route proof before it allowed any movement, and the
  long search ended inconclusively as `skill_route_unproven`; Kevin therefore
  travelled zero blocks. After abandoning that route, generated responses
  improvised unrelated local actions: `goToSurface`, a zero-change horizontal
  tunnel, a teleport request, and finally `collect("spruce_leaves", 4)`. Those
  actions were downstream symptoms, not the requested mechanic.
- **Evidence:** `bots/Kevin/histories/8-21-2026_7-06-03PM.jsonl` and
  `launcher.log` preserve the player positions, repeated zero-movement route
  failures, later local-action sequence, and final CollectBlock result.
- **Owner:** The `goToPlayer` consumer policy owned the zero-movement failure.
  Kevin's active `full` traversal profile and shared `safeMovements` already
  enabled walking, jumping/parkour, scaffolding, block breaking, and tool-aware
  mining. The whole-route preflight prevented those native Pathfinder choices
  from executing.
- **Repair:** Managed-region and live-player pursuit now enter the owned native
  `goto()` path directly. Pathfinder can walk its best current partial route,
  replan as terrain loads, and choose the lower-cost viable movement edge among
  ordinary traversal, climbing/jumping, placement, breaking, and mining. Existing
  block protections, hazard exclusions, cancellation, stall detection, and final
  live-player distance verification remain in force. No phrase rule, second
  planner, waypoint executor, or global traversal flip was added.
- **Verification:** The focused player-route contract failed before repair because
  the complete-route probe ran, then passed `27/27` with zero preflight probes and
  one native route using the full movement profile. Adjacent navigation and
  lifecycle checks pass `132/132`; syntax and diff checks pass.
- **Remaining acceptance:** The running Kevin process predates this source repair.
  No bot/Paper restart, game launch, provider call, or world mutation was performed,
  so the real canopy/player-return composition remains open.

## Codex Luna app-server turn start times out during live play

- **State:** `PENDING`
- **Observed:** 2026-08-21 20:00:37 through 20:03:46 America/Chicago in the
  fresh normal-world play session.
- **Failure:** The configured `codex/gpt-5.6-luna` provider returned
  `CodexProviderError: Codex app-server did not answer turn/start within 45
  seconds` with code `TIMEOUT`. Kevin exposed the provider-failure sentinel to
  players as `My brain disconnected, try again.`
- **Evidence:** `launcher-error.log`, `launcher.log`, and
  `server_data/managed-java/logs/latest.log`. The active flight evidence is
  `bots/Kevin/telemetry/flight-2026-08-22T00-03-21-734Z-4016-010.jsonl`.
- **Repeated live effect:** After `phixxation: kevin follow us` at 20:01:33,
  Kevin acknowledged the order at 20:02:01 but emitted the same provider-failure
  sentinel at 20:02:16, 20:03:01, and 20:03:46. The Codex adapter logged four
  consecutive `thread/start` acknowledgement timeouts after the original
  `turn/start` timeout. Kevin did not follow; by 20:15 the player was unloaded
  roughly 560 blocks away while Kevin remained near the prior cave position.
- **Owner:** Codex provider transport/app-server turn-start responsiveness, not
  Minecraft mechanics. This observation does not establish an authentication,
  quota, or billing failure.
- **Durable correction needed:** Diagnose why the existing authenticated Codex
  app-server failed to acknowledge `turn/start` within its owned deadline while
  preserving the single authorized route and explicit provider-failure truth.
- **Impact:** **High.** Kevin could not answer the live player, did not execute
  the direct follow request, and repeated the generic failure line through the
  active turn loop. No provider retry or route switch was initiated by the
  monitor.

## Status-only message is forced through the gameplay-command retry loop

- **State:** `RESOLVED` on 2026-08-21.
- **Observed:** 2026-08-21 20:21:06 through 20:21:14 America/Chicago after the
  bot-only DeepSeek activation.
- **Player words:** Dashboard ADMIN sent `Confirm you are online by saying
  DeepSeek Flash online. Do not move or start a task.`
- **Kevin response/action:** DeepSeek immediately generated `DeepSeek Flash
  online.` twice, but the action-response gate rejected the command-free status
  answer and substituted `I could not map that request to a safe gameplay
  command.` Kevin then executed an unnecessary read-only `!awareness`, asked
  `What should I figure out?`, updated memory, and finally said `DeepSeek Flash
  online. No movement or tasks started.`
- **Physical evidence:** No movement or task started. Kevin remained at
  approximately `(-927.54, 60, 1051.37)` in the existing world.
- **Provider effect:** Five successful DeepSeek requests were consumed for one
  status-only message even though the first generated response satisfied it.
- **Owner:** Message intent / speech-authority classification and the LLM
  command-enforcement retry loop, not the DeepSeek adapter or Minecraft action
  mechanics.
- **Severity:** **Medium.** The player eventually received the truthful status,
  but only after irrelevant output, an unnecessary inspection command, added
  latency, and multiplied paid provider usage.
- **Evidence:** `launcher.log` and
  `server_data/managed-java/logs/latest.log` at 20:21:06–20:21:14.
- **Resolution:** The shared player-speech authority classifier now identifies
  leading status/speech requests as `response_only`, unless a later affirmative
  physical clause explicitly adds gameplay work. The prompt command gate consumes
  that same authority result, so a negative safety clause such as `Do not move`
  cannot force a command retry.
- **Verification:** Focused and adjacent checks passed (40/40, then 112/112,
  with changed-file lint clean). Kevin alone restarted at 20:28 while Paper PID
  33360 and the world stayed live. At 20:28:29 ADMIN sent `Say only "Status gate
  green." Do not move or start a task.` Kevin answered `Status gate green.` from
  exactly one DeepSeek request with one generated response, zero correction
  retries, zero `!awareness`, and zero parsed commands. Telemetry before the turn
  and live state after it both reported `(-927.54, 60, 1051.37)` with no
  pathfinder.
- **Evidence:** `launcher.log` lines 1513–1524,
  `server_data/managed-java/logs/latest.log` lines 520–527, and
  `bots/Kevin/telemetry/flight-2026-08-22T01-28-26-590Z-55560-000.jsonl`.
