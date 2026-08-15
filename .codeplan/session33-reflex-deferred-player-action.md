[codeplan · reflex-deferred-player-action · IN · mode: full · confidence: high · candidates: V1 bounded-wait local-gate, V2 pending-slot arbiter-state, V3 agenda-promotion durable-queue, V4 generic-resume persistent-reuse · lean: V2 · baseline: V1]

## Decision

Triviality gate: trivial: no · continue. The defect crosses ActionManager
ownership and BehaviorArbiter scheduling, and cancellation/supersession behavior
must remain truthful.

Calibration was performed directly because this host does not permit unsolicited
subagents. Repository conventions are: ActionManager is the sole serialized
physical-action owner; critical reflexes retain priority; BehaviorArbiter chooses
the next eligible lane; a later manual command cancels older resumable work;
Stop/Hold cancels pending control; ActionResult remains structured; physical
skills stay unchanged. Focused `node:test` checks use strict assertions and
small in-memory agents.

## Candidates and hard gates

- V1 `bounded-wait local-gate`: make the incoming command await reflex release
  inside its own ActionManager call, then acquire normally. G: pass, but bounded
  wait cancellation and multiple simultaneous commands live inside the caller's
  stack rather than the arbiter.
- V2 `pending-slot arbiter-state`: add a one-shot pending player-action mode to
  existing ActionManager resume state; latest manual command and Hold cancel it;
  BehaviorArbiter runs it only after the critical reflex releases; clear it
  after one settlement. G: pass.
- V3 `agenda-promotion durable-queue`: persist transiently blocked direct
  commands as Agenda entries. G: pass, but it changes ephemeral direct-command
  semantics and persisted-plan ordering.
- V4 `generic-resume persistent-reuse`: mark finite commands as ordinary
  persistent resumables and reuse the follow/guard-only lane unchanged. G: fail
  regression gate because successful finite work remains registered and the
  existing lane requires a standing follow/guard directive, so it either never
  runs or can repeat.

Pairwise divergence: V1 uses caller-local control flow; V2 uses ActionManager
instance state plus an arbiter lane; V3 uses the external durable Agenda store;
V4 relies on the existing persistent-resume contract. Each differs in state
location or module boundary.

Rubric frozen: axes [Style, Theme, Methodology, Modernization, Error wrapping,
Testability, Blast radius] · weights [1,2,2,2,2,2,1] · denominator = 60 ·
denominator-policy [uniform-N/A-only] · baseline-algo
[lowest-effort gate-passer with no score of 1 on any quality axis]

freeze: axes=Style,Theme,Methodology,Modernization,Error wrapping,Testability,Blast radius weights=1,2,2,2,2,2,1 denom=ΣW×5 baseline=lowest-effort-gate-passer

## Scoring

| Axis | W | V1 bounded-wait | V2 pending-slot | V3 agenda-promotion |
|---|---:|---:|---:|---:|
| Style | 1 | 4 | 4 | 3 |
| Theme/paradigm | 2 | 3 | 5 | 2 |
| Methodology | 2 | 3 | 5 | 2 |
| Modernization | 2 | 3 | 4 | 4 |
| Error wrapping | 2 | 4 | 5 | 4 |
| Testability | 2 | 4 | 5 | 4 |
| Blast radius | 1 | 5 | 3 | 1 |
| Effort | - | low | medium | high |
| Weighted total | - | 43 | 55 | 36 |
| Normalized | - | 0.717 | 0.917 | 0.600 |

Baseline: V1, the lowest-effort gate-passer without a quality-axis score of 1.
Winner: V2. It keeps safety priority and scheduling in their existing owners,
gives cancellation and supersession one explicit slot, avoids persisted Agenda
semantics, and can be verified without changing any physical skill.

[codeplan · reflex-deferred-player-action · OUT · mode: full · pick: V2 · confidence: high · beatBaseline: yes · scores: V1 0.717, V2 0.917, V3 0.600 · reason: preserves critical reflex ownership while making one accepted finite player action arbiter-resumable and latest-command cancellable · mechanism-check: passed · corrected: none]

## Verification

Repair revalidation: `INVARIANT_HOLDS`. The live zero-duration rejection and
the non-resumable `goToPlayer` path still reproduced before editing. Focused
ActionManager/BehaviorArbiter checks pass 35/35. On Paper, the accepted Dad
order remained pending through `mode:self_preservation`, preserved its original
deterministic request ID and arguments, acquired player ownership two
milliseconds after reflex release, and executed exactly once. A later water
settlement failure is a different mechanic class and does not contradict the
authority repair.
