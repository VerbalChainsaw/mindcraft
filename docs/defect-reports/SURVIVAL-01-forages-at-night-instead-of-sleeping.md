# SURVIVAL-01 — a hungry idle bot forages in the dark instead of sleeping

**Severity:** player-visible. Fires during ordinary companion play, not just campaigns.
**File:** `src/agent/runtime/survival-policy.js` (`chooseSurvivalIntent`).
**Status:** static trace (not observed live). Not applied.

## What happens

`chooseSurvivalIntent` is a first-match waterfall. Hunger is evaluated at the very top; the night/sleep
branch sits far below it and is only reached if nothing above matched.

- Hunger check: `if (hunger <= numeric(policy.eatAt, 14))` — **line 58**
- Sleep check: `policy.mode === 'full' && policy.sleep === 'safe' && night && ...` — **line 181**

So for an **idle bot at night with hunger ≤ 14 and no safe food in inventory**, the waterfall returns:

```js
      return {
        kind: 'acquire_food',
        targetFoodPoints: Math.max(24, reserve),
        reason: 'missing_safe_food',
      };
```

which `survival-director.js` dispatches as:

```js
        ? `!prepareFood(${Math.max(6, Math.floor(Number(intent.targetFoodPoints) || 24))}, 64)`
```

**`!prepareFood(24, 64)` — active foraging with a 64-block radius, at night.** The sleep branch is never
evaluated, because the function already returned.

## Why this is wrong

Sleeping is strictly the better play here, and it is what a competent player does:

- hunger does not deplete while asleep, so the pressure that triggered foraging pauses;
- the bot wakes at dawn, when foraging is actually safe;
- foraging 64 blocks out in the dark is the single most dangerous thing a survival bot can do.

The bot is choosing the riskiest available action at the riskiest time, to solve a problem that sleeping
would defer until it is safe.

Default `eatAt` is 14, so hunger ≤ 14 is not an edge case — it is where a bot sits after an ordinary day
of activity. This will fire often.

## Compounding factors

- `TACTICAL_FOODS` (`golden_apple`, `enchanted_golden_apple`, `golden_carrot`) are filtered out unless
  `critical`. A bot carrying *only* golden carrots therefore counts as having no safe food and goes
  foraging at night rather than eating one.
- It makes the sleep defects worse: on a hungry night the bot may never attempt sleep at all, so
  [SLEEP-01](SLEEP-01-night-not-skipped-force-wake.md) is not even reached.

## Scope — read this before ranking it

This fires only when the bot is **idle** (`if (situation.idle !== true && !critical) return null;`
guards the non-critical path). Mid-campaign the agenda holds the bot non-idle, so it is not a
construction-campaign blocker.

That makes it a **normal companion-play** defect rather than a campaign one — which is arguably the more
important surface, since that is the mode the bot spends most of its time in.

## Correction shape

Order matters more than mechanism: a safe, reachable bed at night should outrank non-critical foraging.
Critical hunger should still win — that ordering is correct and should not change.

Options, in preference order:

1. Move the night/sleep branch above the non-critical hunger branch, keeping `critical` hunger on top.
2. Or gate `acquire_food` on `!night`, letting the waterfall fall through to sleep and re-evaluating
   hunger at dawn.

Do not add a new night-safety subsystem. This is a branch-ordering correction in one function.

## Evidence class

**Static trace only.** The line references and the dispatched command string are exact, but this was not
reproduced against a live bot. Worth confirming with a live idle-at-night observation before landing,
since the fix reorders a survival waterfall that other behaviour depends on.

## Audited and found sound — no action

The food safety model itself is well built and should not be touched:

- `UNSAFE_FOODS` lists exactly the genuinely harmful items (`chicken` = raw chicken, `poisonous_potato`,
  `pufferfish`, `rotten_flesh`, `spider_eye`, `suspicious_stew`) and correctly does **not** blacklist
  other raw meats, which are merely inefficient rather than harmful.
- `TACTICAL_FOODS` reservation-until-critical is a deliberate and sensible policy.
- `isNightTime` (12542–23460) is shared with a comment explaining why it is shared — and it is the same
  boundary used to size [SLEEP-01](SLEEP-01-night-not-skipped-force-wake.md).

Separately noted, **not** raised as a requirement: `rotten_flesh` is excluded even when `critical`, so a
starving bot holding only rotten flesh will not eat it. On this server (`difficulty=normal`) starvation
stops at 1 HP rather than killing, but 1 HP at night is effectively fatal. A real player would eat the
rotten flesh. The existing `critical` mechanism already unlocks `TACTICAL_FOODS` and could unlock
survivable-but-unpleasant foods the same way. Unobserved; record only.
