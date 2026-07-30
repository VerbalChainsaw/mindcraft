# Codeplan: Bounded dialogue attention

## Contract and safety
- Required behavior: bot-to-bot dialogue must remain useful without indefinitely pausing gameplay, leaking timers, or stranding queued messages.
- Acceptance criteria: per-profile turn/time budgets; bounded response wait; every timer cleared on reset/end; busy messages eventually process or end; relay failure closes the conversation; gameplay goal resumes only after all real conversations end.
- Must preserve: current chat routing, explicit `!endConversation`, one active partner, self-prompt pause/resume, dialogue history, and squad radio transport.
- Out of scope: prompt/persona redesign, UI fields, model changes, squad-radio protocol redesign, and live activation.
- Workspace/user work: extensive concurrent changes exist; only conversation manager, runtime limit normalization, and Hermes records are in scope.

## Repository evidence
- `Conversation.reset/end` set `inMessageTimer = null` without clearing the timer.
- `_scheduleProcessInMessage` schedules nothing when both bots are busy and the action cannot talk over, leaving the queue active indefinitely.
- The response reminder doubles from 30 seconds without a cap or terminal condition.
- `endConversation` dereferences `activeConversation.name` even when no active conversation exists.
- `startConversation/sendToBot` do not act on a disconnected MindServer relay.
- Runtime already owns bounded `profile.runtime.limits`.

## Mode
- Candidate mode: constrained
- Candidate count: 2
- Record profile: compact

## Candidates
- V1 `existing-manager,per-conversation-state,bounded-timers,graceful-end`: harden the current singleton with turn/deadline state, timer ownership, bounded busy deferral, relay failure handling, and safe resume.
- V2 `new-dialogue-scheduler,event-queue,persistent-state,new-module`: replace conversation flow with a separate durable dialogue scheduler.

## Divergence
- V1-V2: V1 repairs ownership at existing seams and preserves protocol/history; V2 introduces a second scheduler and persistence contract across every bot process.

## Paper gates
- V1: pass - fully addresses observed starvation and cleanup faults with a contained reversible change.
- V2: pass - viable long-term, but high migration/concurrency risk and unnecessary for the current contract.

## IN
[codeplan · bounded-dialogue-attention · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=existing-manager/per-conversation-state/bounded-timers/graceful-end;V2=new-dialogue-scheduler/event-queue/persistent-state/new-module · lean: V1 · conservative: V1]

## Frozen rubric and scoring
- freeze: axes=architecture-fit,attention-safety,cleanup-correctness,operability,delivery-risk classes=quality,risk,risk,quality,risk weights=3,3,3,2,1 denominator=60 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer
- V1: 5,5,5,4,4 = 55/60 = 0.92
- V2: 2,5,4,5,1 = 39/60 = 0.65
- Formal baseline: V1.
- Selection stability: V1 leads by 0.27 and preserves the existing protocol.

## PLAN-OUT
[codeplan · bounded-dialogue-attention · PLAN-OUT · mode: constrained · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1=0.92;V2=0.65 · reason: the observed failures are ownership and bound defects inside the existing manager, not evidence that a second scheduler is required · planned-fingerprint: existing-manager,per-conversation-state,bounded-timers,graceful-end,structured-status]

## Implementation plan
1. Add normalized conversation turn/minute limits.
2. Give each conversation timer/deadline/turn/deferral/reminder state and clear it on reset/end.
3. Bound queue size and compiled message size.
4. End on turn/deadline/response budget and on relay failure.
5. Poll busy actions only for a bounded number of deferrals, then process rather than orphaning the queue.
6. Make end/end-all null-safe and resume goals only when no active conversations remain.
7. Inspect exact source; do not restart the live stack.

## Implementation and evidence
- Implemented V1 without a mechanism shift.
- Runtime normalization adds bounded `maxConversationTurns` and `maxConversationMinutes`; profile serialization already preserves normalized limits.
- Each Conversation owns cancellable processing state, start/activity timestamps, outbound turns, busy deferrals, response reminders, and terminal reason.
- Manager monitoring enforces time/turn/no-response bounds; relay failure closes locally; both-busy work polls six times instead of orphaning the queue.
- Queues and compiled model input are bounded. Bot status radio becomes history-only unless it belongs to an already active dialogue.
- Goal pause provenance prevents a conversation end from reviving an unrelated failed/held goal; `!goal` during dialogue explicitly marks its deferred resume.
- Evidence gates: exact lifecycle, command, and runtime-normalization source inspected. Syntax/build/lint/live dialogue remain intentionally not run; the active stack was preserved.

## EXEC-OUT
[codeplan · bounded-dialogue-attention · EXEC-OUT · implemented: V1 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: per-profile dialogue budgets, timer/queue ownership, busy/response bounds, relay closure, radio non-locking, null-safe end, and pause-provenance resume · evidence: final source inspected; live activation and tests deferred by user and concurrency constraints]
