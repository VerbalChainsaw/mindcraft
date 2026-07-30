# Codeplan: Single-bot cross-role work

## Contract and safety
- Required behavior: one configured bot can accept durable mining, harvesting, and stockpiling work regardless of its default character role.
- Acceptance criteria: natural player requests route to resumable work orders; the configured role remains the bot's default autonomous behavior and presentation, not a hard capability restriction.
- Must preserve: validated work-order schemas, one-active-order arbitration, ActionManager truth, operator Stop, survival preemption, bounded retries, and existing automatic role behavior.
- Out of scope: squads, profile/provider redesign, construction authorization, runtime restart, and broad testing.

## Repository evidence
- `JobDirector` selects the reducer from `activeOrder.role`, so its execution path already supports a job whose role differs from `agent.runtime.role`.
- `submitRoleOrder()` rejects that supported path before submission whenever the configured role differs.
- Natural-language mining and stockpiling directives are also hidden behind configured-role checks; non-Lumberjack harvesting falls back to a non-durable one-shot command.
- The current product target is one general-purpose companion, making those class locks a direct playability blocker.

## Candidates
- V1 `role-mutation`: temporarily rewrite `runtime.role` for each requested job, then restore it. This couples character identity, reflex policy, telemetry, and work execution and risks restoration errors.
- V2 `order-owned-specialty`: retain the configured role as the default, allow explicit validated work orders of any supported specialty, and route matching natural-language requests to those durable orders.

## PLAN-OUT
[codeplan · single-bot-cross-role-work · PLAN-OUT · mode: constrained · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.55;V2=0.91 · reason: JobDirector already owns execution by work-order role, so removing only the premature class gates expands capability without mutating identity or duplicating runtime logic · planned-fingerprint: existing-module,request-driven,validated-order,result-return]

## Implementation
- Make the submission helper validate director availability/acceptance instead of requiring a matching default role.
- Route mining, harvesting, and stockpiling language to persistent work orders for every configured role.
- Keep automatic no-order behavior role-specific.
- Re-read the touched command/directive paths and perform source formatting inspection only.

## EXEC-OUT
[codeplan · single-bot-cross-role-work · EXEC-OUT · implemented: V2 · confidence: high · verification: source-only · mechanism-check: passed · plan-history: unchanged · evidence: inspected submission, directive, active-order, reducer, ownership, and Stop seams; focused diff formatting passed; runtime intentionally not started]
