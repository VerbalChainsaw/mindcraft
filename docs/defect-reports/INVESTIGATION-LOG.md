# Running ledger — Claude lane (tandem with live Codex)

Rules I am working under: no writes to `src/` or `tests/` (Codex live-editing), no runtime/director/
server commands, Operator hold untouched, no commits. Everything below is held in scratchpad until
Codex releases the write lane.

Status codes: `CONFIRMED` executed proof · `TRACED` static proof · `FALSIFIED` my own claim, killed ·
`NOTED` non-blocking, recorded not acted on · `GREEN` verification passed · `OPEN` in progress

| # | Status | Item | Evidence | Disposition |
|---|--------|------|----------|-------------|
| 1 | GREEN | Codex's pending planner/job suite (`perception-plan-learning`, `phase0-command-parser`, `work-order`, `builder-plan`, `job-director`) | 72 pass / 0 fail, 1.7s | His uncommitted slice verifies. Reported. |
| 2 | TRACED | build→sleep binds the placed bed via `structure_fixture` and dispatches `!goToBedAt`, bypassing bed search | `agenda-director.js:55-61, 496-512, 725-726`; `structure-design.js:45` | Campaign path established. Basis for #3/#4. |
| 3 | FALSIFIED | *My own claim* that hardcoded `reachable:true` blocks the campaign | Killed by #2 — search path unused on this path | Withdrawn. |
| 4 | CONFIRMED | Pre-sleep hostile gate measures distance from the **bot**, not the **bed**; never re-checked after arrival | `bed-threat-repro.mjs` vs real `skills.goToBed`: hostile 33 from bot (gate passes), 3 from bed (vanilla rejects) | **Fix held** — `skills.js` in Codex's dirty set. |
| 5 | CONFIRMED | Vanilla sleep rejection collapses to generic `outcome:'sleep_rejected'`, cause only in a 180-char free-text `error` | same repro; `skills.js:14341-14347` | **Fix held.** Retry cannot be steered; receipt won't read truthfully. |
| 6 | NOTED | `survival-director.js:246` hardcodes `reachable:true`; `survival-policy.js:188` filters on a predicate nothing can fail | static | Non-blocking (search path only). Do not act without evidence. |
| 7 | NOTED | Scan-radius asymmetry: director `maxDistance:24` (`survival-director.js:226`) vs `goToBed` `32` (`skills.js:14279`) | static | Non-blocking. Do not widen without evidence. |
| 8 | TRACED | Live acceptance world `outpost-acceptance-20260807-0120` has no `playersSleepingPercentage` in `level.dat` → server default **100**: every online player must sleep for night to advance | `server.properties` `level-name`; gunzipped NBT scan | Sets up #9. |
| 9 | CONFIRMED | **Highest severity.** With any human online and awake, the bot enters the bed correctly, is force-woken by its own 20s timeout, and reports `sleep_timeout` failure | `sleep-timeout-repro.mjs`: `enteredSleep:true, woke:true, outcome:'sleep_timeout', returned false` | **Fix held.** Correct Minecraft behaviour misreported as bot failure. |
| 10 | CONFIRMED | Nothing in the codebase is aware of `playersSleepingPercentage` / multiplayer night-skip at all | grep across `skills.js`, `survival-director.js`, `survival-policy.js`, `environment-observer.js` | Root cause of #9. |
| 11 | CONFIRMED | `sleep_timeout` has **zero consumers** in `src/` or `tests/` — nothing branches on it | grep `src/ tests/` | Failure class is inert; cannot be steered. |

| 12 | TRACED | Sleep is a direct action → `directSettlement` (`agenda-director.js:449-456`) carries `retryable:true` from goToBed evidence. `MAX_ENTRY_ATTEMPTS = 2` (`:24`), gate at `:545-552`. Attempt 1 retries, attempt 2 goes terminal `failed` | static arithmetic | Campaign abandons sleep after **2 tries / ~40s** of correct in-bed behaviour. |
| 13 | TRACED | Builder receipt is **not** harmed: construction already succeeded (that is what produced the fixture binding), and `:438` marks construction failures non-retryable only for the construction entry | static | Answers Chunk 4: only the sleep entry dies. C3 alone can make the campaign pass. |
| 14 | TRACED | `sleepTimeoutMs` default 20s vs. a sleep window of ~12542→23460 ticks (~546s at 20 tps) when the night is not skipped | static | 20s is ~27x too short. Concrete number for C3. |

| 15 | TRACED | Once the agenda sleep entry is terminal the bot becomes idle, and the **autonomous** survival path re-fires nightly: `eligible = mode==='full' && !held && !urgentDanger && idle` (`survival-director.js:327`), `needs.beds` at `:329`, dispatch `!goToBed` at `:493-494` | static | Same `goToBed`, same 20s default → the same force-wake failure **every night, indefinitely**. |
| 16 | NOTED | Amends #6: the hardcoded `reachable:true` is not purely academic — it sits on this nightly autonomous path, just not on the campaign path | static | Still do not act without live evidence. |
| 17 | NOTED | Operator hold suppresses autonomous sleep entirely (`!held` in `:327`) — consistent with hold semantics, no action | static | Confirms hold is not implicated in any of the above. |

| 18 | CONFIRMED | `sleepTimeoutMs` occurs **only** at its own default (`skills.js:14253`) and its single use (`:14364`). No call site overrides it — not `actions.js`, not `agenda-director`, not `npc/controller.js`, not any test | grep `src/ tests/` | 20s is the live value on **every** sleep path. One-line blast radius for C3. |

| 19 | CONFIRMED | **mineflayer already performs the correct bed-anchored monster check** — `bed.js:133-146`, `monsterRange=[7,-8,-8,7]` box around the bed head, throws `'there are monsters nearby'` | read of installed package | Revises C1: the project's check is a wrongly-anchored *duplicate*. Let the package own the decision. |
| 20 | CONFIRMED | Exact mineflayer sleep-rejection strings captured from the installed version (9 distinct causes, `bed.js:69-159`) | read of installed package | Makes C2 implementable without guessing. |
| 21 | CLEARED | `goToBed` pauses `'unstuck'` and never unpauses it — investigated, **not a defect**: `beginUpdateCycle` calls `unPauseAll()` when idle (`modes.js:807-808`), and staying paused during sleep is correct | static | Recorded so nobody re-derives it. No action. |
| 22 | DELIVERED | `SLEEP-REPAIR-SPEC.md` — full implementation spec: ordering, string-anchored edit sites, sizing, constraints, mineflayer error table, verification commands, cleared-items list, evidence-class disclosure | — | Ready for Codex/Director to execute. |

## Queued corrections (package-first, not applied)

- **C1** (from #4): measure the existing hostile check against the bed position when a fixture is bound;
  re-check after `navigate` returns. Not a new mob scanner.
- **C2** (from #5): classify the `bot.sleep()` rejection into distinct outcomes so "monsters nearby"
  (retryable with time/distance) is separable from rejections that are not.
- **C3** (from #9/#10/#11, **do first**): being in bed while other players are awake is *success in
  progress*, not failure. The 20s deadline actively cancels a legitimate sleep, so the bot can never
  still be in bed when dawn arrives. Treat "in bed, no threat, night not yet advanced" as a distinct
  non-failure state and stay in bed; keep the timeout for the genuinely stuck cases. Mineflayer already
  exposes `isSleeping` and time — no new sleep engine.

## Session facts worth not re-deriving

- Git: worktree with a WSL gitdir. Use explicit `GIT_DIR` / `GIT_WORK_TREE`. Branch
  `recovery/iron-pickaxe-20260803`, in sync with origin, last commit `df099b7`.
- Glimpse: row id=266 as `claude-opus5-45d54182`, workspace must be passed via `GLIMPSE_WORKSPACE`.
- Not found anywhere on this machine: `soul.md`, any `lodestar` reference. `agentctx` resolved to the
  `agent-context-surgery` skill.

## Chunk log

- **Chunk 1** — startup + verify Codex's pending suite. Done (#1).
- **Chunk 2** — sleep-rung entry path. Done (#2–#7, C1, C2).
- **Chunk 3** — sleep *completion* semantics. Done (#8–#11, C3). Found the highest-severity item so far.
- **Chunk 4** — agenda handling of a failed sleep entry. Done (#12–#14). Builder survives; sleep entry
  goes terminal after 2 attempts. C3 sharpened with a concrete duration.
- **Chunk 5** — re-arming after terminal failure. Done (#15–#17). The campaign entry stays dead, but the
  autonomous path retries nightly and fails identically. C3 fixes both, since both call the same
  `goToBed`.
- **Chunk 6** — `sleepTimeoutMs` override audit. Done (#18). No overrides anywhere; 20s is live on all paths.
- **Chunk 7** — package-first re-check of C1/C2 against the installed mineflayer, then write the
  implementation spec. Done (#19–#22). C1 revised from "fix our check" to "stop duplicating theirs".
- **Chunk 8** — candidate next: does a sleep failure surface truthfully in the campaign receipt the
  Director actually reads, given `sleep_timeout` has no consumers (#11). OPEN.

---

## Continued — chunks 8–10 (published reports)

| # | Status | Item | Evidence | Disposition |
|---|--------|------|----------|-------------|
| 23 | TRACED | `sleep` is a `direct` executor (`agenda.js:78`); operator Stop leaves no durable marker; restart settles the restored entry as `agenda_action_result_missing` and charges `attempts + 1` against `MAX_ENTRY_ATTEMPTS = 2` | static | Published as **AGENDA-01**. |
| 24 | CONFIRMED | `agenda_action_result_missing` has **zero test coverage** — appears only at its own definition | grep `src/ tests/` | Nothing is pinned to today's behaviour; changing it breaks no contract. |
| 25 | CLEARED | All four durable stores use `writeJsonAtomicSync`; `OperatorControlStateStore.load()` fails closed on every error path (corrupt / oversized / bad version → `held: true`) | read of `atomic-file.js`, `operator-control-state.js` | Sound. No action. |
| 26 | CLEARED | Orphaned `bots/MindcraftBot/operator-control.json.tmp-*` found on disk, chased, proved **benign** — real file survived with `held: true`, legacy `memory.json` independently carries `operator_hold: true` | filesystem inspection | Atomic write behaved correctly under hard kill. Hygiene item only. |
| 27 | NOTED | `OperatorControlStateStore` fails **open** on the absent-file path only (missing control file + missing legacy memory → `held: false`) | static | Correct for a new bot; unreachable normally since atomic writes never delete. Recorded, not raised. |
| 28 | TRACED | Hunger branch (`survival-policy.js:58`) precedes the night/sleep branch (`:181`) in a first-match waterfall, so an idle hungry bot with no safe food dispatches `!prepareFood(24, 64)` at night instead of sleeping | static + dispatch table at `survival-director.js:487-488` | Published as **SURVIVAL-01**. |
| 29 | CLEARED | Food safety model audited: `UNSAFE_FOODS` correctly lists only genuinely harmful items and does not blacklist other raw meats; `TACTICAL_FOODS` reservation is deliberate; `isNightTime` is shared with a rationale comment | static | Well built. Do not touch. |
| 30 | NOTED | `rotten_flesh` excluded even when `critical`, so a starving bot holding only rotten flesh will not eat it (`difficulty=normal` → starvation stops at 1 HP, not death) | static | Unobserved. Record only; do not turn into a requirement. |

## Chunk log (continued)

- **Chunk 8** — published specs into `docs/defect-reports/` with per-defect filenames; repros ported to
  relative imports and re-verified from the new location.
- **Chunk 9** — agenda restart path. Found and published **AGENDA-01** (#23–#24).
- **Chunk 10** — durable stores + operator-control persistence audit. Cleared (#25–#27); chased a real
  on-disk orphan to ground rather than assuming harm.
- **Chunk 11** — survival eating path. Found and published **SURVIVAL-01** (#28); cleared the food safety
  model (#29–#30).
- **Chunk 12** — candidate next: `emergency-shelter.js` and the reaction/threat path, both clean in the
  concurrent writer's dirty set. OPEN.

## Continued — chunk 12

| # | Status | Item | Evidence | Disposition |
|---|--------|------|----------|-------------|
| 31 | CONFIRMED | `isSheltered` is two upward `blockAt` probes only — no walls, no enclosure. `oak_leaves` has `boundingBox: 'block'` in 1.21.11, so standing under a tree satisfies it (also fences, glass, slabs, scaffolding) | executed `minecraft-data` lookup | Published as **SHELTER-01** part 1. |
| 32 | TRACED | `EMERGENCY_SHELTER_BLUEPRINT` leaves a permanent 1×2 doorway, and `validateEmergencyShelterBlueprint` *enforces* the opening (`return !occupied.has('0:0:-1') && !occupied.has('0:1:-1')`) | read generator against its own validator; 23-cell arithmetic checked | Published as **SHELTER-01** part 2. |
| 33 | TRACED | `sheltered === true` suppresses the entire seek/build-shelter branch (`survival-policy.js:215`) and unlocks the no-bed `wait` branch (`:203`) | static | The two parts compound: bot believes it is safe. |
| 34 | NOTED | Cheapness of `isSheltered` is deliberate — the code comment states it is the only shelter read consulted unconditionally | static | Correction must not make it expensive. Recorded so nobody "fixes" it the wrong way. |
| 35 | NOTED | `solidCover`'s `!['water','lava']` guard is redundant — both are `boundingBox: 'empty'` in 1.21.11 | executed lookup | Harmless. No action. |

## Chunk log (continued)

- **Chunk 12** — `emergency-shelter.js` + the shelter predicate. Found and published **SHELTER-01**
  (#31–#35). Verified the leaves claim against the registry rather than asserting it from memory.
- **Chunk 13** — candidate next: the reaction/threat path (`reaction-policy.js`, `reaction-director.js`),
  the last clean neighbour of the survival surface. OPEN.

## Continued — chunks 13–14

| # | Status | Item | Evidence | Disposition |
|---|--------|------|----------|-------------|
| 36 | CLEARED | Reaction path fail-silent suspicion: `speechInLastMinute >= (Number(policy.maxSpeechPerMinute) \|\| 0)` looked like it would mute the bot on a missing config value | `behavior-config.js:176-177` bounds both with defaults (4, 8) | Not reachable; `0` is a deliberate mute option. No action. |
| 37 | CONFIRMED | `sweet_berry_bush` and `wither_rose` are `boundingBox: 'empty'` in 1.21.11 and absent from `HAZARDOUS_GAMEPLAY_BLOCKS`, so the feet/head occupancy predicate judges them safe to stand in | executed registry lookup + predicate read | Published as **SAFETY-01**. Wither can kill. |
| 38 | CONFIRMED | `pointed_dripstone` is `boundingBox: 'block'` and absent from the hazard set, so `isSafeGameplaySupport` accepts it as a surface to stand on | executed registry lookup | Published as **SAFETY-01**. |
| 39 | FALSIFIED | *My own hypothesis* that `wither_rose` in `mcdata.js:180` meant the bot seeks wither roses | It is `mustCollectManually` — a how-to-collect list, not a what-to-seek list | Withdrawn before it reached a report. |
| 40 | CLEARED | Rest of `gameplay-safety.js` audited: `powder_snow` already present (subtle, suggests a careful list), `_shulker_box` handled by suffix, falling blocks complete incl. all anvil states and `_concrete_powder` | static | Sound. The three gaps look like drift, not negligence. |
| 41 | NOTED | `mcdata.js:180` lists `wither_rose` twice in `mustCollectManually` | static | Harmless duplicate; array is only `.includes()`-tested. No action. |

## Chunk log (continued)

- **Chunk 13** — reaction/threat path. Nothing real; cleared (#36). Pivoted rather than grinding a
  low-stakes surface.
- **Chunk 14** — `gameplay-safety.js`. Found and published **SAFETY-01** (#37–#41), the first finding
  whose fix touches no contested file. Killed one of my own hypotheses on the way (#39).

## Chunk 15 — assumptions audit of every prior finding

Re-checked each published claim, separating measured fact from inference. Four claims were wrong or
overstated and have been corrected in place; two suspicions were cleared; the rest held.

| # | Status | Item | Outcome |
|---|--------|------|---------|
| 42 | **CORRECTED** | SLEEP-01 sizing said "~546 s", derived by treating `23460` as wake time. `23460` is the last tick a player may *enter* a bed; one already in bed stays until tick `24000` | Worst case is **~573 s**, not 546. The recommended `600_000` ceiling left only ~27 s of margin — now recommends `900_000`. Materially changed the fix. |
| 43 | **CORRECTED** | SLEEP-01 stated the gamerule is absent from `level.dat` as settled fact | `level.dat` was read while the server was **running** and may hold unflushed state. Added a caveat and named the decisive console check. Also noted the defect does not depend on the gamerule value at all. |
| 44 | **CORRECTED** | SAFETY-01 claimed `pointed_dripstone` damages when stood on, and that berry bushes hurt a bot that "stands in" them | Fall-damage amplification is certain; continuous standing damage is **unverified** and `minecraft-data` carries no contact-damage semantics. Berry bushes damage a **moving** entity. Both softened, confidence column added. |
| 45 | **CORRECTED** | SHELTER-01 asserted the emergency shelter "is never sealed" | Verified: the blueprint omits the doorway cell and the validator *rejects* filling it. **Not** verified: whether the builder seals it post-entry — that lives in a file under concurrent edit. Claim scoped to what was actually checked. Part 1 stands regardless. |
| 46 | **CORRECTED** | SLEEP-03 presented a retryable/not column as if it came from mineflayer | Message text and line numbers are measured; the retryable judgement is **mine**. Labelled as a proposal. |
| 47 | VERIFIED | AGENDA-01's weakest link: does dispatch actually persist `state:'active'`? If not, a restart would find `pending`, re-dispatch, and charge nothing — collapsing the finding | `replace()` calls `persist()`, and `agenda-director.js:893` sets `state:'active'` through it. `activeEntry()` selects on `state === 'active'`. **Finding survives.** |
| 48 | VERIFIED | SURVIVAL-01's "64-block radius" claim | `actions.js` documents `range` as "Maximum crop, animal, and resource search radius", domain `[16,128]`. **Correct as written.** |
| 49 | VERIFIED | AGENDA-01 assumed `executorsIdle()` is true in a fresh process | It reads `!activeGoal && !activeOrder && !actions.executing` — all falsy on restart. **Correct.** |
| 50 | CLEARED | `waitForBotEvent` (in `interruptible-delay.js`) never checks `interrupt_code` and never listens for `INTERRUPT_EVENT`, despite the module's name | Single call site, `self_prompter.js:304`, bounded by `DEFAULT_COOLDOWN = 350` ms. Negligible Stop latency, and the code comment already reasons about it as an upper bound. **Not a defect.** |
| 51 | NOTED | `combat-decision.js` `RANGED_THREATS` omits `piglin` (crossbow variant) | Nether-only; irrelevant to the overworld outpost campaign. Record only, do not act. |

## Chunk log (continued)

- **Chunk 15** — full assumptions audit. Five published claims corrected (#42–#46), three weak links
  verified and held (#47–#49), one suspicion cleared before it became a report (#50), one marginal note
  (#51). No finding was withdrawn entirely; SAFETY-01, AGENDA-01, SURVIVAL-01 and SLEEP-01's core all
  survived.

## Chunk 16 — construction siting (surgical)

| # | Status | Item | Evidence | Disposition |
|---|--------|------|----------|-------------|
| 52 | CONFIRMED | `entityOccupies` (`structure-site-selector.js:26-34`) filters by no entity type; `inspectSite:106` applies it per blueprint cell and `return null`s the **whole site**. One dropped item, XP orb, or arrow in the volume disqualifies the candidate | code read (both functions quoted) + `minecraft-data` 1.21.11 name verification | Published as **SITE-01**. |
| 53 | CONFIRMED | The repo already owns the right discriminator — `entity?.name !== 'item'` in `usefulDropCandidates` (`survival-director.js`) | code read | Fix reuses an existing idiom: 2 lines in one helper, no new module. |
| 54 | NOTED | Failure is **intermittent** — items despawn after ~5 min, orbs drift, so the same anchor passes or fails across attempts | inference from the above | Recorded because a flaky rejection is more expensive to diagnose than a hard one. |
| 55 | CLEARED | `clearConstructionCell` redundantly guards liquid/hazardous/protected after an already-exclusive replaceable whitelist | static | Harmless belt-and-braces, same pattern as `solidCover`. No action. |
| 56 | CLEARED | `naturalSupport` excludes `_leaves` explicitly — the leaf blind spot from SHELTER-01 was already handled here | static | Good sign; the two predicates were written with different care levels, not uniformly careless. |
| 57 | CLEARED | Bot-inside-footprint rejection and `clearanceLimit` bounding of clearable terrain both correct and documented | static | Deliberate and sound. No action. |
| 58 | SKIPPED | `selectDisposableWorkingSlotStack` (inventory capacity) lives in `skills.js` — under concurrent edit | — | Deliberately not audited to avoid sprawling into the contested file. |

## Chunk log (continued)

- **Chunk 16** — `structure-site-selector.js`. Found and published **SITE-01** (#52–#54); cleared three
  nearby predicates (#55–#57). Declined to audit inventory capacity because its logic sits in the
  contested file (#58).

## Chunk 17 — gnarliest-file sweep

Ranked clean (non-contested) sources by size, then probed for the longest functions rather than reading
whole files. Contested files (`skills.js` 16946, `actions.js`, `prerequisite-planner.js`,
`job-director.js`) were excluded by ownership, not by lack of interest.

Clean gnarly set: `mindserver.js` 3047, `managed-minecraft-server.js` 1985, `goal-director.js` 1966,
`agent.js` 1813, `behavior-arbiter.js` 1058.
Longest clean functions: `behavior-arbiter.update()` **442**, `goal-director.handleResult()` **294**,
`goal-director.update()` 229, `goal-director.waitForPlayer()` 180.

| # | Status | Item | Evidence | Disposition |
|---|--------|------|----------|-------------|
| 59 | CONFIRMED | `behavior-arbiter.update()` sets `this.updating = true` at :609 but does not open its `try` until :644. `this.updating = false` exists **only** in the constructor (:127) and the `finally` (:1043) — no watchdog resets it anywhere in `behavior-director.js` or `agent.js` | code read + exhaustive grep of the flag | Published as **ARBITER-01**. |
| 60 | CONFIRMED | The wedge **defeats the existing restart watchdog**: `agent.js:1706-1716` counts *consecutive throws*, but a wedged arbiter returns a snapshot normally, resetting `consecutiveFailures` to 0 every tick. The counter never reaches 5 | code read of both paths | The sharpest part of the finding — a hard failure becomes a silent success. |
| 61 | CLEARED | `refreshPerception()` — the largest await inside the unguarded gap — has a complete internal try/catch and returns an error object rather than throwing | code read | Not the risk. Exposure is `urgencyOf()`, `actionState()`, and four `traceRecorder` calls. |
| 62 | CLEARED | Arbitration order: the bounded `emergency_self_preservation` band is deliberately evaluated **before** the operator-hold gate so drowning/burning can be answered without releasing the hold, with a comment saying why | code read | Correct and intentional. Do not disturb. |
| 63 | CLEARED | The `finally` is itself defensive — `endUpdateCycle` wrapped in its own try, task-completion check in a nested try/finally so the trace still finalizes | code read | Sound. |
| 64 | NOTED | `goal-director.handleResult()` at 294 lines is the next-gnarliest clean function and was **not** audited this chunk | — | Open lead, not a finding. |

## Chunk log (continued)

- **Chunk 17** — gnarliest-file sweep. Found and published **ARBITER-01** (#59–#60); cleared three nearby
  patterns (#61–#63). Left `goal-director.handleResult()` as a named open lead rather than half-auditing
  it (#64).

## Chunk 18 — full mechanical re-verification (challenged on the count)

Built `repro/verify-all-claims.mjs`: 48 assertions covering every load-bearing claim in all 9 reports,
run against the **current** repo contents. Result: **43 passed, 5 failed.**

**The "64 items" framing was misleading and is corrected.** 64 = investigation log rows. Actual published
defect reports = **9**, of which only 2 were ever proven by executed repro; the rest are code reads of
varying strength, each labelled with its evidence class. The majority of log rows are clears, notes not
raised as requirements, verifications, and corrections to my own claims.

| # | Status | Item | Outcome |
|---|--------|------|---------|
| 65 | **SUPERSEDED** | SLEEP-01 — checks S1.1/S1.2/S1.4 failed because `sleepTimeoutMs` no longer exists (0 occurrences) | Commit `bdc7e81` renamed it `standaloneSleepTimeoutMs = 600_000` **and** set the deadline to `Number.POSITIVE_INFINITY` when a cancellation signal exists. Fixed upstream, more thoroughly than proposed. |
| 66 | **SUPERSEDED** | SLEEP-02 — check S2.1 failed; the bot-relative hostile pre-check is gone | Same commit removed the duplicate outright, leaving mineflayer's bed-anchored check as authority. Exactly the package-first correction argued for. |
| 67 | **PARTLY STALE** | SLEEP-03 — `sleep_timeout` now has 0 occurrences in `skills.js` | That portion is obsolete. The `sleep_rejected` collapse (S3.2) still passes and the finding stands in reduced form. Report flagged for revision. |
| 68 | **STRENGTHENED** | AGENDA-01 — check A1.8 failed on a stale regex, not a stale fact | Commit `7a99d81` added a restore-time resume filtered on `entry.executor === 'job'`. The `direct` lane — `sleep`, `craft`, `goto`, `smelt`, `deposit`, `visit`, `follow_until`, `farm_visit`, `maintain_farm` — is untouched. All 8 mechanical checks still pass. The same failure class was fixed for jobs and left for direct steps. |
| 69 | VERIFIED | SURVIVAL-01 4/4, SHELTER-01 6/6, SAFETY-01 6/6, SITE-01 4/4, ARBITER-01 7/7 | All still valid against current source. |
| 70 | VERIFIED | My untracked docs were **not** swept into any of the three new commits; `docs/defect-reports/` is still `??` | No interference with the other writer's history. |
| 71 | NOTED | Ownership moved: the concurrent writer's dirty set is now `modes.js`, `combat-decision.js`, and two tests | **`combat-decision.js` is now contested**; `skills.js` is not. Earlier clean/contested judgements are time-sensitive. |

## Chunk log (continued)

- **Chunk 18** — mechanical re-verification of everything, prompted by a challenge to the count. Two
  reports superseded by upstream fixes landed while they were being written, one partly stale, one
  strengthened, five fully intact. Corrected the misleading "64" framing in the README. Added a
  re-runnable verification harness so staleness is detectable in one command rather than by re-reading.
