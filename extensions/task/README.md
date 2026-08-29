# task

Adaptive task state and verification for Pi Kit.

`task` keeps one session-scoped goal with acceptance criteria, disposable plans, checkpoints, blockers, and a completion state. A plan is a hypothesis and can be replaced whenever repository evidence changes.

`verify` distinguishes checks executed by the runtime from supporting observations reported by the model. `task.finish` requires at least one successful executable check from `verify.run`, and rejects completion while the latest executed evidence for a provenance is failing.

Use `verify.run` for existing tests, compiler/typechecker/linter checks, and executable structural audits. Use `verify.record` for CI observations, user feedback, review findings, or other evidence produced elsewhere.

Checks:

```sh
bun run --cwd extensions/task check
```
