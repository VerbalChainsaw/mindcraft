[codeplan · session34-held-surface-stance · IN · mode: full · confidence: high · candidates: V1 mode-inline mode-state, V2 reflex-action action-serialized, V3 arbiter-stance instance-state · lean: V3 · baseline: V1]

## Decision boundary

Triviality gate: trivial: no · continue. Live Session 34 evidence shows a
held companion repeatedly reaches full air in open water, releases native
`jump`, and then passively sinks until the oxygen threshold authorizes another
emergency action. A durable fix crosses physical-control, Operator Hold,
human-presence, cancellation, and safe-unload lifecycle boundaries.

Repair revalidation: `INVARIANT_HOLDS`. Flight
`flight-2026-08-13T02-10-46-578Z-52239-000.jsonl` ends held at
`(13593.5,59.81,13184.5)` with Water at the head after a successful
`skill_drowning_escape_breathable_surface`. Current `modes.js` waits until
oxygen is at most 12, current `escapeDrowning` clears `jump` in `finally`, and
BehaviorArbiter then selects Operator Hold. Stop did not permanently suppress
self-preservation; a later reflex succeeded, so the repair must target durable
held posture rather than Stop cancellation.

## Repository calibration

- Package-first: Mineflayer 4.37.1 owns the native control primitive and
  Pathfinder 2.4.5 owns routed swimming. The installed packages expose no
  persistent stationary surface-hold goal. Use one thin native-control adapter;
  do not create path planning, swimming, or a parallel movement engine.
- Authority: BehaviorArbiter already owns Operator Hold, authoritative human
  roster evidence, emergency-before-Hold priority, and zero-human unloading.
- Safety: Hold must remain persisted; mortal reflexes still preempt; missing
  roster evidence fails closed; later player authority must release posture
  synchronously before physical work.
- Verification: existing tests use `node:test`, injected agent/bot stubs, and
  decision-trace assertions. Add only the focused failing-before posture and
  lifecycle checks plus one unchanged live replay.
- Scope: no Pathfinder, distance/settlement, shore search, natural-language
  grammar, dependency, schema, Agenda, GoalDirector, or world-geometry change.

## Variants and gates

### V1 — mode-inline / mode-state

Teach `self_preservation.update` to keep `jump` asserted while Operator Hold is
active with a human online and the body is in open water; store cleanup state
on the mode.

G: pass. It can satisfy the posture contract with no dependency, but it
duplicates roster/terminal-Hold lifecycle judgment inside the physical reflex
layer and makes cleanup timing harder to correlate with Hold release.

### V2 — reflex-action / action-serialized

Run a long-lived `mode:self_preservation` ActionManager action that maintains
native ascent until Hold or human presence ends, then clears controls and lets
deferred player authority resume.

G: pass. It preserves serialization, but an indefinite emergency action sits
in front of the existing Hold/unload lane and requires extra presence-aware
termination logic. It creates the largest cancellation and unload blast radius.

### V3 — arbiter-stance / instance-state

BehaviorArbiter owns a tiny held-surface posture state. After mortal modes and
authoritative roster observation, it reasserts Mineflayer's native `jump` only
for terminal Operator Hold + at least one human + open water. It releases only
the control it owns when the predicate changes. `releaseOperatorHold` invokes
synchronous cleanup before later player work.

G: pass. This uses the existing owner of all required authority evidence,
keeps routed swimming and drowning rescue unchanged, and makes presence/Hold
cleanup directly testable.

## Divergence proof

- V1 vs V2: mode-local state and tick control versus a serialized long-lived
  ActionManager action.
- V1 vs V3: self-preservation module ownership versus BehaviorArbiter
  instance-state ownership and existing roster evidence.
- V2 vs V3: action lifecycle/cancellation versus non-action posture state with
  synchronous authority cleanup.

## Frozen rubric

Rubric frozen: axes [Style fit, Package-first ownership, Authority/lifecycle safety, Campaign methodology, Testability/receipts, Compatibility, Blast radius] · weights [1,3,3,2,2,2,1] · denominator = 70 · denominator-policy [uniform-N/A-only] · baseline-algo [lowest-effort gate-passer with no score of 1 on any quality axis]

freeze: axes=Style fit,Package-first ownership,Authority/lifecycle safety,Campaign methodology,Testability/receipts,Compatibility,Blast radius weights=1,3,3,2,2,2,1 denom=ΣW×5 baseline=lowest-effort-gate-passer

## Scoring

| Axis | W | V1 mode-inline | V2 reflex-action | V3 arbiter-stance |
|---|---:|---:|---:|---:|
| Style fit | 1 | 4 | 4 | 4 |
| Package-first ownership | 3 | 3 | 4 | 4 |
| Authority/lifecycle safety | 3 | 4 | 3 | 5 |
| Campaign methodology | 2 | 4 | 3 | 5 |
| Testability/receipts | 2 | 3 | 4 | 4 |
| Compatibility | 2 | 4 | 3 | 4 |
| Blast radius | 1 | 4 | 2 | 3 |
| Effort | — | low | high | medium |
| Weighted total | — | 51 | 47 | 60 |
| Normalized | — | 0.729 | 0.671 | 0.857 |

Arithmetic was verified with the frozen common denominator of 70. V1 is the
algorithmic baseline: lowest effort and no score of 1 on a quality axis. V3
beats it by keeping human-presence and Hold-release judgment in their existing
owner while delegating the only physical primitive to Mineflayer core.

## Selected implementation and verification

Implement V3 only:

1. Add BehaviorArbiter instance state and one narrow update/release pair for
   the terminal held surface stance.
2. Qualify with terminal Operator Hold, authoritative `human_player_online`,
   an in-water body, and no stable dry support. Assert only native `jump`.
3. Release the owned `jump` control on human absence, dry support, lifecycle
   stop, and synchronously from `Agent.releaseOperatorHold`.
4. Trace the posture as Operator Hold detail/state; do not emit an ActionResult
   or claim a routed movement success.
5. Add focused tests for active posture, human-absence cleanup, and Hold-release
   cleanup. Replay the unchanged Session 34 family request once.

## Verification result

Implemented the selected arbiter-stance / instance-state mechanism without
mechanism drift. Focused tests pass 31/31. The unchanged live family replay
held 40 samples for eight seconds with zero horizontal drift, Water at the
legs, Air at the head, health/hunger 20, no inventory or terrain change, and
clean zero-human unload. Evidence is retained in
`flight-2026-08-13T02-20-35-254Z-53754-000.jsonl` and the Session 34 closeout in
`docs/coordination/CURRENT.md`.

[codeplan · session34-held-surface-stance · OUT · mode: full · pick: V3 · confidence: high · beatBaseline: yes · scores: V1 0.729, V2 0.671, V3 0.857 · reason: existing Hold and roster owner can maintain one native surface control with explicit lifecycle cleanup · mechanism-check: passed · corrected: none]
