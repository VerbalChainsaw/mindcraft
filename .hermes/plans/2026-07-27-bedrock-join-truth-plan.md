# Codeplan: Bedrock join truth

## Contract and safety
- Required behavior: distinguish installed, configured, UDP-running, same-PC-enabled, and actually joined Bedrock states.
- Acceptance criteria: the UI never says Ready from configuration alone; an actual Floodgate-backed player join can produce a bounded verified state for the current Java runtime.
- Must preserve: Paper/Java authority, Mineflayer Java endpoint, Geyser/Floodgate lifecycle, loopback controls, LAN/local access distinction, dirty concurrent work.
- Out of scope: synthetic Bedrock protocol client, external network exposure, account automation.
- Workspace/user work: extensive dirty concurrent work present; inspect hashes and exact regions immediately before edits.
- Pre-change checks: live server reports Paper running, Geyser UDP ready, Floodgate configured, Windows client detected, loopback disabled, and no join-verification field.

## Repository evidence
- `ManagedMinecraftServer.appendLog()` already owns authoritative Paper/Geyser lifecycle observations.
- Floodgate config supplies a distinct username prefix; the live config uses `"."`.
- Dashboard adapters already consume structured `crossplay` state and keep Java, Bedrock, and client controls separate.

## Candidates and gates
- V1 `ui-derived,configuration-only,zero-backend`: downgrade the badge to “Configured · test join.” Truthful, but cannot ever verify a successful Bedrock join.
- V2 `runtime-observer,structured-state,current-generation`: observe a real Floodgate-prefixed Paper join, reset at each Java start, expose bounded verification state, and render it everywhere.
- V1 passes preservation and simplicity but is weak on operational completion.
- V2 passes task fulfillment, preservation, privacy, performance, and verification feasibility; log matching is constant-time and event-driven.

## IN
[codeplan · bedrock-join-truth · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=ui-derived/configuration-only/zero-backend;V2=runtime-observer/structured-state/current-generation · lean: V2 · conservative: V1]

## Frozen rubric and scoring
- freeze: axes=architecture-fit,truthfulness,operability,risk-reversibility classes=quality,quality,quality,risk weights=3,3,3,2 denominator=55 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer
- V1: 4,3,2,5 = 37/55 = 0.67
- V2: 4,5,5,4 = 50/55 = 0.91
- formal baseline: V1
- selection stability: V2 exceeds V1 by 0.24 with no unknown axis.

## PLAN-OUT
[codeplan · bedrock-join-truth · PLAN-OUT · mode: constrained · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.67;V2=0.91 · reason: runtime observation is the smallest mechanism that can both avoid false readiness and later prove a real Bedrock join · planned-fingerprint: runtime-observer,structured-state,current-generation]

## Implementation plan
- Add bounded Floodgate-prefix inspection and current-runtime join observation to `managed-minecraft-server.js`.
- Expose `crossplay.joinVerification` without changing existing readiness fields.
- Render “Configured · test join” until observed, then “Join verified,” with an explicit verification check.
- Keep Dashboard and shell status concise while surfacing unverified versus verified.
- Activate through the requested source-console restart and visually inspect live surfaces; no broad regression sweep.

## Implementation and evidence
- Added current-runtime Floodgate join observation and `crossplay.joinVerification`.
- Replaced configuration-derived `Ready on this PC` with `Configured · test join` until verified.
- Dashboard and system rail now reserve green success for an observed Bedrock join.
- Activation constraint: another agent expanded the live runtime to ten bots and a second squad during this slice. Frontend source can be inspected without disrupting it; backend activation remains pending.

## EXEC-OUT
[codeplan · bedrock-join-truth · EXEC-OUT · implemented: V2 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: none · evidence: source contract implemented; live pre-change state proves missing field; backend restart deferred to preserve concurrent ten-bot runtime]
