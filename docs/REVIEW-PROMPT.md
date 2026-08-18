# Prompt for an external reviewer

Copy everything below the line and give it to the reviewing agent along with
read access to `docs/` and the repository.

---

I need an independent technical review of a Minecraft companion bot's core
engine design. I am not asking you to validate it. **A review that agrees with
everything is a failed review.**

## What the project is

A Minecraft companion ("Kevin") built by a father for his son. Node.js,
`mineflayer` + `mineflayer-pathfinder` + `mineflayer-collectblock`, against a
Paper 1.21.11 server. An LLM chooses commands; roughly 150 registered commands
map to skills in `src/agent/library/skills.js` (~25,000 lines).

The acceptance test is not a benchmark. It is a child asking for something in
plain language and getting it.

The problem: the bot refuses things it is demonstrably capable of, and cannot
switch tasks without a human scripting the seam.

## How to read this, in this order

**Step 1 — form your own diagnosis first.** Read `docs/ENGINE-DOSSIER.md`
**§1 only** (seven failures, quoted verbatim from live server and action logs).
Stop there. Write down what you think the root cause is and what you would
change, before reading anyone else's conclusion. This step exists specifically
to stop you anchoring on the analysis that follows.

**Step 2 — read what has actually worked.** `docs/CAMPAIGN-RECORD.md` is the
project owner's own archaeology over months of live runs: 28 strong or complete
campaign outcomes, 35 partials with verified physical success, three commit
anchors including a 10/10 clean repeatability run. **This is not a broken
project.** Many complex chains provably worked — craft→equip→return→hold, mine an
exact quantity→deliver, interrupt→retreat→resume the same task→arrive. Treat
that record as evidence to be preserved, not as claims to be doubted. If your
proposal would lose any of those behaviours, say so explicitly.

**Step 3 — now read the rest.** `docs/ENGINE-DOSSIER.md` §2–§8 (diagnosis,
research, proposed architecture, code examples, change list, open risks),
`docs/ENGINE-RESEARCH.md` (sourced research on Baritone and on
GOAP/behavior-tree/utility paradigms), `docs/REVIEW-PACKET.md` (dead list,
reproduction, and a disclosed list of the previous assistant's errors).

Compare against what you wrote in step 1. Where you disagree, say so plainly.

## Do not spend time on these

`docs/REVIEW-PACKET.md` contains eight items labelled **DEAD**, each investigated
to conclusion with the evidence that closed it. Re-deriving them wastes your
budget. If you believe one was closed wrongly, challenge it — but check the
stated evidence first.

Most relevant: there is **no known-good commit to roll back to**. Most of the
successful campaigns ran from a dirty working tree. Recovery has to be
replay-and-repair at HEAD.

## What I want from you

**1. Is the diagnosis right?** The claim is that every failure has one shape:
project code answering a question the engine had already answered, answering it
worse, and reporting its own answer as a fact about the world. Two structural
causes are proposed — private planners duplicating pathfinder, and no lifecycle
owning a plain-language request. Is that the actual root cause, a symptom of
something deeper, or an over-fit narrative built from seven incidents?

**2. Is the proposed architecture correct?** Three layers: LLM chooses goals and
permissions; a utility arbiter owns the request lifecycle and preempts by asking
the running action whether it is safe to cancel; one engine (pathfinder) owns the
action topology, planning in committed segments rather than whole routes. States
are contracts — permissions, goal, acceptance test, budget — and are forbidden to
contain a search.

Specifically challenge:
- Is **utility scoring** the right arbiter for a *companion*, where the player's
  request should usually dominate? Or does that argue for request-first policy
  with utility only in the idle case?
- Does the four-outcome vocabulary (`did` / `engine_cannot` / `we_will_not` /
  `unknown`) survive contact with ~150 existing commands, or does it need a fifth
  state for partial success?
- Is "a state may not contain a search" too strict? Name a case where a local
  search is genuinely necessary.

**3. External library analysis — go deep here, and do not accept "the library
can't do that."** We are willing to fork and modify `mineflayer-pathfinder`,
`mineflayer-collectblock`, or anything else.
- Read `mineflayer-pathfinder`'s actual source. One claim in the dossier is that
  `index.js:138` already loops on `status === 'partial'` and that project code
  discards it. **Verify that claim independently.** If it is wrong, the
  highest-priority recommendation in the document collapses.
- How does its `Movements` model compare to Baritone's `Moves` enum with
  per-movement `calculateCost`? Is "policy lives only in `Movements`" actually
  expressible, or are there vetoes it cannot represent?
- Does mineflayer-pathfinder need Baritone's multi-coefficient incremental cost
  backoff ported, or is its partial-segment selection adequate?
- Is there prior art we have missed — other mineflayer agent frameworks,
  Baritone's Java architecture, MineRL/Voyager-style LLM agents, or robotics
  behavior-tree libraries — that solves the interrupt-and-resume problem better?

**4. What is missing?** More useful than critiquing what is written. What
question has nobody asked? What failure mode does the proposed design introduce
that the current one does not have?

**5. The unexplained result.** Seven fixed test cases, four consecutive runs:
3/7, then 5/7, then 5/7 with *different members*, then 4/7. Same code, same
cases. The hypothesis is that with no request lifecycle, completion depends on
the model staying lucky. That is untested. Is there a more likely explanation —
non-determinism in world setup, LLM sampling, timing, test isolation?

## Calibration

The documents were written by an AI assistant that made at least seven
documented errors during the session that produced them, listed in
`REVIEW-PACKET.md`. Two are worth weighting your reading:

- It verified multiple fixes against a *test* profile while the shipping bot runs
  a different one, so hours of "verified" work never reached the real bot.
- It reported a metric as a measurement when the number came from a crash path.

Its own stated lesson was that **claims verified through the same layer that
produced the failure are unreliable**. Apply that to its documents. The evidence
in §1 is quoted from server and action logs rather than from its summaries,
specifically so you can check it — do check it.

## Output I want

- Your independent step-1 diagnosis, written before you read the analysis.
- Agree / disagree / uncertain on each of the two structural causes, with
  reasoning.
- Your verdict on the three-layer architecture, including anything you would cut
  or add.
- Your library findings, including the independent verification of the partial
  path claim.
- The single highest-value change you would make first, and why it beats the
  document's own first recommendation (execute partial paths instead of
  discarding them).
- Anything in `CAMPAIGN-RECORD.md` that the proposed design would break.
