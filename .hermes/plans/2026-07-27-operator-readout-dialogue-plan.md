# Codeplan: operator readout and direct-dialogue truth

## Contract and safety
- Required behavior: expose the bot's actual hold/stop, attention, dialogue, and verified target state wherever operators choose or supervise it; only show a direct chat message after MindServer accepts its relay.
- Acceptance criteria: a held or unresponsive Stop is unmistakable; attention/dialogue state is visible without raw prompt or private chat data; each existing readout uses the same labels; a disconnected, missing, invalid, or relay-failed bot message yields an actionable rejection instead of optimistic history.
- Must preserve: legacy telemetry fallback, current Socket.IO/admin ownership checks, provider secrecy, existing UI shell geometry, and unrelated dirty work.
- Out of scope: starting services, changing bot/server lifecycle policy, durable activity storage, broad redesign, and runtime tests (explicitly deferred by the user).
- Workspace/user work: present; `src/mindcraft/public/js/` is an untracked concurrent surface and `src/mindcraft/mindserver.js` is already modified.
- Pre-change checks: source contract inspection only; no live process or test activity by user instruction.

## Repository evidence
- Current pattern: `utils.js` already owns normalized telemetry labels; Agents, Home, Director, and Server import it directly.
- Current defect: `AgentsWorkspace.send()` records a command before `mindserver.js` has accepted it; the relay handler currently has no acknowledgement path.
- Current state contract: `full_state` emits bounded `action`, `attention`, and `dialogue` fields; existing UI only renders generic action state.
- References: `src/mindcraft/public/js/{utils,agents,dashboard,director,minecraft-server}.js`; `src/mindcraft/mindserver.js`.

## Mode
- Candidate mode: constrained
- Candidate count: 2
- Record profile: compact
- Reason: two materially credible ways exist to normalize existing state across four screens.

## Candidates
- V1 `shared formatter + existing Socket.IO acknowledgement` (`existing-helper,additive-readouts,result-return,zero-dep`): add pure, legacy-safe labels in `utils.js`, consume them in the four existing surfaces, and have the existing direct relay callback return structured acceptance/rejection.
- V2 `new runtime readout view-model` (`new-module,derived-state,event-adapter,zero-dep`): create a dedicated browser-side state adapter and migrate the four surfaces to it, while adding relay acknowledgement.

## Divergence
- V1↔V2: V1 extends the established shared utility boundary with a small additive diff; V2 introduces a new state ownership layer that could centralize future views but duplicates runtime-state interpretation during concurrent UI work.

## Paper gates
- V1 task fulfillment: pass — displays the exact emitted states and reports relay acceptance.
- V1 contract preservation: pass — all helpers tolerate absent legacy fields and keep existing payload shapes.
- V1 privacy: pass — labels intentionally omit raw goal text, conversation content, and provider data.
- V1 verification feasibility: pass — source/diff contract inspection is available; visual/live proof is intentionally deferred.
- V2 task fulfillment: pass — can normalize the same fields.
- V2 contract preservation: pass — feasible but creates a second client state boundary.
- V2 privacy: pass — feasible with the same sanitization rules.
- V2 verification feasibility: pass — source/diff only, but the extra layer enlarges untested surface.

## IN
[codeplan · operator-readout-dialogue · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=shared-formatter-existing-ack;V2=new-readout-view-model · lean: V1 · conservative: V1]

## Frozen rubric and scoring
- freeze: axes=architecture-fit,truthful-control,operator-clarity,regression-risk,delivery-cost classes=quality,quality,quality,risk,convenience weights=3,3,2,3,1 denominator=60 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer
- V1: 5,5,4,5,5 = 58/60 = 0.97 — follows the existing shared utility pattern and changes no source-of-truth ownership.
- V2: 3,4,5,3,2 = 42/60 = 0.70 — clearer long-term centralization, but a new derived-state layer makes the untested concurrent UI surface larger.
- arithmetic verification: (5*3)+(5*3)+(4*2)+(5*3)+(5*1)=58; (3*3)+(4*3)+(5*2)+(3*3)+(2*1)=42.
- formal baseline: V1 (lowest effort eligible gate passer).
- selection stability: V1 exceeds V2 by 0.27.

## PLAN-OUT
[codeplan · operator-readout-dialogue · PLAN-OUT · mode: constrained · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1=0.97;V2=0.70 · reason: existing shared labels and the current Socket.IO callback convention deliver truthful supervision with the smallest safe ownership surface. · planned-fingerprint: existing-helper,additive-readouts,result-return,zero-dep]

## Implementation plan
- Files/boundaries: shared browser labels, four established readout surfaces, and the existing dashboard-to-agent relay.
- Ordered changes: add safe presentation helpers; consume them in Agents, Home, Director, and Server; acknowledge relay outcomes before appending direct-chat history; record the defect and source evidence.
- Contract checks: no raw dialogue/goal fields rendered; failed relay produces an error; legacy state remains readable.
- Tests/checks: source and diff inspection only; no test, build, server, or bot execution under the user's current instruction.
- Rollback: additive helpers and UI rows can be removed independently; relay response stays within existing `{ success, error }` response convention.

## Implementation and evidence
- Changes: V1 shared presentation helpers added to `utils.js`; Bot, Home, Director, and Server cards consume the same bounded control/attention/dialogue/target/recovery labels; the existing direct `send-message` relay now validates the dashboard agent name and returns structured acceptance/rejection before local chat history is updated.
- Pre/post comparison: prior views showed generic activity and optimistic dialogue history; the new views distinguish active/paused/held attention, dialogue mode, verified target, and Stop recovery while direct chat records only a relay acknowledgement.
- Active evidence gates: planned-fingerprint conformance passed by source inspection; privacy boundary passed by inspection (no raw goal or chat content rendered); visual, runtime, and test gates not run at the user's instruction.
- Corrections/re-plan: none; implementation remains within the selected existing-helper/additive-readout/result-return fingerprint.

## EXEC-OUT
[codeplan · operator-readout-dialogue · EXEC-OUT · implemented: V1 · confidence: low · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: none · evidence: source inspection of the six selected boundaries only; no browser, bot, server, model, build, or test execution by user instruction]
