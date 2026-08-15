# Local Gameplay Repair Rules

Direct implementation is authorized; working Minecraft gameplay is the primary deliverable.

## Startup after handoff

- Read `launcher-config.json`; this worktree's control URL is currently `http://127.0.0.1:8081`. Port 8080 can bind yet drop connections on this WSL host, so never infer readiness from a listening socket.
- Probe `GET /api/identity` first. If it returns the Mindcraft control-center identity, reuse that launcher; never start a second launcher or Paper process.
- If the launcher is absent, run `node main.js` once in a long-lived terminal and wait for `/api/identity`. The launcher owns managed Paper and selected bot processes.
- Check `GET /api/minecraft-server`: `phase: running` is the Paper readiness edge. A stopped Paper server is distinct from an absent launcher; start it through `POST /api/minecraft-server/start` and wait for `running`.
- Check `GET /api/agents`: `stopped` with `registered` or `disconnected` means the launcher is healthy but the bot is unloaded. Start that configured bot through the existing dashboard/socket lifecycle, not another `node main.js`; profile initialization can take tens of seconds.
- Startup is complete only when the selected bot reports `state: running`, `in_game: true`, `socket_connected: true`, and `readiness_stage: world_ready`, and `GET /api/health` returns `ok: true` with no problems.
- Preserve persisted Operator Hold. With no human player online, a held bot may intentionally unload shortly after reaching `world_ready`; that clean `stopped` state is not a startup failure. Do not send gameplay requests, teleport, or edit fixtures merely to keep it loaded.
- Stop only a launcher you started, using SIGINT and allowing it to stop its owned bot and Paper children. See `docs/operations/STARTUP-AFTER-HANDOFF.md` for exact probes, recovery commands, and state meanings.

- Do not invoke planning, TDD/test-first, review, verification-review, soak, or completion-audit workflows automatically.
- Do not create a plan unless the user explicitly asks for one, and do not split normal implementation into tiny slices.
- Tests are optional diagnostics, not the product. Add only focused checks that reproduce or prevent a specific observed defect.
- Do not build broad test suites, fixture systems, soak tests, verification frameworks, or review artifacts during gameplay repair.
- Do not turn theoretical risks or reviewer suggestions into requirements.
- Prefer running the real Paper server and existing Mindcraft/Mineflayer bot, observing failures, repairing the active path, and running again.
- Preserve the LLM/conversation architecture and route direct and natural-language requests through the same deterministic gameplay skills.
- Stop when the requested physical gameplay works.

## Specialist escalation

- Codeplan is for materially different mechanisms, architecture/ownership/persistence/API/package/concurrency/lifecycle boundaries, a disproven local mechanism, or a materially expensive wrong choice. Do not invoke it for each ordinary gameplay blocker or routine continuation after a mechanism is selected.
- Center Audit is for a specific cross-owner uncertainty, an important safety/authority/state/cancellation/concurrency/persistence/false-success invariant, a repeated failure class after one ordinary repair, an ambiguous owner after targeted tracing, or an explicit Director request. One audit owns one claim and returns its result to implementation.
- A broad run finding another reproducible defect is not by itself a reason to plan or audit. Use the normal repair loop when the owner and repair are clear.

## Package-first mechanics rule

- The project owns judgment: goals, target selection, permissions, safety policy, budgets, interruption, evidence, verification, recovery, and reporting.
- Mineflayer core and mature plugins own mechanics whenever they already implement them, including locomotion, jumping, swimming, path execution, combat execution, tool selection, collection, pickup, eating, armor, containers, crafting, smelting, and vehicles.
- Before writing or expanding a physical gameplay algorithm, inspect Mineflayer core APIs, installed plugins and versions, upstream documentation and issues, then established compatible Mineflayer packages.
- Prefer configuring, wrapping, adapting, or upgrading an existing package over duplicating it. Preserve ActionManager ownership, cancellation, safety, and Minecraft-state verification around the package.
- Custom raw movement, attack loops, tool ranking, collection/pickup loops, or inventory mechanics require live evidence that the installed package cannot safely perform the mechanic and that a thin adapter is insufficient.
- Never create a parallel movement, combat, collection, tool, or survival engine beside an installed plugin because one route or scenario failed.
- Do not add or upgrade dependencies without the user's explicit approval and a compatibility check.
- At meaningful checkpoints, report delegated mechanics and the evidence for every custom exception.

## Shared contract spine

- Important capabilities must expose distinct, evidence-backed boundaries for selection, feasibility, planning, execution, reconciliation, and verified outcome. Use the domain-specific stages in `docs/architecture/SHARED-CONTRACT-SPINE.md`; do not collapse them into prose such as `unreachable` or `failed`.
- A later-stage failure is valid only when receipts prove the earlier stages. Missing evidence is unknown, never inferred success. Cancellation, preemption, Stop, and owner replacement are censored samples and must not be assigned a mechanic-failure stage.
- Diagnose and repair the first unproven boundary. Do not change reasoning, target selection, site choice, Pathfinder, or Mineflayer/Paper when receipts prove that layer succeeded and identify a different owner.
- Beds, crafting tables, furnaces, chests/containers, doors, and placement targets share one interaction-stance contract: `no_legal_stance`, `path_not_found`, `path_execution_failed`, or `interaction_rejected`. Project code owns legal-stance judgment, Pathfinder owns route planning/execution, and Mineflayer/Paper owns the interaction acknowledgement.
- Contract receipts must be bounded, normalized, immutable, carried in structured action evidence, and promoted into telemetry. Never derive contract stages by parsing arbitrary logs or model narration.
- Explicit player identity is binding: never replace a named destination with the requester or the bot itself. Navigating to the bot's own username is `invalid_self_target`, never successful completion.
- A partial Pathfinder search is not execution authority for returnability-sensitive movement. Player pursuit must have a complete native route before locomotion; bounded recovery may move only to a supported stance with a native reverse-route proof.
- For environment-dependent work such as hostile spawning, sleep, and weather, compare live Paper state with managed configuration before diagnosing gameplay mechanics. Configuration is intent, not evidence; reconcile any supported runtime setting after Paper's authoritative readiness edge.
- Deliberate hostile acquisition is not emergency self-defense. A kill-harvest capability must establish a usable combat prerequisite before pursuit and delegate the engagement to the shared tactical policy plus installed combat package; a safety reflex interrupt is censored evidence, not permission to retry the same engagement immediately.

### Active broad-gameplay maturity strategy

- Load and follow `docs/plans/2026-08-14-broad-gameplay-maturity-and-fallback-plan.md` until the Director explicitly replaces it. Its priority order is fixture admission, functional affordance, shared fallback, complete intent, component stewardship, then obligation liveness.
- Before dispatching a live validation request, require a bounded immutable fixture-admission receipt for every declared precondition. A failed or unknown required check prevents dispatch and remains censored setup evidence, never a product failure.
- Treat setup acknowledgements as advisory until reconciled against authoritative managed state within one bounded setup edge. A missing or delayed acknowledgement does not consume setup budget when the intended state is subsequently proved; an explicit rejection, a failed authoritative state, or evidence still unknown when that edge expires is a terminal setup failure.
- Treat severe confusion as a supported product state. Settle safely, reconcile the first unknown or failed boundary, retry only after material change, use an already-supported authorized alternative, decompose only while preserving the whole promise, ask one bounded player question when the missing choice is genuinely theirs, then fail truthfully if work remains impossible.
- Player-facing fallback messages expose concise receipt-grounded facts, consequences, and choices. Never expose raw private reasoning, use model narration as evidence, loop an unchanged attempt, or silently substitute an identity, item, site, or objective.
- Keep fixture admission a modest shared gate and receipt. Do not grow a fixture framework, scenario matrix, parallel runtime, or custom mechanics engine around it.

### Product outcome and campaign scale

- The product is a convincing, useful Minecraft companion, not a catalogue of independently certified mechanics. Every meaningful tranche must improve a player-visible outcome or repair a cross-cutting invariant that materially threatens those outcomes.
- Physical task completion is necessary but not sufficient. During every live gameplay observation, also judge whether the bot behaves like a reasonably competent, considerate Minecraft player and companion.
- Tag and record player-visible `WTF` behavior even when the requested action technically succeeds. Examples include mutilating a tree and leaving floating remnants, creating needless pits or oversized holes near shared areas, leaving disposable scaffolding or single blocks behind, wasting tools or materials, thrashing inventory, taking an absurd detour instead of an obvious safe direct approach, ignoring straightforward vertical access, creating avoidable hazards, or damaging useful terrain and builds.
- Ground each `WTF` observation in the loaded world and actual Minecraft mechanics. Record the exact action and location, why it was unreasonable, the simpler or less destructive behavior a sensible player would choose, and whether the likely owner is judgment, target selection, or delegated mechanics. When the mechanic is uncertain, consult current gameplay or package evidence before declaring the behavior wrong.
- A `WTF` observation is evidence, not automatic authorization for a new repair campaign. Prioritize it when it is materially harmful, recurrent, broadly player-visible, or blocks the companion fantasy; otherwise preserve it as a concise deferred observation and stay on the active outcome.
- Preserve the current development loop: run a broad natural player scenario in the real Paper world, observe the first material blocker, repair the smallest shared seam, add only focused regression coverage for that observed defect, rerun the same broad scenario, then commit and stop.
- The default unit of work is a broad multi-stage player request or companion session. Do not invent a narrow campaign merely because another item, quantity, caller, or family can be routed through an existing capability.
- A narrow synthetic or controlled campaign is allowed only when a broad live scenario or review exposes a distinct physical failure, ownership race, false-success path, safety violation, or persistence defect. After the narrow proof, return to the broad player outcome when the changed seam could affect it.
- Once a mechanic or domain has passed physical acceptance, freeze it. Do not reopen it for noun swaps, quantity permutations, caller permutations, exhaustive family coverage, or theoretical edge certification unless new live evidence exposes a materially different failure class or the code is directly changed again.
- Capability migration, abstraction cleanup, duplicate removal, lifecycle repair, and other substantial technical-debt work are authorized deliverables when they correct an evidenced cross-cutting weakness, retire material maintenance or regression risk, or measurably strengthen broad companion behavior. They do not require attachment to one gameplay blocker when the engineering outcome is independently concrete and testable.
- Do not normalize every duplicated seam merely because it exists. Record non-blocking duplication and theoretical risks for later; prefer a deferred note over expanding the active tranche.
- Every review request must state: the player-visible outcome being improved, the new failure class that justified the slice, why the correction is shared rather than item-specific, what behavior is now frozen, and the next broad campaign. Keep this concise and do not create a new review artifact system.
- Stop when the broad physical outcome works truthfully and repeatably enough for play. Do not pursue exhaustive certification, perfect coverage, or formal completeness before returning to real gameplay.

### Substantial engineering authorization

- Substantial technical-debt repair is explicitly authorized. Before changing it, checkpoint the current code, runtime state, evidence, and dirty-file inventory; then state the concrete system outcome, owning surfaces, acceptance evidence, and material stop condition.
- A justified fix has no arbitrary wall-clock, turn-count, or checkpoint-duration cutoff. Continue across as many checkpoints as the coherent repair requires until its acceptance condition is met, evidence disproves the mechanism, authority is needed, or the scope-accretion guard genuinely fires.
- Checkpoints preserve continuity and make progress auditable; they are not deadlines and do not force a materially incomplete repair to stop. Create them at meaningful state changes, before risky transitions, and when handing work across sessions.
- Do not fragment a substantial repair into performative micro-slices. Several modules or ownership seams may move together when they are causally necessary to one declared engineering outcome. Stop and reframe only when work becomes an independent outcome rather than because it took longer than expected.
- Dirty work in this repository is presumptively part of the ongoing companion program when its provenance, surrounding code, tests, and durable records support that conclusion. Inspect it, preserve it, integrate it, verify it, and move the coherent work forward; do not abandon relevant work merely because it is uncommitted. Protect genuinely unrelated or ambiguous changes, and never reset, discard, overwrite, commit, or push without the corresponding authority.
- This authorization is not a license for speculative cleanup. Substantial debt still needs an evidenced product, reliability, operability, or maintainability outcome and proportionate verification.

### Campaign governor

- Live gameplay campaigns are bounded by valid attempts and evidence, not elapsed time. Before execution, declare one player-visible outcome, a stopping condition, and the fixed gameplay budgets below. A campaign without those declared bounds must not start.
- A campaign may consume at most two genuine product repair classes. A genuine product repair class is one distinct, evidence-backed defect in product behavior or a product contract that requires a product source or managed-configuration change. A broken disposable harness, invalid fixture, censored or preempted run, and rediscovery of a known deferred blocker are not new product repair classes.
- A campaign may consume at most three valid gameplay tranches, in order: the initial run, the post-repair run, and final acceptance. A valid gameplay tranche is a live run in which the declared fixture and preconditions hold and the product receives the intended player request.
- One censored setup retry is permitted solely to correct a broken harness or invalid fixture before the intended request is validly exercised. This means at most two total setup attempts: the initial setup and one corrected retry. It consumes neither a gameplay tranche nor a product repair class.
- Charge a setup failure only after bounded authoritative reconciliation proves the setup terminally failed or leaves a required fact unknown. Do not charge transient callback loss, delayed acknowledgements, stale presentation labels, or other advisory signals when authoritative state proves the intended setup effect within the same attempt.
- A setup retry must preserve the exact player-visible outcome, request, and precondition meaning; it may correct only the evidenced fixture or harness defect. Repeating the same setup-failure signature on the retry, encountering any second terminal setup failure, or materially changing the fixture contract closes the campaign.
- If any valid replay exposes a distinct third genuine product defect, close the campaign, preserve the evidence, and report that defect separately. Safety-criticality, false success, corruption, complete blockage, and known deferred work may determine the priority of the next campaign, but do not expand the current campaign.
- A known deferred blocker does not authorize another repair or replay in the current campaign. Preserve its exact evidence and rotate; reopen it only as a separately declared campaign or by explicit Director replacement of the current campaign.
- Gameplay counters do not cap a separately declared substantial technical-debt objective. That work follows its own concrete acceptance condition and may include all causally coupled repairs needed to achieve it without pretending they are unrelated gameplay campaigns.
- A campaign may span any number of checkpoints. Crossing a checkpoint grants no additional gameplay tranche, setup retry, or repair class, but no checkpoint imposes a wall-clock stop on implementation.
- Once the final acceptance tranche succeeds, or any campaign-closing condition is reached, freeze accepted mechanics and stop. Do not stack synthetic proofs, noun or quantity permutations, fixture variations, or supporting-seam checks after the bound.
