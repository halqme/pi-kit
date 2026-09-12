# task

Adaptive task state, resource provenance, and verification for Pi Kit.

`task` keeps one session-scoped goal with acceptance criteria, disposable plans, checkpoints, blockers, and a completion state. A plan is a hypothesis and can be replaced whenever repository evidence changes.

While a task is active, the extension records successful explicit file observations and mutations from Pi's `read` / `edit` / `write` tools and best-effort paths exposed by Pi Kit's `context` / `code` tools. At task start it also captures a Git workspace baseline when available. This provenance is factual activity history: reading a file does not mean the agent reconciled it with later changes, and Git workspace deltas are not attributed to the agent because shell commands, background processes, or humans may also modify the workspace.

`task.review_context` projects that state into a compact packet containing the task goal and acceptance criteria, the latest checkpoint, observed and explicitly mutated resources, files whose final state changed during the task, pre-existing dirty files, and verification evidence. The packet is intended as input to an independent consistency reviewer; it is a set of leads, not an inferred dependency graph or proof of consistency.

`verify` distinguishes checks executed by the runtime from supporting observations reported by the model. `task.finish` requires at least one successful executable check from `verify.run`, and rejects completion while the latest executed evidence for a provenance is failing. A consistency review can be recorded with `verify.record` using `review_agent`; it remains supporting evidence and does not replace executable checks.

Use `verify.run` for existing tests, compiler/typechecker/linter checks, and executable structural audits. Use `verify.record` for CI observations, user feedback, review findings, or other evidence produced elsewhere.

Checks:

```sh
bun run --cwd extensions/task check
```
