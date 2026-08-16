# Defect reports

Investigation findings with executed repros, written to be actionable without re-deriving anything.
Each report states its own evidence class — what was proven by running code versus what was only traced
by reading it.

Produced in a read-only lane alongside a concurrent writer. **Nothing here was applied**, no source file
was modified, no runtime or director command was issued, and the Operator hold was not touched.

## Honest scope

**There are 9 defect reports, not 64.** The 64 numbered rows in
[INVESTIGATION-LOG.md](INVESTIGATION-LOG.md) are investigation entries — the majority are *clears*
(suspicions checked and found sound), verifications, notes deliberately **not** raised as requirements,
and corrections to my own earlier claims. Counting log rows as findings would badly overstate this.

## Re-verify before trusting any of it

```bash
node docs/defect-reports/repro/verify-all-claims.mjs
```

48 mechanical assertions covering every load-bearing claim in every report, checked against the
**current** contents of the repo. It exits non-zero on any failure. Run it first — this codebase was
under active concurrent edit and reports go stale quickly. Last run: **43 passed, 5 failed** (see below).

## Status — last verified after commit `7a99d81`

| ID | Title | Status |
|----|-------|--------|
| [SLEEP-01](SLEEP-01-night-not-skipped-force-wake.md) | 20s ceiling force-wakes a legitimate sleep | ✅ **FIXED UPSTREAM** — superseded |
| [SLEEP-02](SLEEP-02-hostile-gate-anchored-to-bot.md) | Hostile pre-check duplicated mineflayer, anchored to the bot | ✅ **FIXED UPSTREAM** — superseded |
| [SLEEP-03](SLEEP-03-rejection-outcome-classification.md) | All rejections collapse into one outcome | ⚠️ **PARTLY STALE** — needs revision |
| [AGENDA-01](AGENDA-01-restart-charges-retry-budget.md) | Operator Stop/restart spends a step's retry budget | 🔴 **VALID — and strengthened** |
| [SURVIVAL-01](SURVIVAL-01-forages-at-night-instead-of-sleeping.md) | Hungry idle bot forages in the dark instead of sleeping | 🔴 **OPEN** — not fixed (needs live observation first) |
| [SHELTER-01](SHELTER-01-roof-only-shelter-and-open-doorway.md) | "Sheltered" means only "something overhead" | 🔴 **OPEN** — not fixed (needs live observation first) |
| [SAFETY-01](SAFETY-01-missing-contact-damage-hazards.md) | Three contact-damage blocks missing from the hazard set | ✅ **FIXED** in `3559afc` |
| [SITE-01](SITE-01-any-entity-rejects-whole-build-site.md) | A dropped item rejects an entire construction site | ✅ **FIXED** in `3abea39` |
| [ARBITER-01](ARBITER-01-preamble-throw-wedges-arbiter-silently.md) | Preamble throw wedges the arbiter and defeats its watchdog | ✅ **FIXED** in `48c023b` |

## Open — environment / test signal

| ID | Title | Status |
|----|-------|--------|
| VISION-01 | Static `Camera` import made a broken `canvas` native binary fatal to the whole agent | ✅ **FIXED** in `d214b6d` |

`src/agent/vision/vision_interpreter.js` imported `Camera` statically, which reaches
`prismarine-viewer` → `node-canvas-webgl` → the `canvas` native binary. That binary is currently
unusable on this machine, so the import threw at module load and took down anything that transitively
imports the agent — **including bots with vision switched off**.

Measured before: `tests/control-plane` ran 462 tests with 5 failures across 4 files that could not load
at all (`agent-lifecycle`, `agent-agenda-dispatch`, `agent-persistent-goal-handoff`,
`floodgate-player-identity`). Two of those files hold the regression tests added by commit `7a99d81`,
so that fix's own tests were never executing.

Measured after: **517 tests run, 516 pass.** 59 previously unrunnable tests restored.

The remaining single failure is **pre-existing and unrelated** — `dashboard-lifecycle.test.js` times out
waiting for a start-agent response while standing up a real MindServer on port 15408. It fails in
isolation too, and it was already failing before any change here. It looks like test-infrastructure
timing under load rather than a product defect; it was left alone deliberately.

> The underlying `canvas` binary is still broken. This change makes that non-fatal; it does not repair
> it. Vision itself will still answer `camera_unavailable` until the binary is reinstalled. That was
> left as a decision for the owner because it touches `node_modules` in a live environment.

### Fixes applied here, and how to roll each one back

Each fix is a single self-contained commit touching exactly one source file, so any one can be reverted
without disturbing the others:

```bash
git revert 3559afc   # SAFETY-01  — hazard set, +7 lines
git revert 3abea39   # SITE-01    — entity filter, +8 lines
git revert 48c023b   # ARBITER-01 — try/finally coverage in behavior-arbiter
git revert d214b6d   # VISION-01  — lazy camera module load
git revert 016903a   # test only  — arbiter degraded-tick regression test
```

Each touches exactly one file and none depends on another, so they revert in any order. `016903a` is
test-only; reverting `48c023b` without it leaves a test that correctly fails.

`SURVIVAL-01` and `SHELTER-01` were deliberately **not** applied. Both reorder survival branches that
other behaviour depends on, and both reports ask for one live idle-at-night observation first.
`AGENDA-01` was also not applied because it changes behaviour around Operator Stop, which its own report
says should be driven in a harness before being touched.

The harness above doubles as the regression guard for all three fixes — it now asserts the *fixed* state,
so a future change that reintroduces any of them turns it red.

### What changed underneath these reports

Commit `bdc7e81 fix: keep sleep owned through natural wake` **fixed SLEEP-01 and SLEEP-02** while they
were being written:

- `sleepTimeoutMs = 20_000` became `standaloneSleepTimeoutMs = 600_000`, and — better than this report
  proposed — the deadline is `Number.POSITIVE_INFINITY` whenever an action cancellation signal exists.
  So on the campaign path there is now **no wall-clock deadline at all**, which fully resolves the
  573 s worst-case concern rather than merely out-running it.
- The bot-relative hostile pre-check was **removed entirely**, leaving mineflayer's own bed-anchored
  check as the authority — exactly the package-first correction SLEEP-02 argued for.

`sleep_timeout` no longer exists anywhere in `skills.js` (0 occurrences), so that portion of SLEEP-03 is
obsolete. The `sleep_rejected` collapse it also describes **is still present and still verified**.

### Why AGENDA-01 got stronger, not weaker

Commit `7a99d81 fix: preserve durable work across operator stop` added a restore-time resume path — but
it filters on `entry.executor === 'job'`:

```js
      const stoppedJobEntry = this.entries.find(entry => (
        entry.state === 'active'
        && entry.executor === 'job'
        && entry.executorId
      ));
```

The `direct` lane is untouched. That lane contains `sleep`, `craft`, `goto`, `smelt`, `deposit`,
`visit`, `follow_until`, `farm_visit`, and `maintain_farm` — including the campaign's own final step.
Those still fall through to `agenda_action_result_missing` with `retryable: true`, charging an attempt
against `MAX_ENTRY_ATTEMPTS = 2`.

So this is not a disagreement with the design: the same failure class was recognised and fixed for jobs,
and the identical gap remains for direct steps. All 8 of AGENDA-01's mechanical checks still pass.

## Repros

Runnable from the repo root. Each drives real project code with a fake bot; none touch the server, the
world, or bot state.

```bash
node docs/defect-reports/repro/verify-all-claims.mjs
node docs/defect-reports/repro/sleep-night-not-skipped.repro.mjs
node docs/defect-reports/repro/sleep-hostile-gate-anchoring.repro.mjs
```

The two `sleep-*` repros documented behaviour that has since been fixed upstream; they are retained as
the evidence behind SLEEP-01/02 and now serve as regression checks.

## Ownership note

The concurrent writer's working set moves. As of the last check it was `modes.js`,
`combat-decision.js`, and two tests — so **`combat-decision.js` is now contested** and
`skills.js` is not. Re-check before editing anything.

## Investigated and cleared — do not re-derive

- **`goToBed` pauses `'unstuck'` and never unpauses it.** Not a defect — `beginUpdateCycle` calls
  `unPauseAll()` when idle (`src/agent/modes.js:807-808`), and staying paused during sleep is correct.
- **`waitForBotEvent` is not interruptible** despite living in `interruptible-delay.js`. Single call
  site bounded by `DEFAULT_COOLDOWN = 350` ms. Negligible. Not a defect.
- **Reaction speech throttle** looked fail-silent on a missing config value; `behavior-config.js:176-177`
  bounds both with defaults. Not reachable.
- **Operator-control persistence.** All four durable stores use `writeJsonAtomicSync`, and
  `OperatorControlStateStore.load()` fails **closed** on every error path. A real orphaned `.tmp-*` file
  was found, chased, and proved benign — the atomic write behaved correctly under a hard kill.
- **`survival-director.js` hardcodes `reachable: true`** — real, but on the autonomous search path, not
  the campaign path. Non-blocking; do not act without live evidence.
- **Bed scan-radius asymmetry** (24 vs 32), **`solidCover`'s redundant water/lava guard**, and
  **`clearConstructionCell`'s redundant guards** — all harmless. Leave them.
- **`rotten_flesh` excluded even when critical**, so a starving bot holding only rotten flesh will not
  eat it. Unobserved. Recorded, not raised.
- **`combat-decision.js` omits `piglin` from `RANGED_THREATS`** — nether-only, irrelevant to the
  overworld campaign.
