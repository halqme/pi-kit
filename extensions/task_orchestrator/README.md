# task_orchestrator

Taskごとに専用Git worktreeとQueenセッションを割り当て、Frontの会話セッションから実装作業のライフサイクルを切り離す最小のTask Runtimeです。

## Scope

このMVPが所有するのは、Task Store、Task専用worktree、Queenの起動・再開、および明示的なcleanupだけです。Frontは`submit`後に実装を続けず、Taskの状態説明とユーザーフィードバックの窓口に留まります。Queenは専用worktreeで通常のPiツールを使って作業し、検証後に`complete`を呼びます。

Worker、Worker用worktree、自動apply、merge/rebase、Task間の依存・競合管理、heartbeat、自動復旧、orphan回収、runner stateの永続化は実装しません。必要性が実運用で確認できたものから追加します。

## Actions

- `submit`: 現在のGit worktreeがcleanであることを確認し、現在HEADをbase SHAとして`pi/task/<taskId>`と専用worktreeを作成してQueenを起動する
- `status`: 保存されたTask、Queenの生存状態、現在のworktree dirty状態を返す。runningなQueenが失われていればTaskを`stopped`へ遷移させる
- `list`: 保存されたTaskを列挙する
- `resume`: stoppedなTaskの既存worktreeへ新しいQueenを起動する
- `complete`: Queen自身のTask worktreeからのみTaskを`completed`へ遷移させる
- `cleanup`: Queenが実行中でなく、worktreeがcleanな場合だけworktreeとTask recordを削除する。task branch自体は残す

## Storage

Task recordは`<pi agent dir>/task-runtime/tasks/<taskId>.json`、worktreeは`<pi agent dir>/worktrees/<repo-name>-<repo-path-hash>/<taskId>`に置きます。

保存するTask stateは次のとおりです。

```ts
type Task = {
  id: string
  request: string
  repoRoot: string
  worktreePath: string
  branch: string
  baseSha: string
  queenSession?: string
  status: "created" | "running" | "stopped" | "completed"
}
```

`dirty`は保存しません。`status`や`cleanup`の時点でGitから取得します。

## Git safety

Task Runtimeだけがmanaged worktreeの作成・削除を行います。`submit`は開始元worktreeがdirtyなら停止し、自動stashや`git clean`を行いません。`cleanup`もTask worktreeがdirtyなら削除せずに失敗します。

Queenは自動commitされません。`complete`もbranchのmergeや本体worktreeへの適用を意味せず、Taskの意味上の作業と検証が完了したことだけを記録します。Task branchの取り込みは既存のGit運用に委ねます。

managed Task worktreeから別のtop-level Taskを`submit`することも拒否します。Workerやsubtaskの隔離モデルを導入するまでは、Queenの再帰的なTask生成を許可しません。

## Queen lifecycle

Queenは`terminal`のtmuxセッション機構を使い、Task worktreeをcwdとして`pi`を起動します。Task Storeには実tmux session IDを保存するため、Front側のPiセッションが変わっても生存確認と明示的な`resume`が可能です。

Queenプロセス自体は永続状態ではありません。失われた場合、`status`でTaskは`stopped`になり、`resume`は同じworktreeと元のrequestを使って新しいQueenを起動します。watchdogによる自動復旧はこのMVPには含みません。
