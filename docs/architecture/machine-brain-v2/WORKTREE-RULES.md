# Branch and Worktree Operating Rules

## Provenance

- Original worktree: `C:/Users/zerop/Development/minecraft-companion`
- Original branch at creation: `phase0-follow-baseline`
- Architecture worktree: `C:/Users/zerop/Development/minecraft-companion-brain-v2`
- Architecture branch: `architecture/machine-brain-v2`
- Committed base: `61f0730b16380d97ece82495e55813e1a48d9958`

The architecture worktree was created from committed HEAD. Therefore every modification and untracked artifact present only in the original worktree is intentionally absent. Nothing may be stashed, copied, reset, cleaned, committed, or checked out from that WIP to make this branch appear current.

## Isolation rules

1. Run branch, HEAD, status, worktree, and path-collision preflight before every worktree operation.
2. Modify and commit architecture documents only until a separately authorized implementation task names exact runtime files.
3. Do not launch Paper, Mineflayer, the bot, watchers, or shared runtime processes from this worktree.
4. Do not change dependencies, lockfiles, runtime configuration, production code, or the original worktree.
5. Stage explicit paths. Before commit, compare the staged path set to the authorized document list.
6. Never reset, clean, stash, switch, overwrite, delete, prune, or reuse either worktree/branch to resolve a collision.
7. Never push without separate authorization. Never rewrite branch history.
8. Rebase/merge/cherry-pick only under a later explicit integration task after preserving and accounting for both worktrees' WIP.

## Change limits

Architecture evolution must be small, reversible, benchmark-gated, and side-by-side. `src/agent/library/skills.js` is never rewritten wholesale. Existing Mineflayer wiring, deterministic skills, direct/NL shared routing, `BehaviorArbiter`, `ActionManager`, and physical-action serialization remain intact unless a later measured gate explicitly authorizes a bounded change.

## Handoff evidence

Every handoff reports both paths and branches, base and new commit, exact files changed, statuses of both worktrees, validation performed, push state, and original dirty/untracked paths omitted from the architecture base.
