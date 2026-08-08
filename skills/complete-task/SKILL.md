---
name: complete-task
description: Determine whether requested work is actually complete and report completion. Use before claiming that a task, change, fix, investigation, or plan is finished. Treat progress signals and successful intermediate steps as evidence only for what they directly prove.
---

# Complete a Task

Completion is a claim about the requested outcome, not about the execution process.

Before claiming completion:

1. Re-read the requested outcome, applicable instructions, and acceptance criteria.
2. Inspect the resulting state and the strongest available evidence.
3. Distinguish evidence of progress from evidence that the requested outcome exists.
4. Check material failure paths, skipped verification, unresolved uncertainty, and any discrepancy between the intended and actual result.
5. Continue the task when the outcome is not yet supported. Claim completion only when the evidence is sufficient for the requested scope.

A completed checklist, successful command, passing child operation, exhausted loop, clean diff, or agent assertion is evidence only for what it directly demonstrates. None is a completion verdict by itself.

When completion is mediated by a tool or supervisor, propose completion with concise evidence. If the proposal is blocked or additional context is injected, incorporate that result and continue rather than treating the proposal as accepted.

Report the outcome, the evidence that supports it, checks that were skipped or failed, unresolved uncertainty, and remaining risk that matters to the user.

## Trigger and contract

Use before claiming that requested work is finished, including after an implementation, diagnosis, plan, or automated loop reaches its apparent endpoint. Input is the requested outcome plus current evidence; output is either a supported completion claim or a decision to continue. Stop when the outcome is supported at the requested scope, or when further progress requires unavailable evidence, user input, or approval.
