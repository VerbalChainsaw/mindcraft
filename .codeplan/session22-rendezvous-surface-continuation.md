[codeplan · session22-rendezvous-surface-continuation · IN · mode: full · confidence: high · candidates: V1 Pathfinder local recovery, V2 model-led tunnel sequence, V3 typed Agenda surface escape+rendezvous, V4 ActionManager deferred continuation · lean: V3 · baseline: V4]

# Session 22 rendezvous surface continuation

## Triviality gate

`trivial: no · continue`

The live request crossed an explicit terrain-change authorization, a previously
failed named-player rendezvous, and durable multi-step execution. The wrong
owner either duplicates Pathfinder mechanics, permits destructive recovery
without exact player authority, or loses the original destination again.

## Live repair contract

The bounded Paper campaign proved these edges:

- `!goToPlayer("phixxation")` truthfully returned `skill_path_not_found` with a
  complete native search receipt and zero movement from the blocked stance;
- one existing local-recovery sidestep also failed to produce a target route;
- Kevin asked whether he should dig out and continue toward phixxation;
- phixxation explicitly authorized the escape;
- the model improvised two `!digTunnel` actions, `!awareness`, and one local
  coordinate hop, then declared the hop terminal and dropped phixxation;
- after that material terrain change, a fresh typed `goto` produced a complete
  native route and Kevin reached phixxation at 3.8 blocks.

The repair therefore must not change Pathfinder. It must preserve the exact
failed rendezvous, accept only an explicit escape instruction from that same
recipient, delegate escape mechanics to the existing `!goToSurface` skill,
and persist `surface escape -> named-player rendezvous` as one typed Agenda
promise with a success dependency.

## Calibration

Repository guidance assigns intent, authorization, persistence, evidence, and
reporting to project code while Mineflayer/Pathfinder own physical mechanics.
Current code uses strict typed Agenda entries, immutable normalized receipts,
code-built command dispatch, ESM, camelCase helpers, snake_case outcome codes,
and focused `node:test` checks. Calibration agents independently confirmed that
complete native routes must precede player pursuit and that partial routes may
not become movement authority.

Quality axes are source style, owner-boundary fit, complete-intent preservation,
authorization/safety, package-mechanics reuse, telemetry truth, persistence,
testability, and blast radius.

## Variants and divergence

### V1 — expand Pathfinder local recovery (`inline-recovery`, `goal-rewrite`)

Try additional local stance candidates or a region goal before player pursuit.

- Divergence: navigation-layer search/recovery behavior.
- Gate: `G: fail`; the live safe sidestep was insufficient, and final acceptance
  proved the native route became available only after an authorized world
  change. This mechanism neither owns excavation authority nor preserves the
  larger promise.

### V2 — keep model-led tunneling (`model-sequence`, `return-code`)

Let the conversation model issue repeated tunnel, awareness, local movement,
and rendezvous commands across its response loop.

- Divergence: transcript-local sequencing of raw commands.
- Gate: `G: fail`; this is the reproduced defect. The model dropped the named
  destination after the local hop, the command chain is not restart-durable,
  and raw tunnel choice bypasses the established surface-escape capability.

### V3 — typed Agenda surface escape plus rendezvous (`typed-composite`, `package-adapter`)

Retain a bounded structured receipt when a named-player rendezvous fails at
the route boundary. If that same recipient explicitly orders the bot to dig
itself out, compile two validated Agenda entries: `surface_escape`, dispatched
as existing `!goToSurface`, then `goto` for the retained recipient with
`requires_success`.

- Divergence: one new command-free Agenda kind and a bounded rendezvous receipt
  at Agent's existing ActionResult observation edge.
- Gate: `G: pass`; explicit authority, exact identity, package ownership,
  structured outcomes, cancellation, and restart persistence after admission
  all remain in their current owners.

### V4 — ActionManager deferred callback (`instance-state`, `internal-reuse`)

When the escape command begins, register a deferred `goToPlayer` callback that
runs after the current action succeeds.

- Divergence: ephemeral closure state in the physical action serializer.
- Gate: `G: pass`; it can preserve the immediate target and cancellation, but
  ActionManager must interpret a domain-specific promise, the continuation is
  not durable across restart, and the two effects do not share one typed intent
  receipt.

Pairwise divergence is structural: V1 changes route planning, V2 sequences in
model narration, V3 persists typed domain effects, and V4 retains an in-memory
physical callback.

## Frozen rubric

Rubric frozen: axes [Style, Owner boundary, Complete intent, Authorization/safety, Package mechanics, Telemetry truth, Persistence, Testability, Blast radius] · weights [1,3,3,3,3,2,2,2,2] · denominator = 105 · denominator-policy [uniform-N/A-only] · baseline-algo [lowest-effort gate-passer with no score of 1 on any quality axis]

`freeze: axes=Style,Owner boundary,Complete intent,Authorization/safety,Package mechanics,Telemetry truth,Persistence,Testability,Blast radius weights=1,3,3,3,3,2,2,2,2 denom=ΣW×5 baseline=lowest-effort-gate-passer`

## Scoring

Hard-gate failures V1 and V2 are not scored.

| Axis | W | V3 typed Agenda | V4 deferred callback |
|---|---:|---:|---:|
| Style | 1 | 5 | 4 |
| Owner boundary | 3 | 5 | 3 |
| Complete intent | 3 | 5 | 4 |
| Authorization/safety | 3 | 5 | 4 |
| Package mechanics | 3 | 5 | 5 |
| Telemetry truth | 2 | 5 | 3 |
| Persistence | 2 | 5 | 2 |
| Testability | 2 | 4 | 4 |
| Blast radius | 2 | 4 | 3 |
| Effort | — | medium | low |
| Weighted total | — | 101 | 76 |
| Normalized | — | 0.962 | 0.724 |

Arithmetic:

- V3: `5 + 15 + 15 + 15 + 15 + 10 + 10 + 8 + 8 = 101`; `101 / 105 = 0.962`.
- V4: `4 + 9 + 12 + 12 + 15 + 6 + 4 + 8 + 6 = 76`; `76 / 105 = 0.724`.
- Both gate-passers use the same nine axes and denominator.

## Selection and implementation contract

V3 beats the lower-effort V4 baseline by 0.238 and is selected. Implement only
the bounded failed-rendezvous receipt, same-recipient explicit escape parser,
one `surface_escape` Agenda kind dispatched through `!goToSurface`, and the
dependent retained `goto`. Do not modify Pathfinder, Mineflayer movements,
`goToPlayer`, `goToSurface`, raw tunnel mechanics, retry budgets, or combat.

[codeplan · session22-rendezvous-surface-continuation · OUT · mode: full · pick: V3 · confidence: high · beatBaseline: yes(+0.238) · scores: V3 0.962, V4 0.724 · reason: the typed Agenda is the only existing owner that preserves exact player identity, explicit terrain authority, package-owned escape, and restart-durable completion as one promise · mechanism-check: passed · corrected: V1/V2 eliminated by live evidence]
