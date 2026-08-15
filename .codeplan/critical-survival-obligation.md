[codeplan · critical-survival-obligation · IN · mode: full · confidence: high · candidates: V1 distance-only, V2 SurvivalDirector incident, V3 new escape director · lean: V2 · baseline: V1]

## Confirmed defect

Center-out audit result: `DEFECT_CONFIRMED`.

- Trigger: an exact Mineflayer damage-source receipt causes a reflex-owned
  tactical response.
- Boundary break: `resolveTacticalCombat` reports a spacing increase as
  `skill_retreated`, ActionManager settles that reflex successfully, and no
  owner receives the result as an unresolved survival obligation.
- Downstream effect: the arbiter can resume unrelated work or repeat another
  reflex after the pursuer closes again. A cancelled player rendezvous is
  durable only when it happened to enter Agenda first.
- Adjacent contract failures: the generic eat route used an empty sentinel that
  the command validator forbids; critical waiting monopolized the scheduler and
  suppressed safe gaze; `self.died` telemetry sent fields the event schema
  rejects and was discarded.

The live Paper deaths, structured `skill_retreated` receipts, ActionManager
settlement path, and absent result consumer establish the complete trajectory.
Confidence is high. Blast radius is every critical hostile encounter and any
player rendezvous preempted by it.

## Candidates and gates

- V1 `distance-only`: increase retreat spacing and leave the reflex terminal.
  Gate failure: distance is not a safety objective and a pursuer can reacquire.
- V2 `SurvivalDirector incident`: retain one bounded immutable incident from the
  exact attacker receipt, observe structured reflex results at the existing
  `Agent.recordActionResult` boundary, and keep ownership until the attacker is
  defeated/gone, verified cover is reached, or a non-attacking companion
  rendezvous settles. Spacing is intermediate evidence. Gate pass.
- V3 `new escape director`: add a parallel state machine for combat, cover, and
  help. Gate failure: duplicates SurvivalDirector, ActionManager, Pathfinder,
  and the installed combat package.

Rubric frozen: player-visible safety 35, ownership fit 30, regression surface
20, observability/testability 15. Scores: V1 35, V2 94, V3 48.

[codeplan · critical-survival-obligation · OUT · mode: full · pick: V2 · confidence: high · beatBaseline: yes · reason: existing owner gains the missing cross-boundary obligation without duplicating mechanics · mechanism-check: passed · corrected: none]

## Repair contract

1. Exact damage-source identity is copied into a bounded survival incident.
2. A tactical retreat result advances the incident but never resolves it.
3. A defeated/gone attributed hostile resolves the incident; otherwise the
   existing package-backed paths choose a non-attacking companion rendezvous or
   a verified reachable cover stance.
4. Cancellation/preemption is censored and does not spend the objective.
5. A settled help wait may animate gaze but cannot release unsafe autonomous
   movement.
6. The incident and decision stage are visible in canonical telemetry.
7. Death publishes a schema-valid bounded event instead of losing the record.

## Acceptance

A focused integrated check must prove damage receipt -> reflex retreat ->
unresolved incident -> rendezvous/cover -> verified settlement, including
censored interruption. Existing combat, eating, Agenda, arbiter, and event
contract checks must remain green. No new dependency or custom movement/combat
mechanic is permitted.
