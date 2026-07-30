# Codeplan: Guided bot setup and truthful spawn

## Contract and safety
- Required behavior: one obvious saved-character setup and spawn path; cloud keys configured server-side; defaults use the managed Minecraft target; advanced character/model settings stay available without blocking basic setup.
- Acceptance criteria: a new bot defaults to a ready provider when one exists, uses the effective managed host/port, can save and spawn from the same form, and the Dashboard single-bot deployer launches that same saved profile.
- Must preserve: Bot Library records, provider secrets, agent lifecycle APIs, squads, legacy configured agents, dirty concurrent work.
- Out of scope: remote process hosting implementation, provider billing/account creation, live model/server verification.
- Workspace/user work: present; affected dashboard/library files are untracked concurrent work and will be patched surgically.
- Pre-change checks: source/data inspection only; no test suite or regression sweep per user direction.

## Repository evidence
- `public/js/dashboard.js` has two competing single-bot paths: configured-agent deploy and a separate Bot Library quick-spawn strip.
- `public/js/bot-library.js` exposes identity, behavior, provider, advanced models, and connection fields at once and cannot save a provider key.
- `mindserver.js` already owns the safe `/api/keys` boundary and exposes credential presence without returning secrets.
- The saved profile uses port `25565`; effective launcher configuration uses `25578`. Only `DEEPSEEK_API_KEY` is present.

## Mode
- Candidate mode: constrained
- Candidate count: 2
- Record profile: compact

## Candidates
- V1 `existing-form,progressive-disclosure,existing-api,result-return`: keep the Bot Library model, expose only essential fields, use collapsed advanced sections, add transient key saving through `/api/keys`, return effective defaults in the catalog, and make Dashboard single deploy consume Bot Library profiles.
- V2 `wizard,new-state-machine,existing-api,result-return`: replace the editor with a four-step wizard and draft state, then launch from a review step.

## Divergence
- V1↔V2: V1 preserves the existing editor and persistence boundary; V2 introduces step navigation, draft lifecycle, and recovery state across every edit.

## Paper gates
- V1: pass — satisfies the setup/spawn contract with no schema migration or new dependency.
- V2: pass — can satisfy the contract, but materially expands UI state and dirty-file collision risk.

## IN
[codeplan · guided-bot-setup-spawn · IN · mode: constrained · profile: compact · confidence: high · candidates: V1=progressive-disclosure/existing-api;V2=wizard/new-state-machine · lean: V1 · conservative: V1]

## Frozen rubric and scoring
- freeze: axes=operator-clarity,contract-fit,risk-reversibility,maintainability,delivery classes=quality,quality,risk,quality,convenience weights=3,3,3,2,1 denominator=60 unknown-policy=interval baseline=lowest-effort-eligible-gate-passer
- V1: 4,5,4,4,4 = 51/60 = 0.85
- V2: 5,4,2,3,2 = 41/60 = 0.68
- arithmetic verification: `(4*3+5*3+4*3+4*2+4)/60=0.85`; `(5*3+4*3+2*3+3*2+2)/60=0.6833`.
- formal baseline: V1.
- selection stability: V1 leads by 0.17 with lower irreversible surface.

## PLAN-OUT
[codeplan · guided-bot-setup-spawn · PLAN-OUT · mode: constrained · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: baseline-wins · scores: V1=0.85;V2=0.68 · reason: the existing Bot Library can become understandable without a second editor state machine or schema migration · planned-fingerprint: existing-form,progressive-disclosure,existing-api,result-return]

## Implementation and evidence
- Changes: Bot Library now consumes server-issued provider and Minecraft defaults, separates essential character/AI settings from collapsed advanced controls, reports provider readiness in plain language, and provides a single save-and-deploy path with truthful accepted/failed status. Saved cards use `Check AI` and `Deploy Bot`.
- Active evidence gates: source inspection plus live narrow visual inspection; tests intentionally not run.

## EXEC-OUT
[codeplan · guided-bot-setup-spawn · EXEC-OUT · status: implemented · scope: bot-library-guided-setup · evidence: live-source-ui · tests: intentionally-deferred]
