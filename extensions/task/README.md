# task

Adaptive task state, resource provenance, and verification for Pi Kit.

`task` keeps one session-scoped goal with acceptance criteria, disposable plans, checkpoints, blockers, and a completion state. A plan is a hypothesis and can be replaced whenever repository evidence changes.

While a task is active, the extension records successful explicit file observations and mutations from Pi's `read` / `edit` / `write` tools and best-effort paths exposed by Pi Kit's `context` / `code` tools. At task start it also captures a Git workspace baseline when available. This provenance is factual activity history: reading a file does not mean the agent reconciled it with later changes, and Git workspace deltas are not attributed to the agent because shell commands, background processes, or humans may also modify the workspace.

`task.review_context` projects that state into a compact packet containing the task goal and acceptance criteria, the latest checkpoint, observed and explicitly mutated resources, files whose final state changed during the task, pre-existing dirty files, and verification evidence. Paths are reported relative to the Git project root even when Pi was launched in a subdirectory. Calling `review_context` also creates a review request. The independent reviewer must return a real report recorded with `verify.record` using `review_agent` and that request id; a parent `self_review` cannot satisfy the request. If the task changes after the packet was issued, completion requires a fresh review.

`verify` distinguishes checks executed by the runtime from supporting observations reported by the model. `verify.run` keeps the session CWD as its default execution directory but permits an explicit `cwd` anywhere inside the Git project root. `task.finish` requires at least one successful executable check from `verify.run`, rejects completion while the latest executed evidence for a provenance is failing, and enforces any outstanding independent-review request. When a task starts from a clean Git workspace, `task.finish` also requires the workspace to be clean again, so intended task changes must be committed (and unintended changes reverted) before completion. Tasks that start with pre-existing dirty files do not auto-claim ownership of those changes.

Use `verify.run` for existing tests, compiler/typechecker/linter checks, and executable structural audits. The default passing process exit is `0`. For a negative test whose correct behavior is a non-zero exit, pass `expectedExitCodes` (for example `[1]`) instead of wrapping the command in a shell that converts the expected failure into exit `0`. Use `verify.record` for CI observations, user feedback, review findings, or other evidence produced elsewhere.

Runtime errors that Pi Kit can classify carry stable prefixes such as `execution_failure:`, `agent_misuse:`, and `precondition:` so session metrics can distinguish operational failures from tool misuse and invalid state transitions without guessing from arbitrary error prose.

Checks:

```sh
bun run --cwd extensions/task check
```
