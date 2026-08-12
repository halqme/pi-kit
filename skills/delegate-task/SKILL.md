---
name: delegate-task
description: Use this skill when the user asks to delegate, split, parallelize, or hand work to another agent, or when a medium/heavy task has independently verifiable workstreams. Prefer a child Pi for autonomous implementation while the parent keeps scope, decisions, and verification. Do not use for trivial edits, unresolved design decisions, conflicting shared mutations, or unapproved destructive or external actions.
---

# Delegate Task

Use a child Pi when separate context and autonomous execution will preserve the parent’s attention or make independent workstreams progress in parallel. This Skill is for **implementation delegation**, not merely asking another agent for an opinion.

`agent_team` is a read-only discussion tool. Do not use it as the implementation worker. Use `terminal` to launch or control a child Pi and `intercom` to coordinate with a named Pi session.

## Decide whether to delegate

Delegate by default when any of these is true:

- the user explicitly asks to delegate, split, parallelize, or use subagents;
- the task has two or more independently verifiable workstreams;
- a self-contained implementation can run for several turns without parent decisions;
- the parent needs to retain context for a separate design, review, or integration task.

Keep the work in the parent when it is a trivial one-step edit, the contract or acceptance criteria are unresolved, the work requires a material decision at every step, two workers would touch the same files or Git history, or the action is destructive, privileged, externally visible, or otherwise unapproved.

Before starting more than one mutating worker in a shared workspace, declare non-overlapping file ownership and verify it. Otherwise use one mutating worker at a time. Worktree automation is not assumed.

When concurrent writers share a workspace, an observed filesystem change is evidence that the shared workspace changed, not evidence of which worker caused it. Do not stop a worker merely because its session reports a changed file outside its ownership while another writer is active. Establish provenance from an isolated diff/commit or an attributable worker action; if the available tooling cannot attribute writes, serialize or isolate the writers before enforcing ownership.

## Workflow

1. **Resolve the worker contract.** Write down the objective, relevant context, allowed paths, forbidden paths, acceptance criteria, verification commands, workspace/Git rules, and the expected report. Do not delegate an ambiguous design decision; keep that decision with the parent.
2. **Choose a worker.** Use `intercom({ action: "list" })` and `intercom({ action: "status" })` once to find a suitable existing named session. If none fits, create a named child Pi with `terminal` in the intended cwd. Use the exact lifecycle and message templates in [`references/terminal-intercom-protocol.md`](references/terminal-intercom-protocol.md).
3. **Send the handoff.** Start the child with a unique worker name and task ID. Give it the complete contract, file ownership, verification commands, and reporting format. Tell it to use `loop` for multi-turn work, to ask the parent through `intercom` when blocked, and not to commit, push, delete, or publish unless explicitly authorized.
4. **Coordinate without taking the work back.** Use `intercom.send` for progress and notifications, `intercom.ask`/`reply` for decisions, and `intercom.pending` when resolving inbound questions. Use `terminal` only for child lifecycle, TTY input, a unique completion/failure watch, or necessary output inspection. Do not repeatedly poll a terminal that can be watched.
5. **Accept independently.** A child’s completion message, an intercom delivery, a terminal exit, or a watch match is evidence of an event—not proof that the task is correct. Inspect the actual diff, check file ownership, run the requested verification, and apply `verify-work` and `assess-task-completion` before accepting the result.
6. **Handle failure and cleanup.** Reply to questions promptly. On timeout, disconnect, or failure, record the state, stop/close the child deliberately, and either retry with a bounded change or resume the work in the parent. Close temporary terminals and cancel watches after acceptance; report any intentionally retained operation.

## Handoff template

```text
[delegate-task]
Task: <one self-contained objective>
Task ID: <unique id>
Allowed paths: <files/directories>
Do not touch: <files, Git history, external systems>
Context: <facts and constraints>
Acceptance: <observable outcomes>
Verify: <commands, or explain why none are available>
Workspace policy: <single worker / disjoint ownership / no commit>
Report: send progress with intercom; ask decisions with intercom; finish with
DELEGATE_DONE:<task-id> and list changed files, checks, failures, and remaining risk.
```

A worker that cannot safely continue must ask rather than silently widen scope. The parent remains responsible for integration, verification, and the final completion claim.
