# session-metrics

PiセッションのJSONLログを直接集計するCLIです。外部のインデックスや常駐プロセスは使いません。既定では人間向けのサマリーを表示し、表示にはBun組み込みの `Bun.markdown.ansi()` を使います。

```sh
session-metrics
session-metrics --json
session-metrics ~/.pi/agent/sessions --daily --since 2026-04-01 --limit 20
session-metrics --weekly
session-metrics --projects
session-metrics --models
session-metrics --skills
session-metrics --tools
```

`--json` は `MetricsReport` をJSONとして出力します。引数にJSONLファイルまたはディレクトリを指定でき、省略時は `~/.pi/agent/sessions` を再帰的に読み取ります。壊れたJSONL行は集計時に無視します。

本文やツール引数全体はレポートに出力せず、役割、モデル、トークン数、コスト、ツール名などのメタデータだけを集計します。

Pi拡張の `session_metrics` ツールでは `cache-usage-summary` を指定すると、未キャッシュ入力、キャッシュ読み取り量、キャッシュヒット率、キャッシュ再請求額を確認できます。`cache-anomalies` は、直前ターンから10分以内なのにキャッシュ読み取りが0で、入力が1,000トークン以上あるターンを対象にする診断です。
