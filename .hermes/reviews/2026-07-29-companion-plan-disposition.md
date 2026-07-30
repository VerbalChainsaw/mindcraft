# Companion Plan Review Disposition

Plan: `.hermes/plans/2026-07-29_124834-companion-gameplay-baseline.md`
Date: 2026-07-29

Raw reviews:

- `.hermes/reviews/2026-07-29-companion-plan-architecture-raw.md`
- `.hermes/reviews/2026-07-29-companion-plan-verification-raw.md`

No review finding below was accepted solely on reviewer assertion. Critical/major claims were checked against the current dirty source tree or installed SDK source before disposition.

| ID | Finding | Source check | Disposition | Plan correction |
|---|---|---|---|---|
| A1 | Generation alone cannot stop stale global cleanup from killing a successor | Confirmed in `agent.js:352-358,882-885`, `skills.js` cleanup, `action_manager.js` | Accepted, release blocker | Added generation-scoped gameplay resource lease and mandatory settle-before-successor cancellation order |
| A2 | PvP and navigation supervisor would concurrently own Pathfinder | Confirmed in installed `mineflayer-pvp/lib/PVP.js:60-74` | Accepted, release blocker | PvP is sole leased combat movement adapter; supervisor only observes until PvP fully stops, then performs sequential recovery |
| A3 | PvP timeout removes unrelated `path_stop` listeners | Confirmed at installed `PVP.js:91`; its own callback already cleans itself | Accepted, release blocker | Add patch-package patch removing broad listener deletion plus isolation regression |
| A4 | Version-1 job store cannot preserve a suspended order or compare session identity | Confirmed in `job-state-store.js`, `work-order.js` | Accepted, release blocker | Convert stale companion order once to terminal historical cancellation; preserve as `lastOrder`; do not `save(null)` or invent identity |
| A5 | Combat health/metadata fallback can falsely attribute another actor's damage | Confirmed from event semantics and current skill fallback | Accepted, release blocker | Only `entityHurt(target, source === bot.entity)` is a bot hit; all other damage is unattributed |
| A6 | Racing `goto()` does not cancel/settle it | Confirmed in installed `mineflayer-pathfinder/lib/goto.js:16-64` | Accepted, release blocker | Clear leased goal, await underlying Promise settlement/listener cleanup, then release |
| A7 | `path_reset` reasons need explicit classification | Confirmed in installed Pathfinder source/docs | Accepted | Added observational/recoverable/terminal event table |
| A8 | CollectBlock is a hidden movement owner | Confirmed at `skills.js:2064-2070` and plugin contract | Accepted, release blocker | CollectBlock is sole leased movement adapter for selected-block operation; no supervisor pre-route; cancel and settle before release |
| A9 | Hold semantics would break when replacing blanket `reflex` | Confirmed in `action_manager.js:140-155` | Accepted | Emergency survival alone bypasses hold; defense/background do not; fresh player command atomically releases hold |
| A10 | Current timeout cannot terminate uncooperative SDK work | Confirmed in `action_manager.js:69-99,371-377` | Accepted, release blocker | AbortSignal/context plus resource-specific force cancellation; keep lease/hold until settlement or block successor |
| A11 | Proposed jump rule could not select the original body-level obstruction and did not prove jumping | Confirmed against plan and geometry case | Accepted | Added one-block step geometry, vertical excursion, landing/elevation evidence, and separate level-forward branch |
| A12 | Removing door interval could regress door navigation | Confirmed existing helper and upstream Pathfinder warning | Accepted | Retain only as bounded lease-scoped wooden-door helper until live fixture disproves need |
| A13 | Sparse companion runtime currently normalizes balanced/simple | Confirmed in `behavior-config.js`; local profile is sparse | Accepted | Role-scoped command/jobs-off normalization for companion |
| A14 | Shared defaults can break non-companion roles | Confirmed profile inheritance and role scheduler | Accepted | Activate local profile first and add non-companion profile matrix before shared-default edits |
| A15 | Full chat can expose commands or execute leading slash | Confirmed current `remaining` handling and Mineflayer unsplit slash-command branch | Accepted | Strip internal command syntax and neutralize ordinary leading slash before full delivery |
| A16 | Registry writes are unrelated scope | Review and final re-review did not account for the active operator requirement | Rejected | Higher-priority laboratory policy requires substantial workstream registration in JSON and SQLite; kept isolated in Task 0 and excluded from gameplay pass/fail |
| A17 | Larger blueprint should wait for locomotion | Confirmed complexity | Accepted | Gate A precedes interactions; baseline blueprint reduced to exact 3–5 cells; larger structure deferred |
| A18 | Friendly state enum can drift | Confirmed existing owner/action/result telemetry | Accepted | Removed second authoritative state enum; expose raw owner/generation/lease/subphase |
| V1 | Current verifier can pass forged `ActionResult` | Confirmed at `verify-behavior-runtime.mjs:170-178` | Accepted, release blocker | Material assertions require Paper oracle; self-report-only pass forbidden |
| V2 | Dashboard/full-state evidence is circular | Confirmed in state pump/full state | Accepted, release blocker | Cross-check Paper console/server logs; bot telemetry diagnostic only |
| V3 | Sub-second dual ownership can occur between one-second samples | Confirmed state-pump interval and recovery pulse durations | Accepted | Append-only monotonic lease/actuator event ledger retained across samples |
| V4 | Owner scalar does not prove physical ownership | Confirmed direct plugin/internal actuator mutation | Accepted | Instrument lease adapters; reject/log unleased critical actuator mutation |
| V5 | Position delta can be externally caused | Valid verification-design concern | Accepted | Require causal control interval plus Paper trajectory; isolate fixtures from knockback/water/pistons/teleports |
| V6 | Horizontal displacement can falsely prove jump | Confirmed missing criterion | Accepted | Require positive vertical excursion and landing/final elevation gain |
| V7 | `entityDead` does not prove final bot attribution | Confirmed SDK event semantics | Accepted | Distinguish `defeated_after_bot_hit`, `killed_by_bot`, unattributed death, and target loss |
| V8 | Inventory delta can be unrelated to selected block | Confirmed missing correlation | Accepted | Exact block transition + slot delta + drop/pickup correlation where available; clear contamination sources |
| V9 | Pre-existing blueprint cells can pass | Confirmed initial plan | Accepted | Live target cells start replaceable/not-correct; require correlated per-cell update and exact state/properties |
| V10 | Sender-side chat spy does not prove receipt | Confirmed verifier/current output path | Accepted with bounded scope | Unit-test chat/whisper SDK contract; live normal chat reconstructed from Paper log chunks; whisper live receipt deferred absent receiver client |
| V11 | Lifecycle stop can masquerade as gameplay stop | Confirmed existing verifier cleanup | Accepted | Stop acceptance keeps bot connected; 2-second actuator quiescence plus 10-second resume-free hold |
| V12 | Idle authority misses transient unauthorized attempts | Confirmed sampling gap | Accepted | Lease ledger must show no unauthorized mutating attempt, even if no world change |
| V13 | Follow can start inside tolerance and pass without movement | Confirmed missing threshold | Accepted | Start outside tolerance; require at least eight blocks horizontal travel and final-distance evidence |
| V14 | Corner fixture was optional/non-reproducible | Confirmed | Accepted | Exact mandatory block/pose/yaw/blocked/escape regions and reset procedure |
| V15 | Runtime cases/fixtures/player option/server setup are absent today | Confirmed in current case file/verifier | Accepted as implementation work | Task 8 now defines schema, `--player`, fixture origin, setup/reset/query/cleanup, and Paper command oracle |
| V16 | Exact evidence schema and sequence integrity are missing | Confirmed | Accepted | Require schema version, IDs/hashes, monotonic event sequence, subsystem sections, cross-oracle assertions, stale/gap rejection |
| V17 | “Where repeatable” permits lucky passes | Confirmed wording | Accepted | Three consecutive reset passes for every listed variant; any failure fails variant |

## Review result

- Check 1 (source/SDK): PASS for plan assumptions; live movement A/B remains an implementation-time empirical gate.
- Check 2 (architecture): Initial draft NO-GO; revised plan GO to begin implementation. Task 1 authority/profile/persistence tests are first; Task 2 lease/cancellation tests are the first movement-architecture blocker.
- Check 3 (verification): Initial draft NO-GO; revised plan GO to build the verifier, but product release remains NO-GO until independent Paper-backed live Gates A–C pass.
- Final convergence review: GO to begin implementation; no unresolved plan-level gameplay blocker. Raw output: `.hermes/reviews/2026-07-29-companion-plan-final-rereview.md`.

This disposition does not claim the gameplay implementation already works. It records why the revised plan is technically viable and where execution must stop if evidence contradicts it.
