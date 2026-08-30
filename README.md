# Pi Kit

Pi Kit is a deliberately small runtime layer for Pi Coding Agent. The active architecture is organized around five mechanical authority boundaries, not a mandatory execution pipeline:

```text
repository evidence ──> context
         │
         └────────────> code

user goal ────────────> task ─────> verify ─────> task.finish
                          \
                           └───────> delegate
```

- `context` acquires repository evidence through lexical and structural retrieval.
- `code` performs validated mutation of supported existing source. A structural continuation is the strongest target when `context` already produced one; an exact unique text target can enter the same structural mutation engine directly.
- `task` keeps lightweight goal, checkpoint, blocker, and completion state.
- `verify` distinguishes executed checks from reported evidence; only executed strong checks can unlock completion.
- `delegate` runs independent child Pi work in isolated Git worktrees and branches.

The arrows describe common evidence and authority flow. They are not prerequisites between tools: `context` is not a qualification gate for `code`, and `delegate` is only useful when the work actually decomposes.

## Layout

```text
extensions/
  background-process/
  browser-inspector/
  delegate/
  repository/
    src/
      context/
      code/
      syntax/
  session-metrics/
  task/
  terminal/
skills/
prompts/
docs/
tsconfig.json
```

Every runtime workspace now lives under `extensions/`; there is no separate `packages/` layer. `session-metrics` owns both the Pi extension and its offline CLI/analysis kernel. Multi-word extension directories use kebab-case, and the shared TypeScript configuration lives at the repository root.

The repository extension exposes only `context` and `code`. The old standalone Astrolabe and BM25 tool surfaces are gone; their useful structural and lexical mechanisms are internal implementation details under `src/syntax` and `src/context`.

Additional independent utilities remain available through the extensions listed above. Offline session analysis is provided by the `session-metrics` CLI in `extensions/session-metrics`.

See [`docs/architecture.md`](docs/architecture.md) for the design rationale and runtime contracts.
