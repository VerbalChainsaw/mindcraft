# Dialogue delivery hardening plan

[codeplan · dialogue-delivery-hardening · PLAN-OUT · mode: full · profile: compact · pick: V1 · baseline: V1 · confidence: high · beatBaseline: yes · scores: V1=0.90;V2=0.76;V3=disqualified · reason: serialize and bound the existing in-game delivery path while preserving its routing, translation, speech, and server-output behavior]

## Candidates

- V1 `bounded-chat-queue` (`serialized`, `translation-fallback`, `length-cap`, `additive`): make one agent deliver in order with a small pacing gap and fall back to original text if translation fails.
- V2 `drop-on-burst` (`simple`, `lossy`): discard behavior messages when chat is busy. Rejected because it hides useful reflex/action explanations.
- V3 `new-dialogue-service` (`broad`, `cross-lane`): replace all chat/conversation plumbing. Disqualified because it risks routing and user-visible behavior.

## Ordered changes

1. Create a per-agent delivery queue and bounded cooldown after bot startup.
2. Normalize/limit outgoing Minecraft text and fall back cleanly if translation fails.
3. Retain current whisper, speech, in-game chat, and MindServer output routes.
4. Inspect source/diff only; do not send chat to a server.
