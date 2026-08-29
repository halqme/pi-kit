# Extensions

Pi Kit no longer discovers every directory here as public runtime surface. The root `package.json` explicitly lists loaded extensions.

`vnext/` owns the core agent runtime:

- `context`: repository retrieval and structural inspection
- `code`: structure-aware mutation
- `task`: adaptive task lifecycle
- `delegate`: isolated child Pi worktrees
- `verify`: provenance-aware verification evidence

The manifest also loads a small set of independent utilities: `background_process`, `browser_inspector`, `session_metrics`, `statusline`, `suggest_reload`, and `terminal`.

Other directories are historical implementation substrate and are inert unless explicitly added back to the package manifest. In particular, Astrolabe and BM25 are now kernel implementations consumed by `vnext/`; their old tool names are not registered directly.
