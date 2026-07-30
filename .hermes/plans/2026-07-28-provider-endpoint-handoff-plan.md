# Codeplan: Selected provider endpoint handoff

## Contract and safety
- Required behavior: the selected Bot Library provider, model, base URL, and request parameters must survive preflight and construct every applicable runtime model with the same configuration.
- Acceptance criteria: primary chat validation sees the full provider object; same-provider code/vision/embedding roles inherit the selected endpoint/params; a different explicitly prefixed secondary provider remains independent; fallback embedding construction retains the chat endpoint; unsupported/missing endpoint failures remain precise.
- Must preserve: legacy string profiles, provider prefixes, credential lookup by environment name, no secret serialization, provider-neutral agent process transport, and existing Bot Library shape.
- Out of scope: new providers, storing API-key values, network readiness calls, UI, process restart, and tests.

## Repository evidence
- Bot Library maps `provider.baseUrl` to `settings.profile.url`.
- `Prompter` calls `selectAPI(this.profile.model)` and repeats this for secondary model strings, so `profile.url` and `profile.params` never reach `createModel`.
- Fallback embeddings use only `{ api }`, losing the selected URL and params again.
- Profile preflight calls `describeModelProvider(settings.profile.model)` on a bare string; `openai_compatible` therefore appears to lack its mandatory URL and is blocked before spawn.

## Candidates
- V1 `string-only-construction`: keep model strings as the runtime contract and let providers fall back to hard-coded endpoints.
- V2 `configured-role-resolution`: resolve each role into `{ api, model, url, params }`, inheriting shared endpoint configuration only when the resolved provider matches the selected primary provider.

## PLAN-OUT
[codeplan · provider-endpoint-handoff · PLAN-OUT · mode: constrained · profile: compact · pick: V2 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.18;V2=0.98 · reason: V2 preserves legacy provider inference while making the saved endpoint an actual runtime input rather than dead configuration · planned-fingerprint: existing-modules,provider-neutral,validated-input,no-secret-persistence]

## Implementation
- Add one model-role resolver in the model map that clones inputs, preserves explicit secondary providers, and inherits endpoint/params only for the matching primary provider.
- Use it in profile preflight for chat/code/vision/embedding descriptions.
- Use it in Prompter for chat/code/vision/embedding construction, including embedding fallback.
- Re-read changed source and run syntax/diff formatting only.

## EXEC-OUT
[codeplan · provider-endpoint-handoff · EXEC-OUT · status: installed-source · fidelity: full · runtime-activation: deferred · verification: syntax,diff-format,line-reread · result: the selected primary provider URL and shared params now reach preflight, runtime construction, provider readouts, and fallback embeddings; explicitly different secondary providers remain self-contained]
