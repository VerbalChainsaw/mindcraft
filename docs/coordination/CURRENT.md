# Current Minecraft Companion checkpoint
Branch: recovery/iron-pickaxe-20260803
Functional source checkpoint: native drop-pickup queue (this commit; pushed)
Milestone: owned bounded CollectBlock queues now cover connected trees and dropped-item batches
Sole writer and Minecraft runtime owner: Codex
Owned subsystem: package-first collection, typed goal lifecycle, and deterministic resumption
Live blocker: generic multi-block collection and outer defensive engagement still duplicate package loops; bucket campaign is pending
Last physical result: one native queue picked up 2 iron ingots, 1 oak log, and 3 bread in 3.339s; Paper/state deltas exact
Next campaign: consolidate generic block collection and defensive engagement primitives, then resume bucket progression
Jordan review: requested as C2J-20260804-1515-owned-collection
