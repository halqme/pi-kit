# terminal

Agentから永続的なshell processを非同期に操作・監視する拡張機能です。実装にはtmuxを使い、対話TTY、dev server、SSH/REPL、reviewer subprocess、長時間のone-shot commandを同じprocess lifecycleで扱います。

この拡張はAgent専用です。人間向けのattach UIは提供しません。tmuxがPATHに必要です。Piのreloadや再起動後もtmux sessionは残り、管理中のpending callとwatchもPi session内のruntime snapshotから復元されます。

## Actions

- `create`: 名前付きsessionを作り、shellの表示用promptを抑制してから初期commandを起動する。同名sessionがあれば再利用する。
- `list`: 管理中のsessionを一覧する。
- `send`: 後続stdin相当の文字列やcontrol keyを送る。
- `read`: 最新のscrollbackを読む。
- `call`: 既存sessionのshell文脈でone-shot commandを実行し、完了を非同期通知する。
- `watch`: 出力patternの監視を登録する。複数登録でき、既定では最初の一致後に解除する。
- `cancel_watch`: 監視を解除する。
- `close`: sessionを閉じる。

`send`、`call`、`watch`は待機せずに返ります。call完了またはwatch一致時は親Piへ通知され、次のAgent turnが起動します。callはsessionごとに1件だけpendingにできるので、並列処理は名前の異なるsessionを作って同時にcallします。短命なreviewer等では初期commandを `:` にしてidle shellを作り、その後`call`で実処理を起動できます。

`timeoutMs`は完了追跡を終了するだけでcommand自体は停止しません。停止が必要なら対話sessionへ `C-c` を送るかsessionを `close` します。出力はtmux scrollbackに依存するため、長大な出力は切り捨てられることがあります。

## Examples

```json
{"action":"create","name":"server","command":"bun run dev"}
{"action":"watch","name":"server","pattern":"ready","once":true}
{"action":"send","name":"server","keys":["C-c"]}

{"action":"create","name":"review-a","command":":"}
{"action":"call","name":"review-a","command":"pi -p --no-session --no-extensions --no-skills --no-prompt-templates --tools read,bash \"<review prompt>\""}
{"action":"read","name":"review-a","lines":200}
{"action":"close","name":"review-a"}
```

A call completion or watch match is process evidence only. Semantic task completion remains the responsibility of the task/verification runtime.
