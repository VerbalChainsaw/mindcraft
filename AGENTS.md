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

An `ACCEPTED / CLOSED` segment is durable evidence, not immunity from later
composition checks. The Director authorized adaptive confidence coverage across
new and old mechanics on 2026-08-21. Run depth follows material uncertainty and
observed failure evidence; it never follows a fixed count or a desire for more
reassurance.

Every physical run must be able to change at least one of these: the mechanic
verdict, the causal owner, the required repair, the player-visible composition
verdict, or a significant risk. Before running, state the exact command, accepted
overlap, load-bearing uncertainty, why saved evidence is insufficient, expected
duration, and provider/subscription/API cost. The standing authorization covers
controlled runs that satisfy this rubric; it does not cover ceremonial reruns.

Use this evidence-saturation sequence:

1. Read saved reports, logs, state snapshots, telemetry, and current source first.
2. Probe a new or changed mechanic at the smallest physical boundary that can
   identify its owner.
3. After a material repair, directly re-exercise the repaired boundary. An
   unchanged retry is valid only when it distinguishes a named stochastic or
   environmental hypothesis.
4. Revisit an old mechanic through the current composed player outcome whenever
   possible. Use a standalone old-mechanic probe only when its owner or dependency
   changed, contradictory evidence exists, or composition cannot isolate it.
5. For historically variable behavior, finish the bounded discriminating matrix
   or equivalent separation question. Continue only while another observation can
   separate a live hypothesis or verify its repair.
6. Stop when the player-visible outcome is directly observed on current source,
   all material variants and interruptions for the tranche are covered, the body
   settles safely, truth and cleanup checks pass, and no unresolved failure can
   change the verdict. Do not add a run that can only increase comfort.

A failed run is progress only when it is classified. The next run must vary one
controlled factor, test a named hypothesis, or verify a repair at the owning
boundary. Never blind-retry the same failure or build a broader verifier when a
narrower existing probe can answer it.

Maintain a visible test ledger using only `PENDING`, `ACTIVE`,
`ACCEPTED / CLOSED`, and `DEAD`. Preserve accepted evidence and name any accepted
overlap traversed by a composed run; do not silently erase or downgrade it.

Treat the user's time, quota, subscription usage, and paid provider usage as
material operation budgets. A run with no plausible material delta is harmful
even when it is reversible.

On provider authentication, quota, billing, rate-limit, or routing failure,
stop and report the exact provider and error immediately. Do not retry, switch
providers, or fall back to an API-key-backed provider without approval. Keep
ChatGPT subscription access and API-project billing explicitly distinct; one
never proves that the other is available.
