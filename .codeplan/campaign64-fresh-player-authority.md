[codeplan · campaign64-fresh-player-authority · IN · mode: full · confidence: high · candidates: V1 clear-on-Stop (eager-cancel), V2 clear-on-fresh-authority (transactional-handoff), V3 scoped-release-restore (temporary-lease) · lean: V2 · baseline: V1]

## Decision boundary

An explicit Stop intentionally preserves durable Agenda work, but the next
fresh direct physical command currently releases the persisted Hold without
reconciling that queue. The stale requester can then regain movement authority
through Agenda or critical-survival recovery. The repair must preserve actual
pause/resume, construction compilation Holds, terminal waits, explicit
`!resumeStructureJob`, active unheld Agenda work, and fail closed if the queue
cancellation is not durable.

## Codebase calibration

- `Agent.handleMessage` is the shared authority boundary for forced,
  deterministic-NL, and model-selected player commands.
- `AgendaDirector.clear` already owns typed cancellation and atomic store
  persistence; movement, ActionManager, SurvivalDirector, and Pathfinder are
  downstream nonowners.
- Quality axes are semantic authority, persistence safety, consistency across
  command routes, compatibility with intentional resume, testability, and
  blast radius. No dependency, schema, or physical mechanic change is allowed.

## Variants and gates

### V1 — clear on Stop (`eager-cancel`)

Change `!stop` to cancel unfinished Agenda immediately.

G: fail — it destroys the established pause/resume contract and makes
`!resumeStructureJob` unable to resume intentionally preserved work.

### V2 — clear on fresh authority (`transactional-handoff`)

Add one Agent authority helper used by all three direct player-command paths.
Only when the current Hold is an actual operator Stop and the incoming command
is a fresh physical action, durably cancel unfinished Agenda before releasing
the Hold. Explicit resume and non-operator Holds remain untouched. Refuse the
new action and retain Hold when persistence fails.

G: pass — fixes the first unproven boundary, reuses the Agenda owner, preserves
pause/resume, and converges all direct routes on one invariant.

### V3 — scoped release and restore (`temporary-lease`)

Release Hold only while the direct command executes, then restore it so stale
Agenda remains suppressed.

G: fail — it does not implement the existing rule that fresh player authority
supersedes the held queue, creates a lifecycle race around asynchronous action
settlement, and leaves stale requester identity durable.

## Scoring

Only V2 passes all non-compensatory gates. V1 is the lowest-effort baseline but
cannot beat the compatibility gate. V3 is more complex while preserving the
defect. V2 is selected without compensatory scoring because no second viable
candidate remains.

[codeplan · campaign64-fresh-player-authority · OUT · mode: full · pick: V2 · confidence: high · beatBaseline: yes · scores: V2 sole gate-passer · reason: reconcile at the shared player-authority boundary before Hold release · mechanism-check: passed · corrected: C0 Stop-erasure narrowed to fresh-authority handoff]
