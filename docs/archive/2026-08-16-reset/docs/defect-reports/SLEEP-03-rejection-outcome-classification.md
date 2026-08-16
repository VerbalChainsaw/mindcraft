# SLEEP-03 — every sleep rejection collapses into one unusable outcome

**Severity:** the retry cannot be steered and the campaign receipt does not read truthfully.
**File:** `src/agent/library/skills.js`, function `goToBed`.
**Status:** confirmed. Not applied. Do after [SLEEP-01](SLEEP-01-night-not-skipped-force-wake.md).

> ⚠ Line numbers drift. Anchor on the quoted code strings.

## What is wrong

Anchor:

```js
        setActionEvidence(bot, {
            kind: 'sleep',
            outcome: 'sleep_rejected',
```

Every rejection lands as `sleep_rejected` with `retryable: true` and the real cause only in a free-text
`error` truncated to 180 characters. "Monsters nearby" is retryable given time and distance; "not a bed
block" never is. They are currently indistinguishable.

Separately, `sleep_timeout` has **zero consumers** anywhere in `src/` or `tests/` — nothing branches on
it. The failure class is inert.

## The exact strings to classify against

Read from the **installed** `node_modules/mineflayer/lib/plugins/bed.js`. Do not guess these, and re-read
them if mineflayer is ever upgraded.

> The message text and line numbers are **measured** from the installed package. The "retryable?" column
> is **my judgement**, not something mineflayer states — treat it as a starting proposal and adjust it
> against how the agenda actually wants to spend `MAX_ENTRY_ATTEMPTS`.

| mineflayer error | line | retryable? | note |
|---|---|---|---|
| `there are monsters nearby` | 143 | yes | retry with time and distance |
| `the bed is occupied` | 93 | yes | another sleeper |
| `it's not night and it's not a thunderstorm` | 82 | yes | wrong time |
| `the bed is too far` | 131 | yes | reposition and retry |
| `cant click the bed` | 115 | yes | transient |
| `there's only half bed` | 109 | **no** | broken fixture |
| `wrong block : not a bed block` | 86 | **no** | bad binding |
| `already sleeping` | 84 | **no** | state desync |
| `already awake` | 69 | **no** | state desync |
| `bot is not sleeping` | 159 | **no** | state desync |

## What to change

Map these to distinct `outcome` values and set `retryable` per the table, instead of one blanket
`retryable: true`. Match on the message text from the installed package — that is the contract mineflayer
actually offers.

Keep the free-text `error` field as well; it is useful when an upgrade introduces a message not in the
table. An unmatched message should fall back to today's behaviour (`sleep_rejected`, retryable) so an
upgrade degrades rather than breaks.

Give `sleep_timeout` a consumer, or accept explicitly that it is advisory-only — right now it is neither.

## Why this matters beyond tidiness

`agenda-director.js` `directSettlement` reads `retryable` straight off this evidence, and
`MAX_ENTRY_ATTEMPTS = 2` decides whether the entry retries or goes terminal. A non-retryable cause like a
bad binding currently burns both attempts pretending it might recover; a genuinely retryable cause gets
the same two shots and no more. Classification is what makes that budget mean something.

## Evidence class

Executed proof: the collapsed outcome, and the mineflayer strings (read from the installed package).
Static trace: the `directSettlement` / `MAX_ENTRY_ATTEMPTS` interaction.
