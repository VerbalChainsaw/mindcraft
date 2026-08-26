# Q&A Log — session Q&A (Director rules, Rule 2)

Format: each entry stores the question and the answer verbatim. No question in this
log is closed until the Director answers it. Rules from `AGENTS.md` and the
Director's hand-entered overrides are authoritative.

---

## Q-001 — Phase 4: implement or stop?

- **Asked:** 2026-08-19 (Director session, after delivering the Phase 4 pre-audit)
- **Question (verbatim):**
  > "Want me to proceed with implementing Finding 1 + the four flags (smallest
  > reversible slice), or stop here with the classification?"
- **Answer:** PENDING — the Director instead directed writing the pre-audit to
  `PHASE4-PRE-AUDIT.md` for Codex. That answers the deliverable's location, not
  whether the Director authorizes the implementation slice. Per Rule 2, no work
  proceeds on this until answered.
- **Options offered:** (a) implement Finding 1 (`probeSafeNavigationGoal` +
  `conclusive`) + the four reversible flags; (b) stop at the classification and
  hand off to Codex.
- **2026-08-20 source revalidation:** Option (a) is not recommended as written.
  Current source confirms the `probeSafeNavigationGoal` -> `goToGoal`
  inconclusive-to-`path_not_found` defect, but also shows that
  `probeSafeNavigationStances` drops `conclusive` on its normal return path.
  Implementing all four flags together would exceed the smallest proven repair
  boundary. The recommended answer is to authorize one narrow Phase 4 tranche:
  propagate the probe result contract and make `goToGoal` distinguish conclusive
  `noPath` from inconclusive `partial` / `timeout` / probe failure. Per-consumer
  demotions remain separate, evidence-gated tranches.
- **Answer (2026-08-19, Director, supersedes the recommendation above):**
  "Stop at classification (Recommended)" — the classification in
  `PHASE4-PRE-AUDIT.md` is the deliverable; Codex owns implementation. No Phase 4
  code changes by this session. The 2026-08-20 revalidation note remains
  preserved as context for the Codex implementation tranche.
- **Answer (2026-08-20, Director, supersedes the 2026-08-19 stop):**
  > "1: Authorized"
  The source-revalidated narrow Phase 4 tranche is authorized. This does not
  authorize the original four-flag bundle or any accepted-campaign rerun.

---

## Q-002 — Rule 3 (zero artificial caps) vs. existing engine bounds

- **Asked:** 2026-08-19
- **Question:**
  > Rule 3 forbids artificial caps. Existing engine code contains hard bounds
  > such as `MAX_CHARCOAL_QUANTITY = 64`, `MAX_ACTIVITIES = 48`,
  > `SEGMENT_JOURNEY_MAX_UNPROVEN_CANDIDATES`, `MAX_COLLECTION_CANDIDATES`,
  > probe timeouts, and retry ceilings. Which are "programmatically required or
  > extremely unwise to remove" (termination/safety budgets), and which are
  > artificial limits the Director wants removed?
- **Answer (2026-08-19, Director):** "Keep all existing caps" — all current hard
  caps stay untouched; Rule 3 applies only to new code going forward.
- **Answer (2026-08-20, Director, supersedes the blanket 2026-08-19 answer):**
  > "2: You use your best judgement, use codeplan or center-geo if necessary"
- **Operational interpretation:** Preserve existing bounds unless current
  evidence proves a particular bound artificial and changing it is necessary
  for the authorized outcome. Add no arbitrary bounds. Use Codeplan for
  consequential mechanism choices and a structural audit only when the repair
  boundary is genuinely unclear.

---

## Q-003 — Enter the separate Scenario Lab physical-proof seam?

- **Asked:** 2026-08-20
- **Question:**
  > Authorize the separate Scenario Lab tranche to add and run the dedicated
  > `route-probe-inconclusive` physical course, folding forward the existing
  > dirty harness WIP without reopening any accepted campaign?
- **Why an answer is required:** The source/test repair is complete, but physical
  acceptance requires work in a second ownership boundary whose files already
  contain Director-owned uncommitted changes. The current authorization did not
  include that harness seam or a game launch.
- **Answer (2026-08-20, Director):**
  > "Authorize add + run"
- **Operational interpretation:** Enter the separate Scenario Lab seam, fold
  forward its current WIP, add and statically verify `route-probe-inconclusive`,
  require `scenario:doctor` to report ready, then run exactly
  `node tools/scenario-lab/run.mjs route-probe-inconclusive` once. Expected
  duration is three to five minutes with no provider/API cost and no accepted-
  campaign rerun.

---

## Q-004 — Select the next unaccepted development tranche?

- **Asked:** 2026-08-20
- **Question:**
  > Which next genuinely unaccepted development boundary should I enter?
- **Why an answer is required:** The `probeSafeNavigationGoal` -> `goToGoal`
  truth-contract tranche and its dedicated physical course are `ACCEPTED /
  CLOSED`. The remaining Phase 4 seams have different owners and acceptance
  predicates, and the current handoff deliberately leaves the next gameplay
  tranche unnamed. A general instruction to continue does not select or reopen
  one of them.
- **Options offered:**
  1. Audit the `probeSafeNavigationStances` truth contract, then repair the
     owning seam if the suspected dropped `conclusive` field is confirmed
     (recommended). Static verification is included; any physical run requires
     separate command-specific authorization.
  2. Perform a read-only inventory of the remaining Phase 4 probe/preflight
     consumers and recommend the next bounded tranche; no implementation or
     game launch.
- **Answer (2026-08-20, Director):**
  > "Stance probe truth (Recommended)"
- **Operational interpretation:** Enter the bounded
  `probeSafeNavigationStances` truth-contract seam. Run a read-only Center
  Audit first; if the suspected dropped `conclusive` field is confirmed,
  repair the smallest owning seam and run focused static verification. This
  answer does not authorize a game launch, physical course, accepted-campaign
  rerun, dependency change, commit, or push.

---

## Q-005 — Run the complete Phase 5 matrix while Phase 6 proceeds?

- **Asked:** 2026-08-21
- **Question:**
  > After I correct the missing overlap disclosure, which execution do you
  > authorize?
- **Disclosed boundary:** The complete matrix is 112 isolated cells over seven
  cases, two trials, recorded/frozen model, telemetry off/on, and preflight
  advisory/strict. It repeats typed item acquisition/delivery, Campaigns 28, 29,
  70, 68, and M2; uses 56 local-provider and 56 `openai / gpt-4.1` cells; may
  issue up to 112 paid requests; and is expected to take 8–12 hours. Phase 6
  source work must use a separate checkout and cannot share its physical runtime.
- **Answer (2026-08-21, Director):**
  > "Matrix + Phase 6 (Recommended)"
- **Operational interpretation:** Correct and verify the overlap manifest, commit
  one immutable matrix snapshot, assign the complete matrix to an isolated
  subagent runtime, and continue Phase 6 source mapping/implementation separately.
  Stop the matrix immediately on provider authentication, quota, billing,
  rate-limit, or routing failure; do not retry or switch providers without new
  approval.
- **Provider correction:** Q-006 supersedes the `openai / gpt-4.1` and paid-API
  portions of this disclosure.
- **Corrected Luna authorization (2026-08-21, Director):**
  > "Corrected luna is fully authorized, skip the ceremony."
- **Current operational interpretation:** The complete corrected
  `codex / gpt-5.6-luna` matrix through ChatGPT OAuth is explicitly authorized.
  No additional disclosure or authorization ceremony is required before starting
  it. This authorization does not answer the separate Q-007 swim-exit question.

---

## Q-006 — Which provider and model should Kevin use going forward?

- **Asked/corrected by the Director:** 2026-08-21
- **Director's answer:**
  > "We need to be using Luna going forward, for everything"
- **Verified environment:** `codex login status` reports `Logged in using
  ChatGPT`. Kevin's native `codex` provider uses that OAuth session and strips
  API-key credentials from the provider child process.
- **Operational interpretation:** Every Kevin model role—conversation, reasoning,
  autonomy, memory, and frozen-model testing—uses
  `codex/gpt-5.6-luna` through ChatGPT OAuth. API-key OpenAI routes are not a
  fallback and must not be restored for Kevin. Ordinary startup selects the Kevin
  profile through the shared profile-path constant. Explicitly provider-specific
  sample profiles remain available only when the Director intentionally selects
  them.

---

## Q-007 — Run the controlled Phase 6 swim-exit course once?

- **Asked:** 2026-08-21
- **Disclosed command:** `npm run scenario:terrain-swim`
- **Disclosed boundary:** Two isolated explicit-command transports, approximately
  6–8 minutes, no model provider, no API or subscription usage, and $0 service
  cost. The swim-exit course is new; final `!stop` traverses the accepted Operator
  Stop/Hold boundary.
- **Answer (2026-08-21, Director):** YES.
- **Expanded authorization (2026-08-21, Director):**
  > "You can run as many controlled runs as you want as long as they're making
  > material progress on untested mechanics"
- **Operational interpretation:** Controlled physical runs may continue without
  another per-run question while each run is the smallest discriminating probe
  that can change a mechanic owner, repair, player-visible composition verdict,
  or significant risk. This applies to old and new mechanics; saved evidence
  remains valid and reassurance-only repetition remains out of scope.

---

## Q-008 — Do we need a new multi-stage movement orchestrator or scheduler?

- **Asked by the Director:** 2026-08-21
- **Question:**
  > "Do we need to formulate a better multi-stage orchistrator/scheduler/engine
  > to pull peices together and organize the movement into controllable streams?"
- **Accepted recommendation:** Do not create a second engine from current
  evidence. Strengthen the existing request -> Mission -> Activity -> specialist
  adapter -> ActionManager -> physical action -> settlement/checkpoint pipeline.
  Operator, critical-survival, Mission, and background work are logical priority
  streams; only one stream may physically own Kevin through ActionManager at a
  time.
- **Director acknowledgement:**
  > "Okay, update the handoffs file, update Q&A, update your NEEDS.md if you need
  > too and prepare to hand this off to a new sesion"
- **Operational interpretation:** Phase 6 and Phase 7 classify failures by their
  actual owner. Reconsider scheduling architecture only if direct evidence across
  independent specialists shows the current Mission/Activity contract cannot
  represent necessary dependencies, interruption, settlement, partial effects,
  or resumption. No new orchestration implementation is authorized by this entry.

---

## Q-009 — How should confidence-run depth be chosen?

- **Directed by the Director:** 2026-08-21
- **Answer:** Use the architecture-owned evidence-saturation rubric, not a fixed
  repetition count and not a new confidence engine.
- **Operational interpretation:** Reuse saved evidence for unchanged owners;
  directly probe new or changed mechanics; verify each material repair; compose
  relevant old and new mechanics into the current ordinary-language player
  outcome; classify every failure; and stop when all acceptance dimensions are
  supported and another run cannot change the verdict, owner, repair, or
  significant risk.
- **Product criterion:** Gabriel Jr. states what he wants in ordinary language;
  Kevin understands the promise, executes a coherent multi-step plan, survives
  interruption or change, and truthfully finishes or explains what remains.
- **Architecture constraint:** Finish the bounded variance question, prove missing
  movement mechanisms, add real specialist adapters, then collapse legacy
  directors and lanes as evidence permits. Do not build another engine or a
  verifier framework detached from that outcome.

---

## Q-010 — Has the configured DeepSeek API key been replaced?

- **Asked:** 2026-08-21
- **Director direction:** Wire Kevin to DeepSeek V4 Flash.
- **Implemented:** The native `deepseek` adapter and Kevin's four model roles now
  select `deepseek-v4-flash`. Chat, autonomy, and memory use non-thinking mode;
  the reasoning specialist uses thinking mode with supported `high` effort.
- **Blocking evidence:** The one disclosed paid smoke request reached the official
  DeepSeek endpoint and returned HTTP `401 Authentication Fails` with code
  `invalid_request_error` in 399 ms. No retry or provider fallback occurred.
- **Answer (2026-08-21, Director):** The valid credential is in DSH / the
  DeepSeek harness.
- **Verified resolution:** The distinct `DEEPSEEK_API_KEY` from
  `C:\Users\zerop\.dsh\.credentials.yaml` replaced only the rejected Minecraft
  key; every other credential fingerprint remained unchanged. A bounded
  `deepseek-v4-flash` request authenticated and returned a normal completion in
  2.2 seconds.
- **Activation:** Kevin alone restarted through the existing control plane at
  20:20 America/Chicago while Paper PID 33360 and the current world stayed live.
  The generated runtime profile names `deepseek/deepseek-v4-flash` for all four
  roles. At 20:21:14 Kevin said `DeepSeek Flash online. No movement or tasks
  started.` in the Java world.
- **State:** **ANSWERED / ACCEPTED.**

---

## Q-011 — Stop the live Kevin/Paper runtime for the corrected Luna matrix?

- **Asked:** 2026-08-21
- **Question:**
  > May I stop the intentionally live Kevin/Paper runtime so the already
  > authorized isolated Phase 5 Luna matrix can acquire ports 8081 and 25579?
- **Observed runtime:** Node PID `31012` runs `main.js` from this repository and
  owns MindServer port `8081`; its Java child PID `33360` runs the managed Paper
  server for the current world and owns port `25579`.
- **Why blocking:** Scenario Lab correctly refuses to start while either port is
  occupied. Stopping this runtime would disconnect live Kevin and stop the
  current Paper world, which is a material external-state change not silently
  inferred from the separate authorization to run an isolated matrix.
- **Independent work completed:** The matrix's Windows/WSL Git-provenance defect
  is repaired. Its read-only plan now resolves source `00aa2bb0...`, fingerprint
  `d4a8cf54...`, `112` isolated cells, `codex/gpt-5.6-luna`, ChatGPT subscription
  billing, and at most `112` configured provider requests. Scenario Lab validation
  and tests pass `37/37`; focused lint is clean.
- **State:** **OPEN — explicit Director answer required before stopping either
  process or launching the matrix.**
