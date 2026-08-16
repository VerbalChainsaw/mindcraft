# Known-failing tests on clean HEAD

Verified 2026-08-16 against a detached clean checkout of `12bdc21` — no working
tree changes, no WIP, nothing local. These three fail on the commit itself.

| Suite | Test |
|---|---|
| `control-plane/job-director.test.js` | Given a resumable mining order, JobDirector dispatches one phase action and advances only on changed success |
| `control-plane/job-director.test.js` | Given a command without a changed structured result, JobDirector enters recovery instead of advancing |
| `control-plane/dashboard-lifecycle.test.js` | Given a non-retryable blocked agent, when the dashboard requests startup, then it receives the sanitized lifecycle failure |

**Do not blame your own change for these.** They were suspected to come from the
prior session's uncommitted edit to `src/agent/runtime/action-result.js`; that
was checked and disproven — they fail with that WIP entirely absent.

## Expected totals with these three failing

```
npm run test:behavior        192 / 194
npm run test:control-plane   289 / 290
```

## How to re-verify a baseline

Make a throwaway detached checkout so the working tree is never involved:

```bash
git worktree add --detach /tmp/head-check HEAD
```

Link `node_modules` into it, run the suite, then remove it with
`git worktree remove --force /tmp/head-check`.

**Do not run bare `git worktree prune` on this repo.** This worktree's `.git`
file points at a WSL-style gitdir (`/mnt/c/...`) that Windows git cannot
resolve, so prune considers the registration broken and deletes it. Recovering
means recreating `.git/worktrees/<name>/{commondir,gitdir,HEAD}` and rebuilding
the index with `git read-tree HEAD` (no `-u` — that would overwrite the working
tree). Working files are not lost, but it is an avoidable scare.
