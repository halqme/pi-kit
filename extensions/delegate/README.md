# delegate

Isolated implementation delegation for Pi Kit.

Each `delegate.start` creates a dedicated Git worktree and branch, then launches a child `pi` process in that workspace. The worker receives a bounded task and acceptance criteria and commits its own coherent changes. Concurrent mutating delegates therefore never share a working tree.

`delegate.status` reports process state, branch head, worktree status, and bounded stdout/stderr tails. `delegate.stop` terminates a running worker.

`delegate.integrate` accepts only a finished worker with a clean delegate worktree and a clean parent worktree. It runs `git merge --squash` in the parent worktree and leaves the resulting candidate staged without creating a commit. This keeps Pi-managed history linear and makes the delegate branch's internal commit history an implementation detail. If the squash merge conflicts, the parent worktree is restored to its pre-integration `HEAD` before the error is returned.

After integration, the parent should rerun the relevant verification against the staged integrated state, create the final commit, then call `delegate.cleanup`. Cleanup removes the delegate worktree and its Git worktree registration, purges the delegate metadata and stdout/stderr logs, and can explicitly delete the temporary branch with `deleteBranch: true`. If ordinary worktree removal fails because the worktree registration is stale, cleanup removes the path and prunes stale Git worktree metadata before reporting success.

A worker exit or completion message is only an event. The parent must inspect the branch, run verification, and decide whether to integrate it.

Checks:

```sh
bun run --cwd extensions/delegate check
```
