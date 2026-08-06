# Current Minecraft Companion checkpoint
Branch: recovery/iron-pickaxe-20260803
Functional source checkpoint: e210d75 (pushed)
Milestone: owned CollectBlock adjacent pickup repaired; zero-raw eight-iron mining, resurfacing, smelting, return, and exact delivery passed in Paper
Sole writer and Minecraft runtime owner: Codex
Owned subsystem: product-scale capability engine, companion behavior, and world stewardship
Live blocker: natural `use the furnace here` qualifier is discarded at the typed-goal command boundary, so smelting is not bound to the player's worksite
Last physical result: bot acquired 9 raw iron, gathered fuel, smelted 8, returned, and raised WorksitePlayer's ingots 8->16; ordinary Stop then held the runtime
Repository: frozen control remains 4a94cdc; protected untracked files untouched; accidental nested C: path absent
Next campaign: preserve a generic exact-workstation constraint through goal planning and rerun the same request through the existing workshop furnace
Jordan review: requested as C2J-20260806-0535-worksite-locality-after-pickup; runtime Stop-held at the preserved worksite
