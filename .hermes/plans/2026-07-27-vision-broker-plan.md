# Vision broker and structured-sensing fallback plan

[codeplan · vision-broker-fallback · PLAN-OUT · mode: full · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.91;V2=0.79;V3=disqualified · reason: wrap the existing Camera/VisionInterpreter command seam with readiness, single-flight, bounded rate/retention, structured evidence, and fallback rather than creating a second perception system]

## Candidates

- V1 `interpreter-broker` (`camera-readiness`, `single-flight`, `rate-limit`, `structured-fallback`): retain explicit look commands, guard their camera/model lifecycle, and record a bounded vision outcome alongside Minecraft's authoritative structured state.
- V2 `new-perception-service` (`cross-runtime-service`, `event-stream`, `migration`): centralize camera and world state behind a new service. Valuable later, but duplicates the existing full-state cache and widens lifecycle ownership.
- V3 `continuous-model-vision` (`polling`, `image-stream`, `provider-cost`): invoke model vision on a heartbeat. Disqualified: violates the on-demand/gap-only model, adds cost/latency, and can make visual prose falsely dominate game facts.

- V1=46/50=0.91 for availability truth, bounded resource use, compatibility, and scope; V2=39/50=0.79; V3=disqualified. V1 is selected.

## Ordered changes

1. Give Camera a surfaced readiness/error promise and safe recursive screenshot storage/retention.
2. Make VisionInterpreter own one in-flight request, profile-derived rate limits, structured failure evidence, and a structured-sensing fallback.
3. Make explicit look commands propagate success/failure into ActionManager rather than resolving undefined success.
4. Run focused syntax/diff/static checks only; do not invoke a camera/model or live bot.

[codeplan · vision-broker-fallback · EXEC-OUT · implemented: V1 · confidence: med · verification: partial · mechanism-check: passed · plan-history: unchanged · corrected: camera initialization no longer races capture; look commands now return structured failure instead of undefined success · evidence: focused Node syntax and scoped diff/whitespace checks passed; no camera/model request or live bot action ran]
