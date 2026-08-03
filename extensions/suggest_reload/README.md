# suggest_reload

ローカル由来の拡張・スキル・プロンプト・テーマを監視します。

対象はPiの自動検出パスと`settings.json`のうち、`npm:`・`git:`ではないローカルパスです。変更を検知すると現在の作業を中断せず通知し、`/reload-local`でPiの正式なreload処理を実行します。
