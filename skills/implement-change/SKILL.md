---
name: implement-change
description: Implement, modify, refactor, or remove project artifacts. Use for non-trivial code changes where repository grounding, mutation, verification, or isolated delegation materially improves reliability.
---

# Implement a Change

1. Establish the requested outcome and observable acceptance criteria. For non-trivial work, start `task`; do not invent a detailed plan before repository evidence exists.
2. Acquire only the context needed to identify the relevant boundary. Use `context.find` when the location is unknown, then structural `context` actions for concrete source targets. Expand retrieval only when the current evidence is insufficient.
3. Keep the current plan disposable. Record a `task.checkpoint` when new evidence changes the intended implementation, not after every tool call.
4. Apply the smallest coherent mutation. For supported existing source, prefer `code` with the continuation returned by `context`; use ordinary file editing for new files, configuration, generated content, and unsupported languages.
5. Use `delegate` only for a self-contained workstream with independent acceptance criteria. The child works in an isolated worktree and branch. Its report or process exit is not proof of correctness; inspect and verify the branch before integration.
6. Run the narrowest existing checks that can falsify the change, then broaden with risk. Record actual results with `verify.record` and accurate provenance. Agent-authored tests and self-review are supporting evidence, not substitutes for existing or otherwise exogenous checks.
7. Review the resulting diff for scope, accidental changes, stale comments, secrets, broken contracts, and unnecessary complexity.
8. Call `task.finish` only when the requested outcome is supported by the workspace and strong verification evidence. If evidence is insufficient, continue, block, or stop rather than converting completed steps into a completion claim.
9. Use `git-workflow` for commits or other Git mutations when requested or authorized by repository instructions.

Keep architecture and product decisions with the parent until repository evidence resolves them. A worker may implement a resolved decision; it should not silently widen the contract.
