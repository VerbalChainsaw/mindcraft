# SHELTER-01 — "sheltered" means only "something is overhead", and the emergency shelter has no door

**Severity:** player-visible. The bot believes it is safe at night when it is not.
**Files:** `src/agent/runtime/survival-director.js`, `src/agent/runtime/emergency-shelter.js`.
**Status:** static trace, with a verified registry lookup. Not observed live. Not applied.

## Part 1 — the shelter test is a roof test

```js
function solidCover(block) {
  return Boolean(
    block
    && block.boundingBox === 'block'
    && !['water', 'lava'].includes(block.name),
  );
}

function isSheltered(bot) {
  if (!bot.entity?.position || typeof bot.blockAt !== 'function') return false;
  const origin = bot.entity.position;
  return [2, 3].some(height => solidCover(bot.blockAt(offset(origin, 0, height, 0))));
}
```

Two probes straight up. No walls, no enclosure, no line-of-sight, no door.

Verified against `minecraft-data` 1.21.11 — `oak_leaves` has `boundingBox: 'block'`, so **standing under a
tree satisfies `isSheltered`.** So do fences, glass, slabs, and scaffolding.

That single boolean gates real decisions:

- `survival-policy.js:215` — the whole seek-shelter / build-shelter branch is skipped when
  `situation.sheltered === true`. A bot under a tree at night will neither seek nor build shelter.
- `survival-policy.js:203` — the `no_safe_reachable_bed` → `wait` branch requires `sheltered === true`,
  so the bot settles into waiting out the night on the strength of a leaf block.

## Part 2 — the blueprint leaves a doorway, and the validator enforces it

> **Scope of this claim, after an assumptions audit.** What is *verified* is that the blueprint contains
> no doorway cell and that `validateEmergencyShelterBlueprint` actively **rejects** any blueprint that
> fills it. What is **not verified** is whether the builder seals the opening after the bot enters —
> that would live in `src/agent/runtime/jobs/builder-plan.js`, which was under concurrent edit and which
> this report deliberately does not depend on. Check that before treating the shelter as open in
> practice. The `isSheltered` finding in Part 1 stands regardless.

`EMERGENCY_SHELTER_BLUEPRINT` builds a 3×3×3 box: 7 wall cells each at `y=0` and `y=1`, 9 roof cells at
`y=2`, 23 total. The doorway is carved by `const doorway = x === 0 && z === -1;` and the validator
*enforces* that it stays open:

```js
  return !occupied.has('0:0:-1') && !occupied.has('0:1:-1');
```

So the finished emergency shelter has a permanent 1-wide, 2-tall opening at ground level. Zombies and
skeletons walk straight in; the interior is a 1×1×2 column with nowhere to retreat.

Once the roof exists, `isSheltered` returns true, so the bot considers the problem solved and takes no
further protective action.

## Combined effect

The bot's entire notion of "sheltered" is *something is above my head*. That is exactly right for the
`dangerous_weather` case — a roof does stop a thunderstorm. It is wrong for `unsafe_night`, which is
about mobs, and both cases currently share one predicate and one blueprint.

Net player-visible outcome: the companion announces it is sheltered, stands under a tree or inside an
open-doored box, and gets killed by a mob that simply walks up to it.

## Respect the existing design tension

The cheapness is deliberate, and the code says so:

```js
// Two blockAt probes. Cheap enough to run on every survival sample, and it is
// the only part of the shelter read that the policy consults unconditionally.
```

Do **not** replace this with an enclosure flood-fill on every survival sample. That comment is a
constraint, not an oversight.

## Correction shape

Split the concept rather than making one predicate expensive:

1. Keep the cheap roof probe as the **weather** test — it is correct for that, and it is the one thing
   sampled unconditionally.
2. Add a distinct **mob-safe** test used only on the night path, where the extra cost is affordable
   because it runs at most once per night rather than every sample.
3. Seal the emergency shelter. Either place the doorway block behind the bot after entry, or make the
   entrance a proper door. Note the validator currently *requires* the opening, so it must change with
   the blueprint or it will reject the sealed version.

## Caution for whoever lands this

`src/agent/runtime/jobs/builder-plan.js` imports `EMERGENCY_SHELTER_BLUEPRINT` and was under active edit
by a concurrent writer when this was written. Re-read it before changing the blueprint shape or the
cell count — this report deliberately does not depend on its current contents.

## Evidence class

Static trace, plus one executed check (`minecraft-data` bounding boxes). The blueprint arithmetic
(23 cells, doorway coordinates) was verified by reading the generator against its own validator. Not
reproduced against a live bot — worth one live observation of a bot under a tree at night before landing,
since this changes survival branch behaviour.

## Trivial, no action

In `solidCover`, the `!['water', 'lava'].includes(block.name)` guard is redundant: both report
`boundingBox: 'empty'` in 1.21.11 and already fail the first test. Harmless belt-and-braces. Leave it.
