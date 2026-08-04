# herdr-agents

Delegates implementation work from Pi to persistent, write-enabled Pi agents managed by Herdr. This extension is intentionally separate from `agent-team`: `agent-team` is a read-only briefing and deliberation committee, while `herdr_agents` creates workers that may edit files and run commands.

Herdr is used as the execution and observation layer. The parent Pi decides what work to delegate; Herdr owns the terminal, agent lifecycle, workspace, and optional Git worktree. The Herdr TUI does not need to be open. When no server is running, the extension starts `herdr server` as a detached headless process and retries the request.

## Requirements

- `herdr` must be installed and available on `PATH`.
- `pi` must be available to the Herdr server environment.
- Worktree isolation requires the requested `cwd` to be inside the repository's primary checkout. Herdr rejects a linked worktree as the source of another worktree.

## Tool

The `herdr_agents` tool supports:

- `start`: create one worker, using an isolated worktree by default, start an interactive Pi agent, and submit the initial task.
- `start_many`: create up to eight independent workers concurrently. Individual launch failures do not discard successful workers.
- `list`: show live agents known to Herdr.
- `check`: show lifecycle state and bounded terminal output.
- `prompt`: send another instruction, optionally waiting for the turn to settle.
- `wait`: wait for exact lifecycle states such as `done` or `blocked`.
- `interrupt`: send `Ctrl-C` to the agent.
- `close`: close the Herdr workspace, or remove a Herdr-managed worktree when `removeWorktree` is true.

Workers survive parent Pi reload, shutdown, and compaction because their processes and terminals are owned by Herdr. The extension deliberately does not stop workers on `session_shutdown`.

## Isolation

`isolation: "worktree"` is the default. Herdr creates a branch and linked checkout, and the Pi agent edits only that checkout. Use `branch` or `base` when the generated branch and `HEAD` base are not appropriate.

`isolation: "shared"` creates a Herdr workspace directly at `cwd`. This permits concurrent writes to the same checkout and should only be used when the caller has explicitly partitioned file ownership or otherwise coordinated those writes.

The extension never merges, cherry-picks, or deletes branches automatically. Inspect and integrate completed work deliberately. Closing a workspace without `removeWorktree` leaves the checkout and branch intact. Forced worktree removal is only performed when both `removeWorktree` and `force` are true.

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

For direct terminal access, use the attach command returned by `start`, for example `herdr agent attach backend`.

## Development

```sh
bun run check
bun run dev
bun run smoke
```
