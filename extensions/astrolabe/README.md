# Astrolabe

Astrolabeは、既存ファイルを構文単位で読み、局所的に編集するためのTree-sitter拡張です。TypeScriptファイルは`outline → structure → source → syntax_replace`の順に扱い、必要な関数やメソッドだけをモデルへ渡します。

## Tools

- `syntax_inspect`: nodeIdなしの`outline`でファイル内の関数、クラス、メソッド、型、import、exportを宣言要約として一覧にします。関数のシグネチャ、クラス／インターフェースの継承と主要メンバー、importの対象とモジュール名を表示します。得られたnodeIdを`structure`で掘り下げ、そこで得たnodeIdだけを`source`で取得できます。ファイル全体の`structure`や`source`は拒否します。拡張子で判定できない場合は`language: "typescript"`を明示できます。
- `syntax_search`: Tree-sitter Queryで関数宣言、呼出し、importを検索します。`kind`に`function`、`call`、`import`を指定し、`name`または`source`（モジュール名、引用符なし）で絞り込めます。結果には位置と、`structure`／`source`へ渡せるnodeIdが含まれます。
- `syntax_replace`: `source`で本文を確認済みのnodeIdだけを置換します。Tree-sitterの`Edit`を作成し、増分再解析、`ERROR`とmissing nodeの位置、新しい構文エラー、置換後のノード型と親文脈を検証してから保存します。結果はTUIへ簡潔に表示されます。

Tree-sitterはWASMで動くため、ネイティブアドオンのビルドは不要です。対象はrealpath解決後も作業ディレクトリ内にある既存ファイルだけです。新規ファイルと、作業ディレクトリ外を指すsymlinkは拒否します。

## ハンドルと位置

`web-tree-sitter`にJavaScript文字列を渡す場合、Nodeの公開インデックスと`Point`はこのバインディングのUTF-16文字列位置として扱います。ハンドルには別途UTF-8バイト範囲も保存し、`parser.ts`の変換関数で両者を明示的に変換します。変換はサロゲートペアやUTF-8コードポイントの途中を位置として受け付けません。

改行、CRLF、日本語、絵文字、サロゲートペアを含む位置計算と増分編集には回帰テストがあります。ハンドルには言語IDと文法IDも記録し、異なる言語・文法の構文木では解決しません。ハンドルはファイルごとのLRU（既定256件）で管理するため、inspectを繰り返しても保持数は増え続けません。

## 言語アダプター

Astrolabeはgrammarを再実装しません。言語アダプターが言語ID、文法ID、WASMの場所、拡張子、outline Query、重要ノード種別をまとめて管理します。WASMとParserは文法を初めて使ったときに読み込み、言語IDと文法IDの組ごとに再利用します。同じファイルへの並列初回解析は1個のPromiseを共有します。解析済みファイルのキャッシュもパス、言語ID、文法IDの組で分け、セッション終了時に構文木とParserを解放します。

```text
languages/
└── typescript/
    ├── config.ts
    └── queries.ts
```

outlineは`declaration.function`、`declaration.method`、`declaration.type`、`declaration.import`、`declaration.export`に絞り、制御文や式を一覧へ混ぜません。現在サポートする拡張子は`.ts`、`.mts`、`.cts`です。TSXとその他の言語は`unsupported_language`で拒否します。TSXは`language`を明示しても受け付けません。拡張子のないTypeScriptファイルなどは、`syntax_inspect`の`language`で明示できます。

Queryは`queries.ts`の`String.raw`文字列として管理します。Astrolabe実行時に同じ文字列をTree-sitter Queryとしてコンパイルするため、外部エディタのQuery言語サーバーによる言語判別やparser設定には依存しません。

## 読み方と編集方式の選び方

1. 対応言語の既存ソースを読むときは、まず`syntax_inspect`をコードの地図として使い、いきなり`read`でファイル全体を消費しないようにします。構文情報が有効でないファイルでは通常の`read`を使います。
2. `outline`で関連宣言を把握し、必要な宣言だけを`structure`で掘り下げ、本文が必要な関数やメソッドに絞って`source`を取得します。広い候補抽出には文字列検索、宣言・呼出し・importの正確な抽出には`syntax_search`を使います。
3. 既存コードの変更は規模にかかわらず、可能な範囲で構文ノードへの局所操作へ分解します。大規模変更も対象外にはせず、import、型、関数、呼出し箇所などを段階的に編集し、各段階で中間状態を再確認します。
4. 操作回数を抑えるため、まだ有効なハンドルを再利用し、関連ノードをまとめてoutlineで確認します。編集後に返される更新情報がある場合は再利用し、構造やハンドルが変わり得る場合だけ再inspectします。
5. 新規ファイルは通常のファイル生成またはDiff・patch型編集で作成します。生成後の確認、追加修正、リファクタリングにはAstrolabeを使えます。

新規ファイル、生成コード、設定ファイル、非対応言語、または構文木操作の効果が薄い変更では通常のDiff・patch型編集を使います。対応言語の既存ソースに対する複数ファイルの変更や大規模な変更も、関連する局所編集へ分解できる限りAstrolabeの対象外にはしません。Astrolabeは既存ファイルだけを対象にし、存在しないファイルの新規作成は行いません。

Astrolabeの構文検査は型検査ではありません。Tree-sitterのノードIDは編集後に陳腐化する可能性があるため、各編集後に再度outlineまたはstructureを取得してください。複数編集を終えた時点で、TypeScript Language Service、`tsc --noEmit`、プロジェクトのテストを別途実行してください。

## 状態コード

- `stale_node`: 検査済みノードを現在のファイルから一意に再同定できないか、ハンドルの言語・文法が現在のアダプターと一致しません。
- `language_mismatch`: 明示した言語がnodeIdに記録された言語と一致しません。
- `structure_requires_node`: outlineでnodeIdを選ばずに`structure`を取得しようとしました。
- `source_requires_node` / `source_requires_structure`: nodeIdを選ばずに、または`structure`を経ずに`source`を取得しようとしました。
- `replace_requires_source`: `source`で本文を確認していないnodeIdを編集しようとしました。
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
- B: 実際の`syntax_inspect`出力からハンドルを選び、`syntax_replace`する方式
- C: タスク種別に応じてA/Bを選ぶ方式

対象はimportの追加・削除、条件式、関数本体、引数、式、関数全体、新規ファイル、複数ファイルです。JSONには入出力文字数・推定token数・ツール呼出し数・時間・編集成功・期待結果との差分行数・構文検査・型検査・テスト・再試行・全体/増分解析時間を出力します。

Bで新規ファイル作成は`not_applicable`になります。失敗ではなく、Astrolabeの対象外であることを表します。テストは既定では`skipped`です。`runBenchmark`の`testCommand`オプションを与えると、各成功fixtureの作業ディレクトリで指定コマンドを実行し、pass/failを記録できます。

このベンチマークは編集方式の境界と処理量を比較するためのfixture harnessであり、特定のLLMの品質や実プロジェクトのテスト成功率を直接測るものではありません。

専用編集プリミティブ（`add_import`など）は、汎用`syntax_replace`を維持した上での拡張点です。利用ログがまだないため、現時点では追加していません。

## Development

```sh
bun run check
bun run benchmark
```

ツールのschema、説明、promptGuidelines、TUI表示を変更した場合は、Piで`/reload`を実行すると現在のセッションへ反映されます。
