# Legacy/v2 Boundary Contract

## Authority

The legacy runtime remains the default and rollback authority. Mineflayer remains the sole game connection. Existing deterministic skills remain the only physical capability implementations. `BehaviorArbiter` retains ownership and priority decisions; `ActionManager` retains exclusive serialization of physical actions.

Direct commands and natural-language requests must resolve through the same deterministic skill surface. A v2 component may select or recommend an existing skill but must not create a parallel command path or bypass policy, arbitration, cancellation, or ActionManager.

## Anti-corruption adapters

Any later v2 experiment must cross explicit adapters:

- `ObservationAdapter`: copies a bounded, versioned snapshot from legacy observations; no live mutable bot object escapes.
- `IntentAdapter`: converts validated direct/NL intent into the existing canonical skill request shape.
- `RecommendationAdapter`: emits a skill name, validated arguments, evidence references, confidence, and terminal reason; it cannot execute.
- `ExecutionAdapter`: legacy-only boundary that revalidates policy and preconditions, then submits through `BehaviorArbiter` and `ActionManager`.
- `ResultAdapter`: converts the legacy action result into a versioned diagnostic result without changing success semantics.

Adapters must reject unknown schema versions, missing required fields, invalid skill names/arguments, stale observations, and duplicate correlation IDs. Adapter failure falls closed to legacy handling and records a diagnostic reason.

## Runtime selection

Selection is explicit per process and defaults to `legacy` when absent or invalid:

- `legacy`: v2 is not constructed.
- `shadow`: v2 may observe and recommend; recommendations cannot reach physical execution.
- `candidate`: available only after migration gates; recommendations still execute exclusively through legacy policy, arbiter, skill, and ActionManager boundaries.

The selector must be established before bot startup, recorded in run evidence, and immutable during a run. Side-by-side comparison means separate controlled runs or non-acting shadow evaluation, never two physical executors on one bot.

## Compatibility and rollback

Legacy request/result contracts are the compatibility boundary until a measured gate authorizes a versioned replacement. Rollback is configuration-only: select `legacy`, restart through the normal operator procedure, and verify that no v2 component is constructed. V2 state must be disposable and must never be required to read legacy state.

## `skills.js` rule

`src/agent/library/skills.js` must never be rewritten wholesale. Any authorized change must be incremental, bounded to named skills or extraction seams, preserve existing exports and direct/NL behavior, and be independently diffable and revertible. Migration by replacement, generated overwrite, or duplicated v2 skill implementations is forbidden.
