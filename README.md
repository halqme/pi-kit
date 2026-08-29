# Pi Kit

Pi向けの個人用ハーネスです。現在の中核は、repository context、structure-aware mutation、adaptive task state、executed verification、isolated delegation の5境界です。

```text
context -> code -> task -> verify
                    |
                    `-> delegate
```

`context` は概念検索と構造検索を1つのread-only surfaceへまとめ、`code` はそこから得たcontinuationを使って既存sourceを安全に編集します。`task` のplanは固定workflowではなく更新可能な仮説です。`verify.run` が実際にcheckを実行し、`task.finish` は実行済みverificationなしでは成立しません。`delegate` はworkerごとにGit worktree/branchを分離します。

主要extension:

- `extensions/repository`: `context` / `code`
- `extensions/task`: `task` / `verify`
- `extensions/delegate`: isolated child Pi
- `extensions/background_process`: detached process utility
- `extensions/browser_inspector`: browser inspection
- `extensions/terminal`: named terminal sessions
- `extensions/session_metrics`: session metrics UI

オフライン分析は `packages/session-metrics` が担当します。`session-metrics --runtime` は `context/code/task/delegate/verify` とverification provenanceを集計します。

設計の詳細は `docs/architecture.md` を参照してください。

```sh
bun install
bun run check
```
