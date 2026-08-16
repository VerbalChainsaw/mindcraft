# SLEEP-01 — the 20-second ceiling force-wakes a legitimate sleep

**Severity:** blocks the standing campaign. Highest priority of the three sleep defects.
**File:** `src/agent/library/skills.js`, function `goToBed`.
**Status:** confirmed by executed repro. Not applied.

> ⚠ Line numbers drift — `skills.js` was being actively edited when this was written.
> Anchor on the quoted code strings.

## Player-visible outcome

The companion cannot complete a night's sleep while a human is online. Today it fails **every night,
indefinitely**. This is the standing `docs/coordination/CURRENT.md` blocker: "must complete construction
and actual sleep."

## What is wrong

Anchors:

```js
    sleepTimeoutMs = 20_000,
```

```js
    const deadline = now() + Math.max(1_000, sleepTimeoutMs);
    while (bot.isSleeping) {
        if (bot.interrupt_code || now() >= deadline) {
```

When the night does **not** skip, Minecraft correctly keeps the bot in bed until dawn. The bot's own
20-second wall-clock deadline then force-wakes it and reports `sleep_timeout` / `return false`. Because
it cancels its own sleep, it can never still be in bed when dawn arrives.

The night does not skip whenever another player is online and awake. Gamerule
`playersSleepingPercentage` is **absent from the live acceptance world's on-disk `level.dat`**
(`server_data/managed-java/outpost-acceptance-20260807-0120/`), which implies the server default of
**100** — every online player must sleep.

> **Caveat on that check.** `level.dat` was read while the server was running, and a running server holds
> world state in memory and flushes periodically. If someone set this gamerule during the current
> session, the on-disk file would not yet show it. The decisive check is one console command —
> `/gamerule playersSleepingPercentage` — which was deliberately not run here because the Minecraft
> runtime belonged to another writer. **Run it before relying on the "100" figure.**
> Note the defect below does not actually depend on the gamerule value: any night that fails to skip for
> any reason produces the same force-wake.

The failure is inverted with observation: sleep succeeds when nobody is watching and fails exactly when
you are in-world testing it.

## Blast radius: one constant

`sleepTimeoutMs` occurs in exactly two places — its own default and its single use. **No call site
overrides it**: not `src/agent/commands/actions.js`, not `agenda-director`, not
`src/agent/npc/controller.js`, not any test. 20 s is the live value on every sleep path, campaign and
autonomous alike.

## Sizing — corrected

An earlier draft of this report said ~546 s, derived by treating `23460` (the end of the repo's
`isNightTime` window) as the wake time. **That was wrong.** `23460` is the last tick at which a player
may *enter* a bed; a player already in bed stays there until morning at tick `0`/`24000`.

Worst case is therefore entering at `12542` and waking at `24000` → `11458` ticks → **~573 s at 20 tps**.

20 s is roughly 29× too short.

## What to change

Raise the ceiling past a full night **with real margin**. Note `600_000` (10 min) leaves only ~27 s of
headroom over the 573 s worst case — too tight once server lag or a slow tick loop is involved. Prefer
`900_000` (15 min) if using a flat constant. That alone makes the natural dawn path succeed — `bot.isSleeping` clears on its own, the loop exits, and the existing code already
records `outcome: 'slept'` and returns true. No new state machine.

Preferred refinement: keep the wall-clock value as a **backstop** and derive the real exit from
`bot.time.timeOfDay` crossing dawn, so a genuinely stuck sleep exits early instead of waiting out the
full ceiling.

## Constraints — do not break these

- **Stop / Operator hold must stay instant.** The loop polls `bot.interrupt_code` every 250 ms. Keep
  that poll exactly as it is; do not lengthen the interval.
- **Do not cancel a valid sleep.** In bed, no threat, night not yet advanced is *success in progress*.
- **Keep a real hang guard.** Make the guard meaningful, do not remove it.
- Raising the ceiling means a genuinely stuck sleep blocks for the ceiling instead of 20 s. The
  dawn-based early exit is the mitigation; `interrupt_code` remains the operator's escape.

## Knock-on

`MAX_ENTRY_ATTEMPTS = 2` in `src/agent/runtime/agenda-director.js` currently retries the sleep entry
once and then marks it terminal `failed` — so the campaign abandons sleep after ~40 s of correct in-bed
behaviour. With this fixed, attempt 1 should succeed and the limit stops mattering.

The Builder is **not** implicated: construction already succeeded (that is what produced the
`structure_fixture` binding). Only the sleep entry dies, so this fix alone can make the campaign pass.

## Verification

```bash
node docs/defect-reports/repro/sleep-night-not-skipped.repro.mjs
```

Now: `outcome: 'sleep_timeout'`, `enteredSleep: true`, `woke: true`, returns `false`.
After the fix: should remain in bed and, once `isSleeping` clears, return `true` with `outcome: 'slept'`.

```bash
node --test tests/control-plane/survival-sleep.test.js
```

A focused regression for the night-not-skipped case is justified — it reproduces a specific observed
defect, which is what the repo's testing rule allows. Do not build a broader sleep suite.

## Evidence class

Executed proof: the force-wake, the absent gamerule, the absence of `sleepTimeoutMs` overrides.
Static trace only: the `MAX_ENTRY_ATTEMPTS` exhaustion arithmetic and the Builder-survives conclusion —
read, not driven end to end.
