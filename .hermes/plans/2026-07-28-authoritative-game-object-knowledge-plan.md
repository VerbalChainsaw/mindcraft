# Codeplan: Authoritative game-object knowledge

## Contract and safety
- Required behavior: the bot can identify Minecraft items and blocks from the active server registry and reason about tools, drops, recipes, food, durability, placement, and carried capability without a handwritten template per object.
- Acceptance criteria: one read-only command resolves a canonical item/block, reports server-version facts, lists compatible harvest tools and drops, summarizes crafting recipes and inventory context, and offers bounded suggestions for unknown names.
- Must preserve: Minecraft state as authority, bounded prompt output, no network dependency, no invented facts, command validation, and existing action/result paths.
- Out of scope: encyclopedic prose, every mod-specific semantic interaction, automatic execution of arbitrary multi-step plans, UI, and live testing.

## Repository evidence
- the active Mineflayer registry already contains version-correct items, blocks, foods, durability, harvest tools, and drops.
- `minecraft-data` already exposes crafting recipes and recursive crafting plans.
- these facts are currently scattered behind action internals; the model has `!inventory`, `!craftable`, and a crafting-plan query but no general object inspection boundary.
- the network wiki query is not a reliable core gameplay dependency and returns unbounded prose.

## Candidates
- V1 `wiki-first`: improve remote Minecraft Wiki retrieval. This remains network/version fragile and is not authoritative for the connected server.
- V2 `registry-first`: expose a compact structured summary from the active registry, using the existing recipe database and inventory.

## PLAN-OUT
[codeplan · authoritative-game-object-knowledge · PLAN-OUT · mode: constrained · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.51;V2=0.94 · reason: active registry data is local, version-matched, bounded, and authoritative, allowing the model to compose general gameplay plans without one template per item · planned-fingerprint: new-module,request-driven,validated-input,graceful-degrade]

## Implementation
- Add a read-only game-knowledge adapter over the active bot registry and existing recipe helpers.
- Include canonical identity, inventory/held state, food, durability/repair, placement, block physics, light, drops, compatible carried/known tools, recipe alternatives, and inferred capability tags.
- Add one bounded `!inspectMinecraft` query to the normal command documentation surface.
- Re-read changed contracts and run source diff formatting only.

## EXEC-OUT
[codeplan · authoritative-game-object-knowledge · EXEC-OUT · implemented: V2 · confidence: high · verification: source-only · mechanism-check: passed · plan-history: unchanged · evidence: inspected active-version registry data, query wiring, recipe helpers, inventory context, unknown-name fallback, and output bounds; focused diff formatting passed; runtime intentionally not queried]
