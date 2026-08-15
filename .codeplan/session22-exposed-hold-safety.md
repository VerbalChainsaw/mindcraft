[codeplan · session22-exposed-hold-safety · IN · mode: full · confidence: high · candidates: V1 held-runtime-grace+self-unload, V2 shelter-proof+pre-hold-movement, V3 equipment-contingency+pre-night-provision, V4 supervisor-player-watch+auto-lifecycle · lean: V1 · baseline: V1]

# Session 22 exposed Operator Hold safety

## Why planning is required

`trivial: no · continue`

The prior post-retreat melee mechanism was physically falsified: package-owned
PvP landed six empty-hand hits, but the bot still fell two blocks and died.
The surviving alternatives cross player authority, environmental judgment, and
process lifecycle. A wrong mechanism can either keep destroying the companion's
inventory or make “wait here” silently mutate the world or move the bot.

## Center Audit repair contract

Claim: `operator_hold_safe` is selected indefinitely after the two mortal
reflex bands are inactive, without evidence that the held body is sheltered or
that any human remains online. The current held gate also prevents
SurvivalDirector from scheduling sleep, shelter, armor, or equipment upkeep.

Expected invariant: when Operator Hold is active, ordinary work stays blocked;
after every human has been absent for a bounded interval, a body with no active
mortal reflex must not remain loaded indefinitely in an unverified stance.
Durable Hold must survive the safe disposition, and later player/dashboard
authority must remain the only way ordinary work resumes.

Falsifier: a current source path proves safe shelter before Hold, or an existing
lifecycle owner already unloads a held zero-human bot without restart.

Evidence trajectory:

- A — real Paper repeatedly killed the held bot near the family home, including
  one full-health, fed, iron-sword-equipped body. The exact controlled replay
  then disproved empty-hand fallback as a survival repair.
- A — manually stopping only the bot removed the loaded body through subsequent
  nights while Paper remained healthy; no further death or inventory loss was
  possible.
- B — `BehaviorArbiter.update` evaluates self-preservation and fresh-hit
  self-defense, then immediately selects `operator_hold_safe`; it reads no
  shelter or player-presence evidence.
- B — `BehaviorDirector.scheduleGate` rejects SurvivalDirector whenever Hold is
  active, and `summarizeSurvivalSituation` deliberately avoids the shelter
  sweep while held.
- B — current `isSheltered` proves only one overhead solid block, while shelter
  candidates are labelled reachable before Pathfinder proof. It is not a
  durable hostile-safety receipt.
- B — `Agent.teardownAndExit(..., 0)` and the existing `!leaveGame` command
  already implement intended graceful self-exit. `AgentProcess._handleExit`
  classifies code 0 as `stopped`, never auto-restarts it, and dashboard Start
  reuses the same owner while restoring persisted Hold.
- I — two independent repository calibrations confirmed the ownership split and
  the hard constraint: use the full Mineflayer tab roster, excluding known bot
  profiles, rather than nearby loaded entities.

Center: the post-reflex Operator Hold disposition in BehaviorArbiter, followed
by existing Agent/AgentProcess lifecycle ownership. Pathfinder, PvP, shelter
construction, and inventory mechanics are downstream or irrelevant to the
selected disposition.

Result: `DEFECT_CONFIRMED`, likelihood `CERTAIN`, impact `HIGH`, confidence
`HIGH`, reproducibility `REPEATED`. The audit does not claim that unloading is
a full shelter system or that the bot can automatically notice a later player
join while stopped.

## Calibration

Repository convention keeps durable authority in the dedicated
`operator-control.json` store, behavior choice in BehaviorArbiter, graceful
shutdown in Agent, and restart classification in AgentProcess. Code is ESM,
uses camelCase helpers, bounded snake_case reason codes, and focused
`node:test` checks. A player roster helper can reuse `Agent.getKnownAgentNames`
and `bot.players`, including distant tab-listed humans whose entity is not
loaded.

## Variants and divergence

### V1 — zero-human grace, then graceful self-unload

Track continuous human absence only for an explicit Operator Stop or a completed
Agenda terminal wait. After a short bounded grace and after both mortal-reflex
bands decline ownership, recheck the full tab roster and call the existing
graceful code-0 teardown. Preserve Hold unchanged. Temporary assignment-
compilation and handoff Holds retain authorized durable work and never unload.

- Advantage: directly prevents unattended loaded-body deaths and changes no
  world state, action mechanics, or durable schema.
- Risk: a stopped bot cannot observe a later unannounced player join; the player
  or dashboard must start it again.
- Gate: pass. This is the current lifecycle behavior already used by
  `!leaveGame`, with a new tightly bounded policy trigger.

### V2 — prove or build shelter before terminal Hold

Define a real enclosure/hostile-safety receipt, select a legal stance, and use
Pathfinder or the existing emergency shelter Builder before applying Hold.

- Advantage: leaves a physically present companion online.
- Risk: current cover evidence is insufficient; movement/building after “wait
  beside me” or Stop violates player authority, and materials may be absent.
- Gate: fail for this slice. It requires a new shelter contract and changes the
  requested final location.

### V3 — provision combat equipment before night

Before Hold, retrieve or craft a weapon, food, and armor, then rely on current
reflexes.

- Advantage: preserves presence and uses installed inventory/combat packages.
- Risk: chest/crafting work under Hold expands authority, and the armed/fed
  death already falsifies equipment as a sufficient safety disposition.
- Gate: fail on physical functionality evidence.

### V4 — supervisor-owned player watcher with automatic stop/start

Have the managed control plane parse authoritative Paper presence, stop held
bots after the last human leaves, and restart them under preserved Hold when a
human joins.

- Advantage: preserves automatic companion availability across player return.
- Risk: adds cross-process presence identity, debouncing, ownership, restart,
  and crash-loop policy. It is materially larger than the observed immediate
  death-prevention seam and cannot be accepted from one bot-only replay.
- Gate: pass as a future mechanism, not smallest sufficient repair.

Pairwise divergence is structural: V1 is an agent-side terminal lifecycle
disposition; V2 is environmental judgment plus physical movement/construction;
V3 is pre-threat inventory policy; V4 is supervisor-side bidirectional process
automation.

## Frozen rubric

Rubric frozen: axes [Style, Theme, Methodology, Modernization, Error wrapping,
Testability, Blast radius] · weights [1,2,2,2,2,2,1] · denominator = 60 ·
denominator-policy [uniform-N/A-only] · baseline-algo [lowest-effort gate-passer
with no score of 1 on any quality axis]

`freeze: axes=Style,Theme,Methodology,Modernization,Error wrapping,Testability,Blast radius weights=1,2,2,2,2,2,1 denom=ΣW×5 baseline=lowest-effort-gate-passer`

| Axis | W | V1 unload | V2 shelter | V3 equipment | V4 supervisor |
|---|---:|---:|---:|---:|---:|
| Style | 1 | 5 | 3 | 4 | 4 |
| Theme | 2 | 4 | 5 | 3 | 5 |
| Methodology | 2 | 5 | 3 | 2 | 4 |
| Modernization | 2 | 4 | 5 | 3 | 5 |
| Error wrapping | 2 | 5 | 3 | 3 | 4 |
| Testability | 2 | 5 | 3 | 4 | 3 |
| Blast radius | 1 | 5 | 2 | 3 | 2 |
| Effort | — | low | high | medium | high |
| Weighted total | — | 56 | 43 | 37 | 48 |
| Normalized | — | 0.933 | 0.717 | 0.617 | 0.800 |

Arithmetic:

- V1: `5 + 8 + 10 + 8 + 10 + 10 + 5 = 56`; `56 / 60 = 0.933`.
- V2: `3 + 10 + 6 + 10 + 6 + 6 + 2 = 43`; `43 / 60 = 0.717`.
- V3: `4 + 6 + 4 + 6 + 6 + 8 + 3 = 37`; `37 / 60 = 0.617`.
- V4: `4 + 10 + 8 + 10 + 8 + 6 + 2 = 48`; `48 / 60 = 0.800`.

Arithmetic verification corrected four draft totals before the table was
frozen; the ranking and gate results were unchanged. V1 and V4 pass the
functionality gate. V2 fails the current authority/new-contract gate, and V3
fails on physical insufficiency.

## Selection and implementation contract

V1 wins and beats the lowest-effort viable baseline by being that baseline.
Implement only:

1. bounded full-roster human-presence classification;
2. a continuous no-human timer scoped to explicit Stop or completed terminal
   wait, excluding temporary compilation/handoff Holds;
3. one recheck immediately before the existing graceful code-0 teardown;
4. structured Hold decision codes and one recorder-visible shutdown reason;
5. focused tests for grace, bot exclusion, presence reset, single dispatch, and
   code-0 no-restart semantics.

Do not change Pathfinder, PvP, shelter construction, SurvivalDirector,
ActionManager, OperatorControl persistence, profile registration, dependencies,
or automatic supervisor restart in this slice. Physical acceptance is a sole
bot starting under persisted Hold with zero humans, remaining loaded during the
grace, then reaching managed `stopped` with Hold still true and a flushed
`runtime.stopped` record. A human in the full tab roster must prevent unloading.

[codeplan · session22-exposed-hold-safety · OUT · mode: full · pick: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1 0.933, V2 0.717, V3 0.617, V4 0.800 · reason: smallest evidence-backed disposition that prevents unattended loaded-body death without moving, building, or weakening Hold · mechanism-check: passed · corrected: all draft totals reconciled by explicit arithmetic]
