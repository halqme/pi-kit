# terminal

tmux上の永続TTYを、Agentから非同期に操作・監視する拡張機能です。SSH、REPL、シェル、ログストリームなど、後から入力したり複数の条件を監視したりする対話型プロセスに使います。

この拡張はAgent専用です。人間向けのattach UIは提供しません。`tmux`が`PATH`に必要です。Piのreloadや再起動後もtmuxセッションは残り、管理中のpending callとwatchもPiセッション内のruntime snapshotから復元されます。

## Actions

- `create`: 名前付きTTYを作り、コマンドを起動する
- `list`: 管理中のTTYを一覧する
- `send`: TTYへ文字列またはキーを非同期送信する。`text` と `keys` は併用できず、`keys` には `Enter`、`Tab`、`C-c`、`C-d`、`C-l`、`C-a`、`C-e`、`C-f`、`C-b`、`C-n`、`C-p`、`C-u`、`C-k`、`C-w`、`C-r`、`C-z`、`Escape`、`BSpace`、`Up`、`Down`、`Left`、`Right`、`Home`、`End` を指定できる
- `read`: 最新の端末状態を読む
- `call`: 既存TTYの文脈でコマンドを実行し、完了結果を非同期通知する
- `watch`: 出力パターンの監視を登録する。複数登録可能で、既定では最初の一致後に解除する
- `cancel_watch`: 監視を解除する
- `close`: tmuxセッションを閉じる

`send`、`call`、`watch`は待機せずに返ります。call完了または監視一致時は、親Piへ通知されて次のAgent turnが起動します。`call`は端末ごとに1件だけ実行できます。既にpendingのcallがあるときは、別のコマンドを送らず、既存の`callId`を含む`status: "busy"`の結果を返します。存在しない端末名を指定した操作も、利用可能な`availableNames`を含む`status: "not_found"`の結果を返します。`timeoutMs`は完了追跡を終了するだけでコマンド自体は停止しません。出力はtmuxのscrollbackに依存するため、長大な出力は切り捨てられることがあります。

session reload時はterminal登録とruntime snapshotを復元したあと、即座にpollを行います。callはtmux内のmarkerと`/tmp`のstatus fileを再確認し、watchは保存されたpane snapshotとの差分を再確認するため、reload中に完了・一致したイベントもscrollbackが保持されていれば検出できます。TTYそのものが失われた場合はpending callとwatchを終了し、親Piへ一度通知します。

## Example

```json
{"action":"create","name":"server","command":"ssh user@example.com"}
{"action":"send","name":"server","text":"tail -f app.log\n"}
{"action":"call","name":"server","command":"pwd"}
{"action":"watch","name":"server","pattern":"ERROR","once":false}
{"action":"read","name":"server","lines":100}
```

監視は各自のwatch IDで独立しています。TTYのworkspaceとpaneはtmuxが保持し、terminalの登録情報とruntime stateはPiセッションへ記録されるため、拡張reload後も再発見できます。Dev Serverの起動完了を出力で確認してから次へ進む場合は、`terminal`でreadiness/failureの`watch`を登録してください。TTY、後続stdin、control key、pattern watchが不要な非対話型プロセスには`background_process`を使ってください。
