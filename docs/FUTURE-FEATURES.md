# Minecraft Companion future features

**Status:** living, unprioritized product-idea ledger

**Authority:** this document records desirable future experiences. It does not
claim that a feature exists, authorize implementation, or override
`ARCHITECTURE.md`, `AGENTS.md`, or player authority. (Before 2026-08-17 this
line named MASTER-PROJECT-PLAN.md, PLAYER-COMPLETENESS-ROADMAP.md and the
shared contract spine; all three are archived under `docs/archive/`.)

This list is intentionally incomplete. Add ideas when they improve the fantasy
of a trustworthy, capable Minecraft companion; promote them into the master
plan only when the Director chooses them for active work.

## Product direction

The companion should gradually become more than a command executor. It should
feel like a recognizable resident of the shared world: competent at ordinary
Minecraft, considerate of players and their builds, able to develop habits and
tastes, useful without constant supervision, and capable of cooperating with
other bots without creating duplicate work or chaos.

All future behavior still obeys the existing foundations:

- The Director and player remain in control.
- A bot acts only from real Minecraft state and reports outcomes truthfully.
- Personality, chatter, preferences, and Chaos Mode never bypass safety,
  ownership, Stop, cancellation, or verified gameplay contracts.
- Useful maintenance should be calm and bounded, not an excuse for the bot to
  reshape a player's world without permission.
- New experiences should reuse the existing companion brain, deterministic
  skills, ActionManager, durable goals/jobs, and mature Mineflayer mechanics.

## FF-001 — Decoration and lived-in spaces

Bots can deliberately decorate a room, building, yard, path, camp, or public
area instead of stopping when the functional shell is complete.

Desired experience:

- Understand decoration goals such as cozy, rustic, practical, fortified,
  natural, bright, compact, grand, or kid-friendly.
- Inspect the existing structure, protected blocks, access routes, lighting,
  sightlines, usable fixtures, palette, and available space before proposing a
  decoration pass.
- Prefer coherent palettes and repeated motifs over random block scattering.
- Preserve doors, beds, containers, workstations, windows, paths, redstone,
  spawn safety, and movement clearance.
- Offer a preview or concise bill of materials before a large transformation.
- Support bounded indoor, exterior, landscaping, lighting, furnishing, and
  seasonal decoration passes.
- Verify that every decoration remains usable and that the site is cleaner and
  safer when the work is finished.

## FF-002 — Curated structure-template library

Bots maintain an extensive, versioned library of known high-quality structures
and compositions. A bot should select or adapt a proven design when one fits
instead of guessing an entire structure block by block.

Initial catalogue families should eventually include:

- starter homes, cottages, cabins, longhouses, desert homes, mountain homes,
  stilt houses, treehouses, underground rooms, and compact safe shelters;
- workshops, storage rooms, smelteries, enchanting rooms, potion rooms,
  kitchens, bedrooms, map rooms, trophy rooms, libraries, and shared halls;
- farms for crops, trees, bees, animals, mushrooms, sugar cane, cactus, bamboo,
  kelp, berries, nether wart, and other renewable resources;
- barns, stables, pens, coops, apiaries, greenhouses, granaries, silos, wells,
  docks, boathouses, fishing huts, and market stalls;
- roads, paths, stairs, bridges, tunnels, mine entrances, retaining walls,
  drainage, rail stops, portals, gates, walls, towers, and safe trail markers;
- outposts, watchtowers, guard posts, bunkhouses, expedition camps, emergency
  shelters, and dimension-specific staging areas;
- gardens, ponds, fountains, courtyards, plazas, parks, campfires, monuments,
  statues, and natural landscaping compositions;
- furniture and detail modules such as tables, shelves, counters, chimneys,
  fireplaces, planters, lighting sets, window treatments, roof details, and
  storage walls;
- validated functional redstone or utility modules when the engine can prove
  their state, maintenance needs, and safe integration.

Template requirements:

- Each template has a stable ID, human name, version, supported Minecraft
  versions, dimensions, anchor/orientation rules, palette families, material
  bill, required functions, access and interaction stances, staged build order,
  protected/replaceable assumptions, validation rules, and an exact completion
  audit.
- Variants are explicit: mirrored, rotated, expanded, palette-swapped, terrain
  adapted, furnished/unfurnished, and upgrade tiers.
- Templates can be searched and filtered by function, style, footprint,
  biome, cost, available materials, and player preference.
- Composition is supported: for example, a known cabin plus a known chimney,
  storage wall, garden, and path remains a validated combined plan.
- The library distinguishes trusted/validated templates from experimental or
  player-taught designs. A learned design does not become globally trusted
  merely because it was observed once.
- Template provenance, ownership, compatibility, and revisions survive restart
  and can be exported, shared, deprecated, or rolled back without rewriting
  completed player builds.

Player-facing discovery and teaching should feel conversational. Example
intents include:

- “Show me the houses you know.”
- “What can you build in a 9 by 11 footprint with spruce?”
- “Preview the compact workshop.”
- “Learn this building as Gabriel's fishing cabin.”
- “Show what you understood before saving it.”
- “Save this as a private family template.”
- “Make a copy with a stone foundation and a wider porch.”
- “Update the cabin template from these approved changes.”
- “Forget this experimental template.”

Learning a structure must capture an explicit, bounded region; identify
orientation, materials, air/clearance, fixtures, access, interaction stances,
and functional relationships; show the interpreted blueprint to the player;
and require confirmation before durable publication. It must not scrape an
unknown area, absorb neighboring builds, or mistake damage for intended design.

## FF-003 — Chaos Mode

Bots can enter an explicitly enabled playful-improvisation mode. Chaos Mode is
surprising and funny, not destructive, dishonest, or uncontrollable.

Desired contract:

- Off by default and visibly indicated while active.
- The Director chooses the permitted area, duration, material budget, intensity,
  allowed activity families, and whether player approval is needed per idea.
- Stop and direct player orders take effect immediately.
- Protected builds, storage, pets, named entities, scarce items, progression
  items, farms, portals, redstone, and other players' property remain protected.
- The bot may choose unusual but legal goals, styles, routes, jokes, games, or
  harmless builds only inside the permission envelope.
- Every mutation remains attributable, bounded, auditable, and recoverable or
  cleanable where practical.
- Randomness affects choice among valid options; it never replaces feasibility,
  planning, execution, reconciliation, or verified outcome.

## FF-004 — Stable personality

Each bot has a recognizable personality that persists across restarts, model
providers, and ordinary memory compaction.

- Stable traits can shape tone, humor, patience, curiosity, risk tolerance
  within permitted bounds, favorite activities, social style, and aesthetic
  taste.
- Personality colors truthful speech after the factual content is fixed. It
  cannot invent memories, relationships, inventory, motives, or success.
- Traits can evolve slowly from meaningful shared experiences while preserving
  a stable core identity.
- The Director can inspect, tune, reset, or lock personality traits.
- Different bots should feel distinct without becoming caricatures or refusing
  ordinary work because of a preference.

## FF-005 — Preferences and individual taste

Bots can form bounded, inspectable preferences and use them to choose among
equally safe and capable alternatives.

Examples include preferred woods, colors, architectural styles, foods, tools,
jobs, routes, biomes, pets, work hours, conversational tone, or favorite places.
Preferences should be evidence-backed, confidence-weighted, reversible, and
subordinate to player intent, material constraints, safety, and shared-world
stewardship. A bot should be able to explain a preference briefly when asked.

## FF-006 — Natural, bounded chatter

Bots sometimes speak without being prompted so they feel present in the world,
but silence remains normal.

- Chatter reacts to meaningful witnessed events, shared history, nearby players,
  interesting discoveries, danger, progress, weather, time, and completed work.
- Global and per-event speech budgets prevent repetition and noise.
- Bots avoid interrupting active conversation, urgent commands, danger, and
  concentration-heavy work.
- Nearby bots coordinate so they do not all repeat the same observation.
- The factual payload is fixed from verified state before personality supplies
  wording.
- The Director can choose quiet, normal, talkative, or custom chatter levels and
  mute ambient speech immediately.

## FF-007 — Ingrained Director and family identity

Every bot begins with a protected relational identity seed—part of its “DNA,”
not a fragile conversational memory.

- Every bot always knows that **Gabriel is the Director**.
- Every bot always knows **Gabriel Jr.** as a distinct, important family member.
- The relationship facts survive restart, provider changes, memory pruning,
  restored worlds, and newly created bot profiles.
- Provisioned player UUIDs and explicitly approved aliases bind names to actual
  identities; proximity, casual chat, or an LLM guess cannot rewrite them.
- “The Director” resolves to Gabriel consistently, while Gabriel Jr. remains a
  separate person with his own identity, preferences, permissions, and history.
- Bots can explain whom they recognize and what role each person has without
  leaking private identity details into public chat.
- Relationship knowledge and command authority remain distinct. The explicit
  authority policy determines who may issue which orders; affection, familiarity,
  or a matching display name never silently grants Director powers.

## FF-008 — Nature stewardship and repair after harvesting

Bots treat the world as a shared home rather than a disposable resource map.

- Finish the bounded tree they start instead of leaving floating trunks or
  canopies.
- Collect reachable drops and replant a suitable matching sapling when soil,
  spacing, light, ownership, and available reserves permit it.
- Retain an appropriate sapling reserve before consuming or depositing all
  planting stock.
- Avoid unnecessary pits, exposed drops, floating blocks, stripped landscapes,
  orphan scaffolding, and damage to attractive or useful terrain.
- Backfill or safely mark unavoidable excavation near lived-in areas according
  to the site's maintenance policy.
- Preserve old-growth, decorative, named, protected, player-built, or habitat
  trees and landscapes unless explicitly authorized.
- Prefer renewable sources and already-authorized resource areas when the cost
  is reasonable.
- Report when safe restoration cannot be completed rather than pretending the
  site was repaired.

## FF-009 — Structure maintenance and stewardship

Bots can maintain known homes, worksites, infrastructure, and public areas over
time.

- Remember explicit ownership, intended template or audited baseline, function,
  maintenance boundary, and allowed materials for each maintained structure.
- Inspect for missing or damaged blocks, broken access, unsafe darkness,
  depleted fixtures, obstructed interaction stances, exposed hazards, leaks,
  unrecovered scaffolding, and path damage.
- Repair only differences known to be damage or approved wear. Do not “correct”
  a player's deliberate remodel back to an old blueprint.
- Maintain doors, beds, containers, furnaces, crafting areas, lighting, farms,
  paths, bridges, fences, gates, roofs, and other proven functional components.
- Offer maintenance reports and ask before expensive, ambiguous, aesthetic, or
  broad repairs.
- Use budgets, inspection intervals, and hysteresis so maintenance does not
  become constant inventory thrash or unsolicited construction.

## FF-010 — Supplies, backups, and continuous upkeep

Bots can craft, smelt, retrieve, store, equip, replace, and replenish ordinary
supplies as an ongoing bounded responsibility.

Examples include backup pickaxes and axes, food, torches, fuel, blocks, saplings,
seeds, arrows, shields, beds, buckets, boats, rails, repair materials, and other
role-specific supplies.

Desired behavior:

- Maintain configurable minimum, target, and maximum stock levels by bot, role,
  base, worksite, expedition, and shared storage area.
- Derive suggested reserves from demonstrated consumption, travel distance,
  task risk, tool durability, replacement lead time, and scarcity—but require
  player approval before changing consequential policies.
- Reserve a healthy replacement before a tool breaks, switch tools during work,
  and replenish afterward without abandoning the durable player outcome.
- Use authorized storage and existing workstations; preserve unrelated contents
  and respect per-player or per-bot ownership.
- Batch work sensibly, avoid oscillating around thresholds, and stop when the
  material or environmental cost outweighs the configured need.
- Surface shortages, blocked supply chains, and consumption trends truthfully.
- Pause immediately for player work, danger, Stop, or revoked authority, then
  reassess stale needs before resuming.

## FF-011 — Multi-bot teamwork

Bots can cooperate on useful shared outcomes while remaining individually
truthful, interruptible, and understandable.

- Decompose approved work into disjoint assignments with one accountable owner
  for each target, blueprint cell, resource region, container transfer, and
  completion claim.
- Share bounded factual observations, reservations, blockers, progress, and
  handoff receipts without treating another bot's narration as world truth.
- Coordinate builders, gatherers, crafters, haulers, guards, scouts, farmers,
  maintainers, and companions around one player-visible objective.
- Transfer materials at verified containers or direct handoff points and
  reconcile both sides of the transfer.
- Avoid duplicate mining, double crafting, competing container windows,
  collisions, door crowding, friendly fire, and bots waiting forever on one
  another.
- Support formation travel, rendezvous, regrouping, replacement of a failed
  worker, and clean cancellation of an entire squad outcome.
- Preserve per-bot personality, preferences, inventory, memory, and authority
  while sharing only appropriate world and task knowledge.
- Give the Director a concise squad view: who owns what, who is blocked, what
  changed, and whether the overall outcome is still feasible.
- Begin only after the single-companion loop is dependable; scaling cannot be
  used to hide an unreliable individual mechanic.

## Candidate grouping for later prioritization

These ideas naturally form four product horizons, without assigning dates or
implementation order:

1. **Identity and presence:** ingrained relationships, personality, preferences,
   and bounded chatter.
2. **World stewardship:** nature care, structure maintenance, supplies, and
   continuous upkeep.
3. **Creative competence:** decoration, curated templates, conversational
   discovery, and safe template learning.
4. **Expanded play:** bounded Chaos Mode and multi-bot teamwork after one bot is
   consistently dependable.
