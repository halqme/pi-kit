# background_process

Runs shell commands in detached supervisor processes and records their state outside the conversational context. Jobs survive Pi shutdown, resume, reload, and compaction.

The `background_process` tool supports:

For frequent lightweight review requests, start a detached Pi command here rather than an agent team. For example, use `start` with `pi -ne 'please review ...'` and inspect its output when the process reports completion.

- `start`: start a shell command with an optional label and cwd.
- `start_many`: start multiple shell commands concurrently. Each item accepts `command`, plus optional `label` and `cwd`.
- `list`: show pending, running, and unchecked jobs. Set `includeCompleted` for history.
- `check`: show status plus bounded stdout/stderr tails without acknowledging the result. Use it for explicit progress or output requests, not to wait for completion.
- `stop`: request TERM followed by KILL after a grace period.

`start_many` validates and launches each item independently, so a blank command or launch failure does not prevent valid items from starting. A non-empty batch returns a structured result with `details.status` set to `started`, `partial`, or `failed`, plus `details.started` and `details.failed` (each failure includes its zero-based `index` and `error`). The same status and per-item failures are included in the text result, so callers should not retry the whole batch just because one item failed. Each started process remains independently inspectable and stoppable by its returned ID.

Choose this tool for detached non-interactive processes, including long-lived development servers and watchers, when later stdin, TTY state, control keys, output-pattern watches, or startup-readiness observation are unnecessary. If a next step depends on seeing the server become ready or fail, use `terminal` with a readiness/failure watch instead. Expected lifetime is not the boundary: use `terminal` when the process needs interactive TTY control or pattern-based wakeups.

After starting a long-running process, do not use `sleep`, polling, `ps`, or repeated `check` calls to wait for completion. A running server reports completion only after it exits, so completion notification is not a readiness signal. When no readiness observation is needed, end the turn and let the completion notification arrive later; notifications are delivered automatically, including after session resume. If startup gates the next step, choose `terminal` before starting the process.

Phases are `pending`, `running`, `unchecked`, and `completed`. Exit disposition is stored separately as `success`, `failed`, `stopped`, or `lost`.

```sh
bun run check
bun run dev
bun run smoke
```
