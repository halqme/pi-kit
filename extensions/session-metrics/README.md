# Session Metrics extension

エージェントがPiセッションのログからツール改善の材料を取得するための`session_metrics`ツールを登録します。

対応する分析:

- `tool-errors`: ツール別のエラー種別、件数、平均時間・出力サイズ
- `tool-token-outliers`: 結果トークン数の大きい呼出し
- `tool-latency-outliers`: 実行時間の長い呼出し

任意SQLは受け付けず、定型クエリだけを実行します。呼出し前にDuckDBの増分取り込みを行い、セッション本文やツール引数全体は返しません。
