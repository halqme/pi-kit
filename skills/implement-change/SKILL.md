---
name: implement-change
description: Implement, modify, refactor, or remove project artifacts. Use for non-trivial code changes where repository grounding, mutation, verification, or isolated delegation materially improves reliability.
---

# Implement a Change

1. Establish the requested outcome and observable acceptance criteria. For non-trivial work, start `task`; do not invent a detailed plan before repository evidence exists.
2. Acquire only the context needed to identify the relevant boundary. Use `context.find` when the location is unknown, then structural `context` actions for concrete source targets. Expand retrieval only when the current evidence is insufficient.
3. Keep the current plan disposable. Record a `task.checkpoint` when new evidence changes the intended implementation, not after every tool call.
4. Apply the smallest coherent mutation. For supported existing source, prefer `code`: reuse a continuation when `context` already produced one, otherwise use the exact path/text edit form when it identifies one unique change. Do not call `context` only to make `code` available. Use ordinary file editing for new files, configuration, generated content, and unsupported languages.
5. Use `delegate` only for a self-contained workstream with independent acceptance criteria. The child works in an isolated worktree and branch. Its report or process exit is not proof of correctness; inspect and verify the branch before integration.
6. Run the narrowest existing checks that can falsify the change, then broaden with risk. Use `verify.run` for executable existing tests, compiler/typechecker/linter checks, and structural audits. Use `verify.record` only for supporting observations made elsewhere, such as CI, user feedback, review-agent findings, or agent-authored tests. A reported check is not a substitute for an executed check when the check can be run locally.
7. Review the resulting diff for scope, accidental changes, stale comments, secrets, broken contracts, and unnecessary complexity.
8. Call `task.finish` only when the requested outcome is supported by the workspace and at least one successful check executed through `verify.run`, with no unresolved executed failure for the latest evidence of that provenance. If evidence is insufficient, continue, block, or stop rather than converting completed steps into a completion claim.
9. Use `git-workflow` for commits or other Git mutations when requested or authorized by repository instructions.

Keep architecture and product decisions with the parent until repository evidence resolves them. A worker may implement a resolved decision; it should not silently widen the contract.
