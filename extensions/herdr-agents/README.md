# herdr-agents

Delegates implementation work from Pi to persistent, write-enabled Pi agents managed by Herdr. This extension is intentionally separate from `agent-team`: `agent-team` is a read-only briefing and deliberation committee, while `herdr_agents` creates workers that may edit files and run commands.

Herdr is used as the execution and observation layer. The parent Pi decides what work to delegate; Herdr owns the terminal, agent lifecycle, workspace, and optional Git worktree. The Herdr TUI does not need to be open. When no server is running, the extension starts `herdr server` as a detached headless process and retries the request.

## Requirements

- Herdr 0.8.0 or later must be installed and available on `PATH`. The extension verifies the version before its first command.
- `pi` must be available to the Herdr server environment.
- Worktree isolation requires the requested `cwd` to be inside the repository's primary checkout. Herdr rejects a linked worktree as the source of another worktree.

## Tool

The `herdr_agents` tool supports:

- `start`: create one worker, using an isolated worktree by default, start an interactive Pi agent, and submit the initial task.
- `start_many`: create up to eight independent workers concurrently. Individual launch failures do not discard successful workers.
- `list`: show live worker threads belonging to the current Git repository, including lifecycle state, workspace, cwd, and physical Herdr name. Humans can run `/herdr-agents` for the same repository-scoped view.
- `check`: show lifecycle state and bounded terminal output.
- `prompt`: send another instruction, optionally waiting for the turn to settle.
- `wait`: wait for exact lifecycle states such as `done` or `blocked`.
- `interrupt`: send `Ctrl-C` to the agent.
- `close`: close a settled Herdr workspace, or remove a clean Herdr-managed worktree when `removeWorktree` is true.

Workers survive parent Pi reload, shutdown, and compaction because their processes and terminals are owned by Herdr. The extension deliberately does not stop workers on `session_shutdown`.

## Repository-local names

Logical names are namespaced with a stable six-character hash of the repository's Git common directory before they are sent to Herdr. `backend` in two different repositories therefore becomes two different physical Herdr names, while a reload or another Pi process in the same repository can still address the worker as `backend`.

Logical names must match `[a-z][a-z0-9_-]{0,24}`. Tool output uses the logical name and includes the physical name in structured details. The returned attach command necessarily uses the physical Herdr name.

`list` and the Pi status line include only workers in the current repository namespace. Herdr agents created manually or by another repository are left untouched.

## Isolation and cleanup

`isolation: "worktree"` is the default. Herdr creates a branch and linked checkout, and the Pi agent edits only that checkout. Use `branch` or `base` when the generated branch and `HEAD` base are not appropriate.

`isolation: "shared"` creates a Herdr workspace directly at `cwd`. This permits concurrent writes to the same checkout and should only be used when the caller has explicitly partitioned file ownership or otherwise coordinated those writes.

The extension never merges, cherry-picks, or deletes branches automatically. `close` rejects agents whose state is not `idle` or `done`, and public tool calls cannot force-remove a dirty worktree. Inspect and integrate completed work deliberately. Closing a workspace without `removeWorktree` leaves the checkout and branch intact.

## Delegation boundary

Delegated Pi agents start with `--no-extensions`, preventing them from automatically loading `herdr_agents` and recursively creating more workers. Their prompt also explicitly prohibits nested delegation. A caller may selectively restore a required extension with `piArgs`, for example `-e /path/to/astrolabe/index.ts`; automatic extension discovery remains disabled.

## Examples

Start one implementation worker:

```json
{
  "action": "start",
  "name": "parser",
  "task": "Implement the parser changes, add focused tests, and report the files changed.",
  "model": "openai-codex/gpt-5.6-sol:high"
}
```

Run independent tasks in parallel:

```json
{
  "action": "start_many",
  "agents": [
    {
      "name": "backend",
      "task": "Implement the API change and its tests. Do not edit frontend files."
    },
    {
      "name": "frontend",
      "task": "Implement the client change and its tests. Do not edit server files."
    }
  ]
}
```

List the repository's Herdr worker threads:

```json
{ "action": "list" }
```

Inspect a worker and then wait for it:

```json
{ "action": "check", "name": "backend", "lines": 120 }
```

```json
{
  "action": "wait",
  "name": "backend",
  "until": ["done", "blocked"],
  "timeoutMs": 600000
}
```

For direct terminal access, use the attach command returned by `start`, for example `herdr agent attach a1b2c3-backend`.

## Development

```sh
bun run check
bun run dev
bun run smoke
```

The normal test suite uses fake clients and does not require Herdr. To verify the real Herdr/Pi CLI contract locally:

```sh
bun run test:integration
```

The integration test creates a temporary shared workspace, starts an interactive Pi process without submitting a model prompt, verifies that Herdr can observe it, and closes the workspace.
