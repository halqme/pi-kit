# Terminal + Intercom Protocol

This reference is for `delegate-task` when the worker is a child Pi. Read it before launching or supervising a child.

## Roles

- **Parent:** owns the user contract, scope, shared workspace, design decisions, integration, verification, and final acceptance.
- **Child:** executes only the handed-off objective, reports meaningful progress, asks when blocked, and never broadens scope silently.
- **terminal:** owns a persistent tmux TTY and lifecycle. It is not the semantic completion record.
- **intercom:** owns communication between separately tracked Pi sessions. It does not start a session.

## Starting a new child

1. Choose a unique name such as `worker-session-metrics-<short-id>` and a task ID.
2. Create the child in the intended repository:

```json
{"action":"create","name":"worker-example-123","command":"pi","cwd":"/path/to/repo"}
```

3. Send the initial prompt through the TTY. The first message should set the Pi name and include the complete handoff:

```json
{"action":"send","name":"worker-example-123","text":"/name worker-example-123\n<complete [delegate-task] handoff>\n"}
```

4. Once the child is connected, use `intercom({"action":"list"})` to confirm its name and status. Use `intercom.send` for non-blocking progress and `intercom.ask` only when a blocking decision is needed. A session can have only one pending ask from the same sender.
5. Register a terminal watch for the unique completion and failure markers when the child’s terminal output is available:

```json
{"action":"watch","name":"worker-example-123","pattern":"DELEGATE_DONE:task-123","once":true}
```

A watch wakes the parent but does not establish correctness.

## Message protocol

Progress messages should be short and actionable:

```text
PROGRESS:<task-id> <milestone>; next: <next action>; blocked: <none or reason>
```

Decision requests should state the alternatives and the consequence of waiting:

```text
DECISION:<task-id>
Question: <one decision>
Options: A=<...>; B=<...>
Default if no reply: <safe behavior>
```

The parent answers an inbound ask with `intercom.reply`, not a new unthreaded message. Use `intercom.pending` if more than one ask may be waiting.

Completion messages must include the marker, changed paths, checks, failures, and remaining risks:

```text
DELEGATE_DONE:<task-id>
Changed: <paths>
Checks: <commands and results>
Failures: <none or details>
Risks: <none or details>
```

For an unrecoverable failure, use `DELEGATE_FAILED:<task-id>` with the same evidence fields. For a lost child, the parent records the loss itself and does not infer success from terminal state.

## Shared-workspace rules

- Default: one mutating child per workspace.
- Multiple children: only with explicit, non-overlapping file ownership written in each handoff.
- Never let children concurrently rewrite the same file, commit, rebase, reset, clean, push, or publish.
- A child must leave unrelated user changes untouched and report unexpected changes rather than repairing them.
- The parent inspects `git status`, the diff, and the verification output before accepting.

## Questions, failure, and cleanup

- If the child needs a product or architecture decision, pause its work and ask the parent through intercom.
- If the child is still working, prefer `intercom.send` for a progress request; do not create a second worker merely to observe it.
- If the child fails or disconnects, inspect the last report and workspace before retrying. Do not retry blindly.
- After acceptance, cancel task-specific watches and call `terminal.close`. Retain a terminal only when the user explicitly needs a long-lived process or the task contract says it remains active.
- `terminal.call` is appropriate for a command in an existing TTY; it is not a substitute for the child’s intercom report or the parent’s verification.
