# Session Metrics extension

エージェントがPiセッションのログからツール改善の材料を取得するための`session_metrics`ツールを登録します。

対応する分析:

- `tool-errors`: ツール別のエラー種別、件数、平均時間・出力サイズ
- `tool-token-outliers`: 結果トークン数の大きい呼出し
- `tool-latency-outliers`: 実行時間の長い呼出し
- `token-usage-summary`: モデル別の入力・出力・キャッシュ・推論・合計トークン数とコスト。`tool`を指定すると、そのツールを呼び出したアシスタント応答に限定
- `tool-usage-summary`: ツール別の呼び出し数、エラー率、平均・p50・p95レイテンシー、結果トークン、出力バイト
- `turn-token-usage`: ターンごとの入力・出力・キャッシュ・推論・合計トークン数とコスト

任意SQLは受け付けず、定型クエリだけを実行します。呼出し前にDuckDBの増分取り込みを行い、セッション本文やツール引数全体は返しません。
