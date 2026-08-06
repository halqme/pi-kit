---
name: coordinate-agents
description: Selects and coordinates Pi threads for persistent conversations and human handoff. Use for a human-resumable agent conversation. Do not use for a single direct task, read-only expert deliberation, or merely running a long-lived shell command.
---

# Coordinate Agents

Delegate only when persistence, isolation, human handoff, or parallelism materially improves the work. Keep a small, tightly coupled task in the current session. Make this decision yourself from the task, repository state, and available tools; ask the user only when scope, authorization, or a destructive choice is materially ambiguous.

## Decide whether and how to parallelize

Classify the work before launching an agent:

1. **Direct**: one coherent task, shared context, or significant coordination; do it in the current session.
2. **Consult**: independent opinions or a design/diagnostic comparison; use `agent_team` and keep members read-only.
3. **Persistent conversation**: future human handoff or a conversation that must retain its own context; use `threads`.

For parallel implementation, split by stable ownership (for example, server/client, parser/tests, or implementation/review), not by arbitrary file count. Start one worker when tasks depend on one another. Use `start_many` only when each task can make progress without another worker's uncommitted changes. Prefer two or three workers; add more only when the work has that many genuinely independent streams and integration cost remains lower than serial execution. If the split is uncertain, use one worker or consult first rather than creating speculative parallelism.

After classification, state internally: selected mode, number of workers, ownership boundaries, dependency order, and the acceptance check for each worker.

## Choose the execution model

- Use `threads` for a normal Pi conversation that a human may open with `/resume`. While the current extension process owns the thread, the parent can continue it through the tool; do not assume that tool control survives an extension restart.
- Use `agent_team` instead for read-only expert exploration, comparison, or adversarial review.
- Use `background_process` instead for a long-running command that does not need an agent to reason or edit.
- Work directly when delegation overhead exceeds the expected benefit.

Do not use `threads` as a substitute for worktree isolation. Concurrent human and agent access to a thread is not coordinated. If a thread edits a shared checkout, partition not only files but also Git index operations, lockfiles, generated outputs, formatters, and package-manager commands. When that partition cannot be guaranteed, stop other writers or use a Herdr worktree.

## Select models

Choose a model per delegated task instead of assigning one model indiscriminately:

- Use the strongest available reasoning model for architecture, ambiguous requirements, risky migrations, concurrency, security, or integration planning.
- Use a capable general model for ordinary bounded implementation, refactoring, and focused tests.
- Use a faster/cheaper model for mechanical edits, documentation, formatting, simple searches, or independently verifiable boilerplate.
- Use different models in `start_many` when task difficulty differs; use the same model when consistency or shared conventions matter more than specialization.
- Prefer an explicitly available model from the current settings or tool context. Do not invent model identifiers. If availability is unknown, omit the override and use the configured default.
- Do not select a weaker model merely to parallelize. A model choice is subordinate to correctness, isolation, and the acceptance checks.

When reporting a delegation plan, include the reason for each non-default model and the fallback if it cannot be launched. Model selection is a recommendation, not permission to change global settings.

## Prepare the delegation

Before starting anything:

1. Inspect the current repository state, relevant instructions, dependencies between tasks, and existing workers or threads when reuse is plausible.
2. Define a bounded outcome, owned paths or subsystem, acceptance checks, forbidden changes, and the evidence the delegate must return.
3. Separate independent tasks from dependent ones. Parallelize only independent work with non-overlapping ownership.
4. Decide who will integrate the result. Delegates must not merge, cherry-pick, push, remove worktrees, or rewrite shared history unless the user explicitly authorized that exact Git operation.

## Persistent conversation with `threads`

1. Use `create` for a new line of work. Record and report the returned thread ID so the conversation can be revisited. Use `send_message` when a known thread already owns the context; do not create duplicate threads for the same task without a reason.
2. Include the objective, known evidence, constraints, expected response, and whether the thread may edit. Default to read-only when persistence or human handoff—not implementation—is the reason for using a thread.
3. Use `wait` once when the next step depends on the response, or continue independent parent work and return later. Do not poll repeatedly.
4. Use `read` to inspect the resulting conversation before relying on its conclusions.
5. If a human may join, explicitly state ownership and avoid simultaneous writes until control is handed back. Treat concurrent use as uncoordinated.

A thread response is advice or work product, not proof. Verify material claims and inspect any changes in the actual workspace.


Treat lifecycle output and worker reports as evidence, not as a fixed plan. If a worker reveals a hidden dependency, overlapping ownership, insufficient capability, or a failed model launch, stop or re-plan the affected stream: reduce parallelism, change the task boundary, or retry with a stronger available model. Do not blindly restart the same task and do not change models solely because progress is slow without checking the actual blocker.
