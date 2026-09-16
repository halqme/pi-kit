# Session Metrics extension

Pi session JSONLの統計をagentから読むための`session_metrics` toolを登録する薄いwrapperです。結果はcanonical JSONのみを返し、表示はconsumer側に委ねます。

通常のtool実行やmodel eventはinstrumentせず、既存のsession JSONLを後から解析します。例外として、Pi Kit自身のrevision差を履歴から区別できるよう、`session_start`で現在のPi Kit Git revisionとdirty fingerprintだけをcustom entryとして1回記録します。同じfingerprintでextensionがreloadされた場合は重複記録しません。Git metadataを取得できないインストールではfingerprintを記録しません。

session解析、skill/tool action集計、現在のPi resource discoveryはいずれもpackage側の実装を共有します。tool errorの診断では、`details.errorClass`またはPi Kitが契約として付ける既知prefixだけを分類し、任意のエラー文面から推測はしません。分類は`execution_failure`、`agent_misuse`、`expected_failure`、`precondition`の4種で、それ以外は`unknown`に残します。

利用できるview:

- `overview`: 概況（tool / skill頻度、modelのprovider・cache・cost、Activity、MonthlyActivity）
- `summary`: session / turn / token / cache / errorと主要model・skill・tool
- `daily`: 日別集計
- `weekly`: 週別集計
- `monthly`: 月別集計
- `monthly-activity`: 月別活動のrows
- `projects`: cwd別集計
- `models`: model + thinking level別集計
- `skills`: skillのread / explicit invocationと現在status
- `tools`: tool別calls / errors / result tokens / latencyと現在status
- `tool-actions`: string `action`を持つtool inputのaction別統計
- `logical-operations`: turn単位のtool call / token / wall clock / error / retry / success統計
- `all`: 選択済みの全MetricsReport。`diagnostics.errors`に4分類とunknown、`diagnostics.revisions`にfingerprint別session数を含む

`since`、`limit`、`sessionsPath`を指定できます。`since`を指定した場合、diagnosticsも同じsession集合に対して集計されます。結果は常に`query`と選択済み`data`を持つcanonical JSONです。`sessionsPath`が存在しない、または読み取り中にエラーになった場合は、実行を失敗させず、空の`data`とトップレベルの`source`診断を返します。`source`にはpath、`status`（`missing`または`error`）、エラーコード、メッセージが含まれます。存在する空ディレクトリには診断が付かないため、入力欠落と区別できます。不正な`since`はこれまでどおりエラーになります。

CLI向けのNuShell表示補助は`extensions/session-metrics/nushell/session-metrics.nu`で管理します。`skills`と`tool-actions`はsession JSONLから再現可能な派生統計です。current resource statusだけは現在のPi環境との照合で、`available`（現在のcwdで発見できて使用履歴あり）、`missing`（履歴にはあるが現在のcwdでは発見できない）、`unused`（現在のcwdで発見できるが対象履歴では未使用）を区別します。`missing`は削除済みだけでなくdisableや別project scopeも含み得ます。このstatusは過去のusageをfilterしません。
