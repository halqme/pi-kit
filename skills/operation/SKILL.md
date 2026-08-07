---
name: operation
description: Use this skill when designing and coordinating Pi work operations, including tool selection, parent-child agent execution, asynchronous monitoring, and hierarchical subproblems. Apply it when a task needs persistent interaction, repeated follow-ups, a terminal-hosted Pi agent, or separately tracked workstreams. Do not use it for a straightforward one-shot command or file edit.
---

# Pi Work Operations

Choose tools and execution structure by the lifetime, interaction model, and task hierarchy of the work. Do not infer capabilities that are absent from the tool definition or its implementation.

## `loop`: bounded follow-up turns

`loop` stores one message and sends it as a follow-up after each `agent_end` until its iteration count is exhausted. It does **not** edit files, run commands, or evaluate the completion condition by itself.

Use it only when repeating the same explicitly stated follow-up prompt across a bounded number of agent turns is the intended control flow. The follow-up prompt must tell the agent what evidence to inspect and what to do next.

Do not use it as a background worker, implementation delegate, timer, or substitute for checking an operation's result. Stop it when its repeated prompt is no longer valid.

## Terminal-hosted Pi implementation loop

Use this operation after the parent agent has resolved the implementation details, acceptance criteria, affected files, and verification commands, but the implementation needs multiple autonomous agent turns. The parent remains the coordinator; a child Pi instance performs the bounded implementation loop in a persistent terminal.

1. Create a named `terminal` that starts Pi in the intended repository and with the required extensions available.
2. Send the child a complete, scoped task: the accepted design, files in scope, constraints, exact checks, and a unique completion marker such as `OPERATION_DONE:<id>`. Require it to use `loop` with a bounded iteration count, to make and verify changes itself, and to print the marker only after the stated checks pass.
3. Register a `terminal.watch` for the completion marker and separate watches for actionable failure markers when the child can emit them. The watch wakes the parent; it does not prove that the work is correct.
4. When a watch fires, read the terminal output, inspect the child’s actual file changes and check output, then either accept the result or send a focused follow-up to the child.
5. Stop the child deliberately with `send` control keys or `close` once the parent has verified completion. Cancel watches that are no longer needed.

Do not use this pattern before the design is settled, for a one-turn edit, or when the parent must make interactive decisions during every step. In those cases, work in the parent session. Do not treat a child’s completion marker, a `loop` exhaustion, or a terminal watch match as semantic verification.

## `background_process`: detached jobs that naturally terminate

Use `background_process` for one-shot commands that may outlive the current turn and are expected to terminate on their own: builds, compiles, test suites, migrations with a known endpoint, and batch jobs.

- Start the job, retain its ID, and end the turn.
- Completion is delivered automatically. Use `check` only when the user explicitly requests current progress or output.
- Use `stop` only when cancellation is intended; it sends TERM and then KILL after a grace period.

Do not use it for a process that needs later stdin, live log inspection, pattern watches, or deliberate interactive shutdown. A development server may be detached, but a persistent TTY is usually a better fit when its logs or lifecycle need active control.

## `terminal`: persistent interactive TTYs

Use `terminal` for a long-lived or interactive process that needs one or more of the following:

- later input, control keys, or an explicit shutdown;
- a REPL, SSH session, shell, or log stream;
- pattern watches for errors or readiness; or
- inspection of the current terminal state while the process remains alive.

Create a named terminal, retain its name, use `watch` for actionable output patterns, and use `send` or `close` to end the process deliberately. `call` only tracks one command per terminal; its timeout stops tracking and does not stop the command. Do not use a terminal for an ordinary one-shot command.

## `agent_team`: read-only deliberation

Use `agent_team` for independent design exploration, comparison, or adversarial review. Members have only the tools explicitly exposed to them; their conclusions are not edits, test runs, or verification by the calling agent.

After a team finishes, the parent agent must perform any required implementation and checks itself.

## `threads`: hierarchical, separately tracked work

Use `threads` when the parent task has independent subproblems that need their own persistent Pi conversations, model context, and message queues. A thread can itself create or coordinate further threads, so this is a task hierarchy rather than merely a way to delegate a single command.

Typical use: the user supplies several distinct feedback items or workstreams. Create one thread per independently trackable item, send each its scoped context, and let the parent coordinate results, relay user feedback, or remain available for new direction. `send_message` is asynchronous; use `read` to inspect a thread's conversation and `list` to see only threads spawned from the current parent session.

Do not use threads just because work is lengthy. For a single implementation task, work in the parent session or use a process tool when the need is command execution rather than a separate conversation.

## Verification before acting

1. Read the current tool definition or local implementation when its behavior affects the choice.
2. Select the smallest tool whose lifecycle matches the work.
3. Record durable handles: process IDs, terminal names, watch IDs, or thread IDs.
4. Treat a tool result as evidence only for what it actually reports. Confirm file changes, command completion, or user-visible output separately when required.
5. Before reporting completion, state any active jobs, terminals, watches, or threads that remain.
