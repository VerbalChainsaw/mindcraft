# Doorway/corridor follow decisive replay ├óΓé¼ΓÇ¥ 2026-08-03

Outcome: passed on the declared frozen fixture.

The replay executed candidate `18206eceb023547c3f78f45e3de5164d47989c95` from clean catalog-binding commit `2a8dfe2ecc2950561748326a9fc541264f746415`, using manifest `release-0.1.v6` (`0bb57f7aa19e6ac56aac6dbc59bcc4b6521af5b57c746a79980936e5a664b362`). Direct and deterministic-natural-language requests ran from independent world restores.

| Form | Exit | Doorway | Corridor | Final waypoint | Stable 10 s | Duration |
|---|---:|---:|---:|---:|---:|---:|
| Direct | 0 | yes | yes | yes | yes | 23,154 ms |
| Deterministic NL | 0 | yes | yes | yes | yes | 19,212 ms |

Both invocations had complete correlated evidence, zero external retries, zero false-success observations, and no death, conflict, timeout, unsafe state, missing field, missing evidence marker, or safety violation. Configuration, server properties, and pre-run memory were restored; replay memory/world evidence was preserved; the repository remained clean; no managed Java process or runtime lock remained.

The exact canonical plan, result, and run summary are stored beside this file. `verification-record.v1.json` adds the selected physical metrics, restoration outcome, fixture hashes, and SHA-256 values for the source artifacts. High-volume raw samples and post-run world captures remain in the retained task artifact set `follow-decisive-fixed-20260803-162401`; its detached receipt SHA-256 is `a6badd2cb86b6888096d19b09ad7c47f1dd86e4c15b8c764ed31b0a430caecab`.

Scope is deliberately narrow: this proves one direct plus one deterministic-NL replay on one frozen fixture. It does not prove cross-seed generalization, satisfy the ten-independent-run gate, perform instrumentation off/on comparison, complete the Scenario Lab, or authorize Release B architecture.
