# Current Minecraft Companion checkpoint
Branch: recovery/iron-pickaxe-20260803
Functional source checkpoint: this checkpoint follows pushed source commit 9c865d2
Milestone: bounded voxel binding, verified recovery resumption, anchored support, and staged falling-debris safety are implemented; focused checks pass 8/8
Sole writer and Minecraft runtime owner: Codex
Owned subsystem: deterministic deep acquisition, package-first movement, and bounded inventory/workstation primitives
Live blocker: staged sand-debris excavation is not yet physically reverified because the unsafe predecessor run killed the bot and reset it to surface spawn
Last physical result: generic surface corridors climbed Y37→Y58; anchored sand admitted a six-step route, but unsafe bottom-up overhead clearing caused suffocation and death at 03:33:56
Next campaign: run the unchanged natural clock request from the real respawn state; fix only its first shared blocker until Paper verifies one clock
Jordan review: C2J-20260804-1720-responsive-bucket remains pending
