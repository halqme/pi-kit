# background_process

Runs shell commands in detached supervisor processes and records their state outside the conversational context. Jobs survive Pi shutdown, resume, reload, and compaction.

The `background_process` tool supports:

For frequent lightweight review requests, start a detached Pi command here rather than an agent team. For example, use `start` with `pi -ne 'please review ...'` and inspect its output when the process reports completion.

- `start`: start a shell command with an optional label and cwd.
- `start_many`: start multiple shell commands concurrently. Each item accepts `command`, plus optional `label` and `cwd`.
- `list`: show pending, running, and unchecked jobs. Set `includeCompleted` for history.
- `check`: show status plus bounded stdout/stderr tails without acknowledging the result. Use it for explicit progress or output requests, not to wait for completion.
- `stop`: request TERM followed by KILL after a grace period.

`start_many` reports successfully started processes and per-item launch failures separately. Each process remains independently inspectable and stoppable by its returned ID.

Choose this tool for detached non-interactive processes, including long-lived development servers and watchers, when later stdin, TTY state, control keys, or output-pattern watches are unnecessary. Expected lifetime is not the boundary: use `terminal` instead when the process needs interactive TTY control or pattern-based wakeups.

After starting a long-running process, end the turn instead of using `sleep`, polling, `ps`, or repeated `check` calls. Completion is automatically delivered as a follow-up turn; if the session was interrupted, an unchecked completion is delivered when the session resumes. Completion notifications are acknowledged automatically after delivery.

Phases are `pending`, `running`, `unchecked`, and `completed`. Exit disposition is stored separately as `success`, `failed`, `stopped`, or `lost`.

```sh
bun run check
bun run dev
bun run smoke
```
