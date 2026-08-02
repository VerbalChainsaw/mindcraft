# Live verification runbook — reaction-latency work

Status: **ready to run, nothing below has been run yet except step 0**

Nine commits (`3f1be78..` through the wake-reason trace wiring) changed how the
behavior loop is scheduled, how parked skills are released, and which world
scans run. All of it is covered by unit tests, probes, and static checks. Only
step 0 has live evidence. Everything else is structurally verified and
behaviourally unverified — treat this run as the real test.

## What changed, and what would prove each

| Change | Live check | What a pass looks like |
|---|---|---|
| Benchmark reads the v2 envelope | step 0 | `statePushSamples > 0` |
| Wake on world edges | combat, session | decision traces with non-`scheduled_tick` triggers |
| Threat-approach sensor | combat | `threat_approached` triggers appear |
| Interruptible waits | follow `--mode stop` | stop lands promptly mid-follow |
| Survival scan gating | survival | sleep and shelter still happen |
| Job scan gating | collection | miner/lumberjack still find resources |
| Movements reuse | any | no path regression |
| Autonomy pacing | session | shorter gaps between autonomous actions |

## Preconditions

The stack must be running **this** code. A stack started before these commits
will not exercise any of it.

```bash
cd /c/Users/zerop/Development/minecraft-companion && git log --oneline -1
```

Check whether something is already up, and when it started:

```bash
powershell -NoProfile -Command "Get-Process node,java -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,StartTime | Format-Table -AutoSize"
```

If the start time predates the commits, restart:

```bash
cmd /c stop-mindcraft.bat
```

```bash
npm start
```

`npm start` runs `main.js`, which brings up the mindserver on 8080, the managed
Paper server on 25579, and the agent process. Wait for health to report the bot
in game before running anything else:

```bash
curl -s http://localhost:8080/api/health
```

Required: `"agentsInGame":1`, `"minecraftReachable":true`, `"problems":[]`.

## Step 0 — telemetry parity (already passed)

```bash
node tools/benchmark-runtime.mjs --url=http://localhost:8080
```

Passed on 1 Aug against the pre-change stack: `statePushSamples: 3`, previously
`0`. Re-run after restart to confirm nothing regressed.

Two numbers worth recording rather than asserting: `stateDeliveryP50Ms` was
`3398` and `stateIntervalP50Ms` was `247`. Pushes are frequent; their *contents*
are ~3.4s old, which is the 2.5s pump interval. That gap is why the retained
decision-trace window must not be shrunk — see the note at the end.

## CLI gotcha, read this before step 1

The tools disagree on argument syntax, and the wrong form fails silently rather
than erroring:

- `benchmark-runtime.mjs` takes `--url=VALUE` (**equals**). With a space it
  parses as no URL at all and reports `"live": null`.
- Every `verify-*-field.mjs` takes `--url VALUE` (**space**).

All `verify-*` tools also require `--authorized-active-world`. That flag exists
because they mutate the live world: they spawn mobs, move the bot, and place
blocks. Do not point them at a world you care about.

## Step 1 — combat: the wake channel and the threat sensor

This is the headline test. It covers both the event-driven wake and the
approach sensor.

```bash
node tools/verify-combat-field.mjs --url http://localhost:8080 --bot MindcraftBot --attempts 2 --evidence docs/verification/2026-08-01-live/combat.json --authorized-active-world
```

Then read the traces back:

```bash
node tools/report-decision-trace.mjs docs/verification/2026-08-01-live/combat.json
```

**Pass:** the bot engages zombie, skeleton, and creeper with the same tactical
outcomes as the previous certification (`skill_secured`, shield use against
skeletons, standoff or retreat against creepers).

**The new signal:** trigger codes. Before this work every trace read
`scheduled_tick`. Now look for `threat_detected` (a hostile loaded nearby),
`threat_approached` (one already loaded closed the distance), `self_damaged`,
and `action_finished`. If every trace still says `scheduled_tick`, the wake
channel is not firing and that is the finding.

Also run the natural-language path, which is a separate routing surface:

```bash
node tools/verify-combat-field.mjs --url http://localhost:8080 --bot MindcraftBot --attempts 1 --evidence docs/verification/2026-08-01-live/combat-nl.json --authorized-active-world --natural-language-defend
```

## Step 2 — follow and stop: interruptible waits

`--mode stop` is the direct test. The follow loop used to sample every 200ms and
could not answer a stop sooner than its own period; it now waits on the
interrupt signal.

```bash
node tools/verify-follow-field.mjs --url http://localhost:8080 --bot MindcraftBot --attempts 2 --mode follow --evidence docs/verification/2026-08-01-live/follow.json --authorized-active-world
```

```bash
node tools/verify-follow-field.mjs --url http://localhost:8080 --bot MindcraftBot --attempts 2 --mode stop --evidence docs/verification/2026-08-01-live/follow-stop.json --authorized-active-world
```

**Pass:** follow reaches its waypoints, and stop halts the bot and does not
auto-resume.

**Watch for:** I added an interrupt re-check immediately after the follow loop's
wait. That is a real control-flow change. If follow now exits early or fails to
reacquire a player who briefly leaves line of sight, suspect that edit.

## Step 3 — survival: scan gating did not break behaviour

Bed and shelter scans now run only when the survival policy could actually
consume the result: mode `full`, not held, no urgent danger, idle, and then
either a safe-sleep overworld night for beds, or injury recovery or an
unsheltered night/storm for shelters.

```bash
node tools/verify-survival-field.mjs --url http://localhost:8080 --bot MindcraftBot --attempts 2 --evidence docs/verification/2026-08-01-live/survival.json --authorized-active-world
```

**Pass:** eating, sleeping, and shelter-seeking all still occur.

**The specific regression to watch:** a bot that *should* seek shelter or sleep
and does not. That would mean the gate is narrower than the policy, and the fix
is in `summarizeSurvivalSituation` in `src/agent/runtime/survival-director.js`,
where the `needs` object is derived.

## Step 4 — collection: job scan gating

Two radius-64 sweeps now run only for the roles that read them.

```bash
node tools/verify-collection-field.mjs --url http://localhost:8080 --evidence docs/verification/2026-08-01-live/collection.json
```

**Pass:** the bot still selects and collects a reachable resource.

## Step 5 — session soak: pacing and stability

The longest run, and the one that shows whether autonomous play feels
continuous. Minimum duration is enforced at 10 minutes.

```bash
node tools/verify-session-field.mjs --url http://localhost:8080 --bot MindcraftBot --attempts 2 --duration-ms 600000 --evidence docs/verification/2026-08-01-live/session.json --authorized-active-world
```

**Pass:** the session stays stable with no repeated-action arrest and no
unexplained holds.

**What to measure:** wall-clock gap between consecutive autonomous actions. A
fixed 350ms pause used to follow every turn on top of roughly a second of model
latency; that pause should now be gone whenever the turn already exceeded it.

## Highest-risk items, in order

1. **The wake channel firing too often.** The coalescing floor is unit-tested,
   but real event rates are not. Symptom: elevated CPU on the agent process, or
   trace timestamps showing evaluations spaced far below the lane cadence.
2. **Follow behaving differently** — see step 2.
3. **Survival gating too narrow** — see step 3.

## Do not "fix" this while you are in here

The retained decision-trace window is 16 (`behavior-arbiter.js`, the
`snapshot(16)` call). Shrinking it looks like an easy telemetry saving and is
not: the pump samples every 2,500ms while the arbiter ticks between 80ms and
1,000ms, so up to roughly thirty decisions occur between samples. The window is
already arguably undersized, and all seven `verify-*-field` tools reconstruct
their evidence from it. The real cost is traces riding on high-frequency
movement deltas, which is a change to the delta protocol, not to the window.

Background on the related blocker: see
`2026-08-01-concurrent-action-channels-blocker.md`.
