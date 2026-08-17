> **ARCHIVED 2026-08-17 — NOT CURRENT.**
> This document predates the 2026-08-16 architecture reset and describes a plan
> the project no longer follows. Kept as history, not as instruction.
>
> **Why it was archived:** Source of the M4/M5 milestone vocabulary, which is a different roadmap from ARCHITECTURE.md Steps 1-6.
>
> Current design: `ARCHITECTURE.md` · how to work: `AGENTS.md` · start here:
> `docs/HANDOFF.md`

# Broad Gameplay Maturity and Fallback Plan

Status: active strategic direction, adopted 2026-08-14. This plan remains in force until the Director replaces it.

## Achievable end goal

IronSuiteProof should handle ordinary multi-stage family play as a convincing companion: understand the whole request, choose sensible work, execute the existing deterministic skills and mature Mineflayer packages, preserve obligations through interruption, recover from ordinary obstruction, ask a useful bounded question when meaning or authority is genuinely missing, and fail safely and truthfully when the task cannot be completed.

The end goal is broad playable competence, not exhaustive certification of every noun, quantity, fixture, or Minecraft edge case.

## Where the product stands

Mining, tool use and replacement, crafting, collection, pickup, eating, equipment, delivery, following, Hold, whole-tree cleanup and scaffold recovery, explicit player identity, interaction stances, custody, and several compound family requests have substantial accepted behavior. Keep those mechanics frozen to the degree already physically accepted unless new live evidence exposes a materially different failure.

The remaining high-value obstacles are increasingly failures of coordination and judgment:

1. A target or fixture is present but not actually usable.
2. One clause of a family request survives while the real chore, recipient, return, or wait obligation is dropped.
3. A nearby block wins over stewardship of the whole tree, site, component, or shared base.
4. An interruption or near-goal failure strands an otherwise valid obligation.
5. A harness claims a product failure without proving its fixture and preconditions.
6. Evidence is insufficient or several consequential choices remain, but the bot neither asks, decomposes, nor fails clearly.

## Priority order

Work these shared seams in order unless live safety or a true prerequisite changes the order:

1. Fixture admission and evidence hygiene.
2. Functional geometry and affordance judgment.
3. Shared confusion, fallback, and escalation.
4. Complete intent compilation and clarification.
5. Component-level resource and terrain stewardship.
6. Interruption, short-range recovery, and obligation liveness.

## 1. Fixture admission and evidence hygiene

Before a live request is sent, the harness must produce a bounded, normalized, immutable admission receipt. Required facts must be confirmed from authoritative state; missing evidence remains `unknown` and fails admission.

The receipt should cover the facts the scenario actually depends on, including:

- Paper and the managed runtime are ready, relevant chunks and exact blocks are loaded, and the intended agent is the only command recipient.
- Required fixtures, inventories, identities, health, hunger, modes, and custody match the declared scenario.
- Body cells are supported, clear, and stationary at the final sample; workstations and containers have usable clearance.
- Fixture-critical travel has either a complete native Pathfinder route to the final target or a complete native route to the next waypoint admitted under the shared segmented-navigation contract; required interaction targets also have a legal stance. A raw partial search is not authority.
- The request fits the real Minecraft relay boundary and is delivered as one intended authority unit.
- No unintended bot movement or world mutation occurs between the final fixture sample and request dispatch.

A failed or unknown required check prevents request dispatch and marks the sample as censored setup evidence, never a product failure or gameplay tranche. The harness owns setup truth; project code owns identity, safety, legal-stance, returnability, and physical postconditions; Pathfinder owns planning and execution; Mineflayer/Paper owns physical acknowledgement.

Lifecycle and dashboard acknowledgements are advisory inputs, not setup verdicts. Reconcile a missing or delayed acknowledgement against authoritative managed state within the same bounded setup edge. If the intended state is proved, setup continues without consuming the retry; if the acknowledgement is explicitly rejected, authoritative state proves failure, or a required fact remains unknown when the edge expires, charge one terminal setup failure. The single retry therefore means two total setup attempts, and it may correct only the proved harness or fixture defect without changing the player-visible outcome, request, or precondition meaning.

This is one modest shared gate and receipt, not a fixture framework, scenario matrix, new orchestrator, or substitute runtime.

## 2. Functional geometry and affordance judgment

Use one shared question across doors, beds, crafting tables, furnaces, chests, placement targets, bridges, entrances, and resource sites: **can the target be used sensibly as part of the requested outcome?**

The transaction remains selection → legal stance and clearance → route planning → physical execution → interaction acknowledgement → returnability → functional postcondition. Examples of the final postcondition include a repaired doorway being walkable, a chest opening, a bed accepting sleep, a workstation being usable by the intended people, a bridge or entrance solving the named access problem, and a resource site not stranding the bot.

Project code owns judgment and verification. Pathfinder and installed packages retain movement and interaction mechanics.

## 3. Shared confusion, fallback, and escalation

Confusion is a supported product state, not permission to thrash. Enter the fallback contract when any of these are materially true:

- the same action fails again with no physical progress;
- authoritative observations contradict each other;
- a required receipt or contract boundary is missing or unknown;
- person, quantity, destination, substitution, permission, or custody remains unresolved;
- materially different legal alternatives would change the player's outcome;
- inventory, world, or custody changes unexpectedly;
- route, interaction, or package execution fails after earlier stages were proved;
- the next decomposed step cannot be verified; or
- repeated interruption produces no obligation progress.

Use this bounded ladder, in order:

1. **Safe settle.** Stop mutation and preserve custody, checkpoints, and the outstanding obligation.
2. **Reconcile evidence.** State what physically succeeded, what is known now, and the first unknown or failed boundary.
3. **Retry only after material change.** New position, inventory, world state, authority, or a changed supported tactic may justify one bounded retry; elapsed time and repeated narration do not.
4. **Use an already-supported alternative.** Rebind, reposition, or choose another authorized legal option without inventing new mechanics or silently changing the promise.
5. **Decompose carefully.** Break the task into smaller deterministic actions only when their combined postconditions still preserve the whole player promise.
6. **Ask a bounded question.** Offer two or three concrete options and their player-visible consequences when the missing choice is genuinely the player's.
7. **Fail truthfully.** Report completed progress, the exact blocker, remaining work, world changes, and the narrowest useful next action. Enter Hold when autonomous continuation is unsafe or unauthorized.

The player-facing summary should be concise and receipt-grounded, for example: “I completed X. Y is blocked because Z. I have not changed A. I can try B or C, or wait here. Which do you want?” This exposes the actionable decision boundary, not raw private chain-of-thought or model narration.

The fallback contract must never invent completion, identity, custody, progress, or a contract stage; weaken safety, protection, durability, stance, or route gates; repeat an unchanged attempt; silently substitute a person, item, site, or objective; promote a raw partial Pathfinder result into authority; damage terrain merely to escape confusion; or ask a question whose answer is already present in authoritative state. A fully planned, admitted waypoint segment is not a promoted partial result.

## 4. Complete intent compilation and clarification

Compile every broad player request into an effect ledger before installing Agenda work:

- intended actions and world effects;
- requester, named participants, and recipient identities;
- quantities and whether they are additive, minimum, or exact;
- substitution permissions;
- ordering and dependencies;
- custody and delivery outcomes;
- reporting, return, regroup, and terminal wait obligations; and
- preservation and safety constraints.

Compare the proposed work to that ledger. If a material field remains unresolved, ask one bounded question. If the ledger is complete, install it once. The LLM proposes interpretation; deterministic contracts, capability registry, and live state remain authoritative.

## 5. Component-level resource and terrain stewardship

Treat natural resources and shared terrain as component transactions, not isolated block targets. Before acting, consider remaining requested quantity and component yield, route and return, tool and inventory capacity, collateral damage, temporary scaffold, cleanup, lighting and final settlement, aesthetic or hazard residue, and unavoidable excess that requires negotiation.

Apply this judgment to whole trees, ore and stone bodies, dropped-item clusters, farm work, and construction material sources. Continue delegating movement, tool, collection, and inventory mechanics to installed packages.

## 6. Interruption and obligation liveness

Interruption must settle at safe cancellation edges, preserve resumable work, and never erase an accepted player obligation. A zero-progress retreat needs a supported fallback or a truthful terminal result. Near-goal failures may try another already-proved supported stance. Longer pursuit or ordinary obstruction recovery may advance through fully planned safe waypoint segments while preserving the final destination, but repeated cells, oscillation, or zero overall progress must stop, explain, or ask. A terminal failure is reported once after settlement rather than silently looping or silently abandoning the task.

## Testable milestones

### M0 — Strategic spine loaded

- This plan exists and is linked from `AGENTS.md`, `CONTEXT.md`, and the current durable checkpoint.
- The priority order and fallback ladder are stored in Lodestar.

### M1 — Shared fixture-admission gate

- A reusable pure gate produces immutable `admitted`, `fixture_invalid`, or `fixture_unknown` receipts with exact check identifiers.
- A representative live verifier calls the gate immediately before the intended request.
- Missing route proof, unsupported stance, stale body position, oversized request, unloaded target, or custody mismatch can fail closed without dispatch.
- Focused diagnostics prove valid, failed, and unknown receipts; no dependency, product API, or fixture framework is added.

### M2 — Functional-access transaction

- At least one broad family task uses the shared functional-access contract end to end.
- Telemetry separates selection, feasibility, planning, execution, acknowledgement, and functional postcondition.
- A real Paper replay proves useful access, not mere block placement or proximity.

### M3 — Confusion and clarification fallback

- Repeated zero-progress work settles instead of looping.
- An authorized alternative can resume from preserved progress.
- A genuinely ambiguous request yields one bounded player question.
- Terminal failure reports one concise receipt-grounded summary and preserves custody/world truth.

### M4 — Complete-intent compilation

- Broad family requests retain chore, identities, quantities, ordering, custody, return, report, and Hold effects.
- Missing material fields ask before Agenda installation; complete effects install once without clause loss.

### M5 — Resource-transaction quality

- A broad live resource task finishes sensible components, avoids needless damage, cleans temporary state, and reports unavoidable excess.
- WTF evidence distinguishes project judgment from delegated mechanic behavior.

### M6 — Broad family-play acceptance

- A natural Dad/Kid session spans ordinary base work, resource use, delivery or interaction, interruption, return/regroup, and Hold.
- The bot completes truthfully or uses the fallback contract without silent abandonment, unchanged retries, or destructive improvisation.

## Execution and stopping discipline

- M1 is a substantial engineering repair, not a gameplay campaign. Its acceptance is the shared gate, one representative integration, and focused proof.
- Live campaigns declare one player-visible outcome and follow the campaign governor in `AGENTS.md`. Unattended agent-driven runs are the default and are bounded by convergence, not by a run count; only runs that consume the Director's presence keep the tight two-repair, three-tranche budget. Setup budget is charged only after the bounded authoritative reconciliation rule above.
- Reach real Paper as soon as the changed seam can be exercised. Use narrow fixtures only after a broad live observation identifies the need.
- Add no dependency, package replacement, custom mechanic engine, scenario matrix, or broad verification framework.
- Preserve the dirty project WIP, telemetry, managed runtime, and Operator Hold. Do not commit or push without explicit authority.
- Stop a milestone when its stated outcome is materially proved and passes the player-sense gate. While an unattended campaign is still converging, a newly found defect is evidence to repair and rerun, not a reason to close; rotate only when the outcome stops converging.

## Current action

M0, M1, M2, M3, and M4 are complete. The repository has a zero-dependency pure fixture-admission receipt and fail-closed assertion, and the existing lifecycle verifier rechecks exact managed-world occupancy, live agent readiness, state freshness, command isolation, supported/stationary body state, ActionManager/Pathfinder idleness, and request transport facts immediately before dispatch. Its start callback is advisory: a bounded authoritative `world_ready` reconciliation can confirm setup without consuming a retry.

Focused valid, failed, and unknown diagnostics pass 7/7 with the adjacent runtime-verifier checks. A real managed-Paper run correctly censored the request with exact `body_supported` evidence after the bot remained slightly airborne through a bounded settlement wait; `!stay(1)` was never dispatched and cleanup returned IronSuiteProof to stopped/unloaded persistent Operator Hold. That live result proves the gate rejects an invalid physical fixture. It does not claim the current saved login position is usable.

Do not teleport or reshape the world merely to manufacture a green fixture sample. M2 evolved the shared interaction receipt to expose selection, feasibility, planning, execution, acknowledgement, and functional postcondition separately. A real family-workshop request physically used the existing camp Crafting Table to make one Iron Axe, delivered it to DadPlayer, returned to KidPlayer, and held without terrain or custody residue.

M3 makes retry authority fail-closed at the durable Agenda boundary. A terminal GoalDirector result can receive another Agenda dispatch only when its correlated receipt explicitly records `retryable: true`; an omitted flag no longer clones the goal with a fresh ID and budget. Existing explicit checkpointed retries and supported alternatives remain intact. Terminal Agenda failure reports the exact blocker once, states that no unchanged retry occurred, and enters Hold when no already-authorized continuation remains.

The accepted live ambiguity scenario gave IronSuiteProof sole custody of one Bread while DadPlayer and KidPlayer were present. Dad asked it to give the Bread to “one of us” and wait. The bot retained exact custody and Hold, asked exactly once whether Dad or Kid should receive it, accepted Dad's named Kid answer, delivered exactly one Bread to Kid, retained none, and settled with an empty Agenda under Hold. Flight `flight-2026-08-14T17-28-32-859Z-167556-000.jsonl` records the correlated `skill_delivered` receipt. The adjacent Agenda, parser, and work-order suites pass 103/103. M3 is frozen to this evidence.

M4's immutable complete-intent boundary is physically accepted. In a fresh
managed-Paper campaign, DadPlayer naturally asked Kevin to visit exact
KidPlayer, inspect and report the bedside Chest, return to DadPlayer, and wait.
Kevin admitted all three ordered effects atomically, reached Kid at one block,
opened the exact Chest at `(8104,69,7940)`, and reported the authoritative
manifest, including two Iron Pickaxes and one each Iron Axe, Iron Shovel, and
Iron Hoe. Kevin then returned one block from Dad and entered persistent Hold
with zero measured drift. Before/after Paper receipts prove that the Chest and
all three player inventories were unchanged. The earlier loopback setup failure
was operational only; the documented 8081 control path removed it without a
product or world workaround. Freeze M4 to this evidence. The next active
milestone is M5 component-level resource and terrain stewardship.
