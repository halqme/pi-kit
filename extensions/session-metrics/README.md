# Session Metrics extension

Pi session JSONLの統計をagentから読むための`session_metrics` toolを登録する薄いwrapperです。

このextensionはactive sessionをinstrumentしません。session hook、filesystem watcher、live-event用の別JSONLは持たず、`session_metrics`が呼ばれた時だけ `@halqme/pi-session-metrics` を呼びます。session解析、skill/tool action集計、現在のPi resource discoveryはいずれもpackage側の実装を共有します。

利用できるview:

- `summary`: session / turn / token / cache / errorと主要model・skill・tool
- `daily`: 日別集計
- `weekly`: 週別集計
- `projects`: cwd別集計
- `models`: model + thinking level別集計
- `skills`: skillのread / explicit invocationと現在status
- `tools`: tool別calls / errors / result tokens / latencyと現在status
- `tool-actions`: string `action`を持つtool inputのaction別統計

`since`、`limit`、`sessionsPath`を指定できます。`json: true`では`MetricsReport`全体とcurrent resource inventoryを返します。

`skills`と`tool-actions`はsession JSONLから再現可能な派生統計です。current resource statusだけは現在のPi環境との照合で、`available`（現在も存在して使用履歴あり）、`missing`（履歴にはあるが現在は発見できない）、`unused`（現在は存在するが対象履歴では未使用）を区別します。このstatusは過去のusageをfilterしません。
