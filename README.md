# Pi Kit

Pi Kit is a deliberately small runtime layer for Pi Coding Agent. The active architecture is organized around five mechanical boundaries:

```text
context -> code -> task -> verify
                    \
                     -> delegate
```

- `context` acquires repository evidence through lexical and structural retrieval.
- `code` performs structured mutation using handles produced by the same repository engine.
- `task` keeps lightweight goal, checkpoint, blocker, and completion state.
- `verify` distinguishes executed checks from reported evidence; only executed strong checks can unlock completion.
- `delegate` runs independent child Pi work in isolated Git worktrees and branches.

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
  statusline/
  suggest-reload/
  task/
  terminal/
skills/
prompts/
themes/
docs/
tsconfig.json
```

Every runtime workspace now lives under `extensions/`; there is no separate `packages/` layer. `session-metrics` owns both the Pi extension and its offline CLI/analysis kernel. Multi-word extension directories use kebab-case, and the shared TypeScript configuration lives at the repository root.

The repository extension exposes only `context` and `code`. The old standalone Astrolabe and BM25 tool surfaces are gone; their useful structural and lexical mechanisms are internal implementation details under `src/syntax` and `src/context`.

Additional independent utilities remain available through the extensions listed above. Offline session analysis is provided by the `session-metrics` CLI in `extensions/session-metrics`.

See [`docs/architecture.md`](docs/architecture.md) for the design rationale and runtime contracts.
