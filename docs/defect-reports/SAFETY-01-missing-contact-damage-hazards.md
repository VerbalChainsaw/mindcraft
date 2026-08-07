# SAFETY-01 — three contact-damage blocks are missing from the hazard set

**Severity:** the bot will stand in blocks that hurt it, including one that can kill.
**File:** `src/agent/runtime/gameplay-safety.js` — `HAZARDOUS_GAMEPLAY_BLOCKS`.
**Status:** confirmed by registry lookup + predicate trace. Not applied.
**Note:** this is the only finding so far whose fix touches **no file under concurrent edit**.

## The gap

`HAZARDOUS_GAMEPLAY_BLOCKS` currently lists: `lava`, `fire`, `soul_fire`, `magma_block`, `cactus`,
`campfire`, `soul_campfire`, `powder_snow`. Missing:

| block | boundingBox (1.21.11, measured) | effect | confidence | how it slips through |
|---|---|---|---|---|
| `wither_rose` | `empty` | applies **Wither** on contact — can kill | high | passes the occupancy test |
| `sweet_berry_bush` | `empty` | damages an entity **moving** inside it, and slows it | high | passes the occupancy test |
| `pointed_dripstone` | `block` | strongly amplifies fall damage for anything landing on it | high | passes the *support* test |

None of the three appears anywhere else in `src/` as a hazard.

> **Precision notes — these were softened after an assumptions audit.**
> A sweet berry bush damages an entity that *moves* within it, not one standing still; a pathing bot is
> moving, so this is still a real hazard, but "stands in it and takes damage" was imprecise.
> For `pointed_dripstone`, the fall-damage amplification is certain. Whether merely *standing* on a
> stalagmite deals continuous damage is **not verified** — it could not be established from
> `minecraft-data`, which carries no contact-damage semantics. The case for listing it rests on the
> fall-damage amplification, which is enough on its own for a block the bot may deliberately choose to
> stand on.

## How each one slips through

The standing-safety predicate in `skills.js` reads:

```js
    return feet?.boundingBox === 'empty'
        && head?.boundingBox === 'empty'
        && !isHazardousGameplayBlock(feet)
        && !isHazardousGameplayBlock(head)
        && !isLiquidGameplayBlock(feet)
        && !isLiquidGameplayBlock(head)
        && isSafeGameplaySupport(support);
```

**`sweet_berry_bush` / `wither_rose`** — both are `boundingBox: 'empty'`, so they satisfy the
"bot can occupy this space" requirement, and neither is in the hazard set, so
`!isHazardousGameplayBlock(feet)` also passes. A position whose feet block is a berry bush or a wither
rose is therefore judged **safe to stand in**.

Wither is the serious one: unlike starvation (which stops at 1 HP on `difficulty=normal`, this server's
setting), the Wither effect **can kill outright**.

**`pointed_dripstone`** — `boundingBox: 'block'`, so it correctly fails the feet/head occupancy test, but
`isSafeGameplaySupport` only rejects empty, liquid, hazardous, and falling blocks. Dripstone is none of
those by the current lists, so it passes and the bot may deliberately stand **on** a stalagmite, which
deals damage.

## The fix

Add the three names to `HAZARDOUS_GAMEPLAY_BLOCKS`. That is the whole change — every consumer
(`isSafeGameplaySupport`, the feet/head occupancy check, and the other call sites in `skills.js`) reads
through the same predicate, so one additive edit closes all three paths.

Purely additive to a `Set`. No consumer signature changes, no behaviour change for any block already
listed.

## Why the fix goes here and not in the consumers

`src/agent/library/skills.js` holds the consumers and was under active edit by a concurrent writer.
`src/agent/runtime/gameplay-safety.js` — which owns the list — was **not**. Making this a list-only change
keeps it out of the contested file entirely.

## Evidence class

Registry lookups executed against `minecraft-data` 1.21.11 (bounding boxes above are measured, not
recalled). Predicate reachability traced by reading the standing-safety function. Not reproduced against
a live bot — but unlike the branch-ordering findings, this one changes no control flow, so the risk of
landing it is very low.

## Audited nearby and found sound — no action

- `powder_snow` **is** already listed, which is a subtle inclusion and suggests the list was written
  thoughtfully rather than carelessly. These three look like drift, not negligence.
- `isProtectedGameplayBlock` handles `_shulker_box` by suffix, so coloured variants are covered.
- `isFallingGameplayBlock` covers sand, red sand, gravel, all anvil states, and `_concrete_powder` by
  suffix — complete as far as I can tell.
- `solidCover`'s water/lava name guard is redundant (both are `boundingBox: 'empty'`). Harmless.

## Trivial, no action

`src/utils/mcdata.js:180` lists `wither_rose` **twice** in the `mustCollectManually` full-names array.
Harmless — the array is only ever `.includes()`-tested — but it is a real duplicate. Note that this list
is about *how* to collect, not *what* to seek, so it does not by itself send the bot toward wither roses.
