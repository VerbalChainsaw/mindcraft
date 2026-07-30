# Attention and dialogue telemetry plan

[codeplan · attention-dialogue-telemetry · PLAN-OUT · mode: full · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.93;V2=0.75;V3=disqualified · reason: add bounded operational state at the existing self-prompt/full-state seam without exposing goal text, chat history, or provider data]

## Candidates

- V1 `bounded-state-projection` (`timestamps`, `counters`, `dialog-state`, `no-raw-goal`): emit goal lifecycle, verified-progress, and conversation/mute state as structured telemetry.
- V2 `full-prompt-mirroring` (`verbose`, `privacy-risk`): copy the full goal and chat history into every heartbeat. Rejected because it can leak credentials or private user text.
- V3 `new-memory/dashboard-engine` (`broad`, `cross-lane`): build a separate attention service. Disqualified because the runtime already owns the relevant truth.

## Ordered changes

1. Record bounded last-turn and verified-progress timestamps inside the self-prompt lifecycle.
2. Project attention state, current no-progress budget, and operator-hold condition into full state without raw goal text.
3. Project dialogue mute/conversation/partner state separately from action status.
4. Inspect source/diff only; do not connect a model, bot, or server.
