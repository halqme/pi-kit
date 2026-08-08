# session-metrics

Piのsession JSONLをofflineで読み、汎用的な利用統計へ変換するpackage / CLIです。常駐プロセス、外部index、active sessionへのinstrumentationを必要としません。

```sh
session-metrics
session-metrics --json
session-metrics ~/.pi/agent/sessions --daily --since 2026-04-01 --limit 20
session-metrics --weekly
session-metrics --projects
session-metrics --models
session-metrics --tools
```

既定の入力は `~/.pi/agent/sessions` です。単一JSONLファイルまたはディレクトリを指定でき、ディレクトリはsymlinkを辿らず再帰的に読み取ります。JSONLはstream処理し、壊れた行は `invalidLines` として数えつつ残りのsessionを解析します。

## 境界

coreが理解するのはPi session formatの汎用要素だけです。

- session id / cwd / timestamp
- user / assistant / tool-result message
- model、thinking level、stop reason
- token / cache / cost usage
- tool name、tool call id、tool error
- tool callとresultのtimestampから計算できるlatency

Astrolabeの`action`、Loopの継続文面、skill directoryなど、特定tool・extension・packageの意味は解釈しません。過去ログの集計結果が現在installされているPi-Kit packageに左右されることもありません。

tool固有の分析が必要なconsumerは、公開されている `SessionEvent` streamを使えます。`tool_call.input`、`tool_result.details`等は`unknown`のまま保持されるため、consumer側で必要な意味だけを解釈できます。

```ts
import { readSessionEvents } from "@halqme/pi-session-metrics";

for await (const event of readSessionEvents(path)) {
  if (event.kind === "tool_call") {
    // Interpret tool-specific input here, outside the core reducer.
  }
}
```

## Pipeline

```text
session JSONL
    ↓
events.ts       parse / normalize
    ↓
analyze.ts      generic reduction
    ↓
build-report.ts aggregate sessions / periods / projects
    ↓
report.ts       human-readable views
```

`--json` はgenericな `MetricsReport` を出力します。通常表示ではsummary、daily、weekly、projects、models、toolsのviewを選べます。`--limit`は表示行だけを制限し、集計対象sessionを切り捨てません。

`--tools`ではtool別のcalls、errors、result tokensに加え、同じ`toolCallId`のcall/result timestampから計算できた平均・最大latencyを表示します。timestampが不足するcallはlatency集計から除外します。

session本文やtool引数は集計結果へコピーしません。custom analyzer向けevent APIでは元sessionが持つgeneric payloadを参照できますが、core reportには件数・usage等のメタデータだけを保持します。
