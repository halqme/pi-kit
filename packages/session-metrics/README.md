# session-metrics

Piのsession JSONLをofflineで読み、利用統計へ変換するpackage / CLIです。常駐プロセス、外部index、active sessionへのinstrumentationを必要としません。

```sh
session-metrics
session-metrics --all
session-metrics ~/.pi/agent/sessions --daily --since 2026-04-01 --limit 20
session-metrics --weekly
session-metrics --monthly
session-metrics --monthly-activity
session-metrics --projects
session-metrics --models
session-metrics --skills
session-metrics --tools
session-metrics --tool-actions
session-metrics --logical-operations
session-metrics --runtime
```

既定の入力は `~/.pi/agent/sessions` です。単一JSONLファイルまたはディレクトリを指定でき、ディレクトリはsymlinkを辿らず再帰的に読み取ります。JSONLはstream処理し、壊れた行は `invalidLines` として数えつつ残りのsessionを解析します。

入力pathが存在しない、または読み取り中にエラーになった場合は、処理を失敗させず、空のreportと`source`診断を返します。`status` は、存在しない入力なら `missing`、それ以外の読み取りエラーなら `error` です。診断には入力path、エラーコード、メッセージが含まれます。存在する空ディレクトリは正常な空入力なので `source` 診断を持たず、欠落した入力と区別できます。`since` の形式が不正な場合は、これまでどおりエラーを返します。

## 構造

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
- runtime: `context` / `code` / `task` / `delegate` / `verify` のaction別calls / errorsと、成功した`verify.record`のprovenance別pass / fail

runtime集計はtool call/resultだけから再構成します。session本文やverification detailをreportへコピーせず、verification provenanceと結果だけを集計するため、harness変更前後のtrajectory比較に使えます。

skill readはread対象とresultをtool call idで対応付け、skill本文のfrontmatter `name`を優先して名前を確定します。現在そのskillがinstallされているかには依存しないため、削除済みskillの過去usageも残ります。

### Current resource enrichment

`resources.ts`は明示的に要求された場合だけ、`@earendil-works/pi-coding-agent`のpublic SDKで現在のPi resourcesを解決します。

- `DefaultResourceLoader`で現在のskillsとextensionsを取得
- Piのtool factoriesでbuilt-in toolsを取得
- loaded extensionのregistered toolsを取得
- selected historical usageと現在inventoryを照合

statusは次の3種類です。

- `available`: 現在のcwdで発見でき、対象履歴でも使用されている
- `missing`: 対象履歴にはあるが現在のcwdでは発見できない
- `unused`: 現在のcwdで発見できるが対象履歴では未使用

`missing`は「削除済み」を断定する値ではありません。package/extensionの削除だけでなく、disableや現在のcwdでは有効でないproject-local resourceも含む「現在のPi resource setから発見できない」という状態です。

current statusはhistorical metricsをfilterしたり書き換えたりしません。`cwd`は現在inventoryを解決するscopeだけを決め、usage/status判定には`since`等で選択済みのreport全体を使います。CLIでは`--skills`、`--tools`でresource enrichmentを行います。

Pi resource loaderはPi本体と同様にextension registration factoryをloadします。そのためcurrent inventory取得はpureなsession parsingとは分離し、`buildReport()`から暗黙には実行しません。

## Pipeline

```text
session JSONL
    ↓
events.ts                    parse / normalize session facts
    ↓
analyze.ts                   generic metrics
    ├── analyzers/skills.ts   reproducible skill usage
    ├── analyzers/tool-actions.ts
    └── analyzers/vnext.ts    runtime action + verification provenance facets
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

オプション指定時のCLIはcanonical JSONを出力します。オプションなしの場合だけ、overview（ツール・スキル頻度、モデル概況、Activity草、MonthlyActivity）のTUI風表示を出します。`--all`は従来の全レポート相当を返します。summary、daily、weekly、monthly、monthly-activity、projects、models、skills、tools、tool-actions、logical-operations、runtimeは、よく使うqueryへのaliasです。`--since`は入力sessionの選択に一律適用し、`--limit`は結果rowsだけを制限します。集計対象sessionやsummaryの集計値は`--limit`で変わりません。

`--tools`ではtool別のcalls、errors、estimated / reported result tokens、平均・最大latencyとcurrent statusをJSONで返します。`--monthly-activity`では月別のsessions / turns / messages / tokens / cost / errorsを返します。timestampが不足するcallはlatency集計から除外します。`--skills`ではreads / explicit invocationとcurrent statusを返します。overviewではスキルのfrequency（reads + explicit）を上位10件返します。`--tool-actions`ではtool inputのstring `action`をaction名として使い、`action`がないtoolはtool名（例: `bash`）を既定actionとしてaction単位で集計します。`--logical-operations`ではturn単位のlogical operationについてtool call、returned token、wall clock、error、retry、successを返します。`--runtime`ではruntime coreのarea/action別calls/errorsとverification provenance別records/pass/fail/errorsを返します。表示はNuShell用スクリプトなどのconsumerに委ねます。

session本文やtool引数は集計結果へコピーしません。custom analyzer向けevent APIでは元sessionが持つgeneric payloadを参照できますが、reportには件数・usage等のメタデータだけを保持します。
