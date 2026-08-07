# Session Metrics extension

エージェントがPiセッションのJSONLログからツール改善の材料を取得するための`session_metrics`ツールを登録します。ログを直接読み取り、外部インデックスは作成しません。

対応する分析:

- `tool-errors`: ツール別のエラー件数
- `tool-token-outliers`: 結果トークン数の大きいツール
- `tool-latency-outliers`: 呼び出し数の多いツール
- `token-usage-summary`: 入力・出力・キャッシュ・推論・合計トークン数とコスト
- `tool-usage-summary`: ツール別の呼び出し数、エラー、結果トークン
- `turn-token-usage`: 日別のトークン使用量

定型の分析だけを実行し、セッション本文やツール引数全体は返しません。
