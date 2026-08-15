[codeplan · campaign66-material-clarification · IN · mode: full · confidence: high · candidates: V1 prompt-only clarification marker (advisory), V2 recipient phrase special-case (deterministic-narrow), V3 typed clarification-to-Agenda contract (shared-intent) · lean: V3 · baseline: V1]

## Boundary and hard gates

Paper proved that “Give one of us the Bread, then wait here” was reduced to one
direct `givePlayer(DadPlayer)` action: requester substitution occurred before
execution, the terminal wait clause was lost, and the truthful delivery was
followed by unrelated survival movement. The correction must permit a question
without weakening command enforcement for unambiguous action requests, prevent
all custody/movement before the answer, bind an exact loaded identity, preserve
the original item/quantity/terminal disposition, use the existing durable
Agenda and GoalDirector, and retain native item transfer and verification.

- V1 adds primer prose and accepts `[CLARIFY]` model output. **Gate fail as the
  complete repair:** it permits the question but leaves answer binding and the
  terminal wait to another unstructured model turn.
- V2 recognizes only “one of us” and asks a hardcoded question before resuming
  the old direct-command path. **Gate fail:** the old path still discards the
  terminal clause and the mechanism does not generalize beyond one phrase.
- V3 adds a bounded material-ambiguity record at the existing player-intent
  boundary. A supported ambiguous transfer captures exact carried item,
  quantity, requester, candidate identities, and terminal disposition; Hold
  prevents action. The requester's exact answer compiles one normalized named
  delivery entry with terminal Hold into the existing Agenda. The always-loaded
  primer and a validated `[CLARIFY]` escape also give the model the same safe
  question option for unsupported material ambiguities. **Pass**.

V3 is the sole mechanism satisfying semantic fidelity, exact custody, safe
inaction, answer correlation, durable execution, terminal authority, package-
first mechanics, and truthful receipts. Pending clarification itself is bounded
session intent rather than durable work: a restart performs no action and the
player can ask again, which is safer than replaying an unanswered ambiguity.

[codeplan · campaign66-material-clarification · OUT · mode: full · pick: V3 · confidence: high · beatBaseline: yes · scores: V3 sole gate-passer · reason: smallest shared pre-execution contract with existing Agenda/native transfer · mechanism-check: passed · corrected: none]
