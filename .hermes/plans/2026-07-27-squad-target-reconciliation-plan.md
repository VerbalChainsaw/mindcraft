# Codeplan: Squad target reconciliation

## Contract
- Required behavior: a squad launched or resumed against the managed Java world must use that world's current authoritative host and port.
- Preserve: external-server profiles when the managed world is not running; saved squad identity/runtime/persona; lifecycle ownership; explicit Stop.
- Evidence: managed world is running at `127.0.0.1:25579`; all five persisted Builder Brigade members are saved at `127.0.0.1:25578` and fail with network timeouts.

## Candidates
- V1 `manager-prepare-hook,authoritative-running-target,settings-refresh`: inject a bounded settings-preparation hook into BotSquadManager, refresh persisted/member connection settings immediately before create/restart, and update the registered AgentConnection before restarting an existing process.
- V2 `bulk-storage-migration,startup-rewrite`: rewrite every persisted squad record when MindServer starts.

## Decision
[codeplan · squad-target-reconciliation · PLAN-OUT · mode: constrained · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: baseline-wins · reason: reconcile only at the lifecycle boundary where the running managed target is authoritative, while leaving external/stopped-world profiles untouched · planned-fingerprint: prepare-hook,running-target,registered-settings-refresh]

## Evidence gate
- Source inspection plus the requested source-console restart. Replacement resumed the persisted Builder Brigade, reconciled all five member settings from `25578` to the running managed target `25579`, and all five lifecycle owners report `running`.
- No gameplay command, provider call, broad regression sweep, build, or test suite was run.

## EXEC-OUT
[codeplan · squad-target-reconciliation · EXEC-OUT · status: implemented-and-activated · evidence: source-console-restart,5-running,reconciled-25579 · tests: intentionally-deferred]
