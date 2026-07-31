# background-process

Runs shell commands in detached supervisor processes and records their state outside the conversational context. Jobs survive Pi shutdown, resume, reload, and compaction.

The `background_process` tool supports:

- `start`: start a shell command with an optional label and cwd.
- `start_many`: start multiple shell commands concurrently. Each item accepts `command`, plus optional `label` and `cwd`.
- `list`: show pending, running, and unchecked jobs. Set `includeCompleted` for history.
- `check`: show status plus bounded stdout/stderr tails and acknowledge the result.
- `stop`: request TERM followed by KILL after a grace period.

`start_many` reports successfully started processes and per-item launch failures separately. Each process remains independently inspectable and stoppable by its returned ID.

Phases are `pending`, `running`, `unchecked`, and `completed`. Exit disposition is stored separately as `success`, `failed`, `stopped`, or `lost`.

```sh
bun run check
bun run dev
bun run smoke
```
