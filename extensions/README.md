# Extensions

Pi Kitのextensionは、モデルに見せる境界を少なく保ちます。

中核:

- `repository` — `context` と `code`。概念検索、構造検索、inspection、validated mutationを同一repository engine上で扱う。
- `task` — `task` と `verify`。適応的task stateと実行済みverification evidenceを管理する。
- `delegate` — child Piを専用Git worktree/branchへ隔離して実行する。

汎用utility:

- `background_process`
- `browser_inspector`
- `session_metrics`
- `statusline`
- `suggest_reload`
- `terminal`

過去のplan/planner/runner/loop/grill、committee agent、standalone lexical/structural toolは互換surfaceとして保持しません。
