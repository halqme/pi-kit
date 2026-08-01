# Astrolabe

Astrolabeは、対応言語の既存ファイルを構文単位で検索・読取り・局所編集するTree-sitter拡張です。公開APIは単一の`astrolabe` toolであり、読取り時の構造確認はサーバー側で完結します。

## `astrolabe` tool

`action`で`search`、`inspect`、`replace`を選びます。

- `search`は`scope`に既存の対応ソースファイルまたはディレクトリを渡し、関数・呼出し・importを検索します。ディレクトリは対応する通常ファイルだけを再帰検索し、symlinkは辿りません。
- `inspect`は`path`でoutlineを取得するか、前回返された`continuation`で最小のsourceを取得します。outline→structure→sourceの手動遷移やnodeIdの抽出は不要です。
- `replace`は有効な`continuation`と完全な`replacement`を受け、現在のsource hash、ノード型・範囲・親文脈を再検証してから保存します。source取得を別途行う必要はありません。増分再解析、構文エラー、原子的保存の検証は維持します。

全結果はcontentとdetailsの両方に同じJSON responseを返します。`handles[].continuation`または`next[]`を変更せず次の呼出しへ渡してください。continuationは短命かつセッション限定で、失効・別path・stale・source未確認では書込みません。

```json
{ "action": "search", "scope": "packages/session-metrics/src", "kind": "call", "name": "exists" }
```

結果の`next[0]`をそのまま`astrolabe`へ渡すとinspectできます。sourceの結果にあるcontinuationを使って、replacementを指定した`replace`を実行します。失敗結果にも、回復可能な場合は完成済みの`next`を含めます。

旧`syntax_inspect`、`syntax_search`、`syntax_replace`は登録されません。更新後はPiで`/reload`を実行してください。

### フック

- `before_agent_start`: `astrolabe`が有効なターンだけ、scope検索とcontinuation再利用を案内します。未対応・生成物・設定・新規ファイルは通常のツールを使います。

Tree-sitterはWASMで動くため、ネイティブアドオンのビルドは不要です。対象はrealpath解決後も作業ディレクトリ内にある既存ファイルだけです。新規ファイルと、作業ディレクトリ外を指すsymlinkは拒否します。

## ハンドルと位置

`web-tree-sitter`にJavaScript文字列を渡す場合、Nodeの公開インデックスと`Point`はこのバインディングのUTF-16文字列位置として扱います。ハンドルには別途UTF-8バイト範囲も保存し、`parser.ts`の変換関数で両者を明示的に変換します。変換はサロゲートペアやUTF-8コードポイントの途中を位置として受け付けません。

改行、CRLF、日本語、絵文字、サロゲートペアを含む位置計算と増分編集には回帰テストがあります。ハンドルには言語IDと文法IDも記録し、異なる言語・文法の構文木では解決しません。ハンドルはファイルごとのLRU（既定256件）で管理するため、inspectを繰り返しても保持数は増え続けません。

## 言語アダプター

Astrolabeはgrammarを再実装しません。言語アダプターが言語ID、文法ID、WASMの場所、拡張子、outline Query、重要ノード種別をまとめて管理します。WASMとParserは文法を初めて使ったときに読み込み、言語IDと文法IDの組ごとに再利用します。同じファイルへの並列初回解析は1個のPromiseを共有します。解析済みファイルのキャッシュもパス、言語ID、文法IDの組で分け、セッション終了時に構文木とParserを解放します。

```text
languages/
└── [language]/
    ├── config.ts
    └── queries.ts
```

outlineは言語アダプターが定義する宣言・重要ノードに絞り、制御文や式を一覧へ混ぜません。現在の対応言語と拡張子は、TypeScript（`.ts`、`.mts`、`.cts`）、JavaScript（`.js`、`.mjs`、`.cjs`）、Python（`.py`、`.pyw`）、Go（`.go`）です。TSXとその他の言語は`unsupported_language`で拒否します。拡張子で判定できない単一ファイルは、`astrolabe`の`language`で明示できます。

Queryは`queries.ts`の`String.raw`文字列として管理します。Astrolabe実行時に同じ文字列をTree-sitter Queryとしてコンパイルするため、外部エディタのQuery言語サーバーによる言語判別やparser設定には依存しません。

## 読み方と編集方式の選び方

1. 対応言語の既存ソースは、まず`astrolabe`の`inspect`または`search`で調べ、いきなり`read`でファイル全体を消費しないようにします。構文情報が有効でないファイルでは通常の`read`を使います。
2. 広い範囲にはdirectory `scope`の`search`を使い、候補のcontinuationを`inspect`へそのまま渡して最小のsourceを取得します。構造確認は返却内容に含まれ、手動の`structure`呼出しは不要です。
3. 既存コードの変更は規模にかかわらず、可能な範囲で構文ノードへの局所操作へ分解します。大規模変更も対象外にはせず、import、型、関数、呼出し箇所などを段階的に編集し、各段階で中間状態を再確認します。
4. 操作回数を抑えるため、まだ有効なハンドルを再利用し、関連ノードをまとめてoutlineで確認します。編集後に返される更新情報がある場合は再利用し、構造やハンドルが変わり得る場合だけ再inspectします。
5. 新規ファイルは通常のファイル生成またはDiff・patch型編集で作成します。生成後の確認、追加修正、リファクタリングにはAstrolabeを使えます。

新規ファイル、生成コード、設定ファイル、非対応言語、または構文木操作の効果が薄い変更では通常のDiff・patch型編集を使います。対応言語の既存ソースに対する複数ファイルの変更や大規模な変更も、関連する局所編集へ分解できる限りAstrolabeの対象外にはしません。Astrolabeは既存ファイルだけを対象にし、存在しないファイルの新規作成は行いません。

Astrolabeの構文検査は型検査ではありません。continuationは編集後に失効し得るため、各編集後に返されたnext inspect actionを使ってください。複数編集を終えた時点で、各言語の型検査・Lint・プロジェクトのテストを別途実行してください。

## 状態コード

- `stale_node`: 検査済みノードを現在のファイルから一意に再同定できないか、ハンドルの言語・文法が現在のアダプターと一致しません。
- `invalid_continuation`: continuationが失効したか、変更されています。searchまたはoutlineからやり直してください。
- `inspect_requires_target` / `source_requires_target`: pathまたはcontinuationなしにinspectしたため、返却された`next`から安全な入力を選べません。
- `stale_node`: continuation発行後に対象source、ノード型、範囲、親文脈が変わったため書換えを拒否しました。
- `syntax_error`: 新しい構文エラー、missing node、または置換後の構文型・親文脈の不一致を検出しました。
- `unsupported_language`: 対象ファイルに言語アダプターがありません。

## ベンチマーク

編集時は`Tree.copy() → oldTree.edit(edit) → parser.parse(nextSource, oldTree)`で増分再解析します。小さなファイルで増分解析が常に高速とは限らないため、ベンチマークは同じ置換について全体解析と増分解析の平均時間を併記します。

```sh
bun run benchmark
bun run benchmark -- --json
```

ベンチマークは決定的な小さなfixtureで、次の方式を比較します。

- A: ファイル読込後の通常の文字列置換・書込み
- B: 実際の`astrolabe` responseからcontinuationを選び、`replace`する方式
- C: タスク種別に応じてA/Bを選ぶ方式

対象はimportの追加・削除、条件式、関数本体、引数、式、関数全体、新規ファイル、複数ファイルです。JSONには入出力文字数・推定token数・ツール呼出し数・時間・編集成功・期待結果との差分行数・構文検査・型検査・テスト・再試行・全体/増分解析時間を出力します。

Bで新規ファイル作成は`not_applicable`になります。失敗ではなく、Astrolabeの対象外であることを表します。テストは既定では`skipped`です。`runBenchmark`の`testCommand`オプションを与えると、各成功fixtureの作業ディレクトリで指定コマンドを実行し、pass/failを記録できます。

このベンチマークは編集方式の境界と処理量を比較するためのfixture harnessであり、特定のLLMの品質や実プロジェクトのテスト成功率を直接測るものではありません。

専用編集action（`add_import`など）は、汎用`astrolabe`の`replace`を維持した上での拡張点です。利用ログがまだないため、現時点では追加していません。

## Development

```sh
bun run check
bun run benchmark
```

ツールのschema、説明、promptGuidelines、TUI表示を変更した場合は、Piで`/reload`を実行すると現在のセッションへ反映されます。
