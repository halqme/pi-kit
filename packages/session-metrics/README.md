# session-metrics

Piのsession JSONLをofflineで読み、利用統計へ変換するpackage / CLIです。常駐プロセス、外部index、active sessionへのinstrumentationを必要としません。

```sh
session-metrics
session-metrics --json
session-metrics ~/.pi/agent/sessions --daily --since 2026-04-01 --limit 20
session-metrics --weekly
session-metrics --projects
session-metrics --models
session-metrics --skills
session-metrics --tools
session-metrics --tool-actions
```

既定の入力は `~/.pi/agent/sessions` です。単一JSONLファイルまたはディレクトリを指定でき、ディレクトリはsymlinkを辿らず再帰的に読み取ります。JSONLはstream処理し、壊れた行は `invalidLines` として数えつつ残りのsessionを解析します。

## 境界

session-metricsは3種類の情報を混ぜずに扱います。

### Session facts

`events.ts`と`analyze.ts`がPi session formatから直接読める事実を扱います。

- session id / cwd / timestamp
- user / assistant / tool-result message
- model、thinking level、stop reason
- token / cache / cost usage
- tool name、tool call id、tool error
- tool callとresultのtimestampから計算できるlatency

### Reproducible derived metrics

session JSONLだけから再計算できる、Pi上の利用形態に沿った派生統計です。

- skill usage: `/skill:name` の明示呼出しと、`read`で読み込まれたskill file
- tool action: tool inputにstring `action`がある場合のaction別calls / errors / result tokens / latency

`tool-actions`はAstrolabeやLoopのtool名を特別扱いしません。`action`という入力facetだけを読み、actionの意味自体は解釈しません。

skill readはread対象とresultをtool call idで対応付け、skill本文のfrontmatter `name`を優先して名前を確定します。現在そのskillがinstallされているかには依存しないため、削除済みskillの過去usageも残ります。

### Current resource enrichment

`resources.ts`は明示的に要求された場合だけ、`@earendil-works/pi-coding-agent`のpublic SDKで現在のPi resourcesを解決します。

- `DefaultResourceLoader`で現在のskillsとextensionsを取得
- Piのtool factoriesでbuilt-in toolsを取得
- loaded extensionのregistered toolsを取得
- historical usageと現在inventoryを照合

statusは次の3種類です。

- `available`: 現在発見でき、対象履歴でも使用されている
- `missing`: 対象履歴にはあるが現在は発見できない
- `unused`: 現在発見できるが対象履歴では未使用

current statusはhistorical metricsをfilterしたり書き換えたりしません。CLIでは`--skills`、`--tools`、`--json`でresource enrichmentを行います。

Pi resource loaderはPi本体と同様にextension registration factoryをloadします。そのためcurrent inventory取得はpureなsession parsingとは分離し、`buildReport()`から暗黙には実行しません。

## Pipeline

```text
session JSONL
    ↓
events.ts                    parse / normalize session facts
    ↓
analyze.ts                   generic metrics
    ├── analyzers/skills.ts   reproducible skill usage
    └── analyzers/tool-actions.ts
    ↓
build-report.ts              sessions / periods / projects

optional:
current Pi environment
    ↓
resources.ts                  Pi SDK resource discovery + historical comparison
```

`buildReport()`だけなら同じJSONLから同じhistorical reportを再現できます。current resource statusが必要なconsumerは、その後に`addCurrentResources(report, cwd)`を呼びます。テストや別inventoryとの比較には`addResourceInventory()`を使えます。

```ts
import {
  addCurrentResources,
  buildReport,
  readSessionEvents,
} from "@halqme/pi-session-metrics";

const report = await buildReport(sessionPath);
await addCurrentResources(report, process.cwd());

for await (const event of readSessionEvents(sessionPath)) {
  if (event.kind === "tool_call") {
    // Consumer-specific analysis can still use the normalized opaque input.
  }
}
```

通常表示ではsummary、daily、weekly、projects、models、skills、tools、tool-actionsのviewを選べます。`--limit`は表示行だけを制限し、集計対象sessionを切り捨てません。

`--tools`ではtool別のcalls、errors、estimated / reported result tokens、平均・最大latencyとcurrent statusを表示します。timestampが不足するcallはlatency集計から除外します。`--skills`ではreads / explicit invocationとcurrent statusを表示します。`--tool-actions`ではstring `action`を持つtoolだけをaction単位で集計します。

session本文やtool引数は集計結果へコピーしません。custom analyzer向けevent APIでは元sessionが持つgeneric payloadを参照できますが、reportには件数・usage等のメタデータだけを保持します。
