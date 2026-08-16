# Scenario Lab decisive replay — 2026-08-03

## Decision

Continue the machine-brain program, but keep the architecture freeze in force. This result validates the bounded Scenario Lab adapter and the current stone-recovery controller on one frozen replay. It does not establish cross-seed generalization, complete A0, or authorize EvidenceFrame/TaskGraph/concurrency work.

## Frozen inputs

- Candidate commit: `4c6ab2ea2bb8e8e7ef99f2c1cdbdbd8e042cee44`
- Branch: `architecture/machine-brain-v2`
- Scenario: `autonomous-wood-to-stone-no-safe-stance-recovery`
- Seed: `8781215452871762684`
- Paper: 1.21.11, protocol 774
- Fixture archive SHA-256: `535b4ab9da8c39837008a0b18be9eb21f88131d01931aed2291f24abe2d97fd0`
- Gameplay file: `src/agent/library/skills.js`
- Gameplay-file SHA-256: `cc524c4ceafccb4b850b7f3e65bb705e5e843e2268f94afa3d11052e4d3a21a5`
- Manifest revision/hash: `release-0.1.v3` / `f9a240c0b91d61c6fe3ebaec197621c4eda1c4c86b73dd7553a6bc29c839db0b`

## Outcome

| Form | Route | Duration | Physical result | Evidence |
|---|---|---:|---|---|
| Direct | `explicit-command` | 38,818 ms | Stone pickaxe produced and equipped; health/hunger 20/20 | Complete |
| Natural language | `deterministic-nl` | 29,796 ms | Stone pickaxe produced and equipped; health/hunger 20/20 | Complete |

Both invocations began from independent frozen restores with a wooden pickaxe and no stone/cobblestone. Both observed 12 unreachable cobblestone candidates as `no_safe_stance`, selected bounded mining recovery, moved physically, acquired the needed cobblestone, crafted/equipped the stone pickaxe, and ended idle in command-only mode. There were zero external retries, deaths, conflicts, timeouts, false-success observations, or safety violations.

All seven declared evidence markers were present: bounded recovery, canonical outcome envelope, direct correlation, deterministic-NL correlation, no-safe-stance observation, wooden stage, and stone stage. Configuration, server properties, and pre-run memory were restored; post-run worlds/memory were preserved; no managed Java process remained.

## Preserved artifacts

- `autonomous-wood-to-stone-no-safe-stance-recovery.result.v1.json`: canonical closed-world verdict.
- `run-summary.v1.json`: per-invocation action IDs, routes, durations, evidence, and process outcomes.
- Full raw samples, worker reports, logs, and post-run worlds remain in the JordanWorkspace task artifact `minecraft-scenario-lab-adapter-20260803/live-scenario-20260803-090821`.

## Next gate
