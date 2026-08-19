# Session Metrics extension

Pi session JSONLの統計をagentから読むための`session_metrics` toolを登録する薄いwrapperです。結果はcanonical JSONのみを返し、表示はconsumer側に委ねます。

このextensionはactive sessionをinstrumentしません。session hook、filesystem watcher、live-event用の別JSONLは持たず、`session_metrics`が呼ばれた時だけ `@halqme/pi-session-metrics` を呼びます。session解析、skill/tool action集計、現在のPi resource discoveryはいずれもpackage側の実装を共有します。

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
- `all`: 選択済みの全MetricsReport

`since`、`limit`、`sessionsPath`を指定できます。結果は常に`query`と選択済み`data`を持つcanonical JSONです。`sessionsPath`が存在しない、または読み取り中にエラーになった場合は、実行を失敗させず、空の`data`とトップレベルの`source`診断を返します。`source`にはpath、`status`（`missing`または`error`）、エラーコード、メッセージが含まれます。存在する空ディレクトリには診断が付かないため、入力欠落と区別できます。不正な`since`はこれまでどおりエラーになります。

CLI向けのNuShell表示補助は`packages/session-metrics/nushell/session-metrics.nu`で管理します。`skills`と`tool-actions`はsession JSONLから再現可能な派生統計です。current resource statusだけは現在のPi環境との照合で、`available`（現在のcwdで発見できて使用履歴あり）、`missing`（履歴にはあるが現在のcwdでは発見できない）、`unused`（現在のcwdで発見できるが対象履歴では未使用）を区別します。`missing`は削除済みだけでなくdisableや別project scopeも含み得ます。このstatusは過去のusageをfilterしません。
