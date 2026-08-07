# SLEEP-02 — the hostile pre-check duplicates mineflayer, anchored to the wrong point

**Severity:** intermittent false pass; causes a wasted walk and an unclassified failure.
**File:** `src/agent/library/skills.js`, function `goToBed`.
**Status:** confirmed by executed repro. Not applied. Do after [SLEEP-01](SLEEP-01-night-not-skipped-force-wake.md).

> ⚠ Line numbers drift. Anchor on the quoted code strings.

## What is wrong

Anchor:

```js
    const hostile = bot.nearestEntity?.(entity => mc.isHostile(entity));
    if (
        hostile?.position
        && hostile.position.distanceTo(bot.entity.position) <= 12
    ) {
```

This measures the hostile's distance from the **bot**, not the **bed**, and never re-runs after
`navigate` returns.

Failure shape: bot 30 blocks from the outpost, hostile 3 blocks from the bed but 33 from the bot. The
gate passes, the bot walks the whole way, and `bot.sleep()` is rejected on arrival.

## The package already does this correctly

The installed mineflayer performs a proper bed-anchored check in
`node_modules/mineflayer/lib/plugins/bed.js:133-146`:

- `monsterRange = [7, -8, -8, 7]`
- builds a box from `headPoint.offset(...)`, spanning −6/+4 vertically
- scans `bot.entities` for `kind === 'Hostile mobs'`
- throws `'there are monsters nearby'`

So the project's check is a **weaker, wrongly-anchored duplicate of a capability the package already
has**. Under the repo's package-first rule, custom mechanics need live evidence the package cannot do
the job. Here it plainly can, and does it better.

## What to change

Let mineflayer own the **decision**. Keep the project's pre-check only as a cheap early-out — so the bot
does not walk 30 blocks to an obviously unsafe bed — and in that role:

- anchor it at the **bed** position (already in hand as `loc` / `target`) rather than the bot;
- treat it as advisory, never as the authority;
- do not reimplement mineflayer's box — the existing simple radius is fine for an optimisation.

**Do not build a new mob scanner.** The same wrong anchoring exists in
`src/agent/runtime/survival-director.js` (`safe: threatDistance > 12`, measured from the bot); fix it the
same advisory way if you touch it, or leave it — it is not on the campaign path.

## Verification

```bash
node docs/defect-reports/repro/sleep-hostile-gate-anchoring.repro.mjs
```

Now: hostile 33 from bot / 3 from bed → gate **passes**, sleep attempted, `outcome: 'sleep_rejected'`.
After the fix: rejected early by the bed-anchored pre-check, or classified distinctly per
[SLEEP-03](SLEEP-03-rejection-outcome-classification.md).

## Evidence class

Executed proof: the gate clearing an unsafe bed, and mineflayer's own check (read from the installed
package, not assumed).
