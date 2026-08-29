# delegate

Isolated implementation delegation for Pi Kit.

Each `delegate.start` creates a dedicated Git worktree and branch, then launches a child `pi` process in that workspace. The worker receives a bounded task and acceptance criteria and commits its own coherent changes. Concurrent mutating delegates therefore never share a working tree.

`delegate.status` reports process state, branch head, worktree status, and bounded stdout/stderr tails. `delegate.stop` terminates a running worker. `delegate.cleanup` removes the worktree and can explicitly delete its branch.

A worker exit or completion message is only an event. The parent must inspect the branch, run verification, and decide whether to integrate it.

Checks:

```sh
bun run --cwd extensions/delegate check
```
