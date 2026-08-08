# Session Metrics extension

Pi session JSONLの汎用統計をagentから読むための`session_metrics` toolを登録する薄いwrapperです。

このextensionはactive sessionをinstrumentしません。session hook、filesystem watcher、live-event用の別JSONLは持たず、`session_metrics`が呼ばれた時だけ `@halqme/pi-session-metrics` で既存session fileを読み取ります。

利用できるview:

- `summary`: session / turn / token / cache / errorと主要model・tool
- `daily`: 日別集計
- `weekly`: 週別集計
- `projects`: cwd別集計
- `models`: model + thinking level別集計
- `tools`: tool別calls / errors / result tokens / latency

`since`、`limit`、`sessionsPath`を指定できます。`json: true`ではgenericな`MetricsReport`全体を返します。

Astrolabe action、Loop継続、skill usageなどのtool固有解釈はこのextensionにもpackage coreにも置きません。必要な分析はsession-metricsが公開する`SessionEvent` streamをconsumer側で解釈します。
