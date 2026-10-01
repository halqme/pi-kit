# Extensions

Pi Kit keeps the default model-visible boundary small and moves structured operations behind Pi's Codemode runtime.

## Default surface

- `delegate` — isolated child Pi work in a dedicated Git worktree and branch.
- `terminal` — persistent shell-process lifecycle, including interactive sessions, asynchronous one-shot commands, reviewer subprocesses, output watches, and later stdin/control keys.
- `codemode` — provided by Pi itself; this is the structured orchestration boundary used to reach Pi Kit's non-direct tools.

## Codemode tools

The following Pi Kit tools use `exposure: "codemode"`. They are callable from Codemode scripts and are not separate top-level model tools.

- `context` — lexical/structural repository evidence.
- `code` — syntax-validated source mutation.
- `task` — adaptive task state, checkpoints, review requests, and completion state.
- `verify` — executable and reported verification evidence.

Codemode can call these through `tools.*`, and can use `searchTools()`, `describeTool()`, or `ALL_TOOLS` when a declaration is outside its inline budget.

## Deferred utilities

Rare or specialized capabilities remain callable without occupying the normal model surface:

- `browser_inspector`
- `macos_talk`
- `session_metrics`
- `semantic_observe`

These use deferred exposure. Codemode can discover them with `searchTools()` or `ALL_TOOLS`.

## Optional interactive tool

`ask` is a model-only TUI interaction tool. Because model-only tools cannot be invoked from Codemode, Pi Kit does not load it in the default package. Load `extensions/ask/index.ts` explicitly when structured interactive questions are worth an additional direct tool.

Pi Kit does not register a separate detached-process tool. Use `terminal` for process lifecycle and one named terminal per concurrently running command.
