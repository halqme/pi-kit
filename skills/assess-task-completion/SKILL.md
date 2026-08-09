---
name: assess-task-completion
description: Use this skill immediately before reporting that a task is complete. Assess whether the requested outcome is supported by the available evidence, or whether work must continue or stop as blocked. Do not use it to implement changes or perform verification checks; use verify-work for those.
---

# Assess Task Completion

Completion is a claim about the requested outcome, not about the execution process.

Use `verify-work` to produce verification evidence first. This Skill is the final decision gate: consume that evidence and decide whether to report completion, continue, or stop as blocked. Do not repeat a full verification workflow here unless a material gap is apparent.

Before claiming completion:

1. Re-read the requested outcome, applicable instructions, and acceptance criteria.
2. Inspect the resulting state and the strongest available evidence.
3. Distinguish evidence of progress from evidence that the requested outcome exists.
4. Check the evidence for material failure paths, skipped verification, unresolved uncertainty, and any discrepancy between the intended and actual result.
5. Decide from the evidence:
   - report completion only when the requested outcome is supported;
   - continue when a material part of the outcome is missing;
   - stop and report the blocker when the next action requires unavailable evidence, user input, or approval.

A completed checklist, successful command, passing child operation, exhausted loop, clean diff, or agent assertion is evidence only for what it directly demonstrates. None is a completion verdict by itself.

When completion is mediated by a tool or supervisor, propose completion with concise evidence. If the proposal is blocked or additional context is injected, incorporate that result and continue rather than treating the proposal as accepted.

Report the outcome, the evidence that supports it, checks that were skipped or failed, unresolved uncertainty, and remaining risk that matters to the user.

## Trigger and contract

Use immediately before reporting that a task is complete, including after an implementation, diagnosis, plan, or automated loop reaches its apparent endpoint. Input is the requested outcome plus current evidence; output is a supported completion claim, a decision to continue, or a clear blocked status. Do not use this Skill to implement changes or perform verification checks; use `verify-work` for those. Stop when the outcome is supported at the requested scope, or when further progress requires unavailable evidence, user input, or approval.
