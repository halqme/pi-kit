# terminal

Herdr上の永続TTYを、Agentから非同期に操作・監視する拡張機能です。SSH、REPL、シェル、ログストリームなど、後から入力したり複数の条件を監視したりする対話型プロセスに使います。

この拡張はAgent専用です。人間向けのattach UIは提供しません。Herdr 0.8.0以降が`PATH`に必要です。

## Actions

- `create`: 名前付きTTYを作り、コマンドを起動する
- `list`: 管理中のTTYを一覧する
- `send`: TTYへ文字列を非同期送信する
- `read`: 最新の端末出力を読む
- `watch`: 出力パターンの監視を登録する。複数登録可能で、既定では最初の一致後に解除する
- `cancel_watch`: 監視を解除する
- `close`: TTYとHerdr workspaceを閉じる

`send`と`watch`は待機せずに返ります。監視に一致すると、親Piへ通知されて次のAgent turnが起動します。

## Example

```json
{"action":"create","name":"server","command":"ssh user@example.com"}
{"action":"send","name":"server","text":"tail -f app.log\n"}
{"action":"watch","name":"server","pattern":"ERROR","once":false}
{"action":"read","name":"server","lines":100}
```

監視は各自のwatch IDで独立しています。TTYのworkspaceとpaneはHerdrが保持し、terminalの登録情報はPiセッションへ記録されるため、拡張reload後も再発見できます。通常の一回限りのコマンドには`background_process`を使ってください。
