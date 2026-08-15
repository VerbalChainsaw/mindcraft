CODEPLAN status: selected · trivial: no · continue · task: natural indefinite family wait must settle into durable Operator Hold so zero-human safe unload remains eligible

# Session 31 indefinite-wait lifecycle

## Calibration

The observed request routed through `resolvePlayerDirective` to `!stay(-1)`.
That command runs `skills.stay` as a serialized player action, pauses modes,
never settles before interruption, and releases Operator Hold. The accepted
zero-human unload gate belongs to `BehaviorArbiter` and is intentionally
eligible only while the dedicated `OperatorControlStateStore` says held.
`!stop` already performs the required shared operation: persist Hold, interrupt
and settle the current action, preserve durable work, cancel resume, and push
authoritative state. Tests use `node:test` with strict assertions and favor
small deterministic-routing checks for natural language.

Triviality gate: `trivial: no · continue`. The winning patch can be small, but
the choice crosses command authority, action settlement, persisted Hold, and
process lifecycle, and multiple structural mechanisms are credible.

## Variants and hard gates

- **V1 — `directive-alias internal-reuse`**: route all natural indefinite
  `stay`/`wait` directives to the existing `!stop` capability, with Hold-accurate
  acknowledgement. Finite explicit `!stay(seconds)` remains unchanged.
  `G: pass` — reuses the already accepted persistent authority/lifecycle seam,
  adds no dependency/schema, and directly fixes ordinary chat.
- **V2 — `command-reconcile extracted-helper`**: factor the `!stop` operation
  from `actions.js`; make `!stay(-1)` invoke that helper while finite stay keeps
  `runAsAction`/`skills.stay`.
  `G: pass` — fixes both explicit and natural indefinite stay, but changes the
  documented direct command contract and touches the action boundary.
- **V3 — `arbiter-transition instance-state`**: leave the never-settling action
  intact; when the human roster becomes empty, teach `BehaviorArbiter` to
  interrupt that exact action and install Hold.
  `G: fail [authority/safety]` — the player action still releases durable Hold
  and pauses mortal modes while humans remain, and presence/lifecycle code
  becomes responsible for repairing a command semantic defect.
- **V4 — `new-command persistent-hold`**: add a new player-only persistent-wait
  command backed by existing Hold, and route natural wait/stay to it.
  `G: pass` — correct, but expands the public command surface and duplicates the
  already sufficient `!stop` capability.

Pairwise divergence: V1 changes only deterministic routing; V2 changes the
existing command executor through a shared helper; V3 moves transition state
into the arbiter; V4 adds a command boundary. Each differs in module boundary,
state transition location, or public command surface.

## Frozen rubric

Repository-calibrated axes are authority correctness, lifecycle settlement and
persistence, compatibility with existing direct/natural commands, focused
testability/observability, blast radius/reversibility, and local style.

Rubric frozen: axes [Authority,Lifecycle,Compatibility,Testability,Blast radius,Style] · weights [3,3,2,2,2,1] · denominator = Σ(weights) × 5 = 65 · denominator-policy [uniform-N/A-only] · baseline-algo [lowest-effort gate-passer with no score of 1 on any quality axis]

freeze: axes=Authority,Lifecycle,Compatibility,Testability,Blast radius,Style weights=3,3,2,2,2,1 denom=ΣW×5 baseline=lowest-effort-gate-passer

## Scoring

| Variant | Authority | Lifecycle | Compatibility | Testability | Blast radius | Style | Total | Normalized | Effort |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| V1 | 5 | 5 | 4 | 5 | 5 | 5 | 63/65 | 0.969 | low |
| V2 | 5 | 5 | 5 | 4 | 3 | 4 | 58/65 | 0.892 | medium |
| V4 | 5 | 5 | 4 | 4 | 3 | 4 | 56/65 | 0.862 | medium |

Arithmetic verification used identical axes and weights for every scored
variant: V1 products `15+15+8+10+10+5=63`; V2
`15+15+10+8+6+4=58`; V4 `15+15+8+8+6+4=56`; denominator
`(3+3+2+2+2+1)*5=65`.

## Selection and verification contract

V1 is the algorithmic baseline and wins outright (`baseline-wins`). It gives
ordinary indefinite wait the already accepted persistent semantics with the
smallest surface, while preserving finite `!stay(seconds)` for runtime cases.
Implement only the natural routing and its focused assertions. Verify the exact
family wording routes to `!stop`, generic `stay here`/`wait` route to `!stop`,
finite explicit stay remains present, then replay Session 31 unchanged. A
mechanism drift into `actions.js`, BehaviorArbiter, new state, or a new command
requires constrained replanning.

CODEPLAN result: winner V1=0.969 · V2=0.892 · V4=0.862 · beatBaseline=baseline-wins · mechanism-check=directive-alias/internal-reuse · corrected: none
