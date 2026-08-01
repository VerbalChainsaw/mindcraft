# Overnight playability scratchpad

- Control plane: `http://[::1]:8080` (`127.0.0.1:8080` belongs to an unrelated tunnel client).
- Paper: managed Java 1.21.11 at `127.0.0.1:25579`; controlled fixture remains within `x=1026..1040`, `y=99..103`, `z=1006..1016`.
- Bot: `MindcraftBot`; held, idle, and world-ready after the final MIN-001 cleanup.
- Original MIN-001 failure: candidate truncation hid supported targets, then natural collection had no stable-stance/post-break-support contract. A near rerun broke stone without collecting it; background retries later descended from Y=99 to Y=52 and drowned.
- Implemented owner-local repair: bounded hydrated candidate scan, safe drop-support and visible stance assessment, composite stance navigation that cannot break the target, execution-time revalidation, direct dig, and verified pickup.
- Terminal observability failure: a successful collection result was overwritten by the next job action; stop state could then wait for a heartbeat. Terminal/stop pushes now carry action identity and use immediate authoritative snapshots; lifecycle snapshots are delivered reliably across prior volatile movement gaps.
- Verifier contaminants found and removed: broadcast Paper markers, an old oak trunk, a target-matching stone floor, a natural stone just outside the lane, and target placement that allowed that outside stone to win legitimately. The outside stone at `(1037,100,1017)` was restored to its observed pre-run state.
- Final typed collection proof: three consecutive passes in 6925/7135/7031 ms; Paper inventory `0→3`; all targets `stone→air`; minimum Y=100; linked player action/decision on every run; stop quiescence 2/71/13 ms; ten seconds stable each.
- Core scenario 1 proof: three consecutive stopped→world-ready→`!stay(1)`→stopped runs. World-ready 6023/5986/6007 ms; structured action result 1512/1520/1515 ms after issue; graceful process shutdown 38/38/38 ms.
- Lifecycle verifier repairs were diagnostic-only: correlate `list` output after its newest command marker in the capped Paper log, and consume the current versioned state snapshot/delta protocol.
- Core scenario 5 is not complete until delivery to a real player or controlled player target is independently verified.
- Do not grant new arbiter authority during this work.
