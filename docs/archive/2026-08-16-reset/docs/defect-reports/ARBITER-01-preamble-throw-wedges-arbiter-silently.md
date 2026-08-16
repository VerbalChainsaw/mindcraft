# ARBITER-01 — a throw in the update preamble wedges the arbiter permanently, and defeats its own watchdog

**Severity:** low probability, catastrophic and **silent** if reached. The bot goes inert while appearing
alive, and the existing 5-failure restart watchdog cannot see it.
**File:** `src/agent/runtime/behavior-arbiter.js` — `update()`.
**Status:** static trace. Not observed. Not applied.
**Fix size:** hoist two declarations and move one `try {` brace. No logic change.

Found by ranking the clean (non-contested) source files by size and probing for the longest function:
`behavior-arbiter.update()` is **442 lines**, the gnarliest single function outside the contested set.

## The gap

```js
  async update(delta = 0) {
    if (this.stopped) return this.snapshot();
    if (this.updating) return this.snapshot();   // <-- the gate
    this.updating = true;                        // <-- set here, line 609
    ...
    const modes = this.agent.bot?.modes;
    this.urgency = this.urgencyOf();             // unguarded
    ...
    this.traceRecorder.recordScheduledLoopDelay(...);   // unguarded
    this.traceRecorder.begin({ ... activeAction: this.actionState() });  // unguarded
    this.traceRecorder.startStage('perception_refresh');                 // unguarded
    const perception = await this.refreshPerception();
    this.traceRecorder.finishStage('perception_refresh');
    this.traceRecorder.addEvidence({ ... });                             // unguarded
    let modeCycleStarted = false;
    try {                                        // <-- try only opens here, line 644
      ...
    } finally {
      ...
      this.updating = false;                     // <-- the only reset, line 1043
    }
  }
```

`this.updating = false` occurs in exactly two places in the file: the constructor (line 127) and that
`finally` (line 1043). There is **no watchdog, stall detector, or timeout** that resets it — verified
across `behavior-director.js` and `agent.js`.

So any throw between setting the flag and entering the `try` leaves `this.updating === true` for the
lifetime of the agent, and line 608 short-circuits every subsequent tick.

`refreshPerception()` is **not** a risk — it has a complete internal try/catch and returns an error object
rather than throwing. The exposure is `urgencyOf()`, `actionState()`, and the four `traceRecorder` calls.
All are internal and unlikely to throw in steady state; the realistic trigger is a torn-down or
reconnecting bot where a property read lands on `undefined` mid-tick.

## Why it defeats the existing watchdog — the important part

`agent.js` already has a restart guard around the loop:

```js
                try {
                    await this.update(start - last);
                    consecutiveFailures = 0;
                } catch (error) {
                    consecutiveFailures += 1;
                    ...
                    if (consecutiveFailures >= 5) {
                        this.cleanKill('Agent update loop failed repeatedly. Restarting is required.', 1);
```

That guard counts **consecutive throws**. But once the arbiter is wedged, the *next* call hits
`if (this.updating) return this.snapshot();` and **returns normally**. `consecutiveFailures` resets to 0
on the very next tick.

So the counter never reaches 5. The loop keeps spinning, `update()` keeps returning a snapshot, and the
agent is never restarted. **The failure mode converts a hard error into a silent success, which is
precisely the shape this watchdog cannot catch.**

Player-visible result: the bot stays connected and looks alive, but makes no decisions at all — no
survival, no jobs, no reactions, no reactions to threats. It just stands there.

## The fix — a brace move, nothing more

Open the `try` immediately after `this.updating = true;` so the existing `finally` covers the whole body.

Two declarations must stay outside the `try` because the `finally` reads them:

- `const modes = this.agent.bot?.modes;` — used by `modes?.endUpdateCycle?.()` in the `finally`
- `let modeCycleStarted = false;` — used by the same guard

Hoist those two to just after `this.updating = true;`, then open the `try`. Everything else moves inside
unchanged. Both hoisted lines are trivial (one optional-chained property read, one literal) and are not
plausible throw sites.

No new code, no new abstraction, no change to arbitration order or lane semantics. **Do not** add a
watchdog or a stall detector for this — the correct repair is to make the existing `finally` cover the
whole function, not to build a second safety net on top of a gap.

## Evidence class

Static trace. All four quoted regions are exact reads. The reachability claim — that `urgencyOf()`,
`actionState()`, or a `traceRecorder` call can throw — is **inferred, not demonstrated**; I did not
produce a throw from any of them. The watchdog-defeat analysis follows directly from the two quoted code
paths and does not depend on which call throws.

Treat this as a robustness hardening with an unusually bad worst case, not as a defect known to be
firing today.

## Audited nearby and found sound — no action

- The arbitration order in `update()` is careful and well-commented: the bounded
  `emergency_self_preservation` exception is deliberately evaluated **before** the operator-hold gate, so
  drowning or burning can be answered without releasing the hold. The comment says exactly why. That
  ordering is correct and should not be disturbed.
- `refreshPerception()` is fully guarded and degrades to an error object — a good pattern, and the reason
  the largest await in the gap is *not* the risk.
- The `finally` itself is defensive: `endUpdateCycle` is wrapped in its own try, and the task-completion
  check has a nested try/finally so a failure there still finalizes the trace.
- The loop's interruptible sleep (`behavior_arbiter?.sleep?.(remaining)`) with a plain-timeout fallback
  is a sound degradation path.
