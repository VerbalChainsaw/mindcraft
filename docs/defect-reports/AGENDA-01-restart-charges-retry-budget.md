# AGENDA-01 — an operator Stop/restart silently spends a step's retry budget

**Severity:** lands directly on the next planned campaign; halves the retry budget of every `direct` step.
**File:** `src/agent/runtime/agenda-director.js`.
**Status:** static trace (not driven end to end). Not applied.

## Why this matters now

`docs/coordination/CURRENT.md` defines the next campaign as "unchanged overnight-outpost request with
**one controlled Stop/restart**." That Stop is not incidental — it is the thing being tested. This defect
means the Stop itself consumes one of the step's two attempts.

## The chain

1. `sleep` is a **direct** executor (`src/agent/runtime/agenda.js:78`). So are `goto`, `follow_until`,
   `craft`, `smelt`, `farm_visit`, `maintain_farm`, `deposit`, and `visit` — 11 kinds in total.
2. On operator Stop, `update()` returns early:

   ```js
       if (this.agent.isOperatorHeld?.()) {
         this.setStatus('suppressed', 'operator_hold', ...);
         return;
       }
   ```

   It sets a status and nothing else. **No entry mutation, no store write, no durable marker** that the
   interruption was operator-initiated.
3. After restart the agenda is reloaded (`this.entries = this.store.load()`). The previously in-flight
   entry is still `active`, and `executorsIdle()` is now trivially true in a fresh process, so
   `settleActive(active)` runs.
4. `settleActive` handles `executor === 'goal'` and `executor === 'job'` explicitly, then falls through
   for everything else:

   ```js
       return {
         state: 'failed',
         code: 'agenda_action_result_missing',
         detail: 'The restored direct agenda step has no durable terminal result and cannot be assumed complete.',
         retryable: true,
       };
   ```

5. `commitSettlement` then does `const attempts = active.attempts + 1;` and gates retry on
   `attempts < MAX_ENTRY_ATTEMPTS`, where `MAX_ENTRY_ATTEMPTS = 2`.

**Net:** one controlled Stop/restart during a direct step = attempt 1 spent. Exactly one real attempt
remains. A second interruption — or one genuine failure — takes the entry terminal `failed`.

For sleep specifically, combined with [SLEEP-01](SLEEP-01-night-not-skipped-force-wake.md), the campaign
currently cannot survive its own test procedure.

## What is actually wrong

The conservatism is right: after a restart there genuinely is no durable terminal result, and the step
must not be assumed complete. **Charging the retry budget is the wrong part.** An operator-initiated Stop
is not the step failing — the operator stopped it.

The director cannot currently tell the two apart, because nothing durable distinguishes "suppressed by
operator Stop" from "died mid-flight for unknown reasons."

Note `goToBed` already emits `outcome: 'interrupted'` when `bot.interrupt_code` is set — the information
exists in-process, it just does not survive the restart.

## Correction shape

Record a durable marker on the active entry when an operator hold suppresses it, so the restart path can
restore-without-charging: re-arm the step at its existing attempt count rather than settling it as a
failed attempt. Keep the conservative "not complete" stance; only stop billing it.

Do **not** raise `MAX_ENTRY_ATTEMPTS` to paper over this. That hides the same bug behind a bigger number
and weakens the budget for genuine failures.

Anything that dies without an operator hold — a crash, a kill — should keep today's behaviour and be
charged, since there really is no evidence it was interrupted cleanly.

## Test coverage

`agenda_action_result_missing` appears **only at its own definition** — no test in `tests/` asserts this
path in either direction. It is an untested fallback, not a deliberately pinned behaviour, so changing it
does not contradict an existing contract.

A focused regression is justified here: restore an `active` direct entry that was suppressed by an
operator hold and assert its attempt count is unchanged.

## Evidence class

**Static trace only.** This was read, not driven end to end — building an `AgendaDirector` harness needs
an agent with both executors, a store, and a hold source. The arithmetic is simple and the anchors above
are exact, but if this is going to change behaviour around Operator Stop, drive it in a harness first.
Operator hold semantics are not to be altered as a side effect.
