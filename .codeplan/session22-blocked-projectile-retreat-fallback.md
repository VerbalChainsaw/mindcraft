[codeplan · session22-blocked-projectile-retreat-fallback · IN · mode: full · confidence: high · candidates: V1 decision fallback metadata+internal-reuse, V2 executor replan+loop-replan, V3 mode escalation latch+instance-state · lean: V1 · baseline: V1]

# Session 22 blocked projectile-retreat fallback

## Triviality and evidence correction

`trivial: no · continue`

The physical executor already contains a last-resort fallback seam, but the
observed defect crosses tactical selection, a verified Pathfinder failure, and
package-owned combat execution. Two mechanisms are credible and a wrong safety
policy could turn a retreat into an unsafe engagement.

The initial “armed bot ignored its sword at close range” claim was disproved
before implementation. Flight sequence 5 is a distinct sample: the armed bot
was already executing a retreat and moved roughly five blocks before a
Skeleton killed it; the death snapshot sampled that Skeleton about 11.5 blocks
away. Sequences 6–8 happened after respawn with an empty inventory. Those three
samples show the same grounded Skeleton at about 4.0, 3.2, and 3.3 blocks,
three zero-step `skill_unreachable` retreats, and no attack authorization.
This slice addresses only that post-respawn blocked-retreat class. It does not
claim to repair the earlier armed death or the exposed-home shelter problem.

## Center Audit repair contract

Claim: after native Pathfinder proves that retreat cannot increase spacing from
an immediate, grounded, combat-safe projectile threat, the tactical policy has
no executable fallback even though the existing Mineflayer PvP adapter can
perform close defensive melee. The result is truthful non-action and, whenever
health or stance changes, another admissible attempt at the same impossible
response.

Falsifier: a structured decision receipt authorizes an alternative response
for the exact close-Skeleton state, or another owner executes one after the
zero-progress Pathfinder result.

Evidence trajectory:

- A — flight sequences 6–8: empty post-respawn body, Skeleton `90008` at
  4.0–3.2 blocks, `unsafe_projectile_engagement`, zero route steps, zero hits,
  and `skill_unreachable`.
- A — the preceding flight's sequences 20–21 independently capture an empty
  body at one health, the same grounded Skeleton closing from 3.6 to 3.3
  blocks, two more zero-step `skill_unreachable` retreats, and death roughly
  1.35 seconds later at sequence 22. This proves lethality of the bounded
  unarmed failure class without conflating it with the later armed sample.
- B — `combat-decision.js`: `responseFor` attaches `fallbackResponse: melee`
  only when `classification === melee`; Skeleton is classified `ranged`.
- B — `skills.js`: `resolveTacticalCombat` delegates retreat to Pathfinder and
  invokes package-owned `attackEntity(..., true)` only when that metadata is
  present; otherwise it settles the structured retreat failure.
- B — `skills.js` and installed runtime: `attackEntity` equips the best carried
  weapon when one exists, then delegates moving melee to `mineflayer-pvp`
  1.3.2. An empty hand remains a legal Minecraft attack.
- B — focused baseline: all current `combat-decision` checks pass and cover a
  blocked ordinary melee fallback plus Creeper exclusion, but no ranged threat.
- I — independent calibration separated the armed death from the empty-body
  samples and confirmed that this change cannot be used as evidence for the
  armed death.

Center: the fallback metadata in `responseFor`, consumed by the already
existing zero-progress branch in `resolveTacticalCombat`. Pathfinder and PvP
are later owners and have not failed their delegated contracts in this sample.

Result: `DEFECT_CONFIRMED`, likelihood `CERTAIN`, impact `HIGH`, confidence
`HIGH`, reproducibility `DETERMINISTIC` for selection and repeated physically
through one health and death. The correction is reversible and
bounded: only after a verified failed retreat, only within 3.5 blocks, only for
a grounded threat whose disposition is not avoid-only or explosive. Creepers,
Wardens/avoid-only threats, airborne threats, and every successful retreat stay
unchanged.

`repair_revalidation: INVARIANT_HOLDS` — the current source and the exact
post-respawn receipts still match the audited center. The armed-death
interpretation is explicitly excluded.

## Calibration

Repository style is ESM with camelCase helpers, snake_case outcome codes,
bounded structured evidence, early returns, and focused `node:test` checks.
The project owns tactical judgment and recovery policy; Pathfinder owns route
planning/execution; `mineflayer-pvp` owns moving melee. The existing fallback
metadata is the nearest precedent and the smallest ownership-preserving seam.

## Variants and divergence

### V1 — broaden decision fallback metadata (`policy-metadata`, `internal-reuse`)

Have the pure selector attach the existing melee fallback to immediate grounded
combat-safe melee *or ranged* threats. The executor remains unchanged and may
consume it only after Pathfinder reports no increased spacing.

- Advantage: reuses the current recovery and package adapter; no new state.
- Risk: last-resort bare-hand combat can still lose, so live acceptance is
  required and success must never be inferred from dispatch.
- Gates: pass; no dependency, schema, persistence, or lifecycle change.

### V2 — replan in the executor (`loop-replan`, `local-only`)

After zero-progress retreat, construct a second decision input carrying
`retreatBlocked` and ask the selector to choose among remaining responses.

- Divergence: an explicit feedback/replanning loop and a larger decision API.
- Advantage: can grow to more fallback kinds later.
- Risk: adds a second selection pass and more evidence reconciliation for one
  currently supported alternative.
- Gates: pass; functional but larger than the observed defect.

### V3 — mode-owned next-tick escalation (`mode-latch`, `instance-state`)

Persist the failed retreat in `self_defense` and authorize a close defensive
attack on the next materially changed tick.

- Divergence: temporal state in ModeController rather than same-action recovery.
- Advantage: separates attempts and retains the original result.
- Risk: delays the only executable response, duplicates tactical semantics in
  the mode, and can lose the target or die between actions.
- Gates: pass; no schema change, but ownership and timing are materially worse.

Pairwise divergence is structural: V1 extends existing selector metadata, V2
adds an executor feedback loop, and V3 adds cross-action mode state.

## Frozen rubric

Rubric frozen: axes [Style,Theme,Methodology,Modernization,Error wrapping,Testability,Blast radius] · weights [1,2,2,2,2,2,1] · denominator = 60 · denominator-policy [uniform-N/A-only] · baseline-algo [lowest-effort gate-passer with no score of 1 on any quality axis]

`freeze: axes=Style,Theme,Methodology,Modernization,Error wrapping,Testability,Blast radius weights=1,2,2,2,2,2,1 denom=ΣW×5 baseline=lowest-effort-gate-passer`

## Scoring

| Axis | W | V1 metadata | V2 replan | V3 mode latch |
|---|---:|---:|---:|---:|
| Style | 1 | 5 | 4 | 3 |
| Theme | 2 | 5 | 5 | 3 |
| Methodology | 2 | 5 | 4 | 3 |
| Modernization | 2 | 4 | 5 | 3 |
| Error wrapping | 2 | 5 | 5 | 3 |
| Testability | 2 | 5 | 5 | 3 |
| Blast radius | 1 | 5 | 3 | 2 |
| Effort | — | low | medium | medium |
| Weighted total | — | 58 | 55 | 35 |
| Normalized | — | 0.967 | 0.917 | 0.583 |

Arithmetic:

- V1: `5 + 10 + 10 + 8 + 10 + 10 + 5 = 58`; `58 / 60 = 0.967`.
- V2: `4 + 10 + 8 + 10 + 10 + 10 + 3 = 55`; `55 / 60 = 0.917`.
- V3: `3 + 6 + 6 + 6 + 6 + 6 + 2 = 35`; `35 / 60 = 0.583`.

Correction during arithmetic verification: the initially drafted V2 and V3
totals (`54`, `32`) were transcription errors. The final table uses verified
totals `55` and `35`; the ranking and selected mechanism are unchanged.

## Selection and implementation contract

V1 wins and is the algorithmic baseline. Implement only the selector condition
and one focused close-Skeleton regression while preserving the current
Pathfinder-first order, structured failure, package-owned combat executor,
unchanged-evidence latch, and all exclusions. Then run the focused decision
suite. Do not edit Pathfinder, PvP, ActionManager, ModeController, persistence,
or shelter behavior in this slice.

[codeplan · session22-blocked-projectile-retreat-fallback · OUT · mode: full · pick: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1 0.967, V2 0.917, V3 0.583 · reason: the existing selector metadata is the smallest same-action recovery seam and leaves mechanics delegated to installed packages · mechanism-check: passed · corrected: V2 total 54→55, V3 total 32→35]

## Physical falsification and replan gate

V1 passed the focused selector suite but failed real-world acceptance and was
reverted. Paper first proved both old-failure stances were supported and clear:
the empty held bot at `(8107.48,64,7941.5)` and a tagged Skeleton at
`(8108.3,64,7938.3)`. The bot began with 20 health, 20 temporary absorption
points, and no inventory. The existing Pathfinder retreat failed and V1 then
authorized package-owned PvP. Paper physically observed the Skeleton fall from
20 to 14 health, proving six fist hits, but the bot moved/fell to y=62, consumed
all absorption and health, and was shot dead while the Skeleton remained alive.

This falsifies the claim that bare-hand fallback is a safe or sufficient repair
for the observed empty-respawn failure. It also exposes why dispatch evidence
cannot be promoted to success: package execution occurred, yet the verified
outcome was death. The tagged Skeleton was removed, daylight and the clean
empty respawn were restored, and the sole bot runtime was stopped. No fixture
entity remains.

V1's functionality gate is therefore `fail` after physical acceptance, despite
its static score. The source and focused test were restored to their prior
state. V2 and V3 merely change when the same inadequate bare-hand response is
selected, so this evidence invalidates their shared mechanism as well. A future
plan must consider a materially different mechanism—pre-threat verified
shelter/cover, safe unloaded hold, or an evidence-backed equipment contingency—
and must continue to treat the armed active-retreat death as a separate sample.

[codeplan · session22-blocked-projectile-retreat-fallback · REPLAN · confidence: high · rejected: V1,V2,V3 · reason: live package-owned fist combat produced six hits but still killed the protected full-health bot, so all three variants share a physically disproven response · next: checkpoint without expanding into a third mechanism]
