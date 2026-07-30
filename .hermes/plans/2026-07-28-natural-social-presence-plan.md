# Codeplan: Natural social and environmental presence

## Contract and safety
- Required behavior: bots notice meaningful nearby events and react with bounded, truthful, varied, personality-consistent speech or gestures.
- Acceptance criteria: reactions use authoritative events, preserve factual payloads, respect action/conversation ownership, deduplicate across squads, and remain quiet when nothing salient happened.
- Must preserve: dialogue queue, conversation limits, structured action truth, persona/runtime separation, Stop, privacy, and model-outage fallback.
- Out of scope: unrestricted background model chatter, inferred private relationships, and gestures that interrupt gameplay.
- Workspace/user work: extensive uncommitted work is present; add one event/reaction seam rather than direct speech in every subsystem.
- Pre-change checks: agent events, conversation manager, outbound speech, behavior narration, role/survival telemetry, memory bank, and full state inspected.

## Repository evidence
- Event sources exist but are not normalized into one bounded reaction policy.
- Existing idle staring is random and unaware of meaningful events.
- Outbound conversation already has pacing and turn limits.
- Persona prompts permit style variation but explicitly forbid invented gameplay truth.

## Mode
- Candidate mode: full
- Candidate count: 3
- Record profile: compact

## Candidates
- V1 `reaction-director,event-normalization,bounded-state,queued-expression`: normalize factual events and choose silence, gesture, deterministic text, or personality rendering centrally.
- V2 `model-per-event,prompt-state,queued-expression,graceful-degrade`: ask the model to decide and phrase every event.
- V3 `inline-handlers,template-text,distributed-cooldowns,zero-model`: add local templates and cooldowns at each event source.

## Divergence
- V1↔V2: V1 fixes salience and facts before optional phrasing; V2 delegates selection and truth pressure to the model.
- V1↔V3: V1 coordinates deduplication and budgets; V3 distributes policy across handlers.
- V2↔V3: V2 maximizes linguistic variation; V3 maximizes determinism and delivery simplicity.

## Paper gates
- V1: pass - central policy preserves factual inputs, existing queue ownership, and deterministic fallback.
- V2: pass - can be bounded and queued, but increases latency, cost, and hallucination/noise pressure.
- V3: pass - deterministic and inexpensive, but cross-bot deduplication and natural variation are weaker.

## IN
[codeplan · natural-social-presence · IN · mode: full · profile: compact · confidence: high · candidates: V1=reaction-director,event-normalization,bounded-expression;V2=model-every-event,prompt-driven;V3=inline-event-templates,distributed-cooldowns · lean: V1 · conservative: V3]

## Frozen rubric and scoring
- freeze: axes=naturalness,factual-truth,architecture-fit,delivery-cost,noise-risk classes=quality,risk,quality,convenience,risk weights=3,3,3,2,3 denominator=70 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer
- V1: 5,5,5,4,5 = 68/70 = 0.97.
- V2: 5,3,3,1,2 = 41/70 = 0.59.
- V3: 3,5,3,5,3 = 52/70 = 0.74.
- Arithmetic verification: executable calculation confirmed common denominator and totals.
- Formal baseline: V3.
- Selection stability: V1 leads by 0.23 and has the strongest factual/noise boundary.

## PLAN-OUT
[codeplan · natural-social-presence · PLAN-OUT · mode: full · profile: compact · pick: V1 · baseline: V3 · confidence: high · beatBaseline: yes · scores: V1=0.97;V2=0.59;V3=0.74 · reason: a centralized reaction policy gives personality room while preserving factual events, action ownership, and squad-wide noise control · planned-fingerprint: reaction-director,event-normalization,bounded-expression]

## Implementation plan
- Files/boundaries: normalized behavior event contract, reaction director, event adapters, queued expression/gesture boundary, episodic-memory filter, full-state projection, focused/integration tests.
- Ordered changes: event schema; salience/cooldown/dedupe; deterministic reactions; optional personality renderer; gestures; memory filter; telemetry; tests; multi-bot soak.
- Contract checks: fixed factual payload, conversation priority, silence allowed, squad dedupe, model fallback, no action interruption.
- Rollback: disable ambient reaction policy while preserving explicit conversations and gameplay.

## Implementation and evidence
- Implemented a bounded factual event bus and centralized `ReactionDirector` with cooldowns, speech/gesture budgets, conversation priority, squad speaker election, deterministic variation, optional personality phrasing validation, and episodic-memory filtering.
- Added player join/leave/approach/return/gaze/order, self and nearby damage/death, threat detection/clearance, item, structure, terrain, weather, time, action, survival, job, and squad-radio adapters.
- Added a 750 ms environment observer that performs no physical action and keeps bounded player/block observation state.
- Ordinary ambient events use varied deterministic language; model phrasing is reserved for high-salience events and falls back without inventing facts.
- Full-survival bots now turn safe nearby useful-item observations into bounded physical pickup actions after bodily, night, weather, and shelter priorities are satisfied.
- Common player phrases for eating, sourcing/cooking food, preparing or replacing any major tool family, and collecting nearby drops bypass command-syntax friction while retaining the same action ownership and evidence.
- Behavior telemetry and dashboard summaries expose bounded server-owned reaction status.
- The simulated ten-bot thirty-minute reaction gate, the 66-test behavior suite, behavior lint, syntax, and diff formatting passed after the gameplay expansion on 2026-07-28. Live-bot activation remains intentionally pending.

## EXEC-OUT
[codeplan · natural-social-presence · EXEC-OUT · implemented: V1+useful-world-action-slice · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: observation-only-drops-now-actionable · evidence: factual-events,bounded-reactions,squad-dedupe,safe-useful-pickup,natural-directives,ten-bot-simulation,66-behavior-tests,syntax,diff-check;live-runtime-not-activated]
