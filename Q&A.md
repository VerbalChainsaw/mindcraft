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
