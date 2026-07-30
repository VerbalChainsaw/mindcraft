# Codeplan: Squad-aware launcher restart

## Contract and safety
- Required behavior: Restart Mindcraft must preserve active standalone bots and active squads through the replacement launcher, without reporting squad-member names as if they were selectable launcher profiles.
- Acceptance criteria: active squad IDs are captured before shutdown; squads quiesce through their manager; replacement MindServer resumes persisted squad IDs; standalone profiles retain the existing resume path; response wording distinguishes requested restoration from verified online state.
- Must preserve: managed-server desired state, explicit squad Stop state, persisted squad settings, restart recovery, loopback control plane, and concurrent edits.
- Out of scope: broad lifecycle rewrite, test sweep, server restart race redesign, and UI redesign.
- Workspace/user work: extensive live edits present; current `main.js`, `mindcraft.js`, and `mindserver.js` diffs and affected lines were inspected before editing.
- Pre-change evidence: `/api/restart` returned six requested names, but `/api/agents` after handoff contained only launcher-selected `MindcraftBot`; Plumb/Mortar/Timber/Pane/Crate were absent.

## Repository evidence
- `main.js` can resume only names found in configured launcher profiles.
- Squad members are durably owned by `BotSquadManager`, which restores records as stopped and exposes `start(id)`.
- Managed-server restart already separates `activeSquadPlan()` from standalone names and resumes both through their owning lifecycle.
- `Mindcraft.init()` retains the returned HTTP server, allowing a private server-owned control method without a new public API or module-global manager.

## Candidates
- V1 `marker-agent-names,existing-launcher-filter`: keep all names in the marker and teach main to reconstruct missing bots. Disqualified: it duplicates private squad settings/ownership outside BotSquadManager and cannot safely distinguish removed/stopped squads.
- V2 `marker-squad-ids,server-control-method,owner-resume`: carry standalone names and squad IDs separately; attach a private resume method to the created MindServer; delegate persisted squad restart to BotSquadManager after managed Minecraft restoration.

## IN
[codeplan · squad-aware-launcher-restart · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=marker-agent-names,existing-launcher-filter;V2=marker-squad-ids,server-control-method,owner-resume · lean: V2 · conservative: V1]

## Frozen rubric and scoring
- freeze: axes=ownership-fit,state-integrity,recovery-truth,verification-surface,delivery-cost classes=quality,risk,risk,quality,convenience weights=3,3,3,2,1 denominator=60 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer
- V1: disqualified by ownership/state-integrity gates.
- V2: 5,5,4,4,3 = 53/60 = 0.88.
- Formal baseline V2 because V1 is not an eligible gate passer.

## PLAN-OUT
[codeplan · squad-aware-launcher-restart · PLAN-OUT · mode: constrained · profile: compact · pick: V2 · baseline: V2 · confidence: high · beatBaseline: baseline-wins · scores: V1=disqualified;V2=0.88 · reason: only the squad manager can reconstruct persisted members without duplicating private settings or reviving a stopped squad by name · planned-fingerprint: marker-squad-ids,server-control-method,owner-resume]

## Ordered changes
- Read one bounded restart plan in `main.js` instead of consuming only names.
- Expose a private squad-resume method on the current MindServer through `mindcraft.js`.
- Capture active squad IDs and exclude their members from standalone resume names.
- Quiesce squads before replacement and include separate requested restoration fields in the handoff response.
- Resume persisted squads after managed Minecraft is restored and before selected standalone profile launch completes.
- Record source-only evidence; no broad tests.

## Implementation and evidence
- Restart plans now contain bounded `resumeAgentNames` and `resumeSquadIds` fields.
- The old process quiesces active squads through their owner and restores both lifecycle classes on every early failure path.
- The replacement launcher delegates persisted squad restoration to a private MindServer control method; it does not reconstruct member settings in `main.js`.
- Resume results require `running`; `partial`, `failed`, missing, and >60-second settlement outcomes remain failures.
- The persistent source console is running at port 8080. The previously dropped Builder Brigade accepted a real `squad-start` request there. Gameplay/member completion was intentionally not polled.

## EXEC-OUT
[codeplan · squad-aware-launcher-restart · EXEC-OUT · implemented: V2 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: restored early-failure gameplay recovery and made partial squad resume fail truthfully · evidence: pre-fix restart reproduced the dropped squad; source handoff installed on port 8080; persisted squad start accepted; final live member state deferred]
