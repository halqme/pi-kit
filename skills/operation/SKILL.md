---
name: operation
description: Use this skill when a task requires coordinating multiple Pi execution primitives or composing them into a parent-child operation. Do not use it to learn a single tool's behavior; the current tool description and implementation are authoritative for that.
---

# Pi Work Operations

Use tool descriptions as the source of truth for each tool's individual contract. This skill exists only for orchestration decisions that span tools and cannot yet be enforced mechanically.

When a coordination rule becomes stable and deterministic, move it into an extension or shared implementation instead of preserving it as prose here. Do not compensate for an incorrect or incomplete tool contract with skill instructions; fix the tool.

## Choose the execution shape

Select the smallest execution shape that matches the work. A detached process, an interactive terminal, a separately tracked Pi conversation, a bounded self-continuation loop, and a deliberative agent team are different primitives rather than levels of "more autonomy".

Do not introduce a child agent merely because work is long. Use a child only when separate agent context or lifecycle control is itself useful. Keep user-facing decisions and materially unresolved design questions with the parent unless the user explicitly delegates them.

## Terminal-hosted child Pi operation

Use a terminal-hosted child Pi when the parent has resolved the implementation contract but wants a child agent to execute it autonomously while retaining interactive lifecycle control.

1. Resolve the task, acceptance criteria, scope, constraints, and verification commands before delegation.
2. Create a named `terminal` running Pi in the intended repository and send the complete scoped task to the child.
3. Have the child use `loop` for its own multi-turn completion control when the task cannot reliably finish in one agent turn.
4. Give the operation a unique completion marker and register `terminal.watch` for that marker and any actionable failure markers.
5. A watch match only wakes the parent. Inspect the child's actual changes and check output before accepting the work.
6. Close the child deliberately after verification and cancel watches that are no longer useful.

Prefer `threads` instead when the important abstraction is a separately tracked Pi conversation or hierarchical workstream rather than an interactive subprocess. Prefer direct parent execution when the parent must make a material decision after each step.

## Coordination boundaries

`agent_team` is advisory deliberation, not an execution stage. Its output may inform either the human or the parent agent; do not invent a mandatory implementation handoff after it.

When several threads or child agents can mutate shared state, the coordinator is responsible for choosing an appropriate concurrency strategy from the facts exposed by the tools and repository. Do not hard-code worktree or file-partition policy here when the agents can determine the safe strategy from the task.

## Evidence and completion

Preserve durable handles for any operation that can outlive the current turn. Treat process completion, loop completion, watch matches, child claims, and agent-team conclusions only as the evidence they actually provide. Apply the task's normal verification workflow before reporting semantic completion.

Before finishing, report any operation resources that intentionally remain active.
