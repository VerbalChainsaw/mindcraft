# Agent bootstrap

Read these repository authorities completely, in order:

1. `ARCHITECTURE.md` — the sole active architecture, migration plan, closed paths,
   phase ledger, and open questions.
2. `docs/CAMPAIGN-RECORD.md` — the canonical physical-evidence and
   `ACCEPTED / CLOSED` non-regression ledger.
3. `docs/HANDOFF.md` — the exact current tranche or an explicit statement that no
   gameplay tranche is authorized.

Lodestar is muted for this repository while its replacement is built. Do not run
`lodestar start`, `get`, `find`, `links`, `work`, `handoff`, or `decision` for
project context. If a host injects project-scoped Lodestar state anyway, treat it
as deprecated non-authoritative history and use the three repository authorities
above. Global system instructions remain binding.

Supporting documents and saved artifacts are evidence, not work orders.
`docs/archive/` is history. Do not create another architecture, roadmap, master
plan, review packet, session handoff, or parallel ruleset.

Work only within the user-authorized tranche and the smallest seam required to complete it. Preserve all dirty, staged, untracked, and concurrent work. Never reset, stash, clean, checkout, revert, commit, push, change dependencies, launch the game, or mutate runtime or world data unless explicitly authorized.

Current source, runtime observation, and discriminating probes outrank summaries and static speculation. Tests and audits support evidence; they do not replace the requested physical outcome. Never claim success without direct support. Stop when the requested outcome and required verification are materially complete.

## Test execution discipline

An `ACCEPTED / CLOSED` test segment is durable evidence. Do not rerun, reopen,
or implicitly traverse it unless the user explicitly authorizes that exact
repetition. A later change to telemetry, provider routing, harness behavior,
aggregation, cleanup, or an adjacent subsystem does not reopen accepted
gameplay mechanics.

General persistence instructions such as "continue," "finish," "keep going,"
"work overnight," or "do not stop" authorize progress only inside the current
untested boundary. They do not authorize another full campaign, confidence
rerun, or traversal of accepted segments. A HANDOFF requirement names an
acceptance target; it does not silently authorize repeated execution after the
relevant segment has already been accepted.

Before any command that would repeat or traverse accepted work, stop and report:

1. the exact command;
2. every accepted segment it would repeat;
3. why saved evidence or a narrower probe cannot answer the question;
4. the expected duration and provider, quota, or paid-service cost.

Run that command only after explicit per-run authorization. If the available
verifier is broader than the unresolved boundary, ask whether to build or use a
narrow probe or authorize the broad repetition. Never choose the broad verifier
automatically.

Use the smallest discriminating probe for the current unresolved boundary.
Inspect saved reports, logs, state snapshots, telemetry, and artifacts before
new physical execution. Once the authorized acceptance criteria, including any
explicitly required repetitions, are satisfied, mark the segment
`ACCEPTED / CLOSED` and stop. Do not add adjacent tests, extra confidence runs,
or the next segment without direction.

Maintain a visible test ledger using only `PENDING`, `ACTIVE`,
`ACCEPTED / CLOSED`, and `DEAD`. Never silently move an accepted segment back to
active. If the user says a segment was already tested, close it immediately;
do not use a plan, HANDOFF, campaign, or general autonomy instruction to argue
that it must run again.

Treat the user's time, quota, and paid provider usage as material operation
budgets. An unnecessary long-running or repeated test is a materially harmful
action even when it is otherwise reversible.

On provider authentication, quota, billing, rate-limit, or routing failure,
stop and report the exact provider and error immediately. Do not retry, switch
providers, or fall back to an API-key-backed provider without approval. Keep
ChatGPT subscription access and API-project billing explicitly distinct; one
never proves that the other is available.
