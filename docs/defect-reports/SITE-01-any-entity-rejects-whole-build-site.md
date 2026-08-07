# SITE-01 — a single dropped item rejects an entire construction site

**Severity:** can block the outpost campaign, and fails *intermittently*, which is worse than failing.
**File:** `src/agent/runtime/jobs/structure-site-selector.js`.
**Status:** confirmed by code read + registry verification. Not applied.
**Fix size:** two lines inside an existing helper. No new module, no new abstraction.

## What is wrong

`entityOccupies` filters by **no entity type whatsoever**:

```js
function entityOccupies(bot, x, y, z) {
  const center = new Vec3(x + 0.5, y, z + 0.5);
  return Object.values(bot.entities || {}).some(entity => (
    entity?.id !== bot.entity?.id
    && entity?.position
    && Math.abs(entity.position.y - center.y) < 1.8
    && Math.hypot(entity.position.x - center.x, entity.position.z - center.z) < 0.8
  ));
}
```

`bot.entities` contains dropped items, experience orbs, arrows, boats, and item frames alongside players
and mobs. All are treated as occupying.

`inspectSite` then applies it inside the loop over **every** blueprint cell:

```js
    if (entityOccupies(bot, x, y, z)) return null;
```

`return null` rejects the **whole candidate site**, not the cell. So one dropped item anywhere inside the
structure volume disqualifies that site entirely.

## Why this bites the outpost campaign specifically

The bot mines, harvests, and collects around the area it is about to build on. Dropped items and
experience orbs are the normal by-product of exactly the work that precedes construction — the project's
own recent history is largely about drop and pickup handling.

With `DEFAULT_SEARCH_RADIUS = 12` and `DEFAULT_SITE_LIMIT = 16`, a littered work area can knock out every
candidate site and produce a "no viable construction site" outcome whose stated cause looks like terrain
unsuitability rather than debris.

**The intermittency is the real cost.** Items despawn after ~5 minutes and orbs drift toward the player,
so the same anchor can pass or fail on successive attempts with nothing in the world meaningfully
changed. A flaky site rejection is far more expensive to diagnose than a deterministic one, and it will
read as terrain flakiness.

## Why item entities should not count

Item entities and experience orbs have no collision in Minecraft and do not obstruct block placement —
the item simply pops out when a block is placed in its space. *(Game-mechanics claim, high confidence;
not measurable from `minecraft-data`, which carries no collision semantics for entities.)*

Players and mobs **should** keep rejecting the site — those genuinely obstruct placement. The predicate
is right in intent and too broad in scope.

## The fix — reuse the idiom already in the codebase

This project already has a discriminator for dropped items, in `survival-director.js`:

```js
    if (entity?.name !== 'item' || !entity.position || !bot.entity?.position) continue;
```

Apply the same test inside `entityOccupies` — skip entities whose `name` is `item` or `experience_orb`,
and reasonably `arrow`. Verified present in the 1.21.11 registry:

| entity name | exists | registry type |
|---|---|---|
| `item` | yes | `other` |
| `experience_orb` | yes | `other` |
| `arrow` | yes | `projectile` (category `Projectiles`) |

Keep everything else rejecting. That is the entire change: a filter inside one existing helper, using a
predicate the codebase already uses elsewhere.

**Do not** build an entity-classification module for this, and do not widen it into a general collision
system. One helper, one filter.

## Evidence class

Code read is exact (both functions quoted in full above). Entity names verified against `minecraft-data`
1.21.11. The consequence — sites being rejected in practice — is **inferred, not observed**: it was not
reproduced against a live bot, because doing so requires the Minecraft runtime, which belonged to another
writer. The code path itself is unambiguous.

## Audited nearby and found sound — no action

- `clearConstructionCell` guards liquid, hazardous, and protected blocks *after* requiring
  `isReplaceableGameplayBlock`, whose whitelist (airs, grasses, ferns, dead bush, snow, vine) already
  excludes all three. Redundant but harmless belt-and-braces; the same pattern appears in `solidCover`.
  Leave it.
- `naturalSupport` explicitly excludes `_leaves`, which is the right call and notably tighter than
  `isSheltered` in [SHELTER-01](SHELTER-01-roof-only-shelter-and-open-doorway.md) — the same leaf blind
  spot was already thought about here. Good sign the two were written at different times rather than
  carelessly.
- The bot-inside-the-footprint rejection (`inspectSite`, the `botPosition` bounds test) is correct and
  necessary — the bot cannot build the volume it is standing in.
- `clearanceLimit` bounding "clearable natural terrain" with a documented rationale prevents a buried
  volume from winning on support alone. Deliberate and sound.
