# Extensions

Pi Kitのextensionは、モデルに見せる境界を少なく保ちます。

中核:

- `repository` — `context` と `code`。概念検索、構造検索、inspection、validated mutationを同一repository engine上で扱う。
- `task` — `task` と `verify`。適応的task stateと実行済みverification evidenceを管理する。
- `delegate` — child Piを専用Git worktree/branchへ隔離して実行する。

汎用utility:

- `ask`
- `background_process`
- `browser_inspector`
- `macos_talk` — AppleScript/JXAを`osascript`へ直接渡すmacOS automation boundary。foregroundを必要以上に奪わないscriptを優先する。
- `session_metrics`
- `terminal`
