# session-metrics

PiのセッションJSONLを集計するCLIです。デフォルトでは人間向けのサマリーを表示します。表示にはBun組み込みの `Bun.markdown.ansi()` を使い、Markdownテーブルを端末向けの枠線・色付き表示へ変換します。

```sh
session-metrics
session-metrics --json
session-metrics --daily --since 2026-04-01 --limit 20
session-metrics --weekly
session-metrics --projects
session-metrics --models
session-metrics --skills
session-metrics --tools
```

`--json` は既存の `MetricsReport` をJSONとして出力します。スクリプトから利用する場合はこの形式を使用してください。JSONLファイルまたはセッションディレクトリを最初の引数に指定できます。省略時は `~/.pi/agent/sessions` です。

## DuckDBストレージ

DuckDB CLIが必要です。インストール済みの実行ファイルを使い、既定では `~/.pi/agent/session-metrics.duckdb` に保存します。別の場所は `--db PATH` または `DUCKDB_PATH` で指定できます。

```sh
session-metrics ingest
session-metrics stats
session-metrics query "select model, sum(total_tokens) from assistant_usage group by model"
```

`ingest` はJSONLファイルの更新時刻、サイズ、SHA-256を `indexed_files` に記録します。変更されていないファイルは再解析せず、変更されたファイルはそのファイル由来の行を置き換えます。利用可能なテーブルは次のとおりです。

- `sessions`, `messages`, `turns`, `assistant_usage`
- `tool_calls`, `tool_results`, `skill_events`, `indexed_files`

`tool_calls`には引数サイズとtool call ID、`tool_results`にはエラー種別、入出力サイズ、実行時間、結果ハッシュ、短いプレビューを保存します。本文や引数全体は保存しません。既存DBには不足カラムを自動追加します。

本文やツール引数全体は保存せず、役割、モデル、トークン数、コスト、ツール名などのメタデータと、結果の短いプレビューだけを保存します。壊れたJSONL行はスキップします。SQLエラーやDuckDB未導入時はエラーを表示して非ゼロ終了します。
